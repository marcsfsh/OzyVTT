/**
 * The class mechanics overlay, composed from one file per class. `./overlay.ts` holds the vocabulary
 * and the merge. The whole overlay is a build-time input to `build-class-bundle.ts`.
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

export { HAND_AUTHORED, applyMechanics } from "./overlay.js";
export type { ClassMechanicsModule, FeatureMechanics, MechanicsOverlay, OptionMechanics } from "./overlay.js";

/** The twelve SRD 5.2.1 classes. A missing key here is a compile error, not a silent absence. */
export type ClassId =
  | "barbarian" | "bard" | "cleric" | "druid" | "fighter" | "monk"
  | "paladin" | "ranger" | "rogue" | "sorcerer" | "warlock" | "wizard";

const MODULES: Readonly<Record<ClassId, ClassMechanicsModule>> = {
  barbarian, bard, cleric, druid, fighter, monk, paladin, ranger, rogue, sorcerer, warlock, wizard
};

const modules = Object.entries(MODULES) as Array<[ClassId, ClassMechanicsModule]>;

/** Mechanics by class id, then feature id. Classes with no riders are omitted rather than mapped to `{}`. */
export const CLASS_MECHANICS: MechanicsOverlay = Object.freeze(Object.fromEntries(
  modules
    .map(([id, module]) => [id, module.features ?? {}] as const)
    .filter(([, features]) => Object.keys(features).length > 0)
));

/**
 * The same overlay for subclass features, keyed on (subclassId, featureId). Keyed on the subclass id
 * because that is the record the riders land on; the class file still owns them.
 */
export const SUBCLASS_MECHANICS: MechanicsOverlay = Object.freeze(Object.fromEntries(
  modules
    .flatMap(([, module]) => Object.entries(module.subclasses ?? {}))
    .filter(([, features]) => Object.keys(features).length > 0)
));

/**
 * Printed columns that stop being display-only because the overlay wired them to a real pool. Listed
 * explicitly so `class-resource-pools.test.ts` can check both directions.
 */
export const LIVE_CLASS_RESOURCES: Readonly<Record<string, readonly string[]>> = Object.freeze(Object.fromEntries(
  modules
    .map(([id, module]) => [id, module.liveResources ?? []] as const)
    .filter(([, resources]) => resources.length > 0)
));
