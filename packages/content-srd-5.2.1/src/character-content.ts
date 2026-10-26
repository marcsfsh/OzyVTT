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
  DamageFormulaSchema,
  DamageTypeSchema,
  DiceFormulaSchema,
  HealingFormulaSchema,
  EffectGrantSchema,
  GrantWhenSchema,
  HitDieSchema,
  HoursSchema,
  HitRiderSchema,
  ModifierSchema,
  PickBudgetScalingSchema,
  SaveFailureEffectSchema,
  SaveOutcomeFields,
  SummonCreatureSchema,
  type Modifier
} from "@vtt/schemas";

export {
  GrantWhenSchema,
  ItemSlotSchema,
  ModifierSchema,
  RIDER_TRIGGER_KINDS,
  RiderTriggerSchema,
  RiderWhenSchema,
  riderLayer,
  type ItemSlot,
  type Modifier,
  type RiderTrigger,
  type RiderTriggerKind
} from "@vtt/schemas";

/** Every identity in the content catalog is an open slug, never a closed enum (principle 3). */
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
  id: ContentIdSchema.describe(
    "The record's own id. The server forces it to the row's minted id (`hb-<slug>-<6 hex>`) on every write, because a body whose id drifted from the row would resolve to nothing once the merge reads it back through the bundle schemas"
  ),
  name: z.string().min(1).max(120),
  source: ContentSourceSchema.describe(
    'Always "homebrew" once stored; the field exists so an authored record and a merged-catalog row read the same'
  ),
  /** Short blurb for the wizard's pick card. */
  summary: z.string().max(400).optional().describe("Short blurb for the wizard's pick card"),
  /** Long prose. Always the display source of truth; structured riders only add mechanics on top. */
  description: z
    .string()
    .max(20000)
    .optional()
    .describe("Long prose. Always the display source of truth; the structured riders only add mechanics on top"),
  /** Credit line for a homebrew record whose text came from somewhere else (SRD records use the bundle-wide CC BY notice). */
  attribution: z
    .string()
    .max(400)
    .optional()
    .describe(
      "Credit line when the text came from somewhere else; SRD records inherit the bundle-wide CC BY notice instead"
    )
};

// ---- FeatureRecord: the one shape every class/subclass/species/background/feat feature uses ----

/** Uses regained on a rest: a flat `limit` or a `scaling` rule. `pool` shares one counter across features. */
export const FeatureUsesSchema = z
  .object({
    limit: z.number().int().min(1).max(100).optional().describe("A flat count (a Staff of the Magi's 50 charges)"),
    scaling: z
      .discriminatedUnion("type", [
        z
          .object({ type: z.literal("proficiency-bonus") })
          .strict()
          .describe("Uses equal to the character's proficiency bonus."),
        z
          .object({
            type: z.literal("ability-modifier"),
            ability: AbilitySchema,
            minimum: z.number().int().min(0).max(5).default(1)
          })
          .strict()
          .describe("Uses equal to an ability modifier, floored at `minimum`."),
        z
          .object({
            type: z.literal("by-level"),
            table: z
              .array(z.object({ level: ContentLevelSchema, limit: z.number().int().min(0).max(100) }).strict())
              .min(1)
              .max(20)
          })
          .strict()
          .describe("A printed per-level column."),
        /** The class table's printed column for this level (Rage, Channel Divinity); a dice-string column gives 0. */
        z
          .object({ type: z.literal("class-resource"), id: ContentIdSchema })
          .strict()
          .describe(
            'Read the count straight off this class table\'s printed column, by `classResources.id`. The one the other three cannot say: Rage, Bardic Inspiration and Channel Divinity step on a schedule that is neither the proficiency bonus nor an ability modifier, and re-typing the printed column into a `by-level` table beside the column it duplicates is the second copy that drifts. A resource whose printed amount is a dice string (Sneak Attack "3d6") is damage and resolves to no uses at all.'
          )
      ])
      .optional()
      .describe("The four ways 5e actually scales a feature's uses."),
    /** "own-turn": back at the start of the bearer's next turn ("until the start of your next turn"); "never": spent
     *  for good (a Necklace of Fireballs' beads, a Ring of Three Wishes); "time": back once `afterHours` of game time
     *  pass from its first use (Wings of Flying's 1d12 hours). */
    per: z.enum(["turn", "own-turn", "encounter", "short-rest", "long-rest", "never", "time"]),
    pool: ContentIdSchema.optional().describe("Shares one counter across every feature carrying the same pool id"),
    afterHours: HoursSchema.optional().describe(
      'With per "time": the hours of game time after its first use that it comes back, rolled then (Wings of Flying: 1d12; Horn of Valhalla: 168)'
    )
  })
  .strict()
  .superRefine((uses, context) => {
    if (uses.limit === undefined && uses.scaling === undefined)
      context.addIssue({
        code: "custom",
        message: "Limited uses need either a flat `limit` or a `scaling` rule."
      });
    if ((uses.per === "time") !== (uses.afterHours !== undefined))
      context.addIssue({
        code: "custom",
        path: ["afterHours"],
        message: "Uses that come back after a time need the hours (afterHours), and only they take them."
      });
  })
  .describe(
    'Uses a feature gets back on a rest, as data with no formula language. Either `limit` or `scaling` must be present. The `per` vocabulary is deliberately narrower than an action\'s: there is no "recharge", because a recharge roll belongs to a stat block.'
  );
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
    criticalBonusDice: z.number().int().min(1).max(4).optional(),
    /** A printed to-hit that stands in for the derived one (a Ring of the Ram's "+7 bonus"). */
    bonus: z
      .number()
      .int()
      .min(-5)
      .max(20)
      .optional()
      .describe('A printed to-hit that stands in for the derived one (a Ring of the Ram\'s "+7 bonus")')
  })
  .strict()
  .describe(
    'An attack a feature grants. Same vocabulary as a stat block\'s attack except the to-hit bonus is derived: the feature names the ability (or "spellcasting") and the builder resolves the number, unless a printed `bonus` stands in.'
  );

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
      base: z.number().int().min(1).max(30).default(8).describe("The printed constant the modifiers are added to"),
      /** Whose modifier is added: the caster's ability, whatever the target rolls. */
      ability: AbilitySchema.describe(
        "Whose modifier is added: the caster's ability. The target's roll does not change it"
      ),
      /** Whether the character's proficiency bonus is added too (every SRD printing: yes). */
      proficiencyBonus: z.boolean().default(true)
    })
    .strict()
    .describe(
      "A derived save DC: `base` plus the caster's ability modifier, plus proficiency bonus. Every SRD 5.2.1 printing uses base 8 with proficiency, which is why both default."
    )
]);
export type FeatureSaveDc = z.infer<typeof FeatureSaveDcSchema>;

/** A save a feature forces. `ability` is what the target rolls; `dc` is how the number is derived; what the save
 * does is `SaveOutcomeFields`, as on a stat block. */
export const FeatureSaveSchema = z
  .object({
    ability: AbilitySchema,
    dc: FeatureSaveDcSchema.describe(
      "Three forms, all of them plain data with no formula language (ADR-0008): the character's own spell save DC, a printed constant, or the SRD's \"DC 8 plus your <ability> modifier and Proficiency Bonus\" wording as three bounded fields."
    ),
    ...SaveOutcomeFields,
    /** What a failed save leaves besides its conditions, as on a stat block's save. */
    failureEffect: SaveFailureEffectSchema.optional(),
    /** What a successful save leaves instead (Stunning Strike's halved Speed). */
    successEffect: SaveFailureEffectSchema.optional()
  })
  .strict()
  .describe(
    "A save a feature forces. `ability` is what the target rolls; `dc` is how the number is derived; the outcome fields are a stat block's."
  );

/** A hit rider on a feature: the DC of its saves is derived like a feature save's ("8 plus your Dexterity modifier and
 *  Proficiency Bonus"), and how many effects one hit carries may grow with level (Improved Cunning Strike's two). */
export const FeatureHitRiderSchema = HitRiderSchema.omit({ saveDc: true })
  .extend({
    saveDc: FeatureSaveDcSchema.optional(),
    effectsChooseByLevel: z
      .array(z.object({ level: ContentLevelSchema, choose: z.number().int().min(1).max(3) }).strict())
      .max(4)
      .optional()
      .describe("How many effects one hit may carry from a class level on; the highest matching level wins"),
    appliesDaysPerLevel: z
      .literal(true)
      .optional()
      .describe(
        "What the hit applies lasts a number of days equal to the class level, in game minutes (Quivering Palm's vibrations)"
      )
  })
  .strict();

/** A rollable action a feature adds (Second Wind, Breath Weapon): `ActionSchema` with derived attack/save. */
export const FeatureActionSchema = ActionSchema.omit({ attack: true, save: true, ridesHit: true })
  .extend({
    attack: FeatureAttackSchema.optional(),
    save: FeatureSaveSchema.optional(),
    ridesHit: FeatureHitRiderSchema.optional(),
    /** An attack with the item's own weapon, hurled as if it had the Thrown property at these ranges (Hammer of
     *  Thunderbolts: 20/60): the weapon's attack and damage, from range. */
    hurlsWeapon: z
      .object({
        normalFeet: z.number().int().min(5).max(600),
        longFeet: z.number().int().min(5).max(1200)
      })
      .strict()
      .optional()
      .describe(
        "An attack with the item's own weapon hurled as if it had the Thrown property at these ranges (Hammer of Thunderbolts: 20/60), with the weapon's attack and damage"
      ),
    /** It spends none of its feature's uses, where another of the feature's actions does (ending Quivering Palm's
     *  vibrations, which the 4 Focus Points paid for when they started). */
    spendsNoUses: z
      .literal(true)
      .optional()
      .describe("It spends none of its feature's uses, where another of the feature's actions does"),
    /** Damage that grows with level. It replaces `damage` at the highest matching level (Sneak Attack, Divine Smite). */
    damageByLevel: z
      .array(
        z
          .object({
            level: ContentLevelSchema,
            formula: DiceFormulaSchema.describe(
              'One die term plus at most one flat modifier ("1d8 + 3"). Anything richer stays prose (ADR-0008)'
            ),
            type: z.string().min(1).max(40)
          })
          .strict()
      )
      .max(20)
      .optional()
      .describe(
        "Damage that grows with level (Sneak Attack, Divine Smite). The highest matching level replaces `damage`"
      ),
    /** Damage dice counted by an ability modifier, from a class level on ("a number of d8s equal to your Wisdom modifier
     *  (minimum of 1d8)", Sear Undead on Turn Undead). It replaces `damage` from that level. */
    damageDiceByAbility: z
      .object({
        level: ContentLevelSchema,
        ability: AbilitySchema,
        die: z.enum(["d4", "d6", "d8", "d10", "d12"]),
        type: DamageTypeSchema,
        minimum: z.number().int().min(1).max(5).default(1)
      })
      .strict()
      .optional()
      .describe(
        'Damage dice counted by an ability modifier from a class level on ("a number of d8s equal to your Wisdom modifier (minimum of 1d8)"), replacing `damage` from that level'
      ),
    /** Healing that grows with level. It replaces `healing.formula` at the highest matching level (Divine Spark's heal,
     *  Wholeness of Body's Martial Arts die). */
    healingByLevel: z
      .array(
        z
          .object({
            level: ContentLevelSchema,
            formula: HealingFormulaSchema,
            self: z.literal(true).optional(),
            temporary: z.literal(true).optional()
          })
          .strict()
      )
      .max(20)
      .optional()
      .describe(
        "Healing that grows with level (Divine Spark's heal, Wholeness of Body's Martial Arts die). The highest matching level replaces `healing.formula`; a row with `self` or `temporary` gives an action with no healing below that level its own (Heightened Focus's Temporary Hit Points)"
      ),
    /** The area's healing that grows with level (Land's Aid: 2d6, 3d6 at 10, 4d6 at 14). The highest matching level
     *  replaces `areaHeal.formula`. */
    areaHealByLevel: z
      .array(z.object({ level: ContentLevelSchema, formula: HealingFormulaSchema }).strict())
      .max(20)
      .optional()
      .describe(
        "The area's healing that grows with level (Land's Aid). The highest matching level replaces `areaHeal`"
      ),
    /** What the built action adds to its first damage part and its healing, read off the character when it is built:
     *  a multiple of its level ("1d10 plus your Fighter level", "five times your Cleric level") and an ability
     *  modifier ("add your Wisdom modifier"). A reroll answer takes the level multiple as its bonus (Indomitable), and
     *  a reaction that reduces damage adds all of it to its roll (Deflect Attacks). */
    adds: z
      .object({
        classLevel: z.number().int().min(1).max(10).optional(),
        abilityModifier: AbilitySchema.optional(),
        /** The Proficiency Bonus ("Temporary Hit Points equal to your Proficiency Bonus", Adrenaline Rush). */
        proficiencyBonus: z.literal(true).optional()
      })
      .strict()
      .optional()
      .describe(
        'Read off the character when it is built and added to the first damage part and to the healing: `classLevel` times its level ("1d10 plus your Fighter level", "five times your Cleric level") and `abilityModifier` ("add your Wisdom modifier")'
      ),
    /** The `amount` of the granted effect's `damage-bonus` riders is the printed class column at the character's
     *  level (Rage Damage), so the bonus grows as the table does. */
    grantScaling: z
      .object({
        resource: z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .max(60)
      })
      .strict()
      .optional()
      .describe(
        "The granted effect's `damage-bonus` amounts become the named printed class column at the character's level (Rage Damage), and the action's text says the number"
      ),
    /** The die an answer to a roll rolls, growing with level (the Bardic Inspiration die: d6, a d8 at level 5, a d10 at
     *  10, a d12 at 15). It replaces the amount of the action's `answer`, and of the answer its grant carries, at the
     *  highest matching level. */
    answerAmountByLevel: z
      .array(z.object({ level: ContentLevelSchema, amount: DamageFormulaSchema }).strict())
      .max(20)
      .optional()
      .describe(
        "The die an answer to a roll rolls, growing with level (the Bardic Inspiration die). The highest matching level replaces the amount of the action's answer and of its grant's answer"
      ),
    /** A reaction that changes with level. It replaces `reaction` at the highest matching level (Deflect Energy lets
     *  Deflect Attacks meet every damage type at Monk 13). */
    reactionByLevel: z
      .array(z.object({ level: ContentLevelSchema, reaction: ActionSchema.shape.reaction.unwrap() }).strict())
      .max(20)
      .optional()
      .describe("A reaction that changes with level. The highest matching level replaces `reaction`"),
    /** A compound plan that grows with level. It replaces `multiattack` at the highest matching level (Flurry of
     *  Blows' third strike at Monk 10). */
    multiattackByLevel: z
      .array(z.object({ level: ContentLevelSchema, multiattack: ActionSchema.shape.multiattack.unwrap() }).strict())
      .max(20)
      .optional()
  })
  .describe(
    "A rollable action a feature adds to the sheet (Second Wind, Channel Divinity, Breath Weapon). Identical to HomebrewStatblockAction except for `attack`/`save`: a class feature cannot know the character's ability scores, so it names the ability and the builder derives the number, where a stat block prints it."
  );
export type FeatureAction = z.infer<typeof FeatureActionSchema>;

/**
 * Gated grants are re-evaluated on every read, but granted spells are baked into
 * `definition.spellcasting` at build time, so a gated spell would reach nothing. The combination is
 * refused at authoring.
 */
export function grantedSpellGateMessage(spellIds: readonly string[]): string {
  const named = spellIds.map((id) => `"${id}"`).join(", ");
  return `A gated grant cannot hand over a spell, so a grants block cannot carry "when" and "spells" together: ${named} would reach nothing at all. The other ten lists are recomputed from the sheet on every read, so their gate is answered on every read. A granted spell is baked into the character's spell list, its prepared count and its cantrip's action when the character is BUILT, and nothing reads the gate again afterwards. Put the spells in a second grants block with no "when" (this record without one, or a second feature), and keep the gate on the ten lists that can carry it.`;
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
            ability: AbilitySchema.optional(),
            /** How it is cast besides with a spell slot: "free" spends this feature's own `uses` (Divine Smite, once
             *  per Long Rest), "at-will" costs nothing (Armor of Shadows). Absent: only with a slot. */
            withoutSlot: z.enum(["free", "at-will"]).optional(),
            /** False when it can be cast only without a slot (an invocation's spell the Warlock does not know). */
            withSlot: z.boolean().default(true),
            /** Which of its castings are a Magic action, whatever the spell's casting time: the one without a slot
             *  (Pact of the Chain's Find Familiar) or every one the feature gives (Wild Companion's). */
            asMagicAction: z.enum(["without-slot", "every-casting"]).optional(),
            /** The components every casting the feature gives goes without (Wild Companion's and Dragon Companion's
             *  "without Material components"). */
            waives: z
              .array(z.enum(["verbal", "somatic", "material"]))
              .min(1)
              .max(3)
              .optional(),
            /** Its casting without a slot targets only its caster ("cast Mage Armor on yourself"). */
            self: z.literal(true).optional(),
            /** Its casting without a slot gives its healing dice their highest faces (Fiendish Vigor). */
            maximized: z.literal(true).optional(),
            /** How the feature changes the creatures the spell brings when cast this way: the creature type it takes
             *  (Wild Companion's Fey familiar), that it leaves when its caster finishes a Long Rest, more forms to pick
             *  (Pact of the Chain), and casting it without Concentration for a minute (Dragon Companion). */
            summon: z
              .object({
                creatureTypes: z.array(ContentIdSchema).min(1).max(6).optional(),
                untilLongRest: z.literal(true).optional(),
                moreCreatures: z.array(SummonCreatureSchema).min(1).max(12).optional(),
                concentrationOptional: z.literal(true).optional()
              })
              .strict()
              .optional()
          })
          .strict()
      )
      .max(30)
      .default([])
      .describe(
        "Spells the feature always has ready (domain spells, racial spells). `alwaysPrepared` spells do not count against a prepared list. `id` is one of the seven derived-id fields a pack import rewrites. This is the one list `when` cannot gate. See `when` below"
      ),
    /** The condition the ten list fields apply under (not `spells`). Absent = unconditional. */
    when: GrantWhenSchema.optional().describe(
      'The condition the ten list fields above apply under: every one except `spells`, which cannot be gated: a granted spell is baked into the sheet\'s spell list, its prepared count and its cantrip action when the character is built, so nothing would re-read the gate. A block carrying both `when` and `spells` is refused, and the refusal names the spells that would have been lost. Omitted = unconditional, which is what every record written before this field meant. Only the two trigger kinds a derivation can answer are allowed: static gates (attuned, while-armored, while-unarmored, while-shield, while-character-is, while-proficient-with) and dynamic gates (while-effect-tag, while-hp-at-or-below, while-condition). A moment or a filter is refused: a grant is collected before any roll starts, so a gate it cannot evaluate would silently mean "always"'
    )
  })
  .strict();

export const FeatureGrantsSchema = FeatureGrantsFieldsSchema.superRefine((grants, context) => {
  if (grants.when !== undefined && grants.spells.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["spells"],
      message: grantedSpellGateMessage(grants.spells.map((spell) => spell.id))
    });
  }
}).describe(
  "Flat things a feature hands the character. All open slugs, so a homebrew language, tool, or armor group needs no schema change."
);

/**
 * Rider types an item may not carry: the attunement limit would decide the item's own attunement. Feats and features may
 * use it. An item's ability score and its Hit Points per level are read live while it is worn, so taking it off gives
 * them back.
 */
export const ITEM_REFUSED_MODIFIER_TYPES: readonly Modifier["type"][] = Object.freeze(["attunement-slots"]);
export const ITEM_REFUSED_MODIFIER_MESSAGE =
  "An item can't change the attunement limit, which would decide the item's own attunement. A feat can.";

/** The rider fields shared by `FeatureRecord`, `FeatureOption` and magic items (spread into `EquipmentReferenceSchema`). */
export const featureRiders = {
  /** Open grouping slugs for the sheet ("spellcasting", "fighting-style", "channel-divinity"). */
  tags: z
    .array(ContentIdSchema)
    .max(8)
    .default([])
    .describe("Open grouping slugs for the sheet (spellcasting, fighting-style, channel-divinity)"),
  actions: z
    .array(FeatureActionSchema)
    .max(8)
    .default([])
    .describe("Rollable actions this adds to the sheet (Second Wind, Channel Divinity, Breath Weapon)"),
  /** Effects the feature can grant, in the actor-side EffectGrant vocabulary (Rage, Bardic Inspiration). */
  effects: z
    .array(EffectGrantSchema)
    .max(4)
    .default([])
    .describe(
      "Effects it can grant, in the same vocabulary the live rules engine already resolves (Rage, Bardic Inspiration)"
    ),
  uses: FeatureUsesSchema.optional().describe("Limited uses recovered on a rest"),
  grants: FeatureGrantsSchema.optional().describe("Flat proficiency/language/spell grants"),
  modifiers: z.array(ModifierSchema).max(8).default([]).describe("Typed numeric riders")
} as const;

/**
 * The pick budget an `extraPicks` grant raises: an offer key the wizard and server share
 * (`class-cantrips`, ... or `feature:<featureId>`). Unknown keys are rejected by `character-build.ts`.
 */
export const PickBudgetKeySchema = z
  .string()
  .regex(
    /^[a-z0-9-]+(:[a-z0-9-]+(\/[2-9])?)?$/,
    'A pick budget names an offer key ("class-cantrips") or a feature\'s own pick ("feature:expertise", and "feature:magic-initiate-cleric/2" for its second).'
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
    offer: PickBudgetKeySchema.describe("The offer key whose capacity this raises"),
    amount: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe(
        'How many extra picks, as a flat number. Additive across every source that names the same budget. Exactly one of `amount` and `scaling` is authored, because a defaulted amount beside a scaling rule would be indistinguishable from an authored one, and "the flat amount was silently ignored" is the failure this vocabulary exists to end'
      ),
    /**
     * Scale by a printed class-table column's growth above its first value (Eldritch Invocations 1 -> 10),
     * added to the feature's own `choose`. A dice-string column gives 0.
     */
    scaling: PickBudgetScalingSchema.optional().describe(
      "How many extra picks, read off the class table's own printed column. The budget then follows the column at every level"
    )
  })
  .strict()
  .superRefine((grant, context) => {
    // Exactly one of `amount` and `scaling`; `amount` has no default so an authored 1 is never ambiguous.
    if ((grant.amount === undefined) === (grant.scaling === undefined)) {
      context.addIssue({
        code: "custom",
        message: "An extra pick states exactly one of a flat `amount` or a `scaling` rule."
      });
    }
  })
  .describe(
    "One budget a feature or a chosen option raises. `offer` is the offer key the wizard and the server already share verbatim: `class-cantrips`, `class-spells`, `class-skills`, `class-tools`, `background-skills`, `background-tools`, `background-languages`, `species-languages`, or `feature:<featureId>`. It is that existing open namespace. A key naming no budget the build actually has is a loud rejection at creation, never a silent zero: an authored grant that quietly adds nothing is the failure this vocabulary exists to end."
  );
export type ExtraPick = z.infer<typeof ExtraPickSchema>;

/**
 * Raises a pick budget ("one extra cantrip from the Cleric spell list"). Not in `featureRiders`:
 * items must never carry it, since a budget that leaves with an item would strand a chosen pick.
 */
const extraPicksField = z.array(ExtraPickSchema).max(4).default([]);

/**
 * One "you can replace..." clause, which edits a row of `character.choices[]`. `"level-up"` rewrites the
 * ledger at build time; `"short-rest"`/`"long-rest"` set `actor.choiceOverrides`, cleared by the
 * matching rest, except a pick the build reads (its options grant spells, or another pick depends on it),
 * whose ledger row is rewritten and the sheet rebuilt.
 */
export const ReplaceableChoiceSchema = z
  .object({
    offer: PickBudgetKeySchema,
    when: z.enum(["level-up", "short-rest", "long-rest"]),
    amount: z
      .number()
      .int()
      .min(1)
      .max(5)
      .default(1)
      .describe("How many of that offer's answers may be swapped at once"),
    /** A name several clauses share one allowance under (Mystic Arcanum: "replace one of your arcanum spells" across
     *  its four arcana). */
    shares: ContentIdSchema.optional().describe(
      'A name several clauses share one allowance under: Mystic Arcanum\'s "replace one of your arcanum spells" is one swap across its four arcana'
    )
  })
  .strict()
  .describe(
    'One "you can replace…" clause. `offer` is the same offer-key namespace `extraPicks` uses, and a key naming no pick this build has is a loud build rejection. `when: "level-up"` is a build-time permission over the choices ledger (the replaced row is deleted, never tombstoned); `"short-rest"` / `"long-rest"` are re-made with actor.rechoose: runtime state on the actor, cleared by the matching rest, unless the build reads the answer (its options grant spells, or another pick depends on it, as a land does), which rewrites the ledger row and rebuilds the sheet; a short-rest clause is satisfied by a Long Rest too.'
  );
export type ReplaceableChoice = z.infer<typeof ReplaceableChoiceSchema>;
const replacesField = z.array(ReplaceableChoiceSchema).max(4).default([]);

/** The fields that describe what is being picked, shared by a feature's choice and an option's own. */
const featureChoiceBase = {
  kind: ContentIdSchema.describe(
    "Open slug the wizard renders generically: fighting-style, skill, expertise, subclass, asi, feat, spell, cantrip, language, tool, or anything homebrew invents"
  ),
  choose: z.number().int().min(1).max(10).default(1),
  /** Explicit option ids; at least one. Omit the field when `fromCatalog` or `options` supplies the list. */
  from: z
    .array(ContentIdSchema)
    .min(
      1,
      "An explicit `from` list must name at least one option (omit it entirely to use `fromCatalog` or `options`)."
    )
    .max(80)
    .optional()
    .describe(
      "Explicit option ids. Must name at least one; an empty list is an authoring mistake. Omit the field entirely when `fromCatalog` or `options` supplies the list"
    ),
  /** An open catalog slug the wizard resolves at pick time ("skills", "feats", "wizard-spells"). */
  fromCatalog: ContentIdSchema.optional().describe(
    "An open catalog slug resolved at pick time (skills, feats, wizard-spells)"
  ),
  /** Options from the character's own earlier picks ("one of your known Warlock cantrips that deals damage"). */
  fromPicks: z
    .object({
      offer: PickBudgetKeySchema,
      where: z.enum(["deals-damage", "attack-roll", "ranged", "ranged-damage"]).optional()
    })
    .strict()
    .optional()
    .describe(
      'The options are the character\'s own earlier answers: "choose one of your known Warlock cantrips that deals damage". `offer` names the budget holding them, in the same key namespace extraPicks uses; `where` is a closed predicate slug, never an expression. Resolves to a non-empty list or defers, exactly as an unresolvable fromCatalog does.'
    ),
  /** Only options at or below this level are legal (spell picks). */
  maxSpellLevel: z
    .number()
    .int()
    .min(0)
    .max(9)
    .optional()
    .describe("Ceiling on a spell pick's level (Magic Initiate: 0, cantrips only)"),
  /** Only options at or above this level; equal to `maxSpellLevel` for an exact level (Mystic Arcanum). */
  minSpellLevel: z
    .number()
    .int()
    .min(0)
    .max(9)
    .optional()
    .describe(
      'Floor on a spell pick\'s level, the sibling of maxSpellLevel. Mystic Arcanum reads "one level 6 Warlock spell"; both bounds at 6 make the pick exact'
    ),
  /** The answer the build takes when the ledger holds none (the High Elf's Prestidigitation, swapped later). */
  default: ContentIdSchema.optional().describe(
    "The answer the build takes when the ledger holds none (a High Elf knows Prestidigitation until a Long Rest swaps it), so a sheet made before the pick existed still builds and the builder starts on it"
  ),
  /** Only spells cast with this casting time (Spell Mastery: "spells ... that have a casting time of an action"). */
  castingTime: z
    .enum(["action", "bonus-action", "reaction"])
    .optional()
    .describe('Only spells cast with this casting time (Spell Mastery: "a casting time of an action")'),
  /** Only spells with the Ritual tag (Pact of the Tome's "two level 1 spells that have the Ritual tag"). */
  ritual: z
    .literal(true)
    .optional()
    .describe("Only spells with the Ritual tag (Pact of the Tome's two level 1 rituals)"),
  /** Only spells in the character's spellbook (Spell Mastery, Signature Spells), checked as the pick is made. */
  fromSpellbook: z
    .literal(true)
    .optional()
    .describe(
      "Only spells in the character's spellbook (Spell Mastery, Signature Spells): the server checks the pick against the book when a build or a rest's re-choice makes it"
    ),
  /** The ceiling an ability-score pick from this choice may reach; absent = 20 (epic boons use 30). */
  maximum: z
    .number()
    .int()
    .min(1)
    .max(30)
    .optional()
    .describe(
      "Ceiling an ability-score pick from this choice may raise a score to; omitted = the SRD's 20. The sibling of the `ability-score` rider's own `maximum`, and separate because the mechanisms differ: a rider raises a named ability, a choice lets the player pick which, and the epic boons (\"increase one ability score by 1, to a maximum of 30\") do the second"
    ),
  /** The same option may be picked more than once (Expertise across levels). */
  repeatable: z
    .boolean()
    .default(false)
    .describe("The same option may be picked more than once (Expertise across levels)")
} as const;

/** A floor above its own ceiling offers nothing, so it is refused at author time. */
const spellLevelWindow = (choice: { minSpellLevel?: number; maxSpellLevel?: number }, context: z.RefinementCtx) => {
  if (
    choice.minSpellLevel !== undefined &&
    choice.maxSpellLevel !== undefined &&
    choice.minSpellLevel > choice.maxSpellLevel
  ) {
    context.addIssue({
      code: "custom",
      path: ["minSpellLevel"],
      message: `minSpellLevel ${choice.minSpellLevel} is above maxSpellLevel ${choice.maxSpellLevel}, so no spell can satisfy both.`
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
        code: "custom",
        message: "A choice needs an explicit `from` list, a `fromCatalog` slug, or a `fromPicks` source."
      });
    }
    spellLevelWindow(choice, context);
  })
  .describe(
    "The terminal of the feature/choice/option cycle. Identical to HomebrewFeatureChoice except that it has no `options` key at all, so the schema itself bounds the recursion: an option's own pick may name ids or a catalog slug, and can never open a third level."
  );
export type FeatureOptionChoice = z.infer<typeof FeatureOptionChoiceSchema>;

/** `choice` and `choices` are mutually exclusive; read both through `featurePicks`. */
const oneChoiceForm = (record: { choice?: unknown; choices?: unknown }, context: z.RefinementCtx) => {
  if (record.choice !== undefined && record.choices !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["choices"],
      message: "Author `choice` (one pick) or `choices` (several), and never both."
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
    requires: z
      .object({ offer: PickBudgetKeySchema, id: ContentIdSchema })
      .strict()
      .optional()
      .describe(
        'This option is legal only when an earlier answer says so: "the option you chose for Blessed Strikes grows more powerful". `offer` is the same offer-key namespace `extraPicks` uses. When gating leaves exactly as many legal options as the capacity, the survivors are adopted and no pick is rendered: the answer is a consequence of the gating.'
      ),
    /** The class level this option may first be chosen at (an invocation's "Prerequisite: Level 5+ Warlock");
     *  a build below it is not offered the option. */
    level: ContentLevelSchema.optional().describe(
      'The class level this option may first be chosen at: an invocation\'s "Prerequisite: Level 5+ Warlock". A build below it is not offered the option'
    ),
    /** It may be chosen more than once (an invocation's "Repeatable. You can gain this invocation more than once"). */
    repeatable: z
      .literal(true)
      .optional()
      .describe(
        'It may be chosen more than once: an invocation\'s "Repeatable. You can gain this invocation more than once"'
      ),
    /** A pick this option asks for once chosen, from a list of its own. */
    choice: FeatureOptionChoiceSchema.optional().describe(
      "A second-order pick this option owes once chosen, from a list of its own"
    ),
    /** Several picks this option asks for; see `FeatureRecordSchema.choices`. Author one or the other. */
    choices: z
      .array(FeatureOptionChoiceSchema)
      .min(1)
      .max(4)
      .optional()
      .describe(
        "Several second-order picks (Pact of the Tome asks for three cantrips and two rituals). Mutually exclusive with `choice`"
      ),
    /** Budgets this option raises once chosen (Thaumaturge's extra Cleric cantrip). */
    extraPicks: extraPicksField.describe(
      'Budgets this raises, where the player picks the outcome: "you know one extra cantrip from the Cleric spell list", "one additional skill from your class\'s list". The printed level row and every grant are summed, so two features each granting +1 yield +2'
    ),
    /** Picks this option lets the character re-make later (see `ReplaceableChoiceSchema`). */
    replaces: replacesField.describe(
      'Picks this lets the character re-make later: "whenever you finish a Long Rest, choose one type of land". Not a budget increase: it edits an answer. A level-up clause rewrites the choices ledger; a rest clause is runtime state on the actor, cleared by the matching rest'
    ),
    ...featureRiders
  })
  .strict()
  .superRefine(oneChoiceForm)
  .describe(
    'One pickable option that carries its own mechanics: structurally a HomebrewFeature minus `replacesFeatureId`, with identical rider fields and identical meanings. That is the point: a chosen option is interpreted by the very same code path that interprets a class feature, so "Divine Order: Protector" carries its Martial-weapon and Heavy-armor training itself, so it is never a bare id string nothing downstream can read.'
  );
export type FeatureOption = z.infer<typeof FeatureOptionSchema>;

/**
 * A pick the feature asks the player to make; writes a `choices[]` ledger row. Options come from
 * `fromCatalog`, `from` or inline `options`; after parsing, `from` always holds the id list.
 */
export const FeatureChoiceSchema = z
  .object({
    ...featureChoiceBase,
    /** Options carrying their own mechanics. Mutually exclusive with `from`, which is derived from these. */
    options: z
      .array(FeatureOptionSchema)
      .min(1)
      .max(40)
      .optional()
      .describe("Options carrying their own mechanics. Mutually exclusive with `from`")
  })
  .strict()
  .superRefine((choice, context) => {
    if (!choice.from && !choice.fromCatalog && !choice.options && !choice.fromPicks) {
      context.addIssue({
        code: "custom",
        message:
          "A choice needs an explicit `from` list, inline `options`, a `fromCatalog` slug, or a `fromPicks` source."
      });
    }
    if (choice.from && choice.options) {
      context.addIssue({
        code: "custom",
        path: ["from"],
        message: "Author `options` alone. `from` is derived from the option ids."
      });
    }
    if (choice.options) {
      const duplicate = choice.options.find(
        (option, index) => choice.options!.findIndex((other) => other.id === option.id) !== index
      );
      if (duplicate)
        context.addIssue({
          code: "custom",
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
  })
  .describe(
    "A pick a feature asks for, in three increasing richnesses: `fromCatalog` (an open catalog slug resolved at pick time), `from` (explicit ids whose mechanics live elsewhere or nowhere), or `options` (the ids with their mechanics inline, for options that exist only here: Divine Order's two sacred roles, Giant Ancestry's six boons). `options` and `from` are mutually exclusive: after parsing, `from` always holds the canonical id list, derived from `options` when they were authored."
  );
export type FeatureChoice = z.infer<typeof FeatureChoiceSchema>;

/** The shared feature record. `description` is the display source of truth; riders are optional. */
export const FeatureRecordSchema = z
  .object({
    id: ContentIdSchema,
    name: z.string().min(1).max(120),
    /** Class/subclass level this feature is gained at; on a species or lineage trait, the character level it
     *  arrives at (Draconic Flight at 5). Absent for records held from level 1 (most traits, feats). */
    level: ContentLevelSchema.optional().describe(
      "Class/subclass level this feature is gained at; on a species or lineage trait, the character level it arrives at (Draconic Flight at 5). Omitted for records held from level 1 (most traits, feats)"
    ),
    description: z.string().min(1).max(20000),
    /** A pick this feature asks the player to make; writes a `choices[]` row. */
    choice: FeatureChoiceSchema.optional().describe(
      "A pick this feature asks the player to make; every one writes a row in the character's choice-provenance ledger, which is what makes level-up and respec possible"
    ),
    /** Several picks from one record (Magic Initiate). Mutually exclusive with `choice`; read through `featurePicks`. */
    choices: z
      .array(FeatureChoiceSchema)
      .min(1)
      .max(4)
      .optional()
      .describe(
        "Several picks, when one record promises more than one: Magic Initiate's \"two cantrips ... and one level 1 spell\", Deft Explorer's Expertise plus two languages. Mutually exclusive with `choice`, which stays the way almost every record is authored"
      ),
    /** Budgets this feature raises: one extra cantrip, one extra skill, one more prepared spell. */
    extraPicks: extraPicksField.describe(
      'Budgets this raises, where the player picks the outcome: "you know one extra cantrip from the Cleric spell list", "one additional skill from your class\'s list". The printed level row and every grant are summed, so two features each granting +1 yield +2'
    ),
    /** Picks this feature lets the character re-make later: on a level-up, or on a rest (see `ReplaceableChoiceSchema`). */
    replaces: replacesField.describe(
      'Picks this lets the character re-make later: "whenever you finish a Long Rest, choose one type of land". Not a budget increase: it edits an answer. A level-up clause rewrites the choices ledger; a rest clause is runtime state on the actor, cleared by the matching rest'
    ),
    /** Spell lists the class's own spell picks may also draw on, the spells counting as the class's (Magical
     *  Secrets: "from the Bard, Cleric, Druid, and Wizard spell lists"). */
    extraSpellLists: z
      .array(ContentIdSchema)
      .min(1)
      .max(8)
      .optional()
      .describe(
        "Spell lists the class's own prepared and cantrip picks may also draw on, the spells counting as that class's (Magical Secrets: the Bard's picks may come from the Cleric, Druid and Wizard lists). Widens an existing budget; it adds no picks"
      ),
    /** A free casting of a spell other features grant, on this feature's own uses, which the spells share (Natural
     *  Recovery: "one of the level 1+ spells that you have prepared from your Circle Spells feature"). */
    freeCastOf: z
      .object({
        /** The features whose granted spells it casts, with the options chosen under them. */
        features: z.array(ContentIdSchema).min(1).max(8),
        /** The lowest level of spell it casts (Natural Recovery's "level 1+"). */
        minLevel: z.number().int().min(0).max(9).optional()
      })
      .strict()
      .optional()
      .describe(
        "A free casting of a spell other features grant, on this feature's own `uses`, which every such spell shares: Natural Recovery casts \"one of the level 1+ spells that you have prepared from your Circle Spells feature\" once per Long Rest. `features` names the granting features (their chosen options' grants count)"
      ),
    ...featureRiders,
    /** This feature replaces an earlier one of the same id lineage (Indomitable at 9/13/17). */
    replacesFeatureId: ContentIdSchema.optional().describe(
      "This feature replaces an earlier one of the same id lineage (Indomitable at 9/13/17)"
    )
  })
  .strict()
  .superRefine(oneChoiceForm)
  .describe(
    "The shared feature record: a class feature, a subclass feature, a species trait, a background feature, and a feat's mechanics are all this one shape. `description` is always the display source of truth, and every rider is optional; a prose-only feature is perfectly valid and is how most text starts life. This is the authoring counterpart of `ContentFeature`, which publishes the same feature with its riders stripped."
  );
export type FeatureRecord = z.infer<typeof FeatureRecordSchema>;

// ---- Class -----------------------------------------------------------------------------------

/** A "choose N from this list" proficiency grant; `from` and `fromCatalog` combine as a union. */
export const ChoiceListSchema = z
  .object({
    choose: z.number().int().min(0).max(10),
    from: z.array(ContentIdSchema).max(60).default([]),
    fromCatalog: ContentIdSchema.optional().describe(
      'An open catalog slug resolved at pick time ("standard-languages", "tools", "skills")'
    )
  })
  .strict()
  .superRefine((list, context) => {
    // A budget with no source can never be satisfied.
    if (list.choose > 0 && list.from.length === 0 && !list.fromCatalog) {
      context.addIssue({
        code: "custom",
        message:
          'A "choose N" list needs a non-empty `from` list or a `fromCatalog` slug. Without one the pick has no options and the build can never be completed.'
      });
    }
  })
  .describe(
    'A "choose N from this list" proficiency grant (class skills, background tools, species languages). Needs a non-empty `from` or a `fromCatalog` whenever `choose` is above zero, because a budget with no source can never be satisfied and the wizard could not be finished.'
  );

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
            quantity: z.number().int().min(1).max(99).default(1),
            /** The item is one of these, picked as the kit is taken (the Bard's "Musical Instrument of your choice");
             *  `id` is the one it gives when no pick is recorded. */
            pickFrom: z.array(ContentIdSchema).min(2).max(40).optional()
          })
          .strict()
      )
      .max(20)
      .default([]),
    goldPieces: z.number().int().min(0).max(1000).default(0)
  })
  .strict()
  .describe(
    'A named starting-equipment bundle ("A: chain mail and a martial weapon", "C: 155 gp"). The chosen option\'s id is what lands in the character\'s choice ledger, so the items must be resolvable; a label alone can be displayed but never turned into inventory.'
  );

/** One row of a class's 20-level table: the feature ids granted, plus the printed columns. */
export const ClassLevelRowSchema = z
  .object({
    level: ContentLevelSchema,
    proficiencyBonus: z.number().int().min(2).max(6),
    features: z.array(ContentIdSchema).max(12).default([]),
    /** Nine counts, index 0 = level 1 slots. Absent for a non-caster row. */
    spellSlots: z
      .array(z.number().int().min(0).max(4))
      .length(9)
      .optional()
      .describe("Nine counts, index 0 = level 1 slots. Omitted on a non-caster row"),
    /** Warlock Pact Magic: one uniform slot level with its own count. */
    pactSlots: z
      .object({ level: z.number().int().min(1).max(9), slots: z.number().int().min(0).max(4) })
      .strict()
      .optional()
      .describe("Warlock Pact Magic: one uniform slot level with its own count"),
    cantripsKnown: z.number().int().min(0).max(10).optional(),
    spellsKnown: z.number().int().min(0).max(40).optional(),
    /** A flat number or the SRD formula ("<ability> modifier + <class> level"); falls back to `preparedCount`. */
    preparedFormula: z
      .string()
      .max(60)
      .optional()
      .describe(
        'The prepared-spell rule as data ("<ability> modifier + <class> level") so a homebrew class prints its own wording'
      ),
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
            amount: z
              .union([z.number().int().min(0).max(999), z.string().min(1).max(20)])
              .describe("A count, or a dice string"),
            /** This column is ink only: no live pool answers to this id, and none is expected to. */
            display: z
              .boolean()
              .optional()
              .describe("This column is ink only: no live pool answers to this id, and none is expected to")
          })
          .strict()
      )
      .max(8)
      .default([])
      .describe(
        "Named per-level resources (Rage 3, Ki 5, Sneak Attack 3d6, Second Wind 3). A printed column. The live pool the engine spends is `actor.actionUses[uses.pool ?? action.id]`, and an id here reaches it only by matching a `uses.pool` on the same class. Mark a column that is genuinely only ink with `display: true`"
      )
  })
  .strict()
  .describe(
    "One row of a class's 20-level table. `features` lists the ids granted at that level, resolved against the owning record's own `features[]`. The optional columns carry whatever the printed table carries. Omit a column this class does not have; zeroes would be read as printed values."
  );
export type ClassLevelRow = z.infer<typeof ClassLevelRowSchema>;

/** Spellcasting a class (or a third-caster subclass) grants. */
export const ContentSpellcastingSchema = z
  .object({
    ability: AbilitySchema,
    /** "known" = a fixed spells-known list; "prepared" = re-chosen on a Long Rest. */
    prepares: z
      .enum(["known", "prepared"])
      .describe("known = a fixed spells-known list; prepared = re-chosen on a Long Rest"),
    ritual: z.boolean().default(false),
    /** Spellcasting focus slug ("arcane-focus", "holy-symbol", "druidic-focus"); null = none. */
    focus: ContentIdSchema.nullable()
      .default(null)
      .describe("Spellcasting focus slug (arcane-focus, holy-symbol, druidic-focus); null = none"),
    /** How this class's levels count toward the shared multiclass caster level. */
    multiclassProgression: z
      .enum(["full", "half", "third", "pact"])
      .default("full")
      .describe("How this class's levels count toward the shared multiclass caster level"),
    /** The spell list this class draws from; an open slug so homebrew lists work. */
    spellListId: ContentIdSchema.optional().describe(
      "The spell list this class draws from: an open slug, so a HomebrewSpellListRecord works. One of the seven derived-id fields a pack import rewrites (it also implies the `<listId>-spells` catalog slug)"
    )
  })
  .strict()
  .describe("Spellcasting a class (or a third-caster subclass) grants.");
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
  .strict()
  .describe(
    'Ability minimums for taking this class as a multiclass; `mode: "any"` covers "STR 13 or DEX 13". Display data; the server re-validates.'
  );

export const ClassReferenceSchema = z
  .object({
    ...contentRecordBase,
    hitDie: HitDieSchema.describe("The multiclass hit-dice pool keys on this"),
    /** Ordered ability priority, best first, for the random generator. */
    statPriority: z
      .array(AbilitySchema)
      .length(6)
      .describe(
        "All six abilities, best first: the random generator's core input as data, so a homebrew class supplies its own without touching @vtt/rules-5e"
      ),
    /** The class's headline ability (one, or two for Fighter/Monk/Paladin/Ranger). */
    primaryAbilities: z.array(AbilitySchema).min(1).max(2),
    savingThrows: z.array(AbilitySchema).min(1).max(6),
    skillChoices: ChoiceListSchema,
    armorProficiencies: z.array(ContentIdSchema).max(10).default([]),
    weaponProficiencies: z.array(ContentIdSchema).max(40).default([]),
    toolProficiencies: z.array(ContentIdSchema).max(20).default([]),
    toolChoices: ChoiceListSchema.optional(),
    startingEquipment: z.array(StartingEquipmentOptionSchema).max(6).default([]),
    /** Proficiencies gained when the class is taken as a multiclass (narrower than the level-1 set): the Rogue's
     *  skill from its list, the Bard's instrument of choice. */
    multiclassProficiencies: z
      .object({
        armor: z.array(ContentIdSchema).max(10).default([]),
        weapons: z.array(ContentIdSchema).max(40).default([]),
        tools: z.array(ContentIdSchema).max(20).default([]),
        skills: ChoiceListSchema.optional(),
        toolChoices: ChoiceListSchema.optional()
      })
      .strict()
      .optional()
      .describe(
        "Proficiencies gained when the class is taken as a multiclass, narrower than the level-1 set. The builder grants them to every class after the first"
      ),
    multiclassPrerequisites: MulticlassPrerequisiteSchema.optional(),
    /** The level the subclass is chosen at, and what the class calls it ("Martial Archetype"). */
    subclassLevel: ContentLevelSchema,
    subclassLabel: z.string().max(60).optional().describe('What this class calls its subclass ("Martial Archetype")'),
    /** Levels granting an Ability Score Improvement (or a feat instead). */
    asiLevels: z.array(ContentLevelSchema).max(10).default([]),
    spellcasting: ContentSpellcastingSchema.optional(),
    levelTable: z
      .array(ClassLevelRowSchema)
      .length(20)
      .describe(
        "Exactly 20 rows, row N at level N. Each row's `features` must resolve against this record's own `features[]`; the server refuses the record otherwise, which is why re-minting an id on import never rewrites intra-record ids"
      ),
    features: z.array(FeatureRecordSchema).max(160).default([])
  })
  .strict()
  .superRefine((entry, context) => {
    entry.levelTable.forEach((row, index) => {
      if (row.level !== index + 1)
        context.addIssue({
          code: "custom",
          path: ["levelTable", index, "level"],
          message: `Level table row ${index} must be level ${index + 1}.`
        });
    });
    const featureIds = new Set(entry.features.map((feature) => feature.id));
    entry.levelTable.forEach((row, rowIndex) =>
      row.features.forEach((featureId, featureIndex) => {
        if (!featureIds.has(featureId))
          context.addIssue({
            code: "custom",
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
        code: "custom",
        path: ["features"],
        message: `Duplicate feature id "${duplicate.id}".`
      });
  })
  .describe(
    "A character class. The heaviest of the nine: a full 20-row printed table plus every feature it can grant. Duplicating an SRD class (`POST /content/{id}/duplicate` with `wizard`) is what makes that tractable to author."
  );
export type ClassReference = z.infer<typeof ClassReferenceSchema>;

// ---- Subclass --------------------------------------------------------------------------------

export const SubclassReferenceSchema = z
  .object({
    ...contentRecordBase,
    classId: ContentIdSchema.describe(
      "The class this subclass belongs to. Re-minting a class id on pack import rewrites this; it is one of the seven derived-id fields"
    ),
    /** Level the subclass is taken at; absent = inherit the class's `subclassLevel`. */
    subclassLevel: ContentLevelSchema.optional().describe(
      "The class level this subclass is taken at; omitted inherits the parent class's"
    ),
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
            code: "custom",
            path: ["levelTable", rowIndex, "features", featureIndex],
            message: `Level ${row.level} grants unknown feature "${featureId}".`
          });
      })
    );
  })
  .describe(
    "A subclass. Third-caster subclasses (Eldritch Knight, Arcane Trickster) declare their own `spellcasting` and overlay extra table rows on the parent class's."
  );
export type SubclassReference = z.infer<typeof SubclassReferenceSchema>;

// ---- Species ---------------------------------------------------------------------------------

export const CreatureSizeSchema = z.enum(["tiny", "small", "medium", "large", "huge", "gargantuan"]);

/** A playable species. SRD 5.2.1 puts ability increases on backgrounds; `abilityBonuses` is for 2014-style and homebrew. */
export const SpeciesReferenceSchema = z
  .object({
    ...contentRecordBase,
    /** Sizes a member of this species may be; several 2024 species let the player pick Small or Medium. */
    sizes: z
      .array(CreatureSizeSchema)
      .min(1)
      .max(6)
      .default(["medium"])
      .describe("A list because several 2024 species let the player pick Small or Medium"),
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
      .optional()
      .describe('"Choose N abilities to raise by M": the 2014 variant-human pattern'),
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
      .describe("Lineages / subraces, each adding its own traits on top")
  })
  .strict()
  .describe(
    "A playable species. Note the deliberate absence of required ability bonuses: SRD 5.2.1 puts ability increases on the background. `abilityBonuses` exists anyway as optional data so a 2014-style or homebrew species can still carry them, and the builder applies whatever a record declares and assumes no edition."
  );
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
          .prefault([
            [2, 1],
            [1, 1, 1]
          ])
      })
      .strict()
      .optional()
      .describe(
        "SRD 5.2.1 ability increases: which abilities, and the legal distributions as data (+2/+1 or +1/+1/+1) so a homebrew background can print its own"
      ),
    originFeatId: ContentIdSchema.optional().describe(
      "The origin feat this background grants, keyed into the feat catalog, one of the seven derived-id fields a pack import rewrites"
    ),
    skillProficiencies: z.array(ContentIdSchema).max(10).default([]),
    skillChoices: ChoiceListSchema.optional(),
    toolProficiencies: z.array(ContentIdSchema).max(10).default([]),
    toolChoices: ChoiceListSchema.optional(),
    languages: z.array(ContentIdSchema).max(10).default([]),
    languageChoices: ChoiceListSchema.optional(),
    startingEquipment: z.array(StartingEquipmentOptionSchema).max(6).default([]),
    features: z.array(FeatureRecordSchema).max(10).default([])
  })
  .strict()
  .describe(
    "A background. In SRD 5.2.1 this is where ability increases and the origin feat live, so it is the record a homebrew origin is authored on."
  );
export type BackgroundReference = z.infer<typeof BackgroundReferenceSchema>;

// ---- Feat ------------------------------------------------------------------------------------

export const FeatReferenceSchema = z
  .object({
    ...contentRecordBase,
    /** Open slug: "origin", "general", "fighting-style", "epic-boon", or anything homebrew adds. */
    category: ContentIdSchema.default("general").describe(
      "Open slug: origin, general, fighting-style, epic-boon, or anything homebrew adds. Feeds the `<category>-feats` catalog slug a feature choice can point at"
    ),
    prerequisite: z
      .object({
        level: ContentLevelSchema.optional(),
        abilityScores: z
          .array(z.object({ ability: AbilitySchema, minimum: z.number().int().min(1).max(20) }).strict())
          .max(6)
          .default([]),
        /** Whether every minimum must be met, or any one of them (Grappler's "Strength or Dexterity 13+"). */
        abilityScoreMode: z
          .enum(["all", "any"])
          .default("all")
          .describe(
            'Whether every ability minimum must be met ("all") or any one of them ("any": Grappler\'s "Strength or Dexterity 13+")'
          ),
        /** Proficiency or feature slugs the character must already have ("martial", "spellcasting"). */
        requires: z
          .array(ContentIdSchema)
          .max(10)
          .default([])
          .describe(
            'Proficiency or feature slugs the character must already have ("fighting-style"); "spellcasting" means a class or subclass Spellcasting feature'
          ),
        /** Anything not modeled above, printed for the player to judge (ADR-0008 prose fallback). */
        text: z
          .string()
          .max(400)
          .optional()
          .describe("Anything not modeled above, printed for the player to judge (ADR-0008 prose fallback)")
      })
      .strict()
      .optional()
      .describe("Whether a prerequisite is met is decided by the server alone"),
    repeatable: z.boolean().default(false),
    /** The feat's mechanics: a feat is a feature plus catalog metadata. */
    feature: FeatureRecordSchema
  })
  .strict()
  .describe(
    "A feat: catalog metadata plus one HomebrewFeature carrying all the mechanics. Nothing about a feat is special-cased; it is literally the same feature record a class or species uses, which is why the smallest of the nine still exercises the whole rider vocabulary."
  );
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
    /** Start from these existing list ids: SRD (`wizard`) or another overlay. Empty = start blank. */
    basedOn: z
      .array(ContentIdSchema)
      .max(8)
      .default([])
      .describe("Start from these existing list ids: SRD (`wizard`) or another overlay. Empty starts blank"),
    /** Spell ids added on top of the `basedOn` expansion. SRD spell ids are perfectly legal here. */
    add: z
      .array(ContentIdSchema)
      .max(500)
      .default([])
      .describe("Spell ids added on top of the `basedOn` expansion. SRD spell ids are perfectly legal here"),
    /** Spell ids removed last, after everything else: a `remove` always wins. */
    remove: z.array(ContentIdSchema).max(500).default([]).describe("Spell ids removed last, after everything else")
  })
  .strict()
  .describe(
    'A spell list as a membership overlay, never an edit to the generated spell bundle: `basedOn` expands existing lists, `add` layers ids on top, and `remove` always wins. That is what keeps "the Wizard list plus my three spells" one row where a copy would take 221. A list resolving to zero spells is a hard character-creation rejection downstream, so publish-time validation refuses an empty one.'
  );
export type SpellListReference = z.infer<typeof SpellListReferenceSchema>;
