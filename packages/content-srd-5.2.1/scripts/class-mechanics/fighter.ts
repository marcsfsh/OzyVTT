/**
 * Fighter and Champion mechanics. Fighter is HAND_AUTHORED, so this overlay may only add to the
 * records, except where an entry uses `clears` (`champion.remarkable-athlete`).
 */
import type { ClassMechanicsModule } from "./overlay.js";

export const fighter: ClassMechanicsModule = {
  features: {
    // Weapon Mastery grows with the printed column: 3 -> 4 at level 4 -> 5 at 10 -> 6 at 16.
    "weapon-mastery": {
      extraPicks: [{ offer: "feature:weapon-mastery", scaling: { type: "class-resource-growth", id: "weapon-mastery" } }]
    }
    // Not modeled: Tactical Mind (retroactive check bonus with a refund), Tactical Shift and Tactical
    // Master (movement, mastery swap) and Studied Attacks (needs memory of the missed target).
  },
  subclasses: {
    champion: {
      /**
       * Crit on 19-20. `criticalThreshold` takes the lowest threshold any carrier names, so this and
       * Superior Critical compose to 18-20 at level 15.
       */
      "improved-critical": {
        modifiers: [{ type: "critical-range", threshold: 19 }]
      },
      /**
       * Crit on 18-20. The builder honours `replacesFeatureId` only for class features, so the sheet
       * lists both traits; the lower threshold wins either way.
       */
      "superior-critical": {
        modifiers: [{ type: "critical-range", threshold: 18 }]
      },
      /**
       * "You have Advantage on Initiative rolls and Strength (Athletics) checks." The check half fires via
       * `ability-checks.ts` (e.g. Escape a Grapple with Athletics). The move-after-a-crit clause is prose.
       *
       * `clears` is needed because the record in `subclasses.v1.json` already carries the initiative
       * modifier; both riders are re-supplied here.
       */
      "remarkable-athlete": {
        clears: ["modifiers"],
        modifiers: [
          { type: "roll-mode", roll: "initiative", mode: "advantage" },
          {
            type: "roll-mode", roll: "check", mode: "advantage",
            when: [{ type: "on-ability-check" }, { type: "ability-is", abilities: ["str"] }, { type: "skill-is", skills: ["athletics"] }]
          }
        ]
      }
      // Not modeled: Heroic Warrior (no Heroic Inspiration on the actor) and Survivor (Bloodied regen,
      // death-save advantage has no reader). Additional Fighting Style's choice is already on the record.
    }
  }
};
