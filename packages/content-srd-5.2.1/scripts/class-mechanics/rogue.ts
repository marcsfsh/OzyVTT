/**
 * Rogue mechanics - the GENERATED half of the overlay for this class and for Thief.
 *
 * `build-class-bundle.ts` generates this class's prose from the SRD markdown on every run;
 * this overlay is merged on top of it.
 *
 * Stage 4 lane B2. Author here and nowhere else: this file is the only place a Rogue
 * rider, pick, or option mechanic belongs, so two authors working on two classes never touch one
 * file. See `./overlay.ts` for what a `FeatureMechanics` may carry and `./index.ts` for the merge.
 */
import type { ClassMechanicsModule } from "./overlay.js";

export const rogue: ClassMechanicsModule = {
  features: {},
  subclasses: { "thief": {} }
};
