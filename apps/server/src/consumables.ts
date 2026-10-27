import type { ActorAction, InventoryItem } from "@vtt/schemas";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { itemRowOfAction } from "./item-charges.js";
import { rowRecord } from "./item-records.js";

/**
 * Potions and flasks (SRD Adventuring Gear): drinking a Potion of Healing or throwing a vial of Acid uses that one
 * up. Their records say so (`consumedOnUse`), and their actions work from the pack.
 */

/** The carried row an action uses up, when it comes from a consumable's record. */
export function consumableRowFor(
  action: Pick<ActorAction, "id" | "keepsItem">,
  inventory: readonly InventoryItem[],
  catalog: EquipmentCatalog | undefined
): InventoryItem | null {
  if (action.keepsItem) return null;
  const row = itemRowOfAction(action.id, inventory);
  return row && rowRecord(catalog, row)?.consumedOnUse === true ? row : null;
}

/** One fewer in the stack; the last one takes the row with it. */
export function withOneUsedUp(inventory: readonly InventoryItem[], rowId: string): InventoryItem[] {
  return inventory.flatMap((row) =>
    row.id !== rowId ? [row] : row.quantity > 1 ? [{ ...row, quantity: row.quantity - 1 }] : []
  );
}
