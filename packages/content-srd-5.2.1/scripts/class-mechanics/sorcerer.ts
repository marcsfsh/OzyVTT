/**
 * Sorcerer mechanics - the GENERATED half of the overlay for this class and for Draconic Sorcery.
 *
 * `build-class-bundle.ts` generates this class's prose from the SRD markdown on every run;
 * this overlay is merged on top of it.
 *
 * Stage 4 lane B4. Author here and nowhere else: this file is the only place a Sorcerer
 * rider, pick, or option mechanic belongs, so two authors working on two classes never touch one
 * file. See `./overlay.ts` for what a `FeatureMechanics` may carry and `./index.ts` for the merge.
 */
import type { ClassMechanicsModule } from "./overlay.js";

export const sorcerer: ClassMechanicsModule = {
  features: {},
  subclasses: {
    "draconic-sorcery": {
      /**
       * "While you aren't wearing armor, your base Armor Class equals 10 plus your Dexterity and
       * Charisma modifiers" - the `unarmored-defense` variant, spelled with the ability the SRD prints.
       *
       * This is also the worked example that proves the SUBCLASS half of the overlay reaches the
       * bundle: Draconic Sorcery is ETL-generated, so before the ETL imported `SUBCLASS_MECHANICS`
       * there was no way for this rider to exist at all.
       *
       * WHAT STAYS PROSE, deliberately (ADR-0008): the Hit Point half ("+3, and +1 whenever you gain
       * another Sorcerer level") is a level-3 lump plus a per-level step, and `hit-points-per-level`
       * has no lump. Authoring `amount: 1` would be wrong for every level below 3 and short by 2
       * above it, so the description carries it instead of the record carrying it incorrectly.
       */
      "draconic-resilience": {
        modifiers: [{ type: "unarmored-defense", ability: "cha" }]
      }
    }
  }
};
