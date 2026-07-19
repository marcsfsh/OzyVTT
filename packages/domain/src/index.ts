import { z } from "zod";
import { ActorDefinitionSchema, ActorSchema, type Actor, type ActorDefinition, type EffectInstance, type EffectModifier } from "@vtt/schemas";

export { ACTOR_SCHEMA_VERSION, ActorSchema, DeathSavesSchema, EffectInstanceSchema, EffectModifierSchema, type Actor, type ActorDefinition, type DeathSaves, type EffectInstance, type EffectModifier } from "@vtt/schemas";

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
  /** Typed components of the proposed damage (additive — absent on saves created before ADR-0020); when present, application runs the typed-defense pipeline. */
  proposedDamageParts: z.array(z.object({ amount: z.number().int().nonnegative().max(10000), type: z.string().min(1).max(40) }).strict()).max(9).optional(),
  halfOnSuccess: z.boolean().default(true),
  conditionId: z.string().regex(/^[a-z0-9-]+$/).max(60).nullable().default(null),
  /** Flat bonus to the save roll (GM-adjudicated cover: +2/+5 on Dex saves — SRD Cover). Additive. */
  saveBonus: z.number().int().min(0).max(10).default(0),
  /** Concentration check (SRD): effects ended when this save is FAILED on commit. Stripped from player projections. Additive. */
  endsEffects: z.array(z.object({ actorId: z.string().uuid(), effectId: z.string().min(1).max(120) }).strict()).max(8).optional(),
  /**
   * A source-linked effect applied on a committed failure (Unarmed Strike Grapple: the Grappled
   * effect with its escape DC). Additive — absent on saves created before this field existed.
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
 * Shared invariants for a combat context — the live top-level combat AND each parked scene's frozen
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

/** Combat fields shared by the live top-level combat and each parked scene — everything except the map (a Scene carries its own) and the scene bookkeeping (only the top level carries that). */
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
    movementUsedFeet: z.number().nonnegative().max(100000).default(0)
  }).default({ actionUsed: false, bonusActionUsed: false, actionInstance: null, turnUses: {}, movementUsedFeet: 0 }),
  /** How structured action resolution enforces rules (ADR-0020): strict rejects with an override path, assisted warns, freeform stays reference-level. */
  rulesMode: z.enum(["strict", "assisted", "freeform"]).default("strict"),
  /** GM-set underwater environment (SRD Underwater Combat): melee disadvantage unless piercing, ranged auto-miss beyond normal range, everyone resists fire. Additive. */
  underwater: z.boolean().default(false),
  /** Combatants whose reaction is spent; an actor's id is removed when their own turn starts (5e refresh timing). */
  reactionsUsed: z.array(z.string().uuid()).max(200).default([]),
  /** Saving throws still owed by targets (see PendingSaveSchema). */
  pendingSaves: z.array(PendingSaveSchema).max(100).default([]),
  /** Reaction prompts still owed an answer (see PendingReactionSchema). */
  pendingReactions: z.array(PendingReactionSchema).max(20).default([])
};

/** A parked scene's frozen combat — same fields and invariants as the live combat, minus the map (the Scene owns that). */
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
  /** Prepared scenes the GM parks-and-resumes between. The active scene's own `combat` slot stays empty — its live copy is these top-level fields (single source of truth). */
  scenes: z.array(SceneSchema).max(20).default([]),
  activeSceneId: z.string().uuid().nullable().default(null),
  /**
   * Turn time-travel bookkeeping (live fight only — parked scenes never carry these). `historyCursor`
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
  if (active && (active.combat.active || active.combat.initiative.length > 0 || active.combat.tokens.length > 0 || active.combat.annotations.length > 0 || active.combat.reactionsUsed.length > 0 || active.combat.pendingSaves.length > 0 || active.combat.pendingReactions.length > 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["scenes"], message: "The active scene's stored combat must be empty — its live copy is the top-level combat." });
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
/** An effect as players see it: source ids never cross the wire, and a hidden source's name is masked server-side (viewer safety). */
export type PlayerEffect = Omit<EffectInstance, "sourceActorId" | "sourceActionId">;
export type PlayerActor = Omit<Actor, "notes" | "ownerSessionId" | "hp" | "effects" | "actionUses" | "conditionImmunities"> & { hp: PlayerHp; effects: PlayerEffect[]; claimStatus: "available" | "mine" | "claimed"; presence: PresenceStatus | null; /** Present only on the requesting player's own claimed character. */ definition?: ActorDefinition; /** Spent limited-use counts — only on the requesting player's own claimed character. */ actionUses?: Record<string, number> };
export type PlayerInitiativeEntry = Readonly<{ actorId: string; name: string; score: number; active: boolean; health: HealthBand }>;
export type PlayerAnnotation = Omit<Annotation, "ownerSessionId"> & { mine: boolean };
/** A player's own pending saves only; source actor ids and concentration effect references never cross the wire, and a hidden source's name is masked server-side. */
export type PlayerPendingSave = Omit<PendingSave, "sourceActorId" | "endsEffects">;
/** A player's own pending reaction prompts only; same masking rules as saves. */
export type PlayerPendingReaction = Omit<PendingReaction, "sourceActorId">;
export type PlayerCombatView = Readonly<{ active: boolean; round: number; turnActorId: string | null; mapAssetId: string | null; hiddenTurn: boolean; initiative: readonly PlayerInitiativeEntry[]; tokens: readonly EncounterToken[]; annotations: readonly PlayerAnnotation[]; turn: { actionUsed: boolean; bonusActionUsed: boolean; actionInstance: { actorId: string; components: Record<string, number> } | null; turnUses: Record<string, number>; movementUsedFeet: number }; rulesMode: "strict" | "assisted" | "freeform"; underwater: boolean; reactionsUsed: readonly string[]; pendingSaves: readonly PlayerPendingSave[]; pendingReactions: readonly PlayerPendingReaction[]; /** True while the GM has the table viewing an earlier turn (no labels — those can name hidden combatants). */ rewound: boolean }>;
export type PlayerView = Pick<GameState, "revision"> & { combat: PlayerCombatView; actors: PlayerActor[]; rolls: PlayerRollRecord[] };
export type GmActor = Actor & { presence: PresenceStatus | null };
/** One recorded turn boundary on the time-travel timeline. GM-only (labels can name hidden combatants); the server attaches the list to GM views at emission. */
export type TurnHistoryEntry = Readonly<{ index: number; kind: "turn" | "return"; label: string; revision: number; at: string }>;
export type GmView = Omit<GameState, "actors"> & { actors: GmActor[]; turnHistory?: readonly TurnHistoryEntry[] };
/** A persisted combat-log line. Players only ever receive gmOnly=false entries; the GM sees all. */
export type CombatLogEntry = Readonly<{ id: number; at: string; kind: "damage" | "heal" | "save" | "action" | "condition" | "reaction" | "turn" | "encounter" | "scene" | "history" | "roll" | "movement" | "effect" | "death-save" | "override"; text: string; gmOnly: boolean; revision: number }>;

/** A brief, ephemeral battlemap notification ("Goblin took 6 damage"). Never stored in GameState — presentation only; the roll history is the durable record. */
export type TableEvent = Readonly<{ id: string; kind: "damage" | "heal" | "save" | "action" | "condition" | "reaction" | "effect" | "death-save"; text: string; actorIds: readonly string[]; at: number }>;
export interface ServerToClientEvents { "state:updated": (state: PlayerView | GmView) => void; "system:error": (message: string) => void; "table:event": (event: TableEvent) => void; "log:entry": (entry: CombatLogEntry) => void; }
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
export type ContentConditionsResult = { ok: boolean; message?: string; conditions?: readonly ContentConditionSummary[] };
/** An area of effect parsed from a definition action's prose ("60-foot Cone", etc.); the GM places a matching template on the map. */
export type ContentActionArea = Readonly<{ shape: "cone" | "line" | "sphere" | "cube" | "emanation"; sizeFeet: number; widthFeet: number | null }>;
/** A definition action flattened for the GM's action runner. Structured fields only where the content has them; the ADR-0020 mechanics fields power availability hints (the server stays the authority). */
export type ContentActionSummary = Readonly<{ id: string; name: string; activation: "action" | "bonus-action" | "reaction" | "other"; description: string; attackBonus: number | null; reachFeet: number | null; rangeFeet: number | null; /** Normal range band for two-range weapons; shots beyond it (up to rangeFeet) roll at disadvantage. */ rangeNormalFeet: number | null; saveAbility: string | null; saveDc: number | null; damage: ReadonlyArray<{ formula: string; type: string }>; area: ContentActionArea | null; attackCount: number | null; usesLimit: number | null; usesPer: "turn" | "encounter" | "long-rest" | "short-rest" | "recharge" | null; /** d6 threshold for usesPer "recharge" ("Recharge 5-6" → 5); rolled automatically at the start of the owner's turn. */ usesRecharge: number | null; usesPool: string | null; requiresEffectTag: string | null; multiattack: ReadonlyArray<{ actionId: string; count: number }> | null; grants: boolean; reaction: Readonly<{ trigger: "hit-by-attack"; response: "half-damage" }> | null; /** SRD generic action rows (Dodge, Dash, Help, ...) appended after the stat block's own. */ builtin?: boolean; /** Builtin targeting: "single" picks one combatant, "none" is a direct tap. */ targeting?: "single" | "none" }>;
export type ContentActionsResult = { ok: boolean; message?: string; actions?: readonly ContentActionSummary[] };
/** Full stat-block payload for the GM's sheet view; inert content data, GM-gated. */
export type ContentSheetResult = { ok: boolean; message?: string; definition?: import("@vtt/schemas").ActorDefinition };
/** Server-computed outcome of resolving a definition action (rolls already recorded in the roll history). */
export type ActionResolutionAttack = Readonly<{ targetId: string; targetName: string; total: number; naturalRoll: number; targetAc: number | null; outcome: "crit" | "hit" | "miss" | "fumble" | "unknown"; /** Cover's AC bonus folded into targetAc (SRD Cover: +2 half, +5 three-quarters). */ coverBonus?: number }>;
/** Why an attack rolled with advantage/disadvantage — every contributing source, so the table can see the math (ADR-0020 explainability). */
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
  /** A builtin action's check roll (Hide vs DC 15; Influence/Search/Study with dc/success null — GM adjudicates). */
  check?: Readonly<{ skill: string; total: number; naturalRoll: number; dc: number | null; success: boolean | null }> | null;
  /** Effects this resolve ended as a rule consequence (attacking revealed Hiding; an off-turn action released a Ready). */
  effectsEnded?: ReadonlyArray<Readonly<{ actorId: string; actorName: string; name: string }>>;
}>;
/** A strict-mode rules rejection: what rule blocked the command and whether an override may bypass it. */
export type RulesBlocked = Readonly<{ rule: string; message: string; overridable: boolean }>;
export type ActionResolveResult = MutationResult & { resolution?: ActionResolution };
/**
 * Server-computed application of typed damage: per-part defense adjustments (immunity → resistance →
 * vulnerability), temp-HP absorption, and any zero-HP transition — the explainable "17 → 8" record.
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
export type DeathSaveResult = MutationResult & { deathSave?: Readonly<{ naturalRoll: number; outcome: "success" | "failure" | "critical-success" | "critical-failure"; successes: number; failures: number; stable: boolean; dead: boolean; regainedConsciousness: boolean }> };
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
  /** True for the SRD generic actions every combatant can take (Dodge, Dash, Help, ...) — not on the stat block. */
  builtin?: boolean;
}>;
export type ActorActionsAvailabilityResult = { ok: boolean; message?: string; rulesMode?: "strict" | "assisted" | "freeform"; actions?: readonly ActionAvailability[] };
export interface ClientToServerEvents {
  "session:join": (payload: { token?: string }, acknowledgement: (result: SessionJoinResult) => void) => void;
  "character:claim": (payload: { commandId: string; actorId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "character:release": (payload: { commandId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "character:force-release": (payload: { commandId: string; actorId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "content:monsters": (payload: Record<string, never>, acknowledgement: (result: ContentMonstersResult) => void) => void;
  "actor:add-from-definition": (payload: { commandId: string; definitionId: string; visibility?: "public" | "gm-only"; expectedRevision?: number }, acknowledgement: (result: ActorAddResult) => void) => void;
  "actor:remove": (payload: { commandId: string; actorId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "actor:import-definition": (payload: { commandId: string; definition: unknown; visibility?: "public" | "gm-only"; expectedRevision?: number }, acknowledgement: (result: ActorAddResult) => void) => void;
  "actor:set-token-image": (payload: { commandId: string; actorId: string; tokenAssetId: string | null; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "actor:set-size": (payload: { commandId: string; actorId: string; size: "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan"; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "actor:set-speed": (payload: { commandId: string; actorId: string; speedFeet: number | null; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "actor:apply-damage": (payload: { commandId: string; actorId: string; amount: number; parts?: ReadonlyArray<{ amount: number; type: string }>; sourceActorId?: string; sourceActionId?: string; sourceName?: string; critical?: boolean; nonlethal?: boolean; expectedRevision?: number }, acknowledgement: (result: DamageApplyResult) => void) => void;
  "actor:heal": (payload: { commandId: string; actorId: string; amount: number; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "actor:set-temp-hp": (payload: { commandId: string; actorId: string; amount: number; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "actor:set-hp": (payload: { commandId: string; actorId: string; current: number; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "actor:set-condition": (payload: { commandId: string; actorId: string; conditionId: string; active: boolean; level?: number; override?: { reason: string }; expectedRevision?: number }, acknowledgement: (result: MutationResult & { blocked?: RulesBlocked }) => void) => void;
  "content:conditions": (payload: Record<string, never>, acknowledgement: (result: ContentConditionsResult) => void) => void;
  "content:monster-actions": (payload: { definitionId: string }, acknowledgement: (result: ContentActionsResult) => void) => void;
  "content:monster-sheet": (payload: { definitionId: string }, acknowledgement: (result: ContentSheetResult) => void) => void;
  "action:resolve": (payload: { commandId: string; actorId: string; actionId: string; targetIds?: readonly string[]; template?: { shape: AnnotationShapeKind; origin: AnnotationPoint; target: AnnotationPoint }; conditionId?: string; rollMode?: "advantage" | "disadvantage" | "normal"; override?: { reason: string }; effectId?: string; note?: string; cover?: "half" | "three-quarters" | "total"; expectedRevision?: number }, acknowledgement: (result: ActionResolveResult) => void) => void;
  "effect:add": (payload: { commandId: string; actorId: string; name: string; tags?: readonly string[]; duration?: { type: "rounds"; rounds: number } | { type: "until-source-next-turn" } | { type: "encounter" } | { type: "manual" }; modifiers?: readonly EffectModifier[]; expectedRevision?: number }, acknowledgement: (result: MutationResult & { effectId?: string }) => void) => void;
  "effect:end": (payload: { commandId: string; actorId: string; effectId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "death-save:roll": (payload: { commandId: string; actorId: string; expectedRevision?: number }, acknowledgement: (result: DeathSaveResult) => void) => void;
  "encounter:set-rules-mode": (payload: { commandId: string; mode: "strict" | "assisted" | "freeform"; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "encounter:set-environment": (payload: { commandId: string; underwater: boolean; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "actor:rest": (payload: { commandId: string; actorId: string; kind: "long" | "short"; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "save:answer": (payload: { commandId: string; saveId: string; method: "roll" | "manual"; total?: number; commit?: boolean; expectedRevision?: number }, acknowledgement: (result: SaveAnswerResult) => void) => void;
  "save:dismiss": (payload: { commandId: string; saveId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "reaction:answer": (payload: { commandId: string; reactionId: string; use: boolean; actionId?: string; expectedRevision?: number }, acknowledgement: (result: ReactionAnswerResult) => void) => void;
  "reaction:dismiss": (payload: { commandId: string; reactionId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "actor:available-actions": (payload: { actorId: string }, acknowledgement: (result: ActorActionsAvailabilityResult) => void) => void;
  "turn:use": (payload: { commandId: string; slot: "action" | "bonus-action"; used: boolean; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "turn:use-reaction": (payload: { commandId: string; actorId: string; used: boolean; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "turn:end": (payload: { commandId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "dice:roll": (payload: { commandId: string; formula: string; purpose: RollPurpose; visibility: RollVisibility; actorId?: string; expectedRevision?: number }, acknowledgement: (result: DiceRollResult) => void) => void;
  "encounter:start": (payload: { commandId: string; mapAssetId: string; entries: readonly EncounterStartEntry[]; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "encounter:end": (payload: { commandId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "encounter:add-combatant": (payload: { commandId: string; actorId: string; score?: number; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "initiative:set": (payload: { commandId: string; actorId: string; score: number; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "initiative:next": (payload: { commandId: string; confirmRewrite?: boolean; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "initiative:previous": (payload: { commandId: string; confirmDiscard?: boolean; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "log:read": (payload: Record<string, never>, acknowledgement: (result: { ok: boolean; message?: string; entries?: readonly CombatLogEntry[] }) => void) => void;
  "token:move": (payload: { commandId: string; actorId: string; position: EncounterTokenPosition | null; sceneId?: string; override?: { reason: string }; expectedRevision?: number }, acknowledgement: (result: MutationResult & { blocked?: RulesBlocked }) => void) => void;
  "scene:create": (payload: { commandId: string; name: string; mapAssetId: string; combatantIds: readonly string[]; expectedRevision?: number }, acknowledgement: (result: SceneCreateResult) => void) => void;
  "scene:rename": (payload: { commandId: string; sceneId: string; name: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "scene:remove": (payload: { commandId: string; sceneId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "scene:activate": (payload: { commandId: string; sceneId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "scene:set-combatants": (payload: { commandId: string; sceneId: string; combatantIds: readonly string[]; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "annotation:add": (payload: { commandId: string; kind: "measurement" | "shape"; shape?: AnnotationShapeKind; geometry: AnnotationGeometryInput; visibility?: AnnotationVisibility; visibleToActorId?: string | null; movableByOthers?: boolean; color?: string; expectedRevision?: number }, acknowledgement: (result: AnnotationAddResult) => void) => void;
  "annotation:ping": (payload: { commandId: string; point: AnnotationPoint; color?: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "annotation:set-color": (payload: { commandId: string; id: string; color: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "annotation:move": (payload: { commandId: string; id: string; geometry: AnnotationGeometryInput; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "annotation:remove": (payload: { commandId: string; id: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "annotation:set-visibility": (payload: { commandId: string; id: string; visibility: AnnotationVisibility; visibleToActorId?: string | null; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "annotation:set-movable": (payload: { commandId: string; id: string; movableByOthers: boolean; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "annotation:clear": (payload: { commandId: string; scope: "mine" | "players" | "all"; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
}
