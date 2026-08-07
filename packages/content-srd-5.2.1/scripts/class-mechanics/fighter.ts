/**
 * Fighter mechanics - the HAND_AUTHORED half of the overlay for this class and for Champion.
 *
 * `classes.v1.json` carries this class's PROSE (the ETL copies the record through
 * verbatim); this overlay is merged on top of it and may only ADD.
 *
 * Stage 4 lane B1. Author here and nowhere else: this file is the only place a Fighter
 * rider, pick, or option mechanic belongs, so two authors working on two classes never touch one
 * file. See `./overlay.ts` for what a `FeatureMechanics` may carry and `./index.ts` for the merge.
 */
import type { ClassMechanicsModule } from "./overlay.js";

export const fighter: ClassMechanicsModule = {
  features: {
    /**
     * WEAPON MASTERY, as many as the printed column says: 3 -> 4 (L4) -> 5 (L10) -> 6 (L16).
     *
     * Fighter is HAND_AUTHORED and that did not save it - the gap was in the vocabulary, not in who
     * typed the record. This is also the proof that the overlay now reaches the hand-authored three:
     * `classes.v1.json` carries the prose and the `choose: 3`, and this line carries the growth.
     */
    "weapon-mastery": {
      extraPicks: [{ offer: "feature:weapon-mastery", scaling: { type: "class-resource-growth", id: "weapon-mastery" } }]
    }
    /**
     * THE FIGHTER'S CLASS FEATURES ARE OTHERWISE DONE, and the four that are not are not authorable:
     *
     *   - `tactical-mind` spends a Second Wind use to add 1d10 to an ALREADY-FAILED ability check,
     *     and refunds the use if the check still fails. Neither the retroactive add nor the refund
     *     has any vocabulary; `uses` counts down, it does not count back.
     *   - `tactical-shift` and `tactical-master` are movement and a weapon-property swap. There is no
     *     movement rider at all, and mastery properties are resolved from the weapon record.
     *   - `studied-attacks` grants Advantage on the NEXT attack after a miss against that same
     *     creature. `roll-mode` has moments but no memory of the previous roll's target.
     *
     * All four are already whole prose on the sheet, which is the correct place for them (ADR-0008).
     */
  },
  subclasses: {
    champion: {
      /**
       * "Your attack rolls with weapons and Unarmed Strikes can score a Critical Hit on a roll of
       * 19 or 20 on the d20."
       *
       * `critical-range` is read by `effective-actions.ts`'s `criticalThreshold`, which takes the
       * LOWEST threshold any carrier names - so this and Superior Critical below compose to 18 at
       * level 15 with no replacement clause and no ordering rule. Left ungated on purpose: a
       * Champion's attacks are weapon or unarmed attacks, and `attack-kind-is` would be a filter that
       * excludes nothing while adding a moment the standing pass would then skip.
       */
      "improved-critical": {
        modifiers: [{ type: "critical-range", threshold: 19 }]
      },
      /** "...can now score a Critical Hit on a roll of 18-20." The lower threshold simply wins. */
      "superior-critical": {
        modifiers: [{ type: "critical-range", threshold: 18 }]
      },
      /**
       * "You have Advantage on Initiative rolls and Strength (Athletics) checks."
       *
       * ONLY THE INITIATIVE HALF IS AUTHORED, and that is the point of writing it down: `encounter.ts`
       * `initiativeRollMode` reads `roll-mode {roll: "initiative"}` off the carriers, so this rider
       * changes the dice. Nothing anywhere reads `roll-mode {roll: "check"}` - `actor-derived.ts`
       * folds `check-bonus` into the sheet's numbers and has no advantage channel - so authoring the
       * Athletics half would ship a rider that parses, stores and does nothing, which is the exact
       * failure this vocabulary exists to end. It stays prose until a consumer exists.
       *
       * The move-after-a-crit clause is movement and stays prose too.
       */
      "remarkable-athlete": {
        modifiers: [{ type: "roll-mode", roll: "initiative", mode: "advantage" }]
      }
      /**
       * NOT AUTHORED: `heroic-warrior` grants Heroic Inspiration, which is not modelled anywhere on
       * the actor; `survivor`'s regeneration is a start-of-turn heal gated on Bloodied, and its
       * Death-Save advantage would be `roll-mode {roll: "death-save"}`, which - like the `check`
       * form above - no consumer reads. `additional-fighting-style` already carries its own catalog
       * choice in the bundle.
       */
    }
  }
};
