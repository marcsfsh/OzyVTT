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
import { Button, useToastMute } from "@vtt/ui";
import { CharacterSheet } from "../encounter/CharacterSheet";
import type { DockPosition } from "../encounter/DockPicker";
import { useTargeting } from "../encounter/targeting";
import { FogOverlay } from "./FogOverlay";
import { gesturePreview } from "./gesturePreview";
import { snapCellCenterPreview, useMapCalibration } from "./gridPreview";
import { MarkLayer, ShapeLayer } from "./MapAnnotationLayers";
import { useAuthorizedMapImage } from "./mapImage";
import { MapToken } from "./MapToken";
import { MapTokenTray } from "./MapTokenTray";
import { MapToolbar } from "./MapToolbar";
import type { MapTool } from "./mapTools";
import { alliesByKind, extraPerStepFor, moveLabel, previewMove, type MoveMode } from "./movePreview";
import { MoveModeBar } from "./MoveModeBar";
import { useMovementBudget } from "./useMovementBudget";
import { SceneControls } from "./SceneControls";
import { ShapeEditor } from "./ShapeEditor";
import { TargetBar } from "./TargetBar";
import { TerrainOverlay } from "./TerrainOverlay";
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

type TerrainState = Readonly<{
  difficult: readonly Readonly<{ x: number; y: number; width: number; height: number }>[];
}>;

// On-brand annotation swatches. Concrete hexes, not theme vars: the colour travels over the wire and
// must read the same on every screen.
const PLAYER_COLORS = ["#2de2ff", "#5b6ef5", "#a45cff", "#ff2e9a", "#ff2d5e", "#ff8cc6", "#7cefff", "#ffffff"];

/** Whether two creatures fight on the same side, as the view can tell: the GM reads each stat block's disposition,
 *  a player goes by kind (an NPC's side is the GM's to know). Mirrors the server's `areAllies`. */
function sidesFrom(state: GmView | PlayerView | undefined) {
  if (!state || !("definitions" in state)) return alliesByKind;
  const sideOf = (actor: Actor) => {
    if (actor.kind === "player-character") return "party";
    const disposition = actor.definitionId
      ? state.definitions.find((entry) => entry.id === actor.definitionId)?.definition.token.disposition
      : undefined;
    if (disposition === "friendly") return "party";
    if (disposition === "hostile") return "foes";
    return actor.kind === "monster" ? "foes" : null;
  };
  return (mover: Actor, occupant: Actor) => {
    const side = sideOf(mover);
    return side !== null && side === sideOf(occupant);
  };
}

/** The creatures a mover grapples, which it drags along: the GM sees each grapple's source, a player only their own
 *  character's (`yours`). */
function grappledBy(actors: readonly Actor[], moverId: string, role: "gm" | "player"): string[] {
  return actors
    .filter((actor) =>
      actor.effects.some(
        (effect) =>
          effect.tags.includes("grapple") &&
          (role === "gm"
            ? "sourceActorId" in effect && effect.sourceActorId === moverId
            : "yours" in effect && effect.yours === true)
      )
    )
    .map((actor) => actor.id);
}

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
  terrain,
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
  /** Difficult terrain on this map; a player's is already clipped to what the fog reveals. */
  terrain?: TerrainState;
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
  // How the mover's next drag travels: the acting creature's for the GM, the player's own character's for a player,
  // on the live table only. Each turn starts on foot.
  const ownActorId =
    role === "player"
      ? (actors.find((actor) => "claimStatus" in actor && actor.claimStatus === "mine")?.id ?? null)
      : null;
  const moverId = moveSceneId ? null : role === "gm" ? activeActorId : ownActorId;
  const moverPlaced = moverId !== null && (tokensById.get(moverId)?.position ?? null) !== null;
  const [modeChoice, setModeChoice] = useState<{ actorId: string; mode: MoveMode } | null>(null);
  useEffect(() => {
    setModeChoice(null);
  }, [activeActorId]);
  const moveMode: MoveMode = modeChoice && modeChoice.actorId === moverId ? modeChoice.mode : "walk";
  const moverBudget = useMovementBudget(moverPlaced ? moverId : null, revision);
  const commands = useMapCommands({
    revision,
    sceneId: moveSceneId,
    size,
    canMove,
    moveModeFor: (actorId) => (actorId === moverId ? moveMode : undefined),
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
  // The drag's path and cost, as the server will charge it, and what that leaves of the mover's turn. Only the
  // combatant whose turn it is spends movement, so only that drag asks for the budget.
  const difficult = terrain?.difficult ?? [];
  const draggedMode: MoveMode = dragging?.actorId === moverId ? moveMode : "walk";
  const draggedBudget = dragging?.actorId === moverId ? moverBudget : null;
  const liveMove =
    calibration && size && dragSnappedPoint && dragging?.origin && !dragging.fromTray
      ? previewMove({
          calibration,
          size,
          terrain: difficult,
          tokens,
          actorsById,
          moverId: dragging.actorId,
          from: dragging.origin,
          to: dragSnappedPoint,
          isAlly: sidesFrom(state),
          extraPerStep: extraPerStepFor(draggedBudget, draggedMode),
          carried: grappledBy(actors, dragging.actorId, role),
          free: draggedMode === "teleport" || draggedMode === "forced"
        })
      : null;
  const liveLabel =
    liveMove && (liveMove.feet > 0 || liveMove.blocked) ? moveLabel(liveMove, draggedBudget, draggedMode) : null;
  const labelSize = sizes.labelSize;
  // The label must stay readable on a phone, where the whole map is drawn small: at least 14 screen pixels, and
  // kept inside the map so a drag near an edge doesn't cut it off.
  const moveLabelPlacement = (() => {
    if (!liveLabel || !dragSnappedPoint || !size) return null;
    const [, , viewWidth = 0, viewHeight = 0] = view.viewBox.split(/\s+/).map(Number);
    const svg = svgRef.current;
    const scale = svg && viewWidth > 0 ? Math.min(svg.clientWidth / viewWidth, svg.clientHeight / viewHeight) : 0;
    const fontSize = scale > 0 ? Math.max(labelSize, 14 / scale) : labelSize;
    // Space Mono's glyphs are about 0.6em wide.
    const halfWidth = Math.min(size.width / 2, (liveLabel.text.length * fontSize * 0.6) / 2 + fontSize * 0.5);
    const above = dragSnappedPoint.y - fontSize * 1.3;
    return {
      fontSize,
      x: Math.min(size.width - halfWidth, Math.max(halfWidth, dragSnappedPoint.x)),
      y: above - fontSize > 0 ? above : dragSnappedPoint.y + fontSize * 2
    };
  })();
  const preview = gesturePreview(calibration, gesture, annotationAt);
  const selected = selectedId ? annotationAt(selectedId) : null;

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
              terrainBusy={commands.terrainBusy}
              hasTerrain={difficult.length > 0}
              onClearTerrain={commands.clearAllTerrain}
              {...(viewerPreview ? { viewerPreview } : {})}
              onZoom={view.zoomCenter}
              onResetView={view.resetView}
              enlarged={view.enlarged}
              onToggleEnlarged={view.toggleEnlarged}
              fullscreen={view.fullscreen}
              onToggleFullscreen={view.toggleFullscreen}
              dock={dock ? { position: dock.position, onChange: dock.onChange } : undefined}
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
              <TerrainOverlay difficult={difficult} cellSizePx={calibration?.cellSizePx ?? 50} />

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
              {liveMove && liveLabel && moveLabelPlacement && (
                <g className={`encounter-move-guide${liveLabel.over ? " over" : ""}`}>
                  <polyline
                    className="encounter-move-line"
                    points={liveMove.path.map((point) => `${point.x},${point.y}`).join(" ")}
                  />
                  <text
                    className="encounter-live-distance"
                    style={{
                      fontSize: moveLabelPlacement.fontSize,
                      strokeWidth: Math.max(3, moveLabelPlacement.fontSize * 0.22)
                    }}
                    x={moveLabelPlacement.x}
                    y={moveLabelPlacement.y}
                  >
                    {liveLabel.text}
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
              {/* Live outline of the terrain stroke being dragged (snapped to whole cells on commit). */}
              {gesture?.kind === "terrain" && (
                <rect
                  className={`terrain-stroke-preview terrain-stroke-${gesture.op}`}
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
      {moverId && image.status === "ready" && (
        <MoveModeBar
          name={actorsById.get(moverId)?.name ?? "token"}
          budget={moverBudget}
          mode={moveMode}
          onChange={(mode) => setModeChoice({ actorId: moverId, mode })}
          gm={role === "gm"}
        />
      )}
      {image.status === "ready" && (
        <p className="encounter-map-feedback" role="status" aria-live="polite">
          {message}
        </p>
      )}
      {commands.blockedMove && (
        <div className="encounter-move-blocked" role="group" aria-label="Refused move">
          {role === "gm" ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={busyActorId !== null}
              onClick={() => void commands.moveAnyway()}
            >
              Move anyway
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => void commands.askAboutMove()}>
              Ask the GM
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={commands.dismissBlockedMove}>
            Never mind
          </Button>
        </div>
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
