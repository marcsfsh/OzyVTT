import type { EncounterTokenPosition, GameState } from "@vtt/domain";
import { gridToImage, imageToGrid } from "./grid-calibration.js";
import { mapDistance } from "./movement-narration.js";
import { moveEncounterToken, type TokenMapGeometry } from "./token-placement.js";

/**
 * SRD forced movement (push, pull, slide): a direction the server derives from two token positions and
 * a distance the rule names, so nothing comes from a client. First used by the Push mastery.
 *
 *  1. Snapping is `moveEncounterToken`'s, the same path as a GM drag (footprint and bounds included).
 *  2. It does not go through `applyMovementRules`: forced movement provokes no Opportunity Attacks and
 *     spends none of the creature's Speed.
 *  3. Unmeasurable cases (no calibration or scale, a token not placed) return null rather than throw,
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
  const destination = pushDestination(geometry, from, source, input.distanceFeet);
  if (destination === null) return null;
  moveEncounterToken(state, input.actorId, destination, geometry);
  const to = state.combat.tokens.find((token) => token.actorId === input.actorId)?.position ?? null;
  if (to === null) return null;
  return mapDistance(geometry, from, to);
}
