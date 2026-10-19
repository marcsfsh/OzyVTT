import type { Actor, EffectInstance } from "@vtt/domain";
import { conditionLabel } from "./condition-rules.js";

/**
 * Conditions an effect holds off while it lasts and gives back when it ends (SRD Calm Emotions: "If the target has the
 * Charmed or Frightened condition, the condition is suppressed for the duration"). The held entry keeps its level and
 * whose mark it was; one held on its own (a GM's chip, a player's mark) comes back whatever else ended meanwhile, and
 * one an effect imposed comes back only while that effect still holds it.
 */

type Held = NonNullable<EffectInstance["suppressedConditions"]>[number];

const linkedByAnEffect = (actor: Actor, conditionId: string) =>
  actor.effects.some((effect) => effect.linkedConditionIds.includes(conditionId));

/** Takes each of `conditionIds` the bearer has off it, and returns them as the effect keeps them. */
export function suppressConditions(actor: Actor, conditionIds: readonly string[]): Held[] {
  const held: Held[] = [];
  for (const conditionId of conditionIds) {
    const entry = actor.conditions.find((condition) => condition.id === conditionId);
    if (!entry || held.length >= 6) continue;
    const linked = linkedByAnEffect(actor, conditionId);
    held.push({
      id: entry.id as Held["id"],
      ...(entry.level !== undefined ? { level: entry.level } : {}),
      ...(entry.selfApplied ? { selfApplied: true as const } : {}),
      ...(entry.standalone || !linked ? { standalone: true as const } : {})
    });
    actor.conditions = actor.conditions.filter((condition) => condition.id !== conditionId);
  }
  return held;
}

/** Gives back what an ended effect held off, where it still applies. The lines the table reads. */
export function restoreSuppressed(actor: Actor, effect: EffectInstance): string[] {
  const lines: string[] = [];
  for (const held of effect.suppressedConditions ?? []) {
    if (actor.conditions.some((condition) => condition.id === held.id)) continue;
    const imposed = linkedByAnEffect(actor, held.id);
    if (!held.standalone && !imposed) continue;
    if (actor.conditions.length >= 20) continue;
    actor.conditions = [
      ...actor.conditions,
      {
        id: held.id,
        ...(held.level !== undefined ? { level: held.level } : {}),
        ...(held.selfApplied ? { selfApplied: true as const } : {}),
        // Set on its own and held by an effect besides, as `applyCondition` marks it.
        ...(held.standalone && imposed ? { standalone: true as const } : {})
      }
    ].sort((left, right) => left.id.localeCompare(right.id));
    lines.push(`${actor.name} is ${conditionLabel(held.id)} again (${effect.name} ended).`);
  }
  return lines;
}
