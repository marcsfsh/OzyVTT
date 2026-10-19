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
  ActionTeleportSchema,
  ActionSchema,
  ActionTargetsSchema,
  ActorDefinitionSchema,
  DamageDrainSchema,
  DamageFormulaSchema,
  DamageTypeSchema,
  DispelSchema,
  HealingFormulaSchema,
  ItemSlotSchema,
  OnHitRiderSchema,
  SaveFailureEffectSchema,
  SaveOutcomeFields,
  SightEffectSchema
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
 * it (Spike Growth's damage for every 5 feet); the start of each of its caster's turns, on the one creature in it
 * nearest its point (Faithful Hound's bite); or the spell's end, on every creature in it (Delayed Blast Fireball's
 * bead). The area is the one the cast places on the map, or within `feet` of the caster (an Emanation) or of the point
 * the spell is placed at (Flaming Sphere, a guardian). `oncePerTurn`: "A creature makes this save only once per turn"
 * (entering counts once a turn anyway); `affects` "enemies" spares the caster's allies (Guardian of Faith; spirits that
 * harm the creatures the caster chooses); `damageCap` ends it once it has dealt that much (Guardian of Faith's 60).
 */
export const SpellZoneSchema = z
  .object({
    on: z
      .array(z.enum(["enter", "start-turn", "end-turn", "travel", "caster-turn-start", "spell-end"]))
      .min(1)
      .max(3),
    oncePerTurn: z.literal(true).optional(),
    around: z.enum(["caster", "point"]).optional(),
    feet: z.number().int().min(5).max(120).optional(),
    affects: z.literal("enemies").optional(),
    damageCap: z.number().int().min(1).max(1000).optional(),
    /** The creatures it affects move at half Speed inside it (Spirit Guardians). */
    halvesSpeed: z.literal(true).optional(),
    /** It acts on no one while a creature it restrained is still held (Conjure Elemental: "if the spirit has no creature
     *  Restrained"). */
    holdsOne: z.literal(true).optional(),
    /** Its damage grows by one die each time its caster's turn ends while it lasts (Delayed Blast Fireball). */
    grows: z.literal(true).optional()
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
    /** What a successful save leaves instead (Ray of Enfeeblement's Disadvantage on the next attack roll). */
    successEffect: SaveFailureEffectSchema.optional(),
    /** A reaction spell's trigger and response (Shield, Hellish Rebuke), so the table offers it as a prompt. */
    reaction: ActionReactionSchema.optional(),
    /** The teleport the cast gives its caster (Misty Step's 30 feet), taken on the map at once with no GM ask. */
    teleport: ActionTeleportSchema.optional(),
    /** The caster makes the spell's save itself, at this DC whatever its own (Contact Other Plane's DC 15). */
    selfSave: z
      .object({ dc: z.number().int().min(1).max(40) })
      .strict()
      .optional(),
    /** The cast ends spells on its target (Dispel Magic). */
    dispel: DispelSchema.optional(),
    /** The cast ends the curses on its target and its Attunement to cursed items (Remove Curse). */
    endsCurses: z.literal(true).optional(),
    /** The spell keeps something of its own besides what it leaves on creatures (Entangle's tangled ground, an
     *  earthquake's fissures), so its Concentration holds when no creature is affected any more. */
    persistsWithoutTargets: z.literal(true).optional(),
    /** Its targets are creatures the caster can see ("a creature you can see within range"): with the map's vision on,
     *  the server refuses one the caster can't see. */
    seenTargets: z.literal(true).optional(),
    /** The creature types it can target (Hold Person: a Humanoid). A creature of another type picked as its target is
     *  refused, and one caught in its area is left out of it. */
    targetTypes: z
      .array(
        z
          .string()
          .regex(/^[a-z][a-z-]*$/)
          .max(40)
      )
      .min(1)
      .max(6)
      .optional(),
    /** The caster picks its targets among the creatures in its area ("up to six creatures of your choice in a 40-foot
     *  Cube", Mass Cure Wounds' Sphere), so a cast picks creatures that one such area can hold within range; `targets`
     *  caps how many. Without it, an area's targets are every creature its template covers. */
    picksInArea: z.literal(true).optional(),
    /** Its targets after the first stand within this many feet of the first (Chain Lightning's leaping bolts). */
    chainFeet: z.number().int().min(5).max(300).optional(),
    /** The cast makes a creature at 0 Hit Points that isn't dead Stable (Spare the Dying). */
    stabilizes: z.literal(true).optional(),
    /** A cantrip whose range doubles at character levels 5, 11 and 17 (Spare the Dying's 15 feet). */
    rangeDoubles: z.literal(true).optional(),
    /** No sound can be made in the area its cast places (Silence), so a creature standing there can't cast a spell
     *  with a Verbal component while the spell lasts. */
    silencesArea: z.literal(true).optional()
  })
  .strict();
export type SpellEffect = z.infer<typeof SpellEffectSchema>;

/** A spell's duration from a higher spell slot, as its higher-level text prints it: from `level` up, the spell lasts
 *  `duration` (in the grammar of the spell's own: "10 minutes", "8 hours", "until dispelled"), and needs Concentration
 *  only when `concentration` says so (Bestow Curse from a level 5 slot needs none). */
export const UpcastDurationSchema = z
  .object({
    level: z.number().int().min(1).max(9),
    duration: z.string().min(1).max(120),
    concentration: z.boolean()
  })
  .strict();
export type UpcastDuration = z.infer<typeof UpcastDurationSchema>;

/**
 * A material a cast needs in hand that a Component Pouch or a Spellcasting Focus can't stand in for (SRD Components):
 * one with a printed worth, or one the spell consumes. A carried item is that material when it is one of `itemIds`
 * (Holy Water) or its name holds one of `matches` ("diamond"); the GM judges its worth. `coins` are paid from the purse
 * instead (Gentle Repose's 2 Copper Pieces).
 */
export const SpellMaterialSchema = z
  .object({
    /** What the text names ("a diamond"), for the reason a cast is refused. */
    name: z.string().min(1).max(80),
    matches: z.array(z.string().min(2).max(40)).max(6).optional(),
    itemIds: z
      .array(
        z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .max(80)
      )
      .max(4)
      .optional(),
    /** Its printed worth in GP for each one ("worth 300+ GP"); null when the text prints none. */
    costGp: z.number().min(0).max(100_000).nullable(),
    /** How many the cast needs ("four ivory strips"); with `perTarget`, for each creature it targets. */
    count: z.number().int().min(1).max(20).optional(),
    perTarget: z.literal(true).optional(),
    /** The spell consumes it ("which the spell consumes"), so the cast uses it up. */
    consumed: z.boolean(),
    coins: z
      .object({ unit: z.enum(["cp", "sp", "ep", "gp", "pp"]), amount: z.number().int().min(1).max(10_000) })
      .strict()
      .optional()
  })
  .strict();
export type SpellMaterial = z.infer<typeof SpellMaterialSchema>;

export const SpellReferenceSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .describe(
        "The record's own id. The server forces it to the row's minted id (`hb-<slug>-<6 hex>`) on every write, because a body whose id drifted from the row would resolve to nothing once the merge reads it back through the bundle schemas"
      ),
    name: z.string().min(1).max(120),
    source: ContentSourceSchema.describe(
      'Always "homebrew" once stored; the field exists so an authored record and a merged-catalog row read the same'
    ),
    /** Credit line for a homebrew spell whose text came from elsewhere. SRD rows inherit the bundle-wide CC BY notice. */
    attribution: z
      .string()
      .max(400)
      .optional()
      .describe(
        "Credit line when the text came from somewhere else; SRD records inherit the bundle-wide CC BY notice instead"
      ),
    level: z.number().int().min(0).max(9).describe("0 is a cantrip"),
    school: z.string().min(1).max(40),
    castingTime: z.string().min(1).max(80),
    reactionCondition: z
      .string()
      .max(400)
      .nullable()
      .describe("What triggers the reaction, for a spell cast as one; null otherwise"),
    range: z.object({ distance: z.number().nullable(), unit: z.string().nullable(), text: z.string().nullable() }),
    components: z.object({
      verbal: z.boolean(),
      somatic: z.boolean(),
      material: z.boolean(),
      materialText: z.string().nullable(),
      materialConsumed: z.boolean(),
      /** The materials of `materialText` a cast needs in hand, read from it when the bundle is built: each one with a
       *  worth or that the spell consumes. Absent, a Component Pouch or a Spellcasting Focus stands in for the material. */
      costly: z.array(SpellMaterialSchema).min(1).max(4).optional()
    }),
    duration: z.string().min(1).max(120),
    concentration: z.boolean(),
    /** How a higher slot changes the duration and the Concentration, lowest slot first (Dominate Beast from a level 5
     *  slot lasts 10 minutes). Absent: every slot lasts `duration`. */
    upcastDurations: z
      .array(UpcastDurationSchema)
      .max(8)
      .optional()
      .describe(
        "How a higher spell slot changes the duration and whether it needs Concentration, lowest slot first. Absent: every slot lasts the spell's own duration"
      ),
    ritual: z.boolean(),
    /** The caster makes a spell attack roll, when it casts or on a later turn: read from the cast model for the SRD,
     *  since the source marks every spell whose text mentions an attack roll (Bless, Shining Smite). */
    attackRoll: z.boolean(),
    damage: z.object({
      roll: z.string().nullable().describe('Base damage/healing roll ("8d6"), or null when the spell rolls nothing'),
      types: z.array(z.string())
    }),
    /** The save the spell forces: the ability the target rolls and what the save does. The caster supplies the DC. */
    save: z
      .object({ ability: AbilityShortSchema, ...SaveOutcomeFields })
      .strict()
      .describe(
        "The save a spell forces: the ability the target rolls and what the save does. The caster supplies the DC."
      )
      .nullable()
      .describe("The save the spell forces; null when it forces none"),
    target: z.object({ type: z.string().nullable(), count: z.number().int().nullable() }),
    shape: z
      .object({ type: z.string(), size: z.number().nullable(), unit: z.string().nullable() })
      .describe("A spell's area of effect.")
      .nullable()
      .describe("The area of effect; null for a single-target spell"),
    /** The area a cast covers, for the map template, read from the text at build time. `shape` above is the source's
     *  own field, which records a line's width as its size and has no emanations. */
    area: ActionAreaSchema.nullable().default(null),
    /** What one cast does to its targets: the spell attacks it makes, the damage it deals, the hit points it restores.
     *  Read from the text at build time with a reviewed table, because the source's `damage` and `attack_roll` columns
     *  describe the prose (Hex's later 1d6, Faerie Fire's "attack rolls against") and no single cast. A zone, a summons or a
     *  rider on later hits casts with none of these, and stays for the GM. Actions built from a spell read this. */
    effect: SpellEffectSchema.nullable().default(null),
    /** What the spell does to light and sight while it lasts (Light, Darkness, Fog Cloud, Daylight), which dynamic
     *  vision reads. */
    sight: SightEffectSchema.optional(),
    classes: z
      .array(z.string())
      .describe(
        'Spell-list ids this spell belongs to ("wizard", a homebrew list slug). A HomebrewSpellListRecord can also pull a spell in without touching this'
      ),
    description: z.string().min(1).max(20000),
    higherLevel: z.string().max(4000).nullable(),
    castingOptions: z
      .array(
        z.object({
          type: z.string(),
          damageRoll: z.string().nullable(),
          targetCount: z.number().int().nullable(),
          description: z.string().nullable()
        })
      )
      .describe("Per-slot-level upcast scaling; the sheet applies the row matching the chosen cast level")
  })
  .describe(
    "A spell. `classes` carries the spell-list ids this spell belongs to; it is how a homebrew spell joins a list, paired with the class record's `spellcasting.spellListId`."
  );
export type SpellReference = z.infer<typeof SpellReferenceSchema>;

/** A spell's upcast rows by slot level (Fireball's 9d6 at 4th), from its `slot_level_N` casting options. A cantrip's
 *  character-level scaling is no cast-at option, so it is left out. */
export function slotCastingOptionsOf(
  options: SpellReference["castingOptions"]
): Array<{ level: number; damageRoll: string | null; targetCount: number | null }> {
  return options.flatMap((option) => {
    const match = /^slot_level_(\d+)$/.exec(option.type);
    return match ? [{ level: Number(match[1]), damageRoll: option.damageRoll, targetCount: option.targetCount }] : [];
  });
}

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
    atLevel: z
      .number()
      .int()
      .min(0)
      .max(9)
      .optional()
      .describe("Cast at this slot level; absent = the spell's own level"),
    /** Which ability powers it; absent = the wielder's own spellcasting ability. */
    ability: AbilitySchema.optional().describe(
      "Which ability powers it; absent = the wielder's own spellcasting ability"
    ),
    /** A flat printed DC ("save DC 15"). It overrides any derivation. */
    saveDc: z
      .number()
      .int()
      .min(1)
      .max(40)
      .optional()
      .describe('A flat printed DC ("save DC 15"). It overrides any derivation'),
    /** Charges. Share one pool across several casts with `uses.pool`. */
    uses: FeatureUsesSchema.optional().describe("Charges. Share one pool across several casts with `uses.pool`"),
    /** Whether casting it also spends one of the bearer's own spell slots. */
    consumesSpellSlot: z
      .boolean()
      .default(false)
      .describe("Whether casting it also spends one of the bearer's own spell slots"),
    /** Who the item's cast may affect beside what the spell allows (a Ring of Animal Influence's Fear: Beasts only). */
    targets: ActionTargetsSchema.optional().describe(
      "Who the item's cast may affect beside what the spell allows (a Ring of Animal Influence's Fear affects Beasts only), checked on the server"
    )
  })
  .strict()
  .describe(
    'A spell an item can cast. Needs no new machinery: an item cast is one more synthesised action whose limited uses collapse into the same live uses namespace a feature\'s do, and rests already re-arm it. "Once per day" is `uses: {"limit": 1, "per": "long-rest"}`; there is deliberately no "day" in the `per` vocabulary, because this app already treats a Long Rest as the day.'
  );
export type ItemSpellCast = z.infer<typeof ItemSpellCastSchema>;

/**
 * How a charged item's charges come back, beside the pools its actions and casts declare: `regain` is rolled on a
 * Long Rest ("regains 1d6 + 1 expended charges daily at dawn"; absent = all come back), and `lastChargeRoll` rolls a
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
    restrictedTo: z
      .array(ContentIdSchema)
      .max(8)
      .default([])
      .describe("Class or species ids the item is meant for. Advisory only")
  })
  .strict()
  .describe(
    'Attunement. `restrictedTo` matches class ids or a species id and is advisory: shown on the sheet ("Requires attunement by a cleric"), never a block: it is an open slug set, blocking on a fuzzy match would be wrong, and a GM handing a player a restricted item on purpose is a normal table event, with nothing to refuse.'
  );
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
  longRangeFeet: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe("Attacks past `rangeFeet` up to this roll at disadvantage"),
  /** The Weapons table's band: a thrown Dagger is melee, a Dart is ranged. Absent = read from range and Thrown. */
  melee: z
    .boolean()
    .optional()
    .describe(
      "The SRD Weapons table's band: true for a melee weapon (a thrown Dagger), false for a ranged one (a Dart). Only a melee weapon gets a melee reach. Absent reads the band from the range and the Thrown property"
    ),
  /** A Versatile weapon's two-handed damage die. */
  versatileDice: z
    .string()
    .max(20)
    .optional()
    .describe(
      'A Versatile weapon\'s damage die with two hands ("1d10" for a Longsword). The sheet offers the two-handed attack while no Shield is equipped'
    ),
  /** What an Ammunition weapon fires. Absent = any ammunition the bearer carries. */
  ammunition: AmmunitionKindSchema.optional(),
  /** Optional here: gear and homebrew rows map through this shape and have no mastery. */
  mastery: z
    .enum(["cleave", "graze", "nick", "push", "sap", "slow", "topple", "vex"])
    .optional()
    .describe(
      "The SRD weapon-mastery property, if this weapon has one. Optional: a homebrew weapon may have none, and a mastery does nothing until a character unlocks this weapon through Weapon Mastery."
    ),
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
    .describe(
      "The weapon's property slugs. The engine reads three of them off the character's inventory row: `finesse` makes the swing take the better of Strength and Dexterity, `thrown` lets a melee weapon be thrown at range, and `reach` makes its reach 10 feet; the rest narrow a `weapon-property-is` rider. Open slugs, unlike `mastery`, so a homebrew property is expressible, but only the nine SRD ones have readers, and an unknown slug is inert and raises no error. Omit to record nothing; an empty array says the weapon has none."
    )
});

/** The light a lit item sheds, as its description prints it: Bright Light out to `brightFeet` and Dim Light for
 *  `dimFeet` more (Torch: 20 and 20). Dynamic vision lights its bearer while it is lit and equipped (ADR-0023). */
const ItemLightSchema = z
  .object({
    brightFeet: z.number().int().min(0).max(240),
    dimFeet: z.number().int().min(0).max(240),
    /** The light is a Cone the bearer aims (a Bullseye Lantern). */
    cone: z.literal(true).optional(),
    /** With its hood lowered (a Hooded Lantern): "reducing the light to Dim Light in a 5-foot radius". */
    hooded: z
      .object({ brightFeet: z.number().int().min(0).max(240), dimFeet: z.number().int().min(0).max(240) })
      .strict()
      .optional(),
    /** Its Bright Light is sunlight (a Sun Blade). */
    sunlight: z.literal(true).optional(),
    /** Invisible creatures in its Bright Light are seen (a Lantern of Revealing). */
    revealsInvisible: z.literal(true).optional(),
    /** It sheds its light whenever it is held, with nothing to light (a Mace of Disruption). */
    always: z.literal(true).optional(),
    /** Its other riders apply only while it is lit (a Flame Tongue's 2d6 Fire while ablaze). */
    ridersWhileLit: z.literal(true).optional(),
    /** How long it burns once lit, in hours: a Torch or Candle is used up, and a Lamp or Lantern spends a flask of
     *  `fuel` (Oil). */
    burnHours: z.number().int().min(1).max(24).optional(),
    fuel: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80)
      .optional()
  })
  .strict()
  .describe(
    "The light the item sheds while it is lit and equipped: Bright Light out to `brightFeet` and Dim Light for `dimFeet` more, a Cone with `cone`, less with its hood down (`hooded`), sunlight with `sunlight`, and revealing Invisible creatures in its Bright Light with `revealsInvisible`. `burnHours` is how long it burns once lit, spending a `fuel` item when it names one. With `always` it shines whenever it is held, and with `ridersWhileLit` its other riders apply only while it is lit."
  );
export type ItemLight = z.infer<typeof ItemLightSchema>;

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
 * and keep it strict.
 *
 * Riders live here, never on the carried `InventoryItem` row: the owner receives their inventory
 * verbatim in their projection, so a rider there would reveal a cursed item's mechanics.
 */
export const EquipmentReferenceSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .describe(
        "The record's own id. The server forces it to the row's minted id (`hb-<slug>-<6 hex>`) on every write, because a body whose id drifted from the row would resolve to nothing once the merge reads it back through the bundle schemas"
      ),
    name: z.string().min(1).max(80),
    source: ContentSourceSchema.describe(
      'Always "homebrew" once stored; the field exists so an authored record and a merged-catalog row read the same'
    ),
    /** Open slug. The engine reads only "weapon", "armor" and "shield"; other categories need `slot` to derive AC or attacks. */
    category: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(40)
      .describe(
        'Open slug: "relic", "vehicle" and "trinket" need no schema change. Display and grouping; `slot` is what the engine switches on'
      ),
    costGp: z.number().nonnegative().max(1_000_000).nullable(),
    weightLb: z.number().nonnegative().max(1000).nullable(),
    /** Matches `InventoryItemSchema.description`, which add-from-catalog copies this string onto. Long enough for
     *  the longest SRD item with its tables (Mysterious Deck). */
    description: z
      .string()
      .max(12000)
      .nullable()
      .describe(
        "Matches both `EquipmentReferenceSchema` and `InventoryItemSchema.description`, the row this string is copied onto by add-from-catalog. Long enough for the longest SRD item with its tables (Mysterious Deck, Wand of Wonder)"
      ),
    light: ItemLightSchema.optional(),
    weapon: EquipmentWeaponStatsSchema.nullable().optional().describe("Populated for weapons only"),
    armor: z
      .object({
        acBase: z.number().int().min(2).max(25),
        addDexModifier: z.boolean(),
        dexModifierCap: z.number().int().nullable(),
        stealthDisadvantage: z.boolean(),
        strengthRequired: z.number().int().nullable()
      })
      .describe("Body armor carries its full base AC (11-18); a shield carries its +2 bonus.")
      .nullable()
      .optional()
      .describe("Populated for armor and shields only"),

    // ---- the magic-item vocabulary ---------------------------------------------------------------

    /** Where it is worn or held. Absent = fall back to `category` for the three the engine already knows. */
    slot: ItemSlotSchema.optional().describe(
      "Where it is worn or held: the mechanical hook, and the one closed enum here. Absent = fall back to `category` for the three the engine already knows (weapon, armor, shield)"
    ),
    /** With no `weapon`/`armor` block this row is a template and derives nothing until the player binds it to a base. */
    appliesTo: ItemAppliesToSchema.nullable()
      .optional()
      .describe(
        'Makes the item a template (the SRD\'s "Weapon, +1 (Any Simple or Martial)"). `label` is the printed wording the chooser shows; `baseIds` the resolved weapon/armor ids the player may pick from; publish refuses an id the merged catalog cannot resolve, a category other than weapon, armor or ammunition, and fixed stats alongside a template. The picked base\'s stats are copied onto the inventory row by the server at set-inventory; the row records the pick as `baseId`. Magic ammunition names the gear table\'s ammunition ("Any Ammunition": Arrows, Crossbow Bolts...): its pick copies no stats and says which launchers fire it.'
      ),
    /** Display and filtering only ("uncommon", "legendary"). An open slug. */
    rarity: ContentIdSchema.optional().describe(
      'Display and filtering only ("uncommon", "legendary"). An open slug: rarity is identity and drives no mechanics'
    ),
    isMagic: z.boolean().default(false),
    attunement: ItemAttunementSchema.optional().describe(
      "Attunement requirement and its advisory class/species restriction"
    ),
    /** Cannot be voluntarily removed once attuned; its magic is hidden from the player until attunement, and only until then. */
    cursed: z
      .boolean()
      .default(false)
      .describe(
        "A cursed item cannot be voluntarily removed once attuned, and its magic half is withheld from the player until attunement. It must require attunement, because a curse you can drop by taking the hat off is not a curse, and requiring attunement gives the hiding rule one well-defined boundary: hidden until attuned, fully visible after, because by then the player has learned it and hiding further would only make their own sheet lie to them"
      ),
    casts: z
      .array(ItemSpellCastSchema)
      .max(8)
      .default([])
      .describe("Spells the item can cast (Amulet of Message, Wand of Fireballs)"),
    charges: ItemChargesSchema.optional().describe(
      "How a charged item's charges come back. `regain` is the dice a Long Rest rolls (absent: every charge returns); `lastChargeRoll` rolls a d20 when the last charge is spent and tells the GM, since a 1 does what the item's text says. The charges themselves are the `uses` on its casts and actions, counted per carried copy"
    ),
    /** Mithral: the armor it is bound to has no Stealth Disadvantage and no Strength requirement. */
    removesArmorDrawbacks: z
      .boolean()
      .optional()
      .describe(
        "Mithral: the armor this template is bound to keeps neither its Stealth Disadvantage nor its Strength requirement, on the bound row and in the derivation"
      ),
    /** Each use of one of its actions uses one up (a potion drunk, a flask thrown), and its actions work from the
     *  pack: drinking or throwing one needs no equipping. */
    consumedOnUse: z
      .boolean()
      .optional()
      .describe(
        "Each use of one of its actions takes one from the carried stack (a potion drunk, a flask thrown), on the fight's resolve and on the loose route alike, and its actions work from the pack without equipping it"
      ),
    /** This row is ammunition sold in bundles: each one quantity is `count` pieces of `kind` ("Arrows (20)"). */
    ammunition: z
      .object({ kind: AmmunitionKindSchema, count: z.number().int().min(1).max(100) })
      .strict()
      .optional()
      .describe(
        'This row is ammunition sold in bundles: each one of its quantity is `count` pieces of `kind` ("Arrows (20)" is 20 arrows). A shot from a weapon that fires that kind spends a piece, and half the pieces fired come back when the encounter ends. Absent on magic ammunition, counted one piece per quantity'
      ),
    /** A Spell Scroll: each carried copy bears one spell, of a level in this range, picked when it is added
     *  (`InventoryItem.spellId`). Reading it casts that spell at its level, with the scroll's DC and attack bonus. */
    spellScroll: z
      .object({ minLevel: z.number().int().min(0).max(9), maxLevel: z.number().int().min(0).max(9) })
      .strict()
      .refine((range) => range.minLevel <= range.maxLevel, { message: "A scroll's lowest level is above its highest." })
      .optional()
      .describe(
        "A Spell Scroll: each carried copy bears one spell of these levels (0 is a cantrip), stored as the row's `spellId` and checked by the server when it is added. Reading it casts the spell at its level with the Spell Scroll table's save DC and attack bonus, no spell slot and no Material components, and uses it up; a reader whose spell list lacks the spell can't read it, and one above the reader's levels needs a check first. Needs `consumedOnUse`"
      ),
    /** A manual or tome: studied for its reading time, it raises its reader's score for good, and its magic then
     *  sleeps. */
    study: z
      .object({
        ability: AbilityShortSchema,
        amount: z.number().int().min(1).max(4),
        maximum: z.number().int().min(20).max(30),
        hours: z.number().int().min(1).max(1000),
        days: z.number().int().min(1).max(365)
      })
      .strict()
      .optional()
      .describe(
        "A manual or tome (\"If you spend 48 hours over a period of 6 days or fewer studying the book's contents and practicing its guidelines, your Constitution increases by 2, to a maximum of 30\"): `hours` of study within `days`, after which the reader's `ability` rises by `amount`, never above `maximum`, for good. The GM marks the study done (the time is downtime the GM gives); the server records it in the reader's build, so a rebuild keeps it, and the copy's magic is spent, so no one else gains from it"
      ),
    /** "The GM chooses the type": the types the GM may pick for this item's one granted resistance, which then
     *  replaces the printed default in `grants.damageResistances` for that carried copy. */
    damageTypeChoice: z
      .array(DamageTypeSchema)
      .min(2)
      .max(13)
      .optional()
      .describe(
        '"The GM chooses the type" (Ring of Resistance, Dragon Scale Mail): the types the GM may pick for the one resistance in `grants.damageResistances`, which is the printed default until the GM picks. The pick is stored per carried copy as the row\'s `chosenDamageType`, which only the GM can set'
      ),
    /** Armor of Vulnerability's curse: while attuned, worn or not, Vulnerability to every type in `damageTypeChoice`
     *  but the one it resists. */
    vulnerableToOtherChoices: z
      .boolean()
      .optional()
      .describe(
        "Armor of Vulnerability's curse: while the bearer is attuned, worn or not, Vulnerability to every `damageTypeChoice` type except the one it resists. Needs `cursed` and `damageTypeChoice`"
      ),
    /** What a hit with this weapon does beside its damage (Giant Slayer's save against Prone, a Sword of Wounding's
     *  stopped healing, a Sword of Sharpness's Exhaustion on a rolled 20). */
    onHit: z
      .array(OnHitRiderSchema)
      .max(4)
      .optional()
      .describe(
        "What a hit with this weapon does beside its damage: each rider rides every attack the item makes (both grips, its Light extra attack) and lands as the monster on-hit riders do, a save at its DC (Giant Slayer), a rolled 20 only (Sword of Sharpness), a creature type only, or the coat its own action put on (Dagger of Venom). Needs a `weapon` block or `appliesTo`"
      ),
    /** Feats granted while active, depth 1. Nothing has `grants.items`, so a grant cycle cannot be expressed. */
    grantsFeatIds: z
      .array(ContentIdSchema)
      .max(4)
      .default([])
      .describe(
        "Feats the item grants while active. Depth 1, no transitive expansion, and the grant edge is one-directional (nothing ever grants an item back), so a cycle cannot be drawn, and no check for one is needed"
      ),

    /** The same rider block a feature, feat and chosen option carry, spread in whole. */
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
    // A hit rider rides the item's own attacks, so the item has to make one.
    if (item.onHit && !item.weapon && !item.appliesTo)
      context.addIssue({
        code: "custom",
        path: ["onHit"],
        message: "What a hit does needs a weapon to hit with: give the item weapon stats or a base weapon."
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
  })
  .describe(
    'Any item: weapon, armor, shield, gear, tool, pack, focus, consumable, magic item, or a homebrew kind nobody has invented yet. It has no `summary` or `attribution`, and an undeclared key is refused. `slot` is now the mechanical hook (`category` stays the open display slug), so a homebrew `category: "relic"` with `slot: "armor"` does derive AC. Every rider below lives on the catalog record and never on the carried inventory row: an owner is handed their whole inventory verbatim in their projection, so a rider mirrored onto that row would reach the player the instant they picked the item up, which is what makes hiding a cursed item\'s mechanics structural, with no deletion for someone to remember.'
  );
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
