/**
 * Sorcerer mechanics - the GENERATED half of the overlay for this class and for Draconic Sorcery.
 *
 * `build-class-bundle.ts` generates this class's prose from the SRD markdown on every run;
 * this overlay is merged on top of it.
 *
 * Stage 4 lane B4. Author here and nowhere else: this file is the only place a Sorcerer
 * rider, pick, or option mechanic belongs, so two authors working on two classes never touch one
 * file. See `./overlay.ts` for what a `FeatureMechanics` may carry and `./index.ts` for the merge.
 *
 * ONE RULE GOVERNS EVERY SORCERY-POINT FEATURE BELOW, and it is the Monk's rule restated, because it
 * is the same schema doing the same thing. `ActionUsesSchema` COUNTS uses; it has no notion of a use
 * COSTING more than one. So a Metamagic option printed at "Cost: 1 Sorcery Point" rides the shared
 * `sorcery-points` pool and really debits it, and one printed at "Cost: 2 Sorcery Points" does NOT -
 * debiting one where the SRD charges two is wrong arithmetic, and wrong arithmetic on a counter a
 * player watches is worse than a sentence they read (ADR-0008). Eight of the ten cost 1; Heightened
 * Spell and Quickened Spell cost 2 and are named below with that as the reason.
 */
import type { ClassMechanicsModule } from "./overlay.js";

/**
 * "Cost: 1 Sorcery Point" - one debit off the shared pool, which is exactly one `uses`.
 *
 * `scaling: {type: "class-resource", id: "sorcery-points"}` reads the printed Sorcery Points column
 * at the character's own level rather than restating it as a `by-level` table beside the table it
 * would be copying, and `pool: "sorcery-points"` is what makes Font of Magic and every option below
 * share ONE counter - the same mechanism Monk's Focus uses for Focus Points.
 */
const ONE_SORCERY_POINT = {
  uses: { scaling: { type: "class-resource" as const, id: "sorcery-points" }, per: "long-rest" as const, pool: "sorcery-points" }
};

/** The five damage types Elemental Affinity prints, with the prose each option carries on the sheet. */
const AFFINITY_TYPES: ReadonlyArray<readonly [id: string, name: string]> = [
  ["acid", "Acid"], ["cold", "Cold"], ["fire", "Fire"], ["lightning", "Lightning"], ["poison", "Poison"]
];

export const sorcerer: ClassMechanicsModule = {
  features: {
    /**
     * The sheet's spellcasting grouping slug, exactly as hand-authored Cleric and Wizard tag theirs
     * and as `warlock.ts` tags Pact Magic.
     *
     * SAID PLAINLY, because this file's own bar demands it: this is the ONE rider here with no
     * far-end proof, and it cannot have one. No consumer reads a class feature's `tags` today -
     * `interpretFeature` never looks at the field, and `optionAsFeature` only carries it through - so
     * blanking it fails no test. It is authored for consistency with the four records that already
     * carry it, not because it does something, and it is named in the lane report as such.
     */
    spellcasting: { tags: ["spellcasting"] },
    /**
     * INNATE SORCERY - "As a Bonus Action, you can unleash that magic for 1 minute ... You can use
     * this feature twice, and you regain all expended uses when you finish a Long Rest."
     *
     * A hand-written action rather than the synthesised one, because the synthesised activation is
     * always `"other"` and this feature prints a Bonus Action. The grant is a 1-minute timer, which is
     * ten rounds exactly, and `tags: ["innate-sorcery"]` is what "while your Innate Sorcery feature is
     * active" reads at the table - Sorcery Incarnate and Arcane Apotheosis are both written against
     * that state, and `while-effect-tag` is the gate a later rider would use to see it.
     *
     * WHAT THE EFFECT DELIBERATELY DOES NOT CARRY, and this is the load-bearing absence:
     *
     *   - **The +1 spell save DC.** `EffectModifierSchema` has no `spell-save-dc` member. The
     *     FEATURE vocabulary does, but a feature modifier is a standing rider - it would raise the DC
     *     for the whole day rather than for the minute the feature runs.
     *   - **Advantage on the attack rolls of Sorcerer spells.** An effect's modifiers are normalised
     *     through `toRollModes`, which returns `{roll, mode}` and DROPS the `when` list, so a
     *     `roll-mode` gated on `attack-kind-is: ["spell"]` inside an effect would be read as
     *     advantage on every attack roll the Sorcerer makes - a dagger swing included. (The gate
     *     could not have worked anyway: `attackKindsOf` derives melee/ranged/thrown/unarmed/reaction
     *     and nothing in the codebase ever announces `"spell"`, so the filter fails closed.) One
     *     wrong advantage on every weapon attack is far worse than the sentence the description
     *     already carries.
     */
    "innate-sorcery": {
      uses: { limit: 2, per: "long-rest" },
      actions: [{
        id: "innate-sorcery",
        name: "Innate Sorcery",
        activation: "bonus-action",
        description: "You unleash your innate magic for 1 minute. For the duration, the spell save DC of your Sorcerer spells increases by 1 and you have Advantage on the attack rolls of Sorcerer spells you cast.",
        damage: [],
        grants: {
          name: "Innate Sorcery",
          tags: ["innate-sorcery"],
          duration: { type: "rounds", rounds: 10 }
        }
      }]
    },
    /**
     * FONT OF MAGIC - the printed Sorcery Points column, wired to a pool the engine really spends.
     *
     * Before this the column was ink: a level-20 Sorcerer's sheet said "20 Sorcery Points" and
     * nothing anywhere could spend one. Naming the column in `liveResources` drops its
     * `display: true`, at which point `class-resource-pools.test.ts` stops accepting the annotation
     * and starts REQUIRING this pool.
     *
     * The feature has no printed activation of its own, so it takes the synthesised one - a button
     * that debits a point, which is what "you can use your Sorcery Points to fuel the options below"
     * needs at the table.
     *
     * WHAT STAYS PROSE: both conversions. **Converting a spell slot to Sorcery Points** writes
     * another pool's counter, which no rider can say (`resource-bonus` is a standing MAXIMUM, not a
     * refund). **Creating a spell slot** is the same in the other direction, and it is priced 2-7
     * points against a counter that only counts to one per use. The Creating Spell Slots table is now
     * rendered in full in the description, which is where a GM reads it.
     */
    "font-of-magic": {
      uses: { scaling: { type: "class-resource", id: "sorcery-points" }, per: "long-rest", pool: "sorcery-points" }
    },
    /**
     * METAMAGIC - ten printed options, and until now not one of them cost anything.
     *
     * Every option is "spend N Sorcery Points to modify a spell you are casting". WHAT the
     * modification does is unsayable in this vocabulary in all ten cases - it edits a spell's range,
     * its duration, its components, its damage type, its saving throws, or a die already rolled, and
     * none of those is a field on any record. But the PRICE is sayable, and the price is the half a
     * player and a GM actually have to track: eight of the ten cost exactly one Sorcery Point, so
     * each of those eight is one debit off the shared `sorcery-points` pool, landing on the sheet as
     * a button whose counter goes down.
     *
     * That is the whole difference between "Metamagic is a paragraph" and "Metamagic is spendable".
     * A chosen option is interpreted by the same `interpretFeature` a class feature goes through
     * (`optionAsFeature`), so its `uses` synthesise an activation exactly as Gift of the Depths' do.
     *
     * HEIGHTENED SPELL AND QUICKENED SPELL ARE NOT HERE, and that is the file header's rule: both
     * print "Cost: 2 Sorcery Points", `ActionUsesSchema` counts uses rather than costs, and a button
     * that takes one point where the book takes two is wrong arithmetic on a counter the player is
     * watching. They keep their prose, and the pool they spend from is on the same sheet.
     *
     * The pick itself needs nothing: the ETL already authors `choose: 2`, and the 2 -> 4 -> 6 growth
     * has no printed Metamagic column to read - the SRD prints "you learn two more" at levels 10 and
     * 17 as feature text, which `grantedAtLevels x choose` already handles.
     */
    metamagic: {
      options: {
        "careful-spell": ONE_SORCERY_POINT,
        "distant-spell": ONE_SORCERY_POINT,
        "empowered-spell": ONE_SORCERY_POINT,
        "extended-spell": ONE_SORCERY_POINT,
        "seeking-spell": ONE_SORCERY_POINT,
        "subtle-spell": ONE_SORCERY_POINT,
        "transmuted-spell": ONE_SORCERY_POINT,
        "twinned-spell": ONE_SORCERY_POINT
      }
    },
    /**
     * SORCEROUS RESTORATION - "Once you use this feature, you can't do so again until you finish a
     * Long Rest."
     *
     * `uses` with no `actions` mints the synthesised activation the builder already makes for Action
     * Surge and Arcane Recovery, so the once-a-day permission is a pool the engine really spends.
     * HOW MANY points it returns ("no more than half your Sorcerer level, round down") is not
     * authored: nothing in the vocabulary refills another pool, exactly as Magical Cunning's slots
     * are not authored on the Warlock.
     */
    "sorcerous-restoration": { uses: { limit: 1, per: "long-rest" } },
    /**
     * EPIC BOON - audit row 6, the Sorcerer's. Cleric, Fighter and Wizard have always authored this
     * exact line; the nine generated classes lost their level-19 feature outright.
     */
    "epic-boon": { choice: { kind: "feat", choose: 1, fromCatalog: "epic-boon-feats" } }
    /*
     * WHAT ELSE STAYS PROSE ON THE CLASS, named so the absences read as decisions:
     *
     *   sorcery-incarnate (L7)   - two clauses, neither sayable. "Spend 2 Sorcery Points to use
     *                              Innate Sorcery with no uses left" is a SUBSTITUTE cost on another
     *                              feature's pool, and "two Metamagic options on each spell" raises a
     *                              per-casting limit that is not modelled at all.
     *   arcane-apotheosis (L20)  - "one Metamagic option on each of your turns without spending
     *                              Sorcery Points": a conditional waiver of a cost, gated on an
     *                              active effect. `uses` has one counter and one `per`, and there is
     *                              no rider that makes another feature free.
     *   spellcasting's replacement clauses - Stage-4 ruling A. "Whenever you gain a Sorcerer level,
     *                              you can replace one of your cantrips" edits a `character.choices[]`
     *                              ledger row and has no vocabulary; author the base pick, leave the
     *                              clause printed.
     */
  },
  subclasses: {
    "draconic-sorcery": {
      /**
       * "While you aren't wearing armor, your base Armor Class equals 10 plus your Dexterity and
       * Charisma modifiers" - the `unarmored-defense` variant, spelled with the ability the SRD prints.
       *
       * This is also the worked example that proves the SUBCLASS half of the overlay reaches the
       * bundle: Draconic Sorcery is ETL-generated, so before the ETL imported `SUBCLASS_MECHANICS`
       * there was no way for this rider to exist at all.
       *
       * WHAT STAYS PROSE, deliberately (ADR-0008): the Hit Point half ("+3, and +1 whenever you gain
       * another Sorcerer level") is a level-3 lump plus a per-level step, and `hit-points-per-level`
       * has no lump. Authoring `amount: 1` would be wrong for every level below 3 and short by 2
       * above it, so the description carries it instead of the record carrying it incorrectly.
       */
      "draconic-resilience": {
        modifiers: [{ type: "unarmored-defense", ability: "cha" }]
      },
      /**
       * DRACONIC SPELLS - audit row 26, and the SRD prints it as ONE feature holding a four-tier
       * table (level 3, 5, 7 and 9).
       *
       * Only the level-3 tier is authored, for the reason Fiend Spells is authored the same way:
       * `grants.spells` has no character-level gate, and the overlay can only merge riders onto
       * features the ETL emits - it cannot split one printed feature into the four staged records
       * Life Domain uses (`life-domain-spells-5/7/9`), because those live in the hand-authored bundle
       * and `STAGED_FEATURES` is in the frozen ETL. Granting all ten here would hand a level-3
       * Sorcerer Summon Dragon and Legend Lore, which is worse than the table the description now
       * carries in full.
       *
       * `alwaysPrepared` is the schema default and it is the load-bearing half: these four do not eat
       * one of the Sorcerer's prepared slots, which is exactly what the SRD says. Command is not on
       * the Sorcerer spell list at all, so the grant is the only route to it.
       */
      "draconic-spells": {
        grants: {
          spells: [
            { id: "alter-self", level: 2 }, { id: "chromatic-orb", level: 1 },
            { id: "command", level: 1 }, { id: "dragons-breath", level: 2 }
          ]
        }
      },
      /**
       * ELEMENTAL AFFINITY - audit row 23, both halves.
       *
       * "Choose one of those types: Acid, Cold, Fire, Lightning, or Poison. You have Resistance to
       * that damage type, and when you cast a spell that deals damage of that type, you can add your
       * Charisma modifier to one damage roll of that spell." Divine-Order-shaped: five inline
       * options, each carrying the resistance AND the damage rider for its own type, so the sheet
       * resists exactly the type the player picked and nothing else.
       *
       * `abilityModifier: "cha"` is the same pair of fields Agonizing Blast uses: the amount is a
       * property of the CHARACTER, so no authored constant is right, and `extra-damage` rolls as its
       * own typed entry - one addition per resolve, which is the printed "one damage roll of that
       * spell".
       *
       * THE GATE IS `damage-type-is` AND NOT "a spell", and that is a knowing choice with a known
       * edge. Nothing in the engine ever announces `attack-kind-is: ["spell"]` - `attackKindsOf`
       * derives melee, ranged, thrown, unarmed and reaction, and no producer sets "spell" - so a
       * spell filter would fail closed and this rider would ship inert, which is the exact failure
       * `2e` is the name for.
       *
       * WHERE IT REACHES, stated exactly, because the code is the truth here and a comment that
       * claimed more would be the defect: `action-resolution.ts` populates `damageTypes` on the
       * RiderContext only for an action with an `attack` block against a single target. So this
       * fires for an attack-roll spell (Fire Bolt, Chromatic Orb) and NOT for a save-only one
       * (Fireball, Burning Hands), whose resolve carries no damage types to filter on. That is
       * under-application, which is the safe direction, and the test pins the boundary so the day
       * that context is widened someone sees this record light up rather than discovering it by
       * accident. The alternative - no rider at all - reaches nothing.
       *
       * Over-applying to a hypothetical Flame Tongue is the remaining error and it is the smaller
       * one by a wide margin: the class's own starting kit is a spear and a dagger, both Piercing,
       * and the addition is visible on the roll card, which an inert rider never is.
       */
      "elemental-affinity": {
        choice: {
          kind: "damage-type",
          choose: 1,
          options: AFFINITY_TYPES.map(([id, name]) => ({
            id,
            name,
            description: `You have Resistance to ${name} damage, and when you cast a spell that deals ${name} damage you can add your Charisma modifier to one damage roll of that spell.`,
            grants: { damageResistances: [id] },
            modifiers: [{
              type: "extra-damage" as const,
              abilityModifier: "cha" as const,
              damageType: id,
              when: [{ type: "on-damage-roll" as const }, { type: "damage-type-is" as const, damageTypes: [id] }]
            }]
          }))
        }
      },
      /**
       * DRAGON WINGS - "As a Bonus Action, you can cause draconic wings to appear ... Once you use
       * this feature, you can't use it again until you finish a Long Rest."
       *
       * A hand-written action for the Bonus Action, since the synthesised activation is always
       * `"other"`. WHAT STAYS PROSE: the Fly Speed of 60 feet (`speed` is one number and there is no
       * per-movement-mode vocabulary - the same absence Gift of the Depths' Swim Speed hits), the
       * 1-hour duration (a timer measured in hours, not rounds, on a feature nobody tracks in
       * initiative), and the "unless you spend 3 Sorcery Points to restore your use of it" clause,
       * which is a refill of this pool from another and has no rider.
       */
      "dragon-wings": {
        uses: { limit: 1, per: "long-rest" },
        actions: [{
          id: "dragon-wings",
          name: "Dragon Wings",
          activation: "bonus-action",
          description: "Draconic wings appear on your back for 1 hour or until you dismiss them (no action required). For the duration you have a Fly Speed of 60 feet. You regain the use on a Long Rest, or by spending 3 Sorcery Points.",
          damage: []
        }]
      },
      /**
       * DRAGON COMPANION - "You can also cast [Summon Dragon] once without a spell slot, and you
       * regain the ability to cast it in this way when you finish a Long Rest."
       *
       * The grant is the interesting half: Summon Dragon is the level-9 tier of the Draconic Spells
       * table, which is not authored (see above), and no Sorcerer could otherwise have it prepared -
       * so this feature is the only route to it, exactly as the book intends at level 18. The counter
       * is the free casting.
       *
       * WHAT STAYS PROSE: the dropped Material component and the "modify it so it doesn't require
       * Concentration, and the duration becomes 1 minute" clause. Both edit one spell's own printed
       * entry, and a spell grant names an id and a level, not an override of the record.
       */
      "dragon-companion": {
        grants: { spells: [{ id: "summon-dragon", level: 5 }] },
        uses: { limit: 1, per: "long-rest" }
      }
    }
  },
  /**
   * The printed Sorcery Points column is now a pool the engine spends, so it loses its `display: true`
   * annotation and `class-resource-pools.test.ts` starts requiring the binding. Font of Magic opens
   * it and the eight one-point Metamagic options draw on it.
   */
  liveResources: ["sorcery-points"]
};
