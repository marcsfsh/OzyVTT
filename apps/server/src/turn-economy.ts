import type { GameState } from "@vtt/domain";
import {
  canInitiateForActor,
  GameAccessDeniedError,
  requireActorAccess,
  requireGm,
  type Initiator
} from "./authorization.js";
import { CommandRejectedError, RulesBlockedError } from "./game-store.js";
import { nextInitiativeTurn, type TurnAdvanceDeps } from "./encounter.js";
import type { EffectNarration } from "./effects.js";
import { effectiveModeFor, overrideCovers } from "./rules-families.js";

/** Manual economy toggles (ADR-0020): marking a slot spent is bookkeeping anyone may do for their own creature.
 *  Giving a spent one back lets the creature act again, so under a policed economy only the GM does that. */

/** A player un-marking a spent action, Bonus Action or Reaction would act twice (SRD: one of each per turn, a
 *  Reaction until the start of your next turn). Strict refuses it, advised lets it through with a GM note, and an
 *  economy the GM turned off says nothing. The GM is never refused. */
function policeGiveBack(state: GameState, initiator: Initiator, spent: string, notes?: string[]): void {
  if (initiator.role !== "player") return;
  const rule = "economy.spent-slot" as const;
  const mode = effectiveModeFor(state.combat, rule);
  if (mode === "freeform" || overrideCovers(state.combat.turn, rule)) return;
  const message = `${spent} is spent - only the GM can give it back.`;
  if (mode === "strict") throw new RulesBlockedError(rule, message);
  notes?.push(message);
}

const actorName = (state: GameState, actorId: string | null) =>
  state.actors.find((actor) => actor.id === actorId)?.name ?? "That creature";

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
export function setTurnSlot(
  state: GameState,
  slot: "action" | "bonus-action",
  used: boolean,
  initiator: Initiator,
  notes?: string[]
) {
  requireActiveCombat(state);
  requireOwnTurn(state, initiator);
  const spent = slot === "action" ? state.combat.turn.actionUsed : state.combat.turn.bonusActionUsed;
  if (!used && spent)
    policeGiveBack(
      state,
      initiator,
      `${actorName(state, state.combat.turnActorId)}'s ${slot === "action" ? "action" : "Bonus Action"}`,
      notes
    );
  // Un-marking a slot clears its open compound instance too.
  state.combat = {
    ...state.combat,
    turn: {
      ...state.combat.turn,
      [slot === "action" ? "actionUsed" : "bonusActionUsed"]: used,
      ...(!used ? { [slot === "action" ? "actionInstance" : "bonusActionInstance"]: null } : {})
    }
  };
}

/** Reactions are off-turn resources: any combatant, any time; a player only their own character. */
export function setReactionUsed(
  state: GameState,
  actorId: string,
  used: boolean,
  initiator: Initiator,
  notes?: string[]
) {
  requireActiveCombat(state);
  if (!state.combat.initiative.some((entry) => entry.actorId === actorId))
    throw new CommandRejectedError("That combatant is not in this encounter.");
  requireActorAccess(initiator, state, actorId, "track", "You can only track your own character.");
  if (!used && state.combat.reactionsUsed.includes(actorId))
    policeGiveBack(state, initiator, `${actorName(state, actorId)}'s Reaction`, notes);
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
