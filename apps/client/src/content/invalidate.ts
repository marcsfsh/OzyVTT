/**
 * Content caches are no longer immutable — homebrew makes them editable at runtime.
 *
 * Every catalog on this client is read once per session and held in a module-level
 * cache (`catalogs.ts`, `encounter/spells.tsx`, `encounter/equipment.tsx`,
 * `homebrew/sources.ts`, plus two per-definition `Map`s). That was correct while the
 * only content was a bundle baked into the server: `if (cache) return;` was a
 * one-fetch-per-session optimisation with no downside.
 *
 * With homebrew it is a bug. A GM publishes a class and the character builder keeps
 * offering the list it read at page load; the only fix a GM would find is a hard reload,
 * which is exactly the kind of "did it save?" doubt the whole draft/publish machine
 * exists to remove.
 *
 * `homebrew:changed` is the server's own content-free ping — a revision and nothing
 * else, so it can never leak an unpublished record to anyone. Each recipient refetches
 * its own audience-filtered view.
 *
 * Two properties this file is careful about:
 *
 * 1. **A cold cache is never warmed by an invalidation.** A refresher does nothing when
 *    nothing is cached — the next mount would fetch anyway, and refetching for nobody
 *    would put a socket round-trip on every publish for every idle client.
 * 2. **The previous list stays visible until the replacement lands.** Clearing first and
 *    notifying would flash an empty picker mid-edit. The swap is atomic on success, and
 *    a failed refetch leaves the last good list in place.
 *
 * `connect` is subscribed for the same reason: a reconnect follows a GM login, which
 * changes the audience the catalogs were filtered for, so the cached lists belong to
 * somebody else.
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
    // The revision is a monotonic counter, so a duplicate ping (two tabs, a retry) does
    // not cause a second sweep.
    const revision = typeof event?.revision === "number" ? event.revision : null;
    if (revision !== null && revision === lastRevision) return;
    lastRevision = revision;
    refreshAll();
  });
  socket.on("connect", refreshAll);
}

/**
 * Registers a cache's own "reread yourself" callback. Call it at module scope beside the
 * cache it refreshes — the caches outlive every component that reads them, so there is
 * no component whose effect could own this.
 */
export function registerContentCache(refresh: Refresher): void {
  refreshers.add(refresh);
  install();
}
