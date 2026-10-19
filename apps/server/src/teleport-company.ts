import type { GameState } from "@vtt/domain";
import { setAltitude } from "./altitude.js";
import type { EffectNarration } from "./effects.js";
import type { FallDeps } from "./falling.js";
import { failedTeleport } from "./granted-moves.js";
import { feetBetween, nearestOpenSpace } from "./off-plane.js";
import { moveEncounterToken, type TokenMapGeometry } from "./token-placement.js";
import { derivedUuid } from "./vision/cast-sight.js";

/**
 * What goes with a granted teleport beside its traveler (SRD 5.2.1): Dimension Door's "one willing creature ... within
 * 5 feet of you ... teleports to a space within 5 feet of your destination space", failing for both with 4d6 Force
 * damage each when either can't arrive; and a Cape of the Mountebank's smoke, which leaves "the space you left Lightly
 * Obscured until the end of your next turn".
 */

type Point = Readonly<{ x: number; y: number }>;

/** The passenger arrives in the unoccupied space nearest its traveler's, within 5 feet of it. When there is none, the
 *  teleport fails for both: the traveler goes back to `from`, and each takes `failDamage`. */
export function carryPassenger(
  state: GameState,
  geometry: TokenMapGeometry,
  input: Readonly<{
    travelerId: string;
    passengerId: string;
    from: Point;
    fromAltitudeFeet: number;
    failDamage?: string;
  }>,
  deps: FallDeps,
  events: EffectNarration[]
): void {
  const traveler = state.actors.find((actor) => actor.id === input.travelerId);
  const passenger = state.actors.find((actor) => actor.id === input.passengerId);
  const arrived = state.combat.tokens.find((token) => token.actorId === input.travelerId);
  const riding = state.combat.tokens.find((token) => token.actorId === input.passengerId);
  if (!traveler || !passenger || !arrived?.position || !riding?.position) return;
  const spot = nearestOpenSpace(state, passenger.id, arrived.position, geometry);
  const fits = spot !== arrived.position && feetBetween(geometry, arrived.position, spot) <= 5;
  if (fits) {
    moveEncounterToken(state, passenger.id, spot, geometry);
    setAltitude(state, passenger.id, arrived.altitudeFeet ?? 0, arrived.airborne);
    events.push({
      kind: "movement",
      text: `${passenger.name} arrives beside ${traveler.name}.`,
      actorId: passenger.id
    });
    return;
  }
  moveEncounterToken(state, traveler.id, input.from, geometry);
  setAltitude(state, traveler.id, input.fromAltitudeFeet, undefined);
  if (!input.failDamage) {
    events.push({
      kind: "movement",
      text: `${passenger.name} has no space beside ${traveler.name}: the teleport fails.`,
      actorId: traveler.id
    });
    return;
  }
  failedTeleport(state, traveler, input.failDamage, deps, events);
  failedTeleport(state, passenger, input.failDamage, deps, events);
}

/** Smoke in the space a teleport left, Lightly Obscured until the end of its traveler's next turn. */
export function leaveSmoke(
  state: GameState,
  geometry: TokenMapGeometry,
  input: Readonly<{ travelerId: string; from: Point; commandId: string }>
): void {
  // It lasts into the traveler's next turn, which only a fight has.
  if (!state.combat.active) return;
  const token = state.combat.tokens.find((entry) => entry.actorId === input.travelerId);
  const side = (geometry.calibration?.cellSizePx ?? token?.sizePx ?? 50) * (token?.sizeCells ?? 1);
  const x = Math.max(0, input.from.x - side / 2);
  const y = Math.max(0, input.from.y - side / 2);
  state.combat = {
    ...state.combat,
    vision: {
      ...state.combat.vision,
      areas: [
        ...state.combat.vision.areas,
        {
          id: derivedUuid(input.commandId, "smoke"),
          kind: "lightly-obscured",
          shape: { type: "rect", x, y, width: side, height: side },
          source: { casterId: input.travelerId, actionId: "teleport-smoke", untilRound: state.combat.round + 1 }
        }
      ]
    }
  };
}
