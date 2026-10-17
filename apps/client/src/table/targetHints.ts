import type { AnnotationShapeKind, EncounterToken } from "@vtt/domain";
import { imageToGridPreview, sizedShapePreview, snapShapePreview, type GridCalibration } from "../scene/gridPreview";

/**
 * Hints for choosing targets, computed from the positions this viewer was sent: how far a creature is, and who an
 * area would catch. The server decides range and who is caught when the action resolves; these only help the
 * choice, and they mirror the server's maths (`creatureDistance`, `tokensInTemplate`) so they agree with it.
 */

type Placed = Readonly<{ position: Readonly<{ x: number; y: number }> | null; sizeCells?: number }>;

/** Edge-to-edge distance in feet between two placed creatures on a calibrated grid, as the server measures it. */
export function creatureDistanceFeet(calibration: GridCalibration | null, a: Placed, b: Placed): number | null {
  if (!calibration || !a.position || !b.position) return null;
  const gridA = imageToGridPreview(calibration, a.position);
  const gridB = imageToGridPreview(calibration, b.position);
  const centerCells = Math.max(Math.abs(gridA.column - gridB.column), Math.abs(gridA.row - gridB.row));
  const edgeCells = Math.max(
    0,
    centerCells - (Math.max(1, a.sizeCells ?? 1) - 1) / 2 - (Math.max(1, b.sizeCells ?? 1) - 1) / 2
  );
  return Math.round(edgeCells * calibration.distancePerCell * 100) / 100;
}

const EPSILON = 1e-6;

/** The grid centres of every cell a token covers: odd footprints centre on a cell, even ones on an intersection. */
function footprintCells(calibration: GridCalibration, position: Readonly<{ x: number; y: number }>, sizeCells: number) {
  const grid = imageToGridPreview(calibration, position);
  const odd = sizeCells % 2 === 1;
  const left = odd ? Math.floor(grid.column) - (sizeCells - 1) / 2 : Math.round(grid.column) - sizeCells / 2;
  const top = odd ? Math.floor(grid.row) - (sizeCells - 1) / 2 : Math.round(grid.row) - sizeCells / 2;
  const cells: Array<{ column: number; row: number }> = [];
  for (let column = 0; column < sizeCells; column++)
    for (let row = 0; row < sizeCells; row++) cells.push({ column: left + column + 0.5, row: top + row + 0.5 });
  return cells;
}

/** The creatures whose space an area placed from `origin` to `target` covers, of those this viewer can see. With
 *  `sizeFeet` the area keeps that size wherever the drag points it, as the server sizes an action's own area. */
export function caughtByArea(
  calibration: GridCalibration,
  shape: AnnotationShapeKind,
  placed: Readonly<{ origin: Readonly<{ x: number; y: number }>; target: Readonly<{ x: number; y: number }> }>,
  widthFeet: number | null,
  tokens: readonly EncounterToken[],
  sizeFeet?: number
): string[] {
  const snapped =
    sizeFeet !== undefined
      ? sizedShapePreview(calibration, shape, placed.origin, placed.target, sizeFeet)
      : snapShapePreview(calibration, shape, placed.origin, placed.target);
  const from = imageToGridPreview(calibration, snapped.origin);
  const to = imageToGridPreview(calibration, snapped.target);
  const dx = to.column - from.column;
  const dy = to.row - from.row;
  const length = Math.hypot(dx, dy);
  const widthCells = (widthFeet ?? calibration.distancePerCell) / calibration.distancePerCell;
  const inside = (point: { column: number; row: number }) => {
    if (shape === "circle") return Math.hypot(point.column - from.column, point.row - from.row) <= length + EPSILON;
    if (shape === "square")
      return (
        point.column >= Math.min(from.column, to.column) - EPSILON &&
        point.column <= Math.max(from.column, to.column) + EPSILON &&
        point.row >= Math.min(from.row, to.row) - EPSILON &&
        point.row <= Math.max(from.row, to.row) + EPSILON
      );
    if (length === 0) return false;
    const along = ((point.column - from.column) * dx + (point.row - from.row) * dy) / length;
    const across = Math.abs((point.column - from.column) * -dy + (point.row - from.row) * dx) / length;
    if (along < -EPSILON || along > length + EPSILON) return false;
    return across <= (shape === "cone" ? along / 2 : widthCells / 2) + EPSILON;
  };
  return tokens.flatMap((token) =>
    token.position && footprintCells(calibration, token.position, token.sizeCells).some(inside) ? [token.actorId] : []
  );
}
