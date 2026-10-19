// Barbarian and Path of the Berserker mechanics, merged over the ETL-generated prose.
import type { ClassMechanicsModule } from "./overlay.js";

export const barbarian: ClassMechanicsModule = {
  features: {
    /**
     * Uses read off the printed Rages column. The `raging` tag is what `requiresEffectTag` and Mindless
     * Rage's gate read, and what the engine's Rage rules key on: it lasts until the end of the Barbarian's next
     * turn, each attack roll or forced save extends it (so does re-declaring it as a Bonus Action, for no use),
     * and Incapacitation or Heavy armor ends it. Rage Damage reads the second column at build (`grantScaling`) onto
     * the damage bonus of attacks using Strength. The engine holds the 10-minute cap, and Persistent Rage's form.
     * "You regain one expended use when you finish a Short Rest."
     */
    rage: {
      uses: { scaling: { type: "class-resource", id: "rage" }, per: "long-rest" },
      modifiers: [{ type: "short-rest-regain", poolId: "rage", amount: 1 }],
      actions: [
        {
          id: "rage",
          name: "Rage",
          activation: "bonus-action",
          description:
            "You enter a Rage: Resistance to Bludgeoning, Piercing and Slashing damage, Advantage on Strength checks and Strength saving throws, and a bonus to Strength-based damage. You can't concentrate or cast spells while raging.",
          damage: [],
          grantScaling: { resource: "rage-damage" },
          grants: {
            name: "Raging",
            tags: ["raging"],
            duration: { type: "until-source-turn-end" },
            modifiers: [
              { type: "damage-resistance", damageTypes: ["bludgeoning", "piercing", "slashing"] },
              // "When you make an attack using Strength - with either a weapon or an Unarmed Strike - and deal damage".
              {
                type: "damage-bonus",
                amount: 2,
                when: [{ type: "on-damage-roll" }, { type: "ability-is", abilities: ["str"] }]
              },
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
    // Weapon Mastery grows with the printed column: 2 -> 3 at level 4 -> 4 at level 10. "Whenever you finish a Long
    // Rest, you can ... change one of those weapon choices": the change is made in the Level flow until a rest offers it.
    "weapon-mastery": {
      extraPicks: [
        { offer: "feature:weapon-mastery", scaling: { type: "class-resource-growth", id: "weapon-mastery" } }
      ],
      replaces: [{ offer: "feature:weapon-mastery", when: "level-up", amount: 1 }]
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
    // Authored as `effects` so an activation is synthesised; it lasts until the start of your next turn. Advantage on
    // "attack rolls using Strength", any attack roll against you; the engine takes it only with the first attack roll
    // on your turn (its `reckless-attack` tag).
    "reckless-attack": {
      effects: [
        {
          name: "Reckless Attack",
          tags: ["reckless-attack"],
          duration: { type: "until-source-next-turn" },
          modifiers: [
            {
              type: "roll-mode",
              roll: "attack",
              mode: "advantage",
              when: [{ type: "on-attack-roll" }, { type: "ability-is", abilities: ["str"] }]
            },
            { type: "roll-mode", roll: "incoming-attack", mode: "advantage" }
          ]
        }
      ]
    },
    // One more pick from the class skill list. While raging, `checkPlan` makes the five skills' checks as Strength
    // checks when that is the better roll.
    "primal-knowledge": {
      extraPicks: [{ offer: "class-skills", amount: 1 }]
    },
    // A standing rider `effective-actions` folds onto every weapon swing (attack count 2).
    "extra-attack": {
      modifiers: [{ type: "extra-attack", count: 1 }]
    },
    // "While you aren't wearing Heavy armor": the +10 is in the sheet's Speed, and a live -10 takes it back while
    // Heavy armor is worn, so sheets built with the +10 stay right.
    "fast-movement": {
      modifiers: [
        { type: "speed", amount: 10 },
        { type: "speed", amount: -10, when: [{ type: "while-armored", weights: ["heavy"] }] }
      ]
    },
    /** "Your instincts are so honed that you have Advantage on Initiative rolls." */
    "feral-instinct": {
      modifiers: [{ type: "roll-mode", roll: "initiative", mode: "advantage" }]
    },
    /**
     * Tapped before the roll, on a turn with Reckless Attack: the next Strength attack roll gives up its Advantage
     * (refused with Disadvantage), and its hit offers the 1d10 of the weapon's type (2d10 from level 17) and one effect
     * (two different ones from level 17). Improved Brutal Strike's two effects need its feature.
     */
    "brutal-strike": {
      actions: [
        {
          id: "brutal-strike",
          name: "Brutal Strike",
          activation: "other",
          description:
            "With Reckless Attack, forgo the Advantage on your next Strength-based attack roll this turn (it mustn't have Disadvantage). If it hits, the target takes an extra 1d10 damage of the weapon's type, and you can cause one Brutal Strike effect. Forceful Blow: the target is pushed 15 feet straight away from you, and you can then move up to half your Speed straight toward it without provoking Opportunity Attacks. Hamstring Blow: the target's Speed is reduced by 15 feet until the start of your next turn.",
          damage: [],
          damageByLevel: [
            { level: 9, formula: "1d10", type: "weapon" },
            { level: 17, formula: "2d10", type: "weapon" }
          ],
          requiresEffectTag: "reckless-attack",
          uses: { limit: 1, per: "turn", pool: "brutal-strike" },
          grants: {
            name: "Brutal Strike",
            tags: ["forgoes-advantage"],
            duration: { type: "until-source-next-turn" }
          },
          ridesHit: {
            rides: "strength-attack",
            declaredBeforeRoll: true,
            ownTurn: true,
            weaponType: true,
            effectsChooseByLevel: [
              { level: 9, choose: 1 },
              { level: 17, choose: 2 }
            ],
            effects: [
              { id: "forceful-blow", name: "Forceful Blow", push: { feet: 15 }, grantsHalfSpeedMove: true },
              {
                id: "hamstring-blow",
                name: "Hamstring Blow",
                applies: {
                  name: "Hamstring Blow",
                  modifiers: [{ type: "speed", amount: -15 }],
                  duration: { type: "until-source-next-turn" },
                  onePerTarget: true
                }
              },
              {
                id: "staggering-blow",
                name: "Staggering Blow",
                requiresFeature: "improved-brutal-strike",
                applies: {
                  name: "Staggering Blow",
                  tags: ["no-opportunity-attacks", "until-own-save"],
                  modifiers: [{ type: "roll-mode", roll: "save", mode: "disadvantage" }],
                  duration: { type: "until-source-next-turn" }
                }
              },
              {
                id: "sundering-blow",
                name: "Sundering Blow",
                requiresFeature: "improved-brutal-strike",
                applies: { name: "Sundering Blow", tags: ["sundered"], duration: { type: "until-source-next-turn" } }
              }
            ]
          }
        }
      ]
    },
    // Once per Long Rest; using it regains every expended Rage. The engine reads the feature by its id for the Rage
    // that lasts 10 minutes outright and ends early only on Unconscious.
    "persistent-rage": {
      uses: { limit: 1, per: "long-rest" }
    },
    // "If your total for a Strength check or Strength saving throw is less than your Strength score, you can use that
    // score in place of the total."
    "indomitable-might": {
      modifiers: [
        {
          type: "total-minimum",
          roll: "check",
          abilityScore: "str",
          when: [{ type: "on-ability-check" }, { type: "ability-is", abilities: ["str"] }]
        },
        {
          type: "total-minimum",
          roll: "save",
          abilityScore: "str",
          when: [{ type: "on-saving-throw" }, { type: "ability-is", abilities: ["str"] }]
        }
      ]
    },
    "epic-boon": {
      choice: { kind: "feat", choose: 1, fromCatalog: "feats" }
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
       * DC 8 + Strength + Proficiency Bonus; a failed save is Frightened for 1 minute and repeats the save at the
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
       * Immunity gated on the `raging` tag Rage's effect writes, evaluated per read by `equipment-derivation.ts` and
       * failing closed. A Charmed or Frightened condition present as the Rage starts ends then (`grant.ts`).
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
