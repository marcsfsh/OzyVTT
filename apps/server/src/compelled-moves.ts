import type { GameState } from "@vtt/domain";
import type { ActorDefinition, CompelledMove } from "@vtt/schemas";
import { isIncapacitated } from "./condition-rules.js";
import { NO_ACTIONS_TAG, sourceOf, type EffectNarration } from "./effects.js";
import { deriveEquipment, type EquipmentCatalog } from "./equipment-derivation.js";
import { HIDDEN_SOURCE } from "./hidden-source.js";
import { DISTANCE_TOLERANCE_FEET } from "./movement-narration.js";
import { travelBudgetFeet } from "./speed.js";

/**
 * Moves an effect compels on its bearer's own turns (SRD 5.2.1): Fear's "takes the Dash action and moves away from you
 * by the safest route on each of its turns", Antipathy's "must use its movement on its turns to get as far away as
 * possible from the target" and Sympathy's "as close as possible", a Symbol of Fear's "must move at least 30 feet away
 * from the glyph", Compulsion's "use as much of its movement as possible to move in that direction", and Confusion's
 * and Gibbering's wander in a rolled direction. Each of the bearer's moves on its turn must go that way
 * (`movement-rules.ts`), and its player's End Turn waits until it has moved as far as it must and taken the Dash it
 * must; which route is safest is the mover's, and the GM passes the turn of a creature with nowhere to move.
 */

type Actor = GameState["actors"][number];
type Effect = Actor["effects"][number];
type Point = Readonly<{ x: number; y: number }>;

/** The compass words a heading is told with, by eighths of a turn from north. */
const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"] as const;
export const headingWords = (degrees: number) => COMPASS[Math.round(degrees / 45) % 8]!;
/** A heading in degrees from a compass word. */
export const headingOf = (word: string): number | null => {
  const index = COMPASS.indexOf(word as (typeof COMPASS)[number]);
  return index < 0 ? null : index * 45;
};

/** A compulsion that binds the creature now: a heading binds once one is set; away or toward once there is something
 *  to measure from. */
export function compulsionsOn(actor: Actor): Array<{ effect: Effect; rule: CompelledMove }> {
  return actor.effects.flatMap((effect) => {
    const rule = effect.compelled;
    if (!rule) return [];
    if (rule.way === "heading" ? rule.heading === undefined : rule.point === undefined && !effect.sourceActorId)
      return [];
    return [{ effect, rule }];
  });
}

/** What a compulsion measures from: its point, or where its source's token stands. */
function anchorOf(state: GameState, effect: Effect, rule: CompelledMove): Point | null {
  if (rule.point) return rule.point;
  return state.combat.tokens.find((token) => token.actorId === effect.sourceActorId)?.position ?? null;
}

/** What the compelled creature is told it moves from or toward: the source, a hidden one masked, or the area. */
function anchorName(state: GameState, effect: Effect, rule: CompelledMove): string {
  if (rule.point) return "the area's center";
  const source = state.actors.find((actor) => actor.id === effect.sourceActorId);
  return !source || source.visibility === "gm-only" ? HIDDEN_SOURCE.toLowerCase() : source.name;
}

/** Whether a move from `from` to `to` keeps within 45 degrees of a heading. */
function alongHeading(from: Point, to: Point, heading: number): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return false;
  const radians = (heading * Math.PI) / 180;
  // Map north is up the image, where y shrinks.
  const along = dx * Math.sin(radians) - dy * Math.cos(radians);
  return along >= length * Math.cos((46 * Math.PI) / 180);
}

export type CompelledMeasure = Readonly<{
  /** Feet between two map points; null when unmeasurable. */
  distance: (a: Point, b: Point) => number | null;
}>;

/** Why this move goes against a compulsion on the mover, or null when it doesn't. */
export function compelledMoveRefusal(
  state: GameState,
  mover: Actor,
  from: Point,
  to: Point,
  measure: CompelledMeasure
): string | null {
  for (const { effect, rule } of compulsionsOn(mover)) {
    if (rule.way === "heading") {
      if (!alongHeading(from, to, rule.heading!))
        return `${mover.name} must move ${headingWords(rule.heading!)} this turn (${effect.name}).`;
      continue;
    }
    const anchor = anchorOf(state, effect, rule);
    if (!anchor) continue;
    const before = measure.distance(anchor, from);
    const after = measure.distance(anchor, to);
    if (before === null || after === null) continue;
    const named = anchorName(state, effect, rule);
    if (rule.way === "away" && after <= before + DISTANCE_TOLERANCE_FEET)
      return `${mover.name} must move away from ${named} (${effect.name}).`;
    if (rule.way === "toward") {
      // "If the creature is within 5 feet of the target, the creature can't willingly move away."
      const near = before <= 5 + DISTANCE_TOLERANCE_FEET;
      if (near && rule.holdsNear && after > before + DISTANCE_TOLERANCE_FEET)
        return `${mover.name} can't willingly move away from ${named} (${effect.name}).`;
      if (!near && after >= before - DISTANCE_TOLERANCE_FEET)
        return `${mover.name} must move closer to ${named} (${effect.name}).`;
    }
  }
  return null;
}

export type CompelledTurnDeps = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
}>;

/** What the creature still owes its compulsions as its own turn ends: the Dash it must take, or the movement it must
 *  spend their way. Null when it owes nothing. */
export function compelledTurnUnmet(state: GameState, actor: Actor, deps: CompelledTurnDeps): string | null {
  const compulsions = compulsionsOn(actor);
  if (compulsions.length === 0 || actor.hp.current <= 0) return null;
  const turn = state.combat.turn;
  const canAct = !isIncapacitated(actor) && !actor.effects.some((effect) => effect.tags.includes(NO_ACTIONS_TAG));
  for (const { effect, rule } of compulsions)
    if (rule.dashes && canAct && !turn.actionUsed)
      return `${actor.name} must take the Dash action this turn (${effect.name}).`;
  const definition = actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
  const budget = travelBudgetFeet(actor, deriveEquipment(actor, definition, deps.catalog), definition, "walk") ?? 0;
  const left = budget - turn.movementUsedFeet;
  for (const { effect, rule } of compulsions) {
    const way =
      rule.way === "heading"
        ? headingWords(rule.heading!)
        : `${rule.way === "away" ? "away from" : "toward"} ${anchorName(state, effect, rule)}`;
    // Sympathy's pull ends once the creature stands beside its target.
    if (rule.way === "toward" && effect.sourceActorId && !rule.point) {
      const apart = deps.distanceFeet?.(actor.id, effect.sourceActorId) ?? null;
      if (apart !== null && apart <= 5 + DISTANCE_TOLERANCE_FEET) continue;
    }
    if (rule.allMovement && left >= 5)
      return `${actor.name} must use all its movement to move ${way} (${effect.name}), and has ${left} ft left. With nowhere to move, the GM passes the turn.`;
    const least = rule.minFeet !== undefined ? Math.min(rule.minFeet, budget) : 0;
    if (turn.movementUsedFeet < least)
      return `${actor.name} must move at least ${least} ft ${way} (${effect.name}). With nowhere to move, the GM passes the turn.`;
  }
  return null;
}

/** What a compelled creature is told as its turn starts: where it must move. */
export function compelledTurnStart(state: GameState, actor: Actor): EffectNarration[] {
  // A direction for one turn (Compulsion's, Confusion's) is told as it is set or rolled.
  return compulsionsOn(actor).flatMap(({ effect, rule }) => {
    if (rule.once) return [];
    const way =
      rule.way === "heading"
        ? headingWords(rule.heading!)
        : `${rule.way === "away" ? "away from" : "toward"} ${anchorName(state, effect, rule)}`;
    const how = rule.allMovement
      ? `uses all its movement to move ${way}`
      : rule.minFeet !== undefined
        ? `moves at least ${rule.minFeet} ft ${way}`
        : `moves only ${way}`;
    return [
      {
        kind: "effect" as const,
        text: `${actor.name} ${rule.dashes ? "takes the Dash action and " : ""}${how} this turn (${effect.name}).`,
        actorId: actor.id,
        ...sourceOf(effect)
      }
    ];
  });
}

/** A heading that bound only this turn (Compulsion's direction) is spent as the turn ends. */
export function releaseCompulsions(actor: Actor): void {
  actor.effects = actor.effects.map((effect) => {
    if (!effect.compelled?.once || effect.compelled.heading === undefined) return effect;
    const { heading: _spent, ...rest } = effect.compelled;
    return { ...effect, compelled: rest };
  });
}
