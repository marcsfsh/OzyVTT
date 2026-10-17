import type {
  CodexCalendar,
  CodexDowntimePayload,
  CodexInWorldDate,
  CodexJournalEntry,
  CodexJournalKind,
  CodexJournalPayload,
  CodexPage
} from "@vtt/domain";
import {
  campaignInstant,
  dateForInstant,
  getCalendar,
  normalizeCalendar,
  resolveDate,
  resolveNow,
  writeCalendar,
  type ResolvedDate
} from "./calendar.js";
import { freshId, stamp, write, type CodexDb } from "./db.js";
import { downtimePayload, downtimePayloadOf, journalKind, milestonePayload, payloadOf } from "./journal-kinds.js";
import { rebuildLinks, scrubLinks } from "./links.js";
import { getPage, listDatedEventPages } from "./pages.js";
import { indexEntry, unindex } from "./search.js";
import { activeSessionId, requireSession } from "./sessions.js";
import {
  CodexNotFoundError,
  CodexRevisionConflictError,
  CodexValidationError,
  entryGmText,
  entryText,
  isId,
  optionalId,
  parseStringArray,
  shortLabel,
  tags
} from "./validate.js";

/**
 * The campaign journal (`codex_journal`): notes, logged fights, deadlines, downtime, milestones, and the
 * history records quests and standing write. Each entry has player text, optional GM text and a reveal flag.
 */

/** `sessionId` omitted on create: the active session; `null`: none; an unknown id: not-found. */
export type CodexJournalCreateInput = Readonly<{
  playerText?: string;
  gmText?: string | null;
  revealedToPlayers?: boolean;
  attachMarkerId?: string | null;
  attachPageId?: string | null;
  sessionId?: string | null;
  realDate?: string | null;
  inWorldLabel?: string | null;
  inWorldDate?: CodexInWorldDate | null;
  tags?: readonly string[];
}>;
/** An edit may change only `who`, `activity` and `characterPageId`; `days` is fixed once the clock has moved. */
export type CodexJournalUpdateInput = CodexJournalCreateInput &
  Readonly<{ downtime?: Readonly<{ who?: string; activity?: string; characterPageId?: string | null }> }>;
export type CodexDowntimeCreateInput = CodexJournalCreateInput &
  Readonly<{ downtime: Readonly<{ who: string; activity: string; days: number; characterPageId?: string | null }> }>;
export type CodexMilestoneCreateInput = CodexJournalCreateInput &
  Readonly<{ milestone: Readonly<{ level: number; reason: string }> }>;
export type CodexCombatEntryInput = Readonly<{
  sourceEncounterId: number;
  attachMarkerId?: string | null;
  attachPageId?: string | null;
  playerText: string;
  gmText?: string | null;
  revealedToPlayers?: boolean;
}>;
/** Raw store rows; flattening and gating happen in `codex-projections.ts`. */
export type CodexChronicleSource =
  Readonly<{ kind: "entry"; entry: CodexJournalEntry }> | Readonly<{ kind: "event"; page: CodexPage }>;

/** Everything one journal INSERT writes. `payload` is required so each kind's creator says what it carries. */
export type EntryFields = Readonly<{
  playerText: string;
  gmText: string | null;
  revealedToPlayers: boolean;
  attachMarkerId: string | null;
  attachPageId: string | null;
  kind: CodexJournalKind;
  sourceEncounterId: number | null;
  sessionId: string | null;
  realDate: string | null;
  dated: ResolvedDate;
  tags?: readonly string[];
  payload: CodexJournalPayload | null;
}>;

const JOURNAL_COLUMNS =
  "j.id, j.kind, j.player_text, j.gm_text, j.revealed, j.attach_marker_id, j.attach_page_id, j.source_encounter_id, j.session_id, j.deleted_session_number, s.session_number AS live_session_number, j.real_date, j.in_world_year, j.in_world_month, j.in_world_day, j.in_world_label, j.calendar_instant, j.sort_key, j.tags_json, j.payload_json, j.created_at, j.updated_at";
/** Always with `JOURNAL_COLUMNS`: without the join every entry would show only the left-behind number. */
const JOURNAL_FROM = "codex_journal j LEFT JOIN codex_sessions s ON s.id = j.session_id";
type JournalRowRaw = {
  id: string;
  kind: string;
  player_text: string;
  gm_text: string | null;
  revealed: number;
  attach_marker_id: string | null;
  attach_page_id: string | null;
  source_encounter_id: number | null;
  session_id: string | null;
  deleted_session_number: number | null;
  live_session_number: number | null;
  real_date: string | null;
  in_world_year: number | null;
  in_world_month: number | null;
  in_world_day: number | null;
  in_world_label: string | null;
  calendar_instant: number | null;
  sort_key: number;
  tags_json: string;
  payload_json: string | null;
  created_at: string;
  updated_at: string;
};

function toEntry(row: JournalRowRaw): CodexJournalEntry {
  const kind = journalKind(row.kind);
  return {
    id: row.id,
    playerText: row.player_text,
    gmText: row.gm_text,
    revealedToPlayers: row.revealed === 1,
    attachMarkerId: row.attach_marker_id,
    attachPageId: row.attach_page_id,
    kind,
    sourceEncounterId: row.source_encounter_id,
    sessionId: row.session_id,
    sessionNumber: row.live_session_number ?? row.deleted_session_number,
    realDate: row.real_date,
    inWorldLabel: row.in_world_label,
    calendarInstant: row.calendar_instant,
    inWorldDate:
      row.in_world_year !== null && row.in_world_month !== null && row.in_world_day !== null
        ? { year: row.in_world_year, month: row.in_world_month, day: row.in_world_day }
        : null,
    sortKey: row.sort_key,
    tags: parseStringArray(row.tags_json),
    payload: payloadOf(kind, row.payload_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function entryRow(db: CodexDb, entryId: string): JournalRowRaw | undefined {
  if (!isId(entryId)) return undefined;
  return db.database.prepare(`SELECT ${JOURNAL_COLUMNS} FROM ${JOURNAL_FROM} WHERE j.id = ?`).get(entryId) as
    JournalRowRaw | undefined;
}

/** Leaf write of one entry row, with its index row and links. Restores pass the stored id and stamps. */
export function insertEntry(
  db: CodexDb,
  entry: EntryFields &
    Readonly<{ id: string; deletedSessionNumber: number | null; sortKey: number; createdAt: string; updatedAt: string }>
): void {
  const entryTags = tags(entry.tags);
  const date = entry.dated.date;
  db.database
    .prepare(
      "INSERT INTO codex_journal (id, kind, player_text, gm_text, revealed, attach_marker_id, attach_page_id, source_encounter_id, session_id, deleted_session_number, real_date, in_world_year, in_world_month, in_world_day, in_world_label, calendar_instant, sort_key, tags_json, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      entry.id,
      entry.kind,
      entry.playerText,
      entry.gmText,
      entry.revealedToPlayers ? 1 : 0,
      entry.attachMarkerId,
      entry.attachPageId,
      entry.sourceEncounterId,
      entry.sessionId,
      entry.deletedSessionNumber,
      entry.realDate,
      date ? date.year : null,
      date ? date.month : null,
      date ? date.day : null,
      entry.dated.label,
      entry.dated.instant,
      entry.sortKey,
      JSON.stringify(entryTags),
      entry.payload === null ? null : JSON.stringify(entry.payload),
      entry.createdAt,
      entry.updatedAt
    );
  indexEntry(db, entry.id, entry.playerText, entry.gmText, entryTags);
  rebuildLinks(db, "journal", entry.id, entry.playerText, entry.gmText ?? "");
}

/** Leaf write of a new entry, last in sort order; quest and standing history compose it into their own writes. */
export function writeEntry(db: CodexDb, fields: EntryFields): string {
  const entryId = freshId();
  const now = stamp(db);
  const sortKey =
    ((db.database.prepare("SELECT MAX(sort_key) AS m FROM codex_journal").get() as { m: number | null }).m ?? 0) + 1;
  insertEntry(db, { ...fields, id: entryId, deletedSessionNumber: null, sortKey, createdAt: now, updatedAt: now });
  return entryId;
}

function createOne(db: CodexDb, fields: EntryFields): CodexJournalEntry {
  const entryId = write(db, () => writeEntry(db, fields));
  return getEntry(db, entryId)!;
}

/** Omitted: the active session; `null`: none; an id must exist. */
function entrySession(db: CodexDb, sessionId: string | null | undefined): string | null {
  if (sessionId === undefined) return activeSessionId(db);
  return sessionId === null ? null : requireSession(db, sessionId);
}

/** The fields every hand-written kind shares. */
function authoredFields(db: CodexDb, input: CodexJournalCreateInput, dated: ResolvedDate) {
  return {
    playerText: entryText(input.playerText),
    gmText: entryGmText(input.gmText),
    revealedToPlayers: input.revealedToPlayers === true,
    attachMarkerId: optionalId(input.attachMarkerId),
    attachPageId: optionalId(input.attachPageId),
    sourceEncounterId: null,
    sessionId: entrySession(db, input.sessionId),
    realDate: shortLabel(input.realDate, 40, "date"),
    dated,
    tags: input.tags
  };
}

export function createEntry(db: CodexDb, input: CodexJournalCreateInput): CodexJournalEntry {
  const dated = resolveDate(db, input.inWorldDate, input.inWorldLabel);
  return createOne(db, { ...authoredFields(db, input, dated), kind: "note", payload: null });
}

/** A logged encounter, dated at the GM's clock and filed under the active session. */
export function appendCombatEntry(db: CodexDb, input: CodexCombatEntryInput): CodexJournalEntry {
  return createOne(db, {
    playerText: entryText(input.playerText),
    gmText: entryGmText(input.gmText),
    revealedToPlayers: input.revealedToPlayers === true,
    attachMarkerId: optionalId(input.attachMarkerId),
    attachPageId: optionalId(input.attachPageId),
    kind: "combat",
    sourceEncounterId: input.sourceEncounterId,
    sessionId: activeSessionId(db),
    realDate: null,
    dated: resolveNow(db),
    payload: null
  });
}

/** A deadline needs a structured date, since a label cannot be compared with a clock. `fired` is derived. */
export function createDeadline(db: CodexDb, input: CodexJournalCreateInput): CodexJournalEntry {
  const dated = resolveDate(db, input.inWorldDate, input.inWorldLabel);
  if (!dated.date) throw new CodexValidationError("A deadline needs an in-world date. The date is when it fires.");
  return createOne(db, { ...authoredFields(db, input, dated), kind: "deadline", payload: null });
}

/** Never moves the clock (`applyDowntime` does). Dated at the GM's clock unless given a date. */
export function createDowntime(db: CodexDb, input: CodexDowntimeCreateInput): CodexJournalEntry {
  const payload = downtimePayload(input.downtime);
  // A linked page must exist, or the tracker would show a dead link. Its type is not checked: NPCs and
  // hirelings may have downtime too.
  if (payload.characterPageId !== null && !getPage(db, payload.characterPageId))
    throw new CodexNotFoundError("That page no longer exists.");
  const dated = resolveDate(db, input.inWorldDate ?? getCalendar(db).currentDate ?? null, input.inWorldLabel);
  return createOne(db, { ...authoredFields(db, input, dated), kind: "downtime", payload });
}

/** Level history is a journal record with no table of its own: the timeline already orders it. */
export function createMilestone(db: CodexDb, input: CodexMilestoneCreateInput): CodexJournalEntry {
  const payload = milestonePayload(input.milestone);
  const dated = resolveDate(db, input.inWorldDate ?? getCalendar(db).currentDate ?? null, input.inWorldLabel);
  return createOne(db, { ...authoredFields(db, input, dated), kind: "milestone", payload });
}

/** Where `applyDowntime` would move the clock, so the GM confirms a date first. Null when not applicable. */
export function proposedDateFor(db: CodexDb, entry: CodexJournalEntry): CodexInWorldDate | null {
  const payload = downtimePayloadOf(entry);
  if (!payload || payload.applied) return null;
  const from = campaignInstant(db);
  return from === null ? null : dateForInstant(db, from + payload.days);
}

/** Marks the downtime applied and moves the GM's clock in one write, without publishing. A second apply is a 409. */
export function applyDowntime(
  db: CodexDb,
  entryId: string
): Readonly<{ entry: CodexJournalEntry; calendar: CodexCalendar }> {
  const existing = getEntry(db, entryId);
  if (!existing) throw new CodexNotFoundError("That journal entry no longer exists.");
  if (existing.kind !== "downtime") throw new CodexValidationError("Only a downtime record can pass time.");
  const payload = downtimePayloadOf(existing);
  if (!payload) throw new CodexValidationError("That downtime record has no activity to apply.");
  if (payload.applied)
    throw new CodexRevisionConflictError("That downtime has already passed, and the clock has already moved.");
  const target = proposedDateFor(db, existing);
  if (!target) throw new CodexValidationError("Set the campaign's current date before passing time.");
  const calendar = getCalendar(db);
  const applied: CodexDowntimePayload = { ...payload, applied: true };
  write(db, () => {
    db.database
      .prepare("UPDATE codex_journal SET payload_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(applied), stamp(db), entryId);
    writeCalendar(db, normalizeCalendar({ ...calendar, currentDate: target }));
  });
  return { entry: getEntry(db, entryId)!, calendar: getCalendar(db) };
}

export function updateEntry(db: CodexDb, entryId: string, input: CodexJournalUpdateInput): CodexJournalEntry {
  const stored = entryRow(db, entryId);
  if (!stored) throw new CodexNotFoundError("That journal entry no longer exists.");
  const existing = toEntry(stored);
  // A structured date or a changed free-text label recomputes the instant and label together.
  const dated =
    input.inWorldDate !== undefined || input.inWorldLabel !== undefined
      ? resolveDate(db, input.inWorldDate ?? null, input.inWorldLabel)
      : null;
  // A deadline's date cannot be cleared, since without one it could never fire; rejected, so
  // the GM learns the field is required.
  if (existing.kind === "deadline" && dated && dated.instant === null)
    throw new CodexValidationError(
      "A deadline needs an in-world date, because the date is what makes it a deadline. Change its date, or delete it and write a note."
    );
  const next = {
    playerText: input.playerText === undefined ? existing.playerText : entryText(input.playerText),
    gmText: input.gmText === undefined ? existing.gmText : entryGmText(input.gmText),
    attachMarkerId: input.attachMarkerId === undefined ? existing.attachMarkerId : optionalId(input.attachMarkerId),
    attachPageId: input.attachPageId === undefined ? existing.attachPageId : optionalId(input.attachPageId),
    // Unlike a create, an edit never files under the active session: omitted keeps the filing, `null` unfiles.
    sessionId:
      input.sessionId === undefined
        ? existing.sessionId
        : input.sessionId === null
          ? null
          : requireSession(db, input.sessionId),
    realDate: input.realDate === undefined ? existing.realDate : shortLabel(input.realDate, 40, "date"),
    dated: dated ?? { instant: existing.calendarInstant, label: existing.inWorldLabel, date: existing.inWorldDate },
    tags: input.tags === undefined ? existing.tags : tags(input.tags),
    // Untouched unless the edit names downtime details, so the stored payload is written back as it was.
    payloadJson:
      input.downtime === undefined ? stored.payload_json : JSON.stringify(editedDowntime(db, existing, input.downtime))
  };
  write(db, () => {
    db.database
      .prepare(
        "UPDATE codex_journal SET player_text = ?, gm_text = ?, attach_marker_id = ?, attach_page_id = ?, session_id = ?, real_date = ?, in_world_year = ?, in_world_month = ?, in_world_day = ?, in_world_label = ?, calendar_instant = ?, tags_json = ?, payload_json = ?, updated_at = ? WHERE id = ?"
      )
      .run(
        next.playerText,
        next.gmText,
        next.attachMarkerId,
        next.attachPageId,
        next.sessionId,
        next.realDate,
        next.dated.date?.year ?? null,
        next.dated.date?.month ?? null,
        next.dated.date?.day ?? null,
        next.dated.label,
        next.dated.instant,
        JSON.stringify(next.tags),
        next.payloadJson,
        stamp(db),
        entryId
      );
    indexEntry(db, entryId, next.playerText, next.gmText, next.tags);
    rebuildLinks(db, "journal", entryId, next.playerText, next.gmText ?? "");
  });
  return getEntry(db, entryId)!;
}

/** Only `who`, `activity` and `characterPageId` are editable; `applied` and `days` are kept. */
function editedDowntime(
  db: CodexDb,
  existing: CodexJournalEntry,
  edit: NonNullable<CodexJournalUpdateInput["downtime"]>
): CodexDowntimePayload {
  if (existing.kind !== "downtime") throw new CodexValidationError("Only downtime entries carry downtime details.");
  const current = downtimePayloadOf(existing) ?? {
    who: "",
    activity: "",
    days: 0,
    applied: false,
    characterPageId: null
  };
  const characterPageId =
    edit.characterPageId === undefined ? current.characterPageId : optionalId(edit.characterPageId);
  if (characterPageId !== null && !getPage(db, characterPageId))
    throw new CodexNotFoundError("That page no longer exists.");
  return {
    who: edit.who === undefined ? current.who : (shortLabel(edit.who, 120, "downtime participant") ?? ""),
    activity:
      edit.activity === undefined ? current.activity : (shortLabel(edit.activity, 120, "downtime activity") ?? ""),
    days: current.days,
    applied: current.applied,
    characterPageId
  };
}

export function setEntryRevealed(db: CodexDb, entryId: string, revealed: boolean): CodexJournalEntry {
  if (!entryRow(db, entryId)) throw new CodexNotFoundError("That journal entry no longer exists.");
  write(db, () => {
    db.database
      .prepare("UPDATE codex_journal SET revealed = ?, updated_at = ? WHERE id = ?")
      .run(revealed ? 1 : 0, stamp(db), entryId);
  });
  return getEntry(db, entryId)!;
}

/** Leaf delete. */
export function deleteEntry(db: CodexDb, entryId: string): void {
  unindex(db, "journal", entryId);
  scrubLinks(db, "journal", entryId);
  db.database.prepare("DELETE FROM codex_journal WHERE id = ?").run(entryId);
}

// What deleting another record does to the entries that point at it: each becomes label-only, never dangling.

/** Leaf write for a deleted page: entries pinned to it and downtime linked to it let go. */
export function detachPage(db: CodexDb, pageId: string): void {
  const now = stamp(db);
  db.database
    .prepare("UPDATE codex_journal SET attach_page_id = NULL, updated_at = ? WHERE attach_page_id = ?")
    .run(now, pageId);
  // The downtime record survives on `who`. `json_valid` comes first because `json_set` throws on malformed JSON.
  db.database
    .prepare(
      "UPDATE codex_journal SET payload_json = json_set(payload_json, '$.characterPageId', json('null')), updated_at = ? WHERE kind = 'downtime' AND json_valid(payload_json) AND json_extract(payload_json, '$.characterPageId') = ?"
    )
    .run(now, pageId);
}

/** Leaf write for deleted pins. */
export function detachMarkers(db: CodexDb, markerIds: readonly string[]): void {
  const update = db.database.prepare(
    "UPDATE codex_journal SET attach_marker_id = NULL, updated_at = ? WHERE attach_marker_id = ?"
  );
  for (const markerId of markerIds) update.run(stamp(db), markerId);
}

/**
 * Leaf write for a deleted session: its entries are unfiled. `keepNumber` is the number to leave on them as a
 * label, which only a revealed session may pass, since a bare label bypasses the session gate.
 */
export function unfileSession(db: CodexDb, sessionId: string, keepNumber: number | null): void {
  db.database
    .prepare("UPDATE codex_journal SET session_id = NULL, deleted_session_number = ? WHERE session_id = ?")
    .run(keepNumber, sessionId);
}

export function getEntry(db: CodexDb, entryId: string): CodexJournalEntry | null {
  const row = entryRow(db, entryId);
  return row ? toEntry(row) : null;
}

/** By in-world instant (undated last), then session number, then creation time. */
export function listTimeline(db: CodexDb): CodexJournalEntry[] {
  return (
    db.database
      .prepare(
        `SELECT ${JOURNAL_COLUMNS} FROM ${JOURNAL_FROM} ORDER BY (j.calendar_instant IS NULL), j.calendar_instant, (live_session_number IS NULL), live_session_number, j.created_at`
      )
      .all() as JournalRowRaw[]
  ).map(toEntry);
}

/** Entries pinned to one marker or page: the per-entity mini-timeline. A malformed marker id falls through. */
export function listEntriesFor(
  db: CodexDb,
  attach: Readonly<{ markerId?: string; pageId?: string }>
): CodexJournalEntry[] {
  const pinnedTo = (column: "attach_marker_id" | "attach_page_id", target: string) =>
    (
      db.database
        .prepare(`SELECT ${JOURNAL_COLUMNS} FROM ${JOURNAL_FROM} WHERE j.${column} = ? ORDER BY j.created_at`)
        .all(target) as JournalRowRaw[]
    ).map(toEntry);
  if (attach.markerId && isId(attach.markerId)) return pinnedTo("attach_marker_id", attach.markerId);
  if (attach.pageId && isId(attach.pageId)) return pinnedTo("attach_page_id", attach.pageId);
  return [];
}

/** The pages downtime records link, which a player read must check. `CASE` runs `json_valid` before `json_extract`. */
export function downtimeCharacterPageIds(db: CodexDb): string[] {
  const rows = db.database
    .prepare(
      "SELECT DISTINCT (CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.characterPageId') END) AS page_id FROM codex_journal WHERE kind = 'downtime'"
    )
    .all() as Array<{ page_id: string | null }>;
  return rows.map((row) => row.page_id).filter((pageId): pageId is string => typeof pageId === "string");
}

/** `listTimeline`'s ORDER BY restated, so entries and event pages merge in the same order; `id` breaks ties. */
type ChronicleSortKey = Readonly<{
  calendarInstant: number | null;
  sessionNumber: number | null;
  createdAt: string;
  id: string;
}>;
function chronicleSortKey(record: CodexChronicleSource): ChronicleSortKey {
  return record.kind === "entry"
    ? {
        calendarInstant: record.entry.calendarInstant,
        sessionNumber: record.entry.sessionNumber,
        createdAt: record.entry.createdAt,
        id: record.entry.id
      }
    : {
        calendarInstant: record.page.calendarInstant,
        sessionNumber: null,
        createdAt: record.page.createdAt,
        id: record.page.id
      };
}
function compareChronicle(a: ChronicleSortKey, b: ChronicleSortKey): number {
  const undated = Number(a.calendarInstant === null) - Number(b.calendarInstant === null);
  if (undated !== 0) return undated;
  if (a.calendarInstant !== null && b.calendarInstant !== null && a.calendarInstant !== b.calendarInstant)
    return a.calendarInstant - b.calendarInstant;
  const unsessioned = Number(a.sessionNumber === null) - Number(b.sessionNumber === null);
  if (unsessioned !== 0) return unsessioned;
  if (a.sessionNumber !== null && b.sessionNumber !== null && a.sessionNumber !== b.sessionNumber)
    return a.sessionNumber - b.sessionNumber;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Entries and dated event pages in one order. Ungated by design; `projectPlayerChronicleRecord` gates. */
export function listChronicle(db: CodexDb): CodexChronicleSource[] {
  const records: CodexChronicleSource[] = [
    ...listTimeline(db).map((entry) => ({ kind: "entry", entry }) as const),
    ...listDatedEventPages(db).map((page) => ({ kind: "event", page }) as const)
  ];
  return records.sort((a, b) => compareChronicle(chronicleSortKey(a), chronicleSortKey(b)));
}
