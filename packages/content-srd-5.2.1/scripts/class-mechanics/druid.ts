/**
 * Druid mechanics - the GENERATED half of the overlay for this class and for Circle of the Land.
 *
 * `build-class-bundle.ts` generates this class's prose from the SRD markdown on every run;
 * this overlay is merged on top of it.
 *
 * Stage 4 lane B3. Author here and nowhere else: this file is the only place a Druid
 * rider, pick, or option mechanic belongs, so two authors working on two classes never touch one
 * file. See `./overlay.ts` for what a `FeatureMechanics` may carry and `./index.ts` for the merge.
 */
import type { ClassMechanicsModule } from "./overlay.js";

export const druid: ClassMechanicsModule = {
  features: {
    /**
     * DRUIDIC - a language AND an always-prepared spell, which is the whole of audit row 35.
     *
     * "You know Druidic, the secret language of Druids ... you always have the _Speak with Animals_
     * spell prepared." Both halves are plain grants: `languages` puts Druidic on the sheet's
     * proficiency block, and an `alwaysPrepared` spell does not charge against the prepared count,
     * which is exactly what the SRD means by "always have prepared".
     *
     * There is no language PICK here - Druidic is handed over, not chosen. (The blocked language
     * picks in the audit are Ranger's Deft Explorer and Rogue's Thieves' Cant, rows 61-62.)
     *
     * WHAT STAYS PROSE: the DC 15 Investigation check to spot a hidden Druidic message is a check a
     * GM calls for, not a rider.
     */
    druidic: {
      grants: {
        languages: ["druidic"],
        spells: [{ id: "speak-with-animals", level: 1, alwaysPrepared: true }]
      }
    },

    /**
     * PRIMAL ORDER - the exact twin of Cleric's Divine Order, and the record the pre-Stage-4 audit
     * called "the single closest twin of the reported bug" (row 4). It shipped with no `choice` at
     * all, so neither role could be taken and neither role's mechanics existed.
     *
     * Magician is Thaumaturge with `druid` in place of `cleric`: one extra cantrip, expressed as a
     * BUDGET the player still gets to spend rather than a granted outcome. Warden is Protector with
     * Medium armor instead of Heavy.
     *
     * WHAT STAYS PROSE, on both roles and for the same reason Thaumaturge's does: "a bonus to your
     * Intelligence (Arcana or Nature) checks ... equal to your Wisdom modifier (minimum of +1)" is
     * an ability-derived check bonus with a floor, and `check-bonus` takes a flat integer.
     */
    "primal-order": {
      choice: {
        kind: "primal-order",
        choose: 1,
        options: [
          {
            id: "magician",
            name: "Magician",
            description: "You know one extra cantrip from the Druid spell list. In addition, your mystical connection to nature gives you a bonus to your Intelligence (Arcana or Nature) checks. The bonus equals your Wisdom modifier (minimum bonus of +1).",
            extraPicks: [{ offer: "class-cantrips", amount: 1 }]
          },
          {
            id: "warden",
            name: "Warden",
            description: "Trained for battle, you gain proficiency with Martial weapons and training with Medium armor.",
            grants: { weapons: ["martial"], armor: ["medium"] }
          }
        ]
      }
    },

    /**
     * WILD SHAPE - the POOL, and deliberately only the pool (audit row 54).
     *
     * The printed Wild Shape column is the number of uses (2 -> 3 at level 6 -> 4 at level 17), so
     * `class-resource` reads it rather than a `by-level` table copying the table beside it. Naming
     * the column in `liveResources` drops its `display: true`, at which point
     * `class-resource-pools.test.ts` stops accepting the annotation and starts requiring this pool.
     *
     * WHAT STAYS PROSE, by the Stage-4 ruling (assignments doc S5C) and by `BUILD_PLAN`'s own note:
     * the four known Beast forms. That needs a creature catalog family, a Challenge-Rating ceiling
     * and a "lacks a Fly Speed" predicate - three pieces of vocabulary that do not exist - and both
     * the count and the CR scale by level. The Temporary Hit Points equal to Druid level have no
     * rider either (nothing in the vocabulary grants temp HP), and "replace one of your known forms
     * whenever you finish a Long Rest" is a replacement clause (S5A).
     *
     * The SHORT-rest half of the recovery is prose for the same reason Cleric's Channel Divinity
     * leaves it prose: `FeatureUses.per` names one rest, and losing the long-rest refill to model
     * the partial short-rest one would be the worse trade.
     */
    "wild-shape": {
      uses: { scaling: { type: "class-resource", id: "wild-shape" }, per: "long-rest" },
      actions: [{
        id: "wild-shape",
        name: "Wild Shape",
        activation: "bonus-action",
        description: "Shape-shift into a Beast form you have learned for this feature. You stay in that form for a number of hours equal to half your Druid level or until you use Wild Shape again, have the Incapacitated condition, or die. You can leave the form early as a Bonus Action, and you gain Temporary Hit Points equal to your Druid level when you assume a form.",
        damage: []
      }]
    },

    /**
     * WILD COMPANION - Find Familiar, cast by spending a slot or a use of Wild Shape.
     *
     * `alwaysPrepared` is the right half of the promise: the spell is on the sheet and does not
     * charge against the prepared count. WHAT STAYS PROSE is the alternative cost (a Wild Shape use
     * instead of a slot) and the Fey-familiar-until-Long-Rest clause - `ActionSchema.spellSlot`
     * spends a slot from an ACTION, and there is no vocabulary for "either this pool or a slot".
     */
    "wild-companion": {
      grants: { spells: [{ id: "find-familiar", level: 1, alwaysPrepared: true }] }
    },

    /**
     * ELEMENTAL FURY - twin of Cleric's Blessed Strikes (audit row 5), which is authored and shipped;
     * this one had no `choice` at all, so a level-7 Druid was offered neither option.
     *
     * Primal Strike is Divine Strike's shape exactly, including the level-15 step: `damageByLevel`
     * carries the growth that Improved Elemental Fury prints, so the DAMAGE half of row 64 lands
     * here rather than needing a rider conditioned on the earlier answer. `uses` is the once-per-turn
     * cap, on its own pool, which is what makes "once on each of your turns" a refusal at the table
     * rather than a sentence.
     *
     * WHAT STAYS PROSE: Potent Spellcasting (adding an ability modifier to every Druid cantrip's
     * damage is not a rider any carrier can express), and Improved Elemental Fury's Potent
     * Spellcasting half (+300 feet of range on a cantrip). Row 64 therefore stays open for its
     * Potent Spellcasting half, exactly as Cleric's row 63 does - see assignments doc S5F.
     */
    "elemental-fury": {
      choice: {
        kind: "elemental-fury",
        choose: 1,
        options: [
          {
            id: "potent-spellcasting",
            name: "Potent Spellcasting",
            description: "Add your Wisdom modifier to the damage you deal with any Druid cantrip. When Improved Elemental Fury takes effect at Druid level 15, a Druid cantrip with a range of 10 feet or greater has its range increased by 300 feet."
          },
          {
            id: "primal-strike",
            name: "Primal Strike",
            description: "Once on each of your turns when you hit a creature with an attack roll using a weapon or a Beast form's attack in Wild Shape, you can cause the target to take an extra 1d8 Cold, Fire, Lightning, or Thunder damage (choose when you hit). The extra damage increases to 2d8 when Improved Elemental Fury takes effect at Druid level 15.",
            actions: [{
              id: "primal-strike",
              name: "Primal Strike",
              activation: "other",
              description: "Once on each of your turns, when you hit a creature with an attack roll using a weapon or a Beast form's attack, add this damage to that hit. The printed damage is Cold, Fire, Lightning or Thunder, your choice each time; the rollable below is recorded as Lightning.",
              damage: [{ formula: "1d8", type: "lightning" }],
              damageByLevel: [
                { level: 7, formula: "1d8", type: "lightning" },
                { level: 15, formula: "2d8", type: "lightning" }
              ]
            }],
            uses: { limit: 1, per: "turn", pool: "primal-strike" }
          }
        ]
      }
    },

    /**
     * EPIC BOON - audit row 6, the Druid's share of the nine classes that lost theirs outright.
     * Cleric, Fighter and Wizard already author exactly this and the catalog resolves (7 epic-boon
     * feats ship), so the level-19 feature that did nothing now offers the feat its text promises.
     */
    "epic-boon": {
      choice: { kind: "feat", choose: 1, fromCatalog: "epic-boon-feats" }
    }

    /**
     * NOT AUTHORED, and why - the four that are all the same missing idea.
     *
     * `wild-resurgence` (5), `archdruid` (20) and Circle of the Land's `natural-recovery` (6) all
     * CONVERT one resource into another: a spell slot into a Wild Shape use, Wild Shape uses into a
     * slot ("each use contributing 2 spell levels"), expended slots back on a Short Rest. Nothing in
     * the vocabulary spends one pool to refill another, and `uses` cannot even say which of Natural
     * Recovery's TWO independent once-per-Long-Rest benefits a single counter would be tracking -
     * one counter for two would make using either block the other, which is worse than prose.
     *
     * `beast-spells` (18) is a permission ("you can cast spells in Beast form"), not a rider.
     */
  },

  subclasses: {
    "circle-of-the-land": {
      /**
       * LAND'S AID - a real rollable that SPENDS the Wild Shape pool.
       *
       * `pool: "wild-shape"` is the point: "expend a use of your Wild Shape" is not a second counter,
       * it is the same one, so the same key the Wild Shape action spends is the key this one spends
       * and a Druid who has used all of them is refused both. The scaling matches Wild Shape's for
       * the same reason - two actions sharing a key must agree on how big it is.
       *
       * The damage grows on the printed schedule (2d6 -> 3d6 at 10 -> 4d6 at 14). WHAT STAYS PROSE:
       * the healing half - `FeatureActionSchema` has no healing formula, so the 2d6 restored to one
       * creature is in the description, exactly as Channel Divinity's healing branch is.
       */
      "lands-aid": {
        actions: [{
          id: "lands-aid",
          name: "Land's Aid",
          activation: "action",
          description: "As a Magic action, expend a use of your Wild Shape and choose a point within 60 feet. Each creature of your choice in a 10-foot-radius Sphere centered there makes a Constitution saving throw, taking the damage below on a failure and half as much on a success. One creature of your choice in that area regains the same amount in Hit Points. The damage and healing increase at Druid levels 10 and 14.",
          save: { ability: "con", dc: "spellcasting" },
          damage: [{ formula: "2d6", type: "necrotic" }],
          damageByLevel: [
            { level: 3, formula: "2d6", type: "necrotic" },
            { level: 10, formula: "3d6", type: "necrotic" },
            { level: 14, formula: "4d6", type: "necrotic" }
          ]
        }],
        uses: { scaling: { type: "class-resource", id: "wild-shape" }, per: "long-rest", pool: "wild-shape" }
      },

      /**
       * NATURE'S WARD - the half of audit row 65 that is authorable at all.
       *
       * "You are immune to the Poisoned condition" is a flat grant and is authored. The other half -
       * "Resistance to a damage type associated with your CURRENT land choice" - is a rider read back
       * off an earlier answer, which is assignments doc S5F: SPECIFIED, NOT BUILT. It stays prose
       * rather than being authored as a second pick, because the land is re-chosen on every Long Rest
       * and a build-time pick would freeze it (S5A).
       */
      "natures-ward": {
        grants: { conditionImmunities: ["poisoned"] }
      },

      /**
       * NATURE'S SANCTUARY - the third feature that spends the Wild Shape counter, and the reason
       * the shared `pool` matters rather than being tidy: a Druid who has shaped twice cannot also
       * raise the sanctuary, and only one key can say so.
       *
       * WHAT STAYS PROSE: the 15-foot Cube, Half Cover, moving the Cube as a Bonus Action, and
       * "your allies gain the current Resistance of your Nature's Ward" - which is the same
       * choice read-back that leaves the resistance half of row 65 prose in the first place.
       */
      "natures-sanctuary": {
        actions: [{
          id: "natures-sanctuary",
          name: "Nature's Sanctuary",
          activation: "action",
          description: "As a Magic action, expend a use of your Wild Shape to make spectral trees and vines appear in a 15-foot Cube on the ground within 120 feet of yourself. They last 1 minute or until you have the Incapacitated condition or die. You and your allies have Half Cover while in that area, and your allies gain the current Resistance of your Nature's Ward there. As a Bonus Action you can move the Cube up to 60 feet to ground within 120 feet of yourself.",
          damage: []
        }],
        uses: { scaling: { type: "class-resource", id: "wild-shape" }, per: "long-rest", pool: "wild-shape" }
      }

      /**
       * NOT AUTHORED, and why - `circle-of-the-land-spells` (audit rows 29 and 65's parent).
       *
       * The four land tables are four spell sets tiered by Druid level (3/5/7/9). Life Domain says
       * that shape as FOUR features, one per tier, each with its own `grants.spells` - and it can,
       * because Cleric is HAND_AUTHORED and its bundle record holds all four. Circle of the Land is
       * ETL-generated from ONE `#### Level 3` heading, and the overlay may only merge onto features
       * the ETL emits: it cannot add the three tier features, and one record's `grants.spells` has
       * no per-character-level gate, so authoring it would hand a level-3 Druid the level-9 spell.
       *
       * On top of that the land is re-chosen "whenever you finish a Long Rest" (S5A). Both halves
       * would have to land together, so row 29 stays prose and stays open. The prose is complete -
       * this wave restored the four tables into the description (273 -> 816 characters).
       */
    }
  },

  /**
   * The Wild Shape column stops being ink: a live pool answers to it now, spent by Wild Shape itself
   * and by Land's Aid.
   */
  liveResources: ["wild-shape"]
};
