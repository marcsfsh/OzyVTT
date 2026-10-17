import type { GameState, RollRecord } from "@vtt/domain";
import type { ActorDefinition, CharacterChoice } from "@vtt/schemas";
import {
  ABILITIES,
  ABILITY_ROLL_FORMULA,
  hitDieFaces,
  parseDiceFormula,
  resolveDice,
  type HitDie
} from "@vtt/rules-5e";
import { storedAbilityScores, type CharacterCreateRequestInput } from "./character-build.js";
import { storedClassSequence } from "./character-offers.js";
import { CommandRejectedError } from "./game-store.js";
import { recordRoll } from "./roll-history.js";

/**
 * The dice a character create or rebuild carries, settled before the build: hit points the server is asked to
 * roll are thrown here (a rebuild reuses the rolls its sheet recorded), and while the table keeps players' dice on
 * the server (`builderPolicy.typedRolls`), a player's rolled scores must be a `builder.roll-abilities` roll of
 * theirs and their hit points the recorded or server-thrown ones. The GM may always type physical dice.
 */

/** The label `builder.roll-abilities` records its roll under, which the check below looks for. */
export const ABILITY_ROLL_LABEL = "Ability scores";

/** A create or rebuild as it arrives: `hp.mode` may still ask the server to roll. */
export type BuilderDiceRequest = Omit<CharacterCreateRequestInput, "hp"> &
  Readonly<{
    hp: Readonly<{ mode: "average" | "entries" | "roll"; entries?: readonly number[] }>;
    abilityRollId?: string;
  }>;

export type BuilderDiceContext = Readonly<{
  /** The GM (or a GM-grade credential) may type dice whatever the policy says. */
  gm: boolean;
  sessionId: string;
  /** The sheet being rebuilt, whose recorded rolls and ability scores a rebuild may re-send. */
  previous: ActorDefinition | undefined;
  /** A class's hit die, or null when the class is unknown (the build then refuses it). */
  hitDieOf: (classId: string) => HitDie | null;
  /** Whether these are the base scores the previous sheet's own totals imply, for a sheet that recorded none. */
  derivedScoresMatch?: (request: BuilderDiceRequest) => boolean;
  random: (sides: number) => number;
}>;

/** One hit-point die the server threw for a level, at that level's class die. */
export type ThrownHitPointDie = Readonly<{ faces: number; roll: number }>;

function reject(message: string): never {
  throw new CommandRejectedError(message);
}

/** The class each level of a request goes to (its build checks the list itself). */
const sequenceOf = (request: Pick<CharacterCreateRequestInput, "classId" | "level" | "classLevels">) =>
  request.classLevels ?? Array.from({ length: request.level }, () => request.classId);

/**
 * The rolls a stored sheet recorded, by level, where the level still goes to the class each was rolled for: a respec
 * into another class there rolls afresh. A single-class sheet's rows name no class; they are its class's.
 */
function storedRolls(previous: ActorDefinition | undefined, sequence: readonly string[]): Map<number, number> {
  const ledger: readonly CharacterChoice[] = previous?.character?.choices ?? [];
  const previousSequence = storedClassSequence(ledger);
  const previousClass = previous?.character?.classes?.[0]?.id;
  const stored = new Map<number, number>();
  for (const row of ledger) {
    const roll = row.payload?.roll;
    if (row.kind !== "hp-roll" || typeof roll !== "number" || !Number.isInteger(roll) || roll < 1) continue;
    const rolledFor = row.classId ?? previousSequence?.[row.level - 1] ?? previousClass;
    if (rolledFor !== undefined && rolledFor === sequence[row.level - 1]) stored.set(row.level, roll);
  }
  return stored;
}

/** The build input with its hit points settled, and the dice the server threw for them (levels in order). */
export function settleBuilderDice(
  state: GameState,
  request: BuilderDiceRequest,
  context: BuilderDiceContext
): { input: CharacterCreateRequestInput; thrown: readonly ThrownHitPointDie[] } {
  const { abilityRollId: _rollId, hp, ...rest } = request;
  const ledger: readonly CharacterChoice[] = context.previous?.character?.choices ?? [];
  const sequence = sequenceOf(request);
  const stored = storedRolls(context.previous, sequence);
  // A rebuild re-sending the values its sheet recorded (or, for a sheet that recorded none, the ones its totals imply)
  // keeps their method, whatever the table allows today.
  const keepsRecordedScores =
    sendsRecordedScores(request, ledger) ||
    (storedAbilityScores(ledger) === null && context.derivedScoresMatch?.(request) === true);

  if (!context.gm && state.builderPolicy.typedRolls !== "open") {
    if (!keepsRecordedScores) requireServerAbilityRoll(state, request, context);
    if (hp.mode === "entries")
      (hp.entries ?? []).forEach((entry, index) => {
        if (stored.get(index + 2) !== entry)
          reject(`Your GM has the table roll hit points: choose "Roll on the table" for level ${index + 2}.`);
      });
  }

  const base = { ...rest, ...(keepsRecordedScores ? { keepsRecordedScores } : {}) };
  const dice = sequence.map((classId) => context.hitDieOf(classId));
  if (hp.mode !== "roll" || dice.some((die) => die === null)) {
    return {
      input: { ...base, hp: hp.mode === "roll" ? { mode: "average" } : (hp as CharacterCreateRequestInput["hp"]) },
      thrown: []
    };
  }
  const thrown: ThrownHitPointDie[] = [];
  const entries = dice.slice(1).map((die, index) => {
    const faces = hitDieFaces(die!);
    const recorded = stored.get(index + 2);
    if (recorded !== undefined && recorded <= faces) return recorded;
    const roll = context.random(faces);
    thrown.push({ faces, roll });
    return roll;
  });
  return { input: { ...base, hp: { mode: "entries", entries } }, thrown };
}

/** Rolled scores a player sends must be the six totals of their own server roll. */
function requireServerAbilityRoll(state: GameState, request: BuilderDiceRequest, context: BuilderDiceContext): void {
  if (request.abilityMethod !== "roll" && request.abilityMethod !== "custom") return;
  const formula =
    request.abilityMethod === "custom"
      ? (state.builderPolicy.customFormula ?? ABILITY_ROLL_FORMULA)
      : ABILITY_ROLL_FORMULA;
  if (!request.abilityRollId) reject("Your GM has the table roll ability scores. Roll them in the builder.");
  const record = state.rolls.find((roll) => roll.id === request.abilityRollId);
  if (!record || record.label !== ABILITY_ROLL_LABEL || record.initiatorSessionId !== context.sessionId)
    reject("That ability roll is no longer in the table's recent rolls. Roll the scores again.");
  if (record.normalizedFormula !== `6 x ${formula}`)
    reject("That ability roll used a different formula from the table's. Roll the scores again.");
  if (
    sortedValues(abilityRollTotals(record, formula)) !==
    sortedValues(ABILITIES.map((ability) => request.baseScores[ability]))
  )
    reject("Those scores are not the six the table rolled. Assign the rolled values.");
}

const sortedValues = (values: readonly number[]) => [...values].sort((left, right) => left - right).join(",");

/** Whether a rebuild sends the six values its sheet recorded, under the same method, in any order: reassigning the
 *  same six is a respec and no new roll. */
function sendsRecordedScores(request: BuilderDiceRequest, ledger: readonly CharacterChoice[]): boolean {
  const recorded = storedAbilityScores(ledger);
  return (
    recorded !== null &&
    recorded.abilityMethod === request.abilityMethod &&
    sortedValues(ABILITIES.map((ability) => recorded.baseScores[ability])) ===
      sortedValues(ABILITIES.map((ability) => request.baseScores[ability]))
  );
}

/** The six totals of an ability roll, replayed from its recorded faces (one group per score). */
export function abilityRollTotals(record: RollRecord, formula: string): number[] {
  const expression = parseDiceFormula(formula);
  return Array.from({ length: 6 }, (_, group) => {
    const faces = record.dice.filter((die) => die.group === group).map((die) => die.face);
    return resolveDice(expression, () => faces.shift() ?? 0).total;
  });
}

/** The hit-point dice a build threw, into the table feed like any roll: one group per die size ("2d10 + 1d6"). */
export function recordHitPointRoll(
  state: GameState,
  roll: Readonly<{
    id: string;
    commandId: string;
    sessionId: string;
    gm: boolean;
    actorId: string;
    label: string;
    dice: readonly ThrownHitPointDie[];
  }>
): void {
  if (roll.dice.length === 0) return;
  const sizes = [...new Set(roll.dice.map((die) => die.faces))];
  const formula = sizes.map((faces) => `${roll.dice.filter((die) => die.faces === faces).length}d${faces}`).join(" + ");
  recordRoll(state, {
    id: roll.id,
    commandId: roll.commandId,
    initiatorSessionId: roll.sessionId,
    initiatorRole: roll.gm ? "gm" : "player",
    initiatorLabel: roll.gm ? "GM" : "A player",
    label: roll.label,
    actorId: roll.actorId,
    // The builder's own roll, which a sheet's latest-roll line leaves out.
    purpose: "builder",
    visibility: "public",
    formula,
    normalizedFormula: formula,
    dice: roll.dice.map((die) => ({
      group: sizes.indexOf(die.faces),
      sides: die.faces,
      face: die.roll,
      kept: true,
      sign: 1 as const
    })),
    modifiers: [],
    total: roll.dice.reduce((sum, die) => sum + die.roll, 0),
    createdAt: new Date().toISOString()
  });
}
