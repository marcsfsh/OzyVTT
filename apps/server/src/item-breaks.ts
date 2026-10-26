import type { EquipmentReference } from "@vtt/content-srd-5.2.1";
import type { Actor } from "@vtt/domain";
import type { ActorAction, ActorDefinition, InventoryItem } from "@vtt/schemas";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { itemRowOfAction } from "./item-charges.js";
import { rowRecord } from "./item-records.js";
import { endItemMagic } from "./item-spent.js";

/**
 * SRD items that may break with use: a Horn of Blasting ("Each use of the horn's magic has a 20 percent chance of
 * causing the horn to explode") and a Wind Fan ("Each subsequent time the fan is used before the next dawn, it has a
 * cumulative 20 percent chance of not working"). The server rolls the d100 in a fight and outside one.
 */

type Breaks = NonNullable<EquipmentReference["breaks"]>;

/** The carried item this action may break, with how it breaks. */
export function breakableItemOf(
  action: Pick<ActorAction, "id">,
  inventory: readonly InventoryItem[],
  catalog: EquipmentCatalog | undefined
): Readonly<{ row: InventoryItem; breaks: Breaks }> | null {
  const row = itemRowOfAction(action.id, inventory);
  const breaks = row && catalog ? rowRecord(catalog, row)?.breaks : undefined;
  return row && breaks ? { row, breaks } : null;
}

/** The percent chance this use breaks it: its own each time, or for one that wears with use (a Wind Fan) its own for
 *  each use of its pool since the last Long Rest before this one. */
export function breakChance(breaks: Breaks, usesBefore: number): number {
  return Math.min(100, breaks.cumulative ? breaks.percent * usesBefore : breaks.percent);
}

/** What the table reads when it breaks. */
export function brokenLine(itemName: string, face: number, hurt: string | null): string {
  return `${itemName} breaks: the d100 shows ${face}${hurt ? `, and ${hurt}` : ""}.`;
}

/** Outside a fight: rolls the break for one use, destroying the item when it breaks, and returns the table's line, or
 *  null when it holds. The damage it deals its user is rolled and told, since the loose route moves no Hit Points. */
export function looseBreak(
  actor: Actor,
  found: Readonly<{ row: InventoryItem; breaks: Breaks }>,
  usesBefore: number,
  rolls: Readonly<{ d100: (label: string) => number; damage: (formula: string) => number }>,
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog | undefined
): string | null {
  const chance = breakChance(found.breaks, usesBefore);
  if (chance <= 0) return null;
  const face = rolls.d100(`${found.row.name} breaking (${chance} percent)`);
  if (face > chance) return null;
  const damage = found.breaks.damage;
  const hurt = damage
    ? `it deals ${rolls.damage(damage.formula)} ${damage.type[0]!.toUpperCase()}${damage.type.slice(1)} damage to ${actor.name} (${damage.formula})`
    : null;
  return `${brokenLine(found.row.name, face, hurt)} ${endItemMagic(actor, found.row, "destroyed", definition, catalog)}`;
}
