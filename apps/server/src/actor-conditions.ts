import type { Actor, GameState } from "@vtt/domain";
import { CommandRejectedError, RulesBlockedError } from "./game-store.js";
import type { Initiator } from "./authorization.js";
import { adjustableActor } from "./hit-points.js";
import { applyCondition, conditionGained, type ConditionImmunitySource, type EffectNarration } from "./effects.js";
import { conditionLabel, exhaustionLevel } from "./condition-rules.js";
import { deriveEquipment } from "./equipment-derivation.js";
import { currentSpeedFeet, effectiveSpeedFeet } from "./speed.js";
import {
  effectiveModeFor,
  familyModeFor,
  overrideCovers,
  overrideWaives,
  rememberOverride,
  type RuleId,
  type RulesOverride
} from "./rules-families.js";

type SetConditionOptions = ConditionImmunitySource & Readonly<{ override?: RulesOverride | null }>;

/**
 * Runs one rule through the ladder for a condition change: strict throws (a player may then ask the GM), assisted lets
 * it through with a note, off says nothing. A GM override on the command, or one earlier this turn, waives it.
 */
export function policeConditionRule(
  state: GameState,
  actor: Actor,
  rule: RuleId,
  violation: string,
  options: SetConditionOptions | undefined,
  events: EffectNarration[]
): void {
  if (effectiveModeFor(state.combat, rule) === "freeform") return;
  const waived = overrideWaives(options?.override, rule);
  if (waived) {
    if (state.combat.active) rememberOverride(state, rule, options?.override);
    return;
  }
  if (state.combat.active && overrideCovers(state.combat.turn, rule)) return;
  if (effectiveModeFor(state.combat, rule) === "strict") throw new RulesBlockedError(rule, violation);
  events.push({ kind: "condition", text: `Rules note: ${violation}`, actorId: actor.id });
}

/**
 * Who may take a condition off (SRD: each condition ends by its own rules). The GM may always. A player may take off
 * what they put on their own character; anything imposed (a failed save, an effect, the GM, the engine) ends by its
 * duration, a repeated save, Escape, or the GM's say, so a player removing it is a rules block they can ask the GM
 * about. Prone ends by standing up, which is checked as movement instead.
 */
function checkPlayerRemoval(
  state: GameState,
  actor: Actor,
  conditionId: string,
  options: SetConditionOptions | undefined,
  events: EffectNarration[]
): void {
  const entry = actor.conditions.find((condition) => condition.id === conditionId);
  if (!entry) return;
  const linked = actor.effects.filter((effect) => effect.linkedConditionIds.includes(conditionId));
  if (entry.selfApplied === true && linked.length === 0) return;
  const label = conditionLabel(conditionId);
  const escape = linked.find((effect) => effect.escapeDc !== null);
  const how = escape
    ? `Escape it (DC ${escape.escapeDc}) or ask the GM`
    : linked.length > 0
      ? `It ends with ${linked[0].name}, or ask the GM`
      : "It ends by its own rules, or ask the GM";
  policeConditionRule(
    state,
    actor,
    "condition.imposed",
    `${actor.name} didn't give itself ${label}. ${how}.`,
    options,
    events
  );
}

/** SRD Prone: standing up costs half your Speed, so it happens on your own turn, with movement you have. */
function standUp(state: GameState, actor: Actor, scope: Initiator, options: SetConditionOptions | undefined) {
  const events: EffectNarration[] = [];
  // Off your turn there is no movement to spend; the GM's own housekeeping stays free.
  if (scope.role === "player" && state.combat.active && state.combat.turnActorId !== actor.id) {
    policeConditionRule(
      state,
      actor,
      "movement.stand-up-off-turn",
      `${actor.name} can stand up only on its own turn, and it costs half its Speed.`,
      options,
      events
    );
    return events;
  }
  // Charged when the current combatant stands on its own turn in a live fight, following the movement family.
  if (
    state.combat.active &&
    state.combat.turnActorId === actor.id &&
    familyModeFor(state.combat, "movement") !== "freeform" &&
    actor.speedFeet !== undefined
  ) {
    // Half your current Speed (slowed or exhausted creatures pay less). Not `effectiveSpeedFeet`: Dash adds
    // movement without raising Speed.
    const definition = actor.definitionId ? options?.resolveDefinition?.(actor.definitionId) : undefined;
    const derivation = deriveEquipment(actor, definition, options?.catalog);
    const cost = Math.floor((currentSpeedFeet(actor, derivation) ?? 0) / 2);
    const effective = effectiveSpeedFeet(actor, derivation) ?? 0;
    const budgetLeft = effective - state.combat.turn.movementUsedFeet;
    // Speed 0 is its own refusal: with a zeroed Speed the cost is also 0, so `cost > budgetLeft` alone would pass.
    const blocked = effective === 0 || cost > budgetLeft;
    // One sentence for both exits: strict throws it, assisted narrates it.
    const violation =
      effective === 0
        ? `${actor.name} can't stand up while its Speed is 0.`
        : `Standing up costs ${cost} ft of movement, and ${actor.name} has ${Math.max(0, Math.round(budgetLeft * 10) / 10)} ft left.`;
    const waived = overrideWaives(options?.override, "movement.stand-up-cost");
    if (
      blocked &&
      !waived &&
      effectiveModeFor(state.combat, "movement.stand-up-cost") === "strict" &&
      !overrideCovers(state.combat.turn, "movement.stand-up-cost")
    ) {
      throw new RulesBlockedError("movement.stand-up-cost", violation);
    }
    // A GM Allow here covers the movement family for the rest of the turn, exactly as it does on the map.
    if (blocked && waived) rememberOverride(state, "movement.stand-up-cost", options?.override);
    state.combat = {
      ...state.combat,
      turn: { ...state.combat.turn, movementUsedFeet: state.combat.turn.movementUsedFeet + cost }
    };
    events.push({ kind: "condition", text: `${actor.name} stood up (${cost} ft of movement).`, actorId: actor.id });
    // Assisted mode (and a strict turn already covered by a GM Allow) narrates the violation as a
    // "Rules note", the movement family's convention, so it never passes silently. An explicit
    // `override` on this command is audited by the caller.
    if (blocked && !waived) events.push({ kind: "condition", text: `Rules note: ${violation}`, actorId: actor.id });
  }
  return events;
}

/** Tracks a condition on an actor. The engine owns the mechanical hooks (ADR-0020): condition immunities
 *  skip with narration, Exhaustion stacks a level each time it is received and level 6 is death, and an
 *  incapacitating condition breaks Concentration and releases grapples (`conditionGained`). Returns narration
 *  events. `level` sets Exhaustion's 1-6 outright. Clearing an absent condition is a no-op. A player may add
 *  conditions to their own character and take off only what they added (`checkPlayerRemoval`). */
export function setCondition(
  state: GameState,
  actorId: string,
  conditionId: string,
  active: boolean,
  level: number | undefined,
  scope: Initiator,
  options?: SetConditionOptions
): EffectNarration[] {
  const actor = adjustableActor(state, actorId, scope);
  if (level !== undefined && conditionId !== "exhaustion")
    throw new CommandRejectedError("Only exhaustion has levels.");
  const present = actor.conditions.some((condition) => condition.id === conditionId);
  if (!active) {
    if (!present) return [];
    const events =
      conditionId === "prone"
        ? standUp(state, actor, scope, options)
        : scope.role === "player"
          ? (() => {
              const notes: EffectNarration[] = [];
              checkPlayerRemoval(state, actor, conditionId, options, notes);
              return notes;
            })()
          : [];
    actor.conditions = actor.conditions.filter((condition) => condition.id !== conditionId);
    return events;
  }
  const previousExhaustion = exhaustionLevel(actor);
  const events: EffectNarration[] = [];
  // Lowering Exhaustion is taking some of it off.
  if (scope.role === "player" && conditionId === "exhaustion" && level !== undefined && level < previousExhaustion)
    checkPlayerRemoval(state, actor, conditionId, options, events);
  // Immunity: skip with narration and refuse nothing (SRD condition immunity). Innate and item-granted
  // immunities read the same; without a catalog only innate ones apply.
  const written = applyCondition(actor, conditionId, {
    level,
    immunities: { ...options, state },
    selfApplied: scope.role === "player"
  });
  if (written === "immune") {
    return [
      {
        kind: "condition",
        text: `${actor.name} is immune to ${conditionLabel(conditionId)}, so it isn't applied.`,
        actorId: actor.id,
        immune: true
      }
    ];
  }
  if (written === "full") throw new CommandRejectedError("That combatant already has too many conditions.");
  // A re-set that changes nothing (Paralyzed again) has nothing new to break; Exhaustion always moved a level.
  if (present && conditionId !== "exhaustion") return events;
  return [...events, ...conditionGained(state, actor, conditionId, previousExhaustion)];
}
