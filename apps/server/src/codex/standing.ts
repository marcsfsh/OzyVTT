import type { CodexStanding } from "@vtt/domain";
import { resolveNow } from "./calendar.js";
import { freshId, stamp, write, type CodexDb } from "./db.js";
import { standingPayload } from "./journal-kinds.js";
import { writeEntry } from "./journal.js";
import { getPage } from "./pages.js";
import { activeSessionId } from "./sessions.js";
import {
  CodexNotFoundError,
  CodexValidationError,
  MAX_STANDING,
  MIN_STANDING,
  id,
  isId,
  standingValue
} from "./validate.js";

/**
 * Where the party stands with each faction (`codex_standing`, one row per faction page). The row is the current
 * value; the history is `standing` journal records. Each is revealed on its own.
 */

type StandingRowRaw = {
  id: string;
  faction_page_id: string;
  value: number;
  revealed: number;
  created_at: string;
  updated_at: string;
  first_shown_at: string | null;
};
const STANDING_COLUMNS = "id, faction_page_id, value, revealed, created_at, updated_at, first_shown_at";

function toStanding(row: StandingRowRaw): CodexStanding {
  return {
    id: row.id,
    factionPageId: row.faction_page_id,
    // Clamped on read too: the column has no CHECK, so a hand-edited value reads as the nearest legal one.
    value: Math.min(MAX_STANDING, Math.max(MIN_STANDING, Math.trunc(row.value))),
    revealedToPlayers: row.revealed === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    firstShownAt: row.first_shown_at
  };
}

/** Leaf write of a whole, already-validated standing row (restore). */
export function insertStanding(db: CodexDb, standing: CodexStanding): void {
  db.database
    .prepare(`INSERT INTO codex_standing (${STANDING_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(
      standing.id,
      standing.factionPageId,
      standing.value,
      standing.revealedToPlayers ? 1 : 0,
      standing.createdAt,
      standing.updatedAt,
      standing.firstShownAt
    );
}

/** Oldest first, so a faction does not jump as it is adjusted. */
export function listStanding(db: CodexDb): CodexStanding[] {
  return (
    db.database
      .prepare(`SELECT ${STANDING_COLUMNS} FROM codex_standing ORDER BY created_at, id`)
      .all() as StandingRowRaw[]
  ).map(toStanding);
}

/** One faction's standing, or null when none was ever set (which reads as Neutral, and is no error). */
export function getStanding(db: CodexDb, factionPageId: string): CodexStanding | null {
  if (!isId(factionPageId)) return null;
  const row = db.database
    .prepare(`SELECT ${STANDING_COLUMNS} FROM codex_standing WHERE faction_page_id = ?`)
    .get(factionPageId) as StandingRowRaw | undefined;
  return row ? toStanding(row) : null;
}

/**
 * Sets the value and appends its `standing` record in one write. The delta is measured from the clamped previous
 * value (0 if none), so the history always sums to the bar; a record is written even when nothing moved.
 */
export function setStanding(db: CodexDb, factionPageId: string, value: number, reason: string): CodexStanding {
  const pageId = id(factionPageId);
  const page = getPage(db, pageId);
  if (!page) throw new CodexNotFoundError("That faction page no longer exists.");
  const existing = getStanding(db, pageId);
  // A faction page is needed to start tracking and never to keep tracking, so a retyped page's standing stays editable.
  if (!existing && page.entityType !== "faction")
    throw new CodexValidationError("Standing is tracked against a faction. Pick a faction page.");
  const next = standingValue(value);
  const payload = standingPayload({ factionPageId: pageId, delta: next - (existing?.value ?? 0), reason });
  const now = stamp(db);
  write(db, () => {
    if (existing)
      db.database
        .prepare("UPDATE codex_standing SET value = ?, updated_at = ? WHERE faction_page_id = ?")
        .run(next, now, pageId);
    else
      insertStanding(db, {
        id: freshId(),
        factionPageId: pageId,
        value: next,
        revealedToPlayers: false,
        createdAt: now,
        updatedAt: now,
        firstShownAt: null
      });
    writeEntry(db, {
      // The prose lives only in the payload's `reason`: copied into `playerText` it would gain a second reveal
      // gate and put GM-authored text into the player search index.
      playerText: "",
      gmText: null,
      revealedToPlayers: false,
      attachMarkerId: null,
      attachPageId: null,
      kind: "standing",
      sourceEncounterId: null,
      sessionId: activeSessionId(db),
      realDate: null,
      dated: resolveNow(db),
      payload
    });
  });
  return getStanding(db, pageId)!;
}

/** Revealing is not editing, and writes no history record. */
export function setStandingRevealed(db: CodexDb, factionPageId: string, revealed: boolean): CodexStanding {
  const pageId = id(factionPageId);
  if (!getStanding(db, pageId)) throw new CodexNotFoundError("That faction has no standing recorded yet.");
  write(db, () => {
    db.database
      .prepare("UPDATE codex_standing SET revealed = ? WHERE faction_page_id = ?")
      .run(revealed ? 1 : 0, pageId);
  });
  return getStanding(db, pageId)!;
}
