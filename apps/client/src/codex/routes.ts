/**
 * D1/D3 — the Codex's address space and its sidebar, in one place.
 *
 * The 5-mode tab bar, the 9-button ops row and the four hidden "destination" overlays are retired; every
 * surface is now an address, and the sidebar is the one list of them. This module owns the mapping in
 * both directions so nothing else has to know the string shapes: `CodexShell` renders by
 * `codexSectionOf`, the palette navigates by `CODEX_SECTIONS`, and every jump builds its target here.
 *
 * Deliberately data, not JSX: `SidebarNav` is role-blind and takes item lists, so the GM and player
 * shells differ by which of these constants they pass and by nothing else.
 */

import type { CodexSearchHit } from "./api";
import { withQuery } from "../router";

export type CodexSection =
  | "home" | "pages" | "atlas" | "graph"
  | "sessions" | "quests" | "journal" | "calendar" | "downtime"
  | "tags" | "audit" | "backup" | "settings";

export const CODEX_ROOT = "/codex";

/** The one place a section's address is written. `/codex` is Home; everything else is a child. */
export function pathForSection(section: CodexSection): string {
  return section === "home" ? CODEX_ROOT : `${CODEX_ROOT}/${section}`;
}

/**
 * Which section an address renders, or null when the address is not in the Codex at all.
 * An unknown child of `/codex` is null too — the shell then shows the not-found view (invariant §3.2:
 * an address must never confirm that a surface exists).
 */
export function codexSectionOf(segments: readonly string[]): CodexSection | null {
  if (segments[0] !== "codex") return null;
  if (segments.length === 1) return "home";
  const candidate = segments[1] as CodexSection;
  return (CODEX_SECTION_IDS as readonly string[]).includes(candidate) ? candidate : null;
}

const CODEX_SECTION_IDS: readonly CodexSection[] = [
  "pages", "atlas", "graph", "sessions", "quests", "journal", "calendar", "downtime", "tags", "audit", "backup", "settings"
];

/** The record id inside a section address (`/codex/pages/:id`), or null when the list itself is open. */
export function recordIdOf(segments: readonly string[]): string | null {
  return segments.length >= 3 ? segments[2] : null;
}

// ----- The sidebar (D1, exact labels from the glossary) -----

export type SidebarItem = Readonly<{
  /** `path` navigates; `action` runs (Preview as player is the one action in the list). */
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

/** The player's sidebar: **the same structure and the same words**, minus the Tools group (D1/D14). */
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

// ----- Prepared-destination jumps, as addresses (intake strength #1, preserved) -----

/** `/codex/pages/:id` — the page open. */
export const pagePath = (id: string) => `${CODEX_ROOT}/pages/${id}`;
/** `/codex/atlas/:mapId?pin=:markerId` — the map open, then the pin selected. Both halves travel. */
export const atlasPath = (mapId: string | null, markerId?: string | null) =>
  withQuery(mapId ? `${CODEX_ROOT}/atlas/${mapId}` : `${CODEX_ROOT}/atlas`, { pin: markerId ?? null });
/** `/codex/journal?entry=:id` — the entry focused and marked. */
export const journalEntryPath = (entryId: string) => withQuery(`${CODEX_ROOT}/journal`, { entry: entryId });
export const sessionPath = (id: string) => `${CODEX_ROOT}/sessions/${id}`;
export const questPath = (id: string) => `${CODEX_ROOT}/quests/${id}`;
export const graphPath = (focusPageId?: string | null) => withQuery(`${CODEX_ROOT}/graph`, { focus: focusPageId ?? null });
export const tagPath = (tag: string) => `${CODEX_ROOT}/tags/${encodeURIComponent(tag)}`;

/**
 * Where a search hit opens. One table, so the rail, the palette and every other result list land on the
 * same address for the same record — the strength intake #1 recorded, now expressed as URLs.
 */
export function pathForHit(hit: CodexSearchHit): string {
  switch (hit.kind) {
    case "page": return pagePath(hit.id);
    case "map": return atlasPath(hit.id);
    // A hit normally names the pin's map. When it does not, the Atlas resolves it through
    // `GET /codex/markers/{id}` — which is why a map-less pin still travels.
    case "marker": return atlasPath(hit.mapId, hit.id);
    case "journal": return journalEntryPath(hit.id);
    case "quest": return questPath(hit.id);
    case "session": return sessionPath(hit.id);
  }
}
