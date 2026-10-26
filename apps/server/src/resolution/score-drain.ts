import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import type { OnHitRider } from "@vtt/schemas";
import { ABILITY_NAMES } from "../ability-checks.js";
import { addEffect, makeEffect } from "../effects.js";
import { killOutright } from "../hit-points.js";
import { liveAbilityScores } from "../live-abilities.js";
import { recordRoll, tableLineOf, type ResolveContext } from "./context.js";

/**
 * A hit that lowers one of its target's ability scores (SRD 5.2.1 Shadow, Draining Swipe: "the target's Strength score
 * decreases by 1d4. The target dies if this reduces that score to 0"). The reduction is one effect for each score, which
 * every hit adds to and every rule reads live (`live-abilities.ts`); a score it takes to 0 kills outright, which Death
 * Ward turns aside as a death that deals no damage.
 */

/** The effect that holds what hits took off one score. */
export const ABILITY_DRAIN_TAG = "ability-drain";

export function lowerScore(ctx: ResolveContext, rider: OnHitRider, index: number): void {
  const lowers = rider.lowersScore;
  const target = ctx.targets[0];
  if (!lowers || !target) return;
  const { state, action, attacker, deps } = ctx;
  const rolled = resolveDice(parseDiceFormula(lowers.dice), deps.random);
  const label = ABILITY_NAMES[lowers.ability];
  recordRoll(ctx, rolled, "damage", `${action.name}: ${label}`);
  const amount = Math.max(0, rolled.total);
  if (amount === 0) return;
  const definition = target.definitionId ? deps.resolveDefinition?.(target.definitionId) : undefined;
  const score = definition ? liveAbilityScores(target, definition, deps.catalog)[lowers.ability] : 10;
  if (lowers.killsAtZero && score - amount <= 0) {
    const events = killOutright(state, target.id, action.name, {
      withoutDamage: true,
      ...(deps.resolveDefinition ? { deps: { resolveDefinition: deps.resolveDefinition } } : {})
    });
    ctx.tableNarration.push(
      tableLineOf(ctx, {
        kind: "condition",
        text: `${target.name}'s ${label} drops to 0 (${action.name}).`,
        actorId: target.id
      })
    );
    for (const event of events) ctx.tableNarration.push(tableLineOf(ctx, event));
    return;
  }
  const drained = target.effects.find(
    (effect) => effect.tags.includes(ABILITY_DRAIN_TAG) && effect.abilityReduction?.ability === lowers.ability
  );
  const total = Math.min(30, amount + (drained?.abilityReduction?.amount ?? 0));
  if (drained) target.effects = target.effects.filter((effect) => effect.id !== drained.id);
  addEffect(
    state,
    target.id,
    makeEffect({
      id: drained?.id ?? `${ctx.input.commandId}:drain:${target.id}:${index}`,
      name: `${label} drained by ${total}`,
      tags: [ABILITY_DRAIN_TAG],
      sourceActorId: attacker.id,
      sourceName: attacker.name,
      sourceActionId: `${action.id}:${index}`,
      startedRound: state.combat.round,
      duration: { type: "manual" },
      abilityReduction: { ability: lowers.ability, amount: total }
    })
  );
  ctx.tableNarration.push(
    tableLineOf(ctx, {
      kind: "effect",
      text: `${target.name}'s ${label} score decreases by ${amount} (${action.name}).`,
      actorId: target.id
    })
  );
  ctx.effectsApplied.push({
    targetId: target.id,
    targetName: target.name,
    name: `${label} drained by ${total}`,
    conditionIds: []
  });
}
