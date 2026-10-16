/**
 * Each SRD spell's cast model (`SpellReference.effect`), read once at build time. The source's `damage` and
 * `attackRoll` columns describe the prose, so they are corrected here: damage that does not land on the cast's
 * targets is left out, a cast's several damage types each get their own dice, and an attack is a spell attack
 * the caster makes ("Make a ranged spell attack"), never one the text only mentions. `test/spell-effects.test.ts`
 * pins the cases.
 */
import { DamageTypeSchema, type DamageType } from "@vtt/schemas";
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
  "spirit-guardians": ["radiant", "necrotic"]
};

/** Spell attack rolls one cast makes, where the text's wording misleads the reader. */
const CAST_ATTACKS: Readonly<Record<string, number>> = {
  "scorching-ray": 3,
  // The summoned thing attacks when it appears ("you can immediately make one melee spell attack").
  "spiritual-weapon": 1,
  "arcane-sword": 1,
  "conjure-fey": 1,
  // These attack only on later turns (`LATER_ACTIONS`), not as the cast.
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
  "web"
]);

type Later = SpellLaterAction;
const melee = (feet: number) => ({ kind: "melee" as const, feet });
/** A save that halves the damage on a success and imposes no condition. */
const save = (ability: "str" | "dex" | "con" | "int" | "wis" | "cha") => ({
  ability,
  successDamage: "half" as const,
  failureConditions: []
});
const ONCE_PER_TURN = "A creature makes this save only once per turn.";

/**
 * What a spell lets its caster do after the cast (SRD 5.2.1 text): the attacks a summoned thing or a held flame
 * makes on later turns, and the saves an area forces when a creature enters it or ends its turn there. The engine
 * can't see those triggers, so the GM resolves the save against the creature; the cast reminds them.
 */
const LATER_ACTIONS: Readonly<Record<string, readonly Later[]>> = {
  "arcane-sword": [
    {
      name: "attack",
      activation: "bonus-action",
      when: "On your later turns, a Bonus Action moves the sword up to 30 feet and repeats the attack.",
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
      damage: [{ formula: "3d6", type: "bludgeoning" }]
    }
  ],
  "blade-barrier": [
    {
      name: "save",
      activation: "other",
      when: `A creature that enters the wall's space or ends its turn there makes the save. ${ONCE_PER_TURN}`,
      save: save("dex"),
      damage: [{ formula: "6d10", type: "force" }]
    }
  ],
  cloudkill: [
    {
      name: "save",
      activation: "other",
      when: `A creature the Sphere moves into, or that enters it or ends its turn there, makes the save. ${ONCE_PER_TURN}`,
      save: save("con"),
      damage: [{ formula: "5d8", type: "poison" }]
    }
  ],
  "conjure-animals": [
    {
      name: "save",
      activation: "other",
      when: `When the pack moves within 10 feet of a creature, or a creature enters a space within 10 feet of it or ends its turn there, you can force the save. ${ONCE_PER_TURN}`,
      save: { ability: "dex", successDamage: "none", failureConditions: [] },
      damage: [{ formula: "3d10", type: "slashing" }]
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
      attackRange: melee(65),
      damage: [{ formula: "3d12", type: "psychic", addsModifier: true }]
    }
  ],
  "conjure-woodland-beings": [
    {
      name: "save",
      activation: "other",
      when: `When the Emanation enters a creature's space, or a creature enters it or ends its turn there, you can force the save. ${ONCE_PER_TURN}`,
      save: save("wis"),
      damage: [{ formula: "5d8", type: "force" }]
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
      when: "A creature that ends its turn within 5 feet of the sphere, or whose space you ram it into as a Bonus Action, makes the save.",
      save: save("dex"),
      damage: [{ formula: "2d6", type: "fire" }]
    }
  ],
  "heat-metal": [
    {
      name: "heat again",
      activation: "bonus-action",
      when: "On your later turns, a Bonus Action deals the damage again if the object is within range; a creature holding or wearing it makes a Constitution save or drops it.",
      damage: [{ formula: "2d8", type: "fire" }]
    }
  ],
  "incendiary-cloud": [
    {
      name: "save",
      activation: "other",
      when: `A creature the Sphere moves into, or that enters it or ends its turn there, makes the save. ${ONCE_PER_TURN}`,
      save: save("dex"),
      damage: [{ formula: "10d8", type: "fire" }]
    }
  ],
  "insect-plague": [
    {
      name: "save",
      activation: "other",
      when: `A creature that enters the area for the first time on a turn or ends its turn there makes the save. ${ONCE_PER_TURN}`,
      save: save("con"),
      damage: [{ formula: "4d10", type: "piercing" }]
    }
  ],
  moonbeam: [
    {
      name: "save",
      activation: "other",
      when: `A creature the Cylinder moves into, or that enters it or ends its turn there, makes the save. ${ONCE_PER_TURN}`,
      save: save("con"),
      damage: [{ formula: "2d10", type: "radiant" }]
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
      damage: []
    }
  ],
  "spirit-guardians": [
    {
      name: "save",
      activation: "other",
      when: `When the Emanation enters a creature's space, or a creature enters it or ends its turn there, it makes the save. ${ONCE_PER_TURN}`,
      save: save("wis"),
      damage: [{ formula: "3d8", type: "radiant" }]
    }
  ],
  "spiritual-weapon": [
    {
      name: "attack",
      activation: "bonus-action",
      when: "On your later turns, a Bonus Action moves the force up to 20 feet and repeats the attack.",
      attackRange: melee(65),
      damage: [{ formula: "1d8", type: "force", addsModifier: true }]
    }
  ],
  "stinking-cloud": [
    {
      name: "save",
      activation: "other",
      when: "A creature that starts its turn in the Sphere makes the save; it is Poisoned until the end of that turn and can't take an action or a Bonus Action.",
      save: { ability: "con", successDamage: "none", failureConditions: ["poisoned"] },
      damage: []
    }
  ],
  "wall-of-fire": [
    {
      name: "burn",
      activation: "other",
      when: "A creature that ends its turn within 10 feet of the burning side or inside the wall, or enters the wall for the first time on a turn, takes the damage.",
      damage: [{ formula: "5d8", type: "fire" }]
    }
  ],
  "wall-of-thorns": [
    {
      name: "save",
      activation: "other",
      when: `A creature that enters a space in the wall for the first time on a turn or ends its turn there makes the save. ${ONCE_PER_TURN}`,
      save: save("dex"),
      damage: [{ formula: "7d8", type: "slashing" }]
    }
  ],
  web: [
    {
      name: "save",
      activation: "other",
      when: "The first time a creature enters the webs on a turn or starts its turn there, it makes the save; Restrained, it can try a Strength (Athletics) check against your spell save DC as an action.",
      save: { ability: "dex", successDamage: "none", failureConditions: ["restrained"] },
      damage: []
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

type Grant = NonNullable<SpellEffect["grant"]>;
type FailureEffect = NonNullable<SpellEffect["failureEffect"]>;
type Modifier = Grant["modifiers"][number];

const rounds = (count: number) => ({ type: "rounds" as const, rounds: count });
/** A grant with the defaults every spell's shares: no end trigger, no Concentration flag (the cast's Concentration is
 *  the caster's, not the effect's). */
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
  "mage-armor": spellGrant({
    name: "Mage Armor",
    tags: ["mage-armor"],
    target: "target",
    duration: { type: "manual" }
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
  // Outlined in light: attack rolls against it have Advantage, and it can't benefit from the Invisible condition.
  "faerie-fire": { name: "Faerie Fire", tags: ["outlined"], duration: rounds(10), modifiers: [attackedWithAdvantage] }
};

/** The cast model for one SRD spell from its text, its range and the source's damage columns. */
export function spellEffectFor(
  id: string,
  description: string,
  roll: string | null,
  types: readonly string[],
  range: SpellRange
): SpellEffect {
  const healing = healingOfText(description);
  const attacks = CAST_ATTACKS[id] ?? (/\bmakes? an? (?:ranged|melee) spell attack\b/i.test(description) ? 1 : 0);
  const attackRange = attacks > 0 ? spellAttackRangeOf(description, range) : null;
  const reaction = CAST_REACTIONS[id];
  const darts = CAST_DARTS[id];
  const choices = DAMAGE_CHOICES[id];
  const later = LATER_ACTIONS[id];
  const targets = CAST_TARGETS[id];
  const grant = CAST_GRANTS[id];
  const failureEffect = SAVE_FAILURE_EFFECTS[id];
  return {
    attacks,
    ...(attackRange ? { attackRange } : {}),
    damage: castDamage(id, roll, types, healing !== null),
    ...(choices ? { damageTypes: [...choices] } : {}),
    ...(NO_CAST_SAVE.has(id) ? { noCastSave: true as const } : {}),
    ...(later ? { laterActions: later.map((row) => ({ ...row, damage: [...row.damage] })) } : {}),
    ...(darts ? { darts } : {}),
    ...(targets ? { targets: { ...targets } } : {}),
    healing,
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
  ...Object.keys(SAVE_FAILURE_EFFECTS)
];
