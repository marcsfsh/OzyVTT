/**
 * C7d - CARRIED WONDROUS ITEMS AND POTIONS. The 95 rows this lane owns: 71 whose bundle `category`
 * is `wondrous-item` and whose `slot` is `wondrous` (the things you carry rather than wear), and 24
 * whose `category` is `consumable` (the potions and oils). Only 15 of the 95 require attunement -
 * the lightest attunement load of the four lanes, and a hint at what follows.
 *
 * **THE 25TH CONSUMABLE, `spell-scroll`, IS NOBODY'S - AND THIS HEADER USED TO SAY IT WAS "C7b's and
 * is already authored there", WHICH IS A FALSE RECORD** (review). C7b authors nothing for it:
 * `WANDS_RODS_RINGS` has 27 keys and `spell-scroll` is not one of them, and
 * `./wands-rods-rings.ts:457-465` is its ABSENCE entry (*"NEEDS: a per-copy spell selection ...
 * UNBLOCKED BY: no unit"*). `./index.ts:32-41` states the same hole correctly in the same commit, and
 * `apps/server/test/item-mechanics-c7d.test.ts` asserts that NEITHER lane claims it - so the guard
 * was right and only this sentence was wrong. The scroll's slot is `consumable`, which both lanes
 * declare, so no lane-level check separates them; what keeps it safe is that neither has an entry.
 * A later author reading the old sentence would have taken the row as covered and left it forever.
 *
 * `bundles/magic-items.v1.json` carries these items' PROSE, parsed from the vendored SRD by
 * `../build-magic-items.ts`, which emits no `modifiers`, `grants`, `casts`, `actions` or `cursed` at
 * all. This file is the other half. See `./overlay.ts`'s header for the seven refusals every lane
 * inherits, and `./worn-wondrous.ts` for the SLOT declaration that keeps C7c and C7d off each
 * other's items now that the shared `wondrous-item` category cannot.
 *
 * ==============================================================================================
 * THE ADMISSION RULE: A RIDER IS AUTHORED ONLY WHERE ITS READER SHIPS **AND PRODUCES THE PRINTED
 * EFFECT.** A rider that reaches a reader and produces the WRONG effect is worse than an
 * unauthored one, because it is invisible until it happens at a table.
 * ==============================================================================================
 *
 * **THIS LANE IS THE MOST ITEMS AND THE LEAST MECHANICS, AND THE ABSENCE LIST IS THE DELIVERABLE.**
 * 18 of 95 rows carry an authored rider; 77 are prose-only records, every one named below with its
 * reason. A lane that quietly authored nothing for seventy items would be indistinguishable from one
 * that forgot, so each of the 77 says which sentence it could not express and what would unblock it.
 * The single largest group is not a vocabulary gap at all - it is D1, below: **a potion is consumed,
 * and "consumed" is unsayable, so not one of the 24 consumables carries a rider.**
 *
 * ----------------------------------------------------------------------------------------------
 * THE READERS THIS LANE CHECKED, one per rider family it authors. Each was driven through the real
 * derivation BEFORE the rider was written, and the number quoted is what came back.
 * `apps/server/test/item-mechanics-c7d.test.ts` re-drives them against the SHIPPED bundle.
 *
 *   `actions` + `uses`    `equipment-derivation.ts:876` `itemAction` synthesises the button. The
 *                         pool is THREE lines, not one, and review split them because this table
 *                         named the wrong two: `useLimitFor` (`action-resolution.ts:174-182`)
 *                         RETURNS the pool's size and refuses nothing; the REFUSAL is `:240-246`,
 *                         which pushes `feature.no-uses-remaining` when `spent >= limit`; `:248` only
 *                         PLANS the spend (`spendUse = { key, per }`), and the DEBIT is `:1259`,
 *                         `attacker.actionUses = {...}`. (`item-riders.test.ts` criterion 4 drives
 *                         all three; C7b's L1 makes the same citation but QUOTES the code at it,
 *                         which is what disambiguated it there and what this copy had dropped.)
 *                         MEASURED on `Pipes of Haunting`: one press leaves
 *                         `actionUses["pipes-of-haunting-charges"]` at **1 of 3**, and the fourth
 *                         press throws *"Play the Pipes: no uses remaining (3/long rest)."*
 *   `actions[].save`      `createPendingSaves` puts a REAL pending save on the target at the
 *                         authored DC, and `conditionFrom` (`saving-throws.ts:96`) reads the
 *                         condition off the action's PROSE - which is why every description below
 *                         keeps the SRD's own condition word verbatim.
 *                         MEASURED: the Pipes produce `{ability: "wis", dc: 15,
 *                         conditionId: "frightened"}`; the Rope of Entanglement produces
 *                         `{ability: "dex", dc: 15, conditionId: "restrained"}`; the Iron Flask
 *                         produces `{ability: "wis", dc: 17, conditionId: null}` - nothing spurious.
 *   `actions[].attack`    `itemAction` resolves `{ability, proficient}` against the bearer.
 *                         MEASURED on `Iron Bands` with Dex 14 / PB 3: `attack.bonus` is
 *                         **5**, which is exactly the SRD's *"your Dexterity modifier plus your
 *                         Proficiency Bonus"*. (The item is `Iron Bands`. This lane called it
 *                         *"Iron Bands of Bilarro"* in three places and SRD 5.2.1 prints no such
 *                         name - the heading is `#### Iron Bands`, "Bilarro" is 2014-era, and the
 *                         shipped row's `name` is what an equipment picker mints. Review corrected
 *                         the module and the test.)
 *   `check-bonus`         `equipment-derivation.ts:778` `checkRiderBonus`, read by
 *                         `actor-derived.ts:94` into the sheet's skill row - **and by NOTHING ELSE.**
 *                         Review measured the consequence and it is a real gap, recorded at
 *                         `stone-of-good-luck-luckstone` below: where the server rolls an ability
 *                         check itself, it does not consult this rider. (Re-measured 2026-08-13,
 *                         after W1's consumer landed on those same two call sites: `roll-mode` now
 *                         reaches that die and `check-bonus` still does not, so the gap narrowed to
 *                         the flat half and did not close.)
 *   `save-bonus`          `saving-throws.ts` `saveRiderBonus`, summed into the save the SERVER rolls
 *                         (`item-riders.test.ts` criterion 12) - not a number the sheet merely shows.
 *                         MEASURED together on `Stone of Good Luck`: every skill row **+1** and
 *                         `saveTotalFor(dex)` **+1**, both back to base when the stone is unattuned.
 *   `casts`               `equipment-derivation.ts:922` `castAction`. Every cast below was driven
 *                         through the real content library first - see D4, which is why so few
 *                         survived, and D7, which emptied two more after they had shipped.
 *
 * ==============================================================================================
 * NINE LIMITS THIS LANE HITS OVER AND OVER, stated once so 77 absences can point at a number. Every
 * one is MEASURED. D4 is C7b's L6 / C7c's W6 and D6 is C7c's W7, restated because between them they
 * account for a third of the list. **D7, D8 and D9 were added by review** - D7 emptied two riders
 * that had already shipped, and D8 and D9 are limits on the whole lane that nothing here recorded.
 * ==============================================================================================
 *
 * D1. **AN ITEM THAT IS CONSUMED CANNOT BE AUTHORED AT ALL, AND THAT EMPTIES ALL 24 CONSUMABLES.**
 *     This is C7c's W5 ("a charge that never comes back is unsayable") arriving at a lane where it
 *     is not an edge case but the rule. `FeatureUsesSchema.per` is
 *     `turn | encounter | short-rest | long-rest` (`src/character-content.ts:86`) and there is no
 *     "never": a pool authored for a potion re-arms on a long rest and hands the table a bottle the
 *     SRD says was drunk. Authoring the action with NO pool is worse - an unlimited button. So
 *     every potion, every oil, every one-use dust, gem and bead is an absence, and the reason is the
 *     same sentence each time. **MEASURED over the committed bundle: 24 of the 24 `consumable` rows
 *     and 12 of the 71 carried wondrous rows are single-use or self-destroying; 36 of 95 in total.**
 *     **Needs: a non-renewing `per` (and, for a potion, a rider that removes the inventory row when
 *     it fires). Unit: NONE YET.**
 *
 * D2. **AN ITEM ACTION CARRIES ONLY `attack`, `save`, `damage` AND `uses`; EVERYTHING ELSE ON IT IS
 *     DROPPED SILENTLY.** `itemAction` (`equipment-derivation.ts:876-900`) builds the `ActorAction`
 *     from `id`, `name`, `activation`, `description`, `attack`, `save`, `damage` and `uses` - and
 *     nothing else. **MEASURED 2026-08-12 by driving an item record whose one action declared
 *     `onHit`, `targetRules`, `spellSlot` and `grants` alongside them: the derived action came back
 *     carrying `attack`, `damage` and `uses` ONLY.** Two consequences this lane lives with:
 *       - `Iron Bands of Bilarro`'s *"On a hit, the target has the Restrained condition"* cannot ride
 *         the attack, so the bands are authored for their to-hit and their daily use and the
 *         Restrained rider is a per-item absence.
 *       - **THE BRIEFED FAR END DIED HERE.** A `Potion of Resistance` would say *"drink it, gain a
 *         timed effect"* as `actions[].grants` - an `EffectGrant` whose `duration` the engine ticks
 *         down. That is the ONE shape in the whole vocabulary that expires, and `itemAction` drops
 *         it. See D3.
 *     **Needs: `grants` and `onHit` carried through `itemAction`. Unit: NONE YET.**
 *
 * D3. **A TYPED RESISTANCE FROM AN ITEM NEVER EXPIRES, SO "FOR 1 HOUR" IS UNSAYABLE.** The other
 *     road to a resistance is the item's own `effects` rider, and `takeEffects`
 *     (`equipment-derivation.ts:585-605`) **does not read `duration` at all**: it lifts the effect's
 *     `damage-resistance` modifier straight into the derivation's `damageResistances`, where it
 *     stands for as long as the item is equipped and active. **MEASURED 2026-08-12: an item whose
 *     one effect declared `duration: {type: "rounds", rounds: 100}` and a fire resistance derived
 *     `damageResistances: [{id: "fire", sourceItemId: ...}]` - a standing grant with no clock on
 *     it.** So a `Potion of Resistance` authored that way would hand its bearer permanent Resistance
 *     for as long as the unopened bottle sat in their pack, which is an over-grant of the loudest
 *     kind (pre-ruling 3) on top of D1's consumption problem. `Potion of Invulnerability`
 *     ("Resistance to all damage" for 1 minute) fails identically and more expensively.
 *     **Needs: an item rider that creates a real `EffectInstance` with a duration - which is D2's
 *     `grants` passthrough. Unit: NONE YET.**
 *
 * D4. A SPELL RECORD'S `damage` AND `attackRoll` COLUMNS DESCRIBE THE SPELL'S TEXT, NOT WHAT ONE
 *     CAST ROLLS - C7b's L6 and C7c's W6, and the reason this lane refuses `casts` almost
 *     everywhere. Every cast that survived was driven through the real library first and produces
 *     **no damage, no attack, and only the save the item's own target genuinely makes**:
 *     `scrying` -> `{wis}` (the target's own save), `sending` and `gate`/`plane-shift` -> nothing at
 *     all. The item supplies the DC with `saveDc`, which is what the printed *"(save DC 17)"* means -
 *     with the correction at the Crystal Ball entry that the authored number is a FLOOR rather than
 *     a fixed value. **MEASURED after D7's removals: FOUR distinct spells across SIX authored rows -
 *     `scrying` on the four Crystal Balls, `gate` and `plane-shift` sharing the Cubic Gate's pool,
 *     and `sending` on the Sending Stones.** (This limit used to say "five spells across five
 *     items", which was wrong in both halves even before the removals; review re-counted it off the
 *     bundle.) `detect-thoughts` and `suggestion` passed D4 and were removed by D7 instead: the
 *     spell records were fine, the printed GATE on the item was not.
 *     UNBLOCKED BY: the two `docs/ai-ledger/known-bugs.md` `[content/spells]` entries.
 *
 * D5. **THE ENGINE READS AN ITEM'S SAVE-OR-DAMAGE SENTENCE AS "HALF ON A SUCCESS", AND MAGIC-ITEM
 *     PROSE DOES NOT MEAN THAT.** `halfOnSuccessFrom` (`saving-throws.ts:81`) is written against the
 *     SRD 2024 STAT-BLOCK phrasing - it returns false only when the text says *"Success: ... no
 *     ..."* - and magic items use the older *"must succeed on a DC 13 Strength saving throw **or**
 *     take 1d4 Bludgeoning damage"* form, where a success takes NOTHING. **MEASURED 2026-08-12 on
 *     the committed prose: the `Decanter of Endless Water`'s geyser sentence returns
 *     `halfOnSuccess: true`, and so does the `Bead of Force`'s.** Authoring either would deal half
 *     damage on a save the SRD says takes none. `Horn of Blasting` is the one item in this lane
 *     whose printed sentence the reader gets RIGHT (*"On a successful save, a creature takes half as
 *     much damage only"* -> `true`), and it is an absence for a different reason (see its entry).
 *     **Needs: `halfOnSuccessFrom` taught the "or take" form, or an explicit field on the action.
 *     Unit: NONE YET.**
 *
 * D6. HEALING IS AN ABSENCE, ALWAYS. `SpellReferenceSchema` has no healing field; a healing spell's
 *     dice live in `damage.roll` with an EMPTY `damage.types`, so `castAction`'s `?? "force"` turns
 *     a cure into a hit. `docs/ai-ledger/known-bugs.md` **[content/spells] There is no healing in
 *     the spell model** is the blocker, and it covers items that heal without casting anything too:
 *     nothing in `featureRiders` restores hit points, and nothing in it grants TEMPORARY hit points
 *     either (`hp.temporary` is live actor state with no rider that writes it).
 *     **MEASURED over this lane's 95 rows: FOUR restore hit points** - `potions-of-healing` (the
 *     grouped `varies` row C6 deliberately kept whole), `potion-of-vitality`, `ioun-stone` (the
 *     pearly white spindle) and `dragon-orb` (a level 9 Cure Wounds off its charge table) - **and
 *     TWO more grant temporary hit points**, `potion-of-heroism` and `bag-of-beans`. All six are
 *     absences and no other reasoning is attempted on them. (The briefing's figure of 19 is not one
 *     this file could reproduce: 17 of the 95 descriptions contain the string "Hit Points" at all,
 *     and most of those are an OBJECT's hit points - a rope's, a tower's, a summoned beast's.)
 *
 * D7. **A CAST WHOSE PRINTED PRECONDITION IS ANOTHER OF THE ITEM'S OWN SPELLS CANNOT BE SAID** -
 *     added by review, and it is the only limit here found AFTER a rider had shipped. The Mind
 *     Reading and Telepathy orbs cast their second spell *"targeting creatures you can see within 30
 *     feet of the spell's sensor"* and *"through the sensor on one of those creatures"* - i.e. only
 *     while a Scrying of theirs is running, and only near ITS sensor. No trigger gates a cast on
 *     another cast being active, and no target filter is relative to a spell's sensor, so the derived
 *     buttons were unconditional. **MEASURED 2026-08-12 over the shipped bundle: the Telepathy orb's
 *     Suggestion derived `save {wis, 17}` + `uses {1, long-rest}` with no prerequisite, and resolving
 *     it put a real `charmed` condition on an arbitrary target in melee.** That is pre-ruling 3's
 *     over-grant, so both riders were REMOVED and both are named absences at their entries; the
 *     orbs' Scrying, which the SRD does print ungated, stays. **Needs: a cast-gated-on-a-cast trigger
 *     and a sensor-relative target filter. Unit: NONE YET.**
 *
 * D8. **NOTHING IN THIS LANE PRODUCES ANYTHING OUTSIDE A RUNNING ENCOUNTER** - added by review, and
 *     it is a limit on the whole lane rather than on one rider. `resolveDefinitionAction`
 *     (`action-resolution.ts:691`) throws *"Start an encounter before resolving actions."*, and the
 *     only out-of-fight surface is the loose `action.use` route (`game-operations.ts:1571-1572`,
 *     whose own comment says it *"touches no combat state at all"*), whose plan comes from
 *     `looseRollPlan` (`tap-routing.ts:68-79`) and is built SOLELY from `attack` and `damage`.
 *     **MEASURED 2026-08-12: `crystal-ball`, `sending-stones`, `gem-of-seeing` and `pipes-of-haunting`
 *     each throw that exact string with the item equipped and the action present in
 *     `effectiveActions`, and `looseRollPlan` returns `[]` for all four.** So 17 of the 18 authored
 *     rows are wholly inert out of combat - and the printed use of most of them (scry a distant
 *     creature, send a message, open a planar portal, peer for 10 minutes of Truesight, call rats
 *     within half a mile, summon an hour-long servant) is not a combat activity at all. The reader
 *     ships; it does not fire at the moment the SRD prints. This is disclosed rather than rolled back
 *     because the failure mode is a button that REFUSES, not one that lies - but two sentences
 *     elsewhere in this file overstated it, and review corrected both: *"what is real and enforced is
 *     that it cannot be used a fourth time in a day"* and a charged item's *"pool SIZE and the
 *     refusal at zero are exact"* are true INSIDE a fight and vacuous outside one.
 *     The eighteenth row is `iron-bands`, and it is worse rather than better - see D9.
 *     **Needs: an out-of-encounter resolution path for item actions. Unit: NONE YET.**
 *     UNBLOCKED BY: `docs/ai-ledger/known-bugs.md` **[content/items] An item action does nothing
 *     outside an encounter**, written up from this measurement.
 *
 * D9. **THE ONE LOOSE-ROUTE LEAK, AND IT SPENDS NO CHARGE.** `iron-bands` is this lane's only
 *     authored action carrying an `attack`, which makes it the only one `looseRollPlan` will build a
 *     roll for - **MEASURED: `[{"formula":"1d20 + 5","purpose":"attack","label":"Throw the Bands"}]`**
 *     - and `game-operations.ts:1571-1572` never touches `actionUses`. So outside an encounter the
 *     bands throw an unlimited number of real +5 attacks where the SRD prints one per dawn. It is an
 *     ENGINE-WIDE shape (any charged attack item, C7b's included) rather than a C7d authoring
 *     mistake, which is why the rider stays and the leak is recorded.
 *     UNBLOCKED BY: the same known-bugs entry as D8, whose second half names this.
 *
 * ----------------------------------------------------------------------------------------------
 * WHERE THIS LANE AUTHORS LESS THAN THE PRINTED TEXT, inherited rather than invented.
 *
 * **THE CHARGE-ALONE RULE, WORDED ONCE FOR BOTH LANES.** `./worn-wondrous.ts` carries the identical
 * paragraph, and review found the two stating the same named rule two different ways after only one
 * of them was corrected - which is the drift the rule exists to prevent. This is the single wording;
 * C7c's copy is the same sentences.
 *
 * **A CHARGED ITEM MAY BE AUTHORED FOR ITS CHARGE ALONE** when (a) the count and the recharge are
 * exactly what the SRD prints, and (b) the half the charge buys is one the GM can already produce at
 * the table - by narrating it, by putting the creature or the portal on the map, or with a command
 * the app already gives them (`setCondition`) - so the unauthored half is *narrated* rather than
 * *lost*. C7b set the precedent on `ring-of-evasion`, C7c uses it on `winged-boots` and
 * `cloak-of-invisibility`; here it carries NINE of the eighteen - the four elemental summons, the
 * `Bag of Tricks`, the `Gem of Seeing`, the `Pipes of the Sewers`, the `Cubic Gate` and the
 * `Iron Bands`. Eight of those nine buy a creature, a portal or a sight the GM narrates; the ninth,
 * the `Iron Bands`, buys the **Restrained** condition, which `setCondition` already applies - and
 * naming that is the correction, because the old wording here (*"something a GM resolves at the
 * table rather than a number the sheet would then be wrong about"*) read as excluding exactly that
 * case while both lanes authored it.
 *
 * **CLAUSE (b) IS A REFUSAL AS OFTEN AS IT IS A PERMISSION, and `Pearl of Power` is the example.**
 * "Take a Magic action to regain one expended spell slot of level 3 or lower. Once you use the
 * pearl, it can't be used again until the next dawn" is a perfect once-per-dawn counter attached to
 * a number the sheet WOULD then be wrong about: the button would spend its charge and the player's
 * slot would not come back. There is no "refund a spent slot" verb (`spell-slot` raises the
 * MAXIMUM, which is a different and permanent thing), so the pearl is an absence. Half of it is
 * worse than none of it - the same lesson `Rod of Resurrection` taught in round 1. C7c's
 * `Periapt of Health` is the other half of the same refusal: healing is dead under D6 and the
 * known-bugs entry behind it, charges or no charges.
 *
 * **AND THE COUNTER IS ONLY REAL IN A FIGHT.** D8 is the limit this paragraph has to be read with:
 * *"what is real and enforced is that it cannot be used a fourth time in a day"* is true INSIDE an
 * encounter and vacuous outside one, because the button cannot be pressed there at all. Review
 * corrected this sentence, which used to close the paragraph as though the ration held everywhere.
 *
 * ----------------------------------------------------------------------------------------------
 * THIS LANE OWNS `cursed` AND AUTHORS NONE, and it is the lane where that had to be checked twice.
 * **MEASURED over the committed bundle: 0 of these 95 rows carry `cursed: true`**, and of the five
 * rows in the whole 268 whose description contains "cursed", the only one that is this lane's is
 * `mysterious-deck` - which is RESERVED (U32) and would fail the schema anyway, since it requires no
 * attunement and `src/schemas.ts:330` refuses a curse on an unattuned item. `Bag of Devouring`,
 * `Potion of Poison` and `Dust of Sneezing and Choking` are all trap items whose whole point is that
 * they are indistinguishable from a benign one, and none is authored: a button labelled "drink the
 * poison" spoils the trap the SRD prints.
 *
 * ----------------------------------------------------------------------------------------------
 * WHAT THIS LANE PRODUCED, as an output rather than a target:
 *
 *   18 of 95 items carry at least one authored rider - **all 18 of them carried wondrous items, and
 *   0 of the 24 consumables** (D1). 77 of 95 are prose-only records. The 77 split - **and the
 *   residual was 39, which made the split sum to 78; review corrected it to 38.** The arithmetic is
 *   shown so it cannot drift again silently: the bundle says 95 rows, 18 authored, 77 absent, of
 *   which 24 are consumables, so the NON-consumable absences are 71 - 18 = **53**, and the five
 *   enumerable groups below take 15 of them.
 *     24  CONSUMABLES, every one of them, for D1 - the biggest single group in any lane so far;
 *      7  the schema or the sheet REFUSES their central mechanic outright (`ability-score`: the
 *         `Potion of Giant Strength`, three manuals and three tomes) - the Potion is one of the 24
 *         above, so this group contributes **6** to the 53;
 *      1  RESERVED for a later unit (U32);
 *      6  HEALING or TEMPORARY HIT POINTS (D6) - four of which are also counted above or below
 *         (three potions among the 24, and `dragon-orb` among the over-grants), so this group
 *         contributes **2**, `ioun-stone` and `bag-of-beans`;
 *      6  OVER-GRANTS - the vocabulary can only say something broader than the printed text
 *         (multi-charge costs, rolled cooldowns, a benefit whose printed drawback is unsayable);
 *     38  no vocabulary at all - containers, vehicles, planar travel, lighting, movement modes,
 *         crafting, and the GM-fiat tables pre-ruling 5 names by hand. This is the RESIDUAL group,
 *         which is why it is the one the correction lands on: 53 - 6 - 1 - 2 - 6 = 38.
 *
 *   **ALL EIGHTEEN carry a per-item absence for a half that is not expressible, stated at the entry.**
 *   This used to say seventeen, with `stone-of-good-luck-luckstone` called *"the ONLY item in this
 *   lane whose entire printed sentence lands ... two riders, two readers, and nothing left over"*.
 *   Review measured the second reader and it is half-connected: see the entry. TWO of the eighteen -
 *   `censer-of-controlling-air-elementals` and `stone-of-controlling-earth-elementals` - used to
 *   carry NO comment at their entry at all, their record living only in the grouped elemental block
 *   500 lines away under abbreviated names; both have one now, because an author editing an entry in
 *   place must be able to see what was left out of it.
 *
 * `apps/server/test/item-mechanics-c7d.test.ts` machine-checks MOST of this against the bundle -
 * **and review narrowed this sentence, which used to claim all of it.** What the test really pins:
 * the 95 rows, the 71/24 category split, the 15 attuned, the lane's declared slots, the scroll
 * belonging to neither lane, the 18 authored BY ID, the 77 remainder, D1's 24-to-0, the 0 curses,
 * and four membership lists (the healing rows, the two D5 rows, the seven ability-score refusals,
 * the reserved and multi-cost rows). What it does NOT pin is the **24 / 7 / 1 / 6 / 6 / 38** split
 * or its sum: those are editorial groupings of the same prose-only rows, so a row can move between
 * them - between the over-grants and the no-vocabulary group in particular - with nothing failing.
 * The one arithmetic claim that IS checkable is pinned: the 77 absences are 24 consumables plus 53
 * carried wondrous, asserted against the bundle.
 */
import type { ItemMechanicsModule } from "./overlay.js";

export const CARRIED_AND_POTIONS: ItemMechanicsModule = {
  // =============================================================================================
  // CARRIED WONDROUS ITEMS - 71 rows, 18 authored. Alphabetical by id, absences inline.
  // =============================================================================================

  /*
   * `apparatus-of-the-crab` - a 500-pound two-seat submersible with its own AC, HP, Speed and ten
   * levers. It is a VEHICLE, and a vehicle is an actor the GM adds to the map, not a rider on the
   * bearer: nothing in `featureRiders` says "this item is a creature you climb inside". Its lever-5
   * claw attack (+8 to hit, 2d6 Bludgeoning) belongs to the apparatus, not to whoever carries it,
   * and L5 could not print that flat +8 on the bearer even if it did. UNBLOCKED BY: a vehicle model.
   * Prose.
   *
   * `bag-of-beans` - a 1d100 table of twenty outcomes, from a Treant to a pyramid. Pre-ruling 5
   * names this shape by hand: GM-fiat prose is the expected outcome and writing it down is the
   * deliverable. Two of its rows are separately blocked - the toadstool grants "5d6 Temporary Hit
   * Points" (D6) and the rainbow eggs "permanently increases its lowest ability score by 1, randomly choosing among
   * equally low scores"
   * (`ability-score`, refused on an item carrier). Its dumped-bean explosion is a DC 15 Dex save for
   * 5d4 Force, which D5 would misread as half-on-success, and D1 destroys the beans that fire it.
   * Prose.
   *
   * `bag-of-devouring` - a trap. "... there is a 50 percent chance that the creature is pulled inside",
   * and a creature that starts its turn inside "is devoured, its body destroyed". A percentage roll
   * and an instant death are both GM adjudication; there is no vocabulary for either, and authoring
   * the container half alone would advertise the trap. Prose.
   *
   * `bag-of-holding` - 500 pounds in 64 cubic feet. `EquipmentReference` carries `weightLb` per row
   * and nothing carries a CAPACITY, so an extradimensional container has no field to fill. The
   * SAME absence covers `handy-haversack`, `efficient-quiver` and `portable-hole`. UNBLOCKED BY: an
   * encumbrance/container model. Prose.
   */

  /**
   * BAG OF TRICKS - "Once three fuzzy objects have been pulled from the bag, the bag can't be used
   * again until the next dawn." The charge-alone shape: three uses a day is exactly what the SRD
   * prints, and what a use buys is a beast off a 1d8 table that the GM puts on the map.
   *
   * ABSENT: which beast. The table is three 1d8 columns keyed to the bag's color (gray, rust, tan),
   * and the bundle keeps ONE row for all three - so even a creature-summoning vocabulary would need
   * the color first. The beast, its initiative slot and its orders stay the GM's.
   */
  "bag-of-tricks": {
    actions: [{
      id: "pull", name: "Pull a Fuzzy Object", activation: "action",
      description: "Pull the fuzzy object from the bag and throw it up to 20 feet. When the object lands, it transforms into a creature determined by rolling on the table for the bag's color. The creature vanishes at the next dawn or when it is reduced to 0 Hit Points. It is Friendly to you and your allies and acts immediately after you on your Initiative count.",
      uses: { limit: 3, per: "long-rest", pool: "bag-of-tricks-charges" }
    }]
  },

  /*
   * `bead-of-force` - "the bead explodes ... and is destroyed. Each creature in the Sphere must
   * succeed on a DC 15 Dexterity saving throw or take 5d4 Force damage." Blocked TWICE over: D1
   * (the bead is destroyed and no `per` says "never", so a pool would re-arm it) and D5 (measured -
   * that sentence returns `halfOnSuccess: true`, so a successful save would still take 2d4 where the
   * SRD gives nothing). Authoring it with no pool at all is an unlimited 5d4 area button. Prose.
   *
   * `bead-of-nourishment` - "provides as much nourishment as 1 day of Rations." There is no hunger
   * model and no ration bookkeeping. Prose.
   */

  /**
   * THE FOUR ELEMENTAL-COMMANDING ITEMS - `bowl-of-commanding-water-elementals` (water),
   * `brazier-of-commanding-fire-elementals` (fire), `censer-of-controlling-air-elementals` (air) and
   * `stone-of-controlling-earth-elementals` (earth), named in full here because two of them have no
   * other record and an author reading this block should be able to find them.
   *
   * All four print the same THREE fragments verbatim - a Magic action summons an elemental that
   * "takes its turn immediately after you on your Initiative count", that "disappears after 1 hour,
   * when it dies, or when you dismiss it as a Bonus Action", and the item "can't be used this way
   * again until the next dawn." **They do NOT print an identical SENTENCE, which this block used to
   * claim** (review): the Stone omits "understands your languages" and places its elemental "in an
   * unoccupied space you choose within 30 feet of yourself" rather than "as close to the [item] as
   * possible". The four authored descriptions are each individually correct against their own row;
   * only the summary was overstated.
   *
   * **AND ALL FOUR AUTHORED DESCRIPTIONS USED TO DROP THE DAWN SENTENCE**, which review restored.
   * The counter enforces it - inside a fight - but the sentence a player reads on the button no
   * longer said so, and D8 is exactly why that matters: outside an encounter the counter cannot be
   * spent at all, so the printed sentence is the ONLY thing telling the table the limit exists.
   *
   * The charge-alone shape, at limit 1, read with D8: the counter is exactly what the SRD prints and
   * it is the half a table gets wrong, and it is real IN A FIGHT. The elemental itself is a stat
   * block the GM adds to the map.
   *
   * ABSENT on all four: the summon. Nothing in `featureRiders` mints an actor, so the elemental, its
   * initiative slot, its one-hour clock and its dismissal are the GM's. UNBLOCKED BY: a summoning
   * vocabulary that can put a content creature on the map. Unit: NONE YET.
   */
  "bowl-of-commanding-water-elementals": {
    actions: [{
      id: "summon", name: "Summon Water Elemental", activation: "action",
      description: "While this bowl is filled with water and you are within 5 feet of it, summon a Water Elemental. It appears in an unoccupied space as close to the bowl as possible, understands your languages, obeys your commands, and takes its turn immediately after you on your Initiative count. It disappears after 1 hour, when it dies, or when you dismiss it as a Bonus Action. The bowl can't be used this way again until the next dawn.",
      uses: { limit: 1, per: "long-rest", pool: "bowl-of-commanding-water-elementals-charges" }
    }]
  },
  "brazier-of-commanding-fire-elementals": {
    actions: [{
      id: "summon", name: "Summon Fire Elemental", activation: "action",
      description: "While you are within 5 feet of this brazier, summon a Fire Elemental. It appears in an unoccupied space as close to the brazier as possible, understands your languages, obeys your commands, and takes its turn immediately after you on your Initiative count. It disappears after 1 hour, when it dies, or when you dismiss it as a Bonus Action. The brazier can't be used this way again until the next dawn.",
      uses: { limit: 1, per: "long-rest", pool: "brazier-of-commanding-fire-elementals-charges" }
    }]
  },

  /*
   * `broom-of-flying` - "It has a Fly Speed of 50 feet." C7c's W2, re-measured there: `speed` is
   * summed into `derivation.speed` and NOTHING reads that field, and a FLY speed is a movement MODE
   * the model does not have at all. The same absence covers `carpet-of-flying` (four sizes, one
   * row) and `horseshoes-of-a-zephyr`. UNBLOCKED BY: a speed/movement-mode model. Prose.
   */

  /*
   * `candle-of-invocation` - "While you are within that light, you have Advantage on D20 Tests."
   * Advantage on EVERY d20 roll, gated on standing inside the light of a lit candle that burns down
   * over four hours. **W1 CLOSED 2026-08-13 AND THIS ROW GOT WORSE, NOT BETTER**: the check half now
   * has a reader, so an unnarrowed `roll: "check"` rider would really fire on Hide, Influence,
   * Search, Study and Escape a Grapple alike - which is the over-grant arriving rather than staying
   * theoretical. The two gaps that block it are untouched: no trigger says "while within an item's
   * light", and a burn-down budget is a duration rather than a use count. Authoring it ungated would
   * hand a very rare candle permanent advantage on everything the engine rolls - pre-ruling 3's
   * over-grant in its purest form. **Needs: a light/area gate, and a duration budget. Unit: NONE
   * YET.** Prose.
   */

  /**
   * CENSER OF CONTROLLING AIR ELEMENTALS - one of the four elemental-commanding items whose shared
   * block sits ~40 lines above, at `bowl-of-commanding-water-elementals`. **This entry carried no
   * comment at all until review added one**: its record lived only in that block, under the
   * abbreviation `censer` rather than its id, so an author editing this row in place had nothing
   * local telling them what was left out.
   *
   * The charge-alone shape at limit 1, read with D8 (the counter is real inside a fight and cannot
   * be pressed outside one). ABSENT: the summon itself - nothing in `featureRiders` mints an actor,
   * so the Air Elemental, its initiative slot, its one-hour clock and its dismissal are the GM's.
   * UNBLOCKED BY: a summoning vocabulary. Unit: NONE YET.
   */
  "censer-of-controlling-air-elementals": {
    actions: [{
      id: "summon", name: "Summon Air Elemental", activation: "action",
      description: "While gently swinging this censer, summon an Air Elemental. It appears in an unoccupied space as close to the censer as possible, understands your languages, obeys your commands, and takes its turn immediately after you on your Initiative count. It disappears after 1 hour, when it dies, or when you dismiss it as a Bonus Action. The censer can't be used this way again until the next dawn.",
      uses: { limit: 1, per: "long-rest", pool: "censer-of-controlling-air-elementals-charges" }
    }]
  },

  /*
   * `chime-of-opening` - "The chime can be used 10 times. After the tenth time, it cracks and becomes
   * useless." D1: ten uses that never come back. A `long-rest` pool would hand the table a chime the
   * SRD says cracked. Its `knock` cast was driven and is clean (no damage, no attack, no save), so
   * this one is blocked by the counter alone. Prose.
   */

  /**
   * THE FOUR CRYSTAL BALLS - each prints "you can cast Scrying (save DC 17) with it", with no charge
   * limit, while touching the orb and attuned to it. `scrying` was driven through the real library
   * (D4): the record carries no damage roll and `attackRoll: false`, and its `save: "wis"` is the
   * save SCRYING'S OWN TARGET makes - *"The target makes a Wisdom saving throw"* - which is exactly
   * the roll the item's printed DC 17 is the DC for.
   *
   * **`saveDc: 17` IS A FLOOR, NOT A FIXED NUMBER, and this entry used to call it an override**
   * (review). `castAction` (`equipment-derivation.ts:922`) does take `cast.saveDc ?? <derived>`, so
   * the authored 17 replaces the WEARER'S derived DC at derivation time - that much was right. But
   * `withStandingRiders` (`effective-actions.ts:44`) then runs over every action: `:51` sums
   * `spell-save-dc` off the loadout's riders and `:74` folds the total into `action.save.dc` for ANY
   * action carrying a save, spell or not. So a `spell-save-dc` rider anywhere in the loadout raises
   * this orb's PRINTED 17, and the same is true of this lane's three ACTION saves - `iron-flask` 17,
   * `pipes-of-haunting` 15, `rope-of-entanglement` 15 - where the raised number is not a spell DC at
   * all. C7c's limit W8 is the write-up, and `docs/ai-ledger/known-bugs.md` **[content/riders] A
   * `spell-save-dc` rider raises the DC of EVERY save-bearing action** carries it forward. MEASURED
   * 2026-08-12 over the shipped bundle: **zero** rows in `magic-items.v1.json` carry
   * `spell-save-dc` - `robe-of-the-archmagi` was the only one and review removed it - so no shipped
   * loadout reproduces this today. It is recorded because the next carrier, on any bundle, revives it.
   *
   * ABSENT on all four: the sensor. Scrying's whole payload is an invisible sensor the GM narrates,
   * and the save-modifier tables ("Secondhand +5", "Body part -10") are situational modifiers no
   * trigger can express. What the button gives a table is the roll and the number, on demand.
   *
   * ==========================================================================================
   * **THE TWO SENSOR-GATED CASTS ARE ABSENCES, AND THEY USED TO BE AUTHORED** - review, 2026-08-12,
   * and it is the one rider this pass removed rather than annotated. Stated here because it governs
   * two entries below and one rule covers both.
   * ==========================================================================================
   *
   * The Mind Reading and Telepathy orbs each print a SECOND spell, and neither is a thing the bearer
   * may simply do. Both are cast THROUGH AN ACTIVE SCRYING'S SENSOR, at a creature near that sensor:
   * *"you can cast Detect Thoughts (save DC 17) targeting creatures you can see within 30 feet of the
   * spell's sensor"*, and *"You can also cast Suggestion (save DC 17) through the sensor on one of
   * those creatures"*. Nothing in the vocabulary expresses "only while another of this item's spells
   * is running, and only on a target near its sensor" - there is no cast-requires-cast trigger and no
   * sensor to be near.
   *
   * MEASURED 2026-08-12 through the real `ContentLibrary` over the committed bundle, with the riders
   * still in place and nothing supplied by a fixture:
   *   `item-crystal-ball-of-telepathy-cast-suggestion` derived `activation: "action"`,
   *       `save {wis, 17}`, `uses {limit: 1, per: "long-rest"}` - **with no prerequisite of any
   *       kind**. Resolved against a foe in melee it wrote `pendingSaves[0] = {ability: "wis", dc: 17,
   *       conditionId: "charmed"}` (`conditionFrom` reads "Charmed" out of Suggestion's own
   *       description), and answering it with a d20 of 2 and `commit` put `{"id":"charmed"}` on the
   *       target's `conditions`. That is a once-per-dawn DC 17 charm on any target the bearer picks.
   *   `item-crystal-ball-of-mind-reading-cast-detect-thoughts` derived `save {wis, 17}` and
   *       `uses: undefined` - unlimited - and wrote a real `{wis, 17, conditionId: null}` pending
   *       save against a plain monster. Nothing lands on a failure, so the cost is a spurious prompt
   *       rather than a condition; it is the same unrecorded broadening either way.
   *
   * Pre-ruling 3 makes an over-grant an absence, and this lane applied that rule to `wind-fan` two
   * hundred lines below - *"the benefit automatic, the drawback in the GM's memory"*. It did not
   * apply it here. Both riders are removed rather than re-worded, because there is no narrower rider
   * to write: the gate is the whole difference. (Contrast C7c's `helm-of-telepathy`, whose SRD text
   * grants Suggestion outright with no sensor in it - that lane's identical rider is faithful and
   * stays.) Both orbs keep their Scrying, which IS printed ungated, so both remain authored rows and
   * the lane's 18/77 split does not move.
   * **NEEDS: a trigger that gates a cast on another of the item's casts being active, and a target
   * filter relative to a spell's sensor. Unit: NONE YET.**
   */
  "crystal-ball": {
    casts: [{ spellId: "scrying", saveDc: 17 }]
  },

  /**
   * CRYSTAL BALL OF MIND READING - Scrying, authored above; the orb's second spell is not.
   *
   * ABSENT, three halves:
   *   "you can cast Detect Thoughts (save DC 17) targeting creatures you can see within 30 feet of
   *       the spell's sensor" - the SENSOR GATE, see the block at the Crystal Ball entry. It WAS
   *       authored (`{spellId: "detect-thoughts", saveDc: 17}`) and derived an unlimited,
   *       unconditional DC 17 Wisdom save against any target; the rider is removed.
   *       NEEDS: a cast-gated-on-a-cast trigger and a sensor-relative target filter. Unit: NONE YET.
   *   "You don't need to concentrate on this Detect Thoughts spell to maintain it." An item that
   *       lifts a spell's Concentration requirement has no rider - `concentration` is a field on an
   *       EffectGrant, and D2 drops those from an item action.
   *   The sensor itself, as on all four orbs.
   */
  "crystal-ball-of-mind-reading": {
    casts: [{ spellId: "scrying", saveDc: 17 }]
  },

  /**
   * CRYSTAL BALL OF TELEPATHY - Scrying, authored above; the orb's second spell is not.
   *
   * ABSENT, three halves:
   *   "You can also cast Suggestion (save DC 17) through the sensor on one of those creatures ...
   *       You can't cast Suggestion in this way again until the next dawn." - the SENSOR GATE, see
   *       the block at the Crystal Ball entry, and the loudest instance of it: the authored rider
   *       (`{spellId: "suggestion", saveDc: 17, uses: {limit: 1, per: "long-rest", pool:
   *       "crystal-ball-of-telepathy-suggestion"}}`) MEASURED as a once-per-dawn DC 17 charm on any
   *       target in reach, landing a real `charmed` condition. Removed. The COUNTER and the DC were
   *       both right; there is simply no narrower rider, because the gate is the whole difference.
   *       NEEDS: a cast-gated-on-a-cast trigger and a sensor-relative target filter. Unit: NONE YET.
   *   "you can communicate telepathically with creatures you can see within 30 feet of the sensor" -
   *       there is no communication model.
   *   The Concentration waiver, as on the Mind Reading orb, and the sensor as on all four.
   */
  "crystal-ball-of-telepathy": {
    casts: [{ spellId: "scrying", saveDc: 17 }]
  },

  /**
   * CRYSTAL BALL OF TRUE SEEING - Scrying, as above.
   *
   * ABSENT: "you have Truesight with a range of 120 feet centered on the spell's sensor." C7c's W2,
   * measured there: `EquipmentDerivation` has no senses field, an item's `sense` rider is not even
   * summed, and the sheet's Senses line is fed by the DEFINITION's `open5e` extension, which the
   * builder fills from a species and never from an item. `overlay.ts`'s header says the same in as
   * many words. UNBLOCKED BY: a senses model an item can layer on. Unit: NONE YET.
   */
  "crystal-ball-of-true-seeing": {
    casts: [{ spellId: "scrying", saveDc: 17 }]
  },

  /*
   * `cube-of-force` - "The cube starts with 10 charges ...", and its six faces are a TABLE rather
   * than a sentence: under `Spell` / `Charge Cost`, Mage Armor 1, Shield 1, Tiny Hut 3, Private Sanctum
   * 4, Resilient Sphere 4, Wall of Force 5. (Review unstitched the cells, which this entry used to
   * render as one continuous quotation; the numbers are exact.) C7b's L1: a use costs exactly one
   * charge, because `resolveDefinitionAction` debits `actionUses[pool] + 1` per resolution. A
   * six-face menu whose faces cost 1 to 5 would become six one-charge buttons, so a 10-charge cube
   * would cast Wall of Force ten times where the SRD allows two. That is an over-grant, and a large
   * one. UNBLOCKED BY: a per-use charge COST on `FeatureUsesSchema`. Unit: NONE YET. Prose.
   */

  /**
   * CUBIC GATE - "The cube has 3 charges and regains 1d3 expended charges daily at dawn. As a Magic
   * action, you can expend 1 of the cube's charges to cast one of the following spells": Gate and
   * Plane Shift, one charge each. Both were driven (D4) and produce nothing at all - no damage, no
   * attack, no save - which is correct: neither spell rolls anything. ONE shared pool, because the
   * three charges are the cube's, not each spell's.
   *
   * C7b's L2 governs the recharge: "regains 1d3 expended charges daily at dawn" has no partial form
   * (`applyRest` clears the whole pool on a long rest), and `long-rest` is the honest approximation.
   *
   * ABSENT: which plane. "The six sides of the cube are each keyed to a different plane of
   * existence" and pressing a side twice shifts to it; there is no planar model, so the destination
   * is the GM's. What is real and enforced is that the cube opens three portals a day, not four.
   */
  "cubic-gate": {
    casts: [
      { spellId: "gate", uses: { limit: 3, per: "long-rest", pool: "cubic-gate-charges" } },
      { spellId: "plane-shift", uses: { limit: 3, per: "long-rest", pool: "cubic-gate-charges" } }
    ]
  },

  /*
   * `decanter-of-endless-water` - the Geyser command word: "One creature of your choice in the Line
   * must succeed on a DC 13 Strength saving throw or take 1d4 Bludgeoning damage and have the Prone
   * condition." Everything about it looks authorable - it is unlimited, as the name promises, and
   * `conditionFrom` reads "prone" correctly - and it is D5 that stops it. **MEASURED on that exact
   * sentence: `halfOnSuccessFrom` returns TRUE**, so a creature that SUCCEEDS on the save would take
   * half of 1d4 where the SRD gives it nothing at all. A wrong number on a success is worse than no
   * button. UNBLOCKED BY: D5. Prose.
   *
   * `deck-of-illusions` - pre-ruling 5 names it. A 1d100 draw producing an illusory creature that
   * "can do no harm", moved by Magic actions and dispelled by Dispel Magic. No illusion model, no
   * card-state model, and the deck is missing 1d20-1 cards when found. Prose.
   *
   * `dimensional-shackles` - "prevent a creature bound by them from using any method of
   * extradimensional movement." A prohibition on the TARGET, applied by a worn object the target did
   * not choose, against a movement mode the engine does not model. Prose.
   *
   * `dragon-orb` - an artifact, and blocked four times over. Its charge table costs 0 to 4 per spell
   * (L1, as `cube-of-force`); one of those spells is a level 9 Cure Wounds (D6 - the known-bugs
   * entry: it would synthesise a DAMAGE action); the attunement itself forces a DC 15 Cha save that
   * imposes Charmed on a FAILURE, which is a self-targeted save with no vocabulary; and "the orb
   * casts Suggestion on you at will" is a curse the schema would want `cursed: true` for, on an item
   * whose row already carries `cursed: false` from the parse. Prose.
   */

  /*
   * `dust-of-disappearance` - "There is enough of it for one use ... you and each creature and object
   * within a 10-foot Emanation originating from you have the Invisible condition for 2d4 minutes." D1 (one use), plus a
   * rolled duration, plus an area effect on allies that `actions[].save`'s single-target shape
   * cannot express. Prose.
   *
   * `dust-of-dryness` - "1d6 + 4 pinches", each consumed. D1. Its one combat line (10d6 Necrotic to a
   * water-composed Elemental on a failed DC 13 Con save) is also narrowed to a creature TYPE, and no
   * trigger filters an action by the target's type. Prose.
   *
   * `dust-of-sneezing-and-choking` - "There is enough of it for one use." D1. It is also a trap: the
   * SRD makes it indistinguishable from Dust of Disappearance and says Identify reveals it as such,
   * so authoring a button that names its real effect gives away what the item exists to hide. Prose.
   *
   * `efficient-quiver` - a container. See `bag-of-holding`. Prose.
   *
   * `efreeti-bottle` - a 1d10 table rolled the FIRST time the bottle is opened, whose result governs
   * every later opening (attack you and lose its magic / obey for 1 hour three times / grant one
   * Wish). Item state across uses, plus GM fiat. Prose.
   *
   * `elemental-gem` - "the gem ceases to be magical." D1. Prose.
   *
   * `eversmoking-bottle` - a growing cloud that makes an area Heavily Obscured. There is no
   * obscurement or area-terrain model an item can write to. Prose.
   *
   * `feather-token` - a `varies` row holding six different single-use tokens (Anchor, Bird, Fan,
   * Swan Boat, Tree, Whip). D1 on every one of them, and the row is one record for all six, so even
   * the rarity is "varies". Prose.
   *
   * `figurine-of-wondrous-power` - a `varies` row holding ten figurines, each summoning a different
   * creature on its own cooldown (2 days, 5 days, "once per week"). No summoning vocabulary, and
   * `FeatureUsesSchema.per` has no multi-day form, so even the cooldowns are unsayable. Prose.
   *
   * `folding-boat` - a vehicle in a box. See `apparatus-of-the-crab`. Prose.
   *
   * `gem-of-brightness` - "This prism has 50 charges ... When all of the gem's charges are expended,
   * the gem becomes a nonmagical jewel." Three separate refusals: D1 (the charges never come back),
   * L1 (the third command word costs 5 charges), and C7b's L3 (`FeatureUsesSchema.limit` is
   * `.max(20)`, so 50 has no home). Prose.
   */

  /**
   * GEM OF SEEING - "This gem has 3 charges ... expend 1 charge. For the next 10 minutes, you have
   * Truesight out to 120 feet when you peer through the gem. The gem regains 1d3 expended charges
   * daily at dawn." The charge-alone shape: the count and the recharge are exactly printed (L2's
   * long-rest approximation), and what the charge buys is a sight the GM narrates.
   *
   * Deliberately NOT authored as `casts: true-seeing`: the gem does not cast that spell, and True
   * Seeing's own text targets "the willing creature you touch" rather than the peerer. The item's
   * own words are kept instead.
   *
   * ABSENT: the Truesight. C7c's W2 - there is no senses model for an item to write to, so what the
   * gem grants is prose plus a spent charge.
   */
  "gem-of-seeing": {
    actions: [{
      id: "peer", name: "Peer Through the Gem", activation: "action",
      description: "Expend 1 charge. For the next 10 minutes, you have Truesight out to 120 feet when you peer through the gem.",
      uses: { limit: 3, per: "long-rest", pool: "gem-of-seeing-charges" }
    }]
  },

  /*
   * `handy-haversack` - a container. See `bag-of-holding`. Prose.
   *
   * `hat-of-many-spells` - Wizard-only, and its centre is an Intelligence (Arcana) check at
   * "DC 10 plus the spell's level" followed, on a failure, by a 1d100 wild-magic table. Neither half
   * has a vocabulary: no rider makes the OUTCOME of an ability check a gate on something else, which
   * is a different gap from C7c's W1 and outlived it - W1 closed 2026-08-13 and this row did not
   * move, because reaching a check's die is not the same as branching on whether it beat a DC. And a
   * random-effect table is GM fiat. Its Spellcasting Focus clause is real and
   * also unsayable - there is no focus model. Prose.
   *
   * `horn-of-blasting` - THE CLOSEST THING IN THIS LANE TO AN AUTHORABLE DAMAGE ROLL, and taken
   * conservatively. "Each creature in the Cone makes a DC 15 Constitution saving throw. On a failed
   * save, a creature takes 5d8 Thunder damage and has the Deafened condition for 1 minute. On a
   * successful save, a creature takes half as much damage only." Every reader was checked and every
   * one gets it RIGHT: `halfOnSuccessFrom` returns `true` (measured - this is the one item in the
   * lane whose phrasing D5 does not misread) and `conditionFrom` returns "deafened" (measured).
   * What stops it is the sentence after: **"Each use of the horn's magic has a 20 percent chance of
   * causing the horn to explode. The explosion deals 10d6 Force damage to the user and destroys the
   * horn."** Authoring the blast without the risk makes the horn strictly better than the SRD prints
   * and puts the good half on a button while the bad half survives only in the GM's memory - which
   * is the shape pre-ruling 2 removed `Armor of Vulnerability` over, arriving here as a printed
   * drawback rather than a curse. Taken as an absence because an absence is recoverable and a
   * strictly-better legendary noise-maker at a table is not. **This is the first entry to revisit if
   * a percentage-risk rider ever lands.** UNBLOCKED BY: a per-use risk/self-damage rider. Prose.
   *
   * `horn-of-valhalla` - "Once you use the horn, it can't be used again until 7 days have passed."
   * `FeatureUsesSchema.per` is `turn | encounter | short-rest | long-rest`; a `long-rest` pool would
   * hand the table a horn seven times over. The summoned Berserkers are separately unsayable, and
   * the `varies` row holds all four metals at once. Prose.
   *
   * `horseshoes-of-a-zephyr` - floating four inches above the ground, ignoring Difficult Terrain,
   * leaving no tracks, and travelling 12 hours without Exhaustion. Movement and travel, none of it
   * modeled. Prose.
   *
   * `horseshoes-of-speed` - "its Speed is increased by 30 feet." C7c's W2, measured there:
   * `derivation.speed` is written and read by nothing at all across the server, the rules package
   * and the client. The rider would parse, ship, and change no number. It is also worn by a HORSE,
   * which is a second actor. Prose.
   *
   * `instant-fortress` - a 20-foot adamantine tower with its own AC and HP. A building, not a rider.
   * Prose.
   *
   * `ioun-stone` - a `varies` row holding fourteen different stones under one id, several of which
   * WOULD be authorable alone (Protection's +1 AC, Insight/Intellect/Leadership/Strength's ability
   * scores, Reserve's stored spell). Two things stop it: the bundle keeps one record for all
   * fourteen, so a rider would apply every stone's benefit at once - the loudest over-grant this
   * lane could produce - and the pearly white spindle's "You regain 15 Hit Points at the end of each
   * hour" is D6 regardless. UNBLOCKED BY: a C6-side split of the `varies` rows, then a re-read.
   * Prose.
   */

  /**
   * IRON BANDS - "Make a ranged attack roll with an attack bonus equal to your Dexterity modifier
   * plus your Proficiency Bonus ... Once the bands are used, they can't be used again until the next
   * dawn."
   *
   * **THE ITEM IS `Iron Bands`. THIS ENTRY CALLED IT "IRON BANDS OF BILARRO"** (review). SRD 5.2.1's
   * heading is `#### Iron Bands` (`magic-items.md:2571`), "Bilarro" appears nowhere in the vendored
   * source, and the shipped row's `name` is "Iron Bands" - which is what an equipment picker mints,
   * so the lane's own test was minting a name the picker never would.
   *
   * The one item in this lane whose printed to-hit is expressible. C7b's L5 says an item action's
   * to-hit is DERIVED from an ability and never printed flat - and these bands print exactly the
   * derived form, so `{ability: "dex", proficient: true}` is not an approximation of the SRD's
   * sentence, it IS the SRD's sentence. MEASURED on a Dex 14 / PB 3 bearer: `attack.bonus` is 5.
   *
   * **AND THIS IS D9's ITEM: the one authored row in the lane whose once-per-dawn limit can be
   * BYPASSED.** It is the only C7d action carrying an `attack`, so it is the only one
   * `looseRollPlan` will build a roll for outside an encounter - MEASURED:
   * `[{"formula":"1d20 + 5","purpose":"attack","label":"Throw the Bands"}]` - and that route
   * (`game-operations.ts:1571-1572`) never touches `actionUses`. Out of combat the bands throw an
   * unlimited number of real +5 attacks. Engine-wide rather than an authoring mistake, so the rider
   * stays; see D9 and the known-bugs entry.
   *
   * ABSENT, three halves:
   *   "On a hit, the target has the Restrained condition until you take a Bonus Action to issue a
   *       command that releases it." That is `onHit`, and D2 is measured: `itemAction` drops it. So
   *       the bands roll to hit and the GM applies the tangle with `setCondition`.
   *   "A creature that can touch the bands, including the one Restrained, can take an action to make
   *       a DC 20 Strength (Athletics) check to break the iron bands." A CHECK, not a save, and
   *       `escapeDc` rides on the same dropped `onHit`.
   *   "On a successful check, the item is destroyed, and the Restrained creature is freed. On a
   *       failed check, any further attempts made by that creature automatically fail until 24 hours
   *       have elapsed." - added by review, which found the ABSENT list stopping before the printed
   *       DRAWBACK. The bands ship with a renewing `{limit: 1, per: "long-rest"}` pool over an item
   *       the SRD can DESTROY, and there is no rider that removes an inventory row (D1's other half)
   *       and no 24-hour clock. It is the same shape this lane refused `horn-of-blasting` over 40
   *       lines above - *"the good half on a button while the bad half survives only in the GM's
   *       memory"* - and destruction is a harder drawback than that horn's 20 percent. It is
   *       disclosed rather than blocking, because the drawback fires on the TARGET's action rather
   *       than the bearer's press, and the whole printed paragraph is now on the button so the GM
   *       reads it where they use it.
   * UNBLOCKED BY: D2's `onHit` passthrough for the first two; a consume/destroy rider and a
   * multi-hour clock for the third. Unit: NONE YET for any.
   */
  "iron-bands": {
    actions: [{
      id: "throw", name: "Throw the Bands", activation: "action",
      description: "Throw the sphere at a Huge or smaller creature you can see within 60 feet of yourself. As the sphere moves through the air, it opens into a tangle of metal bands. On a hit, the target has the Restrained condition until you take a Bonus Action to issue a command that releases it. Doing so or missing with the attack causes the bands to contract and become a sphere once more. A creature that can touch the bands, including the one Restrained, can take an action to make a DC 20 Strength (Athletics) check to break the iron bands. On a successful check, the item is destroyed, and the Restrained creature is freed. On a failed check, any further attempts made by that creature automatically fail until 24 hours have elapsed. Once the bands are used, they can't be used again until the next dawn.",
      attack: { ability: "dex", proficient: true, rangeFeet: 60 },
      uses: { limit: 1, per: "long-rest", pool: "iron-bands-charges" }
    }]
  },

  /**
   * IRON FLASK - "the target must succeed on a DC 17 Wisdom saving throw or be trapped in the flask."
   * A save the server really rolls and really enforces, at the flask's own printed DC, against a
   * target the wielder chooses. No charges, which is correct: the SRD prints no limit on attempts.
   * MEASURED: `conditionFrom` returns null on this description - nothing spurious is applied.
   *
   * ABSENT: everything the trapping is. The extradimensional cell, the one-creature-at-a-time limit,
   * releasing the occupant to obey commands for an hour, and "If the target has been trapped by the
   * flask before, it has Advantage on the save" - which C7c's W4 covers, since no trigger narrows a
   * save by what it is against or by the target's history. The flask offers the roll; the GM keeps
   * the prisoner.
   *
   * ALSO ABSENT, and review added it because the list above enumerated everything AFTER the save and
   * nothing BEFORE it: **"the target is native to a plane of existence other than the one you're
   * on"** is a printed PRECONDITION on the save, and the button has none. MEASURED:
   * `item-iron-flask-trap` derives `{save: {ability: "wis", dc: 17}, uses: null}` and resolving it
   * writes a real DC 17 Wisdom pending save against a plain local monster. A targeting restriction of
   * that kind - a property of the TARGET's origin, not of a roll - has no filter in the vocabulary at
   * all (`versus-creature-type` and `versus-size` are the nearest and neither is a home plane). The
   * gate is carried verbatim in the button's own description, so the GM reads it at the moment they
   * press, which is why this is a recorded limit rather than a removed rider.
   * UNBLOCKED BY: a target-origin filter. Unit: NONE YET.
   */
  "iron-flask": {
    actions: [{
      id: "trap", name: "Trap a Creature", activation: "action",
      description: "Target a creature you can see within 60 feet of yourself. If the flask is empty and the target is native to a plane of existence other than the one you are on, the target must succeed on a DC 17 Wisdom saving throw or be trapped in the flask. Once trapped, a creature remains in the flask until released.",
      save: { ability: "wis", dc: 17 }
    }]
  },

  /*
   * `lantern-of-revealing` - "Invisible creatures and objects are visible as long as they are in the
   * lantern's Bright Light." The Invisible CONDITION exists and the map has lighting, but nothing
   * connects them: there is no rider that suppresses a condition inside a radius, and the light this
   * lantern sheds is not a light source the map knows about. Prose.
   *
   * THE THREE MANUALS AND THE THREE TOMES - `manual-of-bodily-health` (Con),
   * `manual-of-gainful-exercise` (Str), `manual-of-quickness-of-action` (Dex), `tome-of-clear-thought` (Int),
   * `tome-of-leadership-and-influence` (Cha), `tome-of-understanding` (Wis). All six print the same
   * sentence with one ability swapped: "If you spend 48 hours over a period of 6 days or fewer
   * studying the book's contents ... your <ability> increases by 2, to a maximum of 30. The manual
   * then loses its magic but regains it in a century."
   *
   * Two refusals, either of which is enough. First, `ability-score` is one of the two rider types
   * `ITEM_REFUSED_MODIFIER_TYPES` refuses on an item carrier, quoted rather than worked around:
   * *"An item cannot change hit points or an ability score yet - those are baked into the sheet and
   * cannot be un-granted when the item comes off. Use a specific bonus instead: armor-class,
   * save-bonus, check-bonus, or spell-save-dc. (Both stay available on a feat.)"*
   * (`src/character-content.ts:263`, enforced at `src/schemas.ts:338-341`.) Second - and this is why
   * these six are not the same absence as `Potion of Giant Strength` - the increase here is
   * PERMANENT and survives the book: it is an edit to the character sheet that a GM makes once, not
   * a rider an item carries. An item rider is by construction reversible on unequip, so even a
   * layered ability score would be the wrong shape for a manual. UNBLOCKED BY: nothing in the rider
   * vocabulary; this is a sheet edit. Prose.
   *
   * `manual-of-golems` - crafting: 30 to 120 days and 50,000 to 100,000 GP to build a golem. No
   * crafting model, and its one mechanical line (6d6 Psychic to a reader who cannot use it) fires on
   * the reader rather than at a target. Prose.
   *
   * `marvelous-pigments` - painting real objects and terrain into existence inside a 20-foot Cube.
   * Pure GM fiat, and the pots are consumed (D1). Prose.
   *
   * `mirror-of-life-trapping` - pre-ruling 5 names it by hand. Its DC 15 Charisma save fires on any
   * creature that "sees its reflection in the activated mirror", which is a passive property of a
   * hung object rather than an action taken at a target - and `actions` is the only shape that
   * carries a save. Twelve extradimensional cells, occupants who can be spoken to and released, and
   * a save with Advantage for anyone who knows what the mirror is (C7c's W4). Prose.
   *
   * `mysterious-deck` - **RESERVED. Do not author: unit U32** (`on-death-save` +
   * `roll-mode: death-save`), whose Comet card reads "you have Advantage on Death Saving Throws".
   * The rest of the deck is twenty-two cards of GM fiat - imprisonment, a lost soul, an extra feat,
   * an artifact - and the item requires no attunement, so `src/schemas.ts:330` would refuse a
   * `cursed: true` on it even where the deck plainly is one. Prose until U32.
   */

  /*
   * `pearl-of-power` - see the header's note on clause (b) of the charge-alone shape. A perfect
   * once-per-dawn counter attached to "regain one expended spell slot of level 3 or lower", and
   * there is no verb that refunds a spent slot: `spell-slot` raises the MAXIMUM, which is a
   * different and permanent thing, and authoring it would give an uncommon pearl a standing extra
   * 3rd-level slot forever. Authoring the counter alone would spend a charge and give the player
   * nothing - the `Rod of Resurrection` failure from round 1, exactly. UNBLOCKED BY: a rider that
   * restores an expended slot. Unit: NONE YET. Prose.
   */

  /**
   * PIPES OF HAUNTING - **THIS LANE'S FAR END.** "These pipes have 3 charges and regain 1d3 expended
   * charges daily at dawn. You can take a Magic action to play them and expend 1 charge ... Each
   * creature of your choice within 30 feet of you must succeed on a DC 15 Wisdom saving throw or
   * have the Frightened condition for 1 minute."
   *
   * Three engine outcomes out of one item, and none of them supplied by a fixture:
   *   - a SPENT COUNTER - `actionUses["pipes-of-haunting-charges"]` moves to 1 of 3;
   *   - a REFUSAL - the fourth press throws "no uses remaining (3/long rest)";
   *   - a SAVE THE SERVER ENFORCES - a real pending `{wis, dc 15}` on the target, carrying
   *     `conditionId: "frightened"`, which `conditionFrom` reads out of the description below rather
   *     than from any authored field. That is why the SRD's word "Frightened" is kept verbatim.
   *
   * C7b's L2 governs the recharge: "regains 1d3 expended charges daily at dawn" has no partial form,
   * and `long-rest` is the honest approximation.
   *
   * ABSENT: THREE clauses, and the third is review's - the list used to hold two and then call the
   * result conservative, which it is not.
   *   **"for 1 minute" - the CLOCK on the Frightened.** MEASURED end to end: resolve -> pending
   *       `{wis, dc 15, conditionId: "frightened"}` -> `answerSave` with d20 2 and commit ->
   *       `state.actors[1].conditions === [{"id":"frightened"}]` and `effects === []`. There is no
   *       duration on an applied condition and no `EffectInstance` behind it, so the fright stands
   *       until a GM clears it by hand. This is D3's shape on the condition side: the engine has no
   *       clock an item action can set, and D3 was never cited at this entry.
   *   "A creature that fails the save repeats it at the end of each of its turns" - a repeat-save
   *       schedule; `EffectInstance` has durations but no repeating-save field an item can request.
   *   "A creature that succeeds on its save is immune to the effect of these pipes for 24 hours" -
   *       per-source immunity memory that nothing carries.
   *
   * **AND THE DIRECTION IS NOT CONSERVATIVE.** This entry used to close *"Both make the pipes' fright
   * END sooner than authored, so the GM clearing the condition is the conservative direction"* - but
   * a debuff on an ENEMY that outlasts its printed minute is a benefit to the party, which is
   * pre-ruling 3's over-grant, and it is the benefit-automatic / drawback-in-the-GM's-memory shape
   * this lane refused `horn-of-blasting` and `wind-fan` over. It is kept rather than removed for two
   * reasons that are real: the condition is a PROPOSAL the answerer confirms (`outcome.committed` is
   * false until the GM commits, and `conditionFrom`'s own doc comment says a false positive is meant
   * to be visible and reversible), and the pattern is INHERITED rather than invented here - C7b's
   * `wand-of-paralysis` (SRD "1 minute"), `rod-of-rulership` ("8 hours"),
   * `staff-of-thunder-and-lightning` and C7c's `robe-of-scintillating-colors` all apply an
   * unclocked condition the same way. The correction is this record, not the rider.
   * UNBLOCKED BY: a repeat-save rider, and a duration on a condition an action applies. Unit: NONE
   * YET for either.
   */
  "pipes-of-haunting": {
    actions: [{
      id: "play", name: "Play the Pipes", activation: "action",
      description: "Expend 1 charge to play an eerie, spellbinding tune. Each creature of your choice within 30 feet of you must succeed on a DC 15 Wisdom saving throw or have the Frightened condition for 1 minute. A creature that fails the save repeats it at the end of each of its turns, ending the effect on itself on a success. A creature that succeeds on its save is immune to the effect of these pipes for 24 hours.",
      save: { ability: "wis", dc: 15 },
      uses: { limit: 3, per: "long-rest", pool: "pipes-of-haunting-charges" }
    }]
  },

  /**
   * PIPES OF THE SEWERS - "The pipes have 3 charges and regain 1d3 expended charges daily at dawn.
   * If you play the pipes as a Magic action, you can take a Bonus Action to expend 1 to 3 charges,
   * calling forth one Swarm of Rats with each expended charge."
   *
   * The charge-alone shape, and C7b's L1 - a use costs exactly one charge - **NARROWS the printed
   * economy rather than fitting it.** This entry used to say the opposite: *"C7b's L1 ... is not a
   * limitation here but a fit: the SRD's unit IS one charge per swarm, so three presses call three
   * swarms and the total is the printed total."* The TOTAL is right; the TEMPO is not. The SRD prices
   * three swarms at one Magic action plus one Bonus Action, on a single turn. The authored shape is
   * one `activation: "action"` per charge - MEASURED: `{activation: "action", uses: {limit: 3, per:
   * "long-rest", pool: "pipes-of-the-sewers-charges"}}`, one charge debited per resolution - so three
   * swarms cost three full actions across three turns, three times the printed price. The deviation
   * UNDER-grants, so there is no table hazard and the rider stays; the claim was the defect.
   * (The entry's own quote also used to stop just before the Bonus Action clause, which is how the
   * economy went unnoticed; the full sentence is above.)
   *
   * ABSENT: three halves. The swarms themselves (no summoning vocabulary, as the four elemental items
   * above); the passive "ordinary rats and giant rats are Indifferent toward you", which is a
   * creature-attitude model that does not exist; and **the action economy just described** - review
   * added it, because "expend 1 to 3 charges as a Bonus Action after a Magic action" needs both a
   * per-use charge COST on `FeatureUsesSchema` (the same gap `cube-of-force` is refused over) and a
   * bonus-action activation that follows another action, and neither exists.
   * The DC 15 Wisdom save in the printed text belongs to a swarm that wanders within 30 feet - a save
   * made BY a creature the GM is running, not by a target the piper picks - so it is deliberately not
   * authored as this action's `save`; putting it there would prompt the wrong creature at the wrong
   * moment. UNBLOCKED BY: a per-use charge cost, plus a summoning vocabulary. Unit: NONE YET.
   */
  "pipes-of-the-sewers": {
    actions: [{
      id: "call", name: "Call a Swarm of Rats", activation: "action",
      description: "Play the pipes and expend 1 charge, calling forth one Swarm of Rats if enough rats are within half a mile of you to be called in this fashion (as determined by the GM). If there aren't enough rats to form a swarm, the charge is wasted. Called swarms move toward the music by the shortest available route but aren't under your control otherwise.",
      uses: { limit: 3, per: "long-rest", pool: "pipes-of-the-sewers-charges" }
    }]
  },

  /*
   * `portable-hole` - pre-ruling 5 names it, and it is a container besides. See `bag-of-holding`.
   * Prose.
   *
   * `rope-of-climbing` - an animate rope that moves 10 feet a turn, knots itself, and "While
   * knotted, the rope shortens to a 50-foot length and grants Advantage on ability checks made to
   * climb using the rope". **NO LONGER C7c's W1** - `roll: "check"` has a consumer since 2026-08-13
   * - and the row is further from authorable than that reads. There is no CLIMB check: the five
   * checks the server throws are Hide, Influence, Search, Study and Escape a Grapple, and none of
   * them is climbing, so there is no narrow to gate on. Unnarrowed is advantage on all five, on an
   * uncommon rope. The other two qualifiers are unsayable too - "while knotted" is item state and
   * "using the rope" is a fact about how a GM described the climb. **Needs: a climb check, item
   * state, or both. Unit: NONE YET.** The rest is a rope the GM narrates. Prose.
   */

  /**
   * ROPE OF ENTANGLEMENT - "command the other end to dart forward and entangle one creature you can
   * see within 20 feet of yourself. The target must succeed on a DC 15 Dexterity saving throw or
   * have the Restrained condition."
   *
   * One target, one save, no charges - and no charges is CORRECT: the SRD prints no daily limit, so
   * an unlimited button is the printed item rather than an over-grant. MEASURED: `conditionFrom`
   * returns "restrained" from the description below, so a failed save arrives at the answerer with
   * the condition already named.
   *
   * ABSENT: the escape. "A target Restrained by the rope can take an action to make its choice of a
   * DC 15 Strength (Athletics) or Dexterity (Acrobatics) check" is an ability CHECK, and the
   * `escapeDc` field that would carry it rides on `onHit`, which D2 drops. Releasing the target by
   * letting go of the rope is likewise the GM's. The rope also has its own AC 20 / HP 20, which is
   * an object stat block rather than a rider.
   */
  "rope-of-entanglement": {
    actions: [{
      id: "entangle", name: "Entangle", activation: "action",
      description: "Command the other end of the rope to dart forward and entangle one creature you can see within 20 feet of yourself. The target must succeed on a DC 15 Dexterity saving throw or have the Restrained condition. You can release the target by letting go of your end of the rope or by using a Bonus Action to repeat the command.",
      save: { ability: "dex", dc: 15 }
    }]
  },

  /**
   * SENDING STONES - "While you touch one stone, you can cast Sending from it ... Once Sending is
   * cast using either stone, the stones can't be used again until the next dawn."
   *
   * `sending` was driven through the real library (D4) and is one of the cleanest casts in the SRD:
   * no damage roll, `attackRoll: false`, no save. So the cast is exactly its prose plus a counter,
   * and the counter is exactly what the SRD prints.
   *
   * ABSENT: the pairing. "The target is the bearer of the other stone. If no creature bears the
   * other stone, you know that fact as soon as you use the stone, and you don't cast the spell" is a
   * link between two inventory rows, and nothing in the vocabulary relates one item to another.
   */
  "sending-stones": {
    casts: [{ spellId: "sending", uses: { limit: 1, per: "long-rest", pool: "sending-stones-charges" } }]
  },

  /*
   * `sovereign-glue` - "1d6 + 1 ounces", each consumed. D1, and a permanent adhesive bond is GM
   * fiat besides. Its sibling `universal-solvent` is the same absence in reverse. Prose.
   *
   * `sphere-of-annihilation` - pre-ruling 5 names it. A hole in the multiverse that obliterates what
   * it touches (8d10 Force to anything not wholly engulfed), controlled by a DC 25 Intelligence
   * (Arcana) CHECK that moves it toward you on a failure. The check is a CONTROL MECHANISM, not a
   * rider on one - the same gap `hat-of-many-spells` records above, and not C7c's W1, which closed
   * 2026-08-13 without touching it: nothing in the vocabulary declares a new check for an item to
   * roll, nor branches on its result. Plus an instant-destruction outcome with no vocabulary, and a
   * hazard that occupies map space rather than an inventory row. Prose.
   */

  /**
   * STONE OF CONTROLLING EARTH ELEMENTALS - the fourth of the elemental-commanding items, whose
   * shared block sits at `bowl-of-commanding-water-elementals`, ~500 lines above. **This entry
   * carried no comment at all until review added one**, for the same reason as the censer: its record
   * lived in that block under the abbreviation `stone`, which is also the prefix of two other rows.
   *
   * It is the one of the four whose printed sentence DIFFERS: no "understands your languages", and
   * the elemental appears "in an unoccupied space you choose within 30 feet of yourself" rather than
   * as close to the item as possible. The authored description follows this row, not the shared one.
   *
   * The charge-alone shape at limit 1, read with D8. ABSENT: the summon itself - the Earth Elemental,
   * its initiative slot, its one-hour clock and its dismissal are the GM's.
   * UNBLOCKED BY: a summoning vocabulary. Unit: NONE YET.
   */
  "stone-of-controlling-earth-elementals": {
    actions: [{
      id: "summon", name: "Summon Earth Elemental", activation: "action",
      description: "While touching this stone to the ground, summon an Earth Elemental. It appears in an unoccupied space you choose within 30 feet of yourself, obeys your commands, and takes its turn immediately after you on your Initiative count. It disappears after 1 hour, when it dies, or when you dismiss it as a Bonus Action. The stone can't be used this way again until the next dawn.",
      uses: { limit: 1, per: "long-rest", pool: "stone-of-controlling-earth-elementals-charges" }
    }]
  },

  /**
   * STONE OF GOOD LUCK (LUCKSTONE) - "While this polished agate is on your person, you gain a +1
   * bonus to ability checks and saving throws."
   *
   * **THIS ENTRY USED TO OPEN "THE ONLY ITEM IN THIS LANE WHOSE ENTIRE PRINTED SENTENCE LANDS ...
   * two riders, two readers, and nothing left over", AND ONLY ONE HALF OF THAT IS TRUE** (review).
   * The two riders are authored and both reach A reader; only the save half reaches a ROLL.
   *   - `save-bonus` is summed into the save the SERVER rolls (`item-riders.test.ts` criterion 12),
   *     not a number the sheet merely displays. This half is whole.
   *   - `check-bonus` is summed by `checkRiderBonus` (`equipment-derivation.ts:778`) and read into
   *     every skill row by `actor-derived.ts:94` - **and by nothing else.** The one place the SERVER
   *     rolls an ability check itself never consults it: `BUILTIN_CHECKS`
   *     (`action-resolution.ts:138-143`) is resolved at `:758-766` from `abilityModifier` +
   *     `skillBonusFromExtension` + `exhaustionPenalty`, with no call to `checkRiderBonus` anywhere
   *     on that path. **MEASURED 2026-08-12 on this lane's own Wizard 5 (Dex 14), stone equipped and
   *     attuned, through the real pipeline: `deriveActorSheet(...).skills.find(stealth).bonus` is
   *     **3** (Dex +2 and the stone), while the builtin Hide roll through
   *     `resolveDefinitionAction(state, builtinAction("hide"), {builtin: true})` on a d20 of 10
   *     returns `check.total` **12** - Dex +2 only.** The sheet promises the +1 and the server's own
   *     roll does not pay it, which is exactly the split-brain `actor-derived.ts:15-26` says that
   *     block exists to END. It affects all four builtin checks - Hide, Influence, Search and Study -
   *     and Escape a Grapple, the fifth check the server throws. **Re-measured 2026-08-13**: W1's
   *     consumer landed on exactly those call sites and reads `roll-mode` only, so a stone worn
   *     beside `Boots of Elvenkind` now rolls `2d20kh1` and still adds +2 rather than +3.
   *     Unnarrowed IS still the faithful reading of "ability checks" - C7c's `Gloves of Thievery`
   *     needed a `skill-is` filter because ITS text names one skill and this one names none - so the
   *     rider stays and the gap is recorded rather than the rider removed: the number it does reach
   *     is right, it simply does not reach far enough.
   *     **NEEDS: `checkRiderBonus` consulted where `BUILTIN_CHECKS` resolves. Unit: NONE YET.**
   *     UNBLOCKED BY: `docs/ai-ledger/known-bugs.md` **[content/riders] A `check-bonus` rider misses
   *     the server's own ability-check roll**, written up from this measurement.
   * Both riders come off with the stone, and both are hidden until attunement - the SRD gates this
   * one behind attunement and the row carries `attunement.required: true`, so the hiding boundary is
   * the item's own rather than this file's.
   */
  "stone-of-good-luck-luckstone": {
    modifiers: [
      { type: "check-bonus", amount: 1 },
      { type: "save-bonus", amount: 1 }
    ]
  },

  /*
   * `universal-solvent` - "1d6 + 1 ounces", each consumed. D1. Prose.
   *
   * `well-of-many-worlds` - "Once the Well of Many Worlds has opened a portal, it can't do so again
   * for 1d8 hours." A ROLLED cooldown, which is C7c's `Wings of Flying` precedent: an item with no
   * printed count has nothing to enforce, and rounding 1d8 hours to a long rest would be a guess in
   * the player's favour. Planar travel is unsayable regardless. Prose.
   *
   * `wind-fan` - "you can cast Gust of Wind (save DC 13) from it. Each subsequent time the fan is
   * used before the next dawn, it has a cumulative 20 percent chance of not working; if the fan
   * fails to work, it tears into useless, nonmagical tatters." The cast itself is clean - driven,
   * and `gust-of-wind` produces `save: {str}`, which is the save its own targets make - but the fan
   * has no charge count at all, only an escalating risk of destruction. Authoring the cast alone
   * gives a table an unlimited Gust of Wind that never tears, which is the `Horn of Blasting`
   * over-grant again: the benefit automatic, the drawback in the GM's memory. UNBLOCKED BY: a
   * per-use risk rider, as the Horn. Prose.
   */

  // =============================================================================================
  // CONSUMABLES - 24 rows, 0 authored. D1 empties every one of them; the per-item notes below say
  // what ELSE each would have needed even if it were refillable, because a lane that recorded only
  // "consumed" would hide four separate vocabulary gaps behind one.
  // =============================================================================================

  /*
   * `elixir-of-health` - "you are cured of all magical contagions. In addition, the following
   * conditions end on you: Blinded, Deafened, Paralyzed, and Poisoned." D1, and beyond it there is
   * no verb that REMOVES a condition: `grants.conditionImmunities` prevents one arriving
   * (`actor-conditions.ts:52-56` narrates the skip) and nothing clears one already held. Prose.
   *
   * `oil-of-etherealness` - D1, and the Etherealness spell it grants has no model. Prose.
   *
   * `oil-of-sharpness` - "turning the coated weapon into a +3 Weapon or the coated ammunition into
   * +3 Ammunition." D1, and a second gap that is C7a's: an item rider applies to ITS OWN bearer, and
   * nothing addresses a DIFFERENT inventory row. A `this-item`-scoped +3 on the oil would attach to
   * the vial. Prose.
   *
   * `oil-of-slipperiness` - D1; Freedom of Movement and Grease are both area/movement effects with
   * no model. Prose.
   *
   * `philter-of-love` - "you are charmed by that creature and have the Charmed condition for 1
   * hour." D1, and the condition lands on the DRINKER: an item action's save and riders reach the
   * bearer or a chosen target, never the bearer as a victim of their own item. Prose.
   *
   * `potion-of-animal-friendship` - D1. Its `animal-friendship` cast was driven and is clean
   * (`save: {wis}`, no damage), so this one is blocked by consumption alone - which is exactly why
   * D1 is stated as a limit rather than folded into "no vocabulary". Prose.
   *
   * `potion-of-clairvoyance` - D1; a remote sensor with no model. Prose.
   *
   * `potion-of-climbing` - D1; a Climb Speed (C7c's W2) plus Advantage on Athletics CHECKS to climb -
   * the same missing CLIMB check `rope-of-climbing` records above, no longer C7c's W1 (closed
   * 2026-08-13). Three gaps, and **D1 alone would be enough**: the potion is consumed, and this lane
   * authors no consumable. Prose.
   *
   * `potion-of-diminution` / `potion-of-growth` - D1; the Enlarge/Reduce effects change a creature's
   * SIZE, its damage dice and its Strength checks. `Actor.size` exists but no rider writes it. Prose.
   *
   * `potion-of-flying` - D1; a Fly Speed (C7c's W2). Prose.
   *
   * `potion-of-gaseous-form` - D1; Gaseous Form has no model. Prose.
   *
   * `potion-of-giant-strength` - **PRE-RULED.** "your Strength score changes for 1 hour ...", the
   * score being a TABLE row: under `Potion` / `Str.`, the hill-giant potion is 21 and the storm-giant
   * potion 29. (Review unstitched these cells too; the numbers are exact.) One of the SEVEN items
   * whose central mechanic the schema refuses
   * by design, quoted here rather than worked around: *"An item cannot change hit points or an
   * ability score yet - those are baked into the sheet and cannot be un-granted when the item comes
   * off. Use a specific bonus instead: armor-class, save-bonus, check-bonus, or spell-save-dc. (Both
   * stay available on a feat.)"* (`src/character-content.ts:263`, enforced at `src/schemas.ts:338-341`.)
   * Inventing a modifier type to work around `ITEM_REFUSED_MODIFIER_TYPES` is a VOCABULARY decision
   * and belongs to a unit, not to a content author. It is also a SET score rather than a bonus - the
   * refused `ability-score` rider is a signed delta with a maximum, not an assignment - it is a
   * `varies` row holding all five giants at once, and D1 applies on top. UNBLOCKED BY: a unit that
   * gives an item a layered ability score. Prose.
   *
   * `potion-of-heroism` - "you gain 10 Temporary Hit Points that last for 1 hour. For the same
   * duration, you are under the effect of the Bless spell (no Concentration required)." D6's second half: `hp.temporary` is live
   * actor state and nothing in `featureRiders` writes it. `bless` is separately one of the 24 spells
   * whose damage roll carries an EMPTY type list (the known-bugs entry names it), so a `casts` rider
   * would synthesise a Force damage action out of a buff. D1 on top. Prose.
   *
   * `potion-of-invisibility` - D1; the Invisible condition for 1 hour, which is D3's expiry gap in
   * condition form. Prose.
   *
   * `potion-of-invulnerability` - "For 1 minute after you drink this potion, you have Resistance to
   * all damage." D3, measured, and the most expensive instance of it in the lane: an `effects` rider
   * would grant Resistance to all thirteen damage types for as long as the unopened bottle sat in a
   * pack. D1 as well. Prose.
   *
   * `potion-of-longevity` - "your physical age is reduced by 1d6 + 6 years, to a minimum of 13 years."
   * There is no age. Prose.
   *
   * `potion-of-mind-reading` - D1; the `detect-thoughts` cast is clean (it is authored on the
   * Crystal Ball of Mind Reading above), so consumption is the whole of what stops this one. Prose.
   *
   * `potion-of-poison` - "you take 4d6 Poison damage and must succeed on a DC 13 Constitution saving
   * throw or have the Poisoned condition for 1 hour." A TRAP, and the SRD's own words are that it
   * "looks, smells, and tastes like a Potion of Healing": a button on the sheet naming its real
   * effect destroys the item. D1 also applies, and the damage lands on the drinker rather than a
   * target. Prose.
   *
   * `potion-of-resistance` - **THE BRIEFED FAR END, AND AN ABSENCE.** "When you drink this potion,
   * you have Resistance to one type of damage for 1 hour." Both halves were measured before this was
   * written. The resistance itself is real - `grants.damageResistances` and an effect's
   * `damage-resistance` both reach `adjustDamageParts` and genuinely halve a typed total, with the
   * item's name on the damage line - but **"for 1 hour" cannot be said**: D2 (an item action's
   * `grants` is dropped, so the one shape that expires never reaches the actor) and D3 (an item's
   * `effects` rider ignores `duration` entirely and stands while the item is carried). Authoring it
   * would give the bearer permanent Resistance to a type they never chose, for as long as they held
   * an unopened bottle - and D1 says the bottle should have been gone after one drink. The SRD's
   * 1d10 type table is the least of it. The far end moved to `pipes-of-haunting`, which ends at a
   * spent counter, a refusal and an enforced save with nothing supplied by a fixture.
   * UNBLOCKED BY: D2 + D3 (one unit: carry `grants` through `itemAction`). Prose.
   *
   * `potion-of-speed` - D1. Its `haste` cast was driven and produces `save: {dex, ...}`, which is
   * NOT a save Haste's target makes - the SRD's Dexterity save in that text is the ADVANTAGE the
   * hasted creature gains - so this is D4's shape as well as D1's. Prose.
   *
   * `potion-of-vitality` - "it removes any Exhaustion levels you have and ends the Poisoned
   * condition on you. For the next 24 hours, you regain the maximum number of Hit Points for any Hit
   * Point Die you spend." D6 (`docs/ai-ledger/known-bugs.md`, **[content/spells] There is no healing
   * in the spell model** - and no healing rider outside the spell model either), plus the
   * condition-removal gap `elixir-of-health` names, plus D1. Prose.
   *
   * `potion-of-water-breathing` - D1; breathing underwater has no model. Prose.
   *
   * `potions-of-healing` - **THE GROUPED `varies` ROW C6 DELIBERATELY KEPT WHOLE**, holding all four
   * potencies (2d4+2 / 4d4+4 / 8d4+8 / 10d4+20) in one record. D6, and the flagship case for it:
   * `docs/ai-ledger/known-bugs.md` **[content/spells] There is no healing in the spell model**
   * records that a Staff of Healing authored `casts: cure-wounds` and synthesised a 2d8 DAMAGE
   * action, because healing is stored in `damage.roll` with an EMPTY `damage.types`. Nothing in
   * `featureRiders` restores hit points either, so there is no non-spell road around it. Healing is
   * not expressible as negative damage (`ActionSchema.damage[].formula` is a `DiceFormulaSchema` and
   * the arithmetic subtracts, never adds) and not as temporary hit points (a different rule, and
   * unwritable anyway). D1 on top. UNBLOCKED BY: the known-bugs entry's own remedy - a `healing`
   * block on the spell reference, the ETL to populate it, and a reader. Prose.
   */
};
