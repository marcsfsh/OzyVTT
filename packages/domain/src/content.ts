import { z } from "zod";
import {
  AbilitySchema,
  AmmunitionKindSchema,
  HitDieSchema,
  PickBudgetScalingSchema,
  type ActionReaction,
  type DamageType
} from "@vtt/schemas";
import type { Wire } from "./wire.js";

/** An open identity slug; ids are never closed enums, so homebrew stays additive. */
const slug = (max = 80) =>
  z
    .string()
    .max(max)
    .regex(/^[a-z0-9-]+$/);
const level = () => z.number().int().min(1).max(20);

/** Compact browse row for bundled monster content; the server maps content definitions into this wire shape. */
export const ContentMonsterSummarySchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  challengeRating: z.number(),
  /** XP for defeating it, for the encounter budget; null for a homebrew CR the SRD table doesn't list. */
  experiencePoints: z.number().int().nullable(),
  type: z.string(),
  size: z.string(),
  armorClass: z.number().int(),
  hitPoints: z.number().int()
});
export type ContentMonsterSummary = Wire<z.infer<typeof ContentMonsterSummarySchema>>;
export type ContentMonstersResult = {
  ok: boolean;
  message?: string;
  monsters?: readonly ContentMonsterSummary[];
  attribution?: string;
};
/** One Rules Glossary term for the in-app rules reference; public information for any joined session. */
export const ContentGlossaryEntrySchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  /** The bracketed family the SRD gives the term ("Condition", "Action", "Hazard"), or null. */
  tag: z.string().nullable(),
  description: z.string()
});
export type ContentGlossaryEntry = Wire<z.infer<typeof ContentGlossaryEntrySchema>>;
export type ContentGlossaryResult = {
  ok: boolean;
  message?: string;
  glossary?: readonly ContentGlossaryEntry[];
  attribution?: string;
};
/** SRD condition reference (name + rules text) for pickers and tooltips; public information for any joined session. */
export const ContentConditionSummarySchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  description: z.string()
});
export type ContentConditionSummary = Wire<z.infer<typeof ContentConditionSummarySchema>>;
export type ContentConditionsResult = {
  ok: boolean;
  message?: string;
  conditions?: readonly ContentConditionSummary[];
  /** The bundle's canonical CC BY 4.0 line (ADR-0015). */ attribution?: string;
};
/** One upcast or cantrip-scaling row: the roll and target count at that level. */
const scalingRow = { damageRoll: z.string().nullable(), targetCount: z.number().int().nullable() };
/** SRD spell reference (rules text + the header fields a card shows) for the in-app spell rules window; public information for any joined session. */
export const ContentSpellSummarySchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  level: z.number().int().min(0).max(9),
  school: z.string(),
  castingTime: z.string(),
  rangeText: z.string().nullable(),
  /** Whether casting it rolls an attack (the `fromPicks` predicate for Repelling Blast's "cantrip that requires an attack roll"). */
  attackRoll: z.boolean(),
  /** Range in feet when the printed range is a distance, else null (Self and Touch are not zero). Read by the `ranged` predicate. */
  rangeFeet: z.number().int().nullable(),
  componentsText: z.string(),
  duration: z.string(),
  concentration: z.boolean(),
  ritual: z.boolean(),
  description: z.string(),
  higherLevel: z.string().nullable(),
  /** Spell-list ids ("wizard", a homebrew list slug); the wizard's spell step matches `ContentClassSummary.spellcasting.spellListId`. */
  classes: z.array(z.string()),
  /** Base damage/healing roll ("8d6"), or null for a spell that rolls nothing. Drives the sheet's "cast at" auto-roll. */
  damageRoll: z.string().nullable(),
  /** Damage types for the base roll (empty for healing/none). */
  damageTypes: z.array(z.string()),
  /** Per-slot-level upcast scaling parsed from the SRD (Fireball's 9d6 at 4th); the sheet applies the entry for the cast level. */
  castingOptions: z.array(z.strictObject({ level: z.number().int().min(1).max(9), ...scalingRow })),
  /** A cantrip's character-level scaling (Fire Bolt's 2d10 at 5, Eldritch Blast's 2 beams); empty otherwise. */
  cantripScaling: z.array(z.strictObject({ characterLevel: level(), ...scalingRow }))
});
export type ContentSpellSummary = Wire<z.infer<typeof ContentSpellSummarySchema>>;
export type ContentSpellsResult = {
  ok: boolean;
  message?: string;
  spells?: readonly ContentSpellSummary[];
  /** The bundle's canonical CC BY 4.0 line (ADR-0015). */ attribution?: string;
};
/** One addable-equipment catalog row (SRD gear, weapons and armor in one shape). `category` is an open slug;
 * only "weapon", "armor" and "shield" drive AC and attack derivation, so group by the data, not a closed list.
 * `weapon` also carries browse-only `mastery`, which must not be copied onto an inventory row
 * (`ItemWeaponSchema` is strict); `inventoryWeaponFrom` does the conversion. */
export const ContentEquipmentSummarySchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  costGp: z.number().nullable(),
  weightLb: z.number().nullable(),
  description: z.string().nullable(),
  weapon: z
    .strictObject({
      category: z.enum(["simple", "martial"]),
      damageDice: z.string(),
      damageType: z.string(),
      rangeFeet: z.number().int().nullable(),
      longRangeFeet: z.number().int().nullable(),
      /** Melee or ranged weapon (the Weapons table's band); absent on homebrew that doesn't say. */
      melee: z.boolean().optional(),
      /** A Versatile weapon's two-handed die. */
      versatileDice: z.string().optional(),
      /** What an Ammunition weapon fires ("arrow", "bolt"). */
      ammunition: AmmunitionKindSchema.optional(),
      mastery: z.enum(["cleave", "graze", "nick", "push", "sap", "slow", "topple", "vex"]).optional(),
      properties: z.array(slug(40)).max(12).optional()
    })
    .nullable(),
  armor: z
    .strictObject({
      acBase: z.number().int(),
      addDexModifier: z.boolean(),
      dexModifierCap: z.number().int().nullable(),
      stealthDisadvantage: z.boolean(),
      strengthRequired: z.number().int().nullable()
    })
    .nullable(),
  appliesTo: z.strictObject({ label: z.string(), baseIds: z.array(slug(60)).min(1).max(40) }).nullable(),
  /** The damage types the GM may pick for the item's resistance ("The GM chooses the type"). */
  damageTypeChoice: z.array(slug(20)).max(13).optional(),
  /** A Spell Scroll: the spell levels one copy can bear, as its name prints them; the pick is the row's `spellId`. */
  spellScroll: z.strictObject({ minLevel: z.number().int(), maxLevel: z.number().int() }).optional()
});
export type ContentEquipmentSummary = Wire<z.infer<typeof ContentEquipmentSummarySchema>>;
export type ContentEquipmentResult = {
  ok: boolean;
  message?: string;
  equipment?: readonly ContentEquipmentSummary[];
  attribution?: string;
};

// ---------- Character-builder catalogs ----------
// Public SRD rules reference, readable by any joined session. Every response carries the CC BY 4.0
// `attribution` line the displaying surface must show (ADR-0015).

/** Where a catalog record came from. SRD and GM homebrew are merged server-side into one catalog. */
const ContentSourceKindSchema = z.enum(["srd", "homebrew"]);
export type ContentSourceKind = z.infer<typeof ContentSourceKindSchema>;
/** One budget a feature or option raises: "one extra Cleric cantrip" is `{offer: "class-cantrips", amount: 1}`.
 * `offer` is an offer key shared with the server, which rejects keys naming no real offer. */
export const ContentExtraPickSummarySchema = z.strictObject({
  offer: z.string().max(80),
  /** A flat number of extra picks; null when `scaling` states it instead. Exactly one of the two is set. */
  amount: z.number().int().min(1).max(5).nullable(),
  /** A budget that follows a class-table column (Eldritch Invocations 1 → 10), resolved with `extraPickAmount`. */
  scaling: PickBudgetScalingSchema.nullable()
});
export type ContentExtraPickSummary = Wire<z.infer<typeof ContentExtraPickSummarySchema>>;
/** One inline option of a feature's pick: its authored name and any second-order pick it owes (Divine Order's
 * "thaumaturge" grants an extra cantrip). Riders (actions, grants, modifiers, uses) stay server-side. */
export const ContentFeatureOptionSummarySchema = z.strictObject({
  id: slug(),
  name: z.string(),
  description: z.string(),
  /** The earlier pick that makes this option legal (Blessed Strikes), or null. The wizard filters like the server:
   * if gating leaves exactly as many options as picks, the answer is a consequence and no pick is shown. */
  requires: z.strictObject({ offer: z.string(), id: slug() }).nullable(),
  /** Every pick this option owes, in authored order. */
  get choices(): z.ZodArray<typeof ContentFeatureChoiceSummarySchema> {
    return z.array(ContentFeatureChoiceSummarySchema);
  },
  extraPicks: z.array(ContentExtraPickSummarySchema)
});
export type ContentFeatureOptionSummary = Wire<z.infer<typeof ContentFeatureOptionSummarySchema>>;
export const ContentFeatureChoiceSummarySchema = z.strictObject({
  kind: slug(),
  choose: z.number().int().min(1).max(10),
  from: z.array(slug()),
  fromCatalog: z.string().nullable(),
  /** Ceiling on a spell pick's level (Evocation Savant: level 2 and under; Magic Initiate: cantrips). Null = none. */
  maxSpellLevel: z.number().int().min(0).max(9).nullable(),
  /** Floor on a spell pick's level (Mystic Arcanum: both 6 means exactly level 6). Null = none. */
  minSpellLevel: z.number().int().min(0).max(9).nullable(),
  /** Options drawn from the character's own earlier picks; `offer` names the budget, `where` a predicate slug. */
  fromPicks: z
    .strictObject({
      offer: z.string(),
      where: z.enum(["deals-damage", "attack-roll", "ranged", "ranged-damage"]).nullable()
    })
    .nullable(),
  /** Inline options with their names and any nested pick. Empty when the options come from `fromCatalog` or are plain ids in `from`. */
  get options(): z.ZodArray<typeof ContentFeatureOptionSummarySchema> {
    return z.array(ContentFeatureOptionSummarySchema);
  }
});
export type ContentFeatureChoiceSummary = Wire<z.infer<typeof ContentFeatureChoiceSummarySchema>>;
/** A class/subclass/species/background/feat feature as browse-and-pick data. Riders stay server-side. */
export const ContentFeatureSummarySchema = z.strictObject({
  id: slug(),
  name: z.string(),
  level: level().nullable(),
  description: z.string(),
  tags: z.array(slug()),
  /** Every pick this feature asks for, in authored order (Magic Initiate owes two cantrips and one level-1 spell). */
  choices: z.array(ContentFeatureChoiceSummarySchema),
  /** Every class level that grants this feature: the repeat count (server capacity is choose × grants).
   * Empty for features not granted by a class table (species traits, feats, subclass features). */
  grantedAtLevels: z.array(level()),
  extraPicks: z.array(ContentExtraPickSummarySchema)
});
export type ContentFeatureSummary = Wire<z.infer<typeof ContentFeatureSummarySchema>>;
/** One row of a class's printed 20-level table, display only. `null` means the class has no such column. */
const ContentClassLevelRowSchema = z.strictObject({
  level: level(),
  proficiencyBonus: z.number().int().min(2).max(6),
  spellSlots: z.array(z.number().int().min(0).max(4)).min(9).max(9).nullable(),
  pactSlots: z
    .strictObject({ level: z.number().int().min(1).max(9), slots: z.number().int().min(0).max(4) })
    .nullable(),
  cantripsKnown: z.number().int().min(0).max(10).nullable(),
  spellsKnown: z.number().int().min(0).max(40).nullable(),
  preparedFormula: z.string().nullable(),
  preparedCount: z.number().int().min(0).max(60).nullable(),
  classResources: z.array(
    z.strictObject({
      id: slug(),
      name: z.string(),
      amount: z.union([z.number().int().min(0).max(999), z.string().max(20)])
    })
  )
});
export type ContentClassLevelRow = Wire<z.infer<typeof ContentClassLevelRowSchema>>;
/** A starting-equipment bundle with resolvable contents; `goldPieces` is the "or take N gp" alternative. */
const ContentStartingEquipmentOptionSchema = z.strictObject({
  id: slug(),
  label: z.string(),
  items: z.array(z.strictObject({ id: slug(), name: z.string(), quantity: z.number().int().min(1).max(99) })),
  goldPieces: z.number().int().min(0).max(1000)
});
export type ContentStartingEquipmentOption = Wire<z.infer<typeof ContentStartingEquipmentOptionSchema>>;
/** A "choose N from this list" proficiency grant, exactly as authored (class tool choices, background skill/tool/language choices). */
const ContentChoiceListSchema = z.strictObject({
  choose: z.number().int().min(0).max(10),
  from: z.array(slug()),
  /** An open catalog slug supplying options instead of or beside `from`, resolved by `resolveCatalogChoice`
   * ("two languages from the Standard Languages table"). Null when `from` names them outright. */
  fromCatalog: z.string().nullable()
});
export type ContentChoiceList = Wire<z.infer<typeof ContentChoiceListSchema>>;
const ProgressionSchema = z.enum(["full", "half", "third", "pact"]);
/** A spellcasting header. `spellListId` pairs with `ContentSpellSummary.classes`. */
const ContentSpellcastingSummarySchema = z.strictObject({
  ability: AbilitySchema,
  prepares: z.enum(["known", "prepared"]),
  ritual: z.boolean(),
  focus: z.string().nullable(),
  progression: ProgressionSchema,
  spellListId: z.string().nullable()
});
export type ContentSpellcastingSummary = Wire<z.infer<typeof ContentSpellcastingSummarySchema>>;
/** Who a catalog record is and where it came from, shared by every builder catalog row. */
const catalogIdentity = {
  id: slug(),
  name: z.string(),
  source: ContentSourceKindSchema,
  summary: z.string().nullable(),
  description: z.string().nullable()
};
/** One playable class. `hitDie` keys the multiclass hit-dice pool; `statPriority` drives the random generator. */
export const ContentClassSummarySchema = z.strictObject({
  ...catalogIdentity,
  hitDie: HitDieSchema,
  statPriority: z.array(AbilitySchema),
  primaryAbilities: z.array(AbilitySchema),
  savingThrows: z.array(AbilitySchema),
  skillChoiceCount: z.number().int().min(0).max(10),
  skillChoices: z.array(slug()),
  /** Granted armor/weapon/tool training as open slugs ("light", "martial", "thieves-tools"). */
  armorProficiencies: z.array(slug()),
  weaponProficiencies: z.array(slug()),
  toolProficiencies: z.array(slug()),
  /** "Choose N tools" where the class offers one (Monk-style); null otherwise. */
  toolChoices: ContentChoiceListSchema.nullable(),
  /** Proficiencies gained when this class is taken as a multiclass (narrower than the level-1 set); null when none. */
  multiclassProficiencies: z
    .strictObject({
      armor: z.array(slug()),
      weapons: z.array(slug()),
      tools: z.array(slug()),
      skillChoices: ContentChoiceListSchema.nullable(),
      /** "One Musical Instrument of your choice" (Bard); null when the class keeps no tool pick. */
      toolChoices: ContentChoiceListSchema.nullable()
    })
    .nullable(),
  /** Ability minimums for multiclassing into this class; `mode: "any"` covers "STR 13 or DEX 13". Null = always allowed. Display only; the server re-validates. */
  multiclassPrerequisites: z
    .strictObject({
      mode: z.enum(["all", "any"]),
      minimums: z.array(z.strictObject({ ability: AbilitySchema, minimum: level() }))
    })
    .nullable(),
  subclassLevel: level(),
  subclassLabel: z.string().nullable(),
  asiLevels: z.array(level()),
  spellcastingAbility: z.string().nullable(),
  spellcastingProgression: ProgressionSchema.nullable(),
  spellcasting: ContentSpellcastingSummarySchema.nullable(),
  levelTable: z.array(ContentClassLevelRowSchema),
  startingEquipmentOptions: z.array(ContentStartingEquipmentOptionSchema),
  features: z.array(ContentFeatureSummarySchema)
});
export type ContentClassSummary = Wire<z.infer<typeof ContentClassSummarySchema>>;
export type ContentClassesResult = {
  ok: boolean;
  message?: string;
  classes?: readonly ContentClassSummary[];
  attribution?: string;
};
/** One subclass, keyed to its parent `classId`. `subclassLevel` is null when it simply inherits the class's own subclass level. */
export const ContentSubclassSummarySchema = z.strictObject({
  id: slug(),
  name: z.string(),
  source: ContentSourceKindSchema,
  classId: slug(),
  summary: z.string().nullable(),
  description: z.string().nullable(),
  subclassLevel: level().nullable(),
  spellcastingAbility: z.string().nullable(),
  spellcastingProgression: ProgressionSchema.nullable(),
  /** Third-caster subclasses (Eldritch Knight, Arcane Trickster) declare their own header, same shape as a class's; null otherwise. */
  spellcasting: ContentSpellcastingSummarySchema.nullable(),
  features: z.array(ContentFeatureSummarySchema)
});
export type ContentSubclassSummary = Wire<z.infer<typeof ContentSubclassSummarySchema>>;
export type ContentSubclassesResult = {
  ok: boolean;
  message?: string;
  subclasses?: readonly ContentSubclassSummary[];
  attribution?: string;
};
/** One playable species. `sizes` is a list because several 2024 species let the player pick. SRD 5.2.1 puts ability increases on the background. */
export const ContentSpeciesSummarySchema = z.strictObject({
  ...catalogIdentity,
  sizes: z.array(z.enum(["tiny", "small", "medium", "large", "huge", "gargantuan"])),
  speedFeet: z.number().int().min(0).max(120),
  darkvisionFeet: z.number().int().nullable(),
  creatureType: slug(),
  /** Fixed ability increases; empty for SRD 5.2.1 species, used by 2014-style or homebrew records. */
  abilityBonuses: z.array(z.strictObject({ ability: AbilitySchema, amount: z.number().int().min(-2).max(3) })),
  /** "Choose N abilities to raise by M" (the 2014 variant-human / half-elf pattern); null when the species has none. */
  abilityBonusChoice: z
    .strictObject({
      choose: z.number().int().min(1).max(6),
      amount: z.number().int().min(1).max(3),
      from: z.array(AbilitySchema)
    })
    .nullable(),
  languages: z.array(slug()),
  /** "Choose N languages" where the species offers one; null otherwise. */
  languageChoices: ContentChoiceListSchema.nullable(),
  lineages: z.array(z.strictObject({ id: slug(), name: z.string(), description: z.string().nullable() })),
  features: z.array(ContentFeatureSummarySchema)
});
export type ContentSpeciesSummary = Wire<z.infer<typeof ContentSpeciesSummarySchema>>;
export type ContentSpeciesResult = {
  ok: boolean;
  message?: string;
  species?: readonly ContentSpeciesSummary[];
  attribution?: string;
};
/** One background: the ability-increase options and proficiencies it grants, its origin feat, and its starting-equipment choices (chosen option recorded in the character's `choices[]` ledger). */
export const ContentBackgroundSummarySchema = z.strictObject({
  ...catalogIdentity,
  abilityOptions: z
    .strictObject({ from: z.array(AbilitySchema), spreads: z.array(z.array(z.number().int().min(1).max(3))) })
    .nullable(),
  originFeatId: z.string().nullable(),
  skillProficiencies: z.array(slug()),
  /** "Choose N skills/tools/languages" where the background offers one; null otherwise. Fixed grants stay in the flat lists beside these. */
  skillChoices: ContentChoiceListSchema.nullable(),
  toolProficiencies: z.array(slug()),
  toolChoices: ContentChoiceListSchema.nullable(),
  languages: z.array(slug()),
  languageChoices: ContentChoiceListSchema.nullable(),
  startingEquipmentOptions: z.array(ContentStartingEquipmentOptionSchema),
  features: z.array(ContentFeatureSummarySchema)
});
export type ContentBackgroundSummary = Wire<z.infer<typeof ContentBackgroundSummarySchema>>;
export type ContentBackgroundsResult = {
  ok: boolean;
  message?: string;
  backgrounds?: readonly ContentBackgroundSummary[];
  attribution?: string;
};
/** One skill and the ability its check uses; `ability` is null only when the bundle row lacks it (the server fills the 18 SRD skills). */
export const ContentSkillSummarySchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  ability: AbilitySchema.nullable()
});
export type ContentSkillSummary = Wire<z.infer<typeof ContentSkillSummarySchema>>;
export type ContentSkillsResult = {
  ok: boolean;
  message?: string;
  skills?: readonly ContentSkillSummary[];
  attribution?: string;
};
/** One language and its SRD table ("standard" / "rare"); the base language budget draws from "standard". */
export const ContentLanguageSummarySchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  table: z.string()
});
export type ContentLanguageSummary = Wire<z.infer<typeof ContentLanguageSummarySchema>>;
export type ContentLanguagesResult = {
  ok: boolean;
  message?: string;
  languages?: readonly ContentLanguageSummary[];
  attribution?: string;
};
/** One feat (a feature plus catalog metadata). Prerequisites are display data; the server decides whether one is met. */
export const ContentFeatSummarySchema = z.strictObject({
  ...catalogIdentity,
  category: slug(),
  repeatable: z.boolean(),
  prerequisiteLevel: level().nullable(),
  prerequisiteAbilities: z.array(z.strictObject({ ability: AbilitySchema, minimum: level() })),
  prerequisiteRequires: z.array(slug()),
  prerequisiteText: z.string().nullable(),
  feature: ContentFeatureSummarySchema
});
export type ContentFeatSummary = Wire<z.infer<typeof ContentFeatSummarySchema>>;
export type ContentFeatsResult = {
  ok: boolean;
  message?: string;
  feats?: readonly ContentFeatSummary[];
  attribution?: string;
};
/** Name pools for one species, feeding the random generator. Pool `id` is an open slug; order comes from the data. */
export const ContentNameBundleSchema = z.strictObject({
  speciesId: slug(),
  source: ContentSourceKindSchema,
  pools: z.array(z.strictObject({ id: slug(), label: z.string(), names: z.array(z.string()) }))
});
export type ContentNameBundle = Wire<z.infer<typeof ContentNameBundleSchema>>;
export type ContentNamesResult = {
  ok: boolean;
  message?: string;
  names?: readonly ContentNameBundle[];
  attribution?: string;
};
/** An area of effect parsed from a definition action's prose ("60-foot Cone", etc.); the GM places a matching template on the map. */
export type ContentActionArea = Readonly<{
  shape: "cone" | "line" | "sphere" | "cube" | "emanation";
  sizeFeet: number;
  widthFeet: number | null;
}>;
/** A cast whose granted effect carries this tag takes an ability its caster chooses (Hex: the target has Disadvantage on
 *  ability checks made with it). */
export const CHOSEN_ABILITY_TAG = "hexed";
/** Whether an action asks its caster to choose an ability (`action.resolve`'s `ability`). */
export const choosesAbility = (action: Readonly<{ grants?: Readonly<{ tags: readonly string[] }> }>): boolean =>
  action.grants?.tags.includes(CHOSEN_ABILITY_TAG) === true;
/** A definition action flattened for the GM's action runner. Structured fields only where the content has them; the ADR-0020 mechanics fields power availability hints (the server stays the authority). */
export type ContentActionSummary = Readonly<{
  id: string;
  name: string;
  activation: "action" | "bonus-action" | "reaction" | "other";
  description: string;
  attackBonus: number | null;
  reachFeet: number | null;
  rangeFeet: number | null;
  /** Normal range band for two-range weapons; shots beyond it (up to rangeFeet) roll at disadvantage. */ rangeNormalFeet:
    number | null;
  saveAbility: string | null;
  saveDc: number | null;
  damage: ReadonlyArray<{ formula: string; type: string }>;
  area: ContentActionArea | null;
  attackCount: number | null;
  usesLimit: number | null;
  usesPer: "turn" | "own-turn" | "encounter" | "long-rest" | "short-rest" | "recharge" | null;
  /** d6 threshold for usesPer "recharge" ("Recharge 5-6" → 5); rolled automatically at the start of the owner's turn. */ usesRecharge:
    number | null;
  usesPool: string | null;
  /** Uses one activation spends when it is more than one, or `chosen` when the user picks it (Lay on Hands). */ useCost?:
    number | "chosen";
  requiresEffectTag: string | null;
  /** A Multiattack's plan; `or` names the actions that can fill a place instead ("using Scimitar or Shortbow"). */
  multiattack: ReadonlyArray<{ actionId: string; count: number; or?: readonly string[] }> | null;
  grants: boolean;
  reaction: Wire<ActionReaction> | null;
  /** SRD generic action rows (Dodge, Dash, Help, ...) appended after the stat block's own. */ builtin?: boolean;
  /** Targeting: "single" picks one combatant, "multi" several (Preserve Life), "none" is a direct tap. */ targeting?:
    "single" | "multi" | "none";
  /** The hit points it restores, when it heals (a potion drunk from the pack). */ healing?: Readonly<{
    formula: string;
  }> | null;
  /** How many creatures one use heals when it can be more than one (Prayer of Healing's five). */ healTargets?: number;
  /** SRD Legendary Action cost against the creature's per-round pool (taken on other creatures' turns). */ legendaryCost?: number;
  /** "Can't take this action again until the start of its next turn." */ legendaryOncePerRound?: true;
  /** Taken as one attack of the Attack action (an Unarmed Strike, a Breath Weapon), so it spends one the action has left. */ replacesAttack?: true;
  /** Added to a hit rather than taken alone (Sneak Attack, a smite): chosen on an attack's result. */ ridesAHit?: true;
  /** Darts the action makes, each assigned to a target (Magic Missile); see `ActorAction.darts`. */ darts?: number;
  /** Damage types the caster picks from (Chromatic Orb); see `ActorAction.damageTypes`. */ damageTypes?: readonly DamageType[];
  /** The conditions the caster picks one of for a failed save (Blindness/Deafness); `action.resolve`'s
   *  `conditionId`. */ conditionChoices?: readonly string[];
  /** The skills a check action is made with, for the roller to pick (Search, Study, Influence, Escape a Grapple);
   *  `action.resolve`'s `skill`. */ checkSkills?: ReadonlyArray<
    Readonly<{ id: string; ability: z.infer<typeof AbilitySchema> }>
  >;
  /** The cast chooses an ability (Hex); `action.resolve`'s `ability`. */ choosesAbility?: boolean;
  /** A stat block's spell list (Spellcasting, Divine Aid): the numbers its casts are made with. */ spellList?: Readonly<{
    ability: z.infer<typeof AbilitySchema>;
    saveDc: number;
    attackBonus: number;
  }>;
  /** The spell list this cast belongs to, by its action id; it is shown under that list. */ castFrom?: string;
  /** The spell it casts. */ spellId?: string;
}>;
export type ContentActionsResult = {
  ok: boolean;
  message?: string;
  actions?: readonly ContentActionSummary[];
  /** The definition's legendary resources, when it has any (SRD 2024 legendary creatures). */ legendary?: Readonly<{
    actionsPerRound?: number;
    resistancesPerDay?: number;
  }>;
};
/** Full stat-block payload for the GM's sheet view; inert content data, GM-gated. */
export type ContentSheetResult = { ok: boolean; message?: string; definition?: import("@vtt/schemas").ActorDefinition };
