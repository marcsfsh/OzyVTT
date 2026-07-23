import { createServer as createHttpServer } from "node:http";
import { randomInt, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import express, { type Express } from "express";
import { Server } from "socket.io";
import { z } from "zod";
import { API_VERSION } from "@vtt/api-contract";
import type { ClientToServerEvents, ClientRole, CombatLogEntry, GameState, ServerToClientEvents, TableEvent } from "@vtt/domain";
import { ACTOR_DEFINITION_SCHEMA_VERSION } from "@vtt/schemas";
import { nextAnnotationExpiry } from "./annotations.js";
import { createApiV1Router } from "./api-v1.js";
import { ContentLibrary } from "./content-library.js";
import { AuthService } from "./auth.js";
import { developmentClientUrl } from "./client-hosting.js";
import { migrateToScene } from "./scenes.js";
import { CombatLogStore } from "./combat-log.js";
import { timelineDirtied, type TimelineOutcome } from "./combat-history.js";
import { createGameApiRouter } from "./game-http.js";
import { createGameOperations, gameCommandRegistry, type GamePrincipal } from "./game-operations.js";
import { CommandRejectedError, GameStore, RulesBlockedError, TimelineConfirmationRequired } from "./game-store.js";
import { createInitialGameState } from "./initial-game-state.js";
import { IntegrationCredentialStore } from "./integration-credentials.js";
import { LoginRateLimiter } from "./login-rate-limit.js";
import { MapAssetStore } from "./map-assets.js";
import { MapCatalogStore } from "./map-catalog.js";
import { createMapRouter } from "./map-http.js";
import { TokenCatalogStore } from "./token-catalog.js";
import { createTokenRouter } from "./token-http.js";
import { PresenceRegistry } from "./presence.js";
import { projectGmView, projectPlayerView } from "./projections.js";
import { ensureEncounterTokens, type TokenMapGeometry } from "./token-placement.js";
import { ViewerAccessStore } from "./viewer-access.js";
import { ViewerCoordinator } from "./viewer-coordinator.js";
import { createViewerRouter } from "./viewer-http.js";
import { projectViewerEncounter } from "./viewer-encounter.js";
import { ViewerPresentationStore } from "./viewer-presentation-store.js";

export type CreateServerOptions = {
  authPath: string;
  databasePath: string;
  /** Separate SQLite file for integration credentials/audit, distinct from the game-state database. */
  integrationCredentialsPath: string;
  mapAssetsPath?: string;
  tokenAssetsPath?: string;
  webDist: string;
  useDevelopmentClient: boolean;
  developmentClientPort: number;
  clientOrigin?: string;
  initialGameState?: GameState;
  applicationVersion?: string;
  /** Browser origins that a GM can copy to a separate LAN display. */
  viewerBaseUrls?: readonly string[];
  /** How long a session's presence stays "reconnecting" after its last connection drops before flipping to "offline". */
  presenceGraceMs?: number;
};

const isLoopback = (ip: string | undefined) => ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";

export function createServer(options: CreateServerOptions) {
  const app: Express = express();
  const httpServer = createHttpServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, { cors: options.clientOrigin ? { origin: options.clientOrigin } : undefined });
  const auth = new AuthService(options.authPath);
  const store = new GameStore(options.databasePath, options.initialGameState ?? createInitialGameState(), { timelineDirtied });
  const combatLog = new CombatLogStore(options.databasePath);
  const credentials = new IntegrationCredentialStore(options.integrationCredentialsPath);
  const mapAssets = new MapAssetStore(options.mapAssetsPath ?? join(dirname(options.databasePath), "map-assets"));
  const mapCatalog = new MapCatalogStore(options.databasePath);
  const tokenAssets = new MapAssetStore(options.tokenAssetsPath ?? join(dirname(options.databasePath), "token-assets"), { maxBytes: 5 * 1024 * 1024, maxDimensionPx: 2048, maxPixels: 2048 * 2048 });
  const tokenCatalog = new TokenCatalogStore(options.databasePath);
  const viewerAccess = new ViewerAccessStore(options.databasePath);
  const viewerPresentation = new ViewerPresentationStore(options.databasePath);
  const contentLibrary = new ContentLibrary();
  const authorizeGm = (token: string | undefined) => auth.verify(token) !== null;
  const viewerCoordinator = new ViewerCoordinator(viewerAccess, viewerPresentation, authorizeGm);
  const gmLoginRateLimiter = new LoginRateLimiter();
  const presence = new PresenceRegistry(options.presenceGraceMs ?? 8000, () => broadcast());
  const presenceFor = (sessionId: string) => presence.statusFor(sessionId);
  const annotationExpiryTimers = new Set<ReturnType<typeof setTimeout>>();
  /** Ephemeral annotations (measurements) carry their own `expiresAt`; the projection already hides expired ones, but nothing re-broadcasts once the timestamp passes without other activity, so schedule one at the soonest expiry - same pattern as ViewerCoordinator's ping expiry. Re-publishing (not just broadcast) also drops the expired measurement from the shared screen (Channel B). */
  function scheduleAnnotationExpiry() {
    // Keep exactly one pending timer: clear any prior one, arm the soonest expiry, then re-arm from
    // inside the callback so every staggered annotation drops at its own expiry - not just the first.
    // Without the re-arm, a second ping placed after the first would linger until unrelated activity
    // re-broadcast the state (the reported "extra pings don't disappear" bug).
    for (const timer of annotationExpiryTimers) clearTimeout(timer);
    annotationExpiryTimers.clear();
    const soonest = nextAnnotationExpiry(store.snapshot, Date.now());
    if (soonest === null) return;
    const timer = setTimeout(() => {
      annotationExpiryTimers.delete(timer);
      void publishGameState(store.snapshot);
      scheduleAnnotationExpiry();
    }, Math.max(0, soonest - Date.now()));
    timer.unref?.();
    annotationExpiryTimers.add(timer);
  }

  /** GM view + the time-travel timeline (labels can name hidden combatants, so this is GM-only metadata). */
  function gmView(state: GameState, now = Date.now()) { return { ...projectGmView(state, presenceFor, now), turnHistory: store.listTurnSnapshots() }; }
  /** Also reauthorizes every connected socket against the latest revocation state, so a revoked GM client is downgraded or disconnected on its next check rather than only when it next sends a command. */
  function broadcast() {
    const state = store.snapshot;
    for (const socket of io.sockets.sockets.values()) {
      const token = socket.handshake.auth?.token;
      const gm = auth.verify(token);
      const player = auth.verifyPlayer(token);
      if (token && !gm && !player) { socket.disconnect(true); continue; }
      socket.emit("state:updated", gm ? gmView(state) : projectPlayerView(state, player?.sessionId, presenceFor));
    }
  }
  /**
   * Emit a transient battlemap toast. GM sockets always receive it; player sockets only when it isn't
   * GM-only AND every referenced actor is public - so a hidden combatant is never narrated to players.
   * Not stored in GameState (ephemeral presentation); the viewer channel gets nothing.
   */
  function broadcastTableEvent(event: Readonly<{ kind: TableEvent["kind"]; text: string; actorIds?: readonly string[]; gmOnly?: boolean }>) {
    const state = store.snapshot;
    const actorIds = event.actorIds ?? [];
    const publicToPlayers = !event.gmOnly && actorIds.every((id) => state.actors.find((actor) => actor.id === id)?.visibility === "public");
    const payload: TableEvent = { id: randomUUID(), kind: event.kind, text: event.text, actorIds, at: Date.now() };
    for (const socket of io.sockets.sockets.values()) {
      const token = socket.handshake.auth?.token;
      if (auth.verify(token)) socket.emit("table:event", payload);
      else if (publicToPlayers && auth.verifyPlayer(token)) socket.emit("table:event", payload);
    }
    // Every transient toast is also a durable log line, gated the same way (hidden combatants stay GM-only).
    appendLog({ kind: event.kind, text: event.text, actorIds, gmOnly: event.gmOnly });
  }
  /**
   * Append one line to the persistent combat log and push it live. Visibility mirrors the toast rule:
   * GM sockets always receive it; players only when it isn't GM-only and references no hidden combatant.
   */
  function appendLog(entry: Readonly<{ kind: CombatLogEntry["kind"]; text: string; actorIds?: readonly string[]; gmOnly?: boolean }>) {
    const state = store.snapshot;
    const actorIds = entry.actorIds ?? [];
    const gmOnly = entry.gmOnly === true || actorIds.some((id) => state.actors.find((actor) => actor.id === id)?.visibility === "gm-only");
    const record = combatLog.append({ kind: entry.kind, text: entry.text, gmOnly, revision: state.revision });
    for (const socket of io.sockets.sockets.values()) {
      const token = socket.handshake.auth?.token;
      if (auth.verify(token)) socket.emit("log:entry", record);
      else if (!gmOnly && auth.verifyPlayer(token)) socket.emit("log:entry", record);
    }
  }
  /** "Round 3 - Borin's turn." A hidden combatant's turn stays GM-only (its name would otherwise leak). */
  function logTurnBegin(state: GameState) {
    if (state.combat.turnActorId === null) return;
    const name = state.actors.find((actor) => actor.id === state.combat.turnActorId)?.name ?? "A combatant";
    appendLog({ kind: "turn", text: `Round ${state.combat.round} - ${name}'s turn.`, actorIds: [state.combat.turnActorId] });
  }
  /** Translate a timeline navigation outcome into log lines - plain turns for forward play, GM-only history notes for rewinds. */
  function logTimelineOutcome(outcome: TimelineOutcome, state: GameState) {
    switch (outcome.kind) {
      case "advanced": case "legacy": logTurnBegin(state); break;
      case "rewrote": appendLog({ kind: "history", text: "The GM rewrote history from this turn - every later turn was undone.", gmOnly: true }); logTurnBegin(state); break;
      case "rewound": appendLog({ kind: "history", text: `The GM rewound to ${outcome.label}.`, gmOnly: true }); break;
      case "stepped": appendLog({ kind: "history", text: `The GM moved to ${outcome.label}.`, gmOnly: true }); break;
      case "discarded": appendLog({ kind: "history", text: `The GM discarded the changes at ${outcome.label}.`, gmOnly: true }); break;
      case "resumed": appendLog({ kind: "history", text: "The GM resumed live play.", gmOnly: true }); break;
    }
  }
  async function tokenGeometryFor(mapAssetId: string): Promise<TokenMapGeometry> {
    const [asset, entry] = await Promise.all([mapAssets.get(mapAssetId), Promise.resolve(mapCatalog.get(mapAssetId))]);
    if (!asset || !entry || entry.kind !== "battlemap") throw new CommandRejectedError("The active encounter battlemap is unavailable.");
    return { width: asset.width, height: asset.height, calibration: entry.calibration?.calibration ?? null, scale: entry.scale ?? null };
  }
  async function publishGameState(state: GameState) {
    try { await viewerCoordinator.synchronizeEncounter(state.revision, projectViewerEncounter(state, Date.now())); }
    catch {
      for (const socket of io.sockets.sockets.values()) if (auth.verify(socket.handshake.auth?.token)) socket.emit("system:error", "The game state was saved, but the shared viewer could not synchronize the encounter. Retry the last viewer action or restart the host.");
    }
    broadcast();
  }
  /** Bridge: making a scene live also presents its map on the shared screen (one action). Best-effort - a viewer hiccup must never undo the authoritative scene switch that already committed. */
  async function presentSceneMap(mapAssetId: string) {
    try {
      const geometry = await tokenGeometryFor(mapAssetId);
      const entry = mapCatalog.get(mapAssetId);
      await viewerCoordinator.presentMap(store.snapshot.revision, { assetId: mapAssetId, altText: entry?.name ?? "Battle map", camera: { center: { x: geometry.width / 2, y: geometry.height / 2 }, zoom: 1 } });
    } catch {
      for (const socket of io.sockets.sockets.values()) if (auth.verify(socket.handshake.auth?.token)) socket.emit("system:error", "The scene is live, but the shared screen could not switch to its map. Present it from the Viewer tab.");
    }
  }

  // The shared game capabilities: the Socket.IO handlers below and the public HTTP API both run
  // these exact operations - same validation, authorization, dispatch, and narration (ADR-0016).
  const operations = createGameOperations({
    store,
    combatLog,
    contentLibrary,
    mapCatalog,
    tokenCatalog,
    tokenGeometryFor,
    publishGameState,
    presentSceneMap,
    broadcastTableEvent,
    appendLog,
    logTurnBegin,
    logTimelineOutcome,
    scheduleAnnotationExpiry,
    gmView: (state) => gmView(state),
    playerView: (state, sessionId) => projectPlayerView(state, sessionId, presenceFor),
    random: (sides) => randomInt(1, sides + 1),
    newId: randomUUID
  });
  const commandRegistry = gameCommandRegistry(operations);

  // Raised from the express default (100kb) so canonical ActorDefinition imports (capped at 256kb
  // by the operation itself) fit through the HTTP surface too.
  app.use(express.json({ limit: "512kb" }));
  // Open CORS for the VERSIONED integration surface only: every /api/v1 credential travels as a
  // bearer header (or a SameSite=Strict cookie the browser refuses to send cross-origin anyway),
  // so a wildcard origin grants nothing a token doesn't already grant - and it lets browser-based
  // integrations (overlays, dashboards) call the documented surface directly. The legacy
  // /api/gm/* session endpoints - password login above all - deliberately stay same-origin:
  // wildcard CORS there would let any web page relay password guesses through a LAN browser.
  app.use((req, res, next) => {
    if (req.path !== "/api/v1" && !req.path.startsWith("/api/v1/")) return next();
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "authorization, content-type, x-request-id, if-none-match");
    res.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("access-control-expose-headers", "x-request-id, etag, retry-after");
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });
  // Malformed/oversized JSON bodies die inside express.json before any route runs; give /api/v1
  // callers the stable error envelope instead of Express's HTML default.
  app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!error || res.headersSent || !(req.path === "/api/v1" || req.path.startsWith("/api/v1/"))) return next(error as Error);
    const tooLarge = (error as { type?: string }).type === "entity.too.large";
    return res.status(tooLarge ? 413 : 400).json({
      ok: false,
      apiVersion: API_VERSION,
      error: { code: tooLarge ? "bad_request" : "validation_failed", message: tooLarge ? "The request body is too large." : "The request body is not valid JSON.", requestId: randomUUID() }
    });
  });
  app.get("/api/health", (_req, res) => res.json({ ok: true, bootstrapped: auth.isBootstrapped }));
  app.get("/api/bootstrap/status", (_req, res) => res.json({ bootstrapped: auth.isBootstrapped }));
  app.post("/api/bootstrap", async (req, res) => {
    if (!isLoopback(req.ip)) return res.status(403).json({ message: "Initial GM setup must be performed on the host machine." });
    const result = z.object({ password: z.string().min(12).max(256) }).safeParse(req.body);
    if (!result.success) return res.status(400).json({ message: "Use a GM password of at least 12 characters." });
    try { await auth.bootstrap(result.data.password); return res.status(201).json({ ok: true }); } catch (error) { return res.status(409).json({ message: (error as Error).message }); }
  });
  app.post("/api/gm/login", async (req, res) => {
    const rateLimitKey = req.ip ?? "unknown";
    const decision = gmLoginRateLimiter.check(rateLimitKey);
    if (!decision.allowed) {
      res.set("Retry-After", String(decision.retryAfterSeconds));
      return res.status(429).json({ message: "Too many attempts. Try again later." });
    }
    const result = z.object({ password: z.string() }).safeParse(req.body);
    if (!result.success) { gmLoginRateLimiter.recordFailure(rateLimitKey); return res.status(400).json({ message: "Password is required." }); }
    const token = await auth.login(result.data.password);
    if (!token) { gmLoginRateLimiter.recordFailure(rateLimitKey); return res.status(401).json({ message: "Invalid GM password." }); }
    gmLoginRateLimiter.recordSuccess(rateLimitKey);
    return res.json({ token });
  });
  app.post("/api/gm/logout", async (req, res) => {
    const token = req.header("authorization")?.replace("Bearer ", "");
    const revoked = await auth.logout(token);
    if (!revoked) return res.status(401).json({ message: "A valid GM session is required to sign out." });
    broadcast();
    return res.json({ ok: true });
  });
  app.post("/api/gm/sessions/revoke-all", async (req, res) => {
    const token = req.header("authorization")?.replace("Bearer ", "");
    if (!auth.verify(token)) return res.status(401).json({ message: "A valid GM session is required." });
    await auth.revokeAllGmSessions();
    broadcast();
    return res.json({ ok: true });
  });
  app.get("/api/state", (req, res) => {
    const token = req.header("authorization")?.replace("Bearer ", "");
    const state = store.snapshot;
    res.json(auth.verify(token) ? gmView(state) : projectPlayerView(state, auth.verifyPlayer(token)?.sessionId, presenceFor));
  });
  app.get("/api/gm/viewer-urls", (req, res) => {
    const token = req.header("authorization")?.replace("Bearer ", "");
    if (!auth.verify(token)) return res.status(401).json({ message: "A valid GM session is required." });
    const viewerUrls = [...new Set((options.viewerBaseUrls ?? []).map((url) => `${url.replace(/\/$/, "")}/viewer.html`))];
    return res.json({ viewerUrls });
  });
  // Encounter archives (#12): permanent, machine-readable turn-by-turn records auto-saved at encounter
  // end. GM-only - a document holds full state (hidden combatants) and GM-only log lines. The shape is
  // documented in encounter-archive.ts; consumers list, fetch, and delete over these endpoints.
  app.get("/api/gm/encounters", (req, res) => {
    const token = req.header("authorization")?.replace("Bearer ", "");
    if (!auth.verify(token)) return res.status(401).json({ message: "A valid GM session is required." });
    return res.json({ encounters: store.listEncounterArchives() });
  });
  app.get("/api/gm/encounters/:id", (req, res) => {
    const token = req.header("authorization")?.replace("Bearer ", "");
    if (!auth.verify(token)) return res.status(401).json({ message: "A valid GM session is required." });
    const id = Number(req.params.id);
    const document = Number.isInteger(id) ? store.getEncounterArchive(id) : null;
    if (document === null) return res.status(404).json({ message: "No such encounter archive." });
    return res.type("application/json").send(document); // raw stored JSON - no re-serialization
  });
  app.delete("/api/gm/encounters/:id", (req, res) => {
    const token = req.header("authorization")?.replace("Bearer ", "");
    if (!auth.verify(token)) return res.status(401).json({ message: "A valid GM session is required." });
    const id = Number(req.params.id);
    if (Number.isInteger(id)) store.deleteEncounterArchive(id);
    return res.json({ ok: true });
  });
  app.use(createViewerRouter({ access: viewerAccess, presentation: viewerPresentation, coordinator: viewerCoordinator, authorizeGm }));
  app.use(createMapRouter({
    assets: mapAssets,
    catalog: mapCatalog,
    authorizeGm,
    authorizePlayer: (token, assetId) => {
      const combat = store.snapshot.combat;
      return auth.verifyPlayer(token) !== null && combat.active && combat.mapAssetId === assetId;
    },
    authorizeViewer: (token, assetId) => {
      if (!token) return false;
      try {
        viewerAccess.verify(token);
        const presentation = viewerPresentation.project();
        return presentation.enabled && presentation.activeMap?.assetId === assetId;
      } catch { return false; }
    }
  }));
  app.use(createTokenRouter({
    assets: tokenAssets,
    catalog: tokenCatalog,
    authorizeGm,
    authorizePlayer: (token, assetId) => auth.verifyPlayer(token) !== null && store.snapshot.actors.some((actor) => actor.visibility === "public" && actor.tokenAssetId === assetId),
    authorizeViewer: (token, assetId) => {
      if (!token) return false;
      try { viewerAccess.verify(token); return viewerPresentation.project().enabled && store.snapshot.actors.some((actor) => actor.visibility === "public" && actor.tokenAssetId === assetId); }
      catch { return false; }
    }
  }));
  const gameApiRouter = createGameApiRouter({
    operations,
    registry: commandRegistry,
    gmSession: (token) => auth.verify(token),
    playerSession: (token) => auth.verifyPlayer(token),
    verifyIntegration: (token, scope) => credentials.verify(token, scope),
    archives: {
      list: () => store.listEncounterArchives(),
      get: (id) => store.getEncounterArchive(id),
      remove: (id) => store.deleteEncounterArchive(id)
    },
    sessions: {
      // The HTTP mirror of the socket's open LAN-trust join: anyone who can reach the host may
      // take a player seat once GM setup is complete - same rule as session:join below.
      issuePlayer: () => {
        if (!auth.isBootstrapped) return null;
        const token = auth.issuePlayerSession();
        return { token, sessionId: auth.verifyPlayer(token)!.sessionId };
      }
    },
    revision: () => store.revision,
    newId: randomUUID
  });
  const apiV1Router = createApiV1Router({
    applicationVersion: options.applicationVersion ?? "0.1.0",
    actorDefinitionVersion: ACTOR_DEFINITION_SCHEMA_VERSION,
    authorizeIntegration: (token, requiredScope) => credentials.verify(token, requiredScope) !== null,
    authorizeGm,
    credentialStore: credentials,
    gameRouter: gameApiRouter
  });
  // The versioned router owns its own API-only 404 envelope. Keep that catch-all
  // scoped to /api/v1 so it cannot swallow the SPA or the dedicated TV viewer.
  app.use((req, res, next) => req.path === "/api/v1" || req.path.startsWith("/api/v1/")
    ? apiV1Router(req, res, next)
    : next());
  app.use("/api", (_req, res) => res.status(404).json({ message: "API route not found." }));
  if (!options.useDevelopmentClient) {
    app.get("/viewer", (_req, res) => res.redirect(307, "/viewer.html"));
    // `dotfiles: "allow"` and serving index.html root-relative both matter on hosts whose install
    // path contains a dot-segment (e.g. OneDrive's `.DesktopOneDrive`): `send` defaults to
    // `dotfiles: "ignore"`, which 404s any *absolute* path containing a dot-segment - so the SPA
    // fallback below must pass a root and a clean relative filename, not the full absolute path.
    app.use(express.static(options.webDist, { dotfiles: "allow" }));
    app.get("/{*path}", (_req, res) => res.sendFile("index.html", { root: options.webDist, dotfiles: "allow" }));
  } else {
    app.get("/viewer", (req, res) => res.redirect(307, developmentClientUrl(req.hostname, "/viewer.html", options.developmentClientPort)));
    app.get("/{*path}", (req, res) => res.redirect(307, developmentClientUrl(req.hostname, req.originalUrl, options.developmentClientPort)));
  }

  io.on("connection", (socket) => {
    let joinedSession: { sessionId: string; role: ClientRole } | null = null;
    socket.on("session:join", ({ token }, acknowledge) => {
      socket.handshake.auth.token = token;
      const gm = auth.verify(token);
      if (gm) {
        joinedSession = { sessionId: gm.sessionId, role: "gm" };
        presence.connect(gm.sessionId, "gm");
        acknowledge({ ok: true, role: "gm", sessionId: gm.sessionId });
        broadcast();
        return;
      }
      const existingPlayer = auth.verifyPlayer(token);
      if (existingPlayer) {
        joinedSession = { sessionId: existingPlayer.sessionId, role: "player" };
        presence.connect(existingPlayer.sessionId, "player");
        acknowledge({ ok: true, role: "player", sessionId: existingPlayer.sessionId, token });
        broadcast();
        return;
      }
      if (!auth.isBootstrapped) return acknowledge({ ok: false, message: "The host must complete GM setup before players join." });
      const playerToken = auth.issuePlayerSession();
      socket.handshake.auth.token = playerToken;
      const player = auth.verifyPlayer(playerToken)!;
      joinedSession = { sessionId: player.sessionId, role: "player" };
      presence.connect(player.sessionId, "player");
      acknowledge({ ok: true, role: "player", sessionId: player.sessionId, token: playerToken });
      broadcast();
    });
    socket.on("disconnect", () => {
      if (!joinedSession) return;
      const token = socket.handshake.auth?.token;
      const stillValid = joinedSession.role === "gm" ? auth.verify(token) : auth.verifyPlayer(token);
      presence.disconnect(joinedSession.sessionId, !stillValid);
      broadcast();
    });
    /** The caller's identity, re-verified per command from the signed token (never cached across commands). */
    const principalOf = (): GamePrincipal | null => {
      const token = socket.handshake.auth?.token;
      const gm = auth.verify(token);
      if (gm) return { kind: "gm", sessionId: gm.sessionId };
      const player = auth.verifyPlayer(token);
      return player ? { kind: "player", sessionId: player.sessionId } : null;
    };
    /**
     * Socket adapter over the shared operations: resolve the principal (or refuse with this
     * command's historical join/role message), run the operation, and translate outcomes back to
     * the ack wire shape - including the timeline-confirmation bounce, which is an ok:true ack.
     */
    const respond = async <Result extends { ok: boolean }>(
      acknowledge: (result: Result) => void,
      unauthenticatedMessage: string,
      fallbackMessage: string,
      work: (principal: GamePrincipal) => Promise<Record<string, unknown>> | Record<string, unknown>
    ) => {
      const principal = principalOf();
      if (!principal) return acknowledge({ ok: false, message: unauthenticatedMessage } as unknown as Result);
      try {
        acknowledge({ ok: true, ...(await work(principal)) } as unknown as Result);
      } catch (error) {
        if (error instanceof TimelineConfirmationRequired) return acknowledge({ ok: true, needsConfirm: error.confirm, message: error.message } as unknown as Result);
        // A rules-mode rejection carries machine-readable details so the client can offer the
        // one-tap audited override instead of parsing prose (ADR-0020).
        if (error instanceof RulesBlockedError) return acknowledge({ ok: false, message: error.message, blocked: { rule: error.rule, message: error.message, overridable: error.overridable } } as unknown as Result);
        acknowledge({ ok: false, message: error instanceof Error ? error.message : fallbackMessage } as unknown as Result);
      }
    };
    socket.on("character:claim", (payload, acknowledge) => respond(acknowledge, "Join a session first.", "The character claim failed.", (principal) => operations.characterClaim(principal, payload)));
    socket.on("character:release", (payload, acknowledge) => respond(acknowledge, "Join a session first.", "The character release failed.", (principal) => operations.characterRelease(principal, payload)));
    socket.on("character:force-release", (payload, acknowledge) => respond(acknowledge, "Only the GM can force-release a character.", "The character force-release failed.", (principal) => operations.characterForceRelease(principal, payload)));
    socket.on("content:monsters", (_payload, acknowledge) => respond(acknowledge, "Only the GM can browse bundled content.", "The bundled content is unavailable.", (principal) => operations.contentMonsters(principal)));
    socket.on("actor:add-from-definition", (payload, acknowledge) => respond(acknowledge, "Only the GM can add combatants.", "The combatant could not be added.", (principal) => operations.actorAddFromDefinition(principal, payload)));
    socket.on("actor:import-definition", (payload, acknowledge) => respond(acknowledge, "Only the GM can import sheets.", "The sheet could not be imported.", (principal) => operations.actorImportDefinition(principal, payload)));
    socket.on("actor:remove", (payload, acknowledge) => respond(acknowledge, "Only the GM can remove combatants.", "The combatant could not be removed.", (principal) => operations.actorRemove(principal, payload)));
    socket.on("actor:set-token-image", (payload, acknowledge) => respond(acknowledge, "Only the GM can set token images.", "The token image could not be set.", (principal) => operations.actorSetTokenImage(principal, payload)));
    socket.on("actor:set-size", (payload, acknowledge) => respond(acknowledge, "Only the GM can resize tokens.", "The token could not be resized.", (principal) => operations.actorSetSize(principal, payload)));
    socket.on("actor:set-visibility", (payload, acknowledge) => respond(acknowledge, "Only the GM can change token visibility.", "The token visibility could not be changed.", (principal) => operations.actorSetVisibility(principal, payload)));
    socket.on("actor:set-speed", (payload, acknowledge) => respond(acknowledge, "Only the GM can set movement speed.", "The speed could not be set.", (principal) => operations.actorSetSpeed(principal, payload)));
    socket.on("actor:apply-damage", (payload, acknowledge) => respond(acknowledge, "Join the table before tracking hit points.", "The damage could not be applied.", (principal) => operations.actorApplyDamage(principal, payload)));
    socket.on("actor:heal", (payload, acknowledge) => respond(acknowledge, "Join the table before tracking hit points.", "The healing could not be applied.", (principal) => operations.actorHeal(principal, payload)));
    socket.on("actor:set-temp-hp", (payload, acknowledge) => respond(acknowledge, "Join the table before tracking hit points.", "The temporary hit points could not be set.", (principal) => operations.actorSetTempHp(principal, payload)));
    socket.on("content:conditions", (_payload, acknowledge) => respond(acknowledge, "Join the table before browsing reference content.", "The reference content is unavailable.", (principal) => operations.contentConditions(principal)));
    socket.on("content:spells", (_payload, acknowledge) => respond(acknowledge, "Join the table before browsing reference content.", "The reference content is unavailable.", (principal) => operations.contentSpells(principal)));
    socket.on("actor:set-condition", (payload, acknowledge) => respond(acknowledge, "Join the table before tracking conditions.", "The condition could not be updated.", (principal) => operations.actorSetCondition(principal, payload)));
    socket.on("content:monster-actions", (payload, acknowledge) => respond(acknowledge, "Only the GM can browse stat blocks.", "The stat block is unavailable.", (principal) => operations.contentMonsterActions(principal, payload)));
    socket.on("content:monster-sheet", (payload, acknowledge) => respond(acknowledge, "Only the GM can read stat blocks.", "The stat block is unavailable.", (principal) => operations.contentMonsterSheet(principal, payload)));
    socket.on("action:resolve", (payload, acknowledge) => respond(acknowledge, "Only the GM can resolve stat-block actions.", "The action could not be resolved.", (principal) => operations.actionResolve(principal, payload)));
    socket.on("save:answer", (payload, acknowledge) => respond(acknowledge, "Join the table before answering saving throws.", "The saving throw could not be answered.", (principal) => operations.saveAnswer(principal, payload)));
    socket.on("save:dismiss", (payload, acknowledge) => respond(acknowledge, "Join the table before managing saving throws.", "The saving throw could not be dismissed.", (principal) => operations.saveDismiss(principal, payload)));
    socket.on("reaction:answer", (payload, acknowledge) => respond(acknowledge, "Join the table before answering reactions.", "The reaction could not be answered.", (principal) => operations.reactionAnswer(principal, payload)));
    socket.on("reaction:dismiss", (payload, acknowledge) => respond(acknowledge, "Join the table before managing reactions.", "The reaction prompt could not be dismissed.", (principal) => operations.reactionDismiss(principal, payload)));
    socket.on("actor:available-actions", (payload, acknowledge) => respond(acknowledge, "Join the table before checking actions.", "The action availability is unavailable.", (principal) => operations.actorAvailableActions(principal, payload)));
    socket.on("effect:add", (payload, acknowledge) => respond(acknowledge, "Only the GM can add effects.", "The effect could not be added.", (principal) => operations.effectAdd(principal, payload)));
    socket.on("effect:end", (payload, acknowledge) => respond(acknowledge, "Join the table before managing effects.", "The effect could not be ended.", (principal) => operations.effectEnd(principal, payload)));
    socket.on("death-save:roll", (payload, acknowledge) => respond(acknowledge, "Join the table before rolling death saves.", "The death save failed.", (principal) => operations.deathSaveRoll(principal, payload)));
    socket.on("encounter:set-rules-mode", (payload, acknowledge) => respond(acknowledge, "Only the GM can change the rules mode.", "The rules mode could not be changed.", (principal) => operations.encounterSetRulesMode(principal, payload)));
    socket.on("encounter:set-roll-mode", (payload, acknowledge) => respond(acknowledge, "Only the GM can change the roll mode.", "The roll mode could not be changed.", (principal) => operations.encounterSetRollMode(principal, payload)));
    socket.on("encounter:set-health-display", (payload, acknowledge) => respond(acknowledge, "Only the GM can change how health is shown.", "The health display could not be changed.", (principal) => operations.encounterSetHealthDisplay(principal, payload)));
    socket.on("actor:set-health-display", (payload, acknowledge) => respond(acknowledge, "Only the GM can change how health is shown.", "The health display could not be changed.", (principal) => operations.actorSetHealthDisplay(principal, payload)));
    socket.on("encounter:set-environment", (payload, acknowledge) => respond(acknowledge, "Only the GM can change the encounter environment.", "The environment could not be changed.", (principal) => operations.encounterSetEnvironment(principal, payload)));
    socket.on("actor:rest", (payload, acknowledge) => respond(acknowledge, "Only the GM can apply a rest.", "The rest could not be applied.", (principal) => operations.actorRest(principal, payload)));
    socket.on("actor:spend-hit-dice", (payload, acknowledge) => respond(acknowledge, "Join the table before spending Hit Dice.", "The Hit Dice could not be spent.", (principal) => operations.actorSpendHitDice(principal, payload)));
    socket.on("character:set-slot", (payload, acknowledge) => respond(acknowledge, "Join the table before managing spell slots.", "The spell slot could not be updated.", (principal) => operations.characterSetSlot(principal, payload)));
    socket.on("character:set-prepared", (payload, acknowledge) => respond(acknowledge, "Join the table before preparing spells.", "The prepared spell could not be updated.", (principal) => operations.characterSetPrepared(principal, payload)));
    socket.on("character:set-inventory", (payload, acknowledge) => respond(acknowledge, "Join the table before managing inventory.", "The inventory could not be updated.", (principal) => operations.characterSetInventory(principal, payload)));
    socket.on("character:set-currency", (payload, acknowledge) => respond(acknowledge, "Join the table before managing currency.", "The currency could not be updated.", (principal) => operations.characterSetCurrency(principal, payload)));
    socket.on("turn:use", (payload, acknowledge) => respond(acknowledge, "Join the table before tracking turns.", "The turn could not be updated.", (principal) => operations.turnUse(principal, payload)));
    socket.on("turn:use-reaction", (payload, acknowledge) => respond(acknowledge, "Join the table before tracking turns.", "The reaction could not be updated.", (principal) => operations.turnUseReaction(principal, payload)));
    socket.on("turn:use-legendary", (payload, acknowledge) => respond(acknowledge, "Join the table before tracking turns.", "The legendary actions could not be updated.", (principal) => operations.turnUseLegendary(principal, payload)));
    socket.on("turn:end", (payload, acknowledge) => respond(acknowledge, "Join the table before ending a turn.", "The turn could not end.", (principal) => operations.turnEnd(principal, payload)));
    socket.on("actor:set-hp", (payload, acknowledge) => respond(acknowledge, "Only the GM can set hit points directly.", "The hit points could not be set.", (principal) => operations.actorSetHp(principal, payload)));
    socket.on("dice:roll", (payload, acknowledge) => respond(acknowledge, "Join a session before rolling.", "The roll failed.", (principal) => operations.diceRoll(principal, payload)));
    socket.on("encounter:start", (payload, acknowledge) => respond(acknowledge, "Only the GM can start an encounter.", "The encounter could not start.", (principal) => operations.encounterStart(principal, payload)));
    socket.on("encounter:end", (payload, acknowledge) => respond(acknowledge, "Only the GM can end an encounter.", "The encounter could not end.", (principal) => operations.encounterEnd(principal, payload)));
    socket.on("encounter:add-combatant", (payload, acknowledge) => respond(acknowledge, "Only the GM can add a combatant.", "The combatant could not be added.", (principal) => operations.encounterAddCombatant(principal, payload)));
    socket.on("initiative:set", (payload, acknowledge) => respond(acknowledge, "Only the GM can change Initiative.", "Initiative could not be updated.", (principal) => operations.initiativeSet(principal, payload)));
    socket.on("initiative:next", (payload, acknowledge) => respond(acknowledge, "Only the GM can advance Initiative.", "Initiative could not advance.", (principal) => operations.initiativeNext(principal, payload)));
    socket.on("initiative:previous", (payload, acknowledge) => respond(acknowledge, "Only the GM can move Initiative backward.", "Initiative could not move backward.", (principal) => operations.initiativePrevious(principal, payload)));
    socket.on("log:read", (_payload, acknowledge) => respond(acknowledge, "Join the table to read the combat log.", "The combat log is unavailable.", (principal) => ({ entries: operations.logEntries(principal) })));
    socket.on("token:move", (payload, acknowledge) => respond(acknowledge, "Join a session before moving tokens.", "The token could not be moved.", (principal) => operations.tokenMove(principal, payload)));
    socket.on("scene:create", (payload, acknowledge) => respond(acknowledge, "Only the GM can prepare scenes.", "The scene could not be created.", (principal) => operations.sceneCreate(principal, payload)));
    socket.on("scene:rename", (payload, acknowledge) => respond(acknowledge, "Only the GM can rename scenes.", "The scene could not be renamed.", (principal) => operations.sceneRename(principal, payload)));
    socket.on("scene:remove", (payload, acknowledge) => respond(acknowledge, "Only the GM can remove scenes.", "The scene could not be removed.", (principal) => operations.sceneRemove(principal, payload)));
    socket.on("scene:activate", (payload, acknowledge) => respond(acknowledge, "Only the GM can switch scenes.", "The scene could not be switched.", (principal) => operations.sceneActivate(principal, payload)));
    socket.on("scene:set-combatants", (payload, acknowledge) => respond(acknowledge, "Only the GM can change a scene's combatants.", "The scene could not be updated.", (principal) => operations.sceneSetCombatants(principal, payload)));
    socket.on("scene:duplicate", (payload, acknowledge) => respond(acknowledge, "Only the GM can duplicate scenes.", "The scene could not be duplicated.", (principal) => operations.sceneDuplicate(principal, payload)));
    socket.on("scene:reorder", (payload, acknowledge) => respond(acknowledge, "Only the GM can reorder scenes.", "The scenes could not be reordered.", (principal) => operations.sceneReorder(principal, payload)));
    socket.on("fog:set-enabled", (payload, acknowledge) => respond(acknowledge, "Only the GM controls the fog of war.", "The fog could not be updated.", (principal) => operations.fogSetEnabled(principal, payload)));
    socket.on("fog:paint", (payload, acknowledge) => respond(acknowledge, "Only the GM controls the fog of war.", "The fog stroke could not be painted.", (principal) => operations.fogPaint(principal, payload)));
    socket.on("fog:reset", (payload, acknowledge) => respond(acknowledge, "Only the GM controls the fog of war.", "The fog could not be reset.", (principal) => operations.fogReset(principal, payload)));
    socket.on("annotation:add", (payload, acknowledge) => respond(acknowledge, "Join a session before adding to the map.", "That could not be added to the map.", (principal) => operations.annotationAdd(principal, payload)));
    socket.on("annotation:ping", (payload, acknowledge) => respond(acknowledge, "Join a session before pinging the map.", "The ping could not be sent.", (principal) => operations.annotationPing(principal, payload)));
    socket.on("annotation:set-color", (payload, acknowledge) => respond(acknowledge, "Join a session before editing the map.", "The color could not be changed.", (principal) => operations.annotationSetColor(principal, payload)));
    socket.on("annotation:move", (payload, acknowledge) => respond(acknowledge, "Join a session before editing the map.", "That could not be moved.", (principal) => operations.annotationMove(principal, payload)));
    socket.on("annotation:remove", (payload, acknowledge) => respond(acknowledge, "Join a session before editing the map.", "That could not be removed.", (principal) => operations.annotationRemove(principal, payload)));
    socket.on("annotation:set-visibility", (payload, acknowledge) => respond(acknowledge, "Join a session before editing the map.", "The visibility could not be changed.", (principal) => operations.annotationSetVisibility(principal, payload)));
    socket.on("annotation:set-movable", (payload, acknowledge) => respond(acknowledge, "Join a session before editing the map.", "Move control could not be changed.", (principal) => operations.annotationSetMovable(principal, payload)));
    socket.on("annotation:clear", (payload, acknowledge) => respond(acknowledge, "Join a session before editing the map.", "Shapes could not be removed.", (principal) => operations.annotationClear(principal, payload)));
    socket.emit("state:updated", projectPlayerView(store.snapshot, auth.verifyPlayer(socket.handshake.auth.token)?.sessionId, presenceFor));
  });

  async function initialize() {
    await Promise.all([auth.initialize(), store.initialize(), combatLog.initialize(), credentials.initialize(), mapAssets.initialize(), mapCatalog.initialize(), tokenAssets.initialize(), tokenCatalog.initialize(), viewerAccess.initialize(), viewerPresentation.initialize()]);
    const persisted = store.snapshot;
    if (persisted.combat.active && persisted.combat.mapAssetId && persisted.combat.initiative.some((entry) => !persisted.combat.tokens.some((token) => token.actorId === entry.actorId))) {
      try {
        const geometry = await tokenGeometryFor(persisted.combat.mapAssetId);
        await store.execute({ id: `encounter.tokens.prepare:${persisted.revision}`, type: "encounter.tokens.prepare", principal: "system:startup" }, (state) => { ensureEncounterTokens(state, geometry); });
      } catch { /* Preserve startup for an old encounter whose map asset was removed; the GM can end it and start a new encounter. */ }
    }
    // Bind a pre-scenes encounter/map to one implicit active scene so park-and-resume has a home.
    const beforeScenes = store.snapshot;
    if (beforeScenes.combat.scenes.length === 0 && beforeScenes.combat.mapAssetId !== null) {
      await store.execute({ id: `scene.migrate:${beforeScenes.revision}`, type: "scene.migrate", principal: "system:startup" }, (state) => migrateToScene(state, randomUUID()));
    }
    await viewerCoordinator.synchronizeEncounter(store.snapshot.revision, projectViewerEncounter(store.snapshot));
  }
  function close() { presence.dispose(); viewerCoordinator.dispose(); for (const timer of annotationExpiryTimers) clearTimeout(timer); annotationExpiryTimers.clear(); io.close(); store.close(); combatLog.close(); credentials.close(); mapCatalog.close(); tokenCatalog.close(); viewerAccess.close(); viewerPresentation.close(); }

  return { app, httpServer, io, auth, store, credentials, presence, mapAssets, mapCatalog, viewerAccess, viewerPresentation, viewerCoordinator, initialize, close };
}
