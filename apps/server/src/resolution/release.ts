import { endEffect, READIED_TAG, releaseReadied } from "../effects.js";
import { endedEffect, type ResolveContext } from "./context.js";

/** Counts a ray of a released readied spell off its held rays: "held" while rays are left to make, so the ready
 *  stays; "last" for its last ray, which lets it go; null for anything else. */
function readiedRay(ctx: ResolveContext): "held" | "last" | null {
  const { state, action, attacker } = ctx;
  if (state.combat.turnActorId === attacker.id || ctx.attack === null) return null;
  const readied = attacker.effects.find(
    (effect) => effect.tags.includes(READIED_TAG) && effect.readiedSpell?.actionId === action.id
  );
  const held = readied?.readiedSpell;
  if (!readied || !held) return null;
  const left = (held.raysLeft ?? action.attack?.count ?? 1) - 1;
  if (left <= 0) return held.raysLeft === undefined ? null : "last";
  attacker.effects = attacker.effects.map((effect) =>
    effect.id === readied.id ? { ...effect, readiedSpell: { ...held, raysLeft: left } } : effect
  );
  return "held";
}

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
  // SRD Hide: the attack still had Invisible's advantage, then the hidden effect ends. So does casting a spell with a
  // Verbal component ("you cast a spell with a Verbal component").
  const spell = action.spellId ? ctx.deps.catalog?.spellRecord?.(action.spellId) : undefined;
  if (action.attack !== undefined || action.save !== undefined || spell?.components.verbal === true) end("hidden");
  // A released spell of several rays (Scorching Ray) keeps its ready until its last ray, all on the one Reaction.
  const ray = readiedRay(ctx);
  if (ray === "held") return;
  // A spell the ready held, released now or not, goes with it.
  if (
    ray === "last" ||
    (state.combat.turnActorId !== attacker.id &&
      action.id !== "ready" &&
      (plan.markReaction || action.activation === "reaction"))
  )
    for (const name of releaseReadied(state, attacker.id))
      effectsEnded.push({ actorId: attacker.id, actorName: attacker.name, name });
}
