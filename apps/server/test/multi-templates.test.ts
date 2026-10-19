import { randomUUID } from "node:crypto";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { afterEach, describe, expect, it } from "vitest";
import { importActorDefinition } from "../src/actor-roster.js";
import { bootServer } from "./boot-server.js";
import { png } from "./image-fixtures.js";
import { catalog, FOE, FOE2, HERO } from "./spell-casters.js";
import { druidAt, wizardAt } from "./zone-fixtures.js";

// SRD 5.2.1 Fire Storm: "The area of the storm consists of up to ten 10-foot Cubes, which you arrange as you like. Each
// Cube must be contiguous with at least one other Cube." Meteor Swarm: "four different points you can see within range
// ... A creature in the area of more than one fiery explosion is affected only once."

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

/** A fight on a 50px, 5-foot grid: the caster at (2,2), a goblin at (10,2) and an orc at (12,2). */
async function fight(caster: ActorDefinition) {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      { id: FOE, name: "Goblin", kind: "monster", hp: { current: 200, maximum: 200 }, armorClass: 12 },
      { id: FOE2, name: "Orc", kind: "monster", hp: { current: 200, maximum: 200 }, armorClass: 12 }
    ]
  });
  importActorDefinition(state, caster, HERO, "public", catalog);
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
  await place(FOE2, 12, 2);
  const cast = (actionId: string, templates: ReadonlyArray<Record<string, unknown>>) =>
    post(GAME_PATHS.actionResolve, gmToken, { commandId: randomUUID(), actorId: HERO, actionId, templates });
  return { server, cast };
}

/** A 10-foot Cube with its corner at cell (column, row). */
const cube = (column: number, row: number) => ({
  shape: "square",
  origin: { x: 50 * column, y: 50 * row },
  target: { x: 50 * (column + 2), y: 50 * (row + 2) }
});
/** A Sphere centred on cell (column, row). */
const sphere = (column: number, row: number) => ({
  shape: "circle",
  origin: { x: 25 + 50 * column, y: 25 + 50 * row },
  target: { x: 25 + 50 * (column + 8), y: 25 + 50 * row }
});

describe("Fire Storm's Cubes", () => {
  it("catches each creature under any of the touching Cubes once, and draws every Cube", async () => {
    const { server, cast } = await fight(druidAt(13, ["fire-storm"]));
    const storm = await cast("spell-fire-storm", [cube(9, 1), cube(11, 1), cube(10, 2)]);
    expect(storm.status, await storm.clone().text()).toBe(200);
    expect(
      server.store.snapshot.combat.pendingSaves.map((save) => save.targetActorId).sort((a, b) => a.localeCompare(b))
    ).toEqual([FOE, FOE2].sort((a, b) => a.localeCompare(b)));
    expect(server.store.snapshot.combat.annotations.filter((annotation) => annotation.kind === "shape")).toHaveLength(
      3
    );
  });

  it("refuses a Cube that touches no other", async () => {
    const { cast } = await fight(druidAt(13, ["fire-storm"]));
    const storm = await cast("spell-fire-storm", [cube(9, 1), cube(14, 1)]);
    expect(storm.status).toBe(409);
    expect(await storm.text()).toMatch(/Each of Fire Storm's Cubes must touch at least one other/);
  });

  it("refuses a Cube placed beyond the spell's 150 feet", async () => {
    const { cast } = await fight(druidAt(13, ["fire-storm"]));
    const storm = await cast("spell-fire-storm", [cube(9, 1), cube(35, 1), cube(37, 1)]);
    expect(storm.status).toBe(409);
    expect(await storm.text()).toMatch(/Each of Fire Storm's Cubes goes within 150 feet/);
  });
});

describe("Meteor Swarm's Spheres", () => {
  it("affects a creature in two explosions only once", async () => {
    const { server, cast } = await fight(wizardAt(17, ["meteor-swarm"]));
    const swarm = await cast("spell-meteor-swarm", [sphere(10, 2), sphere(11, 6)]);
    expect(swarm.status, await swarm.clone().text()).toBe(200);
    const saves = server.store.snapshot.combat.pendingSaves;
    expect(saves.filter((save) => save.targetActorId === FOE)).toHaveLength(1);
    expect(saves.filter((save) => save.targetActorId === FOE2)).toHaveLength(1);
  });

  it("places no more than four, each at a different point", async () => {
    const { cast } = await fight(wizardAt(17, ["meteor-swarm"]));
    const five = await cast("spell-meteor-swarm", [
      sphere(10, 2),
      sphere(11, 6),
      sphere(14, 6),
      sphere(14, 10),
      sphere(20, 10)
    ]);
    expect(await five.text()).toMatch(/Meteor Swarm places up to 4 Spheres, and 5 were placed/);
    const twice = await cast("spell-meteor-swarm", [sphere(10, 2), sphere(10, 2)]);
    expect(await twice.text()).toMatch(/Each of Meteor Swarm's Spheres goes at a different point/);
  });
});
