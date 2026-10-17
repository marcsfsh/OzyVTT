import { useEffect, useEffectEvent, useSyncExternalStore } from "react";
import type { GridCalibration } from "./gridPreview";

/**
 * The live map's grid and size, published by the map once it has read them, so the panel and the header beside the
 * map can measure the same distances (a target's range) and present the same map on the TV without a second read or
 * the map's own props.
 */
type Geometry = Readonly<{
  assetId: string;
  calibration: GridCalibration | null;
  size: Readonly<{ width: number; height: number }> | null;
}>;
let current: Geometry | null = null;
const listeners = new Set<() => void>();

export function publishTableGeometry(
  assetId: string,
  calibration: GridCalibration | null,
  size: Readonly<{ width: number; height: number }> | null = null
) {
  if (
    current?.assetId === assetId &&
    current.calibration === calibration &&
    current.size?.width === size?.width &&
    current.size?.height === size?.height
  )
    return;
  current = { assetId, calibration, size };
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

function useGeometry() {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => current
  );
}

/** The grid of the map now on the table, or null before it has loaded or on a map without one. */
export function useTableCalibration(assetId: string | null): GridCalibration | null {
  const geometry = useGeometry();
  return geometry && geometry.assetId === assetId ? geometry.calibration : null;
}

/** The pixel size of the map now on the table, or null before it has loaded. */
export function useTableMapSize(assetId: string | null): Readonly<{ width: number; height: number }> | null {
  const geometry = useGeometry();
  return geometry && geometry.assetId === assetId ? geometry.size : null;
}

/* A request to bring a creature's token into view, from a control outside the map (the header's Me). */
const focusListeners = new Set<(actorId: string) => void>();

export function focusTokenOnMap(actorId: string) {
  for (const listener of focusListeners) listener(actorId);
}

/** Runs `onFocus` whenever something asks the map to bring a token into view. */
export function useTokenFocusRequests(onFocus: (actorId: string) => void) {
  const handle = useEffectEvent(onFocus);
  useEffect(() => {
    const listener = (actorId: string) => handle(actorId);
    focusListeners.add(listener);
    return () => {
      focusListeners.delete(listener);
    };
  }, []);
}
