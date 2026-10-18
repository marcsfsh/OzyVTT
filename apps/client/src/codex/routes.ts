/**
 * The Codex's addresses, its section bar and its phone tabs in one place, so nothing else needs to know the path
 * shapes. Data, not JSX: the shell reads these tables, and the command palette offers the same destinations.
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
export const RECORD_SECTION_IDS: readonly CodexAddress[] = ["pages", "atlas", "sessions", "quests", "templates"];
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
      return withQuery(pathForSection("story"), { kind: "downtime" });
    case "audit":
      return searchPath({ visibility: "hidden" });
  }
}

// ----- The laptop's section bar and the phone's tab bar -----

export type CodexBarItem = Readonly<{ id: string; label: string; iconId: string; path: string }>;

/** The laptop's section bar, left to right. */
export const CODEX_BAR: readonly CodexBarItem[] = [
  { id: "home", label: "Home", iconId: "home", path: pathForSection("home") },
  { id: "search", label: "Search", iconId: "search", path: pathForSection("search") },
  { id: "atlas", label: "Atlas", iconId: "compass", path: pathForSection("atlas") },
  { id: "story", label: "Story", iconId: "book", path: pathForSection("story") },
  { id: "quests", label: "Quests", iconId: "quest", path: pathForSection("quests") },
  { id: "relationships", label: "Relationships", iconId: "graph", path: pathForSection("relationships") }
];

/**
 * Which bar item an address lights. A page opened from Search or a link lights none, and the GM menu's own sections
 * light the menu.
 */
export function barItemOf(section: CodexSection): string | null {
  switch (section) {
    case "home":
    case "search":
    case "atlas":
    case "quests":
    case "relationships":
      return section;
    case "story":
    case "timeline":
    case "sessions":
      return "story";
    case "tags":
      return "search";
    case "templates":
    case "backup":
    case "settings":
      return "gm-menu";
    case "pages":
      return null;
  }
}

/** The phone's tab bar under the thumb. Campaign opens the last of its four parts. */
export const CODEX_PHONE_TABS: readonly Readonly<{ id: CodexPhoneTab; label: string; iconId: string }>[] = [
  { id: "home", label: "Home", iconId: "home" },
  { id: "pages", label: "Pages", iconId: "scroll" },
  { id: "atlas", label: "Atlas", iconId: "compass" },
  { id: "campaign", label: "Campaign", iconId: "calendar" },
  { id: "search", label: "Search", iconId: "search" }
];
export type CodexPhoneTab = "home" | "pages" | "atlas" | "campaign" | "search";

export function phoneTabOf(section: CodexSection): CodexPhoneTab | null {
  switch (section) {
    case "home":
    case "atlas":
    case "search":
      return section;
    case "pages":
    case "tags":
      return "pages";
    case "story":
    case "timeline":
    case "sessions":
    case "quests":
    case "relationships":
    case "templates":
      return "campaign";
    case "backup":
    case "settings":
      return null;
  }
}

/** Campaign's four parts, switched under the phone's top bar. */
export const CAMPAIGN_PARTS: readonly Readonly<{ id: CampaignPart; label: string; path: string }>[] = [
  { id: "story", label: "Story", path: pathForSection("story") },
  { id: "quests", label: "Quests", path: pathForSection("quests") },
  { id: "relationships", label: "Relationships", path: pathForSection("relationships") },
  { id: "sessions", label: "Sessions", path: pathForSection("sessions") }
];
export type CampaignPart = "story" | "quests" | "relationships" | "sessions";

export function campaignPartOf(section: CodexSection): CampaignPart | null {
  switch (section) {
    case "story":
    case "timeline":
      return "story";
    case "quests":
    case "relationships":
    case "sessions":
      return section;
    default:
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
    "relationships"
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
export const questPath = (id: string) => `${CODEX_ROOT}/quests/${id}`;
export const templatePath = (id?: string | null) =>
  id ? `${CODEX_ROOT}/templates/${id}` : pathForSection("templates");
export type RelationshipsView = "web" | "grid" | "time";
export const relationshipsPath = (focusPageId?: string | null, view?: RelationshipsView | null) =>
  withQuery(pathForSection("relationships"), { focus: focusPageId ?? null, view: view === "web" ? null : view });
export const tagPath = (tag: string) => `${CODEX_ROOT}/tags/${encodeURIComponent(tag)}`;

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
