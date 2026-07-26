import { z } from "zod";

/** Version 1 is intentionally small; it establishes the import contract before an adapter exists. */
export const ACTOR_SCHEMA_VERSION = 1;

/** Lowercase damage-type id ("slashing", "fire"); free-form so homebrew types stay expressible. */
const DamageTypeIdSchema = z.string().min(1).max(40);
const ConditionIdSchema = z.string().regex(/^[a-z0-9-]+$/).max(60);
const EffectTagSchema = z.string().regex(/^[a-z0-9-]+$/).max(40);

/**
 * Typed modifiers an active effect contributes to the rules engine (ADR-0020). The vocabulary is
 * deliberately small and grows additively - unmodeled mechanics stay prose per ADR-0008.
 * `attack-advantage` is evaluated only on the bearer's own turn (Reckless Attack semantics).
 */
export const EffectModifierSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("damage-bonus"), amount: z.number().int().min(-20).max(20), appliesTo: z.enum(["melee", "all"]).default("all") }).strict(),
  z.object({ type: z.literal("damage-resistance"), damageTypes: z.array(DamageTypeIdSchema).min(1).max(20) }).strict(),
  z.object({ type: z.literal("attack-advantage") }).strict(),
  z.object({ type: z.literal("incoming-attack-advantage") }).strict(),
  /** The bearer's own attack rolls have disadvantage (always-on, unlike turn-scoped attack-advantage). */
  z.object({ type: z.literal("attack-disadvantage") }).strict(),
  /** Attack rolls against the bearer have disadvantage (Dodge). */
  z.object({ type: z.literal("incoming-attack-disadvantage") }).strict(),
  /** The bearer's saving throws have advantage; absent ability = all saves (Dodge grants Dex only). */
  z.object({ type: z.literal("save-advantage"), ability: z.enum(["str", "dex", "con", "int", "wis", "cha"]).optional() }).strict(),
  z.object({ type: z.literal("save-disadvantage"), ability: z.enum(["str", "dex", "con", "int", "wis", "cha"]).optional() }).strict()
]);
export type EffectModifier = z.infer<typeof EffectModifierSchema>;

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
  armor: ItemArmorSchema.optional()
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
  archived: z.boolean().default(false)
});

export type Actor = z.infer<typeof ActorSchema>;

/** Immutable reusable content imported from JSON; mutable HP/position/ownership live elsewhere. */
export const ACTOR_DEFINITION_SCHEMA_VERSION = 1;
export const DiceFormulaSchema = z.string().regex(/^\d+d(?:4|6|8|10|12|20|100)(?:\s*[+-]\s*\d+)?$/i, "Use a safe dice formula such as 1d8 + 3.");
export const AbilitySchema = z.enum(["str", "dex", "con", "int", "wis", "cha"]);
export type AbilityId = z.infer<typeof AbilitySchema>;
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
