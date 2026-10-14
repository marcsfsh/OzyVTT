import { useEffect, useRef, useState } from "react";
import { Button, Chip, ChoiceGrid, Eyebrow, IconChevronLeft, IconPlus, Input, SegmentedControl, Select, Steps, useToast } from "@vtt/ui";
import { clampPoint, GridOverlay, imagePointFromClient, type OverlayLine } from "../scene/mapImage";
import { MapTile } from "./MapPicker";
import "./map-manager.css";
import { usePrompt } from "../components/feedback";

type Point = { x: number; y: number };
type MapKind = "battlemap" | "regional" | "world";
type MapAsset = Readonly<{
  id: string;
  name: string;
  kind: MapKind;
  folder: string | null;
  originalName: string;
  format: string;
  mediaType: string;
  width: number;
  height: number;
  byteLength: number;
  importedAt: string;
  calibration: Readonly<{ calibration: Readonly<{ origin: Point; cellSizePx: number; rotationRadians: number; distancePerCell: number }>; verificationErrorPx: number }> | null;
  scale: Readonly<{ kind: "image-scale"; distancePerPixel: number; unit: string }> | null;
}>;
/** What this component reads from the server's wizard state. No `step`: the UI step index is
    derived locally (see the step index below), never from the server's step name. */
type WizardState = Readonly<{
  calibration: Readonly<{ origin: Point; cellSizePx: number; rotationRadians: number; distancePerCell: number }>;
  verification: Readonly<{ errorPx: number; tolerancePx: number; accepted: boolean }> | null;
}>;
export type MapSelection = Readonly<{
  id: string;
  name: string;
  kind: MapKind;
  width: number;
  height: number;
  calibration: MapAsset["calibration"];
  scale: MapAsset["scale"];
  previewUrl?: string;
}>;

/** Carries the HTTP status so the one recoverable failure, a calibration wizard that outlived the
    server's 30-minute in-memory TTL (`map-http.ts` WIZARD_TTL_MS, a 404), can be told apart from
    other errors (see `expired`). */
class MapApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "MapApiError";
  }
}

async function api(path: string, gmToken: string, init: RequestInit = {}) {
  const response = await fetch(path, { ...init, headers: { authorization: `Bearer ${gmToken}`, ...init.headers } });
  const body = await response.json();
  if (!response.ok) throw new MapApiError(body.error?.message ?? body.message ?? "Map request failed.", response.status);
  return body.data;
}

/**
 * Snaps a drag point to an axis-aligned square from the start corner: side = the larger delta, sign
 * follows the drag, clamped inside the map. The square is a client preview constraint:
 * `deriveSquareGridFromArea` (`grid-calibration.ts`) accepts a rectangle and averages its axes, so
 * forcing a square shows the GM the same shape the server will measure.
 */
function squareCorner(start: Point, raw: Point, width: number, height: number): Point {
  const signX = raw.x < start.x ? -1 : 1;
  const signY = raw.y < start.y ? -1 : 1;
  const maxX = signX > 0 ? width - start.x : start.x;
  const maxY = signY > 0 ? height - start.y : start.y;
  const side = Math.min(Math.max(Math.abs(raw.x - start.x), Math.abs(raw.y - start.y)), maxX, maxY);
  return { x: start.x + signX * side, y: start.y + signY * side };
}

function GridAreaPreview({ start, end, handle }: Readonly<{ start: Point; end: Point; handle?: boolean }>) {
  const x0 = Math.min(start.x, end.x);
  const y0 = Math.min(start.y, end.y);
  const size = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
  return <g className="grid-area-preview">
    <rect x={x0} y={y0} width={size} height={size} />
    {[1, 2].flatMap((third) => [
      <line key={`v${third}`} x1={x0 + (size * third) / 3} y1={y0} x2={x0 + (size * third) / 3} y2={y0 + size} />,
      <line key={`h${third}`} x1={x0} y1={y0 + (size * third) / 3} x2={x0 + size} y2={y0 + (size * third) / 3} />
    ])}
    {handle && <circle className="grid-area-handle" cx={end.x} cy={end.y} r={Math.max(6, size / 24)} />}
  </g>;
}

/** Crosshair colours for two full-map guide lines that follow the point being placed, for lining up corners against printed grid art. */
const CROSSHAIR_PRESETS: ReadonlyArray<{ color: string; label: string }> = [
  { color: "#2de2ff", label: "Cyan" }, { color: "#ff2e9a", label: "Magenta" }, { color: "#a45cff", label: "Violet" }, { color: "#ff2d5e", label: "Rose" }, { color: "#ffffff", label: "White" }
];
function CrosshairOverlay({ points, width, height, color, opacity, dash }: Readonly<{ points: readonly Point[]; width: number; height: number; color: string; opacity: number; dash: string }>) {
  return <g className="grid-crosshair" aria-hidden="true" style={{ stroke: color, opacity, strokeDasharray: dash }}>
    {points.map((point, index) => <g key={index}>
      <line x1={0} y1={point.y} x2={width} y2={point.y} />
      <line x1={point.x} y1={0} x2={point.x} y2={height} />
    </g>)}
  </g>;
}

/**
 * The maps library and grid calibration, as a frame: `back · heading · upload row` above a body
 * with a rail of maps beside a four-step calibration pane (mode, canvas, fields, verify). The canvas
 * is mounted once, flex-fills the pane, is never inside a step panel and never unmounted, so it
 * keeps real height in every step; `.map-step-body` is bounded so it cannot squeeze the canvas out.
 *
 * The UI's four steps are not the server's (`grid-calibration-wizard.ts`: measure -> refine ->
 * verify -> complete). The UI step is `Math.min(rawStep, maxStep)` from local state only:
 *   UI 0 (mode)   - no server state yet.
 *   UI 1 (canvas) - ends with `POST .../calibration/wizards`, which jumps the server to refine.
 *   UI 2 (fields) - `POST .../actions {adjust|undo|redo}`; the server stays at refine.
 *   UI 3 (verify) - `POST .../actions {verify}` then `.../complete`.
 * The server computes every number (cell size, origin, rotation locked at 0, overlay lines,
 * `calibrationErrorPx`).
 *
 * `squareCorner` and `imagePointFromClient` are preview-only. `distancePerPixel` copies the server's
 * `deriveMapDistanceScale` (`map-measurement.ts`), including its refusals, so the review step can
 * show what the save will produce; `saveScale` still sends raw inputs and the server decides.
 *
 * Mode depends on the map kind: a battle map is either a printed square grid (the wizard) or
 * gridless distance (`PUT .../scale`); regional and world maps only have the scale path. The scale
 * path never calls the wizard, so its fourth step is a review, not a verification.
 */
export function MapManager({ gmToken, preferredMapId, onSelectionChange, onBack }: Readonly<{
  gmToken: string;
  preferredMapId?: string | null;
  onSelectionChange?: (map: MapSelection | null) => void;
  /** The frame's back row; the shell passes the door in. */
  onBack?: () => void;
}>) {
  const [maps, setMaps] = useState<readonly MapAsset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<MapKind>("battlemap");
  const [uploadFolder, setUploadFolder] = useState("");
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | MapKind>("all");
  const [folderChip, setFolderChip] = useState<"all" | string | null>("all");
  const [points, setPoints] = useState<Point[]>([]);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragCurrent, setDragCurrent] = useState<Point | null>(null);
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);
  const [pendingArea, setPendingArea] = useState<{ start: Point; end: Point } | null>(null);
  const [areaAction, setAreaAction] = useState<"move" | "resize" | null>(null);
  const [moveGrab, setMoveGrab] = useState<Point | null>(null);
  const [crosshairColor, setCrosshairColor] = useState("#2de2ff");
  const [crosshairOpacity, setCrosshairOpacity] = useState(0.8);
  const [crosshairStyle, setCrosshairStyle] = useState<"dashed" | "dotted" | "solid">("dashed");
  const [previewCamera, setPreviewCamera] = useState<{ center: Point; zoom: number } | null>(null);
  const [lastArea, setLastArea] = useState<{ start: Point; end: Point } | null>(null);
  const [battlemapMode, setBattlemapMode] = useState<"square" | "gridless">("square");
  const [distancePerCell] = useState(5);
  const [wizardId, setWizardId] = useState<string | null>(null);
  const [wizard, setWizard] = useState<WizardState | null>(null);
  const [overlay, setOverlay] = useState<readonly OverlayLine[]>([]);
  const [knownDistance, setKnownDistance] = useState(50);
  const [unit, setUnit] = useState("miles");
  const [busy, setBusy] = useState(false);
  /** The position in the four-step UI flow, clamped by `maxStep` below. */
  const [rawStep, setRawStep] = useState(0);
  /** The wizard's 30-minute TTL ran out: an explicit, recoverable state with one way back, rather
      than a silent re-measure that would discard the GM's placement. */
  const [expired, setExpired] = useState(false);
  /** Below 850px the rail and the pane share one column, so one of them is showing. Separate from
      `selectedId`: "All maps" must not deselect the map the shell is using. */
  const [narrowView, setNarrowView] = useState<"rail" | "pane">("rail");
  const { prompt, dialog } = usePrompt();
  const { toast } = useToast();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const selected = maps.find((map) => map.id === selectedId) ?? null;
  const squareMode = selected?.kind === "battlemap" && battlemapMode === "square";
  const folderNames = Array.from(new Set(maps.map((map) => map.folder).filter((folder): folder is string => folder !== null))).sort((a, b) => a.localeCompare(b));
  const needle = search.trim().toLowerCase();
  // Folders are a chip row up front. `undefined` = All; `null` = Unfiled.
  const folderFilter = folderChip === "all" ? undefined : folderChip;
  const filteredMaps = maps.filter((map) =>
    (kindFilter === "all" || map.kind === kindFilter)
    && (needle === "" || map.name.toLowerCase().includes(needle))
    && (folderFilter === undefined || map.folder === folderFilter));

  const refresh = async (preferId?: string) => {
    const data = await api("/api/v1/map-assets", gmToken);
    setMaps(data.assets);
    setSelectedId((current) => preferId ?? (current && data.assets.some((map: MapAsset) => map.id === current) ? current : data.assets[0]?.id ?? null));
  };
  useEffect(() => { void refresh().catch((error) => toast(error.message, { tone: "error" })); }, [gmToken]);
  /** The combat's map is the opening selection only. The effect also runs on `maps` (the id arrives
      before the list), so each id is asserted once; otherwise every `refresh()` would yank the GM back
      to the combat's map. */
  const assertedPreferredId = useRef<string | null>(null);
  useEffect(() => {
    if (!preferredMapId || assertedPreferredId.current === preferredMapId) return;
    if (!maps.some((map) => map.id === preferredMapId)) return;
    assertedPreferredId.current = preferredMapId;
    setSelectedId(preferredMapId);
  }, [preferredMapId, maps]);
  useEffect(() => {
    setPoints([]); setDragStart(null); setDragCurrent(null); setWizardId(null); setWizard(null); setOverlay([]); setPreviewCamera(null); setLastArea(null); setPendingArea(null); setExpired(false); setRawStep(0);
    if (!selected) { setPreviewUrl(null); return; }
    // A map that already has a scale and no calibration opens on the gridless answer.
    setBattlemapMode(selected.scale && !selected.calibration ? "gridless" : "square");
    setUnit(selected.scale?.unit ?? (selected.kind === "battlemap" ? "feet" : "miles"));
    const controller = new AbortController(); let url: string | null = null;
    fetch(`/api/v1/map-assets/${selected.id}/content`, { headers: { authorization: `Bearer ${gmToken}` }, signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error("Could not load map preview."); url = URL.createObjectURL(await response.blob()); setPreviewUrl(url); })
      .catch((error) => { if (error.name !== "AbortError") toast(error.message, { tone: "error" }); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [selectedId, gmToken]);
  useEffect(() => {
    if (!onSelectionChange) return;
    onSelectionChange(selected ? {
      id: selected.id,
      name: selected.name,
      kind: selected.kind,
      width: selected.width,
      height: selected.height,
      calibration: selected.calibration,
      scale: selected.scale,
      ...(previewUrl ? { previewUrl } : {})
    } : null);
  }, [selected, previewUrl, onSelectionChange]);

  /** Errors go to a toast; a 404 on a wizard call means the session expired, and `onNotFound` owns that. */
  const run = async (operation: () => Promise<void>, onNotFound?: () => void) => {
    setBusy(true);
    try { await operation(); }
    catch (error) {
      if (onNotFound && error instanceof MapApiError && error.status === 404) onNotFound();
      else toast((error as Error).message, { tone: "error" });
    }
    finally { setBusy(false); }
  };
  const wizardExpired = () => { setWizardId(null); setWizard(null); setOverlay([]); setExpired(true); setRawStep(1); };
  const runWizard = (operation: () => Promise<void>) => run(operation, wizardExpired);
  const upload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return toast("Choose an image first.", { tone: "error" });
    await run(async () => {
      const query = new URLSearchParams({ filename: file.name, name: name || file.name.replace(/\.[^.]+$/, ""), kind });
      if (uploadFolder.trim()) query.set("folder", uploadFolder.trim());
      const data = await api(`/api/v1/map-assets?${query}`, gmToken, { method: "POST", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
      setFile(null); setName("");
      if (uploadInputRef.current) uploadInputRef.current.value = "";
      await refresh(data.asset.id);
      setNarrowView("pane");
      toast(data.duplicate ? "That image was already uploaded; the existing map is selected." : "Map uploaded — set its grid below.", { tone: "success" });
    });
  };
  const moveToFolder = (folder: string | null) => run(async () => {
    if (!selected) return;
    await api(`/api/v1/map-assets/${selected.id}`, gmToken, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ folder }) });
    await refresh(selected.id);
    toast(folder ? `Moved to “${folder}”.` : "Removed from its folder.", { tone: "success" });
  });
  const pointAt = (clientX: number, clientY: number) => {
    if (!selected || !svgRef.current) return null;
    const point = imagePointFromClient(svgRef.current, clientX, clientY);
    return point ? clampPoint(point, selected.width, selected.height) : null;
  };
  // Zoom on the calibration preview to place the 3×3 box precisely. Zooms at the given client point,
  // never out past the full map. Camera only: the server still owns every measurement.
  const zoomPreviewAt = (clientX: number, clientY: number, factor: number) => {
    const svg = svgRef.current; if (!svg || !selected) return;
    const rect = svg.getBoundingClientRect();
    const fx = (clientX - rect.left) / rect.width, fy = (clientY - rect.top) / rect.height;
    const cam = previewCamera ?? { center: { x: selected.width / 2, y: selected.height / 2 }, zoom: 1 };
    const w = selected.width / cam.zoom, h = selected.height / cam.zoom;
    const imageX = cam.center.x - w / 2 + fx * w, imageY = cam.center.y - h / 2 + fy * h;
    const nextZoom = Math.max(1, Math.min(8, cam.zoom * factor));
    if (nextZoom <= 1) { setPreviewCamera(null); return; }
    const w2 = selected.width / nextZoom, h2 = selected.height / nextZoom;
    const cx = Math.min(Math.max(imageX + w2 * (0.5 - fx), w2 / 2), selected.width - w2 / 2);
    const cy = Math.min(Math.max(imageY + h2 * (0.5 - fy), h2 / 2), selected.height - h2 / 2);
    setPreviewCamera({ center: { x: cx, y: cy }, zoom: nextZoom });
  };
  /** Button zoom for touch devices (wheel zoom is mouse-only). Zooms at the canvas centre; not a pinch
      gesture, which would compete with the 3×3 drag. */
  const zoomFromCentre = (factor: number) => {
    const svg = svgRef.current; if (!svg) return;
    const rect = svg.getBoundingClientRect();
    zoomPreviewAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  };
  useEffect(() => {
    const el = previewRef.current; if (!el) return;
    const onWheel = (event: WheelEvent) => { if (!svgRef.current || !selected) return; event.preventDefault(); zoomPreviewAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.15 : 1 / 1.15); };
    // React's onWheel is passive, so preventDefault would be ignored; this must stay a manual,
    // non-passive listener.
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, previewCamera]);
  const restartCalibration = () => { setPoints([]); setDragStart(null); setDragCurrent(null); setHoverPoint(null); setPendingArea(null); setAreaAction(null); setMoveGrab(null); setWizardId(null); setWizard(null); setOverlay([]); setExpired(false); };
  // "Redo drag" restores the just-placed 3×3 box so the GM can nudge it and re-measure.
  const reopenArea = () => {
    const area = lastArea ?? (points.length >= 2 ? { start: points[0], end: points[1] } : null);
    setExpired(false); setRawStep(1);
    if (!area) { restartCalibration(); return; }
    setPendingArea(area); setPoints([area.start, area.end]);
    setWizard(null); setWizardId(null); setOverlay([]);
  };
  const choosePoint = (event: React.MouseEvent<HTMLDivElement>) => {
    const point = pointAt(event.clientX, event.clientY);
    if (!point) return;
    setPoints((current) => {
      if (wizard?.verification?.accepted) return current;
      if (wizard) return [...current.slice(0, 2), point];
      if (current.length === 0) return [point];
      if (current.length === 1) return [current[0], point];
      return current;
    });
  };
  const beginGridArea = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!selected || selected.kind !== "battlemap" || battlemapMode !== "square" || wizard || busy) return;
    const point = pointAt(event.clientX, event.clientY); if (!point) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    if (pendingArea) {
      const handleRadius = Math.max(10, Math.min(selected.width, selected.height) / 30);
      const nearCorner = Math.hypot(point.x - pendingArea.end.x, point.y - pendingArea.end.y) <= handleRadius;
      if (nearCorner) { setAreaAction("resize"); return; }
      setAreaAction("move"); setMoveGrab({ x: point.x - pendingArea.start.x, y: point.y - pendingArea.start.y });
      return;
    }
    setPoints([]); setDragStart(point); setDragCurrent(point);
  };
  const moveGridArea = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!selected) return;
    const point = pointAt(event.clientX, event.clientY); if (!point) return;
    if (dragStart && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.preventDefault(); setDragCurrent(squareCorner(dragStart, point, selected.width, selected.height));
      return;
    }
    if (pendingArea && areaAction === "resize" && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.preventDefault();
      setPendingArea((current) => current && { start: current.start, end: squareCorner(current.start, point, selected.width, selected.height) });
      return;
    }
    if (pendingArea && areaAction === "move" && moveGrab && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.preventDefault();
      setPendingArea((current) => {
        if (!current) return current;
        const sideX = current.end.x - current.start.x;
        const sideY = current.end.y - current.start.y;
        const size = Math.abs(sideX);
        const minX = sideX >= 0 ? 0 : size;
        const maxX = sideX >= 0 ? selected.width - size : selected.width;
        const minY = sideY >= 0 ? 0 : size;
        const maxY = sideY >= 0 ? selected.height - size : selected.height;
        const startX = Math.min(Math.max(point.x - moveGrab.x, minX), maxX);
        const startY = Math.min(Math.max(point.y - moveGrab.y, minY), maxY);
        return { start: { x: startX, y: startY }, end: { x: startX + sideX, y: startY + sideY } };
      });
      return;
    }
    if (!dragStart && !pendingArea && squareMode && !wizard) setHoverPoint(point);
  };
  const finishGridArea = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (dragStart && selected) {
      const point = pointAt(event.clientX, event.clientY);
      const start = dragStart;
      const end = point ? squareCorner(start, point, selected.width, selected.height) : (dragCurrent ?? start);
      setDragStart(null); setDragCurrent(null);
      // A tap is not a drag: `beginGridArea` seeds `dragCurrent = dragStart`, and the server refuses a
      // zero-width or zero-height box (`grid-calibration.ts`). So a zero-side release leaves the step as
      // it was; the server judges everything else.
      if (end.x === start.x || end.y === start.y) return;
      setPendingArea({ start, end }); setPoints([start, end]);
      return;
    }
    if (areaAction) {
      if (pendingArea) setPoints([pendingArea.start, pendingArea.end]);
      setAreaAction(null); setMoveGrab(null);
    }
  };
  const cancelGridArea = () => { setDragStart(null); setDragCurrent(null); setAreaAction(null); setMoveGrab(null); };
  const confirmPendingArea = () => { if (pendingArea) void startAreaWizard(pendingArea.start, pendingArea.end); };
  const updatePoint = (index: number, coordinate: "x" | "y", value: number) => setPoints((current) => {
    const next = [...current];
    while (next.length <= index) next.push({ x: 0, y: 0 });
    next[index] = { ...next[index], [coordinate]: Number.isFinite(value) ? value : 0 };
    return next;
  });
  const acceptWizardData = (data: any) => { setWizardId(data.wizardId); setWizard(data.state); setOverlay(data.overlay ?? []); setPendingArea(null); setExpired(false); if (data.overlayWarning) toast(data.overlayWarning, { tone: "info" }); };
  const startAreaWizard = (start: Point, end: Point) => run(async () => {
    if (!selected) throw new Error("Select a battle map first.");
    setLastArea({ start, end });
    const data = await api(`/api/v1/map-assets/${selected.id}/calibration/wizards`, gmToken, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ start, end, cellsAcross: 3, cellsDown: 3, distancePerCell }) });
    acceptWizardData(data);
    // The server jumps measure -> refine in this one call: the UI's canvas -> fields.
    setRawStep(2);
  });
  const wizardAction = (action: Record<string, unknown>) => runWizard(async () => {
    if (!selected || !wizardId) throw new Error("Start grid calibration first.");
    acceptWizardData(await api(`/api/v1/map-assets/${selected.id}/calibration/wizards/${wizardId}/actions`, gmToken, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action) }));
  });
  /** A finished calibration lands back on the library with the map still selected and a toast; the
      pane resets to the mode step, the honest start for calibrating it again. */
  const finished = (message: string) => { restartCalibration(); setPoints([]); setRawStep(0); setNarrowView("rail"); toast(message, { tone: "success" }); };
  const completeWizard = () => runWizard(async () => {
    if (!selected || !wizardId) throw new Error("Start grid calibration first.");
    await api(`/api/v1/map-assets/${selected.id}/calibration/wizards/${wizardId}/complete`, gmToken, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    await refresh(selected.id);
    finished("Grid calibration saved.");
  });
  const saveScale = () => run(async () => {
    if (!selected || points.length < 2) throw new Error("Choose two points with a known real-world distance.");
    await api(`/api/v1/map-assets/${selected.id}/scale`, gmToken, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ start: points[0], end: points[1], knownDistance, unit }) });
    await refresh(selected.id);
    finished("Map scale saved.");
  });

  // The step index, from local UI state only. `maxStep` is the furthest the flow accepts: past the
  // canvas step needs a measurement, which for the square path means the server has one.
  const canAdvancePastCanvas = squareMode ? wizard !== null : points.length >= 2;
  const maxStep = canAdvancePastCanvas ? 3 : 1;
  const step = Math.min(rawStep, maxStep);
  /** The rail's jump goes through the same reconciliation as "Redo drag": a live wizard makes the
      canvas step inert (`beginGridArea` returns early, no crosshair, no `pendingArea`), so jumping
      back to it must restore the placed area and clear the wizard (`reopenArea`). */
  const goToStep = (index: number) => {
    if (index === 1 && squareMode && wizard) { reopenArea(); return; }
    setRawStep(index);
  };
  // The verify step is the "check a distant point" mode.
  const verifying = squareMode && step === 3 && wizard !== null;
  const showPoints = !wizard || verifying;
  const stepItems = [
    { label: "Calibration type", shortLabel: "Type" },
    { label: squareMode ? "Mark a 3 × 3 block" : "Mark two points", shortLabel: "Mark" },
    { label: squareMode ? "Fine-tune" : "Known distance", shortLabel: squareMode ? "Tune" : "Distance" },
    { label: squareMode ? "Verify & confirm" : "Review & save", shortLabel: squareMode ? "Verify" : "Review" }
  ];
  const instruction = expired
    ? "This calibration session expired — the server keeps a measurement for 30 minutes."
    : step === 0
      ? (selected?.kind === "battlemap"
        ? "Does this map have a printed grid to line up against, or should distance come from two known points?"
        : "A regional or world map is calibrated by real-world scale: measure a span whose length you already know.")
    : step === 1
      ? (squareMode
        ? (pendingArea
          ? "Drag inside the square to move it, or its corner to resize it. Measure it when it lines up with the printed grid."
          : "Press on a grid intersection, drag diagonally across a 3 × 3 block of squares, and release on the opposite intersection.")
        : `${points.length < 2 ? `Click ${points.length ? "the ending" : "a starting"} point on the map` : "Both points are placed"}. Choose two locations whose real-world distance you know.`)
    : step === 2
      ? (squareMode
        ? "Nudge the blue overlay until it sits on the printed grid. Squares are 5 ft each, the D&D 5e default."
        : "Enter the real-world distance between point A and point C.")
      : (squareMode
        ? "Optional: click a distant intersection, then verify it. A miss never blocks Confirm."
        : "Check what will be saved, then save it.");
  // While dragging or resizing, the crosshair tracks the moving corner; once placed, both corners get
  // one so either edge can be lined up against the printed grid.
  const crosshairPoints: readonly Point[] = squareMode && !wizard
    ? (dragStart && dragCurrent ? [dragCurrent]
      : pendingArea ? (areaAction === "resize" ? [pendingArea.end] : areaAction === "move" ? [] : [pendingArea.start, pendingArea.end])
      : hoverPoint ? [hoverPoint] : [])
    : [];
  const previewViewBox = selected
    ? (previewCamera
      ? `${previewCamera.center.x - selected.width / previewCamera.zoom / 2} ${previewCamera.center.y - selected.height / previewCamera.zoom / 2} ${selected.width / previewCamera.zoom} ${selected.height / previewCamera.zoom}`
      : `0 0 ${selected.width} ${selected.height}`)
    : "0 0 1 1";
  /** The review step's derived scale, mirroring `deriveMapDistanceScale` (`map-measurement.ts`):
      `knownDistance / hypot(end - start)`, with the same refusals (`positiveFinite` on the span and
      the distance), so it never shows a scale the save would be rejected for. */
  const scaleSpanPx = points.length >= 2 ? Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) : 0;
  const distancePerPixel = scaleSpanPx > 0 && Number.isFinite(scaleSpanPx) && knownDistance > 0
    ? knownDistance / scaleSpanPx
    : null;

  const modeOptions = selected?.kind === "battlemap"
    ? [
      { value: "square", title: "Printed square grid", description: "Drag over a 3 × 3 block of printed squares; the server measures the grid from it." },
      { value: "gridless", title: "Gridless battle map", description: "No overlay — distance comes from two points whose real-world span you know." }
    ]
    : [{ value: "gridless", title: "Real-world scale", description: `Measure a known span so markers and rulers can use ${selected?.kind === "world" ? "world" : "regional"} distances.` }];

  /** One primary per step, and the secondary that belongs beside it. */
  const actions = (() => {
    if (expired) return { primary: <Button variant="primary" onClick={reopenArea}>Back to the drag</Button>, secondary: null };
    if (step === 0) return { primary: <Button variant="primary" onClick={() => setRawStep(1)}>Continue</Button>, secondary: null };
    // Below 760px `Steps` has no jumpable rail, so this secondary is the only way back to the mode
    // step: clear what you placed, then change the type.
    if (step === 1) {
      const placed = squareMode ? pendingArea !== null : points.length > 0;
      const back = placed
        ? <Button variant="secondary" disabled={busy} onClick={() => { restartCalibration(); setPoints([]); }}>{squareMode ? "Start over" : "Clear points"}</Button>
        : <Button variant="secondary" disabled={busy} onClick={() => setRawStep(0)}>Change type</Button>;
      return squareMode
        ? { primary: <Button variant="primary" disabled={busy || !pendingArea} onClick={confirmPendingArea}>Measure this area</Button>, secondary: back }
        : { primary: <Button variant="primary" disabled={busy || points.length < 2} onClick={() => setRawStep(2)}>Use these points</Button>, secondary: back };
    }
    if (step === 2) return squareMode
      ? {
        primary: <Button variant="primary" disabled={busy} onClick={() => setRawStep(3)}>Looks right</Button>,
        secondary: <Button variant="secondary" disabled={busy} onClick={reopenArea}>Redo drag</Button>
      }
      : {
        primary: <Button variant="primary" disabled={busy || !(knownDistance > 0) || unit.trim() === ""} onClick={() => setRawStep(3)}>Continue</Button>,
        secondary: <Button variant="secondary" disabled={busy} onClick={() => setRawStep(1)}>Back to the points</Button>
      };
    return squareMode
      ? {
        primary: <Button variant="primary" disabled={busy} onClick={completeWizard}>Confirm grid</Button>,
        secondary: <Button variant="secondary" disabled={busy} onClick={() => setRawStep(2)}>Fine-tune again</Button>
      }
      : {
        // Enabled only for input the server accepts: `distancePerPixel` is null for spans
        // `deriveMapDistanceScale` refuses, and `measurementUnit` refuses an empty unit. The rail can jump
        // straight here, so the gate must be on this step too.
        primary: <Button variant="primary" disabled={busy || points.length < 2 || distancePerPixel === null || unit.trim() === ""} onClick={saveScale}>Save map scale</Button>,
        secondary: <Button variant="secondary" disabled={busy} onClick={() => setRawStep(2)}>Change the distance</Button>
      };
  })();

  const nudge = (adjustment: Record<string, unknown>, label: string) =>
    <Button variant="secondary" block disabled={busy} onClick={() => wizardAction({ action: "adjust", adjustment })}>{label}</Button>;

  return <>
    <section className="map-manager scenes-maps-view pane-frame frame-col anim-view" aria-labelledby="map-manager-heading">
      <header className="map-manager-head">
        {onBack && <Button variant="ghost" className="map-manager-back" onClick={onBack}><IconChevronLeft /> Back to scenes</Button>}
        <div className="map-manager-title">
          <div>
            <Eyebrow>GM map library</Eyebrow>
            <h2 id="map-manager-heading">Maps</h2>
          </div>
          <p>One collection: the same maps the scene-prep picker offers. Add an image, set its grid, then use it in a scene.</p>
        </div>
        {/* The upload row: one "Add map…" file button; name/type/folder fields appear once a file is
            chosen. The class says a file is chosen and the CSS decides how that lays out. */}
        <form className={`map-upload${file ? " has-file" : ""}`} onSubmit={upload}>
          <Button variant={file ? "secondary" : "primary"} className="map-upload-file" onClick={() => uploadInputRef.current?.click()}>
            <IconPlus /> {file ? file.name : "Add map…"}
          </Button>
          <input ref={uploadInputRef} className="map-upload-input" type="file" tabIndex={-1} aria-hidden="true"
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
            onChange={(event) => { const next = event.target.files?.[0] ?? null; setFile(next); if (next && !name) setName(next.name.replace(/\.[^.]+$/, "")); }} />
          <div className="map-upload-details">
            <label>Map name <span className="map-upload-optional">(optional)</span><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="Ruined Keep" /></label>
            <label>Map type<Select value={kind} onChange={(event) => setKind(event.target.value as MapKind)}><option value="battlemap">Battle map</option><option value="regional">Regional map</option><option value="world">World map</option></Select></label>
            <label>Folder<Input value={uploadFolder} onChange={(event) => setUploadFolder(event.target.value)} maxLength={60} placeholder="Optional" list="map-folder-list" /></label>
            <datalist id="map-folder-list">{folderNames.map((folder) => <option key={folder} value={folder} />)}</datalist>
            <Button variant="primary" type="submit" disabled={busy || !file}>Upload map</Button>
          </div>
        </form>
      </header>

      <div className="map-body frame-fill" data-view={narrowView}>
        <div className="map-rail">
          <div className="map-rail-filters" role="group" aria-label="Filter maps">
            <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search maps" aria-label="Search maps" />
            <SegmentedControl
              ariaLabel="Filter maps by type"
              size="sm"
              value={kindFilter}
              onChange={(value) => setKindFilter(value as typeof kindFilter)}
              options={[{ value: "all", label: "All" }, { value: "battlemap", label: "Battle maps" }, { value: "regional", label: "Regional" }, { value: "world", label: "World" }]}
            />
          </div>
          {/* Folders up front, one scrolling chip row, as in the embedded picker. */}
          <div className="map-folder-chips" role="group" aria-label="Folders">
            <Chip pressed={folderChip === "all"} onClick={() => setFolderChip("all")}>All</Chip>
            {folderNames.map((folder) => <Chip key={folder} pressed={folderChip === folder} onClick={() => setFolderChip(folder)}>{folder}</Chip>)}
            {maps.some((map) => map.folder === null) && <Chip pressed={folderChip === null} onClick={() => setFolderChip(null)}>Unfiled</Chip>}
          </div>
          {/* The scroll region is the wrapper, never the `<ul>`: a grid with a definite block size stops
              sizing its auto rows from its cards. The picker's own 21rem cap is lifted here so there is
              one scroller. */}
          <div className="map-rail-list scroll-y">
            {/* The same tile as the embedded picker. */}
            <ul className="map-picker-grid" aria-label="Uploaded maps">
              {filteredMaps.map((map) => <MapTile key={map.id} map={{ id: map.id, name: map.name, kind: map.kind, folder: map.folder, width: map.width, height: map.height, calibration: map.calibration, scale: map.scale }}
                token={gmToken} selected={map.id === selectedId} onSelect={() => { setSelectedId(map.id); setNarrowView("pane"); }}
                meta={`${map.calibration ? "Grid set" : map.scale ? "Gridless" : "No grid yet"} · ${map.width}×${map.height}`} />)}
            </ul>
            {filteredMaps.length === 0 && <p className="map-list-empty">{maps.length === 0 ? "No maps yet — add one above." : "No maps match this filter."}</p>}
          </div>
        </div>

        {selected ? <section className="map-pane" aria-label={`Calibrate ${selected.name}`}>
          <div className="map-pane-head">
            <Button variant="ghost" className="map-pane-back" onClick={() => setNarrowView("rail")}><IconChevronLeft /> All maps</Button>
            <div className="map-pane-title">
              <strong>{selected.name}</strong>
              <span className="tabular">{selected.width}×{selected.height} · {selected.calibration ? "grid set" : selected.scale ? "gridless" : "no grid yet"}</span>
            </div>
            <div className="map-folder-move" role="group" aria-label="Organize this map">
              <Select value={selected.folder ?? ""} onChange={(event) => moveToFolder(event.target.value || null)} disabled={busy} aria-label="Move map to folder">
                <option value="">Unfiled</option>
                {folderNames.map((folder) => <option key={folder} value={folder}>{folder}</option>)}
              </Select>
              <Button variant="secondary" disabled={busy} onClick={async () => { const folder = await prompt({ title: "New folder", body: "Move this map to a new folder.", placeholder: "Folder name", confirmLabel: "Move" }); if (folder) moveToFolder(folder); }}>New folder…</Button>
            </div>
          </div>

          <Steps className="map-steps" steps={stepItems} current={step} maxSelectable={maxStep} onStepSelect={goToStep} ariaLabel="Grid calibration" />
          {/* The one live status region on this surface; errors go to the toast. */}
          <p className="map-step-note" id="map-step-note" role="status">{instruction}</p>

          {/* The canvas: mounted once, never inside a step panel, never unmounted, and the pane's only
              flex-filling child. `touch-action: none` is unconditional in the stylesheet: this surface is a
              drag target, never a scroller. */}
          <div className="map-canvas-col">
            <div ref={previewRef} className={`map-preview ${squareMode && !wizard ? "grid-area-mode" : ""} ${pendingArea ? (areaAction === "resize" ? "resizing" : "movable") : ""}`}
              onClick={squareMode ? (wizard && verifying ? choosePoint : undefined) : choosePoint}
              onPointerDown={beginGridArea} onPointerMove={moveGridArea} onPointerUp={finishGridArea} onPointerCancel={cancelGridArea}
              onPointerLeave={() => { if (!dragStart && !areaAction) setHoverPoint(null); }}
              aria-describedby="map-step-note"
              aria-label={`Map preview for ${selected.name}. ${pendingArea ? "Drag to move or resize the placed grid area." : squareMode && !wizard ? "Drag across a three-by-three grid area." : "Click to place the instructed point."}`}>
              {previewUrl ? <svg ref={svgRef} viewBox={previewViewBox} width={selected.width} height={selected.height} preserveAspectRatio="xMidYMid meet">
                <image href={previewUrl} width={selected.width} height={selected.height} role="img" aria-label={selected.name} />
                <GridOverlay lines={overlay} />
                {dragStart && dragCurrent && <GridAreaPreview start={dragStart} end={dragCurrent} />}
                {pendingArea && <GridAreaPreview start={pendingArea.start} end={pendingArea.end} handle />}
                {crosshairPoints.length > 0 && <CrosshairOverlay points={crosshairPoints} width={selected.width} height={selected.height} color={crosshairColor} opacity={crosshairOpacity} dash={crosshairStyle === "dashed" ? "6 5" : crosshairStyle === "dotted" ? "1 6" : "none"} />}
                {showPoints && points.slice(0, wizard ? 3 : 2).map((point, index) => <g key={index}><circle cx={point.x} cy={point.y} r={Math.max(4, Math.min(selected.width, selected.height) / 80)} /><text x={point.x} y={point.y}>{index === 0 ? "A" : index === 1 ? "C" : "V"}</text></g>)}
              </svg> : <p>Loading map preview…</p>}
            </div>
            <div className="map-canvas-tools" role="group" aria-label="Map preview zoom">
              <Button variant="secondary" disabled={!previewUrl} onClick={() => zoomFromCentre(1 / 1.3)} aria-label="Zoom out">−</Button>
              <span className="map-zoom-level tabular">{previewCamera ? `${previewCamera.zoom.toFixed(1)}×` : "1.0×"}</span>
              <Button variant="secondary" disabled={!previewUrl} onClick={() => zoomFromCentre(1.3)} aria-label="Zoom in">+</Button>
              <Button variant="secondary" disabled={!previewCamera} onClick={() => setPreviewCamera(null)}>Reset zoom</Button>
            </div>
          </div>

          <div className="map-step-body scroll-y">
            {expired ? <div className="map-expired">
              <strong>This calibration session expired.</strong>
              <p>The server holds an unconfirmed measurement for 30 minutes. Your 3 × 3 placement is still here — take it back to the map and measure it again.</p>
            </div>
            : step === 0 ? <ChoiceGrid
              className="map-mode-choice"
              ariaLabel="Calibration type"
              searchable={false}
              options={modeOptions}
              value={selected.kind === "battlemap" ? battlemapMode : "gridless"}
              onChange={(value) => {
                // Re-picking the current answer must not throw away a placed area.
                if (selected.kind !== "battlemap" || value === battlemapMode) return;
                setBattlemapMode(value as "square" | "gridless");
                if (value === "gridless") setUnit("feet");
                // A half-built square-grid wizard must not survive into the gridless path.
                restartCalibration();
              }}
            />
            : step === 1 ? <div className="map-step-panel">
              {squareMode
                ? <p className="map-step-hint">Start exactly on one printed-grid intersection. Hold and drag diagonally across a block containing <strong>nine squares</strong>, then release exactly on the opposite intersection.</p>
                : <p className="map-step-hint">Click point <strong>A</strong>, then point <strong>C</strong>. Pick two landmarks whose distance apart you already know — a road's length, the span of a lake.</p>}
              {/* The crosshair aids aiming, so its controls live on this step. Once a wizard exists the
                  crosshair is not drawn (the overlay replaces it). */}
              {squareMode && <div className="crosshair-controls" role="group" aria-label="Alignment crosshair">
                <span className="crosshair-label">Crosshair</span>
                <div className="crosshair-swatches">{CROSSHAIR_PRESETS.map((preset) => <button key={preset.color} type="button" aria-label={preset.label} aria-pressed={crosshairColor.toLowerCase() === preset.color} style={{ "--swatch": preset.color } as React.CSSProperties} onClick={() => setCrosshairColor(preset.color)} />)}</div>
                <label className="crosshair-color">Custom<input type="color" value={crosshairColor} onChange={(event) => setCrosshairColor(event.target.value)} /></label>
                <label className="crosshair-opacity">Opacity<input type="range" min="0.2" max="1" step="0.05" value={crosshairOpacity} onChange={(event) => setCrosshairOpacity(Number(event.target.value))} /></label>
                <Button variant="secondary" className="crosshair-style" onClick={() => setCrosshairStyle((current) => current === "dashed" ? "dotted" : current === "dotted" ? "solid" : "dashed")}>{crosshairStyle === "dashed" ? "Dashed" : crosshairStyle === "dotted" ? "Dotted" : "Solid"}</Button>
              </div>}
              {points.length > 0 && <p className="map-point-summary tabular">{points.slice(0, 2).map((point, index) => <span key={index}><strong>{index === 0 ? "A" : "C"}</strong> {Math.round(point.x)}, {Math.round(point.y)}</span>)}</p>}
            </div>
            : step === 2 ? <div className="map-step-panel">
              {squareMode ? <>
                {wizard && <p className="grid-detected tabular">{wizard.calibration.cellSizePx.toFixed(0)} px squares · {wizard.calibration.distancePerCell} ft each</p>}
                {/* Shown, not behind a `<details>`: the nudges are what this step is for, and the coordinate
                    fields under them are the keyboard alternative. Every one is a server action. */}
                <div className="adjustment-groups">
                  <fieldset><legend>Move overlay</legend>
                    {nudge({ originDelta: { x: -1, y: 0 } }, "← Left")}
                    {nudge({ originDelta: { x: 1, y: 0 } }, "Right →")}
                    {nudge({ originDelta: { x: 0, y: -1 } }, "↑ Up")}
                    {nudge({ originDelta: { x: 0, y: 1 } }, "Down ↓")}
                  </fieldset>
                  <fieldset><legend>Square size</legend>
                    {nudge({ cellSizeDeltaPx: -.5 }, "− Smaller")}
                    {nudge({ cellSizeDeltaPx: .5 }, "+ Larger")}
                  </fieldset>
                  <fieldset><legend>History</legend>
                    <Button variant="secondary" block disabled={busy} onClick={() => wizardAction({ action: "undo" })}>Undo</Button>
                    <Button variant="secondary" block disabled={busy} onClick={() => wizardAction({ action: "redo" })}>Redo</Button>
                  </fieldset>
                </div>
                <div className="point-editor">
                  {[0, 1].map((index) => <fieldset key={index}>
                    <legend>{index === 0 ? "Drag start A" : "Drag end C"}</legend>
                    <label>X<Input type="number" value={points[index]?.x ?? ""} onChange={(event) => updatePoint(index, "x", Number(event.target.value))} /></label>
                    <label>Y<Input type="number" value={points[index]?.y ?? ""} onChange={(event) => updatePoint(index, "y", Number(event.target.value))} /></label>
                  </fieldset>)}
                  {points.length >= 2 && <Button variant="secondary" disabled={busy} onClick={() => void startAreaWizard(points[0], points[1])}>Re-measure from these coordinates</Button>}
                </div>
              </> : <div className="wizard-fields">
                <label>Distance between A and C<Input type="number" min="0.01" value={knownDistance} onChange={(event) => setKnownDistance(Number(event.target.value))} /></label>
                <label>Unit<Input value={unit} onChange={(event) => setUnit(event.target.value)} maxLength={32} placeholder={selected.kind === "battlemap" ? "feet" : "miles"} /></label>
              </div>}
            </div>
            : <div className="map-step-panel">
              {squareMode ? <>
                {/* Real verification: the server computes the error against its tolerance, and a miss never
                    blocks Confirm. */}
                <div className="verification-card">
                  <strong>{points.length < 3 ? "Click a distant grid intersection" : "Check point V"}</strong>
                  <p>{points.length < 3 ? "Choose one far from the 3 × 3 sample — that is what catches a spacing error." : "Ask the server whether V lands close enough to an intersection on the blue overlay."}</p>
                  <Button variant="secondary" disabled={busy || points.length < 3} onClick={() => wizardAction({ action: "verify", imagePoint: points[2] })}>Verify selected point</Button>
                </div>
                {wizard?.verification && <p className={wizard.verification.accepted ? "verification accepted" : "verification rejected"}>{wizard.verification.accepted ? `Aligned — V is within ${wizard.verification.errorPx.toFixed(2)} px of the grid (tolerance ${wizard.verification.tolerancePx.toFixed(2)} px).` : `Not aligned — V misses by ${wizard.verification.errorPx.toFixed(2)} px against a ${wizard.verification.tolerancePx.toFixed(2)} px tolerance. This does not block Confirm.`}</p>}
                {wizard && <dl className="map-review tabular">
                  <div><dt>Square size</dt><dd>{wizard.calibration.cellSizePx.toFixed(2)} px</dd></div>
                  <div><dt>Origin</dt><dd>{wizard.calibration.origin.x.toFixed(1)}, {wizard.calibration.origin.y.toFixed(1)}</dd></div>
                  <div><dt>Distance per square</dt><dd>{wizard.calibration.distancePerCell} ft</dd></div>
                </dl>}
              </> : <>
                {/* A review, not a verification: the scale path has no server-side check, so this reads back
                    what will be saved, and no "verified" badge. When the server would refuse the span or the
                    distance, the sentence says which and the Scale row stays empty. */}
                <p className="map-step-hint">{distancePerPixel !== null
                  ? "Nothing is saved yet. This is what “Save map scale” will send."
                  : scaleSpanPx > 0
                    ? "The distance between A and C has to be more than zero before this can be saved."
                    : "A and C are the same place, so there is no span to scale. Go back and put them on two different landmarks."}</p>
                <dl className="map-review tabular">
                  <div><dt>Point A</dt><dd>{points[0] ? `${Math.round(points[0].x)}, ${Math.round(points[0].y)}` : "—"}</dd></div>
                  <div><dt>Point C</dt><dd>{points[1] ? `${Math.round(points[1].x)}, ${Math.round(points[1].y)}` : "—"}</dd></div>
                  <div><dt>Known distance</dt><dd>{knownDistance} {unit}</dd></div>
                  <div><dt>Scale</dt><dd>{distancePerPixel !== null ? `${distancePerPixel.toFixed(4)} ${unit} per pixel` : "—"}</dd></div>
                </dl>
              </>}
            </div>}
          </div>

          <div className="map-step-actions">
            {actions.primary}
            {actions.secondary}
          </div>
        </section> : <div className="map-pane map-pane-empty"><p className="map-empty">No maps uploaded yet — add one above and it lands here to be calibrated.</p></div>}
      </div>
    </section>
    {dialog}
  </>;
}
