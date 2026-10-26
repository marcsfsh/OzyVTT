import { useId } from "react";

type Rect = Readonly<{ x: number; y: number; width: number; height: number }>;

/** Dynamic vision as the server sends it: where the audience sees now (flat `[x0, y0, x1, y1, ...]` polygons), where
 *  in that the light is bright (absent when it all is), what the party has seen (rects), and the creatures one of a
 *  player's characters senses without seeing (Divine Sense). */
export type VisionMask = Readonly<{
  visible: readonly (readonly number[])[];
  bright?: readonly (readonly number[])[];
  explored: readonly Rect[];
  sensed?: readonly Readonly<{ x: number; y: number; creatureType: string; sense?: string }>[];
}>;

const points = (polygon: readonly number[]) => {
  const pairs: string[] = [];
  for (let index = 0; index + 1 < polygon.length; index += 2) pairs.push(`${polygon[index]},${polygon[index + 1]}`);
  return pairs.join(" ");
};

/**
 * The map's cover, as SVG masks. Manual fog: a white base (fog everywhere) with each stroke in order painting black
 * (reveal) or white (hide). Dynamic vision: dark everywhere, the party's remembered ground half dark, and what is in
 * sight now clear; the server drew the polygons, so this only paints them. The GM sees the cover dimmed; players and
 * the shared screen get it solid, so the part of a token under it is covered (the server leaves out tokens wholly under
 * the fog or out of sight).
 */
export function FogOverlay({
  width,
  height,
  fog,
  vision,
  variant,
  markRadius = 18
}: Readonly<{
  width: number;
  height: number;
  fog?: Readonly<{
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
  vision?: VisionMask | null;
  variant: "gm" | "player";
  /** How big a sensed creature's mark is drawn, in map pixels (about a third of a cell). */
  markRadius?: number;
}>) {
  const base = useId();
  // Chromium caches an SVG <mask>'s raster and does not re-evaluate it when only its children change (stale holes
  // remain until a repaint). Suffixing the mask id with a hash of the geometry makes any change a new url().
  const fogSignature = fog
    ? `${fog.shapes.length}-${fog.shapes.map((shape) => `${shape.op[0]}${Math.round(shape.x)}.${Math.round(shape.y)}.${Math.round(shape.width)}.${Math.round(shape.height)}`).join("_")}`
    : "";
  const fogMask = `${base}f${fogSignature}`;
  const visionMask = `${base}v${vision ? signatureOf(vision) : ""}`;
  return (
    <>
      {fog?.enabled && (
        <>
          <defs>
            <mask id={fogMask}>
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
            mask={`url(#${fogMask})`}
            pointerEvents="none"
          />
        </>
      )}
      {vision && (
        <>
          <defs>
            <mask id={visionMask}>
              <rect x={0} y={0} width={width} height={height} fill="white" />
              {/* Remembered ground: the cover at about half strength. */}
              {vision.explored.map((rect, index) => (
                <rect key={index} x={rect.x} y={rect.y} width={rect.width} height={rect.height} fill="#6e6e6e" />
              ))}
              {/* In sight now. The thin stroke closes the hairline seams between neighbouring pieces. Where the
                  server marks bright light, the rest of what is in sight keeps a light shade: Dim Light. */}
              {vision.visible.map((polygon, index) => (
                <polygon
                  key={index}
                  points={points(polygon)}
                  fill={vision.bright ? DIM_SHADE : "black"}
                  stroke={vision.bright ? DIM_SHADE : "black"}
                  strokeWidth={1.5}
                />
              ))}
              {vision.bright?.map((polygon, index) => (
                <polygon key={`b${index}`} points={points(polygon)} fill="black" stroke="black" strokeWidth={1.5} />
              ))}
            </mask>
          </defs>
          <rect
            className={`vision-overlay vision-overlay-${variant}`}
            x={0}
            y={0}
            width={width}
            height={height}
            mask={`url(#${visionMask})`}
            pointerEvents="none"
          />
          {vision.sensed?.map((creature, index) => (
            <g key={index} className="vision-sensed" pointerEvents="none">
              <title>
                {creature.sense
                  ? `You sense ${creature.sense} here`
                  : `You sense ${article(creature.creatureType)} here`}
              </title>
              <circle cx={creature.x} cy={creature.y} r={markRadius} />
              <text x={creature.x} y={creature.y + markRadius * 1.7} textAnchor="middle" fontSize={markRadius * 0.7}>
                {creature.sense ? titled(creature.sense) : titled(creature.creatureType)}
              </text>
            </g>
          ))}
        </>
      )}
    </>
  );
}

/** The mask's grey for what is in sight in Dim Light: a light shade over the map, well short of the remembered ground. */
const DIM_SHADE = "#2a2a2a";

/** "an Undead", "a Fiend": the creature type with its article. */
const article = (type: string) => `${/^[aeiou]/.test(type) ? "an" : "a"} ${titled(type)}`;
const titled = (type: string) => type.slice(0, 1).toUpperCase() + type.slice(1);

/** A short fingerprint of the mask's geometry (see the Chromium note above). */
function signatureOf(vision: VisionMask): string {
  let hash = 0x811c9dc5;
  const add = (value: number) => {
    hash = Math.imul(hash ^ Math.round(value * 10), 0x01000193) >>> 0;
  };
  for (const polygon of vision.visible) {
    add(polygon.length);
    for (const value of polygon) add(value);
  }
  for (const polygon of vision.bright ?? []) {
    add(polygon.length);
    for (const value of polygon) add(value);
  }
  for (const rect of vision.explored) {
    add(rect.x);
    add(rect.y);
    add(rect.width);
    add(rect.height);
  }
  return `${vision.visible.length}-${vision.explored.length}-${hash.toString(36)}`;
}
