/**
 * D3 — real URLs for the whole app.
 *
 * A hand-rolled history layer rather than react-router, recorded as a Lane C design call. `apps/client`
 * had zero router dependencies; the app is four separate Vite HTML entries of which only `index.html`
 * needs addresses; the address space is small and fully enumerable; and react-router's data-router
 * idioms (loaders, actions) fight this app's socket-push + ping-and-refetch model. "Everything needed
 * and nothing unnecessary" (CLAUDE.md) makes this ~200 lines instead of a dependency.
 *
 * **The SPA fallback already ships** (`server.ts`: `express.static` then `sendFile("index.html")` for
 * every non-API GET in production, a path-preserving 307 to Vite in dev), so a cold deep link resolves.
 * `GET /viewer` is reserved by the server as a redirect to the standalone TV viewer, which is why the
 * GM's Viewer tab is addressed `/viewer-controls` — see `pathForGmTab`.
 */

import { useSyncExternalStore } from "react";

export type Route = Readonly<{
  /** The pathname, always leading-slash, never trailing-slash (except the bare root). */
  path: string;
  /** The pathname split on "/", empties dropped. `/codex/pages/abc` → `["codex","pages","abc"]`. */
  segments: readonly string[];
  query: URLSearchParams;
}>;

const listeners = new Set<() => void>();
let snapshot: Route = readLocation();

function readLocation(): Route {
  const raw = window.location.pathname || "/";
  const path = raw.length > 1 && raw.endsWith("/") ? raw.slice(0, -1) : raw;
  return { path, segments: path.split("/").filter(Boolean), query: new URLSearchParams(window.location.search) };
}

function publish(): void {
  snapshot = readLocation();
  for (const listener of [...listeners]) listener();
}

// ----- Navigation guards (D6: an editor with autosave OFF and unsaved changes) -----

type Guard = () => boolean | Promise<boolean>;
const guards = new Set<Guard>();

/**
 * Register a veto on leaving the current view. Returning `false` blocks the navigation.
 *
 * Used by `useCodexAutosave` when autosave is off and the draft is dirty; the same hook installs a
 * `beforeunload` handler for the tab-close case, which the browser owns and we cannot style. Returns
 * its own unregister function, so an effect cleanup is the whole teardown.
 */
export function registerNavigationGuard(guard: Guard): () => void {
  guards.add(guard);
  return () => { guards.delete(guard); };
}

async function mayLeave(): Promise<boolean> {
  for (const guard of [...guards]) {
    // Sequential, not `Promise.all`: each guard may prompt, and two prompts at once is a trap.
    if (!(await guard())) return false;
  }
  return true;
}

// ----- Transient history entries (the phone nav drawer, and only that) -----

/**
 * Push a same-path history entry whose only job is to be popped.
 *
 * The Android back gesture closing an open sidebar drawer — instead of leaving the section entirely —
 * is the single worst phone back-trap this app would otherwise have. Dialogs and modals deliberately
 * stay OUT of history (Esc and the scrim close them); if user testing later shows back-closes-dialog is
 * expected, this generalizes.
 */
const transients = new Map<string, () => void>();

export function pushTransient(key: string, onPop: () => void): void {
  transients.set(key, onPop);
  window.history.pushState({ transient: key }, "", window.location.href);
}

/** Withdraw a transient entry that was closed by its own affordance rather than by the back gesture. */
export function popTransient(key: string): void {
  if (!transients.has(key)) return;
  transients.delete(key);
  // `back()` pops the entry we pushed. The popstate handler below sees no registered key and re-routes,
  // which lands on the same path — a no-op render, which is exactly right.
  window.history.back();
}

/**
 * Forget a transient entry WITHOUT going back — for the case where the caller is about to navigate.
 *
 * `popTransient` cannot serve that case, and the bug it caused is worth recording. Choosing a
 * destination from the phone nav drawer ran `closeDrawer()` (→ `history.back()`) and then `navigate()`.
 * `back()` is queued as a task while `navigate`'s guard check resolves on a MICROTASK, so the order was
 * always: push the destination, then go back off it. **Every tap in the phone nav drawer navigated
 * nowhere** — the drawer closed, the address never moved, and on a laptop (no transient registered,
 * `popTransient` a no-op) it worked perfectly, which is why it survived to a browser pass.
 *
 * Returns whether an entry is now stranded, so the caller can `navigate(path, { replace: true })` and
 * overwrite it rather than leaving a duplicate the GM has to press back through twice.
 */
export function discardTransient(key: string): boolean {
  if (!transients.has(key)) return false;
  transients.delete(key);
  return true;
}

window.addEventListener("popstate", (event) => {
  const key = (event.state as { transient?: string } | null)?.transient;
  // Popping FORWARD onto a transient entry is not a thing we ever want to honour; only the disappearance
  // of the entry matters. So: if any transient is registered, the pop closes it and the route stands.
  if (transients.size > 0) {
    const [openKey, onPop] = [...transients.entries()][transients.size - 1];
    transients.delete(openKey);
    onPop();
    if (key === undefined) return;
  }
  publish();
});

/**
 * Go to an address. Guards run first; a vetoed navigation leaves the URL alone.
 *
 * Deliberately fire-and-forget at call sites (`onClick={() => navigate(path)}`) — the promise exists so
 * a guard may prompt, not so callers can await it.
 */
export function navigate(path: string, opts: Readonly<{ replace?: boolean }> = {}): void {
  if (path === currentHref()) return;
  void mayLeave().then((allowed) => {
    if (!allowed) return;
    if (opts.replace) window.history.replaceState(null, "", path);
    else window.history.pushState(null, "", path);
    publish();
  });
}

/** The current address including its query, in the form `navigate` takes. */
export function currentHref(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/**
 * Rewrite the query of the current address WITHOUT a history entry — how a view clears the
 * prepared-destination parameter it has just landed on (`?entry=`, `?pin=`, `?focus=`), mirroring the
 * old `onOpenedTarget` handshake exactly. Never use this for a real navigation.
 */
export function replaceQuery(mutate: (query: URLSearchParams) => void): void {
  const query = new URLSearchParams(window.location.search);
  mutate(query);
  const search = query.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
  publish();
}

/** Build an address with query parameters, dropping the empty ones so a URL never carries `?tag=`. */
export function withQuery(path: string, params: Readonly<Record<string, string | number | null | undefined>>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    query.set(key, String(value));
  }
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => snapshot,
    () => snapshot
  );
}

// ----- The app shell's address table (D3) -----

export type GmTab = "scenes" | "table" | "roster" | "codex" | "homebrew" | "viewer" | "replay" | "setup";

/**
 * One address per GM tab. **`/viewer-controls`, not `/viewer`** — the server reserves `GET /viewer` as a
 * 307 to the standalone TV viewer in both prod and dev, so the SPA can never receive that address; and
 * "viewer controls" is what the tab actually is (the controls for the shared screen).
 */
const GM_TAB_PATHS: Readonly<Record<GmTab, string>> = {
  table: "/encounter",
  scenes: "/scenes",
  roster: "/roster",
  codex: "/codex",
  homebrew: "/homebrew",
  viewer: "/viewer-controls",
  replay: "/replays",
  setup: "/setup"
};

export function pathForGmTab(tab: GmTab): string { return GM_TAB_PATHS[tab]; }

/** Which GM tab an address renders, or null when the address is not a GM tab at all. */
export function gmTabForPath(path: string): GmTab | null {
  const head = `/${path.split("/").filter(Boolean)[0] ?? ""}`;
  const found = (Object.entries(GM_TAB_PATHS) as ReadonlyArray<[GmTab, string]>).find(([, value]) => value === head);
  return found ? found[0] : null;
}

/** Addresses only the GM may reach. A player asking for one gets the not-found view (never a 403-alike). */
export function isGmOnlyPath(path: string): boolean {
  const segments = path.split("/").filter(Boolean);
  if (segments[0] === "codex") return ["audit", "backup", "settings"].includes(segments[1] ?? "");
  const tab = gmTabForPath(path);
  return tab !== null && tab !== "codex";
}

/** Every address the app answers, for the not-found decision. Anything else renders "nothing lives here". */
export function isKnownPath(path: string): boolean {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return true;
  if (segments[0] === "table") return segments.length === 1;
  if (segments[0] === "codex") {
    if (segments.length === 1) return true;
    const section = segments[1];
    const withRecord = ["pages", "atlas", "sessions", "quests"];
    const bare = ["journal", "calendar", "downtime", "graph", "audit", "backup", "settings"];
    if (section === "tags") return segments.length === 3;
    if (withRecord.includes(section)) return segments.length <= 3;
    if (bare.includes(section)) return segments.length === 2;
    return false;
  }
  return gmTabForPath(path) !== null && segments.length === 1;
}

// ----- Resume-last-location (D2) -----

const GM_LOCATION_KEY = "vtt.gm-last-location";
const PLAYER_LOCATION_KEY = "vtt.player-last-location";

/** The same try/catch discipline every `codex-*` key already uses: private mode throws on read AND write. */
export function rememberLocation(role: "gm" | "player", href: string): void {
  try { localStorage.setItem(role === "gm" ? GM_LOCATION_KEY : PLAYER_LOCATION_KEY, href); } catch { /* private mode - fine */ }
}

export function lastLocation(role: "gm" | "player"): string | null {
  try { return localStorage.getItem(role === "gm" ? GM_LOCATION_KEY : PLAYER_LOCATION_KEY); } catch { return null; }
}

/**
 * D2: where a freshly authenticated session lands. A deep link ALWAYS wins — the login screen renders
 * *at* the requested path, so after auth the requested view is what appears. Only a bare `/` resumes.
 */
export function resumeTarget(role: "gm" | "player", currentPath: string): string | null {
  if (currentPath !== "/") return null;
  const stored = lastLocation(role);
  const fallback = role === "gm" ? "/encounter" : "/table";
  const target = stored && isKnownPath(stored.split("?")[0]) ? stored : fallback;
  return target === "/" ? fallback : target;
}
