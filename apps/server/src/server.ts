import { createServer as createHttpServer } from "node:http";
import { randomInt, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import express, { type Express } from "express";
import { Server } from "socket.io";
import { z } from "zod";
import { AnnotationPointSchema, AnnotationShapeKindSchema, AnnotationVisibilitySchema, EncounterTokenPositionSchema, RollPurposeSchema, RollVisibilitySchema, type ClientToServerEvents, type ClientRole, type GameState, type RollRecord, type ServerToClientEvents } from "@vtt/domain";
import { rollDice } from "@vtt/rules-5e";
import { ACTOR_DEFINITION_SCHEMA_VERSION } from "@vtt/schemas";
import { addAnnotation, moveAnnotation, nextAnnotationExpiry, removeAnnotation, setAnnotationVisibility } from "./annotations.js";
import { createApiV1Router } from "./api-v1.js";
import { AuthService } from "./auth.js";
import { claimCharacter, forceReleaseCharacter, releaseCharactersForSession } from "./character-claims.js";
import { developmentClientUrl } from "./client-hosting.js";
import { endEncounter, nextInitiativeTurn, previousInitiativeTurn, setInitiativeScore, startEncounter } from "./encounter.js";
import { CommandRejectedError, GameStore, RevisionConflictError } from "./game-store.js";
import { createInitialGameState } from "./initial-game-state.js";
import { IntegrationCredentialStore } from "./integration-credentials.js";
import { LoginRateLimiter } from "./login-rate-limit.js";
import { MapAssetStore } from "./map-assets.js";
import { MapCatalogStore } from "./map-catalog.js";
import { createMapRouter } from "./map-http.js";
import { PresenceRegistry } from "./presence.js";
import { projectGmView, projectPlayerView } from "./projections.js";
import { ensureEncounterTokens, moveEncounterToken, type TokenMapGeometry } from "./token-placement.js";
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
const CommandIdentitySchema = z.object({ commandId: z.string().uuid(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
const EncounterStartSchema = z.object({
  commandId: z.string().uuid(),
  mapAssetId: z.string().uuid(),
  entries: z.array(z.object({ actorId: z.string().uuid(), score: z.number().int().min(-1000).max(1000).optional() }).strict()).min(1).max(200),
  expectedRevision: z.number().int().nonnegative().optional()
}).strict();
const InitiativeScoreSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), score: z.number().int().min(-1000).max(1000), expectedRevision: z.number().int().nonnegative().optional() }).strict();
const TokenMoveSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), position: EncounterTokenPositionSchema.nullable(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
const AnnotationGeometryInputSchema = z.object({ origin: AnnotationPointSchema, target: AnnotationPointSchema }).strict();
const AnnotationAddSchema = z.object({
  commandId: z.string().uuid(),
  kind: z.enum(["measurement", "shape"]),
  shape: AnnotationShapeKindSchema.optional(),
  geometry: AnnotationGeometryInputSchema,
  visibility: AnnotationVisibilitySchema.optional(),
  expectedRevision: z.number().int().nonnegative().optional()
}).strict();
const AnnotationMoveSchema = z.object({ commandId: z.string().uuid(), id: z.string().uuid(), geometry: AnnotationGeometryInputSchema, expectedRevision: z.number().int().nonnegative().optional() }).strict();
const AnnotationRemoveSchema = z.object({ commandId: z.string().uuid(), id: z.string().uuid(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
const AnnotationVisibilitySetSchema = z.object({ commandId: z.string().uuid(), id: z.string().uuid(), visibility: AnnotationVisibilitySchema, expectedRevision: z.number().int().nonnegative().optional() }).strict();

export function createServer(options: CreateServerOptions) {
  const app: Express = express();
  const httpServer = createHttpServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, { cors: options.clientOrigin ? { origin: options.clientOrigin } : undefined });
  const auth = new AuthService(options.authPath);
  const store = new GameStore(options.databasePath, options.initialGameState ?? createInitialGameState());
  const credentials = new IntegrationCredentialStore(options.integrationCredentialsPath);
  const mapAssets = new MapAssetStore(options.mapAssetsPath ?? join(dirname(options.databasePath), "map-assets"));
  const mapCatalog = new MapCatalogStore(options.databasePath);
  const viewerAccess = new ViewerAccessStore(options.databasePath);
  const viewerPresentation = new ViewerPresentationStore(options.databasePath);
  const authorizeGm = (token: string | undefined) => auth.verify(token) !== null;
  const viewerCoordinator = new ViewerCoordinator(viewerAccess, viewerPresentation, authorizeGm);
  const gmLoginRateLimiter = new LoginRateLimiter();
  const presence = new PresenceRegistry(options.presenceGraceMs ?? 8000, () => broadcast());
  const presenceFor = (sessionId: string) => presence.statusFor(sessionId);
  const annotationExpiryTimers = new Set<ReturnType<typeof setTimeout>>();
  /** Ephemeral annotations (measurements) carry their own `expiresAt`; the projection already hides expired ones, but nothing re-broadcasts once the timestamp passes without other activity, so schedule one at the soonest expiry — same pattern as ViewerCoordinator's ping expiry. */
  function scheduleAnnotationExpiry() {
    const soonest = nextAnnotationExpiry(store.snapshot, Date.now());
    if (soonest === null) return;
    const timer = setTimeout(() => { annotationExpiryTimers.delete(timer); broadcast(); }, Math.max(0, soonest - Date.now()));
    timer.unref?.();
    annotationExpiryTimers.add(timer);
  }

  function roleFor(socketId: string): ClientRole { return auth.verify(io.sockets.sockets.get(socketId)?.handshake.auth?.token) ? "gm" : "player"; }
  /** Also reauthorizes every connected socket against the latest revocation state, so a revoked GM client is downgraded or disconnected on its next check rather than only when it next sends a command. */
  function broadcast() {
    const state = store.snapshot;
    for (const socket of io.sockets.sockets.values()) {
      const token = socket.handshake.auth?.token;
      const gm = auth.verify(token);
      const player = auth.verifyPlayer(token);
      if (token && !gm && !player) { socket.disconnect(true); continue; }
      socket.emit("state:updated", gm ? projectGmView(state, presenceFor) : projectPlayerView(state, player?.sessionId, presenceFor));
    }
  }
  async function tokenGeometryFor(mapAssetId: string): Promise<TokenMapGeometry> {
    const [asset, entry] = await Promise.all([mapAssets.get(mapAssetId), Promise.resolve(mapCatalog.get(mapAssetId))]);
    if (!asset || !entry || entry.kind !== "battlemap") throw new CommandRejectedError("The active encounter battlemap is unavailable.");
    return { width: asset.width, height: asset.height, calibration: entry.calibration?.calibration ?? null };
  }
  async function publishGameState(state: GameState) {
    try { await viewerCoordinator.synchronizeEncounter(state.revision, projectViewerEncounter(state)); }
    catch {
      for (const socket of io.sockets.sockets.values()) if (auth.verify(socket.handshake.auth?.token)) socket.emit("system:error", "The game state was saved, but the shared viewer could not synchronize the encounter. Retry the last viewer action or restart the host.");
    }
    broadcast();
  }

  app.use(express.json());
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
    res.json(auth.verify(token) ? projectGmView(state, presenceFor) : projectPlayerView(state, auth.verifyPlayer(token)?.sessionId, presenceFor));
  });
  app.get("/api/gm/viewer-urls", (req, res) => {
    const token = req.header("authorization")?.replace("Bearer ", "");
    if (!auth.verify(token)) return res.status(401).json({ message: "A valid GM session is required." });
    const viewerUrls = [...new Set((options.viewerBaseUrls ?? []).map((url) => `${url.replace(/\/$/, "")}/viewer.html`))];
    return res.json({ viewerUrls });
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
  const apiV1Router = createApiV1Router({
    applicationVersion: options.applicationVersion ?? "0.1.0",
    actorDefinitionVersion: ACTOR_DEFINITION_SCHEMA_VERSION,
    authorizeIntegration: (token, requiredScope) => credentials.verify(token, requiredScope) !== null,
    authorizeGm,
    credentialStore: credentials
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
    // `dotfiles: "ignore"`, which 404s any *absolute* path containing a dot-segment — so the SPA
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
    socket.on("character:claim", async ({ commandId, actorId, expectedRevision }, acknowledge) => {
      if (roleFor(socket.id) !== "player") return acknowledge({ ok: false, message: "GM sessions do not claim player characters." });
      const sessionId = auth.verifyPlayer(socket.handshake.auth.token)?.sessionId; if (!sessionId) return acknowledge({ ok: false, message: "Join a session first." });
      try {
        const result = await store.execute({ id: commandId, type: "character.claim", actorId, expectedRevision }, (state) => claimCharacter(state, actorId, sessionId));
        if (!result.duplicate) await publishGameState(result.state); acknowledge({ ok: true, revision: result.state.revision, duplicate: result.duplicate });
      } catch (error) { acknowledge({ ok: false, message: error instanceof Error ? error.message : "The character claim failed." }); }
    });
    socket.on("character:release", async ({ commandId, expectedRevision }, acknowledge) => {
      const sessionId = auth.verifyPlayer(socket.handshake.auth.token)?.sessionId; if (!sessionId) return acknowledge({ ok: false, message: "Join a session first." });
      try {
        const result = await store.execute({ id: commandId, type: "character.release", expectedRevision }, (state) => releaseCharactersForSession(state, sessionId));
        if (!result.duplicate) await publishGameState(result.state); acknowledge({ ok: true, revision: result.state.revision, duplicate: result.duplicate });
      } catch (error) { acknowledge({ ok: false, message: error instanceof Error ? error.message : "The character release failed." }); }
    });
    socket.on("character:force-release", async ({ commandId, actorId, expectedRevision }, acknowledge) => {
      if (!auth.verify(socket.handshake.auth.token)) return acknowledge({ ok: false, message: "Only the GM can force-release a character." });
      try {
        const result = await store.execute({ id: commandId, type: "character.force-release", actorId, expectedRevision }, (state) => forceReleaseCharacter(state, actorId, "gm"));
        if (!result.duplicate) await publishGameState(result.state); acknowledge({ ok: true, revision: result.state.revision, duplicate: result.duplicate });
      } catch (error) { acknowledge({ ok: false, message: error instanceof Error ? error.message : "The character force-release failed." }); }
    });
    socket.on("dice:roll", async ({ commandId, formula, purpose, visibility, actorId, expectedRevision }, acknowledge) => {
      const request = z.object({ commandId: z.string().uuid(), formula: z.string().min(1).max(160), purpose: RollPurposeSchema, visibility: RollVisibilitySchema, actorId: z.string().uuid().optional(), expectedRevision: z.number().int().nonnegative().optional() }).safeParse({ commandId, formula, purpose, visibility, actorId, expectedRevision });
      if (!request.success) return acknowledge({ ok: false, message: "The roll request is malformed." });
      ({ commandId, formula, purpose, visibility, actorId, expectedRevision } = request.data);
      const gm = auth.verify(socket.handshake.auth.token);
      const player = auth.verifyPlayer(socket.handshake.auth.token);
      if (!gm && !player) return acknowledge({ ok: false, message: "Join a session before rolling." });
      if (!gm && visibility === "gm-only") return acknowledge({ ok: false, message: "Only the GM can make a GM-only roll." });
      const initiatorSessionId = gm?.sessionId ?? player!.sessionId;
      const initiatorRole = gm ? "gm" : "player";
      try {
        const resolution = rollDice(formula, (sides) => randomInt(1, sides + 1));
        const rollId = randomUUID();
        const result = await store.execute({ id: commandId, type: "dice.roll", actorId, expectedRevision }, (state) => {
          if (actorId && !gm) {
            const actor = state.actors.find((candidate) => candidate.id === actorId);
            if (!actor || actor.ownerSessionId !== player!.sessionId) throw new CommandRejectedError("You may only roll for your claimed character.");
          }
          let group = 0;
          const dice = resolution.terms.flatMap((term) => {
            if (term.kind !== "dice") return [];
            const currentGroup = group++;
            return term.dice.map((die) => ({ group: currentGroup, sides: term.sides, face: die.face, kept: die.kept, sign: term.sign }));
          });
          const initiatorLabel = initiatorRole === "gm" ? "GM" : state.actors.find((candidate) => candidate.ownerSessionId === initiatorSessionId)?.name ?? "A player";
          const record: RollRecord = {
            id: rollId, commandId, initiatorSessionId, initiatorRole, initiatorLabel, actorId: actorId ?? null, purpose, visibility, formula,
            normalizedFormula: resolution.expression.normalized,
            dice,
            modifiers: resolution.terms.filter((term): term is Extract<typeof term, { kind: "modifier" }> => term.kind === "modifier").map((term) => ({ value: term.value, sign: term.sign })),
            total: resolution.total, createdAt: new Date().toISOString()
          };
          state.rolls.push(record);
          if (state.rolls.length > 200) state.rolls.splice(0, state.rolls.length - 200);
        });
        const accepted = result.state.rolls.find((roll) => roll.commandId === commandId);
        if (!result.duplicate) await publishGameState(result.state);
        acknowledge({ ok: true, revision: result.state.revision, duplicate: result.duplicate, rollId: accepted?.id, hiddenFromRoller: visibility === "blind" && !gm });
      } catch (error) { acknowledge({ ok: false, message: error instanceof Error ? error.message : "The roll failed." }); }
    });
    socket.on("encounter:start", async (payload, acknowledge) => {
      if (!auth.verify(socket.handshake.auth.token)) return acknowledge({ ok: false, message: "Only the GM can start an encounter." });
      const request = EncounterStartSchema.safeParse(payload);
      if (!request.success) return acknowledge({ ok: false, message: "The encounter setup is malformed." });
      const encounterMap = mapCatalog.get(request.data.mapAssetId);
      if (!encounterMap || encounterMap.kind !== "battlemap") return acknowledge({ ok: false, message: "Select an uploaded battlemap before starting the encounter." });
      try {
        const { commandId, mapAssetId, entries, expectedRevision } = request.data;
        const tokenGeometry = await tokenGeometryFor(mapAssetId);
        const result = await store.execute({ id: commandId, type: "encounter.start", expectedRevision }, (state) => startEncounter(state, { mapAssetId, entries }, () => randomInt(1, 21), tokenGeometry));
        if (!result.duplicate) await publishGameState(result.state);
        acknowledge({ ok: true, revision: result.state.revision, duplicate: result.duplicate });
      } catch (error) { acknowledge({ ok: false, message: error instanceof Error ? error.message : "The encounter could not start." }); }
    });
    socket.on("encounter:end", async (payload, acknowledge) => {
      if (!auth.verify(socket.handshake.auth.token)) return acknowledge({ ok: false, message: "Only the GM can end an encounter." });
      const request = CommandIdentitySchema.safeParse(payload);
      if (!request.success) return acknowledge({ ok: false, message: "The encounter command is malformed." });
      try {
        const result = await store.execute({ id: request.data.commandId, type: "encounter.end", expectedRevision: request.data.expectedRevision }, endEncounter);
        if (!result.duplicate) await publishGameState(result.state);
        acknowledge({ ok: true, revision: result.state.revision, duplicate: result.duplicate });
      } catch (error) { acknowledge({ ok: false, message: error instanceof Error ? error.message : "The encounter could not end." }); }
    });
    socket.on("initiative:set", async (payload, acknowledge) => {
      if (!auth.verify(socket.handshake.auth.token)) return acknowledge({ ok: false, message: "Only the GM can change Initiative." });
      const request = InitiativeScoreSchema.safeParse(payload);
      if (!request.success) return acknowledge({ ok: false, message: "The Initiative update is malformed." });
      try {
        const { commandId, actorId, score, expectedRevision } = request.data;
        const result = await store.execute({ id: commandId, type: "initiative.set", actorId, expectedRevision }, (state) => setInitiativeScore(state, actorId, score));
        if (!result.duplicate) await publishGameState(result.state);
        acknowledge({ ok: true, revision: result.state.revision, duplicate: result.duplicate });
      } catch (error) { acknowledge({ ok: false, message: error instanceof Error ? error.message : "Initiative could not be updated." }); }
    });
    socket.on("initiative:next", async (payload, acknowledge) => {
      if (!auth.verify(socket.handshake.auth.token)) return acknowledge({ ok: false, message: "Only the GM can advance Initiative." });
      const request = CommandIdentitySchema.safeParse(payload);
      if (!request.success) return acknowledge({ ok: false, message: "The Initiative command is malformed." });
      try {
        const result = await store.execute({ id: request.data.commandId, type: "initiative.next", expectedRevision: request.data.expectedRevision }, nextInitiativeTurn);
        if (!result.duplicate) await publishGameState(result.state);
        acknowledge({ ok: true, revision: result.state.revision, duplicate: result.duplicate });
      } catch (error) { acknowledge({ ok: false, message: error instanceof Error ? error.message : "Initiative could not advance." }); }
    });
    socket.on("initiative:previous", async (payload, acknowledge) => {
      if (!auth.verify(socket.handshake.auth.token)) return acknowledge({ ok: false, message: "Only the GM can move Initiative backward." });
      const request = CommandIdentitySchema.safeParse(payload);
      if (!request.success) return acknowledge({ ok: false, message: "The Initiative command is malformed." });
      try {
        const result = await store.execute({ id: request.data.commandId, type: "initiative.previous", expectedRevision: request.data.expectedRevision }, previousInitiativeTurn);
        if (!result.duplicate) await publishGameState(result.state);
        acknowledge({ ok: true, revision: result.state.revision, duplicate: result.duplicate });
      } catch (error) { acknowledge({ ok: false, message: error instanceof Error ? error.message : "Initiative could not move backward." }); }
    });
    socket.on("token:move", async (payload, acknowledge) => {
      const request = TokenMoveSchema.safeParse(payload);
      if (!request.success) return acknowledge({ ok: false, message: "The token move is malformed." });
      const gm = auth.verify(socket.handshake.auth.token);
      const player = auth.verifyPlayer(socket.handshake.auth.token);
      if (!gm && !player) return acknowledge({ ok: false, message: "Join a session before moving tokens." });
      const mapAssetId = store.snapshot.combat.mapAssetId;
      if (!mapAssetId) return acknowledge({ ok: false, message: "Start an encounter before moving tokens." });
      try {
        const geometry = await tokenGeometryFor(mapAssetId);
        const { commandId, actorId, position, expectedRevision } = request.data;
        const result = await store.execute({ id: commandId, type: "token.move", actorId, expectedRevision }, (state) => {
          if (state.combat.mapAssetId !== mapAssetId) throw new CommandRejectedError("The active encounter changed. Try moving the token again.");
          if (!gm) {
            const actor = state.actors.find((candidate) => candidate.id === actorId);
            if (!actor || actor.ownerSessionId !== player!.sessionId) throw new CommandRejectedError("You may only move your claimed character token.");
          }
          moveEncounterToken(state, actorId, position, geometry);
        });
        if (!result.duplicate) await publishGameState(result.state);
        acknowledge({ ok: true, revision: result.state.revision, duplicate: result.duplicate });
      } catch (error) { acknowledge({ ok: false, message: error instanceof Error ? error.message : "The token could not be moved." }); }
    });
    socket.on("annotation:add", async (payload, acknowledge) => {
      const request = AnnotationAddSchema.safeParse(payload);
      if (!request.success) return acknowledge({ ok: false, message: "The annotation is malformed." });
      const gm = auth.verify(socket.handshake.auth.token);
      const player = auth.verifyPlayer(socket.handshake.auth.token);
      if (!gm && !player) return acknowledge({ ok: false, message: "Join a session before adding to the map." });
      const mapAssetId = store.snapshot.combat.mapAssetId;
      if (!mapAssetId) return acknowledge({ ok: false, message: "Start an encounter before adding to the map." });
      try {
        const geometry = await tokenGeometryFor(mapAssetId);
        const { commandId, kind, shape, geometry: geometryInput, visibility, expectedRevision } = request.data;
        const actor = { sessionId: gm?.sessionId ?? player!.sessionId, role: (gm ? "gm" : "player") as "gm" | "player" };
        const result = await store.execute({ id: commandId, type: "annotation.add", expectedRevision }, (state) => {
          if (state.combat.mapAssetId !== mapAssetId) throw new CommandRejectedError("The active encounter changed. Try again.");
          addAnnotation(state, { id: commandId, kind, shape, origin: geometryInput.origin, target: geometryInput.target, visibility: visibility ?? "public", actor, now: Date.now() }, geometry);
        });
        if (!result.duplicate) { await publishGameState(result.state); scheduleAnnotationExpiry(); }
        acknowledge({ ok: true, revision: result.state.revision, duplicate: result.duplicate, annotationId: commandId });
      } catch (error) { acknowledge({ ok: false, message: error instanceof Error ? error.message : "That could not be added to the map." }); }
    });
    socket.on("annotation:move", async (payload, acknowledge) => {
      const request = AnnotationMoveSchema.safeParse(payload);
      if (!request.success) return acknowledge({ ok: false, message: "The annotation update is malformed." });
      const gm = auth.verify(socket.handshake.auth.token);
      const player = auth.verifyPlayer(socket.handshake.auth.token);
      if (!gm && !player) return acknowledge({ ok: false, message: "Join a session before editing the map." });
      const mapAssetId = store.snapshot.combat.mapAssetId;
      if (!mapAssetId) return acknowledge({ ok: false, message: "Start an encounter before editing the map." });
      try {
        const geometry = await tokenGeometryFor(mapAssetId);
        const { commandId, id, geometry: geometryInput, expectedRevision } = request.data;
        const actor = { sessionId: gm?.sessionId ?? player!.sessionId, role: (gm ? "gm" : "player") as "gm" | "player" };
        const result = await store.execute({ id: commandId, type: "annotation.move", expectedRevision }, (state) => {
          moveAnnotation(state, id, geometryInput.origin, geometryInput.target, actor, geometry);
        });
        if (!result.duplicate) await publishGameState(result.state);
        acknowledge({ ok: true, revision: result.state.revision, duplicate: result.duplicate });
      } catch (error) { acknowledge({ ok: false, message: error instanceof Error ? error.message : "That could not be moved." }); }
    });
    socket.on("annotation:remove", async (payload, acknowledge) => {
      const request = AnnotationRemoveSchema.safeParse(payload);
      if (!request.success) return acknowledge({ ok: false, message: "The annotation command is malformed." });
      const gm = auth.verify(socket.handshake.auth.token);
      const player = auth.verifyPlayer(socket.handshake.auth.token);
      if (!gm && !player) return acknowledge({ ok: false, message: "Join a session before editing the map." });
      try {
        const { commandId, id, expectedRevision } = request.data;
        const actor = { sessionId: gm?.sessionId ?? player!.sessionId, role: (gm ? "gm" : "player") as "gm" | "player" };
        const result = await store.execute({ id: commandId, type: "annotation.remove", expectedRevision }, (state) => { removeAnnotation(state, id, actor); });
        if (!result.duplicate) await publishGameState(result.state);
        acknowledge({ ok: true, revision: result.state.revision, duplicate: result.duplicate });
      } catch (error) { acknowledge({ ok: false, message: error instanceof Error ? error.message : "That could not be removed." }); }
    });
    socket.on("annotation:set-visibility", async (payload, acknowledge) => {
      const request = AnnotationVisibilitySetSchema.safeParse(payload);
      if (!request.success) return acknowledge({ ok: false, message: "The visibility change is malformed." });
      const gm = auth.verify(socket.handshake.auth.token);
      const player = auth.verifyPlayer(socket.handshake.auth.token);
      if (!gm && !player) return acknowledge({ ok: false, message: "Join a session before editing the map." });
      try {
        const { commandId, id, visibility, expectedRevision } = request.data;
        const actor = { sessionId: gm?.sessionId ?? player!.sessionId, role: (gm ? "gm" : "player") as "gm" | "player" };
        const result = await store.execute({ id: commandId, type: "annotation.set-visibility", expectedRevision }, (state) => { setAnnotationVisibility(state, id, visibility, actor); });
        if (!result.duplicate) await publishGameState(result.state);
        acknowledge({ ok: true, revision: result.state.revision, duplicate: result.duplicate });
      } catch (error) { acknowledge({ ok: false, message: error instanceof Error ? error.message : "The visibility could not be changed." }); }
    });
    socket.emit("state:updated", projectPlayerView(store.snapshot, auth.verifyPlayer(socket.handshake.auth.token)?.sessionId, presenceFor));
  });

  async function initialize() {
    await Promise.all([auth.initialize(), store.initialize(), credentials.initialize(), mapAssets.initialize(), mapCatalog.initialize(), viewerAccess.initialize(), viewerPresentation.initialize()]);
    const persisted = store.snapshot;
    if (persisted.combat.active && persisted.combat.mapAssetId && persisted.combat.initiative.some((entry) => !persisted.combat.tokens.some((token) => token.actorId === entry.actorId))) {
      try {
        const geometry = await tokenGeometryFor(persisted.combat.mapAssetId);
        await store.execute({ id: `encounter.tokens.prepare:${persisted.revision}`, type: "encounter.tokens.prepare" }, (state) => { ensureEncounterTokens(state, geometry); });
      } catch { /* Preserve startup for an old encounter whose map asset was removed; the GM can end it and start a new encounter. */ }
    }
    await viewerCoordinator.synchronizeEncounter(store.snapshot.revision, projectViewerEncounter(store.snapshot));
  }
  function close() { presence.dispose(); viewerCoordinator.dispose(); for (const timer of annotationExpiryTimers) clearTimeout(timer); annotationExpiryTimers.clear(); io.close(); store.close(); credentials.close(); mapCatalog.close(); viewerAccess.close(); viewerPresentation.close(); }

  return { app, httpServer, io, auth, store, credentials, presence, mapAssets, mapCatalog, viewerAccess, viewerPresentation, viewerCoordinator, initialize, close };
}
