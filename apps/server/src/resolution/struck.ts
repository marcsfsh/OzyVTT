import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import { holdsFeature } from "../class-features.js";
import { addEffect, makeEffect } from "../effects.js";
import { applyDamageDetailed, damageAdjustmentDetail } from "../hit-points.js";
import { traitOf } from "../statblock-traits.js";
import { tableLineOf, type ResolveContext } from "./context.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";

/** The tag, and the option id, of a Hunter's Multiattack Defense. */
export const MULTIATTACK_DEFENSE_TAG = "multiattack-defense";

/**
 * What hitting the target costs the attacker, from the target's stat block: "A creature that hits the pudding with a
 * melee attack roll takes 4 (1d8) Acid damage" (a black pudding's Corrosive Form). It lands as the hit does, through
 * the attacker's defences; what it does to the weapon is the GM's.
 */
export function strikeBackOnHit(ctx: ResolveContext): void {
  const { attack, attacker, targets, deps } = ctx;
  if (attack === null || (attack.outcome !== "hit" && attack.outcome !== "crit")) return;
  if (!(ctx.riderFilters.attackKinds ?? []).includes("melee") || !deps.resolveDefinition) return;
  const target = targets[0];
  if (!target || target.id === attacker.id) return;
  const definition = target.definitionId ? deps.resolveDefinition(target.definitionId) : undefined;
  const trait = traitOf(definition, "melee-hit-damage");
  if (trait) strikeBack(ctx, target, trait.name, trait.damage);
  // Fire Shield: "whenever a creature within 5 feet of you hits you with a melee attack roll, the shield erupts".
  const distance = deps.distanceFeet?.(attacker.id, target.id) ?? null;
  if (distance !== null && distance > 5 + DISTANCE_TOLERANCE_FEET) return;
  for (const effect of target.effects)
    if (effect.meleeHitDamage) strikeBack(ctx, target, effect.name, [effect.meleeHitDamage]);
}

/** The damage a hit costs its attacker, through the attacker's defences, as the table hears it. */
function strikeBack(
  ctx: ResolveContext,
  target: ResolveContext["targets"][number],
  name: string,
  damage: ReadonlyArray<Readonly<{ formula: string; type: string }>>
): void {
  const { state, attacker, deps } = ctx;
  if (!deps.resolveDefinition) return;
  const parts = damage.map((part) => ({
    amount: Math.max(0, resolveDice(parseDiceFormula(part.formula), deps.random).total),
    type: part.type
  }));
  const { application, events } = applyDamageDetailed(
    state,
    attacker.id,
    {
      amount: parts.reduce((sum, part) => sum + part.amount, 0),
      parts,
      sourceName: target.name,
      sourceActorId: target.id
    },
    { role: "gm" },
    {
      resolveDefinition: deps.resolveDefinition,
      rollDie: deps.random,
      newId: deps.newRollId,
      now: deps.now,
      ...(deps.catalog ? { catalog: deps.catalog } : {}),
      ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {})
    }
  );
  ctx.tableNarration.push({
    kind: "effect",
    text: `${attacker.name} takes ${application.totalApplied} damage from ${target.name}'s ${name}${damageAdjustmentDetail(application)}.`,
    actorIds: [attacker.id, target.id]
  });
  for (const event of events) ctx.tableNarration.push(tableLineOf(ctx, event));
}

/** SRD Multiattack Defense: "When a creature hits you with an attack roll, that creature has Disadvantage on all other
 *  attack rolls against you this turn." Marked for a hit on the attacker's own turn, which is when its end comes; the
 *  attacker's later rolls read the mark as theirs alone (`riderClaims`). */
export function markMultiattackDefense(ctx: ResolveContext): void {
  const { state, attack, attacker, targets, deps, input } = ctx;
  if (attack === null || (attack.outcome !== "hit" && attack.outcome !== "crit")) return;
  if (state.combat.turnActorId !== attacker.id || !deps.resolveDefinition) return;
  const target = targets.find((candidate) => candidate.id === attack.targetId);
  if (!target || target.id === attacker.id) return;
  const definition = target.definitionId ? deps.resolveDefinition(target.definitionId) : undefined;
  if (!holdsFeature(definition, MULTIATTACK_DEFENSE_TAG, "Multiattack Defense")) return;
  addEffect(
    state,
    target.id,
    makeEffect({
      id: `${input.commandId}:${MULTIATTACK_DEFENSE_TAG}`,
      name: "Multiattack Defense",
      tags: [MULTIATTACK_DEFENSE_TAG],
      sourceActorId: attacker.id,
      sourceName: attacker.name,
      sourceActionId: MULTIATTACK_DEFENSE_TAG,
      startedRound: state.combat.round,
      duration: { type: "until-source-turn-end", skipsCurrentTurn: false },
      modifiers: [
        {
          type: "roll-mode",
          roll: "incoming-attack",
          mode: "disadvantage",
          when: [{ type: "on-attack-roll" }, { type: "by-effect-source" }]
        }
      ]
    }),
    undefined,
    deps
  );
}
