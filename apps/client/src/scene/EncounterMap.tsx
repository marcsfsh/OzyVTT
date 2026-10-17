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
  PlayerView,
  PlayerVision,
  SceneVision,
  VisionPreviewReply
} from "@vtt/domain";
import { Button, useDragSurface, useToastMute } from "@vtt/ui";
import { CharacterSheet } from "../sheet/CharacterSheet";
import { read } from "../lib/command";
import { useTargeting } from "../encounter/targeting";
import { FogOverlay } from "./FogOverlay";
import { gesturePreview } from "./gesturePreview";
import { snapCellCenterPreview, useMapCalibration } from "./gridPreview";
import { MarkLayer, ShapeLayer } from "./MapAnnotationLayers";
import { useAuthorizedMapImage } from "./mapImage";
import { MapToken } from "./MapToken";
import { MapTokenTray } from "./MapTokenTray";
import { MapRail } from "./MapRail";
import { isVisionTool, LIGHT_PRESETS, type LightPresetId, type MapTool } from "./mapTools";
import { alliesByKind, extraPerStepFor, moveLabel, movementWallsOf, previewMove, type MoveMode } from "./movePreview";
import { MOVE_MODE_KEYS, MOVE_MODE_NAMES, MoveModeChoice } from "./MoveModeChoice";
import { useMovementBudget } from "./useMovementBudget";
import { ShapeEditor } from "./ShapeEditor";
import { TerrainOverlay } from "./TerrainOverlay";
import { TokenContextMenu } from "./TokenContextMenu";
import { useMapCommands } from "./useMapCommands";
import { useMapGestures } from "./useMapGestures";
import { useMapView } from "./useMapView";
import { cameraFocus, useCameraFollow } from "./cameraFollow";
import { VisionLayer } from "./VisionLayer";
import { publishTableGeometry, useTokenFocusRequests } from "./tableGeometry";
import { selectToken } from "./selectedToken";
import { creatureNumbers, tokenLabel } from "../table/numbering";
import { caughtByArea } from "../table/targetHints";
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

// On-brand annotation swatches. Concrete hexes, since theme vars can't travel: the colour goes over the wire and
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
  vision,
  moveSceneId,
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
  /** Dynamic vision: the scene's own (walls, lights, the switch) for the GM, the player's projection of it for a
   *  player (where their characters see, what the party has seen, the walls in it). */
  vision?: SceneVision | PlayerVision;
  /** When set, this map is a GM-private staging view of a prepared scene: token moves target that scene and leave the live encounter alone. */
  moveSceneId?: string;
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
  // Tap-to-target: the GM's for any creature, a player's for their own character's action. Both send the same
  // `action:resolve`, and the server decides range and who may be targeted.
  const targetingSession = useTargeting();
  const [sheetActorId, setSheetActorId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // "GM ink": new drawings land GM-only, and only GM-only drawings are interactive while it is on.
  const [gmLayer, setGmLayer] = useState(false);
  const { muted: notificationsMuted, setMuted: setNotificationsMuted } = useToastMute();
  // Dynamic vision: the GM has the scene's own layer, a player the server's projection of it.
  const gmVision = vision && "measure" in vision ? vision : null;
  const playerVision = vision && "visible" in vision ? vision : null;
  const [lightPreset, setLightPreset] = useState<LightPresetId>("torch");
  /** Whose eyes the GM looks through: "party", an actor id, or nobody. The live table only. */
  const [lookThrough, setLookThrough] = useState<string | null>(null);
  const [lookedThrough, setLookedThrough] = useState<VisionPreviewReply | null>(null);
  const [sessionColor, setSessionColor] = useState<string>(
    () => localStorage.getItem("vtt.annotation-color") ?? (role === "gm" ? "#ff2e9a" : PLAYER_COLORS[0])
  );
  useEffect(() => {
    localStorage.setItem("vtt.annotation-color", sessionColor);
  }, [sessionColor]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const stageSurface = useDragSurface(stageRef);
  const trayRef = useRef<HTMLDivElement | null>(null);
  const actorsById = useMemo(() => new Map(actors.map((actor) => [actor.id, actor])), [actors]);
  const tokensById = useMemo(
    () => new Map(tokens.map((encounterToken) => [encounterToken.actorId, encounterToken])),
    [tokens]
  );
  const characters = useMemo(() => actors.filter((actor) => actor.kind === "player-character"), [actors]);
  // Monsters of one kind carry their number on the token, as in every list.
  const numbers = useMemo(
    () => creatureNumbers(tokens.flatMap((placed) => actorsById.get(placed.actorId) ?? [])),
    [tokens, actorsById]
  );
  const size = image.status === "ready" ? { width: image.width, height: image.height } : null;
  const mapWidth = size?.width;
  const mapHeight = size?.height;
  const calibration = grid.calibration;
  // The panel beside the map measures targets' range with the same grid.
  useEffect(() => {
    if (!moveSceneId && grid.status === "ready")
      publishTableGeometry(
        assetId,
        calibration,
        mapWidth !== undefined && mapHeight !== undefined ? { width: mapWidth, height: mapHeight } : null
      );
  }, [assetId, calibration, grid.status, moveSceneId, mapWidth, mapHeight]);
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

  const view = useMapView({ size, cellSizePx: calibration?.cellSizePx ?? null, svgRef, stageRef });
  // How the mover's next drag travels: the acting creature's for the GM, the player's own character's for a player,
  // on the live table only. Each turn starts on foot.
  const ownActorId =
    role === "player"
      ? (actors.find((actor) => "claimStatus" in actor && actor.claimStatus === "mine")?.id ?? null)
      : null;
  /** Brings a creature's token to the middle of the view (a player's Me, from the rail or the header). */
  const focusOn = (actorId: string) => {
    const position = tokensById.get(actorId)?.position;
    if (position) view.centreOn(position);
  };
  useTokenFocusRequests((actorId) => {
    if (!moveSceneId) focusOn(actorId);
  });
  const activeTargeting =
    targetingSession && !moveSceneId && (role === "gm" || targetingSession.attackerId === ownActorId)
      ? targetingSession
      : null;
  // The camera follows the play: who is choosing targets and whom, a reaction and what it answers, whose turn it
  // is, or a player's own token. A staged scene only opens close enough to read.
  const waitingReaction = (() => {
    const pending = state?.combat.pendingReactions ?? [];
    const mine = role === "player" ? pending.find((reaction) => reaction.actorId === ownActorId) : pending[0];
    if (!mine) return null;
    return "sourceActorId" in mine
      ? { actorId: mine.actorId, sourceActorId: mine.sourceActorId }
      : { actorId: mine.actorId };
  })();
  const placedAt = (actorId: string) => tokensById.get(actorId)?.position ?? null;
  // Before a target is chosen, the nearest creature on the other side stands in for it, so the map shows whom the
  // action is likely for. A heal has no such stand-in.
  const likelyTarget = (() => {
    if (!activeTargeting || activeTargeting.selected.length > 0 || activeTargeting.action.healing != null) return null;
    if (activeTargeting.mode === "template" || activeTargeting.mode === "none") return null;
    const attacker = actorsById.get(activeTargeting.attackerId);
    const from = placedAt(activeTargeting.attackerId);
    if (!attacker || !from) return null;
    const isAlly = sidesFrom(state);
    let nearest: { id: string; distance: number } | null = null;
    for (const placed of tokens) {
      const other = actorsById.get(placed.actorId);
      if (!other || !placed.position || other.id === attacker.id || isAlly(attacker, other)) continue;
      const distance = Math.hypot(placed.position.x - from.x, placed.position.y - from.y);
      if (!nearest || distance < nearest.distance) nearest = { id: other.id, distance };
    }
    return nearest?.id ?? null;
  })();
  useCameraFollow({
    view,
    focus: moveSceneId
      ? null
      : cameraFocus({
          role,
          ownActorId,
          turnActorId: activeActorId,
          targeting: activeTargeting && {
            attackerId: activeTargeting.attackerId,
            selected: likelyTarget ? [likelyTarget] : activeTargeting.selected
          },
          reaction: waitingReaction,
          placed: (actorId) => placedAt(actorId) !== null
        }),
    positionOf: placedAt,
    openKey: `${assetId}|${moveSceneId ?? "live"}`,
    pad: calibration?.cellSizePx ?? 50,
    settled: grid.status !== "loading"
  });
  // Who a placed area covers, of the creatures this view can see: the same hint the panel lists. The server decides.
  const placedArea = activeTargeting?.mode === "template" ? activeTargeting.template : null;
  const areaCatches = new Set(
    placedArea?.placed && calibration
      ? caughtByArea(
          calibration,
          placedArea.shape,
          placedArea.placed,
          placedArea.widthFeet,
          tokens.filter((placed) => placed.actorId !== activeTargeting?.attackerId),
          placedArea.sizeFeet
        )
      : []
  );
  // A player moves their own character once it is in the fight; nobody's move is counted before it.
  const ownInFight =
    ownActorId !== null && state !== undefined && state.combat.initiative.some((entry) => entry.actorId === ownActorId);
  const moverId = moveSceneId ? null : role === "gm" ? activeActorId : ownInFight ? ownActorId : null;
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
    },
    waitingAsks: state?.combat.pendingRuleAsks?.length ?? 0
  });
  const { message, busyActorId } = commands;
  const looking = role === "gm" && !moveSceneId && gmVision?.enabled === true ? lookThrough : null;
  useEffect(() => {
    if (looking === null) {
      setLookedThrough(null);
      return;
    }
    let live = true;
    void read("vision:preview", looking === "party" ? {} : { actorId: looking }).then((reply) => {
      if (!live) return;
      if (reply.ok && reply.enabled && reply.visible && reply.actorIds)
        setLookedThrough({ enabled: true, visible: reply.visible, actorIds: reply.actorIds });
      else setLookedThrough(null);
    });
    return () => {
      live = false;
    };
  }, [looking, revision]);
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
    onContextMenu: setContextMenu,
    // The GM's Token tab follows the token last pressed on the live map.
    onTokenPress: (actorId) => {
      if (role === "gm" && !moveSceneId) selectToken(actorId);
    },
    onPlaceLight: (point) => {
      const preset = LIGHT_PRESETS.find((entry) => entry.id === lightPreset) ?? LIGHT_PRESETS[0];
      commands.addLight(point, preset);
    }
  });

  useEffect(() => {
    setSelectedId(null);
  }, [assetId, token]);
  useEffect(() => {
    if (tool !== "select") setSelectedId(null);
  }, [tool]);
  // While the mover is dragged, a letter switches how it travels (W walk, F fly, S swim, C climb, B burrow,
  // T teleport, and for the GM M moved by force); the label shows the choice. On a phone the long-press menu has it.
  const onModeKey = useEffectEvent((event: KeyboardEvent) => {
    if (gesture?.kind !== "token" || gesture.actorId !== moverId || moverId === null) return;
    const mode = MOVE_MODE_KEYS[event.key.toLowerCase()];
    if (!mode || (mode === "forced" && role !== "gm")) return;
    event.preventDefault();
    setModeChoice({ actorId: moverId, mode });
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => onModeKey(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
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
  // The tray shows only while tokens wait in it; a token goes back to it from its menu, so a drag never pulls the tray
  // over the map.
  const trayShown = unplaced.length > 0;
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
  // The walls a move can't pass, as far as this view knows them (a player's: the ones the party has seen).
  const moveWalls = gmVision?.enabled
    ? movementWallsOf(gmVision.walls)
    : playerVision
      ? movementWallsOf(playerVision.walls)
      : [];
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
          free: draggedMode === "teleport" || draggedMode === "forced",
          walls: moveWalls
        })
      : null;
  // The drag's label says how the creature travels when it isn't walking: the way to move lives in the drag itself.
  const liveLabel = (() => {
    if (!liveMove || !(liveMove.feet > 0 || liveMove.blocked)) return null;
    const label = moveLabel(liveMove, draggedBudget, draggedMode);
    return draggedMode === "walk" || draggedMode === "teleport"
      ? label
      : { ...label, text: `${MOVE_MODE_NAMES[draggedMode]} · ${label.text}` };
  })();
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
  // Placing an area template, the drag places and points the area; its size is the action's own.
  const templateFeet = activeTargeting?.mode === "template" ? activeTargeting.template?.sizeFeet : undefined;
  const preview = gesturePreview(calibration, gesture, annotationAt, templateFeet);
  const selected = selectedId ? annotationAt(selectedId) : null;

  const inspector =
    selected && selected.kind === "shape" && tool === "select" ? (
      <ShapeEditor
        selected={selected}
        role={role}
        manage={canManageShape(selected)}
        characters={characters}
        commands={commands}
        onDeleted={() => setSelectedId(null)}
      />
    ) : null;
  const rail = (
    <MapRail
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
      visionEnabled={gmVision?.enabled ?? false}
      visionBusy={commands.visionBusy}
      onVisionEnabledChange={commands.setVisionEnabled}
      ambient={gmVision?.ambient ?? "bright"}
      onAmbientChange={commands.setAmbient}
      lightPreset={lightPreset}
      onLightPresetChange={setLightPreset}
      hasWalls={(gmVision?.walls.length ?? 0) > 0}
      onClearWalls={commands.clearWalls}
      onForgetExplored={commands.forgetExplored}
      lookThrough={moveSceneId ? null : lookThrough}
      onLookThroughChange={setLookThrough}
      lookThroughOptions={
        moveSceneId
          ? []
          : tokens.flatMap((placed) => {
              const actor = placed.position ? actorsById.get(placed.actorId) : undefined;
              return actor ? [{ id: actor.id, name: actor.name }] : [];
            })
      }
      onZoom={view.zoomCenter}
      onResetView={view.fitMap}
      fullscreen={view.fullscreen}
      onToggleFullscreen={view.toggleFullscreen}
      notificationsMuted={notificationsMuted}
      onNotificationsMutedChange={setNotificationsMuted}
      {...(role === "player" && ownActorId ? { onLocate: () => focusOn(ownActorId) } : {})}
      {...(inspector ? { inspector } : {})}
    />
  );
  // Whose eyes the GM is looking through, named in the banner above the map.
  const seeingAs =
    looking === null ? null : looking === "party" ? "the party" : (actorsById.get(looking)?.name ?? null);

  return (
    <div className="map-bench">
      {rail}
      <div className="map-bench-main">
        {seeingAs && (
          <div className="map-seeing-as" role="status">
            <span>Seeing what {seeingAs} sees · GM only</span>
            <Button variant="secondary" size="sm" onClick={() => setLookThrough(null)}>
              Exit
            </Button>
          </div>
        )}
        <div className="encounter-map-interaction" {...handlers}>
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
          <div className="encounter-map-stage" ref={stageSurface} aria-busy={image.status !== "ready"}>
            {image.status === "ready" && size ? (
              <>
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

                  {/* GM fog: dimmed, above the map and shapes but below tokens; the GM always sees everything. The GM's
                look through a creature's eyes dims the rest the same way. */}
                  {role === "gm" && (fog?.enabled || lookedThrough) && (
                    <FogOverlay
                      width={size.width}
                      height={size.height}
                      fog={fog}
                      vision={lookedThrough ? { visible: lookedThrough.visible, explored: [] } : null}
                      variant="gm"
                    />
                  )}
                  {/* A player's dynamic vision: dark where their characters can't see, below the tokens, since the server
                sends only the creatures they perceive (one heard through a wall shows in the dark). */}
                  {playerVision && (
                    <FogOverlay width={size.width} height={size.height} vision={playerVision} variant="player" />
                  )}

                  {visibleTokens.map((encounterToken) => {
                    const actor = actorsById.get(encounterToken.actorId);
                    if (!actor) return null;
                    const targetable =
                      activeTargeting !== null &&
                      activeTargeting.mode !== "template" &&
                      activeTargeting.mode !== "none" &&
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
                        targeted={
                          (targetable && activeTargeting.selected.includes(actor.id)) || areaCatches.has(actor.id)
                        }
                        tableHealthDisplay={healthDisplay}
                        label={tokenLabel(actor, numbers.get(actor.id))}
                        {...(numbers.has(actor.id) ? { number: numbers.get(actor.id) } : {})}
                        onKeyDown={(event) => keyboardMove(event, encounterToken)}
                      />
                    );
                  })}
                  {(gmVision || playerVision) && (
                    <VisionLayer
                      role={role}
                      walls={gmVision ? gmVision.walls : (playerVision?.walls ?? [])}
                      lights={gmVision?.lights ?? []}
                      tokenPositions={
                        new Map(
                          tokens.flatMap((placed) => (placed.position ? [[placed.actorId, placed.position]] : []))
                        )
                      }
                      pixelsPerFoot={gmVision?.measure?.pixelsPerFoot ?? null}
                      cellSizePx={calibration?.cellSizePx ?? 50}
                      showWalls={role === "gm" && (gmVision?.enabled === true || isVisionTool(tool))}
                      erasing={role === "gm" && tool === "vision-erase"}
                      onToggleDoor={(wallId, open) => void commands.setDoorOpen(wallId, open)}
                    />
                  )}
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
                  {/* Live line of the wall being dragged (the server snaps its ends on commit). */}
                  {gesture?.kind === "wall" && (
                    <line
                      className={`vision-wall-preview vision-wall-${gesture.wallKind}`}
                      x1={gesture.origin.x}
                      y1={gesture.origin.y}
                      x2={gesture.current.x}
                      y2={gesture.current.y}
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
          {/* The feedback line is the map pane's last row: the phone's divider reaches over it for its hit area. */}
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
                  {...(actor.id === moverId && moverPlaced && state?.combat.active
                    ? {
                        moveModes: (
                          <MoveModeChoice
                            name={actor.name}
                            budget={moverBudget}
                            mode={moveMode}
                            onChange={(mode) => setModeChoice({ actorId: actor.id, mode })}
                            gm={role === "gm"}
                          />
                        )
                      }
                    : {})}
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
      </div>
    </div>
  );
}
