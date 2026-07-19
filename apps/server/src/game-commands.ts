import { z } from "zod";
import { AnnotationPointSchema, AnnotationShapeKindSchema, AnnotationVisibilitySchema, EncounterTokenPositionSchema, RollPurposeSchema, RollVisibilitySchema } from "@vtt/domain";

/**
 * Wire schemas for every game command, shared by BOTH transports: the Socket.IO handlers in
 * `server.ts` and the public HTTP API (`game-http.ts`) parse requests with these exact schemas, so
 * the two surfaces can never drift apart on what a command accepts. `commandId` doubles as the
 * idempotency receipt key in the store; `expectedRevision` is the optimistic-concurrency guard.
 *
 * Per-command credential scopes are public contract and live in `@vtt/api-contract`
 * (`GAME_COMMAND_SCOPES`); they are re-exported here for the registry and routes.
 */
export { GAME_COMMAND_SCOPES, type GameCommandType } from "@vtt/api-contract";

export const CommandIdentitySchema = z.object({ commandId: z.string().uuid(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
// Turn navigation carries an optional confirmation flag: Next may rewrite history, Previous may discard an in-place change.
export const InitiativeNextSchema = z.object({ commandId: z.string().uuid(), confirmRewrite: z.boolean().optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const InitiativePreviousSchema = z.object({ commandId: z.string().uuid(), confirmDiscard: z.boolean().optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const EncounterStartSchema = z.object({
  commandId: z.string().uuid(),
  mapAssetId: z.string().uuid(),
  entries: z.array(z.object({ actorId: z.string().uuid(), score: z.number().int().min(-1000).max(1000).optional(), /** 2024 surprise: the combatant rolls initiative with disadvantage (SRD Surprise). */ surprised: z.boolean().optional() }).strict()).min(1).max(200),
  /** Rules-engine enforcement for this fight (ADR-0020); omitted keeps the table's current mode. */
  rulesMode: z.enum(["strict", "assisted", "freeform"]).optional(),
  expectedRevision: z.number().int().nonnegative().optional()
}).strict();
export const InitiativeScoreSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), score: z.number().int().min(-1000).max(1000), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const AddCombatantSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), score: z.number().int().min(-1000).max(1000).optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const ActorAddFromDefinitionSchema = z.object({ commandId: z.string().uuid(), definitionId: z.string().regex(/^[a-z0-9-]+$/).max(200), visibility: z.enum(["public", "gm-only"]).default("public"), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const ActorImportDefinitionSchema = z.object({ commandId: z.string().uuid(), definition: z.unknown(), visibility: z.enum(["public", "gm-only"]).default("public"), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const ActorRemoveSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const SetTokenImageSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), tokenAssetId: z.string().uuid().nullable(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const SetActorSizeSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), size: z.enum(["tiny", "small", "medium", "large", "huge", "gargantuan"]), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const HpAmountSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), amount: z.number().int().min(1).max(1000), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/**
 * Damage keeps the legacy untyped `amount` for manual adjustments; the ADR-0020 typed path adds
 * optional `parts` (per-type components the server runs through defenses), the source attribution
 * that makes the log explainable, and the crit flag driving death-save failure ticks.
 */
export const ApplyDamageSchema = z.object({
  commandId: z.string().uuid(),
  actorId: z.string().uuid(),
  amount: z.number().int().min(1).max(1000),
  parts: z.array(z.object({ amount: z.number().int().min(0).max(1000), type: z.string().min(1).max(40) }).strict()).min(1).max(9).optional(),
  sourceActorId: z.string().uuid().optional(),
  sourceActionId: z.string().regex(/^[a-z0-9-]+$/).max(120).optional(),
  sourceName: z.string().min(1).max(120).optional(),
  critical: z.boolean().optional(),
  /** Knocking out a creature (SRD): a drop to 0 leaves the target Unconscious and stable instead of dying/defeated. */
  nonlethal: z.boolean().optional(),
  expectedRevision: z.number().int().nonnegative().optional()
}).strict();
export const TempHpSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), amount: z.number().int().min(0).max(1000), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const SetHpSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), current: z.number().int().min(0).max(10000), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const SetConditionSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), conditionId: z.string().regex(/^[a-z0-9-]+$/).max(60), active: z.boolean(), level: z.number().int().min(1).max(6).optional(), /** Bypass a movement-rule rejection (standing from Prone costs half Speed); audited. */ override: z.object({ reason: z.string().trim().min(1).max(300) }).strict().optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const TurnUseSchema = z.object({ commandId: z.string().uuid(), slot: z.enum(["action", "bonus-action"]), used: z.boolean(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const ActionResolveSchema = z.object({
  commandId: z.string().uuid(),
  actorId: z.string().uuid(),
  actionId: z.string().regex(/^[a-z0-9-]+$/).max(120),
  targetIds: z.array(z.string().uuid()).min(1).max(20).optional(),
  template: z.object({ shape: AnnotationShapeKindSchema, origin: AnnotationPointSchema, target: AnnotationPointSchema }).strict().optional(),
  conditionId: z.string().regex(/^[a-z0-9-]+$/).max(60).optional(),
  /** Explicit GM roll-mode choice; wins over the engine's advantage/disadvantage aggregation. */
  rollMode: z.enum(["advantage", "disadvantage", "normal"]).optional(),
  /** Bypass a rules-mode rejection; the reason is audited in the combat log and journal (ADR-0020). */
  override: z.object({ reason: z.string().trim().min(1).max(300) }).strict().optional(),
  /** The escapable effect to break (Escape a Grapple builtin); defaults to the actor's first effect with an escape DC. */
  effectId: z.string().min(1).max(120).optional(),
  /** GM-adjudicated cover for the target (no line-of-sight engine): half +2, three-quarters +5 to AC and Dex saves; total can't be targeted (SRD Cover). */
  cover: z.enum(["half", "three-quarters", "total"]).optional(),
  /** Free-text annotation (the Ready action's trigger), shown in the granted effect's name. */
  note: z.string().trim().min(1).max(100).optional(),
  expectedRevision: z.number().int().nonnegative().optional()
}).strict().refine((payload) => payload.targetIds === undefined || payload.template === undefined, { message: "Provide either explicit targets or an area template, not both." });
export const SaveAnswerSchema = z.object({ commandId: z.string().uuid(), saveId: z.string().uuid(), method: z.enum(["roll", "manual"]), total: z.number().int().min(-20).max(60).optional(), commit: z.boolean().default(true), legendaryResistance: z.boolean().default(false), expectedRevision: z.number().int().nonnegative().optional() }).strict()
  .refine((payload) => payload.method !== "manual" || payload.total !== undefined, { message: "A manual answer needs the rolled total." });
export const SaveDismissSchema = z.object({ commandId: z.string().uuid(), saveId: z.string().uuid(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/** Answer a pending reaction prompt: use (spend the reaction — halve the parked damage, or swing the opportunity attack) or decline. `actionId` picks the melee action for a leaves-reach answer (default: first melee attack, else Unarmed Strike). */
export const ReactionAnswerSchema = z.object({ commandId: z.string().uuid(), reactionId: z.string().uuid(), use: z.boolean(), actionId: z.string().regex(/^[a-z0-9-]+$/).max(120).optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const ReactionDismissSchema = z.object({ commandId: z.string().uuid(), reactionId: z.string().uuid(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/** Read-only availability lookup (no commandId — nothing mutates). */
export const ActorAvailableActionsSchema = z.object({ actorId: z.string().uuid() }).strict();
export const ContentActionsSchema = z.object({ definitionId: z.string().regex(/^[a-z0-9-]+$/).max(200) }).strict();
export const TurnReactionSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), used: z.boolean(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/** GM absolute set of a legendary creature's spent legendary actions this round (manual escape hatch — structured legendary resolves spend automatically; the pool refills at the creature's own turn start). */
export const TurnLegendarySchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), spent: z.number().int().min(0).max(10), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/** GM-added house effect (ADR-0020); structured actions create richer instances via their `grants`/`onHit` declarations. */
export const EffectAddSchema = z.object({
  commandId: z.string().uuid(),
  actorId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  tags: z.array(z.string().regex(/^[a-z0-9-]+$/).max(40)).max(8).optional(),
  duration: z.discriminatedUnion("type", [
    z.object({ type: z.literal("rounds"), rounds: z.number().int().min(1).max(100) }).strict(),
    z.object({ type: z.literal("until-source-next-turn") }).strict(),
    z.object({ type: z.literal("encounter") }).strict(),
    z.object({ type: z.literal("manual") }).strict()
  ]).optional(),
  modifiers: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("damage-bonus"), amount: z.number().int().min(-20).max(20), appliesTo: z.enum(["melee", "all"]).default("all") }).strict(),
    z.object({ type: z.literal("damage-resistance"), damageTypes: z.array(z.string().min(1).max(40)).min(1).max(20) }).strict(),
    z.object({ type: z.literal("attack-advantage") }).strict(),
    z.object({ type: z.literal("incoming-attack-advantage") }).strict(),
    z.object({ type: z.literal("attack-disadvantage") }).strict(),
    z.object({ type: z.literal("incoming-attack-disadvantage") }).strict(),
    z.object({ type: z.literal("save-advantage"), ability: z.enum(["str", "dex", "con", "int", "wis", "cha"]).optional() }).strict(),
    z.object({ type: z.literal("save-disadvantage"), ability: z.enum(["str", "dex", "con", "int", "wis", "cha"]).optional() }).strict()
  ])).max(8).optional(),
  /** The granter concentrates to sustain this effect (SRD Concentration): one at a time; damage prompts a CON save; incapacitation breaks it. */
  concentration: z.boolean().optional(),
  expectedRevision: z.number().int().nonnegative().optional()
}).strict();
export const EffectEndSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), effectId: z.string().min(1).max(120), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const DeathSaveRollSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const SetRulesModeSchema = z.object({ commandId: z.string().uuid(), mode: z.enum(["strict", "assisted", "freeform"]), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const SetEnvironmentSchema = z.object({ commandId: z.string().uuid(), underwater: z.boolean(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/** Manual fog of war (GM-only). `sceneId` targets a parked scene's GM-private prep instead of the live table (the token-move pattern). */
export const FogSetEnabledSchema = z.object({ commandId: z.string().uuid(), enabled: z.boolean(), sceneId: z.string().uuid().optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const FogPaintSchema = z.object({
  commandId: z.string().uuid(),
  op: z.enum(["reveal", "hide"]),
  rect: z.object({ x: z.number().finite().min(-100000).max(1_000_000), y: z.number().finite().min(-100000).max(1_000_000), width: z.number().finite().positive().max(1_000_000), height: z.number().finite().positive().max(1_000_000) }).strict(),
  sceneId: z.string().uuid().optional(),
  expectedRevision: z.number().int().nonnegative().optional()
}).strict();
export const FogResetSchema = z.object({ commandId: z.string().uuid(), sceneId: z.string().uuid().optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const ActorRestSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), kind: z.enum(["long", "short"]), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/** Spend Hit Point Dice to heal on a short rest (SRD 5.2.1: each die heals its roll + Con modifier, minimum 1). GM any actor; a player only their claimed character. */
export const ActorSpendHitDiceSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), count: z.number().int().min(1).max(40), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const DiceRollSchema = z.object({ commandId: z.string().uuid(), formula: z.string().min(1).max(160), purpose: RollPurposeSchema, visibility: RollVisibilitySchema, actorId: z.string().uuid().optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const TokenMoveSchema = z.object({
  commandId: z.string().uuid(), actorId: z.string().uuid(), position: EncounterTokenPositionSchema.nullable(), sceneId: z.string().uuid().optional(),
  /** GM-grade bypass of a movement-rule rejection (speed budget); audited like every override. */
  override: z.object({ reason: z.string().trim().min(1).max(300) }).strict().optional(),
  expectedRevision: z.number().int().nonnegative().optional()
}).strict();
/** GM-set walking speed; null clears to unknown (movement rules then skip for that combatant). */
export const ActorSetSpeedSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), speedFeet: z.number().int().min(0).max(500).nullable(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const SceneNameSchema = z.string().trim().min(1).max(120);
export const SceneCreateSchema = z.object({ commandId: z.string().uuid(), name: SceneNameSchema, mapAssetId: z.string().uuid(), combatantIds: z.array(z.string().uuid()).max(200), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const SceneRenameSchema = z.object({ commandId: z.string().uuid(), sceneId: z.string().uuid(), name: SceneNameSchema, expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const SceneIdSchema = z.object({ commandId: z.string().uuid(), sceneId: z.string().uuid(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const SceneSetCombatantsSchema = z.object({ commandId: z.string().uuid(), sceneId: z.string().uuid(), combatantIds: z.array(z.string().uuid()).max(200), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const AnnotationGeometryInputSchema = z.object({ origin: AnnotationPointSchema, target: AnnotationPointSchema }).strict();
export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const AnnotationAddSchema = z.object({
  commandId: z.string().uuid(),
  kind: z.enum(["measurement", "shape"]),
  shape: AnnotationShapeKindSchema.optional(),
  geometry: AnnotationGeometryInputSchema,
  visibility: AnnotationVisibilitySchema.optional(),
  visibleToActorId: z.string().uuid().nullable().optional(),
  movableByOthers: z.boolean().optional(),
  color: HexColorSchema.optional(),
  expectedRevision: z.number().int().nonnegative().optional()
}).strict();
export const AnnotationPingSchema = z.object({ commandId: z.string().uuid(), point: AnnotationPointSchema, color: HexColorSchema.optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const AnnotationColorSetSchema = z.object({ commandId: z.string().uuid(), id: z.string().uuid(), color: HexColorSchema, expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const AnnotationMoveSchema = z.object({ commandId: z.string().uuid(), id: z.string().uuid(), geometry: AnnotationGeometryInputSchema, expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const AnnotationRemoveSchema = z.object({ commandId: z.string().uuid(), id: z.string().uuid(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const AnnotationVisibilitySetSchema = z.object({ commandId: z.string().uuid(), id: z.string().uuid(), visibility: AnnotationVisibilitySchema, visibleToActorId: z.string().uuid().nullable().optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const AnnotationMovableSetSchema = z.object({ commandId: z.string().uuid(), id: z.string().uuid(), movableByOthers: z.boolean(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const AnnotationClearSchema = z.object({ commandId: z.string().uuid(), scope: z.enum(["mine", "players", "all"]), expectedRevision: z.number().int().nonnegative().optional() }).strict();
