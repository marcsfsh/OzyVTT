import { shotFrom, spendPiece } from "../ammunition.js";
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
  // None left was refused or overridden by the GM: nothing to spend.
  const ammo = shotFrom(attacker, riderItemId, deps.catalog)?.ammo;
  if (!ammo) return;
  const hit = attack.outcome === "hit" || attack.outcome === "crit";
  const target = targets.find((candidate) => candidate.id === attack.targetId) ?? targets[0];
  const definition = target?.definitionId ? deps.resolveDefinition?.(target.definitionId) : undefined;
  const corroded =
    hit && !ammo.record?.isMagic && traitOf(definition, "corrodes-gear")?.ammunition === true && dealsDamage(ctx);
  spendPiece(attacker, ammo, (!ammo.record?.isMagic || attack.outcome === "miss") && !corroded);
}
