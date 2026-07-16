import { z } from "zod";
import { ActorSchema, type Actor } from "@vtt/schemas";

export { ACTOR_SCHEMA_VERSION, ActorSchema, type Actor } from "@vtt/schemas";

export const RollVisibilitySchema = z.enum(["public", "gm-only", "blind", "self-only"]);
export const RollPurposeSchema = z.enum(["attack", "save", "check", "damage", "manual"]);
export const RollRecordSchema = z.object({
  id: z.string().uuid(),
  commandId: z.string().uuid(),
  initiatorSessionId: z.string().uuid(),
  initiatorRole: z.enum(["gm", "player"]),
  /** Human-readable "who rolled this" — the GM, or the player's claimed character's name at roll time. */
  initiatorLabel: z.string().min(1).max(120),
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
  gridRotationRadians: z.number().finite().min(-Math.PI).max(Math.PI).nullable().default(null)
}).strict();
export type EncounterTokenPosition = z.infer<typeof EncounterTokenPositionSchema>;
export type EncounterToken = z.infer<typeof EncounterTokenSchema>;

export const AnnotationVisibilitySchema = z.enum(["public", "gm-only", "owner-only", "owner-gm"]);
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
 * server derives and snaps `sizeFeet` from `origin`/`target` against the map's grid calibration —
 * both points are re-snapped on every add/move so geometry never drifts off-grid client-side.
 */
export const AnnotationGeometrySchema = z.object({
  origin: AnnotationPointSchema,
  target: AnnotationPointSchema,
  sizeFeet: z.number().finite().positive().max(2000)
}).strict();
export type AnnotationGeometry = z.infer<typeof AnnotationGeometrySchema>;

export const AnnotationSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["measurement", "shape"]),
  shape: AnnotationShapeKindSchema.nullable().default(null),
  geometry: AnnotationGeometrySchema,
  ownerSessionId: z.string().uuid(),
  createdByRole: z.enum(["gm", "player"]),
  visibility: AnnotationVisibilitySchema.default("public"),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative().nullable().default(null)
}).strict().superRefine((annotation, context) => {
  if (annotation.kind === "shape" && annotation.shape === null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["shape"], message: "A shape annotation must specify a shape kind." });
  if (annotation.kind === "measurement" && annotation.shape !== null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["shape"], message: "A measurement annotation must not specify a shape kind." });
  if (annotation.kind === "measurement" && annotation.visibility !== "public") context.addIssue({ code: z.ZodIssueCode.custom, path: ["visibility"], message: "Measurements are always public." });
});
export type Annotation = z.infer<typeof AnnotationSchema>;

export const CombatStateSchema = z.object({
  active: z.boolean().default(false),
  round: z.number().int().positive().default(1),
  turnActorId: z.string().uuid().nullable().default(null),
  mapAssetId: z.string().uuid().nullable().default(null),
  initiative: z.array(InitiativeEntrySchema).max(200).default([]),
  tokens: z.array(EncounterTokenSchema).max(200).default([]),
  annotations: z.array(AnnotationSchema).max(300).default([])
}).superRefine((combat, context) => {
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
});
export type CombatState = z.infer<typeof CombatStateSchema>;

export const GameStateSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative().default(0),
  actors: z.array(ActorSchema).default([]),
  rolls: z.array(RollRecordSchema).default([]),
  combat: CombatStateSchema.default({ active: false, round: 1, turnActorId: null, mapAssetId: null, initiative: [], tokens: [], annotations: [] })
});
export type GameState = z.infer<typeof GameStateSchema>;
export type ClientRole = "player" | "gm";

/** Server-authoritative connection presence for a claimed character's owning session. Never carries a session ID, token, socket ID, or address across the wire. */
export const PresenceStatusSchema = z.enum(["online", "reconnecting", "offline"]);
export type PresenceStatus = z.infer<typeof PresenceStatusSchema>;

export type PlayerActor = Omit<Actor, "notes" | "ownerSessionId"> & { claimStatus: "available" | "mine" | "claimed"; presence: PresenceStatus | null };
export type PlayerInitiativeEntry = Readonly<{ actorId: string; name: string; score: number; active: boolean }>;
export type PlayerAnnotation = Omit<Annotation, "ownerSessionId"> & { mine: boolean };
export type PlayerCombatView = Readonly<{ active: boolean; round: number; turnActorId: string | null; mapAssetId: string | null; hiddenTurn: boolean; initiative: readonly PlayerInitiativeEntry[]; tokens: readonly EncounterToken[]; annotations: readonly PlayerAnnotation[] }>;
export type PlayerView = Pick<GameState, "revision"> & { combat: PlayerCombatView; actors: PlayerActor[]; rolls: PlayerRollRecord[] };
export type GmActor = Actor & { presence: PresenceStatus | null };
export type GmView = Omit<GameState, "actors"> & { actors: GmActor[] };

export interface ServerToClientEvents { "state:updated": (state: PlayerView | GmView) => void; "system:error": (message: string) => void; }
export type SessionJoinResult = { ok: boolean; role?: ClientRole; sessionId?: string; token?: string; message?: string };
export type MutationResult = { ok: boolean; revision?: number; duplicate?: boolean; message?: string };
export type DiceRollResult = MutationResult & { rollId?: string; hiddenFromRoller?: boolean };
export type EncounterStartEntry = Readonly<{ actorId: string; score?: number }>;
export type AnnotationGeometryInput = Readonly<{ origin: AnnotationPoint; target: AnnotationPoint }>;
export type AnnotationAddResult = MutationResult & { annotationId?: string };
export interface ClientToServerEvents {
  "session:join": (payload: { token?: string }, acknowledgement: (result: SessionJoinResult) => void) => void;
  "character:claim": (payload: { commandId: string; actorId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "character:release": (payload: { commandId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "character:force-release": (payload: { commandId: string; actorId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "dice:roll": (payload: { commandId: string; formula: string; purpose: RollPurpose; visibility: RollVisibility; actorId?: string; expectedRevision?: number }, acknowledgement: (result: DiceRollResult) => void) => void;
  "encounter:start": (payload: { commandId: string; mapAssetId: string; entries: readonly EncounterStartEntry[]; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "encounter:end": (payload: { commandId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "initiative:set": (payload: { commandId: string; actorId: string; score: number; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "initiative:next": (payload: { commandId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "initiative:previous": (payload: { commandId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "token:move": (payload: { commandId: string; actorId: string; position: EncounterTokenPosition | null; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "annotation:add": (payload: { commandId: string; kind: "measurement" | "shape"; shape?: AnnotationShapeKind; geometry: AnnotationGeometryInput; visibility?: AnnotationVisibility; expectedRevision?: number }, acknowledgement: (result: AnnotationAddResult) => void) => void;
  "annotation:move": (payload: { commandId: string; id: string; geometry: AnnotationGeometryInput; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "annotation:remove": (payload: { commandId: string; id: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "annotation:set-visibility": (payload: { commandId: string; id: string; visibility: AnnotationVisibility; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
}
