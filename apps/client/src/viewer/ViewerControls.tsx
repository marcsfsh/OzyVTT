import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Eyebrow, SegmentedControl, Select } from "@vtt/ui";
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
    // The click surface is the preview BOX, which is larger than the map once the map is
    // letterboxed inside it. Only a click on the map itself is a point: without this a tap on the
    // surround would be silently clamped onto the nearest edge.
    if (!(event.target instanceof Node) || !svgRef.current.contains(event.target)) return;
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

  /* THE FRAME (§7, refresh B3). The heading never moves; the body below it is the region row, and
     at the 1280 rung it spends the width on TWO columns instead of one long scroll — the map you
     are driving on the left, the screen you are driving it to on the right.

     THE PREVIEW IS PINNED VISIBLE, which is the whole point of the recompose. Measured before it:
     at 1920x1080 the preview's top sat at 650px inside a 1036px pane while its X/Y fields sat at
     1220 and the paired-display list at 1421 — so you could not see the map and type a coordinate
     for it at the same time. It is now the tools column's flex-fill canvas, and the `54vh` cap
     that stood in for one is gone. Click-to-place is untouched: `imagePointFromClient` reads the
     svg's own `getScreenCTM`, so a resized, letterboxed svg maps clicks correctly for free. */
  return <section className="viewer-controls pane-frame pane-scene scanlines frame-col anim-view" aria-labelledby="viewer-controls-title">
    <div className="pane-sky" aria-hidden="true" />
    <header className="viewer-controls-heading neon-beam">
      <div className="viewer-controls-title">
        <Eyebrow>Shared display</Eyebrow>
        <h2 id="viewer-controls-title">Table viewer</h2>
        <p>Only explicitly presented, player-safe information appears on paired televisions and projectors.</p>
      </div>
      <strong className={connections.length ? "online" : ""}>{connections.length} connected</strong>
    </header>

    <div className="viewer-controls-body scroll-y frame-fill">
      <section className="viewer-col viewer-col-tools surface-glass" aria-labelledby={map ? "viewer-tools-title" : undefined} aria-label={map ? undefined : "Live presentation tools"}>
        {!map && <p className="viewer-no-map-notice" role="status">Choose a map on the <strong>Maps</strong> tab first to present it here and unlock the focus/ping/measure tools.</p>}
        {map && <>
          <div className="viewer-tools-head">
            <Eyebrow>Live presentation tools</Eyebrow>
            <h3 id="viewer-tools-title">Focus, ping, and measure</h3>
            <p>{mapIsPresented ? "Click the map, then send the selected action to every paired display." : "Present the current map to enable these tools."}</p>
          </div>
          <SegmentedControl
            className="viewer-tool-tabs"
            ariaLabel="Presentation tool"
            value={tool}
            onChange={(value) => setTool(value as typeof tool)}
            options={[{ value: "focus", label: "Focus view" }, { value: "ping", label: "Ping point" }, { value: "measure", label: "Measure line" }]}
          />
          {/* The preview box IS the click surface — the `.viewer-tool-image` wrapper that used to sit
              between it and the svg is gone, because an auto-height intermediate breaks the
              percentage chain that lets the svg bound itself to the pinned canvas. */}
          {map.previewUrl && <div className="viewer-tool-preview" onClick={choosePoint} aria-label="Viewer presentation map. Click to choose a point; coordinate fields below are the keyboard alternative.">
            <svg ref={svgRef} viewBox={`0 0 ${map.width} ${map.height}`} width={map.width} height={map.height} preserveAspectRatio="xMidYMid meet">
              <image href={map.previewUrl} width={map.width} height={map.height} role="img" aria-label="" />
              {tool === "measure" && draftPoints.length === 2 && <line x1={draftPoints[0].x} y1={draftPoints[0].y} x2={draftPoints[1].x} y2={draftPoints[1].y} />}
              {draftPoints.map((point, index) => <g key={index}><circle cx={point.x} cy={point.y} r={Math.max(5, Math.min(map.width, map.height) / 70)} />{tool === "measure" && <text x={point.x} y={point.y}>{index ? "B" : "A"}</text>}</g>)}
            </svg>
          </div>}
          <div className="viewer-tool-fields">
            {Array.from({ length: requiredPointCount }, (_, index) => <fieldset key={index}><legend>{tool === "measure" ? (index ? "End B" : "Start A") : "Point"}</legend><label>X<input type="number" min="0" max={map.width} value={draftPoints[index]?.x ?? ""} onChange={(event) => updatePoint(index, "x", Number(event.target.value))} /></label><label>Y<input type="number" min="0" max={map.height} value={draftPoints[index]?.y ?? ""} onChange={(event) => updatePoint(index, "y", Number(event.target.value))} /></label></fieldset>)}
            {tool === "focus" && <label>Zoom<input type="number" min="0.1" max="8" step="0.1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>}
            {tool === "measure" && <label>Displayed distance<input value={labelOverride} onChange={(event) => setLabelOverride(event.target.value)} maxLength={64} placeholder={suggestedLabel || "Choose two points"} /></label>}
          </div>
          <div className="viewer-tool-actions"><Button variant="primary" disabled={busy || !mapIsPresented || draftPoints.length < requiredPointCount} onClick={sendTool}>{tool === "focus" ? "Send focus" : tool === "ping" ? "Send ping" : "Show measurement"}</Button>{tool === "measure" && <Button variant="secondary" disabled={busy || !presentation?.measurement} onClick={() => void run(() => command({ type: "viewer.measurement.clear" }))}>Clear measurement</Button>}</div>
        </>}
      </section>

      {/* The access column: where the screen is, how it pairs, and who is paired. It IS the declared
          region at the two-column rung, so a long list of paired displays scrolls itself rather than
          the surface; below the rung it rides the body's one scroller and this is inert. */}
      <div className="viewer-col viewer-col-access surface-glass scroll-y">
          <div className="viewer-address"><span>Second-screen address</span>{viewerUrls.length > 1 ? <Select aria-label="Second-screen network address" value={viewerUrl} onChange={(event) => setSelectedViewerUrl(event.target.value)}>{viewerUrls.map((url) => <option key={url} value={url}>{url}</option>)}</Select> : <code>{viewerUrl}</code>}<Button variant="secondary" onClick={() => void copy(viewerUrl, "Viewer address copied.")}>Copy address</Button></div>
          <div className="viewer-control-actions">
            <Button variant="secondary" disabled={busy} onClick={() => window.open("/viewer.html", "vtt-table-viewer")}>Open viewer here</Button>
            <Button variant="secondary" disabled={busy} onClick={() => void run(async () => { const body = await api("/api/v1/viewer/pairings", gmToken, { method: "POST", body: "{}" }); setPairing(body.pairing); })}>Create pairing code</Button>
            <Button variant="secondary" disabled={busy || !presentation || (!presentationHasMap && !map)} onClick={() => void run(() => presentationHasMap
              ? command({ type: "viewer.enabled.set", enabled: false }).then(() => undefined)
              : command({ type: "viewer.presentation.begin", assetId: map!.assetId, altText: map!.altText, camera: { center: { x: map!.width / 2, y: map!.height / 2 }, zoom: 1 } }).then(() => undefined)
            )}>{presentationHasMap ? "Pause presentation" : map ? `Present ${map.altText}` : "Select a map to present"}</Button>
            <Button variant="secondary" disabled={busy || !presentation?.enabled || !map || mapIsPresented} onClick={() => void run(() => command({ type: "viewer.map.set", assetId: map!.assetId, altText: map!.altText, camera: { center: { x: map!.width / 2, y: map!.height / 2 }, zoom: 1 } }).then(() => undefined))}>{mapIsPresented ? "Current map is live" : "Switch viewer to current map"}</Button>
          </div>
          {pairing && <div className="viewer-pairing-code" role="status"><Eyebrow>Pairing code</Eyebrow><strong className="tabular">{pairing.code}</strong><small>Expires <span className="tabular">{new Date(pairing.expiresAt).toLocaleTimeString()}</span></small><Button variant="secondary" onClick={() => void copy(pairing.code, "Pairing code copied.")}>Copy code</Button></div>}
          {message && <p className="viewer-control-feedback" role="status">{message}</p>}
          {viewers.length > 0 && <div className="viewer-access-list"><h3>Paired displays</h3><ul>{viewers.map((viewer) => <li key={viewer.id}>
            <div><strong>{viewer.name}</strong><span>{viewer.revokedAt ? "Revoked" : connectedIds.has(viewer.id) ? "Connected" : "Offline"}</span></div>
            {!viewer.revokedAt && <Button variant="secondary" size="sm" disabled={busy} onClick={async () => { if (await confirm({ title: `Revoke ${viewer.name}?`, body: "This display immediately loses access and stops receiving updates.", confirmLabel: "Revoke", danger: true })) void run(async () => { await api(`/api/v1/viewer/access/${viewer.id}`, gmToken, { method: "DELETE" }); }); }}>Revoke</Button>}
          </li>)}</ul></div>}
      </div>
    </div>
    {dialog}
  </section>;
}
