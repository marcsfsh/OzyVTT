import { randomUUID } from "node:crypto";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema } from "@vtt/domain";
import { afterEach, describe, expect, it } from "vitest";
import { importActorDefinition } from "../src/actor-roster.js";
import { bootServer } from "./boot-server.js";
import { png } from "./image-fixtures.js";
import { build, catalog, druidInput, FOE, HERO } from "./spell-casters.js";

// The spell areas through the commands the table sends: an aura settles onto a creature the GM moves into it, and
// Moonbeam's Magic action moves the Cylinder it already placed onto a creature, which owes the save.

const ALLY = "10000000-0000-4000-8000-0000000000c2";
const druid = build(druidInput(["moonbeam", "pass-without-trace"]));

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

/** A fight on a 50px, 5-foot grid: the druid, a party ally and a goblin. */
async function fight() {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      { id: ALLY, name: "Borin", kind: "player-character", hp: { current: 30, maximum: 30 } },
      { id: FOE, name: "Goblin", kind: "monster", hp: { current: 200, maximum: 200 }, armorClass: 12 }
    ]
  });
  importActorDefinition(state, druid, HERO, "public", catalog);
  const booted = await bootServer(state);
  closers.push(booted.close);
  const { server, gmToken, post } = booted;
  const imported = await server.mapAssets.import(png(1500, 1000), "glade.png");
  server.mapCatalog.register(imported.metadata.id, "Glade", "battlemap");
  server.mapCatalog.saveCalibration(imported.metadata.id, {
    calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 },
    verifiedAt: null,
    verificationPoint: null,
    verificationErrorPx: null
  });
  const started = await post(GAME_PATHS.encounterStart, gmToken, {
    commandId: randomUUID(),
    mapAssetId: imported.metadata.id,
    entries: [
      { actorId: HERO, score: 20 },
      { actorId: ALLY, score: 15 },
      { actorId: FOE, score: 10 }
    ]
  });
  expect(started.status).toBe(200);
  const place = async (actorId: string, column: number, row: number) =>
    expect(
      (
        await post(GAME_PATHS.tokenMove.replace("{actorId}", actorId), gmToken, {
          commandId: randomUUID(),
          position: { x: 25 + 50 * column, y: 25 + 50 * row }
        })
      ).status
    ).toBe(200);
  await place(HERO, 2, 2);
  await place(ALLY, 2, 14);
  await place(FOE, 20, 2);
  const resolve = (body: Record<string, unknown>) =>
    post(GAME_PATHS.actionResolve, gmToken, { commandId: randomUUID(), actorId: HERO, ...body });
  return { ...booted, place, resolve };
}

const auraOn = (effects: ReadonlyArray<{ tags: readonly string[]; name: string }>) =>
  effects.find((effect) => effect.tags.includes("zone-aura"))?.name;

describe("spell areas through the table's commands", () => {
  it("settles an aura onto a creature moved into it, and off it as it leaves", async () => {
    const { server, place, resolve } = await fight();
    const cast = await resolve({ actionId: "spell-pass-without-trace" });
    expect(cast.status, JSON.stringify(await cast.clone().json())).toBe(200);
    const actor = (id: string) => server.store.snapshot.actors.find((candidate) => candidate.id === id)!;
    expect(auraOn(actor(HERO).effects)).toBe("Pass without Trace");
    expect(auraOn(actor(ALLY).effects)).toBeUndefined();
    await place(ALLY, 4, 2);
    expect(auraOn(actor(ALLY).effects)).toBe("Pass without Trace");
    await place(ALLY, 2, 18);
    expect(auraOn(actor(ALLY).effects)).toBeUndefined();
  });

  it("moves Moonbeam's Cylinder with the later Magic action, onto a creature that owes the save", async () => {
    const { server, gmToken, post, resolve } = await fight();
    const cast = await resolve({
      actionId: "spell-moonbeam",
      template: { shape: "circle", origin: { x: 525, y: 525 }, target: { x: 575, y: 525 } }
    });
    expect(cast.status).toBe(200);
    // Round the order back to the druid's turn.
    for (let step = 0; step < 3; step++)
      expect((await post(GAME_PATHS.initiativeNext, gmToken, { commandId: randomUUID() })).status).toBe(200);
    expect(server.store.snapshot.combat.turnActorId).toBe(HERO);
    const move = await resolve({
      actionId: "spell-moonbeam-then-move",
      template: { shape: "circle", origin: { x: 1025, y: 125 }, target: { x: 1075, y: 125 } }
    });
    expect(move.status).toBe(200);
    const combat = server.store.snapshot.combat;
    const zone = combat.spellZones.find((candidate) => candidate.spellId === "moonbeam")!;
    expect(combat.annotations.filter((annotation) => annotation.kind === "shape")).toHaveLength(1);
    expect(combat.annotations.find((annotation) => annotation.id === zone.annotationId)!.geometry.origin).toEqual({
      x: 1025,
      y: 125
    });
    expect(combat.pendingSaves).toEqual([
      expect.objectContaining({ targetActorId: FOE, ability: "con", zoneId: zone.id })
    ]);
  });
});
