import { useEffect, useMemo, useRef, useState } from "react";
import type { ClientToServerEvents, EncounterToken, EncounterTokenPosition, GmActor, MutationResult, PlayerActor } from "@vtt/domain";
import { socket } from "../socket";
import "./encounter-map.css";

type Actor = GmActor | PlayerActor;
type DragState = Readonly<{ actorId: string; point: EncounterTokenPosition | null }>;

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

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
  const [source, setSource] = useState<string | null>(null);
  const [size, setSize] = useState<Readonly<{ width: number; height: number }> | null>(null);
  const [message, setMessage] = useState("Loading the battle map…");
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [busyActorId, setBusyActorId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const trayRef = useRef<HTMLDivElement | null>(null);
  const actorsById = useMemo(() => new Map(actors.map((actor) => [actor.id, actor])), [actors]);
  const tokensById = useMemo(() => new Map(tokens.map((encounterToken) => [encounterToken.actorId, encounterToken])), [tokens]);

  useEffect(() => {
    setSource(null); setSize(null); setDragging(null);
    if (!token) { setMessage("Rejoin the table to load the battle map."); return; }
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setMessage("Loading the battle map…");
    fetch(`/api/v1/map-assets/${encodeURIComponent(assetId)}/content`, {
      headers: { authorization: `Bearer ${token}` }, signal: controller.signal
    }).then(async (response) => {
      if (!response.ok) throw new Error(response.status === 403 ? "You don't have access to this map." : "The battle map couldn't be loaded.");
      objectUrl = URL.createObjectURL(await response.blob());
      const probe = new Image();
      await new Promise<void>((resolve, reject) => { probe.onload = () => resolve(); probe.onerror = () => reject(new Error("The battle map image couldn't be displayed.")); probe.src = objectUrl!; });
      setSize({ width: probe.naturalWidth, height: probe.naturalHeight }); setSource(objectUrl); setMessage("");
    }).catch((error) => { if (error.name !== "AbortError") setMessage(error.message); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [assetId, token]);

  const canMove = (actorId: string) => {
    if (role === "gm") return true;
    const actor = actorsById.get(actorId);
    return actor !== undefined && "claimStatus" in actor && actor.claimStatus === "mine";
  };
  const pointFromScreen = (clientX: number, clientY: number) => {
    const svg = svgRef.current; if (!svg || !size) return null;
    const matrix = svg.getScreenCTM(); if (!matrix) return null;
    const point = svg.createSVGPoint(); point.x = clientX; point.y = clientY;
    const mapPoint = point.matrixTransform(matrix.inverse());
    return mapPoint.x >= 0 && mapPoint.x <= size.width && mapPoint.y >= 0 && mapPoint.y <= size.height
      ? { x: Math.round(mapPoint.x * 100) / 100, y: Math.round(mapPoint.y * 100) / 100 }
      : null;
  };
  const submitMove = async (actorId: string, position: EncounterTokenPosition | null) => {
    if (busyActorId || !canMove(actorId)) return;
    setBusyActorId(actorId); setMessage("");
    try {
      const result = await emitMove({ commandId: crypto.randomUUID(), actorId, position, expectedRevision: revision });
      if (!result.ok) throw new Error(result.message ?? "The token move was rejected.");
      setMessage(position ? "Token moved." : "Token returned to the tray.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusyActorId(null); }
  };
  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (busyActorId) return;
    const target = (event.target as Element).closest<HTMLElement>("[data-token-id]");
    const actorId = target?.dataset.tokenId;
    if (!actorId || !tokensById.has(actorId) || !canMove(actorId)) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    setMessage(""); setDragging({ actorId, point: tokensById.get(actorId)?.position ?? null });
  };
  const continueDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.preventDefault(); setDragging({ ...dragging, point: pointFromScreen(event.clientX, event.clientY) });
  };
  const finishDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.preventDefault(); event.currentTarget.releasePointerCapture(event.pointerId);
    const actorId = dragging.actorId;
    const originalToken = tokensById.get(actorId);
    const originalPosition = originalToken?.position ?? null;
    const mapPoint = pointFromScreen(event.clientX, event.clientY);
    const trayBounds = trayRef.current?.getBoundingClientRect();
    const overTray = Boolean(trayBounds && event.clientX >= trayBounds.left && event.clientX <= trayBounds.right && event.clientY >= trayBounds.top && event.clientY <= trayBounds.bottom);
    setDragging(null);
    const unchanged = Boolean(mapPoint && originalPosition && Math.hypot(mapPoint.x - originalPosition.x, mapPoint.y - originalPosition.y) < (originalToken?.gridSizePx ? originalToken.gridSizePx * .45 : .5));
    if (unchanged) setMessage("Token stayed in the same space.");
    else if (mapPoint) void submitMove(actorId, mapPoint);
    else if (overTray && originalPosition) void submitMove(actorId, null);
    else if (overTray) setMessage("Drag this token onto the map, or press Enter to place it near the center.");
    else setMessage("Move cancelled. Drop the token on the map or in the tray.");
  };
  const cancelDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(null); setMessage("Move cancelled.");
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
  const visibleTokens = tokens.flatMap((encounterToken) => {
    const position = dragging?.actorId === encounterToken.actorId ? dragging.point : encounterToken.position;
    return position ? [{ ...encounterToken, position }] : [];
  });

  return <div className="encounter-map-interaction" onPointerDown={beginDrag} onPointerMove={continueDrag} onPointerUp={finishDrag} onPointerCancel={cancelDrag}>
    <div className="encounter-map-help"><strong>{role === "gm" ? "Drag any token to move it" : "Drag your highlighted character"}</strong><span>{role === "gm" ? "Calibrated maps snap automatically. Drop a token back in the tray to remove it from the map." : "Other tokens are view-only. Your moves snap automatically when the map has a grid."}</span></div>
    <div className={`encounter-token-tray${dragging ? " receiving" : ""}`} ref={trayRef} aria-label="Unplaced token tray">
      <div><strong>Token tray</strong><span>{unplaced.length ? "Drag onto the map, or press Enter to place near its center." : "Drag a token here to take it off the map."}</span></div>
      <div className="encounter-token-tray-list">{unplaced.map((encounterToken) => {
        const actor = actorsById.get(encounterToken.actorId); if (!actor) return null;
        return <button key={encounterToken.actorId} data-token-id={encounterToken.actorId} className={`tray-token ${actor.kind}${actor.visibility === "gm-only" ? " hidden" : ""}`} disabled={busyActorId !== null} onClick={(event) => { if (event.detail === 0 && size) void submitMove(encounterToken.actorId, { x: size.width / 2, y: size.height / 2 }); }}><span>{initials(actor.name)}</span><strong>{actor.name}</strong></button>;
      })}</div>
    </div>
    <div className="encounter-map-stage" aria-busy={!source}>
      {source && size ? <svg ref={svgRef} viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="xMidYMid meet" role="group" aria-label={`${altText}. Interactive encounter tokens are layered above this map.`}>
        <image href={source} width={size.width} height={size.height} role="img" aria-label={altText} />
        {visibleTokens.map((encounterToken) => {
          const actor = actorsById.get(encounterToken.actorId); if (!actor) return null;
          const movable = canMove(actor.id);
          const active = activeActorId === actor.id;
          return <g key={actor.id} data-token-id={actor.id} transform={`translate(${encounterToken.position.x} ${encounterToken.position.y})`} className={`encounter-token ${actor.kind}${movable ? " movable" : " locked"}${actor.visibility === "gm-only" ? " hidden" : ""}${active ? " active" : ""}${dragging?.actorId === actor.id ? " dragging" : ""}`} role={movable ? "button" : "img"} tabIndex={movable ? 0 : undefined} aria-label={`${actor.name}${active ? ", active turn" : ""}${movable ? ". Drag to move; arrow keys move one step; Delete returns it to the tray." : ", view only."}`} aria-keyshortcuts={movable ? "ArrowUp ArrowDown ArrowLeft ArrowRight Delete" : undefined} onKeyDown={movable ? (event) => keyboardMove(event, encounterToken) : undefined}>
            <title>{actor.name}{actor.visibility === "gm-only" ? " (hidden from players)" : ""}</title>
            {active && <circle className="encounter-token-turn" r={encounterToken.sizePx * .64} />}
            <circle className="encounter-token-body" r={encounterToken.sizePx / 2} />
            <text className="encounter-token-initials" style={{ fontSize: Math.max(10, encounterToken.sizePx * .34) }}>{initials(actor.name)}</text>
            <text className="encounter-token-name" y={encounterToken.sizePx * .72} style={{ fontSize: Math.max(9, encounterToken.sizePx * .23) }}>{actor.name}</text>
          </g>;
        })}
      </svg> : <p role="status">{message}</p>}
    </div>
    {source && <p className="encounter-map-feedback" role="status" aria-live="polite">{message}</p>}
  </div>;
}
