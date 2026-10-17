import { useEffect, useEffectEvent, useState, type RefObject } from "react";

export type Point = Readonly<{ x: number; y: number }>;
/**
 * `zoom` is screen pixels per image pixel, so a pane that grows or shrinks shows more or less of the map at the same
 * size. Zero until the map first opens.
 */
export type Camera = Readonly<{ center: Point; zoom: number }>;
type Size = Readonly<{ width: number; height: number }>;
/** A point in the SVG's own box, as a 0..1 fraction on each axis. */
type Fraction = Readonly<{ x: number; y: number }>;

/** Zoom limits against the fit: half the whole map's size, and six times it (or twice the image, if more). */
const MIN_FIT = 0.5;
const MAX_FIT = 6;
const MAX_ABSOLUTE = 2;
/** The smallest a one-cell token is drawn when the map opens or follows a creature, in screen pixels. */
const READABLE_TOKEN_PX = { phone: 32, laptop: 40 } as const;
const PHONE_QUERY = "(max-width: 979px)";

/** Controls inside the stage's box. A press or a wheel over one belongs to the control, never to the map. */
export const MAP_OVERLAYS = ".encounter-shape-editor, .map-rail-wrap";

/** The zoom at which the whole map just fits the box. */
export function fitZoom(size: Size, box: Size | null): number {
  return box && box.width > 0 && box.height > 0 ? Math.min(box.width / size.width, box.height / size.height) : 0;
}
export function clampZoom(zoom: number, size: Size, box: Size | null): number {
  const fit = fitZoom(size, box);
  if (fit <= 0) return zoom;
  return Math.max(fit * MIN_FIT, Math.min(Math.max(fit * MAX_FIT, MAX_ABSOLUTE), zoom));
}

/**
 * The viewBox's size in image units. It takes the box's own shape, so the map fills the stage edge to edge and the
 * view's fractions are the box's fractions. Before the box is measured it is the whole map.
 */
export function viewSize(size: Size, box: Size | null, zoom: number): Size {
  if (!box || box.width <= 0 || box.height <= 0 || zoom <= 0) return size;
  return { width: box.width / zoom, height: box.height / zoom };
}

/* Zoom-to-a-point in pieces shared by wheel and pinch, so they cannot drift. The pinch reads its anchor from the
   camera it started in. */
/** The image point under that fraction, for a given camera. */
export function imageAtFraction(size: Size, box: Size | null, fraction: Fraction, view: Camera): Point {
  const { width, height } = viewSize(size, box, view.zoom);
  return { x: view.center.x - width / 2 + fraction.x * width, y: view.center.y - height / 2 + fraction.y * height };
}
/** The camera that holds `anchor` (image space) at that fraction of the box, at `zoom`. */
export function anchoredCamera(size: Size, box: Size | null, anchor: Point, fraction: Fraction, zoom: number): Camera {
  const { width, height } = viewSize(size, box, zoom);
  return { zoom, center: { x: anchor.x + width * (0.5 - fraction.x), y: anchor.y + height * (0.5 - fraction.y) } };
}

/** The zoom at which a one-cell token is drawn `tokenPx` screen pixels, or the fit when that already does it. */
export function readableZoom(size: Size, box: Size | null, cellSizePx: number | null, tokenPx: number): number {
  const fit = fitZoom(size, box);
  if (fit <= 0) return 0;
  if (!cellSizePx || cellSizePx <= 0) return fit;
  return clampZoom(Math.max(fit, tokenPx / cellSizePx), size, box);
}

/**
 * The camera that shows every point with `pad` image pixels round it. It stays put when they are all in view and
 * pans when they fit at this zoom. Otherwise it zooms out only as far as they need.
 */
export function framingCamera(
  size: Size,
  box: Size | null,
  current: Camera,
  points: readonly Point[],
  pad: number,
  minZoom: number
): Camera {
  if (points.length === 0 || !box) return current;
  const xs = points.map((point) => point.x),
    ys = points.map((point) => point.y);
  const left = Math.min(...xs) - pad,
    right = Math.max(...xs) + pad,
    top = Math.min(...ys) - pad,
    bottom = Math.max(...ys) + pad;
  const zoom = Math.max(current.zoom, minZoom);
  const shown = viewSize(size, box, zoom);
  if (right - left <= shown.width && bottom - top <= shown.height) {
    // Pan only as far as the points need, from where the camera is now.
    const half = { x: shown.width / 2, y: shown.height / 2 };
    const x = Math.min(Math.max(current.center.x, right - half.x), left + half.x);
    const y = Math.min(Math.max(current.center.y, bottom - half.y), top + half.y);
    return x === current.center.x && y === current.center.y && zoom === current.zoom
      ? current
      : { zoom, center: { x, y } };
  }
  const needed = Math.min(box.width / (right - left), box.height / (bottom - top));
  return { zoom: clampZoom(needed, size, box), center: { x: (left + right) / 2, y: (top + bottom) / 2 } };
}

/**
 * Keeps an automatic move's view on the map: across an axis the map fills it, it stays inside, and an axis the
 * map can't fill is centred. A person's own pan and zoom are never clamped.
 */
export function onTheMap(size: Size, box: Size | null, camera: Camera): Camera {
  const shown = viewSize(size, box, camera.zoom);
  const axis = (centre: number, view: number, map: number) =>
    view >= map ? map / 2 : Math.min(Math.max(centre, view / 2), map - view / 2);
  return {
    zoom: camera.zoom,
    center: { x: axis(camera.center.x, shown.width, size.width), y: axis(camera.center.y, shown.height, size.height) }
  };
}

/** The map stage's view: the camera (pan and zoom, with wheel-to-zoom on the stage) and fullscreen. */
export function useMapView({
  size,
  cellSizePx,
  svgRef,
  stageRef
}: Readonly<{
  size: Size | null;
  /** The calibrated grid's cell, which sets how close the map opens. */
  cellSizePx: number | null;
  svgRef: RefObject<SVGSVGElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
}>) {
  const [camera, setCamera] = useState<Camera>({ center: { x: 0, y: 0 }, zoom: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  // The stage's inner box in CSS pixels, which the viewBox takes the shape of.
  const [box, setBox] = useState<Size | null>(null);
  const hasSize = size !== null;
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const width = stage.clientWidth,
        height = stage.clientHeight;
      setBox((current) =>
        width > 0 && height > 0 && (current?.width !== width || current.height !== height) ? { width, height } : current
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stageRef, hasSize]);
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [stageRef]);

  const tokenPx =
    typeof window !== "undefined" && window.matchMedia?.(PHONE_QUERY).matches
      ? READABLE_TOKEN_PX.phone
      : READABLE_TOKEN_PX.laptop;
  const readable = size ? readableZoom(size, box, cellSizePx, tokenPx) : 0;

  /** Where a client point sits in the SVG's own box. */
  const boxFraction = (clientX: number, clientY: number): Fraction | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
  };
  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const fraction = boxFraction(clientX, clientY);
    if (!fraction || !size) return;
    setCamera((current) =>
      current.zoom > 0
        ? anchoredCamera(
            size,
            box,
            imageAtFraction(size, box, fraction, current),
            fraction,
            clampZoom(current.zoom * factor, size, box)
          )
        : current
    );
  };
  // Wheel-to-zoom needs preventDefault, which React's passive synthetic onWheel cannot guarantee.
  const onWheel = useEffectEvent((event: WheelEvent) => {
    if (!svgRef.current || !size) return;
    // Wheeling over a control in the stage scrolls that control. The pointer-down guard does the same.
    if (event.target instanceof Element && event.target.closest(MAP_OVERLAYS)) return;
    event.preventDefault();
    zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.15 : 1 / 1.15);
  });
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const listener = (event: WheelEvent) => onWheel(event);
    stage.addEventListener("wheel", listener, { passive: false });
    return () => stage.removeEventListener("wheel", listener);
  }, [stageRef]);

  /** The whole map in the box: View's Fit map. */
  const fitMap = () => {
    if (!size) return;
    setCamera({ center: { x: size.width / 2, y: size.height / 2 }, zoom: fitZoom(size, box) });
  };
  /** The camera a map opens with: close enough to read the tokens, on that point or the map's middle. */
  const open = (point: Point | null) => {
    if (!size) return;
    setCamera(onTheMap(size, box, { center: point ?? { x: size.width / 2, y: size.height / 2 }, zoom: readable }));
  };
  /** Brings a point to the middle of the view, at least close enough to read the tokens. */
  const centreOn = (point: Point) => {
    if (!size) return;
    setCamera((current) => onTheMap(size, box, { center: point, zoom: Math.max(current.zoom, readable) }));
  };
  /** Brings every point into view with `pad` round each, moving as little as it can. */
  const frame = (points: readonly Point[], pad: number) => {
    if (!size) return;
    setCamera((current) => {
      const next = framingCamera(size, box, current, points, pad, readable);
      return next === current ? current : onTheMap(size, box, next);
    });
  };
  const zoomCenter = (factor: number) => {
    const svg = svgRef.current;
    if (!svg || !size) return;
    const rect = svg.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  };
  const toggleFullscreen = () => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };
  const shown = size && camera.zoom > 0 ? viewSize(size, box, camera.zoom) : null;
  const viewBox = !size
    ? "0 0 1 1"
    : shown
      ? `${camera.center.x - shown.width / 2} ${camera.center.y - shown.height / 2} ${shown.width} ${shown.height}`
      : `0 0 ${size.width} ${size.height}`;

  return {
    camera,
    setCamera,
    viewBox,
    box,
    /** True once the map and the box it is drawn in are both measured. */
    ready: size !== null && box !== null,
    readable,
    boxFraction,
    zoomCenter,
    fitMap,
    open,
    centreOn,
    frame,
    fullscreen,
    toggleFullscreen
  };
}

export type MapView = ReturnType<typeof useMapView>;
