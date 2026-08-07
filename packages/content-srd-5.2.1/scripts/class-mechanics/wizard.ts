/**
 * Wizard mechanics - the HAND_AUTHORED half of the overlay for this class and for Evoker.
 *
 * `classes.v1.json` carries this class's PROSE (the ETL copies the record through
 * verbatim); this overlay is merged on top of it and may only ADD.
 *
 * Stage 4 lane B4. Author here and nowhere else: this file is the only place a Wizard
 * rider, pick, or option mechanic belongs, so two authors working on two classes never touch one
 * file. See `./overlay.ts` for what a `FeatureMechanics` may carry and `./index.ts` for the merge.
 */
import type { ClassMechanicsModule } from "./overlay.js";

export const wizard: ClassMechanicsModule = {
  features: {},
  subclasses: { "evoker": {} }
};
