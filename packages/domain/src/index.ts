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

export const GameStateSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative().default(0),
  actors: z.array(ActorSchema).default([]),
  rolls: z.array(RollRecordSchema).default([]),
  combat: z.object({ active: z.boolean().default(false), round: z.number().int().positive().default(1), turnActorId: z.string().uuid().nullable().default(null) }).default({ active: false, round: 1, turnActorId: null })
});
export type GameState = z.infer<typeof GameStateSchema>;
export type ClientRole = "player" | "gm";
export type PlayerActor = Omit<Actor, "notes" | "ownerSessionId"> & { claimStatus: "available" | "mine" | "claimed" };
export type PlayerView = Pick<GameState, "combat" | "revision"> & { actors: PlayerActor[]; rolls: PlayerRollRecord[] };
export type GmView = GameState;

export interface ServerToClientEvents { "state:updated": (state: PlayerView | GmView) => void; "system:error": (message: string) => void; }
export type SessionJoinResult = { ok: boolean; role?: ClientRole; sessionId?: string; token?: string; message?: string };
export type MutationResult = { ok: boolean; revision?: number; duplicate?: boolean; message?: string };
export type DiceRollResult = MutationResult & { rollId?: string; hiddenFromRoller?: boolean };
export interface ClientToServerEvents {
  "session:join": (payload: { token?: string }, acknowledgement: (result: SessionJoinResult) => void) => void;
  "character:claim": (payload: { commandId: string; actorId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "character:release": (payload: { commandId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "character:force-release": (payload: { commandId: string; actorId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "dice:roll": (payload: { commandId: string; formula: string; purpose: RollPurpose; visibility: RollVisibility; actorId?: string; expectedRevision?: number }, acknowledgement: (result: DiceRollResult) => void) => void;
}
