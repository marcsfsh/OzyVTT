/**
 * Cleric and Life Domain mechanics. Cleric is HAND_AUTHORED, so this overlay may only add to the
 * record in `classes.v1.json`; riders already there (Divine Order, Blessed Strikes, Channel
 * Divinity, the domain spell tiers) are not restated.
 */
import type { ClassMechanicsModule } from "./overlay.js";

export const cleric: ClassMechanicsModule = {
  features: {
    "divine-order": {
      options: {
        /**
         * "You know one extra cantrip from the Cleric spell list." The Arcana/Religion bonus (Wisdom
         * modifier, minimum +1) stays prose: `check-bonus` takes a flat integer.
         */
        thaumaturge: { extraPicks: [{ offer: "class-cantrips", amount: 1 }] }
      }
    },

    /**
     * Gives the existing pool the SRD's Magic action activation (a synthesised action would be "other").
     * Choosing the spell happens at use time, so it is not a build-time `choice`; Greater Divine
     * Intervention's 2d4 Long Rest recharge is prose.
     */
    "divine-intervention": {
      actions: [{
        id: "divine-intervention",
        name: "Divine Intervention",
        activation: "action",
        description: "As a Magic action, choose any Cleric spell of level 5 or lower that doesn't require a Reaction to cast. As part of the same action, you cast that spell without expending a spell slot or needing Material components. At level 20 you can choose Wish instead, and if you do you can't use Divine Intervention again until you finish 2d4 Long Rests.",
        damage: []
      }]
    },

    /**
     * "The option you chose for Blessed Strikes grows more powerful." Each option `requires` the
     * matching level-7 pick, so exactly one survives and is adopted without a prompt. Divine Strike's
     * 2d8 is already on the record via `damageByLevel`; Potent Spellcasting's temporary HP stay prose.
     */
    "improved-blessed-strikes": {
      choice: {
        kind: "improved-blessed-strikes",
        choose: 1,
        options: [
          {
            id: "improved-divine-strike",
            name: "Improved Divine Strike",
            description: "The extra damage of your Divine Strike increases to 2d8.",
            requires: { offer: "feature:blessed-strikes", id: "divine-strike" }
          },
          {
            id: "improved-potent-spellcasting",
            name: "Improved Potent Spellcasting",
            description: "When you cast a Cleric cantrip and deal damage to a creature with it, you can give vitality to yourself or another creature within 60 feet of yourself, granting a number of Temporary Hit Points equal to twice your Wisdom modifier.",
            requires: { offer: "feature:blessed-strikes", id: "potent-spellcasting" }
          }
        ]
      }
    }

    // Not modeled: Sear Undead (ability-scaled dice count) and Life Domain's healing riders (no healing
    // rider vocabulary).
  },
  subclasses: { "life-domain": {} }
};
