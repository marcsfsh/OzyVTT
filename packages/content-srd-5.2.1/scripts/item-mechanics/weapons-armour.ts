/**
 * C7a - WEAPONS AND ARMOUR. The riders for the 60 magic items whose bundle `category` is `weapon`
 * (33), `armor` (14), `shield` (9) or `ammunition` (4); 35 of the 60 require attunement.
 *
 * `bundles/magic-items.v1.json` carries these items' PROSE, parsed from the vendored SRD by
 * `../build-magic-items.ts`, which emits no `modifiers`, `grants`, `casts`, `uses` or `cursed` at
 * all. This file is the other half: the mechanics, merged over the generated rows by `./overlay.ts`
 * and composed by `./index.ts`. See `./overlay.ts`'s header for the seven refusals every lane
 * inherits.
 *
 * ==============================================================================================
 * THE ADMISSION RULE: A RIDER IS AUTHORED ONLY WHERE ITS READER SHIPS **AND PRODUCES THE PRINTED
 * EFFECT.** A rider that reaches a reader and produces the WRONG effect is worse than an
 * unauthored one, because it is invisible until it happens at a table.
 * ==============================================================================================
 *
 * Everything else is a NAMED ABSENCE - a comment beside the item naming the SRD sentence, the
 * vocabulary it would need, and the unit that unblocks it. `apps/server/test/item-riders.test.ts`
 * (13 criteria) and `apps/server/test/homebrew-inert-fields.test.ts` are the authoritative list of
 * readers, and every rider below cites the one that fires it.
 *
 * ==============================================================================================
 * (0) THE LANE'S GOVERNING FINDING: **A MAGIC WEAPON'S OWN BONUS HAS NOTHING TO ATTACH TO.**
 * ==============================================================================================
 *
 * A magic weapon in the SRD carries NO stats of its own - the printed type line names which BASE
 * weapon it applies to ("Weapon (Warhammer)", "Weapon (Longbow or Shortbow)", "Weapon (Any)") - and
 * the bundle reflects that faithfully. **MEASURED over the committed 268 rows: 0 of the 33
 * `weapon`-category rows carry a `weapon` block, and 0 of the 14 `armor`-category rows carry an
 * `armor` block.** So there is no damage die, no range, no properties, and no derived swing.
 *
 * That is fatal to exactly two rider families, and the mechanism is worth stating precisely because
 * it is not obvious from the vocabulary:
 *
 *   - `attack-bonus`, `extra-damage`, `critical-range`, `critical-bonus-dice` and `damage-bonus` are
 *     `THIS_ITEM_BY_DEFAULT` (`packages/rules-5e/src/riders.ts:231`), and `scopeOf` (`:232-235`)
 *     resolves them to `"this-item"` whenever the carrier `isWeapon`.
 *   - `isWeapon` is `effectiveSlot(...) === "weapon" || item.weapon !== undefined`
 *     (`apps/server/src/equipment-derivation.ts:610`), and every one of these 33 rows carries
 *     `slot: "weapon"` - so they ARE weapon carriers, scope and all.
 *   - `collectRiders` then requires `context.sourceItemId === carrier.sourceItemId`
 *     (`riders.ts:259`): the rider applies only to an attack made WITH that item.
 *   - And there is no such attack. `weaponAction` returns `null` when `item.weapon` is undefined
 *     (`equipment-derivation.ts:996`), and the picker mints the inventory row from the catalog
 *     summary's `weapon` block (`apps/client/src/encounter/equipment.tsx:66`), which is null here.
 *
 * **MEASURED end to end on a picker-minted `Dwarven Thrower` (equipped, attuned, no weapon block,
 * exactly as the shipped data yields): `derivation.carriers` 1, `weaponActionIds` `[]`,
 * `effectiveActions` `[]`.** The carrier exists and there is nothing for it to modify. An authored
 * `+3` on that row is not a small overstatement - it is a number that never appears anywhere.
 *
 * **THE RULING: a magic weapon becomes real by the PLAYER PICKING THE BASE WEAPON IT APPLIES TO.**
 * That is an item-applies-to-item mechanism (the chosen base weapon's block becomes the magic row's
 * swing, once, with the magic row's riders scoped to it) and it does not exist. It is a UNIT, not
 * content work. **Unit: C9, the weapon-template mechanism** (`docs/product/plan-content-program.md`
 * §5 and its unit table; added 2026-08-11 by the ruling that forced this salvage, and scheduled
 * AFTER C8 rather than in batch 3).
 *
 * **EVERY `limit (0)` ABSENCE BELOW IS C9's**, and that is the mapping to read this file by: the 19
 * entries emptied by limit (0) are exactly the ones waiting on the base weapon a player has not yet
 * been able to pick. They are not listed as C9 one by one, because the limit IS the citation and
 * restating it 19 times would rot 19 places instead of one. An absence citing "NONE YET" that does
 * NOT name limit (0) means what it says: no unit owns it, and none is planned.
 *
 * (This paragraph was written by the salvage as "Unit: NONE YET"; C9 did not exist until the same
 * afternoon's decision commit. Corrected in place, because a named absence whose "what unblocks it"
 * quarter points at nothing is the half of the contract that makes it a decision rather than a skip.)
 *
 * **DO NOT "FIX" THIS WITH `scope: "bearer"`.** It parses, and it is wrong in a way a table would
 * feel: it would raise every attack the bearer makes with any weapon, and two magic weapons in a
 * pack would stack. A wrong number is worse than an absent one.
 *
 * ----------------------------------------------------------------------------------------------
 * (0b) WHAT SURVIVES ON A WEAPON ROW ANYWAY, and this is a MEASURED CORRECTION to the reasoning
 * above rather than an exception to it. The ruling is about the two WEAPON-SCOPED families. A
 * weapon-slot item is still an ordinary rider carrier, and four of these rows print something that
 * is not a swing at all - a saving throw, an initiative roll, a spell, a resistance. Each was driven
 * on a picker-minted row with NO weapon block, against a control run with the rider removed:
 *
 *   `weapon-of-warning`        roll-mode/initiative     score **17** with, **3** without
 *   `luck-blade`               save-bonus               `derivation.saveBonus` **1**, `saveTotalFor(dex)` **3** vs **2**
 *   `trident-of-fish-command`  casts                    action `item-trident-of-fish-command-cast-dominate-beast` derived
 *   `frost-brand`              grants.damageResistances 12 fire -> **6**, `adjustmentSource: "Frost Brand"`
 *
 * None of the four is in `THIS_ITEM_BY_DEFAULT`, so none is `this-item`-scoped and none needs a
 * weapon block. They are authored; their weapon-scoped halves are absences beside them. **17 of the
 * 21 weapon rows an earlier draft of this lane authored change nothing at a table; these 4 do.**
 *
 * ----------------------------------------------------------------------------------------------
 * FOUR MORE VOCABULARY LIMITS MEASURED WHILE AUTHORING THIS LANE. Each is why a whole family of
 * printed sentences below is an absence, so they are stated once here instead of thirteen times:
 * ----------------------------------------------------------------------------------------------
 *
 *   (A) A FLAT "+N TO DAMAGE ROLLS" IS NOT EXPRESSIBLE. There is no `damage-bonus` in
 *       `FeatureModifierSchema`; the only damage rider is `extra-damage`, whose `formula` is
 *       `DiceFormulaSchema` and therefore requires a die term - MEASURED: `{formula: "1"}` and
 *       `{formula: "1d1"}` are both refused with *"Use a safe dice formula such as 1d8 + 3."*, while
 *       `1d4` and `2d6` parse. Its other channel, `abilityModifier`, resolves against the BEARER and
 *       cannot say "1". The effect-side `damage-bonus` IS a flat integer but is an `EffectModifier`
 *       read only from `attacker.effects`, and an ITEM effect carrying one is dropped at
 *       `equipment-derivation.ts:736` (`case "damage-bonus": return []`) under a comment saying so.
 *       **On this lane it is now MOOT for weapons** - limit (0) removes the attack half too, so a
 *       "+N to attack rolls and damage rolls" item is absent whole rather than half-authored. It is
 *       kept on the record because it is the reason a flat crit rider (Mace of Smiting's 7, Sword of
 *       Sharpness's 14, Sword of Life Stealing's 15) would still be unsayable after limit (0) is
 *       lifted. **Needs: a flat `damage-bonus` in the FeatureModifier vocabulary. Unit: NONE YET.**
 *
 *   (B) `versus-creature-type` IS AUTHORABLE BUT INERT. `RiderTriggerSchema` says so itself
 *       (*"Authorable but INERT until `ActorDefinition` carries a creature type"*) and it
 *       reproduces: `riders.ts:208` matches on `context.targetCreatureType`, and NOTHING anywhere in
 *       `apps/server/src` or `packages/rules-5e/src` ever sets that field - unlike its two siblings
 *       `versus-size` and `versus-condition`, which are both produced at `action-resolution.ts:840-841`.
 *       **Needs: a producer for `RiderContext.targetCreatureType`. Unit: NONE YET.**
 *
 *   (C) `roll-mode` HAS NO CONSUMER FOR `roll: "check"`. The enum offers seven rolls; grepping every
 *       `"roll-mode"` consumer in the server finds exactly four - `attack` and `incoming-attack`
 *       (`action-resolution.ts:598,603`), `initiative` (`encounter.ts:57,62`) and `save`
 *       (`saving-throws.ts:64`). `checkRiderBonus` (`equipment-derivation.ts:783`) sums
 *       `check-bonus` only and never looks at `roll-mode`. So "Advantage on Wisdom (Perception)
 *       checks" is an absence while "Advantage on Initiative rolls" is a rider.
 *       **Needs: a `roll: "check"` consumer on the ability-check path. Unit: NONE YET.**
 *
 *   (D) AN AC BONUS CANNOT BE NARROWED TO ONE KIND OF INCOMING ATTACK. `armor-class` is read in the
 *       STANDING pass (`moment: null`), and `collectRiders` skips any rider carrying a filter in that
 *       pass by construction - so `attack-kind-is` can never narrow an AC number. Arrow-Catching
 *       Shield's *"+2 bonus to Armor Class against ranged attack rolls"* is therefore an absence
 *       rather than a plain +2 that would wrongly cover melee.
 *       **Needs: an AC read at the incoming-attack moment. Unit: NONE YET.**
 *
 *   (E) AN ITEM'S `grants.languages` REACHES NO READER. **MEASURED 2026-08-11:**
 *       `equipment-derivation.ts:576` writes it into `derivation.languages` and `:674` returns it,
 *       and **nothing in the repo reads that field.** The sheet's language list is built once at
 *       character-build time from `species.languages`, the ledger's `language` picks,
 *       `background.languages` and `interpreted.grantedLanguages` (`character-build.ts:1440`), and
 *       `grantedLanguages` is fed only by `feature.grants.languages` (`:545`) - a class, species,
 *       background or feat FEATURE, never an item. `deriveActorSheet` has no language field at all.
 *       An earlier draft of this lane authored `demon-armor`'s Abyssal and claimed it "reaches the
 *       built sheet at `character-build.ts:1440`"; that claim was false and is retracted here.
 *       **Needs: a reader for `derivation.languages`. Unit: NONE YET.**
 *
 * ----------------------------------------------------------------------------------------------
 * WHAT THIS LANE PRODUCED, as an output rather than a target (the plan asks each lane to report its
 * own count beside its absences, and explicitly does not set one):
 *
 *   24 of 60 items carry at least one authored rider - 11 armour, 6 shields, 3 ammunition, 4 weapons.
 *   36 of 60 are prose-only records. Every one is named below with its reason.
 *
 * The 36 split: 19 emptied by limit (0), 4 RESERVED for a later unit (U20 x2, U23, U29), 2 whose
 * central mechanic the schema REFUSES outright, and 11 whose mechanic this vocabulary cannot say at
 * all. (Every count in this file is machine-checked against the bundle by
 * `apps/server/test/item-mechanics-c7a.test.ts`, which fails if a row moves between groups without
 * this header moving with it.) Three items authored above ALSO carry a per-item absence
 * (`demon-armor`'s language,
 * `luck-blade`'s and `frost-brand`'s weapon halves), stated at the entry rather than here.
 * ----------------------------------------------------------------------------------------------
 *
 * ONE GM CHOICE THIS FILE MAKES AND STATES, because the SRD prints a table rather than a value:
 *   - `armor-of-resistance` -> **LIGHTNING** (*"The GM chooses the type or determines it randomly by
 *     rolling on the following table"*, the d10's row 5). One row per item means one type; a GM who
 *     wants another edits the item. This is the lane's FAR END.
 *   - `dragon-scale-mail` -> **FIRE** (the Gold/Red/Brass rows of the item's own table).
 */
import type { ItemMechanicsModule } from "./overlay.js";

export const WEAPONS_ARMOUR: ItemMechanicsModule = {
  // =============================================================================================
  // ARMOR AND SHIELDS - flat Armor Class.
  // Reader: criterion 3 (`item-riders.test.ts`) - an `armor-class` rider raises `actor.armorClass`
  // on equip and the number comes back off on unequip, because replace-whole IS the un-grant.
  // MEASURED here on picker-minted rows through the real write path (`setInventoryItem`, the same
  // one criterion 3 drives): `armor-1` 12 -> 13 -> 12, `shield-2` 12 -> 14 -> 12,
  // `dwarven-plate` 12 -> 14 -> 12. Unlike the weapon families, `armor-class` is not
  // `THIS_ITEM_BY_DEFAULT`, so it is a STANDING bearer rider and the missing `armor` block costs it
  // nothing.
  // NOTE ON `whileArmored`: deliberately NOT set on any of these. The gate means "while wearing
  // armor" as a separate condition (the Defense fighting style); here the item IS the armor, so
  // equipping it is already the printed condition and a second gate could only fail closed on a
  // generic row that carries no `armor` block of its own.
  // =============================================================================================

  /** "You have a bonus to Armor Class while wearing this armor. The bonus is determined by its rarity." */
  "armor-1": { modifiers: [{ type: "armor-class", amount: 1 }] },
  "armor-2": { modifiers: [{ type: "armor-class", amount: 2 }] },
  "armor-3": { modifiers: [{ type: "armor-class", amount: 3 }] },

  /** "While holding this Shield, you have a bonus to Armor Class determined by the Shield's rarity, in addition to the Shield's normal bonus to AC." */
  "shield-1": { modifiers: [{ type: "armor-class", amount: 1 }] },
  "shield-2": { modifiers: [{ type: "armor-class", amount: 2 }] },
  "shield-3": { modifiers: [{ type: "armor-class", amount: 3 }] },

  /**
   * DWARVEN PLATE - "While wearing this armor, you gain a +2 bonus to Armor Class."
   *
   * ABSENT: "if an effect moves you against your will along the ground, you can take a Reaction to
   * reduce the distance you are moved by up to 10 feet" - forced movement is not a rider family at
   * all (there is no `movement` modifier and no forced-move moment). Unit: NONE YET.
   *
   * The row prints nothing else. This absence list is complete.
   */
  "dwarven-plate": { modifiers: [{ type: "armor-class", amount: 2 }] },

  /**
   * ELVEN CHAIN - "You gain a +1 bonus to Armor Class while you wear this armor."
   *
   * ABSENT: "You are considered trained with this armor even if you lack training with Medium or
   * Heavy armor." `grants.armor` IS collected off an item (`equipment-derivation.ts:581`), but
   * nothing in the engine penalises wearing armor you are untrained with - there is no
   * armor-proficiency consequence to lift - so the grant would reach a struct and change no number
   * at the table. Authoring it would be exactly the inert rider this phase exists to end.
   * Unit: NONE YET (needs the untrained-armor penalty itself, not the grant).
   *
   * The row prints nothing else. This absence list is complete.
   */
  "elven-chain": { modifiers: [{ type: "armor-class", amount: 1 }] },

  /**
   * GLAMOURED STUDDED LEATHER - "While wearing this armor, you gain a +1 bonus to Armor Class."
   *
   * ABSENT: the Bonus Action illusory-appearance change ("you can cause the armor to assume the
   * appearance of a normal set of clothing or some other kind of armor") is pure description with no
   * mechanical consequence anywhere in the engine; it stays prose by ADR-0008 rather than for want
   * of a unit.
   *
   * The row prints nothing else. This absence list is complete.
   */
  "glamoured-studded-leather": { modifiers: [{ type: "armor-class", amount: 1 }] },

  /**
   * SHIELD OF THE CAVALIER - "While holding this Shield, you have a +2 bonus to Armor Class."
   *
   * ABSENT: "Forceful Bash" (an attack made with the Shield dealing `2d6 + 2` plus your Strength
   * modifier) - `actions[].damage[].formula` could carry `2d6 + 2`, but the "plus your Strength
   * modifier" half is a per-character amount an item action cannot resolve, and the push/prone
   * riders need a forced-movement vocabulary that does not exist. ABSENT: "Protective Field", an
   * Emanation that nullifies an attack or area effect - no area/emanation model. Unit: NONE YET for
   * both.
   *
   * The row prints nothing else. This absence list is complete.
   */
  "shield-of-the-cavalier": { modifiers: [{ type: "armor-class", amount: 2 }] },

  /**
   * DEMON ARMOR - "you gain a +1 bonus to Armor Class, and you know Abyssal" + a curse.
   *
   * `cursed: true` is legal here because the SRD gates this item behind attunement, which is what
   * `EquipmentReferenceSchema`'s refinement checks a curse against. Reader: criterion 13 - a cursed
   * item's riders are signed and a player's own removal is REFUSED.
   *
   * ABSENT, AND THIS IS A RETRACTION: **"you know Abyssal".** An earlier draft authored
   * `grants: {languages: ["abyssal"]}` and claimed beside it that "the language reaches the built
   * sheet (`character-build.ts:1440`)". **That claim is false.** MEASURED: an item's
   * `grants.languages` lands in `derivation.languages` (`equipment-derivation.ts:576`, returned at
   * `:674`) and NOTHING in the repo reads that field; `character-build.ts:1440` reads
   * `interpreted.grantedLanguages`, which is fed only by `feature.grants.languages` (`:545`) - a
   * class/species/background/feat feature, never an item. The grant is removed rather than left
   * standing as a rider that authors nothing. See limit (E). **Needs: a reader for
   * `derivation.languages`. Unit: NONE YET.**
   *
   * ABSENT: "the armor's clawed gauntlets allow your Unarmed Strikes to deal 1d8 Slashing damage
   * instead of the usual Bludgeoning" - a weapon-swing damage-type override, which is exactly
   * **U20**'s new rider variant. ABSENT: "+1 bonus to the attack and damage rolls of your Unarmed
   * Strikes" - the attack half belongs with the swing override it modifies, and the damage half is
   * limit (A); left whole for U20. ABSENT: "Disadvantage on attack rolls against demons" - limit (B),
   * `versus-creature-type` is inert. ABSENT: the curse's own text - "Once you don this cursed armor,
   * you can't doff it unless you are targeted by a `Remove Curse` spell or similar magic" - which the
   * `cursed: true` flag models only in part: the flag refuses a PLAYER's removal and lets the GM lift
   * it (proven by criterion 13 of `apps/server/test/item-riders.test.ts`), but nothing ties the lift
   * to `Remove Curse` specifically. Unit: NONE YET.
   *
   * (An earlier draft of this record quoted a curse about "the demon whose skin was used to craft the
   * armor" appearing and a DC 15 Charisma save. THAT SENTENCE IS NOT IN THE VENDORED SOURCE - checked,
   * zero matches in `sources/dnd-5e-srd-markdown/magic-items.md` - and the real curse is the doffing
   * clause above plus the Disadvantage already recorded. Corrected 2026-08-12. A quote attributed to
   * the SRD that the SRD does not contain is the exact failure this package vendors its source to
   * prevent; PROVENANCE.json records that hand-authoring is "where both licensing violations landed".)
   */
  "demon-armor": {
    cursed: true,
    modifiers: [{ type: "armor-class", amount: 1 }]
  },

  /**
   * DRAGON SCALE MAIL - "you gain a +1 bonus to Armor Class ... and you have Resistance to one
   * damage type determined by the kind of dragon that provided the scales."
   *
   * GM CHOICE MADE AND STATED: **fire** (the Gold, Red and Brass rows of the item's own table).
   * Resistance reader: `homebrew-inert-fields.test.ts` row 2 - `grants.damageResistances` halves the
   * typed part on the damage command and names the item on the line.
   *
   * ABSENT: "Advantage on saving throws against the breath weapons of Dragons" - a save gated on the
   * SOURCE of the damage, which no trigger in `RiderTriggerSchema` can name (`versus-*` filters
   * describe the TARGET of the bearer's own action, not the origin of an incoming save).
   * Unit: NONE YET. ABSENT: the once-per-dawn dragon-sense ("you know the distance and direction to
   * the closest dragon within 30 miles of you") - no senses/detection model. Unit: NONE YET.
   *
   * The row prints nothing else. This absence list is complete.
   */
  "dragon-scale-mail": {
    grants: { damageResistances: ["fire"] },
    modifiers: [{ type: "armor-class", amount: 1 }]
  },

  /**
   * ARMOR OF RESISTANCE - **THE LANE'S FAR END.**
   *
   * "You have Resistance to one type of damage while you wear this armor. The GM chooses the type or
   * determines it randomly by rolling on the following table." The SRD prints NO fixed type, so this
   * lane authors one and says which: **LIGHTNING** (the d10 table's row 5).
   *
   * Reader: `homebrew-inert-fields.test.ts` row 2 - `applyDamageDetailed` halves the typed part,
   * stamps `adjustment: "resistance"` and `adjustmentSource` with the item's name, and the halving
   * disappears when the armor is unequipped. Driven end to end out of the SHIPPED bundle in
   * `apps/server/test/item-mechanics-c7a.test.ts` with no fixture supplying anything the data lacks
   * - which is what makes this a far end and the retired Dwarven Thrower one not.
   *
   * The row prints nothing else. This absence list is complete.
   */
  "armor-of-resistance": { grants: { damageResistances: ["lightning"] } },

  /**
   * ARMOR OF INVULNERABILITY - "You have Resistance to Bludgeoning, Piercing, and Slashing damage
   * while you wear this armor."
   *
   * ABSENT: "Metal Shell" - a Magic action granting IMMUNITY to the same three for 10 minutes, once
   * per dawn. `grants.damageImmunities` is a STANDING grant with no duration and no activation, so
   * authoring it would make the item permanently immune to the three physical types rather than for
   * ten minutes once a day - strictly wrong, not merely simplified. Needs an item action that
   * applies a timed effect carrying immunities. Unit: NONE YET.
   *
   * The row prints nothing else. This absence list is complete.
   */
  "armor-of-invulnerability": { grants: { damageResistances: ["bludgeoning", "piercing", "slashing"] } },

  /**
   * SHIELD OF MISSILE ATTRACTION - authored for its CURSE alone, and that is the whole rider.
   *
   * "Attuning to it curses you until you are targeted by a Remove Curse spell or similar magic.
   * Removing the Shield fails to end the curse on you." Reader: criterion 13 - the removal refusal.
   *
   * ABSENT: "you have Resistance to damage from attacks made with Ranged weapons" - resistance in
   * this engine is keyed by DAMAGE TYPE (`grants.damageResistances` is a list of the 13 type ids),
   * and "damage from a ranged weapon" is a damage SOURCE, which no field can say. Unit: NONE YET.
   * ABSENT: the curse's redirect of nearby ranged attacks onto the bearer ("whenever a creature
   * within 10 feet of you is targeted by an attack with a Ranged weapon, the attack targets you
   * instead") - no targeting-override vocabulary. Unit: NONE YET.
   *
   * The row prints nothing else. This absence list is complete.
   */
  "shield-of-missile-attraction": { cursed: true },

  /**
   * SENTINEL SHIELD - "While holding this Shield, you have Advantage on Initiative rolls and Wisdom
   * (Perception) checks."
   *
   * The initiative half is authored: reader is criterion 5, which proves `roll-mode` +
   * `roll: "initiative"` makes `startEncounter` keep the higher of two dice. MEASURED here on the
   * picker-minted row: dice 4 then 19 queued, score **19**.
   *
   * ABSENT: the Wisdom (Perception) half - limit (C). `roll: "check"` parses and no consumer
   * anywhere reads it, so authoring it would ship an advantage that never applies. Unit: NONE YET.
   *
   * The row prints nothing else. This absence list is complete.
   */
  "sentinel-shield": { modifiers: [{ type: "roll-mode", roll: "initiative", mode: "advantage" }] },

  /**
   * PLATE ARMOR OF ETHEREALNESS - "you can take a Magic action and use a command word to gain the
   * effect of the Etherealness spell ... can't be used again until the next dawn."
   *
   * Reader: criterion 4 - a `casts` block with `uses` synthesises a charged action, the charge is
   * really spent (a second use throws "no uses remaining"), and a long rest re-arms it.
   * `per: "long-rest"` is the printed "next dawn": `ItemSpellCastSchema`'s own header rules that this
   * app treats a long rest as the day rather than growing a ninth enum value. `etherealness` verified
   * present in `bundles/spells.v1.json`.
   *
   * The row prints nothing else (the base +1 AC belongs to `armor-1`, which this row is not).
   * This absence list is complete.
   */
  "plate-armor-of-etherealness": {
    casts: [{ spellId: "etherealness", uses: { limit: 1, per: "long-rest" } }]
  },

  // =============================================================================================
  // AMMUNITION - the one attack bonus in this lane that has something to attach to.
  // =============================================================================================

  /**
   * AMMUNITION, +1/+2/+3 - "You have a bonus to attack rolls and damage rolls made with this piece
   * of magic ammunition."
   *
   * **THIS IS NOT LIMIT (0), AND THE DIFFERENCE IS MEASURED.** Ammunition carries `slot:
   * "ammunition"` and no `weapon` block, so `isWeapon` is FALSE (`equipment-derivation.ts:610`) and
   * `scopeOf` resolves the `attack-bonus` to `"bearer"` - it modifies the bearer's own attacks, and
   * the bearer's bow is a real weapon with a real block. The `when` pair moves it into the MOMENTARY
   * pass, which `action-resolution.ts:856` (`momentaryAttackBonus`) runs, and `attackKindsOf` adds
   * `"ranged"` from the action's own range. Without the gate this would raise the bearer's MELEE
   * swings too, which is plainly not what a magic arrow does.
   *
   * MEASURED, driven to a ROLLED to-hit with a mundane Longbow equipped beside it (d20 = 9):
   * **ranged with the ammunition 14, ranged without it 13, melee (Mace) with it 12** - the bonus
   * lands on the shot and correctly stays off the swing.
   *
   * RESIDUE, STATED RATHER THAN HIDDEN: it is the bearer's ranged attacks rather than strictly the
   * ones using THIS ammunition - there is no "attack made with this ammunition" trigger, and two
   * different magic arrows in one quiver would both apply.
   *
   * ABSENT (all three rows): the "and damage rolls" half - limit (A). Unit: NONE YET.
   * The rows print nothing else. These absence lists are complete.
   */
  "ammunition-1": {
    modifiers: [{ type: "attack-bonus", amount: 1, when: [{ type: "on-attack-roll" }, { type: "attack-kind-is", kinds: ["ranged"] }] }]
  },
  "ammunition-2": {
    modifiers: [{ type: "attack-bonus", amount: 2, when: [{ type: "on-attack-roll" }, { type: "attack-kind-is", kinds: ["ranged"] }] }]
  },
  "ammunition-3": {
    modifiers: [{ type: "attack-bonus", amount: 3, when: [{ type: "on-attack-roll" }, { type: "attack-kind-is", kinds: ["ranged"] }] }]
  },

  // =============================================================================================
  // THE FOUR WEAPON ROWS THAT PRINT SOMETHING THAT IS NOT A SWING.
  // Each authors only its bearer-scoped half; each carries its weapon half as an absence citing
  // limit (0). See (0b) above for the measurement that separates these four from the other 29.
  // =============================================================================================

  /**
   * WEAPON OF WARNING - "Each subject has Advantage on its Initiative rolls."
   *
   * Reader: criterion 5, the `roll-mode` + `roll: "initiative"` path - it makes `startEncounter` keep
   * the higher of two dice, and drops to `"normal"` when unattuned. `roll-mode` is not
   * `THIS_ITEM_BY_DEFAULT`, so it is a standing BEARER rider and needs no weapon block: MEASURED on
   * the picker-minted row with dice 3 then 17 queued, **score 17 with the rider and 3 without**.
   *
   * Authored for the BEARER only: the SRD extends it to "you and your allies within 30 feet", and
   * there is no aura vocabulary that would let one actor's item modify another actor's roll. That
   * narrowing is stated rather than silent.
   *
   * ABSENT: "Alarm" - "you and your allies... can't be surprised... you wake up if you are sleeping
   * normally when combat begins" - no surprise or sleep model. ABSENT: the 30-foot ally aura, as
   * above. Unit: NONE YET for both.
   *
   * The row prints nothing else. This absence list is complete.
   */
  "weapon-of-warning": { modifiers: [{ type: "roll-mode", roll: "initiative", mode: "advantage" }] },

  /**
   * LUCK BLADE - "While the weapon is on your person, you also gain a +1 bonus to saving throws."
   *
   * The save bonus is authored: reader is criterion 12, which proves `save-bonus` sums into the total
   * the server actually rolls for a save. `save-bonus` is not `THIS_ITEM_BY_DEFAULT`, so it is a
   * standing BEARER rider: MEASURED on the picker-minted row, `derivation.saveBonus` **1** and
   * `saveTotalFor(dex)` **3** against a control of **2**. "On your person" is read as equipped, which
   * is what makes the item active at all.
   *
   * ABSENT: "You gain a +1 bonus to attack rolls and damage rolls made with this magic weapon" -
   * limit (0) for the attack half (no base weapon to attach to) and limit (A) for the damage half.
   * Unit: C9, the weapon-template mechanism. ABSENT: "Luck" - a once-per-dawn reroll of a
   * failed D20 Test; rerolls are not a rider family (`roll-mode` is advantage/disadvantage, which
   * rolls two dice up front rather than re-rolling one after the fact). ABSENT: "Wish" - `casts`
   * could name the spell, but the pool is `1d4 - 1` charges and `FeatureUsesSchema.limit` is a fixed
   * integer with no way to say a rolled quantity. Unit: NONE YET for both.
   *
   * The row prints nothing else. This absence list is complete.
   */
  "luck-blade": { modifiers: [{ type: "save-bonus", amount: 1 }] },

  /**
   * FROST BRAND - "while you hold the weapon, you have Resistance to Fire damage."
   *
   * Reader: `homebrew-inert-fields.test.ts` row 2, the same `grants.damageResistances` path the
   * armour uses - `takeGrants` collects it off any active item regardless of slot, so no weapon block
   * is involved. MEASURED on the picker-minted row: **12 fire -> 6**, `adjustmentSource:
   * "Frost Brand"`.
   *
   * ABSENT: "When you hit with an attack roll using this magic weapon, the target takes an extra 1d6
   * Cold damage" - limit (0). `extra-damage` is `THIS_ITEM_BY_DEFAULT`, so it scopes to an attack
   * made WITH this item, and there is no such attack until the base weapon can be chosen.
   * Unit: C9, the weapon-template mechanism. ABSENT: "In freezing temperatures, the weapon
   * sheds Bright Light in a 10-foot radius" - no environment/light model. ABSENT: the once-per-hour
   * extinguishing of nonmagical flames - no ambient-fire model, and `per` offers only the two rests
   * (measured: `z.enum(["short-rest", "long-rest"])`), so "1 hour" has no home either.
   * Unit: NONE YET for both.
   *
   * The row prints nothing else. This absence list is complete.
   */
  "frost-brand": { grants: { damageResistances: ["fire"] } },

  /**
   * TRIDENT OF FISH COMMAND - "This magic weapon has 3 charges ... you can expend 1 charge to cast
   * Dominate Beast (save DC 15) from it on a Beast that has a Swim Speed."
   *
   * Reader: criterion 4 - the `casts` block synthesises a charged action, the charge is really spent,
   * a second use past the limit is REFUSED ("no uses remaining"), and a rest re-arms the pool. A
   * `casts` block is read off the record by `castAction` with no weapon involvement at all: MEASURED
   * on the picker-minted row, the action `item-trident-of-fish-command-cast-dominate-beast` is
   * derived. `saveDc: 15` is the printed flat DC, which `ItemSpellCastSchema` carries exactly for
   * this ("A flat printed DC, overriding any derivation"). `dominate-beast` verified present in
   * `bundles/spells.v1.json`. `per: "long-rest"` is the printed "regains 1d3 expended charges daily
   * at dawn", flattened to a full recharge because `FeatureUsesSchema` has no partial-recovery
   * shape - the pool comes back whole rather than 1d3 at a time, which is stated rather than silent.
   *
   * ABSENT: the "on a Beast that has a Swim Speed" restriction - target legality is not a rider
   * family; the description carries it and the GM reads it.
   *
   * The row prints nothing else - it is one of the few magic weapons in the SRD with no +N at all,
   * which is why limit (0) costs it nothing. This absence list is complete.
   */
  "trident-of-fish-command": {
    casts: [{ spellId: "dominate-beast", saveDc: 15, uses: { limit: 3, per: "long-rest" } }]
  }

  // ===============================================================================================
  // PROSE-ONLY RECORDS - 36 of the lane's 60 items author NO rider. Each is here with its reason,
  // because "we did not think of it" and "we decided it" must not look the same to the next reader.
  // Where a record says "This absence list is complete" it means every mechanical sentence the SRD
  // prints on that row is accounted for above or below - an earlier draft's per-item lists read as
  // exhaustive and were not, so the claim is now made explicitly or not at all.
  // ===============================================================================================
  //
  // ---- EMPTIED BY LIMIT (0): THE MAGIC WEAPON HAS NO BASE WEAPON TO ATTACH TO (19) -------------
  //
  // These 19 rows print a `+N to attack rolls and damage rolls`, an on-hit die, or both, and an
  // earlier draft of this lane authored the attack half on most of them. **MEASURED: 0 of the 33
  // `weapon`-category rows carry a `weapon` block, so no swing is derived from any of them
  // (`weaponActionIds: []`, `effectiveActions: []` on a picker-minted Dwarven Thrower), and a
  // `this-item`-scoped rider has nothing to bind to.** Every one of them is unauthored here.
  // **Unit for all 19: C9, the weapon-template mechanism - a magic weapon becomes real by the player
  // picking the base weapon it applies to.** (This line said "NONE YET ... §5 has no row for it"
  // until the C8 review; it was written before C9 existed, the (0) paragraph in this file's header
  // was corrected on the same afternoon and this copy was not, and
  // `docs/product/plan-content-program.md` now carries C9 in its unit table, its own section and the
  // phrase "19 absences citing C9". An unblocker quarter that says NONE YET when a unit owns the
  // work is the half of the contract that turns a decision back into a skip.) (Two of the 19 -
  // `javelin-of-lightning` and `mace-of-disruption` - print no `+N` at all and are here for their
  // on-hit dice, which limit (0) empties by the same mechanism.) Per-item, what else each prints
  // and why THAT is absent:
  //
  // `weapon-1` / `weapon-2` / `weapon-3` - "You have a bonus to attack rolls and damage rolls made
  //     with this magic weapon. The bonus is determined by the weapon's rarity." Limit (0) for the
  //     attack half, limit (A) for the damage half. The rows print nothing else; complete.
  //
  // `dwarven-thrower` - "+3 bonus to attack rolls and damage rolls" (limit (0) / limit (A)); "It has
  //     the THROWN PROPERTY with a normal range of 20 feet and a long range of 60 feet" - a granted
  //     weapon PROPERTY and a granted range, which is the same item-applies-to-item gap wearing
  //     another hat: there is no rider that adds a property to a weapon, and the row has no `weapon`
  //     block to put one on. **This is the gate an earlier far end depended on** - that test supplied
  //     `properties: ["thrown"], rangeFeet: 20, longRangeFeet: 60` in a fixture and the shipped row
  //     carries none of it, which is precisely why it passed while the data did nothing.
  //     "an extra 1d8 Force damage" on a ranged hit - limit (0), and the ranged gate it needs is the
  //     Thrown property this row cannot grant. "or an extra 2d8 Force damage if the target is a
  //     Giant" - limit (B) as well. "Immediately after hitting or missing, the weapon flies back to
  //     your hand" - not a mechanic the engine models. Complete.
  //
  // `defender` - "+3 bonus to attack rolls and damage rolls" (limit (0) / (A)); "you can transfer
  //     some or all of the weapon's bonus to your Armor Class" - a per-turn, player-chosen
  //     reallocation between two rider families, and nothing in this vocabulary is re-authorable at
  //     the table. Complete.
  //
  // `vorpal-sword` - "+3 bonus to attack rolls and damage rolls" (limit (0) / (A)); "the weapon
  //     ignores Resistance to Slashing damage" - resistance-piercing is not a rider family; the
  //     natural-20 decapitation is a GM ruling and its "extra 30 Slashing damage" fallback is limit
  //     (A) (a flat amount, and `formula` requires a die). Complete.
  //
  // `scimitar-of-speed` - "+2 bonus to attack rolls and damage rolls" (limit (0) / (A)); "you can
  //     make one attack with it as a Bonus Action on each of your turns" - `weaponAction` hard-codes
  //     `activation: "action"` (`equipment-derivation.ts:1007`) and there is no bonus-action attack
  //     mechanism anywhere in the engine; `extra-attack` is the wrong rider (it multiplies the Attack
  //     action, it does not add a Bonus Action). Unit: U21/U35 own that mechanism. Complete.
  //
  // `nine-lives-stealer` - "+2 bonus to attack rolls and damage rolls" (limit (0) / (A)); "Life
  //     Stealing" - a `1d8 + 1` charge pool (item `uses` cannot be rolled for; `FeatureUsesSchema.limit`
  //     is an integer) spent only when a natural 20 slays a creature under 100 HP that fails a DC 15
  //     save. The trigger is a conjunction of a crit, a target HP threshold and a save outcome, which
  //     no `when` list can express. Complete.
  //
  // `quarterstaff-of-the-acrobat` - "+2 bonus to attack rolls and damage rolls" (limit (0) / (A));
  //     "Acrobatic Assist ... you have Advantage on Dexterity (Acrobatics) checks" - limit (C);
  //     "Attack Deflection", a Reaction granting +5 AC against one triggering attack - limit (D) plus
  //     a reaction-window model; the form-changing (rod / 10-foot pole / Quarterstaff) that gates the
  //     other two properties - there is no item-state vocabulary at all. Complete.
  //
  // `holy-avenger` - "+3 bonus to attack rolls and damage rolls" (limit (0) / (A)); "When you hit a
  //     Fiend or an Undead with it, that creature takes an extra 2d10 Radiant damage" - limit (0) for
  //     the die and limit (B) for the gate, and authoring it ungated would hand every target 2d10
  //     Radiant; the 10-foot Emanation granting allies Advantage on saves against spells - no
  //     aura/emanation model, and no "against spells" gate on a save. Attunement is restricted to a
  //     Paladin, which the ETL already parsed onto the row. Complete.
  //
  // `dagger-of-venom` - "+1 bonus to attack rolls and damage rolls" (limit (0) / (A)); the Bonus
  //     Action poison coating (DC 15 Constitution save or 2d10 Poison damage and the Poisoned
  //     condition, once per dawn). The save, the damage and the condition are each expressible on an
  //     `actions[]` entry, but the mechanic is a STATEFUL coat-then-deliver: the poison arms on a
  //     Bonus Action, persists for a minute, and discharges on the next hit with the weapon. There is
  //     no item-state vocabulary to hold "armed". Complete.
  //
  // `giant-slayer` - "+1 bonus to attack rolls and damage rolls" (limit (0) / (A)); "When you hit a
  //     Giant with this weapon, the Giant takes an extra 2d6 damage of the weapon's type and must
  //     succeed on a DC 15 Strength saving throw or have the Prone condition." TRIPLE-BLOCKED: limit
  //     (0), limit (B) for the gate, and **U23** for the untyped die ("of the weapon's type" -
  //     `ExtraDamageVariantSchema` requires a `damageType` today). Complete.
  //
  // `dragon-slayer` - "+1 bonus to attack rolls and damage rolls" (limit (0) / (A)); "The weapon
  //     deals an extra 3d6 damage of the weapon's type if the target is a Dragon" - blocked exactly
  //     as Giant Slayer: limit (0), limit (B), and **U23**. Complete.
  //
  // `mace-of-smiting` - "+1 bonus to attack rolls and damage rolls" (limit (0) / (A)); "The bonus
  //     increases to +3 when you use the weapon to attack a Construct" - limit (B) on top of limit
  //     (0); "the target takes an extra 7 Bludgeoning damage" on a natural 20 - the moment is
  //     authorable (`on-critical-hit` is real and criterion 9 proves a crit-only typed die fires) but
  //     **7 is a flat amount and `formula` requires a die**, limit (A) in its crit-only form, on top
  //     of limit (0). Complete.
  //
  // `hammer-of-thunderbolts` - "+1 bonus to attack rolls and damage rolls" (limit (0) / (A)); the
  //     5-charge thunderclap (a 30-foot-radius DC 17 save applying Stunned to every creature but you)
  //     - an area effect centred on the target, which the action vocabulary has no shape for;
  //     "Giant's Bane", whose condition is being attuned to a SECOND named item - there is no
  //     cross-item trigger; "Might of Giants", which raises a Strength score to 23 and is refused
  //     outright by `ITEM_REFUSED_MODIFIER_TYPES` (see the two records below for the message).
  //     Complete.
  //
  // `sword-of-wounding` - "When you hit a creature with an attack using this magic weapon, the target
  //     takes an extra 2d6 Necrotic damage" - limit (0); "must succeed on a DC 15 Constitution saving
  //     throw or be unable to regain Hit Points for 1 hour", with a repeated save at the end of each
  //     of its turns - "cannot regain Hit Points" is not a condition in `CONDITION_IDS` and not an
  //     effect modifier (there is no healing-block vocabulary), and the recurring end-of-turn save is
  //     its own missing shape. Complete.
  //
  // `flame-tongue` - "While the weapon is ablaze, it deals an extra 2d6 Fire damage on a hit" -
  //     limit (0). An earlier draft authored this die ALWAYS-ON, reasoning that a die that always
  //     fires beats one that never does; limit (0) removes the question, because the die could not
  //     have fired either way. The command-word toggle and the 40-foot Bright Light it sheds are
  //     separately absent: there is no item-state vocabulary (`while-effect-tag` reads
  //     `actor.effects[].tags` and nothing would ever create such an effect for this item) and no
  //     light model. Complete.
  //
  // `javelin-of-lightning` - "you can have it deal LIGHTNING DAMAGE INSTEAD OF PIERCING" (a
  //     weapon-swing damage-type override, **U20** in shape, though §5 does not name this item) and a
  //     5-foot-wide, 120-foot-long Line dealing 4d6 Lightning on a DC 13 save (an area, which the
  //     action vocabulary has no shape for). Both sit on top of limit (0). Complete.
  //
  // `mace-of-disruption` - "When you hit a Fiend or an Undead with this magic weapon, that creature
  //     takes an extra 2d6 Radiant damage", and the Frightened / destroyed-outright rider on a low-HP
  //     target - limit (0) for the die, limit (B) for the gate. Its Light property is real and
  //     already on the row; what Light DOES is U21/U35's mechanism. There is no +N here, which is why
  //     it sits in this group rather than beside Holy Avenger. Complete.
  //
  // ---- RESERVED FOR A LATER UNIT (4) ----------------------------------------------------------
  // These four are ALSO emptied by limit (0), and are listed separately because §5 names them as a
  // named unit's carrier: authoring anything on them now would leave that unit a record that already
  // carries riders it did not write.
  //
  // `sun-blade` - "+2 bonus to attack rolls and damage rolls made with this weapon, WHICH DEALS
  //     RADIANT DAMAGE INSTEAD OF SLASHING DAMAGE", and "functions as a Longsword with the Finesse
  //     property". Needs: a weapon-swing damage-type override, plus a way to add a weapon property -
  //     and, under limit (0), a base weapon for either to modify. Unit: **U20**. Its "extra 1d8
  //     Radiant to an Undead" is separately blocked by limit (B). Complete.
  //
  // `energy-bow` - "+1 bonus to attack rolls and damage rolls" (limit (0) / (A)); "An arrow produced
  //     by this weapon deals FORCE DAMAGE INSTEAD OF PIERCING damage on a hit" - the same
  //     weapon-swing override, Unit: **U20** (§5 names it alongside Sun Blade). **The row prints
  //     three more properties an earlier draft did not name:** "Arrow of Restraint" (a ranged attack
  //     that trades damage for a DC 15 Strength save or the Restrained condition for 1 minute,
  //     escapable on a DC 20 Strength (Athletics) check) - the save and the condition are expressible
  //     on an `actions[]` entry, but "instead of dealing damage" is a per-attack player choice with no
  //     vocabulary, and the escape check is limit (C); "Arrow of Transport" (teleporting a willing
  //     creature or object up to 60 feet) - no teleport/forced-movement model; "Energy Ladder"
  //     (a 60-foot magical ladder for 1 minute) - no terrain model. Also absent: the arrow's Bright
  //     Light in a 20-foot radius - no light model. Unit: NONE YET for those four. Complete.
  //
  // `vicious-weapon` - "This magic weapon deals an extra 2d6 damage to any creature it hits. THIS
  //     EXTRA DAMAGE IS OF THE SAME TYPE AS THE WEAPON'S NORMAL DAMAGE." Needs: `extra-damage`
  //     without a required `damageType` (it is required today - measured). Unit: **U23** - and note
  //     that U23 alone is no longer enough: "the weapon's normal damage" is a fact about the base
  //     weapon, which limit (0) says this row does not have. Complete.
  //
  // `spellguard-shield` - "While holding this Shield, you have Advantage on saving throws against
  //     spells and other magical effects, and SPELL ATTACK ROLLS HAVE DISADVANTAGE AGAINST YOU."
  //     It is `Armor (Shield)` and therefore this lane's item, not C7b's - and being a shield it is
  //     untouched by limit (0). Needs: `attack-kind-is: "spell"` to be produced by `attackKindsOf` so
  //     an `incoming-attack` roll-mode can be narrowed to spell attacks. Unit: **U29**. It grants no
  //     spell-attack BONUS, so it is U29's carrier and not U26's. The save half needs an "against
  //     spells" gate that does not exist either. Complete.
  //
  // ---- THE VOCABULARY REFUSES THE CENTRAL MECHANIC (2) ----------------------------------------
  // `ITEM_REFUSED_MODIFIER_TYPES` is `["hit-points-per-level", "ability-score"]`
  // (`src/character-content.ts`), enforced by `EquipmentReferenceSchema`'s `superRefine`. The refusal
  // is the schema's and this file only records it; NO lane may work around it by inventing a modifier
  // type, because that is a vocabulary decision and belongs to a unit. The message:
  //
  //     "An item cannot grant {type}: it is baked into the character's numbers and could not be
  //      un-granted when the item comes off."
  //
  // `thunderous-greatclub` - "While you are attuned to this magic weapon, YOUR STRENGTH IS 20 unless
  //     your Strength is already equal to or greater than that score." That is `ability-score`,
  //     refused. **The row prints three more mechanics an earlier draft did not name:** "an extra 1d8
  //     Thunder damage to any creature it hits" - limit (0) (and the plan additionally reserves this
  //     item as a prose-only record so the refusal keeps an undisturbed carrier); "an extra 3d8
  //     Thunder damage to objects it hits that aren't being worn or carried" - objects are not actors
  //     and there is no object-target model; "Clap of Thunder" (a 30-foot Cone, DC 15 Strength or
  //     Prone) and "Earthquake" (a 50-foot-radius seismic effect with a DC 20 Dexterity save, Prone,
  //     a Concentration break and a fissure, once per dawn) - both are areas, which the action
  //     vocabulary has no shape for. Unit: NONE YET for all but the first. Complete.
  //
  // `berserker-axe` - "while you are attuned to this weapon, YOUR HIT POINT MAXIMUM INCREASES BY 1
  //     FOR EACH LEVEL you have attained." That is `hit-points-per-level`, refused. Its "+1 bonus to
  //     attack rolls and damage rolls" is separately limit (0) / limit (A); its curse is expressible
  //     and is left unauthored so the refusal keeps a clean carrier; its "Disadvantage on attack rolls
  //     with weapons other than this one" is separately inexpressible - no rider can name "every
  //     weapon except this one". Complete.
  //
  // ---- THE MECHANIC CANNOT BE SAID AT ALL (11) ------------------------------------------------
  //
  // `adamantine-armor` - "any Critical Hit against you becomes a normal hit." There is
  //     `critical-range` (which natural roll crits) and `critical-bonus-dice`, but nothing that
  //     suppresses an incoming critical. Needs: a crit-suppression rider on the defending side.
  //     Unit: NONE YET. The row prints nothing else. Complete.
  //
  // `mithral-armor` - "If the armor normally imposes Disadvantage on Dexterity (Stealth) checks or
  //     has a Strength requirement, the mithral version doesn't." **CORRECTED 2026-08-11:** an
  //     earlier draft recorded the reason as "both facts live in the row's own `armor` block
  //     (`stealthDisadvantage`, `strengthRequired`), which is a PARSED column the overlay may not
  //     author". **The row has NO `armor` block - measured, `armor: null`, and 0 of the 14
  //     `armor`-category rows carry one.** The real reason is the same one limit (0) states for
  //     weapons: those two facts live on the BASE armor ("Any Medium or Heavy, Except Hide"), which
  //     this row names in prose and does not reference, and there is no item-applies-to-item
  //     mechanism to reach it. Even given one, "suppress a property of the base item" is a
  //     subtraction no rider family expresses. **Unit: NONE YET** - the item-applies-to-item
  //     mechanism, plus a suppression rider. The row prints nothing else. Complete.
  //
  // `animated-shield` - "you can take a Bonus Action to cause it to animate ... leaving your hands
  //     free." No AC change at all; the whole mechanic is hands-free wielding, and there is no
  //     hand/encumbrance model. Unit: NONE YET. The row prints nothing else. Complete.
  //
  // `arrow-catching-shield` - "You gain a +2 bonus to Armor Class AGAINST RANGED ATTACK ROLLS."
  //     Limit (D): an AC bonus cannot be narrowed to a kind of incoming attack, and authoring a plain
  //     +2 would be wrong in the common case. Its Reaction that redirects a nearby ranged attack onto
  //     the bearer has no vocabulary either. Unit: NONE YET for both. Complete.
  //
  // `dancing-sword` - the weapon hovers and attacks on its own for four rounds. Needs a
  //     detached-attacker model; there is nothing close. Unit: NONE YET. Complete.
  //
  // `mace-of-terror` - 3 charges, a Magic action releasing a 30-foot wave of terror, DC 15 Wisdom or
  //     Frightened for 1 minute, with a repeated end-of-turn save. The charges and the save are
  //     authorable; the AREA ("each creature of your choice within 30 feet") is not - an item action
  //     targets what the resolver targets and has no radius. Authoring it as a single-target action
  //     would be a different item. Unit: NONE YET. The row carries no +N. Complete.
  //
  // `ammunition-of-slaying` - "If a creature OF THAT TYPE takes damage from the ammunition, the
  //     creature makes a DC 17 Constitution saving throw, taking an extra 6d10 Force damage on a
  //     failed save." The die and its type are authorable; the gate is limit (B), and the whole item
  //     is nothing but the gate. It is `ammunition`, so limit (0) does not touch it - this one really
  //     is only the creature-type producer. Unit: NONE YET. Complete.
  //
  // `oathbow` - "If the attack hits, your SWORN ENEMY takes an extra 3d6 Piercing damage", plus
  //     Advantage against that enemy and Disadvantage with every other weapon. Limit (0) for the die;
  //     "sworn enemy" is a persistent, player-declared mark on ONE creature and there is no
  //     target-scoped effect model. Unit: **U22** owns target-scoped effects, though §5 does not list
  //     this item as its carrier. Complete.
  //
  // `sword-of-life-stealing` - "that target takes an extra 15 NECROTIC damage" on a natural 20. The
  //     moment is real (`on-critical-hit`, proven by criterion 9) and the type is real; 15 is a FLAT
  //     amount and `formula` requires a die - limit (A) - on top of limit (0). The Temporary Hit
  //     Points it grants the wielder are a second missing shape. Unit: NONE YET. Complete.
  //
  // `sword-of-sharpness` - "that target takes an extra 14 Slashing damage and gains 1 Exhaustion
  //     level" on a natural 20, plus "maximize your weapon damage dice" against objects. Flat 14 is
  //     limit (A) on top of limit (0); maximising dice is not a rider family; objects are not actors.
  //     Unit: NONE YET. Complete.
  //
  // `armor-of-vulnerability` - **REMOVED 2026-08-11, AND THE REMOVAL IS THE POINT.** "While wearing
  //     this armor, you have Resistance to one of the following damage types: Bludgeoning, Piercing,
  //     or Slashing", and, once the curse springs, "you have Vulnerability to two of the three damage
  //     types associated with the armor." An earlier draft authored the RESISTANCE half plus
  //     `cursed: true` and recorded the Vulnerability as an absence, because `FeatureGrantsSchema`
  //     has `damageResistances` and `damageImmunities` and **no `damageVulnerabilities`** (measured:
  //     the key does not exist on the grants block). The result was an INVERTED item: a cursed armour
  //     that grants a Resistance with no Vulnerability, and a curse whose only effect is to lock that
  //     benefit on - strictly BETTER than plain armour, and better than an uncursed Armor of
  //     Resistance. An item whose sign is wrong is worse than an absent one, because a GM reading the
  //     printed text will never suspect the engine of handing out the opposite. Half of a cursed item
  //     is not half an item. **Needs: `grants.damageVulnerabilities` on the feature grants block, so
  //     the two halves can land together. Unit: NONE YET.** (`derivation.damageVulnerabilities`
  //     already exists and the damage pipeline already reads it - the gap is the AUTHORING key, not
  //     the reader.) The row prints nothing else. Complete.
  //
  // `dwarven-plate`, `elven-chain`, `glamoured-studded-leather`, `shield-of-the-cavalier` and the
  //     other authored rows are NOT in this list; their partial absences are stated at their entries.
};
