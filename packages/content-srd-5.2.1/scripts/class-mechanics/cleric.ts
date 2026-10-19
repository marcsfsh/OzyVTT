/**
 * Cleric and Life Domain mechanics. Cleric is hand-transcribed in `sources/authored/classes.json`;
 * riders already there (Divine Order, Blessed Strikes, Channel Divinity, the domain spell tiers) are
 * not restated here.
 */
import { potentSpellcasting, wisdomOnChecks, type ClassMechanicsModule } from "./overlay.js";

export const cleric: ClassMechanicsModule = {
  features: {
    // "You regain one of its expended uses when you finish a Short Rest, and you regain all expended uses when you
    // finish a Long Rest."
    "channel-divinity": {
      modifiers: [{ type: "short-rest-regain", poolId: "channel-divinity", amount: 1 }]
    },

    "divine-order": {
      options: {
        /**
         * "You know one extra cantrip from the Cleric spell list" and "a bonus to your Intelligence (Arcana or
         * Religion) checks. The bonus equals your Wisdom modifier (minimum of +1)."
         */
        thaumaturge: {
          extraPicks: [{ offer: "class-cantrips", amount: 1 }],
          modifiers: [wisdomOnChecks(["arcana", "religion"])]
        }
      }
    },

    // Sacred Flame is the SRD's one Cleric cantrip that deals damage.
    "blessed-strikes": {
      options: { "potent-spellcasting": { modifiers: [potentSpellcasting(["sacred-flame"])] } }
    },

    /**
     * Gives the existing pool the SRD's Magic action activation (a synthesised action would be "other").
     * Choosing the spell happens at use time, so it is not a build-time `choice`; Greater Divine
     * Intervention's 2d4 Long Rest recharge is prose.
     */
    "divine-intervention": {
      actions: [
        {
          id: "divine-intervention",
          name: "Divine Intervention",
          activation: "action",
          description:
            "As a Magic action, choose any Cleric spell of level 5 or lower that doesn't require a Reaction to cast. As part of the same action, you cast that spell without expending a spell slot or needing Material components. At level 20 you can choose Wish instead, and if you do you can't use Divine Intervention again until you finish 2d4 Long Rests.",
          damage: []
        }
      ]
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
            description:
              "When you cast a Cleric cantrip and deal damage to a creature with it, you can give vitality to yourself or another creature within 60 feet of yourself, granting a number of Temporary Hit Points equal to twice your Wisdom modifier.",
            requires: { offer: "feature:blessed-strikes", id: "potent-spellcasting" }
          }
        ]
      }
    }

    // Not modeled: Sear Undead (ability-scaled dice count).
  },
  subclasses: {
    "life-domain": {
      // "When a spell you cast with a spell slot restores Hit Points to a creature, that creature regains additional
      // Hit Points ... equal 2 plus the spell slot's level."
      "disciple-of-life": {
        modifiers: [{ type: "healing-bonus", amount: 2, perSlotLevel: true, when: [{ type: "on-healing" }] }]
      },
      // "Immediately after you cast a spell with a spell slot that restores Hit Points to one or more creatures other
      // than yourself, you regain Hit Points equal to 2 plus the spell slot's level."
      "blessed-healer": {
        modifiers: [
          { type: "healing-bonus", amount: 2, perSlotLevel: true, self: true, when: [{ type: "on-healing" }] }
        ]
      },
      // "Instead use the highest number possible for each die" of a spell's or Channel Divinity's healing; an item's
      // healing rolls as usual.
      "supreme-healing": {
        modifiers: [{ type: "healing-dice-maximized", when: [{ type: "on-healing" }] }]
      }
    }
  }
};
