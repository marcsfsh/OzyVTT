import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type {
  Annotation,
  AnnotationVisibility,
  EncounterToken,
  GmActor,
  GmView,
  HealthDisplay,
  PlayerActor,
  PlayerAnnotation,
  PlayerView
} from "@vtt/domain";
import { useToastMute } from "@vtt/ui";
import { CharacterSheet } from "../encounter/CharacterSheet";
import type { DockPosition } from "../encounter/DockPicker";
import { useTargeting } from "../encounter/targeting";
import { FogOverlay } from "./FogOverlay";
import { gesturePreview } from "./gesturePreview";
import { footprintCells, occupiedPathCost, snapCellCenterPreview, useMapCalibration } from "./gridPreview";
import { MarkLayer, ShapeLayer } from "./MapAnnotationLayers";
import { useAuthorizedMapImage } from "./mapImage";
import { MapToken } from "./MapToken";
import { MapTokenTray } from "./MapTokenTray";
import { MapToolbar } from "./MapToolbar";
import type { MapTool } from "./mapTools";
import { SceneControls } from "./SceneControls";
import { ShapeEditor } from "./ShapeEditor";
import { TargetBar } from "./TargetBar";
import { TokenContextMenu } from "./TokenContextMenu";
import { useMapCommands } from "./useMapCommands";
import { useMapGestures } from "./useMapGestures";
import { useMapView } from "./useMapView";
import "./encounter-map.css";

type Actor = GmActor | PlayerActor;
type AnyAnnotation = Annotation | PlayerAnnotation;

type FogState = Readonly<{
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

// On-brand annotation swatches. Concrete hexes, not theme vars: the colour travels over the wire and
// must read the same on every screen.
const PLAYER_COLORS = ["#2de2ff", "#5b6ef5", "#a45cff", "#ff2e9a", "#ff2d5e", "#ff8cc6", "#7cefff", "#ffffff"];

function isMine(annotation: AnyAnnotation, role: "gm" | "player") {
  return role === "gm" || ("mine" in annotation && annotation.mine);
}

export function EncounterMap({
  assetId,
  token,
  altText = "Active encounter battlemap",
  role,
  actors,
  tokens,
  annotations,
  revision,
  activeActorId,
  reactionsUsed = [],
  fog,
  dock,
  moveSceneId,
  onScenePrep,
  onViewAllScenes,
  activeSceneName,
  viewerPreview,
  staging,
  healthDisplay,
  state
}: Readonly<{
  assetId: string;
  token: string | null;
  altText?: string;
  role: "gm" | "player";
  actors: readonly Actor[];
  tokens: readonly EncounterToken[];
  annotations: readonly AnyAnnotation[];
  revision: number;
  activeActorId: string | null;
  reactionsUsed?: readonly string[];
  /** Manual fog-of-war mask for this map (live table or staged scene). Absent = no fog. */
  fog?: FogState;
  dock?: Readonly<{
    node: React.ReactNode;
    position: DockPosition;
    width: number;
    onWidthChange: (width: number) => void;
    onChange: (position: DockPosition) => void;
  }>;
  /** When set, this map is a GM-private staging view of a prepared scene: token moves target that scene, not the live encounter. */
  moveSceneId?: string;
  /** GM scene-prep entry (map button): opens the scene picker. */
  onScenePrep?: () => void;
  /**
   * Adds "View all scenes" to the map's Scenes menu. Absent: the map button stays a single action (for
   * players and staging views).
   */
  onViewAllScenes?: () => void;
  /** Which scene is live, shown in the Scenes menu. */
  activeSceneName?: string;
  /** The "Preview what players see" toolbar tool. */
  viewerPreview?: Readonly<{ on: boolean; onToggle: () => void }>;
  /** Present while staging a prepared scene privately: adds "back to live" / "make live" controls. */
  staging?: Readonly<{ onBackToLive: () => void; onMakeLive: () => void }>;
  /** Table-wide health-display default (GM view only; a token's own actor.healthDisplay overrides it). Players receive the resolved per-token style from the server. */
  healthDisplay?: HealthDisplay;
  /** Full view, passed to a token's character sheet so its dice log works when opened from the map. */
  state?: GmView | PlayerView;
}>) {
  const image = useAuthorizedMapImage(assetId, token);
  const grid = useMapCalibration(assetId, token);
  const [tool, setTool] = useState<MapTool>("select");
  const [defaultVisibility, setDefaultVisibility] = useState<AnnotationVisibility>("public");
  const [defaultActorId, setDefaultActorId] = useState<string | null>(null);
  const [rulerWhileMoving, setRulerWhileMoving] = useState(false);
  // GM-controlled: whether measure-while-moving adds the +5 ft per occupied cell penalty. Persisted.
  const [showOccupied, setShowOccupied] = useState(() => localStorage.getItem("vtt.show-occupied") !== "0");
  useEffect(() => {
    localStorage.setItem("vtt.show-occupied", showOccupied ? "1" : "0");
  }, [showOccupied]);
  const [contextMenu, setContextMenu] = useState<{ actorId: string; x: number; y: number } | null>(null);
  // Click-to-target: only the GM resolves actions here, so the targeting session is inert for players.
  const targetingSession = useTargeting();
  const activeTargeting = role === "gm" ? targetingSession : null;
  const [sheetActorId, setSheetActorId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Measured height of the floating token tray, so the toolbar can clear it (0 when absent). */
  const [trayHeight, setTrayHeight] = useState(0);
  // "GM ink": new drawings land GM-only, and only GM-only drawings are interactive while it is on.
  const [gmLayer, setGmLayer] = useState(false);
  const { muted: notificationsMuted, setMuted: setNotificationsMuted } = useToastMute();
  const [sessionColor, setSessionColor] = useState<string>(
    () => localStorage.getItem("vtt.annotation-color") ?? (role === "gm" ? "#ff2e9a" : PLAYER_COLORS[0])
  );
  useEffect(() => {
    localStorage.setItem("vtt.annotation-color", sessionColor);
  }, [sessionColor]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const trayRef = useRef<HTMLDivElement | null>(null);
  const actorsById = useMemo(() => new Map(actors.map((actor) => [actor.id, actor])), [actors]);
  const tokensById = useMemo(
    () => new Map(tokens.map((encounterToken) => [encounterToken.actorId, encounterToken])),
    [tokens]
  );
  const characters = useMemo(() => actors.filter((actor) => actor.kind === "player-character"), [actors]);
  const size = image.status === "ready" ? { width: image.width, height: image.height } : null;
  const calibration = grid.calibration;
  const sizes = {
    handleRadius: Math.max(9, calibration ? calibration.cellSizePx * 0.16 : 9),
    arrowSize: calibration ? calibration.cellSizePx * 0.35 : 12,
    labelSize: calibration ? Math.max(16, calibration.cellSizePx * 0.42) : 16,
    pingSize: calibration ? calibration.cellSizePx * 0.6 : 26
  };

  const canMove = (actorId: string) => {
    if (role === "gm") return true;
    const actor = actorsById.get(actorId);
    return actor !== undefined && "claimStatus" in actor && actor.claimStatus === "mine";
  };
  const canMoveShape = (annotation: AnyAnnotation) =>
    role === "gm" || isMine(annotation, role) || annotation.movableByOthers;
  const canManageShape = (annotation: AnyAnnotation) => role === "gm" || isMine(annotation, role);
  const annotationAt = (id: string) => annotations.find((annotation) => annotation.id === id) ?? null;
  // While GM ink is on, new drawings are GM only whatever the audience control says.
  const effectiveVisibility: AnnotationVisibility = role === "gm" && gmLayer ? "gm-only" : defaultVisibility;

  const view = useMapView({ assetId, size, svgRef, stageRef, dock });
  const commands = useMapCommands({
    revision,
    sceneId: moveSceneId,
    size,
    canMove,
    drawing: { visibility: effectiveVisibility, visibleToActorId: defaultActorId, color: sessionColor },
    onShapeAdded: (annotationId) => {
      setTool("select");
      setSelectedId(annotationId);
    }
  });
  const { message, busyActorId } = commands;
  const { gesture, handlers, keyboardMove } = useMapGestures({
    role,
    tool,
    size,
    calibration,
    svgRef,
    trayRef,
    view,
    commands,
    activeTargeting,
    annotationAt,
    gmLayer,
    canMove,
    canMoveShape,
    actors: actorsById,
    tokensById,
    resetKey: `${assetId}|${token}`,
    onSelect: setSelectedId,
    onContextMenu: setContextMenu
  });

  useEffect(() => {
    setSelectedId(null);
  }, [assetId, token]);
  useEffect(() => {
    if (tool !== "select") setSelectedId(null);
  }, [tool]);
  // Delete/Backspace removes the selected shape (unless typing in a field).
  const onDeleteKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    if (!selectedId || tool !== "select") return;
    if ((event.target as Element | null)?.closest("input, textarea, select")) return;
    const annotation = annotationAt(selectedId);
    if (annotation && annotation.kind === "shape" && canManageShape(annotation)) {
      event.preventDefault();
      setSelectedId(null);
      void commands.removeAnnotation(selectedId);
    }
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => onDeleteKey(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const unplaced = tokens.filter(
    (encounterToken) => encounterToken.position === null && canMove(encounterToken.actorId)
  );
  const dragging = gesture?.kind === "token" ? gesture : null;
  const trayShown = unplaced.length > 0 || dragging !== null;
  // The tray floats over the stage's top edge while tokens are unplaced; publish its measured height
  // so the toolbar starts below it (the tray reflows at 650px and grows per token).
  useEffect(() => {
    const tray = trayRef.current;
    if (!trayShown || !tray) {
      setTrayHeight(0);
      return;
    }
    const observer = new ResizeObserver(() => setTrayHeight(tray.getBoundingClientRect().height));
    observer.observe(tray);
    setTrayHeight(tray.getBoundingClientRect().height);
    return () => observer.disconnect();
  }, [trayShown]);
  // Show the dragged token snapped to the grid live (mirrors the server snap on release).
  const draggingSizeCells = dragging ? (tokensById.get(dragging.actorId)?.sizeCells ?? 1) : 1;
  const dragSnappedPoint = dragging?.point
    ? calibration
      ? snapCellCenterPreview(calibration, dragging.point, draggingSizeCells)
      : dragging.point
    : null;
  const visibleTokens = tokens.flatMap((encounterToken) => {
    const position = dragging?.actorId === encounterToken.actorId ? dragSnappedPoint : encounterToken.position;
    return position ? [{ ...encounterToken, position }] : [];
  });
  // Cells occupied by every other visible token (players never receive hidden tokens, so no leak).
  const occupiedByOthers =
    rulerWhileMoving && showOccupied && calibration && dragging
      ? new Set<string>(
          tokens.flatMap((encounterToken) =>
            encounterToken.actorId !== dragging.actorId && encounterToken.position
              ? [...footprintCells(calibration, encounterToken.position, encounterToken.sizeCells)]
              : []
          )
        )
      : null;
  const liveMove =
    rulerWhileMoving && calibration && dragSnappedPoint && dragging?.origin && occupiedByOthers
      ? occupiedPathCost(calibration, dragging.origin, dragSnappedPoint, occupiedByOthers)
      : null;
  const preview = gesturePreview(calibration, gesture, annotationAt);
  const selected = selectedId ? annotationAt(selectedId) : null;
  const labelSize = sizes.labelSize;

  return (
    <div className={`encounter-map-interaction ${view.enlarged ? "enlarged" : ""}`} {...handlers}>
      {trayShown && (
        <MapTokenTray
          trayRef={trayRef}
          unplaced={unplaced}
          actorsById={actorsById}
          dragging={dragging !== null}
          busy={busyActorId !== null}
          placeAtCenter={commands.placeAtCenter}
        />
      )}
      <div
        className={`encounter-map-stage${dock?.node ? ` has-dock has-dock-${dock.position}` : ""}`}
        ref={stageRef}
        style={
          {
            ...(dock?.node ? { "--dock-side-width": `${dock.width}px` } : {}),
            ...(trayHeight > 0 ? { "--tray-height": `${Math.round(trayHeight)}px` } : {})
          } as React.CSSProperties
        }
        aria-busy={image.status !== "ready"}
      >
        {image.status === "ready" && size ? (
          <>
            <MapToolbar
              role={role}
              tool={tool}
              onToolChange={setTool}
              calibrated={calibration !== null}
              audience={defaultVisibility}
              onAudienceChange={setDefaultVisibility}
              audienceActorId={defaultActorId}
              onAudienceActorIdChange={setDefaultActorId}
              characters={characters}
              color={sessionColor}
              onColorChange={setSessionColor}
              colors={PLAYER_COLORS}
              gmInk={gmLayer}
              onGmInkChange={setGmLayer}
              onClear={commands.clearAnnotations}
              fogEnabled={fog?.enabled ?? false}
              fogBusy={commands.fogBusy}
              onFogEnabledChange={commands.setFogEnabled}
              onRevealAll={commands.revealAllFog}
              onHideAll={commands.hideAllFog}
              {...(viewerPreview ? { viewerPreview } : {})}
              onZoom={view.zoomCenter}
              onResetView={view.resetView}
              enlarged={view.enlarged}
              onToggleEnlarged={view.toggleEnlarged}
              fullscreen={view.fullscreen}
              onToggleFullscreen={view.toggleFullscreen}
              dock={dock ? { position: dock.position, onChange: dock.onChange } : undefined}
              rulerWhileMoving={rulerWhileMoving}
              onRulerWhileMovingChange={setRulerWhileMoving}
              occupiedCost={showOccupied}
              onOccupiedCostChange={setShowOccupied}
              notificationsMuted={notificationsMuted}
              onNotificationsMutedChange={setNotificationsMuted}
            />

            <svg
              ref={svgRef}
              viewBox={view.viewBox}
              preserveAspectRatio="xMidYMid meet"
              role="group"
              aria-label={`${altText}. Interactive tokens are layered above this map.`}
            >
              <image href={image.url} width={size.width} height={size.height} role="img" aria-label={altText} />

              {/* Shapes render below tokens; measurements render above them. */}
              <ShapeLayer
                annotations={annotations}
                gesture={gesture}
                selectedId={selectedId}
                canEdit={(annotation) => tool === "select" && canMoveShape(annotation)}
                preview={preview}
                activeTargeting={activeTargeting}
                calibration={calibration}
                sizes={sizes}
                color={sessionColor}
              />

              {/* GM fog: dimmed, above the map and shapes but below tokens; the GM always sees everything. */}
              {fog && role === "gm" && <FogOverlay width={size.width} height={size.height} fog={fog} variant="gm" />}

              {visibleTokens.map((encounterToken) => {
                const actor = actorsById.get(encounterToken.actorId);
                if (!actor) return null;
                const targetable =
                  activeTargeting !== null &&
                  activeTargeting.mode !== "template" &&
                  actor.id !== activeTargeting.attackerId;
                return (
                  <MapToken
                    key={actor.id}
                    encounterToken={encounterToken}
                    actor={actor}
                    role={role}
                    authToken={token}
                    movable={tool === "select" && canMove(actor.id)}
                    active={activeActorId === actor.id}
                    dragging={dragging?.actorId === actor.id}
                    targetable={targetable}
                    targeted={targetable && activeTargeting.selected.includes(actor.id)}
                    tableHealthDisplay={healthDisplay}
                    onKeyDown={(event) => keyboardMove(event, encounterToken)}
                  />
                );
              })}
              <MarkLayer annotations={annotations} preview={preview} sizes={sizes} color={sessionColor} />
              {liveMove !== null && dragSnappedPoint && dragging?.origin && (
                <g className="encounter-move-guide">
                  <line
                    className="encounter-move-line"
                    x1={dragging.origin.x}
                    y1={dragging.origin.y}
                    x2={dragSnappedPoint.x}
                    y2={dragSnappedPoint.y}
                  />
                  <text
                    className="encounter-live-distance"
                    style={{ fontSize: labelSize, strokeWidth: Math.max(3, labelSize * 0.22) }}
                    x={dragSnappedPoint.x}
                    y={dragSnappedPoint.y - labelSize * 1.3}
                  >
                    {liveMove.penaltyFeet > 0
                      ? `${liveMove.baseFeet} ft + ${liveMove.penaltyFeet} ft (occupied)`
                      : `${liveMove.baseFeet} ft`}
                  </text>
                </g>
              )}
              {/* Live outline of the fog stroke being dragged (the server snaps it to whole cells on commit). */}
              {gesture?.kind === "fog" && (
                <rect
                  className={`fog-stroke-preview fog-stroke-${gesture.op}`}
                  x={Math.min(gesture.origin.x, gesture.current.x)}
                  y={Math.min(gesture.origin.y, gesture.current.y)}
                  width={Math.abs(gesture.origin.x - gesture.current.x)}
                  height={Math.abs(gesture.origin.y - gesture.current.y)}
                />
              )}
              {/* Player fog: solid and above everything, so whatever is in fog is covered. */}
              {fog && role === "player" && (
                <FogOverlay width={size.width} height={size.height} fog={fog} variant="player" />
              )}
            </svg>

            {selected && selected.kind === "shape" && tool === "select" && (
              <ShapeEditor
                selected={selected}
                role={role}
                manage={canManageShape(selected)}
                characters={characters}
                commands={commands}
                onDeleted={() => setSelectedId(null)}
              />
            )}

            {dock?.node && (
              <>
                {/* No `.scroll-y` here: the dock holds the tracker as a bounded flex column, and the tracker's own
              `.encounter-region` scrolls. Declaring both makes two nested scrollports. */}
                <div className={`encounter-map-dock dock-${dock.position}`}>{dock.node}</div>
                <div
                  className={`encounter-map-dock-resize dock-resize-${dock.position}`}
                  role="separator"
                  aria-label="Drag to resize the docked tracker"
                  title="Drag to resize"
                  onPointerDown={view.beginDockResize}
                />
              </>
            )}

            {activeTargeting && (
              <TargetBar
                activeTargeting={activeTargeting}
                actorsById={actorsById}
                revision={revision}
                onFeedback={commands.setMessage}
              />
            )}

            {(staging || onScenePrep) && (
              <SceneControls
                staging={staging}
                onScenePrep={onScenePrep}
                onViewAllScenes={onViewAllScenes}
                activeSceneName={activeSceneName}
                dockPosition={dock?.node ? dock.position : null}
              />
            )}
          </>
        ) : (
          <p role="status">{image.status === "error" ? image.message : "Loading the battle map…"}</p>
        )}
      </div>
      {busyActorId && (
        <p className="encounter-map-saving" role="status">
          Saving move…
        </p>
      )}
      {image.status === "ready" && (
        <p className="encounter-map-feedback" role="status" aria-live="polite">
          {message}
        </p>
      )}
      {contextMenu &&
        (() => {
          const actor = actorsById.get(contextMenu.actorId);
          return actor ? (
            <TokenContextMenu
              actor={actor}
              role={role}
              gmToken={role === "gm" ? token : null}
              x={contextMenu.x}
              y={contextMenu.y}
              reactionUsed={reactionsUsed.includes(actor.id)}
              placed={tokensById.get(actor.id)?.position != null}
              onOpenSheet={() => setSheetActorId(actor.id)}
              onReturnToTray={() => void commands.submitMove(actor.id, null)}
              onClose={() => setContextMenu(null)}
            />
          ) : null;
        })()}
      {sheetActorId &&
        (() => {
          const actor = actorsById.get(sheetActorId);
          return actor ? (
            <CharacterSheet actor={actor} role={role} state={state} onClose={() => setSheetActorId(null)} />
          ) : null;
        })()}
    </div>
  );
}
