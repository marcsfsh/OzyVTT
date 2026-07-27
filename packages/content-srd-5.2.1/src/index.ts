/**
 * Typed access to the committed SRD 5.2.1 content bundles. Server-side only by design:
 * clients receive content through server projections/commands, never by importing this package
 * (ADR-0001 server authority; ADR-0007 canonical content format).
 */
import { createRequire } from "node:module";
import { z } from "zod";
import { ActorDefinitionSchema, type ActorDefinition } from "@vtt/schemas";
import {
  BackgroundReferenceSchema, ClassReferenceSchema, FeatReferenceSchema, NamePoolReferenceSchema,
  SpeciesReferenceSchema, SubclassReferenceSchema,
  type BackgroundReference, type ClassReference, type FeatReference, type NamePoolReference,
  type SpeciesReference, type SubclassReference
} from "./character-content.js";

/** Character-builder content shapes (classes, subclasses, species, backgrounds, feats, names). */
export * from "./character-content.js";

const require = createRequire(import.meta.url);

export const ConditionReferenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(60),
  description: z.string().min(1).max(4000)
});
export type ConditionReference = z.infer<typeof ConditionReferenceSchema>;

const AbilityShortSchema = z.enum(["str", "dex", "con", "int", "wis", "cha"]);

export const SpellReferenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(120),
  level: z.number().int().min(0).max(9),
  school: z.string().min(1).max(40),
  castingTime: z.string().min(1).max(80),
  reactionCondition: z.string().max(400).nullable(),
  range: z.object({ distance: z.number().nullable(), unit: z.string().nullable(), text: z.string().nullable() }),
  components: z.object({ verbal: z.boolean(), somatic: z.boolean(), material: z.boolean(), materialText: z.string().nullable(), materialConsumed: z.boolean() }),
  duration: z.string().min(1).max(120),
  concentration: z.boolean(),
  ritual: z.boolean(),
  attackRoll: z.boolean(),
  damage: z.object({ roll: z.string().nullable(), types: z.array(z.string()) }),
  save: AbilityShortSchema.nullable(),
  target: z.object({ type: z.string().nullable(), count: z.number().int().nullable() }),
  shape: z.object({ type: z.string(), size: z.number().nullable(), unit: z.string().nullable() }).nullable(),
  classes: z.array(z.string()),
  description: z.string().min(1).max(20000),
  higherLevel: z.string().max(4000).nullable(),
  castingOptions: z.array(z.object({ type: z.string(), damageRoll: z.string().nullable(), targetCount: z.number().int().nullable(), description: z.string().nullable() }))
});
export type SpellReference = z.infer<typeof SpellReferenceSchema>;

export const WeaponReferenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(80),
  category: z.enum(["simple", "martial"]),
  improvised: z.boolean(),
  damage: z.object({ dice: z.string().min(1).max(20), type: z.string().min(1).max(40) }),
  rangeFeet: z.number().int().positive().nullable(),
  longRangeFeet: z.number().int().positive().nullable()
});
export type WeaponReference = z.infer<typeof WeaponReferenceSchema>;

export const WeaponPropertyReferenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(60),
  kind: z.enum(["property", "mastery"]),
  description: z.string().min(1).max(4000)
});
export type WeaponPropertyReference = z.infer<typeof WeaponPropertyReferenceSchema>;

export const ArmorReferenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(80),
  /** Body armor carries its full base AC (11-18); the shield row carries its +2 bonus. */
  acBase: z.number().int().min(2).max(25),
  addDexModifier: z.boolean(),
  dexModifierCap: z.number().int().nullable(),
  stealthDisadvantage: z.boolean(),
  strengthRequired: z.number().int().nullable()
});
export type ArmorReference = z.infer<typeof ArmorReferenceSchema>;

/**
 * Unified equipment catalog entry - the framework the browse-&-add flow and the future homebrew
 * update build on. `loadEquipment` maps weapons and armor in from their own bundles; the
 * `equipment.v1.json` bundle carries adventuring gear, tools, packs, focuses, ammunition, and
 * consumables. The `weapon`/`armor` sub-objects are present only for those categories.
 */
export const EquipmentReferenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(80),
  category: z.enum(["weapon", "armor", "shield", "ammunition", "adventuring-gear", "tool", "equipment-pack", "consumable", "focus", "wondrous"]),
  costGp: z.number().nonnegative().max(1_000_000).nullable(),
  weightLb: z.number().nonnegative().max(1000).nullable(),
  description: z.string().max(2000).nullable(),
  weapon: z.object({ category: z.enum(["simple", "martial"]), damageDice: z.string().max(20), damageType: z.string().max(40), rangeFeet: z.number().int().positive().nullable(), longRangeFeet: z.number().int().positive().nullable() }).nullable().optional(),
  armor: z.object({ acBase: z.number().int().min(2).max(25), addDexModifier: z.boolean(), dexModifierCap: z.number().int().nullable(), stealthDisadvantage: z.boolean(), strengthRequired: z.number().int().nullable() }).nullable().optional()
}).strict();
export type EquipmentReference = z.infer<typeof EquipmentReferenceSchema>;

export const RuleReferenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(120),
  ruleset: z.string().min(1).max(80),
  order: z.number().int(),
  description: z.string().min(1).max(40000)
});
export type RuleReference = z.infer<typeof RuleReferenceSchema>;

export const ContentAttributionSchema = z.object({
  license: z.literal("CC-BY-4.0"),
  attribution: z.string().min(1),
  source: z.object({
    name: z.string(), author: z.string(), publisher: z.string(), permalink: z.string(),
    vendoredFrom: z.string(), retrieved: z.string()
  }),
  /**
   * Further CC BY 4.0 transcriptions the bundles draw on beyond `source`. Additive-optional so an
   * older attribution.json still validates (ADR-0007). These are SECONDARY: the CC BY attribution
   * owed to a consumer is `attribution` above - Wizards of the Coast for SRD 5.2.1 itself - and
   * these rows only record where a transcription of that text was obtained.
   */
  additionalSources: z.array(z.object({
    name: z.string(), vendoredFrom: z.string(), commit: z.string(),
    retrieved: z.string(), covers: z.string()
  })).default([])
});
export type ContentAttribution = z.infer<typeof ContentAttributionSchema>;

const cache = new Map<string, unknown>();
function loadBundle<S extends z.ZodTypeAny>(file: string, schema: S): z.output<S> {
  if (!cache.has(file)) cache.set(file, schema.parse(require(`../bundles/${file}`)));
  return cache.get(file) as z.output<S>;
}

/** All SRD 5.2.1 monster definitions, validated on first load and cached. */
export function loadMonsterDefinitions(): readonly ActorDefinition[] {
  return loadBundle("monsters.v1.json", z.array(ActorDefinitionSchema));
}

/** The 15 SRD 5.2.1 conditions as reference text (Blinded, Charmed, ... Unconscious). */
export function loadConditions(): readonly ConditionReference[] {
  return loadBundle("conditions.v1.json", z.array(ConditionReferenceSchema));
}

/** All SRD 5.2.1 spells with structured save/attack/damage/upcast fields plus full text. */
export function loadSpells(): readonly SpellReference[] {
  return loadBundle("spells.v1.json", z.array(SpellReferenceSchema));
}

/** SRD 5.2.1 weapon table (damage, category, ranges). Per-weapon property links are not in the source; see weapon properties. */
export function loadWeapons(): readonly WeaponReference[] {
  return loadBundle("weapons.v1.json", z.array(WeaponReferenceSchema));
}

/** SRD 5.2.1 weapon property and mastery descriptions (Ammunition, Finesse, Cleave, ...). */
export function loadWeaponProperties(): readonly WeaponPropertyReference[] {
  return loadBundle("weapon-properties.v1.json", z.array(WeaponPropertyReferenceSchema));
}

/** SRD 5.2.1 armor table with the fields needed to derive AC (base, dex handling, strength, stealth). */
export function loadArmor(): readonly ArmorReference[] {
  return loadBundle("armor.v1.json", z.array(ArmorReferenceSchema));
}

/**
 * A skill: reference text plus the ability its check uses. `ability` is optional-with-fallback while
 * the bundle column is being authored: a record without one falls back to the well-known SRD mapping
 * below, and a record that CARRIES one (bundle data, homebrew) always wins - so a homebrew skill is
 * one bundle row, never a code edit (the `SKILL_ABILITY` client hardcode is the anti-pattern).
 */
export const SkillReferenceSchema = ConditionReferenceSchema.extend({ ability: AbilityShortSchema.optional() });
export type SkillReference = z.infer<typeof SkillReferenceSchema>;

/** The printed SRD 5.2.1 skill->ability table, used ONLY when a bundle row omits its own `ability`. */
const SRD_SKILL_ABILITY: Readonly<Record<string, z.infer<typeof AbilityShortSchema>>> = Object.freeze({
  athletics: "str",
  acrobatics: "dex", "sleight-of-hand": "dex", stealth: "dex",
  arcana: "int", history: "int", investigation: "int", nature: "int", religion: "int",
  "animal-handling": "wis", insight: "wis", medicine: "wis", perception: "wis", survival: "wis",
  deception: "cha", intimidation: "cha", performance: "cha", persuasion: "cha"
});

/** The 18 SRD 5.2.1 skill descriptions, each with the ability its check uses (bundle column first, SRD fallback second). */
export function loadSkills(): readonly SkillReference[] {
  return loadBundle("skills.v1.json", z.array(SkillReferenceSchema)).map((skill) => (
    skill.ability ? skill : { ...skill, ability: SRD_SKILL_ABILITY[skill.id] }
  ));
}

/**
 * The full addable-equipment catalog: the vendored gear/tools/packs/focus bundle plus every weapon
 * and armor mapped from their own bundles into the unified shape. Sorted by name. Extensible - the
 * homebrew update adds entries alongside these.
 */
export function loadEquipment(): readonly EquipmentReference[] {
  // Normalize the hand-authored gear so every catalog entry has a uniform shape - `weapon`/`armor`
  // are always present (null when absent), so a consumer can branch on `item.weapon === null`.
  const gear: EquipmentReference[] = loadBundle("equipment.v1.json", z.array(EquipmentReferenceSchema)).map((item) => ({
    ...item, weapon: item.weapon ?? null, armor: item.armor ?? null
  }));
  const weapons: EquipmentReference[] = loadWeapons().filter((weapon) => !weapon.improvised).map((weapon) => ({
    id: weapon.id, name: weapon.name, category: "weapon", costGp: null, weightLb: null, description: null,
    weapon: { category: weapon.category, damageDice: weapon.damage.dice, damageType: weapon.damage.type, rangeFeet: weapon.rangeFeet, longRangeFeet: weapon.longRangeFeet }, armor: null
  }));
  const armor: EquipmentReference[] = loadArmor().map((piece) => ({
    id: piece.id, name: piece.name, category: piece.acBase <= 3 ? "shield" : "armor", costGp: null, weightLb: null, description: null,
    weapon: null, armor: { acBase: piece.acBase, addDexModifier: piece.addDexModifier, dexModifierCap: piece.dexModifierCap, stealthDisadvantage: piece.stealthDisadvantage, strengthRequired: piece.strengthRequired }
  }));
  return [...gear, ...weapons, ...armor].sort((left, right) => left.name.localeCompare(right.name));
}

/** The 13 SRD 5.2.1 damage-type descriptions. */
export function loadDamageTypes(): readonly ConditionReference[] {
  return loadBundle("damage-types.v1.json", z.array(ConditionReferenceSchema));
}

/** SRD 5.2.1 core rules text grouped by ruleset (D20 Tests, Combat, Damage and Healing, ...). */
export function loadRules(): readonly RuleReference[] {
  return loadBundle("rules.v1.json", z.array(RuleReferenceSchema));
}

/** CC BY 4.0 attribution that must accompany any surface displaying this content. */
export function loadAttribution(): ContentAttribution {
  return loadBundle("attribution.json", ContentAttributionSchema);
}

// ---------------------------------------------------------------------------------------------
// Character-builder bundles.
//
// SEED CONTENT WARNING: the six bundles below currently carry a small, deliberately partial slice of
// the SRD (task packet phase 1.1) - enough real entries to prove the schemas parse and the loaders
// work while the wizard, the rules math, and the UI are built against them in parallel. Full
// transcription (12 classes x 20 levels, 12 subclasses, 9 species, 4 backgrounds, ~20 feats) is
// phases 2 and 5. Do NOT read a missing class as a schema gap.
// ---------------------------------------------------------------------------------------------

/** Playable classes with their 20-row level tables and features-as-data. */
export function loadClasses(): readonly ClassReference[] {
  return loadBundle("classes.v1.json", z.array(ClassReferenceSchema));
}

/** Subclasses, each pointing at its parent `classId`. */
export function loadSubclasses(): readonly SubclassReference[] {
  return loadBundle("subclasses.v1.json", z.array(SubclassReferenceSchema));
}

/** Playable species (size, speed, darkvision, traits); ability increases live on backgrounds in SRD 5.2.1. */
export function loadSpecies(): readonly SpeciesReference[] {
  return loadBundle("species.v1.json", z.array(SpeciesReferenceSchema));
}

/** Backgrounds (ability-score options, origin feat, proficiencies, starting equipment). */
export function loadBackgrounds(): readonly BackgroundReference[] {
  return loadBundle("backgrounds.v1.json", z.array(BackgroundReferenceSchema));
}

/** Feats; each carries its mechanics as an ordinary FeatureRecord. */
export function loadFeats(): readonly FeatReference[] {
  return loadBundle("feats.v1.json", z.array(FeatReferenceSchema));
}

/** Hand-authored per-species name pools feeding the random generator. */
export function loadNames(): readonly NamePoolReference[] {
  return loadBundle("names.v1.json", z.array(NamePoolReferenceSchema));
}

/** Subclasses belonging to one class, in bundle order. */
export function subclassesForClass(classId: string): readonly SubclassReference[] {
  return loadSubclasses().filter((subclass) => subclass.classId === classId);
}

/** Name pools for one species, or undefined when that species has none authored yet. */
export function namesForSpecies(speciesId: string): NamePoolReference | undefined {
  return loadNames().find((pool) => pool.speciesId === speciesId);
}
