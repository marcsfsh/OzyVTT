import { holdsFeature } from "../class-features.js";
import { addEffect, endEffect, makeEffect, turnEndDuration } from "../effects.js";
import type { ResolveContext } from "./context.js";

/** The mark Studied Attacks leaves on a creature its Fighter missed; the feature's rider reads it (`versus-marked`). */
export const STUDIED_TAG = "studied";

/**
 * SRD Studied Attacks: "If you make an attack roll against a creature and miss, you have Advantage on your next attack
 * roll against that creature before the end of your next turn." A miss marks the creature, sourced by the Fighter,
 * until the end of the Fighter's next turn.
 */
export function studyAMiss(ctx: ResolveContext): void {
  const { state, attack, attacker, targets, input, deps } = ctx;
  if (attack === null || input.commit === false) return;
  if (attack.outcome !== "miss" && attack.outcome !== "fumble") return;
  if (!holdsFeature(deps.definition, "studied-attacks", "Studied Attacks")) return;
  const target = targets[0];
  if (!target || target.id === attacker.id) return;
  addEffect(
    state,
    target.id,
    makeEffect({
      id: `${input.commandId}:studied`,
      name: `Studied by ${attacker.name}`,
      tags: [STUDIED_TAG],
      sourceActorId: attacker.id,
      sourceName: attacker.name,
      sourceActionId: "studied-attacks",
      startedRound: state.combat.round,
      duration: turnEndDuration(state, "until-source-turn-end", attacker.id)
    })
  );
}

/** The Fighter's next attack roll against the creature it studied spends the mark, hit or miss. */
export function spendStudy(ctx: ResolveContext): void {
  const { state, attack, attacker, targets, input } = ctx;
  if (attack === null) return;
  const target = targets[0];
  if (!target) return;
  for (const effect of target.effects.filter(
    (candidate) =>
      candidate.tags.includes(STUDIED_TAG) &&
      candidate.sourceActorId === attacker.id &&
      !candidate.id.startsWith(input.commandId)
  ))
    endEffect(state, target.id, effect.id);
}
