// Ability-score generation for the builder: standard array, point buy and the rolled-scores formula. A rolled
// formula is checked with the dice grammar in `dice.ts` (`kh`/`kl`), the parser every roll goes through.
import { DiceFormulaError, parseDiceFormula, type DiceExpression } from "./dice.js";
import type { Ability } from "./character.js";

/** The six abilities in SRD sheet order; the stat priority of a class the table doesn't know. */
export const ABILITIES: readonly Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

/** Each ability's name as the SRD prints it, for sentences a player reads. */
export const ABILITY_NAMES: Readonly<Record<Ability, string>> = Object.freeze({
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma"
});

/** SRD standard array, highest first. */
export const STANDARD_ARRAY: readonly number[] = [15, 14, 13, 12, 10, 8];

/** Point-buy bounds and budget (SRD Variant: Customizing Ability Scores). */
export const POINT_BUY_MINIMUM = 8;
export const POINT_BUY_MAXIMUM = 15;
export const POINT_BUY_BUDGET = 27;

/** SRD point-buy cost table: 8-13 cost one point each, 14 and 15 cost two. */
export const POINT_BUY_COSTS: Readonly<Record<number, number>> = Object.freeze({
  8: 0,
  9: 1,
  10: 2,
  11: 3,
  12: 4,
  13: 5,
  14: 7,
  15: 9
});

/** Points a single score costs. Throws for anything outside the legal 8-15 buy range. */
export function pointBuyCost(score: number): number {
  const cost = POINT_BUY_COSTS[score];
  if (cost === undefined)
    throw new RangeError(`Point buy only covers scores ${POINT_BUY_MINIMUM}-${POINT_BUY_MAXIMUM}; got ${score}.`);
  return cost;
}

/** True when a score is inside the buy range (so a UI can disable illegal steps). */
export function isPointBuyScore(score: number): boolean {
  return POINT_BUY_COSTS[score] !== undefined;
}

/** Points left after buying `scores`; negative means over budget. Throws if any score is outside 8-15. */
export function pointBuyRemaining(scores: readonly number[], budget: number = POINT_BUY_BUDGET): number {
  return scores.reduce((remaining, score) => remaining - pointBuyCost(score), budget);
}

/** A point-buy spread is legal when every score is in range and it is within budget. */
export function isPointBuyLegal(scores: readonly number[], budget: number = POINT_BUY_BUDGET): boolean {
  return scores.every(isPointBuyScore) && pointBuyRemaining(scores, budget) >= 0;
}

/** The SRD rolled-scores method: roll 4d6 and drop the lowest, six times. */
export const ABILITY_ROLL_FORMULA = "4d6kh3";
/** Generated scores must land inside the sheet's legal 1-30 range. */
export const ABILITY_SCORE_MINIMUM = 1;
export const ABILITY_SCORE_MAXIMUM = 30;

/** Smallest and largest total a dice expression can produce, with sign and `kh`/`kl` keeps honoured. */
export function diceExpressionBounds(expression: DiceExpression): { minimum: number; maximum: number } {
  let minimum = 0;
  let maximum = 0;
  for (const term of expression.terms) {
    if (term.kind === "modifier") {
      minimum += term.sign * term.value;
      maximum += term.sign * term.value;
      continue;
    }
    const kept = term.keep?.count ?? term.count;
    const termMinimum = kept * 1;
    const termMaximum = kept * term.sides;
    if (term.sign === 1) {
      minimum += termMinimum;
      maximum += termMaximum;
    } else {
      minimum -= termMaximum;
      maximum -= termMinimum;
    }
  }
  return { minimum, maximum };
}

export type AbilityFormulaCheck =
  { ok: true; formula: string; minimum: number; maximum: number } | { ok: false; message: string };

/** Validate a GM-configured ability formula with the same dice parser as every other roll: it must roll at
 * least one die and only produce scores of 1-30. */
export function validateAbilityFormula(formula: string): AbilityFormulaCheck {
  let expression: DiceExpression;
  try {
    expression = parseDiceFormula(formula);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof DiceFormulaError ? error.message : "That dice formula could not be read."
    };
  }
  if (!expression.terms.some((term) => term.kind === "dice"))
    return { ok: false, message: "An ability formula has to roll at least one die." };
  const { minimum, maximum } = diceExpressionBounds(expression);
  if (minimum < ABILITY_SCORE_MINIMUM)
    return {
      ok: false,
      message: `That formula can roll as low as ${minimum}; ability scores start at ${ABILITY_SCORE_MINIMUM}.`
    };
  if (maximum > ABILITY_SCORE_MAXIMUM)
    return {
      ok: false,
      message: `That formula can roll as high as ${maximum}; ability scores stop at ${ABILITY_SCORE_MAXIMUM}.`
    };
  return { ok: true, formula, minimum, maximum };
}
