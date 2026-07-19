import { z } from "zod";

/** Version 1 is intentionally small; it establishes the import contract before an adapter exists. */
export const ACTOR_SCHEMA_VERSION = 1;

/** Lowercase damage-type id ("slashing", "fire"); free-form so homebrew types stay expressible. */
const DamageTypeIdSchema = z.string().min(1).max(40);
const ConditionIdSchema = z.string().regex(/^[a-z0-9-]+$/).max(60);
const EffectTagSchema = z.string().regex(/^[a-z0-9-]+$/).max(40);

/**
 * Typed modifiers an active effect contributes to the rules engine (ADR-0020). The vocabulary is
 * deliberately small and grows additively — unmodeled mechanics stay prose per ADR-0008.
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
 * engine ends them (turn boundaries, source defeat, encounter end) — clearing linked conditions and
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
  /** Provenance: slug of the definition this actor was instantiated from — a content-bundle id or an imported definition id (additive; absent for seeded actors). */
  definitionId: z.string().regex(/^[a-z0-9-]+$/).max(200).optional(),
  /** Token footprint in grid cells per side (large 2, huge 3, gargantuan 4); absent means 1. */
  sizeCells: z.number().int().min(1).max(4).optional(),
  /** D&D creature size label; drives sizeCells and lets the GM pick Tiny/Small/Medium (all 1×1). Absent means Medium. */
  size: z.enum(["tiny", "small", "medium", "large", "huge", "gargantuan"]).optional(),
  /** Custom uploaded token image (a token-asset id); absent means the initials glyph. Additive. */
  tokenAssetId: z.string().uuid().optional(),
  /** Active conditions by content-bundle id; `level` is only meaningful for exhaustion (1-6). Set manually or applied by the rules engine (failed saves, on-hit riders, the zero-HP machine — ADR-0020); still never silently mutated outside those documented paths. */
  conditions: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]+$/).max(60), level: z.number().int().min(1).max(6).optional() }).strict()).max(20).default([]),
  /** Live rules-engine effects (Rage, a grapple holding this actor). Additive per ADR-0007/0019. */
  effects: z.array(EffectInstanceSchema).max(20).default([]),
  /** Dying state at 0 HP (player characters only); null when not dying. Additive. */
  deathSaves: DeathSavesSchema.nullable().default(null),
  /** Spent limited-use counts by action id (per-encounter and per-long-rest pools). Additive. */
  actionUses: z.record(z.string(), z.number().int().nonnegative()).default({}),
  /** Conditions this actor is immune to (seeded from its definition; enforced skip-with-narration). GM knowledge — stripped from player projections. Additive. */
  conditionImmunities: z.array(ConditionIdSchema).max(20).default([]),
  /** Walking speed in feet (seeded from the definition, GM-editable). Absent = unknown → movement rules skip, the unmeasurable pattern. Additive. */
  speedFeet: z.number().int().min(0).max(500).optional()
});

export type Actor = z.infer<typeof ActorSchema>;

/** Immutable reusable content imported from JSON; mutable HP/position/ownership live elsewhere. */
export const ACTOR_DEFINITION_SCHEMA_VERSION = 1;
const DiceFormulaSchema = z.string().regex(/^\d+d(?:4|6|8|10|12|20|100)(?:\s*[+-]\s*\d+)?$/i, "Use a safe dice formula such as 1d8 + 3.");
const AbilitySchema = z.enum(["str", "dex", "con", "int", "wis", "cha"]);
/** Definition-side effect grant (Rage, Reckless Attack): resolving the action creates this effect on the actor itself. */
const EffectGrantSchema = z.object({
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
 * Every mechanics field below is additive-optional on schemaVersion 1 (ADR-0007 additive pattern,
 * ADR-0020 vocabulary): absent fields mean "prose only", and the engine falls back to reference
 * behavior exactly as before. Descriptions stay the display source of truth.
 */
const ActionSchema = z.object({
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
  /** Limited uses; "turn" resets every turn, "encounter" at encounter start, "long-rest" via a rest. `pool` shares one counter across actions carrying the same pool id (Sneak Attack once per turn regardless of weapon). */
  uses: z.object({ limit: z.number().int().min(1).max(20), per: z.enum(["turn", "encounter", "long-rest", "short-rest"]), pool: z.string().regex(/^[a-z0-9-]+$/).max(60).optional() }).strict().optional(),
  /** Declared reaction the engine can offer as a pending prompt (Uncanny Dodge: when hit by an attack, halve its damage). Only meaningful on activation "reaction". */
  reaction: z.object({ trigger: z.literal("hit-by-attack"), response: z.literal("half-damage") }).strict().optional()
});
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
  conditionImmunities: z.array(ConditionIdSchema).max(20).optional()
}).superRefine((actor, context) => {
  if (actor.schemaId === "vtt.actor-character" && actor.token.disposition !== "friendly") context.addIssue({ code: z.ZodIssueCode.custom, path: ["token", "disposition"], message: "Player-character definitions must use the friendly disposition." });
});
export type ActorDefinition = z.infer<typeof ActorDefinitionSchema>;
