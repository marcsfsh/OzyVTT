import { describe, expect, it } from "vitest";
import type { GameState, SpellZone } from "@vtt/domain";
import { zonesAtTurnEnd, zonesAtTurnStart } from "../src/spell-zones.js";
import { build, fight, FOE, FOE2, HERO, wizardInput } from "./spell-casters.js";
import { cell, drawArea, place, savesOf, turnDeps, zoneDeps } from "./zone-fixtures.js";

// SRD 5.2.1 Control Water, Whirlpool: "A creature or object in the water and within 25 feet of the vortex is pulled 10
// feet toward it ... When a creature enters the vortex for the first time on a turn or starts its turn there, it makes
// a Strength saving throw. On a failed save, the creature takes 2d8 Bludgeoning damage." The pull and the save are the
// zone's (`spell-zones.ts`); the spell's own row authors the whirlpool on them.

const VORTEX = "6f200000-0000-4000-8000-000000000001";
const at = (state: GameState, id: string) => state.combat.tokens.find((token) => token.actorId === id)!.position;

/** A vortex at (10,10), 5 feet across, whose pull reaches 25 feet; the goblin 20 feet off, the orc 30. */
function vortex() {
  const { state } = fight(build(wizardInput(["magic-missile"])));
  place(state, { [HERO]: cell(0, 0), [FOE]: cell(14, 10), [FOE2]: cell(16, 10) });
  const zone: SpellZone = {
    id: VORTEX,
    spellId: "area",
    name: "Whirlpool",
    laterActionId: "whirlpool",
    casterId: HERO,
    castId: null,
    rounds: null,
    startedRound: 1,
    level: 0,
    dc: 15,
    annotationId: VORTEX,
    area: { shape: "sphere", sizeFeet: 5, widthFeet: null },
    rule: {
      trigger: { on: ["enter", "start-turn"], oncePerTurn: true, pulls: { withinFeet: 25, feet: 10 } },
      save: { ability: "str", dc: 15, successDamage: "half", failureConditions: [] },
      damage: [{ formula: "2d8", type: "bludgeoning" }]
    },
    damageDealt: 0,
    entered: [],
    affected: []
  };
  state.combat.spellZones = [zone];
  drawArea(state, VORTEX, [10, 10], 1);
  return state;
}

describe("a vortex that pulls", () => {
  it("pulls a creature starting its turn 20 feet off 10 feet toward its middle", () => {
    const state = vortex();
    const events = zonesAtTurnStart(state, FOE, turnDeps());
    expect(at(state, FOE)).toEqual(cell(12, 10));
    expect(events.map((event) => event.text)).toContain("Whirlpool pulls Goblin 10 feet toward it.");
    expect(savesOf(state, FOE)).toEqual([]);
  });

  it("leaves a creature beyond its 25 feet where it is", () => {
    const state = vortex();
    place(state, { [FOE2]: cell(16, 10) });
    zonesAtTurnStart(state, FOE2, turnDeps());
    expect(at(state, FOE2)).toEqual(cell(16, 10));
  });

  it("pulls a creature 5 feet off into the vortex, where it makes the Strength save", () => {
    const state = vortex();
    place(state, { [FOE]: cell(11, 10) });
    zonesAtTurnStart(state, FOE, turnDeps([4, 4]));
    expect(at(state, FOE)).toEqual(cell(10, 10));
    expect(savesOf(state, FOE)).toEqual([expect.objectContaining({ ability: "str", dc: 15 })]);
    // It makes the save once that turn.
    zonesAtTurnEnd(state, FOE, zoneDeps());
    expect(savesOf(state, FOE)).toHaveLength(1);
  });
});
