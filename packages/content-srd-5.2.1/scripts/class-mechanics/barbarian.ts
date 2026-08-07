/**
 * Barbarian mechanics - the GENERATED half of the overlay for this class and for Path of the Berserker.
 *
 * `build-class-bundle.ts` generates this class's prose from the SRD markdown on every run;
 * this overlay is merged on top of it.
 *
 * Stage 4 lane B1. Author here and nowhere else: this file is the only place a Barbarian
 * rider, pick, or option mechanic belongs, so two authors working on two classes never touch one
 * file. See `./overlay.ts` for what a `FeatureMechanics` may carry and `./index.ts` for the merge.
 */
import type { ClassMechanicsModule } from "./overlay.js";

export const barbarian: ClassMechanicsModule = {
  features: {
    /**
     * RAGE, as the SRD prints it, in the vocabulary the engine already resolves.
     *
     * `uses` reads the printed **Rages** column rather than restating it as a `by-level` table -
     * that is what `scaling: {type: "class-resource"}` exists for, and it is why the barbarian's
     * `rage` column is no longer marked `display: true`: it is now a live pool the engine spends.
     *
     * The action grants the effect, so Rage is entered the way every other self-buff is entered and
     * ends the way every other one ends. `tags: ["raging"]` is the tag `ActionSchema.requiresEffectTag`
     * already gates on, which is how a subclass's while-raging feature will attach later.
     *
     * WHAT STAYS PROSE, deliberately (ADR-0008). Rage Damage scales off a second printed column and
     * the effect vocabulary has no column-scaled `damage-bonus`, so it is not authored here rather
     * than authored wrong. The 10-minute cap, the extend-by-attacking clause and the heavy-armor
     * restriction are likewise judgement calls at the table, and the description carries all of them.
     */
    rage: {
      uses: { scaling: { type: "class-resource", id: "rage" }, per: "long-rest" },
      actions: [{
        id: "rage",
        name: "Rage",
        activation: "bonus-action",
        description: "You enter a Rage: Resistance to Bludgeoning, Piercing and Slashing damage, Advantage on Strength checks and Strength saving throws, and a bonus to Strength-based damage. You can't concentrate or cast spells while raging.",
        damage: [],
        grants: {
          name: "Raging",
          tags: ["raging"],
          duration: { type: "encounter" },
          modifiers: [
            { type: "damage-resistance", damageTypes: ["bludgeoning", "piercing", "slashing"] },
            { type: "roll-mode", roll: "check", mode: "advantage", when: [{ type: "on-ability-check" }, { type: "ability-is", abilities: ["str"] }] },
            { type: "roll-mode", roll: "save", mode: "advantage", when: [{ type: "on-saving-throw" }, { type: "ability-is", abilities: ["str"] }] }
          ]
        }
      }]
    },
    /**
     * WEAPON MASTERY, as many as the printed column says: 2 -> 3 (L4) -> 4 (L10).
     *
     * Same shape as the Fighter's and the Warlock's Invocations; `choose: 2` plus the growth is the
     * printed number at every level. Paladin, Ranger and Rogue are deliberately NOT here: the SRD
     * prints no Weapon Mastery column for them and their text says a flat "two kinds of weapons".
     */
    "weapon-mastery": {
      extraPicks: [{ offer: "feature:weapon-mastery", scaling: { type: "class-resource-growth", id: "weapon-mastery" } }]
    }
  },
  subclasses: { "path-of-the-berserker": {} },
  liveResources: ["rage"]
};
