import { describe, expect, it } from "vitest";
import { armorClassInPlay, BuilderPolicySchema } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { generateCharacterRequest } from "../src/character-generate.js";
import { effectiveActions } from "../src/effective-actions.js";
import { RulesBlockedError } from "../src/game-store.js";
import { readComponents } from "../src/resolution/components.js";
import { ALLY, build, catalog, fight, HERO, view, warlockInput, wizardInput, WIZARD_SPELLS } from "./spell-casters.js";
import { druid } from "./shape-shifters.js";

// How a feature changes the spells it gives (SRD 5.2.1): Wild Companion and Dragon Companion cast "without Material
// components", the "on yourself" invocations cast only on the Warlock, and Fiendish Vigor's False Life takes "the
// highest number on the die".

/** The components a built caster's cast lacks, carrying nothing but its kit with every Material item taken out. */
function materialGaps(definition: ActorDefinition, actionId: string): string[] {
  const { hero } = fight(definition);
  hero.inventory = hero.inventory.filter((row) => !/incense|engraved|focus|pouch|holy|druidic/i.test(row.id));
  const action = effectiveActions(definition, hero, catalog).find((entry) => entry.id === actionId);
  if (!action) throw new Error(`No action ${actionId}`);
  const reading = readComponents({
    attacker: hero,
    action,
    spell: action.spellId ? view.spellRecord(action.spellId) : undefined,
    definition,
    catalog,
    targetCount: 0
  });
  return reading.gaps.map((gap) => gap.rule);
}

describe("a granted spell cast without Material components", () => {
  it("lets a Druid cast Wild Companion's Find Familiar with a slot or a use of Wild Shape and no incense", () => {
    const companion = druid(2);
    expect(materialGaps(companion, "spell-find-familiar")).toEqual([]);
    expect(materialGaps(companion, "spell-find-familiar-free")).toEqual([]);
  });

  it("still asks a Wizard's own Find Familiar for its incense", () => {
    const wizard = build(wizardInput([...WIZARD_SPELLS.slice(0, 8), "find-familiar"]));
    expect(materialGaps(wizard, "spell-find-familiar")).toContain("spell.no-material");
  });

  it("lets a Draconic Sorcerer cast Summon Dragon with no engraved object, free or with a slot", () => {
    const seeded = (() => {
      let state = 7;
      return (sides: number) => ((state = (state * 48271) % 2147483647) % sides) + 1;
    })();
    const policy = BuilderPolicySchema.parse({});
    const { request } = generateCharacterRequest({ classId: "sorcerer", level: 18 }, view, policy, seeded);
    const sorcerer = buildCharacterDefinition(request, view, policy);
    expect(materialGaps(sorcerer, "spell-summon-dragon-free")).toEqual([]);
    expect(materialGaps(sorcerer, "spell-summon-dragon")).toEqual([]);
  });
});

/** A Warlock 5 holding the "on yourself" invocations named, in place of the fixture's own. */
function warlockWith(swaps: Readonly<Record<string, string>>): ActorDefinition {
  const input = warlockInput(["hex", "hellish-rebuke", "hold-person", "misty-step"]);
  const dropped = new Set(Object.keys(swaps));
  const choices = input.choices.flatMap((row) => {
    if (row.kind === "eldritch-invocation" && swaps[row.id]) return [{ ...row, id: swaps[row.id]! }];
    // A swapped invocation's own cantrip pick goes with it.
    if (row.kind === "cantrip" && dropped.has(String(row.payload?.featureId))) return [];
    return [row];
  });
  return build({ ...input, choices } as CharacterCreateRequestInput);
}

describe("an invocation's spell cast on yourself", () => {
  const warlock = warlockWith({ "devils-sight": "armor-of-shadows", "repelling-blast": "otherworldly-leap" });

  it("casts Mage Armor on the Warlock and refuses it on an ally", () => {
    const { resolve, hero } = fight(warlock, { ally: true });
    // Out of its Leather Armor, as Mage Armor asks.
    hero.inventory = hero.inventory.filter((row) => row.id !== "leather-armor");
    expect(() => resolve("spell-mage-armor-free", { targetIds: [ALLY] })).toThrow(RulesBlockedError);
    const unarmored = armorClassInPlay(hero) ?? 10;
    resolve("spell-mage-armor-free", { targetIds: [HERO] });
    // 13 + its Dexterity modifier, 3 above the 10 it had.
    expect(armorClassInPlay(hero)).toBe(unarmored + 3);
  });

  it("refuses Otherworldly Leap's Jump on anyone but the Warlock", () => {
    const { resolve } = fight(warlock, { ally: true });
    expect(() => resolve("spell-jump-free", { targetIds: [ALLY] })).toThrow(/can target only Vex/);
  });
});

describe("Fiendish Vigor", () => {
  it("gives False Life's highest Temporary Hit Points with no roll", () => {
    const { resolve, hero } = fight(warlockWith({ "eldritch-mind": "fiendish-vigor" }));
    // 2d4 + 4 at its highest is 12, whatever the dice would show.
    resolve("spell-false-life-free", { targetIds: [HERO] }, [1, 1]);
    expect(hero.hp.temporary).toBe(12);
  });
});
