/**
 * Ranger mechanics - the GENERATED half of the overlay for this class and for Hunter.
 *
 * `build-class-bundle.ts` generates this class's prose from the SRD markdown on every run;
 * this overlay is merged on top of it.
 *
 * Stage 4 lane B2. Author here and nowhere else: this file is the only place a Ranger
 * rider, pick, or option mechanic belongs, so two authors working on two classes never touch one
 * file. See `./overlay.ts` for what a `FeatureMechanics` may carry and `./index.ts` for the merge.
 */
import type { ClassMechanicsModule } from "./overlay.js";

export const ranger: ClassMechanicsModule = {
  features: {
    /**
     * FAVORED ENEMY - audit row 32, and both halves are sayable.
     *
     * "You always have the Hunter's Mark spell prepared. You can cast it twice without expending a
     * spell slot ... The number of times increases as shown in the Favored Enemy column."
     *
     * `alwaysPrepared` is the SRD's own phrase and the builder honours it exactly: the spell is on
     * the sheet and does NOT count against the prepared budget. The free casts read the printed
     * column through `scaling: {type: "class-resource"}` - 2 at level 1 rising to 6 at level 17 -
     * so the number moves with the character instead of being re-typed as a `by-level` table beside
     * the table it copies. That is what takes `favored-enemy` off `display: true` and into
     * `liveResources`: the column is a pool the engine spends now.
     *
     * The feature authors no action of its own, so `interpretFeature` synthesises the rollable that
     * carries the pool - which is the whole point, since what a player tracks is the counter.
     */
    "favored-enemy": {
      uses: { scaling: { type: "class-resource", id: "favored-enemy" }, per: "long-rest" },
      grants: { spells: [{ id: "hunters-mark", level: 1, alwaysPrepared: true }] }
    },

    /**
     * DEFT EXPERTISE - the expertise half of audit row 61. The LANGUAGE half is not authorable.
     *
     * "Expertise. Choose one of your skill proficiencies with which you lack Expertise." One line,
     * and it is a SECOND expertise offer beside the level-9 one, told apart by `payload.featureId`
     * exactly as the Wizard's Scholar is.
     *
     * "Languages. You know two languages of your choice" is blocked by ruling C and not by anything
     * this file can fix: `resolveCatalogChoice` has no `languages` family, and
     * `extraPicks: [{offer: "species-languages", amount: 2}]` - the right shape - names a budget no
     * SRD build has, because no species or background declares `languageChoices`. Authoring it would
     * be a loud build rejection for every Ranger. Row 61 stays open; the prose carries the promise.
     *
     * `choices` (ruling B, several picks on one record) would be the shape if the language half were
     * reachable - and it is NOT reachable from here either: `FeatureMechanics` in `./overlay.ts`
     * exposes `choice` and not `choices`. Recorded so the next author does not rediscover it.
     */
    /**
     * DEFT EXPLORER - audit row 61, both halves.
     *
     * "You gain Expertise in one of your skill proficiencies, and you learn two languages of your
     * choice." The Expertise half was always one line. The languages half was blocked on ruling C
     * twice over - no `languages` catalog family, and no species declaring `languageChoices` for
     * `species-languages` to raise. Both are fixed, so the second half is now the one `extraPicks`
     * line the audit said it would be, and a level-2 Ranger is offered four languages, not two.
     */
    "deft-explorer": {
      choice: { kind: "expertise", choose: 1, fromCatalog: "skills" },
      extraPicks: [{ offer: "species-languages", amount: 2 }]
    },

    /**
     * EXTRA ATTACK - "You can attack twice instead of once whenever you take the Attack action."
     *
     * The builder raises every attack action's `attack.count`, so the number the sheet swings is 2.
     * The Fighter authors the identical rider; there was no reason for the Ranger's and the
     * Paladin's to be prose except that nobody had written them.
     */
    "extra-attack": {
      modifiers: [{ type: "extra-attack", count: 1 }]
    },

    /**
     * ROVING - "Your Speed increases by 10 feet while you aren't wearing Heavy armor."
     *
     * Authored flat, and that is a deliberate call rather than an oversight. The gate is unsayable
     * twice over: "not Heavy" is an OR across `while-armored: {weights: ["light", "medium"]}` and
     * `while-unarmored`, and `RiderWhenSchema` is an AND-list with no OR by design (ADR-0008) - and
     * even a correct gate would do nothing here, because `speed` is one of the eight riders the
     * builder BAKES at build time and the fold reads the amount without consulting `when`.
     * (`armor-class` is the one that has a gate the fold honours, via its own `whileArmored` flag.)
     *
     * Flat is right for every Ranger the builder can produce: the class is proficient with Light and
     * Medium armor and Shields only. A Ranger who straps on non-proficient Plate is a table
     * judgement, and the description says so.
     *
     * WHAT STAYS PROSE: the Climb and Swim Speeds. `speed` is the walking number and there is no
     * movement-mode vocabulary at all - the same gap `gift-of-the-depths` hits in the audit.
     */
    roving: {
      modifiers: [{ type: "speed", amount: 10 }]
    },

    /**
     * TIRELESS - a Magic action whose uses are an ABILITY MODIFIER, minimum one.
     *
     * `scaling: {type: "ability-modifier", ability: "wis", minimum: 1}` is the second of the four
     * ways `FeatureUsesSchema` scales, and it resolves against the character's FINAL Wisdom - so a
     * Ranger who raises Wisdom at level 8 gets the extra use without the record changing.
     *
     * WHAT STAYS PROSE: the 1d8 + Wisdom modifier of Temporary Hit Points. `ActionSchema` models
     * damage and has no healing or temp-HP field at all, so the roll would have to be authored as
     * damage - which is worse than prose, not better. The Exhaustion decrease on a Short Rest is a
     * rest hook with no vocabulary either.
     */
    tireless: {
      uses: { scaling: { type: "ability-modifier", ability: "wis", minimum: 1 }, per: "long-rest" },
      actions: [{
        id: "tireless",
        name: "Tireless",
        activation: "action",
        description: "As a Magic action, you give yourself Temporary Hit Points equal to 1d8 plus your Wisdom modifier (minimum of 1). Whenever you finish a Short Rest, your Exhaustion level, if any, also decreases by 1.",
        damage: []
      }]
    },

    /**
     * NATURE'S VEIL - the same ability-modifier pool, on a Bonus Action.
     *
     * WHAT STAYS PROSE: the Invisible condition itself. `EffectGrantSchema` carries modifiers and
     * tags, never a CONDITION - the builtin Hide action applies Invisible from a special case in the
     * resolver keyed on its own id, which is not a mechanism authored content can reach. The GM taps
     * the condition; what this record makes real is the activation and the counter.
     */
    "natures-veil": {
      uses: { scaling: { type: "ability-modifier", ability: "wis", minimum: 1 }, per: "long-rest" },
      actions: [{
        id: "natures-veil",
        name: "Nature's Veil",
        activation: "bonus-action",
        description: "You invoke spirits of nature to magically hide yourself, giving yourself the Invisible condition until the end of your next turn.",
        damage: []
      }]
    },

    /**
     * FERAL SENSES - "Blindsight with a range of 30 feet."
     *
     * DISPLAY-LEVEL, and knowingly so: `CARRIER_RIDER_DISPOSITION` in `character-build.ts` records
     * `sense` as `"display-only"` because no `ActorDefinition` field models senses yet - exactly like
     * `darkvision`, which nine shipped species traits author anyway. It reaches the sheet's rider
     * carriers and stops there. Authored because it is the correct record and it costs one line;
     * NOT counted as a mechanic that does anything at the table today.
     */
    "feral-senses": {
      modifiers: [{ type: "sense", sense: "blindsight", feet: 30 }]
    },

    /**
     * EPIC BOON - audit row 6, the Ranger's share.
     */
    "epic-boon": {
      choice: { kind: "feat", choose: 1, fromCatalog: "epic-boon-feats" }
    },

    /**
     * FIGHTING STYLE - the whole Fighting Style feat catalog **plus** one bespoke option.
     *
     * "Instead of choosing one of those feats, you can choose the option below." Both consumers used
     * to short-circuit on a non-empty `from` (which `options` derives), so a catalog and an inline
     * option could not be offered together and Druidic Warrior was simply unpickable. They are UNIONED
     * now, and this is the record that proves it.
     *
     * WHAT STAYS PROSE (ADR-0008): "whenever you gain a Ranger level, you can replace one of these
     * cantrips" is a REPLACEMENT clause, and nothing in the vocabulary edits a choice already made -
     * see the Stage-4 authoring assignments for the specification.
     */
    "fighting-style": {
      choice: {
        kind: "fighting-style", choose: 1, fromCatalog: "fighting-style-feats",
        options: [{
          id: "druidic-warrior",
          name: "Druidic Warrior",
          description: "You learn two Druid cantrips of your choice. Wisdom is your spellcasting ability for them. Whenever you gain a Ranger level, you can replace one of these cantrips with another Druid cantrip.",
          choice: { kind: "cantrip", choose: 2, fromCatalog: "druid-spells", maxSpellLevel: 0 }
        }]
      }
    }
  },
  subclasses: {
    hunter: {
      /**
       * HUNTER'S PREY - audit row 21, closed as a PICK. The two options' riders stay prose.
       *
       * The feature shipped with no `choice` at all, so a Hunter chose nothing and the sheet recorded
       * nothing. It is a real pick now: the ledger holds which option was taken and the chosen
       * option's text lands on the sheet as its own trait.
       *
       * NEITHER RIDER IS SAYABLE, and authoring one anyway would be authoring a stronger feature
       * than the SRD prints:
       *   - Colossus Slayer's extra 1d8 is gated on "if it's missing any of its Hit Points" and
       *     "only once per turn". `RiderWhenSchema` has no trigger that reads the TARGET's hit points
       *     (`while-hp-at-or-below` is a gate on the bearer), and a `FeatureModifier` has no
       *     once-per-turn pool - only an ACTION does. An ungated `extra-damage` would add 1d8 to
       *     every weapon hit, twice a turn from level 5. That is the Rage Damage call again.
       *   - Horde Breaker is an extra attack against a DIFFERENT creature. `extra-attack` raises
       *     `attack.count`, which lets both swings land on the same target, so it says something else.
       *
       * "Whenever you finish a Short or Long Rest, you can replace the chosen option" is a
       * replacement clause and stays prose under ruling A.
       */
      "hunters-prey": {
        choice: {
          kind: "hunters-prey", choose: 1,
          options: [
            {
              id: "colossus-slayer",
              name: "Colossus Slayer",
              description: "Your tenacity can wear down even the most resilient foes. When you hit a creature with a weapon, the weapon deals an extra 1d8 damage to the target if it's missing any of its Hit Points. You can deal this extra damage only once per turn."
            },
            {
              id: "horde-breaker",
              name: "Horde Breaker",
              description: "Once on each of your turns when you make an attack with a weapon, you can make another attack with the same weapon against a different creature that is within 5 feet of the original target, that is within the weapon's range, and that you haven't attacked this turn."
            }
          ]
        }
      },

      /**
       * DEFENSIVE TACTICS - audit row 22, closed as a PICK, for the same reason as row 21.
       *
       * Both options act on the ATTACKER's rolls rather than the bearer's. Escape the Horde is
       * `roll-mode` on `incoming-attack` filtered to Opportunity Attacks - and `attack-kind-is`
       * documents that `opportunity` "requires the resolver to ANNOUNCE the trigger; until it does
       * they never match", so authoring it would ship a rider that parses and never fires. Multiattack
       * Defense is a reactive effect placed on the attacker for the rest of the turn, which nothing
       * in the vocabulary can express at all.
       */
      "defensive-tactics": {
        choice: {
          kind: "defensive-tactics", choose: 1,
          options: [
            {
              id: "escape-the-horde",
              name: "Escape the Horde",
              description: "Opportunity Attacks have Disadvantage against you."
            },
            {
              id: "multiattack-defense",
              name: "Multiattack Defense",
              description: "When a creature hits you with an attack roll, that creature has Disadvantage on all other attack rolls against you this turn."
            }
          ]
        }
      }
    }
  },
  liveResources: ["favored-enemy"]
};
