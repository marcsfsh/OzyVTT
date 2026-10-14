import { createServer as createHttpServer } from "node:http";
import { randomInt, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import express, { type Express } from "express";
import { Server } from "socket.io";
import { z } from "zod";
import { API_VERSION, CODEX_PATHS } from "@vtt/api-contract";
import type { ClientToServerEvents, ClientRole, CombatLogEntry, GameState, RollRecord, ServerToClientEvents, TableEvent } from "@vtt/domain";
import { ACTOR_DEFINITION_SCHEMA_VERSION } from "@vtt/schemas";
import { nextAnnotationExpiry } from "./annotations.js";
import { createApiV1Router } from "./api-v1.js";
import { ContentLibrary } from "./content-library.js";
import { AuthService } from "./auth.js";
import { developmentClientUrl } from "./client-hosting.js";
import { migrateToScene } from "./scenes.js";
import { CombatLogStore, projectFeedRow } from "./combat-log.js";
import { timelineDirtied, type TimelineOutcome } from "./combat-history.js";
import { createGameApiRouter } from "./game-http.js";
import { createGameOperations, gameCommandRegistry, type GamePrincipal } from "./game-operations.js";
import { CommandRejectedError, GameStore, RulesBlockedError, TimelineConfirmationRequired } from "./game-store.js";
import { CodexStore } from "./codex-store.js";
import { createCodexImportGuard, createCodexRouter } from "./codex-http.js";
import { HomebrewStore } from "./homebrew-store.js";
import { createHomebrewRouter, homebrewPackBodyParser, HOMEBREW_PACK_IMPORT_PATH } from "./homebrew-http.js";
import { createHomebrewValidator } from "./homebrew-validate.js";
import { buildHomebrewUsageIndex } from "./homebrew-usages.js";
import { findCatalogRecord } from "./homebrew-srd-copy.js";
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
import { playerReplayMapAssetIds } from "./replay-projection.js";
import type { EncounterArchiveDocument } from "./encounter-archive.js";
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
  /** How long a session stays "reconnecting" after its last connection drops before going "offline". */
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
  const codexStore = new CodexStore(options.databasePath);
  const codexAssets = new MapAssetStore(join(dirname(options.databasePath), "codex-assets"), { maxBytes: 10 * 1024 * 1024, maxDimensionPx: 4096, maxPixels: 4096 * 4096 });
  const homebrewStore = new HomebrewStore(options.databasePath);
  // `publishedFor(audience)` gives `ContentLibrary` only published (and, for players, player-visible)
  // records; drafts are in neither slice.
  const contentLibrary = new ContentLibrary(homebrewStore);
  const authorizeGm = (token: string | undefined) => auth.verify(token) !== null;
  // The codex authorization callbacks, shared by `createCodexRouter` and the `POST /codex/import` guard
  // so "who may write the codex" has one definition.
  const codexAuth = {
    authorizeGm,
    authorizePlayer: (token: string | undefined) => auth.verifyPlayer(token) !== null,
    // Same credential store as the game router. A codex credential acts at GM grade; scope decides
    // read vs write, and `admin` implies both.
    verifyIntegration: (token: string, scope: "codex:read" | "codex:write") => credentials.verify(token, scope)
  };
  const viewerCoordinator = new ViewerCoordinator(viewerAccess, viewerPresentation, authorizeGm);
  const gmLoginRateLimiter = new LoginRateLimiter();
  const presence = new PresenceRegistry(options.presenceGraceMs ?? 8000, () => broadcast());
  const presenceFor = (sessionId: string) => presence.statusFor(sessionId);
  const annotationExpiryTimers = new Set<ReturnType<typeof setTimeout>>();
  /** Re-publishes at the soonest annotation expiry: the projection hides expired annotations, but nothing
   *  else re-broadcasts once the timestamp passes. Re-publishing also clears it from the shared screen. */
  function scheduleAnnotationExpiry() {
    // One pending timer, re-armed from the callback so staggered annotations each expire on time.
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

  /** GM view plus the time-travel timeline (labels can name hidden combatants, so this is GM-only). */
  function gmView(state: GameState, now = Date.now()) { return { ...projectGmView(state, presenceFor, now), turnHistory: store.listTurnSnapshots() }; }
  /** Also reauthorizes every connected socket, so a revoked GM client is downgraded or disconnected promptly. */
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
  /** Tells every client the codex changed so it refetches its own projected view. Content-free (only a
   *  revision): naming the changed scope would leak what the GM is working on. */
  function notifyCodexChanged() {
    io.emit("codex:changed", { codexRevision: codexStore.revision });
  }
  /** Tells every client the homebrew library changed so it refetches its own merged catalog. Content-free
   *  (only a revision), so players learn nothing about what the GM is working on. */
  function notifyHomebrewChanged() {
    io.emit("homebrew:changed", { revision: homebrewStore.revision });
  }
  // Homebrew usage lookup, memoised for one microtask: the library list asks per row and every
  // `store.snapshot` clones the campaign. Gone before the next request, so never stale.
  let usageIndex: ReturnType<typeof buildHomebrewUsageIndex> | undefined;
  const homebrewUsagesFor = (type: Parameters<ReturnType<typeof buildHomebrewUsageIndex>["of"]>[0], id: string) => {
    if (!usageIndex) {
      usageIndex = buildHomebrewUsageIndex(store.snapshot);
      queueMicrotask(() => { usageIndex = undefined; });
    }
    return usageIndex.of(type, id);
  };
  /** Emits a transient toast. Players receive it only when it isn't GM-only and every referenced actor is
   *  public. Not stored; the viewer gets nothing. */
  function broadcastTableEvent(event: Readonly<{ kind: TableEvent["kind"]; text: string; actorIds?: readonly string[]; gmOnly?: boolean; logged?: boolean }>) {
    const state = store.snapshot;
    const actorIds = event.actorIds ?? [];
    const publicToPlayers = !event.gmOnly && actorIds.every((id) => state.actors.find((actor) => actor.id === id)?.visibility === "public");
    const payload: TableEvent = { id: randomUUID(), kind: event.kind, text: event.text, actorIds, at: Date.now() };
    for (const socket of io.sockets.sockets.values()) {
      const token = socket.handshake.auth?.token;
      if (auth.verify(token)) socket.emit("table:event", payload);
      else if (publicToPlayers && auth.verifyPlayer(token)) socket.emit("table:event", payload);
    }
    // Every toast is also a feed line, gated the same way, unless the caller writes a richer row itself
    // (`logged: false`). Call `appendLog` directly only for lines with no toast.
    if (event.logged !== false) appendLog({ kind: event.kind, text: event.text, actorIds, gmOnly: event.gmOnly });
  }
  /** Appends a feed line and pushes it live, gated like toasts. `!== "public"` so an actor no longer on the
   *  roster (or a future visibility) fails closed. */
  function appendLog(entry: Readonly<{ kind: CombatLogEntry["kind"]; text: string; actorIds?: readonly string[]; gmOnly?: boolean; actorId?: string | null; roll?: RollRecord | null }>) {
    const state = store.snapshot;
    const actorIds = entry.actorIds ?? [];
    const gmOnly = entry.gmOnly === true || actorIds.some((id) => state.actors.find((actor) => actor.id === id)?.visibility !== "public");
    const row = combatLog.append({ kind: entry.kind, text: entry.text, gmOnly, revision: state.revision, actorId: entry.actorId ?? null, roll: entry.roll ?? null });
    // Per-recipient delivery: a `self-only` roll belongs to one player, unlocked by their session id.
    // `projectFeedRow` decides and strips the roller's session id. The public viewer has no game socket.
    for (const socket of io.sockets.sockets.values()) {
      const token = socket.handshake.auth?.token;
      if (auth.verify(token)) { socket.emit("log:entry", row.entry); continue; }
      const player = auth.verifyPlayer(token);
      if (!player) continue;
      const projected = projectFeedRow(row, { gm: false, sessionId: player.sessionId });
      if (projected) socket.emit("log:entry", projected);
    }
  }
  /** "Round 3 - Borin's turn." A hidden combatant's turn stays GM-only (its name would otherwise leak). */
  function logTurnBegin(state: GameState) {
    if (state.combat.turnActorId === null) return;
    const name = state.actors.find((actor) => actor.id === state.combat.turnActorId)?.name ?? "A combatant";
    appendLog({ kind: "turn", text: `Round ${state.combat.round} - ${name}'s turn.`, actorIds: [state.combat.turnActorId] });
  }
  /** Turns a timeline navigation outcome into log lines: plain turns for forward play, GM-only notes for rewinds. */
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
  /** Presents a newly-live scene's map on the shared screen. Best-effort: a viewer failure must not undo the committed scene switch. */
  async function presentSceneMap(mapAssetId: string) {
    try {
      const geometry = await tokenGeometryFor(mapAssetId);
      const entry = mapCatalog.get(mapAssetId);
      await viewerCoordinator.presentMap(store.snapshot.revision, { assetId: mapAssetId, altText: entry?.name ?? "Battle map", camera: { center: { x: geometry.width / 2, y: geometry.height / 2 }, zoom: 1 } });
    } catch {
      for (const socket of io.sockets.sockets.values()) if (auth.verify(socket.handshake.auth?.token)) socket.emit("system:error", "The scene is live, but the shared screen could not switch to its map. Present it from the Viewer tab.");
    }
  }

  // The shared game capabilities, used by both the Socket.IO handlers below and the HTTP API (ADR-0016).
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
    newId: randomUUID,
    // Archives live in the game store's own table; `replay.launch` reads one document through this hook.
    archiveDocument: (id) => store.getEncounterArchive(id),
    onEncounterArchived: ({ sceneId, turnCount }) => {
      // Log the fight to the codex timeline, pinned to the location marker that links this scene, if any.
      try {
        const latest = store.listEncounterArchives()[0];
        if (!latest) return;
        const marker = sceneId ? codexStore.markerForScene(sceneId) : null;
        const turns = turnCount > 0 ? ` (${turnCount} ${turnCount === 1 ? "turn" : "turns"})` : "";
        codexStore.appendCombatEntry({ sourceEncounterId: latest.id, attachMarkerId: marker?.id ?? null, attachPageId: marker?.pageIds[0] ?? null, playerText: `A battle was fought here${turns}.` });
        notifyCodexChanged();
      } catch (error) {
        // Best-effort (a codex failure must not affect ending a fight), but logged.
        console.error("codex combat-history bridge failed to log the encounter:", error instanceof Error ? error.message : error);
      }
    }
  });
  const commandRegistry = gameCommandRegistry(operations);

  // Open CORS for /api/v1 only: credentials there are bearer headers (or SameSite=Strict cookies), so a
  // wildcard origin grants nothing a token doesn't, and browser integrations can call it. The legacy
  // /api/gm/* endpoints (password login) stay same-origin so web pages can't relay password guesses.
  // Mounted above the body parsers so preflights skip body buffering and parser errors carry CORS headers.
  app.use((req, res, next) => {
    if (req.path !== "/api/v1" && !req.path.startsWith("/api/v1/")) return next();
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "authorization, content-type, x-request-id, if-none-match");
    res.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("access-control-expose-headers", "x-request-id, etag, retry-after, x-idempotent-replay");
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });
  // Homebrew packs exceed the global body limit. body-parser skips already-parsed requests, so a
  // route-scoped limit must be mounted before the global parser.
  app.use(HOMEBREW_PACK_IMPORT_PATH, homebrewPackBodyParser());
  // Codex backups reach tens of megabytes; mounted first for the same reason. Authorized before parsing,
  // so an unauthenticated client cannot make the event loop block on a 64 MB JSON.parse. The guard uses
  // the same callbacks as the router and memoizes its answer on `res.locals`.
  app.use(CODEX_PATHS.import, createCodexImportGuard(codexAuth), express.json({ limit: "64mb" }));
  // Above the express default so canonical ActorDefinition imports (capped at 256kb) fit.
  app.use(express.json({ limit: "512kb" }));
  // Give /api/v1 callers the stable error envelope for malformed/oversized JSON instead of Express's HTML.
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
  // Encounter archives: permanent turn-by-turn records saved at encounter end. GM-only: a document holds
  // full state (hidden combatants) and GM-only log lines. Shape documented in encounter-archive.ts.
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

  /** Whether an asset is the map of a replay the GM shared. Gated on the shared flag, and maps come from
   *  the player projection so a prepared scene's map can't leak. Memoised per archive (documents are
   *  immutable); visibility is re-read on every call. */
  const replayMapCache = new Map<number, ReadonlySet<string>>();
  const sharedReplayMap = (assetId: string): boolean => {
    for (const summary of store.listEncounterArchives()) {
      if (!summary.playerVisible) continue;
      let maps = replayMapCache.get(summary.id);
      if (maps === undefined) {
        const stored = store.getEncounterArchive(summary.id);
        if (stored === null) continue;
        try { maps = playerReplayMapAssetIds(summary.id, JSON.parse(stored) as EncounterArchiveDocument); }
        catch { maps = new Set<string>(); } // An unreadable archive grants nothing, like a missing one.
        replayMapCache.set(summary.id, maps);
      }
      if (maps.has(assetId)) return true;
    }
    return false;
  };

  app.use(createMapRouter({
    assets: mapAssets,
    catalog: mapCatalog,
    authorizeGm,
    authorizePlayer: (token, assetId) => {
      if (auth.verifyPlayer(token) === null) return false;
      const combat = store.snapshot.combat;
      // A player may load the active battle map, any revealed atlas map, or the map of a replay the GM shared.
      return (combat.active && combat.mapAssetId === assetId) || codexStore.isAssetRevealedToPlayers(assetId) || sharedReplayMap(assetId);
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
    // A joined player may browse the GM's token library and upload their own token image.
    playerSession: (token) => auth.verifyPlayer(token),
    authorizePlayer: (token, assetId) => auth.verifyPlayer(token) !== null && store.snapshot.actors.some((actor) => actor.visibility === "public" && actor.tokenAssetId === assetId),
    authorizeViewer: (token, assetId) => {
      if (!token) return false;
      try { viewerAccess.verify(token); return viewerPresentation.project().enabled && store.snapshot.actors.some((actor) => actor.visibility === "public" && actor.tokenAssetId === assetId); }
      catch { return false; }
    }
  }));
  app.use(createCodexRouter({
    store: codexStore,
    assets: codexAssets,
    ...codexAuth,
    notifyChanged: notifyCodexChanged,
    issuePreviewSession: () => auth.issuePreviewPlayerSession()
  }));
  // GM-only end to end; `authorizePlayer` exists only so a player gets 403 rather than 401.
  app.use(createHomebrewRouter({
    store: homebrewStore,
    authorizeGm,
    authorizePlayer: (token) => auth.verifyPlayer(token) !== null,
    notifyChanged: notifyHomebrewChanged,
    // The GM catalog: a dependency that is published but not player-visible is valid here.
    validate: createHomebrewValidator({
      forAudience: (audience) => contentLibrary.forAudience(audience),
      publishedSpellLists: () => homebrewStore.publishedFor("gm").spellLists,
      // Drafts included, only here: the gate asks whether a record exists, so a class and its subclass can
      // publish in either order.
      authoredIndex: () => homebrewStore.authoredIndex()
    }),
    usagesOf: homebrewUsagesFor,
    catalogRecord: (id) => findCatalogRecord(contentLibrary.forAudience("gm"), id)
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
      remove: (id) => store.deleteEncounterArchive(id),
      setVisibility: (id, playerVisible) => store.setEncounterArchiveVisibility(id, playerVisible)
    },
    sessions: {
      // The HTTP mirror of the socket's LAN-trust join: anyone who can reach the host may take a player seat
      // once GM setup is complete.
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
  // Keep the API-only 404 envelope scoped to /api/v1 so it cannot swallow the SPA or the viewer.
  app.use((req, res, next) => req.path === "/api/v1" || req.path.startsWith("/api/v1/")
    ? apiV1Router(req, res, next)
    : next());
  app.use("/api", (_req, res) => res.status(404).json({ message: "API route not found." }));
  if (!options.useDevelopmentClient) {
    app.get("/viewer", (_req, res) => res.redirect(307, "/viewer.html"));
    // For install paths containing a dot-segment (e.g. OneDrive's `.DesktopOneDrive`): `send` ignores
    // dotfiles by default and 404s such absolute paths, so allow dotfiles and pass the SPA fallback a
    // root plus relative filename.
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
    /** Socket adapter: resolve the principal, run the operation, map the outcome to the ack (a timeline
     *  confirmation bounce is an ok:true ack). */
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
        // Rules-mode rejections carry machine-readable details for the one-tap audited override (ADR-0020).
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
    socket.on("character:submit-import", (payload, acknowledge) => respond(acknowledge, "Join the table before submitting a sheet.", "The sheet could not be submitted.", (principal) => operations.characterSubmitImport(principal, payload)));
    socket.on("character:resolve-import", (payload, acknowledge) => respond(acknowledge, "Only the GM can approve imported sheets.", "The import could not be resolved.", (principal) => operations.characterResolveImport(principal, payload)));
    socket.on("character:create", (payload, acknowledge) => respond(acknowledge, "Only the GM can create characters directly.", "The character could not be created.", (principal) => operations.characterCreate(principal, payload)));
    socket.on("character:generate", (payload, acknowledge) => respond(acknowledge, "Your GM rolls the random characters at this table.", "The character could not be rolled up.", (principal) => operations.characterGenerate(principal, payload)));
    socket.on("builder:set-policy", (payload, acknowledge) => respond(acknowledge, "Only the GM can set the character-builder policy.", "The builder policy could not be changed.", (principal) => operations.builderSetPolicy(principal, payload)));
    socket.on("character:rebuild", (payload, acknowledge) => respond(acknowledge, "You can only rebuild your own character.", "That character could not be rebuilt.", (principal) => operations.characterRebuild(principal, payload)));
    socket.on("builder:roll-abilities", (payload, acknowledge) => respond(acknowledge, "Your GM builds the characters at this table.", "The ability scores could not be rolled.", (principal) => operations.builderRollAbilities(principal, payload)));
    socket.on("actor:remove", (payload, acknowledge) => respond(acknowledge, "Only the GM can remove combatants.", "The combatant could not be removed.", (principal) => operations.actorRemove(principal, payload)));
    socket.on("actor:set-token-image", (payload, acknowledge) => respond(acknowledge, "Only the GM can set token images.", "The token image could not be set.", (principal) => operations.actorSetTokenImage(principal, payload)));
    socket.on("actor:set-size", (payload, acknowledge) => respond(acknowledge, "Only the GM can resize tokens.", "The token could not be resized.", (principal) => operations.actorSetSize(principal, payload)));
    socket.on("actor:set-visibility", (payload, acknowledge) => respond(acknowledge, "Only the GM can change token visibility.", "The token visibility could not be changed.", (principal) => operations.actorSetVisibility(principal, payload)));
    socket.on("actor:set-archived", (payload, acknowledge) => respond(acknowledge, "Only the GM can archive characters.", "The character could not be archived.", (principal) => operations.actorSetArchived(principal, payload)));
    socket.on("actor:set-sheet-preview", (payload, acknowledge) => respond(acknowledge, "Only the GM can share an archived character's sheet.", "The archived sheet could not be shared.", (principal) => operations.actorSetSheetPreview(principal, payload)));
    socket.on("actor:set-speed", (payload, acknowledge) => respond(acknowledge, "Only the GM can set movement speed.", "The speed could not be set.", (principal) => operations.actorSetSpeed(principal, payload)));
    socket.on("actor:apply-damage", (payload, acknowledge) => respond(acknowledge, "Join the table before tracking hit points.", "The damage could not be applied.", (principal) => operations.actorApplyDamage(principal, payload)));
    socket.on("actor:heal", (payload, acknowledge) => respond(acknowledge, "Join the table before tracking hit points.", "The healing could not be applied.", (principal) => operations.actorHeal(principal, payload)));
    socket.on("actor:set-temp-hp", (payload, acknowledge) => respond(acknowledge, "Join the table before tracking hit points.", "The temporary hit points could not be set.", (principal) => operations.actorSetTempHp(principal, payload)));
    socket.on("content:conditions", (_payload, acknowledge) => respond(acknowledge, "Join the table before browsing reference content.", "The reference content is unavailable.", (principal) => operations.contentConditions(principal)));
    socket.on("content:skills", (_payload, acknowledge) => respond(acknowledge, "Join the table before browsing reference content.", "The reference content is unavailable.", (principal) => operations.contentSkills(principal)));
    socket.on("content:languages", (_payload, acknowledge) => respond(acknowledge, "Join the table before browsing reference content.", "The reference content is unavailable.", (principal) => operations.contentLanguages(principal)));
    socket.on("content:spells", (_payload, acknowledge) => respond(acknowledge, "Join the table before browsing reference content.", "The reference content is unavailable.", (principal) => operations.contentSpells(principal)));
    socket.on("content:equipment", (_payload, acknowledge) => respond(acknowledge, "Join the table before browsing reference content.", "The reference content is unavailable.", (principal) => operations.contentEquipment(principal)));
    // Character-builder catalogs: readable by any joined session, each mirrored by a GET under
    // /api/v1/content (ADR-0016).
    socket.on("content:classes", (_payload, acknowledge) => respond(acknowledge, "Join the table before browsing reference content.", "The reference content is unavailable.", (principal) => operations.contentClasses(principal)));
    socket.on("content:subclasses", (_payload, acknowledge) => respond(acknowledge, "Join the table before browsing reference content.", "The reference content is unavailable.", (principal) => operations.contentSubclasses(principal)));
    socket.on("content:species", (_payload, acknowledge) => respond(acknowledge, "Join the table before browsing reference content.", "The reference content is unavailable.", (principal) => operations.contentSpecies(principal)));
    socket.on("content:backgrounds", (_payload, acknowledge) => respond(acknowledge, "Join the table before browsing reference content.", "The reference content is unavailable.", (principal) => operations.contentBackgrounds(principal)));
    socket.on("content:feats", (_payload, acknowledge) => respond(acknowledge, "Join the table before browsing reference content.", "The reference content is unavailable.", (principal) => operations.contentFeats(principal)));
    socket.on("content:names", (_payload, acknowledge) => respond(acknowledge, "Join the table before browsing reference content.", "The reference content is unavailable.", (principal) => operations.contentNames(principal)));
    socket.on("actor:set-condition", (payload, acknowledge) => respond(acknowledge, "Join the table before tracking conditions.", "The condition could not be updated.", (principal) => operations.actorSetCondition(principal, payload)));
    socket.on("content:monster-actions", (payload, acknowledge) => respond(acknowledge, "Only the GM can browse stat blocks.", "The stat block is unavailable.", (principal) => operations.contentMonsterActions(principal, payload)));
    socket.on("content:monster-sheet", (payload, acknowledge) => respond(acknowledge, "Only the GM can read stat blocks.", "The stat block is unavailable.", (principal) => operations.contentMonsterSheet(principal, payload)));
    socket.on("action:resolve", (payload, acknowledge) => respond(acknowledge, "Join the table before resolving actions.", "The action could not be resolved.", (principal) => operations.actionResolve(principal, payload)));
    socket.on("action:use", (payload, acknowledge) => respond(acknowledge, "Join the table before using actions.", "The action could not be used.", (principal) => operations.actionUse(principal, payload)));
    socket.on("save:roll", (payload, acknowledge) => respond(acknowledge, "Join the table before rolling saving throws.", "The saving throw failed.", (principal) => operations.saveRoll(principal, payload)));
    socket.on("save:answer", (payload, acknowledge) => respond(acknowledge, "Join the table before answering saving throws.", "The saving throw could not be answered.", (principal) => operations.saveAnswer(principal, payload)));
    socket.on("save:dismiss", (payload, acknowledge) => respond(acknowledge, "Join the table before managing saving throws.", "The saving throw could not be dismissed.", (principal) => operations.saveDismiss(principal, payload)));
    socket.on("reaction:answer", (payload, acknowledge) => respond(acknowledge, "Join the table before answering reactions.", "The reaction could not be answered.", (principal) => operations.reactionAnswer(principal, payload)));
    socket.on("reaction:dismiss", (payload, acknowledge) => respond(acknowledge, "Join the table before managing reactions.", "The reaction prompt could not be dismissed.", (principal) => operations.reactionDismiss(principal, payload)));
    socket.on("damage:resolve", (payload, acknowledge) => respond(acknowledge, "Only the GM can apply proposed damage.", "The damage proposal could not be resolved.", (principal) => operations.damageResolve(principal, payload)));
    socket.on("actor:available-actions", (payload, acknowledge) => respond(acknowledge, "Join the table before checking actions.", "The action availability is unavailable.", (principal) => operations.actorAvailableActions(principal, payload)));
    socket.on("effect:add", (payload, acknowledge) => respond(acknowledge, "Only the GM can add effects.", "The effect could not be added.", (principal) => operations.effectAdd(principal, payload)));
    socket.on("effect:end", (payload, acknowledge) => respond(acknowledge, "Join the table before managing effects.", "The effect could not be ended.", (principal) => operations.effectEnd(principal, payload)));
    socket.on("death-save:roll", (payload, acknowledge) => respond(acknowledge, "Join the table before rolling death saves.", "The death save failed.", (principal) => operations.deathSaveRoll(principal, payload)));
    socket.on("encounter:set-rules-mode", (payload, acknowledge) => respond(acknowledge, "Only the GM can change the rules mode.", "The rules mode could not be changed.", (principal) => operations.encounterSetRulesMode(principal, payload)));
    socket.on("rules:set-policy", (payload, acknowledge) => respond(acknowledge, "Only the GM can set the rules policy.", "The rules policy could not be changed.", (principal) => operations.rulesSetPolicy(principal, payload)));
    socket.on("rules:ask", (payload, acknowledge) => respond(acknowledge, "Join the table before asking the GM.", "The question could not be sent.", (principal) => operations.rulesAsk(principal, payload)));
    socket.on("rules:answer", (payload, acknowledge) => respond(acknowledge, "Only the GM can answer a rules question.", "The answer could not be recorded.", (principal) => operations.rulesAnswer(principal, payload)));
    socket.on("table:set-staging-defaults", (payload, acknowledge) => respond(acknowledge, "Only the GM can set the table's staging defaults.", "The staging defaults could not be changed.", (principal) => operations.tableSetStagingDefaults(principal, payload)));
    socket.on("table:set-party-visibility", (payload, acknowledge) => respond(acknowledge, "Only the GM can set what players see of each other.", "The party visibility could not be changed.", (principal) => operations.tableSetPartyVisibility(principal, payload)));
    socket.on("encounter:set-player-damage-mode", (payload, acknowledge) => respond(acknowledge, "Only the GM can change how players' hits apply damage.", "The player damage mode could not be changed.", (principal) => operations.encounterSetPlayerDamageMode(principal, payload)));
    socket.on("encounter:set-player-initiative-mode", (payload, acknowledge) => respond(acknowledge, "Only the GM can change how player initiative works.", "The player initiative mode could not be changed.", (principal) => operations.encounterSetPlayerInitiativeMode(principal, payload)));
    socket.on("encounter:set-health-display", (payload, acknowledge) => respond(acknowledge, "Only the GM can change how health is shown.", "The health display could not be changed.", (principal) => operations.encounterSetHealthDisplay(principal, payload)));
    socket.on("actor:set-health-display", (payload, acknowledge) => respond(acknowledge, "Only the GM can change how health is shown.", "The health display could not be changed.", (principal) => operations.actorSetHealthDisplay(principal, payload)));
    socket.on("encounter:set-environment", (payload, acknowledge) => respond(acknowledge, "Only the GM can change the encounter environment.", "The environment could not be changed.", (principal) => operations.encounterSetEnvironment(principal, payload)));
    socket.on("actor:rest", (payload, acknowledge) => respond(acknowledge, "Join the table before resting.", "The rest could not be applied.", (principal) => operations.actorRest(principal, payload)));
    socket.on("actor:rechoose", (payload, acknowledge) => respond(acknowledge, "Join the table before changing a character's choices.", "The choice could not be changed.", (principal) => operations.actorRechoose(principal, payload)));
    socket.on("actor:spend-hit-dice", (payload, acknowledge) => respond(acknowledge, "Join the table before spending Hit Dice.", "The Hit Dice could not be spent.", (principal) => operations.actorSpendHitDice(principal, payload)));
    socket.on("character:set-slot", (payload, acknowledge) => respond(acknowledge, "Join the table before managing spell slots.", "The spell slot could not be updated.", (principal) => operations.characterSetSlot(principal, payload)));
    socket.on("character:set-prepared", (payload, acknowledge) => respond(acknowledge, "Join the table before preparing spells.", "The prepared spell could not be updated.", (principal) => operations.characterSetPrepared(principal, payload)));
    socket.on("character:set-inventory", (payload, acknowledge) => respond(acknowledge, "Join the table before managing inventory.", "The inventory could not be updated.", (principal) => operations.characterSetInventory(principal, payload)));
    socket.on("character:set-currency", (payload, acknowledge) => respond(acknowledge, "Join the table before managing currency.", "The currency could not be updated.", (principal) => operations.characterSetCurrency(principal, payload)));
    socket.on("character:set-identity", (payload, acknowledge) => respond(acknowledge, "Join the table before editing a character.", "The identity could not be updated.", (principal) => operations.characterSetIdentity(principal, payload)));
    socket.on("character:set-proficiencies", (payload, acknowledge) => respond(acknowledge, "Join the table before editing a character.", "The proficiencies could not be updated.", (principal) => operations.characterSetProficiencies(principal, payload)));
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
    socket.on("initiative:roll-self", (payload, acknowledge) => respond(acknowledge, "Join the table before rolling initiative.", "Initiative could not be rolled.", (principal) => operations.initiativeRollSelf(principal, payload)));
    socket.on("initiative:roll-remaining", (payload, acknowledge) => respond(acknowledge, "Only the GM can roll for the rest of the table.", "Initiative could not be rolled.", (principal) => operations.initiativeRollRemaining(principal, payload)));
    socket.on("initiative:next", (payload, acknowledge) => respond(acknowledge, "Only the GM can advance Initiative.", "Initiative could not advance.", (principal) => operations.initiativeNext(principal, payload)));
    socket.on("initiative:previous", (payload, acknowledge) => respond(acknowledge, "Only the GM can move Initiative backward.", "Initiative could not move backward.", (principal) => operations.initiativePrevious(principal, payload)));
    socket.on("log:read", (_payload, acknowledge) => respond(acknowledge, "Join the table to read the combat log.", "The combat log is unavailable.", (principal) => ({ entries: operations.logEntries(principal) })));
    socket.on("token:move", (payload, acknowledge) => respond(acknowledge, "Join a session before moving tokens.", "The token could not be moved.", (principal) => operations.tokenMove(principal, payload)));
    socket.on("scene:create", (payload, acknowledge) => respond(acknowledge, "Only the GM can prepare scenes.", "The scene could not be created.", (principal) => operations.sceneCreate(principal, payload)));
    socket.on("scene:rename", (payload, acknowledge) => respond(acknowledge, "Only the GM can rename scenes.", "The scene could not be renamed.", (principal) => operations.sceneRename(principal, payload)));
    socket.on("scene:remove", (payload, acknowledge) => respond(acknowledge, "Only the GM can remove scenes.", "The scene could not be removed.", (principal) => operations.sceneRemove(principal, payload)));
    socket.on("scene:activate", (payload, acknowledge) => respond(acknowledge, "Only the GM can switch scenes.", "The scene could not be switched.", (principal) => operations.sceneActivate(principal, payload)));
    socket.on("replay:launch", (payload, acknowledge) => respond(acknowledge, "Only the GM can launch a replay.", "That recorded moment could not be launched.", (principal) => operations.replayLaunch(principal, payload)));
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
    await Promise.all([auth.initialize(), store.initialize(), combatLog.initialize(), credentials.initialize(), mapAssets.initialize(), mapCatalog.initialize(), tokenAssets.initialize(), tokenCatalog.initialize(), viewerAccess.initialize(), viewerPresentation.initialize(), codexStore.initialize(), codexAssets.initialize(), homebrewStore.initialize()]);
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
  function close() { presence.dispose(); viewerCoordinator.dispose(); for (const timer of annotationExpiryTimers) clearTimeout(timer); annotationExpiryTimers.clear(); io.close(); store.close(); combatLog.close(); credentials.close(); mapCatalog.close(); tokenCatalog.close(); viewerAccess.close(); viewerPresentation.close(); homebrewStore.close(); }

  return { app, httpServer, io, auth, store, credentials, presence, mapAssets, mapCatalog, viewerAccess, viewerPresentation, viewerCoordinator, initialize, close };
}
