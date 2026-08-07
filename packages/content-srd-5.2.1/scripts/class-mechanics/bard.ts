/**
 * Bard mechanics - the GENERATED half of the overlay for this class and for the College of Lore.
 *
 * `build-class-bundle.ts` generates this class's prose from the SRD markdown on every run;
 * this overlay is merged on top of it.
 *
 * Stage 4 lane B3. Author here and nowhere else: this file is the only place a Bard
 * rider, pick, or option mechanic belongs, so two authors working on two classes never touch one
 * file. See `./overlay.ts` for what a `FeatureMechanics` may carry and `./index.ts` for the merge.
 */
import type { ClassMechanicsModule } from "./overlay.js";

export const bard: ClassMechanicsModule = {
  features: {
    /**
     * BARDIC INSPIRATION - the counter the whole class is built around, and it was ink.
     *
     * "You can confer a Bardic Inspiration die a number of times equal to your Charisma modifier
     * (minimum of once)" is `ability-modifier` scaling, the second of `FeatureUsesSchema`'s four
     * ways - NOT the printed Bardic Die column, which prints D6/D8/D10/D12 and is the SIZE of the
     * die, not a count of uses. That column stays `display: true` deliberately: a `class-resource`
     * scaling pointed at it would read a dice string and resolve to 0 uses, which is the silent
     * failure the whole pools test exists to catch. (This is why `bardic-inspiration` is NOT in
     * `liveResources`: the id is shared by a live pool and an ink column that mean different things.)
     *
     * The action makes the pool spendable at the table - a Bonus Action that a GM and a player can
     * both see go down - and Cutting Words and Peerless Skill spend the very same key.
     *
     * WHAT STAYS PROSE: the die itself. Handing another creature a d6 they later add to a failed
     * D20 Test is a grant to a DIFFERENT actor with a one-hour window and a "roll it later" step,
     * and `EffectGrant.modifiers` has no "add this die to a d20 test" variant. Font of Inspiration
     * (level 5: recovery moves to a Short Rest) is likewise unsayable - `uses.per` names one rest
     * and has no level schedule - and Superior Inspiration is an initiative-time refill.
     */
    "bardic-inspiration": {
      tags: ["bardic-inspiration"],
      uses: { scaling: { type: "ability-modifier", ability: "cha", minimum: 1 }, per: "long-rest" },
      actions: [{
        id: "bardic-inspiration",
        name: "Bardic Inspiration",
        activation: "bonus-action",
        description: "As a Bonus Action, inspire another creature within 60 feet of yourself who can see or hear you. That creature gains one of your Bardic Inspiration dice, which it can roll and add to a failed D20 Test once within the next hour. A creature can have only one Bardic Inspiration die at a time. The die is a d6, becoming a d8 at level 5, a d10 at level 10 and a d12 at level 15.",
        damage: []
      }]
    },

    /**
     * EPIC BOON - audit row 6, the Bard's share of the nine classes that lost theirs outright.
     * Cleric, Fighter and Wizard already author exactly this and the catalog resolves.
     */
    "epic-boon": {
      choice: { kind: "feat", choose: 1, fromCatalog: "epic-boon-feats" }
    },

    /**
     * WORDS OF CREATION - audit row 34, one `grants.spells` line.
     *
     * "You therefore always have the _Power Word Heal_ and _Power Word Kill_ spells prepared."
     * `alwaysPrepared` is what "always have prepared" means here: both are on the sheet and neither
     * charges against the level-20 prepared count of 22.
     *
     * WHAT STAYS PROSE: targeting a second creature within 10 feet of the first. That is a change to
     * how a specific spell resolves, which lives in the spell, not in a feature rider.
     */
    "words-of-creation": {
      grants: {
        spells: [
          { id: "power-word-heal", level: 9, alwaysPrepared: true },
          { id: "power-word-kill", level: 9, alwaysPrepared: true }
        ]
      }
    }

    /**
     * NOT AUTHORED, and why - `magical-secrets` (audit row 55).
     *
     * The record is MIS-WIRED rather than empty: `build-class-bundle.ts`'s `CONFIG.choices` authors
     * it as `{kind: "spell", choose: 2, fromCatalog: "bard-spells"}`, which is both the wrong
     * mechanic and the wrong list. The real promise widens the SOURCE LIST of the class's existing
     * prepared-spell budget from level 10 on ("you can choose any of your new prepared spells from
     * the Bard, Cleric, Druid, and Wizard spell lists"), and nothing in the vocabulary edits an
     * existing budget's list.
     *
     * Blocked twice over, and neither is a content lane's to answer: `CONFIG` is frozen for Stage 4,
     * and the overlay REFUSES to overwrite a `choice` the record already carries - correctly, since
     * "which of the two homes is the real one" has no good silent answer.
     *
     * Also not authored: Jack of All Trades (half the proficiency bonus - `check-bonus` takes a flat
     * integer), Countercharm and Superior Inspiration (reaction-time and initiative-time rules text).
     */
  },

  subclasses: {
    "college-of-lore": {
      /**
       * BONUS PROFICIENCIES - audit row 19, and the cheapest row in the lane: three skills, from the
       * skills catalog, which `resolveCatalogChoice` already resolves. Before this a level-3 Lore
       * Bard was promised three proficiencies and offered none.
       */
      "bonus-proficiencies": {
        choice: { kind: "skill", choose: 3, fromCatalog: "skills" }
      },

      /**
       * CUTTING WORDS - a Reaction that spends the CLASS's Bardic Inspiration counter.
       *
       * `pool: "bardic-inspiration"` is load-bearing: the SRD spends one die, not a second resource,
       * so this action and Peerless Skill and Bardic Inspiration itself all decrement one key. The
       * scaling matches the class feature's for the same reason two actions sharing a key must agree
       * on how big it is.
       *
       * WHAT STAYS PROSE: subtracting the rolled die from someone else's roll. The die is granted to
       * a target in the class feature and there is no "subtract this die" modifier.
       */
      "cutting-words": {
        actions: [{
          id: "cutting-words",
          name: "Cutting Words",
          activation: "reaction",
          description: "When a creature you can see within 60 feet makes a damage roll or succeeds on an ability check or attack roll, take a Reaction to expend one use of your Bardic Inspiration; roll your Bardic Inspiration die and subtract the number rolled from the creature's roll, reducing the damage or potentially turning the success into a failure.",
          damage: []
        }],
        uses: { scaling: { type: "ability-modifier", ability: "cha", minimum: 1 }, per: "long-rest", pool: "bardic-inspiration" }
      },

      /**
       * PEERLESS SKILL - the same pool again, on the other side of the roll.
       *
       * WHAT STAYS PROSE: "on a failure, the Bardic Inspiration isn't expended". Conditional refunds
       * are not in the uses vocabulary, and the honest reading is that the die IS spent unless the
       * table rules otherwise - so the pool decrements and the description says when it comes back.
       */
      "peerless-skill": {
        actions: [{
          id: "peerless-skill",
          name: "Peerless Skill",
          activation: "other",
          description: "When you make an ability check or attack roll and fail, expend one use of Bardic Inspiration; roll the Bardic Inspiration die and add the number rolled to the d20, potentially turning a failure into a success. On a failure, the Bardic Inspiration isn't expended.",
          damage: []
        }],
        uses: { scaling: { type: "ability-modifier", ability: "cha", minimum: 1 }, per: "long-rest", pool: "bardic-inspiration" }
      }

      /**
       * NOT AUTHORED, and why - `magical-discoveries` (audit row 56).
       *
       * "two spells ... from the Cleric, Druid, or Wizard spell list or any combination thereof."
       * `fromCatalog` takes ONE slug, and the union that landed this wave is `from`/`options` PLUS
       * `fromCatalog` - a catalog and a bespoke option, not three catalogs. Saying it needs a
       * `SpellListReference` overlay (`basedOn: ["cleric", "druid", "wizard"]`), which exists but is
       * a homebrew-merge path an SRD bundle record cannot point at. Assignments doc S5C/S5D.
       */
    }
  }
};
