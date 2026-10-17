import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Eyebrow, SegmentedControl, Select, useToast } from "@vtt/ui";
import { useConfirm } from "../components/feedback";
import { HOST_PATHS } from "@vtt/api-contract";
import { apiRequest } from "../lib/api";
import { newId } from "../lib/ids";
import { clampPoint, imagePointFromClient, useAuthorizedMapImage } from "../scene/mapImage";
import { SharedScreenSwitch } from "./SharedScreenSwitch";
import "./viewer-controls.css";

type Point = Readonly<{ x: number; y: number }>;
type ViewerMetadata = Readonly<{
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}>;
type ViewerConnection = Readonly<{
  connectionId: string;
  viewerId: string;
  name: string;
  connectedAt: string;
  /** Whether the screen may play sound, or waits for someone to tap it. */
  sound: "on" | "blocked" | "muted" | "unknown";
}>;
const SOUND_WORDS: Readonly<Record<ViewerConnection["sound"], string>> = {
  on: "Sound on",
  blocked: "Sound waits for a tap on the screen",
  muted: "Preview, no sound",
  unknown: "Checking sound"
};
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
  calibration?: Readonly<{ calibration: Readonly<{ cellSizePx: number; distancePerCell: number }> }> | null;
  scale?: Readonly<{ distancePerPixel: number; unit: string }> | null;
}>;

type ViewerControlsProps = Readonly<{ gmToken: string; map?: ViewerMap }>;
type PresentationTool = "focus" | "ping" | "measure";

type AccessList = Readonly<{ viewers: readonly ViewerMetadata[]; connections: readonly ViewerConnection[] }>;

const rounded = (value: number) => Math.round(value * 100) / 100;

function measurementLabel(map: ViewerMap | undefined, points: readonly Point[]) {
  if (!map || points.length < 2) return "";
  const pixels = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  if (map.scale) return `${rounded(pixels * map.scale.distancePerPixel)} ${map.scale.unit}`;
  if (map.calibration)
    return `${rounded((pixels / map.calibration.calibration.cellSizePx) * map.calibration.calibration.distancePerCell)} ft`;
  return `${rounded(pixels)} px`;
}

export function ViewerControls({ gmToken, map }: ViewerControlsProps) {
  const [presentation, setPresentation] = useState<PresentationSummary | null>(null);
  const [viewers, setViewers] = useState<readonly ViewerMetadata[]>([]);
  const [connections, setConnections] = useState<readonly ViewerConnection[]>([]);
  const [pairing, setPairing] = useState<Readonly<{ code: string; expiresAt: string }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<PresentationTool>("ping");
  const [draftPoints, setDraftPoints] = useState<readonly Point[]>([]);
  const [zoom, setZoom] = useState(1);
  const [labelOverride, setLabelOverride] = useState("");
  const [viewerUrls, setViewerUrls] = useState<readonly string[]>([]);
  const [selectedViewerUrl, setSelectedViewerUrl] = useState("");
  const svgRef = useRef<SVGSVGElement | null>(null);
  // The map's own image, so the click surface works whether or not the maps library was opened.
  const image = useAuthorizedMapImage(map?.assetId ?? null, gmToken);
  const previewUrl = image.status === "ready" ? image.url : null;
  const { confirm, dialog } = useConfirm();
  const { toast } = useToast();
  const suggestedLabel = useMemo(() => measurementLabel(map, draftPoints), [map, draftPoints]);
  const viewerUrl = selectedViewerUrl || viewerUrls[0] || `${window.location.origin}/viewer.html`;

  const refresh = useCallback(async () => {
    const [state, access, addresses] = await Promise.all([
      apiRequest<{ presentation: PresentationSummary }>("/api/v1/viewer/presentation", { token: gmToken }),
      apiRequest<AccessList>("/api/v1/viewer/access", { token: gmToken }),
      apiRequest<{ viewerUrls: readonly string[] }>(HOST_PATHS.viewerUrls, { token: gmToken })
    ]);
    setPresentation(state.presentation);
    setViewers(access.viewers);
    setConnections(access.connections);
    const availableUrls = addresses.viewerUrls.length
      ? addresses.viewerUrls
      : [`${window.location.origin}/viewer.html`];
    setViewerUrls(availableUrls);
    setSelectedViewerUrl((current) =>
      current && availableUrls.includes(current)
        ? current
        : (availableUrls.find((url) => !url.includes("localhost")) ?? availableUrls[0])
    );
  }, [gmToken]);
  useEffect(() => {
    void refresh().catch((error: Error) => toast(error.message, { tone: "error" }));
    const interval = window.setInterval(() => void refresh().catch(() => {}), 5_000);
    return () => window.clearInterval(interval);
  }, [refresh, toast]);
  useEffect(() => {
    setDraftPoints([]);
    setLabelOverride("");
  }, [map?.assetId, tool]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    try {
      await operation();
      await refresh();
    } catch (error) {
      toast((error as Error).message, { tone: "error" });
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  const command = async (payload: Record<string, unknown>) => {
    if (!presentation) throw new Error("Viewer presentation state is still loading.");
    await apiRequest("/api/v1/viewer/presentation/commands", {
      token: gmToken,
      body: { id: newId(), expectedRevision: presentation.revision, payload }
    });
  };
  const connectedIds = new Set(connections.map((connection) => connection.viewerId));
  const mapIsPresented = Boolean(map && presentation?.enabled && presentation.activeMap?.assetId === map.assetId);
  const presentationHasMap = Boolean(presentation?.enabled && presentation.activeMap);
  const requiredPointCount = tool === "measure" ? 2 : 1;

  const choosePoint = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!map || !previewUrl || busy || !svgRef.current) return;
    // The preview box is larger than the letterboxed map; ignore clicks outside the map rather than
    // clamping them onto the nearest edge.
    if (!(event.target instanceof Node) || !svgRef.current.contains(event.target)) return;
    const raw = imagePointFromClient(svgRef.current, event.clientX, event.clientY);
    if (!raw) return;
    const point = clampPoint(raw, map.width, map.height);
    setDraftPoints((current) => (tool === "measure" && current.length === 1 ? [current[0], point] : [point]));
  };
  const updatePoint = (index: number, coordinate: "x" | "y", value: number) =>
    setDraftPoints((current) => {
      const next = [...current];
      next[index] = { ...(next[index] ?? { x: 0, y: 0 }), [coordinate]: Number.isFinite(value) ? value : 0 };
      return next;
    });
  const sendTool = () =>
    void run(async () => {
      if (!mapIsPresented) throw new Error("Present this map before using viewer tools.");
      if (draftPoints.length < requiredPointCount)
        throw new Error(`Choose ${requiredPointCount === 1 ? "a point" : "two points"} on the map first.`);
      if (tool === "focus") await command({ type: "viewer.camera.set", camera: { center: draftPoints[0], zoom } });
      else if (tool === "ping")
        await command({ type: "viewer.ping", id: newId(), point: draftPoints[0], durationMs: 5_000 });
      else
        await command({
          type: "viewer.measurement.set",
          measurement: {
            id: newId(),
            points: draftPoints.slice(0, 2),
            distanceLabel: labelOverride.trim() || suggestedLabel
          }
        });
      toast(tool === "focus" ? "Viewer focused." : tool === "ping" ? "Ping sent." : "Measurement shown.", {
        tone: "success"
      });
    });
  const copy = async (value: string, confirmation: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast(confirmation, { tone: "success" });
    } catch {
      toast("Copy was blocked by the browser. Select and copy the value manually.", { tone: "error" });
    }
  };

  /* At 1280px+ the body becomes two columns: the map preview (the tools column's flex-fill canvas, so
     it stays visible beside its coordinate fields) and the access column. */
  return (
    <section
      className="viewer-controls pane-frame pane-scene scanlines frame-col anim-view"
      aria-labelledby="viewer-controls-title"
    >
      <div className="pane-sky" aria-hidden="true" />
      <header className="viewer-controls-heading neon-beam">
        <div className="viewer-controls-title">
          <Eyebrow>Shared display</Eyebrow>
          <h2 id="viewer-controls-title">Table viewer</h2>
          <p>Only explicitly presented, player-safe information appears on paired televisions and projectors.</p>
        </div>
        <div className="viewer-controls-status">
          <SharedScreenSwitch current="display" />
          <strong className={connections.length ? "online" : ""}>{connections.length} connected</strong>
        </div>
      </header>

      <div className="viewer-controls-body scroll-y frame-fill">
        <section
          className="viewer-col viewer-col-tools surface-glass"
          aria-labelledby={map ? "viewer-tools-title" : undefined}
          aria-label={map ? undefined : "Live presentation tools"}
        >
          {!map && (
            <p className="viewer-no-map-notice" role="status">
              Choose a map on the <strong>Maps</strong> tab first to present it here and unlock the focus/ping/measure
              tools.
            </p>
          )}
          {map && (
            <>
              <div className="viewer-tools-head">
                <Eyebrow>Live presentation tools</Eyebrow>
                <h3 id="viewer-tools-title">Focus, ping, and measure</h3>
                <p>
                  {mapIsPresented
                    ? "Click the map, then send the selected action to every paired display."
                    : "Present the current map to enable these tools."}
                </p>
              </div>
              <SegmentedControl
                className="viewer-tool-tabs"
                ariaLabel="Presentation tool"
                value={tool}
                onChange={(value) => setTool(value as typeof tool)}
                options={[
                  { value: "focus", label: "Focus view" },
                  { value: "ping", label: "Ping point" },
                  { value: "measure", label: "Measure line" }
                ]}
              />
              {/* The preview box is the click surface; no wrapper in between, since an auto-height intermediate
              breaks the percentage chain that bounds the svg to the canvas. */}
              {previewUrl && (
                <div
                  className="viewer-tool-preview"
                  onClick={choosePoint}
                  aria-label="Viewer presentation map. Click to choose a point; coordinate fields below are the keyboard alternative."
                >
                  <svg
                    ref={svgRef}
                    viewBox={`0 0 ${map.width} ${map.height}`}
                    width={map.width}
                    height={map.height}
                    preserveAspectRatio="xMidYMid meet"
                  >
                    <image href={previewUrl} width={map.width} height={map.height} role="img" aria-label="" />
                    {tool === "measure" && draftPoints.length === 2 && (
                      <line x1={draftPoints[0].x} y1={draftPoints[0].y} x2={draftPoints[1].x} y2={draftPoints[1].y} />
                    )}
                    {draftPoints.map((point, index) => (
                      <g key={index}>
                        <circle cx={point.x} cy={point.y} r={Math.max(5, Math.min(map.width, map.height) / 70)} />
                        {tool === "measure" && (
                          <text x={point.x} y={point.y}>
                            {index ? "B" : "A"}
                          </text>
                        )}
                      </g>
                    ))}
                  </svg>
                </div>
              )}
              <div className="viewer-tool-fields">
                {Array.from({ length: requiredPointCount }, (_, index) => (
                  <fieldset key={index}>
                    <legend>{tool === "measure" ? (index ? "End B" : "Start A") : "Point"}</legend>
                    <label>
                      X
                      <input
                        type="number"
                        min="0"
                        max={map.width}
                        value={draftPoints[index]?.x ?? ""}
                        onChange={(event) => updatePoint(index, "x", Number(event.target.value))}
                      />
                    </label>
                    <label>
                      Y
                      <input
                        type="number"
                        min="0"
                        max={map.height}
                        value={draftPoints[index]?.y ?? ""}
                        onChange={(event) => updatePoint(index, "y", Number(event.target.value))}
                      />
                    </label>
                  </fieldset>
                ))}
                {tool === "focus" && (
                  <label>
                    Zoom
                    <input
                      type="number"
                      min="0.1"
                      max="8"
                      step="0.1"
                      value={zoom}
                      onChange={(event) => setZoom(Number(event.target.value))}
                    />
                  </label>
                )}
                {tool === "measure" && (
                  <label>
                    Displayed distance
                    <input
                      value={labelOverride}
                      onChange={(event) => setLabelOverride(event.target.value)}
                      maxLength={64}
                      placeholder={suggestedLabel || "Choose two points"}
                    />
                  </label>
                )}
              </div>
              <div className="viewer-tool-actions">
                <Button
                  variant="primary"
                  disabled={busy || !mapIsPresented || draftPoints.length < requiredPointCount}
                  onClick={sendTool}
                >
                  {tool === "focus" ? "Send focus" : tool === "ping" ? "Send ping" : "Show measurement"}
                </Button>
                {tool === "measure" && (
                  <Button
                    variant="secondary"
                    disabled={busy || !presentation?.measurement}
                    onClick={() => void run(() => command({ type: "viewer.measurement.clear" }))}
                  >
                    Clear measurement
                  </Button>
                )}
              </div>
            </>
          )}
        </section>

        {/* At the two-column width this column is its own scroll region; below it, it is inert. */}
        <div className="viewer-col viewer-col-access surface-glass scroll-y">
          <div className="viewer-address">
            <span>Second-screen address</span>
            {viewerUrls.length > 1 ? (
              <Select
                aria-label="Second-screen network address"
                value={viewerUrl}
                onChange={(event) => setSelectedViewerUrl(event.target.value)}
              >
                {viewerUrls.map((url) => (
                  <option key={url} value={url}>
                    {url}
                  </option>
                ))}
              </Select>
            ) : (
              <code>{viewerUrl}</code>
            )}
            <Button variant="secondary" onClick={() => void copy(viewerUrl, "Viewer address copied.")}>
              Copy address
            </Button>
          </div>
          <div className="viewer-control-actions">
            <Button variant="secondary" disabled={busy} onClick={() => window.open("/viewer.html", "vtt-table-viewer")}>
              Open viewer here
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const data = await apiRequest<{ pairing: Readonly<{ code: string; expiresAt: string }> }>(
                    "/api/v1/viewer/pairings",
                    { token: gmToken, body: {} }
                  );
                  setPairing(data.pairing);
                })
              }
            >
              Create pairing code
            </Button>
            <Button
              variant="secondary"
              disabled={busy || !presentation || (!presentationHasMap && !map)}
              onClick={() =>
                void run(() =>
                  presentationHasMap
                    ? command({ type: "viewer.enabled.set", enabled: false })
                    : command({
                        type: "viewer.presentation.begin",
                        assetId: map!.assetId,
                        altText: map!.altText,
                        camera: { center: { x: map!.width / 2, y: map!.height / 2 }, zoom: 1 }
                      })
                )
              }
            >
              {presentationHasMap ? "Pause presentation" : map ? `Present ${map.altText}` : "Select a map to present"}
            </Button>
            <Button
              variant="secondary"
              disabled={busy || !presentation?.enabled || !map || mapIsPresented}
              onClick={() =>
                void run(() =>
                  command({
                    type: "viewer.map.set",
                    assetId: map!.assetId,
                    altText: map!.altText,
                    camera: { center: { x: map!.width / 2, y: map!.height / 2 }, zoom: 1 }
                  })
                )
              }
            >
              {mapIsPresented ? "Current map is live" : "Switch viewer to current map"}
            </Button>
          </div>
          {pairing && (
            <div className="viewer-pairing-code" role="status">
              <Eyebrow>Pairing code</Eyebrow>
              <strong className="tabular">{pairing.code}</strong>
              <small>
                Expires <span className="tabular">{new Date(pairing.expiresAt).toLocaleTimeString()}</span>
              </small>
              <Button variant="secondary" onClick={() => void copy(pairing.code, "Pairing code copied.")}>
                Copy code
              </Button>
            </div>
          )}
          {viewers.length > 0 && (
            <div className="viewer-access-list">
              <h3>Paired displays</h3>
              <ul>
                {viewers.map((viewer) => (
                  <li key={viewer.id}>
                    <div>
                      <strong>{viewer.name}</strong>
                      <span>
                        {viewer.revokedAt
                          ? "Revoked"
                          : connectedIds.has(viewer.id)
                            ? `Connected · ${SOUND_WORDS[connections.find((connection) => connection.viewerId === viewer.id)!.sound]}`
                            : "Offline"}
                      </span>
                    </div>
                    {!viewer.revokedAt && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={async () => {
                          if (
                            await confirm({
                              title: `Revoke ${viewer.name}?`,
                              body: "This display immediately loses access and stops receiving updates.",
                              confirmLabel: "Revoke",
                              danger: true
                            })
                          )
                            void run(async () => {
                              await apiRequest(`/api/v1/viewer/access/${viewer.id}`, {
                                token: gmToken,
                                method: "DELETE"
                              });
                            });
                        }}
                      >
                        Revoke
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      {dialog}
    </section>
  );
}
