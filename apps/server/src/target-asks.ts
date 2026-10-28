import type { GameState, TargetAsk } from "@vtt/domain";
import type { CastShaping } from "@vtt/schemas";
import type { Initiator } from "./authorization.js";
import { requireActorAccess } from "./authorization.js";
import { CommandRejectedError } from "./game-store.js";

/**
 * A player's action waiting for the GM to pick its targets, at a table where the GM picks them (ADR-0044). The ask
 * holds only the action and how its player chose to cast it; the GM aims it and resolves it with their own command,
 * which checks the turn, the cost and the targets as any resolve does.
 */

/** Whether a player's resolve must leave its targets to the GM: the table says so and the character is in the
 *  running encounter. Outside one, the player aims as before. */
export function gmPicksTargets(state: GameState, actorId: string): boolean {
  return (
    state.targeting === "gm" &&
    state.combat.active &&
    state.combat.initiative.some((entry) => entry.actorId === actorId)
  );
}

export function askForTarget(
  state: GameState,
  scope: Initiator,
  request: Readonly<{
    actorId: string;
    actionId: string;
    slotLevel?: number;
    darts?: number;
    shaping?: readonly CastShaping[];
  }>,
  actionName: (state: GameState, actorId: string, actionId: string) => string | null,
  deps: Readonly<{ newId: () => string; now: () => number }>
): TargetAsk {
  requireActorAccess(scope, state, request.actorId, "attack");
  if (scope.role === "gm") throw new CommandRejectedError("You pick the targets yourself.");
  if (state.targeting !== "gm") throw new CommandRejectedError("At this table you pick your own targets.");
  const actor = state.actors.find((candidate) => candidate.id === request.actorId)!;
  if (!gmPicksTargets(state, actor.id)) throw new CommandRejectedError("The GM picks targets during an encounter.");
  const readied = actor.effects.some((effect) => effect.tags.includes("readied"));
  if (state.combat.turnActorId !== actor.id && !readied)
    throw new CommandRejectedError(`It isn't ${actor.name}'s turn.`);
  const waiting = state.combat.targetAsks.find((ask) => ask.actorId === actor.id);
  if (waiting)
    throw new CommandRejectedError(
      `${actor.name}'s ${waiting.actionName} is still waiting for the GM. Take it back to choose another action.`
    );
  const name = actionName(state, actor.id, request.actionId);
  if (name === null) throw new CommandRejectedError("That action is not on the stat block.");
  const ask: TargetAsk = {
    id: deps.newId(),
    actorId: actor.id,
    actorName: actor.name,
    actionId: request.actionId,
    actionName: name,
    ...(request.slotLevel !== undefined ? { slotLevel: request.slotLevel } : {}),
    ...(request.darts !== undefined ? { darts: request.darts } : {}),
    ...(request.shaping && request.shaping.length > 0
      ? { shaping: request.shaping.map((entry) => ({ ...entry })) }
      : {}),
    createdAt: deps.now()
  };
  state.combat = { ...state.combat, targetAsks: [...state.combat.targetAsks, ask] };
  return ask;
}

/** Its player takes the ask back, or the GM declines it. */
export function withdrawTargetAsk(state: GameState, scope: Initiator, askId: string): TargetAsk {
  const ask = state.combat.targetAsks.find((candidate) => candidate.id === askId);
  if (!ask) throw new CommandRejectedError("That action is no longer waiting.");
  requireActorAccess(scope, state, ask.actorId, "attack");
  state.combat = { ...state.combat, targetAsks: state.combat.targetAsks.filter((candidate) => candidate.id !== askId) };
  return ask;
}

/** The GM resolved an action for this character: whatever it asked them to aim is answered. */
export function answerTargetAsks(state: GameState, actorId: string): void {
  if (!state.combat.targetAsks.some((ask) => ask.actorId === actorId)) return;
  state.combat = { ...state.combat, targetAsks: state.combat.targetAsks.filter((ask) => ask.actorId !== actorId) };
}
