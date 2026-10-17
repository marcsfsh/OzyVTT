// Plane geometry for dynamic vision (ADR-0023), in image pixels: line of sight against walls, the area a point sees
// (a visibility polygon), and clipping one such area to another. Pure functions over plain points and segments.

export type Point = Readonly<{ x: number; y: number }>;
export type Segment = Readonly<{ ax: number; ay: number; bx: number; by: number }>;
/** A simple polygon, its vertices in order. */
export type Polygon = readonly Point[];
export type Bounds = Readonly<{ width: number; height: number }>;

/** Rays either side of a wall's end, so the polygon turns the corner there. */
const CORNER_NUDGE = 1e-5;
/** How finely a sight radius is drawn: one vertex every 3.75 degrees keeps the chord within 0.06% of the radius. */
const ARC_STEPS = 96;

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** The nearest point of a segment to `point`. */
export function nearestOnSegment(point: Point, segment: Segment): Point {
  const ex = segment.bx - segment.ax;
  const ey = segment.by - segment.ay;
  const length = ex * ex + ey * ey;
  const t =
    length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - segment.ax) * ex + (point.y - segment.ay) * ey) / length));
  return { x: segment.ax + t * ex, y: segment.ay + t * ey };
}

export const distanceToSegment = (point: Point, segment: Segment) => distance(point, nearestOnSegment(point, segment));

/** Whether a segment stands between two points. The line's own ends are left out (a sample on a wall's face sees),
 *  and a wall's ends count: a sight line through the corner where two walls meet is blocked. */
export function blocks(segment: Segment, from: Point, to: Point): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const ex = segment.bx - segment.ax;
  const ey = segment.by - segment.ay;
  const denominator = dx * ey - dy * ex;
  const ax = segment.ax - from.x;
  const ay = segment.ay - from.y;
  if (Math.abs(denominator) < 1e-12) return false; // parallel: a wall seen edge-on hides nothing behind it
  const t = (ax * ey - ay * ex) / denominator;
  const u = (ax * dy - ay * dx) / denominator;
  return t > 1e-7 && t < 1 - 1e-7 && u >= -1e-9 && u <= 1 + 1e-9;
}

/** Whether nothing in `segments` stands between two points. */
export function clearLine(from: Point, to: Point, segments: readonly Segment[]): boolean {
  for (const segment of segments) if (blocks(segment, from, to)) return false;
  return true;
}

/** Distance along a ray (unit direction) to a segment, or Infinity when it misses. */
function rayHit(ox: number, oy: number, dx: number, dy: number, segment: Segment): number {
  const ex = segment.bx - segment.ax;
  const ey = segment.by - segment.ay;
  const denominator = dx * ey - dy * ex;
  if (Math.abs(denominator) < 1e-12) return Infinity;
  const ax = segment.ax - ox;
  const ay = segment.ay - oy;
  const t = (ax * ey - ay * ex) / denominator;
  const u = (ax * dy - ay * dx) / denominator;
  return t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 ? t : Infinity;
}

/** Where a circle about `center` crosses a segment, as angles from the center. */
function circleCrossings(center: Point, radius: number, segment: Segment): number[] {
  const ex = segment.bx - segment.ax;
  const ey = segment.by - segment.ay;
  const fx = segment.ax - center.x;
  const fy = segment.ay - center.y;
  const a = ex * ex + ey * ey;
  const b = 2 * (fx * ex + fy * ey);
  const c = fx * fx + fy * fy - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (a === 0 || discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-b - root) / (2 * a), (-b + root) / (2 * a)]
    .filter((t) => t >= 0 && t <= 1)
    .map((t) => Math.atan2(segment.ay + t * ey - center.y, segment.ax + t * ex - center.x));
}

/**
 * The area `origin` can see, out to `radius` when given: one ray toward every wall end (and just either side of it),
 * ending at the first wall it meets, plus an arc where the radius runs out. The map's edges close it. Star-shaped
 * about `origin`, vertices in angle order.
 */
export function visibilityPolygon(
  origin: Point,
  segments: readonly Segment[],
  bounds: Bounds,
  radius?: number
): Point[] {
  const edges: Segment[] = [
    { ax: 0, ay: 0, bx: bounds.width, by: 0 },
    { ax: bounds.width, ay: 0, bx: bounds.width, by: bounds.height },
    { ax: bounds.width, ay: bounds.height, bx: 0, by: bounds.height },
    { ax: 0, ay: bounds.height, bx: 0, by: 0 }
  ];
  // A wall the origin stands on hides nothing from it (a token placed across a wall sees both ways).
  const near = segments.filter((segment) => {
    const gap = distanceToSegment(origin, segment);
    return gap > 0.01 && (radius === undefined || gap <= radius);
  });
  const all = [...near, ...edges];
  const angles: number[] = [];
  for (const segment of all)
    for (const [x, y] of [
      [segment.ax, segment.ay],
      [segment.bx, segment.by]
    ] as const) {
      if (radius !== undefined && Math.hypot(x - origin.x, y - origin.y) > radius * 1.5) continue;
      const angle = Math.atan2(y - origin.y, x - origin.x);
      angles.push(angle - CORNER_NUDGE, angle, angle + CORNER_NUDGE);
    }
  if (radius !== undefined) {
    for (let step = 0; step < ARC_STEPS; step++) angles.push(-Math.PI + (2 * Math.PI * step) / ARC_STEPS);
    for (const segment of all) angles.push(...circleCrossings(origin, radius, segment));
  }
  const normalized = angles.map((angle) =>
    angle <= -Math.PI ? angle + 2 * Math.PI : angle > Math.PI ? angle - 2 * Math.PI : angle
  );
  normalized.sort((a, b) => a - b);
  const points: Point[] = [];
  let last = Number.NaN;
  for (const angle of normalized) {
    if (angle - last < 1e-9) continue;
    last = angle;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let reach = radius ?? Infinity;
    for (const segment of all) {
      const hit = rayHit(origin.x, origin.y, dx, dy, segment);
      if (hit < reach) reach = hit;
    }
    if (!Number.isFinite(reach)) continue;
    points.push({ x: origin.x + dx * reach, y: origin.y + dy * reach });
  }
  return simplified(points);
}

/** Drops repeated vertices and those in a straight line with their neighbours. */
function simplified(points: readonly Point[]): Point[] {
  const kept: Point[] = [];
  for (const point of points) {
    const previous = kept.at(-1);
    if (previous && distance(previous, point) < 0.05) continue;
    kept.push(point);
  }
  if (kept.length > 1 && distance(kept[0]!, kept.at(-1)!) < 0.05) kept.pop();
  if (kept.length < 4) return kept;
  const result: Point[] = [];
  for (let index = 0; index < kept.length; index++) {
    const before = kept[(index + kept.length - 1) % kept.length]!;
    const here = kept[index]!;
    const after = kept[(index + 1) % kept.length]!;
    const cross = (here.x - before.x) * (after.y - before.y) - (here.y - before.y) * (after.x - before.x);
    const span = distance(before, after);
    if (span > 0 && Math.abs(cross) / span < 0.02) continue;
    result.push(here);
  }
  return result.length >= 3 ? result : kept;
}

export function signedArea(polygon: Polygon): number {
  let area = 0;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index]!;
    const b = polygon[(index + 1) % polygon.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/** Whether a point lies inside a polygon (even-odd). */
export function insidePolygon(point: Point, polygon: Polygon): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]!;
    const b = polygon[previous]!;
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

/** Sutherland-Hodgman: the part of `subject` inside the convex `clip`. A concave subject may come back with
 *  zero-width bridges along the clip's edge, which cover no area. */
export function clipToConvex(subject: Polygon, clip: Polygon): Point[] {
  const orientation = Math.sign(signedArea(clip)) || 1;
  let output: Point[] = [...subject];
  for (let index = 0; index < clip.length && output.length > 0; index++) {
    const a = clip[index]!;
    const b = clip[(index + 1) % clip.length]!;
    const side = (point: Point) => orientation * ((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x));
    const input = output;
    output = [];
    for (let at = 0; at < input.length; at++) {
      const current = input[at]!;
      const previous = input[(at + input.length - 1) % input.length]!;
      const currentIn = side(current) >= -1e-9;
      const previousIn = side(previous) >= -1e-9;
      if (currentIn !== previousIn) {
        const sp = side(previous);
        const sc = side(current);
        const t = sp / (sp - sc);
        output.push({ x: previous.x + t * (current.x - previous.x), y: previous.y + t * (current.y - previous.y) });
      }
      if (currentIn) output.push(current);
    }
  }
  return output;
}

/** A star-shaped polygon cut into convex pieces that fan out from its center: consecutive fan triangles are joined
 *  while the piece stays convex, so a plain room seen from inside is one piece. */
export function convexFan(star: Polygon, center: Point): Point[][] {
  const pieces: Point[][] = [];
  const turn = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const sign = Math.sign(signedArea(star)) || 1;
  let piece: Point[] = [];
  const close = () => {
    if (piece.length >= 3 && Math.abs(signedArea(piece)) > 0.01) pieces.push(piece);
    piece = [];
  };
  for (let index = 0; index < star.length; index++) {
    const a = star[index]!;
    const b = star[(index + 1) % star.length]!;
    if (Math.abs(turn(center, a, b)) < 1e-6) {
      close();
      continue;
    }
    if (piece.length === 0) {
      piece = [center, a, b];
      continue;
    }
    const tail = piece[piece.length - 1]!;
    const head = piece[1]!;
    const stays =
      tail === a &&
      sign * turn(piece[piece.length - 2]!, a, b) >= -1e-9 &&
      sign * turn(a, b, center) >= -1e-9 &&
      sign * turn(b, center, head) >= -1e-9;
    if (stays) piece.push(b);
    else {
      close();
      piece = [center, a, b];
    }
  }
  close();
  return pieces;
}

/** The part of `area` inside the star-shaped `star` about `center`, as convex-clipped pieces. */
export function clipToStar(area: Polygon, star: Polygon, center: Point): Point[][] {
  if (area.length < 3 || star.length < 3) return [];
  const box = boundsOf(area);
  return convexFan(star, center).flatMap((piece) => {
    const pieceBox = boundsOf(piece);
    if (pieceBox.maxX < box.minX || pieceBox.minX > box.maxX || pieceBox.maxY < box.minY || pieceBox.minY > box.maxY)
      return [];
    const clipped = clipToConvex(area, piece);
    return clipped.length >= 3 && Math.abs(signedArea(clipped)) > 0.5 ? [clipped] : [];
  });
}

export function boundsOf(polygon: Polygon) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of polygon) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

/** A polygon as flat pairs rounded to a tenth of a pixel, the wire shape. */
export function flatPolygon(polygon: Polygon): number[] {
  return polygon.flatMap((point) => [Math.round(point.x * 10) / 10, Math.round(point.y * 10) / 10]);
}
