import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "socket.io";
import { z } from "zod";
import type { ClientToServerEvents, ClientRole, GmView, PlayerView, ServerToClientEvents } from "@vtt/domain";
import { AuthService } from "./auth.js";
import { GameStore } from "./game-store.js";

const port = Number(process.env.PORT ?? 3001);
const dataDir = process.env.DATA_DIR ?? join(process.cwd(), "data");
const clientOrigin = process.env.CLIENT_ORIGIN;
const webDist = join(fileURLToPath(new URL("../../client/dist", import.meta.url)));
const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, { cors: clientOrigin ? { origin: clientOrigin } : undefined });
const auth = new AuthService(join(dataDir, "auth.json"));
const store = new GameStore(join(dataDir, "game-state.json"));
const playerSessions = new Map<string, string>(); // socket.id -> stable browser session id (future cookie-backed)

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
const playerView = (): PlayerView => {
  const state = store.snapshot;
  return { combat: state.combat, actors: state.actors.filter((actor) => actor.visibility === "public").map(({ notes: _notes, ownerSessionId: _owner, ...actor }) => actor) };
};
const gmView = (): GmView => store.snapshot;
function roleFor(socketId: string): ClientRole { return auth.verify(io.sockets.sockets.get(socketId)?.handshake.auth?.token) ? "gm" : "player"; }
function broadcast() {
  for (const socket of io.sockets.sockets.values()) socket.emit("state:updated", roleFor(socket.id) === "gm" ? gmView() : playerView());
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
app.get("/api/state", (req, res) => res.json(auth.verify(req.header("authorization")?.replace("Bearer ", "")) ? gmView() : playerView()));
app.use(express.static(webDist));
app.get("/{*path}", (_req, res) => res.sendFile(join(webDist, "index.html")));

io.on("connection", (socket) => {
  socket.on("session:join", ({ token }, acknowledge) => {
    socket.handshake.auth.token = token;
    const gm = auth.verify(token);
    if (gm) return acknowledge({ ok: true, role: "gm", sessionId: gm.sessionId });
    const sessionId = playerSessions.get(socket.id) ?? randomUUID();
    playerSessions.set(socket.id, sessionId);
    acknowledge({ ok: true, role: "player", sessionId });
  });
  socket.on("character:claim", async ({ actorId }, acknowledge) => {
    if (roleFor(socket.id) !== "player") return acknowledge({ ok: false, message: "GM sessions do not claim player characters." });
    const sessionId = playerSessions.get(socket.id); if (!sessionId) return acknowledge({ ok: false, message: "Join a session first." });
    let message: string | undefined;
    await store.mutate((state) => { const actor = state.actors.find((item) => item.id === actorId && item.kind === "player-character"); if (!actor) message = "Character is unavailable."; else if (actor.ownerSessionId && actor.ownerSessionId !== sessionId) message = "That character is already claimed."; else actor.ownerSessionId = sessionId; });
    if (message) return acknowledge({ ok: false, message }); broadcast(); acknowledge({ ok: true });
  });
  socket.on("character:release", async (acknowledge) => {
    const sessionId = playerSessions.get(socket.id); if (!sessionId) return acknowledge({ ok: false, message: "Join a session first." });
    await store.mutate((state) => state.actors.forEach((actor) => { if (actor.ownerSessionId === sessionId) actor.ownerSessionId = null; }));
    broadcast(); acknowledge({ ok: true });
  });
  socket.emit("state:updated", playerView());
});

await Promise.all([auth.initialize(), store.initialize()]);
httpServer.listen(port, "0.0.0.0", () => {
  console.log(`VTT server ready on http://localhost:${port}`);
  for (const url of lanUrls(port)) console.log(`LAN join URL: ${url}`);
});
