import type { GameState } from "@vtt/domain";
import type { EffectNarration } from "./effects.js";
import type { SquareGridCalibration } from "./grid-calibration.js";
import { iceAtTurnStart, iceEntry, slipOnIce } from "./ice.js";
import type { ZoneDeps } from "./spell-zones.js";
import { moveEncounterToken } from "./token-placement.js";
import { springTrapOn, trapEntry, trapsAtTurnStart, type SpringDeps } from "./traps.js";

type Point = Readonly<{ x: number; y: number }>;

/** What the ground did to a creature that came onto it: the saves it now owes, and whether it stops there whatever
 *  they come to (a pit it fell into). */
export type GroundMeeting = Readonly<{ saveIds: string[]; events: EffectNarration[]; stops: boolean }>;

/**
 * The painted ground and hidden traps on a creature's way (`map-hazards.ts`): the first point where it comes onto
 * slippery ice or sets off a trap, with what meeting it does. The move goes that far and waits there on the saves it
 * owes, as at a spell area that stops its mover (`zone-stops.ts`).
 */
export function groundEntry(
  state: GameState,
  moverId: string,
  path: readonly Point[],
  deps: ZoneDeps
): Readonly<{ index: number; meet: () => GroundMeeting }> | null {
  const calibration = deps.geometry?.calibration;
  const ice = iceEntry(state, moverId, path, calibration);
  const trap = trapEntry(state, moverId, path, calibration);
  if (trap !== null && (ice === null || trap.index <= ice))
    return { index: trap.index, meet: () => springTrapOn(state, trap.trapId, moverId, deps) };
  if (ice === null) return null;
  return {
    index: ice,
    meet: () => ({ ...slipOnIce(state, moverId, deps), stops: false })
  };
}

/** As a creature's turn starts: the slippery ice it stands on asks its save, and a trap that acts on a creature starting
 *  its turn on it goes off (a statue's pressure plate). */
export function groundAtTurnStart(
  state: GameState,
  actorId: string,
  deps: SpringDeps & Readonly<{ geometry?: Readonly<{ calibration: SquareGridCalibration | null }> | null }>
): EffectNarration[] {
  const calibration = deps.geometry?.calibration;
  return [...iceAtTurnStart(state, actorId, calibration, deps), ...trapsAtTurnStart(state, actorId, calibration, deps)];
}

/**
 * A creature moved by something else (a shove, a pull) meets the ground on its way all the same: the first trap it is
 * moved onto goes off, and a pit it falls into keeps it there. Returns the lines for the table.
 */
export function groundAlongForcedMove(
  state: GameState,
  moverId: string,
  path: readonly Point[],
  deps: ZoneDeps
): EffectNarration[] {
  const trap = trapEntry(state, moverId, path, deps.geometry?.calibration);
  if (trap === null || !deps.geometry) return [];
  const met = springTrapOn(state, trap.trapId, moverId, deps);
  if (met.stops) moveEncounterToken(state, moverId, path[trap.index]!, deps.geometry);
  return met.events;
}
