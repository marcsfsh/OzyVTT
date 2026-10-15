import { conditionLabel } from "../condition-rules.js";
import { addEffect, makeEffect } from "../effects.js";
import { masteryHitEffects } from "../weapon-mastery.js";
import { sizeAtMost, type ResolveContext } from "./context.js";

/** What a landed hit puts on its target: the action's declared on-hit riders and the weapon mastery's
 *  effects (Sap, Slow). */
export function applyOnHitEffects(ctx: ResolveContext): void {
  applyDeclaredRiders(ctx);
  // `addEffect` is idempotent by id, so its return is what gets narrated.
  for (const applied of masteryHitEffects(ctx.masterySwing)) {
    const effect = addEffect(ctx.state, applied.targetId, makeEffect(applied.effect), undefined, ctx.deps);
    ctx.effectsApplied.push({
      targetId: applied.targetId,
      targetName: applied.targetName,
      name: effect.name,
      conditionIds: effect.linkedConditionIds
    });
  }
}

/** Declared on-hit riders apply as one source-linked effect each (ADR-0020 condition carve-out); a rider
 *  with a size limit skips a target that is too large. */
function applyDeclaredRiders(ctx: ResolveContext): void {
  const { state, action, attacker, attack, targets, input, deps, warnings } = ctx;
  if (!action.onHit || attack === null || (attack.outcome !== "crit" && attack.outcome !== "hit")) return;
  const target = targets[0];
  action.onHit.forEach((rider, index) => {
    if (rider.maxTargetSize && !sizeAtMost(target.size, rider.maxTargetSize)) {
      warnings.push(
        `${target.name} is too large for ${action.name}'s ${rider.conditions.map((condition) => conditionLabel(condition.id)).join("/")} rider.`
      );
      return;
    }
    const conditionIds = rider.conditions.map((condition) => condition.id);
    const effect = addEffect(
      state,
      target.id,
      makeEffect({
        id: `${input.commandId}:hit:${target.id}:${index}`,
        name: `${conditionLabel(conditionIds[0])} by ${attacker.name} (${action.name})`,
        tags: conditionIds.includes("grappled") ? ["grapple"] : [],
        sourceActorId: attacker.id,
        sourceName: attacker.name,
        sourceActionId: `${action.id}:${index}`,
        startedRound: state.combat.round,
        duration: { type: "manual" },
        endsWhenSourceDefeated: true,
        linkedConditionIds: conditionIds,
        escapeDc: rider.escapeDc ?? null
      }),
      undefined,
      deps
    );
    ctx.effectsApplied.push({ targetId: target.id, targetName: target.name, name: effect.name, conditionIds });
  });
}
