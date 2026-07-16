import { useEffect, useState, type CSSProperties } from "react";

export type MapImageState =
  | { status: "loading" }
  | { status: "ready"; url: string; width: number; height: number }
  | { status: "error"; message: string };

export function probeImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const probe = new Image();
    probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
    probe.onerror = () => reject(new Error("The map image couldn't be displayed."));
    probe.src = url;
  });
}

/**
 * Fetches an authorized map image as a revocable blob URL and probes its natural pixel
 * dimensions. Shared by every renderer that needs a bearer-authorized map (the encounter
 * canvas and the GM's map/viewer-tool previews). The shared-screen viewer does not use this —
 * it embeds the content URL directly (cookie-authorized, no bearer header available inside
 * an SVG `<image>`), but still uses `probeImageDimensions` for its own dimension probe.
 */
export function useAuthorizedMapImage(assetId: string | null, token: string | null | undefined): MapImageState {
  const [state, setState] = useState<MapImageState>({ status: "loading" });

  useEffect(() => {
    if (!assetId) { setState({ status: "loading" }); return; }
    if (!token) { setState({ status: "error", message: "Rejoin the table to load the battle map." }); return; }
    setState({ status: "loading" });
    const controller = new AbortController();
    let objectUrl: string | null = null;
    fetch(`/api/v1/map-assets/${encodeURIComponent(assetId)}/content`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 403 ? "You don't have access to this map." : "The battle map couldn't be loaded.");
        objectUrl = URL.createObjectURL(await response.blob());
        const dimensions = await probeImageDimensions(objectUrl);
        setState({ status: "ready", url: objectUrl, ...dimensions });
      })
      .catch((error) => { if (error.name !== "AbortError") setState({ status: "error", message: error.message }); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [assetId, token]);

  return state;
}

/**
 * Converts a pointer/mouse event's client coordinates into image-pixel coordinates using the
 * SVG element's own screen transform. This is robust to `preserveAspectRatio`, panning, and
 * zooming, unlike a manual `getBoundingClientRect` + linear-scale calculation (which silently
 * breaks the moment the image is letterboxed or a camera transform is introduced). Replaces the
 * three previously separate, hand-rolled pixel<->image conversions.
 */
export function imagePointFromClient(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } | null {
  const matrix = svg.getScreenCTM();
  if (!matrix) return null;
  const point = svg.createSVGPoint();
  point.x = clientX; point.y = clientY;
  const mapped = point.matrixTransform(matrix.inverse());
  return { x: Math.round(mapped.x * 100) / 100, y: Math.round(mapped.y * 100) / 100 };
}

export function clampPoint(point: { x: number; y: number }, width: number, height: number) {
  return { x: Math.max(0, Math.min(width, point.x)), y: Math.max(0, Math.min(height, point.y)) };
}

export function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export type TokenGlyphProps = Readonly<{
  sizePx: number;
  name: string;
  active?: boolean;
  turnClassName: string;
  bodyClassName: string;
  initialsClassName: string;
  nameClassName: string;
  nameY: number;
  initialsStyle?: CSSProperties;
  nameStyle?: CSSProperties;
}>;

/**
 * The visual content of a map token (turn ring, body, initials, name) shared by the interactive
 * encounter canvas and the read-only shared-screen viewer. Each caller supplies its own class
 * names/sizing and wraps this in whatever `<g>` (with its own interactivity, if any) it needs —
 * this component owns only the repeated drawing, not the per-app interaction semantics.
 */
export function TokenGlyph({ sizePx, name, active, turnClassName, bodyClassName, initialsClassName, nameClassName, nameY, initialsStyle, nameStyle }: TokenGlyphProps) {
  return <>
    {active && <circle className={turnClassName} r={sizePx * 0.64} />}
    <circle className={bodyClassName} r={sizePx / 2} />
    <text className={initialsClassName} style={initialsStyle}>{initialsOf(name)}</text>
    <text className={nameClassName} y={nameY} style={nameStyle}>{name}</text>
  </>;
}

export type OverlayLine = Readonly<{ axis: "column" | "row"; index: number; start: { x: number; y: number }; end: { x: number; y: number }; major: boolean }>;

/** Renders a set of calibration/grid overlay line segments. Shared so overlay styling stays one implementation. */
export function GridOverlay({ lines }: Readonly<{ lines: readonly OverlayLine[] }>) {
  return <>{lines.map((line) => <line key={`${line.axis}-${line.index}`} className={line.major ? "major" : ""} x1={line.start.x} y1={line.start.y} x2={line.end.x} y2={line.end.y} />)}</>;
}
