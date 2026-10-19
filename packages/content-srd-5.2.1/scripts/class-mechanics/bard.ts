// Bard and College of Lore mechanics, merged over the ETL-generated prose.
import type { ClassMechanicsModule } from "./overlay.js";

/** The Bardic Die column: a d6, a d8 at level 5, a d10 at 10 and a d12 at 15. */
const BARDIC_DIE = [
  { level: 1, amount: "1d6" },
  { level: 5, amount: "1d8" },
  { level: 10, amount: "1d10" },
  { level: 15, amount: "1d12" }
];

export const bard: ClassMechanicsModule = {
  features: {
    /**
     * Uses scale off the Charisma modifier. The printed Bardic Die column is the die the inspired creature holds
     * (`answerAmountByLevel`), so it stays display-only and is not in `liveResources`. Cutting Words and Peerless Skill
     * spend the same pool. The hour is the GM's until the die is used; Superior Inspiration stays prose.
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
          damage: [],
          grants: {
            name: "Bardic Inspiration",
            tags: ["bardic-inspiration"],
            target: "target",
            duration: { type: "manual" },
            notSelf: true,
            onlyOne: true,
            // "Once within the next hour when the creature fails a D20 Test, the creature can roll the Bardic
            // Inspiration die and add the number rolled to the d20."
            answer: {
              rolls: ["attack", "save", "check", "death-save"],
              when: "failure",
              effect: { kind: "add", amount: "1d6" }
            }
          },
          answerAmountByLevel: BARDIC_DIE
        }
      ]
    },

    // "If you or a creature within 30 feet of you fails a saving throw against an effect that applies the Charmed or
    // Frightened condition, you can take a Reaction to cause the save to be rerolled, and the new roll has Advantage."
    countercharm: {
      actions: [
        {
          id: "countercharm",
          name: "Countercharm",
          activation: "reaction",
          description:
            "When you or a creature within 30 feet of you fails a saving throw against an effect that applies the Charmed or Frightened condition, take a Reaction to have the save rerolled with Advantage.",
          damage: [],
          answer: {
            rolls: ["save"],
            whose: "any",
            rangeFeet: 30,
            when: "failure",
            versus: { conditions: ["charmed", "frightened"] },
            effect: { kind: "reroll", advantage: true }
          }
        }
      ]
    },

    "epic-boon": {
      choice: { kind: "feat", choose: 1, fromCatalog: "feats" }
    },

    // "You now regain all your expended uses of Bardic Inspiration when you finish a Short or Long Rest."
    "font-of-inspiration": {
      modifiers: [{ type: "short-rest-regain", poolId: "bardic-inspiration" }]
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
    },

    /**
     * Not a pick of its own: the Bard's prepared spells and later replacements may come from these lists too,
     * and count as Bard spells.
     */
    "magical-secrets": { extraSpellLists: ["cleric", "druid", "wizard"] }

    // Jack of All Trades is applied by the server's check plan (`ability-checks.ts`), by its feature id.
    // Not modeled: Superior Inspiration.
  },

  subclasses: {
    "college-of-lore": {
      "bonus-proficiencies": {
        choice: { kind: "skill", choose: 3, fromCatalog: "skills" }
      },

      /**
       * A Reaction spending the class's Bardic Inspiration pool; the scaling must match the class
       * feature's. It is offered on another creature's attack roll or check that succeeds, and on its damage roll.
       */
      "cutting-words": {
        actions: [
          {
            id: "cutting-words",
            name: "Cutting Words",
            activation: "reaction",
            description:
              "When a creature you can see within 60 feet makes a damage roll or succeeds on an ability check or attack roll, take a Reaction to expend one use of your Bardic Inspiration; roll your Bardic Inspiration die and subtract the number rolled from the creature's roll, reducing the damage or potentially turning the success into a failure.",
            damage: [],
            answer: {
              rolls: ["attack", "check", "damage"],
              whose: "other",
              rangeFeet: 60,
              when: "success",
              effect: { kind: "subtract", amount: "1d6" }
            },
            answerAmountByLevel: BARDIC_DIE
          }
        ],
        uses: {
          scaling: { type: "ability-modifier", ability: "cha", minimum: 1 },
          per: "long-rest",
          pool: "bardic-inspiration"
        }
      },

      // Same pool, spent only when the roll then succeeds ("On a failure, the Bardic Inspiration isn't expended").
      "peerless-skill": {
        actions: [
          {
            id: "peerless-skill",
            name: "Peerless Skill",
            activation: "other",
            description:
              "When you make an ability check or attack roll and fail, expend one use of Bardic Inspiration; roll the Bardic Inspiration die and add the number rolled to the d20, potentially turning a failure into a success. On a failure, the Bardic Inspiration isn't expended.",
            damage: [],
            answer: {
              rolls: ["check", "attack"],
              when: "failure",
              effect: { kind: "add", amount: "1d6", keepUseOnFailure: true }
            },
            answerAmountByLevel: BARDIC_DIE
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
