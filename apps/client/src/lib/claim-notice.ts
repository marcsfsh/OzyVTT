import { useSyncExternalStore } from "react";
import type { ClaimReleasedEvent } from "@vtt/domain";

/**
 * The last character the GM released from this player, kept until they claim again, so the picker can say why it
 * is back. The server sends `claim:released` once, possibly before the picker mounts, so it is held here.
 */
let released: ClaimReleasedEvent | null = null;
const listeners = new Set<() => void>();

export function noteClaimReleased(event: ClaimReleasedEvent | null) {
  released = event;
  for (const listener of listeners) listener();
}

export function useClaimReleased(): ClaimReleasedEvent | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => released
  );
}
