import { useEffect, useEffectEvent, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { DockPosition } from "../encounter/DockPicker";

export type Point = Readonly<{ x: number; y: number }>;
export type Camera = Readonly<{ center: Point; zoom: number }>;
type Size = Readonly<{ width: number; height: number }>;
/** A point in the SVG's own box, as a 0..1 fraction on each axis. */
type Fraction = Readonly<{ x: number; y: number }>;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 6;

/** Panels laid over the stage. A press or a wheel over one belongs to the panel, never to the map. */
export const MAP_OVERLAYS =
  ".encounter-map-overlay, .encounter-map-zoom, .encounter-shape-editor, .encounter-map-dock, .encounter-map-dock-resize";

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

/**
 * The map stage's view: the camera (pan and zoom, with wheel-to-zoom on the stage), enlarge and
 * fullscreen, and dragging the docked tracker's inner edge to resize it.
 */
export function useMapView({
  assetId,
  size,
  svgRef,
  stageRef,
  dock
}: Readonly<{
  assetId: string;
  size: Size | null;
  svgRef: RefObject<SVGSVGElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
  dock?: Readonly<{ position: DockPosition; width: number; onWidthChange: (width: number) => void }>;
}>) {
  const [camera, setCamera] = useState<Camera>({ center: { x: 0, y: 0 }, zoom: 1 });
  const [enlarged, setEnlarged] = useState(false);
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
    // Wheeling over an overlaid panel (docked tracker, open menu, shape editor) scrolls that panel
    // instead of zooming the map, mirroring the pointer-down guard.
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
    // Frame the whole map in the area the dock leaves visible: the dock's inner edge becomes the canvas
    // edge. `baseScale` is the zoom-1 meet-scale read from the SVG's actual box, so letterboxing and the
    // stage's max-height are accounted for.
    const svgRect = svgRef.current?.getBoundingClientRect();
    const dockRect = stageRef.current?.querySelector<HTMLElement>(".encounter-map-dock")?.getBoundingClientRect();
    let center = { x: size.width / 2, y: size.height / 2 };
    let zoom = 1;
    if (svgRect && dockRect && svgRect.width > 0 && svgRect.height > 0) {
      const baseScale = Math.min(svgRect.width / size.width, svgRect.height / size.height);
      let visibleW = svgRect.width;
      let offsetX = 0;
      const visibleH = svgRect.height;
      const offsetY = 0;
      if (dock?.position === "right") {
        visibleW -= dockRect.width;
        offsetX = -dockRect.width / 2;
      } else if (dock?.position === "left") {
        visibleW -= dockRect.width;
        offsetX = dockRect.width / 2;
      }
      if (visibleW > 0 && visibleH > 0 && baseScale > 0) {
        const fit = Math.min(visibleW / (size.width * baseScale), visibleH / (size.height * baseScale));
        zoom = Math.max(MIN_ZOOM, Math.min(1, fit));
        const scale = baseScale * zoom;
        center = { x: size.width / 2 - offsetX / scale, y: size.height / 2 - offsetY / scale };
      }
    }
    setCamera({ center, zoom });
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
    else {
      setEnlarged(false);
      void el.requestFullscreen?.();
    }
  };
  const toggleEnlarged = () =>
    setEnlarged((current) => {
      if (!current && fullscreen) void document.exitFullscreen?.();
      return !current;
    });
  // Drag the docked panel's inner-edge strip to resize it. Window listeners keep the drag alive off the
  // strip; width is clamped to [16rem, 60% of the stage] and persisted by the parent.
  const beginDockResize = (event: ReactPointerEvent) => {
    if (!dock) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = dock.width;
    const stageWidth = stageRef.current?.getBoundingClientRect().width ?? 1000;
    const maxWidth = stageWidth * 0.6;
    const minWidth = 16 * 16; // 16rem
    const onMove = (move: PointerEvent) => {
      const delta = dock.position === "left" ? move.clientX - startX : startX - move.clientX;
      dock.onWidthChange(Math.max(minWidth, Math.min(maxWidth, startWidth + delta)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
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
    enlarged,
    toggleEnlarged,
    fullscreen,
    toggleFullscreen,
    beginDockResize
  };
}

export type MapView = ReturnType<typeof useMapView>;
