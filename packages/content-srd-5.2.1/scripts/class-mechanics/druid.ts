// Druid and Circle of the Land mechanics, merged over the ETL-generated prose.
import type { ClassMechanicsModule } from "./overlay.js";

export const druid: ClassMechanicsModule = {
  features: {
    // Druidic plus Speak with Animals always prepared. Spotting a hidden message is a GM-called check.
    druidic: {
      grants: {
        languages: ["druidic"],
        spells: [{ id: "speak-with-animals", level: 1, alwaysPrepared: true }]
      }
    },

    /**
     * Magician raises the cantrip budget by one; Warden grants Martial weapons and Medium armor. Both
     * roles' Wisdom-modifier check bonus stays prose (`check-bonus` is a flat integer).
     */
    "primal-order": {
      choice: {
        kind: "primal-order",
        choose: 1,
        options: [
          {
            id: "magician",
            name: "Magician",
            description:
              "You know one extra cantrip from the Druid spell list. In addition, your mystical connection to nature gives you a bonus to your Intelligence (Arcana or Nature) checks. The bonus equals your Wisdom modifier (minimum bonus of +1).",
            extraPicks: [{ offer: "class-cantrips", amount: 1 }]
          },
          {
            id: "warden",
            name: "Warden",
            description:
              "Trained for battle, you gain proficiency with Martial weapons and training with Medium armor.",
            grants: { weapons: ["martial"], armor: ["medium"] }
          }
        ]
      }
    },

    /**
     * The use pool only, read off the printed column (2 -> 3 -> 4). Known Beast forms (needs a creature
     * catalog with CR and Fly Speed filters), the temporary HP, form replacement and the Short Rest
     * partial recovery stay prose.
     */
    "wild-shape": {
      uses: { scaling: { type: "class-resource", id: "wild-shape" }, per: "long-rest" },
      actions: [
        {
          id: "wild-shape",
          name: "Wild Shape",
          activation: "bonus-action",
          description:
            "Shape-shift into a Beast form you have learned for this feature. You stay in that form for a number of hours equal to half your Druid level or until you use Wild Shape again, have the Incapacitated condition, or die. You can leave the form early as a Bonus Action, and you gain Temporary Hit Points equal to your Druid level when you assume a form.",
          damage: []
        }
      ]
    },

    // Find Familiar always prepared. Casting it with a Wild Shape use instead of a slot stays prose.
    "wild-companion": {
      grants: { spells: [{ id: "find-familiar", level: 1, alwaysPrepared: true }] }
    },

    /**
     * Primal Strike's damage grows via `damageByLevel` (covering Improved Elemental Fury's damage), with a
     * once-per-turn pool. Potent Spellcasting's cantrip damage bonus stays prose.
     */
    "elemental-fury": {
      choice: {
        kind: "elemental-fury",
        choose: 1,
        options: [
          {
            id: "potent-spellcasting",
            name: "Potent Spellcasting",
            description:
              "Add your Wisdom modifier to the damage you deal with any Druid cantrip. When Improved Elemental Fury takes effect at Druid level 15, a Druid cantrip with a range of 10 feet or greater has its range increased by 300 feet."
          },
          {
            id: "primal-strike",
            name: "Primal Strike",
            description:
              "Once on each of your turns when you hit a creature with an attack roll using a weapon or a Beast form's attack in Wild Shape, you can cause the target to take an extra 1d8 Cold, Fire, Lightning, or Thunder damage (choose when you hit). The extra damage increases to 2d8 when Improved Elemental Fury takes effect at Druid level 15.",
            actions: [
              {
                id: "primal-strike",
                name: "Primal Strike",
                activation: "other",
                description:
                  "Once on each of your turns, when you hit a creature with an attack roll using a weapon or a Beast form's attack, add this damage to that hit. The printed damage is Cold, Fire, Lightning or Thunder, your choice each time; the rollable below is recorded as Lightning.",
                damage: [{ formula: "1d8", type: "lightning" }],
                damageByLevel: [
                  { level: 7, formula: "1d8", type: "lightning" },
                  { level: 15, formula: "2d8", type: "lightning" }
                ]
              }
            ],
            uses: { limit: 1, per: "turn", pool: "primal-strike" }
          }
        ]
      }
    },

    /**
     * Each option `requires` the matching level-7 pick, so the true one is adopted without a prompt.
     * Potent Spellcasting's +300 feet of cantrip range stays prose.
     */
    "improved-elemental-fury": {
      choice: {
        kind: "improved-elemental-fury",
        choose: 1,
        options: [
          {
            id: "improved-potent-spellcasting",
            name: "Improved Potent Spellcasting",
            description:
              "A Druid cantrip you cast that has a range of 10 feet or greater has its range increased by 300 feet.",
            requires: { offer: "feature:elemental-fury", id: "potent-spellcasting" }
          },
          {
            id: "improved-primal-strike",
            name: "Improved Primal Strike",
            description: "The extra damage of your Primal Strike increases to 2d8.",
            requires: { offer: "feature:elemental-fury", id: "primal-strike" }
          }
        ]
      }
    },

    "epic-boon": {
      choice: { kind: "feat", choose: 1, fromCatalog: "epic-boon-feats" }
    }

    // Not modeled: Wild Resurgence, Archdruid and Natural Recovery (resource conversion between pools)
    // and Beast Spells (a permission, not a rider).
  },

  subclasses: {
    "circle-of-the-land": {
      /**
       * Spends the shared Wild Shape pool (same scaling as Wild Shape). Damage grows 2d6 -> 3d6 -> 4d6; the
       * healing half stays prose (no healing formula on actions).
       */
      "lands-aid": {
        actions: [
          {
            id: "lands-aid",
            name: "Land's Aid",
            activation: "action",
            description:
              "As a Magic action, expend a use of your Wild Shape and choose a point within 60 feet. Each creature of your choice in a 10-foot-radius Sphere centered there makes a Constitution saving throw, taking the damage below on a failure and half as much on a success. One creature of your choice in that area regains the same amount in Hit Points. The damage and healing increase at Druid levels 10 and 14.",
            save: { ability: "con", dc: "spellcasting" },
            damage: [{ formula: "2d6", type: "necrotic" }],
            damageByLevel: [
              { level: 3, formula: "2d6", type: "necrotic" },
              { level: 10, formula: "3d6", type: "necrotic" },
              { level: 14, formula: "4d6", type: "necrotic" }
            ]
          }
        ],
        uses: { scaling: { type: "class-resource", id: "wild-shape" }, per: "long-rest", pool: "wild-shape" }
      },

      /**
       * "Choose one type of land": four inline options carrying only their names, read back by Nature's
       * Ward. Each land's tiered spell set stays prose (`grants.spells` has no character-level gate, and
       * the overlay cannot split the feature into staged records).
       */
      "circle-of-the-land-spells": {
        // Re-chosen on every Long Rest: the override lives in `actor.choiceOverrides` and the next Long Rest clears it.
        replaces: [{ offer: "feature:circle-of-the-land-spells", when: "long-rest", amount: 1 }],
        choice: {
          kind: "land",
          choose: 1,
          options: [
            {
              id: "arid",
              name: "Arid Land",
              description: "Blur, Burning Hands, Fire Bolt, Blight, Fireball, Wall of Fire."
            },
            {
              id: "polar",
              name: "Polar Land",
              description: "Fog Cloud, Hold Person, Ray of Frost, Sleet Storm, Slow, Ice Storm."
            },
            {
              id: "temperate",
              name: "Temperate Land",
              description: "Misty Step, Shocking Grasp, Lightning Bolt, Sleet Storm, Freedom of Movement, Ice Storm."
            },
            {
              id: "tropical",
              name: "Tropical Land",
              description: "Acid Splash, Ray of Sickness, Web, Stinking Cloud, Polymorph, Insect Plague."
            }
          ]
        }
      },

      /**
       * Poisoned immunity plus the resistance for the current land (Arid/Fire, Polar/Cold,
       * Temperate/Lightning, Tropical/Poison). Each option `requires` one land answer, so the matching one
       * is adopted without a prompt.
       */
      "natures-ward": {
        grants: { conditionImmunities: ["poisoned"] },
        choice: {
          kind: "natures-ward",
          choose: 1,
          options: [
            {
              id: "natures-ward-arid",
              name: "Nature's Ward (Arid)",
              description: "Your current land choice is Arid, so you have Resistance to Fire damage.",
              requires: { offer: "feature:circle-of-the-land-spells", id: "arid" },
              grants: { damageResistances: ["fire"] }
            },
            {
              id: "natures-ward-polar",
              name: "Nature's Ward (Polar)",
              description: "Your current land choice is Polar, so you have Resistance to Cold damage.",
              requires: { offer: "feature:circle-of-the-land-spells", id: "polar" },
              grants: { damageResistances: ["cold"] }
            },
            {
              id: "natures-ward-temperate",
              name: "Nature's Ward (Temperate)",
              description: "Your current land choice is Temperate, so you have Resistance to Lightning damage.",
              requires: { offer: "feature:circle-of-the-land-spells", id: "temperate" },
              grants: { damageResistances: ["lightning"] }
            },
            {
              id: "natures-ward-tropical",
              name: "Nature's Ward (Tropical)",
              description: "Your current land choice is Tropical, so you have Resistance to Poison damage.",
              requires: { offer: "feature:circle-of-the-land-spells", id: "tropical" },
              grants: { damageResistances: ["poison"] }
            }
          ]
        }
      },

      // Spends the shared Wild Shape pool. The Cube, cover, movement and sharing Nature's Ward's resistance stay prose.
      "natures-sanctuary": {
        actions: [
          {
            id: "natures-sanctuary",
            name: "Nature's Sanctuary",
            activation: "action",
            description:
              "As a Magic action, expend a use of your Wild Shape to make spectral trees and vines appear in a 15-foot Cube on the ground within 120 feet of yourself. They last 1 minute or until you have the Incapacitated condition or die. You and your allies have Half Cover while in that area, and your allies gain the current Resistance of your Nature's Ward there. As a Bonus Action you can move the Cube up to 60 feet to ground within 120 feet of yourself.",
            damage: []
          }
        ],
        uses: { scaling: { type: "class-resource", id: "wild-shape" }, per: "long-rest", pool: "wild-shape" }
      }
    }
  },

  liveResources: ["wild-shape"]
};
