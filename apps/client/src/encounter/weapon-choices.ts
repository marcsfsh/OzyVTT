import type { ContentActionSummary } from "@vtt/domain";

/** A carried row as the sheet has it, with what a weapon pick reads. */
export type CarriedRow = Readonly<{
  id: string;
  name: string;
  quantity: number;
  recordId?: string;
  baseId?: string;
  weapon?: Readonly<{ rangeFeet: number | null; melee?: boolean; properties?: readonly string[] }>;
  category?: string;
}>;

/**
 * The carried weapons a grant can be cast on (Shillelagh: a Club or Quarterstaff; Sacred Weapon: a Melee weapon), or the
 * stacks of ammunition a coat goes on (Basic Poison), for the pick. The server checks the pick again, and refuses a
 * magic one where the spell says so.
 */
export function weaponChoicesOf(
  rows: readonly CarriedRow[],
  binds: NonNullable<ContentActionSummary["choices"]>["bindsWeapon"]
): readonly CarriedRow[] {
  if (!binds) return [];
  return rows.filter((row) => {
    if (row.quantity <= 0) return false;
    if (row.category === "ammunition") return binds.ammunition !== undefined;
    if (!row.weapon || binds.ammunition === "only") return false;
    const ids = [row.recordId ?? row.id, ...(row.baseId !== undefined ? [row.baseId] : [])];
    if (binds.weaponIds && !binds.weaponIds.some((id) => ids.includes(id))) return false;
    const melee =
      row.weapon.melee ?? (row.weapon.rangeFeet === null || (row.weapon.properties ?? []).includes("thrown"));
    return !binds.melee || melee;
  });
}
