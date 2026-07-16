import {
  snapImagePoint,
  validateSquareGridCalibration,
  type GridPoint,
  type ImagePoint,
  type SquareGridCalibration
} from "./grid-calibration.js";

export type GridDistanceRule = "euclidean" | "chebyshev" | "alternating-diagonal";
export type GridSnapMode = "intersection" | "cell-center";

export type MeasurementSegment = Readonly<{
  from: ImagePoint;
  to: ImagePoint;
  distance: number;
  cumulativeDistance: number;
}>;

export type GridMeasurement = Readonly<{
  kind: "grid";
  unit: string;
  rule: GridDistanceRule;
  snapMode: GridSnapMode;
  snappedGridPoints: readonly GridPoint[];
  segments: readonly MeasurementSegment[];
  totalDistance: number;
}>;

export type MapDistanceScale = Readonly<{
  kind: "image-scale";
  distancePerPixel: number;
  unit: string;
}>;

export type MapScaleMeasurement = Readonly<{
  kind: "image-scale";
  unit: string;
  segments: readonly MeasurementSegment[];
  totalDistance: number;
}>;

const COORDINATE_EPSILON = 1e-8;

function positiveFinite(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive finite number.`);
  return value;
}

function measurementUnit(value: string) {
  const unit = value.trim();
  if (!unit || unit.length > 32 || /[\u0000-\u001f\u007f]/.test(unit)) throw new Error("Measurement unit must contain 1 to 32 printable characters.");
  return unit;
}

function validatePoint(point: ImagePoint, label: string) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error(`${label} must contain finite coordinates.`);
  return point;
}

function validatePath(points: readonly ImagePoint[]) {
  if (points.length < 2) throw new Error("Measurement path requires at least two points.");
  if (points.length > 1_000) throw new Error("Measurement path cannot exceed 1,000 points.");
  return points.map((point, index) => ({ ...validatePoint(point, `Measurement point ${index + 1}`) }));
}

function integerDelta(value: number) {
  const rounded = Math.round(Math.abs(value));
  if (Math.abs(Math.abs(value) - rounded) > COORDINATE_EPSILON) throw new Error("Snapped grid measurement produced a non-integral cell delta.");
  return rounded;
}

function gridSegmentCost(columns: number, rows: number, rule: GridDistanceRule, priorDiagonals: number) {
  if (rule === "euclidean") return { cells: Math.hypot(columns, rows), diagonals: 0 };
  if (rule === "chebyshev") return { cells: Math.max(columns, rows), diagonals: 0 };
  const diagonals = Math.min(columns, rows);
  const straight = Math.max(columns, rows) - diagonals;
  const expensiveBefore = Math.floor(priorDiagonals / 2);
  const expensiveAfter = Math.floor((priorDiagonals + diagonals) / 2);
  return { cells: straight + diagonals + expensiveAfter - expensiveBefore, diagonals };
}

export function measureGridPath(
  calibration: SquareGridCalibration,
  imagePoints: readonly ImagePoint[],
  options: Readonly<{ unit?: string; rule?: GridDistanceRule; snapMode?: GridSnapMode }> = {}
): GridMeasurement {
  validateSquareGridCalibration(calibration);
  const points = validatePath(imagePoints);
  const unit = measurementUnit(options.unit ?? "ft");
  const rule = options.rule ?? "chebyshev";
  const snapMode = options.snapMode ?? "intersection";
  const snapped = points.map((point) => snapImagePoint(calibration, point, snapMode));
  const segments: MeasurementSegment[] = [];
  let totalDistance = 0;
  let priorDiagonals = 0;
  for (let index = 1; index < snapped.length; index++) {
    const previous = snapped[index - 1];
    const current = snapped[index];
    const columns = integerDelta(current.grid.column - previous.grid.column);
    const rows = integerDelta(current.grid.row - previous.grid.row);
    const cost = gridSegmentCost(columns, rows, rule, priorDiagonals);
    priorDiagonals += cost.diagonals;
    const distance = cost.cells * calibration.distancePerCell;
    totalDistance += distance;
    segments.push({ from: previous.image, to: current.image, distance, cumulativeDistance: totalDistance });
  }
  return {
    kind: "grid",
    unit,
    rule,
    snapMode,
    snappedGridPoints: snapped.map((point) => point.grid),
    segments,
    totalDistance
  };
}

export function deriveMapDistanceScale(input: Readonly<{ start: ImagePoint; end: ImagePoint; knownDistance: number; unit: string }>): MapDistanceScale {
  const start = validatePoint(input.start, "Scale start");
  const end = validatePoint(input.end, "Scale end");
  const pixels = Math.hypot(end.x - start.x, end.y - start.y);
  positiveFinite(pixels, "Scale reference length");
  return {
    kind: "image-scale",
    distancePerPixel: positiveFinite(input.knownDistance, "Known distance") / pixels,
    unit: measurementUnit(input.unit)
  };
}

export function validateMapDistanceScale(scale: MapDistanceScale) {
  if (scale.kind !== "image-scale") throw new Error("Map distance scale kind is unsupported.");
  positiveFinite(scale.distancePerPixel, "Distance per pixel");
  measurementUnit(scale.unit);
  return scale;
}

export function measureMapPath(scale: MapDistanceScale, imagePoints: readonly ImagePoint[]): MapScaleMeasurement {
  validateMapDistanceScale(scale);
  const points = validatePath(imagePoints);
  const segments: MeasurementSegment[] = [];
  let totalDistance = 0;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const current = points[index];
    const distance = Math.hypot(current.x - previous.x, current.y - previous.y) * scale.distancePerPixel;
    totalDistance += distance;
    segments.push({ from: previous, to: current, distance, cumulativeDistance: totalDistance });
  }
  return { kind: "image-scale", unit: scale.unit, segments, totalDistance };
}
