/**
 * Cleric mechanics - the HAND_AUTHORED half of the overlay for this class and for Life Domain.
 *
 * `classes.v1.json` carries this class's PROSE (the ETL copies the record through
 * verbatim); this overlay is merged on top of it and may only ADD.
 *
 * Stage 4 lane B3. Author here and nowhere else: this file is the only place a Cleric
 * rider, pick, or option mechanic belongs, so two authors working on two classes never touch one
 * file. See `./overlay.ts` for what a `FeatureMechanics` may carry and `./index.ts` for the merge.
 *
 * ADDITIVE ONLY, and this class is the reason the rule exists. `classes.v1.json` is both this
 * script's input and its output, so an overlay entry written into it STAYS there even if the entry
 * here is deleted - removing a Cleric rider means removing it from the bundle too and rebuilding.
 * `applyMechanics` refuses to overwrite a value the record already carries and fails the build
 * naming both homes, which is why `divine-order`, `blessed-strikes`, `channel-divinity` and the four
 * Life Domain spell tiers are NOT restated here: they are already on the record.
 */
import type { ClassMechanicsModule } from "./overlay.js";

export const cleric: ClassMechanicsModule = {
  features: {
    "divine-order": {
      options: {
        /**
         * "You know one extra cantrip from the Cleric spell list."
         *
         * THE RECORD THAT STARTED THIS AREA. A Cleric who chose Thaumaturge was still capped at
         * three cantrips, because the wizard read the offer's capacity solely off the printed level
         * row. `extraPicks` is the vocabulary that lets a feature reach that number, and `offer` is
         * the offer key both sides already share verbatim.
         *
         * It lived in `classes.v1.json` as a hand edit until the overlay learned to reach an inline
         * OPTION - which is the one shape `FeatureMechanics` could not express, and the reason
         * Cleric's fix had to be hand-edited into a generated artifact in the first place.
         *
         * WHAT STAYS PROSE: the Arcana/Religion bonus ("equals your Wisdom modifier, minimum +1") is
         * an ability-derived check bonus with a floor, and `check-bonus` takes a flat integer.
         */
        thaumaturge: { extraPicks: [{ offer: "class-cantrips", amount: 1 }] }
      }
    },

    /**
     * DIVINE INTERVENTION - the once-per-long-rest pool was already on the record; this gives it the
     * activation the SRD prints.
     *
     * The feature carried `uses` and no `actions`, so the builder synthesised one - correctly, since
     * a pool with no trigger cannot be spent at the table - but a synthesised action is always
     * `activation: "other"`, and the SRD says "As a Magic action". Authoring the action names the
     * economy it really costs, and the feature's own `uses` still ride it (the builder attaches them
     * whenever the action declares none of its own), so the pool key is unchanged.
     *
     * WHAT STAYS PROSE: choosing the spell. "Choose any Cleric spell of level 5 or lower that
     * doesn't require a Reaction to cast" is picked when the feature is USED, not when the character
     * is built, so it is not a `choice` - a build-time pick would freeze at level 10 the one spell a
     * Cleric may ever intervene with. Greater Divine Intervention (level 20: _Wish_, then 2d4 Long
     * Rests) is the same use-time decision plus a recharge no rest vocabulary expresses.
     */
    "divine-intervention": {
      actions: [{
        id: "divine-intervention",
        name: "Divine Intervention",
        activation: "action",
        description: "As a Magic action, choose any Cleric spell of level 5 or lower that doesn't require a Reaction to cast. As part of the same action, you cast that spell without expending a spell slot or needing Material components. At level 20 you can choose Wish instead, and if you do you can't use Divine Intervention again until you finish 2d4 Long Rests.",
        damage: []
      }]
    }

    /**
     * NOT AUTHORED, and why. Cleric's audit rows are down to one, and it is blocked by design.
     *
     * `improved-blessed-strikes` (row 63, level 14) - "The option you chose for Blessed Strikes
     * grows more powerful". A rider conditioned on an EARLIER ANSWER is assignments doc S5F:
     * SPECIFIED, NOT BUILT (`choice.options[].requires`), and it is held back because
     * auto-resolving a one-option choice is new client behaviour. Half of it is already delivered
     * anyway: Divine Strike's `damageByLevel` on the record steps 1d8 -> 2d8 at level 14 without any
     * read-back. What is missing is only the Potent Spellcasting half - Temporary Hit Points equal
     * to twice the Wisdom modifier - and nothing in the vocabulary grants temp HP.
     *
     * `sear-undead` (level 5) - "roll a number of d8s equal to your Wisdom modifier". Dice formulas
     * are literal strings (`DiceFormulaSchema`); an ability-scaled dice COUNT has no vocabulary, so
     * authoring it would mean authoring the wrong number.
     *
     * Life Domain's `disciple-of-life`, `blessed-healer` and `supreme-healing` are all healing
     * riders ("+2 plus the spell slot's level", "the maximum number on the dice"), and healing is
     * not in the rider vocabulary at all - the same reason Channel Divinity's healing branch and
     * Preserve Life are prose on records that otherwise carry full mechanics.
     */
  },
  subclasses: { "life-domain": {} }
};
