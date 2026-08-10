import { z } from "zod";

/** Version 1 is intentionally small; it establishes the import contract before an adapter exists. */
export const ACTOR_SCHEMA_VERSION = 1;

/** Lowercase damage-type id ("slashing", "fire"); free-form so homebrew types stay expressible. */
const DamageTypeIdSchema = z.string().min(1).max(40);
const ConditionIdSchema = z.string().regex(/^[a-z0-9-]+$/).max(60);
const EffectTagSchema = z.string().regex(/^[a-z0-9-]+$/).max(40);
/** Open identity slug, matching the content catalog's `ContentIdSchema` (no new closed enums for identity). */
const RiderSlugSchema = z.string().regex(/^[a-z0-9-]+$/).max(80);
const SizeSchema = z.enum(["tiny", "small", "medium", "large", "huge", "gargantuan"]);
/** A safe dice expression, one die term plus at most one flat modifier - never an evaluable string (ADR-0008). */
export const DiceFormulaSchema = z.string().regex(/^\d+d(?:4|6|8|10|12|20|100)(?:\s*[+-]\s*\d+)?$/i, "Use a safe dice formula such as 1d8 + 3.");
export const AbilitySchema = z.enum(["str", "dex", "con", "int", "wis", "cha"]);
export type AbilityId = z.infer<typeof AbilitySchema>;

// ---------------------------------------------------------------------------------------------
// Rider gates - the ONE trigger vocabulary an item, a feature, a feat, or an effect all share.
// ---------------------------------------------------------------------------------------------

/**
 * WHERE an item is worn or held. A CLOSED enum, deliberately, and the one exception to the content
 * catalog's "no new closed enums" rule - because `slot` is not IDENTITY (that stays the open
 * `category` slug), it is the MECHANICAL hook the engine exhaustively switches on: what derives AC,
 * what may be equipped twice, what an attunement gate applies to. A homebrew `category: "relic"`
 * with `slot: "armor"` derives AC; the open slug alone never could.
 */
export const ItemSlotSchema = z.enum([
  "weapon", "shield", "armor",                                    // the three the engine already knows
  "head", "neck", "shoulders", "hands", "ring", "belt", "feet",   // worn
  "held",        // wand, orb, rod, staff, focus
  "wondrous",    // attunable, no body location
  "consumable",  // potion, scroll
  "ammunition",
  "none"         // pure gear, no equip semantics
]);
export type ItemSlot = z.infer<typeof ItemSlotSchema>;

/**
 * WHEN a rider applies. Thirty-one named triggers in four KINDS, and the kind is what decides the
 * evaluation layer so a GM never picks one (see `RIDER_TRIGGER_KINDS`):
 *
 *   - `static-gate`  resolvable from the sheet alone   -> a standing number ("AC 17")
 *   - `dynamic-gate` live actor state                  -> a labelled note, re-checked per roll
 *   - `moment`       the named roll or event           -> fires at that moment only
 *   - `filter`       narrows whatever moment it accompanies
 *
 * This is DATA, not an expression language. Every member is a `.strict()` object with bounded
 * parameters; there is no OR, no NOT, no nesting and no arithmetic. ADR-0008 exists to stop this
 * becoming a parser, and `armor-class.whileArmored` is the same idea in miniature - one named
 * boolean gate - now enumerated instead of grown one flag at a time.
 */
export const RiderTriggerSchema = z.discriminatedUnion("type", [
  // ---- static gates (6) ----------------------------------------------------------------------
  /** The bearer is attuned. Redundant (and harmless) when the item's own `attunement.required` is true. */
  z.object({ type: z.literal("attuned") }).strict(),
  /** Wearing armor. Omitting `weights` is exactly the pre-existing `whileArmored: true` meaning. */
  z.object({ type: z.literal("while-armored"), weights: z.array(z.enum(["light", "medium", "heavy"])).min(1).max(3).optional() }).strict(),
  z.object({ type: z.literal("while-unarmored"), allowShield: z.boolean().default(false) }).strict(),
  /** `wielding: false` expresses the Dueling-style "only while NOT holding a shield". */
  z.object({ type: z.literal("while-shield"), wielding: z.boolean().default(true) }).strict(),
  /** Two lists in ONE trigger so "Paladin or Cleric" is a single entry rather than an OR. */
  z.object({ type: z.literal("while-character-is"), classIds: z.array(RiderSlugSchema).max(8).default([]), speciesIds: z.array(RiderSlugSchema).max(8).default([]) }).strict(),
  z.object({ type: z.literal("while-proficient-with"), kind: z.enum(["weapon", "armor", "tool", "skill"]), ids: z.array(RiderSlugSchema).min(1).max(12) }).strict(),
  // ---- dynamic gates (3) ---------------------------------------------------------------------
  /** Any-of against `actor.effects[].tags`; the `ActionSchema.requiresEffectTag` precedent, widened to a list. */
  z.object({ type: z.literal("while-effect-tag"), tags: z.array(EffectTagSchema).min(1).max(4) }).strict(),
  z.object({ type: z.literal("while-hp-at-or-below"), percent: z.number().int().min(1).max(99) }).strict(),
  z.object({ type: z.literal("while-condition"), conditionIds: z.array(ConditionIdSchema).min(1).max(6), present: z.boolean().default(true) }).strict(),
  // ---- moments (11) --------------------------------------------------------------------------
  z.object({ type: z.literal("on-attack-roll") }).strict(),
  z.object({ type: z.literal("on-hit") }).strict(),
  z.object({ type: z.literal("on-critical-hit") }).strict(),
  /** The curse mirror of `on-critical-hit`: a natural 1. */
  z.object({ type: z.literal("on-critical-miss") }).strict(),
  z.object({ type: z.literal("on-damage-roll") }).strict(),
  z.object({ type: z.literal("on-saving-throw") }).strict(),
  z.object({ type: z.literal("on-ability-check") }).strict(),
  z.object({ type: z.literal("on-initiative-roll") }).strict(),
  z.object({ type: z.literal("on-death-save") }).strict(),
  z.object({ type: z.literal("on-taking-damage") }).strict(),
  z.object({ type: z.literal("on-spell-cast") }).strict(),
  // ---- filters (10) --------------------------------------------------------------------------
  /** `reaction` and `opportunity` require the resolver to ANNOUNCE the trigger; until it does they never match. */
  z.object({ type: z.literal("attack-kind-is"), kinds: z.array(z.enum(["melee", "ranged", "spell", "unarmed", "thrown", "reaction", "opportunity"])).min(1).max(7) }).strict(),
  z.object({ type: z.literal("weapon-property-is"), properties: z.array(RiderSlugSchema).min(1).max(12) }).strict(),
  z.object({ type: z.literal("damage-type-is"), damageTypes: z.array(DamageTypeIdSchema).min(1).max(12) }).strict(),
  z.object({ type: z.literal("ability-is"), abilities: z.array(AbilitySchema).min(1).max(6) }).strict(),
  z.object({ type: z.literal("skill-is"), skills: z.array(RiderSlugSchema).min(1).max(12) }).strict(),
  z.object({ type: z.literal("spell-school-is"), schools: z.array(RiderSlugSchema).min(1).max(8) }).strict(),
  z.object({ type: z.literal("spell-level-is"), levels: z.array(z.number().int().min(0).max(9)).min(1).max(10) }).strict(),
  /**
   * The SPECIFIC spell being cast. `spell-school-is` and `spell-level-is` narrow a category; this
   * names one record, which is what a printed "when you cast Eldritch Blast" actually says. Without
   * it Agonizing Blast is inexpressible: no combination of school and level picks out one cantrip.
   *
   * It matches `ActorAction.spellId` - the spell an action IS - so it fires on the item-cast actions
   * the derivation synthesises and on any feature action that names its spell. An action with no
   * `spellId` never matches, which is the fail-closed every other filter uses.
   */
  z.object({ type: z.literal("spell-id-is"), spellIds: z.array(RiderSlugSchema).min(1).max(12) }).strict(),
  /** Authorable but INERT until `ActorDefinition` carries a creature type - see the vocabulary notes. */
  z.object({ type: z.literal("versus-creature-type"), creatureTypes: z.array(RiderSlugSchema).min(1).max(12) }).strict(),
  z.object({ type: z.literal("versus-size"), sizes: z.array(SizeSchema).min(1).max(6) }).strict(),
  z.object({ type: z.literal("versus-condition"), conditionIds: z.array(ConditionIdSchema).min(1).max(6) }).strict()
]);
export type RiderTrigger = z.infer<typeof RiderTriggerSchema>;
export type RiderTriggerKind = "static-gate" | "dynamic-gate" | "moment" | "filter";

/**
 * The static table that decides a rider's evaluation LAYER, so the GM never has to. All-static (or
 * empty) = a standing number baked by whatever reconciles the carrier; any dynamic gate = a
 * conditional note re-checked per roll; any moment or filter = momentary, evaluated at that moment.
 * One table, shared by every consumer, so the layer can never be decided two different ways.
 */
export const RIDER_TRIGGER_KINDS: Readonly<Record<RiderTrigger["type"], RiderTriggerKind>> = Object.freeze({
  attuned: "static-gate", "while-armored": "static-gate", "while-unarmored": "static-gate",
  "while-shield": "static-gate", "while-character-is": "static-gate", "while-proficient-with": "static-gate",
  "while-effect-tag": "dynamic-gate", "while-hp-at-or-below": "dynamic-gate", "while-condition": "dynamic-gate",
  "on-attack-roll": "moment", "on-hit": "moment", "on-critical-hit": "moment", "on-critical-miss": "moment",
  "on-damage-roll": "moment", "on-saving-throw": "moment", "on-ability-check": "moment",
  "on-initiative-roll": "moment", "on-death-save": "moment", "on-taking-damage": "moment", "on-spell-cast": "moment",
  "attack-kind-is": "filter", "weapon-property-is": "filter", "damage-type-is": "filter", "ability-is": "filter",
  "skill-is": "filter", "spell-school-is": "filter", "spell-level-is": "filter", "spell-id-is": "filter",
  "versus-creature-type": "filter", "versus-size": "filter", "versus-condition": "filter"
});

/** Which layer a `when` list belongs to. Pure lookup over `RIDER_TRIGGER_KINDS`; no state, no policy. */
export function riderLayer(when: readonly RiderTrigger[]): "standing" | "conditional" | "momentary" {
  const kinds = when.map((trigger) => RIDER_TRIGGER_KINDS[trigger.type]);
  if (kinds.some((kind) => kind === "moment" || kind === "filter")) return "momentary";
  if (kinds.some((kind) => kind === "dynamic-gate")) return "conditional";
  return "standing";
}

/**
 * An AND-list of at most four triggers, with at most ONE moment. A rider fires at one moment, not
 * two, and a filter with no moment is an authoring mistake (a `versus-size` on a rider that never
 * sees a target), not "always" - so both are rejected with the sentence that explains them.
 */
export const RiderWhenSchema = z.array(RiderTriggerSchema).max(4).superRefine((triggers, context) => {
  const kinds = triggers.map((trigger) => RIDER_TRIGGER_KINDS[trigger.type]);
  if (kinds.filter((kind) => kind === "moment").length > 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A rider fires at one moment, not two." });
  }
  if (kinds.includes("filter") && !kinds.includes("moment")) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A filter needs a moment to narrow - add the roll or event it applies to." });
  }
  const identity = triggers.find((trigger) => trigger.type === "while-character-is" && trigger.classIds.length === 0 && trigger.speciesIds.length === 0);
  if (identity) context.addIssue({ code: z.ZodIssueCode.custom, message: "`while-character-is` needs at least one class or species." });
  const duplicate = triggers.find((trigger, index) => triggers.findIndex((other) => other.type === trigger.type) !== index);
  if (duplicate) context.addIssue({ code: z.ZodIssueCode.custom, message: `Two "${duplicate.type}" triggers on one rider - list the values in a single entry instead.` });
}).default([]);

/**
 * The two gate fields every rider carries. `scope` has a DERIVED default so a GM never sets it: on
 * an item with a weapon block the attack/damage/crit family means "with this weapon", everything
 * else means "the bearer". On a non-item carrier `"this-item"` has nothing to bind to and resolves
 * to `"bearer"` - it parses, and the authoring UI warns.
 */
export const riderGate = {
  when: RiderWhenSchema,
  scope: z.enum(["bearer", "this-item"]).optional()
} as const;

// ---------------------------------------------------------------------------------------------
// The three riders BOTH vocabularies carry. Declared once here and spread into `EffectModifier`
// (below) and `FeatureModifier` (@vtt/content-srd-5.2.1), so the two can never drift apart.
// ---------------------------------------------------------------------------------------------

/**
 * A flat bonus to the bearer's attack rolls. THE missing channel: the resolver's to-hit is
 * `action.attack.bonus + exhaustionPenalty(attacker)` and nothing else could reach it.
 */
export const AttackBonusVariantSchema = z.object({
  type: z.literal("attack-bonus"),
  amount: z.number().int().min(-10).max(10),
  ...riderGate
}).strict();

/**
 * Extra typed damage. Neither existing channel can serve this: the effect-side `damage-bonus` is a
 * flat integer with no type, and `attack.criticalBonusDice` is a bare COUNT applied to the first
 * damage part, so it cannot carry a damage type either. `doubleOnCritical` defaults FALSE because 5e
 * does not double dice added after the attack.
 *
 * TWO WAYS TO SAY HOW MUCH, and a rider may use either or both:
 *
 *   - `formula` - dice ("an extra 1d6 fire"), the original and still the common case;
 *   - `abilityModifier` - the BEARER's modifier in that ability, as a flat number resolved at the
 *     roll ("add your Charisma modifier to the damage"). A printed feature says this constantly and
 *     it was previously inexpressible: the amount depends on the character, so no authored constant
 *     is correct, and re-authoring the record per character is not authoring.
 *
 * Agonizing Blast is exactly `abilityModifier: "cha"` plus a `spell-id-is` gate, and it is the
 * reason both landed together (decision D5). A rider with NEITHER field adds nothing; the homebrew
 * publish validator refuses it rather than letting it store and silently do nothing.
 */
export const ExtraDamageVariantSchema = z.object({
  type: z.literal("extra-damage"),
  formula: DiceFormulaSchema.optional(),
  /** Add the BEARER's modifier in this ability as a flat number (Agonizing Blast: + your Charisma modifier). */
  abilityModifier: AbilitySchema.optional(),
  damageType: DamageTypeIdSchema,
  doubleOnCritical: z.boolean().default(false),
  ...riderGate
}).strict();

/**
 * Advantage or disadvantage on a NAMED roll: one variant with a `mode` field rather than 2 x N
 * types. It feeds `aggregateRollMode`, which already implements 5e cancellation (any advantage plus
 * any disadvantage is normal) and labels each source for the roll card, so a curse is just
 * `mode: "disadvantage"` and needs no separate machinery.
 */
export const RollModeVariantSchema = z.object({
  type: z.literal("roll-mode"),
  roll: z.enum(["attack", "incoming-attack", "save", "check", "initiative", "death-save", "concentration"]),
  mode: z.enum(["advantage", "disadvantage"]),
  ...riderGate
}).strict();

/**
 * Typed modifiers an active effect contributes to the rules engine (ADR-0020). The vocabulary is
 * deliberately small and grows additively - unmodeled mechanics stay prose per ADR-0008.
 * `attack-advantage` is evaluated only on the bearer's own turn (Reckless Attack semantics).
 *
 * The last three are the SHARED riders, identical objects to the ones `FeatureModifierSchema`
 * carries. The six legacy advantage/disadvantage variants stay exactly as they were: `roll-mode` is
 * the general form, and `toRollModes` below normalises both shapes so no consumer branches on eight.
 */
export const EffectModifierSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("damage-bonus"), amount: z.number().int().min(-20).max(20), appliesTo: z.enum(["melee", "all"]).default("all") }).strict(),
  z.object({ type: z.literal("damage-resistance"), damageTypes: z.array(DamageTypeIdSchema).min(1).max(20) }).strict(),
  /**
   * THE OTHER HALF OF THE DEFENCE VOCABULARY, and until it existed a player character could not be
   * vulnerable to anything. `damageVulnerabilities` was declared on `ActorDefinition` and written
   * only by a monster stat block; no effect, no item and no feature could grant it - so a curse that
   * doubled fire damage was prose. It mirrors `damage-resistance` exactly, and `adjustDamageParts`
   * already implements the SRD's cancellation rule (resistance + vulnerability = normal damage).
   */
  z.object({ type: z.literal("damage-vulnerability"), damageTypes: z.array(DamageTypeIdSchema).min(1).max(20) }).strict(),
  z.object({ type: z.literal("attack-advantage") }).strict(),
  z.object({ type: z.literal("incoming-attack-advantage") }).strict(),
  /** The bearer's own attack rolls have disadvantage (always-on, unlike turn-scoped attack-advantage). */
  z.object({ type: z.literal("attack-disadvantage") }).strict(),
  /** Attack rolls against the bearer have disadvantage (Dodge). */
  z.object({ type: z.literal("incoming-attack-disadvantage") }).strict(),
  /** The bearer's saving throws have advantage; absent ability = all saves (Dodge grants Dex only). */
  z.object({ type: z.literal("save-advantage"), ability: z.enum(["str", "dex", "con", "int", "wis", "cha"]).optional() }).strict(),
  z.object({ type: z.literal("save-disadvantage"), ability: z.enum(["str", "dex", "con", "int", "wis", "cha"]).optional() }).strict(),
  AttackBonusVariantSchema,
  ExtraDamageVariantSchema,
  RollModeVariantSchema
]);
export type EffectModifier = z.infer<typeof EffectModifierSchema>;

/** One normalised advantage/disadvantage claim: which roll, which way. */
export type NormalisedRollMode = Readonly<{ roll: z.infer<typeof RollModeVariantSchema>["roll"]; mode: "advantage" | "disadvantage"; ability?: AbilityId }>;

/**
 * ONE normaliser for both shapes, so a consumer never branches on eight variants: the six legacy
 * advantage/disadvantage members and the general `roll-mode` come back as the same claim. Anything
 * else (a damage bonus, an attack bonus) normalises to no claims at all.
 */
export function toRollModes(modifier: EffectModifier): readonly NormalisedRollMode[] {
  switch (modifier.type) {
    case "attack-advantage": return [{ roll: "attack", mode: "advantage" }];
    case "attack-disadvantage": return [{ roll: "attack", mode: "disadvantage" }];
    case "incoming-attack-advantage": return [{ roll: "incoming-attack", mode: "advantage" }];
    case "incoming-attack-disadvantage": return [{ roll: "incoming-attack", mode: "disadvantage" }];
    case "save-advantage": return [{ roll: "save", mode: "advantage", ...(modifier.ability ? { ability: modifier.ability } : {}) }];
    case "save-disadvantage": return [{ roll: "save", mode: "disadvantage", ...(modifier.ability ? { ability: modifier.ability } : {}) }];
    case "roll-mode": return [{ roll: modifier.roll, mode: modifier.mode }];
    default: return [];
  }
}

/** What happens when an effect ends (Frenzy: one level of Exhaustion when the rage ends). */
export const EffectOnEndSchema = z.object({ type: z.literal("condition"), conditionId: ConditionIdSchema, level: z.number().int().min(1).max(6).optional() }).strict();

/**
 * A live rules-engine effect on an actor (Rage, Reckless Attack, a crocodile's grapple). Distinct
 * from display conditions: effects carry source links, durations, and typed modifiers, and the
 * engine ends them (turn boundaries, source defeat, encounter end) - clearing linked conditions and
 * firing onEnd. Ids are commandId-derived strings so idempotent retries mint the same effect.
 */
export const EffectInstanceSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  tags: z.array(EffectTagSchema).max(8).default([]),
  /** Who sustains/caused it; stripped from player projections (viewer safety). Null for GM-added house effects. */
  sourceActorId: z.string().uuid().nullable().default(null),
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
  /** Dodge: the effect's modifiers stop applying while the bearer is incapacitated (SRD). Additive. */
  voidWhileIncapacitated: z.boolean().default(false),
  /** The SOURCE actor concentrates to sustain this (SRD Concentration): one at a time; damage to the source prompts a CON save; incapacitation breaks it. Additive. */
  concentration: z.boolean().default(false),
  /** Cascade: this effect ends when the actor no longer has any other effect carrying this tag (Frenzy's marker ends with the Rage). */
  endsWithTag: z.string().regex(/^[a-z0-9-]+$/).max(40).nullable().default(null),
  modifiers: z.array(EffectModifierSchema).max(8).default([]),
  /** Conditions this effect applied to the SAME actor; removed automatically when the effect ends. */
  linkedConditionIds: z.array(ConditionIdSchema).max(4).default([]),
  /** Display + future escape flow ("Escape DC 15"); ending the escapable effect stays manual for now. */
  escapeDc: z.number().int().min(1).max(40).nullable().default(null),
  onEnd: z.array(EffectOnEndSchema).max(2).default([])
}).strict();
export type EffectInstance = z.infer<typeof EffectInstanceSchema>;

/** Death-save state while a player character is dying at 0 HP; null when not dying. 3 successes → stable, 3 failures → dead. */
export const DeathSavesSchema = z.object({
  successes: z.number().int().min(0).max(3),
  failures: z.number().int().min(0).max(3),
  stable: z.boolean().default(false)
}).strict();
export type DeathSaves = z.infer<typeof DeathSavesSchema>;

/**
 * How a token's current health shows on the battlemap. `band` is the coarse status badge shown to
 * everyone (the prior behavior); `bar` and `ring` are richer indicators whose visibility to
 * players/viewer is gated by `audience` ("gm" = GM map only; "all" = everyone, with exact fill for
 * the GM and the token's owner but only a coarse band-fraction for others - exact HP never leaks).
 * Used both table-wide (`combat.healthDisplay`) and as a per-token override (`actor.healthDisplay`).
 */
export const HealthDisplayStyleSchema = z.enum(["band", "bar", "ring", "aura"]);
export const HealthDisplayAudienceSchema = z.enum(["gm", "all"]);
export const HealthDisplaySchema = z.object({ style: HealthDisplayStyleSchema, audience: HealthDisplayAudienceSchema }).strict();
export type HealthDisplayStyle = z.infer<typeof HealthDisplayStyleSchema>;
export type HealthDisplayAudience = z.infer<typeof HealthDisplayAudienceSchema>;
export type HealthDisplay = z.infer<typeof HealthDisplaySchema>;

/** SRD skill id slug ("stealth", "arcana"); free-form so homebrew stays expressible. */
const SkillIdSchema = z.string().regex(/^[a-z0-9-]+$/).max(60);
/** Armor/weapon/tool/language proficiency slug ("light", "martial", "thieves-tools", "elvish"); open by design. */
const ProficiencyIdSchema = z.string().regex(/^[a-z0-9-]+$/).max(60);
/** One carried inventory item. Quantities/equipped/attuned are live state that changes during play (ADR-0007 additive). */
/** Mechanical stats an inventory item carries when added from the SRD catalog, so equipping it has effect
 * (weapon → a rollable attack action on the sheet; armor/shield → derived Armor Class). Additive-optional;
 * absent for homebrew/pre-existing items, which then have no mechanical effect (display only). */
export const ItemWeaponSchema = z.object({
  category: z.enum(["simple", "martial"]), damageDice: z.string().min(1).max(20), damageType: z.string().min(1).max(40),
  rangeFeet: z.number().int().positive().nullable(), longRangeFeet: z.number().int().positive().nullable(),
  /** SRD weapon property slugs ("finesse", "versatile", "thrown", "two-handed", "light", "heavy", "reach", "loading", "ammunition"). Open slugs so homebrew properties and 2024 masteries stay expressible; ABSENT = not recorded (behaves exactly as before), an empty array = "this weapon has no properties". Additive-optional. */
  properties: z.array(z.string().regex(/^[a-z0-9-]+$/).max(40)).max(12).optional()
}).strict();
export const ItemArmorSchema = z.object({ acBase: z.number().int().min(2).max(25), addDexModifier: z.boolean(), dexModifierCap: z.number().int().nullable(), stealthDisadvantage: z.boolean(), strengthRequired: z.number().int().nullable() }).strict();
/**
 * The NON-SECRET marker for a carried magic item, copied when the item was added. It exists so the
 * sheet can render the Attune control and the magic styling without a catalog lookup.
 *
 * It deliberately carries NO riders, NO casts and NO `cursed` flag. The owner is handed their whole
 * inventory verbatim in their projection, so anything placed on this row reaches the player the
 * instant they pick the item up. Mechanics resolve by `item.id` against the content catalog, which
 * never leaves the server - the same rule feature riders already follow. Additive-optional.
 */
export const ItemMagicMarkerSchema = z.object({
  isMagic: z.boolean().default(false),
  attunementRequired: z.boolean().default(false),
  slot: ItemSlotSchema.optional()
}).strict();
export const InventoryItemSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/).max(80),
  name: z.string().min(1).max(120),
  quantity: z.number().int().min(0).max(9999).default(1),
  equipped: z.boolean().default(false),
  attuned: z.boolean().default(false),
  weightEach: z.number().nonnegative().max(1_000_000).optional(),
  description: z.string().max(4000).optional(),
  /** Equipment category slug when added from the SRD catalog (weapon/armor/tool/...); free-form so homebrew stays expressible. Drives sheet grouping and (with weapon/armor below) mechanical effect. Additive. */
  category: z.string().regex(/^[a-z0-9-]+$/).max(40).optional(),
  weapon: ItemWeaponSchema.optional(),
  armor: ItemArmorSchema.optional(),
  /** Display-only marker so the sheet can offer Attune without the catalog; NEVER the riders. Additive-optional. */
  magic: ItemMagicMarkerSchema.optional()
}).strict();
export type InventoryItem = z.infer<typeof InventoryItemSchema>;
/** SRD coin purse; all five currencies, each defaulting to 0. */
export const CurrencySchema = z.object({
  cp: z.number().int().min(0).max(1_000_000).default(0),
  sp: z.number().int().min(0).max(1_000_000).default(0),
  ep: z.number().int().min(0).max(1_000_000).default(0),
  gp: z.number().int().min(0).max(1_000_000).default(0),
  pp: z.number().int().min(0).max(1_000_000).default(0)
}).strict();
export type Currency = z.infer<typeof CurrencySchema>;
/** A live spell-slot pool for one slot level (remaining out of the definition's maximum). */
export const SpellSlotSchema = z.object({ level: z.number().int().min(1).max(9), remaining: z.number().int().min(0).max(9) }).strict();

/** Faces per hit-die size, so a mixed pool can name its largest die without a second lookup table. */
const HIT_DIE_FACES: Readonly<Record<string, number>> = Object.freeze({ d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20 });

/** ONE size of Hit Point Die a creature carries: a Fighter 3 / Wizard 2 has a 3×d10 entry AND a 2×d6 entry. */
export const HitDiceEntrySchema = z.object({
  die: z.enum(["d4", "d6", "d8", "d10", "d12", "d20"]),
  maximum: z.number().int().min(1).max(40),
  remaining: z.number().int().min(0).max(40)
}).strict();
export type HitDiceEntry = z.infer<typeof HitDiceEntrySchema>;

/**
 * Normalise every accepted Hit-Dice input to the pool shape, so the field grows additively without a
 * schemaVersion bump (ADR-0007). Three inputs are accepted:
 *   - `{die, maximum, remaining}`             — a save written before multiclass pools existed.
 *   - `[{die, maximum, remaining}, …]`        — a bare pool array.
 *   - `{die, maximum, remaining, entries[]}`  — the current shape; the summary is RE-DERIVED here, never
 *                                               trusted, so a hand-written summary cannot drift.
 * Malformed input is passed straight through so Zod reports the real error instead of this helper.
 */
function normaliseHitDicePool(input: unknown): unknown {
  if (input === null || input === undefined || typeof input !== "object") return input;
  // Order matters: `"entries" in []` is TRUE (arrays inherit Array.prototype.entries), so the bare-array
  // case must be settled before the carrier is inspected, and the carrier check must be own-property.
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
    if (typeof entryDie !== "string" || typeof entryMaximum !== "number" || typeof entryRemaining !== "number") return input;
    entries.push({ die: entryDie, maximum: entryMaximum, remaining: entryRemaining });
    maximum += entryMaximum;
    remaining += entryRemaining;
    const faces = HIT_DIE_FACES[entryDie] ?? 0;
    if (faces > largestFaces) { largestFaces = faces; die = entryDie; }
  }
  return { die, maximum, remaining, entries };
}

/**
 * A live Hit Point Dice POOL (SRD Hit Point Dice). `entries` is the truth: a multiclass sheet carries
 * several die sizes at once (Fighter 3 / Wizard 2 = 3d10 + 2d6), which one `{die, maximum}` could not
 * express — it silently dropped every class after the first.
 *
 * `die`/`maximum`/`remaining` are a DERIVED summary kept for the pre-multiclass readers: the TOTAL
 * number of dice in the pool, labelled with the largest size present. They are recomputed from
 * `entries` on every parse, so summary and pool cannot drift — never write them by hand, build the
 * pool with `makeHitDicePool`.
 */
export const HitDicePoolSchema = z.preprocess(normaliseHitDicePool, z.object({
  die: HitDiceEntrySchema.shape.die,
  maximum: z.number().int().min(1).max(240),
  remaining: z.number().int().min(0).max(240),
  entries: z.array(HitDiceEntrySchema).min(1).max(6)
}).strict().nullable());
export type HitDicePool = NonNullable<z.infer<typeof HitDicePoolSchema>>;

/** Build a pool (summary included) from per-die entries. An empty pool is `null` — "not modeled". */
export function makeHitDicePool(entries: readonly HitDiceEntry[]): HitDicePool | null {
  return entries.length === 0 ? null : HitDicePoolSchema.parse(entries) as HitDicePool;
}

export const ActorSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  kind: z.enum(["player-character", "monster", "npc"]),
  visibility: z.enum(["public", "gm-only"]).default("public"),
  hp: z.object({ current: z.number().int(), maximum: z.number().int().positive(), temporary: z.number().int().nonnegative().default(0) }),
  armorClass: z.number().int().positive().optional(),
  initiative: z.number().int().optional(),
  ownerSessionId: z.string().uuid().nullable().default(null),
  notes: z.string().max(10000).optional(),
  /** Provenance: slug of the definition this actor was instantiated from - a content-bundle id or an imported definition id (additive; absent for seeded actors). */
  definitionId: z.string().regex(/^[a-z0-9-]+$/).max(200).optional(),
  /** Token footprint in grid cells per side (large 2, huge 3, gargantuan 4); absent means 1. */
  sizeCells: z.number().int().min(1).max(4).optional(),
  /** D&D creature size label; drives sizeCells and lets the GM pick Tiny/Small/Medium (all 1×1). Absent means Medium. */
  size: z.enum(["tiny", "small", "medium", "large", "huge", "gargantuan"]).optional(),
  /** Custom uploaded token image (a token-asset id); absent means the initials glyph. Additive. */
  tokenAssetId: z.string().uuid().optional(),
  /** Active conditions by content-bundle id; `level` is only meaningful for exhaustion (1-6). Set manually or applied by the rules engine (failed saves, on-hit riders, the zero-HP machine - ADR-0020); still never silently mutated outside those documented paths. */
  conditions: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]+$/).max(60), level: z.number().int().min(1).max(6).optional() }).strict()).max(20).default([]),
  /** Live rules-engine effects (Rage, a grapple holding this actor). Additive per ADR-0007/0019. */
  effects: z.array(EffectInstanceSchema).max(20).default([]),
  /** Dying state at 0 HP (player characters only); null when not dying. Additive. */
  deathSaves: DeathSavesSchema.nullable().default(null),
  /** Spent limited-use counts by action id (per-encounter and per-long-rest pools). Additive. */
  actionUses: z.record(z.string(), z.number().int().nonnegative()).default({}),
  /**
   * PICKS RE-MADE ON A REST, keyed by the offer key the build already uses.
   *
   * "Whenever you finish a Long Rest, choose one type of land"; "whenever you finish a Short or Long
   * Rest, choose one damage type". These are the RUNTIME half of a feature's `replaces` clause and
   * they belong here rather than in `character.choices[]`: a Barbarian re-choosing weapon masteries
   * on a rest must not require a rebuild, and a GM has to be able to see it happen mid-session.
   *
   * `per` is the rest that CLEARS it - so an override lasts exactly until the next rest of that kind,
   * and the character falls back to the answer their build recorded until they choose again. A long
   * rest clears short-rest overrides too, the same nesting a short-rest use pool has. Additive:
   * absent means "nobody has re-chosen anything", which is every existing actor.
   */
  choiceOverrides: z.record(z.string(), z.object({
    id: z.string().regex(/^[a-z0-9-]+$/).max(80),
    per: z.enum(["short-rest", "long-rest"])
  }).strict()).default({}),
  /** Conditions this actor is immune to (seeded from its definition; enforced skip-with-narration). GM knowledge - stripped from player projections. Additive. */
  conditionImmunities: z.array(ConditionIdSchema).max(20).default([]),
  /** Walking speed in feet (seeded from the definition, GM-editable). Absent = unknown → movement rules skip, the unmeasurable pattern. Additive. */
  speedFeet: z.number().int().min(0).max(500).optional(),
  /** Legendary resources seeded from the definition (SRD 2024): per-round legendary actions and Legendary Resistance per day. GM knowledge - stripped from player projections. Additive. */
  legendary: z.object({ actionsPerRound: z.number().int().min(1).max(5).optional(), resistancesPerDay: z.number().int().min(1).max(6).optional() }).strict().optional(),
  /** Short-rest healing pool (SRD Hit Point Dice), seeded from the sheet's per-class hit dice (or a monster's hit-point formula); null = not modeled (rests behave as before). A pre-multiclass single-object save normalises into a one-entry pool on load — see HitDicePoolSchema. Reaches players only on their own claimed character. Additive. */
  hitDice: HitDicePoolSchema.default(null),
  /** Per-token health-display override; absent = inherit the table-wide `combat.healthDisplay`. GM knowledge - resolved and audience-gated in the player/viewer projections. Additive. */
  healthDisplay: HealthDisplaySchema.optional(),
  /** Epoch-ms timestamp of when this actor last entered a fight (encounter start / add-combatant). Powers the scene-setup "Recent" list; GM-only, stripped from the player projection. Additive. */
  lastUsedAt: z.number().int().nonnegative().optional(),
  /** Live spell-slot pools by level, seeded from the definition's spellcasting and expended during play (restored by rests). null = not a modeled spellcaster. Reaches players only on their own claimed character. Additive. */
  spellSlots: z.array(SpellSlotSchema).max(9).nullable().default(null),
  /** Warlock Pact Magic pool (one level, uniform slots). null = none. Owner-only in projections. Additive. */
  pactSlots: z.object({ level: z.number().int().min(1).max(5), remaining: z.number().int().min(0).max(4) }).strict().nullable().default(null),
  /** Spell ids prepared right now, seeded from the definition's default-prepared set and re-chosen on a long rest. Owner-only. Additive. */
  preparedSpellIds: z.array(z.string().max(80)).max(400).default([]),
  /** Carried inventory, seeded from the definition's starting loadout and mutated during play. Owner-only. Additive. */
  inventory: z.array(InventoryItemSchema).max(200).default([]),
  /** Coin purse, seeded from the definition's starting currency. Owner-only. Additive. */
  currency: CurrencySchema.default({}),
  /** GM-archived: hidden from players and excluded from the encounter builder / party. GM management flag; never projected to players or the viewer. Additive. */
  archived: z.boolean().default(false),
  /**
   * THIS COMBATANT BELONGS TO A LAUNCHED REPLAY (D3), and holds the id of the replay scene that minted it.
   *
   * `replay-launch.ts` clones an archived fight's combatants under new ids so a historical replay can
   * never rewrite tonight's characters. That safeguard stays; what this field buys is that the clones
   * stop being VISIBLE as campaign members. Present = "in the fight, never in the roster": every
   * management surface (the party, the claim screen, scene staging, add-to-the-fight) skips it through
   * the one shared rule `rosterActors` in `@vtt/domain`, while the map, the turn order and the tokens
   * keep it - a token whose actor is missing renders as an empty square, which is why the ENTRY stays
   * and only the roster lists subtract it (the same bargain `partyVisibility` documents).
   *
   * The scene is deleted when the replay ends (`scene.activate` away from it, `scene.remove`, or the
   * next launch), and every actor carrying its id goes with it. Absent = an ordinary campaign actor,
   * which is every actor that existed before this field. Additive.
   */
  replaySceneId: z.string().uuid().optional(),
  /**
   * The GM shared this ARCHIVED character's sheet back to players as a read-only keepsake (D26).
   * Default false - hidden until shared, never the other way round. Meaningless while `archived` is
   * false (a live character's sheet reaches only its owner, unchanged). The flag itself is GM
   * management and is stripped from player projections; what players receive is the name-and-id-only
   * `PlayerView.archivedCharacters` door. Additive.
   */
  sheetPreview: z.boolean().default(false)
});

export type Actor = z.infer<typeof ActorSchema>;

/** Immutable reusable content imported from JSON; mutable HP/position/ownership live elsewhere. */
export const ACTOR_DEFINITION_SCHEMA_VERSION = 1;
// `DiceFormulaSchema` and `AbilitySchema` are declared at the top of this file: the shared rider
// variants need them, and a `const` cannot be referenced before its declaration is evaluated.
/** SRD hit die by class (d4-d12); shared by per-class hit dice and content records. */
export const HitDieSchema = z.enum(["d4", "d6", "d8", "d10", "d12"]);
export type HitDie = z.infer<typeof HitDieSchema>;
/** Definition-side effect grant (Rage, Reckless Attack): resolving the action creates this effect on the actor itself. */
export const EffectGrantSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  tags: z.array(EffectTagSchema).min(1).max(8),
  duration: z.discriminatedUnion("type", [
    z.object({ type: z.literal("rounds"), rounds: z.number().int().min(1).max(100) }).strict(),
    z.object({ type: z.literal("until-source-next-turn") }).strict(),
    z.object({ type: z.literal("encounter") }).strict(),
    z.object({ type: z.literal("manual") }).strict()
  ]),
  modifiers: z.array(EffectModifierSchema).max(8).default([]),
  onEnd: z.array(EffectOnEndSchema).max(2).default([]),
  /** The granted effect ends when the actor loses every other effect with this tag (Frenzy's marker ends with the Rage). */
  endsWithTag: EffectTagSchema.optional(),
  /** Who receives the effect: the acting creature (default) or the action's single chosen target (Help). */
  target: z.enum(["self", "target"]).default("self"),
  /** Dodge: benefits lapse while the bearer is incapacitated (SRD). */
  voidWhileIncapacitated: z.boolean().default(false),
  /** The granter concentrates to sustain the effect (SRD Concentration). */
  concentration: z.boolean().default(false)
}).strict();

/**
 * Limited uses for an action or a content feature: "turn" resets every turn, "encounter" at
 * encounter start, "long-rest"/"short-rest" via a rest, "recharge" on a start-of-turn d6 >=
 * `recharge` (and on any rest). `pool` shares one counter across actions carrying the same pool id
 * (Sneak Attack once per turn regardless of weapon). Exported so content records (class/species
 * features) reuse the proven shape instead of inventing a parallel one.
 */
export const ActionUsesSchema = z.object({ limit: z.number().int().min(1).max(20), per: z.enum(["turn", "encounter", "long-rest", "short-rest", "recharge"]), pool: z.string().regex(/^[a-z0-9-]+$/).max(60).optional(), recharge: z.number().int().min(2).max(6).optional() }).strict().superRefine((uses, context) => {
  if (uses.per === "recharge" && uses.recharge === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["recharge"], message: "Recharge uses need the d6 threshold (e.g. 5 for \"Recharge 5-6\")." });
  if (uses.per !== "recharge" && uses.recharge !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["recharge"], message: "The recharge threshold only applies when per is \"recharge\"." });
});

/**
 * Every mechanics field below is additive-optional on schemaVersion 1 (ADR-0007 additive pattern,
 * ADR-0020 vocabulary): absent fields mean "prose only", and the engine falls back to reference
 * behavior exactly as before. Descriptions stay the display source of truth.
 */
export const ActionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), name: z.string().min(1).max(120), activation: z.enum(["action", "bonus-action", "reaction", "other"]), description: z.string().min(1).max(12000),
  attack: z.object({
    bonus: z.number().int(), reachFeet: z.number().int().positive().optional(), rangeFeet: z.number().int().positive().optional(),
    /** Normal range in feet for a two-range weapon ("80/320" → 80); attacks beyond it up to rangeFeet roll at disadvantage (SRD Range). */
    rangeNormalFeet: z.number().int().positive().optional(),
    /** Attack rolls this action grants (Extra Attack 2, Eldritch Blast beams). Absent = 1. */
    count: z.number().int().min(1).max(10).optional(),
    /** Extra weapon dice on a critical hit beyond crit doubling (Savage Attacks). Applies to the first damage part. */
    criticalBonusDice: z.number().int().min(1).max(4).optional()
  }).optional(),
  save: z.object({ ability: AbilitySchema, dc: z.number().int().min(1).max(40) }).optional(),
  damage: z.array(z.object({ formula: DiceFormulaSchema, type: z.string().min(1).max(40) })).max(8).default([]),
  /** Compound action: resolving a component consumes the shared action slot once and tracks the rest (crocodile Multiattack = one Bite + one Tail). */
  multiattack: z.array(z.object({ actionId: z.string().regex(/^[a-z0-9-]+$/), count: z.number().int().min(1).max(4) }).strict()).min(1).max(4).optional(),
  /** On-hit riders: conditions applied to the target as one source-linked effect (Bite: Grappled + Restrained, escape DC 15). */
  onHit: z.array(z.object({
    conditions: z.array(z.object({ id: ConditionIdSchema, level: z.number().int().min(1).max(6).optional() }).strict()).min(1).max(3),
    escapeDc: z.number().int().min(1).max(40).optional(),
    /** The rider only applies to targets of at most this size (crocodile Bite: large). */
    maxTargetSize: z.enum(["tiny", "small", "medium", "large", "huge", "gargantuan"]).optional()
  }).strict()).max(2).optional(),
  /** Targeting restrictions the engine enforces (Tail can't target the creature this crocodile grapples). */
  targetRules: z.array(z.enum(["not-grappled-by-source"])).max(2).optional(),
  /** Resolving this action grants an effect to the actor itself (Rage, Reckless Attack). */
  grants: EffectGrantSchema.optional(),
  /** The action requires an active self effect carrying this tag (Frenzy requires "raging"). */
  requiresEffectTag: EffectTagSchema.optional(),
  /** Limited uses; see ActionUsesSchema. */
  uses: ActionUsesSchema.optional(),
  /**
   * Resolving this action ALSO spends one of the bearer's own spell slots of this level - the
   * mechanical half of an item cast authored with `consumesSpellSlot` ("expend a spell slot to
   * cast it from the staff"). Absent = the action spends nothing but its own charges, which is
   * every action that existed before this field. The slot is checked and spent by the same economy
   * pass that owns limited uses, so a preview never spends and a refusal reads like every other
   * "no uses remaining".
   */
  spellSlot: z.object({ level: z.number().int().min(1).max(9) }).strict().optional(),
  /**
   * WHICH SPELL this action is a casting of. Identity only - every number the action rolls is
   * already on the action itself - so it changes no arithmetic and no existing reader.
   *
   * It exists because `spell-id-is` needs something to match against: "when you cast Eldritch Blast"
   * cannot be said with `spell-school-is` or `spell-level-is`, which name categories. The derivation
   * sets it on the actions it synthesises from an item's `casts` entries, and a feature action may
   * name it directly. Absent = this action is not a spell, and every `spell-id-is` gate fails closed.
   */
  spellId: z.string().regex(/^[a-z0-9-]+$/).max(80).optional(),
  /** Declared reaction the engine can offer as a pending prompt (Uncanny Dodge: when hit by an attack, halve its damage). Only meaningful on activation "reaction". */
  reaction: z.object({ trigger: z.literal("hit-by-attack"), response: z.literal("half-damage") }).strict().optional(),
  /** SRD Legendary Action: taken on OTHER creatures' turns, spending `cost` from the per-round pool (definition `legendary.actionsPerRound`) that refills when the creature's own turn starts. Pairs with activation "other". */
  legendary: z.object({ cost: z.number().int().min(1).max(5) }).strict().optional()
});

export type ActorAction = z.infer<typeof ActionSchema>;

/**
 * ONE recorded build decision - the choice-provenance ledger. Every wizard step that offered the
 * player a pick writes a row here (ASI-vs-feat, which list a skill came from, the subclass, the
 * equipment bundle, a chosen spell). Level-up and respec are impossible to prefill without it, and
 * homebrew content writes exactly the same rows.
 *
 * `kind` and `id` are OPEN slugs on purpose (architecture principle 3): "asi", "feat", "skill",
 * "subclass", "fighting-style", "equipment-pack", "spell", "expertise", "language", "tool", ... A
 * homebrew feature offering a brand-new kind of choice needs no schema change.
 */
export const CharacterChoiceSchema = z.object({
  /** Character level the decision belongs to (1-20); 1 for species/background/origin choices. */
  level: z.number().int().min(1).max(20),
  /** Class the decision belongs to; absent for species/background/origin choices. */
  classId: z.string().regex(/^[a-z0-9-]+$/).max(60).optional(),
  /** What kind of decision this was - an open slug, never a closed enum. */
  kind: z.string().regex(/^[a-z0-9-]+$/).max(60),
  /** The option that was chosen: a content id, an ability id for an ASI, a skill id, ... */
  id: z.string().regex(/^[a-z0-9-]+$/).max(80),
  /** Free-form rider carrying the decision's detail (ASI splits, the feature that offered the pick, the list it came from). */
  payload: z.record(z.string(), z.unknown()).optional()
}).strict();
export type CharacterChoice = z.infer<typeof CharacterChoiceSchema>;

/**
 * Character identity - the builder's choice inputs, stored so a future guided builder fills exactly
 * these fields (ADR-0007 additive; the "no-rewrite" contract). `classes` is an array so multiclass
 * is expressible; total level is derived (sum), never stored. Absent = prose only, as today.
 */
export const CharacterIdentitySchema = z.object({
  classes: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]+$/).max(60), name: z.string().min(1).max(60),
    subclass: z.object({ id: z.string().regex(/^[a-z0-9-]+$/).max(60), name: z.string().min(1).max(60) }).strict().optional(),
    level: z.number().int().min(1).max(20),
    /** This class's hit die, so a multiclass sheet can pool 3d10 + 2d6. Absent = unknown (the sheet falls back to the definition's hit-point formula). Additive. */
    hitDie: HitDieSchema.optional()
  }).strict()).max(4).default([]),
  race: z.object({ id: z.string().regex(/^[a-z0-9-]+$/).max(60), name: z.string().min(1).max(60), subrace: z.object({ id: z.string().regex(/^[a-z0-9-]+$/).max(60), name: z.string().min(1).max(60) }).strict().optional() }).strict().optional(),
  background: z.object({ id: z.string().regex(/^[a-z0-9-]+$/).max(60), name: z.string().min(1).max(60) }).strict().optional(),
  feats: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]+$/).max(60), name: z.string().min(1).max(80), description: z.string().max(4000).optional() }).strict()).max(40).default([]),
  /**
   * WHICH FEATURE RECORDS THIS SHEET HOLDS, by id - the class, subclass, species, lineage and
   * background features plus every chosen inline option.
   *
   * `feats` has always recorded feat ids, and that is the ONLY reason a feat's roll-time riders
   * reach the table: `deriveEquipment` turns `character.feats` into `RiderCarrier`s, and the same
   * `collectRiders` that serves a magic item serves them. A class feature was recorded nowhere, so
   * 13 of the 21 rider variants - `roll-mode`, `extra-damage`, `critical-range`, `spell-slot`,
   * `resource-bonus`, the trigger-gated bonuses - were authored, validated, and then simply dropped
   * for class, subclass, species and background features. That is the whole of issue `2e`.
   *
   * ID AND PROVENANCE ONLY. The riders themselves are NEVER stored: they live on the catalog record
   * and are recomputed on every read, exactly as a feat's are, so an edited homebrew feature is
   * correct on the next read, there is no third copy to drift, and a respec that rewrites this array
   * needs no migration. `kind` + `sourceId` say WHERE to look the id up (a class feature id is
   * unique only within its class), and they carry no secret: every value is a public content slug
   * the player's own sheet already names.
   *
   * Additive-optional and it must stay that way: PDF imports, bundled monsters and every definition
   * written before this field existed have no array at all, and every reader treats that as `[]`.
   */
  features: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]+$/).max(80),
    kind: z.enum(["class", "subclass", "species", "lineage", "background", "option"]),
    /** The record the feature was looked up in: a class/subclass/species/background id, or the parent feature id for an inline option. */
    sourceId: z.string().regex(/^[a-z0-9-]+$/).max(80)
  }).strict()).max(80).optional(),
  /**
   * The choice-provenance ledger (see CharacterChoiceSchema). ABSENT means "this sheet carries no
   * provenance" - a PDF import or a pre-wizard character - which respec must be able to tell apart
   * from "the wizard ran and recorded zero decisions" (an empty array). Read it through
   * `characterChoices()` when you just want a list. Additive-optional: a stored definition written
   * before the builder existed parses unchanged AND re-serializes unchanged (ADR-0007: older saved
   * content is migrated deliberately, never silently reinterpreted).
   */
  choices: z.array(CharacterChoiceSchema).max(200).optional()
}).strict();

/**
 * Save/skill proficiency SELECTIONS (the durable contract). `*Overrides` carry final totals for
 * imports that don't encode the selections; the server resolves `override ?? selection-derived ??
 * ability-only`. Absent = fall back to ability modifier / the legacy `extensions` totals.
 */
export const ProficienciesSchema = z.object({
  saves: z.array(AbilitySchema).max(6).default([]),
  skills: z.array(z.object({ id: SkillIdSchema, proficiency: z.enum(["proficient", "expertise"]) }).strict()).max(40).default([]),
  saveOverrides: z.record(AbilitySchema, z.number().int().min(-20).max(30)).optional(),
  skillOverrides: z.record(SkillIdSchema, z.number().int().min(-20).max(30)).optional(),
  /**
   * Armor/weapon/tool/language training. Open slugs so homebrew categories stay expressible.
   * Additive-OPTIONAL, and absent deliberately means "not recorded" rather than "none": an imported
   * sheet that never listed its armor training must not be read as untrained. `saves`/`skills` above
   * keep their `.default([])` because every prior writer already emits them.
   */
  armor: z.array(ProficiencyIdSchema).max(20).optional(),
  /** Weapon proficiencies - a group ("simple", "martial") or a single weapon id ("longsword"). Additive. */
  weapons: z.array(ProficiencyIdSchema).max(60).optional(),
  /** Tool proficiencies ("thieves-tools", "smiths-tools", "lute"). Additive. */
  tools: z.array(ProficiencyIdSchema).max(40).optional(),
  /** Known languages ("common", "elvish", "thieves-cant"). Additive. */
  languages: z.array(ProficiencyIdSchema).max(30).optional()
}).strict();

const SpellSlotMaxSchema = z.object({ level: z.number().int().min(1).max(9), max: z.number().int().min(0).max(9) }).strict();
const PactSlotMaxSchema = z.object({ level: z.number().int().min(1).max(5), max: z.number().int().min(0).max(4) }).strict();

/**
 * ONE spellcasting class on a multiclass sheet. A Paladin 6 / Wizard 4 casts Paladin spells off CHA
 * and Wizard spells off INT - inexpressible while `spellcasting` carried a single `ability`.
 * `slots`/`prepared` are the PER-CLASS breakdown kept for rebuilds and level-up; the character's one
 * live pool stays the top-level `slots`/`pact` (the combined multiclass table).
 */
export const ClassSpellcastingSchema = z.object({
  classId: z.string().regex(/^[a-z0-9-]+$/).max(60),
  ability: AbilitySchema,
  saveDc: z.number().int().min(1).max(40).optional(),
  attackBonus: z.number().int().min(-5).max(30).optional(),
  slots: z.array(SpellSlotMaxSchema).max(9).optional(),
  /** How many spells this class prepares (SRD prepared casters); absent for known casters. */
  prepared: z.number().int().min(0).max(60).optional()
}).strict();
export type ClassSpellcasting = z.infer<typeof ClassSpellcastingSchema>;

/**
 * Spellcasting CAPABILITY (immutable): ability, slot maxima, known/prepared list. Save DC and attack
 * bonus derive (8+PB+mod / PB+mod) unless an override is supplied. Live slots-remaining and today's
 * prepared set live on the Actor. `spells[].actionId` links a spell to the action that resolves it.
 *
 * RESOLUTION ORDER for "which ability / DC / attack bonus does this spell use?" - every consumer
 * MUST follow it, in this order:
 *   1. `classes[]` entry whose `classId` matches the spell's `classId` -> its ability/saveDc/attackBonus.
 *   2. the single `classes[]` entry, when there is exactly one (an ordinary single-class caster).
 *   3. the top-level `ability`/`saveDc`/`attackBonus` -> the pre-multiclass behavior, still the
 *      source of truth for every sheet written before `classes[]` existed.
 * A builder that fills `classes[]` MUST also keep the top-level fields populated (mirror the primary
 * caster) so older consumers keep working; `classes` is purely additive and defaults to empty.
 * Slot pools are NOT per class: the top-level `slots`/`pact` remain the character's single live pool,
 * and the superRefine below ENFORCES that - per-class slots without the combined top-level pool is a
 * parse error, not a caster who silently seeds zero slots.
 */
const SpellcastingSchema = z.object({
  ability: AbilitySchema,
  saveDc: z.number().int().min(1).max(40).optional(),
  attackBonus: z.number().int().min(-5).max(30).optional(),
  slots: z.array(SpellSlotMaxSchema).max(9).default([]),
  pact: PactSlotMaxSchema.optional(),
  /** Per-class spellcasting entries for multiclass sheets. Absent = single caster, read the fields above. Additive-optional. */
  classes: z.array(ClassSpellcastingSchema).max(4).optional(),
  spells: z.array(z.object({
    id: z.string().max(80), name: z.string().min(1).max(120), level: z.number().int().min(0).max(9),
    prepared: z.boolean().default(true), alwaysPrepared: z.boolean().default(false),
    actionId: z.string().regex(/^[a-z0-9-]+$/).optional(),
    /** Which class granted this spell, so the resolution order above can pick the right ability. Additive. */
    classId: z.string().regex(/^[a-z0-9-]+$/).max(60).optional()
  }).strict()).max(400).default([])
}).strict().superRefine((spellcasting, context) => {
  // ENFORCE the contract documented above. A builder that fills per-class `slots` but leaves the
  // top-level pool empty produces a "modeled caster with zero slots": the live actor seeds
  // `spellSlots: []` and a long rest restores nothing. Failing loudly at parse time beats shipping a
  // caster who cannot cast.
  const perClassSlots = (spellcasting.classes ?? []).some((entry) => (entry.slots ?? []).length > 0);
  if (perClassSlots && spellcasting.slots.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["slots"], message: "A sheet with per-class spell slots must also carry the combined top-level slots (the character's single live pool)." });
  }
});
export type Spellcasting = z.infer<typeof SpellcastingSchema>;

/**
 * THE resolution order for "which ability / DC / attack bonus does this class's magic use?", in one
 * place so no consumer re-implements it (and so multiclass support cannot be half-applied). Returns
 * undefined only when there is no spellcasting at all.
 */
export function resolveSpellcasting(spellcasting: Spellcasting | undefined, classId?: string): { classId?: string; ability: AbilityId; saveDc?: number; attackBonus?: number } | undefined {
  if (!spellcasting) return undefined;
  const entries = spellcasting.classes ?? [];
  const match = classId ? entries.find((entry) => entry.classId === classId) : undefined;
  // Step 2 (the lone-entry shortcut) may fire ONLY when the caller named no class. Asking for
  // "fighter" on an Eldritch Knight / Wizard sheet must never be answered with the Wizard's INT and
  // DC - an unmatched request falls through to step 3, the top-level (primary caster) fields.
  const chosen = match ?? (classId === undefined && entries.length === 1 ? entries[0] : undefined);
  if (chosen) return { classId: chosen.classId, ability: chosen.ability, saveDc: chosen.saveDc ?? spellcasting.saveDc, attackBonus: chosen.attackBonus ?? spellcasting.attackBonus };
  return { ability: spellcasting.ability, saveDc: spellcasting.saveDc, attackBonus: spellcasting.attackBonus };
}

/** The choice ledger as a list, treating "no ledger recorded" as empty. Use when you only need to read. */
export function characterChoices(character: z.infer<typeof CharacterIdentitySchema> | undefined): readonly CharacterChoice[] {
  return character?.choices ?? [];
}

export const ActorDefinitionSchema = z.object({
  schemaId: z.enum(["vtt.actor-character", "vtt.actor-monster"]), schemaVersion: z.literal(ACTOR_DEFINITION_SCHEMA_VERSION),
  source: z.object({ name: z.string().min(1).max(200), version: z.string().min(1).max(80), externalId: z.string().max(200).optional() }),
  name: z.string().min(1).max(120), summary: z.string().max(280).optional(), size: z.enum(["tiny", "small", "medium", "large", "huge", "gargantuan"]),
  abilityScores: z.object({ str: z.number().int().min(1).max(30), dex: z.number().int().min(1).max(30), con: z.number().int().min(1).max(30), int: z.number().int().min(1).max(30), wis: z.number().int().min(1).max(30), cha: z.number().int().min(1).max(30) }),
  proficiencyBonus: z.number().int().min(0).max(12), armorClass: z.number().int().min(1).max(40), hitPoints: z.object({ maximum: z.number().int().positive(), formula: DiceFormulaSchema.optional() }), initiativeBonus: z.number().int().min(-20).max(30).default(0), speedFeet: z.number().int().nonnegative(),
  actions: z.array(ActionSchema).max(100).default([]), token: z.object({ disposition: z.enum(["friendly", "hostile", "neutral"]).default("neutral"), footprint: z.object({ width: z.number().int().positive().max(4), height: z.number().int().positive().max(4) }).default({ width: 1, height: 1 }) }).default({ disposition: "neutral", footprint: { width: 1, height: 1 } }), extensions: z.record(z.string(), z.unknown()).default({}),
  /** Typed defenses by damage-type id; the engine applies them to typed damage (immunity → resistance → vulnerability). Additive; absent = none known. */
  damageResistances: z.array(DamageTypeIdSchema).max(20).optional(), damageImmunities: z.array(DamageTypeIdSchema).max(20).optional(), damageVulnerabilities: z.array(DamageTypeIdSchema).max(20).optional(),
  /** Reference-level for now: displayed, not yet enforced on actor.set-condition. */
  conditionImmunities: z.array(ConditionIdSchema).max(20).optional(),
  /** Legendary creature resources (SRD 2024): `actionsPerRound` legendary actions per round (spent on other creatures' turns), `resistancesPerDay` Legendary Resistance uses (turn a failed save into a success; re-arms on a long rest - the app's day). Additive. */
  legendary: z.object({ actionsPerRound: z.number().int().min(1).max(5).optional(), resistancesPerDay: z.number().int().min(1).max(6).optional() }).strict().optional(),
  /** Character identity (class/level/race/background/feats). Character definitions in practice; additive-optional. */
  character: CharacterIdentitySchema.optional(),
  /** Save/skill proficiency selections (+ optional override totals). Additive. */
  proficiencies: ProficienciesSchema.optional(),
  /** Spellcasting capability (ability, slot maxima, known/prepared list). Additive. */
  spellcasting: SpellcastingSchema.optional(),
  /** Immutable starting loadout; the live actor's inventory is seeded from this. Additive. */
  startingInventory: z.array(InventoryItemSchema).max(200).optional(),
  /** Immutable starting coins; the live actor's currency is seeded from this. Additive. */
  startingCurrency: CurrencySchema.optional()
}).superRefine((actor, context) => {
  if (actor.schemaId === "vtt.actor-character" && actor.token.disposition !== "friendly") context.addIssue({ code: z.ZodIssueCode.custom, path: ["token", "disposition"], message: "Player-character definitions must use the friendly disposition." });
});
export type ActorDefinition = z.infer<typeof ActorDefinitionSchema>;
