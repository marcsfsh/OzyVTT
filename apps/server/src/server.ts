import { createServer as createHttpServer } from "node:http";
import { randomInt, randomUUID } from "node:crypto";
import { join } from "node:path";
import express, { type Express } from "express";
import { Server } from "socket.io";
import { z } from "zod";
import { RollPurposeSchema, RollVisibilitySchema, type ClientToServerEvents, type ClientRole, type GameState, type RollRecord, type ServerToClientEvents } from "@vtt/domain";
import { rollDice } from "@vtt/rules-5e";
import { AuthService } from "./auth.js";
import { claimCharacter, forceReleaseCharacter, releaseCharactersForSession } from "./character-claims.js";
import { developmentClientUrl } from "./client-hosting.js";
import { CommandRejectedError, GameStore, RevisionConflictError } from "./game-store.js";
import { createInitialGameState } from "./initial-game-state.js";
import { LoginRateLimiter } from "./login-rate-limit.js";
import { PresenceRegistry } from "./presence.js";
import { projectGmView, projectPlayerView } from "./projections.js";

export type CreateServerOptions = {
  authPath: string;
  databasePath: string;
  webDist: string;
  useDevelopmentClient: boolean;
  developmentClientPort: number;
  clientOrigin?: string;
  initialGameState?: GameState;
  /** How long a session's presence stays "reconnecting" after its last connection drops before flipping to "offline". */
  presenceGraceMs?: number;
};

const isLoopback = (ip: string | undefined) => ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";

export function createServer(options: CreateServerOptions) {
  const app: Express = express();
  const httpServer = createHttpServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, { cors: options.clientOrigin ? { origin: options.clientOrigin } : undefined });
  const auth = new AuthService(options.authPath);
  const store = new GameStore(options.databasePath, options.initialGameState ?? createInitialGameState());
  const gmLoginRateLimiter = new LoginRateLimiter();
  const presence = new PresenceRegistry(options.presenceGraceMs ?? 8000, () => broadcast());
  const presenceFor = (sessionId: string) => presence.statusFor(sessionId);

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
  app.use("/api", (_req, res) => res.status(404).json({ message: "API route not found." }));
  if (!options.useDevelopmentClient) {
    app.use(express.static(options.webDist));
    app.get("/{*path}", (_req, res) => res.sendFile(join(options.webDist, "index.html")));
  } else {
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
        if (!result.duplicate) broadcast(); acknowledge({ ok: true, revision: result.state.revision, duplicate: result.duplicate });
      } catch (error) { acknowledge({ ok: false, message: error instanceof Error ? error.message : "The character claim failed." }); }
    });
    socket.on("character:release", async ({ commandId, expectedRevision }, acknowledge) => {
      const sessionId = auth.verifyPlayer(socket.handshake.auth.token)?.sessionId; if (!sessionId) return acknowledge({ ok: false, message: "Join a session first." });
      try {
        const result = await store.execute({ id: commandId, type: "character.release", expectedRevision }, (state) => releaseCharactersForSession(state, sessionId));
        if (!result.duplicate) broadcast(); acknowledge({ ok: true, revision: result.state.revision, duplicate: result.duplicate });
      } catch (error) { acknowledge({ ok: false, message: error instanceof Error ? error.message : "The character release failed." }); }
    });
    socket.on("character:force-release", async ({ commandId, actorId, expectedRevision }, acknowledge) => {
      if (!auth.verify(socket.handshake.auth.token)) return acknowledge({ ok: false, message: "Only the GM can force-release a character." });
      try {
        const result = await store.execute({ id: commandId, type: "character.force-release", actorId, expectedRevision }, (state) => forceReleaseCharacter(state, actorId, "gm"));
        if (!result.duplicate) broadcast(); acknowledge({ ok: true, revision: result.state.revision, duplicate: result.duplicate });
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
          const record: RollRecord = {
            id: rollId, commandId, initiatorSessionId, initiatorRole, actorId: actorId ?? null, purpose, visibility, formula,
            normalizedFormula: resolution.expression.normalized,
            dice,
            modifiers: resolution.terms.filter((term): term is Extract<typeof term, { kind: "modifier" }> => term.kind === "modifier").map((term) => ({ value: term.value, sign: term.sign })),
            total: resolution.total, createdAt: new Date().toISOString()
          };
          state.rolls.push(record);
          if (state.rolls.length > 200) state.rolls.splice(0, state.rolls.length - 200);
        });
        const accepted = result.state.rolls.find((roll) => roll.commandId === commandId);
        if (!result.duplicate) broadcast();
        acknowledge({ ok: true, revision: result.state.revision, duplicate: result.duplicate, rollId: accepted?.id, hiddenFromRoller: visibility === "blind" && !gm });
      } catch (error) { acknowledge({ ok: false, message: error instanceof Error ? error.message : "The roll failed." }); }
    });
    socket.emit("state:updated", projectPlayerView(store.snapshot, auth.verifyPlayer(socket.handshake.auth.token)?.sessionId, presenceFor));
  });

  async function initialize() { await Promise.all([auth.initialize(), store.initialize()]); }
  function close() { presence.dispose(); io.close(); store.close(); }

  return { app, httpServer, io, auth, store, presence, initialize, close };
}
