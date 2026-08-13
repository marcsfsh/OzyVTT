/**
 * C7c - WONDROUS ITEMS YOU WEAR. The 56 rows whose bundle `category` is `wondrous-item` and whose
 * `slot` is one of `neck` (15), `shoulders` (15), `head` (11), `feet` (7), `hands` (6), `belt` (2).
 * 46 of the 56 require attunement - the heaviest attunement load of the four lanes.
 *
 * `bundles/magic-items.v1.json` carries these items' PROSE, parsed from the vendored SRD by
 * `../build-magic-items.ts`, which emits no `modifiers`, `grants`, `casts`, `actions` or `cursed` at
 * all. This file is the other half. See `./overlay.ts`'s header for the seven refusals every lane
 * inherits - including the SLOT check this lane's unit added, which is what keeps C7c and C7d off
 * each other's items now that the shared `wondrous-item` category cannot.
 *
 * ==============================================================================================
 * THE ADMISSION RULE: A RIDER IS AUTHORED ONLY WHERE ITS READER SHIPS **AND PRODUCES THE PRINTED
 * EFFECT.** A rider that reaches a reader and produces the WRONG effect is worse than an
 * unauthored one, because it is invisible until it happens at a table.
 * ==============================================================================================
 *
 * Everything else is a NAMED ABSENCE - a comment beside the item naming the SRD sentence, the
 * vocabulary it would need, and the unit or bug that unblocks it.
 *
 * ----------------------------------------------------------------------------------------------
 * THE READERS THIS LANE CHECKED, one per rider family it authors. Each was driven on a picker-shaped
 * inventory row through the real derivation before the rider was written, and the number quoted is
 * what came back. `apps/server/test/item-mechanics-c7c.test.ts` re-drives all of them against the
 * SHIPPED bundle; these are the author-time measurements that decided what to write.
 *
 *   `armor-class`         `inventory.ts:50` via `deriveEquipment` -> `actor.armorClass`.
 *                         MEASURED: a `Cloak of Protection` on a 12-AC hero reads 13, and 12 again
 *                         on unequip. (`item-riders.test.ts` criterion 3 is the same shape.)
 *   `armor-class` + a
 *   `while-unarmored`
 *   gate                  `riders.ts:167-168` - `armorWeight == null && shieldEquipped !== true`,
 *                         which is exactly "wearing no armor and using no Shield".
 *                         MEASURED on `Bracers of Defense`: 12 -> **14** bare; add a Shield and the
 *                         total is **14** again (10 + Dex 2 + shield 2), i.e. the bracers' +2 is OFF.
 *   `save-bonus`          `saving-throws.ts:72` `saveRiderBonus`, summed into the save the SERVER
 *                         rolls (criterion 12). MEASURED: `saveTotalFor(dex)` moves by exactly 1.
 *   `check-bonus` + a
 *   `skill-is` filter     `equipment-derivation.ts:778` `checkRiderBonus`, read by
 *                         `actor-derived.ts:94` into the sheet's skill row.
 *                         MEASURED on `Gloves of Thievery`: Sleight of Hand **+7**, Stealth **+2** -
 *                         the filter really narrows.
 *   `grants.damageResistances` / `grants.damageImmunities`
 *                         `hit-points.ts:181-186` - the item's list joins the definition's before
 *                         `adjustDamageParts`, and the item's NAME lands on the damage line as
 *                         `adjustmentSource`. (C7a measured 12 fire -> 6 on `Frost Brand`.)
 *   `grants.conditionImmunities`
 *                         `actor-conditions.ts:52-56` - `setCondition` narrates the skip instead of
 *                         applying. Its own comment names a Periapt as the item that fixed it.
 *   `grants.weapons`      `equipment-derivation.ts:1003` `granted = grantedWeapons.includes(...)`,
 *                         which matches a weapon CATEGORY *or the inventory row's own id*. That is
 *                         wider than `./overlay.ts` used to claim, and the seam now CHECKS this key
 *                         against the weapon ids and the category groups together rather than
 *                         leaving it open (corrected there, this lane having measured it).
 *                         MEASURED on `Bracers of Archery` with a definition whose
 *                         `proficiencies.weapons` is `[]` and whose `proficiencyBonus` is 3:
 *                         a Longbow's to-hit **2 -> 5**.
 *   `casts`               `equipment-derivation.ts:922` `castAction` - see W6, which is why only
 *                         five of this lane's twelve printed casts survived.
 *   `actions` + `uses`    three lines, not one, and review split them because the old wording named
 *                         the wrong two. `useLimitFor` (`action-resolution.ts:174-182`) RETURNS the
 *                         pool's size and refuses nothing; the REFUSAL is `:240-246`, which pushes
 *                         `feature.no-uses-remaining` when `spent >= limit`; `:248` only PLANS the
 *                         spend (`spendUse = { key, per }`) and the DEBIT is `:1259`,
 *                         `attacker.actionUses = {...}` (`item-riders.test.ts` criterion 4 drives
 *                         all three). A `save` on such an action becomes a real pending save
 *                         and `conditionFrom` reads the condition off the prose.
 *                         MEASURED on `Robe of Scintillating Colors`: one press leaves
 *                         `actionUses` at 1 of 3 and puts a `{wis, dc 15, conditionId: "stunned"}`
 *                         save on the target.
 *
 * ==============================================================================================
 * EIGHT LIMITS THIS LANE HITS OVER AND OVER, stated once so 38 absences below can point at a
 * number. Every one is MEASURED. W6 is C7b's L6 and is restated because it emptied five entries
 * here that looked authorable right up to the moment they were driven. W8 was added by review: it
 * emptied a NINETEENTH entry that had already shipped.
 * ==============================================================================================
 *
 * W1. `roll-mode` HAS NO CONSUMER FOR `roll: "check"`, and it is the single biggest killer in this
 *     lane. C7a found it first; re-measured here: grepping every `"roll-mode"` consumer in
 *     `apps/server/src` finds exactly four rolls - `attack` and `incoming-attack`
 *     (`action-resolution.ts:598,603`), `initiative` (`encounter.ts:57,62`) and `save`
 *     (`saving-throws.ts:64`). `checkRiderBonus` sums `check-bonus` and never looks at `roll-mode`.
 *     **MEASURED over the committed bundle: EIGHT of these 56 rows print an "Advantage on ... check"
 *     clause** - `belt-of-dwarvenkind`, `boots-of-elvenkind`, `cloak-of-elvenkind`, `cloak-of-the-bat`,
 *     `eyes-of-minute-seeing`, `eyes-of-the-eagle`, `robe-of-eyes`, `talisman-of-the-sphere` - and
 *     ALL EIGHT are absences below, because on none of them does anything else in the row land
 *     either. A flat `check-bonus` is NOT the same sentence and this lane does not substitute one.
 *     **Needs: a `roll: "check"` consumer on the ability-check path. Unit: NONE YET.**
 *
 * W2. `speed`, `darkvision` AND `sense` REACH NOTHING FROM AN ITEM. Measured 2026-08-12:
 *     `deriveEquipment` sums `speed` into `derivation.speed` (`equipment-derivation.ts:678`) and
 *     **grepping `derivation.speed` across `apps/server/src`, `packages/rules-5e/src` and
 *     `apps/client/src` returns the write and no read at all**; `EquipmentDerivation` has no
 *     darkvision or senses field, so those two riders are not even summed. The sheet's Senses line
 *     (`CharacterSheet.tsx:696`) is fed by the definition's `open5e` extension, which the builder
 *     fills from a SPECIES - never from an item. So a `darkvision` rider on Goggles of Night is a
 *     no-op, and `sense` is one too despite `CARRIER_RIDER_DISPOSITION` calling it "display-only":
 *     there is no display for an item to reach. **Needs: a senses/speed model an item can layer on.
 *     Unit: NONE YET.**
 *
 * W3. `grants.*` CARRIES A GATE - **CLOSED 2026-08-13.** `FeatureGrantsSchema` now takes one
 *     optional `when` over the whole block (`src/character-content.ts`), and it is EVALUATED:
 *     `equipment-derivation.ts`'s `takeGrants` asks `gatePasses` (`@vtt/rules-5e/riders.ts`, the
 *     same `collectRiders` every other rider goes through) before it takes anything, the builder
 *     refuses to BAKE a gated block and `deriveEquipment` picks it up per read instead, and a
 *     `moment` or a `filter` is refused at authoring rather than parsed and ignored. So a resistance,
 *     an immunity or a proficiency printed under a state the sheet can answer is now authorable
 *     without over-granting. Proof: `apps/server/test/grant-gates.test.ts`.
 *
 *     **THE TWO ITEMS BELOW ARE STILL ABSENCES, AND FOR THE OTHER HALF OF THEIR GATE.** W3 was never
 *     the whole blocker on either, which this line used to imply:
 *       - `Belt of Dwarvenkind` prints *"If you aren't a dwarf or duergar"* - a NEGATED species gate.
 *         `while-character-is` has `classIds` + `speciesIds` and no `present` flag, so the negation
 *         is inexpressible. **Needs: a `present` boolean on `while-character-is`, and a ruling on
 *         whether it fails OPEN or CLOSED for a sheet with no recorded species. Unit: NONE YET.**
 *       - `Helm of Brilliance` prints *"As long as the helm has at least one ruby"* - a COUNT of gems
 *         on the item. No trigger reads item state, and there is no gem or charge model to read.
 *         **Needs: an item-charge/component model. Unit: NONE YET.**
 *     `Boots of the Winterlands`' resistance is still the contrast: it prints no gate at all.
 *
 * W4. A SAVE CANNOT BE NARROWED TO WHAT IT IS AGAINST. The `RiderTrigger` filters narrow a save by
 *     the ABILITY rolled (`ability-is`) or by a condition the TARGET already has
 *     (`versus-condition`); none of the THIRTY-ONE names the SOURCE of the save - counted off
 *     `RIDER_TRIGGER_KINDS` (`packages/schemas/src/index.ts:117-127`), which has 31 members and not
 *     the "thirty" this line used to claim. So "Advantage on saving
 *     throws against spells" (Mantle of Spell Resistance, Scarab of Protection, Robe of the
 *     Archmagi) and "Advantage on saving throws to avoid or end the Poisoned condition" (Necklace of
 *     Adaptation, Periapt of Health, Belt of Dwarvenkind) can only be said as advantage on EVERY
 *     save of every kind. C7b already refused exactly this shape by name on `ring-of-spell-turning`
 *     - *"Authoring it ungated would hand a legendary ring advantage on every saving throw of every
 *     kind - strictly more than the SRD prints"* - and this lane follows it rather than arguing with
 *     a sibling. **Needs: a `save-against-is` filter (school / spell / condition-being-avoided) and
 *     a producer where `saveRollSources` is called. Unit: NONE YET.**
 *
 * W5. A CHARGE THAT NEVER COMES BACK IS UNSAYABLE, so an item that is CONSUMED cannot be authored
 *     for its charges. `FeatureUsesSchema.per` is `turn | encounter | short-rest | long-rest`
 *     (`src/character-content.ts:86`) and there is no "never". `Necklace of Fireballs`' beads are
 *     detached and thrown, `Scarab of Protection` "crumbles into powder and is destroyed when its
 *     last charge is expended", and both Talismans are destroyed on their last charge - so a pool
 *     authored for any of them would re-arm on a long rest and hand the table an item the SRD says
 *     is gone. That is an over-grant of the loudest kind. **Needs: a non-renewing `per`. Unit: NONE
 *     YET.** (It is separate from L2, C7b's finding that `long-rest` is the honest approximation of
 *     "regains 1d4 expended charges daily at dawn". L2's items DO come back; W5's do not.)
 *
 * W6. A SPELL RECORD'S `damage` AND `attackRoll` COLUMNS DESCRIBE THE SPELL'S TEXT, NOT WHAT ONE
 *     CAST ROLLS - C7b's L6, and it emptied five entries here. `castAction`
 *     (`apps/server/src/equipment-derivation.ts:922-961`) takes `spell.damage.roll` as the cast's
 *     damage formula, `spell.damage.types[0] ?? "force"` as its type, and emits an `attack` block
 *     whenever `spell.attackRoll` is true. **MEASURED 2026-08-12 by deriving each cast through the
 *     real content library:**
 *       - `teleport`      -> `damage: [{formula: "1d100", type: "force"}]`. That 1d100 is the SRD's
 *                            MISHAP TABLE roll. A Helm of Teleportation would deal **1d100 Force**.
 *       - `dimension-door`-> `damage: [{formula: "4d6", type: "force"}]`. The SRD's 4d6 is what BOTH
 *                            creatures take if you arrive in an occupied space, not what a cast does
 *                            to a target. A Cape of the Mountebank would deal it every time.
 *       - `scorching-ray` -> `damage: [{formula: "2d6", ...}]` + `attack: {bonus: 2}`. That is ONE of
 *                            the spell's THREE rays (the Wand of Magic Missiles error), and the
 *                            bonus is the WEARER's, not the Circlet of Blasting's printed **+5**
 *                            (L5: `FeatureAttackSchema` has no flat to-hit).
 *       - `levitate`      -> `save: {ability: "con", dc: 10}`. Levitate's Con save is the one an
 *                            UNWILLING target makes; the Boots of Levitation print "on yourself", so
 *                            the wearer would be prompted to save against their own boots.
 *     UNBLOCKED BY: the two `docs/ai-ledger/known-bugs.md` `[content/spells]` entries. The five casts
 *     this lane DOES author were each re-driven and produce no damage, no attack and only the save
 *     the item's own target genuinely makes.
 *
 * W7. HEALING IS AN ABSENCE, ALWAYS. `SpellReferenceSchema` has no healing field; a healing spell's
 *     dice live in `damage.roll` with an EMPTY `damage.types`, so `castAction`'s `?? "force"` turns
 *     a cure into a hit. `docs/ai-ledger/known-bugs.md` **[content/spells] There is no healing in
 *     the spell model** is the blocker, and it covers items that heal without casting anything too:
 *     nothing in `featureRiders` restores hit points. `Periapt of Health` ("regain 2d4 + 2 Hit
 *     Points") and `Necklace of Prayer Beads` (the Bead of Curing casts Cure Wounds) are both
 *     absences for this reason and no other reasoning is attempted on them.
 *
 * W8. `spell-save-dc` RAISES EVERY PRINTED DC, NOT THE WEARER'S SPELL SAVE DC - added by review,
 *     and it is the only limit here found AFTER a rider had shipped. `effective-actions.ts:51` sums
 *     the rider and `:74` folds it into `action.save.dc` for ANY action carrying a save; nothing on
 *     that path asks whether the action is a spell, and the engine has no spellcasting-DC field for
 *     it to reach instead. **MEASURED 2026-08-12 over the SHIPPED bundle through the real
 *     `ContentLibrary`, on a Wizard 5 wearing `Robe of the Archmagi`:** `Wand of Paralysis` DC 15 ->
 *     **17**, a Breath-Weapon-shaped definition action DC 13 -> **15**, this lane's own `Eyes of
 *     Charming` DC 13 -> **15**. Those are FIXED numbers printed on other items and on a stat block,
 *     and none of them is the wearer's spell save DC. That is an over-grant, so the robe's War Mage
 *     clause is an absence and the rider was removed. **Needs: a spell save DC on the actor that a
 *     spell's own DC is computed from, so a rider can raise THAT rather than every save on the
 *     sheet.** UNBLOCKED BY: `docs/ai-ledger/known-bugs.md` **[content/riders] A `spell-save-dc`
 *     rider raises the DC of EVERY save-bearing action**, written up from this measurement.
 *     (`robe-of-the-archmagi` is the whole of this limit's blast radius - MEASURED 2026-08-12: it
 *     was the only carrier in all 268 rows, and after its removal the string does not occur in ANY
 *     shipped bundle, classes and feats included. The next author to reach for it, on any carrier,
 *     meets the bug entry first.)
 *
 * ----------------------------------------------------------------------------------------------
 * WHERE THIS LANE AUTHORS LESS THAN THE PRINTED TEXT, stated once because an unstated exception is
 * how a file starts arguing with itself.
 *
 * **THE CHARGE-ALONE RULE, WORDED ONCE FOR BOTH LANES.** `./carried-and-potions.ts` carries the
 * identical paragraph, and review found the two stating the same named rule two different ways after
 * only one of them was corrected - which is the drift the rule exists to prevent. This is the single
 * wording; C7d's copy is the same sentences.
 *
 * **A CHARGED ITEM MAY BE AUTHORED FOR ITS CHARGE ALONE** when (a) the count and the recharge are
 * exactly what the SRD prints, and (b) the half the charge buys is one the GM can already produce at
 * the table - by narrating it, by putting the creature or the portal on the map, or with a command
 * the app already gives them (`setCondition`) - so the unauthored half is *narrated* rather than
 * *lost*. C7b set the precedent on `ring-of-evasion`: *"What is real and enforced is the CHARGE ...
 * The GM adjudicates the success; the ring cannot be used a fourth time in a day."* In THIS lane it
 * is two items, `winged-boots` and `cloak-of-invisibility`; C7d's copy names its own nine.
 *
 * **CLAUSE (b) IS A REFUSAL AS OFTEN AS IT IS A PERMISSION.** It does NOT admit a charge whose half
 * is a number the sheet would then be wrong about (C7d's `Pearl of Power`: the button would spend
 * its charge and the player's spell slot would not come back), nor one the program refuses outright
 * - `Periapt of Health`'s *"regain 2d4 + 2 Hit Points"* is dead under W7 and the known-bugs entry
 * behind it, charges or no charges. That second half is the correction review made here: the earlier
 * wording was *"something a GM resolves at the table rather than a number the sheet would then be
 * wrong about"*, which read as excluding `cloak-of-invisibility` - whose button buys the **Invisible**
 * condition, a first-class id in `conditions.v1.json` and engine-owned state exactly as hit points
 * are - while the lane authored it. The line is not GM-narrated versus number; it is *the GM already
 * has a way to produce this* versus *nothing in the program can*. Nor is it an excuse to author a
 * button for anything: an item with no printed charge count has nothing to enforce (which is why
 * `Wings of Flying`, whose cooldown is a rolled 1d12 hours, is an absence), and one that is consumed
 * rather than recharged fails W5. See `rulingsOwed`: whether a charge-alone button should be authored
 * at ALL when the effect is engine-owned state is a design question both lanes took conservatively
 * and neither settled.
 *
 * **TWO SHAPES BESIDE IT, NAMED SO THE PARAGRAPH DOES NOT OVER-CLAIM** (review). (1)
 * `robe-of-scintillating-colors` was listed here and is NOT charge-alone: MEASURED, its action
 * carries a real `{ability: "wis", dc: 15}` save and `conditionFrom` reads **Stunned** off the prose,
 * so a genuine outcome is enforced beyond the counter. (2) `hat-of-disguise` and
 * `helm-of-comprehending-languages` author strictly LESS than the charge-alone items do - MEASURED,
 * each derives one action with `uses: null, save: null, damage: [], attack: null`, so the only engine
 * outcome is the rendered spell description. Neither is charged, so neither is admitted by this rule;
 * both are disclosed at their own entries and pinned by the test that puts the two unlimited
 * self-casts on the sheet carrying no damage, no attack and no save.
 *
 * ----------------------------------------------------------------------------------------------
 * THIS LANE OWNS `cursed`, AND IT AUTHORS NONE. The rule was re-read before deciding
 * (`src/schemas.ts:304-311` - hidden until attunement and NOTHING more - with the precondition at
 * `:329-333`, *"A cursed item must require attunement - attunement is both what springs the curse
 * and what reveals it"*). **MEASURED over the committed bundle: 0 of this lane's 56 rows carry
 * `cursed: true`, and of the 5 rows in the whole 268 whose description contains the word "cursed",
 * NONE is this lane's** - `armor-of-vulnerability`, `berserker-axe`, `demon-armor` and
 * `shield-of-missile-attraction` are C7a's, and `mysterious-deck` is `slot: wondrous` and therefore
 * C7d's. `Robe of Eyes` prints a "Drawbacks" clause and is deliberately NOT made cursed: you can
 * take the robe off, and inventing a curse the SRD does not print would lock a benefit on. Owning
 * the vocabulary and having no carrier is the finding, not an oversight.
 *
 * ----------------------------------------------------------------------------------------------
 * WHAT THIS LANE PRODUCED, as an output rather than a target:
 *
 *   18 of 56 items carry at least one authored rider - **shoulders 5, head 4, neck 4, hands 3,
 *   feet 2, belt 0.** 38 of 56 are prose-only records, every one named below with its reason.
 *   The 38 split:
 *      4  the schema REFUSES their central mechanic outright (`ability-score`);
 *      4  RESERVED for a later unit (U31, U32, U26/U29 x2);
 *      2  HEALING (W7, and the known-bugs entry it cites);
 *      5  emptied by W6 - a cast whose spell record describes the spell rather than the cast;
 *     10  OVER-GRANTS - the vocabulary can only say something broader than the printed text;
 *     13  no vocabulary at all - movement modes, vision, planar travel, GM-fiat tables.
 *
 *   **WAS 19 AND 37 AT `3a8acb3`.** `robe-of-the-archmagi` moved from authored to over-grant when
 *   review measured what its `spell-save-dc` actually raises (W8); the arithmetic between the two
 *   readings is 19 - 1 = 18 authored, 9 + 1 = 10 over-grants, 37 + 1 = 38 absences, shoulders 6 - 1
 *   = 5. Nothing else moved.
 *
 *   ELEVEN of the 18 authored items ALSO carry a per-item absence for a half that is not
 *   expressible; those are stated at the entry rather than counted here. Only SEVEN rows in this
 *   whole lane are authored with nothing left over - `bracers-of-defense`, `gloves-of-thievery`,
 *   `hat-of-disguise`, `helm-of-comprehending-languages`, `medallion-of-thoughts`,
 *   `periapt-of-proof-against-poison`, and the far end `cloak-of-protection`.
 *
 * `apps/server/test/item-mechanics-c7c.test.ts` machine-checks MOST of this against the bundle -
 * **and review narrowed this sentence, which used to claim all of it.** What the test really pins:
 * the 56 rows, the 46 attuned, the six-way slot split, the 18 authored BY ID, the 38 remainder, the
 * per-slot authored split, the 5 W6 casts, the 2 healing rows, the 4 reserved + 4 ability-score
 * refusals, the 8 advantage-on-check rows and the 0 curses. What it does NOT pin is the
 * **10 over-grants / 13 no-vocabulary** line: those two groups are editorial readings of the same
 * prose-only rows, so a row can move between THEM with nothing failing. Every other number above
 * moves a test if it drifts.
 */
import type { ItemMechanicsModule } from "./overlay.js";

export const WORN_WONDROUS: ItemMechanicsModule = {
  // =============================================================================================
  // BELT - 2 rows. 0 authored.
  // =============================================================================================

  /*
   * `belt-of-dwarvenkind` - six printed benefits and not one of them lands.
   *   "Toughness. Your Constitution increases by 2, to a maximum of 20" - `ability-score`, which
   *       `ITEM_REFUSED_MODIFIER_TYPES` refuses on an item carrier: *"An item cannot change hit
   *       points or an ability score yet - those are baked into the sheet and cannot be un-granted
   *       when the item comes off."*
   *   "Dwarvish. You know Dwarvish" - C7a's limit (E), re-measured: `equipment-derivation.ts:576`
   *       writes `grants.languages` into `derivation.languages` and NOTHING reads that field.
   *   "Advantage on Charisma (Persuasion) checks made to interact with dwarves and duergar" - W1.
   *   "Darkvision. You have Darkvision with a range of 60 feet" - W2, AND (review) it sits under the
   *       same *"If you aren't a dwarf or duergar"* gate as the two Resilience halves below, which
   *       this list used to apply to those two only. So it is W2 and W3 together, not W2 alone.
   *   "Resilience. You have Resistance to Poison damage. You also have Advantage on saving throws you
   *       make to avoid or end the Poisoned condition" - both printed under *"If you aren't a dwarf
   *       or duergar"*. `grants.when` (W3, closed) can now carry a gate, but not a NEGATED species
   *       one, so the resistance half waits on W3's remaining ruling; the save half is W4 besides.
   *   "while attuned to the belt, you have a 50 percent chance each day at dawn of growing a full
   *       beard if you can grow one, or a thicker beard if you already have one" - review added this
   *       one; the entry omitted it entirely. It is a per-day percentage roll with a cosmetic
   *       outcome: no vocabulary, and nothing at the table to enforce.
   * UNBLOCKED BY: no single unit; W1-W4 each name their own gap. Prose.
   *
   * `belt-of-giant-strength` - "your Strength changes to a score granted by the belt". The scores
   * are a TABLE rather than a sentence - its `Belt` / `Str.` / `Rarity` columns run from
   * `Belt of Giant Strength (hill)` at 21 to `(storm)` at 29. (This entry used to render those cells
   * as one continuous quotation - *"... (hill): Str. 21 ... (storm): Str. 29"* - which reads as
   * printed prose and is not; review unstitched it. The numbers are exact.) One of the SEVEN items
   * whose central mechanic the schema refuses
   * by design, quoted here rather than worked around: *"An item cannot change hit points or an
   * ability score yet - those are baked into the sheet and cannot be un-granted when the item comes
   * off. Use a specific bonus instead: armor-class, save-bonus, check-bonus, or spell-save-dc. (Both
   * stay available on a feat.)"* (`src/character-content.ts:263`, enforced at `src/schemas.ts:338-341`.)
   * Inventing a modifier type to work around it is a VOCABULARY decision and belongs to a unit, not
   * to a content author. UNBLOCKED BY: a unit that gives an item a layered ability score. Prose.
   */

  // =============================================================================================
  // FEET - 7 rows. 2 authored.
  // =============================================================================================

  /*
   * `boots-of-elvenkind` - "your steps make no sound" (no sound model) and "Advantage on Dexterity
   * (Stealth) checks" (W1). A flat `check-bonus` would be a different sentence. Prose.
   *
   * `boots-of-levitation` - "you can cast Levitate on yourself." W6, and this one is only visible
   * from the far end: `levitate`'s record carries `save: "con"`, so `castAction` emits
   * `save: {ability: "con", dc: 10}` (MEASURED) and the wearer would be prompted to save against
   * their own boots. The Con save Levitate prints is the one an UNWILLING target makes, and the
   * boots print "on yourself". UNBLOCKED BY: known-bugs `[content/spells]`, second entry. Prose.
   *
   * `boots-of-speed` - "the boots double your Speed, and any creature that makes an Opportunity
   * Attack against you has Disadvantage on the attack roll ... a total of 10 minutes." Three ways
   * this fails: doubling is not a flat `speed` amount and `speed` reaches nothing anyway (W2); the
   * 10-minute budget is a duration, not a use count; and the opportunity-attack half cannot be
   * narrowed - MEASURED at `action-resolution.ts:602`, the TARGET's `incoming-attack` riders are
   * collected with `{...moment.target.context, moment: pass}` and NO `filters`, so an
   * `attack-kind-is: ["opportunity"]` on a defender's rider has no `attackKinds` to match and fails
   * closed. Authoring it ungated is disadvantage on every incoming attack, forever.
   * UNBLOCKED BY: no unit. Prose.
   *
   * `boots-of-striding-and-springing` - "your Speed becomes 30 feet unless your Speed is higher"
   * (a floor, not a bonus, and W2), "your Speed isn't reduced by ... carrying weight in excess of
   * your carrying capacity or wearing Heavy Armor" (no encumbrance model), "you can jump up to 30
   * feet by spending only 10 feet of movement" (no jump model). UNBLOCKED BY: no unit. Prose.
   *
   * `slippers-of-spider-climbing` - "you can move up, down, and across vertical surfaces and along
   * ceilings, while leaving your hands free. You have a Climb Speed equal to your Speed. However,
   * the slippers don't allow you to move this way on a slippery surface, such as one covered by ice
   * or oil." There is no movement-mode model: no climb, swim or fly speed anywhere on the actor -
   * and (review restored the third sentence) no surface model for the exception that would gate it
   * even if there were. UNBLOCKED BY: no unit. Prose.
   */

  /**
   * BOOTS OF THE WINTERLANDS - "Cold Resistance. You have Resistance to Cold damage ..."
   * (the ellipsis is review's: the SRD sentence continues "and can tolerate temperatures of 0
   * degrees Fahrenheit or lower without any additional protection", which the ABSENT list below
   * already carries. It was cut here with a fabricated full stop.)
   *
   * Unconditional in the printed text, which is what separates it from the two resistances still
   * refused above: nothing gates it on a species, a gem or a state, so it needs no `grants.when` and
   * has none - the record is byte-identical either side of W3. The reader is the damage pipeline
   * (`hit-points.ts:181`), and it names the item on the damage line.
   *
   * ABSENT: "can tolerate temperatures of 0 degrees Fahrenheit or lower" (no environment model) and
   * "You ignore Difficult Terrain created by ice or snow" (movement cost is not modelled - the same
   * gap C7b records on `ring-of-free-action`). Unit: NONE YET. This absence list is complete.
   */
  "boots-of-the-winterlands": { grants: { damageResistances: ["cold"] } },

  /**
   * WINGED BOOTS - "These boots have 4 charges and regain 1d4 expended charges daily at dawn. While
   * wearing the boots, you can take a Magic action to expend 1 charge, gaining a Fly Speed of 30
   * feet for 1 hour."
   *
   * The charge-alone shape, stated in the header: 4 uses is exact, one press spends exactly one, and
   * the economy refuses the fifth. What the charge BUYS is a Fly Speed, which is GM-adjudicated
   * movement (W2 - there is no speed field an item can reach), so the boots enforce the half the
   * engine owns and the GM narrates the half it does not.
   *
   * L2 (C7b) applies to the recovery and is stated rather than hidden: "1d4 expended charges daily
   * at dawn" becomes a full refill on a long rest, because `FeatureUsesSchema.per` has no partial
   * form. The pool SIZE and the refusal at zero are exact; the RECOVERY is generous.
   */
  "winged-boots": {
    actions: [{
      id: "fly", name: "Winged Flight", activation: "action",
      description: "Expend 1 charge to gain a Fly Speed of 30 feet for 1 hour. If you are flying when the duration expires, you descend at a rate of 30 feet per round until you land.",
      uses: { limit: 4, per: "long-rest", pool: "winged-boots-charges" }
    }]
  },

  // =============================================================================================
  // HANDS - 6 rows. 3 authored.
  // =============================================================================================

  /**
   * BRACERS OF ARCHERY - "you have proficiency with the Longbow and Shortbow".
   *
   * `grants.weapons` USED to be documented in `./overlay.ts` as a proficiency GROUP list
   * (`simple|martial`) that no bundle's id column could satisfy - but the reader is wider than that
   * and this lane checked rather than assumed. `weaponAction` (`equipment-derivation.ts:1003`)
   * computes `granted = grantedWeapons.includes(weapon.category) || grantedWeapons.includes(item.id)`,
   * so a BASE WEAPON ID is a first-class value here, and `longbow` / `shortbow` are two of the 38
   * ids in `bundles/weapons.v1.json`. MEASURED on a hero whose `proficiencies.weapons` is `[]` and
   * whose `proficiencyBonus` is 3: an equipped Longbow's derived to-hit is **2** without the bracers
   * (Dex +2, untrained) and **5** with them - Dex +2 plus the proficiency bonus 3, on the swing,
   * from the bracers. A Longsword beside it stays at 0, so the grant really is the two bows.
   *
   * THE SEAM WAS CORRECTED RATHER THAN LEFT DISAGREEING WITH THIS ENTRY (review finding): `weapons`
   * sat in `OPEN_BY_DESIGN`, so `long-bow` would have parsed, shipped and granted nothing - check
   * 5's own stated failure mode, on the one key check 5 was not watching. It is cross-checked now
   * against the weapon ids and the `category` groups together, and the stale comment is gone.
   *
   * ABSENT: "you gain a +2 bonus to damage rolls made with such weapons." C7a's limit (A): there is
   * no flat `damage-bonus` in `FeatureModifierSchema`, `extra-damage`'s `formula` is a
   * `DiceFormulaSchema` and refuses `{formula: "2"}`, and its `abilityModifier` channel resolves
   * against the bearer rather than saying "2". Narrowing it to these two bows is a second problem
   * (`weapon-property-is` names a PROPERTY, not a weapon). Unit: NONE YET.
   */
  "bracers-of-archery": { grants: { weapons: ["longbow", "shortbow"] } },

  /**
   * BRACERS OF DEFENSE - "you gain a +2 bonus to Armor Class if you are wearing no armor and using
   * no Shield."
   *
   * `while-unarmored` with the default `allowShield: false` is that sentence exactly:
   * `riders.ts:167-168` requires `armorWeight == null && shieldEquipped !== true`. It is a STATIC
   * gate, so it is evaluated in the standing pass and the number is live on the sheet rather than
   * only at a roll. MEASURED through `setInventoryItem`: 12 -> **14** with the bracers alone, and
   * **14** again once a Shield is equipped (10 + Dex 2 + shield 2) - the bracers' +2 is off, which
   * is the half of this rider that would be invisible if the gate silently passed.
   *
   * The row prints nothing else. This absence list is empty.
   */
  "bracers-of-defense": {
    modifiers: [{ type: "armor-class", amount: 2, when: [{ type: "while-unarmored" }] }]
  },

  /*
   * `gauntlets-of-ogre-power` - "Your Strength is 19 while you wear these gauntlets." One of the
   * seven refused items, with the schema's own words beside it: *"An item cannot change hit points
   * or an ability score yet - those are baked into the sheet and cannot be un-granted when the item
   * comes off. Use a specific bonus instead: armor-class, save-bonus, check-bonus, or spell-save-dc.
   * (Both stay available on a feat.)"* No workaround is attempted; that is a vocabulary decision and
   * belongs to a unit. UNBLOCKED BY: a unit that gives an item a layered ability score. Prose.
   *
   * `gloves-of-missile-snaring` - "If you're hit by an attack roll made with a Ranged or Thrown
   * weapon while wearing these gloves, you can take a Reaction to reduce the damage by 1d10 plus
   * your Dexterity modifier if you have a free hand. If you reduce the damage to 0, you can catch
   * the ammunition or weapon if it is small enough for you to hold in that hand."
   *
   * **THIS ENTRY USED TO SAY "RESERVED: needs `on-taking-damage` + `damage-reduction` wired
   * together. UNBLOCKED BY: U31", AND THAT HALF WAS A FALSE RECORD** (review). They ARE wired, in
   * shipped server code: `damageReductionFor` (`apps/server/src/hit-points.ts:132-136`) collects
   * riders at `moment: "on-taking-damage"` with the incoming `damageTypes` and sums
   * `damage-reduction` off them. MEASURED 2026-08-12 by running
   * `apps/server/test/typed-damage.test.ts -t "on-taking-damage"`: *"honours the on-taking-damage
   * moment and its damage-type filter"* drives it on an ITEM carrier and passes today (1 passed |
   * 18 skipped) - 10 fire becomes 7 through the filter and 10 cold stays 10. The plan's U31 is
   * *"one new `collectRiders` call"* (`docs/product/plan-content-program.md:1091`) and that call
   * exists. The risk of leaving it pointed here is directional: a later pass that reads this, sees
   * U31 land and "unblocks" the item would author a flat `damage-reduction` - a rider that reaches
   * the damage pipeline and pays the wrong number every time.
   *
   * IT IS STILL AN ABSENCE, and these three reasons are the whole record now. Each stands alone:
   *   `damage-reduction` is a FLAT INTEGER and the SRD prints "1d10 plus your Dexterity modifier" -
   *       a ROLLED amount, which the vocabulary cannot say at any moment. (This is the half U31
   *       does not cover, and `Ring of Warmth`'s "reduces the damage you take by 2d8" - C7b's, and
   *       U31's other named carrier - is the same gap, so the unit is under-specified for both.)
   *   The printed gate is "if you have a free hand". No trigger describes a hand count;
   *       `while-shield` and `while-unarmored` are the nearest and neither is one.
   *   It costs a **Reaction**, and an item rider has no reaction economy - so the reduction would
   *       apply to every qualifying hit, free, rather than once when the player spends for it.
   * UNBLOCKED BY: a ROLLED `damage-reduction` amount (U31 as written does not deliver it), a
   * free-hand gate, and a reaction cost on an item rider. No unit for any of the three. Prose.
   *
   * `gloves-of-swimming-and-climbing` - "you have a Climb Speed and a Swim Speed equal to your
   * Speed, and you gain a +5 bonus to Strength (Athletics) checks made to climb or swim." The speeds
   * are W2's gap. The +5 looks exactly like `Gloves of Thievery` below and is NOT the same sentence:
   * "made to climb or swim" narrows INSIDE the skill, and `skill-is` is the finest filter there is -
   * so the rider would hand +5 to every Athletics check, grappling and shoving included. That is an
   * over-grant on a legendary-adjacent number. UNBLOCKED BY: no unit; needs a within-skill filter.
   * Prose. (See `rulingsOwed` - a GM who wants the simple reading can add it in homebrew.)
   */

  /**
   * GLOVES OF THIEVERY - "you gain a +5 bonus to Dexterity (Sleight of Hand) checks."
   *
   * The one item in this lane whose sentence the vocabulary was WRITTEN for -
   * `FeatureModifierSchema`'s `check-bonus` comment says so in as many words: *"Gloves of Thievery
   * (+5 Sleight of Hand) is literally this."* The `on-ability-check` moment is what puts the rider in
   * the momentary pass, and `skill-is` is what keeps it on one row. MEASURED on the derived sheet:
   * Sleight of Hand **+7** (Dex +2 and the glove's +5), Stealth **+2** - same ability, untouched.
   *
   * No attunement, so it is live the moment they are worn. "These gloves are imperceptible while
   * worn" is flavour. This absence list is empty.
   */
  "gloves-of-thievery": {
    modifiers: [{
      type: "check-bonus", amount: 5,
      when: [{ type: "on-ability-check" }, { type: "skill-is", skills: ["sleight-of-hand"] }]
    }]
  },

  // =============================================================================================
  // HEAD - 11 rows. 4 authored.
  // =============================================================================================

  /*
   * `circlet-of-blasting` - "you can cast Scorching Ray with it (+5 to hit). The circlet can't cast
   * this spell again until the next dawn." (Review restored the second sentence: the entry quoted
   * only the first and so never named the printed 1/dawn - which `uses` COULD have said, and which
   * a reader would otherwise take as unlimited. It changes nothing here, because the cast itself is
   * refused and a counter with no cast behind it enforces nothing.) W6, twice over.
   * MEASURED: the derived cast is `damage: [{formula: "2d6", type: "fire"}]` and `attack: {bonus: 2}`
   * - 2d6 is ONE of Scorching Ray's THREE rays (the Wand of Magic Missiles error the round-1 review
   * found), and the bonus is the WEARER's derived number, not the circlet's printed **+5**, because
   * `FeatureAttackSchema` carries no flat to-hit (C7b's L5). Authoring it would ship a cantrip-sized
   * attack at the wrong bonus wearing a level-2 spell's name. UNBLOCKED BY: known-bugs
   * `[content/spells]`, second entry, plus a flat attack bonus on an item cast. Prose.
   */

  /**
   * EYES OF CHARMING - "They have 3 charges. While wearing them, you can expend 1 or more charges to
   * cast Charm Person (save DC 13) ... For 1 charge, you cast the level 1 version of the spell."
   *
   * The ONE-charge property, which is the only one L1 (C7b) allows: `resolveDefinitionAction` debits
   * exactly one use per resolution, so a 2- or 3-charge upcast cannot be said as a cost. What lands
   * is exact - three uses, the printed DC 13, and the spell's own Wisdom save.
   * `charm-person`'s record was re-checked against W6: `damage.roll` null, `attackRoll` false,
   * `save: "wis"` - a cast synthesises no damage and no attack, only the save the target really makes.
   *
   * ABSENT: "You increase the spell's level by one for each additional charge you expend."
   * `atLevel` is a fixed authored level, not a player choice at cast time, and the extra charges are
   * L1's gap. Unit: NONE YET. This absence list is complete.
   */
  "eyes-of-charming": {
    casts: [{
      spellId: "charm-person", saveDc: 13,
      uses: { limit: 3, per: "long-rest", pool: "eyes-of-charming-charges" }
    }]
  },

  /*
   * `eyes-of-minute-seeing` - "granting you Darkvision within that range and Advantage on
   * Intelligence (Investigation) checks made to examine something within that range." W2 and W1, and
   * the range is one foot. Prose.
   *
   * `eyes-of-the-eagle` - "you have Advantage on Wisdom (Perception) checks that rely on sight. In
   * conditions of clear visibility, you can make out details of even extremely distant creatures and
   * objects as small as 2 feet across." W1 for the first half; the second (review restored it) is a
   * perception RANGE, which nothing on the actor carries - the sheet's Senses line is the
   * definition's species extension and takes no item. UNBLOCKED BY: W1's missing `roll: "check"`
   * consumer, and a senses model for the range. Prose.
   *
   * `goggles-of-night` - "you have Darkvision out to 60 feet. If you already have Darkvision,
   * wearing the goggles increases its range by 60 feet." W2: `darkvision` is not even summed into
   * the derivation, and the sheet's Senses line comes from the definition's species extension.
   * UNBLOCKED BY: a senses model an item can layer on. Prose.
   */

  /**
   * HAT OF DISGUISE - "you can cast the Disguise Self spell."
   *
   * The `ring-of-jumping` shape (C7b): an unlimited self-cast whose spell record is clean, so the
   * cast becomes a named action on the sheet and the GM adjudicates the disguise. Re-checked against
   * W6 - `disguise-self` is `{roll: null, types: []}`, `attackRoll: false`, `save: null`, so the
   * derived action carries no damage, no attack and no save at all.
   *
   * "The spell ends if the hat is removed" is prose; there is no effect to end. Absence list empty.
   */
  "hat-of-disguise": { casts: [{ spellId: "disguise-self" }] },

  /*
   * `headband-of-intellect` - "Your Intelligence is 19 while you wear this headband." The third of
   * this lane's four refused items, with the schema's own message beside it: *"An item cannot change
   * hit points or an ability score yet - those are baked into the sheet and cannot be un-granted
   * when the item comes off. Use a specific bonus instead: armor-class, save-bonus, check-bonus, or
   * spell-save-dc. (Both stay available on a feat.)"* UNBLOCKED BY: a unit that gives an item a
   * layered ability score. Prose.
   *
   * `helm-of-brilliance` - seven printed properties on one row and not one is authorable.
   *   "Diamond Light ... Any Undead that starts its turn in that area takes 1d6 Radiant damage" -
   *       there is no emanation or start-of-turn aura vocabulary.
   *   "Fire Opal Flames ... the target takes an extra 1d6 Fire damage" - an `extra-damage` rider on
   *       a helm resolves to the BEARER (C7b's L4) and would burn every weapon they swing, with no
   *       toggle for the Magic action that lights it and the Bonus Action that puts it out.
   *   "Ruby Resistance. As long as the helm has at least one ruby, you have Resistance to Fire
   *       damage" - W3's remaining half. `grants.when` exists now, but the gate is a COUNT of gems on
   *       the item and no trigger reads item state, so authoring it is still permanent Fire
   *       resistance on a very-rare helm.
   *   "Spells ... using one of the helm's gems of the specified type as a component" - the cost is a
   *       gem, not a charge, and the gem is destroyed; W5's shape with no pool to spend.
   *   "Roll 1d20 if you are wearing the helm and take Fire damage ... On a roll of 1, the helm ... is
   *       destroyed" - a random self-destruct with no moment to hang on.
   * UNBLOCKED BY: no unit. Prose - and this is the item in the lane that most looks authorable and
   * is not.
   */

  /**
   * HELM OF COMPREHENDING LANGUAGES - "you can cast Comprehend Languages from it."
   *
   * `comprehend-languages` re-checked against W6: no damage roll, no attack, no save. The cast is
   * the whole printed sentence and it carries no limit, which is what the SRD prints.
   *
   * NOTE the contrast with `Belt of Dwarvenkind`'s "You know Dwarvish", which is an absence: a
   * `grants.languages` list reaches no reader (C7a's limit E), while a CAST reaches the action list.
   * Same subject, different vocabulary, different answer. Absence list empty.
   */
  "helm-of-comprehending-languages": { casts: [{ spellId: "comprehend-languages" }] },

  /**
   * HELM OF TELEPATHY - "you can cast Detect Thoughts or Suggestion (save DC 13) from the helm. Once
   * either spell is cast from the helm, that spell can't be cast from it again until the next dawn."
   *
   * TWO POOLS, NOT ONE, and the SRD's wording is why: *"that spell can't be cast from it again"*
   * gates each spell independently, so a shared pool would let one casting lock out the other. Each
   * gets `limit: 1` under its own pool id. Both records were re-checked against W6 - `detect-thoughts`
   * and `suggestion` are `{roll: null, types: []}`, `attackRoll: false`, `save: "wis"` - so each cast
   * carries only the Wisdom save the printed DC 13 belongs to.
   *
   * ABSENT: "you have telepathy with a range of 30 feet." There is no communication model, and
   * `sense` would reach nothing (W2). Unit: NONE YET. This absence list is complete.
   */
  "helm-of-telepathy": {
    casts: [
      { spellId: "detect-thoughts", saveDc: 13, uses: { limit: 1, per: "long-rest", pool: "helm-of-telepathy-detect-thoughts" } },
      { spellId: "suggestion", saveDc: 13, uses: { limit: 1, per: "long-rest", pool: "helm-of-telepathy-suggestion" } }
    ]
  },

  /*
   * `helm-of-teleportation` - "This helm has 3 charges. While wearing it, you can expend 1 charge to
   * cast Teleport from it." The charges and the one-charge cost are both exact, and the cast is
   * still refused: W6, in its worst measured form. `teleport`'s record is
   * `{roll: "1d100", types: []}` because the SRD prints a d100 MISHAP table, and `castAction` reads
   * `damage.roll` as the cast's damage and `types[0] ?? "force"` as its type - MEASURED, the derived
   * action is `damage: [{formula: "1d100", type: "force"}]`. A player pressing the helm would roll
   * up to a hundred points of Force damage at whoever they targeted. Authoring the CHARGE alone was
   * considered and rejected: the header's charge-alone rule requires that what the charge buys is
   * GM-adjudicated, and Teleport is a spell the item is supposed to CAST.
   * UNBLOCKED BY: known-bugs `[content/spells]`, second entry. Prose.
   */

  // =============================================================================================
  // NECK - 15 rows. 4 authored.
  // =============================================================================================

  /*
   * `amulet-of-health` - "Your Constitution is 19 while you wear this amulet." The last of this
   * lane's four refused items, with the schema's message beside it: *"An item cannot change hit
   * points or an ability score yet - those are baked into the sheet and cannot be un-granted when
   * the item comes off. Use a specific bonus instead: armor-class, save-bonus, check-bonus, or
   * spell-save-dc. (Both stay available on a feat.)"* The Constitution cascade is exactly why: it
   * would move hit points, the Con save, initiative order and concentration at once.
   * UNBLOCKED BY: a unit that gives an item a layered ability score. Prose.
   *
   * `amulet-of-proof-against-detection-and-location` - "you can't be targeted by Divination spells
   * or perceived through magical scrying sensors unless you allow it." NEEDS: an immunity keyed to a
   * SCHOOL of magic rather than a damage type or a condition - the same gap C7b records on
   * `ring-of-mind-shielding`. UNBLOCKED BY: no unit. Prose.
   *
   * `amulet-of-the-planes` - "While wearing this amulet, you can take a Magic action to name a
   * location that you are familiar with on another plane of existence. Then make a DC 15 Intelligence
   * (Arcana) check. On a successful check, you cast Plane Shift. On a failed check, you and each
   * creature and object within 15 feet of you travel to a random destination determined by rolling
   * 1d100 and consulting the following table." Nothing in the vocabulary gates a cast behind an
   * ability check, and
   * authoring `casts: [{spellId: "plane-shift"}]` would delete the check entirely - a guaranteed
   * planar jump where the SRD prints a failed check into a d100 destination table.
   *
   * **THE OLD WORDING SAID "a 30 percent chance of a d100 mishap table" AND THE SRD PRINTS NO SUCH
   * NUMBER** (review). The table (`magic-items.md:673-708`) is 01-60 "Random location on the plane
   * you named", 61-70 an Inner Plane, 71-80 / 81-90 Outer Planes, 91-00 the Astral Plane - 40 percent
   * a wrong PLANE, not 30 - and whether the table is rolled at all depends on failing a DC 15 check,
   * whose odds are the character's and are not printed anywhere. The item is an absence either way;
   * the invented percentage is the defect. UNBLOCKED BY: no unit. Prose.
   */

  /**
   * BROOCH OF SHIELDING - "you have Resistance to Force damage".
   *
   * Unconditional and typed, which is the shape the damage pipeline reads (`hit-points.ts:181`).
   *
   * ABSENT: "you have Immunity to damage from the Magic Missile spell." `grants.damageImmunities`
   * is keyed by DAMAGE TYPE, and immunity to Force would be strictly more than the SRD prints -
   * every Force effect in the game rather than one spell. NEEDS: an immunity keyed to a spell id.
   * Unit: NONE YET. This absence list is complete.
   */
  "brooch-of-shielding": { grants: { damageResistances: ["force"] } },

  /**
   * MEDALLION OF THOUGHTS - "The medallion has 5 charges. While wearing it, you can expend 1 charge
   * to cast Detect Thoughts (save DC 13) from it."
   *
   * One charge per cast is what L1 allows and what the SRD prints, so nothing is approximated except
   * the recovery (L2: "regains 1d4 expended charges daily at dawn" becomes a full refill on a long
   * rest). `detect-thoughts` re-checked against W6: no damage, no attack, a Wisdom save the printed
   * DC belongs to. The pool size and the refusal at zero are exact. Absence list empty.
   */
  "medallion-of-thoughts": {
    casts: [{
      spellId: "detect-thoughts", saveDc: 13,
      uses: { limit: 5, per: "long-rest", pool: "medallion-of-thoughts-charges" }
    }]
  },

  /*
   * `necklace-of-adaptation` - "you can breathe normally in any environment, and you have Advantage
   * on saving throws made to avoid or end the Poisoned condition." The first half has no environment
   * model; the second is W4 - a save cannot be narrowed to what it is against, so the rider would be
   * advantage on EVERY saving throw. UNBLOCKED BY: no unit. Prose.
   *
   * `necklace-of-fireballs` - "This necklace has 1d6 + 3 beads ... the bead detonates as a level 3
   * Fireball (save DC 15)." W5: a bead is DETACHED and thrown, so the charges never come back, and
   * `FeatureUsesSchema.per` has no non-renewing value - a pool authored here would refill on a long
   * rest and hand the table an endless necklace. Authoring the cast with NO pool is worse still
   * (an unlimited DC-15 Fireball). The bead count is also rolled at creation rather than fixed, and
   * "increase the damage of the Fireball by 1d6 for each bead after the first" is L1's gap.
   * UNBLOCKED BY: a non-renewing `per`. Prose.
   *
   * `necklace-of-prayer-beads` - "This necklace has 1d4 + 2 magic beads ... Six types of magic beads
   * exist. The GM decides the type of each bead on the necklace or determines it randomly by rolling
   * on the table below." The healing one is a TABLE ROW, not a sentence: under the `1d20` / `Bead` /
   * `Spell` columns, `7-12` is `Bead of Curing` casting `Cure Wounds (level 2 version)`. (Review
   * unstitched that too - it used to read *"... Bead of Curing, Spell Cure Wounds (level 2
   * version)."*, which pulls the column header `Spell` into what looks like printed prose.)
   * W7 covers the Bead of Curing outright - `cure-wounds` ships as `{roll: "2d8",
   * types: []}` and a cast synthesises 2d8 FORCE damage at whoever it is pointed at, which is the
   * exact failure `docs/ai-ledger/known-bugs.md` records. The rest of the item is a GM-fiat
   * composition: which 1d4+2 of six beads this copy carries is decided per necklace, so there is no
   * single authored row that is right. UNBLOCKED BY: known-bugs `[content/spells]`, first entry, and
   * then a per-copy composition the vocabulary has no shape for. Prose.
   *
   * `periapt-of-health` - "you can take a Magic action to regain 2d4 + 2 Hit Points. Once used, this
   * property can't be used again until the next dawn. In addition, you have Advantage on saving
   * throws to avoid or end the Poisoned condition." W7: healing is an absence, always - nothing in
   * `featureRiders` restores hit points, and expressing it as negative damage or temporary hit
   * points is explicitly not attempted. The second half is W4. The 1/dawn CHARGE alone was
   * considered and rejected: what the charge buys here is a NUMBER the sheet owns, so a button that
   * says "regain 2d4 + 2" and moves no hit points is exactly the invisible-wrong the admission rule
   * is about. UNBLOCKED BY: known-bugs `[content/spells]` (healing), and W4. Prose.
   */

  /**
   * PERIAPT OF PROOF AGAINST POISON - "While you wear it, you have Immunity to the Poisoned
   * condition and Poison damage."
   *
   * BOTH halves land and both readers were checked. The damage immunity joins the definition's own
   * before `adjustDamageParts` (`hit-points.ts:186`), so a poison total becomes 0 with the periapt's
   * name on the line. The condition immunity is read by `setCondition`
   * (`actor-conditions.ts:52-56`), which NARRATES the skip rather than blocking the GM's command -
   * and that function's own comment names a Periapt as the item whose granted immunity used to be
   * derived and dropped.
   *
   * THIS IS NOT `ring-of-free-action`'s OVER-GRANT, and the difference is the printed text rather
   * than a preference. C7b refused that ring because the SRD gates it on *"MAGIC can neither ...
   * cause you to have the Paralyzed or Restrained condition"* and a granted immunity is absolute.
   * This periapt prints no source at all: immunity to the Poisoned condition, full stop. What the
   * vocabulary can say and what the SRD prints are the same sentence here.
   *
   * The row prints nothing else. This absence list is empty.
   */
  "periapt-of-proof-against-poison": {
    grants: { damageImmunities: ["poison"], conditionImmunities: ["poisoned"] }
  },

  /*
   * `periapt-of-wound-closure` - "Life Preservation. Whenever you make a Death Saving Throw, you can
   * change a roll of 9 or lower to a 10 ... Natural Healing Boost. Whenever you roll a Hit Point Die
   * to regain Hit Points, double the number of Hit Points it restores." RESERVED: the first half
   * needs `on-death-save` + `roll-mode: "death-save"` wired together, and MEASURED here, `roll-mode`
   * has consumers for four rolls and `death-save` is not one of them. UNBLOCKED BY: **U32**. The
   * second half is W7 (healing) and would still be an absence after U32 lands. Prose.
   */

  /**
   * SCARAB OF PROTECTION - "Defense. You gain a +1 bonus to Armor Class."
   *
   * The one third of this legendary medallion the vocabulary can say exactly. `armor-class` is a
   * standing bearer rider, so the number is live on the sheet and comes off with the scarab.
   *
   * ABSENT, both halves, and each for its own reason:
   *   "Preservation. The scarab has 12 charges. If you fail a saving throw against a Necromancy
   *       spell or a harmful effect originating from an Undead, you can take a Reaction to expend 1
   *       charge and turn the failed save into a successful one. The scarab crumbles into powder and
   *       is destroyed when its last charge is expended." Two gaps: nothing in the vocabulary edits
   *       a save's OUTCOME (`save-bonus` and `roll-mode` move the roll, not the result - C7b records
   *       the same on `ring-of-evasion`), and W5 refuses the pool, because a `per: "long-rest"`
   *       counter would refill a scarab the SRD has destroyed. That second reason is why this is NOT
   *       the charge-alone shape `winged-boots` uses. Unit: NONE YET.
   *   "Spell Resistance. You have Advantage on saving throws against spells." W4. Unit: NONE YET.
   */
  "scarab-of-protection": { modifiers: [{ type: "armor-class", amount: 1 }] },

  /*
   * `talisman-of-pure-good` and `talisman-of-ultimate-evil` - both print "Holy Symbol ... You gain a
   * +2 bonus to spell attack rolls while you wear or hold it." RESERVED, and ENFORCED rather than
   * merely requested: `applyItemMechanics` refuses `spell-attack-bonus` outright, because
   * `CARRIER_RIDER_DISPOSITION` (`apps/server/src/character-build.ts:302`) marks it `"unread"` - the
   * modifier is collected at `equipment-derivation.ts:682` and applied by nothing.
   * UNBLOCKED BY: **U26** (the reader) and **U29** (`attack-kind-is: "spell"`, so the bonus can be
   * narrowed to a spell attack).
   * Their other halves are absences of their own, and **the two touch clauses are DIFFERENT
   * sentences - review found this entry quoting Pure Good's at both items.** Pure Good prints "A
   * Fiend or an Undead that touches the talisman takes 8d6 Radiant damage and takes the damage again
   * each time it ends its turn holding or carrying the talisman"; Ultimate Evil prints the inverse,
   * "A creature that isn't a Fiend or an Undead that touches the talisman takes 8d6 **Necrotic**
   * damage and takes the damage again each time it ends its turn holding or carrying the talisman."
   * Both are absent for the same two reasons - there is no touch moment, and `versus-creature-type`
   * has no producer (C7a's limit B) - but the record must say what each item prints, not what its
   * sibling does. The 7- and 6-charge fissures are W5: both talismans are destroyed when the last
   * charge is spent, so a long-rest pool would resurrect them. Prose.
   *
   * `talisman-of-the-sphere` - "you have Advantage on any Intelligence (Arcana) check you make to
   * control a Sphere of Annihilation" (W1) "... you can take a Magic action to move it 10 feet plus
   * a number of additional feet equal to 10 times your Intelligence modifier" (there is no Sphere of
   * Annihilation to control - it is a C7d GM-fiat row - and no vocabulary for moving one).
   * UNBLOCKED BY: no unit. Prose.
   */

  // =============================================================================================
  // SHOULDERS - 15 rows. 6 authored.
  // =============================================================================================

  /*
   * `cape-of-the-mountebank` - "you can use it to cast Dimension Door as a Magic action. This
   * property can't be used again until the next dawn." The once-per-dawn counter is exact and the
   * cast is still refused: W6. MEASURED, the derived cast is
   * `damage: [{formula: "4d6", type: "force"}]` - the SRD's 4d6 is what BOTH creatures take when you
   * arrive in an occupied space, not damage a Dimension Door deals to a target, so every use would
   * roll it at whoever was targeted. ALSO ABSENT (review - the list stopped one clause short):
   * "When you teleport with that spell, you leave behind a cloud of smoke. The space you left is
   * Lightly Obscured by that smoke until the end of your next turn." There is no obscurement model
   * and no rider that marks a SPACE rather than a creature. UNBLOCKED BY: known-bugs
   * `[content/spells]`, second entry, for the cast; no unit for the smoke. Prose.
   */

  /**
   * CLOAK OF ARACHNIDA - "Poison Resistance. You have Resistance to Poison damage."
   *
   * Unconditional, so W3 does not touch it, and the reader is the damage pipeline.
   *
   * ABSENT, three halves:
   *   "Spider Climb. You have a Climb Speed equal to your Speed" - W2, no movement-mode model.
   *   "Spider Walk. You can't be caught in webs of any sort and can move through webs as if they
   *       were Difficult Terrain" - movement cost is not modelled.
   *   "Web. You can cast Web (save DC 13). The web created by the spell fills twice its normal
   *       area." - W6, and `known-bugs.md` names this spell by name: `web` ships as
   *       `{roll: "2d4", types: ["fire"]}` because the SRD deals that only to a creature that starts
   *       its turn in webs somebody set ON FIRE, so a cast would roll 2d4 Fire every time.
   * Unit: NONE YET for the first two; known-bugs `[content/spells]` for the third.
   */
  "cloak-of-arachnida": { grants: { damageResistances: ["poison"] } },

  /*
   * `cloak-of-displacement` - "it magically projects an illusion ... causing any creature to have
   * Disadvantage on attack rolls against you. If you take damage, the property ceases to function
   * until the start of your next turn. This property is suppressed while your Speed is 0."
   *
   * The reader not only ships, it names this item: `action-resolution.ts:601-604` collects the TARGET's
   * `incoming-attack` riders under the comment *"The TARGET's own gear (a Cloak of Displacement)
   * claims `incoming-attack` against this attack."* What cannot be said is the SUSPENSION, and it is
   * two thirds of the printed sentence: the cloak switches off for a round whenever the wearer takes
   * damage, and again whenever their Speed is 0. There is no vocabulary for a rider that suppresses
   * itself at a moment - `on-taking-damage` is a moment a rider FIRES at, not one it stops at - so
   * the only authorable form is permanent disadvantage on every attack made against the wearer.
   * That is strictly more than the SRD prints, on a rare item, in the direction a table would never
   * notice. Taken conservatively; see `rulingsOwed`.
   * UNBLOCKED BY: a suppression gate (a rider that a moment turns OFF for a duration). Prose.
   *
   * `cloak-of-elvenkind` - "Wisdom (Perception) checks made to perceive you have Disadvantage, and
   * you have Advantage on Dexterity (Stealth) checks." The first half is a rider on OTHER creatures'
   * checks about the wearer, which no scope can express; the second is W1. Prose.
   */

  /**
   * CLOAK OF INVISIBILITY - "This cloak has 3 charges and regains 1d3 expended charges daily at
   * dawn. While wearing the cloak, you can take a Magic action to pull its hood over your head and
   * expend 1 charge to give yourself the Invisible condition for 1 hour."
   *
   * The charge-alone shape. Three uses is exact, one press spends one, and the fourth is refused -
   * on a LEGENDARY cloak that is the whole of what the SRD rations.
   *
   * ABSENT: the Invisible condition itself. C7b records the identical gap on `ring-of-invisibility`
   * and it is quoted rather than restated: *"NEEDS: an action that applies a condition to the ACTOR.
   * `ActionSchema.onHit[].conditions` applies to a TARGET on a hit, and `ActionSchema.grants` grants
   * an EffectGrant whose modifier vocabulary has no condition."* The difference between that ring
   * and this cloak is why one is prose and the other is here: the ring prints no charges at all, so
   * there was nothing to enforce; the cloak prints three. The GM applies the condition with the
   * command they already have. Unit: NONE YET.
   *
   * L2 applies to the recovery ("1d3 expended charges daily at dawn" -> a full refill on a long
   * rest): the pool size and the refusal are exact, the recovery is generous.
   */
  "cloak-of-invisibility": {
    actions: [{
      id: "vanish", name: "Pull Up the Hood", activation: "action",
      description: "Expend 1 charge to give yourself the Invisible condition for 1 hour. The effect ends early if you pull the hood down (no action required) or cease wearing the cloak.",
      uses: { limit: 3, per: "long-rest", pool: "cloak-of-invisibility-charges" }
    }]
  },

  /**
   * CLOAK OF PROTECTION - "You gain a +1 bonus to Armor Class and saving throws while you wear this
   * cloak."
   *
   * **THIS LANE'S FAR END.** Two numbers and a reversal, and both readers were driven end to end:
   *   - `armor-class` reaches `actor.armorClass` through `deriveEquipment` on every inventory write
   *     (`inventory.ts:50`), so the sheet's AC moves the moment the cloak is worn and moves back the
   *     moment it is not. Criterion 3 of `apps/server/test/item-riders.test.ts` is the same shape on
   *     a ring: *"a ring changes AC and the change disappears on unequip"*.
   *   - `save-bonus` is summed into the save the SERVER rolls (`saving-throws.ts:160`), not a number
   *     the sheet displays - criterion 12.
   * No gate, no approximation, no half of the sentence left over. `ring-of-protection` (C7b) is the
   * identical pair of riders on a different slot, which is a second reading of the same evidence.
   *
   * The row prints nothing else. This absence list is empty.
   */
  "cloak-of-protection": {
    modifiers: [
      { type: "armor-class", amount: 1 },
      { type: "save-bonus", amount: 1 }
    ]
  },

  /*
   * `cloak-of-the-bat` - "you have Advantage on Dexterity (Stealth) checks" (W1); "In an area of Dim
   * Light or Darkness ... a Fly Speed of 40 feet" (W2, and a light-level gate with no vocabulary);
   * "While wearing the cloak in an area of Dim Light or Darkness, you can cast Polymorph on yourself
   * ... The cloak can't be used this way again until the next dawn." The cast is refused for the
   * same reason `boots-of-levitation` is: `polymorph` carries `save: "wis"` for an unwilling target
   * and the cloak prints "on yourself", so the derived action would prompt the wearer to save
   * against their own cloak (W6). The light-level gate has no trigger either.
   * UNBLOCKED BY: no unit for the light level; known-bugs `[content/spells]` for the cast. Prose.
   *
   * `cloak-of-the-manta-ray` - "you can breathe underwater, and you have a Swim Speed of 60 feet."
   * Both halves are W2's gap: there is no movement-mode model and no environment model.
   * UNBLOCKED BY: no unit. Prose.
   *
   * `mantle-of-spell-resistance` - "You have Advantage on saving throws against spells while you
   * wear this cloak." W4, and this row is the pure case: the WHOLE item is that one sentence, so
   * authoring it ungated would be advantage on every saving throw of every kind - strictly better
   * than a rare cloak, and better than several legendary ones. C7b refused the identical shape on
   * `ring-of-spell-turning` and this lane does not disagree with it.
   * UNBLOCKED BY: a `save-against-is` filter. Prose.
   *
   * `robe-of-eyes` - "All-Around Vision. The robe gives you Advantage on Wisdom (Perception) checks
   * that rely on sight" (W1); "Special Senses. You have Darkvision and Truesight, both with a range
   * of 120 feet" (W2 - and `sense` reaches no display either); "Drawbacks. A Light spell cast on the
   * robe or a Daylight spell cast within 5 feet of the robe gives you the Blinded condition for 1
   * minute. At the end of each of your turns, you make a Constitution saving throw (DC 11 for Light
   * or DC 15 for Daylight), ending the condition on yourself on a success." - a rider triggered by
   * ANOTHER creature's spell, which no moment in the vocabulary describes, and (review restored the
   * second sentence, which the entry cut) a per-turn repeat save that ends it, which nothing in the
   * action vocabulary schedules either. Deliberately not authored as `cursed`: the SRD does not print a curse here and the
   * robe comes off, so marking it cursed would lock a benefit on rather than model a drawback.
   * UNBLOCKED BY: no unit. Prose.
   */

  /**
   * ROBE OF SCINTILLATING COLORS - "This robe has 3 charges, and it regains 1d3 expended charges
   * daily at dawn. While you wear it, you can take a Magic action and expend 1 charge to cause the
   * garment to display a shifting pattern of dazzling hues ... Any creature in the Bright Light that
   * can see you when the robe's power is activated must succeed on a DC 15 Wisdom saving throw or
   * have the Stunned condition until the effect ends."
   *
   * MORE THAN A CHARGE, unlike the two above: the action carries the printed DC 15 Wisdom save, and
   * `conditionFrom` (`saving-throws.ts:96`) reads **Stunned** off the description, so the word in
   * the prose is load-bearing and is kept verbatim. MEASURED end to end: one press leaves
   * `actionUses` at 1 of 3 and puts `{ability: "wis", dc: 15, conditionId: "stunned"}` on the target
   * as a real pending save. C7b's `staff-of-thunder-and-lightning` is the same authored shape.
   *
   * **THE AUTHORED DESCRIPTION USED TO DROP THE LIGHT CLAUSE AND KEEP THE CLAUSE THAT DEPENDS ON
   * IT** (review). The SRD's middle sentence is *"During this time, the robe sheds Bright Light in a
   * 30-foot radius and Dim Light for an additional 30 feet, and creatures that can see you have
   * Disadvantage on attack rolls against you."* Without it the button read *"...dazzling hues until
   * the end of your next turn. Any creature in the Bright Light that can see you..."* - a GM-facing
   * string that names no light and so cannot say WHO has to save. The printed sentence is restored,
   * which also puts the third printed mechanic (the light itself) in front of the GM instead of only
   * in the row's `description`. MEASURED after the change: `conditionFrom` still reads **Stunned**
   * (nothing in the restored clause is a condition word, and it iterates its list in order, not the
   * text's), and `parseAreaProse` still returns null - its radial pattern needs `Sphere|Emanation`
   * after the distance and the SRD writes "30-foot radius", so no engine number moved.
   *
   * ABSENT, three halves:
   *   "the robe sheds Bright Light in a 30-foot radius and Dim Light for an additional 30 feet" -
   *       added by review, which found it named nowhere in this entry. There is no light model at
   *       all: no rider emits light, no map surface consumes an emitter, and `parseAreaProse` reads
   *       only the four TARGETING shapes. The clause is on the button as prose, so the GM can place
   *       it by hand, and it is what the save's "Any creature in the Bright Light" refers to.
   *       NEEDS: a light model an item can layer on. Unit: NONE YET.
   *   "creatures that can see you have Disadvantage on attack rolls against you" for the duration.
   *       That is `roll-mode: incoming-attack`, whose reader ships - but only as a STANDING or
   *       momentary rider on the item, with no way to say "until the end of your next turn, and only
   *       after this action is taken". Authoring it ungated is `cloak-of-displacement`'s over-grant
   *       on a robe that prints a duration. NEEDS: an action that grants a self effect carrying a
   *       `roll-mode` (`ActionSchema.grants` takes an `EffectGrant`, whose modifier vocabulary is
   *       the actor-side one). Unit: NONE YET.
   *   "...or have the Stunned condition UNTIL THE EFFECT ENDS" - the DURATION on the stun, added by
   *       review because the list above named only the attack half and a reader would have taken the
   *       stun as fully modelled. The save and the condition are real (measured below); what is not
   *       said is when it lifts. `ActionSchema`'s save carries an ability and a DC and nothing else,
   *       and `answerSave` hands the GM a `conditionApplied` to commit - after which the condition
   *       is OPEN-ENDED and the GM clears it by hand. This is the engine's shape rather than a C7c
   *       invention (C7b's `staff-of-thunder-and-lightning` stuns the same way), and it errs toward
   *       lasting too long rather than too short, which is why it is disclosed instead of blocking
   *       the entry. NEEDS: a duration on a condition an action applies. Unit: NONE YET.
   */
  "robe-of-scintillating-colors": {
    actions: [{
      id: "dazzle", name: "Scintillating Colors", activation: "action",
      description: "Expend 1 charge to make the garment display a shifting pattern of dazzling hues until the end of your next turn. During this time, the robe sheds Bright Light in a 30-foot radius and Dim Light for an additional 30 feet, and creatures that can see you have Disadvantage on attack rolls against you. Any creature in the Bright Light that can see you when the robe's power is activated must succeed on a DC 15 Wisdom saving throw or have the Stunned condition until the effect ends.",
      save: { ability: "wis", dc: 15 },
      uses: { limit: 3, per: "long-rest", pool: "robe-of-scintillating-colors-charges" }
    }]
  },

  /**
   * ROBE OF STARS - "You gain a +1 bonus to saving throws while you wear it."
   *
   * Unconditional and unnarrowed, which is exactly what `save-bonus` says - the same reader
   * criterion 12 drives, summed into the save the server rolls rather than one the sheet shows.
   *
   * ABSENT, two halves:
   *   "you can take a Magic action to remove one of the stars and expend it to cast the level 5
   *       version of Magic Missile. Daily at dusk, 1d6 removed stars reappear on the robe." W6 names
   *       `magic-missile` explicitly - its record is `{roll: "1d4 + 1"}`, which is ONE of the
   *       spell's darts, so a level-5 cast would roll ~3.5 where the spell averages ~24. The star
   *       pool is a second problem: stars are REMOVED and return 1d6 at dusk, which is neither W5's
   *       never nor L2's daily refill.
   *   "you can take a Magic action to enter the Astral Plane along with everything you are wearing
   *       and carrying" - no planar travel model.
   * UNBLOCKED BY: known-bugs `[content/spells]`, second entry, for the first; no unit for the second.
   */
  "robe-of-stars": { modifiers: [{ type: "save-bonus", amount: 1 }] },

  /*
   * `robe-of-the-archmagi` - ALL FOUR HALVES ARE ABSENCES, and the first of them was AUTHORED in
   * `3a8acb3` and taken back out here. It is the one entry in this lane that the admission rule's
   * second clause caught after the fact, so the measurement that removed it is kept in full.
   *
   *   "War Mage. Your spell save DC and spell attack bonus each increase by 2."
   *       W8: `spell-save-dc` IS NOT THE WEARER'S SPELL SAVE DC. `effective-actions.ts:51` sums it
   *       and `:74` folds it into `action.save.dc` for EVERY action that carries a save, with no
   *       spell test anywhere on the path - so a `spell-save-dc: 2` on the robe raises the FIXED,
   *       PRINTED DC of the other items the wearer is holding and of every save-bearing action on
   *       their sheet. **MEASURED 2026-08-12 through the real `ContentLibrary` over the SHIPPED
   *       bundle, on the same Wizard 5 the lane's test uses:** a `Wand of Paralysis`' printed DC 15
   *       read **17**; a Breath-Weapon-shaped definition action's DC 13 read **15**; and this lane's
   *       own `Eyes of Charming` cast, whose 13 is the ITEM's number, read **15**. A wand's printed
   *       DC is not the wearer's spell save DC, and the slots do not save us - the robe is
   *       `shoulders` and a wand or staff is `held`, so wizard + robe + wand is the archetypal
   *       loadout rather than a contrived one.
   *       The seam cannot catch this: `spell-save-dc` is `"standing"` in
   *       `CARRIER_RIDER_DISPOSITION`, so check 6 passes it, and the row parses. It is an ADMISSION
   *       RULE call - the reader ships and fires and produces something wider than the printed text
   *       - which is why the removal is pinned by a test instead of trusted to this comment.
   *       The other half, "...and spell attack bonus each increase by 2", is RESERVED and was never
   *       authorable: `spell-attack-bonus` is `"unread"` and `applyItemMechanics` refuses it.
   *       UNBLOCKED BY: for the save-DC half, `docs/ai-ledger/known-bugs.md` **[content/riders] A
   *       `spell-save-dc` rider raises the DC of EVERY save-bearing action** - it wants an
   *       actor-level spell save DC for the rider to raise, there being none today; for the attack
   *       half, **U26** (a reader for `derivation.spellAttackBonus`) and **U29**
   *       (`attack-kind-is: "spell"`).
   *   "Armor. If you aren't wearing armor, your base Armor Class is 15 plus your Dexterity modifier."
   *       This REPLACES the base rather than adding to it. `unarmored-defense` is the closest rider
   *       and it computes `10 + Dex + <ability>`, which cannot be made to say a flat 15, and an
   *       `armor-class: 5` with a `while-unarmored` gate would stack on 10 + Dex for the same total
   *       only while the wearer's Dex is untouched by anything else - a coincidence, not the rule.
   *       NEEDS: a base-AC override. Unit: NONE YET.
   *   "Magic Resistance. You have Advantage on saving throws against spells and other magical
   *       effects." W4. Unit: NONE YET.
   * Prose. See `rulingsOwed`: the BREADTH of `spell-save-dc` is the vocabulary's, not this lane's -
   * a class feature authoring it reaches exactly the same four lines - and narrowing it is a unit's
   * decision, not a content author's.
   */

  /*
   * `robe-of-useful-items` - "While wearing the robe, you can take a Magic action to detach one of
   * the patches, causing it to become the object or creature it represents. Once the last patch is
   * removed, the robe becomes an ordinary garment ... In addition, the robe has 4d4 other patches.
   * The GM chooses the patches or determines them randomly by rolling on the following table." GM
   * fiat end to end: the composition is rolled per copy, the patches become objects and creatures the
   * vocabulary cannot mint, and the EXTRA patches are 4d4 rather than a number. (Two corrections
   * from review: the quote used to stop at "randomly" with a fabricated full stop, and "the count is
   * 4d4" was said of the whole robe - the SRD also prints TWO EACH of six fixed patches, so a copy's
   * total is 12 + 4d4, not 4d4.) W5 would refuse a pool for the fixed patches anyway - a detached
   * patch does not come back. UNBLOCKED BY: no unit. Prose.
   *
   * `wings-of-flying` - "you can take a Magic action to turn the cloak into a pair of wings ... The
   * wings give you a Fly Speed of 60 feet ... When the wings disappear, you can't use them again for
   * 1d12 hours." The Fly Speed is W2. The charge-alone shape does NOT apply, because there is no
   * printed charge count to enforce: the limit is a rolled 1d12-hour cooldown, and
   * `FeatureUsesSchema.per` offers `turn | encounter | short-rest | long-rest` with nothing that
   * means "1d12 hours". Authoring `limit: 1, per: "long-rest"` would be inventing a recovery rule,
   * not approximating one. UNBLOCKED BY: no unit. Prose.
   */
};
