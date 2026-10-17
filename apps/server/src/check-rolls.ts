import type { CheckRollOutcome, GameState, RollRecord, RollVisibility } from "@vtt/domain";
import { d20FacesFor, otherDiceOf, rerollLowestD20, type RandomSource } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import { checkPlan, type CheckNames, type CheckPlan, type CheckSubject, totalCheck } from "./ability-checks.js";
import { canPlayerTarget, GameAccessDeniedError, requireActorAccess, type Initiator } from "./authorization.js";
import { deriveEquipment, type EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError } from "./game-store.js";
import { heldRollFor, holdRoll, requireTypedDie, requireTypedReroll, spendRerollRight } from "./held-rolls.js";
import { recordRoll, rolledTerms } from "./roll-history.js";
import { shownRollMode } from "./saving-throws.js";

/**
 * Ability checks rolled on the server (SRD "Ability Checks"): from the sheet, and their Heroic Inspiration reroll. The
 * plan (`checkPlan`) works out the bonus and the Advantage or Disadvantage; this module throws or takes the d20, records
 * it, and holds it so Heroic Inspiration can reroll it while it is the character's latest roll.
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
      ...(input.findActorId !== undefined ? { findActorId: input.findActorId } : {})
    }
  });
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
    ...(check.findActorId !== undefined ? { findActorId: check.findActorId } : {})
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
