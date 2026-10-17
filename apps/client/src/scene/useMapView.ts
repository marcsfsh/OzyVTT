import { useEffect, useEffectEvent, useState, type RefObject } from "react";

export type Point = Readonly<{ x: number; y: number }>;
export type Camera = Readonly<{ center: Point; zoom: number }>;
type Size = Readonly<{ width: number; height: number }>;
/** A point in the SVG's own box, as a 0..1 fraction on each axis. */
type Fraction = Readonly<{ x: number; y: number }>;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 6;

/** Controls inside the stage's box. A press or a wheel over one belongs to the control, never to the map. */
export const MAP_OVERLAYS = ".encounter-shape-editor, .map-rail-wrap";

/* Zoom-to-a-point in three pieces shared by wheel and pinch, so they cannot drift. The pinch reads
   its anchor from the camera it started in. */
export const clampZoom = (zoom: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
/** The image point under that fraction, for a given camera. */
export function imageAtFraction(size: Size, fraction: Fraction, view: Camera): Point {
  const width = size.width / view.zoom,
    height = size.height / view.zoom;
  return { x: view.center.x - width / 2 + fraction.x * width, y: view.center.y - height / 2 + fraction.y * height };
}
/** The camera that holds `anchor` (image space) at that fraction of the box, at `zoom`. */
export function anchoredCamera(size: Size, anchor: Point, fraction: Fraction, zoom: number): Camera {
  const width = size.width / zoom,
    height = size.height / zoom;
  return { zoom, center: { x: anchor.x + width * (0.5 - fraction.x), y: anchor.y + height * (0.5 - fraction.y) } };
}

/** The map stage's view: the camera (pan and zoom, with wheel-to-zoom on the stage) and fullscreen. */
export function useMapView({
  assetId,
  size,
  svgRef,
  stageRef
}: Readonly<{
  assetId: string;
  size: Size | null;
  svgRef: RefObject<SVGSVGElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
}>) {
  const [camera, setCamera] = useState<Camera>({ center: { x: 0, y: 0 }, zoom: 1 });
  const [fullscreen, setFullscreen] = useState(false);
  const width = size?.width;
  const height = size?.height;
  useEffect(() => {
    if (width !== undefined && height !== undefined) setCamera({ center: { x: width / 2, y: height / 2 }, zoom: 1 });
  }, [assetId, width, height]);
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [stageRef]);

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
      anchoredCamera(size, imageAtFraction(size, fraction, current), fraction, clampZoom(current.zoom * factor))
    );
  };
  // Wheel-to-zoom needs preventDefault, which React's passive synthetic onWheel cannot guarantee.
  const onWheel = useEffectEvent((event: WheelEvent) => {
    if (!svgRef.current || !size) return;
    // Wheeling over a control in the stage scrolls that control, mirroring the pointer-down guard.
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

  const resetView = () => {
    if (!size) return;
    setCamera({ center: { x: size.width / 2, y: size.height / 2 }, zoom: 1 });
  };
  /** Brings a point to the middle of the view, closer in when the whole map is showing. */
  const centreOn = (point: Point) => setCamera((current) => ({ center: point, zoom: Math.max(current.zoom, 1.5) }));
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
  const viewBox = size
    ? `${camera.center.x - size.width / camera.zoom / 2} ${camera.center.y - size.height / camera.zoom / 2} ${size.width / camera.zoom} ${size.height / camera.zoom}`
    : "0 0 1 1";

  return {
    camera,
    setCamera,
    viewBox,
    boxFraction,
    zoomCenter,
    resetView,
    centreOn,
    fullscreen,
    toggleFullscreen
  };
}

export type MapView = ReturnType<typeof useMapView>;
