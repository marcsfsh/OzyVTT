/**
 * THE MECHANICS OVERLAY, composed from one file per class.
 *
 * `./overlay.ts` holds the vocabulary and the merge; each `./<class>.ts` holds one class's riders,
 * its subclass's riders, and the printed columns it made live. This file is the only place that
 * knows all twelve exist, and it is what `build-class-bundle.ts` imports - so the ETL's inputs are
 * exactly what they were before the split, and its behaviour is unchanged.
 *
 * WHY PER-CLASS FILES. Stage 4 authors 226 mechanical records across twelve classes in four
 * parallel lanes. One object literal holding all twelve is one file every author edits, which makes
 * every commit a merge conflict; twelve files with an index that composes them is the same data
 * with no shared line. Nothing here is a runtime layer - the whole overlay is a build-time input.
 *
 * ADDING A CLASS: write the file, import it, add it to `MODULES`. The `Record<ClassId, ...>` type
 * makes a forgotten class a compile error rather than a class that silently authors nothing.
 */
import type { ClassMechanicsModule, MechanicsOverlay } from "./overlay.js";
import { barbarian } from "./barbarian.js";
import { bard } from "./bard.js";
import { cleric } from "./cleric.js";
import { druid } from "./druid.js";
import { fighter } from "./fighter.js";
import { monk } from "./monk.js";
import { paladin } from "./paladin.js";
import { ranger } from "./ranger.js";
import { rogue } from "./rogue.js";
import { sorcerer } from "./sorcerer.js";
import { warlock } from "./warlock.js";
import { wizard } from "./wizard.js";

export { applyMechanics } from "./overlay.js";
export type { ClassMechanicsModule, FeatureMechanics, MechanicsOverlay, OptionMechanics } from "./overlay.js";

/** The twelve SRD 5.2.1 classes. A missing key here is a compile error, not a silent absence. */
export type ClassId =
  | "barbarian" | "bard" | "cleric" | "druid" | "fighter" | "monk"
  | "paladin" | "ranger" | "rogue" | "sorcerer" | "warlock" | "wizard";

const MODULES: Readonly<Record<ClassId, ClassMechanicsModule>> = {
  barbarian, bard, cleric, druid, fighter, monk, paladin, ranger, rogue, sorcerer, warlock, wizard
};

const modules = Object.entries(MODULES) as Array<[ClassId, ClassMechanicsModule]>;

/**
 * Mechanics by class id, then feature id.
 *
 * A class contributing no riders is omitted entirely rather than mapped to `{}`, so
 * `CLASS_MECHANICS[id]` still short-circuits in `applyMechanics` exactly as it did before the split.
 */
export const CLASS_MECHANICS: MechanicsOverlay = Object.freeze(Object.fromEntries(
  modules
    .map(([id, module]) => [id, module.features ?? {}] as const)
    .filter(([, features]) => Object.keys(features).length > 0)
));

/**
 * The same overlay for subclass features, keyed on (subclassId, featureId) - merged by the ETL's
 * subclass loop exactly as the class half is merged by its class loop.
 *
 * Keyed on the SUBCLASS id, not the class id, because that is the record the riders land on and
 * because a class may one day print more than one (SRD 5.2.1 prints exactly one each). The class
 * file still owns them: Draconic Sorcery's riders live in `sorcerer.ts`, beside the Sorcerer's own.
 */
export const SUBCLASS_MECHANICS: MechanicsOverlay = Object.freeze(Object.fromEntries(
  modules
    .flatMap(([, module]) => Object.entries(module.subclasses ?? {}))
    .filter(([, features]) => Object.keys(features).length > 0)
));

/**
 * Printed columns that STOP being display-only because the overlay wired them to a real pool.
 *
 * `build-class-bundle.ts` marks every generated `classResources` column `display: true`, which is
 * true right up until an overlay names it in a `class-resource` scaling. Listing it rather than
 * inferring it keeps `class-resource-pools.test.ts`'s two-way check meaningful: the content says
 * which columns it believes are live, and the test proves a pool actually answers to each one.
 */
export const LIVE_CLASS_RESOURCES: Readonly<Record<string, readonly string[]>> = Object.freeze(Object.fromEntries(
  modules
    .map(([id, module]) => [id, module.liveResources ?? []] as const)
    .filter(([, resources]) => resources.length > 0)
));
