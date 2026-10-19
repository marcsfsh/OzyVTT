import type { CombatState, EncounterTokenPosition, GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import {
  climbCells,
  costWithClimb,
  footprintCenter,
  footprintOrigin,
  footprintStepBlocked,
  movementPath,
  pointInRects,
  segmentsMeet,
  spacePassage,
  spaceHeightCells,
  spansOverlap,
  wallCrossing
} from "@vtt/rules-5e";
import { isIncapacitated } from "./condition-rules.js";
import { areAllies } from "./creature-sides.js";
import { holdsFeature } from "./class-features.js";
import { CommandRejectedError } from "./game-store.js";
import { gridToImage, imageToGrid } from "./grid-calibration.js";
import { layerSlice, normalizedRect, type LayerMapGeometry, type PaintRectInput } from "./map-layers.js";
import { mapDistance } from "./movement-narration.js";
import { revealedRegion } from "./fog.js";
import { intersectRegions, subtractRect, unionRect, type Rect } from "./rect-region.js";
import type { TokenMapGeometry } from "./token-placement.js";
import { blocksMovement } from "./vision/sight.js";

/** Difficult terrain (SRD 5.2.1): the GM paints it per scene; entering a cell whose centre lies in it costs
 *  double. Stored as disjoint rects, so marking an area twice costs nothing and clearing can cut any shape. */

const MAX_TERRAIN_RECTS = 1000;
const LIVE_REFUSAL = "That scene is live. Edit its terrain on the table.";

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
    throw new CommandRejectedError("The terrain is too finely cut up. Clear it and mark it again in larger areas.");
  slice.write({ difficult });
}

export function resetTerrain(state: GameState, sceneId: string | undefined) {
  const slice = layerSlice(state, sceneId, "terrain", LIVE_REFUSAL);
  slice.write({ difficult: [] });
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
  /** No way there: walls, or creatures the mover can't pass (SRD "Moving around Other Creatures"), close it off. */
  blocked?: true;
}>;

export type MovementCostOptions = Readonly<{
  /** Feet added to every foot moved: 1 while crawling, climbing or swimming without the speed, or dragging. */
  extraPerStep?: number;
  /** Creatures that move with the mover (those it drags), whose spaces are no obstacle. */
  carried?: readonly string[];
  resolveDefinition?: (definitionId: string) => ActorDefinition | undefined;
  /** With dynamic vision on, whether the mover perceives a creature; one it doesn't is no obstacle to its path, as a
   *  hidden one isn't, so a refusal can't give it away. Every creature counts when absent. */
  perceives?: (actorId: string) => boolean;
  /** The mover may stop in other creatures' spaces (an air elemental's Air Form), so none bars its way. */
  passesCreatures?: boolean;
  /** Whether the mover's Speed is halved with its centre at this point (Spirit Guardians' Emanation). */
  halvedAt?: (position: Point, sizeCells: number) => boolean;
  /** The mover's height as it sets off and where the move ends, in feet; on the ground when absent. */
  altitude?: Readonly<{ fromFeet: number; toFeet: number }>;
}>;

/** The movement-blocking walls of the live scene (walls, closed doors, windows) in grid units, while its dynamic
 *  vision is on; none otherwise. */
export function movementWalls(state: GameState, calibration: NonNullable<TokenMapGeometry["calibration"]>) {
  const vision = state.combat.vision;
  if (!vision.enabled) return [];
  return vision.walls
    .filter(blocksMovement)
    .map((wall) => ({ a: imageToGrid(calibration, wall.a), b: imageToGrid(calibration, wall.b) }));
}

/**
 * What a move costs the mover. On a calibrated grid: the cheapest path between the two snapped positions, with
 * painted terrain difficult and other creatures' spaces open, difficult or closed as the SRD's "Moving around Other
 * Creatures" says (`spacePassage`; allies by `areAllies`), so walking round a patch costs only the steps taken.
 * Hidden creatures never count, because a player's preview can't know they're there. With dynamic vision on, walls,
 * closed doors and windows bar the way too. A scaled gridless map measures straight; an unmeasurable map returns null.
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
  const rise = options.altitude ? options.altitude.toFeet - options.altitude.fromFeet : 0;
  if (!calibration) {
    // No cells to path round a wall on a gridless map: a straight move through one is barred.
    if (straightThroughWall(state, from, to)) return { feet: 0, difficultFeet: 0, path: [], blocked: true };
    const straight = mapDistance(geometry, from, to);
    return straight
      ? {
          feet: Math.hypot(straight.value, rise) * (1 + extra),
          difficultFeet: 0,
          path: sampled(from, to, straight.value)
        }
      : null;
  }
  const mover = state.actors.find((candidate) => candidate.id === actorId);
  const sizeCells = state.combat.tokens.find((token) => token.actorId === actorId)?.sizeCells ?? 1;
  // Height: the mover's way runs from its lowest point to the top of its space at its highest. A creature whose space
  // lies wholly above or below it is no obstacle, and a mover off the ground the whole way passes over painted terrain.
  const feetPerCell = calibration.distancePerCell;
  const lowFeet = Math.min(options.altitude?.fromFeet ?? 0, options.altitude?.toFeet ?? 0);
  const highFeet =
    Math.max(options.altitude?.fromFeet ?? 0, options.altitude?.toFeet ?? 0) +
    spaceHeightCells(sizeCells) * feetPerCell;
  const aloft = lowFeet > 0;
  const difficultCells = new Set<string>();
  const closedCells = new Set<string>();
  for (const token of state.combat.tokens) {
    if (token.actorId === actorId || !token.position || options.carried?.includes(token.actorId)) continue;
    const occupant = state.actors.find((candidate) => candidate.id === token.actorId);
    if (!mover || !occupant || occupant.visibility === "gm-only") continue;
    if (options.perceives && !options.perceives(occupant.id)) continue;
    const occupantLow = token.altitudeFeet ?? 0;
    if (!spansOverlap(lowFeet, highFeet, occupantLow, occupantLow + spaceHeightCells(token.sizeCells) * feetPerCell))
      continue;
    const printed = spacePassage({
      ally: areAllies(mover, occupant, options.resolveDefinition),
      incapacitated: isIncapacitated(occupant),
      moverSize: mover.size,
      occupantSize: occupant.size
    });
    // A mover that can stop in a creature's space, or a swarm's space ("and vice versa"), is never barred; it is still
    // another creature's space, so it costs as Difficult Terrain.
    const swarm =
      occupant.definitionId !== null &&
      occupant.definitionId !== undefined &&
      holdsFeature(options.resolveDefinition?.(occupant.definitionId), "swarm", "Swarm");
    const passage = printed === "blocked" && (options.passesCreatures || swarm) ? "difficult" : printed;
    if (passage === "open") continue;
    const cells = passage === "blocked" ? closedCells : difficultCells;
    const origin = footprintOrigin(imageToGrid(calibration, token.position), token.sizeCells);
    for (let column = 0; column < token.sizeCells; column++)
      for (let row = 0; row < token.sizeCells; row++) cells.add(`${origin.column + column},${origin.row + row}`);
  }
  const terrain = state.combat.terrain.difficult;
  const crosses = wallCrossing(movementWalls(state, calibration));
  const halvedAt = options.halvedAt;
  const path = movementPath({
    from: footprintOrigin(imageToGrid(calibration, from), sizeCells),
    to: footprintOrigin(imageToGrid(calibration, to), sizeCells),
    sizeCells,
    isDifficult: (column, row) =>
      difficultCells.has(`${column},${row}`) ||
      (!aloft && pointInRects(gridToImage(calibration, { column: column + 0.5, row: row + 0.5 }), terrain)),
    // A path can't leave the map to walk round something, nor pass a creature that bars the way.
    isOpen: (column, row) => {
      if (closedCells.has(`${column},${row}`)) return false;
      const center = gridToImage(calibration, { column: column + 0.5, row: row + 0.5 });
      return center.x >= 0 && center.y >= 0 && center.x <= geometry.width && center.y <= geometry.height;
    },
    isStepOpen: (stepFrom, stepTo) => !footprintStepBlocked(stepFrom, stepTo, sizeCells, crosses),
    extraPerStep: extra,
    ...(halvedAt
      ? {
          isHalved: (column: number, row: number) =>
            halvedAt(gridToImage(calibration, footprintCenter({ column, row }, sizeCells)), sizeCells)
        }
      : {})
  });
  const climb = climbCells(0, rise, feetPerCell);
  if (!path) {
    // Past the search budget (a very long drag): fall back to the straight count, as before terrain existed.
    const straight = mapDistance(geometry, from, to);
    return straight
      ? {
          feet: Math.max(straight.value, Math.abs(rise)) * (1 + extra),
          difficultFeet: 0,
          path: sampled(from, to, straight.value)
        }
      : null;
  }
  if (path.blocked) return { feet: 0, difficultFeet: 0, path: [], blocked: true };
  return {
    feet: costWithClimb(path.costCells, path.steps.length - 1, climb, extra) * feetPerCell,
    difficultFeet: path.difficultSteps * calibration.distancePerCell,
    path: path.steps.map((step) => gridToImage(calibration, footprintCenter(step, sizeCells)))
  };
}

function straightThroughWall(state: GameState, from: Point, to: Point): boolean {
  const vision = state.combat.vision;
  if (!vision.enabled) return false;
  const grid = (point: Point) => ({ column: point.x, row: point.y });
  return vision.walls
    .filter(blocksMovement)
    .some((wall) => segmentsMeet(grid(from), grid(to), grid(wall.a), grid(wall.b)));
}

/** Points along a straight move, every 2.5 feet or so, start and end included. */
function sampled(from: Point, to: Point, feet: number): Point[] {
  const count = Math.max(1, Math.ceil(feet / 2.5));
  return Array.from({ length: count + 1 }, (_, index) => ({
    x: from.x + ((to.x - from.x) * index) / count,
    y: from.y + ((to.y - from.y) * index) / count
  }));
}
