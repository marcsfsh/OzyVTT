import type { GameState } from "@vtt/domain";
import { catalogIdOf, type InventoryItem } from "@vtt/schemas";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError } from "./game-store.js";

/**
 * Which kind a carried copy is (`InventoryItem.variantId`): the GM says what a found item is (an Ioun Stone of
 * Protection, a Belt of Fire Giant Strength), and its holder changes a form the item gives it (a Rod of Lordly Might's
 * button, a Quarterstaff of the Acrobat turned into a pole), at the cost of a Bonus Action in a fight where the item says
 * so (`setItemForm` in `inventory.ts`). What each kind does is read through `rowRecord` (`item-records.ts`).
 */

/**
 * A write keeps the stored kind unless the GM writes it: the GM says what a found item is, and may set a form as a
 * ruling. A holder changes a form through `setItemForm`, which spends the action it costs. A pick the record doesn't
 * list is refused.
 */
export function withVariantPick(
  actor: GameState["actors"][number],
  item: InventoryItem,
  deps: Readonly<{ catalog?: EquipmentCatalog; role?: "gm" | "player" }>
): InventoryItem {
  const stored = actor.inventory.find((entry) => entry.id === item.id)?.variantId;
  const record = deps.catalog?.equipmentRecord(catalogIdOf(item));
  const { variantId: sent, ...rest } = item;
  const variantId = deps.role === "gm" || deps.catalog === undefined ? sent : stored;
  if (variantId === undefined) return rest;
  if (deps.catalog && !record?.variants?.some((variant) => variant.id === variantId))
    throw new CommandRejectedError(`${item.name} has no kind "${variantId}".`);
  return { ...rest, variantId };
}
