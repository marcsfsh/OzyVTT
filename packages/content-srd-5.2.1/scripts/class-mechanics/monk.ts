/**
 * Monk and Warrior of the Open Hand mechanics, merged over the ETL-generated prose.
 *
 * Uses count one per spend, so only features costing exactly 1 Focus Point ride the `focus-points`
 * pool; features costing 3 or 4 keep their price in prose rather than debiting the wrong amount.
 */
import type { ClassMechanicsModule } from "./overlay.js";

/** Every damage type but Force - Superior Defense's "Resistance to all damage except Force damage". */
const ALL_BUT_FORCE = [
  "acid",
  "bludgeoning",
  "cold",
  "fire",
  "lightning",
  "necrotic",
  "piercing",
  "poison",
  "psychic",
  "radiant",
  "slashing",
  "thunder"
] as const;

export const monk: ClassMechanicsModule = {
  features: {
    // Wisdom, no Shield. The Barbarian's feature with the same id differs, hence (recordId, featureId) keys.
    "unarmored-defense": {
      modifiers: [{ type: "unarmored-defense", ability: "wis", allowShield: false }]
    },
    /**
     * Focus Points read off the printed column; the shared `pool` lets all three 1-point actions (and
     * Stunning Strike) spend one counter. These are the paid forms; the free Disengage/Dash forms are in
     * the text. Flurry's strikes are a compound bonus action: resolving it opens a pool of Unarmed Strikes
     * (two, three from Heightened Focus at 10) that each strike spends. Heightened Focus's other upgrades stay prose.
     */
    "monks-focus": {
      uses: { scaling: { type: "class-resource", id: "focus-points" }, per: "short-rest", pool: "focus-points" },
      actions: [
        {
          id: "flurry-of-blows",
          name: "Flurry of Blows",
          activation: "bonus-action",
          description: "Expend 1 Focus Point to make two Unarmed Strikes as a Bonus Action (three at Monk level 10).",
          damage: [],
          multiattack: [{ actionId: "unarmed-strike", count: 2 }],
          multiattackByLevel: [{ level: 10, multiattack: [{ actionId: "unarmed-strike", count: 3 }] }]
        },
        {
          id: "patient-defense",
          name: "Patient Defense",
          activation: "bonus-action",
          description:
            "Expend 1 Focus Point to take both the Disengage and the Dodge actions as a Bonus Action. Taking Disengage alone as a Bonus Action costs no Focus Point.",
          damage: []
        },
        {
          id: "step-of-the-wind",
          name: "Step of the Wind",
          activation: "bonus-action",
          description:
            "Expend 1 Focus Point to take both the Disengage and Dash actions as a Bonus Action, and your jump distance is doubled for the turn. Taking Dash alone as a Bonus Action costs no Focus Point.",
          damage: []
        }
      ]
    },
    // The once-per-Long-Rest permission only; refilling Focus Points is done by hand.
    "uncanny-metabolism": {
      uses: { limit: 1, per: "long-rest" }
    },
    // Same caveat as the Barbarian's: it reaches feature actions only, not inventory-derived swings.
    "extra-attack": {
      modifiers: [{ type: "extra-attack", count: 1 }]
    },
    /**
     * DC is 8 + Wisdom + Proficiency Bonus; the Focus Point comes off the shared pool. A failed save is
     * Stunned until the start of the Monk's next turn; the success rider (halved Speed, Advantage) stays prose.
     * "Once per turn" is not expressible alongside the pool, so the scarcer Focus Point is what is tracked.
     */
    "stunning-strike": {
      uses: { scaling: { type: "class-resource", id: "focus-points" }, per: "short-rest", pool: "focus-points" },
      actions: [
        {
          id: "stunning-strike",
          name: "Stunning Strike",
          activation: "other",
          description:
            "Once per turn, when you hit a creature with a Monk weapon or an Unarmed Strike, expend 1 Focus Point: the target makes a Constitution saving throw or has the Stunned condition until the start of your next turn. On a success its Speed is halved until the start of your next turn and the next attack roll against it before then has Advantage.",
          damage: [],
          save: {
            ability: "con",
            dc: { base: 8, ability: "wis", proficiencyBonus: true },
            successDamage: "none",
            failureConditions: ["stunned"],
            failureDuration: { type: "until-source-next-turn" }
          }
        }
      ]
    },
    /** "Your physical and mental discipline grant you proficiency in all saving throws." */
    "disciplined-survivor": {
      grants: { saves: ["str", "dex", "con", "int", "wis", "cha"] }
    },
    // Authored as `effects` so an activation is synthesised. The 3-point price and the Incapacitated
    // end condition stay prose.
    "superior-defense": {
      effects: [
        {
          name: "Superior Defense",
          tags: ["superior-defense"],
          duration: { type: "rounds", rounds: 10 },
          modifiers: [{ type: "damage-resistance", damageTypes: [...ALL_BUT_FORCE] }]
        }
      ]
    },
    "epic-boon": {
      choice: { kind: "feat", choose: 1, fromCatalog: "epic-boon-feats" }
    },
    /** "Your Dexterity and Wisdom scores increase by 4, to a maximum of 25." */
    "body-and-mind": {
      modifiers: [
        { type: "ability-score", ability: "dex", amount: 4, maximum: 25 },
        { type: "ability-score", ability: "wis", amount: 4, maximum: 25 }
      ]
    }
    // Not modeled here: Martial Arts' Unarmed Strike is minted by the builder (`martialArtsStrike`),
    // but its die and Dexterity do not reach inventory Monk weapons. Martial-Arts-die features (Deflect
    // Attacks/Energy, temp HP amounts), Unarmored Movement's scaling speed, and Slow Fall, Acrobatic
    // Movement, Empowered Strikes, Self-Restoration and Perfect Focus stay prose. Evasion is read by the save
    // outcome (`hasEvasion` in the server) from the held feature.
  },
  subclasses: {
    "warrior-of-the-open-hand": {
      // Uses equal the Wisdom modifier (minimum 1); the heal is the Martial Arts die plus the Wisdom modifier.
      "wholeness-of-body": {
        uses: { scaling: { type: "ability-modifier", ability: "wis", minimum: 1 }, per: "long-rest" },
        actions: [
          {
            id: "wholeness-of-body",
            name: "Wholeness of Body",
            activation: "bonus-action",
            description:
              "Roll your Martial Arts die and regain a number of Hit Points equal to the number rolled plus your Wisdom modifier (minimum of 1 Hit Point regained).",
            damage: [],
            // The Martial Arts die at the Warrior of the Open Hand's levels: d8 from 6, d10 from 11, d12 from 17.
            healing: { formula: "1d8", self: true },
            healingByLevel: [
              { level: 6, formula: "1d8" },
              { level: 11, formula: "1d10" },
              { level: 17, formula: "1d12" }
            ],
            adds: { abilityModifier: "wis" }
          }
        ]
      },
      // Flat 10d12 against the Monk's derived DC. The 4-point price, duration and one-target rule stay prose.
      "quivering-palm": {
        actions: [
          {
            id: "quivering-palm",
            name: "Quivering Palm",
            activation: "action",
            description:
              "End the vibrations you set in a creature. The target makes a Constitution saving throw, taking 10d12 Force damage on a failed save or half as much damage on a successful one.",
            damage: [{ formula: "10d12", type: "force" }],
            save: {
              ability: "con",
              dc: { base: 8, ability: "wis", proficiencyBonus: true },
              successDamage: "half",
              failureConditions: []
            }
          }
        ]
      }
      // Not modeled: Open Hand Technique (per-hit choice with different saves) and Fleet Step (extra Bonus Action).
    }
  },
  liveResources: ["focus-points"]
};
