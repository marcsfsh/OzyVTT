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
// The Codex owns its own address space (`codex/routes.ts`); this module asks it rather than keeping a
// second copy of the rules. The cycle back through `withQuery` is import-time-safe: nothing in either
// module calls across the boundary while the modules are still evaluating.
import { codexSectionOf } from "./codex/routes";

export type Route = Readonly<{
  /** The pathname, always leading-slash, never trailing-slash (except the bare root). */
  path: string;
  /** The pathname split on "/", empties dropped. `/codex/pages/abc` → `["codex","pages","abc"]`. */
  segments: readonly string[];
  query: URLSearchParams;
}>;

const listeners = new Set<() => void>();
let snapshot: Route = readLocation();
/**
 * The address the router believes it is at, kept in step with `snapshot`.
 *
 * Only the popstate handler reads it, and only for one job: a Back the guards veto has already moved the
 * browser's cursor by the time we hear about it, so undoing the veto means pushing *this* address back
 * on top of the one we were moved to.
 */
let currentEntry: string = `${window.location.pathname}${window.location.search}`;

function readLocation(): Route {
  const raw = window.location.pathname || "/";
  const path = raw.length > 1 && raw.endsWith("/") ? raw.slice(0, -1) : raw;
  return { path, segments: path.split("/").filter(Boolean), query: new URLSearchParams(window.location.search) };
}

function publish(): void {
  snapshot = readLocation();
  currentEntry = currentHref();
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

/**
 * Hand back an entry `discardTransient` released for a navigation that was then VETOED.
 *
 * The drawer's entry is still on the stack and nothing is registered to absorb its pop any more, so the
 * GM's next Back would be spent closing an already-closed drawer — it would appear to do nothing, which
 * is exactly the trap the transient mechanism exists to prevent. Popping it here costs no prompt: the
 * entry sits at the address we are already on, and a pop that does not move the address is not a
 * departure (see the popstate handler).
 */
export function releaseStrandedEntry(): void {
  window.history.back();
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
  /**
   * **Back is a navigation, and on a phone it is THE navigation.** The guards were wired into
   * `navigate()` only, so with autosave off the browser Back button and the Android back gesture walked
   * straight out of a dirty editor and the draft was gone with no prompt — the one way to lose work in
   * this app.
   *
   * The browser has already moved the cursor by the time popstate fires, so a veto cannot be a "don't":
   * it has to be an undo. Pushing the address we were on back on top of the one we were moved to is the
   * standard shape, and it costs nothing — the entry we were popped past is overwritten, so history
   * length is unchanged and a second Back reaches the same place a first one would have.
   *
   * Two fast paths, both load-bearing. With no editor open there are no guards, and the pop must
   * publish synchronously so a plain Back is not a frame slower than it was. And **a pop that does not
   * move the address is not a departure** — `popTransient` and `releaseStrandedEntry` both go back onto
   * an entry at the address we are already on, and asking the GM to confirm leaving a page they are
   * staying on would be a prompt with no true answer.
   */
  if (guards.size === 0 || currentHref() === currentEntry) { publish(); return; }
  const from = currentEntry;
  void mayLeave().then((allowed) => {
    if (allowed) { publish(); return; }
    window.history.pushState(null, "", from);
  });
});

/**
 * Go to an address. Guards run first; a vetoed navigation leaves the URL alone.
 *
 * Deliberately fire-and-forget at almost every call site (`onClick={() => navigate(path)}`) — the
 * promise exists so a guard may prompt, not so callers can await it. It resolves to **whether the
 * navigation happened**, which the phone nav drawer does need: it released its own history entry on the
 * assumption this was about to overwrite it, and has to take that back if the GM chose to stay.
 */
export function navigate(path: string, opts: Readonly<{ replace?: boolean }> = {}): Promise<boolean> {
  if (path === currentHref()) return Promise.resolve(false);
  return mayLeave().then((allowed) => {
    if (!allowed) return false;
    if (opts.replace) window.history.replaceState(null, "", path);
    else window.history.pushState(null, "", path);
    publish();
    return true;
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

export type GmTab = "scenes" | "table" | "roster" | "codex" | "homebrew" | "viewer" | "replay" | "settings";

/**
 * One address per GM tab. **`/viewer-controls`, not `/viewer`** — the server reserves `GET /viewer` as a
 * 307 to the standalone TV viewer in both prod and dev, so the SPA can never receive that address; and
 * "viewer controls" is what the tab actually is (the controls for the shared screen).
 *
 * D28/D29: the table's address is `/table` for BOTH roles — one address, the projection decides what
 * renders. `/encounter` (three names for one tab: id `table`, label "Encounter", path `/encounter`) and
 * `/setup` (now Settings) are retired, and `RETIRED_PATHS` redirects them so old bookmarks still land.
 */
const GM_TAB_PATHS: Readonly<Record<GmTab, string>> = {
  table: "/table",
  scenes: "/scenes",
  roster: "/roster",
  codex: "/codex",
  homebrew: "/homebrew",
  viewer: "/viewer-controls",
  replay: "/replays",
  settings: "/settings"
};

export function pathForGmTab(tab: GmTab): string { return GM_TAB_PATHS[tab]; }

/**
 * Addresses that used to mean something and now mean somewhere else. A redirect rather than a
 * not-found: a GM who bookmarked `/encounter` in the last build must land on the table, not on a card
 * telling them nothing lives there.
 */
const RETIRED_PATHS: Readonly<Record<string, string>> = { "/encounter": "/table", "/setup": "/settings" };

/** Where a retired address goes, or null when the address is not retired. `?view=maps` moves too. */
export function redirectForRetiredPath(path: string, query: URLSearchParams): string | null {
  if (path === "/scenes" && query.get("view") === "maps") return "/scenes/maps";
  return RETIRED_PATHS[path] ?? null;
}

/** Which GM tab an address renders, or null when the address is not a GM tab at all. */
export function gmTabForPath(path: string): GmTab | null {
  const head = `/${path.split("/").filter(Boolean)[0] ?? ""}`;
  const found = (Object.entries(GM_TAB_PATHS) as ReadonlyArray<[GmTab, string]>).find(([, value]) => value === head);
  return found ? found[0] : null;
}

/**
 * Which tab LIGHTS for an address (A2 "tab lighting for layer addresses").
 *
 * A layer address belongs to a tab even though it is not that tab's own address: a character sheet and
 * the builder are the Roster's kind of thing, so the Roster arm stays lit while one is open. Without
 * this, `/characters/<id>` fell through `gmTabForPath` to null and the shell lit Table — the lit-tab lie
 * D1 exists to kill.
 */
export function litGmTab(path: string): GmTab | null {
  const head = path.split("/").filter(Boolean)[0] ?? "";
  if (head === "characters" || head === "builder") return "roster";
  return gmTabForPath(path);
}

/**
 * Addresses only the GM may reach. A player asking for one gets the not-found view (never a 403-alike).
 *
 * D29 shrinks this list: `/table`, `/settings`, `/replays`, `/replays/<id>`, `/characters/*` and
 * `/builder` are player-reachable **as addresses**. Whether a player may see the thing AT that address
 * is a data guard (their claim, the GM's share, the builder policy) that renders not-found on failure —
 * the same indistinguishable answer, decided one level in where the data is.
 */
export function isGmOnlyPath(path: string): boolean {
  const segments = path.split("/").filter(Boolean);
  if (segments[0] === "codex") return ["audit", "backup", "settings"].includes(segments[1] ?? "");
  const tab = gmTabForPath(path);
  if (tab === null) return false;
  return tab !== "codex" && tab !== "table" && tab !== "settings" && tab !== "replay";
}

/**
 * Every address the app answers, for the not-found decision. Anything else renders "nothing lives here".
 *
 * The codex half asks `codexSectionOf` rather than re-deciding: two implementations of one address space
 * disagreed on `/codex/tags` and `/codex/journal/j1`, and a disagreement between "does this exist" and
 * "what does it render" puts a not-found card on top of a working surface. `router.test.ts` asserts the
 * two answers stay locked together over the whole table.
 *
 * The id-bearing heads (`/characters/<id>`, `/scenes/<id>`, `/replays/<id>`) answer "yes" for any
 * well-shaped id: whether THAT id exists, is claimed, or was shared is data the router does not hold,
 * and the surface renders not-found when its own guard says no.
 */
export function isKnownPath(path: string): boolean {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return true;
  if (segments[0] === "codex") return codexSectionOf(segments) !== null;
  if (segments[0] === "builder") return segments.length === 1;
  if (segments[0] === "characters") {
    if (segments.length === 2) return segments[1].length > 0;
    return segments.length === 3 && segments[2] === "level";
  }
  if (segments[0] === "scenes") return segments.length === 1 || (segments.length === 2 && segments[1].length > 0);
  // A replay id is the archive's integer row id, so a non-numeric second segment is genuinely unknown.
  if (segments[0] === "replays") return segments.length === 1 || (segments.length === 2 && /^[0-9]{1,12}$/.test(segments[1]));
  return gmTabForPath(path) !== null && segments.length === 1;
}

/**
 * A LAYER open on top of a tab: the sheet, the builder, the level flow, a replay, a scene-prep
 * workspace, the maps library. Each used to be component state (`builderOpen`, `previewSceneId`,
 * `?archive=`, `?view=maps`, five sheet openers) — D29 gives each an address, and this is the one place
 * that reads one back out, so the shell branches on a value rather than on five parallel booleans.
 */
export type AddressLayer =
  | Readonly<{ kind: "sheet"; actorId: string }>
  | Readonly<{ kind: "level"; actorId: string }>
  | Readonly<{ kind: "builder" }>
  | Readonly<{ kind: "replay"; archiveId: number }>
  | Readonly<{ kind: "scene-prep"; sceneId: string | null }>
  | Readonly<{ kind: "maps" }>;

export function layerOf(path: string): AddressLayer | null {
  const segments = path.split("/").filter(Boolean);
  if (segments[0] === "characters" && segments[1]) {
    return segments[2] === "level" ? { kind: "level", actorId: segments[1] } : { kind: "sheet", actorId: segments[1] };
  }
  if (segments[0] === "builder" && segments.length === 1) return { kind: "builder" };
  if (segments[0] === "replays" && segments.length === 2) return { kind: "replay", archiveId: Number(segments[1]) };
  if (segments[0] === "scenes" && segments.length === 2) {
    if (segments[1] === "maps") return { kind: "maps" };
    return { kind: "scene-prep", sceneId: segments[1] === "new" ? null : segments[1] };
  }
  return null;
}

// ----- Resume-last-location (D2) -----

const GM_LOCATION_KEY = "vtt.gm-last-location";
const PLAYER_LOCATION_KEY = "vtt.player-last-location";

/** The head segment an address belongs to — the tab, in the app shell's terms. `/` belongs to none. */
function headOf(path: string): string | null {
  return path.split("/").filter(Boolean)[0] ?? null;
}

/** The same try/catch discipline every `codex-*` key already uses: private mode throws on read AND write. */
export function rememberLocation(role: "gm" | "player", href: string): void {
  try {
    localStorage.setItem(role === "gm" ? GM_LOCATION_KEY : PLAYER_LOCATION_KEY, href);
    /**
     * D2 also remembers PER TAB, which is what makes the decision worth anything in the dominant case.
     *
     * "The Codex reopens exactly where the GM last was" was implemented only for a cold sign-in landing
     * on `/`. Every in-app return — the GM tab bar, the player's Table/Codex switcher — navigated to the
     * bare section head, so a GM editing a page who tapped Encounter to check initiative and tapped
     * Codex again landed on the dashboard with nothing selected. Intake 04 named that exact round trip
     * as the cost of having no router; after the recut it cost the same two taps.
     */
    const head = headOf(href.split("?")[0] ?? "");
    if (head) localStorage.setItem(`${role === "gm" ? GM_LOCATION_KEY : PLAYER_LOCATION_KEY}.${head}`, href);
  } catch { /* private mode - fine */ }
}

export function lastLocation(role: "gm" | "player"): string | null {
  try { return localStorage.getItem(role === "gm" ? GM_LOCATION_KEY : PLAYER_LOCATION_KEY); } catch { return null; }
}

/**
 * Where this role last was INSIDE a tab, or null to fall back to the tab's own address.
 *
 * Validated exactly as `resumeTarget` validates its stored address, and for the same reasons: a stored
 * `/codex/pages/<deleted>` must not strand anyone, and a player must never be sent to a GM-only address
 * by a mechanism they cannot see.
 */
export function lastLocationForTab(role: "gm" | "player", head: string): string | null {
  let stored: string | null = null;
  try { stored = localStorage.getItem(`${role === "gm" ? GM_LOCATION_KEY : PLAYER_LOCATION_KEY}.${head}`); } catch { return null; }
  if (!stored) return null;
  const path = stored.split("?")[0] ?? "";
  if (headOf(path) !== head) return null;
  if (!isKnownPath(path)) return null;
  if (role === "player" && isGmOnlyPath(path)) return null;
  return stored;
}

/**
 * D2: where a freshly authenticated session lands. A deep link ALWAYS wins — the login screen renders
 * *at* the requested path, so after auth the requested view is what appears. Only a bare `/` resumes.
 */
export function resumeTarget(role: "gm" | "player", currentPath: string): string | null {
  if (currentPath !== "/") return null;
  const stored = lastLocation(role);
  // D29: one address for the table, both roles. There is no second front door any more.
  const fallback = "/table";
  // A player is never resumed onto a GM-only address. The not-found view would catch it, but being
  // *sent* there on sign-in is a worse shape than deep-linking there deliberately: the app would be
  // volunteering the address rather than declining to answer it.
  const path = stored?.split("?")[0] ?? "";
  const usable = stored && isKnownPath(path) && !(role === "player" && isGmOnlyPath(path));
  const target = usable ? stored : fallback;
  return target === "/" ? fallback : target;
}
