import { describe, expect, it } from "vitest";
import { setAltitude } from "../src/altitude.js";
import { zonesAtTurnEnd } from "../src/spell-zones.js";
import { build, clericInput, druidInput, fight, FOE, HERO } from "./spell-casters.js";
import { cell, drawArea, druidAt, place, savesOf, walk, wizardAt, zoneDeps } from "./zone-fixtures.js";

// SRD 5.2.1: an area has the height its shape gives it. A Sphere reaches its radius above and below its centre,
// Moonbeam's Cylinder is 40 feet high, an Emanation reaches its distance in every direction, and Earthquake shakes
// only "each creature on the ground in the area".

const CAST = "60000000-0000-4000-8000-0000000000f1";

/** Casts `actionId` with its area drawn at `center` (`radius` cells). */
function castArea(
  caster: ReturnType<typeof fight>,
  actionId: string,
  center: readonly [number, number],
  radius: number
) {
  caster.resolve(actionId, { targetIds: [], commandId: CAST, areaPlaced: true });
  drawArea(caster.state, CAST, center, radius);
}

/** The goblin flying `feet` up walks west along row 10 into the area. */
function flyIn(caster: ReturnType<typeof fight>, feet: number, from = 16) {
  setAltitude(caster.state, FOE, feet, feet > 0 ? "fly" : undefined);
  return walk(caster.state, FOE, [
    [from, 10],
    [from - 1, 10],
    [from - 2, 10],
    [from - 3, 10],
    [from - 4, 10]
  ]);
}

describe("a Sphere's height", () => {
  it("catches a flier inside its radius and leaves one above it", () => {
    const low = fight(wizardAt(9, ["cloudkill"]));
    place(low.state, { [HERO]: cell(0, 0), [FOE]: cell(16, 10) });
    castArea(low, "spell-cloudkill", [10, 10], 4);
    flyIn(low, 10);
    expect(savesOf(low.state, FOE)).toHaveLength(1);
    const high = fight(wizardAt(9, ["cloudkill"]));
    place(high.state, { [HERO]: cell(0, 0), [FOE]: cell(16, 10) });
    castArea(high, "spell-cloudkill", [10, 10], 4);
    flyIn(high, 25);
    expect(savesOf(high.state, FOE)).toHaveLength(0);
  });
});

describe("Moonbeam's 40-foot-high Cylinder", () => {
  it("reaches a flier 30 feet up, and not one 45 feet up", () => {
    const run = (feet: number) => {
      const druid = fight(build(druidInput(["moonbeam"])));
      place(druid.state, { [HERO]: cell(0, 0), [FOE]: cell(16, 10) });
      castArea(druid, "spell-moonbeam", [12, 10], 1);
      flyIn(druid, feet);
      return savesOf(druid.state, FOE).length;
    };
    expect(run(30)).toBe(1);
    expect(run(45)).toBe(0);
  });
});

describe("an Emanation's reach in every direction", () => {
  it("leaves Spirit Guardians' foe flying 25 feet above the caster's 15 feet", () => {
    const run = (feet: number) => {
      const cleric = fight(build(clericInput(["spirit-guardians"])));
      place(cleric.state, { [HERO]: cell(10, 10), [FOE]: cell(16, 10) });
      cleric.resolve("spell-spirit-guardians", { targetIds: [], commandId: CAST });
      flyIn(cleric, feet);
      return savesOf(cleric.state, FOE).length;
    };
    expect(run(0)).toBe(1);
    expect(run(25)).toBe(0);
  });
});

describe("Earthquake's ground", () => {
  it("shakes the creatures on the ground in the area as its caster's turn ends, and spares a flier", () => {
    const druid = fight(druidAt(15, ["earthquake"]));
    place(druid.state, { [HERO]: cell(0, 0), [FOE]: cell(10, 10) });
    castArea(druid, "spell-earthquake", [10, 10], 4);
    setAltitude(druid.state, FOE, 20, "fly");
    zonesAtTurnEnd(druid.state, HERO, zoneDeps());
    expect(savesOf(druid.state, FOE)).toHaveLength(0);
    setAltitude(druid.state, FOE, 0, undefined);
    zonesAtTurnEnd(druid.state, HERO, zoneDeps());
    expect(savesOf(druid.state, FOE)).toHaveLength(1);
  });
});
