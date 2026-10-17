import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import { applyDamageDetailed, damageAdjustmentDetail } from "../hit-points.js";
import { traitOf } from "../statblock-traits.js";
import type { ResolveContext } from "./context.js";

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
  for (const event of events)
    ctx.tableNarration.push({
      kind: "effect",
      text: event.text,
      actorIds: [event.actorId],
      ...(event.gmOnly ? { gmOnly: true } : {})
    });
}
