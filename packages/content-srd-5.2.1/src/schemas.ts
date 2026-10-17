/**
 * Every content shape this package declares, with no bundle loading, so the homebrew editor can run
 * the server's own schemas in a browser build. The server still re-validates authoritatively.
 *
 * Shapes, constants and pure functions only: nothing here, or in anything it imports, may touch
 * `node:`, the filesystem or a bundle. `index.ts` re-exports all of it.
 */

import { z } from "zod";
import {
  AbilitySchema,
  ActionAreaSchema,
  ActionGrantSchema,
  AmmunitionKindSchema,
  BurstSchema,
  ActionReactionSchema,
  ActionSchema,
  ActorDefinitionSchema,
  DamageDrainSchema,
  DamageFormulaSchema,
  DamageTypeSchema,
  HealingFormulaSchema,
  ItemSlotSchema,
  OnHitRiderSchema,
  SaveFailureEffectSchema,
  SaveOutcomeFields
} from "@vtt/schemas";
import {
  BackgroundReferenceSchema,
  ClassReferenceSchema,
  ContentIdSchema,
  ContentSourceSchema,
  FeatReferenceSchema,
  FeatureUsesSchema,
  ITEM_REFUSED_MODIFIER_MESSAGE,
  ITEM_REFUSED_MODIFIER_TYPES,
  SpeciesReferenceSchema,
  SpellListReferenceSchema,
  SubclassReferenceSchema,
  featureRiders
} from "./character-content.js";

export * from "./character-content.js";
export * from "./spell-lists.js";
export * from "./enums.js";

/**
 * Every reference record declares `source` (default `"srd"`): these are plain `z.object`s, which
 * silently strip undeclared keys. Monsters use `ActorDefinitionSchema.source`, a provenance object,
 * so homebrew monsters are identified at the server's merge instead.
 */
export const ConditionReferenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(60),
  source: ContentSourceSchema,
  description: z.string().min(1).max(4000)
});
export type ConditionReference = z.infer<typeof ConditionReferenceSchema>;

const AbilityShortSchema = z.enum(["str", "dex", "con", "int", "wis", "cha"]);

/** How a spell attack is made: a melee spell attack within `feet` of the caster (Touch is 5; a summoned blade
 *  strikes 5 feet past the spell's range), or a ranged one out to `feet`. */
const SpellAttackRangeSchema = z
  .object({ kind: z.enum(["melee", "ranged"]), feet: z.number().int().min(5).max(5280) })
  .strict();

/** Typed damage, dice or a fixed amount (Guardian of Faith's 20); `addsModifier` adds the caster's spellcasting
 *  ability modifier (Spiritual Weapon's 1d8 + it). */
const SpellDamageSchema = z
  .array(
    z.object({ formula: DamageFormulaSchema, type: DamageTypeSchema, addsModifier: z.boolean().optional() }).strict()
  )
  .max(4);

/**
 * Where and when what a spell leaves behind acts on a creature, so the server raises the save or deals the damage:
 * a creature entering it (or the area moving onto the creature), starting or ending its turn there, or travelling in
 * it (Spike Growth's damage for every 5 feet). The area is the one the cast places on the map, or within `feet` of
 * the caster (an Emanation) or of the point the spell is placed at (Flaming Sphere, a guardian). `oncePerTurn`: "A
 * creature makes this save only once per turn" (entering counts once a turn anyway); `affects` "enemies" spares the
 * caster's allies (Guardian of Faith; spirits that harm the creatures the caster chooses); `damageCap` ends it once
 * it has dealt that much (Guardian of Faith's 60).
 */
export const SpellZoneSchema = z
  .object({
    on: z
      .array(z.enum(["enter", "start-turn", "end-turn", "travel"]))
      .min(1)
      .max(3),
    oncePerTurn: z.literal(true).optional(),
    around: z.enum(["caster", "point"]).optional(),
    feet: z.number().int().min(5).max(120).optional(),
    affects: z.literal("enemies").optional(),
    damageCap: z.number().int().min(1).max(1000).optional(),
    /** The creatures it affects move at half Speed inside it (Spirit Guardians). */
    halvesSpeed: z.literal(true).optional()
  })
  .strict();
export type SpellZone = z.infer<typeof SpellZoneSchema>;

/** Something a spell lets its caster do after the cast, as an action of its own: Produce Flame's hurl, Spiritual
 *  Weapon's later attacks, or the save a creature makes when it enters Spirit Guardians (`activation` "other": no
 *  action; with a `zone` the server watches for it, otherwise the GM spots it). It rolls at the level the spell was
 *  cast at. */
export const SpellLaterActionSchema = z
  .object({
    /** Its name on the sheet, after the spell's ("Spirit Guardians: save"). */
    name: z.string().min(1).max(60),
    activation: z.enum(["action", "bonus-action", "other"]),
    /** When it happens, for the reminder on casting ("a creature enters the Emanation or ends its turn there"). */
    when: z.string().min(1).max(300),
    attackRange: SpellAttackRangeSchema.optional(),
    /** Conditions its hit lands (Conjure Fey's spirit: Frightened until the start of the caster's next turn). */
    onHit: z.array(OnHitRiderSchema).max(2).optional(),
    save: z
      .object({ ability: AbilityShortSchema, ...SaveOutcomeFields })
      .strict()
      .optional(),
    damage: SpellDamageSchema,
    area: ActionAreaSchema.optional(),
    /** It moves the cast's `grant` from a creature at 0 Hit Points to its own target (Hunter's Mark, Hex). */
    movesGrant: z.literal(true).optional(),
    /** It is taken only on the caster's turns after the one it cast the spell on ("As a Bonus Action on your later
     *  turns": Spiritual Weapon, Heat Metal). */
    laterTurnsOnly: z.literal(true).optional(),
    /** What its damage drains as it lands (Vampiric Touch's later touches). */
    drain: DamageDrainSchema.optional(),
    /** The area the spell leaves, whose trigger the server watches (an "other" action only). */
    zone: SpellZoneSchema.optional()
  })
  .strict();
export type SpellLaterAction = z.infer<typeof SpellLaterActionSchema>;

/** One cast's mechanical effect; see `SpellReference.effect`. */
export const SpellEffectSchema = z
  .object({
    /** Spell attack rolls one cast makes (Scorching Ray's three rays); 0 for none. */
    attacks: z.number().int().min(0).max(10),
    /** How those attacks are made. Absent, the spell's range decides. */
    attackRange: SpellAttackRangeSchema.optional(),
    /** Conditions a hit lands on its target (Ray of Sickness: Poisoned until the end of the caster's next turn). */
    onHit: z.array(OnHitRiderSchema).max(2).optional(),
    /** A miss still deals half the hit's damage (Acid Arrow). */
    missDamage: z.literal("half").optional(),
    /** What its damage drains as it lands (Vampiric Touch's healing, Harm's lower Hit Point maximum). */
    drain: DamageDrainSchema.optional(),
    /** What bursts after its attack, hit or miss (Ice Knife's explosion), against the caster's spell save DC. */
    burst: BurstSchema.optional(),
    /** Damage to each target, every part rolled; with `darts`, what each dart deals. */
    damage: SpellDamageSchema,
    /** The damage types the caster picks from on each cast (Chromatic Orb); the damage carries the first. */
    damageTypes: z.array(DamageTypeSchema).min(2).max(10).optional(),
    /** The spell's save is not made when it is cast but later (Spirit Guardians, Web) or never by its target
     *  (Haste, Sanctuary): the cast prompts none. `laterActions` carries one the engine can roll. */
    noCastSave: z.literal(true).optional(),
    laterActions: z.array(SpellLaterActionSchema).min(1).max(3).optional(),
    /** Missiles one cast makes, each at a creature of the caster's choice (Magic Missile's three darts). */
    darts: z.number().int().min(2).max(20).optional(),
    /** How many creatures one cast targets (Bless: up to three), plus `perSlot` more for each slot level above the
     *  spell's own. Absent: the text sets no number the engine checks (an area, or the GM's call). */
    targets: z
      .object({ count: z.number().int().min(1).max(20), perSlot: z.number().int().min(1).max(2).optional() })
      .strict()
      .optional(),
    /** Hit points each target regains; `addsModifier` adds the caster's spellcasting ability modifier, `divided`
     *  makes it one pool shared among the targets (Mass Heal), `toMaximum` restores all of them (Power Word Heal). */
    healing: z
      .object({
        formula: HealingFormulaSchema,
        addsModifier: z.boolean(),
        divided: z.literal(true).optional(),
        toMaximum: z.literal(true).optional(),
        /** The caster alone gains it (False Life). */
        self: z.literal(true).optional(),
        /** It is Temporary Hit Points (False Life). */
        temporary: z.literal(true).optional(),
        /** What it adds for each slot level above the spell's ("5 additional Temporary Hit Points"). */
        perSlot: z.number().int().min(1).max(50).optional()
      })
      .strict()
      .nullable(),
    /** Conditions the cast ends on its targets (Heal: Blinded, Deafened and Poisoned); with `endsOneCondition`, the one
     *  the caster picks (Lesser Restoration). */
    endsConditions: ActionSchema.shape.endsConditions,
    endsOneCondition: ActionSchema.shape.endsOneCondition,
    /** What the cast leaves on the creatures it targets, or the one its attack hits, while it lasts (Bless's d4,
     *  Hunter's Mark's extra damage). */
    grant: ActionGrantSchema.optional(),
    /** What a failed save against the cast leaves on the creature (Bane's -1d4, Faerie Fire's outline). */
    failureEffect: SaveFailureEffectSchema.optional(),
    /** A reaction spell's trigger and response (Shield, Hellish Rebuke), so the table offers it as a prompt. */
    reaction: ActionReactionSchema.optional()
  })
  .strict();
export type SpellEffect = z.infer<typeof SpellEffectSchema>;

export const SpellReferenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(120),
  source: ContentSourceSchema,
  /** Credit line for a homebrew spell whose text came from elsewhere. SRD rows inherit the bundle-wide CC BY notice. */
  attribution: z.string().max(400).optional(),
  level: z.number().int().min(0).max(9),
  school: z.string().min(1).max(40),
  castingTime: z.string().min(1).max(80),
  reactionCondition: z.string().max(400).nullable(),
  range: z.object({ distance: z.number().nullable(), unit: z.string().nullable(), text: z.string().nullable() }),
  components: z.object({
    verbal: z.boolean(),
    somatic: z.boolean(),
    material: z.boolean(),
    materialText: z.string().nullable(),
    materialConsumed: z.boolean()
  }),
  duration: z.string().min(1).max(120),
  concentration: z.boolean(),
  ritual: z.boolean(),
  /** The caster makes a spell attack roll, when it casts or on a later turn: read from the cast model for the SRD,
   *  since the source marks every spell whose text mentions an attack roll (Bless, Shining Smite). */
  attackRoll: z.boolean(),
  damage: z.object({ roll: z.string().nullable(), types: z.array(z.string()) }),
  /** The save the spell forces: the ability the target rolls and what the save does. The caster supplies the DC. */
  save: z
    .object({ ability: AbilityShortSchema, ...SaveOutcomeFields })
    .strict()
    .nullable(),
  target: z.object({ type: z.string().nullable(), count: z.number().int().nullable() }),
  shape: z.object({ type: z.string(), size: z.number().nullable(), unit: z.string().nullable() }).nullable(),
  /** The area a cast covers, for the map template, read from the text at build time. `shape` above is the source's
   *  own field, which records a line's width as its size and has no emanations. */
  area: ActionAreaSchema.nullable().default(null),
  /** What one cast does to its targets: the spell attacks it makes, the damage it deals, the hit points it restores.
   *  Read from the text at build time with a reviewed table, because the source's `damage` and `attack_roll` columns
   *  describe the prose (Hex's later 1d6, Faerie Fire's "attack rolls against"), not a cast. A zone, a summons or a
   *  rider on later hits casts with none of these, and stays for the GM. Actions built from a spell read this. */
  effect: SpellEffectSchema.nullable().default(null),
  classes: z.array(z.string()),
  description: z.string().min(1).max(20000),
  higherLevel: z.string().max(4000).nullable(),
  castingOptions: z.array(
    z.object({
      type: z.string(),
      damageRoll: z.string().nullable(),
      targetCount: z.number().int().nullable(),
      description: z.string().nullable()
    })
  )
});
export type SpellReference = z.infer<typeof SpellReferenceSchema>;

/** A cantrip's printed character-level rows (Fire Bolt's 2d10 at 5), from its `player_level_N` casting options. */
export function cantripScalingOf(
  options: SpellReference["castingOptions"]
): Array<{ characterLevel: number; damageRoll: string | null; targetCount: number | null }> {
  return options
    .flatMap((option) => {
      const match = /^player_level_(\d+)$/.exec(option.type);
      return match
        ? [{ characterLevel: Number(match[1]), damageRoll: option.damageRoll, targetCount: option.targetCount }]
        : [];
    })
    .sort((left, right) => left.characterLevel - right.characterLevel);
}

/** The cantrip row in force at a character level: the highest printed level at or below it, or null below the first. */
export function cantripTierAt<T extends Readonly<{ characterLevel: number }>>(
  rows: readonly T[],
  characterLevel: number
): T | null {
  return rows.filter((row) => row.characterLevel <= characterLevel).at(-1) ?? null;
}

export const WeaponReferenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(80),
  source: ContentSourceSchema,
  category: z.enum(["simple", "martial"]),
  /** The Weapons table's melee/ranged band (a thrown Dagger is melee, a Dart is not). Absent = not recorded. */
  melee: z.boolean().optional(),
  /** The die a Versatile weapon deals used with two hands (`Versatile (1d10)`); absent on other weapons. */
  versatileDice: z.string().min(1).max(20).optional(),
  /** What an Ammunition weapon fires (`Ammunition (Range 150/600; Arrow)`); absent on other weapons. */
  ammunition: AmmunitionKindSchema.optional(),
  improvised: z.boolean(),
  damage: z.object({ dice: z.string().min(1).max(20), type: z.string().min(1).max(40) }),
  rangeFeet: z.number().int().positive().nullable(),
  longRangeFeet: z.number().int().positive().nullable(),
  /** Closed: each mastery is an engine behaviour, so an unknown one would be inert. Optional for homebrew. */
  mastery: z.enum(["cleave", "graze", "nick", "push", "sap", "slow", "topple", "vex"]).optional(),
  /** Open slugs, unlike `mastery`; matches `ItemWeaponSchema.properties`. Absent = not recorded, `[]` = none. */
  properties: z
    .array(
      z
        .string()
        .regex(/^[a-z0-9-]+$/)
        .max(40)
    )
    .max(12)
    .optional()
});
export type WeaponReference = z.infer<typeof WeaponReferenceSchema>;
export const WEAPON_MASTERY_IDS = z.enum(["cleave", "graze", "nick", "push", "sap", "slow", "topple", "vex"]).options;
export type WeaponMasteryId = WeaponReference["mastery"];

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
  /** The Armor table's band. Used to resolve magic-item eligibility ("Any Medium or Heavy"). */
  category: z.enum(["light", "medium", "heavy", "shield"]).optional(),
  addDexModifier: z.boolean(),
  dexModifierCap: z.number().int().nullable(),
  stealthDisadvantage: z.boolean(),
  strengthRequired: z.number().int().nullable()
});
export type ArmorReference = z.infer<typeof ArmorReferenceSchema>;

/**
 * A spell an item can cast; becomes a synthesised action in `actionUses`, re-armed by rests.
 * "Once per day" is `uses: {limit: 1, per: "long-rest"}`.
 */
export const ItemSpellCastSchema = z
  .object({
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
  })
  .strict();
export type ItemSpellCast = z.infer<typeof ItemSpellCastSchema>;

/**
 * How a charged item's charges come back, beside the pools its actions and casts declare: `regain` is rolled on a
 * long rest ("regains 1d6 + 1 expended charges daily at dawn"; absent = all come back), and `lastChargeRoll` rolls a
 * d20 when the last charge is spent, whose 1 does what the item's text says (most crumble).
 */
export const ItemChargesSchema = z
  .object({
    // The SRD's own grammar here includes a d3 ("regains 1d3 expended charges"), which the dice roller lacks.
    regain: z
      .string()
      .regex(/^\d+d(?:3|4|6|8|10|12|20)(?:\s*[+-]\s*\d+)?$/i, "Use a dice formula such as 1d6 + 1.")
      .optional(),
    lastChargeRoll: z.boolean().default(false)
  })
  .strict();
export type ItemCharges = z.infer<typeof ItemChargesSchema>;

/** Attunement. `restrictedTo` is advisory: shown on the sheet, never enforced. */
export const ItemAttunementSchema = z
  .object({
    required: z.boolean().default(false),
    restrictedTo: z.array(ContentIdSchema).max(8).default([])
  })
  .strict();
export type ItemAttunement = z.infer<typeof ItemAttunementSchema>;

/**
 * Weapon stats on a unified equipment row. Kept a named schema: inlining it pushed `z.infer` on
 * `EquipmentReferenceSchema` past TypeScript's expansion budget, which silently truncated an
 * unrelated inferred type in `packages/domain`. `test/bundle.test.ts` guards this at compile time.
 */
const EquipmentWeaponStatsSchema = z.object({
  category: z.enum(["simple", "martial"]),
  damageDice: z.string().max(20),
  damageType: z.string().max(40),
  rangeFeet: z.number().int().positive().nullable(),
  longRangeFeet: z.number().int().positive().nullable(),
  /** The Weapons table's band: a thrown Dagger is melee, a Dart is ranged. Absent = read from range and Thrown. */
  melee: z.boolean().optional(),
  /** A Versatile weapon's two-handed damage die. */
  versatileDice: z.string().max(20).optional(),
  /** What an Ammunition weapon fires. Absent = any ammunition the bearer carries. */
  ammunition: AmmunitionKindSchema.optional(),
  /** Optional here: gear and homebrew rows map through this shape and have no mastery. */
  mastery: z.enum(["cleave", "graze", "nick", "push", "sap", "slow", "topple", "vex"]).optional(),
  /** Copied onto the inventory row, where `weaponPropertiesOf` reads it. */
  properties: z
    .array(
      z
        .string()
        .regex(/^[a-z0-9-]+$/)
        .max(40)
    )
    .max(12)
    .optional()
});

/** The light a lit item sheds, as its description prints it: Bright Light out to `brightFeet` and Dim Light for
 *  `dimFeet` more (Torch: 20 and 20). Dynamic vision lights a carried one while it is equipped (ADR-0023). */
const ItemLightSchema = z
  .object({
    brightFeet: z.number().int().min(0).max(240),
    dimFeet: z.number().int().min(0).max(240)
  })
  .strict();

/**
 * The base weapons or armors a template item may bind to: the SRD's printed qualifier (`label`) and
 * its resolved ids, computed at build or authoring time so the server's bind check is a membership
 * test.
 */
export const ItemAppliesToSchema = z
  .object({
    label: z.string().min(1).max(120),
    baseIds: z
      .array(
        z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .max(60)
      )
      .min(1)
      .max(40)
  })
  .strict();
export type ItemAppliesTo = z.infer<typeof ItemAppliesToSchema>;

/**
 * Unified equipment catalog entry. The only `.strict()` content schema: for hand-authored homebrew
 * items, throwing on an undeclared key catches typos like `weight` for `weightLb`. Declare new fields
 * rather than relaxing it.
 *
 * Riders live here, never on the carried `InventoryItem` row: the owner receives their inventory
 * verbatim in their projection, so a rider there would reveal a cursed item's mechanics.
 */
export const EquipmentReferenceSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1).max(80),
    source: ContentSourceSchema,
    /** Open slug. The engine reads only "weapon", "armor" and "shield"; other categories need `slot` to derive AC or attacks. */
    category: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(40),
    costGp: z.number().nonnegative().max(1_000_000).nullable(),
    weightLb: z.number().nonnegative().max(1000).nullable(),
    /** Matches `InventoryItemSchema.description`, which add-from-catalog copies this string onto. Long enough for
     *  the longest SRD item with its tables (Mysterious Deck). */
    description: z.string().max(12000).nullable(),
    light: ItemLightSchema.optional(),
    weapon: EquipmentWeaponStatsSchema.nullable().optional(),
    armor: z
      .object({
        acBase: z.number().int().min(2).max(25),
        addDexModifier: z.boolean(),
        dexModifierCap: z.number().int().nullable(),
        stealthDisadvantage: z.boolean(),
        strengthRequired: z.number().int().nullable()
      })
      .nullable()
      .optional(),

    // ---- the magic-item vocabulary ---------------------------------------------------------------

    /** Where it is worn or held. Absent = fall back to `category` for the three the engine already knows. */
    slot: ItemSlotSchema.optional(),
    /** With no `weapon`/`armor` block this row is a template, deriving nothing until the player binds it to a base. */
    appliesTo: ItemAppliesToSchema.nullable().optional(),
    /** Display and filtering only ("uncommon", "legendary"). An open slug. */
    rarity: ContentIdSchema.optional(),
    isMagic: z.boolean().default(false),
    attunement: ItemAttunementSchema.optional(),
    /** Cannot be voluntarily removed once attuned; its magic is hidden from the player until attunement, and only until then. */
    cursed: z.boolean().default(false),
    casts: z.array(ItemSpellCastSchema).max(8).default([]),
    charges: ItemChargesSchema.optional(),
    /** Mithral: the armor it is bound to has no Stealth Disadvantage and no Strength requirement. */
    removesArmorDrawbacks: z.boolean().optional(),
    /** Each use of one of its actions uses one up (a potion drunk, a flask thrown), and its actions work from the
     *  pack: drinking or throwing one needs no equipping. */
    consumedOnUse: z.boolean().optional(),
    /** This row is ammunition sold in bundles: each one quantity is `count` pieces of `kind` ("Arrows (20)"). */
    ammunition: z
      .object({ kind: AmmunitionKindSchema, count: z.number().int().min(1).max(100) })
      .strict()
      .optional(),
    /** A Spell Scroll: each carried copy bears one spell, of a level in this range, picked when it is added
     *  (`InventoryItem.spellId`). Reading it casts that spell at its level, with the scroll's DC and attack bonus. */
    spellScroll: z
      .object({ minLevel: z.number().int().min(0).max(9), maxLevel: z.number().int().min(0).max(9) })
      .strict()
      .refine((range) => range.minLevel <= range.maxLevel, { message: "A scroll's lowest level is above its highest." })
      .optional(),
    /** "The GM chooses the type": the types the GM may pick for this item's one granted resistance, which then
     *  replaces the printed default in `grants.damageResistances` for that carried copy. */
    damageTypeChoice: z.array(DamageTypeSchema).min(2).max(13).optional(),
    /** Armor of Vulnerability's curse: while attuned, worn or not, Vulnerability to every type in `damageTypeChoice`
     *  but the one it resists. */
    vulnerableToOtherChoices: z.boolean().optional(),
    /** Feats granted while active, depth 1. Nothing has `grants.items`, so a grant cycle cannot be expressed. */
    grantsFeatIds: z.array(ContentIdSchema).max(4).default([]),

    /** The same rider block a feature, feat and chosen option carry, spread rather than restated. */
    ...featureRiders
  })
  .strict()
  .superRefine((item, context) => {
    // Requiring attunement gives the hiding rule one boundary: hidden until attuned, visible after.
    if (item.cursed && item.attunement?.required !== true) {
      context.addIssue({
        code: "custom",
        path: ["cursed"],
        message:
          "A cursed item must require attunement, because attunement is what springs the curse and what reveals it."
      });
    }
    if (item.damageTypeChoice) {
      const printed = item.grants?.damageResistances ?? [];
      if (printed.length !== 1 || !(item.damageTypeChoice as readonly string[]).includes(printed[0]))
        context.addIssue({
          code: "custom",
          path: ["damageTypeChoice"],
          message: "A chosen damage type replaces one granted resistance: grant exactly one, from the choices."
        });
    }
    // A scroll is read once: reading it uses it up.
    if (item.spellScroll && item.consumedOnUse !== true)
      context.addIssue({
        code: "custom",
        path: ["spellScroll"],
        message: "A Spell Scroll crumbles once it is read: it must be used up on use."
      });
    // The vulnerability is a curse's, and "the other choices" needs choices to be the other of.
    if (item.vulnerableToOtherChoices && (!item.damageTypeChoice || !item.cursed))
      context.addIssue({
        code: "custom",
        path: ["vulnerableToOtherChoices"],
        message: "Vulnerability to the other choices needs a cursed item whose resistance the GM chooses."
      });
    // Enforced on the item carrier only: the identical rider on a feat is valid.
    item.modifiers.forEach((modifier, index) => {
      if (ITEM_REFUSED_MODIFIER_TYPES.includes(modifier.type)) {
        context.addIssue({
          code: "custom",
          path: ["modifiers", index, "type"],
          message: ITEM_REFUSED_MODIFIER_MESSAGE
        });
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

/** One Rules Glossary term: its name, its tag in brackets ("Condition", "Action", "Hazard"), and its text. */
export const GlossaryEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(80),
  tag: z.string().min(1).max(40).nullable(),
  description: z.string().min(1).max(20000)
});
export type GlossaryEntry = z.infer<typeof GlossaryEntrySchema>;

export const ContentAttributionSchema = z.object({
  license: z.literal("CC-BY-4.0"),
  attribution: z.string().min(1),
  source: z.object({
    name: z.string(),
    author: z.string(),
    publisher: z.string(),
    permalink: z.string(),
    vendoredFrom: z.string(),
    retrieved: z.string()
  }),
  /** Further CC BY 4.0 transcriptions the bundles draw on, for provenance; `attribution` is what is owed. */
  additionalSources: z
    .array(
      z.object({
        name: z.string(),
        vendoredFrom: z.string(),
        commit: z.string(),
        retrieved: z.string(),
        covers: z.string()
      })
    )
    .default([])
});
export type ContentAttribution = z.infer<typeof ContentAttributionSchema>;

/** A skill and the ability its check uses; without its own `ability`, `SRD_SKILL_ABILITY` supplies it. */
export const SkillReferenceSchema = ConditionReferenceSchema.extend({ ability: AbilityShortSchema.optional() });
export type SkillReference = z.infer<typeof SkillReferenceSchema>;

/** A language. `table` is the SRD's standard/rare split, which choices narrow on. */
export const LanguageReferenceSchema = ConditionReferenceSchema.extend({
  table: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(40)
    .default("standard")
});
export type LanguageReference = z.infer<typeof LanguageReferenceSchema>;

/** The printed SRD 5.2.1 skill->ability table, used only when a bundle row omits its own `ability`. */
export const SRD_SKILL_ABILITY: Readonly<Record<string, z.infer<typeof AbilityShortSchema>>> = Object.freeze({
  athletics: "str",
  acrobatics: "dex",
  "sleight-of-hand": "dex",
  stealth: "dex",
  arcana: "int",
  history: "int",
  investigation: "int",
  nature: "int",
  religion: "int",
  "animal-handling": "wis",
  insight: "wis",
  medicine: "wis",
  perception: "wis",
  survival: "wis",
  deception: "cha",
  intimidation: "cha",
  performance: "cha",
  persuasion: "cha"
});

/** The nine authorable homebrew types. The server's `HomebrewContentType` is checked against this with `satisfies`. */
export type HomebrewBodyType =
  "class" | "subclass" | "species" | "background" | "feat" | "spell" | "equipment" | "monster" | "spell-list";

/**
 * Type -> body schema, shared by the publish validator (`apps/server/src/homebrew-validate.ts`),
 * the store's read-back parse (`apps/server/src/homebrew-store.ts`, ADR-0016) and the editor's
 * publish checklist (`apps/client/src/homebrew/validate.ts`), so all three give the same answer.
 */
export const HOMEBREW_BODY_SCHEMAS = {
  class: ClassReferenceSchema,
  subclass: SubclassReferenceSchema,
  species: SpeciesReferenceSchema,
  background: BackgroundReferenceSchema,
  feat: FeatReferenceSchema,
  spell: SpellReferenceSchema,
  equipment: EquipmentReferenceSchema,
  monster: ActorDefinitionSchema,
  "spell-list": SpellListReferenceSchema
} as const satisfies Record<HomebrewBodyType, { safeParse: (value: unknown) => { success: boolean } }>;
