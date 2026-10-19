import type { BuilderPolicy } from "@vtt/domain";
import { ABILITIES } from "@vtt/rules-5e";
import type { ActorDefinition, CharacterChoice } from "@vtt/schemas";
import type { CharacterCreateRequestInput } from "./character-build.js";
import {
  CLASS_CANTRIP_BUDGET,
  CLASS_SPELL_BUDGET,
  classBudgetKey,
  classSequenceOf,
  surveyForBuild,
  type ServerOfferSurvey
} from "./character-offers.js";
import type { ContentView } from "./content-library.js";
import { CommandRejectedError } from "./game-store.js";
import { buildRequestOf } from "./ledger-rechoice.js";

/**
 * What a player may change when levelling their own character. A level up adds the new level's picks and may replace
 * the earlier ones a feature says it can ("Whenever you gain a Bard level, you can replace one of your cantrips"):
 * those are the features' `replaces` clauses with `when: "level-up"`, each allowing its amount once per level gained in
 * its class. A level down takes picks off and adds none. Every other earlier pick, the identity and the ability scores
 * stay as they were; changing them is a respec, which is the GM's.
 */

const CODE = "level_up_limit";

function refuse(message: string): never {
  throw new CommandRejectedError(message, CODE);
}

/** One budget's answers: its display name and the ids taken, repeats kept. */
type Answers = Readonly<{ label: string; taken: readonly string[] }>;

/** Every answer a build gives, by offer key: the content's offers and each casting class's own cantrips and spells. */
function answersOf(survey: ServerOfferSurvey): Map<string, Answers> {
  const startingId = survey.classes[0]?.record.id ?? null;
  const answers = new Map<string, Answers>();
  for (const offer of survey.offers) {
    const known = answers.get(offer.key);
    answers.set(offer.key, { label: offer.label, taken: [...(known?.taken ?? []), ...offer.taken] });
  }
  for (const budget of survey.classSpells) {
    answers.set(classBudgetKey(CLASS_CANTRIP_BUDGET, budget.classId, startingId), {
      label: `${budget.className} cantrips`,
      taken: budget.cantripRows.map((row) => row.id)
    });
    answers.set(classBudgetKey(CLASS_SPELL_BUDGET, budget.classId, startingId), {
      label: `${budget.className} spells`,
      taken: budget.spellRows.map((row) => row.id)
    });
  }
  return answers;
}

/** What `from` holds that `minus` doesn't, repeats counted. */
function without(from: readonly string[], minus: readonly string[]): string[] {
  const left = [...minus];
  return from.filter((id) => {
    const at = left.indexOf(id);
    if (at < 0) return true;
    left.splice(at, 1);
    return false;
  });
}

/** How many of an offer's earlier answers this level up may replace, by group: a feature's own picks share one
 *  allowance ("one of the spells you chose for this feat"), clauses naming one `shares` share theirs ("one of your
 *  arcanum spells"), and a clause naming a class budget has its own. */
function replacementAllowances(
  survey: ServerOfferSurvey,
  gainedIn: (classId: string | null) => number
): Array<{ keys: Set<string>; amount: number }> {
  const startingId = survey.classes[0]?.record.id ?? null;
  const groups = new Map<string, { keys: Set<string>; amount: number }>();
  for (const { record, classId } of survey.granted) {
    for (const clause of record.replaces ?? []) {
      if (clause.when !== "level-up") continue;
      const key = classBudgetKey(clause.offer, classId, startingId);
      const own = clause.offer === `feature:${record.id}` || clause.offer.startsWith(`feature:${record.id}/`);
      const group = clause.shares
        ? `shared:${clause.shares}:${classId ?? ""}`
        : own
          ? `own:${record.id}:${classId ?? ""}`
          : `${record.id}:${key}`;
      const entry = groups.get(group) ?? { keys: new Set<string>(), amount: 0 };
      entry.keys.add(key);
      entry.amount = Math.max(entry.amount, clause.amount * gainedIn(classId));
      groups.set(group, entry);
    }
  }
  return [...groups.values()];
}

const scoresKey = (request: CharacterCreateRequestInput) =>
  JSON.stringify([
    request.abilityMethod,
    ABILITIES.map((ability) => request.baseScores[ability]),
    [...request.backgroundBonusAllocation].map((entry) => `${entry.ability}+${entry.amount}`).sort()
  ]);

/** Rows whose detail lives in the row itself (an ASI's increases, the kit taken, the size), as comparable strings. */
const detailRows = (choices: readonly CharacterChoice[]) =>
  choices
    .filter(
      (row) => (row.kind === "asi-or-feat" && row.id === "asi") || row.kind === "equipment" || row.kind === "size"
    )
    .map((row) =>
      JSON.stringify([row.kind, row.id, row.kind === "asi-or-feat" ? (row.payload?.increases ?? null) : null])
    );

/**
 * Refuses a player's rebuild of their own character that changes more than its level allows. `input` is the rebuild as
 * the server will build it (hit points settled).
 */
export function checkPlayerLevelChange(
  previous: ActorDefinition | undefined,
  input: CharacterCreateRequestInput,
  library: ContentView,
  policy: BuilderPolicy
): void {
  const name = previous?.name ?? "This character";
  const before = previous ? buildRequestOf(previous, library) : null;
  if (!before) refuse(`${name} wasn't made in the builder here, so only the GM can rebuild ${name}.`);
  const respec = `Ask the GM to change earlier picks.`;
  if (
    input.speciesId !== before.speciesId ||
    input.backgroundId !== before.backgroundId ||
    input.classId !== before.classId
  )
    refuse(`A level up keeps the species, background and first class. ${respec}`);
  if (scoresKey(input) !== scoresKey(before))
    refuse(`A level up keeps the ability scores ${name} was made with. ${respec}`);
  const kept = Math.min(before.level, input.level);
  const oldSequence = classSequenceOf(before);
  const newSequence = classSequenceOf(input);
  if (oldSequence.slice(0, kept).join() !== newSequence.slice(0, kept).join())
    refuse(`A level up keeps the class each earlier level went to. ${respec}`);
  const oldRolls = before.hp.mode === "entries" ? (before.hp.entries ?? []) : null;
  const newRolls = input.hp.mode === "entries" ? (input.hp.entries ?? []) : null;
  if (
    (oldRolls === null) !== (newRolls === null) ||
    (oldRolls !== null && oldRolls.slice(0, kept - 1).join() !== newRolls!.slice(0, kept - 1).join())
  )
    refuse(`A level up keeps the hit points of the levels ${name} already has. ${respec}`);

  let oldSurvey: ServerOfferSurvey;
  try {
    oldSurvey = surveyForBuild(before, library, policy);
  } catch (error) {
    if (!(error instanceof CommandRejectedError)) throw error;
    refuse(`${name}'s earlier picks no longer fit the rules (${error.message}) Ask the GM to rebuild ${name}.`);
  }
  const newSurvey = surveyForBuild(input, library, policy);
  for (const entry of oldSurvey.classes) {
    const now = newSurvey.classes.find((candidate) => candidate.record.id === entry.record.id);
    if (now && entry.subclass && now.subclass?.id !== entry.subclass.id)
      refuse(`A level up keeps ${entry.record.name}'s ${entry.record.subclassLabel ?? "subclass"}. ${respec}`);
  }

  const oldAnswers = answersOf(oldSurvey);
  const newAnswers = answersOf(newSurvey);
  const oldDetail = detailRows(before.choices);
  const newDetail = detailRows(input.choices);
  if (input.level === before.level) {
    if (
      without(oldDetail, newDetail).length + without(newDetail, oldDetail).length > 0 ||
      changedAnyAnswer(oldAnswers, newAnswers) ||
      changedAnyAnswer(newAnswers, oldAnswers)
    )
      refuse(`Only the GM can change earlier picks without a level up.`);
    return;
  }
  if (input.level < before.level) {
    // A level down only takes picks off.
    for (const [key, answers] of newAnswers) {
      const added = without(answers.taken, oldAnswers.get(key)?.taken ?? []);
      if (added.length > 0) refuse(`${answers.label} changes only at a level up. ${respec}`);
    }
    if (without(newDetail, oldDetail).length > 0) refuse(`Only a level up adds picks. ${respec}`);
    return;
  }

  if (without(oldDetail, newDetail).length > 0)
    refuse(`A level up keeps the earlier Ability Score Improvements, starting equipment and size. ${respec}`);
  const levelsOf = (survey: ServerOfferSurvey, classId: string) =>
    survey.classes.find((entry) => entry.record.id === classId)?.level ?? 0;
  const gainedIn = (classId: string | null) =>
    classId === null ? input.level - before.level : levelsOf(newSurvey, classId) - levelsOf(oldSurvey, classId);
  const allowances = replacementAllowances(newSurvey, gainedIn);
  const replaced = new Map<string, number>();
  for (const [key, answers] of oldAnswers) {
    const removed = without(answers.taken, newAnswers.get(key)?.taken ?? []).length;
    if (removed === 0) continue;
    if (!allowances.some((allowance) => allowance.keys.has(key)))
      refuse(`${answers.label} can't be replaced at this level up. ${respec}`);
    replaced.set(key, removed);
  }
  for (const allowance of allowances) {
    const count = [...allowance.keys].reduce((total, key) => total + (replaced.get(key) ?? 0), 0);
    if (count <= allowance.amount) continue;
    const label = [...allowance.keys].map((key) => oldAnswers.get(key)?.label ?? key).join(" and ");
    refuse(`This level up may replace ${allowance.amount} of ${label}, and the rebuild replaces ${count}. ${respec}`);
  }
}

function changedAnyAnswer(before: Map<string, Answers>, after: Map<string, Answers>): boolean {
  return [...before].some(([key, answers]) => without(answers.taken, after.get(key)?.taken ?? []).length > 0);
}
