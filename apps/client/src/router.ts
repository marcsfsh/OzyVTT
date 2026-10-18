/**
 * Real URLs via a small hand-rolled history layer (no react-router: one entry point, a small address
 * space, and a socket-push data model). The server serves `index.html` for every non-API GET;
 * `GET /viewer` is the TV viewer, hence the GM tab's `/viewer-controls`.
 */

import { useSyncExternalStore } from "react";
// The Codex owns its address space (`codex/routes.ts`) and this module asks it. The import cycle via
// `withQuery` is safe: neither module calls across it during evaluation.
import { codexSectionOf, GM_ONLY_SECTIONS, type CodexAddress } from "./codex/routes";
import { compendiumViewOf } from "./compendium/routes";
import { isSettingsSection } from "./settings/sections";
import { redirectForOldMapAddress, scenesViewOf, type ScenesView } from "./scenes/routes";

export type Route = Readonly<{
  /** The pathname, always leading-slash, never trailing-slash (except the bare root). */
  path: string;
  /** The pathname split on "/", empties dropped. `/codex/pages/abc` → `["codex","pages","abc"]`. */
  segments: readonly string[];
  query: URLSearchParams;
}>;

const listeners = new Set<() => void>();
let snapshot: Route = readLocation();
/** The address the router believes it is at; popstate pushes it back to undo a vetoed Back. */
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

// Navigation guards (an editor with autosave off and unsaved changes)

type Guard = () => boolean | Promise<boolean>;
const guards = new Set<Guard>();

/**
 * Registers a veto on leaving the current view (`false` blocks). Used by `useCodexAutosave` for a
 * dirty draft with autosave off. Returns its unregister function.
 */
export function registerNavigationGuard(guard: Guard): () => void {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

async function mayLeave(): Promise<boolean> {
  for (const guard of [...guards]) {
    // Sequential: each guard may prompt, and two prompts at once (as `Promise.all` would give) is a trap.
    if (!(await guard())) return false;
  }
  return true;
}

window.addEventListener("popstate", () => {
  /**
   * Back is a navigation too, so guards apply; the browser has already moved, so a veto pushes the
   * previous address back. With no guards, or a pop that keeps the address, it just publishes.
   */
  if (guards.size === 0 || currentHref() === currentEntry) {
    publish();
    return;
  }
  const from = currentEntry;
  void mayLeave().then((allowed) => {
    if (allowed) {
      publish();
      return;
    }
    window.history.pushState(null, "", from);
  });
});

/** Goes to an address after the guards; a veto leaves the URL alone. Resolves to whether it navigated. */
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

/** Rewrites the query without a history entry, to clear a landing parameter. Not for navigation. */
export function replaceQuery(mutate: (query: URLSearchParams) => void): void {
  const query = new URLSearchParams(window.location.search);
  mutate(query);
  const search = query.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
  publish();
}

/** Builds an address with query parameters, and drops empty ones so a URL never carries `?tag=`. */
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
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => snapshot,
    () => snapshot
  );
}

// The app shell's address table

export type GmTab = "scenes" | "table" | "roster" | "codex" | "compendium" | "viewer" | "replay" | "settings";

/** One address per GM tab; the server reserves `GET /viewer`, hence `/viewer-controls`. */
const GM_TAB_PATHS: Readonly<Record<GmTab, string>> = {
  table: "/table",
  scenes: "/scenes",
  roster: "/roster",
  codex: "/codex",
  compendium: "/compendium",
  viewer: "/viewer-controls",
  replay: "/replays",
  settings: "/settings"
};

export function pathForGmTab(tab: GmTab): string {
  return GM_TAB_PATHS[tab];
}

/** The sound board: the Shared screen tab's second view, beside the display controls. */
export const SOUND_BOARD_PATH = `${GM_TAB_PATHS.viewer}/sound`;

/** Retired addresses, redirected so old bookmarks land. */
const RETIRED_PATHS: Readonly<Record<string, string>> = {
  "/encounter": "/table",
  "/setup": "/settings",
  // The Homebrew tab became the Compendium.
  "/homebrew": "/compendium"
};

/** Where a retired address goes, or null when the address is not retired. `?view=maps` moves too, and so does the
 *  map library's `?map=` for one map's grid. */
export function redirectForRetiredPath(path: string, query: URLSearchParams): string | null {
  if (path === "/scenes" && query.get("view") === "maps") return "/scenes/maps";
  return redirectForOldMapAddress(path, query) ?? RETIRED_PATHS[path] ?? null;
}

/** Which GM tab an address renders, or null when the address is not a GM tab at all. */
export function gmTabForPath(path: string): GmTab | null {
  const head = `/${path.split("/").filter(Boolean)[0] ?? ""}`;
  const found = (Object.entries(GM_TAB_PATHS) as ReadonlyArray<[GmTab, string]>).find(([, value]) => value === head);
  return found ? found[0] : null;
}

/** Which tab lights for an address; a layer lights its owning tab (a sheet lights the Roster). */
export function litGmTab(path: string): GmTab | null {
  const head = path.split("/").filter(Boolean)[0] ?? "";
  if (head === "characters" || head === "builder") return "roster";
  return gmTabForPath(path);
}

/** The player's tabs, and which one lights for an address: the player's own sheet, its level page and the builder
 *  belong to My character; everything that is not My character, the Codex or Settings is the table. */
export type PlayerTab = "mine" | "table" | "codex" | "settings";
export function litPlayerTab(path: string): PlayerTab {
  const head = path.split("/").filter(Boolean)[0] ?? "";
  if (head === "me" || head === "characters" || head === "builder") return "mine";
  if (head === "codex") return "codex";
  if (head === "settings") return "settings";
  return "table";
}

/**
 * Addresses only the GM may reach; a player gets not-found. Shared addresses whose content a player
 * may not see are guarded by the data, which also renders not-found.
 */
export function isGmOnlyPath(path: string): boolean {
  const segments = path.split("/").filter(Boolean);
  if (segments[0] === "codex") return GM_ONLY_SECTIONS.includes((segments[1] ?? "") as CodexAddress);
  // `/settings` and its Device section are shared; every other section, the API reference among them, is the GM's.
  if (segments[0] === "settings") return segments[1] !== undefined && segments[1] !== "device";
  const tab = gmTabForPath(path);
  if (tab === null) return false;
  return tab !== "codex" && tab !== "table" && tab !== "settings" && tab !== "replay";
}

/** The one player-only address, `/me`; "not GM-only" means shared, so this is its own check. */
export function isPlayerOnlyPath(path: string): boolean {
  return path.split("/").filter(Boolean)[0] === "me";
}

/**
 * Every address the app answers, for the not-found decision. The codex half asks `codexSectionOf`, so
 * existence and rendering cannot disagree; id-bearing heads accept any well-shaped id.
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
  if (segments[0] === "scenes") return scenesViewOf(segments, new URLSearchParams()) !== null;
  // The Compendium's views and each record's own address.
  if (segments[0] === "compendium") return compendiumViewOf(segments, new URLSearchParams()) !== null;
  // The player's own tab: one segment, nothing under it.
  if (segments[0] === "me") return segments.length === 1;
  // A section of Settings, or one operation of the API reference by its operation id.
  if (segments[0] === "settings")
    return (
      segments.length === 1 ||
      (segments.length === 2 && isSettingsSection(segments[1])) ||
      (segments.length === 3 && segments[1] === "api" && /^[A-Za-z][\w.-]{0,100}$/.test(segments[2]))
    );
  // The Shared screen tab is the display controls or, at `/sound`, the sound board.
  if (segments[0] === "viewer-controls")
    return segments.length === 1 || (segments.length === 2 && segments[1] === "sound");
  // A replay id is the archive's integer row id, so a non-numeric second segment is genuinely unknown.
  if (segments[0] === "replays")
    return segments.length === 1 || (segments.length === 2 && /^[0-9]{1,12}$/.test(segments[1]));
  return gmTabForPath(path) !== null && segments.length === 1;
}

/** A layer open over a tab (sheet, builder, level flow, replay, a view inside Scenes), parsed in one place. */
export type AddressLayer =
  | Readonly<{ kind: "sheet"; actorId: string }>
  | Readonly<{ kind: "level"; actorId: string }>
  | Readonly<{ kind: "builder" }>
  | Readonly<{ kind: "replay"; archiveId: number }>
  | Readonly<{ kind: "scenes"; view: ScenesView }>;

export function layerOf(path: string, query: URLSearchParams = new URLSearchParams()): AddressLayer | null {
  const segments = path.split("/").filter(Boolean);
  if (segments[0] === "characters" && segments[1]) {
    return segments[2] === "level" ? { kind: "level", actorId: segments[1] } : { kind: "sheet", actorId: segments[1] };
  }
  if (segments[0] === "builder" && segments.length === 1) return { kind: "builder" };
  if (segments[0] === "replays" && segments.length === 2) return { kind: "replay", archiveId: Number(segments[1]) };
  if (segments[0] === "scenes" && segments.length >= 2) {
    const view = scenesViewOf(segments, query);
    return view ? { kind: "scenes", view } : null;
  }
  return null;
}

// Resume last location

const GM_LOCATION_KEY = "vtt.gm-last-location";
const PLAYER_LOCATION_KEY = "vtt.player-last-location";

/** The head segment an address belongs to (its tab). `/` belongs to none. */
function headOf(path: string): string | null {
  return path.split("/").filter(Boolean)[0] ?? null;
}

/** Storage access is wrapped in try/catch: private mode throws on read and write. */
export function rememberLocation(role: "gm" | "player", href: string): void {
  try {
    localStorage.setItem(role === "gm" ? GM_LOCATION_KEY : PLAYER_LOCATION_KEY, href);
    // Also remembered per tab, so returning to a tab reopens the record that was open there.
    const head = headOf(href.split("?")[0] ?? "");
    if (head) localStorage.setItem(`${role === "gm" ? GM_LOCATION_KEY : PLAYER_LOCATION_KEY}.${head}`, href);
  } catch {
    /* private mode - fine */
  }
}

export function lastLocation(role: "gm" | "player"): string | null {
  try {
    return localStorage.getItem(role === "gm" ? GM_LOCATION_KEY : PLAYER_LOCATION_KEY);
  } catch {
    return null;
  }
}

/**
 * Where this role last was inside a tab, or null for the tab's own address. Validated like
 * `resumeTarget`: never a dead record or, for a player, a GM-only address.
 */
export function lastLocationForTab(role: "gm" | "player", head: string): string | null {
  let stored: string | null;
  try {
    stored = localStorage.getItem(`${role === "gm" ? GM_LOCATION_KEY : PLAYER_LOCATION_KEY}.${head}`);
  } catch {
    return null;
  }
  if (!stored) return null;
  const path = stored.split("?")[0] ?? "";
  if (headOf(path) !== head) return null;
  if (!isKnownPath(path)) return null;
  if (role === "player" && isGmOnlyPath(path)) return null;
  return stored;
}

/** Where a fresh session lands: a deep link always wins; only a bare `/` resumes. */
export function resumeTarget(role: "gm" | "player", currentPath: string): string | null {
  if (currentPath !== "/") return null;
  const stored = lastLocation(role);
  // One address for the table, both roles.
  const fallback = "/table";
  // A player is never resumed onto a GM-only address: the not-found view would catch it, but sending
  // them there would volunteer the address.
  const path = stored?.split("?")[0] ?? "";
  const usable = stored && isKnownPath(path) && !(role === "player" && isGmOnlyPath(path));
  const target = usable ? stored : fallback;
  return target === "/" ? fallback : target;
}
