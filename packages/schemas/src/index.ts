import { z } from "zod";

export const ACTOR_SCHEMA_VERSION = 1;

/** Lowercase damage-type id ("slashing", "fire") on a stat block; free-form so a homebrew creature's types stay
 * expressible. A rider names a `DamageTypeSchema` value instead. */
const DamageTypeIdSchema = z.string().min(1).max(40);
const ConditionIdSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .max(60);
const EffectTagSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .max(40);
/** Open identity slug, matching the content catalog's `ContentIdSchema`. */
const RiderSlugSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .max(80);
const SizeSchema = z.enum(["tiny", "small", "medium", "large", "huge", "gargantuan"]);
/** A pick budget that follows a printed class-table column's growth (Eldritch Invocations 1 -> 10). Here because the
 *  content bundle authors it and the catalog rows carry it. */
export const PickBudgetScalingSchema = z.strictObject({
  type: z.literal("class-resource-growth"),
  /** The `classResources.id` of the printed column - `eldritch-invocations`, `weapon-mastery`. */
  id: RiderSlugSchema
});
/** A safe dice expression, one die term plus at most one flat modifier - never an evaluable string (ADR-0008). */
export const DiceFormulaSchema = z
  .string()
  .regex(/^\d+d(?:4|6|8|10|12|20|100)(?:\s*[+-]\s*\d+)?$/i, "Use a safe dice formula such as 1d8 + 3.");
/** Hit points restored: dice, or a flat number (Heal's 70). */
export const HealingFormulaSchema = z
  .string()
  .regex(/^(?:\d+d(?:4|6|8|10|12|20|100)(?:\s*[+-]\s*\d+)?|\d+)$/i, "Use dice such as 2d8 + 3, or a number.");
export const AbilitySchema = z.enum(["str", "dex", "con", "int", "wis", "cha"]);
export type AbilityId = z.infer<typeof AbilitySchema>;
/** The SRD's 13 damage types. Riders name one of these, so a misspelled type is refused instead of publishing a
 * gate or a defence that matches nothing. */
export const DamageTypeSchema = z.enum([
  "acid",
  "bludgeoning",
  "cold",
  "fire",
  "force",
  "lightning",
  "necrotic",
  "piercing",
  "poison",
  "psychic",
  "radiant",
  "slashing",
  "thunder"
]);
export type DamageType = z.infer<typeof DamageTypeSchema>;
/** The SRD's 15 conditions, closed in riders for the same reason. Exhaustion is a condition, levels and all. */
export const ConditionSchema = z.enum([
  "blinded",
  "charmed",
  "deafened",
  "exhaustion",
  "frightened",
  "grappled",
  "incapacitated",
  "invisible",
  "paralyzed",
  "petrified",
  "poisoned",
  "prone",
  "restrained",
  "stunned",
  "unconscious"
]);
export type Condition = z.infer<typeof ConditionSchema>;

// ---- Rider gates: the trigger vocabulary items, features, feats and effects share ----

/** Where an item is worn or held. A closed enum, unlike the open `category` slug, because the engine switches
 * on it exhaustively (AC derivation, double-equip, attunement gates); a homebrew "relic" with `slot: "armor"` derives AC. */
export const ItemSlotSchema = z.enum([
  "weapon",
  "shield",
  "armor",
  "head",
  "eyes", // lenses and goggles, apart from headwear
  "neck",
  "shoulders", // a cloak or cape
  "body", // a robe, worn over clothes and under a cloak
  "hands", // gloves or gauntlets
  "bracers",
  "ring",
  "belt",
  "feet", // worn
  "held", // wand, orb, rod, staff, focus
  "wondrous", // attunable, no body location
  "consumable", // potion, scroll
  "ammunition",
  "none" // pure gear, no equip semantics
]);
export type ItemSlot = z.infer<typeof ItemSlotSchema>;

/**
 * When a rider applies: named triggers in four kinds, and the kind decides the evaluation layer
 * (see `RIDER_TRIGGER_KINDS`):
 *   - `static-gate`  resolvable from the sheet alone   -> a standing number ("AC 17")
 *   - `dynamic-gate` live actor state                  -> a labelled note, re-checked per roll
 *   - `moment`       the named roll or event           -> fires at that moment only
 *   - `filter`       narrows whatever moment it accompanies
 * Data, not an expression language (ADR-0008): bounded `.strict()` objects, no OR/NOT/nesting/arithmetic.
 * Every trigger here has a reader; one the engine cannot answer does not belong in the vocabulary.
 */
export const RiderTriggerSchema = z.discriminatedUnion("type", [
  // ---- static gates ----
  /** The bearer is attuned. Redundant (and harmless) when the item's own `attunement.required` is true. */
  z.object({ type: z.literal("attuned") }).strict(),
  /** Wearing armor; omitting `weights` means any armor. */
  z
    .object({
      type: z.literal("while-armored"),
      weights: z
        .array(z.enum(["light", "medium", "heavy"]))
        .min(1)
        .max(3)
        .optional()
    })
    .strict(),
  z.object({ type: z.literal("while-unarmored"), allowShield: z.boolean().default(false) }).strict(),
  /** `wielding: false` expresses Dueling-style "only while not holding a shield". */
  z.object({ type: z.literal("while-shield"), wielding: z.boolean().default(true) }).strict(),
  /** Two lists in one trigger so "Paladin or Cleric" needs no OR. */
  z
    .object({
      type: z.literal("while-character-is"),
      classIds: z.array(RiderSlugSchema).max(8).default([]),
      speciesIds: z.array(RiderSlugSchema).max(8).default([])
    })
    .strict(),
  z
    .object({
      type: z.literal("while-proficient-with"),
      kind: z.enum(["weapon", "armor", "tool", "skill"]),
      ids: z.array(RiderSlugSchema).min(1).max(12)
    })
    .strict(),
  // ---- dynamic gates ----
  /** Any-of against `actor.effects[].tags`. */
  z.object({ type: z.literal("while-effect-tag"), tags: z.array(EffectTagSchema).min(1).max(4) }).strict(),
  z.object({ type: z.literal("while-hp-at-or-below"), percent: z.number().int().min(1).max(99) }).strict(),
  z
    .object({
      type: z.literal("while-condition"),
      conditionIds: z.array(ConditionSchema).min(1).max(6),
      present: z.boolean().default(true)
    })
    .strict(),
  // ---- moments ----
  z.object({ type: z.literal("on-attack-roll") }).strict(),
  z.object({ type: z.literal("on-hit") }).strict(),
  z.object({ type: z.literal("on-critical-hit") }).strict(),
  z.object({ type: z.literal("on-damage-roll") }).strict(),
  z.object({ type: z.literal("on-saving-throw") }).strict(),
  z.object({ type: z.literal("on-ability-check") }).strict(),
  z.object({ type: z.literal("on-initiative-roll") }).strict(),
  z.object({ type: z.literal("on-taking-damage") }).strict(),
  // ---- filters ----
  /** `spell` is an attack that casts a spell; `reaction` and `opportunity` match only when the resolver announces
   * that trigger. */
  z
    .object({
      type: z.literal("attack-kind-is"),
      kinds: z
        .array(z.enum(["melee", "ranged", "spell", "unarmed", "thrown", "reaction", "opportunity"]))
        .min(1)
        .max(7)
    })
    .strict(),
  z.object({ type: z.literal("weapon-property-is"), properties: z.array(RiderSlugSchema).min(1).max(12) }).strict(),
  z.object({ type: z.literal("damage-type-is"), damageTypes: z.array(DamageTypeSchema).min(1).max(12) }).strict(),
  z.object({ type: z.literal("ability-is"), abilities: z.array(AbilitySchema).min(1).max(6) }).strict(),
  z.object({ type: z.literal("skill-is"), skills: z.array(RiderSlugSchema).min(1).max(12) }).strict(),
  /** The school of the spell the action casts (`ActorAction.spellId`, looked up in the catalog). */
  z.object({ type: z.literal("spell-school-is"), schools: z.array(RiderSlugSchema).min(1).max(8) }).strict(),
  /** The level of the spell the action casts; 0 is a cantrip. */
  z
    .object({ type: z.literal("spell-level-is"), levels: z.array(z.number().int().min(0).max(9)).min(1).max(10) })
    .strict(),
  /** One specific spell ("when you cast Eldritch Blast"), matched against `ActorAction.spellId`. An action with no
   * `spellId` never matches. */
  z.object({ type: z.literal("spell-id-is"), spellIds: z.array(RiderSlugSchema).min(1).max(12) }).strict(),
  /** The target's creature type, read from its stat block; a character records none, so it never matches one. */
  z
    .object({ type: z.literal("versus-creature-type"), creatureTypes: z.array(RiderSlugSchema).min(1).max(12) })
    .strict(),
  z.object({ type: z.literal("versus-size"), sizes: z.array(SizeSchema).min(1).max(6) }).strict(),
  z.object({ type: z.literal("versus-condition"), conditionIds: z.array(ConditionSchema).min(1).max(6) }).strict()
]);
export type RiderTrigger = z.infer<typeof RiderTriggerSchema>;
export type RiderTriggerKind = "static-gate" | "dynamic-gate" | "moment" | "filter";

/** Decides a rider's layer: all static (or empty) = standing number; any dynamic gate = conditional; else momentary. */
export const RIDER_TRIGGER_KINDS: Readonly<Record<RiderTrigger["type"], RiderTriggerKind>> = Object.freeze({
  attuned: "static-gate",
  "while-armored": "static-gate",
  "while-unarmored": "static-gate",
  "while-shield": "static-gate",
  "while-character-is": "static-gate",
  "while-proficient-with": "static-gate",
  "while-effect-tag": "dynamic-gate",
  "while-hp-at-or-below": "dynamic-gate",
  "while-condition": "dynamic-gate",
  "on-attack-roll": "moment",
  "on-hit": "moment",
  "on-critical-hit": "moment",
  "on-damage-roll": "moment",
  "on-saving-throw": "moment",
  "on-ability-check": "moment",
  "on-initiative-roll": "moment",
  "on-taking-damage": "moment",
  "attack-kind-is": "filter",
  "weapon-property-is": "filter",
  "damage-type-is": "filter",
  "ability-is": "filter",
  "skill-is": "filter",
  "spell-school-is": "filter",
  "spell-level-is": "filter",
  "spell-id-is": "filter",
  "versus-creature-type": "filter",
  "versus-size": "filter",
  "versus-condition": "filter"
});

/** The moments the damage roll collects (`rollRiderDamage`). A damage rider gated on any other moment would never
 * fire, so content and homebrew refuse it. */
export const DAMAGE_ROLL_MOMENTS: readonly RiderTrigger["type"][] = Object.freeze([
  "on-hit",
  "on-critical-hit",
  "on-damage-roll"
]);

/** Which layer a `when` list belongs to; no list is standing. */
export function riderLayer(when: readonly RiderTrigger[] | undefined): "standing" | "conditional" | "momentary" {
  const kinds = (when ?? []).map((trigger) => RIDER_TRIGGER_KINDS[trigger.type]);
  if (kinds.some((kind) => kind === "moment" || kind === "filter")) return "momentary";
  if (kinds.some((kind) => kind === "dynamic-gate")) return "conditional";
  return "standing";
}

/** Rules shared by every `when` list, including the grant gate below. */
function checkSharedTriggerRules(triggers: readonly RiderTrigger[], context: z.RefinementCtx): void {
  const identity = triggers.find(
    (trigger) =>
      trigger.type === "while-character-is" && trigger.classIds.length === 0 && trigger.speciesIds.length === 0
  );
  if (identity)
    context.addIssue({
      code: "custom",
      message: "`while-character-is` needs at least one class or species."
    });
  const duplicate = triggers.find(
    (trigger, index) => triggers.findIndex((other) => other.type === trigger.type) !== index
  );
  if (duplicate)
    context.addIssue({
      code: "custom",
      message: `Two "${duplicate.type}" triggers on one rider - list the values in a single entry instead.`
    });
}

/** At most four triggers, ANDed, with at most one moment; a filter without a moment is rejected. */
export const RiderWhenSchema = z
  .array(RiderTriggerSchema)
  .max(4)
  .superRefine((triggers, context) => {
    const kinds = triggers.map((trigger) => RIDER_TRIGGER_KINDS[trigger.type]);
    if (kinds.filter((kind) => kind === "moment").length > 1) {
      context.addIssue({ code: "custom", message: "A rider fires at one moment, not two." });
    }
    if (kinds.includes("filter") && !kinds.includes("moment")) {
      context.addIssue({
        code: "custom",
        message: "A filter needs a moment to narrow - add the roll or event it applies to."
      });
    }
    checkSharedTriggerRules(triggers, context);
  });

/** The gate a grant may carry: static and dynamic gates only, since grants are collected before any roll.
 * No `.default([])`: used with `.optional()` so records without `when` parse unchanged. */
export const GrantWhenSchema = z
  .array(RiderTriggerSchema)
  .min(1)
  .max(4)
  .superRefine((triggers, context) => {
    const offender = triggers.find(
      (trigger) => RIDER_TRIGGER_KINDS[trigger.type] === "moment" || RIDER_TRIGGER_KINDS[trigger.type] === "filter"
    );
    if (offender) {
      context.addIssue({
        code: "custom",
        message: `A grant is a standing fact, so it cannot wait for a roll: "${offender.type}" is only knowable during one, and the grant has been collected before any roll starts. Gate it on a state instead - attuned, while-armored, while-unarmored, while-shield, while-character-is, while-proficient-with, while-effect-tag, while-hp-at-or-below, while-condition - or move the mechanic to a modifier, where a moment IS read.`
      });
    }
    checkSharedTriggerRules(triggers, context);
  });

/** The gate fields every modifier carries. No `when` means always. `scope` defaults by carrier: on an item with a
 * weapon block the attack/damage/crit riders mean "with this weapon", otherwise "the bearer". */
const riderGate = {
  when: RiderWhenSchema.optional(),
  scope: z.enum(["bearer", "this-item"]).optional()
} as const;

// ---- Modifiers: the one typed vocabulary every carrier shares ----

/**
 * What a feature, feat, chosen option, magic item or live effect contributes to the rules engine. One union for
 * every carrier, read by one evaluator (`collectRiders` in `@vtt/rules-5e`) against one context, so a bonus means
 * the same thing wherever it is authored. Bounded and grown additively; anything else stays prose (ADR-0008).
 * Amounts are signed, so a curse is a negative number. Carriers refuse what they cannot honour: see
 * `ITEM_REFUSED_MODIFIER_TYPES` (content) and `EFFECT_REFUSED_MODIFIER_TYPES`.
 */
export const ModifierSchema = z.discriminatedUnion("type", [
  // ---- the character ----
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
  /** Baked into the sheet's speed at build time on a feature; summed live on an effect, so it ends with it. */
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
  /** Display-level, like `darkvision`, until a senses model exists. */
  z
    .object({ type: z.literal("sense"), sense: RiderSlugSchema, feet: z.number().int().min(0).max(240), ...riderGate })
    .strict(),
  /** More magic items attuned at once than the SRD's three (Use Magic Device: four). Read when an item is attuned. */
  z.object({ type: z.literal("attunement-slots"), amount: z.number().int().min(1).max(3), ...riderGate }).strict(),
  /** One more use of a limited resource. `poolId` is the live `actionUses` key, not a `classResources` column. */
  z
    .object({
      type: z.literal("resource-bonus"),
      poolId: RiderSlugSchema,
      amount: z.number().int().min(-20).max(20),
      ...riderGate
    })
    .strict(),
  // ---- rolls ----
  z.object({ type: z.literal("attack-bonus"), amount: z.number().int().min(-10).max(10), ...riderGate }).strict(),
  /** A flat bonus to saving throws. Narrow it with `when: [{type: "on-saving-throw"}, {type: "ability-is", ...}]`. */
  z.object({ type: z.literal("save-bonus"), amount: z.number().int().min(-10).max(10), ...riderGate }).strict(),
  /** A flat bonus to ability and skill checks. Gloves of Thievery (+5 Sleight of Hand) is literally this. */
  z.object({ type: z.literal("check-bonus"), amount: z.number().int().min(-10).max(10), ...riderGate }).strict(),
  /** Advantage or disadvantage on a named roll; `aggregateRollMode` applies 5e cancellation. `concentration` is the
   * Constitution save that keeps a spell going. */
  z
    .object({
      type: z.literal("roll-mode"),
      roll: z.enum(["attack", "incoming-attack", "save", "check", "initiative", "concentration"]),
      mode: z.enum(["advantage", "disadvantage"]),
      ...riderGate
    })
    .strict(),
  // ---- damage and defence ----
  /** Flat damage, the other half of a "+1 weapon". Weapon-scoped by default on an item with a weapon block, so two
   * magic weapons never stack. Standing, it folds into the action's damage formula; on a moment it is its own line. */
  z.object({ type: z.literal("damage-bonus"), amount: z.number().int().min(-10).max(10), ...riderGate }).strict(),
  /** Extra typed damage as dice (`formula`), the bearer's ability modifier (`abilityModifier`), or both.
   * `damageType` absent takes the attack's own type (Empowered Evocation follows the spell). `doubleOnCritical`
   * defaults false: 5e does not double dice added after the attack. */
  z
    .object({
      type: z.literal("extra-damage"),
      formula: DiceFormulaSchema.optional(),
      abilityModifier: AbilitySchema.optional(),
      damageType: DamageTypeSchema.optional(),
      doubleOnCritical: z.boolean().default(false),
      ...riderGate
    })
    .strict(),
  /** Score a critical hit on this natural roll or higher (19-20 keen weapons). */
  z.object({ type: z.literal("critical-range"), threshold: z.number().int().min(15).max(20), ...riderGate }).strict(),
  /** Extra untyped weapon dice on a crit (Savage Attacks). A typed crit-only 1d6 fire is `extra-damage` + `when: [{on-critical-hit}]` instead. */
  z.object({ type: z.literal("critical-bonus-dice"), count: z.number().int().min(1).max(4), ...riderGate }).strict(),
  /** Flat reduction of incoming damage, after resistance. */
  z.object({ type: z.literal("damage-reduction"), amount: z.number().int().min(1).max(30), ...riderGate }).strict(),
  z
    .object({
      type: z.literal("damage-resistance"),
      damageTypes: z.array(DamageTypeSchema).min(1).max(13),
      ...riderGate
    })
    .strict(),
  /** The mirror of `damage-resistance`; `adjustDamageParts` applies the SRD rule that both together cancel out. */
  z
    .object({
      type: z.literal("damage-vulnerability"),
      damageTypes: z.array(DamageTypeSchema).min(1).max(13),
      ...riderGate
    })
    .strict(),
  // ---- spellcasting ----
  /** `classId` targets one caster on a multiclass sheet; absent = every caster the bearer has. */
  z
    .object({
      type: z.literal("spell-save-dc"),
      amount: z.number().int().min(-5).max(5),
      classId: RiderSlugSchema.optional(),
      ...riderGate
    })
    .strict(),
  z
    .object({
      type: z.literal("spell-attack-bonus"),
      amount: z.number().int().min(-5).max(5),
      classId: RiderSlugSchema.optional(),
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
    .strict()
]);
export type Modifier = z.infer<typeof ModifierSchema>;

/**
 * Modifiers an effect may not carry: each is a number stored on the sheet or the actor (hit points, AC, initiative,
 * slot maxima, senses), written when the character is built or its inventory changes, so an effect that ends could
 * never give it back.
 */
export const EFFECT_REFUSED_MODIFIER_TYPES: readonly Modifier["type"][] = Object.freeze([
  "attunement-slots",
  "ability-score",
  "hit-points-per-level",
  "armor-class",
  "initiative",
  "unarmored-defense",
  "darkvision",
  "sense",
  "spell-slot"
]);

/** An effect's modifiers: the shared vocabulary, minus what an effect cannot give back when it ends. */
export const EffectModifiersSchema = z
  .array(ModifierSchema)
  .max(8)
  .superRefine((modifiers, context) => {
    modifiers.forEach((modifier, index) => {
      if (EFFECT_REFUSED_MODIFIER_TYPES.includes(modifier.type))
        context.addIssue({
          code: "custom",
          path: [index, "type"],
          message: `An effect cannot carry "${modifier.type}": it is written onto the sheet, so it would outlast the effect. Put it on a feature, a feat or an item instead.`
        });
    });
  });

/** What happens when an effect ends (Frenzy: one level of Exhaustion when the rage ends). */
export const EffectOnEndSchema = z
  .object({
    type: z.literal("condition"),
    conditionId: ConditionIdSchema,
    level: z.number().int().min(1).max(6).optional()
  })
  .strict();

/** A live rules-engine effect on an actor (Rage, a grapple), with source links, duration and typed modifiers.
 * Ids derive from the commandId so retries mint the same effect. */
export const EffectInstanceSchema = z
  .object({
    id: z.string().min(1).max(120),
    name: z.string().min(1).max(120),
    tags: z.array(EffectTagSchema).max(8).default([]),
    /** Who sustains/caused it; stripped from player projections. Null for GM-added house effects. */
    sourceActorId: z.uuid().nullable().default(null),
    sourceName: z.string().max(120).nullable().default(null),
    sourceActionId: z.string().max(120).nullable().default(null),
    startedRound: z.number().int().positive().default(1),
    duration: z.discriminatedUnion("type", [
      z.object({ type: z.literal("rounds"), remaining: z.number().int().min(0).max(100) }).strict(),
      z.object({ type: z.literal("until-source-next-turn") }).strict(),
      z.object({ type: z.literal("encounter") }).strict(),
      z.object({ type: z.literal("manual") }).strict()
    ]),
    /** Grapples etc.: the effect ends when its source actor drops to 0 HP or leaves the roster. */
    endsWhenSourceDefeated: z.boolean().default(false),
    /** Dodge: the effect's modifiers stop applying while the bearer is incapacitated (SRD). */
    voidWhileIncapacitated: z.boolean().default(false),
    /** The source actor concentrates to sustain this (SRD Concentration): one at a time; damage prompts a CON save; incapacitation breaks it. */
    concentration: z.boolean().default(false),
    /** Cascade: this effect ends when the actor no longer has any other effect carrying this tag (Frenzy's marker ends with the Rage). */
    endsWithTag: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(40)
      .nullable()
      .default(null),
    /** SRD "Combining Game Effects": instances sharing a key are one effect, so readers take the most potent
     * contribution instead of summing (two Slows are -10, not -20). Absent or different keys sum. */
    stackKey: z
      .string()
      .regex(/^[a-z0-9:-]+$/)
      .max(60)
      .optional(),
    /** Extra movement granted for the current turn, fixed when granted (Dash), so a later Slow does not rewrite it.
     * On a `dashing` effect without it, `effectiveSpeedFeet` falls back to doubling Speed. */
    movementGrantFeet: z.number().int().min(0).max(999).optional(),
    /** A reaction's lasting AC bonus (Shield: +5 until the caster's next turn), added to the stored AC while the
     * effect lasts. Kept apart from `modifiers`, whose `armor-class` is written onto the sheet and would outlast it. */
    armorClassBonus: z.number().int().min(1).max(10).optional(),
    modifiers: EffectModifiersSchema.default([]),
    /** Conditions this effect applied to the same actor; removed automatically when the effect ends. */
    linkedConditionIds: z.array(ConditionIdSchema).max(4).default([]),
    /** Shown as "Escape DC 15"; ending the effect on escape is manual. */
    escapeDc: z.number().int().min(1).max(40).nullable().default(null),
    onEnd: z.array(EffectOnEndSchema).max(2).default([])
  })
  .strict();
export type EffectInstance = z.infer<typeof EffectInstanceSchema>;

/** Death-save state while a player character is dying at 0 HP; null when not dying. 3 successes → stable, 3 failures → dead. */
export const DeathSavesSchema = z
  .object({
    successes: z.number().int().min(0).max(3),
    failures: z.number().int().min(0).max(3),
    stable: z.boolean().default(false)
  })
  .strict();
export type DeathSaves = z.infer<typeof DeathSavesSchema>;

/** How a token's health shows on the map. `band` is the coarse badge everyone sees; other styles are gated by
 * `audience`, and only the GM and owner ever get exact fill. */
export const HealthDisplayStyleSchema = z.enum(["band", "bar", "ring", "aura"]);
export const HealthDisplayAudienceSchema = z.enum(["gm", "all"]);
export const HealthDisplaySchema = z
  .object({ style: HealthDisplayStyleSchema, audience: HealthDisplayAudienceSchema })
  .strict();
export type HealthDisplayStyle = z.infer<typeof HealthDisplayStyleSchema>;
export type HealthDisplayAudience = z.infer<typeof HealthDisplayAudienceSchema>;
export type HealthDisplay = z.infer<typeof HealthDisplaySchema>;

/** SRD skill id slug ("stealth", "arcana"); free-form so homebrew stays expressible. */
const SkillIdSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .max(60);
/** Armor/weapon/tool/language proficiency slug ("light", "martial", "thieves-tools", "elvish"); open by design. */
const ProficiencyIdSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .max(60);
/** What an Ammunition weapon fires (SRD Weapons table: "Ammunition (Range 150/600; Arrow)"). The table's one
 *  "Bullet" is two items, so a Sling's and a firearm's are told apart. */
export const AmmunitionKindSchema = z.enum(["arrow", "bolt", "firearm-bullet", "needle", "sling-bullet"]);
export type AmmunitionKind = z.infer<typeof AmmunitionKindSchema>;
/** Mechanical stats of an item added from the SRD catalog (weapon → attack action, armor/shield → derived AC).
 * Absent on homebrew or older items, which are then display-only. */
export const ItemWeaponSchema = z
  .object({
    category: z.enum(["simple", "martial"]),
    damageDice: z.string().min(1).max(20),
    damageType: z.string().min(1).max(40),
    rangeFeet: z.number().int().positive().nullable(),
    longRangeFeet: z.number().int().positive().nullable(),
    /** The Weapons table's band, copied from the catalog: a thrown Dagger is a melee weapon, a Dart a ranged one.
     *  Absent = read from the range and Thrown, as before the band was recorded. */
    melee: z.boolean().optional(),
    /** A Versatile weapon's two-handed die ("1d10" for a Longsword), copied from the catalog. */
    versatileDice: z.string().min(1).max(20).optional(),
    /** SRD weapon property slugs ("finesse", "thrown", ...), open for homebrew. Absent = not recorded; an empty array = no properties. */
    properties: z
      .array(
        z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .max(40)
      )
      .max(12)
      .optional()
  })
  .strict();
export const ItemArmorSchema = z
  .object({
    acBase: z.number().int().min(2).max(25),
    addDexModifier: z.boolean(),
    dexModifierCap: z.number().int().nullable(),
    stealthDisadvantage: z.boolean(),
    strengthRequired: z.number().int().nullable()
  })
  .strict();
/** Non-secret magic-item marker for the sheet's Attune control. Never put riders, casts or a `cursed` flag here:
 * the owner receives their inventory verbatim. Mechanics resolve server-side by `item.id`. */
export const ItemMagicMarkerSchema = z
  .object({
    isMagic: z.boolean().default(false),
    attunementRequired: z.boolean().default(false),
    slot: ItemSlotSchema.optional()
  })
  .strict();
/** One carried inventory item; quantity, equipped and attuned change during play. */
export const InventoryItemSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80),
    name: z.string().min(1).max(120),
    quantity: z.number().int().min(0).max(9999).default(1),
    equipped: z.boolean().default(false),
    attuned: z.boolean().default(false),
    weightEach: z.number().nonnegative().max(1_000_000).optional(),
    /** The catalog text copied on add; as long as `EquipmentReferenceSchema.description` allows. */
    description: z.string().max(12000).optional(),
    /** Equipment category slug (weapon/armor/tool/...), open for homebrew. Drives sheet grouping. */
    category: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(40)
      .optional(),
    /** The catalog record this row is a copy of, when the row's own id can't be it: a second Weapon, +1 bound to
     *  another base is its own row (`weapon-1-2`) with `recordId: "weapon-1"`. Absent means the id is the record. */
    recordId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80)
      .optional(),
    /** The base a template magic item is bound to ("dwarven-thrower" -> "warhammer"). The server validates it and
     * overwrites `weapon`/`armor` with the base's stats; weapon stats are never trusted from a client. */
    baseId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80)
      .optional(),
    weapon: ItemWeaponSchema.optional(),
    armor: ItemArmorSchema.optional(),
    /** The type the GM picked for an item whose record lets the GM choose its resistance (Ring of Resistance). Only
     *  the GM sets it; the server checks it against the record's `damageTypeChoice`. */
    chosenDamageType: DamageTypeSchema.optional(),
    /** Ammunition pieces left in a row sold in bundles ("Arrows (20)"), when some are spent; absent = every bundle
     *  full. The server keeps it: shots spend it and a quantity change moves it by whole bundles. */
    ammunitionLeft: z.number().int().min(0).max(1_000_000).optional(),
    /** Pieces fired from this row in the running fight that can be picked up after it (half come back). The
     *  server keeps it. */
    ammunitionFired: z.number().int().min(0).max(10_000).optional(),
    /** Display-only marker so the sheet can offer Attune without the catalog; never the riders. */
    magic: ItemMagicMarkerSchema.optional()
  })
  .strict();
export type InventoryItem = z.infer<typeof InventoryItemSchema>;

/** The catalog id an inventory row is a copy of: its `recordId`, else its own id. Every catalog lookup reads this. */
export function catalogIdOf(item: Readonly<{ id: string; recordId?: string | undefined }>): string {
  return item.recordId ?? item.id;
}
export const CurrencySchema = z
  .object({
    cp: z.number().int().min(0).max(1_000_000).default(0),
    sp: z.number().int().min(0).max(1_000_000).default(0),
    ep: z.number().int().min(0).max(1_000_000).default(0),
    gp: z.number().int().min(0).max(1_000_000).default(0),
    pp: z.number().int().min(0).max(1_000_000).default(0)
  })
  .strict();
export type Currency = z.infer<typeof CurrencySchema>;
/** A live spell-slot pool for one slot level (remaining out of the definition's maximum). */
export const SpellSlotSchema = z
  .object({ level: z.number().int().min(1).max(9), remaining: z.number().int().min(0).max(9) })
  .strict();

/** Faces per hit-die size, so a mixed pool can name its largest die without a second lookup table. */
const HIT_DIE_FACES: Readonly<Record<string, number>> = Object.freeze({
  d4: 4,
  d6: 6,
  d8: 8,
  d10: 10,
  d12: 12,
  d20: 20
});

/** One die size in a Hit Point Dice pool: a Fighter 3 / Wizard 2 has a 3×d10 entry and a 2×d6 entry. */
export const HitDiceEntrySchema = z
  .object({
    die: z.enum(["d4", "d6", "d8", "d10", "d12", "d20"]),
    maximum: z.number().int().min(1).max(40),
    remaining: z.number().int().min(0).max(40)
  })
  .strict();
export type HitDiceEntry = z.infer<typeof HitDiceEntrySchema>;

/**
 * Normalise accepted Hit Dice inputs to the pool shape (ADR-0007 additive growth):
 *   - `{die, maximum, remaining}`             — an older single-die save.
 *   - `[{die, maximum, remaining}, …]`        — a bare pool array.
 *   - `{die, maximum, remaining, entries[]}`  — the current shape; the summary is re-derived, never trusted.
 * Malformed input passes through so Zod reports the real error.
 */
function normaliseHitDicePool(input: unknown): unknown {
  if (input === null || input === undefined || typeof input !== "object") return input;
  // `"entries" in []` is true (Array.prototype.entries), so settle arrays first and check for an own property.
  let source: unknown[];
  if (Array.isArray(input)) source = input;
  else if (Object.prototype.hasOwnProperty.call(input, "entries")) {
    const carried = (input as { entries: unknown }).entries;
    if (!Array.isArray(carried)) return input;
    source = carried;
  } else source = [input];
  if (source.length === 0) return input;
  const entries: unknown[] = [];
  let maximum = 0;
  let remaining = 0;
  let largestFaces = -1;
  let die: unknown;
  for (const candidate of source) {
    if (candidate === null || typeof candidate !== "object") return input;
    const { die: entryDie, maximum: entryMaximum, remaining: entryRemaining } = candidate as Record<string, unknown>;
    if (typeof entryDie !== "string" || typeof entryMaximum !== "number" || typeof entryRemaining !== "number")
      return input;
    entries.push({ die: entryDie, maximum: entryMaximum, remaining: entryRemaining });
    maximum += entryMaximum;
    remaining += entryRemaining;
    const faces = HIT_DIE_FACES[entryDie] ?? 0;
    if (faces > largestFaces) {
      largestFaces = faces;
      die = entryDie;
    }
  }
  return { die, maximum, remaining, entries };
}

/** A live Hit Point Dice pool. `entries` is the truth, one per die size; `die`/`maximum`/`remaining` are a summary
 * recomputed on every parse. Build pools with `makeHitDicePool`. */
export const HitDicePoolSchema = z.preprocess(
  normaliseHitDicePool,
  z
    .object({
      die: HitDiceEntrySchema.shape.die,
      maximum: z.number().int().min(1).max(240),
      remaining: z.number().int().min(0).max(240),
      entries: z.array(HitDiceEntrySchema).min(1).max(6)
    })
    .strict()
    .nullable()
);
export type HitDicePool = NonNullable<z.infer<typeof HitDicePoolSchema>>;

/** Build a pool (summary included) from per-die entries. An empty pool is `null` — "not modeled". */
export function makeHitDicePool(entries: readonly HitDiceEntry[]): HitDicePool | null {
  return entries.length === 0 ? null : (HitDicePoolSchema.parse(entries) as HitDicePool);
}

export const ActorSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  kind: z.enum(["player-character", "monster", "npc"]),
  visibility: z.enum(["public", "gm-only"]).default("public"),
  hp: z.object({
    current: z.number().int(),
    maximum: z.number().int().positive(),
    temporary: z.number().int().nonnegative().default(0)
  }),
  armorClass: z.number().int().positive().optional(),
  /** A GM-set Armor Class that `armorClass` takes in place of the one derived from equipment, until cleared (a stat
   *  the sheet can't derive: Mage Armor, natural armor, a ruling). The sheet shows it as set by the GM. */
  armorClassOverride: z.number().int().min(1).max(40).optional(),
  initiative: z.number().int().optional(),
  ownerSessionId: z.uuid().nullable().default(null),
  notes: z.string().max(10000).optional(),
  /** Slug of the definition this actor was instantiated from (content-bundle or imported id); absent for seeded actors. */
  definitionId: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(200)
    .optional(),
  /** Token footprint in grid cells per side (large 2, huge 3, gargantuan 4); absent means 1. */
  sizeCells: z.number().int().min(1).max(4).optional(),
  /** D&D creature size label; drives sizeCells and lets the GM pick Tiny/Small/Medium (all 1×1). Absent means Medium. */
  size: z.enum(["tiny", "small", "medium", "large", "huge", "gargantuan"]).optional(),
  /** Custom uploaded token image (a token-asset id); absent means the initials glyph. */
  tokenAssetId: z.uuid().optional(),
  /** Active conditions by content-bundle id; `level` applies only to exhaustion (1-6). Set by the GM or by the rules engine (ADR-0020). */
  conditions: z
    .array(
      z
        .object({
          id: z
            .string()
            .regex(/^[a-z0-9-]+$/)
            .max(60),
          level: z.number().int().min(1).max(6).optional()
        })
        .strict()
    )
    .max(20)
    .default([]),
  /** Live rules-engine effects (Rage, a grapple holding this actor). */
  effects: z.array(EffectInstanceSchema).max(20).default([]),
  /** Dying state at 0 HP (player characters only); null when not dying. */
  deathSaves: DeathSavesSchema.nullable().default(null),
  /** Spent limited-use counts by action id. */
  actionUses: z.record(z.string(), z.number().int().nonnegative()).default({}),
  /** Picks re-made on a rest, keyed by offer key; no rebuild needed. `per` is the rest that clears the override,
   * after which the build's recorded answer applies again. */
  choiceOverrides: z
    .record(
      z.string(),
      z
        .object({
          id: z
            .string()
            .regex(/^[a-z0-9-]+$/)
            .max(80),
          per: z.enum(["short-rest", "long-rest"])
        })
        .strict()
    )
    .default({}),
  /** Conditions this actor is immune to (seeded from its definition). GM knowledge, stripped from player projections. */
  conditionImmunities: z.array(ConditionIdSchema).max(20).default([]),
  /** Walking speed in feet (seeded from the definition, GM-editable). Absent = unknown, so movement rules skip. */
  speedFeet: z.number().int().min(0).max(500).optional(),
  /** Legendary actions per round and Legendary Resistance per day (SRD 2024). GM knowledge, stripped from player projections. */
  legendary: z
    .object({
      actionsPerRound: z.number().int().min(1).max(5).optional(),
      resistancesPerDay: z.number().int().min(1).max(6).optional()
    })
    .strict()
    .optional(),
  /** Short-rest healing pool (SRD Hit Point Dice); null = not modeled. Reaches players only on their own claimed character. */
  hitDice: HitDicePoolSchema.default(null),
  /** Per-token health-display override; absent = inherit `combat.healthDisplay`. Audience-gated in the player/viewer projections. */
  healthDisplay: HealthDisplaySchema.optional(),
  /** Epoch ms when this actor last entered a fight; powers the scene-setup "Recent" list. GM-only, stripped from the player projection. */
  lastUsedAt: z.number().int().nonnegative().optional(),
  /** Live spell-slot pools by level, restored by rests; null = not a modeled spellcaster. Owner-only in projections. */
  spellSlots: z.array(SpellSlotSchema).max(9).nullable().default(null),
  /** Warlock Pact Magic pool (one level, uniform slots); null = none. Owner-only in projections. */
  pactSlots: z
    .object({ level: z.number().int().min(1).max(5), remaining: z.number().int().min(0).max(4) })
    .strict()
    .nullable()
    .default(null),
  /** Spell ids prepared right now, re-chosen on a long rest. Owner-only. */
  preparedSpellIds: z.array(z.string().max(80)).max(400).default([]),
  /** Carried inventory, seeded from the definition's starting loadout. Owner-only. */
  inventory: z.array(InventoryItemSchema).max(200).default([]),
  /** Coin purse, seeded from the definition's starting currency. Owner-only. */
  currency: CurrencySchema.prefault({}),
  /** GM-archived: hidden from players and excluded from the encounter builder and party. Never projected to players or the viewer. */
  archived: z.boolean().default(false),
  /** Set on a launched replay's cloned combatant: the replay scene's id. `rosterActors` hides these from management
   * surfaces; they are deleted with the replay scene. */
  replaySceneId: z.uuid().optional(),
  /** The GM shared this archived character's sheet with players as a read-only keepsake. The flag itself is
   * stripped from player projections; players get only the id-and-name `PlayerView.archivedCharacters`. */
  sheetPreview: z.boolean().default(false)
});

export type Actor = z.infer<typeof ActorSchema>;

/** Immutable reusable content imported from JSON; mutable HP/position/ownership live elsewhere. */
export const ACTOR_DEFINITION_SCHEMA_VERSION = 1;
// `DiceFormulaSchema` and `AbilitySchema` are declared at the top because the shared rider variants need them.
/** SRD hit die by class (d4-d12); shared by per-class hit dice and content records. */
export const HitDieSchema = z.enum(["d4", "d6", "d8", "d10", "d12"]);
export type HitDie = z.infer<typeof HitDieSchema>;
/** Definition-side effect grant (Rage, Reckless Attack): resolving the action creates this effect on the actor itself. */
export const EffectGrantSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    tags: z.array(EffectTagSchema).min(1).max(8),
    duration: z.discriminatedUnion("type", [
      z.object({ type: z.literal("rounds"), rounds: z.number().int().min(1).max(100) }).strict(),
      z.object({ type: z.literal("until-source-next-turn") }).strict(),
      z.object({ type: z.literal("encounter") }).strict(),
      z.object({ type: z.literal("manual") }).strict()
    ]),
    modifiers: EffectModifiersSchema.default([]),
    onEnd: z.array(EffectOnEndSchema).max(2).default([]),
    /** The granted effect ends when the actor loses every other effect with this tag (Frenzy's marker ends with the Rage). */
    endsWithTag: EffectTagSchema.optional(),
    /** Who receives the effect: the acting creature (default) or the action's single chosen target (Help). */
    target: z.enum(["self", "target"]).default("self"),
    /** Dodge: benefits lapse while the bearer is incapacitated (SRD). */
    voidWhileIncapacitated: z.boolean().default(false),
    /** The granter concentrates to sustain the effect (SRD Concentration). */
    concentration: z.boolean().default(false)
  })
  .strict();

/** Limited uses. "turn"/"encounter"/rests reset as named; "recharge" on a start-of-turn d6 >= `recharge`.
 * `pool` shares one counter across actions (Sneak Attack once per turn regardless of weapon). */
export const ActionUsesSchema = z
  .object({
    limit: z.number().int().min(1).max(20),
    per: z.enum(["turn", "encounter", "long-rest", "short-rest", "recharge"]),
    pool: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(60)
      .optional(),
    recharge: z.number().int().min(2).max(6).optional()
  })
  .strict()
  .superRefine((uses, context) => {
    if (uses.per === "recharge" && uses.recharge === undefined)
      context.addIssue({
        code: "custom",
        path: ["recharge"],
        message: 'Recharge uses need the d6 threshold (e.g. 5 for "Recharge 5-6").'
      });
    if (uses.per !== "recharge" && uses.recharge !== undefined)
      context.addIssue({
        code: "custom",
        path: ["recharge"],
        message: 'The recharge threshold only applies when per is "recharge".'
      });
  });

/** The conditions a failed save can impose. Closed because the engine applies the id itself. Exhaustion is
 * left out: it stacks by level, and a plain condition write would reset it rather than add one. */
export const SaveConditionSchema = z.enum([
  "blinded",
  "charmed",
  "deafened",
  "frightened",
  "grappled",
  "incapacitated",
  "paralyzed",
  "petrified",
  "poisoned",
  "prone",
  "restrained",
  "stunned",
  "unconscious"
]);
export type SaveCondition = z.infer<typeof SaveConditionSchema>;

/**
 * What a saving throw does, as data: the damage a success takes ("half" for Fireball, "none" for Sacred
 * Flame) and the condition a failure imposes. Every save block (stat-block action, feature action, spell)
 * spreads these fields. Unset, they take the common printing: half damage on a success, no condition.
 */
export const SaveOutcomeFields = {
  successDamage: z.enum(["half", "none"]).default("half"),
  /** Every condition a failed save imposes (Turn Undead: Frightened and Incapacitated). */
  failureConditions: z.array(SaveConditionSchema).max(4).default([])
};

/** An area of effect the GM places as a map template ("60-foot Cone"). `widthFeet` is a line's width, null otherwise. */
export const ActionAreaSchema = z
  .object({
    shape: z.enum(["cone", "line", "sphere", "cube", "emanation"]),
    sizeFeet: z.number().int().min(1).max(1000),
    widthFeet: z.number().int().min(1).max(100).nullable()
  })
  .strict();
export type ActionArea = z.infer<typeof ActionAreaSchema>;

const ReactionRangeFeet = z.number().int().min(5).max(1000).optional();

/**
 * A reaction the engine offers as a prompt when its trigger happens (ADR-0020); only meaningful on activation
 * "reaction". The response is what answering "use" does:
 * - half-damage (Uncanny Dodge): halve the hit's damage.
 * - ac-bonus (Parry, Shield): add `amount` to AC against the attack before it lands, possibly turning the hit into a
 *   miss. `melee` limits it to melee attacks; `untilNextTurn` keeps the bonus until the reactor's next turn starts.
 * - strike-back (Hellish Rebuke, Storm's Thunder): resolve this action against the creature that dealt the damage.
 * - melee-attack (Retaliation): make one melee attack against that creature instead.
 * `rangeFeet` skips the prompt when the map shows the damaging creature farther away.
 */
export const ActionReactionSchema = z.discriminatedUnion("response", [
  z.object({ trigger: z.literal("hit-by-attack"), response: z.literal("half-damage") }).strict(),
  z
    .object({
      trigger: z.literal("hit-by-attack"),
      response: z.literal("ac-bonus"),
      amount: z.number().int().min(1).max(10),
      melee: z.boolean().optional(),
      untilNextTurn: z.boolean().optional()
    })
    .strict(),
  z
    .object({
      trigger: z.literal("damaged-by-creature"),
      response: z.literal("strike-back"),
      rangeFeet: ReactionRangeFeet
    })
    .strict(),
  z
    .object({
      trigger: z.literal("damaged-by-creature"),
      response: z.literal("melee-attack"),
      rangeFeet: ReactionRangeFeet
    })
    .strict()
]);
export type ActionReaction = z.infer<typeof ActionReactionSchema>;

/** Mechanics fields are optional (ADR-0020): absent means prose only. Descriptions stay the display source of truth. */
export const ActionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(120),
  activation: z.enum(["action", "bonus-action", "reaction", "other"]),
  description: z.string().min(1).max(12000),
  attack: z
    .object({
      bonus: z.number().int(),
      reachFeet: z.number().int().positive().optional(),
      rangeFeet: z.number().int().positive().optional(),
      /** Normal range in feet for a two-range weapon ("80/320" → 80); attacks beyond it up to rangeFeet roll at disadvantage (SRD Range). */
      rangeNormalFeet: z.number().int().positive().optional(),
      /** Attack rolls this action grants (Extra Attack 2, Eldritch Blast beams). Absent = 1. */
      count: z.number().int().min(1).max(10).optional(),
      /** Extra weapon dice on a critical hit beyond crit doubling (Savage Attacks). Applies to the first damage part. */
      criticalBonusDice: z.number().int().min(1).max(4).optional()
    })
    .optional(),
  save: z
    .object({
      ability: AbilitySchema,
      dc: z.number().int().min(1).max(40),
      /** The DC is the bearer's spell save DC (a spell, or a feature that uses it), so a `spell-save-dc` rider
       *  raises it. Absent: a printed DC that no rider touches (a breath weapon, a wand's DC 15). */
      spellcasting: z.boolean().optional(),
      ...SaveOutcomeFields
    })
    .optional(),
  damage: z
    .array(z.object({ formula: DiceFormulaSchema, type: z.string().min(1).max(40) }))
    .max(8)
    .default([]),
  /** Hit points each target regains, rolled once and applied when the action resolves (Cure Wounds). */
  healing: z.object({ formula: HealingFormulaSchema }).strict().optional(),
  /** Compound action: one shared action slot, components tracked (crocodile Multiattack = one Bite + one Tail). */
  multiattack: z
    .array(z.object({ actionId: z.string().regex(/^[a-z0-9-]+$/), count: z.number().int().min(1).max(4) }).strict())
    .min(1)
    .max(4)
    .optional(),
  /** On-hit conditions applied to the target as one source-linked effect (Bite: Grappled + Restrained, escape DC 15). */
  onHit: z
    .array(
      z
        .object({
          conditions: z
            .array(z.object({ id: ConditionIdSchema, level: z.number().int().min(1).max(6).optional() }).strict())
            .min(1)
            .max(3),
          escapeDc: z.number().int().min(1).max(40).optional(),
          /** The rider only applies to targets of at most this size (crocodile Bite: large). */
          maxTargetSize: z.enum(["tiny", "small", "medium", "large", "huge", "gargantuan"]).optional()
        })
        .strict()
    )
    .max(2)
    .optional(),
  /** Targeting restrictions the engine enforces (Tail can't target the creature this crocodile grapples). */
  targetRules: z
    .array(z.enum(["not-grappled-by-source"]))
    .max(2)
    .optional(),
  /** Resolving this action grants an effect to the actor itself (Rage, Reckless Attack). */
  grants: EffectGrantSchema.optional(),
  /** The action requires an active self effect carrying this tag (Frenzy requires "raging"). */
  requiresEffectTag: EffectTagSchema.optional(),
  uses: ActionUsesSchema.optional(),
  /** Resolving this action also spends one of the bearer's spell slots of this level ("expend a spell slot to cast
   * it from the staff"). Checked and spent by the limited-uses economy pass, so a preview never spends. */
  spellSlot: z
    .object({ level: z.number().int().min(1).max(9) })
    .strict()
    .optional(),
  /** The spell this action casts; identity only, matched by `spell-id-is` gates. Set on actions synthesised from
   * an item's `casts`, or directly on a feature action. Absent = not a spell. */
  spellId: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(80)
    .optional(),
  /** Declared reaction the engine can offer as a pending prompt; see `ActionReactionSchema`. */
  reaction: ActionReactionSchema.optional(),
  /** Minted by the engine from an equipped weapon, not authored: the Light property's extra attack (`light`), or
   *  Cleave's swing at a second creature (`cleave`), made with the inventory item `itemId`. */
  extraAttack: z
    .object({
      kind: z.enum(["light", "cleave"]),
      itemId: z
        .string()
        .regex(/^[a-z0-9-]+$/)
        .max(120)
    })
    .strict()
    .optional(),
  /** SRD Legendary Action: taken on other creatures' turns, spending `cost` from the per-round pool that refills on the creature's own turn. Pairs with activation "other". */
  legendary: z
    .object({ cost: z.number().int().min(1).max(5) })
    .strict()
    .optional(),
  /** The area it covers, for the map template. Filled from the description where the action enters the system
   *  (the content build, a homebrew save, an import), so play never reads the prose. */
  area: ActionAreaSchema.optional(),
  /** A Multiattack whose attacks the build could not read: the engine cannot track them against the action, so
   *  the creature's action-slot checks soften to notes. */
  untrackedMultiattack: z.literal(true).optional()
});

export type ActorAction = z.infer<typeof ActionSchema>;

/** One recorded build decision; every wizard pick writes a row, and level-up and respec prefill from them.
 * `kind` and `id` are open slugs. */
export const CharacterChoiceSchema = z
  .object({
    /** Character level the decision belongs to (1-20); 1 for species/background/origin choices. */
    level: z.number().int().min(1).max(20),
    /** Class the decision belongs to; absent for species/background/origin choices. */
    classId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(60)
      .optional(),
    kind: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(60),
    /** The option that was chosen: a content id, an ability id for an ASI, a skill id, ... */
    id: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80),
    /** Free-form rider carrying the decision's detail (ASI splits, the feature that offered the pick, the list it came from). */
    payload: z.record(z.string(), z.unknown()).optional()
  })
  .strict();
export type CharacterChoice = z.infer<typeof CharacterChoiceSchema>;

/** Character identity: the builder's inputs. Total level is derived from `classes`, never stored. */
export const CharacterIdentitySchema = z
  .object({
    classes: z
      .array(
        z
          .object({
            id: z
              .string()
              .regex(/^[a-z0-9-]+$/)
              .max(60),
            name: z.string().min(1).max(60),
            subclass: z
              .object({
                id: z
                  .string()
                  .regex(/^[a-z0-9-]+$/)
                  .max(60),
                name: z.string().min(1).max(60)
              })
              .strict()
              .optional(),
            level: z.number().int().min(1).max(20),
            /** This class's hit die, so a multiclass sheet can pool 3d10 + 2d6. Absent = fall back to the definition's hit-point formula. */
            hitDie: HitDieSchema.optional()
          })
          .strict()
      )
      .max(4)
      .default([]),
    race: z
      .object({
        id: z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .max(60),
        name: z.string().min(1).max(60),
        subrace: z
          .object({
            id: z
              .string()
              .regex(/^[a-z0-9-]+$/)
              .max(60),
            name: z.string().min(1).max(60)
          })
          .strict()
          .optional()
      })
      .strict()
      .optional(),
    background: z
      .object({
        id: z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .max(60),
        name: z.string().min(1).max(60)
      })
      .strict()
      .optional(),
    feats: z
      .array(
        z
          .object({
            id: z
              .string()
              .regex(/^[a-z0-9-]+$/)
              .max(60),
            name: z.string().min(1).max(80),
            description: z.string().max(4000).optional()
          })
          .strict()
      )
      .max(40)
      .default([]),
    /** Monk Martial Arts at this level (SRD 5.2.1): while unarmoured and without a shield, Monk weapons (Simple melee,
     * and Martial melee with the Light property) use the better of Str or Dex and may roll `die` in place of their own. */
    martialArts: z
      .object({ die: z.string().regex(/^1d(?:4|6|8|10|12)$/) })
      .strict()
      .optional(),
    /** Feature records this sheet holds (class, subclass, species, lineage, background, chosen options) so their
     * roll-time riders apply as feats' do. Ids only; riders are recomputed from the catalog on every read.
     * `kind` + `sourceId` locate the record (class feature ids are unique only per class). */
    features: z
      .array(
        z
          .object({
            id: z
              .string()
              .regex(/^[a-z0-9-]+$/)
              .max(80),
            kind: z.enum(["class", "subclass", "species", "lineage", "background", "option"]),
            /** The record the feature was looked up in: a class/subclass/species/background id, or the parent feature id for an inline option. */
            sourceId: z
              .string()
              .regex(/^[a-z0-9-]+$/)
              .max(80)
          })
          .strict()
      )
      .max(80)
      .optional(),
    /** The choice-provenance ledger (see CharacterChoiceSchema). Absent means no provenance (PDF import or
     * pre-wizard character), which respec must tell apart from an empty ledger. Use `characterChoices()` for a list. */
    choices: z.array(CharacterChoiceSchema).max(200).optional()
  })
  .strict();

/** Save/skill proficiency selections. `*Overrides` carry final totals for imports that don't encode selections;
 * the server resolves `override ?? selection-derived ?? ability-only`. */
export const ProficienciesSchema = z
  .object({
    saves: z.array(AbilitySchema).max(6).default([]),
    skills: z
      .array(z.object({ id: SkillIdSchema, proficiency: z.enum(["proficient", "expertise"]) }).strict())
      .max(40)
      .default([]),
    saveOverrides: z.partialRecord(AbilitySchema, z.number().int().min(-20).max(30)).optional(),
    skillOverrides: z.record(SkillIdSchema, z.number().int().min(-20).max(30)).optional(),
    /** Armor/weapon/tool/language training as open slugs. Absent means "not recorded", not "none": an import that
     * never listed armor training must not read as untrained. */
    armor: z.array(ProficiencyIdSchema).max(20).optional(),
    /** Weapon proficiencies: a group ("simple", "martial") or a single weapon id ("longsword"). */
    weapons: z.array(ProficiencyIdSchema).max(60).optional(),
    tools: z.array(ProficiencyIdSchema).max(40).optional(),
    languages: z.array(ProficiencyIdSchema).max(30).optional()
  })
  .strict();

const SpellSlotMaxSchema = z
  .object({ level: z.number().int().min(1).max(9), max: z.number().int().min(0).max(9) })
  .strict();
const PactSlotMaxSchema = z
  .object({ level: z.number().int().min(1).max(5), max: z.number().int().min(0).max(4) })
  .strict();

/** One spellcasting class on a multiclass sheet (Paladin 6 / Wizard 4 casts off CHA and INT). `slots`/`prepared`
 * are the per-class breakdown for rebuilds; the live pool is the top-level `slots`/`pact`. */
export const ClassSpellcastingSchema = z
  .object({
    classId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(60),
    ability: AbilitySchema,
    saveDc: z.number().int().min(1).max(40).optional(),
    attackBonus: z.number().int().min(-5).max(30).optional(),
    slots: z.array(SpellSlotMaxSchema).max(9).optional(),
    /** How many spells this class prepares (SRD prepared casters); absent for known casters. */
    prepared: z.number().int().min(0).max(60).optional()
  })
  .strict();
export type ClassSpellcasting = z.infer<typeof ClassSpellcastingSchema>;

/** Spellcasting capability (immutable); live slots and prepared spells live on the Actor. Save DC and attack bonus
 * derive (8+PB+mod / PB+mod) unless overridden. Resolve per-spell values only with `resolveSpellcasting`.
 * A builder filling `classes[]` must also fill the top-level fields and combined `slots` (the single live pool). */
const SpellcastingSchema = z
  .object({
    ability: AbilitySchema,
    saveDc: z.number().int().min(1).max(40).optional(),
    attackBonus: z.number().int().min(-5).max(30).optional(),
    slots: z.array(SpellSlotMaxSchema).max(9).default([]),
    pact: PactSlotMaxSchema.optional(),
    /** Per-class entries for multiclass sheets. Absent = single caster; read the fields above. */
    classes: z.array(ClassSpellcastingSchema).max(4).optional(),
    spells: z
      .array(
        z
          .object({
            id: z.string().max(80),
            name: z.string().min(1).max(120),
            level: z.number().int().min(0).max(9),
            prepared: z.boolean().default(true),
            alwaysPrepared: z.boolean().default(false),
            /** The action that casts it: with a spell slot for a leveled spell, which the cast spends. */
            actionId: z
              .string()
              .regex(/^[a-z0-9-]+$/)
              .optional(),
            /** The action that casts it without a slot: a grant's free casting (spending the feature's uses) or an
             *  at-will one. */
            freeActionId: z
              .string()
              .regex(/^[a-z0-9-]+$/)
              .optional(),
            /** False when it can be cast only without a slot (an invocation's spell). Absent: with a slot. */
            withSlot: z.boolean().optional(),
            /** Which class granted this spell, so `resolveSpellcasting` can pick the right ability. */
            classId: z
              .string()
              .regex(/^[a-z0-9-]+$/)
              .max(60)
              .optional()
          })
          .strict()
      )
      .max(400)
      .default([])
  })
  .strict()
  .superRefine((spellcasting, context) => {
    // Per-class slots without the combined top-level pool would seed `spellSlots: []`: a caster who cannot cast.
    const perClassSlots = (spellcasting.classes ?? []).some((entry) => (entry.slots ?? []).length > 0);
    if (perClassSlots && spellcasting.slots.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["slots"],
        message:
          "A sheet with per-class spell slots must also carry the combined top-level slots (the character's single live pool)."
      });
    }
  });
export type Spellcasting = z.infer<typeof SpellcastingSchema>;

/** Which ability/DC/attack bonus a class's magic uses: the matching `classes[]` entry; else, when no class was
 * named, the lone entry; else the top-level fields. */
export function resolveSpellcasting(
  spellcasting: Spellcasting | undefined,
  classId?: string
): { classId?: string; ability: AbilityId; saveDc?: number; attackBonus?: number } | undefined {
  if (!spellcasting) return undefined;
  const entries = spellcasting.classes ?? [];
  const match = classId ? entries.find((entry) => entry.classId === classId) : undefined;
  // The lone-entry shortcut applies only when no class was named: asking for "fighter" on an Eldritch Knight /
  // Wizard sheet must not get the Wizard's INT and DC.
  const chosen = match ?? (classId === undefined && entries.length === 1 ? entries[0] : undefined);
  if (chosen)
    return {
      classId: chosen.classId,
      ability: chosen.ability,
      saveDc: chosen.saveDc ?? spellcasting.saveDc,
      attackBonus: chosen.attackBonus ?? spellcasting.attackBonus
    };
  return { ability: spellcasting.ability, saveDc: spellcasting.saveDc, attackBonus: spellcasting.attackBonus };
}

/** The choice ledger as a list, treating "no ledger recorded" as empty. Use when you only need to read. */
export function characterChoices(
  character: z.infer<typeof CharacterIdentitySchema> | undefined
): readonly CharacterChoice[] {
  return character?.choices ?? [];
}

export const ActorDefinitionSchema = z
  .object({
    schemaId: z.enum(["vtt.actor-character", "vtt.actor-monster"]),
    schemaVersion: z.literal(ACTOR_DEFINITION_SCHEMA_VERSION),
    source: z.object({
      name: z.string().min(1).max(200),
      version: z.string().min(1).max(80),
      externalId: z.string().max(200).optional()
    }),
    name: z.string().min(1).max(120),
    summary: z.string().max(280).optional(),
    size: z.enum(["tiny", "small", "medium", "large", "huge", "gargantuan"]),
    abilityScores: z.object({
      str: z.number().int().min(1).max(30),
      dex: z.number().int().min(1).max(30),
      con: z.number().int().min(1).max(30),
      int: z.number().int().min(1).max(30),
      wis: z.number().int().min(1).max(30),
      cha: z.number().int().min(1).max(30)
    }),
    proficiencyBonus: z.number().int().min(0).max(12),
    armorClass: z.number().int().min(1).max(40),
    hitPoints: z.object({ maximum: z.number().int().positive(), formula: DiceFormulaSchema.optional() }),
    initiativeBonus: z.number().int().min(-20).max(30).default(0),
    speedFeet: z.number().int().nonnegative(),
    actions: z.array(ActionSchema).max(100).default([]),
    token: z
      .object({
        disposition: z.enum(["friendly", "hostile", "neutral"]).default("neutral"),
        footprint: z
          .object({ width: z.number().int().positive().max(4), height: z.number().int().positive().max(4) })
          .default({ width: 1, height: 1 })
      })
      .prefault({ disposition: "neutral", footprint: { width: 1, height: 1 } }),
    extensions: z.record(z.string(), z.unknown()).default({}),
    /** Typed defenses by damage-type id, applied immunity → resistance → vulnerability. Absent = none known. */
    damageResistances: z.array(DamageTypeIdSchema).max(20).optional(),
    damageImmunities: z.array(DamageTypeIdSchema).max(20).optional(),
    damageVulnerabilities: z.array(DamageTypeIdSchema).max(20).optional(),
    /** Seeded onto the actor's `conditionImmunities`, which the engine enforces. */
    conditionImmunities: z.array(ConditionIdSchema).max(20).optional(),
    /** Legendary creature resources (SRD 2024): legendary actions per round (spent on other creatures' turns) and Legendary Resistance per day (re-arms on a long rest). */
    legendary: z
      .object({
        actionsPerRound: z.number().int().min(1).max(5).optional(),
        resistancesPerDay: z.number().int().min(1).max(6).optional()
      })
      .strict()
      .optional(),
    /** Character identity (class/level/race/background/feats); character definitions only. */
    character: CharacterIdentitySchema.optional(),
    proficiencies: ProficienciesSchema.optional(),
    spellcasting: SpellcastingSchema.optional(),
    /** Immutable starting loadout; the live actor's inventory is seeded from this. */
    startingInventory: z.array(InventoryItemSchema).max(200).optional(),
    /** Immutable starting coins; the live actor's currency is seeded from this. */
    startingCurrency: CurrencySchema.optional()
  })
  .superRefine((actor, context) => {
    if (actor.schemaId === "vtt.actor-character" && actor.token.disposition !== "friendly")
      context.addIssue({
        code: "custom",
        path: ["token", "disposition"],
        message: "Player-character definitions must use the friendly disposition."
      });
  });
export type ActorDefinition = z.infer<typeof ActorDefinitionSchema>;
