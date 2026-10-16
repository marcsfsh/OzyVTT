import type { GameState, RollRecord } from "@vtt/domain";
import type { DiceResolution } from "@vtt/rules-5e";

/** The single roll writer: every die the server rolls (tray rolls, attacks, damage, saves, death saves,
 *  Hit Dice, initiative) lands here, so the live roll window and the feed cannot disagree. */

/** The live hot window every projection ships inline. The feed is the history; this is the cache. */
const ROLL_WINDOW = 200;

/** Push one roll into the live window (trimming the oldest) and hand it back for the caller's feed line. */
export function recordRoll(state: GameState, record: RollRecord): RollRecord {
  state.rolls.push(record);
  if (state.rolls.length > ROLL_WINDOW) state.rolls.splice(0, state.rolls.length - ROLL_WINDOW);
  return record;
}

/** A resolved formula's dice and flat modifiers, as a roll record stores them. */
export function rolledTerms(resolution: DiceResolution): Pick<RollRecord, "dice" | "modifiers"> {
  let group = 0;
  return {
    dice: resolution.terms.flatMap((term) => {
      if (term.kind !== "dice") return [];
      const currentGroup = group++;
      return term.dice.map((die) => ({
        group: currentGroup,
        sides: term.sides,
        face: die.face,
        kept: die.kept,
        sign: term.sign
      }));
    }),
    modifiers: resolution.terms
      .filter((term): term is Extract<typeof term, { kind: "modifier" }> => term.kind === "modifier")
      .map((term) => ({ value: term.value, sign: term.sign }))
  };
}

/** Every roll one command produced, read off committed state. Each `RollRecord` carries its `commandId`,
 *  so this is exact, never fires for a rolled-back mutation, and a duplicate command (which never
 *  re-executes) never asks. */
export function rollsForCommand(state: GameState, commandId: string): readonly RollRecord[] {
  return state.rolls.filter((roll) => roll.commandId === commandId);
}

/** The feed line for one roll: "Borin rolled 17 on Athletics check." Falls back to the formula when a
 *  roll has no label (older and integration rolls). */
export function describeRoll(record: RollRecord): string {
  const who = record.initiatorLabel ?? (record.initiatorRole === "gm" ? "The GM" : "A player");
  const what = record.label ?? PURPOSE_LABELS[record.purpose];
  return `${who} rolled ${record.total} on ${what} (${record.normalizedFormula}).`;
}

const PURPOSE_LABELS: Readonly<Record<RollRecord["purpose"], string>> = {
  attack: "an attack",
  save: "a saving throw",
  check: "a check",
  damage: "damage",
  healing: "healing",
  manual: "a roll"
};

/** Whether a roll's feed row is GM-only: `gm-only` by definition, and `blind` is hidden even from its
 *  roller. `self-only` is stored player-visible and gated on the reader's session id. */
export function rollFeedIsGmOnly(record: RollRecord): boolean {
  return record.visibility === "gm-only" || record.visibility === "blind";
}
