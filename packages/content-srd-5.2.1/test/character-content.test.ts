import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { parseDiceFormula } from "@vtt/rules-5e";
import {
  FULL_CASTER_SLOTS, asiLevelsFor, hitDieFor, meetsMulticlassPrerequisites, proficiencyBonusForLevel,
  spellSlotsForClass, statPriorityFor
} from "@vtt/rules-5e";
import {
  ClassReferenceSchema, EquipmentReferenceSchema, FeatReferenceSchema, FeatureChoiceSchema, FeatureModifierSchema,
  FeatureRecordSchema, NamePoolReferenceSchema, RiderWhenSchema, SpeciesReferenceSchema,
  loadBackgrounds, loadClasses, loadDamageTypes, loadEquipment, loadFeats, loadLanguages, loadNames, loadSkills,
  loadSpecies, loadSpells, loadSubclasses, namesForSpecies, riderLayer, subclassesForClass,
  type FeatureRecord
} from "../src/index.js";

/**
 * Phase-2 state: Fighter, Wizard, and Cleric are complete 20-level transcriptions; all nine SRD
 * 5.2.1 species, all four backgrounds, and the full feat chapter are authored. The assertions below
 * cover shape/integrity AND per-class/per-species golden transcription checks (task-packet risk 2:
 * transcription errors ship as rules bugs, so snapshot the printed numbers here).
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
    // FULL six-ability fixtures, so multi-ability prerequisites (Paladin/Monk/Ranger style) are
    // actually exercised - a fixture that only raises `statPriority[0]` cannot catch them.
    const flatEight = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 } as const;
    for (const entry of classes) {
      expect(entry.hitDie, entry.id).toBe(hitDieFor(entry.id));
      expect(entry.statPriority, entry.id).toEqual(statPriorityFor(entry.id));
      expect(entry.asiLevels, entry.id).toEqual(asiLevelsFor(entry.id));
      // Content and code must not disagree about who can multiclass into what: raising exactly the
      // bundle-declared minimums must satisfy the engine, and a flat-8 sheet must not.
      const qualified: Record<string, number> = { ...flatEight };
      for (const minimum of entry.multiclassPrerequisites?.minimums ?? []) qualified[minimum.ability] = minimum.minimum;
      expect(meetsMulticlassPrerequisites(qualified, entry.id), entry.id).toBe(true);
      if (entry.multiclassPrerequisites) expect(meetsMulticlassPrerequisites(flatEight, entry.id), `${entry.id} at flat 8s`).toBe(false);
    }
    // "all"-mode multi-ability prerequisites really require EVERY listed minimum (engine table, so
    // authoring Paladin/Monk/Ranger later cannot silently regress) ...
    expect(meetsMulticlassPrerequisites({ ...flatEight, str: 13 }, "paladin")).toBe(false);
    expect(meetsMulticlassPrerequisites({ ...flatEight, str: 13, cha: 13 }, "paladin")).toBe(true);
    expect(meetsMulticlassPrerequisites({ ...flatEight, dex: 13 }, "monk")).toBe(false);
    expect(meetsMulticlassPrerequisites({ ...flatEight, dex: 13, wis: 13 }, "monk")).toBe(true);
    // ... while "any"-mode accepts either minimum alone (Fighter: Strength 13 OR Dexterity 13).
    expect(meetsMulticlassPrerequisites({ ...flatEight, dex: 13 }, "fighter")).toBe(true);
    // The ASI levels are also exactly the levels whose table row grants the ASI feature.
    for (const entry of classes) {
      const asiRows = entry.levelTable.filter((row) => row.features.includes("ability-score-improvement")).map((row) => row.level);
      expect(asiRows, entry.id).toEqual(entry.asiLevels);
    }
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
    expect(fighter.features.find((feature) => feature.id === "extra-attack")!.modifiers).toEqual([{ type: "extra-attack", count: 1, when: [] }]);
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

  it("transcribes the Cleric faithfully (spot check)", () => {
    const cleric = classes.find((entry) => entry.id === "cleric")!;
    expect(cleric.hitDie).toBe("d8");
    expect(cleric.savingThrows).toEqual(["wis", "cha"]);
    expect(cleric.primaryAbilities).toEqual(["wis"]);
    expect(cleric.skillChoices).toEqual({ choose: 2, from: ["history", "insight", "medicine", "persuasion", "religion"] });
    expect(cleric.armorProficiencies).toEqual(["light", "medium", "shields"]);
    expect(cleric.weaponProficiencies).toEqual(["simple"]);
    expect(cleric.subclassLevel).toBe(3);
    expect(cleric.asiLevels).toEqual([4, 8, 12, 16]);
    expect(cleric.multiclassPrerequisites).toEqual({ mode: "all", minimums: [{ ability: "wis", minimum: 13 }] });
    // A multiclass Cleric keeps the armor training but gains no weapon proficiencies.
    expect(cleric.multiclassProficiencies).toEqual({ armor: ["light", "medium", "shields"], weapons: [], tools: [] });
    expect(cleric.spellcasting).toEqual({ ability: "wis", prepares: "prepared", ritual: true, focus: "holy-symbol", multiclassProgression: "full", spellListId: "cleric" });
    // The printed slot columns are exactly the shared full-caster table, row for row.
    for (const row of cleric.levelTable) {
      expect(row.spellSlots, `cleric level ${row.level}`).toEqual([...FULL_CASTER_SLOTS[row.level - 1]]);
      expect(row.spellSlots, `cleric level ${row.level}`).toEqual([...spellSlotsForClass("cleric", row.level)]);
    }
    // Cantrips 3 -> 4 (level 4) -> 5 (level 10); prepared spells 4 -> 22 with the printed plateaus.
    expect(cleric.levelTable.map((row) => row.cantripsKnown)).toEqual([3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]);
    expect(cleric.levelTable.map((row) => row.preparedCount)).toEqual([4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22]);
    // Channel Divinity rides the table as a class resource: none at 1, 2 uses at level 2, 3 at 6, 4 at 18.
    const channelAt = (level: number) => cleric.levelTable[level - 1].classResources.find((resource) => resource.id === "channel-divinity")?.amount;
    expect(channelAt(1)).toBeUndefined();
    expect(channelAt(2)).toBe(2);
    expect(channelAt(5)).toBe(2);
    expect(channelAt(6)).toBe(3);
    expect(channelAt(17)).toBe(3);
    expect(channelAt(18)).toBe(4);
    expect(channelAt(20)).toBe(4);
    // ... and the feature's own uses scale identically, owning the shared "channel-divinity" pool.
    const channel = cleric.features.find((feature) => feature.id === "channel-divinity")!;
    expect(channel.uses).toMatchObject({
      per: "long-rest", pool: "channel-divinity",
      scaling: { type: "by-level", table: [{ level: 2, limit: 2 }, { level: 6, limit: 3 }, { level: 18, limit: 4 }] }
    });
    expect(channel.actions.map((action) => action.id)).toEqual(["divine-spark", "turn-undead"]);
    expect(channel.actions[1].save).toEqual({ ability: "wis", dc: "spellcasting" });
    // Divine Order is a level-1 CHOICE between the two printed sacred roles.
    const order = cleric.features.find((feature) => feature.id === "divine-order")!;
    expect(order.level).toBe(1);
    expect(order.choice).toMatchObject({ kind: "divine-order", choose: 1, from: ["protector", "thaumaturge"] });
    // Blessed Strikes offers its two printed options; Divine Intervention is 1/Long Rest from level 10.
    expect(cleric.features.find((feature) => feature.id === "blessed-strikes")!.choice).toMatchObject({ from: ["divine-strike", "potent-spellcasting"] });
    expect(cleric.features.find((feature) => feature.id === "divine-intervention")!.uses).toEqual({ limit: 1, per: "long-rest" });
    // Feature rows match the printed table (levels 6 and 17 are subclass-feature rows, so empty here).
    const featuresAt = (level: number) => cleric.levelTable[level - 1].features;
    expect(featuresAt(1)).toEqual(["spellcasting", "divine-order"]);
    expect(featuresAt(2)).toEqual(["channel-divinity"]);
    expect(featuresAt(5)).toEqual(["sear-undead"]);
    expect(featuresAt(6)).toEqual([]);
    expect(featuresAt(7)).toEqual(["blessed-strikes"]);
    expect(featuresAt(14)).toEqual(["improved-blessed-strikes"]);
    expect(featuresAt(17)).toEqual([]);
    expect(featuresAt(19)).toEqual(["epic-boon"]);
    expect(featuresAt(20)).toEqual(["greater-divine-intervention"]);
    // Starting equipment resolves against the catalog and keeps the printed 110 GP fallback.
    expect(cleric.startingEquipment.map((option) => option.id)).toEqual(["cleric-a", "cleric-b"]);
    expect(cleric.startingEquipment[0].items.map((item) => item.id)).toEqual(["chain-shirt", "shield", "mace", "holy-symbol-amulet", "priests-pack"]);
    expect(cleric.startingEquipment[0].goldPieces).toBe(7);
    expect(cleric.startingEquipment[1]).toMatchObject({ items: [], goldPieces: 110 });
  });

  it("transcribes the Life Domain faithfully (spot check)", () => {
    const life = subclasses.find((entry) => entry.id === "life-domain")!;
    expect(life.classId).toBe("cleric");
    expect(life.subclassLevel).toBe(3);
    expect(life.features.map((feature) => [feature.id, feature.level])).toEqual([
      ["life-domain-spells", 3], ["life-domain-spells-5", 5], ["life-domain-spells-7", 7], ["life-domain-spells-9", 9],
      ["disciple-of-life", 3], ["preserve-life", 3], ["blessed-healer", 6], ["supreme-healing", 17]
    ]);
    // Domain spells are always-prepared grants, staged at the printed Cleric levels.
    const grantsAt = (id: string) => life.features.find((feature) => feature.id === id)!.grants!.spells.map((spell) => spell.id);
    expect(grantsAt("life-domain-spells")).toEqual(["aid", "bless", "cure-wounds", "lesser-restoration"]);
    expect(grantsAt("life-domain-spells-5")).toEqual(["mass-healing-word", "revivify"]);
    expect(grantsAt("life-domain-spells-7")).toEqual(["aura-of-life", "death-ward"]);
    expect(grantsAt("life-domain-spells-9")).toEqual(["greater-restoration", "mass-cure-wounds"]);
    for (const feature of life.features) for (const spell of feature.grants?.spells ?? []) {
      expect(spell.alwaysPrepared, `${feature.id}/${spell.id}`).toBe(true);
    }
    // Preserve Life spends from the same Channel Divinity pool the class feature owns.
    expect(life.features.find((feature) => feature.id === "preserve-life")!.uses).toEqual({ limit: 1, per: "long-rest", pool: "channel-divinity" });
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
    expect(subclassesForClass("cleric").map((subclass) => subclass.id)).toEqual(["life-domain"]);
    // SRD 5.2.1 prints exactly one subclass per class, so every class must offer exactly one - a
    // class with none is an unfinishable wizard step, and this used to assert `barbarian` had zero.
    for (const entry of classes) expect(subclassesForClass(entry.id).length, entry.id).toBe(1);
  });

  it("gates Champion's features at the SRD 5.2.1 levels, not the 2014 ones", () => {
    // This shipped wrong: the record carried 2024 feature TEXT at 2014 feature LEVELS - Remarkable
    // Athlete at 7 and Additional Fighting Style at 10 are the old progression - and Heroic Warrior
    // was missing entirely. Nothing caught it because the generator's cross-check covered
    // class-level data only. It covers subclass features now; this pins it for the test suite too,
    // which is what runs in CI.
    const champion = subclassesForClass("fighter")[0];
    expect(champion.features.map((feature) => [feature.id, feature.level])).toEqual([
      ["improved-critical", 3],
      ["remarkable-athlete", 3],
      ["additional-fighting-style", 7],
      ["heroic-warrior", 10],
      ["superior-critical", 15],
      ["survivor", 18]
    ]);
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
    expect(elf.lineages.find((lineage) => lineage.id === "drow")!.traits[0].modifiers).toEqual([{ type: "darkvision", feet: 120, when: [] }]);
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

  it("carries all nine SRD 5.2.1 species with the printed size, speed, and darkvision", () => {
    const expected: Record<string, { sizes: string[]; speed: number; darkvision: number | null }> = {
      dragonborn: { sizes: ["medium"], speed: 30, darkvision: 60 },
      dwarf: { sizes: ["medium"], speed: 30, darkvision: 120 },
      elf: { sizes: ["medium"], speed: 30, darkvision: 60 },
      gnome: { sizes: ["small"], speed: 30, darkvision: 60 },
      goliath: { sizes: ["medium"], speed: 35, darkvision: null },
      halfling: { sizes: ["small"], speed: 30, darkvision: null },
      human: { sizes: ["small", "medium"], speed: 30, darkvision: null },
      orc: { sizes: ["medium"], speed: 30, darkvision: 120 },
      tiefling: { sizes: ["small", "medium"], speed: 30, darkvision: 60 }
    };
    expect(species.map((entry) => entry.id).sort()).toEqual(Object.keys(expected).sort());
    for (const entry of species) {
      const want = expected[entry.id];
      expect(entry.sizes, entry.id).toEqual(want.sizes);
      expect(entry.speedFeet, entry.id).toBe(want.speed);
      expect(entry.darkvisionFeet, entry.id).toBe(want.darkvision);
      // A species-level darkvision range is always backed by a structured trait modifier (and a
      // species without darkvision must not smuggle one in).
      const modifierFeet = entry.traits.flatMap((trait) => trait.modifiers.flatMap((modifier) => modifier.type === "darkvision" ? [modifier.feet] : []));
      expect(modifierFeet, entry.id).toEqual(want.darkvision === null ? [] : [want.darkvision]);
    }
  });

  it("transcribes the new species' trait riders faithfully (spot checks)", () => {
    const byId = (id: string) => species.find((entry) => entry.id === id)!;
    // Dwarf: poison resistance, the +1 HP/level rider, and PB-scaling Stonecunning.
    const dwarf = byId("dwarf");
    expect(dwarf.traits.find((trait) => trait.id === "dwarf-resilience")!.grants!.damageResistances).toEqual(["poison"]);
    expect(dwarf.traits.find((trait) => trait.id === "dwarf-toughness")!.modifiers).toEqual([{ type: "hit-points-per-level", amount: 1, when: [] }]);
    expect(dwarf.traits.find((trait) => trait.id === "dwarf-stonecunning")!.uses).toMatchObject({ per: "long-rest", scaling: { type: "proficiency-bonus" } });
    // Dragonborn: ten ancestries, each granting the printed damage resistance as data.
    const dragonborn = byId("dragonborn");
    const resistances = Object.fromEntries(dragonborn.lineages.map((lineage) => [lineage.id, lineage.traits[0].grants!.damageResistances[0]]));
    expect(resistances).toEqual({
      "black-dragon": "acid", "blue-dragon": "lightning", "brass-dragon": "fire", "bronze-dragon": "lightning",
      "copper-dragon": "acid", "gold-dragon": "fire", "green-dragon": "poison", "red-dragon": "fire",
      "silver-dragon": "cold", "white-dragon": "cold"
    });
    // Breath Weapon's MECHANICS ride the lineage (only the ancestry knows the damage type), exactly
    // as Damage Resistance already does; the species-level trait stays the printed prose.
    const speciesBreath = dragonborn.traits.find((trait) => trait.id === "dragonborn-breath-weapon")!;
    expect(speciesBreath.actions).toEqual([]);
    expect(speciesBreath.uses).toBeUndefined();
    expect(dragonborn.lineages.find((lineage) => lineage.id === "white-dragon")!.traits.find((trait) => trait.id === "white-dragon-breath")!.uses)
      .toMatchObject({ per: "long-rest", pool: "breath-weapon", scaling: { type: "proficiency-bonus" } });
    expect(dragonborn.traits.find((trait) => trait.id === "dragonborn-draconic-flight")!.level).toBe(5);
    // Goliath: six ancestry boons behind one PB-per-Long-Rest choice; Large Form gates at level 5.
    const goliath = byId("goliath");
    const ancestry = goliath.traits.find((trait) => trait.id === "goliath-giant-ancestry")!;
    expect(ancestry.choice).toMatchObject({ kind: "giant-ancestry", choose: 1 });
    expect(ancestry.choice!.from).toEqual(["clouds-jaunt", "fires-burn", "frosts-chill", "hills-tumble", "stones-endurance", "storms-thunder"]);
    expect(ancestry.uses).toMatchObject({ per: "long-rest", scaling: { type: "proficiency-bonus" } });
    expect(goliath.traits.find((trait) => trait.id === "goliath-large-form")!.level).toBe(5);
    // Orc: Adrenaline Rush refreshes on a SHORT rest; Relentless Endurance is 1/Long Rest.
    const orc = byId("orc");
    expect(orc.traits.find((trait) => trait.id === "orc-adrenaline-rush")!.uses).toMatchObject({ per: "short-rest", scaling: { type: "proficiency-bonus" } });
    expect(orc.traits.find((trait) => trait.id === "orc-relentless-endurance")!.uses).toEqual({ limit: 1, per: "long-rest" });
    // Tiefling: three legacies, each granting a resistance + cantrip at 1 and spells at levels 3 and 5.
    const tiefling = byId("tiefling");
    expect(tiefling.lineages.map((lineage) => lineage.id)).toEqual(["abyssal", "chthonic", "infernal"]);
    for (const lineage of tiefling.lineages) {
      expect(lineage.traits.map((trait) => trait.level), lineage.id).toEqual([undefined, 3, 5]);
      expect(lineage.traits[0].grants!.damageResistances, lineage.id).toHaveLength(1);
      expect(lineage.traits[0].grants!.spells[0].level, lineage.id).toBe(0);
    }
    expect(tiefling.lineages.find((lineage) => lineage.id === "infernal")!.traits[0].grants!.spells[0].id).toBe("fire-bolt");
    expect(tiefling.traits.find((trait) => trait.id === "tiefling-otherworldly-presence")!.grants!.spells).toEqual([{ id: "thaumaturgy", level: 0, alwaysPrepared: true }]);
    // Gnome: two lineages; the Forest Gnome casts Speak with Animals PB times per Long Rest.
    const gnome = byId("gnome");
    expect(gnome.lineages.map((lineage) => lineage.id)).toEqual(["forest-gnome", "rock-gnome"]);
    expect(gnome.lineages[0].traits.find((trait) => trait.id === "forest-gnome-spell")!.uses).toMatchObject({ per: "long-rest", scaling: { type: "proficiency-bonus" } });
    // Halfling: the four printed prose traits, in print order.
    expect(byId("halfling").traits.map((trait) => trait.id)).toEqual(["halfling-brave", "halfling-nimbleness", "halfling-luck", "halfling-naturally-stealthy"]);
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
    // The soldier's gaming set points at REAL catalog ids (the seeded `dice-set` was a dangling id).
    expect(soldier.startingEquipment[0].items.map((item) => item.id)).toContain("gaming-set-dice");
    expect(soldier.toolChoices?.from).toEqual(["gaming-set-dice", "gaming-set-playing-cards"]);
    // Acolyte and Criminal complete the SRD 5.2.1 set of four.
    expect(backgrounds.map((background) => background.id).sort()).toEqual(["acolyte", "criminal", "sage", "soldier"]);
    const acolyte = backgrounds.find((background) => background.id === "acolyte")!;
    expect(acolyte.abilityOptions!.from).toEqual(["int", "wis", "cha"]);
    expect(acolyte.originFeatId).toBe("magic-initiate-cleric");
    expect(acolyte.skillProficiencies).toEqual(["insight", "religion"]);
    expect(acolyte.toolProficiencies).toEqual(["calligraphers-supplies"]);
    const criminal = backgrounds.find((background) => background.id === "criminal")!;
    expect(criminal.abilityOptions!.from).toEqual(["dex", "con", "int"]);
    expect(criminal.originFeatId).toBe("alert");
    expect(criminal.skillProficiencies).toEqual(["sleight-of-hand", "stealth"]);
    expect(criminal.toolProficiencies).toEqual(["thieves-tools"]);
    expect(criminal.startingEquipment[0].items.find((item) => item.id === "dagger")?.quantity).toBe(2);
  });

  it("makes a feat literally a FeatureRecord plus catalog metadata", () => {
    for (const feat of feats) {
      expect(FeatureRecordSchema.safeParse(feat.feature).success, feat.id).toBe(true);
      expect(feat.category, feat.id).toMatch(/^[a-z0-9-]+$/);
    }
    const savage = feats.find((feat) => feat.id === "savage-attacker")!;
    expect(savage.feature.uses).toMatchObject({ limit: 1, per: "turn" });
    // The ASI feat encodes "+2 to one score or +1 to two" as two repeatable +1 picks.
    const asi = feats.find((feat) => feat.id === "ability-score-improvement")!;
    expect(asi.category).toBe("general");
    expect(asi.prerequisite?.level).toBe(4);
    expect(asi.repeatable).toBe(true);
    expect(asi.feature.choice).toMatchObject({ kind: "ability-score", choose: 2, repeatable: true });
    expect(asi.feature.choice?.from).toEqual(["str", "dex", "con", "int", "wis", "cha"]);
  });

  it("carries the complete SRD 5.2.1 feat chapter, so every `<category>-feats` slug resolves non-empty", () => {
    const byCategory = (category: string) => feats.filter((feat) => feat.category === category).map((feat) => feat.id);
    expect(byCategory("origin")).toEqual(["alert", "magic-initiate-cleric", "magic-initiate-druid", "magic-initiate-wizard", "savage-attacker", "skilled"]);
    expect(byCategory("general")).toEqual(["ability-score-improvement", "grappler"]);
    expect(byCategory("fighting-style")).toEqual(["archery", "defense", "great-weapon-fighting", "two-weapon-fighting"]);
    expect(byCategory("epic-boon")).toEqual([
      "boon-of-combat-prowess", "boon-of-dimensional-travel", "boon-of-fate", "boon-of-irresistible-offense",
      "boon-of-spell-recall", "boon-of-the-night-spirit", "boon-of-truesight"
    ]);
    // SRD 5.2.1's feat chapter has NO Tough feat (PHB-2024-only); it must stay out of the srd source.
    expect(feats.some((feat) => feat.id === "tough")).toBe(false);
    // Fighting-style feats gate on the Fighting Style feature; every Epic Boon gates on level 19.
    for (const id of byCategory("fighting-style")) {
      expect(feats.find((feat) => feat.id === id)!.prerequisite?.requires, id).toEqual(["fighting-style"]);
    }
    for (const id of byCategory("epic-boon")) {
      expect(feats.find((feat) => feat.id === id)!.prerequisite?.level, id).toBe(19);
    }
    expect(feats.find((feat) => feat.id === "boon-of-spell-recall")!.prerequisite?.requires).toEqual(["spellcasting"]);
    // Boons restricted to specific scores say so as data; Grappler's "Str or Dex 13+" stays prose (the
    // feat-prerequisite shape has no any/all mode - see the schema-gap notes in the task report).
    expect(feats.find((feat) => feat.id === "boon-of-irresistible-offense")!.feature.choice?.from).toEqual(["str", "dex"]);
    expect(feats.find((feat) => feat.id === "boon-of-spell-recall")!.feature.choice?.from).toEqual(["int", "wis", "cha"]);
    expect(feats.find((feat) => feat.id === "grappler")!.prerequisite?.text).toContain("Strength or Dexterity 13+");
  });

  it("resolves every authored `fromCatalog` slug through the documented slug families", () => {
    const spells = loadSpells();
    const authored: Array<{ owner: string; slug: string }> = [];
    const collect = (owner: string, features: readonly { id: string; choice?: { fromCatalog?: string } }[]) => {
      for (const feature of features) {
        if (feature.choice?.fromCatalog) authored.push({ owner: `${owner}/${feature.id}`, slug: feature.choice.fromCatalog });
      }
    };
    for (const entry of classes) collect(entry.id, entry.features);
    for (const entry of subclasses) collect(entry.id, entry.features);
    for (const entry of species) {
      collect(entry.id, entry.traits);
      for (const lineage of entry.lineages) collect(`${entry.id}/${lineage.id}`, lineage.traits);
    }
    for (const entry of backgrounds) collect(entry.id, entry.features);
    collect("feats", feats.map((feat) => feat.feature));
    expect(authored.length).toBeGreaterThanOrEqual(15);
    const skillCount = loadSkills().length;
    const weaponCount = loadEquipment().filter((item) => item.category === "weapon").length;
    const toolCount = loadEquipment().filter((item) => item.category === "tool").length;
    const languages = loadLanguages();
    /**
     * Mirrors the resolver's slug grammar (packages/domain/src/catalog-choice.ts): every authored
     * slug must land in a family AND resolve to a non-empty option list, or a wizard step dead-ends.
     * Recursive, because the grammar has one combinator - `<a>-or-<b>` is the union of its parts, and
     * a union is legal as long as at least one part resolves.
     */
    const resolvesNonEmpty = (slug: string): boolean => {
      if (slug.includes("-or-")) {
        const parts = slug.split("-or-");
        return parts.every((part) => part.length > 0) && parts.some(resolvesNonEmpty);
      }
      if (slug === "skills") return skillCount > 0;
      if (slug === "weapons") return weaponCount > 0;
      if (slug === "tools") return toolCount > 0;
      if (slug === "languages") return languages.length > 0;
      if (slug.endsWith("-languages")) return languages.some((entry) => entry.table === slug.slice(0, -"-languages".length));
      if (slug.endsWith("-spells")) return spells.some((spell) => spell.classes.includes(slug.slice(0, -"-spells".length)));
      if (slug.endsWith("-subclasses")) return subclassesForClass(slug.slice(0, -"-subclasses".length)).length > 0;
      if (slug.endsWith("-feats")) return feats.some((feat) => feat.category === slug.slice(0, -"-feats".length));
      if (slug.endsWith("-lineages")) return (species.find((entry) => entry.id === slug.slice(0, -"-lineages".length))?.lineages.length ?? 0) > 0;
      return false;
    };
    for (const { owner, slug } of authored) {
      expect(resolvesNonEmpty(slug), `${owner}: fromCatalog "${slug}" matches no documented slug family, or resolves to nothing`).toBe(true);
    }
  });

  it("carries per-species name pools for the random generator", () => {
    expect(names.map((pool) => pool.speciesId).sort()).toEqual(
      ["dragonborn", "dwarf", "elf", "gnome", "goliath", "halfling", "human", "orc", "tiefling"]
    );
    const speciesIds = new Set(species.map((entry) => entry.id));
    for (const pool of names) {
      expect(speciesIds, pool.speciesId).toContain(pool.speciesId);
      for (const list of pool.pools) expect(list.names.length, `${pool.speciesId}/${list.id}`).toBeGreaterThanOrEqual(10);
    }
    // EVERY authored species has a pool; a species outside the SRD 5.2.1 roster does not.
    for (const entry of species) expect(namesForSpecies(entry.id), entry.id).toBeDefined();
    expect(namesForSpecies("elf")!.pools.map((list) => list.id)).toEqual(["elf-given", "elf-family", "elf-child"]);
    expect(namesForSpecies("dwarf")!.pools.map((list) => list.label)).toEqual(["Masculine", "Feminine", "Clan"]);
    expect(namesForSpecies("aasimar")).toBeUndefined();
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
      for (const toolId of entry.toolProficiencies) expect(equipmentIds, `${entry.id} tool ${toolId}`).toContain(toolId);
      for (const option of entry.startingEquipment) for (const item of option.items) {
        expect(equipmentIds, `${entry.id} equipment ${item.id}`).toContain(item.id);
      }
    }
    // SYMMETRIC on purpose: backgrounds get the same equipment/tool integrity classes get - the
    // seeded soldier's dangling `dice-set` id slipped through exactly this gap.
    for (const background of backgrounds) {
      for (const skillId of background.skillProficiencies) expect(skillIds, `${background.id} skill ${skillId}`).toContain(skillId);
      for (const toolId of background.toolProficiencies) expect(equipmentIds, `${background.id} tool ${toolId}`).toContain(toolId);
      for (const toolId of background.toolChoices?.from ?? []) expect(equipmentIds, `${background.id} tool choice ${toolId}`).toContain(toolId);
      for (const option of background.startingEquipment) for (const item of option.items) {
        expect(equipmentIds, `${background.id} equipment ${item.id}`).toContain(item.id);
      }
    }
  });

  it("cross-references every spell and damage-type grant against the spell and damage-type catalogs", () => {
    const spellById = new Map(loadSpells().map((spell) => [spell.id, spell]));
    const damageTypeIds = new Set(loadDamageTypes().map((type) => type.id));
    const everyFeature = [
      ...classes.flatMap((entry) => entry.features.map((feature) => ({ owner: entry.id, feature }))),
      ...subclasses.flatMap((entry) => entry.features.map((feature) => ({ owner: entry.id, feature }))),
      ...species.flatMap((entry) => [...entry.traits, ...entry.lineages.flatMap((lineage) => lineage.traits)].map((feature) => ({ owner: entry.id, feature }))),
      ...backgrounds.flatMap((entry) => entry.features.map((feature) => ({ owner: entry.id, feature }))),
      ...feats.map((feat) => ({ owner: feat.id, feature: feat.feature }))
    ];
    let spellGrants = 0;
    for (const { owner, feature } of everyFeature) {
      for (const grant of feature.grants?.spells ?? []) {
        spellGrants += 1;
        const spell = spellById.get(grant.id);
        expect(spell, `${owner}/${feature.id} grants unknown spell "${grant.id}"`).toBeDefined();
        // The authored spell level must agree with the catalog (a wrong level would mis-slot the grant).
        if (grant.level !== undefined) expect(grant.level, `${owner}/${feature.id} ${grant.id} level`).toBe(spell!.level);
      }
      for (const resistance of feature.grants?.damageResistances ?? []) {
        expect(damageTypeIds, `${owner}/${feature.id} resistance ${resistance}`).toContain(resistance);
      }
      for (const immunity of feature.grants?.damageImmunities ?? []) {
        expect(damageTypeIds, `${owner}/${feature.id} immunity ${immunity}`).toContain(immunity);
      }
    }
    // Coverage floor: the domain-spell tiers, the elf/gnome/tiefling lineages, and the racial cantrips.
    expect(spellGrants).toBeGreaterThanOrEqual(20);
  });

  it("gives every authored choice OPTION its printed mechanics (options are FeatureRecords, not bare ids)", () => {
    const cleric = classes.find((entry) => entry.id === "cleric")!;
    const optionsOf = (owner: { features?: readonly FeatureRecord[]; traits?: readonly FeatureRecord[] }, featureId: string) =>
      [...(owner.features ?? []), ...(owner.traits ?? [])].find((feature) => feature.id === featureId)!.choice!.options!;

    // Divine Order: Protector is Martial weapons + Heavy armor training, Thaumaturge is one extra
    // Cleric cantrip. Both were validated, written to the ledger, and then dropped on the floor.
    const order = optionsOf(cleric, "divine-order");
    expect(order.map((option) => option.id)).toEqual(["protector", "thaumaturge"]);
    const protector = order.find((option) => option.id === "protector")!;
    expect(protector.grants!.weapons).toEqual(["martial"]);
    expect(protector.grants!.armor).toEqual(["heavy"]);
    // A Protector Cleric's PROFICIENCIES are the class's plus the option's - the SRD's printed result.
    expect([...cleric.weaponProficiencies, ...protector.grants!.weapons]).toEqual(["simple", "martial"]);
    expect([...cleric.armorProficiencies, ...protector.grants!.armor]).toEqual(["light", "medium", "shields", "heavy"]);
    // Thaumaturge RAISES the Cleric cantrip budget rather than opening a pick of its own. The text
    // says "you know one EXTRA cantrip from the Cleric spell list" - one budget, one card, one number
    // - and a separate second-order choice was the only way to say it before `extraPicks` existed.
    // It also cannot be scoped as a choice in the general case ("your class's skill list" is not a
    // catalog slug), which is why the budget-raising form is the one Stage 4 authors against.
    const thaumaturge = order.find((option) => option.id === "thaumaturge")!;
    expect(thaumaturge.extraPicks).toEqual([{ offer: "class-cantrips", amount: 1 }]);
    expect(thaumaturge.choice).toBeUndefined();
    expect(thaumaturge.grants).toBeUndefined();
    // Protector raises nothing: the field is empty, not absent, so a reader never has to guard it.
    expect(protector.extraPicks).toEqual([]);

    // Blessed Strikes: Divine Strike is a once-per-turn rollable that grows 1d8 -> 2d8 at level 14.
    const strikes = optionsOf(cleric, "blessed-strikes");
    expect(strikes.map((option) => option.id)).toEqual(["divine-strike", "potent-spellcasting"]);
    const divineStrike = strikes[0];
    expect(divineStrike.uses).toEqual({ limit: 1, per: "turn", pool: "blessed-strikes" });
    expect(divineStrike.actions[0].damageByLevel).toEqual([
      { level: 7, formula: "1d8", type: "radiant" }, { level: 14, formula: "2d8", type: "radiant" }
    ]);
    // Potent Spellcasting is honest prose: "add your Wisdom modifier to cantrip damage" has no rider
    // in the bounded vocabulary (no ability-derived damage bonus), so it carries none (ADR-0008).
    expect(strikes[1].actions).toEqual([]);
    expect(strikes[1].modifiers).toEqual([]);

    // Giant Ancestry: all six boons carry their own action AND their own PB-per-Long-Rest counter on
    // one shared pool - the parent feature's `uses` alone had no action to ride and was dropped.
    const goliath = species.find((entry) => entry.id === "goliath")!;
    const boons = optionsOf(goliath, "goliath-giant-ancestry");
    expect(boons.map((option) => option.id)).toEqual(["clouds-jaunt", "fires-burn", "frosts-chill", "hills-tumble", "stones-endurance", "storms-thunder"]);
    for (const boon of boons) {
      expect(boon.actions.length, boon.id).toBe(1);
      expect(boon.uses, boon.id).toEqual({ per: "long-rest", pool: "giant-ancestry", scaling: { type: "proficiency-bonus" } });
    }
    expect(boons.map((boon) => [boon.id, boon.actions[0].activation])).toEqual([
      ["clouds-jaunt", "bonus-action"], ["fires-burn", "other"], ["frosts-chill", "other"],
      ["hills-tumble", "other"], ["stones-endurance", "reaction"], ["storms-thunder", "reaction"]
    ]);
    // The printed damage dice, per boon (the three boons the SRD prints without damage carry none).
    expect(Object.fromEntries(boons.map((boon) => [boon.id, boon.actions[0].damage.map((part) => `${part.formula} ${part.type}`)]))).toEqual({
      "clouds-jaunt": [], "fires-burn": ["1d10 fire"], "frosts-chill": ["1d6 cold"],
      "hills-tumble": [], "stones-endurance": [], "storms-thunder": ["1d8 thunder"]
    });

    // ONE vocabulary: an option is structurally a FeatureRecord, so the SAME interpreter reads both.
    for (const option of [...order, ...strikes, ...boons]) {
      const asFeature: FeatureRecord = option;
      expect(FeatureRecordSchema.safeParse(asFeature).success, option.id).toBe(true);
    }
  });

  it("keeps `choice.from` the canonical id list, derived from `options` (every existing consumer is untouched)", () => {
    const cleric = classes.find((entry) => entry.id === "cleric")!;
    const order = cleric.features.find((feature) => feature.id === "divine-order")!.choice!;
    expect(order.from).toEqual(["protector", "thaumaturge"]);
    expect(order.from).toEqual(order.options!.map((option) => option.id));
    const ancestry = species.find((entry) => entry.id === "goliath")!.traits.find((trait) => trait.id === "goliath-giant-ancestry")!.choice!;
    expect(ancestry.from).toEqual(["clouds-jaunt", "fires-burn", "frosts-chill", "hills-tumble", "stones-endurance", "storms-thunder"]);
    // Authoring the ids WITHOUT mechanics still works unchanged (back-compat for every other record).
    const legacy = FeatureRecordSchema.parse({ id: "x", name: "X", description: "d", choice: { kind: "skill", from: ["stealth", "arcana"] } });
    expect(legacy.choice!.from).toEqual(["stealth", "arcana"]);
    expect(legacy.choice!.options).toBeUndefined();
  });

  it("gives the Defense fighting style the +1 AC it only gets WHILE ARMORED", () => {
    const defense = feats.find((feat) => feat.id === "defense")!;
    expect(defense.category).toBe("fighting-style");
    expect(defense.feature.modifiers).toEqual([{ type: "armor-class", amount: 1, whileArmored: true, when: [] }]);
    // Every other SRD fighting style stays prose - none of the three has a modeled rider.
    for (const id of ["archery", "great-weapon-fighting", "two-weapon-fighting"]) {
      expect(feats.find((feat) => feat.id === id)!.feature.modifiers, id).toEqual([]);
    }
    // An unconditional +1 AC is still expressible and still means "always" (back-compat).
    const always = FeatureRecordSchema.parse({ id: "x", name: "X", description: "d", modifiers: [{ type: "armor-class", amount: 1 }] });
    expect(always.modifiers[0]).toEqual({ type: "armor-class", amount: 1, whileArmored: false, when: [] });
  });

  it("derives the Breath Weapon save DC from an ability, and gives it the printed damage", () => {
    const dragonborn = species.find((entry) => entry.id === "dragonborn")!;
    const expectedTypes: Record<string, string> = {
      "black-dragon": "acid", "blue-dragon": "lightning", "brass-dragon": "fire", "bronze-dragon": "lightning",
      "copper-dragon": "acid", "gold-dragon": "fire", "green-dragon": "poison", "red-dragon": "fire",
      "silver-dragon": "cold", "white-dragon": "cold"
    };
    for (const lineage of dragonborn.lineages) {
      const trait = lineage.traits.find((candidate) => candidate.id === `${lineage.id}-breath`)!;
      const action = trait.actions.find((candidate) => candidate.id === "breath-weapon")!;
      // DC 8 + Constitution modifier + Proficiency Bonus, as DATA - the target rolls Dexterity.
      expect(action.save, lineage.id).toEqual({ ability: "dex", dc: { base: 8, ability: "con", proficiencyBonus: true } });
      // 1d10, rising by 1d10 at character levels 5, 11, and 17 - in the ancestry's own damage type.
      const type = expectedTypes[lineage.id];
      expect(action.damage, lineage.id).toEqual([{ formula: "1d10", type }]);
      expect(action.damageByLevel, lineage.id).toEqual([
        { level: 1, formula: "1d10", type }, { level: 5, formula: "2d10", type },
        { level: 11, formula: "3d10", type }, { level: 17, formula: "4d10", type }
      ]);
      // The damage type agrees with the resistance the same ancestry grants.
      expect(lineage.traits[0].grants!.damageResistances, lineage.id).toEqual([type]);
    }
    // Divine Spark: a Channel Divinity save (the class's own spell save DC) AND the scaling damage.
    const spark = classes.find((entry) => entry.id === "cleric")!.features.find((feature) => feature.id === "channel-divinity")!
      .actions.find((action) => action.id === "divine-spark")!;
    expect(spark.save).toEqual({ ability: "con", dc: "spellcasting" });
    expect(spark.damage).toEqual([{ formula: "1d8", type: "radiant" }]);
    expect(spark.damageByLevel).toEqual([
      { level: 2, formula: "1d8", type: "radiant" }, { level: 7, formula: "2d8", type: "radiant" },
      { level: 13, formula: "3d8", type: "radiant" }, { level: 18, formula: "4d8", type: "radiant" }
    ]);
    // A flat printed DC and the spell-save DC both still parse (additive, back-compatible).
    const save = (dc: unknown) => FeatureRecordSchema.safeParse({
      id: "x", name: "X", description: "d",
      actions: [{ id: "a", name: "A", activation: "action", description: "d", save: { ability: "con", dc } }]
    }).success;
    expect(save("spellcasting")).toBe(true);
    expect(save(15)).toBe(true);
    expect(save({ ability: "wis" })).toBe(true);
    expect(save({ ability: "not-an-ability" })).toBe(false);
    expect(save({ base: 8 })).toBe(false);
  });

  it("carries the SRD ability column on every skill (raw bundle - a bundle rebuild must preserve it)", () => {
    const require = createRequire(import.meta.url);
    const raw = require("../bundles/skills.v1.json") as Array<{ id: string; ability?: string }>;
    expect(raw).toHaveLength(18);
    const byId = Object.fromEntries(raw.map((skill) => [skill.id, skill.ability]));
    expect(byId).toEqual({
      "acrobatics": "dex", "animal-handling": "wis", "arcana": "int", "athletics": "str", "deception": "cha",
      "history": "int", "insight": "wis", "intimidation": "cha", "investigation": "int", "medicine": "wis",
      "nature": "int", "perception": "wis", "performance": "cha", "persuasion": "cha", "religion": "int",
      "sleight-of-hand": "dex", "stealth": "dex", "survival": "wis"
    });
  });
});

/**
 * `2a` - every class presents its actual features. The observed symptom was Warlock's class step
 * reading "See the warlock class description in SRD 5.2.1."; the cause was a slug mismatch in the
 * ETL (`scripts/build-class-bundle.ts`, `featureProse`), which keyed `#### Level 1: Rage` under
 * `level-1-rage` while the level table asked for `rage`. **149 of 185** class features shipped the
 * stub - Monk 23/23, Barbarian 20/20, Rogue 19/19, Ranger 18/18, Paladin 18/18, Druid 14/14,
 * Warlock 13/13, Bard 13/13, Sorcerer 11/11 - and the prose was in the bundle source the whole time.
 *
 * The build now REFUSES to write a bundle containing one. This is the read-side half of that bar:
 * the build guards regeneration, this guards the committed artefact, and the two fail independently.
 */
describe("2a - no class or subclass feature falls back to a pointer at an external document", () => {
  const STUB = /^See the .* in SRD 5\.2\.1\.$/;
  const classes = loadClasses();
  const subclasses = loadSubclasses();

  it("has zero stub descriptions across every class and subclass feature", () => {
    const offenders = [
      ...classes.flatMap((record) => record.features.filter((f) => STUB.test(f.description)).map((f) => `${record.id}.${f.id}`)),
      ...subclasses.flatMap((record) => record.features.filter((f) => STUB.test(f.description)).map((f) => `${record.id}.${f.id}`))
    ];
    expect(offenders, `these features carry the SRD-pointer stub instead of prose:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("gives every feature real prose, not a placeholder", () => {
    // The floor is 40, not 60: `paladin.aura-expansion` is 51 characters and is the SRD's COMPLETE
    // printed text ("Your Aura of Protection is now a 30-foot Emanation."). A 60-character bar would
    // have failed on correct content, which is the wrong kind of test.
    for (const record of [...classes, ...subclasses]) {
      for (const feature of record.features) {
        expect(feature.description.length, `${record.id}.${feature.id} is ${feature.description.length} chars: "${feature.description}"`)
          .toBeGreaterThanOrEqual(40);
      }
    }
  });

  it("recovers the specific prose the report named, for the nine ETL-generated classes", () => {
    const proseOf = (classId: string, featureId: string) =>
      classes.find((record) => record.id === classId)!.features.find((feature) => feature.id === featureId)!.description;
    expect(proseOf("warlock", "pact-magic")).toContain("you have formed a pact with a mysterious entity");
    expect(proseOf("warlock", "eldritch-invocations")).toContain("pieces of forbidden knowledge");
    expect(proseOf("barbarian", "rage")).toContain("a primal power called Rage");
    expect(proseOf("monk", "martial-arts")).toContain("Unarmed Strike");
    expect(proseOf("rogue", "sneak-attack")).toContain("Sneak Attack");
    // Negative control: the three HAND_AUTHORED classes are skipped by the ETL and must be untouched.
    expect(proseOf("cleric", "channel-divinity")).toContain("Channel Divinity");
    expect(proseOf("wizard", "arcane-recovery")).toContain("regain some of your magical energy by studying your spellbook");
  });

  it("keys one printed heading onto the whole family the level table splits it into", () => {
    // Warlock's table grants four Mystic Arcanum slots (levels 11/13/15/17) under ONE heading.
    const warlock = classes.find((record) => record.id === "warlock")!;
    const arcana = warlock.features.filter((feature) => feature.id.startsWith("mystic-arcanum-"));
    expect(arcana.map((feature) => feature.level)).toEqual([11, 13, 15, 17]);
    for (const feature of arcana) expect(feature.description).toContain("a magical secret called an arcanum");
  });

  it('drops the table\'s "Subclass feature" reminder rows, as the hand-authored three already do', () => {
    // It is not a class feature: the SRD prints no heading for it, so it can carry no prose, and the
    // real feature is on the subclass record. Cleric's empty levels 6 and 17 are the oracle.
    for (const record of classes) {
      expect(record.features.map((feature) => feature.id), record.id).not.toContain("subclass-feature");
      for (const row of record.levelTable) expect(row.features, `${record.id} L${row.level}`).not.toContain("subclass-feature");
    }
    const barbarian = classes.find((record) => record.id === "barbarian")!;
    expect(barbarian.levelTable[5].features).toEqual([]); // level 6 printed "Subclass feature" alone
  });
});

/**
 * THE TWO STRUCTURAL BLOCKERS THE PRE-STAGE-4 AUDIT NAMED, held open from the read side.
 *
 * Both were invisible to every existing test: a subclass overlay that is never merged and a table
 * that is thrown away both produce records that PARSE, so only an assertion about the content itself
 * can tell the difference. These are the committed artefact's half - `build-class-bundle.ts` guards
 * regeneration, and the two fail independently.
 */
describe("the subclass authoring surface, and the tables the parser used to throw away", () => {
  const classes = loadClasses();
  const subclasses = loadSubclasses();
  // Readonly in BOTH dimensions: `loadClasses`/`loadSubclasses` return `readonly ClassReference[]`,
  // and a mutable parameter type made this helper uncallable with them - invisible while the package
  // did not typecheck `test/`.
  const featureOf = (records: readonly { id: string; features: readonly FeatureRecord[] }[], recordId: string, featureId: string) =>
    records.find((record) => record.id === recordId)!.features.find((feature) => feature.id === featureId)!;

  it("merges SUBCLASS_MECHANICS into an ETL-GENERATED subclass", () => {
    // Draconic Sorcery is generated (Sorcerer is not HAND_AUTHORED), so before the ETL imported
    // SUBCLASS_MECHANICS there was no way for this rider to exist at all. Champion / Evoker / Life
    // Domain are NOT the proof - their class is hand-authored and the whole record is copied through.
    const resilience = featureOf(subclasses, "draconic-sorcery", "draconic-resilience");
    // `allowShield` is authored `true` here, against the schema default - the printed sentence
    // restricts only wearing armor. `scripts/class-mechanics/sorcerer.ts` carries the argument.
    expect(resilience.modifiers).toEqual([{ type: "unarmored-defense", ability: "cha", allowShield: true, when: [] }]);
  });

  it("carries the spell tables of the four subclass spell features into their descriptions", () => {
    // Each of these used to end at the word "table", with the spells it promises nowhere in the
    // record - one truncation per subclass that grants spells by level.
    const draconic = featureOf(subclasses, "draconic-sorcery", "draconic-spells").description;
    expect(draconic).toContain("Sorcerer Level 3: Alter Self, Chromatic Orb, Command, Dragon's Breath");
    expect(draconic).toContain("Sorcerer Level 9: Legend Lore, Summon Dragon");
    expect(featureOf(subclasses, "fiend-patron", "fiend-spells").description).toContain("Warlock Level 5: Fireball, Stinking Cloud");
    expect(featureOf(subclasses, "oath-of-devotion", "oath-of-devotion-spells").description).toContain("Paladin Level 3: Protection from Evil and Good, Shield of Faith");
    const land = featureOf(subclasses, "circle-of-the-land", "circle-of-the-land-spells").description;
    for (const type of ["Arid Land", "Polar Land", "Temperate Land", "Tropical Land"]) expect(land).toContain(type);
    expect(land).toContain("Druid Level 9: Insect Plague");
  });

  it("carries a CLASS feature's table too - the same parser bug, one level up", () => {
    expect(featureOf(classes, "druid", "wild-shape").description).toContain("Druid Level 8: Known Forms 8, Max CR 1, Fly Speed Yes");
    expect(featureOf(classes, "sorcerer", "font-of-magic").description).toContain("Spell Slot Level 5: Sorcery Point Cost 7, Min. Sorcerer Level 9");
  });

  it("leaves no subclass spell feature ending on the word that introduced its table", () => {
    // The shape of the bug, not one instance of it: "...as shown in the X table." followed by nothing.
    const truncated = subclasses.flatMap((record) => record.features
      .filter((feature) => /\btables?\.?$/i.test(feature.description.trim()) || /\bSpells$/.test(feature.description.trim()))
      .map((feature) => `${record.id}.${feature.id}`));
    expect(truncated, `these descriptions stop at their table:\n  ${truncated.join("\n  ")}`).toEqual([]);
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

  it("rejects a choice whose option list is EMPTY rather than parsing into a downstream crash", () => {
    // `{from: []}` used to be schema-legal: it satisfied "has a `from`", then every consumer fell
    // through to `fromCatalog` - which is undefined - and died with a raw TypeError. An empty option
    // list is never "no options offered"; it is an authoring mistake, and it fails here, loudly.
    const empty = FeatureChoiceSchema.safeParse({ kind: "skill", from: [] });
    expect(empty.success).toBe(false);
    expect(!empty.success && JSON.stringify(empty.error.issues)).toContain("at least one option");
    expect(FeatureRecordSchema.safeParse({ id: "x", name: "X", description: "d", choice: { kind: "skill", from: [] } }).success).toBe(false);
    expect(FeatureRecordSchema.safeParse({ id: "x", name: "X", description: "d", choice: { kind: "skill", from: [], fromCatalog: "skills" } }).success).toBe(false);
    expect(FeatureChoiceSchema.safeParse({ kind: "x", options: [] }).success).toBe(false);
    // The fix is to OMIT the field, not to empty it.
    expect(FeatureChoiceSchema.safeParse({ kind: "skill", fromCatalog: "skills" }).success).toBe(true);
    // No authored record anywhere in the bundles smuggles one in.
    const everyChoice = [
      ...loadClasses().flatMap((entry) => entry.features),
      ...loadSubclasses().flatMap((entry) => entry.features),
      ...loadSpecies().flatMap((entry) => [...entry.traits, ...entry.lineages.flatMap((lineage) => lineage.traits)]),
      ...loadBackgrounds().flatMap((entry) => entry.features),
      ...loadFeats().map((feat) => feat.feature)
    ].flatMap((feature) => feature.choice ? [{ id: feature.id, choice: feature.choice }] : []);
    for (const { id, choice } of everyChoice) {
      expect(choice.from === undefined || choice.from.length > 0, `${id}: empty from`).toBe(true);
      for (const option of choice.options ?? []) {
        expect(option.choice?.from === undefined || option.choice.from.length > 0, `${id}/${option.id}: empty from`).toBe(true);
      }
    }
  });

  it("keeps ONE option vocabulary: `options` carry riders, exclude `from`, and nest only one level deep", () => {
    // An option is a FeatureRecord in all but name: same riders, same meanings, one interpreter.
    const parsed = FeatureRecordSchema.parse({
      id: "sacred-role", name: "Sacred Role", level: 1, description: "Choose a role.",
      choice: {
        kind: "sacred-role",
        options: [{
          id: "warden", name: "Warden", description: "You are trained for battle.",
          tags: ["martial"],
          grants: { weapons: ["martial"], armor: ["heavy"] },
          modifiers: [{ type: "armor-class", amount: 1, whileArmored: true }],
          actions: [{ id: "warden-strike", name: "Warden Strike", activation: "other", description: "Strike.", damage: [{ formula: "1d8", type: "radiant" }] }],
          effects: [{ tags: ["warded"], duration: { type: "encounter" } }],
          uses: { per: "long-rest", scaling: { type: "proficiency-bonus" } },
          choice: { kind: "cantrip", choose: 1, fromCatalog: "cleric-spells", maxSpellLevel: 0 }
        }]
      }
    });
    const option = parsed.choice!.options![0];
    // Defaults fill in identically to a FeatureRecord's, so a consumer reads both unconditionally.
    expect(option.actions[0].damage).toEqual([{ formula: "1d8", type: "radiant" }]);
    expect(option.effects[0].target).toBe("self");
    expect(option.modifiers[0]).toEqual({ type: "armor-class", amount: 1, whileArmored: true, when: [] });
    expect(option.grants!.skills).toEqual([]);
    const asFeature: FeatureRecord = option;
    expect(FeatureRecordSchema.safeParse(asFeature).success).toBe(true);
    // `from` is DERIVED, never co-authored - two lists could disagree, so only one is authorable.
    expect(parsed.choice!.from).toEqual(["warden"]);
    expect(FeatureChoiceSchema.safeParse({ kind: "k", from: ["warden"], options: [{ id: "warden", name: "W", description: "d" }] }).success).toBe(false);
    // Option ids are unique within one choice.
    expect(FeatureChoiceSchema.safeParse({ kind: "k", options: [{ id: "a", name: "A", description: "d" }, { id: "a", name: "A2", description: "d" }] }).success).toBe(false);
    // Depth is bounded at one: an option's own choice may not carry a further `options` list.
    expect(FeatureChoiceSchema.safeParse({
      kind: "k",
      options: [{ id: "a", name: "A", description: "d", choice: { kind: "n", options: [{ id: "b", name: "B", description: "d" }] } }]
    }).success).toBe(false);
    // An option still needs printed text - it lands on the sheet as a trait exactly like a feature.
    expect(FeatureChoiceSchema.safeParse({ kind: "k", options: [{ id: "a", name: "A" }] }).success).toBe(false);
    // Homebrew authors the identical record; nothing about the SRD's options is special-cased.
    expect(FeatureChoiceSchema.safeParse({
      kind: "moon-phase",
      options: [{ id: "waxing", name: "Waxing", description: "Homebrew.", modifiers: [{ type: "speed", amount: 10 }] }]
    }).success).toBe(true);
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
    expect(rich.modifiers[0]).toEqual({ type: "unarmored-defense", ability: "con", allowShield: false, when: [] });
    expect(rich.effects[0].target).toBe("self");
  });
});

/**
 * THE ACCEPTANCE TEST for the magic-item rider vocabulary: one fixture per criterion the product
 * owner actually asked for, parsed through the real schemas. A vocabulary that typechecks but
 * cannot express "an extra 1d6 fire on a critical hit" has failed, and only a fixture says so.
 *
 * Every item fixture goes through `EquipmentReferenceSchema`, which is `.strict()` - so a criterion
 * "passing" here means the exact authored keys were ACCEPTED, not silently dropped.
 */
describe("the magic-item vocabulary expresses what a GM asks for", () => {
  /** The three fields an equipment record requires but that say nothing about the criterion. */
  const bare = { costGp: null, weightLb: null, description: null } as const;
  const item = (patch: Record<string, unknown>) => EquipmentReferenceSchema.parse({ id: "hb-item", name: "Item", category: "wondrous", ...bare, ...patch });
  /** The same riders on a FEAT carrier - criterion 14 is only true if this parses the identical array. */
  const feat = (modifiers: readonly unknown[], patch: Record<string, unknown> = {}) =>
    FeatReferenceSchema.parse({ id: "hb-feat", name: "Feat", feature: { id: "hb-feat", name: "Feat", description: "The same riders, on a feat.", modifiers, ...patch } });

  const SHORTSWORD = { category: "martial", damageDice: "1d6", damageType: "piercing", rangeFeet: null, longRangeFeet: null } as const;
  const HALF_PLATE = { acBase: 15, addDexModifier: true, dexModifierCap: 2, stealthDisadvantage: true, strengthRequired: null } as const;

  it("1. a short sword of lightning: +1 to hit AND an extra 1d4 lightning", () => {
    const sword = item({
      id: "hb-shortsword-lightning", name: "Short Sword of Lightning", category: "weapon", slot: "weapon", isMagic: true, rarity: "uncommon", weapon: SHORTSWORD,
      modifiers: [
        { type: "attack-bonus", amount: 1, scope: "this-item" },
        { type: "extra-damage", formula: "1d4", damageType: "lightning", scope: "this-item" }
      ]
    });
    expect(sword.modifiers.map((modifier) => modifier.type)).toEqual(["attack-bonus", "extra-damage"]);
    // Both are STANDING riders on this weapon: no gate, so they are part of the weapon's own numbers.
    expect(sword.modifiers.every((modifier) => riderLayer(modifier.when) === "standing")).toBe(true);
    expect(feat(sword.modifiers).feature.modifiers).toHaveLength(2);
  });

  it("2. wands, orbs, potions, amulets, rings, cloaks, circlets and shields each have a slot", () => {
    const kinds = [["wand", "held"], ["orb", "held"], ["potion", "consumable"], ["amulet", "neck"], ["ring", "ring"], ["cloak", "shoulders"], ["circlet", "head"], ["shield", "shield"]] as const;
    for (const [category, slot] of kinds) {
      // `category` stays the OPEN identity slug; `slot` is the closed mechanical hook beside it.
      expect(item({ id: `hb-${category}`, name: category, category, slot }).slot, category).toBe(slot);
    }
  });

  it("3. a ring that increases Armour Class by 1", () => {
    const ring = item({ id: "hb-ring-protection", name: "Ring of Protection", category: "ring", slot: "ring", isMagic: true, attunement: { required: true }, modifiers: [{ type: "armor-class", amount: 1 }] });
    expect(ring.modifiers[0]).toMatchObject({ type: "armor-class", amount: 1, whileArmored: false });
    expect(ring.attunement).toEqual({ required: true, restrictedTo: [] });
  });

  it("4. an amulet that casts Message once per day while attuned", () => {
    const amulet = item({
      id: "hb-amulet-message", name: "Amulet of Whispers", category: "amulet", slot: "neck", isMagic: true,
      attunement: { required: true, restrictedTo: ["cleric"] },
      casts: [{ spellId: "message", uses: { limit: 1, per: "long-rest" } }]
    });
    // "Once per day" is a long rest: this app already treats a long rest as the day.
    expect(amulet.casts[0]).toMatchObject({ spellId: "message", consumesSpellSlot: false, uses: { limit: 1, per: "long-rest" } });
    // `restrictedTo` is advisory - it parses and displays, it never blocks.
    expect(amulet.attunement!.restrictedTo).toEqual(["cleric"]);
  });

  it("5. a cloak granting advantage on initiative", () => {
    const modifiers = [{ type: "roll-mode", roll: "initiative", mode: "advantage", when: [{ type: "attuned" }] }];
    const cloak = item({ id: "hb-cloak-quickness", name: "Cloak of Quickness", category: "cloak", slot: "shoulders", isMagic: true, attunement: { required: true }, modifiers });
    expect(cloak.modifiers[0]).toMatchObject({ type: "roll-mode", roll: "initiative", mode: "advantage" });
    expect(feat(modifiers).feature.modifiers[0]).toMatchObject({ type: "roll-mode", roll: "initiative" });
  });

  it("6. a shield granting a Paladin one more use of Lay on Hands", () => {
    const shield = item({
      id: "hb-shield-mercy", name: "Shield of Mercy", category: "shield", slot: "shield", isMagic: true, armor: { acBase: 2, addDexModifier: false, dexModifierCap: null, stealthDisadvantage: false, strengthRequired: null },
      modifiers: [{ type: "resource-bonus", poolId: "lay-on-hands", amount: 1, when: [{ type: "while-character-is", classIds: ["paladin"] }] }]
    });
    const rider = shield.modifiers[0];
    expect(rider).toMatchObject({ type: "resource-bonus", poolId: "lay-on-hands", amount: 1 });
    // A class gate is STATIC - resolvable from the sheet, so it shows as a real number, not a note.
    expect(riderLayer(rider.when)).toBe("standing");
  });

  it("7. a dagger granting advantage on OPPORTUNITY attacks specifically", () => {
    const dagger = item({
      id: "hb-dagger-riposte", name: "Dagger of Riposte", category: "weapon", slot: "weapon", isMagic: true,
      weapon: { category: "simple", damageDice: "1d4", damageType: "piercing", rangeFeet: 20, longRangeFeet: 60 },
      modifiers: [{ type: "roll-mode", roll: "attack", mode: "advantage", when: [{ type: "on-attack-roll" }, { type: "attack-kind-is", kinds: ["opportunity"] }] }]
    });
    // A moment plus a filter narrowing it - the only legal way to write "on opportunity attacks".
    expect(riderLayer(dagger.modifiers[0].when)).toBe("momentary");
    expect(dagger.modifiers[0].when.map((trigger) => trigger.type)).toEqual(["on-attack-roll", "attack-kind-is"]);
  });

  it("8. an amulet granting one extra 1st-level spell slot", () => {
    const amulet = item({ id: "hb-amulet-slots", name: "Amulet of the Adept", category: "amulet", slot: "neck", isMagic: true, attunement: { required: true }, modifiers: [{ type: "spell-slot", level: 1, amount: 1, when: [{ type: "attuned" }] }] });
    expect(amulet.modifiers[0]).toMatchObject({ type: "spell-slot", level: 1, amount: 1 });
  });

  it("9. a mace dealing an extra 1d6 fire ON A CRITICAL HIT", () => {
    const mace = item({
      id: "hb-mace-emberfall", name: "Emberfall", category: "weapon", slot: "weapon", isMagic: true,
      weapon: { category: "simple", damageDice: "1d6", damageType: "bludgeoning", rangeFeet: null, longRangeFeet: null },
      modifiers: [{ type: "extra-damage", formula: "1d6", damageType: "fire", when: [{ type: "on-critical-hit" }] }]
    });
    const rider = mace.modifiers[0];
    expect(rider).toMatchObject({ type: "extra-damage", formula: "1d6", damageType: "fire" });
    // 5e does not double dice added AFTER the attack, so the default is false and a GM opts in.
    expect(rider).toMatchObject({ doubleOnCritical: false });
    expect(riderLayer(rider.when)).toBe("momentary");
    // This is the typed case `critical-bonus-dice` deliberately cannot express: that one is a bare
    // untyped COUNT of extra weapon dice, and both exist because they are different things.
    expect(FeatureModifierSchema.parse({ type: "critical-bonus-dice", count: 2 })).toMatchObject({ count: 2 });
  });

  it("10. half-plate that raises the wearer's spell save DC", () => {
    const plate = item({ id: "hb-half-plate-sigils", name: "Sigil Half Plate", category: "armor", slot: "armor", isMagic: true, armor: HALF_PLATE, modifiers: [{ type: "spell-save-dc", amount: 1, classId: "wizard" }, { type: "spell-attack-bonus", amount: 1 }] });
    expect(plate.modifiers.map((modifier) => modifier.type)).toEqual(["spell-save-dc", "spell-attack-bonus"]);
  });

  it("11. a circlet granting proficiency OR expertise in a skill", () => {
    const proficient = item({ id: "hb-circlet-p", name: "Circlet of Insight", category: "circlet", slot: "head", isMagic: true, grants: { skills: ["arcana"] } });
    const expert = item({ id: "hb-circlet-e", name: "Circlet of Mastery", category: "circlet", slot: "head", isMagic: true, grants: { expertise: ["arcana"] } });
    expect(proficient.grants!.skills).toEqual(["arcana"]);
    expect(expert.grants!.expertise).toEqual(["arcana"]);
    // Same authored shape a feature uses - `FeatureGrantsSchema`, reused whole rather than restated.
    expect(proficient.grants!.tools).toEqual([]);
  });

  it("12. a shortbow granting a bonus AND/OR advantage on saving throws", () => {
    const bow = item({
      id: "hb-shortbow-warding", name: "Warding Shortbow", category: "weapon", slot: "weapon", isMagic: true,
      weapon: { category: "simple", damageDice: "1d6", damageType: "piercing", rangeFeet: 80, longRangeFeet: 320 },
      modifiers: [
        { type: "save-bonus", amount: 1 },
        { type: "roll-mode", roll: "save", mode: "advantage", when: [{ type: "on-saving-throw" }, { type: "ability-is", abilities: ["dex"] }] }
      ]
    });
    expect(bow.modifiers.map((modifier) => modifier.type)).toEqual(["save-bonus", "roll-mode"]);
    expect(riderLayer(bow.modifiers[0].when)).toBe("standing");
    expect(riderLayer(bow.modifiers[1].when)).toBe("momentary");
  });

  it("13. curses and debuffs - the same vocabulary with a negative number", () => {
    const cursed = item({
      id: "hb-cloak-weakness", name: "Cloak of Weakness", category: "cloak", slot: "shoulders", isMagic: true,
      cursed: true, attunement: { required: true },
      modifiers: [
        { type: "armor-class", amount: -2 },
        { type: "save-bonus", amount: -1 },
        { type: "attack-bonus", amount: -1 },
        { type: "roll-mode", roll: "attack", mode: "disadvantage", when: [{ type: "on-attack-roll" }] },
        { type: "extra-damage", formula: "1d4", damageType: "necrotic", when: [{ type: "on-taking-damage" }] }
      ]
    });
    expect(cursed.cursed).toBe(true);
    expect(cursed.modifiers).toHaveLength(5);
    // A curse you can drop by taking the hat off is not a curse: `cursed` REQUIRES attunement, so
    // the hiding boundary is exactly one thing - hidden until attuned, and nothing beyond that.
    const orphanCurse = EquipmentReferenceSchema.safeParse({ id: "hb-x", name: "X", category: "cloak", ...bare, cursed: true });
    expect(orphanCurse.success).toBe(false);
    expect(!orphanCurse.success && JSON.stringify(orphanCurse.error.issues)).toContain("must require attunement");
    expect(EquipmentReferenceSchema.safeParse({ id: "hb-x", name: "X", category: "cloak", ...bare, cursed: true, attunement: { required: false } }).success).toBe(false);
  });

  it("14. a FEAT carries every one of these riders, by construction rather than by duplication", () => {
    // The whole architectural bet: the new riders extend `FeatureModifierSchema`, which a feat's
    // `feature` already carries. A parallel item-only union would give items everything, feats
    // nothing, and the difference would be invisible until a GM authored the feat.
    const everyRider = [
      { type: "attack-bonus", amount: 1 },
      { type: "extra-damage", formula: "1d6", damageType: "fire", when: [{ type: "on-critical-hit" }] },
      { type: "roll-mode", roll: "save", mode: "advantage" },
      { type: "save-bonus", amount: 2 },
      { type: "check-bonus", amount: 2, when: [{ type: "on-ability-check" }, { type: "skill-is", skills: ["stealth"] }] },
      { type: "spell-save-dc", amount: 1 },
      { type: "spell-attack-bonus", amount: 1 },
      { type: "spell-slot", level: 3, amount: 1 }
    ];
    const secondHalf = [
      { type: "resource-bonus", poolId: "lay-on-hands", amount: 5 },
      { type: "critical-range", threshold: 19 },
      { type: "critical-bonus-dice", count: 1 },
      { type: "damage-reduction", amount: 3, when: [{ type: "on-taking-damage" }, { type: "damage-type-is", damageTypes: ["fire"] }] },
      { type: "sense", sense: "tremorsense", feet: 30 },
      { type: "armor-class", amount: 1, when: [{ type: "while-armored", weights: ["medium", "heavy"] }] },
      { type: "initiative", amount: 2 },
      { type: "speed", amount: 10, when: [{ type: "while-unarmored" }] }
    ];
    // Eight riders is the authored cap, so the proof runs in two records rather than one.
    expect(feat(everyRider).feature.modifiers).toHaveLength(8);
    expect(feat(secondHalf).feature.modifiers).toHaveLength(8);
    expect(item({ id: "hb-a", modifiers: everyRider }).modifiers).toHaveLength(8);
    expect(item({ id: "hb-b", modifiers: secondHalf }).modifiers).toHaveLength(8);
    // ...and the identical array parses on a chosen OPTION inside a choice, and on a plain feature.
    expect(FeatureRecordSchema.parse({ id: "f", name: "F", description: "d", modifiers: everyRider }).modifiers).toHaveLength(8);
    // 22 variants: the 8 that existed, the 3 shared with EffectModifierSchema, the 11 the
    // magic-item vocabulary added (`damage-bonus` - the "+1 weapon"'s damage half - is the 11th).
    expect(FeatureModifierSchema.options).toHaveLength(22);
  });

  it("15. an item that grants a feat", () => {
    const gauntlets = item({ id: "hb-gauntlets", name: "Gauntlets of the Bulwark", category: "hands", slot: "hands", isMagic: true, attunement: { required: true }, grantsFeatIds: ["shield-master"] });
    expect(gauntlets.grantsFeatIds).toEqual(["shield-master"]);
    // The grant edge is ONE-DIRECTIONAL: no feature, feat, or option has a `grants.items`, so a
    // cycle cannot be drawn rather than merely being checked for.
    expect(Object.keys(FeatureRecordSchema.parse({ id: "f", name: "F", description: "d", grants: {} }).grants!)).not.toContain("items");
  });

  // ---- the refusals, verified by injection ------------------------------------------------------

  it("refuses hit points and ability scores on an ITEM carrier only - a feat keeps both", () => {
    for (const modifier of [{ type: "hit-points-per-level", amount: 1 }, { type: "ability-score", ability: "str", amount: 2 }]) {
      const refused = EquipmentReferenceSchema.safeParse({ id: "hb-x", name: "X", category: "wondrous", ...bare, modifiers: [modifier] });
      expect(refused.success, modifier.type).toBe(false);
      expect(!refused.success && JSON.stringify(refused.error.issues), modifier.type).toContain("cannot change hit points or an ability score");
      // The SAME rider on a feat is fine, and must stay fine: a feat is granted once and never
      // un-granted, so baking it is correct. It is the CARRIER that makes this a refusal.
      expect(feat([modifier]).feature.modifiers, modifier.type).toHaveLength(1);
      expect(FeatureModifierSchema.safeParse(modifier).success, modifier.type).toBe(true);
    }
    // A flat `hit-points` maximum is not in the vocabulary at all, so it is refused one level
    // earlier - by the discriminated union - on every carrier including a feat.
    expect(FeatureModifierSchema.safeParse({ type: "hit-points", amount: 5 }).success).toBe(false);
  });

  it("keeps `when` an AND-list, not an expression language", () => {
    // Thirty triggers in four kinds, and the kind is what decides the evaluation layer.
    expect(riderLayer([])).toBe("standing");
    expect(riderLayer([{ type: "while-hp-at-or-below", percent: 50 }])).toBe("conditional");
    expect(riderLayer([{ type: "attuned" }, { type: "while-shield", wielding: true }])).toBe("standing");
    // At most four triggers.
    expect(RiderWhenSchema.safeParse([{ type: "attuned" }, { type: "while-shield" }, { type: "while-unarmored" }, { type: "on-hit" }, { type: "damage-type-is", damageTypes: ["fire"] }]).success).toBe(false);
    // A rider fires at ONE moment, not two.
    const twoMoments = RiderWhenSchema.safeParse([{ type: "on-hit" }, { type: "on-critical-hit" }]);
    expect(twoMoments.success).toBe(false);
    expect(!twoMoments.success && JSON.stringify(twoMoments.error.issues)).toContain("one moment, not two");
    // A filter with no moment is an authoring mistake, not "always".
    const orphanFilter = RiderWhenSchema.safeParse([{ type: "versus-size", sizes: ["large"] }]);
    expect(orphanFilter.success).toBe(false);
    expect(!orphanFilter.success && JSON.stringify(orphanFilter.error.issues)).toContain("needs a moment to narrow");
    // "Paladin or Cleric" is ONE trigger with two ids - never two triggers OR'd together.
    expect(RiderWhenSchema.safeParse([{ type: "while-character-is", classIds: ["paladin", "cleric"] }]).success).toBe(true);
    expect(RiderWhenSchema.safeParse([{ type: "while-character-is" }]).success).toBe(false);
    expect(RiderWhenSchema.safeParse([{ type: "while-character-is", classIds: ["paladin"] }, { type: "while-character-is", classIds: ["cleric"] }]).success).toBe(false);
    // There is no free text and no arithmetic: an unnamed trigger is simply not a trigger.
    expect(RiderWhenSchema.safeParse([{ type: "while-in-sunlight" }]).success).toBe(false);
    expect(RiderWhenSchema.safeParse([{ type: "while-hp-at-or-below", percent: 50, unless: "raging" }]).success).toBe(false);
  });

  it("still refuses an undeclared key on the one .strict() content record", () => {
    // The magic-item block is a LONGER LIST of declared keys, not a loosened schema.
    expect(EquipmentReferenceSchema.safeParse({ id: "hb-x", name: "X", category: "wondrous", ...bare, requiresAttunement: true }).success).toBe(false);
    expect(EquipmentReferenceSchema.safeParse({ id: "hb-x", name: "X", category: "wondrous", ...bare, slot: "backpack" }).success).toBe(false);
  });
});
