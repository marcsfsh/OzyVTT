import type { Actor, GameState } from "@vtt/domain";
import type { EquipmentReference } from "@vtt/content-srd-5.2.1";
import { catalogIdOf, type AmmunitionKind, type InventoryItem, type OnHitRider } from "@vtt/schemas";
import { effectiveSlot, type RiderCarrier } from "@vtt/rules-5e";
import { drawableWhereItLies } from "./containers.js";
import { rowRecord } from "./item-records.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";

/**
 * SRD Ammunition: a weapon with the Ammunition property makes a ranged attack only with ammunition to fire, each
 * attack expends one piece, and after a fight half the pieces used can be recovered. The pieces are counted on the
 * carried row: a bundle row ("Arrows (20)") counts each piece, magic ammunition is counted one per quantity.
 */

const KIND_LABELS: Readonly<Record<AmmunitionKind, string>> = {
  arrow: "arrows",
  bolt: "bolts",
  "firearm-bullet": "firearm bullets",
  needle: "needles",
  "sling-bullet": "sling bullets"
};

export const ammunitionLabel = (kind: AmmunitionKind | undefined) => (kind ? KIND_LABELS[kind] : "ammunition");

/** What a weapon row fires, from its catalog record (a bound template's base first, so an Oathbow fires arrows).
 *  Null for a weapon without the Ammunition property; undefined when its kind isn't recorded (any ammunition). */
export function launcherKind(
  row: InventoryItem,
  catalog: EquipmentCatalog | undefined
): AmmunitionKind | null | undefined {
  if (!row.weapon?.properties?.includes("ammunition")) return null;
  const base = row.baseId ? catalog?.equipmentRecord(row.baseId) : undefined;
  return (base ?? catalog?.equipmentRecord(catalogIdOf(row)))?.weapon?.ammunition ?? undefined;
}

export type AmmunitionRow = Readonly<{
  row: InventoryItem;
  record: EquipmentReference | undefined;
  /** Pieces per one quantity: 20 for "Arrows (20)", 1 for magic ammunition. */
  count: number;
  left: number;
  /** The bundle's kind, or the kind magic ammunition was bound to (its `baseId`). Undefined when nothing records
   *  one (homebrew ammunition with no base), which fits any launcher. */
  kind: AmmunitionKind | undefined;
  /** Magic ammunition still waiting for its kind to be picked: it fits no launcher. */
  unbound: boolean;
}>;

const piecesLeft = (row: InventoryItem, count: number) => Math.max(0, row.ammunitionLeft ?? row.quantity * count);

export function ammunitionOf(row: InventoryItem, catalog: EquipmentCatalog | undefined): AmmunitionRow | null {
  const record = catalog?.equipmentRecord(catalogIdOf(row));
  const bundle = record?.ammunition;
  const slot = effectiveSlot({ slot: record?.slot ?? row.magic?.slot, category: row.category });
  if (bundle === undefined && slot !== "ammunition") return null;
  const count = bundle?.count ?? 1;
  // "Weapon (Any Ammunition)": a magic arrow is an arrow, so it fits only a bow.
  const base = row.baseId !== undefined ? catalog?.equipmentRecord(row.baseId)?.ammunition : undefined;
  return {
    row,
    record,
    count,
    left: piecesLeft(row, count),
    kind: bundle?.kind ?? base?.kind,
    unbound: record?.appliesTo != null && base === undefined
  };
}

/** The row a shot draws from: equipped magic ammunition first (its bonus applies only while it is equipped), then
 *  equipped, then carried; unequipped magic ammunition last. Null when nothing that fits is left. */
export function ammunitionFor(
  actor: Pick<Actor, "inventory">,
  kind: AmmunitionKind | undefined,
  catalog: EquipmentCatalog | undefined
): AmmunitionRow | null {
  const rank = (ammo: AmmunitionRow) =>
    ammo.row.equipped ? (ammo.record?.isMagic ? 0 : 1) : ammo.record?.isMagic ? 3 : 2;
  const fitting = actor.inventory.flatMap((row) => {
    const ammo = ammunitionOf(row, catalog);
    // Pieces stowed in a pack or a bag aren't drawn as part of an attack; a quiver's are.
    return ammo &&
      drawableWhereItLies(actor.inventory, row, catalog) &&
      !ammo.unbound &&
      ammo.left > 0 &&
      (ammo.kind === undefined || kind === undefined || ammo.kind === kind)
      ? [ammo]
      : [];
  });
  return fitting.sort((left, right) => rank(left) - rank(right))[0] ?? null;
}

/** The ammunition a shot from this row fires: the launcher's kind and the piece it draws. Null when the row is no
 *  launcher; `ammo` is null when nothing that fits is left. */
export function shotFrom(
  actor: Pick<Actor, "inventory">,
  launcherId: string | null,
  catalog: EquipmentCatalog | undefined
): Readonly<{ launcher: InventoryItem; kind: AmmunitionKind | undefined; ammo: AmmunitionRow | null }> | null {
  const launcher = launcherId === null ? undefined : actor.inventory.find((row) => row.id === launcherId);
  const kind = launcher ? launcherKind(launcher, catalog) : null;
  if (!launcher || kind === null) return null;
  return { launcher, kind, ammo: ammunitionFor(actor, kind, catalog) };
}

/** A piece of magic ammunition's bonus is for attacks "made with this piece" (SRD): a resolve keeps the riders of
 *  the ammunition row its shot draws from, and none of any other ammunition row. */
export function withShotAmmunitionOnly<T extends Readonly<{ carriers: readonly RiderCarrier[] }>>(
  derivation: T,
  actor: Pick<Actor, "inventory">,
  launcherId: string | null,
  catalog: EquipmentCatalog | undefined
): T {
  const drawn = shotFrom(actor, launcherId, catalog)?.ammo?.row.id;
  const others = new Set(
    actor.inventory.filter((row) => row.id !== drawn && ammunitionOf(row, catalog) !== null).map((row) => row.id)
  );
  if (!derivation.carriers.some((carrier) => carrier.sourceItemId !== undefined && others.has(carrier.sourceItemId)))
    return derivation;
  return {
    ...derivation,
    carriers: derivation.carriers.filter(
      (carrier) => carrier.sourceItemId === undefined || !others.has(carrier.sourceItemId)
    )
  };
}

/** SRD Ammunition of Slaying and its kin: a piece's own hit riders ride the shot that draws it (the DC 17 Constitution
 *  save of an Arrow of Dragon Slaying against a dragon), its kind's included. */
export function withShotHitRiders<A extends Readonly<{ onHit?: readonly OnHitRider[] }>>(
  action: A,
  actor: Pick<Actor, "inventory">,
  launcherId: string | null,
  catalog: EquipmentCatalog | undefined
): A {
  const drawn = shotFrom(actor, launcherId, catalog)?.ammo?.row;
  const riders = drawn ? rowRecord(catalog, drawn)?.onHit : undefined;
  if (!riders || riders.length === 0) return action;
  return { ...action, onHit: [...(action.onHit ?? []), ...structuredClone(riders)].slice(0, 4) };
}

/** A row holding `left` pieces: its quantity is the bundles still holding any, and a partly spent bundle keeps the
 *  exact count. */
export function withPiecesLeft(row: InventoryItem, left: number, count: number): InventoryItem {
  const quantity = Math.ceil(left / count);
  const { ammunitionLeft: _stored, ...rest } = row;
  return left === quantity * count ? { ...rest, quantity } : { ...rest, quantity, ammunitionLeft: left };
}

/** Expends one piece. A piece that can be picked up after the fight is counted toward recovery. Magic ammunition that
 *  hit is no longer magical (`struck`), so it doesn't come back to its row: half of those come back as plain
 *  ammunition of their kind. */
export function spendPiece(actor: Actor, ammo: AmmunitionRow, recoverable: boolean, struck = false): void {
  const spent = !recoverable && struck && ammo.record?.isMagic === true;
  actor.inventory = actor.inventory.map((row) =>
    row.id !== ammo.row.id
      ? row
      : withPiecesLeft(
          recoverable
            ? { ...row, ammunitionFired: Math.min(10_000, (row.ammunitionFired ?? 0) + 1) }
            : spent
              ? { ...row, ammunitionSpent: Math.min(10_000, (row.ammunitionSpent ?? 0) + 1) }
              : row,
          ammo.left - 1,
          ammo.count
        )
  );
}

/** A thrown weapon leaves its thrower's hand: one fewer is carried, and it is counted to be picked up after the fight. */
export function leaveHand(actor: Actor, row: InventoryItem): void {
  actor.inventory = actor.inventory.map((entry) =>
    entry.id !== row.id
      ? entry
      : {
          ...entry,
          quantity: Math.max(0, entry.quantity - 1),
          thrownAway: Math.min(10_000, (entry.thrownAway ?? 0) + 1)
        }
  );
}

/** After a fight, half the pieces fired from each row come back, rounded down, and the rest are lost; half of the
 *  magic pieces that hit come back as plain ammunition of their kind; every thrown weapon is picked up. One line per
 *  row that got any back. */
export function recoverAmmunition(
  state: GameState,
  actorIds: readonly string[],
  catalog: EquipmentCatalog | undefined
): Array<Readonly<{ actorId: string; text: string }>> {
  const lines: Array<{ actorId: string; text: string }> = [];
  for (const actor of state.actors) {
    if (!actorIds.includes(actor.id) || !actor.inventory.some(owesRecovery)) continue;
    const plain: Array<Readonly<{ baseId: string; pieces: number }>> = [];
    actor.inventory = actor.inventory.map((row) => {
      if (!owesRecovery(row)) return row;
      const { ammunitionFired: fired, ammunitionSpent: spent, thrownAway: thrown, ...rest } = row;
      let next: InventoryItem = rest;
      if (thrown) {
        next = { ...next, quantity: next.quantity + thrown };
        lines.push({ actorId: actor.id, text: `${actor.name} picks up the ${row.name} thrown in the fight (${thrown}).` });
      }
      const ammo = fired ? ammunitionOf(next, catalog) : null;
      const back = Math.floor((fired ?? 0) / 2);
      if (ammo && back > 0) {
        lines.push({ actorId: actor.id, text: `${actor.name} recovers ${back} of the ${fired} pieces fired from ${row.name}.` });
        next = withPiecesLeft(next, ammo.left + back, ammo.count);
      }
      const plainBack = Math.floor((spent ?? 0) / 2);
      if (plainBack > 0 && row.baseId !== undefined) plain.push({ baseId: row.baseId, pieces: plainBack });
      return next;
    });
    for (const { baseId, pieces } of plain) {
      const name = gainPlainPieces(actor, baseId, pieces, catalog);
      lines.push({ actorId: actor.id, text: `${actor.name} recovers ${pieces} plain ${name}, their magic spent.` });
    }
  }
  return lines;
}

const owesRecovery = (row: InventoryItem): boolean =>
  row.ammunitionFired !== undefined || row.ammunitionSpent !== undefined || row.thrownAway !== undefined;

/** Adds plain pieces of a bundle's kind (arrows, bolts) to the stack carried, or a new one; the stack's name. */
function gainPlainPieces(actor: Actor, baseId: string, pieces: number, catalog: EquipmentCatalog | undefined): string {
  const record = catalog?.equipmentRecord(baseId);
  const count = record?.ammunition?.count ?? 1;
  const name = record ? ammunitionLabel(record.ammunition?.kind) : baseId;
  const stack = actor.inventory.find((row) => catalogIdOf(row) === baseId && row.baseId === undefined);
  if (stack) {
    const left = ammunitionOf(stack, catalog)?.left ?? stack.quantity * count;
    actor.inventory = actor.inventory.map((row) => (row === stack ? withPiecesLeft(row, left + pieces, count) : row));
    return name;
  }
  const taken = new Set(actor.inventory.map((row) => row.id));
  let id = baseId;
  for (let copy = 2; taken.has(id); copy += 1) id = `${baseId.slice(0, 76)}-${copy}`;
  const row: InventoryItem = {
    id,
    ...(id !== baseId ? { recordId: baseId } : {}),
    name: record?.name ?? baseId,
    quantity: 1,
    equipped: false,
    attuned: false,
    ...(record ? { category: record.category } : {}),
    ...(record?.weightLb != null ? { weightEach: record.weightLb } : {})
  };
  actor.inventory = [...actor.inventory, withPiecesLeft(row, pieces, count)];
  return name;
}

/** The pieces counts are the server's: a sheet write keeps them, and a quantity change moves the pieces by whole
 *  bundles (one more "Arrows (20)" adds 20). */
export function keepAmmunitionCount(
  stored: InventoryItem | undefined,
  incoming: InventoryItem,
  catalog: EquipmentCatalog | undefined
): InventoryItem {
  const {
    ammunitionLeft: _left,
    ammunitionFired: _fired,
    ammunitionSpent: _spent,
    thrownAway: _thrown,
    ...rest
  } = incoming;
  if (!stored || (incoming.quantity <= 0 && !owesRecovery(stored))) return rest;
  const kept: InventoryItem = {
    ...rest,
    ...(stored.ammunitionFired !== undefined ? { ammunitionFired: stored.ammunitionFired } : {}),
    ...(stored.ammunitionSpent !== undefined ? { ammunitionSpent: stored.ammunitionSpent } : {}),
    ...(stored.thrownAway !== undefined ? { thrownAway: stored.thrownAway } : {})
  };
  if (stored.ammunitionLeft === undefined) return kept;
  const count = catalog?.equipmentRecord(catalogIdOf(stored))?.ammunition?.count ?? 1;
  return withPiecesLeft(
    kept,
    Math.max(0, stored.ammunitionLeft + (incoming.quantity - stored.quantity) * count),
    count
  );
}
