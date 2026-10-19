import type { GameState } from "@vtt/domain";
import type { DefinitionAction } from "./context.js";

/**
 * A Multiattack whose other plan opens once its creature used another action this turn: "The golem makes two Slam
 * attacks, or it makes three Slam attacks if it used Hasten this turn". Using the action leaves a mark on the turn,
 * which every new turn clears; while it stands the other plan is the Multiattack's plan, and without it there is none.
 */

/** The turn's mark that a creature used an action. */
const usedKey = (actorId: string, actionId: string) => `${actorId}:used:${actionId}`;

/** The Multiattack as it plans this turn: its other plan once the action it waits on was used, else its own alone. */
export function planThisTurn(state: GameState, actorId: string, action: DefinitionAction): DefinitionAction {
  const after = action.multiattackAlternativesAfter;
  if (!after || !action.multiattack) return action;
  const { multiattackAlternatives: alternatives, multiattackAlternativesAfter: _after, ...rest } = action;
  const used = (state.combat.turn.turnUses[usedKey(actorId, after)] ?? 0) > 0;
  const [first, ...others] = alternatives ?? [];
  if (!used || !first) return rest;
  return { ...rest, multiattack: first, ...(others.length > 0 ? { multiattackAlternatives: others } : {}) };
}

/** The mark this action leaves on its creature's turn, when a sibling's Multiattack waits on it; null otherwise. */
export function usedMarkOf(
  state: GameState,
  actorId: string,
  action: DefinitionAction,
  siblings: ReadonlyArray<DefinitionAction>
): string | null {
  if (!state.combat.active || state.combat.turnActorId !== actorId) return null;
  return siblings.some((sibling) => sibling.multiattackAlternativesAfter === action.id)
    ? usedKey(actorId, action.id)
    : null;
}
