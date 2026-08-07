/**
 * ============================================================================================
 * THE MECHANICS OVERLAY - hand-authored riders merged over ETL-generated prose
 * ============================================================================================
 *
 * `bundles/classes.v1.json` is GENERATED from `sources/dnd-5e-srd-markdown/classes.md` by
 * `build-class-bundle.ts`. That is where the PROSE comes from and it must stay there: the ETL is
 * what recovered 149 dropped feature descriptions, and hand-editing the bundle is destroyed by the
 * next rebuild.
 *
 * But the SRD markdown contains no riders. There is no sentence in it that says
 * `{type: "damage-resistance", damageTypes: [...]}`; the mechanics have to be authored by a human
 * reading the prose, and there is nowhere in a generated artifact to put them.
 *
 * The alternative was moving each class to `HAND_AUTHORED`, which freezes its prose too - 242
 * records' worth of description stop being derived from the source and become a hand-maintained
 * copy that the cross-check deliberately does NOT compare ("the descriptions are legitimately
 * reworded in places"). That trades a generated artifact for a manual one to gain a place to hang
 * three lines of riders.
 *
 * SO: prose is generated, mechanics are authored, and the ETL merges the two. Each class keeps ONE
 * record in the bundle, so `loadClasses`, the homebrew merge, the validator and every consumer are
 * unchanged - the overlay is a build-time input, not a runtime layer.
 *
 * THE PRECEDENT IS ALREADY IN THIS PACKAGE. `SpellListReferenceSchema` is the identical call, made
 * for the identical reason and documented in its own header: "A spell list as a membership OVERLAY,
 * never an edit to `spells.v1.json` ... Hand-editing a homebrew tag into it is destroyed by the next
 * rebuild." Only the merge point differs, and only because a spell list is a runtime concern while
 * a class's riders are fixed at build time.
 *
 * KEYED ON (recordId, featureId) AND NEVER ON featureId ALONE. A bare id is genuinely ambiguous:
 * `unarmored-defense` is a Barbarian feature AND a Monk feature with different mechanics,
 * `weapon-mastery` belongs to five classes, `spellcasting` to seven. This is the same ambiguity
 * `content-library.ts`'s `featureIndexOf` documents, and the same answer.
 *
 * A KEY THAT MATCHES NO FEATURE IS A BUILD ERROR, not a silent no-op. The whole failure mode this
 * area has been fixing is authored mechanics that vanish without a trace; an overlay that quietly
 * dropped a renamed feature's riders would be a new instance of exactly that.
 *
 * ONE FILE PER CLASS (`./barbarian.ts`, `./monk.ts`, ...), composed by `./index.ts`. A single
 * object literal holding twelve classes is one file that every content author has to edit, and
 * Stage 4 authors twelve classes in four parallel lanes. The split is the difference between four
 * agents working and four agents merging.
 */
import type { z } from "zod";
import type { FeatureOptionSchema, FeatureRecordSchema } from "../../src/character-content.js";

type FeatureInput = z.input<typeof FeatureRecordSchema>;
type OptionInput = z.input<typeof FeatureOptionSchema>;

/**
 * The rider fields an overlay may add to ONE pickable option inside a feature's choice.
 *
 * This exists because Divine Order's Thaumaturge - the record that produced the bug report this
 * whole area started from - is an inline OPTION, and an option carries the identical rider block a
 * feature does. Without it the only way to author an option's mechanics was to hand-edit the
 * bundle, which is the thing the overlay exists to stop.
 */
export type OptionMechanics = Partial<Pick<OptionInput,
  "tags" | "actions" | "effects" | "modifiers" | "grants" | "uses" | "extraPicks" | "choice">>;

/**
 * The rider fields an overlay may add to a feature. Prose (`id`, `name`, `level`, `description`) is
 * the ETL's and is never overwritten.
 *
 * Typed off the schema's INPUT rather than its output, deliberately: an overlay is authored the way
 * the JSON bundle is authored, so a `.default()`ed key like `concentration` should not have to be
 * restated. The build re-parses each finished record, which is where the defaults materialise and
 * where an authoring mistake stops the build.
 *
 * `choice` / `choices` and `options` are here because most of the pre-Stage-4 audit's 66 gaps are
 * PICKS rather than riders - nine missing Epic Boons, Primal Order, Elemental Fury, the four Mystic
 * Arcanum - and eighteen of them are riders on an inline option (the Warlock's invocations). Both
 * were previously authorable only in `build-class-bundle.ts`'s own `CONFIG.choices` map, which is a
 * shared file, or not at all.
 */
export type FeatureMechanics = Partial<Pick<FeatureInput,
  "tags" | "actions" | "effects" | "modifiers" | "grants" | "uses" | "extraPicks" | "choice">> & {
  /**
   * Riders merged into the feature's inline `choice.options`, by option id. The option must already
   * exist (the ETL parses the SRD's `#### Agonizing Blast` entries into them, or the overlay's own
   * `choice.options` created it); an id matching nothing FAILS the build like any other key.
   */
  options?: Readonly<Record<string, OptionMechanics>>;
};

/** Riders by record id (a class id or a subclass id), then feature id. */
export type MechanicsOverlay = Readonly<Record<string, Readonly<Record<string, FeatureMechanics>>>>;

/**
 * What ONE class file contributes. Class features, its subclass's features, and the printed columns
 * it wired to a real pool - because those three always change together and always belong to the
 * same author.
 */
export type ClassMechanicsModule = Readonly<{
  /** Riders keyed by this class's own feature ids. */
  features?: Readonly<Record<string, FeatureMechanics>>;
  /** Riders keyed by SUBCLASS id, then feature id. SRD 5.2.1 prints exactly one subclass per class. */
  subclasses?: Readonly<Record<string, Readonly<Record<string, FeatureMechanics>>>>;
  /**
   * Printed `classResources` columns this module wired to a live pool, so `build-class-bundle.ts`
   * drops their `display: true` and `class-resource-pools.test.ts` starts REQUIRING the pool.
   */
  liveResources?: readonly string[];
}>;

/** A rider list authored as empty is not authored at all - it must not trip the collision guard. */
const isAbsent = (value: unknown) => value === undefined || (Array.isArray(value) && value.length === 0);

/**
 * Merge the overlay into one record's features, in place, and report keys that matched nothing.
 *
 * Returns the unmatched `record.feature` (and `record.feature.option`) keys so the caller can FAIL
 * the build: a rider authored against a feature id the ETL no longer emits is precisely the silent
 * drop this file exists to avoid.
 *
 * THE OVERLAY NEVER OVERWRITES A VALUE THAT IS ALREADY THERE. For the nine generated classes that
 * can only happen for `choice`, whose other home is `CONFIG.choices` in the ETL. For the three
 * HAND_AUTHORED classes it can happen for any rider, because their features come from
 * `classes.v1.json` itself - and there the collision matters, since the ETL writes the merged record
 * back over its own input, so an overwrite would be unreviewable and un-revertable. Both cases stop
 * the build naming the two homes, rather than picking a winner silently.
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
    const { options, ...riders } = mechanics;
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
