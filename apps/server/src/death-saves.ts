import type { Actor, GameState } from "@vtt/domain";
import { d20Die, parseDiceFormula, resolveDeathSave, resolveDice, type RandomSource } from "@vtt/rules-5e";
import { recordRoll as recordRollInHistory, rolledTerms } from "./roll-history.js";

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
 * Rolls (or confirms) one death saving throw against an actor's current pips. A raw d20 through the
 * shared dice engine, so adv/disadv keep the higher/lower die. Pure core (like `answerSave`): no
 * authorization or narration; the caller owns those and the natural-20 heal.
 *
 * `commit=false` previews: the die is recorded for the table but pips are untouched. `commit` applies
 * the next pip state. A provided `naturalRoll` confirms a previewed or physical die without rolling.
 */
export function rollDeathSave(
  state: GameState,
  actor: Actor,
  options: Readonly<{ commit: boolean; rollMode?: DeathSaveMode; naturalRoll?: number }>,
  deps: DeathSaveRollDependencies
): DeathSaveRollResult {
  if (actor.deathSaves === null) throw new Error("rollDeathSave requires a dying actor.");
  let face: number;
  let mode: DeathSaveMode | undefined;
  if (options.naturalRoll !== undefined) {
    face = options.naturalRoll;
  } else {
    const chosen = options.rollMode ?? "normal";
    const formula = d20Die(chosen);
    const resolution = resolveDice(parseDiceFormula(formula), deps.random);
    face = resolution.total;
    if (chosen !== "normal") mode = chosen;
    // Recorded under the dying character with the real initiator role; hidden combatants stay GM-only.
    recordRollInHistory(state, {
      id: deps.rollId,
      commandId: deps.commandId,
      initiatorSessionId: deps.sessionId,
      initiatorRole: deps.role,
      initiatorLabel: actor.name,
      actorId: actor.id,
      purpose: "save",
      visibility: actor.visibility === "gm-only" ? "gm-only" : "public",
      formula,
      normalizedFormula: resolution.expression.normalized,
      ...rolledTerms(resolution),
      total: resolution.total,
      createdAt: deps.now()
    });
  }
  const outcome = resolveDeathSave(actor.deathSaves, face);
  if (options.commit) actor.deathSaves = outcome.state;
  return { face, outcome, mode, committed: options.commit };
}
