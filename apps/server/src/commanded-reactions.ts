import type { GameState } from "@vtt/domain";

/**
 * SRD 5.2.1 Dominate Beast, Dominate Monster and Dominate Person: "You can command the target to take a Reaction but must
 * take your own Reaction to do so." A creature whose command comes from an effect tagged this way takes a Reaction
 * only while its commander has one, and taking it spends both.
 */

type Actor = GameState["actors"][number];

/** On a commanding effect, its creature's Reactions cost its commander's (the Dominate spells). */
export const COMMANDER_REACTION_TAG = "commander-reaction";

/** The commander whose Reaction this creature's Reaction also takes, if any. */
export function reactionCommander(state: Pick<GameState, "actors">, actor: Pick<Actor, "control" | "effects">) {
  const control = actor.control;
  if (!control?.keptBy) return undefined;
  const keeping = actor.effects.find((effect) => effect.id === control.keptBy);
  if (!keeping?.tags.includes(COMMANDER_REACTION_TAG)) return undefined;
  return state.actors.find((candidate) => candidate.id === control.by);
}

/** Whether the creature can't take a Reaction now: its own is spent, or its commander's when that pays for it. */
export function reactionSpent(state: Pick<GameState, "actors" | "combat">, actorId: string): boolean {
  const used = state.combat.reactionsUsed;
  if (used.includes(actorId)) return true;
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  const commander = actor ? reactionCommander(state, actor) : undefined;
  return commander !== undefined && used.includes(commander.id);
}

/** The creatures whose Reactions one Reaction of this creature spends: itself, and the commander that pays for it. */
export function reactionSpenders(state: Pick<GameState, "actors">, actorId: string): string[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  const commander = actor ? reactionCommander(state, actor) : undefined;
  return commander ? [actorId, commander.id] : [actorId];
}

/** Marks the creature's Reaction spent, and its commander's when that pays for it. */
export function spendReaction(state: GameState, actorId: string): void {
  const spenders = reactionSpenders(state, actorId);
  state.combat = {
    ...state.combat,
    reactionsUsed: [...state.combat.reactionsUsed.filter((id) => !spenders.includes(id)), ...spenders]
  };
}
