/**
 * Character-builder content records (classes, subclasses, species, backgrounds, feats, name pools).
 *
 * Features are data: one `FeatureRecord` shape (prose plus optional riders) serves class and subclass
 * features, species traits, background features, feats and pickable options, so homebrew needs no
 * hardcoded behavior. Every record carries `source` ("srd" | "homebrew"). Identities are open slugs;
 * only the six abilities are a closed enum.
 */
import { z } from "zod";
import {
  AbilitySchema,
  ActionSchema,
  AttackBonusVariantSchema,
  DiceFormulaSchema,
  EffectGrantSchema,
  ExtraDamageVariantSchema,
  GrantWhenSchema,
  HitDieSchema,
  RollModeVariantSchema,
  riderGate
} from "@vtt/schemas";

export {
  GrantWhenSchema,
  ItemSlotSchema,
  RIDER_TRIGGER_KINDS,
  RiderTriggerSchema,
  RiderWhenSchema,
  riderLayer,
  riderGate,
  type ItemSlot,
  type RiderTrigger,
  type RiderTriggerKind
} from "@vtt/schemas";

/** Every identity in the content catalog is an open slug - never a closed enum (principle 3). */
export const ContentIdSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .max(80);
export const ContentLevelSchema = z.number().int().min(1).max(20);
/** Which catalog a record came from. One discriminator, merged once (principle 2). */
export const ContentSourceSchema = z.enum(["srd", "homebrew"]).default("srd");
export type ContentSource = z.infer<typeof ContentSourceSchema>;

/** Fields every content record shares. Exported so homebrew schemas compose the same header. */
export const contentRecordBase = {
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

// ---- FeatureRecord: the one shape every class/subclass/species/background/feat feature uses ----

/** Uses regained on a rest: a flat `limit` or a `scaling` rule. `pool` shares one counter across features. */
export const FeatureUsesSchema = z
  .object({
    limit: z.number().int().min(1).max(20).optional(),
    scaling: z
      .discriminatedUnion("type", [
        z.object({ type: z.literal("proficiency-bonus") }).strict(),
        z
          .object({
            type: z.literal("ability-modifier"),
            ability: AbilitySchema,
            minimum: z.number().int().min(0).max(5).default(1)
          })
          .strict(),
        z
          .object({
            type: z.literal("by-level"),
            table: z
              .array(z.object({ level: ContentLevelSchema, limit: z.number().int().min(0).max(99) }).strict())
              .min(1)
              .max(20)
          })
          .strict(),
        /** The class table's printed column for this level (Rage, Channel Divinity); a dice-string column gives 0. */
        z.object({ type: z.literal("class-resource"), id: ContentIdSchema }).strict()
      ])
      .optional(),
    per: z.enum(["turn", "encounter", "short-rest", "long-rest"]),
    pool: ContentIdSchema.optional()
  })
  .strict()
  .superRefine((uses, context) => {
    if (uses.limit === undefined && uses.scaling === undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Limited uses need either a flat `limit` or a `scaling` rule."
      });
  });
export type FeatureUses = z.infer<typeof FeatureUsesSchema>;

/** An attack a feature grants; names the ability, and the builder derives the to-hit. */
export const FeatureAttackSchema = z
  .object({
    ability: z.union([AbilitySchema, z.literal("spellcasting")]),
    proficient: z.boolean().default(true),
    reachFeet: z.number().int().positive().optional(),
    rangeFeet: z.number().int().positive().optional(),
    rangeNormalFeet: z.number().int().positive().optional(),
    count: z.number().int().min(1).max(10).optional(),
    criticalBonusDice: z.number().int().min(1).max(4).optional()
  })
  .strict();

/**
 * The DC of a save a feature forces: `"spellcasting"` (the character's spell save DC), a flat printed
 * number, or `base + ability modifier (+ proficiency bonus)` ("DC 8 plus your Constitution modifier
 * and Proficiency Bonus").
 */
export const FeatureSaveDcSchema = z.union([
  z.literal("spellcasting"),
  z.number().int().min(1).max(40),
  z
    .object({
      /** The printed constant the modifiers are added to; 8 in every SRD 5.2.1 printing. */
      base: z.number().int().min(1).max(30).default(8),
      /** Whose modifier is added - the caster's ability, not the ability the target rolls. */
      ability: AbilitySchema,
      /** Whether the character's proficiency bonus is added too (every SRD printing: yes). */
      proficiencyBonus: z.boolean().default(true)
    })
    .strict()
]);
export type FeatureSaveDc = z.infer<typeof FeatureSaveDcSchema>;

/** A save a feature forces. `ability` is what the target rolls; `dc` is how the number is derived. */
export const FeatureSaveSchema = z
  .object({
    ability: AbilitySchema,
    dc: FeatureSaveDcSchema
  })
  .strict();

/** A rollable action a feature adds (Second Wind, Breath Weapon): `ActionSchema` with derived attack/save. */
export const FeatureActionSchema = ActionSchema.omit({ attack: true, save: true }).extend({
  attack: FeatureAttackSchema.optional(),
  save: FeatureSaveSchema.optional(),
  /** Damage that grows with level, replacing `damage` at the highest matching level (Sneak Attack, Divine Smite). */
  damageByLevel: z
    .array(
      z.object({ level: ContentLevelSchema, formula: DiceFormulaSchema, type: z.string().min(1).max(40) }).strict()
    )
    .max(20)
    .optional()
});
export type FeatureAction = z.infer<typeof FeatureActionSchema>;

/**
 * Gated grants are re-evaluated on every read, but granted spells are baked into
 * `definition.spellcasting` at build time, so a gated spell would reach nothing. The combination is
 * refused at authoring.
 */
export function grantedSpellGateMessage(spellIds: readonly string[]): string {
  const named = spellIds.map((id) => `"${id}"`).join(", ");
  return `A gated grant cannot hand over a spell, so a grants block cannot carry "when" and "spells" together: ${named} would reach nothing at all. The other ten lists are recomputed from the sheet on every read, so their gate is answered on every read - but a granted spell is baked into the character's spell list, its prepared count and its cantrip's action when the character is BUILT, and nothing reads the gate again afterwards. Put the spells in a second grants block with no "when" - this record without one, or a second feature - and keep the gate on the ten lists that can carry it.`;
}

/**
 * Flat things a feature hands the character, as open slugs. One optional `when` gates the whole block
 * (static and dynamic triggers only); `spells` cannot be gated. `FeatureGrantsFieldsSchema` is exported
 * for key censuses that need `.shape`; parse through `FeatureGrantsSchema`.
 */
export const FeatureGrantsFieldsSchema = z
  .object({
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
    spells: z
      .array(
        z
          .object({
            id: ContentIdSchema,
            level: z.number().int().min(0).max(9).optional(),
            alwaysPrepared: z.boolean().default(true),
            ability: AbilitySchema.optional()
          })
          .strict()
      )
      .max(30)
      .default([]),
    /** The condition the ten list fields apply under (not `spells`). Absent = unconditional. */
    when: GrantWhenSchema.optional()
  })
  .strict();

export const FeatureGrantsSchema = FeatureGrantsFieldsSchema.superRefine((grants, context) => {
  if (grants.when !== undefined && grants.spells.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["spells"],
      message: grantedSpellGateMessage(grants.spells.map((spell) => spell.id))
    });
  }
});

/**
 * The one typed rider vocabulary, shared by features, feats, options and magic items; a small union
 * grown additively (anything else stays prose, ADR-0008). Amounts are signed, and every variant takes
 * `...riderGate` (`when` + `scope`).
 */
export const FeatureModifierSchema = z.discriminatedUnion("type", [
  // ---- core riders ---------------------------------------------------------------------------
  z
    .object({
      type: z.literal("ability-score"),
      ability: AbilitySchema,
      amount: z.number().int().min(-5).max(5),
      maximum: z.number().int().min(1).max(30).optional(),
      ...riderGate
    })
    .strict(),
  z.object({ type: z.literal("hit-points-per-level"), amount: z.number().int().min(-5).max(5), ...riderGate }).strict(),
  z.object({ type: z.literal("speed"), amount: z.number().int().min(-30).max(60), ...riderGate }).strict(),
  /**
   * Flat AC. `whileArmored` (the Defense fighting style) predates `when: [{type: "while-armored"}]` and
   * stays because shipped bundles use it.
   */
  z
    .object({
      type: z.literal("armor-class"),
      amount: z.number().int().min(-5).max(5),
      whileArmored: z.boolean().default(false),
      ...riderGate
    })
    .strict(),
  z.object({ type: z.literal("initiative"), amount: z.number().int().min(-5).max(10), ...riderGate }).strict(),
  z.object({ type: z.literal("extra-attack"), count: z.number().int().min(1).max(3), ...riderGate }).strict(),
  /** AC = 10 + DEX + this ability while wearing no armor (Barbarian, Monk, and any homebrew that wants it). */
  z
    .object({
      type: z.literal("unarmored-defense"),
      ability: AbilitySchema,
      allowShield: z.boolean().default(false),
      ...riderGate
    })
    .strict(),
  z.object({ type: z.literal("darkvision"), feet: z.number().int().min(0).max(240), ...riderGate }).strict(),
  // ---- the three shared with EffectModifierSchema, declared once in @vtt/schemas --------------
  AttackBonusVariantSchema,
  ExtraDamageVariantSchema,
  RollModeVariantSchema,
  // ---- magic-item riders ---------------------------------------------------------------------
  /** A flat bonus to saving throws. Narrow it with `when: [{type: "ability-is", abilities: ["dex"]}]`. */
  z.object({ type: z.literal("save-bonus"), amount: z.number().int().min(-10).max(10), ...riderGate }).strict(),
  /** A flat bonus to ability and skill checks. Gloves of Thievery (+5 Sleight of Hand) is literally this. */
  z.object({ type: z.literal("check-bonus"), amount: z.number().int().min(-10).max(10), ...riderGate }).strict(),
  /**
   * Flat damage bonus, the other half of a "+1 weapon". Weapon-scoped by default on an item with a
   * weapon block, so two magic weapons never stack. Distinct from the effect-side `damage-bonus`, whose
   * reader ignores rider gates.
   */
  z.object({ type: z.literal("damage-bonus"), amount: z.number().int().min(-10).max(10), ...riderGate }).strict(),
  /** `classId` targets one caster on a multiclass sheet; absent = every caster the bearer has. */
  z
    .object({
      type: z.literal("spell-save-dc"),
      amount: z.number().int().min(-5).max(5),
      classId: ContentIdSchema.optional(),
      ...riderGate
    })
    .strict(),
  /** The sibling of the above. A Wand of the War Mage is exactly this and nothing else. */
  z
    .object({
      type: z.literal("spell-attack-bonus"),
      amount: z.number().int().min(-5).max(5),
      classId: ContentIdSchema.optional(),
      ...riderGate
    })
    .strict(),
  /** An extra spell slot of one level. Layered over the single-sourced slot maxima, so the seed, the long rest and the spend-clamp cannot disagree. */
  z
    .object({
      type: z.literal("spell-slot"),
      level: z.number().int().min(1).max(9),
      amount: z.number().int().min(-4).max(4),
      ...riderGate
    })
    .strict(),
  /** One more use of a limited resource. `poolId` is the live `actionUses` key, not a `classResources` column. */
  z
    .object({
      type: z.literal("resource-bonus"),
      poolId: ContentIdSchema,
      amount: z.number().int().min(-20).max(20),
      ...riderGate
    })
    .strict(),
  /** Score a critical hit on this natural roll or higher (19-20 keen weapons). */
  z.object({ type: z.literal("critical-range"), threshold: z.number().int().min(15).max(20), ...riderGate }).strict(),
  /** Extra untyped weapon dice on a crit (Savage Attacks). A typed crit-only 1d6 fire is `extra-damage` + `when: [{on-critical-hit}]` instead. */
  z.object({ type: z.literal("critical-bonus-dice"), count: z.number().int().min(1).max(4), ...riderGate }).strict(),
  /** Flat reduction of incoming damage. Resistance itself stays `grants.damageResistances`. */
  z.object({ type: z.literal("damage-reduction"), amount: z.number().int().min(1).max(30), ...riderGate }).strict(),
  /** The missing sibling of `darkvision`. Display-level, like `darkvision`, until a senses model exists. */
  z
    .object({ type: z.literal("sense"), sense: ContentIdSchema, feet: z.number().int().min(0).max(240), ...riderGate })
    .strict()
]);
export type FeatureModifier = z.infer<typeof FeatureModifierSchema>;

/**
 * Rider types an item may not carry: they are baked into the sheet and cannot be reversed on unequip
 * (`hp.maximum` with current HP tracked against it; ability scores feeding everything). Feats and
 * features may use them.
 */
export const ITEM_REFUSED_MODIFIER_TYPES: readonly FeatureModifier["type"][] = Object.freeze([
  "hit-points-per-level",
  "ability-score"
]);
export const ITEM_REFUSED_MODIFIER_MESSAGE =
  "An item cannot change hit points or an ability score yet - those are baked into the sheet and cannot be un-granted when the item comes off. Use a specific bonus instead: armor-class, save-bonus, check-bonus, or spell-save-dc. (Both stay available on a feat.)";

/** The rider fields shared by `FeatureRecord`, `FeatureOption` and magic items (spread into `EquipmentReferenceSchema`). */
export const featureRiders = {
  /** Open grouping slugs for the sheet ("spellcasting", "fighting-style", "channel-divinity"). */
  tags: z.array(ContentIdSchema).max(8).default([]),
  actions: z.array(FeatureActionSchema).max(8).default([]),
  /** Effects the feature can grant, in the actor-side EffectGrant vocabulary (Rage, Bardic Inspiration). */
  effects: z.array(EffectGrantSchema).max(4).default([]),
  uses: FeatureUsesSchema.optional(),
  grants: FeatureGrantsSchema.optional(),
  modifiers: z.array(FeatureModifierSchema).max(8).default([])
} as const;

/**
 * The pick budget an `extraPicks` grant raises: an offer key the wizard and server share
 * (`class-cantrips`, ... or `feature:<featureId>`). Unknown keys are rejected by `character-build.ts`.
 */
export const PickBudgetKeySchema = z
  .string()
  .regex(
    /^[a-z0-9-]+(:[a-z0-9-]+)?$/,
    'A pick budget names an offer key ("class-cantrips") or a feature\'s own pick ("feature:expertise").'
  )
  .max(80);

/** The eight fixed budget keys, shared by `character-build.ts` and the homebrew editor. */
export const NAMED_PICK_BUDGET_KEYS = [
  "class-skills",
  "class-tools",
  "background-skills",
  "background-tools",
  "background-languages",
  "species-languages",
  "class-cantrips",
  "class-spells"
] as const;

/** One extra pick a feature or chosen option adds to an existing budget. Amounts from all sources add up. */
export const ExtraPickSchema = z
  .object({
    offer: PickBudgetKeySchema,
    amount: z.number().int().min(1).max(5).optional(),
    /**
     * Scale by a printed class-table column's growth above its first value (Eldritch Invocations 1 -> 10),
     * added to the feature's own `choose`. A dice-string column gives 0.
     */
    scaling: z
      .object({
        type: z.literal("class-resource-growth"),
        /** The `classResources.id` of the printed column - `eldritch-invocations`, `weapon-mastery`. */
        id: ContentIdSchema
      })
      .strict()
      .optional()
  })
  .strict()
  .superRefine((grant, context) => {
    // Exactly one of `amount` and `scaling`; `amount` has no default so an authored 1 is never ambiguous.
    if ((grant.amount === undefined) === (grant.scaling === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An extra pick states either a flat `amount` or a `scaling` rule - exactly one."
      });
    }
  });
export type ExtraPick = z.infer<typeof ExtraPickSchema>;

/**
 * Raises a pick budget ("one extra cantrip from the Cleric spell list"). Not in `featureRiders`:
 * items must never carry it, since a budget that leaves with an item would strand a chosen pick.
 */
const extraPicksField = z.array(ExtraPickSchema).max(4).default([]);

/**
 * One "you can replace..." clause, editing a row of `character.choices[]`. `"level-up"` rewrites the
 * ledger at build time; `"short-rest"`/`"long-rest"` set `actor.choiceOverrides`, cleared by the
 * matching rest.
 */
export const ReplaceableChoiceSchema = z
  .object({
    offer: PickBudgetKeySchema,
    when: z.enum(["level-up", "short-rest", "long-rest"]),
    amount: z.number().int().min(1).max(5).default(1)
  })
  .strict();
export type ReplaceableChoice = z.infer<typeof ReplaceableChoiceSchema>;
const replacesField = z.array(ReplaceableChoiceSchema).max(4).default([]);

/** The fields that describe what is being picked, shared by a feature's choice and an option's own. */
const featureChoiceBase = {
  kind: ContentIdSchema,
  choose: z.number().int().min(1).max(10).default(1),
  /** Explicit option ids; at least one. Omit the field when `fromCatalog` or `options` supplies the list. */
  from: z
    .array(ContentIdSchema)
    .min(
      1,
      "An explicit `from` list must name at least one option (omit it entirely to use `fromCatalog` or `options`)."
    )
    .max(80)
    .optional(),
  /** An open catalog slug the wizard resolves at pick time ("skills", "feats", "wizard-spells"). */
  fromCatalog: ContentIdSchema.optional(),
  /** Options from the character's own earlier picks ("one of your known Warlock cantrips that deals damage"). */
  fromPicks: z
    .object({
      offer: PickBudgetKeySchema,
      where: z.enum(["deals-damage", "attack-roll", "ranged"]).optional()
    })
    .strict()
    .optional(),
  /** Only options at or below this level are legal (spell picks). */
  maxSpellLevel: z.number().int().min(0).max(9).optional(),
  /** Only options at or above this level; equal to `maxSpellLevel` for an exact level (Mystic Arcanum). */
  minSpellLevel: z.number().int().min(0).max(9).optional(),
  /** The ceiling an ability-score pick from this choice may reach; absent = 20 (epic boons use 30). */
  maximum: z.number().int().min(1).max(30).optional(),
  /** The same option may be picked more than once (Expertise across levels). */
  repeatable: z.boolean().default(false)
} as const;

/** A floor above its own ceiling offers nothing, so it is refused at author time. */
const spellLevelWindow = (choice: { minSpellLevel?: number; maxSpellLevel?: number }, context: z.RefinementCtx) => {
  if (
    choice.minSpellLevel !== undefined &&
    choice.maxSpellLevel !== undefined &&
    choice.minSpellLevel > choice.maxSpellLevel
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["minSpellLevel"],
      message: `minSpellLevel ${choice.minSpellLevel} is above maxSpellLevel ${choice.maxSpellLevel} - no spell can satisfy both.`
    });
  }
};

/** A pick offered by one option. It may not nest a further `options` list. */
export const FeatureOptionChoiceSchema = z
  .object(featureChoiceBase)
  .strict()
  .superRefine((choice, context) => {
    if (!choice.from && !choice.fromCatalog && !choice.fromPicks) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A choice needs an explicit `from` list, a `fromCatalog` slug, or a `fromPicks` source."
      });
    }
    spellLevelWindow(choice, context);
  });
export type FeatureOptionChoice = z.infer<typeof FeatureOptionChoiceSchema>;

/** `choice` and `choices` are mutually exclusive; read both through `featurePicks`. */
const oneChoiceForm = (record: { choice?: unknown; choices?: unknown }, context: z.RefinementCtx) => {
  if (record.choice !== undefined && record.choices !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["choices"],
      message: "Author `choice` (one pick) or `choices` (several) - never both."
    });
  }
};

/** Every pick a feature or option asks for, whichever form it was authored in. */
export function featurePicks<Choice>(record: { choice?: Choice; choices?: Choice[] }): readonly Choice[] {
  if (record.choices && record.choices.length > 0) return record.choices;
  return record.choice ? [record.choice] : [];
}

/** One pickable option with its own mechanics: a `FeatureRecord` minus `level`/`replacesFeatureId`. */
export const FeatureOptionSchema = z
  .object({
    id: ContentIdSchema,
    name: z.string().min(1).max(120),
    /** Printed text for this option. Always the display source of truth; riders only add mechanics. */
    description: z.string().min(1).max(20000),
    /**
     * Legal only if the earlier pick `offer` chose option `id`. When gating leaves exactly as many
     * options as the capacity, consumers adopt them without asking.
     */
    requires: z.object({ offer: PickBudgetKeySchema, id: ContentIdSchema }).strict().optional(),
    /** A pick this option asks for once chosen, from a list of its own. */
    choice: FeatureOptionChoiceSchema.optional(),
    /** Several picks this option asks for; see `FeatureRecordSchema.choices`. Author one or the other. */
    choices: z.array(FeatureOptionChoiceSchema).min(1).max(4).optional(),
    /** Budgets this option raises once chosen (Thaumaturge's extra Cleric cantrip). */
    extraPicks: extraPicksField,
    /** Picks this option lets the character re-make later (see `ReplaceableChoiceSchema`). */
    replaces: replacesField,
    ...featureRiders
  })
  .strict()
  .superRefine(oneChoiceForm);
export type FeatureOption = z.infer<typeof FeatureOptionSchema>;

/**
 * A pick the feature asks the player to make; writes a `choices[]` ledger row. Options come from
 * `fromCatalog`, `from` or inline `options`; after parsing, `from` always holds the id list.
 */
export const FeatureChoiceSchema = z
  .object({
    ...featureChoiceBase,
    /** Options carrying their own mechanics. Mutually exclusive with `from`, which is derived from these. */
    options: z.array(FeatureOptionSchema).min(1).max(40).optional()
  })
  .strict()
  .superRefine((choice, context) => {
    if (!choice.from && !choice.fromCatalog && !choice.options && !choice.fromPicks) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A choice needs an explicit `from` list, inline `options`, a `fromCatalog` slug, or a `fromPicks` source."
      });
    }
    if (choice.from && choice.options) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["from"],
        message: "Author `options` alone - `from` is derived from the option ids."
      });
    }
    if (choice.options) {
      const duplicate = choice.options.find(
        (option, index) => choice.options!.findIndex((other) => other.id === option.id) !== index
      );
      if (duplicate)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["options"],
          message: `Duplicate option id "${duplicate.id}".`
        });
    }
    spellLevelWindow(choice, context);
  })
  .transform((choice) => {
    // Return early so `from` stays optional on the output type; otherwise a `FeatureOptionChoice`
    // would stop being assignable to a `FeatureChoice`.
    if (!choice.options) return choice;
    return { ...choice, from: choice.options.map((option) => option.id) };
  });
export type FeatureChoice = z.infer<typeof FeatureChoiceSchema>;

/** The shared feature record. `description` is the display source of truth; riders are optional. */
export const FeatureRecordSchema = z
  .object({
    id: ContentIdSchema,
    name: z.string().min(1).max(120),
    /** Class/subclass level this feature is gained at. Absent for always-on records (species traits, feats). */
    level: ContentLevelSchema.optional(),
    description: z.string().min(1).max(20000),
    /** A pick this feature asks the player to make; writes a `choices[]` row. */
    choice: FeatureChoiceSchema.optional(),
    /** Several picks from one record (Magic Initiate). Mutually exclusive with `choice`; read through `featurePicks`. */
    choices: z.array(FeatureChoiceSchema).min(1).max(4).optional(),
    /** Budgets this feature raises - one extra cantrip, one extra skill, one more prepared spell. */
    extraPicks: extraPicksField,
    /** Picks this feature lets the character re-make later - on a level-up, or on a rest (see `ReplaceableChoiceSchema`). */
    replaces: replacesField,
    ...featureRiders,
    /** This feature replaces an earlier one of the same id lineage (Indomitable at 9/13/17). */
    replacesFeatureId: ContentIdSchema.optional()
  })
  .strict()
  .superRefine(oneChoiceForm);
export type FeatureRecord = z.infer<typeof FeatureRecordSchema>;

// ---- Class -----------------------------------------------------------------------------------

/** A "choose N from this list" proficiency grant; `from` and `fromCatalog` combine as a union. */
export const ChoiceListSchema = z
  .object({
    choose: z.number().int().min(0).max(10),
    from: z.array(ContentIdSchema).max(60).default([]),
    fromCatalog: ContentIdSchema.optional()
  })
  .strict()
  .superRefine((list, context) => {
    // A budget with no source can never be satisfied.
    if (list.choose > 0 && list.from.length === 0 && !list.fromCatalog) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'A "choose N" list needs a non-empty `from` list or a `fromCatalog` slug - otherwise the pick has no options and the build can never be completed.'
      });
    }
  });

/** A named starting-equipment bundle ("A: chain mail and a martial weapon", "C: 155 gp"). */
export const StartingEquipmentOptionSchema = z
  .object({
    id: ContentIdSchema,
    label: z.string().min(1).max(200),
    items: z
      .array(
        z
          .object({
            id: ContentIdSchema,
            name: z.string().min(1).max(120),
            quantity: z.number().int().min(1).max(99).default(1)
          })
          .strict()
      )
      .max(20)
      .default([]),
    goldPieces: z.number().int().min(0).max(1000).default(0)
  })
  .strict();

/** One row of a class's 20-level table: the feature ids granted, plus the printed columns. */
export const ClassLevelRowSchema = z
  .object({
    level: ContentLevelSchema,
    proficiencyBonus: z.number().int().min(2).max(6),
    features: z.array(ContentIdSchema).max(12).default([]),
    /** Nine counts, index 0 = 1st-level slots. Absent for a non-caster row. */
    spellSlots: z.array(z.number().int().min(0).max(4)).length(9).optional(),
    /** Warlock Pact Magic: one uniform slot level with its own count. */
    pactSlots: z
      .object({ level: z.number().int().min(1).max(9), slots: z.number().int().min(0).max(4) })
      .strict()
      .optional(),
    cantripsKnown: z.number().int().min(0).max(10).optional(),
    spellsKnown: z.number().int().min(0).max(40).optional(),
    /** A flat number or the SRD formula ("<ability> modifier + <class> level"); falls back to `preparedCount`. */
    preparedFormula: z.string().max(60).optional(),
    preparedCount: z.number().int().min(0).max(60).optional(),
    /**
     * Named per-level resources (a count or a dice string). Bound to a live `actionUses` pool only by
     * matching id; `display: true` marks a column with no pool (checked by `class-resource-pools.test.ts`).
     */
    classResources: z
      .array(
        z
          .object({
            id: ContentIdSchema,
            name: z.string().min(1).max(60),
            amount: z.union([z.number().int().min(0).max(999), z.string().min(1).max(20)]),
            /** This column is ink only - no live pool answers to this id, and none is expected to. */
            display: z.boolean().optional()
          })
          .strict()
      )
      .max(8)
      .default([])
  })
  .strict();
export type ClassLevelRow = z.infer<typeof ClassLevelRowSchema>;

/** Spellcasting a class (or a third-caster subclass) grants. */
export const ContentSpellcastingSchema = z
  .object({
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
  })
  .strict();
export type ContentSpellcasting = z.infer<typeof ContentSpellcastingSchema>;

/** Ability minimums for taking this class as a multiclass; `mode: "any"` covers "STR 13 or DEX 13". */
export const MulticlassPrerequisiteSchema = z
  .object({
    mode: z.enum(["all", "any"]).default("all"),
    minimums: z
      .array(z.object({ ability: AbilitySchema, minimum: z.number().int().min(1).max(20) }).strict())
      .min(1)
      .max(6)
  })
  .strict();

export const ClassReferenceSchema = z
  .object({
    ...contentRecordBase,
    hitDie: HitDieSchema,
    /** Ordered ability priority, best first, for the random generator. */
    statPriority: z.array(AbilitySchema).length(6),
    /** The class's headline ability (one, or two for Fighter/Monk/Paladin/Ranger). */
    primaryAbilities: z.array(AbilitySchema).min(1).max(2),
    savingThrows: z.array(AbilitySchema).min(1).max(6),
    skillChoices: ChoiceListSchema,
    armorProficiencies: z.array(ContentIdSchema).max(10).default([]),
    weaponProficiencies: z.array(ContentIdSchema).max(40).default([]),
    toolProficiencies: z.array(ContentIdSchema).max(20).default([]),
    toolChoices: ChoiceListSchema.optional(),
    startingEquipment: z.array(StartingEquipmentOptionSchema).max(6).default([]),
    /** Proficiencies gained when the class is taken as a multiclass (narrower than the level-1 set). */
    multiclassProficiencies: z
      .object({
        armor: z.array(ContentIdSchema).max(10).default([]),
        weapons: z.array(ContentIdSchema).max(40).default([]),
        tools: z.array(ContentIdSchema).max(20).default([]),
        skills: ChoiceListSchema.optional()
      })
      .strict()
      .optional(),
    multiclassPrerequisites: MulticlassPrerequisiteSchema.optional(),
    /** The level the subclass is chosen at, and what the class calls it ("Martial Archetype"). */
    subclassLevel: ContentLevelSchema,
    subclassLabel: z.string().max(60).optional(),
    /** Levels granting an Ability Score Improvement (or a feat instead). */
    asiLevels: z.array(ContentLevelSchema).max(10).default([]),
    spellcasting: ContentSpellcastingSchema.optional(),
    levelTable: z.array(ClassLevelRowSchema).length(20),
    features: z.array(FeatureRecordSchema).max(160).default([])
  })
  .strict()
  .superRefine((entry, context) => {
    entry.levelTable.forEach((row, index) => {
      if (row.level !== index + 1)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["levelTable", index, "level"],
          message: `Level table row ${index} must be level ${index + 1}.`
        });
    });
    const featureIds = new Set(entry.features.map((feature) => feature.id));
    entry.levelTable.forEach((row, rowIndex) =>
      row.features.forEach((featureId, featureIndex) => {
        if (!featureIds.has(featureId))
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["levelTable", rowIndex, "features", featureIndex],
            message: `Level ${row.level} grants unknown feature "${featureId}".`
          });
      })
    );
    const duplicate = entry.features.find(
      (feature, index) => entry.features.findIndex((other) => other.id === feature.id) !== index
    );
    if (duplicate)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["features"],
        message: `Duplicate feature id "${duplicate.id}".`
      });
  });
export type ClassReference = z.infer<typeof ClassReferenceSchema>;

// ---- Subclass --------------------------------------------------------------------------------

export const SubclassReferenceSchema = z
  .object({
    ...contentRecordBase,
    classId: ContentIdSchema,
    /** Level the subclass is taken at; absent = inherit the class's `subclassLevel`. */
    subclassLevel: ContentLevelSchema.optional(),
    /** Third-caster subclasses (Eldritch Knight, Arcane Trickster) declare their own spellcasting. */
    spellcasting: ContentSpellcastingSchema.optional(),
    /** Extra table rows a caster subclass overlays on the class table (its own slot columns). */
    levelTable: z.array(ClassLevelRowSchema).max(20).optional(),
    features: z.array(FeatureRecordSchema).max(40).default([])
  })
  .strict()
  .superRefine((entry, context) => {
    const featureIds = new Set(entry.features.map((feature) => feature.id));
    (entry.levelTable ?? []).forEach((row, rowIndex) =>
      row.features.forEach((featureId, featureIndex) => {
        if (!featureIds.has(featureId))
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["levelTable", rowIndex, "features", featureIndex],
            message: `Level ${row.level} grants unknown feature "${featureId}".`
          });
      })
    );
  });
export type SubclassReference = z.infer<typeof SubclassReferenceSchema>;

// ---- Species ---------------------------------------------------------------------------------

export const CreatureSizeSchema = z.enum(["tiny", "small", "medium", "large", "huge", "gargantuan"]);

/** A playable species. SRD 5.2.1 puts ability increases on backgrounds; `abilityBonuses` is for 2014-style and homebrew. */
export const SpeciesReferenceSchema = z
  .object({
    ...contentRecordBase,
    /** Sizes a member of this species may be; several 2024 species let the player pick Small or Medium. */
    sizes: z.array(CreatureSizeSchema).min(1).max(6).default(["medium"]),
    speedFeet: z.number().int().min(0).max(120),
    /** Darkvision range in feet; null = none. */
    darkvisionFeet: z.number().int().min(0).max(240).nullable().default(null),
    /** Creature type slug ("humanoid", "fey", "construct"). */
    creatureType: ContentIdSchema.default("humanoid"),
    /** Fixed ability increases. Empty for every SRD 5.2.1 species (see the note above). Additive data. */
    abilityBonuses: z
      .array(z.object({ ability: AbilitySchema, amount: z.number().int().min(-2).max(3) }).strict())
      .max(6)
      .default([]),
    /** "Choose N abilities to raise by M" (the 2014 variant-human / half-elf pattern). */
    abilityBonusChoice: z
      .object({
        choose: z.number().int().min(1).max(6),
        amount: z.number().int().min(1).max(3),
        from: z.array(AbilitySchema).min(1).max(6).default(["str", "dex", "con", "int", "wis", "cha"])
      })
      .strict()
      .optional(),
    languages: z.array(ContentIdSchema).max(10).default([]),
    languageChoices: ChoiceListSchema.optional(),
    traits: z.array(FeatureRecordSchema).max(30).default([]),
    /** Lineages / subraces, each adding its own traits on top. */
    lineages: z
      .array(
        z
          .object({
            id: ContentIdSchema,
            name: z.string().min(1).max(120),
            description: z.string().max(8000).optional(),
            traits: z.array(FeatureRecordSchema).max(20).default([])
          })
          .strict()
      )
      .max(12)
      .default([])
  })
  .strict();
export type SpeciesReference = z.infer<typeof SpeciesReferenceSchema>;

// ---- Background ------------------------------------------------------------------------------

export const BackgroundReferenceSchema = z
  .object({
    ...contentRecordBase,
    /** Three listed abilities, distributed by one of `spreads` (+2/+1 or +1/+1/+1 by default). */
    abilityOptions: z
      .object({
        from: z.array(AbilitySchema).min(1).max(6),
        spreads: z
          .array(z.array(z.number().int().min(1).max(3)).min(1).max(3))
          .min(1)
          .max(4)
          .default([
            [2, 1],
            [1, 1, 1]
          ])
      })
      .strict()
      .optional(),
    originFeatId: ContentIdSchema.optional(),
    skillProficiencies: z.array(ContentIdSchema).max(10).default([]),
    skillChoices: ChoiceListSchema.optional(),
    toolProficiencies: z.array(ContentIdSchema).max(10).default([]),
    toolChoices: ChoiceListSchema.optional(),
    languages: z.array(ContentIdSchema).max(10).default([]),
    languageChoices: ChoiceListSchema.optional(),
    startingEquipment: z.array(StartingEquipmentOptionSchema).max(6).default([]),
    features: z.array(FeatureRecordSchema).max(10).default([])
  })
  .strict();
export type BackgroundReference = z.infer<typeof BackgroundReferenceSchema>;

// ---- Feat ------------------------------------------------------------------------------------

export const FeatReferenceSchema = z
  .object({
    ...contentRecordBase,
    /** Open slug: "origin", "general", "fighting-style", "epic-boon", or anything homebrew adds. */
    category: ContentIdSchema.default("general"),
    prerequisite: z
      .object({
        level: ContentLevelSchema.optional(),
        abilityScores: z
          .array(z.object({ ability: AbilitySchema, minimum: z.number().int().min(1).max(20) }).strict())
          .max(6)
          .default([]),
        /** Proficiency or feature slugs the character must already have ("martial", "spellcasting"). */
        requires: z.array(ContentIdSchema).max(10).default([]),
        /** Anything not modeled above, printed for the player to judge (ADR-0008 prose fallback). */
        text: z.string().max(400).optional()
      })
      .strict()
      .optional(),
    repeatable: z.boolean().default(false),
    /** The feat's mechanics: a feat is a feature plus catalog metadata. */
    feature: FeatureRecordSchema
  })
  .strict();
export type FeatReference = z.infer<typeof FeatReferenceSchema>;

// ---- Name pools ------------------------------------------------------------------------------

/** Hand-authored per-species name pools feeding the random generator. */
export const NamePoolReferenceSchema = z
  .object({
    speciesId: ContentIdSchema,
    source: ContentSourceSchema,
    pools: z
      .array(
        z
          .object({
            id: ContentIdSchema,
            /** What this pool is ("Masculine", "Feminine", "Family", "Clan", "Nickname"). */
            label: z.string().min(1).max(60),
            names: z.array(z.string().min(1).max(60)).min(1).max(400)
          })
          .strict()
      )
      .min(1)
      .max(10)
  })
  .strict();
export type NamePoolReference = z.infer<typeof NamePoolReferenceSchema>;

// ---- Spell lists -----------------------------------------------------------------------------

/**
 * A spell list as a membership overlay folded into spells' `classes` (`applySpellListOverlay`); the
 * generated `spells.v1.json` is never edited. An empty list makes casters uncreatable.
 */
export const SpellListReferenceSchema = z
  .object({
    ...contentRecordBase,
    /** Start from these existing list ids - SRD (`wizard`) or another overlay. Empty = start blank. */
    basedOn: z.array(ContentIdSchema).max(8).default([]),
    /** Spell ids added on top of the `basedOn` expansion. SRD spell ids are perfectly legal here. */
    add: z.array(ContentIdSchema).max(500).default([]),
    /** Spell ids removed last, after everything else - a `remove` always wins. */
    remove: z.array(ContentIdSchema).max(500).default([])
  })
  .strict();
export type SpellListReference = z.infer<typeof SpellListReferenceSchema>;
