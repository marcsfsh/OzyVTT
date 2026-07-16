import { useEffect, useMemo, useRef, useState } from "react";
import type { Annotation, AnnotationAddResult, AnnotationShapeKind, AnnotationVisibility, ClientToServerEvents, EncounterToken, EncounterTokenPosition, GmActor, MutationResult, PlayerActor, PlayerAnnotation } from "@vtt/domain";
import { chebyshevFeetPreview, imagePointFromClient, initialsOf, snapCellCenterPreview, TokenGlyph, useAuthorizedMapImage, useMapCalibration } from "./mapImage";
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
  { id: "select", glyph: "↖", label: "Select and move" },
  { id: "measure", glyph: "⟷", label: "Measure distance" },
  { id: "circle", glyph: "○", label: "Place a circle" },
  { id: "cone", glyph: "△", label: "Place a cone" },
  { id: "line", glyph: "─", label: "Place a line" },
  { id: "square", glyph: "□", label: "Place a square" }
];
const VISIBILITY_LABELS: Record<AnnotationVisibility, string> = { public: "Everyone", "gm-only": "Just the GM", "owner-only": "Just me", "owner-gm": "Just me and the GM" };
const VISIBILITY_CYCLE: readonly AnnotationVisibility[] = ["public", "owner-only", "owner-gm"];

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

function isMine(annotation: AnyAnnotation, role: "gm" | "player") {
  return role === "gm" || ("mine" in annotation && annotation.mine);
}

/** Circle/cone/line/square outline geometry shared by the live drag preview and confirmed annotations — both only ever need an origin/target pair. */
function ShapeGlyph({ shape, origin, target, className }: Readonly<{ shape: AnnotationShapeKind; origin: Point; target: Point; className: string }>) {
  if (shape === "circle") return <circle className={className} cx={origin.x} cy={origin.y} r={Math.max(1, Math.hypot(target.x - origin.x, target.y - origin.y))} />;
  if (shape === "square") {
    const size = Math.max(Math.abs(target.x - origin.x), Math.abs(target.y - origin.y));
    return <rect className={className} x={Math.min(origin.x, target.x)} y={Math.min(origin.y, target.y)} width={size} height={size} />;
  }
  if (shape === "line") return <line className={className} x1={origin.x} y1={origin.y} x2={target.x} y2={target.y} />;
  // Cone: apex at origin, opening toward target; 5e RAW cones have equal length and width, so the half-angle is atan(0.5).
  const length = Math.max(1, Math.hypot(target.x - origin.x, target.y - origin.y));
  const angle = Math.atan2(target.y - origin.y, target.x - origin.x);
  const halfAngle = Math.atan2(0.5, 1);
  const left = { x: origin.x + Math.cos(angle - halfAngle) * length, y: origin.y + Math.sin(angle - halfAngle) * length };
  const right = { x: origin.x + Math.cos(angle + halfAngle) * length, y: origin.y + Math.sin(angle + halfAngle) * length };
  return <polygon className={className} points={`${origin.x},${origin.y} ${left.x},${left.y} ${right.x},${right.y}`} />;
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
  const [gmLayer, setGmLayer] = useState(false);
  const [showLiveMeasure, setShowLiveMeasure] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [annotationBusy, setAnnotationBusy] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const trayRef = useRef<HTMLDivElement | null>(null);
  const actorsById = useMemo(() => new Map(actors.map((actor) => [actor.id, actor])), [actors]);
  const tokensById = useMemo(() => new Map(tokens.map((encounterToken) => [encounterToken.actorId, encounterToken])), [tokens]);
  const size = image.status === "ready" ? { width: image.width, height: image.height } : null;
  const calibration = grid.calibration;

  useEffect(() => { setGesture(null); }, [assetId, token]);
  useEffect(() => { if (size) setCamera({ center: { x: size.width / 2, y: size.height / 2 }, zoom: 1 }); }, [assetId, size?.width, size?.height]);
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

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
  const submitAnnotationAdd = async (kind: "measurement" | "shape", shape: AnnotationShapeKind | undefined, origin: Point, target: Point) => {
    setAnnotationBusy("new"); setMessage("");
    try {
      const result = await emitAnnotationAdd({ commandId: newId(), kind, shape, geometry: { origin, target }, visibility: gmLayer && role === "gm" ? "gm-only" : "public", expectedRevision: revision });
      if (!result.ok) throw new Error(result.message ?? "That could not be added to the map.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setAnnotationBusy(null); }
  };
  const submitAnnotationMove = async (id: string, origin: Point, target: Point) => {
    setAnnotationBusy(id); setMessage("");
    try {
      const result = await emitAnnotationMove({ commandId: newId(), id, geometry: { origin, target }, expectedRevision: revision });
      if (!result.ok) throw new Error(result.message ?? "That could not be moved.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setAnnotationBusy(null); }
  };
  const removeAnnotation = async (id: string) => {
    setAnnotationBusy(id); setMessage("");
    try {
      const result = await emitAnnotationRemove({ commandId: newId(), id, expectedRevision: revision });
      if (!result.ok) throw new Error(result.message ?? "That could not be removed.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setAnnotationBusy(null); }
  };
  const cycleVisibility = async (annotation: AnyAnnotation) => {
    const next = VISIBILITY_CYCLE[(VISIBILITY_CYCLE.indexOf(annotation.visibility as (typeof VISIBILITY_CYCLE)[number]) + 1) % VISIBILITY_CYCLE.length];
    setAnnotationBusy(annotation.id); setMessage("");
    try {
      const result = await emitAnnotationSetVisibility({ commandId: newId(), id: annotation.id, visibility: next, expectedRevision: revision });
      if (!result.ok) throw new Error(result.message ?? "The visibility could not be changed.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setAnnotationBusy(null); }
  };

  const beginGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (busyActorId) return;
    const target = event.target as Element;
    const handleId = target.closest<HTMLElement>("[data-annotation-handle]")?.dataset.annotationHandle;
    const handleAnnotationId = target.closest<HTMLElement>("[data-annotation-id]")?.dataset.annotationId;
    if (tool === "select" && handleAnnotationId) {
      const annotation = annotationAt(handleAnnotationId);
      if (annotation && annotation.kind === "shape" && isMine(annotation, role)) {
        const point = pointFromScreen(event.clientX, event.clientY); if (!point) return;
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
        if (handleId === "resize") { setGesture({ kind: "annotation-resize", id: annotation.id, anchor: annotation.geometry.origin, current: point }); return; }
        setGesture({ kind: "annotation-move", id: annotation.id, grab: { x: point.x - annotation.geometry.origin.x, y: point.y - annotation.geometry.origin.y }, geometry: annotation.geometry });
        return;
      }
    }
    const tokenId = target.closest<HTMLElement>("[data-token-id]")?.dataset.tokenId;
    if (tool === "select" && tokenId && tokensById.has(tokenId)) {
      if (!canMove(tokenId)) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      const origin = tokensById.get(tokenId)?.position ?? null;
      setMessage(""); setGesture({ kind: "token", actorId: tokenId, point: origin, origin });
      return;
    }
    if (tool !== "select" && calibration) {
      const point = pointFromScreen(event.clientX, event.clientY); if (!point) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      const origin = tool === "measure" ? snapCellCenterPreview(calibration, point) : point;
      setMessage(""); setGesture({ kind: tool, origin, current: point });
      return;
    }
    // A press on empty map background (not a token, not the tray) pans the camera.
    const svg = svgRef.current;
    if (tool !== "select" || !svg || !size || !(event.target as Element).closest("svg")) return;
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
    // measure / shape placement — the live preview follows the raw pointer; the server snaps the final geometry to the grid on release.
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
  const liveTokenDistanceFeet = showLiveMeasure && calibration && dragging?.point && dragging.origin ? chebyshevFeetPreview(calibration, dragging.origin, dragging.point) : null;
  const liveGestureFeet = calibration && gesture
    ? gesture.kind === "annotation-resize" ? chebyshevFeetPreview(calibration, gesture.anchor, gesture.current)
      : gesture.kind === "measure" || gesture.kind === "circle" || gesture.kind === "cone" || gesture.kind === "line" || gesture.kind === "square" ? chebyshevFeetPreview(calibration, gesture.origin, gesture.current)
        : null
    : null;

  return <div className={`encounter-map-interaction ${enlarged ? "enlarged" : ""}`} onPointerDown={beginGesture} onPointerMove={continueGesture} onPointerUp={finishGesture} onPointerCancel={cancelGesture}>
    <div className="encounter-map-help"><strong>{role === "gm" ? "Drag any token to move it" : "Drag your highlighted character"}</strong><span>{role === "gm" ? "Calibrated maps snap automatically. Drop a token back in the tray to remove it from the map." : "Other tokens are view-only. Your moves snap automatically when the map has a grid."} Scroll or pinch to zoom; drag empty map space to pan.</span></div>
    <div className={`encounter-token-tray${dragging ? " receiving" : ""}`} ref={trayRef} aria-label="Unplaced token tray">
      <div><strong>Token tray</strong><span>{unplaced.length ? "Drag onto the map, click to place near its center, or press Enter." : "Drag a token here to take it off the map."}</span></div>
      <div className="encounter-token-tray-list">{unplaced.map((encounterToken) => {
        const actor = actorsById.get(encounterToken.actorId); if (!actor) return null;
        return <button key={encounterToken.actorId} data-token-id={encounterToken.actorId} className={`tray-token ${actor.kind}${actor.visibility === "gm-only" ? " hidden" : ""}`} disabled={busyActorId !== null} onClick={() => placeAtCenter(encounterToken.actorId)}><span>{initialsOf(actor.name)}</span><strong>{actor.name}</strong></button>;
      })}</div>
    </div>
    <div className="encounter-map-toolbar-row">
      <div className="encounter-map-tools" role="group" aria-label="Map tools">
        {TOOLS.map((entry) => <button key={entry.id} type="button" aria-label={entry.label} title={entry.label} aria-pressed={tool === entry.id} disabled={entry.id !== "select" && !calibration} onClick={() => setTool(entry.id)}>{entry.glyph}</button>)}
      </div>
      {role === "gm" && <button type="button" className="encounter-map-gm-layer" aria-pressed={gmLayer} title="New shapes you place default to GM-only" onClick={() => setGmLayer((current) => !current)}>GM layer{gmLayer ? " on" : ""}</button>}
      <label className="encounter-map-live-measure"><input type="checkbox" checked={showLiveMeasure} onChange={(event) => setShowLiveMeasure(event.target.checked)} disabled={!calibration} /> Show distance while moving a token</label>
    </div>
    <div className="encounter-map-stage" ref={stageRef} aria-busy={image.status !== "ready"}>
      {image.status === "ready" && size ? <>
        <svg ref={svgRef} viewBox={viewBox} preserveAspectRatio="xMidYMid meet" role="group" aria-label={`${altText}. Interactive encounter tokens are layered above this map.`}>
          <image href={image.url} width={size.width} height={size.height} role="img" aria-label={altText} />

          {annotations.map((annotation) => {
            const editable = tool === "select" && annotation.kind === "shape" && isMine(annotation, role);
            const beingDragged = (gesture?.kind === "annotation-move" || gesture?.kind === "annotation-resize") && gesture.id === annotation.id;
            if (beingDragged) return null;
            const { origin, target } = annotation.geometry;
            const busy = annotationBusy === annotation.id;
            if (annotation.kind === "measurement") return <g key={annotation.id} className="annotation-measurement">
              <line x1={origin.x} y1={origin.y} x2={target.x} y2={target.y} />
              <circle cx={origin.x} cy={origin.y} r={4} /><circle cx={target.x} cy={target.y} r={4} />
              <text x={(origin.x + target.x) / 2} y={(origin.y + target.y) / 2}>{annotation.geometry.sizeFeet} ft</text>
            </g>;
            return <g key={annotation.id} data-annotation-id={annotation.id} className={`annotation-shape visibility-${annotation.visibility}${editable ? " editable" : ""}`}>
              <ShapeGlyph shape={annotation.shape!} origin={origin} target={target} className="annotation-shape-body" />
              <text x={origin.x} y={origin.y - 8} className="annotation-shape-label">{annotation.geometry.sizeFeet} ft</text>
              {editable && <>
                <circle data-annotation-handle="move" className="annotation-handle annotation-handle-move" cx={origin.x} cy={origin.y} r={7} />
                <circle data-annotation-handle="resize" className="annotation-handle annotation-handle-resize" cx={target.x} cy={target.y} r={7} />
                <g className="annotation-controls" transform={`translate(${origin.x} ${origin.y - 26})`}>
                  <g className="annotation-visibility-toggle" onClick={() => !busy && void cycleVisibility(annotation)}><rect rx={4} width={96} height={18} x={-48} /><text y={13}>{VISIBILITY_LABELS[annotation.visibility]}</text></g>
                  <g className="annotation-delete" transform="translate(54 0)" onClick={() => !busy && void removeAnnotation(annotation.id)}><rect rx={4} width={18} height={18} x={0} /><text x={9} y={13}>×</text></g>
                </g>
              </>}
            </g>;
          })}

          {gesture?.kind === "measure" && <g className="annotation-measurement live"><line x1={gesture.origin.x} y1={gesture.origin.y} x2={gesture.current.x} y2={gesture.current.y} /><text x={(gesture.origin.x + gesture.current.x) / 2} y={(gesture.origin.y + gesture.current.y) / 2}>{liveGestureFeet ?? "…"} ft</text></g>}
          {gesture && (gesture.kind === "circle" || gesture.kind === "cone" || gesture.kind === "line" || gesture.kind === "square") && <g className="annotation-shape live"><ShapeGlyph shape={gesture.kind} origin={gesture.origin} target={gesture.current} className="annotation-shape-body" /><text x={gesture.origin.x} y={gesture.origin.y - 8} className="annotation-shape-label">{liveGestureFeet ?? "…"} ft</text></g>}
          {gesture?.kind === "annotation-resize" && (() => { const live = annotationAt(gesture.id); return live && live.kind === "shape" ? <g className="annotation-shape live"><ShapeGlyph shape={live.shape!} origin={gesture.anchor} target={gesture.current} className="annotation-shape-body" /><text x={gesture.anchor.x} y={gesture.anchor.y - 8} className="annotation-shape-label">{liveGestureFeet ?? "…"} ft</text></g> : null; })()}
          {gesture?.kind === "annotation-move" && (() => { const live = annotationAt(gesture.id); return live && live.kind === "shape" ? <g className="annotation-shape live"><ShapeGlyph shape={live.shape!} origin={gesture.geometry.origin} target={gesture.geometry.target} className="annotation-shape-body" /></g> : null; })()}

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
