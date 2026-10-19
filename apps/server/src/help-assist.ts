import type { Actor, GameState } from "@vtt/domain";
import type { CheckSubject } from "./ability-checks.js";
import { endEffectIfPresent, type EffectNarration } from "./effects.js";

// SRD Help, Assist an Ability Check: "That ally has Advantage on the next ability check they make with the chosen
// skill or tool. This benefit expires if the ally doesn't use it before the start of your next turn." The effect on
// the ally carries the Advantage as a check rider narrowed to the skill; the ally's next check with it uses it up.

/** The tag on the effect Help with a Check leaves on the ally. */
export const HELPED_TAG = "helped";

/** Marks a Help whose check was rolled: a reroll of that check still has it, and the next check ends it. */
const HELP_USED_TAG = "help-used";

/** The skill a Help effect assists, read from its rider. */
function helpedSkills(effect: Actor["effects"][number]): readonly string[] {
  return effect.modifiers.flatMap((modifier) =>
    modifier.type === "roll-mode" && modifier.roll === "check"
      ? (modifier.when ?? []).flatMap((when) => (when.type === "skill-is" ? when.skills : []))
      : []
  );
}

/** Before a fresh check: a Help already used on an earlier one ends. */
export function endUsedHelp(state: GameState, actor: Actor): EffectNarration[] {
  return actor.effects
    .filter((effect) => effect.tags.includes(HELPED_TAG) && effect.tags.includes(HELP_USED_TAG))
    .flatMap((effect) => endEffectIfPresent(state, actor.id, effect.id));
}

/** After a fresh check with a skill: the Help for that skill is used. With `end`, it ends now (a check nothing
 *  rerolls); otherwise it stays marked until the creature's next check. */
export function useHelp(state: GameState, actor: Actor, subject: CheckSubject, end = false): EffectNarration[] {
  if (subject.skill === undefined) return [];
  const events: EffectNarration[] = [];
  for (const effect of [...actor.effects]) {
    if (!effect.tags.includes(HELPED_TAG) || effect.tags.includes(HELP_USED_TAG)) continue;
    if (!helpedSkills(effect).includes(subject.skill)) continue;
    if (end) events.push(...endEffectIfPresent(state, actor.id, effect.id));
    else
      actor.effects = actor.effects.map((candidate) =>
        candidate.id === effect.id ? { ...candidate, tags: [...candidate.tags, HELP_USED_TAG].slice(0, 8) } : candidate
      );
  }
  return events;
}
