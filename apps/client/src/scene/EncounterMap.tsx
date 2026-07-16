import { useEffect, useMemo, useRef, useState } from "react";
import type { Annotation, AnnotationAddResult, AnnotationShapeKind, AnnotationVisibility, ClientToServerEvents, EncounterToken, EncounterTokenPosition, GmActor, MutationResult, PlayerActor, PlayerAnnotation } from "@vtt/domain";
import { chebyshevFeetPreview, imagePointFromClient, initialsOf, snapMeasurementPreview, snapShapePreview, TokenGlyph, useAuthorizedMapImage, useMapCalibration, type SnappedGeometry } from "./mapImage";
import { AnnotationGlyph, annotationCenter, type AnnotationGlyphData } from "./annotationGlyph";
import { newId } from "../lib/ids";
import { socket } from "../socket";
import "./encounter-map.css";

type Actor = GmActor | PlayerActor;
type Point = EncounterTokenPosition;
type AnyAnnotation = Annotation | PlayerAnnotation;
type Camera = Readonly<{ center: Point; zoom: number }>;
type Tool = "select" | "measure" | AnnotationShapeKind;
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

function isMine(annotation: AnyAnnotation, role: "gm" | "player") {
  return role === "gm" || ("mine" in annotation && annotation.mine);
}

export function EncounterMap({
  assetId, token, altText = "Active encounter battlemap", role, actors, tokens, annotations, revision, activeActorId
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
  const [enlarged, setEnlarged] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [annotationBusy, setAnnotationBusy] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [eyeOpen, setEyeOpen] = useState(false);
  const [wrenchOpen, setWrenchOpen] = useState(false);
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

  useEffect(() => { setGesture(null); setSelectedId(null); }, [assetId, token]);
  useEffect(() => { if (size) setCamera({ center: { x: size.width / 2, y: size.height / 2 }, zoom: 1 }); }, [assetId, size?.width, size?.height]);
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  useEffect(() => { if (tool !== "select") setSelectedId(null); }, [tool]);

  // Wheel-to-zoom needs preventDefault, which React's synthetic onWheel cannot reliably guarantee (passive by default).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      if (!svgRef.current || !size) return;
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
  const resetView = () => { if (size) setCamera({ center: { x: size.width / 2, y: size.height / 2 }, zoom: 1 }); };
  const zoomCenter = (factor: number) => { const svg = svgRef.current; if (!svg || !size) return; const rect = svg.getBoundingClientRect(); zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor); };
  const toggleFullscreen = () => { const el = stageRef.current; if (!el) return; if (document.fullscreenElement) void document.exitFullscreen(); else { setEnlarged(false); void el.requestFullscreen?.(); } };
  const toggleEnlarged = () => setEnlarged((current) => { if (!current && fullscreen) void document.exitFullscreen?.(); return !current; });

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
      const result = await emitMove({ commandId: newId(), actorId, position, expectedRevision: revision });
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
  const submitAnnotationAdd = async (kind: "measurement" | "shape", shape: AnnotationShapeKind | undefined, origin: Point, target: Point) => {
    const commandId = newId();
    await runAnnotation("new", async () => {
      const result = await emitAnnotationAdd({ commandId, kind, shape, geometry: { origin, target }, visibility: defaultVisibility, visibleToActorId: defaultVisibility === "gm-actor" ? defaultActorId : null, movableByOthers: false, expectedRevision: revision });
      if (result.ok && kind === "shape") { setTool("select"); setSelectedId(commandId); }
      return result;
    }, "That could not be added to the map.");
  };
  const submitAnnotationMove = (id: string, origin: Point, target: Point) => runAnnotation(id, () => emitAnnotationMove({ commandId: newId(), id, geometry: { origin, target }, expectedRevision: revision }), "That could not be moved.");
  const removeAnnotation = (id: string) => runAnnotation(id, () => emitAnnotationRemove({ commandId: newId(), id, expectedRevision: revision }), "That could not be removed.");
  const setVisibility = (id: string, visibility: AnnotationVisibility, visibleToActorId: string | null) => runAnnotation(id, () => emitAnnotationSetVisibility({ commandId: newId(), id, visibility, visibleToActorId, expectedRevision: revision }), "The visibility could not be changed.");
  const setMovable = (id: string, movableByOthers: boolean) => runAnnotation(id, () => emitAnnotationSetMovable({ commandId: newId(), id, movableByOthers, expectedRevision: revision }), "Move control could not be changed.");
  const clearAnnotations = (scope: "mine" | "players" | "all") => { setWrenchOpen(false); void runAnnotation("clear", () => emitAnnotationClear({ commandId: newId(), scope, expectedRevision: revision }), "Shapes could not be removed."); };

  const beginGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (busyActorId) return;
    const target = event.target as Element;
    if (target.closest(".encounter-map-overlay, .encounter-map-zoom, .encounter-shape-editor")) return;
    const handleId = target.closest<HTMLElement>("[data-annotation-handle]")?.dataset.annotationHandle;
    const shapeId = target.closest<HTMLElement>("[data-annotation-id]")?.dataset.annotationId;
    if (tool === "select" && shapeId) {
      const annotation = annotationAt(shapeId);
      if (annotation && annotation.kind === "shape") {
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
    if (tool === "select" && tokenId && tokensById.has(tokenId)) {
      if (!canMove(tokenId)) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      setSelectedId(null);
      const origin = tokensById.get(tokenId)?.position ?? null;
      setMessage(""); setGesture({ kind: "token", actorId: tokenId, point: origin, origin });
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
    if (gesture.kind === "token") { setGesture({ ...gesture, point: pointFromScreen(event.clientX, event.clientY) }); return; }
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
      if (unchanged) setMessage("Token stayed in the same space.");
      else if (mapPoint) void submitMove(actorId, mapPoint);
      else if (overTray) void placeAtCenter(actorId);
      else setMessage("Move cancelled. Drop the token on the map or in the tray.");
      return;
    }
    if (gesture.kind === "annotation-resize") { setGesture(null); void submitAnnotationMove(gesture.id, gesture.anchor, gesture.current); return; }
    if (gesture.kind === "annotation-move") { setGesture(null); void submitAnnotationMove(gesture.id, gesture.geometry.origin, gesture.geometry.target); return; }
    if (gesture.kind === "measure") { setGesture(null); void submitAnnotationAdd("measurement", undefined, gesture.origin, gesture.current); return; }
    setGesture(null); void submitAnnotationAdd("shape", gesture.kind, gesture.origin, gesture.current);
  };
  const cancelGesture = (event: React.PointerEvent<HTMLDivElement>) => {
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
  const visibleTokens = tokens.flatMap((encounterToken) => {
    const position = dragging?.actorId === encounterToken.actorId ? dragging.point : encounterToken.position;
    return position ? [{ ...encounterToken, position }] : [];
  });
  const viewBox = size ? (() => {
    const width = size.width / camera.zoom, height = size.height / camera.zoom;
    return `${camera.center.x - width / 2} ${camera.center.y - height / 2} ${width} ${height}`;
  })() : "0 0 1 1";
  const liveTokenDistanceFeet = rulerWhileMoving && calibration && dragging?.point && dragging.origin ? chebyshevFeetPreview(calibration, dragging.origin, dragging.point) : null;

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

  return <div className={`encounter-map-interaction ${enlarged ? "enlarged" : ""}`} onPointerDown={beginGesture} onPointerMove={continueGesture} onPointerUp={finishGesture} onPointerCancel={cancelGesture}>
    <div className="encounter-map-help"><strong>{role === "gm" ? "Drag any token to move it" : "Drag your highlighted character"}</strong><span>{role === "gm" ? "Calibrated maps snap automatically. Drop a token back in the tray to remove it from the map." : "Other tokens are view-only. Your moves snap automatically when the map has a grid."} Scroll or pinch to zoom; drag empty map space to pan.</span></div>
    <div className={`encounter-token-tray${dragging ? " receiving" : ""}`} ref={trayRef} aria-label="Unplaced token tray">
      <div><strong>Token tray</strong><span>{unplaced.length ? "Drag onto the map, click to place near its center, or press Enter." : "Drag a token here to take it off the map."}</span></div>
      <div className="encounter-token-tray-list">{unplaced.map((encounterToken) => {
        const actor = actorsById.get(encounterToken.actorId); if (!actor) return null;
        return <button key={encounterToken.actorId} data-token-id={encounterToken.actorId} className={`tray-token ${actor.kind}${actor.visibility === "gm-only" ? " hidden" : ""}`} disabled={busyActorId !== null} onClick={() => placeAtCenter(encounterToken.actorId)}><span>{initialsOf(actor.name)}</span><strong>{actor.name}</strong></button>;
      })}</div>
    </div>
    <div className="encounter-map-stage" ref={stageRef} aria-busy={image.status !== "ready"}>
      {image.status === "ready" && size ? <>
        <div className="encounter-map-overlay" role="group" aria-label="Map tools">
          <div className="encounter-map-eye">
            <button type="button" className="encounter-map-icon" aria-haspopup="menu" aria-expanded={eyeOpen} title={`New drawings visible to: ${VISIBILITY_SHORT[defaultVisibility]}`} onClick={() => { setEyeOpen((v) => !v); setWrenchOpen(false); }}>◉</button>
            {eyeOpen && <div className="encounter-map-menu" role="menu">
              <p className="encounter-map-menu-title">New drawings visible to</p>
              {visibilityOptions.map((option) => <button key={option.value} type="button" role="menuitemradio" aria-checked={defaultVisibility === option.value} className={defaultVisibility === option.value ? "selected" : ""} onClick={() => { setDefaultVisibility(option.value); if (option.value !== "gm-actor") setEyeOpen(false); }}>{option.label}</button>)}
              {defaultVisibility === "gm-actor" && <label className="encounter-map-menu-select">Character<select value={defaultActorId ?? ""} onChange={(event) => setDefaultActorId(event.target.value || null)}><option value="">Choose…</option>{characters.map((actor) => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label>}
            </div>}
          </div>
          <div className="encounter-map-tools">
            {TOOLS.map((entry) => <button key={entry.id} type="button" className="encounter-map-icon" aria-label={entry.label} title={entry.label} aria-pressed={tool === entry.id} disabled={entry.id !== "select" && !calibration} onClick={() => setTool(entry.id)}>{entry.glyph}</button>)}
          </div>
          <button type="button" className="encounter-map-icon" aria-pressed={rulerWhileMoving} disabled={!calibration} title="Show distance while moving a token" onClick={() => setRulerWhileMoving((v) => !v)}>⇲</button>
          <div className="encounter-map-wrench">
            <button type="button" className="encounter-map-icon" aria-haspopup="menu" aria-expanded={wrenchOpen} title="Remove shapes" onClick={() => { setWrenchOpen((v) => !v); setEyeOpen(false); }}>🛠</button>
            {wrenchOpen && <div className="encounter-map-menu" role="menu">
              {wrenchScopes.map((entry) => <button key={entry.scope} type="button" role="menuitem" onClick={() => clearAnnotations(entry.scope)}>{entry.label}</button>)}
            </div>}
          </div>
        </div>

        <svg ref={svgRef} viewBox={viewBox} preserveAspectRatio="xMidYMid meet" role="group" aria-label={`${altText}. Interactive encounter tokens are layered above this map.`}>
          <image href={image.url} width={size.width} height={size.height} role="img" aria-label={altText} />

          {annotations.map((annotation) => {
            const beingDragged = (gesture?.kind === "annotation-move" || gesture?.kind === "annotation-resize") && gesture.id === annotation.id;
            if (beingDragged) return null;
            if (annotation.kind === "measurement") return <AnnotationGlyph key={annotation.id} data={{ kind: "measurement", shape: null, origin: annotation.geometry.origin, target: annotation.geometry.target, sizeFeet: annotation.geometry.sizeFeet }} arrowSize={arrowSize} expiring />;
            const selectedShape = selectedId === annotation.id;
            const editable = tool === "select" && selectedShape && canMoveShape(annotation);
            return <g key={annotation.id} data-annotation-id={annotation.id} className={`annotation-shape visibility-${annotation.visibility}${selectedShape ? " selected" : ""}`}>
              <AnnotationGlyph data={{ kind: "shape", shape: annotation.shape, origin: annotation.geometry.origin, target: annotation.geometry.target, sizeFeet: annotation.geometry.sizeFeet }} arrowSize={arrowSize} />
              {editable && <>
                <circle data-annotation-handle="move" className="annotation-handle annotation-handle-move" cx={annotation.geometry.origin.x} cy={annotation.geometry.origin.y} r={handleRadius} />
                <circle data-annotation-handle="resize" className="annotation-handle annotation-handle-resize" cx={annotation.geometry.target.x} cy={annotation.geometry.target.y} r={handleRadius} />
              </>}
            </g>;
          })}

          {preview && preview.data.kind === "measurement" && <AnnotationGlyph data={preview.data} arrowSize={arrowSize} labelPoint={{ x: preview.snap.target.x, y: preview.snap.target.y }} />}
          {preview && preview.data.kind === "shape" && <g className="annotation-shape live"><AnnotationGlyph data={preview.data} arrowSize={arrowSize} /></g>}

          {visibleTokens.map((encounterToken) => {
            const actor = actorsById.get(encounterToken.actorId); if (!actor) return null;
            const movable = tool === "select" && canMove(actor.id);
            const active = activeActorId === actor.id;
            return <g key={actor.id} data-token-id={actor.id} transform={`translate(${encounterToken.position.x} ${encounterToken.position.y})`} className={`encounter-token ${actor.kind}${movable ? " movable" : " locked"}${actor.visibility === "gm-only" ? " hidden" : ""}${active ? " active" : ""}${dragging?.actorId === actor.id ? " dragging" : ""}`} role={movable ? "button" : "img"} tabIndex={movable ? 0 : undefined} aria-label={`${actor.name}${active ? ", active turn" : ""}${movable ? ". Drag to move; arrow keys move one step; Delete returns it to the tray." : ", view only."}`} aria-keyshortcuts={movable ? "ArrowUp ArrowDown ArrowLeft ArrowRight Delete" : undefined} onKeyDown={movable ? (event) => keyboardMove(event, encounterToken) : undefined}>
              <title>{actor.name}{actor.visibility === "gm-only" ? " (hidden from players)" : ""}</title>
              <TokenGlyph sizePx={encounterToken.sizePx} name={actor.name} active={active} turnClassName="encounter-token-turn" bodyClassName="encounter-token-body" initialsClassName="encounter-token-initials" nameClassName="encounter-token-name" nameY={encounterToken.sizePx * .72} initialsStyle={{ fontSize: Math.max(10, encounterToken.sizePx * .34) }} nameStyle={{ fontSize: Math.max(9, encounterToken.sizePx * .23) }} />
            </g>;
          })}
          {liveTokenDistanceFeet !== null && dragging?.point && <text className="encounter-live-distance" x={dragging.point.x} y={dragging.point.y - 24}>{liveTokenDistanceFeet} ft</text>}
        </svg>

        {selected && selected.kind === "shape" && tool === "select" && (() => {
          const center = annotationCenter({ kind: "shape", shape: selected.shape, origin: selected.geometry.origin, target: selected.geometry.target, sizeFeet: selected.geometry.sizeFeet });
          const busy = annotationBusy === selected.id;
          const manage = canManageShape(selected);
          return <div className="encounter-shape-editor" role="group" aria-label="Selected shape">
            <div className="encounter-shape-editor-head"><strong>{selected.geometry.sizeFeet}ft {selected.shape}</strong>{center && <span>at {Math.round(center.x)}, {Math.round(center.y)}</span>}</div>
            {manage ? <>
              <label>Visible to<select value={selected.visibility} disabled={busy} onChange={(event) => { const value = event.target.value as AnnotationVisibility; setVisibility(selected.id, value, value === "gm-actor" ? (selected.visibleToActorId ?? characters[0]?.id ?? null) : null); }}>{visibilityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              {selected.visibility === "gm-actor" && <label>Character<select value={selected.visibleToActorId ?? ""} disabled={busy} onChange={(event) => setVisibility(selected.id, "gm-actor", event.target.value || null)}><option value="">Choose…</option>{characters.map((actor) => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label>}
              <label className="encounter-shape-editor-check"><input type="checkbox" checked={selected.movableByOthers} disabled={busy} onChange={(event) => setMovable(selected.id, event.target.checked)} /> Others can move this</label>
              <button type="button" className="danger" disabled={busy} onClick={() => { setSelectedId(null); void removeAnnotation(selected.id); }}>Delete shape</button>
            </> : <p className="encounter-shape-editor-note">Visible to {VISIBILITY_SHORT[selected.visibility]}{selected.movableByOthers ? " · shared" : ""}</p>}
          </div>;
        })()}

        <div className="encounter-map-zoom" role="group" aria-label="Map controls">
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
  </div>;
}
