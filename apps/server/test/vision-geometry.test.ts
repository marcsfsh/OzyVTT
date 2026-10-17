import { describe, expect, it } from "vitest";
import {
  clearLine,
  clipToStar,
  convexFan,
  insidePolygon,
  signedArea,
  visibilityPolygon,
  type Segment
} from "../src/vision/geometry.js";
import { emptyBits, exploredGridFor, isMarked, markedRects, markPolygons } from "../src/vision/explored.js";

const BOUNDS = { width: 1000, height: 600 };
const wall = (ax: number, ay: number, bx: number, by: number): Segment => ({ ax, ay, bx, by });

describe("vision geometry", () => {
  it("sees the whole map when nothing is in the way", () => {
    const polygon = visibilityPolygon({ x: 100, y: 100 }, [], BOUNDS);
    // Corners come from rays a hair either side of them, so the area is off by a few square pixels at most.
    expect(Math.abs(signedArea(polygon))).toBeGreaterThan(1000 * 600 - 20);
    expect(Math.abs(signedArea(polygon))).toBeLessThanOrEqual(1000 * 600);
  });

  it("stops at a wall and sees round its end", () => {
    // A wall from the top down to y = 400 at x = 500; the viewer at the left.
    const walls = [wall(500, 0, 500, 400)];
    const polygon = visibilityPolygon({ x: 100, y: 200 }, walls, BOUNDS);
    expect(insidePolygon({ x: 400, y: 200 }, polygon)).toBe(true);
    expect(insidePolygon({ x: 700, y: 200 }, polygon)).toBe(false);
    // Under the wall's end the view carries on, as far as the shadow its end casts.
    expect(insidePolygon({ x: 700, y: 590 }, polygon)).toBe(true);
    expect(insidePolygon({ x: 950, y: 590 }, polygon)).toBe(false);
    expect(clearLine({ x: 100, y: 200 }, { x: 700, y: 200 }, walls)).toBe(false);
    expect(clearLine({ x: 100, y: 500 }, { x: 700, y: 500 }, walls)).toBe(true);
  });

  it("blocks a sight line through the corner where two walls meet", () => {
    const walls = [wall(500, 0, 500, 300), wall(500, 300, 1000, 300)];
    // The line from (400, 200) to (600, 400) passes exactly through the corner (500, 300).
    expect(clearLine({ x: 400, y: 200 }, { x: 600, y: 400 }, walls)).toBe(false);
  });

  it("limits a polygon to a radius, drawn as a close circle", () => {
    const polygon = visibilityPolygon({ x: 500, y: 300 }, [], BOUNDS, 100);
    expect(Math.abs(signedArea(polygon))).toBeGreaterThan(Math.PI * 100 * 100 * 0.995);
    expect(Math.abs(signedArea(polygon))).toBeLessThanOrEqual(Math.PI * 100 * 100 + 1);
    expect(insidePolygon({ x: 590, y: 300 }, polygon)).toBe(true);
    expect(insidePolygon({ x: 610, y: 300 }, polygon)).toBe(false);
  });

  it("cuts a star-shaped area into convex pieces that cover it", () => {
    const walls = [wall(300, 100, 300, 500), wall(700, 0, 700, 250)];
    const center = { x: 150, y: 300 };
    const star = visibilityPolygon(center, walls, BOUNDS);
    const pieces = convexFan(star, center);
    const total = pieces.reduce((sum, piece) => sum + Math.abs(signedArea(piece)), 0);
    expect(total).toBeCloseTo(Math.abs(signedArea(star)), 0);
  });

  it("clips a light's area to what a viewer sees, and nothing beyond it", () => {
    // A light behind a wall from the viewer lights both sides of a gap; only the viewer's side of the wall counts.
    const walls = [wall(400, 0, 400, 400)];
    const viewer = { x: 100, y: 200 };
    const light = { x: 500, y: 200 };
    const sight = visibilityPolygon(viewer, walls, BOUNDS);
    const lit = visibilityPolygon(light, walls, BOUNDS, 300);
    const pieces = clipToStar(lit, sight, viewer);
    const inPieces = (point: { x: number; y: number }) => pieces.some((piece) => insidePolygon(point, piece));
    // Lit and in sight: below the wall's end, near the light.
    expect(inPieces({ x: 450, y: 450 })).toBe(true);
    // Lit but behind the wall from the viewer.
    expect(inPieces({ x: 500, y: 200 })).toBe(false);
    // In sight but out of the light's reach.
    expect(inPieces({ x: 120, y: 200 })).toBe(false);
  });
});

describe("what the party has seen", () => {
  const measure = { width: 1000, height: 600, pixelsPerFoot: 10 };

  it("marks half-cell squares whose centres are in sight, and lists them as rects", () => {
    const grid = exploredGridFor(measure);
    expect(grid).toEqual({ cellPx: 25, columns: 40, rows: 24 });
    const bytes = emptyBits(grid);
    const square = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 }
    ];
    expect(markPolygons(grid, bytes, [square])).toBe(true);
    expect(isMarked(grid, bytes, { x: 60, y: 30 })).toBe(true);
    expect(isMarked(grid, bytes, { x: 160, y: 30 })).toBe(false);
    expect(markedRects(grid, bytes)).toEqual([{ x: 0, y: 0, width: 100, height: 50 }]);
    // Marking the same area again changes nothing.
    expect(markPolygons(grid, bytes, [square])).toBe(false);
  });

  it("keeps the bitmap at most 256 squares a side on a huge map", () => {
    const grid = exploredGridFor({ width: 20000, height: 10000, pixelsPerFoot: 10 });
    expect(grid.columns).toBeLessThanOrEqual(256);
    expect(grid.rows).toBeLessThanOrEqual(256);
  });
});
