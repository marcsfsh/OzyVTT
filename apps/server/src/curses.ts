import type { GameState } from "@vtt/domain";
import { addEffect, endEffect, makeEffect, sourceOf, type EffectNarration } from "./effects.js";

/**
 * Curses a stat block leaves that act on their own: a lycanthrope's bite, which turns the cursed creature when it drops
 * to 0 Hit Points. Remove Curse ends any curse (`CURSE_TAG`).
 */

type Actor = GameState["actors"][number];

/** The tag on a lycanthrope's curse (the content build writes it on the bite's failure). */
export const LYCANTHROPY_TAG = "lycanthropy";
/** The tag on a creature its curse turned, which the GM now plays. */
export const TURNED_TAG = "turned-lycanthrope";

/**
 * SRD lycanthrope Bite: "If the cursed target drops to 0 Hit Points, it instead becomes a Werewolf under the DM's control
 * and has 10 Hit Points." The curse has done its work, so it ends, and a lasting mark says what the creature became;
 * the stat block it takes is the GM's to set. True when the curse held the creature up.
 */
export function lycanthropyAtZero(state: GameState, actor: Actor, events: EffectNarration[]): boolean {
  const curse = actor.effects.find((effect) => effect.tags.includes(LYCANTHROPY_TAG));
  if (!curse) return false;
  actor.hp = { ...actor.hp, current: Math.min(actor.hp.maximum, 10) };
  const form = /\(([^)]+)\)$/.exec(curse.name)?.[1] ?? "lycanthrope";
  events.push(...endEffect(state, actor.id, curse.id));
  addEffect(
    state,
    actor.id,
    makeEffect({
      id: `${curse.id}:turned`.slice(0, 120),
      name: `${form} under the GM's control`.slice(0, 120),
      tags: [TURNED_TAG],
      sourceActorId: curse.sourceActorId,
      sourceName: curse.sourceName,
      startedRound: state.combat.round,
      duration: { type: "manual" }
    })
  );
  events.push({
    kind: "condition",
    text: `${actor.name} doesn't fall: the curse makes it a ${form} under the GM's control, with ${actor.hp.current} Hit Points.`,
    actorId: actor.id,
    ...sourceOf(curse)
  });
  return true;
}
