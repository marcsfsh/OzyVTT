import { useEffect, useState } from "react";

export type MapImageState =
  | { status: "loading" }
  | { status: "ready"; url: string; width: number; height: number }
  | { status: "error"; message: string };

export function probeImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const probe = new Image();
    probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
    probe.onerror = () => reject(new Error("The map image couldn't be displayed."));
    probe.src = url;
  });
}

/**
 * Fetches an authorized map image as a revocable blob URL and probes its natural pixel dimensions,
 * for renderers with a bearer token (the encounter canvas, the GM's map/viewer previews). The
 * shared-screen viewer embeds the content URL directly (cookie auth; an SVG `<image>` cannot send a
 * bearer header) but still uses `probeImageDimensions`.
 */
export function useAuthorizedMapImage(assetId: string | null, token: string | null | undefined): MapImageState {
  const [state, setState] = useState<MapImageState>({ status: "loading" });

  useEffect(() => {
    if (!assetId) {
      setState({ status: "loading" });
      return;
    }
    if (!token) {
      setState({ status: "error", message: "Rejoin the table to load the battle map." });
      return;
    }
    setState({ status: "loading" });
    const controller = new AbortController();
    let objectUrl: string | null = null;
    fetch(`/api/v1/map-assets/${encodeURIComponent(assetId)}/content`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 403 ? "You don't have access to this map." : "The battle map couldn't be loaded."
          );
        objectUrl = URL.createObjectURL(await response.blob());
        const dimensions = await probeImageDimensions(objectUrl);
        setState({ status: "ready", url: objectUrl, ...dimensions });
      })
      .catch((error) => {
        if (error.name !== "AbortError") setState({ status: "error", message: error.message });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId, token]);

  return state;
}

/**
 * Session-lifetime thumbnail cache: one authorized fetch per map asset, shared by every chip showing
 * that map. Object URLs are never revoked (bounded by the scene library). Unlike
 * `useAuthorizedMapImage`, so chips re-rendering on every broadcast do not refetch or churn URLs.
 */
const thumbnailCache = new Map<string, Promise<string>>();
export function useCachedMapThumbnail(assetId: string | null, token: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!assetId || !token) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    let promise = thumbnailCache.get(assetId);
    if (!promise) {
      promise = fetch(`/api/v1/map-assets/${encodeURIComponent(assetId)}/content`, {
        headers: { authorization: `Bearer ${token}` }
      }).then(async (response) => {
        if (!response.ok) throw new Error("thumbnail unavailable");
        return URL.createObjectURL(await response.blob());
      });
      thumbnailCache.set(assetId, promise);
      // A failed fetch must not poison the cache; the next mount retries.
      promise.catch(() => thumbnailCache.delete(assetId));
    }
    promise
      .then((objectUrl) => {
        if (!cancelled) setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [assetId, token]);
  return url;
}

/**
 * Converts a pointer event's client coordinates into image-pixel coordinates using the SVG's own
 * screen transform, so it stays correct under `preserveAspectRatio` letterboxing, panning and zoom.
 */
export function imagePointFromClient(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number
): { x: number; y: number } | null {
  const matrix = svg.getScreenCTM();
  if (!matrix) return null;
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const mapped = point.matrixTransform(matrix.inverse());
  return { x: Math.round(mapped.x * 100) / 100, y: Math.round(mapped.y * 100) / 100 };
}

export function clampPoint(point: { x: number; y: number }, width: number, height: number) {
  return { x: Math.max(0, Math.min(width, point.x)), y: Math.max(0, Math.min(height, point.y)) };
}

export type OverlayLine = Readonly<{
  axis: "column" | "row";
  index: number;
  start: { x: number; y: number };
  end: { x: number; y: number };
  major: boolean;
}>;

/** Renders calibration/grid overlay line segments; one implementation for all overlays. */
export function GridOverlay({ lines }: Readonly<{ lines: readonly OverlayLine[] }>) {
  return (
    <>
      {lines.map((line) => (
        <line
          key={`${line.axis}-${line.index}`}
          className={line.major ? "major" : ""}
          x1={line.start.x}
          y1={line.start.y}
          x2={line.end.x}
          y2={line.end.y}
        />
      ))}
    </>
  );
}
