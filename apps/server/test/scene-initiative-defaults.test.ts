import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameStateSchema } from "@vtt/domain";
import { randomUUID } from "node:crypto";
import { io as connect } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import {
  activateScene,
  createScene,
  duplicateScene,
  liveInitiativeDefaults,
  setSceneInitiativeDefaults
} from "../src/scenes.js";
import { createServer } from "../src/server.js";
import { png } from "./image-fixtures.js";

// ADR-0039: a scene keeps how its fight starts, and `encounter.start` takes it where the request leaves a choice out.

const PC = "10000000-0000-4000-8000-000000000001";
const MON = "10000000-0000-4000-8000-000000000002";
const OWNER = "30000000-0000-4000-8000-00000000000a";
const SCENE = "40000000-0000-4000-8000-00000000000a";
const OTHER = "40000000-0000-4000-8000-00000000000b";
const IMPLICIT = "40000000-0000-4000-8000-00000000000f";
const MAP = "20000000-0000-5000-8000-000000000001";
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;

const actors = [
  {
    id: PC,
    name: "Alpha",
    kind: "player-character",
    visibility: "public",
    hp: { current: 20, maximum: 20 },
    ownerSessionId: OWNER,
    initiative: 2
  },
  { id: MON, name: "Goblin", kind: "monster", visibility: "public", hp: { current: 10, maximum: 10 } }
];

describe("a scene's fight settings", () => {
  it("are kept, replaced, cleared, copied by a duplicate and read only from the live scene", () => {
    const game = GameStateSchema.parse({ schemaVersion: 1, actors });
    createScene(game, { sceneId: SCENE, name: "Warren", mapAssetId: MAP, combatantIds: [PC, MON] }, GEOMETRY);
    expect(game.combat.scenes[0].initiativeDefaults).toBeUndefined();

    setSceneInitiativeDefaults(game, SCENE, { playersRollInitiative: true });
    expect(game.combat.scenes[0].initiativeDefaults).toEqual({ playersRollInitiative: true });
    // Parked scenes give the next fight nothing: only the live one counts.
    expect(liveInitiativeDefaults(game)).toEqual({});

    duplicateScene(game, SCENE, OTHER);
    expect(game.combat.scenes[1].initiativeDefaults).toEqual({ playersRollInitiative: true });

    activateScene(game, SCENE, IMPLICIT);
    expect(liveInitiativeDefaults(game)).toEqual({ playersRollInitiative: true });

    setSceneInitiativeDefaults(game, SCENE, {});
    expect(game.combat.scenes.find((scene) => scene.id === SCENE)?.initiativeDefaults).toBeUndefined();
    expect(() => setSceneInitiativeDefaults(game, IMPLICIT.replace("f", "e"), {})).toThrow(/no longer exists/);
    // Still schema-valid with the field present and absent.
    expect(() => GameStateSchema.parse(game)).not.toThrow();
  });

  it("refuses a replay's scene", () => {
    const game = GameStateSchema.parse({
      schemaVersion: 1,
      actors,
      combat: { scenes: [{ id: SCENE, name: "Replay", mapAssetId: MAP, replayOf: { archiveId: 1, actorIds: [] } }] }
    });
    expect(() => setSceneInitiativeDefaults(game, SCENE, { groupMonsters: true })).toThrow(/replay/);
  });
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function boot() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-scene-defaults-"));
  const server = createServer({
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integrations.sqlite"),
    mapAssetsPath: join(directory, "map-assets"),
    webDist: join(directory, "dist"),
    useDevelopmentClient: true,
    developmentClientPort: 5173,
    initialGameState: GameStateSchema.parse({ schemaVersion: 1, actors })
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
  return { base: `http://127.0.0.1:${address.port}`, server, gmToken, playerToken, mapId: map.metadata.id };
}

describe("encounter.start with a scene's fight settings", () => {
  it("takes the live scene's choice when the request omits it, and the request's own when it names one", async () => {
    const { base, server, gmToken, playerToken, mapId } = await boot();
    const post = async (path: string, token: string, body: unknown) =>
      fetch(`${base}/api/v1${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body)
      });

    const created = await post("/game/scenes", gmToken, {
      name: "Warren",
      mapAssetId: mapId,
      combatantIds: [PC, MON],
      activate: true,
      initiativeDefaults: { playersRollInitiative: true }
    });
    expect(created.status).toBe(200);
    const sceneId = server.store.snapshot.combat.activeSceneId!;
    expect(server.store.snapshot.combat.scenes.find((scene) => scene.id === sceneId)?.initiativeDefaults).toEqual({
      playersRollInitiative: true
    });

    // Players can't change it, and never receive it.
    expect(
      (await post(`/game/scenes/${sceneId}/initiative-defaults`, playerToken, { initiativeDefaults: {} })).status
    ).toBe(403);
    const playerGame = await (
      await fetch(`${base}/api/v1/game`, { headers: { authorization: `Bearer ${playerToken}` } })
    ).text();
    expect(playerGame).not.toContain("initiativeDefaults");
    expect(playerGame).not.toContain("playersRollInitiative");

    // Omitted: the scene's choice parks the claimed character for its own roll.
    expect((await post("/game/encounter/start", gmToken, { mapAssetId: mapId })).status).toBe(200);
    expect(server.store.snapshot.combat.pendingInitiative).toEqual([PC]);
    expect((await post("/game/encounter/end", gmToken, {})).status).toBe(200);

    // Named: the request wins over the scene.
    expect(
      (await post("/game/encounter/start", gmToken, { mapAssetId: mapId, playersRollInitiative: false })).status
    ).toBe(200);
    expect(server.store.snapshot.combat.pendingInitiative).toEqual([]);
    expect((await post("/game/encounter/end", gmToken, {})).status).toBe(200);

    // Cleared over HTTP: with neither, the fight starts as it always has.
    expect(
      (await post(`/game/scenes/${sceneId}/initiative-defaults`, gmToken, { initiativeDefaults: {} })).status
    ).toBe(200);
    expect((await post("/game/encounter/start", gmToken, { mapAssetId: mapId })).status).toBe(200);
    expect(server.store.snapshot.combat.pendingInitiative).toEqual([]);

    // The same command over the socket.
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
        "scene:set-initiative-defaults",
        { commandId: randomUUID(), sceneId, initiativeDefaults: { groupMonsters: true } },
        resolve
      )
    );
    expect(reply.ok).toBe(true);
    expect(server.store.snapshot.combat.scenes.find((scene) => scene.id === sceneId)?.initiativeDefaults).toEqual({
      groupMonsters: true
    });
  });
});
