export type ImagePoint = Readonly<{ x: number; y: number }>;
export type GridPoint = Readonly<{ column: number; row: number }>;
export type CalibrationAxis = "horizontal" | "vertical";

export type SquareGridCalibration = Readonly<{
  kind: "square";
  origin: ImagePoint;
  cellSizePx: number;
  rotationRadians: number;
  distancePerCell: number;
}>;

export type SegmentCalibrationInput = Readonly<{
  mapWidthPx: number;
  mapHeightPx: number;
  start: ImagePoint;
  end: ImagePoint;
  cellsBetween: number;
  axis: CalibrationAxis;
  distancePerCell?: number;
}>;

export type AreaCalibrationInput = Readonly<{
  mapWidthPx: number;
  mapHeightPx: number;
  start: ImagePoint;
  end: ImagePoint;
  cellsAcross: number;
  cellsDown: number;
  distancePerCell?: number;
}>;

const MIN_CELL_SIZE_PX = 4;
const MAX_CELL_SIZE_PX = 2048;
const MAX_CELLS_BETWEEN = 500;

function finite(value: number, label: string) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
}

function positive(value: number, label: string) {
  finite(value, label);
  if (value <= 0) throw new Error(`${label} must be greater than zero.`);
  return value;
}

function pointWithinMap(point: ImagePoint, width: number, height: number, label: string) {
  finite(point.x, `${label} x`); finite(point.y, `${label} y`);
  if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) throw new Error(`${label} must be inside the map bounds.`);
}

export function normalizeRotation(radians: number) {
  finite(radians, "Rotation");
  const fullTurn = Math.PI * 2;
  const normalized = ((radians + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
  return Object.is(normalized, -0) ? 0 : normalized;
}

export function validateSquareGridCalibration(calibration: SquareGridCalibration) {
  pointWithinMap(calibration.origin, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "Grid origin");
  if (calibration.kind !== "square") throw new Error("Only square-grid calibration is supported.");
  if (calibration.cellSizePx < MIN_CELL_SIZE_PX || calibration.cellSizePx > MAX_CELL_SIZE_PX) throw new Error(`Grid cell size must be between ${MIN_CELL_SIZE_PX} and ${MAX_CELL_SIZE_PX} pixels.`);
  positive(calibration.distancePerCell, "Distance per cell");
  finite(calibration.rotationRadians, "Grid rotation");
  return calibration;
}

/**
 * Wizard step: the user draws across known grid intersections and enters how many
 * cells the segment spans. The first point remains an exact grid intersection so
 * the next UI step only needs small origin/scale nudges.
 */
export function deriveSquareGridFromSegment(input: SegmentCalibrationInput): SquareGridCalibration {
  const mapWidthPx = positive(input.mapWidthPx, "Map width");
  const mapHeightPx = positive(input.mapHeightPx, "Map height");
  pointWithinMap(input.start, mapWidthPx, mapHeightPx, "Segment start");
  pointWithinMap(input.end, mapWidthPx, mapHeightPx, "Segment end");
  if (!Number.isInteger(input.cellsBetween) || input.cellsBetween < 1 || input.cellsBetween > MAX_CELLS_BETWEEN) throw new Error(`Cells between must be an integer from 1 to ${MAX_CELLS_BETWEEN}.`);
  const dx = input.end.x - input.start.x;
  const dy = input.end.y - input.start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) throw new Error("Draw the calibration segment across at least one grid cell.");
  const cellSizePx = length / input.cellsBetween;
  if (cellSizePx < MIN_CELL_SIZE_PX || cellSizePx > MAX_CELL_SIZE_PX) throw new Error(`The selected segment produces a cell outside the supported ${MIN_CELL_SIZE_PX}–${MAX_CELL_SIZE_PX} pixel range.`);
  const segmentAngle = Math.atan2(dy, dx);
  const rotationRadians = normalizeRotation(input.axis === "horizontal" ? segmentAngle : segmentAngle - Math.PI / 2);
  return validateSquareGridCalibration({ kind: "square", origin: { ...input.start }, cellSizePx, rotationRadians, distancePerCell: input.distancePerCell ?? 5 });
}

/**
 * Derives a square grid from opposite corners of a known rectangular grid area.
 * The normal UI uses a fixed 3-by-3 area: one press-drag-release gesture yields
 * origin, cell size, and rotation without asking the GM for pixel math or axis.
 */
export function deriveSquareGridFromArea(input: AreaCalibrationInput): SquareGridCalibration {
  const mapWidthPx = positive(input.mapWidthPx, "Map width");
  const mapHeightPx = positive(input.mapHeightPx, "Map height");
  pointWithinMap(input.start, mapWidthPx, mapHeightPx, "Area start");
  pointWithinMap(input.end, mapWidthPx, mapHeightPx, "Area end");
  if (!Number.isInteger(input.cellsAcross) || input.cellsAcross < 1 || input.cellsAcross > MAX_CELLS_BETWEEN) throw new Error(`Cells across must be an integer from 1 to ${MAX_CELLS_BETWEEN}.`);
  if (!Number.isInteger(input.cellsDown) || input.cellsDown < 1 || input.cellsDown > MAX_CELLS_BETWEEN) throw new Error(`Cells down must be an integer from 1 to ${MAX_CELLS_BETWEEN}.`);
  const dx = input.end.x - input.start.x;
  const dy = input.end.y - input.start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) throw new Error("Drag across the full calibration area before releasing.");
  const cellSizePx = length / Math.hypot(input.cellsAcross, input.cellsDown);
  if (cellSizePx < MIN_CELL_SIZE_PX || cellSizePx > MAX_CELL_SIZE_PX) throw new Error(`The selected area produces a cell outside the supported ${MIN_CELL_SIZE_PX}–${MAX_CELL_SIZE_PX} pixel range.`);
  const imageDiagonalAngle = Math.atan2(dy, dx);
  const gridDiagonalAngle = Math.atan2(input.cellsDown, input.cellsAcross);
  return validateSquareGridCalibration({
    kind: "square",
    origin: { ...input.start },
    cellSizePx,
    rotationRadians: normalizeRotation(imageDiagonalAngle - gridDiagonalAngle),
    distancePerCell: input.distancePerCell ?? 5
  });
}

export function imageToGrid(calibration: SquareGridCalibration, point: ImagePoint): GridPoint {
  validateSquareGridCalibration(calibration);
  finite(point.x, "Image x"); finite(point.y, "Image y");
  const dx = point.x - calibration.origin.x;
  const dy = point.y - calibration.origin.y;
  const cosine = Math.cos(calibration.rotationRadians);
  const sine = Math.sin(calibration.rotationRadians);
  return {
    column: (cosine * dx + sine * dy) / calibration.cellSizePx,
    row: (-sine * dx + cosine * dy) / calibration.cellSizePx
  };
}

export function gridToImage(calibration: SquareGridCalibration, point: GridPoint): ImagePoint {
  validateSquareGridCalibration(calibration);
  finite(point.column, "Grid column"); finite(point.row, "Grid row");
  const localX = point.column * calibration.cellSizePx;
  const localY = point.row * calibration.cellSizePx;
  const cosine = Math.cos(calibration.rotationRadians);
  const sine = Math.sin(calibration.rotationRadians);
  return {
    x: calibration.origin.x + cosine * localX - sine * localY,
    y: calibration.origin.y + sine * localX + cosine * localY
  };
}

export function snapImagePoint(calibration: SquareGridCalibration, point: ImagePoint, mode: "intersection" | "cell-center" = "intersection") {
  const grid = imageToGrid(calibration, point);
  const snapped = mode === "intersection"
    ? { column: Math.round(grid.column), row: Math.round(grid.row) }
    : { column: Math.floor(grid.column) + 0.5, row: Math.floor(grid.row) + 0.5 };
  return { image: gridToImage(calibration, snapped), grid: snapped };
}

export function nudgeSquareGrid(calibration: SquareGridCalibration, adjustment: Readonly<{ originDelta?: ImagePoint; cellSizeDeltaPx?: number; rotationDeltaRadians?: number }>): SquareGridCalibration {
  const next = {
    ...calibration,
    origin: {
      x: calibration.origin.x + (adjustment.originDelta?.x ?? 0),
      y: calibration.origin.y + (adjustment.originDelta?.y ?? 0)
    },
    cellSizePx: calibration.cellSizePx + (adjustment.cellSizeDeltaPx ?? 0),
    rotationRadians: normalizeRotation(calibration.rotationRadians + (adjustment.rotationDeltaRadians ?? 0))
  };
  return validateSquareGridCalibration(next);
}

/** Pixel residual used by the wizard to say whether a third known intersection aligns. */
export function calibrationErrorPx(calibration: SquareGridCalibration, imagePoint: ImagePoint, expectedGridPoint: GridPoint) {
  const expected = gridToImage(calibration, expectedGridPoint);
  finite(imagePoint.x, "Image x"); finite(imagePoint.y, "Image y");
  return Math.hypot(imagePoint.x - expected.x, imagePoint.y - expected.y);
}

export function distanceForGridPath(calibration: SquareGridCalibration, from: GridPoint, to: GridPoint, diagonal: "euclidean" | "chebyshev" = "euclidean") {
  validateSquareGridCalibration(calibration);
  const columns = Math.abs(to.column - from.column);
  const rows = Math.abs(to.row - from.row);
  return (diagonal === "chebyshev" ? Math.max(columns, rows) : Math.hypot(columns, rows)) * calibration.distancePerCell;
}
