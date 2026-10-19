import type { AnnotationPoint, AnnotationShapeKind, GameState } from "@vtt/domain";
import { clearLine } from "./vision/geometry.js";
import { segmentsOf } from "./vision/sight.js";
import { gridToImage, imageToGrid, type GridPoint, type SquareGridCalibration } from "./grid-calibration.js";

const EPSILON = 1e-6;

/** The grid-space centers of every cell a token's footprint covers (odd footprints center on a cell, even on an intersection: mirrors token-placement). */
export function footprintCellCenters(
  calibration: SquareGridCalibration,
  position: AnnotationPoint,
  sizeCells: number
): GridPoint[] {
  const grid = imageToGrid(calibration, position);
  const odd = sizeCells % 2 === 1;
  const topLeftColumn = odd ? Math.floor(grid.column) - (sizeCells - 1) / 2 : Math.round(grid.column) - sizeCells / 2;
  const topLeftRow = odd ? Math.floor(grid.row) - (sizeCells - 1) / 2 : Math.round(grid.row) - sizeCells / 2;
  const centers: GridPoint[] = [];
  for (let column = 0; column < sizeCells; column++)
    for (let row = 0; row < sizeCells; row++)
      centers.push({ column: topLeftColumn + column + 0.5, row: topLeftRow + row + 0.5 });
  return centers;
}

/**
 * Whether a grid point falls inside the template. Everything is computed in grid space (rotation is
 * baked into imageToGrid), so square/cube boxes stay axis-aligned and cones/lines project cleanly.
 * 5e cone: half-width at a distance equals that distance (width == length). 5e line: fixed width.
 */
function containmentTest(
  shape: AnnotationShapeKind,
  originG: GridPoint,
  targetG: GridPoint,
  widthCells: number
): (point: GridPoint) => boolean {
  const dx = targetG.column - originG.column;
  const dy = targetG.row - originG.row;
  const length = Math.hypot(dx, dy);
  if (shape === "circle")
    return (point) => Math.hypot(point.column - originG.column, point.row - originG.row) <= length + EPSILON;
  if (shape === "square") {
    const [minC, maxC] = [Math.min(originG.column, targetG.column), Math.max(originG.column, targetG.column)];
    const [minR, maxR] = [Math.min(originG.row, targetG.row), Math.max(originG.row, targetG.row)];
    return (point) =>
      point.column >= minC - EPSILON &&
      point.column <= maxC + EPSILON &&
      point.row >= minR - EPSILON &&
      point.row <= maxR + EPSILON;
  }
  if (length === 0) return () => false;
  const axisX = dx / length,
    axisY = dy / length;
  return (point) => {
    const vx = point.column - originG.column,
      vy = point.row - originG.row;
    const along = vx * axisX + vy * axisY;
    const perpendicular = Math.abs(vx * -axisY + vy * axisX);
    if (along < -EPSILON || along > length + EPSILON) return false;
    return perpendicular <= (shape === "cone" ? along / 2 : widthCells / 2) + EPSILON;
  };
}

/**
 * Server-authoritative "who is under the blast": a token is caught iff any cell of its snapped
 * footprint has its center inside the template. `widthFeet` is only consulted for lines.
 */
export function tokensInTemplate(
  state: GameState,
  calibration: SquareGridCalibration,
  geometry: Readonly<{ origin: AnnotationPoint; target: AnnotationPoint }>,
  shape: AnnotationShapeKind,
  widthFeet: number | null
): string[] {
  const originG = imageToGrid(calibration, geometry.origin);
  const targetG = imageToGrid(calibration, geometry.target);
  const inside = containmentTest(
    shape,
    originG,
    targetG,
    (widthFeet ?? calibration.distancePerCell) / calibration.distancePerCell
  );
  // SRD Area of Effect: "If all straight lines from the point of origin to a location are blocked, that location isn't
  // included." With dynamic vision on, walls, closed doors and windows block them.
  const reaches = blockedFromOrigin(state, calibration, geometry, shape);
  const caught: string[] = [];
  for (const token of state.combat.tokens) {
    if (token.position === null) continue;
    if (
      footprintCellCenters(calibration, token.position, token.sizeCells).some(
        (center) => inside(center) && reaches(center)
      )
    )
      caught.push(token.actorId);
  }
  return caught;
}

/** Whether a straight line from an area's point of origin reaches a cell (its centre or a point near a corner):
 *  always, with vision off. A Sphere, Cylinder or Emanation spreads from its centre, a Cone or Line from its start, and
 *  a Cube here from its middle. */
function blockedFromOrigin(
  state: GameState,
  calibration: SquareGridCalibration,
  geometry: Readonly<{ origin: AnnotationPoint; target: AnnotationPoint }>,
  shape: AnnotationShapeKind
): (cell: GridPoint) => boolean {
  const vision = state.combat.vision;
  if (!vision?.enabled || vision.walls.length === 0) return () => true;
  // Bars (Forcecage's cage) stop no line: attacks, spells and areas go between them.
  const obstacles = vision.walls
    .filter((wall) => (wall.kind !== "door" || wall.open !== true) && wall.bars !== true)
    .flatMap(segmentsOf);
  const origin =
    shape === "square"
      ? { x: (geometry.origin.x + geometry.target.x) / 2, y: (geometry.origin.y + geometry.target.y) / 2 }
      : geometry.origin;
  return (cell) =>
    [0, 0.35, -0.35].some((dx) =>
      [0, 0.35, -0.35].some(
        (dy) =>
          (dx === 0) === (dy === 0) &&
          clearLine(origin, gridToImage(calibration, { column: cell.column + dx, row: cell.row + dy }), obstacles)
      )
    );
}

/** Whether a footprint at `position` would be caught by the template, by the same rule as `tokensInTemplate`: any of
 *  its cells' centres inside. For a creature moving through a lingering area, point by point. */
export function footprintInTemplate(
  calibration: SquareGridCalibration,
  geometry: Readonly<{ origin: AnnotationPoint; target: AnnotationPoint }>,
  shape: AnnotationShapeKind,
  widthFeet: number | null,
  position: AnnotationPoint,
  sizeCells: number
): boolean {
  const inside = containmentTest(
    shape,
    imageToGrid(calibration, geometry.origin),
    imageToGrid(calibration, geometry.target),
    (widthFeet ?? calibration.distancePerCell) / calibration.distancePerCell
  );
  return footprintCellCenters(calibration, position, sizeCells).some((center) => inside(center));
}

/** Convenience for tests/preview: the image-space center of a grid cell. */
export function cellCenterImage(calibration: SquareGridCalibration, column: number, row: number): AnnotationPoint {
  return gridToImage(calibration, { column: column + 0.5, row: row + 0.5 });
}

/** SRD areas of effect: an Emanation's creature, and the point a Cone or Line starts from, aren't in the area, nor is
 *  the caster of a Self spell (Thunderwave's Cube); a Sphere, Cylinder or Cube placed over its caster catches them. */
export function areaOriginatesFromCaster(shape: string, spellRange: string | null | undefined): boolean {
  return shape === "emanation" || shape === "cone" || shape === "line" || /^self\b/i.test(spellRange ?? "");
}
