import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import character from "../../test-fixtures/actors/player-character.v1.json";
import monster from "../../test-fixtures/actors/monster.v1.json";
import torva from "../../test-fixtures/actors/torva-grimtusk.v1.json";
import pip from "../../test-fixtures/actors/pip-underbough.v1.json";
import sable from "../../test-fixtures/actors/sable-vex.v1.json";
import jsonSchema from "../json/actor-definition.v1.schema.json";
import { ActorDefinitionSchema, characterChoices, resolveSpellcasting } from "../src/index.js";

describe("actor definition v1", () => {
  const jsonValidate = new Ajv2020({ strict: false }).compile(jsonSchema);
  // The replay party carries every ADR-0020 mechanics field (grants, multiattack pools, uses,
  // criticalBonusDice) - validating them against BOTH schemas keeps the JSON twin from drifting.
  it.each([character, monster, torva, pip, sable])("accepts a representative fixture", (fixture) => {
    const parsed = ActorDefinitionSchema.safeParse(fixture);
    expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(jsonValidate(fixture), JSON.stringify(jsonValidate.errors)).toBe(true);
  });
  it("rejects unsafe or malformed dice input", () => {
    const invalid = structuredClone(monster); invalid.actions[0].damage[0].formula = "1d6; process.exit()";
    expect(ActorDefinitionSchema.safeParse(invalid).success).toBe(false); expect(jsonValidate(invalid)).toBe(false);
  });
  it("keeps character disposition safe", () => {
    const invalid = structuredClone(character); invalid.token.disposition = "hostile";
    expect(ActorDefinitionSchema.safeParse(invalid).success).toBe(false);
  });
  // The new character-sheet fields (class/proficiencies/spellcasting/inventory/currency) must parse
  // under BOTH schemas so the JSON twin can't drift from the Zod source.
  it("accepts a definition carrying the new character-sheet fields", () => {
    const withSheet = structuredClone(character) as Record<string, unknown>;
    withSheet.character = { classes: [{ id: "wizard", name: "Wizard", subclass: { id: "evocation", name: "Evocation" }, level: 5 }], race: { id: "human", name: "Human" }, background: { id: "sage", name: "Sage" }, feats: [{ id: "alert", name: "Alert" }] };
    withSheet.proficiencies = { saves: ["int", "wis"], skills: [{ id: "arcana", proficiency: "expertise" }, { id: "stealth", proficiency: "proficient" }], saveOverrides: { con: 4 } };
    withSheet.spellcasting = { ability: "int", slots: [{ level: 1, max: 4 }, { level: 2, max: 3 }], spells: [{ id: "magic-missile", name: "Magic Missile", level: 1, prepared: true, actionId: "magic-missile" }, { id: "shield", name: "Shield", level: 1, alwaysPrepared: true }] };
    withSheet.startingInventory = [{ id: "spellbook", name: "Spellbook", quantity: 1 }, { id: "dagger", name: "Dagger", quantity: 2, equipped: true }];
    withSheet.startingCurrency = { gp: 15, sp: 4 };
    const parsed = ActorDefinitionSchema.safeParse(withSheet);
    expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(jsonValidate(withSheet), JSON.stringify(jsonValidate.errors)).toBe(true);
  });

  // ---- character-builder deltas (task packet P1.2) ----------------------------------------------
  // Every field below is additive-optional with a default, so schemaVersion stays 1 (ADR-0007).

  /**
   * BACK-COMPAT PROOF. This literal is a definition exactly as it was persisted BEFORE the builder
   * deltas existed - no `choices`, no per-class `hitDie`, no per-class spellcasting, no proficiency
   * lists, no weapon `properties`. A stored GameState full of these must keep parsing, and the new
   * fields must materialize as empty defaults rather than errors.
   */
  const legacyDefinition = Object.freeze({
    schemaId: "vtt.actor-character", schemaVersion: 1,
    source: { name: "hand-authored", version: "1" },
    name: "Legacy Character", size: "medium",
    abilityScores: { str: 10, dex: 14, con: 12, int: 17, wis: 11, cha: 8 },
    proficiencyBonus: 3, armorClass: 12, hitPoints: { maximum: 27, formula: "5d6 + 5" }, speedFeet: 30,
    actions: [], token: { disposition: "friendly", footprint: { width: 1, height: 1 } }, extensions: {},
    character: { classes: [{ id: "wizard", name: "Wizard", level: 5 }], race: { id: "human", name: "Human" }, feats: [] },
    proficiencies: { saves: ["int", "wis"], skills: [{ id: "arcana", proficiency: "proficient" }] },
    spellcasting: { ability: "int", slots: [{ level: 1, max: 4 }, { level: 2, max: 3 }, { level: 3, max: 2 }], spells: [{ id: "fireball", name: "Fireball", level: 3 }] },
    startingInventory: [{ id: "quarterstaff", name: "Quarterstaff", weapon: { category: "simple", damageDice: "1d6", damageType: "bludgeoning", rangeFeet: null, longRangeFeet: null } }],
    startingCurrency: { gp: 10 }
  });

  it("still parses a definition persisted before the character-builder fields existed", () => {
    const parsed = ActorDefinitionSchema.safeParse(structuredClone(legacyDefinition));
    expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(jsonValidate(structuredClone(legacyDefinition)), JSON.stringify(jsonValidate.errors)).toBe(true);
    // schemaVersion is NOT bumped - the old document is still a v1 document.
    expect(parsed.success && parsed.data.schemaVersion).toBe(1);
    // Every new field stays ABSENT rather than materializing as an empty value, so re-saving a
    // legacy definition does not silently rewrite stored content (ADR-0007).
    const data = parsed.success ? parsed.data : undefined;
    expect(data?.character?.choices).toBeUndefined();
    expect(data?.character?.classes[0].hitDie).toBeUndefined();
    expect(data?.proficiencies?.armor).toBeUndefined();
    expect(data?.proficiencies?.weapons).toBeUndefined();
    expect(data?.proficiencies?.tools).toBeUndefined();
    expect(data?.proficiencies?.languages).toBeUndefined();
    expect(data?.spellcasting?.classes).toBeUndefined();
    expect(data?.startingInventory?.[0].weapon?.properties).toBeUndefined();
    // The pre-existing single-object spellcasting fields are untouched - old consumers keep working.
    expect(data?.spellcasting?.ability).toBe("int");
    // Round-trip: re-serializing a legacy document introduces NONE of the new builder keys, so a
    // stored definition is not silently rewritten just by being loaded and saved. (Fields that were
    // already `.default()` before this change - quantity, currency, ... - still fill in as before.)
    const roundTripped = JSON.stringify(data);
    for (const newKey of ["choices", "hitDie", "weapons", "tools", "languages", "properties", "classId"]) {
      expect(roundTripped, newKey).not.toContain(`"${newKey}"`);
    }
    // Readers that just want a list use the helper instead of `?? []` at every call site.
    expect(characterChoices(data?.character)).toEqual([]);
    // ...and the single-caster resolution falls through to the top-level fields.
    expect(resolveSpellcasting(data?.spellcasting)).toEqual({ ability: "int", saveDc: undefined, attackBonus: undefined });
    expect(resolveSpellcasting(data?.spellcasting, "wizard")).toEqual({ ability: "int", saveDc: undefined, attackBonus: undefined });
    expect(resolveSpellcasting(undefined)).toBeUndefined();
  });

  it("accepts the choice-provenance ledger with open kind slugs", () => {
    const withChoices = structuredClone(legacyDefinition) as Record<string, any>;
    withChoices.character.choices = [
      { level: 1, classId: "fighter", kind: "fighting-style", id: "defense" },
      { level: 1, kind: "skill", id: "athletics", payload: { from: "fighter", featureId: "fighter-skills" } },
      { level: 4, classId: "fighter", kind: "asi", id: "str", payload: { increases: { str: 2 } } },
      { level: 4, classId: "fighter", kind: "feat", id: "alert" },
      // an entirely homebrew choice kind needs no schema change
      { level: 6, classId: "moon-warden", kind: "lunar-boon", id: "waxing-tide" }
    ];
    const parsed = ActorDefinitionSchema.safeParse(withChoices);
    expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(jsonValidate(withChoices), JSON.stringify(jsonValidate.errors)).toBe(true);
    expect(characterChoices(parsed.success ? parsed.data.character : undefined).length).toBe(5);
    // An empty ledger is distinguishable from an absent one - respec depends on that difference.
    const emptyLedger = structuredClone(legacyDefinition) as Record<string, any>;
    emptyLedger.character.choices = [];
    expect(ActorDefinitionSchema.parse(emptyLedger).character?.choices).toEqual([]);
    expect(ActorDefinitionSchema.parse(structuredClone(legacyDefinition)).character?.choices).toBeUndefined();
  });

  it("expresses a multiclass sheet: per-class hit dice, per-class spellcasting abilities, weapon properties", () => {
    const multiclass = structuredClone(legacyDefinition) as Record<string, any>;
    multiclass.character.classes = [
      { id: "paladin", name: "Paladin", level: 6, hitDie: "d10", subclass: { id: "oath-of-devotion", name: "Oath of Devotion" } },
      { id: "wizard", name: "Wizard", level: 4, hitDie: "d6" }
    ];
    // Paladin casts off CHA, Wizard off INT - the whole point of the per-class array. The top-level
    // fields stay populated (primary caster) so pre-existing consumers keep resolving.
    multiclass.spellcasting = {
      ability: "cha", saveDc: 15, attackBonus: 7,
      slots: [{ level: 1, max: 4 }, { level: 2, max: 3 }, { level: 3, max: 3 }],
      classes: [
        { classId: "paladin", ability: "cha", saveDc: 15, attackBonus: 7, prepared: 6 },
        { classId: "wizard", ability: "int", saveDc: 14, attackBonus: 6, slots: [{ level: 1, max: 4 }, { level: 2, max: 3 }], prepared: 7 }
      ],
      spells: [
        { id: "bless", name: "Bless", level: 1, classId: "paladin" },
        { id: "magic-missile", name: "Magic Missile", level: 1, classId: "wizard" }
      ]
    };
    multiclass.proficiencies = {
      saves: ["wis", "cha"], skills: [{ id: "persuasion", proficiency: "proficient" }],
      armor: ["light", "medium", "heavy", "shields"], weapons: ["simple", "martial"],
      tools: ["smiths-tools"], languages: ["common", "celestial"]
    };
    multiclass.startingInventory = [{
      id: "longsword", name: "Longsword",
      weapon: { category: "martial", damageDice: "1d8", damageType: "slashing", rangeFeet: null, longRangeFeet: null, properties: ["versatile"] }
    }, {
      id: "handaxe", name: "Handaxe", quantity: 2,
      weapon: { category: "simple", damageDice: "1d6", damageType: "slashing", rangeFeet: 60, longRangeFeet: 60, properties: ["light", "thrown"] }
    }];
    const parsed = ActorDefinitionSchema.safeParse(multiclass);
    expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(jsonValidate(multiclass), JSON.stringify(jsonValidate.errors)).toBe(true);
    const data = parsed.success ? parsed.data : undefined;
    expect(data?.character?.classes.map((entry) => entry.hitDie)).toEqual(["d10", "d6"]);
    expect(data?.spellcasting?.classes?.find((entry) => entry.classId === "wizard")?.ability).toBe("int");
    expect(data?.spellcasting?.ability).toBe("cha");
    expect(data?.startingInventory?.[1].weapon?.properties).toEqual(["light", "thrown"]);
    // The documented resolution order: per-class entry first, top-level fields as the fallback.
    expect(resolveSpellcasting(data?.spellcasting, "wizard")).toEqual({ classId: "wizard", ability: "int", saveDc: 14, attackBonus: 6 });
    expect(resolveSpellcasting(data?.spellcasting, "paladin")).toEqual({ classId: "paladin", ability: "cha", saveDc: 15, attackBonus: 7 });
    // An unknown class id with several entries falls back to the top-level (primary caster) fields.
    expect(resolveSpellcasting(data?.spellcasting, "bard")).toEqual({ ability: "cha", saveDc: 15, attackBonus: 7 });
  });

  it("rejects malformed builder input under both schemas", () => {
    const badChoiceKind = structuredClone(legacyDefinition) as Record<string, any>;
    badChoiceKind.character.choices = [{ level: 1, kind: "Fighting Style", id: "defense" }];
    expect(ActorDefinitionSchema.safeParse(badChoiceKind).success).toBe(false);
    expect(jsonValidate(badChoiceKind)).toBe(false);

    const badHitDie = structuredClone(legacyDefinition) as Record<string, any>;
    badHitDie.character.classes[0].hitDie = "d7";
    expect(ActorDefinitionSchema.safeParse(badHitDie).success).toBe(false);
    expect(jsonValidate(badHitDie)).toBe(false);

    const badWeaponProperty = structuredClone(legacyDefinition) as Record<string, any>;
    badWeaponProperty.startingInventory[0].weapon.properties = ["Two Handed"];
    expect(ActorDefinitionSchema.safeParse(badWeaponProperty).success).toBe(false);
    expect(jsonValidate(badWeaponProperty)).toBe(false);
  });
});
