import { ammunitionFor, launcherKind, spendPiece } from "../ammunition.js";
import type { ResolveContext } from "./context.js";

/** SRD Ammunition: "Each attack expends one piece of ammunition", fired or not. A finishing replay after a
 *  reaction already spent it. A hit counts as a hit here even if a Shield later turns it. */
export function spendAmmunition(ctx: ResolveContext): void {
  const { attacker, attack, input, riderItemId, deps } = ctx;
  if (attack === null || riderItemId === null || input.economyPaid === true) return;
  const launcher = attacker.inventory.find((row) => row.id === riderItemId);
  if (!launcher) return;
  const kind = launcherKind(launcher, deps.catalog);
  if (kind === null) return;
  const ammo = ammunitionFor(attacker, kind, deps.catalog);
  // None left was refused or overridden by the GM: nothing to spend.
  if (!ammo) return;
  spendPiece(attacker, ammo, !ammo.record?.isMagic || attack.outcome === "miss");
}
