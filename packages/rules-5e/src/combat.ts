/**
 * Pure 5e combat math (ADR-0019): typed damage against defenses, advantage aggregation, and the
 * death-save state machine. No game-state knowledge - the server passes plain values in and applies
 * the returned transitions, so every rule here is unit-testable against the SRD text it implements.
 */

export type DamagePart = Readonly<{ amount: number; type: string }>;
export type DamageDefenses = Readonly<{
  resistances: readonly string[];
  immunities: readonly string[];
  vulnerabilities: readonly string[];
  /** Resistance to every damage type (SRD Petrified). Immunities still zero; a same-type vulnerability still cancels. */
  resistAll?: boolean;
}>;
export type AdjustedDamagePart = Readonly<{
  type: string;
  amount: number;
  adjusted: number;
  adjustment: "resistance" | "immunity" | "vulnerability" | null;
}>;

const normalizeType = (type: string) => type.trim().toLowerCase();

/**
 * SRD order per part: immunity zeroes, resistance halves rounding down, vulnerability doubles.
 * Immunity wins outright; resistance and vulnerability on the same type cancel (SRD 5.2.1: they
 * don't stack - a creature with both takes normal damage).
 */
export function adjustDamageParts(parts: readonly DamagePart[], defenses: DamageDefenses): AdjustedDamagePart[] {
  const resistances = new Set(defenses.resistances.map(normalizeType));
  const immunities = new Set(defenses.immunities.map(normalizeType));
  const vulnerabilities = new Set(defenses.vulnerabilities.map(normalizeType));
  return parts.map((part) => {
    const type = normalizeType(part.type);
    if (immunities.has(type)) return { type: part.type, amount: part.amount, adjusted: 0, adjustment: "immunity" as const };
    const resistant = resistances.has(type) || defenses.resistAll === true;
    const vulnerable = vulnerabilities.has(type);
    if (resistant && !vulnerable) return { type: part.type, amount: part.amount, adjusted: Math.floor(part.amount / 2), adjustment: "resistance" as const };
    if (vulnerable && !resistant) return { type: part.type, amount: part.amount, adjusted: part.amount * 2, adjustment: "vulnerability" as const };
    return { type: part.type, amount: part.amount, adjusted: part.amount, adjustment: null };
  });
}

export type RollModeSource = Readonly<{ source: string; label: string }>;
export type AggregatedRollMode = Readonly<{
  mode: "advantage" | "disadvantage" | "normal";
  advantage: readonly string[];
  disadvantage: readonly string[];
}>;

/** 5e aggregation: any advantage + any disadvantage cancel to normal, regardless of how many sources each side has. */
export function aggregateRollMode(advantage: readonly RollModeSource[], disadvantage: readonly RollModeSource[]): AggregatedRollMode {
  const mode = advantage.length > 0 && disadvantage.length > 0 ? "normal" : advantage.length > 0 ? "advantage" : disadvantage.length > 0 ? "disadvantage" : "normal";
  return { mode, advantage: advantage.map((entry) => entry.label), disadvantage: disadvantage.map((entry) => entry.label) };
}

export type DeathSaveState = Readonly<{ successes: number; failures: number; stable: boolean }>;
export type DeathSaveRoll = Readonly<{
  state: DeathSaveState;
  outcome: "success" | "failure" | "critical-success" | "critical-failure";
  /** Natural 20: the character regains 1 hit point and consciousness - the caller applies the heal. */
  regainsOneHitPoint: boolean;
  dead: boolean;
}>;

/** One death saving throw (SRD 5.2.1): 20 → regain 1 HP; 1 → two failures; 10+ → success (3 → stable); else failure (3 → dead). */
export function resolveDeathSave(current: DeathSaveState, naturalRoll: number): DeathSaveRoll {
  if (naturalRoll === 20) {
    return { state: { successes: 0, failures: 0, stable: false }, outcome: "critical-success", regainsOneHitPoint: true, dead: false };
  }
  if (naturalRoll === 1) {
    const failures = Math.min(3, current.failures + 2);
    return { state: { ...current, failures }, outcome: "critical-failure", regainsOneHitPoint: false, dead: failures >= 3 };
  }
  if (naturalRoll >= 10) {
    const successes = Math.min(3, current.successes + 1);
    // Becoming stable resets both counters (SRD 5.2.1) - dying later starts from a clean slate.
    if (successes >= 3) return { state: { successes: 0, failures: 0, stable: true }, outcome: "success", regainsOneHitPoint: false, dead: false };
    return { state: { ...current, successes }, outcome: "success", regainsOneHitPoint: false, dead: false };
  }
  const failures = Math.min(3, current.failures + 1);
  return { state: { ...current, failures }, outcome: "failure", regainsOneHitPoint: false, dead: failures >= 3 };
}

/**
 * Damage taken while already at 0 HP: one automatic failure, two on a critical hit; instant death
 * when the damage equals or exceeds the hit point maximum. Losing stability resumes dying.
 */
export function damageWhileDying(current: DeathSaveState, damage: number, critical: boolean, hpMaximum: number): Readonly<{ state: DeathSaveState; failuresAdded: number; dead: boolean }> {
  // A stable character's counters were reset; damage breaks stability and dying resumes from zero.
  const base = current.stable ? { successes: 0, failures: 0 } : current;
  if (damage <= 0) return { state: current, failuresAdded: 0, dead: current.failures >= 3 };
  if (damage >= hpMaximum) return { state: { successes: base.successes, stable: false, failures: 3 }, failuresAdded: 3 - base.failures, dead: true };
  const failuresAdded = critical ? 2 : 1;
  const failures = Math.min(3, base.failures + failuresAdded);
  return { state: { successes: base.successes, failures, stable: false }, failuresAdded, dead: failures >= 3 };
}

/**
 * Damage that drops a creature from above 0 to 0: instant death when the REMAINING damage (beyond
 * what reduced it to 0) equals or exceeds the hit point maximum; otherwise the dying state begins.
 */
export function droppedToZero(overflowDamage: number, hpMaximum: number): Readonly<{ instantDeath: boolean; state: DeathSaveState }> {
  const instantDeath = overflowDamage >= hpMaximum;
  return { instantDeath, state: instantDeath ? { successes: 0, failures: 3, stable: false } : { successes: 0, failures: 0, stable: false } };
}
