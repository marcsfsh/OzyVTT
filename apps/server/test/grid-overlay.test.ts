import { describe, expect, it } from "vitest";
import { deriveSquareGridFromSegment } from "../src/grid-calibration.js";
import { gridOverlayLines, type ImageViewport } from "../src/grid-overlay.js";

const viewport: ImageViewport = { minX: 0, minY: 0, maxX: 200, maxY: 100 };

describe("grid overlay geometry", () => {
  it("generates clipped, ordered square-grid lines with major markers", () => {
    const calibration = deriveSquareGridFromSegment({
      mapWidthPx: 500,
      mapHeightPx: 500,
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      cellsBetween: 2,
      axis: "horizontal"
    });
    const lines = gridOverlayLines(calibration, viewport, { overscanCells: 0, majorEvery: 2 });
    expect(lines.filter((line) => line.axis === "column")).toEqual([
      { axis: "column", index: 0, start: { x: 0, y: 0 }, end: { x: 0, y: 100 }, major: true },
      { axis: "column", index: 1, start: { x: 50, y: 0 }, end: { x: 50, y: 100 }, major: false },
      { axis: "column", index: 2, start: { x: 100, y: 0 }, end: { x: 100, y: 100 }, major: true },
      { axis: "column", index: 3, start: { x: 150, y: 0 }, end: { x: 150, y: 100 }, major: false },
      { axis: "column", index: 4, start: { x: 200, y: 0 }, end: { x: 200, y: 100 }, major: true }
    ]);
    expect(lines.filter((line) => line.axis === "row")).toHaveLength(3);
  });

  it("clips rotated grids to the viewport and remains deterministic", () => {
    const calibration = deriveSquareGridFromSegment({
      mapWidthPx: 500,
      mapHeightPx: 500,
      start: { x: 100, y: 50 },
      end: { x: 200, y: 150 },
      cellsBetween: 2,
      axis: "horizontal"
    });
    const first = gridOverlayLines(calibration, viewport, { overscanCells: 1 });
    const second = gridOverlayLines(calibration, viewport, { overscanCells: 1 });
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(4);
    for (const line of first) {
      for (const point of [line.start, line.end]) {
        expect(point.x).toBeGreaterThanOrEqual(viewport.minX);
        expect(point.x).toBeLessThanOrEqual(viewport.maxX);
        expect(point.y).toBeGreaterThanOrEqual(viewport.minY);
        expect(point.y).toBeLessThanOrEqual(viewport.maxY);
      }
    }
  });

  it("handles negative grid indices when the origin is inside the viewport", () => {
    const calibration = deriveSquareGridFromSegment({
      mapWidthPx: 500,
      mapHeightPx: 500,
      start: { x: 100, y: 50 },
      end: { x: 150, y: 50 },
      cellsBetween: 1,
      axis: "horizontal"
    });
    const lines = gridOverlayLines(calibration, viewport, { overscanCells: 0, majorEvery: 2 });
    expect(lines).toContainEqual({ axis: "column", index: -2, start: { x: 0, y: 0 }, end: { x: 0, y: 100 }, major: true });
    expect(lines).toContainEqual({ axis: "row", index: -1, start: { x: 0, y: 0 }, end: { x: 200, y: 0 }, major: false });
  });

  it("rejects invalid viewports, options, and line-count explosions", () => {
    const calibration = deriveSquareGridFromSegment({
      mapWidthPx: 1000,
      mapHeightPx: 1000,
      start: { x: 0, y: 0 },
      end: { x: 40, y: 0 },
      cellsBetween: 10,
      axis: "horizontal"
    });
    expect(() => gridOverlayLines(calibration, { minX: 0, minY: 0, maxX: 0, maxY: 100 })).toThrow("positive width");
    expect(() => gridOverlayLines(calibration, viewport, { majorEvery: 0 })).toThrow("integer");
    expect(() => gridOverlayLines(calibration, { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }, { maxLines: 100 })).toThrow("Zoom in");
  });
});
