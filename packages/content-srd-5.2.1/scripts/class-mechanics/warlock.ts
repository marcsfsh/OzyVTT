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
      extraPicks: [{ offer: "feature:eldritch-invocations", scaling: { type: "class-resource-growth", id: "eldritch-invocations" } }]
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
    "mystic-arcanum-level-6-spell": {
      choice: { kind: "spell", choose: 1, fromCatalog: "warlock-spells", maxSpellLevel: 6 },
      uses: { limit: 1, per: "long-rest" }
    },
    "mystic-arcanum-level-7-spell": {
      choice: { kind: "spell", choose: 1, fromCatalog: "warlock-spells", maxSpellLevel: 7 },
      uses: { limit: 1, per: "long-rest" }
    },
    "mystic-arcanum-level-8-spell": {
      choice: { kind: "spell", choose: 1, fromCatalog: "warlock-spells", maxSpellLevel: 8 },
      uses: { limit: 1, per: "long-rest" }
    },
    "mystic-arcanum-level-9-spell": {
      choice: { kind: "spell", choose: 1, fromCatalog: "warlock-spells", maxSpellLevel: 9 },
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
