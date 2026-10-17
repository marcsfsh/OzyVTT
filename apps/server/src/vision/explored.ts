import type { SceneVision, VisionRect } from "@vtt/domain";
import { boundsOf, type Point, type Polygon } from "./geometry.js";

/**
 * What the party has seen on a scene, remembered as a bitmap over the map: a square is explored once its centre has
 * been in sight. Half a 5-foot cell by default, coarser on a very large map so the bitmap stays at most 256 a side.
 * Only ever grows, until the GM resets it.
 */

export type ExploredGrid = Readonly<{ cellPx: number; columns: number; rows: number }>;
type Measure = NonNullable<SceneVision["measure"]>;

const MAX_SIDE = 256;

export function exploredGridFor(measure: Measure): ExploredGrid {
  const cellPx = Math.max(measure.pixelsPerFoot * 2.5, measure.width / MAX_SIDE, measure.height / MAX_SIDE);
  return {
    cellPx,
    columns: Math.min(MAX_SIDE, Math.max(1, Math.ceil(measure.width / cellPx))),
    rows: Math.min(MAX_SIDE, Math.max(1, Math.ceil(measure.height / cellPx)))
  };
}

export function emptyBits(grid: ExploredGrid): Uint8Array {
  return new Uint8Array(Math.ceil((grid.columns * grid.rows) / 8));
}

export function decodeBits(grid: ExploredGrid, bits: string): Uint8Array {
  const bytes = emptyBits(grid);
  const decoded = Buffer.from(bits, "base64");
  bytes.set(decoded.subarray(0, bytes.length));
  return bytes;
}

export const encodeBits = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

const bitAt = (bytes: Uint8Array, index: number) => (bytes[index >> 3]! & (1 << (index & 7))) !== 0;

export function isMarked(grid: ExploredGrid, bytes: Uint8Array, point: Point): boolean {
  const column = Math.floor(point.x / grid.cellPx);
  const row = Math.floor(point.y / grid.cellPx);
  if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) return false;
  return bitAt(bytes, row * grid.columns + column);
}

/** Marks every square whose centre lies inside one of the polygons (scanlines, even-odd). Returns whether any
 *  square was new. */
export function markPolygons(grid: ExploredGrid, bytes: Uint8Array, polygons: readonly Polygon[]): boolean {
  let changed = false;
  for (const polygon of polygons) {
    if (polygon.length < 3) continue;
    const box = boundsOf(polygon);
    const firstRow = Math.max(0, Math.floor(box.minY / grid.cellPx - 0.5));
    const lastRow = Math.min(grid.rows - 1, Math.ceil(box.maxY / grid.cellPx - 0.5));
    for (let row = firstRow; row <= lastRow; row++) {
      const y = (row + 0.5) * grid.cellPx;
      const crossings: number[] = [];
      for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
        const a = polygon[index]!;
        const b = polygon[previous]!;
        if (a.y > y !== b.y > y) crossings.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
      crossings.sort((left, right) => left - right);
      for (let pair = 0; pair + 1 < crossings.length; pair += 2) {
        const from = Math.max(0, Math.ceil(crossings[pair]! / grid.cellPx - 0.5));
        const to = Math.min(grid.columns - 1, Math.floor(crossings[pair + 1]! / grid.cellPx - 0.5));
        for (let column = from; column <= to; column++) {
          const index = row * grid.columns + column;
          if (bitAt(bytes, index)) continue;
          bytes[index >> 3] |= 1 << (index & 7);
          changed = true;
        }
      }
    }
  }
  return changed;
}

/** The marked squares as rects: each row's runs, stacked where the run below is the same. */
export function markedRects(grid: ExploredGrid, bytes: Uint8Array): VisionRect[] {
  const open = new Map<string, { x: number; y: number; width: number; height: number }>();
  const rects: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (let row = 0; row < grid.rows; row++) {
    const runs: Array<[number, number]> = [];
    for (let column = 0; column < grid.columns; column++) {
      if (!bitAt(bytes, row * grid.columns + column)) continue;
      const last = runs.at(-1);
      if (last && last[1] === column - 1) last[1] = column;
      else runs.push([column, column]);
    }
    const next = new Map<string, { x: number; y: number; width: number; height: number }>();
    for (const [from, to] of runs) {
      const key = `${from}-${to}`;
      const above = open.get(key);
      if (above) {
        above.height += grid.cellPx;
        next.set(key, above);
      } else {
        const rect = {
          x: from * grid.cellPx,
          y: row * grid.cellPx,
          width: (to - from + 1) * grid.cellPx,
          height: grid.cellPx
        };
        rects.push(rect);
        next.set(key, rect);
      }
    }
    open.clear();
    for (const [key, rect] of next) open.set(key, rect);
  }
  const round = (value: number) => Math.round(value * 10) / 10;
  return rects.map((rect) => ({
    x: round(rect.x),
    y: round(rect.y),
    width: round(rect.width),
    height: round(rect.height)
  }));
}
