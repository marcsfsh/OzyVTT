import { z } from "zod";
import { ActorDefinitionSchema, ActorSchema, type Actor, type ActorDefinition } from "@vtt/schemas";

export { ACTOR_SCHEMA_VERSION, ActorSchema, type Actor, type ActorDefinition } from "@vtt/schemas";

/** An imported stat block persisted with the campaign: the inert definition plus the id actors reference via `definitionId`. */
export const StoredDefinitionSchema = z.object({ id: z.string().regex(/^[a-z0-9-]+$/).max(200), definition: ActorDefinitionSchema }).strict();
export type StoredDefinition = z.infer<typeof StoredDefinitionSchema>;

export const RollVisibilitySchema = z.enum(["public", "gm-only", "blind", "self-only"]);
export const RollPurposeSchema = z.enum(["attack", "save", "check", "damage", "manual"]);
export const RollRecordSchema = z.object({
  id: z.string().uuid(),
  commandId: z.string().uuid(),
  initiatorSessionId: z.string().uuid(),
  initiatorRole: z.enum(["gm", "player"]),
  /**
   * Human-readable "who rolled this" — the GM, or the player's claimed character's name at roll
   * time. Optional so rolls persisted before this field existed still parse; the server always
   * supplies a real value for every new roll.
   */
  initiatorLabel: z.string().min(1).max(120).optional(),
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
 * server derives and snaps `sizeFeet` from `origin`/`target` against the map's grid calibration —
 * both points are re-snapped on every add/move so geometry never drifts off-grid client-side.
 */
export const AnnotationGeometrySchema = z.object({
  origin: AnnotationPointSchema,
  target: AnnotationPointSchema,
  sizeFeet: z.number().finite().positive().max(2000)
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
  /** Display label — currently the pinger's name for `ping` annotations; null otherwise. */
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
 * typing a total (GM anyone; a player their own character). On answer the outcome AUTO-APPLIES —
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
  halfOnSuccess: z.boolean().default(true),
  conditionId: z.string().regex(/^[a-z0-9-]+$/).max(60).nullable().default(null),
  createdAt: z.number().int().nonnegative()
}).strict();
export type PendingSave = z.infer<typeof PendingSaveSchema>;

export const CombatStateSchema = z.object({
  active: z.boolean().default(false),
  round: z.number().int().positive().default(1),
  turnActorId: z.string().uuid().nullable().default(null),
  mapAssetId: z.string().uuid().nullable().default(null),
  initiative: z.array(InitiativeEntrySchema).max(200).default([]),
  tokens: z.array(EncounterTokenSchema).max(200).default([]),
  annotations: z.array(AnnotationSchema).max(300).default([]),
  /** Action economy of the current turn's actor; reset whenever the turn changes. Tracked, never enforced. */
  turn: z.object({ actionUsed: z.boolean().default(false), bonusActionUsed: z.boolean().default(false) }).default({ actionUsed: false, bonusActionUsed: false }),
  /** Combatants whose reaction is spent; an actor's id is removed when their own turn starts (5e refresh timing). */
  reactionsUsed: z.array(z.string().uuid()).max(200).default([]),
  /** Saving throws still owed by targets (see PendingSaveSchema). */
  pendingSaves: z.array(PendingSaveSchema).max(100).default([])
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
  combat: CombatStateSchema.default({ active: false, round: 1, turnActorId: null, mapAssetId: null, initiative: [], tokens: [], annotations: [] }),
  /** Imported stat blocks (canonical ActorDefinition JSON) that live with the campaign, additive per ADR-0007. */
  definitions: z.array(StoredDefinitionSchema).max(100).default([])
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
export type PlayerActor = Omit<Actor, "notes" | "ownerSessionId" | "hp"> & { hp: PlayerHp; claimStatus: "available" | "mine" | "claimed"; presence: PresenceStatus | null; /** Present only on the requesting player's own claimed character. */ definition?: ActorDefinition };
export type PlayerInitiativeEntry = Readonly<{ actorId: string; name: string; score: number; active: boolean; health: HealthBand }>;
export type PlayerAnnotation = Omit<Annotation, "ownerSessionId"> & { mine: boolean };
/** A player's own pending saves only; the source actor id never crosses the wire, and a hidden source's name is masked server-side. */
export type PlayerPendingSave = Omit<PendingSave, "sourceActorId">;
export type PlayerCombatView = Readonly<{ active: boolean; round: number; turnActorId: string | null; mapAssetId: string | null; hiddenTurn: boolean; initiative: readonly PlayerInitiativeEntry[]; tokens: readonly EncounterToken[]; annotations: readonly PlayerAnnotation[]; turn: { actionUsed: boolean; bonusActionUsed: boolean }; reactionsUsed: readonly string[]; pendingSaves: readonly PlayerPendingSave[] }>;
export type PlayerView = Pick<GameState, "revision"> & { combat: PlayerCombatView; actors: PlayerActor[]; rolls: PlayerRollRecord[] };
export type GmActor = Actor & { presence: PresenceStatus | null };
export type GmView = Omit<GameState, "actors"> & { actors: GmActor[] };

/** A brief, ephemeral battlemap notification ("Goblin took 6 damage"). Never stored in GameState — presentation only; the roll history is the durable record. */
export type TableEvent = Readonly<{ id: string; kind: "damage" | "heal" | "save" | "action" | "condition" | "reaction"; text: string; actorIds: readonly string[]; at: number }>;
export interface ServerToClientEvents { "state:updated": (state: PlayerView | GmView) => void; "system:error": (message: string) => void; "table:event": (event: TableEvent) => void; }
export type SessionJoinResult = { ok: boolean; role?: ClientRole; sessionId?: string; token?: string; message?: string };
export type MutationResult = { ok: boolean; revision?: number; duplicate?: boolean; message?: string };
export type DiceRollResult = MutationResult & { rollId?: string; hiddenFromRoller?: boolean };
export type EncounterStartEntry = Readonly<{ actorId: string; score?: number }>;
export type AnnotationGeometryInput = Readonly<{ origin: AnnotationPoint; target: AnnotationPoint }>;
export type AnnotationAddResult = MutationResult & { annotationId?: string };
export type ActorAddResult = MutationResult & { actorId?: string };
/** Compact browse row for bundled monster content; the server maps content definitions into this wire shape. */
export type ContentMonsterSummary = Readonly<{ id: string; name: string; challengeRating: number; type: string; size: string; armorClass: number; hitPoints: number }>;
export type ContentMonstersResult = { ok: boolean; message?: string; monsters?: readonly ContentMonsterSummary[]; attribution?: string };
/** SRD condition reference (name + rules text) for pickers and tooltips; public information for any joined session. */
export type ContentConditionSummary = Readonly<{ id: string; name: string; description: string }>;
export type ContentConditionsResult = { ok: boolean; message?: string; conditions?: readonly ContentConditionSummary[] };
/** An area of effect parsed from a definition action's prose ("60-foot Cone", etc.); the GM places a matching template on the map. */
export type ContentActionArea = Readonly<{ shape: "cone" | "line" | "sphere" | "cube" | "emanation"; sizeFeet: number; widthFeet: number | null }>;
/** A definition action flattened for the GM's action runner. Structured fields only where the content has them. */
export type ContentActionSummary = Readonly<{ id: string; name: string; activation: "action" | "bonus-action" | "reaction" | "other"; description: string; attackBonus: number | null; reachFeet: number | null; rangeFeet: number | null; saveAbility: string | null; saveDc: number | null; damage: ReadonlyArray<{ formula: string; type: string }>; area: ContentActionArea | null }>;
export type ContentActionsResult = { ok: boolean; message?: string; actions?: readonly ContentActionSummary[] };
/** Full stat-block payload for the GM's sheet view; inert content data, GM-gated. */
export type ContentSheetResult = { ok: boolean; message?: string; definition?: import("@vtt/schemas").ActorDefinition };
/** Server-computed outcome of resolving a definition action (rolls already recorded in the roll history). */
export type ActionResolutionAttack = Readonly<{ targetId: string; targetName: string; total: number; naturalRoll: number; targetAc: number | null; outcome: "crit" | "hit" | "miss" | "fumble" | "unknown" }>;
export type ActionResolution = Readonly<{
  actionName: string;
  activation: "action" | "bonus-action" | "reaction" | "other";
  attack: ActionResolutionAttack | null;
  save: { ability: string; dc: number; targets: ReadonlyArray<{ targetId: string; targetName: string }> } | null;
  damage: ReadonlyArray<{ formula: string; type: string; total: number }>;
  damageTotal: number;
  crit: boolean;
}>;
export type ActionResolveResult = MutationResult & { resolution?: ActionResolution };
/** Outcome of answering a pending save; applied damage/condition already happened server-side when present. */
export type SaveAnswerResult = MutationResult & { outcome?: { success: boolean; total: number; dc: number; appliedDamage: number; conditionApplied: boolean } };
export interface ClientToServerEvents {
  "session:join": (payload: { token?: string }, acknowledgement: (result: SessionJoinResult) => void) => void;
  "character:claim": (payload: { commandId: string; actorId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "character:release": (payload: { commandId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "character:force-release": (payload: { commandId: string; actorId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "content:monsters": (payload: Record<string, never>, acknowledgement: (result: ContentMonstersResult) => void) => void;
  "actor:add-from-definition": (payload: { commandId: string; definitionId: string; visibility?: "public" | "gm-only"; expectedRevision?: number }, acknowledgement: (result: ActorAddResult) => void) => void;
  "actor:remove": (payload: { commandId: string; actorId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "actor:import-definition": (payload: { commandId: string; definition: unknown; visibility?: "public" | "gm-only"; expectedRevision?: number }, acknowledgement: (result: ActorAddResult) => void) => void;
  "actor:apply-damage": (payload: { commandId: string; actorId: string; amount: number; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "actor:heal": (payload: { commandId: string; actorId: string; amount: number; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "actor:set-temp-hp": (payload: { commandId: string; actorId: string; amount: number; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "actor:set-hp": (payload: { commandId: string; actorId: string; current: number; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "actor:set-condition": (payload: { commandId: string; actorId: string; conditionId: string; active: boolean; level?: number; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "content:conditions": (payload: Record<string, never>, acknowledgement: (result: ContentConditionsResult) => void) => void;
  "content:monster-actions": (payload: { definitionId: string }, acknowledgement: (result: ContentActionsResult) => void) => void;
  "content:monster-sheet": (payload: { definitionId: string }, acknowledgement: (result: ContentSheetResult) => void) => void;
  "action:resolve": (payload: { commandId: string; actorId: string; actionId: string; targetIds?: readonly string[]; template?: { shape: AnnotationShapeKind; origin: AnnotationPoint; target: AnnotationPoint }; conditionId?: string; expectedRevision?: number }, acknowledgement: (result: ActionResolveResult) => void) => void;
  "save:answer": (payload: { commandId: string; saveId: string; method: "roll" | "manual"; total?: number; expectedRevision?: number }, acknowledgement: (result: SaveAnswerResult) => void) => void;
  "save:dismiss": (payload: { commandId: string; saveId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "turn:use": (payload: { commandId: string; slot: "action" | "bonus-action"; used: boolean; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "turn:use-reaction": (payload: { commandId: string; actorId: string; used: boolean; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "turn:end": (payload: { commandId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "dice:roll": (payload: { commandId: string; formula: string; purpose: RollPurpose; visibility: RollVisibility; actorId?: string; expectedRevision?: number }, acknowledgement: (result: DiceRollResult) => void) => void;
  "encounter:start": (payload: { commandId: string; mapAssetId: string; entries: readonly EncounterStartEntry[]; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "encounter:end": (payload: { commandId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "initiative:set": (payload: { commandId: string; actorId: string; score: number; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "initiative:next": (payload: { commandId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "initiative:previous": (payload: { commandId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "token:move": (payload: { commandId: string; actorId: string; position: EncounterTokenPosition | null; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "annotation:add": (payload: { commandId: string; kind: "measurement" | "shape"; shape?: AnnotationShapeKind; geometry: AnnotationGeometryInput; visibility?: AnnotationVisibility; visibleToActorId?: string | null; movableByOthers?: boolean; color?: string; expectedRevision?: number }, acknowledgement: (result: AnnotationAddResult) => void) => void;
  "annotation:ping": (payload: { commandId: string; point: AnnotationPoint; color?: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "annotation:set-color": (payload: { commandId: string; id: string; color: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "annotation:move": (payload: { commandId: string; id: string; geometry: AnnotationGeometryInput; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "annotation:remove": (payload: { commandId: string; id: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "annotation:set-visibility": (payload: { commandId: string; id: string; visibility: AnnotationVisibility; visibleToActorId?: string | null; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "annotation:set-movable": (payload: { commandId: string; id: string; movableByOthers: boolean; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "annotation:clear": (payload: { commandId: string; scope: "mine" | "players" | "all"; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
}
