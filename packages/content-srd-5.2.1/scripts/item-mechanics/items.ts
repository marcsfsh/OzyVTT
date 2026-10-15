/**
 * Hand-authored riders for the generated magic items, keyed by item id. `build-magic-items.ts` merges
 * them into `magic-items.v1.json` through `./overlay.ts`; an item with no entry ships as prose only.
 *
 * A rider is authored only where a consumer reads it and produces the printed effect. Where an item
 * stays prose for a reason worth keeping, a comment in its section says why.
 */
import type { ItemMechanicsModule } from "./overlay.js";

export const ITEM_MECHANICS: ItemMechanicsModule = {
  // ==== Weapons, armor, shields and ammunition ====================================================
  //
  // Magic weapons and armor carry no stats of their own: the player binds the item to a base item
  // (`appliesTo`) and the bound inventory row copies that base's block. `attack-bonus`, `damage-bonus`,
  // `extra-damage` and the crit riders default to `this-item` scope on a weapon-slot carrier, so "+N to
  // attack and damage rolls made with this magic weapon" is an unscoped `attack-bonus` + `damage-bonus`
  // pair. Do not set `scope: "bearer"` on these: two magic weapons in a pack would stack.
  //
  // Recurring limits:
  //   - `damage-bonus` is bounded to +/-10.
  //   - `versus-creature-type` is inert: nothing sets `RiderContext.targetCreatureType`.
  //   - `armor-class` is read in the standing pass, so it cannot be narrowed to a kind of attack.
  //   - An item's `grants.languages` reaches no reader.
  //
  // GM choices where the SRD prints a table: Armor of Resistance resists lightning (d10 row 5), Dragon
  // Scale Mail resists fire.

  // ---- Armor and shields: flat AC --------------------------------------------------------------
  // A standing bearer rider, so it lands without the bound base armor's block. `whileArmored` is not
  // set: the item is the armor.

  /** "You have a bonus to Armor Class while wearing this armor. The bonus is determined by its rarity." */
  "armor-1": { modifiers: [{ type: "armor-class", amount: 1 }] },
  "armor-2": { modifiers: [{ type: "armor-class", amount: 2 }] },
  "armor-3": { modifiers: [{ type: "armor-class", amount: 3 }] },

  /**
   * "While holding this Shield, you have a bonus to Armor Class determined by the Shield's rarity, in
   * addition to the Shield's normal bonus to AC." The normal +2 is the shield armor block the ETL gives
   * every magic shield; this rider is the rarity bonus.
   */
  "shield-1": { modifiers: [{ type: "armor-class", amount: 1 }] },
  "shield-2": { modifiers: [{ type: "armor-class", amount: 2 }] },
  "shield-3": { modifiers: [{ type: "armor-class", amount: 3 }] },

  // Not modeled: the Reaction reducing forced movement.
  "dwarven-plate": { modifiers: [{ type: "armor-class", amount: 2 }] },

  // "Considered trained with this armor" is not authored: nothing penalises untrained armor.
  "elven-chain": { modifiers: [{ type: "armor-class", amount: 1 }] },

  "glamoured-studded-leather": { modifiers: [{ type: "armor-class", amount: 1 }] },

  // Not modeled: Forceful Bash (Strength-scaled damage, push/prone) and Protective Field (emanation).
  "shield-of-the-cavalier": { modifiers: [{ type: "armor-class", amount: 2 }] },

  /**
   * `cursed: true` is legal because the SRD gates this item behind attunement. Not modeled: Abyssal
   * (item language grants have no reader), the clawed Unarmed Strikes and their +1, Disadvantage
   * against demons, and tying the curse's lifting to Remove Curse.
   */
  "demon-armor": {
    cursed: true,
    modifiers: [{ type: "armor-class", amount: 1 }]
  },

  // Not modeled: Advantage on saves against dragon breath (no trigger names a save's source) and the dragon sense.
  "dragon-scale-mail": {
    grants: { damageResistances: ["fire"] },
    modifiers: [{ type: "armor-class", amount: 1 }]
  },

  // "The GM chooses the type": lightning, the d10 table's row 5.
  "armor-of-resistance": { grants: { damageResistances: ["lightning"] } },

  // Metal Shell (timed immunity, once per dawn) is not authored: a standing immunity grant would be permanent.
  "armor-of-invulnerability": { grants: { damageResistances: ["bludgeoning", "piercing", "slashing"] } },

  // The curse only. Resistance to ranged-weapon damage (resistance is by damage type) and the
  // redirect of nearby ranged attacks are not expressible.
  "shield-of-missile-attraction": { cursed: true },

  /**
   * The Perception half is gated on `ability-is: ["wis"]`, not `skill-is`: the server's Search check
   * carries no skill, so a skill gate would never fire. This also applies to Searches the SRD would
   * call Insight, Medicine or Survival.
   */
  "sentinel-shield": {
    modifiers: [
      { type: "roll-mode", roll: "initiative", mode: "advantage" },
      {
        type: "roll-mode",
        roll: "check",
        mode: "advantage",
        when: [{ type: "on-ability-check" }, { type: "ability-is", abilities: ["wis"] }]
      }
    ]
  },

  // "Until the next dawn" is a long rest.
  "plate-armor-of-etherealness": {
    casts: [{ spellId: "etherealness", uses: { limit: 1, per: "long-rest" } }]
  },

  // ---- Ammunition ------------------------------------------------------------------------------

  /**
   * Ammunition has no weapon block, so `attack-bonus` is bearer-scoped; the `when` pair limits it to
   * ranged attacks so melee swings are unaffected. It applies to all of the bearer's ranged attacks,
   * not only those using this ammunition. The damage half is not authored.
   */
  "ammunition-1": {
    modifiers: [
      {
        type: "attack-bonus",
        amount: 1,
        when: [{ type: "on-attack-roll" }, { type: "attack-kind-is", kinds: ["ranged"] }]
      }
    ]
  },
  "ammunition-2": {
    modifiers: [
      {
        type: "attack-bonus",
        amount: 2,
        when: [{ type: "on-attack-roll" }, { type: "attack-kind-is", kinds: ["ranged"] }]
      }
    ]
  },
  "ammunition-3": {
    modifiers: [
      {
        type: "attack-bonus",
        amount: 3,
        when: [{ type: "on-attack-roll" }, { type: "attack-kind-is", kinds: ["ranged"] }]
      }
    ]
  },

  // ---- Weapon rows whose riders are not weapon-scoped (plus their +N halves) -----------------------

  // Bearer only: the 30-foot ally aura and the surprise/sleep clause are not expressible.
  "weapon-of-warning": { modifiers: [{ type: "roll-mode", roll: "initiative", mode: "advantage" }] },

  // "On your person" is read as equipped. Not modeled: Luck (a reroll) and Wish (rolled charge count).
  "luck-blade": {
    modifiers: [
      { type: "save-bonus", amount: 1 },
      { type: "attack-bonus", amount: 1 },
      { type: "damage-bonus", amount: 1 }
    ]
  },

  // Not modeled: the light in freezing temperatures and extinguishing flames once per hour.
  "frost-brand": {
    grants: { damageResistances: ["fire"] },
    modifiers: [{ type: "extra-damage", formula: "1d6", damageType: "cold", doubleOnCritical: true }]
  },

  /**
   * Charges recharge fully on a long rest rather than 1d3 at dawn (no partial recovery shape). The
   * "Beast with a Swim Speed" target restriction stays prose.
   */
  "trident-of-fish-command": {
    casts: [{ spellId: "dominate-beast", saveDc: 15, uses: { limit: 3, per: "long-rest" } }]
  },

  // ---- +N weapon pairs and unconditional on-hit dice ---------------------------------------------

  // Uncommon +1, Rare +2, Very Rare +3: one row per tier.
  "weapon-1": {
    modifiers: [
      { type: "attack-bonus", amount: 1 },
      { type: "damage-bonus", amount: 1 }
    ]
  },
  "weapon-2": {
    modifiers: [
      { type: "attack-bonus", amount: 2 },
      { type: "damage-bonus", amount: 2 }
    ]
  },
  "weapon-3": {
    modifiers: [
      { type: "attack-bonus", amount: 3 },
      { type: "damage-bonus", amount: 3 }
    ]
  },

  // Not modeled: the Thrown property and range (the bound Warhammer block has neither), the ranged
  // 1d8 Force, the 2d8 against Giants.
  "dwarven-thrower": {
    modifiers: [
      { type: "attack-bonus", amount: 3 },
      { type: "damage-bonus", amount: 3 }
    ]
  },

  // Transferring the bonus to AC is not expressible; this is the untransferred default.
  defender: {
    modifiers: [
      { type: "attack-bonus", amount: 3 },
      { type: "damage-bonus", amount: 3 }
    ]
  },

  // Not modeled: ignoring Slashing resistance and the natural-20 decapitation (30 damage exceeds the range).
  "vorpal-sword": {
    modifiers: [
      { type: "attack-bonus", amount: 3 },
      { type: "damage-bonus", amount: 3 }
    ]
  },

  // Not modeled: 2d10 Radiant vs Fiends/Undead (creature-type gate) and the ally aura.
  "holy-avenger": {
    modifiers: [
      { type: "attack-bonus", amount: 3 },
      { type: "damage-bonus", amount: 3 }
    ]
  },

  // The Bonus Action attack is not modeled (`extra-attack` multiplies the Attack action instead).
  "scimitar-of-speed": {
    modifiers: [
      { type: "attack-bonus", amount: 2 },
      { type: "damage-bonus", amount: 2 }
    ]
  },

  // Life Stealing (rolled charges, crit + HP threshold + save trigger) is not expressible.
  "nine-lives-stealer": {
    modifiers: [
      { type: "attack-bonus", amount: 2 },
      { type: "damage-bonus", amount: 2 }
    ]
  },

  // Not modeled: Acrobatic Assist (gated on the item's current form), Attack Deflection, the form changes.
  "quarterstaff-of-the-acrobat": {
    modifiers: [
      { type: "attack-bonus", amount: 2 },
      { type: "damage-bonus", amount: 2 }
    ]
  },

  // The armed-then-discharged poison coating needs item state and is not modeled.
  "dagger-of-venom": {
    modifiers: [
      { type: "attack-bonus", amount: 1 },
      { type: "damage-bonus", amount: 1 }
    ]
  },

  // The extra 2d6 vs Giants needs a creature-type gate and a "weapon's type" damage.
  "giant-slayer": {
    modifiers: [
      { type: "attack-bonus", amount: 1 },
      { type: "damage-bonus", amount: 1 }
    ]
  },

  // The extra 3d6 vs Dragons needs a creature-type gate and a "weapon's type" damage.
  "dragon-slayer": {
    modifiers: [
      { type: "attack-bonus", amount: 1 },
      { type: "damage-bonus", amount: 1 }
    ]
  },

  // Not modeled: +3 vs Constructs (creature-type gate) and the crit-only 7 Bludgeoning.
  "mace-of-smiting": {
    modifiers: [
      { type: "attack-bonus", amount: 1 },
      { type: "damage-bonus", amount: 1 }
    ]
  },

  // Not modeled: the thrown thunderclap area, Giant's Bane and Might of Giants (cross-item triggers).
  "hammer-of-thunderbolts": {
    modifiers: [
      { type: "attack-bonus", amount: 1 },
      { type: "damage-bonus", amount: 1 }
    ]
  },

  // Not modeled: +1 HP per level (`hit-points-per-level` is refused on items) and the curse.
  "berserker-axe": {
    modifiers: [
      { type: "attack-bonus", amount: 1 },
      { type: "damage-bonus", amount: 1 }
    ]
  },

  // Authored always on: the command-word lit state is not modeled, and a drawn Flame Tongue in combat is lit.
  "flame-tongue": { modifiers: [{ type: "extra-damage", formula: "2d6", damageType: "fire", doubleOnCritical: true }] },

  // The "can't regain Hit Points" save is not expressible.
  "sword-of-wounding": {
    modifiers: [{ type: "extra-damage", formula: "2d6", damageType: "necrotic", doubleOnCritical: true }]
  },

  // Prose-only items:
  //   `javelin-of-lightning` - Lightning instead of Piercing, and a Line area.
  //   `mace-of-disruption` - the extra Radiant needs a creature-type gate.
  //   `sun-blade`, `energy-bow` - deal Radiant/Force instead of the weapon's type; unbound until
  //       weapon-swing overrides exist. Energy Bow's arrow options are not expressible either.
  //   `vicious-weapon` - extra damage "of the same type as the weapon" (`extra-damage` needs a type).
  //   `spellguard-shield` - needs a "spell" attack kind and an "against spells" save gate.
  //   `thunderous-greatclub` - "your Strength is 20" is `ability-score`, refused on items; areas.
  //   `adamantine-armor` - no rider suppresses an incoming critical hit.
  //   `mithral-armor` - no rider removes a base armor's stealth disadvantage or Strength requirement.
  //   `animated-shield` - hands-free wielding is not modeled.
  //   `arrow-catching-shield` - an AC bonus cannot be limited to ranged attacks.
  //   `dancing-sword` - no detached-attacker model.
  //   `mace-of-terror` - an area Frightened effect; item actions have no radius.
  //   `ammunition-of-slaying` - entirely gated on creature type.
  //   `oathbow` - everything is gated on a player-declared sworn enemy.
  //   `sword-of-life-stealing`, `sword-of-sharpness` - crit damage of 15 and 14 exceeds the range.
  //   `armor-of-vulnerability` - no `grants.damageVulnerabilities`; authoring only the resistance
  //       would make the cursed item strictly better than plain armor.

  // ==== Wands, staffs, rods, rings and the spell scroll ===========================================
  //
  // Recurring limits:
  //   - One use spends exactly one charge, so only one-charge properties are authored.
  //   - "Regains 1d6 + 1 expended charges daily at dawn" becomes a full recharge on a long rest.
  //   - Use pools are capped at 20.
  //   - Staffs and rods have no weapon block, so "+N to attack and damage rolls made with it" would be
  //     bearer-scoped (every weapon) or inert; it is not authored.
  //   - An item action's to-hit is ability-derived; a printed flat attack bonus cannot be said.
  //   - `castAction` takes a cast's damage and attack from the spell record's `damage`/`attackRoll`
  //     columns, which describe the spell's text rather than one cast: healing spells become Force
  //     damage, Magic Missile rolls one dart, Web always deals its fire damage, and Faerie Fire,
  //     Protection from Evil and Good and Ray of Enfeeblement gain an attack roll. Those casts are not
  //     authored.
  //   - `spell-attack-bonus` has no reader (the overlay refuses it), and no "spell" attack kind is
  //     ever announced.

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
        save: { ability: "dex", dc: 15, successDamage: "half", failureCondition: null },
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

  "rod-of-rulership": {
    actions: [
      {
        id: "command-obedience",
        name: "Command Obedience",
        activation: "action",
        description:
          "Present the rod and command obedience from each creature of your choice that you can see within 120 feet. Each target must succeed on a DC 15 Wisdom saving throw or have the Charmed condition for 8 hours. If harmed by you or your allies, or commanded to do something contrary to its nature, a target ceases to be Charmed in this way.",
        save: { ability: "wis", dc: 15, successDamage: "none", failureCondition: "charmed" },
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
   * The two standalone properties, each with its own once-per-dawn counter. The on-hit properties and the
   * +2 Quarterstaff need a weapon block.
   */
  "staff-of-thunder-and-lightning": {
    actions: [
      {
        id: "lightning-strike",
        name: "Lightning Strike",
        activation: "action",
        description:
          "A bolt of lightning leaps from the staff's tip in a Line 5 feet wide and 120 feet long. Each creature in that Line makes a DC 17 Dexterity saving throw, taking 9d6 Lightning damage on a failed save or half as much damage on a successful one.",
        save: { ability: "dex", dc: 17, successDamage: "half", failureCondition: null },
        damage: [{ formula: "9d6", type: "lightning" }],
        uses: { limit: 1, per: "long-rest" }
      },
      {
        id: "thunderclap",
        name: "Thunderclap",
        activation: "action",
        description:
          "The staff produces a thunderclap audible out to 600 feet. Every creature within a 60-foot Emanation originating from you makes a DC 17 Constitution saving throw. On a failed save, a creature takes 2d6 Thunder damage and has the Deafened condition for 1 minute. On a successful save, a creature takes half as much damage only.",
        save: { ability: "con", dc: 17, successDamage: "half", failureCondition: "deafened" },
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

  // The wand's own effect.
  "wand-of-paralysis": {
    actions: [
      {
        id: "paralyzing-ray",
        name: "Paralyzing Ray",
        activation: "action",
        description:
          "Expend 1 charge to send a thin blue ray toward a creature you can see within 60 feet. The target must succeed on a DC 15 Constitution saving throw or have the Paralyzed condition for 1 minute. At the end of each of its turns, it repeats the save, ending the effect on itself on a success.",
        save: { ability: "con", dc: 15, successDamage: "none", failureCondition: "paralyzed" },
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
  },

  // ==== Worn wondrous items (slot neck, shoulders, head, feet, hands or belt) =====================
  //
  // Recurring limits:
  //   - Check advantage fires only on checks the server rolls with a matching narrow: Hide carries
  //     `{dex, stealth}`, while Search/Study/Influence carry only an ability. "Advantage on Dexterity
  //     (Stealth) checks" is authorable; qualified clauses ("that rely on sight") are not.
  //   - `speed`, `darkvision` and `sense` reach nothing from an item (the overlay refuses them).
  //   - A save cannot be narrowed to what it is against, so "Advantage on saves against spells" or
  //     "to avoid the Poisoned condition" would apply to every save.
  //   - No `per` value means "never recharges", so consumable charges (beads, crumbling scarabs,
  //     talismans destroyed on the last charge) cannot be authored.
  //   - Spell records describe the spell's text, not one cast (see the wands section), and there
  //     is no healing in the spell model.
  //   - `spell-save-dc` raises every save-bearing action on the sheet, including other items' printed
  //     DCs, not just the wearer's spell save DC.
  //   - `ability-score` and `hit-points-per-level` are refused on items.
  //
  // A charged item may be authored for its charge alone (count and recharge exact) when the GM can
  // already produce what the charge buys, as with `winged-boots` and `cloak-of-invisibility`.
  // Recharge "1dN at dawn" becomes a full refill on a long rest.

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
   * A real DC 15 Wisdom save that Stuns on a failure. Not modeled: the light, the attack disadvantage
   * for the duration, and the stun ending with the effect (the GM clears it).
   */
  "robe-of-scintillating-colors": {
    actions: [
      {
        id: "dazzle",
        name: "Scintillating Colors",
        activation: "action",
        description:
          "Expend 1 charge to make the garment display a shifting pattern of dazzling hues until the end of your next turn. During this time, the robe sheds Bright Light in a 30-foot radius and Dim Light for an additional 30 feet, and creatures that can see you have Disadvantage on attack rolls against you. Any creature in the Bright Light that can see you when the robe's power is activated must succeed on a DC 15 Wisdom saving throw or have the Stunned condition until the effect ends.",
        save: { ability: "wis", dc: 15, successDamage: "none", failureCondition: "stunned" },
        uses: { limit: 3, per: "long-rest", pool: "robe-of-scintillating-colors-charges" }
      }
    ]
  },

  // The level-5 Magic Missile stars and Astral travel are not expressible.
  "robe-of-stars": { modifiers: [{ type: "save-bonus", amount: 1 }] },

  // `robe-of-the-archmagi` - `spell-save-dc` would raise every printed DC on the sheet; spell attack
  //     bonus has no reader; the AC 15 + Dex base replacement and spell-save advantage are not expressible.

  // `robe-of-useful-items` - per-copy patches that become objects and creatures.
  // `wings-of-flying` - Fly Speed with a rolled 1d12-hour cooldown.

  // ==== Carried wondrous items (slot wondrous), potions and oils ==================================
  //
  // Recurring limits:
  //   - Consumed items cannot be authored: no `per` value means "never recharges", and an unpooled
  //     action would be unlimited. This rules out every potion and oil and most dusts, beads and gems.
  //   - `itemAction` keeps only `attack`, `save`, `damage` and `uses`; `onHit`, `grants` and the rest
  //     are dropped, so an item action cannot apply a timed effect or an on-hit condition.
  //   - An item's `effects` ignore `duration`, so "Resistance for 1 hour" would be permanent.
  //   - Spell records describe the spell's text, not one cast (see the wands section), and there
  //     is no healing or temporary-HP rider.
  //   - `halfOnSuccessFrom` reads "succeed ... or take X" as half on a success, where the SRD means none.
  //   - One use spends one charge, and pools are capped at 20.
  //   - `ability-score` is refused on items.
  //   - Item actions only resolve inside an encounter. Outside one, `iron-bands` (the only one with an
  //     attack) can still be rolled through the loose route, which spends no charge.
  //
  // A charged item may be authored for its charge alone (count and recharge exact) when the GM can
  // already produce what the charge buys: the elemental summons, `bag-of-tricks`, `gem-of-seeing`,
  // `pipes-of-the-sewers`, `cubic-gate` and `iron-bands`. Not when the sheet would then be wrong
  // (`pearl-of-power`). "Regains 1dN at dawn" becomes a full refill on a long rest.
  //
  // Trap items (`bag-of-devouring`, `potion-of-poison`, `dust-of-sneezing-and-choking`) are not
  // authored: a button naming the real effect would spoil the trap.

  // ---- Carried wondrous items (alphabetical, absences inline) ----------------------------------

  // `apparatus-of-the-crab` - a vehicle, not a rider.
  // `bag-of-beans` - a GM-rolled table (temp HP and an ability score among its rows).
  // `bag-of-devouring` - a trap with a percentage pull and instant death.
  // `bag-of-holding` - no capacity/container model (also `handy-haversack`, `efficient-quiver`, `portable-hole`).

  // Charge-alone: three pulls a day. Which beast (a 1d8 table per bag color) is the GM's.
  "bag-of-tricks": {
    actions: [
      {
        id: "pull",
        name: "Pull a Fuzzy Object",
        activation: "action",
        description:
          "Pull the fuzzy object from the bag and throw it up to 20 feet. When the object lands, it transforms into a creature determined by rolling on the table for the bag's color. The creature vanishes at the next dawn or when it is reduced to 0 Hit Points. It is Friendly to you and your allies and acts immediately after you on your Initiative count.",
        uses: { limit: 3, per: "long-rest", pool: "bag-of-tricks-charges" }
      }
    ]
  },

  // `bead-of-force` - destroyed on use, and its save sentence would be read as half on a success.
  // `bead-of-nourishment` - no hunger model.

  /**
   * The four elemental-commanding items (`bowl-of-commanding-water-elementals`,
   * `brazier-of-commanding-fire-elementals`, `censer-of-controlling-air-elementals`,
   * `stone-of-controlling-earth-elementals`): charge-alone at one use per dawn. The elemental itself
   * is added by the GM; nothing mints an actor. Each description follows its own row's wording.
   */
  "bowl-of-commanding-water-elementals": {
    actions: [
      {
        id: "summon",
        name: "Summon Water Elemental",
        activation: "action",
        description:
          "While this bowl is filled with water and you are within 5 feet of it, summon a Water Elemental. It appears in an unoccupied space as close to the bowl as possible, understands your languages, obeys your commands, and takes its turn immediately after you on your Initiative count. It disappears after 1 hour, when it dies, or when you dismiss it as a Bonus Action. The bowl can't be used this way again until the next dawn.",
        uses: { limit: 1, per: "long-rest", pool: "bowl-of-commanding-water-elementals-charges" }
      }
    ]
  },
  "brazier-of-commanding-fire-elementals": {
    actions: [
      {
        id: "summon",
        name: "Summon Fire Elemental",
        activation: "action",
        description:
          "While you are within 5 feet of this brazier, summon a Fire Elemental. It appears in an unoccupied space as close to the brazier as possible, understands your languages, obeys your commands, and takes its turn immediately after you on your Initiative count. It disappears after 1 hour, when it dies, or when you dismiss it as a Bonus Action. The brazier can't be used this way again until the next dawn.",
        uses: { limit: 1, per: "long-rest", pool: "brazier-of-commanding-fire-elementals-charges" }
      }
    ]
  },

  // `broom-of-flying` - Fly Speed is not modeled (also `carpet-of-flying`, `horseshoes-of-a-zephyr`).

  // `candle-of-invocation` - advantage on all D20 Tests while within its light; no light-area gate or burn-down duration.

  // One of the four elemental-commanding items; see the bowl.
  "censer-of-controlling-air-elementals": {
    actions: [
      {
        id: "summon",
        name: "Summon Air Elemental",
        activation: "action",
        description:
          "While gently swinging this censer, summon an Air Elemental. It appears in an unoccupied space as close to the censer as possible, understands your languages, obeys your commands, and takes its turn immediately after you on your Initiative count. It disappears after 1 hour, when it dies, or when you dismiss it as a Bonus Action. The censer can't be used this way again until the next dawn.",
        uses: { limit: 1, per: "long-rest", pool: "censer-of-controlling-air-elementals-charges" }
      }
    ]
  },

  // `chime-of-opening` - ten uses that never come back.

  /**
   * Scrying at the printed DC 17 (the save Scrying's target makes). Any `spell-save-dc` rider in the
   * loadout raises this, since that rider applies to every save-bearing action. The sensor and the
   * save-modifier table stay prose.
   *
   * The Mind Reading and Telepathy orbs' second spells are cast through an active Scrying's sensor;
   * nothing can gate a cast on another cast or a target on a sensor, so they are not authored.
   */
  "crystal-ball": {
    casts: [{ spellId: "scrying", saveDc: 17 }]
  },

  // Not modeled: Detect Thoughts through the sensor, and waiving its Concentration.
  "crystal-ball-of-mind-reading": {
    casts: [{ spellId: "scrying", saveDc: 17 }]
  },

  // Not modeled: Suggestion through the sensor, and telepathy near the sensor.
  "crystal-ball-of-telepathy": {
    casts: [{ spellId: "scrying", saveDc: 17 }]
  },

  // Truesight around the sensor is not modeled.
  "crystal-ball-of-true-seeing": {
    casts: [{ spellId: "scrying", saveDc: 17 }]
  },

  // `cube-of-force` - faces cost 1 to 5 charges; one-charge buttons would over-grant.

  // Gate and Plane Shift on one shared 3-charge pool. Which plane each side opens is the GM's.
  "cubic-gate": {
    casts: [
      { spellId: "gate", uses: { limit: 3, per: "long-rest", pool: "cubic-gate-charges" } },
      { spellId: "plane-shift", uses: { limit: 3, per: "long-rest", pool: "cubic-gate-charges" } }
    ]
  },

  // `decanter-of-endless-water` - the geyser save would be read as half on a success.
  // `deck-of-illusions` - illusions and card state are not modeled.
  // `dimensional-shackles` - prevents extradimensional movement, which is not modeled.
  // `dragon-orb` - multi-charge spells, a healing cast, a self-charm on attunement and a curse.

  // `dust-of-disappearance` - single use, rolled duration, area effect.
  // `dust-of-dryness` - consumed pinches; its damage is gated on creature type.
  // `dust-of-sneezing-and-choking` - single use, and a trap.
  // `efficient-quiver` - a container.
  // `efreeti-bottle` - a first-opening table governing later uses.
  // `elemental-gem` - single use.
  // `eversmoking-bottle` - obscurement is not modeled.
  // `feather-token` - six single-use tokens in one row.
  // `figurine-of-wondrous-power` - ten figurines, summons, multi-day cooldowns.
  // `folding-boat` - a vehicle.
  // `gem-of-brightness` - 50 non-renewing charges, a 5-charge option.

  // Charge-alone. Not cast as True Seeing (that spell targets someone you touch); the Truesight is narrated.
  "gem-of-seeing": {
    actions: [
      {
        id: "peer",
        name: "Peer Through the Gem",
        activation: "action",
        description:
          "Expend 1 charge. For the next 10 minutes, you have Truesight out to 120 feet when you peer through the gem.",
        uses: { limit: 3, per: "long-rest", pool: "gem-of-seeing-charges" }
      }
    ]
  },

  // `handy-haversack` - a container.
  // `hat-of-many-spells` - a cast gated on an Arcana check outcome with a wild-magic table.
  // `horn-of-blasting` - authorable except its 20% chance to explode and damage the user; authoring
  //     only the blast would make it strictly better than printed.
  // `horn-of-valhalla` - a 7-day cooldown, summoned berserkers, four metals in one row.
  // `horseshoes-of-a-zephyr` - movement and travel are not modeled.
  // `horseshoes-of-speed` - speed reaches nothing from an item, and it is worn by a horse.
  // `instant-fortress` - a building.
  // `ioun-stone` - fourteen stones in one row; a rider would grant all of them.

  /**
   * Its to-hit is printed as Dexterity + Proficiency Bonus, which is exactly the derived form. Not
   * modeled: Restrained on a hit (`onHit` is dropped), the DC 20 break check, and the bands being
   * destroyed when broken.
   */
  "iron-bands": {
    actions: [
      {
        id: "throw",
        name: "Throw the Bands",
        activation: "action",
        description:
          "Throw the sphere at a Huge or smaller creature you can see within 60 feet of yourself. As the sphere moves through the air, it opens into a tangle of metal bands. On a hit, the target has the Restrained condition until you take a Bonus Action to issue a command that releases it. Doing so or missing with the attack causes the bands to contract and become a sphere once more. A creature that can touch the bands, including the one Restrained, can take an action to make a DC 20 Strength (Athletics) check to break the iron bands. On a successful check, the item is destroyed, and the Restrained creature is freed. On a failed check, any further attempts made by that creature automatically fail until 24 hours have elapsed. Once the bands are used, they can't be used again until the next dawn.",
        attack: { ability: "dex", proficient: true, rangeFeet: 60 },
        uses: { limit: 1, per: "long-rest", pool: "iron-bands-charges" }
      }
    ]
  },

  // No limit on attempts, as printed. Not modeled: the trapping itself and the "native to another
  // plane" precondition (carried in the description for the GM).
  "iron-flask": {
    actions: [
      {
        id: "trap",
        name: "Trap a Creature",
        activation: "action",
        description:
          "Target a creature you can see within 60 feet of yourself. If the flask is empty and the target is native to a plane of existence other than the one you are on, the target must succeed on a DC 17 Wisdom saving throw or be trapped in the flask. Once trapped, a creature remains in the flask until released.",
        save: { ability: "wis", dc: 17, successDamage: "none", failureCondition: null }
      }
    ]
  },

  // `lantern-of-revealing` - no rider suppresses Invisible within a light radius.
  // `manual-of-bodily-health`, `manual-of-gainful-exercise`, `manual-of-quickness-of-action`,
  //     `tome-of-clear-thought`, `tome-of-leadership-and-influence`, `tome-of-understanding` - a
  //     permanent ability increase is a sheet edit, not a reversible item rider (and `ability-score`
  //     is refused on items).
  // `manual-of-golems` - crafting.
  // `marvelous-pigments` - GM fiat, consumed.
  // `mirror-of-life-trapping` - a passive save on anyone who sees their reflection.
  // `mysterious-deck` - GM-fiat cards; the death-save card has no reader.

  // `pearl-of-power` - no rider refunds a spent spell slot (`spell-slot` raises the maximum).

  /**
   * Spends a charge and puts a real DC 15 Wisdom save on the target that Frightens on a failure. Not
   * modeled: the 1-minute duration (the GM clears the condition), the
   * repeat save, and the 24-hour immunity after a success.
   */
  "pipes-of-haunting": {
    actions: [
      {
        id: "play",
        name: "Play the Pipes",
        activation: "action",
        description:
          "Expend 1 charge to play an eerie, spellbinding tune. Each creature of your choice within 30 feet of you must succeed on a DC 15 Wisdom saving throw or have the Frightened condition for 1 minute. A creature that fails the save repeats it at the end of each of its turns, ending the effect on itself on a success. A creature that succeeds on its save is immune to the effect of these pipes for 24 hours.",
        save: { ability: "wis", dc: 15, successDamage: "none", failureCondition: "frightened" },
        uses: { limit: 3, per: "long-rest", pool: "pipes-of-haunting-charges" }
      }
    ]
  },

  /**
   * Charge-alone, one action per swarm (the SRD allows 1-3 charges as one Bonus Action, so this is
   * slower than printed). The swarms and rat attitudes are the GM's; the save printed in the text is
   * made by the swarm, so it is not this action's `save`.
   */
  "pipes-of-the-sewers": {
    actions: [
      {
        id: "call",
        name: "Call a Swarm of Rats",
        activation: "action",
        description:
          "Play the pipes and expend 1 charge, calling forth one Swarm of Rats if enough rats are within half a mile of you to be called in this fashion (as determined by the GM). If there aren't enough rats to form a swarm, the charge is wasted. Called swarms move toward the music by the shortest available route but aren't under your control otherwise.",
        uses: { limit: 3, per: "long-rest", pool: "pipes-of-the-sewers-charges" }
      }
    ]
  },

  // `portable-hole` - a container.
  // `rope-of-climbing` - there is no climb check to gate its advantage on.

  // Unlimited, as printed. The escape check is not modeled.
  "rope-of-entanglement": {
    actions: [
      {
        id: "entangle",
        name: "Entangle",
        activation: "action",
        description:
          "Command the other end of the rope to dart forward and entangle one creature you can see within 20 feet of yourself. The target must succeed on a DC 15 Dexterity saving throw or have the Restrained condition. You can release the target by letting go of your end of the rope or by using a Bonus Action to repeat the command.",
        save: { ability: "dex", dc: 15, successDamage: "none", failureCondition: "restrained" }
      }
    ]
  },

  // The pairing with the other stone is not modeled.
  "sending-stones": {
    casts: [{ spellId: "sending", uses: { limit: 1, per: "long-rest", pool: "sending-stones-charges" } }]
  },

  // `sovereign-glue` - consumed ounces, GM fiat.
  // `sphere-of-annihilation` - a map hazard controlled by an Arcana check.

  // One of the four elemental-commanding items; this one's wording differs (no languages, placed within 30 feet).
  "stone-of-controlling-earth-elementals": {
    actions: [
      {
        id: "summon",
        name: "Summon Earth Elemental",
        activation: "action",
        description:
          "While touching this stone to the ground, summon an Earth Elemental. It appears in an unoccupied space you choose within 30 feet of yourself, obeys your commands, and takes its turn immediately after you on your Initiative count. It disappears after 1 hour, when it dies, or when you dismiss it as a Bonus Action. The stone can't be used this way again until the next dawn.",
        uses: { limit: 1, per: "long-rest", pool: "stone-of-controlling-earth-elementals-charges" }
      }
    ]
  },

  /**
   * "+1 bonus to ability checks and saving throws". The save half reaches the server's roll; the check
   * half reaches the sheet's skill rows but not the server's own builtin check rolls (Hide, Search...).
   */
  "stone-of-good-luck-luckstone": {
    modifiers: [
      { type: "check-bonus", amount: 1 },
      { type: "save-bonus", amount: 1 }
    ]
  }

  // `universal-solvent` - consumed ounces.
  // `well-of-many-worlds` - a rolled 1d8-hour cooldown and planar travel.
  // `wind-fan` - each reuse risks tearing it; authoring the cast alone would remove the risk.

  // Potions and oils: none authored. Each is consumed, which no `per` value can express.
};
