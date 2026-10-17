import type { GameState } from "@vtt/domain";
import type { GameStore } from "./game-store.js";

/** The committed game state for reads, cloned once per revision. `GameStore.snapshot` clones the whole
 *  campaign on every call, and one command or broadcast reads it many times. The copy is frozen, so a read
 *  that mutates it throws, so what the next reader sees stays intact. */
export function createStateReader(store: Pick<GameStore, "snapshot" | "revision">) {
  let cached: GameState | undefined;
  return {
    read(): GameState {
      if (cached === undefined || cached.revision !== store.revision) cached = deepFreeze(store.snapshot);
      return cached;
    },
    /** Forgets the copy after a change that kept the revision (the store's startup seeds). */
    reset() {
      cached = undefined;
    }
  };
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
