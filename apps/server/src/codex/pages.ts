import {
  codexDefaultHiddenFields,
  codexFieldKeys,
  pruneCodexFields,
  type CodexEntityType,
  type CodexFieldAudience,
  type CodexInWorldDate,
  type CodexPage,
  type CodexPageSummary
} from "@vtt/domain";
import { transaction } from "../database.js";
import {
  addBlock,
  applyLayout,
  audienceReaches,
  clampAnchors,
  editBlock,
  linkSources,
  moveBlock,
  newBlocks,
  parseBlocks,
  rebaseAnchors,
  removeBlock,
  restoreBlocks,
  serializeBlocks,
  setBlockAudience,
  toWireBlocks,
  type CodexBlockInput,
  type CodexBlockPlacement,
  type StampReader,
  type StoredBlock
} from "./blocks.js";
import { getCalendar, resolveDate } from "./calendar.js";
import { bumpRevision, freshId, stamp, write, type CodexDb } from "./db.js";
import { pendingFlag } from "./first-shown.js";
import { rebuildLinksFrom, scrubLinks } from "./links.js";
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
  fieldAudience,
  folder,
  hiddenFieldKeys,
  id,
  isId,
  parseFields,
  parseStringArray,
  slot,
  tags,
  title
} from "./validate.js";

/** Wiki pages (`codex_pages`) and the folder records that keep an empty folder alive (`codex_folders`). */

export type CodexPageCreateInput = Readonly<{
  title: string;
  entityType?: CodexEntityType;
  /** Every field value, whatever its audience. */
  fields?: Readonly<Record<string, string>>;
  /** Omitted: the kind's default-hidden keys. */
  hiddenFields?: readonly string[];
  folder?: string | null;
  tags?: readonly string[];
  playerBody?: string;
  /** Created hidden. */
  blocks?: readonly CodexBlockInput[];
  revealedToPlayers?: boolean;
  bannerAssetId?: string | null;
  /** The raw in-world date. `null` clears it; omitted leaves it alone. */
  inWorldDate?: CodexInWorldDate | null;
}>;
/** No reveal flag, field audiences or block content: each has its own write. */
export type CodexPageUpdateInput = Readonly<{
  title?: string;
  entityType?: CodexEntityType;
  fields?: Readonly<Record<string, string>>;
  folder?: string | null;
  tags?: readonly string[];
  playerBody?: string;
  bannerAssetId?: string | null;
  inWorldDate?: CodexInWorldDate | null;
  /** Every block, in document order, with its anchor; applied after `playerBody`. */
  layout?: readonly CodexBlockPlacement[];
}>;

/** A page as the store holds it: the wire row with its blocks as stored. */
export type CodexPageRecord = Omit<CodexPage, "blocks"> & Readonly<{ blocks: readonly StoredBlock[] }>;

const SUMMARY_COLUMNS =
  "id, title, entity_type, fields_json, hidden_fields_json, folder, tags_json, revealed, banner_asset_id, in_world_year, in_world_month, in_world_day, in_world_label, calendar_instant, rev, created_at, updated_at, player_updated_at, character_updated_at_json, first_shown_at";
const PAGE_COLUMNS = `${SUMMARY_COLUMNS}, player_body, blocks_json`;
type SummaryRowRaw = {
  id: string;
  title: string;
  entity_type: string;
  fields_json: string;
  hidden_fields_json: string;
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
  player_updated_at: string;
  character_updated_at_json: string;
  first_shown_at: string | null;
};
type PageRowRaw = SummaryRowRaw & { player_body: string; blocks_json: string };

function toSummary(row: SummaryRowRaw): CodexPageSummary {
  return {
    id: row.id,
    title: row.title,
    entityType: row.entity_type as CodexEntityType,
    fields: parseFields(row.fields_json),
    hiddenFields: parseStringArray(row.hidden_fields_json),
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
    updatedAt: row.updated_at,
    playerUpdatedAt: row.player_updated_at,
    characterUpdatedAt: parseFields(row.character_updated_at_json),
    firstShownAt: row.first_shown_at
  };
}
function toRecord(row: PageRowRaw): CodexPageRecord {
  return { ...toSummary(row), playerBody: row.player_body, blocks: parseBlocks(row.blocks_json) };
}

/** What labels block stamps as they are read: the live calendar and every session's current number. */
export function stampReader(db: CodexDb): StampReader {
  const sessions = db.database.prepare("SELECT id, session_number FROM codex_sessions").all() as Array<{
    id: string;
    session_number: number | null;
  }>;
  return { calendar: getCalendar(db), sessionNumbers: new Map(sessions.map((row) => [row.id, row.session_number])) };
}
export function toWirePage(record: CodexPageRecord, reader: StampReader): CodexPage {
  return { ...record, blocks: toWireBlocks(record.blocks, reader) };
}

/** Leaf write of a whole page row (create and restore); its links, index row and folder records follow. */
export function insertPage(db: CodexDb, page: CodexPageRecord): void {
  const blocksJson = serializeBlocks(page.blocks);
  db.database
    .prepare(
      `INSERT INTO codex_pages (${PAGE_COLUMNS}, blocks_pending) VALUES (${Array.from({ length: 23 }, () => "?").join(", ")})`
    )
    .run(
      page.id,
      page.title,
      page.entityType,
      JSON.stringify(page.fields),
      JSON.stringify(page.hiddenFields),
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
      page.playerUpdatedAt,
      JSON.stringify(page.characterUpdatedAt),
      page.firstShownAt,
      page.playerBody,
      blocksJson,
      pendingFlag(blocksJson)
    );
  derive(db, page);
  registerFolderPath(db, page.folder, page.createdAt);
}

/** The rows that follow a page's text and audiences: its mentions and its search rows. */
function derive(db: CodexDb, page: CodexPageRecord): void {
  rebuildLinksFrom(db, "page", page.id, linkSources(page.playerBody, page.blocks));
  indexPage(db, page);
}

/** A restored page: fields re-pruned, blocks placed in its text, and its date re-resolved against the restored calendar. */
export function restorePage(db: CodexDb, page: CodexPageRecord): void {
  const dated = resolveDate(db, page.inWorldDate, null);
  insertPage(db, {
    ...page,
    fields: pruneCodexFields(page.entityType, page.fields),
    hiddenFields: hiddenFieldKeys(page.entityType, page.hiddenFields),
    blocks: clampAnchors(page.blocks, page.playerBody),
    inWorldLabel: dated.label,
    calendarInstant: dated.instant,
    inWorldDate: dated.date
  });
}

export function createPage(db: CodexDb, input: CodexPageCreateInput): CodexPage {
  const type = entityType(input.entityType);
  // The same `resolveDate` as journal entries, so a calendar change reflows both by one rule.
  const dated = resolveDate(db, input.inWorldDate, null);
  const playerBody = body(input.playerBody);
  const now = stamp(db);
  const page: CodexPageRecord = {
    id: freshId(),
    title: title(input.title),
    entityType: type,
    fields: pruneCodexFields(type, entityFields(input.fields)),
    hiddenFields: hiddenFieldKeys(type, input.hiddenFields ?? codexDefaultHiddenFields(type)),
    folder: folder(input.folder),
    tags: tags(input.tags),
    playerBody,
    blocks: newBlocks(input.blocks ?? [], playerBody),
    revealedToPlayers: input.revealedToPlayers === true,
    bannerAssetId: input.bannerAssetId ? id(input.bannerAssetId) : null,
    inWorldLabel: dated.label,
    calendarInstant: dated.instant,
    inWorldDate: dated.date,
    rev: 1,
    createdAt: now,
    updatedAt: now,
    playerUpdatedAt: now,
    characterUpdatedAt: {},
    // The write dates it if it is created revealed.
    firstShownAt: null
  };
  write(db, () => {
    insertPage(db, page);
    // Not throttled (a new page has nothing to fall back to), but the history switch still applies.
    if (revisionSettings(db).enabled) snapshotRevision(db, page, "codex:create");
  });
  return getPage(db, page.id)!;
}

/** The stored page, refusing a missing one and, when `expectedRev` is given, a stale copy. */
function existingPage(db: CodexDb, pageId: string, expectedRev: number | undefined): CodexPageRecord {
  const existing = readPage(db, pageId);
  if (!existing) throw new CodexNotFoundError("That page no longer exists.");
  // Single-writer, last-writer-wins: the message states what happened; the next save resyncs the revision.
  if (expectedRev !== undefined && expectedRev !== existing.rev)
    throw new CodexRevisionConflictError("This page was changed somewhere else after you opened it.");
  return existing;
}

/** A kind change keeps the audience of the fields both kinds have; a field new to the page starts at its default. */
function hiddenAfterKindChange(hidden: readonly string[], from: CodexEntityType, to: CodexEntityType): string[] {
  const before = codexFieldKeys(from);
  return hiddenFieldKeys(to, [...hidden, ...codexDefaultHiddenFields(to).filter((key) => !before.has(key))]);
}

/** The editor's save. Blocks keep their place by paragraph unless `layout` places them. */
export function updatePage(
  db: CodexDb,
  pageId: string,
  input: CodexPageUpdateInput,
  expectedRev: number | undefined,
  authorTag: string
): CodexPage {
  const existing = existingPage(db, pageId, expectedRev);
  const nextType = input.entityType === undefined ? existing.entityType : entityType(input.entityType);
  const typeChanged = nextType !== existing.entityType;
  // Pruned whenever the fields or the kind change, so a kind switch leaves no value its kind cannot show. Pruned
  // values stay in revision history.
  const fields =
    input.fields !== undefined || typeChanged
      ? pruneCodexFields(nextType, input.fields === undefined ? existing.fields : entityFields(input.fields))
      : existing.fields;
  // Omitted `inWorldDate` keeps the stored date and `null` clears it: the editor PATCHes whole drafts.
  const dated = input.inWorldDate !== undefined ? resolveDate(db, input.inWorldDate, null) : null;
  const playerBody = input.playerBody === undefined ? existing.playerBody : body(input.playerBody);
  const rebased = rebaseAnchors(existing.blocks, existing.playerBody, playerBody);
  const next: CodexPageRecord = {
    ...existing,
    title: input.title === undefined ? existing.title : title(input.title),
    entityType: nextType,
    fields,
    hiddenFields: typeChanged
      ? hiddenAfterKindChange(existing.hiddenFields, existing.entityType, nextType)
      : existing.hiddenFields,
    folder: input.folder === undefined ? existing.folder : folder(input.folder),
    tags: input.tags === undefined ? existing.tags : tags(input.tags),
    playerBody,
    blocks: input.layout === undefined ? rebased : applyLayout(rebased, input.layout, playerBody),
    bannerAssetId:
      input.bannerAssetId === undefined ? existing.bannerAssetId : input.bannerAssetId ? id(input.bannerAssetId) : null,
    inWorldLabel: dated ? dated.label : existing.inWorldLabel,
    calendarInstant: dated ? dated.instant : existing.calendarInstant,
    inWorldDate: dated ? dated.date : existing.inWorldDate
  };
  // Type changes force a checkpoint, since they discard content.
  savePage(db, existing, next, { edit: { authorTag, force: typeChanged } });
  return getPage(db, pageId)!;
}

/**
 * Writes a past revision forward as a new save, and checkpoints the state it discards so the restore can be undone.
 * It never shows players anything new: see `restoreBlocks`, and a field is Hidden when it was in the revision or is now.
 */
export function restoreRevision(db: CodexDb, pageId: string, revisionId: number, authorTag: string): CodexPage {
  const content = revisionContent(db, pageId, revisionId);
  if (!content) throw new CodexNotFoundError("That revision no longer exists.");
  const existing = existingPage(db, pageId, undefined);
  const type = content.entityType;
  const next: CodexPageRecord = {
    ...existing,
    title: content.title,
    entityType: type,
    fields: pruneCodexFields(type, content.fields),
    hiddenFields: hiddenFieldKeys(type, [
      ...content.hiddenFields,
      ...hiddenAfterKindChange(existing.hiddenFields, existing.entityType, type)
    ]),
    playerBody: content.playerBody,
    blocks: clampAnchors(restoreBlocks(existing.blocks, content.blocks), content.playerBody),
    bannerAssetId: content.bannerAssetId,
    tags: content.tags
  };
  savePage(db, existing, next, { edit: { authorTag, force: true } });
  return getPage(db, pageId)!;
}

// Hidden blocks. Content and place are edits (`rev` and `updatedAt` move); an audience is not.

export function addPageBlock(
  db: CodexDb,
  pageId: string,
  input: CodexBlockInput & Readonly<{ slot?: number }>,
  expectedRev: number | undefined
): { page: CodexPage; blockId: string } {
  const existing = existingPage(db, pageId, expectedRev);
  const added = addBlock(existing.blocks, input, slot(input.slot), existing.playerBody);
  savePage(db, existing, { ...existing, blocks: added.blocks }, { edit: { authorTag: "gm", force: false } });
  return { page: getPage(db, pageId)!, blockId: added.block.id };
}

export function editPageBlock(
  db: CodexDb,
  pageId: string,
  blockId: string,
  input: Readonly<{ title?: string | null; text?: string }>,
  expectedRev: number | undefined
): CodexPage {
  const existing = existingPage(db, pageId, expectedRev);
  const blocks = editBlock(existing.blocks, blockId, input);
  savePage(db, existing, { ...existing, blocks }, { edit: { authorTag: "gm", force: false } });
  return getPage(db, pageId)!;
}

export function movePageBlock(
  db: CodexDb,
  pageId: string,
  blockId: string,
  place: Readonly<{ anchor: number; slot?: number }>,
  expectedRev: number | undefined
): CodexPage {
  const existing = existingPage(db, pageId, expectedRev);
  const blocks = moveBlock(existing.blocks, blockId, place.anchor, slot(place.slot), existing.playerBody);
  savePage(db, existing, { ...existing, blocks }, { edit: { authorTag: "gm", force: false } });
  return getPage(db, pageId)!;
}

/** Idempotent: a block already gone leaves the page as it is. */
export function deletePageBlock(db: CodexDb, pageId: string, blockId: string, expectedRev?: number): CodexPage {
  const existing = existingPage(db, pageId, expectedRev);
  if (!existing.blocks.some((block) => block.id === blockId)) return getPage(db, pageId)!;
  const blocks = removeBlock(existing.blocks, blockId);
  savePage(db, existing, { ...existing, blocks }, { edit: { authorTag: "gm", force: false } });
  return getPage(db, pageId)!;
}

/** Who sees one block. Not an edit; the reveal pass stamps each audience it reaches once the page is revealed. */
export function setPageBlockAudience(
  db: CodexDb,
  pageId: string,
  blockId: string,
  value: string,
  characterIds: readonly string[] | undefined
): CodexPage {
  const existing = existingPage(db, pageId, undefined);
  const blocks = setBlockAudience(existing.blocks, blockId, value, characterIds);
  savePage(db, existing, { ...existing, blocks }, { edit: null });
  return getPage(db, pageId)!;
}

/** Who sees one field. Not an edit. A key the page's kind does not have is refused. */
export function setPageFieldAudience(db: CodexDb, pageId: string, key: string, value: string): CodexPage {
  const existing = existingPage(db, pageId, undefined);
  if (!codexFieldKeys(existing.entityType).has(key))
    throw new CodexValidationError("That field does not belong to this kind of page.");
  const shown: CodexFieldAudience = fieldAudience(value);
  const others = existing.hiddenFields.filter((hidden) => hidden !== key);
  const hiddenFields = shown === "hidden" ? [...others, key] : others;
  savePage(db, existing, { ...existing, hiddenFields }, { edit: null });
  return getPage(db, pageId)!;
}

/**
 * What everyone who can read the page sees: everything `projectPlayerPage` sends a reader with no character, and the
 * date while the page is an event the chronicle lists. A save that changes none of it leaves `playerUpdatedAt`.
 */
function everyoneView(page: CodexPageRecord): string {
  const hidden = new Set(page.hiddenFields);
  return JSON.stringify([
    page.title,
    page.entityType,
    Object.entries(page.fields)
      .filter(([key]) => !hidden.has(key))
      .sort(([a], [b]) => (a < b ? -1 : 1)),
    page.tags,
    page.playerBody,
    page.bannerAssetId,
    page.entityType === "event" ? page.inWorldDate : null,
    viewOf(page, new Set())
  ]);
}
/** The blocks one reader sees, in order and place. */
function viewOf(page: CodexPageRecord, characterIds: ReadonlySet<string>): unknown[] {
  return page.blocks
    .filter((block) => audienceReaches(block, characterIds))
    .map((block) => [block.anchor, block.title, block.text]);
}
function charactersNamed(page: CodexPageRecord): string[] {
  return page.blocks.flatMap((block) => block.characterIds);
}

/**
 * One page write: the row, its mentions and search rows, and the times players see. `playerUpdatedAt` moves when
 * what everyone sees changed, and `characterUpdatedAt` for each character whose own view changed. An edit (`edit`
 * set) also moves `rev` and `updatedAt`, keeps folder records and checkpoints the state it replaces (throttled).
 */
function savePage(
  db: CodexDb,
  existing: CodexPageRecord,
  proposed: CodexPageRecord,
  how: Readonly<{ edit: Readonly<{ authorTag: string; force: boolean }> | null }>
): void {
  const now = stamp(db);
  const characterUpdatedAt = { ...existing.characterUpdatedAt };
  for (const characterId of new Set([...charactersNamed(existing), ...charactersNamed(proposed)])) {
    const reader = new Set([characterId]);
    if (JSON.stringify(viewOf(existing, reader)) !== JSON.stringify(viewOf(proposed, reader)))
      characterUpdatedAt[characterId] = now;
  }
  const next: CodexPageRecord = {
    ...proposed,
    rev: how.edit ? existing.rev + 1 : existing.rev,
    updatedAt: how.edit ? now : existing.updatedAt,
    playerUpdatedAt: everyoneView(proposed) === everyoneView(existing) ? existing.playerUpdatedAt : now,
    characterUpdatedAt
  };
  const blocksJson = serializeBlocks(next.blocks);
  write(db, () => {
    db.database
      .prepare(
        "UPDATE codex_pages SET title = ?, entity_type = ?, fields_json = ?, hidden_fields_json = ?, folder = ?, tags_json = ?, player_body = ?, blocks_json = ?, blocks_pending = ?, banner_asset_id = ?, in_world_year = ?, in_world_month = ?, in_world_day = ?, in_world_label = ?, calendar_instant = ?, rev = ?, updated_at = ?, player_updated_at = ?, character_updated_at_json = ? WHERE id = ?"
      )
      .run(
        next.title,
        next.entityType,
        JSON.stringify(next.fields),
        JSON.stringify(next.hiddenFields),
        next.folder,
        JSON.stringify(next.tags),
        next.playerBody,
        blocksJson,
        pendingFlag(blocksJson),
        next.bannerAssetId,
        next.inWorldDate?.year ?? null,
        next.inWorldDate?.month ?? null,
        next.inWorldDate?.day ?? null,
        next.inWorldLabel,
        next.calendarInstant,
        next.rev,
        next.updatedAt,
        next.playerUpdatedAt,
        JSON.stringify(next.characterUpdatedAt),
        next.id
      );
    derive(db, next);
    if (!how.edit) return;
    registerFolderPath(db, next.folder, next.updatedAt);
    // Checkpoint the state being replaced (throttled); `revisionExistsAt` prevents duplicates.
    if (revisionDue(db, next.id, revisionSettings(db), how.edit.force) && !revisionExistsAt(db, next.id, existing.rev))
      snapshotRevision(db, existing, how.edit.authorTag);
  });
}

/**
 * Revealing is not editing: `updatedAt` stays, though the Codex revision still bumps. Players see a reveal or a
 * hide, so `playerUpdatedAt` moves when the flag flips.
 */
export function setPageRevealed(db: CodexDb, pageId: string, revealed: boolean): CodexPage {
  const existing = readPage(db, pageId);
  if (!existing) throw new CodexNotFoundError("That page no longer exists.");
  write(db, () => {
    if (existing.revealedToPlayers === revealed) return;
    db.database
      .prepare("UPDATE codex_pages SET revealed = ?, player_updated_at = ? WHERE id = ?")
      .run(revealed ? 1 : 0, stamp(db), pageId);
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

export function readPage(db: CodexDb, pageId: string): CodexPageRecord | null {
  if (!isId(pageId)) return null;
  const row = db.database.prepare(`SELECT ${PAGE_COLUMNS} FROM codex_pages WHERE id = ?`).get(pageId) as
    PageRowRaw | undefined;
  return row ? toRecord(row) : null;
}

export function getPage(db: CodexDb, pageId: string): CodexPage | null {
  const record = readPage(db, pageId);
  return record ? toWirePage(record, stampReader(db)) : null;
}

export function listPages(
  db: CodexDb,
  filter?: Readonly<{ folder?: string | null; tag?: string }>
): CodexPageSummary[] {
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

/** Every page as stored, for the backup and the upgrade's rebuild. */
export function listPageRecords(db: CodexDb): CodexPageRecord[] {
  return (
    db.database.prepare(`SELECT ${PAGE_COLUMNS} FROM codex_pages ORDER BY title COLLATE NOCASE`).all() as PageRowRaw[]
  ).map(toRecord);
}

/** Every page with its player text and blocks. */
export function listFullPages(db: CodexDb): CodexPage[] {
  const reader = stampReader(db);
  return listPageRecords(db).map((record) => toWirePage(record, reader));
}

/** Dated `event` pages. Filtering on type, and keeping the dates, makes a type switch lossless. */
export function listDatedEventPages(db: CodexDb): CodexPage[] {
  const reader = stampReader(db);
  return (
    db.database
      .prepare(
        `SELECT ${PAGE_COLUMNS} FROM codex_pages WHERE entity_type = 'event' AND calendar_instant IS NOT NULL ORDER BY calendar_instant, created_at`
      )
      .all() as PageRowRaw[]
  ).map((row) => toWirePage(toRecord(row), reader));
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
  // A move that finds nothing writes nothing, so it leaves the revision (and every GM ETag) alone.
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
