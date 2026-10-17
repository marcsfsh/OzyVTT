import type { Actor, GameState, HeldRoll } from "@vtt/domain";
import {
  d20FacesFor,
  d20TestFormula,
  keptD20,
  rerollLowestD20,
  resolveWithD20s,
  type DiceResolution,
  type RandomSource
} from "@vtt/rules-5e";
import type { Initiator } from "./authorization.js";
import { CommandRejectedError } from "./game-store.js";

/**
 * Dice authority for rolls a player sees before they count (ADR-0012). A preview's d20s are held on the server under
 * the roll's key, so a second look at the same roll returns the same dice: the only reroll a player has is Heroic
 * Inspiration, and the GM may throw again. A player's typed die is the face a physical die shows, accepted only while
 * the table lets players type their dice, and never over a die the server already threw for that roll.
 */

const HELD_LIMIT = 100;

/** An attack's key names the attacker rather than one roll, so its die belongs to the turn it was thrown in; every
 *  other key names one pending roll (a save, a death save, a reaction, a check), which keeps its die until answered. */
const turnScoped = (key: string) => key.startsWith("attack:");

/** The held dice for a roll, when they still belong to it. */
export function heldRollFor(state: GameState, key: string): HeldRoll | undefined {
  const held = state.heldRolls.find((entry) => entry.key === key);
  if (!held) return undefined;
  if (turnScoped(key) && (held.round !== state.combat.round || held.turnActorId !== state.combat.turnActorId))
    return undefined;
  return held;
}

/** Holds a roll's dice under its key, replacing an earlier hold of the same key; the oldest go once the list is full. */
export function holdRoll(
  state: GameState,
  held: Omit<HeldRoll, "round" | "turnActorId" | "createdAt" | "rollId" | "typed" | "others"> &
    Partial<Pick<HeldRoll, "rollId" | "typed" | "others">>
): void {
  const entry: HeldRoll = {
    rollId: null,
    typed: false,
    others: [],
    ...held,
    round: state.combat.round,
    turnActorId: state.combat.turnActorId,
    createdAt: Date.now()
  };
  const others = state.heldRolls.filter((candidate) => candidate.key !== held.key);
  state.heldRolls = [...others, entry].slice(-HELD_LIMIT);
}

export function releaseHeldRoll(state: GameState, key: string): void {
  if (state.heldRolls.some((entry) => entry.key === key))
    state.heldRolls = state.heldRolls.filter((entry) => entry.key !== key);
}

const SERVER_ROLLS = "At this table the server rolls players' dice. Tap Roll instead of typing a die.";

/** Refuses a typed die the table doesn't take: a player's, while the table has the server throw players' dice, or one
 *  typed over a die the server already threw for this roll. The GM may always type. */
export function requireTypedDie(state: GameState, scope: Initiator, held: HeldRoll | undefined, face: number): void {
  if (scope.role === "gm") return;
  if (state.builderPolicy.typedRolls !== "open") throw new CommandRejectedError(SERVER_ROLLS);
  if (held && !(held.typed && held.faces.length === 1 && held.faces[0] === face))
    throw new CommandRejectedError(
      "This roll's die is already thrown. Confirm it, or use Heroic Inspiration to reroll it."
    );
}

/** A reroll typed from a physical die must reroll a typed die: a die the server threw is rethrown by the server, or a
 *  player could pick the face after seeing the first. The GM may type any reroll. */
export function requireTypedReroll(state: GameState, scope: Initiator, held: HeldRoll | undefined): void {
  if (!held) throw new CommandRejectedError("Roll first: a reroll throws again a die that was thrown.");
  if (scope.role === "gm") return;
  if (state.builderPolicy.typedRolls !== "open") throw new CommandRejectedError(SERVER_ROLLS);
  if (!held.typed)
    throw new CommandRejectedError("The server threw this die, so it throws the reroll too. Reroll without typing.");
}

/** A player's reroll spends their Heroic Inspiration; the GM rerolls freely. */
export function spendRerollRight(actor: Actor, scope: Initiator): void {
  if (scope.role === "gm") return;
  if (!actor.heroicInspiration)
    throw new CommandRejectedError(`${actor.name} has no Heroic Inspiration to reroll the die with.`);
  actor.heroicInspiration = false;
}

/** The d20s a held roll uses under `mode`: the held ones (topped up when the mode now needs two), or fresh ones. A
 *  reroll throws one die again for a player (the lowest, Heroic Inspiration) and all of them for the GM. `thrown` says
 *  whether any die is new, so a second look that changes nothing records nothing. */
export function heldD20s(
  held: HeldRoll | undefined,
  mode: "advantage" | "disadvantage" | "normal",
  random: RandomSource,
  reroll: "none" | "one" | "all" = "none"
): { faces: number[]; thrown: boolean } {
  const kept = reroll === "all" ? [] : (held?.faces ?? []);
  const topped = d20FacesFor(mode, kept, random);
  const faces = reroll === "one" ? rerollLowestD20(topped, random) : topped;
  return { faces, thrown: reroll !== "none" || faces.length !== kept.length };
}

type RollMode = "advantage" | "disadvantage" | "normal";

/** One d20 test as the dice authority settles it (see `rollHeldTest`). */
export type HeldTest = Readonly<{
  faces: number[];
  /** The mode the faces are read under: a typed die is the one that counts, so it reads as one d20. */
  mode: RollMode;
  natural: number;
  resolution: DiceResolution;
  /** New dice were thrown or typed, so the roll is recorded again; a second look at held dice records nothing. */
  fresh: boolean;
  typed: boolean;
}>;

/**
 * A d20 test that may be looked at before it counts (a save, a death save, a check Heroic Inspiration may reroll):
 * the dice held under `key` are reused, a typed face must be one the table takes, and a reroll spends a player's
 * Heroic Inspiration or is the GM's free throw. `tail` is the formula after the d20s (" + 5 + 1d4").
 */
export function rollHeldTest(
  state: GameState,
  key: string,
  actor: Actor,
  scope: Initiator,
  mode: RollMode,
  modifier: number,
  diceTerms: string,
  options: Readonly<{ face?: number; reroll?: boolean }>,
  random: RandomSource
): HeldTest {
  const held = heldRollFor(state, key);
  const resolveFor = (faces: readonly number[], readAs: RollMode, others: HeldRoll["others"]) =>
    resolveWithD20s(d20TestFormula(readAs, modifier) + diceTerms, faces, random, others);
  if (options.face !== undefined) {
    const face = options.face;
    if (options.reroll) {
      requireTypedReroll(state, scope, held);
      spendRerollRight(actor, scope);
    } else requireTypedDie(state, scope, held, face);
    const same = !options.reroll && held?.typed === true && held.faces[0] === face;
    return {
      faces: [face],
      mode: "normal",
      natural: face,
      resolution: resolveFor([face], "normal", held?.others ?? []),
      fresh: !same,
      typed: true
    };
  }
  // A typed die stands until a typed reroll replaces it; only the GM may have the server throw over it.
  if (held?.typed && !(options.reroll && scope.role === "gm")) {
    if (options.reroll) throw new CommandRejectedError("Type the die your reroll shows.");
    return {
      faces: held.faces,
      mode: "normal",
      natural: held.faces[0],
      resolution: resolveFor(held.faces, "normal", held.others),
      fresh: false,
      typed: true
    };
  }
  let reroll: "none" | "one" | "all" = "none";
  if (options.reroll) {
    if (!held) throw new CommandRejectedError("Roll first: a reroll throws again a die that was thrown.");
    spendRerollRight(actor, scope);
    reroll = scope.role === "gm" ? "all" : "one";
  }
  const { faces, thrown } = heldD20s(held, mode, random, reroll);
  // The GM's throw starts over; Heroic Inspiration rerolls one d20 and keeps the rest.
  const others = reroll === "all" ? [] : (held?.others ?? []);
  return {
    faces,
    mode,
    natural: keptD20(faces, mode),
    resolution: resolveFor(faces, mode, others),
    fresh: thrown,
    typed: false
  };
}
