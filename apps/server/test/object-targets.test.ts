import { describe, expect, it } from "vitest";
import type { GameState, VisionWall } from "@vtt/domain";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { findObject } from "../src/objects.js";
import { answerSave } from "../src/saving-throws.js";
import { catalogRow, fight, fighterInput, IDS, resolveAt, tableOf, write } from "./equipment-table.js";
import { catalog, fight as castingFight, FOE, HERO } from "./spell-casters.js";
import { cell, GM, nextId, place, wizardAt } from "./zone-fixtures.js";

// SRD 5.2.1 Breaking Objects: an object "fails all saving throws". Acid, Alchemist's Fire and Oil "target one creature or
// object", and Shatter's and Meteor Swarm's areas harm "a nonmagical object that isn't being worn or carried".

const DOOR = "52000000-0000-4000-8000-0000000000d1";
const door: VisionWall = { id: DOOR, kind: "door", a: { x: 500, y: 250 }, b: { x: 500, y: 300 }, open: false };

function withDoor(state: GameState): void {
  state.combat.vision = {
    ...state.combat.vision,
    enabled: true,
    walls: [door],
    measure: { width: 3000, height: 3000, pixelsPerFoot: 10 }
  };
}

const doorHitPoints = (state: GameState) => findObject(state, { wallId: DOOR })?.stats.hitPoints.current;

describe("a flask thrown at an object", () => {
  function thrower(...rows: string[]) {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    for (const row of rows) write(table, IDS.fighter, catalogRow(row, { quantity: 2, equipped: false }));
    fight(table, IDS.fighter);
    withDoor(table.state);
    return table;
  }
  const fresh = (state: GameState) => {
    state.combat.turn = { ...state.combat.turn, actionUsed: false, actionInstance: null };
  };

  it("Acid deals its 2d6 to a wooden door's Hit Points with no save", () => {
    const table = thrower("acid");
    const result = resolveAt(table, IDS.fighter, "item-acid-throw", [3, 4], { targetIds: [], wallId: DOOR });
    expect(table.state.combat.pendingSaves).toEqual([]);
    expect(doorHitPoints(table.state)).toBe(18 - 7);
    expect(result.tableNarration?.map((line) => line.text)).toContain("Throw Acid deals 7 damage to the door.");
  });

  it("Alchemist's Fire deals its 1d4 Fire to the door, and Oil on it first burns for 5 more", () => {
    const plain = thrower("alchemists-fire");
    resolveAt(plain, IDS.fighter, "item-alchemists-fire-throw", [2], { targetIds: [], wallId: DOOR });
    expect(doorHitPoints(plain.state)).toBe(16);

    const oiled = thrower("oil", "alchemists-fire");
    resolveAt(oiled, IDS.fighter, "item-oil-throw", [], { targetIds: [], wallId: DOOR });
    expect(findObject(oiled.state, { wallId: DOOR })?.stats.oiledUntil).toBeDefined();
    fresh(oiled.state);
    resolveAt(oiled, IDS.fighter, "item-alchemists-fire-throw", [2], { targetIds: [], wallId: DOOR });
    expect(doorHitPoints(oiled.state)).toBe(18 - 2 - 5);
    // The oil burned off.
    expect(findObject(oiled.state, { wallId: DOOR })?.stats.oiledUntil).toBeUndefined();
  });

  it("refuses a wall that isn't an object", () => {
    const table = thrower("acid");
    table.state.combat.vision.walls = [{ ...door, kind: "wall" }];
    expect(() =>
      resolveAt(table, IDS.fighter, "item-acid-throw", [3, 4], { targetIds: [], wallId: DOOR })
    ).toThrowError("Choose a door, or a wall that can be broken, on the map.");
  });
});

describe("an area over an object", () => {
  it("Shatter deals its full 3d8 Thunder to a door in its Sphere", () => {
    const caster = castingFight(wizardAt(5, ["shatter"]));
    place(caster.state, { [HERO]: cell(2, 2) });
    withDoor(caster.state);
    caster.resolve(
      "spell-shatter",
      {
        targetIds: [],
        areaPlaced: true,
        placedArea: { shape: "circle", origin: cell(10, 5), target: cell(12, 5) }
      },
      [2, 2, 2]
    );
    expect(doorHitPoints(caster.state)).toBe(18 - 6);
  });

  it("gives a Construct Disadvantage on Shatter's save", () => {
    const armor = loadMonsterDefinitions().find((entry) => entry.source?.externalId === "animated-armor")!;
    const caster = castingFight(wizardAt(5, ["shatter"]));
    caster.state.actors.find((actor) => actor.id === FOE)!.definitionId = "armor";
    caster.resolve("spell-shatter", { targetIds: [FOE] }, [2, 2, 2]);
    const pending = caster.state.combat.pendingSaves.find((save) => save.targetActorId === FOE)!;
    const faces = [18, 3];
    const answered = answerSave(caster.state, nextId(), pending.id, "roll", undefined, true, GM, {
      random: () => faces.shift() ?? 10,
      newRollId: nextId,
      sessionId: "30000000-0000-4000-8000-00000000000a",
      role: "gm",
      now: () => "2026-10-19T00:00:00.000Z",
      resolveDefinition: (id) => (id === "armor" ? armor : undefined),
      catalog
    });
    expect(answered.outcome.rollMode?.disadvantage).toContain("Shatter: its creature type");
    expect(answered.outcome.success).toBe(false);
  });

  it("Fireball, which harms no object, leaves the door alone", () => {
    const caster = castingFight(wizardAt(5, ["fireball"]));
    place(caster.state, { [HERO]: cell(2, 2) });
    withDoor(caster.state);
    caster.resolve(
      "spell-fireball",
      {
        targetIds: [],
        areaPlaced: true,
        placedArea: { shape: "circle", origin: cell(10, 5), target: cell(14, 5) }
      },
      [6, 6, 6, 6, 6, 6, 6, 6]
    );
    expect(caster.state.combat.vision.walls[0]!.object).toBeUndefined();
  });
});
