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
import type { ActionAvailability, CastShapingOffers } from "./results.js";
import type { SummonChoices } from "./summon-choices.js";

/** An open identity slug; ids are never closed enums, so homebrew stays additive. */
const slug = (max = 80) =>
  z
    .string()
    .max(max)
    .regex(/^[a-z0-9-]+$/);
const level = () => z.number().int().min(1).max(20);

/** Where a catalog record came from. SRD and GM homebrew are merged server-side into one catalog, and a reader gets
 *  only the homebrew it receives, so a row's source never names one it does not. */
const ContentSourceKindSchema = z.enum(["srd", "homebrew"]);
export type ContentSourceKind = z.infer<typeof ContentSourceKindSchema>;

/** Compact browse row for bundled monster content; the server maps content definitions into this wire shape. */
export const ContentMonsterSummarySchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  source: ContentSourceKindSchema,
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
/** The low, middle and high of one number across the bundled stat blocks of a CR. */
const ContentSpreadSchema = z.strictObject({
  count: z.number().int().min(1),
  min: z.number(),
  median: z.number(),
  max: z.number()
});
/** What the bundled SRD stat blocks of one challenge rating have, for authoring a homebrew monster: armour class, hit
 *  points, the best attack bonus and save DC, and the most damage one turn deals at average rolls. A number none of
 *  them has (no stat block of that CR forces a save) is null. */
export const ContentMonsterBenchmarkSchema = z.strictObject({
  challengeRating: z.number(),
  count: z.number().int().min(1),
  armorClass: ContentSpreadSchema,
  hitPoints: ContentSpreadSchema,
  attackBonus: ContentSpreadSchema.nullable(),
  saveDc: ContentSpreadSchema.nullable(),
  damagePerRound: ContentSpreadSchema
});
export type ContentMonsterBenchmark = Wire<z.infer<typeof ContentMonsterBenchmarkSchema>>;
export type ContentMonsterBenchmarksResult = {
  ok: boolean;
  message?: string;
  benchmarks?: readonly ContentMonsterBenchmark[];
  attribution?: string;
};
/** One Rules Glossary term for the in-app rules reference; public information for any joined session. */
export const ContentGlossaryEntrySchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  /** The bracketed family the SRD gives the term ("Condition", "Action", "Hazard"), or null. */
  tag: z
    .string()
    .nullable()
    .describe('The family the SRD names in brackets after the term ("Condition", "Action", "Hazard"); null when none'),
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
  source: ContentSourceKindSchema.describe("Where the record came from: the SRD, or the GM's homebrew"),
  level: z.number().int().min(0).max(9).describe("0 is a cantrip"),
  school: z.string(),
  castingTime: z.string(),
  rangeText: z.string().nullable(),
  /** Whether casting it rolls an attack (the `fromPicks` predicate for Repelling Blast's "cantrip that requires an attack roll"). */
  attackRoll: z
    .boolean()
    .describe(
      'Whether casting it rolls an attack. One of the three closed `fromPicks` predicates: "a cantrip that requires an attack roll" (Repelling Blast)'
    ),
  /** Range in feet when the printed range is a distance, else null (Self and Touch are not zero). Read by the `ranged` predicate. */
  rangeFeet: z
    .number()
    .int()
    .nullable()
    .describe(
      'Range in feet when the printed range is a distance, else null (Self and Touch are not ranges of zero). Read by the `ranged` predicate: "a cantrip with a range of 10+ feet" (Eldritch Spear)'
    ),
  componentsText: z.string().describe('"V, S, M (a pinch of soot)", or "None"'),
  duration: z.string(),
  concentration: z.boolean(),
  ritual: z.boolean(),
  description: z.string(),
  higherLevel: z.string().nullable(),
  /** Spell-list ids ("wizard", a homebrew list slug); the wizard's spell step matches `ContentClassSummary.spellcasting.spellListId`. */
  classes: z
    .array(z.string())
    .describe(
      "Spell-list ids this spell belongs to (\"wizard\", a homebrew list slug); the builder filters a class's spell step on these, paired with the class record's spellcasting.spellListId"
    ),
  /** Base damage/healing roll ("8d6"), or null for a spell that rolls nothing. Drives the sheet's "cast at" auto-roll. */
  damageRoll: z.string().nullable().describe('Base damage/healing roll ("8d6"), or null when the spell rolls nothing'),
  /** Damage types for the base roll (empty for healing/none). */
  damageTypes: z.array(z.string()),
  /** Per-slot-level upcast scaling parsed from the SRD (Fireball's 9d6 at 4th); the sheet applies the entry for the cast level. */
  castingOptions: z
    .array(z.strictObject({ level: z.number().int().min(1).max(9), ...scalingRow }))
    .describe("Per-slot-level upcast scaling; the sheet applies the row matching the chosen cast level"),
  /** A cantrip's character-level scaling (Fire Bolt's 2d10 at 5, Eldritch Blast's 2 beams); empty otherwise. */
  cantripScaling: z
    .array(z.strictObject({ characterLevel: level(), ...scalingRow }))
    .describe(
      "A cantrip's character-level scaling (Fire Bolt's 2d10 at 5, Eldritch Blast's 2 beams), lowest level first; the row in force is the highest at or below the caster's level. Empty for a leveled spell"
    )
});
export type ContentSpellSummary = Wire<z.infer<typeof ContentSpellSummarySchema>>;
export type ContentSpellsResult = {
  ok: boolean;
  message?: string;
  spells?: readonly ContentSpellSummary[];
  /** The bundle's canonical CC BY 4.0 line (ADR-0015). */ attribution?: string;
};
/** One addable-equipment catalog row (SRD gear, weapons and armor in one shape). `category` is an open slug;
 * only "weapon", "armor" and "shield" drive AC and attack derivation, so group by the data itself.
 * `weapon` also carries browse-only `mastery`, which must not be copied onto an inventory row
 * (`ItemWeaponSchema` is strict); `inventoryWeaponFrom` does the conversion. */
export const ContentEquipmentSummarySchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  source: ContentSourceKindSchema.describe("Where the record came from: the SRD, or the GM's homebrew"),
  category: z
    .string()
    .describe(
      "Open slug: weapon, armor, shield, ammunition, adventuring-gear, tool, equipment-pack, consumable, focus, wondrous, or any homebrew kind. The set is open, so derive groupings from the data."
    ),
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
      ammunition: AmmunitionKindSchema.optional().describe(
        "What an Ammunition weapon fires (the Weapons table's \"Ammunition (Range 150/600; Arrow)\"); a Sling's bullets and a firearm's are different items"
      ),
      mastery: z
        .enum(["cleave", "graze", "nick", "push", "sap", "slow", "topple", "vex"])
        .optional()
        .describe(
          "The SRD weapon-mastery property this weapon has. Browse-only: it is not copied onto an inventory row, and it does nothing until a character unlocks this weapon through Weapon Mastery. Absent on gear and on homebrew weapons that declare none."
        ),
      properties: z
        .array(slug(40))
        .max(12)
        .optional()
        .describe(
          "The SRD weapon table's Properties column (finesse, light, thrown, versatile, reach, heavy, two-handed, loading, ammunition). Unlike `mastery` these are copied onto an inventory row and the engine reads them there: finesse decides whether the swing uses Dexterity, reach decides 10 feet versus 5. An empty array means the weapon genuinely has none."
        )
    })
    .nullable()
    .describe("Populated for weapons only"),
  armor: z
    .strictObject({
      acBase: z.number().int(),
      addDexModifier: z.boolean(),
      dexModifierCap: z.number().int().nullable(),
      stealthDisadvantage: z.boolean(),
      strengthRequired: z.number().int().nullable()
    })
    .nullable()
    .describe("Populated for armor and shields only"),
  appliesTo: z
    .strictObject({ label: z.string(), baseIds: z.array(slug(60)).min(1).max(40) })
    .nullable()
    .describe(
      'The eligibility column for a template magic item: the printed type-line qualifier ("Any Simple or Martial") plus the base ids it resolved to at build/authoring time. Null everywhere except weapon, armor and ammunition templates (the bases of magic ammunition are the kinds of ammunition, which decide the launchers that fire it). A template row derives nothing until the player\'s pick binds it to one of `baseIds`, validated and copied server-side at set-inventory.'
    ),
  /** The magic-item rarity, which the item's printed line already says ("Wand, Rare (Requires Attunement...)"). */
  rarity: slug(40)
    .nullable()
    .describe(
      'The magic-item rarity as a slug ("rare", "very-rare"); null for an item with none. The printed line in the description already says it'
    ),
  /** Whether the item needs attunement, and by whom: the printed line's "(Requires Attunement by a Spellcaster)". */
  attunement: z
    .strictObject({
      required: z.boolean(),
      restrictedTo: z.array(slug()).max(8).describe("Class or species ids the item is meant for; advisory only")
    })
    .nullable()
    .describe(
      "Whether the item needs attunement and who it is meant for, as its printed line says; null for an item that says nothing of it"
    ),
  /** The damage types the GM may pick for the item's resistance ("The GM chooses the type"). */
  damageTypeChoice: z
    .array(slug(20))
    .max(13)
    .optional()
    .describe(
      "The damage types the GM may pick for the item's resistance, as the SRD prints them (absent when the item has no such choice)"
    ),
  /** A Spell Scroll: the spell levels one copy can bear, as its name prints them; the pick is the row's `spellId`. */
  spellScroll: z
    .strictObject({ minLevel: z.number().int(), maxLevel: z.number().int() })
    .optional()
    .describe(
      "The spell levels one copy of a Spell Scroll can bear (0 is a cantrip), for the picker's spell step; absent on anything else"
    ),
  /** A manual or tome: its study raises a score for good (`character.study-item`). */
  study: z
    .strictObject({
      ability: z.enum(["str", "dex", "con", "int", "wis", "cha"]),
      amount: z.number().int(),
      maximum: z.number().int(),
      hours: z.number().int(),
      days: z.number().int()
    })
    .optional()
    .describe(
      "A manual or tome: `hours` of study within `days` raise the reader's `ability` by `amount`, never above `maximum`, as its text prints it; absent on anything else"
    ),
  /** A light source: lit and put out on the row unless it always glows, with a hood to lower or a Cone to aim. */
  light: z
    .strictObject({
      always: z.literal(true).optional(),
      hooded: z.literal(true).optional(),
      cone: z.literal(true).optional()
    })
    .optional()
    .describe(
      "How the item sheds light, as its own text says: lit and put out on its row (item.set-light) unless `always` (it glows while held), with a hood to lower (`hooded`) or a Cone to aim (`cone`). Absent on anything that sheds none"
    )
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

/** One budget a feature or option raises: "one extra Cleric cantrip" is `{offer: "class-cantrips", amount: 1}`.
 * `offer` is an offer key shared with the server, which rejects keys naming no real offer. */
export const ContentExtraPickSummarySchema = z
  .strictObject({
    offer: z.string().max(80).describe("The offer key whose capacity this raises"),
    /** A flat number of extra picks; null when `scaling` states it instead. Exactly one of the two is set. */
    amount: z
      .number()
      .int()
      .min(1)
      .max(5)
      .nullable()
      .describe("How many extra picks, as a flat number; null when `scaling` states it instead"),
    /** A budget that follows a class-table column (Eldritch Invocations 1 → 10), resolved with `extraPickAmount`. */
    scaling: PickBudgetScalingSchema.nullable().describe(
      "The budget follows a printed class-table column: Eldritch Invocations 1 -> 10, Weapon Mastery 3 -> 6. Resolved against the same level table on both sides. Null for a flat grant."
    )
  })
  .describe(
    "One pick budget a feature or a chosen option raises. `offer` is the offer key the wizard and the server share verbatim (class-cantrips, class-spells, class-skills, class-tools, background-skills, background-tools, background-languages, species-languages, or feature:<featureId>); the printed level row and every grant naming it are summed, so two features each granting +1 yield +2."
  );
export type ContentExtraPickSummary = Wire<z.infer<typeof ContentExtraPickSummarySchema>>;
/** One inline option of a feature's pick: its authored name and any second-order pick it owes (Divine Order's
 * "thaumaturge" grants an extra cantrip). Riders (actions, grants, modifiers, uses) stay server-side. */
export const ContentFeatureOptionSummarySchema = z
  .strictObject({
    id: slug(),
    name: z.string(),
    description: z.string(),
    /** The earlier pick that makes this option legal (Blessed Strikes), or null. The wizard filters like the server:
     * if gating leaves exactly as many options as picks, the answer is a consequence and no pick is shown. */
    requires: z
      .strictObject({
        offer: z
          .string()
          .describe('The offer key holding the earlier answer ("feature:blessed-strikes", or a named budget)'),
        id: slug()
      })
      .nullable()
      .describe(
        'The earlier answer that makes this option legal, or null when it is always offerable. "The option you chose for Blessed Strikes grows more powerful": the later feature\'s options are gated on a pick already in the ledger. When gating leaves exactly as many legal options as the capacity, the answer is a consequence of the gating and neither side renders a pick for it.'
      ),
    /** Every pick this option owes, in authored order. */
    get choices(): z.ZodArray<typeof ContentFeatureChoiceSummarySchema> {
      return z
        .array(ContentFeatureChoiceSummarySchema)
        .describe(
          "Every nested pick this option owes, in authored order. Bounded at one level: a nested pick never carries its own options."
        );
    },
    extraPicks: z
      .array(ContentExtraPickSummarySchema)
      .describe(
        "Budgets this option raises once chosen: Divine Order's Thaumaturge adds one to the Cleric cantrip budget."
      )
  })
  .describe(
    "One inline option of a feature's pick. Carries its authored name (an id alone would force the client to titleize) and any second-order pick it owes: Cleric Divine Order's Thaumaturge grants an extra cantrip, so choosing it opens another choice. Riders stay server-side."
  );
export type ContentFeatureOptionSummary = Wire<z.infer<typeof ContentFeatureOptionSummarySchema>>;
export const ContentFeatureChoiceSummarySchema = z
  .strictObject({
    kind: slug(),
    choose: z.number().int().min(1).max(10),
    from: z.array(slug()).describe("Explicit option ids; empty when fromCatalog names an open list instead"),
    fromCatalog: z
      .string()
      .nullable()
      .describe("An open catalog slug resolved at pick time (skills, feats, wizard-spells)"),
    /** Ceiling on a spell pick's level (Evocation Savant: level 2 and under; Magic Initiate: cantrips). Null = none. */
    maxSpellLevel: z
      .number()
      .int()
      .min(0)
      .max(9)
      .nullable()
      .describe(
        "Ceiling on a spell pick's level (Evocation Savant: 2; Magic Initiate: 0, i.e. cantrips only). null when the pick has no ceiling. A picker that ignores it offers spells the server then rejects"
      ),
    /** Floor on a spell pick's level (Mystic Arcanum: both 6 means exactly level 6). Null = none. */
    minSpellLevel: z
      .number()
      .int()
      .min(0)
      .max(9)
      .nullable()
      .describe(
        "Floor on a spell pick's level (Mystic Arcanum: 6, so the level-6 arcanum is exactly a level-6 spell). null when the pick has no floor"
      ),
    /** Options drawn from the character's own earlier picks; `offer` names the budget, `where` a predicate slug. */
    fromPicks: z
      .strictObject({
        offer: z.string().describe('The budget whose answers are the option list ("class-cantrips", "feature:<id>")'),
        where: z
          .enum(["deals-damage", "attack-roll", "ranged", "ranged-damage"])
          .nullable()
          .describe("Closed predicate narrowing those answers; null means all of them")
      })
      .nullable()
      .describe(
        'The options are the character\'s own earlier answers, with no catalog: "choose one of your known Warlock cantrips that deals damage". null for every ordinary pick.'
      ),
    /** Inline options with their names and any nested pick. Empty when the options come from `fromCatalog` or are plain ids in `from`. */
    get options(): z.ZodArray<typeof ContentFeatureOptionSummarySchema> {
      return z
        .array(ContentFeatureOptionSummarySchema)
        .describe(
          "Inline options with their authored names and any nested pick; empty when the options are plain ids or come from a catalog"
        );
    }
  })
  .describe(
    "One pick a feature asks for. Options arrive either as plain ids in `from`, as an open catalog slug in `fromCatalog`, or as inline `options` carrying their own name and any second-order pick."
  );
export type ContentFeatureChoiceSummary = Wire<z.infer<typeof ContentFeatureChoiceSummarySchema>>;
/** A class/subclass/species/background/feat feature as browse-and-pick data. Riders stay server-side. */
export const ContentFeatureSummarySchema = z
  .strictObject({
    id: slug(),
    name: z.string(),
    level: level()
      .nullable()
      .describe(
        "The class/subclass level the feature lands at; null when it is not level-gated (species traits, feats)"
      ),
    description: z.string(),
    tags: z
      .array(slug())
      .describe("Open grouping slugs for the sheet (spellcasting, fighting-style, channel-divinity)"),
    /** Every pick this feature asks for, in authored order (Magic Initiate owes two cantrips and one level-1 spell). */
    choices: z
      .array(ContentFeatureChoiceSummarySchema)
      .describe(
        "Every pick this feature asks for, in authored order; each writes a row in the character's choice-provenance ledger. One record may owe more than one, with different kinds and ceilings: Magic Initiate owes two cantrips and one level-1 spell. Empty when the feature grants without asking."
      ),
    /** Every class level that grants this feature: the repeat count (server capacity is choose × grants).
     * Empty for features not granted by a class table (species traits, feats, subclass features). */
    grantedAtLevels: z
      .array(level())
      .describe(
        "Every level at which the owning class's table grants this feature: the authoritative repeat count. A feature granted at 4, 8, 12 and 16 asks its choice four times and the server's capacity is choose x grants, so a client that ignores this offers too few picks and the build is rejected at creation. Empty when no class level table grants the feature (species traits, feats, subclass features)."
      ),
    extraPicks: z
      .array(ContentExtraPickSummarySchema)
      .describe(
        "Budgets this feature raises, each named by its offer key; the picks it asks for itself are in `choices`. Travels although riders do not, because it is an input to picking: a wizard that ignores it caps the player at the printed level row and the extra pick the text promised is unselectable."
      )
  })
  .describe(
    "The browse-and-pick projection of a bundle FeatureRecord. Prose is the display source of truth; a feature's structured riders (granted actions, effects, modifiers, limited uses) stay server-side; the server applies them when it builds the character, so the wizard never becomes a second rules engine."
  );
export type ContentFeatureSummary = Wire<z.infer<typeof ContentFeatureSummarySchema>>;
/** One row of a class's printed 20-level table, display only. `null` means the class has no such column. */
const ContentClassLevelRowSchema = z.strictObject({
  level: level(),
  proficiencyBonus: z.number().int().min(2).max(6),
  spellSlots: z
    .array(z.number().int().min(0).max(4))
    .min(9)
    .max(9)
    .nullable()
    .describe("Nine counts, index 0 = level 1 slots; null for a non-caster row"),
  pactSlots: z
    .strictObject({ level: z.number().int().min(1).max(9), slots: z.number().int().min(0).max(4) })
    .nullable()
    .describe("Warlock Pact Magic: one uniform slot level with its own count"),
  cantripsKnown: z.number().int().min(0).max(10).nullable(),
  spellsKnown: z.number().int().min(0).max(40).nullable(),
  preparedFormula: z
    .string()
    .nullable()
    .describe(
      'The SRD prepared-spell rule as data ("<ability> modifier + <class> level") so homebrew can print its own wording'
    ),
  preparedCount: z.number().int().min(0).max(60).nullable(),
  classResources: z.array(
    z.strictObject({
      id: slug(),
      name: z.string(),
      amount: z
        .union([z.number().int().min(0).max(999), z.string().max(20)])
        .describe('A count, or a dice string ("3d6" for Sneak Attack)')
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
  /** An open catalog slug that supplies options, alone or beside `from`, resolved by `resolveCatalogChoice`
   * ("two languages from the Standard Languages table"). Null when `from` names them outright. */
  fromCatalog: z
    .string()
    .nullable()
    .describe(
      'An open catalog slug that supplies the options, alone or beside `from`: the same grammar a feature\'s `fromCatalog` uses, resolved by the same function on both sides. Species language choices use "standard-languages"; null when `from` names the options outright'
    )
});
export type ContentChoiceList = Wire<z.infer<typeof ContentChoiceListSchema>>;
const ProgressionSchema = z.enum(["full", "half", "third", "pact"]);
/** A spellcasting header. `spellListId` pairs with `ContentSpellSummary.classes`. */
const ContentSpellcastingSummarySchema = z.strictObject({
  ability: AbilitySchema,
  prepares: z
    .enum(["known", "prepared"])
    .describe("known = a fixed spells-known list; prepared = re-chosen on a Long Rest"),
  ritual: z.boolean(),
  focus: z.string().nullable().describe("Spellcasting focus slug (arcane-focus, holy-symbol); null = none"),
  progression: ProgressionSchema.describe("How this class's levels count toward the shared multiclass caster level"),
  spellListId: z
    .string()
    .nullable()
    .describe("The spell list this class draws from: an open slug matched against each spell's `classes` tags")
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
  hitDie: HitDieSchema.describe("The multiclass hit-dice pool keys on this"),
  statPriority: z
    .array(AbilitySchema)
    .describe("All six abilities, best first: the random generator's core input, as data with no hardcoded table"),
  primaryAbilities: z.array(AbilitySchema),
  savingThrows: z.array(AbilitySchema),
  skillChoiceCount: z
    .number()
    .int()
    .min(0)
    .max(10)
    .describe("How many entries of skillChoices the character picks at level 1"),
  skillChoices: z.array(slug()),
  /** Granted armor/weapon/tool training as open slugs ("light", "martial", "thieves-tools"). */
  armorProficiencies: z.array(slug()).describe("Granted armor training, as open slugs (light, medium, heavy, shields)"),
  weaponProficiencies: z
    .array(slug())
    .describe("Granted weapon training: a group (simple, martial) or a single weapon id"),
  toolProficiencies: z.array(slug()),
  /** "Choose N tools" where the class offers one (Monk-style); null otherwise. */
  toolChoices: ContentChoiceListSchema.nullable().describe(
    '"Choose N tools" where the class offers one; null otherwise'
  ),
  /** Proficiencies gained when this class is taken as a multiclass (narrower than the level-1 set); null when none. */
  multiclassProficiencies: z
    .strictObject({
      armor: z.array(slug()),
      weapons: z.array(slug()),
      tools: z.array(slug()),
      skillChoices: ContentChoiceListSchema.nullable(),
      /** "One Musical Instrument of your choice" (Bard); null when the class keeps no tool pick. */
      toolChoices: ContentChoiceListSchema.nullable().describe(
        '"One Musical Instrument of your choice" (Bard); null when the class keeps no tool pick'
      )
    })
    .nullable()
    .describe(
      "Proficiencies gained when this class is taken as a multiclass (narrower than the level-1 set); null when the record declares none"
    ),
  /** Ability minimums for multiclassing into this class; `mode: "any"` covers "STR 13 or DEX 13". Null = always allowed. Display only; the server re-validates. */
  multiclassPrerequisites: z
    .strictObject({
      mode: z.enum(["all", "any"]),
      minimums: z.array(z.strictObject({ ability: AbilitySchema, minimum: level() }))
    })
    .nullable()
    .describe(
      'Ability minimums for multiclassing into this class; mode "any" covers "STR 13 or DEX 13". null = always allowed. Display data; the server re-validates'
    ),
  subclassLevel: level(),
  subclassLabel: z.string().nullable().describe('What this class calls its subclass ("Martial Archetype")'),
  asiLevels: z.array(level()).describe("Levels granting an Ability Score Improvement, or a feat instead"),
  spellcastingAbility: z
    .string()
    .nullable()
    .describe(
      "Ability slug for this class's spellcasting; null for a non-caster. Per class, so Paladin CHA + Wizard INT is expressible"
    ),
  spellcastingProgression: ProgressionSchema.nullable().describe(
    "How this class's levels count toward the shared multiclass caster level"
  ),
  spellcasting: ContentSpellcastingSummarySchema.nullable().describe(
    "The full spellcasting header (ability, known/prepared, ritual, focus, progression, spell-list id); null for a non-caster. The flat spellcastingAbility/spellcastingProgression mirror it for existing readers"
  ),
  levelTable: z
    .array(ContentClassLevelRowSchema)
    .describe(
      "The class's full 20-row printed progression: slot columns, cantrips/spells known, the prepared-spell formula, and the named resources that grow with level (Second Wind 2 to 4, Rage 3, Sneak Attack 3d6)"
    ),
  startingEquipmentOptions: z
    .array(ContentStartingEquipmentOptionSchema)
    .describe(
      "Starting-equipment bundles with their items and the \"or take N gp\" alternative; the chosen option's id is recorded in the character's choice ledger"
    ),
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
  subclassLevel: level()
    .nullable()
    .describe("The class level this subclass is taken at; null inherits the parent class's subclassLevel"),
  spellcastingAbility: z
    .string()
    .nullable()
    .describe("Set by third-caster subclasses (Eldritch Knight, Arcane Trickster)"),
  spellcastingProgression: ProgressionSchema.nullable(),
  /** Third-caster subclasses (Eldritch Knight, Arcane Trickster) declare their own header, same shape as a class's; null otherwise. */
  spellcasting: ContentSpellcastingSummarySchema.nullable().describe(
    "A third-caster subclass's full spellcasting header, same shape as a class's; null otherwise"
  ),
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
  sizes: z
    .array(z.enum(["tiny", "small", "medium", "large", "huge", "gargantuan"]))
    .describe("A list because several 2024 species let the player pick Small or Medium"),
  speedFeet: z.number().int().min(0).max(120),
  darkvisionFeet: z.number().int().nullable(),
  creatureType: slug(),
  /** Fixed ability increases; empty for SRD 5.2.1 species, used by 2014-style or homebrew records. */
  abilityBonuses: z
    .array(z.strictObject({ ability: AbilitySchema, amount: z.number().int().min(-2).max(3) }))
    .describe(
      "Fixed ability increases, as data. Empty for every SRD 5.2.1 species (increases live on the background); a 2014-style or homebrew record populates it and the builder applies whatever is declared"
    ),
  /** "Choose N abilities to raise by M" (the 2014 variant-human / half-elf pattern); null when the species has none. */
  abilityBonusChoice: z
    .strictObject({
      choose: z.number().int().min(1).max(6),
      amount: z.number().int().min(1).max(3),
      from: z.array(AbilitySchema)
    })
    .nullable()
    .describe('"Choose N abilities to raise by M" (the 2014 variant-human pattern); null when the species has none'),
  languages: z.array(slug()),
  /** "Choose N languages" where the species offers one; null otherwise. */
  languageChoices: ContentChoiceListSchema.nullable().describe(
    '"Choose N languages" where the species offers one; null otherwise'
  ),
  lineages: z
    .array(z.strictObject({ id: slug(), name: z.string(), description: z.string().nullable() }))
    .describe("Lineages/subraces; each one's traits are also folded into features"),
  features: z
    .array(ContentFeatureSummarySchema)
    .describe("Species traits plus every lineage's traits. Note: SRD 5.2.1 puts ability increases on the background")
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
    .nullable()
    .describe("SRD 5.2.1 ability increases: which abilities, and the legal distributions (+2/+1 or +1/+1/+1) as data"),
  originFeatId: z.string().nullable().describe("The origin feat this background grants, keyed into the feat catalog"),
  skillProficiencies: z.array(slug()),
  /** "Choose N skills/tools/languages" where the background offers one; null otherwise. Fixed grants stay in the flat lists beside these. */
  skillChoices: ContentChoiceListSchema.nullable().describe(
    '"Choose N skills" where the background offers one; null otherwise (fixed grants stay in skillProficiencies)'
  ),
  toolProficiencies: z.array(slug()),
  toolChoices: ContentChoiceListSchema.nullable().describe(
    '"Choose N tools" where the background offers one; null otherwise'
  ),
  languages: z.array(slug()),
  languageChoices: ContentChoiceListSchema.nullable().describe(
    '"Choose N languages" where the background offers one; null otherwise'
  ),
  startingEquipmentOptions: z
    .array(ContentStartingEquipmentOptionSchema)
    .describe(
      "Starting-equipment bundles with their items and the \"or take N gp\" alternative; the chosen option's id is recorded in the character's choice ledger"
    ),
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
  ability: AbilitySchema.nullable().describe(
    "The ability this skill's check uses; null only for a record that has not declared one yet"
  )
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
  table: z
    .string()
    .describe(
      'Which SRD table the language is printed in: "standard" (widespread) or "rare" (secret or planar). An open slug: a homebrew table needs no schema change. The base "Common plus two languages" budget draws from `standard`; Druidic and Thieves\' Cant are `rare` and arrive from a class feature'
    )
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
  category: slug().describe("Open slug (origin / general / fighting-style / epic-boon)"),
  repeatable: z.boolean(),
  prerequisiteLevel: level().nullable(),
  prerequisiteAbilities: z.array(z.strictObject({ ability: AbilitySchema, minimum: level() })),
  prerequisiteRequires: z.array(slug()).describe("Proficiency or feature slugs the character must already have"),
  prerequisiteText: z
    .string()
    .nullable()
    .describe(
      "Anything not modeled above, printed for the player. Whether a prerequisite is met is decided by the server alone"
    ),
  feature: ContentFeatureSummarySchema.describe("A feat is a feature plus catalog metadata, so it is one record")
});
export type ContentFeatSummary = Wire<z.infer<typeof ContentFeatSummarySchema>>;
export type ContentFeatsResult = {
  ok: boolean;
  message?: string;
  feats?: readonly ContentFeatSummary[];
  attribution?: string;
};
/** Name pools for one species, for the random generator. Pool `id` is an open slug; order comes from the data. */
export const ContentNameBundleSchema = z.strictObject({
  speciesId: slug(),
  source: ContentSourceKindSchema,
  pools: z
    .array(
      z.strictObject({
        id: slug(),
        label: z.string().describe('What this pool is ("Masculine", "Family", "Clan")'),
        names: z.array(z.string())
      })
    )
    .describe("Ordered by the data, never by a hardcoded client list")
});
export type ContentNameBundle = Wire<z.infer<typeof ContentNameBundleSchema>>;
export type ContentNamesResult = {
  ok: boolean;
  message?: string;
  names?: readonly ContentNameBundle[];
  attribution?: string;
};
/** The kinds of record a player's Compendium lists. No monsters: the bestiary is the GM's. */
export const ContentCompendiumKindSchema = z.enum([
  "class",
  "subclass",
  "species",
  "background",
  "feat",
  "spell",
  "equipment"
]);
export type ContentCompendiumKind = z.infer<typeof ContentCompendiumKindSchema>;
const compendiumOf = <Kind extends ContentCompendiumKind, Row extends z.ZodType>(kind: Kind, row: Row) =>
  z.strictObject({ kind: z.literal(kind), rows: z.array(row), attribution: z.string() });
/**
 * One kind of the Compendium as its reader gets it: the SRD and the homebrew that reader receives, as the catalog
 * summaries the builder and the gear picker already get, each with its `source`. Sorted by name.
 */
export const ContentCompendiumSchema = z.discriminatedUnion("kind", [
  compendiumOf("class", ContentClassSummarySchema),
  compendiumOf("subclass", ContentSubclassSummarySchema),
  compendiumOf("species", ContentSpeciesSummarySchema),
  compendiumOf("background", ContentBackgroundSummarySchema),
  compendiumOf("feat", ContentFeatSummarySchema),
  compendiumOf("spell", ContentSpellSummarySchema),
  compendiumOf("equipment", ContentEquipmentSummarySchema)
]);
export type ContentCompendium = Wire<z.infer<typeof ContentCompendiumSchema>>;
/** The `content:compendium` read's input. */
export const ContentCompendiumRequestSchema = z.strictObject({ kind: ContentCompendiumKindSchema });
export type ContentCompendiumResult = { ok: boolean; message?: string } & Partial<ContentCompendium>;
/** Who the GM's See as reads as: everyone, or one party character by actor id. */
export const HomebrewSeeAsSchema = z.union([z.literal("everyone"), z.uuid()]);
/** What one player receives of one record: whether it reaches them, and the Compendium row they get. */
export const HomebrewSeeAsRecordSchema = z.strictObject({
  as: HomebrewSeeAsSchema,
  kind: z.enum(["class", "subclass", "species", "background", "feat", "spell", "equipment", "monster", "spell-list"]),
  received: z.boolean(),
  /** The one row that player's Compendium holds for the record; null when it holds none. */
  entry: ContentCompendiumSchema.nullable()
});
export type HomebrewSeeAsRecord = Wire<z.infer<typeof HomebrewSeeAsRecordSchema>>;
/** An area of effect parsed from a definition action's prose ("60-foot Cone", etc.); the GM places a matching template on the map. */
export type ContentActionArea = Readonly<{
  shape: "cone" | "line" | "sphere" | "cube" | "emanation" | "cylinder";
  sizeFeet: number;
  widthFeet: number | null;
  /** How many of these areas one use places (Fire Storm's ten Cubes); `action.resolve`'s `templates`. */
  count?: number;
  /** Each area must touch another. */
  contiguous?: true;
}>;
/** A cast whose granted effect carries this tag takes an ability its caster chooses (Hex: the target has Disadvantage on
 *  ability checks made with it). */
export const CHOSEN_ABILITY_TAG = "hexed";
/** Enhance Ability's grant: Advantage on the ability checks made with the ability its caster chooses. */
export const ENHANCED_ABILITY_TAG = "enhanced-ability";
/** Whether an action asks its caster to choose an ability (`action.resolve`'s `ability`). */
export const choosesAbility = (action: Readonly<{ grants?: Readonly<{ tags: readonly string[] }> }>): boolean =>
  action.grants?.tags.includes(CHOSEN_ABILITY_TAG) === true ||
  action.grants?.tags.includes(ENHANCED_ABILITY_TAG) === true;
/** The choices an action asks for as it resolves: an option of its grant or failed save (Fire Shield's warm or
 *  chill, Bestow Curse's curse), one for each target where the text says so, and the carried weapon its grant binds to
 *  (Magic Weapon). Sent as `action.resolve`'s `optionId`, `targetOptions` and `itemId`. */
export type ActionChoices = Readonly<{
  options?: ReadonlyArray<Readonly<{ id: string; name: string }>>;
  optionsPerTarget?: true;
  bindsWeapon?: Readonly<{ weaponIds?: readonly string[]; melee?: true }>;
}>;
type ChoosingAction = Readonly<{
  grants?: Readonly<{
    options?: ReadonlyArray<Readonly<{ id: string; name: string }>>;
    optionsPerTarget?: true;
    bindsWeapon?: Readonly<{ weaponIds?: readonly string[]; melee?: true }>;
  }>;
  save?: Readonly<{
    failureEffect?: Readonly<{
      options?: ReadonlyArray<Readonly<{ id: string; name: string }>>;
      optionsPerTarget?: true;
    }>;
  }>;
}>;
/** What an action asks its user to choose as it resolves, or null when it asks nothing. */
export function actionChoicesOf(action: ChoosingAction): ActionChoices | null {
  const chooser = action.grants?.options ? action.grants : action.save?.failureEffect;
  const binds = action.grants?.bindsWeapon;
  if (!chooser?.options && !binds) return null;
  return {
    ...(chooser?.options ? { options: chooser.options.map((option) => ({ id: option.id, name: option.name })) } : {}),
    ...(chooser?.optionsPerTarget ? { optionsPerTarget: true as const } : {}),
    ...(binds
      ? {
          bindsWeapon: {
            ...(binds.weaponIds ? { weaponIds: [...binds.weaponIds] } : {}),
            ...(binds.melee ? { melee: true as const } : {})
          }
        }
      : {})
  };
}
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
  /** How far its targets may be when it says so without an attack (Lay on Hands' touch is 5). */ targetRangeFeet?: number;
  saveAbility: string | null;
  saveDc: number | null;
  damage: ReadonlyArray<{ formula: string; type: string }>;
  area: ContentActionArea | null;
  attackCount: number | null;
  usesLimit: number | null;
  usesPer: "turn" | "own-turn" | "encounter" | "long-rest" | "short-rest" | "recharge" | "never" | "time" | null;
  /** d6 threshold for usesPer "recharge" ("Recharge 5-6" → 5); rolled automatically at the start of the owner's turn. */ usesRecharge:
    number | null;
  usesPool: string | null;
  /** For usesPer "time": the hours of game time after the first use before the pool comes back ("1d12", "168"). */
  usesAfterHours?: string;
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
  /** Its own move comes before the rest of it ("moves up to half its Speed, and it makes one Rend attack"), so it can
   *  be taken move first: `action.resolve`'s `moveFirst`. */ moveFirst?: true;
  /** Taken as one attack of the Attack action (an Unarmed Strike, a Breath Weapon), so it spends one the action has left. */ replacesAttack?: true;
  /** Added to a hit and never taken alone (Sneak Attack, a smite): chosen on an attack's result. */ ridesAHit?: true;
  /** Darts the action makes, each assigned to a target (Magic Missile); see `ActorAction.darts`. */ darts?: number;
  /** Damage types the caster picks from (Chromatic Orb); see `ActorAction.damageTypes`. */ damageTypes?: readonly DamageType[];
  /** The conditions the caster picks one of for a failed save (Blindness/Deafness); `action.resolve`'s
   *  `conditionId`. */ conditionChoices?: readonly string[];
  /** The creature and creature type its user picks when it summons (Find Familiar's forms); `action.resolve`'s
   *  `summon`. */ summonChoices?: SummonChoices;
  /** The skills a check action is made with, for the roller to pick (Search, Study, Influence, Escape a Grapple),
   *  and the tools Help with a Check may help with, by name; `action.resolve`'s `skill`. */ checkSkills?: ReadonlyArray<
    Readonly<{ id: string; ability: z.infer<typeof AbilitySchema>; name?: string }>
  >;
  /** The cast chooses an ability (Hex); `action.resolve`'s `ability`. */ choosesAbility?: boolean;
  /** An option, one for each target, or a carried weapon it asks for (`actionChoicesOf`). */ choices?: ActionChoices;
  /** A stat block's spell list (Spellcasting, Divine Aid): the numbers its casts are made with. */ spellList?: Readonly<{
    ability: z.infer<typeof AbilitySchema>;
    saveDc: number;
    attackBonus: number;
  }>;
  /** The spell list this cast belongs to, by its action id; it is shown under that list. */ castFrom?: string;
  /** The spell it casts. */ spellId?: string;
  /** The ways its caster may shape the cast (Metamagic, Sculpt Spells), from the server's availability read. */ shaping?: CastShapingOffers;
  /** Its damage may be looked at before it counts, for Empowered Spell or Heroic Inspiration to answer; from the
   *  server's availability read. */ damageLook?: true;
  /** How its area grows with a higher slot (Fog Cloud), from the server's availability read. */ areaPerSlot?: ActionAvailability["areaPerSlot"];
  /** The forms a shape-shift may take (Wild Shape, Polymorph), from the server's availability read; `action.resolve`'s
   *  `form`, or `targetForms` when each target takes its own. */ forms?: ActionAvailability["forms"];
  /** The effects a use picks one of (Enlarge or Reduce); `action.resolve`'s `option`. */ options?: ActionAvailability["options"];
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
