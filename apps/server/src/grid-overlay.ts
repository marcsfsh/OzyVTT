import {
  gridToImage,
  imageToGrid,
  validateSquareGridCalibration,
  type ImagePoint,
  type SquareGridCalibration
} from "./grid-calibration.js";

export type ImageViewport = Readonly<{
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}>;

export type GridOverlayLine = Readonly<{
  axis: "column" | "row";
  index: number;
  start: ImagePoint;
  end: ImagePoint;
  major: boolean;
}>;

export type GridOverlayOptions = Readonly<{
  majorEvery?: number;
  maxLines?: number;
  overscanCells?: number;
}>;

const DEFAULT_MAX_LINES = 2_000;
const ABSOLUTE_MAX_LINES = 10_000;
const CLIP_EPSILON = 1e-9;

function finite(value: number, label: string) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
}

function validateViewport(viewport: ImageViewport) {
  finite(viewport.minX, "Viewport minimum x");
  finite(viewport.minY, "Viewport minimum y");
  finite(viewport.maxX, "Viewport maximum x");
  finite(viewport.maxY, "Viewport maximum y");
  if (viewport.minX >= viewport.maxX || viewport.minY >= viewport.maxY) throw new Error("Viewport must have positive width and height.");
  return viewport;
}

function positiveInteger(value: number, label: string, maximum: number) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`${label} must be an integer from 1 to ${maximum}.`);
  return value;
}

function nonNegativeInteger(value: number, label: string, maximum: number) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) throw new Error(`${label} must be an integer from 0 to ${maximum}.`);
  return value;
}

/** Clips a finite segment to an axis-aligned viewport using Liang–Barsky. */
function clipSegment(start: ImagePoint, end: ImagePoint, viewport: ImageViewport) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let minimum = 0;
  let maximum = 1;
  const edges: readonly [number, number][] = [
    [-dx, start.x - viewport.minX],
    [dx, viewport.maxX - start.x],
    [-dy, start.y - viewport.minY],
    [dy, viewport.maxY - start.y]
  ];
  for (const [direction, distance] of edges) {
    if (Math.abs(direction) < CLIP_EPSILON) {
      if (distance < 0) return null;
      continue;
    }
    const ratio = distance / direction;
    if (direction < 0) minimum = Math.max(minimum, ratio);
    else maximum = Math.min(maximum, ratio);
    if (minimum - maximum > CLIP_EPSILON) return null;
  }
  return {
    start: { x: start.x + minimum * dx, y: start.y + minimum * dy },
    end: { x: start.x + maximum * dx, y: start.y + maximum * dy }
  };
}

function normalizeCoordinate(value: number) {
  if (Math.abs(value) < CLIP_EPSILON) return 0;
  return Number(value.toFixed(10));
}

function lineRange(values: readonly number[], overscan: number) {
  return {
    minimum: Math.floor(Math.min(...values)) - overscan,
    maximum: Math.ceil(Math.max(...values)) + overscan
  };
}

/**
 * Produces image-space grid segments for only the requested viewport. The caller
 * can draw these lines in Canvas, WebGL, SVG, or a calibration preview without
 * reimplementing rotation, clipping, major-line selection, or safety limits.
 */
export function gridOverlayLines(
  calibration: SquareGridCalibration,
  viewport: ImageViewport,
  options: GridOverlayOptions = {}
): readonly GridOverlayLine[] {
  validateSquareGridCalibration(calibration);
  validateViewport(viewport);
  const majorEvery = positiveInteger(options.majorEvery ?? 5, "Major-line interval", 1_000);
  const maxLines = positiveInteger(options.maxLines ?? DEFAULT_MAX_LINES, "Maximum overlay lines", ABSOLUTE_MAX_LINES);
  const overscan = nonNegativeInteger(options.overscanCells ?? 1, "Overlay overscan", 10);
  const corners = [
    imageToGrid(calibration, { x: viewport.minX, y: viewport.minY }),
    imageToGrid(calibration, { x: viewport.maxX, y: viewport.minY }),
    imageToGrid(calibration, { x: viewport.maxX, y: viewport.maxY }),
    imageToGrid(calibration, { x: viewport.minX, y: viewport.maxY })
  ];
  const columns = lineRange(corners.map((corner) => corner.column), overscan);
  const rows = lineRange(corners.map((corner) => corner.row), overscan);
  const requested = columns.maximum - columns.minimum + 1 + rows.maximum - rows.minimum + 1;
  if (requested > maxLines) throw new Error(`Grid overlay requires ${requested} lines, exceeding the ${maxLines} line safety limit. Zoom in before displaying the grid.`);

  const lines: GridOverlayLine[] = [];
  for (let column = columns.minimum; column <= columns.maximum; column++) {
    const clipped = clipSegment(
      gridToImage(calibration, { column, row: rows.minimum - 1 }),
      gridToImage(calibration, { column, row: rows.maximum + 1 }),
      viewport
    );
    if (clipped) lines.push({
      axis: "column",
      index: column,
      start: { x: normalizeCoordinate(clipped.start.x), y: normalizeCoordinate(clipped.start.y) },
      end: { x: normalizeCoordinate(clipped.end.x), y: normalizeCoordinate(clipped.end.y) },
      major: ((column % majorEvery) + majorEvery) % majorEvery === 0
    });
  }
  for (let row = rows.minimum; row <= rows.maximum; row++) {
    const clipped = clipSegment(
      gridToImage(calibration, { column: columns.minimum - 1, row }),
      gridToImage(calibration, { column: columns.maximum + 1, row }),
      viewport
    );
    if (clipped) lines.push({
      axis: "row",
      index: row,
      start: { x: normalizeCoordinate(clipped.start.x), y: normalizeCoordinate(clipped.start.y) },
      end: { x: normalizeCoordinate(clipped.end.x), y: normalizeCoordinate(clipped.end.y) },
      major: ((row % majorEvery) + majorEvery) % majorEvery === 0
    });
  }
  return lines;
}
