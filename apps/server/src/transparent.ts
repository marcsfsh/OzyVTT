import type { EffectInstance, GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { endEffect, makeEffect, type EffectNarration } from "./effects.js";
import { traitOf } from "./statblock-traits.js";

/**
 * SRD 5.2.1 gelatinous cube, Transparent: "A creature must succeed on a DC 15 Wisdom (Perception) check to notice the
 * cube if the creature hasn't witnessed the cube move or otherwise act." The cube joins the roster hidden as a Hide
 * leaves a creature, found by a Search whose Perception meets the printed DC, and seen by all once it moves or acts.
 */

/** On the hidden effect a transparent creature starts with, which its first move or action ends. */
export const TRANSPARENT_TAG = "transparent";

/** The hidden effect a transparent creature joins the roster with; none for any other. */
export function transparentEffects(
  actorId: string,
  name: string,
  definition: ActorDefinition | undefined
): EffectInstance[] {
  const trait = traitOf(definition, "transparent");
  if (!trait) return [];
  return [
    makeEffect({
      id: `${actorId}:${TRANSPARENT_TAG}`,
      name: `${trait.name} (DC ${trait.dc} to notice)`,
      tags: ["hidden", TRANSPARENT_TAG],
      sourceActorId: actorId,
      sourceName: name,
      startedRound: 1,
      duration: { type: "manual" },
      linkedConditionIds: ["invisible"],
      findDc: trait.dc
    })
  ];
}

/** The creature moved where others could witness it: a transparent one is noticed. Acting ends it in `release.ts`. */
export function seenToAct(state: GameState, actorId: string): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  const unseen = actor?.effects.find((effect) => effect.tags.includes(TRANSPARENT_TAG));
  if (!actor || !unseen) return [];
  return [
    ...endEffect(state, actor.id, unseen.id),
    { kind: "effect", text: `${actor.name} moved and is noticed.`, actorId: actor.id }
  ];
}
