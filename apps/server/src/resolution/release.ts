import { endEffect } from "../effects.js";
import type { ResolveContext } from "./context.js";

/** Rule consequences of having acted: attacking reveals a hidden creature, and acting off-turn while
 *  Readied releases the ready. */
export function releaseHideAndReady(ctx: ResolveContext): void {
  const { state, action, attacker, warnings, effectsEnded } = ctx;
  const end = (tag: string) => {
    const effect = attacker.effects.find((candidate) => candidate.tags.includes(tag));
    if (!effect) return false;
    endEffect(state, attacker.id, effect.id);
    effectsEnded.push({ actorId: attacker.id, actorName: attacker.name, name: effect.name });
    return true;
  };
  // SRD Hide: the attack still had Invisible's advantage, then the hidden effect ends.
  if (action.attack !== undefined || action.save !== undefined) end("hidden");
  // SRD Ready: resolving anything off-turn while Readied spends the reaction and ends the intent.
  if (state.combat.turnActorId !== attacker.id && action.id !== "ready" && end("readied")) {
    if (!state.combat.reactionsUsed.includes(attacker.id)) {
      state.combat = { ...state.combat, reactionsUsed: [...state.combat.reactionsUsed, attacker.id] };
    } else {
      warnings.push(`${attacker.name}'s reaction was already spent - the readied action released without one.`);
    }
  }
}
