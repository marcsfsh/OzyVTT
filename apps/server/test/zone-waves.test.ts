import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import type { EffectNarration } from "../src/effects.js";
import { nextInitiativeTurn, startEncounter } from "../src/encounter.js";
import { speedZeroed } from "../src/speed.js";
import { zoneContentOf } from "../src/spell-zone-state.js";
import { zoneAction } from "../src/spell-zones.js";
import { wavesAtTurnEnd } from "../src/zone-waves.js";
import { catalog, fight, FOE, FOE2, HERO } from "./spell-casters.js";
import { cell, drawArea, druidAt, GRID, MAP, place, savesOf, turnDeps, zoneDeps } from "./zone-fixtures.js";

// SRD 5.2.1 Tsunami: "At the start of each of your turns after the wall appears, the wall, along with any creatures in
// it, moves 50 feet away from you. Any Huge or smaller creature inside the wall or whose space the wall enters when it
// moves must succeed on a Strength saving throw or take 5d10 Bludgeoning damage", "At the end of the turn, the wall's
// height is reduced by 50 feet, and the damage the wall deals on later rounds is reduced by 1d10. When the wall reaches
// 0 feet in height, the spell ends", and a creature in it "must succeed on a Strength (Athletics) check against your
// spell save DC to move at all".

const CAST = "6a000000-0000-4000-8000-000000000001";
const druid = druidAt(15, ["tsunami"]);
const at = (state: GameState, actorId: string) =>
  state.combat.tokens.find((token) => token.actorId === actorId)!.position;
const zoneOf = (state: GameState) => state.combat.spellZones.find((zone) => zone.spellId === "tsunami");

/** The druid raises the wall 40 feet east of it, square to it; the goblin stands in the wall and the orc beyond. */
function wave() {
  // A minute's casting, finished before the fight begins.
  const caster = fight(druid, { combat: false });
  place(caster.state, { [HERO]: cell(0, 25), [FOE]: cell(8, 25), [FOE2]: cell(20, 25) });
  caster.resolve("spell-tsunami", { targetIds: [], commandId: CAST, areaPlaced: true });
  drawArea(caster.state, CAST, [10, 5], 40, "line");
  startEncounter(
    caster.state,
    {
      mapAssetId: MAP,
      entries: [
        { actorId: HERO, score: 20 },
        { actorId: FOE, score: 10 },
        { actorId: FOE2, score: 9 }
      ]
    },
    () => 10,
    GRID
  );
  return caster;
}

/** Turns pass until the wizard's next turn has begun. */
function toCastersNextTurn(state: GameState, faces: number[] = []) {
  const events: EffectNarration[] = [];
  for (let step = 0; step < 4 && !(state.combat.turnActorId === HERO && state.combat.round > 1); step++)
    nextInitiativeTurn(state, events, turnDeps(faces));
  return events;
}

describe("Tsunami's wave", () => {
  it("moves 50 feet away from its caster with the creatures in it, and each one it holds makes the save", () => {
    const { state } = wave();
    const events = toCastersNextTurn(state, Array(40).fill(10));
    expect(events.map((event) => event.text)).toContain("Tsunami drifts 50 feet away from Maelin, carrying Goblin.");
    expect(at(state, FOE)).toEqual(cell(18, 25));
    expect(savesOf(state, FOE)).toEqual([expect.objectContaining({ ability: "str" })]);
    expect(savesOf(state, FOE2)).toEqual([expect.objectContaining({ ability: "str" })]);
  });

  it("spares a Gargantuan creature", () => {
    const { state } = wave();
    state.actors.find((actor) => actor.id === FOE2)!.size = "gargantuan";
    toCastersNextTurn(state, Array(40).fill(10));
    expect(savesOf(state, FOE2)).toEqual([]);
  });

  it("sinks 50 feet and loses a die of damage at the end of the turn it moved", () => {
    const { state } = wave();
    toCastersNextTurn(state, Array(40).fill(10));
    const ending: EffectNarration[] = [];
    nextInitiativeTurn(state, ending, turnDeps(Array(40).fill(10)));
    expect(ending.map((event) => event.text)).toContain(
      "Tsunami sinks to 250 feet high, and its damage drops by a die."
    );
    const zone = zoneOf(state)!;
    expect(zoneAction(zone, zoneContentOf(zone, catalog)!)!.damage[0]!.formula).toBe("4d10");
  });

  it("ends, with its spell, when it has no height left", () => {
    const { state } = wave();
    const zone = zoneOf(state)!;
    zone.faded = 5;
    zone.driftedThisTurn = true;
    wavesAtTurnEnd(state, HERO, zoneDeps());
    expect(zoneOf(state)).toBeUndefined();
    expect(
      state.actors.find((actor) => actor.id === HERO)!.effects.some((effect) => effect.spell?.id === "tsunami")
    ).toBe(false);
  });

  it("holds a creature in it that fails the Strength (Athletics) check as its turn starts", () => {
    const { state } = wave();
    // The goblin's turn: a 1 on the d20 fails against the wizard's DC.
    nextInitiativeTurn(state, [], turnDeps([1, 1]));
    expect(state.combat.turnActorId).toBe(FOE);
    expect(speedZeroed(state.actors.find((actor) => actor.id === FOE)!)).toBe(true);
  });

  it("lets a creature that passes the check swim", () => {
    const { state } = wave();
    nextInitiativeTurn(state, [], turnDeps([20, 20]));
    expect(speedZeroed(state.actors.find((actor) => actor.id === FOE)!)).toBe(false);
  });
});
