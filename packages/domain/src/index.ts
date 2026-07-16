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

export const CombatStateSchema = z.object({
  active: z.boolean().default(false),
  round: z.number().int().positive().default(1),
  turnActorId: z.string().uuid().nullable().default(null),
  mapAssetId: z.string().uuid().nullable().default(null),
  initiative: z.array(InitiativeEntrySchema).max(200).default([])
}).superRefine((combat, context) => {
  const actorIds = new Set<string>();
  for (const [index, entry] of combat.initiative.entries()) {
    if (actorIds.has(entry.actorId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["initiative", index, "actorId"], message: "Initiative actor IDs must be unique." });
    actorIds.add(entry.actorId);
  }
  if (combat.active && combat.initiative.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["initiative"], message: "An active encounter requires at least one combatant." });
  if (combat.active && combat.turnActorId === null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["turnActorId"], message: "An active encounter requires a current turn." });
  if (combat.turnActorId !== null && !actorIds.has(combat.turnActorId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["turnActorId"], message: "The current turn actor must be in Initiative." });
});
export type CombatState = z.infer<typeof CombatStateSchema>;

export const GameStateSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative().default(0),
  actors: z.array(ActorSchema).default([]),
  rolls: z.array(RollRecordSchema).default([]),
  combat: CombatStateSchema.default({ active: false, round: 1, turnActorId: null, mapAssetId: null, initiative: [] })
});
export type GameState = z.infer<typeof GameStateSchema>;
export type ClientRole = "player" | "gm";

/** Server-authoritative connection presence for a claimed character's owning session. Never carries a session ID, token, socket ID, or address across the wire. */
export const PresenceStatusSchema = z.enum(["online", "reconnecting", "offline"]);
export type PresenceStatus = z.infer<typeof PresenceStatusSchema>;

export type PlayerActor = Omit<Actor, "notes" | "ownerSessionId"> & { claimStatus: "available" | "mine" | "claimed"; presence: PresenceStatus | null };
export type PlayerInitiativeEntry = Readonly<{ actorId: string; name: string; score: number; active: boolean }>;
export type PlayerCombatView = Readonly<{ active: boolean; round: number; turnActorId: string | null; mapAssetId: string | null; hiddenTurn: boolean; initiative: readonly PlayerInitiativeEntry[] }>;
export type PlayerView = Pick<GameState, "revision"> & { combat: PlayerCombatView; actors: PlayerActor[]; rolls: PlayerRollRecord[] };
export type GmActor = Actor & { presence: PresenceStatus | null };
export type GmView = Omit<GameState, "actors"> & { actors: GmActor[] };

export interface ServerToClientEvents { "state:updated": (state: PlayerView | GmView) => void; "system:error": (message: string) => void; }
export type SessionJoinResult = { ok: boolean; role?: ClientRole; sessionId?: string; token?: string; message?: string };
export type MutationResult = { ok: boolean; revision?: number; duplicate?: boolean; message?: string };
export type DiceRollResult = MutationResult & { rollId?: string; hiddenFromRoller?: boolean };
export type EncounterStartEntry = Readonly<{ actorId: string; score?: number }>;
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
}
