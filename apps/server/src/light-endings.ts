import type { GameState } from "@vtt/domain";
import { endEffectIfPresent, type EffectNarration } from "./effects.js";
import { sightRules } from "./vision/rules.js";
import type { SightContent } from "./vision/senses.js";

/**
 * What lasts only in Dim Light or Darkness ends when its bearer stands in Bright Light (Cloak of the Bat: "if you are
 * no longer in Dim Light or Darkness, you lose this Fly Speed"). Read with dynamic vision after every command, as a move,
 * a light or a door changes it; with vision off the light is the GM's, so nothing ends. A flier that loses its Fly Speed
 * this way then falls (`falling.ts`).
 */

/** The effects that must end now: each bearer's, in Bright Light. */
export function brightLightEndings(
  state: GameState,
  content: SightContent
): ReadonlyArray<Readonly<{ actorId: string; effectId: string }>> {
  const gated = state.actors.filter((actor) => actor.effects.some((effect) => effect.endsInBrightLight));
  if (gated.length === 0) return [];
  const rules = sightRules(state, content);
  return gated.flatMap((actor) => {
    if (rules.lightAt(actor.id)?.level !== "bright") return [];
    return actor.effects
      .filter((effect) => effect.endsInBrightLight)
      .map((effect) => ({ actorId: actor.id, effectId: effect.id }));
  });
}

/** Ends what Bright Light ends, with a line for the table. */
export function settleBrightLight(state: GameState, content: SightContent): EffectNarration[] {
  return brightLightEndings(state, content).flatMap(({ actorId, effectId }) => {
    const actor = state.actors.find((candidate) => candidate.id === actorId);
    const name = actor?.effects.find((effect) => effect.id === effectId)?.name ?? "It";
    const ended = endEffectIfPresent(state, actorId, effectId);
    return actor
      ? [{ kind: "effect" as const, text: `${actor.name} is in Bright Light, and ${name} ends.`, actorId }, ...ended]
      : ended;
  });
}
