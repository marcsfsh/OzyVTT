// Druid and Circle of the Land mechanics, merged over the ETL-generated prose.
import { potentSpellcasting, type ClassMechanicsModule, type TableSpell } from "./overlay.js";

/** The SRD Druid cantrips that deal damage, which Potent Spellcasting adds to. */
const DRUID_DAMAGE_CANTRIPS = ["poison-spray", "produce-flame", "starry-wisp"];

/** The Circle of the Land table: each land's spells by Druid level (3, 5, 7, 9). */
const LANDS: ReadonlyArray<{
  id: string;
  name: string;
  tiers: ReadonlyArray<readonly [number, readonly TableSpell[]]>;
}> = [
  {
    id: "arid",
    name: "Arid",
    tiers: [
      [
        3,
        [
          ["blur", "Blur", 2],
          ["burning-hands", "Burning Hands", 1],
          ["fire-bolt", "Fire Bolt", 0]
        ]
      ],
      [5, [["fireball", "Fireball", 3]]],
      [7, [["blight", "Blight", 4]]],
      [9, [["wall-of-stone", "Wall of Stone", 5]]]
    ]
  },
  {
    id: "polar",
    name: "Polar",
    tiers: [
      [
        3,
        [
          ["fog-cloud", "Fog Cloud", 1],
          ["hold-person", "Hold Person", 2],
          ["ray-of-frost", "Ray of Frost", 0]
        ]
      ],
      [5, [["sleet-storm", "Sleet Storm", 3]]],
      [7, [["ice-storm", "Ice Storm", 4]]],
      [9, [["cone-of-cold", "Cone of Cold", 5]]]
    ]
  },
  {
    id: "temperate",
    name: "Temperate",
    tiers: [
      [
        3,
        [
          ["misty-step", "Misty Step", 2],
          ["shocking-grasp", "Shocking Grasp", 0],
          ["sleep", "Sleep", 1]
        ]
      ],
      [5, [["lightning-bolt", "Lightning Bolt", 3]]],
      [7, [["freedom-of-movement", "Freedom of Movement", 4]]],
      [9, [["tree-stride", "Tree Stride", 5]]]
    ]
  },
  {
    id: "tropical",
    name: "Tropical",
    tiers: [
      [
        3,
        [
          ["acid-splash", "Acid Splash", 0],
          ["ray-of-sickness", "Ray of Sickness", 1],
          ["web", "Web", 2]
        ]
      ],
      [5, [["stinking-cloud", "Stinking Cloud", 3]]],
      [7, [["polymorph", "Polymorph", 4]]],
      [9, [["insect-plague", "Insect Plague", 5]]]
    ]
  }
];

export const druid: ClassMechanicsModule = {
  features: {
    // "Whenever you gain a Druid level, you can replace one of your cantrips."
    spellcasting: { replaces: [{ offer: "class-cantrips", when: "level-up", amount: 1 }] },
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
     * The use pool, read off the printed column (2 -> 3 -> 4), one use of which comes back on a Short Rest, and the
     * Temporary Hit Points equal to the Druid level. Known Beast forms (needs a creature catalog with CR and Fly Speed
     * filters) and the form replacement stay prose.
     */
    "wild-shape": {
      uses: { scaling: { type: "class-resource", id: "wild-shape" }, per: "long-rest" },
      modifiers: [{ type: "short-rest-regain", poolId: "wild-shape", amount: 1 }],
      actions: [
        {
          id: "wild-shape",
          name: "Wild Shape",
          activation: "bonus-action",
          description:
            "Shape-shift into a Beast form you have learned for this feature. You stay in that form for a number of hours equal to half your Druid level or until you use Wild Shape again, have the Incapacitated condition, or die. You can leave the form early as a Bonus Action, and you gain Temporary Hit Points equal to your Druid level when you assume a form.",
          damage: [],
          healing: { formula: "0", self: true, temporary: true },
          adds: { classLevel: 1 }
        }
      ]
    },

    // Find Familiar always prepared, and cast with a slot or a use of Wild Shape (the shared pool).
    "wild-companion": {
      uses: { scaling: { type: "class-resource", id: "wild-shape" }, per: "long-rest", pool: "wild-shape" },
      grants: { spells: [{ id: "find-familiar", level: 1, alwaysPrepared: true, withoutSlot: "free" }] }
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
              "Add your Wisdom modifier to the damage you deal with any Druid cantrip. When Improved Elemental Fury takes effect at Druid level 15, a Druid cantrip with a range of 10 feet or greater has its range increased by 300 feet.",
            modifiers: [potentSpellcasting(DRUID_DAMAGE_CANTRIPS)]
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
                  "Once on each of your turns, when you hit a creature with an attack roll using a weapon or a Beast form's attack, add this damage to that hit: Cold, Fire, Lightning or Thunder, your choice each time. Add it when you confirm the hit.",
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
     * Improved Potent Spellcasting's +300 feet of cantrip range is the server's (`potentRangeFeet`).
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
      choice: { kind: "feat", choose: 1, fromCatalog: "feats" }
    }

    // Not modeled: Wild Resurgence, Archdruid and Natural Recovery (resource conversion between pools)
    // and Beast Spells (a permission, not a rider).
  },

  // "You have the spells listed for your Druid level and lower prepared": each later row is a staged feature
  // whose one legal option is the chosen land's, adopted without a pick.
  subclassStages: {
    "circle-of-the-land": [5, 7, 9].map((level, row) => ({
      id: `circle-of-the-land-spells-${level}`,
      name: `Circle of the Land Spells (Level ${level})`,
      level,
      description: `When you reach Druid level ${level}, you always have your land's level ${level} spell prepared: ${LANDS.map(
        (land) => `${land.name}, ${land.tiers[row + 1][1].map(([, name]) => name).join(", ")}`
      ).join("; ")}.`,
      tags: ["spellcasting"],
      choice: {
        kind: `land-spells-${level}`,
        choose: 1,
        options: LANDS.map((land) => ({
          id: `${land.id}-${level}`,
          name: `${land.name} Land (Level ${level})`,
          description: `${land.tiers[row + 1][1].map(([, name]) => name).join(", ")}, always prepared.`,
          requires: { offer: "feature:circle-of-the-land-spells", id: land.id },
          grants: {
            spells: land.tiers[row + 1][1].map(([id, , spellLevel]) => ({
              id,
              level: spellLevel,
              alwaysPrepared: true
            }))
          }
        }))
      }
    }))
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
            area: { shape: "sphere", sizeFeet: 10, widthFeet: null },
            description:
              "As a Magic action, expend a use of your Wild Shape and choose a point within 60 feet. Each creature of your choice in a 10-foot-radius Sphere centered there makes a Constitution saving throw, taking the damage below on a failure and half as much on a success. One creature of your choice in that area regains the same amount in Hit Points. The damage and healing increase at Druid levels 10 and 14.",
            save: { ability: "con", dc: "spellcasting", successDamage: "half", failureConditions: [] },
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
       * "Choose one type of land": four inline options, each granting that land's level-3 spells always
       * prepared; the table's later rows are staged features (`subclassStages`), which read this answer back,
       * as Nature's Ward does.
       */
      "circle-of-the-land-spells": {
        // Re-chosen after each Long Rest: the new land replaces the ledger answer and the sheet is rebuilt, so the
        // land's spells and Nature's Ward follow it.
        replaces: [{ offer: "feature:circle-of-the-land-spells", when: "long-rest", amount: 1 }],
        choice: {
          kind: "land",
          choose: 1,
          options: LANDS.map((land) => ({
            id: land.id,
            name: `${land.name} Land`,
            description: `${land.tiers.map(([level, spells]) => `Level ${level}: ${spells.map(([, name]) => name).join(", ")}`).join(". ")}.`,
            grants: { spells: land.tiers[0][1].map(([id, , level]) => ({ id, level, alwaysPrepared: true })) }
          }))
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
            area: { shape: "cube", sizeFeet: 15, widthFeet: null },
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
