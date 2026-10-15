import { useId } from "react";

/**
 * Manual fog-of-war mask: one SVG `<mask>` with a white base (fog everywhere); each stroke in order
 * paints black (reveal) or white (hide). The GM sees fog dimmed below tokens; players and the shared
 * screen get it solid above everything, so anything inside fog is covered even where public data
 * crossed the wire.
 */
export function FogOverlay({
  width,
  height,
  fog,
  variant
}: Readonly<{
  width: number;
  height: number;
  fog: Readonly<{
    enabled: boolean;
    shapes: readonly Readonly<{
      id: string;
      op: "reveal" | "hide";
      x: number;
      y: number;
      width: number;
      height: number;
    }>[];
  }>;
  variant: "gm" | "player";
}>) {
  const base = useId();
  if (!fog.enabled) return null;
  // Chromium caches an SVG <mask>'s raster and does not re-evaluate it when only its child <rect>s
  // change (stale holes remain after Hide all until a repaint). Suffixing the mask id with a hash of the
  // fog makes any change a new url() reference, forcing a re-resolve.
  const signature = `${fog.shapes.length}-${fog.shapes.map((shape) => `${shape.op[0]}${Math.round(shape.x)}.${Math.round(shape.y)}.${Math.round(shape.width)}.${Math.round(shape.height)}`).join("_")}`;
  const maskId = `${base}${signature}`;
  return (
    <>
      <defs>
        <mask id={maskId}>
          <rect x={0} y={0} width={width} height={height} fill="white" />
          {fog.shapes.map((shape) => (
            <rect
              key={shape.id}
              x={shape.x}
              y={shape.y}
              width={shape.width}
              height={shape.height}
              fill={shape.op === "reveal" ? "black" : "white"}
            />
          ))}
        </mask>
      </defs>
      <rect
        className={`fog-overlay fog-overlay-${variant}`}
        x={0}
        y={0}
        width={width}
        height={height}
        mask={`url(#${maskId})`}
        pointerEvents="none"
      />
    </>
  );
}
