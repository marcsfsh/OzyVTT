import { useSyncExternalStore } from "react";

/**
 * Device-local settings: preferences about this browser. The table's own settings live elsewhere. Only preferences with
 * no server home live here (theme and the dice-input preference have their own stores; how the table
 * plays is server state). `autoArrange`: whether a newly created scene opens for arranging. `pinchZoom`: whether two
 * fingers may zoom the whole page on a touch screen, which the zoom guard (`lib/zoom-guard.ts`) reads. `waitingList`:
 * where what waits on the GM shows on the Table, over the turn or in its own tab (ADR-0058).
 */

const AUTO_ARRANGE_KEY = "vtt.auto-arrange";
const PINCH_ZOOM_KEY = "vtt.pinch-zoom";
const WAITING_LIST_KEY = "vtt.waiting-list";

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
let pinchZoom: boolean = read(PINCH_ZOOM_KEY) === "on";
/** Where the waiting list shows: at the top of Encounter ("turn", the default) or in its own first tab. */
export type WaitingListPlace = "turn" | "tab";
let waitingList: WaitingListPlace = read(WAITING_LIST_KEY) === "tab" ? "tab" : "turn";
const listeners = new Set<() => void>();

/** Calls `listener` after any preference here changes; returns the unsubscribe. */
export function subscribePreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const notify = () => {
  for (const listener of [...listeners]) listener();
};

export function setAutoArrange(next: boolean): void {
  if (next === autoArrange) return;
  autoArrange = next;
  write(AUTO_ARRANGE_KEY, next ? "on" : "off");
  notify();
}

/** Reactive read, so the shell and the Settings switch always agree. */
export function useAutoArrange(): boolean {
  return useSyncExternalStore(
    subscribePreferences,
    () => autoArrange,
    () => autoArrange
  );
}

/** Off by default: a stray pinch or double tap on a phone leaves the page at its own size. */
export function pinchZoomAllowed(): boolean {
  return pinchZoom;
}

export function setPinchZoom(next: boolean): void {
  if (next === pinchZoom) return;
  pinchZoom = next;
  write(PINCH_ZOOM_KEY, next ? "on" : "off");
  notify();
}

export function usePinchZoom(): boolean {
  return useSyncExternalStore(subscribePreferences, pinchZoomAllowed, pinchZoomAllowed);
}

export function setWaitingList(next: WaitingListPlace): void {
  if (next === waitingList) return;
  waitingList = next;
  write(WAITING_LIST_KEY, next);
  notify();
}

/** Reactive read, so the panel, the list's switch and the Settings row always agree. */
export function useWaitingList(): WaitingListPlace {
  return useSyncExternalStore(
    subscribePreferences,
    () => waitingList,
    () => waitingList
  );
}
