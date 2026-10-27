import type { EffectInstance, GameState } from "@vtt/domain";
import { AURA_IMMUNE_TAG, traitActionId } from "./statblock-traits.js";

type Actor = GameState["actors"][number];

/**
 * How long the immunity a successful save earns lasts (SRD 5.2.1: "immune to this werewolf's curse for 24 hours",
 * Antipathy/Sympathy's "immune to it for 1 minute"): the printed minutes on the game clock, kept in rounds up to ten
 * minutes so a fight counts them down, or the rest of the fight when the text prints no time.
 */
export function immunityDuration(minutes: number | undefined): EffectInstance["duration"] {
  if (minutes === undefined) return { type: "encounter" };
  return minutes <= 10 ? { type: "rounds", remaining: minutes * 10 } : { type: "minutes", remaining: minutes };
}

/** Whether the creature succeeded against this action of this source earlier and is still immune to it. */
export function immuneToActionOf(target: Actor, sourceActorId: string, actionName: string): boolean {
  const key = traitActionId(actionName);
  return target.effects.some(
    (effect) =>
      effect.tags.includes(AURA_IMMUNE_TAG) && effect.sourceActorId === sourceActorId && effect.sourceActionId === key
  );
}
