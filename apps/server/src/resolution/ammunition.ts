import { leaveHand, shotFrom, spendPiece } from "../ammunition.js";
import { IMPROVISED_THROWN_SUFFIX, itemActionRest } from "../item-actions.js";
import { rowRecord } from "../item-records.js";
import { creatureTypeOf } from "../statblock-facts.js";
import { traitOf } from "../statblock-traits.js";
import type { ResolveContext } from "./context.js";
import { dealsDamage } from "./on-hit.js";

/** SRD Ammunition: "Each attack expends one piece of ammunition", fired or not. A finishing replay after a
 *  reaction already spent it. A hit counts as a hit here even if a Shield later turns it. A piece that hits a creature
 *  whose touch destroys it (Corrosive Form: "Nonmagical ammunition is destroyed immediately after hitting the
 *  pudding and dealing any damage") isn't picked up after the fight. */
export function spendAmmunition(ctx: ResolveContext): void {
  const { attacker, attack, input, riderItemId, deps, targets } = ctx;
  if (attack === null || input.economyPaid === true) return;
  throwWeapon(ctx);
  // None left was refused or overridden by the GM: nothing to spend.
  const ammo = shotFrom(attacker, riderItemId, deps.catalog)?.ammo;
  if (!ammo) return;
  const hit = attack.outcome === "hit" || attack.outcome === "crit";
  const target = targets.find((candidate) => candidate.id === attack.targetId) ?? targets[0];
  const definition = target?.definitionId ? deps.resolveDefinition?.(target.definitionId) : undefined;
  const corroded =
    hit && !ammo.record?.isMagic && traitOf(definition, "corrodes-gear")?.ammunition === true && dealsDamage(ctx);
  const keepsMagic = !hit || !spendsMagic(ctx, ammo.row);
  spendPiece(attacker, ammo, (!ammo.record?.isMagic || keepsMagic) && !corroded, hit);
}

/** Whether a hit spends a magic piece's magic: any hit does ("Once it hits a target, the ammunition is no longer
 *  magical"), but a piece made to slay one creature type keeps it until it deals its extra damage to one. */
function spendsMagic(ctx: ResolveContext, row: Parameters<typeof rowRecord>[1]): boolean {
  const typed = (rowRecord(ctx.deps.catalog, row)?.onHit ?? []).flatMap((rider) => rider.creatureTypes ?? []);
  if (typed.length === 0) return true;
  const target = ctx.targets.find((candidate) => candidate.id === ctx.attack?.targetId);
  const definition = target?.definitionId ? ctx.deps.resolveDefinition?.(target.definitionId) : undefined;
  const type = target ? creatureTypeOf(target, definition) : null;
  return type !== null && typed.includes(type);
}

/**
 * SRD Thrown: a weapon thrown in a ranged attack leaves its thrower's hand, as an improvised weapon thrown does. It lies
 * where it landed until the fight ends and is picked up, as fired ammunition is; a creature with a second one throws
 * that next. A weapon that flies back (a Dwarven Thrower) stays in hand.
 */
function throwWeapon(ctx: ResolveContext): void {
  const { attacker, action, riderItemId, deps } = ctx;
  if (riderItemId === null) return;
  const row = attacker.inventory.find((entry) => entry.id === riderItemId && entry.quantity > 0);
  if (!row?.weapon) return;
  const improvised = itemActionRest(action.id) === `${row.id}-${IMPROVISED_THROWN_SUFFIX}`;
  // Only a throw the map measured: with no tokens to measure, a Dagger is taken to stay in hand.
  const target = ctx.targets.find((candidate) => candidate.id === ctx.attack?.targetId);
  const measured = target !== undefined && (deps.distanceFeet?.(attacker.id, target.id) ?? null) !== null;
  const thrown =
    measured &&
    row.weapon.properties?.includes("thrown") === true &&
    ctx.riderFilters.attackKinds?.includes("ranged") === true;
  if (!improvised && !thrown) return;
  if (rowRecord(deps.catalog, row)?.weaponChanges?.returns) return;
  leaveHand(attacker, row);
}
