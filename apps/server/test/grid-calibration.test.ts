import { describe, expect, it } from "vitest";
import {
  calibrationErrorPx,
  deriveSquareGridFromArea,
  deriveSquareGridFromSegment,
  distanceForGridPath,
  gridToImage,
  imageToGrid,
  normalizeRotation,
  nudgeSquareGrid,
  snapImagePoint
} from "../src/grid-calibration.js";

describe("square-grid calibration geometry", () => {
  it("derives scale, origin, and rotation from one diagonal drag across a 3-by-3 area", () => {
    const aligned = deriveSquareGridFromArea({ mapWidthPx: 1000, mapHeightPx: 800, start: { x: 100, y: 100 }, end: { x: 250, y: 250 }, cellsAcross: 3, cellsDown: 3 });
    expect(aligned).toMatchObject({ kind: "square", origin: { x: 100, y: 100 }, rotationRadians: 0, distancePerCell: 5 });
    expect(aligned.cellSizePx).toBeCloseTo(50);

    const rotation = Math.PI / 6;
    const endpoint = gridToImage({ ...aligned, rotationRadians: rotation }, { column: 3, row: 3 });
    const rotated = deriveSquareGridFromArea({ mapWidthPx: 1000, mapHeightPx: 800, start: aligned.origin, end: endpoint, cellsAcross: 3, cellsDown: 3 });
    expect(rotated.cellSizePx).toBeCloseTo(50);
    expect(rotated.rotationRadians).toBeCloseTo(rotation);
  });

  it("derives cell size and origin from an easy horizontal segment", () => {
    const calibration = deriveSquareGridFromSegment({ mapWidthPx: 2000, mapHeightPx: 1200, start: { x: 125, y: 80 }, end: { x: 375, y: 80 }, cellsBetween: 5, axis: "horizontal" });
    expect(calibration).toEqual({ kind: "square", origin: { x: 125, y: 80 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 });
    expect(imageToGrid(calibration, { x: 225, y: 230 })).toEqual({ column: 2, row: 3 });
    expect(gridToImage(calibration, { column: 2, row: 3 })).toEqual({ x: 225, y: 230 });
  });

  it("handles vertical and rotated reference segments with round-trip accuracy", () => {
    const vertical = deriveSquareGridFromSegment({ mapWidthPx: 1000, mapHeightPx: 1000, start: { x: 100, y: 100 }, end: { x: 100, y: 300 }, cellsBetween: 4, axis: "vertical" });
    expect(vertical.cellSizePx).toBe(50);
    expect(vertical.rotationRadians).toBeCloseTo(0);

    const rotated = deriveSquareGridFromSegment({ mapWidthPx: 1000, mapHeightPx: 1000, start: { x: 250, y: 250 }, end: { x: 400, y: 400 }, cellsBetween: 3, axis: "horizontal" });
    expect(rotated.rotationRadians).toBeCloseTo(Math.PI / 4);
    const original = { column: 2.25, row: -1.5 };
    const roundTrip = imageToGrid(rotated, gridToImage(rotated, original));
    expect(roundTrip.column).toBeCloseTo(original.column, 10);
    expect(roundTrip.row).toBeCloseTo(original.row, 10);
  });

  it("snaps to intersections or cell centers and reports alignment residual", () => {
    const calibration = deriveSquareGridFromSegment({ mapWidthPx: 500, mapHeightPx: 500, start: { x: 10, y: 20 }, end: { x: 210, y: 20 }, cellsBetween: 4, axis: "horizontal" });
    expect(snapImagePoint(calibration, { x: 107, y: 124 }, "intersection")).toEqual({ image: { x: 110, y: 120 }, grid: { column: 2, row: 2 } });
    expect(snapImagePoint(calibration, { x: 107, y: 124 }, "cell-center")).toEqual({ image: { x: 85, y: 145 }, grid: { column: 1.5, row: 2.5 } });
    expect(calibrationErrorPx(calibration, { x: 113, y: 124 }, { column: 2, row: 2 })).toBe(5);
  });

  it("supports small wizard nudges without accumulating invalid state", () => {
    const calibration = deriveSquareGridFromSegment({ mapWidthPx: 500, mapHeightPx: 500, start: { x: 10, y: 20 }, end: { x: 210, y: 20 }, cellsBetween: 4, axis: "horizontal" });
    const nudged = nudgeSquareGrid(calibration, { originDelta: { x: 2, y: -3 }, cellSizeDeltaPx: 0.5, rotationDeltaRadians: Math.PI * 2 + 0.01 });
    expect(nudged.origin).toEqual({ x: 12, y: 17 });
    expect(nudged.cellSizePx).toBe(50.5);
    expect(nudged.rotationRadians).toBeCloseTo(0.01);
  });

  it("calculates configured grid distance independently from pixel scale", () => {
    const calibration = deriveSquareGridFromSegment({ mapWidthPx: 500, mapHeightPx: 500, start: { x: 0, y: 0 }, end: { x: 200, y: 0 }, cellsBetween: 4, axis: "horizontal", distancePerCell: 10 });
    expect(distanceForGridPath(calibration, { column: 0, row: 0 }, { column: 3, row: 4 })).toBe(50);
    expect(distanceForGridPath(calibration, { column: 0, row: 0 }, { column: 3, row: 4 }, "chebyshev")).toBe(40);
  });

  it("rejects ambiguous, out-of-bounds, non-finite, and implausible inputs", () => {
    const base = { mapWidthPx: 500, mapHeightPx: 500, start: { x: 10, y: 20 }, end: { x: 210, y: 20 }, cellsBetween: 4, axis: "horizontal" as const };
    expect(() => deriveSquareGridFromSegment({ ...base, end: base.start })).toThrow("at least one");
    expect(() => deriveSquareGridFromSegment({ ...base, start: { x: -1, y: 0 } })).toThrow("bounds");
    expect(() => deriveSquareGridFromSegment({ ...base, cellsBetween: 0 })).toThrow("integer");
    expect(() => deriveSquareGridFromSegment({ ...base, cellsBetween: 100 })).toThrow("supported");
    expect(() => deriveSquareGridFromSegment({ ...base, mapWidthPx: Number.NaN })).toThrow("finite");
    expect(() => deriveSquareGridFromArea({ mapWidthPx: 500, mapHeightPx: 500, start: { x: 10, y: 10 }, end: { x: 10, y: 10 }, cellsAcross: 3, cellsDown: 3 })).toThrow("full calibration area");
    expect(() => nudgeSquareGrid(deriveSquareGridFromSegment(base), { cellSizeDeltaPx: -100 })).toThrow("between");
    expect(normalizeRotation(Math.PI * 3)).toBeCloseTo(-Math.PI);
  });
});
