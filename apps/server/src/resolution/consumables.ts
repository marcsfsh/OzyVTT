import { consumableRowFor, withOneUsedUp } from "../consumables.js";
import type { ResolveContext } from "./context.js";

/** A potion drunk or a flask thrown is used up when the action resolves; a finishing replay already took it. */
export function useUpConsumable(ctx: ResolveContext): void {
  const { action, attacker, input, deps } = ctx;
  if (input.economyPaid === true) return;
  const row = consumableRowFor(action, attacker.inventory, deps.catalog);
  if (row) attacker.inventory = withOneUsedUp(attacker.inventory, row.id);
}
