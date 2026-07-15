import { z } from "zod";
import { ActorSchema, type Actor } from "@vtt/schemas";

export { ACTOR_SCHEMA_VERSION, ActorSchema, type Actor } from "@vtt/schemas";

export const GameStateSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative().default(0),
  actors: z.array(ActorSchema).default([]),
  combat: z.object({ active: z.boolean().default(false), round: z.number().int().positive().default(1), turnActorId: z.string().uuid().nullable().default(null) }).default({ active: false, round: 1, turnActorId: null })
});
export type GameState = z.infer<typeof GameStateSchema>;
export type ClientRole = "player" | "gm";
export type PlayerView = Pick<GameState, "combat" | "revision"> & { actors: Array<Omit<Actor, "notes" | "ownerSessionId">> };
export type GmView = GameState;

export interface ServerToClientEvents { "state:updated": (state: PlayerView | GmView) => void; "system:error": (message: string) => void; }
export type SessionJoinResult = { ok: boolean; role?: ClientRole; sessionId?: string; token?: string; message?: string };
export type MutationResult = { ok: boolean; revision?: number; duplicate?: boolean; message?: string };
export interface ClientToServerEvents {
  "session:join": (payload: { token?: string }, acknowledgement: (result: SessionJoinResult) => void) => void;
  "character:claim": (payload: { commandId: string; actorId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
  "character:release": (payload: { commandId: string; expectedRevision?: number }, acknowledgement: (result: MutationResult) => void) => void;
}
