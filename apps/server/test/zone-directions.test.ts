import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import { RulesBlockedError } from "../src/game-store.js";
import { zonesAtTurnEnd } from "../src/spell-zones.js";
import { movementCost } from "../src/terrain.js";
import { zoneMovementOptions } from "../src/zone-ground.js";
import { areaMoveOf, planAreaMove } from "../src/zone-moves.js";
import { build, catalog, fight, FOE, FOE2, HERO, heroTurnAgain, wizardInput } from "./spell-casters.js";
import { cell, drawArea, GRID, place, savesOf, zoneDeps } from "./zone-fixtures.js";

// SRD 5.2.1 Gust of Wind: "Any creature in the Line must spend 2 feet of movement for every 1 foot it moves when moving
// closer to you", "A creature that ends its turn in the Line must make the same save", and "As a Bonus Action on your
// later turns, you can change the direction in which the Line blasts from you."

const CAST = "66000000-0000-4000-8000-000000000001";
const wizard = build(wizardInput(["gust-of-wind", "magic-missile"]));

/** The wizard at (5,2) blows the 60-foot Line south down column 5. */
function gust() {
  const caster = fight(wizard);
  place(caster.state, { [HERO]: cell(5, 2), [FOE]: cell(5, 8), [FOE2]: cell(40, 40) });
  caster.resolve("spell-gust-of-wind", { targetIds: [], commandId: CAST, areaPlaced: true });
  drawArea(caster.state, CAST, [5, 2], 12, "line");
  return caster;
}

const costOf = (state: GameState, actorId: string, from: readonly [number, number], to: readonly [number, number]) =>
  movementCost(state, GRID, actorId, cell(...from), cell(...to), zoneMovementOptions(state, actorId, zoneDeps()))!.feet;

describe("Gust of Wind's Line costs double toward its caster", () => {
  it("charges 2 feet for every foot a creature in the Line moves closer to the caster", () => {
    const { state } = gust();
    expect(costOf(state, FOE, [5, 8], [5, 6])).toBe(20);
  });

  it("charges the usual cost moving away from the caster or outside the Line", () => {
    const { state } = gust();
    expect(costOf(state, FOE, [5, 8], [5, 10])).toBe(10);
    expect(costOf(state, FOE, [12, 8], [12, 6])).toBe(10);
  });
});

describe("Gust of Wind's save at the end of a turn", () => {
  it("asks a creature ending its turn in the Line for the save, a failure pushing it 15 feet", () => {
    const { state } = gust();
    zonesAtTurnEnd(state, FOE, zoneDeps());
    expect(savesOf(state, FOE).at(-1)).toMatchObject({ ability: "str", failurePush: { feet: 15 } });
  });

  it("leaves the caster the Line blasts from", () => {
    const { state } = gust();
    zonesAtTurnEnd(state, HERO, zoneDeps());
    expect(savesOf(state, HERO)).toEqual([]);
  });
});

describe("Gust of Wind turned with a Bonus Action", () => {
  const lineFrom = (origin: readonly [number, number], target: readonly [number, number]) => ({
    shape: "line" as const,
    origin: cell(...origin),
    target: cell(...target)
  });

  function turn(placed: ReturnType<typeof lineFrom>) {
    const caster = gust();
    heroTurnAgain(caster.state);
    const action = caster.action("spell-gust-of-wind-then-turn");
    expect(action.activation).toBe("bonus-action");
    const moving = areaMoveOf(action, catalog)!;
    return planAreaMove(
      caster.state,
      {
        casterId: HERO,
        spell: moving.spell,
        feet: moving.feet,
        placed,
        override: null,
        widthFeet: 10,
        fromCaster: moving.fromCaster
      },
      GRID
    );
  }

  it("points the Line another way from the caster", () => {
    expect(turn(lineFrom([5, 2], [17, 2])).movedOnto).toEqual([]);
  });

  it("refuses a Line that starts away from the caster", () => {
    expect(() => turn(lineFrom([15, 2], [27, 2]))).toThrow(RulesBlockedError);
  });
});
