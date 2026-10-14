import { pruneCodexFields, type CodexEntityType, type CodexInWorldDate } from "@vtt/domain";
import { transaction } from "../database.js";
import { resolveDate } from "./calendar.js";
import { bumpRevision, freshId, stamp, write, type CodexDb } from "./db.js";
import { rebuildLinks, scrubLinks } from "./links.js";
import { revisionContent, revisionDue, revisionExistsAt, snapshotRevision } from "./revisions.js";
import { indexPage, unindex } from "./search.js";
import { revisionSettings } from "./settings.js";
import {
  CodexNotFoundError,
  CodexRevisionConflictError,
  CodexValidationError,
  body,
  entityFields,
  entityType,
  folder,
  id,
  isId,
  parseFields,
  parseStringArray,
  sealSecretFields,
  tags,
  title
} from "./validate.js";

/** Wiki pages (`codex_pages`) and the folder records that keep an empty folder alive (`codex_folders`). */

export type CodexPageRow = Readonly<{
  id: string;
  title: string;
  entityType: CodexEntityType;
  /** Type-specific attributes; player-facing once the page is revealed. */
  fields: Readonly<Record<string, string>>;
  /** GM-only attributes; never projected to players, like `gmBody`. */
  gmFields: Readonly<Record<string, string>>;
  folder: string | null;
  tags: readonly string[];
  playerBody: string;
  gmBody: string;
  revealedToPlayers: boolean;
  bannerAssetId: string | null;
  /** `inWorldDate` is the source of truth; the instant and label derive from it. Any type keeps them, so a type switch is lossless. */
  inWorldLabel: string | null;
  calendarInstant: number | null;
  inWorldDate: CodexInWorldDate | null;
  rev: number;
  createdAt: string;
  updatedAt: string;
}>;
export type CodexPageSummaryRow = Omit<CodexPageRow, "playerBody" | "gmBody" | "gmFields">;
export type CodexPageCreateInput = Readonly<{
  title: string;
  entityType?: CodexEntityType;
  fields?: Readonly<Record<string, string>>;
  gmFields?: Readonly<Record<string, string>>;
  folder?: string | null;
  tags?: readonly string[];
  playerBody?: string;
  gmBody?: string;
  revealedToPlayers?: boolean;
  bannerAssetId?: string | null;
  /** The raw in-world date. `null` clears it; omitted leaves it alone. */
  inWorldDate?: CodexInWorldDate | null;
}>;
/** No `revealedToPlayers`: reveal has its own route. */
export type CodexPageUpdateInput = Omit<CodexPageCreateInput, "title" | "revealedToPlayers"> &
  Readonly<{ title?: string }>;

const SUMMARY_COLUMNS =
  "id, title, entity_type, fields_json, folder, tags_json, revealed, banner_asset_id, in_world_year, in_world_month, in_world_day, in_world_label, calendar_instant, rev, created_at, updated_at";
const PAGE_COLUMNS = `${SUMMARY_COLUMNS}, gm_fields_json, player_body, gm_body`;
type SummaryRowRaw = {
  id: string;
  title: string;
  entity_type: string;
  fields_json: string;
  folder: string | null;
  tags_json: string;
  revealed: number;
  banner_asset_id: string | null;
  in_world_year: number | null;
  in_world_month: number | null;
  in_world_day: number | null;
  in_world_label: string | null;
  calendar_instant: number | null;
  rev: number;
  created_at: string;
  updated_at: string;
};
type PageRowRaw = SummaryRowRaw & { gm_fields_json: string; player_body: string; gm_body: string };

function toSummary(row: SummaryRowRaw): CodexPageSummaryRow {
  return {
    id: row.id,
    title: row.title,
    entityType: row.entity_type as CodexEntityType,
    fields: parseFields(row.fields_json),
    folder: row.folder,
    tags: parseStringArray(row.tags_json),
    revealedToPlayers: row.revealed === 1,
    bannerAssetId: row.banner_asset_id,
    inWorldLabel: row.in_world_label,
    calendarInstant: row.calendar_instant,
    // All three parts or none.
    inWorldDate:
      row.in_world_year !== null && row.in_world_month !== null && row.in_world_day !== null
        ? { year: row.in_world_year, month: row.in_world_month, day: row.in_world_day }
        : null,
    rev: row.rev,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function toPage(row: PageRowRaw): CodexPageRow {
  return {
    ...toSummary(row),
    gmFields: parseFields(row.gm_fields_json),
    playerBody: row.player_body,
    gmBody: row.gm_body
  };
}

/** Fields are pruned to the type, so a page never holds values its type cannot show, and secrets are sealed. */
function sealedFields(
  type: CodexEntityType,
  fields: Readonly<Record<string, string>>,
  gmFields: Readonly<Record<string, string>>
) {
  return sealSecretFields(pruneCodexFields(type, fields), pruneCodexFields(type, gmFields));
}

/** Leaf write of a whole page row (create and restore); its links, index row and folder records follow. */
export function insertPage(db: CodexDb, page: CodexPageRow): void {
  db.database
    .prepare(
      `INSERT INTO codex_pages (${PAGE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      page.id,
      page.title,
      page.entityType,
      JSON.stringify(page.fields),
      page.folder,
      JSON.stringify(page.tags),
      page.revealedToPlayers ? 1 : 0,
      page.bannerAssetId,
      page.inWorldDate?.year ?? null,
      page.inWorldDate?.month ?? null,
      page.inWorldDate?.day ?? null,
      page.inWorldLabel,
      page.calendarInstant,
      page.rev,
      page.createdAt,
      page.updatedAt,
      JSON.stringify(page.gmFields),
      page.playerBody,
      page.gmBody
    );
  rebuildLinks(db, "page", page.id, page.playerBody, page.gmBody);
  indexPage(db, page);
  registerFolderPath(db, page.folder, page.createdAt);
}

/** A restored page: fields re-pruned and re-sealed, and its date re-resolved against the restored calendar. */
export function restorePage(db: CodexDb, page: CodexPageRow): void {
  const sealed = sealedFields(page.entityType, page.fields, page.gmFields);
  const dated = resolveDate(db, page.inWorldDate, null);
  insertPage(db, {
    ...page,
    ...sealed,
    inWorldLabel: dated.label,
    calendarInstant: dated.instant,
    inWorldDate: dated.date
  });
}

export function createPage(db: CodexDb, input: CodexPageCreateInput): CodexPageRow {
  const type = entityType(input.entityType);
  const sealed = sealedFields(type, entityFields(input.fields), entityFields(input.gmFields));
  // The same `resolveDate` as journal entries, so a calendar change reflows both by one rule.
  const dated = resolveDate(db, input.inWorldDate, null);
  const now = stamp(db);
  const page: CodexPageRow = {
    id: freshId(),
    title: title(input.title),
    entityType: type,
    fields: sealed.fields,
    gmFields: sealed.gmFields,
    folder: folder(input.folder),
    tags: tags(input.tags),
    playerBody: body(input.playerBody),
    gmBody: body(input.gmBody),
    revealedToPlayers: input.revealedToPlayers === true,
    bannerAssetId: input.bannerAssetId ? id(input.bannerAssetId) : null,
    inWorldLabel: dated.label,
    calendarInstant: dated.instant,
    inWorldDate: dated.date,
    rev: 1,
    createdAt: now,
    updatedAt: now
  };
  write(db, () => {
    insertPage(db, page);
    // Not throttled (a new page has nothing to fall back to), but the history switch still applies.
    if (revisionSettings(db).enabled) snapshotRevision(db, page, "codex:create");
  });
  return getPage(db, page.id)!;
}

/** `forceRevision` is set only by `restoreRevision`, so no request can force a checkpoint. */
export function updatePage(
  db: CodexDb,
  pageId: string,
  input: CodexPageUpdateInput,
  expectedRev: number | undefined,
  authorTag: string,
  forceRevision = false
): CodexPageRow {
  const existing = getPage(db, pageId);
  if (!existing) throw new CodexNotFoundError("That page no longer exists.");
  // Single-writer, last-writer-wins: the message states what happened; the next save resyncs the revision.
  if (expectedRev !== undefined && expectedRev !== existing.rev)
    throw new CodexRevisionConflictError("This page was changed somewhere else after you opened it.");
  const nextType = input.entityType === undefined ? existing.entityType : entityType(input.entityType);
  const typeChanged = nextType !== existing.entityType;
  // Re-sealed and re-pruned whenever fields or the type change, so a secret never rests in `fields` and a type
  // switch cannot leave hidden values on a revealed page. Pruned values stay in revision history.
  const sealed =
    input.fields !== undefined || input.gmFields !== undefined || typeChanged
      ? sealedFields(
          nextType,
          input.fields === undefined ? existing.fields : entityFields(input.fields),
          input.gmFields === undefined ? existing.gmFields : entityFields(input.gmFields)
        )
      : { fields: existing.fields, gmFields: existing.gmFields };
  // Omitted `inWorldDate` keeps the stored date and `null` clears it: the editor PATCHes whole drafts.
  const dated = input.inWorldDate !== undefined ? resolveDate(db, input.inWorldDate, null) : null;
  const next: CodexPageRow = {
    ...existing,
    title: input.title === undefined ? existing.title : title(input.title),
    entityType: nextType,
    fields: sealed.fields,
    gmFields: sealed.gmFields,
    folder: input.folder === undefined ? existing.folder : folder(input.folder),
    tags: input.tags === undefined ? existing.tags : tags(input.tags),
    playerBody: input.playerBody === undefined ? existing.playerBody : body(input.playerBody),
    gmBody: input.gmBody === undefined ? existing.gmBody : body(input.gmBody),
    bannerAssetId:
      input.bannerAssetId === undefined ? existing.bannerAssetId : input.bannerAssetId ? id(input.bannerAssetId) : null,
    inWorldLabel: dated ? dated.label : existing.inWorldLabel,
    calendarInstant: dated ? dated.instant : existing.calendarInstant,
    inWorldDate: dated ? dated.date : existing.inWorldDate,
    rev: existing.rev + 1,
    updatedAt: stamp(db)
  };
  write(db, () => {
    db.database
      .prepare(
        "UPDATE codex_pages SET title = ?, entity_type = ?, fields_json = ?, gm_fields_json = ?, folder = ?, tags_json = ?, player_body = ?, gm_body = ?, banner_asset_id = ?, in_world_year = ?, in_world_month = ?, in_world_day = ?, in_world_label = ?, calendar_instant = ?, rev = ?, updated_at = ? WHERE id = ?"
      )
      .run(
        next.title,
        next.entityType,
        JSON.stringify(next.fields),
        JSON.stringify(next.gmFields),
        next.folder,
        JSON.stringify(next.tags),
        next.playerBody,
        next.gmBody,
        next.bannerAssetId,
        next.inWorldDate?.year ?? null,
        next.inWorldDate?.month ?? null,
        next.inWorldDate?.day ?? null,
        next.inWorldLabel,
        next.calendarInstant,
        next.rev,
        next.updatedAt,
        pageId
      );
    rebuildLinks(db, "page", pageId, next.playerBody, next.gmBody);
    indexPage(db, next);
    registerFolderPath(db, next.folder, next.updatedAt);
    // Checkpoint the state being replaced (throttled). Restores and type changes force one, since both discard
    // content; `revisionExistsAt` prevents duplicates.
    if (
      revisionDue(db, pageId, revisionSettings(db), forceRevision || typeChanged) &&
      !revisionExistsAt(db, pageId, existing.rev)
    )
      snapshotRevision(db, existing, authorTag);
  });
  return getPage(db, pageId)!;
}

/** Writes a past revision forward as a new save, checkpointing the state it discards so the restore can be undone. */
export function restoreRevision(db: CodexDb, pageId: string, revisionId: number, authorTag: string): CodexPageRow {
  const content = revisionContent(db, pageId, revisionId);
  if (!content) throw new CodexNotFoundError("That revision no longer exists.");
  return updatePage(db, pageId, content, undefined, authorTag, true);
}

/** Revealing is not editing: `updatedAt` stays, though the Codex revision still bumps. */
export function setPageRevealed(db: CodexDb, pageId: string, revealed: boolean): CodexPageRow {
  if (!getPage(db, pageId)) throw new CodexNotFoundError("That page no longer exists.");
  write(db, () => {
    db.database.prepare("UPDATE codex_pages SET revealed = ? WHERE id = ?").run(revealed ? 1 : 0, pageId);
  });
  return getPage(db, pageId)!;
}

/** Leaf delete; the revisions cascade. References to the page from other records are cleared by the caller. */
export function deletePage(db: CodexDb, pageId: string): void {
  unindex(db, "page", pageId);
  scrubLinks(db, "page", pageId);
  db.database.prepare("DELETE FROM codex_pages WHERE id = ?").run(pageId);
}

/** A connection edit moves both pages' recency but not `rev`, so open editors do not conflict. */
export function touchPages(db: CodexDb, pageIds: readonly string[], at: string): void {
  const update = db.database.prepare("UPDATE codex_pages SET updated_at = ? WHERE id = ?");
  for (const pageId of pageIds) update.run(at, pageId);
}

export function getPage(db: CodexDb, pageId: string): CodexPageRow | null {
  if (!isId(pageId)) return null;
  const row = db.database.prepare(`SELECT ${PAGE_COLUMNS} FROM codex_pages WHERE id = ?`).get(pageId) as
    PageRowRaw | undefined;
  return row ? toPage(row) : null;
}

export function listPages(
  db: CodexDb,
  filter?: Readonly<{ folder?: string | null; tag?: string }>
): CodexPageSummaryRow[] {
  return (
    db.database
      .prepare(`SELECT ${SUMMARY_COLUMNS} FROM codex_pages ORDER BY title COLLATE NOCASE`)
      .all() as SummaryRowRaw[]
  )
    .map(toSummary)
    .filter(
      (page) =>
        (filter?.folder === undefined || page.folder === filter.folder) &&
        (filter?.tag === undefined || page.tags.includes(filter.tag))
    );
}

/** Every page with both bodies, for the backup. */
export function listFullPages(db: CodexDb): CodexPageRow[] {
  return (
    db.database.prepare(`SELECT ${PAGE_COLUMNS} FROM codex_pages ORDER BY title COLLATE NOCASE`).all() as PageRowRaw[]
  ).map(toPage);
}

/** Dated `event` pages. Filtering on type rather than clearing dates keeps a type switch lossless. */
export function listDatedEventPages(db: CodexDb): CodexPageRow[] {
  return (
    db.database
      .prepare(
        `SELECT ${PAGE_COLUMNS} FROM codex_pages WHERE entity_type = 'event' AND calendar_instant IS NOT NULL ORDER BY calendar_instant, created_at`
      )
      .all() as PageRowRaw[]
  ).map(toPage);
}

// Folders: a page carries its own path; a folder record lets an empty folder persist.

/** Every explicitly created folder path. The tree unions these with the paths pages carry. */
export function listFolders(db: CodexDb): string[] {
  return (
    db.database.prepare("SELECT path FROM codex_folders ORDER BY path COLLATE NOCASE").all() as Array<{ path: string }>
  ).map((row) => row.path);
}

/** Leaf write: a path and its ancestors exist as records, so the folder persists once its pages leave. */
export function registerFolderPath(db: CodexDb, path: string | null, at: string): void {
  if (!path) return;
  const insert = db.database.prepare("INSERT OR IGNORE INTO codex_folders (path, created_at) VALUES (?, ?)");
  let prefix = "";
  for (const segment of path.split("/")) {
    prefix = prefix ? `${prefix}/${segment}` : segment;
    insert.run(prefix, at);
  }
}

/** Creates (or keeps) a folder that persists with no pages in it. Returns the normalized path. */
export function createFolder(db: CodexDb, path: string): string {
  const clean = folder(path);
  if (!clean) throw new CodexValidationError("Name the folder.");
  write(db, () => {
    db.database.prepare("INSERT OR IGNORE INTO codex_folders (path, created_at) VALUES (?, ?)").run(clean, stamp(db));
  });
  return clean;
}

/** Re-paths a folder subtree. Filing is not editing: no snapshot and no `updatedAt`; `rev` bumps for open editors. */
export function moveFolder(db: CodexDb, fromPath: string, toPath: string): number {
  const from = folder(fromPath);
  if (!from) throw new CodexValidationError("Choose a folder to move.");
  const to = folder(toPath);
  if (to !== null && (to === from || to.startsWith(`${from}/`)))
    throw new CodexValidationError("Can't move a folder into itself.");
  // `folder()` re-validates the new path's depth and length, and turns "" (the top level) into null.
  const repath = (value: string): string | null =>
    folder(value === from ? (to ?? "") : to === null ? value.slice(from.length + 1) : to + value.slice(from.length));
  // A move that finds nothing writes nothing, so it leaves the revision (and every ETag) alone.
  return transaction(db.database, () => {
    const now = stamp(db);
    const pages = db.database
      .prepare("SELECT id, folder FROM codex_pages WHERE folder = ? OR folder LIKE ?")
      .all(from, `${from}/%`) as Array<{ id: string; folder: string }>;
    const update = db.database.prepare("UPDATE codex_pages SET folder = ?, rev = rev + 1 WHERE id = ?");
    for (const page of pages) update.run(repath(page.folder), page.id);
    const records = db.database
      .prepare("SELECT path FROM codex_folders WHERE path = ? OR path LIKE ?")
      .all(from, `${from}/%`) as Array<{ path: string }>;
    const drop = db.database.prepare("DELETE FROM codex_folders WHERE path = ?");
    const add = db.database.prepare("INSERT OR IGNORE INTO codex_folders (path, created_at) VALUES (?, ?)");
    for (const record of records) {
      drop.run(record.path);
      const next = repath(record.path);
      if (next) add.run(next, now);
    }
    if (pages.length > 0 || records.length > 0) bumpRevision(db);
    return pages.length;
  });
}

/** Pages under the folder move to the top level and are never deleted; `rev` bumps, `updatedAt` does not. */
export function deleteFolder(db: CodexDb, path: string): void {
  const clean = folder(path);
  if (!clean) return;
  write(db, () => {
    db.database
      .prepare("UPDATE codex_pages SET folder = NULL, rev = rev + 1 WHERE folder = ? OR folder LIKE ?")
      .run(clean, `${clean}/%`);
    db.database.prepare("DELETE FROM codex_folders WHERE path = ? OR path LIKE ?").run(clean, `${clean}/%`);
  });
}
