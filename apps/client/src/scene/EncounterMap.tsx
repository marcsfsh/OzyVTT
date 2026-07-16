import { useEffect, useMemo, useRef, useState } from "react";
import type { ClientToServerEvents, EncounterToken, EncounterTokenPosition, GmActor, MutationResult, PlayerActor } from "@vtt/domain";
import { imagePointFromClient, initialsOf, TokenGlyph, useAuthorizedMapImage } from "./mapImage";
import { newId } from "../lib/ids";
import { socket } from "../socket";
import "./encounter-map.css";

type Actor = GmActor | PlayerActor;
type Camera = Readonly<{ center: EncounterTokenPosition; zoom: number }>;
type Gesture =
  | Readonly<{ kind: "token"; actorId: string; point: EncounterTokenPosition | null }>
  | Readonly<{ kind: "pan"; startClient: EncounterTokenPosition; startCenter: EncounterTokenPosition; scaleX: number; scaleY: number }>;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 6;

function emitMove(payload: Parameters<ClientToServerEvents["token:move"]>[0]) {
  return new Promise<MutationResult>((resolve) => socket.emit("token:move", payload, resolve));
}

export function EncounterMap({
  assetId, token, altText = "Active encounter battlemap", role, actors, tokens, revision, activeActorId
}: Readonly<{
  assetId: string;
  token: string | null;
  altText?: string;
  role: "gm" | "player";
  actors: readonly Actor[];
  tokens: readonly EncounterToken[];
  revision: number;
  activeActorId: string | null;
}>) {
  const image = useAuthorizedMapImage(assetId, token);
  const [message, setMessage] = useState("");
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [busyActorId, setBusyActorId] = useState<string | null>(null);
  const [camera, setCamera] = useState<Camera>({ center: { x: 0, y: 0 }, zoom: 1 });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const trayRef = useRef<HTMLDivElement | null>(null);
  const actorsById = useMemo(() => new Map(actors.map((actor) => [actor.id, actor])), [actors]);
  const tokensById = useMemo(() => new Map(tokens.map((encounterToken) => [encounterToken.actorId, encounterToken])), [tokens]);
  const size = image.status === "ready" ? { width: image.width, height: image.height } : null;

  useEffect(() => { setGesture(null); }, [assetId, token]);
  useEffect(() => { if (size) setCamera({ center: { x: size.width / 2, y: size.height / 2 }, zoom: 1 }); }, [assetId, size?.width, size?.height]);

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
  const toggleFullscreen = () => { const el = stageRef.current; if (!el) return; if (document.fullscreenElement) void document.exitFullscreen(); else void el.requestFullscreen?.(); };

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
  const beginGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (busyActorId) return;
    const target = (event.target as Element).closest<HTMLElement>("[data-token-id]");
    const actorId = target?.dataset.tokenId;
    if (actorId && tokensById.has(actorId)) {
      if (!canMove(actorId)) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      setMessage(""); setGesture({ kind: "token", actorId, point: tokensById.get(actorId)?.position ?? null });
      return;
    }
    // A press on empty map background (not a token, not the tray) pans the camera.
    const svg = svgRef.current;
    if (!svg || !size || !(event.target as Element).closest("svg")) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    const rect = svg.getBoundingClientRect();
    setGesture({ kind: "pan", startClient: { x: event.clientX, y: event.clientY }, startCenter: camera.center, scaleX: (size.width / camera.zoom) / rect.width, scaleY: (size.height / camera.zoom) / rect.height });
  };
  const continueGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!gesture || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.preventDefault();
    if (gesture.kind === "token") { setGesture({ ...gesture, point: pointFromScreen(event.clientX, event.clientY) }); return; }
    const dx = (event.clientX - gesture.startClient.x) * gesture.scaleX;
    const dy = (event.clientY - gesture.startClient.y) * gesture.scaleY;
    setCamera((current) => ({ ...current, center: { x: gesture.startCenter.x - dx, y: gesture.startCenter.y - dy } }));
  };
  const finishGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!gesture || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.preventDefault(); event.currentTarget.releasePointerCapture(event.pointerId);
    if (gesture.kind === "pan") { setGesture(null); return; }
    const actorId = gesture.actorId;
    const originalToken = tokensById.get(actorId);
    const originalPosition = originalToken?.position ?? null;
    const mapPoint = pointFromScreen(event.clientX, event.clientY);
    const trayBounds = trayRef.current?.getBoundingClientRect();
    const overTray = Boolean(trayBounds && event.clientX >= trayBounds.left && event.clientX <= trayBounds.right && event.clientY >= trayBounds.top && event.clientY <= trayBounds.bottom);
    setGesture(null);
    const unchanged = Boolean(mapPoint && originalPosition && Math.hypot(mapPoint.x - originalPosition.x, mapPoint.y - originalPosition.y) < (originalToken?.gridSizePx ? originalToken.gridSizePx * .45 : .5));
    if (unchanged) setMessage("Token stayed in the same space.");
    else if (mapPoint) void submitMove(actorId, mapPoint);
    else if (overTray) void placeAtCenter(actorId);
    else setMessage("Move cancelled. Drop the token on the map or in the tray.");
  };
  const cancelGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setGesture(null); setMessage("Move cancelled.");
  };
  const placeAtCenter = (actorId: string) => { if (size) void submitMove(actorId, { x: size.width / 2, y: size.height / 2 }); };
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

  return <div className="encounter-map-interaction" onPointerDown={beginGesture} onPointerMove={continueGesture} onPointerUp={finishGesture} onPointerCancel={cancelGesture}>
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
        <svg ref={svgRef} viewBox={viewBox} preserveAspectRatio="xMidYMid meet" role="group" aria-label={`${altText}. Interactive encounter tokens are layered above this map.`}>
          <image href={image.url} width={size.width} height={size.height} role="img" aria-label={altText} />
          {visibleTokens.map((encounterToken) => {
            const actor = actorsById.get(encounterToken.actorId); if (!actor) return null;
            const movable = canMove(actor.id);
            const active = activeActorId === actor.id;
            return <g key={actor.id} data-token-id={actor.id} transform={`translate(${encounterToken.position.x} ${encounterToken.position.y})`} className={`encounter-token ${actor.kind}${movable ? " movable" : " locked"}${actor.visibility === "gm-only" ? " hidden" : ""}${active ? " active" : ""}${dragging?.actorId === actor.id ? " dragging" : ""}`} role={movable ? "button" : "img"} tabIndex={movable ? 0 : undefined} aria-label={`${actor.name}${active ? ", active turn" : ""}${movable ? ". Drag to move; arrow keys move one step; Delete returns it to the tray." : ", view only."}`} aria-keyshortcuts={movable ? "ArrowUp ArrowDown ArrowLeft ArrowRight Delete" : undefined} onKeyDown={movable ? (event) => keyboardMove(event, encounterToken) : undefined}>
              <title>{actor.name}{actor.visibility === "gm-only" ? " (hidden from players)" : ""}</title>
              <TokenGlyph sizePx={encounterToken.sizePx} name={actor.name} active={active} turnClassName="encounter-token-turn" bodyClassName="encounter-token-body" initialsClassName="encounter-token-initials" nameClassName="encounter-token-name" nameY={encounterToken.sizePx * .72} initialsStyle={{ fontSize: Math.max(10, encounterToken.sizePx * .34) }} nameStyle={{ fontSize: Math.max(9, encounterToken.sizePx * .23) }} />
            </g>;
          })}
        </svg>
        <div className="encounter-map-zoom" role="group" aria-label="Map controls">
          <button type="button" aria-label="Zoom in" onClick={() => zoomCenter(1.3)}>+</button>
          <button type="button" aria-label="Zoom out" onClick={() => zoomCenter(1 / 1.3)}>−</button>
          <button type="button" onClick={resetView}>Reset view</button>
          <button type="button" onClick={toggleFullscreen}>Fullscreen</button>
        </div>
      </> : <p role="status">{image.status === "error" ? image.message : "Loading the battle map…"}</p>}
    </div>
    {busyActorId && <p className="encounter-map-saving" role="status">Saving move…</p>}
    {image.status === "ready" && <p className="encounter-map-feedback" role="status" aria-live="polite">{message}</p>}
  </div>;
}
