/**
 * Warlock mechanics - the GENERATED half of the overlay for this class and for Fiend Patron.
 *
 * `build-class-bundle.ts` generates this class's prose from the SRD markdown on every run;
 * this overlay is merged on top of it.
 *
 * Stage 4 lane B4. Author here and nowhere else: this file is the only place a Warlock
 * rider, pick, or option mechanic belongs, so two authors working on two classes never touch one
 * file. See `./overlay.ts` for what a `FeatureMechanics` may carry and `./index.ts` for the merge.
 *
 * WHAT STAYS PROSE ACROSS THIS WHOLE FILE, and why - so the absences read as decisions:
 *
 *   - **"Whenever you gain a Warlock level, you can replace…"** (invocations, cantrips, prepared
 *     spells, arcanum spells). Stage-4 ruling A: replacement edits a `character.choices[]` ledger
 *     row and has no vocabulary. Author the base pick, leave the clause printed.
 *   - **"choose one of your known Warlock cantrips"** (Agonizing Blast, Eldritch Spear, Repelling
 *     Blast). Ruling E: a pick whose option list is the character's OWN prior answers needs
 *     `fromPicks`, which is specified and not built.
 *   - **The pact weapon as a scope.** Thirsting Blade, Devouring Blade, Eldritch Smite and
 *     Lifedrinker all read "with your pact weapon", and the trigger vocabulary has no way to name
 *     one conjured weapon. Authoring them unscoped would hand a Warlock an Extra Attack with a
 *     longbow, which is worse than the prose.
 *   - **Senses.** `CARRIER_RIDER_DISPOSITION` marks `sense` and `darkvision` display-only - no
 *     definition field models senses - so Devil's Sight and Witch Sight would ship inert riders on
 *     top of prose that already says the same thing.
 */
import type { ClassMechanicsModule } from "./overlay.js";

/** Every SRD damage type Fiendish Resilience may name: the printed twelve, less Force. */
const RESILIENCE_TYPES: ReadonlyArray<readonly [id: string, name: string]> = [
  ["acid", "Acid"], ["bludgeoning", "Bludgeoning"], ["cold", "Cold"], ["fire", "Fire"],
  ["lightning", "Lightning"], ["necrotic", "Necrotic"], ["piercing", "Piercing"], ["poison", "Poison"],
  ["psychic", "Psychic"], ["radiant", "Radiant"], ["slashing", "Slashing"], ["thunder", "Thunder"]
];

export const warlock: ClassMechanicsModule = {
  features: {
    /**
     * ELDRITCH INVOCATIONS, as many as the printed column says.
     *
     * "You gain more invocations of your choice at higher Warlock levels, as shown in the
     * Invocations column of the Warlock Features table." The column runs 1 -> 10 (L1 1, L2 3, L5 5,
     * L7 6, L9 7, L12 8, L15 9, L18 10), and a level-20 Warlock was offered ONE.
     *
     * Repeat grants cannot say this twice over: the column steps by +2 at levels 2 and 5, a level
     * row may list a feature only once, and the SRD prints NO feature heading at L2/L5/L7/L9/L12/
     * L15/L18 to carry a grant at all. `class-resource-growth` needs no carrier - the feature
     * granted at level 1 reads the column at the character's own level, and `choose: 1` plus the
     * growth is the printed number at every one of the twenty rows.
     */
    "eldritch-invocations": {
      extraPicks: [{ offer: "feature:eldritch-invocations", scaling: { type: "class-resource-growth", id: "eldritch-invocations" } }],
      /**
       * THE TWENTY-EIGHT INVOCATIONS, and the reason Warlock read as broken however much prose
       * landed: the ETL parses every `#### Agonizing Blast` heading into a real `FeatureOption`, and
       * not one of them carried a rider. Eighteen were audit gaps on their own (rows 24, 25, 36,
       * 37-47, 50, 51-53) - the largest single body in the census.
       *
       * ELEVEN ARE "you can cast X without expending a spell slot" (rows 37-47) and are one
       * `grants.spells` line each. `alwaysPrepared` defaults true and is what makes them free: a
       * granted spell does not eat one of the Warlock's prepared slots, and the spell need not be on
       * the Warlock list at all (Mage Armor and Jump are not).
       *
       * The rest are named one by one below, each with what it authors or why it does not.
       */
      options: {
        /**
         * AGONIZING BLAST - audit row 51, closed as far as ruling E allows.
         *
         * "You can add your Charisma modifier to that spell's damage rolls" is exactly the pair of
         * schema additions Stage 3 made for it: `extra-damage.abilityModifier` (the amount is a
         * property of the CHARACTER, so no authored constant is right) and the `spell-id-is` trigger
         * (no combination of school and level picks out one cantrip).
         *
         * WHICH cantrip stays prose. The printed text is "choose one of your known Warlock cantrips
         * that deals damage", which is ruling E's `fromPicks` - a pick over the character's own
         * earlier answers - and it is specified, not built. The gate therefore names Eldritch Blast,
         * the one the SRD itself recommends under Pact Magic and the one this invocation exists for.
         * A Warlock who spends it on Poison Spray instead adds their Charisma by hand, exactly as
         * they do today; naming all four damaging Warlock cantrips would be worse, because it would
         * apply to every one of them at once instead of to the one chosen.
         */
        /**
         * THE THREE THAT PICK FROM THE CHARACTER'S OWN ANSWERS - audit rows 51-53, ruling E.
         *
         * "Choose one of your known Warlock cantrips that deals damage." The option list is the
         * ledger, narrowed by a predicate, which is why no `fromCatalog` slug could ever say it and
         * why all three were prose. `fromPicks` is that third source, and its `where` is a closed
         * slug: `deals-damage`, `ranged` (a range of 10+ feet), `attack-roll`.
         *
         * WHAT IS STILL PROSE, and it is only the effect. Agonizing Blast's rider is authored and
         * shipped - but scoped to Eldritch Blast by id, because `extra-damage` fires on a `when` gate
         * and the gate cannot name "the cantrip this invocation was pointed at". Eldritch Spear's
         * +30-feet-per-level range and Repelling Blast's 10-foot push have no rider vocabulary at
         * all. The PICK is what these rows were about: which cantrip, recorded on the ledger, refused
         * when it is not eligible.
         */
        "agonizing-blast": {
          choice: { kind: "cantrip", choose: 1, fromPicks: { offer: "class-cantrips", where: "deals-damage" } },
          modifiers: [{
            type: "extra-damage", abilityModifier: "cha", damageType: "force",
            when: [{ type: "on-hit" }, { type: "spell-id-is", spellIds: ["eldritch-blast"] }]
          }]
        },
        "eldritch-spear": {
          choice: { kind: "cantrip", choose: 1, fromPicks: { offer: "class-cantrips", where: "ranged" } }
        },
        "repelling-blast": {
          choice: { kind: "cantrip", choose: 1, fromPicks: { offer: "class-cantrips", where: "attack-roll" } }
        },
        // ---- the eleven at-will / once-a-day castings (audit rows 37-47) -------------------------
        "armor-of-shadows": { grants: { spells: [{ id: "mage-armor", level: 1 }] } },
        "ascendant-step": { grants: { spells: [{ id: "levitate", level: 2 }] } },
        "fiendish-vigor": { grants: { spells: [{ id: "false-life", level: 1 }] } },
        /**
         * The one of the eleven the SRD limits ("once ... you regain the ability when you finish a
         * Long Rest"), so it takes a counter as well as the spell. The Swim Speed half stays prose:
         * `speed` is one number and there is no per-movement-mode vocabulary.
         */
        "gift-of-the-depths": {
          grants: { spells: [{ id: "water-breathing", level: 3 }] },
          uses: { limit: 1, per: "long-rest" }
        },
        "mask-of-many-faces": { grants: { spells: [{ id: "disguise-self", level: 1 }] } },
        "master-of-myriad-forms": { grants: { spells: [{ id: "alter-self", level: 2 }] } },
        "misty-visions": { grants: { spells: [{ id: "silent-image", level: 1 }] } },
        /** The "while you're in Dim Light or Darkness" gate stays prose - there is no light-level trigger. */
        "one-with-shadows": { grants: { spells: [{ id: "invisibility", level: 2 }] } },
        "otherworldly-leap": { grants: { spells: [{ id: "jump", level: 1 }] } },
        "visions-of-distant-realms": { grants: { spells: [{ id: "arcane-eye", level: 4 }] } },
        "whispers-of-the-grave": { grants: { spells: [{ id: "speak-with-dead", level: 3 }] } },
        // ---- the picks an invocation makes on top of itself --------------------------------------
        /**
         * PACT OF THE BLADE - audit row 25, its pick half.
         *
         * `fromCatalog: "weapons"` is the whole equipment catalog, which is wider than the printed
         * "a Simple or Martial Melee weapon": there is no filter vocabulary on a catalog slug, and
         * the audit's own note for this row authors it the same way. The PROFICIENCY half ("you have
         * proficiency with the weapon") is left prose - `grants.weapons` names proficiency GROUPS,
         * so the only sayable version hands over every Simple and Martial weapon, and the correct
         * version is a rider conditioned on the answer just given, which is ruling F.
         */
        "pact-of-the-blade": { choice: { kind: "weapon", choose: 1, fromCatalog: "weapons" } },
        /** PACT OF THE CHAIN - audit row 36. "You learn Find Familiar and can cast it ... without a slot." */
        "pact-of-the-chain": { grants: { spells: [{ id: "find-familiar", level: 1 }] } },
        /**
         * PACT OF THE TOME - audit row 50, as far as ruling D allows.
         *
         * The three cantrips are authored; the two level-1 Ritual spells are not. Ruling D: there is
         * no catalog slug meaning "every class's spell list" (that would be a `SpellListReference`
         * overlay with `basedOn: [...]`, which is a homebrew-merge path an SRD bundle record cannot
         * point at), and there is no way to filter on the Ritual tag at all. `warlock-spells` is the
         * narrower list the ruling names; the book's own text carries the rest.
         */
        "pact-of-the-tome": { choice: { kind: "cantrip", choose: 3, fromCatalog: "warlock-spells", maxSpellLevel: 0 } }
        /*
         * THE FIFTEEN LEFT AS PROSE, named so the absence is a decision and not an oversight:
         *
         *   lessons-of-the-first-ones (row 24)
         *                                   - NOT closable, and authoring it would make the
         *                                     invocation UNTAKEABLE. `{kind:"feat"}` on an option's
         *                                     nested choice cannot be answered: `character-build.ts`
         *                                     settles FEAT-kinded rows in pass A and chosen OPTIONS
         *                                     in pass A2, so the offer this would create does not
         *                                     exist yet when the feat row is matched ("No feature
         *                                     'lessons-of-the-first-ones' offers a 'feat' choice"),
         *                                     and omitting the row fails the completeness check
         *                                     instead. Spelling the kind something else to dodge
         *                                     pass A would record the feat and never interpret it,
         *                                     which is the silent drop this area exists to end.
         *                                     It needs the pass-ordering work ruling E specifies.
         *   devils-sight, witch-sight       - `sense`/`darkvision` are display-only by design
         *                                     (`CARRIER_RIDER_DISPOSITION`); the prose already says it.
         *   eldritch-mind                   - `roll-mode` has a `concentration` roll and NO consumer
         *                                     reads it; `roll: "save"` + `ability-is: con` would be
         *                                     advantage on every Constitution save, which is wrong.
         *   thirsting-blade, devouring-blade,
         *   eldritch-smite, lifedrinker     - all four scope to "your pact weapon" and the trigger
         *                                     vocabulary cannot name one conjured weapon. Unscoped,
         *                                     Thirsting Blade would hand out an Extra Attack with a
         *                                     longbow.
         *   gaze-of-two-minds, gift-of-the-protectors,
         *   investment-of-the-chain-master  - perception, a named page, and a familiar's own stat
         *                                     block: no numbers this vocabulary reaches.
         */
      }
    },
    /** The sheet's spellcasting grouping slug, exactly as the hand-authored Wizard tags its own. */
    "pact-magic": { tags: ["spellcasting"] },
    /**
     * MAGICAL CUNNING - "Once you use this feature, you can't do so again until you finish a Long Rest."
     *
     * `uses` with no `actions` mints the synthesised activation the builder already makes for Action
     * Surge and Arcane Recovery, so the Warlock gets a pool the engine really spends rather than a
     * paragraph. HOW MANY SLOTS it returns ("half your maximum, round up") is not authored: nothing
     * in the vocabulary restores a spell slot, and `spell-slot` is a MAXIMUM rider, not a refund.
     */
    "magical-cunning": { uses: { limit: 1, per: "long-rest" } },
    /**
     * CONTACT PATRON - audit row 33. "You always have the Contact Other Plane spell prepared", plus
     * one free casting per Long Rest.
     *
     * `alwaysPrepared` is the schema default and it is the load-bearing half: a granted spell does
     * not eat one of the Warlock's fourteen prepared slots, which is exactly what the SRD says.
     */
    "contact-patron": {
      grants: { spells: [{ id: "contact-other-plane", level: 5 }] },
      uses: { limit: 1, per: "long-rest" }
    },
    /**
     * MYSTIC ARCANUM x4 - audit rows 15-18. "Choose one level 6 Warlock spell as this arcanum",
     * castable once per Long Rest without a slot.
     *
     * `maxSpellLevel` IS A CEILING AND THE ARCANUM WANTS AN EXACT LEVEL. Stage-4 ruling H: author
     * them anyway with the ceiling set to the arcanum's own level and open a one-line follow-up for
     * a `minSpellLevel` sibling (schema, `character-build.ts` `matchRow`, `build-payload.ts`
     * `featurePickOffer` - the two consumers that already read `maxSpellLevel`). A level-11 Warlock
     * can therefore take a level-3 spell as their level-6 arcanum; an arcanum a player can pick
     * slightly wrong is strictly better than one they cannot pick at all.
     *
     * These are FEATURE picks (`payload.featureId`), not class prepared-spell picks, which is what
     * keeps a level-9 spell legal at all: the class budget refuses anything above the Pact Magic
     * slot level, and Pact Magic tops out at 5.
     */
    /**
     * MYSTIC ARCANUM x4 - audit rows 15-18, and the reason `minSpellLevel` exists (assignments SS5H).
     *
     * "Choose one level 6 Warlock spell as this arcanum" is an EXACT level, not a ceiling. With
     * `maxSpellLevel` alone a level-11 Warlock could spend their level-6 arcanum on Eldritch Blast;
     * the floor beside it makes the window one level wide, which is what all four arcana print.
     */
    "mystic-arcanum-level-6-spell": {
      choice: { kind: "spell", choose: 1, fromCatalog: "warlock-spells", minSpellLevel: 6, maxSpellLevel: 6 },
      uses: { limit: 1, per: "long-rest" }
    },
    "mystic-arcanum-level-7-spell": {
      choice: { kind: "spell", choose: 1, fromCatalog: "warlock-spells", minSpellLevel: 7, maxSpellLevel: 7 },
      uses: { limit: 1, per: "long-rest" }
    },
    "mystic-arcanum-level-8-spell": {
      choice: { kind: "spell", choose: 1, fromCatalog: "warlock-spells", minSpellLevel: 8, maxSpellLevel: 8 },
      uses: { limit: 1, per: "long-rest" }
    },
    "mystic-arcanum-level-9-spell": {
      choice: { kind: "spell", choose: 1, fromCatalog: "warlock-spells", minSpellLevel: 9, maxSpellLevel: 9 },
      uses: { limit: 1, per: "long-rest" }
    },
    /**
     * EPIC BOON - audit row 6, the Warlock's ninth of nine. Cleric, Fighter and Wizard have always
     * authored this exact line; the nine generated classes lost their level-19 feature outright.
     */
    "epic-boon": { choice: { kind: "feat", choose: 1, fromCatalog: "epic-boon-feats" } }
  },
  subclasses: {
    "fiend-patron": {
      /**
       * FIEND SPELLS - audit row 27, and the SRD prints it as ONE feature holding a four-tier table.
       *
       * Only the level-3 tier is authored. `grants.spells` has no character-level gate, and the
       * overlay can only merge riders onto features the ETL emits - it cannot split one printed
       * feature into the four staged records Life Domain uses (`life-domain-spells-5/7/9`), because
       * those live in the hand-authored bundle and `STAGED_FEATURES` is in the frozen ETL. Granting
       * all ten here would hand a level-3 Warlock Geas and Insect Plague, which is worse than the
       * table the description now carries in full.
       */
      "fiend-spells": {
        grants: {
          spells: [
            { id: "burning-hands", level: 1 }, { id: "command", level: 1 },
            { id: "scorching-ray", level: 2 }, { id: "suggestion", level: 2 }
          ]
        }
      },
      /**
       * DARK ONE'S OWN LUCK - "a number of times equal to your Charisma modifier (minimum of once)".
       *
       * The `ability-modifier` scaling is the printed wording exactly, floor included, so the pool
       * tracks the character rather than an authored constant. The 1d10 itself stays prose: it is
       * added to a roll the player has already made and seen, which is a table decision, not an
       * action the engine resolves.
       */
      "dark-ones-own-luck": {
        uses: { scaling: { type: "ability-modifier", ability: "cha", minimum: 1 }, per: "long-rest" }
      },
      /**
       * FIENDISH RESILIENCE - audit row 66, its base pick only.
       *
       * "Choose one damage type, other than Force" is Divine-Order-shaped: twelve inline options,
       * each carrying its own `grants.damageResistances`. "Whenever you finish a Short or Long Rest"
       * is ruling A's rest-time re-choice and stays prose - it is runtime state (a per-actor
       * `choiceOverrides` map cleared on a rest), not a build-time ledger row.
       */
      "fiendish-resilience": {
        choice: {
          kind: "damage-type",
          choose: 1,
          options: RESILIENCE_TYPES.map(([id, name]) => ({
            id,
            name,
            description: `You have Resistance to ${name} damage until you choose a different type with this feature.`,
            grants: { damageResistances: [id] }
          }))
        }
      },
      /**
       * HURL THROUGH HELL - 8d10 Psychic on a failed Charisma save against your own spell save DC,
       * once per Long Rest.
       *
       * `activation: "other"` because the SRD's trigger is "once per turn when you hit a creature
       * with an attack roll" and the action economy has no such slot - the GM fires it after the hit
       * lands, exactly as they would read it off the page, and the engine owns the DC, the dice and
       * the counter. The Incapacitated-until-your-next-turn half and the "restore the use with a
       * Pact Magic slot" clause stay prose.
       */
      "hurl-through-hell": {
        uses: { limit: 1, per: "long-rest" },
        actions: [{
          id: "hurl-through-hell",
          name: "Hurl Through Hell",
          activation: "other",
          description: "Once per turn when you hit a creature with an attack roll, the target must succeed on a Charisma saving throw or hurtle through the Lower Planes, taking 8d10 Psychic damage if it isn't a Fiend and gaining the Incapacitated condition until the end of your next turn.",
          save: { ability: "cha", dc: "spellcasting" },
          damage: [{ formula: "8d10", type: "psychic" }]
        }]
      }
    }
  }
};
