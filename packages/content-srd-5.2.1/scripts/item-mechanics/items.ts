/**
 * Hand-authored riders for the generated magic items, keyed by item id. `build-magic-items.ts` merges
 * them into `magic-items.v1.json` through `./overlay.ts`; an item with no entry ships as prose only.
 *
 * A rider is authored only where a consumer reads it and produces the printed effect. Where an item
 * stays prose for a reason worth keeping, a comment in its section says why.
 */
import type { DamageType, Modifier } from "@vtt/schemas";
import type { ItemMechanics, ItemMechanicsModule } from "./overlay.js";
import { MISTY_CLOUD } from "../spell-effects.js";

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

  // The dragon's kind sets the type; fire (a red dragon) until the GM picks. "Advantage on saving throws against the
  // Breath Weapons of Dragons" is read as Advantage on a save a Dragon forces; the dragon sense is the GM's.
  "dragon-scale-mail": {
    grants: { damageResistances: ["fire"] },
    damageTypeChoice: ["acid", "cold", "fire", "lightning", "poison"],
    modifiers: [
      { type: "armor-class", amount: 1 },
      {
        type: "roll-mode",
        roll: "save",
        mode: "advantage",
        when: [{ type: "on-saving-throw" }, { type: "source-creature-type-is", creatureTypes: ["dragon"] }]
      }
    ]
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

  // "You have Advantage on saving throws against spells and other magical effects, and spell attack rolls have
  // Disadvantage against you."
  "spellguard-shield": {
    modifiers: [
      {
        type: "roll-mode",
        roll: "incoming-attack",
        mode: "disadvantage",
        when: [{ type: "on-attack-roll" }, { type: "attack-kind-is", kinds: ["spell"] }]
      },
      {
        type: "roll-mode",
        roll: "save",
        mode: "advantage",
        when: [{ type: "on-saving-throw" }, { type: "versus-magic" }]
      }
    ]
  },

  // "While holding this Shield, you can take a Bonus Action to cause it to animate ... leaving your hands free" for 1
  // minute: an animated shield fills no hand. Its fall when its wielder is Incapacitated is the GM's.
  "animated-shield": {
    actions: [
      {
        id: "animate",
        name: "Animate the Shield",
        activation: "bonus-action",
        description:
          "The Shield leaps into the air and hovers in your space to protect you as if you were wielding it, leaving your hands free. It remains animate for 1 minute, until you take a Bonus Action to end it, or until you die or have the Incapacitated condition, when it falls to the ground or into a free hand.",
        damage: [],
        grants: {
          name: "Animated Shield",
          tags: ["animated-shield"],
          duration: { type: "rounds", rounds: 10 },
          voidWhileIncapacitated: true
        }
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

  // Three charges, 1d3 back at dawn: Dominate Beast at DC 15 "on a Beast that has a Swim Speed".
  "trident-of-fish-command": {
    charges: { regain: "1d3" },
    casts: [
      {
        spellId: "dominate-beast",
        saveDc: 15,
        uses: { limit: 3, per: "long-rest" },
        targets: { creatureTypes: ["beast"], speeds: ["swim"] }
      }
    ]
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

  // "It has the Thrown property with a normal range of 20 feet and a long range of 60 feet. When you hit with a ranged
  // attack using this weapon, it deals an extra 1d8 Force damage, or an extra 2d8 Force damage if the target is a
  // Giant." It flies back to its thrower's hand, so a throw leaves it in hand.
  "dwarven-thrower": {
    weaponChanges: { addProperties: ["thrown"], rangeFeet: 20, longRangeFeet: 60 },
    modifiers: [
      { type: "attack-bonus", amount: 3 },
      { type: "damage-bonus", amount: 3 },
      {
        type: "extra-damage",
        formula: "1d8",
        damageType: "force",
        doubleOnCritical: true,
        when: [{ type: "on-hit" }, { type: "attack-kind-is", kinds: ["ranged"] }]
      },
      {
        type: "extra-damage",
        formula: "1d8",
        damageType: "force",
        doubleOnCritical: true,
        when: [
          { type: "on-hit" },
          { type: "attack-kind-is", kinds: ["ranged"] },
          { type: "versus-creature-type", creatureTypes: ["giant"] }
        ]
      }
    ]
  },

  // "You can transfer some or all of the weapon's bonus to your Armor Class": one form for each split, picked by its
  // wielder as it attacks. When it picks one (the first attack of its turn) and holding it to the start of its next
  // turn are the wielder's to keep.
  defender: {
    modifiers: [
      { type: "attack-bonus", amount: 3 },
      { type: "damage-bonus", amount: 3 }
    ],
    variantChoice: { by: "holder" },
    variants: [
      {
        id: "ac-1",
        name: "+1 moved to AC",
        replacesRiders: true,
        modifiers: [
          { type: "attack-bonus", amount: 2 },
          { type: "damage-bonus", amount: 2 },
          { type: "armor-class", amount: 1 }
        ]
      },
      {
        id: "ac-2",
        name: "+2 moved to AC",
        replacesRiders: true,
        modifiers: [
          { type: "attack-bonus", amount: 1 },
          { type: "damage-bonus", amount: 1 },
          { type: "armor-class", amount: 2 }
        ]
      },
      { id: "ac-3", name: "+3 moved to AC", replacesRiders: true, modifiers: [{ type: "armor-class", amount: 3 }] }
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

  // Its 10-foot Emanation (30 feet for a Paladin of level 17) gives its wielder and the creatures Friendly to it
  // Advantage on saves against spells and other magical effects, read from the map as each save is rolled.
  "holy-avenger": {
    modifiers: [
      { type: "attack-bonus", amount: 3 },
      { type: "damage-bonus", amount: 3 },
      versusTypes("2d10", ["fiend", "undead"], "radiant")
    ],
    magicSaveAura: { feet: 10, widerAt: { classId: "paladin", level: 17, feet: 30 } }
  },

  // "You can make one attack with it as a Bonus Action on each of your turns."
  "scimitar-of-speed": {
    modifiers: [
      { type: "attack-bonus", amount: 2 },
      { type: "damage-bonus", amount: 2 }
    ],
    bonusActionAttack: true
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
  // put out on the row. A Bonus Action turns it into a 6-inch rod or a 10-foot pole: Acrobatic Assist holds as a
  // Quarterstaff and as a pole, and the Quarterstaff alone deflects and is thrown 30/120, flying back to its hand.
  "quarterstaff-of-the-acrobat": {
    weaponChanges: { addProperties: ["thrown"], rangeFeet: 30, longRangeFeet: 120 },
    variantChoice: { by: "holder", activation: "bonus-action" },
    variants: [
      { id: "rod", name: "6-inch rod", weapon: null, replacesRiders: true, suspendsActions: true },
      {
        id: "pole",
        name: "10-foot pole",
        weapon: null,
        replacesRiders: true,
        suspendsActions: true,
        modifiers: [
          {
            type: "roll-mode",
            roll: "check",
            mode: "advantage",
            when: [{ type: "on-ability-check" }, { type: "skill-is", skills: ["acrobatics"] }]
          }
        ]
      }
    ],
    modifiers: [
      { type: "attack-bonus", amount: 2 },
      { type: "damage-bonus", amount: 2 },
      {
        type: "roll-mode",
        roll: "check",
        mode: "advantage",
        when: [{ type: "on-ability-check" }, { type: "skill-is", skills: ["acrobatics"] }]
      }
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
  // "While grasping the hilt, you can take a Bonus Action to cause a blade of pure radiance to spring into existence or
  // make the blade disappear": the hilt is a form with no blade, no light and no bonus. "While the blade exists, it
  // sheds Bright Light in a 15-foot radius and Dim Light for an additional 15 feet. The light is sunlight." Not
  // modeled: the radius its Magic action adjusts.
  "sun-blade": {
    modifiers: [
      { type: "attack-bonus", amount: 2 },
      { type: "damage-bonus", amount: 2 },
      versusTypes("1d8", ["undead"], "radiant")
    ],
    light: { brightFeet: 15, dimFeet: 15, sunlight: true, always: true },
    variantChoice: { by: "holder", activation: "bonus-action" },
    variants: [
      { id: "hilt", name: "Hilt only", weapon: null, replacesRiders: true },
      { id: "blade", name: "Blade of radiance" }
    ]
  },

  // "Each time you ... hit, you can have it deal Lightning damage instead of Piercing damage." Lightning Bolt, once a
  // dawn: a 5-foot-wide Line of 120 feet (to a target no farther), DC 13 Dexterity, 4d6 Lightning, half on a success,
  // with the javelin back in hand.
  "javelin-of-lightning": {
    weaponChanges: { damageTypeOptions: ["lightning"] },
    actions: [
      {
        id: "lightning-bolt",
        name: "Lightning Bolt",
        activation: "action",
        description:
          "Throw the javelin at a target no farther than 120 feet and turn it into a bolt of lightning: a 5-foot-wide Line from you to the target. The target and each other creature in the Line make a DC 13 Dexterity saving throw, taking 4d6 Lightning damage on a failed save or half as much on a success. The javelin reappears in your hand. It can't be used this way again until the next dawn.",
        damage: [{ formula: "4d6", type: "lightning" }],
        save: { ability: "dex", dc: 13, successDamage: "half", failureConditions: [] },
        area: { shape: "line", sizeFeet: 120, widthFeet: 5 },
        uses: { limit: 1, per: "long-rest" }
      }
    ]
  },

  // "An arrow produced by this weapon deals Force damage instead of Piercing damage", with no ammunition to spend. Not
  // modeled: the arrows' light, Arrow of Restraint, Arrow of Transport and the Energy Ladder.
  "energy-bow": {
    weaponChanges: { damageType: "force", removeProperties: ["ammunition"] },
    modifiers: [
      { type: "attack-bonus", amount: 1 },
      { type: "damage-bonus", amount: 1 }
    ]
  },

  // "While you are attuned ... your Strength is 20 unless your Strength is already equal to or greater", 1d8 Thunder
  // more on a hit, and Clap of Thunder's 30-foot Cone (a Magic action, DC 15 Strength or Prone). Earthquake, once a
  // dawn: a 50-foot-radius circle around the point it strikes, DC 20 Dexterity or Prone; its Concentration save, the
  // fissure and the damage to structures are the GM's.
  "thunderous-greatclub": {
    modifiers: [
      { type: "ability-score-minimum", ability: "str", score: 20 },
      {
        type: "extra-damage",
        formula: "1d8",
        damageType: "thunder",
        doubleOnCritical: true,
        when: [{ type: "on-hit" }]
      }
    ],
    actions: [
      {
        id: "clap-of-thunder",
        name: "Clap of Thunder",
        activation: "action",
        description:
          "Strike the weapon against a hard surface: a clap audible out to 300 feet, and a 30-foot Cone of thunderous energy. Each creature in the Cone makes a DC 15 Strength saving throw or has the Prone condition. Nonmagical objects in it that aren't worn or carried take 3d8 Thunder damage.",
        damage: [],
        save: { ability: "str", dc: 15, successDamage: "none", failureConditions: ["prone"] },
        area: { shape: "cone", sizeFeet: 30, widthFeet: null }
      },
      {
        id: "earthquake",
        name: "Earthquake",
        activation: "action",
        description:
          "Strike the weapon against the ground: each creature on the ground in a 50-foot-radius circle centered on the point of impact makes a DC 20 Dexterity saving throw or has the Prone condition. A concentrating creature there also makes a DC 20 Constitution saving throw or its Concentration is broken. Structures on the ground there take 50 Bludgeoning damage, and a fissure can open (the GM's). It can't be used again until the next dawn.",
        damage: [],
        save: { ability: "dex", dc: 20, successDamage: "none", failureConditions: ["prone"] },
        area: { shape: "emanation", sizeFeet: 50, widthFeet: null },
        uses: { limit: 1, per: "long-rest" }
      }
    ]
  },

  // "Any Critical Hit against you becomes a normal hit."
  "adamantine-armor": { modifiers: [{ type: "no-critical-hits" }] },

  // Three charges, 1d3 back at dawn: a Magic action and a charge make each creature of the wielder's choice within 30
  // feet save (DC 15 Wisdom) or be Frightened for 1 minute, repeating the save at the end of each of its turns. That it
  // must flee and can only Dash is the GM's.
  "mace-of-terror": {
    charges: { regain: "1d3" },
    actions: [
      {
        id: "terror",
        name: "Wave of Terror",
        activation: "action",
        description:
          "Expend 1 charge to release a wave of terror. Each creature of your choice within 30 feet makes a DC 15 Wisdom saving throw or has the Frightened condition for 1 minute. While Frightened this way it spends its turns moving as far from you as it can, can't make Opportunity Attacks and can only Dash or try to escape what holds it. It repeats the save at the end of each of its turns.",
        damage: [],
        save: {
          ability: "wis",
          dc: 15,
          successDamage: "none",
          failureConditions: ["frightened"],
          failureDuration: { type: "rounds", rounds: 10 },
          repeatSave: true
        },
        uses: { limit: 3, per: "long-rest", pool: "mace-of-terror-charges" },
        targets: { rangeFeet: 30, who: "others" }
      }
    ]
  },

  // The sworn enemy: a creature its wielder names as it shoots, until it dies or seven days pass, one at a time. Against
  // it the bow's ranged attack rolls have Advantage, ignore Half and Three-Quarters Cover and deal 3d6 Piercing more.
  // Not modeled: ignoring long range's Disadvantage, and the Disadvantage with other weapons while it lives.
  oathbow: {
    actions: [
      {
        id: "sworn-enemy",
        name: "Name a Sworn Enemy",
        activation: "other",
        description:
          'As you make a ranged attack with the bow, say "Swift death to you who have wronged me." The target becomes your sworn enemy until it dies or until dawn 7 days later. You can have only one sworn enemy at a time; when it dies, you can choose a new one after the next dawn.',
        damage: [],
        uses: { limit: 1, per: "long-rest" },
        targets: { count: 1, who: "others", seen: true },
        grants: {
          name: "Sworn Enemy",
          target: "target",
          tags: ["sworn-enemy"],
          duration: { type: "minutes", minutes: 10080 }
        }
      }
    ],
    modifiers: [
      {
        type: "roll-mode",
        roll: "attack",
        mode: "advantage",
        when: [
          { type: "on-attack-roll" },
          { type: "attack-kind-is", kinds: ["ranged"] },
          { type: "versus-marked", tags: ["sworn-enemy"] }
        ]
      },
      {
        type: "ignores-cover",
        degree: "three-quarters",
        when: [
          { type: "on-attack-roll" },
          { type: "attack-kind-is", kinds: ["ranged"] },
          { type: "versus-marked", tags: ["sworn-enemy"] }
        ]
      },
      {
        type: "extra-damage",
        formula: "3d6",
        damageType: "piercing",
        doubleOnCritical: true,
        when: [{ type: "on-hit" }, { type: "versus-marked", tags: ["sworn-enemy"] }]
      }
    ]
  },

  // A rolled 20 deals 15 Necrotic more to a creature that is neither a Construct nor an Undead, and its wielder gains
  // that many Temporary Hit Points: said with the hit, since a flat amount of another type has no rider.
  "sword-of-life-stealing": {
    onHit: [
      {
        conditions: [],
        naturalTwenty: true,
        reminder:
          "Sword of Life Stealing: unless the target is a Construct or an Undead, it takes an extra 15 Necrotic damage, and the wielder gains that many Temporary Hit Points."
      }
    ]
  },

  // "Whenever an attacker makes a ranged attack roll against a target within 5 feet of you, you can take a Reaction to
  // become the target of the attack instead": offered before the roll. Not modeled: the +2 AC against ranged attack
  // rolls, since an AC bonus cannot be limited to them.
  "arrow-catching-shield": {
    actions: [
      {
        id: "catch-the-attack",
        name: "Arrow-Catching Shield",
        activation: "reaction",
        description:
          "Whenever an attacker makes a ranged attack roll against a target within 5 feet of you, you can take a Reaction to become the target of the attack instead.",
        damage: [],
        reaction: { trigger: "other-targeted-by-attack", response: "become-target", rangeFeet: 5, ranged: true }
      }
    ]
  },

  // Prose-only items:
  //   `arrow-catching-shield` - an AC bonus cannot be limited to ranged attacks (its Reaction is authored above).
  //   `dancing-sword` - a sword that attacks from its own space needs an object token that strikes.
  //   `ammunition-of-slaying` - a piece's own hit riders don't ride the shot its launcher makes.

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

  // The djinni within 120 feet, Friendly and obeying the wearer while the wearer keeps Concentration, up to 1 hour; then
  // 24 hours before it can be summoned again. "If you fail to command it, the djinni defends itself against attackers but takes no other actions." The ring
  // becoming nonmagical when the djinni dies is the table's.
  "ring-of-djinni-summoning": {
    actions: [
      {
        id: "summon-djinni",
        name: "Summon the Djinni",
        activation: "action",
        description:
          "Summon the ring's Djinni in an unoccupied space you choose within 120 feet. It remains as long as you maintain Concentration, to a maximum of 1 hour, or until it drops to 0 Hit Points. It is Friendly to you and your allies and obeys your commands; uncommanded, it defends itself and takes no other actions. It can't be summoned again for 24 hours.",
        uses: { limit: 1, per: "time", afterHours: "24" },
        summons: {
          creatures: [{ monsterId: "djinni" }],
          rangeFeet: 120,
          lasts: { type: "minutes", minutes: 60, concentration: true },
          dodgesUncommanded: true
        }
      }
    ]
  },
  // "Each Ring of Elemental Command is linked to one of the four Elemental Planes. The GM chooses": the plane is the
  // copy's kind. Every ring has Elemental Bane (Advantage on attack rolls against Elementals, which have Disadvantage
  // against its wearer) and Elemental Compulsion (a DC 18 Wisdom save or Charmed until the start of the wearer's next
  // turn). The plane gives its Resistance, Immunity or speed, and its spells on 5 charges (1d4 + 1 back at dawn), each
  // at DC 18 and its printed charges. The languages, breathing water and moving through earth are the GM's.
  "ring-of-elemental-command": {
    charges: { regain: "1d4 + 1" },
    modifiers: [
      {
        type: "roll-mode",
        roll: "attack",
        mode: "advantage",
        when: [{ type: "on-attack-roll" }, { type: "versus-creature-type", creatureTypes: ["elemental"] }]
      },
      {
        type: "roll-mode",
        roll: "incoming-attack",
        mode: "disadvantage",
        when: [{ type: "on-attack-roll" }, { type: "source-creature-type-is", creatureTypes: ["elemental"] }]
      }
    ],
    actions: [
      {
        id: "elemental-compulsion",
        name: "Elemental Compulsion",
        activation: "action",
        description:
          "Try to compel an Elemental you see within 60 feet. It makes a DC 18 Wisdom saving throw. On a failed save, it has the Charmed condition until the start of your next turn, and you determine what it does with its move and action on its next turn.",
        damage: [],
        save: {
          ability: "wis",
          dc: 18,
          successDamage: "none",
          failureConditions: ["charmed"],
          failureDuration: { type: "until-source-next-turn" }
        },
        targets: { count: 1, rangeFeet: 60, seen: true, creatureTypes: ["elemental"] }
      }
    ],
    variants: [
      {
        id: "air",
        name: "Air",
        grants: { damageResistances: ["lightning"] },
        modifiers: [{ type: "special-speed", movement: "fly", equalToSpeed: true, hover: true }],
        casts: [
          {
            spellId: "chain-lightning",
            saveDc: 18,
            uses: { limit: 5, per: "long-rest", pool: "ring-of-elemental-command-charges" },
            useCost: 3
          },
          { spellId: "feather-fall", saveDc: 18 },
          {
            spellId: "gust-of-wind",
            saveDc: 18,
            uses: { limit: 5, per: "long-rest", pool: "ring-of-elemental-command-charges" },
            useCost: 2
          },
          {
            spellId: "wind-wall",
            saveDc: 18,
            uses: { limit: 5, per: "long-rest", pool: "ring-of-elemental-command-charges" }
          }
        ]
      },
      {
        id: "earth",
        name: "Earth",
        grants: { damageResistances: ["acid"] },
        casts: [
          {
            spellId: "earthquake",
            saveDc: 18,
            uses: { limit: 5, per: "long-rest", pool: "ring-of-elemental-command-charges" },
            useCost: 5
          },
          {
            spellId: "stone-shape",
            saveDc: 18,
            uses: { limit: 5, per: "long-rest", pool: "ring-of-elemental-command-charges" },
            useCost: 2
          },
          {
            spellId: "stoneskin",
            saveDc: 18,
            uses: { limit: 5, per: "long-rest", pool: "ring-of-elemental-command-charges" },
            useCost: 3
          },
          {
            spellId: "wall-of-stone",
            saveDc: 18,
            uses: { limit: 5, per: "long-rest", pool: "ring-of-elemental-command-charges" },
            useCost: 3
          }
        ]
      },
      {
        id: "fire",
        name: "Fire",
        grants: { damageImmunities: ["fire"] },
        casts: [
          {
            spellId: "burning-hands",
            saveDc: 18,
            uses: { limit: 5, per: "long-rest", pool: "ring-of-elemental-command-charges" }
          },
          {
            spellId: "fireball",
            saveDc: 18,
            uses: { limit: 5, per: "long-rest", pool: "ring-of-elemental-command-charges" },
            useCost: 2
          },
          {
            spellId: "fire-storm",
            saveDc: 18,
            uses: { limit: 5, per: "long-rest", pool: "ring-of-elemental-command-charges" },
            useCost: 4
          },
          {
            spellId: "wall-of-fire",
            saveDc: 18,
            uses: { limit: 5, per: "long-rest", pool: "ring-of-elemental-command-charges" },
            useCost: 3
          }
        ]
      },
      {
        id: "water",
        name: "Water",
        modifiers: [{ type: "special-speed", movement: "swim", feet: 60 }],
        casts: [
          {
            spellId: "create-or-destroy-water",
            saveDc: 18,
            uses: { limit: 5, per: "long-rest", pool: "ring-of-elemental-command-charges" }
          },
          {
            spellId: "ice-storm",
            saveDc: 18,
            uses: { limit: 5, per: "long-rest", pool: "ring-of-elemental-command-charges" },
            useCost: 2
          },
          {
            spellId: "tsunami",
            saveDc: 18,
            uses: { limit: 5, per: "long-rest", pool: "ring-of-elemental-command-charges" },
            useCost: 5
          },
          {
            spellId: "wall-of-ice",
            saveDc: 18,
            uses: { limit: 5, per: "long-rest", pool: "ring-of-elemental-command-charges" },
            useCost: 3
          },
          {
            spellId: "water-walk",
            saveDc: 18,
            uses: { limit: 5, per: "long-rest", pool: "ring-of-elemental-command-charges" },
            useCost: 2
          }
        ]
      }
    ]
  },

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

  // "You can take a Magic action to give yourself the Invisible condition. You remain Invisible until the ring is
  // removed or until you take a Bonus Action to become visible again": its wearer ends it from the sheet.
  "ring-of-invisibility": {
    actions: [
      {
        id: "vanish",
        name: "Turn Invisible",
        activation: "action",
        description:
          "Give yourself the Invisible condition. You remain Invisible until the ring is removed or until you take a Bonus Action to become visible again.",
        damage: [],
        grants: {
          name: "Ring of Invisibility",
          tags: ["invisible-by-ring"],
          duration: { type: "manual" },
          conditions: ["invisible"]
        }
      }
    ]
  },

  /** "While wearing this ring, you can cast Jump from it, but can target only yourself." */
  "ring-of-jumping": { casts: [{ spellId: "jump", targets: { who: "self" } }] },

  // "You are immune to magic that allows other creatures to read your thoughts, determine whether you're lying, know
  // your alignment, or know your creature type": Detect Thoughts, Zone of Truth and Detect Evil and Good don't reach the
  // wearer. Telepathy by consent and the soul the ring keeps are the GM's.
  "ring-of-mind-shielding": {
    modifiers: [
      {
        type: "spell-ward",
        spellIds: ["detect-thoughts", "zone-of-truth", "detect-evil-and-good"],
        typeSenses: true
      }
    ]
  },

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
   * The two cantrips are at will, and Faerie Fire costs a charge at its wearer's DC. Shooting Stars places a Cube for
   * each charge spent, up to 3. The Lightning Spheres, for 2 charges, are up to four areas held on the wearer's
   * Concentration for a minute, each discharging once at the first creature within 5 feet of it, for less damage the
   * more were made. Not modeled: the spheres' Dim Light, and their Bonus Action move, which is a drag of their area.
   */
  "ring-of-shooting-stars": {
    charges: { regain: "1d6" },
    casts: [
      { spellId: "dancing-lights" },
      { spellId: "light" },
      { spellId: "faerie-fire", uses: { limit: 6, per: "long-rest", pool: "ring-of-shooting-stars-charges" } }
    ],
    actions: [
      {
        id: "shooting-stars",
        name: "Shooting Stars",
        activation: "action",
        area: { shape: "cube", sizeFeet: 15, widthFeet: null, count: 3, eachCostsAUse: true },
        description:
          "Expend 1 to 3 charges. For every charge you expend, launch a glowing mote of light at a point within 60 feet. Each creature in a 15-foot Cube originating from that point makes a DC 15 Dexterity saving throw, taking 5d4 Radiant damage on a failed save or half as much damage on a successful one.",
        save: { ability: "dex", dc: 15, successDamage: "half", failureConditions: [] },
        damage: [{ formula: "5d4", type: "radiant" }],
        uses: { limit: 6, per: "long-rest", pool: "ring-of-shooting-stars-charges" }
      },
      {
        id: "lightning-spheres",
        name: "Lightning Spheres",
        activation: "action",
        area: { shape: "sphere", sizeFeet: 5, widthFeet: null, count: 4 },
        description:
          "Expend 2 charges to create up to four spheres of lightning within 120 feet, lasting while you keep Concentration, up to 1 minute. The first time a sphere comes within 5 feet of a creature other than you, it discharges at that creature and disappears: a DC 15 Dexterity saving throw, taking Lightning damage by the number of spheres made (one 4d12, two 5d4, three 2d6, four 2d4) on a failure, or half on a success. As a Bonus Action, move each sphere up to 30 feet.",
        save: { ability: "dex", dc: 15, successDamage: "half", failureConditions: [] },
        damage: [{ formula: "4d12", type: "lightning" }],
        useCost: 2,
        uses: { limit: 6, per: "long-rest", pool: "ring-of-shooting-stars-charges" },
        zone: {
          on: ["enter"],
          around: "point",
          feet: 5,
          once: true,
          sparesUser: true,
          concentration: true,
          lastsRounds: 10,
          damageByCount: ["4d12", "5d4", "2d6", "2d4"]
        }
      }
    ]
  },

  // `ring-of-spell-storing` - needs per-copy storage and the original caster's numbers.
  // "You have Advantage on saving throws against spells." Turning a spell back on its caster is the GM's.
  "ring-of-spell-turning": {
    modifiers: [
      {
        type: "roll-mode",
        roll: "save",
        mode: "advantage",
        when: [{ type: "on-saving-throw" }, { type: "versus-spell" }]
      }
    ]
  },
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

  // "If you take Cold damage while wearing this ring, the ring reduces the damage you take by 2d8." Extreme cold is the
  // GM's.
  "ring-of-warmth": {
    modifiers: [
      {
        type: "damage-reduction",
        amount: 0,
        dice: "2d8",
        when: [{ type: "on-taking-damage" }, { type: "damage-type-is", damageTypes: ["cold"] }]
      }
    ]
  },

  /** "While wearing this ring, you cast Water Walk from it, targeting only yourself." */
  "ring-of-water-walking": { casts: [{ spellId: "water-walk", targets: { who: "self" } }] },

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
   * Initiative and Wisdom (Perception) advantage, four at-will detection casts, and the Protective Aura once a dawn:
   * the planted rod's light and the area it holds its user and allies in.
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
        sight: { light: { on: "point", brightFeet: 60, dimFeet: 60 }, rounds: 100 },
        // Its Bright Light gives its user and allies in it +1 to AC and saves, and shows them the Invisible creatures
        // there, while it stays planted where its user stood.
        zone: {
          on: [],
          around: "caster",
          feet: 60,
          stays: true,
          affects: "allies",
          lastsRounds: 100,
          holds: {
            armorClassBonus: 1,
            modifiers: [
              { type: "save-bonus", amount: 1 },
              { type: "sense", sense: "see-invisibility", feet: 60 }
            ]
          }
        }
      }
    ]
  },

  // A +3 Mace, Drain Life and Paralyze on its melee hits, and Terrify. Its buttons are forms its holder picks with a
  // Bonus Action: a flaming Longsword or Shortsword (2d6 Fire, its light, no +3), a +3 Battleaxe or Spear, a climbing
  // pole or a battering ram (+10 to Strength (Athletics) checks to break through barriers); its own form is the Mace.
  // Not modeled: the pole's length and weight, and the north and depth it tells (button 6). Drain Life's healing is
  // said with the hit.
  "rod-of-lordly-might": {
    variantChoice: { by: "holder", activation: "bonus-action" },
    variants: [
      {
        id: "flame-longsword",
        name: "Flaming Longsword",
        replacesRiders: true,
        weapon: {
          category: "martial",
          damageDice: "1d8",
          damageType: "slashing",
          rangeFeet: null,
          longRangeFeet: null,
          melee: true,
          versatileDice: "1d10",
          mastery: "sap",
          properties: ["versatile"]
        },
        modifiers: [
          {
            type: "extra-damage",
            formula: "2d6",
            damageType: "fire",
            doubleOnCritical: true,
            when: [{ type: "on-hit" }]
          }
        ],
        light: { brightFeet: 40, dimFeet: 40, always: true }
      },
      {
        id: "flame-shortsword",
        name: "Flaming Shortsword",
        replacesRiders: true,
        weapon: {
          category: "martial",
          damageDice: "1d6",
          damageType: "piercing",
          rangeFeet: null,
          longRangeFeet: null,
          melee: true,
          mastery: "vex",
          properties: ["finesse", "light"]
        },
        modifiers: [
          {
            type: "extra-damage",
            formula: "2d6",
            damageType: "fire",
            doubleOnCritical: true,
            when: [{ type: "on-hit" }]
          }
        ],
        light: { brightFeet: 40, dimFeet: 40, always: true }
      },
      {
        id: "battleaxe",
        name: "Battleaxe",
        weapon: {
          category: "martial",
          damageDice: "1d8",
          damageType: "slashing",
          rangeFeet: null,
          longRangeFeet: null,
          melee: true,
          versatileDice: "1d10",
          mastery: "topple",
          properties: ["versatile"]
        }
      },
      {
        id: "spear",
        name: "Spear",
        weapon: {
          category: "simple",
          damageDice: "1d6",
          damageType: "piercing",
          rangeFeet: 20,
          longRangeFeet: 60,
          melee: true,
          versatileDice: "1d8",
          mastery: "sap",
          properties: ["thrown", "versatile"]
        }
      },
      { id: "climbing-pole", name: "Climbing pole", weapon: null, replacesRiders: true },
      {
        id: "battering-ram",
        name: "Battering ram",
        weapon: null,
        replacesRiders: true,
        modifiers: [
          {
            type: "check-bonus",
            amount: 10,
            when: [
              { type: "on-ability-check" },
              { type: "skill-is", skills: ["athletics"] },
              { type: "situation-is", situation: "breaking through a door, barricade or other barrier" }
            ]
          }
        ]
      }
    ],
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
        // Eight hours, ended early by harm from its user's side; a command against its nature is the GM's.
        save: {
          ability: "wis",
          dc: 15,
          successDamage: "none",
          failureConditions: ["charmed"],
          failureDuration: { type: "minutes", minutes: 480 },
          endsOnSourceSideDamage: true
        },
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

  // Thrown within 10 feet, it becomes a Giant Constrictor Snake that shares its user's Initiative and acts right after,
  // commanded within 60 feet, defending itself otherwise; a Bonus Action turns it back into the staff. The hour before
  // it can be used again, and the staff shattering when the snake dies, are the table's.
  "staff-of-the-python": {
    actions: [
      {
        id: "snake",
        name: "Throw the Staff",
        activation: "action",
        description:
          "Throw the staff so that it lands in an unoccupied space within 10 feet, where it becomes a Giant Constrictor Snake under your control. It shares your Initiative count and takes its turn immediately after yours. You command it while it is within 60 feet of you; absent commands, it defends itself. A Bonus Action turns it back into the staff.",
        summons: {
          creatures: [{ monsterId: "giant-constrictor-snake" }],
          rangeFeet: 10,
          commandFeet: 60,
          dodgesUncommanded: true,
          dismiss: "bonus-action"
        }
      }
    ]
  },

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

  // The bonus to spell attack rolls by rarity, and "you ignore Half Cover when making a spell attack roll".
  "wand-of-the-war-mage-1": { modifiers: [{ type: "spell-attack-bonus", amount: 1 }, ignoresHalfCoverOnSpells()] },
  "wand-of-the-war-mage-2": { modifiers: [{ type: "spell-attack-bonus", amount: 2 }, ignoresHalfCoverOnSpells()] },
  "wand-of-the-war-mage-3": { modifiers: [{ type: "spell-attack-bonus", amount: 3 }, ignoresHalfCoverOnSpells()] },

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
      // Toughness: "Your Constitution increases by 2, to a maximum of 20."
      { type: "ability-score", ability: "con", amount: 2, maximum: 20 },
      { type: "darkvision", feet: 60 },
      {
        type: "roll-mode",
        roll: "save",
        mode: "advantage",
        when: [{ type: "on-saving-throw" }, { type: "versus-condition", conditionIds: ["poisoned"] }]
      }
    ]
  },
  // "Your Strength changes to a score granted by the belt": the GM says which giant a found belt is. "The item has no
  // effect on you if your Strength without the belt is equal to or greater than the belt's score."
  "belt-of-giant-strength": {
    variants: [
      { id: "hill", name: "Hill giant (21)", modifiers: [strengthOf(21)] },
      { id: "frost", name: "Frost giant (23)", modifiers: [strengthOf(23)] },
      { id: "stone", name: "Stone giant (23)", modifiers: [strengthOf(23)] },
      { id: "fire", name: "Fire giant (25)", modifiers: [strengthOf(25)] },
      { id: "cloud", name: "Cloud giant (27)", modifiers: [strengthOf(27)] },
      { id: "storm", name: "Storm giant (29)", modifiers: [strengthOf(29)] }
    ]
  },

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
  // A Bonus Action clicks the heels: Speed doubled and Disadvantage on Opportunity Attacks against the wearer, for its 10
  // minutes a Long Rest. Clicking again ends it, and the minutes left over are the GM's to count.
  "boots-of-speed": {
    actions: [
      {
        id: "click-heels",
        name: "Click the Heels",
        activation: "bonus-action",
        description:
          "The boots double your Speed, and any creature that makes an Opportunity Attack against you has Disadvantage on the attack roll. Click your heels again to end it. When you've used the boots for a total of 10 minutes, they cease to function for you until you finish a Long Rest.",
        damage: [],
        uses: { limit: 1, per: "long-rest" },
        grants: {
          name: "Boots of Speed",
          tags: ["boots-of-speed"],
          duration: { type: "rounds", rounds: 100 },
          speedMultiplier: 2,
          modifiers: [
            {
              type: "roll-mode",
              roll: "incoming-attack",
              mode: "disadvantage",
              when: [{ type: "on-attack-roll" }, { type: "attack-kind-is", kinds: ["opportunity"] }]
            }
          ]
        }
      }
    ]
  },
  // "Your Speed becomes 30 feet unless your Speed is higher, and your Speed isn't reduced by ... wearing Heavy Armor",
  // and "Once on each of your turns, you can jump up to 30 feet by spending only 10 feet of movement": a leap the jump
  // rules read. The carried weight half waits for carrying capacity.
  "boots-of-striding-and-springing": {
    modifiers: [
      { type: "speed-minimum", feet: 30, ignoresArmor: true },
      { type: "movement", rule: "leap", feet: 30, costFeet: 10 }
    ]
  },
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

  // `grants.weapons` accepts base weapon ids as well as categories; the +2 rides attacks with a Longbow or a Shortbow,
  // a magic one bound to either included.
  "bracers-of-archery": {
    grants: { weapons: ["longbow", "shortbow"] },
    modifiers: [
      {
        type: "damage-bonus",
        amount: 2,
        when: [{ type: "on-damage-roll" }, { type: "weapon-is", ids: ["longbow", "shortbow"] }]
      }
    ]
  },

  // `while-unarmored` (default `allowShield: false`) is "no armor and no Shield" exactly.
  "bracers-of-defense": {
    modifiers: [{ type: "armor-class", amount: 2, when: [{ type: "while-unarmored" }] }]
  },

  /** "Your Strength is 19 while you wear these gauntlets. They have no effect on you if your Strength is 19 or higher." */
  "gauntlets-of-ogre-power": { modifiers: [strengthOf(19)] },

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

  // A Climb Speed and a Swim Speed equal to Speed, and +5 to Strength (Athletics) checks made to climb or swim.
  "gloves-of-swimming-and-climbing": {
    modifiers: [
      { type: "special-speed", movement: "climb", equalToSpeed: true },
      { type: "special-speed", movement: "swim", equalToSpeed: true },
      {
        type: "check-bonus",
        amount: 5,
        when: [
          { type: "on-ability-check" },
          { type: "skill-is", skills: ["athletics"] },
          { type: "situation-is", situation: "climbing or swimming" }
        ]
      }
    ]
  },

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

  // "You can cast Scorching Ray with it (+5 to hit)", once a dawn: the circlet's own bonus, whoever wears it.
  "circlet-of-blasting": {
    casts: [{ spellId: "scorching-ray", attackBonus: 5, uses: { limit: 1, per: "long-rest" } }]
  },

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

  // Advantage on Intelligence (Investigation) checks "made to examine something within" a foot, a situation the roller
  // names. Its foot of Darkvision is too short to reach a square.
  "eyes-of-minute-seeing": {
    modifiers: [
      {
        type: "roll-mode",
        roll: "check",
        mode: "advantage",
        when: [
          { type: "on-ability-check" },
          { type: "skill-is", skills: ["investigation"] },
          { type: "situation-is", situation: "examining something within 1 foot" }
        ]
      }
    ]
  },
  // "Advantage on Wisdom (Perception) checks that rely on sight", a situation the roller names. Seeing far is the GM's.
  "eyes-of-the-eagle": {
    modifiers: [
      {
        type: "roll-mode",
        roll: "check",
        mode: "advantage",
        when: [
          { type: "on-ability-check" },
          { type: "skill-is", skills: ["perception"] },
          { type: "situation-is", situation: "relying on sight" }
        ]
      }
    ]
  },

  /** "While wearing these dark lenses, you have Darkvision out to 60 feet. If you already have Darkvision, wearing the
   *  goggles increases its range by 60 feet." */
  "goggles-of-night": { modifiers: [{ type: "darkvision", feet: 60, extends: true }] },

  // An unlimited self-cast with no damage, attack or save.
  "hat-of-disguise": { casts: [{ spellId: "disguise-self" }] },

  /** "Your Intelligence is 19 while you wear this headband", or no change from a higher one. */
  "headband-of-intellect": { modifiers: [{ type: "ability-score-minimum", ability: "int", score: 19 }] },
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

  // Teleport for a charge of 3, 1d3 back at dawn. Teleport deals nothing as it is cast; its mishap table is the GM's.
  "helm-of-teleportation": {
    charges: { regain: "1d3" },
    casts: [{ spellId: "teleport", uses: { limit: 3, per: "long-rest", pool: "helm-of-teleportation-charges" } }]
  },

  // ---- Neck ------------------------------------------------------------------------------------

  /** "Your Constitution is 19 while you wear this amulet": the Hit Point maximum follows it. */
  "amulet-of-health": { modifiers: [{ type: "ability-score-minimum", ability: "con", score: 19 }] },
  // "You can't be targeted by Divination spells unless you allow it": the wearer's own side's spells reach it. Being
  // perceived through a scrying sensor is the GM's.
  "amulet-of-proof-against-detection-and-location": {
    modifiers: [{ type: "spell-ward", schools: ["divination"], alliesAllowed: true }]
  },
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

  // "Advantage on saving throws made to avoid or end the Poisoned condition"; breathing anywhere is the GM's.
  "necklace-of-adaptation": { modifiers: [poisonedSaves()] },
  /** 1d6 + 3 beads rolled when the necklace is added, each a level 3 Fireball (DC 15) that never comes back. Hurling
   *  several beads at once for more damage is the GM's. */
  "necklace-of-fireballs": {
    charges: { starting: "1d6 + 3", lastCharge: "destroyed" },
    casts: [{ spellId: "fireball", saveDc: 15, uses: { limit: 9, per: "never", pool: "necklace-of-fireballs-beads" } }]
  },
  // `necklace-of-prayer-beads` - the bead composition is per copy, and Cure Wounds has no healing.
  // A Magic action regains 2d4 + 2 Hit Points once a dawn, and saves to avoid or end Poisoned have Advantage.
  "periapt-of-health": {
    modifiers: [poisonedSaves()],
    actions: [
      {
        id: "heal",
        name: "Draw on the Periapt",
        activation: "action",
        description: "Regain 2d4 + 2 Hit Points. Once used, this property can't be used again until the next dawn.",
        damage: [],
        healing: { formula: "2d4 + 2", self: true },
        uses: { limit: 1, per: "long-rest" }
      }
    ]
  },

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

  // +1 AC and Advantage on saves against spells. Preservation's 12 charges, which never come back: a failed save against
  // a Necromancy spell or an Undead's effect becomes a success for a Reaction and a charge, and the last crumbles it.
  "scarab-of-protection": {
    modifiers: [{ type: "armor-class", amount: 1 }, spellSaves()],
    charges: { lastCharge: "destroyed" },
    actions: [
      {
        id: "preserve-necromancy",
        name: "Preservation (Necromancy spell)",
        activation: "reaction",
        description:
          "When you fail a saving throw against a Necromancy spell, take a Reaction and expend 1 charge to succeed instead. The scarab crumbles into powder when its last charge is expended.",
        uses: { limit: 12, per: "never", pool: "scarab-of-protection-charges" },
        answer: {
          rolls: ["save"],
          when: "failure",
          versus: { spellSchools: ["necromancy"] },
          effect: { kind: "succeed" }
        }
      },
      {
        id: "preserve-undead",
        name: "Preservation (Undead)",
        activation: "reaction",
        description:
          "When you fail a saving throw against a harmful effect originating from an Undead, take a Reaction and expend 1 charge to succeed instead. The scarab crumbles into powder when its last charge is expended.",
        uses: { limit: 12, per: "never", pool: "scarab-of-protection-charges" },
        answer: { rolls: ["save"], when: "failure", versus: { creatureTypes: ["undead"] }, effect: { kind: "succeed" } }
      }
    ]
  },

  // The +2 to spell attack rolls. The touch damage by creature type and the charges that destroy a creature are not
  // authored.
  "talisman-of-pure-good": { modifiers: [{ type: "spell-attack-bonus", amount: 2 }] },
  "talisman-of-ultimate-evil": { modifiers: [{ type: "spell-attack-bonus", amount: 2 }] },
  // `talisman-of-the-sphere` - read by Control the Sphere (Advantage) and Move the Sphere (Talisman) while attuned
  // (`zone-sphere.ts`); it carries nothing of its own.

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
        uses: { limit: 3, per: "long-rest", pool: "cloak-of-invisibility-charges" },
        // Pulling the hood down is ending it from the sheet; taking the cloak off ends it too.
        grants: {
          name: "Cloak of Invisibility",
          tags: ["invisible-by-cloak"],
          duration: { type: "minutes", minutes: 60 },
          conditions: ["invisible"]
        }
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

  // "You have a Swim Speed of 60 feet"; breathing underwater is the GM's.
  "cloak-of-the-manta-ray": { modifiers: [{ type: "special-speed", movement: "swim", feet: 60 }] },
  /** "You have Advantage on saving throws against spells while you wear this cloak." */
  "mantle-of-spell-resistance": { modifiers: [spellSaves()] },
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

  // Without armor its base AC is 15 plus Dexterity, chosen like Unarmored Defense; Advantage on saves against spells and
  // other magical effects; and +2 to its wearer's own spell save DC and spell attack rolls.
  "robe-of-the-archmagi": {
    modifiers: [
      { type: "base-armor-class", base: 15 },
      {
        type: "roll-mode",
        roll: "save",
        mode: "advantage",
        when: [{ type: "on-saving-throw" }, { type: "versus-magic" }]
      },
      { type: "spell-save-dc", amount: 2 },
      { type: "spell-attack-bonus", amount: 2 }
    ]
  },

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

  // Three pulls a day, one action per bag colour: the server rolls the d8 on that colour's table and the creature joins
  // the map within 20 feet, acting right after its user, until the next dawn (a Long Rest) or 0 Hit Points.
  "bag-of-tricks": {
    variants: [
      {
        id: "gray",
        name: "Gray bag",
        actions: [
          {
            id: "pull-gray",
            name: "Pull a Fuzzy Object (Gray bag)",
            activation: "action",
            description:
              "Pull the fuzzy object from the gray bag and throw it up to 20 feet. When it lands, it becomes the creature a d8 picks on the gray bag's table. The creature vanishes at the next dawn or at 0 Hit Points. It is Friendly to you and your allies and acts immediately after you on your Initiative count; a Bonus Action commands how it moves and what it does on its next turn.",
            uses: { limit: 3, per: "long-rest", pool: "bag-of-tricks-charges" },
            summons: {
              creatures: [
                { monsterId: "weasel", faces: { from: 1, to: 1 } },
                { monsterId: "giant-rat", faces: { from: 2, to: 2 } },
                { monsterId: "badger", faces: { from: 3, to: 3 } },
                { monsterId: "boar", faces: { from: 4, to: 4 } },
                { monsterId: "panther", faces: { from: 5, to: 5 } },
                { monsterId: "giant-badger", faces: { from: 6, to: 6 } },
                { monsterId: "dire-wolf", faces: { from: 7, to: 7 } },
                { monsterId: "giant-elk", faces: { from: 8, to: 8 } }
              ],
              die: 8,
              rangeFeet: 20,
              lasts: { type: "until-long-rest" },
              commandedWith: "bonus-action"
            }
          }
        ]
      },
      {
        id: "rust",
        name: "Rust bag",
        actions: [
          {
            id: "pull-rust",
            name: "Pull a Fuzzy Object (Rust bag)",
            activation: "action",
            description:
              "Pull the fuzzy object from the rust bag and throw it up to 20 feet. When it lands, it becomes the creature a d8 picks on the rust bag's table. The creature vanishes at the next dawn or at 0 Hit Points. It is Friendly to you and your allies and acts immediately after you on your Initiative count; a Bonus Action commands how it moves and what it does on its next turn.",
            uses: { limit: 3, per: "long-rest", pool: "bag-of-tricks-charges" },
            summons: {
              creatures: [
                { monsterId: "rat", faces: { from: 1, to: 1 } },
                { monsterId: "owl", faces: { from: 2, to: 2 } },
                { monsterId: "mastiff", faces: { from: 3, to: 3 } },
                { monsterId: "goat", faces: { from: 4, to: 4 } },
                { monsterId: "giant-goat", faces: { from: 5, to: 5 } },
                { monsterId: "giant-boar", faces: { from: 6, to: 6 } },
                { monsterId: "lion", faces: { from: 7, to: 7 } },
                { monsterId: "brown-bear", faces: { from: 8, to: 8 } }
              ],
              die: 8,
              rangeFeet: 20,
              lasts: { type: "until-long-rest" },
              commandedWith: "bonus-action"
            }
          }
        ]
      },
      {
        id: "tan",
        name: "Tan bag",
        actions: [
          {
            id: "pull-tan",
            name: "Pull a Fuzzy Object (Tan bag)",
            activation: "action",
            description:
              "Pull the fuzzy object from the tan bag and throw it up to 20 feet. When it lands, it becomes the creature a d8 picks on the tan bag's table. The creature vanishes at the next dawn or at 0 Hit Points. It is Friendly to you and your allies and acts immediately after you on your Initiative count; a Bonus Action commands how it moves and what it does on its next turn.",
            uses: { limit: 3, per: "long-rest", pool: "bag-of-tricks-charges" },
            summons: {
              creatures: [
                { monsterId: "jackal", faces: { from: 1, to: 1 } },
                { monsterId: "ape", faces: { from: 2, to: 2 } },
                { monsterId: "baboon", faces: { from: 3, to: 3 } },
                { monsterId: "axe-beak", faces: { from: 4, to: 4 } },
                { monsterId: "black-bear", faces: { from: 5, to: 5 } },
                { monsterId: "giant-weasel", faces: { from: 6, to: 6 } },
                { monsterId: "giant-hyena", faces: { from: 7, to: 7 } },
                { monsterId: "tiger", faces: { from: 8, to: 8 } }
              ],
              die: 8,
              rangeFeet: 20,
              lasts: { type: "until-long-rest" },
              commandedWith: "bonus-action"
            }
          }
        ]
      }
    ]
  },

  // Thrown up to 60 feet, it bursts in a 10-foot-radius Sphere: a DC 15 Dexterity save or 5d4 Force damage, and a
  // creature that fails is shut in a sphere of force for 1 minute that no attack or effect passes (`enclosures.ts`).
  // Pushing out the creatures that saved, and rolling the sphere along, are the GM's.
  "bead-of-force": {
    consumedOnUse: true,
    actions: [
      {
        id: "throw",
        name: "Throw Bead of Force",
        activation: "action",
        description:
          "Throw the bead up to 60 feet. It explodes in a 10-foot-radius Sphere: each creature in it makes a DC 15 Dexterity saving throw or takes 5d4 Force damage. A sphere of transparent force then encloses the area for 1 minute, trapping each creature that failed and is completely inside. No attack or other effect can pass through its wall.",
        save: {
          ability: "dex",
          dc: 15,
          successDamage: "none",
          failureConditions: [],
          failureEffect: {
            name: "Bead of Force",
            tags: ["enclosed"],
            duration: { type: "rounds", rounds: 10 },
            modifiers: []
          }
        },
        damage: [{ formula: "5d4", type: "force" }],
        area: { shape: "sphere", sizeFeet: 10, widthFeet: null }
      }
    ]
  },
  // `bead-of-nourishment` - no hunger model.

  /**
   * The four elemental-commanding items (`bowl-of-commanding-water-elementals`,
   * `brazier-of-commanding-fire-elementals`, `censer-of-controlling-air-elementals`,
   * `stone-of-controlling-earth-elementals`): once per dawn, the elemental joins the map on its user's side, acts right
   * after its user, and leaves after 1 hour, at 0 Hit Points or when its user dismisses it as a Bonus Action. Being near
   * the bowl or the brazier is the table's. Each description follows its own row's wording.
   */
  "bowl-of-commanding-water-elementals": {
    actions: [
      {
        id: "summon",
        name: "Summon Water Elemental",
        activation: "action",
        description:
          "While this bowl is filled with water and you are within 5 feet of it, summon a Water Elemental. It appears in an unoccupied space as close to the bowl as possible, understands your languages, obeys your commands, and takes its turn immediately after you on your Initiative count. It disappears after 1 hour, when it dies, or when you dismiss it as a Bonus Action. The bowl can't be used this way again until the next dawn.",
        summons: {
          creatures: [{ monsterId: "water-elemental" }],
          rangeFeet: 10,
          lasts: { type: "minutes", minutes: 60 },
          dismiss: "bonus-action"
        },
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
        summons: {
          creatures: [{ monsterId: "fire-elemental" }],
          rangeFeet: 10,
          lasts: { type: "minutes", minutes: 60 },
          dismiss: "bonus-action"
        },
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
        summons: {
          creatures: [{ monsterId: "air-elemental" }],
          rangeFeet: 10,
          lasts: { type: "minutes", minutes: 60 },
          dismiss: "bonus-action"
        },
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
  // 1d6 + 4 pinches. A pinch on an Elemental of water within 5 feet: DC 13 Constitution, 10d6 Necrotic, half on a
  // success. Turning water into a pellet is the GM's.
  "dust-of-dryness": {
    charges: { starting: "1d6 + 4" },
    actions: [
      {
        id: "sprinkle",
        name: "Sprinkle a Pinch on an Elemental",
        activation: "action",
        description:
          "Sprinkle a pinch on an Elemental within 5 feet of you that is composed mostly of water (such as a Water Elemental). It makes a DC 13 Constitution saving throw, taking 10d6 Necrotic damage on a failed save or half as much on a successful one.",
        damage: [{ formula: "10d6", type: "necrotic" }],
        save: { ability: "con", dc: 13, successDamage: "half", failureConditions: [] },
        uses: { limit: 10, per: "never", pool: "dust-of-dryness-pinches" },
        targets: { count: 1, rangeFeet: 5, creatureTypes: ["elemental"] }
      }
    ]
  },
  // Thrown into the air, it makes its thrower and every creature in a 30-foot Emanation save (DC 15 Constitution) or be
  // Incapacitated with sneezing, repeating the save at the end of each turn. Constructs, Elementals, Oozes, Plants and
  // Undead succeed, so none of them is a target. Suffocating is the GM's.
  "dust-of-sneezing-and-choking": {
    consumedOnUse: true,
    actions: [
      {
        id: "throw",
        name: "Throw the Dust",
        activation: "action",
        description:
          "Throw the dust into the air: you and every creature in a 30-foot Emanation originating from you make a DC 15 Constitution saving throw. Constructs, Elementals, Oozes, Plants and Undead succeed automatically. On a failed save, a creature sneezes uncontrollably: it has the Incapacitated condition and is suffocating, repeating the save at the end of each of its turns.",
        damage: [],
        save: {
          ability: "con",
          dc: 15,
          successDamage: "none",
          failureConditions: ["incapacitated"],
          repeatSave: true
        },
        area: { shape: "emanation", sizeFeet: 30, widthFeet: null },
        targets: { notCreatureTypes: ["construct", "elemental", "ooze", "plant", "undead"] }
      }
    ]
  },
  // `efficient-quiver` - a container.
  // Opened, an Efreeti appears within 30 feet and the server rolls the d10: on a 1 it attacks its user and leaves after 5
  // rounds; on 2 to 9 it obeys for 1 hour; on a 10 it grants a Wish (the GM's) and leaves within the hour. That the
  // first roll sets every later opening, the 24 hours between openings and the bottle losing its magic are the
  // table's.
  "efreeti-bottle": {
    actions: [
      {
        id: "open",
        name: "Open the Bottle",
        activation: "action",
        description:
          "Remove the stopper: an Efreeti appears in an unoccupied space within 30 feet, and the d10 says what it does. 1: it attacks you, and disappears after fighting for 5 rounds. 2-9: it understands your languages and obeys your commands for 1 hour. 10: it can cast Wish once for you, and disappears when it grants the wish or after 1 hour.",
        summons: {
          creatures: [
            { monsterId: "efreeti", faces: { from: 1, to: 1 }, allegiance: "hostile", rounds: 5 },
            { monsterId: "efreeti", faces: { from: 2, to: 9 } },
            { monsterId: "efreeti", faces: { from: 10, to: 10 } }
          ],
          die: 10,
          rangeFeet: 30,
          lasts: { type: "minutes", minutes: 60 }
        }
      }
    ]
  },
  // Broken (a Utilize action), the gem summons the elemental its stone names, which obeys its user and acts right after
  // it, for 1 hour, until it dies, or until a Bonus Action dismisses it. The gem is used up.
  "elemental-gem": {
    consumedOnUse: true,
    variants: [
      {
        id: "blue-sapphire",
        name: "Blue sapphire (Air Elemental)",
        actions: [
          {
            id: "break-blue-sapphire",
            name: "Break the Gem (Blue sapphire)",
            activation: "action",
            description:
              "Break the blue sapphire: an Air Elemental appears in an unoccupied space as close to the gem as possible, understands your languages, obeys your commands and takes its turn immediately after you on your Initiative count. It disappears after 1 hour, when it dies, or when you dismiss it as a Bonus Action.",
            summons: {
              creatures: [{ monsterId: "air-elemental" }],
              rangeFeet: 5,
              lasts: { type: "minutes", minutes: 60 },
              dismiss: "bonus-action"
            }
          }
        ]
      },
      {
        id: "emerald",
        name: "Emerald (Water Elemental)",
        actions: [
          {
            id: "break-emerald",
            name: "Break the Gem (Emerald)",
            activation: "action",
            description:
              "Break the emerald: a Water Elemental appears in an unoccupied space as close to the gem as possible, understands your languages, obeys your commands and takes its turn immediately after you on your Initiative count. It disappears after 1 hour, when it dies, or when you dismiss it as a Bonus Action.",
            summons: {
              creatures: [{ monsterId: "water-elemental" }],
              rangeFeet: 5,
              lasts: { type: "minutes", minutes: 60 },
              dismiss: "bonus-action"
            }
          }
        ]
      },
      {
        id: "red-corundum",
        name: "Red corundum (Fire Elemental)",
        actions: [
          {
            id: "break-red-corundum",
            name: "Break the Gem (Red corundum)",
            activation: "action",
            description:
              "Break the red corundum: a Fire Elemental appears in an unoccupied space as close to the gem as possible, understands your languages, obeys your commands and takes its turn immediately after you on your Initiative count. It disappears after 1 hour, when it dies, or when you dismiss it as a Bonus Action.",
            summons: {
              creatures: [{ monsterId: "fire-elemental" }],
              rangeFeet: 5,
              lasts: { type: "minutes", minutes: 60 },
              dismiss: "bonus-action"
            }
          }
        ]
      },
      {
        id: "yellow-diamond",
        name: "Yellow diamond (Earth Elemental)",
        actions: [
          {
            id: "break-yellow-diamond",
            name: "Break the Gem (Yellow diamond)",
            activation: "action",
            description:
              "Break the yellow diamond: an Earth Elemental appears in an unoccupied space as close to the gem as possible, understands your languages, obeys your commands and takes its turn immediately after you on your Initiative count. It disappears after 1 hour, when it dies, or when you dismiss it as a Bonus Action.",
            summons: {
              creatures: [{ monsterId: "earth-elemental" }],
              rangeFeet: 5,
              lasts: { type: "minutes", minutes: 60 },
              dismiss: "bonus-action"
            }
          }
        ]
      }
    ]
  },
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
  // The Bird token: "an enormous, multicolored bird ... has the statistics of a Roc, but it can't attack. It obeys your
  // simple commands", until a Magic action dismisses it or it drops to 0 Hit Points. The token is used up. The Anchor,
  // Fan and Swan Boat act on ships and water travel, and the Tree and the Whip are the table's.
  "feather-token": {
    consumedOnUse: true,
    variants: [
      {
        id: "bird",
        name: "Bird",
        actions: [
          {
            id: "bird",
            name: "Toss the Bird Token",
            activation: "action",
            description:
              "Toss the token 5 feet into the air: it disappears and an enormous, multicolored bird takes its place, with the statistics of a Roc, but it can't attack. It obeys your simple commands and carries up to 500 pounds at its full speed. It disappears after flying its maximum distance for a day or at 0 Hit Points; a Magic action dismisses it.",
            summons: {
              creatures: [{ monsterId: "roc" }],
              rangeFeet: 5,
              noAttacks: true,
              dismiss: "action"
            }
          }
        ]
      },
      { id: "anchor", name: "Anchor" },
      { id: "fan", name: "Fan" },
      { id: "swan-boat", name: "Swan Boat" },
      { id: "tree", name: "Tree" },
      { id: "whip", name: "Whip" }
    ]
  },
  // One action for each figurine (the Ivory Goats' three in one, picked by goat): thrown within 60 feet, it becomes its
  // creature for its time, on its user's side and acting right after its user, defending itself when uncommanded; a
  // Magic action turns it back, and then the figurine waits its days. The Ivory Goats' waits (one action for three
  // goats with three waits), the Goat of Traveling's hourly charges, the Goat of Terror's fear and horns, the Onyx Dog's
  // Blindsight and speech, the Obsidian Steed ignoring orders, and the Silver Raven (an item holds eight actions) are
  // the table's.
  "figurine-of-wondrous-power": {
    variants: [
      {
        id: "bronze-griffon",
        name: "Bronze Griffon",
        actions: [
          {
            id: "bronze-griffon",
            name: "Throw the Bronze Griffon",
            activation: "action",
            description:
              "Throw the figurine to a point on the ground within 60 feet: it becomes a Griffon for up to 6 hours. The creature is Friendly to you and your allies, understands your languages, obeys your commands and takes its turn immediately after you on your Initiative count; if you issue no commands, it defends itself but takes no other actions. It reverts to a figurine at the end of its time, at 0 Hit Points, or when you touch it and take a Magic action.",
            uses: { limit: 1, per: "time", afterHours: "120" },
            summons: {
              creatures: [{ monsterId: "griffon" }],
              rangeFeet: 60,
              lasts: { type: "minutes", minutes: 360 },
              dodgesUncommanded: true,
              dismiss: "action"
            }
          }
        ]
      },
      {
        id: "ebony-fly",
        name: "Ebony Fly",
        actions: [
          {
            id: "ebony-fly",
            name: "Throw the Ebony Fly",
            activation: "action",
            description:
              "Throw the figurine to a point on the ground within 60 feet: it becomes a Giant Fly for up to 12 hours, which can be ridden as a mount. The creature is Friendly to you and your allies, understands your languages, obeys your commands and takes its turn immediately after you on your Initiative count; if you issue no commands, it defends itself but takes no other actions. It reverts to a figurine at the end of its time, at 0 Hit Points, or when you touch it and take a Magic action.",
            uses: { limit: 1, per: "time", afterHours: "48" },
            summons: {
              creatures: [{ monsterId: "giant-fly" }],
              rangeFeet: 60,
              lasts: { type: "minutes", minutes: 720 },
              dodgesUncommanded: true,
              dismiss: "action"
            }
          }
        ]
      },
      {
        id: "golden-lions",
        name: "Golden Lions",
        actions: [
          {
            id: "golden-lions",
            name: "Throw the Golden Lions",
            activation: "action",
            description:
              "Throw the figurine to a point on the ground within 60 feet: it becomes a Lion for up to 1 hour, one for each figurine of the pair thrown. The creature is Friendly to you and your allies, understands your languages, obeys your commands and takes its turn immediately after you on your Initiative count; if you issue no commands, it defends itself but takes no other actions. It reverts to a figurine at the end of its time, at 0 Hit Points, or when you touch it and take a Magic action.",
            uses: { limit: 1, per: "time", afterHours: "168" },
            summons: {
              creatures: [{ monsterId: "lion", count: 2 }],
              rangeFeet: 60,
              lasts: { type: "minutes", minutes: 60 },
              dodgesUncommanded: true,
              dismiss: "action"
            }
          }
        ]
      },
      {
        id: "ivory-goats",
        name: "Ivory Goats",
        actions: [
          {
            id: "ivory-goats",
            name: "Throw the Ivory Goats",
            activation: "action",
            description:
              "Throw the figurine to a point on the ground within 60 feet: it becomes the goat it is: the Goat of Terror a Giant Goat that can't attack, the Goat of Travail a Giant Goat, the Goat of Traveling a Large goat with the statistics of a Riding Horse; each for up to 3 hours. The creature is Friendly to you and your allies, understands your languages, obeys your commands and takes its turn immediately after you on your Initiative count; if you issue no commands, it defends itself but takes no other actions. It reverts to a figurine at the end of its time, at 0 Hit Points, or when you touch it and take a Magic action.",
            summons: {
              creatures: [
                { monsterId: "giant-goat", form: "terror", except: { name: "Goat of Terror" } },
                { monsterId: "giant-goat", form: "travail", except: { name: "Goat of Travail" } },
                { monsterId: "riding-horse", form: "traveling", except: { name: "Goat of Traveling" } }
              ],
              rangeFeet: 60,
              lasts: { type: "minutes", minutes: 180 },
              dodgesUncommanded: true,
              dismiss: "action"
            }
          }
        ]
      },
      {
        id: "marble-elephant",
        name: "Marble Elephant",
        actions: [
          {
            id: "marble-elephant",
            name: "Throw the Marble Elephant",
            activation: "action",
            description:
              "Throw the figurine to a point on the ground within 60 feet: it becomes an Elephant for up to 24 hours. The creature is Friendly to you and your allies, understands your languages, obeys your commands and takes its turn immediately after you on your Initiative count; if you issue no commands, it defends itself but takes no other actions. It reverts to a figurine at the end of its time, at 0 Hit Points, or when you touch it and take a Magic action.",
            uses: { limit: 1, per: "time", afterHours: "168" },
            summons: {
              creatures: [{ monsterId: "elephant" }],
              rangeFeet: 60,
              lasts: { type: "minutes", minutes: 1440 },
              dodgesUncommanded: true,
              dismiss: "action"
            }
          }
        ]
      },
      {
        id: "obsidian-steed",
        name: "Obsidian Steed",
        actions: [
          {
            id: "obsidian-steed",
            name: "Throw the Obsidian Steed",
            activation: "action",
            description:
              "Throw the figurine to a point on the ground within 60 feet: it becomes a Nightmare for up to 24 hours, which fights only to defend itself. The creature is Friendly to you and your allies, understands your languages, obeys your commands and takes its turn immediately after you on your Initiative count; if you issue no commands, it defends itself but takes no other actions. It reverts to a figurine at the end of its time, at 0 Hit Points, or when you touch it and take a Magic action.",
            uses: { limit: 1, per: "time", afterHours: "120" },
            summons: {
              creatures: [{ monsterId: "nightmare" }],
              rangeFeet: 60,
              lasts: { type: "minutes", minutes: 1440 },
              dodgesUncommanded: true,
              dismiss: "action"
            }
          }
        ]
      },
      {
        id: "onyx-dog",
        name: "Onyx Dog",
        actions: [
          {
            id: "onyx-dog",
            name: "Throw the Onyx Dog",
            activation: "action",
            description:
              "Throw the figurine to a point on the ground within 60 feet: it becomes a Mastiff with an Intelligence of 8 for up to 6 hours. The creature is Friendly to you and your allies, understands your languages, obeys your commands and takes its turn immediately after you on your Initiative count; if you issue no commands, it defends itself but takes no other actions. It reverts to a figurine at the end of its time, at 0 Hit Points, or when you touch it and take a Magic action.",
            uses: { limit: 1, per: "time", afterHours: "168" },
            summons: {
              creatures: [{ monsterId: "mastiff", except: { abilityScores: { int: 8 } } }],
              rangeFeet: 60,
              lasts: { type: "minutes", minutes: 360 },
              dodgesUncommanded: true,
              dismiss: "action"
            }
          }
        ]
      },
      {
        id: "serpentine-owl",
        name: "Serpentine Owl",
        actions: [
          {
            id: "serpentine-owl",
            name: "Throw the Serpentine Owl",
            activation: "action",
            description:
              "Throw the figurine to a point on the ground within 60 feet: it becomes a Giant Owl for up to 8 hours. The creature is Friendly to you and your allies, understands your languages, obeys your commands and takes its turn immediately after you on your Initiative count; if you issue no commands, it defends itself but takes no other actions. It reverts to a figurine at the end of its time, at 0 Hit Points, or when you touch it and take a Magic action.",
            uses: { limit: 1, per: "time", afterHours: "48" },
            summons: {
              creatures: [{ monsterId: "giant-owl" }],
              rangeFeet: 60,
              lasts: { type: "minutes", minutes: 480 },
              dodgesUncommanded: true,
              dismiss: "action"
            }
          }
        ]
      },
      { id: "silver-raven", name: "Silver Raven" }
    ]
  },
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
  // One action for each metal: its number of Berserkers within 60 feet for 1 hour, obeying the user who meets the
  // horn's requirement (checked on the sheet) and attacking one who doesn't, immune to Charmed and Frightened; then 7
  // days before it sounds again.
  "horn-of-valhalla": {
    variants: [
      {
        id: "silver",
        name: "Silver horn",
        actions: [
          {
            id: "blow-silver",
            name: "Blow the Horn (Silver)",
            activation: "action",
            description:
              "Blow the silver horn: 2 warrior spirits from Ysgard appear in unoccupied spaces within 60 feet, each using the Berserker stat block, with Immunity to the Charmed and Frightened conditions. They return to Ysgard after 1 hour or at 0 Hit Points. Requirement: none. If you meet it, they are Friendly to you and your allies and follow your commands; if not, they attack you.",
            uses: { limit: 1, per: "time", afterHours: "168" },
            summons: {
              creatures: [
                { monsterId: "berserker", count: 2, except: { conditionImmunities: ["charmed", "frightened"] } }
              ],
              rangeFeet: 60,
              lasts: { type: "minutes", minutes: 60 }
            }
          }
        ]
      },
      {
        id: "brass",
        name: "Brass horn",
        actions: [
          {
            id: "blow-brass",
            name: "Blow the Horn (Brass)",
            activation: "action",
            description:
              "Blow the brass horn: 3 warrior spirits from Ysgard appear in unoccupied spaces within 60 feet, each using the Berserker stat block, with Immunity to the Charmed and Frightened conditions. They return to Ysgard after 1 hour or at 0 Hit Points. Requirement: Proficiency with all Simple weapons. If you meet it, they are Friendly to you and your allies and follow your commands; if not, they attack you.",
            uses: { limit: 1, per: "time", afterHours: "168" },
            summons: {
              creatures: [
                { monsterId: "berserker", count: 3, except: { conditionImmunities: ["charmed", "frightened"] } }
              ],
              rangeFeet: 60,
              lasts: { type: "minutes", minutes: 60 },
              obeysWith: { weapons: "simple" }
            }
          }
        ]
      },
      {
        id: "bronze",
        name: "Bronze horn",
        actions: [
          {
            id: "blow-bronze",
            name: "Blow the Horn (Bronze)",
            activation: "action",
            description:
              "Blow the bronze horn: 4 warrior spirits from Ysgard appear in unoccupied spaces within 60 feet, each using the Berserker stat block, with Immunity to the Charmed and Frightened conditions. They return to Ysgard after 1 hour or at 0 Hit Points. Requirement: Training with all Medium armor. If you meet it, they are Friendly to you and your allies and follow your commands; if not, they attack you.",
            uses: { limit: 1, per: "time", afterHours: "168" },
            summons: {
              creatures: [
                { monsterId: "berserker", count: 4, except: { conditionImmunities: ["charmed", "frightened"] } }
              ],
              rangeFeet: 60,
              lasts: { type: "minutes", minutes: 60 },
              obeysWith: { armor: "medium" }
            }
          }
        ]
      },
      {
        id: "iron",
        name: "Iron horn",
        actions: [
          {
            id: "blow-iron",
            name: "Blow the Horn (Iron)",
            activation: "action",
            description:
              "Blow the iron horn: 5 warrior spirits from Ysgard appear in unoccupied spaces within 60 feet, each using the Berserker stat block, with Immunity to the Charmed and Frightened conditions. They return to Ysgard after 1 hour or at 0 Hit Points. Requirement: Proficiency with all Martial weapons. If you meet it, they are Friendly to you and your allies and follow your commands; if not, they attack you.",
            uses: { limit: 1, per: "time", afterHours: "168" },
            summons: {
              creatures: [
                { monsterId: "berserker", count: 5, except: { conditionImmunities: ["charmed", "frightened"] } }
              ],
              rangeFeet: 60,
              lasts: { type: "minutes", minutes: 60 },
              obeysWith: { weapons: "martial" }
            }
          }
        ]
      }
    ]
  },
  // `horseshoes-of-a-zephyr` - movement and travel are not modeled.
  // "While all four horseshoes are attached to the same creature, its Speed is increased by 30 feet": the horse carries
  // them, worn, on its own token.
  "horseshoes-of-speed": { modifiers: [{ type: "speed", amount: 30 }] },
  // `instant-fortress` - a building.
  // "Many types of Ioun Stones exist": the GM says which a found stone is, and its benefit holds while it orbits its
  // attuned owner's head (worn). Absorption and Greater Absorption (cancelling a spell), Mastery (the Proficiency
  // Bonus), Regeneration (healing each hour), Reserve (stored spells) and Sustenance (food) stay the GM's.
  "ioun-stone": {
    variants: [
      { id: "absorption", name: "Absorption" },
      {
        id: "agility",
        name: "Agility",
        modifiers: [{ type: "ability-score", ability: "dex", amount: 2, maximum: 20 }]
      },
      {
        id: "awareness",
        name: "Awareness",
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
      {
        id: "fortitude",
        name: "Fortitude",
        modifiers: [{ type: "ability-score", ability: "con", amount: 2, maximum: 20 }]
      },
      { id: "greater-absorption", name: "Greater Absorption" },
      {
        id: "insight",
        name: "Insight",
        modifiers: [{ type: "ability-score", ability: "wis", amount: 2, maximum: 20 }]
      },
      {
        id: "intellect",
        name: "Intellect",
        modifiers: [{ type: "ability-score", ability: "int", amount: 2, maximum: 20 }]
      },
      {
        id: "leadership",
        name: "Leadership",
        modifiers: [{ type: "ability-score", ability: "cha", amount: 2, maximum: 20 }]
      },
      { id: "mastery", name: "Mastery" },
      { id: "protection", name: "Protection", modifiers: [{ type: "armor-class", amount: 1 }] },
      { id: "regeneration", name: "Regeneration" },
      { id: "reserve", name: "Reserve" },
      {
        id: "strength",
        name: "Strength",
        modifiers: [{ type: "ability-score", ability: "str", amount: 2, maximum: 20 }]
      },
      { id: "sustenance", name: "Sustenance" }
    ]
  },

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
  // Knotted, it "grants Advantage on ability checks made to climb using the rope", a situation the roller names. Its
  // animated end and its own Hit Points are the GM's.
  "rope-of-climbing": {
    modifiers: [
      {
        type: "roll-mode",
        roll: "check",
        mode: "advantage",
        when: [{ type: "on-ability-check" }, { type: "situation-is", situation: "climbing the knotted rope" }]
      }
    ]
  },

  // Unlimited, as printed. The rope's own Armor Class and Hit Points are not modeled.
  "rope-of-entanglement": {
    actions: [
      {
        id: "entangle",
        name: "Entangle",
        activation: "action",
        description:
          "Command the other end of the rope to dart forward and entangle one creature you can see within 20 feet of yourself. The target must succeed on a DC 15 Dexterity saving throw or have the Restrained condition. You can release the target by letting go of your end of the rope or by using a Bonus Action to repeat the command.",
        save: {
          ability: "dex",
          dc: 15,
          successDamage: "none",
          failureConditions: ["restrained"],
          escapeDc: 15,
          // "The rope has AC 20 and 20 Hit Points": attacking it to 0 frees the target.
          heldBy: { name: "Rope", armorClass: 20, hitPoints: 20 }
        },
        targets: { count: 1, rangeFeet: 20, seen: true }
      }
    ]
  },

  // The pairing with the other stone is not modeled.
  "sending-stones": {
    casts: [{ spellId: "sending", uses: { limit: 1, per: "long-rest", pool: "sending-stones-charges" } }]
  },

  // `sovereign-glue` - consumed ounces, GM fiat.

  // The sphere set on the map by whoever has it: a creature whose space it enters, or that enters its space, makes the
  // DC 19 Dexterity save or takes 8d10 Force damage, obliterated at 0 Hit Points. Control the Sphere and Move the
  // Sphere are generic actions (`zone-sphere.ts`). Its meetings with portals are the GM's.
  "sphere-of-annihilation": {
    actions: [
      {
        id: "set",
        name: "Set the Sphere",
        activation: "other",
        area: { shape: "cube", sizeFeet: 5, widthFeet: null },
        description:
          "Set the Sphere of Annihilation in a space on the map, where it hovers until someone takes control of it. Any creature whose space the sphere enters must succeed on a DC 19 Dexterity saving throw or be touched by it, taking 8d10 Force damage; a creature reduced to 0 Hit Points by this damage is obliterated, leaving its possessions behind but no other physical remains.",
        save: { ability: "dex", dc: 19, successDamage: "none", failureConditions: [] },
        damage: [{ formula: "8d10", type: "force" }],
        drain: { killsAtZero: { cause: "obliterated by a Sphere of Annihilation", bodyGone: true } },
        zone: { on: ["enter"], controlled: { dc: 25, withinFeet: 60, pullFeet: 10 } }
      }
    ]
  },

  // One of the four elemental-commanding items; this one's wording differs (no languages, placed within 30 feet).
  "stone-of-controlling-earth-elementals": {
    actions: [
      {
        id: "summon",
        name: "Summon Earth Elemental",
        activation: "action",
        description:
          "While touching this stone to the ground, summon an Earth Elemental. It appears in an unoccupied space you choose within 30 feet of yourself, obeys your commands, and takes its turn immediately after you on your Initiative count. It disappears after 1 hour, when it dies, or when you dismiss it as a Bonus Action. The stone can't be used this way again until the next dawn.",
        summons: {
          creatures: [{ monsterId: "earth-elemental" }],
          rangeFeet: 30,
          lasts: { type: "minutes", minutes: 60 },
          dismiss: "bonus-action"
        },
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
  },

  // "You gain the 'enlarge' effect of the Enlarge/Reduce spell for 10 minutes (no Concentration required)": one size
  // larger, Advantage on Strength checks and saves, and 1d4 more damage with weapons and Unarmed Strikes.
  "potion-of-growth": {
    consumedOnUse: true,
    actions: [
      {
        id: "drink",
        name: "Drink Potion of Growth",
        activation: "bonus-action",
        description:
          "Drink it: for 10 minutes your size increases by one category, you have Advantage on Strength checks and Strength saving throws, and your attacks with weapons or Unarmed Strikes deal an extra 1d4 damage on a hit.",
        damage: [],
        grants: {
          name: "Potion of Growth",
          tags: ["enlarged"],
          duration: { type: "rounds", rounds: 100 },
          sizeChange: { step: 1 },
          modifiers: [
            ...strengthRolls("advantage"),
            {
              type: "extra-damage",
              formula: "1d4",
              doubleOnCritical: true,
              when: [{ type: "on-hit" }, { type: "attack-kind-is", kinds: ["weapon", "unarmed"] }]
            }
          ]
        }
      }
    ]
  },

  // "You gain the 'reduce' effect of the Enlarge/Reduce spell for 1d4 hours (no Concentration required)": one size
  // smaller and Disadvantage on Strength checks and saves. Its 1d4 less weapon damage is the GM's.
  "potion-of-diminution": {
    consumedOnUse: true,
    actions: [
      {
        id: "drink",
        name: "Drink Potion of Diminution",
        activation: "bonus-action",
        description:
          "Drink it: for 1d4 hours your size decreases by one category, you have Disadvantage on Strength checks and Strength saving throws, and your attacks with weapons or Unarmed Strikes deal 1d4 less damage on a hit (never below 1).",
        damage: [],
        grants: {
          name: "Potion of Diminution",
          tags: ["reduced"],
          duration: { type: "manual" },
          hoursRolled: "1d4",
          sizeChange: { step: -1 },
          modifiers: strengthRolls("disadvantage")
        }
      }
    ]
  },

  // "When you drink this potion, you gain the effect of the Gaseous Form spell for 1 hour (no Concentration required) or
  // until you end the effect as a Bonus Action."
  "potion-of-gaseous-form": {
    consumedOnUse: true,
    actions: [
      {
        id: "drink",
        name: "Drink Potion of Gaseous Form",
        activation: "bonus-action",
        description:
          "Drink it: for 1 hour you are a misty cloud, as the Gaseous Form spell, with no Concentration. End it early as a Bonus Action.",
        damage: [],
        shapeShift: {
          from: "printed",
          printed: [MISTY_CLOUD],
          keeps: [],
          noSpells: true,
          gear: "worn",
          endsAtZeroHitPoints: true,
          leaveAs: "bonus-action",
          durationMinutes: 60
        }
      }
    ]
  },

  // "When you drink this potion, your Strength score changes for 1 hour": the GM says which giant's potion it is.
  "potion-of-giant-strength": {
    consumedOnUse: true,
    variants: [
      { id: "hill", name: "Hill giant (21)", actions: [giantStrengthDrink(21)] },
      { id: "frost", name: "Frost giant (23)", actions: [giantStrengthDrink(23)] },
      { id: "stone", name: "Stone giant (23)", actions: [giantStrengthDrink(23)] },
      { id: "fire", name: "Fire giant (25)", actions: [giantStrengthDrink(25)] },
      { id: "cloud", name: "Cloud giant (27)", actions: [giantStrengthDrink(27)] },
      { id: "storm", name: "Storm giant (29)", actions: [giantStrengthDrink(29)] }
    ]
  },

  // "You have Resistance to one type of damage for 1 hour. The GM chooses the type."
  "potion-of-resistance": {
    consumedOnUse: true,
    variants: RESISTANCE_TABLE.map((type) => ({
      id: type,
      name: words(type),
      actions: [
        drink("Potion of Resistance", `Drink it: you have Resistance to ${words(type)} damage for 1 hour.`, {
          name: `Potion of Resistance (${words(type)})`,
          tags: ["potion-of-resistance"],
          duration: { type: "minutes", minutes: 60 },
          modifiers: [{ type: "damage-resistance", damageTypes: [type] }]
        })
      ]
    }))
  },

  // "The following conditions end on you: Blinded, Deafened, Paralyzed, and Poisoned." Its magical contagions are the
  // GM's.
  "elixir-of-health": {
    consumedOnUse: true,
    actions: [
      {
        id: "drink",
        name: "Drink Elixir of Health",
        activation: "bonus-action",
        description:
          "Drink it, or give it to a creature within 5 feet of you: the drinker is cured of all magical contagions, and the Blinded, Deafened, Paralyzed and Poisoned conditions end on it.",
        damage: [],
        endsConditions: ["blinded", "deafened", "paralyzed", "poisoned"],
        targets: { count: 1, rangeFeet: 5 }
      }
    ]
  },

  // The level 3 Animal Friendship at DC 13, cast from the potion as it is drunk.
  "potion-of-animal-friendship": {
    consumedOnUse: true,
    casts: [{ spellId: "animal-friendship", atLevel: 3, saveDc: 13 }]
  },

  // A Climb Speed equal to Speed for 1 hour, and Advantage on Strength (Athletics) checks to climb.
  "potion-of-climbing": {
    consumedOnUse: true,
    actions: [
      drink(
        "Potion of Climbing",
        "Drink it: for 1 hour you gain a Climb Speed equal to your Speed and have Advantage on Strength (Athletics) checks to climb.",
        {
          name: "Potion of Climbing",
          tags: ["potion-of-climbing"],
          duration: { type: "minutes", minutes: 60 },
          modifiers: [
            { type: "special-speed", movement: "climb", equalToSpeed: true },
            {
              type: "roll-mode",
              roll: "check",
              mode: "advantage",
              when: [
                { type: "on-ability-check" },
                { type: "skill-is", skills: ["athletics"] },
                { type: "situation-is", situation: "climbing" }
              ]
            }
          ]
        }
      )
    ]
  },

  // 10 Temporary Hit Points and Bless (no Concentration), both for 1 hour.
  "potion-of-heroism": {
    consumedOnUse: true,
    actions: [
      {
        ...drink(
          "Potion of Heroism",
          "Drink it: you gain 10 Temporary Hit Points that last for 1 hour, and for the same hour you are under the effect of the Bless spell, with no Concentration.",
          {
            name: "Potion of Heroism",
            tags: ["blessed"],
            duration: { type: "minutes", minutes: 60 },
            modifiers: [
              { type: "attack-bonus", amount: 0, dice: "1d4", when: [{ type: "on-attack-roll" }] },
              { type: "save-bonus", amount: 0, dice: "1d4", when: [{ type: "on-saving-throw" }] }
            ]
          }
        ),
        healing: { formula: "10", temporary: true, self: true }
      }
    ]
  },

  // The Invisible condition for 1 hour, ending early if the drinker makes an attack roll, deals damage or casts a spell.
  "potion-of-invisibility": {
    consumedOnUse: true,
    actions: [
      drink(
        "Potion of Invisibility",
        "Drink it: you have the Invisible condition for 1 hour. The effect ends early if you make an attack roll, deal damage, or cast a spell.",
        {
          name: "Potion of Invisibility",
          tags: ["until-it-acts"],
          duration: { type: "minutes", minutes: 60 },
          conditions: ["invisible"]
        }
      )
    ]
  },

  // "For 1 minute after you drink this potion, you have Resistance to all damage."
  "potion-of-invulnerability": {
    consumedOnUse: true,
    actions: [
      drink("Potion of Invulnerability", "Drink it: for 1 minute you have Resistance to all damage.", {
        name: "Potion of Invulnerability",
        tags: ["invulnerable"],
        duration: { type: "rounds", rounds: 10 },
        modifiers: [{ type: "damage-resistance", damageTypes: allDamageTypes() }]
      })
    ]
  },

  // Haste for 1 minute, with no Concentration and no lethargy when it ends.
  "potion-of-speed": {
    consumedOnUse: true,
    actions: [
      drink(
        "Potion of Speed",
        "Drink it: for 1 minute you gain the effect of the Haste spell, with no Concentration and without the wave of lethargy when it ends.",
        {
          name: "Potion of Speed",
          tags: ["hasted"],
          duration: { type: "rounds", rounds: 10 },
          speedMultiplier: 2,
          armorClassBonus: 2,
          modifiers: [
            {
              type: "roll-mode",
              roll: "save",
              mode: "advantage",
              when: [{ type: "on-saving-throw" }, { type: "ability-is", abilities: ["dex"] }]
            }
          ]
        }
      )
    ]
  },

  // "It removes any Exhaustion levels you have and ends the Poisoned condition on you." Its 24 hours of full Hit Point
  // Dice are the GM's.
  "potion-of-vitality": {
    consumedOnUse: true,
    actions: [
      {
        id: "drink",
        name: "Drink Potion of Vitality",
        activation: "bonus-action",
        description:
          "Drink it, or give it to a creature within 5 feet of you: it removes the drinker's Exhaustion levels and ends the Poisoned condition on it. For the next 24 hours, it regains the maximum number of Hit Points for any Hit Point Die it spends.",
        damage: [],
        endsConditions: ["exhaustion", "poisoned"],
        targets: { count: 1, rangeFeet: 5 }
      }
    ]
  },

  // The poison's 4d6 Poison damage, dealt to its drinker. The DC 13 Constitution save against an hour of Poisoned, which
  // a success does not halve the damage of, is the GM's, and so is its disguise: the GM names the row.
  "potion-of-poison": {
    consumedOnUse: true,
    actions: [
      {
        id: "drink",
        name: "Drink the Potion",
        activation: "bonus-action",
        description:
          "Drink it: you take 4d6 Poison damage and must succeed on a DC 13 Constitution saving throw or have the Poisoned condition for 1 hour.",
        damage: [{ formula: "4d6", type: "poison" }],
        targets: { who: "self" }
      }
    ]
  }
};

/** Every SRD damage type: "Resistance to all damage". */
function allDamageTypes(): DamageType[] {
  return [
    "acid",
    "bludgeoning",
    "cold",
    "fire",
    "force",
    "lightning",
    "necrotic",
    "piercing",
    "poison",
    "psychic",
    "radiant",
    "slashing",
    "thunder"
  ];
}

/** A Strength score an item sets while it is in use ("Your Strength is 19"), or none from a higher one. */
function strengthOf(score: number): Modifier {
  return { type: "ability-score-minimum", ability: "str", score };
}

/** Advantage on saves to avoid or end the Poisoned condition. */
function poisonedSaves(): Modifier {
  return {
    type: "roll-mode",
    roll: "save",
    mode: "advantage",
    when: [{ type: "on-saving-throw" }, { type: "versus-condition", conditionIds: ["poisoned"] }]
  };
}

/** Advantage on saving throws against spells. */
function spellSaves(): Modifier {
  return {
    type: "roll-mode",
    roll: "save",
    mode: "advantage",
    when: [{ type: "on-saving-throw" }, { type: "versus-spell" }]
  };
}

/** "You ignore Half Cover when making a spell attack roll." */
function ignoresHalfCoverOnSpells(): Modifier {
  return {
    type: "ignores-cover",
    degree: "half",
    when: [{ type: "on-attack-roll" }, { type: "attack-kind-is", kinds: ["spell"] }]
  };
}

/** A damage type's name ("lightning" reads "Lightning"). */
function words(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

type ItemAction = NonNullable<ItemMechanics["actions"]>[number];
type Grant = NonNullable<ItemAction["grants"]>;

/** A potion drunk as a Bonus Action that puts its effect on its drinker. */
function drink(name: string, description: string, grants: Grant): ItemAction {
  return { id: "drink", name: `Drink ${name}`, activation: "bonus-action", description, damage: [], grants };
}

/** A Potion of Giant Strength of one giant's score. */
function giantStrengthDrink(score: number): ItemAction {
  return drink(
    "Potion of Giant Strength",
    `Drink it: for 1 hour your Strength is ${score}. It has no effect on you if your Strength is already ${score} or higher.`,
    {
      name: "Potion of Giant Strength",
      tags: ["giant-strength"],
      duration: { type: "minutes", minutes: 60 },
      modifiers: [strengthOf(score)]
    }
  );
}

/** Strength checks and saves with Advantage (enlarged) or Disadvantage (reduced). */
function strengthRolls(mode: "advantage" | "disadvantage"): Modifier[] {
  return [
    {
      type: "roll-mode",
      roll: "check",
      mode,
      when: [{ type: "on-ability-check" }, { type: "ability-is", abilities: ["str"] }]
    },
    {
      type: "roll-mode",
      roll: "save",
      mode,
      when: [{ type: "on-saving-throw" }, { type: "ability-is", abilities: ["str"] }]
    }
  ];
}

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
        healing: { formula },
        targets: { count: 1, rangeFeet: 5 }
      }
    ]
  };
}
