import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import type {
  Annotation,
  AnnotationShapeKind,
  EncounterToken,
  GmActor,
  PlayerActor,
  PlayerAnnotation
} from "@vtt/domain";
import { setTemplatePlacement, toggleTarget, type TargetingSession } from "../encounter/targeting";
import type { GridCalibration } from "./gridPreview";
import { imagePointFromClient } from "./mapImage";
import { isVisionTool, type AreaKindId, type MapTool } from "./mapTools";
import type { MapCommands } from "./useMapCommands";
import {
  anchoredCamera,
  clampZoom,
  imageAtFraction,
  MAP_OVERLAYS,
  viewSize,
  type MapView,
  type Point
} from "./useMapView";

type AnyAnnotation = Annotation | PlayerAnnotation;

/** The pointer interaction in progress on the map. Every live preview is derived from it. */
export type Gesture =
  /** `pressClient` is where the pointer went down, in client pixels (`origin`/`point` are map space);
      with `fromTray` it distinguishes a tap on a staging chip from a drag out of the tray. */
  | Readonly<{
      kind: "token";
      actorId: string;
      point: Point | null;
      origin: Point | null;
      pressClient: Readonly<{ x: number; y: number }>;
      fromTray: boolean;
    }>
  | Readonly<{ kind: "pan"; startClient: Point; startCenter: Point; scaleX: number; scaleY: number }>
  | Readonly<{ kind: "measure" | AnnotationShapeKind; origin: Point; current: Point }>
  | Readonly<{ kind: "fog"; op: "reveal" | "hide"; origin: Point; current: Point }>
  | Readonly<{ kind: "terrain"; op: "difficult" | "clear"; origin: Point; current: Point }>
  | Readonly<{ kind: "wall"; wallKind: "wall" | "door" | "window"; origin: Point; current: Point }>
  | Readonly<{ kind: "vision-area"; origin: Point; current: Point }>
  | Readonly<{ kind: "annotation-move"; id: string; grab: Point; geometry: Readonly<{ origin: Point; target: Point }> }>
  | Readonly<{ kind: "annotation-resize"; id: string; anchor: Point; current: Point }>
  /** Two fingers. Every field is read when the pinch begins and never updated, so zoom is absolute
      (a ratio against `startDist`): dropped moves lose nothing, and returning to the starting span
      returns to the starting zoom. `startFocus` is the fingers' midpoint in the SVG box (0..1 per
      axis); with `startCenter`/`startZoom` it names the image point that stays between the fingers,
      so the map scales under them and moving both fingers pans. */
  | Readonly<{
      kind: "pinch";
      startDist: number;
      startZoom: number;
      startCenter: Point;
      startFocus: Readonly<{ x: number; y: number }>;
    }>;

/** How far a pointer may travel and still be a tap; the same 8px that cancels a long press. */
const TAP_SLOP = 8;

/**
 * Pointer and keyboard handling for the map stage: token drags (and the tray's tap-to-place), pan,
 * pinch, measuring and shapes, fog strokes, walls and lights, doors, moving and resizing a shape, template
 * placement, and the token menu by right-click or long press. Nothing is sent until a gesture ends, and a second
 * finger abandons the gesture underneath.
 */
export function useMapGestures({
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
  actors,
  tokensById,
  resetKey,
  onSelect,
  onContextMenu: openMenu,
  onPlaceLight,
  areaKind = "heavily-obscured",
  onTokenPress,
  readOnly = false,
  armedActorId = null,
  onPlaceArmed,
  onMapMenu,
  onDoorMenu,
  onWallAim,
  onLightAim
}: Readonly<{
  role: "gm" | "player";
  tool: MapTool;
  size: Readonly<{ width: number; height: number }> | null;
  calibration: GridCalibration | null;
  svgRef: React.RefObject<SVGSVGElement | null>;
  trayRef: React.RefObject<HTMLDivElement | null>;
  view: MapView;
  commands: MapCommands;
  /** The GM's targeting session; token presses pick targets while one is live. */
  activeTargeting: TargetingSession | null;
  annotationAt: (id: string) => AnyAnnotation | null;
  gmLayer: boolean;
  canMove: (actorId: string) => boolean;
  canMoveShape: (annotation: AnyAnnotation) => boolean;
  actors: ReadonlyMap<string, GmActor | PlayerActor>;
  tokensById: ReadonlyMap<string, EncounterToken>;
  /** A new map or session drops the gesture in progress. */
  resetKey: string;
  onSelect: (annotationId: string | null) => void;
  onContextMenu: (menu: Readonly<{ actorId: string; x: number; y: number }>) => void;
  /** The GM's Light tool: a tap places the chosen light there. */
  onPlaceLight?: (point: Point) => void;
  /** What the GM's Paint area tool paints. */
  areaKind?: AreaKindId;
  /** A token pressed with the Select tool, or opened for its menu. */
  onTokenPress?: (actorId: string) => void;
  /** The map only shows: a drag pans and two fingers zoom, and nothing is sent. */
  readOnly?: boolean;
  /** A creature waiting to be placed: the next press on the map puts it there (button, then click). */
  armedActorId?: string | null;
  onPlaceArmed?: (point: Point) => void;
  /** A right-click or a long press on an empty spot: the menu of what can go there. */
  onMapMenu?: (menu: Readonly<{ point: Point; x: number; y: number }>) => void;
  /** A tap on a door's handle: its menu, at the pointer. */
  onDoorMenu?: (menu: Readonly<{ wallId: string; x: number; y: number }>) => void;
  /** A tap on a door or a wall while an action is aimed: that wall is its target. */
  onWallAim?: (wallId: string) => void;
  /** While an action is aimed, a flame set on the map was tapped (Druidcraft's Fire Play). */
  onLightAim?: (lightId: string) => void;
}>) {
  const { camera, setCamera, boxFraction } = view;
  const { busyActorId, setMessage } = commands;
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const longPressRef = useRef<{ startX: number; startY: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Live touch points by `pointerId`. Every other gesture is single-pointer via `setPointerCapture`,
   * so without this a second finger is invisible. Mirrors the Codex atlas (`codex/atlas/AtlasMap.tsx`).
   * Mouse pointers are never tracked: a mouse cannot pinch, and an untracked pointer can never be
   * mistaken for a pinch's second finger.
   */
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  /** Which pointer holds capture, so a pinch can release a capture taken by a different pointer (the
      aborted gesture's). */
  const capturedPointerRef = useRef<number | null>(null);
  useEffect(() => {
    setGesture(null);
    pointers.current.clear();
  }, [resetKey]);
  /**
   * A finger lifted off the map (over browser chrome, past the window edge) raises no `pointerup`
   * here, and a stale tracked pointer would make the next touch look like a pinch. The window hears
   * all of them; it runs after the React handlers, so this only catches strays.
   */
  useEffect(() => {
    const tracked = pointers.current;
    const forget = (event: globalThis.PointerEvent) => {
      tracked.delete(event.pointerId);
    };
    window.addEventListener("pointerup", forget);
    window.addEventListener("pointercancel", forget);
    return () => {
      window.removeEventListener("pointerup", forget);
      window.removeEventListener("pointercancel", forget);
    };
  }, []);
  const pointFromScreen = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg || !size) return null;
    const point = imagePointFromClient(svg, clientX, clientY);
    return point && point.x >= 0 && point.x <= size.width && point.y >= 0 && point.y <= size.height ? point : null;
  };
  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressRef.current = null;
  };
  /** Takes capture and records who holds it: the pinch abort must release a capture taken by a
      different pointer than the one triggering it. */
  const capturePointer = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    capturedPointerRef.current = event.pointerId;
  };
  /** Release `pointerId` and whatever else is on record as captured; both are no-ops when untrue. */
  const dropCapture = (element: HTMLDivElement, pointerId: number) => {
    const held = capturedPointerRef.current;
    capturedPointerRef.current = null;
    for (const id of held === null || held === pointerId ? [pointerId] : [pointerId, held]) {
      try {
        if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
      } catch {
        /* pointer already released */
      }
    }
  };
  const openContextMenuFor = (actorId: string, x: number, y: number) => {
    onTokenPress?.(actorId);
    if (!actors.has(actorId)) return;
    if (role === "player" && !canMove(actorId)) return; // players only act on their own claimed token
    onSelect(null);
    openMenu({ actorId, x, y });
  };
  // Mouse right-click opens the token menu, or off a token the spot's menu; touch uses a long press started in
  // beginGesture.
  const onContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (readOnly) return;
    const actorId = (event.target as Element).closest<HTMLElement>("[data-token-id]")?.dataset.tokenId;
    if (!actorId || !tokensById.has(actorId)) {
      const point =
        onMapMenu && !(event.target as Element).closest(MAP_OVERLAYS)
          ? pointFromScreen(event.clientX, event.clientY)
          : null;
      // Off the map, the browser's own menu shows.
      if (!point || !onMapMenu) return;
      event.preventDefault();
      onSelect(null);
      onMapMenu({ point, x: event.clientX, y: event.clientY });
      return;
    }
    if (role === "player" && !canMove(actorId)) return;
    event.preventDefault();
    openContextMenuFor(actorId, event.clientX, event.clientY);
  };
  /** Pans from an empty spot (or anywhere on a map that only shows). A finger held still opens the spot's menu. */
  const startPan = (event: PointerEvent<HTMLDivElement>) => {
    const svg = svgRef.current;
    if (!svg || !size || !(event.target as Element).closest("svg")) return;
    onSelect(null);
    event.preventDefault();
    capturePointer(event);
    const rect = svg.getBoundingClientRect();
    const shown = viewSize(size, view.box, camera.zoom);
    setGesture({
      kind: "pan",
      startClient: { x: event.clientX, y: event.clientY },
      startCenter: camera.center,
      scaleX: shown.width / rect.width,
      scaleY: shown.height / rect.height
    });
    const point =
      onMapMenu && !readOnly && event.pointerType === "touch" ? pointFromScreen(event.clientX, event.clientY) : null;
    if (point && onMapMenu) {
      const captureEl = event.currentTarget,
        pointerId = event.pointerId,
        startX = event.clientX,
        startY = event.clientY;
      clearLongPress();
      longPressRef.current = { startX, startY };
      longPressTimerRef.current = setTimeout(() => {
        clearLongPress();
        try {
          captureEl.releasePointerCapture(pointerId);
        } catch {
          /* pointer already released */
        }
        setGesture(null);
        onMapMenu({ point, x: startX, y: startY });
      }, 500);
    }
  };

  const beginGesture = (event: PointerEvent<HTMLDivElement>) => {
    if (busyActorId) return;
    // A secondary (right/middle) press opens the context menu via onContextMenu and must not start a
    // token or pan gesture.
    if (event.button !== 0) return;
    const target = event.target as Element;
    if (target.closest(MAP_OVERLAYS)) return;
    /* A second finger on the map always starts a pinch. The gesture underneath is abandoned, never
       finished: capture dropped, long-press timer cleared, `gesture` set to null, which also discards its
       preview (every preview is derived from `gesture`). Nothing is submitted. This sits above every
       tool branch so a second finger cannot fire a second ping or start a second drag. */
    if (event.pointerType !== "mouse") pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2) {
      event.preventDefault();
      clearLongPress();
      dropCapture(event.currentTarget, event.pointerId);
      const [first, second] = [...pointers.current.values()];
      const startFocus = boxFraction((first.x + second.x) / 2, (first.y + second.y) / 2);
      // The selection is kept: it is not a preview and commits nothing.
      setGesture(
        startFocus
          ? {
              kind: "pinch",
              startDist: Math.hypot(first.x - second.x, first.y - second.y),
              startZoom: camera.zoom,
              startCenter: camera.center,
              startFocus
            }
          : null
      );
      return;
    }
    if (readOnly) {
      startPan(event);
      return;
    }
    // A creature armed from outside the map goes where the map is pressed next.
    if (armedActorId && onPlaceArmed) {
      const point = pointFromScreen(event.clientX, event.clientY);
      if (!point) return;
      event.preventDefault();
      onPlaceArmed(point);
      return;
    }
    if (tool === "ping") {
      const point = pointFromScreen(event.clientX, event.clientY);
      if (!point) return;
      event.preventDefault();
      void commands.ping(point);
      return;
    }
    // Placing an area template takes over the drag (GM only), even starting on a token; the server
    // computes who is caught.
    if (activeTargeting?.mode === "template" && activeTargeting.template && calibration) {
      const point = pointFromScreen(event.clientX, event.clientY);
      if (!point) return;
      event.preventDefault();
      capturePointer(event);
      onSelect(null);
      setGesture({ kind: activeTargeting.template.shape, origin: point, current: point });
      return;
    }
    // While an action is aimed, a flame set on the map takes the tap as its target (Fire Play).
    const aimedLight = activeTargeting && onLightAim ? target.closest("[data-light-target]") : null;
    if (tool === "select" && aimedLight) {
      event.preventDefault();
      onLightAim!(aimedLight.getAttribute("data-light-target")!);
      return;
    }
    // While an action is aimed, a door or a wall takes the tap as its target: an attack on it, or a spell such as Knock.
    const aimedWall = activeTargeting && onWallAim ? target.closest("[data-wall-target], [data-door-id]") : null;
    if (tool === "select" && aimedWall) {
      event.preventDefault();
      onWallAim!(aimedWall.getAttribute("data-wall-target") ?? aimedWall.getAttribute("data-door-id")!);
      return;
    }
    // A door's handle opens its menu (open or close it, work on it); without one it opens or closes it. The server
    // checks who may.
    const door = target.closest("[data-door-id]");
    if (tool === "select" && door) {
      event.preventDefault();
      const doorId = door.getAttribute("data-door-id")!;
      if (onDoorMenu) onDoorMenu({ wallId: doorId, x: event.clientX, y: event.clientY });
      else void commands.setDoorOpen(doorId, door.getAttribute("data-door-open") !== "true");
      return;
    }
    if (role === "gm" && isVisionTool(tool)) {
      const point = pointFromScreen(event.clientX, event.clientY);
      if (!point) return;
      event.preventDefault();
      if (tool === "vision-erase") {
        const wallId = target.closest("[data-wall-id]")?.getAttribute("data-wall-id");
        const lightId = target.closest("[data-light-id]")?.getAttribute("data-light-id");
        const areaId = target.closest("[data-area-id]")?.getAttribute("data-area-id");
        if (wallId) void commands.removeWall(wallId);
        else if (lightId) void commands.removeLight(lightId);
        else if (areaId) void commands.removeArea(areaId);
        else setMessage("Tap a wall, door, window, light or area to remove it.");
        return;
      }
      if (tool === "vision-light") {
        onPlaceLight?.(point);
        return;
      }
      if (tool === "vision-area") {
        capturePointer(event);
        setMessage("");
        setGesture({ kind: "vision-area", origin: point, current: point });
        return;
      }
      capturePointer(event);
      setMessage("");
      setGesture({
        kind: "wall",
        wallKind: tool === "vision-door" ? "door" : tool === "vision-window" ? "window" : "wall",
        origin: point,
        current: point
      });
      return;
    }
    const handleId = target.closest<HTMLElement>("[data-annotation-handle]")?.dataset.annotationHandle;
    const shapeId = target.closest<HTMLElement>("[data-annotation-id]")?.dataset.annotationId;
    if (tool === "select" && shapeId) {
      const annotation = annotationAt(shapeId);
      // While GM ink is on, only the GM's own (gm-only) shapes are interactive.
      if (
        annotation &&
        annotation.kind === "shape" &&
        !(role === "gm" && gmLayer && annotation.visibility !== "gm-only")
      ) {
        onSelect(shapeId);
        if (canMoveShape(annotation) && handleId) {
          const point = pointFromScreen(event.clientX, event.clientY);
          if (!point) return;
          event.preventDefault();
          capturePointer(event);
          if (handleId === "resize")
            setGesture({
              kind: "annotation-resize",
              id: annotation.id,
              anchor: annotation.geometry.origin,
              current: point
            });
          else
            setGesture({
              kind: "annotation-move",
              id: annotation.id,
              grab: { x: point.x - annotation.geometry.origin.x, y: point.y - annotation.geometry.origin.y },
              geometry: annotation.geometry
            });
        }
        return;
      }
    }
    const tokenId = target.closest<HTMLElement>("[data-token-id]")?.dataset.tokenId;
    // While a targeting session is live (GM only), token presses select targets and never start a drag.
    // The attacker itself stays draggable.
    if (activeTargeting && tokenId && tokensById.has(tokenId) && tokenId !== activeTargeting.attackerId) {
      event.preventDefault();
      toggleTarget(tokenId);
      return;
    }
    if (tool === "select" && tokenId && tokensById.has(tokenId)) {
      onTokenPress?.(tokenId);
      if (!canMove(tokenId)) return;
      event.preventDefault();
      capturePointer(event);
      onSelect(null);
      const origin = tokensById.get(tokenId)?.position ?? null;
      setMessage("");
      setGesture({
        kind: "token",
        actorId: tokenId,
        point: origin,
        origin,
        pressClient: { x: event.clientX, y: event.clientY },
        fromTray: target.closest(".encounter-token-tray") !== null
      });
      if (event.pointerType === "touch") {
        const captureEl = event.currentTarget,
          pointerId = event.pointerId,
          startX = event.clientX,
          startY = event.clientY;
        clearLongPress();
        longPressRef.current = { startX, startY };
        longPressTimerRef.current = setTimeout(() => {
          clearLongPress();
          try {
            captureEl.releasePointerCapture(pointerId);
          } catch {
            /* pointer already released */
          }
          setGesture(null);
          openContextMenuFor(tokenId, startX, startY);
        }, 500);
      }
      return;
    }
    // Fog painting works on gridless maps too (the server keeps the raw rect there).
    if ((tool === "fog-reveal" || tool === "fog-hide") && role === "gm") {
      const point = pointFromScreen(event.clientX, event.clientY);
      if (!point) return;
      event.preventDefault();
      capturePointer(event);
      setMessage("");
      setGesture({ kind: "fog", op: tool === "fog-reveal" ? "reveal" : "hide", origin: point, current: point });
      return;
    }
    // Terrain lives in grid cells, so it needs a calibrated map.
    if ((tool === "terrain-difficult" || tool === "terrain-clear") && role === "gm" && calibration) {
      const point = pointFromScreen(event.clientX, event.clientY);
      if (!point) return;
      event.preventDefault();
      capturePointer(event);
      setMessage("");
      setGesture({
        kind: "terrain",
        op: tool === "terrain-difficult" ? "difficult" : "clear",
        origin: point,
        current: point
      });
      return;
    }
    if (
      tool !== "select" &&
      tool !== "terrain-difficult" &&
      tool !== "terrain-clear" &&
      !isVisionTool(tool) &&
      calibration
    ) {
      const point = pointFromScreen(event.clientX, event.clientY);
      if (!point) return;
      event.preventDefault();
      capturePointer(event);
      setMessage("");
      setGesture({ kind: tool as "measure" | AnnotationShapeKind, origin: point, current: point });
      return;
    }
    // Empty background in select mode: deselect + pan.
    if (tool === "select") startPan(event);
  };
  const continueGesture = (event: PointerEvent<HTMLDivElement>) => {
    if (pointers.current.has(event.pointerId))
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    /* The pinch branch must run before the capture guard: a pinch holds no capture, so the guard would
       drop all its moves. Reading `pointers` lets either finger's move recompute the whole gesture. */
    if (gesture?.kind === "pinch") {
      event.preventDefault();
      const [first, second] = [...pointers.current.values()];
      if (!first || !second || gesture.startDist <= 0) return;
      const focus = boxFraction((first.x + second.x) / 2, (first.y + second.y) / 2);
      if (!focus || !size) return;
      const anchor = imageAtFraction(size, view.box, gesture.startFocus, {
        center: gesture.startCenter,
        zoom: gesture.startZoom
      });
      setCamera(
        anchoredCamera(
          size,
          view.box,
          anchor,
          focus,
          clampZoom(
            gesture.startZoom * (Math.hypot(first.x - second.x, first.y - second.y) / gesture.startDist),
            size,
            view.box
          )
        )
      );
      return;
    }
    if (!gesture || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.preventDefault();
    if (gesture.kind === "token") {
      if (
        longPressRef.current &&
        (Math.abs(event.clientX - longPressRef.current.startX) > 8 ||
          Math.abs(event.clientY - longPressRef.current.startY) > 8)
      )
        clearLongPress();
      setGesture({ ...gesture, point: pointFromScreen(event.clientX, event.clientY) });
      return;
    }
    if (gesture.kind === "pan") {
      if (
        longPressRef.current &&
        (Math.abs(event.clientX - longPressRef.current.startX) > TAP_SLOP ||
          Math.abs(event.clientY - longPressRef.current.startY) > TAP_SLOP)
      )
        clearLongPress();
      const dx = (event.clientX - gesture.startClient.x) * gesture.scaleX;
      const dy = (event.clientY - gesture.startClient.y) * gesture.scaleY;
      setCamera((current) => ({
        ...current,
        center: { x: gesture.startCenter.x - dx, y: gesture.startCenter.y - dy }
      }));
      return;
    }
    const point = pointFromScreen(event.clientX, event.clientY);
    if (!point) return;
    if (gesture.kind === "annotation-resize") {
      setGesture({ ...gesture, current: point });
      return;
    }
    if (gesture.kind === "annotation-move") {
      const width = gesture.geometry.target.x - gesture.geometry.origin.x;
      const height = gesture.geometry.target.y - gesture.geometry.origin.y;
      const origin = { x: point.x - gesture.grab.x, y: point.y - gesture.grab.y };
      setGesture({ ...gesture, geometry: { origin, target: { x: origin.x + width, y: origin.y + height } } });
      return;
    }
    setGesture({ ...gesture, current: point });
  };
  const finishGesture = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    clearLongPress();
    /* A pinch commits nothing. Lifting one of two fingers ends the pinch, and the remaining finger
       starts no pan (as on the Codex atlas). */
    if (gesture?.kind === "pinch") {
      event.preventDefault();
      dropCapture(event.currentTarget, event.pointerId);
      if (pointers.current.size < 2) setGesture(null);
      return;
    }
    if (!gesture || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.preventDefault();
    dropCapture(event.currentTarget, event.pointerId);
    if (gesture.kind === "pan") {
      setGesture(null);
      return;
    }
    if (gesture.kind === "token") {
      const actorId = gesture.actorId;
      const originalPosition = gesture.origin;
      const mapPoint = gesture.point;
      const trayBounds = trayRef.current?.getBoundingClientRect();
      const overTray = Boolean(
        trayBounds &&
        event.clientX >= trayBounds.left &&
        event.clientX <= trayBounds.right &&
        event.clientY >= trayBounds.top &&
        event.clientY <= trayBounds.bottom
      );
      /* Tap-to-place is resolved here because the chip's own click never arrives for a pointer: tray chips
         carry `data-token-id` (they are drag handles too), so a press takes the token-drag branch, which
         captures the pointer on the wrapper, and capture retargets the `click` to the wrapper. A press that
         never moved is a tap; one that travelled is a drag. Keyboard activation still uses the chip's
         `onClick`. */
      const tapped =
        gesture.fromTray &&
        Math.hypot(event.clientX - gesture.pressClient.x, event.clientY - gesture.pressClient.y) <= TAP_SLOP;
      setGesture(null);
      const originalToken = tokensById.get(actorId);
      const unchanged = Boolean(
        mapPoint &&
        originalPosition &&
        Math.hypot(mapPoint.x - originalPosition.x, mapPoint.y - originalPosition.y) <
          (originalToken?.gridSizePx ? originalToken.gridSizePx * 0.45 : 0.5)
      );
      if (tapped) commands.placeAtCenter(actorId);
      else if (overTray) void commands.submitMove(actorId, null);
      else if (unchanged) setMessage("Token stayed in the same space.");
      else if (mapPoint) void commands.submitMove(actorId, mapPoint);
      else setMessage("Move cancelled. Drop the token on the map or in the tray.");
      return;
    }
    if (gesture.kind === "annotation-resize") {
      setGesture(null);
      void commands.moveAnnotation(gesture.id, gesture.anchor, gesture.current);
      return;
    }
    if (gesture.kind === "annotation-move") {
      setGesture(null);
      void commands.moveAnnotation(gesture.id, gesture.geometry.origin, gesture.geometry.target);
      return;
    }
    if (gesture.kind === "fog") {
      const { op, origin, current } = gesture;
      setGesture(null);
      commands.paintFog(op, origin, current);
      return;
    }
    if (gesture.kind === "terrain") {
      const { op, origin, current } = gesture;
      setGesture(null);
      commands.paintTerrain(op, origin, current);
      return;
    }
    if (gesture.kind === "wall") {
      const { wallKind, origin, current } = gesture;
      setGesture(null);
      commands.addWall(wallKind, origin, current);
      return;
    }
    if (gesture.kind === "vision-area") {
      const { origin, current } = gesture;
      setGesture(null);
      commands.addArea(areaKind, origin, current);
      return;
    }
    if (gesture.kind === "measure") {
      setGesture(null);
      void commands.addAnnotation("measurement", undefined, gesture.origin, gesture.current);
      return;
    }
    // A shape drawn while placing an area template goes on the targeting session and stays out of annotations;
    // the server draws the real blast when the action resolves.
    if (activeTargeting?.mode === "template") {
      const { origin, current } = gesture;
      setGesture(null);
      setTemplatePlacement(origin, current);
      return;
    }
    setGesture(null);
    void commands.addAnnotation("shape", gesture.kind, gesture.origin, gesture.current);
  };
  const cancelGesture = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    clearLongPress();
    dropCapture(event.currentTarget, event.pointerId);
    // A cancelled pinch says nothing: "Cancelled." is for an abandoned edit, and two fingers landing a
    // frame apart is ordinary.
    if (gesture?.kind === "pinch") {
      if (pointers.current.size < 2) setGesture(null);
      return;
    }
    setGesture(null);
    setMessage("Cancelled.");
  };
  const keyboardMove = (event: KeyboardEvent<SVGGElement>, encounterToken: EncounterToken) => {
    if (!encounterToken.position || busyActorId || !canMove(encounterToken.actorId)) return;
    const step = encounterToken.gridSizePx ?? encounterToken.sizePx;
    const rotation = encounterToken.gridRotationRadians ?? 0;
    const horizontal = { x: Math.cos(rotation) * step, y: Math.sin(rotation) * step };
    const vertical = { x: -Math.sin(rotation) * step, y: Math.cos(rotation) * step };
    const delta =
      event.key === "ArrowLeft"
        ? { x: -horizontal.x, y: -horizontal.y }
        : event.key === "ArrowRight"
          ? horizontal
          : event.key === "ArrowUp"
            ? { x: -vertical.x, y: -vertical.y }
            : event.key === "ArrowDown"
              ? vertical
              : null;
    if (delta) {
      event.preventDefault();
      void commands.submitMove(encounterToken.actorId, {
        x: encounterToken.position.x + delta.x,
        y: encounterToken.position.y + delta.y
      });
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      void commands.submitMove(encounterToken.actorId, null);
    }
  };

  return {
    gesture,
    handlers: {
      onPointerDown: beginGesture,
      onPointerMove: continueGesture,
      onPointerUp: finishGesture,
      onPointerCancel: cancelGesture,
      onContextMenu
    },
    keyboardMove
  };
}
