import { withArticle, type GameState } from "@vtt/domain";
import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import type { ActorAction } from "@vtt/schemas";
import { effectiveActions } from "./effective-actions.js";
import type { EffectNarration } from "./effects.js";
import { activeMoveGrant, noteMet } from "./granted-moves.js";
import { applyDamageDetailed, damageAdjustmentDetail } from "./hit-points.js";
import { failureEffectFor } from "./resolution/pending.js";
import { createPendingSaves } from "./saving-throws.js";
import type { ZoneDeps } from "./spell-zones.js";

type Point = Readonly<{ x: number; y: number }>;
type Actor = GameState["actors"][number];

/**
 * SRD 5.2.1 movers that act on the creatures whose spaces they enter: Engulf ("each creature whose space the cube enters
 * for the first time during this move" makes the save), Trampling Charge ("Each creature whose space the centaur enters
 * is targeted once by the following effect"), and a fire elemental's Fire Form ("The first time it enters a creature's
 * space on a turn, that creature takes 5 (1d10) Fire damage"). A move granted by such an action carries the action
 * (`grantedMove.meets`); a trait acts on every move of its own. The way is the straight line from where the move
 * starts to where it ends, so a charge goes through the creatures in its line.
 */

/** The creatures whose spaces a move along a straight line from `from` to `to` enters, in the order it meets them: not
 *  one it already shares a space with where it starts. */
export function spacesEntered(state: GameState, moverId: string, from: Point, to: Point, cellSizePx: number): string[] {
  const mover = state.combat.tokens.find((token) => token.actorId === moverId);
  if (!mover) return [];
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (cellSizePx / 4)));
  const at = (index: number): Point => ({
    x: from.x + ((to.x - from.x) * index) / steps,
    y: from.y + ((to.y - from.y) * index) / steps
  });
  const overlaps = (point: Point, other: (typeof state.combat.tokens)[number]) => {
    const reach = ((mover.sizeCells + other.sizeCells) / 2) * cellSizePx - 1;
    return Math.abs(point.x - other.position!.x) < reach && Math.abs(point.y - other.position!.y) < reach;
  };
  const met: Array<{ id: string; step: number }> = [];
  for (const other of state.combat.tokens) {
    if (other.actorId === moverId || !other.position) continue;
    if (state.combat.active && !state.combat.initiative.some((entry) => entry.actorId === other.actorId)) continue;
    if (overlaps(from, other)) continue;
    for (let step = 1; step <= steps; step++)
      if (overlaps(at(step), other)) {
        met.push({ id: other.actorId, step });
        break;
      }
  }
  return met.sort((left, right) => left.step - right.step).map((entry) => entry.id);
}

/** Rolls an action's damage, part by part. */
const rolledParts = (action: Pick<ActorAction, "damage">, deps: Pick<ZoneDeps, "rollDie">) =>
  action.damage.map((part) => ({
    amount: Math.max(0, resolveDice(parseDiceFormula(part.formula), deps.rollDie).total),
    type: part.type
  }));

/** Damage dealt outright to a creature the mover met, told to the table. */
function dealDamage(
  state: GameState,
  mover: Actor,
  creature: Actor,
  name: string,
  parts: ReadonlyArray<{ amount: number; type: string }>,
  deps: ZoneDeps
): EffectNarration[] {
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  if (total <= 0) return [];
  const { application, events } = applyDamageDetailed(
    state,
    creature.id,
    { amount: total, parts: [...parts], sourceName: `${mover.name}'s ${name}`, sourceActorId: mover.id },
    { role: "gm" },
    {
      resolveDefinition: deps.resolveDefinition,
      ...(deps.catalog ? { catalog: deps.catalog } : {}),
      newId: deps.newId,
      now: deps.now,
      rollDie: deps.rollDie
    }
  );
  return [
    {
      kind: "damage",
      text: `${mover.name}'s ${name} deals ${creature.name} ${application.totalApplied} damage${damageAdjustmentDetail(application)}.`,
      actorId: creature.id,
      source: { actorId: mover.id, name: mover.name }
    },
    ...events
  ];
}

/** An action's save (and its damage) met by a creature the move entered; damage outright when it has no save. */
function meetWithAction(
  state: GameState,
  mover: Actor,
  action: ActorAction,
  creature: Actor,
  deps: ZoneDeps
): EffectNarration[] {
  const parts = rolledParts(action, deps);
  const save = action.save;
  if (!save) return dealDamage(state, mover, creature, action.name, parts, deps);
  const onFail = failureEffectFor(
    { action, attacker: mover, castId: null, riderItemId: null, deps: { catalog: deps.catalog } },
    save.failureConditions
  );
  createPendingSaves(state, {
    sourceActorId: mover.id,
    sourceName: mover.name,
    actionName: action.name,
    ability: save.ability,
    dc: save.dc,
    targetIds: [creature.id],
    proposedDamage: parts.reduce((sum, part) => sum + part.amount, 0),
    proposedDamageParts: parts,
    halfOnSuccess: save.successDamage === "half",
    conditionIds: save.failureConditions,
    ...(onFail ? { onFailEffect: onFail } : {}),
    replaceExisting: false,
    newSaveId: deps.newId,
    createdAt: Date.parse(deps.now())
  });
  return [
    {
      kind: "effect",
      text: `${mover.name}'s ${action.name} meets ${creature.name}, who makes ${withArticle(`${save.ability.toUpperCase()} save`)} (DC ${save.dc}).`,
      actorId: creature.id,
      source: { actorId: mover.id, name: mover.name }
    }
  ];
}

/**
 * What a creature's own move does to the creatures whose spaces it enters on the way from `from` to `to`: the save of
 * the action whose move it is, once for each creature during that move, and the damage a trait deals the first time on
 * a turn. Returns what the table is told.
 */
export function meetAlongPath(
  state: GameState,
  moverId: string,
  from: Point,
  to: Point,
  deps: ZoneDeps,
  grant: Readonly<{ effectId: string; actionId: string; met: readonly string[] }> | null
): EffectNarration[] {
  const calibration = deps.geometry?.calibration;
  const mover = state.actors.find((actor) => actor.id === moverId);
  if (!calibration || !mover) return [];
  const entered = spacesEntered(state, moverId, from, to, calibration.cellSizePx);
  if (entered.length === 0) return [];
  const definition = mover.definitionId ? deps.resolveDefinition(mover.definitionId) : undefined;
  const events: EffectNarration[] = [];
  const action = grant
    ? effectiveActions(definition, mover, deps.catalog).find((candidate) => candidate.id === grant.actionId)
    : undefined;
  if (grant && action) {
    const fresh = entered.filter((id) => !grant.met.includes(id));
    for (const id of fresh) {
      const creature = state.actors.find((actor) => actor.id === id);
      if (creature && creature.hp.current > 0) events.push(...meetWithAction(state, mover, action, creature, deps));
    }
    noteMet(mover, grant.effectId, fresh);
  }
  for (const trait of definition?.traitMechanics ?? []) {
    if (trait.kind !== "enters-space") continue;
    for (const id of entered) {
      // "The first time it enters a creature's space on a turn."
      const key = `${mover.id}:enters-space:${id}`;
      if ((state.combat.turn.turnUses[key] ?? 0) > 0) continue;
      const creature = state.actors.find((actor) => actor.id === id);
      if (!creature || creature.hp.current <= 0) continue;
      if (state.combat.active)
        state.combat = {
          ...state.combat,
          turn: { ...state.combat.turn, turnUses: { ...state.combat.turn.turnUses, [key]: 1 } }
        };
      const parts = trait.damage.map((part) => ({
        amount: Math.max(0, resolveDice(parseDiceFormula(part.formula), deps.rollDie).total),
        type: part.type
      }));
      events.push(...dealDamage(state, mover, creature, trait.name, parts, deps));
    }
  }
  return events;
}

/** The meeting move the creature has now, as `meetAlongPath` takes it, or null. */
export function meetingGrantOf(
  state: GameState,
  mover: Actor
): Readonly<{ effectId: string; actionId: string; met: readonly string[] }> | null {
  const grant = activeMoveGrant(state, mover);
  return grant?.meets ? { effectId: grant.effectId, actionId: grant.meets.actionId, met: [...grant.meets.met] } : null;
}
