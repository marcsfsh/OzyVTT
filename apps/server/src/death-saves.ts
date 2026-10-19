import type { Actor, GameState } from "@vtt/domain";
import {
  d20Die,
  parseDiceFormula,
  resolveDeathSave,
  resolveDice,
  type DiceResolution,
  type RandomSource
} from "@vtt/rules-5e";
import { recordRoll as recordRollInHistory, rolledTerms } from "./roll-history.js";

export type DeathSaveMode = "advantage" | "disadvantage" | "normal";

/** Survivor's Defy Death: a death save's d20 of 18 or higher counts as a 20. */
export const SURVIVOR_CRITICAL = 18;

/** The tag on an item's effect that makes a death save's d20 of 9 or lower count as 10 (Periapt of Wound Closure). */
export const DEATH_SAVE_FLOOR_TAG = "death-save-floor";
/** The tag on an item's effect that doubles what each Hit Point Die rolled to heal restores (Periapt of Wound
 *  Closure). */
export const HIT_DICE_DOUBLED_TAG = "hit-dice-doubled";

export type DeathSaveRollDependencies = Readonly<{
  random: RandomSource;
  rollId: string;
  commandId: string;
  sessionId: string;
  role: "gm" | "player";
  now: () => string;
}>;

export type DeathSaveRollResult = Readonly<{
  /** The natural d20 (the kept die under adv/disadv) that decides the save. */
  face: number;
  /** The face with what the save adds (Exhaustion, Bless's d4, an aura), which meets the DC of 10. */
  total: number;
  outcome: ReturnType<typeof resolveDeathSave>;
  /** The adv/disadv mode when one was chosen; absent for a plain d20. */
  mode?: DeathSaveMode;
  committed: boolean;
}>;

/** A death save's d20 test as the dice authority already settled it (`rollHeldTest`): the die that counts, the whole
 *  roll with its modifier and dice effects, and whether the dice are new. */
export type SettledDeathSave = Readonly<{
  natural: number;
  mode: DeathSaveMode;
  resolution: DiceResolution;
  fresh: boolean;
  typed: boolean;
}>;

/**
 * Rolls (or confirms) one death saving throw against an actor's current pips. Pure core (like `answerSave`): no
 * authorization or narration; the caller owns those and the natural-20 heal.
 *
 * `commit=false` previews: the die is recorded for the table but pips are untouched. `commit` applies the next pip
 * state. `test` is a d20 the caller already settled (held across a preview, typed, or rerolled), recorded only when
 * its dice are new; without one the die is thrown here, or `naturalRoll` confirms one without rolling. `modifier` is
 * what a saving throw adds to the die (Exhaustion, save bonuses).
 */
export function rollDeathSave(
  state: GameState,
  actor: Actor,
  options: Readonly<{
    commit: boolean;
    rollMode?: DeathSaveMode;
    naturalRoll?: number;
    modifier?: number;
    test?: SettledDeathSave;
    /** The total once answers to the roll count (a Bardic Inspiration die); the test's own total otherwise. */
    total?: number;
    /** A d20 under this counts as it (a Periapt of Wound Closure's 10). */
    floor?: number;
    /** A d20 of this or higher counts as a 20 (Survivor's Defy Death: "18-20"). */
    criticalFrom?: number;
  }>,
  deps: DeathSaveRollDependencies
): DeathSaveRollResult {
  if (actor.deathSaves === null) throw new Error("rollDeathSave requires a dying actor.");
  const record = (resolution: DiceResolution, typed: boolean) =>
    // Recorded under the dying character with the real initiator role; hidden combatants stay GM-only.
    recordRollInHistory(state, {
      id: deps.rollId,
      commandId: deps.commandId,
      initiatorSessionId: deps.sessionId,
      initiatorRole: deps.role,
      initiatorLabel: actor.name,
      label: "Death save",
      actorId: actor.id,
      purpose: "save",
      visibility: actor.visibility === "gm-only" ? "gm-only" : "public",
      formula: resolution.expression.source,
      normalizedFormula: resolution.expression.normalized,
      ...rolledTerms(resolution),
      total: resolution.total,
      ...(typed ? { typed: true as const } : {}),
      createdAt: deps.now()
    });
  let face: number;
  let total: number;
  let mode: DeathSaveMode | undefined;
  if (options.test) {
    const test = options.test;
    face = test.natural;
    total = options.total ?? test.resolution.total;
    if (test.mode !== "normal") mode = test.mode;
    if (test.fresh) record(test.resolution, test.typed);
  } else if (options.naturalRoll !== undefined) {
    face = options.naturalRoll;
    total = face + (options.modifier ?? 0);
  } else {
    const chosen = options.rollMode ?? "normal";
    const resolution = resolveDice(parseDiceFormula(d20Die(chosen)), deps.random);
    face = resolution.total;
    total = face + (options.modifier ?? 0);
    if (chosen !== "normal") mode = chosen;
    record(resolution, false);
  }
  // "Whenever you make a Death Saving Throw, you can change a roll of 9 or lower to a 10" (Periapt of Wound Closure).
  if (options.floor !== undefined && face < options.floor) {
    total += options.floor - face;
    face = options.floor;
  }
  // "When you roll 18-20 on a Death Saving Throw, you gain the benefit of rolling a 20 on it" (Survivor).
  const counted = options.criticalFrom !== undefined && face >= options.criticalFrom ? 20 : face;
  const outcome = resolveDeathSave(actor.deathSaves, counted, total);
  if (options.commit) actor.deathSaves = outcome.state;
  return { face, total, outcome, mode, committed: options.commit };
}
