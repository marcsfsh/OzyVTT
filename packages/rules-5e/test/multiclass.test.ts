import { describe, expect, it } from "vitest";
import {
  meetsMulticlassMinimums,
  multiclassShortfalls,
  multiclassShortfallText,
  standardArrayOrder,
  statPriorityFor
} from "../src/index.js";

// SRD 5.2.1 Multiclassing: "To qualify for a new class, you must have a score of at least 13 in the primary ability of
// the new class and your current classes."

const barbarian = {
  id: "barbarian",
  name: "Barbarian",
  multiclassPrerequisites: { mode: "all", minimums: [{ ability: "str", minimum: 13 }] }
} as const;
const druid = {
  id: "druid",
  name: "Druid",
  multiclassPrerequisites: { mode: "all", minimums: [{ ability: "wis", minimum: 13 }] }
} as const;
const fighter = {
  id: "fighter",
  name: "Fighter",
  multiclassPrerequisites: {
    mode: "any",
    minimums: [
      { ability: "str", minimum: 13 },
      { ability: "dex", minimum: 13 }
    ]
  }
} as const;
const homebrew = { id: "moon-warden", name: "Moon Warden", multiclassPrerequisites: null };

const scores = (overrides: Record<string, number>) => ({
  str: 10,
  dex: 10,
  con: 10,
  int: 10,
  wis: 10,
  cha: 10,
  ...overrides
});

describe("multiclass prerequisites", () => {
  it("checks the new class and every class already taken (the SRD's Barbarian into Druid)", () => {
    expect(multiclassShortfalls(scores({ str: 13, wis: 13 }), druid, [barbarian])).toEqual([]);
    // Wisdom alone is not enough: the Barbarian's own Strength 13 is checked too.
    expect(multiclassShortfalls(scores({ wis: 15 }), druid, [barbarian])).toEqual([barbarian]);
    expect(multiclassShortfalls(scores({ str: 15 }), druid, [barbarian])).toEqual([druid]);
    expect(multiclassShortfalls(scores({}), druid, [barbarian])).toEqual([druid, barbarian]);
  });

  it("reads 'any' minimums as either ability, and a class with none as open", () => {
    expect(meetsMulticlassMinimums(scores({ dex: 13 }), fighter.multiclassPrerequisites)).toBe(true);
    expect(meetsMulticlassMinimums(scores({ str: 12, dex: 12 }), fighter.multiclassPrerequisites)).toBe(false);
    expect(meetsMulticlassMinimums(scores({}), homebrew.multiclassPrerequisites)).toBe(true);
    expect(multiclassShortfalls(scores({}), homebrew, [homebrew])).toEqual([]);
  });

  it("says plainly what is missing, naming the new class and then the classes already taken", () => {
    const text = multiclassShortfallText(scores({ str: 10, dex: 12 }), druid, [druid, fighter]);
    expect(text).toBe(
      "Druid needs Wisdom 13; you have 10. Your Fighter needs Strength 13 or Dexterity 13; you have Strength 10 and Dexterity 12."
    );
  });
});

describe("the standard array's order", () => {
  it("follows one class's own priority", () => {
    expect(standardArrayOrder(statPriorityFor("fighter"), [fighter])).toEqual(statPriorityFor("fighter"));
  });

  it("puts every class's 13 first for a multiclass character", () => {
    // A Barbarian who takes Druid needs Wisdom 13 as well as Strength.
    const order = standardArrayOrder(statPriorityFor("barbarian"), [barbarian, druid]);
    expect(order.slice(0, 2).sort()).toEqual(["str", "wis"]);
    expect(new Set(order).size).toBe(6);
  });
});
