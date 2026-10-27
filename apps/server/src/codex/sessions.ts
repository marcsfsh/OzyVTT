import type { CodexSession, CodexSessionStatus } from "@vtt/domain";
import { freshId, stamp, write, type CodexDb } from "./db.js";
import { rebuildLinks, scrubLinks } from "./links.js";
import {
  defaultTemplateId,
  parseStoredPrep,
  prepFromTemplate,
  prepItems,
  prepScenes,
  prepSections,
  prepText,
  reapplyTemplate,
  requireTemplate,
  type PrepSectionInput
} from "./prep.js";
import { indexSession, unindex } from "./search.js";
import {
  CodexNotFoundError,
  CodexRevisionConflictError,
  CodexValidationError,
  attendees,
  body,
  id,
  isId,
  optionalId,
  parseStringArray,
  sessionNo,
  sessionSceneIds,
  sessionStatus,
  shortLabel,
  tags
} from "./validate.js";

/**
 * Sessions (`codex_sessions`) and which one the table is playing (`codex_meta.active_session_id`). The prep
 * sections are the GM half and the recap the player half. Like pages, `rev` is the editor's conflict token.
 */

/**
 * `templateId` omitted copies the default template's sections, `null` starts with none, and `prep` sets the
 * sections as given. `prep` and `templateId` together are refused.
 */
export type CodexSessionCreateInput = Readonly<{
  sessionNumber?: number | null;
  realDate?: string | null;
  attendees?: readonly string[];
  templateId?: string | null;
  prep?: readonly PrepSectionInput[];
  recapBody?: string;
  revealedToPlayers?: boolean;
  status?: CodexSessionStatus;
  tags?: readonly string[];
  encounterIds?: readonly string[];
}>;
/** No `revealedToPlayers`: reveal has its own route, so an edit cannot publish a recap as a side effect. */
export type CodexSessionUpdateInput = Readonly<{
  sessionNumber?: number | null;
  realDate?: string | null;
  attendees?: readonly string[];
  prep?: readonly PrepSectionInput[];
  recapBody?: string;
  status?: CodexSessionStatus;
  tags?: readonly string[];
  encounterIds?: readonly string[];
}>;

type SessionRowRaw = {
  id: string;
  session_number: number | null;
  real_date: string | null;
  attendees_json: string;
  prep_json: string;
  prep_template_id: string | null;
  current_scene_id: string | null;
  recap_body: string;
  revealed: number;
  status: string;
  tags_json: string;
  scene_ids_json: string;
  rev: number;
  created_at: string;
  updated_at: string;
  first_shown_at: string | null;
};
const SESSION_COLUMNS =
  "id, session_number, real_date, attendees_json, prep_json, prep_template_id, current_scene_id, recap_body, revealed, status, tags_json, scene_ids_json, rev, created_at, updated_at, first_shown_at";

function toSession(row: SessionRowRaw): CodexSession {
  return {
    id: row.id,
    sessionNumber: row.session_number,
    realDate: row.real_date,
    attendees: parseStringArray(row.attendees_json),
    prep: parseStoredPrep(row.prep_json),
    prepTemplateId: row.prep_template_id,
    currentSceneId: row.current_scene_id,
    recapBody: row.recap_body,
    revealedToPlayers: row.revealed === 1,
    // Unrecognised statuses read as `planned`.
    status: row.status === "played" ? "played" : "planned",
    tags: parseStringArray(row.tags_json),
    encounterIds: parseStringArray(row.scene_ids_json),
    rev: row.rev,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    firstShownAt: row.first_shown_at
  };
}

/** Leaf write of a whole, already-validated session (create and restore). */
export function insertSession(db: CodexDb, session: CodexSession): void {
  db.database
    .prepare(`INSERT INTO codex_sessions (${SESSION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      session.id,
      session.sessionNumber,
      session.realDate,
      JSON.stringify(session.attendees),
      JSON.stringify(session.prep),
      session.prepTemplateId,
      session.currentSceneId,
      session.recapBody,
      session.revealedToPlayers ? 1 : 0,
      session.status,
      JSON.stringify(session.tags),
      JSON.stringify(session.encounterIds),
      session.rev,
      session.createdAt,
      session.updatedAt,
      session.firstShownAt
    );
  indexSession(db, session);
  // The recap is the player layer and prep the GM layer, so a page named only in prep is a GM-only connection.
  rebuildLinks(db, "session", session.id, session.recapBody, prepText(session.prep));
}

/** The unique index enforces distinct numbers; this turns its violation into a readable error. */
function guardSessionNumber(sessionNumber: number | null, work: () => void): void {
  try {
    work();
  } catch (error) {
    if (sessionNumber !== null && error instanceof Error && error.message.includes("UNIQUE constraint failed"))
      throw new CodexValidationError(`Session ${sessionNumber} already exists. Give this one a different number.`);
    throw error;
  }
}

/** The prep a new session starts with, and the template it came from. */
function startingPrep(db: CodexDb, input: CodexSessionCreateInput, now: string) {
  if (input.prep !== undefined) {
    if (input.templateId !== undefined)
      throw new CodexValidationError("Send either a template or prep sections for a new session.");
    return { prep: prepSections(input.prep, { now }), prepTemplateId: null };
  }
  if (input.templateId === null) return { prep: [], prepTemplateId: null };
  const template = requireTemplate(db, input.templateId ?? defaultTemplateId(db));
  return { prep: prepFromTemplate(template), prepTemplateId: template.id };
}

export function createSession(db: CodexDb, input: CodexSessionCreateInput): CodexSession {
  const now = stamp(db);
  const session: CodexSession = {
    id: freshId(),
    sessionNumber: sessionNo(input.sessionNumber),
    realDate: shortLabel(input.realDate, 40, "date"),
    attendees: attendees(input.attendees),
    ...startingPrep(db, input, now),
    currentSceneId: null,
    recapBody: body(input.recapBody),
    revealedToPlayers: input.revealedToPlayers === true,
    status: sessionStatus(input.status),
    tags: tags(input.tags),
    encounterIds: sessionSceneIds(input.encounterIds),
    rev: 1,
    createdAt: now,
    updatedAt: now,
    // The write dates it if it is created revealed.
    firstShownAt: null
  };
  guardSessionNumber(session.sessionNumber, () => write(db, () => insertSession(db, session)));
  return getSession(db, session.id)!;
}

/** Omitted fields are unchanged. */
export function updateSession(
  db: CodexDb,
  sessionId: string,
  input: CodexSessionUpdateInput,
  expectedRev: number | undefined
): CodexSession {
  const existing = getSession(db, sessionId);
  if (!existing) throw new CodexNotFoundError("That session no longer exists.");
  if (expectedRev !== undefined && expectedRev !== existing.rev)
    throw new CodexRevisionConflictError("This session was changed somewhere else after you opened it.");
  const now = stamp(db);
  const prep = input.prep === undefined ? existing.prep : prepSections(input.prep, { now, previous: existing.prep });
  const next: CodexSession = {
    ...existing,
    sessionNumber: input.sessionNumber === undefined ? existing.sessionNumber : sessionNo(input.sessionNumber),
    realDate: input.realDate === undefined ? existing.realDate : shortLabel(input.realDate, 40, "date"),
    attendees: input.attendees === undefined ? existing.attendees : attendees(input.attendees),
    prep,
    currentSceneId: keptScene(prep, existing.currentSceneId),
    recapBody: input.recapBody === undefined ? existing.recapBody : body(input.recapBody),
    status: input.status === undefined ? existing.status : sessionStatus(input.status),
    tags: input.tags === undefined ? existing.tags : tags(input.tags),
    encounterIds: input.encounterIds === undefined ? existing.encounterIds : sessionSceneIds(input.encounterIds),
    // `rev` and `updatedAt` move together on an edit; a reveal moves neither.
    rev: existing.rev + 1,
    updatedAt: now
  };
  guardSessionNumber(next.sessionNumber, () => write(db, () => rewriteSession(db, next)));
  return getSession(db, sessionId)!;
}

/** Leaf write of every editable column of an existing session, with its search row and links. */
function rewriteSession(db: CodexDb, next: CodexSession): void {
  db.database
    .prepare(
      "UPDATE codex_sessions SET session_number = ?, real_date = ?, attendees_json = ?, prep_json = ?, prep_template_id = ?, current_scene_id = ?, recap_body = ?, status = ?, tags_json = ?, scene_ids_json = ?, rev = ?, updated_at = ? WHERE id = ?"
    )
    .run(
      next.sessionNumber,
      next.realDate,
      JSON.stringify(next.attendees),
      JSON.stringify(next.prep),
      next.prepTemplateId,
      next.currentSceneId,
      next.recapBody,
      next.status,
      JSON.stringify(next.tags),
      JSON.stringify(next.encounterIds),
      next.rev,
      next.updatedAt,
      next.id
    );
  indexSession(db, next);
  rebuildLinks(db, "session", next.id, next.recapBody, prepText(next.prep));
}

/** The current scene while it is still in the prep, else none. */
function keptScene(prep: CodexSession["prep"], sceneId: string | null): string | null {
  return sceneId !== null && prepScenes(prep).some(({ scene }) => scene.id === sceneId) ? sceneId : null;
}

/**
 * One change to a session's prep from the table or the template library. It is an edit, so `rev` and `updatedAt`
 * move: an editor holding the old `rev` gets a conflict on its next save and never overwrites a tick.
 */
function editPrep(
  db: CodexDb,
  sessionId: string,
  expectedRev: number | undefined,
  change: (
    existing: CodexSession,
    now: string
  ) => Partial<Pick<CodexSession, "prep" | "prepTemplateId" | "currentSceneId">>
): CodexSession {
  const existing = getSession(db, sessionId);
  if (!existing) throw new CodexNotFoundError("That session no longer exists.");
  if (expectedRev !== undefined && expectedRev !== existing.rev)
    throw new CodexRevisionConflictError("This session was changed somewhere else after you opened it.");
  const now = stamp(db);
  const changed = { ...existing, ...change(existing, now) };
  const next: CodexSession = {
    ...changed,
    currentSceneId: keptScene(changed.prep, changed.currentSceneId),
    rev: existing.rev + 1,
    updatedAt: now
  };
  write(db, () => rewriteSession(db, next));
  return getSession(db, sessionId)!;
}

/** Re-applies a template to a session's prep and keeps what was written (`reapplyTemplate`). */
export function applyTemplate(
  db: CodexDb,
  sessionId: string,
  templateId: string,
  expectedRev: number | undefined
): CodexSession {
  const template = requireTemplate(db, templateId);
  return editPrep(db, sessionId, expectedRev, (existing) => ({
    prep: reapplyTemplate(existing.prep, template),
    prepTemplateId: template.id
  }));
}

/** Ticks or unticks one checklist item, wherever it sits in the prep. */
export function tickPrepItem(db: CodexDb, sessionId: string, itemId: string, done: boolean): CodexSession {
  return editPrep(db, sessionId, undefined, (existing, now) => {
    if (!prepItems(existing.prep).some(({ item }) => item.id === itemId))
      throw new CodexNotFoundError("That checklist item is no longer in this session's prep.");
    return {
      prep: existing.prep.map((section) =>
        section.type === "checklist"
          ? {
              ...section,
              items: section.items.map((item) =>
                item.id !== itemId || item.done === done ? item : { ...item, done, doneAt: done ? now : null }
              )
            }
          : section
      )
    };
  });
}

/** Sets the live board's current scene: a scene in the prep, or none. */
export function setCurrentScene(db: CodexDb, sessionId: string, sceneId: string | null): CodexSession {
  const wanted = optionalId(sceneId);
  return editPrep(db, sessionId, undefined, (existing) => {
    if (wanted !== null && !prepScenes(existing.prep).some(({ scene }) => scene.id === wanted))
      throw new CodexNotFoundError("That scene is no longer in this session's prep.");
    return { currentSceneId: wanted };
  });
}

/** Revealing is not editing: neither `rev` nor `updatedAt` moves. */
export function setSessionRevealed(db: CodexDb, sessionId: string, revealed: boolean): CodexSession {
  if (!getSession(db, sessionId)) throw new CodexNotFoundError("That session no longer exists.");
  write(db, () => {
    db.database.prepare("UPDATE codex_sessions SET revealed = ? WHERE id = ?").run(revealed ? 1 : 0, sessionId);
  });
  return getSession(db, sessionId)!;
}

/** Leaf delete. The active pointer has no FK, so the delete clears it or it would name a missing record. */
export function deleteSession(db: CodexDb, sessionId: string): void {
  db.database.prepare("DELETE FROM codex_sessions WHERE id = ?").run(sessionId);
  unindex(db, "session", sessionId);
  scrubLinks(db, "session", sessionId);
  db.database.prepare("UPDATE codex_meta SET active_session_id = NULL WHERE active_session_id = ?").run(sessionId);
}

export function getSession(db: CodexDb, sessionId: string): CodexSession | null {
  if (!isId(sessionId)) return null;
  const row = db.database.prepare(`SELECT ${SESSION_COLUMNS} FROM codex_sessions WHERE id = ?`).get(sessionId) as
    SessionRowRaw | undefined;
  return row ? toSession(row) : null;
}

/** Numbered sessions first in number order, then unnumbered ones oldest-first. */
export function listSessions(db: CodexDb): CodexSession[] {
  return (
    db.database
      .prepare(
        `SELECT ${SESSION_COLUMNS} FROM codex_sessions ORDER BY (session_number IS NULL), session_number, created_at`
      )
      .all() as SessionRowRaw[]
  ).map(toSession);
}

/** The id of a session that must exist; not-found otherwise, and never a silent null. */
export function requireSession(db: CodexDb, sessionId: string): string {
  const resolved = id(sessionId);
  if (!getSession(db, resolved)) throw new CodexNotFoundError("That session no longer exists.");
  return resolved;
}

/** The session the table is playing, or null. */
export function activeSessionId(db: CodexDb): string | null {
  const row = db.database.prepare("SELECT active_session_id FROM codex_meta WHERE id = 1").get() as {
    active_session_id: string | null;
  };
  return row.active_session_id;
}

/** Leaf write of the pointer alone. */
export function writeActiveSession(db: CodexDb, sessionId: string | null): void {
  db.database.prepare("UPDATE codex_meta SET active_session_id = ? WHERE id = 1").run(sessionId);
}

/** Activating a session does not edit it. */
export function setActiveSession(db: CodexDb, sessionId: string | null): string | null {
  const next = sessionId === null ? null : requireSession(db, sessionId);
  write(db, () => writeActiveSession(db, next));
  return next;
}
