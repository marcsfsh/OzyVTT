import { z } from "zod";
import { ActorDefinitionSchema, ActorSchema, HealthDisplaySchema, type Actor, type ActorDefinition, type EffectInstance, type EffectModifier, type HitDie } from "@vtt/schemas";

/** The `fromCatalog` choice-slug resolver (shared by the wizard UI and server-side character.create validation). */
export * from "./catalog-choice.js";

/**
 * The Codex entity field vocabulary. Shared for the same reason as the rider gates below: the GM UI
 * renders from it and the server prunes + seals from it, and a hand-synced copy on each side is how
 * a secret field silently stops being sealed.
 */
export * from "./codex-entities.js";

export { ACTOR_SCHEMA_VERSION, ActorSchema, DeathSavesSchema, EffectInstanceSchema, EffectModifierSchema, HealthDisplaySchema, type Actor, type ActorDefinition, type DeathSaves, type EffectInstance, type EffectModifier, type HealthDisplay, type HealthDisplayAudience, type HealthDisplayStyle } from "@vtt/schemas";
/**
 * The rider gate vocabulary, for the same reason: the homebrew authoring UI has to offer the fifteen
 * item slots and the thirty named triggers, and the client cannot reach `@vtt/schemas`. Anything
 * missing here gets re-typed as a hardcoded array in a `.tsx` file, and the two lists drift the
 * first time one of them grows. `RIDER_TRIGGER_KINDS` is what lets the editor group and label them
 * without a second opinion about which trigger is a moment.
 */
export {
  ItemMagicMarkerSchema, ItemSlotSchema, RIDER_TRIGGER_KINDS, RiderTriggerSchema, RiderWhenSchema, riderLayer, toRollModes,
  type ItemSlot, type NormalisedRollMode, type RiderTrigger, type RiderTriggerKind
} from "@vtt/schemas";
/**
 * Character-sheet helpers and their types. These MUST travel through `@vtt/domain`: the client has no
 * `@vtt/schemas` dependency, so anything missing here gets re-implemented ad hoc on the client - which
 * is exactly how the multiclass spellcasting resolution order drifted. `resolveSpellcasting` is THE
 * single implementation of that order; never inline a `classes[0]` fallback beside it.
 */
export {
  characterChoices, resolveSpellcasting, makeHitDicePool, HitDiceEntrySchema, HitDicePoolSchema, HitDieSchema,
  // `AbilityId` is NOT re-exported: domain already declares its own identical alias below.
  type CharacterChoice, type ClassSpellcasting, type HitDie, type HitDiceEntry, type HitDicePool, type Spellcasting
} from "@vtt/schemas";

/** An imported stat block persisted with the campaign: the inert definition plus the id actors reference via `definitionId`. */
export const StoredDefinitionSchema = z.object({ id: z.string().regex(/^[a-z0-9-]+$/).max(200), definition: ActorDefinitionSchema }).strict();
export type StoredDefinition = z.infer<typeof StoredDefinitionSchema>;
/** A player-submitted PDF import awaiting GM approval. GM-only — never in PlayerView or the viewer (ADR-0018). */
export const PendingImportSchema = z.object({ id: z.string().max(120), name: z.string().min(1).max(120), submittedBy: z.string().max(120), definition: ActorDefinitionSchema }).strict();
export type PendingImport = z.infer<typeof PendingImportSchema>;

export const RollVisibilitySchema = z.enum(["public", "gm-only", "blind", "self-only"]);
export const RollPurposeSchema = z.enum(["attack", "save", "check", "damage", "manual"]);
export const RollRecordSchema = z.object({
  id: z.string().uuid(),
  commandId: z.string().uuid(),
  initiatorSessionId: z.string().uuid(),
  initiatorRole: z.enum(["gm", "player"]),
  /**
   * Human-readable "who rolled this" - the GM, or the player's claimed character's name at roll
   * time. Optional so rolls persisted before this field existed still parse; the server always
   * supplies a real value for every new roll.
   */
  initiatorLabel: z.string().min(1).max(120).optional(),
  /**
   * What was rolled, specifically - e.g. "Athletics check", "DEX save", or a weapon/spell name - so the
   * dice log can show the roll's kind, not just the coarse purpose. Optional: older rolls (and rolls from
   * integrations that don't supply one) fall back to the purpose label in the UI.
   */
  label: z.string().min(1).max(80).optional(),
  actorId: z.string().uuid().nullable(),
  purpose: RollPurposeSchema,
  visibility: RollVisibilitySchema,
  formula: z.string(),
  normalizedFormula: z.string(),
  dice: z.array(z.object({ group: z.number().int().nonnegative(), sides: z.number().int().positive(), face: z.number().int().positive(), kept: z.boolean(), sign: z.union([z.literal(1), z.literal(-1)]) })),
  modifiers: z.array(z.object({ value: z.number().int().nonnegative(), sign: z.union([z.literal(1), z.literal(-1)]) })),
  total: z.number().int(),
  createdAt: z.string().datetime()
});
export type RollVisibility = z.infer<typeof RollVisibilitySchema>;
export type RollPurpose = z.infer<typeof RollPurposeSchema>;
export type RollRecord = z.infer<typeof RollRecordSchema>;
export type PlayerRollRecord = Omit<RollRecord, "initiatorSessionId">;

export const InitiativeEntrySchema = z.object({
  actorId: z.string().uuid(),
  score: z.number().int().min(-1000).max(1000),
  tieBreaker: z.number().int().min(-1000).max(1000).default(0)
});
export type InitiativeEntry = z.infer<typeof InitiativeEntrySchema>;

export const EncounterTokenPositionSchema = z.object({
  x: z.number().finite().nonnegative().max(1_000_000),
  y: z.number().finite().nonnegative().max(1_000_000)
}).strict();
export const EncounterTokenSchema = z.object({
  actorId: z.string().uuid(),
  position: EncounterTokenPositionSchema.nullable().default(null),
  sizePx: z.number().finite().positive().max(4096),
  gridSizePx: z.number().finite().positive().max(4096).nullable().default(null),
  gridRotationRadians: z.number().finite().min(-Math.PI).max(Math.PI).nullable().default(null),
  /** Footprint in cells per side; even sizes snap to grid intersections instead of cell centers. */
  sizeCells: z.number().int().min(1).max(4).default(1)
}).strict();
export type EncounterTokenPosition = z.infer<typeof EncounterTokenPositionSchema>;
export type EncounterToken = z.infer<typeof EncounterTokenSchema>;

export const AnnotationVisibilitySchema = z.enum(["public", "gm-only", "owner-only", "owner-gm", "gm-actor"]);
export type AnnotationVisibility = z.infer<typeof AnnotationVisibilitySchema>;

export const AnnotationShapeKindSchema = z.enum(["circle", "cone", "line", "square"]);
export type AnnotationShapeKind = z.infer<typeof AnnotationShapeKindSchema>;

export const AnnotationPointSchema = z.object({
  x: z.number().finite().nonnegative().max(1_000_000),
  y: z.number().finite().nonnegative().max(1_000_000)
}).strict();
export type AnnotationPoint = z.infer<typeof AnnotationPointSchema>;

/**
 * `origin` anchors the shape (center for circle, apex for cone, start point for line, an anchor
 * corner for square); `target` is the resize-handle point that determines direction/size. The
 * server derives and snaps `sizeFeet` from `origin`/`target` against the map's grid calibration -
 * both points are re-snapped on every add/move so geometry never drifts off-grid client-side.
 */
export const AnnotationGeometrySchema = z.object({
  origin: AnnotationPointSchema,
  target: AnnotationPointSchema,
  // Nonnegative, not strictly positive: a ping is a single point stored with sizeFeet 0. Rulers and
  // shapes always compute a positive span, but a persisted live ping must re-parse on startup (the
  // store validates the whole GameState on load), so 0 has to be legal here.
  sizeFeet: z.number().finite().nonnegative().max(2000)
}).strict();
export type AnnotationGeometry = z.infer<typeof AnnotationGeometrySchema>;

export const AnnotationColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color must be a #RRGGBB hex value.");
export const AnnotationSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["measurement", "shape", "ping"]),
  shape: AnnotationShapeKindSchema.nullable().default(null),
  geometry: AnnotationGeometrySchema,
  ownerSessionId: z.string().uuid(),
  createdByRole: z.enum(["gm", "player"]),
  visibility: AnnotationVisibilitySchema.default("public"),
  /** For `gm-actor` visibility: the actor whose owning player sees this alongside the GM. Null otherwise. */
  visibleToActorId: z.string().uuid().nullable().default(null),
  /** When true, any player (not just the owner) may move/resize this shape. The GM and owner always can. */
  movableByOthers: z.boolean().default(false),
  /** Stroke/fill color chosen by whoever drew it (per-session). */
  color: AnnotationColorSchema.default("#58c3ff"),
  /** Display label - currently the pinger's name for `ping` annotations; null otherwise. */
  label: z.string().max(60).nullable().default(null),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative().nullable().default(null)
}).strict().superRefine((annotation, context) => {
  if (annotation.kind === "shape" && annotation.shape === null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["shape"], message: "A shape annotation must specify a shape kind." });
  if (annotation.kind !== "shape" && annotation.shape !== null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["shape"], message: "Only shape annotations specify a shape kind." });
  if (annotation.visibility === "gm-actor" && annotation.visibleToActorId === null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["visibleToActorId"], message: "gm-actor visibility requires a target actor." });
  if (annotation.visibility !== "gm-actor" && annotation.visibleToActorId !== null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["visibleToActorId"], message: "Only gm-actor visibility carries a target actor." });
});
export type Annotation = z.infer<typeof AnnotationSchema>;

export const AbilityIdSchema = z.enum(["str", "dex", "con", "int", "wis", "cha"]);
export type AbilityId = z.infer<typeof AbilityIdSchema>;
/**
 * A saving throw a target still owes: created when a save action resolves, answered by rolling or
 * typing a total (GM anyone; a player their own character). On answer the outcome AUTO-APPLIES -
 * fail: full proposed damage + condition; success: half (or none). This is the owner-approved
 * documented exception to the propose→apply ladder for structured saves (ADR-0008 carve-out).
 */
export const PendingSaveSchema = z.object({
  id: z.string().uuid(),
  targetActorId: z.string().uuid(),
  ability: AbilityIdSchema,
  dc: z.number().int().min(1).max(40),
  /** Source actor for GM bookkeeping; stripped from player projections. */
  sourceActorId: z.string().uuid().nullable().default(null),
  sourceName: z.string().min(1).max(120),
  actionName: z.string().min(1).max(120),
  proposedDamage: z.number().int().nonnegative().max(10000).default(0),
  /** Typed components of the proposed damage (additive - absent on saves created before ADR-0020); when present, application runs the typed-defense pipeline. */
  proposedDamageParts: z.array(z.object({ amount: z.number().int().nonnegative().max(10000), type: z.string().min(1).max(40) }).strict()).max(9).optional(),
  halfOnSuccess: z.boolean().default(true),
  conditionId: z.string().regex(/^[a-z0-9-]+$/).max(60).nullable().default(null),
  /** Flat bonus to the save roll (GM-adjudicated cover: +2/+5 on Dex saves - SRD Cover). Additive. */
  saveBonus: z.number().int().min(0).max(10).default(0),
  /** Concentration check (SRD): effects ended when this save is FAILED on commit. Stripped from player projections. Additive. */
  endsEffects: z.array(z.object({ actorId: z.string().uuid(), effectId: z.string().min(1).max(120) }).strict()).max(8).optional(),
  /**
   * A source-linked effect applied on a committed failure (Unarmed Strike Grapple: the Grappled
   * effect with its escape DC). Additive - absent on saves created before this field existed.
   */
  onFailEffect: z.object({
    name: z.string().min(1).max(120),
    tags: z.array(z.string().regex(/^[a-z0-9-]+$/).max(40)).max(8).default([]),
    linkedConditionIds: z.array(z.string().regex(/^[a-z0-9-]+$/).max(60)).max(4).default([]),
    escapeDc: z.number().int().min(1).max(40).nullable().default(null),
    sourceActorId: z.string().uuid().nullable().default(null),
    sourceName: z.string().max(120).nullable().default(null)
  }).strict().optional(),
  createdAt: z.number().int().nonnegative()
}).strict();
export type PendingSave = z.infer<typeof PendingSaveSchema>;

/**
 * A declared reaction the engine offered and someone still owes an answer (ADR-0020 amendment): an
 * attack hit a combatant whose stat block declares a matching reaction (Uncanny Dodge), so the
 * triggering damage is parked here instead of the runner's apply button. Answering "use" spends the
 * reaction and applies the halved damage; "decline" applies it in full; the GM may dismiss (e.g.
 * after applying the damage manually). Prompts persist until answered so damage is never lost.
 */
export const PendingReactionSchema = z.object({
  id: z.string().uuid(),
  /** What opened the window: an attack that hit the reactor (Uncanny Dodge) or an enemy leaving its reach (opportunity attack). Additive. */
  kind: z.enum(["hit-by-attack", "leaves-reach"]).default("hit-by-attack"),
  /** The combatant who may react (the one that was hit, or whose reach was left). */
  actorId: z.string().uuid(),
  actionId: z.string().regex(/^[a-z0-9-]+$/).max(120),
  actionName: z.string().min(1).max(120),
  /** leaves-reach: the mover the reaction would strike. Additive. */
  targetActorId: z.string().uuid().nullable().default(null),
  /** Source actor for GM bookkeeping; stripped from player projections. */
  sourceActorId: z.string().uuid().nullable().default(null),
  sourceName: z.string().min(1).max(120),
  /** The action.resolve command that rolled the triggering attack. */
  triggerCommandId: z.string().uuid(),
  proposedDamage: z.number().int().nonnegative().max(10000).default(0),
  proposedDamageParts: z.array(z.object({ amount: z.number().int().nonnegative().max(10000), type: z.string().min(1).max(40) }).strict()).max(18).default([]),
  /** The triggering attack was a critical hit (drives death-save failure ticks when the damage lands). */
  critical: z.boolean().default(false),
  createdAt: z.number().int().nonnegative()
}).strict();
export type PendingReaction = z.infer<typeof PendingReactionSchema>;

/**
 * A player-initiated hit awaiting the GM's Apply tap (proposal mode - the default player damage policy).
 * When a player resolves their own attack and it hits, the server rolls the typed damage but parks it here
 * instead of touching the enemy's HP, so the GM confirms applying it (keeping "players never mutate a
 * creature they don't own"). GM-only - never projected to players or the viewer. The GM applies it through
 * the shared typed-defense pipeline (resistances, dying) via `damage.resolve`, or dismisses it.
 */
export const PendingDamageSchema = z.object({
  id: z.string().uuid(),
  /** The attacking (owned) character. */
  sourceActorId: z.string().uuid(),
  sourceName: z.string().min(1).max(120),
  actionName: z.string().min(1).max(120),
  /** The struck combatant whose HP the GM will reduce. */
  targetActorId: z.string().uuid(),
  targetName: z.string().min(1).max(120),
  /** Typed components so the GM's apply runs the resistance/immunity/vulnerability pipeline. */
  proposedDamageParts: z.array(z.object({ amount: z.number().int().nonnegative().max(10000), type: z.string().min(1).max(40) }).strict()).max(18).default([]),
  proposedTotal: z.number().int().nonnegative().max(10000).default(0),
  /** The hit was a critical (drives death-save failure ticks when the damage lands). */
  critical: z.boolean().default(false),
  createdAt: z.number().int().nonnegative()
}).strict();
export type PendingDamage = z.infer<typeof PendingDamageSchema>;

/**
 * Shared invariants for a combat context - the live top-level combat AND each parked scene's frozen
 * copy. Extracted so a scene's stored combat is validated with exactly the same rules as the active
 * one. Paths are relative to whichever combat object owns the refine, so Zod nests them correctly
 * under `scenes[i].combat.*` for parked scenes.
 */
function refineCombatContext(combat: { active: boolean; turnActorId: string | null; initiative: ReadonlyArray<{ actorId: string }>; tokens: ReadonlyArray<{ actorId: string }> }, context: z.RefinementCtx) {
  const actorIds = new Set<string>();
  for (const [index, entry] of combat.initiative.entries()) {
    if (actorIds.has(entry.actorId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["initiative", index, "actorId"], message: "Initiative actor IDs must be unique." });
    actorIds.add(entry.actorId);
  }
  if (combat.active && combat.initiative.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["initiative"], message: "An active encounter requires at least one combatant." });
  if (combat.active && combat.turnActorId === null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["turnActorId"], message: "An active encounter requires a current turn." });
  if (combat.turnActorId !== null && !actorIds.has(combat.turnActorId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["turnActorId"], message: "The current turn actor must be in Initiative." });
  const tokenActorIds = new Set<string>();
  for (const [index, token] of combat.tokens.entries()) {
    if (tokenActorIds.has(token.actorId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["tokens", index, "actorId"], message: "Encounter token actor IDs must be unique." });
    tokenActorIds.add(token.actorId);
    if (!actorIds.has(token.actorId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["tokens", index, "actorId"], message: "Encounter tokens must belong to actors in Initiative." });
  }
}

/**
 * How strictly the engine polices one rule (ADR-0020). The wire values never change: the GM-facing
 * words are Enforce / Advise / Off, but those are COPY - renaming the enum would be a second
 * breaking API change, and only one was approved. Surfaces translate; the protocol does not.
 */
export const RuleModeSchema = z.enum(["strict", "assisted", "freeform"]);
export type RuleMode = z.infer<typeof RuleModeSchema>;

/**
 * The five families every rule id in the engine belongs to. A GM relaxes rules a FAMILY at a time
 * ("don't police movement"), never one rule id at a time - per-rule toggles would be a settings
 * wall, and the per-turn override memory (`turn.rulesOverriddenFamilies`) is keyed the same way so
 * one Allow stops the same kind of block nagging for the rest of that creature's turn.
 *
 * The rule-id → family mapping is server-side (`apps/server/src/rules-families.ts`) and pinned by a
 * totality test; this enum is the wire vocabulary both sides share.
 */
export const RuleFamilySchema = z.enum(["movement", "economy", "resources", "targeting", "slots"]);
export type RuleFamily = z.infer<typeof RuleFamilySchema>;

/**
 * Per-family overrides of the standing dial. An absent key means "follow the dial", which is why
 * every key is optional rather than a full record: the stored shape says what the GM CHANGED.
 *
 * Deliberately not `.strict()` for stored state - an unknown family from a newer build strips on
 * load instead of failing the whole GameState parse (the ADR-0007 additive rule). The command
 * schemas call `.strict()` on it so a typo in a request is a rejection, not a silent no-op.
 */
export const RuleExceptionsSchema = z.object({
  movement: RuleModeSchema.optional(),
  economy: RuleModeSchema.optional(),
  resources: RuleModeSchema.optional(),
  targeting: RuleModeSchema.optional(),
  slots: RuleModeSchema.optional()
});
export type RuleExceptions = z.infer<typeof RuleExceptionsSchema>;

/**
 * `slots` starts at "assisted", NOT at the dial. Slot enforcement is new; inheriting a default-strict
 * dial would silently start hard-blocking casts that have always worked. The GM opts into strict slot
 * tracking; nothing opts them in for us.
 */
export const DEFAULT_RULE_EXCEPTIONS: RuleExceptions = { slots: "assisted" };

/**
 * The commands a blocked player may ask the GM about (D8). Deliberately a closed list: `rules.answer`
 * re-runs the parked payload under GM authority, so "which commands can be replayed with an override"
 * has to be a decision, never whatever a client happens to send.
 */
export const AskableCommandSchema = z.enum(["action.resolve", "action.use", "token.move", "actor.set-condition"]);
export type AskableCommand = z.infer<typeof AskableCommandSchema>;

/**
 * A player's parked "Ask the GM" (D8). A blocked player action used to be a SILENT dead end - they
 * tapped, the server refused, and nothing at all reached them. Now the block carries one button, and
 * the tap parks the exact command here for the GM to allow or deny in one tap of their own.
 *
 * The owner is NOT stored: it is the parked actor's `ownerSessionId`, read live, exactly as pending
 * saves and reaction prompts decide whose prompt is whose. `command.payload` is the original request,
 * kept verbatim so the re-run is the SAME command - it is revalidated against its own schema before it
 * runs again, and it never crosses to a player (it can name target ids they cannot see).
 */
export const PendingRuleAskSchema = z.object({
  id: z.string().uuid(),
  /** The character the blocked command was for; also decides which player may see this ask. */
  actorId: z.string().uuid(),
  /** The machine-readable rule that blocked it (e.g. `economy.action-used`). */
  rule: z.string().min(1).max(120),
  /** The rule's family, or null when nothing has classified it (see RuleFamilySchema). */
  family: RuleFamilySchema.nullable().default(null),
  /** The player-facing sentence the block produced ("That needs your action - already used this turn"). */
  message: z.string().min(1).max(300),
  /** The parked command, replayed verbatim on Allow. GM-only - never projected to any player. */
  command: z.object({ type: AskableCommandSchema, payload: z.unknown() }).strict(),
  createdAt: z.string().datetime()
}).strict();
export type PendingRuleAsk = z.infer<typeof PendingRuleAskSchema>;

/** Combat fields shared by the live top-level combat and each parked scene - everything except the map (a Scene carries its own) and the scene bookkeeping (only the top level carries that). */
const sceneCombatShape = {
  active: z.boolean().default(false),
  round: z.number().int().positive().default(1),
  turnActorId: z.string().uuid().nullable().default(null),
  initiative: z.array(InitiativeEntrySchema).max(200).default([]),
  tokens: z.array(EncounterTokenSchema).max(200).default([]),
  annotations: z.array(AnnotationSchema).max(300).default([]),
  /**
   * Action economy of the current turn's actor; reset whenever the turn changes. Structured action
   * resolution validates against it per the encounter's rulesMode (ADR-0020); the manual turn.use
   * toggles remain a free escape hatch. `actionInstance` tracks an open compound action (Extra
   * Attack, Multiattack) as remaining component counts; `turnUses` tracks per-turn limited uses
   * keyed `${actorId}:${actionId}` (off-turn actors can spend per-turn features via reactions).
   */
  turn: z.object({
    actionUsed: z.boolean().default(false),
    bonusActionUsed: z.boolean().default(false),
    actionInstance: z.object({ actorId: z.string().uuid(), components: z.record(z.string(), z.number().int().nonnegative()) }).strict().nullable().default(null),
    turnUses: z.record(z.string(), z.number().int().nonnegative()).default({}),
    /** Feet of movement the current turn's actor has spent (fractional on gridless maps); validated against effective speed per rules mode. Additive. */
    movementUsedFeet: z.number().nonnegative().max(100000).default(0),
    /** GM knowledge: the GM overrode a strict rules block this turn, so the rest of this creature's turn
     * skips re-prompting for the per-turn-repeatable families it covers - action/bonus/reaction economy
     * and positional range/reach. Other families (incapacitation, limited uses, legendary, cover) still
     * re-prompt. Cleared with the rest of `turn` on turn advance. Optional/additive; stripped from player projections.
     *
     * LEGACY: superseded by `rulesOverriddenFamilies` below, which covers every family instead of two
     * hardcoded prefixes. Kept so a state persisted mid-turn by an older build still parses and still
     * behaves; writers set BOTH, readers prefer the array. */
    rulesOverridden: z.boolean().optional(),
    /** GM knowledge: which rule families the GM has already waved through THIS turn (D9 - one tap, then
     * the same kind of block stops nagging until the turn ends). Cleared with the rest of `turn` on turn
     * advance. Optional/additive; stripped from player projections. */
    rulesOverriddenFamilies: z.array(RuleFamilySchema).max(5).optional()
  }).default({ actionUsed: false, bonusActionUsed: false, actionInstance: null, turnUses: {}, movementUsedFeet: 0 }),
  /** How structured action resolution enforces rules (ADR-0020): strict rejects with an override path, assisted warns, freeform stays reference-level. */
  rulesMode: RuleModeSchema.default("strict"),
  /** Per-family overrides of this fight's `rulesMode` (see RuleExceptionsSchema). An absent key follows
   * the dial. Additive; the default keeps new slot enforcement advisory rather than silently hardening
   * a save that has been casting freely. Player-readable alongside `rulesMode` - it holds no secrets. */
  ruleExceptions: RuleExceptionsSchema.default(DEFAULT_RULE_EXCEPTIONS),
  /** Per-table policy for how a PLAYER's confirmed hit reaches an enemy's HP: "proposal" parks a GM-confirmed
   * damage proposal (the GM taps Apply - the default, preserving "players never mutate a creature they don't
   * own"); "direct" applies the typed damage immediately, server-side, when the GM opts the table in. The GM's
   * own resolves always use the runner's explicit Apply regardless. Additive; default preserves prior behavior. */
  playerDamageMode: z.enum(["proposal", "direct"]).default("proposal"),
  /** Per-table policy for player-rolled initiative when an encounter starts with `playersRollInitiative`:
   * "immediate" begins turns at once on a provisional order that re-sorts as players roll in; "wait" holds
   * turn advancement until every claimed player has rolled (or the GM rolls for the rest). Additive; the
   * default preserves the prior immediate behavior. */
  playerInitiativeMode: z.enum(["immediate", "wait"]).default("immediate"),
  /** How a token's current health shows on the map (table-wide default; a per-token `actor.healthDisplay` overrides it). `band` is the coarse badge shown to everyone (today's behavior); `bar`/`ring` are richer indicators gated by `audience` ("gm" = GM map only, "all" = everyone with a band-fraction for non-owners). Additive; the default preserves the prior badge-only behavior. */
  healthDisplay: HealthDisplaySchema.default({ style: "band", audience: "gm" }),
  /** GM-set underwater environment (SRD Underwater Combat): melee disadvantage unless piercing, ranged auto-miss beyond normal range, everyone resists fire. Additive. */
  underwater: z.boolean().default(false),
  /** Combatants whose reaction is spent; an actor's id is removed when their own turn starts (5e refresh timing). */
  reactionsUsed: z.array(z.string().uuid()).max(200).default([]),
  /** Legendary actions spent since each legendary creature's last turn start (actorId → count); the entry clears when that creature's own turn begins (SRD Legendary Actions refresh). Additive; GM knowledge - stripped from the player projection. */
  legendaryUsed: z.record(z.string(), z.number().int().nonnegative()).default({}),
  /**
   * Manual fog of war, per scene: an ordered painter's list folded from "all hidden" - a reveal
   * punches visibility, a hide re-covers it (AboveVTT-style manual reveal; no vision/lighting).
   * `enabled: false` = no fog (the default and the pre-fog behavior); enabled with no shapes = a
   * fully hidden map. Rects live in image-pixel space like annotations. Fog is presentation, never
   * the security boundary: hidden actors/annotations are stripped by their own projection filters,
   * so players receive this verbatim - the mask IS what they must render. Additive.
   */
  fog: z.object({
    enabled: z.boolean().default(false),
    shapes: z.array(z.object({
      kind: z.literal("rect"),
      id: z.string().uuid(),
      op: z.enum(["reveal", "hide"]),
      x: z.number().min(0).max(100000),
      y: z.number().min(0).max(100000),
      width: z.number().positive().max(100000),
      height: z.number().positive().max(100000)
    }).strict()).max(200).default([])
  }).strict().default({ enabled: false, shapes: [] }),
  /** Saving throws still owed by targets (see PendingSaveSchema). */
  pendingSaves: z.array(PendingSaveSchema).max(100).default([]),
  /** Reaction prompts still owed an answer (see PendingReactionSchema). */
  pendingReactions: z.array(PendingReactionSchema).max(20).default([]),
  /** Player-initiated hits awaiting the GM's Apply tap in proposal mode (see PendingDamageSchema). GM-only. */
  pendingDamage: z.array(PendingDamageSchema).max(50).default([]),
  /** Blocked player actions waiting on the GM's Allow/Deny (see PendingRuleAskSchema). A player sees only their own. */
  pendingRuleAsks: z.array(PendingRuleAskSchema).max(10).default([]),
  /** Claimed-PC actorIds whose owner still owes an initiative roll (when the encounter started with
   * `playersRollInitiative`). Cleared as each player rolls (initiative:roll-self) or the GM rolls the rest. */
  pendingInitiative: z.array(z.string().uuid()).max(200).default([])
};

/** A parked scene's frozen combat - same fields and invariants as the live combat, minus the map (the Scene owns that). */
export const SceneCombatSchema = z.object(sceneCombatShape).superRefine(refineCombatContext);
export type SceneCombat = z.infer<typeof SceneCombatSchema>;

/** A prepared encounter the GM can switch to: its map plus a frozen combat context that resumes exactly when activated. */
export const SceneSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  mapAssetId: z.string().uuid(),
  combat: SceneCombatSchema.default({})
}).strict();
export type Scene = z.infer<typeof SceneSchema>;

export const CombatStateSchema = z.object({
  ...sceneCombatShape,
  mapAssetId: z.string().uuid().nullable().default(null),
  /** Prepared scenes the GM parks-and-resumes between. The active scene's own `combat` slot stays empty - its live copy is these top-level fields (single source of truth). */
  scenes: z.array(SceneSchema).max(20).default([]),
  activeSceneId: z.string().uuid().nullable().default(null),
  /**
   * Turn time-travel bookkeeping (live fight only - parked scenes never carry these). `historyCursor`
   * is the turn-snapshot index the whole table is currently viewing (null = live); `historyDirty`
   * marks that the restorable state changed while rewound, so moving on requires GM confirmation.
   * The snapshots themselves live outside GameState in the store's turn_snapshots table.
   */
  historyCursor: z.number().int().nonnegative().nullable().default(null),
  historyDirty: z.boolean().default(false)
}).superRefine((combat, context) => {
  refineCombatContext(combat, context);
  const sceneIds = new Set<string>();
  for (const [index, scene] of combat.scenes.entries()) {
    if (sceneIds.has(scene.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["scenes", index, "id"], message: "Scene IDs must be unique." });
    sceneIds.add(scene.id);
  }
  if (combat.activeSceneId !== null && !sceneIds.has(combat.activeSceneId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["activeSceneId"], message: "The active scene must be one of the prepared scenes." });
  const active = combat.activeSceneId === null ? undefined : combat.scenes.find((scene) => scene.id === combat.activeSceneId);
  if (active && (active.combat.active || active.combat.initiative.length > 0 || active.combat.tokens.length > 0 || active.combat.annotations.length > 0 || active.combat.reactionsUsed.length > 0 || Object.keys(active.combat.legendaryUsed).length > 0 || active.combat.fog.enabled || active.combat.fog.shapes.length > 0 || active.combat.pendingSaves.length > 0 || active.combat.pendingReactions.length > 0 || active.combat.pendingDamage.length > 0 || active.combat.pendingRuleAsks.length > 0 || active.combat.pendingInitiative.length > 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["scenes"], message: "The active scene's stored combat must be empty - its live copy is the top-level combat." });
  }
});
export type CombatState = z.infer<typeof CombatStateSchema>;

/** An ability-score generation method the character builder can offer (task-packet decision 10). */
export const BuilderAbilityMethodSchema = z.enum(["standard-array", "point-buy", "roll", "custom"]);
export type BuilderAbilityMethod = z.infer<typeof BuilderAbilityMethodSchema>;
/**
 * The GM's character-builder table policy (task-packet decision 10): which ability-score methods the
 * wizard offers, plus the GM's custom roll formula. GM-writable via `builder.set-policy`,
 * player-READABLE (projected verbatim onto PlayerView - it holds no secrets, and a player must see
 * it to know which methods their wizard shows). Lives top-level rather than on `combat` because
 * character creation is campaign policy, not fight state - parking it on combat would drag it
 * through scene park/resume and the SceneCombat shape. All four methods are allowed by default;
 * "custom" is only actionable while `customFormula` is non-null (validated on write through
 * `@vtt/rules-5e`'s `validateAbilityFormula` - never stored unvalidated).
 */
export const BuilderPolicySchema = z.object({
  allowedAbilityMethods: z.array(BuilderAbilityMethodSchema).min(1).max(4).default(["standard-array", "point-buy", "roll", "custom"]),
  customFormula: z.string().min(1).max(160).nullable().default(null),
  /** The highest character level this table builds to. Enforced server-side by the builder AND by the
   * sheet's shallow identity edit, so neither door can exceed the cap. Additive; 20 preserves today. */
  maxLevel: z.number().int().min(1).max(20).default(20),
  /** Whether players may run the character builder themselves ("open") or only the GM can ("gm-only").
   * Additive; the default is the D13 answer - players build their own. STORED POLICY ONLY at this
   * slice: `character.create` is still GM-gated in `game-operations.ts`, and the un-gating (with its
   * auto-claim and per-session create caps) is the separate WI5 §2 change. Nothing reads it to make an
   * authorization decision yet - it is projected so the surface work and the auth change land together
   * against one already-persisted policy rather than migrating a second time. */
  playerBuilder: z.enum(["open", "gm-only"]).default("open")
}).strict();
export type BuilderPolicy = z.infer<typeof BuilderPolicySchema>;

/**
 * How strictly the table polices rules by DEFAULT - the standing campaign setting each new fight
 * starts from (D7). Lives top-level beside `builderPolicy` for the same reason: it is table policy,
 * not fight state, so it must not ride scene park/resume. `combat.rulesMode`/`combat.ruleExceptions`
 * are the LIVE copy for the fight in progress; this is what the next fight inherits.
 */
export const RulesPolicySchema = z.object({
  dial: RuleModeSchema.default("strict"),
  exceptions: RuleExceptionsSchema.default(DEFAULT_RULE_EXCEPTIONS)
}).strict();
export type RulesPolicy = z.infer<typeof RulesPolicySchema>;

/**
 * Table defaults for staging (D2): what a newly staged combatant's token visibility starts as, so a
 * GM who preps hidden ambushes doesn't re-pick "GM only" on every add. The per-add `visibility`
 * argument stays explicit on the wire - this is the value a SURFACE initializes its toggle from, not
 * a server-side silent substitution, so the command still says exactly what it did.
 */
export const StagingDefaultsSchema = z.object({
  visibility: z.enum(["public", "gm-only"]).default("public")
}).strict();
export type StagingDefaults = z.infer<typeof StagingDefaultsSchema>;

export const GameStateSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative().default(0),
  actors: z.array(ActorSchema).default([]),
  rolls: z.array(RollRecordSchema).default([]),
  combat: CombatStateSchema.default({ active: false, round: 1, turnActorId: null, mapAssetId: null, initiative: [], tokens: [], annotations: [] }),
  /** Imported stat blocks (canonical ActorDefinition JSON) that live with the campaign, additive per ADR-0007. */
  definitions: z.array(StoredDefinitionSchema).max(100).default([]),
  /** Player-submitted PDF imports awaiting GM approval. GM-only: curated out of PlayerView (a Pick) and the viewer. Additive per ADR-0007/0018. */
  pendingImports: z.array(PendingImportSchema).max(20).default([]),
  /** Character-builder table policy (decision 10). GM-set, player-read; additive with a full default so older saves parse unchanged. */
  builderPolicy: BuilderPolicySchema.default({}),
  /** Standing rules policy every new fight starts from (D7). GM-set, player-read; additive with a full default. */
  rulesPolicy: RulesPolicySchema.default({}),
  /** Table defaults for staging new combatants (D2). GM-set, GM-read; additive with a full default. */
  stagingDefaults: StagingDefaultsSchema.default({})
});
export type GameState = z.infer<typeof GameStateSchema>;
export type ClientRole = "player" | "gm";

/** Server-authoritative connection presence for a claimed character's owning session. Never carries a session ID, token, socket ID, or address across the wire. */
export const PresenceStatusSchema = z.enum(["online", "reconnecting", "offline"]);
export type PresenceStatus = z.infer<typeof PresenceStatusSchema>;

/** Coarse health signal safe for any audience; "bloodied" is the 2024 rules' at-or-below-half state. */
export type HealthBand = "healthy" | "bloodied" | "down";
/** Player characters stay exact for the whole party; monsters/NPCs reach players only as a band so the GM keeps exact numbers. */
export type PlayerHp = { kind: "exact"; current: number; maximum: number; temporary: number } | { kind: "band"; band: HealthBand };
/** An effect as players see it: source ids never cross the wire, and a hidden source's name is masked server-side (viewer safety). */
export type PlayerEffect = Omit<EffectInstance, "sourceActorId" | "sourceActionId">;
export type PlayerActor = Omit<Actor, "notes" | "ownerSessionId" | "hp" | "effects" | "actionUses" | "conditionImmunities" | "legendary" | "hitDice" | "healthDisplay" | "lastUsedAt" | "spellSlots" | "pactSlots" | "preparedSpellIds" | "inventory" | "currency" | "archived" | "sheetPreview"> & { hp: PlayerHp; effects: PlayerEffect[]; claimStatus: "available" | "mine" | "claimed"; presence: PresenceStatus | null; /** Present only on the requesting player's own claimed character. */ definition?: ActorDefinition; /** Spent limited-use counts - only on the requesting player's own claimed character. */ actionUses?: Record<string, number>; /** Hit Point Dice pool (per-die `entries` plus the derived total summary) - only on the requesting player's own claimed character. */ hitDice?: NonNullable<Actor["hitDice"]>; /** Sheet resources (spell slots, prepared spells, inventory, currency) - only on the requesting player's own claimed character. */ spellSlots?: Actor["spellSlots"]; pactSlots?: Actor["pactSlots"]; preparedSpellIds?: Actor["preparedSpellIds"]; inventory?: Actor["inventory"]; currency?: Actor["currency"]; /** The resolved token health indicator, present only when the table shows a bar/ring/aura to everyone (audience "all"); the client derives the fill from `hp` (exact for the owner, coarse band otherwise). */ healthDisplay?: Readonly<{ style: "bar" | "ring" | "aura" }> };
export type PlayerInitiativeEntry = Readonly<{ actorId: string; name: string; score: number; active: boolean; health: HealthBand; /** Active condition ids + parallel display labels ("Prone", "Exhaustion 3"): public info, so players and the shared screen render the same dots from one source. */ conditionIds: readonly string[]; conditions: readonly string[] }>;
export type PlayerAnnotation = Omit<Annotation, "ownerSessionId"> & { mine: boolean };
/** A player's own pending saves only; source actor ids and concentration effect references never cross the wire, and a hidden source's name is masked server-side. */
export type PlayerPendingSave = Omit<PendingSave, "sourceActorId" | "endsEffects">;
/** A player's own pending reaction prompts only; same masking rules as saves. */
export type PlayerPendingReaction = Omit<PendingReaction, "sourceActorId">;
/**
 * A player's view of their OWN parked ask (D8): enough to say "waiting on the GM" and which of their
 * taps it was. `command` is absent by design - the parked payload can name target ids the player is not
 * allowed to know, and a player never needs it to read their own pending question.
 */
export type PlayerPendingRuleAsk = Omit<PendingRuleAsk, "command">;
export type PlayerCombatView = Readonly<{ active: boolean; round: number; turnActorId: string | null; mapAssetId: string | null; hiddenTurn: boolean; initiative: readonly PlayerInitiativeEntry[]; tokens: readonly EncounterToken[]; annotations: readonly PlayerAnnotation[]; turn: { actionUsed: boolean; bonusActionUsed: boolean; actionInstance: { actorId: string; components: Record<string, number> } | null; turnUses: Record<string, number>; movementUsedFeet: number }; rulesMode: RuleMode; /** Per-family overrides of `rulesMode` (see CombatState.ruleExceptions). Players see the table's rules configuration exactly as they already see `rulesMode` - it holds no secrets, and a player's sheet has to know whether a block is coming before they tap. */ ruleExceptions: RuleExceptions; /** Per-table policy for a player's own hits (see CombatState.playerDamageMode); lets the player runner label the outcome ("handed to the GM" vs "applied"). The pendingDamage proposals themselves stay GM-only. */ playerDamageMode: "proposal" | "direct"; /** Public claimed-PC actorIds still owing an initiative roll - a player checks whether their own id is here to show the "Roll initiative" prompt. */ pendingInitiative: readonly string[]; /** Whether the table waits for all players' initiative rolls before turns begin (see CombatState.playerInitiativeMode). */ playerInitiativeMode: "immediate" | "wait"; underwater: boolean; reactionsUsed: readonly string[]; /** The fog mask verbatim (geometry only - hidden things are stripped by their own filters). */ fog: CombatState["fog"]; pendingSaves: readonly PlayerPendingSave[]; pendingReactions: readonly PlayerPendingReaction[]; /** The player's OWN parked Ask-the-GM questions (see PlayerPendingRuleAsk) - never another player's, never the GM's deliberation. */ pendingRuleAsks: readonly PlayerPendingRuleAsk[]; /** True while the GM has the table viewing an earlier turn (no labels - those can name hidden combatants). */ rewound: boolean }>;
/**
 * The door to an archived character's read-only sheet, and NOTHING else: id and name only, and only
 * for archived characters the GM explicitly shared (`sheetPreview`) that were public to begin with.
 * Hit points, conditions, claims, notes and the definition are all omitted - when in doubt, omit; this
 * list exists so a player can find the preview, not so it can render one.
 */
export type PlayerArchivedCharacter = Readonly<{ id: string; name: string }>;
export type PlayerView = Pick<GameState, "revision"> & { combat: PlayerCombatView; actors: PlayerActor[]; rolls: PlayerRollRecord[]; /** The GM's builder policy, verbatim (GM-set, player-read - a player's wizard offers exactly these methods). */ builderPolicy: BuilderPolicy; /** Archived characters the GM shared for preview (see PlayerArchivedCharacter). Empty by default. */ archivedCharacters: readonly PlayerArchivedCharacter[] };
export type GmActor = Actor & { presence: PresenceStatus | null };
/** One recorded turn boundary on the time-travel timeline. GM-only (labels can name hidden combatants); the server attaches the list to GM views at emission. */
export type TurnHistoryEntry = Readonly<{ index: number; kind: "turn" | "return"; label: string; revision: number; at: string }>;
export type GmView = Omit<GameState, "actors"> & { actors: GmActor[]; turnHistory?: readonly TurnHistoryEntry[] };
/**
 * One line of THE TABLE FEED (D11) - the single durable record of what happened at the table: rolls,
 * hits, saves, turn starts, narration. Players only ever receive gmOnly=false entries; the GM sees all,
 * and a `self-only` roll reaches exactly one player (the roller) and the GM.
 *
 * The feed superseded the dice-log/combat-log split: `kind: "roll"` rows carry the whole roll in `roll`
 * so "where did my roll go" has one answer. `GameState.rolls` stays as the live 200-roll hot window
 * (wire contract, and the sheet's pinned last roll reads it) - the two share `RollRecord.id`, so a client
 * that reads both dedupes on it rather than double-rendering.
 */
export type CombatLogEntry = Readonly<{
  id: number;
  at: string;
  kind: "damage" | "heal" | "save" | "action" | "condition" | "reaction" | "turn" | "encounter" | "scene" | "history" | "roll" | "movement" | "effect" | "death-save" | "override";
  text: string;
  gmOnly: boolean;
  revision: number;
  /** Which character or monster this line is about (D11 "every roll attributed") - drives the feed's "just mine" filter. Absent on table-wide lines. */
  actorId?: string | null;
  /** The roll behind a `kind: "roll"` row, in the player-safe shape - `initiatorSessionId` is stripped for EVERY recipient, GM included (the GM already has it in `GameState.rolls`). */
  roll?: PlayerRollRecord;
  /** True only on a `self-only` roll the RECIPIENT rolled - "only you can see this". Computed per recipient; never stored. */
  private?: boolean;
}>;

/** A brief, ephemeral battlemap notification ("Goblin took 6 damage"). Never stored in GameState - presentation only; the roll history is the durable record. */
export type TableEvent = Readonly<{ id: string; kind: "damage" | "heal" | "save" | "action" | "condition" | "reaction" | "effect" | "death-save"; text: string; actorIds: readonly string[]; at: number }>;
/**
 * The worldbuilding codex changed. CONTENT-FREE BY DESIGN (D22) - a revision counter and nothing else, so
 * every recipient refetches only its own projected view over HTTP.
 *
 * It used to carry a `scope` ("pages" | "journal" | ...). That word went out to EVERY connected socket,
 * players included, which told the table which part of the codex the GM is working on right now - a small
 * but real leak of GM intent, and one the homebrew notifier eight lines below already refused on exactly
 * that principle. No client ever read it: every listener is a wholesale refetch. Two notifiers, one rule.
 */
export type CodexChangedEvent = Readonly<{ codexRevision: number }>;
/** The homebrew library changed. Like `codex:changed` this carries NO content - only a revision, so every recipient refetches its own audience-filtered view over HTTP. A ping that carried the record would hand a player a GM-only draft. */
export type HomebrewChangedEvent = Readonly<{ revision: number }>;
export interface ServerToClientEvents { "state:updated": (state: PlayerView | GmView) => void; "system:error": (message: string) => void; "table:event": (event: TableEvent) => void; "log:entry": (entry: CombatLogEntry) => void; "codex:changed": (event: CodexChangedEvent) => void; "homebrew:changed": (event: HomebrewChangedEvent) => void; }
export type SessionJoinResult = { ok: boolean; role?: ClientRole; sessionId?: string; token?: string; message?: string };
export type MutationResult = { ok: boolean; revision?: number; duplicate?: boolean; message?: string; needsConfirm?: "rewrite-history" | "discard-changes"; /** Present when a rules-mode validation blocked the command (ADR-0020); resend with override to bypass. */ blocked?: RulesBlocked };
export type DiceRollResult = MutationResult & { rollId?: string; hiddenFromRoller?: boolean };
export type EncounterStartEntry = Readonly<{ actorId: string; score?: number; /** 2024 surprise: initiative rolls with disadvantage. */ surprised?: boolean }>;
export type AnnotationGeometryInput = Readonly<{ origin: AnnotationPoint; target: AnnotationPoint }>;
export type AnnotationAddResult = MutationResult & { annotationId?: string };
export type ActorAddResult = MutationResult & { actorId?: string };
export type SceneCreateResult = MutationResult & { sceneId?: string };
/** Compact browse row for bundled monster content; the server maps content definitions into this wire shape. */
export type ContentMonsterSummary = Readonly<{ id: string; name: string; challengeRating: number; type: string; size: string; armorClass: number; hitPoints: number }>;
export type ContentMonstersResult = { ok: boolean; message?: string; monsters?: readonly ContentMonsterSummary[]; attribution?: string };
/** SRD condition reference (name + rules text) for pickers and tooltips; public information for any joined session. */
export type ContentConditionSummary = Readonly<{ id: string; name: string; description: string }>;
export type ContentConditionsResult = { ok: boolean; message?: string; conditions?: readonly ContentConditionSummary[]; /** The bundle's canonical CC BY 4.0 line (ADR-0015). The server always sends it; a surface that has to hand-write a substitute always writes a weaker one. */ attribution?: string };
/** SRD spell reference (rules text + the header fields a card shows) for the in-app spell rules window; public information for any joined session. */
export type ContentSpellSummary = Readonly<{ id: string; name: string; level: number; school: string; castingTime: string; rangeText: string | null; componentsText: string; duration: string; concentration: boolean; ritual: boolean; description: string; higherLevel: string | null;
  /** Spell-list ids this spell belongs to ("wizard", "cleric", a homebrew list slug) - THE class->spell-list link the wizard's spell step filters on (paired with `ContentClassSummary.spellcasting.spellListId`). */
  classes: readonly string[];
  /** Base damage/healing roll ("8d6"), or null for a spell that rolls nothing. Drives the sheet's "cast at" auto-roll. */
  damageRoll: string | null;
  /** Damage types for the base roll (empty for healing/none). */
  damageTypes: readonly string[];
  /** Per-slot-level upcast scaling parsed from the SRD (Fireball's 9d6 at 4th, Scorching Ray's 4 rays at 3rd): the sheet auto-applies the entry matching the chosen cast level. */
  castingOptions: ReadonlyArray<{ level: number; damageRoll: string | null; targetCount: number | null }> }>;
export type ContentSpellsResult = { ok: boolean; message?: string; spells?: readonly ContentSpellSummary[]; /** The bundle's canonical CC BY 4.0 line (ADR-0015), exactly as for every other catalog read. */ attribution?: string };
/**
 * One addable-equipment catalog row (SRD gear/weapons/armor folded into one shape); public SRD
 * reference the sheet's browse-and-add picker reads. The `weapon`/`armor` blocks are populated only
 * for those categories.
 *
 * `category` is an OPEN SLUG, matching the catalog record and `InventoryItem.category` (which was
 * always open). Homebrew declares "relic" or "trinket" with no wire change; a surface that groups by
 * category must derive its groups from the data, because there is no closed list to switch on. Four
 * values still carry mechanical meaning - "weapon", "armor" and "shield" drive AC and attack
 * derivation, everything else is inert - so a new slug displays and stacks but derives nothing.
 */
export type ContentEquipmentSummary = Readonly<{ id: string; name: string; category: string; costGp: number | null; weightLb: number | null; description: string | null; weapon: Readonly<{ category: "simple" | "martial"; damageDice: string; damageType: string; rangeFeet: number | null; longRangeFeet: number | null }> | null; armor: Readonly<{ acBase: number; addDexModifier: boolean; dexModifierCap: number | null; stealthDisadvantage: boolean; strengthRequired: number | null }> | null }>;
export type ContentEquipmentResult = { ok: boolean; message?: string; equipment?: readonly ContentEquipmentSummary[]; attribution?: string };

// ---------- Character-builder catalogs ----------
// One merged catalog per type, read-only, public SRD *rules* reference: a player builds their own
// character, so unlike the bestiary these are readable by any joined session. Every response carries
// the CC BY 4.0 `attribution` line the displaying surface must show (ADR-0015).

/** Where a catalog record came from. Bundled SRD and GM homebrew live in ONE catalog, merged server-side, so the wizard can't tell them apart (adapters, never forks). */
export type ContentSourceKind = "srd" | "homebrew";
/**
 * A class/subclass/species/background/feat feature as data - the browse-and-pick projection of the
 * bundle's shared `FeatureRecord`: prose, the level it lands at, its grouping tags, and whether it
 * asks the player to choose something. No feature is ever hardcoded client or server behavior;
 * homebrew authors the same record. The structured riders (granted actions, effects, modifiers,
 * limited uses) stay on the server-side record - the server, never the wizard, applies them.
 */
/**
 * One inline option of a feature's pick, as the wizard needs to render and follow it. Carries the
 * authored NAME (an id alone forces the client to titleize, turning `clouds-jaunt` into "Clouds
 * Jaunt") and any SECOND-ORDER pick the option itself owes: Cleric Divine Order's "thaumaturge"
 * grants an extra cantrip, so choosing it opens another choice. Without that nested `choice` on the
 * wire the wizard offers Divine Order, reports the step complete, and the server refuses the build.
 * Riders (actions, grants, modifiers, uses) deliberately stay server-side - the server applies them.
 */
export type ContentFeatureOptionSummary = Readonly<{ id: string; name: string; description: string; choice: ContentFeatureChoiceSummary | null }>;
export type ContentFeatureChoiceSummary = Readonly<{ kind: string; choose: number; from: readonly string[]; fromCatalog: string | null;
  /** Ceiling on a spell pick's level (Evocation Savant is level 2 and under; Magic Initiate is cantrips only). Null = no ceiling. WITHOUT this the wizard would offer spells the server then rejects, so it crosses the wire with the rest of the choice. */
  maxSpellLevel: number | null;
  /** Inline options with their names and any nested pick. Empty when the options come from `fromCatalog` or are plain ids in `from`. */
  options: readonly ContentFeatureOptionSummary[] }>;
export type ContentFeatureSummary = Readonly<{ id: string; name: string; level: number | null; description: string; tags: readonly string[]; /** The pick this feature asks for (open `kind` slug: fighting-style, skill, asi, ...), or null. Each pick writes a `choices[]` ledger row. */ choice: ContentFeatureChoiceSummary | null; /**
 * EVERY level at which the owning class's table grants this feature - the authoritative repeat
 * count. A feature granted at 4, 8, 12 and 16 asks its choice FOUR times, and the server's capacity
 * is `choose x grants` (`character-build.ts` grantedClassFeatures), so a client that cannot see the
 * repeats offers too few picks and the build is rejected at Create.
 *
 * The client used to infer this, and only for `asi-or-feat`, from `asiLevels`. That covered the SRD
 * classes that existed at the time and silently under-offered for every other repeated choice - a
 * Rogue's Expertise (levels 1 and 6) and a Sorcerer's Metamagic (2, 10, 17) are both repeats that
 * are not ASIs, and a homebrew class may repeat any choice at all. Empty for a feature that is not
 * granted by a class level table (species traits, feats, subclass features).
 */
grantedAtLevels: readonly number[] }>;
/**
 * ONE row of a class's printed 20-level table - the display data the wizard renders when a player
 * previews "what do I get at level 7?": slot columns, cantrips/spells known, the prepared-spell
 * formula, and the named class resources that grow with level (Second Wind 2 → 4, Rage 3, Sneak
 * Attack 3d6). `null` means "this class has no such column", never zero.
 *
 * DISPLAY ONLY. The structured feature riders (granted actions, effects, modifiers, limited uses)
 * stay on the server-side bundle record: the server applies them when it builds the character, so the
 * wizard cannot become a second, divergent rules engine (CLAUDE.md rule 2).
 */
export type ContentClassLevelRow = Readonly<{ level: number; proficiencyBonus: number; spellSlots: readonly number[] | null; pactSlots: Readonly<{ level: number; slots: number }> | null; cantripsKnown: number | null; spellsKnown: number | null; preparedFormula: string | null; preparedCount: number | null; classResources: ReadonlyArray<{ id: string; name: string; amount: number | string }> }>;
/** A named starting-equipment bundle with its RESOLVABLE contents - a label alone can be shown but never turned into inventory. `goldPieces` is the "or take N gp" alternative. */
export type ContentStartingEquipmentOption = Readonly<{ id: string; label: string; items: ReadonlyArray<{ id: string; name: string; quantity: number }>; goldPieces: number }>;
/** A "choose N from this list" proficiency grant, exactly as authored (class tool choices, background skill/tool/language choices). */
export type ContentChoiceList = Readonly<{ choose: number; from: readonly string[] }>;
/**
 * A class's (or third-caster subclass's) spellcasting header - what the wizard's caster step renders
 * and filters by. `spellListId` pairs with `ContentSpellSummary.classes` to restore the class->spell
 * link on the wire; the prepared-spell FORMULA stays per-level on the level table. Structured feature
 * riders remain server-side as ever.
 */
export type ContentSpellcastingSummary = Readonly<{ ability: string; prepares: "known" | "prepared"; ritual: boolean; focus: string | null; progression: "full" | "half" | "third" | "pact"; spellListId: string | null }>;
/** One playable class. `hitDie` ("d10") keys the multiclass hit-dice pool, `statPriority` drives the random generator, `spellcasting.progression` is what a multiclass slot table sums, and `levelTable` is the full printed 20-row progression. The flat `spellcastingAbility`/`spellcastingProgression` mirror `spellcasting` for existing readers. */
export type ContentClassSummary = Readonly<{ id: string; name: string; source: ContentSourceKind; summary: string | null; description: string | null; hitDie: string; statPriority: readonly string[]; primaryAbilities: readonly string[]; savingThrows: readonly string[]; skillChoiceCount: number; skillChoices: readonly string[];
  /** Granted armor/weapon/tool training, as open slugs ("light", "martial", "thieves-tools") - the wizard's proficiency summary renders these verbatim. */
  armorProficiencies: readonly string[]; weaponProficiencies: readonly string[]; toolProficiencies: readonly string[];
  /** "Choose N tools" where the class offers one (Monk-style); null otherwise. */
  toolChoices: ContentChoiceList | null;
  /** Proficiencies gained when this class is taken as a MULTICLASS (narrower than the level-1 set); null when the record declares none. */
  multiclassProficiencies: Readonly<{ armor: readonly string[]; weapons: readonly string[]; tools: readonly string[]; skillChoices: ContentChoiceList | null }> | null;
  /** Ability minimums for multiclassing INTO this class; `mode: "any"` covers "STR 13 or DEX 13". null = none declared (always allowed). The server re-validates - this is display data. */
  multiclassPrerequisites: Readonly<{ mode: "all" | "any"; minimums: ReadonlyArray<Readonly<{ ability: string; minimum: number }>> }> | null;
  subclassLevel: number; subclassLabel: string | null; asiLevels: readonly number[]; spellcastingAbility: string | null; spellcastingProgression: "full" | "half" | "third" | "pact" | null;
  /** The full spellcasting header (null for a non-caster); see ContentSpellcastingSummary. */
  spellcasting: ContentSpellcastingSummary | null;
  levelTable: readonly ContentClassLevelRow[]; startingEquipmentOptions: readonly ContentStartingEquipmentOption[]; features: readonly ContentFeatureSummary[] }>;
export type ContentClassesResult = { ok: boolean; message?: string; classes?: readonly ContentClassSummary[]; attribution?: string };
/** One subclass, keyed to its parent `classId`. `subclassLevel` is null when it simply inherits the class's own subclass level. */
export type ContentSubclassSummary = Readonly<{ id: string; name: string; source: ContentSourceKind; classId: string; summary: string | null; description: string | null; subclassLevel: number | null; spellcastingAbility: string | null; spellcastingProgression: "full" | "half" | "third" | "pact" | null;
  /** Third-caster subclasses (Eldritch Knight, Arcane Trickster) declare their own header, same shape as a class's; null otherwise. */
  spellcasting: ContentSpellcastingSummary | null;
  features: readonly ContentFeatureSummary[] }>;
export type ContentSubclassesResult = { ok: boolean; message?: string; subclasses?: readonly ContentSubclassSummary[]; attribution?: string };
/** One playable species and its traits-as-data. `sizes` is a list because several 2024 species let the player pick. SRD 5.2.1 puts ability increases on the BACKGROUND, so a species usually grants none. */
export type ContentSpeciesSummary = Readonly<{ id: string; name: string; source: ContentSourceKind; summary: string | null; description: string | null; sizes: readonly string[]; speedFeet: number; darkvisionFeet: number | null; creatureType: string;
  /** Fixed ability increases, as data. Empty for every SRD 5.2.1 species (they live on the background); populated by 2014-style or homebrew records - the builder applies whatever the record declares. */
  abilityBonuses: ReadonlyArray<Readonly<{ ability: string; amount: number }>>;
  /** "Choose N abilities to raise by M" (the 2014 variant-human / half-elf pattern); null when the species has none. */
  abilityBonusChoice: Readonly<{ choose: number; amount: number; from: readonly string[] }> | null;
  languages: readonly string[];
  /** "Choose N languages" where the species offers one; null otherwise. */
  languageChoices: ContentChoiceList | null;
  lineages: ReadonlyArray<{ id: string; name: string; description: string | null }>; features: readonly ContentFeatureSummary[] }>;
export type ContentSpeciesResult = { ok: boolean; message?: string; species?: readonly ContentSpeciesSummary[]; attribution?: string };
/** One background: the ability-increase options and proficiencies it grants, its origin feat, and its starting-equipment choices (chosen option recorded in the character's `choices[]` ledger). */
export type ContentBackgroundSummary = Readonly<{ id: string; name: string; source: ContentSourceKind; summary: string | null; description: string | null; abilityOptions: Readonly<{ from: readonly string[]; spreads: ReadonlyArray<readonly number[]> }> | null; originFeatId: string | null; skillProficiencies: readonly string[];
  /** "Choose N skills/tools/languages" where the background offers one; null otherwise. Fixed grants stay in the flat lists beside these. */
  skillChoices: ContentChoiceList | null;
  toolProficiencies: readonly string[]; toolChoices: ContentChoiceList | null; languages: readonly string[]; languageChoices: ContentChoiceList | null;
  startingEquipmentOptions: readonly ContentStartingEquipmentOption[]; features: readonly ContentFeatureSummary[] }>;
export type ContentBackgroundsResult = { ok: boolean; message?: string; backgrounds?: readonly ContentBackgroundSummary[]; attribution?: string };
/** One skill: reference text plus the ability its check uses. `ability` is null only while the bundle row predates the ability column (the server fills the SRD mapping for the 18 known skills). */
export type ContentSkillSummary = Readonly<{ id: string; name: string; description: string; ability: string | null }>;
export type ContentSkillsResult = { ok: boolean; message?: string; skills?: readonly ContentSkillSummary[]; attribution?: string };
/** One feat. Prerequisites are reported as data + prose for display; the SERVER decides whether one is met, never the wizard. A feat IS a feature plus catalog metadata - hence the single `feature`. */
export type ContentFeatSummary = Readonly<{ id: string; name: string; source: ContentSourceKind; summary: string | null; description: string | null; category: string; repeatable: boolean; prerequisiteLevel: number | null; prerequisiteAbilities: ReadonlyArray<{ ability: string; minimum: number }>; prerequisiteRequires: readonly string[]; prerequisiteText: string | null; feature: ContentFeatureSummary }>;
export type ContentFeatsResult = { ok: boolean; message?: string; feats?: readonly ContentFeatSummary[]; attribution?: string };
/** Hand-authored name pools for one species, feeding the builder's random generator. Pool `id` is an open slug and pool order comes from the data, so new pools are additive. */
export type ContentNameBundle = Readonly<{ speciesId: string; source: ContentSourceKind; pools: ReadonlyArray<{ id: string; label: string; names: readonly string[] }> }>;
export type ContentNamesResult = { ok: boolean; message?: string; names?: readonly ContentNameBundle[]; attribution?: string };
/** An area of effect parsed from a definition action's prose ("60-foot Cone", etc.); the GM places a matching template on the map. */
export type ContentActionArea = Readonly<{ shape: "cone" | "line" | "sphere" | "cube" | "emanation"; sizeFeet: number; widthFeet: number | null }>;
/** A definition action flattened for the GM's action runner. Structured fields only where the content has them; the ADR-0020 mechanics fields power availability hints (the server stays the authority). */
export type ContentActionSummary = Readonly<{ id: string; name: string; activation: "action" | "bonus-action" | "reaction" | "other"; description: string; attackBonus: number | null; reachFeet: number | null; rangeFeet: number | null; /** Normal range band for two-range weapons; shots beyond it (up to rangeFeet) roll at disadvantage. */ rangeNormalFeet: number | null; saveAbility: string | null; saveDc: number | null; damage: ReadonlyArray<{ formula: string; type: string }>; area: ContentActionArea | null; attackCount: number | null; usesLimit: number | null; usesPer: "turn" | "encounter" | "long-rest" | "short-rest" | "recharge" | null; /** d6 threshold for usesPer "recharge" ("Recharge 5-6" → 5); rolled automatically at the start of the owner's turn. */ usesRecharge: number | null; usesPool: string | null; requiresEffectTag: string | null; multiattack: ReadonlyArray<{ actionId: string; count: number }> | null; grants: boolean; reaction: Readonly<{ trigger: "hit-by-attack"; response: "half-damage" }> | null; /** SRD generic action rows (Dodge, Dash, Help, ...) appended after the stat block's own. */ builtin?: boolean; /** Builtin targeting: "single" picks one combatant, "none" is a direct tap. */ targeting?: "single" | "none"; /** SRD Legendary Action cost against the creature's per-round pool (taken on other creatures' turns). */ legendaryCost?: number }>;
export type ContentActionsResult = { ok: boolean; message?: string; actions?: readonly ContentActionSummary[]; /** The definition's legendary resources, when it has any (SRD 2024 legendary creatures). */ legendary?: Readonly<{ actionsPerRound?: number; resistancesPerDay?: number }> };
/** Full stat-block payload for the GM's sheet view; inert content data, GM-gated. */
export type ContentSheetResult = { ok: boolean; message?: string; definition?: import("@vtt/schemas").ActorDefinition };
/** Server-computed outcome of resolving a definition action (rolls already recorded in the roll history). */
export type ActionResolutionAttack = Readonly<{ targetId: string; targetName: string; total: number; naturalRoll: number; targetAc: number | null; outcome: "crit" | "hit" | "miss" | "fumble" | "unknown"; /** Cover's AC bonus folded into targetAc (SRD Cover: +2 half, +5 three-quarters). */ coverBonus?: number }>;
/** Why an attack rolled with advantage/disadvantage - every contributing source, so the table can see the math (ADR-0020 explainability). */
export type ActionRollMode = Readonly<{ mode: "advantage" | "disadvantage" | "normal"; advantage: readonly string[]; disadvantage: readonly string[] }>;
export type ActionResolution = Readonly<{
  actionName: string;
  activation: "action" | "bonus-action" | "reaction" | "other";
  attack: ActionResolutionAttack | null;
  save: { ability: string; dc: number; targets: ReadonlyArray<{ targetId: string; targetName: string }> } | null;
  damage: ReadonlyArray<{ formula: string; type: string; total: number }>;
  damageTotal: number;
  crit: boolean;
  /** Advantage/disadvantage aggregation for the attack roll; absent when nothing contributed (plain 1d20). */
  rollMode?: ActionRollMode;
  /** Flat typed damage added by active effects (Rage +2 melee), included in damageTotal. */
  bonusDamage?: ReadonlyArray<{ amount: number; type: string; source: string }>;
  /** Source-linked effects the hit applied to targets (Bite: Grappled + Restrained). */
  effectsApplied?: ReadonlyArray<{ targetId: string; targetName: string; name: string; conditionIds: readonly string[] }>;
  /** The self effect this action granted (Rage, Reckless Attack). */
  effectGranted?: Readonly<{ name: string; tags: readonly string[] }> | null;
  /** Remaining components of the open compound action after this resolve ("Attack 2 of 2" UI). */
  componentsRemaining?: Readonly<Record<string, number>> | null;
  /** Assisted-mode rule conflicts that were allowed through (also logged). */
  warnings?: readonly string[];
  /** Present when the GM overrode a strict-mode rejection; the override is logged and journaled. */
  overridden?: Readonly<{ rule: string; reason: string }> | null;
  /** Reaction prompts this hit opened (Uncanny Dodge): the triggering damage waits on the answer instead of the apply button. */
  reactionPrompts?: ReadonlyArray<Readonly<{ actorId: string; actorName: string; actionName: string }>>;
  /** A builtin action's check roll (Hide vs DC 15; Influence/Search/Study with dc/success null - GM adjudicates). */
  check?: Readonly<{ skill: string; total: number; naturalRoll: number; dc: number | null; success: boolean | null }> | null;
  /** Effects this resolve ended as a rule consequence (attacking revealed Hiding; an off-turn action released a Ready). */
  effectsEnded?: ReadonlyArray<Readonly<{ actorId: string; actorName: string; name: string }>>;
  /** true when this is an attack-roll PREVIEW: the d20 is rolled and shown but nothing is applied yet (no damage,
   * riders, prompts, or economy) - the answerer re-rolls adv/disadv or confirms, which resolves for real. */
  preview?: boolean;
}>;
/** A strict-mode rules rejection: what rule blocked the command and whether an override may bypass it. */
export type RulesBlocked = Readonly<{ rule: string; message: string; overridable: boolean }>;
export type ActionResolveResult = MutationResult & { resolution?: ActionResolution };
/**
 * Server-computed application of typed damage: per-part defense adjustments (immunity → resistance →
 * vulnerability), temp-HP absorption, and any zero-HP transition - the explainable "17 → 8" record.
 */
export type DamageApplication = Readonly<{
  totalRequested: number;
  totalApplied: number;
  parts: ReadonlyArray<{ type: string; amount: number; adjusted: number; adjustment: "resistance" | "immunity" | "vulnerability" | null; adjustmentSource: string | null }>;
  temporaryAbsorbed: number;
  hpBefore: number;
  hpAfter: number;
  /** Zero-HP machine outcomes (player characters). */
  droppedToZero: boolean;
  deathSaveFailuresAdded: number;
  instantDeath: boolean;
  /** A non-PC hit 0 HP: effects it sustained were ended (grapples released). */
  defeated: boolean;
}>;
export type DamageApplyResult = MutationResult & { applied?: DamageApplication };
export type DeathSaveResult = MutationResult & { deathSave?: Readonly<{ naturalRoll: number; outcome: "success" | "failure" | "critical-success" | "critical-failure"; successes: number; failures: number; stable: boolean; dead: boolean; regainedConsciousness: boolean; /** false = previewed only (pips unchanged, awaiting confirmation); true = applied. */ committed: boolean; /** The d20 mode when adv/disadv was chosen; absent for a plain roll. */ rollMode?: "advantage" | "disadvantage" | "normal" }> };
/** Outcome of answering a pending save; applied damage/condition already happened server-side when present. */
export type SaveAnswerResult = MutationResult & { outcome?: { success: boolean; total: number; dc: number; appliedDamage: number; conditionApplied: boolean; committed: boolean; /** Condition id that forced an automatic failure (Paralyzed on a Dex save); null/absent when rolled. */ autoFailed?: string | null; /** Advantage/disadvantage sources that shaped the save roll (Restrained, Dodge). */ rollMode?: ActionRollMode } };
/** Outcome of answering a reaction prompt; the (halved or full) damage already applied server-side. A used opportunity attack carries its full attack `resolution`. */
export type ReactionAnswerResult = MutationResult & { outcome?: { used: boolean; appliedDamage: number; resolution?: ActionResolution } };
/** One action's strict-mode availability for an actor, with every violated rule named (server-computed; ADR-0020 explainability). */
export type ActionAvailability = Readonly<{
  id: string;
  name: string;
  activation: "action" | "bonus-action" | "reaction" | "other";
  /** Whether strict mode would allow resolving this action right now (target-specific rules can't be pre-checked). */
  available: boolean;
  violations: ReadonlyArray<{ rule: string; message: string }>;
  /** Limited-use spending left in the current scope; null when the action has no use limit. */
  usesRemaining: number | null;
  /** Rolls left in the open compound-action instance for this action; null when no instance applies. */
  componentsRemaining: number | null;
  /** True for the SRD generic actions every combatant can take (Dodge, Dash, Help, ...) - not on the stat block. */
  builtin?: boolean;
}>;
/**
 * The sheet's own numbers, derived server-side from the actor's LIVE loadout.
 *
 * Deliberately not on `PlayerView`: it rides `actor:available-actions`, a request that authorizes
 * its caller for one named actor, so it is covered by one existing gate rather than by a strip that
 * has to be right in both `projections.ts` and `PlayerActor` on every tick. See `actor-derived.ts`.
 */
export type DerivedAbilityRow = Readonly<{ ability: AbilityId; check: number; checkWithProficiency: number; save: number; saveProficient: boolean; saveFromItems: number }>;
/** `tier` is the EFFECTIVE tier: the sheet's base raised by any item grant. `sources` names the items that raised it. */
export type DerivedSkillRow = Readonly<{ id: string; name: string; ability: AbilityId | null; tier: "none" | "proficient" | "expertise"; bonus: number | null; sources: readonly string[] }>;
export type ActorDerivedSheet = Readonly<{ proficiencyBonus: number; armorClass: number; initiative: number; abilities: readonly DerivedAbilityRow[]; skills: readonly DerivedSkillRow[] }>;
export type ActorActionsAvailabilityResult = { ok: boolean; message?: string; rulesMode?: "strict" | "assisted" | "freeform"; actions?: readonly ActionAvailability[]; derived?: ActorDerivedSheet };
export interface ClientToServerEvents {
  "session:join": (payload: { token?: string }, acknowledgement: (result: SessionJoinResult) => void) => void;
  "character:claim": (payload: { commandId: string; actorId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "character:release": (payload: { commandId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "character:force-release": (payload: { commandId: string; actorId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "content:monsters": (payload: Record<string, never>, acknowledgement: (result: ContentMonstersResult) => void) => void;
  /** `joinEncounter` drops the new combatant straight into the running fight (roster + initiative + tray token) in ONE command - the mid-fight "add monsters" trap was that the roster add and the fight join were two separate trips. Ignored when no fight is running. */
  "actor:add-from-definition": (payload: { commandId: string; definitionId: string; visibility?: "public" | "gm-only"; joinEncounter?: boolean; expectedRevision?: number }, acknowledgement: (result: ActorAddResult) => void) => void;
  "actor:remove": (payload: { commandId: string; actorId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "actor:import-definition": (payload: { commandId: string; definition: unknown; visibility?: "public" | "gm-only"; expectedRevision?: number }, acknowledgement: (result: ActorAddResult) => void) => void;
  "character:submit-import": (payload: { commandId: string; definition: unknown; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "character:resolve-import": (payload: { commandId: string; importId: string; approve: boolean; expectedRevision?: number }, acknowledgement: (result: ActorAddResult) => void) => void;
  /** Create a character from CHOICES (ids + scores + per-level HP entries + the choices[] ledger); the server's feature-rider interpreter assembles the ActorDefinition and lands it through the import path (`actorId` = commandId, definition keyed `import-<actorId>`). GM-only in phase 2. */
  "character:create": (payload: { commandId: string; name: string; speciesId: string; backgroundId: string; classId: string; level: number; subclassId?: string; abilityMethod: BuilderAbilityMethod; baseScores: Record<AbilityId, number>; backgroundBonusAllocation: ReadonlyArray<{ ability: AbilityId; amount: number }>; hp: { mode: "average" | "entries"; entries?: readonly number[] }; choices: ReadonlyArray<{ level: number; classId?: string; kind: string; id: string; payload?: Record<string, unknown> }>; expectedRevision?: number }, acknowledgement: (result: ActorAddResult) => void) => void;
  /** GM sets the character-builder table policy (decision 10): allowed ability methods + the custom roll formula. */
  "builder:set-policy": (payload: { commandId: string; allowedAbilityMethods: readonly BuilderAbilityMethod[]; customFormula?: string | null; maxLevel?: number; playerBuilder?: "open" | "gm-only"; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  /** GM sets the STANDING rules policy every new fight inherits (D7): the dial plus per-family exceptions. Omitted `exceptions` keeps the stored ones. */
  "rules:set-policy": (payload: { commandId: string; dial: RuleMode; exceptions?: RuleExceptions; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  /**
   * THE TAP IS THE ATTACK (D10). One command for "use this action"; the ack's `route` says what the
   * server did - `resolved` (in the fight, on this creature's turn), or `loose` (no fight, or this
   * creature is not in it) with the roll ids. Off turn it comes back `blocked` like any rules refusal,
   * which is what makes it overridable by the GM and askable by the player.
   */
  "action:use": (payload: { commandId: string; actorId: string; actionId: string; targetIds?: readonly string[]; rollMode?: "advantage" | "disadvantage" | "normal"; includeDamage?: boolean; expectedRevision?: number }, acknowledgement: (result: MutationResult & { route?: "resolved" | "loose"; rollIds?: readonly string[]; warning?: string }) => void) => void;
  /** Roll a saving throw (D10): answers a matching pending save when one is open (`route: "answered"`), otherwise a loose attributed save (`route: "loose"`). */
  "save:roll": (payload: { commandId: string; actorId: string; ability: AbilityId; rollMode?: "advantage" | "disadvantage" | "normal"; total?: number; expectedRevision?: number }, acknowledgement: (result: MutationResult & { route?: "answered" | "loose"; saveId?: string; rollId?: string }) => void) => void;
  /**
   * ASK THE GM (D8). A player whose command came back `blocked` sends the SAME command here; the server
   * re-runs it under their own authority first, so an ask that would now succeed just succeeds
   * (`ran: true`), and only a still-blocked command is parked for the GM (`askId`).
   */
  "rules:ask": (payload: { commandId: string; type: AskableCommand; payload: unknown; expectedRevision?: number }, acknowledgement: (result: MutationResult & { askId?: string; ran?: boolean }) => void) => void;
  /** GM answers a parked ask in one tap (D9): Allow re-runs the parked command with an override (reason optional), Deny tells the player. */
  "rules:answer": (payload: { commandId: string; askId: string; allow: boolean; reason?: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  /** GM sets the table's staging defaults (D2): what visibility a newly staged combatant's token starts at. */
  "table:set-staging-defaults": (payload: { commandId: string; visibility: "public" | "gm-only"; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "actor:set-token-image": (payload: { commandId: string; actorId: string; tokenAssetId: string | null; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "actor:set-size": (payload: { commandId: string; actorId: string; size: "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan"; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "actor:set-visibility": (payload: { commandId: string; actorId: string; visibility: "public" | "gm-only"; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "actor:set-archived": (payload: { commandId: string; actorId: string; archived: boolean; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  /** GM shares (or un-shares) an ARCHIVED character's sheet with players as a read-only keepsake (D26). Default hidden. */
  "actor:set-sheet-preview": (payload: { commandId: string; actorId: string; enabled: boolean; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "actor:set-speed": (payload: { commandId: string; actorId: string; speedFeet: number | null; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "actor:apply-damage": (payload: { commandId: string; actorId: string; amount: number; parts?: ReadonlyArray<{ amount: number; type: string }>; sourceActorId?: string; sourceActionId?: string; sourceName?: string; critical?: boolean; nonlethal?: boolean; expectedRevision?: number }, acknowledgement: (result: DamageApplyResult) => void) => void;
  "actor:heal": (payload: { commandId: string; actorId: string; amount: number; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "actor:set-temp-hp": (payload: { commandId: string; actorId: string; amount: number; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "actor:set-hp": (payload: { commandId: string; actorId: string; current: number; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "actor:set-condition": (payload: { commandId: string; actorId: string; conditionId: string; active: boolean; level?: number; override?: { reason?: string }; expectedRevision?: number }, acknowledgement: (result: MutationResult & { blocked?: RulesBlocked }) => void) => void;
  "content:conditions": (payload: Record<string, never>, acknowledgement: (result: ContentConditionsResult) => void) => void;
  "content:skills": (payload: Record<string, never>, acknowledgement: (result: ContentSkillsResult) => void) => void;
  "content:spells": (payload: Record<string, never>, acknowledgement: (result: ContentSpellsResult) => void) => void;
  "content:equipment": (payload: Record<string, never>, acknowledgement: (result: ContentEquipmentResult) => void) => void;
  "content:classes": (payload: Record<string, never>, acknowledgement: (result: ContentClassesResult) => void) => void;
  "content:subclasses": (payload: Record<string, never>, acknowledgement: (result: ContentSubclassesResult) => void) => void;
  "content:species": (payload: Record<string, never>, acknowledgement: (result: ContentSpeciesResult) => void) => void;
  "content:backgrounds": (payload: Record<string, never>, acknowledgement: (result: ContentBackgroundsResult) => void) => void;
  "content:feats": (payload: Record<string, never>, acknowledgement: (result: ContentFeatsResult) => void) => void;
  "content:names": (payload: Record<string, never>, acknowledgement: (result: ContentNamesResult) => void) => void;
  "content:monster-actions": (payload: { definitionId: string }, acknowledgement: (result: ContentActionsResult) => void) => void;
  "content:monster-sheet": (payload: { definitionId: string }, acknowledgement: (result: ContentSheetResult) => void) => void;
  "action:resolve": (payload: { commandId: string; actorId: string; actionId: string; targetIds?: readonly string[]; template?: { shape: AnnotationShapeKind; origin: AnnotationPoint; target: AnnotationPoint }; conditionId?: string; rollMode?: "advantage" | "disadvantage" | "normal"; override?: { reason?: string }; effectId?: string; note?: string; cover?: "half" | "three-quarters" | "total"; commit?: boolean; attackNatural?: number; attackTotal?: number; critical?: boolean; expectedRevision?: number }, acknowledgement: (result: ActionResolveResult) => void) => void;
  "effect:add": (payload: { commandId: string; actorId: string; name: string; tags?: readonly string[]; duration?: { type: "rounds"; rounds: number } | { type: "until-source-next-turn" } | { type: "encounter" } | { type: "manual" }; modifiers?: readonly EffectModifier[]; expectedRevision?: number }, acknowledgement: (result: MutationResult & { effectId?: string }) => void) => void;
  "effect:end": (payload: { commandId: string; actorId: string; effectId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "death-save:roll": (payload: { commandId: string; actorId: string; commit?: boolean; rollMode?: "advantage" | "disadvantage" | "normal"; naturalRoll?: number; expectedRevision?: number }, acknowledgement: (result: DeathSaveResult) => void) => void;
  "encounter:set-rules-mode": (payload: { commandId: string; mode: RuleMode; exceptions?: RuleExceptions; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "encounter:set-player-damage-mode": (payload: { commandId: string; mode: "proposal" | "direct"; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "encounter:set-player-initiative-mode": (payload: { commandId: string; mode: "immediate" | "wait"; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "encounter:set-health-display": (payload: { commandId: string; style: "band" | "bar" | "ring" | "aura"; audience: "gm" | "all"; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "actor:set-health-display": (payload: { commandId: string; actorId: string; display: { style: "band" | "bar" | "ring" | "aura"; audience: "gm" | "all" } | null; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "encounter:set-environment": (payload: { commandId: string; underwater: boolean; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "actor:rest": (payload: { commandId: string; actorId: string; kind: "long" | "short"; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "actor:spend-hit-dice": (payload: { commandId: string; actorId: string; count: number; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "character:set-slot": (payload: { commandId: string; actorId: string; level: number; remaining: number; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "character:set-prepared": (payload: { commandId: string; actorId: string; spellId: string; prepared: boolean; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "character:set-inventory": (payload: { commandId: string; actorId: string; item: { id: string; name: string; quantity?: number; equipped?: boolean; attuned?: boolean; weightEach?: number; description?: string; category?: string }; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "character:set-currency": (payload: { commandId: string; actorId: string; currency: { cp?: number; sp?: number; ep?: number; gp?: number; pp?: number }; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  // `classes[].hitDie` carries the per-class hit die so an identity edit REBUILDS the multiclass
  // hit-dice pool instead of dropping it (a Fighter 3 / Wizard 2 is 3d10 + 2d6, not 5 of one size).
  "character:set-identity": (payload: { commandId: string; actorId: string; character: { classes: ReadonlyArray<{ id: string; name: string; subclass?: { id: string; name: string }; level: number; hitDie?: HitDie }>; race?: { id: string; name: string; subrace?: { id: string; name: string } }; background?: { id: string; name: string }; feats: ReadonlyArray<{ id: string; name: string; description?: string }> }; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "character:set-proficiencies": (payload: { commandId: string; actorId: string; proficiencies: { saves: ReadonlyArray<"str" | "dex" | "con" | "int" | "wis" | "cha">; skills: ReadonlyArray<{ id: string; proficiency: "proficient" | "expertise" }>; saveOverrides?: Record<string, number>; skillOverrides?: Record<string, number> }; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "save:answer": (payload: { commandId: string; saveId: string; method: "roll" | "manual"; total?: number; rollMode?: "advantage" | "disadvantage" | "normal"; commit?: boolean; legendaryResistance?: boolean; expectedRevision?: number }, acknowledgement: (result: SaveAnswerResult) => void) => void;
  "save:dismiss": (payload: { commandId: string; saveId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "reaction:answer": (payload: { commandId: string; reactionId: string; use: boolean; actionId?: string; commit?: boolean; rollMode?: "advantage" | "disadvantage" | "normal"; attackNatural?: number; expectedRevision?: number }, acknowledgement: (result: ReactionAnswerResult) => void) => void;
  "reaction:dismiss": (payload: { commandId: string; reactionId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "damage:resolve": (payload: { commandId: string; proposalId: string; apply: boolean; amount?: number; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "actor:available-actions": (payload: { actorId: string }, acknowledgement: (result: ActorActionsAvailabilityResult) => void) => void;
  "turn:use": (payload: { commandId: string; slot: "action" | "bonus-action"; used: boolean; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "turn:use-reaction": (payload: { commandId: string; actorId: string; used: boolean; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "turn:use-legendary": (payload: { commandId: string; actorId: string; spent: number; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "turn:end": (payload: { commandId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "dice:roll": (payload: { commandId: string; formula: string; purpose: RollPurpose; visibility: RollVisibility; label?: string; actorId?: string; expectedRevision?: number }, acknowledgement: (result: DiceRollResult) => void) => void;
  "encounter:start": (payload: { commandId: string; mapAssetId: string; /** Omit while a prepared scene is live to start on exactly the combatants staged in it - the server owns "who is in the staged fight", not the client's copy of the list. */ entries?: readonly EncounterStartEntry[]; playersRollInitiative?: boolean; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "encounter:end": (payload: { commandId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "encounter:add-combatant": (payload: { commandId: string; actorId: string; score?: number; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "initiative:set": (payload: { commandId: string; actorId: string; score: number; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "initiative:roll-self": (payload: { commandId: string; actorId: string; natural?: number; rollMode?: "advantage" | "disadvantage" | "normal"; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "initiative:roll-remaining": (payload: { commandId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "initiative:next": (payload: { commandId: string; confirmRewrite?: boolean; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "initiative:previous": (payload: { commandId: string; confirmDiscard?: boolean; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "log:read": (payload: Record<string, never>, acknowledgement: (result: { ok: boolean; message?: string; entries?: readonly CombatLogEntry[] }) => void) => void;
  "token:move": (payload: { commandId: string; actorId: string; position: EncounterTokenPosition | null; sceneId?: string; override?: { reason?: string }; expectedRevision?: number }, acknowledgement: (result: MutationResult & { blocked?: RulesBlocked }) => void) => void;
  "scene:create": (payload: { commandId: string; name: string; mapAssetId: string; combatantIds: readonly string[]; /** Go live on the new scene in the same command (prepare-and-go), parking whatever was live. */ activate?: boolean; expectedRevision?: number }, acknowledgement: (result: SceneCreateResult) => void) => void;
  "scene:rename": (payload: { commandId: string; sceneId: string; name: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "scene:remove": (payload: { commandId: string; sceneId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "scene:activate": (payload: { commandId: string; sceneId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "scene:set-combatants": (payload: { commandId: string; sceneId: string; combatantIds: readonly string[]; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "scene:duplicate": (payload: { commandId: string; sceneId: string; expectedRevision?: number }, acknowledgement: (result: SceneCreateResult) => void) => void;
  "scene:reorder": (payload: { commandId: string; order: readonly string[]; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "fog:set-enabled": (payload: { commandId: string; enabled: boolean; sceneId?: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "fog:paint": (payload: { commandId: string; op: "reveal" | "hide"; rect: { x: number; y: number; width: number; height: number }; sceneId?: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "fog:reset": (payload: { commandId: string; sceneId?: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "annotation:add": (payload: { commandId: string; kind: "measurement" | "shape"; shape?: AnnotationShapeKind; geometry: AnnotationGeometryInput; visibility?: AnnotationVisibility; visibleToActorId?: string | null; movableByOthers?: boolean; color?: string; expectedRevision?: number }, acknowledgement: (result: AnnotationAddResult) => void) => void;
  "annotation:ping": (payload: { commandId: string; point: AnnotationPoint; color?: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "annotation:set-color": (payload: { commandId: string; id: string; color: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "annotation:move": (payload: { commandId: string; id: string; geometry: AnnotationGeometryInput; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "annotation:remove": (payload: { commandId: string; id: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "annotation:set-visibility": (payload: { commandId: string; id: string; visibility: AnnotationVisibility; visibleToActorId?: string | null; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "annotation:set-movable": (payload: { commandId: string; id: string; movableByOthers: boolean; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "annotation:clear": (payload: { commandId: string; scope: "mine" | "players" | "all"; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
}
