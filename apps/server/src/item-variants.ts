import type { GameState } from "@vtt/domain";
import { catalogIdOf, type InventoryItem } from "@vtt/schemas";
import { requireActorAccess, type Initiator } from "./authorization.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError } from "./game-store.js";
import { spendBonusAction } from "./item-light.js";
import { rowWeaponOf, variantPickedBy, withVariant } from "./item-records.js";

/**
 * Which kind a carried copy is (`InventoryItem.variantId`): the GM says what a found item is (an Ioun Stone of
 * Protection, a Belt of Fire Giant Strength), and its holder changes a form the item gives it (a Rod of Lordly Might's
 * button, a Quarterstaff of the Acrobat turned into a pole), at the cost of a Bonus Action in a fight where the item says
 * so. What each kind does is read through `rowRecord` (`item-records.ts`).
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

export type ItemFormChange = Readonly<{ actorId: string; itemId: string; variantId: string | null }>;

/** Its holder puts the item in another form (a Rod of Lordly Might's button, a Quarterstaff of the Acrobat turned into
 *  a pole), or back in its own with null, spending what the record says it costs. Returns the table's sentence. */
export function setItemForm(
  state: GameState,
  change: ItemFormChange,
  initiator: Initiator,
  catalog: EquipmentCatalog
): string {
  requireActorAccess(initiator, state, change.actorId, "inventory");
  const actor = state.actors.find((candidate) => candidate.id === change.actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  const row = actor.inventory.find((entry) => entry.id === change.itemId && entry.quantity > 0);
  if (!row) throw new CommandRejectedError("That item isn't carried.");
  const record = catalog.equipmentRecord(catalogIdOf(row));
  if (!record?.variants || variantPickedBy(record) !== "holder")
    throw new CommandRejectedError(`${row.name} has no forms its holder can change.`);
  if (!row.equipped) throw new CommandRejectedError(`${actor.name} must hold ${row.name} to change its form.`);
  const variant =
    change.variantId === null ? null : record.variants.find((candidate) => candidate.id === change.variantId);
  if (variant === undefined) throw new CommandRejectedError(`${row.name} has no form "${change.variantId}".`);
  if ((row.variantId ?? null) === (variant?.id ?? null))
    throw new CommandRejectedError(`${row.name} is already in that form.`);
  if (record.variantChoice?.activation === "bonus-action")
    spendBonusAction(state, actor, initiator, `Change the form of ${row.name}`);
  const { variantId: _old, weapon: _weapon, ...rest } = row;
  const formed: InventoryItem = variant ? { ...rest, variantId: variant.id } : rest;
  // The form's weapon block, or none, replaces the row's; the record's own comes back with its own form.
  const weapon = withVariant(record, formed).weapon;
  const next: InventoryItem = weapon ? { ...formed, weapon: rowWeaponOf(weapon) } : formed;
  actor.inventory = actor.inventory.map((entry) => (entry.id === row.id ? next : entry));
  return `${actor.name} turns ${row.name} into ${variant ? variant.name : "its own form"}.`;
}
