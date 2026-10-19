import { readFileSync } from "node:fs";
// ajv is CJS: under `module: NodeNext` the default import is the module namespace, so use the named export.
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import character from "../../test-fixtures/actors/player-character.v1.json" with { type: "json" };
import monster from "../../test-fixtures/actors/monster.v1.json" with { type: "json" };
import torva from "../../test-fixtures/actors/torva-grimtusk.v1.json" with { type: "json" };
import pip from "../../test-fixtures/actors/pip-underbough.v1.json" with { type: "json" };
import sable from "../../test-fixtures/actors/sable-vex.v1.json" with { type: "json" };
import jsonSchema from "../json/actor-definition.v1.schema.json" with { type: "json" };
import {
  ActorDefinitionSchema,
  ActorSchema,
  EFFECT_REFUSED_MODIFIER_TYPES,
  EffectModifiersSchema,
  ModifierSchema,
  RIDER_TRIGGER_KINDS,
  RiderTriggerSchema,
  RiderWhenSchema,
  characterChoices,
  makeHitDicePool,
  resolveSpellcasting,
  riderLayer
} from "../src/index.js";
import { renderActorDefinitionJsonSchema } from "../src/json-schema.js";

const readText = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

describe("actor definition v1", () => {
  const jsonValidate = new Ajv2020({ strict: false }).compile(jsonSchema);
  // Validating against both the Zod schema and its JSON twin keeps the two from drifting.
  it.each([character, monster, torva, pip, sable])("accepts a representative fixture", (fixture) => {
    const parsed = ActorDefinitionSchema.safeParse(fixture);
    expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(jsonValidate(fixture), JSON.stringify(jsonValidate.errors)).toBe(true);
  });
  it("is the committed JSON Schema, regenerated from the Zod schema (`npm run map`)", () => {
    expect(readText("../json/actor-definition.v1.schema.json")).toBe(renderActorDefinitionJsonSchema());
  });
  it("accepts every monster in the SRD bundle", () => {
    const monsters = JSON.parse(readText("../../content-srd-5.2.1/bundles/monsters.v1.json")) as { name: string }[];
    for (const definition of monsters)
      expect(jsonValidate(definition), `${definition.name}: ${JSON.stringify(jsonValidate.errors)}`).toBe(true);
  });
  it("rejects unsafe or malformed dice input", () => {
    const invalid = structuredClone(monster);
    invalid.actions[0].damage[0].formula = "1d6; process.exit()";
    expect(ActorDefinitionSchema.safeParse(invalid).success).toBe(false);
    expect(jsonValidate(invalid)).toBe(false);
  });
  it("keeps character disposition safe", () => {
    const invalid = structuredClone(character);
    invalid.token.disposition = "hostile";
    expect(ActorDefinitionSchema.safeParse(invalid).success).toBe(false);
  });
  it("accepts a definition carrying the new character-sheet fields", () => {
    const withSheet = structuredClone(character) as Record<string, unknown>;
    withSheet.character = {
      classes: [{ id: "wizard", name: "Wizard", subclass: { id: "evocation", name: "Evocation" }, level: 5 }],
      race: { id: "human", name: "Human" },
      background: { id: "sage", name: "Sage" },
      feats: [{ id: "alert", name: "Alert" }]
    };
    withSheet.proficiencies = {
      saves: ["int", "wis"],
      skills: [
        { id: "arcana", proficiency: "expertise" },
        { id: "stealth", proficiency: "proficient" }
      ],
      saveOverrides: { con: 4 }
    };
    withSheet.spellcasting = {
      ability: "int",
      slots: [
        { level: 1, max: 4 },
        { level: 2, max: 3 }
      ],
      spells: [
        { id: "magic-missile", name: "Magic Missile", level: 1, prepared: true, actionId: "magic-missile" },
        { id: "shield", name: "Shield", level: 1, alwaysPrepared: true }
      ]
    };
    withSheet.startingInventory = [
      { id: "spellbook", name: "Spellbook", quantity: 1 },
      { id: "dagger", name: "Dagger", quantity: 2, equipped: true }
    ];
    withSheet.startingCurrency = { gp: 15, sp: 4 };
    const parsed = ActorDefinitionSchema.safeParse(withSheet);
    expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(jsonValidate(withSheet), JSON.stringify(jsonValidate.errors)).toBe(true);
  });

  // ---- character-builder fields (optional, so schemaVersion stays 1; ADR-0007) ----

  /** A definition as persisted before the builder fields existed; it must still parse and round-trip unchanged. */
  const legacyDefinition = Object.freeze({
    schemaId: "vtt.actor-character",
    schemaVersion: 1,
    source: { name: "hand-authored", version: "1" },
    name: "Legacy Character",
    size: "medium",
    abilityScores: { str: 10, dex: 14, con: 12, int: 17, wis: 11, cha: 8 },
    proficiencyBonus: 3,
    armorClass: 12,
    hitPoints: { maximum: 27, formula: "5d6 + 5" },
    speedFeet: 30,
    actions: [],
    token: { disposition: "friendly", footprint: { width: 1, height: 1 } },
    extensions: {},
    character: {
      classes: [{ id: "wizard", name: "Wizard", level: 5 }],
      race: { id: "human", name: "Human" },
      feats: []
    },
    proficiencies: { saves: ["int", "wis"], skills: [{ id: "arcana", proficiency: "proficient" }] },
    spellcasting: {
      ability: "int",
      slots: [
        { level: 1, max: 4 },
        { level: 2, max: 3 },
        { level: 3, max: 2 }
      ],
      spells: [{ id: "fireball", name: "Fireball", level: 3 }]
    },
    startingInventory: [
      {
        id: "quarterstaff",
        name: "Quarterstaff",
        weapon: {
          category: "simple",
          damageDice: "1d6",
          damageType: "bludgeoning",
          rangeFeet: null,
          longRangeFeet: null
        }
      }
    ],
    startingCurrency: { gp: 10 }
  });

  it("still parses a definition persisted before the character-builder fields existed", () => {
    const parsed = ActorDefinitionSchema.safeParse(structuredClone(legacyDefinition));
    expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(jsonValidate(structuredClone(legacyDefinition)), JSON.stringify(jsonValidate.errors)).toBe(true);
    expect(parsed.success && parsed.data.schemaVersion).toBe(1);
    // New fields stay absent, with no empty values materialized, so re-saving does not rewrite stored content.
    const data = parsed.success ? parsed.data : undefined;
    expect(data?.character?.choices).toBeUndefined();
    expect(data?.character?.classes[0].hitDie).toBeUndefined();
    expect(data?.proficiencies?.armor).toBeUndefined();
    expect(data?.proficiencies?.weapons).toBeUndefined();
    expect(data?.proficiencies?.tools).toBeUndefined();
    expect(data?.proficiencies?.languages).toBeUndefined();
    expect(data?.spellcasting?.classes).toBeUndefined();
    expect(data?.startingInventory?.[0].weapon?.properties).toBeUndefined();
    expect(data?.spellcasting?.ability).toBe("int");
    // Re-serializing introduces none of the builder keys (fields that already had `.default()` still fill in).
    const roundTripped = JSON.stringify(data);
    for (const newKey of ["choices", "hitDie", "weapons", "tools", "languages", "properties", "classId"]) {
      expect(roundTripped, newKey).not.toContain(`"${newKey}"`);
    }
    expect(characterChoices(data?.character)).toEqual([]);
    expect(resolveSpellcasting(data?.spellcasting)).toEqual({
      ability: "int",
      saveDc: undefined,
      attackBonus: undefined
    });
    expect(resolveSpellcasting(data?.spellcasting, "wizard")).toEqual({
      ability: "int",
      saveDc: undefined,
      attackBonus: undefined
    });
    expect(resolveSpellcasting(undefined)).toBeUndefined();
  });

  it("accepts the choice-provenance ledger with open kind slugs", () => {
    const withChoices = structuredClone(legacyDefinition) as Record<string, any>;
    withChoices.character.choices = [
      { level: 1, classId: "fighter", kind: "fighting-style", id: "defense" },
      { level: 1, kind: "skill", id: "athletics", payload: { from: "fighter", featureId: "fighter-skills" } },
      { level: 4, classId: "fighter", kind: "asi", id: "str", payload: { increases: { str: 2 } } },
      { level: 4, classId: "fighter", kind: "feat", id: "alert" },
      // a homebrew choice kind needs no schema change
      { level: 6, classId: "moon-warden", kind: "lunar-boon", id: "waxing-tide" }
    ];
    const parsed = ActorDefinitionSchema.safeParse(withChoices);
    expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(jsonValidate(withChoices), JSON.stringify(jsonValidate.errors)).toBe(true);
    expect(characterChoices(parsed.success ? parsed.data.character : undefined).length).toBe(5);
    // An empty ledger must be distinguishable from an absent one; respec depends on it.
    const emptyLedger = structuredClone(legacyDefinition) as Record<string, any>;
    emptyLedger.character.choices = [];
    expect(ActorDefinitionSchema.parse(emptyLedger).character?.choices).toEqual([]);
    expect(ActorDefinitionSchema.parse(structuredClone(legacyDefinition)).character?.choices).toBeUndefined();
  });

  it("expresses a multiclass sheet: per-class hit dice, per-class spellcasting abilities, weapon properties", () => {
    const multiclass = structuredClone(legacyDefinition) as Record<string, any>;
    multiclass.character.classes = [
      {
        id: "paladin",
        name: "Paladin",
        level: 6,
        hitDie: "d10",
        subclass: { id: "oath-of-devotion", name: "Oath of Devotion" }
      },
      { id: "wizard", name: "Wizard", level: 4, hitDie: "d6" }
    ];
    // Paladin casts off CHA, Wizard off INT; the top-level fields mirror the primary caster.
    multiclass.spellcasting = {
      ability: "cha",
      saveDc: 15,
      attackBonus: 7,
      slots: [
        { level: 1, max: 4 },
        { level: 2, max: 3 },
        { level: 3, max: 3 }
      ],
      classes: [
        { classId: "paladin", ability: "cha", saveDc: 15, attackBonus: 7, prepared: 6 },
        {
          classId: "wizard",
          ability: "int",
          saveDc: 14,
          attackBonus: 6,
          slots: [
            { level: 1, max: 4 },
            { level: 2, max: 3 }
          ],
          prepared: 7
        }
      ],
      spells: [
        { id: "bless", name: "Bless", level: 1, classId: "paladin" },
        { id: "magic-missile", name: "Magic Missile", level: 1, classId: "wizard" }
      ]
    };
    multiclass.proficiencies = {
      saves: ["wis", "cha"],
      skills: [{ id: "persuasion", proficiency: "proficient" }],
      armor: ["light", "medium", "heavy", "shields"],
      weapons: ["simple", "martial"],
      tools: ["smiths-tools"],
      languages: ["common", "celestial"]
    };
    multiclass.startingInventory = [
      {
        id: "longsword",
        name: "Longsword",
        weapon: {
          category: "martial",
          damageDice: "1d8",
          damageType: "slashing",
          rangeFeet: null,
          longRangeFeet: null,
          properties: ["versatile"]
        }
      },
      {
        id: "handaxe",
        name: "Handaxe",
        quantity: 2,
        weapon: {
          category: "simple",
          damageDice: "1d6",
          damageType: "slashing",
          rangeFeet: 60,
          longRangeFeet: 60,
          properties: ["light", "thrown"]
        }
      }
    ];
    const parsed = ActorDefinitionSchema.safeParse(multiclass);
    expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(jsonValidate(multiclass), JSON.stringify(jsonValidate.errors)).toBe(true);
    const data = parsed.success ? parsed.data : undefined;
    expect(data?.character?.classes.map((entry) => entry.hitDie)).toEqual(["d10", "d6"]);
    expect(data?.spellcasting?.classes?.find((entry) => entry.classId === "wizard")?.ability).toBe("int");
    expect(data?.spellcasting?.ability).toBe("cha");
    expect(data?.startingInventory?.[1].weapon?.properties).toEqual(["light", "thrown"]);
    expect(resolveSpellcasting(data?.spellcasting, "wizard")).toEqual({
      classId: "wizard",
      ability: "int",
      saveDc: 14,
      attackBonus: 6
    });
    expect(resolveSpellcasting(data?.spellcasting, "paladin")).toEqual({
      classId: "paladin",
      ability: "cha",
      saveDc: 15,
      attackBonus: 7
    });
    // An unknown class id with several entries falls back to the top-level fields.
    expect(resolveSpellcasting(data?.spellcasting, "bard")).toEqual({ ability: "cha", saveDc: 15, attackBonus: 7 });
  });

  /** The lone-entry shortcut must not answer a named class with another class's numbers. */
  it("never answers an explicitly named class with another class's spellcasting numbers", () => {
    const single = structuredClone(legacyDefinition) as Record<string, any>;
    single.spellcasting = {
      ability: "int",
      saveDc: 15,
      attackBonus: 7,
      slots: [{ level: 1, max: 4 }],
      classes: [{ classId: "wizard", ability: "int", saveDc: 15, attackBonus: 7 }],
      spells: []
    };
    const parsed = ActorDefinitionSchema.parse(single);
    expect(jsonValidate(single), JSON.stringify(jsonValidate.errors)).toBe(true);
    // Naming no class keeps the single-entry shortcut.
    expect(resolveSpellcasting(parsed.spellcasting)).toEqual({
      classId: "wizard",
      ability: "int",
      saveDc: 15,
      attackBonus: 7
    });
    expect(resolveSpellcasting(parsed.spellcasting, "wizard")).toEqual({
      classId: "wizard",
      ability: "int",
      saveDc: 15,
      attackBonus: 7
    });
    // A named class with no entry falls through to the top-level fields.
    const fighter = resolveSpellcasting(parsed.spellcasting, "fighter");
    expect(fighter).toEqual({ ability: "int", saveDc: 15, attackBonus: 7 });
    expect(fighter?.classId).toBeUndefined();
    const differing = structuredClone(single);
    differing.spellcasting.classes = [{ classId: "wizard", ability: "int", saveDc: 19, attackBonus: 11 }];
    differing.spellcasting.saveDc = 13;
    differing.spellcasting.attackBonus = 5;
    differing.spellcasting.ability = "cha";
    const parsedDiffering = ActorDefinitionSchema.parse(differing);
    expect(resolveSpellcasting(parsedDiffering.spellcasting, "fighter")).toEqual({
      ability: "cha",
      saveDc: 13,
      attackBonus: 5
    });
  });

  /** Per-class slots without the combined top-level pool would seed a caster with zero live slots. */
  it("rejects per-class spell slots without the combined top-level pool", () => {
    const inconsistent = structuredClone(legacyDefinition) as Record<string, any>;
    inconsistent.spellcasting = {
      ability: "cha",
      slots: [],
      classes: [
        { classId: "paladin", ability: "cha", slots: [{ level: 1, max: 4 }] },
        {
          classId: "wizard",
          ability: "int",
          slots: [
            { level: 1, max: 4 },
            { level: 2, max: 3 }
          ]
        }
      ],
      spells: []
    };
    const parsed = ActorDefinitionSchema.safeParse(inconsistent);
    expect(parsed.success).toBe(false);
    expect(parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join("."))).toContain(
      "spellcasting.slots"
    );
    // A cross-field rule: the generated JSON Schema can't state it, so only the app refuses it.
    expect(jsonValidate(inconsistent)).toBe(true);
    // Omitting `slots` is the same violation (it defaults to empty).
    const omitted = structuredClone(inconsistent);
    delete omitted.spellcasting.slots;
    expect(ActorDefinitionSchema.safeParse(omitted).success).toBe(false);
    const consistent = structuredClone(inconsistent);
    consistent.spellcasting.slots = [
      { level: 1, max: 4 },
      { level: 2, max: 3 },
      { level: 3, max: 3 }
    ];
    expect(ActorDefinitionSchema.safeParse(consistent).success).toBe(true);
    expect(jsonValidate(consistent), JSON.stringify(jsonValidate.errors)).toBe(true);
    // Per-class entries without per-class slots stay legal; the server derives the combined table.
    const derived = structuredClone(inconsistent);
    for (const entry of derived.spellcasting.classes) delete entry.slots;
    expect(ActorDefinitionSchema.safeParse(derived).success).toBe(true);
    expect(jsonValidate(derived), JSON.stringify(jsonValidate.errors)).toBe(true);
  });

  /** Hit dice are a pool; a GameState saved with the older single-object shape must still load. */
  it("normalises every Hit-Dice shape into one pool, old saves included", () => {
    const pool = makeHitDicePool([
      { die: "d10", maximum: 3, remaining: 1 },
      { die: "d6", maximum: 2, remaining: 2 }
    ]);
    // The summary is derived: total dice, labelled with the largest size present.
    expect(pool).toEqual({
      die: "d10",
      maximum: 5,
      remaining: 3,
      entries: [
        { die: "d10", maximum: 3, remaining: 1 },
        { die: "d6", maximum: 2, remaining: 2 }
      ]
    });
    expect(makeHitDicePool([])).toBeNull();

    const base = {
      id: "3f1c9e2a-0000-4000-8000-00000000f001",
      name: "Old Save",
      kind: "player-character" as const,
      hp: { current: 10, maximum: 10 }
    };
    expect(ActorSchema.parse({ ...base, hitDice: { die: "d12", maximum: 7, remaining: 4 } }).hitDice).toEqual({
      die: "d12",
      maximum: 7,
      remaining: 4,
      entries: [{ die: "d12", maximum: 7, remaining: 4 }]
    });
    expect(ActorSchema.parse(base).hitDice).toBeNull();
    expect(ActorSchema.parse({ ...base, hitDice: null }).hitDice).toBeNull();
    // A hand-written summary is ignored and recomputed from `entries`.
    expect(
      ActorSchema.parse({
        ...base,
        hitDice: { die: "d4", maximum: 99, remaining: 99, entries: [{ die: "d8", maximum: 2, remaining: 0 }] }
      }).hitDice
    ).toEqual({ die: "d8", maximum: 2, remaining: 0, entries: [{ die: "d8", maximum: 2, remaining: 0 }] });
    expect(ActorSchema.safeParse({ ...base, hitDice: { die: "d7", maximum: 1, remaining: 1 } }).success).toBe(false);
    expect(
      ActorSchema.safeParse({ ...base, hitDice: { die: "d6", maximum: 1, remaining: 1, entries: "nope" } }).success
    ).toBe(false);
  });

  // ---- shared rider vocabulary (magic items, feats, effects); the JSON twin must keep pace ----

  it("carries gated modifiers on an effect through BOTH schemas", () => {
    const withRiders = structuredClone(legacyDefinition) as Record<string, any>;
    withRiders.actions = [
      {
        id: "ember-strike",
        name: "Ember Strike",
        activation: "action",
        description: "A burning swing.",
        grants: {
          tags: ["ember"],
          duration: { type: "encounter" },
          modifiers: [
            { type: "attack-bonus", amount: 1, scope: "this-item" },
            {
              type: "extra-damage",
              formula: "1d6",
              damageType: "fire",
              doubleOnCritical: false,
              when: [{ type: "on-critical-hit" }]
            },
            {
              type: "roll-mode",
              roll: "save",
              mode: "advantage",
              when: [{ type: "on-saving-throw" }, { type: "ability-is", abilities: ["dex"] }]
            },
            { type: "roll-mode", roll: "incoming-attack", mode: "disadvantage" },
            { type: "damage-resistance", damageTypes: ["fire"], when: [{ type: "while-effect-tag", tags: ["ember"] }] }
          ]
        }
      }
    ];
    const parsed = ActorDefinitionSchema.safeParse(withRiders);
    expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(jsonValidate(withRiders), JSON.stringify(jsonValidate.errors)).toBe(true);
    // A branch the JSON Schema lacked would be a stored effect its validator rejects on load.
    expect(EffectModifiersSchema.safeParse([{ type: "speed", amount: -10 }]).success).toBe(true);
    expect(EffectModifiersSchema.safeParse([{ type: "speed", amount: 61 }]).success).toBe(false);
    const striding = structuredClone(withRiders) as Record<string, any>;
    striding.actions[0].grants.modifiers = [{ type: "speed", amount: -10 }];
    expect(ActorDefinitionSchema.safeParse(striding).success).toBe(true);
    expect(jsonValidate(striding), JSON.stringify(jsonValidate.errors)).toBe(true);
  });

  it("refuses on an effect what the sheet stores, and an unknown damage type or condition anywhere", () => {
    // Stored numbers would outlast the effect, so the effect carrier refuses them; the vocabulary itself has them.
    for (const type of EFFECT_REFUSED_MODIFIER_TYPES)
      expect(ModifierSchema.options.some((option) => option.shape.type.value === type)).toBe(true);
    const armor = EffectModifiersSchema.safeParse([{ type: "armor-class", amount: 2 }]);
    expect(armor.success).toBe(false);
    expect(armor.error?.issues[0].message).toContain('An effect cannot carry "armor-class"');
    expect(EffectModifiersSchema.safeParse([{ type: "save-bonus", amount: 1 }]).success).toBe(true);
    // Damage types and conditions in riders are the SRD's closed sets, so a typo cannot publish.
    expect(ModifierSchema.safeParse({ type: "extra-damage", formula: "1d6", damageType: "fyre" }).success).toBe(false);
    expect(ModifierSchema.safeParse({ type: "damage-resistance", damageTypes: ["fire"] }).success).toBe(true);
    expect(RiderWhenSchema.safeParse([{ type: "while-condition", conditionIds: ["poisonned"] }]).success).toBe(false);
  });

  it("declares thirty named triggers, every one classified and accepted by the JSON twin", () => {
    // One sample per trigger: the JSON twin folds parameterless moments into one enum branch, so a branch count would
    // not prove agreement.
    const samples: Record<string, Record<string, unknown>> = {
      attuned: {},
      "while-armored": { weights: ["heavy"] },
      "while-unarmored": { allowShield: true },
      "while-shield": { wielding: false },
      "while-character-is": { classIds: ["paladin"], speciesIds: ["dwarf"] },
      "while-proficient-with": { kind: "tool", ids: ["thieves-tools"] },
      "while-effect-tag": { tags: ["raging"] },
      "while-hp-at-or-below": { percent: 50 },
      "while-condition": { conditionIds: ["frightened"], present: false },
      "on-attack-roll": {},
      "on-hit": {},
      "on-critical-hit": {},
      "on-natural-20": {},
      "on-damage-roll": {},
      "on-saving-throw": {},
      "on-ability-check": {},
      "on-initiative-roll": {},
      "on-taking-damage": {},
      "attack-kind-is": { kinds: ["opportunity"] },
      "weapon-property-is": { properties: ["finesse"] },
      "damage-type-is": { damageTypes: ["fire"] },
      "ability-is": { abilities: ["dex"] },
      "skill-is": { skills: ["stealth"] },
      "spell-school-is": { schools: ["evocation"] },
      "spell-level-is": { levels: [0, 3] },
      "spell-id-is": { spellIds: ["eldritch-blast"] },
      "versus-creature-type": { creatureTypes: ["undead"] },
      "versus-size": { sizes: ["large"] },
      "versus-condition": { conditionIds: ["prone"] },
      "by-effect-source": {}
    };
    const declared = RiderTriggerSchema.options.map((option) => option.shape.type.value as string);
    expect(declared).toHaveLength(30);
    expect(Object.keys(samples).sort()).toEqual([...declared].sort());
    // Every trigger must be classified, or it would evaluate in the wrong layer.
    const kinds = declared.map((type) => RIDER_TRIGGER_KINDS[type as keyof typeof RIDER_TRIGGER_KINDS]);
    expect(kinds.filter((kind) => kind === undefined)).toEqual([]);
    expect(kinds.filter((kind) => kind === "static-gate")).toHaveLength(6);
    expect(kinds.filter((kind) => kind === "dynamic-gate")).toHaveLength(3);
    expect(kinds.filter((kind) => kind === "moment")).toHaveLength(9);
    expect(kinds.filter((kind) => kind === "filter")).toHaveLength(12);

    for (const type of declared) {
      const trigger = { type, ...samples[type] };
      // A filter needs a moment beside it.
      const when =
        RIDER_TRIGGER_KINDS[type as keyof typeof RIDER_TRIGGER_KINDS] === "filter"
          ? [{ type: "on-hit" }, trigger]
          : [trigger];
      expect(RiderWhenSchema.safeParse(when).success, type).toBe(true);
      const definition = structuredClone(legacyDefinition) as Record<string, any>;
      definition.actions = [
        {
          id: "x",
          name: "X",
          activation: "action",
          description: "d",
          grants: {
            tags: ["x"],
            duration: { type: "encounter" },
            modifiers: [{ type: "attack-bonus", amount: 1, when }]
          }
        }
      ];
      expect(ActorDefinitionSchema.safeParse(definition).success, `Zod: ${type}`).toBe(true);
      expect(jsonValidate(definition), `JSON twin: ${type}: ${JSON.stringify(jsonValidate.errors)}`).toBe(true);
    }
  });

  it("rejects a `when` list the JSON twin would also reject", () => {
    // Structural refinements live in Zod alone; the shapes must agree and an unknown trigger fails on both sides.
    const bad = structuredClone(legacyDefinition) as Record<string, any>;
    bad.actions = [
      {
        id: "x",
        name: "X",
        activation: "action",
        description: "d",
        grants: {
          tags: ["x"],
          duration: { type: "encounter" },
          modifiers: [{ type: "attack-bonus", amount: 1, when: [{ type: "while-it-is-tuesday" }] }]
        }
      }
    ];
    expect(ActorDefinitionSchema.safeParse(bad).success).toBe(false);
    expect(jsonValidate(bad)).toBe(false);
    expect(riderLayer(RiderWhenSchema.parse([{ type: "while-effect-tag", tags: ["raging"] }]))).toBe("conditional");
    expect(riderLayer(RiderWhenSchema.parse([]))).toBe("standing");
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
