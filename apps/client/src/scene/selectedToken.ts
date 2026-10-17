import { useSyncExternalStore } from "react";

/**
 * The token the GM last pressed on the live map, which the Token tab beside the map shows. A module store, so the map
 * and the panel agree without passing it through the table.
 */
let selected: string | null = null;
const listeners = new Set<() => void>();

export function selectToken(actorId: string | null) {
  if (selected === actorId) return;
  selected = actorId;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useSelectedToken(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => selected,
    () => selected
  );
}
