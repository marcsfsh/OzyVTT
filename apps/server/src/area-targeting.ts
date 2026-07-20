import type { AnnotationPoint, AnnotationShapeKind, ContentActionArea, GameState } from "@vtt/domain";
import { gridToImage, imageToGrid, type GridPoint, type SquareGridCalibration } from "./grid-calibration.js";

const EPSILON = 1e-6;

/**
 * Parse an area of effect out of a stat block's prose. SRD 2024 phrasing is consistent enough to
 * pattern-match ("60-foot Cone", "60-foot-long, 5-foot-wide Line", "20-foot-radius Sphere",
 * "15-foot Emanation", "10-foot Cube"). Returns null when the action names no area - the GM then
 * targets tokens directly. Line wording occasionally omits the width; default to a 5-ft (one-cell) line.
 */
export function parseAreaProse(description: string): ContentActionArea | null {
  const line = /(\d+)-foot(?:-long)?(?:,?\s*(\d+)-foot-wide)?\s+Line/i.exec(description);
  if (line) return { shape: "line", sizeFeet: Number(line[1]), widthFeet: line[2] ? Number(line[2]) : 5 };
  const cone = /(\d+)-foot\s+Cone/i.exec(description);
  if (cone) return { shape: "cone", sizeFeet: Number(cone[1]), widthFeet: null };
  const radial = /(\d+)-foot(?:-radius)?\s+(Sphere|Emanation)/i.exec(description);
  if (radial) return { shape: radial[2].toLowerCase() === "emanation" ? "emanation" : "sphere", sizeFeet: Number(radial[1]), widthFeet: null };
  const cube = /(\d+)-foot\s+Cube/i.exec(description);
  if (cube) return { shape: "cube", sizeFeet: Number(cube[1]), widthFeet: null };
  return null;
}

/** The grid-space centers of every cell a token's footprint covers (odd footprints center on a cell, even on an intersection - mirrors token-placement). */
function footprintCellCenters(calibration: SquareGridCalibration, position: AnnotationPoint, sizeCells: number): GridPoint[] {
  const grid = imageToGrid(calibration, position);
  const odd = sizeCells % 2 === 1;
  const topLeftColumn = odd ? Math.floor(grid.column) - (sizeCells - 1) / 2 : Math.round(grid.column) - sizeCells / 2;
  const topLeftRow = odd ? Math.floor(grid.row) - (sizeCells - 1) / 2 : Math.round(grid.row) - sizeCells / 2;
  const centers: GridPoint[] = [];
  for (let column = 0; column < sizeCells; column++) for (let row = 0; row < sizeCells; row++) centers.push({ column: topLeftColumn + column + 0.5, row: topLeftRow + row + 0.5 });
  return centers;
}

/**
 * Whether a grid point falls inside the template. Everything is computed in grid space (rotation is
 * baked into imageToGrid), so square/cube boxes stay axis-aligned and cones/lines project cleanly.
 * 5e cone: half-width at a distance equals that distance (width == length). 5e line: fixed width.
 */
function containmentTest(shape: AnnotationShapeKind, originG: GridPoint, targetG: GridPoint, widthCells: number): (point: GridPoint) => boolean {
  const dx = targetG.column - originG.column;
  const dy = targetG.row - originG.row;
  const length = Math.hypot(dx, dy);
  if (shape === "circle") return (point) => Math.hypot(point.column - originG.column, point.row - originG.row) <= length + EPSILON;
  if (shape === "square") {
    const [minC, maxC] = [Math.min(originG.column, targetG.column), Math.max(originG.column, targetG.column)];
    const [minR, maxR] = [Math.min(originG.row, targetG.row), Math.max(originG.row, targetG.row)];
    return (point) => point.column >= minC - EPSILON && point.column <= maxC + EPSILON && point.row >= minR - EPSILON && point.row <= maxR + EPSILON;
  }
  if (length === 0) return () => false;
  const axisX = dx / length, axisY = dy / length;
  return (point) => {
    const vx = point.column - originG.column, vy = point.row - originG.row;
    const along = vx * axisX + vy * axisY;
    const perpendicular = Math.abs(vx * -axisY + vy * axisX);
    if (along < -EPSILON || along > length + EPSILON) return false;
    return perpendicular <= (shape === "cone" ? along / 2 : widthCells / 2) + EPSILON;
  };
}

/**
 * Server-authoritative "who is under the blast": a token is caught iff ANY cell of its snapped
 * footprint has its center inside the template. `widthFeet` is only consulted for lines.
 */
export function tokensInTemplate(state: GameState, calibration: SquareGridCalibration, geometry: Readonly<{ origin: AnnotationPoint; target: AnnotationPoint }>, shape: AnnotationShapeKind, widthFeet: number | null): string[] {
  const originG = imageToGrid(calibration, geometry.origin);
  const targetG = imageToGrid(calibration, geometry.target);
  const inside = containmentTest(shape, originG, targetG, (widthFeet ?? calibration.distancePerCell) / calibration.distancePerCell);
  const caught: string[] = [];
  for (const token of state.combat.tokens) {
    if (token.position === null) continue;
    if (footprintCellCenters(calibration, token.position, token.sizeCells).some((center) => inside(center))) caught.push(token.actorId);
  }
  return caught;
}

/** Convenience for tests/preview: the image-space center of a grid cell. */
export function cellCenterImage(calibration: SquareGridCalibration, column: number, row: number): AnnotationPoint {
  return gridToImage(calibration, { column: column + 0.5, row: row + 0.5 });
}
