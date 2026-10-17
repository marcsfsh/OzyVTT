import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import { setCondition } from "../src/actor-conditions.js";
import { endEffect } from "../src/effects.js";
import { nextInitiativeTurn } from "../src/encounter.js";
import { projectPlayerView } from "../src/projections.js";
import { applyRest } from "../src/rests.js";
import { ALLY, bardInput, build, catalog, fight, HERO, heroTurnAgain, wizardInput } from "./spell-casters.js";

// SRD 5.2.1 spells that raise hit points without healing: False Life's Temporary Hit Points, Heroism's each turn with
// its immunity to Frightened, and Aid's higher Hit Point maximum.

const wizard = build(wizardInput(["false-life"]));
const bard = build(bardInput(["heroism", "aid"]));

const actor = (state: GameState, id: string) => state.actors.find((candidate) => candidate.id === id)!;
let ids = 0;
const turnDeps = {
  resolveDefinition: () => undefined,
  rollDie: () => 3,
  newId: () => `50000000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`,
  now: () => "2026-10-17T00:00:00.000Z",
  catalog
};
/** Advances the initiative until `actorId`'s turn has started. */
function untilTurnOf(state: GameState, actorId: string): void {
  for (let step = 0; step < 10 && state.combat.turnActorId !== actorId; step += 1)
    nextInitiativeTurn(state, [], turnDeps);
}

describe("False Life", () => {
  it("gives the caster 2d4 + 4 Temporary Hit Points, 5 more a slot level up, keeping the higher", () => {
    const { state, resolve } = fight(wizard);
    const result = resolve("spell-false-life", { targetIds: [] }, [2, 3]);
    expect(actor(state, HERO).hp.temporary).toBe(9);
    expect(result.healing?.targets).toEqual([{ targetId: HERO, targetName: "Ansel", regained: 9 }]);
    const upcast = fight(wizard);
    upcast.resolve("spell-false-life", { targetIds: [], slotLevel: 2 }, [2, 3]);
    expect(actor(upcast.state, HERO).hp.temporary).toBe(14);
    // A lower roll on the caster's next turn leaves the 14.
    heroTurnAgain(upcast.state);
    upcast.resolve("spell-false-life", { targetIds: [] }, [1, 1]);
    expect(actor(upcast.state, HERO).hp.temporary).toBe(14);
  });
});

describe("Heroism", () => {
  it("makes its target immune to Frightened and gives the caster's modifier as Temporary Hit Points each turn", () => {
    const { state, resolve } = fight(bard, { ally: true });
    resolve("spell-heroism", { targetIds: [ALLY] });
    const bran = actor(state, ALLY);
    // Charisma 19 at Bard 5: +4.
    expect(bran.effects[0]).toMatchObject({
      name: "Heroism",
      conditionImmunities: ["frightened"],
      temporaryHitPointsEachTurn: 4
    });
    setCondition(state, ALLY, "frightened", true, undefined, { role: "gm" });
    expect(bran.conditions).toEqual([]);
    expect(bran.hp.temporary).toBe(0);
    untilTurnOf(state, ALLY);
    expect(actor(state, ALLY).hp.temporary).toBe(4);
  });

  it("keeps the amounts and the immunity off players' view of the effect", () => {
    const { state, resolve } = fight(bard, { ally: true });
    resolve("spell-heroism", { targetIds: [ALLY] });
    const view = projectPlayerView(state, undefined, () => null);
    const effect = view.actors.find((entry) => entry.id === ALLY)!.effects[0]!;
    expect(effect.name).toBe("Heroism");
    expect(effect).not.toHaveProperty("temporaryHitPointsEachTurn");
    expect(effect).not.toHaveProperty("conditionImmunities");
  });
});

describe("Aid", () => {
  it("raises its targets' Hit Point maximum and current hit points by 5, 5 more a slot level up, until it ends", () => {
    const { state, resolve } = fight(bard, { ally: true });
    actor(state, ALLY).hp.current = 150;
    resolve("spell-aid", { targetIds: [ALLY, HERO], slotLevel: 3 });
    expect(actor(state, ALLY).hp).toMatchObject({ current: 160, maximum: 210 });
    const aid = actor(state, ALLY).effects.find((effect) => effect.name === "Aid")!;
    endEffect(state, ALLY, aid.id);
    expect(actor(state, ALLY).hp).toMatchObject({ current: 160, maximum: 200 });
  });

  it("is spent by a Long Rest", () => {
    const { state, resolve, hero } = fight(bard);
    const before = { ...hero.hp };
    resolve("spell-aid", { targetIds: [HERO] });
    expect(actor(state, HERO).hp.maximum).toBe(before.maximum + 5);
    state.combat = { ...state.combat, active: false };
    applyRest(state, HERO, "long", () => bard, catalog);
    expect(actor(state, HERO).hp).toMatchObject({ current: before.maximum, maximum: before.maximum });
  });
});
