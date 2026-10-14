// Built-in progression data for the twelve SRD 5.2.1 classes (hit die, stat priority, ASI levels, casting,
// multiclass prerequisites). Every accessor takes the table as its last argument so homebrew classes supply
// the same record; content bundles carry the authored copy and this table is the fallback.
import type { Ability } from "./character.js";
import { ABILITIES } from "./ability-scores.js";

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
 * instead (`EPIC_BOON_LEVEL`), modelled as an ordinary feature with a `feat` choice. */
const ASI_STANDARD: readonly number[] = [4, 8, 12, 16];
const ASI_FIGHTER: readonly number[] = [4, 6, 8, 12, 14, 16];
const ASI_ROGUE: readonly number[] = [4, 8, 10, 12, 16];
export const EPIC_BOON_LEVEL = 19;

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

/** Every class id the built-in table knows, in a stable order. */
export const SRD_CLASS_IDS: readonly string[] = Object.freeze(Object.keys(SRD_CLASS_PROGRESSION).sort());

export type ClassProgressionTable = Readonly<Record<string, ClassProgression>>;

/** The progression row for a class id, or undefined when the caller must fall back to bundle data. */
export function classProgression(
  classId: string,
  table: ClassProgressionTable = SRD_CLASS_PROGRESSION
): ClassProgression | undefined {
  return table[classId];
}

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

/** True when `level` is one of this class's ASI levels. */
export function isAsiLevel(
  classId: string,
  level: number,
  table: ClassProgressionTable = SRD_CLASS_PROGRESSION
): boolean {
  return asiLevelsFor(classId, table).includes(level);
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
