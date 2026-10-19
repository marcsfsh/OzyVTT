/**
 * Wizard and Evoker mechanics. Wizard is hand-transcribed in `sources/authored/classes.json`; riders
 * already there are not restated here.
 */
import type { ClassMechanicsModule } from "./overlay.js";

export const wizard: ClassMechanicsModule = {
  features: {
    // "Whenever you finish a Long Rest, you can replace one of your cantrips from this feature with another Wizard
    // cantrip of your choice": one swap in the step a Long Rest opens.
    spellcasting: { replaces: [{ offer: "class-cantrips", when: "long-rest", amount: 1 }] },
    // Signature Spells' two level 3 spellbook spells (the pick is on the record) are each cast once free a Short
    // Rest, each on its own counter (the build's `PICKED_SPELL_CASTS`).

    /**
     * "Choose a level 1 and a level 2 spell": two blocks with exact level windows, cast at will with no slot (the
     * build's `PICKED_SPELL_CASTS`). "In your spellbook" isn't checked: a sheet's ledger needn't list its spellbook.
     */
    "spell-mastery": {
      choices: [
        // Both blocks need a floor: `wizard-spells` includes cantrips, and the server checks only min/max.
        { kind: "spell", choose: 1, fromCatalog: "wizard-spells", minSpellLevel: 1, maxSpellLevel: 1 },
        { kind: "spell", choose: 1, fromCatalog: "wizard-spells", minSpellLevel: 2, maxSpellLevel: 2 }
      ]
    }
    // Arcane Recovery's slots are recovered by the server's conversions, and Memorize Spell opens a one-change prepare
    // step after a Short Rest (`rests.ts`). Scholar, subclass, ASI and Epic Boon choices are already on the record.
  },
  subclasses: {
    evoker: {}
    // Not modeled: Evocation Savant's school filter, Potent Cantrip (no half-on-save field), Sculpt
    // Spells, Empowered Evocation (no "same type as the spell" damage, and `spellSchool` has no
    // producer), and Overchannel's max-damage and backlash (its counter is on the record).
  }
};
