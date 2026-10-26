import { useId } from "react";

type Rect = Readonly<{ x: number; y: number; width: number; height: number }>;

/** A trap drawn on the map: every trap for the GM, a found one for players and the table screen. */
export type OverlayTrap = Readonly<{
  id: string;
  name: string;
  area: Rect;
  state: "armed" | "sprung" | "disarmed";
  /** Whether the party has found it (the GM's view; a player's traps are all found). */
  found?: boolean;
}>;

const key = (rect: Rect) => `${rect.x},${rect.y},${rect.width},${rect.height}`;

/**
 * Painted ground, under drawings and tokens: difficult terrain as diagonal hatching, still water as a blue wash with
 * ripples, running water the same with flow lines, slippery ice as a pale wash with cross-hatching, and traps as a
 * dashed outline with a warning mark. Patterns read on any map art without hiding it, and don't rely on colour alone.
 * Players and the table screen are sent only the ground their fog reveals and the traps the party has found.
 */
export function TerrainOverlay({
  difficult,
  water = [],
  runningWater = [],
  ice = [],
  traps = [],
  cellSizePx
}: Readonly<{
  difficult: readonly Rect[];
  water?: readonly Rect[];
  runningWater?: readonly Rect[];
  ice?: readonly Rect[];
  traps?: readonly OverlayTrap[];
  /** Scales the patterns to the grid, so they look the same at every map resolution. */
  cellSizePx: number;
}>) {
  const baseId = useId();
  if (difficult.length + water.length + runningWater.length + ice.length + traps.length === 0) return null;
  const spacing = Math.max(6, cellSizePx / 4);
  const ids = {
    hatch: `${baseId}-hatch`,
    ripple: `${baseId}-ripple`,
    flow: `${baseId}-flow`,
    frost: `${baseId}-frost`
  };
  return (
    <g className="terrain-overlay" pointerEvents="none">
      <title>Painted ground</title>
      <defs>
        <pattern
          id={ids.hatch}
          patternUnits="userSpaceOnUse"
          width={spacing}
          height={spacing}
          patternTransform="rotate(45)"
        >
          <rect className="terrain-hatch" width={spacing * 0.35} height={spacing} />
        </pattern>
        <pattern id={ids.ripple} patternUnits="userSpaceOnUse" width={spacing * 2} height={spacing}>
          <path
            className="terrain-ripple"
            d={`M0 ${spacing / 2} q ${spacing / 2} ${-spacing / 3} ${spacing} 0 t ${spacing} 0`}
            fill="none"
          />
        </pattern>
        <pattern id={ids.flow} patternUnits="userSpaceOnUse" width={spacing * 2} height={spacing}>
          <path
            className="terrain-flow"
            d={`M0 ${spacing / 2} h ${spacing * 1.4} l -${spacing / 3} -${spacing / 4}`}
            fill="none"
          />
        </pattern>
        <pattern id={ids.frost} patternUnits="userSpaceOnUse" width={spacing} height={spacing}>
          <path className="terrain-frost" d={`M0 0 L${spacing} ${spacing} M${spacing} 0 L0 ${spacing}`} fill="none" />
        </pattern>
      </defs>
      {water.map((rect) => (
        <g key={`water-${key(rect)}`}>
          <rect className="terrain-water" x={rect.x} y={rect.y} width={rect.width} height={rect.height} />
          <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} fill={`url(#${ids.ripple})`} />
        </g>
      ))}
      {runningWater.map((rect) => (
        <g key={`running-${key(rect)}`}>
          <rect
            className="terrain-water terrain-running"
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={rect.height}
          />
          <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} fill={`url(#${ids.flow})`} />
        </g>
      ))}
      {ice.map((rect) => (
        <g key={`ice-${key(rect)}`}>
          <rect className="terrain-ice" x={rect.x} y={rect.y} width={rect.width} height={rect.height} />
          <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} fill={`url(#${ids.frost})`} />
        </g>
      ))}
      {difficult.map((rect) => (
        <rect
          key={`difficult-${key(rect)}`}
          className="terrain-difficult"
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          fill={`url(#${ids.hatch})`}
        />
      ))}
      {traps.map((trap) => (
        <g
          key={trap.id}
          className={`terrain-trap terrain-trap-${trap.state}${trap.found === false ? " terrain-trap-hidden" : ""}`}
        >
          <title>
            {trap.name}
            {trap.state === "disarmed" ? " (safe)" : trap.state === "sprung" ? " (sprung)" : ""}
          </title>
          <rect x={trap.area.x} y={trap.area.y} width={trap.area.width} height={trap.area.height} />
          <text
            x={trap.area.x + trap.area.width / 2}
            y={trap.area.y + trap.area.height / 2}
            fontSize={Math.max(10, Math.min(trap.area.width, trap.area.height, cellSizePx) * 0.5)}
            textAnchor="middle"
            dominantBaseline="central"
          >
            !
          </text>
        </g>
      ))}
    </g>
  );
}
