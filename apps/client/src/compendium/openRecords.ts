import { useSyncExternalStore } from "react";

/**
 * The records open as tabs over Browse's record pane (compendium spec 2.3, ADR-0055), in the order they opened: each a
 * `kind:id` key. They last while the browser tab is open (sessionStorage), at most eight, with the last one shown (for
 * the table's "N records open") and the panes the GM folded.
 */
export type OpenRecords = Readonly<{
  keys: readonly string[];
  last: string | null;
  folds: Readonly<{ filters: boolean | null; results: boolean }>;
}>;

export const MOST_OPEN = 8;
const KEY = "vtt.compendium.open-records";
const EMPTY: OpenRecords = { keys: [], last: null, folds: { filters: null, results: false } };

/** Opens `key` (shown now): it joins the end, and past eight the oldest one not shown goes. */
export function withOpened(state: OpenRecords, key: string): OpenRecords {
  const keys = state.keys.includes(key) ? [...state.keys] : [...state.keys, key];
  while (keys.length > MOST_OPEN)
    keys.splice(
      keys.findIndex((entry) => entry !== key),
      1
    );
  return { ...state, keys, last: key };
}

/** Closes `key`: the tab beside it is shown next (the one after, else the one before), or none when it was the last. */
export function withClosed(state: OpenRecords, key: string): Readonly<{ state: OpenRecords; next: string | null }> {
  const at = state.keys.indexOf(key);
  if (at === -1) return { state, next: null };
  const keys = state.keys.filter((entry) => entry !== key);
  const next = keys[at] ?? keys[at - 1] ?? null;
  return { state: { ...state, keys, last: state.last === key ? next : state.last }, next };
}

function read(): OpenRecords {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<OpenRecords>;
    return {
      keys: Array.isArray(parsed.keys)
        ? parsed.keys.filter((entry) => typeof entry === "string").slice(-MOST_OPEN)
        : [],
      last: typeof parsed.last === "string" ? parsed.last : null,
      folds: {
        filters: typeof parsed.folds?.filters === "boolean" ? parsed.folds.filters : null,
        results: parsed.folds?.results === true
      }
    };
  } catch {
    return EMPTY;
  }
}

let current: OpenRecords = read();
const listeners = new Set<() => void>();

function set(next: OpenRecords) {
  current = next;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* a blocked store keeps the list for this page only */
  }
  for (const listener of [...listeners]) listener();
}

export const openRecord = (key: string) => {
  if (current.last === key && current.keys.includes(key)) return;
  set(withOpened(current, key));
};
/** Closes a tab and says which to show next. */
export const closeRecord = (key: string): string | null => {
  const { state, next } = withClosed(current, key);
  set(state);
  return next;
};
/** A record whose read failed (deleted or archived elsewhere) leaves the list. */
export const forgetRecord = (key: string) => {
  if (current.keys.includes(key)) set(withClosed(current, key).state);
};
export const setFold = (pane: "filters" | "results", folded: boolean) =>
  set({ ...current, folds: { ...current.folds, [pane]: folded } });

/** For tests: starts from no open records. */
export function resetOpenRecords() {
  set(EMPTY);
}

export function useOpenRecords(): OpenRecords {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
    () => current
  );
}

/** A key's kind and id. */
export function parseKey(key: string): Readonly<{ kind: string; id: string }> {
  const at = key.indexOf(":");
  return { kind: key.slice(0, at), id: key.slice(at + 1) };
}
