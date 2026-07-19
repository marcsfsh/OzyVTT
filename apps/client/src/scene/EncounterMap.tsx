import { useEffect, useMemo, useRef, useState } from "react";
import type { Annotation, AnnotationAddResult, AnnotationShapeKind, AnnotationVisibility, ClientToServerEvents, EncounterToken, EncounterTokenPosition, GmActor, MutationResult, PlayerActor, PlayerAnnotation } from "@vtt/domain";
import { footprintCells, imagePointFromClient, initialsOf, occupiedPathCost, snapCellCenterPreview, snapMeasurementPreview, snapShapePreview, TokenStatusBadges, useAuthorizedMapImage, useMapCalibration, type SnappedGeometry } from "./mapImage";
import { AuthorizedTokenGlyph } from "../tokens/tokenImages";
import { conditionBadgeLabel, healthBandFor } from "../encounter/conditions";
import { AnnotationGlyph, annotationCenter, PingGlyph, type AnnotationGlyphData } from "./annotationGlyph";
import { CharacterSheet } from "../encounter/CharacterSheet";
import { clearTargeting, resolveTargeting, setTemplatePlacement, toggleTarget, useTargeting, useTargetingBusy } from "../encounter/targeting";
import { TokenContextMenu } from "./TokenContextMenu";
import { MapToastStack } from "./toasts";
import type { DockPosition } from "../encounter/EncounterPanel";
import { newId } from "../lib/ids";
import { socket } from "../socket";
import "./encounter-map.css";

type Actor = GmActor | PlayerActor;
type Point = EncounterTokenPosition;
type AnyAnnotation = Annotation | PlayerAnnotation;
type Camera = Readonly<{ center: Point; zoom: number }>;
type Tool = "select" | "measure" | "ping" | AnnotationShapeKind;
type Gesture =
  | Readonly<{ kind: "token"; actorId: string; point: Point | null; origin: Point | null }>
  | Readonly<{ kind: "pan"; startClient: Point; startCenter: Point; scaleX: number; scaleY: number }>
  | Readonly<{ kind: "measure" | AnnotationShapeKind; origin: Point; current: Point }>
  | Readonly<{ kind: "annotation-move"; id: string; grab: Point; geometry: Readonly<{ origin: Point; target: Point }> }>
  | Readonly<{ kind: "annotation-resize"; id: string; anchor: Point; current: Point }>;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 6;
const TOOLS: ReadonlyArray<{ id: Tool; glyph: string; label: string }> = [
  { id: "select", glyph: "▹", label: "Select and move" },
  { id: "ping", glyph: "📍", label: "Ping a spot" },
  { id: "measure", glyph: "📏", label: "Measure distance" },
  { id: "circle", glyph: "◯", label: "Place a circle" },
  { id: "cone", glyph: "◭", label: "Place a cone" },
  { id: "line", glyph: "╱", label: "Place a line" },
  { id: "square", glyph: "▢", label: "Place a square" }
];

type VisibilityOption = Readonly<{ value: AnnotationVisibility; label: string }>;
function visibilityOptionsFor(role: "gm" | "player"): readonly VisibilityOption[] {
  return role === "gm"
    ? [{ value: "public", label: "Everyone" }, { value: "gm-only", label: "Just me" }, { value: "gm-actor", label: "Me + a character" }]
    : [{ value: "public", label: "Everyone" }, { value: "owner-only", label: "Just me" }, { value: "owner-gm", label: "Just me and the GM" }];
}
const VISIBILITY_SHORT: Record<AnnotationVisibility, string> = { public: "Everyone", "gm-only": "Just GM", "owner-only": "Just me", "owner-gm": "Me + GM", "gm-actor": "Me + character" };

function emitMove(payload: Parameters<ClientToServerEvents["token:move"]>[0]) {
  return new Promise<MutationResult>((resolve) => socket.emit("token:move", payload, resolve));
}
function emitAnnotationAdd(payload: Parameters<ClientToServerEvents["annotation:add"]>[0]) {
  return new Promise<AnnotationAddResult>((resolve) => socket.emit("annotation:add", payload, resolve));
}
function emitAnnotationMove(payload: Parameters<ClientToServerEvents["annotation:move"]>[0]) {
  return new Promise<MutationResult>((resolve) => socket.emit("annotation:move", payload, resolve));
}
function emitAnnotationRemove(payload: Parameters<ClientToServerEvents["annotation:remove"]>[0]) {
  return new Promise<MutationResult>((resolve) => socket.emit("annotation:remove", payload, resolve));
}
function emitAnnotationSetVisibility(payload: Parameters<ClientToServerEvents["annotation:set-visibility"]>[0]) {
  return new Promise<MutationResult>((resolve) => socket.emit("annotation:set-visibility", payload, resolve));
}
function emitAnnotationSetMovable(payload: Parameters<ClientToServerEvents["annotation:set-movable"]>[0]) {
  return new Promise<MutationResult>((resolve) => socket.emit("annotation:set-movable", payload, resolve));
}
function emitAnnotationClear(payload: Parameters<ClientToServerEvents["annotation:clear"]>[0]) {
  return new Promise<MutationResult>((resolve) => socket.emit("annotation:clear", payload, resolve));
}
function emitAnnotationPing(payload: Parameters<ClientToServerEvents["annotation:ping"]>[0]) {
  return new Promise<MutationResult>((resolve) => socket.emit("annotation:ping", payload, resolve));
}
function emitAnnotationSetColor(payload: Parameters<ClientToServerEvents["annotation:set-color"]>[0]) {
  return new Promise<MutationResult>((resolve) => socket.emit("annotation:set-color", payload, resolve));
}

const PLAYER_COLORS = ["#58c3ff", "#ff6b6b", "#8fff9a", "#ffd43f", "#c58cff", "#ff9d5c", "#5cf2e0", "#ff8cc6"];

function isMine(annotation: AnyAnnotation, role: "gm" | "player") {
  return role === "gm" || ("mine" in annotation && annotation.mine);
}

export function EncounterMap({
  assetId, token, altText = "Active encounter battlemap", role, actors, tokens, annotations, revision, activeActorId, reactionsUsed = [], dock, moveSceneId, onScenePrep, staging
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
  dock?: Readonly<{ node: React.ReactNode; position: DockPosition; width: number; onWidthChange: (width: number) => void; onChange: (position: DockPosition) => void }>;
  /** When set, this map is a GM-private staging view of a prepared scene: token moves target that scene, not the live encounter. */
  moveSceneId?: string;
  /** GM scene-prep entry (map button) — opens the scene picker. */
  onScenePrep?: () => void;
  /** Present while staging a prepared scene privately — adds "back to live" / "make live" controls to the map. */
  staging?: Readonly<{ onBackToLive: () => void; onMakeLive: () => void }>;
}>) {
  const image = useAuthorizedMapImage(assetId, token);
  const grid = useMapCalibration(assetId, token);
  const [message, setMessage] = useState("");
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [busyActorId, setBusyActorId] = useState<string | null>(null);
  const [camera, setCamera] = useState<Camera>({ center: { x: 0, y: 0 }, zoom: 1 });
  const [tool, setTool] = useState<Tool>("select");
  const [defaultVisibility, setDefaultVisibility] = useState<AnnotationVisibility>("public");
  const [defaultActorId, setDefaultActorId] = useState<string | null>(null);
  const [rulerWhileMoving, setRulerWhileMoving] = useState(false);
  // GM-controlled: whether measure-while-moving adds the +5 ft-per-occupied-cell penalty. Persisted.
  const [showOccupied, setShowOccupied] = useState(() => localStorage.getItem("vtt.show-occupied") !== "0");
  useEffect(() => { localStorage.setItem("vtt.show-occupied", showOccupied ? "1" : "0"); }, [showOccupied]);
  const [contextMenu, setContextMenu] = useState<{ actorId: string; x: number; y: number } | null>(null);
  // Click-to-target: only the GM resolves actions, so the shared targeting session is inert for players.
  const targetingSession = useTargeting();
  const targetingBusy = useTargetingBusy();
  const activeTargeting = role === "gm" ? targetingSession : null;
  const [sheetActorId, setSheetActorId] = useState<string | null>(null);
  const longPressRef = useRef<{ startX: number; startY: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [enlarged, setEnlarged] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [annotationBusy, setAnnotationBusy] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [eyeOpen, setEyeOpen] = useState(false);
  const [wrenchOpen, setWrenchOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  // Combat-first: only Select/Ping/Measure earn permanent icons; the drawing toolkit (shapes,
  // color, visibility, layer, cleanup) sits behind one Draw toggle so the corner isn't icon soup.
  const [drawOpen, setDrawOpen] = useState(false);
  const [gmLayer, setGmLayer] = useState(false);
  const [sessionColor, setSessionColor] = useState<string>(() => localStorage.getItem("vtt.annotation-color") ?? (role === "gm" ? "#ffb52e" : PLAYER_COLORS[0]));
  useEffect(() => { localStorage.setItem("vtt.annotation-color", sessionColor); }, [sessionColor]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const trayRef = useRef<HTMLDivElement | null>(null);
  const actorsById = useMemo(() => new Map(actors.map((actor) => [actor.id, actor])), [actors]);
  const tokensById = useMemo(() => new Map(tokens.map((encounterToken) => [encounterToken.actorId, encounterToken])), [tokens]);
  const characters = useMemo(() => actors.filter((actor) => actor.kind === "player-character"), [actors]);
  const size = image.status === "ready" ? { width: image.width, height: image.height } : null;
  const calibration = grid.calibration;
  const handleRadius = Math.max(9, calibration ? calibration.cellSizePx * 0.16 : 9);
  const arrowSize = calibration ? calibration.cellSizePx * 0.35 : 12;
  // Labels are drawn in image-pixel units, so scale them to the grid cell (else they read tiny on large maps).
  const labelSize = calibration ? Math.max(16, calibration.cellSizePx * 0.42) : 16;
  const pingSize = calibration ? calibration.cellSizePx * 0.6 : 26;

  useEffect(() => { setGesture(null); setSelectedId(null); }, [assetId, token]);
  useEffect(() => { if (size) setCamera({ center: { x: size.width / 2, y: size.height / 2 }, zoom: 1 }); }, [assetId, size?.width, size?.height]);
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  useEffect(() => { if (tool !== "select") setSelectedId(null); }, [tool]);
  // Delete/Backspace removes the selected shape (unless typing in a field).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (!selectedId || tool !== "select") return;
      if ((event.target as Element | null)?.closest("input, textarea, select")) return;
      const annotation = annotationAt(selectedId);
      if (annotation && annotation.kind === "shape" && canManageShape(annotation)) {
        event.preventDefault(); setSelectedId(null); void removeAnnotation(selectedId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, tool, annotations]);

  // Wheel-to-zoom needs preventDefault, which React's synthetic onWheel cannot reliably guarantee (passive by default).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      if (!svgRef.current || !size) return;
      // Wheeling over an overlaid panel (a docked initiative tracker, an open menu, the shape editor)
      // must scroll that panel, not zoom the map behind it — mirror the pointer-down guard below.
      if (event.target instanceof Element && event.target.closest(".encounter-map-dock, .encounter-map-dock-resize, .encounter-map-overlay, .encounter-map-menu, .encounter-shape-editor, .encounter-target-bar")) return;
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.15 : 1 / 1.15);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, camera]);

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const svg = svgRef.current; if (!svg || !size) return;
    const rect = svg.getBoundingClientRect();
    const fx = (clientX - rect.left) / rect.width;
    const fy = (clientY - rect.top) / rect.height;
    const width = size.width / camera.zoom, height = size.height / camera.zoom;
    const imageX = camera.center.x - width / 2 + fx * width;
    const imageY = camera.center.y - height / 2 + fy * height;
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom * factor));
    const width2 = size.width / nextZoom, height2 = size.height / nextZoom;
    setCamera({ zoom: nextZoom, center: { x: imageX + width2 * (0.5 - fx), y: imageY + height2 * (0.5 - fy) } });
  };
  const resetView = () => {
    if (!size) return;
    // Frame the whole map in the area the dock leaves visible: treat the dock's inner edge as the new
    // edge of the canvas, fit the map into that rectangle, and center it there. `baseScale` is the
    // zoom-1 meet-scale (image px -> screen px), read from the SVG's actual box so letterboxing and
    // the stage's max-height are accounted for — the earlier stage-width ratio got this wrong.
    const svgRect = svgRef.current?.getBoundingClientRect();
    const dockRect = stageRef.current?.querySelector<HTMLElement>(".encounter-map-dock")?.getBoundingClientRect();
    let center = { x: size.width / 2, y: size.height / 2 };
    let zoom = 1;
    if (svgRect && dockRect && svgRect.width > 0 && svgRect.height > 0) {
      const baseScale = Math.min(svgRect.width / size.width, svgRect.height / size.height);
      let visibleW = svgRect.width, visibleH = svgRect.height, offsetX = 0, offsetY = 0;
      if (dock?.position === "right") { visibleW -= dockRect.width; offsetX = -dockRect.width / 2; }
      else if (dock?.position === "left") { visibleW -= dockRect.width; offsetX = dockRect.width / 2; }
      if (visibleW > 0 && visibleH > 0 && baseScale > 0) {
        const fit = Math.min(visibleW / (size.width * baseScale), visibleH / (size.height * baseScale));
        zoom = Math.max(MIN_ZOOM, Math.min(1, fit));
        const scale = baseScale * zoom;
        center = { x: size.width / 2 - offsetX / scale, y: size.height / 2 - offsetY / scale };
      }
    }
    setCamera({ center, zoom });
  };
  const zoomCenter = (factor: number) => { const svg = svgRef.current; if (!svg || !size) return; const rect = svg.getBoundingClientRect(); zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor); };
  const toggleFullscreen = () => { const el = stageRef.current; if (!el) return; if (document.fullscreenElement) void document.exitFullscreen(); else { setEnlarged(false); void el.requestFullscreen?.(); } };
  const toggleEnlarged = () => setEnlarged((current) => { if (!current && fullscreen) void document.exitFullscreen?.(); return !current; });
  // Drag the docked panel's inner-edge strip to resize its width. Pointer-capture keeps the drag
  // alive off the strip; width is clamped to [16rem, 60% of the stage] and persisted by the parent.
  const beginDockResize = (event: React.PointerEvent) => {
    if (!dock) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = dock.width;
    const stageWidth = stageRef.current?.getBoundingClientRect().width ?? 1000;
    const maxWidth = stageWidth * 0.6;
    const minWidth = 16 * 16; // 16rem
    const onMove = (move: PointerEvent) => {
      const delta = dock.position === "left" ? move.clientX - startX : startX - move.clientX;
      dock.onWidthChange(Math.max(minWidth, Math.min(maxWidth, startWidth + delta)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const canMove = (actorId: string) => {
    if (role === "gm") return true;
    const actor = actorsById.get(actorId);
    return actor !== undefined && "claimStatus" in actor && actor.claimStatus === "mine";
  };
  const canMoveShape = (annotation: AnyAnnotation) => role === "gm" || isMine(annotation, role) || annotation.movableByOthers;
  const canManageShape = (annotation: AnyAnnotation) => role === "gm" || isMine(annotation, role);
  const pointFromScreen = (clientX: number, clientY: number) => {
    const svg = svgRef.current; if (!svg || !size) return null;
    const point = imagePointFromClient(svg, clientX, clientY);
    return point && point.x >= 0 && point.x <= size.width && point.y >= 0 && point.y <= size.height ? point : null;
  };
  const submitMove = async (actorId: string, position: EncounterTokenPosition | null) => {
    if (busyActorId || !canMove(actorId)) return;
    setBusyActorId(actorId); setMessage("");
    try {
      const result = await emitMove({ commandId: newId(), actorId, position, ...(moveSceneId ? { sceneId: moveSceneId } : {}), expectedRevision: revision });
      if (!result.ok) throw new Error(result.message ?? "The token move was rejected.");
      setMessage(position ? "Token moved." : "Token returned to the tray.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusyActorId(null); }
  };
  const placeAtCenter = (actorId: string) => { if (size) void submitMove(actorId, { x: size.width / 2, y: size.height / 2 }); };

  const annotationAt = (id: string) => annotations.find((annotation) => annotation.id === id) ?? null;
  const runAnnotation = async (id: string, action: () => Promise<MutationResult>, fail: string) => {
    setAnnotationBusy(id); setMessage("");
    try { const result = await action(); if (!result.ok) throw new Error(result.message ?? fail); }
    catch (error) { setMessage((error as Error).message); }
    finally { setAnnotationBusy(null); }
  };
  // When the GM layer is active, new drawings go onto it (gm-only) regardless of the eye default.
  const effectiveVisibility: AnnotationVisibility = role === "gm" && gmLayer ? "gm-only" : defaultVisibility;
  const submitAnnotationAdd = async (kind: "measurement" | "shape", shape: AnnotationShapeKind | undefined, origin: Point, target: Point) => {
    const commandId = newId();
    await runAnnotation("new", async () => {
      const result = await emitAnnotationAdd({ commandId, kind, shape, geometry: { origin, target }, visibility: effectiveVisibility, visibleToActorId: effectiveVisibility === "gm-actor" ? defaultActorId : null, movableByOthers: false, color: sessionColor, expectedRevision: revision });
      if (result.ok && kind === "shape") { setTool("select"); setSelectedId(commandId); }
      return result;
    }, "That could not be added to the map.");
  };
  const submitPing = (point: Point) => runAnnotation("ping", () => emitAnnotationPing({ commandId: newId(), point, color: sessionColor, expectedRevision: revision }), "The ping could not be sent.");
  const setColor = (id: string, color: string) => runAnnotation(id, () => emitAnnotationSetColor({ commandId: newId(), id, color, expectedRevision: revision }), "The color could not be changed.");
  const submitAnnotationMove = (id: string, origin: Point, target: Point) => runAnnotation(id, () => emitAnnotationMove({ commandId: newId(), id, geometry: { origin, target }, expectedRevision: revision }), "That could not be moved.");
  const removeAnnotation = (id: string) => runAnnotation(id, () => emitAnnotationRemove({ commandId: newId(), id, expectedRevision: revision }), "That could not be removed.");
  const setVisibility = (id: string, visibility: AnnotationVisibility, visibleToActorId: string | null) => runAnnotation(id, () => emitAnnotationSetVisibility({ commandId: newId(), id, visibility, visibleToActorId, expectedRevision: revision }), "The visibility could not be changed.");
  const setMovable = (id: string, movableByOthers: boolean) => runAnnotation(id, () => emitAnnotationSetMovable({ commandId: newId(), id, movableByOthers, expectedRevision: revision }), "Move control could not be changed.");
  const clearAnnotations = (scope: "mine" | "players" | "all") => { setWrenchOpen(false); void runAnnotation("clear", () => emitAnnotationClear({ commandId: newId(), scope, expectedRevision: revision }), "Shapes could not be removed."); };

  const clearLongPress = () => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
    longPressRef.current = null;
  };
  const openContextMenuFor = (actorId: string, x: number, y: number) => {
    if (!actorsById.has(actorId)) return;
    if (role === "player" && !canMove(actorId)) return; // players only act on their own claimed token
    setSelectedId(null);
    setContextMenu({ actorId, x, y });
  };
  // Mouse right-click opens the token menu; touch uses a long-press started in beginGesture.
  const onContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    const actorId = (event.target as Element).closest<HTMLElement>("[data-token-id]")?.dataset.tokenId;
    if (!actorId || !tokensById.has(actorId)) return; // let the browser's default menu show off-token
    if (role === "player" && !canMove(actorId)) return;
    event.preventDefault();
    openContextMenuFor(actorId, event.clientX, event.clientY);
  };

  const beginGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (busyActorId) return;
    const target = event.target as Element;
    if (target.closest(".encounter-map-overlay, .encounter-map-zoom, .encounter-shape-editor, .encounter-map-dock, .encounter-map-dock-resize, .encounter-target-bar")) return;
    if (tool === "ping") {
      const point = pointFromScreen(event.clientX, event.clientY); if (!point) return;
      event.preventDefault(); void submitPing(point);
      return;
    }
    // Placing an area template takes over the drag (GM only): draw the template's shape anywhere,
    // even starting on a token — the server computes who is caught.
    if (activeTargeting?.mode === "template" && activeTargeting.template && calibration) {
      const point = pointFromScreen(event.clientX, event.clientY); if (!point) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      setSelectedId(null); setGesture({ kind: activeTargeting.template.shape, origin: point, current: point });
      return;
    }
    const handleId = target.closest<HTMLElement>("[data-annotation-handle]")?.dataset.annotationHandle;
    const shapeId = target.closest<HTMLElement>("[data-annotation-id]")?.dataset.annotationId;
    if (tool === "select" && shapeId) {
      const annotation = annotationAt(shapeId);
      // When the GM works on the GM layer, only GM-layer (gm-only) shapes are interactive.
      if (annotation && annotation.kind === "shape" && !(role === "gm" && gmLayer && annotation.visibility !== "gm-only")) {
        setSelectedId(shapeId);
        if (canMoveShape(annotation) && handleId) {
          const point = pointFromScreen(event.clientX, event.clientY); if (!point) return;
          event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
          if (handleId === "resize") setGesture({ kind: "annotation-resize", id: annotation.id, anchor: annotation.geometry.origin, current: point });
          else setGesture({ kind: "annotation-move", id: annotation.id, grab: { x: point.x - annotation.geometry.origin.x, y: point.y - annotation.geometry.origin.y }, geometry: annotation.geometry });
        }
        return;
      }
    }
    const tokenId = target.closest<HTMLElement>("[data-token-id]")?.dataset.tokenId;
    // Click-to-target intercepts token pointer-downs while a targeting session is live (GM only):
    // selecting a target must never start a drag. The attacker itself stays draggable.
    if (activeTargeting && tokenId && tokensById.has(tokenId) && tokenId !== activeTargeting.attackerId) {
      event.preventDefault();
      toggleTarget(tokenId);
      return;
    }
    if (tool === "select" && tokenId && tokensById.has(tokenId)) {
      if (!canMove(tokenId)) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      setSelectedId(null);
      const origin = tokensById.get(tokenId)?.position ?? null;
      setMessage(""); setGesture({ kind: "token", actorId: tokenId, point: origin, origin });
      if (event.pointerType === "touch") {
        const captureEl = event.currentTarget, pointerId = event.pointerId, startX = event.clientX, startY = event.clientY;
        clearLongPress();
        longPressRef.current = { startX, startY };
        longPressTimerRef.current = setTimeout(() => {
          clearLongPress();
          try { captureEl.releasePointerCapture(pointerId); } catch { /* pointer already released */ }
          setGesture(null);
          openContextMenuFor(tokenId, startX, startY);
        }, 500);
      }
      return;
    }
    if (tool !== "select" && calibration) {
      const point = pointFromScreen(event.clientX, event.clientY); if (!point) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      setMessage(""); setGesture({ kind: tool, origin: point, current: point });
      return;
    }
    // Empty background in select mode: deselect + pan.
    const svg = svgRef.current;
    if (tool !== "select" || !svg || !size || !(event.target as Element).closest("svg")) return;
    setSelectedId(null);
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    const rect = svg.getBoundingClientRect();
    setGesture({ kind: "pan", startClient: { x: event.clientX, y: event.clientY }, startCenter: camera.center, scaleX: (size.width / camera.zoom) / rect.width, scaleY: (size.height / camera.zoom) / rect.height });
  };
  const continueGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!gesture || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.preventDefault();
    if (gesture.kind === "token") {
      if (longPressRef.current && (Math.abs(event.clientX - longPressRef.current.startX) > 8 || Math.abs(event.clientY - longPressRef.current.startY) > 8)) clearLongPress();
      setGesture({ ...gesture, point: pointFromScreen(event.clientX, event.clientY) });
      return;
    }
    if (gesture.kind === "pan") {
      const dx = (event.clientX - gesture.startClient.x) * gesture.scaleX;
      const dy = (event.clientY - gesture.startClient.y) * gesture.scaleY;
      setCamera((current) => ({ ...current, center: { x: gesture.startCenter.x - dx, y: gesture.startCenter.y - dy } }));
      return;
    }
    const point = pointFromScreen(event.clientX, event.clientY); if (!point) return;
    if (gesture.kind === "annotation-resize") { setGesture({ ...gesture, current: point }); return; }
    if (gesture.kind === "annotation-move") {
      const width = gesture.geometry.target.x - gesture.geometry.origin.x;
      const height = gesture.geometry.target.y - gesture.geometry.origin.y;
      const origin = { x: point.x - gesture.grab.x, y: point.y - gesture.grab.y };
      setGesture({ ...gesture, geometry: { origin, target: { x: origin.x + width, y: origin.y + height } } });
      return;
    }
    setGesture({ ...gesture, current: point });
  };
  const finishGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    clearLongPress();
    if (!gesture || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.preventDefault(); event.currentTarget.releasePointerCapture(event.pointerId);
    if (gesture.kind === "pan") { setGesture(null); return; }
    if (gesture.kind === "token") {
      const actorId = gesture.actorId;
      const originalPosition = gesture.origin;
      const mapPoint = gesture.point;
      const trayBounds = trayRef.current?.getBoundingClientRect();
      const overTray = Boolean(trayBounds && event.clientX >= trayBounds.left && event.clientX <= trayBounds.right && event.clientY >= trayBounds.top && event.clientY <= trayBounds.bottom);
      setGesture(null);
      const originalToken = tokensById.get(actorId);
      const unchanged = Boolean(mapPoint && originalPosition && Math.hypot(mapPoint.x - originalPosition.x, mapPoint.y - originalPosition.y) < (originalToken?.gridSizePx ? originalToken.gridSizePx * .45 : .5));
      if (overTray) void submitMove(actorId, null);
      else if (unchanged) setMessage("Token stayed in the same space.");
      else if (mapPoint) void submitMove(actorId, mapPoint);
      else setMessage("Move cancelled. Drop the token on the map or in the tray.");
      return;
    }
    if (gesture.kind === "annotation-resize") { setGesture(null); void submitAnnotationMove(gesture.id, gesture.anchor, gesture.current); return; }
    if (gesture.kind === "annotation-move") { setGesture(null); void submitAnnotationMove(gesture.id, gesture.geometry.origin, gesture.geometry.target); return; }
    if (gesture.kind === "measure") { setGesture(null); void submitAnnotationAdd("measurement", undefined, gesture.origin, gesture.current); return; }
    // A shape drawn while placing an area template is stored on the targeting session, not added as a
    // standalone annotation — the server draws the real blast when the action resolves.
    if (activeTargeting?.mode === "template") { const { origin, current } = gesture; setGesture(null); setTemplatePlacement(origin, current); return; }
    setGesture(null); void submitAnnotationAdd("shape", gesture.kind, gesture.origin, gesture.current);
  };
  const cancelGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    clearLongPress();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setGesture(null); setMessage("Cancelled.");
  };
  const keyboardMove = (event: React.KeyboardEvent<SVGGElement>, encounterToken: EncounterToken) => {
    if (!encounterToken.position || busyActorId || !canMove(encounterToken.actorId)) return;
    const step = encounterToken.gridSizePx ?? encounterToken.sizePx;
    const rotation = encounterToken.gridRotationRadians ?? 0;
    const horizontal = { x: Math.cos(rotation) * step, y: Math.sin(rotation) * step };
    const vertical = { x: -Math.sin(rotation) * step, y: Math.cos(rotation) * step };
    const delta = event.key === "ArrowLeft" ? { x: -horizontal.x, y: -horizontal.y }
      : event.key === "ArrowRight" ? horizontal
        : event.key === "ArrowUp" ? { x: -vertical.x, y: -vertical.y }
          : event.key === "ArrowDown" ? vertical : null;
    if (delta) {
      event.preventDefault(); void submitMove(encounterToken.actorId, { x: encounterToken.position.x + delta.x, y: encounterToken.position.y + delta.y });
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault(); void submitMove(encounterToken.actorId, null);
    }
  };

  const unplaced = tokens.filter((encounterToken) => encounterToken.position === null && canMove(encounterToken.actorId));
  const dragging = gesture?.kind === "token" ? gesture : null;
  // Show the dragged token snapped to the grid live (mirrors the server snap on release).
  const draggingSizeCells = dragging ? tokens.find((token) => token.actorId === dragging.actorId)?.sizeCells ?? 1 : 1;
  const dragSnappedPoint = dragging?.point ? (calibration ? snapCellCenterPreview(calibration, dragging.point, draggingSizeCells) : dragging.point) : null;
  const visibleTokens = tokens.flatMap((encounterToken) => {
    const position = dragging?.actorId === encounterToken.actorId ? dragSnappedPoint : encounterToken.position;
    return position ? [{ ...encounterToken, position }] : [];
  });
  const viewBox = size ? (() => {
    const width = size.width / camera.zoom, height = size.height / camera.zoom;
    return `${camera.center.x - width / 2} ${camera.center.y - height / 2} ${width} ${height}`;
  })() : "0 0 1 1";
  // Cells occupied by every OTHER visible token (players never receive hidden tokens, so no leak).
  const occupiedByOthers = rulerWhileMoving && showOccupied && calibration && dragging
    ? new Set<string>(tokens.flatMap((encounterToken) => encounterToken.actorId !== dragging.actorId && encounterToken.position ? [...footprintCells(calibration, encounterToken.position, encounterToken.sizeCells)] : []))
    : null;
  const liveMove = rulerWhileMoving && calibration && dragSnappedPoint && dragging?.origin && occupiedByOthers
    ? occupiedPathCost(calibration, dragging.origin, dragSnappedPoint, occupiedByOthers)
    : null;

  // Live, grid-snapped preview for the in-progress measure/shape/move/resize gesture (WYSIWYG with the saved result).
  const preview: { data: AnnotationGlyphData; snap: SnappedGeometry } | null = (() => {
    if (!calibration || !gesture) return null;
    if (gesture.kind === "measure") { const snap = snapMeasurementPreview(calibration, gesture.origin, gesture.current); return { snap, data: { kind: "measurement", shape: null, origin: snap.origin, target: snap.target, sizeFeet: snap.feet } }; }
    if (gesture.kind === "circle" || gesture.kind === "cone" || gesture.kind === "line" || gesture.kind === "square") { const shape = gesture.kind; const snap = snapShapePreview(calibration, shape, gesture.origin, gesture.current); return { snap, data: { kind: "shape", shape, origin: snap.origin, target: snap.target, sizeFeet: snap.feet } }; }
    if (gesture.kind === "annotation-resize") { const live = annotationAt(gesture.id); if (live?.kind !== "shape" || !live.shape) return null; const snap = snapShapePreview(calibration, live.shape, gesture.anchor, gesture.current); return { snap, data: { kind: "shape", shape: live.shape, origin: snap.origin, target: snap.target, sizeFeet: snap.feet } }; }
    if (gesture.kind === "annotation-move") { const live = annotationAt(gesture.id); if (live?.kind !== "shape" || !live.shape) return null; const snap = snapShapePreview(calibration, live.shape, gesture.geometry.origin, gesture.geometry.target); return { snap, data: { kind: "shape", shape: live.shape, origin: snap.origin, target: snap.target, sizeFeet: snap.feet } }; }
    return null;
  })();

  const selected = selectedId ? annotationAt(selectedId) : null;
  const visibilityOptions = visibilityOptionsFor(role);
  const wrenchScopes: ReadonlyArray<{ scope: "mine" | "players" | "all"; label: string }> = role === "gm"
    ? [{ scope: "mine", label: "Remove all my shapes" }, { scope: "players", label: "Remove all player shapes" }, { scope: "all", label: "Remove all shapes" }]
    : [{ scope: "mine", label: "Remove all my shapes" }];

  return <div className={`encounter-map-interaction ${enlarged ? "enlarged" : ""}`} onPointerDown={beginGesture} onPointerMove={continueGesture} onPointerUp={finishGesture} onPointerCancel={cancelGesture} onContextMenu={onContextMenu}>
    {/* No permanent tutorial captions (ux-principles: if it needs a banner, redesign it) — the tray
        appears only while it has tokens to place or a drag could drop one back in. */}
    {(unplaced.length > 0 || dragging) && <div className={`encounter-token-tray${dragging ? " receiving" : ""}`} ref={trayRef} aria-label="Unplaced token tray">
      <div><strong>Token tray</strong><span>{unplaced.length ? "Drag onto the map, click to place near its center, or press Enter." : "Drag a token here to take it off the map."}</span></div>
      <div className="encounter-token-tray-list">{unplaced.map((encounterToken) => {
        const actor = actorsById.get(encounterToken.actorId); if (!actor) return null;
        return <button key={encounterToken.actorId} data-token-id={encounterToken.actorId} className={`tray-token ${actor.kind}${actor.visibility === "gm-only" ? " hidden" : ""}`} disabled={busyActorId !== null} onClick={() => placeAtCenter(encounterToken.actorId)}><span>{initialsOf(actor.name)}</span><strong>{actor.name}</strong></button>;
      })}</div>
    </div>}
    <div className={`encounter-map-stage${dock?.node ? ` has-dock has-dock-${dock.position}` : ""}`} ref={stageRef} style={dock?.node ? ({ "--dock-side-width": `${dock.width}px` } as React.CSSProperties) : undefined} aria-busy={image.status !== "ready"}>
      {image.status === "ready" && size ? <>
        <div className="encounter-map-overlay" role="group" aria-label="Map tools">
          {TOOLS.filter((entry) => entry.id === "select" || entry.id === "ping" || entry.id === "measure").map((entry) => <button key={entry.id} type="button" className="encounter-map-icon" aria-label={entry.label} title={entry.label} aria-pressed={tool === entry.id} disabled={entry.id === "measure" && !calibration} onClick={() => setTool(entry.id)}>{entry.glyph}</button>)}
          <button type="button" className="encounter-map-icon" aria-pressed={drawOpen} aria-expanded={drawOpen} title="Drawing tools — shapes, color, visibility, cleanup" onClick={() => { setDrawOpen((v) => { if (v && (tool === "circle" || tool === "cone" || tool === "line" || tool === "square")) setTool("select"); return !v; }); setEyeOpen(false); setColorOpen(false); setWrenchOpen(false); }}>✏</button>
          {drawOpen && <>
            <div className="encounter-map-tools">
              {TOOLS.filter((entry) => entry.id === "circle" || entry.id === "cone" || entry.id === "line" || entry.id === "square").map((entry) => <button key={entry.id} type="button" className="encounter-map-icon" aria-label={entry.label} title={entry.label} aria-pressed={tool === entry.id} disabled={!calibration} onClick={() => setTool(entry.id)}>{entry.glyph}</button>)}
            </div>
            <div className="encounter-map-eye">
              <button type="button" className="encounter-map-icon" aria-haspopup="menu" aria-expanded={eyeOpen} title={`New drawings visible to: ${VISIBILITY_SHORT[defaultVisibility]}`} onClick={() => { setEyeOpen((v) => !v); setWrenchOpen(false); }}>👁</button>
              {eyeOpen && <div className="encounter-map-menu" role="menu">
                <p className="encounter-map-menu-title">New drawings visible to</p>
                {visibilityOptions.map((option) => <button key={option.value} type="button" role="menuitemradio" aria-checked={defaultVisibility === option.value} className={defaultVisibility === option.value ? "selected" : ""} onClick={() => { setDefaultVisibility(option.value); if (option.value !== "gm-actor") setEyeOpen(false); }}>{option.label}</button>)}
                {defaultVisibility === "gm-actor" && <label className="encounter-map-menu-select">Character<select value={defaultActorId ?? ""} onChange={(event) => setDefaultActorId(event.target.value || null)}><option value="">Choose…</option>{characters.map((actor) => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label>}
              </div>}
            </div>
            <div className="encounter-map-color">
              <button type="button" className="encounter-map-icon" aria-haspopup="menu" aria-expanded={colorOpen} title={`Your drawing color: ${sessionColor}`} style={{ color: sessionColor }} onClick={() => { setColorOpen((v) => !v); setEyeOpen(false); setWrenchOpen(false); }}>🎨</button>
              {colorOpen && <div className="encounter-map-menu" role="menu">
                <p className="encounter-map-menu-title">Your color</p>
                <div className="encounter-map-swatches">{PLAYER_COLORS.map((swatch) => <button key={swatch} type="button" aria-label={swatch} className={sessionColor.toLowerCase() === swatch ? "selected" : ""} style={{ background: swatch }} onClick={() => { setSessionColor(swatch); setColorOpen(false); }} />)}</div>
                <label className="encounter-map-menu-select">Custom<input type="color" value={sessionColor} onChange={(event) => setSessionColor(event.target.value)} /></label>
              </div>}
            </div>
            <button type="button" className="encounter-map-icon" aria-pressed={rulerWhileMoving} disabled={!calibration} title="Show distance while moving a token" onClick={() => setRulerWhileMoving((v) => !v)}>⇲</button>
            {role === "gm" && <button type="button" className="encounter-map-icon" aria-pressed={showOccupied} disabled={!calibration} title={showOccupied ? "Occupied-cell movement cost: on — extra 5 ft per occupied square crossed" : "Occupied-cell movement cost: off"} onClick={() => setShowOccupied((v) => !v)}>⛌</button>}
            {role === "gm" && <button type="button" className="encounter-map-icon" aria-pressed={gmLayer} title={gmLayer ? "GM layer active — new drawings are hidden from players and only GM-layer objects are interactive" : "Switch to the GM layer (drawings hidden from players)"} onClick={() => setGmLayer((v) => !v)}>🕶</button>}
            <div className="encounter-map-wrench">
              <button type="button" className="encounter-map-icon" aria-haspopup="menu" aria-expanded={wrenchOpen} title="Remove shapes" onClick={() => { setWrenchOpen((v) => !v); setEyeOpen(false); }}>🛠</button>
              {wrenchOpen && <div className="encounter-map-menu" role="menu">
                {wrenchScopes.map((entry) => <button key={entry.scope} type="button" role="menuitem" onClick={() => clearAnnotations(entry.scope)}>{entry.label}</button>)}
              </div>}
            </div>
          </>}
        </div>

        <svg ref={svgRef} viewBox={viewBox} preserveAspectRatio="xMidYMid meet" role="group" aria-label={`${altText}. Interactive encounter tokens are layered above this map.`}>
          <image href={image.url} width={size.width} height={size.height} role="img" aria-label={altText} />

          {/* Shapes render below tokens; measurements render above tokens (further down) so they read over the pieces. */}
          {annotations.map((annotation) => {
            if (annotation.kind !== "shape") return null;
            const beingDragged = (gesture?.kind === "annotation-move" || gesture?.kind === "annotation-resize") && gesture.id === annotation.id;
            if (beingDragged) return null;
            const selectedShape = selectedId === annotation.id;
            const editable = tool === "select" && selectedShape && canMoveShape(annotation);
            return <g key={annotation.id} data-annotation-id={annotation.id} className={`annotation-shape visibility-${annotation.visibility}${selectedShape ? " selected" : ""}`}>
              <AnnotationGlyph data={{ kind: "shape", shape: annotation.shape, origin: annotation.geometry.origin, target: annotation.geometry.target, sizeFeet: annotation.geometry.sizeFeet }} arrowSize={arrowSize} labelSize={labelSize} color={annotation.color} />
              {editable && <>
                <circle data-annotation-handle="move" className="annotation-handle annotation-handle-move" cx={annotation.geometry.origin.x} cy={annotation.geometry.origin.y} r={handleRadius} />
                <circle data-annotation-handle="resize" className="annotation-handle annotation-handle-resize" cx={annotation.geometry.target.x} cy={annotation.geometry.target.y} r={handleRadius} />
              </>}
            </g>;
          })}
          {preview && preview.data.kind === "shape" && <g className="annotation-shape live"><AnnotationGlyph data={preview.data} arrowSize={arrowSize} labelSize={labelSize} color={sessionColor} /></g>}
          {activeTargeting?.mode === "template" && activeTargeting.template?.placed && calibration && !preview && (() => {
            const snap = snapShapePreview(calibration, activeTargeting.template.shape, activeTargeting.template.placed.origin, activeTargeting.template.placed.target);
            return <g className="annotation-shape live"><AnnotationGlyph data={{ kind: "shape", shape: activeTargeting.template.shape, origin: snap.origin, target: snap.target, sizeFeet: snap.feet }} arrowSize={arrowSize} labelSize={labelSize} color="#ff9d5c" /></g>;
          })()}

          {visibleTokens.map((encounterToken) => {
            const actor = actorsById.get(encounterToken.actorId); if (!actor) return null;
            const movable = tool === "select" && canMove(actor.id);
            const active = activeActorId === actor.id;
            const targetable = activeTargeting !== null && activeTargeting.mode !== "template" && actor.id !== activeTargeting.attackerId;
            const targeted = targetable && activeTargeting.selected.includes(actor.id);
            return <g key={actor.id} data-token-id={actor.id} transform={`translate(${encounterToken.position.x} ${encounterToken.position.y})`} className={`encounter-token ${actor.kind}${movable ? " movable" : " locked"}${actor.visibility === "gm-only" ? " hidden" : ""}${active ? " active" : ""}${dragging?.actorId === actor.id ? " dragging" : ""}${targetable ? " targetable" : ""}${targeted ? " targeted" : ""}`} role={movable ? "button" : "img"} tabIndex={movable ? 0 : undefined} aria-label={`${actor.name}${active ? ", active turn" : ""}${movable ? ". Drag to move; arrow keys move one step; Delete returns it to the tray." : ", view only."}`} aria-keyshortcuts={movable ? "ArrowUp ArrowDown ArrowLeft ArrowRight Delete" : undefined} onKeyDown={movable ? (event) => keyboardMove(event, encounterToken) : undefined}>
              <title>{actor.name}{actor.visibility === "gm-only" ? " (hidden from players)" : ""}</title>
              <AuthorizedTokenGlyph assetId={actor.tokenAssetId ?? null} token={token} sizePx={encounterToken.sizePx} name={actor.name} active={active} turnClassName="encounter-token-turn" bodyClassName="encounter-token-body" initialsClassName="encounter-token-initials" nameClassName="encounter-token-name" nameY={encounterToken.sizePx * .72} initialsStyle={{ fontSize: Math.max(10, encounterToken.sizePx * .34) }} nameStyle={{ fontSize: Math.max(9, encounterToken.sizePx * .23) }} />
              <TokenStatusBadges sizePx={encounterToken.sizePx} health={healthBandFor(actor.hp)} conditions={actor.conditions.map(conditionBadgeLabel)} />
            </g>;
          })}
          {/* Measurements and pings render above the token layer so they're never hidden behind a piece. */}
          {annotations.map((annotation) => annotation.kind === "measurement"
            ? <AnnotationGlyph key={annotation.id} data={{ kind: "measurement", shape: null, origin: annotation.geometry.origin, target: annotation.geometry.target, sizeFeet: annotation.geometry.sizeFeet }} arrowSize={arrowSize} labelSize={labelSize} color={annotation.color} expiring />
            : null)}
          {preview && preview.data.kind === "measurement" && <AnnotationGlyph data={preview.data} arrowSize={arrowSize} labelSize={labelSize} color={sessionColor} labelPoint={{ x: preview.snap.target.x, y: preview.snap.target.y }} />}
          {annotations.map((annotation) => annotation.kind === "ping"
            ? <PingGlyph key={annotation.id} point={annotation.geometry.origin} color={annotation.color} label={annotation.label} size={pingSize} />
            : null)}
          {liveMove !== null && dragSnappedPoint && dragging?.origin && <g className="encounter-move-guide">
            <line className="encounter-move-line" x1={dragging.origin.x} y1={dragging.origin.y} x2={dragSnappedPoint.x} y2={dragSnappedPoint.y} />
            <text className="encounter-live-distance" style={{ fontSize: labelSize, strokeWidth: Math.max(3, labelSize * 0.22) }} x={dragSnappedPoint.x} y={dragSnappedPoint.y - labelSize * 1.3}>{liveMove.penaltyFeet > 0 ? `${liveMove.baseFeet} ft + ${liveMove.penaltyFeet} ft (occupied)` : `${liveMove.baseFeet} ft`}</text>
          </g>}
        </svg>

        {selected && selected.kind === "shape" && tool === "select" && (() => {
          const center = annotationCenter({ kind: "shape", shape: selected.shape, origin: selected.geometry.origin, target: selected.geometry.target, sizeFeet: selected.geometry.sizeFeet });
          const busy = annotationBusy === selected.id;
          const manage = canManageShape(selected);
          return <div className="encounter-shape-editor" role="group" aria-label="Selected shape">
            <div className="encounter-shape-editor-head"><strong>{selected.geometry.sizeFeet}ft {selected.shape}</strong>{center && <span>at {Math.round(center.x)}, {Math.round(center.y)}</span>}</div>
            {manage ? <>
              <label className="encounter-shape-editor-color">Color<input type="color" value={selected.color} disabled={busy} onChange={(event) => setColor(selected.id, event.target.value)} /></label>
              <label>Visible to<select value={selected.visibility} disabled={busy} onChange={(event) => { const value = event.target.value as AnnotationVisibility; setVisibility(selected.id, value, value === "gm-actor" ? (selected.visibleToActorId ?? characters[0]?.id ?? null) : null); }}>{visibilityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              {selected.visibility === "gm-actor" && <label>Character<select value={selected.visibleToActorId ?? ""} disabled={busy} onChange={(event) => setVisibility(selected.id, "gm-actor", event.target.value || null)}><option value="">Choose…</option>{characters.map((actor) => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label>}
              <label className="encounter-shape-editor-check"><input type="checkbox" checked={selected.movableByOthers} disabled={busy} onChange={(event) => setMovable(selected.id, event.target.checked)} /> Others can move this</label>
              <button type="button" className="danger" disabled={busy} onClick={() => { setSelectedId(null); void removeAnnotation(selected.id); }}>Delete shape</button>
            </> : <p className="encounter-shape-editor-note">Visible to {VISIBILITY_SHORT[selected.visibility]}{selected.movableByOthers ? " · shared" : ""}</p>}
          </div>;
        })()}

        {dock?.node && <>
          <div className={`encounter-map-dock dock-${dock.position}`}>{dock.node}</div>
          <div className={`encounter-map-dock-resize dock-resize-${dock.position}`} role="separator" aria-label="Drag to resize the docked tracker" title="Drag to resize" onPointerDown={beginDockResize} />
        </>}

        {activeTargeting && (() => {
          const isTemplate = activeTargeting.mode === "template";
          const names = activeTargeting.selected.map((id) => actorsById.get(id)?.name ?? "?");
          const label = isTemplate
            ? (activeTargeting.template?.placed ? " — placed; Roll to catch everyone under it" : ` — drag the ${activeTargeting.action.area?.sizeFeet}-ft ${activeTargeting.action.area?.shape} on the map`)
            : names.length ? ` → ${names.join(", ")}` : activeTargeting.mode === "single" ? " — click a token to target it" : " — click tokens to target them";
          const ready = isTemplate ? Boolean(activeTargeting.template?.placed) : activeTargeting.selected.length > 0;
          return <div className="encounter-target-bar" role="group" aria-label={`Targets for ${activeTargeting.action.name}`}>
            <span><strong>{activeTargeting.action.name}</strong>{label}</span>
            <span className="encounter-target-bar-buttons">
              <button type="button" className="secondary" disabled={targetingBusy} onClick={() => clearTargeting()}>Cancel</button>
              <button type="button" className="encounter-primary" disabled={targetingBusy || !ready} onClick={() => resolveTargeting(revision, (ok, resultMessage) => setMessage(ok || resultMessage === undefined ? "" : resultMessage))}>Roll {activeTargeting.action.name}</button>
            </span>
          </div>;
        })()}

        <MapToastStack />

        <div className={`encounter-map-zoom${dock?.node ? ` zoom-dock-${dock.position}` : ""}`} role="group" aria-label="Map controls">
          {staging
            ? <span className="encounter-map-scene-live" role="group" aria-label="Staged scene controls">
                <button type="button" className="scene-back" onClick={staging.onBackToLive} title="Return to the scene players see">◀ Live</button>
                <button type="button" className="scene-golive" onClick={staging.onMakeLive} title="Make this the scene players see">Make live ⬆</button>
              </span>
            : onScenePrep && <button type="button" aria-label="Scene prep" title="Scene prep — stage and switch scenes (GM only)" onClick={onScenePrep}>🎬 Scenes</button>}
          {dock && <span className="encounter-map-dock-control" role="group" aria-label="Dock the tracker">
            <button type="button" aria-label="Dock tracker left" aria-pressed={dock.position === "left"} title="Dock tracker left" onClick={() => dock.onChange("left")}>◧</button>
            <button type="button" aria-label="Dock tracker right" aria-pressed={dock.position === "right"} title="Dock tracker right" onClick={() => dock.onChange("right")}>◨</button>
            <button type="button" aria-label="Move tracker to the sidebar" aria-pressed={dock.position === "sidebar"} title="Move tracker to the sidebar" onClick={() => dock.onChange("sidebar")}>▦</button>
          </span>}
          <button type="button" aria-label="Zoom in" onClick={() => zoomCenter(1.3)}>+</button>
          <button type="button" aria-label="Zoom out" onClick={() => zoomCenter(1 / 1.3)}>−</button>
          <button type="button" onClick={resetView}>Reset view</button>
          <button type="button" onClick={toggleEnlarged} disabled={fullscreen}>{enlarged ? "Shrink map" : "Enlarge map"}</button>
          <button type="button" onClick={toggleFullscreen}>{fullscreen ? "Exit fullscreen" : "Fullscreen"}</button>
        </div>
      </> : <p role="status">{image.status === "error" ? image.message : "Loading the battle map…"}</p>}
    </div>
    {busyActorId && <p className="encounter-map-saving" role="status">Saving move…</p>}
    {image.status === "ready" && <p className="encounter-map-feedback" role="status" aria-live="polite">{message}</p>}
    {contextMenu && (() => {
      const actor = actorsById.get(contextMenu.actorId);
      return actor
        ? <TokenContextMenu actor={actor} role={role} gmToken={role === "gm" ? token : null} x={contextMenu.x} y={contextMenu.y} reactionUsed={reactionsUsed.includes(actor.id)} placed={tokensById.get(actor.id)?.position != null} onOpenSheet={() => setSheetActorId(actor.id)} onReturnToTray={() => void submitMove(actor.id, null)} onClose={() => setContextMenu(null)} />
        : null;
    })()}
    {sheetActorId && (() => {
      const actor = actorsById.get(sheetActorId);
      return actor ? <CharacterSheet actor={actor} role={role} onClose={() => setSheetActorId(null)} /> : null;
    })()}
  </div>;
}
