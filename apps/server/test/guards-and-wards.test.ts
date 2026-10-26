import { describe, expect, it } from "vitest";
import type { GameState, VisionWall } from "@vtt/domain";
import { heldShutAgainst } from "../src/doors.js";
import { endEffect } from "../src/effects.js";
import { pruneEndedWalls } from "../src/spell-walls.js";
import { ALLY, fight, FOE, HERO } from "./spell-casters.js";
import { carry, cell, place, wizardAt } from "./zone-fixtures.js";

// SRD 5.2.1 Guards and Wards: a ward over "up to 2,500 square feet of floor space" for 24 hours, in which "All doors in
// the warded area are magically locked, as if sealed by the Arcane Lock spell", the caster and the creatures it names
// unaffected.

const CAST = "68000000-0000-4000-8000-0000000000e1";
const INSIDE = "68000000-0000-4000-8000-0000000000e2";
const OUTSIDE = "68000000-0000-4000-8000-0000000000e3";

const door = (id: string, x: number): VisionWall => ({
  id,
  kind: "door",
  a: { x, y: 600 },
  b: { x, y: 650 },
  open: false
});
const doorOf = (state: GameState, id: string) => state.combat.vision.walls.find((wall) => wall.id === id)!;

function warded() {
  const caster = fight(wizardAt(11, ["guards-and-wards"]), { combat: false, ally: true });
  caster.state.actors.find((actor) => actor.id === ALLY)!.kind = "player-character";
  place(caster.state, { [HERO]: cell(12, 12), [FOE]: cell(30, 30), [ALLY]: cell(13, 13) });
  carry(caster.state, HERO, "Silver rod");
  caster.state.combat.vision = {
    ...caster.state.combat.vision,
    walls: [door(INSIDE, 750), door(OUTSIDE, 1500)],
    measure: { width: 3000, height: 3000, pixelsPerFoot: 10 }
  };
  caster.resolve("spell-guards-and-wards", {
    targetIds: [],
    commandId: CAST,
    areaPlaced: true,
    placedArea: { shape: "square", origin: { x: 500, y: 500 }, target: { x: 1000, y: 1000 } }
  });
  return caster;
}

describe("Guards and Wards", () => {
  it("locks every door in its square against all but its caster and allies", () => {
    const { state } = warded();
    expect(heldShutAgainst(state, doorOf(state, INSIDE), FOE)).toBe("The door is locked.");
    expect(heldShutAgainst(state, doorOf(state, INSIDE), HERO)).toBeNull();
    expect(heldShutAgainst(state, doorOf(state, INSIDE), ALLY)).toBeNull();
    expect(heldShutAgainst(state, doorOf(state, OUTSIDE), FOE)).toBeNull();
  });

  it("opens the locks once the spell ends", () => {
    const { state } = warded();
    const keeper = state.actors
      .find((actor) => actor.id === HERO)!
      .effects.find((effect) => effect.spell?.id === "guards-and-wards")!;
    endEffect(state, HERO, keeper.id);
    pruneEndedWalls(state);
    expect(heldShutAgainst(state, doorOf(state, INSIDE), FOE)).toBeNull();
  });
});
