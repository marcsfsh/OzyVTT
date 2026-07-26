/**
 * Character-BUILDER content records: classes, subclasses, species, backgrounds, feats, and per-species
 * name pools. These are the shapes the guided wizard, the level-up flow, and the random generator all
 * read (task packet `docs/task-packets/character-builder.md`, phase 1.1).
 *
 * Three rules govern everything in this file:
 *
 * 1. FEATURES ARE DATA. One `FeatureRecord` describes a class feature, a subclass feature, a species
 *    trait, a background feature, and a feat alike: prose plus optional structured riders drawn from a
 *    bounded vocabulary that REUSES the shapes already proven on `ActorDefinition` (`ActionSchema`,
 *    `EffectGrantSchema`, `ActionUsesSchema`). No feature may need hardcoded client or server
 *    behavior - a homebrew author writes the same record and the engine cannot tell it apart.
 * 2. ONE SOURCE DISCRIMINATOR. Every record carries `source: "srd" | "homebrew"` (default "srd").
 *    Merging happens once, in the server's content library, exactly as `loadEquipment()` already
 *    folds weapons + armor + gear together. Homebrew is the next source, never a fork.
 * 3. NO NEW CLOSED ENUMS FOR IDENTITY. Ids are open slugs. Ability references use the existing
 *    six-ability enum (the one genuinely closed vocabulary in 5e); skills, damage types, item
 *    categories, proficiency groups, languages, and feature ids all stay open slugs so homebrew and
 *    later SRD printings need no schema change.
 */
import { z } from "zod";
import { AbilitySchema, ActionSchema, DiceFormulaSchema, EffectGrantSchema, HitDieSchema } from "@vtt/schemas";

/** Every identity in the content catalog is an open slug - never a closed enum (principle 3). */
export const ContentIdSchema = z.string().regex(/^[a-z0-9-]+$/).max(80);
/** A character or class level, 1-20. */
export const ContentLevelSchema = z.number().int().min(1).max(20);
/** Which catalog a record came from. One discriminator, merged once (principle 2). */
export const ContentSourceSchema = z.enum(["srd", "homebrew"]).default("srd");
export type ContentSource = z.infer<typeof ContentSourceSchema>;

/** Fields every content record shares, so the browse UI and the merge step can treat them uniformly. */
const contentRecordBase = {
  id: ContentIdSchema,
  name: z.string().min(1).max(120),
  source: ContentSourceSchema,
  /** Short blurb for the wizard's pick card. */
  summary: z.string().max(400).optional(),
  /** Long prose. Always the display source of truth; structured riders only add mechanics on top. */
  description: z.string().max(20000).optional(),
  /** Credit line for a homebrew record whose text came from somewhere else (SRD records use the bundle-wide CC BY notice). */
  attribution: z.string().max(400).optional()
};

// ---------------------------------------------------------------------------------------------
// FeatureRecord - the one shape every class/subclass/species/background/feat feature uses.
// ---------------------------------------------------------------------------------------------

/**
 * Uses a feature gets back on a rest, expressed as DATA rather than a formula language. `limit` is a
 * flat count; `scaling` covers the three ways 5e actually scales a feature's uses (proficiency bonus,
 * an ability modifier, or a printed per-level column). `pool` shares one counter across features, the
 * same way `ActionUsesSchema.pool` shares one across actions.
 */
export const FeatureUsesSchema = z.object({
  limit: z.number().int().min(1).max(20).optional(),
  scaling: z.discriminatedUnion("type", [
    z.object({ type: z.literal("proficiency-bonus") }).strict(),
    z.object({ type: z.literal("ability-modifier"), ability: AbilitySchema, minimum: z.number().int().min(0).max(5).default(1) }).strict(),
    z.object({ type: z.literal("by-level"), table: z.array(z.object({ level: ContentLevelSchema, limit: z.number().int().min(0).max(99) }).strict()).min(1).max(20) }).strict()
  ]).optional(),
  per: z.enum(["turn", "encounter", "short-rest", "long-rest"]),
  pool: ContentIdSchema.optional()
}).strict().superRefine((uses, context) => {
  if (uses.limit === undefined && uses.scaling === undefined) context.addIssue({ code: z.ZodIssueCode.custom, message: "Limited uses need either a flat `limit` or a `scaling` rule." });
});
export type FeatureUses = z.infer<typeof FeatureUsesSchema>;

/**
 * A pick the feature asks the player to make. Writing one of these is what puts a row in the
 * character's `choices[]` provenance ledger, which is what makes level-up and respec possible.
 * `kind` is an OPEN slug ("fighting-style", "skill", "expertise", "subclass", "asi", "feat", "spell",
 * "cantrip", "language", "tool", or anything homebrew invents) - the wizard renders it generically.
 */
export const FeatureChoiceSchema = z.object({
  kind: ContentIdSchema,
  choose: z.number().int().min(1).max(10).default(1),
  /** Explicit option ids. Omit when `fromCatalog` names an open list instead. */
  from: z.array(ContentIdSchema).max(80).optional(),
  /** An open catalog slug the wizard resolves at pick time ("skills", "feats", "wizard-spells"). */
  fromCatalog: ContentIdSchema.optional(),
  /** Only options at or below this level are legal (spell picks). */
  maxSpellLevel: z.number().int().min(0).max(9).optional(),
  /** The same option may be picked more than once (Expertise across levels). */
  repeatable: z.boolean().default(false)
}).strict().superRefine((choice, context) => {
  if (!choice.from && !choice.fromCatalog) context.addIssue({ code: z.ZodIssueCode.custom, message: "A choice needs either an explicit `from` list or a `fromCatalog` slug." });
});
export type FeatureChoice = z.infer<typeof FeatureChoiceSchema>;

/**
 * An attack a feature grants. Same vocabulary as `ActionSchema.attack`, except the to-hit BONUS is
 * derived rather than authored: a class feature cannot know the character's ability scores, so it
 * names the ability instead and the builder resolves the number.
 */
export const FeatureAttackSchema = z.object({
  ability: z.union([AbilitySchema, z.literal("spellcasting")]),
  proficient: z.boolean().default(true),
  reachFeet: z.number().int().positive().optional(),
  rangeFeet: z.number().int().positive().optional(),
  rangeNormalFeet: z.number().int().positive().optional(),
  count: z.number().int().min(1).max(10).optional(),
  criticalBonusDice: z.number().int().min(1).max(4).optional()
}).strict();

/** A save a feature forces; the DC is either the character's spell save DC or a flat printed number. */
export const FeatureSaveSchema = z.object({
  ability: AbilitySchema,
  dc: z.union([z.literal("spellcasting"), z.number().int().min(1).max(40)])
}).strict();

/**
 * A rollable action a feature adds to the sheet (Second Wind, Channel Divinity, Breath Weapon). Built
 * from `ActionSchema` so the vocabulary cannot drift: only `attack` and `save` are swapped for the
 * derived templates above, everything else (damage, onHit riders, grants, uses, multiattack,
 * reaction, legendary) is the identical shape the rules engine already resolves.
 */
export const FeatureActionSchema = ActionSchema.omit({ attack: true, save: true }).extend({
  attack: FeatureAttackSchema.optional(),
  save: FeatureSaveSchema.optional(),
  /** Damage that grows with level, replacing `damage` at the highest matching level (Sneak Attack, Divine Smite). */
  damageByLevel: z.array(z.object({ level: ContentLevelSchema, formula: DiceFormulaSchema, type: z.string().min(1).max(40) }).strict()).max(20).optional()
});
export type FeatureAction = z.infer<typeof FeatureActionSchema>;

/**
 * Flat things a feature simply hands the character. All open slugs (principle 3) so a homebrew
 * language, tool, or armor group needs no schema change.
 */
export const FeatureGrantsSchema = z.object({
  skills: z.array(ContentIdSchema).max(20).default([]),
  expertise: z.array(ContentIdSchema).max(20).default([]),
  tools: z.array(ContentIdSchema).max(20).default([]),
  languages: z.array(ContentIdSchema).max(20).default([]),
  armor: z.array(ContentIdSchema).max(10).default([]),
  weapons: z.array(ContentIdSchema).max(40).default([]),
  saves: z.array(AbilitySchema).max(6).default([]),
  damageResistances: z.array(ContentIdSchema).max(20).default([]),
  damageImmunities: z.array(ContentIdSchema).max(20).default([]),
  conditionImmunities: z.array(ContentIdSchema).max(20).default([]),
  /** Spells the feature always has ready (domain spells, racial spells). `alwaysPrepared` spells do not count against a prepared list. */
  spells: z.array(z.object({ id: ContentIdSchema, level: z.number().int().min(0).max(9).optional(), alwaysPrepared: z.boolean().default(true), ability: AbilitySchema.optional() }).strict()).max(30).default([])
}).strict();

/**
 * Typed numeric riders. A bounded union, deliberately small and grown additively - the same contract
 * `EffectModifierSchema` follows on the actor side. Anything not modeled here stays prose (ADR-0008).
 */
export const FeatureModifierSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ability-score"), ability: AbilitySchema, amount: z.number().int().min(-5).max(5), maximum: z.number().int().min(1).max(30).optional() }).strict(),
  z.object({ type: z.literal("hit-points-per-level"), amount: z.number().int().min(-5).max(5) }).strict(),
  z.object({ type: z.literal("speed"), amount: z.number().int().min(-30).max(60) }).strict(),
  z.object({ type: z.literal("armor-class"), amount: z.number().int().min(-5).max(5) }).strict(),
  z.object({ type: z.literal("initiative"), amount: z.number().int().min(-5).max(10) }).strict(),
  z.object({ type: z.literal("extra-attack"), count: z.number().int().min(1).max(3) }).strict(),
  /** AC = 10 + DEX + this ability while wearing no armor (Barbarian, Monk, and any homebrew that wants it). */
  z.object({ type: z.literal("unarmored-defense"), ability: AbilitySchema, allowShield: z.boolean().default(false) }).strict(),
  z.object({ type: z.literal("darkvision"), feet: z.number().int().min(0).max(240) }).strict()
]);
export type FeatureModifier = z.infer<typeof FeatureModifierSchema>;

/**
 * THE shared feature record. A class feature, a subclass feature, a species trait, a background
 * feature, and a feat's mechanics are all this one shape. `description` is always the display source
 * of truth; every rider below is optional, and a feature with no riders is a perfectly valid
 * prose-only feature (which is how most SRD text starts life).
 */
export const FeatureRecordSchema = z.object({
  id: ContentIdSchema,
  name: z.string().min(1).max(120),
  /** Class/subclass level this feature is gained at. Absent for always-on records (species traits, feats). */
  level: ContentLevelSchema.optional(),
  description: z.string().min(1).max(20000),
  /** Open grouping slugs for the sheet ("spellcasting", "fighting-style", "channel-divinity"). */
  tags: z.array(ContentIdSchema).max(8).default([]),
  /** A pick this feature asks the player to make; writes a `choices[]` row. */
  choice: FeatureChoiceSchema.optional(),
  /** Rollable actions this feature adds to the sheet. */
  actions: z.array(FeatureActionSchema).max(8).default([]),
  /** Effects the feature can grant, in the actor-side EffectGrant vocabulary (Rage, Bardic Inspiration). */
  effects: z.array(EffectGrantSchema).max(4).default([]),
  /** Limited uses recovered on a rest. */
  uses: FeatureUsesSchema.optional(),
  /** Flat proficiency/language/spell grants. */
  grants: FeatureGrantsSchema.optional(),
  /** Typed numeric riders. */
  modifiers: z.array(FeatureModifierSchema).max(8).default([]),
  /** This feature REPLACES an earlier one of the same id lineage (Indomitable at 9/13/17). */
  replacesFeatureId: ContentIdSchema.optional()
}).strict();
export type FeatureRecord = z.infer<typeof FeatureRecordSchema>;

// ---------------------------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------------------------

/** A "choose N from this list" proficiency grant (class skills, background tools). */
export const ChoiceListSchema = z.object({
  choose: z.number().int().min(0).max(10),
  from: z.array(ContentIdSchema).max(60).default([])
}).strict();

/** A named starting-equipment bundle ("A: chain mail and a martial weapon", "C: 155 gp"). */
export const StartingEquipmentOptionSchema = z.object({
  id: ContentIdSchema,
  label: z.string().min(1).max(200),
  items: z.array(z.object({ id: ContentIdSchema, name: z.string().min(1).max(120), quantity: z.number().int().min(1).max(99).default(1) }).strict()).max(20).default([]),
  goldPieces: z.number().int().min(0).max(1000).default(0)
}).strict();

/**
 * ONE row of a class's 20-level table. `features` lists the ids granted at that level (resolved
 * against the class's own `features[]`), and the optional columns carry whatever the printed table
 * carries: spell slots, Pact Magic, cantrips/spells known, the prepared-spell formula, and named
 * class resources (Rage 3, Ki 5, Sneak Attack 3d6, Second Wind 3).
 */
export const ClassLevelRowSchema = z.object({
  level: ContentLevelSchema,
  proficiencyBonus: z.number().int().min(2).max(6),
  features: z.array(ContentIdSchema).max(12).default([]),
  /** Nine counts, index 0 = 1st-level slots. Absent for a non-caster row. */
  spellSlots: z.array(z.number().int().min(0).max(4)).length(9).optional(),
  /** Warlock Pact Magic: one uniform slot level with its own count. */
  pactSlots: z.object({ level: z.number().int().min(1).max(9), slots: z.number().int().min(0).max(4) }).strict().optional(),
  cantripsKnown: z.number().int().min(0).max(10).optional(),
  spellsKnown: z.number().int().min(0).max(40).optional(),
  /**
   * How many spells a prepared caster has ready, as DATA: either a flat number, or the SRD formula
   * expressed declaratively ("<ability> modifier + <class> level"). Kept a short string so a homebrew
   * class can print its own wording; the builder falls back to the printed number when it cannot
   * resolve the formula.
   */
  preparedFormula: z.string().max(60).optional(),
  preparedCount: z.number().int().min(0).max(60).optional(),
  /** Named per-level resources; `amount` is a count or a dice string ("3d6" for Sneak Attack). */
  classResources: z.array(z.object({
    id: ContentIdSchema, name: z.string().min(1).max(60),
    amount: z.union([z.number().int().min(0).max(999), z.string().min(1).max(20)])
  }).strict()).max(8).default([])
}).strict();
export type ClassLevelRow = z.infer<typeof ClassLevelRowSchema>;

/** Spellcasting a class (or a third-caster subclass) grants. */
export const ContentSpellcastingSchema = z.object({
  ability: AbilitySchema,
  /** "known" = a fixed spells-known list; "prepared" = re-chosen on a long rest. */
  prepares: z.enum(["known", "prepared"]),
  ritual: z.boolean().default(false),
  /** Spellcasting focus slug ("arcane-focus", "holy-symbol", "druidic-focus"); null = none. */
  focus: ContentIdSchema.nullable().default(null),
  /** How this class's levels count toward the shared multiclass caster level. */
  multiclassProgression: z.enum(["full", "half", "third", "pact"]).default("full"),
  /** The spell list this class draws from; an open slug so homebrew lists work. */
  spellListId: ContentIdSchema.optional()
}).strict();
export type ContentSpellcasting = z.infer<typeof ContentSpellcastingSchema>;

/** Ability minimums for taking this class as a multiclass; `mode: "any"` covers "STR 13 or DEX 13". */
export const MulticlassPrerequisiteSchema = z.object({
  mode: z.enum(["all", "any"]).default("all"),
  minimums: z.array(z.object({ ability: AbilitySchema, minimum: z.number().int().min(1).max(20) }).strict()).min(1).max(6)
}).strict();

export const ClassReferenceSchema = z.object({
  ...contentRecordBase,
  hitDie: HitDieSchema,
  /**
   * Ordered ability priority, best first - the random generator's core input. Data, not code, so a
   * homebrew class supplies its own without touching `@vtt/rules-5e`.
   */
  statPriority: z.array(AbilitySchema).length(6),
  /** The class's headline ability (one, or two for Fighter/Monk/Paladin/Ranger). */
  primaryAbilities: z.array(AbilitySchema).min(1).max(2),
  /** The two saving throws granted at level 1. */
  savingThrows: z.array(AbilitySchema).min(1).max(6),
  skillChoices: ChoiceListSchema,
  armorProficiencies: z.array(ContentIdSchema).max(10).default([]),
  weaponProficiencies: z.array(ContentIdSchema).max(40).default([]),
  toolProficiencies: z.array(ContentIdSchema).max(20).default([]),
  toolChoices: ChoiceListSchema.optional(),
  startingEquipment: z.array(StartingEquipmentOptionSchema).max(6).default([]),
  /** Proficiencies gained when the class is taken as a MULTICLASS (narrower than the level-1 set). */
  multiclassProficiencies: z.object({
    armor: z.array(ContentIdSchema).max(10).default([]),
    weapons: z.array(ContentIdSchema).max(40).default([]),
    tools: z.array(ContentIdSchema).max(20).default([]),
    skills: ChoiceListSchema.optional()
  }).strict().optional(),
  multiclassPrerequisites: MulticlassPrerequisiteSchema.optional(),
  /** The level the subclass is chosen at, and what the class calls it ("Martial Archetype"). */
  subclassLevel: ContentLevelSchema,
  subclassLabel: z.string().max(60).optional(),
  /** Levels granting an Ability Score Improvement (or a feat instead). */
  asiLevels: z.array(ContentLevelSchema).max(10).default([]),
  spellcasting: ContentSpellcastingSchema.optional(),
  /** The full 20-row printed table. */
  levelTable: z.array(ClassLevelRowSchema).length(20),
  /** Every feature the level table can grant, as shared FeatureRecords. */
  features: z.array(FeatureRecordSchema).max(160).default([])
}).strict().superRefine((entry, context) => {
  entry.levelTable.forEach((row, index) => {
    if (row.level !== index + 1) context.addIssue({ code: z.ZodIssueCode.custom, path: ["levelTable", index, "level"], message: `Level table row ${index} must be level ${index + 1}.` });
  });
  const featureIds = new Set(entry.features.map((feature) => feature.id));
  entry.levelTable.forEach((row, rowIndex) => row.features.forEach((featureId, featureIndex) => {
    if (!featureIds.has(featureId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["levelTable", rowIndex, "features", featureIndex], message: `Level ${row.level} grants unknown feature "${featureId}".` });
  }));
  const duplicate = entry.features.find((feature, index) => entry.features.findIndex((other) => other.id === feature.id) !== index);
  if (duplicate) context.addIssue({ code: z.ZodIssueCode.custom, path: ["features"], message: `Duplicate feature id "${duplicate.id}".` });
});
export type ClassReference = z.infer<typeof ClassReferenceSchema>;

// ---------------------------------------------------------------------------------------------
// Subclass
// ---------------------------------------------------------------------------------------------

export const SubclassReferenceSchema = z.object({
  ...contentRecordBase,
  /** The class this subclass belongs to. */
  classId: ContentIdSchema,
  /** Level the subclass is taken at; absent = inherit the class's `subclassLevel`. */
  subclassLevel: ContentLevelSchema.optional(),
  /** Third-caster subclasses (Eldritch Knight, Arcane Trickster) declare their own spellcasting. */
  spellcasting: ContentSpellcastingSchema.optional(),
  /** Extra table rows a caster subclass overlays on the class table (its own slot columns). */
  levelTable: z.array(ClassLevelRowSchema).max(20).optional(),
  features: z.array(FeatureRecordSchema).max(40).default([])
}).strict().superRefine((entry, context) => {
  const featureIds = new Set(entry.features.map((feature) => feature.id));
  (entry.levelTable ?? []).forEach((row, rowIndex) => row.features.forEach((featureId, featureIndex) => {
    if (!featureIds.has(featureId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["levelTable", rowIndex, "features", featureIndex], message: `Level ${row.level} grants unknown feature "${featureId}".` });
  }));
});
export type SubclassReference = z.infer<typeof SubclassReferenceSchema>;

// ---------------------------------------------------------------------------------------------
// Species
// ---------------------------------------------------------------------------------------------

export const CreatureSizeSchema = z.enum(["tiny", "small", "medium", "large", "huge", "gargantuan"]);

/**
 * A playable species. NOTE the deliberate absence of hardcoded ability bonuses: SRD 5.2.1 (2024) puts
 * ability increases on the BACKGROUND, not the species. `abilityBonuses` exists anyway, as optional
 * DATA, so a 2014-style species or a homebrew one can still carry them - the builder simply applies
 * whatever a record declares instead of assuming an edition.
 */
export const SpeciesReferenceSchema = z.object({
  ...contentRecordBase,
  /** Sizes a member of this species may be; several 2024 species let the player pick Small or Medium. */
  sizes: z.array(CreatureSizeSchema).min(1).max(6).default(["medium"]),
  speedFeet: z.number().int().min(0).max(120),
  /** Darkvision range in feet; null = none. */
  darkvisionFeet: z.number().int().min(0).max(240).nullable().default(null),
  /** Creature type slug ("humanoid", "fey", "construct"). */
  creatureType: ContentIdSchema.default("humanoid"),
  /** Fixed ability increases. Empty for every SRD 5.2.1 species (see the note above). Additive data. */
  abilityBonuses: z.array(z.object({ ability: AbilitySchema, amount: z.number().int().min(-2).max(3) }).strict()).max(6).default([]),
  /** "Choose N abilities to raise by M" (the 2014 variant-human / half-elf pattern). */
  abilityBonusChoice: z.object({
    choose: z.number().int().min(1).max(6),
    amount: z.number().int().min(1).max(3),
    from: z.array(AbilitySchema).min(1).max(6).default(["str", "dex", "con", "int", "wis", "cha"])
  }).strict().optional(),
  languages: z.array(ContentIdSchema).max(10).default([]),
  languageChoices: ChoiceListSchema.optional(),
  /** Species traits, as shared FeatureRecords. */
  traits: z.array(FeatureRecordSchema).max(30).default([]),
  /** Lineages / subraces, each adding its own traits on top. */
  lineages: z.array(z.object({
    id: ContentIdSchema, name: z.string().min(1).max(120), description: z.string().max(8000).optional(),
    traits: z.array(FeatureRecordSchema).max(20).default([])
  }).strict()).max(12).default([])
}).strict();
export type SpeciesReference = z.infer<typeof SpeciesReferenceSchema>;

// ---------------------------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------------------------

export const BackgroundReferenceSchema = z.object({
  ...contentRecordBase,
  /**
   * SRD 5.2.1 ability increases: three listed abilities, distributed either +2/+1 or +1/+1/+1.
   * `spreads` states the legal distributions as data, so a homebrew background can print its own.
   */
  abilityOptions: z.object({
    from: z.array(AbilitySchema).min(1).max(6),
    spreads: z.array(z.array(z.number().int().min(1).max(3)).min(1).max(3)).min(1).max(4).default([[2, 1], [1, 1, 1]])
  }).strict().optional(),
  /** The origin feat this background grants (SRD 5.2.1). */
  originFeatId: ContentIdSchema.optional(),
  skillProficiencies: z.array(ContentIdSchema).max(10).default([]),
  skillChoices: ChoiceListSchema.optional(),
  toolProficiencies: z.array(ContentIdSchema).max(10).default([]),
  toolChoices: ChoiceListSchema.optional(),
  languages: z.array(ContentIdSchema).max(10).default([]),
  languageChoices: ChoiceListSchema.optional(),
  startingEquipment: z.array(StartingEquipmentOptionSchema).max(6).default([]),
  features: z.array(FeatureRecordSchema).max(10).default([])
}).strict();
export type BackgroundReference = z.infer<typeof BackgroundReferenceSchema>;

// ---------------------------------------------------------------------------------------------
// Feat
// ---------------------------------------------------------------------------------------------

export const FeatReferenceSchema = z.object({
  ...contentRecordBase,
  /** Open slug: "origin", "general", "fighting-style", "epic-boon", or anything homebrew adds. */
  category: ContentIdSchema.default("general"),
  prerequisite: z.object({
    level: ContentLevelSchema.optional(),
    abilityScores: z.array(z.object({ ability: AbilitySchema, minimum: z.number().int().min(1).max(20) }).strict()).max(6).default([]),
    /** Proficiency or feature slugs the character must already have ("martial", "spellcasting"). */
    requires: z.array(ContentIdSchema).max(10).default([]),
    /** Anything not modeled above, printed for the player to judge (ADR-0008 prose fallback). */
    text: z.string().max(400).optional()
  }).strict().optional(),
  repeatable: z.boolean().default(false),
  /**
   * The feat's mechanics - literally the same FeatureRecord a class or species uses. A feat IS a
   * feature plus catalog metadata; nothing about it is special-cased.
   */
  feature: FeatureRecordSchema
}).strict();
export type FeatReference = z.infer<typeof FeatReferenceSchema>;

// ---------------------------------------------------------------------------------------------
// Name pools
// ---------------------------------------------------------------------------------------------

/** Hand-authored per-species name pools (task packet decision 11) feeding the random generator. */
export const NamePoolReferenceSchema = z.object({
  speciesId: ContentIdSchema,
  source: ContentSourceSchema,
  pools: z.array(z.object({
    id: ContentIdSchema,
    /** What this pool is ("Masculine", "Feminine", "Family", "Clan", "Nickname"). */
    label: z.string().min(1).max(60),
    names: z.array(z.string().min(1).max(60)).min(1).max(400)
  }).strict()).min(1).max(10)
}).strict();
export type NamePoolReference = z.infer<typeof NamePoolReferenceSchema>;
