/**
 * Warlock and Fiend Patron mechanics, merged over the ETL-generated prose.
 *
 * Stays prose throughout: "whenever you gain a Warlock level, you can replace..." clauses; anything
 * scoped to "your pact weapon" (the trigger vocabulary cannot name one conjured weapon, and unscoped
 * riders would apply to every weapon); and senses, which are display-only.
 */
import type { ClassMechanicsModule } from "./overlay.js";

/** An invocation's spell: cast at will without a slot, and never with one, since the Warlock does not know it. */
const atWill = (id: string, level: number) => ({ id, level, withoutSlot: "at-will" as const, withSlot: false });

/** Every SRD damage type Fiendish Resilience may name: the printed twelve, less Force. */
const RESILIENCE_TYPES: ReadonlyArray<readonly [id: string, name: string]> = [
  ["acid", "Acid"],
  ["bludgeoning", "Bludgeoning"],
  ["cold", "Cold"],
  ["fire", "Fire"],
  ["lightning", "Lightning"],
  ["necrotic", "Necrotic"],
  ["piercing", "Piercing"],
  ["poison", "Poison"],
  ["psychic", "Psychic"],
  ["radiant", "Radiant"],
  ["slashing", "Slashing"],
  ["thunder", "Thunder"]
];

export const warlock: ClassMechanicsModule = {
  features: {
    /**
     * The Invocations column runs 1 -> 10 and steps at levels with no printed feature heading, so the
     * level-1 feature reads the column's growth instead of repeating grants.
     */
    "eldritch-invocations": {
      extraPicks: [
        {
          offer: "feature:eldritch-invocations",
          scaling: { type: "class-resource-growth", id: "eldritch-invocations" }
        }
      ],
      /**
       * Riders on the ETL-parsed invocation options. "Cast X without expending a spell slot" options are a
       * `grants.spells` line each (granted spells are always prepared, need not be on the Warlock list,
       * and do not use prepared slots).
       */
      options: {
        /**
         * Agonizing Blast, Eldritch Spear and Repelling Blast pick one of the character's known cantrips
         * (`fromPicks`). Agonizing Blast's Charisma damage is gated to Eldritch Blast by id, since the gate
         * cannot name the picked cantrip; Eldritch Spear's range and Repelling Blast's push stay prose.
         */
        "agonizing-blast": {
          choice: { kind: "cantrip", choose: 1, fromPicks: { offer: "class-cantrips", where: "deals-damage" } },
          modifiers: [
            {
              type: "extra-damage",
              abilityModifier: "cha",
              damageType: "force",
              when: [{ type: "on-hit" }, { type: "spell-id-is", spellIds: ["eldritch-blast"] }]
            }
          ]
        },
        "eldritch-spear": {
          choice: { kind: "cantrip", choose: 1, fromPicks: { offer: "class-cantrips", where: "ranged" } }
        },
        "repelling-blast": {
          choice: { kind: "cantrip", choose: 1, fromPicks: { offer: "class-cantrips", where: "attack-roll" } }
        },
        // ---- castings without a spell slot ---------------------------------------------------------
        "armor-of-shadows": { grants: { spells: [atWill("mage-armor", 1)] } },
        "ascendant-step": { grants: { spells: [atWill("levitate", 2)] } },
        "fiendish-vigor": { grants: { spells: [atWill("false-life", 1)] } },
        /**
         * The only one limited to once per Long Rest, so it also takes a counter. The Swim Speed stays
         * prose (no per-movement-mode speed).
         */
        "gift-of-the-depths": {
          grants: { spells: [{ id: "water-breathing", level: 3, withoutSlot: "free", withSlot: false }] },
          uses: { limit: 1, per: "long-rest" }
        },
        "mask-of-many-faces": { grants: { spells: [atWill("disguise-self", 1)] } },
        "master-of-myriad-forms": { grants: { spells: [atWill("alter-self", 2)] } },
        "misty-visions": { grants: { spells: [atWill("silent-image", 1)] } },
        /** The "while you're in Dim Light or Darkness" gate stays prose - there is no light-level trigger. */
        "one-with-shadows": { grants: { spells: [atWill("invisibility", 2)] } },
        "otherworldly-leap": { grants: { spells: [atWill("jump", 1)] } },
        "visions-of-distant-realms": { grants: { spells: [atWill("arcane-eye", 4)] } },
        "whispers-of-the-grave": { grants: { spells: [atWill("speak-with-dead", 3)] } },
        // ---- picks an invocation makes on top of itself --------------------------------------------
        /**
         * `fromCatalog: "weapons"` is wider than "a Simple or Martial Melee weapon" (catalog slugs cannot be
         * filtered). Proficiency with the chosen weapon stays prose: `grants.weapons` names groups only.
         */
        "pact-of-the-blade": { choice: { kind: "weapon", choose: 1, fromCatalog: "weapons" } },
        /** "You learn Find Familiar and can cast it ... without a slot." */
        "pact-of-the-chain": { grants: { spells: [{ id: "find-familiar", level: 1, withoutSlot: "at-will" }] } },
        /**
         * The three cantrips only. The two level-1 Ritual spells from any class list are not expressible
         * (no all-classes list, no Ritual filter).
         */
        "pact-of-the-tome": { choice: { kind: "cantrip", choose: 3, fromCatalog: "warlock-spells", maxSpellLevel: 0 } }
        // Not modeled: Lessons of the First Ones (a feat pick on an option's nested choice cannot be
        // settled by the build's pass ordering), Devil's Sight and Witch Sight (senses are display-only),
        // Eldritch Mind (concentration roll-mode has no reader), the pact-weapon invocations, and Gaze of Two
        // Minds, Gift of the Protectors and Investment of the Chain Master.
      }
    },
    /** The sheet's spellcasting grouping slug, exactly as the hand-authored Wizard tags its own. */
    "pact-magic": { tags: ["spellcasting"] },
    // The once-per-Long-Rest permission only; no rider restores spell slots.
    "magical-cunning": { uses: { limit: 1, per: "long-rest" } },
    // Contact Other Plane always prepared, plus one free casting per Long Rest.
    "contact-patron": {
      grants: { spells: [{ id: "contact-other-plane", level: 5, withoutSlot: "free" }] },
      uses: { limit: 1, per: "long-rest" }
    },
    /**
     * "Choose one level 6 Warlock spell": `minSpellLevel` and `maxSpellLevel` make an exact level.
     * These are feature picks, so they are not capped at the Pact Magic slot level.
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
    "epic-boon": { choice: { kind: "feat", choose: 1, fromCatalog: "feats" } }
  },
  subclasses: {
    "fiend-patron": {
      /**
       * Only the level-3 tier is authored: `grants.spells` has no character-level gate, and the overlay
       * cannot split the feature into staged records. The full table is in the description.
       */
      "fiend-spells": {
        grants: {
          spells: [
            { id: "burning-hands", level: 1 },
            { id: "command", level: 1 },
            { id: "scorching-ray", level: 2 },
            { id: "suggestion", level: 2 }
          ]
        }
      },
      // Uses equal the Charisma modifier (minimum 1). Adding the 1d10 to a roll already made stays prose.
      "dark-ones-own-luck": {
        uses: { scaling: { type: "ability-modifier", ability: "cha", minimum: 1 }, per: "long-rest" }
      },
      /**
       * Twelve inline options, one resistance each. Re-choosing on a rest is runtime state
       * (`actor.choiceOverrides`); declared `short-rest` because a long rest also satisfies it.
       */
      "fiendish-resilience": {
        replaces: [{ offer: "feature:fiendish-resilience", when: "short-rest", amount: 1 }],
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
       * `activation: "other"`: the trigger is "once per turn when you hit", which the action economy has
       * no slot for. The Fiend exemption and restoring the use with a Pact Magic slot stay prose.
       */
      "hurl-through-hell": {
        uses: { limit: 1, per: "long-rest" },
        actions: [
          {
            id: "hurl-through-hell",
            name: "Hurl Through Hell",
            activation: "other",
            description:
              "Once per turn when you hit a creature with an attack roll, the target must succeed on a Charisma saving throw or hurtle through the Lower Planes, taking 8d10 Psychic damage if it isn't a Fiend and gaining the Incapacitated condition until the end of your next turn.",
            save: { ability: "cha", dc: "spellcasting", successDamage: "none", failureConditions: ["incapacitated"] },
            damage: [{ formula: "8d10", type: "psychic" }]
          }
        ]
      }
    }
  }
};
