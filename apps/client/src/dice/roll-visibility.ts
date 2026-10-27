import { useSyncExternalStore } from "react";
import type { RollVisibility } from "@vtt/domain";

// Who sees the next roll from this page, shared by the log's composer and the dice options: one choice, so a quick die
// goes to the same audience the options name. It starts Shown to players on each load.
let visibility: RollVisibility = "public";
const listeners = new Set<() => void>();

export function setRollVisibility(next: RollVisibility) {
  if (next === visibility) return;
  visibility = next;
  for (const listener of listeners) listener();
}

export function useRollVisibility(): RollVisibility {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => visibility
  );
}
