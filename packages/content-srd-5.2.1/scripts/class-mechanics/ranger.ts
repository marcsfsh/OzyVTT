// Ranger and Hunter mechanics, merged over the ETL-generated prose.
import type { ClassMechanicsModule } from "./overlay.js";

export const ranger: ClassMechanicsModule = {
  features: {
    /**
     * Hunter's Mark always prepared (not counted against the prepared budget), with free casts read off
     * the printed Favored Enemy column (2 rising to 6).
     */
    // "Whenever you finish a Long Rest, you can change the kinds of weapons you chose": made in the Level flow until a
    // rest offers it.
    // "Whenever you finish a Long Rest, you can change the kinds of weapons you chose": both, in the rest's step.
    "weapon-mastery": { replaces: [{ offer: "feature:weapon-mastery", when: "long-rest", amount: 2 }] },
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

    // "You have Advantage on attack rolls against the creature currently marked by your Hunter's Mark."
    "precise-hunter": {
      modifiers: [
        {
          type: "roll-mode",
          roll: "attack",
          mode: "advantage",
          when: [{ type: "on-attack-roll" }, { type: "versus-marked", tags: ["hunters-mark"] }]
        }
      ]
    },
    // Foe Slayer's d10 is the Hunter's Mark the Ranger casts (resolution/grant-extras.ts).

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

    // "Giving yourself the Invisible condition until the end of your next turn."
    "natures-veil": {
      uses: { scaling: { type: "ability-modifier", ability: "wis", minimum: 1 }, per: "long-rest" },
      actions: [
        {
          id: "natures-veil",
          name: "Nature's Veil",
          activation: "bonus-action",
          description:
            "You invoke spirits of nature to magically hide yourself, giving yourself the Invisible condition until the end of your next turn.",
          damage: [],
          grants: {
            name: "Nature's Veil",
            tags: ["natures-veil"],
            duration: { type: "until-source-turn-end" },
            modifiers: [],
            onEnd: [],
            target: "self",
            voidWhileIncapacitated: false,
            concentration: false,
            conditions: ["invisible"]
          }
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
            choice: { kind: "cantrip", choose: 2, fromCatalog: "druid-spells", maxSpellLevel: 0 },
            replaces: [{ offer: "feature:druidic-warrior", when: "level-up", amount: 1 }]
          }
        ]
      }
    }
  },
  subclasses: {
    hunter: {
      /**
       * Colossus Slayer's 1d8 lands once a turn on a weapon hit against a creature missing hit points. Horde Breaker's
       * extra attack must target a different creature, which stays prose. "Whenever you finish a Short or Long Rest,
       * you can replace the chosen option with the other one."
       */
      "hunters-prey": {
        replaces: [{ offer: "feature:hunters-prey", when: "short-rest", amount: 1 }],
        choice: {
          kind: "hunters-prey",
          choose: 1,
          options: [
            {
              id: "colossus-slayer",
              name: "Colossus Slayer",
              description:
                "Your tenacity can wear down even the most resilient foes. When you hit a creature with a weapon, the weapon deals an extra 1d8 damage to the target if it's missing any of its Hit Points. You can deal this extra damage only once per turn.",
              modifiers: [
                {
                  type: "extra-damage",
                  formula: "1d8",
                  oncePerTurn: true,
                  when: [{ type: "on-hit" }, { type: "attack-kind-is", kinds: ["weapon"] }, { type: "versus-hurt" }]
                }
              ]
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

      /**
       * Taken once the Ranger's damage has landed on its marked creature this turn: the mark's extra damage (1d6 Force,
       * 1d10 from Foe Slayer at Ranger 20) to one other creature it can see within 30 feet of the marked one, once per
       * turn (`resolution/action-targets.ts`).
       */
      "superior-hunters-prey": {
        actions: [
          {
            id: "superior-hunters-prey",
            name: "Superior Hunter's Prey",
            activation: "other",
            description:
              "Once per turn when you deal damage to a creature marked by your Hunter's Mark, deal that spell's extra damage to a different creature you can see within 30 feet of the first creature.",
            damage: [{ formula: "1d6", type: "force" }],
            damageByLevel: [
              { level: 11, formula: "1d6", type: "force" },
              { level: 20, formula: "1d10", type: "force" }
            ],
            uses: { limit: 1, per: "turn", pool: "superior-hunters-prey" },
            targets: { count: 1, seen: true, who: "others", nearMark: { tag: "hunters-mark", feet: 30 } }
          }
        ]
      },

      // Escape the Horde's Disadvantage is read on every Opportunity Attack against the Ranger. Multiattack
      // Defense is marked on the Ranger by the engine after a hit (`resolution/struck.ts`).
      // "Whenever you finish a Short or Long Rest, you can replace the chosen option with the other one."
      "defensive-tactics": {
        replaces: [{ offer: "feature:defensive-tactics", when: "short-rest", amount: 1 }],
        choice: {
          kind: "defensive-tactics",
          choose: 1,
          options: [
            {
              id: "escape-the-horde",
              name: "Escape the Horde",
              description: "Opportunity Attacks have Disadvantage against you.",
              modifiers: [
                {
                  type: "roll-mode",
                  roll: "incoming-attack",
                  mode: "disadvantage",
                  when: [{ type: "on-attack-roll" }, { type: "attack-kind-is", kinds: ["opportunity"] }]
                }
              ]
            },
            {
              id: "multiattack-defense",
              name: "Multiattack Defense",
              description:
                "When a creature hits you with an attack roll, that creature has Disadvantage on all other attack rolls against you this turn."
            }
          ]
        }
      },
      // Offered on damage the Ranger is about to take; using it resists the damage's largest type until the turn ends.
      "superior-hunters-defense": {
        actions: [
          {
            id: "superior-hunters-defense",
            name: "Superior Hunter's Defense",
            activation: "reaction",
            description:
              "When you take damage, take a Reaction to give yourself Resistance to that damage and any other damage of the same type until the end of the current turn.",
            damage: [],
            reaction: { trigger: "takes-damage", response: "resist-type" }
          }
        ]
      }
    }
  },
  liveResources: ["favored-enemy"]
};
