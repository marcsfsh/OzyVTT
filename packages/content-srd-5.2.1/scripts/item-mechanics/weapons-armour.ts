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
 * (criteria 1-13 and 16) and `apps/server/test/homebrew-inert-fields.test.ts` are the authoritative
 * list of readers, and every rider below cites the one that fires it.
 *
 * ==============================================================================================
 * (0) THE LANE'S GOVERNING FINDING - **CLOSED 2026-08-14 by C9, the weapon-template mechanism.**
 * The finding was: a magic weapon's own bonus has nothing to attach to.
 * ==============================================================================================
 *
 * A magic weapon in the SRD carries NO stats of its own - the printed type line names which BASE
 * weapon it applies to ("Weapon (Warhammer)", "Weapon (Longbow or Shortbow)", "Weapon (Any)") - and
 * the bundle reflects that faithfully: 0 of the 33 `weapon`-category rows carry a `weapon` block,
 * and 0 of the 14 `armor`-category rows carry an `armor` block. That is STILL TRUE and deliberate.
 * What changed is that the row now carries the printed base qualifier AS DATA - `appliesTo:
 * {label, baseIds}` on every weapon and armor row (C9 phase 3), resolved against
 * `bundles/weapons.v1.json`'s `melee`/`category` columns and fail-closed - and the BIND mints the
 * magic item's inventory row with the chosen base weapon's `weapon` block copied verbatim from the
 * catalog. So the swing derives, and a `this-item`-scoped rider has something to bind to.
 *
 * The mechanism, still worth stating precisely because it is what the bind plugs into:
 *
 *   - `attack-bonus`, `extra-damage`, `critical-range`, `critical-bonus-dice` and `damage-bonus` are
 *     `THIS_ITEM_BY_DEFAULT` (`packages/rules-5e/src/riders.ts:231`), and `scopeOf` (`:232-235`)
 *     resolves them to `"this-item"` whenever the carrier `isWeapon`.
 *   - `isWeapon` is `effectiveSlot(...) === "weapon" || item.weapon !== undefined`
 *     (`apps/server/src/equipment-derivation.ts:610`), and every one of these 33 rows carries
 *     `slot: "weapon"` - so they ARE weapon carriers, scope and all.
 *   - `collectRiders` then requires `context.sourceItemId === carrier.sourceItemId`
 *     (`riders.ts:259`): the rider applies only to an attack made WITH that item.
 *   - `weaponAction` derives that attack from the INVENTORY row's `weapon` block
 *     (`equipment-derivation.ts`), which is exactly the block the bind copies in. Before the bind,
 *     the picker minted the row with no block, `weaponAction` returned null, and a MEASURED
 *     picker-minted `Dwarven Thrower` derived `weaponActionIds: []`, `effectiveActions: []` - the
 *     carrier existed with nothing to modify, which is why this lane's first pass was salvaged.
 *
 * **THE RE-AUTHORING (2026-08-14, client ruling):** with the bind supplying the swing, the rows the
 * old limit (0) emptied are authored again below - every "+N bonus to attack rolls and damage rolls
 * made with this magic weapon" as an `attack-bonus` + `damage-bonus` pair (limit (A) closed the same
 * day, see below), and the unconditional on-hit dice as `extra-damage`. Their residual absences
 * (granted properties, creature-type gates, stateful powers) stay per-row, each with its own reason.
 * Proven end to end out of the SHIPPED bundle in `apps/server/test/item-mechanics-c7a.test.ts`: the
 * shipped `weapon-1` record on a bound greatsword block prints "2d6 + 4" at attack bonus 6 and the
 * resolution ROLLS it.
 *
 * **`scope: "bearer"` IS STILL WRONG.** It parses, and a table would feel it: it would raise every
 * attack the bearer makes with any weapon, and two magic weapons in a pack would stack. The pairs
 * below carry NO explicit scope - `THIS_ITEM_BY_DEFAULT` resolves them to `"this-item"` on these
 * weapon-slot carriers, which is the printed "made with this magic weapon".
 *
 * ----------------------------------------------------------------------------------------------
 * (0b) WHAT SURVIVED ON A WEAPON ROW EVEN BEFORE THE BIND, kept as the measured record of why four
 * rows were authored while limit (0) stood. A weapon-slot item is an ordinary rider carrier for
 * anything that is NOT weapon-scoped, and four of these rows print something that is not a swing at
 * all - a saving throw, an initiative roll, a spell, a resistance. Each was driven on a
 * picker-minted row with NO weapon block, against a control run with the rider removed:
 *
 *   `weapon-of-warning`        roll-mode/initiative     score **17** with, **3** without
 *   `luck-blade`               save-bonus               `derivation.saveBonus` **1**, `saveTotalFor(dex)` **3** vs **2**
 *   `trident-of-fish-command`  casts                    action `item-trident-of-fish-command-cast-dominate-beast` derived
 *   `frost-brand`              grants.damageResistances 12 fire -> **6**, `adjustmentSource: "Frost Brand"`
 *
 * None of the four is in `THIS_ITEM_BY_DEFAULT`, so none is `this-item`-scoped and none needs a
 * weapon block. Since 2026-08-14 their weapon-scoped halves are authored beside them (`luck-blade`'s
 * +1 pair, `frost-brand`'s 1d6 cold) rather than recorded as absences.
 *
 * ----------------------------------------------------------------------------------------------
 * FOUR MORE VOCABULARY LIMITS MEASURED WHILE AUTHORING THIS LANE. Each is why a whole family of
 * printed sentences below is an absence, so they are stated once here instead of thirteen times:
 * ----------------------------------------------------------------------------------------------
 *
 *   (A) A FLAT "+N TO DAMAGE ROLLS" IS NOT EXPRESSIBLE - **CLOSED 2026-08-14.**
 *       `FeatureModifierSchema` carries the 22nd variant `{type: "damage-bonus", amount: -10..10,
 *       when?, scope?}` (`src/character-content.ts`), deliberately NOT the effect-side
 *       `damage-bonus` (that older `EffectModifier` branch has no rider gate and its item reading is
 *       still dropped at `equipment-derivation.ts` under a comment saying so). Standing, it folds
 *       into the FIRST damage part's printed formula (`effective-actions.ts` `withStandingRiders`:
 *       "2d6 + 3" becomes "2d6 + 4"), so the sheet, the roll and the resolver read one number -
 *       exactly as `attack-bonus` folds into the to-hit; moment-gated, it lands as its own labelled
 *       `bonusDamage` line at resolution (`action-resolution.ts`). Proven by criterion 16
 *       (`apps/server/test/item-riders.test.ts`), whose third case is the crit-only flat 7 this
 *       limit used to name as unsayable.
 *
 *       **WHAT THE CLOSURE DID NOT UNBLOCK, so the numbers do not inherit a closed limit:** the
 *       variant's amount is bounded to +/-10, so Sword of Sharpness's flat 14, Sword of Life
 *       Stealing's 15 and Vorpal Sword's 30 are STILL out of range - each names that at its own
 *       entry. Mace of Smiting's crit-only 7 IS in range and expressible today; it stays unauthored
 *       because the 2026-08-14 ruling converted only the "+N to attack rolls and damage rolls"
 *       family and the three unconditional on-hit dice - named at its entry as owed a ruling, not a
 *       vocabulary.
 *
 *   (B) `versus-creature-type` IS AUTHORABLE BUT INERT. `RiderTriggerSchema` says so itself
 *       (*"Authorable but INERT until `ActorDefinition` carries a creature type"*) and it
 *       reproduces: `riders.ts:208` matches on `context.targetCreatureType`, and NOTHING anywhere in
 *       `apps/server/src` or `packages/rules-5e/src` ever sets that field - unlike its two siblings
 *       `versus-size` and `versus-condition`, which are both produced at `action-resolution.ts:840-841`.
 *       **Needs: a producer for `RiderContext.targetCreatureType`. Unit: NONE YET.**
 *
 *   (C) `roll-mode` HAS NO CONSUMER FOR `roll: "check"` - **CLOSED 2026-08-13.**
 *       `apps/server/src/ability-checks.ts` (`checkRollMode` / `checkRollSources` / `checkDieFor`)
 *       is the consumer, called from the two places `action-resolution.ts` throws a check's d20: the
 *       `BUILTIN_CHECKS` branch (Hide, Influence, Search, Study) and Escape a Grapple. So
 *       "Advantage on Wisdom (Perception) checks" is a RIDER now, exactly as "Advantage on
 *       Initiative rolls" always was, and `sentinel-shield` carries both halves.
 *
 *       **IT DID NOT UNBLOCK THE OTHER TWO ROWS THAT CITED IT, and each names its real reason at its
 *       own entry rather than inheriting a closed limit.** The gate has to match the narrow the check
 *       passes, and only Hide carries a `skill` (`{dex, stealth}`); Influence/Search/Study are bare
 *       `{cha}`/`{wis}`/`{int}`, and Escape a Grapple narrows to whichever of `{str, athletics}` /
 *       `{dex, acrobatics}` won. Both `ability-is` and `skill-is` fail CLOSED on a narrow missing
 *       their key, so authoring to a skill the engine never passes ships an inert rider - which is
 *       the failure (C) existed to prevent, not a way around it.
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
 *   42 of 60 items carry at least one authored rider - 11 armour, 6 shields, 3 ammunition,
 *   22 weapons (was 24/60 with 4 weapons until 2026-08-14, when C9's bind and the closed limit (A)
 *   re-authored the 18 weapon rows the old limit (0) had emptied).
 *   18 of 60 are prose-only records. Every one is named below with its reason.
 *
 * The 18 split: 2 still prose-only after the C9 bind (`javelin-of-lightning`,
 * `mace-of-disruption` - their mechanics were never the +N pair), 4 RESERVED for a later unit
 * (U20 x2, U23, U29), 1 whose central mechanic the schema REFUSES outright
 * (`thunderous-greatclub`; `berserker-axe` left this group when the ruling authored its printed +1
 * pair), and 11 whose mechanic this vocabulary cannot say at all. (Every count in this file is
 * machine-checked against the bundle by `apps/server/test/item-mechanics-c7a.test.ts`, which fails
 * if a row moves between groups without this header moving with it.) Most authored weapon rows ALSO
 * carry per-item residual absences (granted properties, creature-type dice, stateful powers),
 * stated at the entry rather than here.
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
   * Strikes" - the attack half belongs with the swing override it modifies, and the damage half -
   * a flat `damage-bonus` is in the vocabulary since 2026-08-14 - has no unarmed-strike gate to
   * scope it (on an ARMOR carrier it is bearer-scoped and would raise every attack the wearer
   * makes); left whole for U20. ABSENT: "Disadvantage on attack rolls against demons" - limit (B),
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
   * **THE WISDOM (PERCEPTION) HALF IS AUTHORED TOO SINCE 2026-08-13 - limit (C) CLOSED**, and it is
   * gated on the ABILITY rather than the skill, which is the whole subtlety. `BUILTIN_CHECKS`
   * (`action-resolution.ts`) resolves Search as a BARE Wisdom check - `{label: "Wisdom (Search)",
   * ability: "wis"}`, no `skill` key at all, so `skillBonusFromExtension` is never consulted on that
   * path. `skill-is`/`ability-is` fail CLOSED against a narrow that does not carry their key
   * (`riders.ts` `passes`), so `skill-is: ["perception"]` would fire NOWHERE and ship inert - the
   * exact failure this limit existed to prevent, re-created by an author being literal about the
   * printed skill. `ability-is: ["wis"]` fires on Search, which is the only Wisdom check the server
   * throws. MEASURED on the picker-minted row through the SHIPPED bundle, faces 5 then 18 queued:
   * `2d20kh1+0`, kept 18, total **18**; unequipped, the same queue gives `1d20+0` and **5**.
   *
   * DISCLOSED, because it is an approximation and not an equivalence: the engine's Search does not
   * distinguish Perception from the Insight, Medicine and Survival the SRD's Search action also
   * admits, so the shield helps a Search it would not have helped at a table that called for
   * Insight. The shield's clause carries NO qualifier of its own ("Advantage on ... Wisdom
   * (Perception) checks", full stop), which is what separates it from C7c's `robe-of-eyes` and
   * `eyes-of-the-eagle` - those print *"that rely on sight"*, a narrowing nothing can say, and stay
   * absences there. See `rulingsOwed`.
   *
   * The row prints nothing else. This absence list is empty.
   */
  "sentinel-shield": {
    modifiers: [
      { type: "roll-mode", roll: "initiative", mode: "advantage" },
      {
        type: "roll-mode", roll: "check", mode: "advantage",
        when: [{ type: "on-ability-check" }, { type: "ability-is", abilities: ["wis"] }]
      }
    ]
  },

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
   * ABSENT (all three rows): the "and damage rolls" half. NOT limit (A) any more - a `damage-bonus`
   * gated `on-hit` (or `on-damage-roll`) + `attack-kind-is: ["ranged"]` is expressible since
   * 2026-08-14 and would land as a labelled bonusDamage line on ranged resolutions. NOT
   * `on-attack-roll`, which the attack half carries: that is an attack-pass moment, and the damage
   * pass collects only null/on-damage-roll/on-hit/on-critical-hit - a damage rider gated on it
   * publishes clean and lands nowhere (the 2026-08-14 review reproduced it; the publish gate now
   * refuses the pairing by name). It stays unauthored because that day's ruling converted the WEAPON rows only
   * ("made with this magic weapon"); these print "made with this piece of magic ammunition", and
   * the same bearer-ranged residue the attack half discloses would apply. Owed a ruling, not a
   * vocabulary.
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
  // Each was authored for its bearer-scoped half while limit (0) stood - see (0b) above for the
  // measurement. Since 2026-08-14 `luck-blade` and `frost-brand` carry their weapon-scoped halves
  // too; `weapon-of-warning` and `trident-of-fish-command` print no +N and no on-hit die, so the
  // bind changes nothing on them.
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
   * LUCK BLADE - "You gain a +1 bonus to attack rolls and damage rolls made with this magic weapon.
   * While the weapon is on your person, you also gain a +1 bonus to saving throws."
   *
   * The save bonus is authored: reader is criterion 12, which proves `save-bonus` sums into the total
   * the server actually rolls for a save. `save-bonus` is not `THIS_ITEM_BY_DEFAULT`, so it is a
   * standing BEARER rider: MEASURED on the picker-minted row, `derivation.saveBonus` **1** and
   * `saveTotalFor(dex)` **3** against a control of **2**. "On your person" is read as equipped, which
   * is what makes the item active at all.
   *
   * The +1 pair is authored beside it since 2026-08-14 (client ruling; limit (0) closed by C9's
   * bind, limit (A) closed by the `damage-bonus` variant, criterion 16). Weapon-scoped by default -
   * no explicit scope, see the header.
   *
   * ABSENT: "Luck" - a once-per-dawn reroll of a
   * failed D20 Test; rerolls are not a rider family (`roll-mode` is advantage/disadvantage, which
   * rolls two dice up front rather than re-rolling one after the fact). ABSENT: "Wish" - `casts`
   * could name the spell, but the pool is rolled (`1d3` charges) and `FeatureUsesSchema.limit` is a
   * fixed integer with no way to say a rolled quantity. Unit: NONE YET for both.
   *
   * The row prints nothing else. This absence list is complete.
   */
  "luck-blade": {
    modifiers: [
      { type: "save-bonus", amount: 1 },
      { type: "attack-bonus", amount: 1 },
      { type: "damage-bonus", amount: 1 }
    ]
  },

  /**
   * FROST BRAND - "When you hit with an attack roll using this magic weapon, the target takes an
   * extra 1d6 Cold damage. In addition, while you hold the weapon, you have Resistance to Fire
   * damage."
   *
   * Resistance reader: `homebrew-inert-fields.test.ts` row 2, the same `grants.damageResistances`
   * path the armour uses - `takeGrants` collects it off any active item regardless of slot, so no
   * weapon block is involved. MEASURED on the picker-minted row: **12 fire -> 6**,
   * `adjustmentSource: "Frost Brand"`.
   *
   * The 1d6 Cold is authored since 2026-08-14: the printed sentence is UNCONDITIONAL on a hit (no
   * command word, no state - re-read above), so it is a plain `extra-damage` the moment C9's bind
   * gives the row a swing to scope to. Reader: criterion 1, the extra typed damage entry on the
   * damage command.
   *
   * ABSENT: "In freezing temperatures, the weapon
   * sheds Bright Light in a 10-foot radius" - no environment/light model. ABSENT: the once-per-hour
   * extinguishing of nonmagical flames - no ambient-fire model, and `per` offers only the two rests
   * (measured: `z.enum(["short-rest", "long-rest"])`), so "1 hour" has no home either.
   * Unit: NONE YET for both.
   *
   * The row prints nothing else. This absence list is complete.
   */
  "frost-brand": {
    grants: { damageResistances: ["fire"] },
    modifiers: [{ type: "extra-damage", formula: "1d6", damageType: "cold", doubleOnCritical: true }]
  },

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
   * so neither the old limit (0) nor the 2026-08-14 re-authoring touches it. This absence list is
   * complete.
   */
  "trident-of-fish-command": {
    casts: [{ spellId: "dominate-beast", saveDc: 15, uses: { limit: 3, per: "long-rest" } }]
  },

  // =============================================================================================
  // THE +N WEAPON ROWS AND THE UNCONDITIONAL ON-HIT DICE - RE-AUTHORED 2026-08-14 (client ruling).
  //
  // C9's bind supplies the swing (header (0)); the closed limit (A) supplies the damage half
  // (`damage-bonus`, criterion 16). Every "+N bonus to attack rolls and damage rolls made with
  // this magic weapon" below is the pair `attack-bonus` + `damage-bonus`, both amount N, both
  // WITHOUT an explicit scope: `THIS_ITEM_BY_DEFAULT` resolves them to `"this-item"` on a
  // weapon-slot carrier, which is the printed "made with this magic weapon" - and `scope: "bearer"`
  // would stack two magic weapons in a pack (header (0), still wrong). Residual absences stay
  // per-row below. Far ends: `apps/server/test/item-mechanics-c7a.test.ts` drives the SHIPPED
  // `weapon-1` and `flame-tongue` records on bound base-weapon blocks to rolled totals.
  // =============================================================================================

  /**
   * WEAPON, +1 / +2 / +3 - "You have a bonus to attack rolls and damage rolls made with this magic
   * weapon. The bonus is determined by the weapon's rarity." (Uncommon +1, Rare +2, Very Rare +3 -
   * the ladder expands to one row per tier, so each row's N is fixed.)
   *
   * The rows print nothing else. These absence lists are complete.
   */
  "weapon-1": { modifiers: [{ type: "attack-bonus", amount: 1 }, { type: "damage-bonus", amount: 1 }] },
  "weapon-2": { modifiers: [{ type: "attack-bonus", amount: 2 }, { type: "damage-bonus", amount: 2 }] },
  "weapon-3": { modifiers: [{ type: "attack-bonus", amount: 3 }, { type: "damage-bonus", amount: 3 }] },

  /**
   * DWARVEN THROWER - "You gain a +3 bonus to attack rolls and damage rolls made with this magic
   * weapon." Authored; this row is the item the salvage's retired far end faked, now real.
   *
   * ABSENT: "It has the Thrown property with a normal range of 20 feet and a long range of 60 feet"
   * - the bind copies the BASE Warhammer's block VERBATIM, and a Warhammer has no Thrown and no
   * range; there is still no rider that adds a property or a range to the bound block. Unit: NONE
   * YET (a granted-property rider on top of C9's bind). ABSENT: "an extra 1d8 Force damage" on a
   * ranged hit - the ranged gate can never be true while the Thrown grant above is absent, so
   * authoring the die would land it on melee swings, which is wrong rather than partial. ABSENT:
   * "an extra 2d8 Force damage if the target is a Giant" - limit (B) on top of that. ABSENT: the
   * fly-back-to-your-hand clause - not a mechanic the engine models. Complete.
   */
  "dwarven-thrower": { modifiers: [{ type: "attack-bonus", amount: 3 }, { type: "damage-bonus", amount: 3 }] },

  /**
   * DEFENDER - "You gain a +3 bonus to attack rolls and damage rolls made with this magic weapon."
   *
   * ABSENT: "you can transfer some or all of the weapon's bonus to your Armor Class" - a per-turn,
   * player-chosen reallocation between two rider families; nothing in this vocabulary is
   * re-authorable at the table. The authored +3/+3 is the weapon's whole bonus, which is the item's
   * printed default before any transfer. Unit: NONE YET. Complete.
   */
  "defender": { modifiers: [{ type: "attack-bonus", amount: 3 }, { type: "damage-bonus", amount: 3 }] },

  /**
   * VORPAL SWORD - "You gain a +3 bonus to attack rolls and damage rolls made with this magic
   * weapon."
   *
   * ABSENT: "the weapon ignores Resistance to Slashing damage" - resistance-piercing is not a rider
   * family. ABSENT: the natural-20 decapitation - a GM ruling; its "extra 30 Slashing damage"
   * fallback is out of `damage-bonus`'s +/-10 range even moment-gated (limit (A)'s closure note).
   * Unit: NONE YET for both. Complete.
   */
  "vorpal-sword": { modifiers: [{ type: "attack-bonus", amount: 3 }, { type: "damage-bonus", amount: 3 }] },

  /**
   * HOLY AVENGER - "You gain a +3 bonus to attack rolls and damage rolls made with this magic
   * weapon." Attunement is restricted to a Paladin, which the ETL already parsed onto the row.
   *
   * ABSENT: "When you hit a Fiend or an Undead with it, that creature takes an extra 2d10 Radiant
   * damage" - limit (B); authoring it ungated would hand every target 2d10 Radiant. ABSENT: the
   * 10-foot Emanation granting allies Advantage on saves against spells - no aura/emanation model,
   * and no "against spells" gate on a save. Unit: NONE YET. Complete.
   */
  "holy-avenger": { modifiers: [{ type: "attack-bonus", amount: 3 }, { type: "damage-bonus", amount: 3 }] },

  /**
   * SCIMITAR OF SPEED - "You gain a +2 bonus to attack rolls and damage rolls made with this magic
   * weapon."
   *
   * ABSENT: "you can make one attack with it as a Bonus Action on each of your turns" -
   * `weaponAction` hard-codes `activation: "action"` and there is no bonus-action attack mechanism;
   * `extra-attack` is the wrong rider (it multiplies the Attack action, it does not add a Bonus
   * Action). Unit: U21/U35 own that mechanism. Complete.
   */
  "scimitar-of-speed": { modifiers: [{ type: "attack-bonus", amount: 2 }, { type: "damage-bonus", amount: 2 }] },

  /**
   * NINE LIVES STEALER - "You gain a +2 bonus to attack rolls and damage rolls made with this magic
   * weapon."
   *
   * ABSENT: "Life Stealing" - a rolled `1d8 + 1` charge pool (`FeatureUsesSchema.limit` is a fixed
   * integer) spent only when a natural 20 hits a creature under 100 HP that fails a DC 15 save; the
   * trigger is a conjunction of a crit, a target HP threshold and a save outcome, which no `when`
   * list can express. Unit: NONE YET. Complete.
   */
  "nine-lives-stealer": { modifiers: [{ type: "attack-bonus", amount: 2 }, { type: "damage-bonus", amount: 2 }] },

  /**
   * QUARTERSTAFF OF THE ACROBAT - "You have a +2 bonus to attack rolls and damage rolls made with
   * this magic weapon."
   *
   * ABSENT: "Acrobatic Assist (Quarterstaff and 10-Foot Pole Forms Only)" - the check-advantage
   * WOULD fire (Escape a Grapple narrows to `{dex, acrobatics}` when Acrobatics wins), but the
   * parenthesis gates it on the weapon's FORM and no trigger reads an item's own state; authoring
   * it unqualified would keep the advantage while the staff is a 6-inch rod in a pack. **Needs:
   * item state a trigger can read. Unit: NONE YET.** ABSENT: "Attack Deflection", a Reaction
   * granting +5 AC against one triggering attack - limit (D) plus a reaction-window model. ABSENT:
   * the form-changing itself and the thrown Quarterstaff-form range - the same missing item-state
   * vocabulary, plus the granted-property gap named at `dwarven-thrower`. Complete.
   */
  "quarterstaff-of-the-acrobat": { modifiers: [{ type: "attack-bonus", amount: 2 }, { type: "damage-bonus", amount: 2 }] },

  /**
   * DAGGER OF VENOM - "You gain a +1 bonus to attack rolls and damage rolls made with this magic
   * weapon."
   *
   * ABSENT: the Bonus Action poison coating (DC 15 Constitution save or 2d10 Poison damage and the
   * Poisoned condition, once per dawn) - the save, the damage and the condition are each
   * expressible on an `actions[]` entry, but the mechanic is a STATEFUL coat-then-deliver: the
   * poison arms on a Bonus Action, persists for a minute, and discharges on the next hit with the
   * weapon. There is no item-state vocabulary to hold "armed". Unit: NONE YET. Complete.
   */
  "dagger-of-venom": { modifiers: [{ type: "attack-bonus", amount: 1 }, { type: "damage-bonus", amount: 1 }] },

  /**
   * GIANT SLAYER - "You gain a +1 bonus to attack rolls and damage rolls made with this magic
   * weapon."
   *
   * ABSENT: "When you hit a Giant with this weapon, the Giant takes an extra 2d6 damage of the
   * weapon's type and must succeed on a DC 15 Strength saving throw or have the Prone condition" -
   * DOUBLE-BLOCKED: limit (B) for the gate, and **U23** for the untyped die ("of the weapon's
   * type" - `ExtraDamageVariantSchema` requires a `damageType` today). Complete.
   */
  "giant-slayer": { modifiers: [{ type: "attack-bonus", amount: 1 }, { type: "damage-bonus", amount: 1 }] },

  /**
   * DRAGON SLAYER - "You gain a +1 bonus to attack rolls and damage rolls made with this magic
   * weapon."
   *
   * ABSENT: "The weapon deals an extra 3d6 damage of the weapon's type if the target is a Dragon" -
   * blocked exactly as Giant Slayer: limit (B) and **U23**. Complete.
   */
  "dragon-slayer": { modifiers: [{ type: "attack-bonus", amount: 1 }, { type: "damage-bonus", amount: 1 }] },

  /**
   * MACE OF SMITING - "You gain a +1 bonus to attack rolls and damage rolls made with this magic
   * weapon."
   *
   * ABSENT: "The bonus increases to +3 when you use the weapon to attack a Construct" - limit (B).
   * ABSENT: "the target takes an extra 7 Bludgeoning damage" on a natural 20 - EXPRESSIBLE since
   * 2026-08-14 (a `damage-bonus` gated `on-critical-hit` is criterion 16's third case, and 7 is in
   * the +/-10 range) but NOT part of that day's ruling, which converted only the +N pairs and the
   * unconditional on-hit dice - owed a ruling, not a vocabulary. Its "or 14 Bludgeoning damage if
   * it's a Construct" escalation is limit (B) and out of range besides; the Construct-destruction
   * clause is a GM ruling on a HP threshold no trigger reads. Complete.
   */
  "mace-of-smiting": { modifiers: [{ type: "attack-bonus", amount: 1 }, { type: "damage-bonus", amount: 1 }] },

  /**
   * HAMMER OF THUNDERBOLTS - "You gain a +1 bonus to attack rolls and damage rolls made with this
   * magic weapon."
   *
   * ABSENT: the 5-charge thrown thunderclap (a ranged attack it does not otherwise have, then a
   * 30-foot-radius DC 17 save applying Stunned to every creature but you) - an area effect centred
   * on the target, which the action vocabulary has no shape for, on top of the granted-Thrown gap
   * named at `dwarven-thrower`. ABSENT: "Giant's Bane", whose condition is being attuned to a
   * SECOND named item - there is no cross-item trigger. ABSENT: "Might of Giants", which raises the
   * Strength score bestowed by that second item by 4 (to a maximum of 30) - a modifier on another
   * item's grant, and `ability-score` is refused on items outright anyway (see
   * `thunderous-greatclub`). Unit: NONE YET for all three. Complete.
   */
  "hammer-of-thunderbolts": { modifiers: [{ type: "attack-bonus", amount: 1 }, { type: "damage-bonus", amount: 1 }] },

  /**
   * BERSERKER AXE - "You gain a +1 bonus to attack rolls and damage rolls made with this magic
   * weapon." Authored per the 2026-08-14 ruling, which names this row beside the other +N carriers
   * - it is no longer the schema-refusal group's undisturbed carrier (`thunderous-greatclub` still
   * is; the refusal itself is unchanged and recorded there).
   *
   * ABSENT: "your Hit Point maximum increases by 1 for each level you have attained" - that is
   * `hit-points-per-level`, REFUSED outright by `ITEM_REFUSED_MODIFIER_TYPES`
   * (`src/character-content.ts`, enforced by `EquipmentReferenceSchema`'s `superRefine`): "An item
   * cannot grant {type}: it is baked into the character's numbers and could not be un-granted when
   * the item comes off." ABSENT: the curse - `cursed: true` is expressible (the SRD gates the item
   * behind attunement) but was not in the ruling's batch, and the flag alone would model neither
   * the berserk mechanic (a DC 15 save on taking damage, then forced targeting) nor "Disadvantage
   * on attack rolls with weapons other than this one" - no rider can name "every weapon except this
   * one". Left whole for its own ruling. Complete.
   */
  "berserker-axe": { modifiers: [{ type: "attack-bonus", amount: 1 }, { type: "damage-bonus", amount: 1 }] },

  /**
   * FLAME TONGUE - "While holding this magic weapon, you can take a Bonus Action and use a command
   * word to cause flames to engulf the damage-dealing part of the weapon. ... While the weapon is
   * ablaze, it deals an extra 2d6 Fire damage on a hit. The flames last until you take a Bonus
   * Action to issue the command again or until you drop, stow, or sheathe the weapon."
   *
   * Authored ALWAYS-ON per the 2026-08-14 client ruling: the lit/unlit command word is unmodelable
   * item state, and a drawn Flame Tongue in combat is lit. This ruling is the precedent for "while
   * activated" items. The command-word sentence is quoted above so the approximation is visible: a
   * wielder who deliberately fights with the flames out is the case this authoring gets wrong, and
   * the GM edits the damage line that once.
   *
   * ABSENT: the 40-foot Bright Light the flames shed - no light model. Unit: NONE YET. Complete.
   */
  "flame-tongue": { modifiers: [{ type: "extra-damage", formula: "2d6", damageType: "fire", doubleOnCritical: true }] },

  /**
   * SWORD OF WOUNDING - "When you hit a creature with an attack using this magic weapon, the target
   * takes an extra 2d6 Necrotic damage and must succeed on a DC 15 Constitution saving throw or be
   * unable to regain Hit Points for 1 hour."
   *
   * The 2d6 Necrotic is unconditional on a hit and authored (reader: criterion 1). ABSENT, still:
   * the "can't regain Hit Points" half - not a condition in `CONDITION_IDS` and not an effect
   * modifier (there is no healing-block vocabulary), and the recurring end-of-turn save is its own
   * missing shape. Unit: NONE YET. Complete.
   */
  "sword-of-wounding": { modifiers: [{ type: "extra-damage", formula: "2d6", damageType: "necrotic", doubleOnCritical: true }] }

  // ===============================================================================================
  // PROSE-ONLY RECORDS - 18 of the lane's 60 items author NO rider. Each is here with its reason,
  // because "we did not think of it" and "we decided it" must not look the same to the next reader.
  // Where a record says "This absence list is complete" it means every mechanical sentence the SRD
  // prints on that row is accounted for above or below - an earlier draft's per-item lists read as
  // exhaustive and were not, so the claim is now made explicitly or not at all.
  // ===============================================================================================
  //
  // ---- STILL PROSE-ONLY AFTER THE C9 BIND (2) --------------------------------------------------
  //
  // This group held 19 rows as "EMPTIED BY LIMIT (0): THE MAGIC WEAPON HAS NO BASE WEAPON TO ATTACH
  // TO" until 2026-08-14. C9 landed the bind - the row's printed base qualifier is data
  // (`appliesTo`), the player picks the base weapon, and the bind mints the inventory row with that
  // weapon's block copied verbatim - so the swing exists and the group's one shared reason is gone.
  // 17 of the 19 were re-authored above per the client ruling (the +N pairs, `flame-tongue`'s and
  // `sword-of-wounding`'s dice), each keeping its still-true residual absences at its entry. These
  // 2 remain prose-only because their mechanics were never the +N pair - each names its own reason:
  //
  // `javelin-of-lightning` - "you can have it deal LIGHTNING DAMAGE INSTEAD OF PIERCING" (a
  //     weapon-swing damage-type override, **U20** in shape, though §5 does not name this item) and a
  //     5-foot-wide, 120-foot-long Line dealing 4d6 Lightning on a DC 13 save (an area, which the
  //     action vocabulary has no shape for). The bound swing gives these something to sit on and
  //     changes neither blocker. There is no +N and no unconditional die. Complete.
  //
  // `mace-of-disruption` - "When you hit a Fiend or an Undead with this magic weapon, that creature
  //     takes an extra 2d6 Radiant damage", and the Frightened / destroyed-outright rider on a low-HP
  //     target - limit (B) for the gate (authoring the die ungated would hand every target 2d6
  //     Radiant), and the destruction clause reads a HP threshold no trigger carries. Its Light
  //     property is real and already on the row; what Light DOES is U21/U35's mechanism. There is no
  //     +N here. Complete.
  //
  // ---- RESERVED FOR A LATER UNIT (4) ----------------------------------------------------------
  // Listed separately because §5 names each as a named unit's carrier: authoring anything on them
  // now - INCLUDING the +N pairs on `sun-blade` and `energy-bow`, expressible since 2026-08-14 and
  // deliberately not in that day's ruling - would leave the unit a record that already carries
  // riders it did not write.
  //
  // `sun-blade` - "+2 bonus to attack rolls and damage rolls made with this weapon, WHICH DEALS
  //     RADIANT DAMAGE INSTEAD OF SLASHING DAMAGE", and "functions as a Longsword with the Finesse
  //     property". The +N pair is expressible now and RESERVED with the rest of the row: the pair
  //     is inseparable from the damage-type override printed in the same sentence. Needs: a
  //     weapon-swing damage-type override, plus a way to add a weapon property. Unit: **U20**. Its
  //     "extra 1d8 Radiant to an Undead" is separately blocked by limit (B). Complete.
  //
  // `energy-bow` - "+1 bonus to attack rolls and damage rolls" (RESERVED with the row, as
  //     `sun-blade`'s pair is); "An arrow produced
  //     by this weapon deals FORCE DAMAGE INSTEAD OF PIERCING damage on a hit" - the same
  //     weapon-swing override, Unit: **U20** (§5 names it alongside Sun Blade). **The row prints
  //     three more properties an earlier draft did not name:** "Arrow of Restraint" (a ranged attack
  //     that trades damage for a DC 15 Strength save or the Restrained condition for 1 minute,
  //     escapable on a DC 20 Strength (Athletics) check) - the save and the condition are expressible
  //     on an `actions[]` entry, but "instead of dealing damage" is a per-attack player choice with no
  //     vocabulary, and the escape DC was **miscited as limit (C)**: (C) was about a roll-mode reader
  //     and this is a NUMBER an item action cannot set. `escapeDc` lives on an effect
  //     (`effects.ts`), and an item action's `onHit` is dropped before it reaches one (C7d's D2), so
  //     the Restrained condition would arrive with no way out. **Needs: an item action that can set
  //     an escape DC on the condition it applies. Unit: NONE YET.** "Arrow of Transport" (teleporting a willing
  //     creature or object up to 60 feet) - no teleport/forced-movement model; "Energy Ladder"
  //     (a 60-foot magical ladder for 1 minute) - no terrain model. Also absent: the arrow's Bright
  //     Light in a 20-foot radius - no light model. Unit: NONE YET for those four. Complete.
  //
  // `vicious-weapon` - "This magic weapon deals an extra 2d6 damage to any creature it hits. THIS
  //     EXTRA DAMAGE IS OF THE SAME TYPE AS THE WEAPON'S NORMAL DAMAGE." Needs: `extra-damage`
  //     without a required `damageType` (it is required today - measured). Unit: **U23** - and the
  //     C9 bind is what makes U23 sufficient now: "the weapon's normal damage" is a fact about the
  //     base weapon, and the bound block carries it. Complete.
  //
  // `spellguard-shield` - "While holding this Shield, you have Advantage on saving throws against
  //     spells and other magical effects, and SPELL ATTACK ROLLS HAVE DISADVANTAGE AGAINST YOU."
  //     It is `Armor (Shield)` and therefore this lane's item, not C7b's - and being a shield the
  //     weapon rows' bind story never touched it. Needs: `attack-kind-is: "spell"` to be produced by `attackKindsOf` so
  //     an `incoming-attack` roll-mode can be narrowed to spell attacks. Unit: **U29**. It grants no
  //     spell-attack BONUS, so it is U29's carrier and not U26's. The save half needs an "against
  //     spells" gate that does not exist either. Complete.
  //
  // ---- THE VOCABULARY REFUSES THE CENTRAL MECHANIC (1) ----------------------------------------
  // `ITEM_REFUSED_MODIFIER_TYPES` is `["hit-points-per-level", "ability-score"]`
  // (`src/character-content.ts`), enforced by `EquipmentReferenceSchema`'s `superRefine`. The refusal
  // is the schema's and this file only records it; NO lane may work around it by inventing a modifier
  // type, because that is a vocabulary decision and belongs to a unit. The message:
  //
  //     "An item cannot grant {type}: it is baked into the character's numbers and could not be
  //      un-granted when the item comes off."
  //
  // (This group held `berserker-axe` too, "left unauthored so the refusal keeps a clean carrier",
  // until the 2026-08-14 ruling named that row among the +N carriers and authored its printed pair -
  // its entry above records the refusal and the rest of its absences. `thunderous-greatclub` is the
  // group's remaining, still-undisturbed carrier.)
  //
  // `thunderous-greatclub` - "While you are attuned to this magic weapon, YOUR STRENGTH IS 20 unless
  //     your Strength is already equal to or greater than that score." That is `ability-score`,
  //     refused. **The row prints three more mechanics an earlier draft did not name:** "an extra 1d8
  //     Thunder damage to any creature it hits" - expressible since the C9 bind, and left unauthored
  //     because the plan reserves this item as a prose-only record so the refusal keeps an
  //     undisturbed carrier (that reserve, not a vocabulary gap, is now the whole reason); "an extra
  //     3d8 Thunder damage to objects it hits that aren't being worn or carried" - objects are not
  //     actors and there is no object-target model; "Clap of Thunder" (a 30-foot Cone, DC 15 Strength
  //     or Prone) and "Earthquake" (a 50-foot-radius seismic effect with a DC 20 Dexterity save,
  //     Prone, a Concentration break and a fissure, once per dawn) - both are areas, which the action
  //     vocabulary has no shape for. Unit: NONE YET for all but the first. Complete.
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
  //     `armor`-category rows carry one.** Those two facts live on the BASE armor ("Any Medium or
  //     Heavy, Except Hide") - which, since C9, the row DOES reference as data (`appliesTo`), so the
  //     item-applies-to-item half of the old reason is gone. What remains is the whole of it:
  //     "suppress a property of the base item" is a subtraction no rider family expresses, so even a
  //     bound block's `stealthDisadvantage`/`strengthRequired` cannot be switched off from here.
  //     **Unit: NONE YET** - a suppression rider. The row prints nothing else. Complete.
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
  //     is nothing but the gate. It is `ammunition`, so no weapon bind is involved - this one really
  //     is only the creature-type producer. Unit: NONE YET. Complete.
  //
  // `oathbow` - "If the attack hits, your SWORN ENEMY takes an extra 3d6 Piercing damage", plus
  //     Advantage against that enemy and Disadvantage with every other weapon. The die is
  //     expressible on a bound bow since the C9 bind, but every one of the three mechanics is gated
  //     on "sworn enemy" - a persistent, player-declared mark on ONE creature - and there is no
  //     target-scoped effect model; authoring the die ungated would land 3d6 on every target.
  //     Unit: **U22** owns target-scoped effects, though §5 does not list
  //     this item as its carrier. Complete.
  //
  // `sword-of-life-stealing` - "that target takes an extra 15 NECROTIC damage" on a natural 20. The
  //     moment is real (`on-critical-hit`, criterion 9) and the closed limit (A) put a flat
  //     crit-gated amount in the vocabulary - but `damage-bonus` is bounded to +/-10 and 15 is out
  //     of range (limit (A)'s closure note names this row). The Temporary Hit
  //     Points it grants the wielder are a second missing shape. Unit: NONE YET. Complete.
  //
  // `sword-of-sharpness` - "that target takes an extra 14 Slashing damage and gains 1 Exhaustion
  //     level" on a natural 20, plus "maximize your weapon damage dice" against objects. Flat 14 is
  //     out of `damage-bonus`'s +/-10 range (limit (A)'s closure note); maximising dice is not a
  //     rider family; objects are not actors.
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
