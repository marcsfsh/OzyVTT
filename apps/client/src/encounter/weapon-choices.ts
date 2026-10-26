import type { ContentActionSummary } from "@vtt/domain";

/** A carried row as the sheet has it, with what a weapon pick reads. */
export type CarriedRow = Readonly<{
  id: string;
  name: string;
  quantity: number;
  recordId?: string;
  baseId?: string;
  weapon?: Readonly<{ rangeFeet: number | null; melee?: boolean; properties?: readonly string[] }>;
  armor?: unknown;
  category?: string;
  equipped?: boolean;
}>;

/**
 * The carried weapons a grant can be cast on (Shillelagh: a Club or Quarterstaff; Sacred Weapon: a Melee weapon), for
 * the pick. The server checks the pick again, and refuses a magic one where the spell says so.
 */
export function weaponChoicesOf(
  rows: readonly CarriedRow[],
  binds: NonNullable<ContentActionSummary["choices"]>["bindsWeapon"]
): readonly CarriedRow[] {
  if (!binds) return [];
  return rows.filter((row) => {
    if (!row.weapon || row.quantity <= 0) return false;
    const ids = [row.recordId ?? row.id, ...(row.baseId !== undefined ? [row.baseId] : [])];
    if (binds.weaponIds && !binds.weaponIds.some((id) => ids.includes(id))) return false;
    const melee =
      row.weapon.melee ?? (row.weapon.rangeFeet === null || (row.weapon.properties ?? []).includes("thrown"));
    return !binds.melee || melee;
  });
}

/** The target's armor and weapons an action acts on (a rust monster's Antennae): the body armor it wears and the
 *  weapons it carries, for the pick. The server checks the pick again, refusing a magic one or one of the wrong stuff. */
export function objectChoicesOf(
  rows: readonly CarriedRow[],
  object: NonNullable<ContentActionSummary["choices"]>["object"]
): readonly CarriedRow[] {
  if (!object) return [];
  return rows.filter(
    (row) =>
      row.quantity > 0 &&
      ((object.kinds.includes("armor") &&
        row.armor !== undefined &&
        row.equipped === true &&
        row.category !== "shield") ||
        (object.kinds.includes("weapon") && row.weapon !== undefined))
  );
}
