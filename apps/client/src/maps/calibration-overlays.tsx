import { Button } from "@vtt/ui";

/** The calibration canvas's drawn aids: the 3 × 3 area being placed and the alignment crosshair. */

type Point = Readonly<{ x: number; y: number }>;

/**
 * Snaps a drag point to an axis-aligned square from the start corner: side = the larger delta, sign
 * follows the drag, clamped inside the map. The square is a client preview constraint:
 * `deriveSquareGridFromArea` (`grid-calibration.ts`) accepts a rectangle and averages its axes, so
 * forcing a square shows the GM the same shape the server will measure.
 */
export function squareCorner(start: Point, raw: Point, width: number, height: number): Point {
  const signX = raw.x < start.x ? -1 : 1;
  const signY = raw.y < start.y ? -1 : 1;
  const maxX = signX > 0 ? width - start.x : start.x;
  const maxY = signY > 0 ? height - start.y : start.y;
  const side = Math.min(Math.max(Math.abs(raw.x - start.x), Math.abs(raw.y - start.y)), maxX, maxY);
  return { x: start.x + signX * side, y: start.y + signY * side };
}

export function GridAreaPreview({ start, end, handle }: Readonly<{ start: Point; end: Point; handle?: boolean }>) {
  const x0 = Math.min(start.x, end.x);
  const y0 = Math.min(start.y, end.y);
  const size = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
  return (
    <g className="grid-area-preview">
      <rect x={x0} y={y0} width={size} height={size} />
      {[1, 2].flatMap((third) => [
        <line key={`v${third}`} x1={x0 + (size * third) / 3} y1={y0} x2={x0 + (size * third) / 3} y2={y0 + size} />,
        <line key={`h${third}`} x1={x0} y1={y0 + (size * third) / 3} x2={x0 + size} y2={y0 + (size * third) / 3} />
      ])}
      {handle && <circle className="grid-area-handle" cx={end.x} cy={end.y} r={Math.max(6, size / 24)} />}
    </g>
  );
}

/** Crosshair colours for two full-map guide lines that follow the point being placed, for lining up corners against printed grid art. */
export const CROSSHAIR_PRESETS: ReadonlyArray<{ color: string; label: string }> = [
  { color: "#2de2ff", label: "Cyan" },
  { color: "#ff2e9a", label: "Magenta" },
  { color: "#a45cff", label: "Violet" },
  { color: "#ff2d5e", label: "Rose" },
  { color: "#ffffff", label: "White" }
];
export function CrosshairOverlay({
  points,
  width,
  height,
  crosshair
}: Readonly<{
  points: readonly Point[];
  width: number;
  height: number;
  crosshair: Crosshair;
}>) {
  const dash = crosshair.style === "dashed" ? "6 5" : crosshair.style === "dotted" ? "1 6" : "none";
  return (
    <g
      className="grid-crosshair"
      aria-hidden="true"
      style={{ stroke: crosshair.color, opacity: crosshair.opacity, strokeDasharray: dash }}
    >
      {points.map((point, index) => (
        <g key={index}>
          <line x1={0} y1={point.y} x2={width} y2={point.y} />
          <line x1={point.x} y1={0} x2={point.x} y2={height} />
        </g>
      ))}
    </g>
  );
}

/** How the alignment crosshair is drawn; a GM preference for the session. */
export type Crosshair = Readonly<{ color: string; opacity: number; style: "dashed" | "dotted" | "solid" }>;
export const DEFAULT_CROSSHAIR: Crosshair = { color: "#2de2ff", opacity: 0.8, style: "dashed" };

export function CrosshairControls({
  value,
  onChange
}: Readonly<{ value: Crosshair; onChange: (next: Crosshair) => void }>) {
  return (
    <div className="crosshair-controls" role="group" aria-label="Alignment crosshair">
      <span className="crosshair-label">Crosshair</span>
      <div className="crosshair-swatches">
        {CROSSHAIR_PRESETS.map((preset) => (
          <button
            key={preset.color}
            type="button"
            aria-label={preset.label}
            aria-pressed={value.color.toLowerCase() === preset.color}
            style={{ "--swatch": preset.color } as React.CSSProperties}
            onClick={() => onChange({ ...value, color: preset.color })}
          />
        ))}
      </div>
      <label className="crosshair-color">
        Custom
        <input
          type="color"
          value={value.color}
          onChange={(event) => onChange({ ...value, color: event.target.value })}
        />
      </label>
      <label className="crosshair-opacity">
        Opacity
        <input
          type="range"
          min="0.2"
          max="1"
          step="0.05"
          value={value.opacity}
          onChange={(event) => onChange({ ...value, opacity: Number(event.target.value) })}
        />
      </label>
      <Button
        variant="secondary"
        className="crosshair-style"
        onClick={() =>
          onChange({
            ...value,
            style: value.style === "dashed" ? "dotted" : value.style === "dotted" ? "solid" : "dashed"
          })
        }
      >
        {value.style === "dashed" ? "Dashed" : value.style === "dotted" ? "Dotted" : "Solid"}
      </Button>
    </div>
  );
}
