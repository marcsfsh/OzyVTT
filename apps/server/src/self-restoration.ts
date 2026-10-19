import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { setCondition } from "./actor-conditions.js";
import { holdsFeature } from "./class-features.js";
import { conditionLabel } from "./condition-rules.js";
import { endEffect, type EffectNarration } from "./effects.js";

/** SRD Self-Restoration (Monk 10): "you can remove one of the following conditions from yourself at the end of each of
 *  your turns: Charmed, Frightened, or Poisoned." */
const RESTORED = ["charmed", "frightened", "poisoned"] as const;

/**
 * As the Monk's turn ends, one of those conditions it has ends, the first of them in that order when it has several.
 * An effect that does nothing but impose it ends with it (a Frightened from Cause Fear); one that does more keeps its
 * other parts.
 */
export function selfRestorationAtTurnEnd(
  state: GameState,
  actorId: string,
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined
): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor || actor.hp.current <= 0) return [];
  const definition = actor.definitionId ? resolveDefinition(actor.definitionId) : undefined;
  if (!holdsFeature(definition, "self-restoration", "Self-Restoration")) return [];
  const conditionId = RESTORED.find((id) => actor.conditions.some((condition) => condition.id === id));
  if (!conditionId) return [];
  const events: EffectNarration[] = [];
  for (const effect of [...actor.effects]) {
    const only =
      effect.linkedConditionIds.length === 1 &&
      effect.linkedConditionIds[0] === conditionId &&
      effect.modifiers.length === 0;
    if (only) events.push(...endEffect(state, actor.id, effect.id));
  }
  events.push(...setCondition(state, actor.id, conditionId, false, undefined, { role: "gm" }));
  events.push({
    kind: "condition",
    text: `${actor.name} is no longer ${conditionLabel(conditionId)} (Self-Restoration).`,
    actorId: actor.id
  });
  return events;
}
