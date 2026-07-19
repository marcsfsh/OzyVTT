import type { GameState } from "@vtt/domain";
import { CommandRejectedError } from "./game-store.js";
import { nextInitiativeTurn, type TurnAdvanceDeps } from "./encounter.js";
import type { EffectNarration } from "./effects.js";
import type { ActorScope } from "./hit-points.js";

/**
 * Manual economy toggles stay free (ADR-0020): marking a slot is bookkeeping the GM may always
 * correct. Enforcement lives in structured action resolution, which validates against this state per
 * the encounter's rulesMode — so these toggles double as the documented manual escape hatch.
 */

function claimedActorId(state: GameState, sessionId: string): string | null {
  return state.actors.find((actor) => actor.ownerSessionId === sessionId)?.id ?? null;
}

function requireActiveCombat(state: GameState) {
  if (!state.combat.active) throw new CommandRejectedError("Start an encounter before tracking turns.");
}

/**
 * Action/bonus belong to the current turn; a player may mark them only on their own character's turn.
 * Un-marking the action slot also clears the open compound-action instance — the manual toggle is a
 * full reset of the structured state it bypasses, never a way to strand "attack 2 of 2".
 */
export function setTurnSlot(state: GameState, slot: "action" | "bonus-action", used: boolean, scope: ActorScope) {
  requireActiveCombat(state);
  if (scope.role === "player" && state.combat.turnActorId !== claimedActorId(state, scope.sessionId)) throw new CommandRejectedError("It isn't your character's turn.");
  const clearInstance = slot === "action" && !used;
  state.combat = {
    ...state.combat,
    turn: {
      ...state.combat.turn,
      [slot === "action" ? "actionUsed" : "bonusActionUsed"]: used,
      ...(clearInstance ? { actionInstance: null } : {})
    }
  };
}

/** Reactions are off-turn resources: any combatant, any time; a player only their own character. */
export function setReactionUsed(state: GameState, actorId: string, used: boolean, scope: ActorScope) {
  requireActiveCombat(state);
  if (!state.combat.initiative.some((entry) => entry.actorId === actorId)) throw new CommandRejectedError("That combatant is not in this encounter.");
  if (scope.role === "player" && actorId !== claimedActorId(state, scope.sessionId)) throw new CommandRejectedError("You can only track your own character.");
  const remaining = state.combat.reactionsUsed.filter((id) => id !== actorId);
  state.combat = { ...state.combat, reactionsUsed: used ? [...remaining, actorId] : remaining };
}

/** Legendary actions are monster resources (GM knowledge): only the GM sets the spent count by hand. Zero clears the entry, mirroring the refresh at the creature's own turn start. */
export function setLegendaryUsed(state: GameState, actorId: string, spent: number, scope: ActorScope) {
  requireActiveCombat(state);
  if (scope.role === "player") throw new CommandRejectedError("Only the GM tracks legendary actions.");
  if (!state.combat.initiative.some((entry) => entry.actorId === actorId)) throw new CommandRejectedError("That combatant is not in this encounter.");
  const { [actorId]: _cleared, ...rest } = state.combat.legendaryUsed;
  state.combat = { ...state.combat, legendaryUsed: spent === 0 ? rest : { ...rest, [actorId]: spent } };
}

/** Player-facing End Turn: same advance as the GM's Next, gated to the claimed character's own turn. */
export function endTurn(state: GameState, scope: ActorScope, events?: EffectNarration[], deps?: TurnAdvanceDeps) {
  requireActiveCombat(state);
  if (scope.role === "player" && state.combat.turnActorId !== claimedActorId(state, scope.sessionId)) throw new CommandRejectedError("It isn't your character's turn.");
  nextInitiativeTurn(state, events, deps);
}
