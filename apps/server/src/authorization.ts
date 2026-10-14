import type { GameState } from "@vtt/domain";
import { CommandRejectedError } from "./game-store.js";

/** The principal may not do this: a GM-only command from a player, or a player acting on a character that
 *  is not theirs. Always a 403 over HTTP. */
export class GameAccessDeniedError extends Error {}

/** What a principal is trying to initiate on an actor; lets a per-table policy vary by action class. */
export type InitiateKind = "attack" | "check" | "save" | "resource" | "inventory" | "edit" | "track" | "move";

/** Who is acting, reduced to what authorization reads: GM-grade (the GM and integrations) or a player session. */
export type Initiator = Readonly<{ role: "gm" }> | Readonly<{ role: "player"; sessionId: string }>;

export type InitiateVerdict = { ok: true } | { ok: false; missing: boolean; message: string };

const NOT_YOURS = "You can only act on your own character.";

/** The single decision for "may this principal initiate this kind of action on this actor?". The GM
 *  (and integrations) may act on anyone; a player only on their claimed player-character. A future
 *  per-table policy would be read here and nowhere else. */
export function canInitiateForActor(
  initiator: Initiator,
  state: GameState,
  actorId: string,
  _kind: InitiateKind
): InitiateVerdict {
  if (initiator.role === "gm") return { ok: true };
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) return { ok: false, missing: true, message: "That combatant no longer exists." };
  if (actor.kind !== "player-character" || actor.ownerSessionId !== initiator.sessionId)
    return { ok: false, missing: false, message: NOT_YOURS };
  return { ok: true };
}

/** `canInitiateForActor` as a guard: a missing actor is a rejection, someone else's a denial. `denial`
 *  words the refusal for the action at hand. */
export function requireActorAccess(
  initiator: Initiator,
  state: GameState,
  actorId: string,
  kind: InitiateKind,
  denial = NOT_YOURS
) {
  const verdict = canInitiateForActor(initiator, state, actorId, kind);
  if (verdict.ok) return;
  if (verdict.missing) throw new CommandRejectedError(verdict.message);
  throw new GameAccessDeniedError(denial);
}

/** A GM-only step inside a shared rules path; the command gate usually refuses the player first. */
export function requireGm(initiator: Initiator, denial: string) {
  if (initiator.role !== "gm") throw new GameAccessDeniedError(denial);
}

/**
 * Whether a player may target this combatant: public ones only. The server must not trust client target
 * ids, since resolving against a hidden actor would leak its name/AC/outcome through the resolve ack
 * (which bypasses the projection) and in direct mode damage it. Gates the acted-upon actor;
 * `canInitiateForActor` gates the acting one.
 */
export function canPlayerTarget(state: GameState, targetId: string): boolean {
  const target = state.actors.find((candidate) => candidate.id === targetId);
  return target !== undefined && target.visibility === "public";
}
