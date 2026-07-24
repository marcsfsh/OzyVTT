import type { CodexBacklinkRow, CodexPageRow, CodexPageSummaryRow } from "./codex-store.js";

/**
 * The codex viewer-safety boundary. Two-layer pages carry a player-facing body AND a GM-secret body;
 * players must only ever receive `playerBody` of REVEALED pages, never `gmBody` and never an unrevealed
 * page. This module is the single audited choke point - every player-facing codex read projects through
 * these functions, which destructure the GM-only fields away (the same discipline `projections.ts` uses
 * for actor `notes`). Do the stripping here, never in the store or the router.
 */

/** A page as the GM sees it - everything, both bodies. */
export type GmCodexPage = CodexPageRow;

/** A page as a player sees it: the player body only, no `gmBody`, no `rev`, and only when revealed. */
export type PlayerCodexPage = Readonly<{
  id: string;
  title: string;
  folder: string | null;
  tags: readonly string[];
  body: string;
  bannerAssetId: string | null;
  updatedAt: string;
}>;

export type GmCodexPageSummary = CodexPageSummaryRow;
export type PlayerCodexPageSummary = Readonly<{
  id: string;
  title: string;
  folder: string | null;
  tags: readonly string[];
  bannerAssetId: string | null;
  updatedAt: string;
}>;

export type CodexBacklink = Readonly<{ sourcePageId: string; sourceTitle: string; section: string | null }>;

export function projectGmPage(row: CodexPageRow): GmCodexPage {
  return row;
}

/** null when the page is not revealed to players; otherwise the player-facing projection (no gmBody). */
export function projectPlayerPage(row: CodexPageRow): PlayerCodexPage | null {
  if (!row.revealedToPlayers) return null;
  // Explicit destructure-and-omit: gmBody and rev never enter the returned object.
  return { id: row.id, title: row.title, folder: row.folder, tags: row.tags, body: row.playerBody, bannerAssetId: row.bannerAssetId, updatedAt: row.updatedAt };
}

export function projectGmPageSummary(row: CodexPageSummaryRow): GmCodexPageSummary {
  return row;
}

export function projectPlayerPageSummary(row: CodexPageSummaryRow): PlayerCodexPageSummary | null {
  if (!row.revealedToPlayers) return null;
  return { id: row.id, title: row.title, folder: row.folder, tags: row.tags, bannerAssetId: row.bannerAssetId, updatedAt: row.updatedAt };
}

export function projectGmBacklinks(rows: readonly CodexBacklinkRow[]): CodexBacklink[] {
  return rows.map((row) => ({ sourcePageId: row.sourcePageId, sourceTitle: row.sourceTitle, section: row.section }));
}

/**
 * A player sees a backlink only when it came from the player-facing body of a page THEY can see - so a
 * GM-body reference, or a reference from a still-secret page, never reveals that a hidden page points here.
 */
export function projectPlayerBacklinks(rows: readonly CodexBacklinkRow[]): CodexBacklink[] {
  return rows
    .filter((row) => row.layer === "player" && row.sourceRevealed)
    .map((row) => ({ sourcePageId: row.sourcePageId, sourceTitle: row.sourceTitle, section: row.section }));
}
