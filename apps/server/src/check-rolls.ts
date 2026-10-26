import { checkSightFor } from "./vision/rules.js";
import type {
  Actor,
  ActorDerivedSheet,
  CheckRollOutcome,
  GameState,
  HeldRoll,
  RollCall,
  RollRecord,
  RollVisibility
} from "@vtt/domain";
import { d20FacesFor, otherDiceOf, rerollLowestD20, type RandomSource } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import {
  checkPlan,
  type CheckNames,
  type CheckPlan,
  type CheckSubject,
  type CheckVersus,
  totalCheck
} from "./ability-checks.js";
import { creatureTypeOf } from "./statblock-facts.js";
import { endUsedHelp, settleUseOutcome, useHelp } from "./help-assist.js";
import {
  canPlayerTarget,
  GameAccessDeniedError,
  requireActorAccess,
  requireGm,
  type Initiator
} from "./authorization.js";
import { deriveEquipment, type EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError } from "./game-store.js";
import { wardedConditions } from "./paladin-auras.js";
import { heldRollFor, holdRoll, requireTypedDie, requireTypedReroll, spendRerollRight } from "./held-rolls.js";
import type { EffectNarration } from "./effects.js";
import {
  answeredLines,
  answeredRead,
  answerKeyOf,
  answersFromOthers,
  answersOffered,
  applyRollAnswer,
  askAnswer,
  type AnswerDeps,
  type AnswerTarget
} from "./roll-answers.js";
import { recordRoll, rolledTerms } from "./roll-history.js";
import { createPendingSaves, dismissSave, recordCallResult, shownRollMode } from "./saving-throws.js";

/**
 * Ability checks rolled on the server (SRD "Ability Checks"): from the sheet, for the GM's call for a roll, and their
 * Heroic Inspiration reroll. The plan (`checkPlan`) works out the bonus and the Advantage or Disadvantage; this module
 * throws or takes the d20, records it, and holds it so Heroic Inspiration can reroll it while it is the character's
 * latest roll.
 */

export type CheckRollDependencies = Readonly<{
  /** The command the roll belongs to, so an answer's own dice are recorded under it. */
  commandId?: string;
  random: RandomSource;
  newId: () => string;
  sessionId: string;
  now: () => string;
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  names?: CheckNames;
  /** Creatures hidden from a player by sight or the fog. */
  unseen?: ReadonlySet<string>;
  /** Where creatures stand, for an ally's aura around the roller; absent, only the roller's own aura is known. */
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
}>;

export type CheckRollInput = Readonly<{
  commandId: string;
  actorId: string;
  subject: CheckSubject;
  dc: number | null;
  visibility: RollVisibility;
  /** A typed d20, the face a physical die shows. */
  face?: number;
  /** The GM's choice of roll mode; a player's is never passed. */
  forcedMode?: "advantage" | "disadvantage" | "normal";
  findActorId?: string;
  /** The GM's call this check answers. */
  callId?: string;
  /** The situations the roller says the check fits (a Book's topic, prying with a Crowbar). */
  situations?: readonly string[];
  /** The name a tool's or gear's Utilize use rolls under ("Pick a lock (Thieves' Tools)"). */
  label?: string;
  /** What the use leaves on a creature while the check succeeds (Cobbler's Tools' footwear). */
  onSuccess?: NonNullable<HeldRoll["check"]>["onSuccess"];
}>;

/** A check as it was rolled, and whether its numbers are kept from the one who rolled it (a blind roll), with what
 *  it set off (another creature asked to answer it, an effect an answer ended). */
export type CheckResult = Readonly<{
  outcome: CheckRollOutcome;
  hiddenFromRoller: boolean;
  events?: readonly EffectNarration[];
}>;

const checkKey = (actorId: string) => `check:${actorId}`;

/** Who sees a check: a player can't roll GM-only, and a hidden creature's roll is always the GM's, or it would reveal
 *  the creature. */
function checkVisibility(state: GameState, scope: Initiator, actorId: string, asked: RollVisibility): RollVisibility {
  if (asked === "gm-only" && scope.role !== "gm")
    throw new GameAccessDeniedError("Only the GM can make a GM-only roll.");
  const hidden = state.actors.some((actor) => actor.id === actorId && actor.visibility !== "public");
  return hidden ? "gm-only" : asked;
}

/** The other party of a check about a creature, as a social check reads it (its type for Perfume, how far away). */
function versusOf(actor: Actor, other: Actor, deps: CheckRollDependencies): CheckVersus {
  const definition = other.definitionId ? deps.resolveDefinition(other.definitionId) : undefined;
  return {
    actor: other,
    humanoid: creatureTypeOf(other, definition, "true") === "humanoid",
    feet: deps.distanceFeet?.(actor.id, other.id) ?? null
  };
}

function planFor(state: GameState, scope: Initiator, input: CheckRollInput, deps: CheckRollDependencies) {
  const actor = state.actors.find((candidate) => candidate.id === input.actorId);
  if (!actor) throw new CommandRejectedError("That character no longer exists.");
  requireActorAccess(scope, state, actor.id, "check", "You can only roll for your own character.");
  const definition = actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
  const derivation = deriveEquipment(actor, definition, deps.catalog);
  // A player names only a creature they can see; a hidden one would answer whether it carries their mark.
  const finding =
    input.findActorId !== undefined && (scope.role === "gm" || canPlayerTarget(state, input.findActorId, deps.unseen))
      ? state.actors.find((candidate) => candidate.id === input.findActorId)
      : undefined;
  const warded = wardedConditions(state, actor, {
    resolveDefinition: deps.resolveDefinition,
    ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {}),
    ...(deps.catalog ? { catalog: deps.catalog } : {})
  });
  const plan = checkPlan(actor, definition, derivation, input.subject, {
    ...(deps.names ? { names: deps.names } : {}),
    ...(finding ? { finding, versus: versusOf(actor, finding, deps) } : {}),
    ...(warded.length > 0 ? { warded } : {}),
    ...(input.situations !== undefined && input.situations.length > 0 ? { situations: input.situations } : {}),
    // Frightened's line of sight, the light the roller stands in, and how obscured the creature it seeks is.
    sight: checkSightFor(
      state,
      actor,
      { definition: deps.resolveDefinition, ...(deps.catalog ? { catalog: deps.catalog } : {}) },
      finding,
      deps.distanceFeet
    )
  });
  return { actor, plan };
}

/** Records a check roll and holds its dice for a Heroic Inspiration reroll or an answer. A fresh check starts with no
 *  answers; a reroll keeps what answered the roll before it (a Bardic Inspiration die stays added). */
function recordCheck(
  state: GameState,
  scope: Initiator,
  input: CheckRollInput,
  deps: CheckRollDependencies,
  plan: CheckPlan,
  faces: readonly number[],
  readAs: "advantage" | "disadvantage" | "normal",
  typed: boolean,
  options: Readonly<{ label?: string; others?: ReturnType<typeof otherDiceOf>; fresh?: boolean }>
): CheckResult {
  const actor = state.actors.find((candidate) => candidate.id === input.actorId)!;
  const roll = totalCheck(plan, faces, readAs, deps.random, options.others ?? []);
  const visibility = checkVisibility(state, scope, actor.id, input.visibility);
  const rollId = deps.newId();
  const label = `${options.label ?? input.label ?? plan.label}${roll.reliableTalent ? " (Reliable Talent)" : ""}${roll.raisedBy ? ` (${roll.raisedBy})` : ""}`;
  const record: RollRecord = {
    id: rollId,
    commandId: input.commandId,
    initiatorSessionId: deps.sessionId,
    initiatorRole: scope.role,
    initiatorLabel: actor.name,
    label: label.slice(0, 80),
    actorId: actor.id,
    purpose: "check",
    visibility,
    formula: roll.resolution.expression.source,
    normalizedFormula: roll.resolution.expression.normalized,
    ...rolledTerms(roll.resolution),
    total: roll.total,
    ...(typed ? { typed: true as const } : {}),
    createdAt: deps.now()
  };
  recordRoll(state, record);
  holdRoll(state, {
    key: checkKey(actor.id),
    actorId: actor.id,
    faces: [...faces],
    others: otherDiceOf(roll.resolution),
    rollId,
    typed,
    ...(options.fresh === true ? { answers: [] } : {}),
    check: {
      subject: { ...input.subject },
      dc: input.dc,
      visibility: input.visibility,
      ...(!typed && input.forcedMode !== undefined ? { rollMode: input.forcedMode } : {}),
      ...(input.callId !== undefined ? { callId: input.callId } : {}),
      ...(input.findActorId !== undefined ? { findActorId: input.findActorId } : {}),
      ...(input.situations !== undefined && input.situations.length > 0 ? { situations: [...input.situations] } : {}),
      ...(input.label !== undefined ? { label: input.label.slice(0, 80) } : {}),
      ...(input.onSuccess !== undefined ? { onSuccess: { ...input.onSuccess } } : {})
    }
  });
  return heldCheckResult(state, scope, actor, plan, typed ? "normal" : readAs, deps, input.commandId);
}

/** The latest check as its held dice and answers make it: written to the GM's call it answers, and told with the
 *  answers the roller may still give it. */
function heldCheckResult(
  state: GameState,
  scope: Initiator,
  actor: Actor,
  plan: CheckPlan,
  readAs: "advantage" | "disadvantage" | "normal",
  deps: CheckRollDependencies,
  commandId: string
): CheckResult {
  const held = heldRollFor(state, checkKey(actor.id))!;
  const check = held.check!;
  const roll = answeredCheck(plan, held, readAs, deps.random);
  // A check that needs sight the roller hasn't fails whatever it rolls.
  const success = plan.autoFails !== undefined ? false : check.dc === null ? null : roll.total >= check.dc;
  const rollId = held.rollId!;
  if (check.callId !== undefined)
    recordCallResult(state, check.callId, actor.id, { natural: roll.natural, total: roll.total, success, rollId });
  // What a tool's use leaves holds while its check succeeds, so a reroll or an answer settles it again.
  const settled = check.onSuccess ? settleUseOutcome(state, actor, check.onSuccess, success === true) : [];
  // A typed die was thrown under the mode the rules gave, which the player was told before rolling.
  const rollMode = shownRollMode(plan.rollMode, held.typed ? undefined : check.rollMode);
  const answered = answeredLines(held);
  const offered = answersOffered(state, checkTarget(actor, held, plan, readAs, roll), checkAnswerDeps(scope, deps));
  const visibility = checkVisibility(state, scope, actor.id, check.visibility);
  const events = askCheckAnswers(
    state,
    scope,
    actor,
    held,
    checkTarget(actor, held, plan, readAs, roll),
    deps,
    commandId
  );
  const told = [...settled, ...events];
  return {
    ...(told.length > 0 ? { events: told } : {}),
    outcome: {
      label: check.label ?? plan.label,
      natural: roll.natural,
      total: roll.total,
      dc: check.dc,
      success,
      ...(rollMode ? { rollMode } : {}),
      ...(roll.reliableTalent ? { reliableTalent: true as const } : {}),
      ...(plan.autoFails !== undefined ? { autoFailed: plan.autoFails } : {}),
      ...(held.typed ? { typed: true as const } : {}),
      ...(answered.length > 0 ? { answered } : {}),
      ...(offered.length > 0 ? { answers: offered } : {}),
      rollId
    },
    hiddenFromRoller: visibility === "blind" && scope.role !== "gm"
  };
}

/**
 * Others' answers to a character's latest check once it is shown (Cutting Words on a success, Improve Fate, a sphinx's
 * Burst of Ingenuity), asked one at a time in turn order, each creature once. The check has counted already, so an
 * answer amends it, and the GM's call it answers.
 */
function askCheckAnswers(
  state: GameState,
  scope: Initiator,
  actor: Actor,
  held: HeldRoll,
  target: AnswerTarget,
  deps: CheckRollDependencies,
  commandId: string
): EffectNarration[] {
  if (!state.combat.active) return [];
  const waiting = state.combat.pendingReactions.some(
    (prompt) => prompt.kind === "roll-answer" && prompt.rollKind === "check" && prompt.sourceActorId === actor.id
  );
  if (waiting) return [];
  const asked = held.asked ?? [];
  const next = answersFromOthers(state, target, checkAnswerDeps(scope, { ...deps, commandId }), new Set(asked))[0];
  if (!next) return [];
  const all = [...asked, answerKeyOf(next)];
  state.heldRolls = state.heldRolls.map((entry) => (entry.key === held.key ? { ...entry, asked: all } : entry));
  return [
    askAnswer(
      state,
      next,
      { rollKind: "check", roller: actor, targetActorId: null, asked: all },
      { newId: deps.newId, now: deps.now, commandId }
    )
  ];
}

/** A held check's numbers with its answers: a d20 an answer set is read alone, and what answers added is added. */
function answeredCheck(
  plan: CheckPlan,
  held: HeldRoll,
  readAs: "advantage" | "disadvantage" | "normal",
  random: RandomSource
) {
  const read = answeredRead(held);
  const roll =
    read.face !== null
      ? totalCheck(plan, [read.face], "normal", random, held.others)
      : totalCheck(plan, held.faces, held.readAs ?? readAs, random, held.others);
  return { ...roll, total: roll.total + read.bonus };
}

/** The latest check as an answer meets it. */
function checkTarget(
  actor: Actor,
  held: HeldRoll,
  plan: CheckPlan,
  readAs: "advantage" | "disadvantage" | "normal",
  roll: ReturnType<typeof answeredCheck>
): AnswerTarget {
  const check = held.check!;
  return {
    kind: "check",
    roller: actor,
    key: held.key,
    natural: roll.natural,
    total: roll.total,
    threshold: check.dc,
    mode: held.readAs ?? readAs,
    ability: check.subject.ability,
    purpose: "check",
    label: plan.label,
    visibility: check.visibility
  };
}

const checkAnswerDeps = (scope: Initiator, deps: CheckRollDependencies): AnswerDeps => ({
  resolveDefinition: deps.resolveDefinition,
  ...(deps.catalog ? { catalog: deps.catalog } : {}),
  random: deps.random,
  newRollId: deps.newId,
  sessionId: deps.sessionId,
  role: scope.role,
  now: deps.now,
  commandId: deps.commandId ?? deps.newId(),
  ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {})
});

/**
 * Answers a character's latest check with one of its answers (SRD: a Bardic Inspiration die "after seeing the roll",
 * Tactical Mind, the halfling's Luck), while that check is still the character's latest roll. The check's result and
 * the GM's call it answers are updated with the answered total.
 */
export function answerAbilityCheck(
  state: GameState,
  scope: Initiator,
  input: Readonly<{
    commandId: string;
    actorId: string;
    /** `by` names another creature answering through its prompt (Cutting Words); absent, the one who rolled. */
    answer: Readonly<{ id: string; subtract?: boolean; face?: number; by?: string }>;
  }>,
  deps: CheckRollDependencies
): CheckResult & Readonly<{ events: readonly EffectNarration[] }> {
  const actor = state.actors.find((candidate) => candidate.id === input.actorId);
  if (!actor) throw new CommandRejectedError("That character no longer exists.");
  requireActorAccess(scope, state, actor.id, "check", "You can only roll for your own character.");
  const held = heldRollFor(state, checkKey(actor.id));
  const latest = [...state.rolls].reverse().find((roll) => roll.actorId === actor.id);
  if (!held?.check || !latest || latest.id !== held.rollId)
    throw new CommandRejectedError(`${actor.name} has no check to answer: an answer comes right after the roll.`);
  const check = held.check;
  const rollInput: CheckRollInput = {
    commandId: input.commandId,
    actorId: actor.id,
    subject: check.subject,
    dc: check.dc,
    visibility: check.visibility,
    ...(check.rollMode !== undefined ? { forcedMode: check.rollMode } : {}),
    ...(check.findActorId !== undefined ? { findActorId: check.findActorId } : {}),
    ...(check.callId !== undefined ? { callId: check.callId } : {}),
    ...(check.situations !== undefined ? { situations: check.situations } : {}),
    ...(check.label !== undefined ? { label: check.label } : {}),
    ...(check.onSuccess !== undefined ? { onSuccess: check.onSuccess } : {})
  };
  const { plan } = planFor(state, scope, rollInput, deps);
  const readAs = held.typed ? "normal" : (check.rollMode ?? plan.rollMode.mode);
  const roll = answeredCheck(plan, held, readAs, deps.random);
  const bearer =
    input.answer.by === undefined ? actor : state.actors.find((candidate) => candidate.id === input.answer.by);
  if (!bearer) throw new CommandRejectedError("The creature answering the check is no longer here.");
  const events = applyRollAnswer(
    state,
    checkTarget(actor, held, plan, readAs, roll),
    bearer,
    input.answer,
    checkAnswerDeps(scope, { ...deps, commandId: input.commandId })
  );
  const result = heldCheckResult(state, scope, actor, plan, readAs, deps, input.commandId);
  return { ...result, events: [...events, ...(result.events ?? [])] };
}

/** A check that settles something on the spot (first aid, reading a scroll), rolled once with its plan's bonus and
 *  Advantage or Disadvantage and recorded. Nothing holds it for a reroll: what it decided has already happened. */
export function rollSettledCheck(
  state: GameState,
  actor: Actor,
  plan: CheckPlan,
  record: Readonly<{
    id: string;
    commandId: string;
    sessionId: string;
    role: "gm" | "player";
    label: string;
    visibility: RollVisibility;
    createdAt: string;
  }>,
  random: RandomSource
): Readonly<{ natural: number; total: number }> {
  const mode = plan.rollMode.mode;
  const roll = totalCheck(plan, d20FacesFor(mode, [], random), mode, random);
  recordRoll(state, {
    id: record.id,
    commandId: record.commandId,
    initiatorSessionId: record.sessionId,
    initiatorRole: record.role,
    initiatorLabel: actor.name,
    label:
      `${record.label}${roll.reliableTalent ? " (Reliable Talent)" : ""}${roll.raisedBy ? ` (${roll.raisedBy})` : ""}`.slice(
        0,
        80
      ),
    actorId: actor.id,
    purpose: "check",
    visibility: record.visibility,
    formula: roll.resolution.expression.source,
    normalizedFormula: roll.resolution.expression.normalized,
    ...rolledTerms(roll.resolution),
    total: roll.total,
    createdAt: record.createdAt
  });
  return { natural: roll.natural, total: roll.total };
}

/** Rolls one ability check on the server: the rules' bonus and Advantage or Disadvantage, the d20 thrown here or typed
 *  from a physical die (when the table lets players type theirs), recorded in the shared history. */
export function rollAbilityCheck(
  state: GameState,
  scope: Initiator,
  input: CheckRollInput,
  deps: CheckRollDependencies
): CheckResult {
  // A Help an earlier check used ends before this one is planned; a refused roll writes nothing.
  const roller = state.actors.find((candidate) => candidate.id === input.actorId);
  const ended = roller ? endUsedHelp(state, roller) : [];
  const { actor, plan } = planFor(state, scope, input, deps);
  const forced = scope.role === "gm" ? input.forcedMode : undefined;
  let result: CheckResult;
  if (input.face !== undefined) {
    requireTypedDie(state, scope, undefined, input.face);
    result = recordCheck(state, scope, { ...input, forcedMode: forced }, deps, plan, [input.face], "normal", true, {
      fresh: true
    });
  } else {
    const mode = forced ?? plan.rollMode.mode;
    const faces = d20FacesFor(mode, [], deps.random);
    result = recordCheck(state, scope, { ...input, forcedMode: forced }, deps, plan, faces, mode, false, {
      fresh: true
    });
  }
  // An ally's Help with this skill is used by this check; a reroll of it still has the Advantage.
  useHelp(state, actor, input.subject);
  return ended.length > 0 ? { ...result, events: [...ended, ...(result.events ?? [])] } : result;
}

/**
 * Rerolls one die of a character's latest check (SRD Heroic Inspiration: "reroll any die immediately after rolling
 * it"), so only while that check is still the character's latest roll. A player spends Heroic Inspiration and rerolls
 * the lowest d20 (or types the face a physical reroll shows); the GM throws the check again.
 */
export function rerollAbilityCheck(
  state: GameState,
  scope: Initiator,
  input: Readonly<{ commandId: string; actorId: string; face?: number }>,
  deps: CheckRollDependencies
): CheckResult {
  const actor = state.actors.find((candidate) => candidate.id === input.actorId);
  if (!actor) throw new CommandRejectedError("That character no longer exists.");
  requireActorAccess(scope, state, actor.id, "check", "You can only roll for your own character.");
  const held = heldRollFor(state, checkKey(actor.id));
  const latest = [...state.rolls].reverse().find((roll) => roll.actorId === actor.id);
  if (!held?.check || !latest || latest.id !== held.rollId)
    throw new CommandRejectedError(`${actor.name} has no check to reroll: a reroll comes right after the roll.`);
  const check = held.check;
  // A typed check is rerolled with a typed die and a thrown one by the server (the GM may do either).
  if (input.face !== undefined) requireTypedReroll(state, scope, held);
  else if (held.typed && scope.role !== "gm") throw new CommandRejectedError("Type the die your reroll shows.");
  spendRerollRight(actor, scope);
  const rollInput: CheckRollInput = {
    commandId: input.commandId,
    actorId: actor.id,
    subject: check.subject,
    dc: check.dc,
    visibility: check.visibility,
    ...(check.rollMode !== undefined ? { forcedMode: check.rollMode } : {}),
    ...(check.findActorId !== undefined ? { findActorId: check.findActorId } : {}),
    ...(check.callId !== undefined ? { callId: check.callId } : {}),
    ...(check.situations !== undefined ? { situations: check.situations } : {}),
    ...(check.label !== undefined ? { label: check.label } : {}),
    ...(check.onSuccess !== undefined ? { onSuccess: check.onSuccess } : {})
  };
  const { plan } = planFor(state, scope, rollInput, deps);
  const label = `${check.label ?? plan.label} reroll`;
  if (input.face !== undefined)
    return recordCheck(state, scope, rollInput, deps, plan, [input.face], "normal", true, {
      label,
      others: held.others
    });
  // The dice are read under the mode they were thrown with: the GM's, or the rules' now.
  const mode = check.rollMode ?? plan.rollMode.mode;
  // The GM throws the check again; Heroic Inspiration rerolls one die and keeps the rest.
  const faces =
    scope.role === "gm" || held.typed
      ? d20FacesFor(mode, [], deps.random)
      : rerollLowestD20(d20FacesFor(mode, held.faces, deps.random), deps.random);
  return recordCheck(state, scope, rollInput, deps, plan, faces, mode, false, {
    label,
    ...(scope.role === "gm" ? {} : { others: held.others })
  });
}

const MAX_CALLS = 20;

/** The GM calls for a check or a save from one or several characters. A save call opens a pending save for each, which
 *  they answer like any save; a check call is answered with `answerRollCall`. */
export function startRollCall(
  state: GameState,
  input: Readonly<{
    id: string;
    kind: RollCall["kind"];
    subject: CheckSubject;
    dc: number | null;
    actorIds: readonly string[];
    blind: boolean;
  }>,
  deps: Readonly<{
    newId: () => string;
    now: () => number;
    /** The situations a character's gear names for its checks (`check-situations.ts`). */
    situationsOf?: (actorId: string) => ReadonlyArray<ActorDerivedSheet["situations"][number]>;
  }>
): RollCall {
  if (state.rollCalls.length >= MAX_CALLS)
    throw new CommandRejectedError("Close an earlier call for a roll before starting another.");
  for (const actorId of input.actorIds) {
    const actor = state.actors.find((candidate) => candidate.id === actorId);
    if (!actor || actor.archived) throw new CommandRejectedError("Every character you call on must be on the roster.");
  }
  if (input.kind === "save" && input.dc === null) throw new CommandRejectedError("A saving throw needs a DC.");
  // A check's card offers the situations each character's gear names that fit it.
  const fitting = (actorId: string) =>
    (deps.situationsOf?.(actorId) ?? [])
      .filter(
        (entry) =>
          (entry.abilities.length === 0 || entry.abilities.includes(input.subject.ability)) &&
          (entry.skills.length === 0 ||
            (input.subject.skill !== undefined && entry.skills.includes(input.subject.skill)))
      )
      .slice(0, 6)
      .map((entry) => ({ situation: entry.situation, effect: entry.effect, source: entry.source }));
  const entries = input.actorIds.map((actorId) => {
    const situations = input.kind === "check" ? fitting(actorId) : [];
    return {
      actorId,
      ...(input.kind === "save" ? { saveId: deps.newId() } : {}),
      ...(situations.length > 0 ? { situations } : {})
    };
  });
  if (input.kind === "save") {
    // The saves are made in target order, so each takes the id its call entry holds.
    const saveIds = entries.map((entry) => entry.saveId!);
    createPendingSaves(state, {
      sourceActorId: null,
      sourceName: "The GM",
      actionName: "Called save",
      ability: input.subject.ability,
      dc: input.dc!,
      targetIds: input.actorIds,
      proposedDamage: 0,
      halfOnSuccess: false,
      conditionIds: [],
      replaceExisting: false,
      callId: input.id,
      newSaveId: () => saveIds.shift()!,
      createdAt: deps.now()
    });
  }
  const call: RollCall = {
    id: input.id,
    kind: input.kind,
    subject: { ...input.subject },
    dc: input.dc,
    blind: input.blind,
    entries,
    createdAt: deps.now()
  };
  state.rollCalls = [...state.rollCalls, call];
  return call;
}

/** A character answers the GM's check call: the server rolls it (or takes a typed d20), once. */
export function answerRollCall(
  state: GameState,
  scope: Initiator,
  input: Readonly<{
    commandId: string;
    callId: string;
    actorId: string;
    face?: number;
    situations?: readonly string[];
  }>,
  deps: CheckRollDependencies
): CheckResult {
  const call = state.rollCalls.find((candidate) => candidate.id === input.callId);
  if (!call) throw new CommandRejectedError("That call for a roll was closed.");
  const entry = call.entries.find((candidate) => candidate.actorId === input.actorId);
  // Same answer for a character the call doesn't name and one that isn't theirs, so ids can't be probed.
  requireActorAccess(scope, state, input.actorId, "check", "You can only roll for your own character.");
  if (!entry) throw new CommandRejectedError("This call doesn't ask that character for a roll.");
  if (call.kind === "save") throw new CommandRejectedError("Answer the saving throw itself.");
  if (entry.result) throw new CommandRejectedError("That character has already rolled for this call.");
  // A blind call is the GM's: a player rolls blind, and the GM's own roll for them stays GM-only.
  const visibility: RollVisibility = call.blind ? (scope.role === "gm" ? "gm-only" : "blind") : "public";
  // Only the situations the card offered for the character.
  const offered = new Set((entry.situations ?? []).map((one) => one.situation));
  const situations = (input.situations ?? []).filter((one) => offered.has(one));
  return rollAbilityCheck(
    state,
    scope,
    {
      commandId: input.commandId,
      actorId: input.actorId,
      subject: call.subject,
      dc: call.dc,
      visibility,
      callId: call.id,
      ...(input.face !== undefined ? { face: input.face } : {}),
      ...(situations.length > 0 ? { situations } : {})
    },
    deps
  );
}

/** The GM closes a call; the saves it opened that nobody answered are dismissed. */
export function closeRollCall(state: GameState, scope: Initiator, callId: string): void {
  requireGm(scope, "Only the GM can close a call for a roll.");
  const call = state.rollCalls.find((candidate) => candidate.id === callId);
  if (!call) throw new CommandRejectedError("That call for a roll was already closed.");
  for (const entry of call.entries)
    if (entry.saveId && state.combat.pendingSaves.some((save) => save.id === entry.saveId))
      dismissSave(state, entry.saveId, scope);
  state.rollCalls = state.rollCalls.filter((candidate) => candidate.id !== callId);
}
