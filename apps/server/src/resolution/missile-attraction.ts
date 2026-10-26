import { rowRecord } from "../item-records.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import { attackKindsOf } from "./attack.js";
import type { LiveActor, ResolveContext, ResolveInput } from "./context.js";
import { withStatBlockWeaponKinds } from "./damage-source.js";

/**
 * SRD 5.2.1 Shield of Missile Attraction's curse: "Whenever an attack with a Ranged weapon targets a creature within 10
 * feet of you, the curse causes you to become the target instead." Read before the attack rolls, from every creature
 * attuned to an item that `attractsMissiles`, held or not ("Removing the Shield fails to end the curse on you"). The
 * nearest such creature to the target takes the attack; nothing is offered, since the curse doesn't ask.
 */
export function drawRangedAttack(ctx: ResolveContext): void {
  const { state, action, attacker, targets, deps } = ctx;
  const target = targets[0];
  if (!action.attack || targets.length !== 1 || !target || !deps.distanceFeet || !deps.catalog) return;
  const kinds = withStatBlockWeaponKinds(
    attackKindsOf(ctx, deps.distanceFeet(attacker.id, target.id)),
    action,
    attacker,
    ctx.riderItemId
  );
  if (!kinds.includes("ranged-weapon-kind")) return;
  const catalog = deps.catalog;
  let drawn: Readonly<{ bearer: LiveActor; apart: number; item: string }> | null = null;
  for (const bearer of state.actors) {
    if (bearer.id === attacker.id || bearer.id === target.id || bearer.hp.current <= 0) continue;
    const row = bearer.inventory.find((item) => item.attuned && rowRecord(catalog, item)?.attractsMissiles);
    const feet = row ? rowRecord(catalog, row)?.attractsMissiles?.feet : undefined;
    if (!row || feet === undefined) continue;
    const apart = deps.distanceFeet(bearer.id, target.id);
    if (apart === null || apart > feet + DISTANCE_TOLERANCE_FEET) continue;
    if (drawn === null || apart < drawn.apart) drawn = { bearer, apart, item: row.name };
  }
  if (!drawn) return;
  const { bearer } = drawn;
  (ctx as { input: ResolveInput }).input = { ...ctx.input, targetIds: [bearer.id] };
  (ctx as { targets: readonly LiveActor[] }).targets = [bearer];
  ctx.tableNarration.push({
    kind: "effect",
    text: `${bearer.name}'s ${drawn.item} draws ${attacker.name}'s ${action.name} away from ${target.name}: ${bearer.name} becomes the target.`,
    actorIds: [attacker.id, target.id, bearer.id]
  });
}
