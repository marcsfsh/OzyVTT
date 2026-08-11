/**
 * C7b - WANDS, STAFFS, RODS, RINGS AND THE SPELL SCROLL. The charges-and-casts lane.
 *
 * 57 items, 46 requiring attunement (re-measured off the committed `bundles/magic-items.v1.json`:
 * `wand` 15, `staff` 12, `rod` 7, `ring` 22, plus `spell-scroll`, which the ETL types `consumable`;
 * the plan's "55 items - 44 attuned" does not reproduce). 27 of them carry a rider here; 30 ship as
 * prose with a NAMED ABSENCE beside them. That 27 is an OUTPUT of reading 57 SRD entries against the
 * vocabulary, not a target anyone set.
 *
 * THE 27 IS A SALVAGE'S COUNT AND THE LANE FIRST AUTHORED 32. A review pass measured nine of those
 * entries producing the WRONG printed effect at a table, and this file converts every one of them to
 * a named absence. **A rider that reaches a reader and produces the wrong effect is worse than an
 * unauthored one**, because an unauthored one is visible in the prose and a wrong one is invisible
 * until the round it happens. L6 below is the reason for seven of the nine; the other two are
 * `ring-of-free-action`'s over-grant and a `saveDc` nothing read.
 *
 * See `./overlay.ts` for what an entry may carry and for the seven refusals every lane inherits.
 * The admission rule is the one that shapes this file: A RIDER IS AUTHORED ONLY WHEN ITS READER
 * SHIPS TODAY. `apps/server/test/item-riders.test.ts` (13 criteria) and
 * `apps/server/test/homebrew-inert-fields.test.ts` (6 rows) are the authoritative list of readers,
 * and every rider below is one of their shapes. A rider whose reader is a later unit's job is not
 * authored - it is a comment naming the item, the SRD sentence, the vocabulary it needs and the unit
 * that unblocks it. An inert rider is the failure this phase exists to end.
 *
 * ============================================================================================
 * SIX LIMITS THIS LANE HITS OVER AND OVER. Stated once here so 30 entries below can point at a
 * number instead of re-arguing it, and every one of them is MEASURED, not assumed.
 * ============================================================================================
 *
 * L1. A USE COSTS EXACTLY ONE CHARGE, so a printed multi-charge cost is not expressible.
 *     `resolveDefinitionAction` debits `actionUses[pool] + 1` per resolution
 *     (`apps/server/src/action-resolution.ts:248`, `spendUse = { key, per }`), and the gate is
 *     `useLimitFor` (`:174-182`), which for a shared pool takes the MAX limit any sibling declares.
 *     So "Fireball: 3 charges" cannot be said either as a cost or as a smaller per-cast limit - a
 *     3-charge cast declared `limit: 3` against a `limit: 10` sibling still gates on 10 and still
 *     spends 1. Authoring it anyway is the Monk error `class-mechanics/wizard.ts` names in as many
 *     words: it "debits the player the wrong amount and hands them a multiple of the printed
 *     resource". So this lane authors the ONE-CHARGE properties of a charged item and records the
 *     dearer ones as absences. The pool SIZE and the refusal at zero are exact.
 *
 * L2. PARTIAL DAILY RECHARGE IS NOT EXPRESSIBLE, and `long-rest` is the honest approximation.
 *     Most items here read "regains 1d6 + 1 expended charges daily at dawn"; `applyRest` clears the
 *     whole `actionUses` pool on a long rest and `FeatureUsesSchema.per` is
 *     `turn | encounter | short-rest | long-rest` with no partial form. `src/schemas.ts:173-175`
 *     already rules that this app treats a long rest as the day. The consequence is stated rather
 *     than hidden: the pool size and the refusal are exact, the RECOVERY is generous.
 *
 * L3. A CHARGE POOL IS CAPPED AT 20. `ActionUsesSchema.limit` and `FeatureUsesSchema.limit` are both
 *     `.max(20)`, so `Staff of the Magi`'s 50 charges have no home. It is authored only for its
 *     zero-charge (at-will) casts, where no pool is needed at all.
 *
 * L4. AN ITEM THAT "CAN BE WIELDED AS A MAGIC QUARTERSTAFF" HAS NO WEAPON BLOCK, and this overlay may
 *     not give it one. `weapon` is a column the ETL parses and `ItemRiderKey` deliberately excludes
 *     it (`overlay.ts`'s header). Measured on the committed bundle: `weapon` is `null` on every
 *     `staff` and `rod` row. So a printed "+2 bonus to attack rolls and damage rolls made with it"
 *     has nowhere correct to go - `attack-bonus` on a weaponless item resolves `scope` to `"bearer"`
 *     (`packages/rules-5e/src/riders.ts:232-235`, `isWeapon` false) and would raise EVERY attack the
 *     bearer makes with any weapon, while `scope: "this-item"` matches a `sourceItemId` no swing
 *     ever carries and fires never. Over-grant or inert; there is no third option, so it is an
 *     absence on all five items that print it.
 *
 * L5. AN ITEM ACTION'S TO-HIT IS DERIVED FROM AN ABILITY, NEVER PRINTED FLAT. `FeatureAttackSchema`
 *     is `{ability, proficient, reach/range, count, criticalBonusDice}` - no flat bonus - so
 *     `Ring of the Ram`'s "makes its attack roll with a +7 bonus", which is the RING's number and
 *     not the wearer's, cannot be said.
 *
 * L6. A SPELL RECORD'S `damage` AND `attackRoll` COLUMNS DESCRIBE THE SPELL'S TEXT, NOT WHAT ONE
 *     CAST ROLLS - and `castAction` reads them as if they did. THIS IS THE LIMIT THAT EMPTIED THE
 *     SALVAGE, so it is stated at length once. `castAction`
 *     (`apps/server/src/equipment-derivation.ts:922-961`) takes `spell.damage.roll` as the cast's
 *     damage formula, `spell.damage.types[0] ?? "force"` as its damage TYPE - note the fallback -
 *     and emits an `attack` block whenever `spell.attackRoll` is true. Measured on the committed
 *     `bundles/spells.v1.json` (339 records), that turns four honest spell records into four wrong
 *     item actions and three more into attacks nobody rolls:
 *       - `cure-wounds` is `{roll: "2d8", types: []}`, so a cast synthesises **2d8 FORCE DAMAGE**.
 *         Point a Staff of Healing at a wounded ally and it hits them for 2d8.
 *       - `heal` is `{roll: null, types: []}`, so a cast synthesises NOTHING and only debits a charge.
 *       - `web` is `{roll: "2d4", types: ["fire"]}`, but the SRD deals that only to a creature that
 *         starts its turn in webs somebody set ON FIRE. The cast rolls it every time.
 *       - `magic-missile` is `{roll: "1d4 + 1"}`, which is ONE dart of the THREE the spell prints
 *         (~3.5 where the spell averages ~10.5).
 *       - `faerie-fire`, `protection-from-evil-and-good` and `ray-of-enfeeblement` all carry
 *         `attackRoll: true` and none of them makes an attack roll: each merely MENTIONS attack
 *         rolls that somebody else makes. `ray-of-enfeeblement` compounds it - its `1d8` is what the
 *         TARGET subtracts from its own damage rolls, and it arrives as 1d8 Force by the fallback.
 *     UNBLOCKED BY: the two `known-bugs.md` entries **[content/spells] There is no healing in the
 *     spell model** and **[content/spells] A spell's `damage` and `attackRoll` columns describe its
 *     TEXT, not what one cast rolls**. Until a spell record says what a cast DOES, this lane authors
 *     a cast only where the record already describes it correctly - which is every remaining cast
 *     below, each one re-checked against `spells.v1.json` and the SRD sentence.
 *
 * WHAT IS NOT HERE BY RESERVATION. Three rider types this lane's items print are `unread` or
 * unbuilt, and `applyItemMechanics` REFUSES the first of them at author time rather than trusting
 * this comment:
 *   - `spell-attack-bonus` (U26) - `CARRIER_RIDER_DISPOSITION` marks it `"unread"`;
 *   - `attack-kind-is: "spell"` (U29) - `attackKindsOf` never announces a spell attack;
 *   - `on-taking-damage` + `damage-reduction` (U31) - `Ring of Warmth`, below.
 */
import type { ItemMechanicsModule } from "./overlay.js";

export const WANDS_RODS_RINGS: ItemMechanicsModule = {
  // =============================================================================================
  // RINGS - 22 rows. 8 authored.
  // =============================================================================================

  /**
   * "This ring has 3 charges... you can expend 1 charge to cast one of the following spells
   * (save DC 13) from it: Animal Friendship, Fear, Speak with Animals."
   *
   * The whole item in one shape: three casts over ONE shared 3-charge pool, each costing the one
   * charge L1 allows, at the printed DC. No attunement, so the pool is live the moment it is worn.
   * "Fear (affects Beasts only)" is a targeting restriction with no vocabulary; the prose carries it.
   *
   * `saveDc: 13` RIDES ONLY THE TWO CASTS THAT HAVE A SAVE. Speak with Animals forces none
   * (`spells.v1.json`: `save: null`) and `castAction` emits a `save` block only when the spell record
   * carries one, so the third `saveDc: 13` the lane first authored was a number with no reader - the
   * same defect as an inert rider, in the one shape this overlay's checks cannot see, and it is out.
   * The two that remain are proved by the derived action: `{ability: "wis", dc: 13}` on both.
   */
  "ring-of-animal-influence": {
    casts: [
      { spellId: "animal-friendship", saveDc: 13, uses: { limit: 3, per: "long-rest", pool: "ring-of-animal-influence-charges" } },
      { spellId: "fear", saveDc: 13, uses: { limit: 3, per: "long-rest", pool: "ring-of-animal-influence-charges" } },
      { spellId: "speak-with-animals", uses: { limit: 3, per: "long-rest", pool: "ring-of-animal-influence-charges" } }
    ]
  },

  /*
   * `ring-of-djinni-summoning` - "you can take a Magic action to summon a particular Djinni from the
   * Elemental Plane of Air." NEEDS: a summoned-creature vocabulary (a rider that puts a second actor
   * on the map under the bearer's control). Nothing in `featureRiders` or `ActionSchema` creates an
   * actor. UNBLOCKED BY: no unit - a gap this program does not own. Prose.
   *
   * `ring-of-elemental-command` - "you have Advantage on attack rolls against Elementals and they
   * have Disadvantage on attack rolls against you." NEEDS: `versus-creature-type` to have a
   * PRODUCER. The trigger parses (`packages/schemas/src/index.ts:104`) and is evaluated against
   * `RiderContext.targetCreatureType` (`packages/rules-5e/src/riders.ts:209`), which is DECLARED and
   * set by nothing - measured: `grep -rn targetCreatureType apps/server/src packages/rules-5e/src`
   * returns the declaration and the read, no write. So the rider would ship inert. Its other halves
   * are worse: the linked plane is a GM choice made per copy (the resistance, the immunity, the
   * languages and the fly/swim speeds all follow from it) and its 5-charge spell table costs 0-5
   * charges per entry (L1). UNBLOCKED BY: no unit for the creature-type producer. Prose.
   */

  /**
   * "This ring has 3 charges... When you fail a Dexterity saving throw while wearing the ring, you
   * can take a Reaction to expend 1 charge to succeed on that save instead."
   *
   * The AUTO-SUCCESS has no rider - nothing in the vocabulary edits a save's OUTCOME (`save-bonus`
   * and `roll-mode` move the roll, not the result). What is real and enforced is the CHARGE: a
   * declared reaction with a 3-use pool, which the sheet shows, the resolver spends, and the economy
   * refuses at zero. The GM adjudicates the success; the ring cannot be used a fourth time in a day.
   */
  "ring-of-evasion": {
    actions: [{
      id: "evade", name: "Evade", activation: "reaction",
      description: "When you fail a Dexterity saving throw while wearing the ring, you can take a Reaction to expend 1 charge to succeed on that save instead.",
      uses: { limit: 3, per: "long-rest", pool: "ring-of-evasion-charges" }
    }]
  },

  /*
   * `ring-of-feather-falling` - "you descend 60 feet per round and take no damage from falling."
   * NEEDS: a falling model. There is no fall damage in the engine to reduce and no per-round descent
   * rate to set. UNBLOCKED BY: no unit. Prose.
   */

  /*
   * `ring-of-free-action` - "While you wear this ring, Difficult Terrain doesn't cost you extra
   * movement. In addition, MAGIC can neither reduce any of your Speeds nor cause you to have the
   * Paralyzed or Restrained condition."
   *
   * NEEDS: a SOURCE FILTER on `grants.conditionImmunities`. The reader ships and works - a granted
   * immunity is derived at `equipment-derivation.ts:580` and `setCondition` narrates the skip rather
   * than applying (`apps/server/src/actor-conditions.ts:52-56`) - and that is the problem, because
   * the immunity it produces is ABSOLUTE. Nothing on the grant, the derivation or the condition
   * carries where the condition came from, so the ring refuses conditions the SRD lets land, and the
   * cases are ordinary rather than exotic: measured in the shipped `bundles/monsters.v1.json`, a
   * Giant Spider's Web (*"Failure: The target has the Restrained condition"*) and a Ghoul's Claw
   * (*"Failure: The target has the Paralyzed condition"*) are both non-magical and both would be
   * refused - 42 of the shipped monsters name one of the two conditions.
   *
   * THE LANE FIRST AUTHORED THIS ONE with the over-grant written out in a comment, and the salvage
   * rules the other way. The reason is consistency, not taste: this same module already refuses this
   * exact shape twice by name - `ring-of-spell-turning` below ("Authoring it ungated would hand a
   * legendary ring advantage on every saving throw of every kind - strictly more than the SRD
   * prints") and L4's `scope: "bearer"` - so authoring it here made the file argue with itself. An
   * item quietly BETTER than its printed text is the same failure as one quietly worse: invisible
   * until the round it decides a fight, and unattributable when it does.
   *
   * UNBLOCKED BY: no unit; needs a magical/non-magical qualifier on
   * `FeatureGrantsSchema.conditionImmunities` and a producer for it where `setCondition` reads.
   * (The difficult-terrain half has no vocabulary either - movement cost is not modelled.) Prose.
   */

  /*
   * `ring-of-invisibility` - "you can take a Magic action to give yourself the Invisible condition."
   * NEEDS: an action that applies a condition to the ACTOR. `ActionSchema.onHit[].conditions` applies
   * to a TARGET on a hit, and `ActionSchema.grants` grants an EffectGrant whose modifier vocabulary
   * has no condition. UNBLOCKED BY: no unit. Prose.
   */

  /** "While wearing this ring, you can cast Jump from it, but can target only yourself." Self-only is prose. */
  "ring-of-jumping": { casts: [{ spellId: "jump" }] },

  /*
   * `ring-of-mind-shielding` - "you are immune to magic that allows other creatures to read your
   * thoughts..." NEEDS: an immunity keyed to a school or an effect kind rather than a damage type or
   * a condition. UNBLOCKED BY: no unit. Prose.
   */

  /**
   * "You gain a +1 bonus to Armor Class and saving throws while wearing this ring."
   *
   * Both readers ship and both are proved at an engine outcome: `armor-class` on a ring changes the
   * derived AC and vanishes on unequip (`item-riders.test.ts` criterion 3), and `save-bonus` is
   * summed into the save the SERVER rolls (criterion 12). Two riders, no gate, nothing approximated.
   */
  "ring-of-protection": {
    modifiers: [
      { type: "armor-class", amount: 1 },
      { type: "save-bonus", amount: 1 }
    ]
  },

  /*
   * `ring-of-regeneration` - "you regain 1d6 Hit Points every 10 minutes." NEEDS: a periodic
   * out-of-combat healing timer. There is no clock a rider can hang on. UNBLOCKED BY: no unit. Prose.
   */

  /**
   * "You have Resistance to one damage type while wearing this ring. The gemstone in the ring
   * indicates the type, which the GM chooses or determines randomly by rolling on the following
   * table" (1d10: acid, cold, fire, force, lightning, necrotic, poison, psychic, radiant, thunder).
   *
   * THE LANE PICKS ONE AND SAYS WHICH: **fire**, the 1d10 3 row (Garnet). The plan gives C7a the same
   * instruction for `Armor of Resistance` in as many words - "the GM picks the type off a d10 table,
   * so the lane authors one and says which" - because a catalog row is ONE record and the vocabulary
   * has no per-copy variable. A GM wanting the Tourmaline ring copies this row in the homebrew editor
   * and changes one slug; the printed table stays in the description above it.
   *
   * `grants.damageResistances` is read at the far end: `applyDamageDetailed` halves the typed total
   * and names the item on the line (`homebrew-inert-fields.test.ts` row 2).
   */
  "ring-of-resistance": { grants: { damageResistances: ["fire"] } },

  /**
   * "You can cast Dancing Lights or Light from the ring. The ring has 6 charges... Faerie Fire. You
   * can expend 1 charge to cast Faerie Fire from the ring... Shooting Stars. You can expend 1 to 3
   * charges as a Magic action. For every charge you expend, you launch a glowing mote... Each
   * creature in a 15-foot Cube... makes a DC 15 Dexterity saving throw, taking 5d4 Radiant damage on
   * a failed save or half as much damage on a successful one."
   *
   * Two of the four properties land. The two cantrips are at-will and carry no `uses` at all;
   * Shooting Stars is an `actions` entry rather than a cast because it is the ring's own effect and
   * not a spell: its DC and dice are printed, so `save` carries the flat 15 and the damage rolls as
   * authored, off the 6-charge pool.
   *
   * NOT AUTHORED:
   *   - **Faerie Fire** - L6. The lane authored this cast and the salvage removes it: `faerie-fire`
   *     carries `attackRoll: true` in `spells.v1.json`, so `castAction` hangs an `attack` block on
   *     it, and the spell makes no attack roll at all - *"Each creature in the Cube is also outlined
   *     if it fails a Dexterity saving throw"*. The only attack rolls Faerie Fire names are the ones
   *     OTHER creatures then make against the outlined target with Advantage. A player pressing this
   *     would roll to hit with a spell that does not ask for a roll.
   *   - the 2-charge Lightning Spheres (L1), and Shooting Stars' scaling to 2 or 3 charges for more
   *     motes (L1 again - the one-charge version is what a single use may spend).
   */
  "ring-of-shooting-stars": {
    casts: [
      { spellId: "dancing-lights" },
      { spellId: "light" }
    ],
    actions: [{
      id: "shooting-stars", name: "Shooting Stars", activation: "action",
      description: "Expend 1 charge to launch a glowing mote of light at a point within 60 feet. Each creature in a 15-foot Cube originating from that point makes a DC 15 Dexterity saving throw, taking 5d4 Radiant damage on a failed save or half as much damage on a successful one.",
      save: { ability: "dex", dc: 15 },
      damage: [{ formula: "5d4", type: "radiant" }],
      uses: { limit: 6, per: "long-rest", pool: "ring-of-shooting-stars-charges" }
    }]
  },

  /*
   * `ring-of-spell-storing` - "This ring stores spells cast into it... up to 5 levels worth."
   * NEEDS: per-copy mutable storage on an inventory row, and a cast that carries the ORIGINAL
   * caster's DC, attack bonus and ability. `ItemSpellCastSchema` names one fixed `spellId` and the
   * catalog record is shared by every copy. UNBLOCKED BY: no unit. Prose.
   *
   * `ring-of-spell-turning` - "you have Advantage on saving throws against spells." NEEDS: a filter
   * for "the save is against a spell". `roll-mode` with `roll: "save"` ships and is read
   * (`saving-throws.ts:255`), but the only narrowing filters are `ability-is`, `spell-school-is`,
   * `spell-level-is` and `spell-id-is`, and the last three describe the spell the BEARER casts, not
   * the one they are saving against. Authoring it ungated would hand a legendary ring advantage on
   * every saving throw of every kind - strictly more than the SRD prints. UNBLOCKED BY: no unit;
   * needs an incoming-spell filter on the save moment. Prose.
   *
   * `ring-of-swimming` - "You have a Swim Speed of 40 feet." NEEDS: a swim speed. The `speed` rider
   * is the walking speed and `EquipmentDerivation.speed` is a single number; a Swim Speed authored
   * there would raise the bearer's land speed by 40. UNBLOCKED BY: no unit. Prose.
   */

  /** "While wearing this ring, you can cast Telekinesis from it." At will, no charges, no DC override. */
  "ring-of-telekinesis": { casts: [{ spellId: "telekinesis" }] },

  /*
   * `ring-of-the-ram` - "you can take a Magic action to expend 1 to 3 charges to make a ranged spell
   * attack... The ring produces a spectral ram's head and makes its attack roll with a +7 bonus. On a
   * hit, for each charge you spend, the target takes 2d10 Force damage." NEEDS: a FLAT printed attack
   * bonus on an item action (L5) - the +7 is the ring's own number and derives from nothing the
   * wearer has - and a per-charge damage scale (L1). It is also a spell attack (U29). Authoring the
   * damage without the attack would make it auto-hit; authoring an ability-derived to-hit would print
   * a different number for every wearer. UNBLOCKED BY: U29 for the attack kind, plus a flat-bonus
   * form on `FeatureAttackSchema` that no unit owns. Prose.
   *
   * `ring-of-three-wishes` - "you can expend 1 of its 3 charges to cast Wish from it. The ring becomes
   * nonmagical when you use the last charge." NEEDS: a charge pool that NEVER recovers.
   * `FeatureUsesSchema.per` has four values and every one of them re-arms (L2), so
   * `{limit: 3, per: "long-rest"}` would hand out three Wishes A DAY where the SRD gives three ever -
   * the largest over-grant available anywhere in this lane. UNBLOCKED BY: no unit; needs a
   * `per: "never"` (or a consumed-charges model). Prose.
   */

  /*
   * `ring-of-warmth` - "If you take Cold damage while wearing this ring, the ring reduces the damage
   * you take by 2d8." NEEDS: `on-taking-damage` + `damage-reduction`, and `damage-reduction.amount`
   * is a flat integer where the SRD prints 2d8. UNBLOCKED BY: **U31**. It is a Ring and therefore
   * this lane's, not C7c's. Prose. (The temperature half - "unharmed by temperatures of 0 degrees
   * Fahrenheit or lower" - is GM fiat with nothing to model.)
   */

  /** "While wearing this ring, you cast Water Walk from it, targeting only yourself." Self-only is prose. */
  "ring-of-water-walking": { casts: [{ spellId: "water-walk" }] },

  /*
   * `ring-of-x-ray-vision` - "you can take a Magic action to gain X-ray vision with a range of 30
   * feet for 1 minute." NEEDS: a TIMED, ACTIVATED sense. The `sense` rider is `display-only`
   * (`CARRIER_RIDER_DISPOSITION`) AND standing - authoring it would print a permanent X-ray line on
   * the sheet for an ability that lasts a minute and costs an action, and the escalating Exhaustion
   * risk for re-use has no counter shape (it is a save, not a charge). UNBLOCKED BY: no unit. Prose.
   */

  // =============================================================================================
  // RODS - 7 rows. 2 authored.
  // =============================================================================================

  /*
   * `immovable-rod` - a button that fixes the rod in space and holds 8,000 pounds. Physical-world GM
   * fiat with no rider surface at all. NEEDS: nothing this vocabulary is for - the rod acts on the
   * WORLD rather than on a creature, and every rider in `ItemRiderKey` acts on the bearer, a target
   * or a roll. UNBLOCKED BY: no unit, and no unit should be written for it; a GM ruling at the table
   * is the correct implementation of this item and would be even if the vocabulary were richer.
   * (Recorded with all four quarters because C8 audits these mechanically and this entry was the one
   * missing its "unblocked by".) Prose.
   *
   * `rod-of-absorption` - "you can take a Reaction to absorb a spell that is targeting only you...
   * you can convert energy stored in it into spell slots." NEEDS: mutable per-copy storage and a slot
   * REFUND. `spell-slot` is a MAXIMUM rider, not a refund - the same absence `class-mechanics/
   * wizard.ts` records for Arcane Recovery. UNBLOCKED BY: no unit. Prose.
   */

  /**
   * "Alertness. While holding the rod, you have Advantage on Wisdom (Perception) checks and on
   * Initiative rolls. Spells. While holding the rod, you can cast the following spells from it:
   * Detect Evil and Good, Detect Magic, Detect Poison and Disease, See Invisibility. Protective
   * Aura... Once used, this property can't be used again until the next dawn."
   *
   * The INITIATIVE half of Alertness is authored and is one of the strongest riders in this lane:
   * `initiativeRollMode` aggregates it and the encounter really keeps the higher die
   * (`item-riders.test.ts` criterion 5). The four detection spells are at-will casts.
   * The Protective Aura is authored for its COUNTER only - once per dawn, spent and refused - with
   * the buff itself in the prose.
   *
   * NOT AUTHORED, and it is the half a reviewer will look for: **the Perception advantage**.
   * `roll-mode` with `roll: "check"` parses, and `checkRiderBonus`
   * (`equipment-derivation.ts:778-786`) collects the `on-ability-check` moment - but it sums
   * `check-bonus` ONLY. Measured: `aggregateRollMode` has exactly three call sites
   * (`encounter.ts:65`/`:122` for initiative, `saving-throws.ts:255` for saves,
   * `action-resolution.ts:846` for attacks) and none of them is an ability check, so advantage on a
   * check reaches nothing. NEEDS: a roll-mode reader on the ability-check path. UNBLOCKED BY: no
   * unit. (`check-bonus` IS read, but the SRD prints advantage here, not a number.)
   * The aura's "+1 bonus to Armor Class and saving throws" for YOU AND YOUR ALLIES is a second
   * absence: no rider targets another actor.
   */
  "rod-of-alertness": {
    modifiers: [{ type: "roll-mode", roll: "initiative", mode: "advantage" }],
    casts: [
      { spellId: "detect-evil-and-good" },
      { spellId: "detect-magic" },
      { spellId: "detect-poison-and-disease" },
      { spellId: "see-invisibility" }
    ],
    actions: [{
      id: "protective-aura", name: "Protective Aura", activation: "action",
      description: "Plant the haft end of the rod in the ground. Its head sheds Bright Light in a 60-foot radius and Dim Light for an additional 60 feet. While in that Bright Light, you and your allies gain a +1 bonus to Armor Class and saving throws and can sense the location of any Invisible creature that is also in the Bright Light. Ends after 10 minutes or when a creature pulls the rod from the ground.",
      uses: { limit: 1, per: "long-rest" }
    }]
  },

  /*
   * `rod-of-lordly-might` - "it functions as a magic Mace that grants a +3 bonus to attack rolls and
   * damage rolls made with it", six button forms, and three once-per-dawn on-hit properties.
   * NEEDS: a `weapon` block on the row (L4) - without one the +3 is over-grant or inert, and Drain
   * Life / Paralyze are "when you hit a creature with a melee attack USING THE ROD", which is the
   * same missing swing. Buttons 1-3 mint three DIFFERENT weapons from one catalog record, which no
   * schema shape allows. UNBLOCKED BY: no unit; needs the ETL to type a weapon-shaped rod, or an
   * overlay key for `weapon`, which `ItemRiderKey` deliberately excludes. Prose.
   */

  /*
   * `rod-of-resurrection` - "The rod has 5 charges. While you hold it, you can cast one of the
   * following spells from it: Heal (expends 1 charge) or Resurrection (expends 5 charges)."
   *
   * NEEDS: healing. The lane authored the Heal cast as the one-charge property and the salvage
   * removes it, for the same root cause as `staff-of-healing` and with a worse symptom: `heal` is
   * `{roll: null, types: []}` in `spells.v1.json`, so `castAction` synthesises an action with no
   * damage, no save and no attack - it restores NOTHING and debits a charge. A legendary rod's whole
   * printed purpose, reduced to a counter going down. UNBLOCKED BY: the known-bugs entry
   * **[content/spells] There is no healing in the spell model** (L6) - a `healing` block on the spell
   * reference, the ETL to populate it, and a reader.
   * **Resurrection at 5 charges** is a second absence and predates this one (L1): one use spends one
   * charge, so authoring it would let a character cast Resurrection five times from a rod the SRD
   * lets cast it once. The 1d20 destruction roll on the last charge is a GM roll with no counter
   * shape. That list is complete - the rod prints nothing else. Prose.
   */

  /**
   * "You can take a Magic action to present the rod and command obedience from each creature of your
   * choice that you can see within 120 feet of yourself. Each target must succeed on a DC 15 Wisdom
   * saving throw or have the Charmed condition for 8 hours. Once used, this property can't be used
   * again until the next dawn."
   *
   * A complete row: the printed flat DC, the once-per-dawn counter, and the CONDITION. The condition
   * is not authored as a field - `resolveDefinitionAction` reads it off the action's own prose
   * (`conditionFrom`, `saving-throws.ts:96`) and attaches it to each pending save, so the word
   * "Charmed" in the description below is load-bearing and must not be paraphrased away.
   */
  "rod-of-rulership": {
    actions: [{
      id: "command-obedience", name: "Command Obedience", activation: "action",
      description: "Present the rod and command obedience from each creature of your choice that you can see within 120 feet. Each target must succeed on a DC 15 Wisdom saving throw or have the Charmed condition for 8 hours. If harmed by you or your allies, or commanded to do something contrary to its nature, a target ceases to be Charmed in this way.",
      save: { ability: "wis", dc: 15 },
      uses: { limit: 1, per: "long-rest" }
    }]
  },

  /*
   * `rod-of-security` - transports up to 200 creatures to a demiplane for up to 200 days, once per 10
   * days. NEEDS: a plane/scene model, and a recharge period `FeatureUsesSchema.per` cannot say (L2 -
   * "10 days" is not one of its four values). UNBLOCKED BY: no unit. Prose.
   */

  // =============================================================================================
  // THE SCROLL - 1 row.
  // =============================================================================================

  /*
   * `spell-scroll` - "A Spell Scroll bears the words of a SINGLE SPELL, written in a mystical cipher."
   * NEEDS: a per-copy spell selection. `ItemSpellCastSchema.spellId` is one fixed slug on a catalog
   * record shared by every copy, and the SRD row is a TEMPLATE whose spell, rarity, save DC (13-19)
   * and attack bonus (+5 to +11) are all functions of a level chosen when the scroll is written. One
   * authored `spellId` would turn the whole SRD's Spell Scroll into a scroll of that one spell. The
   * two remaining halves have no shape either: "the scroll crumbles to dust" is a consume-on-use the
   * inventory does not model, and the DC-(10 + level) check to cast above your level is an ability
   * check gated on a comparison. UNBLOCKED BY: no unit; the practical answer today is that a GM mints
   * the concrete scroll in the homebrew editor, where every one of these fields is already mounted.
   * Prose.
   */

  // =============================================================================================
  // STAFFS - 12 rows. 8 authored.
  // =============================================================================================

  /**
   * "This staff has 10 charges... You can expend 1 of the staff's charges to cast Charm Person,
   * Command, or Comprehend Languages from it USING YOUR SPELL SAVE DC."
   *
   * The cleanest charged item in the lane: every printed property costs exactly one charge, so all
   * three land on one pool with nothing approximated. No `saveDc` is authored ON PURPOSE - absent, the
   * cast derives the WIELDER's own DC (`castAction`, `equipment-derivation.ts:952-954`), which is
   * exactly what "using your spell save DC" says.
   *
   * NOT AUTHORED: Reflect Enchantment (a Reaction that turns a spell back on its caster) and Resist
   * Enchantment (turning a failed save into a success) - the same missing save-outcome vocabulary
   * `ring-of-evasion` records above.
   */
  "staff-of-charming": {
    casts: [
      { spellId: "charm-person", uses: { limit: 10, per: "long-rest", pool: "staff-of-charming-charges" } },
      { spellId: "command", uses: { limit: 10, per: "long-rest", pool: "staff-of-charming-charges" } },
      { spellId: "comprehend-languages", uses: { limit: 10, per: "long-rest", pool: "staff-of-charming-charges" } }
    ]
  },

  /**
   * "You have Resistance to Fire damage while you hold this staff. The staff has 10 charges...
   * Burning Hands: Charge Cost 1, Fireball: 3, Wall of Fire: 4."
   *
   * Two riders: the resistance (read at the far end by `applyDamageDetailed`) and the one-charge
   * cast. NOT AUTHORED: **Fireball (3 charges)** and **Wall of Fire (4 charges)** - L1.
   */
  "staff-of-fire": {
    grants: { damageResistances: ["fire"] },
    casts: [{ spellId: "burning-hands", uses: { limit: 10, per: "long-rest", pool: "staff-of-fire-charges" } }]
  },

  /**
   * "You have Resistance to Cold damage while you hold this staff. The staff has 10 charges...
   * Fog Cloud: 1, Wall of Ice: 4, Ice Storm: 4, Cone of Cold: 5."
   *
   * NOT AUTHORED: **Wall of Ice, Ice Storm and Cone of Cold** - L1. Fog Cloud is the one-charge row.
   */
  "staff-of-frost": {
    grants: { damageResistances: ["cold"] },
    casts: [{ spellId: "fog-cloud", uses: { limit: 10, per: "long-rest", pool: "staff-of-frost-charges" } }]
  },

  /*
   * `staff-of-healing` - "This staff has 10 charges... Cure Wounds: 1 charge per spell level
   * (maximum 4 for a level 4 spell); Lesser Restoration: 2; Mass Cure Wounds: 5."
   *
   * THE ONE THAT COST THIS SALVAGE THE MOST, and the reason the lane is unmerged. The Cure Wounds
   * cast was authored as the one-charge property and it is REMOVED. NEEDS: healing. There is none in
   * the spell model (L6): `SpellReferenceSchema` has no `healing` field, a healing spell's dice live
   * in `damage.roll` with an EMPTY `damage.types`, and `castAction`'s type fallback is `"force"`. So
   * `cure-wounds` = `{roll: "2d8", types: []}` synthesises a **2d8 Force DAMAGE action** - point a
   * Staff of Healing at a bleeding ally and it hits them for 2d8. Every part of that is measured,
   * and the only thing on screen that would have hinted at it is the word "Force". UNBLOCKED BY: the
   * known-bugs entry **[content/spells] There is no healing in the spell model** - a `healing` block
   * on the spell reference, the ETL to populate it, and a reader.
   * **The upcast rows of Cure Wounds (levels 2-4), Lesser Restoration and Mass Cure Wounds** are
   * absences on L1 as well, and would be even after L6 lifts. That list is complete - the staff
   * prints nothing but the table. Prose.
   */

  /**
   * "This staff has 20 charges and can be wielded as a magic Quarterstaff that grants a +2 bonus to
   * attack rolls and damage rolls made with it. While holding it, you gain a +2 bonus to Armor Class,
   * saving throws, and spell attack rolls... Magic Missile: 1; Ray of Enfeeblement: 1."
   *
   * THE AC AND SAVING-THROW HALVES ARE READABLE TODAY AND ARE AUTHORED; the third item in that same
   * printed sentence is not. They are the whole of what this staff can say - **the salvage removed
   * BOTH of its one-charge casts**, so nothing draws on the 20-charge pool and the pool itself is
   * gone with them.
   *
   * NOT AUTHORED:
   *   - **Magic Missile (1 charge)** - L6. `magic-missile` is `{roll: "1d4 + 1", types: ["force"]}`,
   *     which is ONE dart; the SRD prints *"three glowing darts"*, each dealing that. The cast
   *     therefore rolls ~3.5 where the spell averages ~10.5, and it is the quiet kind of wrong: the
   *     action fires, a number appears, and it is a third of the right one. UNBLOCKED BY: a per-cast
   *     projectile count on the spell reference (`targetCount` exists on `castingOptions` rows and
   *     nothing reads it), or the cast-time damage model L6 names.
   *   - **Ray of Enfeeblement (1 charge)** - L6, in its worst form. The record carries
   *     `attackRoll: true` and `{roll: "1d8", types: []}`, so a cast synthesises a **1d8 Force spell
   *     attack**. The SRD prints neither: *"The target must make a Constitution saving throw... it
   *     also subtracts 1d8 from all its damage rolls"* - there is no attack roll, and the 1d8 is a
   *     penalty the TARGET applies to itself, not damage anyone takes.
   *   - **the +2 to spell attack rolls** - `spell-attack-bonus`, which `CARRIER_RIDER_DISPOSITION`
   *     marks `"unread"`. UNBLOCKED BY: **U26**. (This item is a U26 carrier as well as a U29 one; an
   *     earlier draft filed it under U29 alone.) `applyItemMechanics` refuses this rider at author
   *     time, so the reservation is enforced rather than merely requested.
   *   - **the spell attack roll itself** - `attack-kind-is: "spell"`. UNBLOCKED BY: **U29**.
   *   - **the +2 Quarterstaff** - L4, no weapon block.
   *   - **Cone of Cold (5), Fireball at level 5 (5), Globe of Invulnerability (6), Hold Monster (5),
   *     Levitate (2), Lightning Bolt at level 5 (5), Wall of Force (5)** - L1.
   *   - Retributive Strike: "Force damage equal to 16 times the number of charges in the staff" is
   *     damage computed from live charge state; no formula language (ADR-0008).
   */
  "staff-of-power": {
    modifiers: [
      { type: "armor-class", amount: 2 },
      { type: "save-bonus", amount: 2 }
    ]
  },

  /*
   * `staff-of-striking` - "a magic Quarterstaff that grants a +3 bonus to attack rolls and damage
   * rolls made with it... When you hit with a melee attack using it, you can expend up to 3 charges.
   * For each charge you expend, the target takes an extra 1d6 Force damage." NEEDS: a weapon block
   * (L4) for BOTH halves - the +3 and the on-hit extra damage are both "with it", and an
   * `extra-damage` rider on a weaponless staff would add 1d6 Force to every weapon the bearer swings.
   * The per-charge scaling is L1 on top of that, and nothing ties an `extra-damage` rider to a charge
   * spend at all. UNBLOCKED BY: no unit. Prose - and this is the item in the lane that most looks
   * authorable and is not.
   */

  /**
   * "This staff has 10 charges. Insect Cloud. While holding the staff, you can take a Magic action and
   * expend 1 charge to cause a swarm of harmless flying insects to fill a 30-foot Emanation
   * originating from you... Giant Insect: 4; Insect Plague: 5."
   *
   * Insect Cloud is the one-charge property and is authored as an action for its counter; the area is
   * Heavily Obscured, which is a GM ruling with no rider. NOT AUTHORED: **Giant Insect (4 charges) and
   * Insect Plague (5 charges)** - L1.
   */
  "staff-of-swarming-insects": {
    actions: [{
      id: "insect-cloud", name: "Insect Cloud", activation: "action",
      description: "Expend 1 charge to fill a 30-foot Emanation originating from you with a swarm of harmless flying insects. They remain for 10 minutes, making the area Heavily Obscured for creatures other than you. A strong wind disperses the swarm and ends the effect.",
      uses: { limit: 10, per: "long-rest", pool: "staff-of-swarming-insects-charges" }
    }]
  },

  /**
   * "This staff has 50 charges... Arcane Lock: 0; Detect Magic: 0; Enlarge/Reduce: 0; Light: 0;
   * Protection from Evil and Good: 0."
   *
   * FOUR AT-WILL CASTS - zero-charge rows, which need no pool and therefore dodge both L1 and L3.
   * That is the whole of what this staff can say today, and the reason is worth naming: its 50 charges
   * exceed the vocabulary's cap of 20 (L3), so even the 2-charge rows would have nowhere to draw from.
   *
   * NOT AUTHORED:
   *   - **Protection from Evil and Good (0 charges)** - L6. The lane authored this fifth at-will cast
   *     and the salvage removes it: the record carries `attackRoll: true`, so `castAction` hangs an
   *     `attack` block on a spell that rolls nothing at anybody. Its own text is a ward -
   *     *"Creatures of those types have Disadvantage on attack rolls against the target"* - and that
   *     borrowed phrase is the whole reason the column says true.
   *   - **the +2 to spell attack rolls** - UNBLOCKED BY: **U26** (refused at author time).
   *   - **the spell attack roll itself** - UNBLOCKED BY: **U29**.
   *   - **the +2 Quarterstaff** - L4.
   *   - **advantage on saving throws against spells** - the same missing incoming-spell filter
   *     `ring-of-spell-turning` records above.
   *   - **every 2-to-7-charge row** (Flaming Sphere, Invisibility, Knock, Web, Dispel Magic, Ice
   *     Storm, Wall of Fire, Passwall, Telekinesis, Conjure Elemental, Plane Shift, Fireball and
   *     Lightning Bolt at level 7) - L1 and L3.
   *   - Spell Absorption and Retributive Strike - live charge state as damage, as on Staff of Power.
   */
  "staff-of-the-magi": {
    casts: [
      { spellId: "arcane-lock" },
      { spellId: "detect-magic" },
      { spellId: "enlargereduce" },
      { spellId: "light" }
    ]
  },

  /*
   * `staff-of-the-python` - "you can throw this staff... causing the staff to become a Giant
   * Constrictor Snake in that space. The snake is under your control and shares your Initiative
   * count." NEEDS: the same summoned-creature vocabulary `ring-of-djinni-summoning` records - a
   * second actor, controlled, on the bearer's initiative. UNBLOCKED BY: no unit. Prose.
   */

  /**
   * "This staff has 6 charges... Animal Friendship: 1; Speak with Animals: 1... Tree Form. You can
   * take a Magic action to plant one end of the staff in earth... and expend 1 charge to transform the
   * staff into a healthy tree."
   *
   * All three one-charge properties land on the 6-charge pool.
   *
   * NOT AUTHORED:
   *   - **the +2 to spell attack rolls** - UNBLOCKED BY: **U26** (refused at author time).
   *   - **the spell attack roll itself** - UNBLOCKED BY: **U29**.
   *   - **the +2 Quarterstaff** - L4.
   *   - **Barkskin (2), Locate Animals or Plants (2), Pass without Trace (2), Speak with Plants (3),
   *     Awaken (5), Wall of Thorns (6)** - L1.
   */
  "staff-of-the-woodlands": {
    casts: [
      { spellId: "animal-friendship", uses: { limit: 6, per: "long-rest", pool: "staff-of-the-woodlands-charges" } },
      { spellId: "speak-with-animals", uses: { limit: 6, per: "long-rest", pool: "staff-of-the-woodlands-charges" } }
    ],
    actions: [{
      id: "tree-form", name: "Tree Form", activation: "action",
      description: "Plant one end of the staff in earth in an unoccupied space and expend 1 charge to transform it into a healthy tree, 60 feet tall with a 5-foot-diameter trunk and a 20-foot-radius crown. While touching the tree and using a Magic action, you return the staff to its normal form.",
      uses: { limit: 6, per: "long-rest", pool: "staff-of-the-woodlands-charges" }
    }]
  },

  /**
   * "Lightning Strike. You can take a Magic action to cause a bolt of lightning to leap from the
   * staff's tip in a Line that is 5 feet wide and 120 feet long. Each creature in that Line makes a
   * DC 17 Dexterity saving throw, taking 9d6 Lightning damage on a failed save or half as much damage
   * on a successful one. Thunderclap. ... Every creature within a 60-foot Emanation originating from
   * you makes a DC 17 Constitution saving throw. On a failed save, a creature takes 2d6 Thunder damage
   * and has the Deafened condition for 1 minute."
   *
   * The staff's two STANDALONE properties are complete rows - printed DC, real dice, and the
   * once-per-dawn counter each carries ("Once one of these properties is used, it can't be used again
   * until the next dawn"). Thunderclap's Deafened comes off its prose through `conditionFrom`, so the
   * word in the description is load-bearing. Each gets its OWN counter rather than a shared pool,
   * because the SRD gates them independently.
   *
   * NOT AUTHORED: **Lightning, Thunder and Thunder-and-Lightning** - all three are "when you hit with
   * a melee attack using the staff", which needs the weapon block L4 says this row does not have, and
   * the +2 Quarterstaff itself for the same reason.
   */
  "staff-of-thunder-and-lightning": {
    actions: [
      {
        id: "lightning-strike", name: "Lightning Strike", activation: "action",
        description: "A bolt of lightning leaps from the staff's tip in a Line 5 feet wide and 120 feet long. Each creature in that Line makes a DC 17 Dexterity saving throw, taking 9d6 Lightning damage on a failed save or half as much damage on a successful one.",
        save: { ability: "dex", dc: 17 },
        damage: [{ formula: "9d6", type: "lightning" }],
        uses: { limit: 1, per: "long-rest" }
      },
      {
        id: "thunderclap", name: "Thunderclap", activation: "action",
        description: "The staff produces a thunderclap audible out to 600 feet. Every creature within a 60-foot Emanation originating from you makes a DC 17 Constitution saving throw. On a failed save, a creature takes 2d6 Thunder damage and has the Deafened condition for 1 minute. On a successful save, a creature takes half as much damage only.",
        save: { ability: "con", dc: 17 },
        damage: [{ formula: "2d6", type: "thunder" }],
        uses: { limit: 1, per: "long-rest" }
      }
    ]
  },

  /*
   * `staff-of-withering` - "The staff can be wielded as a magic Quarterstaff. On a hit... you can
   * expend 1 charge to deal an extra 2d10 Necrotic damage to the target and force it to make a DC 15
   * Constitution saving throw." NEEDS: a weapon block (L4). The extra damage is `extra-damage` +
   * `when: [{on-hit}]`, whose reader ships - but on a weaponless staff its scope resolves to the
   * BEARER and it would add 2d10 Necrotic to every weapon they swing, unlimited by the 3 charges the
   * SRD spends. The follow-up save is a second thing an `extra-damage` rider cannot carry.
   * UNBLOCKED BY: no unit. Prose.
   */

  // =============================================================================================
  // WANDS - 15 rows. 9 authored.
  // =============================================================================================

  /*
   * `wand-of-binding` - "Hold Monster: 5; Hold Person: 2." NEEDS: a multi-charge cost (L1). BOTH of
   * this wand's properties cost more than one charge, so unlike every other charged wand here there is
   * no one-charge row to author. UNBLOCKED BY: no unit. Prose.
   */

  /**
   * "This wand has 7 charges. While holding it, you can take a Magic action to expend 1 charge. For 1
   * minute, you know the direction of the nearest creature Hostile to you within 60 feet."
   *
   * The detection itself is information the GM gives; the CHARGE is real, spent and refused at zero.
   */
  "wand-of-enemy-detection": {
    actions: [{
      id: "detect-enemies", name: "Detect Enemies", activation: "action",
      description: "Expend 1 charge. For 1 minute, you know the direction of the nearest creature Hostile to you within 60 feet, but not its distance. The wand senses Hostile creatures that are Invisible, ethereal, disguised, or hidden, as well as those in plain sight. The effect ends if you stop holding the wand.",
      uses: { limit: 7, per: "long-rest", pool: "wand-of-enemy-detection-charges" }
    }]
  },

  /**
   * "This wand has 7 charges... Command (flee or grovel only): 1; Fear (60-foot Cone): 3", at save
   * DC 15.
   *
   * Command is the one-charge row and carries the wand's printed DC rather than the wielder's, which
   * is what `saveDc` is for. NOT AUTHORED: **Fear (3 charges)** - L1.
   */
  "wand-of-fear": {
    casts: [{ spellId: "command", saveDc: 15, uses: { limit: 7, per: "long-rest", pool: "wand-of-fear-charges" } }]
  },

  /**
   * ============================== THIS LANE'S FAR END ==============================
   *
   * "This wand has 7 charges. While holding it, you can expend no more than 3 charges to cast Fireball
   * (save DC 15) from it. For 1 charge, you cast the level 3 version of the spell."
   *
   * The one-charge row is the whole printed base case, and it is complete: `castAction` resolves
   * Fireball's OWN 8d6 Fire out of `spells.v1.json` (339 records), the printed DC 15 overrides the
   * derivation, and the 7-charge pool is spent per use and REFUSED at zero with the wand named -
   * "Cast Fireball (Wand of Fireballs): no uses remaining (7/long rest)."
   *
   * NO `atLevel`, AND THE SALVAGE REMOVED THE ONE THE LANE AUTHORED. `atLevel: 3` equals Fireball's
   * own level, and `castAction` reads it only through `level > spell.level` - so it selected no
   * upcast row, moved no die and changed no outcome in any direction. The lane's stated reason was
   * that it "pins the printed level 3 version against a future re-vendor"; it does not pin anything,
   * because a re-vendor that moved Fireball's level would make `atLevel: 3` start selecting an
   * upcast rather than hold the old number. An authored value nothing reads is exactly what this
   * salvage is removing one entry above (`ring-of-animal-influence`'s third `saveDc`), and the same
   * ruling applies here and on `wand-of-lightning-bolts`. Absent, the cast uses the spell's own
   * level, which is what the SRD prints.
   *
   * THE SPELL ID IS THE THING THAT USED TO SHIP INERT. `fire-bolt` and `delayed-blast-fireball` are
   * both real ids in this bundle and `fire-ball` is not; a near-miss here parses, ships, projects, and
   * casts nothing at the table. The overlay's cross-bundle check now refuses an unresolvable
   * `spellId` at build time and offers the nearest shipped id, which is what makes "authored" mean
   * "will fire".
   *
   * NOT AUTHORED: **the 2- and 3-charge upcasts to level 4 and 5** - L1. One resolution spends one
   * charge, so a level-5 Fireball authored as a second cast would cost the same single charge as the
   * level-3 one and the wand would deal 10d6 seven times a day instead of 8d6.
   */
  "wand-of-fireballs": {
    casts: [{
      spellId: "fireball", saveDc: 15,
      uses: { limit: 7, per: "long-rest", pool: "wand-of-fireballs-charges" }
    }]
  },

  /** The Fireball wand's exact twin - "Lightning Bolt (save DC 15)", 1 charge, 7 charges. Upcasts: L1; no `atLevel`, as above. */
  "wand-of-lightning-bolts": {
    casts: [{
      spellId: "lightning-bolt", saveDc: 15,
      uses: { limit: 7, per: "long-rest", pool: "wand-of-lightning-bolts-charges" }
    }]
  },

  /** "This wand has 3 charges. While holding it, you can expend 1 charge to cast Detect Magic from it." Complete. */
  "wand-of-magic-detection": {
    casts: [{ spellId: "detect-magic", uses: { limit: 3, per: "long-rest", pool: "wand-of-magic-detection-charges" } }]
  },

  /*
   * `wand-of-magic-missiles` - "This wand has 7 charges. While holding it, you can expend no more
   * than 3 charges to cast Magic Missile from it. For 1 charge, you cast the level 1 version."
   *
   * NEEDS: a projectile count on the spell reference (L6). The lane authored the level-1 cast and the
   * salvage removes it, and this wand is the sharpest case in the file because THE SPELL IS THE WHOLE
   * ITEM - there is no second property to keep, so a wrong cast is the entire printed effect being
   * wrong. `magic-missile` is `{roll: "1d4 + 1", types: ["force"]}`, which is what ONE dart deals;
   * the SRD prints *"three glowing darts... A dart deals 1d4 + 1 Force damage"*. The cast rolls
   * ~3.5 against the spell's ~10.5, fires cleanly, prints a plausible number, and is a third of the
   * right one - the failure mode this salvage exists to end. UNBLOCKED BY: the known-bugs entry
   * **[content/spells] A spell's `damage` and `attackRoll` columns describe its TEXT, not what one
   * cast rolls**; `targetCount` exists on `castingOptions` rows and nothing reads it, so the model
   * is half there. **The 2- and 3-charge upcasts** are an absence on L1 besides. Prose.
   */

  /**
   * "expend 1 charge to cause a thin blue ray to streak from the tip toward a creature you can see
   * within 60 feet. The target must succeed on a DC 15 Constitution saving throw or have the Paralyzed
   * condition for 1 minute."
   *
   * The wand's own effect, not a spell, so it is an action: printed DC, 7-charge pool, and Paralyzed
   * read off the prose by `conditionFrom` - the word must stay.
   */
  "wand-of-paralysis": {
    actions: [{
      id: "paralyzing-ray", name: "Paralyzing Ray", activation: "action",
      description: "Expend 1 charge to send a thin blue ray toward a creature you can see within 60 feet. The target must succeed on a DC 15 Constitution saving throw or have the Paralyzed condition for 1 minute. At the end of each of its turns, it repeats the save, ending the effect on itself on a success.",
      save: { ability: "con", dc: 15 },
      uses: { limit: 7, per: "long-rest", pool: "wand-of-paralysis-charges" }
    }]
  },

  /** "expend 1 charge to cast Polymorph (save DC 15) from it." One charge, one spell, printed DC. Complete. */
  "wand-of-polymorph": {
    casts: [{ spellId: "polymorph", saveDc: 15, uses: { limit: 7, per: "long-rest", pool: "wand-of-polymorph-charges" } }]
  },

  /**
   * "This wand has 3 charges... you can take a Magic action to expend 1 charge, and if a secret door or
   * trap is within 60 feet of you, the wand pulses and points at the one nearest to you."
   */
  "wand-of-secrets": {
    actions: [{
      id: "find-secrets", name: "Find Secrets", activation: "action",
      description: "Expend 1 charge. If a secret door or trap is within 60 feet of you, the wand pulses and points at the one nearest to you.",
      uses: { limit: 3, per: "long-rest", pool: "wand-of-secrets-charges" }
    }]
  },

  /*
   * `wand-of-the-war-mage-1`, `wand-of-the-war-mage-2`, `wand-of-the-war-mage-3` - "While holding
   * this wand, you gain a bonus to spell attack rolls determined by the wand's rarity. In addition,
   * you ignore Half Cover when making a spell attack roll."
   *
   * THREE ROWS MINTED FROM ONE PRINTED ENTRY by C6's ladder expansion (+1 uncommon, +2 rare, +3 very
   * rare), so a count of rows flatters itself here: this is ONE record's absence, recorded three
   * times because the ids are three. All three ids are spelled OUT rather than as `-1`, `-2`, `-3`
   * suffixes, because C8 audits these records by matching item ids mechanically and a suffix
   * shorthand reads to that audit as two items with no absence recorded at all.
   *
   * NEEDS: `spell-attack-bonus`, which `CARRIER_RIDER_DISPOSITION` marks `"unread"` - it reaches
   * `derivation.spellAttackBonus` and no spell-attack path reads it. UNBLOCKED BY: **U26**. The
   * cover clause needs `attack-kind-is: "spell"`, UNBLOCKED BY: **U29**. These wands have NO other
   * property, so they are the purest carriers in the reserve: nothing else about them is authorable
   * and `applyItemMechanics` would refuse the rider if this comment were ignored. Prose.
   */

  /*
   * `wand-of-web` - "expend 1 charge to cast Web (save DC 13) from it."
   *
   * NEEDS: a cast-time damage model (L6). The lane authored this cast - the comment beside it read
   * "One charge, printed DC. Complete." - and the salvage removes it. `web` is
   * `{roll: "2d4", types: ["fire"]}`, and the SRD deals that damage only to a creature that starts
   * its turn in webs somebody has since SET ON FIRE: *"The webs are flammable. Any 5-foot Cube of
   * webs exposed to fire burns away in 1 round, dealing 2d4 Fire damage to any creature that starts
   * its turn in the fire."* The cast rolls it on every press, so a wand whose printed effect is a
   * Dexterity save against being Restrained instead sprays 2d4 Fire at unlit webbing. As with the
   * wand above, the spell is the entire item, so there is no sound half to keep. UNBLOCKED BY: the
   * known-bugs entry **[content/spells] A spell's `damage` and `attackRoll` columns describe its
   * TEXT, not what one cast rolls**. That is the whole entry - the wand prints nothing else. Prose.
   */

  /**
   * "expend 1 charge while choosing a point within 120 feet of yourself. That location becomes the
   * point of origin of a spell or other magical effect determined by rolling on the Wand of Wonder
   * Effects table. Spells cast from the wand have a save DC of 15."
   *
   * The d100 table is 20 outcomes of wildly different shapes and is GM-rolled by construction; what
   * this authors is the CHARGE, which the sheet shows, the resolver spends and the economy refuses at
   * zero. The table itself stays in the item's own description, where the GM reads it.
   */
  "wand-of-wonder": {
    actions: [{
      id: "wild-surge", name: "Wild Surge", activation: "action",
      description: "Expend 1 charge and choose a point within 120 feet of yourself. That location becomes the point of origin of a spell or other magical effect determined by rolling on the Wand of Wonder Effects table in this item's description. Spells cast from the wand have a save DC of 15, and any spell whose maximum range is normally less than 120 feet has a range of 120 feet when cast from the wand.",
      uses: { limit: 7, per: "long-rest", pool: "wand-of-wonder-charges" }
    }]
  }
};
