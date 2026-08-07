/**
 * Warlock mechanics - the GENERATED half of the overlay for this class and for Fiend Patron.
 *
 * `build-class-bundle.ts` generates this class's prose from the SRD markdown on every run;
 * this overlay is merged on top of it.
 *
 * Stage 4 lane B4. Author here and nowhere else: this file is the only place a Warlock
 * rider, pick, or option mechanic belongs, so two authors working on two classes never touch one
 * file. See `./overlay.ts` for what a `FeatureMechanics` may carry and `./index.ts` for the merge.
 */
import type { ClassMechanicsModule } from "./overlay.js";

export const warlock: ClassMechanicsModule = {
  features: {
    /**
     * ELDRITCH INVOCATIONS, as many as the printed column says.
     *
     * "You gain more invocations of your choice at higher Warlock levels, as shown in the
     * Invocations column of the Warlock Features table." The column runs 1 -> 10 (L1 1, L2 3, L5 5,
     * L7 6, L9 7, L12 8, L15 9, L18 10), and a level-20 Warlock was offered ONE.
     *
     * Repeat grants cannot say this twice over: the column steps by +2 at levels 2 and 5, a level
     * row may list a feature only once, and the SRD prints NO feature heading at L2/L5/L7/L9/L12/
     * L15/L18 to carry a grant at all. `class-resource-growth` needs no carrier - the feature
     * granted at level 1 reads the column at the character's own level, and `choose: 1` plus the
     * growth is the printed number at every one of the twenty rows.
     */
    "eldritch-invocations": {
      extraPicks: [{ offer: "feature:eldritch-invocations", scaling: { type: "class-resource-growth", id: "eldritch-invocations" } }]
    }
  },
  subclasses: { "fiend-patron": {} }
};
