/**
 * Wizard and Evoker mechanics. Wizard is hand-transcribed in `sources/authored/classes.json`; riders
 * already there are not restated here.
 */
import type { ClassMechanicsModule } from "./overlay.js";

export const wizard: ClassMechanicsModule = {
  features: {
    // "Whenever you finish a Long Rest, you can replace one of your cantrips": made in the Level flow until a rest
    // offers it.
    spellcasting: { replaces: [{ offer: "class-cantrips", when: "level-up", amount: 1 }] },
    /**
     * Two free level-3 castings back on a Short Rest (a Long Rest clears every pool too). One counter,
     * so the per-spell split is not enforced; the description carries it. The spell `choice` is already
     * on the record.
     */
    "signature-spells": { uses: { limit: 2, per: "short-rest" } },

    /**
     * "Choose a level 1 and a level 2 spell": two blocks with exact level windows. "In your spellbook"
     * and "casting time of an action" are not expressible (no spellbook model, no casting-time filter).
     */
    "spell-mastery": {
      choices: [
        // Both blocks need a floor: `wizard-spells` includes cantrips, and the server checks only min/max.
        { kind: "spell", choose: 1, fromCatalog: "wizard-spells", minSpellLevel: 1, maxSpellLevel: 1 },
        { kind: "spell", choose: 1, fromCatalog: "wizard-spells", minSpellLevel: 2, maxSpellLevel: 2 }
      ]
    }
    // Not modeled: Spellcasting and Ritual Adept (no spellbook or ritual model), Arcane Recovery's slot
    // refund (no slot-restoring rider; its counter is on the record), Memorize Spell (rest-timed
    // replacement). Scholar, subclass, ASI and Epic Boon choices are already on the record.
  },
  subclasses: {
    evoker: {}
    // Not modeled: Evocation Savant's school filter, Potent Cantrip (no half-on-save field), Sculpt
    // Spells, Empowered Evocation (no "same type as the spell" damage, and `spellSchool` has no
    // producer), and Overchannel's max-damage and backlash (its counter is on the record).
  }
};
