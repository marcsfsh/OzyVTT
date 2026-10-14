/**
 * Refreshes content caches when homebrew changes. `homebrew:changed` is a content-free ping, so each
 * warm cache refetches its own audience-filtered view, keeping the old list until the new one lands.
 * `connect` also refreshes, since a reconnect can change the audience.
 */

import { socket } from "../socket";

type Refresher = () => void;

const refreshers = new Set<Refresher>();
let installed = false;
let lastRevision: number | null = null;

function refreshAll() {
  for (const refresh of refreshers) refresh();
}

function install() {
  if (installed) return;
  installed = true;
  socket.on("homebrew:changed", (event) => {
    // The revision is monotonic, so a duplicate ping (two tabs, a retry) does not cause a second sweep.
    const revision = typeof event?.revision === "number" ? event.revision : null;
    if (revision !== null && revision === lastRevision) return;
    lastRevision = revision;
    refreshAll();
  });
  socket.on("connect", refreshAll);
}

/** Registers a cache's refresh callback; call it at module scope beside the cache. */
export function registerContentCache(refresh: Refresher): void {
  refreshers.add(refresh);
  install();
}
