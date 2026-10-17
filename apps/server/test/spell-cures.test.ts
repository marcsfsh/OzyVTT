import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import type { ActorAction } from "@vtt/schemas";
import { loadSpells } from "@vtt/content-srd-5.2.1";
import { actionAvailability, resolveDefinitionAction } from "../src/action-resolution.js";
import { effectiveActions } from "../src/effective-actions.js";
import { spellCastMechanics } from "../src/item-actions.js";
import { saveRollSources } from "../src/saving-throws.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { bardInput, build, catalog, druidInput, fight, FOE, FOE2, HERO, wizardInput } from "./spell-casters.js";

// SRD 5.2.1 spells that end conditions: Heal and Mass Heal end Blinded, Deafened and Poisoned on the creatures they
// heal, Power Word Heal restores every hit point and ends five conditions, Lesser Restoration ends the one condition the
// caster picks, and Protection from Poison ends Poisoned and guards against it.

const bard = build(bardInput(["lesser-restoration"]));
const druid = build(druidInput(["protection-from-poison"]));
const wizard = build(wizardInput([]));

const actor = (state: GameState, id: string) => state.actors.find((candidate) => candidate.id === id)!;
const conditionIds = (state: GameState, id: string) => actor(state, id).conditions.map((condition) => condition.id);
const afflict = (state: GameState, id: string, ...conditions: string[]) => {
  actor(state, id).conditions = conditions.map((condition) => ({ id: condition }));
};

/** A spell's cast as a plain action at fixed numbers, so the test needs no caster of its level. */
function castOf(spellId: string): ActorAction {
  const spell = loadSpells().find((entry) => entry.id === spellId)!;
  return {
    id: `test-${spellId}`,
    name: spell.name,
    activation: "action",
    description: spell.description,
    ...spellCastMechanics(spell, { attackBonus: 7, saveDc: 15, bearersDc: false, modifier: 3 })
  } as ActorAction;
}
/** The wizard uses `action` on `targetIds`. */
function use(state: GameState, action: ActorAction, targetIds: string[]) {
  return resolveDefinitionAction(
    state,
    action,
    { actorId: HERO, targetIds, commandId: `cure-${Math.random()}` },
    {
      random: () => 3,
      newRollId: () => crypto.randomUUID(),
      gmSessionId: "30000000-0000-4000-8000-00000000000a",
      now: () => "2026-10-17T00:00:00.000Z",
      definition: wizard,
      catalog,
      resolveDefinition: () => undefined
    }
  );
}

describe("Heal", () => {
  it("restores 70 hit points and ends Blinded, Deafened and Poisoned", () => {
    const { state } = fight(wizard);
    actor(state, FOE).hp.current = 100;
    afflict(state, FOE, "blinded", "poisoned", "prone");
    use(state, castOf("heal"), [FOE]);
    expect(actor(state, FOE).hp.current).toBe(170);
    expect(conditionIds(state, FOE)).toEqual(["prone"]);
  });

  it("still heals a creature with none of those conditions", () => {
    const { state } = fight(wizard);
    actor(state, FOE).hp.current = 100;
    use(state, castOf("heal"), [FOE]);
    expect(actor(state, FOE).hp.current).toBe(170);
  });
});

describe("Mass Heal", () => {
  it("divides 700 hit points among its targets and ends the same three conditions on each", () => {
    const { state } = fight(wizard);
    actor(state, FOE).hp.current = 20;
    actor(state, FOE2).hp.current = 50;
    afflict(state, FOE2, "deafened");
    use(state, castOf("mass-heal"), [FOE, FOE2]);
    expect([actor(state, FOE).hp.current, actor(state, FOE2).hp.current]).toEqual([200, 200]);
    expect(conditionIds(state, FOE2)).toEqual([]);
  });
});

describe("Power Word Heal", () => {
  it("restores every hit point and ends Charmed, Frightened, Paralyzed, Poisoned and Stunned", () => {
    const { state } = fight(wizard);
    actor(state, FOE).hp.current = 12;
    afflict(state, FOE, "stunned", "frightened", "prone");
    const result = use(state, castOf("power-word-heal"), [FOE]);
    expect(actor(state, FOE).hp.current).toBe(200);
    expect(result.healing?.total).toBe(188);
    expect(conditionIds(state, FOE)).toEqual(["prone"]);
  });
});

describe("Lesser Restoration", () => {
  it("ends the condition the caster picks, or the first present when none is named", () => {
    const first = fight(bard);
    afflict(first.state, FOE, "blinded", "poisoned");
    first.resolve("spell-lesser-restoration", {});
    expect(conditionIds(first.state, FOE)).toEqual(["poisoned"]);
    const picked = fight(bard);
    afflict(picked.state, FOE, "blinded", "poisoned");
    picked.resolve("spell-lesser-restoration", { conditionId: "poisoned" });
    expect(conditionIds(picked.state, FOE)).toEqual(["blinded"]);
  });

  it("is refused on a creature without the picked condition, before the slot is spent", () => {
    const { state, resolve } = fight(bard);
    afflict(state, FOE, "blinded");
    const slots = JSON.stringify(actor(state, HERO).spellSlots);
    expect(() => resolve("spell-lesser-restoration", { conditionId: "deafened" })).toThrowError(
      /Goblin isn't Deafened - Lesser Restoration would do nothing/
    );
    expect(JSON.stringify(actor(state, HERO).spellSlots)).toBe(slots);
  });

  it("offers its four conditions on the action's availability row", () => {
    const { state, hero } = fight(bard);
    const actions = effectiveActions(bard, hero, catalog);
    const row = actionAvailability(
      state,
      hero,
      actions.filter((action) => action.id === "spell-lesser-restoration"),
      bard,
      false,
      actions,
      catalog
    )[0];
    expect(row?.conditionChoices).toEqual(["blinded", "deafened", "paralyzed", "poisoned"]);
  });
});

describe("Protection from Poison", () => {
  it("ends Poisoned and leaves Resistance to Poison and Advantage on saves against it", () => {
    const { state, resolve } = fight(druid);
    afflict(state, FOE, "poisoned");
    resolve("spell-protection-from-poison", {});
    const goblin = actor(state, FOE);
    expect(conditionIds(state, FOE)).toEqual([]);
    expect(goblin.effects[0]).toMatchObject({ name: "Protection from Poison" });
    const derivation = deriveEquipment(goblin, undefined, catalog);
    expect(saveRollSources(goblin, "con", derivation, false, ["poisoned"]).advantage).toEqual([
      expect.objectContaining({ label: expect.stringContaining("Protection from Poison") })
    ]);
    expect(saveRollSources(goblin, "con", derivation).advantage).toEqual([]);
  });
});
