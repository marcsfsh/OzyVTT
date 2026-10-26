import { describe, expect, it } from "vitest";
import type { ActorDefinition } from "@vtt/schemas";
import { type CharacterCreateRequestInput } from "../src/character-build.js";
import { RulesBlockedError } from "../src/game-store.js";
import { readComponents } from "../src/resolution/components.js";
import { keepDeathRecords } from "../src/death.js";
import { build, catalog, fight, heroTurnAgain, view, warlockInput } from "./spell-casters.js";

// SRD 5.2.1 Pact of the Blade: "As a Bonus Action, you can conjure a pact weapon in your hand ... Until the bond ends,
// you have proficiency with the weapon, and you can use it as a Spellcasting Focus. Whenever you attack with the bonded
// weapon, you can use your Charisma modifier for the attack and damage rolls instead of using Strength or Dexterity; and
// you can cause the weapon to deal Necrotic, Psychic, or Radiant damage or its normal damage type. Your bond with the
// weapon ends if you use this feature's Bonus Action again ... or if you die. A conjured weapon disappears when the bond
// ends." Thirsting Blade: "You gain the Extra Attack feature for your pact weapon only."

/** A Warlock 5 (CHA 17, STR 8) whose invocations are swapped as named, with a Longsword picked for the pact. */
function warlockWith(swaps: Readonly<Record<string, string>>): ActorDefinition {
  const input = warlockInput(["hex", "hellish-rebuke", "hold-person", "misty-step"]);
  const dropped = new Set(Object.keys(swaps));
  const choices = input.choices.flatMap((row) => {
    if (row.kind === "eldritch-invocation" && swaps[row.id]) return [{ ...row, id: swaps[row.id]! }];
    if (row.kind === "cantrip" && dropped.has(String(row.payload?.featureId))) return [];
    return [row];
  });
  return build({
    ...input,
    choices: [
      ...choices,
      { level: 2, classId: "warlock", kind: "weapon", id: "longsword", payload: { featureId: "pact-of-the-blade" } }
    ]
  } as CharacterCreateRequestInput);
}

const blade = warlockWith({ "devils-sight": "pact-of-the-blade" });
const thirsting = warlockWith({
  "devils-sight": "pact-of-the-blade",
  "eldritch-spear": "thirsting-blade",
  "repelling-blast": "eldritch-smite"
});

describe("Pact of the Blade's Bonus Action", () => {
  it("conjures the picked weapon, bonded: Charisma, proficiency and its three damage types", () => {
    const { resolve, hero, action, state } = fight(blade);
    resolve("pact-of-the-blade", { targetIds: [] });
    expect(state.combat.turn.bonusActionUsed).toBe(true);
    const sword = hero.inventory.find((row) => row.recordId === "longsword")!;
    expect(sword).toMatchObject({ name: "Longsword (conjured)", equipped: true });
    const swing = action(`item-${sword.id}`);
    // CHA +2 for STR -1, and the Proficiency Bonus (+3) a Warlock has with no Martial weapon but this one.
    expect(swing.attack!.bonus).toBe(5);
    expect(swing.damage[0]!.formula).toBe("1d8 + 2");
    expect(swing.damageTypes).toEqual(["slashing", "necrotic", "psychic", "radiant"]);
  });

  it("ends the bond when used again, and the weapon it conjured disappears", () => {
    const { resolve, hero, state } = fight(blade);
    resolve("pact-of-the-blade", { targetIds: [] });
    const first = hero.inventory.find((row) => row.recordId === "longsword")!.id;
    heroTurnAgain(state);
    resolve("pact-of-the-blade", { targetIds: [] });
    const swords = hero.inventory.filter((row) => row.recordId === "longsword");
    expect(swords).toHaveLength(1);
    expect(swords[0]!.id).not.toBe(first);
    expect(hero.effects.filter((effect) => effect.tags.includes("pact-weapon"))).toHaveLength(1);
  });

  it("serves as the Spellcasting Focus for a spell's Material component", () => {
    const { resolve, hero, action } = fight(blade);
    // Nothing else to cast with: no pouch, no Arcane Focus.
    hero.inventory = hero.inventory.filter((row) => !/focus|pouch/.test(row.id));
    const gaps = () =>
      readComponents({
        attacker: hero,
        action: action("spell-hold-person"),
        spell: view.spellRecord("hold-person"),
        definition: blade,
        catalog,
        targetCount: 1
      }).gaps.map((gap) => gap.rule);
    expect(gaps()).toContain("spell.no-material");
    resolve("pact-of-the-blade", { targetIds: [] });
    expect(gaps()).toEqual([]);
  });
});

describe("Thirsting Blade", () => {
  it("attacks twice with the pact weapon, and the second attack is the pact weapon's alone", () => {
    const { resolve, hero, action } = fight(thirsting);
    resolve("pact-of-the-blade", { targetIds: [] });
    const sword = hero.inventory.find((row) => row.recordId === "longsword")!;
    expect(action(`item-${sword.id}`).attack).toMatchObject({ count: 2, countWithItself: true });
    // Without the bond's weapon no other weapon swings twice.
    const dagger = hero.inventory.find((row) => row.id === "dagger")!;
    expect(action(`item-${dagger.id}`).attack?.count ?? 1).toBe(1);
    resolve(`item-${sword.id}`, {}, [15, 4]);
    expect(() => resolve(`item-${dagger.id}`, {}, [15, 2])).toThrow(RulesBlockedError);
    resolve(`item-${sword.id}`, {}, [15, 4]);
  });
});

describe("Eldritch Smite", () => {
  it("rides a hit with the bonded weapon only", () => {
    const { resolve, hero, action } = fight(thirsting);
    const dagger = hero.inventory.find((row) => row.id === "dagger")!;
    const unbonded = resolve(`item-${dagger.id}`, { commit: false }, [15]);
    expect(unbonded.hitOffers?.some((offer) => offer.id === "eldritch-smite") ?? false).toBe(false);
    resolve("pact-of-the-blade", { targetIds: [] });
    const sword = hero.inventory.find((row) => row.recordId === "longsword")!;
    expect(action(`item-${sword.id}`)).toBeDefined();
    const bonded = resolve(`item-${sword.id}`, { commit: false }, [15]);
    expect(bonded.hitOffers?.find((offer) => offer.id === "eldritch-smite")).toMatchObject({ name: "Eldritch Smite" });
  });
});

describe("Devouring Blade", () => {
  it("gives the pact weapon three attacks", () => {
    const bag = thirsting.extensions!["open5e.srd-2024"] as { traits: Array<{ name: string; description: string }> };
    const devouring: ActorDefinition = {
      ...thirsting,
      extensions: {
        ...thirsting.extensions,
        "open5e.srd-2024": { ...bag, traits: [...bag.traits, { name: "Devouring Blade", description: "" }] }
      }
    };
    const { resolve, hero, action } = fight(devouring);
    resolve("pact-of-the-blade", { targetIds: [] });
    const sword = hero.inventory.find((row) => row.recordId === "longsword")!;
    expect(action(`item-${sword.id}`).attack).toMatchObject({ count: 3, countWithItself: true });
  });
});

describe("the bond's end", () => {
  it("comes with the Warlock's death, and the conjured weapon goes with it", () => {
    const { resolve, hero, state } = fight(blade);
    resolve("pact-of-the-blade", { targetIds: [] });
    const before = structuredClone(state);
    hero.hp = { ...hero.hp, current: 0 };
    hero.deathSaves = { successes: 0, failures: 3, stable: false };
    keepDeathRecords(state, before);
    expect(hero.effects.some((effect) => effect.tags.includes("pact-weapon"))).toBe(false);
    expect(hero.inventory.some((row) => row.recordId === "longsword")).toBe(false);
  });
});
