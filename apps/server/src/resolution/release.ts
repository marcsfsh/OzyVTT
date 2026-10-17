import { endEffect, releaseReadied } from "../effects.js";
import { endedEffect, type ResolveContext } from "./context.js";

/** Rule consequences of having acted: attacking reveals a hidden creature, and a Reaction taken off-turn uses up
 *  the ready. The economy already spent that Reaction on the readied response (`isReadiedResponse`); any other
 *  Reaction leaves none to take the readied action with. */
export function releaseHideAndReady(ctx: ResolveContext): void {
  const { state, action, attacker, plan, effectsEnded } = ctx;
  const end = (tag: string) => {
    const effect = attacker.effects.find((candidate) => candidate.tags.includes(tag));
    if (!effect) return;
    endEffect(state, attacker.id, effect.id);
    effectsEnded.push(endedEffect(attacker, effect));
  };
  // SRD Hide: the attack still had Invisible's advantage, then the hidden effect ends.
  if (action.attack !== undefined || action.save !== undefined) end("hidden");
  // A spell the ready held, released now or not, goes with it.
  if (
    state.combat.turnActorId !== attacker.id &&
    action.id !== "ready" &&
    (plan.markReaction || action.activation === "reaction")
  )
    for (const name of releaseReadied(state, attacker.id))
      effectsEnded.push({ actorId: attacker.id, actorName: attacker.name, name });
}
