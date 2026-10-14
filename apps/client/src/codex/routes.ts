/**
 * The Codex's addresses and sidebar in one place, so nothing else needs to know the path shapes. Data, not
 * JSX: `SidebarNav` is role-blind, so the GM and player shells differ only by which lists they pass.
 */

import type { CodexSearchHit } from "./api";
import { withQuery } from "../router";

export type CodexSection =
  | "home" | "pages" | "atlas" | "graph"
  | "sessions" | "quests" | "journal" | "calendar" | "downtime"
  | "tags" | "audit" | "backup" | "settings";

export const CODEX_ROOT = "/codex";

/** `/codex` is Home; everything else is a child. */
export function pathForSection(section: CodexSection): string {
  return section === "home" ? CODEX_ROOT : `${CODEX_ROOT}/${section}`;
}

/**
 * Which section an address renders, or null if it isn't a Codex address. Unknown children and wrong
 * segment counts are null too, so the shell shows not-found and an address never confirms a surface
 * exists. Must agree with the router's `isKnownPath` (`router.test.ts`).
 */
export function codexSectionOf(segments: readonly string[]): CodexSection | null {
  if (segments[0] !== "codex") return null;
  if (segments.length === 1) return "home";
  const candidate = segments[1] as CodexSection;
  // Tags need exactly a tag; record sections allow one id; others are exactly two segments.
  if (candidate === "tags") return segments.length === 3 ? "tags" : null;
  if ((RECORD_SECTION_IDS as readonly string[]).includes(candidate)) return segments.length <= 3 ? candidate : null;
  if ((BARE_SECTION_IDS as readonly string[]).includes(candidate)) return segments.length === 2 ? candidate : null;
  return null;
}

/** Sections whose address may carry one record id: `/codex/pages/:id`. */
export const RECORD_SECTION_IDS: readonly CodexSection[] = ["pages", "atlas", "sessions", "quests"];
/** Sections that are exactly their own address. The journal focuses an entry with `?entry=`. */
export const BARE_SECTION_IDS: readonly CodexSection[] = ["journal", "calendar", "downtime", "graph", "audit", "backup", "settings"];

const CODEX_SECTION_IDS: readonly CodexSection[] = [
  "pages", "atlas", "graph", "sessions", "quests", "journal", "calendar", "downtime", "tags", "audit", "backup", "settings"
];

/** The record id inside a section address (`/codex/pages/:id`), or null when the list itself is open. */
export function recordIdOf(segments: readonly string[]): string | null {
  return segments.length >= 3 ? segments[2] : null;
}

// ----- The sidebar -----

export type SidebarItem = Readonly<{
  /** `path` navigates; `action` runs (Preview as player is the only action). */
  id: string;
  label: string;
  iconId: string;
  path?: string;
  action?: "preview";
}>;
export type SidebarGroup = Readonly<{ label?: string; items: readonly SidebarItem[] }>;

const WORLD_ITEMS: readonly SidebarItem[] = [
  { id: "pages", label: "Pages", iconId: "scroll", path: pathForSection("pages") },
  { id: "atlas", label: "Atlas", iconId: "compass", path: pathForSection("atlas") },
  { id: "graph", label: "Graph", iconId: "graph", path: pathForSection("graph") }
];
const CAMPAIGN_ITEMS: readonly SidebarItem[] = [
  { id: "sessions", label: "Sessions", iconId: "sessions", path: pathForSection("sessions") },
  { id: "quests", label: "Quests", iconId: "quest", path: pathForSection("quests") },
  { id: "journal", label: "Journal", iconId: "book", path: pathForSection("journal") },
  { id: "calendar", label: "Calendar", iconId: "calendar", path: pathForSection("calendar") },
  { id: "downtime", label: "Downtime", iconId: "campfire", path: pathForSection("downtime") }
];
const HOME_ITEM: SidebarItem = { id: "home", label: "Home", iconId: "home", path: CODEX_ROOT };

/** The GM's sidebar. Tools is bottom-anchored by `SidebarNav`, not by its position in this array. */
export const GM_SIDEBAR: readonly SidebarGroup[] = [
  { items: [HOME_ITEM] },
  { label: "World", items: WORLD_ITEMS },
  { label: "Campaign", items: CAMPAIGN_ITEMS },
  {
    label: "Tools",
    items: [
      { id: "audit", label: "Reveal audit", iconId: "eye", path: pathForSection("audit") },
      { id: "preview", label: "Preview as player", iconId: "mask", action: "preview" },
      { id: "backup", label: "Backup", iconId: "archive", path: pathForSection("backup") },
      { id: "settings", label: "Settings", iconId: "gear", path: pathForSection("settings") }
    ]
  }
];

/** The player's sidebar: the same structure and words, minus the Tools group. */
export const PLAYER_SIDEBAR: readonly SidebarGroup[] = [
  { items: [HOME_ITEM] },
  { label: "World", items: WORLD_ITEMS },
  { label: "Campaign", items: CAMPAIGN_ITEMS }
];

/** What the codex top bar calls the section it is showing. */
export const SECTION_TITLE: Readonly<Record<CodexSection, string>> = {
  home: "Home", pages: "Pages", atlas: "Atlas", graph: "Graph",
  sessions: "Sessions", quests: "Quests", journal: "Journal", calendar: "Calendar", downtime: "Downtime",
  tags: "Tag", audit: "Reveal audit", backup: "Backup", settings: "Settings"
};

// ----- Jump targets -----

export const pagePath = (id: string) => `${CODEX_ROOT}/pages/${id}`;
/** `/codex/atlas/:mapId?pin=:markerId`: the map, then the pin selected. */
export const atlasPath = (mapId: string | null, markerId?: string | null) =>
  withQuery(mapId ? `${CODEX_ROOT}/atlas/${mapId}` : `${CODEX_ROOT}/atlas`, { pin: markerId ?? null });
/** `/codex/journal?entry=:id`: the entry focused. */
export const journalEntryPath = (entryId: string) => withQuery(`${CODEX_ROOT}/journal`, { entry: entryId });
export const sessionPath = (id: string) => `${CODEX_ROOT}/sessions/${id}`;
export const questPath = (id: string) => `${CODEX_ROOT}/quests/${id}`;
export const graphPath = (focusPageId?: string | null) => withQuery(`${CODEX_ROOT}/graph`, { focus: focusPageId ?? null });
export const tagPath = (tag: string) => `${CODEX_ROOT}/tags/${encodeURIComponent(tag)}`;

/** Where a search hit opens, shared by every result list. */
export function pathForHit(hit: CodexSearchHit): string {
  switch (hit.kind) {
    case "page": return pagePath(hit.id);
    case "map": return atlasPath(hit.id);
    // A map-less pin still works: the Atlas resolves its map via `GET /codex/markers/{id}`.
    case "marker": return atlasPath(hit.mapId, hit.id);
    case "journal": return journalEntryPath(hit.id);
    case "quest": return questPath(hit.id);
    case "session": return sessionPath(hit.id);
  }
}
