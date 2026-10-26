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
     * "Choose a level 1 and a level 2 spell in your spellbook that have a casting time of an action": two blocks with
     * exact level windows, cast at will with no slot (the build's `PICKED_SPELL_CASTS`), each checked against the
     * spellbook as it is picked. "Whenever you finish a Long Rest, you can replace one of those spells with an eligible
     * spell of the same level from your spellbook": one swap across both in the step a Long Rest opens.
     */
    "spell-mastery": {
      replaces: [{ offer: "feature:spell-mastery", when: "long-rest", amount: 1 }],
      choices: [
        // Both blocks need a floor: `wizard-spells` includes cantrips, and the server checks only min/max.
        {
          kind: "spell",
          choose: 1,
          fromCatalog: "wizard-spells",
          minSpellLevel: 1,
          maxSpellLevel: 1,
          castingTime: "action",
          fromSpellbook: true
        },
        {
          kind: "spell",
          choose: 1,
          fromCatalog: "wizard-spells",
          minSpellLevel: 2,
          maxSpellLevel: 2,
          castingTime: "action",
          fromSpellbook: true
        }
      ]
    }
    // Arcane Recovery's slots are recovered by the server's conversions, and Memorize Spell opens a one-change prepare
    // step after a Short Rest (`rests.ts`). Scholar, subclass, ASI and Epic Boon choices are already on the record.
  },
  subclasses: {
    evoker: {
      // "Whenever you cast a Wizard spell from the Evocation school, you can add your Intelligence modifier to one
      // damage roll of that spell": the modifier in the spell's own damage type, on each resolve of a Wizard Evocation
      // spell. Once for a spell of several rolls isn't checked.
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
    }
    // The server applies the rest: Potent Cantrip (`resolution/damage.ts`), Evocation Savant's later free spells
    // (`spell-choices.ts`), Sculpt Spells (`resolution/metamagic.ts`) and Overchannel (`resolution/overchannel.ts`).
  }
};
