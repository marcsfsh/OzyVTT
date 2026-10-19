/**
 * The stat blocks SRD 5.2.1 prints inside its summoning spells (Animate Objects, Find Steed, Giant Insect, Summon
 * Dragon), which the open5e source leaves out. Each is printed at the spell's own level with its summoner's numbers as
 * placeholders; `summonScaling` says how the engine scales it to the level it is cast at and fills in the summoner's
 * spell attack modifier, spell save DC and Proficiency Bonus (`apps/server/src/summon-stat-blocks.ts`). They carry no
 * Challenge Rating ("CR None"), so the encounter budget and the CR benchmarks leave them out.
 */
import type { ActorAction, ActorDefinition } from "@vtt/schemas";

type Speeds = Readonly<{ walk: number; fly?: number; swim?: number; climb?: number }>;

type Printed = Readonly<{
  id: string;
  name: string;
  summary: string;
  size: ActorDefinition["size"];
  type: string;
  alignment: string;
  abilityScores: ActorDefinition["abilityScores"];
  armorClass: number;
  hitPoints: number;
  speeds: Speeds;
  senses: readonly string[];
  passivePerception: number;
  languages: string;
  traits: ReadonlyArray<Readonly<{ name: string; description: string }>>;
  actions: readonly ActorAction[];
  damageResistances?: readonly string[];
  damageImmunities?: readonly string[];
  conditionImmunities?: readonly string[];
  traitMechanics?: ActorDefinition["traitMechanics"];
  summonScaling?: NonNullable<ActorDefinition["summonScaling"]>;
}>;

const FOOTPRINT: Readonly<Record<ActorDefinition["size"], number>> = {
  tiny: 1,
  small: 1,
  medium: 1,
  large: 2,
  huge: 3,
  gargantuan: 4
};

function statBlock(printed: Printed): ActorDefinition {
  const side = FOOTPRINT[printed.size];
  return {
    schemaId: "vtt.actor-monster",
    schemaVersion: 1,
    source: { name: "SRD 5.2.1", version: "5.2.1", externalId: printed.id },
    name: printed.name,
    summary: printed.summary,
    size: printed.size,
    abilityScores: printed.abilityScores,
    proficiencyBonus: 2,
    armorClass: printed.armorClass,
    hitPoints: { maximum: printed.hitPoints },
    initiativeBonus: Math.floor((printed.abilityScores.dex - 10) / 2),
    speedFeet: printed.speeds.walk,
    actions: [...printed.actions],
    token: { disposition: "neutral", footprint: { width: side, height: side } },
    ...(printed.damageResistances ? { damageResistances: [...printed.damageResistances] } : {}),
    ...(printed.damageImmunities ? { damageImmunities: [...printed.damageImmunities] } : {}),
    ...(printed.conditionImmunities ? { conditionImmunities: [...printed.conditionImmunities] } : {}),
    ...(printed.traitMechanics ? { traitMechanics: structuredClone(printed.traitMechanics) } : {}),
    ...(printed.summonScaling ? { summonScaling: printed.summonScaling } : {}),
    extensions: {
      "open5e.srd-2024": {
        skills: {},
        type: printed.type,
        alignment: printed.alignment,
        speeds: {
          walk: printed.speeds.walk,
          swim: printed.speeds.swim ?? null,
          fly: printed.speeds.fly ?? null,
          climb: printed.speeds.climb ?? null,
          burrow: null,
          hover: false
        },
        senses: [...printed.senses],
        passivePerception: printed.passivePerception,
        languages: printed.languages,
        damageVulnerabilities: null,
        damageResistances: printed.damageResistances ? printed.damageResistances.join(", ") : null,
        damageImmunities: printed.damageImmunities ? printed.damageImmunities.join(", ") : null,
        conditionImmunities: printed.conditionImmunities ? printed.conditionImmunities.join(", ") : null,
        nonmagicalAttackImmunity: false,
        nonmagicalAttackResistance: false,
        traits: printed.traits.map((trait) => ({ ...trait }))
      }
    }
  };
}

/** Animate Objects: "Huge or Smaller Construct". The printed Slam is a Medium or smaller object's. */
const ANIMATED_OBJECT = statBlock({
  id: "animated-object",
  name: "Animated Object",
  summary: "Huge or smaller construct, unaligned - CR none",
  size: "medium",
  type: "construct",
  alignment: "unaligned",
  abilityScores: { str: 16, dex: 10, con: 10, int: 3, wis: 3, cha: 1 },
  armorClass: 15,
  hitPoints: 10,
  speeds: { walk: 30 },
  senses: ["blindsight 30 ft."],
  passivePerception: 6,
  languages: "Understands the languages you know",
  damageImmunities: ["poison", "psychic"],
  conditionImmunities: ["charmed", "exhaustion", "frightened", "paralyzed", "poisoned"],
  traits: [],
  actions: [
    {
      id: "slam",
      name: "Slam",
      activation: "action",
      description:
        "Melee Attack Roll: Bonus equals your spell attack modifier, reach 5 ft. Hit: Force damage equal to 1d4 + 3, or 2d6 + 3 + your spellcasting ability modifier if the object is Large, or 2d12 + 3 + your spellcasting ability modifier if the object is Huge.",
      attack: { bonus: 0, reachFeet: 5 },
      damage: [{ formula: "1d4 + 3", type: "force" }]
    }
  ],
  summonScaling: {
    baseLevel: 5,
    // "The creature's Slam damage increases by 1d4 (Medium or smaller), 1d6 (Large), or 1d12 (Huge) for each spell
    // slot level above 5": one die of the Slam's own for each.
    perLevel: [{ actionId: "slam", dice: 1 }],
    forms: [
      { id: "medium", name: "Medium or smaller", hitPoints: 10 },
      {
        id: "large",
        name: "Large",
        size: "large",
        hitPoints: 20,
        damage: [{ actionId: "slam", formula: "2d6 + 3", addsModifier: true }]
      },
      {
        id: "huge",
        name: "Huge",
        size: "huge",
        hitPoints: 40,
        damage: [{ actionId: "slam", formula: "2d12 + 3", addsModifier: true }]
      }
    ]
  }
});

/** Summon Dragon: a Large Dragon spirit, printed at level 5 (AC 14 + the spell's level, 50 Hit Points). */
const DRACONIC_SPIRIT = statBlock({
  id: "draconic-spirit",
  name: "Draconic Spirit",
  summary: "Large dragon, neutral - CR none",
  size: "large",
  type: "dragon",
  alignment: "neutral",
  abilityScores: { str: 19, dex: 14, con: 17, int: 10, wis: 14, cha: 14 },
  armorClass: 19,
  hitPoints: 50,
  speeds: { walk: 30, fly: 60, swim: 30 },
  senses: ["blindsight 30 ft.", "darkvision 60 ft."],
  passivePerception: 12,
  languages: "Draconic, understands the languages you know",
  damageResistances: ["acid", "cold", "fire", "lightning", "poison"],
  conditionImmunities: ["charmed", "frightened", "poisoned"],
  traits: [
    {
      name: "Shared Resistances",
      description:
        "When you summon the spirit, choose one of its Resistances. You have Resistance to the chosen damage type until the spell ends."
    }
  ],
  actions: [
    {
      id: "multiattack",
      name: "Multiattack",
      activation: "action",
      description:
        "The spirit makes a number of Rend attacks equal to half the spell's level (round down), and it uses Breath Weapon.",
      damage: [],
      multiattack: [
        { actionId: "rend", count: 2 },
        { actionId: "breath-weapon", count: 1 }
      ]
    },
    {
      id: "rend",
      name: "Rend",
      activation: "action",
      description:
        "Melee Attack Roll: Bonus equals your spell attack modifier, reach 10 ft. Hit: 1d6 + 4 + the spell's level Piercing damage.",
      attack: { bonus: 0, reachFeet: 10 },
      damage: [{ formula: "1d6 + 9", type: "piercing" }]
    },
    {
      id: "breath-weapon",
      name: "Breath Weapon",
      activation: "action",
      description:
        "Dexterity Saving Throw: DC equals your spell save DC, each creature in a 30-foot Cone. Failure: 2d6 damage of a type this spirit has Resistance to (your choice when you cast the spell). Success: Half damage.",
      save: { ability: "dex", dc: 10, successDamage: "half", failureConditions: [] },
      damage: [{ formula: "2d6", type: "acid" }],
      area: { shape: "cone", sizeFeet: 30, widthFeet: null }
    }
  ],
  summonScaling: {
    baseLevel: 5,
    armorClassPerLevel: 1,
    hitPointsPerLevel: 10,
    perLevel: [{ actionId: "rend", plus: 1 }],
    halfLevelAttacks: ["rend"],
    chosenDamageType: ["breath-weapon"]
  }
});

/** Giant Insect: a Large Beast, printed at level 4 (AC 11 + the spell's level, 30 Hit Points), in the form its
 *  summoner picks. */
const GIANT_INSECT = statBlock({
  id: "giant-insect",
  name: "Giant Insect",
  summary: "Large beast, unaligned - CR none",
  size: "large",
  type: "beast",
  alignment: "unaligned",
  abilityScores: { str: 17, dex: 13, con: 15, int: 4, wis: 14, cha: 3 },
  armorClass: 15,
  hitPoints: 30,
  speeds: { walk: 40, climb: 40 },
  senses: ["darkvision 60 ft."],
  passivePerception: 12,
  languages: "Understands the languages you know",
  traits: [
    {
      name: "Spider Climb",
      description:
        "The insect can climb difficult surfaces, including along ceilings, without needing to make an ability check."
    }
  ],
  actions: [
    {
      id: "multiattack",
      name: "Multiattack",
      activation: "action",
      description: "The insect makes a number of attacks equal to half this spell's level (round down).",
      damage: [],
      multiattack: [{ actionId: "poison-jab", count: 2 }]
    },
    {
      id: "poison-jab",
      name: "Poison Jab",
      activation: "action",
      description:
        "Melee Attack Roll: Bonus equals your spell attack modifier, reach 10 ft. Hit: 1d6 + 3 + the spell's level Piercing damage plus 1d4 Poison damage.",
      attack: { bonus: 0, reachFeet: 10 },
      damage: [
        { formula: "1d6 + 7", type: "piercing" },
        { formula: "1d4", type: "poison" }
      ]
    },
    {
      id: "venomous-spew",
      name: "Venomous Spew (Centipede Only)",
      activation: "bonus-action",
      description:
        "Constitution Saving Throw: DC equals your spell save DC, one creature the insect can see within 10 feet. Failure: The target has the Poisoned condition until the start of the insect's next turn.",
      save: {
        ability: "con",
        dc: 10,
        successDamage: "none",
        failureConditions: ["poisoned"],
        failureDuration: { type: "until-source-next-turn" }
      },
      damage: [],
      targets: { count: 1, rangeFeet: 10, seen: true }
    },
    {
      id: "web-bolt",
      name: "Web Bolt (Spider Only)",
      activation: "bonus-action",
      description:
        "Dexterity Saving Throw: DC equals your spell save DC, one creature the insect can see within 60 feet. Failure: The target's Speed is reduced to 0 until the start of the insect's next turn.",
      save: {
        ability: "dex",
        dc: 10,
        successDamage: "none",
        failureConditions: [],
        speedZero: true,
        failureDuration: { type: "until-source-next-turn" },
        failureEffect: { name: "Web Bolt", tags: [], modifiers: [], duration: { type: "until-source-next-turn" } }
      },
      damage: [],
      targets: { count: 1, rangeFeet: 60, seen: true }
    },
    {
      id: "buzzing-wings",
      name: "Buzzing Wings (Wasp Only)",
      activation: "bonus-action",
      description: "The insect can fly up to half its Fly Speed without provoking Opportunity Attacks.",
      damage: [],
      move: { speed: "half", mode: "fly", provokes: false }
    }
  ],
  summonScaling: {
    baseLevel: 4,
    armorClassPerLevel: 1,
    hitPointsPerLevel: 10,
    perLevel: [{ actionId: "poison-jab", plus: 1 }],
    halfLevelAttacks: ["poison-jab"],
    formActions: ["venomous-spew", "web-bolt", "buzzing-wings"],
    forms: [
      { id: "centipede", name: "Centipede", actions: ["venomous-spew"] },
      { id: "spider", name: "Spider", actions: ["web-bolt"] },
      { id: "wasp", name: "Wasp", actions: ["buzzing-wings"], speeds: { fly: 40 } }
    ]
  }
});

/** Find Steed: a Large Celestial, Fey or Fiend steed, printed at level 2 (AC 10 + the spell's level, 5 + 10 Hit Points
 *  per spell level). */
const OTHERWORLDLY_STEED = statBlock({
  id: "otherworldly-steed",
  name: "Otherworldly Steed",
  summary: "Large celestial, fey, or fiend (your choice), neutral - CR none",
  size: "large",
  type: "celestial",
  alignment: "neutral",
  abilityScores: { str: 18, dex: 12, con: 14, int: 6, wis: 12, cha: 8 },
  armorClass: 12,
  hitPoints: 25,
  speeds: { walk: 60 },
  senses: [],
  passivePerception: 11,
  languages: "Telepathy 1 mile (works only with you)",
  traits: [
    {
      name: "Life Bond",
      description:
        "When you regain Hit Points from a level 1+ spell, the steed regains the same number of Hit Points if you're within 5 feet of it."
    }
  ],
  actions: [
    {
      id: "otherworldly-slam",
      name: "Otherworldly Slam",
      activation: "action",
      description:
        "Melee Attack Roll: Bonus equals your spell attack modifier, reach 5 ft. Hit: 1d8 plus the spell's level of Radiant (Celestial), Psychic (Fey), or Necrotic (Fiend) damage.",
      attack: { bonus: 0, reachFeet: 5 },
      damage: [{ formula: "1d8 + 2", type: "radiant" }]
    },
    {
      id: "fell-glare",
      name: "Fell Glare (Fiend Only; Recharges after a Long Rest)",
      activation: "bonus-action",
      description:
        "Wisdom Saving Throw: DC equals your spell save DC, one creature within 60 feet the steed can see. Failure: The target has the Frightened condition until the end of your next turn.",
      save: {
        ability: "wis",
        dc: 10,
        successDamage: "none",
        failureConditions: ["frightened"],
        failureDuration: { type: "until-source-turn-end" }
      },
      damage: [],
      targets: { count: 1, rangeFeet: 60, seen: true },
      uses: { limit: 1, per: "long-rest" }
    },
    {
      id: "fey-step",
      name: "Fey Step (Fey Only; Recharges after a Long Rest)",
      activation: "bonus-action",
      description:
        "The steed teleports, along with its rider, to an unoccupied space of your choice up to 60 feet away from itself.",
      damage: [],
      teleport: { feet: 60 },
      uses: { limit: 1, per: "long-rest" }
    },
    {
      id: "healing-touch",
      name: "Healing Touch (Celestial Only; Recharges after a Long Rest)",
      activation: "bonus-action",
      description:
        "One creature within 5 feet of the steed regains a number of Hit Points equal to 2d8 plus the spell's level.",
      damage: [],
      healing: { formula: "2d8 + 2" },
      targets: { count: 1, rangeFeet: 5 },
      uses: { limit: 1, per: "long-rest" }
    }
  ],
  summonScaling: {
    baseLevel: 2,
    armorClassPerLevel: 1,
    hitPointsPerLevel: 10,
    perLevel: [
      { actionId: "otherworldly-slam", plus: 1 },
      { actionId: "healing-touch", plus: 1 }
    ],
    speedsFrom: [{ level: 4, mode: "fly", feet: 60 }],
    formActions: ["fell-glare", "fey-step", "healing-touch"],
    forms: [
      {
        id: "celestial",
        name: "Celestial",
        creatureType: "celestial",
        damageType: "radiant",
        actions: ["healing-touch"]
      },
      { id: "fey", name: "Fey", creatureType: "fey", damageType: "psychic", actions: ["fey-step"] },
      { id: "fiend", name: "Fiend", creatureType: "fiend", damageType: "necrotic", actions: ["fell-glare"] }
    ]
  }
});

/** Unseen Servant: "an Invisible, mindless, shapeless, Medium force ... It has AC 10, 1 Hit Point, and a Strength of 2,
 *  and it can't attack." It moves only when the caster's Bonus Action sends it, 15 feet at a time. */
const UNSEEN_SERVANT = statBlock({
  id: "unseen-servant",
  name: "Unseen Servant",
  summary: "Medium force - CR none",
  size: "medium",
  type: "",
  alignment: "unaligned",
  abilityScores: { str: 2, dex: 10, con: 10, int: 1, wis: 10, cha: 1 },
  armorClass: 10,
  hitPoints: 1,
  speeds: { walk: 15 },
  senses: [],
  passivePerception: 10,
  languages: "None",
  traits: [
    {
      name: "Invisible",
      description:
        "The servant has the Invisible condition. It can't attack, and it performs simple tasks at your command."
    }
  ],
  traitMechanics: [{ kind: "invisible", name: "Invisible" }],
  actions: []
});

/** The spell-printed stat blocks, beside the bestiary's own. */
export const SUMMON_STAT_BLOCKS: readonly ActorDefinition[] = [
  ANIMATED_OBJECT,
  DRACONIC_SPIRIT,
  GIANT_INSECT,
  OTHERWORLDLY_STEED,
  UNSEEN_SERVANT
];
