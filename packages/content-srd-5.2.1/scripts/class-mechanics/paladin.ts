// Paladin and Oath of Devotion mechanics, merged over the ETL-generated prose.
import type { ClassMechanicsModule } from "./overlay.js";

export const paladin: ClassMechanicsModule = {
  features: {
    /**
     * The Fighting Style feat catalog plus the inline Blessed Warrior option (consumers union the two).
     * Its replace-a-cantrip-on-level-up clause stays prose.
     */
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
            choice: { kind: "cantrip", choose: 2, fromCatalog: "cleric-spells", maxSpellLevel: 0 }
          }
        ]
      }
    },

    // Divine Smite always prepared, plus one free casting per Long Rest.
    "paladins-smite": {
      uses: { limit: 1, per: "long-rest" },
      grants: { spells: [{ id: "divine-smite", level: 1, alwaysPrepared: true }] }
    },

    /**
     * Uses read off the printed column (2 at level 3, 3 from 11). The explicit `pool` lets Abjure Foes
     * and Sacred Weapon spend the same counter. The SRD returns one use on a Short Rest and all on a
     * Long Rest; with one `per`, the stingier long-rest reading is used (as for the Cleric).
     */
    "channel-divinity": {
      uses: { scaling: { type: "class-resource", id: "channel-divinity" }, per: "long-rest", pool: "channel-divinity" },
      tags: ["channel-divinity"],
      actions: [
        {
          id: "divine-sense",
          name: "Channel Divinity: Divine Sense",
          activation: "bonus-action",
          description:
            "You open your awareness to detect Celestials, Fiends, and Undead. For the next 10 minutes or until you have the Incapacitated condition, you know the location of any creature of those types within 60 feet of yourself, and you know its creature type. Within the same radius, you also detect any place or object that has been consecrated or desecrated, as with the Hallow spell.",
          damage: []
        }
      ]
    },

    // Applies only to actions the feature declares; a Paladin's swings come from inventory, so this
    // currently reaches nothing (pinned in `rogue-ranger-paladin-mechanics.test.ts`).
    "extra-attack": {
      modifiers: [{ type: "extra-attack", count: 1 }]
    },

    "faithful-steed": {
      uses: { limit: 1, per: "long-rest" },
      grants: { spells: [{ id: "find-steed", level: 2, alwaysPrepared: true }] }
    },

    /**
     * Spends the shared Channel Divinity pool against the Paladin's own spell save DC. The
     * Charisma-scaled target count and "until it takes any damage" stay prose.
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
          save: { ability: "wis", dc: "spellcasting", successDamage: "none", failureConditions: ["frightened"] }
        }
      ]
    },

    // The Paladin is always inside their own aura; immunity for allies is not expressible.
    "aura-of-courage": {
      grants: { conditionImmunities: ["frightened"] }
    },

    "radiant-strikes": {
      modifiers: [
        {
          type: "extra-damage",
          formula: "1d8",
          damageType: "radiant",
          when: [{ type: "on-hit" }, { type: "attack-kind-is", kinds: ["melee", "unarmed"] }]
        }
      ]
    },

    "epic-boon": {
      choice: { kind: "feat", choose: 1, fromCatalog: "epic-boon-feats" }
    }
  },
  subclasses: {
    "oath-of-devotion": {
      /**
       * Only the level-3 pair is authored: `grants.spells` has no character-level gate, and the overlay
       * cannot mint per-tier feature records the way Life Domain's hand-authored ones do. The full table
       * is in the description.
       */
      "oath-of-devotion-spells": {
        grants: {
          spells: [
            { id: "protection-from-evil-and-good", level: 1, alwaysPrepared: true },
            { id: "shield-of-faith", level: 1, alwaysPrepared: true }
          ]
        }
      },

      // A subclass spender of the class's Channel Divinity pool. The Charisma-modifier attack bonus is
      // not expressible (`attack-bonus` is a flat integer).
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
            damage: []
          }
        ]
      },

      // Same reading as Aura of Courage.
      "aura-of-devotion": {
        grants: { conditionImmunities: ["charmed"] }
      },

      // The counter only; the save advantage (keyed to the source's creature type), the Radiant aura tick
      // and the sunlight stay prose.
      "holy-nimbus": {
        uses: { limit: 1, per: "long-rest" },
        actions: [
          {
            id: "holy-nimbus",
            name: "Holy Nimbus",
            activation: "bonus-action",
            description:
              "You imbue your Aura of Protection with holy power for 10 minutes or until you end it (no action required). You have Advantage on saving throws forced by Fiends and Undead; an enemy that starts its turn in the aura takes Radiant damage equal to your Charisma modifier plus your Proficiency Bonus; and the aura is filled with Bright Light that is sunlight. You can restore your use of this feature by expending a level 5 spell slot.",
            damage: []
          }
        ]
      }
    }
  },
  liveResources: ["channel-divinity"]
};
