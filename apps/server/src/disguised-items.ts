import type { EquipmentReference } from "@vtt/content-srd-5.2.1";
import { catalogIdOf, type InventoryItem } from "@vtt/schemas";

/**
 * A carried copy its holder takes for another item until it is identified: a Potion of Poison "looks, smells, and
 * tastes like a Potion of Healing". The row keeps the truth for the GM. Its id is minted from the item it passes for,
 * so nothing the holder receives names the record, and the holder's projection, available actions and the table's
 * lines name the item it passes for.
 */

type Catalog = Readonly<{ equipmentRecord: (id: string) => EquipmentReference | undefined }>;

/** The holder still takes it for the item it passes for. */
export const disguised = (item: Pick<InventoryItem, "disguisedAs" | "identified">): boolean =>
  item.disguisedAs !== undefined && item.identified !== true;

/** The row as its holder sees it: the record it passes for, under the same row id. Without the catalog it is a plain
 *  "Potion", never its record. */
export function rowAsSeen(item: InventoryItem, catalog: Catalog | undefined): InventoryItem {
  const { disguisedAs, recordId: _recordId, description: _description, magic: _magic, ...rest } = item;
  if (disguisedAs === undefined) return item;
  if (item.identified === true) {
    const { disguisedAs: _gone, ...known } = item;
    return known;
  }
  const { category: _category, weightEach: _weightEach, ...plain } = rest;
  const shown = catalog?.equipmentRecord(disguisedAs);
  const magic = shown && "isMagic" in shown && shown.isMagic === true;
  return {
    ...plain,
    name: shown?.name ?? "Potion",
    ...(item.id !== disguisedAs ? { recordId: disguisedAs } : {}),
    ...(shown?.description ? { description: shown.description } : {}),
    ...(shown?.category ? { category: shown.category } : {}),
    ...(shown?.weightLb !== null && shown?.weightLb !== undefined ? { weightEach: shown.weightLb } : {}),
    ...(magic
      ? {
          magic: {
            isMagic: true,
            attunementRequired: shown.attunement?.required === true,
            ...(shown.slot ? { slot: shown.slot } : {})
          }
        }
      : {})
  };
}

/** The name the table hears an item by: the one it passes for while its holder takes it for that. */
export const shownName = (item: InventoryItem, catalog: Catalog | undefined): string => rowAsSeen(item, catalog).name;

/** A new disguised row's id and marks: the first free id of the item it passes for, with the true record kept. */
export function mintDisguise(
  item: InventoryItem,
  taken: ReadonlySet<string>,
  catalog: Catalog | undefined
): InventoryItem {
  const recordId = catalogIdOf(item);
  const disguisedAs = item.disguisedAs ?? catalog?.equipmentRecord(recordId)?.disguisedAs;
  if (disguisedAs === undefined) return item;
  let id = disguisedAs;
  for (let copy = 2; taken.has(id); copy += 1) id = `${disguisedAs.slice(0, 76)}-${copy}`;
  return { ...item, id, recordId, disguisedAs };
}

/** What the holder can't change about a disguised row: the record it is and the one it passes for. A player's edit
 *  carries the disguise it was shown, so the row keeps its own name and text; the GM's edit keeps only the record. */
export function keepDisguise(
  stored: InventoryItem | undefined,
  item: InventoryItem,
  role: "gm" | "player" | undefined
): InventoryItem {
  if (stored?.disguisedAs === undefined) return item;
  const kept: InventoryItem = { ...item, disguisedAs: stored.disguisedAs };
  if (stored.recordId !== undefined) kept.recordId = stored.recordId;
  if (role !== "player") return kept;
  const { description: _d, category: _c, weightEach: _w, magic: _m, ...rest } = kept;
  return {
    ...rest,
    name: stored.name,
    ...(stored.description !== undefined ? { description: stored.description } : {}),
    ...(stored.category !== undefined ? { category: stored.category } : {}),
    ...(stored.weightEach !== undefined ? { weightEach: stored.weightEach } : {}),
    ...(stored.magic !== undefined ? { magic: stored.magic } : {})
  };
}
