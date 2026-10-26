import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import { damageObject } from "../src/objects.js";
import { movementCost } from "../src/terrain.js";
import { fight, FOE, HERO } from "./spell-casters.js";
import { cell, GRID, place, wizardAt } from "./zone-fixtures.js";

// SRD 5.2.1 walls raised in the forms their spells print: Wall of Force's dome or globe, Wall of Stone's thin panels,
// and the stone's immunities.

/** Turns the fight's map into a 3000-pixel square of 5-foot, 50-pixel cells with dynamic vision on. */
function withVision(state: GameState): void {
  state.combat.vision = {
    ...state.combat.vision,
    enabled: true,
    walls: [],
    measure: { width: 3000, height: 3000, pixelsPerFoot: 10 }
  };
}

const line = (c1: number, c2: number, row: number) => ({
  shape: "line" as const,
  origin: cell(c1, row),
  target: cell(c2, row)
});

describe("Wall of Force's dome or globe", () => {
  it("rings the point it is placed on, 10 feet out, and holds a creature inside it", () => {
    const caster = fight(wizardAt(9, ["wall-of-force"]));
    place(caster.state, { [HERO]: cell(2, 2), [FOE]: cell(10, 10) });
    withVision(caster.state);
    caster.resolve("spell-wall-of-force", {
      targetIds: [],
      areaPlaced: true,
      option: "globe",
      // A 10-foot radius round the goblin: two squares.
      placedArea: { shape: "circle", origin: cell(10, 10), target: cell(12, 10) }
    });
    const walls = caster.state.combat.vision.walls;
    expect(walls.length).toBeGreaterThan(8);
    expect(walls.every((wall) => wall.kind === "window" && wall.source?.spellId === "wall-of-force")).toBe(true);
    expect(movementCost(caster.state, GRID, FOE, cell(10, 10), cell(16, 10))?.blocked).toBe(true);
    expect(movementCost(caster.state, GRID, FOE, cell(10, 10), cell(11, 10))?.blocked).toBeUndefined();
    expect(caster.state.combat.spellZones).toEqual([
      expect.objectContaining({ spellId: "wall-of-force", laterActionId: "spell-wall-of-force-then-globe" })
    ]);
  });
});

describe("Wall of Stone", () => {
  it("is immune to Poison and Psychic damage, and breaks to other damage", () => {
    const caster = fight(wizardAt(9, ["wall-of-stone"]));
    place(caster.state, { [HERO]: cell(5, 2) });
    withVision(caster.state);
    caster.resolve("spell-wall-of-stone", { targetIds: [], areaPlaced: true, placedArea: line(0, 20, 5) });
    const panel = caster.state.combat.vision.walls[0]!;
    expect(panel.object?.immunities).toEqual(["poison", "psychic"]);
    const poisoned = damageObject(caster.state, { wallId: panel.id }, [{ amount: 200, type: "poison" }]);
    expect(poisoned).toMatchObject({ destroyed: false, hitPointsLeft: 180 });
    expect(damageObject(caster.state, { wallId: panel.id }, [{ amount: 200, type: "psychic" }]).destroyed).toBe(false);
    expect(damageObject(caster.state, { wallId: panel.id }, [{ amount: 200, type: "bludgeoning" }]).destroyed).toBe(
      true
    );
  });

  it("raises 10-by-20-foot panels of 90 Hit Points, 3 inches thick, when that form is picked", () => {
    const caster = fight(wizardAt(9, ["wall-of-stone"]));
    place(caster.state, { [HERO]: cell(5, 2) });
    withVision(caster.state);
    // A 200-foot Line: forty squares.
    caster.resolve("spell-wall-of-stone", {
      targetIds: [],
      areaPlaced: true,
      option: "thin",
      placedArea: line(0, 40, 5)
    });
    const walls = caster.state.combat.vision.walls;
    expect(walls).toHaveLength(10);
    expect(walls[0]!.object).toMatchObject({ name: "Thin stone panel", hitPoints: { current: 90, maximum: 90 } });
  });
});
