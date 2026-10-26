import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import { currentFormId } from "../transform/forms.js";
import { holdsFeature } from "../class-features.js";
import { conditionLabel } from "../condition-rules.js";
import { addEffect, ESCAPE_DISADVANTAGE_TAG, makeEffect, type EffectNarration } from "../effects.js";
import { applyDamageDetailed, damageAdjustmentDetail } from "../hit-points.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import { createPendingSaves } from "../saving-throws.js";
import { creatureTypeOf } from "../statblock-facts.js";
import { traitOf } from "../statblock-traits.js";
import { sizeAtMost, tableLineOf, type ResolveContext } from "./context.js";
import { shotFrom } from "../ammunition.js";
import { isMagicRow, penalizeRow } from "../row-penalties.js";
import { dealsDamage } from "./on-hit.js";
import { offerHitReaction } from "../triggered-reactions.js";

/** The tag, and the option id, of a Hunter's Multiattack Defense. */
export const MULTIATTACK_DEFENSE_TAG = "multiattack-defense";

/**
 * What hitting the target costs the attacker, from the target's stat block: "A creature that hits the pudding with a
 * melee attack roll takes 4 (1d8) Acid damage" (a black pudding's Corrosive Form). It lands as the hit does, through
 * the attacker's defences; what it does to the weapon is `corrodeOnHit`'s.
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
 * SRD 5.2.1 mimic, Adhesive (Object Form Only): "The mimic adheres to anything that touches it. A Huge or smaller
 * creature adhered to the mimic has the Grappled condition (escape DC 13). Ability checks made to escape this grapple
 * have Disadvantage." A creature that hits it with a melee attack while it is an object sticks to it.
 */
export function adhereOnHit(ctx: ResolveContext): void {
  const { state, attack, attacker, targets, input, deps } = ctx;
  if (attack === null || (attack.outcome !== "hit" && attack.outcome !== "crit") || input.commit === false) return;
  if (!(ctx.riderFilters.attackKinds ?? []).includes("melee") || !deps.resolveDefinition) return;
  const target = targets.find((candidate) => candidate.id === attack.targetId) ?? targets[0];
  if (!target || target.id === attacker.id || target.hp.current <= 0) return;
  const definition = target.definitionId ? deps.resolveDefinition(target.definitionId) : undefined;
  const trait = traitOf(definition, "adhesive");
  const form = currentFormId(target);
  if (!trait || !trait.forms.some((name) => form.includes(name)) || !sizeAtMost(attacker.size, trait.maxSize)) return;
  if (attacker.effects.some((effect) => effect.sourceActorId === target.id && effect.tags.includes("grapple"))) return;
  const gained: EffectNarration[] = [];
  addEffect(
    state,
    attacker.id,
    makeEffect({
      id: `${input.commandId}:adhered:${attacker.id}`,
      name: `Adhered to ${target.name} (${trait.name.replace(/\s*\(.*\)$/, "")})`,
      tags: ["grapple", ESCAPE_DISADVANTAGE_TAG],
      sourceActorId: target.id,
      sourceName: target.name,
      startedRound: state.combat.round,
      duration: { type: "manual" },
      endsWhenSourceDefeated: true,
      linkedConditionIds: ["grappled"],
      escapeDc: trait.escapeDc,
      rangeFeet: 5
    }),
    gained,
    deps.resolveDefinition ? { resolveDefinition: deps.resolveDefinition } : undefined
  );
  ctx.tableNarration.push({
    kind: "effect",
    text: `${attacker.name} sticks to ${target.name} and is Grappled (escape DC ${trait.escapeDc}).`,
    actorIds: [attacker.id, target.id]
  });
  for (const event of gained) ctx.tableNarration.push(tableLineOf(ctx, event));
}

/**
 * What hitting the target does to the attacker's weapon (SRD 5.2.1 Corrosive Form: "Any nonmagical weapon takes a
 * cumulative -1 penalty to attack rolls immediately after dealing damage to the pudding and coming into contact with
 * it. The weapon is destroyed if the penalty reaches -5"). A weapon swung or thrown touches it; a bow or a sling
 * doesn't, and its ammunition is destroyed instead (`ammunition.ts`).
 */
export function corrodeOnHit(ctx: ResolveContext): void {
  const { state, attack, attacker, targets, input, deps } = ctx;
  if (attack === null || (attack.outcome !== "hit" && attack.outcome !== "crit") || input.commit === false) return;
  const target = targets.find((candidate) => candidate.id === attack.targetId) ?? targets[0];
  const definition = target?.definitionId ? deps.resolveDefinition?.(target.definitionId) : undefined;
  if (!traitOf(definition, "corrodes-gear")?.weapons || !deps.resolveDefinition) return;
  const row = ctx.riderItemId ? attacker.inventory.find((entry) => entry.id === ctx.riderItemId) : undefined;
  if (!row?.weapon || isMagicRow(row, deps.catalog) || shotFrom(attacker, row.id, deps.catalog) !== null) return;
  if (!dealsDamage(ctx)) return;
  for (const event of penalizeRow(state, attacker.id, row.id, {
    resolveDefinition: deps.resolveDefinition,
    ...(deps.catalog ? { catalog: deps.catalog } : {})
  }))
    ctx.tableNarration.push(tableLineOf(ctx, event));
}

/** An attack roll that hit its target opens the target's reaction to being hit (a rust monster's Reflexive Antennae:
 *  "An attack roll hits the rust monster. Response: The rust monster uses Antennae"). */
export function offerReactionToHit(ctx: ResolveContext): void {
  const { state, attack, attacker, targets, input, deps } = ctx;
  if (attack === null || (attack.outcome !== "hit" && attack.outcome !== "crit") || input.commit === false) return;
  const target = targets.find((candidate) => candidate.id === attack.targetId) ?? targets[0];
  if (!target || !deps.resolveDefinition) return;
  const line = offerHitReaction(state, target, attacker, {
    newId: deps.newRollId,
    now: deps.now,
    resolveDefinition: deps.resolveDefinition,
    ...(deps.catalog ? { catalog: deps.catalog } : {}),
    ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {}),
    commandId: input.commandId
  });
  if (line) ctx.tableNarration.push(tableLineOf(ctx, line));
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
