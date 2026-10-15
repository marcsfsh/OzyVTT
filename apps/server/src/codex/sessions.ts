import type { CodexSession, CodexSessionStatus } from "@vtt/domain";
import { freshId, stamp, write, type CodexDb } from "./db.js";
import { rebuildLinks, scrubLinks } from "./links.js";
import { indexSession, unindex } from "./search.js";
import {
  CodexNotFoundError,
  CodexRevisionConflictError,
  CodexValidationError,
  attendees,
  body,
  id,
  isId,
  parseStringArray,
  sessionNo,
  sessionSceneIds,
  sessionStatus,
  shortLabel,
  tags
} from "./validate.js";

/**
 * Sessions (`codex_sessions`) and which one the table is playing (`codex_meta.active_session_id`). Prep is the
 * GM half and the recap the player half. Like pages, `rev` is the editor's conflict token.
 */

export type CodexSessionCreateInput = Readonly<{
  sessionNumber?: number | null;
  realDate?: string | null;
  attendees?: readonly string[];
  prepBody?: string;
  recapBody?: string;
  revealedToPlayers?: boolean;
  status?: CodexSessionStatus;
  tags?: readonly string[];
  sceneIds?: readonly string[];
}>;
/** No `revealedToPlayers`: reveal has its own route, so an edit cannot publish a recap as a side effect. */
export type CodexSessionUpdateInput = Readonly<{
  sessionNumber?: number | null;
  realDate?: string | null;
  attendees?: readonly string[];
  prepBody?: string;
  recapBody?: string;
  status?: CodexSessionStatus;
  tags?: readonly string[];
  sceneIds?: readonly string[];
}>;

type SessionRowRaw = {
  id: string;
  session_number: number | null;
  real_date: string | null;
  attendees_json: string;
  prep_body: string;
  recap_body: string;
  revealed: number;
  status: string;
  tags_json: string;
  scene_ids_json: string;
  rev: number;
  created_at: string;
  updated_at: string;
};
const SESSION_COLUMNS =
  "id, session_number, real_date, attendees_json, prep_body, recap_body, revealed, status, tags_json, scene_ids_json, rev, created_at, updated_at";

function toSession(row: SessionRowRaw): CodexSession {
  return {
    id: row.id,
    sessionNumber: row.session_number,
    realDate: row.real_date,
    attendees: parseStringArray(row.attendees_json),
    prepBody: row.prep_body,
    recapBody: row.recap_body,
    revealedToPlayers: row.revealed === 1,
    // Unrecognised statuses read as `planned`.
    status: row.status === "played" ? "played" : "planned",
    tags: parseStringArray(row.tags_json),
    sceneIds: parseStringArray(row.scene_ids_json),
    rev: row.rev,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** Leaf write of a whole, already-validated session (create and restore). */
export function insertSession(db: CodexDb, session: CodexSession): void {
  db.database
    .prepare(`INSERT INTO codex_sessions (${SESSION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      session.id,
      session.sessionNumber,
      session.realDate,
      JSON.stringify(session.attendees),
      session.prepBody,
      session.recapBody,
      session.revealedToPlayers ? 1 : 0,
      session.status,
      JSON.stringify(session.tags),
      JSON.stringify(session.sceneIds),
      session.rev,
      session.createdAt,
      session.updatedAt
    );
  indexSession(db, session);
  // The recap is the player layer and prep the GM layer, so a page named only in prep is a GM-only connection.
  rebuildLinks(db, "session", session.id, session.recapBody, session.prepBody);
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

export function createSession(db: CodexDb, input: CodexSessionCreateInput): CodexSession {
  const now = stamp(db);
  const session: CodexSession = {
    id: freshId(),
    sessionNumber: sessionNo(input.sessionNumber),
    realDate: shortLabel(input.realDate, 40, "date"),
    attendees: attendees(input.attendees),
    prepBody: body(input.prepBody),
    recapBody: body(input.recapBody),
    revealedToPlayers: input.revealedToPlayers === true,
    status: sessionStatus(input.status),
    tags: tags(input.tags),
    sceneIds: sessionSceneIds(input.sceneIds),
    rev: 1,
    createdAt: now,
    updatedAt: now
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
  const next: CodexSession = {
    ...existing,
    sessionNumber: input.sessionNumber === undefined ? existing.sessionNumber : sessionNo(input.sessionNumber),
    realDate: input.realDate === undefined ? existing.realDate : shortLabel(input.realDate, 40, "date"),
    attendees: input.attendees === undefined ? existing.attendees : attendees(input.attendees),
    prepBody: input.prepBody === undefined ? existing.prepBody : body(input.prepBody),
    recapBody: input.recapBody === undefined ? existing.recapBody : body(input.recapBody),
    status: input.status === undefined ? existing.status : sessionStatus(input.status),
    tags: input.tags === undefined ? existing.tags : tags(input.tags),
    sceneIds: input.sceneIds === undefined ? existing.sceneIds : sessionSceneIds(input.sceneIds),
    // `rev` and `updatedAt` move together on an edit; a reveal moves neither.
    rev: existing.rev + 1,
    updatedAt: stamp(db)
  };
  guardSessionNumber(next.sessionNumber, () =>
    write(db, () => {
      db.database
        .prepare(
          "UPDATE codex_sessions SET session_number = ?, real_date = ?, attendees_json = ?, prep_body = ?, recap_body = ?, status = ?, tags_json = ?, scene_ids_json = ?, rev = ?, updated_at = ? WHERE id = ?"
        )
        .run(
          next.sessionNumber,
          next.realDate,
          JSON.stringify(next.attendees),
          next.prepBody,
          next.recapBody,
          next.status,
          JSON.stringify(next.tags),
          JSON.stringify(next.sceneIds),
          next.rev,
          next.updatedAt,
          sessionId
        );
      indexSession(db, next);
      rebuildLinks(db, "session", sessionId, next.recapBody, next.prepBody);
    })
  );
  return getSession(db, sessionId)!;
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

/** The id of a session that must exist; not-found otherwise, rather than a silent null. */
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
