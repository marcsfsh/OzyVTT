import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ViewerSoundProjection } from "@vtt/domain";
import { avatarUrl, defaultAvatarFor, useDragSurface } from "@vtt/ui";
import { ApiError, apiRequest } from "../lib/api";
import { probeImageDimensions } from "../scene/mapImage";
import { FogOverlay, type VisionMask } from "../scene/FogOverlay";
import { TerrainOverlay, type OverlayTrap } from "../scene/TerrainOverlay";

type ViewerRect = Readonly<{ x: number; y: number; width: number; height: number }>;
import { bandFraction, TokenAltitudeBadge, TokenGlyph, TokenHealthAura, TokenStatusBadges } from "../scene/tokenGlyph";
import { AuthorizedTokenGlyph } from "../tokens/tokenImages";
import { AnnotationGlyph, PingGlyph } from "../scene/annotationGlyph";
import { useDamageNumbers, type SeenHealth } from "../scene/damageNumbers";
import { useScreenLight } from "./screenLight";
import { ScreenColumn, ScreenTop } from "./ScreenParts";
import { ScreenPairing } from "./ScreenPairing";
import { TableSound } from "./TableSound";
import "./viewer.css";

type Point = Readonly<{ x: number; y: number }>;
type ViewerAnnotation = Readonly<{
  id: string;
  kind: "measurement" | "shape" | "ping";
  shape: "circle" | "cone" | "line" | "square" | null;
  origin: Point;
  target: Point;
  sizeFeet: number;
  color: string;
  label: string | null;
}>;
export type Presentation = Readonly<{
  schemaVersion: 1;
  revision: number;
  enabled: boolean;
  activeMap: Readonly<{ assetId: string; altText: string }> | null;
  camera: Readonly<{ center: Point; zoom: number }> | null;
  measurement: Readonly<{ id: string; points: readonly Point[]; distanceLabel: string }> | null;
  pings: readonly Readonly<{ id: string; point: Point; label?: string; expiresAt: number }>[];
  initiative: Readonly<{
    visible: boolean;
    round: number;
    hiddenTurn: boolean;
    entries: readonly Readonly<{
      actorId: string;
      name: string;
      initiative: number;
      active: boolean;
      health?: "healthy" | "bloodied" | "down";
      conditions?: readonly string[];
      conditionIds?: readonly string[];
    }>[];
  }>;
  encounter: Readonly<{
    mapAssetId: string | null;
    tokens: readonly Readonly<{
      actorId: string;
      name: string;
      kind: "player-character" | "monster" | "npc";
      position: Point;
      sizePx: number;
      active: boolean;
      health?: "healthy" | "bloodied" | "down";
      conditions?: readonly string[];
      conditionIds?: readonly string[];
      healthDisplay?: Readonly<{ style: "bar" | "ring" | "aura" }>;
      tokenAssetId?: string;
      altitudeFeet?: number;
    }>[];
    annotations?: readonly ViewerAnnotation[];
    fog?: Readonly<{
      enabled: boolean;
      shapes: readonly Readonly<{
        kind: "rect";
        id: string;
        op: "reveal" | "hide";
        x: number;
        y: number;
        width: number;
        height: number;
      }>[];
    }>;
    /** Painted ground the fog reveals: difficult terrain, still and running water, and ice. */
    terrain?: Readonly<{
      difficult: readonly ViewerRect[];
      water?: readonly ViewerRect[];
      runningWater?: readonly ViewerRect[];
      ice?: readonly ViewerRect[];
    }>;
    /** The traps the party has found. */
    traps?: readonly OverlayTrap[];
    /** Dynamic vision: where the party sees now and what it has seen. */
    vision?: VisionMask;
  }>;
  /** What the sound board is playing, with how far in each sound was when this was sent. */
  sound?: ViewerSoundProjection;
  /** The newest public roll the room may see, built on the server (ADR-0040); absent from a feed older than it. */
  latestRoll?: ViewerRollCard | null;
}>;

/** One roll as the screen shows it: who, what for, the total and the dice. Nothing about targets or outcomes. */
export type ViewerRollCard = Readonly<{
  id: string;
  who: string;
  what: string;
  total: number;
  dice: readonly Readonly<{ sides: number; face: number; kept: boolean }>[];
  modifier: number;
  at: string;
}>;

type ConnectionState = "pairing" | "connecting" | "live" | "reconnecting";

const PRESENTATION_PATH = "/api/v1/viewer/presentation";
const failure = "Viewer request failed.";
const isUnpaired = (error: unknown) => error instanceof ApiError && error.status === 401;

function imageUrl(assetId: string) {
  return `/api/v1/map-assets/${encodeURIComponent(assetId)}/content`;
}

type LocalCamera = Readonly<{ center: Point; zoom: number }>;
type PanGesture = Readonly<{ startClient: Point; startCenter: Point; scaleX: number; scaleY: number }>;
const LOCAL_MIN_ZOOM = 0.5;
const LOCAL_MAX_ZOOM = 8;

const FOLLOW_KEY = "vtt.viewer-follow-gm";

/** Whether this screen follows the GM's camera: a choice made on the screen and kept by its browser. */
function readFollow(): boolean {
  try {
    return localStorage.getItem(FOLLOW_KEY) === "on";
  } catch {
    return false;
  }
}

/**
 * This screen's own zoom/pan over what the GM presents. Purely local (nothing is sent to the server),
 * so each display can be framed independently. It fits the whole map until someone zooms, or follows the GM's
 * camera once Follow GM view is chosen; a new map starts from that choice again.
 */
export function MapStage({
  presentation,
  mapImageUrl,
  authToken
}: Readonly<{
  presentation: Presentation;
  /** The GM's preview draws the map from a bearer-authorized copy; the screen itself reads it with its cookie. */
  mapImageUrl?: string | null;
  /** The GM's preview loads token art with the GM's bearer token. */
  authToken?: string;
}>) {
  const [size, setSize] = useState({ width: 16, height: 9 });
  const [localCamera, setLocalCamera] = useState<LocalCamera | null>(null);
  const [follow, setFollow] = useState(readFollow);
  const chooseFollow = (next: boolean) => {
    setFollow(next);
    setLocalCamera(null);
    try {
      localStorage.setItem(FOLLOW_KEY, next ? "on" : "off");
    } catch {
      // A browser that keeps nothing follows for this visit only.
    }
  };
  const [pan, setPan] = useState<PanGesture | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const stageRef = useRef<HTMLElement | null>(null);
  const stageSurface = useDragSurface(stageRef);
  // The screen holds only health bands, and shows them where its health display does: damage there bursts on the
  // token as the band falls, with no number (ADR-0045).
  const shownTokens = presentation.encounter.tokens;
  const bands = useMemo(
    () =>
      new Map<string, SeenHealth>(
        shownTokens.flatMap((token) =>
          token.healthDisplay ? [[token.actorId, { kind: "band", band: token.health ?? "healthy" }] as const] : []
        )
      ),
    [shownTokens]
  );
  useDamageNumbers(stageRef, bands);
  const href = mapImageUrl ?? (presentation.activeMap ? imageUrl(presentation.activeMap.assetId) : "");
  useEffect(() => {
    setLocalCamera(null);
  }, [presentation.activeMap?.assetId]);
  const camera: LocalCamera = useMemo(
    () =>
      localCamera ??
      (follow ? presentation.camera : null) ?? { center: { x: size.width / 2, y: size.height / 2 }, zoom: 1 },
    [localCamera, follow, presentation.camera, size]
  );
  const viewBox = useMemo(() => {
    const width = size.width / camera.zoom;
    const height = size.height / camera.zoom;
    return `${camera.center.x - width / 2} ${camera.center.y - height / 2} ${width} ${height}`;
  }, [camera, size]);
  // Following the GM's camera glides; a hand on the screen's own view moves it directly (ADR-0045).
  useScreenLight(stageRef, svgRef, viewBox, presentation.activeMap?.assetId ?? null, follow && localCamera === null);

  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const fx = (clientX - rect.left) / rect.width;
      const fy = (clientY - rect.top) / rect.height;
      const width = size.width / camera.zoom,
        height = size.height / camera.zoom;
      const imageX = camera.center.x - width / 2 + fx * width;
      const imageY = camera.center.y - height / 2 + fy * height;
      const nextZoom = Math.max(LOCAL_MIN_ZOOM, Math.min(LOCAL_MAX_ZOOM, camera.zoom * factor));
      const width2 = size.width / nextZoom,
        height2 = size.height / nextZoom;
      setLocalCamera({ zoom: nextZoom, center: { x: imageX + width2 * (0.5 - fx), y: imageY + height2 * (0.5 - fy) } });
    },
    [camera, size]
  );
  // React's onWheel is passive, so wheel-to-zoom needs a native listener to preventDefault.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      if (!svgRef.current) return;
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.15 : 1 / 1.15);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [zoomAt]);
  const beginPan = (event: React.PointerEvent<HTMLElement>) => {
    // Let the zoom buttons' onClick run; starting a pan would capture the pointer and swallow the click.
    if ((event.target as Element).closest("button")) return;
    const svg = svgRef.current;
    if (!svg) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = svg.getBoundingClientRect();
    setPan({
      startClient: { x: event.clientX, y: event.clientY },
      startCenter: camera.center,
      scaleX: size.width / camera.zoom / rect.width,
      scaleY: size.height / camera.zoom / rect.height
    });
  };
  const continuePan = (event: React.PointerEvent<HTMLElement>) => {
    if (!pan || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const dx = (event.clientX - pan.startClient.x) * pan.scaleX;
    const dy = (event.clientY - pan.startClient.y) * pan.scaleY;
    setLocalCamera({ zoom: camera.zoom, center: { x: pan.startCenter.x - dx, y: pan.startCenter.y - dy } });
  };
  const endPan = (event: React.PointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setPan(null);
  };
  const zoomCenter = (factor: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  };

  if (!presentation.activeMap)
    return (
      <section className="viewer-waiting">
        <span className="viewer-eyebrow">Connected</span>
        <h1>Waiting for a map</h1>
        <p>The GM controls what appears here.</p>
      </section>
    );
  const measurementPoints = presentation.measurement?.points.map((point) => `${point.x},${point.y}`).join(" ");
  const onActiveMap = presentation.encounter.mapAssetId === presentation.activeMap.assetId;
  const tokens = onActiveMap ? presentation.encounter.tokens : [];
  const annotations = onActiveMap ? (presentation.encounter.annotations ?? []) : [];
  const arrowSize = Math.max(8, Math.min(size.width, size.height) / 45);
  const pingSize = Math.max(10, Math.min(size.width, size.height) / 30);
  return (
    <section
      className="viewer-stage"
      ref={stageSurface}
      aria-label={presentation.activeMap.altText || "Shared battlemap"}
      onPointerDown={beginPan}
      onPointerMove={continuePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
    >
      <svg
        ref={svgRef}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={presentation.activeMap.altText || "Shared battlemap"}
      >
        <image
          href={href}
          width={size.width}
          height={size.height}
          onLoad={(event) => {
            const image = event.currentTarget as SVGImageElement;
            const source = image.href.baseVal;
            void probeImageDimensions(source)
              .then(setSize)
              .catch(() => {});
          }}
        />
        {onActiveMap && (presentation.encounter.terrain || presentation.encounter.traps) && (
          <TerrainOverlay
            difficult={presentation.encounter.terrain?.difficult ?? []}
            water={presentation.encounter.terrain?.water ?? []}
            runningWater={presentation.encounter.terrain?.runningWater ?? []}
            ice={presentation.encounter.terrain?.ice ?? []}
            traps={presentation.encounter.traps ?? []}
            cellSizePx={Math.min(size.width, size.height) / 20}
          />
        )}
        {annotations.map((annotation) => {
          if (annotation.kind === "ping")
            return (
              <PingGlyph
                key={annotation.id}
                point={annotation.origin}
                color={annotation.color}
                label={annotation.label}
                size={pingSize}
              />
            );
          const data = {
            kind: annotation.kind,
            shape: annotation.shape,
            origin: annotation.origin,
            target: annotation.target,
            sizeFeet: annotation.sizeFeet
          };
          if (annotation.kind === "shape")
            return (
              <g className="annotation-shape visibility-public" key={annotation.id}>
                <AnnotationGlyph data={data} arrowSize={arrowSize} color={annotation.color} />
              </g>
            );
          return <AnnotationGlyph key={annotation.id} data={data} arrowSize={arrowSize} color={annotation.color} />;
        })}
        {/* With dynamic vision on, dark where the party can't see; below the tokens, which are only those it
          perceives. */}
        {onActiveMap && presentation.encounter.vision && (
          <FogOverlay width={size.width} height={size.height} vision={presentation.encounter.vision} variant="player" />
        )}
        {tokens.map((token) => (
          <g
            className={`viewer-token ${token.kind}${token.active ? " active" : ""}`}
            key={token.actorId}
            data-token-id={token.actorId}
            transform={`translate(${token.position.x} ${token.position.y})`}
          >
            {token.healthDisplay?.style === "aura" && (
              <TokenHealthAura sizePx={token.sizePx} fraction={bandFraction(token.health ?? "healthy")} />
            )}
            {authToken ? (
              <AuthorizedTokenGlyph
                assetId={token.tokenAssetId ?? null}
                token={authToken}
                fallbackUrl={avatarUrl(defaultAvatarFor(token.actorId))}
                sizePx={token.sizePx}
                name={token.name}
                active={token.active}
                turnClassName="viewer-token-turn"
                bodyClassName="viewer-token-body"
                initialsClassName="viewer-token-initials"
                nameClassName="viewer-token-name"
                nameY={token.sizePx * 0.78}
              />
            ) : (
              <TokenGlyph
                sizePx={token.sizePx}
                name={token.name}
                active={token.active}
                fallbackUrl={avatarUrl(defaultAvatarFor(token.actorId))}
                imageUrl={
                  token.tokenAssetId ? `/api/v1/token-assets/${encodeURIComponent(token.tokenAssetId)}/content` : null
                }
                turnClassName="viewer-token-turn"
                bodyClassName="viewer-token-body"
                initialsClassName="viewer-token-initials"
                nameClassName="viewer-token-name"
                nameY={token.sizePx * 0.78}
              />
            )}
            <TokenStatusBadges
              sizePx={token.sizePx}
              health={token.health ?? "healthy"}
              conditions={(token.conditions ?? []).map((label, index) => ({
                id: token.conditionIds?.[index] ?? null,
                label
              }))}
              healthBar={
                token.healthDisplay && token.healthDisplay.style !== "aura"
                  ? { style: token.healthDisplay.style, fraction: bandFraction(token.health ?? "healthy") }
                  : undefined
              }
            />
            <TokenAltitudeBadge
              sizePx={token.sizePx}
              {...(token.altitudeFeet ? { altitudeFeet: token.altitudeFeet } : {})}
            />
          </g>
        ))}
        {measurementPoints && <polyline className="viewer-measurement" points={measurementPoints} />}
        {presentation.pings.map((ping) => (
          <g className="viewer-ping" key={ping.id} transform={`translate(${ping.point.x} ${ping.point.y})`}>
            <circle r={Math.max(8, Math.min(size.width, size.height) / 40)} />
            <circle r={Math.max(3, Math.min(size.width, size.height) / 100)} />
          </g>
        ))}
        {/* The audience sees only what the GM revealed. */}
        {onActiveMap && presentation.encounter.fog && (
          <FogOverlay width={size.width} height={size.height} fog={presentation.encounter.fog} variant="player" />
        )}
      </svg>
      {presentation.measurement && (
        <output className="viewer-distance">{presentation.measurement.distanceLabel}</output>
      )}
      {presentation.pings
        .filter((ping) => ping.label)
        .map((ping) => (
          <div className="viewer-ping-label" key={ping.id}>
            {ping.label}
          </div>
        ))}
      <div className="viewer-zoom" role="group" aria-label="This screen's zoom">
        <button type="button" aria-label="Zoom in" onClick={() => zoomCenter(1.3)}>
          +
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomCenter(1 / 1.3)}>
          −
        </button>
        <button type="button" onClick={() => chooseFollow(false)}>
          Fit the map
        </button>
        {presentation.camera && (
          <button type="button" aria-pressed={follow && !localCamera} onClick={() => chooseFollow(true)}>
            Follow GM view
          </button>
        )}
      </div>
    </section>
  );
}

export function ViewerApp() {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  // When the presentation arrived, on the clock the sound engine counts from.
  const [receivedAt, setReceivedAt] = useState(0);
  const [message, setMessage] = useState("");
  const sourceRef = useRef<EventSource | null>(null);
  // The column is drag-resizable (persisted) so long names can fit.
  const [columnWidth, setColumnWidth] = useState<number | null>(() => {
    const stored = Number(localStorage.getItem("vtt.viewer-initiative-width"));
    return Number.isFinite(stored) && stored >= 240 ? stored : null;
  });
  const resizeColumn = (width: number) => {
    setColumnWidth(width);
    localStorage.setItem("vtt.viewer-initiative-width", String(Math.round(width)));
  };
  // The screen's own utilities (fullscreen, zoom) show while someone is using it and fade after a few still seconds.
  const [awake, setAwake] = useState(false);
  const sleepTimer = useRef<number | null>(null);
  const wake = useCallback(() => {
    setAwake(true);
    if (sleepTimer.current !== null) window.clearTimeout(sleepTimer.current);
    sleepTimer.current = window.setTimeout(() => setAwake(false), 4000);
  }, []);
  useEffect(
    () => () => {
      if (sleepTimer.current !== null) window.clearTimeout(sleepTimer.current);
    },
    []
  );

  const connect = useCallback(async () => {
    setConnection("connecting");
    setMessage("");
    sourceRef.current?.close();
    try {
      const { presentation } = await apiRequest<{ presentation: Presentation }>(PRESENTATION_PATH, { failure });
      setPresentation(presentation);
      setReceivedAt(performance.now());
      setConnection("live");
      const source = new EventSource("/api/v1/viewer/events");
      sourceRef.current = source;
      source.addEventListener("presentation", (event) => {
        setPresentation(JSON.parse((event as MessageEvent).data));
        setReceivedAt(performance.now());
        setConnection("live");
      });
      source.onerror = async () => {
        setConnection("reconnecting");
        try {
          await apiRequest(PRESENTATION_PATH, { failure });
        } catch (error) {
          // Anything but a revoked session leaves EventSource to its own bounded reconnect loop.
          if (isUnpaired(error)) {
            source.close();
            setConnection("pairing");
          }
        }
      };
    } catch (error) {
      if (isUnpaired(error)) {
        setConnection("pairing");
        return;
      }
      setMessage((error as Error).message);
      setConnection("reconnecting");
    }
  }, []);

  useEffect(() => {
    void connect();
    return () => sourceRef.current?.close();
  }, [connect]);
  if (connection === "pairing") return <ScreenPairing onPaired={() => void connect()} />;
  if (!presentation)
    return (
      <main className="viewer-waiting">
        <span className="viewer-eyebrow">Table screen</span>
        <h1>{connection === "reconnecting" ? "Reconnecting…" : "Connecting…"}</h1>
        <p role="alert">{message}</p>
      </main>
    );
  // Sound plays whether or not a map is shown: music during a break is the GM's call alone.
  const sound = <TableSound sound={presentation.sound} receivedAt={receivedAt} live={connection === "live"} />;
  if (!presentation.enabled)
    return (
      <main className="viewer-waiting">
        <span className="viewer-eyebrow">Connected</span>
        <h1>Presentation paused</h1>
        <p>The GM will begin when the table is ready.</p>
        {sound}
      </main>
    );
  return (
    <main
      className={`viewer-shell${awake ? " is-awake" : ""}`}
      style={columnWidth ? ({ "--viewer-column-width": `${columnWidth}px` } as React.CSSProperties) : undefined}
      onPointerMove={wake}
      onPointerDown={wake}
      onKeyDown={wake}
    >
      <ScreenTop presentation={presentation} />
      <MapStage presentation={presentation} />
      <ScreenColumn presentation={presentation} onResize={resizeColumn} />
      <button
        type="button"
        className="viewer-fullscreen"
        onClick={() =>
          document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()
        }
      >
        Fullscreen
      </button>
      <div className={`viewer-connection ${connection}`} role="status">
        {connection === "live" ? "Live" : "Reconnecting"}
      </div>
      {sound}
    </main>
  );
}
