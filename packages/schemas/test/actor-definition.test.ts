import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import character from "../../test-fixtures/actors/player-character.v1.json";
import monster from "../../test-fixtures/actors/monster.v1.json";
import torva from "../../test-fixtures/actors/torva-grimtusk.v1.json";
import pip from "../../test-fixtures/actors/pip-underbough.v1.json";
import sable from "../../test-fixtures/actors/sable-vex.v1.json";
import jsonSchema from "../json/actor-definition.v1.schema.json";
import { ActorDefinitionSchema, ActorSchema, EffectModifierSchema, RIDER_TRIGGER_KINDS, RiderTriggerSchema, RiderWhenSchema, characterChoices, makeHitDicePool, resolveSpellcasting, riderLayer, toRollModes } from "../src/index.js";

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

  /**
   * REGRESSION: the lone-entry shortcut (resolution step 2) used to fire even when the caller named a
   * DIFFERENT class, so an Eldritch Knight / Wizard sheet answered "what are the fighter's numbers?"
   * with the Wizard's INT and DC. Step 2 exists for the caller who names no class at all.
   */
  it("never answers an explicitly named class with another class's spellcasting numbers", () => {
    const single = structuredClone(legacyDefinition) as Record<string, any>;
    single.spellcasting = {
      ability: "int", saveDc: 15, attackBonus: 7,
      slots: [{ level: 1, max: 4 }],
      classes: [{ classId: "wizard", ability: "int", saveDc: 15, attackBonus: 7 }],
      spells: []
    };
    const parsed = ActorDefinitionSchema.parse(single);
    expect(jsonValidate(single), JSON.stringify(jsonValidate.errors)).toBe(true);
    // Naming NO class keeps the single-entry shortcut - the ordinary single-class caster.
    expect(resolveSpellcasting(parsed.spellcasting)).toEqual({ classId: "wizard", ability: "int", saveDc: 15, attackBonus: 7 });
    expect(resolveSpellcasting(parsed.spellcasting, "wizard")).toEqual({ classId: "wizard", ability: "int", saveDc: 15, attackBonus: 7 });
    // Naming a class with NO entry must NOT be handed the wizard's entry; it falls through to the
    // top-level fields (step 3), and it never claims to be the wizard's.
    const fighter = resolveSpellcasting(parsed.spellcasting, "fighter");
    expect(fighter).toEqual({ ability: "int", saveDc: 15, attackBonus: 7 });
    expect(fighter?.classId).toBeUndefined();
    // Same rule with a differing per-class entry: asking for "fighter" cannot borrow the wizard's DC.
    const differing = structuredClone(single);
    differing.spellcasting.classes = [{ classId: "wizard", ability: "int", saveDc: 19, attackBonus: 11 }];
    differing.spellcasting.saveDc = 13;
    differing.spellcasting.attackBonus = 5;
    differing.spellcasting.ability = "cha";
    const parsedDiffering = ActorDefinitionSchema.parse(differing);
    expect(resolveSpellcasting(parsedDiffering.spellcasting, "fighter")).toEqual({ ability: "cha", saveDc: 13, attackBonus: 5 });
  });

  /**
   * REGRESSION: the doc block on SpellcastingSchema always said a builder filling `classes[]` must
   * keep the top-level pool populated, but nothing enforced it - so a definition with per-class slots
   * and an empty top-level `slots` parsed happily and seeded a caster with ZERO live slots that no
   * long rest could refill. It is now a parse error under BOTH schemas.
   */
  it("rejects per-class spell slots without the combined top-level pool", () => {
    const inconsistent = structuredClone(legacyDefinition) as Record<string, any>;
    inconsistent.spellcasting = {
      ability: "cha",
      slots: [],
      classes: [
        { classId: "paladin", ability: "cha", slots: [{ level: 1, max: 4 }] },
        { classId: "wizard", ability: "int", slots: [{ level: 1, max: 4 }, { level: 2, max: 3 }] }
      ],
      spells: []
    };
    const parsed = ActorDefinitionSchema.safeParse(inconsistent);
    expect(parsed.success).toBe(false);
    expect(parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join("."))).toContain("spellcasting.slots");
    expect(jsonValidate(inconsistent)).toBe(false);
    // Omitting `slots` entirely is the same violation (it defaults to an empty pool).
    const omitted = structuredClone(inconsistent);
    delete omitted.spellcasting.slots;
    expect(ActorDefinitionSchema.safeParse(omitted).success).toBe(false);
    expect(jsonValidate(omitted)).toBe(false);
    // Filling the combined pool makes the same sheet legal again under both schemas.
    const consistent = structuredClone(inconsistent);
    consistent.spellcasting.slots = [{ level: 1, max: 4 }, { level: 2, max: 3 }, { level: 3, max: 3 }];
    expect(ActorDefinitionSchema.safeParse(consistent).success).toBe(true);
    expect(jsonValidate(consistent), JSON.stringify(jsonValidate.errors)).toBe(true);
    // Per-class ENTRIES without per-class slots stay legal - the server derives the combined table.
    const derived = structuredClone(inconsistent);
    for (const entry of derived.spellcasting.classes) delete entry.slots;
    expect(ActorDefinitionSchema.safeParse(derived).success).toBe(true);
    expect(jsonValidate(derived), JSON.stringify(jsonValidate.errors)).toBe(true);
  });

  /**
   * REGRESSION: `Actor.hitDice` was one `{die, maximum, remaining}`, so a Fighter 3 / Wizard 2 could
   * only ever be stored as ONE die size and silently lost 2 of its 5 dice. It is now a pool. The
   * change must stay additive: a GameState persisted with the old single-object shape still loads.
   */
  it("normalises every Hit-Dice shape into one pool, old saves included", () => {
    const pool = makeHitDicePool([{ die: "d10", maximum: 3, remaining: 1 }, { die: "d6", maximum: 2, remaining: 2 }]);
    // The summary is DERIVED: total dice, labelled with the largest size present.
    expect(pool).toEqual({ die: "d10", maximum: 5, remaining: 3, entries: [{ die: "d10", maximum: 3, remaining: 1 }, { die: "d6", maximum: 2, remaining: 2 }] });
    expect(makeHitDicePool([])).toBeNull();

    const base = { id: "3f1c9e2a-0000-4000-8000-00000000f001", name: "Old Save", kind: "player-character" as const, hp: { current: 10, maximum: 10 } };
    // A save written before pools existed loads as a one-entry pool (no schemaVersion bump needed).
    expect(ActorSchema.parse({ ...base, hitDice: { die: "d12", maximum: 7, remaining: 4 } }).hitDice)
      .toEqual({ die: "d12", maximum: 7, remaining: 4, entries: [{ die: "d12", maximum: 7, remaining: 4 }] });
    // A save with no hit dice at all keeps the null default (unmodeled).
    expect(ActorSchema.parse(base).hitDice).toBeNull();
    expect(ActorSchema.parse({ ...base, hitDice: null }).hitDice).toBeNull();
    // A hand-written summary can never disagree with the pool: it is recomputed from `entries`.
    expect(ActorSchema.parse({ ...base, hitDice: { die: "d4", maximum: 99, remaining: 99, entries: [{ die: "d8", maximum: 2, remaining: 0 }] } }).hitDice)
      .toEqual({ die: "d8", maximum: 2, remaining: 0, entries: [{ die: "d8", maximum: 2, remaining: 0 }] });
    // Garbage still fails loudly rather than being normalised into something plausible.
    expect(ActorSchema.safeParse({ ...base, hitDice: { die: "d7", maximum: 1, remaining: 1 } }).success).toBe(false);
    expect(ActorSchema.safeParse({ ...base, hitDice: { die: "d6", maximum: 1, remaining: 1, entries: "nope" } }).success).toBe(false);
  });

  // ---- the shared rider vocabulary (magic items, feats, effects) --------------------------------
  // `EffectModifierSchema` grew three variants that `FeatureModifierSchema` carries as the very same
  // objects. The JSON twin has to grow with them or the two documents disagree about the wire.

  it("carries the three shared riders through BOTH schemas, gates and all", () => {
    const withRiders = structuredClone(legacyDefinition) as Record<string, any>;
    withRiders.actions = [{
      id: "ember-strike", name: "Ember Strike", activation: "action", description: "A burning swing.",
      grants: {
        tags: ["ember"], duration: { type: "encounter" },
        modifiers: [
          { type: "attack-bonus", amount: 1, scope: "this-item" },
          { type: "extra-damage", formula: "1d6", damageType: "fire", doubleOnCritical: false, when: [{ type: "on-critical-hit" }] },
          { type: "roll-mode", roll: "save", mode: "advantage", when: [{ type: "on-saving-throw" }, { type: "ability-is", abilities: ["dex"] }] },
          // The six legacy advantage/disadvantage variants keep working unchanged - `roll-mode` is
          // the general form beside them, never a replacement that would break a stored effect.
          { type: "attack-advantage" }, { type: "save-disadvantage", ability: "con" }
        ]
      }
    }];
    const parsed = ActorDefinitionSchema.safeParse(withRiders);
    expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(jsonValidate(withRiders), JSON.stringify(jsonValidate.errors)).toBe(true);
    // Eleven variants: the eight that existed plus the three shared with FeatureModifierSchema.
    expect(EffectModifierSchema.options).toHaveLength(11);
    // ...and the JSON twin declares exactly as many branches, which is the lockstep this test buys.
    expect((jsonSchema as any).$defs.effectModifier.oneOf).toHaveLength(11);
  });

  it("normalises every advantage shape through ONE function, so no consumer branches on eleven", () => {
    // The point of `roll-mode`: the legacy variants and the general form come back identical, and
    // 5e cancellation (`aggregateRollMode`) then works on the labelled sources without knowing which
    // shape produced them. A curse is `mode: "disadvantage"` and needs no separate machinery.
    expect(toRollModes(EffectModifierSchema.parse({ type: "attack-advantage" }))).toEqual([{ roll: "attack", mode: "advantage" }]);
    expect(toRollModes(EffectModifierSchema.parse({ type: "roll-mode", roll: "attack", mode: "advantage" }))).toEqual([{ roll: "attack", mode: "advantage" }]);
    expect(toRollModes(EffectModifierSchema.parse({ type: "save-advantage", ability: "dex" }))).toEqual([{ roll: "save", mode: "advantage", ability: "dex" }]);
    expect(toRollModes(EffectModifierSchema.parse({ type: "incoming-attack-disadvantage" }))).toEqual([{ roll: "incoming-attack", mode: "disadvantage" }]);
    // A rider that is not an advantage claim normalises to nothing rather than to a wrong claim.
    expect(toRollModes(EffectModifierSchema.parse({ type: "damage-bonus", amount: 2 }))).toEqual([]);
    expect(toRollModes(EffectModifierSchema.parse({ type: "attack-bonus", amount: 1 }))).toEqual([]);
  });

  it("declares thirty-one named triggers, every one classified and accepted by the JSON twin", () => {
    // One sample per trigger. The JSON twin folds the eleven parameterless moments into a single
    // enum branch, so a branch COUNT would not prove agreement - running every name through both
    // documents does. A trigger added to Zod and forgotten in the mirror fails right here.
    const samples: Record<string, Record<string, unknown>> = {
      attuned: {}, "while-armored": { weights: ["heavy"] }, "while-unarmored": { allowShield: true },
      "while-shield": { wielding: false }, "while-character-is": { classIds: ["paladin"], speciesIds: ["dwarf"] },
      "while-proficient-with": { kind: "tool", ids: ["thieves-tools"] },
      "while-effect-tag": { tags: ["raging"] }, "while-hp-at-or-below": { percent: 50 },
      "while-condition": { conditionIds: ["frightened"], present: false },
      "on-attack-roll": {}, "on-hit": {}, "on-critical-hit": {}, "on-critical-miss": {}, "on-damage-roll": {},
      "on-saving-throw": {}, "on-ability-check": {}, "on-initiative-roll": {}, "on-death-save": {},
      "on-taking-damage": {}, "on-spell-cast": {},
      "attack-kind-is": { kinds: ["opportunity"] }, "weapon-property-is": { properties: ["finesse"] },
      "damage-type-is": { damageTypes: ["fire"] }, "ability-is": { abilities: ["dex"] },
      "skill-is": { skills: ["stealth"] }, "spell-school-is": { schools: ["evocation"] },
      "spell-level-is": { levels: [0, 3] }, "spell-id-is": { spellIds: ["eldritch-blast"] },
      "versus-creature-type": { creatureTypes: ["undead"] },
      "versus-size": { sizes: ["large"] }, "versus-condition": { conditionIds: ["prone"] }
    };
    const declared = RiderTriggerSchema.options.map((option) => option.shape.type.value as string);
    expect(declared).toHaveLength(31);
    expect(Object.keys(samples).sort()).toEqual([...declared].sort());
    // Six static gates, three dynamic gates, eleven moments, eleven filters - and every trigger is
    // classified, because an unclassified one would silently evaluate in the wrong layer.
    const kinds = declared.map((type) => RIDER_TRIGGER_KINDS[type as keyof typeof RIDER_TRIGGER_KINDS]);
    expect(kinds.filter((kind) => kind === undefined)).toEqual([]);
    expect(kinds.filter((kind) => kind === "static-gate")).toHaveLength(6);
    expect(kinds.filter((kind) => kind === "dynamic-gate")).toHaveLength(3);
    expect(kinds.filter((kind) => kind === "moment")).toHaveLength(11);
    expect(kinds.filter((kind) => kind === "filter")).toHaveLength(11);

    for (const type of declared) {
      const trigger = { type, ...samples[type] };
      // A filter needs a moment beside it, and only a moment may accompany itself: build the
      // smallest legal `when` for each kind rather than special-casing the assertion.
      const when = RIDER_TRIGGER_KINDS[type as keyof typeof RIDER_TRIGGER_KINDS] === "filter" ? [{ type: "on-hit" }, trigger] : [trigger];
      expect(RiderWhenSchema.safeParse(when).success, type).toBe(true);
      const definition = structuredClone(legacyDefinition) as Record<string, any>;
      definition.actions = [{ id: "x", name: "X", activation: "action", description: "d", grants: { tags: ["x"], duration: { type: "encounter" }, modifiers: [{ type: "attack-bonus", amount: 1, when }] } }];
      expect(ActorDefinitionSchema.safeParse(definition).success, `Zod: ${type}`).toBe(true);
      expect(jsonValidate(definition), `JSON twin: ${type}: ${JSON.stringify(jsonValidate.errors)}`).toBe(true);
    }
  });

  it("rejects a `when` list the JSON twin would also reject", () => {
    // Structural refinements (one moment, a filter needs a moment) live in Zod alone; the shapes
    // themselves must agree, and an unnamed trigger must fail on both sides.
    const bad = structuredClone(legacyDefinition) as Record<string, any>;
    bad.actions = [{ id: "x", name: "X", activation: "action", description: "d", grants: { tags: ["x"], duration: { type: "encounter" }, modifiers: [{ type: "attack-bonus", amount: 1, when: [{ type: "while-it-is-tuesday" }] }] } }];
    expect(ActorDefinitionSchema.safeParse(bad).success).toBe(false);
    expect(jsonValidate(bad)).toBe(false);
    // The layer table is a pure lookup, shared by every consumer so it cannot be decided twice.
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
