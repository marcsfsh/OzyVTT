import { describe, expect, it } from "vitest";
import { CatalogChoiceError, resolveCatalogChoice, type CatalogChoiceCatalogs } from "../src/catalog-choice.js";
import type { ContentClassSummary, ContentEquipmentSummary, ContentFeatSummary, ContentSpeciesSummary, ContentSpellSummary, ContentSubclassSummary } from "../src/index.js";

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
  feature: { id, name: id, level: null, description: "x", tags: [], choice: null }
});
const spellSummary = (id: string, level: number, classes: readonly string[]): ContentSpellSummary => ({
  id, name: id, level, school: "evocation", castingTime: "1 action", rangeText: null, componentsText: "V", duration: "Instantaneous",
  concentration: false, ritual: false, description: "x", higherLevel: null, classes, damageRoll: null, damageTypes: [], castingOptions: []
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
  equipment: [equipmentSummary("longsword", "weapon"), equipmentSummary("shield", "shield"), equipmentSummary("rope", "adventuring-gear")],
  skills: [
    { id: "athletics", name: "Athletics", description: "x", ability: "str" },
    { id: "stealth", name: "Stealth", description: "x", ability: "dex" }
  ]
};

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
