/**
 * Wizard and Evoker mechanics. Wizard is HAND_AUTHORED, so this overlay may only add to the record
 * in `classes.v1.json`, except Spell Mastery, which supersedes the record's `choice` via `clears`.
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
     * "Choose a level 1 and a level 2 spell": two blocks with exact level windows, replacing the
     * record's single choose-2 pick. "In your spellbook" and "casting time of an action" are not
     * expressible (no spellbook model, no casting-time filter).
     */
    "spell-mastery": {
      // `choices` is cleared too: the bundle is this ETL's input, so after the first run the record already
      // carries `choices`, and changing the authored value would otherwise collide. Re-authoring an identical
      // value is a no-op.
      clears: ["choice", "choices"],
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
