import type { EncounterTokenPosition, GameState } from "@vtt/domain";
import { gridToImage, imageToGrid } from "./grid-calibration.js";
import { mapDistance } from "./movement-narration.js";
import { moveEncounterToken, type TokenMapGeometry } from "./token-placement.js";

/**
 * ================================================================================================
 * SRD FORCED MOVEMENT - a creature moved by something other than its own legs
 * ================================================================================================
 *
 * Push, pull and slide are the same shape: a direction the SERVER derives from two token positions
 * and a distance the rule names. There is nothing here for a client to assert - no destination, no
 * direction, no distance - which is why this takes an actor pair and a number of feet rather than a
 * point. The first caller is the Push weapon mastery.
 *
 * THREE PROPERTIES THIS MODULE HOLDS, each of which a future reader will be tempted to "fix":
 *
 *  1. THE SNAP IS `moveEncounterToken`'S, not a second one. `docs/ai-context/map-grid.md` allows
 *     exactly one snapping implementation, and it is the one the GM's own drag runs through - so a
 *     pushed token lands on the same lattice a dragged one does, footprint rules and map bounds
 *     included.
 *  2. IT DOES NOT ROUTE THROUGH `applyMovementRules`. SRD forced movement is not the target's
 *     movement: it provokes no Opportunity Attacks and spends none of the creature's Speed. Feeding
 *     it to the movement rules would bill the shoved creature for being shoved and open reaction
 *     windows the SRD does not open.
 *  3. UNMEASURABLE DEGRADES, IT NEVER THROWS. A map with no calibration and no scale has no "10
 *     feet", and a combatant still in the tray has no position to push from; both return null so the
 *     caller can say "move the token" the way the builtin Shove already does. `moveEncounterToken`
 *     THROWS on an absent token, so every one of those cases is checked before it is called.
 *
 * A MAP UNIT IS A FOOT, which this module inherits rather than decides: reach, weapon range and the
 * movement budget all compare their printed feet against `creatureDistance`/`mapDistance` already, so
 * a scale saved in miles would have made nonsense of the whole rules engine long before it reached a
 * push. The measured distance travels WITH its unit into the narration for that reason - the sentence
 * repeats whatever the map actually said instead of stamping "ft" on it.
 */

export type ForcedMove = Readonly<{
  /** Who is moved. */
  actorId: string;
  /** Who they are moved straight away FROM - the direction's origin, never a client-supplied vector. */
  awayFromActorId: string;
  distanceFeet: number;
}>;

/**
 * Where the pushed token is aiming for, BEFORE the snap. Null when the map cannot express a
 * distance, or when the two tokens are stacked exactly (no direction to be pushed along).
 *
 * The two branches are not the same arithmetic, and that is deliberate: each computes the distance
 * the way the table will MEASURE it back. On a square grid the engine counts Chebyshev cells
 * everywhere (`mapDistance`, `creatureDistance`, the measurement tool), so the displacement is
 * scaled until its LONGEST axis is the pushed distance - a diagonal push then reads a full 10 ft
 * instead of the 7 ft its straight-line length would suggest. On a scaled gridless map there are no
 * cells and the same measure is plain Euclidean, so the straight line is exactly right.
 */
function pushDestination(
  geometry: TokenMapGeometry, from: EncounterTokenPosition, source: EncounterTokenPosition, distanceFeet: number
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
    return gridToImage(geometry.calibration, { column: fromGrid.column + column * scale, row: fromGrid.row + row * scale });
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

/**
 * Push a token straight away from another combatant and report HOW FAR IT ACTUALLY WENT - measured
 * after the snap with the same function the combat log narrates a drag with, never the distance that
 * was asked for. A push into the edge of the map is clamped by the shared bounds check, and a
 * narration that claimed 10 feet there would be a wrong number at the table; this one reads back the
 * truth. Null means nothing moved and the GM should place the token by hand.
 */
export function pushTokenAway(
  state: GameState, input: ForcedMove, geometry: TokenMapGeometry | null
): Readonly<{ value: number; unit: string }> | null {
  if (!geometry) return null;
  const from = state.combat.tokens.find((token) => token.actorId === input.actorId)?.position ?? null;
  const source = state.combat.tokens.find((token) => token.actorId === input.awayFromActorId)?.position ?? null;
  if (from === null || source === null) return null;
  const destination = pushDestination(geometry, from, source, input.distanceFeet);
  if (destination === null) return null;
  moveEncounterToken(state, input.actorId, destination, geometry);
  const to = state.combat.tokens.find((token) => token.actorId === input.actorId)?.position ?? null;
  if (to === null) return null;
  return mapDistance(geometry, from, to);
}
