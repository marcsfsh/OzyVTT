import type { Actor } from "@vtt/domain";
import type { ItemContainer } from "@vtt/content-srd-5.2.1";
import { catalogIdOf, type InventoryItem } from "@vtt/schemas";
import { ammunitionOf } from "./ammunition.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError } from "./game-store.js";

/**
 * Containers (SRD 5.2.1 Adventuring Gear and Magic Items): a carried row may sit in another carried row that holds
 * things (`InventoryItem.containerId`), up to what that container holds: pounds (a Backpack's 30, a Bag of Holding's
 * 500), pieces of ammunition (a Quiver's 20 Arrows), or a load per compartment (a Handy Haversack's pouches). What a
 * container holds weighs on its carrier through it, unless the container weighs the same whatever it holds (a Bag of
 * Holding's 5 pounds). A row in a container is stowed, never held or worn.
 */

type Row = InventoryItem;
type Inventory = readonly Row[];

/** What a carried row holds, when its record is a container. */
export const containerOf = (row: Row | undefined, catalog: EquipmentCatalog | undefined): ItemContainer | undefined =>
  row ? catalog?.equipmentRecord(catalogIdOf(row))?.container : undefined;

const weightEach = (row: Row, catalog: EquipmentCatalog | undefined): number =>
  row.weightEach ?? catalog?.equipmentRecord(catalogIdOf(row))?.weightLb ?? 0;

/** The carried row a row sits in, when it is still carried; a row whose container is gone is loose. */
export const hostOf = (inventory: Inventory, row: Row): Row | undefined =>
  row.containerId === undefined
    ? undefined
    : inventory.find((other) => other.id === row.containerId && other.id !== row.id && other.quantity > 0);

/** The rows directly in a container, or in one of its compartments. */
export const contentsOf = (inventory: Inventory, containerId: string, compartment?: string): Row[] =>
  inventory.filter(
    (row) =>
      row.quantity > 0 &&
      row.containerId === containerId &&
      row.id !== containerId &&
      (compartment === undefined || row.compartment === compartment)
  );

/** The weight a row puts on whatever carries it: its own, and what it holds unless it weighs the same whatever it
 *  holds. */
export function carriedWeight(
  row: Row,
  inventory: Inventory,
  catalog: EquipmentCatalog | undefined,
  seen: Set<string> = new Set()
): number {
  if (seen.has(row.id)) return 0;
  seen.add(row.id);
  const quantity = Math.max(0, row.quantity);
  const fixed = containerOf(row, catalog)?.weighsLb;
  if (fixed !== undefined) return fixed * quantity;
  return (
    weightEach(row, catalog) * quantity +
    contentsOf(inventory, row.id).reduce((sum, child) => sum + carriedWeight(child, inventory, catalog, seen), 0)
  );
}

/** Everything a creature carries, by weight: each loose row with what it holds. */
export const carriedPounds = (inventory: Inventory, catalog: EquipmentCatalog | undefined): number =>
  inventory
    .filter((row) => hostOf(inventory, row) === undefined)
    .reduce((sum, row) => sum + carriedWeight(row, inventory, catalog), 0);

/** How many things a row is: its pieces of ammunition, else its count. */
const thingsIn = (row: Row, catalog: EquipmentCatalog | undefined): number =>
  ammunitionOf(row, catalog)?.left ?? Math.max(0, row.quantity);

/** Whether a row can be drawn as part of an attack where it lies: loose, or in a quiver or a case. */
export function drawableWhereItLies(inventory: Inventory, row: Row, catalog: EquipmentCatalog | undefined): boolean {
  const host = hostOf(inventory, row);
  return host === undefined || containerOf(host, catalog)?.drawsAmmunition === true;
}

/** The rows a row holds, at any depth. */
export function nestedIn(inventory: Inventory, rowId: string, seen: Set<string> = new Set()): Row[] {
  if (seen.has(rowId)) return [];
  seen.add(rowId);
  return contentsOf(inventory, rowId).flatMap((child) => [child, ...nestedIn(inventory, child.id, seen)]);
}

/** What putting a row in its container does: the row as it is stored, and the rows the move destroys (an overloaded
 *  Bag of Holding with all it held). */
export type Placement = Readonly<{ item: Row; destroys: readonly string[]; why: string | null }>;

/**
 * Checks where a written row sits. A row put in a container must name a carried container that isn't itself or inside
 * it, a compartment the container has, and fit: by kind (a Quiver takes Arrows), by count and by weight. A row in a
 * container is stowed: a write that holds it is refused, and putting it in takes it out of hand. Overloading a container
 * that is then destroyed (a Bag of Holding), or putting one extradimensional space in another, is refused to a player
 * and destroys what the rules say when the GM writes it.
 */
export function placeInContainer(
  actor: Actor,
  incoming: Row,
  stored: Row | undefined,
  catalog: EquipmentCatalog | undefined,
  role: "gm" | "player" | undefined
): Placement {
  if (incoming.containerId === undefined) {
    const { compartment: _gone, ...loose } = incoming;
    return { item: loose, destroys: [], why: null };
  }
  if (incoming.quantity <= 0) return { item: incoming, destroys: [], why: null };
  const inventory = actor.inventory.filter((row) => row.id !== incoming.id);
  const host = inventory.find((row) => row.id === incoming.containerId && row.quantity > 0);
  const holds = containerOf(host, catalog);
  if (!host || !holds) throw new CommandRejectedError(`${actor.name} carries no container to put ${incoming.name} in.`);
  // A container can't go inside itself, or inside something it holds.
  if (host.id === incoming.id || nestedIn(actor.inventory, incoming.id).some((row) => row.id === host.id))
    throw new CommandRejectedError(`${incoming.name} can't go inside something it holds.`);
  const moving = stored?.containerId !== incoming.containerId || stored?.compartment !== incoming.compartment;
  if (incoming.equipped && !moving)
    throw new CommandRejectedError(`${incoming.name} is in ${host.name}. Take it out first.`);
  const item: Row = { ...incoming, equipped: false };
  const compartment = compartmentFor(item, holds, catalog);
  const placed: Row = compartment ? { ...item, compartment: compartment.id } : withoutCompartment(item);
  const grew = moving || (stored?.quantity ?? 0) < incoming.quantity || stored === undefined;
  if (!grew) return { item: placed, destroys: [], why: null };
  // One extradimensional space placed inside another destroys both (a Bag of Holding in a Handy Haversack).
  const chain = hostChain(inventory, host);
  const outer = chain.find((row) => containerOf(row, catalog)?.extradimensional);
  const inner = [placed, ...nestedIn(actor.inventory, placed.id)].find(
    (row) => containerOf(row, catalog)?.extradimensional
  );
  if (outer && inner) {
    const why = `Putting ${inner.name} inside ${outer.name} destroys both and opens a gate to the Astral Plane.`;
    if (role !== "gm") throw new CommandRejectedError(`${why} Ask the GM.`);
    return { item: placed, destroys: [outer.id, inner.id], why };
  }
  const problem = overload(placed, host, holds, compartment, [...inventory, placed], catalog);
  if (problem === null) return { item: placed, destroys: [], why: null };
  if (!holds.overloadDestroys) throw new CommandRejectedError(problem);
  const why = `${problem} Overloaded, ${host.name} is destroyed and what it holds is lost.`;
  if (role !== "gm") throw new CommandRejectedError(`${why} Ask the GM.`);
  return { item: placed, destroys: [host.id], why };
}

type Compartment = NonNullable<ItemContainer["compartments"]>[number];

const withoutCompartment = (row: Row): Row => {
  const { compartment: _gone, ...rest } = row;
  return rest;
};

/** The compartment a row goes in: the one it names, else the first that takes its kind. */
function compartmentFor(row: Row, holds: ItemContainer, catalog: EquipmentCatalog | undefined): Compartment | null {
  const compartments = holds.compartments;
  if (!compartments) return null;
  if (row.compartment !== undefined) {
    const named = compartments.find((entry) => entry.id === row.compartment);
    if (!named) throw new CommandRejectedError(`That container has no compartment "${row.compartment}".`);
    return named;
  }
  return compartments.find((entry) => kindProblem(row, entry.holds, catalog) === null) ?? compartments[0]!;
}

function kindProblem(row: Row, holds: Compartment["holds"], catalog: EquipmentCatalog | undefined): string | null {
  if (holds === "ammunition" && ammunitionOf(row, catalog) === null) return `${row.name} isn't ammunition`;
  if (holds === "weapons" && row.weapon === undefined && catalog?.equipmentRecord(catalogIdOf(row))?.weapon == null)
    return `${row.name} isn't a weapon`;
  return null;
}

/** The containers a container sits in, itself first. */
function hostChain(inventory: Inventory, host: Row): Row[] {
  const chain: Row[] = [];
  const seen = new Set<string>();
  for (let at: Row | undefined = host; at && !seen.has(at.id); at = hostOf(inventory, at)) {
    seen.add(at.id);
    chain.push(at);
  }
  return chain;
}

/** Why the row doesn't fit where it goes, or null when it does. */
function overload(
  row: Row,
  host: Row,
  holds: ItemContainer,
  compartment: Compartment | null,
  inventory: Inventory,
  catalog: EquipmentCatalog | undefined
): string | null {
  const where = compartment ? `${host.name}'s ${compartment.name.toLowerCase()}` : host.name;
  const kind = kindProblem(row, compartment?.holds, catalog);
  if (kind) return `${where} doesn't take it: ${kind}.`;
  const pieces = holds.pieces;
  if (pieces) {
    const ammo = ammunitionOf(row, catalog);
    if (!ammo || (pieces.kinds && ammo.kind !== undefined && !pieces.kinds.includes(ammo.kind)))
      return `${where} holds only ${pieces.kinds?.join(" or ") ?? "ammunition"}.`;
  }
  const inside = contentsOf(inventory, host.id, compartment?.id);
  const count = compartment?.count ?? pieces?.count;
  if (count !== undefined) {
    const things = inside.reduce((sum, child) => sum + thingsIn(child, catalog), 0);
    if (things > count * Math.max(1, host.quantity)) return `${where} holds up to ${count}, and this makes ${things}.`;
  }
  const capacity = compartment?.capacityLb ?? (compartment ? undefined : holds.capacityLb);
  if (capacity !== undefined) {
    const pounds = inside.reduce((sum, child) => sum + carriedWeight(child, inventory, catalog), 0);
    if (pounds > capacity * Math.max(1, host.quantity) + 1e-9)
      return `${where} holds up to ${capacity} pounds, and this makes ${Math.round(pounds * 10) / 10}.`;
  }
  return null;
}
