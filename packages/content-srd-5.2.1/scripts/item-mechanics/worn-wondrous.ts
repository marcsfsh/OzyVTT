/**
 * Riders for worn wondrous items: category `wondrous-item` with slot `neck`, `shoulders`, `head`,
 * `feet`, `hands` or `belt`. A rider is authored only where a consumer reads it and produces the
 * printed effect; prose-only items are listed in place with the reason.
 *
 * Recurring limits:
 *   - Check advantage fires only on checks the server rolls with a matching narrow: Hide carries
 *     `{dex, stealth}`, while Search/Study/Influence carry only an ability. "Advantage on Dexterity
 *     (Stealth) checks" is authorable; qualified clauses ("that rely on sight") are not.
 *   - `speed`, `darkvision` and `sense` reach nothing from an item (the overlay refuses them).
 *   - A save cannot be narrowed to what it is against, so "Advantage on saves against spells" or
 *     "to avoid the Poisoned condition" would apply to every save.
 *   - No `per` value means "never recharges", so consumable charges (beads, crumbling scarabs,
 *     talismans destroyed on the last charge) cannot be authored.
 *   - Spell records describe the spell's text, not one cast (see `wands-rods-rings.ts`), and there
 *     is no healing in the spell model.
 *   - `spell-save-dc` raises every save-bearing action on the sheet, including other items' printed
 *     DCs, not just the wearer's spell save DC.
 *   - `ability-score` and `hit-points-per-level` are refused on items.
 *
 * A charged item may be authored for its charge alone (count and recharge exact) when the GM can
 * already produce what the charge buys, as with `winged-boots` and `cloak-of-invisibility`.
 * Recharge "1dN at dawn" becomes a full refill on a long rest.
 */
import type { ItemMechanicsModule } from "./overlay.js";

export const WORN_WONDROUS: ItemMechanicsModule = {
  // ---- Belt ------------------------------------------------------------------------------------

  // `belt-of-dwarvenkind` - Constitution +2 (`ability-score`, refused), Dwarvish (item languages have
  //     no reader), Persuasion advantage limited to dwarves (no target creature type), and Darkvision
  //     and Poison resistance under a negated species gate ("if you aren't a dwarf").
  // `belt-of-giant-strength` - sets Strength (`ability-score`, refused).

  // ---- Feet ------------------------------------------------------------------------------------

  // Matches the Hide check's `{dex, stealth}` narrow. Silent steps are not modeled.
  "boots-of-elvenkind": {
    modifiers: [
      {
        type: "roll-mode",
        roll: "check",
        mode: "advantage",
        when: [
          { type: "on-ability-check" },
          { type: "ability-is", abilities: ["dex"] },
          { type: "skill-is", skills: ["stealth"] }
        ]
      }
    ]
  },

  // `boots-of-levitation` - the Levitate cast would prompt the wearer to save against their own boots.
  // `boots-of-speed` - doubled speed, a 10-minute budget, and opportunity-attack disadvantage (the
  //     defender's incoming-attack riders get no attack-kind filters).
  // `boots-of-striding-and-springing` - a speed floor, encumbrance and jumping are not modeled.
  // `slippers-of-spider-climbing` - no climb speed or surface model.

  // Ungated in the SRD. Cold tolerance and ice/snow difficult terrain are not modeled.
  "boots-of-the-winterlands": { grants: { damageResistances: ["cold"] } },

  // Charge-alone: 4 charges exact; the Fly Speed is GM-adjudicated.
  "winged-boots": {
    actions: [
      {
        id: "fly",
        name: "Winged Flight",
        activation: "action",
        description:
          "Expend 1 charge to gain a Fly Speed of 30 feet for 1 hour. If you are flying when the duration expires, you descend at a rate of 30 feet per round until you land.",
        uses: { limit: 4, per: "long-rest", pool: "winged-boots-charges" }
      }
    ]
  },

  // ---- Hands -----------------------------------------------------------------------------------

  // `grants.weapons` accepts base weapon ids as well as categories. The +2 damage with those bows is
  // not authored.
  "bracers-of-archery": { grants: { weapons: ["longbow", "shortbow"] } },

  // `while-unarmored` (default `allowShield: false`) is "no armor and no Shield" exactly.
  "bracers-of-defense": {
    modifiers: [{ type: "armor-class", amount: 2, when: [{ type: "while-unarmored" }] }]
  },

  // `gauntlets-of-ogre-power` - sets Strength (`ability-score`, refused).
  // `gloves-of-missile-snaring` - the reduction is rolled (1d10 + Dex), needs a free hand, and costs a
  //     Reaction; `damage-reduction` is a flat, free, standing amount.
  // `gloves-of-swimming-and-climbing` - movement speeds, and the +5 is limited to climbing or swimming
  //     within Athletics, which `skill-is` cannot narrow.

  // `on-ability-check` puts it in the momentary pass; `skill-is` keeps it to Sleight of Hand.
  "gloves-of-thievery": {
    modifiers: [
      {
        type: "check-bonus",
        amount: 5,
        when: [{ type: "on-ability-check" }, { type: "skill-is", skills: ["sleight-of-hand"] }]
      }
    ]
  },

  // ---- Head ------------------------------------------------------------------------------------

  // `circlet-of-blasting` - the Scorching Ray cast would roll one ray at the wearer's bonus, not +5.

  // One-charge Charm Person at DC 13. Higher-level casts for extra charges are not expressible.
  "eyes-of-charming": {
    casts: [
      {
        spellId: "charm-person",
        saveDc: 13,
        uses: { limit: 3, per: "long-rest", pool: "eyes-of-charming-charges" }
      }
    ]
  },

  // `eyes-of-minute-seeing` - Darkvision, and Investigation advantage limited to within one foot.
  // `eyes-of-the-eagle` - Perception advantage "that rely on sight" and long-distance sight.
  // `goggles-of-night` - Darkvision reaches nothing from an item.

  // An unlimited self-cast with no damage, attack or save.
  "hat-of-disguise": { casts: [{ spellId: "disguise-self" }] },

  // `headband-of-intellect` - sets Intelligence (`ability-score`, refused).
  // `helm-of-brilliance` - auras, toggled fire damage, a resistance gated on gem count, gem-cost
  //     spells and a random self-destruct; nothing is expressible.

  // Unlimited cast, as printed. (Compare the belt's Dwarvish: a cast reaches the action list, a language grant does not.)
  "helm-of-comprehending-languages": { casts: [{ spellId: "comprehend-languages" }] },

  // Two pools: each spell is limited independently. Telepathy is not modeled.
  "helm-of-telepathy": {
    casts: [
      {
        spellId: "detect-thoughts",
        saveDc: 13,
        uses: { limit: 1, per: "long-rest", pool: "helm-of-telepathy-detect-thoughts" }
      },
      { spellId: "suggestion", saveDc: 13, uses: { limit: 1, per: "long-rest", pool: "helm-of-telepathy-suggestion" } }
    ]
  },

  // `helm-of-teleportation` - the Teleport cast would deal its 1d100 mishap roll as Force damage.

  // ---- Neck ------------------------------------------------------------------------------------

  // `amulet-of-health` - sets Constitution (`ability-score`, refused).
  // `amulet-of-proof-against-detection-and-location` - no immunity keyed to a school of magic.
  // `amulet-of-the-planes` - a cast gated on an Arcana check with a d100 failure table.

  // Immunity to Magic Missile damage only (not all Force) is not expressible.
  "brooch-of-shielding": { grants: { damageResistances: ["force"] } },

  "medallion-of-thoughts": {
    casts: [
      {
        spellId: "detect-thoughts",
        saveDc: 13,
        uses: { limit: 5, per: "long-rest", pool: "medallion-of-thoughts-charges" }
      }
    ]
  },

  // `necklace-of-adaptation` - breathing anywhere, and Poisoned-save advantage (save source).
  // `necklace-of-fireballs` - beads never come back; an unlimited cast would be worse.
  // `necklace-of-prayer-beads` - the bead composition is per copy, and Cure Wounds has no healing.
  // `periapt-of-health` - healing, and Poisoned-save advantage (save source).

  // Both immunities are unqualified in the SRD, unlike Ring of Free Action's "magic" source.
  "periapt-of-proof-against-poison": {
    grants: { damageImmunities: ["poison"], conditionImmunities: ["poisoned"] }
  },

  // `periapt-of-wound-closure` - death-save roll changes have no reader; doubling Hit Die healing is healing.

  // AC only. Preservation (save outcome, crumbles when spent) and spell-save advantage are not expressible.
  "scarab-of-protection": { modifiers: [{ type: "armor-class", amount: 1 }] },

  // `talisman-of-pure-good`, `talisman-of-ultimate-evil` - spell attack bonus (no reader), touch damage
  //     by creature type, and charges that destroy the item.
  // `talisman-of-the-sphere` - Arcana advantage only against a Sphere of Annihilation, which the engine does not hold.

  // ---- Shoulders -------------------------------------------------------------------------------

  // `cape-of-the-mountebank` - the Dimension Door cast would deal its 4d6 to the target; the smoke cloud is not modeled.

  // Spider Climb, Spider Walk and the Web cast are not expressible.
  "cloak-of-arachnida": { grants: { damageResistances: ["poison"] } },

  // `cloak-of-displacement` - attack disadvantage that switches off after damage or at Speed 0; no
  //     self-suppressing rider exists, so it would be permanent.

  // Requires attunement, so it applies only once attuned. Disadvantage on others' Perception against the wearer is not expressible.
  "cloak-of-elvenkind": {
    modifiers: [
      {
        type: "roll-mode",
        roll: "check",
        mode: "advantage",
        when: [
          { type: "on-ability-check" },
          { type: "ability-is", abilities: ["dex"] },
          { type: "skill-is", skills: ["stealth"] }
        ]
      }
    ]
  },

  // Charge-alone: 3 charges exact; the GM applies the Invisible condition.
  "cloak-of-invisibility": {
    actions: [
      {
        id: "vanish",
        name: "Pull Up the Hood",
        activation: "action",
        description:
          "Expend 1 charge to give yourself the Invisible condition for 1 hour. The effect ends early if you pull the hood down (no action required) or cease wearing the cloak.",
        uses: { limit: 3, per: "long-rest", pool: "cloak-of-invisibility-charges" }
      }
    ]
  },

  "cloak-of-protection": {
    modifiers: [
      { type: "armor-class", amount: 1 },
      { type: "save-bonus", amount: 1 }
    ]
  },

  // Stealth advantage is unqualified. The Fly Speed (light-level gated) and the self-Polymorph cast are not expressible.
  "cloak-of-the-bat": {
    modifiers: [
      {
        type: "roll-mode",
        roll: "check",
        mode: "advantage",
        when: [
          { type: "on-ability-check" },
          { type: "ability-is", abilities: ["dex"] },
          { type: "skill-is", skills: ["stealth"] }
        ]
      }
    ]
  },

  // `cloak-of-the-manta-ray` - underwater breathing and Swim Speed are not modeled.
  // `mantle-of-spell-resistance` - spell-save advantage would apply to every save.
  // `robe-of-eyes` - Perception advantage "that rely on sight", Darkvision and Truesight, and its Light/Daylight drawback.

  /**
   * A real DC 15 Wisdom save; the resolver reads Stunned from the description. Not modeled: the light,
   * the attack disadvantage for the duration, and the stun ending with the effect (the GM clears it).
   */
  "robe-of-scintillating-colors": {
    actions: [
      {
        id: "dazzle",
        name: "Scintillating Colors",
        activation: "action",
        description:
          "Expend 1 charge to make the garment display a shifting pattern of dazzling hues until the end of your next turn. During this time, the robe sheds Bright Light in a 30-foot radius and Dim Light for an additional 30 feet, and creatures that can see you have Disadvantage on attack rolls against you. Any creature in the Bright Light that can see you when the robe's power is activated must succeed on a DC 15 Wisdom saving throw or have the Stunned condition until the effect ends.",
        save: { ability: "wis", dc: 15 },
        uses: { limit: 3, per: "long-rest", pool: "robe-of-scintillating-colors-charges" }
      }
    ]
  },

  // The level-5 Magic Missile stars and Astral travel are not expressible.
  "robe-of-stars": { modifiers: [{ type: "save-bonus", amount: 1 }] }

  // `robe-of-the-archmagi` - `spell-save-dc` would raise every printed DC on the sheet; spell attack
  //     bonus has no reader; the AC 15 + Dex base replacement and spell-save advantage are not expressible.

  // `robe-of-useful-items` - per-copy patches that become objects and creatures.
  // `wings-of-flying` - Fly Speed with a rolled 1d12-hour cooldown.
};
