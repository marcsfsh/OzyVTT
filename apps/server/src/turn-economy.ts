import type { GameState } from "@vtt/domain";
import { CommandRejectedError } from "./game-store.js";
import { nextInitiativeTurn } from "./encounter.js";
import type { ActorScope } from "./hit-points.js";

/** Tracked, never enforced (ADR-0008 reference level): marking a slot spent is bookkeeping, not a gate. */

function claimedActorId(state: GameState, sessionId: string): string | null {
  return state.actors.find((actor) => actor.ownerSessionId === sessionId)?.id ?? null;
}

function requireActiveCombat(state: GameState) {
  if (!state.combat.active) throw new CommandRejectedError("Start an encounter before tracking turns.");
}

/** Action/bonus belong to the current turn; a player may mark them only on their own character's turn. */
export function setTurnSlot(state: GameState, slot: "action" | "bonus-action", used: boolean, scope: ActorScope) {
  requireActiveCombat(state);
  if (scope.role === "player" && state.combat.turnActorId !== claimedActorId(state, scope.sessionId)) throw new CommandRejectedError("It isn't your character's turn.");
  state.combat = { ...state.combat, turn: { ...state.combat.turn, [slot === "action" ? "actionUsed" : "bonusActionUsed"]: used } };
}

/** Reactions are off-turn resources: any combatant, any time; a player only their own character. */
export function setReactionUsed(state: GameState, actorId: string, used: boolean, scope: ActorScope) {
  requireActiveCombat(state);
  if (!state.combat.initiative.some((entry) => entry.actorId === actorId)) throw new CommandRejectedError("That combatant is not in this encounter.");
  if (scope.role === "player" && actorId !== claimedActorId(state, scope.sessionId)) throw new CommandRejectedError("You can only track your own character.");
  const remaining = state.combat.reactionsUsed.filter((id) => id !== actorId);
  state.combat = { ...state.combat, reactionsUsed: used ? [...remaining, actorId] : remaining };
}

/** Player-facing End Turn: same advance as the GM's Next, gated to the claimed character's own turn. */
export function endTurn(state: GameState, scope: ActorScope) {
  requireActiveCombat(state);
  if (scope.role === "player" && state.combat.turnActorId !== claimedActorId(state, scope.sessionId)) throw new CommandRejectedError("It isn't your character's turn.");
  nextInitiativeTurn(state);
}
