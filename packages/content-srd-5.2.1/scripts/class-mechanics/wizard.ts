/**
 * Wizard mechanics - the HAND_AUTHORED half of the overlay for this class and for Evoker.
 *
 * `classes.v1.json` carries this class's PROSE (the ETL copies the record through
 * verbatim); this overlay is merged on top of it and may only ADD.
 *
 * Stage 4 lane B4. Author here and nowhere else: this file is the only place a Wizard
 * rider, pick, or option mechanic belongs, so two authors working on two classes never touch one
 * file. See `./overlay.ts` for what a `FeatureMechanics` may carry and `./index.ts` for the merge.
 *
 * ADDITIVE-ONLY, AND THAT IS A PROPERTY OF THE CLASS, NOT A STYLE. For the three HAND_AUTHORED
 * classes the bundle is the ETL's own input *and* its output, so a rider written into
 * `classes.v1.json` stays there even if this file stops naming it - deleting one means deleting it
 * from the JSON too and rebuilding. `applyMechanics` refuses to overwrite a value the record already
 * carries and fails the build naming both homes, so the six features that already hold a `choice`
 * and the two that already hold `uses` are simply not restated here.
 *
 * WHY THIS FILE IS SHORT, and it is the honest answer rather than an unfinished one: Wizard is the
 * one class in the audit with NO rows (`stage-4-authoring-assignments.md` §3), because the
 * hand-authored record already carries Arcane Recovery's counter, Overchannel's counter, and a
 * `choice` on Scholar, the subclass, the ASI, Spell Mastery, the Epic Boon and Signature Spells.
 * What was left is one missing counter and a run of features whose mechanics this vocabulary cannot
 * say - each named at the bottom with the reason, so the absences read as decisions.
 */
import type { ClassMechanicsModule } from "./overlay.js";

export const wizard: ClassMechanicsModule = {
  features: {
    /**
     * SIGNATURE SPELLS - the one counter the hand-authored record was missing.
     *
     * "You can cast each of them once at level 3 without expending a spell slot. Once you do so, you
     * can't cast that spell in this way again until you finish a Short or Long Rest." Two free
     * castings that come back on a Short Rest: `per: "short-rest"` is exactly the printed recovery,
     * and a Long Rest clears every pool anyway (`applyRest`), so both halves of "Short or Long" land
     * from the one authored value. The `choice` that picks the two spells is already on the record
     * and is deliberately not restated here.
     *
     * WHAT THE COUNTER LOSES, precisely: `uses` is ONE counter, so a Wizard could spend both free
     * castings on the same signature spell where the SRD gives each spell its own. The TOTAL is
     * right - two free level-3 castings per rest - and only the distribution is unconstrained, which
     * is a much smaller error than the Monk's rule refuses (a use that costs more than one debits
     * the player the wrong amount and hands them a multiple of the printed resource). Two counters
     * on one feature is not expressible, the description carries the restriction, and a GM reading
     * the sheet sees both.
     */
    "signature-spells": { uses: { limit: 2, per: "short-rest" } }
    /*
     * THE NINE CLASS RECORDS LEFT AS PROSE, named so each absence is a decision:
     *
     *   spellcasting, ritual-adept  - the spellbook is a second spell list beside the prepared list,
     *                                 and Ritual casting is a casting-time rule. Neither is modelled
     *                                 at all; both records already carry `tags: ["spellcasting"]`.
     *   arcane-recovery             - the counter is already authored. HOW MANY slot levels it
     *                                 returns is the printed `arcane-recovery` column, and nothing in
     *                                 the vocabulary restores a spell slot - `spell-slot` is a
     *                                 MAXIMUM rider, not a refund. Same absence as the Warlock's
     *                                 Magical Cunning.
     *   scholar, wizard-subclass,
     *   ability-score-improvement,
     *   epic-boon                   - each already carries its `choice` on the hand-authored record.
     *   memorize-spell              - Stage-4 ruling A: "whenever you finish a Short Rest ... replace
     *                                 one of the Wizard spells you have prepared" is a replacement
     *                                 clause with a rest timing. Runtime state, specified and not
     *                                 built; author nothing, leave the sentence printed.
     *   spell-mastery               - at will, so there is no counter to author. Its PICK has a real
     *                                 flaw and it is NOT closable from here: the text is "choose a
     *                                 level 1 AND a level 2 spell", which is two picks with two
     *                                 different ceilings - ruling B's `choices: [...]`, exactly the
     *                                 shape that fixed Magic Initiate. `overlay.ts`'s
     *                                 `FeatureMechanics` exposes `choice` and not `choices`, so a
     *                                 class module cannot say it, and `overlay.ts` is frozen for
     *                                 Stage 4. Reported as blocked rather than approximated.
     */
  },
  subclasses: {
    evoker: {}
    /*
     * ALL FIVE EVOKER RECORDS STAY AS THEY ARE, and four of them for reasons worth writing down:
     *
     *   evocation-savant   - the `choice` is already on the hand-authored record, but it says
     *                        "two Wizard spells FROM THE EVOCATION SCHOOL". `FeatureChoiceSchema` has
     *                        `maxSpellLevel` and no school filter, so the shipped pick is level-capped
     *                        and school-blind. Not closable here; the prose names the school.
     *   potent-cantrip     - "the creature takes half the damage on a successful save" is a rule about
     *                        every cantrip the Wizard casts, and `ActionSchema.save` is `{ability, dc}`
     *                        with no half-on-save field at all. Nothing to hang it on.
     *   sculpt-spells      - chosen creatures automatically succeed on their saves. There is no rider
     *                        that edits another creature's save outcome.
     *   empowered-evocation - "add your Intelligence modifier to one damage roll of any Wizard
     *                        Evocation spell you cast" is Agonizing Blast's shape and is blocked
     *                        TWICE. (1) `ExtraDamageVariantSchema` REQUIRES `damageType`, and the
     *                        type here is whatever the spell deals - Fireball is Fire, Lightning Bolt
     *                        is Lightning - so any authored constant is wrong for most castings; the
     *                        variant has no "same type as the triggering damage" form. (2) The only
     *                        gate that could mean "an Evocation spell" is `spell-school-is`, and
     *                        `RiderContext.spellSchool` is declared in `rules-5e/src/riders.ts` and
     *                        set by NO producer, so the filter fails closed and the rider would ship
     *                        inert. Both are reported as vocabulary gaps rather than approximated.
     *   overchannel        - its once-per-Long-Rest counter is already authored on the record. The
     *                        "maximum damage" half has no rider, and the escalating Necrotic backlash
     *                        is a second, differently-shaped cost on the same feature.
     */
  }
};
