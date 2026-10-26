import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { holdsFeature } from "./class-features.js";

/**
 * SRD Thief's Reflexes (Thief 17): "You can take two turns during the first round of any combat. You take your first
 * turn at your normal Initiative and your second turn at your Initiative minus 10." The second turn has no entry of its
 * own in the order: it comes when round 1 passes its score, and the turn after it is the one it came before
 * (`combat.secondTurn.resume`, null at the round's end).
 */

type Entry = GameState["combat"]["initiative"][number];

/** The second turn due between a turn at `fromScore` and the next one at `nextScore` (null: the round ends), the
 *  highest first; null when none is. */
export function secondTurnDue(
  state: GameState,
  fromScore: number,
  nextScore: number | null,
  resolveDefinition: ((definitionId: string) => ActorDefinition | undefined) | undefined,
  passedOver: (actorId: string) => boolean
): Readonly<{ actorId: string; score: number }> | null {
  if (state.combat.round !== 1 || !resolveDefinition) return null;
  const taken = new Set(state.combat.secondTurnsTaken);
  const due = state.combat.initiative
    .filter((entry: Entry) => !taken.has(entry.actorId) && !passedOver(entry.actorId))
    .flatMap((entry: Entry) => {
      const actor = state.actors.find((candidate) => candidate.id === entry.actorId);
      const definition = actor?.definitionId ? resolveDefinition(actor.definitionId) : undefined;
      if (!holdsFeature(definition, "thiefs-reflexes", "Thief's Reflexes")) return [];
      const score = entry.score - 10;
      // It comes after every turn at its score or higher, and before the first one below it.
      return score <= fromScore && (nextScore === null || score > nextScore) ? [{ actorId: entry.actorId, score }] : [];
    })
    .sort((left, right) => right.score - left.score);
  return due[0] ?? null;
}
