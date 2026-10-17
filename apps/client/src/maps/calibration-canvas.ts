import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { squareCorner } from "./calibration-overlays";
import type { Point } from "./map-catalog";

/** The calibration canvas's two gestures: zooming the preview, and placing the 3 × 3 area. */

type Size = Readonly<{ width: number; height: number }>;
export type Area = Readonly<{ start: Point; end: Point }>;
type Camera = Readonly<{ center: Point; zoom: number }>;

/**
 * Zoom on the calibration preview to place the 3×3 box precisely: the wheel zooms at the pointer and
 * the buttons at the centre, never out past the full map. Camera only: the server still owns every
 * measurement.
 */
export function usePreviewZoom(map: Size) {
  const [camera, setCamera] = useState<Camera | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const fx = (clientX - rect.left) / rect.width,
        fy = (clientY - rect.top) / rect.height;
      const cam = camera ?? { center: { x: map.width / 2, y: map.height / 2 }, zoom: 1 };
      const w = map.width / cam.zoom,
        h = map.height / cam.zoom;
      const imageX = cam.center.x - w / 2 + fx * w,
        imageY = cam.center.y - h / 2 + fy * h;
      const nextZoom = Math.max(1, Math.min(8, cam.zoom * factor));
      if (nextZoom <= 1) {
        setCamera(null);
        return;
      }
      const w2 = map.width / nextZoom,
        h2 = map.height / nextZoom;
      const cx = Math.min(Math.max(imageX + w2 * (0.5 - fx), w2 / 2), map.width - w2 / 2);
      const cy = Math.min(Math.max(imageY + h2 * (0.5 - fy), h2 / 2), map.height - h2 / 2);
      setCamera({ center: { x: cx, y: cy }, zoom: nextZoom });
    },
    [map.width, map.height, camera]
  );
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!svgRef.current) return;
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.15 : 1 / 1.15);
    };
    // React's onWheel is passive, so preventDefault would be ignored; this must stay a manual,
    // non-passive listener.
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);
  /** Button zoom for touch devices (wheel zoom is mouse-only). Zooms at the canvas centre; not a pinch
      gesture, which would compete with the 3×3 drag. */
  const zoomFromCentre = (factor: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  };
  const viewBox = camera
    ? `${camera.center.x - map.width / camera.zoom / 2} ${camera.center.y - map.height / camera.zoom / 2} ${map.width / camera.zoom} ${map.height / camera.zoom}`
    : `0 0 ${map.width} ${map.height}`;
  return { camera, viewBox, svgRef, previewRef, zoomFromCentre, reset: () => setCamera(null) };
}

/**
 * Placing the 3 × 3 area: press on an intersection and drag diagonally; once placed, drag inside it to
 * move it or at its corner to resize it. `placing` is the square path before the server has measured;
 * `pointAt` maps a client point into the image. The placed area itself is the pane's state. `surface`
 * is the canvas element the handlers go on.
 */
export function useGridAreaGesture({
  map,
  surface,
  placing,
  busy,
  pendingArea,
  setPendingArea,
  setPoints,
  pointAt
}: Readonly<{
  map: Size;
  surface: RefObject<HTMLElement | null>;
  placing: boolean;
  busy: boolean;
  pendingArea: Area | null;
  setPendingArea: (update: (current: Area | null) => Area | null) => void;
  setPoints: (points: Point[]) => void;
  pointAt: (clientX: number, clientY: number) => Point | null;
}>) {
  // `touch-action: none` stops the page scrolling here, yet a drag that lifts mid-motion still starts a browser fling,
  // and the browser spends the next tap (often Measure this area) on stopping it. A cancelled touchmove never becomes
  // a scroll, so no fling starts. React's touch listeners are passive, so this one is native.
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const cancel = (event: TouchEvent) => event.preventDefault();
    element.addEventListener("touchmove", cancel, { passive: false });
    return () => element.removeEventListener("touchmove", cancel);
  }, [surface]);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragCurrent, setDragCurrent] = useState<Point | null>(null);
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);
  const [areaAction, setAreaAction] = useState<"move" | "resize" | null>(null);
  const [moveGrab, setMoveGrab] = useState<Point | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!placing || busy) return;
    const point = pointAt(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pendingArea) {
      const handleRadius = Math.max(10, Math.min(map.width, map.height) / 30);
      const nearCorner = Math.hypot(point.x - pendingArea.end.x, point.y - pendingArea.end.y) <= handleRadius;
      if (nearCorner) {
        setAreaAction("resize");
        return;
      }
      setAreaAction("move");
      setMoveGrab({ x: point.x - pendingArea.start.x, y: point.y - pendingArea.start.y });
      return;
    }
    setPoints([]);
    setDragStart(point);
    setDragCurrent(point);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const point = pointAt(event.clientX, event.clientY);
    if (!point) return;
    const captured = event.currentTarget.hasPointerCapture(event.pointerId);
    if (dragStart && captured) {
      event.preventDefault();
      setDragCurrent(squareCorner(dragStart, point, map.width, map.height));
      return;
    }
    if (pendingArea && areaAction === "resize" && captured) {
      event.preventDefault();
      setPendingArea(
        (current) => current && { start: current.start, end: squareCorner(current.start, point, map.width, map.height) }
      );
      return;
    }
    if (pendingArea && areaAction === "move" && moveGrab && captured) {
      event.preventDefault();
      setPendingArea((current) => {
        if (!current) return current;
        const sideX = current.end.x - current.start.x;
        const sideY = current.end.y - current.start.y;
        const size = Math.abs(sideX);
        const minX = sideX >= 0 ? 0 : size;
        const maxX = sideX >= 0 ? map.width - size : map.width;
        const minY = sideY >= 0 ? 0 : size;
        const maxY = sideY >= 0 ? map.height - size : map.height;
        const startX = Math.min(Math.max(point.x - moveGrab.x, minX), maxX);
        const startY = Math.min(Math.max(point.y - moveGrab.y, minY), maxY);
        return { start: { x: startX, y: startY }, end: { x: startX + sideX, y: startY + sideY } };
      });
      return;
    }
    if (!dragStart && !pendingArea && placing) setHoverPoint(point);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (dragStart) {
      const point = pointAt(event.clientX, event.clientY);
      const start = dragStart;
      const end = point ? squareCorner(start, point, map.width, map.height) : (dragCurrent ?? start);
      setDragStart(null);
      setDragCurrent(null);
      // A tap is not a drag: the press seeds `dragCurrent = dragStart`, and the server refuses a
      // zero-width or zero-height box (`grid-calibration.ts`). So a zero-side release leaves the step as
      // it was; the server judges everything else.
      if (end.x === start.x || end.y === start.y) return;
      setPendingArea(() => ({ start, end }));
      setPoints([start, end]);
      return;
    }
    if (areaAction) {
      if (pendingArea) setPoints([pendingArea.start, pendingArea.end]);
      setAreaAction(null);
      setMoveGrab(null);
    }
  };
  const onPointerCancel = () => {
    setDragStart(null);
    setDragCurrent(null);
    setAreaAction(null);
    setMoveGrab(null);
  };
  const onPointerLeave = () => {
    if (!dragStart && !areaAction) setHoverPoint(null);
  };
  const reset = () => {
    onPointerCancel();
    setHoverPoint(null);
  };

  // While dragging or resizing, the crosshair tracks the moving corner; once placed, both corners get
  // one so either edge can be lined up against the printed grid.
  const crosshairPoints: readonly Point[] = placing
    ? dragStart && dragCurrent
      ? [dragCurrent]
      : pendingArea
        ? areaAction === "resize"
          ? [pendingArea.end]
          : areaAction === "move"
            ? []
            : [pendingArea.start, pendingArea.end]
        : hoverPoint
          ? [hoverPoint]
          : []
    : [];

  return {
    drag: dragStart && dragCurrent ? { start: dragStart, end: dragCurrent } : null,
    areaAction,
    crosshairPoints,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave },
    reset
  };
}
