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
  /** The class's hit die, or null when the class is unknown (the build then refuses it). */
  hitDie: HitDie | null;
  random: (sides: number) => number;
}>;

function reject(message: string): never {
  throw new CommandRejectedError(message);
}

/** The build input with its hit points settled, and the dice the server threw for them (levels in order). */
export function settleBuilderDice(
  state: GameState,
  request: BuilderDiceRequest,
  context: BuilderDiceContext
): { input: CharacterCreateRequestInput; thrown: readonly number[] } {
  const { abilityRollId: _rollId, hp, ...rest } = request;
  const ledger: readonly CharacterChoice[] = context.previous?.character?.choices ?? [];
  // A stored roll belongs to the class it was rolled for, so a respec into another class rolls afresh.
  const sameClass = context.previous?.character?.classes?.[0]?.id === request.classId;
  const stored = new Map<number, number>();
  if (sameClass)
    for (const row of ledger) {
      const roll = row.payload?.roll;
      if (row.kind === "hp-roll" && typeof roll === "number" && Number.isInteger(roll) && roll >= 1)
        stored.set(row.level, roll);
    }

  if (!context.gm && state.builderPolicy.typedRolls !== "open") {
    requireServerAbilityRoll(state, request, context, ledger);
    if (hp.mode === "entries")
      (hp.entries ?? []).forEach((entry, index) => {
        if (stored.get(index + 2) !== entry)
          reject(
            `Your GM has the table roll hit points: choose "Roll on the table" for level ${index + 2} instead of typing it.`
          );
      });
  }

  // A rebuild re-sending the values its sheet recorded keeps their method, whatever the table allows today.
  const keepsRecordedScores = sendsRecordedScores(request, ledger);
  const base = { ...rest, ...(keepsRecordedScores ? { keepsRecordedScores } : {}) };
  if (hp.mode !== "roll" || !context.hitDie) {
    return {
      input: { ...base, hp: hp.mode === "roll" ? { mode: "average" } : (hp as CharacterCreateRequestInput["hp"]) },
      thrown: []
    };
  }
  const faces = hitDieFaces(context.hitDie);
  const thrown: number[] = [];
  const entries = Array.from({ length: Math.max(0, request.level - 1) }, (_, index) => {
    const recorded = stored.get(index + 2);
    if (recorded !== undefined && recorded <= faces) return recorded;
    const roll = context.random(faces);
    thrown.push(roll);
    return roll;
  });
  return { input: { ...base, hp: { mode: "entries", entries } }, thrown };
}

/** Rolled scores a player sends must be the six totals of their own server roll, unless a rebuild re-sends the
 *  values its sheet recorded (in any order: reassigning the same six is a respec, not a new roll). */
function requireServerAbilityRoll(
  state: GameState,
  request: BuilderDiceRequest,
  context: BuilderDiceContext,
  ledger: readonly CharacterChoice[]
): void {
  if (request.abilityMethod !== "roll" && request.abilityMethod !== "custom") return;
  if (sendsRecordedScores(request, ledger)) return;
  const formula =
    request.abilityMethod === "custom"
      ? (state.builderPolicy.customFormula ?? ABILITY_ROLL_FORMULA)
      : ABILITY_ROLL_FORMULA;
  if (!request.abilityRollId)
    reject("Your GM has the table roll ability scores: roll them in the builder rather than typing them.");
  const record = state.rolls.find((roll) => roll.id === request.abilityRollId);
  if (!record || record.label !== ABILITY_ROLL_LABEL || record.initiatorSessionId !== context.sessionId)
    reject("That ability roll is no longer in the table's recent rolls - roll the scores again.");
  if (record.normalizedFormula !== `6 x ${formula}`)
    reject("That ability roll used a different formula from the table's - roll the scores again.");
  if (
    sortedValues(abilityRollTotals(record, formula)) !==
    sortedValues(ABILITIES.map((ability) => request.baseScores[ability]))
  )
    reject("Those scores are not the six the table rolled - assign the rolled values.");
}

const sortedValues = (values: readonly number[]) => [...values].sort((left, right) => left - right).join(",");

/** Whether a rebuild sends the six values its sheet recorded, under the same method, in any order. */
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

/** The hit-point dice a build threw, into the table feed like any roll. */
export function recordHitPointRoll(
  state: GameState,
  roll: Readonly<{
    id: string;
    commandId: string;
    sessionId: string;
    gm: boolean;
    actorId: string;
    label: string;
    faces: number;
    rolls: readonly number[];
  }>
): void {
  if (roll.rolls.length === 0) return;
  recordRoll(state, {
    id: roll.id,
    commandId: roll.commandId,
    initiatorSessionId: roll.sessionId,
    initiatorRole: roll.gm ? "gm" : "player",
    initiatorLabel: roll.gm ? "GM" : "A player",
    label: roll.label,
    actorId: roll.actorId,
    purpose: "manual",
    visibility: "public",
    formula: `${roll.rolls.length}d${roll.faces}`,
    normalizedFormula: `${roll.rolls.length}d${roll.faces}`,
    dice: roll.rolls.map((face) => ({ group: 0, sides: roll.faces, face, kept: true, sign: 1 as const })),
    modifiers: [],
    total: roll.rolls.reduce((sum, face) => sum + face, 0),
    createdAt: new Date().toISOString()
  });
}
