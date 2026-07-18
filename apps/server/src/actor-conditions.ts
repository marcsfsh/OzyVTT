import type { GameState } from "@vtt/domain";
import { CommandRejectedError } from "./game-store.js";
import { adjustableActor, type ActorScope } from "./hit-points.js";
import { applyExhaustionDeath, type EffectNarration } from "./effects.js";
import { conditionLabel, exhaustionLevel } from "./condition-rules.js";

/**
 * Track a condition on an actor. Display remains the source of truth for prose effects, but the
 * engine now owns the mechanical hooks (ADR-0020 amendments): condition immunities skip with
 * narration instead of applying, and Exhaustion reaching level 6 is death. Returns narration events
 * for the caller to log. `level` is exhaustion's 1-6; other conditions carry none. Setting an
 * already-active condition updates its level; clearing an absent one is a no-op.
 */
export function setCondition(state: GameState, actorId: string, conditionId: string, active: boolean, level: number | undefined, scope: ActorScope): EffectNarration[] {
  const actor = adjustableActor(state, actorId, scope);
  if (level !== undefined && conditionId !== "exhaustion") throw new CommandRejectedError("Only exhaustion has levels.");
  const remaining = actor.conditions.filter((condition) => condition.id !== conditionId);
  if (!active) { actor.conditions = remaining; return []; }
  // Immunity: skip-with-narration rather than blocking — this is a manual GM command, and telling
  // the table WHY nothing happened beats a rejection dialog (SRD condition immunity).
  if (actor.conditionImmunities.includes(conditionId)) {
    return [{ kind: "condition", text: `${actor.name} is immune to ${conditionLabel(conditionId)} — not applied.`, actorId: actor.id }];
  }
  if (remaining.length >= 20) throw new CommandRejectedError("That combatant already has too many conditions.");
  const previousExhaustion = exhaustionLevel(actor);
  actor.conditions = [...remaining, { id: conditionId, ...(conditionId === "exhaustion" ? { level: level ?? 1 } : {}) }]
    .sort((left, right) => left.id.localeCompare(right.id));
  // SRD: Exhaustion level 6 is death — same engine-owned transition the onEnd grant path fires.
  if (conditionId === "exhaustion" && previousExhaustion < 6 && (level ?? 1) >= 6) {
    return applyExhaustionDeath(state, actor);
  }
  return [];
}
