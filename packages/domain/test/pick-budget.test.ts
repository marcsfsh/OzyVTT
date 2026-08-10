import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { classResourceGrowth, extraPickAmount, type PrintedResourceRow } from "../src/pick-budget.js";

/**
 * THE NUMBER A LEVEL-20 CHARACTER IS OWED, against the columns the SRD actually prints.
 *
 * The three records the pre-Stage-4 audit put in Tier 1 are the only gaps where a build was
 * quantifiably, countably wrong rather than merely missing something - so they are checked against
 * the shipped bundle's own level table, not a fixture that could agree with a mistake.
 */
const classes = createRequire(import.meta.url)("../../content-srd-5.2.1/bundles/classes.v1.json") as Array<{
  id: string; levelTable: PrintedResourceRow[]; features: Array<{ id: string; choice?: { choose: number } }>;
}>;
const tableOf = (id: string) => classes.find((record) => record.id === id)!.levelTable;
const chooseOf = (classId: string, featureId: string) =>
  classes.find((record) => record.id === classId)!.features.find((feature) => feature.id === featureId)!.choice!.choose;

describe("a pick budget that follows a printed column", () => {
  it("gives a Warlock the Invocations the column prints, at every level it steps", () => {
    const printed = [1, 3, 3, 3, 5, 5, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 9, 10, 10, 10];
    const choose = chooseOf("warlock", "eldritch-invocations");
    const offered = printed.map((_, index) => choose + classResourceGrowth(tableOf("warlock"), index + 1, "eldritch-invocations"));
    // `choose` plus the growth IS the printed column - all twenty rows, not just the endpoints.
    expect(offered).toEqual(printed);
    expect(offered[19]).toBe(10); // the level-20 Warlock who used to be offered one
  });

  it("gives Fighter and Barbarian the Weapon Mastery the column prints", () => {
    const fighter = [3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6];
    const barbarian = [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4];
    for (const [classId, printed] of [["fighter", fighter], ["barbarian", barbarian]] as const) {
      const choose = chooseOf(classId, "weapon-mastery");
      expect(printed.map((_, index) => choose + classResourceGrowth(tableOf(classId), index + 1, "weapon-mastery")), classId).toEqual(printed);
    }
  });

  it("adds nothing where there is nothing to read", () => {
    // A column this class does not print, and a DICE column ("3d6" is not a count of anything) both
    // resolve to zero - the same "adds nothing" a flat grant of zero would mean.
    expect(classResourceGrowth(tableOf("warlock"), 20, "rage")).toBe(0);
    expect(classResourceGrowth(tableOf("rogue"), 20, "sneak-attack")).toBe(0);
    expect(classResourceGrowth([], 5, "eldritch-invocations")).toBe(0);
  });

  it("never returns a negative, so a column that shrinks cannot take back a spent pick", () => {
    const shrinking: PrintedResourceRow[] = [
      { level: 1, classResources: [{ id: "x", amount: 4 }] },
      { level: 2, classResources: [{ id: "x", amount: 2 }] }
    ];
    expect(classResourceGrowth(shrinking, 2, "x")).toBe(0);
  });

  it("resolves a flat grant and a scaled grant through the same function", () => {
    expect(extraPickAmount({ offer: "class-cantrips", amount: 1 }, tableOf("warlock"), 20)).toBe(1);
    expect(extraPickAmount(
      { offer: "feature:eldritch-invocations", scaling: { type: "class-resource-growth", id: "eldritch-invocations" } },
      tableOf("warlock"), 20
    )).toBe(9);
  });
});
