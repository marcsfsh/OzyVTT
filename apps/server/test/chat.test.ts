import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameStateSchema, type CombatLogEntry } from "@vtt/domain";
import { io as connect, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { ChatLimiter, cleanChatText } from "../src/chat.js";
import { createServer } from "../src/server.js";

// ADR-0038: table chat in the feed. A public line reaches the GM and every player; a whisper reaches the GM and the
// players of one character and leaves no trace for anyone else. The author comes from the token.

const LYRA = "10000000-0000-4000-8000-000000000001";
const BORIN = "10000000-0000-4000-8000-000000000002";
const pc = (id: string, name: string) => ({
  id,
  name,
  kind: "player-character",
  visibility: "public",
  hp: { current: 20, maximum: 20 },
  initiative: 2
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

type Joined = Readonly<{ socket: Socket; log: CombatLogEntry[]; removed: number[] }>;

async function table() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-chat-"));
  const server = createServer({
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integrations.sqlite"),
    mapAssetsPath: join(directory, "map-assets"),
    webDist: join(directory, "dist"),
    useDevelopmentClient: true,
    developmentClientPort: 5173,
    initialGameState: GameStateSchema.parse({ schemaVersion: 1, actors: [pc(LYRA, "Lyra"), pc(BORIN, "Borin")] })
  });
  await server.initialize();
  await server.auth.bootstrap("a sufficiently long GM password");
  const gmToken = (await server.auth.login("a sufficiently long GM password"))!;
  const lyraToken = server.auth.issuePlayerSession();
  const borinToken = server.auth.issuePlayerSession();
  const loneToken = server.auth.issuePlayerSession();
  await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind.");
  const base = `http://127.0.0.1:${address.port}`;
  const sockets: Socket[] = [];
  cleanups.push(async () => {
    for (const socket of sockets) socket.close();
    server.close();
    await rm(directory, { recursive: true, force: true });
  });
  const join_ = async (token: string): Promise<Joined> => {
    const socket = connect(base, { auth: { token }, transports: ["websocket"], reconnection: false, forceNew: true });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", reject);
    });
    await new Promise((resolve) => socket.emit("session:join", { token }, resolve));
    const log: CombatLogEntry[] = [];
    const removed: number[] = [];
    socket.on("log:entry", (entry: CombatLogEntry) => log.push(entry));
    socket.on("log:removed", (event: { id: number }) => removed.push(event.id));
    return { socket, log, removed };
  };
  const emit = (joined: Joined, event: string, payload: Record<string, unknown>) =>
    new Promise<Record<string, unknown>>((resolve) =>
      (joined.socket.emit as (...args: unknown[]) => void)(event, { commandId: randomUUID(), ...payload }, resolve)
    );
  const gm = await join_(gmToken);
  const lyra = await join_(lyraToken);
  const borin = await join_(borinToken);
  const lone = await join_(loneToken);
  expect(await emit(lyra, "character:claim", { actorId: LYRA })).toMatchObject({ ok: true });
  expect(await emit(borin, "character:claim", { actorId: BORIN })).toMatchObject({ ok: true });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
  await settle();
  const http = (path: string, token: string, body?: unknown) =>
    fetch(`${base}/api/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  const feed = async (token: string) =>
    ((await (await http("/game/log", token)).json()).data.entries as CombatLogEntry[]).filter(
      (entry) => entry.kind === "chat"
    );
  return { gm, lyra, borin, lone, emit, settle, http, feed, gmToken, lyraToken, borinToken };
}

describe("table chat", () => {
  it("sends a public line to everyone, attributed from the token, as plain cleaned text", async () => {
    const { gm, lyra, borin, emit, settle, feed, borinToken } = await table();
    const reply = await emit(lyra, "chat:send", { text: "  Hello\n<b>there</b>\u0007  " });
    expect(reply).toMatchObject({ ok: true });
    await settle();
    for (const reader of [gm, lyra, borin]) {
      const line = reader.log.find((entry) => entry.kind === "chat");
      expect(line).toMatchObject({
        text: "Hello <b>there</b>",
        author: { name: "Lyra", role: "player", actorId: LYRA }
      });
      expect(JSON.stringify(line)).not.toMatch(/session/i);
    }
    expect((await feed(borinToken)).map((entry) => entry.text)).toEqual(["Hello <b>there</b>"]);

    // The GM speaks as the GM, and over HTTP too.
    expect(await emit(gm, "chat:send", { text: "Roll for initiative soon." })).toMatchObject({ ok: true });
    await settle();
    expect(borin.log.at(-1)).toMatchObject({ author: { name: "GM", role: "gm" } });
  });

  it("refuses an empty line, one over 500 characters, one starting with /, and a player with no character", async () => {
    const { lyra, lone, emit } = await table();
    expect(await emit(lyra, "chat:send", { text: " \n " })).toMatchObject({ ok: false });
    expect(await emit(lyra, "chat:send", { text: "é".repeat(500) })).toMatchObject({ ok: true });
    expect(await emit(lyra, "chat:send", { text: "x".repeat(501) })).toMatchObject({ ok: false });
    expect(await emit(lyra, "chat:send", { text: "/roll 1d20" })).toMatchObject({ ok: false });
    expect(await emit(lone, "chat:send", { text: "Hi" })).toMatchObject({ ok: false });
    expect(await emit(lyra, "chat:send", { text: "As Borin", actorId: BORIN })).toMatchObject({ ok: false });
  });

  it("keeps a whisper between the GM and one character, with no trace for the other players", async () => {
    const { gm, lyra, borin, emit, settle, feed, lyraToken, borinToken } = await table();
    expect(await emit(gm, "chat:send", { text: "The idol is fake.", whisperTo: LYRA })).toMatchObject({ ok: true });
    expect(await emit(lyra, "chat:send", { text: "I pocket it anyway.", whisperTo: "gm" })).toMatchObject({
      ok: true
    });
    await settle();
    expect(gm.log.filter((entry) => entry.whisper).map((entry) => entry.text)).toEqual([
      "The idol is fake.",
      "I pocket it anyway."
    ]);
    expect(lyra.log.filter((entry) => entry.whisper?.characterId === LYRA)).toHaveLength(2);
    expect(borin.log.filter((entry) => entry.kind === "chat")).toEqual([]);
    expect((await feed(lyraToken)).map((entry) => entry.text)).toEqual(["The idol is fake.", "I pocket it anyway."]);
    expect(await feed(borinToken)).toEqual([]);
    // Players whisper only to the GM, and the GM only to a party character.
    expect(await emit(borin, "chat:send", { text: "psst", whisperTo: LYRA })).toMatchObject({ ok: false });
    expect(await emit(gm, "chat:send", { text: "psst", whisperTo: "gm" })).toMatchObject({ ok: false });
  });

  it("lets an author remove their own line and the GM any, and tells each reader by the id it holds", async () => {
    const { gm, lyra, borin, emit, settle, feed, borinToken } = await table();
    await emit(lyra, "chat:send", { text: "Oops" });
    await emit(borin, "chat:send", { text: "Mine" });
    await settle();
    const lyraOwn = lyra.log.find((entry) => entry.text === "Oops")!;
    const borinCopy = borin.log.find((entry) => entry.text === "Oops")!;
    // Borin can't remove Lyra's line, under the id Borin holds it by.
    expect(await emit(borin, "chat:delete", { entryId: borinCopy.id })).toMatchObject({ ok: false });
    expect(await emit(lyra, "chat:delete", { entryId: lyraOwn.id })).toMatchObject({ ok: true });
    await settle();
    expect(lyra.removed).toEqual([lyraOwn.id]);
    expect(borin.removed).toEqual([borinCopy.id]);
    expect(gm.removed).toEqual([gm.log.find((entry) => entry.text === "Oops")!.id]);
    expect((await feed(borinToken)).map((entry) => entry.text)).toEqual(["Mine"]);
    // The GM removes anyone's.
    expect(await emit(gm, "chat:delete", { entryId: gm.log.find((entry) => entry.text === "Mine")!.id })).toMatchObject(
      { ok: true }
    );
    expect(await feed(borinToken)).toEqual([]);
    expect(await emit(gm, "chat:delete", { entryId: 999_999 })).toMatchObject({ ok: false });
  });

  it("answers a resent command with the same line, over HTTP as over the socket", async () => {
    const { gm, settle, http, gmToken } = await table();
    const commandId = randomUUID();
    const first = await (await http("/game/chat", gmToken, { commandId, text: "Once" })).json();
    const again = await (await http("/game/chat", gmToken, { commandId, text: "Once" })).json();
    expect(first.data.entryId).toBe(again.data.entryId);
    await settle();
    expect(gm.log.filter((entry) => entry.text === "Once")).toHaveLength(1);
  });
});

describe("chat's clean-up and rate limit", () => {
  it("folds breaks and spaces, drops control characters and keeps everything else", () => {
    expect(cleanChatText("a\r\n\tb   c\u0000")).toBe("a b c");
    expect(cleanChatText("\u0007")).toBeNull();
    expect(cleanChatText("é")).toBe("é");
  });

  it("allows five lines in ten seconds and thirty a minute, twice that for the GM", () => {
    let now = 0;
    const limiter = new ChatLimiter(() => now);
    for (let index = 0; index < 5; index += 1) expect(limiter.allow("p", false)).toBe(true);
    expect(limiter.allow("p", false)).toBe(false);
    for (let index = 0; index < 10; index += 1) expect(limiter.allow("g", true)).toBe(true);
    expect(limiter.allow("g", true)).toBe(false);
    for (let step = 0; step < 6; step += 1) {
      now += 10_001;
      for (let index = 0; index < 5; index += 1) limiter.allow("q", false);
    }
    expect(limiter.allow("q", false)).toBe(false);
  });
});
