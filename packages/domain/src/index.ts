import { z } from "zod";
import { ActorSchema, type Actor } from "@vtt/schemas";

export { ACTOR_SCHEMA_VERSION, ActorSchema, type Actor } from "@vtt/schemas";

export const GameStateSchema = z.object({
  schemaVersion: z.literal(1),
  actors: z.array(ActorSchema).default([]),
  combat: z.object({ active: z.boolean().default(false), round: z.number().int().positive().default(1), turnActorId: z.string().uuid().nullable().default(null) }).default({ active: false, round: 1, turnActorId: null })
});
export type GameState = z.infer<typeof GameStateSchema>;
export type ClientRole = "player" | "gm";
export type PlayerView = Pick<GameState, "combat"> & { actors: Array<Omit<Actor, "notes" | "ownerSessionId">> };
export type GmView = GameState;

export interface ServerToClientEvents { "state:updated": (state: PlayerView | GmView) => void; "system:error": (message: string) => void; }
export type SessionJoinResult = { ok: boolean; role?: ClientRole; sessionId?: string; token?: string; message?: string };
export interface ClientToServerEvents {
  "session:join": (payload: { token?: string }, acknowledgement: (result: SessionJoinResult) => void) => void;
  "character:claim": (payload: { actorId: string }, acknowledgement: (result: { ok: boolean; message?: string }) => void) => void;
  "character:release": (acknowledgement: (result: { ok: boolean; message?: string }) => void) => void;
}
