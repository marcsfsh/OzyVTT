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
  AmmunitionKindSchema,
  ActionReactionSchema,
  ActorDefinitionSchema,
  DamageTypeSchema,
  DiceFormulaSchema,
  HealingFormulaSchema,
  ItemSlotSchema,
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

/** One cast's mechanical effect; see `SpellReference.effect`. */
export const SpellEffectSchema = z
  .object({
    /** Spell attack rolls one cast makes (Scorching Ray's three rays); 0 for none. */
    attacks: z.number().int().min(0).max(10),
    /** Damage to each target, every part rolled (all three of Magic Missile's darts). */
    damage: z.array(z.object({ formula: DiceFormulaSchema, type: DamageTypeSchema }).strict()).max(4),
    /** Hit points each target regains; `addsModifier` adds the caster's spellcasting ability modifier. */
    healing: z.object({ formula: HealingFormulaSchema, addsModifier: z.boolean() }).strict().nullable(),
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
   *  Read from the text at build time with a reviewed table, because the source's `damage` and `attackRoll` columns
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
    /** This row is ammunition sold in bundles: each one quantity is `count` pieces of `kind` ("Arrows (20)"). */
    ammunition: z
      .object({ kind: AmmunitionKindSchema, count: z.number().int().min(1).max(100) })
      .strict()
      .optional(),
    /** "The GM chooses the type": the types the GM may pick for this item's one granted resistance, which then
     *  replaces the printed default in `grants.damageResistances` for that carried copy. */
    damageTypeChoice: z.array(DamageTypeSchema).min(2).max(13).optional(),
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
          "A cursed item must require attunement - attunement is both what springs the curse and what reveals it."
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
