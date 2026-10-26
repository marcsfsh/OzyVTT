import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { isIncapacitated } from "./condition-rules.js";
import { sideOf } from "./creature-sides.js";
import { addEffect, endEffect, makeEffect, type EffectNarration } from "./effects.js";
import { DISTANCE_TOLERANCE_FEET } from "./movement-narration.js";
import { traitOf } from "./statblock-traits.js";

/**
 * SRD 5.2.1 sahuagin, Shark Telepathy: "The sahuagin can magically control sharks within 120 feet of itself, using a
 * special telepathy." As the sahuagin's turn starts, each shark within its reach that no one else commands follows its
 * orders and fights on its side, kept by an effect on the shark; one beyond its reach, or with a sahuagin that can't
 * act, is its own again.
 */

/** The tag on the effect that keeps a creature under another's telepathic control. */
export const TELEPATHIC_CONTROL_TAG = "telepathic-control";

type Deps = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
}>;

export function telepathicControlAtTurnStart(state: GameState, actorId: string, deps: Deps): EffectNarration[] {
  const controller = state.actors.find((actor) => actor.id === actorId);
  const definition = controller?.definitionId ? deps.resolveDefinition(controller.definitionId) : undefined;
  const trait = traitOf(definition, "controls-kind");
  if (!controller || !trait) return [];
  const events: EffectNarration[] = [];
  const able = controller.hp.current > 0 && !isIncapacitated(controller);
  const side = sideOf(controller, deps.resolveDefinition) ?? "foes";
  for (const entry of state.combat.initiative) {
    const creature = state.actors.find((actor) => actor.id === entry.actorId);
    if (!creature || creature.id === controller.id) continue;
    const kind = creature.definitionId ? deps.resolveDefinition(creature.definitionId)?.name : undefined;
    if (!kind || !kind.toLowerCase().includes(trait.nameHas)) continue;
    const apart = deps.distanceFeet?.(controller.id, creature.id) ?? null;
    const within = apart === null || apart <= trait.withinFeet + DISTANCE_TOLERANCE_FEET;
    const held = creature.effects.find(
      (effect) => effect.tags.includes(TELEPATHIC_CONTROL_TAG) && effect.sourceActorId === controller.id
    );
    if (held && (!within || !able)) {
      events.push(...endEffect(state, creature.id, held.id));
      delete creature.control;
      events.push({
        kind: "effect",
        text: `${creature.name} is free of ${controller.name}'s ${trait.name}.`,
        actorId: creature.id,
        gmOnly: true
      });
      continue;
    }
    if (held || !within || !able || creature.control || creature.hp.current <= 0) continue;
    const effect = addEffect(
      state,
      creature.id,
      makeEffect({
        id: `${creature.id}:${TELEPATHIC_CONTROL_TAG}:${controller.id}`,
        name: `Controlled by ${controller.name} (${trait.name})`,
        tags: [TELEPATHIC_CONTROL_TAG],
        sourceActorId: controller.id,
        sourceName: controller.name,
        startedRound: state.combat.round,
        duration: { type: "manual" }
      })
    );
    creature.control = { by: controller.id, side, keptBy: effect.id };
    events.push({
      kind: "effect",
      text: `${creature.name} follows ${controller.name}'s orders (${trait.name}).`,
      actorId: creature.id,
      gmOnly: true
    });
  }
  return events;
}
