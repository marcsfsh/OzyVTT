import type { DatabaseSync } from "node:sqlite";

/**
 * The first-shown date of pages and journal entries: when players could first read the record. It is set once, by
 * the write that first lets players read it, and never moves after, so a hide and a re-reveal keep it. Player
 * shapes carry it and leave out `createdAt`, which would tell players when the GM prepared the record.
 */

/**
 * A journal row a player can read, as `projectPlayerJournalEntry` gates it: revealed, and a standing or quest
 * record only while its faction page or quest is revealed too. A weaker test would date a record before players
 * could see it.
 */
const JOURNAL_SHOWN_SQL = `codex_journal.revealed = 1
  AND (codex_journal.kind <> 'standing' OR EXISTS (SELECT 1 FROM codex_pages faction WHERE faction.revealed = 1
    AND faction.id = (CASE WHEN json_valid(codex_journal.payload_json) THEN json_extract(codex_journal.payload_json, '$.factionPageId') END)))
  AND (codex_journal.kind <> 'quest' OR EXISTS (SELECT 1 FROM codex_quests quest WHERE quest.revealed = 1
    AND quest.id = (CASE WHEN json_valid(codex_journal.payload_json) THEN json_extract(codex_journal.payload_json, '$.questId') END)))`;

/** Dates every record players can read that has no first-shown date yet. Every Codex write runs it. */
export function stampFirstShown(database: DatabaseSync, at: string): void {
  database.prepare("UPDATE codex_pages SET first_shown_at = ? WHERE first_shown_at IS NULL AND revealed = 1").run(at);
  database
    .prepare(`UPDATE codex_journal SET first_shown_at = ? WHERE first_shown_at IS NULL AND ${JOURNAL_SHOWN_SQL}`)
    .run(at);
}

/**
 * Dates every record players can read today that has no first-shown date by its `createdAt`, the date the player
 * shapes carried before this one existed. Used when an older database or backup arrives without the date.
 */
export function backfillFirstShown(database: DatabaseSync): void {
  database.exec(
    "UPDATE codex_pages SET first_shown_at = created_at WHERE first_shown_at IS NULL AND revealed = 1;" +
      `UPDATE codex_journal SET first_shown_at = created_at WHERE first_shown_at IS NULL AND ${JOURNAL_SHOWN_SQL};`
  );
}
