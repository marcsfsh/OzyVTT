/**
 * The class mechanics overlay: hand-authored riders merged over ETL-generated prose.
 * `bundles/classes.v1.json` is generated from the SRD markdown, which contains no riders, so the
 * mechanics are authored here and `build-class-bundle.ts` merges them at build time.
 *
 * Keyed on (recordId, featureId), never featureId alone: `unarmored-defense` is both a Barbarian
 * and a Monk feature with different mechanics. A key matching no feature is a build error.
 *
 * `clears` names keys a feature supersedes; they are deleted before the merge. For the
 * HAND_AUTHORED classes the bundle is both input and output, so a `clears` is a one-way edit to
 * committed JSON. Safeguards:
 *
 *   1. Idempotent: clearing an absent key is a no-op, so later builds stay clean.
 *   2. Never delete-only: each cleared key must be replaced by the same entry (`choice` and
 *      `choices` count as replacing each other; see `isReplaced`).
 *   3. Review the `git diff` of `bundles/classes.v1.json` in the same commit.
 *
 * `clears` is not available on `OptionMechanics`.
 */
import type { z } from "zod";
import type { FeatureOptionSchema, FeatureRecordSchema } from "../../src/character-content.js";

type FeatureInput = z.input<typeof FeatureRecordSchema>;
type OptionInput = z.input<typeof FeatureOptionSchema>;

/**
 * Classes whose records are hand-authored and carried through the ETL verbatim, so `classes.v1.json`
 * is both that script's input and its output. The merge may only add to these.
 */
export const HAND_AUTHORED: ReadonlySet<string> = new Set(["fighter", "wizard", "cleric"]);

/**
 * The rider keys an overlay may author, shared by the feature form, the option form and `clears`.
 * Prose (`id`, `name`, `level`, `description`) belongs to the ETL and is excluded.
 */
type RiderKey = "tags" | "actions" | "effects" | "modifiers" | "grants" | "uses" | "extraPicks" | "replaces" | "choice" | "choices";

/** The rider fields an overlay may add to one pickable option inside a feature's choice. */
export type OptionMechanics = Partial<Pick<OptionInput, RiderKey>>;

/**
 * The rider fields an overlay may add to a feature. Typed off the schema's input so `.default()`ed
 * keys need not be restated; the build re-parses each finished record.
 */
export type FeatureMechanics = Partial<Pick<FeatureInput, RiderKey>> & {
  /**
   * Riders merged into the feature's inline `choice.options`, by option id. The option must already
   * exist; an id matching nothing fails the build.
   */
  options?: Readonly<Record<string, OptionMechanics>>;
  /**
   * Keys this feature supersedes: deleted from the record before the merge. See the header; on a
   * HAND_AUTHORED record this is a one-way edit to `classes.v1.json`.
   */
  clears?: readonly RiderKey[];
};

/** Riders by record id (a class id or a subclass id), then feature id. */
export type MechanicsOverlay = Readonly<Record<string, Readonly<Record<string, FeatureMechanics>>>>;

/** What one class file contributes: class features, its subclass's features, and live resource columns. */
export type ClassMechanicsModule = Readonly<{
  /** Riders keyed by this class's own feature ids. */
  features?: Readonly<Record<string, FeatureMechanics>>;
  /** Riders keyed by SUBCLASS id, then feature id. SRD 5.2.1 prints exactly one subclass per class. */
  subclasses?: Readonly<Record<string, Readonly<Record<string, FeatureMechanics>>>>;
  /**
   * Printed `classResources` columns this module wired to a live pool, so `build-class-bundle.ts`
   * drops their `display: true` and `class-resource-pools.test.ts` requires the pool.
   */
  liveResources?: readonly string[];
}>;

/** A rider list authored as empty is not authored at all - it must not trip the collision guard. */
const isAbsent = (value: unknown) => value === undefined || (Array.isArray(value) && value.length === 0);

/**
 * Whether the entry replaces a cleared key. `choice` and `choices` cannot coexist on a record
 * (`oneChoiceForm`), so either form replaces the other.
 */
const CHOICE_FORMS = ["choice", "choices"] as const;
const isReplaced = (riders: Record<string, unknown>, key: string): boolean =>
  ((CHOICE_FORMS as readonly string[]).includes(key) ? CHOICE_FORMS : [key]).some((form) => !isAbsent(riders[form]));

/**
 * Merge the overlay into one record's features, in place, and return the keys that matched nothing
 * or were refused, so the caller can fail the build.
 *
 * The overlay never overwrites a value already on the record unless the feature `clears` it: for
 * HAND_AUTHORED classes the ETL writes the merged record back over its own input, so a silent
 * overwrite would be unreviewable. A collision stops the build naming both homes.
 */
export function applyMechanics(
  recordId: string,
  features: Array<{ id: string }>,
  overlay: MechanicsOverlay
): string[] {
  const entries = overlay[recordId];
  if (!entries) return [];
  const byId = new Map(features.map((feature) => [feature.id, feature]));
  const unmatched: string[] = [];
  for (const [featureId, mechanics] of Object.entries(entries)) {
    const feature = byId.get(featureId) as (Record<string, unknown> & { id: string }) | undefined;
    if (!feature) { unmatched.push(`${recordId}.${featureId}`); continue; }
    const { options, clears, ...riders } = mechanics;
    if (clears?.length) {
      // Every cleared key must be re-authored by the same entry (an `[]` rider does not count). On a miss
      // the entry contributes nothing, because the delete would be one-way.
      const unreplaced = clears.filter((key) => !isReplaced(riders as Record<string, unknown>, key));
      if (unreplaced.length > 0) {
        unmatched.push(`${recordId}.${featureId}.clears [${unreplaced.join(", ")}] (deletes without replacing - author the superseding ${unreplaced.length === 1 ? "rider" : "riders"} in the same entry)`);
        continue;
      }
      // Deleting an absent key is a no-op, so the second build of a hand-authored record is clean.
      for (const key of clears) delete feature[key];
    }
    for (const [key, value] of Object.entries(riders)) {
      const existing = feature[key];
      if (!isAbsent(existing) && JSON.stringify(existing) !== JSON.stringify(value)) {
        unmatched.push(`${recordId}.${featureId}.${key} (already authored on the record - remove it from one of the two homes)`);
        continue;
      }
      feature[key] = value;
    }
    if (!options) continue;
    const inline = (feature.choice as { options?: Array<Record<string, unknown> & { id: string }> } | undefined)?.options ?? [];
    const optionsById = new Map(inline.map((option) => [option.id, option]));
    for (const [optionId, optionMechanics] of Object.entries(options)) {
      const option = optionsById.get(optionId);
      if (!option) { unmatched.push(`${recordId}.${featureId}.${optionId}`); continue; }
      for (const [key, value] of Object.entries(optionMechanics)) {
        const existing = option[key];
        if (!isAbsent(existing) && JSON.stringify(existing) !== JSON.stringify(value)) {
          unmatched.push(`${recordId}.${featureId}.${optionId}.${key} (already authored on the record - remove it from one of the two homes)`);
          continue;
        }
        option[key] = value;
      }
    }
  }
  return unmatched;
}
