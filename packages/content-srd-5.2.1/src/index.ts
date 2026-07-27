/**
 * Typed access to the committed SRD 5.2.1 content bundles. Server-side only by design:
 * clients receive content through server projections/commands, never by importing this package
 * (ADR-0001 server authority; ADR-0007 canonical content format).
 */
import { createRequire } from "node:module";
import { z } from "zod";
import { AbilitySchema, ActorDefinitionSchema, ItemSlotSchema, type ActorDefinition } from "@vtt/schemas";
import {
  BackgroundReferenceSchema, ClassReferenceSchema, ContentIdSchema, ContentSourceSchema, FeatReferenceSchema,
  FeatureUsesSchema, ITEM_REFUSED_MODIFIER_MESSAGE, ITEM_REFUSED_MODIFIER_TYPES, NamePoolReferenceSchema,
  SpeciesReferenceSchema, SubclassReferenceSchema, featureRiders,
  type BackgroundReference, type ClassReference, type FeatReference, type NamePoolReference,
  type SpeciesReference, type SubclassReference
} from "./character-content.js";

/** Character-builder content shapes (classes, subclasses, species, backgrounds, feats, names, spell lists). */
export * from "./character-content.js";
/** Spell-list membership as an overlay over the generated spell bundle - applied at the content merge point. */
export * from "./spell-lists.js";

const require = createRequire(import.meta.url);

/**
 * ONE SOURCE DISCRIMINATOR, on every reference record in this package (`character-content.ts`
 * principle 2). `ContentSourceSchema` defaults to `"srd"`, so every committed bundle row parses
 * unchanged and comes out tagged `"srd"` - zero data migration, and no bundle is rewritten
 * (`build-bundle.ts` validates but writes the RAW ETL records, never the parsed output).
 *
 * Declaring the field is what makes it real: these schemas are plain `z.object`, whose Zod default
 * is STRIP, so writing `source: "homebrew"` into a record whose schema does not declare it vanishes
 * silently - no error, no field. The record schemas below are the authoritative list of what a
 * homebrew author may write.
 *
 * MONSTERS ARE DELIBERATELY ABSENT. `ActorDefinitionSchema.source` (`@vtt/schemas`) already exists
 * as a PROVENANCE object `{name, version, externalId?}` - the name is taken, and a sibling
 * `contentSource` key would be a second thing meaning the same thing. Homebrew-ness for a monster is
 * derived where the merge happens (the server knows which definitions came from the homebrew slice),
 * which needs no `ActorDefinition` change and so no ADR-0008 JSON-Schema mirror change either.
 */
export const ConditionReferenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(60),
  source: ContentSourceSchema,
  description: z.string().min(1).max(4000)
});
export type ConditionReference = z.infer<typeof ConditionReferenceSchema>;

const AbilityShortSchema = z.enum(["str", "dex", "con", "int", "wis", "cha"]);

export const SpellReferenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(120),
  source: ContentSourceSchema,
  /**
   * Credit line for a homebrew spell whose text came from somewhere else. SRD rows leave it unset
   * and inherit the bundle-wide CC BY notice; a surface that hardcodes "SRD 5.2.1, CC BY 4.0" on
   * every card makes a false claim about a homebrew one.
   */
  attribution: z.string().max(400).optional(),
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
  source: ContentSourceSchema,
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
  source: ContentSourceSchema,
  kind: z.enum(["property", "mastery"]),
  description: z.string().min(1).max(4000)
});
export type WeaponPropertyReference = z.infer<typeof WeaponPropertyReferenceSchema>;

export const ArmorReferenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(80),
  source: ContentSourceSchema,
  /** Body armor carries its full base AC (11-18); the shield row carries its +2 bonus. */
  acBase: z.number().int().min(2).max(25),
  addDexModifier: z.boolean(),
  dexModifierCap: z.number().int().nullable(),
  stealthDisadvantage: z.boolean(),
  strengthRequired: z.number().int().nullable()
});
export type ArmorReference = z.infer<typeof ArmorReferenceSchema>;

/**
 * A spell an item can cast ("cast Message once per day while attuned"). Needs no new machinery: the
 * builder already collapses a `FeatureUses` into the live `actionUses` namespace, and rests already
 * re-arm it - an item cast is one more synthesised action keyed by `uses.pool` or its action id.
 *
 * "Once per day" is `uses: {limit: 1, per: "long-rest"}`. `FeatureUsesSchema.per` has no `"day"` and
 * should not gain one: this app already treats a long rest as the day (legendary resistances say so
 * in as many words). That belongs in the authoring help text, not in a ninth enum value.
 */
export const ItemSpellCastSchema = z.object({
  spellId: ContentIdSchema,
  /** Cast at this slot level; absent = the spell's own level. */
  atLevel: z.number().int().min(0).max(9).optional(),
  /** Which ability powers it; absent = the wielder's own spellcasting ability. */
  ability: AbilitySchema.optional(),
  /** A flat printed DC ("save DC 15"), overriding any derivation. */
  saveDc: z.number().int().min(1).max(40).optional(),
  /** Charges. Share one pool across several casts with `uses.pool`. */
  uses: FeatureUsesSchema.optional(),
  /** Whether casting it also spends one of the bearer's own spell slots. */
  consumesSpellSlot: z.boolean().default(false)
}).strict();
export type ItemSpellCast = z.infer<typeof ItemSpellCastSchema>;

/**
 * Attunement. `restrictedTo` matches class ids or a species id and is ADVISORY - shown on the sheet
 * ("Requires attunement by a cleric"), never a block. It is an open slug set, blocking on a fuzzy
 * match would be wrong, and a GM handing a player a restricted item on purpose is a normal table
 * event, not an error to refuse.
 */
export const ItemAttunementSchema = z.object({
  required: z.boolean().default(false),
  restrictedTo: z.array(ContentIdSchema).max(8).default([])
}).strict();
export type ItemAttunement = z.infer<typeof ItemAttunementSchema>;

/**
 * Unified equipment catalog entry - the framework the browse-&-add flow and the homebrew update
 * build on. `loadEquipment` maps weapons and armor in from their own bundles; the
 * `equipment.v1.json` bundle carries adventuring gear, tools, packs, focuses, ammunition, and
 * consumables. The `weapon`/`armor` sub-objects are present only for those categories.
 *
 * THIS RECORD KEEPS `.strict()`, alone among the content schemas, ON PURPOSE. The two failure modes
 * are opposite and both real: a strict schema THROWS on an undeclared key, a plain one LOSES it
 * without a trace. For a hand-authored homebrew item, throwing is the useful half - it is the only
 * thing in the system that catches `weight` for `weightLb`. The fix for a field you want is to
 * DECLARE it here, never to drop the strictness - which is exactly what the magic-item block below
 * does: `isMagic`, `slot` and `modifiers` were REJECTED by this schema until they were declared.
 *
 * The riders live HERE, on the catalog record, and never on the carried `InventoryItem` row. The
 * owner is handed their whole inventory verbatim in their projection, so a rider mirrored onto that
 * row would reach the player the instant they picked the item up - which is what makes hiding a
 * cursed item's mechanics structural rather than a `delete` someone has to remember.
 */
export const EquipmentReferenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(80),
  source: ContentSourceSchema,
  /**
   * What KIND of thing this is, as an open slug - never a closed enum (`character-content.ts`
   * principle 3). Homebrew declares "relic", "vehicle", "trinket" with no schema change, and the
   * live-play side (`InventoryItemSchema.category`) has always been an open slug, so this makes the
   * catalog consistent with the actor rather than the reverse.
   *
   * The four values the ENGINE reads are "weapon", "armor", "shield" and everything-else: AC
   * derivation, what starts equipped, and the `weapons` catalog slug all compare against those
   * literals. A homebrew category is therefore inert by design until an explicit mechanical `slot`
   * field lands - it displays and stacks, it does not derive AC or an attack.
   */
  category: z.string().regex(/^[a-z0-9-]+$/).max(40),
  costGp: z.number().nonnegative().max(1_000_000).nullable(),
  weightLb: z.number().nonnegative().max(1000).nullable(),
  description: z.string().max(2000).nullable(),
  weapon: z.object({ category: z.enum(["simple", "martial"]), damageDice: z.string().max(20), damageType: z.string().max(40), rangeFeet: z.number().int().positive().nullable(), longRangeFeet: z.number().int().positive().nullable() }).nullable().optional(),
  armor: z.object({ acBase: z.number().int().min(2).max(25), addDexModifier: z.boolean(), dexModifierCap: z.number().int().nullable(), stealthDisadvantage: z.boolean(), strengthRequired: z.number().int().nullable() }).nullable().optional(),

  // ---- the magic-item vocabulary ---------------------------------------------------------------
  // Declaring these is what makes them real. This schema is `.strict()`, so until now `isMagic`,
  // `slot` and `modifiers` were REJECTED outright rather than quietly dropped; the fix for a field
  // you want has always been to declare it here.

  /** WHERE it is worn or held. Absent = fall back to `category` for the three the engine already knows. */
  slot: ItemSlotSchema.optional(),
  /** Display and filtering only ("uncommon", "legendary"). An OPEN slug - rarity is identity, not a mechanical hook. */
  rarity: ContentIdSchema.optional(),
  isMagic: z.boolean().default(false),
  attunement: ItemAttunementSchema.optional(),
  /**
   * A cursed item cannot be voluntarily removed once attuned, and its magic half is withheld from
   * the player until attunement. HIDDEN UNTIL ATTUNEMENT, AND NOTHING MORE: from the moment of
   * attunement the player sees everything, including the derived numbers, because they have already
   * learned it - hiding further would only make their own sheet lie to them.
   */
  cursed: z.boolean().default(false),
  /** Spells the item can cast (Amulet of Message, Wand of Fireballs). */
  casts: z.array(ItemSpellCastSchema).max(8).default([]),
  /**
   * Feats the item grants while active. Depth 1, no transitive expansion, and the grant edge is
   * one-directional - no feature, feat, or option ever gains a `grants.items` - so a cycle cannot be
   * drawn rather than merely being checked for.
   */
  grantsFeatIds: z.array(ContentIdSchema).max(4).default([]),

  /**
   * The SAME rider block a feature, a feat, and a chosen option carry: `tags`, `actions`, `effects`,
   * `uses` (an item's charges), `grants`, `modifiers`. Spread, not restated - which is what makes
   * "a feat carries the same buffs and debuffs an item does" true by construction.
   */
  ...featureRiders
}).strict().superRefine((item, context) => {
  // A curse you can drop by taking the hat off is not a curse. Requiring attunement also gives the
  // hiding rule ONE well-defined boundary instead of two: hidden until attuned, visible after.
  if (item.cursed && item.attunement?.required !== true) {
    context.addIssue({
      code: z.ZodIssueCode.custom, path: ["cursed"],
      message: "A cursed item must require attunement - attunement is both what springs the curse and what reveals it."
    });
  }
  // The one refusal, enforced HERE rather than in a publish-time validator, because the carrier is
  // what makes it a refusal: the identical rider on a feat is fine and must stay parseable.
  item.modifiers.forEach((modifier, index) => {
    if (ITEM_REFUSED_MODIFIER_TYPES.includes(modifier.type)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["modifiers", index, "type"], message: ITEM_REFUSED_MODIFIER_MESSAGE });
    }
  });
});
export type EquipmentReference = z.infer<typeof EquipmentReferenceSchema>;

export const RuleReferenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(120),
  source: ContentSourceSchema,
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
  // A mundane SRD row's magic-item fields, spelled once. `EquipmentReferenceSchema` gives these
  // `.default()`s, which makes them REQUIRED on the parsed output type - and these two rows are
  // hand-built object literals rather than parsed, so they have to state them.
  const mundane = (): Pick<EquipmentReference, "isMagic" | "cursed" | "casts" | "grantsFeatIds" | "tags" | "actions" | "effects" | "modifiers"> =>
    ({ isMagic: false, cursed: false, casts: [], grantsFeatIds: [], tags: [], actions: [], effects: [], modifiers: [] });
  // The mapped-in rows carry their OWN bundle's source through the fold, so a homebrew weapon or
  // armor row stays homebrew once it is in the unified catalog. They also stamp `slot`, the
  // mechanical hook, alongside the `category` slug they already stamped - a no-op today (every
  // consumer still falls back to `category`) and what makes an open homebrew category derive AC.
  const weapons: EquipmentReference[] = loadWeapons().filter((weapon) => !weapon.improvised).map((weapon) => ({
    id: weapon.id, name: weapon.name, source: weapon.source, category: "weapon", slot: "weapon", costGp: null, weightLb: null, description: null,
    weapon: { category: weapon.category, damageDice: weapon.damage.dice, damageType: weapon.damage.type, rangeFeet: weapon.rangeFeet, longRangeFeet: weapon.longRangeFeet }, armor: null,
    ...mundane()
  }));
  const armor: EquipmentReference[] = loadArmor().map((piece) => ({
    id: piece.id, name: piece.name, source: piece.source, category: piece.acBase <= 3 ? "shield" : "armor", slot: piece.acBase <= 3 ? "shield" : "armor", costGp: null, weightLb: null, description: null,
    weapon: null, armor: { acBase: piece.acBase, addDexModifier: piece.addDexModifier, dexModifierCap: piece.dexModifierCap, stealthDisadvantage: piece.stealthDisadvantage, strengthRequired: piece.strengthRequired },
    ...mundane()
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
