import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { GameStateSchema } from "@vtt/domain";
import { io as connect, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

// Doors that stay shut, end to end: the GM locks a door, a player beside it is refused, picks it with Thieves' Tools,
// and never receives what holds it shut; a secret door reaches the player as wall.

const HERO = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const DOOR = "50000000-0000-4000-8000-000000000002";
const SECRET = "50000000-0000-4000-8000-000000000004";

const initialState = () =>
  GameStateSchema.parse({
    schemaVersion: 1,
    combat: {
      initiative: [
        { actorId: HERO, score: 10 },
        { actorId: OTHER, score: 5 }
      ],
      tokens: [
        { actorId: HERO, position: { x: 225, y: 275 }, sizePx: 41, gridSizePx: 50 },
        { actorId: OTHER, position: { x: 75, y: 75 }, sizePx: 41, gridSizePx: 50 }
      ],
      vision: {
        enabled: true,
        walls: [
          { id: "50000000-0000-4000-8000-000000000001", kind: "wall", a: { x: 250, y: 0 }, b: { x: 250, y: 250 } },
          { id: DOOR, kind: "door", a: { x: 250, y: 250 }, b: { x: 250, y: 300 }, open: false },
          { id: "50000000-0000-4000-8000-000000000003", kind: "wall", a: { x: 250, y: 300 }, b: { x: 250, y: 400 } },
          { id: SECRET, kind: "door", a: { x: 250, y: 400 }, b: { x: 250, y: 450 }, open: false },
          { id: "50000000-0000-4000-8000-000000000005", kind: "wall", a: { x: 250, y: 450 }, b: { x: 250, y: 600 } }
        ],
        measure: { width: 1000, height: 600, pixelsPerFoot: 10 }
      }
    },
    actors: [
      {
        id: HERO,
        name: "Borin",
        kind: "player-character",
        visibility: "public",
        hp: { current: 20, maximum: 20 },
        inventory: [{ id: "thieves-tools", name: "Thieves' Tools", quantity: 1 }]
      },
      { id: OTHER, name: "Mirena", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 } }
    ]
  });

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function joinSocket(base: string, token: string) {
  const socket = connect(base, { auth: { token }, transports: ["websocket"], reconnection: false, forceNew: true });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
  });
  const joined = await new Promise<{ ok: boolean }>((resolve) => socket.emit("session:join", { token }, resolve));
  if (!joined.ok) throw new Error("join failed");
  cleanups.push(async () => {
    socket.close();
  });
  return socket;
}

const emit = (socket: Socket, event: string, payload: Record<string, unknown>) =>
  new Promise<Record<string, unknown>>((resolve) =>
    (socket.emit as (...args: unknown[]) => void)(event, { commandId: randomUUID(), ...payload }, resolve)
  );

async function table() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-doors-"));
  const server = createServer({
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integrations.sqlite"),
    mapAssetsPath: join(directory, "map-assets"),
    webDist: join(directory, "dist"),
    useDevelopmentClient: true,
    developmentClientPort: 5173,
    initialGameState: initialState()
  });
  cleanups.push(async () => {
    server.close();
    await rm(directory, { recursive: true, force: true });
  });
  await server.initialize();
  await server.auth.bootstrap("a sufficiently long GM password");
  const gmToken = (await server.auth.login("a sufficiently long GM password"))!;
  const playerToken = server.auth.issuePlayerSession();
  await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind.");
  const base = `http://127.0.0.1:${address.port}`;
  const gm = await joinSocket(base, gmToken);
  const player = await joinSocket(base, playerToken);
  const received: unknown[] = [];
  player.on("state:updated", (payload: unknown) => received.push(payload));
  expect(await emit(player, "character:claim", { actorId: HERO })).toMatchObject({ ok: true });
  return { server, gm, player, received };
}

describe("locked doors over the socket", () => {
  it("refuses a player a locked door, lets the GM open it, and lets the player pick it", async () => {
    const { server, gm, player, received } = await table();
    expect(
      await emit(gm, "door:set-state", {
        wallId: DOOR,
        door: { fastenings: [{ kind: "lock", dc: 15, keyHolderIds: [OTHER] }] }
      })
    ).toMatchObject({ ok: true });
    expect(await emit(player, "door:set-open", { wallId: DOOR, open: true })).toMatchObject({
      ok: false,
      message: "The door is locked."
    });
    const worked = await emit(player, "door:use", { wallId: DOOR, actorId: HERO, how: "pick" });
    expect(worked).toMatchObject({ ok: true });
    expect(String(worked.text)).toMatch(/^Borin (picks|fails to pick) the lock\.$/);
    const picked = worked.text === "Borin picks the lock.";
    expect(await emit(player, "door:set-open", { wallId: DOOR, open: true })).toMatchObject({ ok: picked });
    // A player can't work a door with another player's character.
    expect(await emit(player, "door:use", { wallId: DOOR, actorId: OTHER, how: "force" })).toMatchObject({ ok: false });
    // What holds a door shut, and who has its key, never reaches the player.
    expect(JSON.stringify(received)).not.toContain("fastenings");
    expect(JSON.stringify(received)).not.toContain("keyHolderIds");
    // The GM opens it whatever holds it.
    expect(await emit(gm, "door:set-open", { wallId: DOOR, open: true })).toMatchObject({ ok: true });
    expect(server.store.snapshot.combat.vision.walls.find((wall) => wall.id === DOOR)?.open).toBe(true);
  });

  it("answers a secret door as one the player can't reach, and the GM's door state as GM-only", async () => {
    const { gm, player } = await table();
    expect(await emit(gm, "door:set-state", { wallId: SECRET, door: { fastenings: [], hidden: true } })).toMatchObject({
      ok: true
    });
    // Borin stands at (4,5): the secret door at rows 8 and 9 is out of reach anyway, and both answer alike.
    expect(await emit(player, "door:set-open", { wallId: SECRET, open: true })).toMatchObject({
      ok: false,
      message: "Move your character next to the door to open or close it."
    });
    expect(await emit(player, "door:set-state", { wallId: DOOR, door: null })).toMatchObject({ ok: false });
    expect(
      await emit(player, "object:set", {
        wallId: DOOR,
        object: { name: "Door", armorClass: 5, hitPoints: { current: 1, maximum: 1 } }
      })
    ).toMatchObject({ ok: false });
    expect(
      await emit(player, "object:damage", { target: { wallId: DOOR }, parts: [{ amount: 50, type: "fire" }] })
    ).toMatchObject({ ok: false });
  });
});
