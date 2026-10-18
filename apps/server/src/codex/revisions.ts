import type {
  CodexEntityType,
  CodexPageRevision,
  CodexRevisionHistorySettings,
  CodexRevisionHistoryUsage
} from "@vtt/domain";
import { blockContents, parseBlocks, type StoredBlock } from "./blocks.js";
import type { CodexDb } from "./db.js";
import { CodexValidationError, MAX_PRUNE_DAYS, parseFields, parseStringArray } from "./validate.js";

/**
 * Page history (`codex_page_revisions`). A save checkpoints the state it replaces, at most once per window, so
 * the newest revision is a real undo. Restoring writes a past revision forward as a new save.
 */

/** A revision as the backup carries it: the wire row plus what a restore needs. */
export type CodexPageRevisionExportRow = CodexPageRevision &
  Readonly<{
    entityType: CodexEntityType;
    fields: Readonly<Record<string, string>>;
    hiddenFields: readonly string[];
  }>;
/**
 * The content a restore writes back. The in-world date is not part of it, so chronicle placement stays, and nor
 * is any audience: a revision is content, and a restore never shows players anything new.
 */
export type CodexRevisionContent = Pick<
  CodexPageRevisionExportRow,
  "title" | "entityType" | "fields" | "hiddenFields" | "playerBody" | "blocks" | "bannerAssetId" | "tags"
>;

const REVISION_COLUMNS =
  "id, page_id, rev, title, entity_type, fields_json, hidden_fields_json, player_body, blocks_json, banner_asset_id, tags_json, authored_at, author_tag";
type RevisionRowRaw = {
  id: number;
  page_id: string;
  rev: number;
  title: string;
  entity_type: string;
  fields_json: string;
  hidden_fields_json: string;
  player_body: string;
  blocks_json: string;
  banner_asset_id: string | null;
  tags_json: string;
  authored_at: string;
  author_tag: string;
};

function toRevision(row: RevisionRowRaw): CodexPageRevision {
  return {
    id: row.id,
    pageId: row.page_id,
    rev: row.rev,
    title: row.title,
    playerBody: row.player_body,
    blocks: blockContents(parseBlocks(row.blocks_json)),
    bannerAssetId: row.banner_asset_id,
    tags: parseStringArray(row.tags_json),
    authoredAt: row.authored_at,
    authorTag: row.author_tag
  };
}
function toExportRevision(row: RevisionRowRaw): CodexPageRevisionExportRow {
  return {
    ...toRevision(row),
    entityType: row.entity_type as CodexEntityType,
    fields: parseFields(row.fields_json),
    hiddenFields: parseStringArray(row.hidden_fields_json)
  };
}

/** Leaf write of one revision row; a restored backup keeps its ids so revision URLs survive. */
export function insertRevision(
  db: CodexDb,
  revision: Omit<CodexPageRevisionExportRow, "id"> & Readonly<{ id?: number }>
): void {
  db.database
    .prepare(`INSERT INTO codex_page_revisions (${REVISION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      revision.id ?? null,
      revision.pageId,
      revision.rev,
      revision.title,
      revision.entityType,
      JSON.stringify(revision.fields),
      JSON.stringify(revision.hiddenFields),
      revision.playerBody,
      JSON.stringify(revision.blocks),
      revision.bannerAssetId,
      JSON.stringify(revision.tags),
      revision.authoredAt,
      revision.authorTag
    );
}

/** A page's state as a revision keeps it. */
export type CodexRevisionSource = Readonly<{
  id: string;
  rev: number;
  title: string;
  entityType: CodexEntityType;
  fields: Readonly<Record<string, string>>;
  hiddenFields: readonly string[];
  playerBody: string;
  blocks: readonly StoredBlock[];
  bannerAssetId: string | null;
  tags: readonly string[];
  updatedAt: string;
}>;

/** Leaf write: checkpoint a page's stored state. `authoredAt` is when that content was written. */
export function snapshotRevision(db: CodexDb, page: CodexRevisionSource, authorTag: string): void {
  insertRevision(db, {
    pageId: page.id,
    rev: page.rev,
    title: page.title,
    entityType: page.entityType,
    fields: page.fields,
    hiddenFields: page.hiddenFields,
    playerBody: page.playerBody,
    blocks: blockContents(page.blocks),
    bannerAssetId: page.bannerAssetId,
    tags: page.tags,
    authoredAt: page.updatedAt,
    authorTag
  });
}

/**
 * Whether a save should checkpoint. It skips while the newest checkpoint's content is younger than the window,
 * so at most `windowMinutes` of work can be lost. `force` bypasses the window but never the switch.
 */
export function revisionDue(
  db: CodexDb,
  pageId: string,
  settings: CodexRevisionHistorySettings,
  force: boolean
): boolean {
  // Disabled history writes nothing new but deletes nothing; existing revisions stay restorable.
  if (!settings.enabled) return false;
  if (force) return true;
  const newest = (
    db.database
      .prepare("SELECT MAX(authored_at) AS newest FROM codex_page_revisions WHERE page_id = ?")
      .get(pageId) as {
      newest: string | null;
    }
  ).newest;
  // No checkpoint at all: there is no previous version to coalesce into.
  if (newest === null) return true;
  const age = db.now() - Date.parse(newest);
  // Write unless the newest checkpoint is provably recent; an unparseable or future stamp also writes, since an
  // extra row is cheaper than lost work.
  return !(age >= 0 && age < settings.windowMinutes * 60_000);
}

/** Avoids checkpointing the same `(page, rev)` state twice. */
export function revisionExistsAt(db: CodexDb, pageId: string, rev: number): boolean {
  return (
    db.database.prepare("SELECT 1 FROM codex_page_revisions WHERE page_id = ? AND rev = ? LIMIT 1").get(pageId, rev) !==
    undefined
  );
}

/** One page's history, newest first, as the wire row. */
export function listRevisions(db: CodexDb, pageId: string): CodexPageRevision[] {
  return (
    db.database
      .prepare(`SELECT ${REVISION_COLUMNS} FROM codex_page_revisions WHERE page_id = ? ORDER BY rev DESC`)
      .all(pageId) as RevisionRowRaw[]
  ).map(toRevision);
}

/** Every revision, for the backup. */
export function listAllRevisions(db: CodexDb): CodexPageRevisionExportRow[] {
  return (
    db.database
      .prepare(`SELECT ${REVISION_COLUMNS} FROM codex_page_revisions ORDER BY page_id, rev`)
      .all() as RevisionRowRaw[]
  ).map(toExportRevision);
}

export function revisionContent(db: CodexDb, pageId: string, revisionId: number): CodexRevisionContent | null {
  const row = db.database
    .prepare(`SELECT ${REVISION_COLUMNS} FROM codex_page_revisions WHERE id = ? AND page_id = ?`)
    .get(revisionId, pageId) as RevisionRowRaw | undefined;
  return row ? toExportRevision(row) : null;
}

/** Leaf delete of revisions authored at least `olderThanDays` ago (`<=`, so 0 deletes all). Returns the count. */
export function deleteRevisionsOlderThan(db: CodexDb, olderThanDays: number): number {
  if (!Number.isInteger(olderThanDays) || olderThanDays < 0 || olderThanDays > MAX_PRUNE_DAYS)
    throw new CodexValidationError(`Choose a whole number of days from 0 to ${MAX_PRUNE_DAYS}.`);
  const cutoff = new Date(db.now() - olderThanDays * 86_400_000).toISOString();
  return Number(db.database.prepare("DELETE FROM codex_page_revisions WHERE authored_at <= ?").run(cutoff).changes);
}

/** Summed `LENGTH()` (characters) of the content columns a revision copies. */
export function revisionHistoryUsage(db: CodexDb): CodexRevisionHistoryUsage {
  const row = db.database
    .prepare(
      `SELECT COUNT(*) AS version_count,
              COALESCE(SUM(LENGTH(title) + LENGTH(player_body) + LENGTH(blocks_json) + LENGTH(fields_json) + LENGTH(hidden_fields_json) + LENGTH(tags_json)), 0) AS version_bytes
       FROM codex_page_revisions`
    )
    .get() as { version_count: number; version_bytes: number };
  return { versionCount: row.version_count, versionBytes: row.version_bytes };
}
