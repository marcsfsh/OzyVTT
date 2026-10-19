import type { GameState, TurnSteps } from "@vtt/domain";
import { requireActorAccess, type Initiator } from "./authorization.js";
import type { EffectNarration } from "./effects.js";
import { CommandRejectedError } from "./game-store.js";

/**
 * SRD 5.2.1 Rules Glossary, Simultaneous Effects: "If two or more things happen at the same time on a creature's turn,
 * the person at the game table (player or Game Master) who controls that creature decides the order in which those
 * things happen." What a turn's start or end does at once (ongoing damage, Hit Points or Temporary Hit Points regained,
 * a trait that burns or regenerates) is a list of steps; with two or more, the turn waits for its creature's
 * controller to put them in order (`combat.turnSteps`). Saves a turn opens are prompts already answered in any order.
 */

/** One thing that happens as a turn starts or ends, named for its effect or trait. `run` reads the state as it is when
 *  the step's turn in the order comes. */
export type TurnStep = Readonly<{
  key: string;
  name: string;
  targetActorId?: string;
  targetName?: string;
  sourceActorId?: string | null;
  sourceName?: string | null;
  run: () => EffectNarration[];
}>;

type Boundary = TurnSteps["boundary"];

/** The steps in the order given: the keys it names first, then any it doesn't, in their own order. */
export function inOrder(steps: readonly TurnStep[], order: readonly string[] | undefined): TurnStep[] {
  if (!order) return [...steps];
  const named = order.flatMap((key) => steps.filter((step) => step.key === key));
  return [...named, ...steps.filter((step) => !order.includes(step.key))];
}

/** Runs the steps one after another, each against the state the ones before it left. */
export function runSteps(steps: readonly TurnStep[]): EffectNarration[] {
  return steps.flatMap((step) => step.run());
}

/** The steps waiting on `actorId`'s controller at this boundary, if any. */
export function waitingSteps(state: GameState, actorId: string, boundary: Boundary): TurnSteps | null {
  const waiting = state.combat.turnSteps;
  return waiting && waiting.actorId === actorId && waiting.boundary === boundary ? waiting : null;
}

/** The order to play a boundary's steps in: the controller's answer, or the order the steps were listed in. */
export const orderOf = (waiting: TurnSteps) => waiting.order ?? waiting.steps.map((step) => step.key);

export const clearTurnSteps = (state: GameState) => {
  if (state.combat.turnSteps !== null) state.combat = { ...state.combat, turnSteps: null };
};

/** Two or more steps wait for the controller's order; fewer simply happen. Returns whether the turn now waits. */
export function askOrder(
  state: GameState,
  actorId: string,
  boundary: Boundary,
  steps: readonly TurnStep[],
  newId: () => string
): boolean {
  if (steps.length < 2) return false;
  state.combat = {
    ...state.combat,
    turnSteps: {
      id: newId(),
      actorId,
      boundary,
      steps: steps.map((step) => ({
        key: step.key,
        name: step.name,
        ...(step.targetActorId ? { targetActorId: step.targetActorId } : {}),
        ...(step.targetName ? { targetName: step.targetName } : {}),
        ...(step.sourceActorId ? { sourceActorId: step.sourceActorId } : {}),
        ...(step.sourceName ? { sourceName: step.sourceName } : {})
      }))
    }
  };
  return true;
}

/** The narration that tells the table a turn waits for its order. */
export function waitingNarration(state: GameState, waiting: TurnSteps): EffectNarration {
  const name = state.actors.find((actor) => actor.id === waiting.actorId)?.name ?? "The creature";
  return {
    kind: "effect",
    text: `${waiting.steps.length} things happen at once as ${name}'s turn ${waiting.boundary === "start" ? "starts" : "ends"}. ${name}'s controller puts them in order.`,
    actorId: waiting.actorId
  };
}

/**
 * Checks an answer to the waiting steps: the creature's controller (its player, or the GM) names every step once.
 * Returns the steps it answers.
 */
export function checkOrder(
  state: GameState,
  initiator: Initiator,
  stepsId: string,
  order: readonly string[]
): TurnSteps {
  const waiting = state.combat.turnSteps;
  if (!waiting || waiting.id !== stepsId)
    throw new CommandRejectedError("Those steps are no longer waiting. The turn moved on.");
  requireActorAccess(
    initiator,
    state,
    waiting.actorId,
    "track",
    "Only the creature's controller puts its turn in order."
  );
  const keys = waiting.steps.map((step) => step.key);
  if (order.length !== keys.length || new Set(order).size !== order.length || order.some((key) => !keys.includes(key)))
    throw new CommandRejectedError("Put every step in the order once.");
  return waiting;
}

/** A player's creature acts only once what its turn's start does is in order. */
export function requireStartOrdered(state: GameState, actorId: string, initiator: Initiator): void {
  if (initiator.role === "player" && waitingSteps(state, actorId, "start"))
    throw new CommandRejectedError("Put what happens as your turn starts in order first.");
}
