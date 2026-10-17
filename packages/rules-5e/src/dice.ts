const SUPPORTED_SIDES = new Set([4, 6, 8, 10, 12, 20, 100]);
const MAX_FORMULA_LENGTH = 160;
const MAX_TERMS = 20;
const MAX_DICE = 200;

export class DiceFormulaError extends Error {
  constructor(
    message: string,
    readonly position?: number
  ) {
    super(message);
    this.name = "DiceFormulaError";
  }
}

export type DiceTerm = {
  kind: "dice";
  sign: 1 | -1;
  count: number;
  sides: number;
  keep?: { mode: "highest" | "lowest"; count: number };
};
export type ModifierTerm = { kind: "modifier"; sign: 1 | -1; value: number };
export type DiceExpression = { source: string; normalized: string; terms: Array<DiceTerm | ModifierTerm> };
export type ResolvedDie = { face: number; kept: boolean };
export type ResolvedDiceTerm = DiceTerm & { dice: ResolvedDie[]; subtotal: number };
export type DiceResolution = {
  expression: DiceExpression;
  terms: Array<ResolvedDiceTerm | ModifierTerm>;
  total: number;
};
export type RandomSource = (sides: number) => number;

export function parseDiceFormula(source: string): DiceExpression {
  if (source.length > MAX_FORMULA_LENGTH)
    throw new DiceFormulaError(`Dice formulas may not exceed ${MAX_FORMULA_LENGTH} characters.`);
  const normalized = source.replace(/\s+/g, "").toLowerCase();
  if (!normalized) throw new DiceFormulaError("Enter a dice formula such as 1d20 + 5.");
  const terms: Array<DiceTerm | ModifierTerm> = [];
  let position = 0;
  let diceCount = 0;
  while (position < normalized.length) {
    if (terms.length >= MAX_TERMS)
      throw new DiceFormulaError(`Dice formulas may not contain more than ${MAX_TERMS} terms.`, position);
    const fragment = normalized.slice(position);
    const match = fragment.match(/^([+-]?)(?:(\d*)d(\d+)(?:(kh|kl)(\d+))?|(\d+))/);
    if (!match || (terms.length > 0 && match[1] === ""))
      throw new DiceFormulaError(`Unsupported dice expression near “${fragment.slice(0, 12)}”.`, position);
    const sign: 1 | -1 = match[1] === "-" ? -1 : 1;
    if (match[3]) {
      const count = match[2] ? Number(match[2]) : 1;
      const sides = Number(match[3]);
      if (!Number.isSafeInteger(count) || count < 1)
        throw new DiceFormulaError("A dice group must roll at least one die.", position);
      if (!SUPPORTED_SIDES.has(sides))
        throw new DiceFormulaError(`d${sides} is not supported. Use d4, d6, d8, d10, d12, d20, or d100.`, position);
      diceCount += count;
      if (diceCount > MAX_DICE)
        throw new DiceFormulaError(`A roll may not contain more than ${MAX_DICE} dice.`, position);
      const keepCount = match[5] ? Number(match[5]) : undefined;
      if (keepCount !== undefined && (!Number.isSafeInteger(keepCount) || keepCount < 1 || keepCount > count))
        throw new DiceFormulaError("Keep count must be between one and the number of dice rolled.", position);
      terms.push({
        kind: "dice",
        sign,
        count,
        sides,
        ...(match[4] && keepCount
          ? { keep: { mode: match[4] === "kh" ? "highest" : "lowest", count: keepCount } as const }
          : {})
      });
    } else {
      const value = Number(match[6]);
      if (!Number.isSafeInteger(value) || value > 100000)
        throw new DiceFormulaError("Numeric modifiers must be safe integers no greater than 100000.", position);
      terms.push({ kind: "modifier", sign, value });
    }
    position += match[0].length;
  }
  return { source, normalized, terms };
}

export function resolveDice(expression: DiceExpression, random: RandomSource): DiceResolution {
  let total = 0;
  const terms = expression.terms.map((term): ResolvedDiceTerm | ModifierTerm => {
    if (term.kind === "modifier") {
      total += term.sign * term.value;
      return term;
    }
    const faces = Array.from({ length: term.count }, () => {
      const face = random(term.sides);
      if (!Number.isInteger(face) || face < 1 || face > term.sides)
        throw new RangeError(`Random source returned ${face} for d${term.sides}.`);
      return face;
    });
    const kept = new Set(
      faces
        .map((face, index) => ({ face, index }))
        .sort((a, b) =>
          term.keep?.mode === "lowest" ? a.face - b.face || a.index - b.index : b.face - a.face || a.index - b.index
        )
        .slice(0, term.keep?.count ?? faces.length)
        .map(({ index }) => index)
    );
    const subtotal = term.sign * faces.reduce((sum, face, index) => sum + (kept.has(index) ? face : 0), 0);
    total += subtotal;
    return { ...term, dice: faces.map((face, index) => ({ face, kept: kept.has(index) })), subtotal };
  });
  return { expression, terms, total };
}

export function rollDice(formula: string, random: RandomSource) {
  return resolveDice(parseDiceFormula(formula), random);
}

type RollMode = "advantage" | "disadvantage" | "normal" | null | undefined;

/** The d20 a roll mode rolls (SRD Advantage and Disadvantage: roll two, keep the higher or the lower). */
export function d20Die(mode: RollMode): string {
  return mode === "advantage" ? "2d20kh1" : mode === "disadvantage" ? "2d20kl1" : "1d20";
}

/** A D20 Test's formula: the mode's die plus the modifier, written out even at +0 so the roll shows it. */
export function d20TestFormula(mode: RollMode, modifier: number): string {
  return `${d20Die(mode)} ${modifier < 0 ? "-" : "+"} ${Math.abs(modifier)}`;
}

/** How many d20s a test throws: two with Advantage or Disadvantage, one otherwise. */
export function d20Count(mode: RollMode): 1 | 2 {
  return mode === "advantage" || mode === "disadvantage" ? 2 : 1;
}

/** The d20 that counts among a test's faces: the higher with Advantage, the lower with Disadvantage, else the first. */
export function keptD20(faces: readonly number[], mode: RollMode): number {
  if (faces.length === 0) throw new RangeError("A d20 test needs at least one face.");
  if (mode === "advantage") return Math.max(...faces.slice(0, 2));
  if (mode === "disadvantage") return Math.min(...faces.slice(0, 2));
  return faces[0];
}

/**
 * The d20s a test uses when some were already thrown for it (a held preview): the held faces, topped up with fresh
 * ones to the count `mode` needs. A die once thrown stays thrown, so a second look at the same roll can't re-roll it.
 */
export function d20FacesFor(mode: RollMode, held: readonly number[], random: RandomSource): number[] {
  const faces = held.slice(0, 2);
  while (faces.length < d20Count(mode)) faces.push(random(20));
  return faces;
}

/** Rerolls one d20 of a test (SRD Heroic Inspiration: "reroll one of those dice, not both"): the lowest, the only one
 *  whose reroll can help under either mode. */
export function rerollLowestD20(faces: readonly number[], random: RandomSource): number[] {
  if (faces.length === 0) throw new RangeError("A d20 test needs at least one face.");
  const lowest = faces.indexOf(Math.min(...faces));
  return faces.map((face, index) => (index === lowest ? random(20) : face));
}

/** A die other than the test's d20 (Bless's d4), as thrown. */
export type ThrownDie = Readonly<{ sides: number; face: number }>;

/**
 * Resolves a d20 test's formula with its d20s already decided (`faces`, in order), so the recorded roll shows the dice
 * that count. Its other dice (Bless's d4) take the `held` faces of their size first, so a held roll keeps them too, and
 * are thrown with `random` otherwise.
 */
export function resolveWithD20s(
  formula: string,
  faces: readonly number[],
  random: RandomSource,
  held: readonly ThrownDie[] = []
): DiceResolution {
  const d20s = [...faces];
  const others = [...held];
  return resolveDice(parseDiceFormula(formula), (sides) => {
    if (sides === 20 && d20s.length > 0) return d20s.shift()!;
    const index = others.findIndex((die) => die.sides === sides);
    return index >= 0 ? others.splice(index, 1)[0].face : random(sides);
  });
}

/** The dice of a resolution other than its d20s, to hold beside them. */
export function otherDiceOf(resolution: DiceResolution): ThrownDie[] {
  return resolution.terms.flatMap((term) =>
    term.kind === "dice" && term.sides !== 20 ? term.dice.map((die) => ({ sides: term.sides, face: die.face })) : []
  );
}

/** A "XdY + N" or flat formula with a modifier folded into its one constant ("2d8" + 3 = "2d8 + 3"), so the result
 *  stays a single safe formula. */
export function formulaPlus(formula: string, modifier: number): string {
  const match = /^(\d+d\d+)(?:\s*([+-])\s*(\d+))?$/i.exec(formula.trim());
  if (!match) return String(Number(formula) + modifier);
  const constant = (match[2] === "-" ? -1 : 1) * Number(match[3] ?? 0) + modifier;
  return constant === 0 ? match[1] : `${match[1]} ${constant > 0 ? "+" : "-"} ${Math.abs(constant)}`;
}
