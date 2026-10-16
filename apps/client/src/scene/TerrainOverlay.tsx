import { useId } from "react";

/**
 * Difficult terrain: diagonal hatching over each marked area, under drawings and tokens. Hatching reads on any
 * map art without hiding it, and doesn't rely on colour alone. Players and the table screen are sent only the
 * terrain their fog reveals.
 */
export function TerrainOverlay({
  difficult,
  cellSizePx
}: Readonly<{
  difficult: readonly Readonly<{ x: number; y: number; width: number; height: number }>[];
  /** Scales the hatching to the grid, so it looks the same at every map resolution. */
  cellSizePx: number;
}>) {
  const patternId = useId();
  if (difficult.length === 0) return null;
  const spacing = Math.max(6, cellSizePx / 4);
  return (
    <g className="terrain-overlay" pointerEvents="none">
      <title>Difficult terrain</title>
      <defs>
        <pattern
          id={patternId}
          patternUnits="userSpaceOnUse"
          width={spacing}
          height={spacing}
          patternTransform="rotate(45)"
        >
          <rect className="terrain-hatch" width={spacing * 0.35} height={spacing} />
        </pattern>
      </defs>
      {difficult.map((rect) => (
        <rect
          key={`${rect.x},${rect.y},${rect.width},${rect.height}`}
          className="terrain-difficult"
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          fill={`url(#${patternId})`}
        />
      ))}
    </g>
  );
}
