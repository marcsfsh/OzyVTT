// A monster's headline numbers, read off its stat block the way the SRD 5.2.1 prints them, and what the stat blocks of
// one challenge rating have in common. Structural types: this leaf package cannot import `@vtt/schemas`.

import { parseDiceFormula } from "./dice.js";

/** Every challenge rating a stat block can print, in order. */
export const CHALLENGE_RATINGS: readonly number[] = Object.freeze([
  0,
  0.125,
  0.25,
  0.5,
  ...Array.from({ length: 30 }, (_, index) => index + 1)
]);

/** The Proficiency Bonus a stat block prints after its CR: +2 through CR 4, one more every four CRs (+9 at 30).
 *  Every SRD 5.2.1 stat block agrees (`monster-stats.test.ts` in the content package checks them all). */
export function proficiencyBonusForChallenge(challengeRating: number): number {
  const rating = Math.max(1, Math.ceil(challengeRating));
  return 2 + Math.floor((Math.min(30, rating) - 1) / 4);
}

export type CreatureSize = "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan";

/** The Hit Point Die a monster of this size rolls, as every SRD 5.2.1 stat block's Hit Points line has it. */
export const HIT_DIE_BY_SIZE: Readonly<Record<CreatureSize, number>> = Object.freeze({
  tiny: 4,
  small: 6,
  medium: 8,
  large: 10,
  huge: 12,
  gargantuan: 20
});

/** A stat block's Hit Points: the dice formula ("6d8 + 12", Constitution added once per die) and its average, which
 *  is the printed number. */
export function monsterHitPoints(
  dice: number,
  size: CreatureSize,
  constitution: number
): Readonly<{ formula: string; average: number }> {
  const count = Math.max(1, Math.trunc(dice));
  const sides = HIT_DIE_BY_SIZE[size];
  const bonus = count * Math.floor((constitution - 10) / 2);
  const formula = bonus === 0 ? `${count}d${sides}` : `${count}d${sides} ${bonus > 0 ? "+" : "-"} ${Math.abs(bonus)}`;
  return { formula, average: Math.max(1, Math.floor((count * (sides + 1)) / 2) + bonus) };
}

/** The number a stat block prints before a die expression: "5 (1d6 + 2)". Rounded down, as printed. Null for a
 *  formula the dice grammar refuses. */
export function averageOf(formula: string): number | null {
  try {
    const expression = parseDiceFormula(formula);
    let total = 0;
    for (const term of expression.terms) {
      if (term.kind === "modifier") total += term.sign * term.value;
      else total += (term.sign * ((term.keep?.count ?? term.count) * (term.sides + 1))) / 2;
    }
    return Math.floor(total);
  } catch {
    return null;
  }
}

/** The parts of an action these numbers read; any stat block's action fits. */
export type StatblockActionLike = Readonly<{
  id: string;
  activation: string;
  attack?: Readonly<{ bonus?: number }>;
  save?: Readonly<{ dc?: number }>;
  damage?: ReadonlyArray<Readonly<{ formula: string }>>;
  multiattack?: ReadonlyArray<Readonly<{ actionId: string; count: number; or?: readonly string[] }>>;
  multiattackAlternatives?: ReadonlyArray<
    ReadonlyArray<Readonly<{ actionId: string; count: number; or?: readonly string[] }>>
  >;
  legendary?: unknown;
}>;

export type StatblockLike = Readonly<{
  armorClass: number;
  hitPoints: Readonly<{ maximum: number }>;
  actions: readonly StatblockActionLike[];
}>;

/** What one action deals at average rolls, every part added up (a hit, or a failed save). */
export function actionDamage(action: StatblockActionLike): number {
  return (action.damage ?? []).reduce((sum, part) => sum + (averageOf(part.formula) ?? 0), 0);
}

/** A Multiattack plan's damage: each place takes the action its count times, the best of the actions that can fill
 *  it. */
function planDamage(
  plan: NonNullable<StatblockActionLike["multiattack"]>,
  byId: ReadonlyMap<string, StatblockActionLike>
): number {
  return plan.reduce((sum, component) => {
    const choices = [component.actionId, ...(component.or ?? [])].map((id) => byId.get(id));
    const best = Math.max(0, ...choices.map((choice) => (choice ? actionDamage(choice) : 0)));
    return sum + component.count * best;
  }, 0);
}

export type StatblockNumbers = Readonly<{
  armorClass: number;
  hitPoints: number;
  /** The best attack bonus among its actions; null when nothing it does makes an attack roll. */
  attackBonus: number | null;
  /** The highest save DC among its actions; null when nothing it does forces a save. */
  saveDc: number | null;
  /** The most its action and bonus action deal in one turn at average rolls, every attack hitting and every save
   *  failed. Legendary actions and reactions happen on other turns and are left out. */
  damagePerRound: number;
}>;

export function statblockNumbers(statblock: StatblockLike): StatblockNumbers {
  const byId = new Map(statblock.actions.map((action) => [action.id, action]));
  const own = statblock.actions.filter((action) => action.legendary === undefined);
  const bestOf = (activation: string) =>
    Math.max(
      0,
      ...own
        .filter((action) => action.activation === activation)
        .map((action) =>
          Math.max(
            actionDamage(action),
            action.multiattack ? planDamage(action.multiattack, byId) : 0,
            ...(action.multiattackAlternatives ?? []).map((plan) => planDamage(plan, byId))
          )
        )
    );
  const bonuses = own.flatMap((action) => (typeof action.attack?.bonus === "number" ? [action.attack.bonus] : []));
  const dcs = own.flatMap((action) => (typeof action.save?.dc === "number" ? [action.save.dc] : []));
  return {
    armorClass: statblock.armorClass,
    hitPoints: statblock.hitPoints.maximum,
    attackBonus: bonuses.length > 0 ? Math.max(...bonuses) : null,
    saveDc: dcs.length > 0 ? Math.max(...dcs) : null,
    damagePerRound: bestOf("action") + bestOf("bonus-action")
  };
}

/** The low, middle and high of one number across a set of stat blocks. */
export type Spread = Readonly<{ count: number; min: number; median: number; max: number }>;

export function spreadOf(values: readonly number[]): Spread | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length / 2;
  const median =
    sorted.length % 2 === 1 ? sorted[Math.floor(middle)] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  return { count: sorted.length, min: sorted[0], median, max: sorted[sorted.length - 1] };
}

/** What the stat blocks of one challenge rating have: how many there are, and the spread of each number. */
export type ChallengeBenchmark = Readonly<{
  challengeRating: number;
  count: number;
  armorClass: Spread;
  hitPoints: Spread;
  attackBonus: Spread | null;
  saveDc: Spread | null;
  damagePerRound: Spread;
}>;

/** Benchmarks by challenge rating over a set of stat blocks, in CR order. A rating no stat block has is absent. */
export function challengeBenchmarks(
  statblocks: ReadonlyArray<Readonly<{ challengeRating: number; statblock: StatblockLike }>>
): readonly ChallengeBenchmark[] {
  const byRating = new Map<number, StatblockNumbers[]>();
  for (const { challengeRating, statblock } of statblocks) {
    const list = byRating.get(challengeRating) ?? [];
    list.push(statblockNumbers(statblock));
    byRating.set(challengeRating, list);
  }
  return [...byRating.entries()]
    .sort(([left], [right]) => left - right)
    .map(([challengeRating, numbers]) => {
      const take = (pick: (entry: StatblockNumbers) => number | null) =>
        numbers.flatMap((entry) => {
          const value = pick(entry);
          return value === null ? [] : [value];
        });
      return {
        challengeRating,
        count: numbers.length,
        armorClass: spreadOf(take((entry) => entry.armorClass))!,
        hitPoints: spreadOf(take((entry) => entry.hitPoints))!,
        attackBonus: spreadOf(take((entry) => entry.attackBonus)),
        saveDc: spreadOf(take((entry) => entry.saveDc)),
        damagePerRound: spreadOf(take((entry) => entry.damagePerRound))!
      };
    });
}
