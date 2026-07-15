const SUPPORTED_SIDES = new Set([4, 6, 8, 10, 12, 20, 100]);
const MAX_FORMULA_LENGTH = 160;
const MAX_TERMS = 20;
const MAX_DICE = 200;

export class DiceFormulaError extends Error {
  constructor(message: string, readonly position?: number) { super(message); this.name = "DiceFormulaError"; }
}

export type DiceTerm = { kind: "dice"; sign: 1 | -1; count: number; sides: number; keep?: { mode: "highest" | "lowest"; count: number } };
export type ModifierTerm = { kind: "modifier"; sign: 1 | -1; value: number };
export type DiceExpression = { source: string; normalized: string; terms: Array<DiceTerm | ModifierTerm> };
export type ResolvedDie = { face: number; kept: boolean };
export type ResolvedDiceTerm = DiceTerm & { dice: ResolvedDie[]; subtotal: number };
export type DiceResolution = { expression: DiceExpression; terms: Array<ResolvedDiceTerm | ModifierTerm>; total: number };
export type RandomSource = (sides: number) => number;

export function parseDiceFormula(source: string): DiceExpression {
  if (source.length > MAX_FORMULA_LENGTH) throw new DiceFormulaError(`Dice formulas may not exceed ${MAX_FORMULA_LENGTH} characters.`);
  const normalized = source.replace(/\s+/g, "").toLowerCase();
  if (!normalized) throw new DiceFormulaError("Enter a dice formula such as 1d20 + 5.");
  const terms: Array<DiceTerm | ModifierTerm> = [];
  let position = 0;
  let diceCount = 0;
  while (position < normalized.length) {
    if (terms.length >= MAX_TERMS) throw new DiceFormulaError(`Dice formulas may not contain more than ${MAX_TERMS} terms.`, position);
    const fragment = normalized.slice(position);
    const match = fragment.match(/^([+-]?)(?:(\d*)d(\d+)(?:(kh|kl)(\d+))?|(\d+))/);
    if (!match || (terms.length > 0 && match[1] === "")) throw new DiceFormulaError(`Unsupported dice expression near “${fragment.slice(0, 12)}”.`, position);
    const sign: 1 | -1 = match[1] === "-" ? -1 : 1;
    if (match[3]) {
      const count = match[2] ? Number(match[2]) : 1;
      const sides = Number(match[3]);
      if (!Number.isSafeInteger(count) || count < 1) throw new DiceFormulaError("A dice group must roll at least one die.", position);
      if (!SUPPORTED_SIDES.has(sides)) throw new DiceFormulaError(`d${sides} is not supported. Use d4, d6, d8, d10, d12, d20, or d100.`, position);
      diceCount += count;
      if (diceCount > MAX_DICE) throw new DiceFormulaError(`A roll may not contain more than ${MAX_DICE} dice.`, position);
      const keepCount = match[5] ? Number(match[5]) : undefined;
      if (keepCount !== undefined && (!Number.isSafeInteger(keepCount) || keepCount < 1 || keepCount > count)) throw new DiceFormulaError("Keep count must be between one and the number of dice rolled.", position);
      terms.push({ kind: "dice", sign, count, sides, ...(match[4] && keepCount ? { keep: { mode: match[4] === "kh" ? "highest" : "lowest", count: keepCount } as const } : {}) });
    } else {
      const value = Number(match[6]);
      if (!Number.isSafeInteger(value) || value > 100000) throw new DiceFormulaError("Numeric modifiers must be safe integers no greater than 100000.", position);
      terms.push({ kind: "modifier", sign, value });
    }
    position += match[0].length;
  }
  return { source, normalized, terms };
}

export function resolveDice(expression: DiceExpression, random: RandomSource): DiceResolution {
  let total = 0;
  const terms = expression.terms.map((term): ResolvedDiceTerm | ModifierTerm => {
    if (term.kind === "modifier") { total += term.sign * term.value; return term; }
    const faces = Array.from({ length: term.count }, () => {
      const face = random(term.sides);
      if (!Number.isInteger(face) || face < 1 || face > term.sides) throw new RangeError(`Random source returned ${face} for d${term.sides}.`);
      return face;
    });
    const kept = new Set(faces.map((face, index) => ({ face, index })).sort((a, b) => term.keep?.mode === "lowest" ? a.face - b.face || a.index - b.index : b.face - a.face || a.index - b.index).slice(0, term.keep?.count ?? faces.length).map(({ index }) => index));
    const subtotal = term.sign * faces.reduce((sum, face, index) => sum + (kept.has(index) ? face : 0), 0);
    total += subtotal;
    return { ...term, dice: faces.map((face, index) => ({ face, kept: kept.has(index) })), subtotal };
  });
  return { expression, terms, total };
}

export function rollDice(formula: string, random: RandomSource) { return resolveDice(parseDiceFormula(formula), random); }
