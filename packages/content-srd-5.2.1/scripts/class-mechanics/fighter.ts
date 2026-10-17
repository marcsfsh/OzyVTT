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
    // Weapon Mastery grows with the printed column: 3 -> 4 at level 4 -> 5 at 10 -> 6 at 16.
    "weapon-mastery": {
      extraPicks: [
        { offer: "feature:weapon-mastery", scaling: { type: "class-resource-growth", id: "weapon-mastery" } }
      ]
    }
    // Not modeled: Tactical Mind (retroactive check bonus with a refund), Tactical Shift and Tactical
    // Master (movement, mastery swap) and Studied Attacks (needs memory of the missed target).
  },
  subclasses: {
    champion: {
      /**
       * Crit on 19-20 with weapons and Unarmed Strikes, not spells. `criticalThreshold` takes the lowest threshold
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
