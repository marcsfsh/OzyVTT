import type { Actor, GameState, RollRecord } from "@vtt/domain";
import { parseDiceFormula, resolveDeathSave, resolveDice, type RandomSource } from "@vtt/rules-5e";

export type DeathSaveMode = "advantage" | "disadvantage" | "normal";

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
  outcome: ReturnType<typeof resolveDeathSave>;
  /** The adv/disadv mode when one was chosen; absent for a plain d20. */
  mode?: DeathSaveMode;
  committed: boolean;
}>;

/**
 * Roll (or confirm) one death saving throw against an actor's current pips, through the SAME dice
 * engine every other roll uses - a death save is just a raw d20 (no modifier), so adv/disadv keep the
 * higher/lower (2d20kh1 / 2d20kl1) and the kept die's face decides it. This is the pure core the
 * operation wraps, mirroring `answerSave`: it does no authorization or narration (the caller owns
 * those and the natural-20 heal), which keeps it unit-testable with a queued random.
 *
 * `commit=false` PREVIEWS: the die is recorded for the table so everyone sees it, but the pips are
 * left untouched and the caller can offer Adv/Disadv/Confirm - matching the saving-throw flow. `commit`
 * applies the next pip state. A provided `naturalRoll` confirms a previewed (or off-screen physical)
 * die with no fresh roll, so it records nothing new.
 */
export function rollDeathSave(state: GameState, actor: Actor, options: Readonly<{ commit: boolean; rollMode?: DeathSaveMode; naturalRoll?: number }>, deps: DeathSaveRollDependencies): DeathSaveRollResult {
  if (actor.deathSaves === null) throw new Error("rollDeathSave requires a dying actor.");
  let face: number;
  let mode: DeathSaveMode | undefined;
  if (options.naturalRoll !== undefined) {
    face = options.naturalRoll;
  } else {
    const chosen = options.rollMode ?? "normal";
    const formula = chosen === "advantage" ? "2d20kh1" : chosen === "disadvantage" ? "2d20kl1" : "1d20";
    const resolution = resolveDice(parseDiceFormula(formula), deps.random);
    face = resolution.total;
    if (chosen !== "normal") mode = chosen;
    // The roll lands in the shared history under the dying character's name and real initiator role;
    // hidden combatants stay GM-only (the save-roll recording pattern).
    let group = 0;
    const record: RollRecord = {
      id: deps.rollId, commandId: deps.commandId, initiatorSessionId: deps.sessionId, initiatorRole: deps.role, initiatorLabel: actor.name, actorId: actor.id,
      purpose: "save", visibility: actor.visibility === "gm-only" ? "gm-only" : "public",
      formula, normalizedFormula: resolution.expression.normalized,
      dice: resolution.terms.flatMap((term) => { if (term.kind !== "dice") return []; const currentGroup = group++; return term.dice.map((die) => ({ group: currentGroup, sides: term.sides, face: die.face, kept: die.kept, sign: term.sign })); }),
      modifiers: [], total: resolution.total, createdAt: deps.now()
    };
    state.rolls.push(record);
    if (state.rolls.length > 200) state.rolls.splice(0, state.rolls.length - 200);
  }
  const outcome = resolveDeathSave(actor.deathSaves, face);
  if (options.commit) actor.deathSaves = outcome.state;
  return { face, outcome, mode, committed: options.commit };
}
