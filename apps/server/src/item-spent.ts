import type { Actor } from "@vtt/domain";
import type { EquipmentReference } from "@vtt/content-srd-5.2.1";
import type { ActorDefinition, InventoryItem } from "@vtt/schemas";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { bindTemplateItem, reconcileEquipment } from "./inventory.js";
import { chargePoolsOfRow } from "./item-charges.js";

/**
 * What happens to a magic item when its magic runs out (SRD: "the wand crumbles into ashes and is destroyed", "the gem
 * becomes a nonmagical jewel", "the staff becomes a nonmagical Quarterstaff"): the record's `charges.lastCharge` says
 * which, and the last charge's d20, a summon's death or an emptied pool sets it off.
 */

export type ItemEnd = NonNullable<NonNullable<EquipmentReference["charges"]>["lastCharge"]>;

/** Ends one carried copy's magic as `outcome` says. Its charge counts go with it, so a copy added later starts full.
 *  Returns the sentence for the table. */
export function endItemMagic(
  actor: Actor,
  item: InventoryItem,
  outcome: ItemEnd,
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog | undefined
): string {
  const keys = [...chargePoolsOfRow(item, definition, catalog).keys()];
  actor.actionUses = Object.fromEntries(Object.entries(actor.actionUses).filter(([key]) => !keys.includes(key)));
  actor.readyAt = Object.fromEntries(Object.entries(actor.readyAt).filter(([key]) => !keys.includes(key)));
  if (outcome === "destroyed") {
    actor.inventory = actor.inventory.filter((entry) => entry.id !== item.id);
    reconcileEquipment(actor, definition, { catalog });
    return `${item.name} is destroyed.`;
  }
  if (outcome === "nonmagical") {
    // The row stays, a plain object now: no rider, action, cast or light of its record applies to a spent copy.
    const { lit: _lit, ...rest } = item;
    actor.inventory = actor.inventory.map((entry) =>
      entry.id === item.id ? { ...rest, attuned: false, dormant: true } : entry
    );
    reconcileEquipment(actor, definition, { catalog });
    return `${item.name} loses its magic.`;
  }
  const plain = catalog?.equipmentRecord(outcome.becomes);
  const base = outcome.baseId !== undefined ? catalog?.equipmentRecord(outcome.baseId) : undefined;
  const plainName = plain?.name ?? outcome.becomes;
  const name = base ? `${plainName} (${base.name})` : plainName;
  const row = bindTemplateItem(
    {
      id: item.id,
      name,
      quantity: 1,
      equipped: item.equipped,
      attuned: false,
      recordId: outcome.becomes,
      ...(outcome.baseId !== undefined ? { baseId: outcome.baseId } : {})
    },
    { catalog, role: "gm" }
  );
  actor.inventory = actor.inventory.map((entry) => (entry.id === item.id ? row : entry));
  reconcileEquipment(actor, definition, { catalog });
  return `${item.name} loses its magic and is a ${name} now.`;
}
