/**
 * Fighter mechanics - the HAND_AUTHORED half of the overlay for this class and for Champion.
 *
 * `classes.v1.json` carries this class's PROSE (the ETL copies the record through
 * verbatim); this overlay is merged on top of it and may only ADD.
 *
 * Stage 4 lane B1. Author here and nowhere else: this file is the only place a Fighter
 * rider, pick, or option mechanic belongs, so two authors working on two classes never touch one
 * file. See `./overlay.ts` for what a `FeatureMechanics` may carry and `./index.ts` for the merge.
 */
import type { ClassMechanicsModule } from "./overlay.js";

export const fighter: ClassMechanicsModule = {
  features: {
    /**
     * WEAPON MASTERY, as many as the printed column says: 3 -> 4 (L4) -> 5 (L10) -> 6 (L16).
     *
     * Fighter is HAND_AUTHORED and that did not save it - the gap was in the vocabulary, not in who
     * typed the record. This is also the proof that the overlay now reaches the hand-authored three:
     * `classes.v1.json` carries the prose and the `choose: 3`, and this line carries the growth.
     */
    "weapon-mastery": {
      extraPicks: [{ offer: "feature:weapon-mastery", scaling: { type: "class-resource-growth", id: "weapon-mastery" } }]
    }
  },
  subclasses: { "champion": {} }
};
