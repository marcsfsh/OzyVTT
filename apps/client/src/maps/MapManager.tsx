import { useEffect, useRef, useState } from "react";
import { Button, Input, Select } from "@vtt/ui";
import { clampPoint, GridOverlay, imagePointFromClient, type OverlayLine } from "../scene/mapImage";
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
type WizardState = Readonly<{
  step: "refine" | "verify" | "complete";
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

async function api(path: string, gmToken: string, init: RequestInit = {}) {
  const response = await fetch(path, { ...init, headers: { authorization: `Bearer ${gmToken}`, ...init.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? body.message ?? "Map request failed.");
  return body.data;
}

/**
 * Snaps a raw drag point to an axis-aligned square from the start corner: equal side length on
 * both axes (side = the larger of the two deltas), sign preserved so it follows the drag
 * direction, clamped so the square stays inside the map. This makes the calibration drag a true
 * square (0°/90° aligned) - dragging a corner grows/shrinks both sides at the same rate - which is
 * what the server's `deriveSquareGridFromArea` expects (it reads start/end as opposite corners of
 * an axis-aligned box and locks rotation to 0).
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

/** Two full-map guide lines that follow the point being placed/adjusted, to help line up a corner against printed grid art before or during a drag. */
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

export function MapManager({ gmToken, preferredMapId, onSelectionChange }: Readonly<{ gmToken: string; preferredMapId?: string | null; onSelectionChange?: (map: MapSelection | null) => void }>) {
  const [maps, setMaps] = useState<readonly MapAsset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<MapKind>("battlemap");
  const [uploadFolder, setUploadFolder] = useState("");
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | MapKind>("all");
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
  const [verifying, setVerifying] = useState(false);
  const [wizardId, setWizardId] = useState<string | null>(null);
  const [wizard, setWizard] = useState<WizardState | null>(null);
  const [overlay, setOverlay] = useState<readonly OverlayLine[]>([]);
  const [knownDistance, setKnownDistance] = useState(50);
  const [unit, setUnit] = useState("miles");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const { prompt, dialog } = usePrompt();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const selected = maps.find((map) => map.id === selectedId) ?? null;
  const folderNames = Array.from(new Set(maps.map((map) => map.folder).filter((folder): folder is string => folder !== null))).sort((a, b) => a.localeCompare(b));
  const needle = search.trim().toLowerCase();
  const filteredMaps = maps.filter((map) => (kindFilter === "all" || map.kind === kindFilter) && (needle === "" || map.name.toLowerCase().includes(needle)));
  // Group the (filtered) maps by folder, unfiled last, so the GM can organize a large library.
  const groupedMaps = [...folderNames, null].flatMap((folder) => {
    const group = filteredMaps.filter((map) => map.folder === folder);
    return group.length ? [{ folder, maps: group }] : [];
  });

  const refresh = async (preferId?: string) => {
    const data = await api("/api/v1/map-assets", gmToken);
    setMaps(data.assets);
    setSelectedId((current) => preferId ?? (current && data.assets.some((map: MapAsset) => map.id === current) ? current : data.assets[0]?.id ?? null));
  };
  useEffect(() => { void refresh().catch((error) => setMessage(error.message)); }, [gmToken]);
  useEffect(() => { if (preferredMapId && maps.some((map) => map.id === preferredMapId)) setSelectedId(preferredMapId); }, [preferredMapId, maps]);
  useEffect(() => {
    setPoints([]); setDragStart(null); setDragCurrent(null); setWizardId(null); setWizard(null); setOverlay([]); setVerifying(false); setPreviewCamera(null); setLastArea(null);
    if (!selected) { setPreviewUrl(null); return; }
    setBattlemapMode(selected.scale && !selected.calibration ? "gridless" : "square");
    setUnit(selected.scale?.unit ?? (selected.kind === "battlemap" ? "feet" : "miles"));
    const controller = new AbortController(); let url: string | null = null;
    fetch(`/api/v1/map-assets/${selected.id}/content`, { headers: { authorization: `Bearer ${gmToken}` }, signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error("Could not load map preview."); url = URL.createObjectURL(await response.blob()); setPreviewUrl(url); })
      .catch((error) => { if (error.name !== "AbortError") setMessage(error.message); });
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

  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setMessage("");
    try { await operation(); } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  const upload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return setMessage("Choose an image first.");
    await run(async () => {
      const query = new URLSearchParams({ filename: file.name, name: name || file.name.replace(/\.[^.]+$/, ""), kind });
      if (uploadFolder.trim()) query.set("folder", uploadFolder.trim());
      const data = await api(`/api/v1/map-assets?${query}`, gmToken, { method: "POST", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
      setFile(null); setName(""); await refresh(data.asset.id); setMessage(data.duplicate ? "That image was already uploaded; the existing map is selected." : "Map uploaded. Select reference points to calibrate it.");
    });
  };
  const moveToFolder = (folder: string | null) => run(async () => {
    if (!selected) return;
    await api(`/api/v1/map-assets/${selected.id}`, gmToken, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ folder }) });
    await refresh(selected.id); setMessage(folder ? `Moved to “${folder}”.` : "Removed from its folder.");
  });
  const pointAt = (clientX: number, clientY: number) => {
    if (!selected || !svgRef.current) return null;
    const point = imagePointFromClient(svgRef.current, clientX, clientY);
    return point ? clampPoint(point, selected.width, selected.height) : null;
  };
  // Wheel-zoom on the calibration preview so the GM can zoom in to place the 3×3 box precisely
  // against the printed art. Zooms at the cursor and never zooms out past the full map.
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
  useEffect(() => {
    const el = previewRef.current; if (!el) return;
    const onWheel = (event: WheelEvent) => { if (!svgRef.current || !selected) return; event.preventDefault(); zoomPreviewAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.15 : 1 / 1.15); };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, previewCamera]);
  // "Redo drag" brings the just-placed 3×3 box back so the GM can nudge it and re-measure, instead of starting from scratch.
  const reopenArea = () => {
    const area = lastArea ?? (points.length >= 2 ? { start: points[0], end: points[1] } : null);
    if (!area) { restartCalibration("Drag diagonally across a 3 × 3 block of printed squares."); return; }
    setPendingArea(area); setPoints([area.start, area.end]);
    setWizard(null); setWizardId(null); setOverlay([]); setVerifying(false);
    setMessage("Adjust the square, then measure the grid again.");
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
    setPoints([]); setDragStart(point); setDragCurrent(point); setMessage("Keep dragging to the opposite corner of a 3 × 3 block.");
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
      setPendingArea({ start, end }); setPoints([start, end]);
      setMessage("Drag the square to move it, its corner to resize it, then measure the grid.");
      return;
    }
    if (areaAction) {
      if (pendingArea) setPoints([pendingArea.start, pendingArea.end]);
      setAreaAction(null); setMoveGrab(null);
    }
  };
  const cancelGridArea = () => { setDragStart(null); setDragCurrent(null); setAreaAction(null); setMoveGrab(null); };
  const confirmPendingArea = () => { if (pendingArea) void startAreaWizard(pendingArea.start, pendingArea.end); };
  const discardPendingArea = () => restartCalibration("Drag diagonally across a 3 × 3 block of printed squares.");
  const updatePoint = (index: number, coordinate: "x" | "y", value: number) => setPoints((current) => {
    const next = [...current];
    while (next.length <= index) next.push({ x: 0, y: 0 });
    next[index] = { ...next[index], [coordinate]: Number.isFinite(value) ? value : 0 };
    return next;
  });
  const acceptWizardData = (data: any) => { setWizardId(data.wizardId); setWizard(data.state); setOverlay(data.overlay ?? []); setPendingArea(null); if (data.overlayWarning) setMessage(data.overlayWarning); };
  const startAreaWizard = (start: Point, end: Point) => run(async () => {
    if (!selected) throw new Error("Select a battlemap first.");
    setLastArea({ start, end });
    const data = await api(`/api/v1/map-assets/${selected.id}/calibration/wizards`, gmToken, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ start, end, cellsAcross: 3, cellsDown: 3, distancePerCell }) });
    acceptWizardData(data);
    if (!data.overlayWarning) setMessage("3 × 3 area measured. Confirm below if the blue overlay matches the printed grid.");
  });
  const wizardAction = (action: Record<string, unknown>) => run(async () => {
    if (!selected || !wizardId) throw new Error("Start grid calibration first.");
    acceptWizardData(await api(`/api/v1/map-assets/${selected.id}/calibration/wizards/${wizardId}/actions`, gmToken, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action) }));
  });
  const completeWizard = () => run(async () => {
    if (!selected || !wizardId) throw new Error("Start grid calibration first.");
    await api(`/api/v1/map-assets/${selected.id}/calibration/wizards/${wizardId}/complete`, gmToken, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    await refresh(selected.id); setWizard(null); setWizardId(null); setOverlay([]); setPoints([]); setDragStart(null); setDragCurrent(null); setPendingArea(null); setVerifying(false); setMessage("Grid calibration saved.");
  });
  const saveScale = () => run(async () => {
    if (!selected || points.length < 2) throw new Error("Choose two points with a known real-world distance.");
    await api(`/api/v1/map-assets/${selected.id}/scale`, gmToken, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ start: points[0], end: points[1], knownDistance, unit }) });
    await refresh(selected.id); setPoints([]); setMessage("Map scale saved.");
  });
  const restartCalibration = (notice: string) => { setPoints([]); setDragStart(null); setDragCurrent(null); setHoverPoint(null); setPendingArea(null); setAreaAction(null); setMoveGrab(null); setWizardId(null); setWizard(null); setOverlay([]); setVerifying(false); setMessage(notice); };
  const squareMode = selected?.kind === "battlemap" && battlemapMode === "square";
  const showPoints = !wizard || verifying;
  const instruction = squareMode
    ? (pendingArea ? "Drag inside the square to move it, or its corner to resize it. Confirm when it lines up with the printed grid."
      : !wizard ? "Press on a grid intersection, drag diagonally across a 3 × 3 block of squares, and release on the opposite intersection."
      : "Grid detected. Confirm it below, or fine-tune it first if it looks off.")
    : `${points.length < 2 ? `Choose ${points.length ? "the ending" : "a starting"} point` : "Enter the real-world distance"}. Click two locations on the map whose real-world distance you know.`;
  // While dragging out or resizing, the crosshair tracks the moving corner; once the box is placed and
  // idle, both corners get a crosshair so either edge can be lined up against the printed grid.
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

  return <>
    <section className="map-manager" aria-labelledby="map-manager-heading">
      <div className="map-manager-heading"><div><span className="eyebrow">GM MAP LIBRARY</span><h2 id="map-manager-heading">Maps and grid setup</h2></div><p>Upload an image, align its printed grid, then present it to the shared screen.</p></div>
      <form className="map-upload" onSubmit={upload}>
        <label>Map image<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" onChange={(event) => { const next = event.target.files?.[0] ?? null; setFile(next); if (next && !name) setName(next.name.replace(/\.[^.]+$/, "")); }} /></label>
        <label>Map name<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="Ruined Keep" /></label>
        <label>Map type<Select value={kind} onChange={(event) => setKind(event.target.value as MapKind)}><option value="battlemap">Battlemap</option><option value="regional">Regional map</option><option value="world">World map</option></Select></label>
        <label>Folder<Input value={uploadFolder} onChange={(event) => setUploadFolder(event.target.value)} maxLength={60} placeholder="Optional" list="map-folder-list" /></label>
        <datalist id="map-folder-list">{folderNames.map((folder) => <option key={folder} value={folder} />)}</datalist>
        <Button variant="primary" type="submit" disabled={busy || !file}>Upload map</Button>
      </form>
      {message && <p className="map-feedback" role="status">{message}</p>}
      {maps.length > 0 && <div className="map-workspace">
        <div className="map-list-column">
          <div className="map-list-filters" role="group" aria-label="Filter maps">
            <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search maps" aria-label="Search maps" />
            <div className="map-kind-chips">{(["all", "battlemap", "regional", "world"] as const).map((value) => <button key={value} type="button" aria-pressed={kindFilter === value} onClick={() => setKindFilter(value)}>{value === "all" ? "All" : value === "battlemap" ? "Battlemaps" : value === "regional" ? "Regional" : "World"}</button>)}</div>
          </div>
          <nav className="map-list" aria-label="Uploaded maps">
            {groupedMaps.length === 0 && <p className="map-list-empty">No maps match this filter.</p>}
            {groupedMaps.map((group) => <div key={group.folder ?? "__unfiled"} className="map-folder-group">
              <p className="map-folder-label">{group.folder ?? "Unfiled"}</p>
              {group.maps.map((map) => <button key={map.id} className={`lift${map.id === selectedId ? " selected" : ""}`} onClick={() => setSelectedId(map.id)}><strong>{map.name}</strong><span>{map.kind} · {map.width}×{map.height}</span><small>{map.calibration ? "Grid calibrated" : map.scale ? `Scale ${map.scale.distancePerPixel.toPrecision(3)} ${map.scale.unit}/px` : "Needs scale setup"}</small></button>)}
            </div>)}
          </nav>
        </div>
        {selected && <div className="map-calibration">
          <div className="map-folder-move" role="group" aria-label="Organize this map">
            <span>Folder</span>
            <Select value={selected.folder ?? ""} onChange={(event) => moveToFolder(event.target.value || null)} disabled={busy} aria-label="Move map to folder">
              <option value="">Unfiled</option>
              {folderNames.map((folder) => <option key={folder} value={folder}>{folder}</option>)}
            </Select>
            <Button variant="secondary" type="button" disabled={busy} onClick={async () => { const folder = await prompt({ title: "New folder", body: "Move this map to a new folder.", placeholder: "Folder name", confirmLabel: "Move" }); if (folder) moveToFolder(folder); }}>New folder…</Button>
          </div>
          {selected.kind === "battlemap" && <div className="grid-mode-choice" role="group" aria-label="Battlemap grid type"><button className="lift" aria-pressed={battlemapMode === "square"} onClick={() => { setBattlemapMode("square"); restartCalibration("Drag diagonally across a 3 × 3 block of printed squares."); }}><strong>Printed square grid</strong><span>Drag over a 3 × 3 block to align scale and position.</span></button><button className="lift" aria-pressed={battlemapMode === "gridless"} onClick={() => { setBattlemapMode("gridless"); setUnit("feet"); restartCalibration("Grid overlay skipped. Click the first point of a known distance."); }}><strong>Gridless battlemap</strong><span>Skip the overlay and set distance from two known points.</span></button></div>}
          <div className="calibration-instruction" id="calibration-instruction" role="status">
            <span>{squareMode ? "SQUARE GRID" : selected.kind === "battlemap" ? "GRIDLESS SCALE" : "MAP SCALE"}</span>
            <p>{instruction}</p>
            {squareMode && !wizard && <small>Squares are 5 ft each, the D&amp;D 5e default.</small>}
          </div>
          {squareMode && !wizard && <div className="crosshair-controls" role="group" aria-label="Alignment crosshair">
            <span>Crosshair</span>
            <div className="crosshair-swatches">{CROSSHAIR_PRESETS.map((preset) => <button key={preset.color} type="button" aria-label={preset.label} aria-pressed={crosshairColor.toLowerCase() === preset.color} style={{ background: preset.color }} onClick={() => setCrosshairColor(preset.color)} />)}</div>
            <label className="crosshair-color">Custom<input type="color" value={crosshairColor} onChange={(event) => setCrosshairColor(event.target.value)} /></label>
            <label className="crosshair-opacity">Opacity<input type="range" min="0.2" max="1" step="0.05" value={crosshairOpacity} onChange={(event) => setCrosshairOpacity(Number(event.target.value))} /></label>
            <button type="button" className="crosshair-style" onClick={() => setCrosshairStyle((current) => current === "dashed" ? "dotted" : current === "dotted" ? "solid" : "dashed")}>{crosshairStyle === "dashed" ? "Dashed" : crosshairStyle === "dotted" ? "Dotted" : "Solid"}</button>
            <span className="crosshair-hint">Scroll to zoom{previewCamera ? "" : " the map"}</span>
            {previewCamera && <button type="button" className="crosshair-style" onClick={() => setPreviewCamera(null)}>Reset zoom</button>}
          </div>}

          <div ref={previewRef} className={`map-preview ${squareMode && !wizard ? "grid-area-mode" : ""} ${pendingArea ? (areaAction === "resize" ? "resizing" : "movable") : ""}`} style={{ aspectRatio: `${selected.width} / ${selected.height}` }} onClick={squareMode ? (wizard && verifying ? choosePoint : undefined) : choosePoint} onPointerDown={beginGridArea} onPointerMove={moveGridArea} onPointerUp={finishGridArea} onPointerCancel={cancelGridArea} onPointerLeave={() => { if (!dragStart && !areaAction) setHoverPoint(null); }} aria-describedby="calibration-instruction" aria-label={`Map preview for ${selected.name}. ${pendingArea ? "Drag to move or resize the placed grid area." : squareMode && !wizard ? "Drag across a three-by-three grid area." : "Click to place the instructed point."}`}>
            {previewUrl ? <svg ref={svgRef} viewBox={previewViewBox} preserveAspectRatio="xMidYMid meet">
              <image href={previewUrl} width={selected.width} height={selected.height} role="img" aria-label={selected.name} />
              <GridOverlay lines={overlay} />
              {dragStart && dragCurrent && <GridAreaPreview start={dragStart} end={dragCurrent} />}
              {pendingArea && <GridAreaPreview start={pendingArea.start} end={pendingArea.end} handle />}
              {crosshairPoints.length > 0 && <CrosshairOverlay points={crosshairPoints} width={selected.width} height={selected.height} color={crosshairColor} opacity={crosshairOpacity} dash={crosshairStyle === "dashed" ? "6 5" : crosshairStyle === "dotted" ? "1 6" : "none"} />}
              {showPoints && points.slice(0, wizard ? 3 : 2).map((point, index) => <g key={index}><circle cx={point.x} cy={point.y} r={Math.max(4, Math.min(selected.width, selected.height) / 80)} /><text x={point.x} y={point.y}>{index === 0 ? "A" : index === 1 ? "C" : "V"}</text></g>)}
            </svg> : <p>Loading map preview…</p>}
          </div>

          {pendingArea && !wizard && <div className="grid-wizard-actions pending-area-actions"><button className="save-map" disabled={busy} onClick={confirmPendingArea}>Measure this area</button><Button variant="secondary" disabled={busy} onClick={discardPendingArea}>Start over</Button></div>}
          {showPoints && !pendingArea && points.length > 0 && <div className="point-summary"><div>{points.map((point, index) => <span key={index}><strong>{index === 0 ? "A" : index === 1 ? "C" : "V"}</strong> {point.x}, {point.y}</span>)}</div><Button variant="secondary" onClick={() => restartCalibration(squareMode ? "Drag diagonally across a 3 × 3 block of printed squares." : "Click the first point of a known distance.")}>{wizard ? "Start over" : "Reset points"}</Button></div>}
          {!wizard && <details className="advanced-points"><summary>Enter or fine-tune point coordinates (keyboard alternative)</summary><div className="point-editor">{[0, 1].map((index) => <fieldset key={index}><legend>{index === 0 ? "Drag start A" : "Drag end C"}</legend><label>X<Input type="number" value={points[index]?.x ?? ""} onChange={(event) => updatePoint(index, "x", Number(event.target.value))} /></label><label>Y<Input type="number" value={points[index]?.y ?? ""} onChange={(event) => updatePoint(index, "y", Number(event.target.value))} /></label></fieldset>)}</div>{squareMode && points.length >= 2 && <Button variant="secondary" disabled={busy} onClick={() => void startAreaWizard(points[0], points[1])}>Measure 3 × 3 area from these points</Button>}</details>}

          {squareMode ? <div className="grid-wizard">
            {!wizard && <p className="wizard-example">Start exactly on one printed-grid intersection. Hold and drag diagonally across a block containing <strong>nine squares</strong>, then release exactly on the opposite intersection.</p>}
            {wizard && <>
              <p className="grid-detected">{wizard.calibration.cellSizePx.toFixed(0)} px squares · {wizard.calibration.distancePerCell} ft each</p>
              <div className="grid-wizard-actions">
                <button className="save-map" disabled={busy} onClick={completeWizard}>Confirm grid</button>
                <Button variant="secondary" disabled={busy} onClick={reopenArea}>Redo drag</Button>
              </div>
              <details className="grid-fine-tune">
                <summary>Fine-tune (optional)</summary>
                <div className="adjustment-groups">
                  <fieldset><legend>Move overlay</legend><button onClick={() => wizardAction({ action: "adjust", adjustment: { originDelta: { x: -1, y: 0 } } })}>← Left</button><button onClick={() => wizardAction({ action: "adjust", adjustment: { originDelta: { x: 1, y: 0 } } })}>Right →</button><button onClick={() => wizardAction({ action: "adjust", adjustment: { originDelta: { x: 0, y: -1 } } })}>↑ Up</button><button onClick={() => wizardAction({ action: "adjust", adjustment: { originDelta: { x: 0, y: 1 } } })}>Down ↓</button></fieldset>
                  <fieldset><legend>Square size</legend><button onClick={() => wizardAction({ action: "adjust", adjustment: { cellSizeDeltaPx: -.5 } })}>− Smaller</button><button onClick={() => wizardAction({ action: "adjust", adjustment: { cellSizeDeltaPx: .5 } })}>+ Larger</button></fieldset>
                  <fieldset><legend>History</legend><button onClick={() => wizardAction({ action: "undo" })}>Undo</button><button onClick={() => wizardAction({ action: "redo" })}>Redo</button></fieldset>
                </div>
                <div className="verification-card">
                  {!verifying ? <Button variant="secondary" onClick={() => setVerifying(true)}>Check alignment at a distant point</Button> : <div><strong>{points.length < 3 ? "Click a distant grid intersection" : "Check point V"}</strong><p>{points.length < 3 ? "Choose one far from the 3 × 3 sample to catch spacing errors." : "Verify whether V lands close enough to an intersection on the blue overlay."}</p><button className="wizard-primary" disabled={busy || points.length < 3} onClick={() => wizardAction({ action: "verify", imagePoint: points[2] })}>Verify selected point</button></div>}
                </div>
                {wizard.verification && <p className={wizard.verification.accepted ? "verification accepted" : "verification rejected"}>{wizard.verification.accepted ? `Aligned - V is within ${wizard.verification.errorPx.toFixed(2)} px of the grid.` : `Not aligned - V misses by ${wizard.verification.errorPx.toFixed(2)} px. This does not block Confirm.`}</p>}
              </details>
            </>}
          </div> : <div className="grid-wizard"><h3>{selected.kind === "battlemap" ? "Gridless movement scale" : "Real-world scale"}</h3><p>{selected.kind === "battlemap" ? "Measure a known span so rulers can display feet without drawing a grid." : "Measure a known span so markers and rulers can use real-world distance."}</p><div className="wizard-fields"><label>Distance between the points<Input type="number" min="0.01" value={knownDistance} onChange={(event) => setKnownDistance(Number(event.target.value))} /></label><label>Unit<Input value={unit} onChange={(event) => setUnit(event.target.value)} maxLength={32} placeholder={selected.kind === "battlemap" ? "feet" : "miles"} /></label></div><button className="wizard-primary" disabled={busy || points.length < 2} onClick={saveScale}>Save map scale</button></div>}
        </div>}
      </div>}
      {maps.length === 0 && <p className="map-empty">No maps uploaded yet.</p>}
    </section>
    {dialog}
  </>;
}
