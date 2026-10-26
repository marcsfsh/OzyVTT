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
import { moveEncounterToken, snappedTokenPosition, type TokenMapGeometry } from "./token-placement.js";
import { reactionSpent, spendReaction } from "./commanded-reactions.js";
import { isIncapacitated } from "./condition-rules.js";

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

/** On an effect, nothing moves its bearer (Imprisonment's Chaining: "can't be moved by any means"). */
export const UNMOVABLE_TAG = "unmovable";
const unmovable = (state: GameState, actorId: string) =>
  state.actors.some(
    (actor) => actor.id === actorId && actor.effects.some((effect) => effect.tags.includes(UNMOVABLE_TAG))
  );

/** SRD Dwarven Plate: "If an effect moves you against your will along the ground, you can take a Reaction to reduce
 *  the distance you are moved by up to 10 feet." Armor that braces its wearer, by record, with the feet it takes off. */
const BRACING_ARMOR: Readonly<Record<string, number>> = { "dwarven-plate": 10 };

/** The feet the creature's armor takes off a forced move now: worn, in a fight, its Reaction free and able to take it.
 *  No wearer would choose to be moved farther, so the server takes the Reaction for it. */
function bracedFeet(state: GameState, actorId: string): number {
  if (!state.combat.active || !state.combat.initiative.some((entry) => entry.actorId === actorId)) return 0;
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor || actor.hp.current <= 0 || isIncapacitated(actor) || reactionSpent(state, actorId)) return 0;
  if (actor.effects.some((effect) => effect.tags.includes("no-reactions"))) return 0;
  const row = actor.inventory.find((item) => item.equipped && BRACING_ARMOR[item.recordId ?? item.id] !== undefined);
  return row ? BRACING_ARMOR[row.recordId ?? row.id]! : 0;
}

/** The distance a forced move goes after its target braces against it, spending its Reaction when it does. */
function afterBracing(state: GameState, actorId: string, distanceFeet: number): number {
  const braced = Math.min(bracedFeet(state, actorId), Math.abs(distanceFeet));
  if (braced === 0) return distanceFeet;
  spendReaction(state, actorId);
  return Math.sign(distanceFeet) * (Math.abs(distanceFeet) - braced);
}

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
  if (unmovable(state, actorId)) return { value: 0, unit: "ft" };
  const braced = afterBracing(state, actorId, distanceFeet);
  if (braced === 0) return { value: 0, unit: "ft" };
  const destination = pushDestination(geometry, from, point, -braced);
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
  if (unmovable(state, input.actorId)) return { value: 0, unit: "ft" };
  // A pull runs the same line the other way and stops beside the creature it is pulled to, edge to edge.
  const apart = input.toward
    ? (tokenCreatureDistance(state, geometry, input.actorId, input.awayFromActorId) ?? null)
    : null;
  if (input.toward && apart === null) return null;
  const pushed = input.toward ? -Math.max(0, Math.min(input.distanceFeet, apart!.value - 5)) : input.distanceFeet;
  const distance = pushed === 0 ? 0 : afterBracing(state, input.actorId, pushed);
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
  if (!geometry || !at || !from || unmovable(state, actorId)) return false;
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

/**
 * Where a creature would stand set down at a point (a bulette's Deadly Leap, a kraken's Fling), snapped as a GM drag
 * is and on the ground: how far that is from `fromActorId` (for the creature itself, how far it moves; for another,
 * edge to edge from it), and the living creatures whose spaces it would share there. Null when the map can't measure.
 */
export function destinationAt(
  state: GameState,
  actorId: string,
  point: EncounterTokenPosition,
  fromActorId: string,
  geometry: TokenMapGeometry | null
): Readonly<{ at: EncounterTokenPosition; feet: number; sharers: readonly string[] }> | null {
  const token = state.combat.tokens.find((entry) => entry.actorId === actorId);
  const from = state.combat.tokens.find((entry) => entry.actorId === fromActorId);
  if (!geometry || !token?.position || !from?.position) return null;
  const at = snappedTokenPosition(token, point, geometry);
  const there = footprintOf(token, at, 0);
  const feet =
    actorId === fromActorId
      ? mapDistance(geometry, from.position, at)?.value
      : creatureDistance(geometry, footprintOf(from, from.position), there)?.value;
  if (feet === undefined) return null;
  const sharers = state.combat.tokens
    .filter((other) => other.actorId !== actorId && other.actorId !== fromActorId && other.position)
    .filter((other) => {
      const creature = state.actors.find((candidate) => candidate.id === other.actorId);
      if (!creature || creature.hp.current <= 0 || creature.summon?.intangible) return false;
      const apart = creatureDistance(geometry, there, footprintOf(other, other.position!));
      return apart !== null && apart.value <= 0;
    })
    .map((other) => other.actorId);
  return { at, feet, sharers };
}
