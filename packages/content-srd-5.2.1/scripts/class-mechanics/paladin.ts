/**
 * Paladin mechanics - the GENERATED half of the overlay for this class and for Oath of Devotion.
 *
 * `build-class-bundle.ts` generates this class's prose from the SRD markdown on every run;
 * this overlay is merged on top of it.
 *
 * Stage 4 lane B2. Author here and nowhere else: this file is the only place a Paladin
 * rider, pick, or option mechanic belongs, so two authors working on two classes never touch one
 * file. See `./overlay.ts` for what a `FeatureMechanics` may carry and `./index.ts` for the merge.
 */
import type { ClassMechanicsModule } from "./overlay.js";

export const paladin: ClassMechanicsModule = {
  features: {
    /**
     * FIGHTING STYLE - the whole Fighting Style feat catalog **plus** one bespoke option.
     *
     * "Instead of choosing one of those feats, you can choose the option below." Both consumers used
     * to short-circuit on a non-empty `from` (which `options` derives), so a catalog and an inline
     * option could not be offered together and Blessed Warrior was simply unpickable. They are UNIONED
     * now, and this is the record that proves it.
     *
     * WHAT STAYS PROSE (ADR-0008): "whenever you gain a Paladin level, you can replace one of these
     * cantrips" is a REPLACEMENT clause, and nothing in the vocabulary edits a choice already made -
     * see the Stage-4 authoring assignments for the specification.
     */
    "fighting-style": {
      choice: {
        kind: "fighting-style", choose: 1, fromCatalog: "fighting-style-feats",
        options: [{
          id: "blessed-warrior",
          name: "Blessed Warrior",
          description: "You learn two Cleric cantrips of your choice. Charisma is your spellcasting ability for them. Whenever you gain a Paladin level, you can replace one of these cantrips with another Cleric cantrip.",
          choice: { kind: "cantrip", choose: 2, fromCatalog: "cleric-spells", maxSpellLevel: 0 }
        }]
      }
    }
  },
  subclasses: { "oath-of-devotion": {} }
};
