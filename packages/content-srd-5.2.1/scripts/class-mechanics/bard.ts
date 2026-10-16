// Bard and College of Lore mechanics, merged over the ETL-generated prose.
import type { ClassMechanicsModule } from "./overlay.js";

export const bard: ClassMechanicsModule = {
  features: {
    /**
     * Uses scale off the Charisma modifier, not the printed Bardic Die column (that is the die size, so
     * it stays display-only and is not in `liveResources`). Cutting Words and Peerless Skill spend the
     * same pool. The die granted to another creature, Font of Inspiration and Superior Inspiration stay
     * prose.
     */
    "bardic-inspiration": {
      tags: ["bardic-inspiration"],
      uses: { scaling: { type: "ability-modifier", ability: "cha", minimum: 1 }, per: "long-rest" },
      actions: [
        {
          id: "bardic-inspiration",
          name: "Bardic Inspiration",
          activation: "bonus-action",
          description:
            "As a Bonus Action, inspire another creature within 60 feet of yourself who can see or hear you. That creature gains one of your Bardic Inspiration dice, which it can roll and add to a failed D20 Test once within the next hour. A creature can have only one Bardic Inspiration die at a time. The die is a d6, becoming a d8 at level 5, a d10 at level 10 and a d12 at level 15.",
          damage: []
        }
      ]
    },

    "epic-boon": {
      choice: { kind: "feat", choose: 1, fromCatalog: "feats" }
    },

    /**
     * Both spells always prepared and not counted against the prepared total. Targeting a second
     * creature is a spell change and stays prose.
     */
    "words-of-creation": {
      grants: {
        spells: [
          { id: "power-word-heal", level: 9, alwaysPrepared: true },
          { id: "power-word-kill", level: 9, alwaysPrepared: true }
        ]
      }
    }

    // Not modeled: Magical Secrets (its generated `choice` is wrong, and nothing widens an existing
    // budget's spell list), Jack of All Trades (half proficiency), Font of Inspiration, Superior
    // Inspiration and Countercharm.
  },

  subclasses: {
    "college-of-lore": {
      "bonus-proficiencies": {
        choice: { kind: "skill", choose: 3, fromCatalog: "skills" }
      },

      /**
       * A Reaction spending the class's Bardic Inspiration pool; the scaling must match the class
       * feature's. Subtracting the die from another creature's roll stays prose.
       */
      "cutting-words": {
        actions: [
          {
            id: "cutting-words",
            name: "Cutting Words",
            activation: "reaction",
            description:
              "When a creature you can see within 60 feet makes a damage roll or succeeds on an ability check or attack roll, take a Reaction to expend one use of your Bardic Inspiration; roll your Bardic Inspiration die and subtract the number rolled from the creature's roll, reducing the damage or potentially turning the success into a failure.",
            damage: []
          }
        ],
        uses: {
          scaling: { type: "ability-modifier", ability: "cha", minimum: 1 },
          per: "long-rest",
          pool: "bardic-inspiration"
        }
      },

      // Same pool. The refund on a failure is not expressible, so the die is spent and the text says when it returns.
      "peerless-skill": {
        actions: [
          {
            id: "peerless-skill",
            name: "Peerless Skill",
            activation: "other",
            description:
              "When you make an ability check or attack roll and fail, expend one use of Bardic Inspiration; roll the Bardic Inspiration die and add the number rolled to the d20, potentially turning a failure into a success. On a failure, the Bardic Inspiration isn't expended.",
            damage: []
          }
        ],
        uses: {
          scaling: { type: "ability-modifier", ability: "cha", minimum: 1 },
          per: "long-rest",
          pool: "bardic-inspiration"
        }
      },

      /**
       * "Choose two spells from any combination of the Cleric, Druid, and Wizard spell lists", via the
       * `-or-` union slug. Picks outside the class budget do not count against the prepared total.
       */
      "magical-discoveries": {
        choice: { kind: "spell", choose: 2, fromCatalog: "cleric-spells-or-druid-spells-or-wizard-spells" }
      }
    }
  }
};
