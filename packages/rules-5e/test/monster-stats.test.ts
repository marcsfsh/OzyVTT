import { describe, expect, it } from "vitest";
import {
  averageOf,
  challengeBenchmarks,
  monsterHitPoints,
  proficiencyBonusForChallenge,
  spreadOf,
  statblockNumbers,
  type StatblockLike
} from "../src/monster-stats.js";

const goblinBoss: StatblockLike = {
  armorClass: 17,
  hitPoints: { maximum: 21 },
  actions: [
    {
      id: "multiattack",
      activation: "action",
      damage: [],
      multiattack: [{ actionId: "scimitar", count: 2, or: ["shortbow"] }]
    },
    { id: "scimitar", activation: "action", attack: { bonus: 4 }, damage: [{ formula: "1d6 + 2" }] },
    { id: "shortbow", activation: "action", attack: { bonus: 4 }, damage: [{ formula: "1d6 + 2" }] },
    { id: "nimble-escape", activation: "bonus-action", damage: [] }
  ]
};

describe("a stat block's numbers", () => {
  it("averages a die expression the way the stat block prints it", () => {
    expect(averageOf("1d6 + 2")).toBe(5);
    expect(averageOf("2d6")).toBe(7);
    expect(averageOf("4d10 + 1d6")).toBe(25);
    expect(averageOf("not dice")).toBeNull();
  });

  it("builds Hit Points from the dice, the size's die and Constitution", () => {
    expect(monsterHitPoints(6, "small", 10)).toEqual({ formula: "6d6", average: 21 });
    expect(monsterHitPoints(19, "huge", 25)).toEqual({ formula: "19d12 + 133", average: 256 });
    expect(monsterHitPoints(2, "tiny", 6)).toEqual({ formula: "2d4 - 4", average: 1 });
  });

  it("gives the Proficiency Bonus a stat block prints after its CR", () => {
    expect([0, 0.25, 1, 4, 5, 8, 9, 13, 17, 21, 25, 30].map(proficiencyBonusForChallenge)).toEqual([
      2, 2, 2, 2, 3, 3, 4, 5, 6, 7, 8, 9
    ]);
  });

  it("reads the best attack, the best DC and a Multiattack's damage", () => {
    expect(statblockNumbers(goblinBoss)).toEqual({
      armorClass: 17,
      hitPoints: 21,
      attackBonus: 4,
      saveDc: null,
      damagePerRound: 10
    });
  });

  it("adds the best Bonus Action and leaves legendary actions and reactions out", () => {
    const numbers = statblockNumbers({
      armorClass: 18,
      hitPoints: { maximum: 200 },
      actions: [
        { id: "bite", activation: "action", attack: { bonus: 11 }, damage: [{ formula: "2d10 + 6" }] },
        { id: "breath", activation: "action", save: { dc: 18 }, damage: [{ formula: "12d6" }] },
        { id: "tail", activation: "bonus-action", damage: [{ formula: "1d8 + 6" }] },
        { id: "parry", activation: "reaction", damage: [{ formula: "10d10" }] },
        { id: "swipe", activation: "other", legendary: { cost: 1 }, damage: [{ formula: "10d10" }] }
      ]
    });
    expect(numbers).toMatchObject({ attackBonus: 11, saveDc: 18, damagePerRound: 42 + 10 });
  });
});

describe("benchmarks by challenge rating", () => {
  it("takes the low, middle and high of each number", () => {
    expect(spreadOf([3, 1, 2])).toEqual({ count: 3, min: 1, median: 2, max: 3 });
    expect(spreadOf([10, 13])).toEqual({ count: 2, min: 10, median: 12, max: 13 });
    expect(spreadOf([])).toBeNull();
  });

  it("groups stat blocks by CR and leaves a number out where none of them has it", () => {
    const benchmarks = challengeBenchmarks([
      { challengeRating: 1, statblock: goblinBoss },
      { challengeRating: 1, statblock: { armorClass: 11, hitPoints: { maximum: 33 }, actions: [] } },
      { challengeRating: 0.5, statblock: { armorClass: 12, hitPoints: { maximum: 9 }, actions: [] } }
    ]);
    expect(benchmarks.map((entry) => entry.challengeRating)).toEqual([0.5, 1]);
    expect(benchmarks[1]).toMatchObject({
      count: 2,
      armorClass: { min: 11, median: 14, max: 17 },
      attackBonus: { count: 1, median: 4 },
      saveDc: null,
      damagePerRound: { min: 0, max: 10 }
    });
  });
});
