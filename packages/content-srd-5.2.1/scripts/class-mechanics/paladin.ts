/**
 * Paladin mechanics - the GENERATED half of the overlay for this class and for Oath of Devotion.
 *
 * `build-class-bundle.ts` generates this class's prose from the SRD markdown on every run;
 * this overlay is merged on top of it.
 *
 * Stage 4 lane B2. Author here and nowhere else: this file is the only place a Paladin
 * rider, pick, or option mechanic belongs, so two authors working on two classes never touch one
 * file. See `./overlay.ts` for what a `FeatureMechanics` may carry and `./index.ts` for the merge.
 */
import type { ClassMechanicsModule } from "./overlay.js";

export const paladin: ClassMechanicsModule = {
  features: {
    /**
     * FIGHTING STYLE - the whole Fighting Style feat catalog **plus** one bespoke option.
     *
     * "Instead of choosing one of those feats, you can choose the option below." Both consumers used
     * to short-circuit on a non-empty `from` (which `options` derives), so a catalog and an inline
     * option could not be offered together and Blessed Warrior was simply unpickable. They are UNIONED
     * now, and this is the record that proves it.
     *
     * WHAT STAYS PROSE (ADR-0008): "whenever you gain a Paladin level, you can replace one of these
     * cantrips" is a REPLACEMENT clause, and nothing in the vocabulary edits a choice already made -
     * see the Stage-4 authoring assignments for the specification.
     */
    "fighting-style": {
      choice: {
        kind: "fighting-style", choose: 1, fromCatalog: "fighting-style-feats",
        options: [{
          id: "blessed-warrior",
          name: "Blessed Warrior",
          description: "You learn two Cleric cantrips of your choice. Charisma is your spellcasting ability for them. Whenever you gain a Paladin level, you can replace one of these cantrips with another Cleric cantrip.",
          choice: { kind: "cantrip", choose: 2, fromCatalog: "cleric-spells", maxSpellLevel: 0 }
        }]
      }
    },

    /**
     * PALADIN'S SMITE - audit row 30, both halves.
     *
     * "You always have the Divine Smite spell prepared. In addition, you can cast it without
     * expending a spell slot, but you must finish a Long Rest before you can cast it in this way
     * again." An always-prepared grant plus a one-use long-rest pool, and neither needed anything
     * the vocabulary did not already have - the record simply had no riders.
     */
    "paladins-smite": {
      uses: { limit: 1, per: "long-rest" },
      grants: { spells: [{ id: "divine-smite", level: 1, alwaysPrepared: true }] }
    },

    /**
     * CHANNEL DIVINITY - the pool three features spend, read off the printed column.
     *
     * `scaling: {type: "class-resource", id: "channel-divinity"}` gives 2 uses at level 3 and 3 from
     * level 11, which is what the column prints - so `channel-divinity` stops being `display: true`
     * and becomes a live pool (`liveResources` below). `pool` is named explicitly because the point
     * of this record is that Abjure Foes and the Oath's Sacred Weapon spend the SAME counter; an
     * implicit per-action key would have given each its own.
     *
     * `per: "long-rest"` matches the Cleric's shipped Channel Divinity exactly, and for the same
     * reason: the SRD gives back ONE use on a Short Rest and ALL on a Long Rest, `ActionUsesSchema`
     * has one `per`, and the stingier of the two readings is the one that cannot hand a player uses
     * the text does not.
     */
    "channel-divinity": {
      uses: { scaling: { type: "class-resource", id: "channel-divinity" }, per: "long-rest", pool: "channel-divinity" },
      tags: ["channel-divinity"],
      actions: [{
        id: "divine-sense",
        name: "Channel Divinity: Divine Sense",
        activation: "bonus-action",
        description: "You open your awareness to detect Celestials, Fiends, and Undead. For the next 10 minutes or until you have the Incapacitated condition, you know the location of any creature of those types within 60 feet of yourself, and you know its creature type. Within the same radius, you also detect any place or object that has been consecrated or desecrated, as with the Hallow spell.",
        damage: []
      }]
    },

    /**
     * EXTRA ATTACK - the same rider the Fighter ships, on the class that also prints it.
     *
     * Baked into `attack.count` on actions the FEATURE declares. A Paladin declares none - their
     * swings are derived from equipped inventory - so today this reaches nothing; see the pinned gap
     * in `rogue-ranger-paladin-mechanics.test.ts`. Authored anyway because the record is correct and
     * leaving it out would make the Paladin differ from the Fighter for no content reason.
     */
    "extra-attack": {
      modifiers: [{ type: "extra-attack", count: 1 }]
    },

    /**
     * FAITHFUL STEED - audit row 31, the twin of Paladin's Smite one level up.
     */
    "faithful-steed": {
      uses: { limit: 1, per: "long-rest" },
      grants: { spells: [{ id: "find-steed", level: 2, alwaysPrepared: true }] }
    },

    /**
     * ABJURE FOES - a Channel Divinity effect, spending the SAME counter Divine Sense does.
     *
     * `dc: "spellcasting"` is a template the builder resolves against the character's own numbers,
     * so the DC a target is held to is this Paladin's real spell save DC rather than a constant
     * nobody could have authored. `pool: "channel-divinity"` is what makes the two features share
     * one counter - the same mechanism Life Domain's Preserve Life uses against the Cleric's column.
     *
     * WHAT STAYS PROSE: the number of targets ("equal to your Charisma modifier, minimum one") -
     * `FeatureAction` has no ability-scaled target count - and the Frightened condition's own
     * "or until it takes any damage" clause.
     */
    "abjure-foes": {
      uses: { scaling: { type: "class-resource", id: "channel-divinity" }, per: "long-rest", pool: "channel-divinity" },
      actions: [{
        id: "abjure-foes",
        name: "Channel Divinity: Abjure Foes",
        activation: "action",
        description: "As a Magic action, you expend one use of this class's Channel Divinity and target a number of creatures equal to your Charisma modifier (minimum of one) that you can see within 60 feet. Each target must succeed on a Wisdom saving throw or have the Frightened condition for 1 minute or until it takes any damage. While Frightened this way, a target can do only one of the following on its turns: move, take an action, or take a Bonus Action.",
        damage: [],
        save: { ability: "wis", dc: "spellcasting" }
      }]
    },

    /**
     * AURA OF COURAGE - "You and your allies have Immunity to the Frightened condition."
     *
     * The Paladin is always inside their own aura, so for the CHARACTER the immunity is
     * unconditional and `grants.conditionImmunities` says it exactly. The engine enforces it:
     * applying Frightened to this actor skips with narration rather than landing.
     *
     * WHAT STAYS PROSE: the allies. Nothing in the vocabulary reaches another creature's
     * immunities from a bearer's aura, and the emanation's radius is not modelled at all.
     */
    "aura-of-courage": {
      grants: { conditionImmunities: ["frightened"] }
    },

    /**
     * RADIANT STRIKES - "the target takes an extra 1d8 Radiant damage."
     *
     * A roll-time rider, gated on the moment and the attack kind the SRD prints: `on-hit` plus
     * `attack-kind-is: ["melee", "unarmed"]`, which is one moment and one filter, exactly what
     * `RiderWhenSchema` allows. The resolver rolls it as its own typed damage entry on a hit with a
     * Melee weapon and adds nothing to a bowshot.
     */
    "radiant-strikes": {
      modifiers: [{
        type: "extra-damage", formula: "1d8", damageType: "radiant",
        when: [{ type: "on-hit" }, { type: "attack-kind-is", kinds: ["melee", "unarmed"] }]
      }]
    },

    /**
     * EPIC BOON - audit row 6, the Paladin's share.
     */
    "epic-boon": {
      choice: { kind: "feat", choose: 1, fromCatalog: "epic-boon-feats" }
    }
  },
  subclasses: {
    "oath-of-devotion": {
      /**
       * OATH OF DEVOTION SPELLS - audit row 28, and only its FIRST TIER is authorable.
       *
       * The SRD prints one heading and a five-row table: two spells at Paladin 3, two more at 5, 9,
       * 13 and 17. `grants.spells` has no level gate - `spells[].level` is the SPELL's level, not the
       * character level it arrives at - so authoring all ten here would hand a level-3 Paladin
       * Commune and Flame Strike as always-prepared spells. The level-3 pair is unconditionally
       * correct for every Paladin who has this feature, so that is what is authored.
       *
       * THE SHAPE THAT WOULD FINISH IT is Life Domain's: one FEATURE per tier
       * (`life-domain-spells-5`, `-7`, `-9`), each carrying its own `grants.spells` and its own
       * `level`. Life Domain can do that because Cleric is HAND_AUTHORED and those records live in
       * `classes.v1.json`. Oath of Devotion is ETL-generated and the overlay merges riders onto
       * feature ids that already exist - it cannot MINT a record, and a key matching no feature is a
       * build error by design. Closing row 28 needs either per-tier records from the ETL or an
       * `atLevel` on a spell grant; the table is in the description either way.
       */
      "oath-of-devotion-spells": {
        grants: {
          spells: [
            { id: "protection-from-evil-and-good", level: 1, alwaysPrepared: true },
            { id: "shield-of-faith", level: 1, alwaysPrepared: true }
          ]
        }
      },

      /**
       * SACRED WEAPON - a third spender of the class's Channel Divinity counter.
       *
       * The subclass reaching the CLASS's pool is the whole point of `uses.pool`, and
       * `class-resource-pools.test.ts` counts subclass features when it decides whether a printed
       * column is live for exactly this reason.
       *
       * WHAT STAYS PROSE: "you add your Charisma modifier to attack rolls with that weapon (minimum
       * +1)". `attack-bonus` takes a flat signed integer and there is no ability-derived form, which
       * is the same call the Cleric's Arcana/Religion bonus and the Paladin's Aura of Protection make.
       */
      "sacred-weapon": {
        uses: { scaling: { type: "class-resource", id: "channel-divinity" }, per: "long-rest", pool: "channel-divinity" },
        actions: [{
          id: "sacred-weapon",
          name: "Channel Divinity: Sacred Weapon",
          activation: "other",
          description: "When you take the Attack action, you can expend one use of your Channel Divinity to imbue one Melee weapon you are holding with positive energy. For 10 minutes or until you use this feature again, you add your Charisma modifier to attack rolls with that weapon (minimum bonus of +1), and each time you hit with it you can make it deal Radiant damage instead of its normal type. The weapon emits Bright Light in a 20-foot radius and Dim Light 20 feet beyond that.",
          damage: []
        }]
      },

      /**
       * AURA OF DEVOTION - the Charmed twin of Aura of Courage, and the same reading.
       */
      "aura-of-devotion": {
        grants: { conditionImmunities: ["charmed"] }
      },

      /**
       * HOLY NIMBUS - one Bonus Action, once per Long Rest.
       *
       * WHAT STAYS PROSE: all three benefits. Advantage on saves is gated on the SOURCE of the save
       * being a Fiend or an Undead, and `versus-creature-type` is a filter on the bearer's own roll
       * against a target, not on who forced the save; the Radiant damage is dealt to enemies at the
       * start of THEIR turns, which is an aura tick with no vocabulary; and the sunlight is scenery.
       * The counter is the part a player tracks, and it is real.
       */
      "holy-nimbus": {
        uses: { limit: 1, per: "long-rest" },
        actions: [{
          id: "holy-nimbus",
          name: "Holy Nimbus",
          activation: "bonus-action",
          description: "You imbue your Aura of Protection with holy power for 10 minutes or until you end it (no action required). You have Advantage on saving throws forced by Fiends and Undead; an enemy that starts its turn in the aura takes Radiant damage equal to your Charisma modifier plus your Proficiency Bonus; and the aura is filled with Bright Light that is sunlight. You can restore your use of this feature by expending a level 5 spell slot.",
          damage: []
        }]
      }
    }
  },
  liveResources: ["channel-divinity"]
};
