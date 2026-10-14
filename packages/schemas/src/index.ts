import { z } from "zod";

export const ACTOR_SCHEMA_VERSION = 1;

/** Lowercase damage-type id ("slashing", "fire"); free-form so homebrew types stay expressible. */
const DamageTypeIdSchema = z.string().min(1).max(40);
const ConditionIdSchema = z.string().regex(/^[a-z0-9-]+$/).max(60);
const EffectTagSchema = z.string().regex(/^[a-z0-9-]+$/).max(40);
/** Open identity slug, matching the content catalog's `ContentIdSchema`. */
const RiderSlugSchema = z.string().regex(/^[a-z0-9-]+$/).max(80);
const SizeSchema = z.enum(["tiny", "small", "medium", "large", "huge", "gargantuan"]);
/** A safe dice expression, one die term plus at most one flat modifier - never an evaluable string (ADR-0008). */
export const DiceFormulaSchema = z.string().regex(/^\d+d(?:4|6|8|10|12|20|100)(?:\s*[+-]\s*\d+)?$/i, "Use a safe dice formula such as 1d8 + 3.");
export const AbilitySchema = z.enum(["str", "dex", "con", "int", "wis", "cha"]);
export type AbilityId = z.infer<typeof AbilitySchema>;

// ---- Rider gates: the trigger vocabulary items, features, feats and effects share ----

/** Where an item is worn or held. A closed enum, unlike the open `category` slug, because the engine switches
 * on it exhaustively (AC derivation, double-equip, attunement gates); a homebrew "relic" with `slot: "armor"` derives AC. */
export const ItemSlotSchema = z.enum([
  "weapon", "shield", "armor",
  "head", "neck", "shoulders", "hands", "ring", "belt", "feet",   // worn
  "held",        // wand, orb, rod, staff, focus
  "wondrous",    // attunable, no body location
  "consumable",  // potion, scroll
  "ammunition",
  "none"         // pure gear, no equip semantics
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
 */
export const RiderTriggerSchema = z.discriminatedUnion("type", [
  // ---- static gates ----
  /** The bearer is attuned. Redundant (and harmless) when the item's own `attunement.required` is true. */
  z.object({ type: z.literal("attuned") }).strict(),
  /** Wearing armor; omitting `weights` means any armor. */
  z.object({ type: z.literal("while-armored"), weights: z.array(z.enum(["light", "medium", "heavy"])).min(1).max(3).optional() }).strict(),
  z.object({ type: z.literal("while-unarmored"), allowShield: z.boolean().default(false) }).strict(),
  /** `wielding: false` expresses Dueling-style "only while not holding a shield". */
  z.object({ type: z.literal("while-shield"), wielding: z.boolean().default(true) }).strict(),
  /** Two lists in one trigger so "Paladin or Cleric" needs no OR. */
  z.object({ type: z.literal("while-character-is"), classIds: z.array(RiderSlugSchema).max(8).default([]), speciesIds: z.array(RiderSlugSchema).max(8).default([]) }).strict(),
  z.object({ type: z.literal("while-proficient-with"), kind: z.enum(["weapon", "armor", "tool", "skill"]), ids: z.array(RiderSlugSchema).min(1).max(12) }).strict(),
  // ---- dynamic gates ----
  /** Any-of against `actor.effects[].tags`. */
  z.object({ type: z.literal("while-effect-tag"), tags: z.array(EffectTagSchema).min(1).max(4) }).strict(),
  z.object({ type: z.literal("while-hp-at-or-below"), percent: z.number().int().min(1).max(99) }).strict(),
  z.object({ type: z.literal("while-condition"), conditionIds: z.array(ConditionIdSchema).min(1).max(6), present: z.boolean().default(true) }).strict(),
  // ---- moments ----
  z.object({ type: z.literal("on-attack-roll") }).strict(),
  z.object({ type: z.literal("on-hit") }).strict(),
  z.object({ type: z.literal("on-critical-hit") }).strict(),
  /** A natural 1. */
  z.object({ type: z.literal("on-critical-miss") }).strict(),
  z.object({ type: z.literal("on-damage-roll") }).strict(),
  z.object({ type: z.literal("on-saving-throw") }).strict(),
  z.object({ type: z.literal("on-ability-check") }).strict(),
  z.object({ type: z.literal("on-initiative-roll") }).strict(),
  z.object({ type: z.literal("on-death-save") }).strict(),
  z.object({ type: z.literal("on-taking-damage") }).strict(),
  z.object({ type: z.literal("on-spell-cast") }).strict(),
  // ---- filters ----
  /** `reaction` and `opportunity` match only when the resolver announces that trigger. */
  z.object({ type: z.literal("attack-kind-is"), kinds: z.array(z.enum(["melee", "ranged", "spell", "unarmed", "thrown", "reaction", "opportunity"])).min(1).max(7) }).strict(),
  z.object({ type: z.literal("weapon-property-is"), properties: z.array(RiderSlugSchema).min(1).max(12) }).strict(),
  z.object({ type: z.literal("damage-type-is"), damageTypes: z.array(DamageTypeIdSchema).min(1).max(12) }).strict(),
  z.object({ type: z.literal("ability-is"), abilities: z.array(AbilitySchema).min(1).max(6) }).strict(),
  z.object({ type: z.literal("skill-is"), skills: z.array(RiderSlugSchema).min(1).max(12) }).strict(),
  z.object({ type: z.literal("spell-school-is"), schools: z.array(RiderSlugSchema).min(1).max(8) }).strict(),
  z.object({ type: z.literal("spell-level-is"), levels: z.array(z.number().int().min(0).max(9)).min(1).max(10) }).strict(),
  /** One specific spell ("when you cast Eldritch Blast"), matched against `ActorAction.spellId`. An action with no
   * `spellId` never matches. */
  z.object({ type: z.literal("spell-id-is"), spellIds: z.array(RiderSlugSchema).min(1).max(12) }).strict(),
  /** Authorable but inert until `ActorDefinition` carries a creature type. */
  z.object({ type: z.literal("versus-creature-type"), creatureTypes: z.array(RiderSlugSchema).min(1).max(12) }).strict(),
  z.object({ type: z.literal("versus-size"), sizes: z.array(SizeSchema).min(1).max(6) }).strict(),
  z.object({ type: z.literal("versus-condition"), conditionIds: z.array(ConditionIdSchema).min(1).max(6) }).strict()
]);
export type RiderTrigger = z.infer<typeof RiderTriggerSchema>;
export type RiderTriggerKind = "static-gate" | "dynamic-gate" | "moment" | "filter";

/** Decides a rider's layer: all static (or empty) = standing number; any dynamic gate = conditional; else momentary. */
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

/** Which layer a `when` list belongs to. */
export function riderLayer(when: readonly RiderTrigger[]): "standing" | "conditional" | "momentary" {
  const kinds = when.map((trigger) => RIDER_TRIGGER_KINDS[trigger.type]);
  if (kinds.some((kind) => kind === "moment" || kind === "filter")) return "momentary";
  if (kinds.some((kind) => kind === "dynamic-gate")) return "conditional";
  return "standing";
}

/** Rules shared by every `when` list, including the grant gate below. */
function checkSharedTriggerRules(triggers: readonly RiderTrigger[], context: z.RefinementCtx): void {
  const identity = triggers.find((trigger) => trigger.type === "while-character-is" && trigger.classIds.length === 0 && trigger.speciesIds.length === 0);
  if (identity) context.addIssue({ code: z.ZodIssueCode.custom, message: "`while-character-is` needs at least one class or species." });
  const duplicate = triggers.find((trigger, index) => triggers.findIndex((other) => other.type === trigger.type) !== index);
  if (duplicate) context.addIssue({ code: z.ZodIssueCode.custom, message: `Two "${duplicate.type}" triggers on one rider - list the values in a single entry instead.` });
}

/** At most four triggers, ANDed, with at most one moment; a filter without a moment is rejected. */
export const RiderWhenSchema = z.array(RiderTriggerSchema).max(4).superRefine((triggers, context) => {
  const kinds = triggers.map((trigger) => RIDER_TRIGGER_KINDS[trigger.type]);
  if (kinds.filter((kind) => kind === "moment").length > 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A rider fires at one moment, not two." });
  }
  if (kinds.includes("filter") && !kinds.includes("moment")) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A filter needs a moment to narrow - add the roll or event it applies to." });
  }
  checkSharedTriggerRules(triggers, context);
}).default([]);

/** The gate a grant may carry: static and dynamic gates only, since grants are collected before any roll.
 * No `.default([])`: used with `.optional()` so records without `when` parse unchanged. */
export const GrantWhenSchema = z.array(RiderTriggerSchema).min(1).max(4).superRefine((triggers, context) => {
  const offender = triggers.find((trigger) => RIDER_TRIGGER_KINDS[trigger.type] === "moment" || RIDER_TRIGGER_KINDS[trigger.type] === "filter");
  if (offender) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `A grant is a standing fact, so it cannot wait for a roll: "${offender.type}" is only knowable during one, and the grant has been collected before any roll starts. Gate it on a state instead - attuned, while-armored, while-unarmored, while-shield, while-character-is, while-proficient-with, while-effect-tag, while-hp-at-or-below, while-condition - or move the mechanic to a modifier, where a moment IS read.`
    });
  }
  checkSharedTriggerRules(triggers, context);
});

/** The gate fields every rider carries. `scope` defaults by carrier: on an item with a weapon block the
 * attack/damage/crit riders mean "with this weapon", otherwise "the bearer". */
export const riderGate = {
  when: RiderWhenSchema,
  scope: z.enum(["bearer", "this-item"]).optional()
} as const;

// ---- Riders shared by `EffectModifier` (below) and `FeatureModifier` (@vtt/content-srd-5.2.1) ----

export const AttackBonusVariantSchema = z.object({
  type: z.literal("attack-bonus"),
  amount: z.number().int().min(-10).max(10),
  ...riderGate
}).strict();

/** Extra typed damage as dice (`formula`), the bearer's ability modifier (`abilityModifier`), or both.
 * `doubleOnCritical` defaults false: 5e does not double dice added after the attack. */
export const ExtraDamageVariantSchema = z.object({
  type: z.literal("extra-damage"),
  formula: DiceFormulaSchema.optional(),
  /** Add the bearer's modifier in this ability as a flat number. */
  abilityModifier: AbilitySchema.optional(),
  damageType: DamageTypeIdSchema,
  doubleOnCritical: z.boolean().default(false),
  ...riderGate
}).strict();

/** Advantage or disadvantage on a named roll. Feeds `aggregateRollMode`, which applies 5e cancellation. */
export const RollModeVariantSchema = z.object({
  type: z.literal("roll-mode"),
  roll: z.enum(["attack", "incoming-attack", "save", "check", "initiative", "death-save", "concentration"]),
  mode: z.enum(["advantage", "disadvantage"]),
  ...riderGate
}).strict();

/** Typed modifiers an active effect contributes (ADR-0020). `attack-advantage` applies only on the bearer's own
 * turn (Reckless Attack). Use `toRollModes` rather than switching on the advantage variants. */
export const EffectModifierSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("damage-bonus"), amount: z.number().int().min(-20).max(20), appliesTo: z.enum(["melee", "all"]).default("all") }).strict(),
  z.object({ type: z.literal("damage-resistance"), damageTypes: z.array(DamageTypeIdSchema).min(1).max(20) }).strict(),
  /** Mirrors `damage-resistance`; `adjustDamageParts` applies the SRD rule that both together cancel out. */
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
  /** Runtime speed change (Longstrider +10, Slow -10), summed by `effectiveSpeedFeet` so it is undone when the
   * effect ends. Known limitation: on an item it becomes `EquipmentDerivation.speed`, which nothing reads yet. */
  z.object({ type: z.literal("speed"), amount: z.number().int().min(-30).max(60) }).strict(),
  AttackBonusVariantSchema,
  ExtraDamageVariantSchema,
  RollModeVariantSchema
]);
export type EffectModifier = z.infer<typeof EffectModifierSchema>;

/** One normalised advantage/disadvantage claim: which roll, which way. */
export type NormalisedRollMode = Readonly<{ roll: z.infer<typeof RollModeVariantSchema>["roll"]; mode: "advantage" | "disadvantage"; ability?: AbilityId }>;

/** Normalises the six legacy advantage/disadvantage variants and `roll-mode` into one claim shape. */
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

/** A live rules-engine effect on an actor (Rage, a grapple), with source links, duration and typed modifiers.
 * Ids derive from the commandId so retries mint the same effect. */
export const EffectInstanceSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  tags: z.array(EffectTagSchema).max(8).default([]),
  /** Who sustains/caused it; stripped from player projections. Null for GM-added house effects. */
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
  /** Dodge: the effect's modifiers stop applying while the bearer is incapacitated (SRD). */
  voidWhileIncapacitated: z.boolean().default(false),
  /** The source actor concentrates to sustain this (SRD Concentration): one at a time; damage prompts a CON save; incapacitation breaks it. */
  concentration: z.boolean().default(false),
  /** Cascade: this effect ends when the actor no longer has any other effect carrying this tag (Frenzy's marker ends with the Rage). */
  endsWithTag: z.string().regex(/^[a-z0-9-]+$/).max(40).nullable().default(null),
  /** SRD "Combining Game Effects": instances sharing a key are one effect, so readers take the most potent
   * contribution instead of summing (two Slows are -10, not -20). Absent or different keys sum. */
  stackKey: z.string().regex(/^[a-z0-9:-]+$/).max(60).optional(),
  /** Extra movement granted for the current turn, fixed when granted (Dash), so a later Slow does not rewrite it.
   * On a `dashing` effect without it, `effectiveSpeedFeet` falls back to doubling Speed. */
  movementGrantFeet: z.number().int().min(0).max(999).optional(),
  modifiers: z.array(EffectModifierSchema).max(8).default([]),
  /** Conditions this effect applied to the same actor; removed automatically when the effect ends. */
  linkedConditionIds: z.array(ConditionIdSchema).max(4).default([]),
  /** Shown as "Escape DC 15"; ending the effect on escape is manual. */
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

/** How a token's health shows on the map. `band` is the coarse badge everyone sees; other styles are gated by
 * `audience`, and only the GM and owner ever get exact fill. */
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
/** Mechanical stats of an item added from the SRD catalog (weapon → attack action, armor/shield → derived AC).
 * Absent on homebrew or older items, which are then display-only. */
export const ItemWeaponSchema = z.object({
  category: z.enum(["simple", "martial"]), damageDice: z.string().min(1).max(20), damageType: z.string().min(1).max(40),
  rangeFeet: z.number().int().positive().nullable(), longRangeFeet: z.number().int().positive().nullable(),
  /** SRD weapon property slugs ("finesse", "thrown", ...), open for homebrew. Absent = not recorded; an empty array = no properties. */
  properties: z.array(z.string().regex(/^[a-z0-9-]+$/).max(40)).max(12).optional()
}).strict();
export const ItemArmorSchema = z.object({ acBase: z.number().int().min(2).max(25), addDexModifier: z.boolean(), dexModifierCap: z.number().int().nullable(), stealthDisadvantage: z.boolean(), strengthRequired: z.number().int().nullable() }).strict();
/** Non-secret magic-item marker for the sheet's Attune control. Never put riders, casts or a `cursed` flag here:
 * the owner receives their inventory verbatim. Mechanics resolve server-side by `item.id`. */
export const ItemMagicMarkerSchema = z.object({
  isMagic: z.boolean().default(false),
  attunementRequired: z.boolean().default(false),
  slot: ItemSlotSchema.optional()
}).strict();
/** One carried inventory item; quantity, equipped and attuned change during play. */
export const InventoryItemSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/).max(80),
  name: z.string().min(1).max(120),
  quantity: z.number().int().min(0).max(9999).default(1),
  equipped: z.boolean().default(false),
  attuned: z.boolean().default(false),
  weightEach: z.number().nonnegative().max(1_000_000).optional(),
  description: z.string().max(4000).optional(),
  /** Equipment category slug (weapon/armor/tool/...), open for homebrew. Drives sheet grouping. */
  category: z.string().regex(/^[a-z0-9-]+$/).max(40).optional(),
  /** The base a template magic item is bound to ("dwarven-thrower" -> "warhammer"). The server validates it and
   * overwrites `weapon`/`armor` with the base's stats; weapon stats are never trusted from a client. */
  baseId: z.string().regex(/^[a-z0-9-]+$/).max(80).optional(),
  weapon: ItemWeaponSchema.optional(),
  armor: ItemArmorSchema.optional(),
  /** Display-only marker so the sheet can offer Attune without the catalog; never the riders. */
  magic: ItemMagicMarkerSchema.optional()
}).strict();
export type InventoryItem = z.infer<typeof InventoryItemSchema>;
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

/** One die size in a Hit Point Dice pool: a Fighter 3 / Wizard 2 has a 3×d10 entry and a 2×d6 entry. */
export const HitDiceEntrySchema = z.object({
  die: z.enum(["d4", "d6", "d8", "d10", "d12", "d20"]),
  maximum: z.number().int().min(1).max(40),
  remaining: z.number().int().min(0).max(40)
}).strict();
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
    if (typeof entryDie !== "string" || typeof entryMaximum !== "number" || typeof entryRemaining !== "number") return input;
    entries.push({ die: entryDie, maximum: entryMaximum, remaining: entryRemaining });
    maximum += entryMaximum;
    remaining += entryRemaining;
    const faces = HIT_DIE_FACES[entryDie] ?? 0;
    if (faces > largestFaces) { largestFaces = faces; die = entryDie; }
  }
  return { die, maximum, remaining, entries };
}

/** A live Hit Point Dice pool. `entries` is the truth, one per die size; `die`/`maximum`/`remaining` are a summary
 * recomputed on every parse. Build pools with `makeHitDicePool`. */
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
  /** Slug of the definition this actor was instantiated from (content-bundle or imported id); absent for seeded actors. */
  definitionId: z.string().regex(/^[a-z0-9-]+$/).max(200).optional(),
  /** Token footprint in grid cells per side (large 2, huge 3, gargantuan 4); absent means 1. */
  sizeCells: z.number().int().min(1).max(4).optional(),
  /** D&D creature size label; drives sizeCells and lets the GM pick Tiny/Small/Medium (all 1×1). Absent means Medium. */
  size: z.enum(["tiny", "small", "medium", "large", "huge", "gargantuan"]).optional(),
  /** Custom uploaded token image (a token-asset id); absent means the initials glyph. */
  tokenAssetId: z.string().uuid().optional(),
  /** Active conditions by content-bundle id; `level` applies only to exhaustion (1-6). Set by the GM or by the rules engine (ADR-0020). */
  conditions: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]+$/).max(60), level: z.number().int().min(1).max(6).optional() }).strict()).max(20).default([]),
  /** Live rules-engine effects (Rage, a grapple holding this actor). */
  effects: z.array(EffectInstanceSchema).max(20).default([]),
  /** Dying state at 0 HP (player characters only); null when not dying. */
  deathSaves: DeathSavesSchema.nullable().default(null),
  /** Spent limited-use counts by action id. */
  actionUses: z.record(z.string(), z.number().int().nonnegative()).default({}),
  /** Picks re-made on a rest, keyed by offer key; no rebuild needed. `per` is the rest that clears the override,
   * after which the build's recorded answer applies again. */
  choiceOverrides: z.record(z.string(), z.object({
    id: z.string().regex(/^[a-z0-9-]+$/).max(80),
    per: z.enum(["short-rest", "long-rest"])
  }).strict()).default({}),
  /** Conditions this actor is immune to (seeded from its definition). GM knowledge, stripped from player projections. */
  conditionImmunities: z.array(ConditionIdSchema).max(20).default([]),
  /** Walking speed in feet (seeded from the definition, GM-editable). Absent = unknown, so movement rules skip. */
  speedFeet: z.number().int().min(0).max(500).optional(),
  /** Legendary actions per round and Legendary Resistance per day (SRD 2024). GM knowledge, stripped from player projections. */
  legendary: z.object({ actionsPerRound: z.number().int().min(1).max(5).optional(), resistancesPerDay: z.number().int().min(1).max(6).optional() }).strict().optional(),
  /** Short-rest healing pool (SRD Hit Point Dice); null = not modeled. Reaches players only on their own claimed character. */
  hitDice: HitDicePoolSchema.default(null),
  /** Per-token health-display override; absent = inherit `combat.healthDisplay`. Audience-gated in the player/viewer projections. */
  healthDisplay: HealthDisplaySchema.optional(),
  /** Epoch ms when this actor last entered a fight; powers the scene-setup "Recent" list. GM-only, stripped from the player projection. */
  lastUsedAt: z.number().int().nonnegative().optional(),
  /** Live spell-slot pools by level, restored by rests; null = not a modeled spellcaster. Owner-only in projections. */
  spellSlots: z.array(SpellSlotSchema).max(9).nullable().default(null),
  /** Warlock Pact Magic pool (one level, uniform slots); null = none. Owner-only in projections. */
  pactSlots: z.object({ level: z.number().int().min(1).max(5), remaining: z.number().int().min(0).max(4) }).strict().nullable().default(null),
  /** Spell ids prepared right now, re-chosen on a long rest. Owner-only. */
  preparedSpellIds: z.array(z.string().max(80)).max(400).default([]),
  /** Carried inventory, seeded from the definition's starting loadout. Owner-only. */
  inventory: z.array(InventoryItemSchema).max(200).default([]),
  /** Coin purse, seeded from the definition's starting currency. Owner-only. */
  currency: CurrencySchema.default({}),
  /** GM-archived: hidden from players and excluded from the encounter builder and party. Never projected to players or the viewer. */
  archived: z.boolean().default(false),
  /** Set on a launched replay's cloned combatant: the replay scene's id. `rosterActors` hides these from management
   * surfaces; they are deleted with the replay scene. */
  replaySceneId: z.string().uuid().optional(),
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

/** Limited uses. "turn"/"encounter"/rests reset as named; "recharge" on a start-of-turn d6 >= `recharge`.
 * `pool` shares one counter across actions (Sneak Attack once per turn regardless of weapon). */
export const ActionUsesSchema = z.object({ limit: z.number().int().min(1).max(20), per: z.enum(["turn", "encounter", "long-rest", "short-rest", "recharge"]), pool: z.string().regex(/^[a-z0-9-]+$/).max(60).optional(), recharge: z.number().int().min(2).max(6).optional() }).strict().superRefine((uses, context) => {
  if (uses.per === "recharge" && uses.recharge === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["recharge"], message: "Recharge uses need the d6 threshold (e.g. 5 for \"Recharge 5-6\")." });
  if (uses.per !== "recharge" && uses.recharge !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["recharge"], message: "The recharge threshold only applies when per is \"recharge\"." });
});

/** Mechanics fields are optional (ADR-0020): absent means prose only. Descriptions stay the display source of truth. */
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
  /** Compound action: one shared action slot, components tracked (crocodile Multiattack = one Bite + one Tail). */
  multiattack: z.array(z.object({ actionId: z.string().regex(/^[a-z0-9-]+$/), count: z.number().int().min(1).max(4) }).strict()).min(1).max(4).optional(),
  /** On-hit conditions applied to the target as one source-linked effect (Bite: Grappled + Restrained, escape DC 15). */
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
  uses: ActionUsesSchema.optional(),
  /** Resolving this action also spends one of the bearer's spell slots of this level ("expend a spell slot to cast
   * it from the staff"). Checked and spent by the limited-uses economy pass, so a preview never spends. */
  spellSlot: z.object({ level: z.number().int().min(1).max(9) }).strict().optional(),
  /** The spell this action casts; identity only, matched by `spell-id-is` gates. Set on actions synthesised from
   * an item's `casts`, or directly on a feature action. Absent = not a spell. */
  spellId: z.string().regex(/^[a-z0-9-]+$/).max(80).optional(),
  /** Declared reaction the engine can offer as a pending prompt (Uncanny Dodge: when hit by an attack, halve its damage). Only meaningful on activation "reaction". */
  reaction: z.object({ trigger: z.literal("hit-by-attack"), response: z.literal("half-damage") }).strict().optional(),
  /** SRD Legendary Action: taken on other creatures' turns, spending `cost` from the per-round pool that refills on the creature's own turn. Pairs with activation "other". */
  legendary: z.object({ cost: z.number().int().min(1).max(5) }).strict().optional()
});

export type ActorAction = z.infer<typeof ActionSchema>;

/** One recorded build decision; every wizard pick writes a row, and level-up and respec prefill from them.
 * `kind` and `id` are open slugs. */
export const CharacterChoiceSchema = z.object({
  /** Character level the decision belongs to (1-20); 1 for species/background/origin choices. */
  level: z.number().int().min(1).max(20),
  /** Class the decision belongs to; absent for species/background/origin choices. */
  classId: z.string().regex(/^[a-z0-9-]+$/).max(60).optional(),
  kind: z.string().regex(/^[a-z0-9-]+$/).max(60),
  /** The option that was chosen: a content id, an ability id for an ASI, a skill id, ... */
  id: z.string().regex(/^[a-z0-9-]+$/).max(80),
  /** Free-form rider carrying the decision's detail (ASI splits, the feature that offered the pick, the list it came from). */
  payload: z.record(z.string(), z.unknown()).optional()
}).strict();
export type CharacterChoice = z.infer<typeof CharacterChoiceSchema>;

/** Character identity: the builder's inputs. Total level is derived from `classes`, never stored. */
export const CharacterIdentitySchema = z.object({
  classes: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]+$/).max(60), name: z.string().min(1).max(60),
    subclass: z.object({ id: z.string().regex(/^[a-z0-9-]+$/).max(60), name: z.string().min(1).max(60) }).strict().optional(),
    level: z.number().int().min(1).max(20),
    /** This class's hit die, so a multiclass sheet can pool 3d10 + 2d6. Absent = fall back to the definition's hit-point formula. */
    hitDie: HitDieSchema.optional()
  }).strict()).max(4).default([]),
  race: z.object({ id: z.string().regex(/^[a-z0-9-]+$/).max(60), name: z.string().min(1).max(60), subrace: z.object({ id: z.string().regex(/^[a-z0-9-]+$/).max(60), name: z.string().min(1).max(60) }).strict().optional() }).strict().optional(),
  background: z.object({ id: z.string().regex(/^[a-z0-9-]+$/).max(60), name: z.string().min(1).max(60) }).strict().optional(),
  feats: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]+$/).max(60), name: z.string().min(1).max(80), description: z.string().max(4000).optional() }).strict()).max(40).default([]),
  /** Feature records this sheet holds (class, subclass, species, lineage, background, chosen options) so their
   * roll-time riders apply as feats' do. Ids only; riders are recomputed from the catalog on every read.
   * `kind` + `sourceId` locate the record (class feature ids are unique only per class). */
  features: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]+$/).max(80),
    kind: z.enum(["class", "subclass", "species", "lineage", "background", "option"]),
    /** The record the feature was looked up in: a class/subclass/species/background id, or the parent feature id for an inline option. */
    sourceId: z.string().regex(/^[a-z0-9-]+$/).max(80)
  }).strict()).max(80).optional(),
  /** The choice-provenance ledger (see CharacterChoiceSchema). Absent means no provenance (PDF import or
   * pre-wizard character), which respec must tell apart from an empty ledger. Use `characterChoices()` for a list. */
  choices: z.array(CharacterChoiceSchema).max(200).optional()
}).strict();

/** Save/skill proficiency selections. `*Overrides` carry final totals for imports that don't encode selections;
 * the server resolves `override ?? selection-derived ?? ability-only`. */
export const ProficienciesSchema = z.object({
  saves: z.array(AbilitySchema).max(6).default([]),
  skills: z.array(z.object({ id: SkillIdSchema, proficiency: z.enum(["proficient", "expertise"]) }).strict()).max(40).default([]),
  saveOverrides: z.record(AbilitySchema, z.number().int().min(-20).max(30)).optional(),
  skillOverrides: z.record(SkillIdSchema, z.number().int().min(-20).max(30)).optional(),
  /** Armor/weapon/tool/language training as open slugs. Absent means "not recorded", not "none": an import that
   * never listed armor training must not read as untrained. */
  armor: z.array(ProficiencyIdSchema).max(20).optional(),
  /** Weapon proficiencies: a group ("simple", "martial") or a single weapon id ("longsword"). */
  weapons: z.array(ProficiencyIdSchema).max(60).optional(),
  tools: z.array(ProficiencyIdSchema).max(40).optional(),
  languages: z.array(ProficiencyIdSchema).max(30).optional()
}).strict();

const SpellSlotMaxSchema = z.object({ level: z.number().int().min(1).max(9), max: z.number().int().min(0).max(9) }).strict();
const PactSlotMaxSchema = z.object({ level: z.number().int().min(1).max(5), max: z.number().int().min(0).max(4) }).strict();

/** One spellcasting class on a multiclass sheet (Paladin 6 / Wizard 4 casts off CHA and INT). `slots`/`prepared`
 * are the per-class breakdown for rebuilds; the live pool is the top-level `slots`/`pact`. */
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

/** Spellcasting capability (immutable); live slots and prepared spells live on the Actor. Save DC and attack bonus
 * derive (8+PB+mod / PB+mod) unless overridden. Resolve per-spell values only with `resolveSpellcasting`.
 * A builder filling `classes[]` must also fill the top-level fields and combined `slots` (the single live pool). */
const SpellcastingSchema = z.object({
  ability: AbilitySchema,
  saveDc: z.number().int().min(1).max(40).optional(),
  attackBonus: z.number().int().min(-5).max(30).optional(),
  slots: z.array(SpellSlotMaxSchema).max(9).default([]),
  pact: PactSlotMaxSchema.optional(),
  /** Per-class entries for multiclass sheets. Absent = single caster; read the fields above. */
  classes: z.array(ClassSpellcastingSchema).max(4).optional(),
  spells: z.array(z.object({
    id: z.string().max(80), name: z.string().min(1).max(120), level: z.number().int().min(0).max(9),
    prepared: z.boolean().default(true), alwaysPrepared: z.boolean().default(false),
    actionId: z.string().regex(/^[a-z0-9-]+$/).optional(),
    /** Which class granted this spell, so `resolveSpellcasting` can pick the right ability. */
    classId: z.string().regex(/^[a-z0-9-]+$/).max(60).optional()
  }).strict()).max(400).default([])
}).strict().superRefine((spellcasting, context) => {
  // Per-class slots without the combined top-level pool would seed `spellSlots: []`: a caster who cannot cast.
  const perClassSlots = (spellcasting.classes ?? []).some((entry) => (entry.slots ?? []).length > 0);
  if (perClassSlots && spellcasting.slots.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["slots"], message: "A sheet with per-class spell slots must also carry the combined top-level slots (the character's single live pool)." });
  }
});
export type Spellcasting = z.infer<typeof SpellcastingSchema>;

/** Which ability/DC/attack bonus a class's magic uses: the matching `classes[]` entry; else, when no class was
 * named, the lone entry; else the top-level fields. */
export function resolveSpellcasting(spellcasting: Spellcasting | undefined, classId?: string): { classId?: string; ability: AbilityId; saveDc?: number; attackBonus?: number } | undefined {
  if (!spellcasting) return undefined;
  const entries = spellcasting.classes ?? [];
  const match = classId ? entries.find((entry) => entry.classId === classId) : undefined;
  // The lone-entry shortcut applies only when no class was named: asking for "fighter" on an Eldritch Knight /
  // Wizard sheet must not get the Wizard's INT and DC.
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
  /** Typed defenses by damage-type id, applied immunity → resistance → vulnerability. Absent = none known. */
  damageResistances: z.array(DamageTypeIdSchema).max(20).optional(), damageImmunities: z.array(DamageTypeIdSchema).max(20).optional(), damageVulnerabilities: z.array(DamageTypeIdSchema).max(20).optional(),
  /** Seeded onto the actor's `conditionImmunities`, which the engine enforces. */
  conditionImmunities: z.array(ConditionIdSchema).max(20).optional(),
  /** Legendary creature resources (SRD 2024): legendary actions per round (spent on other creatures' turns) and Legendary Resistance per day (re-arms on a long rest). */
  legendary: z.object({ actionsPerRound: z.number().int().min(1).max(5).optional(), resistancesPerDay: z.number().int().min(1).max(6).optional() }).strict().optional(),
  /** Character identity (class/level/race/background/feats); character definitions only. */
  character: CharacterIdentitySchema.optional(),
  proficiencies: ProficienciesSchema.optional(),
  spellcasting: SpellcastingSchema.optional(),
  /** Immutable starting loadout; the live actor's inventory is seeded from this. */
  startingInventory: z.array(InventoryItemSchema).max(200).optional(),
  /** Immutable starting coins; the live actor's currency is seeded from this. */
  startingCurrency: CurrencySchema.optional()
}).superRefine((actor, context) => {
  if (actor.schemaId === "vtt.actor-character" && actor.token.disposition !== "friendly") context.addIssue({ code: z.ZodIssueCode.custom, path: ["token", "disposition"], message: "Player-character definitions must use the friendly disposition." });
});
export type ActorDefinition = z.infer<typeof ActorDefinitionSchema>;
