import type { GameState } from "@vtt/domain";
import { setAltitude } from "./altitude.js";
import { isIncapacitated } from "./condition-rules.js";
import type { EffectNarration } from "./effects.js";
import { dragAlong } from "./movement-rules.js";
import { speedZeroed } from "./speed.js";
import type { ZoneDeps } from "./spell-zones.js";
import { moveEncounterToken, type TokenMapGeometry } from "./token-placement.js";
import { walkThroughZones } from "./zone-stops.js";

/**
 * SRD 5.2.1 Opportunity Attacks: "The attack occurs right before the creature leaves your reach." A move that provokes
 * stops at the last point of its way still in reach (`combat.heldMove`) while the prompts it opened are open. A move
 * that enters an area whose save, failed, stops its mover (Caltrops, Web, Ball Bearings) stops where it entered while
 * the save is answered (`zone-stops.ts`). Once they are all answered or declined, the settle step finishes the move
 * along the rest of its way, the areas on it acting on the mover, unless what happened left the mover unable to go on
 * (at 0 Hit Points, Incapacitated, Prone, or with a Speed of 0): then it stays where it was, and the movement the rest
 * of the way would have cost comes back.
 */

type Point = Readonly<{ x: number; y: number }>;
type Held = NonNullable<GameState["combat"]["heldMove"]>;

/** Stops a move where it waits on prompts or saves, until they are answered. */
export function holdMove(
  state: GameState,
  geometry: TokenMapGeometry,
  input: Readonly<{
    actorId: string;
    at: Point;
    altitudeFeet: number;
    to: Point;
    toAltitudeFeet: number;
    airborne?: "fly" | "levitate";
    promptIds: readonly string[];
    refundFeet: number;
    dragged: readonly string[];
    /** The way on from `at` to `to`, for the areas along it. */
    rest?: readonly Point[];
  }>
): void {
  const held: Held = {
    actorId: input.actorId,
    at: { ...input.at },
    to: { ...input.to },
    ...(input.toAltitudeFeet > 0 ? { toAltitudeFeet: input.toAltitudeFeet } : {}),
    ...(input.airborne ? { airborne: input.airborne } : {}),
    promptIds: [...input.promptIds],
    refundFeet: Math.max(0, Math.round(input.refundFeet * 10) / 10),
    dragged: [...input.dragged],
    ...(input.rest && input.rest.length >= 2 ? { rest: input.rest.slice(0, 400).map((point) => ({ ...point })) } : {})
  };
  state.combat = { ...state.combat, heldMove: held };
  moveEncounterToken(state, input.actorId, input.at, geometry);
  setAltitude(state, input.actorId, input.altitudeFeet, input.altitudeFeet > 0 ? input.airborne : undefined);
}

/** Gives back movement a move didn't go on to spend, on the mover's own turn. */
export function refundMovement(state: GameState, actorId: string, feet: number): void {
  if (state.combat.turnActorId !== actorId || feet <= 0) return;
  state.combat = {
    ...state.combat,
    turn: { ...state.combat.turn, movementUsedFeet: Math.max(0, state.combat.turn.movementUsedFeet - feet) }
  };
}

/** Whether a held move's prompts and saves are all answered, so it can finish or stop. */
export function heldMoveReady(state: GameState): boolean {
  const held = state.combat.heldMove;
  if (!held) return false;
  return (
    !state.combat.pendingReactions.some((prompt) => held.promptIds.includes(prompt.id)) &&
    !state.combat.pendingSaves.some((save) => held.promptIds.includes(save.id))
  );
}

/** What finishing a held move reads: the areas on its way, and what a stretch of it costs the mover. */
export type HeldMoveDeps = Readonly<{
  zones: ZoneDeps;
  costFeet: (from: Point, to: Point) => number | null;
}>;

/** Finishes a held move whose prompts and saves are answered, or stops it where it stands. */
export function settleHeldMove(state: GameState, geometry: TokenMapGeometry, deps?: HeldMoveDeps): EffectNarration[] {
  const held = state.combat.heldMove;
  if (!held || !heldMoveReady(state)) return [];
  state.combat = { ...state.combat, heldMove: null };
  const mover = state.actors.find((actor) => actor.id === held.actorId);
  const token = state.combat.tokens.find((candidate) => candidate.actorId === held.actorId);
  if (!mover || !token?.position) return [];
  const stopped =
    mover.hp.current <= 0 ||
    isIncapacitated(mover) ||
    speedZeroed(mover) ||
    mover.conditions.some((condition) => condition.id === "prone");
  if (stopped) {
    // Its own turn's movement the rest of the way would have spent is its again.
    refundMovement(state, mover.id, held.refundFeet);
    return [{ kind: "effect", text: `${mover.name} stops where it is.`, actorId: mover.id }];
  }
  const from = token.position;
  const events: EffectNarration[] = [
    { kind: "effect", text: `${mover.name} carries on with its move.`, actorId: mover.id }
  ];
  const way = held.rest ?? [from, held.to];
  // The areas on the rest of the way act on the mover; one that stops it holds the move again where it enters.
  const walk = deps ? walkThroughZones(state, mover.id, way, deps.zones) : null;
  const stop = walk?.stop ?? null;
  const at = stop === null ? held.to : way[stop]!;
  moveEncounterToken(state, mover.id, at, geometry);
  setAltitude(state, mover.id, held.toAltitudeFeet ?? 0, held.airborne);
  const arrived = state.combat.tokens.find((candidate) => candidate.actorId === mover.id)?.position;
  if (arrived) dragAlong(state, held.dragged, from, arrived, geometry);
  if (walk) events.push(...walk.events);
  if (stop !== null && walk?.ends) {
    // It fell into a pit on the way: the move ends there.
    refundMovement(state, mover.id, deps?.costFeet(way[stop]!, held.to) ?? 0);
    return events;
  }
  if (stop !== null && walk && arrived) {
    const onward = way.slice(stop);
    holdMove(state, geometry, {
      actorId: mover.id,
      at: arrived,
      altitudeFeet: held.toAltitudeFeet ?? 0,
      to: held.to,
      toAltitudeFeet: held.toAltitudeFeet ?? 0,
      ...(held.airborne ? { airborne: held.airborne } : {}),
      promptIds: walk.saveIds,
      refundFeet: deps?.costFeet(arrived, held.to) ?? 0,
      dragged: held.dragged,
      rest: onward
    });
  }
  return events;
}
