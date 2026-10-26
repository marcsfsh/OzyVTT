import { isMeleeWeapon } from "@vtt/rules-5e";
import { catalogIdOf, type AmmunitionKind, type InventoryItem } from "@vtt/schemas";
import { ammunitionOf, withPiecesLeft } from "../ammunition.js";
import { CommandRejectedError } from "../game-store.js";
import { setInventoryItem } from "../inventory.js";
import { fighting } from "../utilize.js";
import type { ResolveContext } from "./context.js";

/**
 * SRD 5.2.1 Oil of Sharpness: "One vial of this oil can coat one Melee weapon or twenty pieces of ammunition, but only
 * ammunition and Melee weapons that are nonmagical and deal Slashing or Piercing damage are affected. Applying the oil
 * takes 1 minute, after which ... turning the coated weapon into a +3 Weapon or the coated ammunition into +3
 * Ammunition." The row picked on the resolve becomes that magic item, bound to what it was.
 */

/** The damage each kind of ammunition deals, from the launcher that fires it (SRD Weapons table). */
const AMMUNITION_DAMAGE: Readonly<Record<AmmunitionKind, string>> = {
  arrow: "piercing",
  bolt: "piercing",
  needle: "piercing",
  "firearm-bullet": "piercing",
  "sling-bullet": "bludgeoning"
};

export function rebindRow(ctx: ResolveContext): void {
  const { state, action, attacker, input, deps } = ctx;
  const spec = action.rebindsRow;
  if (!spec || input.commit === false) return;
  // A minute's work isn't done between turns.
  if (fighting(state, attacker))
    throw new CommandRejectedError(`${action.name} takes 1 minute, so it can't be done in a fight.`);
  const row = attacker.inventory.find((entry) => entry.id === input.itemId && entry.quantity > 0);
  if (!row) throw new CommandRejectedError(`Choose the weapon or the ammunition ${action.name} coats.`);
  const record = deps.catalog?.equipmentRecord(catalogIdOf(row));
  if (record?.isMagic || row.baseId !== undefined)
    throw new CommandRejectedError(`${row.name} is already magical, so the oil does nothing to it.`);
  const ammo = ammunitionOf(row, deps.catalog);
  if (!deps.resolveDefinition) return;
  const write = (item: InventoryItem) =>
    setInventoryItem(state, attacker.id, item, deps.resolveDefinition!, {
      ...(deps.catalog ? { catalog: deps.catalog } : {}),
      role: "gm"
    });
  if (ammo) {
    if (!ammo.kind || !spec.damageTypes.includes(AMMUNITION_DAMAGE[ammo.kind] as never))
      throw new CommandRejectedError(`${row.name} doesn't deal ${spec.damageTypes.join(" or ")} damage.`);
    const pieces = Math.min(spec.pieces, ammo.left);
    write(withPiecesLeft(row, ammo.left - pieces, ammo.count));
    write(magicRow(attacker.inventory, spec.ammunition, deps.catalog, catalogIdOf(row), pieces, false));
    ctx.tableNarration.push({
      kind: "effect",
      text: `${attacker.name} coats ${pieces} of the ${row.name} with the oil: they are +3 ammunition now.`,
      actorIds: [attacker.id]
    });
    return;
  }
  const weapon = row.weapon;
  if (!weapon || !isMeleeWeapon(weapon.properties ?? [], weapon.rangeFeet, weapon.melee))
    throw new CommandRejectedError(`The oil coats a Melee weapon or ammunition, and ${row.name} is neither.`);
  if (!spec.damageTypes.includes(weapon.damageType as never))
    throw new CommandRejectedError(`${row.name} doesn't deal ${spec.damageTypes.join(" or ")} damage.`);
  write({ ...row, quantity: row.quantity - 1 });
  write(magicRow(attacker.inventory, spec.weapon, deps.catalog, catalogIdOf(row), 1, row.equipped));
  ctx.tableNarration.push({
    kind: "effect",
    text: `${attacker.name} coats ${row.name} with the oil: it is a +3 weapon now.`,
    actorIds: [attacker.id]
  });
}

/** A new row of the magic item, bound to the base it was made from, under a free row id. */
function magicRow(
  inventory: readonly InventoryItem[],
  recordId: string,
  catalog: ResolveContext["deps"]["catalog"],
  baseId: string,
  quantity: number,
  equipped: boolean
): InventoryItem {
  const record = catalog?.equipmentRecord(recordId);
  // It weighs what it was made from: a piece of a bundle weighs its share.
  const base = catalog?.equipmentRecord(baseId);
  const weightEach = base?.weightLb != null ? base.weightLb / (base.ammunition?.count ?? 1) : undefined;
  const taken = new Set(inventory.map((entry) => entry.id));
  let id = recordId;
  for (let copy = 2; taken.has(id); copy += 1) id = `${recordId.slice(0, 76)}-${copy}`;
  return {
    id,
    ...(id !== recordId ? { recordId } : {}),
    name: record?.name ?? recordId,
    quantity,
    equipped,
    attuned: false,
    baseId,
    ...(record ? { category: record.category } : {}),
    ...(weightEach !== undefined ? { weightEach } : {}),
    ...(record?.description ? { description: record.description } : {})
  };
}
