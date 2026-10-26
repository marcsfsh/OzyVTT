import { randomUUID } from "node:crypto";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema } from "@vtt/domain";
import { afterEach, describe, expect, it } from "vitest";
import { importActorDefinition } from "../src/actor-roster.js";
import { bootServer } from "./boot-server.js";
import { png } from "./image-fixtures.js";
import { build, catalog, FOE, FOE2, HERO, wizardInput } from "./spell-casters.js";

// SRD 5.2.1 Ring of Shooting Stars: "Faerie Fire. You can expend 1 charge to cast Faerie Fire from the ring",
// "Lightning Spheres. You can expend 2 charges as a Magic action to create up to four 3-foot-diameter spheres of
// lightning ... The first time the sphere comes within 5 feet of a creature other than you ..., the sphere discharges
// lightning at that creature and disappears", and "Shooting Stars. You can expend 1 to 3 charges as a Magic action. For
// every charge you expend, you launch a glowing mote of light".

const POOL = "ring-of-shooting-stars-charges";
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

/** A fight on a 50px, 5-foot grid: the wizard wearing the ring at (2,2), a goblin at (10,2) and an orc at (12,8). */
async function fight() {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      { id: FOE, name: "Goblin", kind: "monster", hp: { current: 200, maximum: 200 }, armorClass: 12 },
      { id: FOE2, name: "Orc", kind: "monster", hp: { current: 200, maximum: 200 }, armorClass: 12 }
    ]
  });
  importActorDefinition(state, build(wizardInput(["magic-missile"])), HERO, "public", catalog);
  const hero = state.actors.find((actor) => actor.id === HERO)!;
  hero.inventory = [
    ...hero.inventory,
    { id: "ring-of-shooting-stars", name: "Ring of Shooting Stars", quantity: 1, equipped: true, attuned: true }
  ];
  const booted = await bootServer(state);
  closers.push(booted.close);
  const { server, gmToken, post } = booted;
  const imported = await server.mapAssets.import(png(2000, 1000), "field.png");
  server.mapCatalog.register(imported.metadata.id, "Field", "battlemap");
  server.mapCatalog.saveCalibration(imported.metadata.id, {
    calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 },
    verifiedAt: null,
    verificationPoint: null,
    verificationErrorPx: null
  });
  await post(GAME_PATHS.encounterStart, gmToken, {
    commandId: randomUUID(),
    mapAssetId: imported.metadata.id,
    entries: [
      { actorId: HERO, score: 20 },
      { actorId: FOE, score: 10 },
      { actorId: FOE2, score: 5 }
    ]
  });
  const place = (actorId: string, column: number, row: number) =>
    post(GAME_PATHS.tokenMove.replace("{actorId}", actorId), gmToken, {
      commandId: randomUUID(),
      position: { x: 25 + 50 * column, y: 25 + 50 * row }
    });
  await place(HERO, 2, 2);
  await place(FOE, 10, 2);
  await place(FOE2, 12, 8);
  const use = (actionId: string, body: Record<string, unknown>) =>
    post(GAME_PATHS.actionResolve, gmToken, { commandId: randomUUID(), actorId: HERO, actionId, ...body });
  const spent = () => server.store.snapshot.actors.find((actor) => actor.id === HERO)!.actionUses[POOL] ?? 0;
  return { server, place, use, spent };
}

/** A 15-foot Cube with its corner at cell (column, row). */
const cube = (column: number, row: number) => ({
  shape: "square",
  origin: { x: 50 * column, y: 50 * row },
  target: { x: 50 * (column + 3), y: 50 * (row + 3) }
});
/** A sphere's 5 feet round cell (column, row). */
const sphere = (column: number, row: number) => ({
  shape: "circle",
  origin: { x: 25 + 50 * column, y: 25 + 50 * row },
  target: { x: 25 + 50 * (column + 1), y: 25 + 50 * row }
});

describe("a Ring of Shooting Stars", () => {
  it("spends a charge for each of Shooting Stars' Cubes", async () => {
    const { server, use, spent } = await fight();
    const stars = await use("item-ring-of-shooting-stars-shooting-stars", {
      templates: [cube(9, 1), cube(11, 7), cube(20, 1)]
    });
    expect(stars.status, await stars.clone().text()).toBe(200);
    expect(spent()).toBe(3);
    expect(server.store.snapshot.combat.annotations.filter((annotation) => annotation.kind === "shape")).toHaveLength(
      3
    );
    expect(server.store.snapshot.combat.pendingSaves.map((save) => save.targetActorId).sort()).toEqual(
      [FOE, FOE2].sort()
    );
  });

  it("casts Faerie Fire for a charge", async () => {
    const { use, spent } = await fight();
    const fire = await use("item-ring-of-shooting-stars-cast-faerie-fire", {
      template: { shape: "square", origin: { x: 450, y: 50 }, target: { x: 650, y: 250 } }
    });
    expect(fire.status, await fire.clone().text()).toBe(200);
    expect(spent()).toBe(1);
  });

  it("makes lightning spheres for 2 charges, each discharging once for the damage its number gives", async () => {
    const { server, place, use, spent } = await fight();
    const spheres = await use("item-ring-of-shooting-stars-lightning-spheres", {
      templates: [sphere(6, 2), sphere(6, 6)]
    });
    expect(spheres.status, await spheres.clone().text()).toBe(200);
    expect(spent()).toBe(2);
    const zones = () => server.store.snapshot.combat.spellZones;
    expect(zones()).toHaveLength(2);
    expect(zones().map((zone) => zone.rule?.damage[0]?.formula)).toEqual(["5d4", "5d4"]);
    // The goblin walks up beside the first sphere: it discharges and is gone; the other waits.
    await place(FOE, 7, 2);
    expect(server.store.snapshot.combat.pendingSaves).toEqual([
      expect.objectContaining({ targetActorId: FOE, ability: "dex", dc: 15 })
    ]);
    expect(zones()).toHaveLength(1);
  });
});
