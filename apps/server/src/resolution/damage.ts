import { owedDamageParts, type ActionResolution, type ActionResolutionAttack } from "@vtt/domain";
import { collectRiders, parseDiceFormula, resolveDice, type DiceExpression, type RiderMoment } from "@vtt/rules-5e";
import { abilityModifier, recordRoll, type ResolveContext } from "./context.js";

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

/** The action's own damage dice: crit-doubled, Savage Attacks on the first part. */
export function rollWeaponDamage(ctx: ResolveContext): void {
  const { action, deps, damage } = ctx;
  const parts = damageInForce(ctx);
  if (parts.length === 0 || !rollsDamage(ctx.attack)) return;
  parts.forEach((part, index) => {
    const expression = parseDiceFormula(part.formula);
    const extraCritDice = index === 0 ? (action.attack?.criticalBonusDice ?? 0) : 0;
    const rolled = resolveDice(ctx.crit ? criticalExpression(expression, extraCritDice) : expression, deps.random);
    recordRoll(ctx, rolled, "damage");
    damage.push({ formula: rolled.expression.source, type: part.type, total: rolled.total });
  });
}

/** Riders that add damage, from every carrier (items, feats, features, live effects): typed `extra-damage` as
 *  its own `damage[]` entry (crit-doubled unless `doubleOnCritical` is false: a Critical Hit rolls the attack's
 *  other damage dice twice too) and moment-gated flat `damage-bonus` as a bonus line. A rider with no `when` fires on
 *  every damage roll of its action; `on-hit`/`on-critical-hit` narrow it. The moments collected here are
 *  `DAMAGE_ROLL_MOMENTS`. */
export function rollRiderDamage(ctx: ResolveContext): void {
  const { attack, crit, derivation, riderFilters, deps, damage, bonusDamage, warnings } = ctx;
  if (!rollsDamage(attack)) return;
  const passes: Array<RiderMoment | null> = [null, "on-damage-roll"];
  if (attack === null || attack.outcome === "hit" || attack.outcome === "crit") passes.push("on-hit");
  if (crit) passes.push("on-critical-hit");
  const already = new Set<unknown>();
  for (const moment of passes) {
    for (const rider of collectRiders(derivation.carriers, { ...derivation.context, ...riderFilters, moment })) {
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
    }
  }
}
