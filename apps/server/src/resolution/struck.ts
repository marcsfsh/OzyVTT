import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import { holdsFeature } from "../class-features.js";
import { conditionLabel } from "../condition-rules.js";
import { addEffect, makeEffect } from "../effects.js";
import { applyDamageDetailed, damageAdjustmentDetail } from "../hit-points.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import { createPendingSaves } from "../saving-throws.js";
import { creatureTypeOf } from "../statblock-facts.js";
import { traitOf } from "../statblock-traits.js";
import { tableLineOf, type ResolveContext } from "./context.js";

/** The tag, and the option id, of a Hunter's Multiattack Defense. */
export const MULTIATTACK_DEFENSE_TAG = "multiattack-defense";

/**
 * What hitting the target costs the attacker, from the target's stat block: "A creature that hits the pudding with a
 * melee attack roll takes 4 (1d8) Acid damage" (a black pudding's Corrosive Form). It lands as the hit does, through
 * the attacker's defences; what it does to the weapon is the GM's.
 */
export function strikeBackOnHit(ctx: ResolveContext): void {
  const { state, attack, attacker, targets, deps } = ctx;
  if (attack === null || (attack.outcome !== "hit" && attack.outcome !== "crit")) return;
  if (!(ctx.riderFilters.attackKinds ?? []).includes("melee") || !deps.resolveDefinition) return;
  const target = targets[0];
  if (!target || target.id === attacker.id) return;
  const definition = target.definitionId ? deps.resolveDefinition(target.definitionId) : undefined;
  const trait = traitOf(definition, "melee-hit-damage");
  if (!trait) return;
  const parts = trait.damage.map((part) => ({
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
    text: `${attacker.name} takes ${application.totalApplied} damage from ${target.name}'s ${trait.name}${damageAdjustmentDetail(application)}.`,
    actorIds: [attacker.id, target.id]
  });
  for (const event of events) ctx.tableNarration.push(tableLineOf(ctx, event));
}

/**
 * What a melee hit costs the attacker from the effects its target bears (Fire Shield: "Whenever a creature within 5
 * feet of you hits you with a melee attack roll, the shield erupts ... The attacker takes 2d8 Fire or Cold damage";
 * Holy Aura's light, which a Fiend or an Undead saves against or is Blinded until the end of its next turn). The damage
 * lands through the attacker's defences, and the save is owed like any other. An attacker farther away than the
 * effect reaches, or of another creature type, is not answered.
 */
export function strikeBackFromEffects(ctx: ResolveContext): void {
  const { state, attack, attacker, targets, deps } = ctx;
  if (attack === null || (attack.outcome !== "hit" && attack.outcome !== "crit")) return;
  if (!(ctx.riderFilters.attackKinds ?? []).includes("melee")) return;
  const target = targets.find((candidate) => candidate.id === attack.targetId) ?? targets[0];
  if (!target || target.id === attacker.id) return;
  const definition = attacker.definitionId ? deps.resolveDefinition?.(attacker.definitionId) : undefined;
  for (const effect of target.effects) {
    const struck = effect.struck;
    if (!struck) continue;
    const distance = deps.distanceFeet?.(attacker.id, target.id) ?? null;
    if (struck.withinFeet !== undefined && distance !== null && distance > struck.withinFeet + DISTANCE_TOLERANCE_FEET)
      continue;
    if (struck.creatureTypes) {
      const type = creatureTypeOf(attacker, definition);
      if (type === null || !struck.creatureTypes.includes(type)) continue;
    }
    if (struck.damage && deps.resolveDefinition) {
      const parts = struck.damage.map((part) => ({
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
        text: `${attacker.name} takes ${application.totalApplied} damage from ${target.name}'s ${effect.name}${damageAdjustmentDetail(application)}.`,
        actorIds: [attacker.id, target.id]
      });
      for (const event of events) ctx.tableNarration.push(tableLineOf(ctx, event));
    }
    if (struck.save && attacker.hp.current > 0) {
      const linked = struck.save.conditions.filter((id) => id !== "prone");
      createPendingSaves(state, {
        sourceActorId: target.id,
        sourceName: target.name,
        actionName: effect.name,
        ability: struck.save.ability,
        dc: struck.save.dc,
        targetIds: [attacker.id],
        proposedDamage: 0,
        halfOnSuccess: false,
        conditionIds: struck.save.conditions,
        replaceExisting: false,
        magical: true,
        ...(linked.length > 0
          ? {
              onFailEffect: {
                name: `${conditionLabel(linked[0]!)} by ${effect.name}`.slice(0, 120),
                tags: [],
                linkedConditionIds: linked,
                escapeDc: null,
                sourceActorId: target.id,
                sourceName: target.name,
                duration: { type: "until-bearer-turn-end" },
                sourceActionId: effect.sourceActionId ?? "struck"
              }
            }
          : {}),
        newSaveId: deps.newRollId,
        createdAt: Date.parse(deps.now())
      });
      ctx.tableNarration.push({
        kind: "effect",
        text: `${attacker.name} makes a ${struck.save.ability.toUpperCase()} save against ${target.name}'s ${effect.name}.`,
        actorIds: [attacker.id, target.id]
      });
    }
  }
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
