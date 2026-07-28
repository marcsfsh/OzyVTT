import { describe, expect, it } from "vitest";
import { DiceFormulaError } from "../src/dice.js";
import {
  ABILITIES, ABILITY_ROLL_FORMULA, POINT_BUY_BUDGET, POINT_BUY_COSTS, STANDARD_ARRAY,
  assignByPriority, diceExpressionBounds, isPointBuyLegal, isPointBuyScore, pointBuyCost,
  pointBuyRemaining, rollAbilityScores, validateAbilityFormula
} from "../src/ability-scores.js";
import { parseDiceFormula } from "../src/dice.js";
import { statPriorityFor } from "../src/class-data.js";

/** A deterministic random source: hands out the given faces in order, ignoring the die size. */
function sequence(...faces: number[]) { let index = 0; return () => faces[index++]; }

describe("STANDARD_ARRAY", () => {
  it("is the SRD array, highest first", () => {
    expect(STANDARD_ARRAY).toEqual([15, 14, 13, 12, 10, 8]);
    // 15+14+13+12+10+8 = 72 - the well-known total, a cheap transcription guard.
    expect(STANDARD_ARRAY.reduce((sum, score) => sum + score, 0)).toBe(72);
  });
});

describe("point buy", () => {
  it("uses the SRD cost table (8 free, 14 and 15 cost two points each)", () => {
    expect(POINT_BUY_COSTS).toEqual({ 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 });
    expect(pointBuyCost(8)).toBe(0);
    expect(pointBuyCost(13)).toBe(5);
    expect(pointBuyCost(14)).toBe(7);
    expect(pointBuyCost(15)).toBe(9);
  });

  it("rejects scores outside the 8-15 buy range", () => {
    expect(isPointBuyScore(7)).toBe(false);
    expect(isPointBuyScore(16)).toBe(false);
    expect(isPointBuyScore(8)).toBe(true);
    expect(() => pointBuyCost(16)).toThrow(RangeError);
    expect(() => pointBuyCost(7)).toThrow(RangeError);
  });

  it("spends exactly the 27-point budget on the classic 15/15/15/8/8/8 spread", () => {
    // 9 + 9 + 9 = 27, and three 8s are free.
    expect(pointBuyRemaining([15, 15, 15, 8, 8, 8])).toBe(0);
    expect(isPointBuyLegal([15, 15, 15, 8, 8, 8])).toBe(true);
  });

  it("prices the standard-array-shaped spread and reports what is left", () => {
    // 15,14,13,12,10,8 -> 9+7+5+4+2+0 = 27 ... the standard array is exactly a 27-point buy.
    expect(pointBuyRemaining([15, 14, 13, 12, 10, 8])).toBe(0);
    // A cheaper spread leaves points on the table.
    expect(pointBuyRemaining([14, 14, 13, 12, 10, 8])).toBe(2);
    expect(pointBuyRemaining([10, 10, 10, 10, 10, 10])).toBe(POINT_BUY_BUDGET - 12);
  });

  it("goes negative (and illegal) when the spread is over budget", () => {
    expect(pointBuyRemaining([15, 15, 15, 15, 8, 8])).toBe(-9);
    expect(isPointBuyLegal([15, 15, 15, 15, 8, 8])).toBe(false);
    expect(isPointBuyLegal([16, 8, 8, 8, 8, 8])).toBe(false);
  });

  it("honours a GM-widened budget", () => {
    expect(pointBuyRemaining([15, 15, 15, 8, 8, 8], 32)).toBe(5);
    expect(isPointBuyLegal([15, 15, 15, 15, 8, 8], 36)).toBe(true);
  });
});

describe("rollAbilityScores", () => {
  it("rolls 4d6 keep-highest-3 six times and returns the scores highest first", () => {
    expect(ABILITY_ROLL_FORMULA).toBe("4d6kh3");
    // Six groups of four faces. Group totals (drop lowest): 15, 12, 9, 18, 6(min is 3x1+... ) etc.
    const faces = [
      6, 5, 4, 1, // 15
      4, 4, 4, 4, // 12
      3, 3, 3, 3, //  9
      6, 6, 6, 6, // 18
      1, 1, 1, 1, //  3
      2, 5, 5, 1 // 12
    ];
    expect(rollAbilityScores(sequence(...faces))).toEqual([18, 15, 12, 12, 9, 3]);
  });

  it("accepts a GM-configured custom formula and still sorts descending", () => {
    // 3d6 straight, six times.
    const faces = [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6];
    expect(rollAbilityScores(sequence(...faces), "3d6")).toEqual([18, 15, 12, 9, 6, 3]);
  });

  it("refuses a formula that could produce an illegal ability score", () => {
    expect(() => rollAbilityScores(sequence(1), "4d20")).toThrow(DiceFormulaError);
    expect(() => rollAbilityScores(sequence(1), "1d6 - 3")).toThrow(DiceFormulaError);
    expect(() => rollAbilityScores(sequence(1), "1d20; rm -rf /")).toThrow(DiceFormulaError);
  });
});

describe("validateAbilityFormula", () => {
  it("clears the SRD formula and reports its range", () => {
    expect(validateAbilityFormula("4d6kh3")).toEqual({ ok: true, formula: "4d6kh3", minimum: 3, maximum: 18 });
    expect(validateAbilityFormula("2d6 + 6")).toEqual({ ok: true, formula: "2d6 + 6", minimum: 8, maximum: 18 });
  });

  it("rejects formulas that leave the 1-30 ability range or roll no dice", () => {
    expect(validateAbilityFormula("4d20").ok).toBe(false);
    expect(validateAbilityFormula("1d6 - 6").ok).toBe(false);
    // A parse failure is reported, never thrown, so the GM settings form can show it.
    const parseFailure = validateAbilityFormula("1d7");
    expect(parseFailure.ok).toBe(false);
    expect(parseFailure.ok === false && parseFailure.message).toMatch(/not supported/i);
  });
});

describe("diceExpressionBounds", () => {
  it("accounts for keep-highest, keep-lowest, and negative terms", () => {
    expect(diceExpressionBounds(parseDiceFormula("4d6kh3"))).toEqual({ minimum: 3, maximum: 18 });
    expect(diceExpressionBounds(parseDiceFormula("4d6kl1"))).toEqual({ minimum: 1, maximum: 6 });
    expect(diceExpressionBounds(parseDiceFormula("2d8 - 1d4 + 3"))).toEqual({ minimum: 2 - 4 + 3, maximum: 16 - 1 + 3 });
  });
});

describe("assignByPriority", () => {
  it("gives the best score to the class's top ability", () => {
    // A wizard wants INT first, then CON.
    expect(assignByPriority(STANDARD_ARRAY, statPriorityFor("wizard"))).toEqual({ int: 15, con: 14, dex: 13, wis: 12, cha: 10, str: 8 });
    // A barbarian wants STR first.
    expect(assignByPriority(STANDARD_ARRAY, statPriorityFor("barbarian"))).toEqual({ str: 15, con: 14, dex: 13, wis: 12, cha: 10, int: 8 });
  });

  it("sorts the incoming scores itself, so roll order does not matter", () => {
    expect(assignByPriority([8, 15, 10, 14, 12, 13], statPriorityFor("wizard"))).toEqual(assignByPriority(STANDARD_ARRAY, statPriorityFor("wizard")));
  });

  it("completes a short (homebrew) priority list in SRD sheet order", () => {
    // Only CHA is stated; the rest fall through str, dex, con, int, wis.
    expect(assignByPriority(STANDARD_ARRAY, ["cha"])).toEqual({ cha: 15, str: 14, dex: 13, con: 12, int: 10, wis: 8 });
    // An unknown class falls back to sheet order entirely.
    expect(assignByPriority(STANDARD_ARRAY, statPriorityFor("moon-warden"))).toEqual({ str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 });
  });

  it("always fills all six abilities and never drops a score", () => {
    const assigned = assignByPriority(STANDARD_ARRAY, statPriorityFor("paladin"));
    expect(Object.keys(assigned).sort()).toEqual([...ABILITIES].sort());
    expect(Object.values(assigned).sort((a, b) => b - a)).toEqual([...STANDARD_ARRAY]);
  });

  it("requires exactly six scores", () => {
    expect(() => assignByPriority([15, 14, 13], statPriorityFor("wizard"))).toThrow(RangeError);
  });
});
