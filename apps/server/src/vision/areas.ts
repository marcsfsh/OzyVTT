import type { CombatState, GameState, VisionArea, VisionAreaKind, VisionSource } from "@vtt/domain";
import { distance, distanceToSegment, insidePolygon, type Point, type Polygon, type Segment } from "./geometry.js";

/**
 * The scene's areas of light and obscurement (SRD Rules Glossary: Bright Light, Dim Light, Darkness, Lightly and
 * Heavily Obscured, and the Darkness spell's magical Darkness) as plane shapes in image pixels: a GM's rect or circle,
 * a spell's placed template read from its annotation as it moves, or an Emanation around a creature's token.
 */

type Token = CombatState["tokens"][number];
type Annotation = CombatState["annotations"][number];

export type ResolvedArea = Readonly<{
  id: string;
  kind: VisionAreaKind;
  sunlight: boolean;
  source: VisionSource | undefined;
  /** The one creature that sees through it. */
  sparedActorId: string | null;
  /** Whether a point lies inside. */
  contains: (point: Point) => boolean;
  /** Whether the segment from `a` to `b` touches the area: crosses it, or starts or ends inside it. */
  touches: (a: Point, b: Point) => boolean;
  /** The outline as segments, for visibility polygons (a circle as a many-sided polygon round it). */
  edges: readonly Segment[];
  /** The outline as one polygon, for drawing and clipping. */
  outline: Polygon;
  /** The axis-aligned rect, for a rect area. */
  rect: Readonly<{ x: number; y: number; width: number; height: number }> | null;
}>;

/** Sides of the polygon drawn round a circle: within a third of a percent of its radius. */
const CIRCLE_SIDES = 40;

function circleOutline(center: Point, radius: number): Point[] {
  // Circumscribed, so the outline never cuts inside the circle the rules measure.
  const outer = radius / Math.cos(Math.PI / CIRCLE_SIDES);
  return Array.from({ length: CIRCLE_SIDES }, (_, index) => {
    const angle = (2 * Math.PI * index) / CIRCLE_SIDES;
    return { x: center.x + outer * Math.cos(angle), y: center.y + outer * Math.sin(angle) };
  });
}

const edgesOf = (outline: Polygon): Segment[] =>
  outline.map((point, index) => {
    const next = outline[(index + 1) % outline.length]!;
    return { ax: point.x, ay: point.y, bx: next.x, by: next.y };
  });

function segmentsCross(p1: Point, p2: Point, edge: Segment): boolean {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = edge.bx - edge.ax;
  const d2y = edge.by - edge.ay;
  const denominator = d1x * d2y - d1y * d2x;
  if (Math.abs(denominator) < 1e-12) return false;
  const t = ((edge.ax - p1.x) * d2y - (edge.ay - p1.y) * d2x) / denominator;
  const u = ((edge.ax - p1.x) * d1y - (edge.ay - p1.y) * d1x) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function circleArea(area: VisionArea, center: Point, radius: number): ResolvedArea {
  const outline = circleOutline(center, radius);
  const segment = (a: Point, b: Point): Segment => ({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
  return {
    id: area.id,
    kind: area.kind,
    sunlight: area.sunlight === true,
    source: area.source,
    sparedActorId: area.sparedActorId ?? null,
    contains: (point) => distance(point, center) <= radius + 1e-6,
    touches: (a, b) => distanceToSegment(center, segment(a, b)) <= radius + 1e-6,
    edges: edgesOf(outline),
    outline,
    rect: null
  };
}

/** A ringed wall's edge (Wall of Fire's ring): the band between two circles. The outline runs round the outer circle
 *  and back round the inner one, so it is drawn and clipped with its middle left open. */
function ringArea(area: VisionArea, center: Point, radius: number, thickness: number): ResolvedArea {
  const inner = Math.max(0, radius - thickness);
  const outer = circleOutline(center, radius);
  const hole = circleOutline(center, inner).reverse();
  const outline = [...outer, outer[0]!, ...hole, hole[0]!];
  const segment = (a: Point, b: Point): Segment => ({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
  return {
    id: area.id,
    kind: area.kind,
    sunlight: area.sunlight === true,
    source: area.source,
    sparedActorId: area.sparedActorId ?? null,
    contains: (point) => {
      const apart = distance(point, center);
      return apart <= radius + 1e-6 && apart > inner;
    },
    // A sight line touches the band unless it stays wholly inside the ring or wholly outside it.
    touches: (a, b) =>
      distanceToSegment(center, segment(a, b)) <= radius + 1e-6 &&
      Math.max(distance(a, center), distance(b, center)) > inner,
    edges: [...edgesOf(outer), ...edgesOf(hole)],
    outline,
    rect: null
  };
}

function polygonArea(area: VisionArea, outline: Polygon, rect: ResolvedArea["rect"]): ResolvedArea | null {
  if (outline.length < 3) return null;
  const edges = edgesOf(outline);
  const contains = (point: Point) => insidePolygon(point, outline);
  return {
    id: area.id,
    kind: area.kind,
    sunlight: area.sunlight === true,
    source: area.source,
    sparedActorId: area.sparedActorId ?? null,
    contains,
    touches: (a, b) => contains(a) || contains(b) || edges.some((edge) => segmentsCross(a, b, edge)),
    edges,
    outline,
    rect
  };
}

const rectOutline = (x: number, y: number, width: number, height: number): Point[] => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height }
];

/** A template annotation's shape as the rules measure it (`area-targeting.ts`): a circle about its origin, a square
 *  between its corners, a cone as wide as it is long, a line of `widthFeet`. */
function templateArea(
  area: VisionArea,
  annotation: Annotation,
  widthPx: number | null,
  ringPx: number | null
): ResolvedArea | null {
  const { origin, target } = annotation.geometry;
  const length = distance(origin, target);
  switch (annotation.shape) {
    case "circle":
      if (length <= 0) return null;
      return ringPx !== null ? ringArea(area, origin, length, ringPx) : circleArea(area, origin, length);
    case "square": {
      const x = Math.min(origin.x, target.x);
      const y = Math.min(origin.y, target.y);
      const width = Math.abs(target.x - origin.x);
      const height = Math.abs(target.y - origin.y);
      return width > 0 && height > 0
        ? polygonArea(area, rectOutline(x, y, width, height), { x, y, width, height })
        : null;
    }
    case "cone":
    case "line": {
      if (length === 0) return null;
      const axis = { x: (target.x - origin.x) / length, y: (target.y - origin.y) / length };
      const normal = { x: -axis.y, y: axis.x };
      const half = annotation.shape === "cone" ? length / 2 : (widthPx ?? 0) / 2;
      if (half <= 0) return null;
      const at = (point: Point, side: number) => ({ x: point.x + normal.x * side, y: point.y + normal.y * side });
      const outline =
        annotation.shape === "cone"
          ? [origin, at(target, half), at(target, -half)]
          : [at(origin, half), at(target, half), at(target, -half), at(origin, -half)];
      return polygonArea(area, outline, null);
    }
    default:
      return null;
  }
}

/** Half a token's side in pixels: an Emanation reaches from the edge of its creature's space. */
export const halfSpaceOf = (token: Token) => Math.max(token.sizePx, (token.gridSizePx ?? 0) * token.sizeCells) / 2;

/** The scene's areas resolved against the map: a template whose annotation is gone, or an Emanation whose creature is
 *  off the map, has no place and is left out. */
export function resolveAreas(
  areas: readonly VisionArea[],
  combat: Readonly<{ annotations: readonly Annotation[]; tokens: readonly Token[] }>,
  pixelsPerFoot: number
): ResolvedArea[] {
  const resolved: ResolvedArea[] = [];
  for (const area of areas) {
    const shape = area.shape;
    let piece: ResolvedArea | null = null;
    if (shape.type === "rect")
      piece = polygonArea(area, rectOutline(shape.x, shape.y, shape.width, shape.height), {
        x: shape.x,
        y: shape.y,
        width: shape.width,
        height: shape.height
      });
    else if (shape.type === "circle") piece = circleArea(area, shape, shape.radiusFeet * pixelsPerFoot);
    else if (shape.type === "template") {
      const annotation = combat.annotations.find((candidate) => candidate.id === shape.annotationId);
      if (annotation)
        piece = templateArea(
          area,
          annotation,
          shape.widthFeet === null ? null : shape.widthFeet * pixelsPerFoot,
          shape.ringFeet === undefined ? null : shape.ringFeet * pixelsPerFoot
        );
    } else {
      const token = combat.tokens.find((candidate) => candidate.actorId === shape.actorId);
      if (token?.position)
        piece = circleArea(area, token.position, shape.radiusFeet * pixelsPerFoot + halfSpaceOf(token));
    }
    if (piece) resolved.push(piece);
  }
  return resolved;
}

/** The centre of a placed template, where a light that fills it shines from. */
export function templateCentre(annotation: Annotation): Point {
  const { origin, target } = annotation.geometry;
  return annotation.shape === "square" || annotation.shape === "line"
    ? { x: (origin.x + target.x) / 2, y: (origin.y + target.y) / 2 }
    : origin;
}

/** Whether what keeps a light or an area is still there: its cast's Concentration, its effect, its rounds. */
export function sourceLive(state: GameState, source: VisionSource | undefined): boolean {
  if (!source) return true;
  const holds = (test: (effect: GameState["actors"][number]["effects"][number]) => boolean) =>
    state.actors.some((actor) => actor.effects.some(test));
  if (source.castId !== undefined && !holds((effect) => effect.castId === source.castId)) return false;
  if (source.effectId !== undefined && !holds((effect) => effect.id === source.effectId)) return false;
  if (source.untilRound !== undefined && (!state.combat.active || state.combat.round > source.untilRound)) return false;
  return true;
}
