/**
 * Cleric mechanics - the HAND_AUTHORED half of the overlay for this class and for Life Domain.
 *
 * `classes.v1.json` carries this class's PROSE (the ETL copies the record through
 * verbatim); this overlay is merged on top of it and may only ADD.
 *
 * Stage 4 lane B3. Author here and nowhere else: this file is the only place a Cleric
 * rider, pick, or option mechanic belongs, so two authors working on two classes never touch one
 * file. See `./overlay.ts` for what a `FeatureMechanics` may carry and `./index.ts` for the merge.
 */
import type { ClassMechanicsModule } from "./overlay.js";

export const cleric: ClassMechanicsModule = {
  features: {
    "divine-order": {
      options: {
        /**
         * "You know one extra cantrip from the Cleric spell list."
         *
         * THE RECORD THAT STARTED THIS AREA. A Cleric who chose Thaumaturge was still capped at
         * three cantrips, because the wizard read the offer's capacity solely off the printed level
         * row. `extraPicks` is the vocabulary that lets a feature reach that number, and `offer` is
         * the offer key both sides already share verbatim.
         *
         * It lived in `classes.v1.json` as a hand edit until the overlay learned to reach an inline
         * OPTION - which is the one shape `FeatureMechanics` could not express, and the reason
         * Cleric's fix had to be hand-edited into a generated artifact in the first place.
         *
         * WHAT STAYS PROSE: the Arcana/Religion bonus ("equals your Wisdom modifier, minimum +1") is
         * an ability-derived check bonus with a floor, and `check-bonus` takes a flat integer.
         */
        thaumaturge: { extraPicks: [{ offer: "class-cantrips", amount: 1 }] }
      }
    }
  },
  subclasses: { "life-domain": {} }
};
