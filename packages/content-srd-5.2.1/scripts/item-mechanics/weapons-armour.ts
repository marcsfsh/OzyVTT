/**
 * Riders for the magic items whose category is `weapon`, `armor`, `shield` or `ammunition`. A rider
 * is authored only where a consumer reads it and produces the printed effect; items left as prose are
 * listed at the end of this module with the reason.
 *
 * Magic weapons and armor carry no stats of their own: the player binds the item to a base item
 * (`appliesTo`) and the bound inventory row copies that base's block. `attack-bonus`, `damage-bonus`,
 * `extra-damage` and the crit riders default to `this-item` scope on a weapon-slot carrier, so "+N to
 * attack and damage rolls made with this magic weapon" is an unscoped `attack-bonus` + `damage-bonus`
 * pair. Do not set `scope: "bearer"` on these: two magic weapons in a pack would stack.
 *
 * Recurring limits:
 *   - `damage-bonus` is bounded to +/-10.
 *   - `versus-creature-type` is inert: nothing sets `RiderContext.targetCreatureType`.
 *   - `armor-class` is read in the standing pass, so it cannot be narrowed to a kind of attack.
 *   - An item's `grants.languages` reaches no reader.
 *
 * GM choices where the SRD prints a table: Armor of Resistance resists lightning (d10 row 5), Dragon
 * Scale Mail resists fire.
 */
import type { ItemMechanicsModule } from "./overlay.js";

export const WEAPONS_ARMOUR: ItemMechanicsModule = {
  // ---- Armor and shields: flat AC --------------------------------------------------------------
  // A standing bearer rider, so no armor block is needed. `whileArmored` is not set: the item is the armor.

  /** "You have a bonus to Armor Class while wearing this armor. The bonus is determined by its rarity." */
  "armor-1": { modifiers: [{ type: "armor-class", amount: 1 }] },
  "armor-2": { modifiers: [{ type: "armor-class", amount: 2 }] },
  "armor-3": { modifiers: [{ type: "armor-class", amount: 3 }] },

  /** "While holding this Shield, you have a bonus to Armor Class determined by the Shield's rarity, in addition to the Shield's normal bonus to AC." */
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
  }

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
};
