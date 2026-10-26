import { randomUUID } from "node:crypto";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema, type GameState, type VisionWall } from "@vtt/domain";
import { afterEach, describe, expect, it } from "vitest";
import { importActorDefinition } from "../src/actor-roster.js";
import { addEffect, makeEffect } from "../src/effects.js";
import { findObject, objectFrom } from "../src/objects.js";
import { zonesAtTurnEnd } from "../src/spell-zones.js";
import { bootServer } from "./boot-server.js";
import { png } from "./image-fixtures.js";
import { build, catalog, fight as castingFight, FOE, FOE2, HERO, wizardInput } from "./spell-casters.js";
import { carry, cell, clericAt, drawArea, place, zoneDeps } from "./zone-fixtures.js";

// SRD 5.2.1 Thunderous Greatclub: "an extra 3d8 Thunder damage to objects it hits that aren't being worn or carried",
// Clap of Thunder's Cone ("Nonmagical objects in the Cone that aren't being worn or carried take 3d8 Thunder damage"),
// and Earthquake ("Each creature on the ground in that area must succeed on a DC 20 Dexterity saving throw or have the
// Prone condition. If that creature is also concentrating, it must succeed on a DC 20 Constitution saving throw or its
// Concentration is broken", and "Structures ... take 50 Bludgeoning damage"). SRD 5.2.1 Earthquake: "The tremor deals
// 50 Bludgeoning damage to any structure in contact with the ground in the area when you cast the spell and at the end
// of each of your turns until the spell ends."

const DOOR = "52000000-0000-4000-8000-0000000000f1";
const CAST = "52000000-0000-4000-8000-0000000000f2";
const door: VisionWall = { id: DOOR, kind: "door", a: { x: 500, y: 250 }, b: { x: 500, y: 300 }, open: false };

function withDoor(state: GameState, sturdy = false): void {
  state.combat.vision = {
    ...state.combat.vision,
    enabled: true,
    walls: [sturdy ? { ...door, object: objectFrom({ name: "Gate", armorClass: 19, hitPoints: 200 }) } : door],
    measure: { width: 3000, height: 3000, pixelsPerFoot: 10 }
  };
}

const doorHitPoints = (state: GameState) => findObject(state, { wallId: DOOR })?.stats.hitPoints.current;

const concentrating = (state: GameState, actorId: string) =>
  addEffect(
    state,
    actorId,
    makeEffect({
      id: `${actorId}:concentration`,
      name: "Concentrating on Bless",
      tags: ["concentrating"],
      concentration: true,
      castId: `${actorId}-bless`,
      sourceActorId: actorId,
      duration: { type: "rounds", remaining: 10 }
    })
  );

/** The wizard holding the attuned club at (9, 5), west of the door; the goblin east of it. */
function clubber() {
  const table = castingFight(build(wizardInput([])));
  place(table.state, { [HERO]: cell(9, 5), [FOE]: cell(11, 5) });
  carry(table.state, HERO, "Thunderous Greatclub");
  const hero = table.state.actors.find((actor) => actor.id === HERO)!;
  hero.inventory = hero.inventory.map((row) =>
    row.name === "Thunderous Greatclub" ? { ...row, equipped: true, attuned: true } : row
  );
  withDoor(table.state);
  return table;
}

describe("Thunderous Greatclub against objects", () => {
  it("Clap of Thunder deals 3d8 Thunder to a door in its Cone", () => {
    const table = clubber();
    const used = table.resolve(
      "item-thunderous-greatclub-clap-of-thunder",
      { targetIds: [], placedArea: { shape: "cone", origin: cell(9, 5), target: cell(15, 5) } },
      [4, 4, 4]
    );
    const told = used.tableNarration?.map((line) => line.text).find((text) => text.startsWith("Clap of Thunder deals"));
    const dealt = Number(/deals (\d+) damage to the door/.exec(told ?? "")?.[1]);
    expect(dealt).toBeGreaterThanOrEqual(3);
    expect(doorHitPoints(table.state)).toBe(18 - dealt);
  });

  it("Earthquake deals 50 Bludgeoning to a door in its circle and asks a concentrating creature for DC 20 Constitution", () => {
    const table = clubber();
    place(table.state, { [FOE]: cell(9, 8) });
    concentrating(table.state, FOE);
    table.resolve(
      "item-thunderous-greatclub-earthquake",
      { targetIds: [FOE], placedArea: { shape: "circle", origin: cell(9, 5), target: cell(19, 5) } },
      []
    );
    expect(findObject(table.state, { wallId: DOOR })).toBeNull();
    const saves = table.state.combat.pendingSaves.filter((pending) => pending.targetActorId === FOE);
    expect(saves).toEqual([
      expect.objectContaining({ ability: "dex", dc: 20, conditionIds: ["prone"] }),
      expect.objectContaining({
        ability: "con",
        dc: 20,
        actionName: "Earthquake: Concentration",
        breaksConcentration: true
      })
    ]);
  });
});

describe("Earthquake the spell on structures", () => {
  it("deals 50 Bludgeoning to a door in its circle at the cast and as each of its caster's turns ends", () => {
    const caster = castingFight(clericAt(15, ["earthquake"]));
    place(caster.state, { [HERO]: cell(2, 2), [FOE]: cell(12, 8) });
    withDoor(caster.state, true);
    caster.resolve("spell-earthquake", {
      targetIds: [FOE],
      commandId: CAST,
      areaPlaced: true,
      placedArea: { shape: "circle", origin: cell(12, 5), target: cell(32, 5) }
    });
    expect(doorHitPoints(caster.state)).toBe(150);
    drawArea(caster.state, CAST, [12, 5], 20);
    const events = zonesAtTurnEnd(caster.state, HERO, zoneDeps());
    expect(doorHitPoints(caster.state)).toBe(100);
    expect(events.map((event) => event.text)).toContain("Earthquake deals 50 damage to the door.");
  });
});

describe("Thunderous Greatclub's Earthquake on the map", () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of closers.splice(0)) await close();
  });

  it("spares a creature 30 feet up, off the ground", async () => {
    const state = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        { id: FOE, name: "Goblin", kind: "monster", hp: { current: 20, maximum: 20 }, armorClass: 12 },
        { id: FOE2, name: "Orc", kind: "monster", hp: { current: 20, maximum: 20 }, armorClass: 12 }
      ]
    });
    importActorDefinition(state, build(wizardInput([])), HERO, "public", catalog);
    const hero = state.actors.find((actor) => actor.id === HERO)!;
    hero.inventory = [
      ...hero.inventory,
      { id: "thunderous-greatclub", name: "Thunderous Greatclub", quantity: 1, equipped: true, attuned: true }
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
    const at = (column: number, row: number) => ({ x: 25 + 50 * column, y: 25 + 50 * row });
    for (const [actorId, column] of [
      [HERO, 2],
      [FOE, 4],
      [FOE2, 6]
    ] as const)
      await post(GAME_PATHS.tokenMove.replace("{actorId}", actorId), gmToken, {
        commandId: randomUUID(),
        position: at(column, 2)
      });
    const lifted = await post(GAME_PATHS.tokenAltitude.replace("{actorId}", FOE2), gmToken, {
      commandId: randomUUID(),
      actorId: FOE2,
      altitudeFeet: 30,
      airborne: null
    });
    expect(lifted.status).toBe(200);
    const used = await post(GAME_PATHS.actionResolve, gmToken, {
      commandId: randomUUID(),
      actorId: HERO,
      actionId: "item-thunderous-greatclub-earthquake",
      template: { shape: "circle", origin: at(2, 2), target: at(4, 2) }
    });
    expect(used.status, await used.text()).toBe(200);
    const saving = server.store.snapshot.combat.pendingSaves.map((pending) => pending.targetActorId);
    expect(saving).toContain(FOE);
    expect(saving).not.toContain(FOE2);
  });
});
