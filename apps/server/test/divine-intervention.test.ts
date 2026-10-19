import { describe, expect, it } from "vitest";
import type { ActorDefinition } from "@vtt/schemas";
import { DIVINE_RESTS_KEY } from "../src/divine-intervention.js";
import { effectiveActions } from "../src/effective-actions.js";
import { RulesBlockedError } from "../src/game-store.js";
import { applyRest } from "../src/rests.js";
import { catalog, fight, FOE, HERO } from "./spell-casters.js";
import { clericAt } from "./zone-fixtures.js";

// SRD 5.2.1 Cleric, Divine Intervention: "choose any Cleric spell of level 5 or lower that doesn't require a Reaction
// to cast. As part of the same action, you cast that spell without expending a spell slot or needing Material
// components." Greater Divine Intervention: "you can choose Wish ... If you do so, you can't use Divine Intervention
// again until you finish 2d4 long rests."

const cleric = clericAt(10, ["cure-wounds"]);
const castIds = (definition: ActorDefinition) =>
  effectiveActions(definition, undefined, catalog)
    .map((action) => action.id)
    .filter((id) => id.startsWith("divine-intervention-"));
const slotsOf = (state: ReturnType<typeof fight>["state"]) =>
  state.actors.find((actor) => actor.id === HERO)!.spellSlots?.map((slot) => slot.remaining);

describe("Divine Intervention's spells", () => {
  it("are the Cleric spells of level 5 or lower, prepared or not, and not Wish", () => {
    const ids = castIds(cleric);
    expect(ids).toEqual(
      expect.arrayContaining([
        "divine-intervention-hold-person",
        "divine-intervention-flame-strike",
        "divine-intervention-commune"
      ])
    );
    expect(ids).not.toContain("divine-intervention-heal");
    expect(ids).not.toContain("divine-intervention-wish");
  });

  it("aren't a lower-level Cleric's", () => {
    expect(castIds(clericAt(9, ["cure-wounds"]))).toEqual([]);
  });
});

describe("casting through Divine Intervention", () => {
  it("casts the spell with no slot and no Material component, spending the feature's one use", () => {
    const { state, resolve, hero } = fight(cleric);
    // No pouch, no Holy Symbol: Hold Person's piece of iron would be wanting.
    hero.inventory = [];
    const slots = slotsOf(state);
    const result = resolve("divine-intervention-hold-person", { targetIds: [FOE] });
    expect(result.save).toMatchObject({ ability: "wis" });
    expect(state.combat.pendingSaves.map((save) => save.targetActorId)).toEqual([FOE]);
    expect(slotsOf(state)).toEqual(slots);
    expect(hero.actionUses["divine-intervention"]).toBe(1);
  });

  it("can't be used again before a Long Rest", () => {
    const { state, resolve } = fight(cleric);
    resolve("divine-intervention-hold-person", { targetIds: [FOE] });
    state.combat = { ...state.combat, turn: { ...state.combat.turn, actionUsed: false, actionInstance: null } };
    expect(() => resolve("divine-intervention-cure-wounds", { targetIds: [HERO] })).toThrow(RulesBlockedError);
  });

  it("casts a spell of a minute or more at once, as part of the action", () => {
    const { resolve, hero } = fight(cleric);
    resolve("divine-intervention-commune", { targetIds: [] });
    expect(hero.effects.some((effect) => effect.longCast)).toBe(false);
    expect(hero.actionUses["divine-intervention"]).toBe(1);
  });
});

describe("Greater Divine Intervention's Wish", () => {
  const greater: ActorDefinition = {
    ...cleric,
    character: {
      ...cleric.character!,
      features: [
        ...(cleric.character?.features ?? []),
        { id: "greater-divine-intervention", kind: "class", sourceId: "cleric" }
      ]
    }
  };

  it("is offered, and keeps Divine Intervention away for 2d4 Long Rests", () => {
    expect(castIds(greater)).toContain("divine-intervention-wish");
    const { state, resolve, hero } = fight(greater);
    // 2d4: 1 + 2.
    resolve("divine-intervention-wish", { targetIds: [] }, [1, 2]);
    expect(hero.actionUses[DIVINE_RESTS_KEY]).toBe(3);
    state.combat = { ...state.combat, active: false };
    // A day apart: one Long Rest in 24 hours.
    const rest = () => {
      state.rest = { ...state.rest, clockHours: state.rest.clockHours + 24 };
      applyRest(state, HERO, "long", () => greater, catalog);
    };
    rest();
    rest();
    expect(hero.actionUses).toMatchObject({ "divine-intervention": 1, [DIVINE_RESTS_KEY]: 1 });
    rest();
    expect(hero.actionUses["divine-intervention"]).toBeUndefined();
    expect(hero.actionUses[DIVINE_RESTS_KEY]).toBeUndefined();
  });
});
