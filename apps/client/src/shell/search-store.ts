import { useSyncExternalStore } from "react";

/** Where search looks (frame spec 2.3). */
export type SearchPlace = "codex" | "compendium" | "rules" | "goto";

type Request = Readonly<{ open: boolean; place: SearchPlace | null; at: number; opener: HTMLElement | null }>;
let request: Request = { open: false, place: null, at: 0, opener: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Opens the one search, at a place or (null) at the place the page starts it on. */
export function openSearch(place: SearchPlace | null = null) {
  // What had focus when search was asked for, so closing can give it back.
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  request = { open: true, place, at: Date.now(), opener };
  emit();
}

export function closeSearch() {
  request = { ...request, open: false };
  emit();
}

/** The request as it stands, for a key handler that must not re-bind on every change. */
export function requestNow(): Request {
  return request;
}

export function useSearchRequest(): Request {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => request
  );
}
