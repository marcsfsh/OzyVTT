import type { Actor, CheckRollOutcome, GameState, RollCall, RollRecord, RollVisibility } from "@vtt/domain";
import { d20FacesFor, otherDiceOf, rerollLowestD20, type RandomSource } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import { checkPlan, type CheckNames, type CheckPlan, type CheckSubject, totalCheck } from "./ability-checks.js";
import {
  canPlayerTarget,
  GameAccessDeniedError,
  requireActorAccess,
  requireGm,
  type Initiator
} from "./authorization.js";
import { deriveEquipment, type EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError } from "./game-store.js";
import { heldRollFor, holdRoll, requireTypedDie, requireTypedReroll, spendRerollRight } from "./held-rolls.js";
import { recordRoll, rolledTerms } from "./roll-history.js";
import { createPendingSaves, dismissSave, recordCallResult, shownRollMode } from "./saving-throws.js";

/**
 * Ability checks rolled on the server (SRD "Ability Checks"): from the sheet, for the GM's call for a roll, and their
 * Heroic Inspiration reroll. The plan (`checkPlan`) works out the bonus and the Advantage or Disadvantage; this module
 * throws or takes the d20, records it, and holds it so Heroic Inspiration can reroll it while it is the character's
 * latest roll.
 */

export type CheckRollDependencies = Readonly<{
  random: RandomSource;
  newId: () => string;
  sessionId: string;
  now: () => string;
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  names?: CheckNames;
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
}>;

/** A check as it was rolled, and whether its numbers are kept from the one who rolled it (a blind roll). */
export type CheckResult = Readonly<{ outcome: CheckRollOutcome; hiddenFromRoller: boolean }>;

const checkKey = (actorId: string) => `check:${actorId}`;

/** Who sees a check: a player can't roll GM-only, and a hidden creature's roll is always the GM's, or it would reveal
 *  the creature. */
function checkVisibility(state: GameState, scope: Initiator, actorId: string, asked: RollVisibility): RollVisibility {
  if (asked === "gm-only" && scope.role !== "gm")
    throw new GameAccessDeniedError("Only the GM can make a GM-only roll.");
  const hidden = state.actors.some((actor) => actor.id === actorId && actor.visibility !== "public");
  return hidden ? "gm-only" : asked;
}

function planFor(state: GameState, scope: Initiator, input: CheckRollInput, deps: CheckRollDependencies) {
  const actor = state.actors.find((candidate) => candidate.id === input.actorId);
  if (!actor) throw new CommandRejectedError("That character no longer exists.");
  requireActorAccess(scope, state, actor.id, "check", "You can only roll for your own character.");
  const definition = actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
  const derivation = deriveEquipment(actor, definition, deps.catalog);
  // A player names only a creature they can see; a hidden one would answer whether it carries their mark.
  const finding =
    input.findActorId !== undefined && (scope.role === "gm" || canPlayerTarget(state, input.findActorId))
      ? state.actors.find((candidate) => candidate.id === input.findActorId)
      : undefined;
  const plan = checkPlan(actor, definition, derivation, input.subject, {
    ...(deps.names ? { names: deps.names } : {}),
    ...(finding ? { finding } : {})
  });
  return { actor, plan };
}

/** Records a check roll and holds its dice for a Heroic Inspiration reroll. */
function recordCheck(
  state: GameState,
  scope: Initiator,
  input: CheckRollInput,
  deps: CheckRollDependencies,
  plan: CheckPlan,
  faces: readonly number[],
  readAs: "advantage" | "disadvantage" | "normal",
  typed: boolean,
  options: Readonly<{ label?: string; others?: ReturnType<typeof otherDiceOf> }>
): CheckResult {
  const actor = state.actors.find((candidate) => candidate.id === input.actorId)!;
  const roll = totalCheck(plan, faces, readAs, deps.random, options.others ?? []);
  const visibility = checkVisibility(state, scope, actor.id, input.visibility);
  const rollId = deps.newId();
  const label = `${options.label ?? plan.label}${roll.reliableTalent ? " (Reliable Talent)" : ""}`;
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
  const success = input.dc === null ? null : roll.total >= input.dc;
  holdRoll(state, {
    key: checkKey(actor.id),
    actorId: actor.id,
    faces: [...faces],
    others: otherDiceOf(roll.resolution),
    rollId,
    typed,
    check: {
      subject: { ...input.subject },
      dc: input.dc,
      visibility: input.visibility,
      ...(!typed && input.forcedMode !== undefined ? { rollMode: input.forcedMode } : {}),
      ...(input.callId !== undefined ? { callId: input.callId } : {}),
      ...(input.findActorId !== undefined ? { findActorId: input.findActorId } : {})
    }
  });
  if (input.callId !== undefined)
    recordCallResult(state, input.callId, actor.id, { natural: roll.natural, total: roll.total, success, rollId });
  // A typed die was thrown under the mode the rules gave, which the player was told before rolling.
  const rollMode = shownRollMode(plan.rollMode, typed ? undefined : input.forcedMode);
  return {
    outcome: {
      label: plan.label,
      natural: roll.natural,
      total: roll.total,
      dc: input.dc,
      success,
      ...(rollMode ? { rollMode } : {}),
      ...(roll.reliableTalent ? { reliableTalent: true as const } : {}),
      ...(typed ? { typed: true as const } : {}),
      rollId
    },
    hiddenFromRoller: visibility === "blind" && scope.role !== "gm"
  };
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
    label: `${record.label}${roll.reliableTalent ? " (Reliable Talent)" : ""}`.slice(0, 80),
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
  const { plan } = planFor(state, scope, input, deps);
  const forced = scope.role === "gm" ? input.forcedMode : undefined;
  if (input.face !== undefined) {
    requireTypedDie(state, scope, undefined, input.face);
    return recordCheck(state, scope, { ...input, forcedMode: forced }, deps, plan, [input.face], "normal", true, {});
  }
  const mode = forced ?? plan.rollMode.mode;
  const faces = d20FacesFor(mode, [], deps.random);
  return recordCheck(state, scope, { ...input, forcedMode: forced }, deps, plan, faces, mode, false, {});
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
    ...(check.callId !== undefined ? { callId: check.callId } : {})
  };
  const { plan } = planFor(state, scope, rollInput, deps);
  const label = `${plan.label} reroll`;
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
  deps: Readonly<{ newId: () => string; now: () => number }>
): RollCall {
  if (state.rollCalls.length >= MAX_CALLS)
    throw new CommandRejectedError("Close an earlier call for a roll before starting another.");
  for (const actorId of input.actorIds) {
    const actor = state.actors.find((candidate) => candidate.id === actorId);
    if (!actor || actor.archived) throw new CommandRejectedError("Every character you call on must be on the roster.");
  }
  if (input.kind === "save" && input.dc === null) throw new CommandRejectedError("A saving throw needs a DC.");
  const entries = input.actorIds.map((actorId) => ({
    actorId,
    ...(input.kind === "save" ? { saveId: deps.newId() } : {})
  }));
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
  input: Readonly<{ commandId: string; callId: string; actorId: string; face?: number }>,
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
      ...(input.face !== undefined ? { face: input.face } : {})
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
