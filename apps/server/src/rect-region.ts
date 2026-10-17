// A region of the map as disjoint axis-aligned rects, in image pixels. Painted difficult terrain is stored this
// way, and clipped against the fog's revealed region before it reaches a player or the table screen.

export type Rect = Readonly<{ x: number; y: number; width: number; height: number }>;

/** Slivers thinner than this are float noise from snapping and count as no area. */
const EPSILON = 0.01;

const right = (rect: Rect) => rect.x + rect.width;
const bottom = (rect: Rect) => rect.y + rect.height;

function rect(x: number, y: number, x2: number, y2: number): Rect | null {
  return x2 - x > EPSILON && y2 - y > EPSILON ? { x, y, width: x2 - x, height: y2 - y } : null;
}

export function intersect(a: Rect, b: Rect): Rect | null {
  return rect(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.min(right(a), right(b)), Math.min(bottom(a), bottom(b)));
}

/** `a` with `b` cut out: up to four rects (a band above, a band below, and the two sides between). */
function subtract(a: Rect, b: Rect): Rect[] {
  const overlap = intersect(a, b);
  if (!overlap) return [a];
  return [
    rect(a.x, a.y, right(a), overlap.y),
    rect(a.x, bottom(overlap), right(a), bottom(a)),
    rect(a.x, overlap.y, overlap.x, bottom(overlap)),
    rect(right(overlap), overlap.y, right(a), bottom(overlap))
  ].filter((piece): piece is Rect => piece !== null);
}

/** Joins rects that share a whole edge, so repeated strokes over the same area don't fragment it forever. */
function merged(region: readonly Rect[]): Rect[] {
  const rects = [...region];
  const near = (a: number, b: number) => Math.abs(a - b) <= EPSILON;
  for (let changed = true; changed;) {
    changed = false;
    outer: for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        const sideBySide = near(a.y, b.y) && near(a.height, b.height) && (near(right(a), b.x) || near(right(b), a.x));
        const stacked = near(a.x, b.x) && near(a.width, b.width) && (near(bottom(a), b.y) || near(bottom(b), a.y));
        if (!sideBySide && !stacked) continue;
        const joined = rect(
          Math.min(a.x, b.x),
          Math.min(a.y, b.y),
          Math.max(right(a), right(b)),
          Math.max(bottom(a), bottom(b))
        );
        if (!joined) continue;
        rects.splice(j, 1);
        rects[i] = joined;
        changed = true;
        break outer;
      }
    }
  }
  return rects;
}

/** The region plus `added`, still disjoint. */
export function unionRect(region: readonly Rect[], added: Rect): Rect[] {
  return merged([...region.flatMap((piece) => subtract(piece, added)), added]);
}

/** The region minus `removed`. */
export function subtractRect(region: readonly Rect[], removed: Rect): Rect[] {
  return merged(region.flatMap((piece) => subtract(piece, removed)));
}

/** The parts of `region` that also lie in `mask`. Both are disjoint, so the result is too. */
export function intersectRegions(region: readonly Rect[], mask: readonly Rect[]): Rect[] {
  return merged(region.flatMap((piece) => mask.flatMap((cover) => intersect(piece, cover) ?? [])));
}
