/**
 * Character-BUILDER content records: classes, subclasses, species, backgrounds, feats, and per-species
 * name pools. These are the shapes the guided wizard, the level-up flow, and the random generator all
 * read (task packet `docs/task-packets/character-builder.md`, phase 1.1).
 *
 * Three rules govern everything in this file:
 *
 * 1. FEATURES ARE DATA. One `FeatureRecord` describes a class feature, a subclass feature, a species
 *    trait, a background feature, and a feat alike: prose plus optional structured riders drawn from a
 *    bounded vocabulary that REUSES the shapes already proven on `ActorDefinition` (`ActionSchema`,
 *    `EffectGrantSchema`, `ActionUsesSchema`). No feature may need hardcoded client or server
 *    behavior - a homebrew author writes the same record and the engine cannot tell it apart.
 *    This reaches all the way down: ONE pickable option inside a choice (`FeatureChoice.options`)
 *    is that same shape, so "Divine Order: Protector" carries its Martial-weapon and Heavy-armor
 *    training itself instead of being a bare id string that nothing downstream can interpret.
 * 2. ONE SOURCE DISCRIMINATOR. Every record carries `source: "srd" | "homebrew"` (default "srd").
 *    Merging happens once, in the server's content library, exactly as `loadEquipment()` already
 *    folds weapons + armor + gear together. Homebrew is the next source, never a fork.
 * 3. NO NEW CLOSED ENUMS FOR IDENTITY. Ids are open slugs. Ability references use the existing
 *    six-ability enum (the one genuinely closed vocabulary in 5e); skills, damage types, item
 *    categories, proficiency groups, languages, and feature ids all stay open slugs so homebrew and
 *    later SRD printings need no schema change.
 */
import { z } from "zod";
import {
  AbilitySchema, ActionSchema, AttackBonusVariantSchema, DiceFormulaSchema, EffectGrantSchema,
  ExtraDamageVariantSchema, HitDieSchema, RollModeVariantSchema, riderGate
} from "@vtt/schemas";

/** Re-exported so the rider gate vocabulary reads as one thing regardless of which package declares it. */
export { ItemSlotSchema, RIDER_TRIGGER_KINDS, RiderTriggerSchema, RiderWhenSchema, riderLayer, riderGate, type ItemSlot, type RiderTrigger, type RiderTriggerKind } from "@vtt/schemas";

/** Every identity in the content catalog is an open slug - never a closed enum (principle 3). */
export const ContentIdSchema = z.string().regex(/^[a-z0-9-]+$/).max(80);
/** A character or class level, 1-20. */
export const ContentLevelSchema = z.number().int().min(1).max(20);
/** Which catalog a record came from. One discriminator, merged once (principle 2). */
export const ContentSourceSchema = z.enum(["srd", "homebrew"]).default("srd");
export type ContentSource = z.infer<typeof ContentSourceSchema>;

/**
 * Fields every content record shares, so the browse UI and the merge step can treat them uniformly.
 * Exported so a homebrew authoring/request schema composes the SAME header rather than restating it -
 * a second copy is how `source` ends up meaning two different things.
 */
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

// ---------------------------------------------------------------------------------------------
// FeatureRecord - the one shape every class/subclass/species/background/feat feature uses.
// ---------------------------------------------------------------------------------------------

/**
 * Uses a feature gets back on a rest, expressed as DATA rather than a formula language. `limit` is a
 * flat count; `scaling` covers the three ways 5e actually scales a feature's uses (proficiency bonus,
 * an ability modifier, or a printed per-level column). `pool` shares one counter across features, the
 * same way `ActionUsesSchema.pool` shares one across actions.
 */
export const FeatureUsesSchema = z.object({
  limit: z.number().int().min(1).max(20).optional(),
  scaling: z.discriminatedUnion("type", [
    z.object({ type: z.literal("proficiency-bonus") }).strict(),
    z.object({ type: z.literal("ability-modifier"), ability: AbilitySchema, minimum: z.number().int().min(0).max(5).default(1) }).strict(),
    z.object({ type: z.literal("by-level"), table: z.array(z.object({ level: ContentLevelSchema, limit: z.number().int().min(0).max(99) }).strict()).min(1).max(20) }).strict(),
    /**
     * Read the count straight off the CLASS TABLE's printed column for this level, by
     * `classResources.id`. The fourth way 5e scales uses, and the one the other three cannot say:
     * Rage, Bardic Inspiration and Channel Divinity all step on a schedule that is neither the
     * proficiency bonus nor an ability modifier, and re-typing the printed column into a `by-level`
     * table beside the printed column it duplicates is exactly the second copy that drifts.
     *
     * A resource whose printed amount is a DICE STRING (Sneak Attack "3d6") is not a count of uses
     * and resolves to 0, which is the same "no uses" a `by-level` table with no matching row gives.
     */
    z.object({ type: z.literal("class-resource"), id: ContentIdSchema }).strict()
  ]).optional(),
  per: z.enum(["turn", "encounter", "short-rest", "long-rest"]),
  pool: ContentIdSchema.optional()
}).strict().superRefine((uses, context) => {
  if (uses.limit === undefined && uses.scaling === undefined) context.addIssue({ code: z.ZodIssueCode.custom, message: "Limited uses need either a flat `limit` or a `scaling` rule." });
});
export type FeatureUses = z.infer<typeof FeatureUsesSchema>;

/**
 * An attack a feature grants. Same vocabulary as `ActionSchema.attack`, except the to-hit BONUS is
 * derived rather than authored: a class feature cannot know the character's ability scores, so it
 * names the ability instead and the builder resolves the number.
 */
export const FeatureAttackSchema = z.object({
  ability: z.union([AbilitySchema, z.literal("spellcasting")]),
  proficient: z.boolean().default(true),
  reachFeet: z.number().int().positive().optional(),
  rangeFeet: z.number().int().positive().optional(),
  rangeNormalFeet: z.number().int().positive().optional(),
  count: z.number().int().min(1).max(10).optional(),
  criticalBonusDice: z.number().int().min(1).max(4).optional()
}).strict();

/**
 * The DC of a save a feature forces, in the three forms the SRD actually prints:
 *
 *   - `"spellcasting"` - the character's own spell save DC (Channel Divinity, most class features);
 *   - a flat number - a printed constant (monster-style features, homebrew);
 *   - a DERIVED DC - `base + <ability> modifier (+ proficiency bonus)`. This is the SRD's standard
 *     "DC 8 plus your Constitution modifier and Proficiency Bonus" wording (Dragonborn Breath
 *     Weapon, Orc/Goliath-style species features). It is DATA, not a formula language: three bounded
 *     fields, nothing evaluable (ADR-0008 - anything richer stays prose).
 */
export const FeatureSaveDcSchema = z.union([
  z.literal("spellcasting"),
  z.number().int().min(1).max(40),
  z.object({
    /** The printed constant the modifiers are added to; 8 in every SRD 5.2.1 printing. */
    base: z.number().int().min(1).max(30).default(8),
    /** Whose modifier is added - the CASTER's ability, not the ability the target rolls. */
    ability: AbilitySchema,
    /** Whether the character's proficiency bonus is added too (every SRD printing: yes). */
    proficiencyBonus: z.boolean().default(true)
  }).strict()
]);
export type FeatureSaveDc = z.infer<typeof FeatureSaveDcSchema>;

/** A save a feature forces. `ability` is what the TARGET rolls; `dc` is how the number is derived. */
export const FeatureSaveSchema = z.object({
  ability: AbilitySchema,
  dc: FeatureSaveDcSchema
}).strict();

/**
 * A rollable action a feature adds to the sheet (Second Wind, Channel Divinity, Breath Weapon). Built
 * from `ActionSchema` so the vocabulary cannot drift: only `attack` and `save` are swapped for the
 * derived templates above, everything else (damage, onHit riders, grants, uses, multiattack,
 * reaction, legendary) is the identical shape the rules engine already resolves.
 */
export const FeatureActionSchema = ActionSchema.omit({ attack: true, save: true }).extend({
  attack: FeatureAttackSchema.optional(),
  save: FeatureSaveSchema.optional(),
  /** Damage that grows with level, replacing `damage` at the highest matching level (Sneak Attack, Divine Smite). */
  damageByLevel: z.array(z.object({ level: ContentLevelSchema, formula: DiceFormulaSchema, type: z.string().min(1).max(40) }).strict()).max(20).optional()
});
export type FeatureAction = z.infer<typeof FeatureActionSchema>;

/**
 * Flat things a feature simply hands the character. All open slugs (principle 3) so a homebrew
 * language, tool, or armor group needs no schema change.
 */
export const FeatureGrantsSchema = z.object({
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
  spells: z.array(z.object({ id: ContentIdSchema, level: z.number().int().min(0).max(9).optional(), alwaysPrepared: z.boolean().default(true), ability: AbilitySchema.optional() }).strict()).max(30).default([])
}).strict();

/**
 * Typed numeric riders. A bounded union, deliberately small and grown additively - the same contract
 * `EffectModifierSchema` follows on the actor side. Anything not modeled here stays prose (ADR-0008).
 *
 * THIS UNION IS THE ONE AUTHORED RIDER VOCABULARY, and that is a load-bearing architectural call
 * rather than a convenience. A feat IS a `FeatureRecord` (`FeatReferenceSchema.feature`), a chosen
 * `FeatureOption` carries the identical `featureRiders` block, and a magic item spreads that same
 * block too. So "feats carry the same buffs and debuffs items do" is true BY CONSTRUCTION here - a
 * parallel `ItemModifierSchema` would hand items everything, hand feats nothing, and the difference
 * would be invisible until someone authored the feat and it silently did nothing.
 *
 * Every `amount` is a SIGNED integer, so a curse or a debuff is the same vocabulary with a negative
 * number rather than a second one. Every variant carries `...riderGate` (`when` + `scope`), so the
 * condition a rider applies under is data drawn from a closed list of thirty named triggers - never
 * an expression to parse (ADR-0008).
 */
export const FeatureModifierSchema = z.discriminatedUnion("type", [
  // ---- the eight that existed before, now gateable -------------------------------------------
  z.object({ type: z.literal("ability-score"), ability: AbilitySchema, amount: z.number().int().min(-5).max(5), maximum: z.number().int().min(1).max(30).optional(), ...riderGate }).strict(),
  z.object({ type: z.literal("hit-points-per-level"), amount: z.number().int().min(-5).max(5), ...riderGate }).strict(),
  z.object({ type: z.literal("speed"), amount: z.number().int().min(-30).max(60), ...riderGate }).strict(),
  /**
   * A flat Armor Class rider. `whileArmored` is the ONE bounded condition the SRD's printed AC
   * bonuses actually need: the Defense fighting style reads "While you're wearing Light, Medium, or
   * Heavy armor, you gain a +1 bonus to Armor Class", and applying it to an unarmoured character
   * would be wrong. Default `false` = the unconditional bonus every pre-existing record means, so
   * this is additive and back-compatible (ADR-0007). It is a boolean, not a condition language
   * (ADR-0008): a richer gate stays prose until the SRD prints one.
   *
   * `when: [{type: "while-armored"}]` now says the same thing in the general vocabulary. The boolean
   * STAYS: it is authored in shipped bundles and read by the builder, so a collector normalises
   * `whileArmored: true` into that trigger rather than anyone deprecating the field.
   */
  z.object({ type: z.literal("armor-class"), amount: z.number().int().min(-5).max(5), whileArmored: z.boolean().default(false), ...riderGate }).strict(),
  z.object({ type: z.literal("initiative"), amount: z.number().int().min(-5).max(10), ...riderGate }).strict(),
  z.object({ type: z.literal("extra-attack"), count: z.number().int().min(1).max(3), ...riderGate }).strict(),
  /** AC = 10 + DEX + this ability while wearing no armor (Barbarian, Monk, and any homebrew that wants it). */
  z.object({ type: z.literal("unarmored-defense"), ability: AbilitySchema, allowShield: z.boolean().default(false), ...riderGate }).strict(),
  z.object({ type: z.literal("darkvision"), feet: z.number().int().min(0).max(240), ...riderGate }).strict(),
  // ---- the three shared with EffectModifierSchema, declared once in @vtt/schemas --------------
  AttackBonusVariantSchema,
  ExtraDamageVariantSchema,
  RollModeVariantSchema,
  // ---- the ten the magic-item vocabulary adds -------------------------------------------------
  /** A flat bonus to saving throws. Narrow it with `when: [{type: "ability-is", abilities: ["dex"]}]`. */
  z.object({ type: z.literal("save-bonus"), amount: z.number().int().min(-10).max(10), ...riderGate }).strict(),
  /** A flat bonus to ability and skill checks. Gloves of Thievery (+5 Sleight of Hand) is literally this. */
  z.object({ type: z.literal("check-bonus"), amount: z.number().int().min(-10).max(10), ...riderGate }).strict(),
  /** `classId` targets one caster on a multiclass sheet; absent = every caster the bearer has. */
  z.object({ type: z.literal("spell-save-dc"), amount: z.number().int().min(-5).max(5), classId: ContentIdSchema.optional(), ...riderGate }).strict(),
  /** The sibling of the above. A Wand of the War Mage is exactly this and nothing else. */
  z.object({ type: z.literal("spell-attack-bonus"), amount: z.number().int().min(-5).max(5), classId: ContentIdSchema.optional(), ...riderGate }).strict(),
  /** An extra spell slot of one level. Layered over the single-sourced slot maxima, so the seed, the long rest and the spend-clamp cannot disagree. */
  z.object({ type: z.literal("spell-slot"), level: z.number().int().min(1).max(9), amount: z.number().int().min(-4).max(4), ...riderGate }).strict(),
  /**
   * One more use of a limited resource. `poolId` is the live `actionUses` KEY (`uses.pool` or the
   * action id) - the namespace that is actually spent and re-armed. It is deliberately NOT the
   * class level table's `classResources`, which is display-only content data with no server reads:
   * a rider pointed there would parse, store, project, and change nothing at the table.
   */
  z.object({ type: z.literal("resource-bonus"), poolId: ContentIdSchema, amount: z.number().int().min(-20).max(20), ...riderGate }).strict(),
  /** Score a critical hit on this natural roll or higher (19-20 keen weapons). */
  z.object({ type: z.literal("critical-range"), threshold: z.number().int().min(15).max(20), ...riderGate }).strict(),
  /** Extra UNTYPED weapon dice on a crit (Savage Attacks). A typed crit-only 1d6 fire is `extra-damage` + `when: [{on-critical-hit}]` instead. */
  z.object({ type: z.literal("critical-bonus-dice"), count: z.number().int().min(1).max(4), ...riderGate }).strict(),
  /** Flat reduction of incoming damage. Resistance itself stays `grants.damageResistances`. */
  z.object({ type: z.literal("damage-reduction"), amount: z.number().int().min(1).max(30), ...riderGate }).strict(),
  /** The missing sibling of `darkvision`. Display-level, like `darkvision`, until a senses model exists. */
  z.object({ type: z.literal("sense"), sense: ContentIdSchema, feet: z.number().int().min(0).max(240), ...riderGate }).strict()
]);
export type FeatureModifier = z.infer<typeof FeatureModifierSchema>;

/**
 * The rider families an ITEM carrier may not use, and the only refusal in this vocabulary.
 *
 * It is narrow on purpose. Granted proficiencies and granted feats were both candidates for refusal
 * and are NOT refused: they are reversible as long as an item contribution is recomputed whole from
 * `(definition, inventory, catalog)` and never merged into the stored definition. These two are
 * different in kind:
 *
 *   - `hit-points-per-level` changes `hp.maximum`, which is live state that `hp.current` is tracked
 *     against. Equipping would have to decide what happens to current HP and unequipping could
 *     strand `current > maximum`. There is no correct silent answer.
 *   - `ability-score` cascades into AC, saves, skills, spell DC, hit points and initiative, and
 *     every one of those consumers reads the BAKED `definition.abilityScores`. Layering one score
 *     means layering the whole sheet.
 *
 * Both stay fully available on a FEATURE or FEAT carrier, where baking is correct: a feat is granted
 * once and never un-granted. (`hit-points` as a flat maximum is not in the vocabulary at all, so an
 * item naming it is refused one level earlier, by the discriminated union itself.)
 */
export const ITEM_REFUSED_MODIFIER_TYPES: readonly FeatureModifier["type"][] = Object.freeze(["hit-points-per-level", "ability-score"]);
export const ITEM_REFUSED_MODIFIER_MESSAGE =
  "An item cannot change hit points or an ability score yet - those are baked into the sheet and cannot be un-granted when the item comes off. Use a specific bonus instead: armor-class, save-bonus, check-bonus, or spell-save-dc. (Both stay available on a feat.)";

/**
 * THE rider vocabulary, spelled exactly once. A `FeatureRecord`, a `FeatureOption` (one pickable
 * option inside a `FeatureChoice`) and a magic ITEM all carry these identical fields, so there is
 * ONE vocabulary to author and ONE interpreter to write - a chosen option is interpreted by the very
 * same code path that interprets a class feature, a species trait, or a feat.
 *
 * Exported so `EquipmentReferenceSchema` spreads the very same object instead of restating it; a
 * second copy is exactly how items and feats would drift apart.
 */
export const featureRiders = {
  /** Open grouping slugs for the sheet ("spellcasting", "fighting-style", "channel-divinity"). */
  tags: z.array(ContentIdSchema).max(8).default([]),
  /** Rollable actions this feature adds to the sheet. */
  actions: z.array(FeatureActionSchema).max(8).default([]),
  /** Effects the feature can grant, in the actor-side EffectGrant vocabulary (Rage, Bardic Inspiration). */
  effects: z.array(EffectGrantSchema).max(4).default([]),
  /** Limited uses recovered on a rest. */
  uses: FeatureUsesSchema.optional(),
  /** Flat proficiency/language/spell grants. */
  grants: FeatureGrantsSchema.optional(),
  /** Typed numeric riders. */
  modifiers: z.array(FeatureModifierSchema).max(8).default([])
} as const;

/**
 * WHICH PICK BUDGET an `extraPicks` grant raises.
 *
 * Deliberately NOT a closed enum, and deliberately NOT a new namespace: this is the OFFER KEY the
 * wizard and the server already agree on, spelled the same on both sides -
 * `class-cantrips`, `class-spells`, `class-skills`, `class-tools`, `background-skills`,
 * `background-tools`, `background-languages`, `species-languages`, or `feature:<featureId>` for a
 * specific feature's own pick. The colon is why this cannot be `ContentIdSchema`.
 *
 * A key naming no budget THIS build actually has is a loud build rejection, never a silent no-op -
 * an authored grant that quietly adds zero is the exact failure this vocabulary exists to end. The
 * check lives on the server (`character-build.ts`), against the offers it really built, rather than
 * against a second hand-maintained list of legal keys that would drift away from them.
 */
export const PickBudgetKeySchema = z.string()
  .regex(/^[a-z0-9-]+(:[a-z0-9-]+)?$/, "A pick budget names an offer key (\"class-cantrips\") or a feature's own pick (\"feature:expertise\").")
  .max(80);

/**
 * ONE extra pick a feature (or a chosen option) adds to a budget that already exists.
 *
 * `amount` composes by ADDITION across every source: two features each granting +1 to the same
 * budget yield +2, because the printed level row and every grant are summed rather than one winning.
 */
export const ExtraPickSchema = z.object({
  offer: PickBudgetKeySchema,
  amount: z.number().int().min(1).max(5).optional(),
  /**
   * HOW MUCH, WHEN THE PRINTED TABLE ANSWERS THAT - the same fourth way `FeatureUsesSchema` scales
   * a feature's USES, applied to a pick BUDGET.
   *
   * `class-resource-growth` reads the class table's own column and yields **how far it has grown
   * above its first printed value** at this character's level. Growth, not the value, because
   * composition here is ADDITION over the feature's own `choose`: Eldritch Invocations prints 1 at
   * level 1 and 10 at level 20, so `choose: 1` plus a growth of 9 is exactly ten - and Weapon
   * Mastery's 3 -> 6 (Fighter) and 2 -> 4 (Barbarian) land the same way.
   *
   * WHY NOT REPEAT-GRANTS. `grantedAtLevels x choose` already grows a budget, and it cannot express
   * these: the Invocations column steps by +2 at levels 2 and 5, a level row may list a feature only
   * once, and **the SRD prints no feature heading at L2/L5/L7/L9/L12/L15/L18 to carry a grant at
   * all**. Inventing marker features would be inventing content the source does not have. Reading
   * the printed column needs no carrier - the feature granted at level 1 carries it, and the number
   * moves with the character's level.
   *
   * A column whose printed amount is a DICE STRING (Sneak Attack "3d6") is not a count and resolves
   * to 0, exactly as `FeatureUsesSchema`'s `class-resource` treats it.
   */
  scaling: z.object({
    type: z.literal("class-resource-growth"),
    /** The `classResources.id` of the printed column - `eldritch-invocations`, `weapon-mastery`. */
    id: ContentIdSchema
  }).strict().optional()
}).strict().superRefine((grant, context) => {
  // Exactly one, and `amount` has no default for precisely this reason: a defaulted 1 beside a
  // `scaling` is indistinguishable from an authored 1, and "the flat amount was silently ignored"
  // is the class of silent failure this whole vocabulary exists to end.
  if ((grant.amount === undefined) === (grant.scaling === undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "An extra pick states either a flat `amount` or a `scaling` rule - exactly one." });
  }
});
export type ExtraPick = z.infer<typeof ExtraPickSchema>;

/**
 * EXTRA PICKS - the rider by which a feature raises a pick BUDGET rather than granting an outcome.
 *
 * "You know one extra cantrip from the Cleric spell list" (Divine Order: Thaumaturge), "you gain
 * proficiency in one additional skill from your class's list", "you may prepare one more spell".
 * Every one of those promises a pick the player still gets to MAKE, from a list that already exists
 * and is already scoped correctly - so none of them can be said with `grants` (which names an
 * outcome, not an opportunity) and none can be said with a second `choice` either, because there is
 * no catalog slug meaning "your class's skill list" or "your class's spell list at your slot level".
 *
 * WHY IT IS NOT IN `featureRiders`. That block is spread into `EquipmentReferenceSchema` too, and a
 * pick budget is the one thing an ITEM must never carry: picks are made once at build time and
 * written to the provenance ledger, so a +1 that comes off with the cloak would strand a chosen
 * skill with nothing granting it. Declaring `extraPicks` beside `choice` on the two carriers that
 * are BUILT rather than equipped makes that structural instead of a refusal list.
 *
 * WHY IT CROSSES THE WIRE, when riders deliberately do not. `grants`, `modifiers`, `actions` and
 * `uses` are outcomes the SERVER applies, so the wizard never sees them. `extraPicks` is an input to
 * PICKING - the same category as `choice`, `maxSpellLevel` and `grantedAtLevels`, all of which cross
 * for the same reason: a wizard that cannot see it offers too few picks, reports the step complete,
 * and the server refuses the build (or, worse, the player simply cannot take what the text promised).
 */
const extraPicksField = z.array(ExtraPickSchema).max(4).default([]);

/** The fields that describe WHAT is being picked, shared by a feature's choice and an option's own. */
const featureChoiceBase = {
  kind: ContentIdSchema,
  choose: z.number().int().min(1).max(10).default(1),
  /**
   * Explicit option ids. Must name at least one option: an empty list is not "no options offered",
   * it is an authoring mistake that would leave a wizard step (and the server's validator) with
   * nothing to resolve. Omit the field entirely when `fromCatalog` or `options` supplies the list.
   */
  from: z.array(ContentIdSchema).min(1, "An explicit `from` list must name at least one option (omit it entirely to use `fromCatalog` or `options`).").max(80).optional(),
  /** An open catalog slug the wizard resolves at pick time ("skills", "feats", "wizard-spells"). */
  fromCatalog: ContentIdSchema.optional(),
  /** Only options at or below this level are legal (spell picks). */
  maxSpellLevel: z.number().int().min(0).max(9).optional(),
  /**
   * Only options at or ABOVE this level are legal - the FLOOR to `maxSpellLevel`'s ceiling.
   *
   * Mystic Arcanum reads "choose one level 6 Warlock spell as this arcanum", not "level 6 or lower":
   * with a ceiling alone a level-11 Warlock could spend their level-6 arcanum on Eldritch Blast. Set
   * both to the same number and the pick is EXACTLY that level, which is what all four arcana want.
   *
   * Read by the same two consumers `maxSpellLevel` is (`character-build.ts` matchRow,
   * `build-payload.ts` featurePickOffer), and it crosses the wire for the same reason: a wizard that
   * cannot see the floor offers spells the server then rejects.
   */
  minSpellLevel: z.number().int().min(0).max(9).optional(),
  /**
   * The ceiling an ability-score pick from THIS choice may raise a score to; absent = the SRD's 20.
   *
   * The sibling of `ability-score`'s own `maximum` (the modifier variant above), and it has to exist
   * separately because the two are different mechanisms: a modifier RAISES a named ability by a fixed
   * amount, while a choice lets the player pick WHICH ability - and the epic boons do the second.
   * "Increase one ability score by 1, to a maximum of 30" was previously unsayable: the offer
   * consumer hard-clamped every chosen point at 20, so all seven epic-boon feats silently did nothing
   * for a character already at 20 - which is precisely the character who has one.
   */
  maximum: z.number().int().min(1).max(30).optional(),
  /** The same option may be picked more than once (Expertise across levels). */
  repeatable: z.boolean().default(false)
} as const;

/**
 * A pick offered BY one option (Divine Order's Thaumaturge role, which itself grants a cantrip of
 * your choice). Deliberately depth-limited: an option's own choice may name ids or a catalog slug
 * but cannot nest a further `options` list, so the vocabulary is bounded and non-recursive.
 */
/** A floor above its own ceiling offers nothing at all - the silent-empty-picker failure, at author time. */
const spellLevelWindow = (choice: { minSpellLevel?: number; maxSpellLevel?: number }, context: z.RefinementCtx) => {
  if (choice.minSpellLevel !== undefined && choice.maxSpellLevel !== undefined && choice.minSpellLevel > choice.maxSpellLevel) {
    context.addIssue({
      code: z.ZodIssueCode.custom, path: ["minSpellLevel"],
      message: `minSpellLevel ${choice.minSpellLevel} is above maxSpellLevel ${choice.maxSpellLevel} - no spell can satisfy both.`
    });
  }
};

export const FeatureOptionChoiceSchema = z.object(featureChoiceBase).strict().superRefine((choice, context) => {
  if (!choice.from && !choice.fromCatalog) context.addIssue({ code: z.ZodIssueCode.custom, message: "A choice needs either an explicit `from` list or a `fromCatalog` slug." });
  spellLevelWindow(choice, context);
});
export type FeatureOptionChoice = z.infer<typeof FeatureOptionChoiceSchema>;

/**
 * ONE RECORD, SEVERAL PICKS - authored as `choices`, read through `featurePicks`.
 *
 * `choice` was singular, and with it a single `kind` and a single `maxSpellLevel`, which is why
 * Magic Initiate **silently dropped its level-1 spell**: all three variants author
 * `{kind: "cantrip", choose: 2, maxSpellLevel: 0}` against text reading "two cantrips ... you also
 * choose one level 1 spell from that list". Two of the four SRD backgrounds hand a Magic Initiate to
 * a level-1 character (Acolyte -> Cleric, Sage -> Wizard), so half of all first-level characters met
 * this before they reached the class step. Deft Explorer (one Expertise AND two languages) and Pact
 * of the Tome (three cantrips AND two rituals) are the same shape.
 *
 * `choice` STAYS, and stays the way almost every record is authored: one pick is the overwhelming
 * case and `choice` reads better than a one-element array. Both consumers go through `featurePicks`,
 * so neither has to know which form a record used - and the pair is mutually exclusive rather than
 * merged, because "which of the two is the real list" has no good silent answer.
 */
const oneChoiceForm = (record: { choice?: unknown; choices?: unknown }, context: z.RefinementCtx) => {
  if (record.choice !== undefined && record.choices !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["choices"], message: "Author `choice` (one pick) or `choices` (several) - never both." });
  }
};

/**
 * EVERY pick a feature or an option asks for, whichever form it was authored in.
 *
 * The single accessor both consumers use, so a record authored with `choices` reaches the wizard and
 * the server's validator identically to one authored with `choice`, and adding the plural form
 * needed no change at either call site beyond looping.
 */
export function featurePicks<Choice>(record: { choice?: Choice; choices?: Choice[] }): readonly Choice[] {
  if (record.choices && record.choices.length > 0) return record.choices;
  return record.choice ? [record.choice] : [];
}

/**
 * ONE pickable option that carries its OWN mechanics. This is the fix for options-as-bare-strings:
 * before, `from: ["protector", "thaumaturge"]` recorded WHICH role a Cleric took but could not say
 * what the role granted, so the pick was validated, written to the ledger, and then discarded.
 *
 * An option is structurally a `FeatureRecord` minus `level`/`replacesFeatureId` - identical rider
 * fields, identical meanings - so the builder interprets a chosen option by handing it to the same
 * feature interpreter it already runs for feats (`FeatureReference.feature` is the precedent: a feat
 * has always been "a FeatureRecord plus catalog metadata", and now so is a choice option).
 */
export const FeatureOptionSchema = z.object({
  id: ContentIdSchema,
  name: z.string().min(1).max(120),
  /** Printed text for this option. Always the display source of truth; riders only add mechanics. */
  description: z.string().min(1).max(20000),
  /** A pick this OPTION asks for once chosen, from a list of its own. */
  choice: FeatureOptionChoiceSchema.optional(),
  /** SEVERAL picks this option asks for; see `FeatureRecordSchema.choices`. Author one or the other. */
  choices: z.array(FeatureOptionChoiceSchema).min(1).max(4).optional(),
  /** Budgets this option RAISES once chosen (Thaumaturge's extra Cleric cantrip). */
  extraPicks: extraPicksField,
  ...featureRiders
}).strict().superRefine(oneChoiceForm);
export type FeatureOption = z.infer<typeof FeatureOptionSchema>;

/**
 * A pick the feature asks the player to make. Writing one of these is what puts a row in the
 * character's `choices[]` provenance ledger, which is what makes level-up and respec possible.
 * `kind` is an OPEN slug ("fighting-style", "skill", "expertise", "subclass", "asi", "feat", "spell",
 * "cantrip", "language", "tool", or anything homebrew invents) - the wizard renders it generically.
 *
 * Three ways to state the options, in increasing richness:
 *   - `fromCatalog` - an open catalog slug resolved at pick time (skills, spells, feats);
 *   - `from`        - explicit ids whose mechanics live elsewhere (a feat id resolves to a real
 *                     `FeatReference`), or nowhere (a pick that is pure provenance);
 *   - `options`     - the ids WITH their mechanics inline, for options that exist only here (Divine
 *                     Order's two sacred roles, Giant Ancestry's six boons).
 *
 * `options` and `from` are mutually exclusive: after parsing, `from` ALWAYS holds the canonical id
 * list, derived from `options` when they were authored. Every existing consumer that reads
 * `choice.from` therefore keeps working unchanged, and only a consumer that wants the mechanics
 * needs to look at `options`.
 */
export const FeatureChoiceSchema = z.object({
  ...featureChoiceBase,
  /** Options carrying their own mechanics. Mutually exclusive with `from`, which is derived from these. */
  options: z.array(FeatureOptionSchema).min(1).max(40).optional()
}).strict().superRefine((choice, context) => {
  if (!choice.from && !choice.fromCatalog && !choice.options) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A choice needs an explicit `from` list, inline `options`, or a `fromCatalog` slug." });
  }
  if (choice.from && choice.options) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["from"], message: "Author `options` alone - `from` is derived from the option ids." });
  }
  if (choice.options) {
    const duplicate = choice.options.find((option, index) => choice.options!.findIndex((other) => other.id === option.id) !== index);
    if (duplicate) context.addIssue({ code: z.ZodIssueCode.custom, path: ["options"], message: `Duplicate option id "${duplicate.id}".` });
  }
  spellLevelWindow(choice, context);
}).transform((choice) => {
  // Early return rather than a rewritten object, so `from` stays an OPTIONAL property on the output
  // type. Spreading a `from: string[] | undefined` back in would make it required-with-undefined,
  // and a `FeatureOptionChoice` (which has no `options` key at all) would stop being assignable to
  // a `FeatureChoice` - breaking the single-vocabulary guarantee at the type level.
  if (!choice.options) return choice;
  return { ...choice, from: choice.options.map((option) => option.id) };
});
export type FeatureChoice = z.infer<typeof FeatureChoiceSchema>;

/**
 * THE shared feature record. A class feature, a subclass feature, a species trait, a background
 * feature, and a feat's mechanics are all this one shape. `description` is always the display source
 * of truth; every rider below is optional, and a feature with no riders is a perfectly valid
 * prose-only feature (which is how most SRD text starts life).
 */
export const FeatureRecordSchema = z.object({
  id: ContentIdSchema,
  name: z.string().min(1).max(120),
  /** Class/subclass level this feature is gained at. Absent for always-on records (species traits, feats). */
  level: ContentLevelSchema.optional(),
  description: z.string().min(1).max(20000),
  /** A pick this feature asks the player to make; writes a `choices[]` row. */
  choice: FeatureChoiceSchema.optional(),
  /**
   * SEVERAL picks, when one record promises more than one - Magic Initiate's "two cantrips ... and
   * one level 1 spell", Deft Explorer's Expertise plus two languages, Pact of the Tome's three
   * cantrips plus two rituals. Mutually exclusive with `choice`; read both through `featurePicks`.
   */
  choices: z.array(FeatureChoiceSchema).min(1).max(4).optional(),
  /** Budgets this feature RAISES - one extra cantrip, one extra skill, one more prepared spell. */
  extraPicks: extraPicksField,
  ...featureRiders,
  /** This feature REPLACES an earlier one of the same id lineage (Indomitable at 9/13/17). */
  replacesFeatureId: ContentIdSchema.optional()
}).strict().superRefine(oneChoiceForm);
export type FeatureRecord = z.infer<typeof FeatureRecordSchema>;

// ---------------------------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------------------------

/**
 * A "choose N from this list" proficiency grant (class skills, background tools, species languages).
 *
 * `fromCatalog` is the same open catalog slug a feature's `choice` takes, resolved through the same
 * `resolveCatalogChoice` on both sides. It exists because the base language budget every character is
 * owed reads "Common plus two languages **from the Standard Languages table**" - a list of nineteen
 * ids that would otherwise be copied onto all nine species and drift the first time one changed.
 * Author one or the other, or both (the offer is their union, exactly as a feature's choice is).
 */
export const ChoiceListSchema = z.object({
  choose: z.number().int().min(0).max(10),
  from: z.array(ContentIdSchema).max(60).default([]),
  fromCatalog: ContentIdSchema.optional()
}).strict().superRefine((list, context) => {
  // A budget with no source offers nothing, so the build can never satisfy it - the silent
  // unfinishable-wizard failure, caught at parse time instead of at Create.
  if (list.choose > 0 && list.from.length === 0 && !list.fromCatalog) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A \"choose N\" list needs a non-empty `from` list or a `fromCatalog` slug - otherwise the pick has no options and the build can never be completed." });
  }
});

/** A named starting-equipment bundle ("A: chain mail and a martial weapon", "C: 155 gp"). */
export const StartingEquipmentOptionSchema = z.object({
  id: ContentIdSchema,
  label: z.string().min(1).max(200),
  items: z.array(z.object({ id: ContentIdSchema, name: z.string().min(1).max(120), quantity: z.number().int().min(1).max(99).default(1) }).strict()).max(20).default([]),
  goldPieces: z.number().int().min(0).max(1000).default(0)
}).strict();

/**
 * ONE row of a class's 20-level table. `features` lists the ids granted at that level (resolved
 * against the class's own `features[]`), and the optional columns carry whatever the printed table
 * carries: spell slots, Pact Magic, cantrips/spells known, the prepared-spell formula, and named
 * class resources (Rage 3, Ki 5, Sneak Attack 3d6, Second Wind 3).
 */
export const ClassLevelRowSchema = z.object({
  level: ContentLevelSchema,
  proficiencyBonus: z.number().int().min(2).max(6),
  features: z.array(ContentIdSchema).max(12).default([]),
  /** Nine counts, index 0 = 1st-level slots. Absent for a non-caster row. */
  spellSlots: z.array(z.number().int().min(0).max(4)).length(9).optional(),
  /** Warlock Pact Magic: one uniform slot level with its own count. */
  pactSlots: z.object({ level: z.number().int().min(1).max(9), slots: z.number().int().min(0).max(4) }).strict().optional(),
  cantripsKnown: z.number().int().min(0).max(10).optional(),
  spellsKnown: z.number().int().min(0).max(40).optional(),
  /**
   * How many spells a prepared caster has ready, as DATA: either a flat number, or the SRD formula
   * expressed declaratively ("<ability> modifier + <class> level"). Kept a short string so a homebrew
   * class can print its own wording; the builder falls back to the printed number when it cannot
   * resolve the formula.
   */
  preparedFormula: z.string().max(60).optional(),
  preparedCount: z.number().int().min(0).max(60).optional(),
  /**
   * Named per-level resources; `amount` is a count or a dice string ("3d6" for Sneak Attack).
   *
   * THIS IS A PRINTED COLUMN, NOT A NAMESPACE. The live pool the engine spends and re-arms is
   * `actor.actionUses[uses.pool ?? action.id]`, and these ids reach it only BY CONVENTION: a
   * `classResources.id` that matches a `uses.pool` on the same class names the same thing, and the
   * `class-resource` use-scaling reads its amount. `display: true` is the explicit opt-out for a
   * column that is genuinely only ink - Sneak Attack's dice, the Monk's unarmored movement, a
   * mastery count - and `class-resource-pools.test.ts` holds every id to one or the other, so a
   * resource that LOOKS spendable and is wired to nothing cannot ship unannounced.
   */
  classResources: z.array(z.object({
    id: ContentIdSchema, name: z.string().min(1).max(60),
    amount: z.union([z.number().int().min(0).max(999), z.string().min(1).max(20)]),
    /** This column is ink only - no live pool answers to this id, and none is expected to. */
    display: z.boolean().optional()
  }).strict()).max(8).default([])
}).strict();
export type ClassLevelRow = z.infer<typeof ClassLevelRowSchema>;

/** Spellcasting a class (or a third-caster subclass) grants. */
export const ContentSpellcastingSchema = z.object({
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
}).strict();
export type ContentSpellcasting = z.infer<typeof ContentSpellcastingSchema>;

/** Ability minimums for taking this class as a multiclass; `mode: "any"` covers "STR 13 or DEX 13". */
export const MulticlassPrerequisiteSchema = z.object({
  mode: z.enum(["all", "any"]).default("all"),
  minimums: z.array(z.object({ ability: AbilitySchema, minimum: z.number().int().min(1).max(20) }).strict()).min(1).max(6)
}).strict();

export const ClassReferenceSchema = z.object({
  ...contentRecordBase,
  hitDie: HitDieSchema,
  /**
   * Ordered ability priority, best first - the random generator's core input. Data, not code, so a
   * homebrew class supplies its own without touching `@vtt/rules-5e`.
   */
  statPriority: z.array(AbilitySchema).length(6),
  /** The class's headline ability (one, or two for Fighter/Monk/Paladin/Ranger). */
  primaryAbilities: z.array(AbilitySchema).min(1).max(2),
  /** The two saving throws granted at level 1. */
  savingThrows: z.array(AbilitySchema).min(1).max(6),
  skillChoices: ChoiceListSchema,
  armorProficiencies: z.array(ContentIdSchema).max(10).default([]),
  weaponProficiencies: z.array(ContentIdSchema).max(40).default([]),
  toolProficiencies: z.array(ContentIdSchema).max(20).default([]),
  toolChoices: ChoiceListSchema.optional(),
  startingEquipment: z.array(StartingEquipmentOptionSchema).max(6).default([]),
  /** Proficiencies gained when the class is taken as a MULTICLASS (narrower than the level-1 set). */
  multiclassProficiencies: z.object({
    armor: z.array(ContentIdSchema).max(10).default([]),
    weapons: z.array(ContentIdSchema).max(40).default([]),
    tools: z.array(ContentIdSchema).max(20).default([]),
    skills: ChoiceListSchema.optional()
  }).strict().optional(),
  multiclassPrerequisites: MulticlassPrerequisiteSchema.optional(),
  /** The level the subclass is chosen at, and what the class calls it ("Martial Archetype"). */
  subclassLevel: ContentLevelSchema,
  subclassLabel: z.string().max(60).optional(),
  /** Levels granting an Ability Score Improvement (or a feat instead). */
  asiLevels: z.array(ContentLevelSchema).max(10).default([]),
  spellcasting: ContentSpellcastingSchema.optional(),
  /** The full 20-row printed table. */
  levelTable: z.array(ClassLevelRowSchema).length(20),
  /** Every feature the level table can grant, as shared FeatureRecords. */
  features: z.array(FeatureRecordSchema).max(160).default([])
}).strict().superRefine((entry, context) => {
  entry.levelTable.forEach((row, index) => {
    if (row.level !== index + 1) context.addIssue({ code: z.ZodIssueCode.custom, path: ["levelTable", index, "level"], message: `Level table row ${index} must be level ${index + 1}.` });
  });
  const featureIds = new Set(entry.features.map((feature) => feature.id));
  entry.levelTable.forEach((row, rowIndex) => row.features.forEach((featureId, featureIndex) => {
    if (!featureIds.has(featureId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["levelTable", rowIndex, "features", featureIndex], message: `Level ${row.level} grants unknown feature "${featureId}".` });
  }));
  const duplicate = entry.features.find((feature, index) => entry.features.findIndex((other) => other.id === feature.id) !== index);
  if (duplicate) context.addIssue({ code: z.ZodIssueCode.custom, path: ["features"], message: `Duplicate feature id "${duplicate.id}".` });
});
export type ClassReference = z.infer<typeof ClassReferenceSchema>;

// ---------------------------------------------------------------------------------------------
// Subclass
// ---------------------------------------------------------------------------------------------

export const SubclassReferenceSchema = z.object({
  ...contentRecordBase,
  /** The class this subclass belongs to. */
  classId: ContentIdSchema,
  /** Level the subclass is taken at; absent = inherit the class's `subclassLevel`. */
  subclassLevel: ContentLevelSchema.optional(),
  /** Third-caster subclasses (Eldritch Knight, Arcane Trickster) declare their own spellcasting. */
  spellcasting: ContentSpellcastingSchema.optional(),
  /** Extra table rows a caster subclass overlays on the class table (its own slot columns). */
  levelTable: z.array(ClassLevelRowSchema).max(20).optional(),
  features: z.array(FeatureRecordSchema).max(40).default([])
}).strict().superRefine((entry, context) => {
  const featureIds = new Set(entry.features.map((feature) => feature.id));
  (entry.levelTable ?? []).forEach((row, rowIndex) => row.features.forEach((featureId, featureIndex) => {
    if (!featureIds.has(featureId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["levelTable", rowIndex, "features", featureIndex], message: `Level ${row.level} grants unknown feature "${featureId}".` });
  }));
});
export type SubclassReference = z.infer<typeof SubclassReferenceSchema>;

// ---------------------------------------------------------------------------------------------
// Species
// ---------------------------------------------------------------------------------------------

export const CreatureSizeSchema = z.enum(["tiny", "small", "medium", "large", "huge", "gargantuan"]);

/**
 * A playable species. NOTE the deliberate absence of hardcoded ability bonuses: SRD 5.2.1 (2024) puts
 * ability increases on the BACKGROUND, not the species. `abilityBonuses` exists anyway, as optional
 * DATA, so a 2014-style species or a homebrew one can still carry them - the builder simply applies
 * whatever a record declares instead of assuming an edition.
 */
export const SpeciesReferenceSchema = z.object({
  ...contentRecordBase,
  /** Sizes a member of this species may be; several 2024 species let the player pick Small or Medium. */
  sizes: z.array(CreatureSizeSchema).min(1).max(6).default(["medium"]),
  speedFeet: z.number().int().min(0).max(120),
  /** Darkvision range in feet; null = none. */
  darkvisionFeet: z.number().int().min(0).max(240).nullable().default(null),
  /** Creature type slug ("humanoid", "fey", "construct"). */
  creatureType: ContentIdSchema.default("humanoid"),
  /** Fixed ability increases. Empty for every SRD 5.2.1 species (see the note above). Additive data. */
  abilityBonuses: z.array(z.object({ ability: AbilitySchema, amount: z.number().int().min(-2).max(3) }).strict()).max(6).default([]),
  /** "Choose N abilities to raise by M" (the 2014 variant-human / half-elf pattern). */
  abilityBonusChoice: z.object({
    choose: z.number().int().min(1).max(6),
    amount: z.number().int().min(1).max(3),
    from: z.array(AbilitySchema).min(1).max(6).default(["str", "dex", "con", "int", "wis", "cha"])
  }).strict().optional(),
  languages: z.array(ContentIdSchema).max(10).default([]),
  languageChoices: ChoiceListSchema.optional(),
  /** Species traits, as shared FeatureRecords. */
  traits: z.array(FeatureRecordSchema).max(30).default([]),
  /** Lineages / subraces, each adding its own traits on top. */
  lineages: z.array(z.object({
    id: ContentIdSchema, name: z.string().min(1).max(120), description: z.string().max(8000).optional(),
    traits: z.array(FeatureRecordSchema).max(20).default([])
  }).strict()).max(12).default([])
}).strict();
export type SpeciesReference = z.infer<typeof SpeciesReferenceSchema>;

// ---------------------------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------------------------

export const BackgroundReferenceSchema = z.object({
  ...contentRecordBase,
  /**
   * SRD 5.2.1 ability increases: three listed abilities, distributed either +2/+1 or +1/+1/+1.
   * `spreads` states the legal distributions as data, so a homebrew background can print its own.
   */
  abilityOptions: z.object({
    from: z.array(AbilitySchema).min(1).max(6),
    spreads: z.array(z.array(z.number().int().min(1).max(3)).min(1).max(3)).min(1).max(4).default([[2, 1], [1, 1, 1]])
  }).strict().optional(),
  /** The origin feat this background grants (SRD 5.2.1). */
  originFeatId: ContentIdSchema.optional(),
  skillProficiencies: z.array(ContentIdSchema).max(10).default([]),
  skillChoices: ChoiceListSchema.optional(),
  toolProficiencies: z.array(ContentIdSchema).max(10).default([]),
  toolChoices: ChoiceListSchema.optional(),
  languages: z.array(ContentIdSchema).max(10).default([]),
  languageChoices: ChoiceListSchema.optional(),
  startingEquipment: z.array(StartingEquipmentOptionSchema).max(6).default([]),
  features: z.array(FeatureRecordSchema).max(10).default([])
}).strict();
export type BackgroundReference = z.infer<typeof BackgroundReferenceSchema>;

// ---------------------------------------------------------------------------------------------
// Feat
// ---------------------------------------------------------------------------------------------

export const FeatReferenceSchema = z.object({
  ...contentRecordBase,
  /** Open slug: "origin", "general", "fighting-style", "epic-boon", or anything homebrew adds. */
  category: ContentIdSchema.default("general"),
  prerequisite: z.object({
    level: ContentLevelSchema.optional(),
    abilityScores: z.array(z.object({ ability: AbilitySchema, minimum: z.number().int().min(1).max(20) }).strict()).max(6).default([]),
    /** Proficiency or feature slugs the character must already have ("martial", "spellcasting"). */
    requires: z.array(ContentIdSchema).max(10).default([]),
    /** Anything not modeled above, printed for the player to judge (ADR-0008 prose fallback). */
    text: z.string().max(400).optional()
  }).strict().optional(),
  repeatable: z.boolean().default(false),
  /**
   * The feat's mechanics - literally the same FeatureRecord a class or species uses. A feat IS a
   * feature plus catalog metadata; nothing about it is special-cased.
   */
  feature: FeatureRecordSchema
}).strict();
export type FeatReference = z.infer<typeof FeatReferenceSchema>;

// ---------------------------------------------------------------------------------------------
// Name pools
// ---------------------------------------------------------------------------------------------

/** Hand-authored per-species name pools (task packet decision 11) feeding the random generator. */
export const NamePoolReferenceSchema = z.object({
  speciesId: ContentIdSchema,
  source: ContentSourceSchema,
  pools: z.array(z.object({
    id: ContentIdSchema,
    /** What this pool is ("Masculine", "Feminine", "Family", "Clan", "Nickname"). */
    label: z.string().min(1).max(60),
    names: z.array(z.string().min(1).max(60)).min(1).max(400)
  }).strict()).min(1).max(10)
}).strict();
export type NamePoolReference = z.infer<typeof NamePoolReferenceSchema>;

// ---------------------------------------------------------------------------------------------
// Spell lists
// ---------------------------------------------------------------------------------------------

/**
 * A spell list as a membership OVERLAY, never an edit to `spells.v1.json`.
 *
 * `bundles/spells.v1.json` is GENERATED (`scripts/build-bundle.ts`, which sets each spell's
 * `classes` straight from the vendored open5e fixtures). Hand-editing a homebrew tag into it is
 * destroyed by the next rebuild, and editorialising a CC-BY vendored artifact is wrong on principle.
 * So "an SRD spell on a homebrew list" is expressed as a record here and folded into `classes` at
 * the server's content merge point (`applySpellListOverlay`) - the ETL and `resolveCatalogChoice`
 * both need zero change, because the resolver already filters on `classes.includes(listId)`.
 *
 * `basedOn` is what keeps "the Wizard list plus my three spells" ONE row instead of 221; `add` and
 * `remove` handle the surgical cases. A list's members are additionally seeded by any spell that
 * tags this id in its own `classes`, so a wholly-homebrew list needs no `add` entries at all.
 *
 * A list resolving to ZERO spells is a hard `character.create` rejection downstream
 * (`resolveCatalogChoice` refuses to return an empty option list), so publish-time validation must
 * check it - see `spellListMemberIds`.
 */
export const SpellListReferenceSchema = z.object({
  ...contentRecordBase,
  /** Start from these existing list ids - SRD (`wizard`) or another overlay. Empty = start blank. */
  basedOn: z.array(ContentIdSchema).max(8).default([]),
  /** Spell ids added on top of the `basedOn` expansion. SRD spell ids are perfectly legal here. */
  add: z.array(ContentIdSchema).max(500).default([]),
  /** Spell ids removed last, after everything else - a `remove` always wins. */
  remove: z.array(ContentIdSchema).max(500).default([])
}).strict();
export type SpellListReference = z.infer<typeof SpellListReferenceSchema>;
