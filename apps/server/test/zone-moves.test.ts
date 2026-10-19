import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import type { EffectNarration } from "../src/effects.js";
import { nextInitiativeTurn } from "../src/encounter.js";
import { RulesBlockedError } from "../src/game-store.js";
import { areaMoveOf, moveArea, planAreaMove } from "../src/zone-moves.js";
import { build, catalog, druidInput, fight, FOE, FOE2, HERO, heroTurnAgain, wizardInput } from "./spell-casters.js";
import { cell, drawArea, GRID, place, savesOf, turnDeps, wizardAt, zoneDeps } from "./zone-fixtures.js";

// SRD 5.2.1 areas that move: Moonbeam's Cylinder moved up to 60 feet by a Magic action, Flaming Sphere rammed up to 30
// feet into a creature by a Bonus Action, and Cloudkill's Sphere drifting 10 feet away from its caster at the start of
// each of the caster's turns. The area acts on the creatures it moves onto.

const CAST = "65000000-0000-4000-8000-000000000001";
const TABLE = { sessionId: "30000000-0000-4000-8000-00000000000a", role: "gm" } as const;
const areaOf = (state: GameState) => state.combat.annotations.find((annotation) => annotation.id === CAST)!;
/** A circle template of `radius` cells around a cell, as a drag would place it. */
const circleAt = (center: readonly [number, number], radius: number) => ({
  shape: "circle" as const,
  origin: cell(...center),
  target: cell(center[0] + radius, center[1])
});

describe("Moonbeam: a Magic action on later turns moves the Cylinder up to 60 feet", () => {
  const druid = build(druidInput(["moonbeam"]));

  function beam() {
    const caster = fight(druid);
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(16, 5), [FOE2]: cell(40, 40) });
    caster.resolve("spell-moonbeam", { targetIds: [], commandId: CAST, areaPlaced: true });
    drawArea(caster.state, CAST, [5, 5], 1);
    heroTurnAgain(caster.state);
    return caster;
  }

  it("offers the move as an action that names how far it goes", () => {
    const { action } = beam();
    const move = action("spell-moonbeam-then-move");
    expect(move).toMatchObject({ activation: "action", area: { shape: "cylinder", sizeFeet: 5 } });
    expect(areaMoveOf(move, catalog)?.feet).toBe(60);
  });

  it("moves the Cylinder onto a creature, which makes the save", () => {
    const { state, action } = beam();
    const placed = circleAt([16, 5], 1);
    const move = planAreaMove(
      state,
      {
        casterId: HERO,
        spell: areaMoveOf(action("spell-moonbeam-then-move"), catalog)!.spell,
        feet: 60,
        placed,
        override: null,
        widthFeet: null
      },
      GRID
    );
    expect(move.movedOnto).toEqual([FOE]);
    const events = moveArea(state, move, placed, TABLE, { ...zoneDeps([5, 5]), geometry: GRID });
    expect(events.map((event) => event.text)).toEqual(["Goblin is caught by Moonbeam and makes a CON save (DC 15)."]);
    expect(savesOf(state, FOE)).toHaveLength(1);
    expect(areaOf(state).geometry.origin).toEqual(cell(16, 5));
  });

  it("refuses a move farther than 60 feet", () => {
    const { state, action } = beam();
    expect(() =>
      planAreaMove(
        state,
        {
          casterId: HERO,
          spell: areaMoveOf(action("spell-moonbeam-then-move"), catalog)!.spell,
          feet: 60,
          placed: circleAt([30, 5], 1),
          override: null,
          widthFeet: null
        },
        GRID
      )
    ).toThrow(RulesBlockedError);
  });
});

describe("Flaming Sphere: the ram moves the sphere up to 30 feet onto a creature", () => {
  const wizard = build(wizardInput(["flaming-sphere", "magic-missile"]));

  it("puts the ram's save on the creature the sphere rolls onto", () => {
    const caster = fight(wizard);
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(8, 5), [FOE2]: cell(40, 40) });
    caster.resolve("spell-flaming-sphere", { targetIds: [], commandId: CAST, areaPlaced: true });
    drawArea(caster.state, CAST, [3, 5], 1);
    const ram = caster.action("spell-flaming-sphere-then-ram");
    const move = planAreaMove(
      caster.state,
      {
        casterId: HERO,
        spell: areaMoveOf(ram, catalog)!.spell,
        feet: 30,
        placed: circleAt([8, 5], 1),
        override: null,
        widthFeet: null
      },
      GRID
    );
    expect(move.movedOnto).toEqual([FOE]);
    expect(ram.save).toMatchObject({ ability: "dex" });
  });
});

describe("Cloudkill: the Sphere drifts 10 feet away from its caster at the start of each of its caster's turns", () => {
  it("moves straight away from the caster and catches the creature it drifts onto", () => {
    const caster = fight(wizardAt(9, ["cloudkill"]));
    place(caster.state, { [HERO]: cell(0, 10), [FOE]: cell(15, 10), [FOE2]: cell(40, 40) });
    caster.resolve("spell-cloudkill", { targetIds: [], commandId: CAST, areaPlaced: true });
    // A 20-foot-radius Sphere centred 50 feet east of the caster, its edge 5 feet short of the goblin.
    drawArea(caster.state, CAST, [10, 10], 4);
    const events: EffectNarration[] = [];
    for (let step = 0; step < 4 && !(caster.state.combat.turnActorId === HERO && caster.state.combat.round > 1); step++)
      nextInitiativeTurn(caster.state, events, turnDeps([3, 3, 3, 3, 3]));
    expect(events.map((event) => event.text)).toEqual(
      expect.arrayContaining([
        "Cloudkill drifts 10 feet away from Ansel.",
        expect.stringMatching(/^Goblin is caught by Cloudkill and makes a CON save/)
      ])
    );
    expect(areaOf(caster.state).geometry.origin).toEqual(cell(12, 10));
  });
});
