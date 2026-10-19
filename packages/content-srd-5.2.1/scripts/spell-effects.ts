/**
 * Each SRD spell's cast model (`SpellReference.effect`), read once at build time. The source's `damage` and
 * `attackRoll` columns describe the prose, so they are corrected here: damage that does not land on the cast's
 * targets is left out, a cast's several damage types each get their own dice, and an attack is a spell attack
 * the caster makes ("Make a ranged spell attack"), never one the text only mentions. `test/spell-effects.test.ts`
 * pins the cases.
 */
import { DamageTypeSchema, type ActionArea, type DamageType, type OnHitRider } from "@vtt/schemas";
import { areaOfProse } from "../src/action-prose.js";
import type { SpellEffect, SpellLaterAction, SpellReference } from "../src/schemas.js";
import { healingOfText, spellAttackRangeOf, type SpellRange } from "../src/spell-effect.js";

/** Spells whose printed damage is not dealt by the cast to its targets, and why. They cast with no damage and the
 *  GM applies the rest from the text, or a later action does (`LATER_ACTIONS`). */
const NO_CAST_DAMAGE: Readonly<Record<string, string>> = {
  "bestow-curse": "one curse option, on later hits",
  "conjure-animals": "the pack harms on later turns",
  "conjure-elemental": "the spirit harms on later turns",
  "conjure-woodland-beings": "the spirits harm on later turns",
  "contact-other-plane": "harms the caster on a failed save",
  "delayed-blast-fireball": "detonates later",
  "dimension-door": "harms the caster when the destination is occupied",
  "divine-favor": "a rider on later weapon hits",
  "dragons-breath": "the touched creature exhales later",
  dream: "harms on a later nightmare",
  earthquake: "harms through collapse and fissures",
  "ensnaring-strike": "harms the Restrained target on later turns",
  "faithful-hound": "the hound attacks on later turns",
  "fire-shield": "harms attackers on later hits",
  "flame-blade": "the blade attacks on later turns",
  "flaming-sphere": "the sphere harms on later turns",
  forbiddance: "harms creatures entering the area",
  "freedom-of-movement": "no damage; the column is noise",
  geas: "harms a target that defies it",
  "heroes-feast": "no damage; the column is noise",
  hex: "a rider on later hits",
  "hunters-mark": "a rider on later hits",
  "meld-into-stone": "harms the caster if the stone is destroyed",
  "phantasmal-force": "harms on later turns",
  "power-word-kill": "kills outright, or harms only above 100 Hit Points",
  "prismatic-spray": "a random ray per creature",
  "prismatic-wall": "a wall",
  "produce-flame": "the flame is hurled on later turns",
  "spike-growth": "harms creatures moving through the area",
  "spirit-guardians": "the emanation harms on later turns",
  web: "harms only if the webs burn",
  wish: "harms the caster after a stressful wish"
};

type Damage = SpellEffect["damage"];

/** One cast's damage where the source's single roll and type list cannot say it. */
const CAST_DAMAGE: Readonly<Record<string, Damage>> = {
  // Each dart; the cast makes three (`CAST_DARTS`).
  "magic-missile": [{ formula: "1d4 + 1", type: "force" }],
  "flame-strike": [
    { formula: "5d6", type: "fire" },
    { formula: "5d6", type: "radiant" }
  ],
  "ice-storm": [
    { formula: "2d10", type: "bludgeoning" },
    { formula: "4d6", type: "cold" }
  ],
  "meteor-swarm": [
    { formula: "20d6", type: "fire" },
    { formula: "20d6", type: "bludgeoning" }
  ],
  // The hit; the 2d6 Cold burst is a save for everyone within 5 feet, left to the GM.
  "ice-knife": [{ formula: "1d10", type: "piercing" }],
  // The wall appearing; the sheet of frigid air left by a breach is the GM's.
  "wall-of-ice": [{ formula: "10d6", type: "cold" }],
  // The wall appearing; moving through it later is Slashing (`LATER_ACTIONS`).
  "wall-of-thorns": [{ formula: "7d8", type: "piercing" }],
  // The attack when the summoned thing appears adds the caster's modifier.
  "spiritual-weapon": [{ formula: "1d8", type: "force", addsModifier: true }],
  "arcane-sword": [{ formula: "4d12", type: "force", addsModifier: true }],
  "conjure-fey": [{ formula: "3d12", type: "psychic", addsModifier: true }],
  // A type the caster chooses (`DAMAGE_CHOICES`); the first is the default.
  "chromatic-orb": [{ formula: "3d8", type: "acid" }],
  "sorcerous-burst": [{ formula: "1d8", type: "acid" }]
};

/** The damage types a caster picks from on each cast, for spells that let them choose. */
const DAMAGE_CHOICES: Readonly<Record<string, readonly DamageType[]>> = {
  "chromatic-orb": ["acid", "cold", "fire", "lightning", "poison", "thunder"],
  "sorcerous-burst": ["acid", "cold", "fire", "lightning", "poison", "psychic", "thunder"],
  "dragons-breath": ["acid", "cold", "fire", "lightning", "poison"],
  "conjure-elemental": ["lightning", "thunder", "fire", "cold"],
  // Radiant for a good or neutral caster, Necrotic for an evil one.
  "spirit-guardians": ["radiant", "necrotic"],
  // The Resistance the touched creature gains: "one damage type of your choice".
  "protection-from-energy": ["acid", "cold", "fire", "lightning", "thunder"]
};

/** Spell attack rolls one cast makes, where the text's wording misleads the reader. */
const CAST_ATTACKS: Readonly<Record<string, number>> = {
  "scorching-ray": 3,
  // The summoned thing attacks when it appears ("you can immediately make one melee spell attack").
  "spiritual-weapon": 1,
  "arcane-sword": 1,
  "conjure-fey": 1,
  // These attack only on later turns (`LATER_ACTIONS`).
  "arcane-hand": 0,
  "flame-blade": 0,
  "produce-flame": 0
};

/** How many creatures a cast targets (SRD "up to three creatures", "one additional creature for each spell slot level
 *  above 1"), for the spells a table casts in a fight. */
const CAST_TARGETS: Readonly<Record<string, NonNullable<SpellEffect["targets"]>>> = {
  aid: { count: 3 },
  "animal-friendship": { count: 1, perSlot: 1 },
  bane: { count: 3, perSlot: 1 },
  banishment: { count: 1, perSlot: 1 },
  bless: { count: 3, perSlot: 1 },
  blindnessdeafness: { count: 1, perSlot: 1 },
  "charm-monster": { count: 1, perSlot: 1 },
  "charm-person": { count: 1, perSlot: 1 },
  command: { count: 1, perSlot: 1 },
  "cure-wounds": { count: 1 },
  "dissonant-whispers": { count: 1 },
  "dominate-beast": { count: 1 },
  "dominate-monster": { count: 1 },
  "dominate-person": { count: 1 },
  "enhance-ability": { count: 1, perSlot: 1 },
  fly: { count: 1, perSlot: 1 },
  "freedom-of-movement": { count: 1, perSlot: 1 },
  "gaseous-form": { count: 1, perSlot: 1 },
  haste: { count: 1 },
  "healing-word": { count: 1 },
  heroism: { count: 1, perSlot: 1 },
  "hideous-laughter": { count: 1, perSlot: 1 },
  "hold-monster": { count: 1, perSlot: 1 },
  "hold-person": { count: 1, perSlot: 1 },
  "inflict-wounds": { count: 1 },
  invisibility: { count: 1, perSlot: 1 },
  jump: { count: 1, perSlot: 1 },
  longstrider: { count: 1, perSlot: 1 },
  "mage-armor": { count: 1 },
  "mass-cure-wounds": { count: 6 },
  "mass-healing-word": { count: 6 },
  "phantasmal-killer": { count: 1 },
  polymorph: { count: 1 },
  "power-word-stun": { count: 1 },
  "prayer-of-healing": { count: 5 },
  "sacred-flame": { count: 1 },
  "shield-of-faith": { count: 1 },
  "spider-climb": { count: 1, perSlot: 1 },
  suggestion: { count: 1 },
  "vicious-mockery": { count: 1 }
};

/** Missiles one cast makes, each striking a creature of the caster's choice. */
const CAST_DARTS: Readonly<Record<string, number>> = { "magic-missile": 3 };

/** Spells whose target makes no save when the spell is cast: the save comes later, on a trigger the GM spots (a
 *  `LATER_ACTIONS` row resolves it), or belongs to someone else entirely (Sanctuary's attacker, Haste has none). */
const NO_CAST_SAVE: ReadonlySet<string> = new Set([
  "antipathysympathy",
  "beacon-of-hope",
  "conjure-animals",
  "conjure-elemental",
  "conjure-woodland-beings",
  "delayed-blast-fireball",
  "dragons-breath",
  "dream",
  "faithful-hound",
  "flaming-sphere",
  "forcecage",
  "freedom-of-movement",
  "gaseous-form",
  "guardian-of-faith",
  "haste",
  "heat-metal",
  "magic-circle",
  "power-word-stun",
  "prismatic-wall",
  "sanctuary",
  // The save comes at the start of each of the target's turns, after the fire; the hit carries the first 1d6.
  "searing-smite",
  "sleet-storm",
  "spirit-guardians",
  "stinking-cloud",
  "web",
  "zone-of-truth"
]);

type Later = SpellLaterAction;
type Zone = NonNullable<Later["zone"]>;
const melee = (feet: number) => ({ kind: "melee" as const, feet });
/** A save that halves the damage on a success and imposes no condition. */
const save = (ability: "str" | "dex" | "con" | "int" | "wis" | "cha") => ({
  ability,
  successDamage: "half" as const,
  failureConditions: []
});
const ONCE_PER_TURN = "A creature makes this save only once per turn.";
/** Entering the area or ending a turn in it, once per turn: the shape most lingering areas print. */
const ENTER_OR_END_ONCE: Zone = { on: ["enter", "end-turn"], oncePerTurn: true };

/**
 * What a spell lets its caster do after the cast (SRD 5.2.1 text): the attacks a summoned thing or a held flame
 * makes on later turns, and the saves or damage an area deals when a creature enters it or starts or ends its turn
 * there. An area with a `zone` is watched by the server, which raises the save or deals the damage to the creature at
 * that moment; the rest stay with the GM, whom the cast reminds.
 */
const LATER_ACTIONS: Readonly<Record<string, readonly Later[]>> = {
  "arcane-sword": [
    {
      name: "attack",
      activation: "bonus-action",
      when: "On your later turns, a Bonus Action moves the sword up to 30 feet and repeats the attack.",
      laterTurnsOnly: true,
      attackRange: melee(95),
      damage: [{ formula: "4d12", type: "force", addsModifier: true }]
    }
  ],
  "black-tentacles": [
    {
      name: "save",
      activation: "other",
      when: `A creature that enters the area or ends its turn there makes the save. ${ONCE_PER_TURN}`,
      save: { ability: "str", successDamage: "none", failureConditions: ["restrained"] },
      damage: [{ formula: "3d6", type: "bludgeoning" }],
      zone: ENTER_OR_END_ONCE
    }
  ],
  "blade-barrier": [
    {
      name: "save",
      activation: "other",
      when: `A creature that enters the wall's space or ends its turn there makes the save. ${ONCE_PER_TURN}`,
      save: save("dex"),
      damage: [{ formula: "6d10", type: "force" }],
      zone: ENTER_OR_END_ONCE
    }
  ],
  // "Until the spell ends, you can take a Magic action to call down lightning in that way again."
  "call-lightning": [
    {
      name: "bolt",
      activation: "action",
      when: "Until the spell ends, a Magic action calls down another bolt at a point under the cloud.",
      save: save("dex"),
      damage: [{ formula: "3d10", type: "lightning" }],
      area: { shape: "sphere", sizeFeet: 5, widthFeet: null }
    }
  ],
  cloudkill: [
    {
      name: "save",
      activation: "other",
      when: `A creature the Sphere moves into, or that enters it or ends its turn there, makes the save. ${ONCE_PER_TURN} The Sphere moves 10 feet away from you at the start of each of your turns.`,
      save: save("con"),
      damage: [{ formula: "5d8", type: "poison" }],
      zone: ENTER_OR_END_ONCE
    }
  ],
  "conjure-animals": [
    {
      name: "save",
      activation: "other",
      when: `When the pack moves within 10 feet of a creature, or a creature enters a space within 10 feet of it or ends its turn there, you can force the save. ${ONCE_PER_TURN}`,
      save: { ability: "dex", successDamage: "none", failureConditions: [] },
      damage: [{ formula: "3d10", type: "slashing" }],
      zone: { ...ENTER_OR_END_ONCE, around: "point", feet: 10, affects: "enemies" }
    }
  ],
  "conjure-elemental": [
    {
      name: "save",
      activation: "other",
      when: "A creature that enters the spirit's space or starts its turn within 5 feet of it makes the save, if the spirit has no creature Restrained; the Restrained target repeats it at the start of each of its turns, taking 4d8 on a failure.",
      save: { ability: "dex", successDamage: "none", failureConditions: ["restrained"] },
      damage: [{ formula: "8d8", type: "lightning" }]
    }
  ],
  "conjure-fey": [
    {
      name: "attack",
      activation: "bonus-action",
      when: "On your later turns, a Bonus Action teleports the spirit up to 30 feet and makes the attack (a hit also Frightens the target until the start of your next turn).",
      laterTurnsOnly: true,
      attackRange: melee(65),
      onHit: [{ conditions: [{ id: "frightened" }], duration: { type: "until-source-next-turn" } }],
      damage: [{ formula: "3d12", type: "psychic", addsModifier: true }]
    }
  ],
  "conjure-woodland-beings": [
    {
      name: "save",
      activation: "other",
      when: `When the Emanation enters a creature's space, or a creature enters it or ends its turn there, you can force the save. ${ONCE_PER_TURN}`,
      save: save("wis"),
      damage: [{ formula: "5d8", type: "force" }],
      zone: { ...ENTER_OR_END_ONCE, around: "caster", feet: 10, affects: "enemies" }
    }
  ],
  "delayed-blast-fireball": [
    {
      name: "explosion",
      activation: "other",
      when: "The bead explodes when the spell ends: 12d6, plus 1d6 for each of your turns that ended while it lasted.",
      save: save("dex"),
      damage: [{ formula: "12d6", type: "fire" }],
      area: { shape: "sphere", sizeFeet: 20, widthFeet: null }
    }
  ],
  "dragons-breath": [
    {
      name: "exhale",
      activation: "action",
      when: "Until the spell ends, the creature you touched can take a Magic action to exhale.",
      save: save("dex"),
      damage: [{ formula: "3d6", type: "acid" }],
      area: { shape: "cone", sizeFeet: 15, widthFeet: null }
    }
  ],
  "faithful-hound": [
    {
      name: "bite",
      activation: "other",
      when: "At the start of each of your turns, the hound bites one enemy within 5 feet of it.",
      save: { ability: "dex", successDamage: "none", failureConditions: [] },
      damage: [{ formula: "4d8", type: "force" }]
    }
  ],
  "flame-blade": [
    {
      name: "attack",
      activation: "action",
      when: "As a Magic action, you can make a melee spell attack with the fiery blade.",
      attackRange: melee(5),
      damage: [{ formula: "3d6", type: "fire", addsModifier: true }]
    }
  ],
  "flaming-sphere": [
    {
      name: "save",
      activation: "other",
      when: "A creature that ends its turn within 5 feet of the sphere makes the save.",
      save: save("dex"),
      damage: [{ formula: "2d6", type: "fire" }],
      zone: { on: ["end-turn"], around: "point", feet: 5 }
    },
    {
      name: "ram",
      activation: "bonus-action",
      when: "As a Bonus Action, you can roll the sphere up to 30 feet; a creature whose space you move it into makes the save, and the sphere stops for the turn.",
      save: save("dex"),
      damage: [{ formula: "2d6", type: "fire" }]
    }
  ],
  grease: [
    {
      name: "save",
      activation: "other",
      when: "A creature that enters the area or ends its turn there must also succeed on the save or fall Prone.",
      save: { ability: "dex", successDamage: "none", failureConditions: ["prone"] },
      damage: [],
      zone: { on: ["enter", "end-turn"] }
    }
  ],
  "guardian-of-faith": [
    {
      name: "save",
      activation: "other",
      when: "Any enemy that moves to a space within 10 feet of the guardian for the first time on a turn or starts its turn there makes the save. The guardian vanishes when it has dealt a total of 60 damage.",
      save: save("dex"),
      damage: [{ formula: "20", type: "radiant" }],
      zone: { on: ["enter", "start-turn"], around: "point", feet: 10, affects: "enemies", damageCap: 60 }
    }
  ],
  // "If the target drops to 0 Hit Points before this spell ends, you can take a Bonus Action on a later turn to curse a
  // new creature."
  hex: [
    {
      name: "move",
      activation: "bonus-action",
      when: "If the cursed creature drops to 0 Hit Points before the spell ends, a Bonus Action on a later turn curses a new creature.",
      damage: [],
      movesGrant: true,
      laterTurnsOnly: true
    }
  ],
  "heat-metal": [
    {
      name: "heat again",
      activation: "bonus-action",
      when: "On your later turns, a Bonus Action deals the damage again if the object is within range; a creature holding or wearing it makes a Constitution save or drops it.",
      laterTurnsOnly: true,
      damage: [{ formula: "2d8", type: "fire" }]
    }
  ],
  // "If the target drops to 0 Hit Points before this spell ends, you can take a Bonus Action to move the mark to a new
  // creature you can see within range."
  "hunters-mark": [
    {
      name: "move",
      activation: "bonus-action",
      when: "If the marked creature drops to 0 Hit Points before the spell ends, a Bonus Action moves the mark to a new creature you can see within range.",
      damage: [],
      movesGrant: true
    }
  ],
  "incendiary-cloud": [
    {
      name: "save",
      activation: "other",
      when: `A creature the Sphere moves into, or that enters it or ends its turn there, makes the save. ${ONCE_PER_TURN} The cloud moves 10 feet away from you at the start of each of your turns.`,
      save: save("dex"),
      damage: [{ formula: "10d8", type: "fire" }],
      zone: ENTER_OR_END_ONCE
    }
  ],
  "insect-plague": [
    {
      name: "save",
      activation: "other",
      when: `A creature that enters the area for the first time on a turn or ends its turn there makes the save. ${ONCE_PER_TURN}`,
      save: save("con"),
      damage: [{ formula: "4d10", type: "piercing" }],
      zone: ENTER_OR_END_ONCE
    }
  ],
  moonbeam: [
    {
      name: "save",
      activation: "other",
      when: `A creature the Cylinder moves into, or that enters it or ends its turn there, makes the save. ${ONCE_PER_TURN} A Magic action on your later turns moves the Cylinder up to 60 feet.`,
      save: save("con"),
      damage: [{ formula: "2d10", type: "radiant" }],
      zone: ENTER_OR_END_ONCE
    }
  ],
  "produce-flame": [
    {
      name: "hurl",
      activation: "action",
      when: "Until the spell ends, a Magic action hurls fire at a creature or object within 60 feet.",
      attackRange: { kind: "ranged", feet: 60 },
      damage: [{ formula: "1d8", type: "fire" }]
    }
  ],
  "sleet-storm": [
    {
      name: "save",
      activation: "other",
      when: "A creature that enters the Cylinder for the first time on a turn or starts its turn there makes the save; a failure also breaks its Concentration.",
      save: { ability: "dex", successDamage: "none", failureConditions: ["prone"] },
      damage: [],
      zone: { on: ["enter", "start-turn"] }
    }
  ],
  "spike-growth": [
    {
      name: "spikes",
      activation: "other",
      when: "A creature that moves into or within the area takes the damage for every 5 feet it travels.",
      damage: [{ formula: "2d4", type: "piercing" }],
      zone: { on: ["travel"] }
    }
  ],
  "spirit-guardians": [
    {
      name: "save",
      activation: "other",
      when: `When the Emanation enters a creature's space, or a creature enters it or ends its turn there, it makes the save. ${ONCE_PER_TURN} The creatures you designate are unaffected: your allies.`,
      save: save("wis"),
      damage: [{ formula: "3d8", type: "radiant" }],
      // "Any other creature's Speed is halved in the Emanation": moving there costs double.
      zone: { ...ENTER_OR_END_ONCE, around: "caster", feet: 15, affects: "enemies", halvesSpeed: true }
    }
  ],
  "spiritual-weapon": [
    {
      name: "attack",
      activation: "bonus-action",
      when: "On your later turns, a Bonus Action moves the force up to 20 feet and repeats the attack.",
      laterTurnsOnly: true,
      attackRange: melee(65),
      damage: [{ formula: "1d8", type: "force", addsModifier: true }]
    }
  ],
  "stinking-cloud": [
    {
      name: "save",
      activation: "other",
      when: "A creature that starts its turn in the Sphere makes the save; it is Poisoned until the end of that turn and can't take an action or a Bonus Action.",
      save: {
        ability: "con",
        successDamage: "none",
        failureConditions: ["poisoned"],
        failureDuration: { type: "until-bearer-turn-end" }
      },
      damage: [],
      zone: { on: ["start-turn"] }
    }
  ],
  // "Until the spell ends, you can take a Magic action to create a new Line of radiance."
  sunbeam: [
    {
      name: "line",
      activation: "action",
      when: "Until the spell ends, a Magic action creates a new Line of radiance from you.",
      save: {
        ability: "con",
        successDamage: "half",
        failureConditions: ["blinded"],
        failureDuration: { type: "until-source-next-turn" }
      },
      damage: [{ formula: "6d8", type: "radiant" }],
      area: { shape: "line", sizeFeet: 60, widthFeet: 5 }
    }
  ],
  // "Until the spell ends, you can make the attack again on each of your turns as a Magic action."
  "vampiric-touch": [
    {
      name: "touch",
      activation: "action",
      when: "Until the spell ends, a Magic action makes the attack again; you regain Hit Points equal to half the Necrotic damage dealt.",
      attackRange: melee(5),
      damage: [{ formula: "3d6", type: "necrotic" }],
      drain: { damageType: "necrotic", heals: "half" }
    }
  ],
  "wall-of-fire": [
    {
      name: "burn",
      activation: "other",
      when: "A creature that enters the wall for the first time on a turn or ends its turn inside it takes the damage, as does one that ends its turn within 10 feet of the burning side.",
      damage: [{ formula: "5d8", type: "fire" }],
      zone: { on: ["enter", "end-turn"] }
    }
  ],
  "wall-of-thorns": [
    {
      name: "save",
      activation: "other",
      when: `A creature that enters a space in the wall for the first time on a turn or ends its turn there makes the save. ${ONCE_PER_TURN}`,
      save: save("dex"),
      damage: [{ formula: "7d8", type: "slashing" }],
      zone: ENTER_OR_END_ONCE
    }
  ],
  web: [
    {
      name: "save",
      activation: "other",
      when: "The first time a creature enters the webs on a turn or starts its turn there, it makes the save; Restrained, it can try a Strength (Athletics) check against your spell save DC as an action.",
      save: { ability: "dex", successDamage: "none", failureConditions: ["restrained"] },
      damage: [],
      zone: { on: ["enter", "start-turn"] }
    }
  ],
  "zone-of-truth": [
    {
      name: "save",
      activation: "other",
      when: "A creature that enters the area for the first time on a turn or starts its turn there makes the save; on a failure it can't speak a deliberate lie while in the radius, and you know whether it succeeded.",
      save: { ability: "cha", successDamage: "none", failureConditions: [] },
      damage: [],
      zone: { on: ["enter", "start-turn"] }
    }
  ]
};

/** Reaction spells the table offers as prompts: what triggers each and what casting it does. Counterspell and Feather
 *  Fall answer triggers the engine doesn't see (a spell being cast, a fall), so they stay with the GM. */
const CAST_REACTIONS: Readonly<Record<string, NonNullable<SpellEffect["reaction"]>>> = {
  // +5 AC until the start of the caster's next turn, including against the triggering attack.
  shield: { trigger: "hit-by-attack", response: "ac-bonus", amount: 5, untilNextTurn: true },
  "hellish-rebuke": { trigger: "damaged-by-creature", response: "strike-back", rangeFeet: 60 }
};

/** What a cast's hit lands on its target besides its damage (SRD 5.2.1 text). */
const CAST_ON_HIT: Readonly<Record<string, readonly OnHitRider[]>> = {
  "ray-of-sickness": [{ conditions: [{ id: "poisoned" }], duration: { type: "until-source-turn-end" } }],
  // "With both you and the spirit as the source of the fear": the caster is.
  "conjure-fey": [{ conditions: [{ id: "frightened" }], duration: { type: "until-source-next-turn" } }],
  // "2d4 Acid damage at the end of its next turn": the target's next turn ends before the caster's next turn starts.
  "acid-arrow": [
    {
      conditions: [],
      name: "Acid Arrow",
      ongoingDamage: { damage: [{ formula: "2d4", type: "acid" }], at: "bearer-turn-end" },
      duration: { type: "rounds", rounds: 1 }
    }
  ]
};

/** A miss still deals this share of the hit's damage (Acid Arrow: "half as much of the initial damage only"). */
const CAST_MISS_DAMAGE: Readonly<Record<string, "half">> = { "acid-arrow": "half" };

/** Conditions a cast ends on its targets (SRD 5.2.1 text); `one` ends the one the caster picks. */
const CAST_CURES: Readonly<Record<string, Readonly<{ conditions: readonly string[]; one?: true }>>> = {
  heal: { conditions: ["blinded", "deafened", "poisoned"] },
  // "Creatures healed by this spell also have the Blinded, Deafened, and Poisoned conditions removed from them."
  "mass-heal": { conditions: ["blinded", "deafened", "poisoned"] },
  "power-word-heal": { conditions: ["charmed", "frightened", "paralyzed", "poisoned", "stunned"] },
  "lesser-restoration": { conditions: ["blinded", "deafened", "paralyzed", "poisoned"], one: true },
  "protection-from-poison": { conditions: ["poisoned"] }
};

/** Healing the text gives as no single roll: Mass Heal's 700 divided among its targets, Power Word Heal's "regains all
 *  its Hit Points", and False Life's Temporary Hit Points. */
const CAST_HEALING: Readonly<Record<string, NonNullable<SpellEffect["healing"]>>> = {
  "mass-heal": { formula: "700", addsModifier: false, divided: true },
  // "You gain 2d4 + 4 Temporary Hit Points", and 5 more for each slot level above 1.
  "false-life": { formula: "2d4 + 4", addsModifier: false, self: true, temporary: true, perSlot: 5 },
  "power-word-heal": { formula: "1", addsModifier: false, toMaximum: true }
};

/** What bursts after the cast's attack, hit or miss (SRD 5.2.1 text). */
const CAST_BURSTS: Readonly<Record<string, NonNullable<SpellEffect["burst"]>>> = {
  // "Hit or miss, the shard then explodes. The target and each creature within 5 feet of it must succeed on a Dexterity
  // saving throw or take 2d6 Cold damage." "The Cold damage increases by 1d6 for each spell slot level above 1."
  "ice-knife": { radiusFeet: 5, ability: "dex", damage: [{ formula: "2d6", type: "cold" }], diceAddedPerSlot: 1 }
};

/** What the cast's damage drains as it lands (SRD 5.2.1 text). */
const CAST_DRAINS: Readonly<Record<string, NonNullable<SpellEffect["drain"]>>> = {
  // "Its Hit Point maximum is reduced by an amount equal to the Necrotic damage it took" on a failed save; "This spell
  // can't reduce a target's Hit Point maximum below 1."
  harm: { damageType: "necrotic", reducesMaximum: true, keepsOneMaximum: true, failedSaveOnly: true },
  // "You regain Hit Points equal to half the amount of Necrotic damage dealt", on the cast and each later touch.
  "vampiric-touch": { damageType: "necrotic", heals: "half" }
};

type Grant = NonNullable<SpellEffect["grant"]>;
type FailureEffect = NonNullable<SpellEffect["failureEffect"]>;
type Modifier = Grant["modifiers"][number];

const rounds = (count: number) => ({ type: "rounds" as const, rounds: count });
/** A grant with the defaults every spell's shares: no end trigger, no Concentration flag (the cast's Concentration is
 *  the caster's alone). */
const spellGrant = (fields: Pick<Grant, "name" | "tags" | "target" | "duration"> & Partial<Grant>): Grant => ({
  modifiers: [],
  onEnd: [],
  voidWhileIncapacitated: false,
  concentration: false,
  ...fields
});
/** Dice on every attack roll and saving throw the creature makes (Bless adds them, Bane takes them off). */
const d20Dice = (dice: string): Modifier[] => [
  { type: "attack-bonus", amount: 0, dice, when: [{ type: "on-attack-roll" }] },
  { type: "save-bonus", amount: 0, dice, when: [{ type: "on-saving-throw" }] }
];
/** Advantage on attack rolls against the creature. */
const attackedWithAdvantage: Modifier = {
  type: "roll-mode",
  roll: "incoming-attack",
  mode: "advantage",
  when: [{ type: "on-attack-roll" }]
};
/** The caster's extra damage whenever its attack roll hits the marked creature (Hunter's Mark, Hex). */
const markDamage = (type: DamageType): Modifier => ({
  type: "extra-damage",
  formula: "1d6",
  damageType: type,
  doubleOnCritical: true,
  when: [{ type: "on-hit" }, { type: "by-effect-source" }]
});

/**
 * What a cast leaves on the creatures it targets (or the one its attack hits) while it lasts, in the effect vocabulary
 * the engine reads (SRD 5.2.1 text). The durations are the spells' own, "until ended" past 10 minutes (the engine keeps
 * no clock outside a fight); a Concentration spell's effects also end with the caster's Concentration. Mage Armor's AC
 * and Haste's Speed are measured on the creature when it lands (`grant.ts`).
 */
const CAST_GRANTS: Readonly<Record<string, Grant>> = {
  // "Its Speed is reduced by 10 feet until the start of your next turn."
  "ray-of-frost": spellGrant({
    name: "Ray of Frost",
    tags: ["ray-of-frost"],
    target: "target",
    onHit: true,
    duration: { type: "until-source-next-turn" },
    modifiers: [{ type: "speed", amount: -10 }]
  }),
  // "It can't make Opportunity Attacks until the start of its next turn."
  "shocking-grasp": spellGrant({
    name: "Shocking Grasp",
    tags: ["no-opportunity-attacks"],
    target: "target",
    onHit: true,
    duration: { type: "until-bearer-next-turn" }
  }),
  // "It can't regain Hit Points until the end of your next turn."
  "chill-touch": spellGrant({
    name: "Chill Touch",
    tags: ["no-healing"],
    target: "target",
    onHit: true,
    duration: { type: "until-source-turn-end" }
  }),
  // "Until the end of your next turn, it emits Dim Light in a 10-foot radius and can't benefit from the Invisible
  // condition."
  "starry-wisp": spellGrant({
    name: "Starry Wisp",
    tags: ["outlined"],
    target: "target",
    onHit: true,
    duration: { type: "until-source-turn-end" },
    light: { brightFeet: 0, dimFeet: 10 }
  }),
  // "For the duration, you see creatures and objects that have the Invisible condition as if they were visible."
  "see-invisibility": spellGrant({
    name: "See Invisibility",
    tags: ["see-invisibility"],
    target: "self",
    duration: { type: "manual" },
    modifiers: [{ type: "sense", sense: "see-invisibility", feet: 0 }]
  }),
  // "This spell gives the willing creature you touch Truesight with a range of 120 feet."
  "true-seeing": spellGrant({
    name: "True Seeing",
    tags: ["true-seeing"],
    target: "target",
    duration: { type: "manual" },
    modifiers: [{ type: "sense", sense: "truesight", feet: 120 }]
  }),
  // "For the duration, a willing creature you touch has Darkvision with a range of 150 feet."
  darkvision: spellGrant({
    name: "Darkvision",
    tags: ["darkvision-spell"],
    target: "target",
    duration: { type: "manual" },
    modifiers: [{ type: "darkvision", feet: 150 }]
  }),
  bless: spellGrant({
    name: "Bless",
    tags: ["blessed"],
    target: "targets",
    duration: rounds(10),
    modifiers: d20Dice("1d4")
  }),
  "shield-of-faith": spellGrant({
    name: "Shield of Faith",
    tags: ["shield-of-faith"],
    target: "target",
    duration: rounds(100),
    armorClassBonus: 2
  }),
  // The next attack roll against the creature before the end of the caster's next turn, whoever makes it, which
  // spends the light; it lasts until the start of the caster's turn after, as Vex does.
  "guiding-bolt": spellGrant({
    name: "Guiding Bolt's light",
    tags: ["until-attacked"],
    target: "target",
    onHit: true,
    duration: rounds(2),
    modifiers: [attackedWithAdvantage]
  }),
  "hunters-mark": spellGrant({
    name: "Hunter's Mark",
    tags: ["hunters-mark"],
    target: "target",
    duration: { type: "manual" },
    modifiers: [markDamage("force")]
  }),
  hex: spellGrant({
    name: "Hex",
    tags: ["hexed"],
    target: "target",
    duration: { type: "manual" },
    modifiers: [markDamage("necrotic")]
  }),
  // "Advantage on saving throws to avoid or end the Poisoned condition, and it has Resistance to Poison damage", for
  // the hour the GM ends it after.
  "protection-from-poison": spellGrant({
    name: "Protection from Poison",
    tags: ["protection-from-poison"],
    target: "target",
    duration: { type: "manual" },
    modifiers: [
      { type: "damage-resistance", damageTypes: ["poison"] },
      {
        type: "roll-mode",
        roll: "save",
        mode: "advantage",
        when: [{ type: "on-saving-throw" }, { type: "versus-condition", conditionIds: ["poisoned"] }]
      }
    ]
  }),
  // "Immune to the Frightened condition and gains Temporary Hit Points equal to your spellcasting ability modifier at
  // the start of each of its turns."
  heroism: spellGrant({
    name: "Heroism",
    tags: ["heroism"],
    target: "targets",
    duration: rounds(10),
    conditionImmunities: ["frightened"],
    temporaryHitPointsEachTurn: "spellcasting-modifier"
  }),
  // "Each target's Hit Point maximum and current Hit Points increase by 5 for the duration", and 5 more for each slot
  // level above 2. Its 8 hours end at the GM's word or a Long Rest.
  aid: spellGrant({
    name: "Aid",
    tags: ["aid"],
    target: "targets",
    duration: { type: "manual" },
    hitPointMaximumGain: { amount: 5, perSlot: 5 }
  }),
  // "Resistance to Bludgeoning, Piercing, and Slashing damage", held by the caster's Concentration.
  stoneskin: spellGrant({
    name: "Stoneskin",
    tags: ["stoneskin"],
    target: "target",
    duration: { type: "manual" },
    modifiers: [{ type: "damage-resistance", damageTypes: ["bludgeoning", "piercing", "slashing"] }]
  }),
  // "Any creature has Disadvantage on attack rolls against you." An attacker that perceives the caster with
  // Blindsight or Truesight is the GM's to spare.
  blur: spellGrant({
    name: "Blur",
    tags: ["blur"],
    target: "self",
    duration: rounds(10),
    modifiers: [
      { type: "roll-mode", roll: "incoming-attack", mode: "disadvantage", when: [{ type: "on-attack-roll" }] }
    ]
  }),
  // "Your attacks with weapons deal an extra 1d4 Radiant damage on a hit."
  "divine-favor": spellGrant({
    name: "Divine Favor",
    tags: ["divine-favor"],
    target: "self",
    duration: rounds(10),
    modifiers: [
      {
        type: "extra-damage",
        formula: "1d4",
        damageType: "radiant",
        doubleOnCritical: true,
        when: [{ type: "on-hit" }, { type: "attack-kind-is", kinds: ["weapon"] }]
      }
    ]
  }),
  // "Advantage on D20 Tests, and other creatures have Disadvantage on attack rolls against it", for 8 hours.
  foresight: spellGrant({
    name: "Foresight",
    tags: ["foresight"],
    target: "target",
    duration: { type: "manual" },
    modifiers: [
      { type: "roll-mode", roll: "attack", mode: "advantage" },
      { type: "roll-mode", roll: "save", mode: "advantage" },
      { type: "roll-mode", roll: "check", mode: "advantage" },
      { type: "roll-mode", roll: "initiative", mode: "advantage" },
      { type: "roll-mode", roll: "incoming-attack", mode: "disadvantage", when: [{ type: "on-attack-roll" }] }
    ]
  }),
  // "An Armor Class of 17 if its AC is lower than that", measured as the spell lands.
  barkskin: spellGrant({ name: "Barkskin", tags: ["barkskin"], target: "target", duration: { type: "manual" } }),
  // "The first time the target would drop to 0 Hit Points before the spell ends, the target instead drops to 1 Hit
  // Point, and the spell ends."
  "death-ward": spellGrant({
    name: "Death Ward",
    tags: ["death-ward"],
    target: "target",
    duration: { type: "manual" }
  }),
  // "Resistance to one damage type of your choice: Acid, Cold, Fire, Lightning, or Thunder."
  "protection-from-energy": spellGrant({
    name: "Protection from Energy",
    tags: ["protection-from-energy", "resists-chosen-type"],
    target: "target",
    duration: { type: "manual" }
  }),
  // "Advantage on ability checks using the chosen ability", one for every target the cast takes.
  "enhance-ability": spellGrant({
    name: "Enhance Ability",
    tags: ["enhance-ability", "enhanced-ability"],
    target: "targets",
    duration: { type: "manual" }
  }),
  // "A creature you touch has the Invisible condition until the spell ends."
  "greater-invisibility": spellGrant({
    name: "Greater Invisibility",
    tags: ["greater-invisibility"],
    target: "target",
    duration: rounds(10),
    conditions: ["invisible"]
  }),
  // Invisible "until the spell ends", which it does "immediately after the target makes an attack roll, deals damage,
  // or casts a spell".
  invisibility: spellGrant({
    name: "Invisibility",
    tags: ["invisibility", "until-it-acts"],
    target: "targets",
    duration: { type: "manual" },
    conditions: ["invisible"]
  }),
  "mage-armor": spellGrant({
    name: "Mage Armor",
    tags: ["mage-armor"],
    target: "target",
    duration: { type: "manual" }
  }),
  // "Gains a Fly Speed of 60 feet and can hover."
  fly: spellGrant({
    name: "Fly",
    tags: ["fly-spell"],
    target: "targets",
    duration: rounds(100),
    modifiers: [{ type: "special-speed", movement: "fly", feet: 60, hover: true }]
  }),
  // "The target also gains a Climb Speed equal to its Speed." Walls and ceilings are the GM's.
  "spider-climb": spellGrant({
    name: "Spider Climb",
    tags: ["spider-climb"],
    target: "targets",
    duration: { type: "manual" },
    modifiers: [{ type: "special-speed", movement: "climb", equalToSpeed: true }]
  }),
  // "The target's Speed increases by 10 feet until the spell ends."
  longstrider: spellGrant({
    name: "Longstrider",
    tags: ["longstrider"],
    target: "targets",
    duration: { type: "manual" },
    modifiers: [{ type: "speed", amount: 10 }]
  }),
  // "The target also has a Swim Speed equal to its Speed." Its other protections stay with the GM.
  "freedom-of-movement": spellGrant({
    name: "Freedom of Movement",
    tags: ["freedom-of-movement"],
    target: "targets",
    duration: { type: "manual" },
    modifiers: [{ type: "special-speed", movement: "swim", equalToSpeed: true }]
  }),
  haste: spellGrant({
    name: "Haste",
    tags: ["hasted"],
    target: "target",
    duration: rounds(10),
    armorClassBonus: 2,
    modifiers: [
      {
        type: "roll-mode",
        roll: "save",
        mode: "advantage",
        when: [{ type: "on-saving-throw" }, { type: "ability-is", abilities: ["dex"] }]
      }
    ]
  })
};

/** What a failed save against the cast leaves on the creature while the spell lasts (SRD 5.2.1 text). */
const SAVE_FAILURE_EFFECTS: Readonly<Record<string, FailureEffect>> = {
  bane: { name: "Bane", tags: ["baned"], duration: rounds(10), modifiers: d20Dice("-1d4") },
  // Outlined in light: it sheds Dim Light in a 10-foot radius, attack rolls against it have Advantage, and it can't
  // benefit from the Invisible condition.
  "faerie-fire": {
    name: "Faerie Fire",
    tags: ["outlined"],
    duration: rounds(10),
    modifiers: [attackedWithAdvantage],
    light: { brightFeet: 0, dimFeet: 10 }
  },
  // "Speed is halved, it takes a -2 penalty to AC and Dexterity saving throws, and it can't take Reactions", with
  // one action or Bonus Action a turn, one attack with the Attack action and a chance a somatic spell fails.
  slow: {
    name: "Slow",
    tags: ["speed-halved", "no-reactions", "slowed"],
    armorClassBonus: -2,
    modifiers: [
      {
        type: "save-bonus",
        amount: -2,
        when: [{ type: "on-saving-throw" }, { type: "ability-is", abilities: ["dex"] }]
      }
    ]
  },
  // "Can't cast spells or take the Magic action", until a repeated save every 30 days or a spell ends it.
  befuddlement: { name: "Befuddlement", tags: ["no-spells"], modifiers: [] },
  // "Another 5d4 Acid damage at the end of its next turn" (the save carries the damage).
  "vitriolic-sphere": { name: "Vitriolic Sphere", tags: ["vitriolic-sphere"], duration: rounds(1), modifiers: [] },
  // "Disadvantage on the next attack roll it makes before the end of its next turn": its own roll spends it.
  "vicious-mockery": {
    name: "Vicious Mockery",
    tags: ["until-own-attack"],
    duration: { type: "until-bearer-turn-end" },
    modifiers: [{ type: "roll-mode", roll: "attack", mode: "disadvantage" }]
  }
};

/** Areas the text gives no template shape for (a wall, a thing placed at a point), so the GM can place them on the
 *  map: a straight wall as a 5-foot-wide Line (a ringed one is the GM's to draw), and a sphere, guardian or pack as the
 *  circle its later area reaches around its point. */
const SPELL_AREAS: Readonly<Record<string, ActionArea>> = {
  "blade-barrier": { shape: "line", sizeFeet: 100, widthFeet: 5 },
  "conjure-animals": { shape: "sphere", sizeFeet: 10, widthFeet: null },
  "flaming-sphere": { shape: "sphere", sizeFeet: 5, widthFeet: null },
  "guardian-of-faith": { shape: "sphere", sizeFeet: 10, widthFeet: null },
  "wall-of-fire": { shape: "line", sizeFeet: 60, widthFeet: 5 },
  "wall-of-thorns": { shape: "line", sizeFeet: 60, widthFeet: 5 }
};

/** The area a spell's cast covers, for the map template: the reviewed one, else what the text names. */
export function spellAreaFor(id: string, description: string): ActionArea | null {
  return SPELL_AREAS[id] ?? areaOfProse(description);
}

/** The cast model for one SRD spell from its text, its range and the source's damage columns. */
export function spellEffectFor(
  id: string,
  description: string,
  roll: string | null,
  types: readonly string[],
  range: SpellRange
): SpellEffect {
  const healing = CAST_HEALING[id] ?? healingOfText(description);
  const attacks = CAST_ATTACKS[id] ?? (/\bmakes? an? (?:ranged|melee) spell attack\b/i.test(description) ? 1 : 0);
  const attackRange = attacks > 0 ? spellAttackRangeOf(description, range) : null;
  const reaction = CAST_REACTIONS[id];
  const darts = CAST_DARTS[id];
  const choices = DAMAGE_CHOICES[id];
  const later = LATER_ACTIONS[id];
  const targets = CAST_TARGETS[id];
  const grant = CAST_GRANTS[id];
  const failureEffect = SAVE_FAILURE_EFFECTS[id];
  const onHit = CAST_ON_HIT[id];
  const missDamage = CAST_MISS_DAMAGE[id];
  const drain = CAST_DRAINS[id];
  const cures = CAST_CURES[id];
  const burst = CAST_BURSTS[id];
  return {
    attacks,
    ...(attackRange ? { attackRange } : {}),
    ...(onHit ? { onHit: structuredClone(onHit) as OnHitRider[] } : {}),
    ...(missDamage ? { missDamage } : {}),
    ...(drain ? { drain: { ...drain } } : {}),
    ...(burst ? { burst: structuredClone(burst) } : {}),
    damage: castDamage(id, roll, types, healing !== null),
    ...(choices ? { damageTypes: [...choices] } : {}),
    ...(NO_CAST_SAVE.has(id) ? { noCastSave: true as const } : {}),
    ...(later ? { laterActions: later.map((row) => ({ ...row, damage: [...row.damage] })) } : {}),
    ...(darts ? { darts } : {}),
    ...(targets ? { targets: { ...targets } } : {}),
    healing: healing ? { ...healing } : null,
    ...(cures
      ? { endsConditions: [...cures.conditions], ...(cures.one ? { endsOneCondition: true as const } : {}) }
      : {}),
    ...(grant ? { grant: structuredClone(grant) } : {}),
    ...(failureEffect ? { failureEffect: structuredClone(failureEffect) } : {}),
    ...(reaction ? { reaction } : {})
  };
}

/** Whether the caster makes a spell attack roll, when it casts or on a later turn (Flame Blade's slashes, Arcane
 *  Hand's Clenched Fist). The source's `attack_roll` is set by any mention of an attack roll, so it marks Bless and
 *  Shining Smite too. */
export function makesSpellAttack(description: string, effect: SpellEffect): boolean {
  return (
    effect.attacks > 0 ||
    (effect.laterActions ?? []).some((row) => row.attackRange !== undefined) ||
    /\bmakes? (?:an?|one) (?:ranged|melee) spell attack\b/i.test(description)
  );
}

function castDamage(id: string, roll: string | null, types: readonly string[], heals: boolean): Damage {
  if (CAST_DAMAGE[id]) return CAST_DAMAGE[id];
  if (NO_CAST_DAMAGE[id] !== undefined || heals || !roll || types.length === 0) return [];
  if (types.length > 1) throw new Error(`${id}: ${types.length} damage types need a reviewed CAST_DAMAGE row.`);
  return [{ formula: roll, type: DamageTypeSchema.parse(types[0]) }];
}

type CastingOption = SpellReference["castingOptions"][number];
type UpcastRow = Readonly<{ roll?: string | null; count?: number | null }>;

/** Printed higher-slot rows the source gets wrong, by slot level: the roll that replaces the cast's own (`roll`),
 *  and how many rays, darts or targets (`count`). */
const UPCAST_CORRECTIONS: Readonly<Record<string, Readonly<Record<number, UpcastRow>>>> = {
  // The source drops the +40 from every row.
  disintegrate: { 7: { roll: "13d6 + 40" }, 8: { roll: "16d6 + 40" }, 9: { roll: "19d6 + 40" } },
  // The source prints no rows: +1d6 for each slot level above 1.
  "dissonant-whispers": Object.fromEntries(
    [2, 3, 4, 5, 6, 7, 8, 9].map((level) => [level, { roll: `${level + 2}d6` }] as const)
  ),
  // The source scales the 1d10 Piercing hit; the SRD scales the 2d6 Cold burst, which stays with the GM.
  "ice-knife": Object.fromEntries([2, 3, 4, 5, 6, 7, 8, 9].map((level) => [level, { roll: null }] as const)),
  // +2d6 for each slot level above 6; the source prints +1d6.
  "wall-of-ice": { 7: { roll: "12d6" }, 8: { roll: "14d6" }, 9: { roll: "16d6" } },
  // +10 Hit Points for each slot level above 6; the source prints no amounts.
  heal: { 7: { roll: "80" }, 8: { roll: "90" }, 9: { roll: "100" } }
};

/** One spell's higher-slot and cantrip rows with the reviewed corrections, sorted as the source sorts them. */
export function castingOptionsFor(id: string, options: readonly CastingOption[]): CastingOption[] {
  const corrections = UPCAST_CORRECTIONS[id] ?? {};
  const rows = new Map(options.map((option) => [option.type, { ...option }]));
  for (const [level, row] of Object.entries(corrections)) {
    const type = `slot_level_${level}`;
    const current = rows.get(type) ?? { type, damageRoll: null, targetCount: null, description: null };
    rows.set(type, {
      ...current,
      ...(row.roll !== undefined ? { damageRoll: row.roll } : {}),
      ...(row.count !== undefined ? { targetCount: row.count } : {})
    });
  }
  return [...rows.values()].sort((left, right) => left.type.localeCompare(right.type));
}

/** The reviewed ids, so a test can check every row still names a real spell. */
export const SPELL_EFFECT_REVIEWED_IDS: readonly string[] = [
  ...Object.keys(NO_CAST_DAMAGE),
  ...Object.keys(CAST_DAMAGE),
  ...Object.keys(CAST_ATTACKS),
  ...Object.keys(DAMAGE_CHOICES),
  ...NO_CAST_SAVE,
  ...Object.keys(LATER_ACTIONS),
  ...Object.keys(CAST_DARTS),
  ...Object.keys(CAST_TARGETS),
  ...Object.keys(UPCAST_CORRECTIONS),
  ...Object.keys(CAST_REACTIONS),
  ...Object.keys(CAST_GRANTS),
  ...Object.keys(CAST_ON_HIT),
  ...Object.keys(CAST_MISS_DAMAGE),
  ...Object.keys(CAST_DRAINS),
  ...Object.keys(CAST_BURSTS),
  ...Object.keys(CAST_CURES),
  ...Object.keys(CAST_HEALING),
  ...Object.keys(SAVE_FAILURE_EFFECTS),
  ...Object.keys(SPELL_AREAS)
];
