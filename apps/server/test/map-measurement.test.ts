import { describe, expect, it } from "vitest";
import { deriveSquareGridFromSegment } from "../src/grid-calibration.js";
import { deriveMapDistanceScale, measureGridPath, measureMapPath, validateMapDistanceScale } from "../src/map-measurement.js";

const calibration = deriveSquareGridFromSegment({
  mapWidthPx: 1000,
  mapHeightPx: 1000,
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
  cellsBetween: 2,
  axis: "horizontal",
  distancePerCell: 5
});

describe("map measurement", () => {
  it("measures snapped grid paths with euclidean and chebyshev rules", () => {
    const points = [{ x: 2, y: 1 }, { x: 151, y: 201 }];
    const euclidean = measureGridPath(calibration, points, { rule: "euclidean", unit: "ft" });
    expect(euclidean.snappedGridPoints).toEqual([{ column: 0, row: 0 }, { column: 3, row: 4 }]);
    expect(euclidean.totalDistance).toBe(25);
    expect(euclidean.segments[0]).toMatchObject({ distance: 25, cumulativeDistance: 25 });
    expect(measureGridPath(calibration, points, { rule: "chebyshev" }).totalDistance).toBe(20);
  });

  it("carries alternating 5-10-5 diagonals across polyline segments", () => {
    const measurement = measureGridPath(calibration, [
      { x: 0, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 100 },
      { x: 150, y: 150 }
    ], { rule: "alternating-diagonal" });
    expect(measurement.segments.map((segment) => segment.distance)).toEqual([5, 10, 5]);
    expect(measurement.segments.map((segment) => segment.cumulativeDistance)).toEqual([5, 15, 20]);
    expect(measurement.totalDistance).toBe(20);
  });

  it("supports cell-center snapping without fractional movement errors", () => {
    const measurement = measureGridPath(calibration, [{ x: 20, y: 20 }, { x: 129, y: 171 }], { snapMode: "cell-center" });
    expect(measurement.snappedGridPoints).toEqual([{ column: 0.5, row: 0.5 }, { column: 2.5, row: 3.5 }]);
    expect(measurement.totalDistance).toBe(15);
  });

  it("derives and applies gridless regional or world-map scale", () => {
    const scale = deriveMapDistanceScale({ start: { x: 10, y: 20 }, end: { x: 110, y: 20 }, knownDistance: 50, unit: "miles" });
    expect(scale).toEqual({ kind: "image-scale", distancePerPixel: 0.5, unit: "miles" });
    const measurement = measureMapPath(scale, [{ x: 0, y: 0 }, { x: 60, y: 80 }, { x: 120, y: 80 }]);
    expect(measurement.segments.map((segment) => segment.distance)).toEqual([50, 30]);
    expect(measurement.totalDistance).toBe(80);
  });

  it("rejects unsafe scales, units, and paths", () => {
    expect(() => deriveMapDistanceScale({ start: { x: 1, y: 1 }, end: { x: 1, y: 1 }, knownDistance: 10, unit: "mi" })).toThrow("positive finite");
    expect(() => deriveMapDistanceScale({ start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, knownDistance: 0, unit: "mi" })).toThrow("Known distance");
    expect(() => validateMapDistanceScale({ kind: "image-scale", distancePerPixel: 1, unit: " " })).toThrow("printable");
    expect(() => measureGridPath(calibration, [{ x: 0, y: 0 }])).toThrow("at least two");
    expect(() => measureMapPath({ kind: "image-scale", distancePerPixel: 1, unit: "km" }, [{ x: 0, y: Number.NaN }, { x: 1, y: 1 }])).toThrow("finite");
  });
});
