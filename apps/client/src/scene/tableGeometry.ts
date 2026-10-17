import { useSyncExternalStore } from "react";
import type { GridCalibration } from "./gridPreview";

/**
 * The live map's grid, published by the map once it has read it, so the panel beside the map can measure the same
 * distances (a target's range) without a second read or the map's own props.
 */
let current: Readonly<{ assetId: string; calibration: GridCalibration | null }> | null = null;
const listeners = new Set<() => void>();

export function publishTableGeometry(assetId: string, calibration: GridCalibration | null) {
  if (current?.assetId === assetId && current.calibration === calibration) return;
  current = { assetId, calibration };
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The grid of the map now on the table, or null before it has loaded or on a map without one. */
export function useTableCalibration(assetId: string | null): GridCalibration | null {
  const geometry = useSyncExternalStore(
    subscribe,
    () => current,
    () => current
  );
  return geometry && geometry.assetId === assetId ? geometry.calibration : null;
}
