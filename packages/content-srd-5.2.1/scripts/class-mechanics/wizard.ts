/**
 * Wizard and Evoker mechanics. Wizard is hand-transcribed in `sources/authored/classes.json`; riders
 * already there are not restated here.
 */
import type { ClassMechanicsModule } from "./overlay.js";

export const wizard: ClassMechanicsModule = {
  features: {
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
    evoker: {
      // "Whenever you cast a Wizard spell from the Evocation school, you can add your Intelligence modifier to one
      // damage roll of that spell", of the spell's own type.
      "empowered-evocation": {
        modifiers: [
          {
            type: "extra-damage",
            abilityModifier: "int",
            when: [
              { type: "on-damage-roll" },
              { type: "spell-school-is", schools: ["evocation"] },
              { type: "spell-class-is", classIds: ["wizard"] }
            ]
          }
        ]
      }
      // Potent Cantrip is effective-actions.ts's: a Wizard cantrip that misses or is saved against deals half.
    }
    // Not modeled: Evocation Savant's school filter, Sculpt Spells, and Overchannel's max-damage and backlash (its
    // counter is on the record).
  }
};
