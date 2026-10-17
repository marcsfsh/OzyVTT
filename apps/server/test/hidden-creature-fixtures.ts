import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { GameStateSchema, type PlayerView } from "@vtt/domain";
import { io as connect, type Socket } from "socket.io-client";
import { afterEach, expect } from "vitest";
import { createServer } from "../src/server.js";
import { png } from "./image-fixtures.js";

/**
 * A real server with a GM and one player (Borin is theirs) on a 1000 x 600 battlemap of 50-pixel, 5-foot cells, for
 * the tests that a creature hidden from the table by sight or the fog (ADR-0023) never reaches that player. The fight
 * is set up directly in the stored state; everything the player's socket receives is recorded.
 */

export const HERO = "10000000-0000-4000-8000-000000000001";
export const FRIEND = "10000000-0000-4000-8000-000000000002";
export const GOBLIN = "10000000-0000-4000-8000-000000000003";
export const ORC = "10000000-0000-4000-8000-000000000004";
export const GOBLIN_NAME = "Skulking Goblin";

type Point = { x: number; y: number };
export type HiddenTableSetup = {
  /** The fight is running; false leaves the scene set up with no fight. */
  active?: boolean;
  /** Initiative order, highest first; the first is up. Defaults to the placed creatures. */
  order?: string[];
  positions: Record<string, Point | null>;
  actors?: Record<string, Record<string, unknown>>;
  definitions?: unknown[];
  vision?: { enabled: boolean; ambient?: "bright" | "dim" | "dark"; walls?: unknown[]; lights?: unknown[] };
  /** The fog is on, with these reveals (pixels). */
  reveals?: Array<{ x: number; y: number; width: number; height: number }>;
};

let wallCount = 0;
export const wall = (a: Point, b: Point) => ({
  id: `50000000-0000-4000-8000-${String(++wallCount).padStart(12, "0")}`,
  kind: "wall",
  a,
  b
});

/** The centre of cell (column, row). */
export const cell = (column: number, row: number) => ({ x: 25 + 50 * column, y: 25 + 50 * row });

function stateFor(mapAssetId: string, setup: HiddenTableSetup) {
  const actors = [
    { id: HERO, name: "Borin", kind: "player-character" },
    { id: FRIEND, name: "Mirena", kind: "player-character" },
    { id: GOBLIN, name: GOBLIN_NAME, kind: "monster" },
    { id: ORC, name: "Orc", kind: "monster" }
  ].map((actor) => ({
    ...actor,
    visibility: "public",
    hp: { current: 20, maximum: 20 },
    speedFeet: 30,
    ...setup.actors?.[actor.id]
  }));
  const active = setup.active ?? true;
  const order = setup.order ?? Object.keys(setup.positions);
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors,
    definitions: setup.definitions ?? [],
    combat: {
      active,
      round: 1,
      turnActorId: active ? order[0] : null,
      mapAssetId,
      initiative: order.map((actorId, index) => ({ actorId, score: 20 - index })),
      tokens: Object.entries(setup.positions).map(([actorId, position]) => ({
        actorId,
        position,
        sizePx: 41,
        gridSizePx: 50
      })),
      ...(setup.reveals
        ? {
            fog: {
              enabled: true,
              shapes: setup.reveals.map((rect, index) => ({
                kind: "rect",
                id: `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
                op: "reveal",
                ...rect
              }))
            }
          }
        : {}),
      vision: {
        enabled: setup.vision?.enabled ?? false,
        ambient: setup.vision?.ambient ?? "bright",
        walls: setup.vision?.walls ?? [],
        lights: setup.vision?.lights ?? [],
        measure: { width: 1000, height: 600, pixelsPerFoot: 10 }
      }
    }
  });
}

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

export const emit = (socket: Socket, event: string, payload: Record<string, unknown>) =>
  new Promise<Record<string, unknown>>((resolve) =>
    (socket.emit as (...args: unknown[]) => void)(event, { commandId: randomUUID(), ...payload }, resolve)
  );

/** Lets broadcasts that follow a reply arrive. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

/** An asset's id: the content hash of its bytes, the same on every server. */
export async function assetIdOf(image: Buffer) {
  const directory = await mkdtemp(join(tmpdir(), "vtt-hidden-id-"));
  const probe = createServer({
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integrations.sqlite"),
    mapAssetsPath: join(directory, "map-assets"),
    webDist: join(directory, "dist"),
    useDevelopmentClient: true,
    developmentClientPort: 5173
  });
  await probe.initialize();
  const id = (await probe.mapAssets.import(image, "probe.png")).metadata.id;
  probe.close();
  await rm(directory, { recursive: true, force: true });
  return id;
}

let mapId: string | null = null;

export type Received = Array<{ event: string; payload: unknown }>;

export async function hiddenTable(setup: HiddenTableSetup) {
  mapId ??= await assetIdOf(png(1000, 600));
  const directory = await mkdtemp(join(tmpdir(), "vtt-hidden-"));
  const server = createServer({
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integrations.sqlite"),
    mapAssetsPath: join(directory, "map-assets"),
    tokenAssetsPath: join(directory, "token-assets"),
    webDist: join(directory, "dist"),
    useDevelopmentClient: true,
    developmentClientPort: 5173,
    initialGameState: stateFor(mapId, setup)
  });
  cleanups.push(async () => {
    server.close();
    await rm(directory, { recursive: true, force: true });
  });
  await server.initialize();
  await server.auth.bootstrap("a sufficiently long GM password");
  const gmToken = (await server.auth.login("a sufficiently long GM password"))!;
  const playerToken = server.auth.issuePlayerSession();
  const map = await server.mapAssets.import(png(1000, 600), "crypt.png");
  expect(map.metadata.id).toBe(mapId);
  server.mapCatalog.register(map.metadata.id, "Crypt", "battlemap");
  server.mapCatalog.saveCalibration(map.metadata.id, {
    calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 },
    verifiedAt: null,
    verificationPoint: null,
    verificationErrorPx: null
  });
  await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind.");
  const base = `http://127.0.0.1:${address.port}`;
  const gm = await joinSocket(base, gmToken);
  const player = await joinSocket(base, playerToken);
  const received: Received = [];
  const gmLog: unknown[] = [];
  let latest: PlayerView | null = null;
  for (const event of ["state:updated", "log:entry", "table:event"])
    player.on(event, (payload: unknown) => {
      received.push({ event, payload });
      if (event === "state:updated") latest = payload as PlayerView;
    });
  gm.on("log:entry", (payload: unknown) => gmLog.push(payload));
  const http = (path: string, token: string, init: RequestInit = {}) =>
    fetch(base + path, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers }
    });
  expect(await emit(player, "character:claim", { actorId: HERO })).toMatchObject({ ok: true });
  await settle();
  return {
    server,
    gm,
    player,
    received,
    gmLog,
    http,
    gmToken,
    playerToken,
    mapAssetId: mapId,
    /** The player's latest projected state. */
    latest: () => latest!,
    /** Where to start reading `received` from for what comes next. */
    mark: () => received.length
  };
}

export const mentionsGoblin = (payload: unknown) => {
  const json = JSON.stringify(payload);
  return json.includes(GOBLIN) || json.includes(GOBLIN_NAME);
};

/** What the player was sent since `mark`, as JSON strings, for reading in a failure. */
export const sentSince = (received: Received, mark: number) =>
  received.slice(mark).map((entry) => `${entry.event}: ${JSON.stringify(entry.payload)}`);
