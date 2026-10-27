import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import { altitudeOf } from "../src/altitude.js";
import { endConcentrationSustainedBy } from "../src/effects.js";
import { settleFalls, type FallDeps } from "../src/falling.js";
import { catalog, fight, FOE, FOE2, HERO } from "./spell-casters.js";
import { answer, cell, drawArea, hpOf, nextId, place, savesOf, walk, wizardAt } from "./zone-fixtures.js";

// SRD 5.2.1 Reverse Gravity: "All creatures and objects in that area that aren't anchored to the ground fall upward and
// reach the top of the area", a creature that succeeds on the Dexterity save having grabbed hold of something fixed,
// "it remains there, oscillating slightly, for the duration", and "When the spell ends, affected objects and creatures
// fall downward".

const CAST = "64000000-0000-4000-8000-0000000000a1";

const fallDeps = (faces: number[] = [3]): FallDeps => ({
  resolveDefinition: () => undefined,
  catalog,
  random: () => faces.shift() ?? 3,
  newId: nextId,
  now: () => "2026-10-19T00:00:00.000Z"
});
const heightOf = (state: GameState, actorId: string) =>
  altitudeOf(state.combat.tokens.find((token) => token.actorId === actorId));

/** The wizard's Reverse Gravity over the goblin and the orc, its Cylinder drawn round (10, 10). */
function reversed() {
  const caster = fight(wizardAt(13, ["reverse-gravity"]));
  place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(10, 10), [FOE2]: cell(12, 10) });
  caster.resolve("spell-reverse-gravity", { targetIds: [FOE, FOE2], commandId: CAST, areaPlaced: true });
  drawArea(caster.state, CAST, [10, 10], 10);
  return caster;
}

describe("Reverse Gravity", () => {
  it("lifts a creature that fails to the top of the Cylinder and drops it when the spell ends", () => {
    const { state } = reversed();
    answer(state, FOE, 1);
    answer(state, FOE2, 30);
    settleFalls(state, fallDeps());
    expect(heightOf(state, FOE)).toBe(100);
    expect(heightOf(state, FOE2)).toBe(0);
    // It stays up while the spell lasts.
    settleFalls(state, fallDeps());
    expect(heightOf(state, FOE)).toBe(100);

    const before = hpOf(state, FOE);
    endConcentrationSustainedBy(state, HERO);
    settleFalls(state, fallDeps());
    expect(heightOf(state, FOE)).toBe(0);
    // 100 feet: 10d6, every die a 3.
    expect(before - hpOf(state, FOE)).toBe(Math.min(before, 30));
    expect(state.actors.find((actor) => actor.id === FOE)!.conditions.map((condition) => condition.id)).toContain(
      "prone"
    );
  });

  it("asks a creature that comes into the Cylinder later for the save", () => {
    const { state } = reversed();
    answer(state, FOE, 30);
    answer(state, FOE2, 30);
    place(state, { [FOE2]: cell(25, 10) });
    walk(state, FOE2, [
      [25, 10],
      [24, 10],
      [23, 10],
      [22, 10],
      [21, 10],
      [20, 10],
      [19, 10]
    ]);
    expect(savesOf(state, FOE2)).toEqual([expect.objectContaining({ ability: "dex", actionName: "Reverse Gravity" })]);
    answer(state, FOE2, 1);
    settleFalls(state, fallDeps());
    expect(heightOf(state, FOE2)).toBe(100);
  });
});
