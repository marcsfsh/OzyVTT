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
     * The printed column stays display-only: "6d6" is dice to roll.
     */
    "sneak-attack": {
      uses: { limit: 1, per: "turn", pool: "sneak-attack" },
      actions: [
        {
          id: "sneak-attack",
          name: "Sneak Attack",
          activation: "other",
          description:
            "Once per turn, deal this extra damage to one creature you hit with an attack roll, if you have Advantage on the roll (or an ally is within 5 feet of the target, that ally isn't Incapacitated, and you don't have Disadvantage) and the attack uses a Finesse or a Ranged weapon. The extra damage's type is the same as the weapon's. Add it when you confirm a qualifying hit.",
          damage: [],
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

    "epic-boon": {
      choice: { kind: "feat", choose: 1, fromCatalog: "feats" }
    },

    // The counter only; turning a failed D20 Test into a 20 is not expressible.
    "stroke-of-luck": {
      uses: { limit: 1, per: "short-rest" }
    }
  },
  subclasses: {
    thief: {
      // The fourth attunement is read when an item is attuned; the charge and Spell Scroll clauses stay prose.
      "use-magic-device": {
        modifiers: [{ type: "attunement-slots", amount: 1 }]
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
