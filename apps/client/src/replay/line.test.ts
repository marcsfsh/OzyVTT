import { describe, expect, it } from "vitest";
import { lineMarks, lineRounds, turnAt, turnCount, type Health, type LineTurn } from "./line";

const turn = (round: number, health: Record<string, Health>): LineTurn => ({
  round,
  health: new Map(Object.entries(health))
});

describe("the line of rounds", () => {
  it("marks damage, healing and a creature at 0 against the turn before", () => {
    const turns = [
      turn(1, { a: { current: 10 }, b: { current: 8 } }),
      turn(1, { a: { current: 6 }, b: { current: 8 } }),
      turn(1, { a: { current: 9 }, b: { current: 8 } }),
      turn(2, { a: { current: 9 }, b: { current: 0 } }),
      turn(2, { a: { current: 9 }, b: { current: 0 } })
    ];
    expect(lineMarks(turns)).toEqual([null, "damage", "heal", "down", null]);
  });

  it("reads a monster's band as a player sees it", () => {
    const turns = [
      turn(1, { m: { band: "healthy" } }),
      turn(1, { m: { band: "bloodied" } }),
      turn(1, { m: { band: "down" } })
    ];
    expect(lineMarks(turns)).toEqual([null, "damage", "down"]);
  });

  it("lets damage outweigh healing in the same turn", () => {
    const turns = [
      turn(1, { a: { current: 5 }, b: { current: 5 } }),
      turn(1, { a: { current: 7 }, b: { current: 2 } })
    ];
    expect(lineMarks(turns)).toEqual([null, "damage"]);
  });

  it("makes a section a round", () => {
    const turns = [turn(1, {}), turn(1, {}), turn(2, {}), turn(3, {}), turn(3, {})];
    expect(lineRounds(turns)).toEqual([
      { round: 1, start: 0, length: 2 },
      { round: 2, start: 2, length: 1 },
      { round: 3, start: 3, length: 2 }
    ]);
  });

  it("goes to the nearest turn from a point on the line, kept inside the fight", () => {
    expect(turnAt(0, 15)).toBe(0);
    expect(turnAt(0.5, 15)).toBe(7);
    expect(turnAt(1.4, 15)).toBe(14);
    expect(turnAt(-0.2, 15)).toBe(0);
    expect(turnAt(0.7, 1)).toBe(0);
  });

  it("counts the turns in two digits at least", () => {
    expect(turnCount(7, 15)).toBe("Turn 08 of 15");
    expect(turnCount(0, 3)).toBe("Turn 01 of 3");
    expect(turnCount(99, 120)).toBe("Turn 100 of 120");
  });
});
