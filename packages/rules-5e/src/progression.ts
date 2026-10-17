// Level progression math for the character builder: hit points, the multiclass hit-dice pool, and spell slots.
// Class knowledge comes from the overridable `class-data.ts` table so homebrew classes work.
import {
  casterProgressionFor,
  hitDieFor,
  type CasterProgression,
  type ClassProgressionTable,
  type HitDie,
  SRD_CLASS_PROGRESSION
} from "./class-data.js";

export function hitDieFaces(hitDie: HitDie): number {
  return Number(hitDie.slice(1));
}

/** SRD "average" hit points for a die: half, rounded up (d6 -> 4, d8 -> 5, d10 -> 6, d12 -> 7). */
export function hitDieAverage(hitDie: HitDie): number {
  return Math.floor(hitDieFaces(hitDie) / 2) + 1;
}

/** Level 1 always grants the maximum roll on the class's hit die, plus the Constitution modifier. */
export function hitPointsAtLevel1(hitDie: HitDie, conModifier: number): number {
  return Math.max(1, hitDieFaces(hitDie) + conModifier);
}

/**
 * How a level after the first earns hit points: `average` (the SRD fixed value), `roll` (the supplied roll), or
 * `max-of-both` (max(roll, average), so rolling can only help). A level always grants at least 1.
 */
export type HitPointMode = "average" | "roll" | "max-of-both";

export function hitPointsPerLevel(
  hitDie: HitDie,
  conModifier: number,
  mode: HitPointMode = "average",
  roll?: number
): number {
  const average = hitDieAverage(hitDie);
  if (mode === "average") return Math.max(1, average + conModifier);
  if (roll === undefined) throw new RangeError(`Hit-point mode "${mode}" needs a roll.`);
  const faces = hitDieFaces(hitDie);
  if (!Number.isInteger(roll) || roll < 1 || roll > faces)
    throw new RangeError(`A ${hitDie} roll must be 1-${faces}; got ${roll}.`);
  return Math.max(1, (mode === "roll" ? roll : Math.max(roll, average)) + conModifier);
}

/** One class entry on a (possibly multiclass) sheet, in the order the levels were taken. */
export type ClassLevelEntry = Readonly<{
  classId: string;
  level: number;
  hitDie?: HitDie;
  casterProgression?: CasterProgression;
}>;

/** The entry's explicit hit die first, then the class table's. */
export function entryHitDie(entry: ClassLevelEntry, table: ClassProgressionTable = SRD_CLASS_PROGRESSION): HitDie {
  return entry.hitDie ?? hitDieFor(entry.classId, table);
}

/** The hit-dice pool a multiclass sheet spends on Short Rests (Fighter 3 / Wizard 2 = 3d10 + 2d6), largest first. */
export function hitDicePool(
  classLevels: readonly ClassLevelEntry[],
  table: ClassProgressionTable = SRD_CLASS_PROGRESSION
): Array<{ die: HitDie; count: number }> {
  const counts = new Map<HitDie, number>();
  for (const entry of classLevels) {
    const die = entryHitDie(entry, table);
    counts.set(die, (counts.get(die) ?? 0) + Math.max(0, entry.level));
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .map(([die, count]) => ({ die, count }))
    .sort((left, right) => hitDieFaces(right.die) - hitDieFaces(left.die));
}

/** Maximum hit points for a whole build. The first entry is the starting class, so its level 1 takes the max
 * die. `rolls` are per-level rolls in order for "roll"/"max-of-both"; a missing roll uses the average. */
export function hitPointPool(
  classLevels: readonly ClassLevelEntry[],
  conModifier: number,
  mode: HitPointMode = "average",
  rolls: readonly number[] = [],
  table: ClassProgressionTable = SRD_CLASS_PROGRESSION
): number {
  let total = 0;
  let levelsSeen = 0;
  let rollIndex = 0;
  for (const entry of classLevels) {
    const die = entryHitDie(entry, table);
    for (let step = 0; step < Math.max(0, entry.level); step += 1) {
      if (levelsSeen === 0) {
        total += hitPointsAtLevel1(die, conModifier);
        levelsSeen += 1;
        continue;
      }
      const roll = mode === "average" ? undefined : rolls[rollIndex++];
      total +=
        roll === undefined
          ? hitPointsPerLevel(die, conModifier, "average")
          : hitPointsPerLevel(die, conModifier, mode, roll);
      levelsSeen += 1;
    }
  }
  return total;
}

/** SRD full-caster slot table: row = caster level - 1, column = spell level - 1. Half- and third-casters and
 * multiclass casters read it at a reduced row. */
export const FULL_CASTER_SLOTS: readonly (readonly number[])[] = Object.freeze(
  [
    [2, 0, 0, 0, 0, 0, 0, 0, 0],
    [3, 0, 0, 0, 0, 0, 0, 0, 0],
    [4, 2, 0, 0, 0, 0, 0, 0, 0],
    [4, 3, 0, 0, 0, 0, 0, 0, 0],
    [4, 3, 2, 0, 0, 0, 0, 0, 0],
    [4, 3, 3, 0, 0, 0, 0, 0, 0],
    [4, 3, 3, 1, 0, 0, 0, 0, 0],
    [4, 3, 3, 2, 0, 0, 0, 0, 0],
    [4, 3, 3, 3, 1, 0, 0, 0, 0],
    [4, 3, 3, 3, 2, 0, 0, 0, 0],
    [4, 3, 3, 3, 2, 1, 0, 0, 0],
    [4, 3, 3, 3, 2, 1, 0, 0, 0],
    [4, 3, 3, 3, 2, 1, 1, 0, 0],
    [4, 3, 3, 3, 2, 1, 1, 0, 0],
    [4, 3, 3, 3, 2, 1, 1, 1, 0],
    [4, 3, 3, 3, 2, 1, 1, 1, 0],
    [4, 3, 3, 3, 2, 1, 1, 1, 1],
    [4, 3, 3, 3, 3, 1, 1, 1, 1],
    [4, 3, 3, 3, 3, 2, 1, 1, 1],
    [4, 3, 3, 3, 3, 2, 2, 1, 1]
  ].map((row) => Object.freeze(row))
);

const NO_SLOTS: readonly number[] = Object.freeze([0, 0, 0, 0, 0, 0, 0, 0, 0]);

/** Warlock Pact Magic: one uniform slot level with its own count, refreshed on a Short Rest. */
export const PACT_SLOTS: readonly { level: number; slots: number }[] = Object.freeze(
  [
    { level: 1, slots: 1 },
    { level: 1, slots: 2 },
    { level: 2, slots: 2 },
    { level: 2, slots: 2 },
    { level: 3, slots: 2 },
    { level: 3, slots: 2 },
    { level: 4, slots: 2 },
    { level: 4, slots: 2 },
    { level: 5, slots: 2 },
    { level: 5, slots: 2 },
    { level: 5, slots: 3 },
    { level: 5, slots: 3 },
    { level: 5, slots: 3 },
    { level: 5, slots: 3 },
    { level: 5, slots: 3 },
    { level: 5, slots: 3 },
    { level: 5, slots: 4 },
    { level: 5, slots: 4 },
    { level: 5, slots: 4 },
    { level: 5, slots: 4 }
  ].map((row) => Object.freeze(row))
);

const clampLevel = (level: number) => Math.max(0, Math.min(20, Math.trunc(level)));

/** A full-caster row by caster level; level 0 (or below) means no slots at all. */
function fullCasterRow(casterLevel: number): readonly number[] {
  const clamped = clampLevel(casterLevel);
  return clamped < 1 ? NO_SLOTS : FULL_CASTER_SLOTS[clamped - 1];
}

/** Spell slots for a single-class caster (index 0 = level 1). Half-casters read the full table at ceil(level/2),
 * third-casters at ceil(level/3) from level 3, which reproduces the printed tables. Warlocks get zeros; see
 * `pactSlotsForLevel`. `progression` overrides the table for a homebrew class. */
export function spellSlotsForClass(
  classId: string,
  level: number,
  progression?: CasterProgression,
  table: ClassProgressionTable = SRD_CLASS_PROGRESSION
): readonly number[] {
  const resolved = progression ?? casterProgressionFor(classId, table);
  const clamped = clampLevel(level);
  if (resolved === "full") return fullCasterRow(clamped);
  if (resolved === "half") return fullCasterRow(Math.ceil(clamped / 2));
  if (resolved === "third") return clamped < 3 ? NO_SLOTS : fullCasterRow(Math.ceil(clamped / 3));
  return NO_SLOTS;
}

/** Warlock Pact Magic slots at `level`, or null when the class has no pact pool. */
export function pactSlotsForLevel(level: number): { level: number; slots: number } | null {
  const clamped = clampLevel(level);
  return clamped < 1 ? null : PACT_SLOTS[clamped - 1];
}

/** SRD 5.2.1 multiclass caster level: full casters count every level, Paladin/Ranger half rounded up (the SRD's
 * explicit exception), third-casters a third rounded down, Warlocks nothing (Pact Magic stays separate). */
export function multiclassCasterLevel(
  classLevels: readonly ClassLevelEntry[],
  table: ClassProgressionTable = SRD_CLASS_PROGRESSION
): number {
  return classLevels.reduce((total, entry) => {
    const progression = entry.casterProgression ?? casterProgressionFor(entry.classId, table);
    const level = Math.max(0, Math.trunc(entry.level));
    if (progression === "full") return total + level;
    if (progression === "half") return total + Math.ceil(level / 2);
    if (progression === "third") return total + Math.floor(level / 3);
    return total;
  }, 0);
}

/** The shared multiclass slot table, read at the combined caster level. */
export function multiclassSpellSlots(casterLevel: number): readonly number[] {
  return fullCasterRow(casterLevel);
}

/** Warlock pact slots on a multiclass sheet: driven only by the Warlock levels. */
export function multiclassPactSlots(
  classLevels: readonly ClassLevelEntry[],
  table: ClassProgressionTable = SRD_CLASS_PROGRESSION
): { level: number; slots: number } | null {
  const warlockLevels = classLevels.reduce((total, entry) => {
    const progression = entry.casterProgression ?? casterProgressionFor(entry.classId, table);
    return progression === "pact" ? total + Math.max(0, Math.trunc(entry.level)) : total;
  }, 0);
  return pactSlotsForLevel(warlockLevels);
}
