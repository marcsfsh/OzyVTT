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
/** Open identity slug, the same as the content catalog's `ContentIdSchema`. */
const RiderSlugSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .max(80);
const SizeSchema = z.enum(["tiny", "small", "medium", "large", "huge", "gargantuan"]);
/** A pick budget that follows a printed class-table column's growth (Eldritch Invocations 1 -> 10). Here because the
 *  content bundle authors it and the catalog rows carry it. */
export const PickBudgetScalingSchema = z
  .strictObject({
    type: z.literal("class-resource-growth"),
    /** The `classResources.id` of the printed column - `eldritch-invocations`, `weapon-mastery`. */
    id: RiderSlugSchema.describe("The `classResources.id` of the printed column (eldritch-invocations, weapon-mastery)")
  })
  .describe(
    "A pick budget that follows A printed column: the same fourth way `HomebrewFeatureUses` scales a feature's uses, applied to capacity. `class-resource-growth` yields how far the named `classResources` column has grown above its first printed value at this character's level, so the feature's own `choose` plus the growth is the printed total: Eldritch Invocations runs 1 -> 10 and Weapon Mastery 3 -> 6 (Fighter) and 2 -> 4 (Barbarian). Repeat grants cannot express these, because the column steps at levels where the SRD prints no feature heading to carry a grant at all."
  );
/** A safe dice expression, one die term plus at most one flat modifier, never an evaluable string (ADR-0008). */
export const DiceFormulaSchema = z
  .string()
  .regex(/^\d+d(?:4|6|8|10|12|20|100)(?:\s*[+-]\s*\d+)?$/i, "Use a safe dice formula such as 1d8 + 3.");
/** Damage an action deals: dice, or a fixed amount that doesn't use a roll ("1 Piercing damage", a Blowgun). A crit
 * doubles only dice, so a fixed amount stays as it is. */
export const DamageFormulaSchema = z
  .string()
  .regex(/^(?:\d+d(?:4|6|8|10|12|20|100)(?:\s*[+-]\s*\d+)?|\d+)$/i, "Use dice such as 1d8 + 3, or a number.");
/** Hit points restored: dice, or a flat number (Heal's 70). */
export const HealingFormulaSchema = z
  .string()
  .regex(/^(?:\d+d(?:4|6|8|10|12|20|100)(?:\s*[+-]\s*\d+)?|\d+)$/i, "Use dice such as 2d8 + 3, or a number.");
export const AbilitySchema = z.enum(["str", "dex", "con", "int", "wis", "cha"]);
export type AbilityId = z.infer<typeof AbilitySchema>;

/** The rolls an answer can change: the three D20 Tests (a check includes Initiative), a death save, and a damage
 *  roll. */
export const RollAnswerRollSchema = z.enum(["attack", "save", "check", "death-save", "damage"]);
export type RollAnswerRoll = z.infer<typeof RollAnswerRollSchema>;

/**
 * What an answer does to the roll it answers:
 * - add / subtract: roll `amount` and add it to the total, or take it off (Bardic Inspiration, Cutting Words).
 *   `keepUseOnFailure`: the use comes back when the roll still fails (Peerless Skill, Tactical Mind).
 * - add-or-subtract: the answerer picks the sign when it answers (Boon of Fate).
 * - reroll: throw the d20s again and use the new roll (Indomitable). `one` rerolls only the die that counts (the
 *   halfling's Luck), `bonus` adds to the new roll, `advantage` rerolls it with Advantage (Countercharm).
 * - set-d20: the d20 that counts becomes `face` (Stroke of Luck).
 * - succeed: a failed save succeeds (Ring of Evasion). hit: a missed attack hits (Boon of Combat Prowess).
 */
export const RollAnswerEffectSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("add"),
      amount: DamageFormulaSchema,
      keepUseOnFailure: z.literal(true).optional()
    })
    .strict(),
  z.object({ kind: z.literal("subtract"), amount: DamageFormulaSchema }).strict(),
  z.object({ kind: z.literal("add-or-subtract"), amount: DamageFormulaSchema }).strict(),
  z
    .object({
      kind: z.literal("reroll"),
      one: z.literal(true).optional(),
      bonus: z.number().int().min(1).max(30).optional(),
      advantage: z.literal(true).optional()
    })
    .strict(),
  z.object({ kind: z.literal("set-d20"), face: z.number().int().min(1).max(20) }).strict(),
  z.object({ kind: z.literal("succeed") }).strict(),
  z.object({ kind: z.literal("hit") }).strict()
]);
export type RollAnswerEffect = z.infer<typeof RollAnswerEffectSchema>;

/**
 * A way to change a roll after it is seen and before its outcome lands (SRD "after seeing the roll"): what rolls it
 * answers, whose (the bearer's own, another creature's within `rangeFeet`, or either), when (after a failure, a success,
 * either, or a d20 showing 1), what it does, and for a save what the save must be against. Its cost is the action's own:
 * its uses and, on a Reaction, the Reaction. An effect that carries one (a Bardic Inspiration die) ends when it is used.
 * `versus` passes when any of its lists matches: a save against an effect that imposes one of `conditions`, a spell of
 * one of `spellSchools` (`singleTarget`: aimed at the bearer alone), or a source of one of `creatureTypes`.
 */
export const RollAnswerSchema = z
  .object({
    rolls: z.array(RollAnswerRollSchema).min(1).max(5),
    whose: z.enum(["own", "other", "any"]).default("own"),
    rangeFeet: z.number().int().min(5).max(1000).optional(),
    when: z.enum(["failure", "success", "any", "natural-one"]).default("failure"),
    /** Not while the bearer is Incapacitated (a Luck Blade's luck). */
    notWhileIncapacitated: z.literal(true).optional(),
    /** Only the attack rolls of the bearer's spells (Seeking Spell: "If you make an attack roll for a spell"). */
    spellAttacks: z.literal(true).optional(),
    abilities: z.array(AbilitySchema).min(1).max(6).optional(),
    versus: z
      .object({
        conditions: z.array(ConditionIdSchema).min(1).max(4).optional(),
        spellSchools: z.array(RiderSlugSchema).min(1).max(8).optional(),
        creatureTypes: z.array(RiderSlugSchema).min(1).max(8).optional(),
        singleTarget: z.literal(true).optional()
      })
      .strict()
      .optional(),
    effect: RollAnswerEffectSchema
  })
  .strict()
  .describe(
    "A way to change a roll after it is seen and before it counts: the rolls it answers, whose roll (own, other or any, within rangeFeet), when (failure, success, any or natural-one), whether only a spell's attack rolls (spellAttacks), what it does (add, subtract, add-or-subtract, reroll, set-d20, succeed, hit), and what a save must be against. It costs the action's own uses, and its Reaction when the action is one."
  );
export type RollAnswer = z.infer<typeof RollAnswerSchema>;
/** The SRD's 13 damage types. Riders name one of these, so a misspelled type is refused, and no
 * gate or defence that matches nothing is published. */
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

/** The ways a caster shapes one casting as it casts: the Sorcerer's Metamagic options chosen with the cast (SRD 5.2.1
 *  Metamagic Options; Seeking Spell answers a missed roll instead) and the Evoker's Sculpt Spells. */
export const CastShapingIdSchema = z.enum([
  "careful-spell",
  "distant-spell",
  "empowered-spell",
  "extended-spell",
  "heightened-spell",
  "quickened-spell",
  "subtle-spell",
  "transmuted-spell",
  "twinned-spell",
  "sculpt-spells"
]);
export type CastShapingId = z.infer<typeof CastShapingIdSchema>;
/** One way a casting is shaped, with what it names: the creatures Careful Spell and Sculpt Spells protect or the one
 *  target Heightened Spell picks, and the damage type Transmuted Spell changes to. */
export const CastShapingSchema = z
  .object({
    id: CastShapingIdSchema,
    creatureIds: z.array(z.uuid()).max(10).optional(),
    damageType: DamageTypeSchema.optional()
  })
  .strict();
export type CastShaping = z.infer<typeof CastShapingSchema>;

/**
 * What a melee hit on an effect's bearer costs the attacker (SRD Fire Shield: "Whenever a creature within 5 feet of
 * you hits you with a melee attack roll, the shield erupts"; Holy Aura's light blinding a Fiend or an Undead): damage it
 * takes, and a save it makes or has the conditions until the end of its next turn. Only an attacker within
 * `withinFeet`, and of `creatureTypes` when set, is answered.
 */
export const StruckSchema = z
  .object({
    withinFeet: z.number().int().min(5).max(120).optional(),
    creatureTypes: z.array(RiderSlugSchema).min(1).max(8).optional(),
    damage: z
      .array(z.object({ formula: DamageFormulaSchema, type: DamageTypeSchema }).strict())
      .min(1)
      .max(3)
      .optional(),
    save: z
      .object({
        ability: AbilitySchema,
        dc: z.number().int().min(1).max(40),
        conditions: z.array(ConditionIdSchema).min(1).max(3)
      })
      .strict()
      .optional()
  })
  .strict()
  .describe(
    "What a melee hit on the bearer costs the attacker: damage, and a save against conditions that last until the end of the attacker's next turn, for an attacker within withinFeet and of creatureTypes"
  );
export type Struck = z.infer<typeof StruckSchema>;
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
 * Plain data with no expression language (ADR-0008): bounded `.strict()` objects, no OR/NOT/nesting/arithmetic.
 * Every trigger here has a reader; one the engine cannot answer does not belong in the vocabulary.
 */
export const RiderTriggerSchema = z
  .discriminatedUnion("type", [
    // ---- static gates ----
    /** The bearer is attuned. Redundant (and harmless) when the item's own `attunement.required` is true. */
    z
      .object({ type: z.literal("attuned") })
      .strict()
      .describe(
        "Static gate. The bearer is attuned. Redundant (and harmless) when the item's own `attunement.required` is already true."
      ),
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
      .strict()
      .describe(
        "Static gate. The bearer is wearing armor. Omitting `weights` is exactly what `armor-class.whileArmored: true` has always meant."
      ),
    z
      .object({ type: z.literal("while-unarmored"), allowShield: z.boolean().default(false) })
      .strict()
      .describe(
        "Static gate. The bearer is wearing no armor; `allowShield` decides whether a shield still counts as unarmored (Barbarian yes, Monk no)."
      ),
    /** `wielding: false` expresses Dueling-style "only while not holding a shield". */
    z
      .object({ type: z.literal("while-shield"), wielding: z.boolean().default(true) })
      .strict()
      .describe(
        'Static gate. The bearer is wielding a shield, or, with `wielding: false`, is not, which is how the Dueling-style "only while not holding a shield" is said without a NOT operator.'
      ),
    /** Two lists in one trigger so "Paladin or Cleric" needs no OR. */
    z
      .object({
        type: z.literal("while-character-is"),
        classIds: z.array(RiderSlugSchema).max(8).default([]),
        speciesIds: z.array(RiderSlugSchema).max(8).default([])
      })
      .strict()
      .describe(
        'Static gate. The bearer is one of these classes or species. Two lists in one trigger so "Paladin or Cleric" is a single entry with no OR; at least one id must be named.'
      ),
    z
      .object({
        type: z.literal("while-proficient-with"),
        kind: z.enum(["weapon", "armor", "tool", "skill"]),
        ids: z.array(RiderSlugSchema).min(1).max(12)
      })
      .strict()
      .describe("Static gate. The bearer is proficient with any of the named weapons, armor, tools, or skills."),
    // ---- dynamic gates ----
    /** Any-of against `actor.effects[].tags`. */
    z
      .object({ type: z.literal("while-effect-tag"), tags: z.array(EffectTagSchema).min(1).max(4) })
      .strict()
      .describe(
        "Dynamic gate. The bearer has an active effect carrying any of these tags: the single-tag `requiresEffectTag` precedent, widened to a list."
      ),
    z
      .object({ type: z.literal("while-hp-at-or-below"), percent: z.number().int().min(1).max(99) })
      .strict()
      .describe(
        "Dynamic gate. The bearer is at or below this percentage of maximum hit points (a bloodied threshold)."
      ),
    z
      .object({
        type: z.literal("while-condition"),
        conditionIds: z.array(ConditionSchema).min(1).max(6),
        present: z.boolean().default(true)
      })
      .strict()
      .describe("Dynamic gate. The bearer has (or, with `present: false`, lacks) any of these conditions."),
    // ---- moments ----
    z.object({ type: z.literal("on-attack-roll") }).strict(),
    z.object({ type: z.literal("on-hit") }).strict(),
    z.object({ type: z.literal("on-critical-hit") }).strict(),
    /** The attack roll's d20 shows a 20 ("When you roll a 20 on an attack roll made with this weapon"), whatever else
     *  widens the Critical Hit range. */
    z.object({ type: z.literal("on-natural-20") }).strict(),
    z.object({ type: z.literal("on-damage-roll") }).strict(),
    z.object({ type: z.literal("on-saving-throw") }).strict(),
    z.object({ type: z.literal("on-ability-check") }).strict(),
    z.object({ type: z.literal("on-initiative-roll") }).strict(),
    z.object({ type: z.literal("on-taking-damage") }).strict(),
    // ---- filters ----
    /** `spell` is an attack that casts a spell; `weapon` one made with a weapon (not a spell, an Unarmed Strike or a
     * monster's natural attack), and `melee-weapon` and `ranged-weapon` such an attack made in melee or at range (a
     * melee spell attack is melee, but no weapon's); `reaction` and `opportunity` match only when the resolver announces
     * that trigger. */
    z
      .object({
        type: z.literal("attack-kind-is"),
        kinds: z
          .array(
            z.enum([
              "melee",
              "ranged",
              "spell",
              "weapon",
              "melee-weapon",
              "ranged-weapon",
              "unarmed",
              "thrown",
              "reaction",
              "opportunity"
            ])
          )
          .min(1)
          .max(10)
      })
      .strict()
      .describe(
        "Filter. Narrows a moment to these attack kinds. melee, ranged and thrown come from the attack's reach, range and distance; `spell` is an attack that casts a spell (its action names a `spellId`); `reaction` and `opportunity` require the resolver to announce the trigger."
      ),
    z
      .object({ type: z.literal("weapon-property-is"), properties: z.array(RiderSlugSchema).min(1).max(12) })
      .strict()
      .describe("Filter. Narrows to weapons carrying any of these property slugs (finesse, heavy, two-handed)."),
    z
      .object({ type: z.literal("damage-type-is"), damageTypes: z.array(DamageTypeSchema).min(1).max(12) })
      .strict()
      .describe("Filter. Narrows to these damage types, from the 13 SRD types."),
    z
      .object({ type: z.literal("ability-is"), abilities: z.array(AbilitySchema).min(1).max(6) })
      .strict()
      .describe(
        'Filter. Narrows a save or check moment to these abilities: what turns a bare `save-bonus` into "+1 to Dexterity saves".'
      ),
    z
      .object({ type: z.literal("skill-is"), skills: z.array(RiderSlugSchema).min(1).max(12) })
      .strict()
      .describe("Filter. Narrows a check moment to these skills (Gloves of Thievery: sleight-of-hand)."),
    /** The school of the spell the action casts (`ActorAction.spellId`, looked up in the catalog). */
    z
      .object({ type: z.literal("spell-school-is"), schools: z.array(RiderSlugSchema).min(1).max(8) })
      .strict()
      .describe(
        "Filter. Narrows a moment to actions casting a spell of these schools (the action's `spellId`, looked up in the catalog)."
      ),
    /** The level of the spell the action casts; 0 is a cantrip. */
    z
      .object({ type: z.literal("spell-level-is"), levels: z.array(z.number().int().min(0).max(9)).min(1).max(10) })
      .strict()
      .describe(
        "Filter. Narrows a moment to actions casting a spell of these levels (the spell's own level; 0 is a cantrip)."
      ),
    /** One specific spell ("when you cast Eldritch Blast"), matched against `ActorAction.spellId`. An action with no
     * `spellId` never matches. */
    z
      .object({ type: z.literal("spell-id-is"), spellIds: z.array(RiderSlugSchema).min(1).max(12) })
      .strict()
      .describe(
        "Filter. Narrows a spell moment to these specific spells. `spell-school-is` and `spell-level-is` name categories; a printed \"when you cast Eldritch Blast\" names one record, and no combination of school and level picks out one cantrip. Matches an action's `spellId` (the spell the action is), so it fires on the cast actions an item's `casts` entries synthesise and on any feature action naming its spell. An action with no `spellId` never matches."
      ),
    /** The target's creature type, read from its stat block; a character records none, so it never matches one. */
    z
      .object({ type: z.literal("versus-creature-type"), creatureTypes: z.array(RiderSlugSchema).min(1).max(12) })
      .strict()
      .describe(
        "Filter. Narrows to targets of these creature types, read from the target's stat block. A character records no creature type, so it never matches one."
      ),
    z
      .object({ type: z.literal("versus-size"), sizes: z.array(SizeSchema).min(1).max(6) })
      .strict()
      .describe("Filter. Narrows to targets of these sizes."),
    /** On an attack, a condition the target has; on a saving throw, one the save would impose or end ("saving throws
     * to avoid or end the Poisoned condition"). */
    z
      .object({ type: z.literal("versus-condition"), conditionIds: z.array(ConditionSchema).min(1).max(6) })
      .strict()
      .describe("Filter. Narrows to targets currently under any of these conditions."),
    /** On an effect, its riders fire only for the creature that put the effect on its bearer, never for the bearer:
     * Hunter's Mark's extra damage when its caster hits the marked creature. */
    z.object({ type: z.literal("by-effect-source") }).strict(),
    /** The bearer can see the other creature in the roll (Dodge: "if you can see the attacker"), as the server's sight
     *  answers it. */
    z
      .object({ type: z.literal("sees-other") })
      .strict()
      .describe(
        'Filter. On an attack roll, the bearer can see the other creature in it, as the server\'s sight answers it (Dodge: "attack rolls against you have Disadvantage if you can see the attacker").'
      ),
    /** The other creature in the roll can see the bearer (Faerie Fire: "if the attacker can see it"). */
    z
      .object({ type: z.literal("seen-by-other") })
      .strict()
      .describe(
        'Filter. On an attack roll, the other creature in it can see the bearer (Faerie Fire: "Attack rolls against an affected creature have Advantage if the attacker can see it").'
      ),
    /** The other creature in the roll perceives the bearer with none of these senses (Blur: an attacker that perceives
     *  you with Blindsight or Truesight is immune). */
    z
      .object({ type: z.literal("other-lacks-sense"), senses: z.array(RiderSlugSchema).min(1).max(4) })
      .strict()
      .describe(
        "Filter. On an attack roll, the other creature in it perceives the bearer with none of these senses within their range (Blur: an attacker that perceives you with Blindsight or Truesight is immune)."
      )
  ])
  .describe(
    "When a rider applies. Thirty-three named triggers in four kinds, and the kind decides the evaluation layer so a GM never picks one: a `static-gate` is resolvable from the sheet alone and bakes into a standing number; a `dynamic-gate` reads live actor state and becomes a labelled note re-checked per roll; a `moment` fires at the named roll or event; a `filter` narrows whatever moment it accompanies. Every trigger has a reader in the engine. This is plain data with no expression language; every member is a closed object with bounded parameters, and there is no OR, no NOT, no nesting and no arithmetic (ADR-0008). A `when` list may carry at most one moment: a rider fires at only one moment."
  );
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
  "on-natural-20": "moment",
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
  "versus-condition": "filter",
  "by-effect-source": "filter",
  "sees-other": "filter",
  "seen-by-other": "filter",
  "other-lacks-sense": "filter"
});

/** The moments the damage roll collects (`rollRiderDamage`). A damage rider gated on any other moment would never
 * fire, so content and homebrew refuse it. */
export const DAMAGE_ROLL_MOMENTS: readonly RiderTrigger["type"][] = Object.freeze([
  "on-hit",
  "on-critical-hit",
  "on-natural-20",
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
      message: `Two "${duplicate.type}" triggers on one rider. List the values in a single entry.`
    });
}

/** At most four triggers, ANDed, with at most one moment; a filter without a moment is rejected. */
export const RiderWhenSchema = z
  .array(RiderTriggerSchema)
  .max(4)
  .superRefine((triggers, context) => {
    const kinds = triggers.map((trigger) => RIDER_TRIGGER_KINDS[trigger.type]);
    if (kinds.filter((kind) => kind === "moment").length > 1) {
      context.addIssue({ code: "custom", message: "A rider fires at only one moment." });
    }
    if (kinds.includes("filter") && !kinds.includes("moment")) {
      context.addIssue({
        code: "custom",
        message: "A filter needs a moment to narrow. Add the roll or event it applies to."
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
        message: `A grant is a standing fact, so it cannot wait for a roll: "${offender.type}" is only knowable during one, and the grant has been collected before any roll starts. Gate it on a state (attuned, while-armored, while-unarmored, while-shield, while-character-is, while-proficient-with, while-effect-tag, while-hp-at-or-below, while-condition), or move the mechanic to a modifier, where a moment IS read.`
      });
    }
    checkSharedTriggerRules(triggers, context);
  });

/** The gate fields every modifier carries. No `when` means always. `scope` defaults by carrier: on an item with a
 * weapon block the attack/damage/crit riders mean "with this weapon", otherwise "the bearer". */
/** Dice a rider adds to a d20 test ("1d4"), or with a minus takes from it ("-1d4"). */
const SignedDiceSchema = z.string().regex(/^-?[1-4]d(?:4|6|8|10|12)$/, "Use dice such as 1d4, or -1d4 to subtract.");

const riderGate = {
  when: RiderWhenSchema.optional().describe(
    "AND-list of at most four triggers gating this rider, with at most one moment. Absent or empty = always. A filter with no moment is rejected: it has nothing to narrow"
  ),
  scope: z
    .enum(["bearer", "this-item"])
    .optional()
    .describe(
      'What the rider attaches to. Omitted = derived: on an item with a weapon block the attack/damage/crit family means "with this weapon", everything else means the bearer. On a non-item carrier "this-item" resolves to "bearer"'
    )
} as const;

// ---- Modifiers: the one typed vocabulary every carrier shares ----

/**
 * What a feature, feat, chosen option, magic item or live effect contributes to the rules engine. One union for
 * every carrier, read by one evaluator (`collectRiders` in `@vtt/rules-5e`) against one context, so a bonus means
 * the same thing wherever it is authored. Bounded and grown additively; anything else stays prose (ADR-0008).
 * Amounts are signed, so a curse is a negative number. Carriers refuse what they cannot honour: see
 * `ITEM_REFUSED_MODIFIER_TYPES` (content) and `EFFECT_REFUSED_MODIFIER_TYPES`.
 */
export const ModifierSchema = z
  .discriminatedUnion("type", [
    // ---- the character ----
    z
      .object({
        type: z.literal("ability-score"),
        ability: AbilitySchema,
        amount: z.number().int().min(-5).max(5),
        maximum: z.number().int().min(1).max(30).optional(),
        ...riderGate
      })
      .strict()
      .describe(
        "Raise (or lower) one ability score, optionally past the usual cap. Refused on an item: an ability score cascades into AC, saves, skills, spell DC, hit points and initiative, and every one of those reads the baked `abilityScores`, so layering one score means layering the whole sheet."
      ),
    z
      .object({ type: z.literal("hit-points-per-level"), amount: z.number().int().min(-5).max(5), ...riderGate })
      .strict()
      .describe(
        "Extra hit points at every level (Tough, Dwarven Toughness). Refused on an item: it changes `hp.maximum`, which live `hp.current` is tracked against, so unequipping could strand current above maximum, and there is no correct silent answer."
      ),
    /** Baked into the sheet's speed at build time on a feature unless gated (then read with the live loadout);
     *  summed live on an effect, so it ends with it. */
    z
      .object({ type: z.literal("speed"), amount: z.number().int().min(-30).max(60), ...riderGate })
      .strict()
      .describe(
        "Change walking speed in feet, signed (Longstrider +10, the `slow` mastery -10). On a feature it is baked into the sheet's speed when the character is built, unless gated (Unarmored Movement's `while-unarmored`), when it is read with the live loadout; on an item or an effect it is summed live into the movement budget, so the feet come back when the item comes off or the effect ends."
      ),
    /** A Fly, Swim, Climb or Burrow Speed: `feet` (Fly's 60, a Ring of Swimming's 40), or with `equalToSpeed` the
     *  creature's Speed as it stands (Spider Climb); `hover` lets a flier hover. Read live by the movement rules from
     *  items and effects, so it ends with them. */
    z
      .object({
        type: z.literal("special-speed"),
        movement: z.enum(["fly", "swim", "climb", "burrow"]),
        feet: z.number().int().min(5).max(300).optional(),
        equalToSpeed: z.boolean().optional(),
        hover: z.boolean().optional(),
        ...riderGate
      })
      .strict(),
    /** How the bearer falls and jumps, read live by the movement rules from features, items and effects. */
    z
      .object({
        type: z.literal("movement"),
        rule: z.enum(["safe-fall", "leap", "jump-by-dexterity", "jump-multiplier"]),
        /** `leap`: how far the jump may go. */
        feet: z.number().int().min(5).max(120).optional(),
        /** `leap`: the movement it spends, whatever its length. */
        costFeet: z.number().int().min(0).max(60).optional(),
        /** `jump-multiplier`: what the jump's distance is multiplied by. */
        times: z.number().int().min(2).max(4).optional(),
        ...riderGate
      })
      .strict()
      .describe(
        'How the bearer falls and jumps (SRD Falling, Jumping): "safe-fall" takes no damage from a fall (Ring of Feather Falling); "leap" jumps up to `feet` for `costFeet` of movement once on each of its turns (Jump, Boots of Striding and Springing); "jump-by-dexterity" measures jumps with Dexterity in place of Strength (Second-Story Work); "jump-multiplier" multiplies the jump\'s distance by `times` (Step of the Wind). Read live by the movement rules, so it ends with its carrier.'
      ),
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
      .strict()
      .describe(
        'A flat AC rider, read live from every carrier (a feature or feat as much as an item), so it follows the armor worn now. `whileArmored` is the one bounded condition the SRD\'s printed bonuses need (the Defense fighting style reads "While you\'re wearing Light, Medium, or Heavy armor"); it is a plain boolean with no condition language, and defaults to the unconditional bonus every earlier record meant. `when: [{"type": "while-armored"}]` now says the same thing in the general vocabulary; the boolean stays because shipped bundles author it, and a collector normalises it into that trigger.'
      ),
    /** `proficiencyBonus` adds the creature's Proficiency Bonus on top of `amount` (Alert's Initiative Proficiency). */
    z
      .object({
        type: z.literal("initiative"),
        amount: z.number().int().min(-5).max(10),
        proficiencyBonus: z
          .boolean()
          .optional()
          .describe(
            "Also add the bearer's Proficiency Bonus (Alert's Initiative Proficiency). Counted once however many riders say so"
          ),
        ...riderGate
      })
      .strict()
      .describe("Change the initiative bonus."),
    z
      .object({ type: z.literal("extra-attack"), count: z.number().int().min(1).max(3), ...riderGate })
      .strict()
      .describe("Additional attacks on the Attack action."),
    /** AC = 10 + DEX + this ability while wearing no armor (Barbarian, Monk, and any homebrew that wants it). */
    z
      .object({
        type: z.literal("unarmored-defense"),
        ability: AbilitySchema,
        allowShield: z.boolean().default(false),
        ...riderGate
      })
      .strict()
      .describe(
        "AC = 10 + DEX + this ability while wearing no armor (Barbarian, Monk, and any homebrew that wants it)."
      ),
    /** Read live by dynamic vision (`vision/senses.ts`): the best range wins, and `extends` adds its feet to the
     *  bearer's other Darkvision (Goggles of Night: "increases its range by 60 feet"). */
    z
      .object({
        type: z.literal("darkvision"),
        feet: z.number().int().min(0).max(240),
        extends: z.literal(true).optional(),
        ...riderGate
      })
      .strict()
      .describe(
        "Grant or extend Darkvision, read live by dynamic vision. The best range wins; with `extends`, the feet are added to the bearer's other Darkvision, or are its range when it has none (Goggles of Night)."
      ),
    /** A special sense in feet, read live by dynamic vision (`vision/senses.ts`). */
    z
      .object({
        type: z.literal("sense"),
        sense: RiderSlugSchema,
        feet: z.number().int().min(0).max(240),
        ...riderGate
      })
      .strict()
      .describe(
        "A special sense in feet, read live by dynamic vision: `blindsight`, `tremorsense` and `truesight` as the Rules Glossary defines them, `see-invisibility` (sees Invisible creatures as if they were visible), `devils-sight` (sees normally in Dim Light and Darkness, magical or not) and `x-ray` (sees through walls). Any other name is shown on the sheet and read by nothing."
      ),
    /** More magic items attuned at once than the SRD's three (Use Magic Device: four). Read when an item is attuned. */
    z
      .object({ type: z.literal("attunement-slots"), amount: z.number().int().min(1).max(3), ...riderGate })
      .strict()
      .describe(
        "More magic items attuned at once than the SRD's three (the Thief's Use Magic Device: one more, for four). Read when a player attunes an item. Refused on an item, whose own attunement it would decide, and on an effect, which could end with too many items attuned."
      ),
    /** One more use of a limited resource. `poolId` is the live `actionUses` key. */
    z
      .object({
        type: z.literal("resource-bonus"),
        poolId: RiderSlugSchema,
        amount: z.number().int().min(-20).max(20),
        ...riderGate
      })
      .strict()
      .describe(
        "One more use of a limited resource. `poolId` is the live uses key (a `uses.pool` or an action id): the namespace that is actually spent and re-armed, deliberately not the class level table's display-only `classResources`, where a rider would parse, store, project, and change nothing."
      ),
    /** A pool a Short Rest refills beyond its own recharge: `amount` expended uses back ("you regain one expended use
     *  when you finish a Short Rest", Rage), or every one when absent (Font of Inspiration). Read when the rest ends. */
    z
      .object({
        type: z.literal("short-rest-regain"),
        poolId: RiderSlugSchema,
        amount: z.number().int().min(1).max(20).optional(),
        ...riderGate
      })
      .strict(),
    // ---- rolls ----
    /** `dice` rolls with the attack on top of `amount` (Bless's 1d4); a leading minus takes them off (Bane). */
    z
      .object({
        type: z.literal("attack-bonus"),
        amount: z.number().int().min(-10).max(10),
        dice: SignedDiceSchema.optional(),
        ...riderGate
      })
      .strict()
      .describe(
        "A flat bonus to the bearer's attack rolls. The missing channel: the resolver's to-hit was the action's printed bonus plus exhaustion and nothing else could reach it."
      ),
    /** A flat bonus to saving throws, with `dice` as on `attack-bonus`. Narrow it with `when: [{type:
     * "on-saving-throw"}, {type: "ability-is", ...}]`. */
    z
      .object({
        type: z.literal("save-bonus"),
        amount: z.number().int().min(-10).max(10),
        dice: SignedDiceSchema.optional(),
        ...riderGate
      })
      .strict()
      .describe(
        'A flat bonus to saving throws. Narrow it with `when: [{"type": "ability-is", "abilities": ["dex"]}]` (a Cloak of Protection is the unnarrowed form).'
      ),
    /** A flat bonus to ability and skill checks. Gloves of Thievery (+5 Sleight of Hand) is literally this. */
    z
      .object({ type: z.literal("check-bonus"), amount: z.number().int().min(-10).max(10), ...riderGate })
      .strict()
      .describe(
        "A flat bonus to ability and skill checks. Gloves of Thievery (+5 Sleight of Hand) is this plus a `skill-is` filter."
      ),
    /** Advantage or disadvantage on a named roll; `aggregateRollMode` applies 5e cancellation. `concentration` is the
     * Constitution save that keeps a spell going. */
    z
      .object({
        type: z.literal("roll-mode"),
        roll: z.enum(["attack", "incoming-attack", "save", "check", "initiative", "concentration"]),
        mode: z.enum(["advantage", "disadvantage"]),
        ...riderGate
      })
      .strict()
      .describe(
        'Advantage or disadvantage on a named roll: one branch per roll kind, with a `mode` field. It feeds the same aggregation that already implements 5e cancellation (any advantage plus any disadvantage is normal) and labels each source on the roll card, so a curse is `mode: "disadvantage"` and needs no separate machinery. `concentration` is the Constitution save that keeps a spell going; `incoming-attack` is attacks made against the bearer (Dodge).'
      ),
    // ---- damage and defence ----
    /** Flat damage, the other half of a "+1 weapon". Weapon-scoped by default on an item with a weapon block, so two
     * magic weapons never stack. Standing, it folds into the action's damage formula; on a moment it is its own line. */
    z
      .object({ type: z.literal("damage-bonus"), amount: z.number().int().min(-10).max(10), ...riderGate })
      .strict()
      .describe(
        'A flat bonus to damage rolls: the other half of a "+1 weapon" (`attack-bonus` is the to-hit half). Standing, it folds into the swing\'s printed damage formula; gated on a moment ("+7 on a critical hit", Rage\'s "+2 on a melee damage roll") it lands as its own labelled line at resolution, and only the damage roll\'s moments (`on-hit`, `on-critical-hit`, `on-damage-roll`) are accepted. Weapon-scoped by default on an item with a weapon block, so two magic weapons never stack.'
      ),
    /** Extra typed damage as dice (`formula`), the bearer's ability modifier (`abilityModifier`), or both.
     * `damageType` absent takes the attack's own type (Empowered Evocation follows the spell). `doubleOnCritical`
     * defaults true: a Critical Hit rolls the attack's other damage dice twice too (SRD "Critical Hits"). */
    z
      .object({
        type: z.literal("extra-damage"),
        formula: DiceFormulaSchema.optional().describe(
          'One die term plus at most one flat modifier ("1d8 + 3"). Anything richer stays prose (ADR-0008)'
        ),
        abilityModifier: AbilitySchema.optional(),
        damageType: DamageTypeSchema.optional(),
        doubleOnCritical: z.boolean().default(true),
        ...riderGate
      })
      .strict()
      .describe(
        'Extra typed damage, in one of the 13 SRD damage types. An attack\'s `criticalBonusDice` is a bare count applied to the first damage part, so it cannot carry a type. Two independent ways to say how much, and a rider may use either or both: `formula` is dice ("an extra 1d6 fire"), and `abilityModifier` adds the bearer\'s modifier in that ability as a flat number resolved at the roll ("add your Charisma modifier to the damage"): a printed wording that no authored constant can express, because the amount depends on the character. Agonizing Blast is `abilityModifier: "cha"` plus a `spell-id-is` gate. A rider with neither is refused at publish, so none is stored to silently add nothing, and so is one gated on a moment the damage roll never collects (only `on-hit`, `on-critical-hit`, `on-natural-20` and `on-damage-roll` are). `doubleOnCritical` defaults true because a Critical Hit rolls the attack\'s other damage dice twice too (SRD 5.2.1 "Critical Hits": "If the attack involves other damage dice, such as from the Rogue\'s Sneak Attack feature, you also roll those dice twice"); set it false only where a rule says otherwise. An ability modifier is never doubled at all.'
      ),
    /** Score a critical hit on this natural roll or higher (19-20 keen weapons). */
    z
      .object({ type: z.literal("critical-range"), threshold: z.number().int().min(15).max(20), ...riderGate })
      .strict()
      .describe("Score a critical hit on this natural roll or higher (19 for a keen weapon)."),
    /** Extra untyped weapon dice on a crit (Savage Attacks). A typed crit-only 1d6 fire is `extra-damage` + `when: [{on-critical-hit}]` instead. */
    z
      .object({ type: z.literal("critical-bonus-dice"), count: z.number().int().min(1).max(4), ...riderGate })
      .strict()
      .describe(
        "Extra untyped weapon dice on a critical hit (Savage Attacks). A typed crit-only 1d6 fire is `extra-damage` gated with `on-critical-hit` instead."
      ),
    /** Flat reduction of incoming damage, taken off before resistance (SRD Order of Application). */
    z
      .object({ type: z.literal("damage-reduction"), amount: z.number().int().min(1).max(30), ...riderGate })
      .strict()
      .describe(
        "Flat reduction of incoming damage, taken off the hit once before resistance and vulnerability (SRD Order of Application), from the largest part it covers first."
      ),
    z
      .object({
        type: z.literal("damage-resistance"),
        damageTypes: z.array(DamageTypeSchema).min(1).max(13),
        ...riderGate
      })
      .strict()
      .describe(
        "Resistance to the listed damage types (Rage). Read standing, before any roll, so a moment gate is refused at publish; gate it on a state (`while-effect-tag`) instead."
      ),
    /** The mirror of `damage-resistance`; with both, `adjustDamageParts` halves first and then doubles (SRD Order of
     * Application). */
    z
      .object({
        type: z.literal("damage-vulnerability"),
        damageTypes: z.array(DamageTypeSchema).min(1).max(13),
        ...riderGate
      })
      .strict()
      .describe(
        "Vulnerability to the listed damage types: double damage, and the mirror of `damage-resistance`. Resistance and vulnerability to the same type both apply in order: halved (round down), then doubled (SRD 5.2.1 Order of Application), so 15 becomes 14."
      ),
    // ---- spellcasting ----
    /** `classId` targets one caster on a multiclass sheet; absent = every caster the bearer has. */
    z
      .object({
        type: z.literal("spell-save-dc"),
        amount: z.number().int().min(-5).max(5),
        classId: RiderSlugSchema.optional(),
        ...riderGate
      })
      .strict()
      .describe(
        "Change the bearer's spell save DC. `classId` targets one caster on a multiclass sheet; absent = every caster the bearer has."
      ),
    z
      .object({
        type: z.literal("spell-attack-bonus"),
        amount: z.number().int().min(-5).max(5),
        classId: RiderSlugSchema.optional(),
        ...riderGate
      })
      .strict()
      .describe("Change the bearer's spell attack bonus. A Wand of the War Mage is exactly this and nothing else."),
    /** An extra spell slot of one level. Layered over the single-sourced slot maxima, so the seed, the Long Rest and the spend-clamp cannot disagree. */
    z
      .object({
        type: z.literal("spell-slot"),
        level: z.number().int().min(1).max(9),
        amount: z.number().int().min(-4).max(4),
        ...riderGate
      })
      .strict()
      .describe(
        "An extra spell slot of one level, layered over the single-sourced slot maxima so the seed, the Long Rest and the spend-clamp cannot disagree."
      )
  ])
  .describe(
    "The rider vocabulary: what a feature, a feat, a chosen option, a magic item and a live effect contribute to the rules engine, one union for every carrier and read by one evaluator against one context, so a bonus means the same thing wherever it is authored. Bounded and grown additively; anything not modeled stays prose (ADR-0008). Every amount is a signed integer, so a curse is this same vocabulary with a negative number, and every branch carries the `when`/`scope` gate. Carriers refuse what they cannot honour: an item refuses `hit-points-per-level`, `ability-score` (both bake into the sheet and cannot be un-granted when the item comes off) and `attunement-slots` (it would decide its own attunement), and an effect refuses every number stored on the sheet or the actor (`attunement-slots`, `ability-score`, `hit-points-per-level`, `armor-class`, `initiative`, `unarmored-defense`, `spell-slot`), which an effect that ends could never give back. Senses are read live, so an effect may carry them (True Seeing, the Darkvision spell)."
  );
export type Modifier = z.infer<typeof ModifierSchema>;

/**
 * Modifiers an effect may not carry: each is a number stored on the sheet or the actor (hit points, AC, initiative,
 * slot maxima), written when the character is built or its inventory changes, so an effect that ends could never give
 * it back. Senses aren't among them: dynamic vision reads them live from every carrier.
 */
export const EFFECT_REFUSED_MODIFIER_TYPES: readonly Modifier["type"][] = Object.freeze([
  "attunement-slots",
  "ability-score",
  "hit-points-per-level",
  "armor-class",
  "initiative",
  "unarmored-defense",
  "spell-slot"
]);

/** The light its bearer sheds while an effect lasts (Produce Flame's flame, Faerie Fire's outline, Holy Nimbus's
 *  sunlight): Bright Light out to `brightFeet` and Dim Light for `dimFeet` more. With `sunlight`, the Bright Light is
 *  sunlight, which Sunlight Sensitivity reads. */
export const CarriedLightSchema = z
  .object({
    brightFeet: z.number().int().min(0).max(240),
    dimFeet: z.number().int().min(0).max(240),
    sunlight: z.literal(true).optional()
  })
  .strict()
  .describe(
    "The light its bearer sheds while the effect lasts: Bright Light out to `brightFeet` and Dim Light for `dimFeet` more. With `sunlight`, the Bright Light is sunlight."
  );
export type CarriedLight = z.infer<typeof CarriedLightSchema>;

/** A sense an effect gives its bearer for creatures of some types (Divine Sense, Detect Evil and Good): it knows where
 *  each one within `feet` is and its creature type, unseen or not. With `blockedByWalls`, a wall between them hides
 *  one ("blocked by 1 foot of stone"). */
export const DetectsSchema = z
  .object({
    creatureTypes: z.array(RiderSlugSchema).min(1).max(14),
    feet: z.number().int().min(5).max(240),
    blockedByWalls: z.literal(true).optional()
  })
  .strict()
  .describe(
    "Creatures of these types within `feet` of the bearer whose place and type it knows, seen or not (Divine Sense); with `blockedByWalls`, not through a wall. Shown only to the bearer's player, on a scene with dynamic vision."
  );
export type Detects = z.infer<typeof DetectsSchema>;

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

/** What happens when an effect ends (a homebrew curse that leaves a level of Exhaustion behind). */
export const EffectOnEndSchema = z
  .object({
    type: z.literal("condition"),
    conditionId: ConditionIdSchema,
    level: z.number().int().min(1).max(6).optional()
  })
  .strict()
  .describe("What happens when the effect ends: a homebrew curse that leaves a level of Exhaustion behind.");

/** "Until the end of its next turn" belongs to a creature: the bearer's own turn, or the source's. `skipsCurrentTurn`
 * marks one that began during that creature's turn, so the end of that turn doesn't count and the next one does. */
const TurnEndDurationSchemas = [
  z.object({ type: z.literal("until-bearer-turn-end"), skipsCurrentTurn: z.boolean().default(false) }).strict(),
  z.object({ type: z.literal("until-source-turn-end"), skipsCurrentTurn: z.boolean().default(false) }).strict()
] as const;

/** The longest game-time span an effect counts: 366 days (Mass Suggestion and Planar Binding from a level 9 slot). */
export const MAX_EFFECT_MINUTES = 527_040;

/** A span of game time past ten minutes ("for 1 hour", "24 hours"), counted on the game clock: time the GM passes and
 *  rests use it up. Ten minutes or less count rounds, ten to a minute. */
const MinutesDurationSchema = z
  .object({ type: z.literal("minutes"), minutes: z.number().int().min(1).max(MAX_EFFECT_MINUTES) })
  .strict()
  .describe("A span of game time in minutes, used up as the game clock moves (time passing, rests).");

/** "Until you finish a Long Rest" (`long`), or "a Short or Long Rest" (`short`): the bearer's next rest of that kind
 *  ends it, whenever the clock says. */
const UntilRestDurationSchema = z
  .object({ type: z.literal("until-rest"), rest: z.enum(["short", "long"]) })
  .strict()
  .describe(
    'Until the bearer finishes a rest: "long" ends with its next Long Rest, "short" with its next Short or Long Rest.'
  );

/** How long a failed save's conditions last, as the text prints it: "for 1 minute" (10 rounds), "for 1 hour" (60
 * minutes of game time), "until the start of the X's next turn", "until the end of its next turn" (the target's) or
 * "until the end of your next turn" (the source's). `until-bearer-next-turn` is the start of the target's own next turn
 * (an aura it started its turn in). Absent: until something ends them (a Concentration spell's with its Concentration,
 * a spell's with its duration). */
export const SaveFailureDurationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("rounds"), rounds: z.number().int().min(1).max(100) }).strict(),
  MinutesDurationSchema,
  UntilRestDurationSchema,
  z.object({ type: z.literal("until-source-next-turn") }).strict(),
  z.object({ type: z.literal("until-bearer-next-turn") }).strict(),
  z.object({ type: z.literal("until-bearer-turn-end") }).strict(),
  z.object({ type: z.literal("until-source-turn-end") }).strict()
]);
export type SaveFailureDuration = z.infer<typeof SaveFailureDurationSchema>;

/** Damage a lasting effect deals as a turn starts or ends while it lasts: "takes 21 (6d6) Acid damage at the start of
 * each of the behir's turns" is the source's turn, "... of each of its turns" the bearer's. `hitPointLoss`: the
 * bearer loses the hit points instead (an infernal wound), which is no damage, so no type or defence applies. */
export const OngoingDamageSchema = z
  .object({
    damage: z
      .array(z.object({ formula: DiceFormulaSchema, type: DamageTypeSchema.optional() }).strict())
      .min(1)
      .max(2),
    at: z.enum(["bearer-turn-start", "source-turn-start", "bearer-turn-end", "source-turn-end"]),
    hitPointLoss: z.literal(true).optional()
  })
  .strict();
export type OngoingDamage = z.infer<typeof OngoingDamageSchema>;

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
      /** Game time left past ten minutes (Mage Armor's 8 hours), used up as the game clock moves. */
      z.object({ type: z.literal("minutes"), remaining: z.number().int().min(0).max(MAX_EFFECT_MINUTES) }).strict(),
      /** Until the bearer's next Long Rest, or Short or Long Rest (Contact Other Plane's Incapacitated). */
      UntilRestDurationSchema,
      z.object({ type: z.literal("until-source-next-turn") }).strict(),
      /** Until the start of the bearer's own next turn (a ghast's Stench, taken as that turn starts). */
      z.object({ type: z.literal("until-bearer-next-turn") }).strict(),
      ...TurnEndDurationSchemas,
      z.object({ type: z.literal("encounter") }).strict(),
      z.object({ type: z.literal("manual") }).strict()
    ]),
    /** Grapples etc.: the effect ends when its source actor drops to 0 HP or leaves the roster. */
    endsWhenSourceDefeated: z.boolean().default(false),
    /** Dodge: the effect's modifiers stop applying while the bearer is Incapacitated or its Speed is 0 (SRD). */
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
     * contribution with no sum (two Slows are -10). Absent or different keys sum. */
    stackKey: z
      .string()
      .regex(/^[a-z0-9:-]+$/)
      .max(60)
      .optional(),
    /** Extra movement granted for the current turn, fixed when granted (Dash), so a later Slow does not rewrite it.
     * On a `dashing` effect without it, `effectiveSpeedFeet` falls back to doubling Speed. */
    movementGrantFeet: z.number().int().min(0).max(999).optional(),
    /** A move an action or feature grants beside the turn's own movement ("moves up to half its Speed"), on the
     *  bearer's turn or off it: the feet left, the way it travels (any of its ways when absent), whether leaving an
     *  enemy's reach on it provokes Opportunity Attacks, and the turn it belongs to, which ends it. `straight`: it
     *  must end nearer an enemy (a charge). `owedActionId`: the action it came from still owes the rest of itself
     *  (Pounce taken move first). `awayFromActorId`: it must end farther from that creature (Dissonant Whispers);
     *  `towardActorId`: nearer it (Forceful Blow). `jump`: a leap over what lies between, which spends `costFeet` of
     *  the turn's own movement ("jumps up to 30 feet by spending 10 feet of movement"). */
    grantedMove: z
      .object({
        feet: z.number().int().min(0).max(999),
        mode: z.enum(["walk", "fly", "swim", "climb", "burrow"]).optional(),
        provokes: z.boolean(),
        straight: z.literal(true).optional(),
        jump: z.literal(true).optional(),
        costFeet: z.number().int().min(0).max(120).optional(),
        round: z.number().int().positive(),
        turnActorId: z.uuid().nullable(),
        owedActionId: z.string().min(1).max(120).optional(),
        awayFromActorId: z.uuid().optional(),
        towardActorId: z.uuid().optional()
      })
      .strict()
      .optional(),
    /** A teleport an action, spell or feature grants (Misty Step): up to `feet` to an unoccupied space the bearer can
     *  see, taken during the turn it belongs to with no movement spent. `failDamage`: arriving in a filled space fails
     *  and deals this Force damage instead (Dimension Door). */
    grantedTeleport: z
      .object({
        feet: z.number().int().min(5).max(10000),
        round: z.number().int().positive(),
        turnActorId: z.uuid().nullable(),
        unseen: z.literal(true).optional(),
        failDamage: DiceFormulaSchema.optional()
      })
      .strict()
      .optional(),
    /** A reaction's lasting AC bonus (Shield: +5 until the caster's next turn), added to the stored AC while the
     * effect lasts; a penalty is negative (Slow's -2). Kept apart from `modifiers`, whose `armor-class` is written onto
     * the sheet and would outlast it. */
    armorClassBonus: z.number().int().min(-10).max(10).optional(),
    /** Hit points this effect took off the bearer's Hit Point maximum (a Life Drain), given back when it ends. */
    hitPointMaximumLoss: z.number().int().min(1).max(10000).optional(),
    /** What this effect adds to the bearer's Hit Point maximum (Aid), taken back when it ends. */
    hitPointMaximumGain: z.number().int().min(1).max(1000).optional(),
    /** Conditions the bearer is immune to while this lasts (Heroism: Frightened). */
    conditionImmunities: z.array(ConditionIdSchema).max(6).optional(),
    /** Temporary Hit Points the bearer gains at the start of each of its turns while this lasts (Heroism). */
    temporaryHitPointsEachTurn: z.number().int().min(1).max(100).optional(),
    modifiers: EffectModifiersSchema.default([]),
    /** Conditions this effect applied to the same actor; removed automatically when the effect ends. */
    linkedConditionIds: z.array(ConditionIdSchema).max(4).default([]),
    /** The DC the Escape a Grapple action rolls against; a success ends the effect. */
    escapeDc: z.number().int().min(1).max(40).nullable().default(null),
    onEnd: z.array(EffectOnEndSchema).max(2).default([]),
    /** "Repeats the save at the end of each of its turns": the bearer owes this save as each of its turns ends, and
     * a success ends the effect (Hold Person, a ghast's claws). `disadvantageFrom` names what gives each repeat
     * Disadvantage (Heightened Spell). */
    repeatSave: z
      .object({
        ability: AbilitySchema,
        dc: z.number().int().min(1).max(40),
        disadvantageFrom: z.string().min(1).max(60).optional()
      })
      .strict()
      .optional(),
    /** Ends early when the bearer takes any damage (Sleep, Turn Undead, Hypnotic Pattern, a knocked-out creature). */
    endsOnDamage: z.boolean().optional(),
    /** Ends early when its source or one of the source's allies deals damage to the bearer (Charm Person). */
    endsOnSourceSideDamage: z.literal(true).optional(),
    /** The bearer's Speed is 0 while this lasts, beyond what its conditions do (Hypnotic Pattern's charm). */
    speedZero: z.boolean().optional(),
    /** One Concentration cast: every effect it made (the caster's marker, each failed target's conditions) shares
     * this, so they end together, and starting another Concentration ends them all. */
    castId: z.string().min(1).max(120).optional(),
    /** A grapple's range: it ends once a move leaves the bearer and its source farther apart than this. */
    rangeFeet: z.number().int().min(5).max(120).optional(),
    /** Damage it deals at the start of a turn while it lasts (a swallowed creature's acid), and a save the bearer
     * makes right after it, a success ending the effect (Searing Smite). */
    ongoingDamage: OngoingDamageSchema.extend({
      saveToEnd: z
        .object({ ability: AbilitySchema, dc: z.number().int().min(1).max(40) })
        .strict()
        .optional()
    })
      .strict()
      .optional(),
    /** How many more times its damage riders may land before it ends (a coat of Basic Poison). */
    damageUses: z.number().int().min(1).max(10).optional(),
    /** A Ready action's held spell (SRD Ready): the action that casts it, released with the Reaction at the level its
     *  slot was spent at when it was readied. `raysLeft`: the attacks a released spell still has to make with that
     *  one Reaction (Scorching Ray's later rays). */
    readiedSpell: z
      .object({
        actionId: z.string().min(1).max(120),
        level: z.number().int().min(0).max(9),
        raysLeft: z.number().int().min(1).max(20).optional(),
        /** How the caster shaped it when it was readied (Metamagic), which its release keeps. */
        shaping: z.array(CastShapingSchema).max(4).optional()
      })
      .strict()
      .optional(),
    /** The spell that made this effect and the level it was cast at: on its caster, so what the spell lets the caster
     *  do on later turns (Spiritual Weapon's attack) is offered while it lasts, at that level; on any creature, so
     *  Dispel Magic can weigh it. */
    spell: z
      .object({
        id: z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .max(80),
        level: z.number().int().min(0).max(9)
      })
      .strict()
      .optional(),
    /** It comes from a spell or a magic item, so a save repeated against it is one Magic Resistance helps with. */
    magical: z.literal(true).optional(),
    /** It ends when a spell restores the bearer's hit points (an infernal wound). */
    endsOnSpellHealing: z.literal(true).optional(),
    /** On a caster's Concentration: the spell is nothing but what it leaves on creatures (Hold Person's paralysis,
     *  Bless's d4), so it ends once no living creature keeps any of it. */
    endsWhenUnaffected: z.literal(true).optional(),
    /** The bearer's Speed is multiplied by this after every other change (Haste: doubled), its special speeds too. */
    speedMultiplier: z.number().int().min(2).max(4).optional(),
    /** A way to work out base AC while the bearer wears no armor: this plus its Dexterity modifier, a Shield adding
     *  (Mage Armor's 13). The best of its ways counts, and AC bonuses add to it. */
    baseArmorClass: z.number().int().min(11).max(20).optional(),
    /** The bearer's AC is at least this while it lasts (Barkskin's 17). */
    armorClassFloor: z.number().int().min(10).max(25).optional(),
    /** A spell its bearer is casting over a minute or more in a fight (SRD Longer Casting Times): the cast it finishes,
     *  with the targets, slot level and shaping (Metamagic) picked when it began, the turns' actions it still needs, and
     *  the round of the last one, so a turn without one lets it lapse. */
    longCast: z
      .object({
        actionId: z.string().min(1).max(120),
        targetIds: z.array(z.uuid()).max(40),
        slotLevel: z.number().int().min(1).max(9).nullable(),
        areaPlaced: z.boolean().default(false),
        shaping: z.array(CastShapingSchema).max(4).optional(),
        turnsLeft: z.number().int().min(0).max(15000),
        lastRound: z.number().int().positive()
      })
      .strict()
      .optional(),
    /** A roll its bearer may answer with it, which ends it (a Bardic Inspiration die). */
    answer: RollAnswerSchema.optional(),
    /** What a melee hit on its bearer costs the attacker (Fire Shield's 2d8). */
    struck: StruckSchema.optional(),
    /** The light its bearer sheds while it lasts (Produce Flame's flame, Faerie Fire's outline), read by dynamic
     *  vision as a light the bearer's token carries. */
    light: CarriedLightSchema.optional(),
    /** A Hide's Dexterity (Stealth) total: "the DC for a creature to find you with a Wisdom (Perception) check". */
    findDc: z.number().int().min(1).max(60).optional(),
    /** The creatures it lets its bearer sense (Divine Sense), shown to the bearer's player alone. */
    detects: DetectsSchema.optional()
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
    /** The spell a Spell Scroll bears, picked when it is added. The server checks it against the scroll's levels;
     *  every copy in the row bears it. */
    spellId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80)
      .optional(),
    /** Ammunition pieces left in a row sold in bundles ("Arrows (20)"), when some are spent; absent = every bundle
     *  full. The server keeps it: shots spend it and a quantity change moves it by whole bundles. */
    ammunitionLeft: z.number().int().min(0).max(1_000_000).optional(),
    /** Pieces fired from this row in the running fight that can be picked up after it (half come back). The
     *  server keeps it. */
    ammunitionFired: z.number().int().min(0).max(10_000).optional(),
    /** A light source in hand is burning (a Torch, a Lamp, a Flame Tongue's flames). Dynamic vision lights its bearer
     *  while it is lit and equipped. The server keeps it. */
    lit: z.boolean().optional(),
    /** A Hooded Lantern's hood is down: Dim Light in 5 feet only. */
    hoodLowered: z.literal(true).optional(),
    /** Where a Bullseye Lantern's Cone points, in degrees from the right of the map, clockwise. */
    facingDegrees: z.number().min(0).max(360).optional(),
    /** The game hour (`rest.clockHours`) a lit Torch, Candle or flask of Oil burns out at. */
    burnsOutAtHour: z.number().int().min(0).max(10_000_000).optional(),
    /** Hours of burning left in a light that was put out before it burned down. */
    burnHoursLeft: z.number().int().min(0).max(24).optional(),
    /** Display-only marker so the sheet can offer Attune without the catalog; never the riders. */
    magic: ItemMagicMarkerSchema.optional(),
    /** A copy whose magic is spent for now: a manual or tome after its study (`character.study-item`), until it
     *  regains it in a century. The server keeps it. */
    dormant: z.boolean().optional()
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
 *   - `{die, maximum, remaining}`: an older single-die save.
 *   - `[{die, maximum, remaining}, ...]`: a bare pool array.
 *   - `{die, maximum, remaining, entries[]}`: the current shape; the summary is re-derived, never trusted.
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

/** Build a pool (summary included) from per-die entries. An empty pool is `null`, meaning "not modeled". */
export function makeHitDicePool(entries: readonly HitDiceEntry[]): HitDicePool | null {
  return entries.length === 0 ? null : (HitDicePoolSchema.parse(entries) as HitDicePool);
}

/** An option on a character's action list (`item-greatsword`, `spell-fireball`, `dash`), as the availability read
 *  names it. */
export const OptionIdSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .max(160);
/** How many options a character may pin to the sheet's turn card. */
export const MAX_FAVOURITE_OPTIONS = 8;
/** How many options a character's use counts keep; the least used gives way to a new one. */
export const MAX_COUNTED_OPTIONS = 32;
export const MAX_OPTION_USE_COUNT = 100_000;

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
          level: z.number().int().min(1).max(6).optional(),
          /** The owning player put it on their own character, so they may take it off again. Anything imposed (by
           * the GM, a failed save, the engine) ends by its own rules or the GM's say. */
          selfApplied: z.literal(true).optional(),
          /** Set on its own as well as linked by an effect, so that effect ending leaves it in place. */
          standalone: z.literal(true).optional()
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
  /** When each spent pool that comes back after a time is ready again (Wings of Flying's 1d12 hours): the game-clock
   *  minute, and the pool's name for the line the table reads. Keyed as `actionUses`. Owner-only. */
  readyAt: z
    .record(
      z.string(),
      z.object({ minute: z.number().int().min(0).max(1_000_000_000), name: z.string().min(1).max(120) }).strict()
    )
    .default({}),
  /** SRD Heroic Inspiration: held or not (never more than one). Spent to reroll one die; the GM gives it, and a Human
   * gains it on finishing a Long Rest. */
  heroicInspiration: z.boolean().default(false),
  /** A second Heroic Inspiration gained while holding one (SRD: "the excess is lost unless you give it to a player
   *  character who lacks it"): its player gives it or lets it go. Player characters only. */
  heroicInspirationToGive: z.boolean().optional(),
  /** A player character's Experience Points, which the GM awards (`actor.award-experience`). Absent until the first
   *  award, when it starts at the least XP the character's level needs. */
  experiencePoints: z.number().int().min(0).max(10_000_000).optional(),
  /** Picks re-made on a rest, keyed by offer key; no rebuild needed. `per` is the rest after which it may be re-made;
   * it stands until the character chooses again. */
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
  /** The game hour (`rest.clockHours`) this creature's last Long Rest ended; null before its first. Another may start
   * 16 hours later (SRD Resting). GM-only: a refused rest explains the wait. */
  lastLongRestAt: z.number().int().min(0).max(10_000_000).nullable().default(null),
  /** Per-token health-display override; absent = inherit `combat.healthDisplay`. Audience-gated in the player/viewer projections. */
  healthDisplay: HealthDisplaySchema.optional(),
  /** Epoch ms when this actor last entered a fight; powers the scene-setup "Recent" list. GM-only, stripped from the player projection. */
  lastUsedAt: z.number().int().nonnegative().optional(),
  /** Epoch ms when a player first claimed this character. With `lastUsedAt` it says whether a character was ever
   *  played; one never played can be deleted straight from the roster. GM-only. */
  firstClaimedAt: z.number().int().nonnegative().optional(),
  /** One of the sample party a fresh table starts with. The roster labels it and can remove the set. GM-only. */
  sample: z.literal(true).optional(),
  /** Live spell-slot pools by level, restored by rests; null = not a modeled spellcaster. Owner-only in projections. */
  spellSlots: z.array(SpellSlotSchema).max(9).nullable().default(null),
  /** Warlock Pact Magic pool (one level, uniform slots); null = none. Owner-only in projections. */
  pactSlots: z
    .object({ level: z.number().int().min(1).max(5), remaining: z.number().int().min(0).max(4) })
    .strict()
    .nullable()
    .default(null),
  /** Spell ids prepared right now, re-chosen on a Long Rest. Owner-only. */
  preparedSpellIds: z.array(z.string().max(80)).max(400).default([]),
  /** A Wizard's spellbook beyond the Wizard spells on its sheet: spells its Wizard levels added that the build didn't
   *  list, and spells copied in (`copied`: from a scroll or another book, paid for). Owner-only. */
  spellbook: z
    .array(
      z
        .object({
          id: z
            .string()
            .regex(/^[a-z0-9-]+$/)
            .max(80),
          copied: z.literal(true).optional()
        })
        .strict()
    )
    .max(300)
    .default([]),
  /** Open after a Long Rest for a caster that changes its prepared spells then (SRD Spell Preparation by Class): the
   *  spells it may still swap in (null: any number). Null when closed. Owner-only. */
  preparation: z
    .object({ changesLeft: z.number().int().min(0).max(60).nullable() })
    .strict()
    .nullable()
    .default(null),
  /** Open after a rest the character finished, for what a feature lets it do "when you finish" that rest: recover
   *  slots or points (Arcane Recovery, Sorcerous Restoration), or re-make a pick. Closed by its player's Done or by
   *  rolling Initiative. Null when closed. Owner-only. */
  restStep: z
    .object({
      after: z.enum(["short-rest", "long-rest"]),
      /** Answers swapped in this step, by offer key, for a pick that lets only so many change each rest. */
      swaps: z.record(z.string(), z.number().int().min(0).max(20)).optional()
    })
    .strict()
    .nullable()
    .default(null),
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
  sheetPreview: z.boolean().default(false),
  /** The options the owner pinned to the sheet's turn card, in order: ids from the character's action list. Owner and
   *  GM only. */
  favouriteOptionIds: z
    .array(OptionIdSchema)
    .max(MAX_FAVOURITE_OPTIONS)
    .refine((ids) => new Set(ids).size === ids.length, "Each option may be pinned once.")
    .optional(),
  /** How many times each option resolved for this character, which fills the turn card before anything is pinned.
   *  The server writes it and keeps it to a bounded number of ids. Owner and GM only. */
  optionUseCounts: z
    .record(OptionIdSchema, z.number().int().min(1).max(MAX_OPTION_USE_COUNT))
    .refine(
      (counts) => Object.keys(counts).length <= MAX_COUNTED_OPTIONS,
      `At most ${MAX_COUNTED_OPTIONS} options are counted.`
    )
    .optional()
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
    duration: z
      .discriminatedUnion("type", [
        z
          .object({ type: z.literal("rounds"), rounds: z.number().int().min(1).max(100) })
          .strict()
          .describe("A fixed number of rounds."),
        MinutesDurationSchema,
        UntilRestDurationSchema,
        z
          .object({ type: z.literal("until-source-next-turn") })
          .strict()
          .describe("Until the granting creature's next turn begins."),
        /** Until the start of the recipient's own next turn (Shocking Grasp: "until the start of its next turn"). */
        z.object({ type: z.literal("until-bearer-next-turn") }).strict(),
        /** Until the end of the granter's next turn (Rage, which the bearer's own attacks keep extending). */
        z
          .object({ type: z.literal("until-source-turn-end") })
          .strict()
          .describe("Until the end of the granting creature's next turn (Rage, which its attacks keep extending)."),
        z
          .object({ type: z.literal("encounter") })
          .strict()
          .describe("Until the encounter ends."),
        z
          .object({ type: z.literal("manual") })
          .strict()
          .describe("Until the GM clears it.")
      ])
      .describe("How long the effect lasts."),
    modifiers: EffectModifiersSchema.default([]).describe(
      "What the effect does while it lasts, gates included, in the shared rider vocabulary. Refused here: every modifier the sheet or the actor stores (ability-score, hit-points-per-level, armor-class, initiative, unarmored-defense, spell-slot), which an effect that ends could not give back."
    ),
    /** The light its bearer sheds while it lasts (Produce Flame, Fire Shield, Sacred Weapon). */
    light: CarriedLightSchema.optional().describe(
      "The light its bearer sheds while it lasts, carried with its token (Produce Flame's flame, Holy Nimbus's sunlight)"
    ),
    /** The creatures it lets its bearer sense while it lasts (Divine Sense). */
    detects: DetectsSchema.optional(),
    onEnd: z.array(EffectOnEndSchema).max(2).default([]),
    /** The granted effect ends when the actor loses every other effect with this tag (Frenzy's marker ends with the Rage). */
    endsWithTag: EffectTagSchema.optional().describe(
      "The granted effect ends when the actor loses every other effect with this tag (Frenzy's marker ends with the Rage)"
    ),
    /** Who receives the effect: the acting creature (default) or the action's single chosen target (Help). */
    target: z
      .enum(["self", "target"])
      .default("self")
      .describe("Who receives it: the acting creature, or the action's single chosen target (Help)"),
    /** Dodge: benefits lapse while the bearer is Incapacitated or its Speed is 0 (SRD). */
    voidWhileIncapacitated: z
      .boolean()
      .default(false)
      .describe("Benefits lapse while the bearer is incapacitated or its Speed is 0 (Dodge)"),
    /** The granter concentrates to sustain the effect (SRD Concentration). */
    concentration: z.boolean().default(false),
    /** Its damage riders land this many times, then it ends (Basic Poison: one coated weapon's hit, or three
     *  pieces of ammunition). */
    damageUses: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe(
        "The effect ends once its damage riders have landed this many times (a coat of Basic Poison: one weapon hit, or three pieces of ammunition)"
      )
  })
  .strict()
  .describe(
    "An effect a feature or action grants, in the same vocabulary the live rules engine already resolves on an actor, reused as it is, so a homebrew Rage behaves exactly like the bundled one."
  );

/** An action's grant: the effect shape, which may also go to every creature the action targets (Bless), land only
 *  when its attack hits (Guiding Bolt's light), and add to AC while it lasts (Shield of Faith). */
export const ActionGrantSchema = EffectGrantSchema.extend({
  target: z.enum(["self", "target", "targets"]).default("self"),
  onHit: z.boolean().optional(),
  /** Kept apart from `modifiers`, whose `armor-class` is written onto the sheet, like a reaction's lasting bonus. */
  armorClassBonus: z.number().int().min(1).max(10).optional(),
  /** Conditions the recipient is immune to while it lasts (Heroism: Frightened). */
  conditionImmunities: z.array(ConditionIdSchema).min(1).max(6).optional(),
  /** Conditions the recipient has while it lasts, which end with it (Greater Invisibility: Invisible). */
  conditions: z.array(ConditionIdSchema).min(1).max(3).optional(),
  /** Temporary Hit Points the recipient gains at the start of each of its turns (Heroism: the caster's spellcasting
   *  ability modifier, fixed when the spell is cast). */
  temporaryHitPointsEachTurn: z
    .union([z.number().int().min(1).max(100), z.literal("spellcasting-modifier")])
    .optional(),
  /** What the recipient's Hit Point maximum and current hit points rise by while it lasts (Aid's 5), `perSlot` more for
   *  each slot level above the spell's. */
  hitPointMaximumGain: z
    .object({ amount: z.number().int().min(1).max(100), perSlot: z.number().int().min(1).max(50).optional() })
    .strict()
    .optional(),
  /** The recipient's Speed is multiplied by this while it lasts, after every other change (Haste: 2). */
  speedMultiplier: z.number().int().min(2).max(4).optional(),
  /** A base AC the recipient may use while it wears no armor: this plus its Dexterity modifier, a Shield adding
   *  (Mage Armor: 13). */
  baseArmorClass: z.number().int().min(11).max(20).optional(),
  /** The recipient's AC is at least this while it lasts (Barkskin: 17). */
  armorClassFloor: z.number().int().min(10).max(25).optional(),
  /** A roll the recipient may answer with it, which ends it (Bardic Inspiration: add the die to a failed D20 Test). */
  answer: RollAnswerSchema.optional(),
  /** What a melee hit on the recipient costs the attacker while it lasts (Fire Shield's 2d8). */
  struck: StruckSchema.optional(),
  /** The recipient may hold only one effect with these tags at a time ("A creature can have only one Bardic
   *  Inspiration die at a time"): a grant to a creature that holds one is refused. */
  onlyOne: z.literal(true).optional(),
  /** Only another creature may receive it ("inspire another creature"). */
  notSelf: z.literal(true).optional()
}).strict();

/** The most a limited-use pool can hold: Lay on Hands at Paladin 20 is 100 points. */
export const MAX_ACTION_USES = 100;

/** Hours of game time, as the SRD prints a wait: dice ("1d12") or a number ("168" for 7 days). */
export const HoursSchema = z
  .string()
  .regex(/^(?:\d+d(?:4|6|8|10|12|20)(?:\s*[+-]\s*\d+)?|\d{1,4})$/i, "Use hours as dice such as 1d12, or a number.");

/** Limited uses. "turn"/"encounter"/rests reset as named; "own-turn" at the start of the bearer's next turn ("you
 * can't use it again until the start of your next turn"); "recharge" on a start-of-turn d6 >= `recharge`; "never"
 * never comes back; "time" once `afterHours` of game time pass from its first use (Wings of Flying's 1d12 hours).
 * `pool` shares one counter across actions (Sneak Attack once per turn regardless of weapon). */
export const ActionUsesSchema = z
  .object({
    limit: z.number().int().min(1).max(MAX_ACTION_USES),
    per: z.enum(["turn", "own-turn", "encounter", "long-rest", "short-rest", "recharge", "never", "time"]),
    pool: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(60)
      .optional()
      .describe(
        "Shares one counter across actions carrying the same pool id (Sneak Attack once per turn regardless of weapon)"
      ),
    recharge: z.number().int().min(2).max(6).optional().describe('The d6 threshold, e.g. 5 for "Recharge 5-6"'),
    afterHours: HoursSchema.optional().describe(
      'With per "time": the hours of game time after its first use that it comes back, rolled then (Wings of Flying: 1d12)'
    )
  })
  .strict()
  .superRefine((uses, context) => {
    if ((uses.per === "time") !== (uses.afterHours !== undefined))
      context.addIssue({
        code: "custom",
        path: ["afterHours"],
        message: "Uses that come back after a time need the hours (afterHours), and only they take them."
      });
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
  })
  .describe(
    'Limited uses for an action. Unlike a feature\'s, this vocabulary includes "recharge": a start-of-turn d6 at or above `recharge` (and any rest) restores it. `recharge` must be present when `per` is "recharge" and absent otherwise; the server enforces the biconditional.'
  );

/** The conditions a failed save can impose. Closed because the engine applies the id itself. Exhaustion is
 * left out: it stacks by level, and a plain condition write would reset the stack, where each failed save should add a level. */
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

/** Forced movement straight away from the creature that causes it (SRD): Thunderwave's 10 feet, a fire giant's Hammer
 *  Throw "up to 15 feet". `upTo` lets the source stop it short; `maxTargetSize` is the largest creature it moves. */
export const ForcedPushSchema = z
  .object({
    feet: z.number().int().min(5).max(120),
    upTo: z.literal(true).optional(),
    maxTargetSize: SizeSchema.optional()
  })
  .strict();
export type ForcedPush = z.infer<typeof ForcedPushSchema>;

/**
 * What a saving throw does, as data: the damage a success takes ("half" for Fireball, "none" for Sacred
 * Flame) and the condition a failure imposes. Every save block (stat-block action, feature action, spell)
 * spreads these fields. Unset, they take the common printing: half damage on a success, no condition.
 */
export const SaveOutcomeFields = {
  successDamage: z
    .enum(["half", "none"])
    .default("half")
    .describe('The damage a successful save takes: "half" (Fireball) or "none" (Sacred Flame)'),
  /** Every condition a failed save imposes (Turn Undead: Frightened and Incapacitated). */
  failureConditions: z
    .array(SaveConditionSchema)
    .max(4)
    .default([])
    .describe(
      "Every condition a failed save imposes (Turn Undead: Frightened and Incapacitated); empty for none. Exhaustion is not offered: it stacks by level"
    ),
  /** The condition is the caster's pick from these ("has the Blinded or Deafened condition"); `failureConditions`
   *  holds the first, which a failure imposes when none is picked. */
  conditionChoices: z.array(SaveConditionSchema).min(2).max(6).optional(),
  /** Cover gives no bonus to this save (Sacred Flame: "The target gains no benefit from Half Cover or
   *  Three-Quarters Cover for this save"). */
  ignoresCover: z.boolean().optional(),
  /** How long the failure's conditions last. Absent: until ended (with the caster's Concentration, for a spell). */
  failureDuration: SaveFailureDurationSchema.optional().describe(
    'How long the failure\'s conditions last, read from the text: "for 1 minute" (rounds), "until the start of the X\'s next turn", "until the end of its next turn" (the target\'s) or "until the end of your next turn" (the source\'s). Absent: until ended, or with the caster\'s Concentration'
  ),
  /** The target repeats the save at the end of each of its turns, a success ending the failure's conditions. */
  repeatSave: z
    .literal(true)
    .optional()
    .describe("The target repeats the save at the end of each of its turns; a success ends the failure's conditions"),
  /** A failure that grapples: the grapple's escape DC. Its other conditions last until the grapple ends. */
  escapeDc: z
    .number()
    .int()
    .min(1)
    .max(40)
    .optional()
    .describe(
      "A failure that grapples: the grapple's escape DC. Its other conditions last until the grapple ends. On a failure that restrains without grappling (a Net, a Rope of Entanglement), the DC its creature escapes it with"
    ),
  /** The escape is a Strength (Athletics) check alone (a Net: "a DC 10 Strength (Athletics) check"). */
  escapeAthletics: z
    .literal(true)
    .optional()
    .describe("The escape is a Strength (Athletics) check alone, not Athletics or Acrobatics"),
  /** The failure's conditions end early if the target takes any damage (Turn Undead, Hypnotic Pattern). */
  endsOnDamage: z
    .literal(true)
    .optional()
    .describe("The failure's conditions end early if the target takes any damage"),
  /** They end early when the source or one of its allies deals damage to the target (Charm Person: "until you or your
   *  allies damage it"). */
  endsOnSourceSideDamage: z
    .literal(true)
    .optional()
    .describe("The failure's conditions end early when the source or one of its allies deals damage to the target"),
  /** The failure also makes the target's Speed 0 while its conditions last (Hypnotic Pattern). */
  speedZero: z
    .literal(true)
    .optional()
    .describe("The failure also makes the target's Speed 0 while its conditions last (Hypnotic Pattern)"),
  /** The save's reach ("within 10 feet"): a grapple it imposes ends once a move takes the two farther apart. */
  rangeFeet: z
    .number()
    .int()
    .min(5)
    .max(120)
    .optional()
    .describe("The save's reach: a grapple it imposes ends once a move takes the two farther apart"),
  /** No save when it lands: a target with this many hit points or fewer has the failure outright, and only the
   * repeated save can end it (Power Word Stun's 150); one with more is spared. */
  failsAtHitPoints: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe(
      "No save when it lands: a target with this many hit points or fewer has the failure outright and only the repeated save ends it (Power Word Stun)"
    ),
  /** Damage the failure's conditions bring at the start of each turn while they last (a swallow's acid). */
  ongoingDamage: OngoingDamageSchema.optional().describe(
    "Damage the failure's conditions bring at the start of each turn while they last, rolled and applied by the engine: on the target's own turns (bearer-turn-start) or the source's (source-turn-start, a swallow's acid)"
  ),
  /** What else a failure starts, from the SRD's own rules: "burning" (Rules Glossary Burning: 1d4 Fire at the start of
   * each of its turns until it is put out) or "oil" (covered in Oil: Fire damage before the oil dries, within 1
   * minute, brings 5 more Fire damage). */
  failureHazard: z
    .enum(["burning", "oil"])
    .optional()
    .describe(
      'A hazard a failure starts, by the SRD\'s own rules: "burning" (1d4 Fire at the start of each of its turns until the burning creature uses an action to put it out, Alchemist\'s Fire) or "oil" (Fire damage it takes in the next minute deals 5 more Fire damage, Oil)'
    ),
  /** A failure also pushes the creature straight away from the source (Thunderwave: "is pushed 10 feet away from
   *  you"). */
  failurePush: ForcedPushSchema.optional(),
  /** A creature this size or larger has Advantage on the save (Ensnaring Strike: "A Large or larger creature has
   *  Advantage on this save"). */
  advantageAtSize: SizeSchema.optional()
};

/** An area of effect the GM places as a map template ("60-foot Cone"). `widthFeet` is a line's width, null otherwise. */
export const ActionAreaSchema = z
  .object({
    shape: z.enum(["cone", "line", "sphere", "cube", "emanation", "cylinder"]),
    sizeFeet: z.number().int().min(1).max(1000),
    widthFeet: z.number().int().min(1).max(100).nullable()
  })
  .strict();
export type ActionArea = z.infer<typeof ActionAreaSchema>;

/**
 * What a spell or an action does to light and sight while it lasts (SRD Rules Glossary: Bright Light, Dim Light,
 * Heavily Obscured; the Darkness and Daylight spells). It lasts as long as what keeps it: the caster's Concentration,
 * the lasting effect its cast leaves, or `rounds`, else until it is cast again or the GM removes it.
 */
export const SightEffectSchema = z
  .object({
    /** A light it makes: carried by its user (`caster`: Produce Flame), by each creature it targets (`targets`, its user
     *  when it names none: Light), filling the area it places (`area`: Moonbeam's Cylinder, Daylight's Sphere), or
     *  `count` lights set at its user's feet to be moved (`point`: Dancing Lights). */
    light: z
      .object({
        on: z.enum(["caster", "targets", "area", "point"]),
        brightFeet: z.number().int().min(0).max(240),
        dimFeet: z.number().int().min(0).max(240),
        sunlight: z.literal(true).optional(),
        count: z.number().int().min(1).max(4).optional()
      })
      .strict()
      .optional(),
    /** An area of obscurement or magical Darkness: the area it places on the map, or with `aroundSelfFeet` an
     *  Emanation round its user that moves with it (a darkmantle's Darkness Aura). */
    area: z
      .object({
        kind: z.enum(["lightly-obscured", "heavily-obscured", "magical-darkness"]),
        aroundSelfFeet: z.number().int().min(5).max(120).optional(),
        /** Its user sees through it ("Heavily Obscured for creatures other than you": Insect Cloud). */
        sparesUser: z.literal(true).optional()
      })
      .strict()
      .optional(),
    /** Spell-made light (`light`), magical Darkness (`darkness`) or fog and clouds (`fog`: Gust of Wind) of a spell of
     *  `upToLevel` or lower that its area overlaps is dispelled (Darkness: light of level 2 or lower; Daylight: Darkness
     *  of level 3 or lower). With no level, any (Sunburst). */
    dispels: z
      .object({
        kind: z.enum(["light", "darkness", "fog"]),
        upToLevel: z.number().int().min(0).max(9).optional()
      })
      .strict()
      .optional(),
    /** How many rounds it lasts when nothing else keeps it (an octopus's ink: 1 minute). */
    rounds: z.number().int().min(1).max(100).optional(),
    /** Using it again puts out what the last use made instead of making more (a magmin "sets itself ablaze or
     *  extinguishes its flames"). */
    toggles: z.literal(true).optional(),
    /** Usable only while its user stands in Dim Light or Darkness (Merge with Shadows), read with dynamic vision on. */
    inDimLightOrDarkness: z.literal(true).optional(),
    /** Its save reaches only a creature that can see its user (a ghost's Horrific Visage: "each creature ... that can
     *  see the ghost") or its area (Hypnotic Pattern: "who can see the pattern"); the server's sight decides. */
    seenBy: z.enum(["user", "area"]).optional()
  })
  .strict()
  .describe(
    "What it does to light and sight while it lasts: a light it makes (on its user, its targets, its area or set down), an area of obscurement or magical Darkness, the spell light or Darkness it dispels, and whether it works only in Dim Light or Darkness."
  );
export type SightEffect = z.infer<typeof SightEffectSchema>;

const ReactionRangeFeet = z.number().int().min(5).max(1000).optional();

/** The attack kinds a damage reaction can be limited to ("an attack roll made with a Ranged or Thrown weapon"). */
const ReactionAttackKindSchema = z.enum(["melee", "ranged", "melee-weapon", "ranged-weapon", "thrown", "spell"]);

/**
 * A reaction the engine offers as a prompt when its trigger happens (ADR-0020); only meaningful on activation
 * "reaction". The response is what answering "use" does:
 * - half-damage (Uncanny Dodge): halve the hit's damage.
 * - reduce-damage (Deflect Attacks, Stone's Endurance): roll `formula` and take it off the damage, on a hit
 *   (`hit-by-attack`, limited to `damageTypes` it includes and `attackKinds` it was made as) or on any damage the
 *   reactor is about to take (`takes-damage`, from a hit or a failed save).
 * - resist-type (Superior Hunter's Defense): Resistance to the damage's type until the end of the current turn, the
 *   triggering damage included.
 * - ac-bonus (Parry, Shield): add `amount` to AC against the attack before it lands, possibly turning the hit into a
 *   miss. `melee` limits it to melee attacks; `untilNextTurn` keeps the bonus until the reactor's next turn starts.
 * - strike-back (Hellish Rebuke, Storm's Thunder): resolve this action against the creature that dealt the damage, or
 *   the sibling action `usesAction` names (a rust monster's Antennae).
 * - melee-attack (Retaliation): make one melee attack against that creature instead.
 * - counter (Counterspell): a creature the reactor can see casts a spell with components; the cast waits, and "use"
 *   makes the caster roll an `ability` saving throw against the reactor's spell save DC, its spell lost on a failure.
 * `rangeFeet` skips the prompt when the map shows the damaging or casting creature farther away.
 */
export const ActionReactionSchema = z.discriminatedUnion("response", [
  z.object({ trigger: z.literal("hit-by-attack"), response: z.literal("half-damage") }).strict(),
  z
    .object({
      trigger: z.enum(["hit-by-attack", "takes-damage"]),
      response: z.literal("reduce-damage"),
      formula: DamageFormulaSchema,
      damageTypes: z.array(DamageTypeSchema).min(1).max(13).optional(),
      attackKinds: z.array(ReactionAttackKindSchema).min(1).max(6).optional()
    })
    .strict(),
  z.object({ trigger: z.literal("takes-damage"), response: z.literal("resist-type") }).strict(),
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
      rangeFeet: ReactionRangeFeet,
      /** The sibling action it uses instead of itself ("The rust monster uses Antennae"). */
      usesAction: z
        .string()
        .regex(/^[a-z0-9-]+$/)
        .max(120)
        .optional()
    })
    .strict(),
  z
    .object({
      trigger: z.literal("damaged-by-creature"),
      response: z.literal("melee-attack"),
      rangeFeet: ReactionRangeFeet
    })
    .strict(),
  /** Feather Fall: when the reactor or a creature it can see within `rangeFeet` falls, this action lands on the
   *  falling creature before the fall does. */
  z
    .object({ trigger: z.literal("falls"), response: z.literal("cast-on-faller"), rangeFeet: ReactionRangeFeet })
    .strict(),
  /** Slow Fall: when the reactor itself falls, the fall's damage is reduced by `perLevel` times its level in
   *  `classId`. */
  z
    .object({
      trigger: z.literal("falls"),
      response: z.literal("reduce-fall-damage"),
      perLevel: z.number().int().min(1).max(10),
      classId: z
        .string()
        .regex(/^[a-z0-9-]+$/)
        .max(60)
    })
    .strict(),
  z
    .object({
      trigger: z.literal("casts-spell"),
      response: z.literal("counter"),
      ability: AbilitySchema,
      rangeFeet: ReactionRangeFeet
    })
    .strict()
]);
export type ActionReaction = z.infer<typeof ActionReactionSchema>;

/** What a failed save leaves on the creature: a named effect with typed modifiers, for a number of rounds (absent:
 *  until ended). */
export const SaveFailureEffectSchema = z
  .object({
    name: z.string().min(1).max(120),
    tags: z.array(EffectTagSchema).max(8).default([]),
    /** As the text prints it ("until the start of your next turn"); the save's own `failureDuration` wins. */
    duration: SaveFailureDurationSchema.optional(),
    modifiers: EffectModifiersSchema.default([]),
    /** What it adds to AC while it lasts; Slow's -2 is a penalty. Kept apart from `modifiers`, as on an effect. */
    armorClassBonus: z.number().int().min(-10).max(10).optional(),
    /** It ends when a spell restores the bearer's hit points ("The wound closes after ... a spell restores Hit Points"). */
    endsOnSpellHealing: z.literal(true).optional(),
    /** The light the creature sheds while it lasts (Faerie Fire: "Each creature ... sheds Dim Light"). */
    light: CarriedLightSchema.optional()
  })
  .strict();

/** How an action ends the spells on its target (SRD Dispel Magic): every spell of `automaticLevel` or lower ends, and
 *  each higher one takes a check. */
export const DispelSchema = z
  .object({ automaticLevel: z.number().int().min(0).max(9) })
  .strict()
  .describe(
    "Ends the spells on its target: each of this level or lower outright (a higher slot raises it to the slot's level), each higher one on a spellcasting ability check against DC 10 plus its level"
  );
export type Dispel = z.infer<typeof DispelSchema>;

/** What bursts after an attack, hit or miss (Ice Knife's shard): the target and each creature within `radiusFeet` of it
 *  make the save, a failure taking `damage`, and `diceAddedPerSlot` more dice for each slot level above the spell's. */
export const BurstSchema = z
  .object({
    radiusFeet: z.number().int().min(5).max(60),
    ability: AbilitySchema,
    damage: z
      .array(z.object({ formula: DamageFormulaSchema, type: z.string().min(1).max(40) }).strict())
      .min(1)
      .max(3),
    diceAddedPerSlot: z.number().int().min(1).max(4).optional()
  })
  .strict();
export type Burst = z.infer<typeof BurstSchema>;

/** What damage takes besides hit points as it lands (SRD Life Drain, Vampiric Touch, Harm): the target's Hit Point
 *  maximum decreases by the damage it took, and the creature that dealt it regains hit points from it. With a
 *  `damageType`, that type's damage alone counts ("equal to the Necrotic damage taken"). */
export const DamageDrainSchema = z
  .object({
    damageType: z.string().min(1).max(40).optional(),
    /** The Hit Point maximum decreases by the damage taken, until a Long Rest; at 0 the creature dies. */
    reducesMaximum: z.literal(true).optional(),
    /** It can't take the Hit Point maximum below 1 (Harm). */
    keepsOneMaximum: z.literal(true).optional(),
    /** How much of the damage taken the dealer regains as hit points. */
    heals: z.enum(["all", "half"]).optional(),
    /** Only a failed save drains (Harm, a wight's Life Drain). */
    failedSaveOnly: z.literal(true).optional()
  })
  .strict();
export type DamageDrain = z.infer<typeof DamageDrainSchema>;

/** Conditions a hit lands on its target as one source-linked effect (a crocodile's Bite: Grappled and Restrained, escape
 *  DC 15; Ray of Sickness: Poisoned until the end of the caster's next turn). */
export const OnHitRiderSchema = z
  .object({
    /** None when the hit leaves only its `name`d effect (a stirge attached, draining blood). */
    conditions: z
      .array(z.object({ id: ConditionIdSchema, level: z.number().int().min(1).max(6).optional() }).strict())
      .max(3),
    /** The effect's name when the text names what it is ("Attached"); absent, the first condition's. */
    name: z.string().min(1).max(60).optional(),
    /** Damage it deals as turns start while it lasts (a stirge's 2d4 Necrotic at the start of each of its turns). */
    ongoingDamage: OngoingDamageSchema.optional(),
    /** It lands in place of the hit's damage ("the rug can give it the Grappled condition ... instead of dealing
     *  damage"): a target it can't take still takes the damage. */
    insteadOfDamage: z.literal(true).optional(),
    escapeDc: z.number().int().min(1).max(40).optional(),
    /** The rider only applies to targets of at most this size (crocodile Bite: large). */
    maxTargetSize: z
      .enum(["tiny", "small", "medium", "large", "huge", "gargantuan"])
      .optional()
      .describe("The rider only applies to targets of at most this size"),
    /** How long the conditions last (a lich's touch: until the start of its next turn). Absent: until ended,
     *  or until the grapple ends when the rider grapples. */
    duration: SaveFailureDurationSchema.optional().describe(
      "How long the conditions last (a lich's touch: until the start of its next turn); absent, until ended or until the grapple ends"
    ),
    /** What the effect does besides conditions, as effect tags the engine reads: `no-healing` (a bearded devil's
     *  Beard), `no-reactions` (a balor's Lightning Blade), `no-opportunity-attacks`, `speed-halved`. */
    tags: z
      .array(EffectTagSchema)
      .max(6)
      .optional()
      .describe(
        "Effect tags the hit leaves, which the engine reads: no-healing, no-reactions, no-bonus-actions, dazed (one of moving, an action or a Bonus Action on its turn), no-opportunity-attacks, speed-halved, until-own-attack (spent by the bearer's next attack roll), until-attacked (spent by the next attack roll against it)"
      ),
    /** The effect lands on the attacker instead of the target (a pirate captain's Advantage on its next attack). Its
     *  `until-source-turn-end` duration then means the end of this turn. */
    self: z.literal(true).optional(),
    /** Modifiers the effect carries while it lasts: a Speed cut (a frost giant's Great Bow), Disadvantage on the
     *  target's next attack roll (an ettin's Morningstar, with the `until-own-attack` tag). */
    modifiers: EffectModifiersSchema.optional(),
    /** The hit pulls the target straight toward the attacker (a balor's Flame Whip, a merrow's Harpoon). */
    pull: ForcedPushSchema.optional(),
    /** The hit opens a save on the target against the attacker's DC (Giant Slayer: a Giant makes a DC 15 Strength
     *  save or falls Prone; a Sword of Wounding stops healing). Its failure leaves the rider's own effect. */
    save: z
      .object({
        ability: AbilitySchema,
        dc: z.number().int().min(1).max(40),
        /** Damage a failure deals, none on a success (a Dagger of Venom's 2d10 Poison). */
        failureDamage: z
          .array(z.object({ formula: DiceFormulaSchema, type: DamageTypeSchema }).strict())
          .max(2)
          .optional(),
        repeatSave: z.literal(true).optional(),
        endsOnDamage: z.literal(true).optional()
      })
      .strict()
      .optional(),
    /** It fires only when the attack roll's d20 shows a 20 (Sword of Sharpness: "When you roll a 20"), whatever else
     *  makes the hit a Critical Hit. */
    naturalTwenty: z.literal(true).optional(),
    /** It fires only against these creature types (Giant Slayer: a Giant), read from the target's stat block. */
    creatureTypes: z.array(RiderSlugSchema).min(1).max(6).optional(),
    /** It spends the coat the bearer put on the weapon: an effect on the attacker with this tag (a Dagger of Venom's
     *  poison), ended by this hit. Without one it doesn't fire. */
    spendsEffectTag: EffectTagSchema.optional(),
    /** What the engine leaves to the GM, said with the hit: a curse that acts at rests, a creature killed outright. */
    reminder: z.string().min(1).max(400).optional()
  })
  .strict()
  .describe(
    "On-hit riders: conditions, tags and modifiers applied to the target as one source-linked effect (a crocodile's Bite applies Grappled + Restrained with escape DC 15), a pull, or a save the hit opens. Prone and Exhaustion stand alone."
  );
export type OnHitRider = z.infer<typeof OnHitRiderSchema>;

/** What a hit rider leaves on the target with no save: a named effect with conditions, tags and modifiers. */
export const HitOutcomeSchema = z
  .object({
    name: z.string().min(1).max(60),
    conditions: z.array(SaveConditionSchema).max(3).optional(),
    tags: z.array(EffectTagSchema).max(6).default([]),
    modifiers: EffectModifiersSchema.default([]),
    /** Absent: until ended (Quivering Palm's vibrations, which last days). */
    duration: SaveFailureDurationSchema.optional(),
    /** A creature has one at a time, the most recent (Hamstring Blow): a new one replaces any other. */
    onePerTarget: z.literal(true).optional(),
    /** Its source keeps one at a time (Quivering Palm): marking a second creature ends the first's. */
    onePerSource: z.literal(true).optional()
  })
  .strict();
export type HitOutcome = z.infer<typeof HitOutcomeSchema>;

/** A save a hit rider opens on the hit's target, at the rider's DC, and what its failure leaves. */
export const HitRiderSaveSchema = z
  .object({
    ability: AbilitySchema,
    failureConditions: z.array(SaveConditionSchema).max(3).default([]),
    failureDuration: SaveFailureDurationSchema.optional(),
    repeatSave: z.literal(true).optional(),
    endsOnDamage: z.literal(true).optional(),
    failurePush: ForcedPushSchema.optional(),
    failureEffect: SaveFailureEffectSchema.optional()
  })
  .strict();

/** One effect a hit rider offers (Brutal Strike's Forceful Blow, a Cunning Strike's Trip, Open Hand's Topple). */
export const HitRiderEffectSchema = z
  .object({
    id: RiderSlugSchema,
    name: z.string().min(1).max(60),
    /** Sneak Attack dice it forgoes (a Cunning Strike effect's die cost), taken off before the dice roll. */
    forgoesDice: z.number().int().min(1).max(10).optional(),
    /** A feature the bearer must hold for it (Devious Strikes' Daze, Improved Brutal Strike's Staggering Blow). */
    requiresFeature: RiderSlugSchema.optional(),
    /** An item the bearer must carry, by catalog id (Poison: a Poisoner's Kit). */
    requiresItem: RiderSlugSchema.optional(),
    /** Only against a target of at most this size (Trip: Large or smaller). */
    maxTargetSize: SizeSchema.optional(),
    save: HitRiderSaveSchema.optional(),
    applies: HitOutcomeSchema.optional(),
    /** Pushes the target straight away with no save (Forceful Blow's 15 feet). */
    push: ForcedPushSchema.optional(),
    /** The attacker may then move up to half its Speed without provoking Opportunity Attacks (Withdraw, Forceful
     *  Blow's move toward the target). */
    grantsHalfSpeedMove: z.literal(true).optional(),
    /** The Hide action's Invisible condition stays through this attack (Supreme Sneak's Stealth Attack). */
    keepsHidden: z.literal(true).optional(),
    /** The attacker spends one of its Hit Point Dice and regains the roll plus its Constitution modifier, minimum 1
     *  (Lifedrinker). */
    spendsHitPointDie: z.literal(true).optional()
  })
  .strict();
export type HitRiderEffect = z.infer<typeof HitRiderEffectSchema>;

/**
 * What makes an action ride a hit (ADR-0020): it is chosen on an attack's preview and never taken alone. Its damage
 * joins the hit's (so a Critical Hit doubles it), or rides its save when it has one (Hurl Through Hell's 8d10 on a
 * failure). `rides` names the hits it can ride; the gates and costs below are checked on the server.
 */
export const HitRiderSchema = z
  .object({
    rides: z.enum([
      "attack-roll",
      "weapon",
      "melee-weapon-or-unarmed",
      "finesse-or-ranged-weapon",
      "monk-weapon-or-unarmed",
      "unarmed",
      "flurry-of-blows",
      "strength-attack",
      "pact-weapon",
      "this-weapon",
      "melee-this-weapon"
    ]),
    /** "Once per turn", any creature's turn, counted beside its own uses (Stunning Strike spends a Focus Point too). */
    oncePerTurn: z.literal(true).optional(),
    /** Only on the bearer's own turn ("once on each of your turns"). */
    ownTurn: z.literal(true).optional(),
    /** Tapped before the roll (Brutal Strike): the tap marks the bearer, and the next qualifying attack roll it makes
     *  gives up its Advantage. Only that roll's hit can carry it. */
    declaredBeforeRoll: z.literal(true).optional(),
    /** Sneak Attack's test: Advantage, or an ally within 5 feet of the target who isn't Incapacitated, and no
     *  Disadvantage. */
    sneakAttack: z.literal(true).optional(),
    /** "And deal damage to it": the hit must deal the target damage after its defences. */
    dealsDamage: z.literal(true).optional(),
    /** Only against a target of at most this size (Hill's Tumble: Large or smaller). */
    maxTargetSize: SizeSchema.optional(),
    /** Its damage takes the weapon's type (Sneak Attack, Brutal Strike). */
    weaponType: z.literal(true).optional(),
    /** The types its damage may take, picked when it is chosen (Divine Strike: Necrotic or Radiant). */
    damageTypes: z.array(DamageTypeSchema).min(2).max(6).optional(),
    /** More dice against these creature types (Divine Smite: 1d8 more against a Fiend or an Undead). */
    versus: z
      .object({ creatureTypes: z.array(RiderSlugSchema).min(1).max(6), formula: DiceFormulaSchema })
      .strict()
      .optional(),
    /** Its damage spares creatures of these types (Hurl Through Hell: a Fiend takes none). */
    sparesCreatureTypes: z.array(RiderSlugSchema).min(1).max(6).optional(),
    /** The DC of its saves and its effects' saves (8 + Dexterity + Proficiency Bonus for a Cunning Strike). */
    saveDc: z.number().int().min(1).max(40).optional(),
    /** Effects to pick when it is chosen (Brutal Strike, Cunning Strike, Open Hand Technique). */
    effects: z.array(HitRiderEffectSchema).min(1).max(10).optional(),
    /** How many different effects one hit may carry; absent, one. */
    effectsChoose: z.number().int().min(1).max(3).optional(),
    /** It must carry one effect to be chosen at all (Open Hand Technique); absent, the effects are optional. */
    effectRequired: z.literal(true).optional(),
    /** What it leaves on the target with no save (Frost's Chill's slow, Quivering Palm's vibrations). */
    applies: HitOutcomeSchema.optional(),
    /** It spends a Pact Magic slot and rolls this die once more per slot level (Eldritch Smite's 1d8 + 1d8 per
     *  level). */
    pactSlotDie: z
      .string()
      .regex(/^1d(?:4|6|8|10|12)$/)
      .optional(),
    /** What the table finishes by hand, said with the hit. */
    reminder: z.string().min(1).max(400).optional()
  })
  .strict()
  .describe(
    "What makes an action ride a hit: chosen on an attack's preview, never taken alone. `rides` names the hits it can ride; once per turn, own turn, Sneak Attack's test, a target size and dealing damage are checked on the server. Its damage joins the hit's, or rides its save when the action has one. `effects` are picked with it (a Cunning Strike's Trip forgoes a Sneak Attack die), with saves at `saveDc`."
  );
export type HitRider = z.infer<typeof HitRiderSchema>;

/**
 * Who an action without a spell may target, checked on the server like a spell's targets (SRD "Targets"): how many,
 * how far, and which creatures. A target outside the rules is refused with a sentence. `countAbility` is "a number
 * of creatures equal to your Charisma modifier (minimum of one creature)".
 */
export const ActionTargetsSchema = z
  .object({
    count: z.number().int().min(1).max(20).optional(),
    countAbility: AbilitySchema.optional(),
    /** How far from the user a target may be; 5 is touch. */
    rangeFeet: z.number().int().min(5).max(1000).optional(),
    creatureTypes: z.array(RiderSlugSchema).min(1).max(8).optional(),
    notCreatureTypes: z.array(RiderSlugSchema).min(1).max(8).optional(),
    maxSize: SizeSchema.optional(),
    /** "A creature you can see": read from the user's sight while dynamic vision is on. */
    seen: z.literal(true).optional(),
    /** "A creature Grappled by it" (a swallow, Paralyzing Tentacles). */
    grappledBySource: z.literal(true).optional(),
    /** Only a creature with one of these conditions (a Trample's Prone, Death Glare's Frightened). */
    conditions: z.array(ConditionSchema).min(1).max(4).optional(),
    /** Only a creature whose space this creature shares or is in (a Vortex, a Whelm). */
    inSpace: z.literal(true).optional(),
    /** "Each enemy", "an ally", or "another creature" (not the user itself). */
    who: z.enum(["enemies", "allies", "others"]).optional(),
    /** Only a creature this creature's own effect with this tag marks (Quivering Palm's vibrations). */
    markedBy: EffectTagSchema.optional()
  })
  .strict()
  .describe(
    "Who an action may target, checked on the server: how many (`count`, or `countAbility`'s modifier, minimum 1), how far (`rangeFeet`, 5 for touch), creature types, size, sight, grappled by the user, conditions, in the user's space, enemies, allies or others, or a creature the user marked."
  );
export type ActionTargets = z.infer<typeof ActionTargetsSchema>;

/** One place in a Multiattack's plan: an action taken `count` times, or any of `or` in its place. */
export const MultiattackComponentSchema = z
  .object({
    actionId: z.string().regex(/^[a-z0-9-]+$/),
    count: z.number().int().min(1).max(6),
    or: z
      .array(z.string().regex(/^[a-z0-9-]+$/))
      .min(1)
      .max(8)
      .optional()
  })
  .strict();

/**
 * The spells a stat block's action casts (SRD 5.2.1 monsters), read from its text when the bundle is built: a
 * Spellcasting action's lists ("At Will: Detect Magic, Fear", "1/Day Each: Fireball"), or the spell or choice of spells
 * another action casts ("The mage casts Misty Step"). The engine makes each entry a cast action, `id`, with the spell's
 * attack, save, damage and effects at these numbers and no slot: an `atLevel` cast at that level ("level 5 version"),
 * a `perDay` one that many times between Long Rests (any other the action's own uses limit). `self`: the action is
 * itself the cast of its one spell (a legendary "uses Spellcasting to cast Fear"), and it keeps its own cost.
 */
export const CastsSpellsSchema = z
  .object({
    ability: AbilitySchema,
    saveDc: z.number().int().min(1).max(40),
    attackBonus: z.number().int().min(-10).max(30),
    self: z.literal(true).optional(),
    /** The components its casts go without ("requiring no Material components"; "no spell components" is all three). */
    waives: z
      .array(z.enum(["verbal", "somatic", "material"]))
      .min(1)
      .max(3)
      .optional(),
    spells: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9-]+$/),
            spellId: z
              .string()
              .regex(/^[a-z0-9-]+$/)
              .max(80),
            name: z.string().min(1).max(120),
            atLevel: z.number().int().min(1).max(9).optional(),
            perDay: z.number().int().min(1).max(9).optional()
          })
          .strict()
      )
      .min(1)
      .max(24)
  })
  .strict();

/** A move an action grants beside the turn's own (SRD 5.2.1 stat blocks: "The dragon moves up to half its Speed, and
 *  it makes one Rend attack"). `speed`: half or all of the way's Speed, measured when it is taken; `mode`: the way it
 *  travels (any of the creature's ways when absent); `provokes: false` for "without provoking Opportunity Attacks";
 *  `straight` for a charge "straight toward an enemy"; `first` when the text moves before the rest of the action
 *  does, so the move can be taken before the attack. */
export const ActionMoveSchema = z
  .object({
    speed: z.enum(["half", "full"]),
    mode: z.enum(["walk", "fly", "swim", "climb", "burrow"]).optional(),
    provokes: z.boolean().default(true),
    straight: z.literal(true).optional(),
    first: z.literal(true).optional()
  })
  .strict();
export type ActionMove = z.infer<typeof ActionMoveSchema>;

/** A teleport an action grants: up to `feet` to an unoccupied space the creature can see. `unseen`: the space need
 *  not be seen (Dimension Door's "a place you can ... visualize, or one you can describe"). `failDamage`: a space that
 *  turns out filled fails the teleport and deals this Force damage (Dimension Door). */
export const ActionTeleportSchema = z
  .object({
    feet: z.number().int().min(5).max(10000),
    unseen: z.literal(true).optional(),
    failDamage: DiceFormulaSchema.optional()
  })
  .strict();
export type ActionTeleport = z.infer<typeof ActionTeleportSchema>;

/** Mechanics fields are optional (ADR-0020): absent means prose only. Descriptions stay the display source of truth. */
export const ActionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1).max(120),
    activation: z.enum(["action", "bonus-action", "reaction", "other"]),
    description: z
      .string()
      .min(1)
      .max(12000)
      .describe("Always the display source of truth; every rider below only adds mechanics on top"),
    attack: z
      .object({
        bonus: z.number().int(),
        reachFeet: z.number().int().positive().optional(),
        rangeFeet: z.number().int().positive().optional(),
        /** Normal range in feet for a two-range weapon ("80/320" → 80); attacks beyond it up to rangeFeet roll at disadvantage (SRD Range). */
        rangeNormalFeet: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'Normal range for a two-range weapon ("80/320" -> 80); attacks beyond it up to rangeFeet roll at disadvantage'
          ),
        /** Attack rolls this action grants (Extra Attack 2, Eldritch Blast beams). Absent = 1. */
        count: z.number().int().min(1).max(10).optional(),
        /** Extra weapon dice on a critical hit beyond crit doubling (Savage Attacks). Applies to the first damage part. */
        criticalBonusDice: z.number().int().min(1).max(4).optional()
      })
      .optional()
      .describe("A printed to-hit bonus; the stat block knows its own numbers"),
    save: z
      .object({
        ability: AbilitySchema,
        dc: z.number().int().min(1).max(40),
        /** The DC is the bearer's spell save DC (a spell, or a feature that uses it), so a `spell-save-dc` rider
         *  raises it. Absent: a printed DC that no rider touches (a breath weapon, a wand's DC 15). */
        spellcasting: z
          .boolean()
          .optional()
          .describe(
            "The DC is the bearer's spell save DC (a spell, or a feature that uses it), so a `spell-save-dc` rider raises it. Absent: a printed DC no rider touches, such as a breath weapon's"
          ),
        ...SaveOutcomeFields,
        /** An effect a failed save puts on the creature, sourced by the actor (Bane's -1d4, Faerie Fire's outline). */
        failureEffect: SaveFailureEffectSchema.optional(),
        /** What a successful save leaves on the creature instead (Stunning Strike: its Speed halved and the next attack
         *  roll against it with Advantage). */
        successEffect: SaveFailureEffectSchema.optional(),
        /** The user makes this save itself, whatever it targets (Contact Other Plane: "make a DC 15 Intelligence saving
         *  throw"). */
        bySelf: z
          .literal(true)
          .optional()
          .describe("The user makes this save itself, whatever it targets (Contact Other Plane)")
      })
      .optional()
      .describe("A printed save DC, and what the save does"),
    damage: z
      .array(
        z.object({
          formula: DamageFormulaSchema.describe(
            'One die term plus at most one flat modifier ("1d8 + 3"), or a fixed amount that uses no roll ("1", a Blowgun), which a crit leaves as it is. Anything richer stays prose (ADR-0008)'
          ),
          type: z.string().min(1).max(40)
        })
      )
      .max(8)
      .default([]),
    /** Hit points each target regains, rolled once and applied when the action resolves (Cure Wounds). */
    healing: z
      .object({
        formula: HealingFormulaSchema,
        /** The user heals itself (Second Wind), so there is no target to pick. */
        self: z.literal(true).optional(),
        /** The roll is one pool divided among the targets (Preserve Life). */
        divided: z.literal(true).optional(),
        /** No target is healed past this fraction of its maximum (Preserve Life: half). */
        upToFractionOfMaximum: z.number().min(0.1).max(1).optional(),
        /** The formula is regained once for each use spent (Lay on Hands: 1 hit point per point of its pool). */
        perUse: z.literal(true).optional(),
        /** Each target regains all its hit points, whatever the formula says (Power Word Heal). */
        toMaximum: z.literal(true).optional(),
        /** The roll is Temporary Hit Points, which a creature takes only when they beat what it has (False Life). */
        temporary: z.literal(true).optional()
      })
      .strict()
      .optional(),
    /** How many of its uses one activation spends: a fixed number (Lay on Hands' 5 points to cure a poison), or
     *  `chosen`, picked by the user each time (Lay on Hands' healing). Absent: one. */
    useCost: z.union([z.number().int().min(2).max(MAX_ACTION_USES), z.literal("chosen")]).optional(),
    /** Conditions this action ends on each target (Lay on Hands: Poisoned). */
    endsConditions: z.array(ConditionIdSchema).min(1).max(6).optional(),
    /** It ends one of `endsConditions`, the one its user picks (Lesser Restoration); absent, it ends each one present. */
    endsOneCondition: z.literal(true).optional(),
    /** It ends spells on its target (Dispel Magic): each of `automaticLevel` or lower ends, the slot it was cast with
     *  raising that level, and each higher one takes its user's spellcasting ability check against DC 10 plus the
     *  spell's level. */
    dispel: DispelSchema.optional(),
    /** It ends every curse on its target, and breaks the target's Attunement to a cursed magic item, whose curse stays
     *  on the item (Remove Curse). */
    endsCurses: z.literal(true).optional(),
    /** Missiles that each deal `damage` to a creature of the caster's choice (Magic Missile's darts), rolled one by one.
     *  The resolve's targets assign them in order, a target named twice taking two. */
    darts: z.number().int().min(2).max(20).optional(),
    /** The damage types the caster picks from on each use (Chromatic Orb); the resolve names one, and every damage
     *  part takes it. Absent: the damage's own types. */
    damageTypes: z.array(DamageTypeSchema).min(2).max(10).optional(),
    /** Compound action: one shared action slot, components tracked (crocodile Multiattack = one Bite + one Tail). A
     *  component's `or` names other actions that can fill its place ("using Scimitar or Shortbow in any combination"). */
    multiattack: z
      .array(MultiattackComponentSchema)
      .min(1)
      .max(6)
      .optional()
      .describe("Compound action: resolving a component consumes the shared action slot once and tracks the rest"),
    /** Other plans a Multiattack can be, beside `multiattack` ("or it makes two Hurl Flame attacks"), chosen by the first
     *  attack taken. */
    multiattackAlternatives: z.array(z.array(MultiattackComponentSchema).min(1).max(6)).min(1).max(2).optional(),
    /** What can take the place of a Multiattack's attacks ("It can replace one attack with a use of Roar"): one of
     *  `actionIds` replaces `attacks` of them, once, or for any attack (`any`), or only the one `of` names ("the Claw
     *  attack"). */
    multiattackReplacements: z
      .array(
        z
          .object({
            actionIds: z
              .array(z.string().regex(/^[a-z0-9-]+$/))
              .min(1)
              .max(8),
            attacks: z.number().int().min(1).max(3),
            any: z.literal(true).optional(),
            of: z
              .string()
              .regex(/^[a-z0-9-]+$/)
              .optional()
          })
          .strict()
      )
      .min(1)
      .max(3)
      .optional(),
    /** On-hit conditions applied to the target as one source-linked effect (Bite: Grappled + Restrained, escape DC 15). */
    onHit: z
      .array(OnHitRiderSchema)
      .max(4)
      .optional()
      .describe("Conditions applied to the target as one source-linked effect"),
    /** It rides a hit: chosen on an attack's preview, never taken alone (Sneak Attack, Stunning Strike). */
    ridesHit: HitRiderSchema.optional(),
    /** Who it may target, checked on the server (Lay on Hands' touch, Turn Undead's Undead within 30 feet). */
    targets: ActionTargetsSchema.optional(),
    /** A miss still deals half the hit's damage, rounded down (Acid Arrow: "half as much of the initial damage only"). */
    missDamage: z.literal("half").optional(),
    /** What its damage drains as it lands (a wraith's Life Drain, Vampiric Touch). */
    drain: DamageDrainSchema.optional(),
    /** A hit also pushes the target straight away from the attacker (a fire giant's Hammer Throw). */
    onHitPush: ForcedPushSchema.optional(),
    /** What bursts after its attack, hit or miss, against the user's save DC (Ice Knife's explosion). */
    burst: BurstSchema.extend({ dc: z.number().int().min(1).max(40) })
      .strict()
      .optional(),
    /** Targeting restrictions the engine enforces (Tail can't target the creature this crocodile grapples). */
    targetRules: z
      .array(z.enum(["not-grappled-by-source"]))
      .max(2)
      .optional()
      .describe("Targeting restrictions the engine enforces"),
    /** Resolving this action grants an effect to the actor itself (Rage, Reckless Attack). */
    grants: ActionGrantSchema.optional().describe(
      "Resolving this action grants an effect to the actor itself (Rage, Reckless Attack)"
    ),
    /** The action requires an active self effect carrying this tag (Frenzy requires "raging"). */
    requiresEffectTag: EffectTagSchema.optional().describe(
      'The action requires an active self effect carrying this tag (Frenzy requires "raging")'
    ),
    uses: ActionUsesSchema.optional().describe("Limited uses; unlike a feature's, an action's may recharge on a d6"),
    /** Resolving this action also spends one of the bearer's spell slots of this level ("expend a spell slot to cast
     * it from the staff"). Checked and spent by the limited-uses economy pass, so a preview never spends. */
    spellSlot: z
      .object({ level: z.number().int().min(1).max(9) })
      .strict()
      .optional()
      .describe(
        "Resolving this action also spends one of the bearer's own spell slots of this level: the mechanical half of an item cast authored with `consumesSpellSlot`. Checked and spent by the same economy pass that owns limited uses, so a preview never spends one and an empty pool refuses in the same voice as an empty charge"
      ),
    /** The spell this action casts; identity only, matched by `spell-id-is` gates. Set on actions synthesised from
     * an item's `casts`, or directly on a feature action. Absent = not a spell. */
    spellId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80)
      .optional()
      .describe(
        'Which spell this action is a casting of. Identity only (every number the action rolls is already on the action itself), so it changes no arithmetic. It exists because the `spell-id-is` rider filter needs something to match: "when you cast Eldritch Blast" cannot be said with `spell-school-is` or `spell-level-is`, which name categories. Absent = not a spell, and every `spell-id-is` gate fails closed'
      ),
    /** A roll this action answers after it is seen (Indomitable's reroll, Cutting Words); see `RollAnswerSchema`. */
    answer: RollAnswerSchema.optional(),
    /** Declared reaction the engine can offer as a pending prompt; see `ActionReactionSchema`. */
    reaction: ActionReactionSchema.optional().describe(
      'A declared reaction the engine offers as a pending prompt when its trigger happens: half-damage (Uncanny Dodge), ac-bonus (Parry, Shield), strike-back (Hellish Rebuke) or melee-attack (Retaliation). Only meaningful on activation "reaction"'
    ),
    /** Minted by the engine from an equipped weapon, with no authoring: the Light property's extra attack (`light`), or
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
    /** Taken in place of one attack of the Attack action (Breath Weapon: "replace one of your attacks"): it opens the
     *  Attack action, or spends one attack the action has left. Pairs with activation "action". */
    replacesAttack: z
      .boolean()
      .optional()
      .describe(
        'Taken in place of one attack of the Attack action (Breath Weapon, a thrown flask of Acid): it opens the Attack action, leaving the rest of its attacks for weapon swings, or spends one attack the action has left. Pairs with activation "action"'
      ),
    /** SRD Legendary Action: taken on other creatures' turns. It spends `cost` from the per-round pool that refills on the creature's own turn. Pairs with activation "other". `oncePerRound`: "can't take this action again until the start of its next turn". */
    legendary: z
      .object({ cost: z.number().int().min(1).max(5), oncePerRound: z.literal(true).optional() })
      .strict()
      .optional()
      .describe(
        'SRD Legendary Action: taken on other creatures\' turns. Each use spends `cost` from the per-round pool. Pairs with activation "other"'
      ),
    /** The area it covers, for the map template. Filled from the description where the action enters the system
     *  (the content build, a homebrew save, an import), so play never reads the prose. */
    area: ActionAreaSchema.optional(),
    /** A move the action grants ("moves up to half its Speed"), see `ActionMoveSchema`. */
    move: ActionMoveSchema.optional(),
    /** A teleport the action grants ("teleports up to 60 feet to an unoccupied space it can see"), see
     *  `ActionTeleportSchema`. */
    teleport: ActionTeleportSchema.optional(),
    /** A jump the action allows this turn ("jumps up to 30 feet by spending 10 feet of movement"). */
    leap: z
      .object({ feet: z.number().int().min(5).max(120), costFeet: z.number().int().min(0).max(60) })
      .strict()
      .optional(),
    /** What it does to light and sight while it lasts (a darkmantle's Darkness Aura, an octopus's ink). */
    sight: SightEffectSchema.optional(),
    /** The spells it casts, each its own cast action in play (a Spellcasting list, a Misty Step); see `CastsSpellsSchema`. */
    castsSpells: CastsSpellsSchema.optional(),
    /** Damage a hit adds or swaps in under a printed condition ("plus 2 (1d4) Slashing damage if the attack roll had
     *  Advantage", "or 2 (1d4) Piercing damage if the swarm is Bloodied"). The engine applies what it can see; a
     *  charge, which it can't, is offered on the hit for the attacker to confirm. */
    conditionalDamage: z
      .array(
        z
          .object({
            when: z.enum(["advantage", "self-bloodied", "target-bloodied", "target-grappled-by-self", "charge"]),
            /** `instead` replaces the first damage part; `plus` adds to the hit. */
            mode: z.enum(["instead", "plus"]),
            damage: z
              .array(z.object({ formula: DamageFormulaSchema, type: z.string().min(1).max(40) }).strict())
              .min(1)
              .max(2),
            /** A charge's run-up, in feet. */
            feet: z.number().int().min(5).max(120).optional(),
            /** Only against a target of at most this size. */
            maxTargetSize: SizeSchema.optional(),
            /** Conditions it imposes too (a charge's Prone). */
            conditions: z.array(ConditionIdSchema).max(2).optional()
          })
          .strict()
      )
      .max(3)
      .optional()
      .describe(
        "Damage a hit adds or swaps in under a printed condition: `advantage` (the attack roll had Advantage), `self-bloodied`, `target-bloodied`, `target-grappled-by-self`, applied by the engine; and `charge` (moved N feet straight toward the target first), which the engine cannot see, offered on the hit's preview for the attacker to confirm. `instead` replaces the first damage part; `plus` adds to the hit"
      ),
    /** What the engine leaves to the GM, shown when the action resolves: damage on later turns ("takes 10 (3d6) Acid
     *  damage at the start of each of the cube's turns") or a branch it can't choose. */
    reminder: z
      .string()
      .min(1)
      .max(600)
      .optional()
      .describe(
        "What the engine leaves to the GM, shown on the GM's result when the action resolves: damage on later turns, or a branch it cannot choose (a failure that turns on the target's Hit Points)"
      ),
    /** A Multiattack whose attacks the build could not read: the engine cannot track them against the action, so
     *  the creature's action-slot checks soften to notes. */
    untrackedMultiattack: z.literal(true).optional()
  })
  .describe(
    'A stat block\'s action, in the exact `ActionSchema` vocabulary the live rules engine already resolves. Every mechanics field is optional: absent means "prose only", and the engine falls back to reference behavior.'
  );

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
    /** Armor/weapon/tool/language training as open slugs. Absent means "not recorded" (an empty list means none): an import that
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
            /** The action that casts it as a Ritual: no slot, 10 minutes longer (SRD Rituals). */
            ritualActionId: z
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

/** The choice ledger as a list, where "no ledger recorded" reads as empty. Use when you only need to read. */
export function characterChoices(
  character: z.infer<typeof CharacterIdentitySchema> | undefined
): readonly CharacterChoice[] {
  return character?.choices ?? [];
}

const TraitNameSchema = z.string().min(1).max(120);
const TraitDamageSchema = z
  .array(z.object({ formula: DiceFormulaSchema, type: DamageTypeSchema }).strict())
  .min(1)
  .max(2);
/** A trait's save, shaped like an action's so the engine reads one kind of save block. */
const TraitSaveSchema = z
  .object({
    ability: AbilitySchema,
    dc: z.number().int().min(1).max(40),
    ...SaveOutcomeFields,
    /** "Success: The target is immune to this ghast's Stench for 24 hours" (held for the rest of the fight). */
    immuneOnSuccess: z.literal(true).optional()
  })
  .strict();

/**
 * What a stat block's trait does that the engine runs, read from the trait's text when the bundle is built (SRD 5.2.1
 * monsters); its prose stays on the sheet. `name` is the trait's printed name, for the feed.
 * - `regeneration`: hit points regained at the start of each of its turns, except the turn after it takes one of
 *   `stoppedBy`'s types (the troll's Acid or Fire); only at 1 Hit Point or more (`needsHitPoints`, the oni); and at 0
 *   Hit Points it dies only when a turn starts without regenerating (`deathWaitsForTurn`, the troll).
 * - `undead-fortitude`: damage that drops it to 0 asks a save of DC `dcBase` plus the damage taken, unless the damage
 *   is of one of `exceptDamageTypes` or from a Critical Hit; a success leaves it at 1 Hit Point.
 * - `aura`: an Emanation of `rangeFeet` that acts at the end of the bearer's turns (Fire Aura's damage), on each
 *   creature that starts its turn in it (Stench's save), or at the start of the bearer's turns on what it grapples or
 *   is grappled by (Barbed Hide). `affects` is every creature, its enemies, or those it chooses (taken as its
 *   enemies); `notWhileIncapacitated` silences it while the bearer is Incapacitated; a save's success can make the
 *   creature immune to it ("for 24 hours", held for the fight).
 * - `death-burst`: the save each creature in the Emanation makes when it dies (Death Burst, Death Throes).
 * - `melee-hit-damage`: what a creature that hits it with a melee attack roll takes (a black pudding's acid).
 * - `berserk`: starting its turn Bloodied, a d6 of 6 sends it berserk until it is no longer Bloodied.
 */
export const TraitMechanicSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("regeneration"),
      name: TraitNameSchema,
      hitPoints: z.number().int().min(1).max(200),
      stoppedBy: z.array(DamageTypeSchema).max(4).optional(),
      needsHitPoints: z.literal(true).optional(),
      deathWaitsForTurn: z.literal(true).optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal("undead-fortitude"),
      name: TraitNameSchema,
      ability: AbilitySchema,
      dcBase: z.number().int().min(1).max(30),
      exceptDamageTypes: z.array(DamageTypeSchema).max(4),
      exceptCritical: z.literal(true).optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal("aura"),
      name: TraitNameSchema,
      trigger: z.enum(["bearer-turn-end", "turn-start-inside", "bearer-turn-start"]),
      rangeFeet: z.number().int().min(5).max(120),
      affects: z.enum(["all", "enemies", "chosen", "grapple-partners"]),
      /** Only creatures of these types ("any Beast or Humanoid", a sea hag's Vile Appearance). */
      creatureTypes: z.array(RiderSlugSchema).min(1).max(6).optional(),
      notWhileIncapacitated: z.literal(true).optional(),
      /** Only a creature that can see the bearer is affected ("and can see the hag's true form"). */
      seenOnly: z.literal(true).optional(),
      damage: TraitDamageSchema.optional(),
      save: TraitSaveSchema.optional(),
      /** The fire it sets (a fire elemental's Emanation): "start burning" (SRD Burning). */
      hazard: z.literal("burning").optional(),
      /** What a failed save does that the engine leaves to the GM (a gibbering mouther's d8 table). */
      reminder: z.string().min(1).max(600).optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal("death-burst"),
      name: TraitNameSchema,
      rangeFeet: z.number().int().min(5).max(120),
      save: TraitSaveSchema,
      damage: TraitDamageSchema
    })
    .strict(),
  z.object({ kind: z.literal("melee-hit-damage"), name: TraitNameSchema, damage: TraitDamageSchema }).strict(),
  /** "The [creature] sheds Bright Light in a 10-foot radius and Dim Light for an additional 10 feet" (Illumination):
   *  a light its token carries. */
  z
    .object({
      kind: z.literal("light"),
      name: TraitNameSchema,
      brightFeet: z.number().int().min(0).max(240),
      dimFeet: z.number().int().min(0).max(240)
    })
    .strict(),
  /** Sunlight Sensitivity, Sunlight Weakness, a vampire's sunlight, Light Sensitivity: while it stands in `light`
   *  (sunlight, or any Bright Light), its `rolls` have Disadvantage, and a vampire takes `damageAtTurnStart` as its
   *  turn starts there. */
  z
    .object({
      kind: z.literal("light-sensitivity"),
      name: TraitNameSchema,
      light: z.enum(["sunlight", "bright"]),
      rolls: z
        .array(z.enum(["attack", "check", "save"]))
        .min(1)
        .max(3),
      damageAtTurnStart: z
        .object({ amount: z.number().int().min(1).max(100), type: DamageTypeSchema })
        .strict()
        .optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal("berserk"),
      name: TraitNameSchema,
      /** The d6 face, or higher, that sends it berserk. */
      on: z.number().int().min(1).max(6)
    })
    .strict(),
  /** "The stalker has the Invisible condition": the creature joins the roster with it. */
  z
    .object({
      kind: z.literal("invisible"),
      name: TraitNameSchema
    })
    .strict()
]);
export type TraitMechanic = z.infer<typeof TraitMechanicSchema>;

export const ActorDefinitionSchema = z
  .object({
    schemaId: z.enum(["vtt.actor-character", "vtt.actor-monster"]),
    schemaVersion: z
      .literal(ACTOR_DEFINITION_SCHEMA_VERSION)
      .describe("ADR-0007 integer schema version; discoverable at /system/version"),
    source: z
      .object({
        name: z.string().min(1).max(200),
        version: z.string().min(1).max(80),
        externalId: z.string().max(200).optional()
      })
      .describe("Bundle provenance. It plays no part in telling SRD content from homebrew"),
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
    hitPoints: z.object({
      maximum: z.number().int().positive(),
      formula: DiceFormulaSchema.optional().describe(
        'One die term plus at most one flat modifier ("1d8 + 3"). Anything richer stays prose (ADR-0008)'
      )
    }),
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
      .prefault({ disposition: "neutral", footprint: { width: 1, height: 1 } })
      .describe("The battlemap piece: disposition and grid footprint. Nothing to do with credentials"),
    extensions: z
      .record(z.string(), z.unknown())
      .default({})
      .describe(
        'Free-form passthrough an importer may carry. One bag is read: publishing needs `extensions["open5e.srd-2024"]` to hold a numeric `challengeRating` (0.125 for CR 1/8) and a non-empty `type` ("dragon"), because the bestiary lists, sorts and searches by them. Example: `{"open5e.srd-2024": {"challengeRating": 5, "type": "giant"}}`. Everything else is carried and never read'
      ),
    /** Typed defenses by damage-type id, applied immunity → resistance → vulnerability. Absent = none known. */
    damageResistances: z.array(DamageTypeIdSchema).max(20).optional(),
    damageImmunities: z.array(DamageTypeIdSchema).max(20).optional(),
    damageVulnerabilities: z.array(DamageTypeIdSchema).max(20).optional(),
    /** Seeded onto the actor's `conditionImmunities`, which the engine enforces. */
    conditionImmunities: z
      .array(ConditionIdSchema)
      .max(20)
      .optional()
      .describe("Reference-level for now: displayed, and actor.set-condition does not enforce it yet"),
    /** Legendary creature resources (SRD 2024): legendary actions per round (spent on other creatures' turns) and Legendary Resistance per day (re-arms on a Long Rest). */
    legendary: z
      .object({
        actionsPerRound: z.number().int().min(1).max(5).optional(),
        resistancesPerDay: z.number().int().min(1).max(6).optional()
      })
      .strict()
      .optional()
      .describe(
        "SRD 2024 legendary resources: actions spent on other creatures' turns, and Legendary Resistance uses that re-arm on a Long Rest"
      ),
    /** What its traits do that the engine runs (Regeneration, auras, Death Burst), read from their text. */
    traitMechanics: z.array(TraitMechanicSchema).max(12).optional(),
    /** Character identity (class/level/race/background/feats); character definitions only. */
    character: CharacterIdentitySchema.optional().describe(
      "The character half of an ActorDefinition (class/level/species/background/feats and the choice-provenance ledger). A monster leaves it absent: the character builder writes it, never a homebrew author"
    ),
    proficiencies: ProficienciesSchema.optional().describe(
      "Save/skill proficiency selections; the character half, see `character`"
    ),
    spellcasting: SpellcastingSchema.optional().describe(
      "A spellcasting creature's ability, slot maxima, and known/prepared list; the character half, see `character`"
    ),
    /** Immutable starting loadout; the live actor's inventory is seeded from this. */
    startingInventory: z
      .array(InventoryItemSchema)
      .max(200)
      .optional()
      .describe("Immutable starting loadout; the character half, see `character`"),
    /** Immutable starting coins; the live actor's currency is seeded from this. */
    startingCurrency: CurrencySchema.optional().describe(
      "Immutable starting coins; the character half, see `character`"
    )
  })
  .superRefine((actor, context) => {
    if (actor.schemaId === "vtt.actor-character" && actor.token.disposition !== "friendly")
      context.addIssue({
        code: "custom",
        path: ["token", "disposition"],
        message: "Player-character definitions must use the friendly disposition."
      });
  })
  .describe(
    "A character's or a creature's definition: what `actor.import-definition` takes and what the bundled bestiary holds."
  );
export type ActorDefinition = z.infer<typeof ActorDefinitionSchema>;
