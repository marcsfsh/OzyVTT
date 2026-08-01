import { Skeleton } from "@vtt/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { clampPoint, imagePointFromClient, useAuthorizedMapImage } from "../scene/mapImage";
import { iconChildren, pinSwatchVar } from "./icons";

/** The minimal marker shape the surface renders - satisfied by both the GM marker and the player projection. */
export type SurfaceMarker = Readonly<{ id: string; x: number; y: number; iconId: string; iconColor: string; label: string | null; revealedToPlayers?: boolean; isParty?: boolean }>;
/**
 * M12 / CT-7: what the party pin SAYS. R2 forbids a state that reads by colour or shape alone, and a
 * ring around a pin is exactly that — so the words are drawn on the map beside it and also given to
 * assistive tech as the pin's accessible name. Optional on the type because it is optional on the wire
 * (a projection that has not been widened yet simply renders every pin as it did before).
 */
const PARTY_LABEL = "The party is here";

/**
 * The interactive, out-of-combat atlas surface. Mirrors EncounterMap's approach - an SVG viewBox camera
 * driven by a pointer-gesture state machine (pan / pinch / marker-drag), wheel-zoom-to-cursor, and
 * touch-action:none for touch parity - but is map-agnostic and combat-free. The server owns marker
 * positions; a drag previews locally and commits on release (mirror, never replace).
 */

type Camera = { cx: number; cy: number; zoom: number };
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 12;
const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

type Gesture =
  | { mode: "idle" }
  | { mode: "pan"; pointerId: number; startX: number; startY: number; lastX: number; lastY: number }
  | { mode: "marker"; pointerId: number; markerId: string; moved: boolean }
  | { mode: "pinch"; startDist: number; startZoom: number };

type MapSurfaceProps = Readonly<{
  token: string;
  assetId: string;
  markers: readonly SurfaceMarker[];
  placing: boolean;
  selectedMarkerId: string | null;
  /**
   * D10: pins that do NOT match the Atlas's filter. They dim to 30% rather than disappearing — a map
   * with pins removed is a different picture of the world, not a filtered list of one. Selection and
   * hit-testing are unaffected, so a dimmed pin is still tappable.
   */
  dimmedMarkerIds?: ReadonlySet<string> | null;
  readOnly?: boolean;
  /**
   * A request to bring ONE pin into view (`ux-principles.md` §9 — actions name their result). The camera
   * lives in here, so a caller cannot move it; it asks, and this honours the ask once per request.
   *
   * Deliberately separate from `selectedMarkerId`: selecting a pin the GM just tapped must NOT yank the
   * camera out from under their finger, so centring is only ever what somebody explicitly asked for.
   */
  centerOnMarkerId?: string | null;
  /** Clears the request above (the same handled-latch shape the journal's `openEntryId` uses), so the same pin can be asked for again. */
  onCentered?: () => void;
  onBackgroundClick: (point: { x: number; y: number }) => void;
  onMarkerClick: (markerId: string) => void;
  onMarkerDragEnd: (markerId: string, point: { x: number; y: number }) => void;
}>;

export function MapSurface({ token, assetId, markers, placing, selectedMarkerId, dimmedMarkerIds = null, readOnly = false, centerOnMarkerId = null, onCentered, onBackgroundClick, onMarkerClick, onMarkerDragEnd }: MapSurfaceProps) {
  const image = useAuthorizedMapImage(assetId, token);
  const svgRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture>({ mode: "idle" });
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const [camera, setCamera] = useState<Camera | null>(null);
  const [dragPreview, setDragPreview] = useState<{ id: string; x: number; y: number } | null>(null);

  const width = image.status === "ready" ? image.width : 0;
  const height = image.status === "ready" ? image.height : 0;

  // Fit the map when it loads (center, zoom 1 = whole image in view via preserveAspectRatio).
  useEffect(() => { if (image.status === "ready") setCamera({ cx: image.width / 2, cy: image.height / 2, zoom: 1 }); }, [image.status, assetId]);

  /**
   * Honour a centring request: move the camera to the pin, at the zoom the GM is already on.
   *
   * The zoom is deliberately untouched. At zoom 1 the whole image is in view, so centring is a no-op there
   * and nothing is lost; the case this exists for is a GM who has zoomed and panned somewhere else, and
   * re-scaling their map to "help" would be the surface overruling a choice they made deliberately.
   *
   * Waits for `image.status === "ready"`, because until then there is no camera to move and the fit effect
   * above would overwrite it the moment there was.
   */
  const centeredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!centerOnMarkerId) { centeredRef.current = null; return; }
    if (image.status !== "ready" || centeredRef.current === centerOnMarkerId) return;
    const target = markers.find((marker) => marker.id === centerOnMarkerId);
    if (!target) return;
    centeredRef.current = centerOnMarkerId;
    setCamera((prev) => ({ cx: target.x, cy: target.y, zoom: prev?.zoom ?? 1 }));
    onCentered?.();
  }, [centerOnMarkerId, markers, image.status, onCentered]);

  const viewBox = camera && width
    ? `${camera.cx - width / (2 * camera.zoom)} ${camera.cy - height / (2 * camera.zoom)} ${width / camera.zoom} ${height / camera.zoom}`
    : `0 0 ${width || 1} ${height || 1}`;

  // Wheel zoom toward the cursor (non-passive so preventDefault works and the page never scrolls).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setCamera((prev) => {
        if (!prev || !width) return prev;
        const point = imagePointFromClient(svg, event.clientX, event.clientY);
        const zoom = clampZoom(prev.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12));
        if (!point) return { ...prev, zoom };
        const rect = svg.getBoundingClientRect();
        const fx = (event.clientX - rect.left) / rect.width;
        const fy = (event.clientY - rect.top) / rect.height;
        return { cx: point.x + (width / zoom) * (0.5 - fx), cy: point.y + (height / zoom) * (0.5 - fy), zoom };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [width, height]);

  const distanceBetweenPointers = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const onPointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) { gesture.current = { mode: "pinch", startDist: distanceBetweenPointers(), startZoom: camera?.zoom ?? 1 }; return; }
    const markerId = (event.target as Element).closest("[data-marker-id]")?.getAttribute("data-marker-id") ?? null;
    (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
    if (markerId) gesture.current = { mode: "marker", pointerId: event.pointerId, markerId, moved: false };
    else gesture.current = { mode: "pan", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY };
  }, [camera?.zoom]);

  const onPointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const state = gesture.current;
    const svg = svgRef.current;
    if (!svg || !camera || !width) return;
    if (state.mode === "pinch") {
      const dist = distanceBetweenPointers();
      if (state.startDist > 0) setCamera((prev) => (prev ? { ...prev, zoom: clampZoom(state.startZoom * (dist / state.startDist)) } : prev));
      return;
    }
    if (state.mode === "pan" && state.pointerId === event.pointerId) {
      const scale = (width / camera.zoom) / svg.getBoundingClientRect().width;
      const dx = (event.clientX - state.lastX) * scale;
      const dy = (event.clientY - state.lastY) * scale;
      state.lastX = event.clientX; state.lastY = event.clientY;
      setCamera((prev) => (prev ? { cx: prev.cx - dx, cy: prev.cy - dy, zoom: prev.zoom } : prev));
      return;
    }
    if (state.mode === "marker" && state.pointerId === event.pointerId && !readOnly) {
      const point = imagePointFromClient(svg, event.clientX, event.clientY);
      if (point) { state.moved = true; setDragPreview({ id: state.markerId, ...clampPoint(point, width, height) }); }
    }
  }, [camera, width, height, readOnly]);

  const endPointer = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    const state = gesture.current;
    const svg = svgRef.current;
    // A cancelled gesture (a system/OS gesture stole the pointer) must discard, not commit its last preview.
    const cancelled = event.type === "pointercancel";
    if (state.mode === "marker" && state.pointerId === event.pointerId) {
      if (!cancelled) {
        if (!state.moved) onMarkerClick(state.markerId);
        else if (dragPreview && dragPreview.id === state.markerId) onMarkerDragEnd(state.markerId, { x: dragPreview.x, y: dragPreview.y });
      }
      setDragPreview(null);
    } else if (!cancelled && state.mode === "pan" && state.pointerId === event.pointerId && svg && placing) {
      // Drop a marker only when the pointer barely moved SINCE IT WENT DOWN - a real pan (many move samples) is never a drop.
      const point = imagePointFromClient(svg, event.clientX, event.clientY);
      if (point && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < 4 && width) onBackgroundClick(clampPoint(point, width, height));
    }
    if (pointers.current.size < 2) gesture.current = { mode: "idle" };
  }, [dragPreview, placing, width, height, onMarkerClick, onMarkerDragEnd, onBackgroundClick]);

  if (image.status === "loading") return <div className="codex-map-status"><Skeleton variant="block" width="100%" height="100%" /></div>;
  if (image.status === "error") return <div className="codex-map-status codex-map-error">{image.message}</div>;

  const glyphSize = Math.min(Math.max(Math.min(width, height) * 0.045, 26), 120);

  return (
    <div className={`codex-mapsurface${placing ? " is-placing" : ""}`}>
      <svg ref={svgRef} className="codex-map-svg" viewBox={viewBox} preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endPointer} onPointerCancel={endPointer}>
        <image href={image.url} x={0} y={0} width={width} height={height} />
        {markers.map((marker) => {
          const pos = dragPreview && dragPreview.id === marker.id ? dragPreview : marker;
          const s = glyphSize;
          return (
            <g key={marker.id} data-marker-id={marker.id} transform={`translate(${pos.x} ${pos.y})`}
              className={`codex-marker${marker.id === selectedMarkerId ? " is-selected" : ""}${marker.revealedToPlayers === false ? " is-hidden" : " is-shown"}${marker.isParty ? " is-party" : ""}${dimmedMarkerIds?.has(marker.id) ? " is-dimmed" : ""}`}>
              {/* CT-7 / R2, the accessible half: the party pin's meaning reaches a screen reader as a
                  NAME, not as a ring it cannot see. Ordinary pins keep no title, exactly as before. */}
              {marker.isParty && <title>{marker.label ? `${marker.label}, ${PARTY_LABEL.toLowerCase()}` : PARTY_LABEL}</title>}
              {/* The ring. Drawn OUTSIDE the icon's own scale group so it does not inherit the glyph's
                  colour, and behind the glyph so it never obscures it. It is decoration — the words
                  below are what actually say this is the party. */}
              {marker.isParty && <circle className="codex-marker-partyring" r={s * 0.72} />}
              {/* `pinSwatchVar`, not the raw stored hex. The picker swatch, the inspector's header glyph
                  and the player's pin sheet all resolve an on-palette colour through its token, and the
                  light theme darkens those tokens for contrast — so a pin stored as #FF2E9A painted
                  #C81D80 in the panel and #FF2E9A on the map beside it, and the swatch advertised a
                  colour the map would never use. An off-palette hex falls through unchanged, so pins
                  stored before the palette existed are untouched. */}
              <g transform={`translate(${-s / 2} ${-s / 2}) scale(${s / 24})`} style={{ color: pinSwatchVar(marker.iconColor) }}>
                <circle cx={12} cy={12} r={11.5} className="codex-marker-bg" />
                <g className="codex-marker-ico">{iconChildren(marker.iconId)}</g>
              </g>
              {marker.label && <text className="codex-marker-label" y={s / 2 + glyphSize * 0.28} textAnchor="middle" style={{ fontSize: glyphSize * 0.34 }}>{marker.label}</text>}
              {/* CT-7 / R2: said in WORDS on the map itself, never by the ring alone. It sits under the
                  pin's own label when there is one, so a named place still reads as that place first. */}
              {marker.isParty && (
                <text className="codex-marker-partylabel" y={s / 2 + glyphSize * (marker.label ? 0.66 : 0.28)} textAnchor="middle" style={{ fontSize: glyphSize * 0.3 }}>{PARTY_LABEL}</text>
              )}
            </g>
          );
        })}
      </svg>
      {placing && <div className="codex-place-hint" role="status">Tap the map to drop a pin · Esc to cancel</div>}
    </div>
  );
}
