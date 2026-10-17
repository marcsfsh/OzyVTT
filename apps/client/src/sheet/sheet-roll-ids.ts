import { useSyncExternalStore } from "react";

/**
 * The rolls this page's sheets made this session, by the ids their commands returned. The latest-roll line shows only
 * these, so a roll the GM or the builder made for the character (its Hit Point rolls) never opens it.
 */
const ids = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

export function noteSheetRolls(...rollIds: ReadonlyArray<string | null | undefined>) {
  let added = false;
  for (const id of rollIds)
    if (id && !ids.has(id)) {
      ids.add(id);
      added = true;
    }
  if (!added) return;
  version += 1;
  for (const listener of listeners) listener();
}

/** Forgets the rolls noted so far, as a page load does; tests share one module between cases. */
export function forgetSheetRolls() {
  ids.clear();
  version += 1;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The noted roll ids, re-read whenever one is added. */
export function useSheetRollIds(): ReadonlySet<string> {
  useSyncExternalStore(subscribe, () => version);
  return ids;
}
