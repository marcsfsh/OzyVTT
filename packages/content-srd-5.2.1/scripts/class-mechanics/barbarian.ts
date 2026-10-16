// Barbarian and Path of the Berserker mechanics, merged over the ETL-generated prose.
import type { ClassMechanicsModule } from "./overlay.js";

export const barbarian: ClassMechanicsModule = {
  features: {
    /**
     * Uses read off the printed Rages column. The `raging` tag is what `requiresEffectTag` and Mindless
     * Rage's gate read, and what the engine's Rage rules key on: it lasts until the end of the Barbarian's next
     * turn, each attack roll or forced save extends it (so does re-declaring it as a Bonus Action, for no use),
     * and Incapacitation or Heavy armor ends it. Rage Damage (a second column), the 10-minute cap and Persistent
     * Rage's longer form stay prose.
     */
    rage: {
      uses: { scaling: { type: "class-resource", id: "rage" }, per: "long-rest" },
      actions: [
        {
          id: "rage",
          name: "Rage",
          activation: "bonus-action",
          description:
            "You enter a Rage: Resistance to Bludgeoning, Piercing and Slashing damage, Advantage on Strength checks and Strength saving throws, and a bonus to Strength-based damage. You can't concentrate or cast spells while raging.",
          damage: [],
          grants: {
            name: "Raging",
            tags: ["raging"],
            duration: { type: "until-source-turn-end" },
            modifiers: [
              { type: "damage-resistance", damageTypes: ["bludgeoning", "piercing", "slashing"] },
              {
                type: "roll-mode",
                roll: "check",
                mode: "advantage",
                when: [{ type: "on-ability-check" }, { type: "ability-is", abilities: ["str"] }]
              },
              {
                type: "roll-mode",
                roll: "save",
                mode: "advantage",
                when: [{ type: "on-saving-throw" }, { type: "ability-is", abilities: ["str"] }]
              }
            ]
          }
        }
      ]
    },
    // Constitution, Shield allowed. The Monk's feature with the same id differs, hence (recordId, featureId) keys.
    "unarmored-defense": {
      modifiers: [{ type: "unarmored-defense", ability: "con", allowShield: true }]
    },
    // Weapon Mastery grows with the printed column: 2 -> 3 at level 4 -> 4 at level 10.
    "weapon-mastery": {
      extraPicks: [
        { offer: "feature:weapon-mastery", scaling: { type: "class-resource-growth", id: "weapon-mastery" } }
      ]
    },
    // Advantage on Dexterity saves "unless you have the Incapacitated condition" (or one that includes it).
    "danger-sense": {
      modifiers: [
        {
          type: "roll-mode",
          roll: "save",
          mode: "advantage",
          when: [
            { type: "on-saving-throw" },
            { type: "ability-is", abilities: ["dex"] },
            {
              type: "while-condition",
              conditionIds: ["incapacitated", "paralyzed", "petrified", "stunned", "unconscious"],
              present: false
            }
          ]
        }
      ]
    },
    // Authored as `effects` so an activation is synthesised; it lasts until the start of your next turn. "Using
    // Strength" stays prose: attack advantage cannot be gated on the attack's ability.
    "reckless-attack": {
      effects: [
        {
          name: "Reckless Attack",
          tags: ["reckless-attack"],
          duration: { type: "until-source-next-turn" },
          modifiers: [
            { type: "roll-mode", roll: "attack", mode: "advantage" },
            { type: "roll-mode", roll: "incoming-attack", mode: "advantage" }
          ]
        }
      ]
    },
    // One more pick from the class skill list. The "as a Strength check" half stays prose.
    "primal-knowledge": {
      extraPicks: [{ offer: "class-skills", amount: 1 }]
    },
    // Currently reaches nothing: it raises `attack.count` only on feature actions, and martial swings
    // come from inventory. Kept to match the Fighter's identical rider.
    "extra-attack": {
      modifiers: [{ type: "extra-attack", count: 1 }]
    },
    // Ungated: a Barbarian is not proficient with Heavy armor (and `speed` is baked without reading `when`).
    "fast-movement": {
      modifiers: [{ type: "speed", amount: 10 }]
    },
    /** "Your instincts are so honed that you have Advantage on Initiative rolls." */
    "feral-instinct": {
      modifiers: [{ type: "roll-mode", roll: "initiative", mode: "advantage" }]
    },
    // The once-per-Long-Rest permission only; refilling Rage uses is done by hand.
    "persistent-rage": {
      uses: { limit: 1, per: "long-rest" }
    },
    "epic-boon": {
      choice: { kind: "feat", choose: 1, fromCatalog: "epic-boon-feats" }
    },
    // `maximum: 25` lifts the builder's default clamp at 20.
    "primal-champion": {
      modifiers: [
        { type: "ability-score", ability: "str", amount: 4, maximum: 25 },
        { type: "ability-score", ability: "con", amount: 4, maximum: 25 }
      ]
    }
  },
  subclasses: {
    "path-of-the-berserker": {
      /**
       * DC 8 + Strength + Proficiency Bonus; a failed save is Frightened for 1 minute, repeating the save at the
       * end of each of its turns. Restoring the use by spending a Rage stays prose.
       */
      "intimidating-presence": {
        uses: { limit: 1, per: "long-rest" },
        actions: [
          {
            id: "intimidating-presence",
            name: "Intimidating Presence",
            activation: "bonus-action",
            area: { shape: "emanation", sizeFeet: 30, widthFeet: null },
            description:
              "Each creature of your choice in a 30-foot Emanation makes a Wisdom saving throw. On a failed save, the creature has the Frightened condition for 1 minute; at the end of each of its turns it repeats the save, ending the effect on itself on a success.",
            damage: [],
            save: {
              ability: "wis",
              dc: { base: 8, ability: "str", proficiencyBonus: true },
              successDamage: "none",
              failureConditions: ["frightened"],
              failureDuration: { type: "rounds", rounds: 10 },
              repeatSave: true
            }
          }
        ]
      },
      /**
       * Immunity gated on the `raging` tag Rage's effect writes, evaluated per read by
       * `equipment-derivation.ts` and failing closed. Ending an existing Charmed/Frightened condition on
       * entering Rage is not expressible and stays prose.
       */
      "mindless-rage": {
        grants: {
          conditionImmunities: ["charmed", "frightened"],
          when: [{ type: "while-effect-tag", tags: ["raging"] }]
        }
      },
      /** Offered when a creature within 5 feet deals damage; answering makes one melee attack with the weapon the
       *  player picks (else the first melee attack, else an Unarmed Strike), as an opportunity attack does. */
      retaliation: {
        actions: [
          {
            id: "retaliation",
            name: "Retaliation",
            activation: "reaction",
            description:
              "When you take damage from a creature within 5 feet of you, make one melee attack against that creature, using a weapon or an Unarmed Strike.",
            damage: [],
            reaction: { trigger: "damaged-by-creature", response: "melee-attack", rangeFeet: 5 }
          }
        ]
      }
      // Not modeled: Frenzy (dice count read from the Rage Damage column).
    }
  },
  liveResources: ["rage"]
};
