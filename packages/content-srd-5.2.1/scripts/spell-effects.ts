/**
 * Each SRD spell's cast model (`SpellReference.effect`), read once at build time. The source's `damage` and
 * `attackRoll` columns describe the prose, so they are corrected here: damage that does not land on the cast's
 * targets is left out, a cast's several damage types each get their own dice, and an attack is a spell attack
 * the caster makes ("Make a ranged spell attack"), never one the text only mentions. `test/spell-effects.test.ts`
 * pins the cases.
 */
import { DamageTypeSchema } from "@vtt/schemas";
import type { SpellEffect, SpellReference } from "../src/schemas.js";
import { healingOfText, spellAttackRangeOf, type SpellRange } from "../src/spell-effect.js";

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

/** Missiles one cast makes, each striking a creature of the caster's choice. */
const CAST_DARTS: Readonly<Record<string, number>> = { "magic-missile": 3 };

/** Where a cast's spell attack reaches, where the spell's own range doesn't say it: the hurled flame of a Self spell. */
const ATTACK_RANGES: Readonly<Record<string, NonNullable<SpellEffect["attackRange"]>>> = {
  "produce-flame": { kind: "ranged", feet: 60 }
};

/** Reaction spells the table offers as prompts: what triggers each and what casting it does. Counterspell and Feather
 *  Fall answer triggers the engine doesn't see (a spell being cast, a fall), so they stay with the GM. */
const CAST_REACTIONS: Readonly<Record<string, NonNullable<SpellEffect["reaction"]>>> = {
  // +5 AC until the start of the caster's next turn, including against the triggering attack.
  shield: { trigger: "hit-by-attack", response: "ac-bonus", amount: 5, untilNextTurn: true },
  "hellish-rebuke": { trigger: "damaged-by-creature", response: "strike-back", rangeFeet: 60 }
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
  const attackRange = attacks > 0 ? (ATTACK_RANGES[id] ?? spellAttackRangeOf(description, range)) : null;
  const reaction = CAST_REACTIONS[id];
  const darts = CAST_DARTS[id];
  return {
    attacks,
    ...(attackRange ? { attackRange } : {}),
    damage: castDamage(id, roll, types, healing !== null),
    ...(darts ? { darts } : {}),
    healing,
    ...(reaction ? { reaction } : {})
  };
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
  ...Object.keys(ATTACK_RANGES),
  ...Object.keys(CAST_DARTS),
  ...Object.keys(UPCAST_CORRECTIONS),
  ...Object.keys(CAST_REACTIONS)
];
