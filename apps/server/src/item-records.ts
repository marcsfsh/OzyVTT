import type { EquipmentReference, ItemVariant } from "@vtt/content-srd-5.2.1";
import { catalogIdOf, type InventoryItem } from "@vtt/schemas";

/**
 * The catalog record a carried copy reads. One record can cover several kinds of an item (an Ioun Stone's fourteen
 * stones, a Potion of Resistance's ten types) or the forms its holder puts it in (a Rod of Lordly Might's buttons): a
 * copy that is one of them (`InventoryItem.variantId`) reads its kind's riders beside the record's own, so every rule
 * that reads a row's riders reads them through `rowRecord`.
 */

/** The record's kind this copy is, if it picked one the record still lists. */
export function variantOf(
  record: EquipmentReference | undefined,
  item: Pick<InventoryItem, "variantId">
): ItemVariant | undefined {
  return item.variantId === undefined ? undefined : record?.variants?.find((variant) => variant.id === item.variantId);
}

type Grants = NonNullable<EquipmentReference["grants"]>;

/** The grants lists a kind adds beside the record's own. */
const GRANT_LISTS = [
  "skills",
  "expertise",
  "tools",
  "languages",
  "armor",
  "weapons",
  "saves",
  "damageResistances",
  "damageImmunities",
  "conditionImmunities",
  "spells"
] as const;

/** Two grants blocks as one: their lists side by side, under the record's gate. */
function mergedGrants(own: Grants | undefined, added: Grants | undefined): Grants | undefined {
  if (!added) return own;
  if (!own) return added;
  const merged: Record<string, unknown> = { ...own };
  for (const key of GRANT_LISTS)
    merged[key] = [...(own[key] as readonly unknown[]), ...(added[key] as readonly unknown[])];
  return merged as Grants;
}

/** The record as this copy is: its kind's riders beside the record's own, or in place of them for a form that has its
 *  own (`replacesRiders`), and the form's weapon block where it has one (null: no weapon in that form). */
export function withVariant(record: EquipmentReference, item: Pick<InventoryItem, "variantId">): EquipmentReference {
  const variant = variantOf(record, item);
  if (!variant) return record;
  const alone = variant.replacesRiders === true;
  const { light: _light, onHit: _onHit, ...rest } = record;
  const light = variant.light ?? (alone ? undefined : record.light);
  const onHit = alone
    ? variant.onHit
    : variant.onHit
      ? [...(record.onHit ?? []), ...variant.onHit].slice(0, 4)
      : record.onHit;
  return {
    ...rest,
    modifiers: alone ? variant.modifiers : [...record.modifiers, ...variant.modifiers],
    grants: alone ? variant.grants : mergedGrants(record.grants, variant.grants),
    actions: alone ? variant.actions : [...record.actions, ...variant.actions],
    casts: alone ? variant.casts : [...record.casts, ...variant.casts],
    effects: alone ? variant.effects : [...record.effects, ...variant.effects],
    ...(light !== undefined ? { light } : {}),
    ...(onHit !== undefined ? { onHit } : {}),
    ...(variant.weapon !== undefined ? { weapon: variant.weapon } : {})
  };
}

/** The catalog record a carried row reads, with its kind's riders. */
export function rowRecord(
  catalog: Readonly<{ equipmentRecord: (id: string) => EquipmentReference | undefined }> | undefined,
  item: InventoryItem
): EquipmentReference | undefined {
  const record = catalog?.equipmentRecord(catalogIdOf(item));
  return record ? withVariant(record, item) : undefined;
}

/** Who picks the record's kinds: the GM unless the record gives the holder its forms. */
export const variantPickedBy = (record: EquipmentReference | undefined) => record?.variantChoice?.by ?? "gm";

/** A record's weapon block as an inventory row carries it. */
export function rowWeaponOf(weapon: NonNullable<EquipmentReference["weapon"]>): NonNullable<InventoryItem["weapon"]> {
  return {
    category: weapon.category === "martial" ? "martial" : "simple",
    damageDice: weapon.damageDice,
    damageType: weapon.damageType,
    rangeFeet: weapon.rangeFeet ?? null,
    longRangeFeet: weapon.longRangeFeet ?? null,
    ...(weapon.melee !== undefined ? { melee: weapon.melee } : {}),
    ...(weapon.versatileDice !== undefined ? { versatileDice: weapon.versatileDice } : {}),
    ...(weapon.properties !== undefined ? { properties: [...weapon.properties] } : {})
  };
}
