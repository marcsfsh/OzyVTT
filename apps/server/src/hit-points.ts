import type { Actor, GameState, HealthBand } from "@vtt/domain";
import { CommandRejectedError } from "./game-store.js";

/** Who is asking: the GM may adjust anyone; a player only their own claimed character. */
export type ActorScope = { role: "gm" } | { role: "player"; sessionId: string };

export function healthBandOf(hp: Actor["hp"]): HealthBand {
  if (hp.current <= 0) return "down";
  return hp.current * 2 <= hp.maximum ? "bloodied" : "healthy";
}

/** Shared by hp and condition commands: resolve the target if the caller may adjust it. */
export function adjustableActor(state: GameState, actorId: string, scope: ActorScope): Actor {
  const actor = state.actors.find((item) => item.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  if (scope.role === "player" && actor.ownerSessionId !== scope.sessionId) throw new CommandRejectedError("You can only track your own character.");
  return actor;
}

/** 5e order: temporary hit points absorb damage first; current never drops below 0. */
export function applyDamage(state: GameState, actorId: string, amount: number, scope: ActorScope) {
  const actor = adjustableActor(state, actorId, scope);
  const absorbed = Math.min(actor.hp.temporary, amount);
  actor.hp.temporary -= absorbed;
  actor.hp.current = Math.max(0, actor.hp.current - (amount - absorbed));
}

/** Healing caps at maximum and never restores temporary hit points. */
export function healActor(state: GameState, actorId: string, amount: number, scope: ActorScope) {
  const actor = adjustableActor(state, actorId, scope);
  actor.hp.current = Math.min(actor.hp.maximum, actor.hp.current + amount);
}

/** Temporary hit points replace rather than stack (the 5e "take the higher" call stays at the table). */
export function setTemporaryHp(state: GameState, actorId: string, amount: number, scope: ActorScope) {
  const actor = adjustableActor(state, actorId, scope);
  actor.hp.temporary = amount;
}

/** Direct GM correction: set current hit points, clamped into 0..maximum. */
export function setCurrentHp(state: GameState, actorId: string, current: number, scope: ActorScope) {
  if (scope.role !== "gm") throw new CommandRejectedError("Only the GM can set hit points directly.");
  const actor = adjustableActor(state, actorId, scope);
  actor.hp.current = Math.max(0, Math.min(actor.hp.maximum, current));
}
