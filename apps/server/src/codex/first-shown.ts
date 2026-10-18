import type { DatabaseSync } from "node:sqlite";
import { audienceKeys, blocksPending, parseBlocks, serializeBlocks, type StoredReveal } from "./blocks.js";

/**
 * First-shown dates: when players could first read a record, a hidden block or a connection. Each is set once, by
 * the write that first lets players read it, and never moves after, so a hide and a re-reveal keep it. Player
 * shapes carry it (or are ordered by it) and leave out `createdAt`, which would tell players when the GM prepared
 * the record.
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

/** Each kind's test for "a player can read it", matching that kind's player projection. */
const SHOWN_SQL: ReadonlyArray<readonly [table: string, shown: string]> = [
  ["codex_pages", "codex_pages.revealed = 1"],
  ["codex_journal", JOURNAL_SHOWN_SQL],
  ["codex_maps", "codex_maps.revealed = 1"],
  [
    "codex_markers",
    "codex_markers.revealed = 1 AND EXISTS (SELECT 1 FROM codex_maps map WHERE map.id = codex_markers.map_id AND map.revealed = 1)"
  ],
  ["codex_quests", "codex_quests.revealed = 1"],
  ["codex_sessions", "codex_sessions.revealed = 1"],
  [
    "codex_standing",
    "codex_standing.revealed = 1 AND EXISTS (SELECT 1 FROM codex_pages faction WHERE faction.id = codex_standing.faction_page_id AND faction.revealed = 1)"
  ]
];

/** A declared connection a player can read: on the player layer, between two revealed pages. */
const RELATIONSHIP_SHOWN_SQL = `codex_relationships.layer = 'player'
  AND EXISTS (SELECT 1 FROM codex_pages a WHERE a.id = codex_relationships.from_page_id AND a.revealed = 1)
  AND EXISTS (SELECT 1 FROM codex_pages b WHERE b.id = codex_relationships.to_page_id AND b.revealed = 1)`;

/** The moment as players knew it: the active session and the players' published date. Never the GM's clock. */
function momentOf(database: DatabaseSync, at: string): Omit<StoredReveal, "to"> {
  const row = database
    .prepare(
      `SELECT m.active_session_id AS session_id, s.session_number AS session_number,
         m.published_year AS year, m.published_month AS month, m.published_day AS day
       FROM codex_meta m LEFT JOIN codex_sessions s ON s.id = m.active_session_id WHERE m.id = 1`
    )
    .get() as {
    session_id: string | null;
    session_number: number | null;
    year: number | null;
    month: number | null;
    day: number | null;
  };
  const parts = [row.year, row.month, row.day];
  return {
    at,
    sessionId: row.session_id,
    sessionNumber: row.session_number,
    inWorldDate: parts.every((part) => Number.isSafeInteger(part))
      ? { year: row.year!, month: row.month!, day: row.day! }
      : null
  };
}

/**
 * Stamps each block of a revealed page or quest with each audience it reaches and has no stamp for. Only records
 * flagged as having such a block are read.
 */
function stampBlocks(database: DatabaseSync, moment: () => Omit<StoredReveal, "to">): void {
  for (const table of ["codex_pages", "codex_quests"] as const) {
    const rows = database
      .prepare(`SELECT id, blocks_json FROM ${table} WHERE revealed = 1 AND blocks_pending = 1`)
      .all() as Array<{ id: string; blocks_json: string }>;
    if (rows.length === 0) continue;
    const stamp = moment();
    const update = database.prepare(`UPDATE ${table} SET blocks_json = ?, blocks_pending = 0 WHERE id = ?`);
    for (const row of rows) {
      const blocks = parseBlocks(row.blocks_json).map((block) => {
        const missing = audienceKeys(block).filter((key) => !block.reveals.some((reveal) => reveal.to === key));
        return missing.length === 0
          ? block
          : { ...block, reveals: [...block.reveals, ...missing.map((to) => ({ to, ...stamp }))] };
      });
      update.run(serializeBlocks(blocks), row.id);
    }
  }
}

/** Dates every record, block and connection players can read that has no first-shown date yet. Every Codex write runs it. */
export function stampFirstShown(database: DatabaseSync, at: string): void {
  for (const [table, shown] of SHOWN_SQL)
    database.prepare(`UPDATE ${table} SET first_shown_at = ? WHERE first_shown_at IS NULL AND ${shown}`).run(at);
  let moment: Omit<StoredReveal, "to"> | undefined;
  const now = () => (moment ??= momentOf(database, at));
  const learning = database
    .prepare(`SELECT id FROM codex_relationships WHERE learned_at IS NULL AND ${RELATIONSHIP_SHOWN_SQL}`)
    .all() as Array<{ id: string }>;
  if (learning.length > 0) {
    const stamp = now();
    const update = database.prepare(
      "UPDATE codex_relationships SET learned_at = ?, learned_session_id = ?, learned_session_number = ?, learned_year = ?, learned_month = ?, learned_day = ? WHERE id = ?"
    );
    for (const { id } of learning)
      update.run(
        stamp.at,
        stamp.sessionId,
        stamp.sessionNumber,
        stamp.inWorldDate?.year ?? null,
        stamp.inWorldDate?.month ?? null,
        stamp.inWorldDate?.day ?? null,
        id
      );
  }
  stampBlocks(database, now);
}

/**
 * Dates every record players can read today that has no first-shown date by its `createdAt`, the date the player
 * shapes carried, or the order the player lists came in, before this one existed. A connection players can read
 * gets the empty mark for "learned before stamps existed": its `createdAt` was never theirs to read. Used when an
 * older database or backup arrives without the dates.
 */
export function backfillFirstShown(database: DatabaseSync): void {
  for (const [table, shown] of SHOWN_SQL)
    database.exec(`UPDATE ${table} SET first_shown_at = created_at WHERE first_shown_at IS NULL AND ${shown};`);
  database.exec(
    `UPDATE codex_relationships SET learned_at = '' WHERE learned_at IS NULL AND ${RELATIONSHIP_SHOWN_SQL};`
  );
}

/** Migration 3's backfill, kept as it ran then: pages and journal entries only. */
export function backfillPagesAndEntries(database: DatabaseSync): void {
  database.exec(
    "UPDATE codex_pages SET first_shown_at = created_at WHERE first_shown_at IS NULL AND revealed = 1;" +
      `UPDATE codex_journal SET first_shown_at = created_at WHERE first_shown_at IS NULL AND ${JOURNAL_SHOWN_SQL};`
  );
}

/** Whether a record's blocks give the next reveal pass work. Kept beside the blocks on every write. */
export function pendingFlag(blocksJson: string): number {
  return blocksPending(parseBlocks(blocksJson)) ? 1 : 0;
}
