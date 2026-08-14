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
 * `clears` - THE REPLACEMENT VERB, ruled 2026-08-10. For the three HAND_AUTHORED classes the bundle
 * is this script's input AND its output, so the merge is additive-only and a SECOND edit to a rider
 * that already shipped was unauthorable from the class module - the only home left was a hand edit
 * to a 10,000-line JSON file, which is the shared-file workflow the overlay exists to end. `clears`
 * names the keys a feature supersedes; they are deleted from the record before the merge, so the
 * module can say "this feature's `choice` is superseded - the list below replaces it."
 *
 * ITS HAZARD IS REAL AND IS THE REASON FOR THE THREE MITIGATIONS BELOW: on a hand-authored record
 * the ETL writes the merged record back over its own input, so a `clears` is a ONE-WAY edit to
 * committed JSON. Deleting the `clears` line later does not bring the old value back.
 *
 *   1. IDEMPOTENT. Clearing an absent key is a no-op, never an error - so the second and later builds
 *      are clean and the module stays truthful instead of becoming a build error the moment it works.
 *   2. NEVER DELETE-ONLY, per KEY rather than per entry. Every key a `clears` names must be
 *      replaced by the same entry or the build fails, so the verb can never be used to quietly
 *      remove content. Per entry would be the weaker promise it sounds like: authoring any
 *      unrelated rider would then license deleting a whole `choice` and replacing nothing.
 *      "Replaced" means the key itself, or the other form of it for `choice`/`choices` - see
 *      `isReplaced`, which is what keeps the one-becomes-several case authorable.
 *   3. THE REVIEW BAR IS THE `git diff` OF `bundles/classes.v1.json` IN THE SAME COMMIT. That is
 *      stated here because the collision guard's whole argument was that an overwrite would be
 *      "unreviewable and un-revertable" (see `applyMechanics` below); `clears` makes the overwrite
 *      authorable, so the review has to be the thing that makes it reviewable again.
 *
 * The rejected alternatives are costed in `docs/product/plan-content-program.md` §4 and the ruling is
 * `docs/ai-ledger/decision-log.md` (2026-08-10). `clears` is deliberately NOT on `OptionMechanics`:
 * no measured case needs it, and an option-level delete inside a `choice` this same entry may be
 * replacing wholesale is a shape nobody has had to author yet.
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
 * Classes whose records are hand-authored and carried through the ETL verbatim, so `classes.v1.json`
 * is simultaneously that script's input and its output.
 *
 * It lives HERE rather than in `build-class-bundle.ts` because it is a property of the overlay's
 * merge, not of the parse: these three are the records the merge may only ADD to, and the three for
 * which a `clears` is a one-way edit to committed JSON. One home, read by the script and by the test
 * that holds the merge to it - a second hand-maintained copy of this list is exactly the defect the
 * content/engine agreement test exists to catch.
 */
export const HAND_AUTHORED: ReadonlySet<string> = new Set(["fighter", "wizard", "cleric"]);

/**
 * The rider keys an overlay may author - the one list, so the feature form, the option form and
 * `clears` can never drift apart. Prose (`id`, `name`, `level`, `description`) is the ETL's and is
 * not in it, which is what stops `clears` from being able to name a description.
 */
type RiderKey = "tags" | "actions" | "effects" | "modifiers" | "grants" | "uses" | "extraPicks" | "replaces" | "choice" | "choices";

/**
 * The rider fields an overlay may add to ONE pickable option inside a feature's choice.
 *
 * This exists because Divine Order's Thaumaturge - the record that produced the bug report this
 * whole area started from - is an inline OPTION, and an option carries the identical rider block a
 * feature does. Without it the only way to author an option's mechanics was to hand-edit the
 * bundle, which is the thing the overlay exists to stop.
 */
export type OptionMechanics = Partial<Pick<OptionInput, RiderKey>>;

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
export type FeatureMechanics = Partial<Pick<FeatureInput, RiderKey>> & {
  /**
   * Riders merged into the feature's inline `choice.options`, by option id. The option must already
   * exist (the ETL parses the SRD's `#### Agonizing Blast` entries into them, or the overlay's own
   * `choice.options` created it); an id matching nothing FAILS the build like any other key.
   */
  options?: Readonly<Record<string, OptionMechanics>>;
  /**
   * Keys this feature SUPERSEDES: deleted from the record before the merge, so the riders authored
   * beside them land where the collision guard would otherwise stop the build. See the header for
   * the ruling and its three mitigations; the two that are code are enforced in `applyMechanics`.
   *
   * Only ever needed on a HAND_AUTHORED record, whose old value is in `classes.v1.json` rather than
   * regenerated each run - and there it is a ONE-WAY edit to that file. Review the bundle's `git
   * diff` in the same commit.
   */
  clears?: readonly RiderKey[];
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
 * Which riders count as REPLACING a superseded key, for mitigation 2's per-key test.
 *
 * Almost every key replaces only itself. `choice` and `choices` are the exception because they are
 * two shapes of one concern and cannot coexist on a record (`oneChoiceForm`): a feature whose single
 * choice becomes several MUST clear one form and author the other, which is the measured case the
 * verb was built for. Requiring the identical key back would forbid exactly that.
 */
const CHOICE_FORMS = ["choice", "choices"] as const;
const isReplaced = (riders: Record<string, unknown>, key: string): boolean =>
  ((CHOICE_FORMS as readonly string[]).includes(key) ? CHOICE_FORMS : [key]).some((form) => !isAbsent(riders[form]));

/**
 * Merge the overlay into one record's features, in place, and report keys that matched nothing.
 *
 * Returns the unmatched `record.feature` (and `record.feature.option`) keys so the caller can FAIL
 * the build: a rider authored against a feature id the ETL no longer emits is precisely the silent
 * drop this file exists to avoid.
 *
 * THE OVERLAY NEVER OVERWRITES A VALUE THAT IS ALREADY THERE - UNLESS THE FEATURE SAYS `clears`. For
 * the nine generated classes a collision can only happen for `choice`, whose other home is
 * `CONFIG.choices` in the ETL. For the three HAND_AUTHORED classes it can happen for any rider,
 * because their features come from `classes.v1.json` itself - and there the collision matters, since
 * the ETL writes the merged record back over its own input, so an unannounced overwrite would be
 * unreviewable and un-revertable. Both cases stop the build naming the two homes, rather than picking
 * a winner silently.
 *
 * `clears` is how a module ANNOUNCES one: the named keys are deleted first, so the merge that follows
 * is an add like any other and the collision message's own advice ("remove it from one of the two
 * homes") becomes expressible in the module instead of requiring a hand edit to the bundle. Two of
 * its three mitigations are enforced right here - clearing an absent key is a NO-OP so the second
 * build is clean, and a `clears` with no rider beside it is a build error so the verb can never
 * delete alone. The third is the review bar: read the bundle's `git diff` in the same commit.
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
      // MITIGATION 2 - never a delete-only tool, and the test is PER CLEARED KEY. Asking only that
      // the entry author SOME rider is a weaker guarantee than the one this mitigation is written to
      // give: `{ clears: ["choice"], tags: [...] }` satisfies it, deletes the whole `choice`, and
      // replaces nothing - on a hand-authored record that is precisely the irreversible unreplaced
      // delete the verb is fenced against. Each key a feature supersedes must be re-authored by the
      // same entry. A rider authored as `[]` is "not authored at all" (see `isAbsent`), so it does
      // not license a delete either.
      //
      // Nothing is deleted on this path: the build exits on any miss, but an invalid entry
      // contributes NOTHING rather than half of itself, because the thing it half-does is one-way.
      const unreplaced = clears.filter((key) => !isReplaced(riders as Record<string, unknown>, key));
      if (unreplaced.length > 0) {
        unmatched.push(`${recordId}.${featureId}.clears [${unreplaced.join(", ")}] (deletes without replacing - author the superseding ${unreplaced.length === 1 ? "rider" : "riders"} in the same entry)`);
        continue;
      }
      // MITIGATION 1 - idempotent. `delete` on an absent key is a no-op, which is what makes the
      // SECOND build of a hand-authored record clean: run 1 removes the superseded key from
      // `classes.v1.json`, run 2 reads the file run 1 wrote and finds nothing left to remove.
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
