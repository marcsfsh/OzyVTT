import { useEffect, useState } from "react";
import { CONTENT_PATHS } from "@vtt/api-contract";
import type { ContentCompendium, ContentCompendiumKind } from "@vtt/domain";
import { registerContentCache } from "../../content/invalidate";
import { apiRequest } from "../../lib/api";

/**
 * One kind of the Compendium as its reader gets it, from the reader's own route: a player's token reads the SRD and
 * the homebrew shared with that player's characters, the GM's reads the GM's catalog. Read once per token and kind,
 * and again when the content-free ping says the reader's slice moved.
 */

type Held = { data: ContentCompendium | null; error: string | null; inFlight: Promise<void> | null };
const held = new Map<string, Held>();
const listeners = new Map<string, Set<() => void>>();
const keyOf = (token: string, kind: ContentCompendiumKind) => `${token}:${kind}`;

function read(token: string, kind: ContentCompendiumKind, force = false) {
  const key = keyOf(token, kind);
  const entry = held.get(key) ?? { data: null, error: null, inFlight: null };
  held.set(key, entry);
  if (entry.inFlight || (entry.data && !force)) return;
  entry.inFlight = apiRequest<ContentCompendium>(`${CONTENT_PATHS.compendium}?kind=${kind}`, {
    token,
    failure: "Couldn't read the Compendium."
  }).then(
    (data) => {
      entry.data = data;
      entry.error = null;
      entry.inFlight = null;
      for (const listener of listeners.get(key) ?? []) listener();
    },
    (error: unknown) => {
      entry.error = error instanceof Error ? error.message : "Couldn't read the Compendium.";
      entry.inFlight = null;
      for (const listener of listeners.get(key) ?? []) listener();
    }
  );
}

// A record shared or hidden mid-session reaches an open Compendium without a reload; the old rows stay until then.
registerContentCache(() => {
  for (const key of held.keys()) {
    const split = key.lastIndexOf(":");
    read(key.slice(0, split), key.slice(split + 1) as ContentCompendiumKind, true);
  }
});

export function useReaderCompendium(
  token: string,
  kind: ContentCompendiumKind | null
): Readonly<{ data: ContentCompendium | null; error: string | null; reload: () => void }> {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!kind) return;
    const key = keyOf(token, kind);
    const listener = () => setTick((tick) => tick + 1);
    const set = listeners.get(key) ?? new Set();
    set.add(listener);
    listeners.set(key, set);
    read(token, kind);
    return () => {
      set.delete(listener);
    };
  }, [token, kind]);
  const entry = kind ? held.get(keyOf(token, kind)) : undefined;
  return { data: entry?.data ?? null, error: entry?.error ?? null, reload: () => kind && read(token, kind, true) };
}

/** For tests: forget every read. */
export function resetReaderCompendium() {
  held.clear();
  listeners.clear();
}
