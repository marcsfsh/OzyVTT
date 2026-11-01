import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Menu, MenuItem, SegmentedControl, Select, StatusLamp, useToast } from "@vtt/ui";
import { formatDay } from "../lib/formatWhen";
import { ScreenPicture } from "./ScreenPicture";
import type { Presentation } from "./ViewerApp";
import { useConfirm } from "../components/feedback";
import { HOST_PATHS } from "@vtt/api-contract";
import { apiRequest } from "../lib/api";
import { newId } from "../lib/ids";
import { clampPoint, imagePointFromClient, useAuthorizedMapImage } from "../scene/mapImage";
import { PairScreenForm } from "./PairScreenForm";
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
type ViewerMap = Readonly<{
  assetId: string;
  width: number;
  height: number;
  altText: string;
  calibration?: Readonly<{ calibration: Readonly<{ cellSizePx: number; distancePerCell: number }> }> | null;
  scale?: Readonly<{ distancePerPixel: number; unit: string }> | null;
}>;

type ViewerControlsProps = Readonly<{
  gmToken: string;
  map?: ViewerMap;
  /** Opens the GM's preview of the table screen, drawn at the screen's own proportions. */
  onPreview?: () => void;
}>;
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

export function ViewerControls({ gmToken, map, onPreview }: ViewerControlsProps) {
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [viewers, setViewers] = useState<readonly ViewerMetadata[]>([]);
  const [connections, setConnections] = useState<readonly ViewerConnection[]>([]);
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
  // The presented map's own image, for the screens' pictures.
  const presentedImage = useAuthorizedMapImage(presentation?.activeMap?.assetId ?? null, gmToken);
  const { confirm, dialog } = useConfirm();
  const { toast } = useToast();
  const suggestedLabel = useMemo(() => measurementLabel(map, draftPoints), [map, draftPoints]);
  const viewerUrl = selectedViewerUrl || viewerUrls[0] || `${window.location.origin}/viewer.html`;

  const refresh = useCallback(async () => {
    const [state, access, addresses] = await Promise.all([
      apiRequest<{ presentation: Presentation }>("/api/v1/viewer/presentation", { token: gmToken }),
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
    if (!presentation) throw new Error("The table screen is still loading. Try again in a moment.");
    await apiRequest("/api/v1/viewer/presentation/commands", {
      token: gmToken,
      body: { id: newId(), expectedRevision: presentation.revision, payload }
    });
  };
  const connectedIds = new Set(connections.map((connection) => connection.viewerId));
  const mapIsPresented = Boolean(map && presentation?.enabled && presentation.activeMap?.assetId === map.assetId);
  const presentationHasMap = Boolean(presentation?.enabled && presentation.activeMap);
  const requiredPointCount = tool === "measure" ? 2 : 1;
  /* One primary at a time, the next step: pair a screen, then present a map, then point at things on it. */
  const step: "pair" | "present" | "point" =
    connections.length === 0 ? "pair" : mapIsPresented ? "point" : map ? "present" : "pair";
  const screens = connections.length === 1 ? "1 screen connected" : `${connections.length || "No"} screens connected`;

  const choosePoint = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!map || !previewUrl || busy || !svgRef.current) return;
    // The preview box is larger than the letterboxed map; ignore clicks outside the map, with no
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
      if (!mapIsPresented) throw new Error("Present this map first. These tools work on the map the screen shows.");
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
      toast(tool === "focus" ? "The screen is focused there." : tool === "ping" ? "Ping sent." : "Measurement shown.", {
        tone: "success"
      });
    });
  const copy = async (value: string, confirmation: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast(confirmation, { tone: "success" });
    } catch {
      toast("The browser blocked the copy. Select the address and copy it yourself.", { tone: "error" });
    }
  };

  const lastSeen = (viewer: ViewerMetadata) =>
    viewer.lastUsedAt ? `Last seen ${formatDay(viewer.lastUsedAt)}` : "Not connected yet";
  const paired = viewers
    .filter((viewer) => !viewer.revokedAt)
    .sort((left, right) => Number(connectedIds.has(right.id)) - Number(connectedIds.has(left.id)));
  const present = () =>
    void run(() =>
      command({
        type: "viewer.presentation.begin",
        assetId: map!.assetId,
        altText: map!.altText,
        camera: { center: { x: map!.width / 2, y: map!.height / 2 }, zoom: 1 }
      })
    );
  const showInstead = () =>
    void run(() =>
      command({
        type: "viewer.map.set",
        assetId: map!.assetId,
        altText: map!.altText,
        camera: { center: { x: map!.width / 2, y: map!.height / 2 }, zoom: 1 }
      })
    );
  const revoke = async (viewer: ViewerMetadata) => {
    if (
      await confirm({
        title: `Revoke ${viewer.name}?`,
        body: "The screen loses access now and shows nothing more until it is paired again.",
        confirmLabel: "Revoke",
        danger: true
      })
    )
      void run(async () => {
        await apiRequest(`/api/v1/viewer/access/${viewer.id}`, { token: gmToken, method: "DELETE" });
      });
  };
  const onTheScreen = presentationHasMap ? (presentation?.activeMap?.altText ?? map?.altText ?? "A map") : null;

  return (
    <section
      className="viewer-controls pane-frame pane-scene frame-col anim-view"
      aria-labelledby="viewer-controls-title"
    >
      <header className="viewer-controls-heading">
        <div className="viewer-controls-title">
          <h2 id="viewer-controls-title">Table screen</h2>
          <p>Paired screens show the map you present, with only what players can see on it.</p>
        </div>
        <div className="viewer-controls-status">
          <SharedScreenSwitch current="display" />
          <strong className={connections.length ? "online" : ""} role="status">
            {screens}
          </strong>
        </div>
      </header>

      <div className="viewer-controls-body scroll-y frame-fill">
        {/* What is on the screen, as one bar (table screen spec 2.3). */}
        <section className="viewer-onscreen" aria-label="On the screen">
          <span className="viewer-onscreen-eyebrow">On the screen</span>
          <StatusLamp lit={presentationHasMap} />
          <b className="viewer-onscreen-state">{presentationHasMap ? "ON" : "Paused"}</b>
          <span className="viewer-onscreen-map">
            {onTheScreen ? (
              <>
                <b>{onTheScreen}</b> {mapIsPresented ? "· the map you have open" : "· presented"}
              </>
            ) : (
              "Nothing is presented"
            )}
          </span>
          <span className="viewer-onscreen-grow" />
          {presentationHasMap ? (
            <Button
              variant="secondary"
              disabled={busy || !presentation}
              onClick={() => void run(() => command({ type: "viewer.enabled.set", enabled: false }))}
            >
              Pause the table screen
            </Button>
          ) : (
            map && (
              <Button
                variant={step === "present" ? "primary" : "secondary"}
                disabled={busy || !presentation}
                onClick={present}
              >
                Present {map.altText}
              </Button>
            )
          )}
          <Menu trigger="Present a map" label="Present a map" align="end">
            <MenuItem disabled={busy || !map || presentationHasMap} onClick={present}>
              {map ? `Present ${map.altText}` : "Present a map"}
            </MenuItem>
            <MenuItem disabled={busy || !presentation?.enabled || !map || mapIsPresented} onClick={showInstead}>
              {mapIsPresented
                ? "This map is on the screen"
                : map
                  ? `Show ${map.altText} instead`
                  : "Show this map instead"}
            </MenuItem>
            {onPreview && <MenuItem onClick={onPreview}>Preview the screen</MenuItem>}
          </Menu>
        </section>

        {/* The screens as cards, connected first, then Pair another screen. */}
        <ul className="viewer-screens" aria-label="Paired screens">
          {paired.map((viewer) => {
            const connection = connections.find((entry) => entry.viewerId === viewer.id);
            return (
              <li key={viewer.id} className="viewer-screen-card">
                <ScreenCardPicture
                  connected={connection !== undefined}
                  presentation={presentation}
                  mapImageUrl={presentedImage.status === "ready" ? presentedImage.url : null}
                  token={gmToken}
                />
                <div className="viewer-screen-row">
                  <StatusLamp lit={connection !== undefined} />
                  <span className="viewer-screen-text">
                    <strong>{viewer.name}</strong>
                    <span>{connection ? `Connected · ${SOUND_WORDS[connection.sound]}` : lastSeen(viewer)}</span>
                  </span>
                  <Button size="sm" variant="destructive" disabled={busy} onClick={() => void revoke(viewer)}>
                    Revoke
                  </Button>
                </div>
              </li>
            );
          })}
          <li className="viewer-screen-card is-pair">
            <h3>Pair another screen</h3>
            <p>Open this address on the screen. It shows a six-digit code; type it here.</p>
            <div className="viewer-address">
              {viewerUrls.length > 1 ? (
                <Select
                  aria-label="Table screen address"
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
              <Button variant="secondary" onClick={() => void copy(viewerUrl, "Address copied.")}>
                Copy address
              </Button>
            </div>
            <PairScreenForm
              gmToken={gmToken}
              primary={step === "pair"}
              onPaired={() => void refresh().catch(() => {})}
            />
            <Button variant="secondary" disabled={busy} onClick={() => window.open("/viewer.html", "vtt-table-viewer")}>
              Open a screen here
            </Button>
          </li>
        </ul>

        <section
          className="viewer-col viewer-col-tools"
          aria-labelledby={map ? "viewer-tools-title" : undefined}
          aria-label={map ? undefined : "Live presentation tools"}
        >
          {!map && (
            <p className="viewer-no-map-notice" role="status">
              Upload or pick a map in <strong>Encounters</strong> to present it here. Focus, ping and measure work on
              the map the screen shows.
            </p>
          )}
          {map && (
            <>
              <div className="viewer-tools-head">
                <h3 id="viewer-tools-title">Focus, ping and measure</h3>
                <p>
                  {mapIsPresented
                    ? "Choose a point on the map, then send it to every paired screen."
                    : "Present this map to use these tools."}
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
                  aria-label="The presented map. Click a point, or type its coordinates in the fields below."
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
                  variant={step === "point" ? "primary" : "secondary"}
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
      </div>
      {dialog}
    </section>
  );
}

/** A screen card's picture: what the screens show at the card's width, or Not connected where it would be. */
function ScreenCardPicture({
  connected,
  presentation,
  mapImageUrl,
  token
}: Readonly<{ connected: boolean; presentation: Presentation | null; mapImageUrl: string | null; token: string }>) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={box} className="viewer-screen-picture">
      {!connected ? (
        <p className="viewer-screen-off">Not connected</p>
      ) : width > 0 ? (
        <ScreenPicture presentation={presentation} mapImageUrl={mapImageUrl} token={token} width={width} />
      ) : null}
    </div>
  );
}
