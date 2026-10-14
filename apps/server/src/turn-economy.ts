import type { GameState } from "@vtt/domain";
import {
  canInitiateForActor,
  GameAccessDeniedError,
  requireActorAccess,
  requireGm,
  type Initiator
} from "./authorization.js";
import { CommandRejectedError } from "./game-store.js";
import { nextInitiativeTurn, type TurnAdvanceDeps } from "./encounter.js";
import type { EffectNarration } from "./effects.js";

/** Manual economy toggles stay free (ADR-0020): marking a slot is bookkeeping the GM may always correct.
 *  Enforcement lives in structured action resolution, so these toggles are the manual escape hatch. */

/** A player's slots and End Turn belong to their own character's turn. */
function requireOwnTurn(state: GameState, initiator: Initiator) {
  const turnActorId = state.combat.turnActorId;
  if (turnActorId === null || !canInitiateForActor(initiator, state, turnActorId, "track").ok)
    throw new GameAccessDeniedError("It isn't your character's turn.");
}

function requireActiveCombat(state: GameState) {
  if (!state.combat.active) throw new CommandRejectedError("Start an encounter before tracking turns.");
}

/** Action/bonus belong to the current turn; a player may mark them only on their own character's turn.
 *  Un-marking the action also clears the open compound-action instance, so the toggle never strands
 *  "attack 2 of 2". */
export function setTurnSlot(state: GameState, slot: "action" | "bonus-action", used: boolean, initiator: Initiator) {
  requireActiveCombat(state);
  requireOwnTurn(state, initiator);
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
export function setReactionUsed(state: GameState, actorId: string, used: boolean, initiator: Initiator) {
  requireActiveCombat(state);
  if (!state.combat.initiative.some((entry) => entry.actorId === actorId))
    throw new CommandRejectedError("That combatant is not in this encounter.");
  requireActorAccess(initiator, state, actorId, "track", "You can only track your own character.");
  const remaining = state.combat.reactionsUsed.filter((id) => id !== actorId);
  state.combat = { ...state.combat, reactionsUsed: used ? [...remaining, actorId] : remaining };
}

/** Legendary actions are GM knowledge: only the GM sets the spent count by hand. Zero clears the entry, like the refresh at the creature's turn start. */
export function setLegendaryUsed(state: GameState, actorId: string, spent: number, initiator: Initiator) {
  requireActiveCombat(state);
  requireGm(initiator, "Only the GM tracks legendary actions.");
  if (!state.combat.initiative.some((entry) => entry.actorId === actorId))
    throw new CommandRejectedError("That combatant is not in this encounter.");
  const { [actorId]: _cleared, ...rest } = state.combat.legendaryUsed;
  state.combat = { ...state.combat, legendaryUsed: spent === 0 ? rest : { ...rest, [actorId]: spent } };
}

/** Player-facing End Turn: same advance as the GM's Next, gated to the claimed character's own turn. */
export function endTurn(state: GameState, initiator: Initiator, events?: EffectNarration[], deps?: TurnAdvanceDeps) {
  requireActiveCombat(state);
  requireOwnTurn(state, initiator);
  nextInitiativeTurn(state, events, deps);
}
