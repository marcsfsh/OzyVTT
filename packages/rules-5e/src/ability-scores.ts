/**
 * Ability-score GENERATION for the character builder: the standard array, point buy, and rolled
 * scores. Pure and stateless like the rest of `@vtt/rules-5e` - no game state, no schema, no
 * content. The GM picks which methods a table allows (task packet decision 10); these functions
 * only supply the math each method needs.
 *
 * Rolling reuses the authoritative dice grammar in `dice.ts` (which already understands `kh`/`kl`)
 * instead of re-implementing "roll four, drop the lowest".
 */
import { DiceFormulaError, parseDiceFormula, resolveDice, type DiceExpression, type RandomSource } from "./dice.js";
import type { Ability } from "./character.js";

/** The six abilities in SRD sheet order. Used as the fallback assignment order. */
export const ABILITIES: readonly Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

/** SRD standard array, highest first. The default method (task packet decision 10). */
export const STANDARD_ARRAY: readonly number[] = [15, 14, 13, 12, 10, 8];

/** Point-buy bounds and budget (SRD Variant: Customizing Ability Scores). */
export const POINT_BUY_MINIMUM = 8;
export const POINT_BUY_MAXIMUM = 15;
export const POINT_BUY_BUDGET = 27;

/** SRD point-buy cost table: 8-13 cost one point each, 14 and 15 cost two. */
export const POINT_BUY_COSTS: Readonly<Record<number, number>> = Object.freeze({
  8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9
});

/** Points a single score costs. Throws for anything outside the legal 8-15 buy range. */
export function pointBuyCost(score: number): number {
  const cost = POINT_BUY_COSTS[score];
  if (cost === undefined) throw new RangeError(`Point buy only covers scores ${POINT_BUY_MINIMUM}-${POINT_BUY_MAXIMUM}; got ${score}.`);
  return cost;
}

/** True when every score sits inside the buy range (so a UI can disable illegal steps before costing them). */
export function isPointBuyScore(score: number): boolean {
  return POINT_BUY_COSTS[score] !== undefined;
}

/**
 * Points left from `budget` after buying `scores`. Negative means the spread is over budget, which
 * is exactly what the allocator shows the player. Throws if any score is outside 8-15.
 */
export function pointBuyRemaining(scores: readonly number[], budget: number = POINT_BUY_BUDGET): number {
  return scores.reduce((remaining, score) => remaining - pointBuyCost(score), budget);
}

/** A point-buy spread is legal when every score is in range and it is within budget. */
export function isPointBuyLegal(scores: readonly number[], budget: number = POINT_BUY_BUDGET): boolean {
  return scores.every(isPointBuyScore) && pointBuyRemaining(scores, budget) >= 0;
}

/** The SRD rolled-scores method: roll 4d6 and drop the lowest, six times. */
export const ABILITY_ROLL_FORMULA = "4d6kh3";
/** Scores a full generation produces. */
export const ABILITY_SCORE_COUNT = 6;
/** A generated ability score must land inside the sheet's legal 1-30 range. */
export const ABILITY_SCORE_MINIMUM = 1;
export const ABILITY_SCORE_MAXIMUM = 30;

/** Smallest and largest total a dice expression can produce, honouring sign and `kh`/`kl` keeps. */
export function diceExpressionBounds(expression: DiceExpression): { minimum: number; maximum: number } {
  let minimum = 0;
  let maximum = 0;
  for (const term of expression.terms) {
    if (term.kind === "modifier") { minimum += term.sign * term.value; maximum += term.sign * term.value; continue; }
    const kept = term.keep?.count ?? term.count;
    const termMinimum = kept * 1;
    const termMaximum = kept * term.sides;
    if (term.sign === 1) { minimum += termMinimum; maximum += termMaximum; }
    else { minimum -= termMaximum; maximum -= termMinimum; }
  }
  return { minimum, maximum };
}

export type AbilityFormulaCheck =
  | { ok: true; formula: string; minimum: number; maximum: number }
  | { ok: false; message: string };

/**
 * Validate a GM-configured custom ability formula through the SAME parser the server uses for every
 * other roll (no second grammar, no eval). A formula is usable when it parses and can only ever
 * produce a score the sheet accepts (1-30).
 */
export function validateAbilityFormula(formula: string): AbilityFormulaCheck {
  let expression: DiceExpression;
  try { expression = parseDiceFormula(formula); }
  catch (error) { return { ok: false, message: error instanceof DiceFormulaError ? error.message : "That dice formula could not be read." }; }
  if (!expression.terms.some((term) => term.kind === "dice")) return { ok: false, message: "An ability formula has to roll at least one die." };
  const { minimum, maximum } = diceExpressionBounds(expression);
  if (minimum < ABILITY_SCORE_MINIMUM) return { ok: false, message: `That formula can roll as low as ${minimum}; ability scores start at ${ABILITY_SCORE_MINIMUM}.` };
  if (maximum > ABILITY_SCORE_MAXIMUM) return { ok: false, message: `That formula can roll as high as ${maximum}; ability scores stop at ${ABILITY_SCORE_MAXIMUM}.` };
  return { ok: true, formula, minimum, maximum };
}

/**
 * Roll a full set of six ability scores, highest first. `random(sides)` is the caller's source (the
 * server's audited RNG in play, a fixed sequence in tests). The default formula is the SRD `4d6kh3`;
 * a GM-configured formula is accepted only if `validateAbilityFormula` clears it.
 */
export function rollAbilityScores(random: RandomSource, formula: string = ABILITY_ROLL_FORMULA, count: number = ABILITY_SCORE_COUNT): number[] {
  const check = validateAbilityFormula(formula);
  if (!check.ok) throw new DiceFormulaError(check.message);
  const expression = parseDiceFormula(formula);
  const scores = Array.from({ length: count }, () => resolveDice(expression, random).total);
  return scores.sort((left, right) => right - left);
}

/**
 * Hand out generated scores by class stat priority: the highest score goes to the class's most
 * important ability, and so on. Any ability the priority omits is filled in SRD sheet order with
 * whatever is left, so a short (homebrew) priority list still produces a complete spread.
 */
export function assignByPriority(scores: readonly number[], priority: readonly Ability[]): Record<Ability, number> {
  if (scores.length !== ABILITY_SCORE_COUNT) throw new RangeError(`Assigning scores needs exactly ${ABILITY_SCORE_COUNT} values; got ${scores.length}.`);
  const order: Ability[] = [...new Set([...priority, ...ABILITIES])];
  const descending = [...scores].sort((left, right) => right - left);
  const assigned = {} as Record<Ability, number>;
  order.forEach((ability, index) => { assigned[ability] = descending[index]; });
  return assigned;
}
