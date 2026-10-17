import type { CombatState, EncounterTokenPosition, GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { footprintCenter, footprintOrigin, movementPath, pointInRects, spacePassage } from "@vtt/rules-5e";
import { isIncapacitated } from "./condition-rules.js";
import { areAllies } from "./creature-sides.js";
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

/** Terrain as players and the table screen get it: only what the fog reveals, and with dynamic vision only what the
 *  party has seen (`seen`, disjoint rects), so unrevealed ground keeps its layout. Difficult terrain out of sight is
 *  still charged when someone walks into it. */
export function visibleTerrain(
  combat: Pick<CombatState, "fog" | "terrain">,
  seen?: readonly Rect[]
): CombatState["terrain"] {
  const revealed = revealedRegion(combat.fog);
  const difficult = combat.terrain.difficult.map((rect) => ({ ...rect }));
  const unfogged = revealed === "everything" ? difficult : intersectRegions(difficult, revealed);
  return { difficult: seen === undefined ? unfogged : intersectRegions(unfogged, seen) };
}

type Point = Readonly<{ x: number; y: number }>;

export type MovementCost = Readonly<{
  feet: number;
  /** Feet of `feet` spent on difficult terrain (the extra cell each such step costs). */
  difficultFeet: number;
  /** The mover's centre at each step, start to end, in image pixels; a straight segment sampled every half cell on
   *  a gridless map. Opportunity attacks are read along it; absent, at its two ends. */
  path?: readonly Point[];
  /** No way there: creatures the mover can't pass close it off (SRD "Moving around Other Creatures"). */
  blocked?: true;
}>;

export type MovementCostOptions = Readonly<{
  /** Feet added to every foot moved: 1 while crawling, climbing or swimming without the speed, or dragging. */
  extraPerStep?: number;
  /** Creatures that move with the mover (those it drags), whose spaces are no obstacle. */
  carried?: readonly string[];
  resolveDefinition?: (definitionId: string) => ActorDefinition | undefined;
}>;

/**
 * What a move costs the mover. On a calibrated grid: the cheapest path between the two snapped positions, with
 * painted terrain difficult and other creatures' spaces open, difficult or closed as the SRD's "Moving around Other
 * Creatures" says (`spacePassage`; allies by `areAllies`), so walking round a patch costs only the steps taken.
 * Hidden creatures never count, because a player's preview can't know they're there. A scaled gridless map measures
 * straight; an unmeasurable map returns null.
 */
export function movementCost(
  state: GameState,
  geometry: TokenMapGeometry,
  actorId: string,
  from: EncounterTokenPosition,
  to: EncounterTokenPosition,
  options: MovementCostOptions = {}
): MovementCost | null {
  const extra = Math.max(0, options.extraPerStep ?? 0);
  const calibration = geometry.calibration;
  if (!calibration) {
    const straight = mapDistance(geometry, from, to);
    return straight
      ? { feet: straight.value * (1 + extra), difficultFeet: 0, path: sampled(from, to, straight.value) }
      : null;
  }
  const mover = state.actors.find((candidate) => candidate.id === actorId);
  const sizeCells = state.combat.tokens.find((token) => token.actorId === actorId)?.sizeCells ?? 1;
  const difficultCells = new Set<string>();
  const closedCells = new Set<string>();
  for (const token of state.combat.tokens) {
    if (token.actorId === actorId || !token.position || options.carried?.includes(token.actorId)) continue;
    const occupant = state.actors.find((candidate) => candidate.id === token.actorId);
    if (!mover || !occupant || occupant.visibility === "gm-only") continue;
    const passage = spacePassage({
      ally: areAllies(mover, occupant, options.resolveDefinition),
      incapacitated: isIncapacitated(occupant),
      moverSize: mover.size,
      occupantSize: occupant.size
    });
    if (passage === "open") continue;
    const cells = passage === "blocked" ? closedCells : difficultCells;
    const origin = footprintOrigin(imageToGrid(calibration, token.position), token.sizeCells);
    for (let column = 0; column < token.sizeCells; column++)
      for (let row = 0; row < token.sizeCells; row++) cells.add(`${origin.column + column},${origin.row + row}`);
  }
  const terrain = state.combat.terrain.difficult;
  const path = movementPath({
    from: footprintOrigin(imageToGrid(calibration, from), sizeCells),
    to: footprintOrigin(imageToGrid(calibration, to), sizeCells),
    sizeCells,
    isDifficult: (column, row) =>
      difficultCells.has(`${column},${row}`) ||
      pointInRects(gridToImage(calibration, { column: column + 0.5, row: row + 0.5 }), terrain),
    // A path can't leave the map to walk round something, nor pass a creature that bars the way.
    isOpen: (column, row) => {
      if (closedCells.has(`${column},${row}`)) return false;
      const center = gridToImage(calibration, { column: column + 0.5, row: row + 0.5 });
      return center.x >= 0 && center.y >= 0 && center.x <= geometry.width && center.y <= geometry.height;
    },
    extraPerStep: extra
  });
  if (!path) {
    // Past the search budget (a very long drag): fall back to the straight count, as before terrain existed.
    const straight = mapDistance(geometry, from, to);
    return straight
      ? { feet: straight.value * (1 + extra), difficultFeet: 0, path: sampled(from, to, straight.value) }
      : null;
  }
  if (path.blocked) return { feet: 0, difficultFeet: 0, path: [], blocked: true };
  return {
    feet: path.costCells * calibration.distancePerCell,
    difficultFeet: path.difficultSteps * calibration.distancePerCell,
    path: path.steps.map((step) => gridToImage(calibration, footprintCenter(step, sizeCells)))
  };
}

/** Points along a straight move, every 2.5 feet or so, start and end included. */
function sampled(from: Point, to: Point, feet: number): Point[] {
  const count = Math.max(1, Math.ceil(feet / 2.5));
  return Array.from({ length: count + 1 }, (_, index) => ({
    x: from.x + ((to.x - from.x) * index) / count,
    y: from.y + ((to.y - from.y) * index) / count
  }));
}
