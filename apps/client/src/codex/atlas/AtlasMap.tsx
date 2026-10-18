import { Skeleton, useDragSurface } from "@vtt/ui";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { clampPoint, imagePointFromClient, useAuthorizedMapImage } from "../../scene/mapImage";
import { CodexIcon, iconChildren, pinSwatchVar } from "../icons";
import type { FactionGround, PersonMark } from "./layers";

/** A pin as the map draws it: both the GM's marker and a player's pin satisfy it. */
export type MapPin = Readonly<{
  id: string;
  x: number;
  y: number;
  iconId: string;
  iconColor: string;
  label: string | null;
  /** Absent for a player's pin, which is shown by definition. */
  revealedToPlayers?: boolean;
  isParty?: boolean;
}>;

export type MapPoint = Readonly<{ x: number; y: number }>;

/** One entry of the menu a right-click or a long press opens at a spot on the map. */
export type MapMenuItem = Readonly<{ id: string; label: string; iconId: string; onSelect: (point: MapPoint) => void }>;

/** The party pin's meaning in words, drawn under it and used as its accessible name; the ring alone is not enough. */
const PARTY_LABEL = "The party is here";

/** Screen sizes, in CSS pixels, held at every zoom: a pin's glyph, its label and a person's chip. */
const PIN_PX = 28;
const LABEL_PX = 12;
const PERSON_PX = 22;
const GROUND_LABEL_PX = 13;
/** Faction ground is drawn in map units, a share of the map's shorter side: it covers a stretch of the world. */
const GROUND_SHARE = 0.08;
/** A long press opens the spot menu, as a right-click does; a finger that wanders this far is panning instead. */
const LONG_PRESS_MS = 550;
const LONG_PRESS_SLOP = 8;

type Camera = { cx: number; cy: number; zoom: number };
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 12;
const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

type Gesture =
  | { mode: "idle" }
  | { mode: "pan"; pointerId: number; startX: number; startY: number; lastX: number; lastY: number }
  | { mode: "pin"; pointerId: number; pinId: string; moved: boolean }
  | { mode: "pinch"; startDist: number; startZoom: number };

type OpenMenu = Readonly<{ point: MapPoint; left: number; top: number }>;

export type AtlasMapProps = Readonly<{
  token: string;
  assetId: string;
  pins: readonly MapPin[];
  selectedPinId: string | null;
  /** Pins that miss the filter: they dim and stay tappable. */
  dimmedPinIds?: ReadonlySet<string> | null;
  /** The people layer: who is at each pin. */
  people?: ReadonlyMap<string, readonly PersonMark[]>;
  /** The factions layer: the ground around each pin a faction holds. */
  ground?: readonly FactionGround[];
  /** A drop mode: the next tap on the map is the point. Null browses. */
  placing?: "pin" | "party" | null;
  /** Pins can't be dragged: a player's map, or a small map in a card. */
  readOnly?: boolean;
  /** A one-shot request to centre on a pin, kept apart from selection so a tap never moves the map under a finger. */
  centerOnPinId?: string | null;
  onCentered?: () => void;
  /** Where the camera starts, in image pixels; the whole map when absent. */
  initialFocus?: Readonly<{ x: number; y: number; zoom: number }> | null;
  /** A label for the map in words, for assistive technology. */
  ariaLabel?: string;
  onPinClick?: (pinId: string) => void;
  onPinDragEnd?: (pinId: string, point: MapPoint) => void;
  /** The tap that ends a drop mode. */
  onPlace?: (point: MapPoint) => void;
  /** The spot menu's entries; without any, a right-click or a long press does nothing. */
  menu?: readonly MapMenuItem[];
  /** Said over the map while a drop mode waits for its tap. */
  hint?: ReactNode;
  /** Laid over the map's corner: a control that belongs to the map itself. */
  overlay?: ReactNode;
  className?: string;
}>;

/**
 * The atlas map: an SVG camera over the map image with pan, pinch and wheel zoom. Pins, labels and people chips keep
 * one screen size at every zoom, so a phone reads them as a laptop does; faction ground is drawn in map units, since
 * it covers a stretch of the world. A right-click or a long press opens the spot menu at that point. The server owns
 * every position; a dragged pin previews here and is sent on release.
 */
export function AtlasMap({
  token,
  assetId,
  pins,
  selectedPinId,
  dimmedPinIds = null,
  people,
  ground,
  placing = null,
  readOnly = false,
  centerOnPinId = null,
  onCentered,
  initialFocus = null,
  ariaLabel = "Map",
  onPinClick,
  onPinDragEnd,
  onPlace,
  menu,
  hint,
  overlay,
  className
}: AtlasMapProps) {
  const image = useAuthorizedMapImage(assetId, token);
  const svgRef = useRef<SVGSVGElement>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const surface = useDragSurface<HTMLDivElement>(frameRef);
  const gesture = useRef<Gesture>({ mode: "idle" });
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pressTimer = useRef<number | null>(null);
  const lastMenuAt = useRef(0);
  const [camera, setCamera] = useState<Camera | null>(null);
  const [frame, setFrame] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [dragPreview, setDragPreview] = useState<{ id: string; x: number; y: number } | null>(null);
  const [openMenu, setOpenMenu] = useState<OpenMenu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const width = image.status === "ready" ? image.width : 0;
  const height = image.status === "ready" ? image.height : 0;

  // A new image passes through loading, where its size reads 0, so it refits even at the same size.
  useEffect(() => {
    if (!width) return;
    setCamera(
      initialFocus
        ? { cx: initialFocus.x, cy: initialFocus.y, zoom: clampZoom(initialFocus.zoom) }
        : { cx: width / 2, cy: height / 2, zoom: 1 }
    );
    // The focus is where the camera starts; a later change of it never moves a map someone is looking at.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, assetId]);

  // The frame's size in CSS pixels, which turns screen sizes into map units.
  useEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    const measure = () => setFrame({ width: element.clientWidth, height: element.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [image.status]);

  const centeredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!centerOnPinId) {
      centeredRef.current = null;
      return;
    }
    if (image.status !== "ready" || centeredRef.current === centerOnPinId) return;
    const target = pins.find((pin) => pin.id === centerOnPinId);
    if (!target) return;
    centeredRef.current = centerOnPinId;
    setCamera((prev) => ({ cx: target.x, cy: target.y, zoom: prev?.zoom ?? 1 }));
    onCentered?.();
  }, [centerOnPinId, pins, image.status, onCentered]);

  const viewWidth = camera && width ? width / camera.zoom : width || 1;
  const viewHeight = camera && height ? height / camera.zoom : height || 1;
  const viewBox =
    camera && width
      ? `${camera.cx - viewWidth / 2} ${camera.cy - viewHeight / 2} ${viewWidth} ${viewHeight}`
      : `0 0 ${width || 1} ${height || 1}`;
  /** Map units per CSS pixel. `meet` fits the view box inside the frame, so the tighter axis sets the scale. */
  const scale = frame.width && frame.height ? Math.min(frame.width / viewWidth, frame.height / viewHeight) : 0;
  const unit = scale > 0 ? 1 / scale : Math.max(width, height, 1) / 800;

  // Wheel zoom toward the cursor. Not passive, so preventDefault keeps the page still.
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
  }, [width, height, image.status]);

  const clearPress = () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  useEffect(() => clearPress, []);

  /** Opens the spot menu at a screen point. A long press and the browser's own context menu can both fire; the
   *  second within a moment is the same press. */
  const showMenuAt = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      const frameElement = frameRef.current;
      if (!menu || menu.length === 0 || !svg || !frameElement || !width) return;
      const now = Date.now();
      if (now - lastMenuAt.current < 700) return;
      lastMenuAt.current = now;
      const point = imagePointFromClient(svg, clientX, clientY);
      if (!point) return;
      const rect = frameElement.getBoundingClientRect();
      setOpenMenu({ point: clampPoint(point, width, height), left: clientX - rect.left, top: clientY - rect.top });
    },
    [menu, width, height]
  );

  // The menu closes on Escape and on a press anywhere outside it.
  useEffect(() => {
    if (!openMenu) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
    };
    const onDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    menuRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [openMenu]);

  const distanceBetweenPointers = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button === 2) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      clearPress();
      gesture.current = { mode: "pinch", startDist: distanceBetweenPointers(), startZoom: camera?.zoom ?? 1 };
      return;
    }
    const pinId = (event.target as Element).closest("[data-pin-id]")?.getAttribute("data-pin-id") ?? null;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (pinId && !placing) {
      gesture.current = { mode: "pin", pointerId: event.pointerId, pinId, moved: false };
      return;
    }
    gesture.current = {
      mode: "pan",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY
    };
    // A finger held still opens the spot menu; a mouse has its right button for that.
    if (event.pointerType !== "mouse" && menu && menu.length > 0 && !placing) {
      const { clientX, clientY } = event;
      clearPress();
      pressTimer.current = window.setTimeout(() => {
        pressTimer.current = null;
        gesture.current = { mode: "idle" };
        showMenuAt(clientX, clientY);
      }, LONG_PRESS_MS);
    }
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (pointers.current.has(event.pointerId))
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const state = gesture.current;
    const svg = svgRef.current;
    if (!svg || !camera || !width) return;
    if (state.mode === "pinch") {
      const dist = distanceBetweenPointers();
      if (state.startDist > 0)
        setCamera((prev) => (prev ? { ...prev, zoom: clampZoom(state.startZoom * (dist / state.startDist)) } : prev));
      return;
    }
    if (state.mode === "pan" && state.pointerId === event.pointerId) {
      if (Math.hypot(event.clientX - state.startX, event.clientY - state.startY) > LONG_PRESS_SLOP) clearPress();
      const rect = svg.getBoundingClientRect();
      const perPixel = rect.width > 0 ? viewWidth / rect.width : 0;
      const dx = (event.clientX - state.lastX) * (scale > 0 ? unit : perPixel);
      const dy = (event.clientY - state.lastY) * (scale > 0 ? unit : perPixel);
      state.lastX = event.clientX;
      state.lastY = event.clientY;
      setCamera((prev) => (prev ? { cx: prev.cx - dx, cy: prev.cy - dy, zoom: prev.zoom } : prev));
      return;
    }
    if (state.mode === "pin" && state.pointerId === event.pointerId && !readOnly && onPinDragEnd) {
      const point = imagePointFromClient(svg, event.clientX, event.clientY);
      if (point) {
        state.moved = true;
        setDragPreview({ id: state.pinId, ...clampPoint(point, width, height) });
      }
    }
  };

  const endPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    clearPress();
    const state = gesture.current;
    const svg = svgRef.current;
    // A gesture the system took over discards its preview and sends nothing.
    const cancelled = event.type === "pointercancel";
    if (state.mode === "pin" && state.pointerId === event.pointerId) {
      if (!cancelled) {
        if (!state.moved) onPinClick?.(state.pinId);
        else if (dragPreview && dragPreview.id === state.pinId)
          onPinDragEnd?.(state.pinId, { x: dragPreview.x, y: dragPreview.y });
      }
      setDragPreview(null);
    } else if (!cancelled && state.mode === "pan" && state.pointerId === event.pointerId && svg && placing && width) {
      // Only a tap drops; a pan is never a drop.
      const point = imagePointFromClient(svg, event.clientX, event.clientY);
      if (point && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < 4)
        onPlace?.(clampPoint(point, width, height));
    }
    if (pointers.current.size < 2) gesture.current = { mode: "idle" };
  };

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    // The keyboard's way to the spot menu, at the middle of the map.
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      const rect = svgRef.current?.getBoundingClientRect();
      if (rect) showMenuAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
    } else if (event.key === "+" || event.key === "=") {
      setCamera((prev) => (prev ? { ...prev, zoom: clampZoom(prev.zoom * 1.25) } : prev));
    } else if (event.key === "-") {
      setCamera((prev) => (prev ? { ...prev, zoom: clampZoom(prev.zoom / 1.25) } : prev));
    }
  };

  if (image.status === "loading")
    return (
      <div className={`atlas-map atlas-map-status${className ? ` ${className}` : ""}`} ref={surface}>
        <Skeleton variant="block" width="100%" height="100%" />
      </div>
    );
  if (image.status === "error")
    return (
      <div className={`atlas-map atlas-map-status is-error${className ? ` ${className}` : ""}`} ref={surface}>
        {image.message}
      </div>
    );

  const pinSize = PIN_PX * unit;
  const labelSize = LABEL_PX * unit;
  const personSize = PERSON_PX * unit;
  const groundRadius = Math.min(width, height) * GROUND_SHARE;

  return (
    <div
      ref={surface}
      className={`atlas-map${placing ? " is-placing" : ""}${className ? ` ${className}` : ""}`}
      onContextMenu={(event) => {
        if (!menu || menu.length === 0) return;
        event.preventDefault();
        showMenuAt(event.clientX, event.clientY);
      }}
    >
      <svg
        ref={svgRef}
        className="atlas-map-svg"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onKeyDown={onKeyDown}
      >
        <image href={image.url} x={0} y={0} width={width} height={height} />

        {/* Faction ground, under every pin. Hidden ground is the GM's alone, dashed in violet. */}
        {ground?.map((patch) => (
          <g
            key={patch.key}
            className={`atlas-ground${patch.hidden ? " is-hidden" : ""}`}
            style={{ color: patch.hidden ? undefined : `var(--pin-${patch.tone})` }}
          >
            <circle
              cx={patch.x}
              cy={patch.y}
              r={groundRadius}
              strokeWidth={3 * unit}
              strokeDasharray={patch.hidden ? `${10 * unit} ${7 * unit}` : undefined}
            />
            {patch.labelled && (
              <text
                className="atlas-ground-label"
                x={patch.x}
                y={patch.y - groundRadius - 6 * unit}
                textAnchor="middle"
                style={{ fontSize: GROUND_LABEL_PX * unit, strokeWidth: 4 * unit }}
              >
                {patch.hidden ? `${patch.name} (Hidden)` : patch.name}
              </text>
            )}
          </g>
        ))}

        {pins.map((pin) => {
          const pos = dragPreview && dragPreview.id === pin.id ? dragPreview : pin;
          const here = people?.get(pin.id) ?? [];
          const name = pin.isParty
            ? pin.label
              ? `${pin.label}, ${PARTY_LABEL.toLowerCase()}`
              : PARTY_LABEL
            : (pin.label ?? "Unlabelled pin");
          return (
            <g
              key={pin.id}
              data-pin-id={pin.id}
              transform={`translate(${pos.x} ${pos.y})`}
              className={`atlas-pin${pin.id === selectedPinId ? " is-selected" : ""}${pin.revealedToPlayers === false ? " is-hidden" : ""}${pin.isParty ? " is-party" : ""}${dimmedPinIds?.has(pin.id) ? " is-dimmed" : ""}`}
            >
              <title>{pin.revealedToPlayers === false ? `${name}, hidden` : name}</title>
              {pin.isParty && <circle className="atlas-pin-partyring" r={pinSize * 0.78} strokeWidth={2.5 * unit} />}
              {pin.id === selectedPinId && (
                <circle className="atlas-pin-selectring" r={pinSize * 0.86} strokeWidth={2.5 * unit} />
              )}
              <g
                transform={`translate(${-pinSize / 2} ${-pinSize / 2}) scale(${pinSize / 24})`}
                style={{ color: pinSwatchVar(pin.iconColor) }}
              >
                <circle
                  cx={12}
                  cy={12}
                  r={11.5}
                  className="atlas-pin-bg"
                  strokeDasharray={pin.revealedToPlayers === false ? "3 2" : undefined}
                />
                <g className="atlas-pin-ico" transform="translate(5 5) scale(0.58)">
                  {iconChildren(pin.iconId)}
                </g>
              </g>
              {pin.label && (
                <text
                  className="atlas-pin-label"
                  y={pinSize / 2 + labelSize * 1.05}
                  textAnchor="middle"
                  style={{ fontSize: labelSize, strokeWidth: 3.5 * unit }}
                >
                  {pin.label}
                </text>
              )}
              {pin.isParty && (
                <text
                  className="atlas-pin-partylabel"
                  y={pinSize / 2 + labelSize * (pin.label ? 2.2 : 1.05)}
                  textAnchor="middle"
                  style={{ fontSize: labelSize * 0.9, strokeWidth: 3.5 * unit }}
                >
                  {PARTY_LABEL}
                </text>
              )}
              {here.slice(0, 3).map((person, index) => (
                <g
                  key={person.id}
                  className={`atlas-person${person.hidden ? " is-hidden" : ""}`}
                  transform={`translate(${pinSize * 0.62 + index * personSize * 1.1} ${-pinSize * 0.62})`}
                >
                  <title>{person.hidden ? `${person.name}, hidden` : person.name}</title>
                  <circle
                    r={personSize / 2}
                    strokeWidth={2 * unit}
                    strokeDasharray={person.hidden ? `${4 * unit} ${2 * unit}` : undefined}
                  />
                  <text
                    textAnchor="middle"
                    y={personSize * 0.16}
                    style={{ fontSize: personSize * 0.42 }}
                    aria-hidden="true"
                  >
                    {person.initials}
                  </text>
                </g>
              ))}
              {here.length > 3 && (
                <text
                  className="atlas-person-more"
                  x={pinSize * 0.62 + 3 * personSize * 1.1}
                  y={-pinSize * 0.62 + personSize * 0.16}
                  style={{ fontSize: personSize * 0.42, strokeWidth: 3 * unit }}
                >
                  +{here.length - 3}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {placing && hint && (
        <div className="atlas-map-hint" role="status">
          {hint}
        </div>
      )}
      {overlay && <div className="atlas-map-overlay">{overlay}</div>}
      {openMenu && menu && (
        <div
          ref={menuRef}
          className="atlas-spotmenu anim-popover"
          role="menu"
          aria-label="This spot"
          style={{ left: openMenu.left, top: openMenu.top }}
          onKeyDown={(event) => {
            const items = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [])];
            const at = items.indexOf(document.activeElement as HTMLElement);
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              items[(at + step + items.length) % items.length]?.focus();
            }
          }}
        >
          {menu.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="atlas-spotmenu-item"
              onClick={() => {
                const point = openMenu.point;
                setOpenMenu(null);
                item.onSelect(point);
              }}
            >
              <CodexIcon iconId={item.iconId} className="atlas-spotmenu-icon" />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
