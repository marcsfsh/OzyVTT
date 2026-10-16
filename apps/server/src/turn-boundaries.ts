import type { GameState } from "@vtt/domain";
import { expireEffectsAtTurnEnd, sourceOf, type EffectNarration } from "./effects.js";
import { createPendingSaves } from "./saving-throws.js";

/** What the end-of-turn step needs to open prompts; without it (scene bookkeeping) durations still end. */
export type TurnEndDeps = Readonly<{ newId: () => string; now: () => string }>;

/**
 * SRD: "at the end of its turn". When `actorId`'s turn ends, before the next begins:
 * 1. "until the end of its/your next turn" durations it owns end (`expireEffectsAtTurnEnd`);
 * 2. each effect it bears that "repeats the save at the end of each of its turns" opens that save, a success ending
 *    the effect (`openRepeatSaves`).
 * Ongoing harm printed for the end of a turn ("takes 5 damage at the end of each of its turns") belongs here as a
 * further step, after the durations and before the saves, and the start-of-turn twin beside `expireEffectsAtTurnStart`.
 */
export function endOfTurn(state: GameState, actorId: string, events: EffectNarration[], deps?: TurnEndDeps): void {
  events.push(...expireEffectsAtTurnEnd(state, actorId));
  if (deps) events.push(...openRepeatSaves(state, actorId, deps));
}

/** One pending save per repeating effect the creature bears. An unanswered one from its last turn is replaced. */
export function openRepeatSaves(state: GameState, actorId: string, deps: TurnEndDeps): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) return [];
  const events: EffectNarration[] = [];
  for (const effect of actor.effects) {
    if (!effect.repeatSave) continue;
    createPendingSaves(state, {
      sourceActorId: effect.sourceActorId,
      sourceName: effect.sourceName ?? effect.name,
      actionName: `${effect.name} - repeat save`.slice(0, 120),
      ability: effect.repeatSave.ability,
      dc: effect.repeatSave.dc,
      targetIds: [actor.id],
      proposedDamage: 0,
      halfOnSuccess: false,
      conditionIds: [],
      repeatOf: { actorId: actor.id, effectId: effect.id },
      newSaveId: deps.newId,
      createdAt: Date.parse(deps.now())
    });
    events.push({
      kind: "condition",
      text: `${actor.name} repeats the ${effect.repeatSave.ability.toUpperCase()} save against ${effect.name} (DC ${effect.repeatSave.dc}); a success ends it.`,
      actorId: actor.id,
      ...sourceOf(effect)
    });
  }
  return events;
}
