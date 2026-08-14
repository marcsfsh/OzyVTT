/**
 * Fighter mechanics - the HAND_AUTHORED half of the overlay for this class and for Champion.
 *
 * `classes.v1.json` carries this class's PROSE and `subclasses.v1.json` carries Champion's (the ETL
 * copies the records through verbatim); this overlay is merged on top of them. It may only ADD -
 * **except where an entry says `clears`**, which is the ruled verb for superseding a key the record
 * already carries, and `champion.remarkable-athlete` uses it (see its entry for why and for the
 * build error that forces it).
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
      /**
       * "...can now score a Critical Hit on a roll of 18-20." The lower threshold simply wins.
       *
       * The record carries `replacesFeatureId: "improved-critical"`, and the builder honours that
       * only for CLASS features (`grantedClassFeatures`) - a level-15 Champion holds both subclass
       * records. It changes nothing here, because `criticalThreshold` takes the lowest threshold any
       * carrier names either way; it does mean the sheet lists both traits.
       */
      "superior-critical": {
        modifiers: [{ type: "critical-range", threshold: 18 }]
      },
      /**
       * "You have Advantage on Initiative rolls and Strength (Athletics) checks."
       *
       * **BOTH HALVES ARE AUTHORED SINCE 2026-08-13, AND THE SECOND ONE IS A HARVEST.** This entry
       * used to read *"Nothing anywhere reads `roll-mode {roll: "check"}` ... so authoring the
       * Athletics half would ship a rider that parses, stores and does nothing"*, and that is now
       * false: `apps/server/src/ability-checks.ts` is the consumer, called from both places
       * `action-resolution.ts` throws a check's d20.
       *
       *   - INITIATIVE: `encounter.ts` `initiativeRollMode` reads `roll-mode {roll: "initiative"}`
       *     off the carriers, unchanged.
       *   - STRENGTH (ATHLETICS): Escape a Grapple narrows to `{ability: "str", skill: "athletics"}`
       *     whenever Athletics beats Acrobatics on the bearer's sheet, which is EXACTLY the printed
       *     clause - so the three-trigger narrowed form fires there and, because `ability-is` and
       *     `skill-is` both fail closed, on none of the other four checks. It is the same 1:1 shape
       *     `boots-of-elvenkind` has on Hide, on the other side of the vocabulary.
       *
       * The move-after-a-crit clause is movement and stays prose.
       *
       * WHY `clears`, and it is the second use of the verb in this package (Wizard's Spell Mastery is
       * the first, and its entry carries the full reasoning). Fighter is HAND_AUTHORED, so this
       * record's `modifiers` array is already in `bundles/subclasses.v1.json` carrying the initiative
       * rider - and the overlay REFUSES to overwrite a key that is already there. Measured, by
       * running the build without this line:
       *     Mechanics overlay keys matching no feature (1):
       *       champion.remarkable-athlete.modifiers (already authored on the record - remove it from
       *       one of the two homes)
       * `clears: ["modifiers"]` announces the supersession: the array is deleted and the TWO riders
       * below replace it in the same entry, which is what mitigation 2 ("never delete-only, per key")
       * requires. Idempotent on every later build, because the entry re-supplies the same key. The
       * review bar is the `git diff` of `bundles/subclasses.v1.json` in this commit: one modifier in,
       * nothing out.
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
      /**
       * NOT AUTHORED: `heroic-warrior` grants Heroic Inspiration, which is not modelled anywhere on
       * the actor; `survivor`'s regeneration is a start-of-turn heal gated on Bloodied, and its
       * Death-Save advantage would be `roll-mode {roll: "death-save"}` - a form that is still
       * unread, and it did NOT come with the `check` form above: `deathSaveRollMode` does not exist
       * and `rollDeathSave` (`death-saves.ts`) takes no carriers. `additional-fighting-style`
       * already carries its own catalog choice in the bundle.
       */
    }
  }
};
