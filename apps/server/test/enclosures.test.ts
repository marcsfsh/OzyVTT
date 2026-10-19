import { describe, expect, it } from "vitest";
import type { Actor, GameState } from "@vtt/domain";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { effectiveActions } from "../src/effective-actions.js";
import { addEffect, CONCENTRATING_TAG, makeEffect } from "../src/effects.js";
import { ENCLOSED_TAG, enclosedFrom, enclosureOf } from "../src/enclosures.js";
import { RulesBlockedError } from "../src/game-store.js";
import { build, catalog, fight, fighterInput, FOE, FOE2, HERO } from "./spell-casters.js";
import { answer, cell, place, wizardAt } from "./zone-fixtures.js";

// SRD 5.2.1 Resilient Sphere: "Nothing ... can pass through the barrier, in or out ... a creature or object inside
// can't be damaged by attacks or effects originating from outside, nor can a creature inside the sphere damage
// anything outside it", and "A Disintegrate spell targeting the globe destroys it without harming anything inside".
// Bead of Force: "No attack or other effect can pass through."

const concentrating = (state: GameState) =>
  state.actors.find((actor) => actor.id === HERO)!.effects.find((effect) => effect.tags.includes(CONCENTRATING_TAG));

/** Shuts the creature in a sphere of force, as a failed save against Resilient Sphere leaves it. */
function enclose(state: GameState, actorId: string): void {
  addEffect(
    state,
    actorId,
    makeEffect({
      id: `sphere-${actorId}`,
      name: "Resilient Sphere",
      tags: [ENCLOSED_TAG],
      sourceActorId: HERO,
      duration: { type: "manual" }
    })
  );
}

const fighter = build(fighterInput());

function javelinAt(state: GameState, hero: Actor, targetId: string, attackerId = HERO) {
  const javelin = effectiveActions(fighter, hero, catalog).find(
    (entry) => /javelin/i.test(entry.name) && entry.attack?.rangeFeet !== undefined
  )!;
  let rolls = 0;
  return resolveDefinitionAction(
    state,
    javelin,
    { actorId: attackerId, targetIds: [targetId], commandId: `cmd-sphere-${targetId}` },
    {
      random: (sides) => Math.min(15, sides),
      newRollId: () => `40000000-0000-4000-8000-${String((rolls += 1)).padStart(12, "0")}`,
      gmSessionId: "30000000-0000-4000-8000-00000000000a",
      now: () => "2026-10-19T00:00:00.000Z",
      definition: fighter,
      catalog,
      resolveDefinition: () => undefined
    }
  );
}

describe("Resilient Sphere", () => {
  it("shuts a creature that fails its Dexterity save in a sphere while the caster concentrates", () => {
    const caster = fight(wizardAt(7, ["resilient-sphere"]));
    place(caster.state, { [HERO]: cell(2, 2), [FOE]: cell(5, 2) });
    caster.resolve("spell-resilient-sphere", { targetIds: [FOE] });
    answer(caster.state, FOE, 1);
    const goblin = caster.state.actors.find((actor) => actor.id === FOE)!;
    expect(enclosureOf(goblin)?.name).toBe("Resilient Sphere");
    expect(concentrating(caster.state)).toBeDefined();
  });

  it("refuses an attack on a creature inside it", () => {
    const { state, hero } = fight(fighter);
    place(state, { [HERO]: cell(2, 2), [FOE]: cell(5, 2) });
    enclose(state, FOE);
    expect(() => javelinAt(state, hero, FOE)).toThrowError(RulesBlockedError);
    expect(() => javelinAt(state, hero, FOE)).toThrowError(
      "Nothing passes the wall of Resilient Sphere around Goblin."
    );
  });

  it("refuses an attack from inside it on anything outside", () => {
    const { state, hero } = fight(fighter);
    place(state, { [HERO]: cell(2, 2), [FOE]: cell(5, 2) });
    enclose(state, HERO);
    expect(() => javelinAt(state, hero, FOE)).toThrowError("Nothing passes the wall of Resilient Sphere around Borin.");
  });

  it("keeps an area from the creature inside it, and the creature inside from everyone else", () => {
    const { state } = fight(fighter);
    enclose(state, FOE);
    expect(enclosedFrom(state, HERO, [FOE, FOE2])).toEqual([{ actorId: FOE, sphere: "Resilient Sphere" }]);
    expect(enclosedFrom(state, FOE, [FOE, FOE2, HERO])).toEqual([
      { actorId: FOE2, sphere: "Resilient Sphere" },
      { actorId: HERO, sphere: "Resilient Sphere" }
    ]);
  });

  it("is destroyed by Disintegrate, which harms nothing inside and ends the spell", () => {
    const caster = fight(wizardAt(11, ["resilient-sphere", "disintegrate"]));
    place(caster.state, { [HERO]: cell(2, 2), [FOE]: cell(5, 2) });
    caster.resolve("spell-resilient-sphere", { targetIds: [FOE] });
    answer(caster.state, FOE, 1);
    caster.state.combat.turn = { ...caster.state.combat.turn, actionUsed: false, spellSlotCasters: [] };
    const resolution = caster.resolve("spell-disintegrate", { targetIds: [FOE] }, [6, 6, 6, 6, 6, 6, 6, 6, 6, 6]);
    const goblin = caster.state.actors.find((actor) => actor.id === FOE)!;
    expect(enclosureOf(goblin)).toBeUndefined();
    expect(goblin.hp.current).toBe(200);
    expect(caster.state.combat.pendingSaves).toEqual([]);
    expect(concentrating(caster.state)).toBeUndefined();
    expect(resolution.tableNarration?.map((line) => line.text)).toContain(
      "Disintegrate destroys the Resilient Sphere around Goblin."
    );
  });
});

describe("Bead of Force", () => {
  it("is a thrown bead whose failed save shuts the creature in a sphere for a minute", () => {
    const bead = catalog.equipmentRecord("bead-of-force");
    const throwIt = bead?.actions?.find((action) => action.id === "throw");
    expect(throwIt?.save?.failureEffect?.tags).toContain(ENCLOSED_TAG);
    expect(throwIt?.area).toEqual({ shape: "sphere", sizeFeet: 10, widthFeet: null });
  });
});
