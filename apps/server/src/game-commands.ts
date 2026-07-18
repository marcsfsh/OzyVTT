import { z } from "zod";
import { AnnotationPointSchema, AnnotationShapeKindSchema, AnnotationVisibilitySchema, EncounterTokenPositionSchema, RollPurposeSchema, RollVisibilitySchema } from "@vtt/domain";

/**
 * Wire schemas for every game command, shared by BOTH transports: the Socket.IO handlers in
 * `server.ts` and the public HTTP API (`game-http.ts`) parse requests with these exact schemas, so
 * the two surfaces can never drift apart on what a command accepts. `commandId` doubles as the
 * idempotency receipt key in the store; `expectedRevision` is the optimistic-concurrency guard.
 */

export const CommandIdentitySchema = z.object({ commandId: z.string().uuid(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
// Turn navigation carries an optional confirmation flag: Next may rewrite history, Previous may discard an in-place change.
export const InitiativeNextSchema = z.object({ commandId: z.string().uuid(), confirmRewrite: z.boolean().optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const InitiativePreviousSchema = z.object({ commandId: z.string().uuid(), confirmDiscard: z.boolean().optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const EncounterStartSchema = z.object({
  commandId: z.string().uuid(),
  mapAssetId: z.string().uuid(),
  entries: z.array(z.object({ actorId: z.string().uuid(), score: z.number().int().min(-1000).max(1000).optional() }).strict()).min(1).max(200),
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
export const TempHpSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), amount: z.number().int().min(0).max(1000), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const SetHpSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), current: z.number().int().min(0).max(10000), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const SetConditionSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), conditionId: z.string().regex(/^[a-z0-9-]+$/).max(60), active: z.boolean(), level: z.number().int().min(1).max(6).optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const TurnUseSchema = z.object({ commandId: z.string().uuid(), slot: z.enum(["action", "bonus-action"]), used: z.boolean(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const ActionResolveSchema = z.object({
  commandId: z.string().uuid(),
  actorId: z.string().uuid(),
  actionId: z.string().regex(/^[a-z0-9-]+$/).max(120),
  targetIds: z.array(z.string().uuid()).min(1).max(20).optional(),
  template: z.object({ shape: AnnotationShapeKindSchema, origin: AnnotationPointSchema, target: AnnotationPointSchema }).strict().optional(),
  conditionId: z.string().regex(/^[a-z0-9-]+$/).max(60).optional(),
  expectedRevision: z.number().int().nonnegative().optional()
}).strict().refine((payload) => (payload.targetIds === undefined) !== (payload.template === undefined), { message: "Provide either explicit targets or an area template, not both." });
export const SaveAnswerSchema = z.object({ commandId: z.string().uuid(), saveId: z.string().uuid(), method: z.enum(["roll", "manual"]), total: z.number().int().min(-20).max(60).optional(), commit: z.boolean().default(true), expectedRevision: z.number().int().nonnegative().optional() }).strict()
  .refine((payload) => payload.method !== "manual" || payload.total !== undefined, { message: "A manual answer needs the rolled total." });
export const SaveDismissSchema = z.object({ commandId: z.string().uuid(), saveId: z.string().uuid(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const ContentActionsSchema = z.object({ definitionId: z.string().regex(/^[a-z0-9-]+$/).max(200) }).strict();
export const TurnReactionSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), used: z.boolean(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const DiceRollSchema = z.object({ commandId: z.string().uuid(), formula: z.string().min(1).max(160), purpose: RollPurposeSchema, visibility: RollVisibilitySchema, actorId: z.string().uuid().optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const TokenMoveSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), position: EncounterTokenPositionSchema.nullable(), sceneId: z.string().uuid().optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
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
