/**
 * The class mechanics overlay: hand-authored riders merged over the class records. The SRD markdown
 * contains no riders, so the mechanics are authored here and `build-class-bundle.ts` merges them into
 * every record, generated or hand-transcribed (`sources/authored/classes.json`).
 *
 * Keyed on (recordId, featureId), never featureId alone: `unarmored-defense` is both a Barbarian
 * and a Monk feature with different mechanics. A key matching no feature is a build error.
 */
import type { z } from "zod";
import type { FeatureOptionSchema, FeatureRecordSchema } from "../../src/character-content.js";

type FeatureInput = z.input<typeof FeatureRecordSchema>;
type OptionInput = z.input<typeof FeatureOptionSchema>;

/**
 * The rider keys an overlay may author, shared by the feature form and the option form. Prose (`id`,
 * `name`, `level`, `description`) belongs to the ETL and is excluded.
 */
type RiderKey =
  "tags" | "actions" | "effects" | "modifiers" | "grants" | "uses" | "extraPicks" | "replaces" | "choice" | "choices";
/** Feature-only rider keys (an option cannot carry them). */
type FeatureRiderKey = RiderKey | "extraSpellLists";

/** The rider fields an overlay may add to one pickable option inside a feature's choice. */
export type OptionMechanics = Partial<Pick<OptionInput, RiderKey | "requires" | "level">>;

/**
 * The rider fields an overlay may add to a feature. Typed off the schema's input so `.default()`ed
 * keys need not be restated; the build re-parses each finished record.
 */
export type FeatureMechanics = Partial<Pick<FeatureInput, FeatureRiderKey>> & {
  /**
   * Riders merged into the feature's inline `choice.options`, by option id. The option must already
   * exist; an id matching nothing fails the build.
   */
  options?: Readonly<Record<string, OptionMechanics>>;
};

/** Riders by record id (a class id or a subclass id), then feature id. */
export type MechanicsOverlay = Readonly<Record<string, Readonly<Record<string, FeatureMechanics>>>>;

/**
 * A feature the printed text folds into one entry but the rules grant in stages: a spells table's later rows
 * ("when you reach a Paladin level specified in the table"), a column that grows (Unarmored Movement). A whole
 * record with its own level, added beside the printed features; prose included, since no heading carries it.
 */
export type StagedFeature = FeatureInput & Readonly<{ level: number }>;

/** One spell in a subclass spells table: id, printed name, spell level. */
export type TableSpell = readonly [id: string, name: string, level: number];

/**
 * A subclass spells table's rows after the first as staged features ("Oath of Devotion Spells (Level 5)"), each
 * granting its row's spells always prepared from that class level on, as the hand-authored Life Domain does.
 */
export function spellTableStages(
  featureId: string,
  name: string,
  className: string,
  rows: ReadonlyArray<readonly [level: number, spells: readonly TableSpell[]]>
): StagedFeature[] {
  return rows.map(([level, spells]) => ({
    id: `${featureId}-${level}`,
    name: `${name} (Level ${level})`,
    level,
    description: `When you reach ${className} level ${level}, you always have the ${spells
      .map(([, spellName]) => spellName)
      .join(" and ")} spells prepared.`,
    tags: ["spellcasting"],
    grants: { spells: spells.map(([id, , spellLevel]) => ({ id, level: spellLevel, alwaysPrepared: true })) }
  }));
}

/** What one class file contributes: class features, its subclass's features, and live resource columns. */
export type ClassMechanicsModule = Readonly<{
  /** Riders keyed by this class's own feature ids. */
  features?: Readonly<Record<string, FeatureMechanics>>;
  /** Riders keyed by SUBCLASS id, then feature id. SRD 5.2.1 prints exactly one subclass per class. */
  subclasses?: Readonly<Record<string, Readonly<Record<string, FeatureMechanics>>>>;
  /** Staged class features; each joins its level's row of the class table. */
  stages?: readonly StagedFeature[];
  /** Staged subclass features, by subclass id. */
  subclassStages?: Readonly<Record<string, readonly StagedFeature[]>>;
  /**
   * Printed `classResources` columns this module wired to a live pool, so `build-class-bundle.ts`
   * drops their `display: true` and `class-resource-pools.test.ts` requires the pool.
   */
  liveResources?: readonly string[];
}>;

/** A rider list authored as empty is not authored at all - it must not trip the collision guard. */
const isAbsent = (value: unknown) => value === undefined || (Array.isArray(value) && value.length === 0);

/**
 * Merge the overlay into one record's features, in place, and return the keys that matched nothing
 * or were refused, so the caller can fail the build.
 *
 * The overlay never overwrites a value the record already carries (from the authored file or the
 * ETL's own config): a rider with two homes would silently let one of them win. A collision stops
 * the build naming both.
 */
export function applyMechanics(recordId: string, features: Array<{ id: string }>, overlay: MechanicsOverlay): string[] {
  const entries = overlay[recordId];
  if (!entries) return [];
  const byId = new Map(features.map((feature) => [feature.id, feature]));
  const unmatched: string[] = [];
  for (const [featureId, mechanics] of Object.entries(entries)) {
    const feature = byId.get(featureId) as (Record<string, unknown> & { id: string }) | undefined;
    if (!feature) {
      unmatched.push(`${recordId}.${featureId}`);
      continue;
    }
    const { options, ...riders } = mechanics;
    for (const [key, value] of Object.entries(riders)) {
      const existing = feature[key];
      if (!isAbsent(existing) && JSON.stringify(existing) !== JSON.stringify(value)) {
        unmatched.push(
          `${recordId}.${featureId}.${key} (already authored on the record - remove it from one of the two homes)`
        );
        continue;
      }
      feature[key] = value;
    }
    if (!options) continue;
    const inline =
      (feature.choice as { options?: Array<Record<string, unknown> & { id: string }> } | undefined)?.options ?? [];
    const optionsById = new Map(inline.map((option) => [option.id, option]));
    for (const [optionId, optionMechanics] of Object.entries(options)) {
      const option = optionsById.get(optionId);
      if (!option) {
        unmatched.push(`${recordId}.${featureId}.${optionId}`);
        continue;
      }
      for (const [key, value] of Object.entries(optionMechanics)) {
        const existing = option[key];
        if (!isAbsent(existing) && JSON.stringify(existing) !== JSON.stringify(value)) {
          unmatched.push(
            `${recordId}.${featureId}.${optionId}.${key} (already authored on the record - remove it from one of the two homes)`
          );
          continue;
        }
        option[key] = value;
      }
    }
  }
  return unmatched;
}
