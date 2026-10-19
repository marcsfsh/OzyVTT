import type { ClassReference } from "@vtt/content-srd-5.2.1";
import type { ActorDefinition } from "@vtt/schemas";

/** One printed column of a class's table at the character's level in that class, as the sheet shows it. */
export type ClassColumn = Readonly<{ classId: string; className: string; id: string; name: string; value: string }>;

/** How a column's number reads on the sheet: Rage Damage is a bonus, Unarmored Movement a distance. */
const UNITS: Readonly<Record<string, (amount: number) => string>> = {
  "rage-damage": (amount) => `+${amount}`,
  "unarmored-movement": (amount) => `+${amount} ft`
};

/**
 * The columns a class table prints that no use counts (the Bardic Die, Martial Arts, Sneak Attack, Rage Damage,
 * Eldritch Invocations, Weapon Mastery), each class at its own level. A column wired to a pool (Rages, Focus Points,
 * Sorcery Points) is on the sheet's Uses already. Empty for a sheet with no classes the catalog knows.
 */
export function classColumnsOf(
  definition: ActorDefinition | undefined,
  classRecord: (id: string) => ClassReference | undefined
): ClassColumn[] {
  return (definition?.character?.classes ?? []).flatMap((entry) => {
    const record = classRecord(entry.id);
    const row = record?.levelTable.find((candidate) => candidate.level === entry.level);
    if (!record || !row) return [];
    return row.classResources
      .filter((column) => column.display === true)
      .map((column) => ({
        classId: record.id,
        className: entry.name,
        id: column.id,
        name: column.name,
        value:
          typeof column.amount === "number"
            ? (UNITS[column.id]?.(column.amount) ?? String(column.amount))
            : column.amount.replace(/^1d/, column.id === "bardic-inspiration" ? "d" : "1d")
      }));
  });
}
