import { shotFrom, spendPiece } from "../ammunition.js";
import type { ResolveContext } from "./context.js";

/** SRD Ammunition: "Each attack expends one piece of ammunition", fired or not. A finishing replay after a
 *  reaction already spent it. A hit counts as a hit here even if a Shield later turns it. */
export function spendAmmunition(ctx: ResolveContext): void {
  const { attacker, attack, input, riderItemId, deps } = ctx;
  if (attack === null || input.economyPaid === true) return;
  // None left was refused or overridden by the GM: nothing to spend.
  const ammo = shotFrom(attacker, riderItemId, deps.catalog)?.ammo;
  if (!ammo) return;
  spendPiece(attacker, ammo, !ammo.record?.isMagic || attack.outcome === "miss");
}
