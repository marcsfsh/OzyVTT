/**
 * Riders for wands, staffs, rods, rings and the spell scroll. A rider is authored only where a
 * consumer reads it and produces the printed effect; prose-only items are listed in place with the
 * reason.
 *
 * Recurring limits:
 *   - One use spends exactly one charge, so only one-charge properties are authored.
 *   - "Regains 1d6 + 1 expended charges daily at dawn" becomes a full recharge on a long rest.
 *   - Use pools are capped at 20.
 *   - Staffs and rods have no weapon block, so "+N to attack and damage rolls made with it" would be
 *     bearer-scoped (every weapon) or inert; it is not authored.
 *   - An item action's to-hit is ability-derived; a printed flat attack bonus cannot be said.
 *   - `castAction` takes a cast's damage and attack from the spell record's `damage`/`attackRoll`
 *     columns, which describe the spell's text rather than one cast: healing spells become Force
 *     damage, Magic Missile rolls one dart, Web always deals its fire damage, and Faerie Fire,
 *     Protection from Evil and Good and Ray of Enfeeblement gain an attack roll. Those casts are not
 *     authored.
 *   - `spell-attack-bonus` has no reader (the overlay refuses it), and no "spell" attack kind is
 *     ever announced.
 */
import type { ItemMechanicsModule } from "./overlay.js";

export const WANDS_RODS_RINGS: ItemMechanicsModule = {
  // ---- Rings -----------------------------------------------------------------------------------

  /**
   * Three casts on one shared 3-charge pool at the printed DC. Speak with Animals forces no save, so it
   * carries no `saveDc`. "Fear (affects Beasts only)" stays prose.
   */
  "ring-of-animal-influence": {
    casts: [
      {
        spellId: "animal-friendship",
        saveDc: 13,
        uses: { limit: 3, per: "long-rest", pool: "ring-of-animal-influence-charges" }
      },
      { spellId: "fear", saveDc: 13, uses: { limit: 3, per: "long-rest", pool: "ring-of-animal-influence-charges" } },
      { spellId: "speak-with-animals", uses: { limit: 3, per: "long-rest", pool: "ring-of-animal-influence-charges" } }
    ]
  },

  // `ring-of-djinni-summoning` - summoning a creature is not expressible.
  // `ring-of-elemental-command` - `versus-creature-type` is inert; the plane is a per-copy GM choice;
  // multi-charge spells.

  // Auto-succeeding a save is not expressible; the reaction and its 3-charge pool are, and the GM rules the success.
  "ring-of-evasion": {
    actions: [
      {
        id: "evade",
        name: "Evade",
        activation: "reaction",
        description:
          "When you fail a Dexterity saving throw while wearing the ring, you can take a Reaction to expend 1 charge to succeed on that save instead.",
        uses: { limit: 3, per: "long-rest", pool: "ring-of-evasion-charges" }
      }
    ]
  },

  // `ring-of-feather-falling` - no falling model.

  // `ring-of-free-action` - a condition immunity cannot be limited to magical sources, and an absolute
  // one would refuse ordinary Restrained/Paralyzed effects. Difficult terrain is not modeled.

  // `ring-of-invisibility` - no action applies a condition to its own user.

  /** "While wearing this ring, you can cast Jump from it, but can target only yourself." Self-only is prose. */
  "ring-of-jumping": { casts: [{ spellId: "jump" }] },

  // `ring-of-mind-shielding` - no immunity keyed to an effect kind.

  "ring-of-protection": {
    modifiers: [
      { type: "armor-class", amount: 1 },
      { type: "save-bonus", amount: 1 }
    ]
  },

  // `ring-of-regeneration` - no out-of-combat healing timer.

  // "The GM chooses the type": fire (the d10's Garnet row). Copy the item to choose another.
  "ring-of-resistance": { grants: { damageResistances: ["fire"] } },

  /**
   * The two cantrips are at will; Shooting Stars is the ring's own effect, at its one-charge size.
   * Not authored: Faerie Fire (its spell record would add an attack roll), Lightning Spheres and the
   * 2-3 charge Shooting Stars (multi-charge).
   */
  "ring-of-shooting-stars": {
    casts: [{ spellId: "dancing-lights" }, { spellId: "light" }],
    actions: [
      {
        id: "shooting-stars",
        name: "Shooting Stars",
        activation: "action",
        description:
          "Expend 1 charge to launch a glowing mote of light at a point within 60 feet. Each creature in a 15-foot Cube originating from that point makes a DC 15 Dexterity saving throw, taking 5d4 Radiant damage on a failed save or half as much damage on a successful one.",
        save: { ability: "dex", dc: 15 },
        damage: [{ formula: "5d4", type: "radiant" }],
        uses: { limit: 6, per: "long-rest", pool: "ring-of-shooting-stars-charges" }
      }
    ]
  },

  // `ring-of-spell-storing` - needs per-copy storage and the original caster's numbers.
  // `ring-of-spell-turning` - no "save against a spell" filter; ungated it would apply to every save.
  // `ring-of-swimming` - `speed` is walking speed; there is no Swim Speed.

  /** "While wearing this ring, you can cast Telekinesis from it." At will, no charges, no DC override. */
  "ring-of-telekinesis": { casts: [{ spellId: "telekinesis" }] },

  // `ring-of-the-ram` - a flat +7 attack bonus and per-charge damage are not expressible.
  // `ring-of-three-wishes` - every `per` value recharges, so three lifetime Wishes would become three a day.

  // `ring-of-warmth` - needs a damage-taken moment with dice-valued `damage-reduction`.

  /** "While wearing this ring, you cast Water Walk from it, targeting only yourself." Self-only is prose. */
  "ring-of-water-walking": { casts: [{ spellId: "water-walk" }] },

  // `ring-of-x-ray-vision` - `sense` is display-only and standing, not a timed activated sense.

  // ---- Rods ------------------------------------------------------------------------------------

  // `immovable-rod` - acts on the world, not on a creature; a GM ruling.
  // `rod-of-absorption` - needs per-copy storage and a spell slot refund.

  /**
   * Initiative and Perception advantage, four at-will detection casts, and the Protective Aura's
   * once-per-dawn counter (the ally buff is prose). The Perception half is gated on `ability-is:
   * ["wis"]` because the server's Search check carries no skill, so `skill-is` would never fire.
   */
  "rod-of-alertness": {
    modifiers: [
      { type: "roll-mode", roll: "initiative", mode: "advantage" },
      {
        type: "roll-mode",
        roll: "check",
        mode: "advantage",
        when: [{ type: "on-ability-check" }, { type: "ability-is", abilities: ["wis"] }]
      }
    ],
    casts: [
      { spellId: "detect-evil-and-good" },
      { spellId: "detect-magic" },
      { spellId: "detect-poison-and-disease" },
      { spellId: "see-invisibility" }
    ],
    actions: [
      {
        id: "protective-aura",
        name: "Protective Aura",
        activation: "action",
        description:
          "Plant the haft end of the rod in the ground. Its head sheds Bright Light in a 60-foot radius and Dim Light for an additional 60 feet. While in that Bright Light, you and your allies gain a +1 bonus to Armor Class and saving throws and can sense the location of any Invisible creature that is also in the Bright Light. Ends after 10 minutes or when a creature pulls the rod from the ground.",
        uses: { limit: 1, per: "long-rest" }
      }
    ]
  },

  // `rod-of-lordly-might` - no weapon block, and its buttons turn one record into several weapons.

  // `rod-of-resurrection` - `heal` has no healing in the spell model; Resurrection costs 5 charges.

  // The resolver reads Charmed from the description (`conditionFrom`), so the word must stay in it.
  "rod-of-rulership": {
    actions: [
      {
        id: "command-obedience",
        name: "Command Obedience",
        activation: "action",
        description:
          "Present the rod and command obedience from each creature of your choice that you can see within 120 feet. Each target must succeed on a DC 15 Wisdom saving throw or have the Charmed condition for 8 hours. If harmed by you or your allies, or commanded to do something contrary to its nature, a target ceases to be Charmed in this way.",
        save: { ability: "wis", dc: 15 },
        uses: { limit: 1, per: "long-rest" }
      }
    ]
  },

  // `rod-of-security` - no plane model, and "once per 10 days" is not a `per` value.

  // ---- The scroll ------------------------------------------------------------------------------

  // `spell-scroll` - a per-copy template (spell, DC, attack bonus by level); one `spellId` would fix
  // every scroll to one spell. Mint concrete scrolls in the homebrew editor.

  // ---- Staffs ----------------------------------------------------------------------------------

  // All three one-charge casts on one pool. No `saveDc`: the cast uses the wielder's own DC, as
  // printed. Reflect and Resist Enchantment (save outcomes) are not expressible.
  "staff-of-charming": {
    casts: [
      { spellId: "charm-person", uses: { limit: 10, per: "long-rest", pool: "staff-of-charming-charges" } },
      { spellId: "command", uses: { limit: 10, per: "long-rest", pool: "staff-of-charming-charges" } },
      { spellId: "comprehend-languages", uses: { limit: 10, per: "long-rest", pool: "staff-of-charming-charges" } }
    ]
  },

  // Fireball (3) and Wall of Fire (4) are multi-charge.
  "staff-of-fire": {
    grants: { damageResistances: ["fire"] },
    casts: [{ spellId: "burning-hands", uses: { limit: 10, per: "long-rest", pool: "staff-of-fire-charges" } }]
  },

  // Wall of Ice, Ice Storm and Cone of Cold are multi-charge.
  "staff-of-frost": {
    grants: { damageResistances: ["cold"] },
    casts: [{ spellId: "fog-cloud", uses: { limit: 10, per: "long-rest", pool: "staff-of-frost-charges" } }]
  },

  // `staff-of-healing` - Cure Wounds would deal 2d8 Force (no healing in the spell model); the rest
  // is multi-charge.

  /**
   * The AC and save bonuses only. Not authored: Magic Missile and Ray of Enfeeblement (wrong cast
   * effects), the spell attack bonus (no reader), the +2 Quarterstaff (no weapon block), the
   * multi-charge spells, and Retributive Strike (damage from live charge count).
   */
  "staff-of-power": {
    modifiers: [
      { type: "armor-class", amount: 2 },
      { type: "save-bonus", amount: 2 }
    ]
  },

  // `staff-of-striking` - the +3 and the per-charge 1d6 both need a weapon block (and multi-charge).

  // Insect Cloud's counter; the Heavily Obscured area is a GM ruling. Giant Insect and Insect Plague are multi-charge.
  "staff-of-swarming-insects": {
    actions: [
      {
        id: "insect-cloud",
        name: "Insect Cloud",
        activation: "action",
        description:
          "Expend 1 charge to fill a 30-foot Emanation originating from you with a swarm of harmless flying insects. They remain for 10 minutes, making the area Heavily Obscured for creatures other than you. A strong wind disperses the swarm and ends the effect.",
        uses: { limit: 10, per: "long-rest", pool: "staff-of-swarming-insects-charges" }
      }
    ]
  },

  /**
   * The four zero-charge casts; 50 charges exceed the pool cap. Not authored: Protection from Evil and
   * Good (bogus attack roll), the spell attack bonus, the +2 Quarterstaff, advantage on saves against
   * spells, the multi-charge rows, Spell Absorption and Retributive Strike.
   */
  "staff-of-the-magi": {
    casts: [{ spellId: "arcane-lock" }, { spellId: "detect-magic" }, { spellId: "enlargereduce" }, { spellId: "light" }]
  },

  // `staff-of-the-python` - summoning a controlled creature is not expressible.

  // The three one-charge properties on the 6-charge pool. Not authored: the spell attack bonus, the
  // +2 Quarterstaff, the multi-charge spells.
  "staff-of-the-woodlands": {
    casts: [
      { spellId: "animal-friendship", uses: { limit: 6, per: "long-rest", pool: "staff-of-the-woodlands-charges" } },
      { spellId: "speak-with-animals", uses: { limit: 6, per: "long-rest", pool: "staff-of-the-woodlands-charges" } }
    ],
    actions: [
      {
        id: "tree-form",
        name: "Tree Form",
        activation: "action",
        description:
          "Plant one end of the staff in earth in an unoccupied space and expend 1 charge to transform it into a healthy tree, 60 feet tall with a 5-foot-diameter trunk and a 20-foot-radius crown. While touching the tree and using a Magic action, you return the staff to its normal form.",
        uses: { limit: 6, per: "long-rest", pool: "staff-of-the-woodlands-charges" }
      }
    ]
  },

  /**
   * The two standalone properties, each with its own once-per-dawn counter; Thunderclap's Deafened is
   * read from the description. The on-hit properties and the +2 Quarterstaff need a weapon block.
   */
  "staff-of-thunder-and-lightning": {
    actions: [
      {
        id: "lightning-strike",
        name: "Lightning Strike",
        activation: "action",
        description:
          "A bolt of lightning leaps from the staff's tip in a Line 5 feet wide and 120 feet long. Each creature in that Line makes a DC 17 Dexterity saving throw, taking 9d6 Lightning damage on a failed save or half as much damage on a successful one.",
        save: { ability: "dex", dc: 17 },
        damage: [{ formula: "9d6", type: "lightning" }],
        uses: { limit: 1, per: "long-rest" }
      },
      {
        id: "thunderclap",
        name: "Thunderclap",
        activation: "action",
        description:
          "The staff produces a thunderclap audible out to 600 feet. Every creature within a 60-foot Emanation originating from you makes a DC 17 Constitution saving throw. On a failed save, a creature takes 2d6 Thunder damage and has the Deafened condition for 1 minute. On a successful save, a creature takes half as much damage only.",
        save: { ability: "con", dc: 17 },
        damage: [{ formula: "2d6", type: "thunder" }],
        uses: { limit: 1, per: "long-rest" }
      }
    ]
  },

  // `staff-of-withering` - the on-hit 2d10 needs a weapon block (bearer-scoped it would hit every weapon).

  // ---- Wands -----------------------------------------------------------------------------------

  // `wand-of-binding` - both properties cost more than one charge.

  // The detection is GM information; the charge is real.
  "wand-of-enemy-detection": {
    actions: [
      {
        id: "detect-enemies",
        name: "Detect Enemies",
        activation: "action",
        description:
          "Expend 1 charge. For 1 minute, you know the direction of the nearest creature Hostile to you within 60 feet, but not its distance. The wand senses Hostile creatures that are Invisible, ethereal, disguised, or hidden, as well as those in plain sight. The effect ends if you stop holding the wand.",
        uses: { limit: 7, per: "long-rest", pool: "wand-of-enemy-detection-charges" }
      }
    ]
  },

  // Command at the wand's printed DC. Fear (3 charges) is multi-charge.
  "wand-of-fear": {
    casts: [{ spellId: "command", saveDc: 15, uses: { limit: 7, per: "long-rest", pool: "wand-of-fear-charges" } }]
  },

  /**
   * Fireball at the printed DC 15 off a 7-charge pool. No `atLevel`: the cast uses the spell's own
   * level. The 2-3 charge upcasts are multi-charge.
   */
  "wand-of-fireballs": {
    casts: [
      {
        spellId: "fireball",
        saveDc: 15,
        uses: { limit: 7, per: "long-rest", pool: "wand-of-fireballs-charges" }
      }
    ]
  },

  /** The Fireball wand's twin: Lightning Bolt (save DC 15), 1 charge, 7 charges. Upcasts are multi-charge. */
  "wand-of-lightning-bolts": {
    casts: [
      {
        spellId: "lightning-bolt",
        saveDc: 15,
        uses: { limit: 7, per: "long-rest", pool: "wand-of-lightning-bolts-charges" }
      }
    ]
  },

  /** "This wand has 3 charges. While holding it, you can expend 1 charge to cast Detect Magic from it." Complete. */
  "wand-of-magic-detection": {
    casts: [{ spellId: "detect-magic", uses: { limit: 3, per: "long-rest", pool: "wand-of-magic-detection-charges" } }]
  },

  // `wand-of-magic-missiles` - the spell record's damage is one dart of three.

  // The wand's own effect; the resolver reads Paralyzed from the description.
  "wand-of-paralysis": {
    actions: [
      {
        id: "paralyzing-ray",
        name: "Paralyzing Ray",
        activation: "action",
        description:
          "Expend 1 charge to send a thin blue ray toward a creature you can see within 60 feet. The target must succeed on a DC 15 Constitution saving throw or have the Paralyzed condition for 1 minute. At the end of each of its turns, it repeats the save, ending the effect on itself on a success.",
        save: { ability: "con", dc: 15 },
        uses: { limit: 7, per: "long-rest", pool: "wand-of-paralysis-charges" }
      }
    ]
  },

  /** "expend 1 charge to cast Polymorph (save DC 15) from it." One charge, one spell, printed DC. Complete. */
  "wand-of-polymorph": {
    casts: [
      { spellId: "polymorph", saveDc: 15, uses: { limit: 7, per: "long-rest", pool: "wand-of-polymorph-charges" } }
    ]
  },

  "wand-of-secrets": {
    actions: [
      {
        id: "find-secrets",
        name: "Find Secrets",
        activation: "action",
        description:
          "Expend 1 charge. If a secret door or trap is within 60 feet of you, the wand pulses and points at the one nearest to you.",
        uses: { limit: 3, per: "long-rest", pool: "wand-of-secrets-charges" }
      }
    ]
  },

  // `wand-of-the-war-mage-1`, `wand-of-the-war-mage-2`, `wand-of-the-war-mage-3` - a spell attack
  // bonus (no reader) and ignoring Half Cover on spell attacks (no "spell" attack kind).

  // `wand-of-web` - the spell record's 2d4 Fire would be dealt on every cast.

  // The d100 effect table is GM-rolled; the charge is real.
  "wand-of-wonder": {
    actions: [
      {
        id: "wild-surge",
        name: "Wild Surge",
        activation: "action",
        description:
          "Expend 1 charge and choose a point within 120 feet of yourself. That location becomes the point of origin of a spell or other magical effect determined by rolling on the Wand of Wonder Effects table in this item's description. Spells cast from the wand have a save DC of 15, and any spell whose maximum range is normally less than 120 feet has a range of 120 feet when cast from the wand.",
        uses: { limit: 7, per: "long-rest", pool: "wand-of-wonder-charges" }
      }
    ]
  }
};
