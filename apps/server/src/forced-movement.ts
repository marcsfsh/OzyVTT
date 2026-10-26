import type { EncounterTokenPosition, GameState } from "@vtt/domain";
import { gridToImage, imageToGrid } from "./grid-calibration.js";
import {
  creatureDistance,
  DISTANCE_TOLERANCE_FEET,
  footprintOf,
  mapDistance,
  tokenCreatureDistance
} from "./movement-narration.js";
import { nearestOpenSpace } from "./off-plane.js";
import { moveEncounterToken, type TokenMapGeometry } from "./token-placement.js";

/**
 * SRD forced movement (push, pull, slide): a direction the server derives from two token positions and
 * a distance the rule names, so nothing comes from a client. First used by the Push mastery.
 *
 *  1. Snapping is `moveEncounterToken`'s, the same path as a GM drag (footprint and bounds included).
 *  2. It does not go through `applyMovementRules`: forced movement provokes no Opportunity Attacks and
 *     spends none of the creature's Speed.
 *  3. Unmeasurable cases (no calibration or scale, a token not placed) return null and never throw,
 *     so the caller can say "move the token". `moveEncounterToken` throws on an absent token, so those
 *     cases are checked first.
 *
 * A map unit is treated as a foot, like reach and range everywhere else; the measured distance carries
 * its unit into the narration.
 */

export type ForcedMove = Readonly<{
  /** Who is moved. */
  actorId: string;
  /** Who they are moved straight away from: the direction's origin, never a client-supplied vector. */
  awayFromActorId: string;
  distanceFeet: number;
  /** A pull: straight toward that creature instead, stopping beside it (a balor's Flame Whip). */
  toward?: boolean;
}>;

/** Where the pushed token aims before the snap; null when the map cannot express a distance or the two
 *  tokens are stacked. Each branch measures the way the table does: on a square grid distance is
 *  Chebyshev, so the longest axis equals the pushed distance; on a scaled gridless map it is Euclidean. */
function pushDestination(
  geometry: TokenMapGeometry,
  from: EncounterTokenPosition,
  source: EncounterTokenPosition,
  distanceFeet: number
): EncounterTokenPosition | null {
  if (geometry.calibration) {
    const fromGrid = imageToGrid(geometry.calibration, from);
    const sourceGrid = imageToGrid(geometry.calibration, source);
    const column = fromGrid.column - sourceGrid.column;
    const row = fromGrid.row - sourceGrid.row;
    const longest = Math.max(Math.abs(column), Math.abs(row));
    if (longest === 0) return null;
    const cells = distanceFeet / geometry.calibration.distancePerCell;
    const scale = cells / longest;
    return gridToImage(geometry.calibration, {
      column: fromGrid.column + column * scale,
      row: fromGrid.row + row * scale
    });
  }
  if (geometry.scale) {
    const dx = from.x - source.x;
    const dy = from.y - source.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) return null;
    const pixels = distanceFeet / geometry.scale.distancePerPixel;
    return { x: from.x + (dx / length) * pixels, y: from.y + (dy / length) * pixels };
  }
  return null;
}

/** Pulls a token straight toward a point on the map (a whirlpool's middle), up to `distanceFeet`, and reports how far
 *  it actually went; null when the map can't measure it or the token already stands there. */
export function pullTokenToward(
  state: GameState,
  actorId: string,
  point: EncounterTokenPosition,
  distanceFeet: number,
  geometry: TokenMapGeometry
): Readonly<{ value: number; unit: string }> | null {
  const from = state.combat.tokens.find((token) => token.actorId === actorId)?.position ?? null;
  if (from === null) return null;
  const destination = pushDestination(geometry, from, point, -distanceFeet);
  if (destination === null) return null;
  moveEncounterToken(state, actorId, destination, geometry);
  const to = state.combat.tokens.find((token) => token.actorId === actorId)?.position ?? null;
  return to === null ? null : mapDistance(geometry, from, to);
}

/** Pushes a token straight away from another combatant and reports how far it actually went, measured
 *  after the snap (a push into the map edge is clamped). Null means nothing moved and the GM should
 *  place the token by hand. */
export function pushTokenAway(
  state: GameState,
  input: ForcedMove,
  geometry: TokenMapGeometry | null
): Readonly<{ value: number; unit: string }> | null {
  if (!geometry) return null;
  const from = state.combat.tokens.find((token) => token.actorId === input.actorId)?.position ?? null;
  const source = state.combat.tokens.find((token) => token.actorId === input.awayFromActorId)?.position ?? null;
  if (from === null || source === null) return null;
  // A pull runs the same line the other way and stops beside the creature it is pulled to, edge to edge.
  const apart = input.toward
    ? (tokenCreatureDistance(state, geometry, input.actorId, input.awayFromActorId) ?? null)
    : null;
  if (input.toward && apart === null) return null;
  const distance = input.toward ? -Math.max(0, Math.min(input.distanceFeet, apart!.value - 5)) : input.distanceFeet;
  if (distance === 0) return { value: 0, unit: apart?.unit ?? "ft" };
  const destination = pushDestination(geometry, from, source, distance);
  if (destination === null) return null;
  moveEncounterToken(state, input.actorId, destination, geometry);
  const to = state.combat.tokens.find((token) => token.actorId === input.actorId)?.position ?? null;
  if (to === null) return null;
  return mapDistance(geometry, from, to);
}

/** Pulls a token into another creature's space (a shambling mound's Engulf: "The target is pulled into the shambling
 *  mound's space"), where the two then share it. False when either isn't on the map. */
export function pullIntoSpace(
  state: GameState,
  actorId: string,
  intoActorId: string,
  geometry: TokenMapGeometry | null
): boolean {
  const at = state.combat.tokens.find((token) => token.actorId === intoActorId)?.position;
  const from = state.combat.tokens.find((token) => token.actorId === actorId)?.position;
  if (!geometry || !at || !from) return false;
  moveEncounterToken(state, actorId, at, geometry);
  return true;
}

/** The space nearest `actorId` that no other creature fills and that lies within `withinFeet` of `besideId` (a
 *  gelatinous cube's Engulf: "moves to an unoccupied space within 5 feet of the cube"). Null when there is none;
 *  undefined when the map can't say. */
export function openSpaceBeside(
  state: GameState,
  actorId: string,
  besideId: string,
  withinFeet: number,
  geometry: TokenMapGeometry | null
): EncounterTokenPosition | null | undefined {
  const token = state.combat.tokens.find((entry) => entry.actorId === actorId);
  const beside = state.combat.tokens.find((entry) => entry.actorId === besideId);
  if (!geometry?.calibration || !token?.position || !beside?.position) return undefined;
  const spot = nearestOpenSpace(state, actorId, token.position, geometry);
  if (filledStill(spot, token.position, state, actorId, geometry)) return null;
  const apart = creatureDistance(geometry, footprintOf(token, spot, 0), footprintOf(beside, beside.position));
  return apart !== null && apart.value <= withinFeet + DISTANCE_TOLERANCE_FEET ? spot : null;
}

/** Whether the search came back with the creature's own space while another creature still fills it: nothing near was
 *  open, since `nearestOpenSpace` hands back the start then. */
function filledStill(
  spot: EncounterTokenPosition,
  position: EncounterTokenPosition,
  state: GameState,
  actorId: string,
  geometry: TokenMapGeometry
): boolean {
  if (spot.x !== position.x || spot.y !== position.y) return false;
  const others = state.combat.tokens.filter((token) => token.actorId !== actorId && token.position);
  const token = state.combat.tokens.find((entry) => entry.actorId === actorId)!;
  return others.some((other) => {
    const apart = creatureDistance(geometry, footprintOf(token, position, 0), footprintOf(other, other.position!, 0));
    return apart !== null && apart.value <= 0;
  });
}
