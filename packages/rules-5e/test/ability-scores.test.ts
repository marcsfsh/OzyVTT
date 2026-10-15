import { describe, expect, it } from "vitest";
import {
  ABILITY_ROLL_FORMULA,
  POINT_BUY_BUDGET,
  POINT_BUY_COSTS,
  STANDARD_ARRAY,
  diceExpressionBounds,
  isPointBuyLegal,
  isPointBuyScore,
  pointBuyCost,
  pointBuyRemaining,
  validateAbilityFormula
} from "../src/ability-scores.js";
import { parseDiceFormula } from "../src/dice.js";

describe("STANDARD_ARRAY", () => {
  it("is the SRD array, highest first", () => {
    expect(STANDARD_ARRAY).toEqual([15, 14, 13, 12, 10, 8]);
    // The well-known total of 72, a cheap transcription guard.
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
    // The standard array is exactly a 27-point buy: 9+7+5+4+2+0.
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

describe("ABILITY_ROLL_FORMULA", () => {
  it("is the SRD method: roll 4d6 and keep the highest three", () => {
    expect(ABILITY_ROLL_FORMULA).toBe("4d6kh3");
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
    expect(diceExpressionBounds(parseDiceFormula("2d8 - 1d4 + 3"))).toEqual({
      minimum: 2 - 4 + 3,
      maximum: 16 - 1 + 3
    });
  });
});
