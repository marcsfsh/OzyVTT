// Paladin and Oath of Devotion mechanics, merged over the ETL-generated prose.
import type { Condition } from "@vtt/schemas";
import { spellTableStages, type ClassMechanicsModule } from "./overlay.js";

/** SRD Aura of Protection: the aura "is inactive while you have the Incapacitated condition" (or one including it). */
const AURA_ACTIVE = {
  type: "while-condition" as const,
  conditionIds: ["incapacitated", "paralyzed", "petrified", "stunned", "unconscious"] satisfies Condition[],
  present: false
};

export const paladin: ClassMechanicsModule = {
  features: {
    // "Whenever you finish a Long Rest, you can change the kinds of weapons you chose": made in the Level flow until a
    // rest offers it.
    "weapon-mastery": { replaces: [{ offer: "feature:weapon-mastery", when: "level-up", amount: 2 }] },

    /** The Fighting Style feat catalog plus the inline Blessed Warrior option (consumers union the two). */
    "fighting-style": {
      choice: {
        kind: "fighting-style",
        choose: 1,
        fromCatalog: "fighting-style-feats",
        options: [
          {
            id: "blessed-warrior",
            name: "Blessed Warrior",
            description:
              "You learn two Cleric cantrips of your choice. Charisma is your spellcasting ability for them. Whenever you gain a Paladin level, you can replace one of these cantrips with another Cleric cantrip.",
            choice: { kind: "cantrip", choose: 2, fromCatalog: "cleric-spells", maxSpellLevel: 0 },
            replaces: [{ offer: "feature:blessed-warrior", when: "level-up", amount: 1 }]
          }
        ]
      }
    },

    /**
     * A pool of five times the Paladin level, back on a Long Rest. Healing spends the points its user picks and
     * restores that many; curing a poison spends 5 and restores none.
     */
    "lay-on-hands": {
      uses: {
        scaling: {
          type: "by-level",
          table: Array.from({ length: 20 }, (_, index) => ({ level: index + 1, limit: 5 * (index + 1) }))
        },
        per: "long-rest",
        pool: "lay-on-hands"
      },
      actions: [
        {
          id: "lay-on-hands",
          name: "Lay on Hands",
          activation: "bonus-action",
          description:
            "As a Bonus Action, touch a creature (which could be yourself) and draw power from the pool of healing to restore a number of Hit Points to that creature, up to the maximum amount remaining in the pool.",
          damage: [],
          useCost: "chosen",
          healing: { formula: "1", perUse: true },
          targets: { count: 1, rangeFeet: 5 }
        },
        {
          id: "lay-on-hands-cure-poison",
          name: "Lay on Hands: Cure Poison",
          activation: "bonus-action",
          description:
            "As a Bonus Action, touch a creature and expend 5 Hit Points from the pool of healing to remove the Poisoned condition from it; those points don't also restore Hit Points to the creature.",
          damage: [],
          useCost: 5,
          endsConditions: ["poisoned"],
          targets: { count: 1, rangeFeet: 5 }
        }
      ]
    },

    /**
     * Restoring Touch (Paladin 14): 5 points of the Lay on Hands pool end one of six more conditions. Each use ends
     * the one its user picks, so ending two takes two uses; the printed feature ends them all in one Lay on Hands.
     */
    "restoring-touch": {
      uses: {
        scaling: {
          type: "by-level",
          table: Array.from({ length: 20 }, (_, index) => ({ level: index + 1, limit: 5 * (index + 1) }))
        },
        per: "long-rest",
        pool: "lay-on-hands"
      },
      actions: [
        {
          id: "lay-on-hands-restoring-touch",
          name: "Lay on Hands: Restoring Touch",
          activation: "bonus-action",
          description:
            "As a Bonus Action, touch a creature and expend 5 Hit Points from the pool of healing to remove one of these conditions from it: Blinded, Charmed, Deafened, Frightened, Paralyzed, or Stunned. Those points don't also restore Hit Points to the creature.",
          damage: [],
          useCost: 5,
          endsConditions: ["blinded", "charmed", "deafened", "frightened", "paralyzed", "stunned"],
          endsOneCondition: true
        }
      ]
    },

    // Divine Smite always prepared, plus one free casting per Long Rest.
    "paladins-smite": {
      uses: { limit: 1, per: "long-rest" },
      grants: { spells: [{ id: "divine-smite", level: 1, alwaysPrepared: true, withoutSlot: "free" }] }
    },

    /**
     * Uses read off the printed column (2 at level 3, 3 from 11). The explicit `pool` lets Abjure Foes
     * and Sacred Weapon spend the same counter. One use comes back on a Short Rest, all on a Long Rest.
     */
    "channel-divinity": {
      uses: { scaling: { type: "class-resource", id: "channel-divinity" }, per: "long-rest", pool: "channel-divinity" },
      modifiers: [{ type: "short-rest-regain", poolId: "channel-divinity", amount: 1 }],
      tags: ["channel-divinity"],
      actions: [
        {
          id: "divine-sense",
          name: "Channel Divinity: Divine Sense",
          activation: "bonus-action",
          description:
            "You open your awareness to detect Celestials, Fiends, and Undead. For the next 10 minutes or until you have the Incapacitated condition, you know the location of any creature of those types within 60 feet of yourself, and you know its creature type. Within the same radius, you also detect any place or object that has been consecrated or desecrated, as with the Hallow spell.",
          damage: [],
          // Where each one stands and its type reach the Paladin's player alone, walls or not.
          grants: {
            name: "Divine Sense",
            tags: ["divine-sense"],
            duration: { type: "rounds", rounds: 100 },
            detects: { creatureTypes: ["celestial", "fiend", "undead"], feet: 60 }
          }
        }
      ]
    },

    // A standing rider `effective-actions` folds onto every weapon swing (attack count 2).
    "extra-attack": {
      modifiers: [{ type: "extra-attack", count: 1 }]
    },

    "faithful-steed": {
      uses: { limit: 1, per: "long-rest" },
      grants: { spells: [{ id: "find-steed", level: 2, alwaysPrepared: true, withoutSlot: "free" }] }
    },

    /**
     * Spends the shared Channel Divinity pool against the Paladin's own spell save DC, at up to the Charisma modifier's
     * creatures (minimum one) the Paladin can see within 60 feet; the Frightened lasts 1 minute or until the target
     * takes damage, and leaves it only one of moving, an action or a Bonus Action on its turns (`dazed`).
     */
    "abjure-foes": {
      uses: { scaling: { type: "class-resource", id: "channel-divinity" }, per: "long-rest", pool: "channel-divinity" },
      actions: [
        {
          id: "abjure-foes",
          name: "Channel Divinity: Abjure Foes",
          activation: "action",
          description:
            "As a Magic action, you expend one use of this class's Channel Divinity and target a number of creatures equal to your Charisma modifier (minimum of one) that you can see within 60 feet. Each target must succeed on a Wisdom saving throw or have the Frightened condition for 1 minute or until it takes any damage. While Frightened this way, a target can do only one of the following on its turns: move, take an action, or take a Bonus Action.",
          damage: [],
          save: {
            ability: "wis",
            dc: "spellcasting",
            successDamage: "none",
            failureConditions: ["frightened"],
            failureDuration: { type: "rounds", rounds: 10 },
            endsOnDamage: true,
            failureEffect: { name: "Abjured", tags: ["dazed"] }
          },
          targets: { countAbility: "cha", rangeFeet: 60, seen: true }
        }
      ]
    },

    // The Paladin's own immunity, which holds wherever it stands; its allies' is read where they stand
    // (`paladin-auras.ts` in the server).
    "aura-of-courage": {
      grants: { conditionImmunities: ["frightened"], when: [AURA_ACTIVE] }
    },

    "radiant-strikes": {
      modifiers: [
        {
          type: "extra-damage",
          formula: "1d8",
          damageType: "radiant",
          // A melee weapon or an Unarmed Strike: a melee spell attack is melee but no weapon.
          when: [{ type: "on-hit" }, { type: "attack-kind-is", kinds: ["melee-weapon", "unarmed"] }]
        }
      ]
    },

    "epic-boon": {
      choice: { kind: "feat", choose: 1, fromCatalog: "feats" }
    }
  },
  subclassStages: {
    "oath-of-devotion": spellTableStages("oath-of-devotion-spells", "Oath of Devotion Spells", "Paladin", [
      [
        5,
        [
          ["aid", "Aid", 2],
          ["zone-of-truth", "Zone of Truth", 2]
        ]
      ],
      [
        9,
        [
          ["beacon-of-hope", "Beacon of Hope", 3],
          ["dispel-magic", "Dispel Magic", 3]
        ]
      ],
      [
        13,
        [
          ["freedom-of-movement", "Freedom of Movement", 4],
          ["guardian-of-faith", "Guardian of Faith", 4]
        ]
      ],
      [
        17,
        [
          ["commune", "Commune", 5],
          ["flame-strike", "Flame Strike", 5]
        ]
      ]
    ])
  },
  subclasses: {
    "oath-of-devotion": {
      // The level-3 pair; the table's later rows are staged features (`subclassStages`).
      "oath-of-devotion-spells": {
        grants: {
          spells: [
            { id: "protection-from-evil-and-good", level: 1, alwaysPrepared: true },
            { id: "shield-of-faith", level: 1, alwaysPrepared: true }
          ]
        }
      },

      // A subclass spender of the class's Channel Divinity pool. The Charisma-modifier attack bonus is
      // not expressible (`attack-bonus` is a flat integer); the weapon's light rides an effect on the Paladin, who
      // holds it.
      "sacred-weapon": {
        uses: {
          scaling: { type: "class-resource", id: "channel-divinity" },
          per: "long-rest",
          pool: "channel-divinity"
        },
        actions: [
          {
            id: "sacred-weapon",
            name: "Channel Divinity: Sacred Weapon",
            activation: "other",
            description:
              "When you take the Attack action, you can expend one use of your Channel Divinity to imbue one Melee weapon you are holding with positive energy. For 10 minutes or until you use this feature again, you add your Charisma modifier to attack rolls with that weapon (minimum bonus of +1), and each time you hit with it you can make it deal Radiant damage instead of its normal type. The weapon emits Bright Light in a 20-foot radius and Dim Light 20 feet beyond that.",
            damage: [],
            grants: {
              name: "Sacred Weapon",
              tags: ["sacred-weapon"],
              duration: { type: "rounds", rounds: 100 },
              light: { brightFeet: 20, dimFeet: 20 }
            }
          }
        ]
      },

      // Same reading as Aura of Courage.
      "aura-of-devotion": {
        grants: { conditionImmunities: ["charmed"], when: [AURA_ACTIVE] }
      },

      // The nimbus is an effect on the Paladin for 10 minutes; the server reads it for the Radiant damage an enemy
      // starting its turn in the aura takes and the Advantage on saves a Fiend or an Undead forces. Its sunlight
      // fills the aura's 30 feet (Aura Expansion comes at level 18, before Holy Nimbus at 20).
      "holy-nimbus": {
        uses: { limit: 1, per: "long-rest" },
        actions: [
          {
            id: "holy-nimbus",
            name: "Holy Nimbus",
            activation: "bonus-action",
            description:
              "You imbue your Aura of Protection with holy power for 10 minutes or until you end it (no action required). You have Advantage on saving throws forced by Fiends and Undead; an enemy that starts its turn in the aura takes Radiant damage equal to your Charisma modifier plus your Proficiency Bonus; and the aura is filled with Bright Light that is sunlight. You can restore your use of this feature by expending a level 5 spell slot.",
            damage: [],
            grants: {
              name: "Holy Nimbus",
              tags: ["holy-nimbus"],
              duration: { type: "rounds", rounds: 100 },
              light: { brightFeet: 30, dimFeet: 0, sunlight: true }
            }
          }
        ]
      }
    }
  },
  liveResources: ["channel-divinity"]
};
