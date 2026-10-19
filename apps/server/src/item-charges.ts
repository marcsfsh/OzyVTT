import type { Actor } from "@vtt/domain";
import { catalogIdOf, type ActorAction, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
import type { EquipmentReference } from "@vtt/content-srd-5.2.1";
import { effectiveActions } from "./effective-actions.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { castAction, isItemActionId, itemAction, itemActionRest, itemPool } from "./item-actions.js";
import { rowRecord } from "./item-records.js";
import { alsoUsesKey } from "./use-cost.js";

/**
 * A charged item's charges (SRD magic items): counted per carried copy in `actor.actionUses` under keys that name
 * the row (`itemPool`), regained at dawn by the item's own dice (or never), a starting count rolled when a copy is
 * added, and a d20 rolled when the last one is spent, whose 1 or 20 does what the item says.
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

/** The record of the charged item an action spends from, when spending its last charge does something: a d20 to
 *  roll, or what happens to the item. */
export function lastChargeRollFor(
  action: ActorAction,
  inventory: readonly InventoryItem[],
  catalog: EquipmentCatalog | undefined
): Readonly<{ item: InventoryItem; record: EquipmentReference }> | null {
  // A pool that comes back after a time (an Efreeti Bottle's 24 hours) is no charge of the item's.
  if (!action.uses || action.uses.per === "turn" || action.uses.per === "time") return null;
  const item = itemRowOfAction(action.id, inventory);
  const record = item ? rowRecord(catalog, item) : undefined;
  return item && record && (record.charges?.lastChargeRoll || record.charges?.lastCharge) ? { item, record } : null;
}

/** What the d20 for a spent last charge says, for the GM, when the item's own record says nothing of it. */
export function lastChargeLine(itemName: string, face: number): string {
  return face === 1
    ? `${itemName}'s last charge is spent and the d20 shows 1: its description says what happens to it (most crumble and are destroyed).`
    : `${itemName}'s last charge is spent; the d20 shows ${face}, so it keeps working.`;
}

/** A 20 on the last charge's d20 gives some back where the item says so (Staff of Power: 1d8 + 2). Returns the line
 *  for the table. */
export function regainOnTwenty(
  actor: Actor,
  key: string,
  itemName: string,
  formula: string,
  random: (sides: number) => number
): string {
  const spent = actor.actionUses[key] ?? 0;
  const back = Math.min(rollRegain(formula, random), spent);
  const { [key]: _spent, ...others } = actor.actionUses;
  actor.actionUses = spent - back > 0 ? { ...others, [key]: spent - back } : others;
  return `${itemName}'s last charge is spent and the d20 shows 20, so it regains ${back} charge${back === 1 ? "" : "s"}.`;
}

/** Rolls a charge count ("1d6 + 1", "1d3", or a flat "1") with the server's dice. A d3 is a die of its own here, as
 *  the SRD prints it. */
export function rollRegain(formula: string, random: (sides: number) => number): number {
  const trimmed = formula.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const match = /^(\d+)d(\d+)(?:\s*([+-])\s*(\d+))?$/i.exec(trimmed);
  if (!match) return 0;
  let total = 0;
  for (let die = 0; die < Number(match[1]); die++) total += random(Number(match[2]));
  return Math.max(0, total + (match[3] === "-" ? -1 : 1) * Number(match[4] ?? 0));
}

/** The spent counts of pools that never come back (a Necklace of Fireballs' beads), which no rest touches. */
export function neverRegained(
  actor: Actor,
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog | undefined
): Record<string, number> {
  const kept: Record<string, number> = {};
  const keys = [
    ...effectiveActions(definition, actor, catalog).flatMap((action) => [
      ...(action.uses?.per === "never" ? [action.uses.pool ?? action.id] : []),
      // A second limit that never comes back (an Efreeti Bottle's openings).
      ...(action.alsoUses?.per === "never" ? [alsoUsesKey(action)!] : [])
    ]),
    ...actor.inventory.flatMap((row) => [...riderPools(row, catalog).keys()])
  ];
  for (const key of keys) {
    const spent = actor.actionUses[key] ?? 0;
    if (spent > 0) kept[key] = spent;
  }
  return kept;
}

/** A carried copy's pools that only its hit riders spend (Nine Lives Stealer's charges, one a creature slain), which
 *  never come back: each key with its size. */
function riderPools(item: InventoryItem, catalog: EquipmentCatalog | undefined): Map<string, number> {
  const pools = new Map<string, number>();
  for (const rider of rowRecord(catalog, item)?.onHit ?? [])
    if (rider.spendsCharge) pools.set(itemPool(item, rider.spendsCharge.pool), rider.spendsCharge.limit);
  return pools;
}

/**
 * The charges a Long Rest gives back (SRD: "regains 1d6 + 1 expended charges daily at dawn"): each item pool with a
 * printed regain rolls it, and keeps what is still spent; a pool that never comes back keeps all of it. Returns the
 * spent counts that survive the rest (every other pool refills) and a line per item for the table.
 */
export function chargesAfterDawn(
  actor: Actor,
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog | undefined,
  random: (sides: number) => number
): Readonly<{ stillSpent: Record<string, number>; lines: string[] }> {
  const stillSpent: Record<string, number> = neverRegained(actor, definition, catalog);
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

/** The charge pools a carried row's actions and casts count in, with each one's size, whether or not it is worn. */
export function chargePoolsOfRow(
  item: InventoryItem,
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog | undefined
): Map<string, number> {
  const record = rowRecord(catalog, item);
  const pools = new Map<string, number>();
  if (!record) return pools;
  const actions = [
    ...record.actions.map((declared) => itemAction(item, declared, definition)),
    ...record.casts.map((cast) => castAction(item, cast, item.name, definition, undefined))
  ];
  for (const action of actions) {
    if (!action.uses || action.uses.per === "turn") continue;
    const key = action.uses.pool ?? action.id;
    pools.set(key, Math.max(pools.get(key) ?? 0, action.uses.limit));
  }
  for (const [key, limit] of riderPools(item, catalog)) pools.set(key, limit);
  return pools;
}

/** One of the killer's charges is spent on a creature slain (Nine Lives Stealer). */
export function spendKillCharge(killer: Actor, key: string): void {
  killer.actionUses = { ...killer.actionUses, [key]: (killer.actionUses[key] ?? 0) + 1 };
}

/** A copy just added holds the charges its record rolls for it ("1d6 + 3 beads"): its pools start that many short of
 *  full. Returns what it holds, or null when the record rolls none. */
export function rollStartingCharges(
  actor: Actor,
  item: InventoryItem,
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog | undefined,
  random: (sides: number) => number
): number | null {
  const charges = catalog?.equipmentRecord(catalogIdOf(item))?.charges;
  const byPool = new Map(
    Object.entries(charges?.startingByPool ?? {}).map(([pool, formula]) => [itemPool(item, pool), formula])
  );
  if (!charges?.starting && byPool.size === 0) return null;
  // One roll for the pools that share the item's count; each named pool rolls its own (a helm's four kinds of gem).
  const shared = charges?.starting ? rollRegain(charges.starting, random) : null;
  let held = 0;
  const uses = { ...actor.actionUses };
  for (const [key, limit] of chargePoolsOfRow(item, definition, catalog)) {
    const own = byPool.get(key);
    const rolled = own !== undefined ? rollRegain(own, random) : shared;
    if (rolled === null) continue;
    held += rolled;
    const short = Math.max(0, limit - rolled);
    if (short > 0) uses[key] = short;
    else delete uses[key];
  }
  actor.actionUses = uses;
  return shared ?? held;
}
