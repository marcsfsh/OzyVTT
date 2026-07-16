import {
  calibrationErrorPx,
  deriveSquareGridFromSegment,
  nudgeSquareGrid,
  snapImagePoint,
  validateSquareGridCalibration,
  type CalibrationAxis,
  type GridPoint,
  type ImagePoint,
  type SquareGridCalibration
} from "./grid-calibration.js";

export type GridCalibrationWizardStep = "measure" | "refine" | "verify" | "complete";

export type GridCalibrationVerification = Readonly<{
  imagePoint: ImagePoint;
  nearestIntersection: GridPoint;
  expectedImagePoint: ImagePoint;
  errorPx: number;
  tolerancePx: number;
  accepted: boolean;
}>;

export type GridCalibrationWizardState = Readonly<{
  schemaVersion: 1;
  assetId: string;
  mapWidthPx: number;
  mapHeightPx: number;
  step: GridCalibrationWizardStep;
  calibration: SquareGridCalibration | null;
  verification: GridCalibrationVerification | null;
  undoStack: readonly SquareGridCalibration[];
  redoStack: readonly SquareGridCalibration[];
  revision: number;
}>;

export type WizardCalibrationAdjustment = Readonly<{
  originDelta?: ImagePoint;
  cellSizeDeltaPx?: number;
  rotationDeltaRadians?: number;
  distancePerCell?: number;
}>;

const MAX_HISTORY = 50;

function positiveFinite(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive finite number.`);
  return value;
}

function active(state: GridCalibrationWizardState) {
  if (state.step === "complete") throw new Error("Completed grid calibration must be reopened before it can be changed.");
}

function calibrationFrom(state: GridCalibrationWizardState) {
  if (!state.calibration) throw new Error("Measure a known grid span before refining or verifying the grid.");
  return state.calibration;
}

function nextRevision(state: GridCalibrationWizardState) {
  return state.revision + 1;
}

function pushHistory(stack: readonly SquareGridCalibration[], calibration: SquareGridCalibration) {
  return [...stack.slice(-(MAX_HISTORY - 1)), calibration];
}

export function createGridCalibrationWizard(input: Readonly<{ assetId: string; mapWidthPx: number; mapHeightPx: number }>): GridCalibrationWizardState {
  const assetId = input.assetId.trim();
  if (!assetId) throw new Error("A map asset ID is required.");
  return {
    schemaVersion: 1,
    assetId,
    mapWidthPx: positiveFinite(input.mapWidthPx, "Map width"),
    mapHeightPx: positiveFinite(input.mapHeightPx, "Map height"),
    step: "measure",
    calibration: null,
    verification: null,
    undoStack: [],
    redoStack: [],
    revision: 0
  };
}

export function measureKnownGridSpan(state: GridCalibrationWizardState, input: Readonly<{
  start: ImagePoint;
  end: ImagePoint;
  cellsBetween: number;
  axis: CalibrationAxis;
  distancePerCell?: number;
}>): GridCalibrationWizardState {
  active(state);
  const calibration = deriveSquareGridFromSegment({
    mapWidthPx: state.mapWidthPx,
    mapHeightPx: state.mapHeightPx,
    ...input
  });
  return {
    ...state,
    step: "refine",
    calibration,
    verification: null,
    undoStack: state.calibration ? pushHistory(state.undoStack, state.calibration) : [],
    redoStack: [],
    revision: nextRevision(state)
  };
}

export function adjustWizardGrid(state: GridCalibrationWizardState, adjustment: WizardCalibrationAdjustment): GridCalibrationWizardState {
  active(state);
  const current = calibrationFrom(state);
  const nudged = nudgeSquareGrid(current, adjustment);
  const calibration = validateSquareGridCalibration({
    ...nudged,
    distancePerCell: adjustment.distancePerCell ?? nudged.distancePerCell
  });
  return {
    ...state,
    step: "refine",
    calibration,
    verification: null,
    undoStack: pushHistory(state.undoStack, current),
    redoStack: [],
    revision: nextRevision(state)
  };
}

export function undoWizardGrid(state: GridCalibrationWizardState): GridCalibrationWizardState {
  active(state);
  const current = calibrationFrom(state);
  const previous = state.undoStack.at(-1);
  if (!previous) return state;
  return {
    ...state,
    step: "refine",
    calibration: previous,
    verification: null,
    undoStack: state.undoStack.slice(0, -1),
    redoStack: pushHistory(state.redoStack, current),
    revision: nextRevision(state)
  };
}

export function redoWizardGrid(state: GridCalibrationWizardState): GridCalibrationWizardState {
  active(state);
  const current = calibrationFrom(state);
  const following = state.redoStack.at(-1);
  if (!following) return state;
  return {
    ...state,
    step: "refine",
    calibration: following,
    verification: null,
    undoStack: pushHistory(state.undoStack, current),
    redoStack: state.redoStack.slice(0, -1),
    revision: nextRevision(state)
  };
}

export function verifyWizardIntersection(state: GridCalibrationWizardState, imagePoint: ImagePoint, tolerancePx?: number): GridCalibrationWizardState {
  active(state);
  const calibration = calibrationFrom(state);
  if (!Number.isFinite(imagePoint.x) || !Number.isFinite(imagePoint.y) || imagePoint.x < 0 || imagePoint.x > state.mapWidthPx || imagePoint.y < 0 || imagePoint.y > state.mapHeightPx) {
    throw new Error("Verification point must be inside the map bounds.");
  }
  const tolerance = tolerancePx ?? Math.min(8, Math.max(2, calibration.cellSizePx * 0.08));
  positiveFinite(tolerance, "Verification tolerance");
  const nearest = snapImagePoint(calibration, imagePoint, "intersection");
  const errorPx = calibrationErrorPx(calibration, imagePoint, nearest.grid);
  return {
    ...state,
    step: "verify",
    verification: {
      imagePoint: { ...imagePoint },
      nearestIntersection: nearest.grid,
      expectedImagePoint: nearest.image,
      errorPx,
      tolerancePx: tolerance,
      accepted: errorPx <= tolerance
    },
    revision: nextRevision(state)
  };
}

export function completeGridCalibrationWizard(state: GridCalibrationWizardState): GridCalibrationWizardState {
  active(state);
  calibrationFrom(state);
  if (!state.verification?.accepted) throw new Error("Verify a known grid intersection within tolerance before completing calibration.");
  return { ...state, step: "complete", revision: nextRevision(state) };
}

export function reopenGridCalibrationWizard(state: GridCalibrationWizardState): GridCalibrationWizardState {
  if (state.step !== "complete") return state;
  return { ...state, step: "refine", verification: null, revision: nextRevision(state) };
}
