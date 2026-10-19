/**
 * Sorcerer and Draconic Sorcery mechanics, merged over the ETL-generated prose.
 *
 * A Metamagic option is a pick with no action of its own, so it can't carry a price: the 1-point options ride the
 * `sorcery-points` pool, and Heightened and Quickened Spell's 2 points are spent from the sheet's Limited uses.
 */
import type { DamageType } from "@vtt/schemas";
import { spellTableStages, type ClassMechanicsModule } from "./overlay.js";

// One debit off the shared pool, which reads the printed Sorcery Points column.
const ONE_SORCERY_POINT = {
  uses: {
    scaling: { type: "class-resource" as const, id: "sorcery-points" },
    per: "long-rest" as const,
    pool: "sorcery-points"
  }
};

/** The five damage types Elemental Affinity prints, with the prose each option carries on the sheet. */
const AFFINITY_TYPES: ReadonlyArray<readonly [id: DamageType, name: string]> = [
  ["acid", "Acid"],
  ["cold", "Cold"],
  ["fire", "Fire"],
  ["lightning", "Lightning"],
  ["poison", "Poison"]
];

export const sorcerer: ClassMechanicsModule = {
  features: {
    // Grouping tag, as on the other casters; no consumer reads class-feature `tags` yet.
    // "Whenever you gain a Sorcerer level, you can replace one of your cantrips" and "one spell on your list".
    spellcasting: {
      tags: ["spellcasting"],
      replaces: [
        { offer: "class-cantrips", when: "level-up", amount: 1 },
        { offer: "class-spells", when: "level-up", amount: 1 }
      ]
    },
    /**
     * Bonus Action, two uses per Long Rest, for 10 rounds: +1 to the save DC of the spells the sheet casts as a
     * Sorcerer (`classId`), and Advantage on their spell attack rolls (`spell-class-is`).
     */
    "innate-sorcery": {
      uses: { limit: 2, per: "long-rest" },
      actions: [
        {
          id: "innate-sorcery",
          name: "Innate Sorcery",
          activation: "bonus-action",
          description:
            "You unleash your innate magic for 1 minute. For the duration, the spell save DC of your Sorcerer spells increases by 1 and you have Advantage on the attack rolls of Sorcerer spells you cast.",
          damage: [],
          grants: {
            name: "Innate Sorcery",
            tags: ["innate-sorcery"],
            duration: { type: "rounds", rounds: 10 },
            modifiers: [
              { type: "spell-save-dc", amount: 1, classId: "sorcerer" },
              {
                type: "roll-mode",
                roll: "attack",
                mode: "advantage",
                when: [
                  { type: "on-attack-roll" },
                  { type: "attack-kind-is", kinds: ["spell"] },
                  { type: "spell-class-is", classIds: ["sorcerer"] }
                ]
              }
            ]
          }
        }
      ]
    },
    /**
     * The Sorcery Points pool, read off the printed column. Converting slots to points and points to
     * slots stays prose (no rider refills another pool or costs several uses).
     */
    "font-of-magic": {
      uses: { scaling: { type: "class-resource", id: "sorcery-points" }, per: "long-rest", pool: "sorcery-points" }
    },
    /**
     * The modifications themselves are not expressible; the price is. The eight 1-point options each
     * debit the shared pool. The 2 -> 4 -> 6 option count is handled by the ETL's `choose` and
     * `grantedAtLevels`.
     */
    metamagic: {
      // "Whenever you gain a Sorcerer level, you can replace one of your Metamagic options with one you don't know."
      replaces: [{ offer: "feature:metamagic", when: "level-up", amount: 1 }],
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
    // The once-per-Long-Rest permission only; the GM gives the points back from the sheet's Limited uses.
    "sorcerous-restoration": { uses: { limit: 1, per: "long-rest" } },
    "epic-boon": { choice: { kind: "feat", choose: 1, fromCatalog: "feats" } }
    // Not modeled: Sorcery Incarnate (substitute cost, two Metamagic per spell), Arcane Apotheosis
    // (cost waiver) and the cantrip replacement clauses.
  },
  subclassStages: {
    "draconic-sorcery": spellTableStages("draconic-spells", "Draconic Spells", "Sorcerer", [
      [
        5,
        [
          ["fear", "Fear", 3],
          ["fly", "Fly", 3]
        ]
      ],
      [
        7,
        [
          ["arcane-eye", "Arcane Eye", 4],
          ["charm-monster", "Charm Monster", 4]
        ]
      ],
      [
        9,
        [
          ["legend-lore", "Legend Lore", 5],
          ["summon-dragon", "Summon Dragon", 5]
        ]
      ]
    ])
  },
  subclasses: {
    "draconic-sorcery": {
      /**
       * 10 + Dexterity + Charisma while unarmored. `allowShield` is authored true: the printed sentence
       * restricts only wearing armor, and the SRD treats a Shield separately (the Monk's text names it,
       * this one does not). "+3, and +1 whenever you gain another Sorcerer level": +1 per level, taken at 3.
       */
      "draconic-resilience": {
        modifiers: [
          { type: "unarmored-defense", ability: "cha", allowShield: true },
          { type: "hit-points-per-level", amount: 1 }
        ]
      },
      /**
       * The level-3 tier; the table's later rows are staged features (`subclassStages`). Granted spells are
       * always prepared and do not use prepared slots; Command is not otherwise on the Sorcerer list.
       */
      "draconic-spells": {
        grants: {
          spells: [
            { id: "alter-self", level: 2 },
            { id: "chromatic-orb", level: 1 },
            { id: "command", level: 1 },
            { id: "dragons-breath", level: 2 }
          ]
        }
      },
      /**
       * Five inline options, each granting its resistance and an `extra-damage` rider of the Charisma
       * modifier for its own type, gated on `damage-type-is` and on a spell (`spell-level-is` any level), so a weapon
       * of that type doesn't fire it.
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
            modifiers: [
              {
                type: "extra-damage" as const,
                abilityModifier: "cha" as const,
                damageType: id,
                when: [
                  { type: "on-damage-roll" as const },
                  { type: "damage-type-is" as const, damageTypes: [id] },
                  { type: "spell-level-is" as const, levels: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }
                ]
              }
            ]
          }))
        }
      },
      // Bonus Action, once per Long Rest, for an hour of game time. Restoring the use with Sorcery Points stays prose.
      "dragon-wings": {
        uses: { limit: 1, per: "long-rest" },
        actions: [
          {
            id: "dragon-wings",
            name: "Dragon Wings",
            activation: "bonus-action",
            description:
              "Draconic wings appear on your back for 1 hour or until you dismiss them (no action required). For the duration you have a Fly Speed of 60 feet. You regain the use on a Long Rest, or by spending 3 Sorcery Points.",
            damage: [],
            grants: {
              name: "Dragon Wings",
              tags: ["dragon-wings"],
              duration: { type: "minutes", minutes: 60 },
              modifiers: [{ type: "special-speed", movement: "fly", feet: 60 }],
              onEnd: [],
              target: "self",
              voidWhileIncapacitated: false,
              concentration: false
            }
          }
        ]
      },
      // The only route to Summon Dragon, with one free casting per Long Rest. The no-Material,
      // no-Concentration modifications stay prose.
      "dragon-companion": {
        grants: { spells: [{ id: "summon-dragon", level: 5, withoutSlot: "free" }] },
        uses: { limit: 1, per: "long-rest" }
      }
    }
  },
  liveResources: ["sorcery-points"]
};
