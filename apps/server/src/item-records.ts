import type { EquipmentReference, ItemVariant, ItemWeaponChanges } from "@vtt/content-srd-5.2.1";
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

/** The record as this copy is: its kind's riders beside the record's own, or for a form that has its own numbers
 *  (`replacesRiders`) its modifiers, hit riders and light in place of the record's; and the form's weapon block where it
 *  has one (null: no weapon in that form). */
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
    grants: mergedGrants(record.grants, variant.grants),
    // A form can set the item's own actions aside (a Quarterstaff of the Acrobat folded into a rod can't deflect).
    actions: variant.suspendsActions ? variant.actions : [...record.actions, ...variant.actions],
    casts: variant.suspendsActions ? variant.casts : [...record.casts, ...variant.casts],
    effects: [...record.effects, ...variant.effects],
    ...(light !== undefined ? { light } : {}),
    ...(onHit !== undefined ? { onHit } : {}),
    ...(variant.weapon !== undefined ? { weapon: variant.weapon } : {}),
    ...(variant.regainsHitPoints ? { regainsHitPoints: variant.regainsHitPoints } : {})
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

/** Which item a copy is, for "a creature can't attune to more than one copy of an item": its record, and the kind the
 *  GM says it is where the record covers several items (an Ioun Stone of Protection and one of Insight are two). */
export function copyKeyOf(record: EquipmentReference | undefined, item: InventoryItem): string {
  const kind = record?.variants && variantPickedBy(record) === "gm" ? item.variantId : undefined;
  return kind === undefined ? catalogIdOf(item) : `${catalogIdOf(item)}#${kind}`;
}

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

/** What a magic weapon changes about its bound base (SRD: a Dwarven Thrower "has the Thrown property with a normal range
 *  of 20 feet and a long range of 60 feet"; an Energy Bow's arrows deal Force damage and need no ammunition). */
export function withWeaponChanges(
  weapon: NonNullable<InventoryItem["weapon"]>,
  changes: ItemWeaponChanges | undefined
): NonNullable<InventoryItem["weapon"]> {
  if (!changes) return weapon;
  const properties = [...(weapon.properties ?? []), ...(changes.addProperties ?? [])].filter(
    (property, index, all) => all.indexOf(property) === index && !(changes.removeProperties ?? []).includes(property)
  );
  return {
    ...weapon,
    ...(changes.damageType ? { damageType: changes.damageType } : {}),
    ...(changes.rangeFeet !== undefined ? { rangeFeet: changes.rangeFeet } : {}),
    ...(changes.longRangeFeet !== undefined ? { longRangeFeet: changes.longRangeFeet } : {}),
    ...(changes.addProperties || changes.removeProperties ? { properties } : {})
  };
}

/** The weapon block a carried copy swings as: its form's, none in a form without one, else its own (a template's
 *  bound base with what the item changes about it). */
export function rowWeaponFor(
  catalog: Readonly<{ equipmentRecord: (id: string) => EquipmentReference | undefined }>,
  record: EquipmentReference,
  item: InventoryItem
): InventoryItem["weapon"] | undefined {
  const form = variantOf(record, item);
  if (form?.weapon === null) return undefined;
  if (form?.weapon) return rowWeaponOf(form.weapon);
  if (!record.appliesTo) return record.weapon ? rowWeaponOf(record.weapon) : undefined;
  const baseId = item.baseId ?? (record.appliesTo.baseIds.length === 1 ? record.appliesTo.baseIds[0] : undefined);
  const base = baseId === undefined ? undefined : catalog.equipmentRecord(baseId)?.weapon;
  return base ? withWeaponChanges(rowWeaponOf(base), record.weaponChanges) : undefined;
}
