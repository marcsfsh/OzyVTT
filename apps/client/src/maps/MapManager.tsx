import { useEffect, useRef, useState } from "react";
import { ViewerControls } from "../viewer/ViewerControls";
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

async function api(path: string, gmToken: string, init: RequestInit = {}) {
  const response = await fetch(path, { ...init, headers: { authorization: `Bearer ${gmToken}`, ...init.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? body.message ?? "Map request failed.");
  return body.data;
}

const rounded = (value: number) => Math.round(value * 100) / 100;

export function MapManager({ gmToken }: Readonly<{ gmToken: string }>) {
  const [maps, setMaps] = useState<readonly MapAsset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<MapKind>("battlemap");
  const [points, setPoints] = useState<Point[]>([]);
  const [cellsBetween, setCellsBetween] = useState(5);
  const [axis, setAxis] = useState<"horizontal" | "vertical">("horizontal");
  const [distancePerCell, setDistancePerCell] = useState(5);
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
  useEffect(() => {
    setPoints([]); setWizardId(null); setWizard(null); setOverlay([]);
    if (!selected) { setPreviewUrl(null); return; }
    const controller = new AbortController(); let url: string | null = null;
    fetch(`/api/v1/map-assets/${selected.id}/content`, { headers: { authorization: `Bearer ${gmToken}` }, signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error("Could not load map preview."); url = URL.createObjectURL(await response.blob()); setPreviewUrl(url); })
      .catch((error) => { if (error.name !== "AbortError") setMessage(error.message); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [selectedId, gmToken]);

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
  const choosePoint = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!selected || !imageRef.current) return;
    const rect = imageRef.current.getBoundingClientRect();
    const point = { x: rounded((event.clientX - rect.left) * selected.width / rect.width), y: rounded((event.clientY - rect.top) * selected.height / rect.height) };
    setPoints((current) => wizard ? [...current.slice(0, 2), point] : current.length >= 2 ? [point] : [...current, point]);
  };
  const updatePoint = (index: number, coordinate: "x" | "y", value: number) => setPoints((current) => {
    const next = [...current]; const existing = next[index] ?? { x: 0, y: 0 }; next[index] = { ...existing, [coordinate]: value }; return next;
  });
  const acceptWizardData = (data: any) => { setWizardId(data.wizardId); setWizard(data.state); setOverlay(data.overlay ?? []); if (data.overlayWarning) setMessage(data.overlayWarning); };
  const startWizard = () => run(async () => {
    if (!selected || points.length < 2) throw new Error("Choose two known grid intersections first.");
    const data = await api(`/api/v1/map-assets/${selected.id}/calibration/wizards`, gmToken, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ start: points[0], end: points[1], cellsBetween, axis, distancePerCell }) });
    acceptWizardData(data);
  });
  const wizardAction = (action: Record<string, unknown>) => run(async () => {
    if (!selected || !wizardId) throw new Error("Start grid calibration first.");
    acceptWizardData(await api(`/api/v1/map-assets/${selected.id}/calibration/wizards/${wizardId}/actions`, gmToken, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action) }));
  });
  const completeWizard = () => run(async () => {
    if (!selected || !wizardId) throw new Error("Start grid calibration first.");
    await api(`/api/v1/map-assets/${selected.id}/calibration/wizards/${wizardId}/complete`, gmToken, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    await refresh(selected.id); setWizard(null); setWizardId(null); setOverlay([]); setPoints([]); setMessage("Grid calibration saved.");
  });
  const saveScale = () => run(async () => {
    if (!selected || points.length < 2) throw new Error("Choose two points with a known real-world distance.");
    await api(`/api/v1/map-assets/${selected.id}/scale`, gmToken, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ start: points[0], end: points[1], knownDistance, unit }) });
    await refresh(selected.id); setPoints([]); setMessage("Map scale saved.");
  });

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
          <div className="map-preview" onClick={choosePoint} role="button" tabIndex={0} aria-label="Map preview. Click to choose calibration points.">
            {previewUrl && <img ref={imageRef} src={previewUrl} alt={selected.name} draggable={false} />}
            <svg viewBox={`0 0 ${selected.width} ${selected.height}`} aria-hidden="true">
              {overlay.map((line) => <line key={`${line.axis}-${line.index}`} className={line.major ? "major" : ""} x1={line.start.x} y1={line.start.y} x2={line.end.x} y2={line.end.y} />)}
              {points.slice(0, wizard ? 3 : 2).map((point, index) => <g key={index}><circle cx={point.x} cy={point.y} r={Math.max(4, Math.min(selected.width, selected.height) / 80)} /><text x={point.x} y={point.y}>{index === 0 ? "A" : index === 1 ? "B" : "V"}</text></g>)}
            </svg>
          </div>
          <div className="point-editor"><strong>Reference points</strong>{[0, 1, ...(wizard ? [2] : [])].map((index) => <fieldset key={index}><legend>{index === 0 ? "A" : index === 1 ? "B" : "Verify"}</legend><label>X<input type="number" value={points[index]?.x ?? ""} onChange={(event) => updatePoint(index, "x", Number(event.target.value))} /></label><label>Y<input type="number" value={points[index]?.y ?? ""} onChange={(event) => updatePoint(index, "y", Number(event.target.value))} /></label></fieldset>)}</div>
          {selected.kind === "battlemap" ? <div className="grid-wizard">
            {!wizard && <><h3>1. Measure the printed grid</h3><p>Click two grid intersections, enter how many cells lie between them, and derive the overlay.</p><div className="wizard-fields"><label>Cells between<input type="number" min="1" max="500" value={cellsBetween} onChange={(event) => setCellsBetween(Number(event.target.value))} /></label><label>Reference direction<select value={axis} onChange={(event) => setAxis(event.target.value as typeof axis)}><option value="horizontal">Horizontal row</option><option value="vertical">Vertical column</option></select></label><label>Distance per cell<input type="number" min="0.01" step="0.5" value={distancePerCell} onChange={(event) => setDistancePerCell(Number(event.target.value))} /></label></div><button disabled={busy || points.length < 2} onClick={startWizard}>Align grid</button></>}
            {wizard && <><h3>2. Refine and verify</h3><dl className="calibration-readout"><div><dt>Cell</dt><dd>{wizard.calibration.cellSizePx.toFixed(2)} px</dd></div><div><dt>Origin</dt><dd>{wizard.calibration.origin.x.toFixed(1)}, {wizard.calibration.origin.y.toFixed(1)}</dd></div><div><dt>Rotation</dt><dd>{(wizard.calibration.rotationRadians * 180 / Math.PI).toFixed(2)}°</dd></div></dl><div className="nudge-grid"><button onClick={() => wizardAction({ action: "adjust", adjustment: { originDelta: { x: -1, y: 0 } } })}>Grid left</button><button onClick={() => wizardAction({ action: "adjust", adjustment: { originDelta: { x: 1, y: 0 } } })}>Grid right</button><button onClick={() => wizardAction({ action: "adjust", adjustment: { originDelta: { x: 0, y: -1 } } })}>Grid up</button><button onClick={() => wizardAction({ action: "adjust", adjustment: { originDelta: { x: 0, y: 1 } } })}>Grid down</button><button onClick={() => wizardAction({ action: "adjust", adjustment: { cellSizeDeltaPx: -.5 } })}>Smaller cells</button><button onClick={() => wizardAction({ action: "adjust", adjustment: { cellSizeDeltaPx: .5 } })}>Larger cells</button><button onClick={() => wizardAction({ action: "adjust", adjustment: { rotationDeltaRadians: -Math.PI / 1800 } })}>Rotate left</button><button onClick={() => wizardAction({ action: "adjust", adjustment: { rotationDeltaRadians: Math.PI / 1800 } })}>Rotate right</button><button onClick={() => wizardAction({ action: "undo" })}>Undo</button><button onClick={() => wizardAction({ action: "redo" })}>Redo</button></div><p>Click a third known grid intersection, then verify it.</p><button disabled={busy || points.length < 3} onClick={() => wizardAction({ action: "verify", imagePoint: points[2] })}>Verify point</button>{wizard.verification && <p className={wizard.verification.accepted ? "verification accepted" : "verification rejected"}>{wizard.verification.accepted ? `Aligned within ${wizard.verification.errorPx.toFixed(2)} px.` : `Off by ${wizard.verification.errorPx.toFixed(2)} px; refine and try again.`}</p>}<button className="save-map" disabled={busy || !wizard.verification?.accepted} onClick={completeWizard}>Save calibrated grid</button></>}
          </div> : <div className="grid-wizard"><h3>Set {selected.kind} scale</h3><p>Choose two points whose real-world distance you know.</p><div className="wizard-fields"><label>Known distance<input type="number" min="0.01" value={knownDistance} onChange={(event) => setKnownDistance(Number(event.target.value))} /></label><label>Unit<input value={unit} onChange={(event) => setUnit(event.target.value)} maxLength={32} /></label></div><button disabled={busy || points.length < 2} onClick={saveScale}>Save map scale</button></div>}
        </div>}
      </div>}
      {maps.length === 0 && <p className="map-empty">No maps uploaded yet.</p>}
    </section>
    <ViewerControls gmToken={gmToken} {...(selected ? { map: {
      assetId: selected.id,
      width: selected.width,
      height: selected.height,
      altText: selected.name,
      calibration: selected.calibration,
      scale: selected.scale,
      ...(previewUrl ? { previewUrl } : {})
    } } : {})} />
  </>;
}
