import type { GameState } from "@vtt/domain";

/** What a principal is trying to initiate on an actor; lets the policy vary by action class later. */
export type InitiateKind = "attack" | "check" | "save" | "resource" | "inventory" | "edit";

/** Who is acting, reduced to the fields the policy needs (derive from the principal at the call site). */
export type ActorInitiator = { role: "gm" } | { role: "player"; sessionId: string };

export type InitiateVerdict = { ok: true } | { ok: false; message: string };

/**
 * The single decision for "may this principal initiate this kind of action on this actor?" - the seam
 * every player-initiated command flows through. Today: the GM (and integrations) may act on anyone; a
 * player may act only on the player-character they have claimed. This is deliberately the ONE place a
 * future per-table policy (e.g. "players may initiate their own attacks") would read `state.combat`, so
 * that toggle becomes a one-field change here and nowhere else - the reason the 6+ duplicated ownership
 * checks are being funnelled through this function.
 */
export function canInitiateForActor(initiator: ActorInitiator, state: GameState, actorId: string, _kind: InitiateKind): InitiateVerdict {
  if (initiator.role === "gm") return { ok: true };
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) return { ok: false, message: "That combatant no longer exists." };
  if (actor.kind !== "player-character" || actor.ownerSessionId !== initiator.sessionId) return { ok: false, message: "You can only act on your own character." };
  return { ok: true };
}
