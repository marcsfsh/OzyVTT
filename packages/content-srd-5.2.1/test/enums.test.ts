/**
 * The drift test that lets `src/enums.ts` be literals.
 *
 * Those constants exist because the homebrew forms run in a browser and the loaders are node-only,
 * so the vocabularies had to be spellable without reading a bundle. A hand-written copy of bundle
 * data is normally a defect waiting to happen — this file is the reason it is not one. Every list is
 * re-derived here FROM THE BUNDLES and compared, so a bundle that gains a fourteenth condition fails
 * a test instead of silently disagreeing with the dropdown a GM is typing into.
 *
 * If one of these fails, the fix is always to update the constant, never to relax the assertion:
 * the bundle is the content and the constant is a projection of it.
 */

import { describe, expect, it } from "vitest";
import {
  CONDITION_IDS, CREATURE_TYPE_IDS, DAMAGE_TYPE_IDS, GEAR_CATEGORY_IDS, MAGIC_SCHOOL_IDS,
  WEAPON_MASTERY_IDS, WEAPON_PROPERTY_IDS,
  loadConditions, loadDamageTypes, loadEquipment, loadMonsterDefinitions, loadSpells, loadWeaponProperties
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
    // `SpellReference.school` is an open string, so the bundle is the only census of what the SRD
    // actually uses. Eight is the printed count; a ninth appearing here is real content news.
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
    // The bundle suffixes both families because they share one id space (`finesse-wp`,
    // `cleave-mastery`); every rider trigger matches the bare word. Getting this wrong would suggest
    // values that match nothing, which is the exact silent failure the suggestions exist to prevent.
    const rows = loadWeaponProperties();
    const bare = (kind: "property" | "mastery") =>
      sorted(rows.filter((row) => row.kind === kind).map((row) => row.id.replace(/-(wp|mastery)$/, "")));
    expect(WEAPON_PROPERTY_IDS).toEqual(bare("property"));
    expect(WEAPON_MASTERY_IDS).toEqual(bare("mastery"));
    expect(rows).toHaveLength(WEAPON_PROPERTY_IDS.length + WEAPON_MASTERY_IDS.length);
  });

  it("GEAR_CATEGORY_IDS covers every hand-authored gear category", () => {
    // Weapons and armour are mapped in by `loadEquipment` under the engine's own three literals, so
    // the hand-authored slice is what a homebrew author is choosing among.
    const authored = sorted([
      ...new Set(loadEquipment().filter((item) => !item.weapon && !item.armor).map((item) => item.category))
    ]);
    expect(GEAR_CATEGORY_IDS).toEqual(authored);
  });
});
