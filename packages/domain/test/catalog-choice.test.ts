import { describe, expect, it } from "vitest";
import { CatalogChoiceError, resolveCatalogChoice, type CatalogChoiceCatalogs } from "../src/catalog-choice.js";
import type { ContentClassSummary, ContentEquipmentSummary, ContentFeatSummary, ContentSpeciesSummary, ContentSpellSummary, ContentSubclassSummary } from "../src/index.js";

/**
 * THE INFERENCE-BUDGET GUARD FOR THIS PROGRAM, and it is a TYPE assertion on purpose.
 *
 * Inlining one more property in `EquipmentReferenceSchema` (`packages/content-srd-5.2.1`) once
 * pushed a `z.infer` past TypeScript's expansion budget, and the compiler answered by silently
 * truncating a DIFFERENT inferred type - the spell summary THIS file's resolver reads - dropping
 * its attack-roll and range fields with no error at the edit site. `resolvePickChoice` reads
 * `attackRoll`, `rangeFeet`, `damageRoll` and `damageTypes` to answer the three closed `fromPicks`
 * predicates; lose any of them to a collapse and those predicates silently stop matching.
 *
 * The content package carries the same assertion over its own types, but instantiation budgets are
 * PER-PROGRAM: a guard in that package's small program cannot detect exhaustion in this larger one,
 * which is the program the historic truncation actually surfaced in. Hence a copy here, next to the
 * code that suffered it. Runtime assertions cannot see this: the VALUES arrive fine over the wire;
 * it is the compile-time type that goes missing.
 *
 * The `any` and `never` arms are the point. A bare `T[K] extends Expected` answers TRUE for both -
 * a conditional on `any` returns both branches unioned, and `never` extends everything - so the two
 * shapes a truncated inference actually takes are exactly the two a naive check waves through.
 */
type Intact<T, K extends keyof T, Expected> =
  0 extends (1 & T[K]) ? never
  : [T[K]] extends [never] ? never
  : T[K] extends Expected ? true : never;
const _inferenceBudget: [
  Intact<ContentSpellSummary, "attackRoll", boolean>,
  Intact<ContentSpellSummary, "rangeFeet", number | null>,
  Intact<ContentSpellSummary, "damageRoll", string | null>,
  Intact<ContentSpellSummary, "damageTypes", readonly string[]>,
  Intact<ContentEquipmentSummary, "weapon", { properties?: readonly string[] } | null | undefined>
] = [true, true, true, true, true];
void _inferenceBudget;

/**
 * Fixture catalogs, minimal but real-shaped: every field the resolver reads is present, everything
 * else is the smallest legal value. Built as partials cast at the edges so a summary-shape change
 * that the resolver depends on still fails loudly here.
 */
const classSummary = (id: string): ContentClassSummary => ({
  id, name: id, source: "srd", summary: null, description: null, hitDie: "d10",
  statPriority: ["str", "con", "dex", "wis", "cha", "int"], primaryAbilities: ["str"], savingThrows: ["str", "con"],
  skillChoiceCount: 2, skillChoices: ["athletics"], armorProficiencies: [], weaponProficiencies: [], toolProficiencies: [],
  toolChoices: null, multiclassProficiencies: null, multiclassPrerequisites: null,
  subclassLevel: 3, subclassLabel: null, asiLevels: [4], spellcastingAbility: null, spellcastingProgression: null, spellcasting: null,
  levelTable: [], startingEquipmentOptions: [], features: []
});
const subclassSummary = (id: string, classId: string): ContentSubclassSummary => ({
  id, name: id, source: "srd", classId, summary: null, description: null, subclassLevel: null,
  spellcastingAbility: null, spellcastingProgression: null, spellcasting: null, features: []
});
const speciesSummary = (id: string, lineages: readonly string[]): ContentSpeciesSummary => ({
  id, name: id, source: "srd", summary: null, description: null, sizes: ["medium"], speedFeet: 30, darkvisionFeet: null,
  creatureType: "humanoid", abilityBonuses: [], abilityBonusChoice: null, languages: [], languageChoices: null,
  lineages: lineages.map((lineage) => ({ id: lineage, name: lineage, description: null })), features: []
});
const featSummary = (id: string, category: string): ContentFeatSummary => ({
  id, name: id, source: "srd", summary: null, description: null, category, repeatable: false,
  prerequisiteLevel: null, prerequisiteAbilities: [], prerequisiteRequires: [], prerequisiteText: null,
  feature: { id, name: id, level: null, description: "x", tags: [], choice: null, choices: [], grantedAtLevels: [], extraPicks: [] }
});
const spellSummary = (id: string, level: number, classes: readonly string[]): ContentSpellSummary => ({
  id, name: id, level, school: "evocation", castingTime: "1 action", rangeText: null, componentsText: "V", duration: "Instantaneous",
  concentration: false, ritual: false, description: "x", higherLevel: null, classes, damageRoll: null, damageTypes: [],
  attackRoll: false, rangeFeet: null, castingOptions: []
});
const equipmentSummary = (id: string, category: ContentEquipmentSummary["category"]): ContentEquipmentSummary => ({
  id, name: id, category, costGp: null, weightLb: null, description: null,
  weapon: category === "weapon" ? { category: "simple", damageDice: "1d6", damageType: "slashing", rangeFeet: null, longRangeFeet: null } : null,
  armor: null
});

const catalogs: CatalogChoiceCatalogs = {
  classes: [classSummary("fighter"), classSummary("wizard"), classSummary("bard")],
  subclasses: [subclassSummary("champion", "fighter"), subclassSummary("evoker", "wizard")],
  species: [speciesSummary("elf", ["drow", "high-elf", "wood-elf"]), speciesSummary("human", [])],
  feats: [featSummary("alert", "origin"), featSummary("archery", "fighting-style"), featSummary("tough", "origin")],
  spells: [spellSummary("fire-bolt", 0, ["wizard"]), spellSummary("magic-missile", 1, ["wizard"]), spellSummary("cure-wounds", 1, ["cleric"])],
  equipment: [
    equipmentSummary("longsword", "weapon"), equipmentSummary("shield", "shield"), equipmentSummary("rope", "adventuring-gear"),
    equipmentSummary("thieves-tools", "tool"), equipmentSummary("smiths-tools", "tool")
  ],
  skills: [
    { id: "athletics", name: "Athletics", description: "x", ability: "str" },
    { id: "stealth", name: "Stealth", description: "x", ability: "dex" }
  ],
  languages: [
    { id: "common", name: "Common", description: "x", table: "standard" },
    { id: "dwarvish", name: "Dwarvish", description: "x", table: "standard" },
    { id: "druidic", name: "Druidic", description: "x", table: "rare" }
  ]
};

describe("resolveCatalogChoice - tools, languages and the union combinator (ruling C)", () => {
  it("resolves tools off the equipment catalog, the way weapons already did", () => {
    // Skilled's "or tools" half (audit row 60) needed a FAMILY, not a new bundle: `equipment.v1.json`
    // already publishes 35 rows with `category: "tool"` and the ids are the ones `grants.tools` names.
    expect(resolveCatalogChoice("tools", catalogs).map((option) => option.id)).toEqual(["thieves-tools", "smiths-tools"]);
    expect(resolveCatalogChoice("tools", catalogs).map((option) => option.id)).not.toContain("longsword");
  });

  it("resolves the whole language list, and narrows to ONE printed SRD table", () => {
    expect(resolveCatalogChoice("languages", catalogs).map((option) => option.id)).toEqual(["common", "dwarvish", "druidic"]);
    // The base "Common plus two languages" budget draws from STANDARD only. Druidic and Thieves' Cant
    // are rare and arrive from a class feature - offering them at level 1 would hand out a secret language.
    expect(resolveCatalogChoice("standard-languages", catalogs).map((option) => option.id)).toEqual(["common", "dwarvish"]);
    expect(resolveCatalogChoice("rare-languages", catalogs).map((option) => option.id)).toEqual(["druidic"]);
  });

  it("throws, rather than offering an empty picker, for a table nobody prints", () => {
    expect(() => resolveCatalogChoice("planar-languages", catalogs)).toThrowError(CatalogChoiceError);
    expect(() => resolveCatalogChoice("planar-languages", catalogs)).toThrowError(/No languages are printed in the "planar" table/);
  });

  it("unions the families a `-or-` slug names, in order, de-duplicated by id", () => {
    // Skilled: "any combination of three skills or tools".
    expect(resolveCatalogChoice("skills-or-tools", catalogs).map((option) => option.id))
      .toEqual(["athletics", "stealth", "thieves-tools", "smiths-tools"]);
    // Magical Discoveries: "the Cleric, Druid, or Wizard spell list, or any combination thereof".
    expect(resolveCatalogChoice("wizard-spells-or-cleric-spells", catalogs).map((option) => option.id))
      .toEqual(["fire-bolt", "magic-missile", "cure-wounds"]);
    // A part that is itself a content gap contributes nothing instead of taking the union down.
    expect(resolveCatalogChoice("skills-or-bard-spells", catalogs).map((option) => option.id)).toEqual(["athletics", "stealth"]);
  });

  it("still throws when EVERY part of a union is a gap - a union of nothing is nothing", () => {
    expect(() => resolveCatalogChoice("bard-spells-or-rogue-spells", catalogs)).toThrowError(CatalogChoiceError);
    expect(() => resolveCatalogChoice("bard-spells-or-rogue-spells", catalogs)).toThrowError(/None of "bard-spells", "rogue-spells" resolved/);
  });
});

describe("resolveCatalogChoice", () => {
  it("resolves the skills catalog", () => {
    expect(resolveCatalogChoice("skills", catalogs).map((option) => option.id)).toEqual(["athletics", "stealth"]);
  });

  it("resolves weapons to the equipment catalog's weapon rows only", () => {
    expect(resolveCatalogChoice("weapons", catalogs).map((option) => option.id)).toEqual(["longsword"]);
  });

  it("resolves <listId>-spells through the spell's classes tags, carrying the spell level", () => {
    const options = resolveCatalogChoice("wizard-spells", catalogs);
    expect(options.map((option) => option.id)).toEqual(["fire-bolt", "magic-missile"]);
    expect(options.find((option) => option.id === "magic-missile")?.level).toBe(1);
    expect(resolveCatalogChoice("cleric-spells", catalogs).map((option) => option.id)).toEqual(["cure-wounds"]);
  });

  it("resolves a homebrew list id the spell-list overlay stamped into `classes`, unchanged", () => {
    // The other half of the spell-list overlay seam: the overlay's ONLY output is an extra tag in
    // `classes`, and this resolver already filters on exactly that - so a homebrew list needs no
    // resolver change at all. `hb-necromancer` here is what the merge point produced.
    const overlaid: CatalogChoiceCatalogs = {
      ...catalogs,
      spells: [
        spellSummary("fire-bolt", 0, ["wizard", "hb-necromancer"]),
        spellSummary("magic-missile", 1, ["wizard"]),
        spellSummary("hb-grave-touch", 1, ["hb-necromancer"])
      ]
    };
    expect(resolveCatalogChoice("hb-necromancer-spells", overlaid).map((option) => option.id)).toEqual(["fire-bolt", "hb-grave-touch"]);
    // And an overlay that resolved to nothing is still the loud rejection, never a silent empty picker.
    expect(() => resolveCatalogChoice("hb-empty-spells", overlaid)).toThrowError(/No spells are tagged/);
  });

  it("keeps `weapons` keyed on the category literal now that category is an open slug", () => {
    // Opening the category is strictly permissive, so a homebrew kind must neither break the weapon
    // filter nor sneak into it - a new slug is inert until an explicit mechanical `slot` field lands.
    const withHomebrew: CatalogChoiceCatalogs = {
      ...catalogs,
      equipment: [...catalogs.equipment, equipmentSummary("hb-grave-lantern", "relic"), equipmentSummary("hb-scythe", "weapon")]
    };
    expect(resolveCatalogChoice("weapons", withHomebrew).map((option) => option.id)).toEqual(["longsword", "hb-scythe"]);
  });

  it("resolves <classId>-subclasses against the parent classId", () => {
    expect(resolveCatalogChoice("fighter-subclasses", catalogs).map((option) => option.id)).toEqual(["champion"]);
    expect(resolveCatalogChoice("wizard-subclasses", catalogs).map((option) => option.id)).toEqual(["evoker"]);
  });

  it("resolves <category>-feats against the open feat category", () => {
    expect(resolveCatalogChoice("origin-feats", catalogs).map((option) => option.id)).toEqual(["alert", "tough"]);
    expect(resolveCatalogChoice("fighting-style-feats", catalogs).map((option) => option.id)).toEqual(["archery"]);
  });

  it("resolves <speciesId>-lineages against the species record", () => {
    expect(resolveCatalogChoice("elf-lineages", catalogs).map((option) => option.id)).toEqual(["drow", "high-elf", "wood-elf"]);
  });

  it("throws for an unknown family instead of returning a silent empty list", () => {
    expect(() => resolveCatalogChoice("mystery-list", catalogs)).toThrowError(CatalogChoiceError);
    expect(() => resolveCatalogChoice("mystery-list", catalogs)).toThrowError(/matches no known family/);
  });

  it("throws for a known family whose target does not exist", () => {
    expect(() => resolveCatalogChoice("paladin-subclasses", catalogs)).toThrowError(/No class "paladin"/);
    expect(() => resolveCatalogChoice("orc-lineages", catalogs)).toThrowError(/No species "orc"/);
  });

  it("throws for a known family that resolves to zero options (a content gap must be loud)", () => {
    // Bard exists as a class but has no authored subclasses; human has no lineages;
    // no feats carry the epic-boon category; no spells are tagged for the druid list.
    expect(() => resolveCatalogChoice("bard-subclasses", catalogs)).toThrowError(/No subclasses are authored/);
    expect(() => resolveCatalogChoice("human-lineages", catalogs)).toThrowError(/has no lineages/);
    expect(() => resolveCatalogChoice("epic-boon-feats", catalogs)).toThrowError(/No "epic-boon" feats/);
    expect(() => resolveCatalogChoice("druid-spells", catalogs)).toThrowError(/No spells are tagged/);
  });
});
