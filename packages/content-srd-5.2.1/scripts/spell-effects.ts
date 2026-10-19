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
  // The caster's own failed save: "you take 6d6 Psychic damage" (`CAST_SELF_SAVES`).
  "contact-other-plane": [{ formula: "6d6", type: "psychic" }],
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
  // "Radiant or Necrotic damage (your choice when you cast this spell)".
  forbiddance: ["radiant", "necrotic"],
  // The explosive rune's "Acid, Cold, Fire, Lightning, or Thunder damage (your choice when you create the glyph)".
  "glyph-of-warding": ["thunder", "acid", "cold", "fire", "lightning"],
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
 *  above 1"), for every spell whose text names a number of creatures it picks. The caster counts among them where the
 *  text adds it ("You and up to eight willing creatures"). An area's targets are whoever its template covers, and a
 *  spell that picks "any number" has no row. */
const CAST_TARGETS: Readonly<Record<string, NonNullable<SpellEffect["targets"]>>> = {
  aid: { count: 3 },
  "animal-friendship": { count: 1, perSlot: 1 },
  "animal-messenger": { count: 1 },
  antipathysympathy: { count: 1 },
  "arcanists-magic-aura": { count: 1 },
  "astral-projection": { count: 9 },
  bane: { count: 3, perSlot: 1 },
  banishment: { count: 1, perSlot: 1 },
  barkskin: { count: 1 },
  befuddlement: { count: 1 },
  "bestow-curse": { count: 1 },
  bless: { count: 3, perSlot: 1 },
  blight: { count: 1 },
  blindnessdeafness: { count: 1, perSlot: 1 },
  // The first target and the three bolts that leap from it, one more for each slot level above 6.
  "chain-lightning": { count: 4, perSlot: 1 },
  "charm-monster": { count: 1, perSlot: 1 },
  "charm-person": { count: 1, perSlot: 1 },
  clone: { count: 1 },
  command: { count: 1, perSlot: 1 },
  contagion: { count: 1 },
  counterspell: { count: 1 },
  "cure-wounds": { count: 1 },
  darkvision: { count: 1 },
  "death-ward": { count: 1 },
  disintegrate: { count: 1 },
  "dispel-magic": { count: 1 },
  "dissonant-whispers": { count: 1 },
  "dominate-beast": { count: 1 },
  "dominate-monster": { count: 1 },
  "dominate-person": { count: 1 },
  "dragons-breath": { count: 1 },
  dream: { count: 1 },
  "enhance-ability": { count: 1, perSlot: 1 },
  enlargereduce: { count: 1 },
  eyebite: { count: 1 },
  // "Choose up to five falling creatures within range."
  "feather-fall": { count: 5 },
  "finger-of-death": { count: 1 },
  "flesh-to-stone": { count: 1 },
  fly: { count: 1, perSlot: 1 },
  foresight: { count: 1 },
  "freedom-of-movement": { count: 1, perSlot: 1 },
  "gaseous-form": { count: 1, perSlot: 1 },
  geas: { count: 1 },
  "greater-invisibility": { count: 1 },
  "greater-restoration": { count: 1 },
  guidance: { count: 1 },
  harm: { count: 1 },
  haste: { count: 1 },
  heal: { count: 1 },
  "healing-word": { count: 1 },
  "hellish-rebuke": { count: 1 },
  heroism: { count: 1, perSlot: 1 },
  hex: { count: 1 },
  "hideous-laughter": { count: 1, perSlot: 1 },
  "hold-monster": { count: 1, perSlot: 1 },
  "hold-person": { count: 1, perSlot: 1 },
  "hunters-mark": { count: 1 },
  imprisonment: { count: 1 },
  "inflict-wounds": { count: 1 },
  invisibility: { count: 1, perSlot: 1 },
  "irresistible-dance": { count: 1 },
  jump: { count: 1, perSlot: 1 },
  "lesser-restoration": { count: 1 },
  levitate: { count: 1 },
  longstrider: { count: 1, perSlot: 1 },
  "mage-armor": { count: 1 },
  "mass-cure-wounds": { count: 6 },
  "mass-healing-word": { count: 6 },
  "mass-suggestion": { count: 12 },
  maze: { count: 1 },
  message: { count: 1 },
  "mind-blank": { count: 1 },
  "mind-spike": { count: 1 },
  "modify-memory": { count: 1 },
  nondetection: { count: 1 },
  "phantasmal-force": { count: 1 },
  "phantasmal-killer": { count: 1 },
  "plane-shift": { count: 9 },
  polymorph: { count: 1 },
  "power-word-heal": { count: 1 },
  "power-word-kill": { count: 1 },
  "power-word-stun": { count: 1 },
  "prayer-of-healing": { count: 5 },
  "protection-from-energy": { count: 1 },
  "protection-from-evil-and-good": { count: 1 },
  "protection-from-poison": { count: 1 },
  "raise-dead": { count: 1 },
  "ray-of-enfeeblement": { count: 1 },
  regenerate: { count: 1 },
  reincarnate: { count: 1 },
  "remove-curse": { count: 1 },
  "resilient-sphere": { count: 1 },
  resistance: { count: 1 },
  resurrection: { count: 1 },
  revivify: { count: 1 },
  "sacred-flame": { count: 1 },
  sanctuary: { count: 1 },
  slow: { count: 6 },
  scrying: { count: 1 },
  sending: { count: 1 },
  sequester: { count: 1 },
  "shield-of-faith": { count: 1 },
  "spare-the-dying": { count: 1 },
  "spider-climb": { count: 1, perSlot: 1 },
  stoneskin: { count: 1 },
  suggestion: { count: 1 },
  telekinesis: { count: 1 },
  "telepathic-bond": { count: 8 },
  teleport: { count: 9 },
  tongues: { count: 1 },
  "true-polymorph": { count: 1 },
  "true-resurrection": { count: 1 },
  "true-seeing": { count: 1 },
  "vicious-mockery": { count: 1 },
  "warding-bond": { count: 1 },
  "water-breathing": { count: 10 },
  "water-walk": { count: 10 },
  "wind-walk": { count: 11 },
  "word-of-recall": { count: 6 }
};

/** Spells whose targets are creatures the caster can see (SRD "a creature you can see within range"). */
const SEEN_TARGETS: ReadonlySet<string> = new Set([
  "animal-friendship",
  "animal-messenger",
  "animal-shapes",
  "bane",
  "banishment",
  "befuddlement",
  "blight",
  "blindnessdeafness",
  "chain-lightning",
  "charm-monster",
  "charm-person",
  "command",
  "compulsion",
  "counterspell",
  "disintegrate",
  "dissonant-whispers",
  "dominate-beast",
  "dominate-monster",
  "dominate-person",
  "enlargereduce",
  "enthrall",
  "eyebite",
  "finger-of-death",
  "flesh-to-stone",
  "geas",
  "harm",
  "haste",
  "heal",
  "healing-word",
  "hex",
  "hideous-laughter",
  "hold-monster",
  "hold-person",
  "hunters-mark",
  "imprisonment",
  "irresistible-dance",
  "levitate",
  "magic-missile",
  "mass-heal",
  "mass-healing-word",
  "mass-suggestion",
  "maze",
  "mind-spike",
  "modify-memory",
  "phantasmal-force",
  "phantasmal-killer",
  "polymorph",
  "power-word-heal",
  "power-word-kill",
  "power-word-stun",
  "sacred-flame",
  "seeming",
  "suggestion",
  "telekinesis",
  "teleport",
  "true-polymorph"
]);

/** The creature types a spell can target, where its text names them ("Choose a Humanoid", "Target a Beast"). */
const TARGET_TYPES: Readonly<Record<string, readonly string[]>> = {
  "animal-friendship": ["beast"],
  "animal-messenger": ["beast"],
  awaken: ["beast", "plant"],
  // "Each Humanoid in a 20-foot-radius Sphere": the area's other creatures are left out.
  "calm-emotions": ["humanoid"],
  "charm-person": ["humanoid"],
  "dominate-beast": ["beast"],
  "dominate-person": ["humanoid"],
  "hold-person": ["humanoid"],
  reincarnate: ["humanoid"],
  simulacrum: ["beast", "humanoid"]
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
  // Only a creature the wall would enclose saves, which is the GM's to see; the line itself asks no one.
  "wall-of-stone",
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
/** "The area is Difficult Terrain" for every creature. */
const DIFFICULT: NonNullable<Zone["terrain"]> = { cost: 2 };
/** A row for an area that only lasts on the map (its ground, its barrier), with nothing to roll. */
const lasting = (name: string, when: string, zone: Zone): Later => ({
  name,
  activation: "other",
  when,
  damage: [],
  zone
});

/**
 * What a spell lets its caster do after the cast (SRD 5.2.1 text): the attacks a summoned thing or a held flame
 * makes on later turns, and the saves or damage an area deals when a creature enters it or starts or ends its turn
 * there. An area with a `zone` is watched by the server, which raises the save or deals the damage to the creature at
 * that moment; the rest stay with the GM, whom the cast reminds.
 */
const LATER_ACTIONS: Readonly<Record<string, readonly Later[]>> = {
  // "An alarm alerts you whenever a creature touches or enters the warded area", sparing the creatures you designate:
  // your allies.
  alarm: [
    {
      name: "alarm",
      activation: "other",
      when: "Whenever a creature other than your allies enters the warded area, the alarm alerts you.",
      damage: [],
      zone: { on: ["enter"], alerts: true, affects: "enemies" }
    }
  ],
  // "The aura prevents creatures other than Constructs and Undead from passing or reaching through it."
  "antilife-shell": [
    lasting("barrier", "Creatures other than Constructs and Undead can't pass or reach through the Emanation.", {
      on: [],
      around: "caster",
      feet: 10,
      bars: { way: "both", except: ["construct", "undead"], reach: true }
    })
  ],
  // "While in the aura, you and your allies have Resistance to Necrotic damage", and "if an ally with 0 Hit Points
  // starts its turn in the aura, that ally regains 1 Hit Point."
  "aura-of-life": [
    lasting(
      "aura",
      "You and your allies in the aura have Resistance to Necrotic damage; an ally at 0 Hit Points that starts its turn there regains 1 Hit Point.",
      {
        on: ["start-turn"],
        around: "caster",
        feet: 30,
        affects: "allies",
        holds: { modifiers: [{ type: "damage-resistance", damageTypes: ["necrotic"] }] },
        revives: 1
      }
    )
  ],
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
      when: `A creature that enters the area or ends its turn there makes the save. ${ONCE_PER_TURN} The area is Difficult Terrain.`,
      save: { ability: "str", successDamage: "none", failureConditions: ["restrained"] },
      damage: [{ formula: "3d6", type: "bludgeoning" }],
      zone: { ...ENTER_OR_END_ONCE, terrain: DIFFICULT }
    }
  ],
  "blade-barrier": [
    {
      name: "save",
      activation: "other",
      when: `A creature that enters the wall's space or ends its turn there makes the save. ${ONCE_PER_TURN} Its space is Difficult Terrain, and the wall gives Three-Quarters Cover.`,
      save: save("dex"),
      damage: [{ formula: "6d10", type: "force" }],
      zone: { ...ENTER_OR_END_ONCE, terrain: DIFFICULT, cover: "three-quarters" }
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
      zone: { ...ENTER_OR_END_ONCE, drifts: 10 }
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
      damage: [{ formula: "8d8", type: "lightning" }],
      // A Large spirit: its space and 5 feet around it reach 10 feet from its point. The caster's chosen element is
      // its damage type.
      zone: { on: ["enter", "start-turn"], around: "point", feet: 10, affects: "enemies", holdsOne: true }
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
  // "The ground in the Emanation is Difficult Terrain for your enemies."
  "conjure-minor-elementals": [
    lasting("ground", "The ground in the Emanation is Difficult Terrain for your enemies.", {
      on: [],
      around: "caster",
      feet: 15,
      terrain: { cost: 2, for: "enemies" }
    })
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
      area: { shape: "sphere", sizeFeet: 20, widthFeet: null },
      zone: { on: ["spell-end"], grows: true }
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
  // "The ground there is Difficult Terrain", and "at the end of each of your turns for the duration, each creature on
  // the ground in the area makes a Dexterity saving throw. On a failed save, a creature has the Prone condition, and
  // its Concentration is broken."
  earthquake: [
    {
      name: "tremor",
      activation: "other",
      when: "At the end of each of your turns, each creature on the ground in the area makes the save: Prone and its Concentration broken on a failure. The ground is Difficult Terrain.",
      save: { ability: "dex", successDamage: "none", failureConditions: ["prone"], breaksConcentration: true },
      damage: [],
      zone: { on: ["caster-turn-end"], terrain: DIFFICULT }
    }
  ],
  // "For the duration, these plants turn the ground in the area into Difficult Terrain."
  entangle: [
    lasting("ground", "The plants turn the ground in the area into Difficult Terrain.", {
      on: [],
      terrain: { cost: 2, kind: "plants" }
    })
  ],
  "faithful-hound": [
    {
      name: "bite",
      activation: "other",
      when: "At the start of each of your turns, the hound bites one enemy within 5 feet of it.",
      save: { ability: "dex", successDamage: "none", failureConditions: [] },
      damage: [{ formula: "4d8", type: "force" }],
      zone: { on: ["caster-turn-start"], around: "point", feet: 5, affects: "enemies" }
    }
  ],
  // "When a creature of a chosen type enters the spell's area for the first time on a turn or ends its turn there, the
  // creature takes 5d10 Radiant or Necrotic damage", and "creatures can't teleport into the area". Every type the
  // spell names is chosen.
  forbiddance: [
    {
      name: "ward",
      activation: "other",
      when: "An Aberration, Celestial, Elemental, Fey, Fiend or Undead that enters the area for the first time on a turn or ends its turn there takes the damage. No creature can teleport into the area.",
      damage: [{ formula: "5d10", type: "radiant" }],
      zone: {
        ...ENTER_OR_END_ONCE,
        types: ["aberration", "celestial", "elemental", "fey", "fiend", "undead"],
        noTeleport: true
      }
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
      damage: [{ formula: "2d6", type: "fire" }],
      area: { shape: "sphere", sizeFeet: 5, widthFeet: null },
      movesArea: { feet: 30 }
    }
  ],
  grease: [
    {
      name: "save",
      activation: "other",
      when: "A creature that enters the area or ends its turn there must also succeed on the save or fall Prone. The grease is Difficult Terrain.",
      save: { ability: "dex", successDamage: "none", failureConditions: ["prone"] },
      damage: [],
      zone: { on: ["enter", "end-turn"], terrain: DIFFICULT }
    }
  ],
  // "An immobile, shimmering barrier appears in a 10 foot Emanation around you", and "any spell of level 5 or lower cast
  // from outside the barrier can't affect anything within it".
  "globe-of-invulnerability": [
    lasting("barrier", "A spell of level 5 or lower cast from outside the barrier can't affect anything within it.", {
      on: [],
      around: "caster",
      feet: 10,
      stays: true,
      wardsSpells: 5
    })
  ],
  // Explosive Rune: a creature that sets the glyph off (stepping on it) makes it erupt in a "20-foot-radius Sphere
  // centered on the glyph", and "once a glyph is triggered, this spell ends". The glyph is nearly imperceptible.
  "glyph-of-warding": [
    {
      name: "explosive rune",
      activation: "other",
      when: "A creature that steps onto the glyph sets it off: each creature in the 20-foot-radius Sphere makes the save, and the spell ends.",
      save: save("dex"),
      damage: [{ formula: "5d8", type: "thunder" }],
      zone: { on: ["enter", "spell-end"], around: "point", feet: 5, once: true, hidden: true }
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
  // "Creatures of your choice have Advantage on all saving throws, and other creatures have Disadvantage on attack
  // rolls against them. In addition, when a Fiend or an Undead hits an affected creature with a melee attack roll, the
  // attacker must succeed on a Constitution saving throw or have the Blinded condition until the end of its next turn."
  // The creatures chosen are the caster and its allies.
  "holy-aura": [
    lasting(
      "aura",
      "You and your allies in the aura have Advantage on saving throws, and attack rolls against them have Disadvantage; a Fiend or an Undead that hits one with a melee attack makes a Constitution save or is Blinded.",
      {
        on: [],
        around: "caster",
        feet: 30,
        affects: "allies",
        holds: {
          modifiers: [
            { type: "roll-mode", roll: "save", mode: "advantage" },
            { type: "roll-mode", roll: "incoming-attack", mode: "disadvantage", when: [{ type: "on-attack-roll" }] }
          ],
          struck: { creatureTypes: ["fiend", "undead"], save: { ability: "con", conditions: ["blinded"] } }
        }
      }
    )
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
  // "Hailstones turn ground in the Cylinder into Difficult Terrain until the end of your next turn."
  "ice-storm": [
    lasting(
      "ground",
      "Hailstones turn the ground in the Cylinder into Difficult Terrain until the end of your next turn.",
      {
        on: [],
        terrain: { cost: 2, kind: "ice" },
        untilCasterNextTurnEnd: true
      }
    )
  ],
  "incendiary-cloud": [
    {
      name: "save",
      activation: "other",
      when: `A creature the Sphere moves into, or that enters it or ends its turn there, makes the save. ${ONCE_PER_TURN} The cloud moves 10 feet away from you at the start of each of your turns.`,
      save: save("dex"),
      damage: [{ formula: "10d8", type: "fire" }],
      zone: { ...ENTER_OR_END_ONCE, drifts: 10 }
    }
  ],
  "insect-plague": [
    {
      name: "save",
      activation: "other",
      when: `A creature that enters the area for the first time on a turn or ends its turn there makes the save. ${ONCE_PER_TURN} The area is Difficult Terrain.`,
      save: save("con"),
      damage: [{ formula: "4d10", type: "piercing" }],
      zone: { ...ENTER_OR_END_ONCE, terrain: DIFFICULT }
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
    },
    // "On each of your later turns, you can take a Magic action to move the Cylinder up to 60 feet."
    {
      name: "move",
      activation: "action",
      when: "On your later turns, a Magic action moves the Cylinder up to 60 feet; a creature it moves onto makes the save.",
      laterTurnsOnly: true,
      damage: [],
      area: { shape: "cylinder", sizeFeet: 5, widthFeet: null },
      movesArea: { feet: 60 }
    }
  ],
  // "As a Magic action on your later turns, you can control the hand thus again": it opens or closes an unlocked door.
  "mage-hand": [
    {
      name: "control",
      activation: "action",
      when: "As a Magic action on your later turns, you control the hand again, opening or closing an unlocked door within 30 feet.",
      damage: [],
      laterTurnsOnly: true
    }
  ],
  // A creature of a chosen type "can't willingly enter the Cylinder by nonmagical means". Every type the spell names is
  // chosen, and the circle faces outward.
  "magic-circle": [
    lasting("barrier", "Celestials, Elementals, Fey, Fiends and Undead can't willingly enter the Cylinder.", {
      on: [],
      bars: { way: "in", types: ["celestial", "elemental", "fey", "fiend", "undead"] }
    })
  ],
  // Overgrowth: "A creature moving through that area must spend 4 feet of movement for every 1 foot it moves." The
  // plants stay overgrown, so the area stays until the GM ends it.
  "plant-growth": [
    lasting("ground", "A creature moving through the overgrown area spends 4 feet of movement for every foot.", {
      on: [],
      terrain: { cost: 4, kind: "plants" }
    })
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
  // "While in the aura, you and each creature you choose have a +10 bonus to Dexterity (Stealth) checks": the caster
  // and its allies.
  "pass-without-trace": [
    lasting("aura", "You and your allies in the aura have a +10 bonus to Dexterity (Stealth) checks.", {
      on: [],
      around: "caster",
      feet: 30,
      affects: "allies",
      holds: {
        modifiers: [
          {
            type: "check-bonus",
            amount: 10,
            when: [{ type: "on-ability-check" }, { type: "skill-is", skills: ["stealth"] }]
          }
        ]
      }
    })
  ],
  // "Creatures have the Deafened condition while entirely inside it."
  silence: [
    lasting("aura", "A creature inside the Sphere has the Deafened condition.", {
      on: [],
      holds: { conditions: ["deafened"] }
    })
  ],
  "sleet-storm": [
    {
      name: "save",
      activation: "other",
      when: "A creature that enters the Cylinder for the first time on a turn or starts its turn there makes the save; a failure also breaks its Concentration. The ground is Difficult Terrain.",
      save: { ability: "dex", successDamage: "none", failureConditions: ["prone"], breaksConcentration: true },
      damage: [],
      zone: { on: ["enter", "start-turn"], terrain: { cost: 2, kind: "ice" } }
    }
  ],
  "spike-growth": [
    {
      name: "spikes",
      activation: "other",
      when: "A creature that moves into or within the area takes the damage for every 5 feet it travels. The area is Difficult Terrain.",
      damage: [{ formula: "2d4", type: "piercing" }],
      zone: { on: ["travel"], terrain: { cost: 2, kind: "plants" } }
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
      when: `A creature that enters a space in the wall for the first time on a turn or ends its turn there makes the save. ${ONCE_PER_TURN} Moving through the wall costs 4 feet for every foot.`,
      save: save("dex"),
      damage: [{ formula: "7d8", type: "slashing" }],
      zone: { ...ENTER_OR_END_ONCE, terrain: { cost: 4, kind: "plants" } }
    }
  ],
  // "Arrows, bolts, and other ordinary projectiles launched at targets behind the wall are deflected upward and miss
  // automatically"; "Small or smaller flying creatures or objects can't pass through the wall."
  "wind-wall": [
    lasting(
      "wall",
      "Arrows, bolts and other ordinary projectiles shot or thrown across the wall miss, and Small or smaller flying creatures can't pass through it.",
      { on: [], deflects: true, bars: { way: "both", sizes: ["tiny", "small"], flying: true } }
    )
  ],
  web: [
    {
      name: "save",
      activation: "other",
      when: "The first time a creature enters the webs on a turn or starts its turn there, it makes the save; Restrained, it can try a Strength (Athletics) check against your spell save DC as an action. The webs are Difficult Terrain.",
      save: { ability: "dex", successDamage: "none", failureConditions: ["restrained"] },
      damage: [],
      zone: { on: ["enter", "start-turn"], terrain: { cost: 2, kind: "webs" } }
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

/** Spells whose cast teleports the caster on the map, taken at once with no GM ask (`granted-moves.ts`). Teleport,
 *  Plane Shift and Word of Recall go somewhere off the map, which stays with the GM. */
const CAST_TELEPORTS: Readonly<Record<string, NonNullable<SpellEffect["teleport"]>>> = {
  // "You teleport up to 30 feet to an unoccupied space you can see."
  "misty-step": { feet: 30 },
  // "You teleport to a location within range": seen or not. "If you ... would arrive in a space occupied by a
  // creature ... you ... each take 4d6 Force damage, and the teleportation fails."
  "dimension-door": { feet: 500, unseen: true, failDamage: "4d6" }
};

/** Reaction spells the table offers as prompts: what triggers each and what casting it does. Counterspell answers a
 *  trigger the engine doesn't see (a spell being cast), so it stays with the GM. */
const CAST_REACTIONS: Readonly<Record<string, NonNullable<SpellEffect["reaction"]>>> = {
  // +5 AC until the start of the caster's next turn, including against the triggering attack.
  shield: { trigger: "hit-by-attack", response: "ac-bonus", amount: 5, untilNextTurn: true },
  "hellish-rebuke": { trigger: "damaged-by-creature", response: "strike-back", rangeFeet: 60 },
  // "When you or a creature you can see within 60 feet of you falls": the cast lands on the falling creature.
  "feather-fall": { trigger: "falls", response: "cast-on-faller", rangeFeet: 60 },
  // "When you see a creature within 60 feet of yourself casting a spell with Verbal, Somatic, or Material components":
  // the caster makes a Constitution saving throw.
  counterspell: { trigger: "casts-spell", response: "counter", ability: "con", rangeFeet: 60 }
};

/** Spells that make a creature at 0 Hit Points Stable, and whose range doubles with the cantrip's tiers. */
const STABILIZES: ReadonlySet<string> = new Set(["spare-the-dying"]);
const RANGE_DOUBLES: ReadonlySet<string> = new Set(["spare-the-dying"]);
/** "No sound can be created within or pass through" its area: no spell with a Verbal component is cast inside it. */
const SILENCES_AREA: ReadonlySet<string> = new Set(["silence"]);
/** Area spells whose caster picks the creatures in the area it affects ("each creature of your choice in a 30-foot
 *  Sphere"), so the cast picks them; the rest of the area's creatures are spared. */
const PICKS_IN_AREA: ReadonlySet<string> = new Set([
  "holy-aura",
  "mass-cure-wounds",
  "pass-without-trace",
  "sleep",
  "slow",
  "weird"
]);
/** "Three bolts then leap from that target to as many as three other targets ... within 30 feet of the first target." */
const CHAIN_FEET: Readonly<Record<string, number>> = { "chain-lightning": 30 };
/** "Using a Higher-Level Spell Slot": the feet an area grows for each slot level above the spell's (Fog Cloud's radius by
 *  20 feet, Confusion's by 5, Create or Destroy Water's Cube by 5). */
const AREA_PER_SLOT: Readonly<Record<string, number>> = { "fog-cloud": 20, confusion: 5, "create-or-destroy-water": 5 };

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
 * the engine reads (SRD 5.2.1 text). A grant "until ended" lasts the spell's own duration at the level it was cast
 * (`grant.ts`), and a Concentration spell's effects also end with the caster's Concentration; a duration given here is
 * one the text prints apart from the spell's (Guiding Bolt's light).
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
  // "For the duration, you sense the location of any Aberration, Celestial, Elemental, Fey, Fiend, or Undead within 30
  // feet of yourself. You also sense whether the Hallow spell is active there and, if so, where. The spell is blocked
  // by 1 foot of stone, dirt, or wood; 1 inch of metal; or a thin sheet of lead."
  "detect-evil-and-good": spellGrant({
    name: "Detect Evil and Good",
    tags: ["detect-evil-and-good"],
    target: "self",
    duration: { type: "manual" },
    detects: {
      creatureTypes: ["aberration", "celestial", "elemental", "fey", "fiend", "undead"],
      feet: 30,
      blockedByWalls: true
    }
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
  // "The next attack roll made against it before the end of your next turn has Advantage": whoever makes it spends the
  // light.
  "guiding-bolt": spellGrant({
    name: "Guiding Bolt's light",
    tags: ["until-attacked"],
    target: "target",
    onHit: true,
    duration: { type: "until-source-turn-end" },
    modifiers: [attackedWithAdvantage]
  }),
  "hunters-mark": spellGrant({
    name: "Hunter's Mark",
    tags: ["hunters-mark"],
    target: "target",
    duration: { type: "manual" },
    modifiers: [markDamage("force")]
  }),
  // "You place a curse on a creature", which Remove Curse ends.
  hex: spellGrant({
    name: "Hex",
    tags: ["hexed", "curse"],
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
  // "Any creature has Disadvantage on attack rolls against you. An attacker is immune to this effect if it perceives
  // you with Blindsight or Truesight."
  // Three duplicates for a minute, counted on the tag; the server rolls their d6s on each hit (`mirror-image.ts`).
  "mirror-image": spellGrant({
    name: "Mirror Image",
    tags: ["mirror-image", "mirror-image-3"],
    target: "self",
    duration: rounds(10)
  }),
  blur: spellGrant({
    name: "Blur",
    tags: ["blur"],
    target: "self",
    duration: rounds(10),
    modifiers: [
      {
        type: "roll-mode",
        roll: "incoming-attack",
        mode: "disadvantage",
        when: [{ type: "on-attack-roll" }, { type: "other-lacks-sense", senses: ["blindsight", "truesight"] }]
      }
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
  // "The target has an Armor Class of 17 if its AC is lower than that."
  barkskin: spellGrant({
    name: "Barkskin",
    tags: ["barkskin"],
    target: "target",
    duration: { type: "manual" },
    armorClassFloor: 17
  }),
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
  // "The target's base AC becomes 13 plus its Dexterity modifier", a way to work out AC that riders add to.
  "mage-armor": spellGrant({
    name: "Mage Armor",
    tags: ["mage-armor"],
    target: "target",
    duration: { type: "manual" },
    baseArmorClass: 13
  }),
  // "If a creature lands before the spell ends, the creature takes no damage from the fall, and the spell ends for
  // that creature." The engine lands a creature that carries it without damage (`falling.ts`).
  "feather-fall": spellGrant({
    name: "Feather Fall",
    tags: ["feather-fall"],
    target: "targets",
    duration: rounds(10)
  }),
  // "Once on each of its turns until the spell ends, that creature can jump up to 30 feet by spending 10 feet of
  // movement": a jump the movement rules take once a turn (`jumping.ts`).
  jump: spellGrant({
    name: "Jump",
    tags: ["jump"],
    target: "targets",
    duration: rounds(10),
    modifiers: [{ type: "movement", rule: "leap", feet: 30, costFeet: 10 }]
  }),
  // "You step into the border regions of the Ethereal Plane": off the map, unseen and untouchable from this plane,
  // until the caster ends it (8 hours); it returns to the space it left or the nearest unoccupied one.
  etherealness: spellGrant({
    name: "Etherealness",
    tags: ["off-plane"],
    target: "self",
    duration: { type: "manual" }
  }),
  // "You banish a creature ... into a labyrinthine demiplane": off the map while the caster concentrates; its escape
  // check is the GM's.
  maze: spellGrant({
    name: "Maze",
    tags: ["off-plane"],
    target: "target",
    duration: rounds(100)
  }),
  // "Roll 1d6 at the end of each of your turns": the server rolls it, and on a 4 or more the caster is off the map
  // until the start of its next turn (`off-plane.ts`).
  blink: spellGrant({
    name: "Blink",
    tags: ["blink"],
    target: "self",
    duration: rounds(10)
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
  // "The target's Speed is doubled", whatever its Speed is at each moment.
  haste: spellGrant({
    name: "Haste",
    tags: ["hasted"],
    target: "target",
    duration: rounds(10),
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
  })
};

/** What a failed save against the cast leaves on the creature while the spell lasts (SRD 5.2.1 text). */
const SAVE_FAILURE_EFFECTS: Readonly<Record<string, FailureEffect>> = {
  bane: { name: "Bane", tags: ["baned"], duration: rounds(10), modifiers: d20Dice("-1d4") },
  // Outlined in light: it sheds Dim Light in a 10-foot radius, attack rolls against it have Advantage "if the attacker
  // can see it", and it can't benefit from the Invisible condition.
  "faerie-fire": {
    name: "Faerie Fire",
    tags: ["outlined"],
    duration: rounds(10),
    modifiers: [{ ...attackedWithAdvantage, when: [{ type: "on-attack-roll" }, { type: "seen-by-other" }] }],
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
  // "Rises vertically up to 20 feet and remains suspended there for the duration", moving only "as if it were
  // climbing"; when it ends the target "floats gently to the ground" (`falling.ts` raises and lowers it).
  levitate: { name: "Levitate", tags: ["levitating"], modifiers: [] },
  // "Transported to a harmless demiplane for the duration ... When the spell ends, the target reappears in the space it
  // left or in the nearest unoccupied space": it leaves the map until the effect ends (`off-plane.ts`). An
  // extraplanar target that stays gone for the full minute is the GM's.
  banishment: { name: "Banished", tags: ["off-plane"], modifiers: [] },
  // Imprisoned "until the spell is dispelled": off the map until the GM ends it. Its form, and the trigger that frees
  // it, are the GM's.
  imprisonment: { name: "Imprisoned", tags: ["off-plane"], modifiers: [] },
  // "Must immediately use its Reaction, if available, to move as far away from you as it can, using the safest route":
  // the server spends the Reaction and gives the creature a move of its Speed that must end farther away.
  "dissonant-whispers": {
    name: "Dissonant Whispers",
    tags: ["flees-with-reaction"],
    duration: rounds(1),
    modifiers: []
  },
  // "Can't cast spells or take the Magic action", until a repeated save every 30 days or a spell ends it.
  befuddlement: { name: "Befuddlement", tags: ["no-spells"], modifiers: [] },
  // "Another 5d4 Acid damage at the end of its next turn" (the save carries the damage).
  "vitriolic-sphere": { name: "Vitriolic Sphere", tags: ["vitriolic-sphere"], duration: rounds(1), modifiers: [] },
  // "Has Disadvantage on ability checks and attack rolls for the duration", and the save at the end of each of its turns
  // ends the spell on a success.
  "phantasmal-killer": {
    name: "Phantasmal Killer",
    tags: ["phantasmal-killer"],
    modifiers: [
      { type: "roll-mode", roll: "attack", mode: "disadvantage" },
      { type: "roll-mode", roll: "check", mode: "disadvantage" }
    ]
  },
  // "A shimmering sphere encloses a Large or smaller creature or object": nothing passes its wall, in or out, and
  // Disintegrate destroys it (`enclosures.ts`). Rolling the sphere along is the GM's.
  "resilient-sphere": { name: "Resilient Sphere", tags: ["enclosed"], modifiers: [] },
  // "Become cursed for the duration": the curse the caster picks is the GM's to apply, and Remove Curse ends it.
  "bestow-curse": { name: "Bestow Curse", tags: ["curse"], modifiers: [] },
  // "A Remove Curse, Greater Restoration, or Wish spell ends this spell."
  geas: { name: "Geas", tags: ["curse"], modifiers: [] },
  // "Disadvantage on the next attack roll it makes before the end of its next turn": its own roll spends it.
  "vicious-mockery": {
    name: "Vicious Mockery",
    tags: ["until-own-attack"],
    duration: { type: "until-bearer-turn-end" },
    modifiers: [{ type: "roll-mode", roll: "attack", mode: "disadvantage" }]
  }
};

/** Saves the caster makes itself at a printed DC (SRD Contact Other Plane: "When you cast this spell, make a DC 15
 *  Intelligence saving throw"). */
const CAST_SELF_SAVES: Readonly<Record<string, NonNullable<SpellEffect["selfSave"]>>> = {
  "contact-other-plane": { dc: 15 }
};

/** What a cast ends on its target (SRD 5.2.1 text): Dispel Magic's spells of level 3 or lower, and Remove Curse's
 *  curses. */
const CAST_DISPELS: Readonly<Record<string, NonNullable<SpellEffect["dispel"]>>> = {
  "dispel-magic": { automaticLevel: 3 }
};
const CAST_ENDS_CURSES: ReadonlySet<string> = new Set(["remove-curse"]);

/** Concentration spells that keep a part of their own besides what they leave on creatures, so they don't end when no
 *  creature is affected any more: Entangle's tangled ground, an earthquake's shaking ground and fissures, and the storm
 *  cloud of Storm of Vengeance. */
const PERSISTS_WITHOUT_TARGETS: ReadonlySet<string> = new Set(["earthquake", "entangle", "storm-of-vengeance"]);

/** Areas the text gives no template shape for (a wall, a thing placed at a point), so the GM can place them on the
 *  map: a straight wall as a Line as long and thick as the text's (5 feet wide when thinner; a ringed or bent one is
 *  the GM's to draw), and a sphere, guardian, pack or cloud as the circle it covers around its point. */
const SPELL_AREAS: Readonly<Record<string, ActionArea>> = {
  "blade-barrier": { shape: "line", sizeFeet: 100, widthFeet: 5 },
  // The bolt's point and the 5 feet around it: "Each creature within 5 feet of that point".
  "call-lightning": { shape: "sphere", sizeFeet: 5, widthFeet: null },
  "conjure-animals": { shape: "sphere", sizeFeet: 10, widthFeet: null },
  // The Large spirit and the 5 feet it reaches around it.
  "conjure-elemental": { shape: "sphere", sizeFeet: 10, widthFeet: null },
  // "A 100-foot-radius circle centered on that point."
  earthquake: { shape: "cylinder", sizeFeet: 100, widthFeet: null },
  // "Up to 40,000 square feet of floor space": a 200-foot square.
  forbiddance: { shape: "cube", sizeFeet: 200, widthFeet: null },
  // The hound and the 5 feet it bites in.
  "faithful-hound": { shape: "sphere", sizeFeet: 5, widthFeet: null },
  "flaming-sphere": { shape: "sphere", sizeFeet: 5, widthFeet: null },
  // The cage, "up to 20 feet on a side".
  forcecage: { shape: "cube", sizeFeet: 20, widthFeet: null },
  "guardian-of-faith": { shape: "sphere", sizeFeet: 10, widthFeet: null },
  // "Up to 90 feet long, 30 feet high, and 1 inch thick"; the globe is the GM's to draw.
  "prismatic-wall": { shape: "line", sizeFeet: 90, widthFeet: 5 },
  // "Spreading to a radius of 300 feet": the creatures under the cloud.
  "storm-of-vengeance": { shape: "cylinder", sizeFeet: 300, widthFeet: null },
  // "Up to 300 feet long, 300 feet high, and 50 feet thick."
  tsunami: { shape: "line", sizeFeet: 300, widthFeet: 50 },
  "wall-of-fire": { shape: "line", sizeFeet: 60, widthFeet: 5 },
  // "A flat surface made up of ten 10-foot-by-10-foot panels" in a row; the dome and the globe are the GM's to draw.
  "wall-of-force": { shape: "line", sizeFeet: 100, widthFeet: 5 },
  // Ten 10-foot panels in a row; the text's "radius of up to 10 feet" names the dome, which the GM draws.
  "wall-of-ice": { shape: "line", sizeFeet: 100, widthFeet: 5 },
  // "Ten 10-foot-by-10-foot panels", in a row.
  "wall-of-stone": { shape: "line", sizeFeet: 100, widthFeet: 5 },
  "wall-of-thorns": { shape: "line", sizeFeet: 60, widthFeet: 5 },
  // "Up to 50 feet long, 15 feet high, and 1 foot thick."
  "wind-wall": { shape: "line", sizeFeet: 50, widthFeet: 5 }
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
  const teleport = CAST_TELEPORTS[id];
  const dispel = CAST_DISPELS[id];
  const selfSave = CAST_SELF_SAVES[id];
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
    ...(reaction ? { reaction } : {}),
    ...(teleport ? { teleport: { ...teleport } } : {}),
    ...(selfSave ? { selfSave: { ...selfSave } } : {}),
    ...(dispel ? { dispel: { ...dispel } } : {}),
    ...(CAST_ENDS_CURSES.has(id) ? { endsCurses: true as const } : {}),
    ...(PERSISTS_WITHOUT_TARGETS.has(id) ? { persistsWithoutTargets: true as const } : {}),
    ...(SEEN_TARGETS.has(id) ? { seenTargets: true as const } : {}),
    ...(TARGET_TYPES[id] ? { targetTypes: [...TARGET_TYPES[id]] } : {}),
    ...(STABILIZES.has(id) ? { stabilizes: true as const } : {}),
    ...(RANGE_DOUBLES.has(id) ? { rangeDoubles: true as const } : {}),
    ...(SILENCES_AREA.has(id) ? { silencesArea: true as const } : {}),
    ...(PICKS_IN_AREA.has(id) ? { picksInArea: true as const } : {}),
    ...(CHAIN_FEET[id] !== undefined ? { chainFeet: CHAIN_FEET[id] } : {}),
    ...(AREA_PER_SLOT[id] !== undefined ? { areaPerSlot: AREA_PER_SLOT[id] } : {})
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
  heal: { 7: { roll: "80" }, 8: { roll: "90" }, 9: { roll: "100" } },
  // The Healing Light's 4d12 gains 1d12 for each slot level above 7; the source prints the increase alone.
  "conjure-celestial": { 8: { roll: "5d12" }, 9: { roll: "6d12" } }
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
  ...Object.keys(CAST_TELEPORTS),
  ...Object.keys(CAST_GRANTS),
  ...Object.keys(CAST_ON_HIT),
  ...Object.keys(CAST_MISS_DAMAGE),
  ...Object.keys(CAST_DRAINS),
  ...Object.keys(CAST_BURSTS),
  ...Object.keys(CAST_CURES),
  ...Object.keys(CAST_HEALING),
  ...Object.keys(SAVE_FAILURE_EFFECTS),
  ...Object.keys(SPELL_AREAS),
  ...Object.keys(CAST_DISPELS),
  ...Object.keys(CAST_SELF_SAVES),
  ...CAST_ENDS_CURSES,
  ...PERSISTS_WITHOUT_TARGETS,
  ...SEEN_TARGETS,
  ...Object.keys(TARGET_TYPES),
  ...STABILIZES,
  ...RANGE_DOUBLES,
  ...SILENCES_AREA,
  ...PICKS_IN_AREA,
  ...Object.keys(CHAIN_FEET),
  ...Object.keys(AREA_PER_SLOT)
];
