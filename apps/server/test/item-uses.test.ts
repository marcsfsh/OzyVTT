import { describe, expect, it } from "vitest";
import { setCondition } from "../src/actor-conditions.js";
import { effectiveActions } from "../src/effective-actions.js";
import {
  actionOf,
  catalog,
  catalogRow,
  edit,
  fight,
  fighterInput,
  IDS,
  resolveAt,
  tableOf,
  wizardInput,
  write,
  type Table
} from "./equipment-table.js";

// What a worn item's action gives lasts while the item is worn; potions put their effect on whoever drinks them, for
// the time they print; a consumable that casts a spell is used from the pack.

const has = (table: Table, actorId: string, conditionId: string) =>
  table.actor(actorId).conditions.some((condition) => condition.id === conditionId);
const row = (table: Table, actorId: string, id: string) =>
  table.actor(actorId).inventory.find((entry) => entry.id === id);

describe("what a worn item gave ends when it comes off", () => {
  it("ends a Ring of Invisibility's Invisible when the ring is taken off", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("ring-of-invisibility", { attuned: true }));
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-ring-of-invisibility-vanish", [], { targetIds: [] });
    expect(has(table, IDS.fighter, "invisible")).toBe(true);
    write(table, IDS.fighter, edit(table, IDS.fighter, "ring-of-invisibility", { equipped: false }));
    expect(has(table, IDS.fighter, "invisible")).toBe(false);
  });

  it("gives a Cloak of Invisibility's hour of Invisible for a charge", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("cloak-of-invisibility", { attuned: true }));
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-cloak-of-invisibility-vanish", [], { targetIds: [] });
    expect(
      table.actor(IDS.fighter).effects.find((effect) => effect.name === "Cloak of Invisibility")?.duration
    ).toEqual({ type: "minutes", remaining: 60 });
    expect(table.actor(IDS.fighter).actionUses["cloak-of-invisibility-charges"]).toBe(1);
  });

  it("frees a hand while the Animated Shield hovers, so a Greatsword swings beside it", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("animated-shield", { attuned: true }));
    fight(table, IDS.fighter);
    expect(() => resolveAt(table, IDS.fighter, "item-greatsword", [15, 3, 3], {}, 5)).toThrow(/needs two hands/);
    table.state.combat.turn = { ...table.state.combat.turn, actionUsed: false };
    resolveAt(table, IDS.fighter, "item-animated-shield-animate", [], { targetIds: [] });
    expect(resolveAt(table, IDS.fighter, "item-greatsword", [15, 3, 3], {}, 5).attack?.outcome).toBe("hit");
  });

  it("drops the Animated Shield for good when its user is Incapacitated", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("animated-shield", { attuned: true }));
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-animated-shield-animate", [], { targetIds: [] });
    const animated = () => table.actor(IDS.fighter).effects.some((effect) => effect.tags.includes("animated-shield"));
    expect(animated()).toBe(true);
    setCondition(table.state, IDS.fighter, "unconscious", true, undefined, { role: "gm" });
    setCondition(table.state, IDS.fighter, "unconscious", false, undefined, { role: "gm" });
    expect(animated()).toBe(false);
  });
});

describe("potions", () => {
  it("keeps a Potion of Invisibility's Invisible until the drinker attacks", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("potion-of-invisibility", { equipped: false }));
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-potion-of-invisibility-drink", [], { targetIds: [] });
    expect(has(table, IDS.fighter, "invisible")).toBe(true);
    // Unseen, the swing rolls with Advantage: two d20s, then the Greatsword's 2d6.
    resolveAt(table, IDS.fighter, "item-greatsword", [15, 15, 3, 3], {}, 5);
    expect(has(table, IDS.fighter, "invisible")).toBe(false);
  });

  it("gives a Potion of Heroism's 10 Temporary Hit Points and an hour of Bless's d4", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("potion-of-heroism", { equipped: false }));
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-potion-of-heroism-drink", [], { targetIds: [IDS.fighter] });
    expect(table.actor(IDS.fighter).hp.temporary).toBe(10);
    expect(table.actor(IDS.fighter).effects.find((effect) => effect.name === "Potion of Heroism")).toMatchObject({
      duration: { type: "minutes", remaining: 60 },
      tags: ["blessed"]
    });
  });

  it("resists every damage type for a minute after a Potion of Invulnerability", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("potion-of-invulnerability", { equipped: false }));
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-potion-of-invulnerability-drink", [], { targetIds: [] });
    const effect = table.actor(IDS.fighter).effects.find((entry) => entry.name === "Potion of Invulnerability")!;
    expect(effect.duration).toEqual({ type: "rounds", remaining: 10 });
    expect(effect.modifiers[0]).toMatchObject({ type: "damage-resistance" });
    expect((effect.modifiers[0] as { damageTypes: string[] }).damageTypes).toHaveLength(13);
  });

  it("ends Blinded and Poisoned on the creature an Elixir of Health is given to", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("elixir-of-health", { equipped: false }));
    setCondition(table.state, IDS.fighter, "blinded", true, undefined, { role: "gm" });
    setCondition(table.state, IDS.fighter, "poisoned", true, undefined, { role: "gm" });
    expect([has(table, IDS.fighter, "blinded"), has(table, IDS.fighter, "poisoned")]).toEqual([true, true]);
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-elixir-of-health-drink", [], { targetIds: [IDS.fighter] });
    expect([has(table, IDS.fighter, "blinded"), has(table, IDS.fighter, "poisoned")]).toEqual([false, false]);
    expect(row(table, IDS.fighter, "elixir-of-health")).toBeUndefined();
  });

  it("refuses to pour a Potion of Healing into a creature farther than 5 feet away", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("potion-of-healing-greater", { equipped: false }));
    fight(table, IDS.fighter);
    expect(() =>
      resolveAt(table, IDS.fighter, "item-potion-of-healing-greater-drink", [1, 1, 1, 1], { targetIds: [IDS.foe] }, 30)
    ).toThrow("Foe is 30 ft away, beyond Drink Potion of Healing (greater)'s touch.");
  });

  it("casts a Potion of Animal Friendship's spell from the pack at DC 13, and drinks it up", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("potion-of-animal-friendship", { equipped: false }));
    const cast = effectiveActions(table.definition(IDS.wizard), table.actor(IDS.wizard), catalog).find((action) =>
      action.id.startsWith("item-potion-of-animal-friendship-cast")
    )!;
    expect(cast.save).toMatchObject({ ability: "wis", dc: 13 });
    fight(table, IDS.wizard);
    resolveAt(table, IDS.wizard, cast.id, []);
    expect(row(table, IDS.wizard, "potion-of-animal-friendship")).toBeUndefined();
  });
});

describe("a cast that names only its user", () => {
  it("refuses a Ring of Jumping's Jump on anyone else", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("ring-of-jumping", { attuned: true }));
    fight(table, IDS.fighter);
    const jump = actionOf(table, IDS.fighter, "item-ring-of-jumping-cast-jump");
    expect(jump.activation).toBe("bonus-action");
    expect(() => resolveAt(table, IDS.fighter, jump.id, [], { targetIds: [IDS.foe] })).toThrow(/can target only Borin/);
    resolveAt(table, IDS.fighter, jump.id, [], { targetIds: [IDS.fighter] });
  });
});
