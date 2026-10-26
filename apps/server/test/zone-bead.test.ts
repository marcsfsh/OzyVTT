import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { builtinActionFor } from "../src/builtin-actions.js";
import { nextInitiativeTurn } from "../src/encounter.js";
import { burstEndedZones } from "../src/spell-zones.js";
import { zonePointFeet } from "../src/zone-touch.js";
import { ALLY, catalog, fight, FOE, FOE2, HERO } from "./spell-casters.js";
import { answer, cell, drawArea, GRID, nextId, place, savesOf, wizardAt, zoneDeps } from "./zone-fixtures.js";

// SRD 5.2.1 Delayed Blast Fireball: "If a creature touches the bead before the interval has expired, that creature makes
// a Dexterity saving throw. On a failed save, the spell ends, causing the bead to explode. On a successful save, the
// creature can throw the bead up to 40 feet. When the thrown bead enters a creature's space or collides with a solid
// object, the spell ends, and the bead explodes."

const BEAD = "6f000000-0000-4000-8000-000000000001";
const touch = builtinActionFor(undefined, "touch-bead")!;
const at = (state: GameState, id: string) => state.combat.tokens.find((token) => token.actorId === id)!.position!;
/** Feet between two creatures on the 5-foot grid. */
const apart = (state: GameState) => (a: string, b: string) =>
  (Math.max(Math.abs(at(state, a).x - at(state, b).x), Math.abs(at(state, a).y - at(state, b).y)) / 50) * 5;

/** The wizard's bead at (11,10), with the goblin beside it, the orc 30 feet off and the wizard's ally 30 feet the
 *  other way. */
function bead() {
  const caster = fight(wizardAt(13, ["delayed-blast-fireball"]), { ally: true });
  place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(10, 10), [FOE2]: cell(12, 20), [ALLY]: cell(16, 10) });
  caster.resolve("spell-delayed-blast-fireball", { targetIds: [], commandId: BEAD, areaPlaced: true });
  drawArea(caster.state, BEAD, [11, 10], 4);
  // The goblin's turn.
  nextInitiativeTurn(caster.state);
  return caster.state;
}

/** The goblin touches the bead, naming whom it throws at. */
function goblinTouches(state: GameState, throwAt: string) {
  return resolveDefinitionAction(
    state,
    touch,
    { actorId: FOE, targetIds: [throwAt], commandId: nextId(), builtin: true },
    {
      random: () => 10,
      newRollId: nextId,
      gmSessionId: "30000000-0000-4000-8000-00000000000a",
      now: () => "2026-10-19T00:00:00.000Z",
      catalog,
      resolveDefinition: () => undefined,
      distanceFeet: apart(state),
      zoneFeet: (actorId, zoneId) => zonePointFeet(state, actorId, zoneId, GRID)
    }
  );
}

describe("touching Delayed Blast Fireball's bead", () => {
  it("puts the Dexterity save to the creature that touches it", () => {
    const state = bead();
    goblinTouches(state, ALLY);
    expect(savesOf(state, FOE)).toEqual([expect.objectContaining({ ability: "dex", actionName: expect.any(String) })]);
  });

  it("explodes where it is on a failure", () => {
    const state = bead();
    goblinTouches(state, ALLY);
    answer(state, FOE, 1);
    burstEndedZones(state, zoneDeps(Array(20).fill(3)));
    // The goblin beside the bead is caught; the ally 25 feet off is not.
    expect(savesOf(state, FOE)).toEqual([expect.objectContaining({ ability: "dex", proposedDamage: 36 })]);
    expect(savesOf(state, ALLY)).toEqual([]);
    expect(state.combat.spellZones).toEqual([]);
  });

  it("is thrown on a success at the creature named, and explodes there", () => {
    const state = bead();
    goblinTouches(state, ALLY);
    answer(state, FOE, 30);
    burstEndedZones(state, zoneDeps(Array(20).fill(3)));
    expect(savesOf(state, ALLY)).toEqual([expect.objectContaining({ ability: "dex", proposedDamage: 36 })]);
    expect(savesOf(state, FOE)).toEqual([]);
  });

  it("can't be touched from more than 5 feet away, or thrown farther than 40 feet", () => {
    const state = bead();
    place(state, { [FOE]: cell(5, 10) });
    expect(() => goblinTouches(state, ALLY)).toThrow(/no bead within 5 feet/);
    place(state, { [FOE]: cell(10, 10), [ALLY]: cell(30, 10) });
    expect(() => goblinTouches(state, ALLY)).toThrow(/more than 40 feet/);
  });
});
