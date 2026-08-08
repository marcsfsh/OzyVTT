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

/**
 * THE ONE damage-type normaliser, exported so both halves of the vocabulary share it.
 *
 * The engine matches types by this form, and the homebrew editor writes them; a second copy anywhere
 * is a silent-inertness bug ("Fire" resisted by nothing). It lives HERE rather than beside
 * `DAMAGE_TYPE_IDS` because `@vtt/content-srd-5.2.1` depends on this package and not the reverse -
 * declaring it there and importing it here would be a dependency cycle. That package re-exports it.
 */
export const normalizeDamageType = (type: string): string => type.trim().toLowerCase();

const normalizeType = normalizeDamageType;

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

/**
 * Flat reduction ("reduce the damage by 3" - Heavy Armor Master, Armor of Gleaming) is the LAST step
 * and the only one that is not per-type: it applies once to the total the per-type adjustments
 * produced, and it floors at 0 rather than turning damage into healing.
 *
 * Per TOTAL rather than per part because the SRD phrases it against "the damage" one attack deals,
 * not against each damage die's own type. `adjustDamageParts` has already run when this is called, so
 * a resistance halves BEFORE the reduction subtracts - which is the order that makes a resisted hit
 * survivable rather than the reverse.
 */
export function reduceDamageTotal(total: number, reduction: number): number {
  return reduction <= 0 ? total : Math.max(0, total - reduction);
}

/**
 * A HAND-ENTERED TOTAL, re-weighted across the types that were actually rolled.
 *
 * The alternative - what every amend path did before this - is to send the number as an untyped
 * total, which skips the defence pipeline entirely: the GM corrects 17 to 12 and the fire-resistant
 * target suddenly takes all 12. Scaling keeps every type, so the amended hit is still fire, still
 * halved, and still explains itself.
 *
 * Exact by construction: each part floors to its share and the whole remainder lands on the largest
 * one, so the result always sums to `total`. An empty or zero-valued proposal has nothing to weight
 * by, so the number goes on a single part carrying the first type it can see.
 */
export function rescaleDamageParts(parts: readonly DamagePart[], total: number): DamagePart[] {
  const target = Math.max(0, Math.trunc(total));
  const rolled = parts.reduce((sum, part) => sum + part.amount, 0);
  if (parts.length === 0) return [];
  if (parts.length === 1 || rolled <= 0) return [{ type: parts[0].type, amount: target }];
  const scaled = parts.map((part) => ({ type: part.type, amount: Math.floor((part.amount * target) / rolled) }));
  const remainder = target - scaled.reduce((sum, part) => sum + part.amount, 0);
  let largest = 0;
  for (let index = 1; index < parts.length; index += 1) if (parts[index].amount > parts[largest].amount) largest = index;
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
