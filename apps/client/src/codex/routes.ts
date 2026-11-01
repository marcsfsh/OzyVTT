/**
 * The Codex's addresses and its section bar's pages in one place, so nothing else needs to know the path
 * shapes. Data, not JSX: the shell reads these tables, and the Codex search offers the same destinations.
 */

import type { CodexSearchHit } from "@vtt/domain";
import { withQuery } from "../router";

/** Every section the shell renders. The registry in `shell/sections.tsx` holds one view per role for each. */
export type CodexSection =
  | "home"
  | "search"
  | "pages"
  | "atlas"
  | "story"
  | "timeline"
  | "sessions"
  | "quests"
  | "relationships"
  | "compendium"
  | "templates"
  | "tags"
  | "backup"
  | "settings";

/** Addresses from before the remaster. Each still answers and redirects to where its content lives now. */
export type RetiredCodexSection = "graph" | "journal" | "calendar" | "downtime" | "audit";

export type CodexAddress = CodexSection | RetiredCodexSection;

export const CODEX_ROOT = "/codex";

/** `/codex` is Home; everything else is a child. */
export function pathForSection(section: CodexSection): string {
  return section === "home" ? CODEX_ROOT : `${CODEX_ROOT}/${section}`;
}

/** Sections whose address may carry one record id: `/codex/pages/:id`. */
export const RECORD_SECTION_IDS: readonly CodexAddress[] = [
  "pages",
  "atlas",
  "sessions",
  "quests",
  "templates",
  "compendium"
];
/** Sections that are exactly their own address. Their filters and focus live in the query. */
export const BARE_SECTION_IDS: readonly CodexAddress[] = [
  "search",
  "story",
  "timeline",
  "relationships",
  "backup",
  "settings",
  "graph",
  "journal",
  "calendar",
  "downtime",
  "audit"
];

/** Only the GM reaches these; a player gets the not-found view, the same as for an address that means nothing. */
export const GM_ONLY_SECTIONS: readonly CodexAddress[] = ["templates", "backup", "settings", "audit"];

/**
 * Which section an address renders, or null if it isn't a Codex address. Unknown children and wrong segment counts
 * are null too, so the shell shows not-found and an address never confirms a surface exists. Must agree with the
 * router's `isKnownPath` (`router.test.ts`).
 */
export function codexSectionOf(segments: readonly string[]): CodexAddress | null {
  if (segments[0] !== "codex") return null;
  if (segments.length === 1) return "home";
  const candidate = segments[1] as CodexAddress;
  if (candidate === "tags") return segments.length === 3 ? "tags" : null;
  if (RECORD_SECTION_IDS.includes(candidate)) return segments.length <= 3 ? candidate : null;
  if (BARE_SECTION_IDS.includes(candidate)) return segments.length === 2 ? candidate : null;
  return null;
}

export function isRetiredSection(section: CodexAddress): section is RetiredCodexSection {
  return (["graph", "journal", "calendar", "downtime", "audit"] as const).some((retired) => retired === section);
}

/** The record id inside a section address (`/codex/pages/:id`), or null when the list itself is open. */
export function recordIdOf(segments: readonly string[]): string | null {
  return segments.length >= 3 ? segments[2] : null;
}

/** Copies the named query keys that are set, so a redirect keeps what the old address focused. */
function keep(query: URLSearchParams, keys: readonly string[], extra: Readonly<Record<string, string>> = {}) {
  const out: Record<string, string> = { ...extra };
  for (const key of keys) {
    const value = query.get(key);
    if (value) out[key] = value;
  }
  return out;
}

/** Where a retired address's content lives now. The Reveal audit became Search filtered to Hidden. */
export function retiredTarget(section: RetiredCodexSection, query: URLSearchParams): string {
  switch (section) {
    case "graph":
      return withQuery(pathForSection("relationships"), keep(query, ["focus"]));
    case "journal":
      return withQuery(pathForSection("story"), keep(query, ["entry", "kind", "tag", "q"]));
    case "calendar":
      return withQuery(pathForSection("story"), keep(query, ["y", "m"]));
    case "downtime":
      return withQuery(pathForSection("story"), { tab: "downtime" });
    case "audit":
      return searchPath({ visibility: "hidden" });
  }
}

// ----- The section bar's pages -----

export type CodexBarItem = Readonly<{ id: string; label: string; iconId: string; path: string }>;

/**
 * The Codex's pages, left to right on the Titled bar and its phone strip (Codex frame rule 3.1). Search is the bar's
 * field, so it is no page. The Compendium is the GM's own section, so only a player's strip ends with it.
 */
export const CODEX_BAR: readonly CodexBarItem[] = [
  { id: "home", label: "Home", iconId: "home", path: pathForSection("home") },
  { id: "pages", label: "Pages", iconId: "scroll", path: pathForSection("pages") },
  { id: "atlas", label: "Atlas", iconId: "compass", path: pathForSection("atlas") },
  { id: "story", label: "Story", iconId: "book", path: pathForSection("story") },
  { id: "quests", label: "Quests", iconId: "quest", path: pathForSection("quests") },
  { id: "relationships", label: "Relationships", iconId: "graph", path: pathForSection("relationships") },
  { id: "compendium", label: "Compendium", iconId: "scroll", path: pathForSection("compendium") }
];

/** The bar's pages for one role. */
export function codexBar(role: "gm" | "player"): readonly CodexBarItem[] {
  return role === "gm" ? CODEX_BAR.filter((item) => item.id !== "compendium") : CODEX_BAR;
}

/**
 * Which of the bar's pages an address lights. Search and a tag light none (search is the bar's field), and the GM's
 * own places light the bar's More.
 */
export function barItemOf(section: CodexSection): string | null {
  switch (section) {
    case "home":
    case "pages":
    case "atlas":
    case "quests":
    case "relationships":
    case "compendium":
      return section;
    case "story":
    case "timeline":
    case "sessions":
      return "story";
    case "templates":
    case "backup":
    case "settings":
      return "gm-menu";
    case "search":
    case "tags":
      return null;
  }
}

/** What a section is called in a phone's top bar and in the palette's Go to verbs. */
export const SECTION_TITLE: Readonly<Record<CodexSection, string>> = {
  home: "Home",
  search: "Search",
  pages: "Pages",
  atlas: "Atlas",
  story: "Story",
  timeline: "Timeline",
  sessions: "Sessions",
  quests: "Quests",
  relationships: "Relationships",
  compendium: "Compendium",
  templates: "Prep templates",
  tags: "Tag",
  backup: "Backup",
  settings: "Autosave and history"
};

/** The GM menu's destinations, in the menu's order. See as players is an action of the menu, with no address. */
export const GM_MENU_SECTIONS: readonly CodexSection[] = ["templates", "backup", "settings"];

/** Every place the palette's Go to verbs offer, for one role: the bar, Pages, Story's views and the GM menu. */
export function codexDestinations(role: "gm" | "player"): ReadonlyArray<Readonly<{ label: string; path: string }>> {
  const sections: CodexSection[] = [
    "home",
    "search",
    "pages",
    "atlas",
    "story",
    "timeline",
    "sessions",
    "quests",
    "relationships",
    "compendium"
  ];
  if (role === "gm") sections.push(...GM_MENU_SECTIONS);
  return sections.map((section) => ({ label: SECTION_TITLE[section], path: pathForSection(section) }));
}

// ----- Jump targets -----

export const pagePath = (id: string, mode?: "edit") => withQuery(`${CODEX_ROOT}/pages/${id}`, { mode });
/** `/codex/atlas/:mapId?pin=:markerId`: the map, then the pin selected. */
export const atlasPath = (mapId: string | null, markerId?: string | null) =>
  withQuery(mapId ? `${CODEX_ROOT}/atlas/${mapId}` : `${CODEX_ROOT}/atlas`, { pin: markerId ?? null });
/** `/codex/story?entry=:id`: the chronicle with the entry focused. */
export const journalEntryPath = (entryId: string) => withQuery(pathForSection("story"), { entry: entryId });
export const sessionPath = (id: string) => `${CODEX_ROOT}/sessions/${id}`;
export const questPath = (id: string, mode?: "edit") => withQuery(`${CODEX_ROOT}/quests/${id}`, { mode });
export const templatePath = (id?: string | null) =>
  id ? `${CODEX_ROOT}/templates/${id}` : pathForSection("templates");
export type RelationshipsView = "web" | "grid" | "time";
export const relationshipsPath = (focusPageId?: string | null, view?: RelationshipsView | null) =>
  withQuery(pathForSection("relationships"), { focus: focusPageId ?? null, view: view === "web" ? null : view });
/** A tag opens the pages index filtered to it (F finding spec 2.3); the old `/codex/tags/:tag` address redirects here. */
export const tagPath = (tag: string) => withQuery(pathForSection("pages"), { tag });

/** Search's filters are its address, so a filtered search is linkable and survives a refresh. */
export type SearchAddress = Readonly<{
  q?: string | null;
  types?: string | null;
  visibility?: "all" | "revealed" | "hidden" | null;
  from?: string | null;
  to?: string | null;
  sort?: string | null;
}>;
export const searchPath = (address: SearchAddress = {}) =>
  withQuery(pathForSection("search"), {
    q: address.q,
    types: address.types,
    visibility: address.visibility === "all" ? null : address.visibility,
    from: address.from,
    to: address.to,
    sort: address.sort
  });

/** Where a search hit opens, shared by every result list. */
export function pathForHit(hit: Pick<CodexSearchHit, "kind" | "id" | "mapId">): string {
  switch (hit.kind) {
    case "page":
      return pagePath(hit.id);
    case "map":
      return atlasPath(hit.id);
    // A map-less pin still works: the Atlas resolves its map via `GET /codex/markers/{id}`.
    case "marker":
      return atlasPath(hit.mapId, hit.id);
    case "journal":
      return journalEntryPath(hit.id);
    case "quest":
      return questPath(hit.id);
    case "session":
      return sessionPath(hit.id);
  }
}
