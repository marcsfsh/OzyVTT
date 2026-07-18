import type { GameState } from "@vtt/domain";
import { CommandRejectedError } from "./game-store.js";
import { adjustableActor, type ActorScope } from "./hit-points.js";

/**
 * Track a condition on an actor — reference level only (ADR-0008): displayed with the SRD
 * text, never auto-applied to rolls. `level` is exhaustion's 1-6; other conditions carry none.
 * Setting an already-active condition updates its level; clearing an absent one is a no-op.
 */
export function setCondition(state: GameState, actorId: string, conditionId: string, active: boolean, level: number | undefined, scope: ActorScope) {
  const actor = adjustableActor(state, actorId, scope);
  if (level !== undefined && conditionId !== "exhaustion") throw new CommandRejectedError("Only exhaustion has levels.");
  const remaining = actor.conditions.filter((condition) => condition.id !== conditionId);
  if (!active) { actor.conditions = remaining; return; }
  if (remaining.length >= 20) throw new CommandRejectedError("That combatant already has too many conditions.");
  actor.conditions = [...remaining, { id: conditionId, ...(conditionId === "exhaustion" ? { level: level ?? 1 } : {}) }]
    .sort((left, right) => left.id.localeCompare(right.id));
}
