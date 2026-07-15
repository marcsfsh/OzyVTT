import { createServer } from "node:http";
import { randomInt, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "socket.io";
import { z } from "zod";
import { RollPurposeSchema, RollVisibilitySchema, type ClientToServerEvents, type ClientRole, type RollRecord, type ServerToClientEvents } from "@vtt/domain";
import { rollDice } from "@vtt/rules-5e";
import { AuthService } from "./auth.js";
import { claimCharacter, forceReleaseCharacter, releaseCharactersForSession } from "./character-claims.js";
import { developmentClientUrl } from "./client-hosting.js";
import { CommandRejectedError, GameStore, RevisionConflictError } from "./game-store.js";
import { createInitialGameState } from "./initial-game-state.js";
import { projectGmView, projectPlayerView } from "./projections.js";

const port = Number(process.env.PORT ?? 3001);
const developmentClientPort = 5173;
const dataDir = process.env.DATA_DIR ?? join(process.cwd(), "data");
const clientOrigin = process.env.CLIENT_ORIGIN;
const webDist = join(fileURLToPath(new URL("../../client/dist", import.meta.url)));
const hasBuiltClient = existsSync(join(webDist, "index.html"));
const useDevelopmentClient = process.env.npm_lifecycle_event === "dev" || !hasBuiltClient;
const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, { cors: clientOrigin ? { origin: clientOrigin } : undefined });
const auth = new AuthService(join(dataDir, "auth.json"));
const store = new GameStore(join(dataDir, "vtt.sqlite"), createInitialGameState());

function lanUrls(portNumber: number) {
  const addresses = new Set<string>();
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.add(`http://${entry.address}:${portNumber}`);
    }
  }
  return [...addresses];
}

const isLoopback = (ip: string | undefined) => ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
function roleFor(socketId: string): ClientRole { return auth.verify(io.sockets.sockets.get(socketId)?.handshake.auth?.token) ? "gm" : "player"; }
function broadcast() {
  const state = store.snapshot;
  for (const socket of io.sockets.sockets.values()) {
    const gm = auth.verify(socket.handshake.auth?.token);
    const player = auth.verifyPlayer(socket.handshake.auth?.token);
    socket.emit("state:updated", gm ? projectGmView(state) : projectPlayerView(state, player?.sessionId));
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
  const result = z.object({ password: z.string() }).safeParse(req.body);
  if (!result.success) return res.status(400).json({ message: "Password is required." });
  const token = await auth.login(result.data.password);
  return token ? res.json({ token }) : res.status(401).json({ message: "Invalid GM password." });
});
app.get("/api/state", (req, res) => {
  const token = req.header("authorization")?.replace("Bearer ", "");
  const state = store.snapshot;
  res.json(auth.verify(token) ? projectGmView(state) : projectPlayerView(state, auth.verifyPlayer(token)?.sessionId));
});
app.use("/api", (_req, res) => res.status(404).json({ message: "API route not found." }));
if (!useDevelopmentClient) {
  app.use(express.static(webDist));
  app.get("/{*path}", (_req, res) => res.sendFile(join(webDist, "index.html")));
} else {
  app.get("/{*path}", (req, res) => res.redirect(307, developmentClientUrl(req.hostname, req.originalUrl, developmentClientPort)));
}

io.on("connection", (socket) => {
  socket.on("session:join", ({ token }, acknowledge) => {
    socket.handshake.auth.token = token;
    const gm = auth.verify(token);
    if (gm) { acknowledge({ ok: true, role: "gm", sessionId: gm.sessionId }); socket.emit("state:updated", projectGmView(store.snapshot)); return; }
    const existingPlayer = auth.verifyPlayer(token);
    if (existingPlayer) { acknowledge({ ok: true, role: "player", sessionId: existingPlayer.sessionId, token }); socket.emit("state:updated", projectPlayerView(store.snapshot, existingPlayer.sessionId)); return; }
    if (!auth.isBootstrapped) return acknowledge({ ok: false, message: "The host must complete GM setup before players join." });
    const playerToken = auth.issuePlayerSession();
    socket.handshake.auth.token = playerToken;
    const player = auth.verifyPlayer(playerToken)!;
    acknowledge({ ok: true, role: "player", sessionId: player.sessionId, token: playerToken });
    socket.emit("state:updated", projectPlayerView(store.snapshot, player.sessionId));
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
  socket.emit("state:updated", projectPlayerView(store.snapshot, auth.verifyPlayer(socket.handshake.auth.token)?.sessionId));
});

await Promise.all([auth.initialize(), store.initialize()]);
httpServer.listen(port, "0.0.0.0", () => {
  if (!useDevelopmentClient) {
    console.log(`VTT server ready on http://localhost:${port}`);
    for (const url of lanUrls(port)) console.log(`LAN join URL: ${url}`);
  } else {
    console.log(`VTT API ready on http://localhost:${port}`);
    console.log(`Development client: http://localhost:${developmentClientPort}`);
    for (const url of lanUrls(developmentClientPort)) console.log(`LAN development client: ${url}`);
  }
});
