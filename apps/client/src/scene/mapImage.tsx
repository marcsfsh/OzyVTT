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

export type GridCalibration = Readonly<{ origin: { x: number; y: number }; cellSizePx: number; rotationRadians: number; distancePerCell: number }>;

/** Fetches the active map's grid calibration (or null on a gridless map) for client-side preview math. Not secret — the client already receives grid-derived token sizing. */
export function useMapCalibration(assetId: string | null, token: string | null | undefined): Readonly<{ status: "loading" | "ready" | "error"; calibration: GridCalibration | null }> {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; calibration: GridCalibration | null }>({ status: "loading", calibration: null });
  useEffect(() => {
    if (!assetId || !token) { setState({ status: "loading", calibration: null }); return; }
    setState({ status: "loading", calibration: null });
    const controller = new AbortController();
    fetch(`/api/v1/map-assets/${encodeURIComponent(assetId)}/grid`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("The grid could not be loaded.");
        const body = await response.json();
        setState({ status: "ready", calibration: body.data.calibration });
      })
      .catch((error) => { if (error.name !== "AbortError") setState({ status: "error", calibration: null }); });
    return () => controller.abort();
  }, [assetId, token]);
  return state;
}

/**
 * Preview-only grid math mirroring the server's authoritative snapping (`grid-calibration.ts`,
 * `map-measurement.ts`). Used only to show a live number/snap while the pointer is still moving —
 * the server always re-derives and persists the real geometry when a drag ends (`annotation:add`/
 * `annotation:move`), so any drift here affects only what's shown for a moment, never what's saved.
 */
export function imageToGridPreview(calibration: GridCalibration, point: { x: number; y: number }) {
  const dx = point.x - calibration.origin.x;
  const dy = point.y - calibration.origin.y;
  const cosine = Math.cos(calibration.rotationRadians);
  const sine = Math.sin(calibration.rotationRadians);
  return { column: (cosine * dx + sine * dy) / calibration.cellSizePx, row: (-sine * dx + cosine * dy) / calibration.cellSizePx };
}
export function gridToImagePreview(calibration: GridCalibration, point: { column: number; row: number }) {
  const localX = point.column * calibration.cellSizePx;
  const localY = point.row * calibration.cellSizePx;
  const cosine = Math.cos(calibration.rotationRadians);
  const sine = Math.sin(calibration.rotationRadians);
  return { x: calibration.origin.x + cosine * localX - sine * localY, y: calibration.origin.y + sine * localX + cosine * localY };
}
export function snapCellCenterPreview(calibration: GridCalibration, point: { x: number; y: number }) {
  const grid = imageToGridPreview(calibration, point);
  return gridToImagePreview(calibration, { column: Math.floor(grid.column) + 0.5, row: Math.floor(grid.row) + 0.5 });
}
/** Whole-cell Chebyshev distance in feet between two image points — every cell (including diagonals) costs one step, matching the server's default measurement rule. */
export function chebyshevFeetPreview(calibration: GridCalibration, a: { x: number; y: number }, b: { x: number; y: number }) {
  const gridA = imageToGridPreview(calibration, a);
  const gridB = imageToGridPreview(calibration, b);
  return Math.round(Math.max(Math.abs(gridB.column - gridA.column), Math.abs(gridB.row - gridA.row))) * calibration.distancePerCell;
}

export type SnappedGeometry = Readonly<{ origin: { x: number; y: number }; target: { x: number; y: number }; feet: number }>;

/**
 * Client mirrors of the server's `measurementGeometry`/`squareGeometry`/`radialGeometry`
 * (`apps/server/src/annotations.ts`) so the live drag preview snaps to the grid exactly as the saved
 * result will — the server still re-derives and persists the authoritative geometry on release.
 */
export function snapMeasurementPreview(calibration: GridCalibration, origin: { x: number; y: number }, target: { x: number; y: number }): SnappedGeometry {
  const from = snapCellCenterPreview(calibration, origin);
  const to = snapCellCenterPreview(calibration, target);
  return { origin: from, target: to, feet: chebyshevFeetPreview(calibration, from, to) };
}
export function snapShapePreview(calibration: GridCalibration, shape: "circle" | "cone" | "line" | "square", origin: { x: number; y: number }, target: { x: number; y: number }): SnappedGeometry {
  if (shape === "square") {
    const start = imageToGridPreview(calibration, origin);
    const raw = imageToGridPreview(calibration, target);
    const startSnapped = { column: Math.round(start.column), row: Math.round(start.row) };
    const side = Math.max(1, Math.round(Math.max(Math.abs(raw.column - start.column), Math.abs(raw.row - start.row))));
    const end = { column: startSnapped.column + (raw.column < start.column ? -1 : 1) * side, row: startSnapped.row + (raw.row < start.row ? -1 : 1) * side };
    return { origin: gridToImagePreview(calibration, startSnapped), target: gridToImagePreview(calibration, end), feet: side * calibration.distancePerCell };
  }
  // Cone/line: both ends snap to cell centers so the shape can point in any direction (free rotation).
  if (shape === "cone" || shape === "line") {
    const from = snapCellCenterPreview(calibration, origin);
    let to = snapCellCenterPreview(calibration, target);
    if (to.x === from.x && to.y === from.y) {
      const angle = Math.atan2(target.y - origin.y, target.x - origin.x) || 0;
      to = snapCellCenterPreview(calibration, { x: from.x + Math.cos(angle) * calibration.cellSizePx, y: from.y + Math.sin(angle) * calibration.cellSizePx });
    }
    const coneCells = Math.max(1, Math.round(Math.hypot(to.x - from.x, to.y - from.y) / calibration.cellSizePx));
    return { origin: from, target: to, feet: coneCells * calibration.distancePerCell };
  }
  // Circle: origin snaps to a cell center, radius snaps to whole cells.
  const snappedOrigin = snapCellCenterPreview(calibration, origin);
  const pixelDistance = Math.hypot(target.x - snappedOrigin.x, target.y - snappedOrigin.y);
  const cells = Math.max(1, Math.round(pixelDistance / calibration.cellSizePx));
  const sizePx = cells * calibration.cellSizePx;
  const angle = pixelDistance === 0 ? 0 : Math.atan2(target.y - snappedOrigin.y, target.x - snappedOrigin.x);
  return { origin: snappedOrigin, target: { x: snappedOrigin.x + Math.cos(angle) * sizePx, y: snappedOrigin.y + Math.sin(angle) * sizePx }, feet: cells * calibration.distancePerCell };
}

export type OverlayLine = Readonly<{ axis: "column" | "row"; index: number; start: { x: number; y: number }; end: { x: number; y: number }; major: boolean }>;

/** Renders a set of calibration/grid overlay line segments. Shared so overlay styling stays one implementation. */
export function GridOverlay({ lines }: Readonly<{ lines: readonly OverlayLine[] }>) {
  return <>{lines.map((line) => <line key={`${line.axis}-${line.index}`} className={line.major ? "major" : ""} x1={line.start.x} y1={line.start.y} x2={line.end.x} y2={line.end.y} />)}</>;
}
