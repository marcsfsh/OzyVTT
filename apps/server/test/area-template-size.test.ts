import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema } from "@vtt/domain";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { png } from "./image-fixtures.js";

// SRD areas of effect have a size of their own ("a 20-foot-radius Sphere"): the GM's drag only places the area, so a
// short drag still catches every creature the area's own size reaches.

const MAGE = "10000000-0000-4000-8000-0000000000d1";
const NEAR = "10000000-0000-4000-8000-0000000000d2";
const FAR = "10000000-0000-4000-8000-0000000000d3";
const OUTSIDE = "10000000-0000-4000-8000-0000000000d4";

const BURST = {
  id: "fiery-burst",
  name: "Fiery Burst",
  activation: "action" as const,
  description: "Each creature in a 20-foot-radius Sphere makes a Dexterity saving throw.",
  save: { ability: "dex" as const, dc: 13, successDamage: "half" as const, failureConditions: [] },
  damage: [{ formula: "8d6", type: "fire" }],
  area: { shape: "sphere" as const, sizeFeet: 20, widthFeet: null }
};
const CONE = {
  id: "frost-breath",
  name: "Frost Breath",
  activation: "action" as const,
  description: "Each creature in a 30-foot Cone makes a Constitution saving throw.",
  save: { ability: "con" as const, dc: 13, successDamage: "half" as const, failureConditions: [] },
  damage: [{ formula: "6d6", type: "cold" }],
  area: { shape: "cone" as const, sizeFeet: 30, widthFeet: null }
};
const definition = ActorDefinitionSchema.parse({
  schemaId: "vtt.actor-monster",
  schemaVersion: 1,
  source: { name: "Test", version: "1", externalId: "mage" },
  name: "Mage",
  size: "medium",
  abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  proficiencyBonus: 2,
  armorClass: 12,
  hitPoints: { maximum: 30 },
  speedFeet: 30,
  actions: [BURST, CONE]
});
const goblin = (id: string, name: string) => ({
  id,
  name,
  kind: "monster",
  visibility: "public",
  hp: { current: 7, maximum: 7 }
});
const initialState = () =>
  GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: MAGE,
        name: "Mage",
        kind: "monster",
        visibility: "public",
        hp: { current: 30, maximum: 30 },
        definitionId: "mage-def"
      },
      goblin(NEAR, "Near Goblin"),
      goblin(FAR, "Far Goblin"),
      goblin(OUTSIDE, "Outside Goblin")
    ],
    definitions: [{ id: "mage-def", definition }]
  });

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function boot() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-area-"));
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
  await server.initialize();
  await server.auth.bootstrap("a sufficiently long GM password");
  const gmToken = (await server.auth.login("a sufficiently long GM password"))!;
  await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind.");
  cleanups.push(async () => {
    server.close();
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${address.port}`;
  const imported = await server.mapAssets.import(png(1000, 600), "arena.png");
  server.mapCatalog.register(imported.metadata.id, "Arena", "battlemap");
  // 50px cells at 5 ft each: cell (c, r) has its center at (25 + 50c, 25 + 50r).
  server.mapCatalog.saveCalibration(imported.metadata.id, {
    calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 },
    verifiedAt: null,
    verificationPoint: null,
    verificationErrorPx: null
  });
  return { base, server, gmToken, mapAssetId: imported.metadata.id };
}

const post = (base: string, path: string, token: string, body: unknown = {}) =>
  fetch(base + path, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
const cell = (column: number, row: number) => ({ x: 25 + 50 * column, y: 25 + 50 * row });

async function fightOnTheGrid() {
  const running = await boot();
  const { base, gmToken, mapAssetId } = running;
  await post(base, GAME_PATHS.encounterStart, gmToken, {
    commandId: randomUUID(),
    mapAssetId,
    entries: [MAGE, NEAR, FAR, OUTSIDE].map((actorId, index) => ({ actorId, score: 20 - index }))
  });
  // The mage at (0,0); the goblins 5, 15 and 30 feet east of the point (10,5).
  const at = { [MAGE]: cell(0, 0), [NEAR]: cell(11, 5), [FAR]: cell(13, 5), [OUTSIDE]: cell(16, 5) };
  for (const [actorId, position] of Object.entries(at))
    await post(base, GAME_PATHS.tokenMove.replace("{actorId}", actorId), gmToken, { position });
  return running;
}

describe("an area template's size", () => {
  it("is the action's own, so a 5-foot drag still places a 20-foot-radius Sphere", async () => {
    const { base, server, gmToken } = await fightOnTheGrid();
    const response = await post(base, GAME_PATHS.actionResolve, gmToken, {
      commandId: randomUUID(),
      actorId: MAGE,
      actionId: "fiery-burst",
      // A drag of one cell, from the point (10,5) toward the east.
      template: { shape: "circle", origin: cell(10, 5), target: cell(11, 5) }
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const saves = server.store.snapshot.combat.pendingSaves.map((save) => save.targetActorId).sort();
    expect(saves).toEqual([NEAR, FAR].sort());
    const drawn = server.store.snapshot.combat.annotations.at(-1)!;
    expect(drawn).toMatchObject({ shape: "circle", geometry: { sizeFeet: 20 } });
  });

  it("takes the action's shape too: a Cone drawn as a circle is still a 30-foot Cone", async () => {
    const { base, server, gmToken } = await fightOnTheGrid();
    const response = await post(base, GAME_PATHS.actionResolve, gmToken, {
      commandId: randomUUID(),
      actorId: MAGE,
      actionId: "frost-breath",
      template: { shape: "circle", origin: cell(10, 5), target: cell(11, 5) }
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(server.store.snapshot.combat.annotations.at(-1)).toMatchObject({
      shape: "cone",
      geometry: { sizeFeet: 30 }
    });
    // The Cone starts at (10,5) and points east: 5 and 15 feet along it, and 30 feet at its far end.
    const saves = server.store.snapshot.combat.pendingSaves.map((save) => save.targetActorId).sort();
    expect(saves).toEqual([NEAR, FAR, OUTSIDE].sort());
  });
});
