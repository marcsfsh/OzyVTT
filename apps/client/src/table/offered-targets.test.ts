import { describe, expect, it } from "vitest";
import { offeredTargets, targetReachFeet } from "./targetRows";

// The target picker offers only the creatures an action can take (#152): none beyond its reach or range where the
// map measures it, and none that is dead for an action that harms. The server still decides.

const rows = [{ id: "near", feet: 5 }, { id: "far", feet: 40 }, { id: "unmeasured" }, { id: "dead", feet: 5 }];
const dead = (id: string) => id === "dead";
const ids = (list: ReadonlyArray<{ id: string }>) => list.map((row) => row.id);

describe("the creatures a picker offers", () => {
  it("leaves out a creature beyond a melee reach, and a dead one, from an attack", () => {
    const sword = { reachFeet: 5, rangeFeet: null, attackBonus: 5, saveAbility: null, damage: [{}] };
    expect(ids(offeredTargets(rows, sword, dead))).toEqual(["near", "unmeasured"]);
  });

  it("keeps a creature within a bow's long range", () => {
    const bow = { reachFeet: null, rangeFeet: 600, attackBonus: 5, saveAbility: null, damage: [{}] };
    expect(ids(offeredTargets(rows, bow, dead))).toEqual(["near", "far", "unmeasured"]);
  });

  it("reads a touch from the action's own target range, and offers the dead to what doesn't harm", () => {
    const touch = {
      reachFeet: null,
      rangeFeet: null,
      targetRangeFeet: 5,
      attackBonus: null,
      saveAbility: null,
      damage: []
    };
    expect(targetReachFeet(touch)).toBe(5);
    expect(ids(offeredTargets(rows, touch, dead))).toEqual(["near", "unmeasured", "dead"]);
  });
});
