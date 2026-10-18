import { useEffect, useState } from "react";

export type GridCalibration = Readonly<{
  origin: { x: number; y: number };
  cellSizePx: number;
  rotationRadians: number;
  distancePerCell: number;
}>;

/** The last grid read per map, so the map and the panel beside it share one read and a remount starts ready. */
const calibrations = new Map<string, GridCalibration | null>();

/** Fetches the active map's grid calibration (null on a gridless map) for preview maths. Not secret: grid-derived token sizing already reaches the client. */
export function useMapCalibration(
  assetId: string | null,
  token: string | null | undefined
): Readonly<{ status: "loading" | "ready" | "error"; calibration: GridCalibration | null }> {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; calibration: GridCalibration | null }>(
    () =>
      assetId !== null && calibrations.has(assetId)
        ? { status: "ready", calibration: calibrations.get(assetId) ?? null }
        : { status: "loading", calibration: null }
  );
  useEffect(() => {
    if (!assetId || !token) {
      setState({ status: "loading", calibration: null });
      return;
    }
    if (calibrations.has(assetId)) setState({ status: "ready", calibration: calibrations.get(assetId) ?? null });
    else setState({ status: "loading", calibration: null });
    const controller = new AbortController();
    fetch(`/api/v1/map-assets/${encodeURIComponent(assetId)}/grid`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("The grid could not be loaded.");
        const body = await response.json();
        calibrations.set(assetId, body.data.calibration);
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

/**
 * Mirror of the server's `templateOfArea`: an action's area keeps its own size ("a 20-foot-radius Sphere"), so a drag
 * only places and points it. The shape snaps as a drawn one does, then reaches `sizeFeet` along the drag.
 */
export function sizedShapePreview(
  calibration: GridCalibration,
  shape: "circle" | "cone" | "line" | "square",
  origin: { x: number; y: number },
  target: { x: number; y: number },
  sizeFeet: number
): SnappedGeometry {
  const cells = Math.max(1, Math.round(sizeFeet / calibration.distancePerCell));
  const placed = snapShapePreview(calibration, shape, origin, target);
  if (shape === "square") {
    const start = imageToGridPreview(calibration, placed.origin);
    const end = imageToGridPreview(calibration, placed.target);
    const far = gridToImagePreview(calibration, {
      column: start.column + (end.column < start.column ? -cells : cells),
      row: start.row + (end.row < start.row ? -cells : cells)
    });
    return snapShapePreview(calibration, shape, placed.origin, far);
  }
  const dx = placed.target.x - placed.origin.x;
  const dy = placed.target.y - placed.origin.y;
  const length = Math.hypot(dx, dy) || 1;
  const reach = cells * calibration.cellSizePx;
  return snapShapePreview(calibration, shape, placed.origin, {
    x: placed.origin.x + (dx / length) * reach,
    y: placed.origin.y + (dy / length) * reach
  });
}
