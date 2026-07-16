import { describe, expect, it } from "vitest";
import {
  adjustWizardGrid,
  completeGridCalibrationWizard,
  createGridCalibrationWizard,
  measureKnownGridArea,
  measureKnownGridSpan,
  redoWizardGrid,
  reopenGridCalibrationWizard,
  undoWizardGrid,
  verifyWizardIntersection
} from "../src/grid-calibration-wizard.js";

function measuredWizard() {
  return measureKnownGridSpan(
    createGridCalibrationWizard({ assetId: "map-1", mapWidthPx: 1200, mapHeightPx: 800 }),
    { start: { x: 100, y: 100 }, end: { x: 500, y: 100 }, cellsBetween: 8, axis: "horizontal" }
  );
}

describe("grid calibration wizard", () => {
  it("starts from the normal 3-by-3 drag gesture", () => {
    const measured = measureKnownGridArea(
      createGridCalibrationWizard({ assetId: "map-1", mapWidthPx: 1200, mapHeightPx: 800 }),
      { start: { x: 100, y: 100 }, end: { x: 250, y: 250 }, cellsAcross: 3, cellsDown: 3 }
    );
    expect(measured).toMatchObject({ step: "refine", calibration: { origin: { x: 100, y: 100 }, rotationRadians: 0 } });
    expect(measured.calibration?.cellSizePx).toBeCloseTo(50);
  });

  it("completes from a drag alone, with no verification required", () => {
    const measured = measuredWizard();
    expect(measured.step).toBe("refine");
    expect(measured.calibration).toMatchObject({ origin: { x: 100, y: 100 }, cellSizePx: 50, distancePerCell: 5 });

    const complete = completeGridCalibrationWizard(measured);
    expect(complete.step).toBe("complete");
    expect(complete.verification).toBeNull();
    expect(() => adjustWizardGrid(complete, { cellSizeDeltaPx: 1 })).toThrow("reopened");
    expect(reopenGridCalibrationWizard(complete)).toMatchObject({ step: "refine", verification: null });
  });

  it("walks through measure, refine, an optional verify, and completion", () => {
    const measured = measuredWizard();
    const refined = adjustWizardGrid(measured, { originDelta: { x: 2, y: -1 }, distancePerCell: 10 });
    expect(refined.calibration).toMatchObject({ origin: { x: 102, y: 99 }, distancePerCell: 10 });
    expect(refined.revision).toBe(2);

    const verified = verifyWizardIntersection(refined, { x: 302.5, y: 299.5 });
    expect(verified.step).toBe("verify");
    expect(verified.verification).toMatchObject({ nearestIntersection: { column: 4, row: 4 }, accepted: true });
    expect(verified.verification?.errorPx).toBeCloseTo(Math.SQRT1_2);

    const complete = completeGridCalibrationWizard(verified);
    expect(complete.step).toBe("complete");
    expect(() => adjustWizardGrid(complete, { cellSizeDeltaPx: 1 })).toThrow("reopened");
    expect(reopenGridCalibrationWizard(complete)).toMatchObject({ step: "refine", verification: null });
  });

  it("reports an optional verification as rejected without blocking completion", () => {
    const measured = measuredWizard();
    const rejected = verifyWizardIntersection(measured, { x: 124, y: 124 }, 3);
    expect(rejected.verification).toMatchObject({ accepted: false, tolerancePx: 3 });
    expect(rejected.verification?.errorPx).toBeCloseTo(Math.hypot(24, 24));
    expect(completeGridCalibrationWizard(rejected).step).toBe("complete");
  });

  it("supports bounded undo and redo while invalidating stale verification", () => {
    const measured = measuredWizard();
    const first = adjustWizardGrid(measured, { cellSizeDeltaPx: 1 });
    const second = adjustWizardGrid(first, { originDelta: { x: 3, y: 2 } });
    const verified = verifyWizardIntersection(second, { x: 103, y: 102 });

    const undone = undoWizardGrid(verified);
    expect(undone.calibration).toEqual(first.calibration);
    expect(undone.verification).toBeNull();
    const redone = redoWizardGrid(undone);
    expect(redone.calibration).toEqual(second.calibration);
    expect(redone.redoStack).toEqual([]);

    const divergent = adjustWizardGrid(undone, { cellSizeDeltaPx: 2 });
    expect(redoWizardGrid(divergent)).toBe(divergent);
  });

  it("rejects invalid setup, premature actions, and unsafe values", () => {
    expect(() => createGridCalibrationWizard({ assetId: " ", mapWidthPx: 100, mapHeightPx: 100 })).toThrow("asset ID");
    expect(() => createGridCalibrationWizard({ assetId: "map", mapWidthPx: Number.NaN, mapHeightPx: 100 })).toThrow("positive finite");
    const newWizard = createGridCalibrationWizard({ assetId: "map", mapWidthPx: 100, mapHeightPx: 100 });
    expect(() => adjustWizardGrid(newWizard, { cellSizeDeltaPx: 1 })).toThrow("Measure");
    expect(() => verifyWizardIntersection(newWizard, { x: 0, y: 0 })).toThrow("Measure");
    const measured = measureKnownGridSpan(newWizard, { start: { x: 0, y: 0 }, end: { x: 50, y: 0 }, cellsBetween: 5, axis: "horizontal" });
    expect(() => verifyWizardIntersection(measured, { x: 101, y: 0 })).toThrow("bounds");
    expect(() => adjustWizardGrid(measured, { distancePerCell: 0 })).toThrow("greater than zero");
  });
});
