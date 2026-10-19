/**
 * Hand-authored riders for the generated magic items, keyed by item id. `build-magic-items.ts` merges
 * them into `magic-items.v1.json` through `./overlay.ts`; an item with no entry ships as prose only.
 *
 * A rider is authored only where a consumer reads it and produces the printed effect. Where an item
 * stays prose for a reason worth keeping, a comment in its section says why.
 */
import type { DamageType, Modifier } from "@vtt/schemas";
import type { ItemMechanics, ItemMechanicsModule } from "./overlay.js";

/** The d10 table Armor of Resistance and Ring of Resistance roll on for their type. */
/** Extra damage when the weapon hits a creature of one of these types ("an extra 3d6 damage of the weapon's type if the
 *  target is a Dragon"); with no `damageType` it is the weapon's own. */
function versusTypes(formula: string, creatureTypes: string[], damageType?: DamageType): Modifier {
  return {
    type: "extra-damage",
    formula,
    ...(damageType ? { damageType } : {}),
    doubleOnCritical: true,
    when: [{ type: "on-hit" }, { type: "versus-creature-type", creatureTypes }]
  };
}

const RESISTANCE_TABLE = [
  "acid",
  "cold",
  "fire",
  "force",
  "lightning",
  "necrotic",
  "poison",
  "psychic",
  "radiant",
  "thunder"
] satisfies DamageType[];

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
  //   - `versus-creature-type` reads the target's stat block, so a character target never matches one.
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

  // "You are considered trained with this armor even if you lack training with Medium or Heavy armor": training with
  // both weights while it is worn, since the chain is a Chain Shirt or Chain Mail.
  "elven-chain": { grants: { armor: ["medium", "heavy"] }, modifiers: [{ type: "armor-class", amount: 1 }] },

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
  // The dragon's kind sets the type; fire (a red dragon) until the GM picks.
  "dragon-scale-mail": {
    grants: { damageResistances: ["fire"] },
    damageTypeChoice: ["acid", "cold", "fire", "lightning", "poison"],
    modifiers: [{ type: "armor-class", amount: 1 }]
  },

  // "If the armor normally imposes Disadvantage on Dexterity (Stealth) checks or has a Strength requirement, the
  // mithral version of the armor doesn't."
  "mithral-armor": { removesArmorDrawbacks: true },

  // "The GM chooses the type or determines it randomly": lightning (the d10 table's row 5) until the GM picks.
  "armor-of-resistance": { grants: { damageResistances: ["lightning"] }, damageTypeChoice: RESISTANCE_TABLE },

  // Metal Shell (timed immunity, once per dawn) is not authored: a standing immunity grant would be permanent.
  "armor-of-invulnerability": { grants: { damageResistances: ["bludgeoning", "piercing", "slashing"] } },

  // Resistance to the type the GM picks per copy (bludgeoning until then), and the curse: attuning locks the armor
  // on and leaves Vulnerability to the other two while the curse holds, worn or not.
  "armor-of-vulnerability": {
    cursed: true,
    grants: { damageResistances: ["bludgeoning"] },
    damageTypeChoice: ["bludgeoning", "piercing", "slashing"],
    vulnerableToOtherChoices: true
  },

  // Kept as the curse alone: the SRD item is a trap, and the attunement lock is what springs it. The GM
  // applies the rest from the description, since neither half is expressible: resistance to ranged-weapon
  // damage (resistance goes by damage type alone) and the redirect of nearby ranged attacks.
  "shield-of-missile-attraction": { cursed: true },

  // Advantage on Initiative and on Wisdom (Perception) checks: a sheet roll, Search or the GM's call made with Perception.
  "sentinel-shield": {
    modifiers: [
      { type: "roll-mode", roll: "initiative", mode: "advantage" },
      {
        type: "roll-mode",
        roll: "check",
        mode: "advantage",
        when: [{ type: "on-ability-check" }, { type: "skill-is", skills: ["perception"] }]
      }
    ]
  },

  // "Spell attack rolls have Disadvantage against you." The Advantage on saves against spells and other magical
  // effects has no gate for a save's source and stays the GM's.
  "spellguard-shield": {
    modifiers: [
      {
        type: "roll-mode",
        roll: "incoming-attack",
        mode: "disadvantage",
        when: [{ type: "on-attack-roll" }, { type: "attack-kind-is", kinds: ["spell"] }]
      }
    ]
  },

  // "Until the next dawn" is a Long Rest.
  "plate-armor-of-etherealness": {
    casts: [{ spellId: "etherealness", uses: { limit: 1, per: "long-rest" } }]
  },

  // ---- Ammunition ------------------------------------------------------------------------------

  /**
   * Ammunition has no weapon block, so its riders are bearer-scoped; `weapon-property-is: ammunition`
   * limits them to shots from a launcher, so a thrown dagger or a spell gets nothing. The server applies them
   * only to a shot drawn from this row, which the piece's kind (its bound base) ties to its launchers.
   */
  "ammunition-1": {
    modifiers: [
      {
        type: "attack-bonus",
        amount: 1,
        when: [{ type: "on-attack-roll" }, { type: "weapon-property-is", properties: ["ammunition"] }]
      },
      {
        type: "damage-bonus",
        amount: 1,
        when: [{ type: "on-damage-roll" }, { type: "weapon-property-is", properties: ["ammunition"] }]
      }
    ]
  },
  "ammunition-2": {
    modifiers: [
      {
        type: "attack-bonus",
        amount: 2,
        when: [{ type: "on-attack-roll" }, { type: "weapon-property-is", properties: ["ammunition"] }]
      },
      {
        type: "damage-bonus",
        amount: 2,
        when: [{ type: "on-damage-roll" }, { type: "weapon-property-is", properties: ["ammunition"] }]
      }
    ]
  },
  "ammunition-3": {
    modifiers: [
      {
        type: "attack-bonus",
        amount: 3,
        when: [{ type: "on-attack-roll" }, { type: "weapon-property-is", properties: ["ammunition"] }]
      },
      {
        type: "damage-bonus",
        amount: 3,
        when: [{ type: "on-damage-roll" }, { type: "weapon-property-is", properties: ["ammunition"] }]
      }
    ]
  },

  // ---- Weapon rows whose riders are not weapon-scoped (plus their +N halves) -----------------------

  // Bearer only: the 30-foot ally aura and the surprise/sleep clause are not expressible.
  "weapon-of-warning": { modifiers: [{ type: "roll-mode", roll: "initiative", mode: "advantage" }] },

  // "On your person" is read as equipped. Luck rerolls a failed D20 Test once per dawn (`answer`). Wish casts on 1d3
  // charges rolled when the blade is added, which never come back; its once-a-dawn limit is the GM's.
  "luck-blade": {
    charges: { starting: "1d3" },
    casts: [{ spellId: "wish", uses: { limit: 3, per: "never", pool: "luck-blade-wish" } }],
    modifiers: [
      { type: "save-bonus", amount: 1 },
      { type: "attack-bonus", amount: 1 },
      { type: "damage-bonus", amount: 1 }
    ],
    actions: [
      {
        id: "luck",
        name: "Luck",
        activation: "other",
        description:
          "Reroll one failed D20 Test if you don't have the Incapacitated condition. You must use the second roll. Once used, this property can't be used again until the next dawn.",
        damage: [],
        uses: { limit: 1, per: "long-rest" },
        answer: {
          rolls: ["attack", "save", "check", "death-save"],
          when: "failure",
          notWhileIncapacitated: true,
          effect: { kind: "reroll" }
        }
      }
    ]
  },

  // Not modeled: the light in freezing temperatures and extinguishing flames once per hour.
  "frost-brand": {
    grants: { damageResistances: ["fire"] },
    modifiers: [{ type: "extra-damage", formula: "1d6", damageType: "cold", doubleOnCritical: true }]
  },

  /**
   * Charges recharge fully on a Long Rest: 1d3 at dawn has no partial-recovery shape. The
   * "Beast with a Swim Speed" target restriction stays prose.
   */
  "trident-of-fish-command": {
    charges: { regain: "1d3" },
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

  // On a rolled 20 the sword cuts off a head (`kills.beheads`): 30 Slashing more where it can't, and a creature with
  // Legendary Resistance left spends it. Not modeled: ignoring Resistance to Slashing damage.
  "vorpal-sword": {
    modifiers: [
      { type: "attack-bonus", amount: 3 },
      { type: "damage-bonus", amount: 3 }
    ],
    onHit: [{ conditions: [], naturalTwenty: true, kills: { beheads: true } }]
  },

  // Not modeled: the aura's Advantage on saves against spells for the wielder's allies.
  "holy-avenger": {
    modifiers: [
      { type: "attack-bonus", amount: 3 },
      { type: "damage-bonus", amount: 3 },
      versusTypes("2d10", ["fiend", "undead"], "radiant")
    ]
  },

  // The Bonus Action attack is not modeled (`extra-attack` multiplies the Attack action instead).
  "scimitar-of-speed": {
    modifiers: [
      { type: "attack-bonus", amount: 2 },
      { type: "damage-bonus", amount: 2 }
    ]
  },

  // Life Stealing: a rolled 20 against a creature under 100 Hit Points asks a DC 15 Constitution save, a failure
  // slaying it; Constructs and Undead succeed. Its 1d8 + 1 charges, one spent per slaying, are the GM's to count.
  "nine-lives-stealer": {
    modifiers: [
      { type: "attack-bonus", amount: 2 },
      { type: "damage-bonus", amount: 2 }
    ],
    onHit: [
      {
        conditions: [],
        naturalTwenty: true,
        save: { ability: "con", dc: 15 },
        kills: { hitPointsUnder: 100, exceptCreatureTypes: ["construct", "undead"] }
      }
    ]
  },

  // Attack Deflection's +5 AC is offered on a hit, once per rest, and its glow ("Dim Light out to 10 feet") is lit and
  // put out on the row. Not modeled: the form changes, which would gate it and Acrobatic Assist (prose) to the
  // Quarterstaff form.
  "quarterstaff-of-the-acrobat": {
    modifiers: [
      { type: "attack-bonus", amount: 2 },
      { type: "damage-bonus", amount: 2 }
    ],
    actions: [
      {
        id: "attack-deflection",
        name: "Attack Deflection",
        activation: "reaction",
        description:
          "When you are hit by an attack while holding the weapon, take a Reaction to twirl it around you and gain a +5 bonus to your Armor Class against the triggering attack, potentially causing it to miss. You can't use this property again until you finish a Short or Long Rest.",
        damage: [],
        uses: { limit: 1, per: "short-rest" },
        reaction: { trigger: "hit-by-attack", response: "ac-bonus", amount: 5 }
      }
    ],
    light: { brightFeet: 0, dimFeet: 10 }
  },

  // The coat is a Bonus Action once per dawn, an effect on the bearer that the dagger's next hit spends on its save.
  "dagger-of-venom": {
    modifiers: [
      { type: "attack-bonus", amount: 1 },
      { type: "damage-bonus", amount: 1 }
    ],
    actions: [
      {
        id: "coat-blade",
        name: "Coat the Blade",
        activation: "bonus-action",
        description:
          "Coat the blade with poison. It remains for 1 minute or until an attack using this weapon hits a creature, which must succeed on a DC 15 Constitution saving throw or take 2d10 Poison damage and have the Poisoned condition for 1 minute.",
        damage: [],
        uses: { limit: 1, per: "long-rest" },
        grants: { name: "Dagger of Venom: coated", tags: ["venom-coat"], duration: { type: "rounds", rounds: 10 } }
      }
    ],
    onHit: [
      {
        conditions: [{ id: "poisoned" }],
        duration: { type: "rounds", rounds: 10 },
        spendsEffectTag: "venom-coat",
        save: { ability: "con", dc: 15, failureDamage: [{ formula: "2d10", type: "poison" }] }
      }
    ]
  },

  // The extra 2d6 of the weapon's type against a Giant, and the Giant's DC 15 Strength save against Prone.
  "giant-slayer": {
    modifiers: [
      { type: "attack-bonus", amount: 1 },
      { type: "damage-bonus", amount: 1 },
      versusTypes("2d6", ["giant"])
    ],
    onHit: [{ conditions: [{ id: "prone" }], creatureTypes: ["giant"], save: { ability: "str", dc: 15 } }]
  },

  // "The weapon deals an extra 3d6 damage of the weapon's type if the target is a Dragon."
  "dragon-slayer": {
    modifiers: [
      { type: "attack-bonus", amount: 1 },
      { type: "damage-bonus", amount: 1 },
      versusTypes("3d6", ["dragon"])
    ]
  },

  // +3 against a Construct, and 7 Bludgeoning more on a rolled 20 (14 against a Construct), never on a crit from a wider
  // range; a mace's damage is Bludgeoning, so a flat bonus carries it.
  "mace-of-smiting": {
    modifiers: [
      { type: "attack-bonus", amount: 1 },
      { type: "damage-bonus", amount: 1 },
      {
        type: "attack-bonus",
        amount: 2,
        when: [{ type: "on-attack-roll" }, { type: "versus-creature-type", creatureTypes: ["construct"] }]
      },
      {
        type: "damage-bonus",
        amount: 2,
        when: [{ type: "on-hit" }, { type: "versus-creature-type", creatureTypes: ["construct"] }]
      },
      { type: "damage-bonus", amount: 7, when: [{ type: "on-natural-20" }] },
      {
        type: "damage-bonus",
        amount: 7,
        when: [{ type: "on-natural-20" }, { type: "versus-creature-type", creatureTypes: ["construct"] }]
      }
    ],
    // "If a Construct has 25 Hit Points or fewer after taking this damage, it is destroyed."
    onHit: [{ conditions: [], naturalTwenty: true, creatureTypes: ["construct"], kills: { afterHitAtOrBelow: 25 } }]
  },

  // "When you hit a Fiend or an Undead with this magic weapon, that creature takes an extra 2d6 Radiant damage. If the
  // target has 25 Hit Points or fewer after taking this damage, it must succeed on a DC 15 Wisdom saving throw or be
  // destroyed. On a successful save, the creature has the Frightened condition until the end of your next turn."
  // "While you hold this weapon, it sheds Bright Light in a 20-foot radius and Dim Light for an additional 20 feet."
  "mace-of-disruption": {
    modifiers: [versusTypes("2d6", ["fiend", "undead"], "radiant")],
    onHit: [
      {
        conditions: [{ id: "frightened" }],
        duration: { type: "until-source-turn-end" },
        creatureTypes: ["fiend", "undead"],
        save: { ability: "wis", dc: 15 },
        kills: { afterHitAtOrBelow: 25 }
      }
    ],
    light: { brightFeet: 20, dimFeet: 20, always: true }
  },

  // "An extra 2d6 damage to any creature it hits", of the weapon's own type.
  "vicious-weapon": {
    modifiers: [{ type: "extra-damage", formula: "2d6", doubleOnCritical: true, when: [{ type: "on-hit" }] }]
  },

  // Not modeled: the thrown thunderclap area, Giant's Bane and Might of Giants (cross-item triggers).
  "hammer-of-thunderbolts": {
    modifiers: [
      { type: "attack-bonus", amount: 1 },
      { type: "damage-bonus", amount: 1 }
    ]
  },

  // The curse's attunement lock is authored (SRD: attunement to a cursed item can't be ended voluntarily), and its
  // berserk save is the server's (`berserker-axe.ts`). Not modeled: +1 HP per level (`hit-points-per-level` is refused
  // on items).
  "berserker-axe": {
    cursed: true,
    modifiers: [
      { type: "attack-bonus", amount: 1 },
      { type: "damage-bonus", amount: 1 }
    ]
  },

  // Its flames are lit and put out on the row (a Bonus Action): ablaze, it deals 2d6 Fire more and sheds light.
  "flame-tongue": {
    modifiers: [{ type: "extra-damage", formula: "2d6", damageType: "fire", doubleOnCritical: true }],
    light: { brightFeet: 40, dimFeet: 40, ridersWhileLit: true }
  },

  // The DC 15 Constitution save against healing, repeated at the end of each of the target's turns. Its hour outlasts
  // any fight, so the effect lasts until the save ends it.
  "sword-of-wounding": {
    modifiers: [{ type: "extra-damage", formula: "2d6", damageType: "necrotic", doubleOnCritical: true }],
    onHit: [
      { conditions: [], name: "Wounded", tags: ["no-healing"], save: { ability: "con", dc: 15, repeatSave: true } }
    ]
  },

  // An extra 14 Slashing damage (two 7s: one flat bonus stops at 10) and a level of Exhaustion on a rolled 20. Not
  // modeled: maximized damage against an object.
  "sword-of-sharpness": {
    modifiers: [
      { type: "damage-bonus", amount: 7, when: [{ type: "on-natural-20" }] },
      { type: "damage-bonus", amount: 7, when: [{ type: "on-natural-20" }] }
    ],
    onHit: [{ conditions: [{ id: "exhaustion", level: 1 }], naturalTwenty: true }]
  },

  // A Longsword with Finesse that deals Radiant damage (its weapon block), +2, and 1d8 Radiant more against an Undead.
  // "While the blade exists, it sheds Bright Light in a 15-foot radius and Dim Light for an additional 15 feet. The
  // light is sunlight": the blade is made and put away on the row, lit or not. Not modeled: the radius its Magic action
  // adjusts.
  "sun-blade": {
    modifiers: [
      { type: "attack-bonus", amount: 2 },
      { type: "damage-bonus", amount: 2 },
      versusTypes("1d8", ["undead"], "radiant")
    ],
    light: { brightFeet: 15, dimFeet: 15, sunlight: true }
  },

  // Prose-only items:
  //   `javelin-of-lightning`: Lightning where the javelin deals Piercing, and a Line area.
  //   `energy-bow`: deals Force where the bow's own type would go; unbound until weapon-swing overrides exist. Its
  //       arrow options are not expressible either.
  //   `thunderous-greatclub` - "your Strength is 20" is `ability-score`, refused on items; areas.
  //   `adamantine-armor` - no rider suppresses an incoming critical hit.
  //   `mithral-armor` - no rider removes a base armor's stealth disadvantage or Strength requirement.
  //   `animated-shield` - hands-free wielding is not modeled.
  //   `arrow-catching-shield` - an AC bonus cannot be limited to ranged attacks.
  //   `dancing-sword` - no detached-attacker model.
  //   `mace-of-terror` - an area Frightened effect; item actions have no radius.
  //   `ammunition-of-slaying` - entirely gated on creature type.
  //   `oathbow` - everything is gated on a player-declared sworn enemy.
  //   `sword-of-life-stealing` - its 15 Necrotic on a rolled 20 also heals, and Constructs and Undead are spared.

  // ==== Wands, staffs, rods, rings and the spell scroll ===========================================
  //
  // Recurring limits:
  //   - One use spends exactly one charge, so only one-charge properties are authored.
  //   - "Regains 1d6 + 1 expended charges daily at dawn" is `charges.regain`, rolled on a Long Rest, and "if you
  //     expend the last charge, roll 1d20" is `charges.lastChargeRoll`. Charges count per carried copy.
  //   - Use pools are capped at 20.
  //   - A staff wielded as a Quarterstaff and the Rod of Lordly Might carry their base's weapon block
  //     (`build-magic-items.ts`), so "+N to attack and damage rolls made with it" is scoped to them, and a hit property
  //     is an action that rides the item's own melee hits (`ridesHit: melee-this-weapon`).
  //   - An item action's to-hit is ability-derived; a printed flat attack bonus cannot be said.
  //   - `castAction` takes a cast's damage and attack from the spell record's `damage`/`attackRoll`
  //     columns, which describe the spell's text as a whole: healing spells become Force
  //     damage, Magic Missile rolls one dart, Web always deals its fire damage, and Faerie Fire,
  //     Protection from Evil and Good and Ray of Enfeeblement gain an attack roll. Those casts are not
  //     authored.
  //   - `spell-attack-bonus` lands on the bearer's spell attacks while the item is held.

  // ---- Rings -----------------------------------------------------------------------------------

  /**
   * Three casts on one shared 3-charge pool at the printed DC. Speak with Animals forces no save, so it
   * carries no `saveDc`. "Fear (affects Beasts only)" refuses any other creature as a target.
   */
  "ring-of-animal-influence": {
    charges: { regain: "1d3" },
    casts: [
      {
        spellId: "animal-friendship",
        saveDc: 13,
        uses: { limit: 3, per: "long-rest", pool: "ring-of-animal-influence-charges" }
      },
      {
        spellId: "fear",
        saveDc: 13,
        uses: { limit: 3, per: "long-rest", pool: "ring-of-animal-influence-charges" },
        targets: { creatureTypes: ["beast"] }
      },
      { spellId: "speak-with-animals", uses: { limit: 3, per: "long-rest", pool: "ring-of-animal-influence-charges" } }
    ]
  },

  // `ring-of-djinni-summoning` - summoning a creature is not expressible.
  // `ring-of-elemental-command` - `versus-creature-type` is inert; the plane is a per-copy GM choice;
  // multi-charge spells.

  // "When you fail a Dexterity saving throw while wearing the ring, you can take a Reaction to expend 1 charge to
  // succeed on that save instead": offered on the wearer's failed Dexterity save.
  "ring-of-evasion": {
    charges: { regain: "1d3" },
    actions: [
      {
        id: "evade",
        name: "Evade",
        activation: "reaction",
        description:
          "When you fail a Dexterity saving throw while wearing the ring, you can take a Reaction to expend 1 charge to succeed on that save instead.",
        uses: { limit: 3, per: "long-rest", pool: "ring-of-evasion-charges" },
        answer: { rolls: ["save"], when: "failure", abilities: ["dex"], effect: { kind: "succeed" } }
      }
    ]
  },

  /** "When you fall while wearing this ring, you descend 60 feet per round and take no damage from falling." */
  "ring-of-feather-falling": { modifiers: [{ type: "movement", rule: "safe-fall" }] },

  // `ring-of-free-action` - a condition immunity cannot be limited to magical sources, and an absolute
  // one would refuse ordinary Restrained/Paralyzed effects. Ignoring difficult terrain is not modeled.

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
  // As Armor of Resistance: fire until the GM picks from the same d10 table.
  "ring-of-resistance": { grants: { damageResistances: ["fire"] }, damageTypeChoice: RESISTANCE_TABLE },

  /**
   * The two cantrips are at will; Shooting Stars is the ring's own effect, at its one-charge size.
   * Not authored: Faerie Fire (its spell record would add an attack roll), Lightning Spheres and the
   * 2-3 charge Shooting Stars (multi-charge).
   */
  "ring-of-shooting-stars": {
    charges: { regain: "1d6" },
    casts: [{ spellId: "dancing-lights" }, { spellId: "light" }],
    actions: [
      {
        id: "shooting-stars",
        name: "Shooting Stars",
        activation: "action",
        area: { shape: "cube", sizeFeet: 15, widthFeet: null },
        description:
          "Expend 1 charge to launch a glowing mote of light at a point within 60 feet. Each creature in a 15-foot Cube originating from that point makes a DC 15 Dexterity saving throw, taking 5d4 Radiant damage on a failed save or half as much damage on a successful one.",
        save: { ability: "dex", dc: 15, successDamage: "half", failureConditions: [] },
        damage: [{ formula: "5d4", type: "radiant" }],
        uses: { limit: 6, per: "long-rest", pool: "ring-of-shooting-stars-charges" }
      }
    ]
  },

  // `ring-of-spell-storing` - needs per-copy storage and the original caster's numbers.
  // `ring-of-spell-turning` - no "save against a spell" filter; ungated it would apply to every save.
  /** "You have a Swim Speed of 40 feet while wearing this ring." */
  "ring-of-swimming": { modifiers: [{ type: "special-speed", movement: "swim", feet: 40 }] },

  /** "While wearing this ring, you can cast Telekinesis from it." At will, no charges, no DC override. */
  "ring-of-telekinesis": { casts: [{ spellId: "telekinesis" }] },

  // `ring-of-the-ram` - a flat +7 attack bonus and per-charge damage are not expressible.
  /** "you can expend 1 of its 3 charges to cast Wish from it": three Wishes in all, which never come back. The ring
   *  becoming nonmagical at the last is the GM's. */
  "ring-of-three-wishes": {
    casts: [{ spellId: "wish", uses: { limit: 3, per: "never", pool: "ring-of-three-wishes-charges" } }]
  },

  // `ring-of-warmth` - needs a damage-taken moment with dice-valued `damage-reduction`.

  /** "While wearing this ring, you cast Water Walk from it, targeting only yourself." Self-only is prose. */
  "ring-of-water-walking": { casts: [{ spellId: "water-walk" }] },

  /** "You can take a Magic action to gain X-ray vision with a range of 30 feet for 1 minute": walls don't block the
   *  wearer's sight within 30 feet. Not modeled: the Exhaustion save on a second use before a Long Rest, and the lead
   *  that still blocks it. */
  "ring-of-x-ray-vision": {
    actions: [
      {
        id: "x-ray-vision",
        name: "X-ray Vision",
        activation: "action",
        description:
          "Gain X-ray vision with a range of 30 feet for 1 minute: solid objects within that range appear transparent and don't prevent light from passing through them.",
        grants: {
          name: "X-ray Vision",
          tags: ["x-ray-vision"],
          duration: { type: "rounds", rounds: 10 },
          modifiers: [{ type: "sense", sense: "x-ray", feet: 30 }]
        }
      }
    ]
  },

  // ---- Rods ------------------------------------------------------------------------------------

  // `immovable-rod`: acts on the world and on no creature; a GM ruling.
  // `rod-of-absorption` - needs per-copy storage and a spell slot refund.

  /**
   * Initiative and Wisdom (Perception) advantage, four at-will detection casts, and the Protective Aura's
   * once-per-dawn counter (the ally buff is prose).
   */
  "rod-of-alertness": {
    modifiers: [
      { type: "roll-mode", roll: "initiative", mode: "advantage" },
      {
        type: "roll-mode",
        roll: "check",
        mode: "advantage",
        when: [{ type: "on-ability-check" }, { type: "skill-is", skills: ["perception"] }]
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
        uses: { limit: 1, per: "long-rest" },
        // The planted rod's light, set down where its holder stands for 10 minutes.
        sight: { light: { on: "point", brightFeet: 60, dimFeet: 60 }, rounds: 100 }
      }
    ]
  },

  // A +3 Mace, Drain Life and Paralyze on its melee hits, and Terrify. Not modeled: the buttons that turn it into
  // other weapons and tools (one record, one weapon block), and Drain Life's healing, said with the hit.
  "rod-of-lordly-might": {
    modifiers: [
      { type: "attack-bonus", amount: 3 },
      { type: "damage-bonus", amount: 3 }
    ],
    actions: [
      {
        id: "drain-life",
        name: "Drain Life",
        activation: "other",
        description:
          "When you hit a creature with a melee attack using the rod, force it to make a DC 17 Constitution saving throw. On a failed save, it takes an extra 4d6 Necrotic damage, and you regain Hit Points equal to half that damage.",
        save: { ability: "con", dc: 17, successDamage: "none", failureConditions: [] },
        damage: [{ formula: "4d6", type: "necrotic" }],
        uses: { limit: 1, per: "long-rest" },
        ridesHit: {
          rides: "melee-this-weapon",
          reminder: "On a failed save you regain Hit Points equal to half the Necrotic damage it takes."
        }
      },
      {
        id: "paralyze",
        name: "Paralyze",
        activation: "other",
        description:
          "When you hit a creature with a melee attack using the rod, force it to make a DC 17 Constitution saving throw. On a failed save, it has the Paralyzed condition for 1 minute, repeating the save at the end of each of its turns.",
        save: {
          ability: "con",
          dc: 17,
          successDamage: "none",
          failureConditions: ["paralyzed"],
          failureDuration: { type: "rounds", rounds: 10 },
          repeatSave: true
        },
        damage: [],
        uses: { limit: 1, per: "long-rest" },
        ridesHit: { rides: "melee-this-weapon" }
      },
      {
        id: "terrify",
        name: "Terrify",
        activation: "action",
        description:
          "Each creature you can see within 30 feet makes a DC 17 Wisdom saving throw. On a failed save, it has the Frightened condition for 1 minute, repeating the save at the end of each of its turns.",
        save: {
          ability: "wis",
          dc: 17,
          successDamage: "none",
          failureConditions: ["frightened"],
          failureDuration: { type: "rounds", rounds: 10 },
          repeatSave: true
        },
        damage: [],
        uses: { limit: 1, per: "long-rest" },
        targets: { rangeFeet: 30, seen: true, who: "others" }
      }
    ]
  },

  /** Heal for 1 charge and Resurrection for 5, on 5 charges that come back one at dawn; a 1 on the last charge's d20 and
   *  the rod disappears. */
  "rod-of-resurrection": {
    charges: { regain: "1", lastChargeRoll: true, lastCharge: "destroyed" },
    casts: [
      { spellId: "heal", uses: { limit: 5, per: "long-rest", pool: "rod-of-resurrection-charges" } },
      { spellId: "resurrection", useCost: 5, uses: { limit: 5, per: "long-rest", pool: "rod-of-resurrection-charges" } }
    ]
  },

  "rod-of-rulership": {
    actions: [
      {
        id: "command-obedience",
        name: "Command Obedience",
        activation: "action",
        description:
          "Present the rod and command obedience from each creature of your choice that you can see within 120 feet. Each target must succeed on a DC 15 Wisdom saving throw or have the Charmed condition for 8 hours. If harmed by you or your allies, or commanded to do something contrary to its nature, a target ceases to be Charmed in this way.",
        save: { ability: "wis", dc: 15, successDamage: "none", failureConditions: ["charmed"] },
        uses: { limit: 1, per: "long-rest" },
        targets: { rangeFeet: 120, seen: true }
      }
    ]
  },

  // `rod-of-security` - no plane model, and "once per 10 days" is not a `per` value.

  // ---- The scroll ------------------------------------------------------------------------------

  // One spell per carried copy, of any level, picked when it is added; the DC and attack bonus come from
  // the scroll table by the spell's level (the server's `scrolls.ts`).
  "spell-scroll": { spellScroll: { minLevel: 0, maxLevel: 9 }, consumedOnUse: true },

  // ---- Staffs ----------------------------------------------------------------------------------

  // All three one-charge casts on one pool. No `saveDc`: the cast uses the wielder's own DC, as
  // printed. Resist Enchantment turns a failed save against an Enchantment spell aimed only at the holder into a
  // success once a day. Not modeled: Reflect Enchantment (turning the spell back on its caster).
  "staff-of-charming": {
    charges: { regain: "1d8 + 2", lastChargeRoll: true, lastCharge: "destroyed" },
    actions: [
      {
        id: "resist-enchantment",
        name: "Resist Enchantment",
        activation: "other",
        description:
          "If you fail a saving throw against an Enchantment spell that targets only you, you can turn your failed save into a successful one. You can't use this property of the staff again until the next dawn.",
        damage: [],
        uses: { limit: 1, per: "long-rest" },
        answer: {
          rolls: ["save"],
          when: "failure",
          versus: { spellSchools: ["enchantment"], singleTarget: true },
          effect: { kind: "succeed" }
        }
      }
    ],
    casts: [
      { spellId: "charm-person", uses: { limit: 10, per: "long-rest", pool: "staff-of-charming-charges" } },
      { spellId: "command", uses: { limit: 10, per: "long-rest", pool: "staff-of-charming-charges" } },
      { spellId: "comprehend-languages", uses: { limit: 10, per: "long-rest", pool: "staff-of-charming-charges" } }
    ]
  },

  // Each spell at its printed charge cost, with the wielder's spell save DC.
  "staff-of-fire": {
    charges: { regain: "1d6 + 4", lastChargeRoll: true, lastCharge: "destroyed" },
    grants: { damageResistances: ["fire"] },
    casts: [
      { spellId: "burning-hands", uses: { limit: 10, per: "long-rest", pool: "staff-of-fire-charges" } },
      { spellId: "fireball", useCost: 3, uses: { limit: 10, per: "long-rest", pool: "staff-of-fire-charges" } },
      { spellId: "wall-of-fire", useCost: 4, uses: { limit: 10, per: "long-rest", pool: "staff-of-fire-charges" } }
    ]
  },

  // Each spell at its printed charge cost, with the wielder's spell save DC.
  "staff-of-frost": {
    charges: { regain: "1d6 + 4", lastChargeRoll: true, lastCharge: "destroyed" },
    grants: { damageResistances: ["cold"] },
    casts: [
      { spellId: "fog-cloud", uses: { limit: 10, per: "long-rest", pool: "staff-of-frost-charges" } },
      { spellId: "cone-of-cold", useCost: 5, uses: { limit: 10, per: "long-rest", pool: "staff-of-frost-charges" } },
      { spellId: "ice-storm", useCost: 4, uses: { limit: 10, per: "long-rest", pool: "staff-of-frost-charges" } },
      { spellId: "wall-of-ice", useCost: 4, uses: { limit: 10, per: "long-rest", pool: "staff-of-frost-charges" } }
    ]
  },

  /** Cure Wounds at 1 charge per spell level up to 4, Lesser Restoration for 2 and Mass Cure Wounds for 5, with the
   *  wielder's spellcasting ability; a 1 on the last charge's d20 and the staff vanishes. */
  "staff-of-healing": {
    charges: { regain: "1d6 + 4", lastChargeRoll: true, lastCharge: "destroyed" },
    casts: [
      {
        spellId: "cure-wounds",
        chargesRaiseLevel: 4,
        uses: { limit: 10, per: "long-rest", pool: "staff-of-healing-charges" }
      },
      {
        spellId: "lesser-restoration",
        useCost: 2,
        uses: { limit: 10, per: "long-rest", pool: "staff-of-healing-charges" }
      },
      {
        spellId: "mass-cure-wounds",
        useCost: 5,
        uses: { limit: 10, per: "long-rest", pool: "staff-of-healing-charges" }
      }
    ]
  },

  /**
   * The +2 Quarterstaff, the AC, save and spell attack bonuses, and the spells at their printed charge costs on 20
   * charges; a 20 on the last charge's d20 gives back 1d8 + 2, and a 1 (keeping only the +2 to attack and damage) is
   * the GM's. Not authored: Retributive Strike (damage from the live charge count).
   */
  "staff-of-power": {
    modifiers: [
      { type: "attack-bonus", amount: 2 },
      { type: "damage-bonus", amount: 2 },
      { type: "armor-class", amount: 2 },
      { type: "save-bonus", amount: 2 },
      { type: "spell-attack-bonus", amount: 2 }
    ],
    charges: { regain: "2d8 + 4", lastChargeRoll: true, lastChargeTwenty: "1d8 + 2" },
    casts: [
      { spellId: "cone-of-cold", useCost: 5, uses: { limit: 20, per: "long-rest", pool: "staff-of-power-charges" } },
      {
        spellId: "fireball",
        atLevel: 5,
        useCost: 5,
        uses: { limit: 20, per: "long-rest", pool: "staff-of-power-charges" }
      },
      {
        spellId: "globe-of-invulnerability",
        useCost: 6,
        uses: { limit: 20, per: "long-rest", pool: "staff-of-power-charges" }
      },
      { spellId: "hold-monster", useCost: 5, uses: { limit: 20, per: "long-rest", pool: "staff-of-power-charges" } },
      { spellId: "levitate", useCost: 2, uses: { limit: 20, per: "long-rest", pool: "staff-of-power-charges" } },
      {
        spellId: "lightning-bolt",
        atLevel: 5,
        useCost: 5,
        uses: { limit: 20, per: "long-rest", pool: "staff-of-power-charges" }
      },
      { spellId: "magic-missile", uses: { limit: 20, per: "long-rest", pool: "staff-of-power-charges" } },
      { spellId: "ray-of-enfeeblement", uses: { limit: 20, per: "long-rest", pool: "staff-of-power-charges" } },
      { spellId: "wall-of-force", useCost: 5, uses: { limit: 20, per: "long-rest", pool: "staff-of-power-charges" } }
    ]
  },

  // A +3 Quarterstaff whose melee hit can spend 1, 2 or 3 charges for 1d6 Force each: one rider per count on the one
  // pool, of which a hit takes one.
  "staff-of-striking": {
    charges: { regain: "1d6 + 4", lastChargeRoll: true },
    modifiers: [
      { type: "attack-bonus", amount: 3 },
      { type: "damage-bonus", amount: 3 }
    ],
    actions: [1, 2, 3].map((count) => ({
      id: `striking-${count}`,
      name: `Striking (${count} charge${count === 1 ? "" : "s"})`,
      activation: "other" as const,
      description: `When you hit with a melee attack using the staff, expend ${count} charge${count === 1 ? "" : "s"}: the target takes an extra ${count}d6 Force damage.`,
      damage: [{ formula: `${count}d6`, type: "force" }],
      uses: { limit: 10, per: "long-rest" as const, pool: "staff-of-striking-charges" },
      ...(count > 1 ? { useCost: count } : {}),
      ridesHit: { rides: "melee-this-weapon" as const }
    }))
  },

  // Insect Cloud: a Heavily Obscured Emanation round the holder, who sees through it. Giant Insect and Insect Plague at
  // their printed charge costs.
  "staff-of-swarming-insects": {
    charges: { regain: "1d6 + 4", lastChargeRoll: true, lastCharge: "destroyed" },
    casts: [
      {
        spellId: "giant-insect",
        useCost: 4,
        uses: { limit: 10, per: "long-rest", pool: "staff-of-swarming-insects-charges" }
      },
      {
        spellId: "insect-plague",
        useCost: 5,
        uses: { limit: 10, per: "long-rest", pool: "staff-of-swarming-insects-charges" }
      }
    ],
    actions: [
      {
        id: "insect-cloud",
        name: "Insect Cloud",
        activation: "action",
        area: { shape: "emanation", sizeFeet: 30, widthFeet: null },
        description:
          "Expend 1 charge to fill a 30-foot Emanation originating from you with a swarm of harmless flying insects. They remain for 10 minutes, making the area Heavily Obscured for creatures other than you. A strong wind disperses the swarm and ends the effect.",
        uses: { limit: 10, per: "long-rest", pool: "staff-of-swarming-insects-charges" },
        sight: { area: { kind: "heavily-obscured", aroundSelfFeet: 30, sparesUser: true }, rounds: 100 }
      }
    ]
  },

  /**
   * The +2 Quarterstaff, the +2 to spell attack rolls, the zero-charge casts, and the rest at their printed charge
   * costs on 50 charges; a 20 on the last charge's d20 gives back 1d12 + 1. Not authored: Advantage on saves against
   * spells, Spell Absorption and Retributive Strike.
   */
  "staff-of-the-magi": {
    modifiers: [
      { type: "attack-bonus", amount: 2 },
      { type: "damage-bonus", amount: 2 },
      { type: "spell-attack-bonus", amount: 2 }
    ],
    charges: { regain: "4d6 + 2", lastChargeRoll: true, lastChargeTwenty: "1d12 + 1" },
    casts: [
      { spellId: "arcane-lock" },
      { spellId: "detect-magic" },
      { spellId: "enlargereduce" },
      { spellId: "light" },
      { spellId: "protection-from-evil-and-good" },
      ...(
        [
          ["conjure-elemental", 7, undefined],
          ["dispel-magic", 3, undefined],
          ["fireball", 7, 7],
          ["flaming-sphere", 2, undefined],
          ["ice-storm", 4, undefined],
          ["invisibility", 2, undefined],
          ["knock", 2, undefined],
          ["lightning-bolt", 7, 7],
          ["passwall", 5, undefined],
          ["plane-shift", 7, undefined],
          ["telekinesis", 5, undefined],
          ["wall-of-fire", 4, undefined],
          ["web", 2, undefined]
        ] as const
      ).map(([spellId, useCost, atLevel]) => ({
        spellId,
        useCost,
        ...(atLevel !== undefined ? { atLevel } : {}),
        uses: { limit: 50, per: "long-rest" as const, pool: "staff-of-the-magi-charges" }
      }))
    ]
  },

  // `staff-of-the-python` - summoning a controlled creature is not expressible.

  // The +2 Quarterstaff, the spells at their printed charge costs on the 6-charge pool, Tree Form and the +2 to spell
  // attack rolls; a 1 on the last charge's d20 leaves a nonmagical Quarterstaff.
  "staff-of-the-woodlands": {
    modifiers: [
      { type: "attack-bonus", amount: 2 },
      { type: "damage-bonus", amount: 2 },
      { type: "spell-attack-bonus", amount: 2 }
    ],
    charges: { regain: "1d6", lastChargeRoll: true, lastCharge: { becomes: "quarterstaff" } },
    casts: [
      { spellId: "animal-friendship", uses: { limit: 6, per: "long-rest", pool: "staff-of-the-woodlands-charges" } },
      { spellId: "speak-with-animals", uses: { limit: 6, per: "long-rest", pool: "staff-of-the-woodlands-charges" } },
      ...(
        [
          ["awaken", 5],
          ["barkskin", 2],
          ["locate-animals-or-plants", 2],
          ["pass-without-trace", 2],
          ["speak-with-plants", 3],
          ["wall-of-thorns", 6]
        ] as const
      ).map(([spellId, useCost]) => ({
        spellId,
        useCost,
        uses: { limit: 6, per: "long-rest" as const, pool: "staff-of-the-woodlands-charges" }
      }))
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
   * The +2 Quarterstaff and its five properties, each with its own once-per-dawn counter: Lightning and Thunder ride a
   * melee hit, Thunder and Lightning does both as a Bonus Action after one, and the other two are actions.
   */
  "staff-of-thunder-and-lightning": {
    modifiers: [
      { type: "attack-bonus", amount: 2 },
      { type: "damage-bonus", amount: 2 }
    ],
    actions: [
      {
        id: "lightning",
        name: "Lightning",
        activation: "other",
        description:
          "When you hit with a melee attack using the staff, the target takes an extra 2d6 Lightning damage.",
        damage: [{ formula: "2d6", type: "lightning" }],
        uses: { limit: 1, per: "long-rest" },
        ridesHit: { rides: "melee-this-weapon" }
      },
      {
        id: "thunder",
        name: "Thunder",
        activation: "other",
        description:
          "When you hit with a melee attack using the staff, it emits a crack of thunder audible out to 300 feet. The target must succeed on a DC 17 Constitution saving throw or have the Stunned condition until the end of your next turn.",
        save: {
          ability: "con",
          dc: 17,
          successDamage: "none",
          failureConditions: ["stunned"],
          failureDuration: { type: "until-source-turn-end" }
        },
        damage: [],
        uses: { limit: 1, per: "long-rest" },
        ridesHit: { rides: "melee-this-weapon" }
      },
      {
        id: "thunder-and-lightning",
        name: "Thunder and Lightning",
        activation: "bonus-action",
        description:
          "Immediately after you hit with a melee attack using the staff, take a Bonus Action to use Lightning and Thunder at once, which spends neither of their daily uses.",
        damage: [{ formula: "2d6", type: "lightning" }],
        uses: { limit: 1, per: "long-rest" },
        ridesHit: {
          rides: "melee-this-weapon",
          saveDc: 17,
          effectRequired: true,
          effects: [
            {
              id: "thunder",
              name: "Thunder",
              save: {
                ability: "con",
                failureConditions: ["stunned"],
                failureDuration: { type: "until-source-turn-end" }
              }
            }
          ]
        }
      },
      {
        id: "lightning-strike",
        name: "Lightning Strike",
        activation: "action",
        description:
          "A bolt of lightning leaps from the staff's tip in a Line 5 feet wide and 120 feet long. Each creature in that Line makes a DC 17 Dexterity saving throw, taking 9d6 Lightning damage on a failed save or half as much damage on a successful one.",
        save: { ability: "dex", dc: 17, successDamage: "half", failureConditions: [] },
        damage: [{ formula: "9d6", type: "lightning" }],
        uses: { limit: 1, per: "long-rest" }
      },
      {
        id: "thunderclap",
        name: "Thunderclap",
        activation: "action",
        area: { shape: "emanation", sizeFeet: 60, widthFeet: null },
        description:
          "The staff produces a thunderclap audible out to 600 feet. Every creature within a 60-foot Emanation originating from you makes a DC 17 Constitution saving throw. On a failed save, a creature takes 2d6 Thunder damage and has the Deafened condition for 1 minute. On a successful save, a creature takes half as much damage only.",
        save: {
          ability: "con",
          dc: 17,
          successDamage: "half",
          failureConditions: ["deafened"],
          failureDuration: { type: "rounds", rounds: 10 }
        },
        damage: [{ formula: "2d6", type: "thunder" }],
        uses: { limit: 1, per: "long-rest" }
      }
    ]
  },

  // A Quarterstaff whose hit can spend a charge for 2d10 Necrotic and a DC 15 Constitution save. The failure's hour of
  // Disadvantage on Strength and Constitution checks and saves outlasts a fight, so it lasts until the GM ends it.
  "staff-of-withering": {
    charges: { regain: "1d3" },
    actions: [
      {
        id: "withering",
        name: "Withering",
        activation: "other",
        description:
          "On a hit with the staff, expend 1 charge to deal an extra 2d10 Necrotic damage to the target and force it to make a DC 15 Constitution saving throw. On a failed save, the target has Disadvantage for 1 hour on any ability check or saving throw that uses Strength or Constitution.",
        damage: [{ formula: "2d10", type: "necrotic" }],
        uses: { limit: 3, per: "long-rest", pool: "staff-of-withering-charges" },
        ridesHit: {
          rides: "this-weapon",
          saveDc: 15,
          effectRequired: true,
          effects: [
            {
              id: "withering",
              name: "Withering",
              save: {
                ability: "con",
                failureEffect: {
                  name: "Withered",
                  modifiers: [
                    {
                      type: "roll-mode",
                      roll: "check",
                      mode: "disadvantage",
                      when: [{ type: "on-ability-check" }, { type: "ability-is", abilities: ["str", "con"] }]
                    },
                    {
                      type: "roll-mode",
                      roll: "save",
                      mode: "disadvantage",
                      when: [{ type: "on-saving-throw" }, { type: "ability-is", abilities: ["str", "con"] }]
                    }
                  ]
                }
              }
            }
          ]
        }
      }
    ]
  },

  // ---- Wands -----------------------------------------------------------------------------------

  /** Hold Monster for 5 charges and Hold Person for 2, at DC 17; a 1 on the last charge's d20 and the wand crumbles. */
  "wand-of-binding": {
    charges: { regain: "1d6 + 1", lastChargeRoll: true, lastCharge: "destroyed" },
    casts: [
      {
        spellId: "hold-monster",
        saveDc: 17,
        useCost: 5,
        uses: { limit: 7, per: "long-rest", pool: "wand-of-binding-charges" }
      },
      {
        spellId: "hold-person",
        saveDc: 17,
        useCost: 2,
        uses: { limit: 7, per: "long-rest", pool: "wand-of-binding-charges" }
      }
    ]
  },

  // The detection is GM information; the charge is real.
  "wand-of-enemy-detection": {
    charges: { regain: "1d6 + 1", lastChargeRoll: true },
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
    charges: { regain: "1d6 + 1", lastChargeRoll: true, lastCharge: "destroyed" },
    casts: [{ spellId: "command", saveDc: 15, uses: { limit: 7, per: "long-rest", pool: "wand-of-fear-charges" } }]
  },

  /** Fireball at the printed DC 15 off a 7-charge pool: level 3 for 1 charge, one level higher for each charge after,
   *  up to 3. A 1 on the last charge's d20 and the wand crumbles. */
  "wand-of-fireballs": {
    charges: { regain: "1d6 + 1", lastChargeRoll: true, lastCharge: "destroyed" },
    casts: [
      {
        spellId: "fireball",
        saveDc: 15,
        chargesRaiseLevel: 3,
        uses: { limit: 7, per: "long-rest", pool: "wand-of-fireballs-charges" }
      }
    ]
  },

  /** The Fireball wand's twin: Lightning Bolt (save DC 15), levels 3 to 5 for 1 to 3 charges, on 7 charges. */
  "wand-of-lightning-bolts": {
    charges: { regain: "1d6 + 1", lastChargeRoll: true, lastCharge: "destroyed" },
    casts: [
      {
        spellId: "lightning-bolt",
        saveDc: 15,
        chargesRaiseLevel: 3,
        uses: { limit: 7, per: "long-rest", pool: "wand-of-lightning-bolts-charges" }
      }
    ]
  },

  /** "This wand has 3 charges. While holding it, you can expend 1 charge to cast Detect Magic from it." Complete. */
  "wand-of-magic-detection": {
    charges: { regain: "1d3" },
    casts: [{ spellId: "detect-magic", uses: { limit: 3, per: "long-rest", pool: "wand-of-magic-detection-charges" } }]
  },

  /** Magic Missile at levels 1 to 3 for 1 to 3 charges, on 7 charges; a 1 on the last charge's d20 and it crumbles. */
  "wand-of-magic-missiles": {
    charges: { regain: "1d6 + 1", lastChargeRoll: true, lastCharge: "destroyed" },
    casts: [
      {
        spellId: "magic-missile",
        chargesRaiseLevel: 3,
        uses: { limit: 7, per: "long-rest", pool: "wand-of-magic-missiles-charges" }
      }
    ]
  },

  // The wand's own effect.
  "wand-of-paralysis": {
    charges: { regain: "1d6 + 1", lastChargeRoll: true },
    actions: [
      {
        id: "paralyzing-ray",
        name: "Paralyzing Ray",
        activation: "action",
        description:
          "Expend 1 charge to send a thin blue ray toward a creature you can see within 60 feet. The target must succeed on a DC 15 Constitution saving throw or have the Paralyzed condition for 1 minute. At the end of each of its turns, it repeats the save, ending the effect on itself on a success.",
        save: {
          ability: "con",
          dc: 15,
          successDamage: "none",
          failureConditions: ["paralyzed"],
          failureDuration: { type: "rounds", rounds: 10 },
          repeatSave: true
        },
        uses: { limit: 7, per: "long-rest", pool: "wand-of-paralysis-charges" },
        targets: { count: 1, rangeFeet: 60, seen: true }
      }
    ]
  },

  /** "expend 1 charge to cast Polymorph (save DC 15) from it." One charge, one spell, printed DC. Complete. */
  "wand-of-polymorph": {
    charges: { regain: "1d6 + 1", lastChargeRoll: true },
    casts: [
      { spellId: "polymorph", saveDc: 15, uses: { limit: 7, per: "long-rest", pool: "wand-of-polymorph-charges" } }
    ]
  },

  "wand-of-secrets": {
    charges: { regain: "1d3" },
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

  // The bonus to spell attack rolls by rarity. Ignoring Half Cover on a spell attack is not authored: no rider sets
  // aside the target's cover.
  "wand-of-the-war-mage-1": { modifiers: [{ type: "spell-attack-bonus", amount: 1 }] },
  "wand-of-the-war-mage-2": { modifiers: [{ type: "spell-attack-bonus", amount: 2 }] },
  "wand-of-the-war-mage-3": { modifiers: [{ type: "spell-attack-bonus", amount: 3 }] },

  /** Web at DC 13 on 7 charges; the cast places the webs, whose saves come as creatures enter them. A 1 on the last
   *  charge's d20 and the wand crumbles. */
  "wand-of-web": {
    charges: { regain: "1d6 + 1", lastChargeRoll: true, lastCharge: "destroyed" },
    casts: [{ spellId: "web", saveDc: 13, uses: { limit: 7, per: "long-rest", pool: "wand-of-web-charges" } }]
  },

  // The d100 effect table is GM-rolled; the charge is real.
  "wand-of-wonder": {
    charges: { regain: "1d6 + 1", lastChargeRoll: true },
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
  //   - Spell records describe the spell's text as a whole (see the wands section), and there
  //     is no healing in the spell model.
  //   - `spell-save-dc` raises every save-bearing action on the sheet, including other items' printed
  //     DCs as well as the wearer's spell save DC.
  //   - `ability-score` and `hit-points-per-level` are refused on items.
  //
  // A charged item may be authored for its charge alone (count and recharge exact) when the GM can
  // already produce what the charge buys, as with `winged-boots` and `cloak-of-invisibility`.
  // Recharge "1dN at dawn" becomes a full refill on a Long Rest.

  // ---- Belt ------------------------------------------------------------------------------------

  /** "If you aren't a dwarf or duergar, you have Darkvision 60 feet, Resistance to Poison damage, and Advantage on
   *  saving throws to avoid or end the Poisoned condition": authored for every wearer, since a dwarf's own Darkvision
   *  (120 feet) and Dwarven Resilience already give it as much. Not modeled: Constitution +2 (`ability-score`,
   *  refused), Dwarvish (item languages have no reader), and the Persuasion Advantage with dwarves. */
  "belt-of-dwarvenkind": {
    grants: { damageResistances: ["poison"] },
    modifiers: [
      { type: "darkvision", feet: 60 },
      {
        type: "roll-mode",
        roll: "save",
        mode: "advantage",
        when: [{ type: "on-saving-throw" }, { type: "versus-condition", conditionIds: ["poisoned"] }]
      }
    ]
  },
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

  // "You can cast Levitate on yourself at will": the levitation lands on the wearer with no save to make against its
  // own boots, and the movement rules raise it 20 feet and let it move only as if climbing (`falling.ts`). It lasts
  // the spell's 10 minutes; ending it sooner (the spell's Concentration) is the wearer's, on the sheet.
  "boots-of-levitation": {
    actions: [
      {
        id: "levitate",
        name: "Levitate (Self)",
        activation: "action",
        description:
          "Cast Levitate on yourself: you rise up to 20 feet and stay suspended, moving only by pushing or pulling along a surface as if climbing. You can move up or down as part of your move. When it ends, you float gently to the ground. End it on your sheet.",
        damage: [],
        grants: {
          name: "Levitate",
          tags: ["levitating"],
          duration: { type: "minutes", minutes: 10 },
          modifiers: []
        }
      }
    ]
  },
  // `boots-of-speed` - doubled speed, a 10-minute budget, and opportunity-attack disadvantage (the
  //     defender's incoming-attack riders get no attack-kind filters).
  // `boots-of-striding-and-springing` - the speed floor and encumbrance are not modeled. "Once on each of your turns,
  // you can jump up to 30 feet by spending only 10 feet of movement": a leap the jump rules read.
  "boots-of-striding-and-springing": { modifiers: [{ type: "movement", rule: "leap", feet: 30, costFeet: 10 }] },
  /** "You have a Climb Speed equal to your Speed." Walls, ceilings and slippery surfaces are the GM's. */
  "slippers-of-spider-climbing": { modifiers: [{ type: "special-speed", movement: "climb", equalToSpeed: true }] },

  // Ungated in the SRD. Cold tolerance and ignoring ice or snow difficult terrain are not modeled.
  "boots-of-the-winterlands": { grants: { damageResistances: ["cold"] } },

  // 4 charges exact; the Fly Speed lasts an hour of game time.
  "winged-boots": {
    charges: { regain: "1d4" },
    actions: [
      {
        id: "fly",
        name: "Winged Flight",
        activation: "action",
        description:
          "Expend 1 charge to gain a Fly Speed of 30 feet for 1 hour. If you are flying when the duration expires, you descend at a rate of 30 feet per round until you land.",
        uses: { limit: 4, per: "long-rest", pool: "winged-boots-charges" },
        grants: {
          name: "Winged Flight",
          // "You descend at a rate of 30 feet per round until you land": the engine lowers a flier gently.
          tags: ["winged-flight", "descends-safely"],
          duration: { type: "minutes", minutes: 60 },
          modifiers: [{ type: "special-speed", movement: "fly", feet: 30 }]
        }
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

  // Offered on a weapon's hit from range, a thrown one's included (a Thrown weapon swung in melee is no missile); the
  // wearer's Dexterity modifier is added to the 1d10 when the action is derived. The free hand and catching the
  // missile stay prose.
  "gloves-of-missile-snaring": {
    actions: [
      {
        id: "snare-missile",
        name: "Snare Missile",
        activation: "reaction",
        description:
          "If you're hit by an attack roll made with a Ranged or Thrown weapon while wearing these gloves, you can take a Reaction to reduce the damage by 1d10 plus your Dexterity modifier if you have a free hand. If you reduce the damage to 0, you can catch the ammunition or weapon if it is small enough for you to hold in that hand.",
        damage: [],
        reaction: {
          trigger: "hit-by-attack",
          response: "reduce-damage",
          formula: "1d10",
          attackKinds: ["ranged-weapon"]
        },
        adds: { abilityModifier: "dex" }
      }
    ]
  },

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

  // Charm Person at DC 13: level 1 for 1 charge, a level higher for each charge after, up to its 3.
  "eyes-of-charming": {
    casts: [
      {
        spellId: "charm-person",
        saveDc: 13,
        chargesRaiseLevel: 3,
        uses: { limit: 3, per: "long-rest", pool: "eyes-of-charming-charges" }
      }
    ]
  },

  // `eyes-of-minute-seeing` - Darkvision, and Investigation advantage limited to within one foot.
  // `eyes-of-the-eagle` - Perception advantage "that rely on sight" and long-distance sight.

  /** "While wearing these dark lenses, you have Darkvision out to 60 feet. If you already have Darkvision, wearing the
   *  goggles increases its range by 60 feet." */
  "goggles-of-night": { modifiers: [{ type: "darkvision", feet: 60, extends: true }] },

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
    charges: { regain: "1d4" },
    casts: [
      {
        spellId: "detect-thoughts",
        saveDc: 13,
        uses: { limit: 5, per: "long-rest", pool: "medallion-of-thoughts-charges" }
      }
    ]
  },

  // `necklace-of-adaptation` - breathing anywhere, and Poisoned-save advantage (save source).
  /** 1d6 + 3 beads rolled when the necklace is added, each a level 3 Fireball (DC 15) that never comes back. Hurling
   *  several beads at once for more damage is the GM's. */
  "necklace-of-fireballs": {
    charges: { starting: "1d6 + 3", lastCharge: "destroyed" },
    casts: [{ spellId: "fireball", saveDc: 15, uses: { limit: 9, per: "never", pool: "necklace-of-fireballs-beads" } }]
  },
  // `necklace-of-prayer-beads` - the bead composition is per copy, and Cure Wounds has no healing.
  // `periapt-of-health` - healing, and Poisoned-save advantage (save source).

  // Both immunities are unqualified in the SRD, unlike Ring of Free Action's "magic" source.
  "periapt-of-proof-against-poison": {
    grants: { damageImmunities: ["poison"], conditionImmunities: ["poisoned"] }
  },

  // Life Preservation: a death save's d20 of 9 or lower counts as 10 (death-saves.ts). Natural Healing Boost: each Hit
  // Point Die rolled to regain Hit Points restores double (rests.ts, resolution/hit-point-die.ts).
  "periapt-of-wound-closure": {
    effects: [
      {
        name: "Wound Closure",
        tags: ["death-save-floor", "hit-dice-doubled"],
        duration: { type: "manual" },
        modifiers: [],
        onEnd: [],
        voidWhileIncapacitated: false,
        concentration: false
      }
    ]
  },

  // AC only. Preservation (save outcome, crumbles when spent) and spell-save advantage are not expressible.
  "scarab-of-protection": { modifiers: [{ type: "armor-class", amount: 1 }] },

  // The +2 to spell attack rolls. The touch damage by creature type and the charges that destroy a creature are not
  // authored.
  "talisman-of-pure-good": { modifiers: [{ type: "spell-attack-bonus", amount: 2 }] },
  "talisman-of-ultimate-evil": { modifiers: [{ type: "spell-attack-bonus", amount: 2 }] },
  // `talisman-of-the-sphere` - Arcana advantage only against a Sphere of Annihilation, which the engine does not hold.

  // ---- Shoulders -------------------------------------------------------------------------------

  // "You can use it to cast Dimension Door", once a dawn: the cast teleports its wearer (`granted-moves.ts`), the 4d6
  // falling only on an arrival in a filled space. The smoke cloud is the GM's.
  "cape-of-the-mountebank": { casts: [{ spellId: "dimension-door", uses: { limit: 1, per: "long-rest" } }] },

  // Spider Climb's Climb Speed; Spider Walk: "You can't be caught in webs of any sort" (the Web Walker tag a web's area
  // reads); and Web at save DC 13 once a dawn, filling twice its normal area: a 40-foot Cube.
  "cloak-of-arachnida": {
    grants: { damageResistances: ["poison"] },
    modifiers: [{ type: "special-speed", movement: "climb", equalToSpeed: true }],
    tags: ["web-walker"],
    casts: [
      {
        spellId: "web",
        saveDc: 13,
        uses: { limit: 1, per: "long-rest" },
        area: { shape: "cube", sizeFeet: 40, widthFeet: null }
      }
    ]
  },

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
    charges: { regain: "1d3" },
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
  /** Darkvision and Truesight out to 120 feet, which dynamic vision reads. Not modeled: Advantage on Wisdom
   *  (Perception) checks "that rely on sight" (a check doesn't say what it relies on), and the Light or Daylight
   *  drawback that Blinds the wearer. */
  "robe-of-eyes": {
    modifiers: [
      { type: "darkvision", feet: 120 },
      { type: "sense", sense: "truesight", feet: 120 }
    ]
  },

  /**
   * A real DC 15 Wisdom save that Stuns until the end of the wearer's next turn, at creatures within 30 feet, and the
   * robe's light and the Disadvantage of attackers that can see the wearer until the end of its next turn. Not modeled:
   * the save only for those in the Bright Light that see it.
   */
  "robe-of-scintillating-colors": {
    charges: { regain: "1d3" },
    actions: [
      {
        id: "dazzle",
        name: "Scintillating Colors",
        activation: "action",
        description:
          "Expend 1 charge to make the garment display a shifting pattern of dazzling hues until the end of your next turn. During this time, the robe sheds Bright Light in a 30-foot radius and Dim Light for an additional 30 feet, and creatures that can see you have Disadvantage on attack rolls against you. Any creature in the Bright Light that can see you when the robe's power is activated must succeed on a DC 15 Wisdom saving throw or have the Stunned condition until the effect ends.",
        save: {
          ability: "wis",
          dc: 15,
          successDamage: "none",
          failureConditions: ["stunned"],
          failureDuration: { type: "until-source-turn-end" }
        },
        uses: { limit: 3, per: "long-rest", pool: "robe-of-scintillating-colors-charges" },
        targets: { rangeFeet: 30 },
        grants: {
          name: "Scintillating Colors",
          tags: ["scintillating-colors"],
          duration: { type: "until-source-turn-end" },
          light: { brightFeet: 30, dimFeet: 30 },
          // "Creatures that can see you have Disadvantage on attack rolls against you."
          modifiers: [
            {
              type: "roll-mode",
              roll: "incoming-attack",
              mode: "disadvantage",
              when: [{ type: "on-attack-roll" }, { type: "seen-by-other" }]
            }
          ]
        }
      }
    ]
  },

  // The level-5 Magic Missile stars and Astral travel are not expressible.
  // The +1 to saves, and the six stars, each a level 5 Magic Missile; 1d6 come back at dusk, which is the Long Rest
  // here. The trip to the Astral Plane is the GM's.
  "robe-of-stars": {
    modifiers: [{ type: "save-bonus", amount: 1 }],
    charges: { regain: "1d6" },
    casts: [{ spellId: "magic-missile", atLevel: 5, uses: { limit: 6, per: "long-rest", pool: "robe-of-stars-stars" } }]
  },

  // `robe-of-the-archmagi` - `spell-save-dc` would raise every printed DC on the sheet; spell attack
  //     bonus has no reader; the AC 15 + Dex base replacement and spell-save advantage are not expressible.

  // `robe-of-useful-items` - per-copy patches that become objects and creatures.

  // The wings last up to an hour and then can't be used for 1d12 hours, so the wait runs 1d12 + 1 hours from the
  // use. Ending them early doesn't start the wait sooner. Falling when they disappear is the GM's.
  "wings-of-flying": {
    actions: [
      {
        id: "wings",
        name: "Wings of Flying",
        activation: "action",
        description:
          "Turn the cloak into wings on your back: a Fly Speed of 60 feet for 1 hour or until you end it with a Magic action. If you are in the air when they vanish, you fall. Once they vanish, you can't use them again for 1d12 hours.",
        damage: [],
        uses: { limit: 1, per: "time", afterHours: "1d12+1" },
        grants: {
          name: "Wings of Flying",
          tags: ["wings-of-flying"],
          duration: { type: "minutes", minutes: 60 },
          modifiers: [{ type: "special-speed", movement: "fly", feet: 60 }]
        }
      }
    ]
  },

  // ==== Carried wondrous items (slot wondrous), potions and oils ==================================
  //
  // Recurring limits:
  //   - A consumed item is `consumedOnUse`: each use of its actions takes one from the stack. An item with
  //     several charges that it spends as it goes (beads, dust pinches) still has no `per` value to say so.
  //   - `itemAction` keeps `attack`, `save`, `damage`, `healing`, `uses`, `grants`, `area` and
  //     `replacesAttack`; `onHit` and the rest are dropped, so an item action cannot apply an on-hit condition.
  //   - An item's `effects` ignore `duration`, so "Resistance for 1 hour" would be permanent.
  //   - Spell records describe the spell's text as a whole (see the wands section), and there
  //     is no temporary-HP rider.
  //   - One use spends one charge, and pools are capped at 20.
  //   - `ability-score` is refused on items.
  //   - Item actions only resolve inside an encounter. Outside one, the loose route rolls them and spends the
  //     charge, as `action.use` says.
  //
  // A charged item may be authored for its charge alone (count and recharge exact) when the GM can
  // already produce what the charge buys: the elemental summons, `bag-of-tricks`, `gem-of-seeing`,
  // `pipes-of-the-sewers`, `cubic-gate` and `iron-bands`. Not when the sheet would then be wrong
  // (`pearl-of-power`). "Regains 1dN at dawn" is `charges.regain`, rolled on a Long Rest.
  //
  // Trap items (`bag-of-devouring`, `potion-of-poison`, `dust-of-sneezing-and-choking`) are not
  // authored: a button naming the real effect would spoil the trap.

  // ---- Carried wondrous items (alphabetical, absences inline) ----------------------------------

  // `apparatus-of-the-crab`: a vehicle, outside the rider model.
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

  // `bead-of-force` - destroyed on use.
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

  // "It hovers beneath you and can be ridden in the air. It has a Fly Speed of 50 feet"; 30 feet carrying over 200
  // pounds, which carried weight doesn't track. The carpet's speed depends on its size, so it stays the GM's, and so do
  // the horseshoes.
  "broom-of-flying": {
    actions: [
      {
        id: "ride",
        name: "Ride the Broom",
        activation: "action",
        description:
          "Stand astride the broom and speak its command word: it hovers beneath you with a Fly Speed of 50 feet (30 feet while carrying over 200 pounds). It stops hovering when you land; end it on your sheet.",
        damage: [],
        grants: {
          name: "Broom of Flying",
          tags: ["broom-of-flying"],
          duration: { type: "manual" },
          modifiers: [{ type: "special-speed", movement: "fly", feet: 50, hover: true }]
        }
      }
    ]
  },

  // Its light: "the candle sheds Dim Light in a 30-foot radius" for its 4 hours of burning. Not modeled: Advantage on
  // D20 Tests and slot-free level 1 spells within that light, and the Gate it can open.
  "candle-of-invocation": { light: { brightFeet: 0, dimFeet: 30, burnHours: 4 } },

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

  /** Knock ten times, which never come back; after the tenth the chime cracks and is gone. */
  "chime-of-opening": {
    charges: { lastCharge: "destroyed" },
    casts: [{ spellId: "knock", uses: { limit: 10, per: "never", pool: "chime-of-opening-uses" } }]
  },

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

  /** Five faces at their printed charge costs and DC 17, on 10 charges that regain 1d6 at dawn. The Shield face is
   *  the GM's: a Reaction spell from an item isn't offered on its trigger. */
  "cube-of-force": {
    charges: { regain: "1d6" },
    casts: [
      { spellId: "mage-armor", saveDc: 17, uses: { limit: 10, per: "long-rest", pool: "cube-of-force-charges" } },
      {
        spellId: "tiny-hut",
        saveDc: 17,
        useCost: 3,
        uses: { limit: 10, per: "long-rest", pool: "cube-of-force-charges" }
      },
      {
        spellId: "private-sanctum",
        saveDc: 17,
        useCost: 4,
        uses: { limit: 10, per: "long-rest", pool: "cube-of-force-charges" }
      },
      {
        spellId: "resilient-sphere",
        saveDc: 17,
        useCost: 4,
        uses: { limit: 10, per: "long-rest", pool: "cube-of-force-charges" }
      },
      {
        spellId: "wall-of-force",
        saveDc: 17,
        useCost: 5,
        uses: { limit: 10, per: "long-rest", pool: "cube-of-force-charges" }
      }
    ]
  },

  // Gate and Plane Shift on one shared 3-charge pool. Which plane each side opens is the GM's.
  "cubic-gate": {
    charges: { regain: "1d3" },
    casts: [
      { spellId: "gate", uses: { limit: 3, per: "long-rest", pool: "cubic-gate-charges" } },
      { spellId: "plane-shift", uses: { limit: 3, per: "long-rest", pool: "cubic-gate-charges" } }
    ]
  },

  /** The Geyser command, unlimited as printed; Splash and Fountain only pour water. */
  "decanter-of-endless-water": {
    actions: [
      {
        id: "geyser",
        name: "Geyser",
        activation: "action",
        description:
          "Remove the stopper and speak the command word: 30 gallons of water gush forth in a Line 30 feet long and 1 foot wide. One creature of your choice in the Line must succeed on a DC 13 Strength saving throw or take 1d4 Bludgeoning damage and have the Prone condition. Instead of a creature, you can target one object in the Line that isn't being worn or carried and that weighs no more than 200 pounds; the object is knocked over.",
        save: { ability: "str", dc: 13, successDamage: "none", failureConditions: ["prone"] },
        damage: [{ formula: "1d4", type: "bludgeoning" }],
        targets: { count: 1, rangeFeet: 30 }
      }
    ]
  },

  // `deck-of-illusions` - illusions and card state are not modeled.
  // `dimensional-shackles` - prevents extradimensional movement, which is not modeled.
  // `dragon-orb` - multi-charge spells, a healing cast, a self-charm on attunement and a curse.

  // `dust-of-disappearance` - single use, rolled duration, area effect.
  // `dust-of-dryness` - consumed pinches; its damage is gated on creature type.
  // `dust-of-sneezing-and-choking` - single use, and a trap.
  // `efficient-quiver` - a container.
  // `efreeti-bottle` - a first-opening table governing later uses.
  // `elemental-gem` - single use.
  /** Opened, "smoke billows out of the bottle and fills a 60-foot Emanation originating from the bottle", Heavily
   *  Obscured, for 10 minutes. Not modeled: the cloud growing 10 feet a minute while it stays open, and a strong wind
   *  dispersing it. */
  "eversmoking-bottle": {
    actions: [
      {
        id: "open",
        name: "Open the Bottle",
        activation: "action",
        area: { shape: "emanation", sizeFeet: 60, widthFeet: null },
        description:
          "Remove the stopper: smoke fills a 60-foot Emanation originating from the bottle, Heavily Obscured, for 10 minutes.",
        sight: { area: { kind: "heavily-obscured", aroundSelfFeet: 60 }, rounds: 100 }
      }
    ]
  },
  // `feather-token` - six single-use tokens in one row.
  // `figurine-of-wondrous-power` - ten figurines, summons, multi-day cooldowns.
  // `folding-boat` - a vehicle.
  // Its first command's light ("Bright Light in a 30-foot radius and Dim Light for an additional 30 feet"), lit and put
  // out on the row, and its beam (1 charge) and flare (5) on 50 charges that never return. The gem turning
  // nonmagical when they are gone is the GM's.
  "gem-of-brightness": {
    light: { brightFeet: 30, dimFeet: 30 },
    actions: [
      {
        id: "beam",
        name: "Beam of Light",
        activation: "action",
        description:
          "Expend 1 charge to fire a beam of light at one creature you can see within 60 feet. It must succeed on a DC 15 Constitution saving throw or have the Blinded condition for 1 minute, repeating the save at the end of each of its turns.",
        save: {
          ability: "con",
          dc: 15,
          successDamage: "none",
          failureConditions: ["blinded"],
          failureDuration: { type: "rounds", rounds: 10 },
          repeatSave: true
        },
        uses: { limit: 50, per: "never", pool: "gem-of-brightness-charges" },
        targets: { count: 1, rangeFeet: 60, seen: true }
      },
      {
        id: "flare",
        name: "Flare",
        activation: "action",
        description:
          "Expend 5 charges to flare with intense light in a 30-foot Cone. Each creature in it must succeed on a DC 15 Constitution saving throw or have the Blinded condition for 1 minute, repeating the save at the end of each of its turns.",
        area: { shape: "cone", sizeFeet: 30, widthFeet: null },
        save: {
          ability: "con",
          dc: 15,
          successDamage: "none",
          failureConditions: ["blinded"],
          failureDuration: { type: "rounds", rounds: 10 },
          repeatSave: true
        },
        useCost: 5,
        uses: { limit: 50, per: "never", pool: "gem-of-brightness-charges" }
      }
    ]
  },

  // Not cast as True Seeing (that spell targets someone you touch): the charge gives its user Truesight 120 feet for
  // 10 minutes, which dynamic vision reads.
  "gem-of-seeing": {
    charges: { regain: "1d3" },
    actions: [
      {
        id: "peer",
        name: "Peer Through the Gem",
        activation: "action",
        description:
          "Expend 1 charge. For the next 10 minutes, you have Truesight out to 120 feet when you peer through the gem.",
        uses: { limit: 3, per: "long-rest", pool: "gem-of-seeing-charges" },
        grants: {
          name: "Peering Through the Gem of Seeing",
          tags: ["gem-of-seeing"],
          duration: { type: "rounds", rounds: 100 },
          modifiers: [{ type: "sense", sense: "truesight", feet: 120 }]
        }
      }
    ]
  },

  // `handy-haversack` - a container.
  // `hat-of-many-spells` - a cast gated on an Arcana check outcome with a wild-magic table.
  // `horn-of-blasting` - authorable except its 20% chance to explode and damage the user; authoring
  //     only the blast would make it strictly better than printed.

  // The 7-day wait only. The spirits (2 to 5 Berserkers by the horn's metal) are placed by the GM, and the four
  // metals share one row, so the requirement isn't checked.
  "horn-of-valhalla": {
    actions: [
      {
        id: "blow",
        name: "Blow the Horn",
        activation: "action",
        description:
          "Magic action: warrior spirits (Berserkers) appear within 60 feet of you for 1 hour: 2 from a silver horn, 3 from brass, 4 from bronze, 5 from iron. If you don't meet the horn's requirement, they attack you. The horn can't be used again until 7 days have passed.",
        uses: { limit: 1, per: "time", afterHours: "168" }
      }
    ]
  },
  // `horseshoes-of-a-zephyr` - movement and travel are not modeled.
  // `horseshoes-of-speed` - speed reaches nothing from an item, and it is worn by a horse.
  // `instant-fortress` - a building.
  // `ioun-stone` - fourteen stones in one row; a rider would grant all of them.

  /**
   * Its to-hit is printed as Dexterity + Proficiency Bonus, which is exactly the derived form. A hit Restrains a Huge or
   * smaller creature until released, escaped with a DC 20 Strength (Athletics) check. Not modeled: the bands being
   * destroyed when broken, the 24-hour lockout after a failed check, and the release command.
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
        uses: { limit: 1, per: "long-rest", pool: "iron-bands-charges" },
        targets: { count: 1, maxSize: "huge", seen: true },
        onHit: [{ name: "Iron Bands", conditions: [{ id: "restrained" }], escapeDc: 20, tags: ["escape-athletics"] }]
      }
    ]
  },

  // No limit on attempts, as printed. "Native to another plane" is read as a Celestial, an Elemental, a Fey or a
  // Fiend. Not modeled: the trapping itself.
  "iron-flask": {
    actions: [
      {
        id: "trap",
        name: "Trap a Creature",
        activation: "action",
        description:
          "Target a creature you can see within 60 feet of yourself. If the flask is empty and the target is native to a plane of existence other than the one you are on, the target must succeed on a DC 17 Wisdom saving throw or be trapped in the flask. Once trapped, a creature remains in the flask until released.",
        save: { ability: "wis", dc: 17, successDamage: "none", failureConditions: [] },
        targets: { count: 1, rangeFeet: 60, seen: true, creatureTypes: ["celestial", "elemental", "fey", "fiend"] }
      }
    ]
  },

  /** "While lit, this hooded lantern burns for 6 hours on 1 pint of oil, shedding Bright Light in a 30-foot radius and
   *  Dim Light for an additional 30 feet. Invisible creatures and objects are visible as long as they are in the
   *  lantern's Bright Light. You can take a Utilize action to lower the hood, reducing the light to Dim Light in a
   *  5-foot radius." */
  "lantern-of-revealing": {
    light: {
      brightFeet: 30,
      dimFeet: 30,
      revealsInvisible: true,
      hooded: { brightFeet: 0, dimFeet: 5 },
      burnHours: 6,
      fuel: "oil"
    }
  },
  // ---- Manuals and tomes: "If you spend 48 hours over a period of 6 days or fewer studying the book's contents and
  // practicing its guidelines, your Constitution increases by 2, to a maximum of 30. The manual then loses its magic but
  // regains it in a century." The increase is permanent, so it goes into the reader's build (the GM marks the study
  // done); an item rider would end when the book is put down.
  "manual-of-bodily-health": { study: { ability: "con", amount: 2, maximum: 30, hours: 48, days: 6 } },
  "manual-of-gainful-exercise": { study: { ability: "str", amount: 2, maximum: 30, hours: 48, days: 6 } },
  "manual-of-quickness-of-action": { study: { ability: "dex", amount: 2, maximum: 30, hours: 48, days: 6 } },
  "tome-of-clear-thought": { study: { ability: "int", amount: 2, maximum: 30, hours: 48, days: 6 } },
  "tome-of-leadership-and-influence": { study: { ability: "cha", amount: 2, maximum: 30, hours: 48, days: 6 } },
  "tome-of-understanding": { study: { ability: "wis", amount: 2, maximum: 30, hours: 48, days: 6 } },
  // `manual-of-golems` - crafting.
  // `marvelous-pigments` - GM fiat, consumed.
  // `mirror-of-life-trapping` - a passive save on anyone who sees their reflection.
  // `mysterious-deck` - GM-fiat cards; the death-save card has no reader.

  // `pearl-of-power` - no rider refunds a spent spell slot (`spell-slot` raises the maximum).

  /**
   * Spends a charge and puts a real DC 15 Wisdom save on the target that Frightens on a failure for 1 minute,
   * repeating the save at the end of each of its turns. Not modeled: the 24-hour immunity after a success.
   */
  "pipes-of-haunting": {
    charges: { regain: "1d3" },
    actions: [
      {
        id: "play",
        name: "Play the Pipes",
        activation: "action",
        description:
          "Expend 1 charge to play an eerie, spellbinding tune. Each creature of your choice within 30 feet of you must succeed on a DC 15 Wisdom saving throw or have the Frightened condition for 1 minute. A creature that fails the save repeats it at the end of each of its turns, ending the effect on itself on a success. A creature that succeeds on its save is immune to the effect of these pipes for 24 hours.",
        save: {
          ability: "wis",
          dc: 15,
          successDamage: "none",
          failureConditions: ["frightened"],
          failureDuration: { type: "rounds", rounds: 10 },
          repeatSave: true
        },
        uses: { limit: 3, per: "long-rest", pool: "pipes-of-haunting-charges" },
        targets: { rangeFeet: 30 }
      }
    ]
  },

  /**
   * Charge-alone, one action per swarm (the SRD allows 1-3 charges as one Bonus Action, so this is
   * slower than printed). The swarms and rat attitudes are the GM's; the save printed in the text is
   * made by the swarm, so it is not this action's `save`.
   */
  "pipes-of-the-sewers": {
    charges: { regain: "1d3" },
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

  // Unlimited, as printed. The rope's own Armor Class and Hit Points are not modeled.
  "rope-of-entanglement": {
    actions: [
      {
        id: "entangle",
        name: "Entangle",
        activation: "action",
        description:
          "Command the other end of the rope to dart forward and entangle one creature you can see within 20 feet of yourself. The target must succeed on a DC 15 Dexterity saving throw or have the Restrained condition. You can release the target by letting go of your end of the rope or by using a Bonus Action to repeat the command.",
        save: { ability: "dex", dc: 15, successDamage: "none", failureConditions: ["restrained"], escapeDc: 15 },
        targets: { count: 1, rangeFeet: 20, seen: true }
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

  /** "+1 bonus to ability checks and saving throws": the sheet's rows, the server's saves and its builtin checks. */
  "stone-of-good-luck-luckstone": {
    modifiers: [
      { type: "check-bonus", amount: 1 },
      { type: "save-bonus", amount: 1 }
    ]
  },

  // `universal-solvent` - consumed ounces.
  // `well-of-many-worlds` - a rolled 1d8-hour cooldown and planar travel.
  // `wind-fan` - each reuse risks tearing it; authoring the cast alone would remove the risk.

  // ---- Potions -----------------------------------------------------------------------------------

  // Potions of Healing: each strength is its own row, and the common one is the gear Potion of Healing. SRD
  // Potions: "Drinking a potion or administering it to another creature requires a Bonus Action."
  "potion-of-healing-greater": healingPotion("Potion of Healing (greater)", "4d4 + 4"),
  "potion-of-healing-superior": healingPotion("Potion of Healing (superior)", "8d4 + 8"),
  "potion-of-healing-supreme": healingPotion("Potion of Healing (supreme)", "10d4 + 20"),

  // "You gain a Fly Speed equal to your Speed for 1 hour and can hover", an hour of game time.
  "potion-of-flying": {
    consumedOnUse: true,
    actions: [
      {
        id: "drink",
        name: "Drink Potion of Flying",
        activation: "bonus-action",
        description:
          "Drink it: you gain a Fly Speed equal to your Speed for 1 hour and can hover. If you're in the air when it wears off, you fall unless you have some other means of staying aloft.",
        damage: [],
        grants: {
          name: "Potion of Flying",
          tags: ["potion-of-flying"],
          duration: { type: "minutes", minutes: 60 },
          modifiers: [{ type: "special-speed", movement: "fly", equalToSpeed: true, hover: true }]
        }
      }
    ]
  }

  // The other potions and the oils stay prose: their effects last an hour or more, which an effect can't count
  // without the GM ending it.
};

/** A potion that heals its printed dice when drunk or given to a creature within 5 feet, and is used up. */
function healingPotion(name: string, formula: string): ItemMechanics {
  return {
    consumedOnUse: true,
    actions: [
      {
        id: "drink",
        name: `Drink ${name}`,
        activation: "bonus-action",
        description: `Drink it, or give it to a creature within 5 feet of you. The drinker regains ${formula} Hit Points.`,
        damage: [],
        healing: { formula }
      }
    ]
  };
}
