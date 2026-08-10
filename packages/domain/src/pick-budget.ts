/**
 * HOW MANY PICKS AN `extraPicks` GRANT IS WORTH - resolved once, for both consumers.
 *
 * A grant states either a flat `amount` or a `scaling` rule that reads the class's own printed
 * column. The wizard decides what the player may pick and the server re-validates it, so the two
 * must agree to the number: offering one more than the server allows refuses the build at Create,
 * and offering one fewer makes the promise in the feature's text unselectable. That agreement is
 * this file - one function, imported by `build-payload.ts` and `character-build.ts` alike, exactly
 * as `resolveCatalogChoice` is the one resolver for `fromCatalog`.
 *
 * Pure: same inputs, same number, no I/O.
 */

/** The printed-column scaling an extra pick may name. One shape today; a `oneOf` the day a second arrives. */
export type PickBudgetScaling = Readonly<{ type: "class-resource-growth"; id: string }>;

/** One `extraPicks` entry as it crosses the wire and as the bundle authors it. */
export type PickBudgetGrant = Readonly<{ offer: string; amount?: number | null; scaling?: PickBudgetScaling | null }>;

/**
 * The class level table, as narrowly as this needs it - structural so the server's `ClassLevelRow`
 * and the wire's `ContentClassLevelRow` both satisfy it without either package importing the other.
 */
export type PrintedResourceRow = Readonly<{ level: number; classResources: ReadonlyArray<Readonly<{ id: string; amount: number | string }>> }>;

/** A printed cell as a count. A DICE string ("3d6") is not a count of anything and reads as absent. */
const countOf = (amount: number | string | undefined): number | null =>
  typeof amount === "number" ? amount : null;

const valueAt = (table: readonly PrintedResourceRow[], level: number, id: string): number | null =>
  countOf(table.find((row) => row.level === level)?.classResources.find((resource) => resource.id === id)?.amount);

/**
 * HOW FAR a printed column has grown above its first printed value, at `level`.
 *
 * The first printed value is the one the feature's own `choose` already covers - Eldritch
 * Invocations prints 1 at level 1 and the feature offers 1 - so the grant is the GROWTH, and
 * `choose + growth` is the printed total at every level. Never negative: a column that shrinks (no
 * SRD column does) adds nothing rather than taking a pick away that the player may already have spent.
 *
 * Returns 0 when the class prints no such column, which is the same "adds nothing" a flat grant of 0
 * would mean - and the offer key itself is separately checked against the budgets the build really
 * has, so a scaling that names a column nobody prints cannot pass unnoticed.
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
