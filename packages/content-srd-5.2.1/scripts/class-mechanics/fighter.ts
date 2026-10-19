/**
 * Fighter and Champion mechanics. Fighter is hand-transcribed in `sources/authored/classes.json`;
 * riders already there are not restated here.
 */
import type { ClassMechanicsModule } from "./overlay.js";

/** "Your attack rolls with weapons and Unarmed Strikes": read when the attack is rolled, against its kind. */
const WEAPON_OR_UNARMED_ATTACK = [
  { type: "on-attack-roll" as const },
  { type: "attack-kind-is" as const, kinds: ["weapon" as const, "unarmed" as const] }
];

export const fighter: ClassMechanicsModule = {
  features: {
    // "You regain one expended use when you finish a Short Rest, and you regain all expended uses when you finish a
    // Long Rest."
    "second-wind": {
      modifiers: [{ type: "short-rest-regain", poolId: "second-wind", amount: 1 }]
    },

    // "When you fail an ability check, you can expend a use of Second Wind ... Roll 1d10 and add it to the check. If the
    // check still fails, this use of Second Wind isn't expended." The uses are Second Wind's own pool.
    "tactical-mind": {
      uses: {
        per: "long-rest",
        pool: "second-wind",
        scaling: {
          type: "by-level",
          table: [
            { level: 1, limit: 2 },
            { level: 4, limit: 3 },
            { level: 10, limit: 4 }
          ]
        }
      },
      actions: [
        {
          id: "tactical-mind",
          name: "Tactical Mind",
          activation: "other",
          description:
            "When you fail an ability check, expend a use of Second Wind to roll 1d10 and add it to the check. If the check still fails, the use isn't expended.",
          damage: [],
          answer: { rolls: ["check"], when: "failure", effect: { kind: "add", amount: "1d10", keepUseOnFailure: true } }
        }
      ]
    },

    // "If you fail a saving throw, you can reroll it with a bonus equal to your Fighter level. You must use the new roll."
    indomitable: {
      actions: [
        {
          id: "indomitable",
          name: "Indomitable",
          activation: "other",
          description:
            "When you fail a saving throw, reroll it with a bonus equal to your Fighter level. You must use the new roll.",
          damage: [],
          adds: { classLevel: 1 },
          answer: { rolls: ["save", "death-save"], when: "failure", effect: { kind: "reroll" } }
        }
      ]
    },
    // "Whenever you gain a Fighter level, you can replace the feat you chose with a different Fighting Style feat."
    "fighting-style": { replaces: [{ offer: "feature:fighting-style", when: "level-up", amount: 1 }] },
    // Weapon Mastery grows with the printed column: 3 -> 4 at level 4 -> 5 at 10 -> 6 at 16. Its Long Rest change of
    // one weapon is made in the Level flow until a rest offers it.
    "weapon-mastery": {
      extraPicks: [
        { offer: "feature:weapon-mastery", scaling: { type: "class-resource-growth", id: "weapon-mastery" } }
      ],
      replaces: [{ offer: "feature:weapon-mastery", when: "level-up", amount: 1 }]
    },
    // "If you make an attack roll against a creature and miss, you have Advantage on your next attack roll against
    // that creature before the end of your next turn": the miss leaves a `studied` mark (resolution/studied.ts) that
    // this reads and the next attack roll against that creature spends.
    "studied-attacks": {
      modifiers: [
        {
          type: "roll-mode",
          roll: "attack",
          mode: "advantage",
          when: [{ type: "on-attack-roll" }, { type: "versus-marked", tags: ["studied"] }]
        }
      ]
    }
    // Not modeled: Tactical Mind (retroactive check bonus with a refund), Tactical Shift and Tactical
    // Master (movement, mastery swap).
  },
  subclasses: {
    champion: {
      /**
       * Crit on 19-20 with weapons and Unarmed Strikes (spells excluded). `criticalThreshold` takes the lowest threshold
       * any carrier names, so this and Superior Critical compose to 18-20 at level 15.
       */
      "improved-critical": {
        modifiers: [{ type: "critical-range", threshold: 19, when: WEAPON_OR_UNARMED_ATTACK }]
      },
      /**
       * Crit on 18-20. The builder honours `replacesFeatureId` only for class features, so the sheet
       * lists both traits; the lower threshold wins either way.
       */
      "superior-critical": {
        modifiers: [{ type: "critical-range", threshold: 18, when: WEAPON_OR_UNARMED_ATTACK }]
      },
      /**
       * "You have Advantage on Initiative rolls and Strength (Athletics) checks." The check half fires via
       * `ability-checks.ts` (e.g. Escape a Grapple with Athletics). The move-after-a-crit clause is prose.
       */
      // Defy Death: "You have Advantage on Death Saving Throws." Heroic Rally's hit points each turn while Bloodied
      // are turn-boundaries.ts's.
      survivor: {
        modifiers: [{ type: "roll-mode", roll: "death-save", mode: "advantage" }]
      },
      "remarkable-athlete": {
        modifiers: [
          { type: "roll-mode", roll: "initiative", mode: "advantage" },
          {
            type: "roll-mode",
            roll: "check",
            mode: "advantage",
            when: [
              { type: "on-ability-check" },
              { type: "ability-is", abilities: ["str"] },
              { type: "skill-is", skills: ["athletics"] }
            ]
          }
        ]
      }
      // Heroic Warrior is applied at the start of the Champion's turn (`turn-boundaries.ts`), by its feature id.
      // Not modeled: Survivor (Bloodied regen, death-save advantage has no reader). Additional Fighting Style's
      // choice is already on the record.
    }
  }
};
