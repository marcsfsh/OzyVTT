/**
 * Typed access to the committed SRD 5.2.1 content bundles. Server-side only by design:
 * clients receive content through server projections/commands, never by importing this package
 * (ADR-0001 server authority; ADR-0007 canonical content format).
 */
import { createRequire } from "node:module";
import { z } from "zod";
import { ActorDefinitionSchema, type ActorDefinition } from "@vtt/schemas";

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
  })
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

/** The 18 SRD 5.2.1 skill descriptions. */
export function loadSkills(): readonly ConditionReference[] {
  return loadBundle("skills.v1.json", z.array(ConditionReferenceSchema));
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
