// Pure 5e combat math (ADR-0020): typed damage against defenses, advantage aggregation and the death-save state
// machine. The server passes plain values in and applies the returned transitions.

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

/** The one damage-type normaliser; the engine matches types by it and the homebrew editor writes with it. Lives
 * here because the content package depends on this one (it re-exports it). */
export const normalizeDamageType = (type: string): string => type.trim().toLowerCase();

const normalizeType = normalizeDamageType;

/** SRD per part: immunity zeroes, resistance halves (round down), vulnerability doubles; resistance and
 * vulnerability on the same type cancel. */
export function adjustDamageParts(parts: readonly DamagePart[], defenses: DamageDefenses): AdjustedDamagePart[] {
  const resistances = new Set(defenses.resistances.map(normalizeType));
  const immunities = new Set(defenses.immunities.map(normalizeType));
  const vulnerabilities = new Set(defenses.vulnerabilities.map(normalizeType));
  return parts.map((part) => {
    const type = normalizeType(part.type);
    if (immunities.has(type))
      return { type: part.type, amount: part.amount, adjusted: 0, adjustment: "immunity" as const };
    const resistant = resistances.has(type) || defenses.resistAll === true;
    const vulnerable = vulnerabilities.has(type);
    if (resistant && !vulnerable)
      return {
        type: part.type,
        amount: part.amount,
        adjusted: Math.floor(part.amount / 2),
        adjustment: "resistance" as const
      };
    if (vulnerable && !resistant)
      return { type: part.type, amount: part.amount, adjusted: part.amount * 2, adjustment: "vulnerability" as const };
    return { type: part.type, amount: part.amount, adjusted: part.amount, adjustment: null };
  });
}

/** Flat reduction ("reduce the damage by 3", Heavy Armor Master): applied once to the total after per-type
 * adjustments, so resistance halves first. Floors at 0. */
export function reduceDamageTotal(total: number, reduction: number): number {
  return reduction <= 0 ? total : Math.max(0, total - reduction);
}

/** Re-weight a hand-entered total across the rolled damage types so an amended hit still runs the defence
 * pipeline. Each part floors to its share and the remainder goes to the largest, so the sum is exact. */
export function rescaleDamageParts(parts: readonly DamagePart[], total: number): DamagePart[] {
  const target = Math.max(0, Math.trunc(total));
  const rolled = parts.reduce((sum, part) => sum + part.amount, 0);
  if (parts.length === 0) return [];
  if (parts.length === 1 || rolled <= 0) return [{ type: parts[0].type, amount: target }];
  const scaled = parts.map((part) => ({ type: part.type, amount: Math.floor((part.amount * target) / rolled) }));
  const remainder = target - scaled.reduce((sum, part) => sum + part.amount, 0);
  let largest = 0;
  for (let index = 1; index < parts.length; index += 1)
    if (parts[index].amount > parts[largest].amount) largest = index;
  scaled[largest] = { type: scaled[largest].type, amount: scaled[largest].amount + remainder };
  return scaled;
}

export type RollModeSource = Readonly<{ source: string; label: string }>;
export type AggregatedRollMode = Readonly<{
  mode: "advantage" | "disadvantage" | "normal";
  advantage: readonly string[];
  disadvantage: readonly string[];
}>;

/** 5e aggregation: any advantage + any disadvantage cancel to normal, regardless of how many sources each side has. */
export function aggregateRollMode(
  advantage: readonly RollModeSource[],
  disadvantage: readonly RollModeSource[]
): AggregatedRollMode {
  const mode =
    advantage.length > 0 && disadvantage.length > 0
      ? "normal"
      : advantage.length > 0
        ? "advantage"
        : disadvantage.length > 0
          ? "disadvantage"
          : "normal";
  return {
    mode,
    advantage: advantage.map((entry) => entry.label),
    disadvantage: disadvantage.map((entry) => entry.label)
  };
}

export type DeathSaveState = Readonly<{ successes: number; failures: number; stable: boolean }>;
export type DeathSaveRoll = Readonly<{
  state: DeathSaveState;
  outcome: "success" | "failure" | "critical-success" | "critical-failure";
  /** Natural 20: the character regains 1 hit point and consciousness - the caller applies the heal. */
  regainsOneHitPoint: boolean;
  dead: boolean;
}>;

/** One death saving throw (SRD 5.2.1): 20 → regain 1 HP; 1 → two failures; 10+ → success (3 → stable); else failure (3 → dead).
 *  A death save is a saving throw, so its `total` carries Exhaustion and save bonuses; the natural die alone
 *  decides a 1 or a 20. */
export function resolveDeathSave(current: DeathSaveState, naturalRoll: number, total = naturalRoll): DeathSaveRoll {
  if (naturalRoll === 20) {
    return {
      state: { successes: 0, failures: 0, stable: false },
      outcome: "critical-success",
      regainsOneHitPoint: true,
      dead: false
    };
  }
  if (naturalRoll === 1) {
    const failures = Math.min(3, current.failures + 2);
    return {
      state: { ...current, failures },
      outcome: "critical-failure",
      regainsOneHitPoint: false,
      dead: failures >= 3
    };
  }
  if (total >= 10) {
    const successes = Math.min(3, current.successes + 1);
    // Becoming stable resets both counters (SRD 5.2.1).
    if (successes >= 3)
      return {
        state: { successes: 0, failures: 0, stable: true },
        outcome: "success",
        regainsOneHitPoint: false,
        dead: false
      };
    return { state: { ...current, successes }, outcome: "success", regainsOneHitPoint: false, dead: false };
  }
  const failures = Math.min(3, current.failures + 1);
  return { state: { ...current, failures }, outcome: "failure", regainsOneHitPoint: false, dead: failures >= 3 };
}

/**
 * Damage taken while already at 0 HP: one automatic failure, two on a critical hit; instant death
 * when the damage equals or exceeds the hit point maximum. Losing stability resumes dying.
 */
export function damageWhileDying(
  current: DeathSaveState,
  damage: number,
  critical: boolean,
  hpMaximum: number
): Readonly<{ state: DeathSaveState; failuresAdded: number; dead: boolean }> {
  // A stable character's counters were reset; damage breaks stability and dying resumes from zero.
  const base = current.stable ? { successes: 0, failures: 0 } : current;
  if (damage <= 0) return { state: current, failuresAdded: 0, dead: current.failures >= 3 };
  if (damage >= hpMaximum)
    return {
      state: { successes: base.successes, stable: false, failures: 3 },
      failuresAdded: 3 - base.failures,
      dead: true
    };
  const failuresAdded = critical ? 2 : 1;
  const failures = Math.min(3, base.failures + failuresAdded);
  return { state: { successes: base.successes, failures, stable: false }, failuresAdded, dead: failures >= 3 };
}

/** Damage that drops a creature to 0: instant death when the damage beyond 0 equals or exceeds the HP maximum. */
export function droppedToZero(
  overflowDamage: number,
  hpMaximum: number
): Readonly<{ instantDeath: boolean; state: DeathSaveState }> {
  const instantDeath = overflowDamage >= hpMaximum;
  return {
    instantDeath,
    state: instantDeath ? { successes: 0, failures: 3, stable: false } : { successes: 0, failures: 0, stable: false }
  };
}
