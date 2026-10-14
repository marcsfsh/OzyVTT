import type { GameState } from "@vtt/domain";

/** What a principal is trying to initiate on an actor; lets a per-table policy vary by action class. */
export type InitiateKind = "attack" | "check" | "save" | "resource" | "inventory" | "edit";

/** Who is acting, reduced to the fields the policy needs (derive from the principal at the call site). */
export type ActorInitiator = { role: "gm" } | { role: "player"; sessionId: string };

export type InitiateVerdict = { ok: true } | { ok: false; message: string };

/** The single decision for "may this principal initiate this kind of action on this actor?". The GM
 *  (and integrations) may act on anyone; a player only on their claimed player-character. A future
 *  per-table policy would be read here and nowhere else. */
export function canInitiateForActor(initiator: ActorInitiator, state: GameState, actorId: string, _kind: InitiateKind): InitiateVerdict {
  if (initiator.role === "gm") return { ok: true };
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) return { ok: false, message: "That combatant no longer exists." };
  if (actor.kind !== "player-character" || actor.ownerSessionId !== initiator.sessionId) return { ok: false, message: "You can only act on your own character." };
  return { ok: true };
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
