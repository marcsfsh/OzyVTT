import { effectivePlayerDice, type DiceMode, type GameState } from "@vtt/domain";
import type { Initiator } from "./authorization.js";
import { CommandRejectedError } from "./game-store.js";

/**
 * How a player's dice are entered (ADR-0043): the live encounter's modes over the table's. Every typed number is the
 * server's to check; the GM may always type or roll.
 */

export type DiceKind = "d20" | "damage";
/** What a player typed: a die's face or the roll's total. */
export type Entered = "face" | "total";

const REFUSAL: Readonly<Record<DiceMode, string>> = {
  app: "At this table the server rolls players' dice. Tap Roll.",
  die: "At this table you type the die's face. The server adds the bonus.",
  total: "At this table you type the total, with the bonus included."
};

export function diceMode(state: GameState, kind: DiceKind): DiceMode {
  return effectivePlayerDice(state)[kind];
}

/** Refuses what a player typed when the mode for that kind of roll asks for something else. */
export function requirePlayerEntry(state: GameState, scope: Initiator, kind: DiceKind, entered: Entered): void {
  if (scope.role === "gm") return;
  const mode = diceMode(state, kind);
  if (mode !== (entered === "face" ? "die" : "total")) throw new CommandRejectedError(REFUSAL[mode]);
}

/** Whether a player may type dice of this kind at all (a reroll's face, a builder's rolled score). */
export function playerMayType(state: GameState, scope: Initiator, kind: DiceKind): boolean {
  return scope.role === "gm" || diceMode(state, kind) !== "app";
}

/** Refuses any typed die of this kind from a player while the server throws them. */
export function requirePlayerMayType(state: GameState, scope: Initiator, kind: DiceKind): void {
  if (!playerMayType(state, scope, kind)) throw new CommandRejectedError(REFUSAL.app);
}

/**
 * A typed d20 total as the face it means: the total less the bonus the server works out, which must leave a d20's
 * face. Dice an effect adds (Bless's d4) the server still throws. A d20 + 5 total is 6 to 25.
 */
export function faceFromTotal(total: number, modifier: number): number {
  const face = total - modifier;
  if (!Number.isInteger(face) || face < 1 || face > 20) {
    const sign = modifier < 0 ? "-" : "+";
    throw new CommandRejectedError(
      `A d20 ${sign} ${Math.abs(modifier)} total is ${1 + modifier} to ${20 + modifier}. Check the total you typed.`
    );
  }
  return face;
}
