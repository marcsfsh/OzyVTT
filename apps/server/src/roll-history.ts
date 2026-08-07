import type { GameState, RollRecord } from "@vtt/domain";

/**
 * THE roll writer (D11/WI2). Every die the server rolls - loose tray rolls, structured attacks and
 * damage, saving throws, death saves, Hit Dice, and initiative - lands here and nowhere else.
 *
 * Before this existed the push-and-trim was copy-pasted at five call sites, which is how the two logs
 * diverged in the first place: `dice.roll` wrote the roll window and never the combat log, player-rolled
 * initiative wrote the combat log and never the roll window, and a player asking "where did my roll go"
 * had no answerable question. One writer means the window and the feed cannot disagree again.
 */

/** The live hot window every projection ships inline. The feed is the history; this is the cache. */
const ROLL_WINDOW = 200;

/** Push one roll into the live window (trimming the oldest) and hand it back for the caller's feed line. */
export function recordRoll(state: GameState, record: RollRecord): RollRecord {
  state.rolls.push(record);
  if (state.rolls.length > ROLL_WINDOW) state.rolls.splice(0, state.rolls.length - ROLL_WINDOW);
  return record;
}

/**
 * Every roll one command produced, read off COMMITTED state.
 *
 * This is how a feed row reaches the store without threading a logger through the rules engine: the
 * mutation runs, and afterwards the operation asks "what did I roll?". Every `RollRecord` already
 * carries the originating `commandId` (it is the idempotency receipt key), so the answer is exact, it
 * cannot fire for a mutation that rolled back, and a duplicate command - which never re-executes -
 * simply never asks.
 */
export function rollsForCommand(state: GameState, commandId: string): readonly RollRecord[] {
  return state.rolls.filter((roll) => roll.commandId === commandId);
}

/**
 * The feed line for one roll: "Borin rolled 17 on Athletics check." Falls back to the normalized
 * formula when a roll carries no label (older rolls and integration rolls do not supply one), so a
 * line never reads "rolled 17 on undefined".
 */
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
  manual: "a roll"
};

/**
 * Does this roll's feed row belong to the GM alone? `gm-only` is GM knowledge by definition, and
 * `blind` is hidden from its own roller too (the `hiddenFromRoller` ack contract), so both are stored
 * GM-only. `self-only` is NOT: it is stored player-visible and gated on the reader's session id, which
 * is what lets exactly one player see their own private roll.
 */
export function rollFeedIsGmOnly(record: RollRecord): boolean {
  return record.visibility === "gm-only" || record.visibility === "blind";
}
