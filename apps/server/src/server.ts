import { createServer as createHttpServer } from "node:http";
import { randomInt, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import express, { type Express } from "express";
import { Server } from "socket.io";
import { z } from "zod";
import { API_VERSION, CODEX_PATHS } from "@vtt/api-contract";
import type {
  ClientToServerEvents,
  ClientRole,
  CombatLogEntry,
  GameState,
  RollRecord,
  ServerToClientEvents,
  TableEvent
} from "@vtt/domain";
import { ACTOR_DEFINITION_SCHEMA_VERSION } from "@vtt/schemas";
import { nextAnnotationExpiry } from "./annotations.js";
import { createApiV1Router } from "./api-v1.js";
import { ContentLibrary } from "./content-library.js";
import { AuthService } from "./auth.js";
import { developmentClientUrl } from "./client-hosting.js";
import { CombatLogStore, projectFeedRow } from "./combat-log.js";
import { timelineDirtied, type TimelineOutcome } from "./combat-history.js";
import { createGameApiRouter } from "./game-http.js";
import {
  createGameCommands,
  failureReply,
  NOT_JOINED_REPLY,
  socketEventOf,
  type GamePrincipal
} from "./commands/index.js";
import { CommandRejectedError, GameStore } from "./game-store.js";
import { CodexStore } from "./codex-store.js";
import { createCodexImportGuard, createCodexRouter } from "./codex-http.js";
import { HomebrewStore } from "./homebrew-store.js";
import { createHomebrewRouter, homebrewPackBodyParser, HOMEBREW_PACK_IMPORT_PATH } from "./homebrew-http.js";
import { createHomebrewValidator } from "./homebrew-validate.js";
import { buildHomebrewUsageIndex } from "./homebrew-usages.js";
import { findCatalogRecord } from "./homebrew-srd-copy.js";
import { createInitialGameState } from "./initial-game-state.js";
import { createStateReader } from "./state-reader.js";
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
import type { TokenMapGeometry } from "./token-placement.js";
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
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: options.clientOrigin ? { origin: options.clientOrigin } : undefined
  });
  const auth = new AuthService(options.authPath);
  const store = new GameStore(options.databasePath, options.initialGameState ?? createInitialGameState(), {
    timelineDirtied
  });
  // Every read of the game state outside a command's own transaction goes through here.
  const committedState = createStateReader(store);
  const combatLog = new CombatLogStore(options.databasePath);
  const credentials = new IntegrationCredentialStore(options.integrationCredentialsPath);
  const mapAssets = new MapAssetStore(options.mapAssetsPath ?? join(dirname(options.databasePath), "map-assets"));
  const mapCatalog = new MapCatalogStore(options.databasePath);
  const tokenAssets = new MapAssetStore(
    options.tokenAssetsPath ?? join(dirname(options.databasePath), "token-assets"),
    { maxBytes: 5 * 1024 * 1024, maxDimensionPx: 2048, maxPixels: 2048 * 2048 }
  );
  const tokenCatalog = new TokenCatalogStore(options.databasePath);
  const viewerAccess = new ViewerAccessStore(options.databasePath);
  const viewerPresentation = new ViewerPresentationStore(options.databasePath);
  const codexStore = new CodexStore(options.databasePath);
  const codexAssets = new MapAssetStore(join(dirname(options.databasePath), "codex-assets"), {
    maxBytes: 10 * 1024 * 1024,
    maxDimensionPx: 4096,
    maxPixels: 4096 * 4096
  });
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
    const soonest = nextAnnotationExpiry(committedState.read(), Date.now());
    if (soonest === null) return;
    const timer = setTimeout(
      () => {
        annotationExpiryTimers.delete(timer);
        void publishGameState(committedState.read());
        scheduleAnnotationExpiry();
      },
      Math.max(0, soonest - Date.now())
    );
    timer.unref?.();
    annotationExpiryTimers.add(timer);
  }

  /** GM view plus the time-travel timeline (labels can name hidden combatants, so this is GM-only). */
  function gmView(state: GameState, now = Date.now()) {
    return { ...projectGmView(state, presenceFor, now), turnHistory: store.listTurnSnapshots() };
  }
  /** Also reauthorizes every connected socket, so a revoked GM client is downgraded or disconnected promptly. */
  function broadcast() {
    const current = committedState.read();
    for (const socket of io.sockets.sockets.values()) {
      const token = socket.handshake.auth?.token;
      const gm = auth.verify(token);
      const player = auth.verifyPlayer(token);
      if (token && !gm && !player) {
        socket.disconnect(true);
        continue;
      }
      socket.emit("state:updated", gm ? gmView(current) : projectPlayerView(current, player?.sessionId, presenceFor));
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
  // Homebrew usage lookup, memoised for one microtask: the library list asks per row and building the
  // index walks the whole campaign. Gone before the next request, so never stale.
  let usageIndex: ReturnType<typeof buildHomebrewUsageIndex> | undefined;
  const homebrewUsagesFor = (type: Parameters<ReturnType<typeof buildHomebrewUsageIndex>["of"]>[0], id: string) => {
    if (!usageIndex) {
      usageIndex = buildHomebrewUsageIndex(committedState.read());
      queueMicrotask(() => {
        usageIndex = undefined;
      });
    }
    return usageIndex.of(type, id);
  };
  /** Emits a transient toast. Players receive it only when it isn't GM-only and every referenced actor is
   *  public. Not stored; the viewer gets nothing. */
  function broadcastTableEvent(
    event: Readonly<{
      kind: TableEvent["kind"];
      text: string;
      actorIds?: readonly string[];
      gmOnly?: boolean;
      logged?: boolean;
    }>
  ) {
    const { actors } = committedState.read();
    const actorIds = event.actorIds ?? [];
    const publicToPlayers =
      !event.gmOnly && actorIds.every((id) => actors.find((actor) => actor.id === id)?.visibility === "public");
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
  function appendLog(
    entry: Readonly<{
      kind: CombatLogEntry["kind"];
      text: string;
      actorIds?: readonly string[];
      gmOnly?: boolean;
      actorId?: string | null;
      roll?: RollRecord | null;
    }>
  ) {
    const current = committedState.read();
    const actorIds = entry.actorIds ?? [];
    const gmOnly =
      entry.gmOnly === true ||
      actorIds.some((id) => current.actors.find((actor) => actor.id === id)?.visibility !== "public");
    const row = combatLog.append({
      kind: entry.kind,
      text: entry.text,
      gmOnly,
      revision: current.revision,
      actorId: entry.actorId ?? null,
      roll: entry.roll ?? null
    });
    // Per-recipient delivery: a `self-only` roll belongs to one player, unlocked by their session id.
    // `projectFeedRow` decides and strips the roller's session id. The public viewer has no game socket.
    for (const socket of io.sockets.sockets.values()) {
      const token = socket.handshake.auth?.token;
      if (auth.verify(token)) {
        socket.emit("log:entry", row.entry);
        continue;
      }
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
    appendLog({
      kind: "turn",
      text: `Round ${state.combat.round} - ${name}'s turn.`,
      actorIds: [state.combat.turnActorId]
    });
  }
  /** Turns a timeline navigation outcome into log lines: plain turns for forward play, GM-only notes for rewinds. */
  function logTimelineOutcome(outcome: TimelineOutcome, state: GameState) {
    switch (outcome.kind) {
      case "advanced":
      case "legacy":
        logTurnBegin(state);
        break;
      case "rewrote":
        appendLog({
          kind: "history",
          text: "The GM rewrote history from this turn - every later turn was undone.",
          gmOnly: true
        });
        logTurnBegin(state);
        break;
      case "rewound":
        appendLog({ kind: "history", text: `The GM rewound to ${outcome.label}.`, gmOnly: true });
        break;
      case "stepped":
        appendLog({ kind: "history", text: `The GM moved to ${outcome.label}.`, gmOnly: true });
        break;
      case "discarded":
        appendLog({ kind: "history", text: `The GM discarded the changes at ${outcome.label}.`, gmOnly: true });
        break;
      case "resumed":
        appendLog({ kind: "history", text: "The GM resumed live play.", gmOnly: true });
        break;
    }
  }
  async function tokenGeometryFor(mapAssetId: string): Promise<TokenMapGeometry> {
    const [asset, entry] = await Promise.all([mapAssets.get(mapAssetId), Promise.resolve(mapCatalog.get(mapAssetId))]);
    if (!asset || !entry || entry.kind !== "battlemap")
      throw new CommandRejectedError("The active encounter battlemap is unavailable.");
    return {
      width: asset.width,
      height: asset.height,
      calibration: entry.calibration?.calibration ?? null,
      scale: entry.scale ?? null
    };
  }
  async function publishGameState(state: GameState) {
    try {
      await viewerCoordinator.synchronizeEncounter(state.revision, projectViewerEncounter(state, Date.now()));
    } catch {
      for (const socket of io.sockets.sockets.values())
        if (auth.verify(socket.handshake.auth?.token))
          socket.emit(
            "system:error",
            "The game state was saved, but the shared viewer could not synchronize the encounter. Retry the last viewer action or restart the host."
          );
    }
    broadcast();
  }
  /** Presents a newly-live scene's map on the shared screen. Best-effort: a viewer failure must not undo the committed scene switch. */
  async function presentSceneMap(mapAssetId: string) {
    try {
      const geometry = await tokenGeometryFor(mapAssetId);
      const entry = mapCatalog.get(mapAssetId);
      await viewerCoordinator.presentMap(store.revision, {
        assetId: mapAssetId,
        altText: entry?.name ?? "Battle map",
        camera: { center: { x: geometry.width / 2, y: geometry.height / 2 }, zoom: 1 }
      });
    } catch {
      for (const socket of io.sockets.sockets.values())
        if (auth.verify(socket.handshake.auth?.token))
          socket.emit(
            "system:error",
            "The scene is live, but the shared screen could not switch to its map. Present it from the Viewer tab."
          );
    }
  }

  // The game commands and reads, served by both the Socket.IO handlers below and the HTTP API (ADR-0016).
  const game = createGameCommands({
    store,
    readState: committedState.read,
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
        codexStore.appendCombatEntry({
          sourceEncounterId: latest.id,
          attachMarkerId: marker?.id ?? null,
          attachPageId: marker?.pageIds[0] ?? null,
          playerText: `A battle was fought here${turns}.`
        });
        notifyCodexChanged();
      } catch (error) {
        // Best-effort (a codex failure must not affect ending a fight), but logged.
        console.error(
          "codex combat-history bridge failed to log the encounter:",
          error instanceof Error ? error.message : error
        );
      }
    }
  });

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
    if (!error || res.headersSent || !(req.path === "/api/v1" || req.path.startsWith("/api/v1/")))
      return next(error as Error);
    const tooLarge = (error as { type?: string }).type === "entity.too.large";
    return res.status(tooLarge ? 413 : 400).json({
      ok: false,
      apiVersion: API_VERSION,
      error: {
        code: tooLarge ? "bad_request" : "validation_failed",
        message: tooLarge ? "The request body is too large." : "The request body is not valid JSON.",
        requestId: randomUUID()
      }
    });
  });
  app.get("/api/bootstrap/status", (_req, res) => res.json({ bootstrapped: auth.isBootstrapped }));
  app.post("/api/bootstrap", async (req, res) => {
    if (!isLoopback(req.ip))
      return res.status(403).json({ message: "Initial GM setup must be performed on the host machine." });
    const result = z.object({ password: z.string().min(12).max(256) }).safeParse(req.body);
    if (!result.success) return res.status(400).json({ message: "Use a GM password of at least 12 characters." });
    try {
      await auth.bootstrap(result.data.password);
      return res.status(201).json({ ok: true });
    } catch (error) {
      return res.status(409).json({ message: (error as Error).message });
    }
  });
  app.post("/api/gm/login", async (req, res) => {
    const rateLimitKey = req.ip ?? "unknown";
    const decision = gmLoginRateLimiter.check(rateLimitKey);
    if (!decision.allowed) {
      res.set("Retry-After", String(decision.retryAfterSeconds));
      return res.status(429).json({ message: "Too many attempts. Try again later." });
    }
    const result = z.object({ password: z.string() }).safeParse(req.body);
    if (!result.success) {
      gmLoginRateLimiter.recordFailure(rateLimitKey);
      return res.status(400).json({ message: "Password is required." });
    }
    const token = await auth.login(result.data.password);
    if (!token) {
      gmLoginRateLimiter.recordFailure(rateLimitKey);
      return res.status(401).json({ message: "Invalid GM password." });
    }
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
  app.get("/api/gm/viewer-urls", (req, res) => {
    const token = req.header("authorization")?.replace("Bearer ", "");
    if (!auth.verify(token)) return res.status(401).json({ message: "A valid GM session is required." });
    const viewerUrls = [
      ...new Set((options.viewerBaseUrls ?? []).map((url) => `${url.replace(/\/$/, "")}/viewer.html`))
    ];
    return res.json({ viewerUrls });
  });
  app.use(
    createViewerRouter({
      access: viewerAccess,
      presentation: viewerPresentation,
      coordinator: viewerCoordinator,
      authorizeGm
    })
  );

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
        try {
          maps = playerReplayMapAssetIds(summary.id, JSON.parse(stored) as EncounterArchiveDocument);
        } catch {
          maps = new Set<string>();
        } // An unreadable archive grants nothing, like a missing one.
        replayMapCache.set(summary.id, maps);
      }
      if (maps.has(assetId)) return true;
    }
    return false;
  };

  app.use(
    createMapRouter({
      assets: mapAssets,
      catalog: mapCatalog,
      authorizeGm,
      authorizePlayer: (token, assetId) => {
        if (auth.verifyPlayer(token) === null) return false;
        const { combat } = committedState.read();
        // A player may load the active battle map, any revealed atlas map, or the map of a replay the GM shared.
        return (
          (combat.active && combat.mapAssetId === assetId) ||
          codexStore.isAssetRevealedToPlayers(assetId) ||
          sharedReplayMap(assetId)
        );
      },
      authorizeViewer: (token, assetId) => {
        if (!token) return false;
        try {
          viewerAccess.verify(token);
          const presentation = viewerPresentation.project();
          return presentation.enabled && presentation.activeMap?.assetId === assetId;
        } catch {
          return false;
        }
      }
    })
  );
  app.use(
    createTokenRouter({
      assets: tokenAssets,
      catalog: tokenCatalog,
      authorizeGm,
      // A joined player may browse the GM's token library and upload their own token image.
      playerSession: (token) => auth.verifyPlayer(token),
      authorizePlayer: (token, assetId) =>
        auth.verifyPlayer(token) !== null &&
        committedState.read().actors.some((actor) => actor.visibility === "public" && actor.tokenAssetId === assetId),
      authorizeViewer: (token, assetId) => {
        if (!token) return false;
        try {
          viewerAccess.verify(token);
          return (
            viewerPresentation.project().enabled &&
            committedState
              .read()
              .actors.some((actor) => actor.visibility === "public" && actor.tokenAssetId === assetId)
          );
        } catch {
          return false;
        }
      }
    })
  );
  app.use(
    createCodexRouter({
      store: codexStore,
      assets: codexAssets,
      ...codexAuth,
      notifyChanged: notifyCodexChanged,
      issuePreviewSession: () => auth.issuePreviewPlayerSession()
    })
  );
  // GM-only end to end; `authorizePlayer` exists only so a player gets 403 rather than 401.
  app.use(
    createHomebrewRouter({
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
    })
  );
  const gameApiRouter = createGameApiRouter({
    game,
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
  app.use((req, res, next) =>
    req.path === "/api/v1" || req.path.startsWith("/api/v1/") ? apiV1Router(req, res, next) : next()
  );
  app.use("/api", (_req, res) => res.status(404).json({ message: "API route not found." }));
  if (!options.useDevelopmentClient) {
    app.get("/viewer", (_req, res) => res.redirect(307, "/viewer.html"));
    // For install paths containing a dot-segment (e.g. OneDrive's `.DesktopOneDrive`): `send` ignores
    // dotfiles by default and 404s such absolute paths, so allow dotfiles and pass the SPA fallback a
    // root plus relative filename.
    app.use(express.static(options.webDist, { dotfiles: "allow" }));
    app.get("/{*path}", (_req, res) => res.sendFile("index.html", { root: options.webDist, dotfiles: "allow" }));
  } else {
    app.get("/viewer", (req, res) =>
      res.redirect(307, developmentClientUrl(req.hostname, "/viewer.html", options.developmentClientPort))
    );
    app.get("/{*path}", (req, res) =>
      res.redirect(307, developmentClientUrl(req.hostname, req.originalUrl, options.developmentClientPort))
    );
  }

  io.on("connection", (socket) => {
    let joinedSession: { sessionId: string; role: ClientRole } | null = null;
    socket.on("session:join", (payload, ack) => {
      // Client input: a join without a payload or an acknowledgement must not throw out of the handler.
      const token = typeof payload?.token === "string" ? payload.token : undefined;
      const acknowledge: typeof ack = (result) => {
        if (typeof ack === "function") ack(result);
      };
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
      if (!auth.isBootstrapped)
        return acknowledge({ ok: false, message: "The host must complete GM setup before players join." });
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
    /** Socket adapter: resolve the principal, run the work, and answer through the same failure mapping as
     *  HTTP. A timeline confirmation bounce is an ok:true ack, and an emit without an acknowledgement still
     *  runs. */
    const respond = async (
      acknowledge: unknown,
      work: (principal: GamePrincipal) => Promise<Record<string, unknown>> | Record<string, unknown>
    ) => {
      const reply = (result: Record<string, unknown>) => {
        if (typeof acknowledge === "function") acknowledge(result);
      };
      const principal = principalOf();
      if (!principal) return reply(NOT_JOINED_REPLY);
      let outcome: Record<string, unknown>;
      try {
        outcome = { ok: true, ...(await work(principal)) };
      } catch (error) {
        outcome = failureReply(error);
      }
      reply(outcome);
    };
    // Every command and read is registered from its table entry; the event names are typed against the
    // domain's `ClientToServerEvents` in `commands/index.ts`.
    const on = socket.on.bind(socket) as unknown as (
      event: string,
      listener: (payload: unknown, acknowledge?: unknown) => void
    ) => void;
    for (const command of game.commands)
      on(socketEventOf(command.type), (payload, acknowledge) =>
        respond(acknowledge, (principal) => game.dispatch(command.type, principal, payload))
      );
    for (const read of game.reads)
      on(read.event, (payload, acknowledge) =>
        respond(acknowledge, (principal) => game.read(read, principal, payload))
      );
    socket.emit(
      "state:updated",
      projectPlayerView(committedState.read(), auth.verifyPlayer(socket.handshake.auth.token)?.sessionId, presenceFor)
    );
  });

  async function initialize() {
    await Promise.all([
      auth.initialize(),
      store.initialize(),
      combatLog.initialize(),
      credentials.initialize(),
      mapAssets.initialize(),
      mapCatalog.initialize(),
      tokenAssets.initialize(),
      tokenCatalog.initialize(),
      viewerAccess.initialize(),
      viewerPresentation.initialize(),
      codexStore.initialize(),
      codexAssets.initialize(),
      homebrewStore.initialize()
    ]);
    // The store's startup seeds may change the state without a revision bump.
    committedState.reset();
    await viewerCoordinator.synchronizeEncounter(store.revision, projectViewerEncounter(committedState.read()));
  }
  function close() {
    presence.dispose();
    viewerCoordinator.dispose();
    for (const timer of annotationExpiryTimers) clearTimeout(timer);
    annotationExpiryTimers.clear();
    io.close();
    store.close();
    combatLog.close();
    credentials.close();
    mapCatalog.close();
    tokenCatalog.close();
    viewerAccess.close();
    viewerPresentation.close();
    homebrewStore.close();
  }

  return {
    app,
    httpServer,
    io,
    auth,
    store,
    credentials,
    presence,
    mapAssets,
    mapCatalog,
    viewerAccess,
    viewerPresentation,
    viewerCoordinator,
    initialize,
    close
  };
}
