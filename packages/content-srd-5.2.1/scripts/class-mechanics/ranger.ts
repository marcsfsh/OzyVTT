// Ranger and Hunter mechanics, merged over the ETL-generated prose.
import type { ClassMechanicsModule } from "./overlay.js";

export const ranger: ClassMechanicsModule = {
  features: {
    /**
     * Hunter's Mark always prepared (not counted against the prepared budget), with free casts read off
     * the printed Favored Enemy column (2 rising to 6).
     */
    "favored-enemy": {
      uses: { scaling: { type: "class-resource", id: "favored-enemy" }, per: "long-rest" },
      grants: { spells: [{ id: "hunters-mark", level: 1, alwaysPrepared: true, withoutSlot: "free" }] }
    },

    // Expertise in one skill plus two languages (raising the `species-languages` budget).
    "deft-explorer": {
      choice: { kind: "expertise", choose: 1, fromCatalog: "skills" },
      extraPicks: [{ offer: "species-languages", amount: 2 }]
    },

    "extra-attack": {
      modifiers: [{ type: "extra-attack", count: 1 }]
    },

    /**
     * "Speed increases by 10 feet while you aren't wearing Heavy armor": the +10 is in the sheet's Speed, and a live
     * -10 takes it back while Heavy armor is worn, so sheets built with the +10 stay right. The Climb and Swim
     * Speeds equal to Speed are read from this feature by the movement rules (`specialSpeedsOf`).
     */
    roving: {
      modifiers: [
        { type: "speed", amount: 10 },
        { type: "speed", amount: -10, when: [{ type: "while-armored", weights: ["heavy"] }] }
      ]
    },

    // Uses equal the Wisdom modifier (minimum 1). The Exhaustion decrease on a Short Rest is the rest's (rests.ts).
    tireless: {
      uses: { scaling: { type: "ability-modifier", ability: "wis", minimum: 1 }, per: "long-rest" },
      actions: [
        {
          id: "tireless",
          name: "Tireless",
          activation: "action",
          description:
            "As a Magic action, you give yourself Temporary Hit Points equal to 1d8 plus your Wisdom modifier (minimum of 1). Whenever you finish a Short Rest, your Exhaustion level, if any, also decreases by 1.",
          damage: [],
          healing: { formula: "1d8", self: true, temporary: true },
          adds: { abilityModifier: "wis" }
        }
      ]
    },

    // The activation and counter only; effects cannot apply the Invisible condition.
    "natures-veil": {
      uses: { scaling: { type: "ability-modifier", ability: "wis", minimum: 1 }, per: "long-rest" },
      actions: [
        {
          id: "natures-veil",
          name: "Nature's Veil",
          activation: "bonus-action",
          description:
            "You invoke spirits of nature to magically hide yourself, giving yourself the Invisible condition until the end of your next turn.",
          damage: []
        }
      ]
    },

    // Display-only: senses are not modeled on `ActorDefinition` yet.
    "feral-senses": {
      modifiers: [{ type: "sense", sense: "blindsight", feet: 30 }]
    },

    "epic-boon": {
      choice: { kind: "feat", choose: 1, fromCatalog: "feats" }
    },

    /**
     * The Fighting Style feat catalog plus the inline Druidic Warrior option. Its replace-a-cantrip
     * clause stays prose.
     */
    "fighting-style": {
      choice: {
        kind: "fighting-style",
        choose: 1,
        fromCatalog: "fighting-style-feats",
        options: [
          {
            id: "druidic-warrior",
            name: "Druidic Warrior",
            description:
              "You learn two Druid cantrips of your choice. Wisdom is your spellcasting ability for them. Whenever you gain a Ranger level, you can replace one of these cantrips with another Druid cantrip.",
            choice: { kind: "cantrip", choose: 2, fromCatalog: "druid-spells", maxSpellLevel: 0 }
          }
        ]
      }
    }
  },
  subclasses: {
    hunter: {
      /**
       * A pick with prose-only options. Colossus Slayer needs a gate on the target's HP and once-per-turn
       * on a modifier; Horde Breaker's extra attack must target a different creature. Replacing the
       * choice on a rest stays prose.
       */
      "hunters-prey": {
        choice: {
          kind: "hunters-prey",
          choose: 1,
          options: [
            {
              id: "colossus-slayer",
              name: "Colossus Slayer",
              description:
                "Your tenacity can wear down even the most resilient foes. When you hit a creature with a weapon, the weapon deals an extra 1d8 damage to the target if it's missing any of its Hit Points. You can deal this extra damage only once per turn."
            },
            {
              id: "horde-breaker",
              name: "Horde Breaker",
              description:
                "Once on each of your turns when you make an attack with a weapon, you can make another attack with the same weapon against a different creature that is within 5 feet of the original target, that is within the weapon's range, and that you haven't attacked this turn."
            }
          ]
        }
      },

      // A pick with prose-only options: both act on the attacker's rolls, and opportunity-attack triggers
      // are never announced by the resolver.
      "defensive-tactics": {
        choice: {
          kind: "defensive-tactics",
          choose: 1,
          options: [
            {
              id: "escape-the-horde",
              name: "Escape the Horde",
              description: "Opportunity Attacks have Disadvantage against you."
            },
            {
              id: "multiattack-defense",
              name: "Multiattack Defense",
              description:
                "When a creature hits you with an attack roll, that creature has Disadvantage on all other attack rolls against you this turn."
            }
          ]
        }
      }
    }
  },
  liveResources: ["favored-enemy"]
};
