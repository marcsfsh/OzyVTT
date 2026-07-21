import { useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "../components/feedback";
import { newId } from "../lib/ids";
import { clampPoint, imagePointFromClient } from "../scene/mapImage";
import "./viewer-controls.css";

type Point = Readonly<{ x: number; y: number }>;
type ViewerMetadata = Readonly<{ id: string; name: string; createdAt: string; expiresAt: string | null; lastUsedAt: string | null; revokedAt: string | null }>;
type ViewerConnection = Readonly<{ connectionId: string; viewerId: string; name: string; connectedAt: string }>;
type PresentationSummary = Readonly<{
  revision: number;
  enabled: boolean;
  activeMap: Readonly<{ assetId: string }> | null;
  camera: Readonly<{ center: Point; zoom: number }> | null;
  measurement: Readonly<{ points: readonly Point[]; distanceLabel: string }> | null;
}>;
type ViewerMap = Readonly<{
  assetId: string;
  width: number;
  height: number;
  altText: string;
  previewUrl?: string;
  calibration?: Readonly<{ calibration: Readonly<{ cellSizePx: number; distancePerCell: number }> }> | null;
  scale?: Readonly<{ distancePerPixel: number; unit: string }> | null;
}>;

type ViewerControlsProps = Readonly<{ gmToken: string; map?: ViewerMap }>;
type PresentationTool = "focus" | "ping" | "measure";

async function api(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(path, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "Viewer request failed.");
  return body;
}

const rounded = (value: number) => Math.round(value * 100) / 100;

function measurementLabel(map: ViewerMap | undefined, points: readonly Point[]) {
  if (!map || points.length < 2) return "";
  const pixels = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  if (map.scale) return `${rounded(pixels * map.scale.distancePerPixel)} ${map.scale.unit}`;
  if (map.calibration) return `${rounded(pixels / map.calibration.calibration.cellSizePx * map.calibration.calibration.distancePerCell)} ft`;
  return `${rounded(pixels)} px`;
}

export function ViewerControls({ gmToken, map }: ViewerControlsProps) {
  const [presentation, setPresentation] = useState<PresentationSummary | null>(null);
  const [viewers, setViewers] = useState<readonly ViewerMetadata[]>([]);
  const [connections, setConnections] = useState<readonly ViewerConnection[]>([]);
  const [pairing, setPairing] = useState<Readonly<{ code: string; expiresAt: string }> | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<PresentationTool>("ping");
  const [draftPoints, setDraftPoints] = useState<readonly Point[]>([]);
  const [zoom, setZoom] = useState(1);
  const [labelOverride, setLabelOverride] = useState("");
  const [viewerUrls, setViewerUrls] = useState<readonly string[]>([]);
  const [selectedViewerUrl, setSelectedViewerUrl] = useState("");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const { confirm, dialog } = useConfirm();
  const suggestedLabel = useMemo(() => measurementLabel(map, draftPoints), [map, draftPoints]);
  const viewerUrl = selectedViewerUrl || viewerUrls[0] || `${window.location.origin}/viewer.html`;

  const refresh = async () => {
    const [state, access, addresses] = await Promise.all([
      api("/api/v1/viewer/presentation", gmToken),
      api("/api/v1/viewer/access", gmToken),
      api("/api/gm/viewer-urls", gmToken)
    ]);
    setPresentation(state.presentation); setViewers(access.viewers); setConnections(access.connections);
    const availableUrls = addresses.viewerUrls.length ? addresses.viewerUrls : [`${window.location.origin}/viewer.html`];
    setViewerUrls(availableUrls);
    setSelectedViewerUrl((current) => current && availableUrls.includes(current) ? current : availableUrls.find((url: string) => !url.includes("localhost")) ?? availableUrls[0]);
  };
  useEffect(() => {
    void refresh().catch((error) => setMessage(error.message));
    const interval = window.setInterval(() => void refresh().catch(() => {}), 5_000);
    return () => window.clearInterval(interval);
  }, [gmToken]);
  useEffect(() => { setDraftPoints([]); setLabelOverride(""); }, [map?.assetId, tool]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setMessage("");
    try { await operation(); await refresh(); }
    catch (error) { setMessage((error as Error).message); await refresh().catch(() => {}); }
    finally { setBusy(false); }
  };
  const command = async (payload: Record<string, unknown>) => {
    if (!presentation) throw new Error("Viewer presentation state is still loading.");
    return api("/api/v1/viewer/presentation/commands", gmToken, { method: "POST", body: JSON.stringify({ id: newId(), expectedRevision: presentation.revision, payload }) });
  };
  const connectedIds = new Set(connections.map((connection) => connection.viewerId));
  const mapIsPresented = Boolean(map && presentation?.enabled && presentation.activeMap?.assetId === map.assetId);
  const presentationHasMap = Boolean(presentation?.enabled && presentation.activeMap);
  const requiredPointCount = tool === "measure" ? 2 : 1;

  const choosePoint = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!map || !map.previewUrl || busy || !svgRef.current) return;
    const raw = imagePointFromClient(svgRef.current, event.clientX, event.clientY);
    if (!raw) return;
    const point = clampPoint(raw, map.width, map.height);
    setDraftPoints((current) => tool === "measure" && current.length === 1 ? [current[0], point] : [point]);
  };
  const updatePoint = (index: number, coordinate: "x" | "y", value: number) => setDraftPoints((current) => {
    const next = [...current];
    next[index] = { ...(next[index] ?? { x: 0, y: 0 }), [coordinate]: Number.isFinite(value) ? value : 0 };
    return next;
  });
  const sendTool = () => void run(async () => {
    if (!mapIsPresented) throw new Error("Present this map before using viewer tools.");
    if (draftPoints.length < requiredPointCount) throw new Error(`Choose ${requiredPointCount === 1 ? "a point" : "two points"} on the map first.`);
    if (tool === "focus") await command({ type: "viewer.camera.set", camera: { center: draftPoints[0], zoom } });
    else if (tool === "ping") await command({ type: "viewer.ping", id: newId(), point: draftPoints[0], durationMs: 5_000 });
    else await command({ type: "viewer.measurement.set", measurement: { id: newId(), points: draftPoints.slice(0, 2), distanceLabel: labelOverride.trim() || suggestedLabel } });
    setMessage(tool === "focus" ? "Viewer focused." : tool === "ping" ? "Ping sent." : "Measurement shown.");
  });
  const copy = async (value: string, confirmation: string) => {
    try { await navigator.clipboard.writeText(value); setMessage(confirmation); }
    catch { setMessage("Copy was blocked by the browser. Select and copy the value manually."); }
  };

  return <section className="viewer-controls" aria-labelledby="viewer-controls-title">
    <div className="viewer-controls-heading"><div><span>SHARED DISPLAY</span><h2 id="viewer-controls-title">Table viewer</h2></div><strong className={connections.length ? "online" : ""}>{connections.length} connected</strong></div>
    <p>Only explicitly presented, player-safe information appears on paired televisions and projectors.</p>
    <div className="viewer-address"><span>Second-screen address</span>{viewerUrls.length > 1 ? <select aria-label="Second-screen network address" value={viewerUrl} onChange={(event) => setSelectedViewerUrl(event.target.value)}>{viewerUrls.map((url) => <option key={url} value={url}>{url}</option>)}</select> : <code>{viewerUrl}</code>}<button onClick={() => void copy(viewerUrl, "Viewer address copied.")}>Copy address</button></div>
    {!map && <p className="viewer-no-map-notice" role="status">Choose a map on the <strong>Maps</strong> tab first to present it here and unlock the focus/ping/measure tools below.</p>}
    <div className="viewer-control-actions">
      <button disabled={busy} onClick={() => window.open("/viewer.html", "vtt-table-viewer")}>Open viewer here</button>
      <button disabled={busy} onClick={() => void run(async () => { const body = await api("/api/v1/viewer/pairings", gmToken, { method: "POST", body: "{}" }); setPairing(body.pairing); })}>Create pairing code</button>
      <button disabled={busy || !presentation || (!presentationHasMap && !map)} onClick={() => void run(() => presentationHasMap
        ? command({ type: "viewer.enabled.set", enabled: false }).then(() => undefined)
        : command({ type: "viewer.presentation.begin", assetId: map!.assetId, altText: map!.altText, camera: { center: { x: map!.width / 2, y: map!.height / 2 }, zoom: 1 } }).then(() => undefined)
      )}>{presentationHasMap ? "Pause presentation" : map ? `Present ${map.altText}` : "Select a map to present"}</button>
      <button disabled={busy || !presentation?.enabled || !map || mapIsPresented} onClick={() => void run(() => command({ type: "viewer.map.set", assetId: map!.assetId, altText: map!.altText, camera: { center: { x: map!.width / 2, y: map!.height / 2 }, zoom: 1 } }).then(() => undefined))}>{mapIsPresented ? "Current map is live" : "Switch viewer to current map"}</button>
    </div>
    {pairing && <div className="viewer-pairing-code" role="status"><span>PAIRING CODE</span><strong className="tabular">{pairing.code}</strong><small>Expires <span className="tabular">{new Date(pairing.expiresAt).toLocaleTimeString()}</span></small><button onClick={() => void copy(pairing.code, "Pairing code copied.")}>Copy code</button></div>}

    {map && <section className="viewer-tools" aria-labelledby="viewer-tools-title">
      <div><span className="viewer-tools-eyebrow">LIVE PRESENTATION TOOLS</span><h3 id="viewer-tools-title">Focus, ping, and measure</h3><p>{mapIsPresented ? "Click the map, then send the selected action to every paired display." : "Present the current map to enable these tools."}</p></div>
      <div className="viewer-tool-tabs" role="group" aria-label="Presentation tool">
        {(["focus", "ping", "measure"] as const).map((candidate) => <button key={candidate} aria-pressed={tool === candidate} onClick={() => setTool(candidate)}>{candidate === "focus" ? "Focus view" : candidate === "ping" ? "Ping point" : "Measure line"}</button>)}
      </div>
      {map.previewUrl && <div className="viewer-tool-preview"><div className="viewer-tool-image" onClick={choosePoint} aria-label="Viewer presentation map. Click to choose a point; coordinate fields below are the keyboard alternative.">
        <svg ref={svgRef} viewBox={`0 0 ${map.width} ${map.height}`} width={map.width} height={map.height} preserveAspectRatio="xMidYMid meet">
          <image href={map.previewUrl} width={map.width} height={map.height} role="img" aria-label="" />
          {tool === "measure" && draftPoints.length === 2 && <line x1={draftPoints[0].x} y1={draftPoints[0].y} x2={draftPoints[1].x} y2={draftPoints[1].y} />}
          {draftPoints.map((point, index) => <g key={index}><circle cx={point.x} cy={point.y} r={Math.max(5, Math.min(map.width, map.height) / 70)} /><text x={point.x} y={point.y}>{tool === "measure" ? (index ? "B" : "A") : "●"}</text></g>)}
        </svg>
      </div></div>}
      <div className="viewer-tool-fields">
        {Array.from({ length: requiredPointCount }, (_, index) => <fieldset key={index}><legend>{tool === "measure" ? (index ? "End B" : "Start A") : "Point"}</legend><label>X<input type="number" min="0" max={map.width} value={draftPoints[index]?.x ?? ""} onChange={(event) => updatePoint(index, "x", Number(event.target.value))} /></label><label>Y<input type="number" min="0" max={map.height} value={draftPoints[index]?.y ?? ""} onChange={(event) => updatePoint(index, "y", Number(event.target.value))} /></label></fieldset>)}
        {tool === "focus" && <label>Zoom<input type="number" min="0.1" max="8" step="0.1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>}
        {tool === "measure" && <label>Displayed distance<input value={labelOverride} onChange={(event) => setLabelOverride(event.target.value)} maxLength={64} placeholder={suggestedLabel || "Choose two points"} /></label>}
      </div>
      <div className="viewer-tool-actions"><button disabled={busy || !mapIsPresented || draftPoints.length < requiredPointCount} onClick={sendTool}>{tool === "focus" ? "Send focus" : tool === "ping" ? "Send ping" : "Show measurement"}</button>{tool === "measure" && <button disabled={busy || !presentation?.measurement} onClick={() => void run(() => command({ type: "viewer.measurement.clear" }))}>Clear measurement</button>}</div>
    </section>}

    {message && <p className="viewer-control-feedback" role="status">{message}</p>}
    {viewers.length > 0 && <div className="viewer-access-list"><h3>Paired displays</h3><ul>{viewers.map((viewer) => <li key={viewer.id}>
      <div><strong>{viewer.name}</strong><span>{viewer.revokedAt ? "Revoked" : connectedIds.has(viewer.id) ? "Connected" : "Offline"}</span></div>
      {!viewer.revokedAt && <button disabled={busy} onClick={async () => { if (await confirm({ title: `Revoke ${viewer.name}?`, body: "This display immediately loses access and stops receiving updates.", confirmLabel: "Revoke", danger: true })) void run(async () => { await api(`/api/v1/viewer/access/${viewer.id}`, gmToken, { method: "DELETE" }); }); }}>Revoke</button>}
    </li>)}</ul></div>}
    {dialog}
  </section>;
}
