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
 * carries and fails the build naming both homes, so the five features that already hold a `choice`
 * and the two that already hold `uses` are simply not restated here. The one EXCEPTION is Spell
 * Mastery, whose `choice` this file supersedes through `clears` - the verb ruled 2026-08-10 for
 * exactly that, and the only authorable way past the additive-only rule.
 *
 * WHY THIS FILE IS SHORT, and it is the honest answer rather than an unfinished one: Wizard is the
 * one class in the audit with NO rows (`stage-4-authoring-assignments.md` §3), because the
 * hand-authored record already carries Arcane Recovery's counter, Overchannel's counter, and a
 * `choice` on Scholar, the subclass, the ASI, the Epic Boon and Signature Spells. What was left is
 * one missing counter, Spell Mastery's two-window pick, and a run of features whose mechanics this
 * vocabulary cannot say - each named at the bottom with the reason, so the absences read as decisions.
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
    "signature-spells": { uses: { limit: 2, per: "short-rest" } },

    /**
     * SPELL MASTERY - one pick of two becomes two picks of one, and this is what `clears` is for.
     *
     * The printed text is "Choose a level 1 AND a level 2 spell in your spellbook that have a casting
     * time of an action." The hand-authored record said
     * `{ kind: "spell", choose: 2, fromCatalog: "wizard-spells", maxSpellLevel: 2 }` - ONE pick of two
     * under a single ceiling of 2 - so two level-1 spells was a legal build, and so was two level-2
     * spells. Neither is what the Wizard is owed. Two blocks with two different windows is the shape,
     * and it is the same one that fixed Magic Initiate ("a cantrip AND a level 1 spell").
     *
     * WHY `clears`, and it is the whole reason the verb was ruled (decision-log, 2026-08-10). Wizard is
     * HAND_AUTHORED, so `classes.v1.json` is the ETL's input AND its output and the overlay may only
     * ADD: `applyMechanics` refuses to overwrite the `choice` already on the record. Writing `choices`
     * beside it does not dodge that either - `oneChoiceForm` refuses a record carrying both forms, so
     * the build would fail at `ClassReferenceSchema.parse` instead of merging. `clears: ["choice"]`
     * deletes the superseded key before the merge, which is the one authorable way to say "the list
     * beside this replaces it". The delete is ONE-WAY into committed JSON - review the bundle's `git
     * diff` in this same commit, which is the ruling's third mitigation.
     *
     * `choose: 1` twice rather than `choose: 2` once: the capacity is per BLOCK, so the level-2 window
     * cannot be spent on a second level-1 spell. The floor is what carries the "and" - `minSpellLevel`
     * is the Mystic Arcanum precedent ("a level 6 Warlock spell" is exactly 6, not "6 or lower"), and
     * without it on the second block the pair collapses back into one ceiling and the bug returns.
     *
     * NOT AUTHORED, so the absence reads as a decision: "in your spellbook" and "that have a casting
     * time of an action" are both unsayable here. `FeatureChoiceSchema` has no casting-time filter and
     * the spellbook is not modelled as a list separate from the prepared one (see `spellcasting` in
     * the prose block below), so the pick is level-windowed and blind to both. The description carries
     * the restrictions and a GM reading the sheet sees them.
     */
    "spell-mastery": {
      // `choices` clears ITSELF, and that is not a typo. For a hand-authored class the bundle is the
      // ETL's own input, so once this overlay has run once the record carries `choices` — and
      // `applyMechanics` refuses to overwrite a key already on the record when the value DIFFERS
      // (JSON.stringify compare). So the first author needed `clears: ["choice"]` and every later
      // CHANGE to the authored value needs `choices` in the list too, or the build fails with
      // `wizard.spell-mastery.choices (already authored on the record - remove it from one of the
      // two homes)`. Clearing then re-authoring an identical value is still a byte-identical no-op,
      // so idempotency is unaffected. `choice` stays in the list: it is a no-op now, but it is what
      // supersedes the original hand-authored form if this record is ever rebuilt from one.
      clears: ["choice", "choices"],
      choices: [
        // BOTH blocks are FLOORED as well as capped, and the floor on the first one is not
        // decoration. `wizard-spells` resolves to all 218 wizard spells, 15 of them CANTRIPS, and
        // `withinSpellWindow` is a plain min/max check - so a block reading `maxSpellLevel: 1` with
        // no floor accepts a level-0 cantrip as "a level 1 spell". Measured: fire-bolt + acid-arrow
        // built clean before this floor existed. The client's picker filters cantrips out of a
        // `kind: "spell"` block (build-payload.ts:459), which is exactly why the floor has to live
        // HERE - the server is the authority and it was not enforcing what the printed text says.
        { kind: "spell", choose: 1, fromCatalog: "wizard-spells", minSpellLevel: 1, maxSpellLevel: 1 },
        { kind: "spell", choose: 1, fromCatalog: "wizard-spells", minSpellLevel: 2, maxSpellLevel: 2 }
      ]
    }
    /*
     * THE EIGHT CLASS RECORDS LEFT AS PROSE, named so each absence is a decision:
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
     *
     * `spell-mastery` used to be a ninth entry here, reported as blocked because `overlay.ts`'s
     * `FeatureMechanics` "exposes `choice` and not `choices`" and `overlay.ts` was "frozen for Stage
     * 4". Both halves of that reason are dead: `choices` is on `FeatureMechanics`, and `clears`
     * (ruled 2026-08-10) is the home for superseding a hand-authored key. It is authored above.
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
