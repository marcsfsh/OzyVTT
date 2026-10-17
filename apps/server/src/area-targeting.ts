import type { AnnotationPoint, AnnotationShapeKind, GameState } from "@vtt/domain";
import { gridToImage, imageToGrid, type GridPoint, type SquareGridCalibration } from "./grid-calibration.js";

const EPSILON = 1e-6;

/** The grid-space centers of every cell a token's footprint covers (odd footprints center on a cell, even on an intersection - mirrors token-placement). */
function footprintCellCenters(
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
  const caught: string[] = [];
  for (const token of state.combat.tokens) {
    if (token.position === null) continue;
    if (footprintCellCenters(calibration, token.position, token.sizeCells).some((center) => inside(center)))
      caught.push(token.actorId);
  }
  return caught;
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
