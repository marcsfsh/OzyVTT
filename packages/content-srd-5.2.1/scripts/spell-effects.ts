/**
 * Each SRD spell's cast model (`SpellReference.effect`), read once at build time. The source's `damage` and
 * `attackRoll` columns describe the prose, so they are corrected here: damage that does not land on the cast's
 * targets is left out, a cast's several damage types each get their own dice, and an attack is a spell attack
 * the caster makes ("Make a ranged spell attack"), never one the text only mentions. `test/spell-effects.test.ts`
 * pins the cases.
 */
import { DamageTypeSchema } from "@vtt/schemas";
import type { SpellEffect } from "../src/schemas.js";
import { healingOfText } from "../src/spell-effect.js";

/** Spells whose printed damage is not dealt by the cast to its targets, and why. They cast with no damage and the
 *  GM applies the rest from the text. */
const NO_CAST_DAMAGE: Readonly<Record<string, string>> = {
  "arcane-sword": "the sword attacks on later turns",
  "bestow-curse": "one curse option, on later hits",
  "black-tentacles": "the area harms on later turns",
  "blade-barrier": "a wall",
  cloudkill: "the area harms on later turns",
  "conjure-animals": "a summons",
  "conjure-fey": "a summons",
  "conjure-woodland-beings": "a summons",
  "contact-other-plane": "harms the caster on a failed save",
  "delayed-blast-fireball": "detonates later",
  "dimension-door": "harms the caster when the destination is occupied",
  "divine-favor": "a rider on later weapon hits",
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
  "heat-metal": "its save is to keep hold, not to avoid the damage",
  "heroes-feast": "no damage; the column is noise",
  hex: "a rider on later hits",
  "hunters-mark": "a rider on later hits",
  "incendiary-cloud": "the cloud harms on later turns",
  "insect-plague": "the swarm harms on later turns",
  "meld-into-stone": "harms the caster if the stone is destroyed",
  "phantasmal-force": "harms on later turns",
  "power-word-kill": "kills outright, or harms only above 100 Hit Points",
  "prismatic-spray": "a random ray per creature",
  "prismatic-wall": "a wall",
  "spike-growth": "harms creatures moving through the area",
  "spirit-guardians": "the emanation harms on later turns",
  "spiritual-weapon": "its damage adds the caster's modifier and recurs on later turns",
  "storm-of-vengeance": "harms on later rounds",
  tsunami: "a moving wall",
  "wall-of-fire": "a wall",
  "wall-of-ice": "a wall",
  "wall-of-thorns": "a wall",
  web: "harms only if the webs burn",
  "wind-wall": "a wall",
  wish: "harms the caster after a stressful wish"
};

type Damage = SpellEffect["damage"];

/** One cast's damage where the source's single roll and type list cannot say it. */
const CAST_DAMAGE: Readonly<Record<string, Damage>> = {
  // Three darts at one target, each 1d4 + 1.
  "magic-missile": [{ formula: "3d4 + 3", type: "force" }],
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
  "ice-knife": [{ formula: "1d10", type: "piercing" }]
};

/** Spell attack rolls one cast makes, where the text's wording misleads the reader. */
const CAST_ATTACKS: Readonly<Record<string, number>> = {
  "scorching-ray": 3,
  // These name a spell attack the summoned thing makes later, not the cast.
  "arcane-hand": 0,
  "arcane-sword": 0,
  "flame-blade": 0
};

/** The cast model for one SRD spell from its text and the source's damage columns. */
export function spellEffectFor(
  id: string,
  description: string,
  roll: string | null,
  types: readonly string[]
): SpellEffect {
  const healing = healingOfText(description);
  const attacks = CAST_ATTACKS[id] ?? (/\bmakes? an? (?:ranged|melee) spell attack\b/i.test(description) ? 1 : 0);
  return { attacks, damage: castDamage(id, roll, types, healing !== null), healing };
}

function castDamage(id: string, roll: string | null, types: readonly string[], heals: boolean): Damage {
  if (CAST_DAMAGE[id]) return CAST_DAMAGE[id];
  if (NO_CAST_DAMAGE[id] !== undefined || heals || !roll || types.length === 0) return [];
  if (types.length > 1) throw new Error(`${id}: ${types.length} damage types need a reviewed CAST_DAMAGE row.`);
  return [{ formula: roll, type: DamageTypeSchema.parse(types[0]) }];
}

/** The reviewed ids, so a test can check every row still names a real spell. */
export const SPELL_EFFECT_REVIEWED_IDS: readonly string[] = [
  ...Object.keys(NO_CAST_DAMAGE),
  ...Object.keys(CAST_DAMAGE),
  ...Object.keys(CAST_ATTACKS)
];
