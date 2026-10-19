// Rogue and Thief mechanics, merged over the ETL-generated prose.
import type { ClassMechanicsModule } from "./overlay.js";

export const rogue: ClassMechanicsModule = {
  features: {
    // "Whenever you finish a Long Rest, you can change the kinds of weapons you chose": made in the Level flow until a
    // rest offers it.
    "weapon-mastery": { replaces: [{ offer: "feature:weapon-mastery", when: "level-up", amount: 2 }] },
    /**
     * Once per turn (`per: "turn"`, counted in `turnUses`). It rides a hit: the server offers it on an attack's
     * preview when the hit qualifies (Finesse or Ranged weapon; Advantage, or an ally beside the target and no
     * Disadvantage) and rolls it with the hit in the weapon's type, so the `weapon` label below is never dealt.
     * The printed column stays display-only: "6d6" is dice to roll. Cunning Strike's effects ride it, each forgoing
     * its die cost before the dice roll, at 8 + Dexterity + Proficiency Bonus: one effect from level 5 (Cunning
     * Strike), two from level 11 (Improved Cunning Strike), and the ones Devious Strikes and Supreme Sneak add.
     */
    "sneak-attack": {
      uses: { limit: 1, per: "turn", pool: "sneak-attack" },
      actions: [
        {
          id: "sneak-attack",
          name: "Sneak Attack",
          activation: "other",
          description:
            "Once per turn, deal this extra damage to one creature you hit with an attack roll, if you have Advantage on the roll (or an ally is within 5 feet of the target, that ally isn't Incapacitated, and you don't have Disadvantage) and the attack uses a Finesse or a Ranged weapon. The extra damage's type is the same as the weapon's. Add it when you confirm a qualifying hit, with any Cunning Strike effects, each forgoing its die cost.",
          damage: [],
          ridesHit: {
            rides: "finesse-or-ranged-weapon",
            sneakAttack: true,
            weaponType: true,
            saveDc: { base: 8, ability: "dex", proficiencyBonus: true },
            effectsChooseByLevel: [
              { level: 5, choose: 1 },
              { level: 11, choose: 2 }
            ],
            effects: [
              {
                id: "poison",
                name: "Poison",
                forgoesDice: 1,
                requiresFeature: "cunning-strike",
                requiresItem: "poisoners-kit",
                save: {
                  ability: "con",
                  failureConditions: ["poisoned"],
                  failureDuration: { type: "rounds", rounds: 10 },
                  repeatSave: true
                }
              },
              {
                id: "trip",
                name: "Trip",
                forgoesDice: 1,
                requiresFeature: "cunning-strike",
                maxTargetSize: "large",
                save: { ability: "dex", failureConditions: ["prone"] }
              },
              {
                id: "withdraw",
                name: "Withdraw",
                forgoesDice: 1,
                requiresFeature: "cunning-strike",
                grantsHalfSpeedMove: true
              },
              {
                id: "stealth-attack",
                name: "Stealth Attack",
                forgoesDice: 1,
                requiresFeature: "supreme-sneak",
                keepsHidden: true
              },
              {
                id: "daze",
                name: "Daze",
                forgoesDice: 2,
                requiresFeature: "devious-strikes",
                save: {
                  ability: "con",
                  failureEffect: {
                    name: "Dazed",
                    tags: ["dazed"],
                    duration: { type: "until-bearer-turn-end" }
                  }
                }
              },
              {
                id: "knock-out",
                name: "Knock Out",
                forgoesDice: 6,
                requiresFeature: "devious-strikes",
                save: {
                  ability: "con",
                  failureConditions: ["unconscious"],
                  failureDuration: { type: "rounds", rounds: 10 },
                  repeatSave: true,
                  endsOnDamage: true
                }
              },
              {
                id: "obscure",
                name: "Obscure",
                forgoesDice: 3,
                requiresFeature: "devious-strikes",
                save: {
                  ability: "dex",
                  failureConditions: ["blinded"],
                  failureDuration: { type: "until-bearer-turn-end" }
                }
              }
            ]
          },
          damageByLevel: [
            { level: 1, formula: "1d6", type: "weapon" },
            { level: 3, formula: "2d6", type: "weapon" },
            { level: 5, formula: "3d6", type: "weapon" },
            { level: 7, formula: "4d6", type: "weapon" },
            { level: 9, formula: "5d6", type: "weapon" },
            { level: 11, formula: "6d6", type: "weapon" },
            { level: 13, formula: "7d6", type: "weapon" },
            { level: 15, formula: "8d6", type: "weapon" },
            { level: 17, formula: "9d6", type: "weapon" },
            { level: 19, formula: "10d6", type: "weapon" }
          ]
        }
      ]
    },

    // "You know Thieves' Cant and one other language of your choice": the second half raises the
    // `species-languages` budget.
    "thieves-cant": {
      grants: { languages: ["thieves-cant"] },
      extraPicks: [{ offer: "species-languages", amount: 1 }]
    },

    /**
     * The engine reads the `steady-aim` tag: refused once the Rogue has moved this turn, the effect lasts until the
     * end of the turn with Speed 0, and the next attack roll spends its Advantage.
     */
    "steady-aim": {
      actions: [
        {
          id: "steady-aim",
          name: "Steady Aim",
          activation: "bonus-action",
          description:
            "You give yourself Advantage on your next attack roll on the current turn. You can use this only if you haven't moved during this turn, and after you use it your Speed is 0 until the end of the turn.",
          damage: [],
          grants: {
            name: "Steady Aim",
            tags: ["steady-aim"],
            duration: { type: "until-source-next-turn" },
            modifiers: [{ type: "roll-mode", roll: "attack", mode: "advantage" }]
          }
        }
      ]
    },

    // The `reaction` parks the hit's damage on a pending prompt for the owner to halve.
    "uncanny-dodge": {
      actions: [
        {
          id: "uncanny-dodge",
          name: "Uncanny Dodge",
          activation: "reaction",
          description:
            "When an attacker you can see hits you with an attack roll, you can take a Reaction to halve the attack's damage against you (round down).",
          damage: [],
          reaction: { trigger: "hit-by-attack", response: "half-damage" }
        }
      ]
    },

    "slippery-mind": {
      grants: { saves: ["wis", "cha"] }
    },
    // "No attack roll can have Advantage against you unless you have the Incapacitated condition."
    elusive: {
      modifiers: [
        {
          type: "advantage-denied",
          roll: "incoming-attack",
          when: [{ type: "while-condition", conditionIds: ["incapacitated"], present: false }]
        }
      ]
    },

    "epic-boon": {
      choice: { kind: "feat", choose: 1, fromCatalog: "feats" }
    },

    // "If you fail a D20 Test, you can turn the roll into a 20", once per Short or Long Rest.
    "stroke-of-luck": {
      uses: { limit: 1, per: "short-rest" },
      actions: [
        {
          id: "stroke-of-luck",
          name: "Stroke of Luck",
          activation: "other",
          description: "When you fail a D20 Test, turn the d20 roll into a 20.",
          damage: [],
          answer: {
            rolls: ["attack", "save", "check", "death-save"],
            when: "failure",
            effect: { kind: "set-d20", face: 20 }
          }
        }
      ]
    }
  },
  subclasses: {
    thief: {
      // The fourth attunement is read when an item is attuned; the charge and Spell Scroll clauses stay prose.
      "use-magic-device": {
        modifiers: [{ type: "attunement-slots", amount: 1 }]
      },
      // "You gain a Climb Speed equal to your Speed" and "can determine your jump distance using your Dexterity
      // rather than your Strength", which the movement rules read (`jumping.ts`).
      "second-story-work": {
        modifiers: [
          { type: "special-speed", movement: "climb", equalToSpeed: true },
          { type: "movement", rule: "jump-by-dexterity" }
        ]
      },
      // Adds the Bonus Action activation; the Sleight of Hand check is rolled from the skill block.
      "fast-hands": {
        actions: [
          {
            id: "fast-hands",
            name: "Fast Hands",
            activation: "bonus-action",
            description:
              "As a Bonus Action you can either make a Dexterity (Sleight of Hand) check to pick a lock or disarm a trap with Thieves' Tools or to pick a pocket, or take the Utilize action (or the Magic action to use a magic item that requires it).",
            damage: []
          }
        ]
      }
    }
  }
};
