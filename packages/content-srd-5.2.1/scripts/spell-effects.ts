/**
 * Each SRD spell's cast model (`SpellReference.effect`), read once at build time. The source's `damage` and
 * `attackRoll` columns describe the prose, so they are corrected here: damage that does not land on the cast's
 * targets is left out, a cast's several damage types each get their own dice, and an attack is a spell attack
 * the caster makes ("Make a ranged spell attack"), never one the text only mentions. `test/spell-effects.test.ts`
 * pins the cases.
 */
import {
  DamageTypeSchema,
  MASKED_TYPE_TAG,
  type ActionArea,
  type DamageType,
  type GrantOption,
  type OnHitRider
} from "@vtt/schemas";
import { CREATURE_TYPE_IDS as CREATURE_TYPES } from "../src/enums.js";
import { areaOfProse } from "../src/action-prose.js";
import type { SpellEffect, SpellLaterAction, SpellReference } from "../src/schemas.js";
import { healingOfText, spellAttackRangeOf, type SpellRange } from "../src/spell-effect.js";
import { spellSummonFieldsFor, SPELL_SUMMON_REVIEWED_IDS } from "./spell-summons.js";

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
  awaken: { count: 1 },
  bane: { count: 3, perSlot: 1 },
  banishment: { count: 1, perSlot: 1 },
  // "Up to three willing creatures (including yourself) for each spell slot level above 7": the caster alone at 7.
  etherealness: { count: 1 },
  // The creatures that climb the rope into its space, eight at most.
  "rope-trick": { count: 8 },
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
  "continual-flame": { count: 1 },
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
  // "Up to twelve creatures can partake of the feast."
  "heroes-feast": { count: 12 },
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
  light: { count: 1 },
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
  "animal-shapes": [
    {
      name: "transform again",
      activation: "action",
      when: "On your later turns, a Magic action transforms the targets again, each into a Large or smaller Beast of Challenge Rating 4 or lower.",
      laterTurnsOnly: true,
      damage: [],
      shapeShift: {
        from: "bestiary",
        onTargets: true,
        creatureTypes: ["beast"],
        maxChallenge: 4,
        maxSize: "large",
        keeps: ["mental", "type"],
        noSpells: true,
        gear: "merged",
        leaveAs: "bonus-action"
      }
    }
  ],
  shapechange: [
    {
      name: "new form",
      activation: "action",
      when: "Until the spell ends, a Magic action shape-shifts you into a different eligible form.",
      damage: [],
      shapeShift: {
        from: "bestiary",
        notCreatureTypes: ["construct", "undead"],
        challengeOf: "user",
        keeps: ["mental", "proficiencies", "spellcasting", "type"],
        gear: "choice"
      }
    }
  ],
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
  // "While in the aura, you and your allies have Resistance to Necrotic damage, and your Hit Point maximums can't be
  // reduced", and "if an ally with 0 Hit Points starts its turn in the aura, that ally regains 1 Hit Point."
  "aura-of-life": [
    lasting(
      "aura",
      "You and your allies in the aura have Resistance to Necrotic damage, and your Hit Point maximums can't be reduced; an ally at 0 Hit Points that starts its turn there regains 1 Hit Point.",
      {
        on: ["start-turn"],
        around: "caster",
        feet: 30,
        affects: "allies",
        holds: { modifiers: [{ type: "damage-resistance", damageTypes: ["necrotic"] }], keepsMaximum: true },
        revives: 1
      }
    )
  ],
  // "When you cast the spell and as a Bonus Action on your later turns, you can move the hand up to 60 feet and then
  // cause one of the following effects": each reaches from the hand (`spell-summons.ts`). Forceful Hand's push and
  // Interposing Hand's cover are the table's.
  "arcane-hand": [
    {
      name: "clenched fist",
      activation: "bonus-action",
      when: "The hand moves up to 60 feet and strikes a target within 5 feet of it with a melee spell attack.",
      attackRange: melee(125),
      damage: [{ formula: "5d8", type: "force" }]
    },
    {
      name: "grasping hand",
      activation: "bonus-action",
      when: "The hand moves up to 60 feet and grapples a Huge or smaller creature within 5 feet of it that fails a Dexterity save.",
      save: { ability: "dex", successDamage: "none", failureConditions: ["grappled"] },
      damage: []
    },
    {
      name: "crush",
      activation: "bonus-action",
      when: "While the hand grapples a creature, a Bonus Action crushes it.",
      damage: [{ formula: "4d6", type: "bludgeoning", addsModifier: true }]
    }
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
      // "At the start of each of its turns, the Restrained target repeats the save. On a failed save, the target takes
      // 4d8 damage of the spirit's type. On a successful save, the target isn't Restrained by the spirit."
      save: {
        ability: "dex",
        successDamage: "none",
        failureConditions: ["restrained"],
        repeatAtTurnStart: true,
        repeatFailureDamage: [{ formula: "4d8", type: "lightning" }]
      },
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
      zone: { on: ["caster-turn-end"], terrain: DIFFICULT, grounded: true }
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
  // "A creature that ends its turn in the Line must make the same save. Any creature in the Line must spend 2 feet of
  // movement for every 1 foot it moves when moving closer to you", and "As a Bonus Action on your later turns, you can
  // change the direction in which the Line blasts from you."
  "gust-of-wind": [
    {
      name: "gust",
      activation: "other",
      when: "A creature that ends its turn in the Line makes the save, and a failure pushes it 15 feet away from you. Moving closer to you in the Line costs 2 feet for every foot.",
      save: { ability: "str", successDamage: "none", failureConditions: [], failurePush: { feet: 15 } },
      damage: [],
      zone: { on: ["end-turn"], towardCaster: true }
    },
    {
      name: "turn",
      activation: "bonus-action",
      when: "As a Bonus Action on your later turns, you point the Line another way from you.",
      laterTurnsOnly: true,
      damage: [],
      area: { shape: "line", sizeFeet: 60, widthFeet: 10 },
      movesArea: { feet: 60, fromCaster: true }
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
  // "A 10-foot Emanation springs into existence around you and remains stationary": the creatures inside it at the cast
  // move through it freely, "all other creatures and objects are barred from passing through it", and "spells of level
  // 3 or lower can't be cast through it". Its light and its one-way sight are the GM's.
  "tiny-hut": [
    lasting(
      "hut",
      "Only the creatures inside the dome when it was made can pass through it, and spells of level 3 or lower cast from outside can't reach inside.",
      { on: [], around: "caster", feet: 10, stays: true, wardsSpells: 3, bars: { way: "both", insiders: true } }
    )
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
      // A shape-shifted creature that fails reverts to its true form.
      save: { ...save("con"), failureEndsForm: true },
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
  // "Creatures have the Deafened condition while entirely inside it" and "Immunity to Thunder damage".
  silence: [
    lasting("aura", "A creature inside the Sphere has the Deafened condition and Immunity to Thunder damage.", {
      on: [],
      holds: { modifiers: [{ type: "damage-immunity", damageTypes: ["thunder"] }], conditions: ["deafened"] }
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
  "dimension-door": { feet: 500, unseen: true, failDamage: "4d6", passenger: true }
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

/** Cantrips that light or snuff a flame (`resolution/cast-lights.ts`): Fire Play ("light or snuff out a candle, a
 *  torch, or a small campfire") within Druidcraft's 30 feet and Prestidigitation's 10, and Beckon Fire's embers that
 *  "can light candles, torches, or lamps" within Elementalism's 30. */
const KINDLES: Readonly<Record<string, NonNullable<SpellEffect["kindles"]>>> = {
  druidcraft: { feet: 30, snuffs: true },
  prestidigitation: { feet: 10, snuffs: true },
  elementalism: { feet: 30 }
};

/** A Self spell's other creatures stand this near its caster ("The creatures must be within 10 feet of you"). */
const COMPANION_FEET: Readonly<Record<string, number>> = { etherealness: 10 };

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

/** One choice a grant or a failed save offers, with what it adds. */
const option = (id: string, name: string, rest: Partial<Omit<GrantOption, "id" | "name">> = {}): GrantOption => ({
  id,
  name,
  tags: [],
  modifiers: [],
  ...rest
});
const ABILITIES = [
  ["str", "Strength"],
  ["dex", "Dexterity"],
  ["con", "Constitution"],
  ["int", "Intelligence"],
  ["wis", "Wisdom"],
  ["cha", "Charisma"]
] as const;
/** The SRD skills, for a spell that picks one (Guidance). */
const SKILLS: ReadonlyArray<readonly [id: string, name: string]> = [
  ["acrobatics", "Acrobatics"],
  ["animal-handling", "Animal Handling"],
  ["arcana", "Arcana"],
  ["athletics", "Athletics"],
  ["deception", "Deception"],
  ["history", "History"],
  ["insight", "Insight"],
  ["intimidation", "Intimidation"],
  ["investigation", "Investigation"],
  ["medicine", "Medicine"],
  ["nature", "Nature"],
  ["perception", "Perception"],
  ["performance", "Performance"],
  ["persuasion", "Persuasion"],
  ["religion", "Religion"],
  ["sleight-of-hand", "Sleight of Hand"],
  ["stealth", "Stealth"],
  ["survival", "Survival"]
];
const titled = (type: string) => `${type[0]!.toUpperCase()}${type.slice(1)}`;
/** Resistance's eleven types. */
const RESISTANCE_TYPES: readonly DamageType[] = [
  "acid",
  "bludgeoning",
  "cold",
  "fire",
  "lightning",
  "necrotic",
  "piercing",
  "poison",
  "radiant",
  "slashing",
  "thunder"
];
/** The kinds of creature Protection from Evil and Good guards against; Dispel Evil and Good leaves Aberrations out. */
const OTHERWORLDLY = ["aberration", "celestial", "elemental", "fey", "fiend", "undead"];
/** Disadvantage on attack rolls against the bearer from creatures of these kinds. */
const attackedWithDisadvantageBy = (creatureTypes: readonly string[]): Modifier => ({
  type: "roll-mode",
  roll: "incoming-attack",
  mode: "disadvantage",
  when: [{ type: "on-attack-roll" }, { type: "source-creature-type-is", creatureTypes: [...creatureTypes] }]
});
/** A roll mode on one ability's checks, saves or attack rolls. */
const onAbility = (
  roll: "check" | "save" | "attack",
  mode: "advantage" | "disadvantage",
  ability: (typeof ABILITIES)[number][0]
): Modifier => ({
  type: "roll-mode",
  roll,
  mode,
  when: [
    { type: roll === "check" ? "on-ability-check" : roll === "save" ? "on-saving-throw" : "on-attack-roll" },
    { type: "ability-is", abilities: [ability] }
  ]
});
/** Alter Self's natural weapon: the Unarmed Strike deals 1d6 of this type with the spellcasting ability. */
const naturalWeapon = (id: string, name: string, damageType: DamageType) =>
  option(id, name, { unarmedStrike: { dice: "1d6", damageType, ability: "spellcasting" } });
/** A die on the bearer's weapon and Unarmed Strike damage rolls, or with a minus taken off them (Reduce's 1d4 less,
 *  never below 1). */
const weaponDamageDie = (dice: string, leavesOne = false): Modifier => ({
  type: "damage-bonus",
  amount: 0,
  dice,
  ...(leavesOne ? { leavesOne: true as const } : {}),
  when: [{ type: "on-damage-roll" }, { type: "attack-kind-is", kinds: ["weapon", "unarmed"] }]
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
  // "Advantage on ability checks using the chosen ability", any but Constitution, picked for each target the cast
  // takes.
  "enhance-ability": spellGrant({
    name: "Enhance Ability",
    tags: ["enhance-ability"],
    target: "targets",
    duration: { type: "manual" },
    optionsPerTarget: true,
    options: ABILITIES.filter(([ability]) => ability !== "con").map(([ability, name]) =>
      option(ability, name, { modifiers: [onAbility("check", "advantage", ability)] })
    )
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
  // "Grants up to ten willing creatures of your choice within range the ability to breathe underwater until the spell
  // ends": a creature holding its breath breathes again.
  "water-breathing": spellGrant({
    name: "Water Breathing",
    tags: ["water-breathing"],
    target: "targets",
    duration: { type: "manual" }
  }),
  // "Any creature who targets the warded creature with an attack roll or a damaging spell must succeed on a Wisdom
  // saving throw or either choose a new target or lose the attack or spell", and it ends "if the warded creature
  // makes an attack roll, casts a spell, or deals damage".
  sanctuary: spellGrant({
    name: "Sanctuary",
    tags: ["sanctuary", "until-it-acts"],
    target: "target",
    duration: rounds(10),
    ward: { ability: "wis" }
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
  // "You step into the border regions of the Ethereal Plane": its token stays on the map, unseen and untouchable from
  // this plane, moving through it in any direction, until the caster ends it (8 hours); "if you appear in an occupied
  // space, you are shunted to the nearest unoccupied space and take Force damage equal to twice the number of feet you
  // are moved" (`ethereal.ts`, `off-plane.ts`). From a higher slot, willing creatures within 10 feet go too.
  etherealness: spellGrant({
    name: "Etherealness",
    tags: ["ethereal", "ethereal-shunt"],
    target: "self-and-targets",
    duration: { type: "manual" }
  }),
  // "You banish a creature ... into a labyrinthine demiplane": off the map while the caster concentrates. "The target
  // can take a Study action to try to escape ... a DC 20 Intelligence (Investigation) check": its way out ends it.
  maze: spellGrant({
    name: "Maze",
    tags: ["maze", "off-plane"],
    target: "target",
    duration: rounds(100),
    endAction: {
      activation: "action",
      kind: "check",
      ability: "int",
      skill: "investigation",
      dc: 20,
      label: "Find the way out"
    }
  }),
  // "Roll 1d6 at the end of each of your turns": the server rolls it, and on a 4 or more the caster is off the map
  // until the start of its next turn (`off-plane.ts`).
  blink: spellGrant({
    name: "Blink",
    tags: ["blink"],
    target: "self",
    duration: rounds(10)
  }),
  // "Move from inside it to inside another tree of the same kind within 500 feet ... You must use 5 feet of movement to
  // enter a tree ... using another 5 feet of movement ... only once on each of your turns": a 500-foot teleport, seen
  // or not, for 10 feet of movement, on each of the caster's turns while it concentrates (`granted-moves.ts`).
  "tree-stride": spellGrant({
    name: "Tree Stride",
    tags: ["tree-stride"],
    target: "self",
    duration: rounds(10),
    teleportEachTurn: { feet: 500, unseen: true, costFeet: 10 }
  }),
  // "You step into a stone object or surface ... Nothing of your presence remains visible or otherwise detectable by
  // nonmagical senses. While merged with the stone, you can't see what occurs outside it, and any Wisdom (Perception)
  // checks you make to hear sounds outside it are made with Disadvantage ... can cast spells on yourself": off the map,
  // untouchable both ways, back where it entered (`off-plane.ts`), for 8 hours.
  "meld-into-stone": spellGrant({
    name: "Meld into Stone",
    tags: ["off-plane", "meld-into-stone"],
    target: "self",
    duration: { type: "minutes", minutes: 480 },
    modifiers: [
      {
        type: "roll-mode",
        roll: "check",
        mode: "disadvantage",
        when: [{ type: "on-ability-check" }, { type: "skill-is", skills: ["perception"] }]
      }
    ]
  }),
  // "Up to eight Medium or smaller creatures" climb into the extradimensional space at the rope's top for the hour:
  // "Attacks, spells, and other effects can't pass into or out of the space ... Anything inside the space drops out when
  // the spell ends" (`off-plane.ts`, back to the space each left).
  "rope-trick": spellGrant({
    name: "Inside the Rope Trick",
    tags: ["off-plane", "rope-trick"],
    target: "targets",
    duration: { type: "minutes", minutes: 60 }
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
    modifiers: [{ type: "special-speed", movement: "swim", equalToSpeed: true }],
    // "Spells and other magical effects can neither reduce its Speed nor cause it to have the Paralyzed or Restrained
    // conditions"; a nonmagical restraint it escapes for 5 feet of movement, so it is kept off whatever its source.
    conditionImmunities: ["paralyzed", "restrained"]
  }),
  // "Until the spell ends, the target can take a Magic action to exhale", the type chosen at the cast: the touched
  // creature's own action, at the caster's numbers.
  "dragons-breath": spellGrant({
    name: "Dragon's Breath",
    tags: ["dragons-breath"],
    target: "target",
    duration: rounds(10),
    grantsLaterAction: "exhale"
  }),
  // "Choose a skill. Until the spell ends, the creature adds 1d4 to any ability check using the chosen skill."
  guidance: spellGrant({
    name: "Guidance",
    tags: ["guidance"],
    target: "target",
    duration: rounds(10),
    options: SKILLS.map(([skill, name]) =>
      option(skill, name, {
        modifiers: [
          {
            type: "check-bonus",
            amount: 0,
            dice: "1d4",
            when: [{ type: "on-ability-check" }, { type: "skill-is", skills: [skill] }]
          }
        ]
      })
    )
  }),
  // "Choose a damage type ... the creature reduces the total damage taken by 1d4. A creature can benefit from this
  // spell only once per turn."
  resistance: spellGrant({
    name: "Resistance",
    tags: ["resistance"],
    target: "target",
    duration: rounds(10),
    options: RESISTANCE_TYPES.map((type) =>
      option(type, titled(type), {
        modifiers: [
          {
            type: "damage-reduction",
            amount: 0,
            dice: "1d4",
            oncePerTurn: true,
            when: [{ type: "on-taking-damage" }, { type: "damage-type-is", damageTypes: [type] }]
          }
        ]
      })
    )
  }),
  // "When you make a Charisma check, you can replace the number you roll with a 15." The lie-detecting magic is the
  // GM's.
  glibness: spellGrant({
    name: "Glibness",
    tags: ["glibness"],
    target: "self",
    duration: { type: "manual" },
    modifiers: [
      {
        type: "d20-minimum",
        roll: "check",
        minimum: 15,
        when: [{ type: "on-ability-check" }, { type: "ability-is", abilities: ["cha"] }]
      }
    ]
  }),
  // "Immunity to Psychic damage and the Charmed condition." What it hides from divination is the GM's.
  "mind-blank": spellGrant({
    name: "Mind Blank",
    tags: ["mind-blank"],
    target: "target",
    duration: { type: "manual" },
    modifiers: [
      { type: "damage-immunity", damageTypes: ["psychic"] },
      { type: "spell-ward", schools: ["divination"] }
    ],
    conditionImmunities: ["charmed"]
  }),
  // "The target gains an Intelligence of 10", for good; its Charmed for 30 days is the cast's `inflicts`. The language
  // it learns and a natural plant's statistics are the GM's.
  awaken: spellGrant({
    name: "Awakened",
    tags: ["awakened"],
    target: "target",
    duration: { type: "manual" },
    modifiers: [{ type: "ability-score-minimum", ability: "int", score: 10 }]
  }),
  // "You hide a target that you touch from Divination spells ... The target can't be targeted by any Divination
  // spell." A place or an object, and scrying sensors, are the GM's.
  nondetection: spellGrant({
    name: "Nondetection",
    tags: ["nondetection"],
    target: "target",
    duration: { type: "manual" },
    modifiers: [{ type: "spell-ward", schools: ["divination"] }]
  }),
  // Mask: "Choose a creature type other than the target's actual type. Spells and other magical effects treat the
  // target as if it were a creature of the chosen type." The pick is the effect's tag, which creatureTypeOf reads.
  "arcanists-magic-aura": spellGrant({
    name: "Arcanist's Magic Aura",
    tags: ["arcanists-magic-aura"],
    target: "target",
    duration: { type: "manual" },
    options: CREATURE_TYPES.map((type) =>
      option(type, `Mask: ${type[0]!.toUpperCase()}${type.slice(1)}`, { tags: [`${MASKED_TYPE_TAG}${type}`] })
    )
  }),
  // "Resistance to Poison damage ... Immunity to the Frightened and Poisoned conditions. Its Hit Point maximum also
  // increases by 2d10, and it gains the same number of Hit Points", rolled for each, for 24 hours.
  "heroes-feast": spellGrant({
    name: "Heroes' Feast",
    tags: ["heroes-feast"],
    target: "targets",
    duration: { type: "minutes", minutes: 1440 },
    modifiers: [{ type: "damage-resistance", damageTypes: ["poison"] }],
    conditionImmunities: ["frightened", "poisoned"],
    hitPointMaximumGain: { amount: 0, formula: "2d10" }
  }),
  // "For the duration, the target regains 1 Hit Point at the start of each of its turns."
  regenerate: spellGrant({
    name: "Regenerate",
    tags: ["regenerate"],
    target: "target",
    duration: { type: "manual" },
    hitPointsEachTurn: 1
  }),
  // "Advantage on Wisdom saving throws and Death Saving Throws and regains the maximum number of Hit Points possible
  // from any healing."
  "beacon-of-hope": spellGrant({
    name: "Beacon of Hope",
    tags: ["beacon-of-hope"],
    target: "targets",
    duration: rounds(10),
    modifiers: [
      onAbility("save", "advantage", "wis"),
      { type: "roll-mode", roll: "death-save", mode: "advantage" },
      { type: "healing-received-maximized" }
    ]
  }),
  // "Creatures of those types have Disadvantage on attack rolls against the target. The target also can't be possessed
  // by or gain the Charmed or Frightened conditions from them."
  "protection-from-evil-and-good": spellGrant({
    name: "Protection from Evil and Good",
    tags: ["protection-from-evil-and-good"],
    target: "target",
    duration: rounds(100),
    modifiers: [attackedWithDisadvantageBy(OTHERWORLDLY)],
    conditionWards: { conditionIds: ["charmed", "frightened"], creatureTypes: [...OTHERWORLDLY] }
  }),
  // "Celestials, Elementals, Fey, Fiends, and Undead have Disadvantage on attack rolls against you."
  "dispel-evil-and-good": spellGrant({
    name: "Dispel Evil and Good",
    tags: ["dispel-evil-and-good"],
    target: "self",
    duration: rounds(10),
    modifiers: [attackedWithDisadvantageBy(OTHERWORLDLY.filter((type) => type !== "aberration"))]
  }),
  // "The warm shield grants you Resistance to Cold damage, and the chill shield grants you Resistance to Fire damage",
  // and a creature within 5 feet that hits you with a melee attack roll takes 2d8 Fire or Cold.
  "fire-shield": spellGrant({
    name: "Fire Shield",
    tags: ["fire-shield"],
    target: "self",
    duration: { type: "manual" },
    struck: { withinFeet: 5, damage: [{ formula: "2d8", type: "fire" }] },
    options: [
      option("warm", "Warm Shield", {
        modifiers: [{ type: "damage-resistance", damageTypes: ["cold"] }],
        damageType: "fire"
      }),
      option("chill", "Chill Shield", {
        modifiers: [{ type: "damage-resistance", damageTypes: ["fire"] }],
        damageType: "cold"
      })
    ]
  }),
  // "That weapon becomes a magic weapon with a +1 bonus to attack rolls and damage rolls", +2 from a level 3 slot and
  // +3 from a level 6 slot. One of the caster's own weapons.
  "magic-weapon": spellGrant({
    name: "Magic Weapon",
    tags: ["magic-weapon"],
    target: "self",
    duration: { type: "manual" },
    bindsWeapon: {
      nonmagical: true,
      bonusBySlot: [
        { level: 2, bonus: 1 },
        { level: 3, bonus: 2 },
        { level: 6, bonus: 3 }
      ]
    }
  }),
  // "You can use your spellcasting ability instead of Strength for the attack and damage rolls of melee attacks using
  // that weapon, and the weapon's damage die becomes a d8 ... it can be Force damage", d10 at level 5, d12 at 11, 2d6
  // at 17.
  shillelagh: spellGrant({
    name: "Shillelagh",
    tags: ["shillelagh"],
    target: "self",
    duration: rounds(10),
    bindsWeapon: {
      weaponIds: ["club", "quarterstaff"],
      ability: "spellcasting",
      dice: [
        { level: 1, formula: "1d8" },
        { level: 5, formula: "1d10" },
        { level: 11, formula: "1d12" },
        { level: 17, formula: "2d6" }
      ],
      damageTypes: ["force"]
    }
  }),
  // "You take the Dash action, and until the spell ends, you can take that action again as a Bonus Action."
  "expeditious-retreat": spellGrant({
    name: "Expeditious Retreat",
    tags: ["expeditious-retreat"],
    target: "self",
    duration: rounds(100),
    dashesNow: true,
    bonusActions: ["dash"]
  }),
  // "You can take the Disengage action as a Bonus Action" while the spell lasts.
  "conjure-woodland-beings": spellGrant({
    name: "Conjure Woodland Beings",
    tags: ["conjure-woodland-beings"],
    target: "self",
    duration: rounds(100),
    bonusActions: ["disengage"]
  }),
  // "Any attack you make deals an extra 2d8 damage when you hit a creature within 15 feet of yourself. This damage is
  // Acid, Cold, Fire, or Lightning", picked at the cast.
  "conjure-minor-elementals": spellGrant({
    name: "Conjure Minor Elementals",
    tags: ["conjure-minor-elementals"],
    target: "self",
    duration: rounds(100),
    options: (["acid", "cold", "fire", "lightning"] as const).map((type) =>
      option(type, titled(type), {
        modifiers: [
          {
            type: "extra-damage",
            formula: "2d8",
            damageType: type,
            doubleOnCritical: true,
            when: [{ type: "on-hit" }, { type: "versus-within", feet: 15 }]
          }
        ]
      })
    )
  }),
  // Aquatic Adaptation's Swim Speed, or a natural weapon for the Unarmed Strike: 1d6 with the spellcasting ability.
  "alter-self": spellGrant({
    name: "Alter Self",
    tags: ["alter-self"],
    target: "self",
    duration: { type: "manual" },
    options: [
      option("aquatic-adaptation", "Aquatic Adaptation", {
        modifiers: [{ type: "special-speed", movement: "swim", equalToSpeed: true }]
      }),
      option("change-appearance", "Change Appearance"),
      naturalWeapon("claws", "Claws", "slashing"),
      naturalWeapon("fangs", "Fangs", "piercing"),
      naturalWeapon("horns", "Horns", "piercing"),
      naturalWeapon("hooves", "Hooves", "bludgeoning")
    ]
  }),
  // "Until the spell ends, the target has a +1 bonus to AC and saving throws, and it has Resistance to all damage."
  // The caster's share of its damage is the GM's.
  "warding-bond": spellGrant({
    name: "Warding Bond",
    tags: ["warding-bond"],
    target: "target",
    duration: { type: "manual" },
    armorClassBonus: 1,
    modifiers: [
      { type: "save-bonus", amount: 1, when: [{ type: "on-saving-throw" }] },
      {
        type: "damage-resistance",
        damageTypes: [...DamageTypeSchema.options]
      }
    ]
  }),
  // "You gain the Invisible condition ... the invisibility ends immediately after you make an attack roll, deal damage,
  // or cast a spell", while the double lasts.
  mislead: spellGrant({
    name: "Mislead",
    tags: ["mislead", "invisible-until-it-acts"],
    target: "self",
    duration: { type: "manual" },
    conditions: ["invisible"]
  }),
  // "The target has the Invisible condition ... it has the Unconscious condition ... This spell also ends if the target
  // takes any damage." The end the caster sets is the GM's.
  sequester: spellGrant({
    name: "Sequester",
    tags: ["sequester"],
    target: "target",
    duration: { type: "manual" },
    conditions: ["invisible", "unconscious"],
    endsOnDamage: true
  }),
  // Booming Voice: "Advantage on Charisma (Intimidation) checks". The other wonders are the GM's.
  thaumaturgy: spellGrant({
    name: "Thaumaturgy",
    tags: ["thaumaturgy"],
    target: "self",
    duration: rounds(10),
    options: [
      option("altered-eyes", "Altered Eyes"),
      option("booming-voice", "Booming Voice", {
        modifiers: [
          {
            type: "roll-mode",
            roll: "check",
            mode: "advantage",
            when: [{ type: "on-ability-check" }, { type: "skill-is", skills: ["intimidation"] }]
          }
        ]
      }),
      option("fire-play", "Fire Play"),
      option("invisible-hand", "Invisible Hand"),
      option("phantom-sound", "Phantom Sound"),
      option("tremors", "Tremors")
    ]
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
  // left or in the nearest unoccupied space": it leaves the map until the effect ends (`off-plane.ts`). An Aberration,
  // a Celestial, an Elemental, a Fey or a Fiend gone the full minute doesn't come back (`banished-home`).
  banishment: { name: "Banished", tags: ["off-plane", "banished-home"], modifiers: [] },
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
  // "Become cursed for the duration" with the curse the caster picks, which Remove Curse ends: Disadvantage on one
  // ability's checks and saves, Disadvantage on attack rolls against the caster, the Wisdom save each turn (the GM's to
  // ask), or an extra 1d8 Necrotic when the caster's attack hits it.
  "bestow-curse": {
    name: "Bestow Curse",
    tags: ["curse"],
    modifiers: [],
    options: [
      ...ABILITIES.map(([ability, name]) =>
        option(ability, `${name} curse`, {
          modifiers: [onAbility("check", "disadvantage", ability), onAbility("save", "disadvantage", ability)]
        })
      ),
      option("against-you", "Attacks against you", {
        modifiers: [
          {
            type: "roll-mode",
            roll: "attack",
            mode: "disadvantage",
            when: [{ type: "on-attack-roll" }, { type: "versus-effect-source" }]
          }
        ]
      }),
      option("dodge", "Forced to Dodge", { tags: ["curse-dodge"] }),
      option("necrotic", "Extra Necrotic damage", {
        modifiers: [
          {
            type: "extra-damage",
            formula: "1d8",
            damageType: "necrotic",
            doubleOnCritical: true,
            when: [{ type: "on-hit" }, { type: "by-effect-source" }]
          }
        ]
      })
    ]
  },
  // Picked for each creature: immune to Charmed and Frightened, one it has held off; or Indifferent (the GM's).
  "calm-emotions": {
    name: "Calm Emotions",
    tags: ["calm-emotions"],
    modifiers: [],
    optionsPerTarget: true,
    options: [
      option("calm", "Calmed", {
        conditionImmunities: ["charmed", "frightened"],
        suppressesConditions: ["charmed", "frightened"]
      }),
      option("indifferent", "Indifferent", { tags: ["indifferent"] })
    ]
  },
  // "Follow the command on its next turn": Flee spends its turn on the Dash, Grovel is Prone and ends its turn, Halt
  // neither moves nor acts. Approach and Drop are the GM's to move and drop.
  command: {
    name: "Command",
    tags: ["commanded"],
    duration: { type: "until-bearer-turn-end" },
    modifiers: [],
    options: [
      option("approach", "Approach"),
      option("drop", "Drop", { tags: ["no-actions"] }),
      option("flee", "Flee", { tags: ["dash-only"] }),
      option("grovel", "Grovel", { conditions: ["prone"], tags: ["no-actions"], speedZero: true }),
      option("halt", "Halt", { tags: ["no-actions"], speedZero: true })
    ]
  },
  // One of three for the duration: Asleep (Unconscious, waking on damage or a shake), Panicked (Frightened, and its
  // turns spent on the Dash), Sickened (Poisoned).
  eyebite: {
    name: "Eyebite",
    tags: ["eyebite"],
    modifiers: [],
    options: [
      option("asleep", "Asleep", { conditions: ["unconscious"], tags: ["wakeable"], endsOnDamage: true }),
      option("panicked", "Panicked", { conditions: ["frightened"], tags: ["dash-only"] }),
      option("sickened", "Sickened", { conditions: ["poisoned"] })
    ]
  },
  // "A -10 penalty to Wisdom (Perception) checks and Passive Perception until the spell ends."
  enthrall: {
    name: "Enthrall",
    tags: ["enthralled"],
    modifiers: [
      {
        type: "check-bonus",
        amount: -10,
        when: [{ type: "on-ability-check" }, { type: "skill-is", skills: ["perception"] }]
      }
    ]
  },
  // "Must use all its movement to dance in place, and has Disadvantage on Dexterity saving throws and attack rolls, and
  // other creatures have Advantage on attack rolls against it", ended by its own action and a Wisdom save.
  "irresistible-dance": {
    name: "Irresistible Dance",
    tags: ["dancing"],
    speedZero: true,
    modifiers: [
      { type: "roll-mode", roll: "attack", mode: "disadvantage" },
      onAbility("save", "disadvantage", "dex"),
      attackedWithAdvantage
    ],
    endAction: { activation: "action", kind: "save", ability: "wis", dc: "spellcasting", label: "Collect itself" }
  },
  // "You also always know the target's location ... if it has the Invisible condition, it gains no benefit from that
  // condition against you."
  "mind-spike": { name: "Mind Spike", tags: ["outlined-to-source"], modifiers: [] },
  // "Disadvantage on Strength-based D20 Tests for the duration. During that time, it also subtracts 1d8 from all its
  // damage rolls."
  "ray-of-enfeeblement": {
    name: "Ray of Enfeeblement",
    tags: ["enfeebled"],
    modifiers: [
      onAbility("attack", "disadvantage", "str"),
      onAbility("check", "disadvantage", "str"),
      onAbility("save", "disadvantage", "str"),
      { type: "damage-bonus", amount: 0, dice: "-1d8", leavesOne: true, when: [{ type: "on-damage-roll" }] }
    ]
  },
  // "Choose one ability ... While Poisoned, the target has Disadvantage on saving throws made with the chosen ability."
  contagion: {
    name: "Contagion",
    tags: ["contagion"],
    modifiers: [],
    options: ABILITIES.map(([ability, name]) =>
      option(ability, name, { modifiers: [onAbility("save", "disadvantage", ability)] })
    )
  },
  // "The target can't end the Prone condition on itself until the spell ends."
  "hideous-laughter": { name: "Hideous Laughter", tags: ["cant-stand"], modifiers: [] },
  // "The spell ends on a target if it takes damage or someone within 5 feet of it takes an action to shake it out of
  // the spell's effect" (Shake Awake).
  sleep: { name: "Sleep", tags: ["wakeable"], modifiers: [] },
  // "A Remove Curse, Greater Restoration, or Wish spell ends this spell."
  geas: { name: "Geas", tags: ["curse"], modifiers: [] },
  // "You create a phantasmal object, creature, or other phenomenon ... perceivable only to the target for the duration."
  "phantasmal-force": { name: "Phantasmal Force", tags: [], modifiers: [] },
  // "Each target ... drops whatever it is holding and has the Frightened condition for the duration."
  fear: { name: "Fear", tags: ["drops-held"], modifiers: [] },
  // "Can't take Bonus Actions or Reactions, and it rolls 1d10 at the start of each of its turns" (`random-outcomes.ts`).
  confusion: { name: "Confusion", tags: ["confused", "no-bonus-actions", "no-reactions"], modifiers: [] },
  // "Disadvantage on the next attack roll it makes before the end of its next turn": its own roll spends it.
  "vicious-mockery": {
    name: "Vicious Mockery",
    tags: ["until-own-attack"],
    duration: { type: "until-bearer-turn-end" },
    modifiers: [{ type: "roll-mode", roll: "attack", mode: "disadvantage" }]
  }
};

/** What a successful save against the cast still leaves on the creature (SRD 5.2.1 text). */
const SAVE_SUCCESS_EFFECTS: Readonly<Record<string, FailureEffect>> = {
  // "On a successful save, its Speed is 0 until the start of your next turn."
  "flesh-to-stone": {
    name: "Flesh to Stone",
    tags: [],
    speedZero: true,
    duration: { type: "until-source-next-turn" },
    modifiers: []
  },
  // "On a successful save, the target has Disadvantage on the next attack roll it makes until the start of your next
  // turn."
  "ray-of-enfeeblement": {
    name: "Ray of Enfeeblement",
    tags: ["until-own-attack"],
    duration: { type: "until-source-next-turn" },
    modifiers: [{ type: "roll-mode", roll: "attack", mode: "disadvantage" }]
  },
  // "The target dances comically until the end of its next turn, during which it must spend all its movement to dance
  // in place."
  "irresistible-dance": {
    name: "Irresistible Dance",
    tags: ["dancing"],
    duration: { type: "until-bearer-turn-end" },
    speedZero: true,
    modifiers: []
  }
};

type ShapeShift = NonNullable<SpellEffect["shapeShift"]>;
type PrintedForm = NonNullable<ShapeShift["printed"]>[number];

/**
 * The forms a cast shape-shifts creatures into (SRD 5.2.1 text): where they come from, what each creature keeps of its
 * own statistics, and what ends the form. Every one keeps its Hit Points and Hit Point Dice.
 */
/** Gaseous Form's misty cloud, which a Potion of Gaseous Form gives too. */
export const MISTY_CLOUD: PrintedForm = {
  id: "misty-cloud",
  name: "Misty cloud",
  speeds: { walk: 0, fly: 10, hover: true },
  noSpeech: true,
  noAttacks: true,
  sharesSpaces: true,
  conditionImmunities: ["prone"],
  modifiers: [
    { type: "damage-resistance", damageTypes: ["bludgeoning", "piercing", "slashing"] },
    ...(["str", "dex", "con"] as const).map((ability): Modifier => ({
      type: "roll-mode",
      roll: "save",
      mode: "advantage",
      when: [{ type: "on-saving-throw" }, { type: "ability-is", abilities: [ability] }]
    }))
  ]
};

const CAST_SHAPE_SHIFTS: Readonly<Record<string, ShapeShift>> = {
  // "Any Beast you choose that has a Challenge Rating equal to or less than the target's ... retains its alignment,
  // personality, creature type, Hit Points, and Hit Point Dice ... gains a number of Temporary Hit Points equal to the
  // Hit Points of the Beast form ... The spell ends early on the target if it has no Temporary Hit Points left ... it
  // can't speak or cast spells. The target's gear melds into the new form."
  polymorph: {
    from: "bestiary",
    creatureTypes: ["beast"],
    challengeOf: "target",
    keeps: ["type"],
    noSpells: true,
    noSpeech: true,
    gear: "merged",
    temporaryHitPoints: "each-form",
    endsWithoutTemporaryHitPoints: true
  },
  // Creature into Creature: "any kind you choose that has a Challenge Rating equal to or less than the target's ...
  // retains its Hit Points, Hit Point Dice, alignment, and personality ... Temporary Hit Points equal to the Hit Points
  // of the new form ... can't speak or cast spells. The target's gear melds".
  "true-polymorph": {
    from: "bestiary",
    challengeOf: "target",
    keeps: [],
    noSpells: true,
    noSpeech: true,
    gear: "merged",
    temporaryHitPoints: "each-form"
  },
  // "A Challenge Rating no higher than your level or Challenge Rating ... can't be a Construct or an Undead ... you
  // retain your creature type; alignment; personality; Intelligence, Wisdom, and Charisma scores; Hit Points; Hit Point
  // Dice; proficiencies; and ability to communicate. If you have the Spellcasting feature, you retain it too ... you
  // determine whether your equipment drops to the ground or changes in size and shape to fit the new form."
  shapechange: {
    from: "bestiary",
    notCreatureTypes: ["construct", "undead"],
    challengeOf: "user",
    keeps: ["mental", "proficiencies", "spellcasting", "type"],
    gear: "choice",
    temporaryHitPoints: "first-form"
  },
  // "Each target shape-shifts into a Large or smaller Beast of your choice that has a Challenge Rating of 4 or lower ...
  // retains its creature type; Hit Points; Hit Point Dice; alignment; ability to communicate; and Intelligence, Wisdom,
  // and Charisma scores ... can't cast spells. The target's equipment melds ... Temporary Hit Points equal to the Hit
  // Points of the first form ... until the target ends it as a Bonus Action."
  "animal-shapes": {
    from: "bestiary",
    onTargets: true,
    creatureTypes: ["beast"],
    maxChallenge: 4,
    maxSize: "large",
    keeps: ["mental", "type"],
    noSpells: true,
    gear: "merged",
    temporaryHitPoints: "first-form",
    leaveAs: "bonus-action"
  },
  // "A willing creature you touch shape-shifts ... into a misty cloud ... ends on the target if it drops to 0 Hit Points
  // or if it takes a Magic action to end the spell on itself ... only method of movement is a Fly Speed of 10 feet, and
  // it can hover ... can enter and occupy the space of another creature ... Resistance to Bludgeoning, Piercing, and
  // Slashing damage ... Immunity to the Prone condition ... Advantage on Strength, Dexterity, and Constitution saving
  // throws ... can't talk ... can't attack or cast spells." Narrow openings and liquids stay the GM's.
  "gaseous-form": {
    from: "printed",
    onTargets: true,
    printed: [MISTY_CLOUD],
    keeps: [],
    noSpells: true,
    gear: "worn",
    endsAtZeroHitPoints: true,
    leaveAs: "action"
  },
  // "You and up to ten willing creatures ... assume gaseous forms ... a Fly Speed of 300 feet and can hover ... Immunity
  // to the Prone condition ... Resistance to Bludgeoning, Piercing, and Slashing damage. The only actions a target can
  // take in this form are the Dash action or a Magic action to begin reverting ... Reverting takes 1 minute, during
  // which the target has the Stunned condition." Turning back into a cloud, and the descent when it ends, are the GM's.
  "wind-walk": {
    from: "printed",
    onTargets: true,
    printed: [
      {
        id: "cloud",
        name: "Cloud",
        speeds: { walk: 0, fly: 300, hover: true },
        noActions: true,
        allowsActions: ["dash"],
        conditionImmunities: ["prone"],
        modifiers: [{ type: "damage-resistance", damageTypes: ["bludgeoning", "piercing", "slashing"] }]
      }
    ],
    keeps: [],
    gear: "worn",
    leaveAs: "action",
    revertRounds: 10
  }
};

/** Strength checks and saves with Advantage (Enlarge) or Disadvantage (Reduce). */
const strengthRolls = (mode: "advantage" | "disadvantage"): Modifier[] => [
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

/** Effects a cast picks one of, each landing as a failed save's effect or on a willing creature (SRD 5.2.1 text). */
const CAST_EFFECT_OPTIONS: Readonly<Record<string, NonNullable<SpellEffect["effectOptions"]>>> = {
  // "Enlarge. The target's size increases by one category ... Advantage on Strength checks and Strength saving throws.
  // The target's attacks with its enlarged weapons or Unarmed Strikes deal an extra 1d4 damage on a hit." "Reduce. The
  // target's size decreases by one category ... Disadvantage on Strength checks and Strength saving throws ... 1d4 less
  // damage (this can't reduce the damage below 1)".
  enlargereduce: [
    {
      id: "enlarge",
      name: "Enlarge",
      effect: {
        name: "Enlarged",
        tags: ["enlarged"],
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
    },
    {
      id: "reduce",
      name: "Reduce",
      effect: {
        name: "Reduced",
        tags: ["reduced"],
        sizeChange: { step: -1 },
        modifiers: [...strengthRolls("disadvantage"), weaponDamageDie("-1d4", true)]
      }
    }
  ]
};

/** Spells whose save only an unwilling creature makes ("If the target is an unwilling creature, it can make a ...
 *  saving throw"): a creature on the caster's side takes the effect with no save. */
const UNWILLING_ONLY: ReadonlySet<string> = new Set(["enlargereduce", "true-polymorph", "levitate", "seeming"]);

/** What a cast does to its targets with no roll (SRD 5.2.1 text): Awaken's "The awakened target has the Charmed
 *  condition for 30 days or until you or your allies deal damage to it." */
const CAST_INFLICTS: Readonly<Record<string, NonNullable<SpellEffect["inflicts"]>>> = {
  awaken: { conditions: ["charmed"], duration: { type: "minutes", minutes: 43_200 }, endsOnSourceSideDamage: true }
};

/** The most its target may be (SRD 5.2.1 text): Animal Messenger's "A Tiny Beast". */
const TARGET_MAX_SIZE: Readonly<Record<string, NonNullable<SpellEffect["targetMaxSize"]>>> = {
  "animal-messenger": "tiny",
  // "The space can hold up to eight Medium or smaller creatures."
  "rope-trick": "medium"
};

/** The highest score its target may have: Awaken's "a Beast or Plant creature with an Intelligence of 3 or less". */
const TARGET_ABILITY_MAX: Readonly<Record<string, NonNullable<SpellEffect["targetAbilityMax"]>>> = {
  awaken: { ability: "int", score: 3 }
};

/** Spells whose target is the caster or a willing creature: Light and Continual Flame's object "that isn't being worn
 *  or carried by someone else" (the caster's own, or one a willing creature hands over), Nondetection's and
 *  Arcanist's Magic Aura's "willing creature". */
const WILLING_TARGETS: ReadonlySet<string> = new Set([
  "etherealness",
  "rope-trick",
  "light",
  "continual-flame",
  "nondetection",
  "arcanists-magic-aura"
]);

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
  // "Up to ten 10-foot Cubes, which you arrange as you like. Each Cube must be contiguous with at least one other Cube."
  "fire-storm": { shape: "cube", sizeFeet: 10, widthFeet: null, count: 10, contiguous: true },
  // "Four different points ... Each creature in a 40-foot-radius Sphere centered on each of those points."
  "meteor-swarm": { shape: "sphere", sizeFeet: 40, widthFeet: null, count: 4 },
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
  const successEffect = SAVE_SUCCESS_EFFECTS[id];
  const onHit = CAST_ON_HIT[id];
  const missDamage = CAST_MISS_DAMAGE[id];
  const drain = CAST_DRAINS[id];
  const cures = CAST_CURES[id];
  const burst = CAST_BURSTS[id];
  const teleport = CAST_TELEPORTS[id];
  const dispel = CAST_DISPELS[id];
  const selfSave = CAST_SELF_SAVES[id];
  const shapeShift = CAST_SHAPE_SHIFTS[id];
  const effectOptions = CAST_EFFECT_OPTIONS[id];
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
    ...(successEffect ? { successEffect: structuredClone(successEffect) } : {}),
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
    ...(shapeShift ? { shapeShift: structuredClone(shapeShift) } : {}),
    ...(effectOptions ? { effectOptions: structuredClone(effectOptions) } : {}),
    ...(UNWILLING_ONLY.has(id) ? { unwillingOnly: true as const } : {}),
    ...(CAST_INFLICTS[id] ? { inflicts: structuredClone(CAST_INFLICTS[id]) } : {}),
    ...(TARGET_MAX_SIZE[id] ? { targetMaxSize: TARGET_MAX_SIZE[id] } : {}),
    ...(TARGET_ABILITY_MAX[id] ? { targetAbilityMax: { ...TARGET_ABILITY_MAX[id] } } : {}),
    ...(WILLING_TARGETS.has(id) ? { willingTargets: true as const } : {}),
    ...(AREA_PER_SLOT[id] !== undefined ? { areaPerSlot: AREA_PER_SLOT[id] } : {}),
    ...(COMPANION_FEET[id] !== undefined ? { companionFeet: COMPANION_FEET[id] } : {}),
    ...(KINDLES[id] ? { kindles: { ...KINDLES[id] } } : {}),
    // The creatures it brings and the commands it gives (`spell-summons.ts`).
    ...spellSummonFieldsFor(id)
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
  ...Object.keys(SAVE_SUCCESS_EFFECTS),
  ...Object.keys(SPELL_AREAS),
  ...Object.keys(CAST_DISPELS),
  ...Object.keys(CAST_SELF_SAVES),
  ...CAST_ENDS_CURSES,
  ...PERSISTS_WITHOUT_TARGETS,
  ...SEEN_TARGETS,
  ...Object.keys(TARGET_TYPES),
  ...UNWILLING_ONLY,
  ...Object.keys(TARGET_MAX_SIZE),
  ...Object.keys(CAST_INFLICTS),
  ...Object.keys(TARGET_ABILITY_MAX),
  ...WILLING_TARGETS,
  ...STABILIZES,
  ...RANGE_DOUBLES,
  ...SILENCES_AREA,
  ...PICKS_IN_AREA,
  ...Object.keys(CHAIN_FEET),
  ...Object.keys(AREA_PER_SLOT),
  ...SPELL_SUMMON_REVIEWED_IDS
];
