// Re-derives every `src/enums.ts` list from the bundles. On failure, update the constant and leave the assertion.

import { describe, expect, it } from "vitest";
import {
  CONDITION_IDS,
  CREATURE_TYPE_IDS,
  DAMAGE_TYPE_IDS,
  GEAR_CATEGORY_IDS,
  MAGIC_SCHOOL_IDS,
  RARITY_IDS,
  WEAPON_MASTERY_IDS,
  WEAPON_PROPERTY_IDS,
  loadConditions,
  loadDamageTypes,
  loadEquipment,
  loadMonsterDefinitions,
  loadSpells,
  loadWeaponProperties
} from "../src/index.js";

/** The extension bag the bestiary reads challenge rating and creature type from. */
const STATBLOCK_EXTENSION = "open5e.srd-2024";

const sorted = (values: readonly string[]): readonly string[] => [...values].sort();

describe("canonical SRD vocabularies", () => {
  it("DAMAGE_TYPE_IDS is exactly the damage-type bundle", () => {
    expect(DAMAGE_TYPE_IDS).toEqual(loadDamageTypes().map((row) => row.id));
    expect(DAMAGE_TYPE_IDS).toHaveLength(13);
  });

  it("CONDITION_IDS is exactly the condition bundle", () => {
    expect(CONDITION_IDS).toEqual(loadConditions().map((row) => row.id));
    expect(CONDITION_IDS).toHaveLength(15);
  });

  it("MAGIC_SCHOOL_IDS is every school any bundled spell declares", () => {
    expect(MAGIC_SCHOOL_IDS).toEqual(sorted([...new Set(loadSpells().map((spell) => spell.school))]));
  });

  it("CREATURE_TYPE_IDS is every creature type in the bestiary's extension bag", () => {
    const types = new Set<string>();
    for (const monster of loadMonsterDefinitions()) {
      const bag = (monster.extensions as Record<string, Record<string, unknown>> | undefined)?.[STATBLOCK_EXTENSION];
      const type = bag?.type;
      if (typeof type === "string" && type) types.add(type);
    }
    expect(CREATURE_TYPE_IDS).toEqual(sorted([...types]));
  });

  it("WEAPON_PROPERTY_IDS and WEAPON_MASTERY_IDS are the bundle's ids with their id-space suffix stripped", () => {
    // The bundle suffixes both families because they share one id space; riders match the bare word.
    const rows = loadWeaponProperties();
    const bare = (kind: "property" | "mastery") =>
      sorted(rows.filter((row) => row.kind === kind).map((row) => row.id.replace(/-(wp|mastery)$/, "")));
    expect(WEAPON_PROPERTY_IDS).toEqual(bare("property"));
    expect(WEAPON_MASTERY_IDS).toEqual(bare("mastery"));
    expect(rows).toHaveLength(WEAPON_PROPERTY_IDS.length + WEAPON_MASTERY_IDS.length);
  });

  it("GEAR_CATEGORY_IDS covers every hand-authored gear category", () => {
    // Weapons, armour and magic items are excluded so only the hand-authored gear categories remain.
    const authored = sorted([
      ...new Set(
        loadEquipment()
          .filter((item) => !item.weapon && !item.armor && !item.isMagic)
          .map((item) => item.category)
      )
    ]);
    expect(GEAR_CATEGORY_IDS).toEqual(authored);
  });

  it("RARITY_IDS contains every rarity the bundles declare: the weaker assertion, and the honest one", () => {
    // Rarity has no bundle to project, so this asserts containment.
    const declared = sorted([
      ...new Set(
        loadEquipment()
          .map((item) => item.rarity)
          .filter((rarity): rarity is string => !!rarity)
      )
    ]);
    for (const rarity of declared) expect(RARITY_IDS, `equipment rarity "${rarity}"`).toContain(rarity);
    expect(RARITY_IDS).toEqual(["common", "uncommon", "rare", "very-rare", "legendary", "artifact", "varies"]);
  });
});
