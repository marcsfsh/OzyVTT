import type { CombatState, EncounterTokenPosition, GameState } from "@vtt/domain";
import { footprintOrigin, movementPath, pointInRects, spaceIsDifficultFor } from "@vtt/rules-5e";
import { CommandRejectedError } from "./game-store.js";
import { gridToImage, imageToGrid } from "./grid-calibration.js";
import { layerSlice, normalizedRect, type LayerMapGeometry, type PaintRectInput } from "./map-layers.js";
import { mapDistance } from "./movement-narration.js";
import { intersectRegions, subtractRect, unionRect, type Rect } from "./rect-region.js";
import type { TokenMapGeometry } from "./token-placement.js";

/** Difficult terrain (SRD 5.2.1): the GM paints it per scene; entering a cell whose centre lies in it costs
 *  double. Stored as disjoint rects, so marking an area twice costs nothing and clearing can cut any shape. */

const MAX_TERRAIN_RECTS = 1000;
const LIVE_REFUSAL = "That scene is live - edit its terrain on the table.";

export function paintTerrain(
  state: GameState,
  sceneId: string | undefined,
  geometry: LayerMapGeometry,
  input: Readonly<{ op: "difficult" | "clear"; rect: PaintRectInput }>
) {
  // Terrain lives in cells, so a map without a grid has nowhere to put it.
  if (!geometry.calibration) throw new CommandRejectedError("Calibrate the map's grid before marking terrain.");
  const slice = layerSlice(state, sceneId, "terrain", LIVE_REFUSAL);
  const rect = normalizedRect(geometry, input.rect, "Drag a larger area to mark terrain.");
  const difficult =
    input.op === "difficult" ? unionRect(slice.layer.difficult, rect) : subtractRect(slice.layer.difficult, rect);
  if (difficult.length > MAX_TERRAIN_RECTS)
    throw new CommandRejectedError("The terrain is too finely cut up - clear it and mark it again in larger areas.");
  slice.write({ difficult });
}

export function resetTerrain(state: GameState, sceneId: string | undefined) {
  const slice = layerSlice(state, sceneId, "terrain", LIVE_REFUSAL);
  slice.write({ difficult: [] });
}

/** The area players can see through the fog: everything when fog is off, else the reveals and hides in order
 *  over a map that starts hidden. */
function revealedRegion(fog: CombatState["fog"]): readonly Rect[] | "everything" {
  if (!fog.enabled) return "everything";
  let region: Rect[] = [];
  for (const shape of fog.shapes) {
    const rect = { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
    region = shape.op === "reveal" ? unionRect(region, rect) : subtractRect(region, rect);
  }
  return region;
}

/** Terrain as players and the table screen get it: only what the fog reveals, so unrevealed ground keeps its
 *  layout. Difficult terrain under the fog is still charged when someone walks into it. */
export function visibleTerrain(combat: Pick<CombatState, "fog" | "terrain">): CombatState["terrain"] {
  const revealed = revealedRegion(combat.fog);
  const difficult = combat.terrain.difficult.map((rect) => ({ ...rect }));
  return { difficult: revealed === "everything" ? difficult : intersectRegions(difficult, revealed) };
}

export type MovementCost = Readonly<{
  feet: number;
  /** Feet of `feet` spent on difficult terrain (the extra cell each such step costs). */
  difficultFeet: number;
}>;

/**
 * What a move costs the mover. On a calibrated grid: the cheapest path between the two snapped positions, with
 * painted terrain and enemies' spaces difficult (`spaceIsDifficultFor`), so walking round a patch costs only the
 * steps taken. Hidden creatures never count, because a player's preview can't know they're there. A scaled
 * gridless map measures straight; an unmeasurable map returns null.
 */
export function movementCost(
  state: GameState,
  geometry: TokenMapGeometry,
  actorId: string,
  from: EncounterTokenPosition,
  to: EncounterTokenPosition
): MovementCost | null {
  const calibration = geometry.calibration;
  if (!calibration) {
    const straight = mapDistance(geometry, from, to);
    return straight ? { feet: straight.value, difficultFeet: 0 } : null;
  }
  const mover = state.actors.find((candidate) => candidate.id === actorId);
  const sizeCells = state.combat.tokens.find((token) => token.actorId === actorId)?.sizeCells ?? 1;
  const occupied = new Set<string>();
  for (const token of state.combat.tokens) {
    if (token.actorId === actorId || !token.position) continue;
    const occupant = state.actors.find((candidate) => candidate.id === token.actorId);
    if (!mover || !occupant || occupant.visibility === "gm-only" || !spaceIsDifficultFor(mover, occupant)) continue;
    const origin = footprintOrigin(imageToGrid(calibration, token.position), token.sizeCells);
    for (let column = 0; column < token.sizeCells; column++)
      for (let row = 0; row < token.sizeCells; row++) occupied.add(`${origin.column + column},${origin.row + row}`);
  }
  const terrain = state.combat.terrain.difficult;
  const path = movementPath({
    from: footprintOrigin(imageToGrid(calibration, from), sizeCells),
    to: footprintOrigin(imageToGrid(calibration, to), sizeCells),
    sizeCells,
    isDifficult: (column, row) =>
      occupied.has(`${column},${row}`) ||
      pointInRects(gridToImage(calibration, { column: column + 0.5, row: row + 0.5 }), terrain),
    // A path can't leave the map to walk round something.
    isOpen: (column, row) => {
      const center = gridToImage(calibration, { column: column + 0.5, row: row + 0.5 });
      return center.x >= 0 && center.y >= 0 && center.x <= geometry.width && center.y <= geometry.height;
    }
  });
  if (!path) {
    // Past the search budget (a very long drag): fall back to the straight count, as before terrain existed.
    const straight = mapDistance(geometry, from, to);
    return straight ? { feet: straight.value, difficultFeet: 0 } : null;
  }
  return {
    feet: path.costCells * calibration.distancePerCell,
    difficultFeet: path.difficultSteps * calibration.distancePerCell
  };
}
