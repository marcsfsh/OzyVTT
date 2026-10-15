import { useEffect, useState } from "react";

export type GridCalibration = Readonly<{
  origin: { x: number; y: number };
  cellSizePx: number;
  rotationRadians: number;
  distancePerCell: number;
}>;

/** Fetches the active map's grid calibration (null on a gridless map) for preview maths. Not secret: grid-derived token sizing already reaches the client. */
export function useMapCalibration(
  assetId: string | null,
  token: string | null | undefined
): Readonly<{ status: "loading" | "ready" | "error"; calibration: GridCalibration | null }> {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; calibration: GridCalibration | null }>({
    status: "loading",
    calibration: null
  });
  useEffect(() => {
    if (!assetId || !token) {
      setState({ status: "loading", calibration: null });
      return;
    }
    setState({ status: "loading", calibration: null });
    const controller = new AbortController();
    fetch(`/api/v1/map-assets/${encodeURIComponent(assetId)}/grid`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("The grid could not be loaded.");
        const body = await response.json();
        setState({ status: "ready", calibration: body.data.calibration });
      })
      .catch((error) => {
        if (error.name !== "AbortError") setState({ status: "error", calibration: null });
      });
    return () => controller.abort();
  }, [assetId, token]);
  return state;
}

/**
 * Preview-only grid maths mirroring the server's snapping (`grid-calibration.ts`,
 * `map-measurement.ts`), for live feedback while the pointer moves. The server re-derives and
 * persists the real geometry when a drag ends, so drift here is only momentary.
 */
export function imageToGridPreview(calibration: GridCalibration, point: { x: number; y: number }) {
  const dx = point.x - calibration.origin.x;
  const dy = point.y - calibration.origin.y;
  const cosine = Math.cos(calibration.rotationRadians);
  const sine = Math.sin(calibration.rotationRadians);
  return {
    column: (cosine * dx + sine * dy) / calibration.cellSizePx,
    row: (-sine * dx + cosine * dy) / calibration.cellSizePx
  };
}
export function gridToImagePreview(calibration: GridCalibration, point: { column: number; row: number }) {
  const localX = point.column * calibration.cellSizePx;
  const localY = point.row * calibration.cellSizePx;
  const cosine = Math.cos(calibration.rotationRadians);
  const sine = Math.sin(calibration.rotationRadians);
  return {
    x: calibration.origin.x + cosine * localX - sine * localY,
    y: calibration.origin.y + sine * localX + cosine * localY
  };
}
export function snapCellCenterPreview(calibration: GridCalibration, point: { x: number; y: number }, sizeCells = 1) {
  // As on the server: odd footprints centre on a cell, even ones on a grid intersection.
  const centerOffset = sizeCells % 2 === 0 ? 0 : 0.5;
  const grid = imageToGridPreview(calibration, point);
  return gridToImagePreview(calibration, {
    column: Math.floor(grid.column) + centerOffset,
    row: Math.floor(grid.row) + centerOffset
  });
}
/** Whole-cell Chebyshev distance in feet between two image points (diagonals cost one step), the server's default measurement rule. */
export function chebyshevFeetPreview(
  calibration: GridCalibration,
  a: { x: number; y: number },
  b: { x: number; y: number }
) {
  const gridA = imageToGridPreview(calibration, a);
  const gridB = imageToGridPreview(calibration, b);
  return (
    Math.round(Math.max(Math.abs(gridB.column - gridA.column), Math.abs(gridB.row - gridA.row))) *
    calibration.distancePerCell
  );
}
/** The `"col,row"` cells a token's footprint covers, given its snapped position and sizeCells (odd footprints centre on a cell, even on an intersection, as on the server). Preview-only. */
export function footprintCells(
  calibration: GridCalibration,
  position: { x: number; y: number },
  sizeCells = 1
): Set<string> {
  const grid = imageToGridPreview(calibration, position);
  const odd = sizeCells % 2 === 1;
  const topLeftCol = odd ? Math.floor(grid.column) - (sizeCells - 1) / 2 : Math.round(grid.column) - sizeCells / 2;
  const topLeftRow = odd ? Math.floor(grid.row) - (sizeCells - 1) / 2 : Math.round(grid.row) - sizeCells / 2;
  const cells = new Set<string>();
  for (let column = 0; column < sizeCells; column++)
    for (let row = 0; row < sizeCells; row++) cells.add(`${topLeftCol + column},${topLeftRow + row}`);
  return cells;
}
/**
 * Every grid cell the straight segment from `a` to `b` crosses (Amanatides–Woo traversal), so the
 * occupied-cell count matches what the ruler visibly passes over. At an exact lattice corner it steps
 * diagonally.
 */
function cellsOnGridSegment(ax: number, ay: number, bx: number, by: number): string[] {
  let column = Math.floor(ax),
    row = Math.floor(ay);
  const endColumn = Math.floor(bx),
    endRow = Math.floor(by);
  const deltaX = bx - ax,
    deltaY = by - ay;
  const stepX = Math.sign(deltaX),
    stepY = Math.sign(deltaY);
  const tDeltaX = deltaX !== 0 ? Math.abs(1 / deltaX) : Infinity;
  const tDeltaY = deltaY !== 0 ? Math.abs(1 / deltaY) : Infinity;
  let tMaxX = deltaX !== 0 ? (stepX > 0 ? Math.floor(ax) + 1 - ax : ax - Math.floor(ax)) * tDeltaX : Infinity;
  let tMaxY = deltaY !== 0 ? (stepY > 0 ? Math.floor(ay) + 1 - ay : ay - Math.floor(ay)) * tDeltaY : Infinity;
  const cells = [`${column},${row}`];
  for (let guard = 0; (column !== endColumn || row !== endRow) && guard < 1000; guard++) {
    if (Math.abs(tMaxX - tMaxY) < 1e-9) {
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
      column += stepX;
      row += stepY;
    } else if (tMaxX < tMaxY) {
      tMaxX += tDeltaX;
      column += stepX;
    } else {
      tMaxY += tDeltaY;
      row += stepY;
    }
    cells.push(`${column},${row}`);
  }
  return cells;
}

/**
 * 5e movement cost through occupied cells, display-only: base is the whole-cell Chebyshev count, plus
 * one cell for every cell the straight path crosses (excluding start and destination) that another
 * token occupies. The client only has the tokens it may see, so nothing hidden leaks into the count.
 */
export function occupiedPathCost(
  calibration: GridCalibration,
  origin: { x: number; y: number },
  target: { x: number; y: number },
  occupied: ReadonlySet<string>
): { baseFeet: number; penaltyFeet: number } {
  const from = imageToGridPreview(calibration, origin);
  const to = imageToGridPreview(calibration, target);
  const originCell = `${Math.floor(from.column)},${Math.floor(from.row)}`;
  const destCell = `${Math.floor(to.column)},${Math.floor(to.row)}`;
  // Chebyshev distance from the raw centre-to-centre delta, as in chebyshevFeetPreview. Floor
  // differences are unstable for even footprints (centred on intersections, where float noise flips
  // the floor).
  const steps = Math.round(Math.max(Math.abs(to.column - from.column), Math.abs(to.row - from.row)));
  let penaltyCells = 0;
  for (const cell of cellsOnGridSegment(from.column, from.row, to.column, to.row)) {
    if (cell !== originCell && cell !== destCell && occupied.has(cell)) penaltyCells++;
  }
  return { baseFeet: steps * calibration.distancePerCell, penaltyFeet: penaltyCells * calibration.distancePerCell };
}

export type SnappedGeometry = Readonly<{
  origin: { x: number; y: number };
  target: { x: number; y: number };
  feet: number;
}>;

/**
 * Client mirrors of the server's `measurementGeometry`/`squareGeometry`/`radialGeometry`
 * (`apps/server/src/annotations.ts`), so the drag preview snaps exactly as the saved result will.
 */
export function snapMeasurementPreview(
  calibration: GridCalibration,
  origin: { x: number; y: number },
  target: { x: number; y: number }
): SnappedGeometry {
  const from = snapCellCenterPreview(calibration, origin);
  const to = snapCellCenterPreview(calibration, target);
  return { origin: from, target: to, feet: chebyshevFeetPreview(calibration, from, to) };
}
export function snapShapePreview(
  calibration: GridCalibration,
  shape: "circle" | "cone" | "line" | "square",
  origin: { x: number; y: number },
  target: { x: number; y: number }
): SnappedGeometry {
  if (shape === "square") {
    const start = imageToGridPreview(calibration, origin);
    const raw = imageToGridPreview(calibration, target);
    const startSnapped = { column: Math.round(start.column), row: Math.round(start.row) };
    const side = Math.max(1, Math.round(Math.max(Math.abs(raw.column - start.column), Math.abs(raw.row - start.row))));
    const end = {
      column: startSnapped.column + (raw.column < start.column ? -1 : 1) * side,
      row: startSnapped.row + (raw.row < start.row ? -1 : 1) * side
    };
    return {
      origin: gridToImagePreview(calibration, startSnapped),
      target: gridToImagePreview(calibration, end),
      feet: side * calibration.distancePerCell
    };
  }
  // Cone/line: both ends snap to cell centres, so the shape can point in any direction.
  if (shape === "cone" || shape === "line") {
    const from = snapCellCenterPreview(calibration, origin);
    let to = snapCellCenterPreview(calibration, target);
    if (to.x === from.x && to.y === from.y) {
      const angle = Math.atan2(target.y - origin.y, target.x - origin.x) || 0;
      to = snapCellCenterPreview(calibration, {
        x: from.x + Math.cos(angle) * calibration.cellSizePx,
        y: from.y + Math.sin(angle) * calibration.cellSizePx
      });
    }
    const coneCells = Math.max(1, Math.round(Math.hypot(to.x - from.x, to.y - from.y) / calibration.cellSizePx));
    return { origin: from, target: to, feet: coneCells * calibration.distancePerCell };
  }
  // Circle: origin snaps to a cell center, radius snaps to whole cells.
  const snappedOrigin = snapCellCenterPreview(calibration, origin);
  const pixelDistance = Math.hypot(target.x - snappedOrigin.x, target.y - snappedOrigin.y);
  const cells = Math.max(1, Math.round(pixelDistance / calibration.cellSizePx));
  const sizePx = cells * calibration.cellSizePx;
  const angle = pixelDistance === 0 ? 0 : Math.atan2(target.y - snappedOrigin.y, target.x - snappedOrigin.x);
  return {
    origin: snappedOrigin,
    target: { x: snappedOrigin.x + Math.cos(angle) * sizePx, y: snappedOrigin.y + Math.sin(angle) * sizePx },
    feet: cells * calibration.distancePerCell
  };
}
