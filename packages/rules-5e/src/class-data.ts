// Built-in progression data for the twelve SRD 5.2.1 classes (hit die, stat priority, ASI levels, casting,
// multiclass prerequisites). Every accessor takes the table as its last argument so homebrew classes supply
// the same record; content bundles carry the authored copy and this table is the fallback.
import type { Ability } from "./character.js";
import { ABILITIES, ABILITY_NAMES } from "./ability-scores.js";

export type HitDie = "d4" | "d6" | "d8" | "d10" | "d12";

/** How a class level counts toward the multiclass caster level (SRD Multiclassing): full = every level,
 * half = half rounded up (Paladin, Ranger), third = a third rounded down, pact = separate Pact Magic pool. */
export type CasterProgression = "full" | "half" | "third" | "pact" | "none";

/** SRD multiclass ability minimums: `any` for the Fighter's "Str 13 or Dex 13", `all` for the Monk's "Dex 13 and Wis 13". */
export type MulticlassRequirement = Readonly<{
  mode: "all" | "any";
  minimums: readonly (readonly [Ability, number])[];
}>;

export type ClassProgression = Readonly<{
  hitDie: HitDie;
  /** Ability order the random generator assigns scores in, highest first. */
  statPriority: readonly Ability[];
  /** The class's headline abilities (display and multiclass prerequisite text). */
  primaryAbilities: readonly Ability[];
  /** The two saving throws this class is proficient in at level 1. */
  savingThrows: readonly Ability[];
  /** Levels granting an Ability Score Improvement (or a feat instead). */
  asiLevels: readonly number[];
  /** Level the subclass is chosen at. */
  subclassLevel: number;
  casterProgression: CasterProgression;
  spellcastingAbility: Ability | null;
  multiclassPrerequisite: MulticlassRequirement;
}>;

/** SRD 5.2.1 ASI levels: 4/8/12/16, plus Fighter 6 and 14 and Rogue 10. Level 19 grants an Epic Boon feat
 * instead, modelled as an ordinary feature with a `feat` choice. */
const ASI_STANDARD: readonly number[] = [4, 8, 12, 16];
const ASI_FIGHTER: readonly number[] = [4, 6, 8, 12, 14, 16];
const ASI_ROGUE: readonly number[] = [4, 8, 10, 12, 16];

const requireAll = (...minimums: readonly (readonly [Ability, number])[]): MulticlassRequirement => ({
  mode: "all",
  minimums
});
const requireAny = (...minimums: readonly (readonly [Ability, number])[]): MulticlassRequirement => ({
  mode: "any",
  minimums
});

export const SRD_CLASS_PROGRESSION: Readonly<Record<string, ClassProgression>> = Object.freeze({
  barbarian: {
    hitDie: "d12",
    statPriority: ["str", "con", "dex", "wis", "cha", "int"],
    primaryAbilities: ["str"],
    savingThrows: ["str", "con"],
    asiLevels: ASI_STANDARD,
    subclassLevel: 3,
    casterProgression: "none",
    spellcastingAbility: null,
    multiclassPrerequisite: requireAll(["str", 13])
  },
  bard: {
    hitDie: "d8",
    statPriority: ["cha", "dex", "con", "wis", "int", "str"],
    primaryAbilities: ["cha"],
    savingThrows: ["dex", "cha"],
    asiLevels: ASI_STANDARD,
    subclassLevel: 3,
    casterProgression: "full",
    spellcastingAbility: "cha",
    multiclassPrerequisite: requireAll(["cha", 13])
  },
  cleric: {
    hitDie: "d8",
    statPriority: ["wis", "con", "str", "dex", "cha", "int"],
    primaryAbilities: ["wis"],
    savingThrows: ["wis", "cha"],
    asiLevels: ASI_STANDARD,
    subclassLevel: 3,
    casterProgression: "full",
    spellcastingAbility: "wis",
    multiclassPrerequisite: requireAll(["wis", 13])
  },
  druid: {
    hitDie: "d8",
    statPriority: ["wis", "con", "dex", "int", "cha", "str"],
    primaryAbilities: ["wis"],
    savingThrows: ["int", "wis"],
    asiLevels: ASI_STANDARD,
    subclassLevel: 3,
    casterProgression: "full",
    spellcastingAbility: "wis",
    multiclassPrerequisite: requireAll(["wis", 13])
  },
  fighter: {
    hitDie: "d10",
    statPriority: ["str", "con", "dex", "wis", "cha", "int"],
    primaryAbilities: ["str", "dex"],
    savingThrows: ["str", "con"],
    asiLevels: ASI_FIGHTER,
    subclassLevel: 3,
    casterProgression: "none",
    spellcastingAbility: null,
    multiclassPrerequisite: requireAny(["str", 13], ["dex", 13])
  },
  monk: {
    hitDie: "d8",
    statPriority: ["dex", "wis", "con", "str", "int", "cha"],
    primaryAbilities: ["dex", "wis"],
    savingThrows: ["str", "dex"],
    asiLevels: ASI_STANDARD,
    subclassLevel: 3,
    casterProgression: "none",
    spellcastingAbility: null,
    multiclassPrerequisite: requireAll(["dex", 13], ["wis", 13])
  },
  paladin: {
    hitDie: "d10",
    statPriority: ["str", "cha", "con", "dex", "wis", "int"],
    primaryAbilities: ["str", "cha"],
    savingThrows: ["wis", "cha"],
    asiLevels: ASI_STANDARD,
    subclassLevel: 3,
    casterProgression: "half",
    spellcastingAbility: "cha",
    multiclassPrerequisite: requireAll(["str", 13], ["cha", 13])
  },
  ranger: {
    hitDie: "d10",
    statPriority: ["dex", "wis", "con", "str", "int", "cha"],
    primaryAbilities: ["dex", "wis"],
    savingThrows: ["str", "dex"],
    asiLevels: ASI_STANDARD,
    subclassLevel: 3,
    casterProgression: "half",
    spellcastingAbility: "wis",
    multiclassPrerequisite: requireAll(["dex", 13], ["wis", 13])
  },
  rogue: {
    hitDie: "d8",
    statPriority: ["dex", "con", "wis", "int", "cha", "str"],
    primaryAbilities: ["dex"],
    savingThrows: ["dex", "int"],
    asiLevels: ASI_ROGUE,
    subclassLevel: 3,
    casterProgression: "none",
    spellcastingAbility: null,
    multiclassPrerequisite: requireAll(["dex", 13])
  },
  sorcerer: {
    hitDie: "d6",
    statPriority: ["cha", "con", "dex", "wis", "int", "str"],
    primaryAbilities: ["cha"],
    savingThrows: ["con", "cha"],
    asiLevels: ASI_STANDARD,
    subclassLevel: 3,
    casterProgression: "full",
    spellcastingAbility: "cha",
    multiclassPrerequisite: requireAll(["cha", 13])
  },
  warlock: {
    hitDie: "d8",
    statPriority: ["cha", "con", "dex", "wis", "int", "str"],
    primaryAbilities: ["cha"],
    savingThrows: ["wis", "cha"],
    asiLevels: ASI_STANDARD,
    subclassLevel: 3,
    casterProgression: "pact",
    spellcastingAbility: "cha",
    multiclassPrerequisite: requireAll(["cha", 13])
  },
  wizard: {
    hitDie: "d6",
    statPriority: ["int", "con", "dex", "wis", "cha", "str"],
    primaryAbilities: ["int"],
    savingThrows: ["int", "wis"],
    asiLevels: ASI_STANDARD,
    subclassLevel: 3,
    casterProgression: "full",
    spellcastingAbility: "int",
    multiclassPrerequisite: requireAll(["int", 13])
  }
});

export type ClassProgressionTable = Readonly<Record<string, ClassProgression>>;

/** Which abilities matter most to this class, best first; unknown classes fall back to sheet order. */
export function statPriorityFor(
  classId: string,
  table: ClassProgressionTable = SRD_CLASS_PROGRESSION
): readonly Ability[] {
  return table[classId]?.statPriority ?? ABILITIES;
}

/** Hit die for a class id; unknown classes fall back to d8, the SRD's most common die. */
export function hitDieFor(classId: string, table: ClassProgressionTable = SRD_CLASS_PROGRESSION): HitDie {
  return table[classId]?.hitDie ?? "d8";
}

/** Levels at which this class grants an Ability Score Improvement (or a feat instead). */
export function asiLevelsFor(classId: string, table: ClassProgressionTable = SRD_CLASS_PROGRESSION): readonly number[] {
  return table[classId]?.asiLevels ?? ASI_STANDARD;
}

/** How this class's levels count toward the shared multiclass caster level. */
export function casterProgressionFor(
  classId: string,
  table: ClassProgressionTable = SRD_CLASS_PROGRESSION
): CasterProgression {
  return table[classId]?.casterProgression ?? "none";
}

/** The class fields the progression adapter reads; a content `ClassReference` or homebrew record satisfies it. */
export type ClassProgressionSource = Readonly<{
  id: string;
  hitDie: HitDie;
  statPriority: readonly Ability[];
  primaryAbilities: readonly Ability[];
  savingThrows: readonly Ability[];
  asiLevels: readonly number[];
  subclassLevel: number;
  spellcasting?: Readonly<{ ability: Ability; multiclassProgression: "full" | "half" | "third" | "pact" }> | null;
  multiclassPrerequisites?: Readonly<{
    mode: "all" | "any";
    minimums: ReadonlyArray<Readonly<{ ability: Ability; minimum: number }>>;
  }> | null;
}>;

/** An authored class record as a progression row, so authored and homebrew classes use their own values
 * instead of SRD defaults. */
export function progressionFromClass(source: ClassProgressionSource): ClassProgression {
  return {
    hitDie: source.hitDie,
    statPriority: source.statPriority,
    primaryAbilities: source.primaryAbilities,
    savingThrows: source.savingThrows,
    asiLevels: source.asiLevels,
    subclassLevel: source.subclassLevel,
    casterProgression: source.spellcasting ? source.spellcasting.multiclassProgression : "none",
    spellcastingAbility: source.spellcasting ? source.spellcasting.ability : null,
    multiclassPrerequisite: {
      mode: source.multiclassPrerequisites?.mode ?? "all",
      minimums: (source.multiclassPrerequisites?.minimums ?? []).map((entry) => [entry.ability, entry.minimum] as const)
    }
  };
}

/** The progression table for authored classes, with the built-in SRD rows as fallback; authored classes win. */
export function progressionTableFromClasses(
  classes: readonly ClassProgressionSource[],
  fallback: ClassProgressionTable = SRD_CLASS_PROGRESSION
): ClassProgressionTable {
  const table: Record<string, ClassProgression> = { ...fallback };
  for (const source of classes) table[source.id] = progressionFromClass(source);
  return table;
}

/** A class's multiclass minimums as content records and the wire catalogs carry them. */
export type MulticlassMinimums = Readonly<{
  mode: "all" | "any";
  minimums: ReadonlyArray<Readonly<{ ability: Ability; minimum: number }>>;
}>;

/** A class as the multiclass check reads it: content records, catalog summaries and homebrew all fit. */
export type MulticlassCandidate = Readonly<{
  id: string;
  name: string;
  multiclassPrerequisites?: MulticlassMinimums | null;
}>;

/** Whether these scores meet one class's multiclass minimums; a class that declares none is open to anyone. */
export function meetsMulticlassMinimums(
  abilityScores: Readonly<Partial<Record<Ability, number>>>,
  minimums: MulticlassMinimums | null | undefined
): boolean {
  if (!minimums || minimums.minimums.length === 0) return true;
  const met = (entry: MulticlassMinimums["minimums"][number]) => (abilityScores[entry.ability] ?? 0) >= entry.minimum;
  return minimums.mode === "any" ? minimums.minimums.some(met) : minimums.minimums.every(met);
}

/**
 * The order the standard array is spent in: the starting class's stat priority (the abilities it leaves out follow
 * in sheet order), with a multiclass character's needs first, since every class wants 13 in its primary ability
 * (SRD Multiclassing). An "any" minimum (the Fighter's Strength or Dexterity) takes whichever ranks higher. The
 * random generator spends it this way, and the builder offers it as the suggested layout.
 */
export function standardArrayOrder(
  priority: readonly Ability[],
  classes: ReadonlyArray<Readonly<{ multiclassPrerequisites?: MulticlassMinimums | null }>>
): Ability[] {
  const ranked = [...priority, ...ABILITIES.filter((ability) => !priority.includes(ability))];
  const needed = new Set<Ability>();
  if (classes.length > 1) {
    const minimums = classes.flatMap((entry) => (entry.multiclassPrerequisites ? [entry.multiclassPrerequisites] : []));
    for (const minimum of minimums.filter((entry) => entry.mode === "all"))
      for (const entry of minimum.minimums) needed.add(entry.ability);
    for (const minimum of minimums.filter((entry) => entry.mode === "any")) {
      const abilities = minimum.minimums.map((entry) => entry.ability);
      if (!abilities.some((ability) => needed.has(ability)))
        needed.add([...abilities].sort((left, right) => ranked.indexOf(left) - ranked.indexOf(right))[0]);
    }
  }
  return [...ranked.filter((ability) => needed.has(ability)), ...ranked.filter((ability) => !needed.has(ability))];
}

/**
 * SRD Multiclassing: "To qualify for a new class, you must have a score of at least 13 in the primary ability of the
 * new class and your current classes." The classes whose minimums these scores miss, the new class first; empty
 * when the new class may be taken.
 */
export function multiclassShortfalls<New extends MulticlassCandidate, Current extends MulticlassCandidate>(
  abilityScores: Readonly<Partial<Record<Ability, number>>>,
  newClass: New,
  currentClasses: readonly Current[]
): Array<New | Current> {
  return [newClass, ...currentClasses.filter((entry) => entry.id !== newClass.id)].filter(
    (entry) => !meetsMulticlassMinimums(abilityScores, entry.multiclassPrerequisites)
  );
}

/**
 * Why a new class can't be taken, in sentences: "Wizard needs Intelligence 13; you have 10." for the new class, and
 * "Fighter, a class you already have, needs Strength 13 or Dexterity 13; you have Strength 10 and Dexterity 12."
 * for one already taken.
 */
export function multiclassShortfallText(
  abilityScores: Readonly<Partial<Record<Ability, number>>>,
  newClass: MulticlassCandidate,
  shortfalls: readonly MulticlassCandidate[]
): string {
  return shortfalls
    .map((entry) => {
      const minimums = entry.multiclassPrerequisites!;
      const wanted = minimums.minimums
        .map((minimum) => `${ABILITY_NAMES[minimum.ability]} ${minimum.minimum}`)
        .join(minimums.mode === "any" ? " or " : " and ");
      const score = (ability: Ability) => abilityScores[ability] ?? 0;
      const have =
        minimums.minimums.length === 1
          ? String(score(minimums.minimums[0].ability))
          : minimums.minimums
              .map((minimum) => `${ABILITY_NAMES[minimum.ability]} ${score(minimum.ability)}`)
              .join(" and ");
      const who = entry.id === newClass.id ? entry.name : `${entry.name}, a class you already have,`;
      return `${who} needs ${wanted}; you have ${have}.`;
    })
    .join(" ");
}

/** SRD multiclass prerequisites for taking a level in `classId`. A class with none declared is allowed. */
export function meetsMulticlassPrerequisites(
  abilityScores: Readonly<Partial<Record<Ability, number>>>,
  classId: string,
  table: ClassProgressionTable = SRD_CLASS_PROGRESSION
): boolean {
  const requirement = table[classId]?.multiclassPrerequisite;
  if (!requirement || requirement.minimums.length === 0) return true;
  const satisfied = (entry: readonly [Ability, number]) => (abilityScores[entry[0]] ?? 0) >= entry[1];
  return requirement.mode === "any" ? requirement.minimums.some(satisfied) : requirement.minimums.every(satisfied);
}
