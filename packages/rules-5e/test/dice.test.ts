import { describe, expect, it } from "vitest";
import { d20Die, DiceFormulaError, parseDiceFormula, rollDice } from "../src/index.js";

function sequence(...faces: number[]) {
  let index = 0;
  return () => faces[index++];
}

describe("server-safe dice grammar", () => {
  it("resolves multiple groups and a modifier deterministically", () => {
    const result = rollDice("2d6 + 1d4 - 2", sequence(3, 6, 4));
    expect(result.total).toBe(11);
    expect(result.terms[0]).toMatchObject({ kind: "dice", subtotal: 9 });
  });
  it("retains every face while keeping only the highest die", () => {
    const result = rollDice("2d20kh1 + 5", sequence(4, 17));
    expect(result.total).toBe(22);
    expect(result.terms[0]).toMatchObject({
      dice: [
        { face: 4, kept: false },
        { face: 17, kept: true }
      ]
    });
  });
  it.each(["1d7", "0d6", "2d20kh3", "1d20;process.exit()", "1d20++5"])(
    'rejects unsupported formula "%s"',
    (formula) => {
      expect(() => parseDiceFormula(formula)).toThrow(DiceFormulaError);
    }
  );
  it("rejects an invalid random source", () => {
    expect(() => rollDice("1d6", () => 7)).toThrow(RangeError);
  });
  it("rolls two d20s keeping one under advantage or disadvantage", () => {
    expect(d20Die("advantage")).toBe("2d20kh1");
    expect(d20Die("disadvantage")).toBe("2d20kl1");
    expect([d20Die("normal"), d20Die(null), d20Die(undefined)]).toEqual(["1d20", "1d20", "1d20"]);
  });
});
