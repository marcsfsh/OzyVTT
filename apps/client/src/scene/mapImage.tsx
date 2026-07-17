import { useEffect, useId, useState, type CSSProperties } from "react";

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
  /** Optional portrait; drawn clipped to the token circle. Missing or failed loads fall back to initials. */
  imageUrl?: string | null;
  turnClassName: string;
  bodyClassName: string;
  initialsClassName: string;
  nameClassName: string;
  nameY: number;
  initialsStyle?: CSSProperties;
  nameStyle?: CSSProperties;
}>;

/**
 * The visual content of a map token (turn ring, body, portrait-or-initials, name) shared by the
 * interactive encounter canvas and the read-only shared-screen viewer. Each caller supplies its own
 * class names/sizing and wraps this in whatever `<g>` (with its own interactivity, if any) it needs —
 * this component owns only the repeated drawing, not the per-app interaction semantics.
 */
export function TokenGlyph({ sizePx, name, active, imageUrl, turnClassName, bodyClassName, initialsClassName, nameClassName, nameY, initialsStyle, nameStyle }: TokenGlyphProps) {
  const clipId = useId();
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [imageUrl]);
  const radius = sizePx / 2;
  const showImage = imageUrl != null && imageUrl !== "" && !failed;
  return <>
    {active && <circle className={turnClassName} r={sizePx * 0.64} />}
    <circle className={bodyClassName} r={radius} />
    {showImage
      // The portrait fills the body circle (cover-cropped) with the body ring redrawn on top so the
      // border stays crisp; a broken/forbidden image falls back to the initials via onError.
      ? <>
          <clipPath id={clipId}><circle r={radius} /></clipPath>
          <image href={imageUrl ?? undefined} x={-radius} y={-radius} width={sizePx} height={sizePx} clipPath={`url(#${clipId})`} preserveAspectRatio="xMidYMid slice" onError={() => setFailed(true)} />
          <circle className={bodyClassName} r={radius} style={{ fill: "none" }} />
        </>
      : <text className={initialsClassName} style={initialsStyle}>{initialsOf(name)}</text>}
    <text className={nameClassName} y={nameY} style={nameStyle}>{name}</text>
  </>;
}

/**
 * Health/condition badges layered over a token: a bloodied/down dot at the top-right and up
 * to three condition initials beneath the body (with a +N overflow). Shared by the table
 * client and the viewer so both read the same at a glance.
 */
export function TokenStatusBadges({ sizePx, health, conditions }: Readonly<{ sizePx: number; health: "healthy" | "bloodied" | "down"; conditions: readonly string[] }>) {
  const radius = Math.max(4, sizePx * 0.11);
  const shown = conditions.slice(0, 3);
  const overflow = conditions.length - shown.length;
  const badgeY = sizePx * 0.5 + radius * 1.15;
  const startX = -((shown.length + (overflow > 0 ? 1 : 0)) - 1) * radius * 1.1;
  return <>
    {health !== "healthy" && <circle className={`token-health token-health-${health}`} cx={sizePx * 0.38} cy={-sizePx * 0.38} r={radius}>
      <title>{health === "down" ? "Down" : "Bloodied"}</title>
    </circle>}
    {shown.map((label, index) => <g key={label} className="token-condition" transform={`translate(${startX + index * radius * 2.2} ${badgeY})`}>
      <title>{conditions.join(", ")}</title>
      <circle r={radius} />
      <text style={{ fontSize: radius * 1.25 }}>{label[0]?.toUpperCase() ?? "?"}</text>
    </g>)}
    {overflow > 0 && <g className="token-condition token-condition-more" transform={`translate(${startX + shown.length * radius * 2.2} ${badgeY})`}>
      <title>{conditions.join(", ")}</title>
      <circle r={radius} />
      <text style={{ fontSize: radius * 1.1 }}>+{overflow}</text>
    </g>}
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
export function snapCellCenterPreview(calibration: GridCalibration, point: { x: number; y: number }, sizeCells = 1) {
  // Mirrors the server: odd footprints center on a cell, even ones on a grid intersection.
  const centerOffset = sizeCells % 2 === 0 ? 0 : 0.5;
  const grid = imageToGridPreview(calibration, point);
  return gridToImagePreview(calibration, { column: Math.floor(grid.column) + centerOffset, row: Math.floor(grid.row) + centerOffset });
}
/** Whole-cell Chebyshev distance in feet between two image points — every cell (including diagonals) costs one step, matching the server's default measurement rule. */
export function chebyshevFeetPreview(calibration: GridCalibration, a: { x: number; y: number }, b: { x: number; y: number }) {
  const gridA = imageToGridPreview(calibration, a);
  const gridB = imageToGridPreview(calibration, b);
  return Math.round(Math.max(Math.abs(gridB.column - gridA.column), Math.abs(gridB.row - gridA.row))) * calibration.distancePerCell;
}
/** The `"col,row"` grid cells a token's footprint covers, given its snapped image position and sizeCells (odd footprints center on a cell, even on an intersection — mirrors the server). Preview-only. */
export function footprintCells(calibration: GridCalibration, position: { x: number; y: number }, sizeCells = 1): Set<string> {
  const grid = imageToGridPreview(calibration, position);
  const odd = sizeCells % 2 === 1;
  const topLeftCol = odd ? Math.floor(grid.column) - (sizeCells - 1) / 2 : Math.round(grid.column) - sizeCells / 2;
  const topLeftRow = odd ? Math.floor(grid.row) - (sizeCells - 1) / 2 : Math.round(grid.row) - sizeCells / 2;
  const cells = new Set<string>();
  for (let column = 0; column < sizeCells; column++) for (let row = 0; row < sizeCells; row++) cells.add(`${topLeftCol + column},${topLeftRow + row}`);
  return cells;
}
/**
 * 5e movement-through-occupied-cells cost, display-only. Walks the whole-cell Chebyshev line from
 * origin to target; each intermediate cell (not the destination) that another token occupies adds one
 * cell of movement (+distancePerCell). Preview-only — the client only ever has the tokens it may see,
 * so nothing hidden leaks into the count.
 */
export function occupiedPathCost(calibration: GridCalibration, origin: { x: number; y: number }, target: { x: number; y: number }, occupied: ReadonlySet<string>): { baseFeet: number; penaltyFeet: number } {
  const from = imageToGridPreview(calibration, origin);
  const to = imageToGridPreview(calibration, target);
  let column = Math.floor(from.column), row = Math.floor(from.row);
  const destColumn = Math.floor(to.column), destRow = Math.floor(to.row);
  const steps = Math.max(Math.abs(destColumn - column), Math.abs(destRow - row));
  let penaltyCells = 0;
  for (let step = 0; step < steps; step++) {
    if (column !== destColumn) column += Math.sign(destColumn - column);
    if (row !== destRow) row += Math.sign(destRow - row);
    const atDestination = column === destColumn && row === destRow;
    if (!atDestination && occupied.has(`${column},${row}`)) penaltyCells++;
  }
  return { baseFeet: steps * calibration.distancePerCell, penaltyFeet: penaltyCells * calibration.distancePerCell };
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
