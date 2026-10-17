import type { Actor } from "@vtt/domain";
import { catalogIdOf, type ActorAction, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
import type { EquipmentReference } from "@vtt/content-srd-5.2.1";
import { effectiveActions } from "./effective-actions.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { isItemActionId, itemActionRest } from "./item-actions.js";

/**
 * A charged item's charges (SRD magic items): counted per carried copy in `actor.actionUses` under keys that name
 * the row (`itemPool`), regained at dawn by the item's own dice, and a d20 rolled when the last one is spent.
 */

/** The carried row an item action belongs to (`item-<rowId>[-<suffix>]`), the longest matching id first. */
export function itemRowOfAction(actionId: string, inventory: readonly InventoryItem[]): InventoryItem | null {
  if (!isItemActionId(actionId)) return null;
  const rest = itemActionRest(actionId);
  let best: InventoryItem | null = null;
  for (const item of inventory)
    if ((rest === item.id || rest.startsWith(`${item.id}-`)) && (best === null || item.id.length > best.id.length))
      best = item;
  return best;
}

/** The record of the charged item an action spends from, when spending its last charge rolls a d20. */
export function lastChargeRollFor(
  action: ActorAction,
  inventory: readonly InventoryItem[],
  catalog: EquipmentCatalog | undefined
): Readonly<{ item: InventoryItem; record: EquipmentReference }> | null {
  if (!action.uses || action.uses.per === "turn") return null;
  const item = itemRowOfAction(action.id, inventory);
  const record = item ? catalog?.equipmentRecord(catalogIdOf(item)) : undefined;
  return item && record?.charges?.lastChargeRoll ? { item, record } : null;
}

/** What the d20 for a spent last charge says, for the GM: the item's own text decides what a 1 does. */
export function lastChargeLine(itemName: string, face: number): string {
  return face === 1
    ? `${itemName}'s last charge is spent and the d20 shows 1: its description says what happens to it (most crumble and are destroyed).`
    : `${itemName}'s last charge is spent; the d20 shows ${face}, so it keeps working.`;
}

/** Rolls a regain formula ("1d6 + 1", "1d3") with the server's dice. A d3 is a die of its own here, as the SRD
 *  prints it. */
export function rollRegain(formula: string, random: (sides: number) => number): number {
  const match = /^(\d+)d(\d+)(?:\s*([+-])\s*(\d+))?$/i.exec(formula.trim());
  if (!match) return 0;
  let total = 0;
  for (let die = 0; die < Number(match[1]); die++) total += random(Number(match[2]));
  return Math.max(0, total + (match[3] === "-" ? -1 : 1) * Number(match[4] ?? 0));
}

/**
 * The charges a Long Rest gives back (SRD: "regains 1d6 + 1 expended charges daily at dawn"): each item pool with a
 * printed regain rolls it, and keeps what is still spent. Returns the spent counts that survive the rest (every
 * other pool refills) and a line per item for the table.
 */
export function chargesAfterDawn(
  actor: Actor,
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog | undefined,
  random: (sides: number) => number
): Readonly<{ stillSpent: Record<string, number>; lines: string[] }> {
  const stillSpent: Record<string, number> = {};
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const action of effectiveActions(definition, actor, catalog)) {
    if (action.uses?.per !== "long-rest") continue;
    const key = action.uses.pool ?? action.id;
    const spent = actor.actionUses[key] ?? 0;
    if (seen.has(key) || spent === 0) continue;
    seen.add(key);
    const item = itemRowOfAction(action.id, actor.inventory);
    const regain = item ? catalog?.equipmentRecord(catalogIdOf(item))?.charges?.regain : undefined;
    if (!item || !regain) continue;
    const regained = rollRegain(regain, random);
    const left = Math.max(0, spent - regained);
    if (left > 0) stillSpent[key] = left;
    const back = Math.min(spent, regained);
    lines.push(`${item.name} regains ${back} expended charge${back === 1 ? "" : "s"} (${regain}).`);
  }
  return { stillSpent, lines };
}
