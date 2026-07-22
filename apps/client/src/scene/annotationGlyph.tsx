import "./annotation.css";

export type GlyphShape = "circle" | "cone" | "line" | "square" | null;
type Point = { x: number; y: number };
export type AnnotationGlyphData = Readonly<{
  kind: "measurement" | "shape";
  shape: GlyphShape;
  origin: Point;
  target: Point;
  sizeFeet: number;
}>;

const SHAPE_NAMES: Record<Exclude<GlyphShape, null>, string> = { circle: "Circle", cone: "Cone", line: "Line", square: "Square" };

/** Center point used to anchor the "{feet}ft {Shape}" label. */
export function annotationCenter(data: AnnotationGlyphData): Point {
  if (data.kind === "shape" && data.shape === "circle") return data.origin;
  if (data.kind === "shape" && data.shape === "cone") return { x: data.origin.x + (data.target.x - data.origin.x) * 0.5, y: data.origin.y + (data.target.y - data.origin.y) * 0.5 };
  return { x: (data.origin.x + data.target.x) / 2, y: (data.origin.y + data.target.y) / 2 };
}

/** The outline geometry for a shape - shared by the encounter map's live preview and confirmed shapes. */
export function ShapeOutline({ shape, origin, target, className, style }: Readonly<{ shape: Exclude<GlyphShape, null>; origin: Point; target: Point; className: string; style?: React.CSSProperties }>) {
  if (shape === "circle") return <circle className={className} style={style} cx={origin.x} cy={origin.y} r={Math.max(1, Math.hypot(target.x - origin.x, target.y - origin.y))} />;
  if (shape === "square") {
    const size = Math.max(Math.abs(target.x - origin.x), Math.abs(target.y - origin.y));
    return <rect className={className} style={style} x={Math.min(origin.x, target.x)} y={Math.min(origin.y, target.y)} width={size} height={size} />;
  }
  if (shape === "line") return <line className={className} style={style} x1={origin.x} y1={origin.y} x2={target.x} y2={target.y} />;
  // Cone: apex at origin, opening toward target; 5e RAW cones have equal length and width (half-angle = atan(0.5)).
  const length = Math.max(1, Math.hypot(target.x - origin.x, target.y - origin.y));
  const angle = Math.atan2(target.y - origin.y, target.x - origin.x);
  const halfAngle = Math.atan2(0.5, 1);
  const left = { x: origin.x + Math.cos(angle - halfAngle) * length, y: origin.y + Math.sin(angle - halfAngle) * length };
  const right = { x: origin.x + Math.cos(angle + halfAngle) * length, y: origin.y + Math.sin(angle + halfAngle) * length };
  return <polygon className={className} style={style} points={`${origin.x},${origin.y} ${left.x},${left.y} ${right.x},${right.y}`} />;
}

/** A transient "look here" ping: an expanding ring, a center dot, and the sender's name. Shared by the encounter map and the shared-screen viewer. */
export function PingGlyph({ point, color, label, size }: Readonly<{ point: Point; color: string; label: string | null; size: number }>) {
  return <g className="annotation-ping" style={{ color }}>
    <circle className="annotation-ping-ring" cx={point.x} cy={point.y} r={size} />
    <circle className="annotation-ping-core" cx={point.x} cy={point.y} r={size * 0.34} />
    {label && <text className="annotation-ping-label" x={point.x} y={point.y - size * 1.3} style={{ fontSize: size * 0.9, strokeWidth: Math.max(2, size * 0.18) }}>{label}</text>}
  </g>;
}

/** Filled triangle at `target`, pointing from `origin` toward `target` - the measurement arrowhead. */
function arrowPoints(origin: Point, target: Point, size: number) {
  const angle = Math.atan2(target.y - origin.y, target.x - origin.x);
  const back = angle + Math.PI;
  const spread = 0.5;
  const p1 = { x: target.x + Math.cos(back - spread) * size, y: target.y + Math.sin(back - spread) * size };
  const p2 = { x: target.x + Math.cos(back + spread) * size, y: target.y + Math.sin(back + spread) * size };
  return `${target.x},${target.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`;
}

/**
 * Renders a measurement (line + arrowhead + centered "{feet} ft") or a shape (outline + centered
 * "{feet}ft {Shape}"). Shared by the encounter map and the shared-screen viewer so both look
 * identical. `arrowSize` scales the arrowhead to the map's grid so it reads at any zoom.
 */
export function AnnotationGlyph({ data, arrowSize = 14, labelSize = 16, color = "#58c3ff", expiring = false, labelPoint }: Readonly<{ data: AnnotationGlyphData; arrowSize?: number; labelSize?: number; color?: string; expiring?: boolean; labelPoint?: Point }>) {
  const center = labelPoint ?? annotationCenter(data);
  const labelStyle = { fontSize: labelSize, strokeWidth: Math.max(3, labelSize * 0.22) };
  if (data.kind === "measurement") {
    return <g className={`annotation-measurement${expiring ? " expiring" : ""}`}>
      <line x1={data.origin.x} y1={data.origin.y} x2={data.target.x} y2={data.target.y} style={{ stroke: color }} />
      <circle cx={data.origin.x} cy={data.origin.y} r={4} style={{ fill: color }} />
      <polygon className="annotation-arrow" points={arrowPoints(data.origin, data.target, arrowSize)} style={{ fill: color }} />
      <text style={labelStyle} x={center.x} y={center.y - labelSize}>{data.sizeFeet} ft</text>
    </g>;
  }
  return <>
    {data.shape && <ShapeOutline shape={data.shape} origin={data.origin} target={data.target} className="annotation-shape-body" style={{ stroke: color, fill: color, fillOpacity: 0.28 }} />}
    <text className="annotation-shape-label" style={labelStyle} x={center.x} y={center.y}>{data.sizeFeet}ft {data.shape ? SHAPE_NAMES[data.shape] : ""}</text>
  </>;
}
