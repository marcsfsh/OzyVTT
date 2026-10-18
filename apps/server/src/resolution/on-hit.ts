import { setCondition } from "../actor-conditions.js";
import { conditionLabel } from "../condition-rules.js";
import { addEffect, effectDurationOf, makeEffect, type EffectNarration } from "../effects.js";
import { previewDamage } from "../hit-points.js";
import { masteryHitEffects } from "../weapon-mastery.js";
import { sizeAtMost, tableLineOf, type ResolveContext } from "./context.js";
import { damagePartsOf } from "./damage.js";
import { spellCastOf } from "./pending.js";

/** Whether this hit deals its target any damage after the target's defences: what Slow and Vex need. */
function dealsDamage(ctx: ResolveContext): boolean {
  const { state, targets, deps } = ctx;
  const target = targets[0];
  if (!target) return false;
  const parts = damagePartsOf(ctx);
  if (parts.length === 0) return false;
  const damageDeps = deps.resolveDefinition
    ? { resolveDefinition: deps.resolveDefinition, ...(deps.catalog ? { catalog: deps.catalog } : {}) }
    : undefined;
  return previewDamage(state, target.id, { amount: 0, parts }, damageDeps).totalApplied > 0;
}

/** What a landed hit puts on its target: the action's declared on-hit riders and the weapon mastery's
 *  effects (Sap, Slow, Vex). */
export function applyOnHitEffects(ctx: ResolveContext): void {
  applyDeclaredRiders(ctx);
  // `addEffect` is idempotent by id, so its return is what gets narrated.
  for (const applied of masteryHitEffects(ctx.masterySwing, ctx.masterySwing ? dealsDamage(ctx) : true)) {
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
 *  with a size limit skips a target that is too large. A grapple's effect carries its escape DC and range and ends
 *  with its grappler; a timed rider its printed duration. Prone and Exhaustion stand alone: Prone ends by standing
 *  up, and Exhaustion adds a level each time it lands. */
function applyDeclaredRiders(ctx: ResolveContext): void {
  const { state, action, attacker, attack, targets, input, deps, warnings } = ctx;
  if (!action.onHit || attack === null || (attack.outcome !== "crit" && attack.outcome !== "hit")) return;
  const target = targets[0];
  const immunities = {
    ...(deps.resolveDefinition ? { resolveDefinition: deps.resolveDefinition } : {}),
    ...(deps.catalog ? { catalog: deps.catalog } : {})
  };
  const cast = spellCastOf(ctx);
  action.onHit.forEach((rider, index) => {
    if (rider.maxTargetSize && !sizeAtMost(target.size, rider.maxTargetSize)) {
      warnings.push(
        `${target.name} is too large for ${action.name}'s ${rider.name ?? rider.conditions.map((condition) => conditionLabel(condition.id)).join("/")} rider.`
      );
      return;
    }
    const bare = rider.conditions.filter((condition) => condition.id === "prone" || condition.id === "exhaustion");
    for (const condition of bare) {
      const events = setCondition(state, target.id, condition.id, true, undefined, { role: "gm" }, immunities);
      // A rider's Exhaustion levels each add one (SRD: cumulative).
      for (let extra = 1; condition.id === "exhaustion" && extra < (condition.level ?? 1); extra += 1)
        events.push(...setCondition(state, target.id, "exhaustion", true, undefined, { role: "gm" }, immunities));
      for (const event of events) ctx.tableNarration.push(tableLineOf(ctx, event));
      if (!events.some((event) => event.immune))
        ctx.effectsApplied.push({
          targetId: target.id,
          targetName: target.name,
          name: conditionLabel(condition.id),
          conditionIds: [condition.id]
        });
    }
    const conditionIds = rider.conditions
      .map((condition) => condition.id)
      .filter((id) => id !== "prone" && id !== "exhaustion");
    if (conditionIds.length === 0 && !rider.ongoingDamage) return;
    // "The rug can give it the Grappled condition ... instead of dealing damage": the hit's damage goes.
    if (rider.insteadOfDamage) {
      ctx.damage.splice(0);
      ctx.bonusDamage.splice(0);
      warnings.push(`${action.name}: ${target.name} is held, and the hit deals no damage.`);
    }
    const grapple = conditionIds.includes("grappled");
    const gained: EffectNarration[] = [];
    const effect = addEffect(
      state,
      target.id,
      makeEffect({
        id: `${input.commandId}:hit:${target.id}:${index}`,
        name: `${rider.name ?? conditionLabel(conditionIds[0]!)} by ${attacker.name} (${action.name})`,
        tags: grapple ? ["grapple"] : [],
        sourceActorId: attacker.id,
        sourceName: attacker.name,
        sourceActionId: `${action.id}:${index}`,
        startedRound: state.combat.round,
        duration: effectDurationOf(state, rider.duration, target.id, attacker.id),
        endsWhenSourceDefeated: grapple,
        linkedConditionIds: conditionIds,
        escapeDc: rider.escapeDc ?? null,
        ...(grapple ? { rangeFeet: action.attack?.reachFeet ?? 5 } : {}),
        // A stirge attached, a rug smothering: what it deals each turn while it holds on, and it lets go as it dies.
        ...(rider.ongoingDamage ? { ongoingDamage: rider.ongoingDamage, endsWhenSourceDefeated: true } : {}),
        // A spell's hit (Ray of Sickness): the spell and its level, which Dispel Magic weighs.
        ...(cast ? { spell: { id: cast.spell.id, level: cast.level } } : {})
      }),
      gained,
      deps
    );
    for (const event of gained) ctx.tableNarration.push(tableLineOf(ctx, event));
    ctx.effectsApplied.push({ targetId: target.id, targetName: target.name, name: effect.name, conditionIds });
  });
}
