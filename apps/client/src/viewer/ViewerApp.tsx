import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input } from "@vtt/ui";
import { bandFraction, FogOverlay, probeImageDimensions, TokenGlyph, TokenHealthAura, TokenStatusBadges } from "../scene/mapImage";
import { AnnotationGlyph, PingGlyph } from "../scene/annotationGlyph";
import { InitiativeRow } from "../encounter/InitiativeList";
import "./viewer.css";

type Point = Readonly<{ x: number; y: number }>;
type ViewerAnnotation = Readonly<{ id: string; kind: "measurement" | "shape" | "ping"; shape: "circle" | "cone" | "line" | "square" | null; origin: Point; target: Point; sizeFeet: number; color: string; label: string | null }>;
export type Presentation = Readonly<{
  schemaVersion: 1;
  revision: number;
  enabled: boolean;
  activeMap: Readonly<{ assetId: string; altText: string }> | null;
  camera: Readonly<{ center: Point; zoom: number }> | null;
  measurement: Readonly<{ id: string; points: readonly Point[]; distanceLabel: string }> | null;
  pings: readonly Readonly<{ id: string; point: Point; label?: string; expiresAt: number }>[];
  initiative: Readonly<{ visible: boolean; round: number; hiddenTurn: boolean; entries: readonly Readonly<{ actorId: string; name: string; initiative: number; active: boolean; health?: "healthy" | "bloodied" | "down"; conditions?: readonly string[]; conditionIds?: readonly string[] }>[] }>;
  encounter: Readonly<{ mapAssetId: string | null; tokens: readonly Readonly<{ actorId: string; name: string; kind: "player-character" | "monster" | "npc"; position: Point; sizePx: number; active: boolean; health?: "healthy" | "bloodied" | "down"; conditions?: readonly string[]; conditionIds?: readonly string[]; healthDisplay?: Readonly<{ style: "bar" | "ring" | "aura" }>; tokenAssetId?: string }>[]; annotations?: readonly ViewerAnnotation[]; fog?: Readonly<{ enabled: boolean; shapes: readonly Readonly<{ kind: "rect"; id: string; op: "reveal" | "hide"; x: number; y: number; width: number; height: number }>[] }> }>;
}>;

type ConnectionState = "pairing" | "connecting" | "live" | "reconnecting";

async function responseJson(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "Viewer request failed.");
  return body;
}

function imageUrl(assetId: string) {
  return `/api/v1/map-assets/${encodeURIComponent(assetId)}/content`;
}

function Pairing({ onPaired }: Readonly<{ onPaired: () => void }>) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("Table display");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/v1/viewer/pairings/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name }) });
      await responseJson(response); onPaired();
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  return <main className="viewer-pairing"><form onSubmit={submit} aria-labelledby="pair-title">
    <span className="viewer-eyebrow">SHARED TABLE VIEWER</span>
    <h1 id="pair-title">Pair this screen</h1>
    <p>Ask the GM for the temporary pairing code. This screen receives only player-safe presentation data.</p>
    <label>Display name<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} autoComplete="off" /></label>
    <label>Pairing code<Input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX" inputMode="text" autoCapitalize="characters" autoComplete="one-time-code" autoFocus /></label>
    <Button variant="primary" type="submit" disabled={busy}>{busy ? "Pairing…" : "Pair viewer"}</Button>
    <p className="viewer-feedback" role="alert">{message}</p>
  </form></main>;
}

export function Initiative({ presentation, onResize }: Readonly<{ presentation: Presentation; onResize?: (width: number) => void }>) {
  const asideRef = useRef<HTMLElement | null>(null);
  if (!presentation.initiative.visible) return null;
  // Identical to the player's list (feedback #5): active combatant on top, the rest in turn order, the
  // compact Round-pill header - no HP bars, no controls (the viewer has no claimed character). Scaled up
  // for the room via the viewer's font sizing, but structurally the same as a player with no active turn.
  const { entries, round, hiddenTurn } = presentation.initiative;
  const activeIndex = entries.findIndex((entry) => entry.active);
  const ordered = activeIndex > 0 ? [...entries.slice(activeIndex), ...entries.slice(0, activeIndex)] : entries;
  // Drag the left edge to widen/narrow the column (persisted by the caller). Dragging left grows it,
  // since it's the right-hand column; clamp to a legible minimum and 60% of the screen.
  const startResize = (event: React.PointerEvent) => {
    if (!onResize) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = asideRef.current?.offsetWidth ?? 320;
    const onMove = (move: PointerEvent) => onResize(Math.max(240, Math.min(window.innerWidth * 0.6, startWidth + (startX - move.clientX))));
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  return <aside ref={asideRef} className="viewer-initiative" aria-label={`Initiative, round ${round}`}>
    {onResize && <div className="viewer-initiative-resize" role="separator" aria-orientation="vertical" aria-label="Drag to resize the initiative panel" onPointerDown={startResize} />}
    <div className="viewer-initiative-scroll">
      <div className="viewer-initiative-head"><strong className="viewer-initiative-round">Round {round}</strong></div>
      {hiddenTurn && <p className="viewer-hidden-turn">GM turn</p>}
      <ol>{ordered.map((entry) => <li key={entry.actorId} className={entry.active ? "active" : ""} aria-current={entry.active ? "step" : undefined}>
        <InitiativeRow entry={{ actorId: entry.actorId, name: entry.name, score: entry.initiative, active: entry.active, health: entry.health ?? "healthy", conditionIds: entry.conditionIds, conditions: entry.conditions }} />
      </li>)}</ol>
    </div>
  </aside>;
}

type LocalCamera = Readonly<{ center: Point; zoom: number }>;
type PanGesture = Readonly<{ startClient: Point; startCenter: Point; scaleX: number; scaleY: number }>;
const LOCAL_MIN_ZOOM = 0.5;
const LOCAL_MAX_ZOOM = 8;

/**
 * This screen's own zoom/pan, layered on top of whatever the GM presents. It is purely local -
 * nothing here is sent back to the server - so each paired display (or the GM's in-tab preview of
 * it) can be framed independently without affecting what anyone else sees. Resets to follow the
 * GM's camera again whenever the presented map changes, or when "Follow GM view" is pressed.
 */
export function MapStage({ presentation }: Readonly<{ presentation: Presentation }>) {
  const [size, setSize] = useState({ width: 16, height: 9 });
  const [localCamera, setLocalCamera] = useState<LocalCamera | null>(null);
  const [pan, setPan] = useState<PanGesture | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const stageRef = useRef<HTMLElement | null>(null);
  const href = presentation.activeMap ? imageUrl(presentation.activeMap.assetId) : "";
  useEffect(() => { setLocalCamera(null); }, [presentation.activeMap?.assetId]);
  const camera: LocalCamera = localCamera ?? presentation.camera ?? { center: { x: size.width / 2, y: size.height / 2 }, zoom: 1 };
  const viewBox = useMemo(() => {
    const width = size.width / camera.zoom;
    const height = size.height / camera.zoom;
    return `${camera.center.x - width / 2} ${camera.center.y - height / 2} ${width} ${height}`;
  }, [camera, size]);

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const svg = svgRef.current; if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const fx = (clientX - rect.left) / rect.width;
    const fy = (clientY - rect.top) / rect.height;
    const width = size.width / camera.zoom, height = size.height / camera.zoom;
    const imageX = camera.center.x - width / 2 + fx * width;
    const imageY = camera.center.y - height / 2 + fy * height;
    const nextZoom = Math.max(LOCAL_MIN_ZOOM, Math.min(LOCAL_MAX_ZOOM, camera.zoom * factor));
    const width2 = size.width / nextZoom, height2 = size.height / nextZoom;
    setLocalCamera({ zoom: nextZoom, center: { x: imageX + width2 * (0.5 - fx), y: imageY + height2 * (0.5 - fy) } });
  };
  // Wheel-to-zoom needs preventDefault, which React's synthetic onWheel cannot reliably guarantee (passive by default).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => { if (!svgRef.current) return; event.preventDefault(); zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.15 : 1 / 1.15); };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, size]);
  const beginPan = (event: React.PointerEvent<HTMLElement>) => {
    // The zoom / "Follow GM view" buttons are absolutely-positioned children of the stage; let their
    // own onClick run instead of starting a pan (which captures the pointer and swallows the click).
    if ((event.target as Element).closest("button")) return;
    const svg = svgRef.current; if (!svg) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = svg.getBoundingClientRect();
    setPan({ startClient: { x: event.clientX, y: event.clientY }, startCenter: camera.center, scaleX: (size.width / camera.zoom) / rect.width, scaleY: (size.height / camera.zoom) / rect.height });
  };
  const continuePan = (event: React.PointerEvent<HTMLElement>) => {
    if (!pan || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const dx = (event.clientX - pan.startClient.x) * pan.scaleX;
    const dy = (event.clientY - pan.startClient.y) * pan.scaleY;
    setLocalCamera({ zoom: camera.zoom, center: { x: pan.startCenter.x - dx, y: pan.startCenter.y - dy } });
  };
  const endPan = (event: React.PointerEvent<HTMLElement>) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setPan(null); };
  const zoomCenter = (factor: number) => { const svg = svgRef.current; if (!svg) return; const rect = svg.getBoundingClientRect(); zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor); };

  if (!presentation.activeMap) return <section className="viewer-waiting"><span className="viewer-eyebrow">VIEWER CONNECTED</span><h1>Waiting for a map</h1><p>The GM controls what appears here.</p></section>;
  const measurementPoints = presentation.measurement?.points.map((point) => `${point.x},${point.y}`).join(" ");
  const onActiveMap = presentation.encounter.mapAssetId === presentation.activeMap.assetId;
  const tokens = onActiveMap ? presentation.encounter.tokens : [];
  const annotations = onActiveMap ? (presentation.encounter.annotations ?? []) : [];
  const arrowSize = Math.max(8, Math.min(size.width, size.height) / 45);
  const pingSize = Math.max(10, Math.min(size.width, size.height) / 30);
  return <section className="viewer-stage" ref={stageRef} aria-label={presentation.activeMap.altText || "Shared battlemap"} onPointerDown={beginPan} onPointerMove={continuePan} onPointerUp={endPan} onPointerCancel={endPan}>
    <svg ref={svgRef} viewBox={viewBox} preserveAspectRatio="xMidYMid meet" role="img" aria-label={presentation.activeMap.altText || "Shared battlemap"}>
      <image href={href} width={size.width} height={size.height} onLoad={(event) => {
        const image = event.currentTarget as SVGImageElement;
        const source = image.href.baseVal;
        void probeImageDimensions(source).then(setSize).catch(() => {});
      }} />
      {annotations.map((annotation) => {
        if (annotation.kind === "ping") return <PingGlyph key={annotation.id} point={annotation.origin} color={annotation.color} label={annotation.label} size={pingSize} />;
        const data = { kind: annotation.kind, shape: annotation.shape, origin: annotation.origin, target: annotation.target, sizeFeet: annotation.sizeFeet };
        if (annotation.kind === "shape") return <g className="annotation-shape visibility-public" key={annotation.id}><AnnotationGlyph data={data} arrowSize={arrowSize} color={annotation.color} /></g>;
        return <AnnotationGlyph key={annotation.id} data={data} arrowSize={arrowSize} color={annotation.color} />;
      })}
      {tokens.map((token) => <g className={`viewer-token ${token.kind}${token.active ? " active" : ""}`} key={token.actorId} transform={`translate(${token.position.x} ${token.position.y})`}>
        {token.healthDisplay?.style === "aura" && <TokenHealthAura sizePx={token.sizePx} fraction={bandFraction(token.health ?? "healthy")} />}
        <TokenGlyph sizePx={token.sizePx} name={token.name} active={token.active} imageUrl={token.tokenAssetId ? `/api/v1/token-assets/${encodeURIComponent(token.tokenAssetId)}/content` : null} turnClassName="viewer-token-turn" bodyClassName="viewer-token-body" initialsClassName="viewer-token-initials" nameClassName="viewer-token-name" nameY={token.sizePx * .78} />
        <TokenStatusBadges sizePx={token.sizePx} health={token.health ?? "healthy"} conditions={(token.conditions ?? []).map((label, index) => ({ id: token.conditionIds?.[index] ?? null, label }))} healthBar={token.healthDisplay && token.healthDisplay.style !== "aura" ? { style: token.healthDisplay.style, fraction: bandFraction(token.health ?? "healthy") } : undefined} />
      </g>)}
      {measurementPoints && <polyline className="viewer-measurement" points={measurementPoints} />}
      {presentation.pings.map((ping) => <g className="viewer-ping" key={ping.id} transform={`translate(${ping.point.x} ${ping.point.y})`}>
        <circle r={Math.max(8, Math.min(size.width, size.height) / 40)} /><circle r={Math.max(3, Math.min(size.width, size.height) / 100)} />
      </g>)}
      {/* Fog covers everything on the shared screen - the audience sees only what the GM revealed. */}
      {onActiveMap && presentation.encounter.fog && <FogOverlay width={size.width} height={size.height} fog={presentation.encounter.fog} variant="player" />}
    </svg>
    {presentation.measurement && <output className="viewer-distance">{presentation.measurement.distanceLabel}</output>}
    {presentation.pings.filter((ping) => ping.label).map((ping) => <div className="viewer-ping-label" key={ping.id}>{ping.label}</div>)}
    <div className="viewer-zoom" role="group" aria-label="This screen's zoom">
      <button type="button" aria-label="Zoom in" onClick={() => zoomCenter(1.3)}>+</button>
      <button type="button" aria-label="Zoom out" onClick={() => zoomCenter(1 / 1.3)}>−</button>
      <button type="button" onClick={() => setLocalCamera({ center: { x: size.width / 2, y: size.height / 2 }, zoom: 1 })}>Reset view</button>
      {localCamera && <button type="button" onClick={() => setLocalCamera(null)}>Follow GM view</button>}
    </div>
  </section>;
}

export function ViewerApp() {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [message, setMessage] = useState("");
  const sourceRef = useRef<EventSource | null>(null);
  // The initiative column is drag-resizable (persisted), like the GM's docked tracker - so a room can
  // widen it until long names fit instead of ellipsizing.
  const [initiativeWidth, setInitiativeWidth] = useState<number | null>(() => {
    const stored = Number(localStorage.getItem("vtt.viewer-initiative-width"));
    return Number.isFinite(stored) && stored >= 240 ? stored : null;
  });
  const resizeInitiative = (width: number) => { setInitiativeWidth(width); localStorage.setItem("vtt.viewer-initiative-width", String(Math.round(width))); };

  const connect = async () => {
    setConnection("connecting"); setMessage(""); sourceRef.current?.close();
    try {
      const response = await fetch("/api/v1/viewer/presentation");
      if (response.status === 401) { setConnection("pairing"); return; }
      const body = await responseJson(response); setPresentation(body.presentation); setConnection("live");
      const source = new EventSource("/api/v1/viewer/events"); sourceRef.current = source;
      source.addEventListener("presentation", (event) => { setPresentation(JSON.parse((event as MessageEvent).data)); setConnection("live"); });
      source.onerror = async () => {
        setConnection("reconnecting");
        try {
          const check = await fetch("/api/v1/viewer/presentation");
          if (check.status === 401) { source.close(); setConnection("pairing"); }
        } catch { /* EventSource continues its bounded browser-managed reconnect loop. */ }
      };
    } catch (error) { setMessage((error as Error).message); setConnection("reconnecting"); }
  };

  useEffect(() => { void connect(); return () => sourceRef.current?.close(); }, []);
  if (connection === "pairing") return <Pairing onPaired={() => void connect()} />;
  if (!presentation) return <main className="viewer-waiting"><span className="viewer-eyebrow">SHARED TABLE VIEWER</span><h1>{connection === "reconnecting" ? "Reconnecting…" : "Connecting…"}</h1><p role="alert">{message}</p></main>;
  if (!presentation.enabled) return <main className="viewer-waiting"><span className="viewer-eyebrow">VIEWER CONNECTED</span><h1>Presentation paused</h1><p>The GM will begin when the table is ready.</p></main>;
  return <main className="viewer-shell" style={initiativeWidth ? ({ "--viewer-initiative-width": `${initiativeWidth}px` } as React.CSSProperties) : undefined}>
    <button className="viewer-fullscreen" onClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()}>Fullscreen</button>
    <div className={`viewer-connection ${connection}`} role="status">{connection === "live" ? "Live" : "Reconnecting"}</div>
    <MapStage presentation={presentation} />
    <Initiative presentation={presentation} onResize={resizeInitiative} />
  </main>;
}
