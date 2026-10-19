import { owedDamageParts, type ActionResolution, type ActionResolutionAttack, type DamageTarget } from "@vtt/domain";
import {
  collectRiders,
  parseDiceFormula,
  resolveDice,
  type DiceExpression,
  type RiderCarrier,
  type RiderMoment
} from "@vtt/rules-5e";
import { holdsFeature } from "../class-features.js";
import { endEffect } from "../effects.js";
import { abilityModifier, endedEffect, recordRoll, type ResolveContext } from "./context.js";
import { declaredBeforeRoll } from "./hit-riders.js";
import { empowered } from "./metamagic.js";

/** 2024 crit rule: double every dice term (modifiers once); `extraFirstTermDice` adds Savage Attacks dice. */
export function criticalExpression(expression: DiceExpression, extraFirstTermDice = 0): DiceExpression {
  let firstDice = true;
  const terms = expression.terms.map((term) => {
    if (term.kind !== "dice") return term;
    const extra = firstDice ? extraFirstTermDice : 0;
    firstDice = false;
    return { ...term, count: term.count * 2 + extra };
  });
  const source = terms
    .map((term, index) => {
      const sign = term.sign === -1 ? "- " : index === 0 ? "" : "+ ";
      return `${sign}${term.kind === "dice" ? `${term.count}d${term.sides}` : term.value}`;
    })
    .join(" ");
  return { source, normalized: source.replace(/\s+/g, "").toLowerCase(), terms };
}

/** Damage rolls unless the attack whiffed outright: no attack roll, a hit, a crit, or no AC to judge. */
function rollsDamage(attack: ActionResolutionAttack | null): boolean {
  return attack === null || attack.outcome === "crit" || attack.outcome === "hit" || attack.outcome === "unknown";
}

/** Typed damage parts (rolled dice and flat bonus lines) of a resolution, for parking or applying: the shared
 *  `owedDamageParts`, so what lands is what the card shows. */
export function damagePartsOf(
  resolution: Pick<ActionResolution, "damage" | "bonusDamage">
): Array<{ amount: number; type: string }> {
  return owedDamageParts(resolution);
}

const bloodied = (hp: Readonly<{ current: number; maximum: number }>) => hp.current > 0 && hp.current * 2 <= hp.maximum;

/** Whether a stat block's conditional damage holds for this hit; a charge is the attacker's to confirm, so it comes
 *  through the hit's options instead (`hit-options.ts`). */
function conditionHolds(
  ctx: ResolveContext,
  when: NonNullable<ResolveContext["action"]["conditionalDamage"]>[number]["when"]
): boolean {
  const target = ctx.targets[0];
  switch (when) {
    case "advantage":
      return ctx.rollMode?.mode === "advantage";
    case "self-bloodied":
      return bloodied(ctx.attacker.hp);
    case "target-bloodied":
      return target !== undefined && bloodied(target.hp);
    case "target-grappled-by-self":
      return (
        target !== undefined &&
        target.effects.some(
          (effect) => effect.sourceActorId === ctx.attacker.id && effect.linkedConditionIds.includes("grappled")
        )
      );
    case "charge":
      return false;
  }
}

/** The action's damage parts for this hit: a stat block's "or 2 (1d4) Piercing damage if the swarm is Bloodied"
 *  replaces the first part, and "plus 2 (1d4) Slashing damage if the attack roll had Advantage" adds one. */
function damageInForce(ctx: ResolveContext): ResolveContext["action"]["damage"] {
  const variants = (ctx.action.conditionalDamage ?? []).filter((variant) => conditionHolds(ctx, variant.when));
  const instead = variants.find((variant) => variant.mode === "instead");
  const base = instead ? [...instead.damage, ...ctx.action.damage.slice(1)] : ctx.action.damage;
  return [...base, ...variants.filter((variant) => variant.mode === "plus").flatMap((variant) => variant.damage)];
}

/** The action's own damage dice: crit-doubled, Savage Attacks on the first part. A darts action rolls each dart on
 *  its own and assigns it: dart i strikes the i-th target listed, the list wrapping round when darts remain. */
export function rollWeaponDamage(ctx: ResolveContext): void {
  const { action, deps, damage, input } = ctx;
  // A strike declared before its roll (Brutal Strike) rolls its dice with the hit it rides, never with its tap.
  if (declaredBeforeRoll(action)) return;
  const parts = damageInForce(ctx);
  if (parts.length > 0 && action.missDamage === "half" && missed(ctx.attack)) {
    halfOnAMiss(ctx, parts);
    return;
  }
  if (parts.length === 0 || !rollsDamage(ctx.attack)) return;
  if (action.darts !== undefined && input.targetIds.length > 0) {
    for (let dart = 0; dart < action.darts; dart += 1) {
      const targetId = input.targetIds[dart % input.targetIds.length]!;
      for (const part of parts) {
        const thrown = resolveDice(parseDiceFormula(part.formula), deps.random);
        recordRoll(ctx, thrown, "damage");
        const rolled = empowered(ctx, thrown);
        damage.push({ formula: rolled.expression.source, type: part.type, total: rolled.total });
        ctx.dartTargetIds.push(targetId);
      }
    }
    return;
  }
  const savage = savageAttack(ctx);
  parts.forEach((part, index) => {
    const expression = parseDiceFormula(part.formula);
    const extraCritDice = index === 0 ? (action.attack?.criticalBonusDice ?? 0) : 0;
    const rolledExpression = ctx.crit ? criticalExpression(expression, extraCritDice) : expression;
    let rolled = resolveDice(rolledExpression, deps.random);
    recordRoll(ctx, rolled, "damage");
    // The weapon's own dice are rolled again and the higher roll is used: no attacker would choose the lower.
    if (savage && index === 0) {
      const again = resolveDice(rolledExpression, deps.random);
      recordRoll(ctx, again, "damage", "Savage Attacker");
      if (again.total > rolled.total) rolled = again;
    }
    rolled = empowered(ctx, rolled);
    damage.push({ formula: rolled.expression.source, type: part.type, total: rolled.total });
  });
}

/** The hit option that rolls a weapon's damage dice twice (SRD Savage Attacker). */
export const SAVAGE_ATTACKER = "savage-attacker";

/**
 * SRD Savage Attacker: "Once per turn when you hit a target with a weapon, you can roll the weapon's damage dice twice
 * and use either roll against the target." Whether this weapon hit may use it: its attacker holds the feat and has not
 * used it this turn.
 */
export function savageAttackerReady(ctx: ResolveContext): boolean {
  const { state, attacker, attack, deps } = ctx;
  if (attack === null || (attack.outcome !== "hit" && attack.outcome !== "crit")) return false;
  if (!(ctx.riderFilters.attackKinds ?? []).includes("weapon") || ctx.action.damage.length === 0) return false;
  const definition =
    deps.definition ?? (attacker.definitionId ? deps.resolveDefinition?.(attacker.definitionId) : undefined);
  if (!holdsFeature(definition, SAVAGE_ATTACKER, "Savage Attacker")) return false;
  return !state.combat.active || (state.combat.turn.turnUses[`${attacker.id}:${SAVAGE_ATTACKER}`] ?? 0) === 0;
}

/** Whether the attacker chose Savage Attacker for this hit and may use it; spends the turn's use when it does. */
function savageAttack(ctx: ResolveContext): boolean {
  if (!(ctx.input.hitOptions ?? []).some((choice) => choice.id === SAVAGE_ATTACKER)) return false;
  if (!savageAttackerReady(ctx)) {
    ctx.warnings.push(`${ctx.attacker.name} can't use Savage Attacker on this hit.`);
    return false;
  }
  const { state, attacker } = ctx;
  if (state.combat.active) {
    const key = `${attacker.id}:${SAVAGE_ATTACKER}`;
    state.combat = {
      ...state.combat,
      turn: { ...state.combat.turn, turnUses: { ...state.combat.turn.turnUses, [key]: 1 } }
    };
  }
  return true;
}

const missed = (attack: ActionResolutionAttack | null) =>
  attack !== null && (attack.outcome === "miss" || attack.outcome === "fumble");

/** SRD Acid Arrow: "On a miss, the arrow splashes the target with acid for half as much of the initial damage only." The
 *  dice roll as for a hit, and half of each part (rounded down) is owed like Graze's damage. */
function halfOnAMiss(ctx: ResolveContext, parts: ResolveContext["action"]["damage"]): void {
  for (const part of parts) {
    const thrown = resolveDice(parseDiceFormula(part.formula), ctx.deps.random);
    recordRoll(ctx, thrown, "damage");
    const rolled = empowered(ctx, thrown);
    const amount = Math.floor(rolled.total / 2);
    if (amount > 0) ctx.bonusDamage.push({ amount, type: part.type, source: `${ctx.action.name} (miss)` });
  }
}

/** What a darts action owes each creature its darts struck (`damageTargets`); anything a rider added beyond the
 *  darts goes to the first. Null for any other action. */
export function dartDamageTargetsOf(ctx: ResolveContext): DamageTarget[] | null {
  if (ctx.dartTargetIds.length === 0) return null;
  const first = ctx.dartTargetIds[0]!;
  const struck = [...new Set(ctx.dartTargetIds)];
  return struck.map((targetId) => {
    const parts = owedDamageParts({
      damage: ctx.damage.filter((_, index) => (ctx.dartTargetIds[index] ?? first) === targetId),
      bonusDamage: targetId === first ? ctx.bonusDamage : []
    });
    return {
      targetId,
      targetName: ctx.targets.find((target) => target.id === targetId)?.name ?? "The target",
      parts,
      total: parts.reduce((sum, part) => sum + part.amount, 0)
    };
  });
}

/** The effects the attacker put on the creature its attack roll hit, as carriers of the attacker's riders against it
 *  alone (Hunter's Mark's extra 1d6): read with `fromEffectSource`, so only `by-effect-source` riders pass. */
function markCarriers(ctx: ResolveContext): RiderCarrier[] {
  const { attack, attacker, targets } = ctx;
  if (attack === null || (attack.outcome !== "hit" && attack.outcome !== "crit")) return [];
  const target = targets.find((candidate) => candidate.id === attack.targetId);
  return (target?.effects ?? [])
    .filter((effect) => effect.sourceActorId === attacker.id && effect.modifiers.length > 0)
    .map((effect) => ({ label: effect.name, modifiers: effect.modifiers, sourceEffectId: effect.id }));
}

/** Riders that add damage, from every carrier (items, feats, features, live effects, and the marks the attacker
 *  put on the creature it hit): typed `extra-damage` as its own `damage[]` entry (crit-doubled unless
 *  `doubleOnCritical` is false: a Critical Hit rolls the attack's other damage dice twice too) and moment-gated flat
 *  `damage-bonus` as a bonus line. A rider with no `when` fires on every damage roll of its action;
 *  `on-hit`/`on-critical-hit`/`on-natural-20` narrow it. The moments collected here are `DAMAGE_ROLL_MOMENTS`. */
export function rollRiderDamage(ctx: ResolveContext): void {
  const { attack, crit, derivation, riderFilters, deps, damage, bonusDamage, warnings } = ctx;
  if (!rollsDamage(attack) || declaredBeforeRoll(ctx.action)) return;
  const passes: Array<RiderMoment | null> = [null, "on-damage-roll"];
  if (attack === null || attack.outcome === "hit" || attack.outcome === "crit") passes.push("on-hit");
  if (crit) passes.push("on-critical-hit");
  // "When you roll a 20": the die itself, so a wider crit range or an auto-crit on a Paralyzed target isn't one.
  if (attack !== null && attack.naturalRoll === 20 && (attack.outcome === "hit" || attack.outcome === "crit"))
    passes.push("on-natural-20");
  const marks = markCarriers(ctx);
  const already = new Set<unknown>();
  for (const moment of passes) {
    const context = { ...derivation.context, ...riderFilters, moment };
    const riders = [
      ...collectRiders(derivation.carriers, context),
      ...(marks.length > 0 ? collectRiders(marks, { ...context, fromEffectSource: true }) : [])
    ];
    for (const rider of riders) {
      const modifier = rider.modifier;
      // Standing flat bonuses (moment null) were already folded into the formula by `withStandingRiders`.
      if (modifier.type === "damage-bonus") {
        if (moment === null || already.has(modifier)) continue;
        const amount = modifier.amount ?? 0;
        if (amount === 0 || damage.length === 0) continue;
        already.add(modifier);
        bonusDamage.push({ amount, type: damage[0].type, source: rider.label });
        continue;
      }
      if (modifier.type !== "extra-damage" || already.has(modifier)) continue;
      if (modifier.formula === undefined && modifier.abilityModifier === undefined) continue;
      already.add(modifier);
      // An ability-modifier amount (Agonizing Blast's "add your Charisma modifier") resolves against the
      // bearer's sheet; it rolls no die and is never crit-doubled.
      const abilityAmount =
        modifier.abilityModifier === undefined ? 0 : abilityModifier(deps.definition, modifier.abilityModifier);
      const type = modifier.damageType ?? damage[0]?.type ?? "untyped";
      if (modifier.formula === undefined) {
        if (abilityAmount === 0) continue; // a +0 modifier adds no entry and no noise to the card
        damage.push({ formula: String(abilityAmount), type, total: abilityAmount });
        warnings.push(`${rider.label}: +${abilityAmount} ${type} (${modifier.abilityModifier!.toUpperCase()}).`);
        continue;
      }
      const expression = parseDiceFormula(modifier.formula);
      const rolled = resolveDice(
        crit && modifier.doubleOnCritical !== false ? criticalExpression(expression) : expression,
        deps.random
      );
      recordRoll(ctx, rolled, "damage");
      const total = rolled.total + abilityAmount;
      damage.push({ formula: rolled.expression.source, type, total });
      warnings.push(`${rider.label}: +${total} ${type}.`);
      if (rider.sourceEffectId !== undefined) ctx.damageEffectIds.push(rider.sourceEffectId);
    }
  }
}

/** A coat of Basic Poison is spent "once its damage is dealt": an effect with damage uses loses one each hit its
 *  damage lands on, and ends at none. */
export function spendDamageUses(ctx: ResolveContext): void {
  const { state, attacker, damageEffectIds, effectsEnded } = ctx;
  for (const effectId of new Set(damageEffectIds)) {
    const effect = attacker.effects.find((candidate) => candidate.id === effectId);
    if (effect?.damageUses === undefined) continue;
    if (effect.damageUses > 1) {
      attacker.effects = attacker.effects.map((candidate) =>
        candidate.id === effectId ? { ...candidate, damageUses: effect.damageUses! - 1 } : candidate
      );
      continue;
    }
    endEffect(state, attacker.id, effectId);
    effectsEnded.push(endedEffect(attacker, effect));
  }
}
