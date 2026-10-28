import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { io as connect } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { claimCharacter } from "../src/character-claims.js";
import { endEncounter, startEncounter } from "../src/encounter.js";
import { playedAtTable, setPlayedAtTable } from "../src/played-at-table.js";
import { activateScene, createScene } from "../src/scenes.js";
import { createServer } from "../src/server.js";
import { png } from "./image-fixtures.js";

// ADR-0042: a character played at the table can't be claimed, so the GM answers for it; an encounter keeps the
// choice it started with.

const LYRA = "10000000-0000-4000-8000-000000000001";
const BORIN = "10000000-0000-4000-8000-000000000002";
const GOBLIN = "10000000-0000-4000-8000-000000000003";
const PLAYER = "30000000-0000-4000-8000-00000000000a";
const OTHER_PLAYER = "30000000-0000-4000-8000-00000000000b";
const SCENE = "40000000-0000-4000-8000-00000000000a";
const SECOND = "40000000-0000-4000-8000-00000000000b";
const IMPLICIT = "40000000-0000-4000-8000-00000000000f";
const MAP = "20000000-0000-5000-8000-000000000001";
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;

const actors = [
  { id: LYRA, name: "Lyra", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 } },
  {
    id: BORIN,
    name: "Borin",
    kind: "player-character",
    visibility: "public",
    hp: { current: 24, maximum: 24 },
    ownerSessionId: PLAYER
  },
  { id: GOBLIN, name: "Goblin", kind: "monster", visibility: "public", hp: { current: 7, maximum: 7 } }
];

const game = () => GameStateSchema.parse({ schemaVersion: 1, actors });
const actorOf = (state: GameState, id: string) => state.actors.find((actor) => actor.id === id)!;
const start = (state: GameState, atTable?: Record<string, boolean>) =>
  startEncounter(
    state,
    {
      mapAssetId: MAP,
      entries: [LYRA, BORIN, GOBLIN].map((actorId) => ({ actorId })),
      playersRollInitiative: true,
      ...(atTable ? { atTable } : {})
    },
    () => 10,
    GEOMETRY
  );

describe("the played-at-the-table mark", () => {
  it("is the GM's to set on a party character that nobody holds, and refuses the claim while it is set", () => {
    const state = game();
    setPlayedAtTable(state, LYRA, true);
    expect(actorOf(state, LYRA).playedAtTable).toBe(true);
    expect(() => claimCharacter(state, LYRA, OTHER_PLAYER)).toThrow("Lyra is played at the table.");
    expect(actorOf(state, LYRA).ownerSessionId).toBeNull();

    // A claimed character is released first, and a monster is never played at the table.
    expect(() => setPlayedAtTable(state, BORIN, true)).toThrow(/Borin is claimed on a player's device/);
    expect(() => setPlayedAtTable(state, GOBLIN, true)).toThrow(/Only a party character/);

    setPlayedAtTable(state, LYRA, false);
    expect(actorOf(state, LYRA).playedAtTable).toBeUndefined();
    claimCharacter(state, LYRA, OTHER_PLAYER);
    expect(actorOf(state, LYRA).ownerSessionId).toBe(OTHER_PLAYER);
    expect(() => GameStateSchema.parse(state)).not.toThrow();
  });
});

describe("an encounter's choice", () => {
  it("starts from the mark, keeps a claimed character on its device, and lets the GM choose for this encounter", () => {
    const state = game();
    setPlayedAtTable(state, LYRA, true);
    start(state);
    expect(state.combat.atTable).toEqual({ [LYRA]: true, [BORIN]: false });
    // Played at the table, Lyra waits on nobody's device: players rolling their own leaves Lyra to the server.
    expect(state.combat.pendingInitiative).toEqual([BORIN]);
    endEncounter(state);
    expect(state.combat.atTable).toBeUndefined();

    // On a device for this encounter: Lyra can be claimed while it runs, and the mark stays for the next one.
    start(state, { [LYRA]: false });
    expect(playedAtTable(state, actorOf(state, LYRA))).toBe(false);
    claimCharacter(state, LYRA, OTHER_PLAYER);
    expect(actorOf(state, LYRA).ownerSessionId).toBe(OTHER_PLAYER);
    expect(actorOf(state, LYRA).playedAtTable).toBe(true);
  });

  it("refuses the table for a claimed character, before any die is rolled", () => {
    const state = game();
    let rolls = 0;
    expect(() =>
      startEncounter(
        state,
        { mapAssetId: MAP, entries: [{ actorId: BORIN }, { actorId: GOBLIN }], atTable: { [BORIN]: true } },
        () => {
          rolls += 1;
          return 10;
        },
        GEOMETRY
      )
    ).toThrow(/Borin is claimed on a player's device. Release the claim/);
    expect(rolls).toBe(0);
    expect(state.combat.active).toBe(false);
  });

  it("changes nothing when the mark changes mid-encounter, and goes with the encounter when it is parked", () => {
    const state = game();
    createScene(state, { encounterId: SCENE, name: "Warren", mapAssetId: MAP, combatantIds: [LYRA, BORIN] }, GEOMETRY);
    createScene(state, { encounterId: SECOND, name: "Crypt", mapAssetId: MAP, combatantIds: [GOBLIN] }, GEOMETRY);
    activateScene(state, SCENE, IMPLICIT);
    start(state, { [LYRA]: true });

    setPlayedAtTable(state, LYRA, false);
    expect(playedAtTable(state, actorOf(state, LYRA))).toBe(true);
    expect(() => claimCharacter(state, LYRA, OTHER_PLAYER)).toThrow("Lyra is played at the table.");

    activateScene(state, SECOND, IMPLICIT);
    expect(state.combat.encounters.find((scene) => scene.id === SCENE)?.combat.atTable).toEqual({
      [LYRA]: true,
      [BORIN]: false
    });
    activateScene(state, SCENE, IMPLICIT);
    expect(state.combat.atTable).toEqual({ [LYRA]: true, [BORIN]: false });
    expect(() => GameStateSchema.parse(state)).not.toThrow();
  });
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function boot() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-at-table-"));
  const server = createServer({
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integrations.sqlite"),
    mapAssetsPath: join(directory, "map-assets"),
    webDist: join(directory, "dist"),
    useDevelopmentClient: true,
    developmentClientPort: 5173,
    initialGameState: GameStateSchema.parse({ schemaVersion: 1, actors: actors.filter((actor) => actor.id !== BORIN) })
  });
  await server.initialize();
  await server.auth.bootstrap("a sufficiently long GM password");
  const gmToken = (await server.auth.login("a sufficiently long GM password"))!;
  const playerToken = server.auth.issuePlayerSession();
  await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind.");
  cleanups.push(async () => {
    server.close();
    await rm(directory, { recursive: true, force: true });
  });
  const map = await server.mapAssets.import(png(900, 600), "warren.png");
  server.mapCatalog.register(map.metadata.id, "Warren", "battlemap");
  const base = `http://127.0.0.1:${address.port}`;
  const post = async (path: string, token: string, body: unknown) =>
    fetch(`${base}/api/v1${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  const read = async (path: string, token: string) =>
    (await fetch(`${base}/api/v1${path}`, { headers: { authorization: `Bearer ${token}` } })).text();
  return { base, server, gmToken, playerToken, mapId: map.metadata.id, post, read };
}

describe("played at the table, over HTTP and the socket", () => {
  it("is set by the GM alone, refuses a player's claim, and never reaches a player or the table screen", async () => {
    const { base, server, gmToken, playerToken, mapId, post, read } = await boot();

    expect((await post(`/game/actors/${LYRA}/played-at-table`, playerToken, { playedAtTable: true })).status).toBe(403);
    expect((await post(`/game/actors/${LYRA}/played-at-table`, gmToken, { playedAtTable: true })).status).toBe(200);
    expect(server.store.snapshot.actors.find((actor) => actor.id === LYRA)?.playedAtTable).toBe(true);

    const claim = await post("/game/claims", playerToken, { actorId: LYRA });
    expect(claim.status).toBe(409);
    expect((await claim.json()).error.message).toBe("Lyra is played at the table.");

    expect(
      (
        await post("/game/encounter/start", gmToken, {
          mapAssetId: mapId,
          entries: [{ actorId: LYRA }, { actorId: GOBLIN }]
        })
      ).status
    ).toBe(200);
    expect(server.store.snapshot.combat.atTable).toEqual({ [LYRA]: true });

    for (const body of [await read("/game", playerToken), await read("/viewer/presentation", gmToken)]) {
      expect(body).not.toContain("playedAtTable");
      expect(body).not.toContain("atTable");
    }
    expect(await read("/game", gmToken)).toContain('"atTable"');

    // The same mark over the socket; the running encounter keeps its own choice.
    const socket = connect(base, { auth: { token: gmToken }, transports: ["websocket"], reconnection: false });
    cleanups.push(async () => {
      socket.close();
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", reject);
    });
    await new Promise((resolve) => socket.emit("session:join", { token: gmToken }, resolve));
    const reply = await new Promise<{ ok: boolean }>((resolve) =>
      socket.emit(
        "actor:set-played-at-table",
        { commandId: randomUUID(), actorId: LYRA, playedAtTable: false },
        resolve
      )
    );
    expect(reply.ok).toBe(true);
    expect(server.store.snapshot.actors.find((actor) => actor.id === LYRA)?.playedAtTable).toBeUndefined();
    expect(server.store.snapshot.combat.atTable).toEqual({ [LYRA]: true });
    expect((await post("/game/claims", playerToken, { actorId: LYRA })).status).toBe(409);
  });
});
