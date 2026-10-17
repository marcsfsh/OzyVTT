import { describe, expect, it } from "vitest";
import {
  d20Count,
  d20Die,
  d20FacesFor,
  d20TestFormula,
  DiceFormulaError,
  formulaPlus,
  keptD20,
  otherDiceOf,
  parseDiceFormula,
  rerollLowestD20,
  resolveWithD20s,
  rollDice
} from "../src/index.js";

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
  it("writes a D20 Test's modifier with its sign, even at zero", () => {
    expect(d20TestFormula("advantage", 5)).toBe("2d20kh1 + 5");
    expect(d20TestFormula("normal", -2)).toBe("1d20 - 2");
    expect(d20TestFormula(undefined, 0)).toBe("1d20 + 0");
  });
});

describe("a d20 test's held faces", () => {
  it("throws one d20 for a normal roll and two under Advantage or Disadvantage", () => {
    expect([d20Count("normal"), d20Count(null), d20Count("advantage"), d20Count("disadvantage")]).toEqual([1, 1, 2, 2]);
  });
  it("keeps the higher with Advantage, the lower with Disadvantage, else the first", () => {
    expect(keptD20([3, 17], "advantage")).toBe(17);
    expect(keptD20([3, 17], "disadvantage")).toBe(3);
    expect(keptD20([3, 17], "normal")).toBe(3);
  });
  it("keeps the faces already thrown and only tops them up, so a second look is no re-roll", () => {
    const random = sequence(11);
    expect(d20FacesFor("normal", [8], random)).toEqual([8]);
    // The mode now needs a second die: the 8 stays and one more is thrown.
    expect(d20FacesFor("advantage", [8], random)).toEqual([8, 11]);
    expect(d20FacesFor("disadvantage", [], sequence(19, 4))).toEqual([19, 4]);
    // A normal look at two held faces uses the first, the one thrown first.
    expect(keptD20(d20FacesFor("normal", [8, 11], sequence()), "normal")).toBe(8);
  });
  it("rerolls the lowest die only (Heroic Inspiration)", () => {
    expect(rerollLowestD20([3, 18], sequence(12))).toEqual([12, 18]);
    expect(rerollLowestD20([1], sequence(20))).toEqual([20]);
  });
  it("records the decided d20s and throws the rest of the formula", () => {
    const resolution = resolveWithD20s("2d20kl1 + 5 + 1d4", [6, 14], sequence(3));
    expect(resolution.total).toBe(6 + 5 + 3);
    expect(resolution.terms[0]).toMatchObject({
      dice: [
        { face: 6, kept: true },
        { face: 14, kept: false }
      ]
    });
    expect(otherDiceOf(resolution)).toEqual([{ sides: 4, face: 3 }]);
  });
  it("keeps a held roll's other dice too, so a second look rethrows nothing", () => {
    const resolution = resolveWithD20s("1d20 + 2 + 1d4", [9], sequence(), [{ sides: 4, face: 2 }]);
    expect(resolution.total).toBe(13);
  });
});

describe("folding a modifier into a formula", () => {
  it("keeps one constant term", () => {
    expect(formulaPlus("2d8", 3)).toBe("2d8 + 3");
    expect(formulaPlus("4d8 + 15", 2)).toBe("4d8 + 17");
    expect(formulaPlus("1d4 + 1", -1)).toBe("1d4");
    expect(formulaPlus("2d4", -3)).toBe("2d4 - 3");
    expect(formulaPlus("70", 0)).toBe("70");
  });
});
