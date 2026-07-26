import { describe, expect, it } from "vitest";
import { parseDiceFormula } from "@vtt/rules-5e";
import {
  FULL_CASTER_SLOTS, asiLevelsFor, hitDieFor, meetsMulticlassPrerequisites, proficiencyBonusForLevel,
  spellSlotsForClass, statPriorityFor
} from "@vtt/rules-5e";
import {
  ClassReferenceSchema, FeatureRecordSchema, NamePoolReferenceSchema, SpeciesReferenceSchema,
  loadBackgrounds, loadClasses, loadEquipment, loadFeats, loadNames, loadSkills, loadSpecies,
  loadSubclasses, namesForSpecies, subclassesForClass
} from "../src/index.js";

/**
 * These bundles are PHASE-1 SEEDS: a small slice of real SRD content that proves the schemas parse
 * and the loaders work while the wizard, rules math, and UI are built in parallel. The assertions
 * below are therefore about SHAPE and INTEGRITY, not about content coverage - full transcription
 * lands in phases 2 and 5.
 */
describe("character-builder content records", () => {
  const classes = loadClasses();
  const subclasses = loadSubclasses();
  const species = loadSpecies();
  const backgrounds = loadBackgrounds();
  const feats = loadFeats();
  const names = loadNames();

  it("loads every bundle, cached, with unique ids and the srd source discriminator", () => {
    for (const [label, records] of [["classes", classes], ["subclasses", subclasses], ["species", species], ["backgrounds", backgrounds], ["feats", feats]] as const) {
      expect(records.length, label).toBeGreaterThan(0);
      const ids = records.map((record) => record.id);
      expect(new Set(ids).size, label).toBe(ids.length);
      for (const record of records) expect(record.source, `${label}/${record.id}`).toBe("srd");
    }
    // The loader caches: a second call returns the very same frozen-in array instance.
    expect(loadClasses()).toBe(classes);
    expect(loadNames()).toBe(names);
  });

  it("every class carries a complete, ordered 20-row level table", () => {
    for (const entry of classes) {
      expect(entry.levelTable.length, entry.id).toBe(20);
      entry.levelTable.forEach((row, index) => {
        expect(row.level, `${entry.id} row ${index}`).toBe(index + 1);
        // The table's own proficiency-bonus column must agree with the rules engine.
        expect(row.proficiencyBonus, `${entry.id} level ${row.level}`).toBe(proficiencyBonusForLevel(row.level));
      });
    }
  });

  it("every feature id the level table grants resolves to an authored FeatureRecord", () => {
    for (const entry of classes) {
      const authored = new Set(entry.features.map((feature) => feature.id));
      for (const row of entry.levelTable) {
        for (const featureId of row.features) expect(authored, `${entry.id} level ${row.level}`).toContain(featureId);
      }
    }
  });

  it("agrees with the rules engine on hit dice, stat priority, ASI levels, and multiclass prerequisites", () => {
    for (const entry of classes) {
      expect(entry.hitDie, entry.id).toBe(hitDieFor(entry.id));
      expect(entry.statPriority, entry.id).toEqual(statPriorityFor(entry.id));
      expect(entry.asiLevels, entry.id).toEqual(asiLevelsFor(entry.id));
      // Content and code must not disagree about who can multiclass into what.
      const scores = Object.fromEntries(entry.statPriority.map((ability, index) => [ability, index === 0 ? 13 : 8]));
      expect(meetsMulticlassPrerequisites(scores, entry.id), entry.id).toBe(true);
    }
    // The ASI levels are also exactly the levels whose table row grants the ASI feature.
    const fighter = classes.find((entry) => entry.id === "fighter")!;
    const asiRows = fighter.levelTable.filter((row) => row.features.includes("ability-score-improvement")).map((row) => row.level);
    expect(asiRows).toEqual(fighter.asiLevels);
  });

  it("transcribes the Fighter faithfully (spot check)", () => {
    const fighter = classes.find((entry) => entry.id === "fighter")!;
    expect(fighter.hitDie).toBe("d10");
    expect(fighter.savingThrows).toEqual(["str", "con"]);
    expect(fighter.skillChoices.choose).toBe(2);
    expect(fighter.skillChoices.from).toContain("athletics");
    expect(fighter.armorProficiencies).toEqual(["light", "medium", "heavy", "shields"]);
    expect(fighter.subclassLevel).toBe(3);
    expect(fighter.spellcasting).toBeUndefined();
    expect(fighter.multiclassPrerequisites).toEqual({ mode: "any", minimums: [{ ability: "str", minimum: 13 }, { ability: "dex", minimum: 13 }] });
    // Second Wind / Weapon Mastery / Action Surge / Indomitable ride the level table as class resources.
    const resourceAt = (level: number, id: string) => fighter.levelTable[level - 1].classResources.find((resource) => resource.id === id)?.amount;
    expect(resourceAt(1, "second-wind")).toBe(2);
    expect(resourceAt(4, "second-wind")).toBe(3);
    expect(resourceAt(10, "second-wind")).toBe(4);
    expect(resourceAt(1, "weapon-mastery")).toBe(3);
    expect(resourceAt(16, "weapon-mastery")).toBe(6);
    expect(resourceAt(1, "action-surge")).toBeUndefined();
    expect(resourceAt(2, "action-surge")).toBe(1);
    expect(resourceAt(17, "action-surge")).toBe(2);
    expect(resourceAt(9, "indomitable")).toBe(1);
    expect(resourceAt(13, "indomitable")).toBe(2);
    expect(resourceAt(17, "indomitable")).toBe(3);
    // Fighting Style is a CHOICE, not hardcoded behavior - it writes a `choices[]` row.
    const style = fighter.features.find((feature) => feature.id === "fighting-style")!;
    expect(style.choice).toMatchObject({ kind: "fighting-style", choose: 1, fromCatalog: "fighting-style-feats" });
    // Extra Attack is a typed modifier, not a special case in the engine.
    expect(fighter.features.find((feature) => feature.id === "extra-attack")!.modifiers).toEqual([{ type: "extra-attack", count: 1 }]);
    // Second Wind is a rollable action with scaling uses.
    const secondWind = fighter.features.find((feature) => feature.id === "second-wind")!;
    expect(secondWind.actions[0]).toMatchObject({ id: "second-wind", activation: "bonus-action" });
    expect(secondWind.uses).toMatchObject({ per: "long-rest", scaling: { type: "by-level" } });
  });

  it("transcribes the Wizard's spellcasting columns against the rules-engine slot table", () => {
    const wizard = classes.find((entry) => entry.id === "wizard")!;
    expect(wizard.hitDie).toBe("d6");
    expect(wizard.spellcasting).toEqual({ ability: "int", prepares: "prepared", ritual: true, focus: "arcane-focus", multiclassProgression: "full", spellListId: "wizard" });
    for (const row of wizard.levelTable) {
      expect(row.spellSlots, `wizard level ${row.level}`).toEqual([...FULL_CASTER_SLOTS[row.level - 1]]);
      expect(row.spellSlots, `wizard level ${row.level}`).toEqual([...spellSlotsForClass("wizard", row.level)]);
    }
    expect(wizard.levelTable[0].cantripsKnown).toBe(3);
    expect(wizard.levelTable[3].cantripsKnown).toBe(4);
    expect(wizard.levelTable[9].cantripsKnown).toBe(5);
    expect(wizard.levelTable[0].preparedCount).toBe(4);
    expect(wizard.levelTable[19].preparedCount).toBe(25);
  });

  it("links every subclass to a class that exists and gates it at a real level", () => {
    const classIds = new Set(classes.map((entry) => entry.id));
    for (const subclass of subclasses) {
      expect(classIds, subclass.id).toContain(subclass.classId);
      const parent = classes.find((entry) => entry.id === subclass.classId)!;
      expect(subclass.subclassLevel ?? parent.subclassLevel).toBe(parent.subclassLevel);
      for (const feature of subclass.features) expect(feature.level, `${subclass.id}/${feature.id}`).toBeGreaterThanOrEqual(parent.subclassLevel);
    }
    expect(subclassesForClass("fighter").map((subclass) => subclass.id)).toEqual(["champion"]);
    expect(subclassesForClass("wizard").map((subclass) => subclass.id)).toEqual(["evoker"]);
    expect(subclassesForClass("barbarian")).toEqual([]);
  });

  it("models species without hardcoded ability bonuses (SRD 5.2.1 puts them on backgrounds)", () => {
    for (const entry of species) {
      expect(entry.abilityBonuses, entry.id).toEqual([]);
      expect(entry.speedFeet, entry.id).toBeGreaterThan(0);
      expect(entry.sizes.length, entry.id).toBeGreaterThan(0);
    }
    const elf = species.find((entry) => entry.id === "elf")!;
    expect(elf.darkvisionFeet).toBe(60);
    expect(elf.lineages.map((lineage) => lineage.id)).toEqual(["drow", "high-elf", "wood-elf"]);
    expect(elf.lineages.find((lineage) => lineage.id === "drow")!.traits[0].modifiers).toEqual([{ type: "darkvision", feet: 120 }]);
    const human = species.find((entry) => entry.id === "human")!;
    expect(human.darkvisionFeet).toBeNull();
    // Human's whole identity is choices, exactly as the SRD prints it.
    expect(human.traits.filter((trait) => trait.choice).map((trait) => trait.choice!.kind)).toEqual(["skill", "feat"]);
    // The bonus SHAPE still exists for 2014-style and homebrew species.
    const homebrew = SpeciesReferenceSchema.parse({
      id: "moon-touched", name: "Moon-Touched", source: "homebrew", speedFeet: 30,
      abilityBonuses: [{ ability: "wis", amount: 2 }, { ability: "cha", amount: 1 }],
      abilityBonusChoice: { choose: 1, amount: 1, from: ["int", "wis"] }
    });
    expect(homebrew.source).toBe("homebrew");
    expect(homebrew.abilityBonuses).toHaveLength(2);
    expect(homebrew.sizes).toEqual(["medium"]);
    expect(homebrew.darkvisionFeet).toBeNull();
  });

  it("gives every background ability options, an origin feat that exists, and equipment", () => {
    const featIds = new Set(feats.map((feat) => feat.id));
    for (const background of backgrounds) {
      expect(background.abilityOptions?.from.length, background.id).toBe(3);
      expect(background.abilityOptions?.spreads, background.id).toEqual([[2, 1], [1, 1, 1]]);
      expect(featIds, background.id).toContain(background.originFeatId!);
      expect(background.startingEquipment.length, background.id).toBeGreaterThan(0);
    }
    const soldier = backgrounds.find((background) => background.id === "soldier")!;
    expect(soldier.skillProficiencies).toEqual(["athletics", "intimidation"]);
    expect(soldier.originFeatId).toBe("savage-attacker");
    expect(soldier.startingEquipment.at(-1)).toMatchObject({ items: [], goldPieces: 50 });
  });

  it("makes a feat literally a FeatureRecord plus catalog metadata", () => {
    for (const feat of feats) {
      expect(FeatureRecordSchema.safeParse(feat.feature).success, feat.id).toBe(true);
      expect(feat.category, feat.id).toMatch(/^[a-z0-9-]+$/);
    }
    const tough = feats.find((feat) => feat.id === "tough")!;
    expect(tough.feature.modifiers).toEqual([{ type: "hit-points-per-level", amount: 2 }]);
    const savage = feats.find((feat) => feat.id === "savage-attacker")!;
    expect(savage.feature.uses).toMatchObject({ limit: 1, per: "turn" });
  });

  it("carries per-species name pools for the random generator", () => {
    expect(names.map((pool) => pool.speciesId).sort()).toEqual(["elf", "human"]);
    const speciesIds = new Set(species.map((entry) => entry.id));
    for (const pool of names) {
      expect(speciesIds, pool.speciesId).toContain(pool.speciesId);
      for (const list of pool.pools) expect(list.names.length, `${pool.speciesId}/${list.id}`).toBeGreaterThanOrEqual(10);
    }
    expect(namesForSpecies("elf")!.pools.map((list) => list.id)).toEqual(["elf-given", "elf-family", "elf-child"]);
    expect(namesForSpecies("dragonborn")).toBeUndefined();
  });

  it("keeps every authored dice formula parseable by the authoritative grammar", () => {
    const everyFeature = [
      ...classes.flatMap((entry) => entry.features),
      ...subclasses.flatMap((entry) => entry.features),
      ...species.flatMap((entry) => [...entry.traits, ...entry.lineages.flatMap((lineage) => lineage.traits)]),
      ...backgrounds.flatMap((entry) => entry.features),
      ...feats.map((feat) => feat.feature)
    ];
    expect(everyFeature.length).toBeGreaterThan(30);
    for (const feature of everyFeature) {
      for (const action of feature.actions) {
        for (const part of action.damage) expect(() => parseDiceFormula(part.formula), `${feature.id}/${action.id}`).not.toThrow();
        for (const part of action.damageByLevel ?? []) expect(() => parseDiceFormula(part.formula), `${feature.id}/${action.id}`).not.toThrow();
      }
    }
    // Dice-valued class resources (Sneak Attack style) must parse too.
    for (const entry of classes) for (const row of entry.levelTable) for (const resource of row.classResources) {
      if (typeof resource.amount === "string") expect(() => parseDiceFormula(resource.amount as string), `${entry.id}/${resource.id}`).not.toThrow();
    }
  });

  it("cross-references content ids against the catalogs that already exist", () => {
    const skillIds = new Set(loadSkills().map((skill) => skill.id));
    const equipmentIds = new Set(loadEquipment().map((item) => item.id));
    for (const entry of classes) {
      for (const skillId of entry.skillChoices.from) expect(skillIds, `${entry.id} skill ${skillId}`).toContain(skillId);
      for (const option of entry.startingEquipment) for (const item of option.items) {
        expect(equipmentIds, `${entry.id} equipment ${item.id}`).toContain(item.id);
      }
    }
    for (const background of backgrounds) for (const skillId of background.skillProficiencies) {
      expect(skillIds, `${background.id} skill ${skillId}`).toContain(skillId);
    }
  });
});

describe("content-record schema guards", () => {
  const fighter = loadClasses().find((entry) => entry.id === "fighter")!;

  it("rejects a level table that is not exactly twenty ordered rows", () => {
    const short = { ...structuredClone(fighter), levelTable: structuredClone(fighter).levelTable.slice(0, 19) };
    expect(ClassReferenceSchema.safeParse(short).success).toBe(false);
    const misordered = structuredClone(fighter);
    [misordered.levelTable[3], misordered.levelTable[4]] = [misordered.levelTable[4], misordered.levelTable[3]];
    const result = ClassReferenceSchema.safeParse(misordered);
    expect(result.success).toBe(false);
    expect(!result.success && JSON.stringify(result.error.issues)).toContain("must be level");
  });

  it("rejects a level table that grants a feature nobody authored", () => {
    const dangling = structuredClone(fighter);
    dangling.levelTable[6].features = ["mystery-feature"];
    const result = ClassReferenceSchema.safeParse(dangling);
    expect(result.success).toBe(false);
    expect(!result.success && JSON.stringify(result.error.issues)).toContain("unknown feature");
  });

  it("keeps identity ids open slugs, so homebrew needs no schema change", () => {
    const homebrew = structuredClone(fighter) as Record<string, any>;
    homebrew.id = "moon-warden";
    homebrew.name = "Moon Warden";
    homebrew.source = "homebrew";
    homebrew.skillChoices = { choose: 2, from: ["moon-lore", "tide-reading"] };
    homebrew.armorProficiencies = ["moonplate"];
    homebrew.features = [...homebrew.features, { id: "lunar-boon", name: "Lunar Boon", level: 6, description: "A brand-new kind of feature.", choice: { kind: "lunar-boon", choose: 1, fromCatalog: "lunar-boons" } }];
    homebrew.levelTable[5].features = ["lunar-boon"];
    const parsed = ClassReferenceSchema.safeParse(homebrew);
    expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(parsed.success && parsed.data.source).toBe("homebrew");
  });

  it("defaults `source` to srd and requires a bounded feature-uses rule", () => {
    const minimal = NamePoolReferenceSchema.parse({ speciesId: "dwarf", pools: [{ id: "dwarf-given", label: "Given", names: ["Adrik"] }] });
    expect(minimal.source).toBe("srd");
    // A uses block with neither a flat limit nor a scaling rule is meaningless and rejected.
    expect(FeatureRecordSchema.safeParse({ id: "x", name: "X", description: "d", uses: { per: "long-rest" } }).success).toBe(false);
    expect(FeatureRecordSchema.safeParse({ id: "x", name: "X", description: "d", uses: { per: "long-rest", limit: 3 } }).success).toBe(true);
    expect(FeatureRecordSchema.safeParse({ id: "x", name: "X", description: "d", uses: { per: "long-rest", scaling: { type: "proficiency-bonus" } } }).success).toBe(true);
    // A choice with neither an explicit list nor a catalog is rejected the same way.
    expect(FeatureRecordSchema.safeParse({ id: "x", name: "X", description: "d", choice: { kind: "skill" } }).success).toBe(false);
  });

  it("accepts a feature carrying the full rider vocabulary (actions, effects, grants, modifiers)", () => {
    const rich = FeatureRecordSchema.parse({
      id: "rage", name: "Rage", level: 1,
      description: "You enter a rage as a Bonus Action.",
      tags: ["rage"],
      actions: [{
        id: "rage", name: "Rage", activation: "bonus-action", description: "Enter a rage.",
        damage: [{ formula: "2d6", type: "force" }],
        damageByLevel: [{ level: 1, formula: "2d6", type: "force" }, { level: 9, formula: "3d6", type: "force" }],
        attack: { ability: "str", reachFeet: 5 },
        save: { ability: "con", dc: "spellcasting" },
        uses: { limit: 1, per: "turn" }
      }],
      effects: [{ tags: ["raging"], duration: { type: "rounds", rounds: 10 }, modifiers: [{ type: "damage-bonus", amount: 2, appliesTo: "melee" }, { type: "damage-resistance", damageTypes: ["bludgeoning", "piercing", "slashing"] }] }],
      uses: { per: "long-rest", scaling: { type: "by-level", table: [{ level: 1, limit: 2 }, { level: 3, limit: 3 }] } },
      grants: { skills: ["athletics"], languages: ["giant"], saves: ["str"], spells: [{ id: "guidance", level: 0 }] },
      modifiers: [{ type: "unarmored-defense", ability: "con" }, { type: "speed", amount: 10 }]
    });
    // Defaults fill in so consumers can read unconditionally.
    expect(rich.actions[0].attack).toEqual({ ability: "str", proficient: true, reachFeet: 5 });
    expect(rich.grants!.tools).toEqual([]);
    expect(rich.grants!.spells[0]).toEqual({ id: "guidance", level: 0, alwaysPrepared: true });
    expect(rich.modifiers[0]).toEqual({ type: "unarmored-defense", ability: "con", allowShield: false });
    expect(rich.effects[0].target).toBe("self");
  });
});
