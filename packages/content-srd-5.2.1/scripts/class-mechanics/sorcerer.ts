/**
 * Sorcerer and Draconic Sorcery mechanics, merged over the ETL-generated prose.
 *
 * Uses count one per spend, so only options costing exactly 1 Sorcery Point ride the
 * `sorcery-points` pool. Heightened and Quickened Spell cost 2 and keep their price in prose.
 */
import type { ClassMechanicsModule } from "./overlay.js";

// One debit off the shared pool, which reads the printed Sorcery Points column.
const ONE_SORCERY_POINT = {
  uses: {
    scaling: { type: "class-resource" as const, id: "sorcery-points" },
    per: "long-rest" as const,
    pool: "sorcery-points"
  }
};

/** The five damage types Elemental Affinity prints, with the prose each option carries on the sheet. */
const AFFINITY_TYPES: ReadonlyArray<readonly [id: string, name: string]> = [
  ["acid", "Acid"],
  ["cold", "Cold"],
  ["fire", "Fire"],
  ["lightning", "Lightning"],
  ["poison", "Poison"]
];

export const sorcerer: ClassMechanicsModule = {
  features: {
    // Grouping tag, as on the other casters; no consumer reads class-feature `tags` yet.
    spellcasting: { tags: ["spellcasting"] },
    /**
     * Bonus Action, two uses per Long Rest, a 10-round `innate-sorcery` tag. The effect carries neither
     * benefit: effects have no `spell-save-dc` modifier, and an effect's roll-mode drops its `when`
     * (and nothing announces a "spell" attack kind), so spell-attack advantage would apply to every
     * attack. The description carries both.
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
            duration: { type: "rounds", rounds: 10 }
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
    // The once-per-Long-Rest permission only; the points it returns are refilled by hand.
    "sorcerous-restoration": { uses: { limit: 1, per: "long-rest" } },
    "epic-boon": { choice: { kind: "feat", choose: 1, fromCatalog: "epic-boon-feats" } }
    // Not modeled: Sorcery Incarnate (substitute cost, two Metamagic per spell), Arcane Apotheosis
    // (cost waiver) and the cantrip replacement clauses.
  },
  subclasses: {
    "draconic-sorcery": {
      /**
       * 10 + Dexterity + Charisma while unarmored. `allowShield` is authored true: the printed sentence
       * restricts only wearing armor, and the SRD treats a Shield separately (the Monk's text names it,
       * this one does not). The Hit Point half (+3 at level 3, +1 per level after) stays prose.
       */
      "draconic-resilience": {
        modifiers: [{ type: "unarmored-defense", ability: "cha", allowShield: true }]
      },
      /**
       * Only the level-3 tier is authored: `grants.spells` has no character-level gate, and the overlay
       * cannot split the feature into staged records. Granted spells are always prepared and do not use
       * prepared slots; Command is not otherwise on the Sorcerer list.
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
       * modifier for its own type. Gated on `damage-type-is`, since no "spell" attack kind is ever
       * announced. It fires only for attack-roll spells against one target (the resolver sets damage
       * types only there), not save spells like Fireball; it can also fire on a weapon of that type.
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
                when: [{ type: "on-damage-roll" as const }, { type: "damage-type-is" as const, damageTypes: [id] }]
              }
            ]
          }))
        }
      },
      // Bonus Action, once per Long Rest. The Fly Speed, 1-hour duration and restoring the use with
      // Sorcery Points stay prose.
      "dragon-wings": {
        uses: { limit: 1, per: "long-rest" },
        actions: [
          {
            id: "dragon-wings",
            name: "Dragon Wings",
            activation: "bonus-action",
            description:
              "Draconic wings appear on your back for 1 hour or until you dismiss them (no action required). For the duration you have a Fly Speed of 60 feet. You regain the use on a Long Rest, or by spending 3 Sorcery Points.",
            damage: []
          }
        ]
      },
      // The only route to Summon Dragon, with one free casting per Long Rest. The no-Material,
      // no-Concentration modifications stay prose.
      "dragon-companion": {
        grants: { spells: [{ id: "summon-dragon", level: 5 }] },
        uses: { limit: 1, per: "long-rest" }
      }
    }
  },
  liveResources: ["sorcery-points"]
};
