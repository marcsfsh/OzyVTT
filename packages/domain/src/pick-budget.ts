// How many picks an `extraPicks` grant is worth. The server's offer survey reads it for a create and for
// the builder's offers alike.

import type { z } from "zod";
import type { PickBudgetScalingSchema } from "@vtt/schemas";

/** The printed-column scaling an extra pick may name. */
export type PickBudgetScaling = Readonly<z.infer<typeof PickBudgetScalingSchema>>;

/** One `extraPicks` entry as it crosses the wire and as the bundle authors it. */
export type PickBudgetGrant = Readonly<{ offer: string; amount?: number | null; scaling?: PickBudgetScaling | null }>;

/** Structural so both the server's `ClassLevelRow` and the wire's `ContentClassLevelRow` satisfy it. */
export type PrintedResourceRow = Readonly<{
  level: number;
  classResources: ReadonlyArray<Readonly<{ id: string; amount: number | string }>>;
}>;

/** A printed cell as a count; a dice string ("3d6") reads as absent. */
const countOf = (amount: number | string | undefined): number | null => (typeof amount === "number" ? amount : null);

const valueAt = (table: readonly PrintedResourceRow[], level: number, id: string): number | null =>
  countOf(table.find((row) => row.level === level)?.classResources.find((resource) => resource.id === id)?.amount);

/**
 * How far a printed column has grown above its first printed value at `level`. The feature's own `choose`
 * covers the first value (Eldritch Invocations prints 1 at level 1), so the grant is the growth. Never negative,
 * and 0 when the class prints no such column.
 */
export function classResourceGrowth(table: readonly PrintedResourceRow[], level: number, id: string): number {
  const current = valueAt(table, level, id);
  if (current === null) return 0;
  const first = table
    .filter((row) => row.level <= level)
    .map((row) => countOf(row.classResources.find((resource) => resource.id === id)?.amount))
    .find((value) => value !== null);
  if (first === null || first === undefined) return 0;
  return Math.max(0, current - first);
}

/** What one grant adds to its budget for a character of this class at this level. */
export function extraPickAmount(grant: PickBudgetGrant, table: readonly PrintedResourceRow[], level: number): number {
  if (grant.scaling) return classResourceGrowth(table, level, grant.scaling.id);
  return grant.amount ?? 0;
}
