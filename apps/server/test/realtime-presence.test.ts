import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GmView, PlayerView, SessionJoinResult } from "@vtt/domain";
import { io as ioClient, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type CreateServerOptions } from "../src/server.js";

const PASSWORD = "correct horse battery staple";
type AnyView = GmView | PlayerView;

async function startTestServer(overrides: Partial<CreateServerOptions> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "vtt-presence-"));
  const server = createServer({
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integration-credentials.sqlite"),
    webDist: directory,
    useDevelopmentClient: true,
    developmentClientPort: 5173,
    presenceGraceMs: 150,
    ...overrides
  });
  await server.initialize();
  await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Expected an AddressInfo from an ephemeral listener.");
  const url = `http://127.0.0.1:${address.port}`;
  return {
    ...server,
    url,
    async close() {
      server.close();
      await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  };
}

async function bootstrapGm(url: string) {
  const response = await fetch(`${url}/api/v1/host/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD })
  });
  if (!response.ok) throw new Error(`bootstrap failed with status ${response.status}`);
}

async function loginGm(url: string) {
  const response = await fetch(`${url}/api/v1/host/gm/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD })
  });
  const body = (await response.json()) as { data: { token: string } };
  return body.data.token;
}

/** Collects every `state:updated` payload a socket receives, so tests can wait for convergence. */
function trackState(socket: Socket) {
  let latest: AnyView | undefined;
  socket.on("state:updated", (state: AnyView) => {
    latest = state;
  });
  return () => latest;
}

const openSockets: Socket[] = [];

/** Connects and joins with the same token, as the real client does. The tracker attaches before the join so the post-join broadcast is not missed. */
async function connectAndJoin(url: string, token?: string) {
  const socket = ioClient(url, { auth: { token }, transports: ["websocket"], forceNew: true, reconnection: false });
  openSockets.push(socket);
  const getState = trackState(socket);
  const join = await new Promise<SessionJoinResult>((resolve) => socket.emit("session:join", { token }, resolve));
  return { socket, join, getState };
}

async function waitFor<T>(
  getValue: () => T,
  predicate: (value: T) => boolean,
  { timeoutMs = 2000, intervalMs = 20 } = {}
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = getValue();
    if (predicate(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for condition. Last value: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

afterEach(() => {
  for (const socket of openSockets.splice(0)) socket.close();
});

describe("realtime presence, reconnect, and convergence", () => {
  it("registers presence only for a verified session, reports it online immediately, and reports null presence before any claim", async () => {
    const server = await startTestServer();
    try {
      await bootstrapGm(server.url);
      const player = await connectAndJoin(server.url);
      expect(player.join.ok).toBe(true);
      expect(server.presence.statusFor(player.join.sessionId!)).toBe("online");

      const view = await waitFor(player.getState, (state): state is PlayerView => !!state && "actors" in state);
      expect((view as PlayerView).actors.every((actor) => actor.presence === null)).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("keeps a session online while any of its multiple connections remain open, and only leaves once the last one drops", async () => {
    const server = await startTestServer();
    try {
      await bootstrapGm(server.url);
      const first = await connectAndJoin(server.url);
      const sessionId = first.join.sessionId!;
      const rememberedToken = first.join.token!;

      const second = await connectAndJoin(server.url, rememberedToken);
      expect(second.join.sessionId).toBe(sessionId);
      expect(server.presence.statusFor(sessionId)).toBe("online");

      first.socket.close();
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(server.presence.statusFor(sessionId)).toBe("online");

      second.socket.close();
      await waitFor(
        () => server.presence.statusFor(sessionId),
        (status) => status !== "online",
        { timeoutMs: 500 }
      );
      expect(server.presence.statusFor(sessionId)).toBe("reconnecting");
    } finally {
      await server.close();
    }
  });

  it("enters a reconnecting grace period on disconnect and only becomes offline once the grace period elapses", async () => {
    const server = await startTestServer();
    try {
      await bootstrapGm(server.url);
      const gm = await connectAndJoin(server.url, await loginGm(server.url));
      const gmState = await waitFor(
        gm.getState,
        (state): state is GmView => !!state && (state as GmView).actors.length > 0
      );
      const actorId = (gmState as GmView).actors[0].id;

      const player = await connectAndJoin(server.url);
      const claim = await new Promise<{ ok: boolean }>((resolve) =>
        player.socket.emit("character:claim", { commandId: crypto.randomUUID(), actorId, expectedRevision: 0 }, resolve)
      );
      expect(claim.ok).toBe(true);

      await waitFor(
        gm.getState,
        (state) => (state as GmView).actors.find((actor) => actor.id === actorId)?.presence === "online"
      );

      player.socket.close();
      const reconnecting = await waitFor(
        gm.getState,
        (state) => (state as GmView).actors.find((actor) => actor.id === actorId)?.presence === "reconnecting",
        { timeoutMs: 500 }
      );
      expect((reconnecting as GmView).actors.find((actor) => actor.id === actorId)?.presence).toBe("reconnecting");

      await waitFor(
        gm.getState,
        (state) => (state as GmView).actors.find((actor) => actor.id === actorId)?.presence === "offline",
        { timeoutMs: 1000 }
      );
    } finally {
      await server.close();
    }
  });

  it("cancels the reconnecting grace period and recovers the same presence and claimed character for a remembered player token", async () => {
    const server = await startTestServer({ presenceGraceMs: 400 });
    try {
      await bootstrapGm(server.url);
      const gm = await connectAndJoin(server.url, await loginGm(server.url));
      const gmState = await waitFor(
        gm.getState,
        (state): state is GmView => !!state && (state as GmView).actors.length > 0
      );
      const actorId = (gmState as GmView).actors[0].id;

      const player = await connectAndJoin(server.url);
      const rememberedToken = player.join.token!;
      const sessionId = player.join.sessionId!;
      await new Promise<{ ok: boolean }>((resolve) =>
        player.socket.emit("character:claim", { commandId: crypto.randomUUID(), actorId, expectedRevision: 0 }, resolve)
      );
      player.socket.close();

      await waitFor(
        () => server.presence.statusFor(sessionId),
        (status) => status === "reconnecting",
        { timeoutMs: 300 }
      );

      const reconnected = await connectAndJoin(server.url, rememberedToken);
      expect(reconnected.join.sessionId).toBe(sessionId);
      expect(server.presence.statusFor(sessionId)).toBe("online");

      const reconnectedView = await waitFor(
        reconnected.getState,
        (state): state is PlayerView => !!state && "claimStatus" in ((state as PlayerView).actors[0] ?? {})
      );
      const claimedActor = (reconnectedView as PlayerView).actors.find((actor) => actor.id === actorId);
      expect(claimedActor?.claimStatus).toBe("mine");
      expect(claimedActor?.presence).toBe("online");

      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(server.presence.statusFor(sessionId)).toBe("online");
    } finally {
      await server.close();
    }
  });

  it("lets exactly one of two racing players claim the same character and converges both clients on the same outcome", async () => {
    const server = await startTestServer();
    try {
      await bootstrapGm(server.url);
      const gm = await connectAndJoin(server.url, await loginGm(server.url));
      const gmState = await waitFor(
        gm.getState,
        (state): state is GmView => !!state && (state as GmView).actors.length > 0
      );
      const actorId = (gmState as GmView).actors[0].id;

      const [playerA, playerB] = await Promise.all([connectAndJoin(server.url), connectAndJoin(server.url)]);
      expect(playerA.join.sessionId).not.toBe(playerB.join.sessionId);

      const [resultA, resultB] = await Promise.all([
        new Promise<{ ok: boolean }>((resolve) =>
          playerA.socket.emit(
            "character:claim",
            { commandId: crypto.randomUUID(), actorId, expectedRevision: 0 },
            resolve
          )
        ),
        new Promise<{ ok: boolean }>((resolve) =>
          playerB.socket.emit(
            "character:claim",
            { commandId: crypto.randomUUID(), actorId, expectedRevision: 0 },
            resolve
          )
        )
      ]);
      expect([resultA.ok, resultB.ok].filter(Boolean)).toHaveLength(1);

      const finalGmState = await waitFor(
        gm.getState,
        (state) => (state as GmView).actors.find((actor) => actor.id === actorId)?.ownerSessionId !== null
      );
      const owner = (finalGmState as GmView).actors.find((actor) => actor.id === actorId)?.ownerSessionId;
      expect([playerA.join.sessionId, playerB.join.sessionId]).toContain(owner);

      const winner = resultA.ok ? playerA : playerB;
      const winnerView = await waitFor(
        winner.getState,
        (state): state is PlayerView => !!state && (state as PlayerView).actors.some((actor) => actor.id === actorId)
      );
      expect((winnerView as PlayerView).actors.find((actor) => actor.id === actorId)?.claimStatus).toBe("mine");
      expect(winner.join.sessionId).toBe(owner);
    } finally {
      await server.close();
    }
  });

  it("converges every connected client after force-release, a duplicate command retry, and a stale-revision conflict", async () => {
    const server = await startTestServer();
    try {
      await bootstrapGm(server.url);
      const gm = await connectAndJoin(server.url, await loginGm(server.url));
      const gmState = await waitFor(
        gm.getState,
        (state): state is GmView => !!state && (state as GmView).actors.length > 0
      );
      const actorId = (gmState as GmView).actors[0].id;

      const player = await connectAndJoin(server.url);
      const observer = await connectAndJoin(server.url);

      const commandId = crypto.randomUUID();
      const claim = await new Promise<{ ok: boolean; revision?: number }>((resolve) =>
        player.socket.emit("character:claim", { commandId, actorId, expectedRevision: 0 }, resolve)
      );
      expect(claim.ok).toBe(true);

      const retry = await new Promise<{ ok: boolean; duplicate?: boolean; revision?: number }>((resolve) =>
        player.socket.emit("character:claim", { commandId, actorId, expectedRevision: 0 }, resolve)
      );
      expect(retry.duplicate).toBe(true);
      expect(retry.revision).toBe(claim.revision);

      const stale = await new Promise<{ ok: boolean; message?: string }>((resolve) =>
        player.socket.emit("character:release", { commandId: crypto.randomUUID(), expectedRevision: 0 }, resolve)
      );
      expect(stale.ok).toBe(false);

      const forceRelease = await new Promise<{ ok: boolean; revision?: number }>((resolve) =>
        gm.socket.emit(
          "character:force-release",
          { commandId: crypto.randomUUID(), actorId, expectedRevision: claim.revision },
          resolve
        )
      );
      expect(forceRelease.ok).toBe(true);

      await waitFor(
        observer.getState,
        (state) => (state as PlayerView).actors.find((actor) => actor.id === actorId)?.claimStatus === "available"
      );
      await waitFor(
        gm.getState,
        (state) => (state as GmView).actors.find((actor) => actor.id === actorId)?.ownerSessionId === null
      );
      expect((observer.getState() as PlayerView).revision).toBe((gm.getState() as GmView).revision);
    } finally {
      await server.close();
    }
  });

  it("never sends a session ID, token, socket ID, or address in either the player or GM projection", async () => {
    const server = await startTestServer();
    try {
      await bootstrapGm(server.url);
      const gmToken = await loginGm(server.url);
      const gm = await connectAndJoin(server.url, gmToken);
      const gmState = await waitFor(
        gm.getState,
        (state): state is GmView => !!state && (state as GmView).actors.length > 0
      );
      const actorId = (gmState as GmView).actors[0].id;

      const player = await connectAndJoin(server.url);
      await new Promise<{ ok: boolean }>((resolve) =>
        player.socket.emit("character:claim", { commandId: crypto.randomUUID(), actorId, expectedRevision: 0 }, resolve)
      );
      const playerView = await waitFor(
        player.getState,
        (state): state is PlayerView =>
          !!state && (state as PlayerView).actors.some((actor) => actor.id === actorId && actor.claimStatus === "mine")
      );

      const serializedPlayerView = JSON.stringify(playerView);
      expect(serializedPlayerView).not.toContain(player.join.sessionId);
      expect(serializedPlayerView).not.toContain(gm.join.sessionId);
      expect(serializedPlayerView).not.toContain(gmToken);
      expect(serializedPlayerView).not.toContain(player.socket.id);
      expect(
        (playerView as PlayerView).actors.every((actor) => !("ownerSessionId" in actor) && !("notes" in actor))
      ).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("immediately drops a revoked GM session's presence and denies it further GM authority without affecting other sessions", async () => {
    const server = await startTestServer();
    try {
      await bootstrapGm(server.url);
      const revokedToken = await loginGm(server.url);
      const otherToken = await loginGm(server.url);
      const revoked = await connectAndJoin(server.url, revokedToken);
      const other = await connectAndJoin(server.url, otherToken);
      expect(server.presence.statusFor(revoked.join.sessionId!)).toBe("online");

      const logout = await fetch(`${server.url}/api/v1/host/gm/sign-out`, {
        method: "POST",
        headers: { authorization: `Bearer ${revokedToken}` }
      });
      expect(logout.status).toBe(200);

      await waitFor(
        () => server.presence.statusFor(revoked.join.sessionId!),
        (status) => status === null,
        { timeoutMs: 1000 }
      );
      expect(server.presence.statusFor(other.join.sessionId!)).toBe("online");

      const rejoin = await connectAndJoin(server.url, revokedToken);
      expect(rejoin.join.role).not.toBe("gm");
    } finally {
      await server.close();
    }
  });
});

// The `codex:changed` payload, whoever it is sent to, must be a bare revision counter.
// A scope word would tell the table which part of the codex the GM is editing, so this pins the whole
// key set. Observed on a player's socket, the recipient the rule protects.
describe("codex:changed on the wire (socket half)", () => {
  it("emits a bare revision counter, to a player too, and nothing else", async () => {
    const server = await startTestServer();
    try {
      await bootstrapGm(server.url);
      const gmToken = await loginGm(server.url);
      const player = await connectAndJoin(server.url);
      const pings: unknown[] = [];
      player.socket.on("codex:changed", (event: unknown) => {
        pings.push(event);
      });

      // Revealed, so players have something new to read and are pinged.
      const created = await fetch(`${server.url}/api/v1/codex/pages`, {
        method: "POST",
        headers: { authorization: `Bearer ${gmToken}`, "content-type": "application/json" },
        body: JSON.stringify({ title: "Vallaki", revealedToPlayers: true })
      });
      expect(created.status).toBe(201);

      await waitFor(
        () => pings,
        (received) => received.length > 0
      );
      for (const event of pings) {
        expect(
          Object.keys(event as Record<string, unknown>),
          "the ping's key set is exactly one revision counter"
        ).toEqual(["codexRevision"]);
        expect(typeof (event as { codexRevision: unknown }).codexRevision).toBe("number");
      }
    } finally {
      await server.close();
    }
  });

  // A ping on a GM-only write would tell the table when the GM is writing secrets, and its counter how much. A
  // player socket, the preview session's included, hears only of writes that change something it can read.
  it("pings a player only for a change the player can read, and the GM for every write", async () => {
    const server = await startTestServer();
    try {
      await bootstrapGm(server.url);
      const gmToken = await loginGm(server.url);
      const codex = async (method: string, path: string, body?: unknown) => {
        const response = await fetch(`${server.url}/api/v1/codex${path}`, {
          method,
          headers: { authorization: `Bearer ${gmToken}`, "content-type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });
        expect(response.ok, `${method} ${path}`).toBe(true);
        return ((await response.json()) as { data: Record<string, any> }).data;
      };
      const listen = (socket: Socket) => {
        const heard: number[] = [];
        socket.on("codex:changed", (event: { codexRevision: number }) => heard.push(event.codexRevision));
        return heard;
      };
      const gm = await connectAndJoin(server.url, gmToken);
      const player = await connectAndJoin(server.url);
      const preview = await connectAndJoin(server.url, (await codex("POST", "/preview-session")).token);
      const gmPings = listen(gm.socket);
      const playerPings = listen(player.socket);
      const previewPings = listen(preview.socket);

      const page = (await codex("POST", "/pages", { title: "Lantern Order", revealedToPlayers: true })).page;
      await waitFor(
        () => playerPings,
        (heard) => heard.length === 1
      );

      // Four writes no player can see.
      await codex("POST", `/pages/${page.id}/blocks`, { anchor: 0, text: "A front for the cult." });
      await codex("PATCH", `/pages/${page.id}`, { folder: "Villains" });
      await codex("POST", "/pages", { title: "The real Lantern Order" });
      await codex("POST", "/journal", { playerText: "Prep.", revealedToPlayers: false });
      await waitFor(
        () => gmPings,
        (heard) => heard.length === 5
      );

      // Then one they can. Socket.IO keeps order, so a ping from the writes above would have arrived first.
      await codex("PATCH", `/pages/${page.id}`, { title: "The Lantern Order" });
      await waitFor(
        () => playerPings,
        (heard) => heard.length >= 2
      );
      await waitFor(
        () => previewPings,
        (heard) => heard.length >= 2
      );
      expect(playerPings, "one ping per change a player can read, counted only by those").toEqual([1, 2]);
      expect(previewPings).toEqual([1, 2]);
      await waitFor(
        () => gmPings,
        (heard) => heard.length === 6
      );
    } finally {
      await server.close();
    }
  });

  it("keeps serving after a malformed handshake token, a bare join and an emit without an acknowledgement", async () => {
    const server = await startTestServer();
    try {
      await bootstrapGm(server.url);
      // Each of these once threw out of a socket handler, which takes the whole process down.
      const odd = ioClient(server.url, {
        auth: { token: 5 },
        transports: ["websocket"],
        forceNew: true,
        reconnection: false
      });
      openSockets.push(odd);
      await new Promise<void>((resolve) => odd.once("connect", () => resolve()));
      const refused = await new Promise<{ ok: boolean; message?: string }>((resolve) =>
        odd.emit("content:skills", {}, resolve)
      );
      expect(refused).toEqual({ ok: false, code: "not_joined", message: "Join a session first." });
      odd.emit("session:join");
      odd.emit("content:skills", {});
      const { join } = await connectAndJoin(server.url, await loginGm(server.url));
      expect(join).toMatchObject({ ok: true, role: "gm" });
    } finally {
      await server.close();
    }
  });
});
