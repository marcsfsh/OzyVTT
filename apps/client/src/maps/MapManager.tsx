import { useEffect, useRef, useState } from "react";
import "./map-manager.css";

type Point = { x: number; y: number };
type MapKind = "battlemap" | "regional" | "world";
type MapAsset = Readonly<{
  id: string;
  name: string;
  kind: MapKind;
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
type OverlayLine = Readonly<{ axis: "column" | "row"; index: number; start: Point; end: Point; major: boolean }>;
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

const rounded = (value: number) => Math.round(value * 100) / 100;

const interpolate = (from: Point, to: Point, amount: number): Point => ({ x: from.x + (to.x - from.x) * amount, y: from.y + (to.y - from.y) * amount });

function GridAreaPreview({ start, end }: Readonly<{ start: Point; end: Point }>) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const topRight = { x: center.x + dy / 2, y: center.y - dx / 2 };
  const bottomLeft = { x: center.x - dy / 2, y: center.y + dx / 2 };
  const corners = [start, topRight, end, bottomLeft] as const;
  return <g className="grid-area-preview">
    <polygon points={corners.map((point) => `${point.x},${point.y}`).join(" ")} />
    {[1 / 3, 2 / 3].flatMap((amount) => {
      const top = interpolate(start, topRight, amount);
      const bottom = interpolate(bottomLeft, end, amount);
      const left = interpolate(start, bottomLeft, amount);
      const right = interpolate(topRight, end, amount);
      return [<line key={`column-${amount}`} x1={top.x} y1={top.y} x2={bottom.x} y2={bottom.y} />, <line key={`row-${amount}`} x1={left.x} y1={left.y} x2={right.x} y2={right.y} />];
    })}
  </g>;
}

export function MapManager({ gmToken, preferredMapId, onSelectionChange }: Readonly<{ gmToken: string; preferredMapId?: string | null; onSelectionChange?: (map: MapSelection | null) => void }>) {
  const [maps, setMaps] = useState<readonly MapAsset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<MapKind>("battlemap");
  const [points, setPoints] = useState<Point[]>([]);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragCurrent, setDragCurrent] = useState<Point | null>(null);
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
  const imageRef = useRef<HTMLImageElement | null>(null);
  const selected = maps.find((map) => map.id === selectedId) ?? null;

  const refresh = async (preferId?: string) => {
    const data = await api("/api/v1/map-assets", gmToken);
    setMaps(data.assets);
    setSelectedId((current) => preferId ?? (current && data.assets.some((map: MapAsset) => map.id === current) ? current : data.assets[0]?.id ?? null));
  };
  useEffect(() => { void refresh().catch((error) => setMessage(error.message)); }, [gmToken]);
  useEffect(() => { if (preferredMapId && maps.some((map) => map.id === preferredMapId)) setSelectedId(preferredMapId); }, [preferredMapId, maps]);
  useEffect(() => {
    setPoints([]); setDragStart(null); setDragCurrent(null); setWizardId(null); setWizard(null); setOverlay([]); setVerifying(false);
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
      const data = await api(`/api/v1/map-assets?${query}`, gmToken, { method: "POST", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
      setFile(null); setName(""); await refresh(data.asset.id); setMessage(data.duplicate ? "That image was already uploaded; the existing map is selected." : "Map uploaded. Select reference points to calibrate it.");
    });
  };
  const pointAt = (clientX: number, clientY: number) => {
    if (!selected || !imageRef.current) return;
    const rect = imageRef.current.getBoundingClientRect();
    return {
      x: rounded(Math.max(0, Math.min(selected.width, (clientX - rect.left) * selected.width / rect.width))),
      y: rounded(Math.max(0, Math.min(selected.height, (clientY - rect.top) * selected.height / rect.height)))
    };
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
    setPoints([]); setDragStart(point); setDragCurrent(point); setMessage("Keep dragging to the opposite corner of a 3 × 3 block.");
  };
  const moveGridArea = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const point = pointAt(event.clientX, event.clientY); if (!point) return;
    event.preventDefault(); setDragCurrent(point);
  };
  const finishGridArea = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const point = pointAt(event.clientX, event.clientY); if (!point) return;
    event.preventDefault(); event.currentTarget.releasePointerCapture(event.pointerId);
    const start = dragStart;
    setDragStart(null); setDragCurrent(null); setPoints([start, point]);
    void startAreaWizard(start, point);
  };
  const cancelGridArea = () => { setDragStart(null); setDragCurrent(null); };
  const updatePoint = (index: number, coordinate: "x" | "y", value: number) => setPoints((current) => {
    const next = [...current];
    while (next.length <= index) next.push({ x: 0, y: 0 });
    next[index] = { ...next[index], [coordinate]: Number.isFinite(value) ? value : 0 };
    return next;
  });
  const acceptWizardData = (data: any) => { setWizardId(data.wizardId); setWizard(data.state); setOverlay(data.overlay ?? []); if (data.overlayWarning) setMessage(data.overlayWarning); };
  const startAreaWizard = (start: Point, end: Point) => run(async () => {
    if (!selected) throw new Error("Select a battlemap first.");
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
    await refresh(selected.id); setWizard(null); setWizardId(null); setOverlay([]); setPoints([]); setDragStart(null); setDragCurrent(null); setVerifying(false); setMessage("Grid calibration saved.");
  });
  const saveScale = () => run(async () => {
    if (!selected || points.length < 2) throw new Error("Choose two points with a known real-world distance.");
    await api(`/api/v1/map-assets/${selected.id}/scale`, gmToken, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ start: points[0], end: points[1], knownDistance, unit }) });
    await refresh(selected.id); setPoints([]); setMessage("Map scale saved.");
  });
  const restartCalibration = (notice: string) => { setPoints([]); setDragStart(null); setDragCurrent(null); setWizardId(null); setWizard(null); setOverlay([]); setVerifying(false); setMessage(notice); };
  const squareMode = selected?.kind === "battlemap" && battlemapMode === "square";
  const showPoints = !wizard || verifying;
  const instruction = squareMode
    ? (!wizard ? "Press on a grid intersection, drag diagonally across a 3 × 3 block of squares, and release on the opposite intersection." : "Grid detected. Confirm it below, or fine-tune it first if it looks off.")
    : `${points.length < 2 ? `Choose ${points.length ? "the ending" : "a starting"} point` : "Enter the real-world distance"}. Click two locations on the map whose real-world distance you know.`;

  return <>
    <section className="map-manager" aria-labelledby="map-manager-heading">
      <div className="map-manager-heading"><div><span className="eyebrow">GM MAP LIBRARY</span><h2 id="map-manager-heading">Maps and grid setup</h2></div><p>Upload an image, align its printed grid, then present it to the shared screen.</p></div>
      <form className="map-upload" onSubmit={upload}>
        <label>Map image<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" onChange={(event) => { const next = event.target.files?.[0] ?? null; setFile(next); if (next && !name) setName(next.name.replace(/\.[^.]+$/, "")); }} /></label>
        <label>Map name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="Ruined Keep" /></label>
        <label>Map type<select value={kind} onChange={(event) => setKind(event.target.value as MapKind)}><option value="battlemap">Battlemap</option><option value="regional">Regional map</option><option value="world">World map</option></select></label>
        <button disabled={busy || !file}>Upload map</button>
      </form>
      {message && <p className="map-feedback" role="status">{message}</p>}
      {maps.length > 0 && <div className="map-workspace">
        <nav className="map-list" aria-label="Uploaded maps">{maps.map((map) => <button key={map.id} className={map.id === selectedId ? "selected" : ""} onClick={() => setSelectedId(map.id)}><strong>{map.name}</strong><span>{map.kind} · {map.width}×{map.height}</span><small>{map.calibration ? "Grid calibrated" : map.scale ? `Scale ${map.scale.distancePerPixel.toPrecision(3)} ${map.scale.unit}/px` : "Needs scale setup"}</small></button>)}</nav>
        {selected && <div className="map-calibration">
          {selected.kind === "battlemap" && <div className="grid-mode-choice" role="group" aria-label="Battlemap grid type"><button aria-pressed={battlemapMode === "square"} onClick={() => { setBattlemapMode("square"); restartCalibration("Drag diagonally across a 3 × 3 block of printed squares."); }}><strong>Printed square grid</strong><span>Drag over a 3 × 3 block to align scale and position.</span></button><button aria-pressed={battlemapMode === "gridless"} onClick={() => { setBattlemapMode("gridless"); setUnit("feet"); restartCalibration("Grid overlay skipped. Click the first point of a known distance."); }}><strong>Gridless battlemap</strong><span>Skip the overlay and set distance from two known points.</span></button></div>}
          <div className="calibration-instruction" id="calibration-instruction" role="status">
            <span>{squareMode ? "SQUARE GRID" : selected.kind === "battlemap" ? "GRIDLESS SCALE" : "MAP SCALE"}</span>
            <p>{instruction}</p>
            {squareMode && !wizard && <small>Squares are 5 ft each, the D&amp;D 5e default.</small>}
          </div>

          <div className={`map-preview ${squareMode && !wizard ? "grid-area-mode" : ""}`} style={{ aspectRatio: `${selected.width} / ${selected.height}` }} onClick={squareMode ? (wizard && verifying ? choosePoint : undefined) : choosePoint} onPointerDown={beginGridArea} onPointerMove={moveGridArea} onPointerUp={finishGridArea} onPointerCancel={cancelGridArea} aria-describedby="calibration-instruction" aria-label={`Map preview for ${selected.name}. ${squareMode && !wizard ? "Drag across a three-by-three grid area." : "Click to place the instructed point."}`}>
            {previewUrl ? <img ref={imageRef} src={previewUrl} alt={selected.name} draggable={false} /> : <p>Loading map preview…</p>}
            <svg viewBox={`0 0 ${selected.width} ${selected.height}`} aria-hidden="true">
              {overlay.map((line) => <line key={`${line.axis}-${line.index}`} className={line.major ? "major" : ""} x1={line.start.x} y1={line.start.y} x2={line.end.x} y2={line.end.y} />)}
              {dragStart && dragCurrent && <GridAreaPreview start={dragStart} end={dragCurrent} />}
              {showPoints && points.slice(0, wizard ? 3 : 2).map((point, index) => <g key={index}><circle cx={point.x} cy={point.y} r={Math.max(4, Math.min(selected.width, selected.height) / 80)} /><text x={point.x} y={point.y}>{index === 0 ? "A" : index === 1 ? "C" : "V"}</text></g>)}
            </svg>
          </div>

          {showPoints && points.length > 0 && <div className="point-summary"><div>{points.map((point, index) => <span key={index}><strong>{index === 0 ? "A" : index === 1 ? "C" : "V"}</strong> {point.x}, {point.y}</span>)}</div><button onClick={() => restartCalibration(squareMode ? "Drag diagonally across a 3 × 3 block of printed squares." : "Click the first point of a known distance.")}>{wizard ? "Start over" : "Reset points"}</button></div>}
          {!wizard && <details className="advanced-points"><summary>Enter or fine-tune point coordinates (keyboard alternative)</summary><div className="point-editor">{[0, 1].map((index) => <fieldset key={index}><legend>{index === 0 ? "Drag start A" : "Drag end C"}</legend><label>X<input type="number" value={points[index]?.x ?? ""} onChange={(event) => updatePoint(index, "x", Number(event.target.value))} /></label><label>Y<input type="number" value={points[index]?.y ?? ""} onChange={(event) => updatePoint(index, "y", Number(event.target.value))} /></label></fieldset>)}</div>{squareMode && points.length >= 2 && <button disabled={busy} onClick={() => void startAreaWizard(points[0], points[1])}>Measure 3 × 3 area from these points</button>}</details>}

          {squareMode ? <div className="grid-wizard">
            {!wizard && <p className="wizard-example">Start exactly on one printed-grid intersection. Hold and drag diagonally across a block containing <strong>nine squares</strong>, then release exactly on the opposite intersection.</p>}
            {wizard && <>
              <p className="grid-detected">{wizard.calibration.cellSizePx.toFixed(0)} px squares · {wizard.calibration.distancePerCell} ft each</p>
              <div className="grid-wizard-actions">
                <button className="save-map" disabled={busy} onClick={completeWizard}>Confirm grid</button>
                <button className="secondary" disabled={busy} onClick={() => restartCalibration("Drag diagonally across a 3 × 3 block of printed squares.")}>Redo drag</button>
              </div>
              <details className="grid-fine-tune">
                <summary>Fine-tune (optional)</summary>
                <div className="adjustment-groups">
                  <fieldset><legend>Move overlay</legend><button onClick={() => wizardAction({ action: "adjust", adjustment: { originDelta: { x: -1, y: 0 } } })}>← Left</button><button onClick={() => wizardAction({ action: "adjust", adjustment: { originDelta: { x: 1, y: 0 } } })}>Right →</button><button onClick={() => wizardAction({ action: "adjust", adjustment: { originDelta: { x: 0, y: -1 } } })}>↑ Up</button><button onClick={() => wizardAction({ action: "adjust", adjustment: { originDelta: { x: 0, y: 1 } } })}>Down ↓</button></fieldset>
                  <fieldset><legend>Square size</legend><button onClick={() => wizardAction({ action: "adjust", adjustment: { cellSizeDeltaPx: -.5 } })}>− Smaller</button><button onClick={() => wizardAction({ action: "adjust", adjustment: { cellSizeDeltaPx: .5 } })}>+ Larger</button></fieldset>
                  <fieldset><legend>History</legend><button onClick={() => wizardAction({ action: "undo" })}>Undo</button><button onClick={() => wizardAction({ action: "redo" })}>Redo</button></fieldset>
                </div>
                <div className="verification-card">
                  {!verifying ? <button onClick={() => setVerifying(true)}>Check alignment at a distant point</button> : <div><strong>{points.length < 3 ? "Click a distant grid intersection" : "Check point V"}</strong><p>{points.length < 3 ? "Choose one far from the 3 × 3 sample to catch spacing errors." : "Verify whether V lands close enough to an intersection on the blue overlay."}</p><button className="wizard-primary" disabled={busy || points.length < 3} onClick={() => wizardAction({ action: "verify", imagePoint: points[2] })}>Verify selected point</button></div>}
                </div>
                {wizard.verification && <p className={wizard.verification.accepted ? "verification accepted" : "verification rejected"}>{wizard.verification.accepted ? `Aligned — V is within ${wizard.verification.errorPx.toFixed(2)} px of the grid.` : `Not aligned — V misses by ${wizard.verification.errorPx.toFixed(2)} px. This does not block Confirm.`}</p>}
              </details>
            </>}
          </div> : <div className="grid-wizard"><h3>{selected.kind === "battlemap" ? "Gridless movement scale" : "Real-world scale"}</h3><p>{selected.kind === "battlemap" ? "Measure a known span so rulers can display feet without drawing a grid." : "Measure a known span so markers and rulers can use real-world distance."}</p><div className="wizard-fields"><label>Distance between the points<input type="number" min="0.01" value={knownDistance} onChange={(event) => setKnownDistance(Number(event.target.value))} /></label><label>Unit<input value={unit} onChange={(event) => setUnit(event.target.value)} maxLength={32} placeholder={selected.kind === "battlemap" ? "feet" : "miles"} /></label></div><button className="wizard-primary" disabled={busy || points.length < 2} onClick={saveScale}>Save map scale</button></div>}
        </div>}
      </div>}
      {maps.length === 0 && <p className="map-empty">No maps uploaded yet.</p>}
    </section>
  </>;
}
