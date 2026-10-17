import { useSyncExternalStore } from "react";

/**
 * Device-local settings: preferences about this browser. The table's own settings live elsewhere. Only preferences with
 * no server home live here (theme and the dice-input preference have their own stores; how the table
 * plays is server state). `autoArrange`: whether a newly created scene opens for arranging.
 */

const AUTO_ARRANGE_KEY = "vtt.auto-arrange";

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: the choice stays in-session */
  }
};

let autoArrange: boolean = read(AUTO_ARRANGE_KEY) !== "off";
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function setAutoArrange(next: boolean): void {
  if (next === autoArrange) return;
  autoArrange = next;
  write(AUTO_ARRANGE_KEY, next ? "on" : "off");
  for (const listener of [...listeners]) listener();
}

/** Reactive read, so the shell and the Settings switch always agree. */
export function useAutoArrange(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => autoArrange,
    () => autoArrange
  );
}
