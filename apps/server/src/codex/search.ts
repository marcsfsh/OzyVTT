import type { CodexDb } from "./db.js";
import type { CodexQuestObjective } from "./validate.js";
import { PLAYER_SEARCH_VISIBLE_SQL } from "./visibility.js";

/**
 * The search index: one FTS table per audience. Every write that changes a record's text reindexes it in the
 * same transaction and every delete unindexes it; a reveal needs no reindex because visibility is checked
 * against the live row when the player table is read.
 *
 * Adding a kind is a viewer-safety change with three gates: its `index*` writer puts only player-layer text in
 * `codex_search_player` (nothing downstream catches GM text there), `PLAYER_SEARCH_VISIBLE_SQL`, and
 * `projectPlayerSearchHit`.
 */
export type CodexRecordKind = "page" | "journal" | "map" | "marker" | "quest" | "session";
export const CODEX_RECORD_KINDS: readonly CodexRecordKind[] = ["page", "journal", "map", "marker", "quest", "session"];
/** One search hit as the store returns it: what kind of record matched, and which one. */
export type CodexSearchRef = Readonly<{ kind: CodexRecordKind; id: string }>;
/** `truncated` says more matches exist than `hits` holds. */
export type CodexSearchResult = Readonly<{ hits: readonly CodexSearchRef[]; truncated: boolean }>;
/** The one cap for every kind. */
const SEARCH_LIMIT = 50;

type IndexText = Readonly<{ title: string; body: string }>;

/** Replace one record's row in both indexes. `player` must contain player-layer text only. */
function indexRecord(db: CodexDb, kind: CodexRecordKind, recordId: string, player: IndexText, gm: IndexText) {
  unindex(db, kind, recordId);
  db.database
    .prepare("INSERT INTO codex_search_player (kind, record_id, title, body) VALUES (?, ?, ?, ?)")
    .run(kind, recordId, player.title, player.body);
  db.database
    .prepare("INSERT INTO codex_search_gm (kind, record_id, title, body) VALUES (?, ?, ?, ?)")
    .run(kind, recordId, gm.title, gm.body);
}

export function unindex(db: CodexDb, kind: CodexRecordKind, recordId: string): void {
  db.database.prepare("DELETE FROM codex_search_player WHERE kind = ? AND record_id = ?").run(kind, recordId);
  db.database.prepare("DELETE FROM codex_search_gm WHERE kind = ? AND record_id = ?").run(kind, recordId);
}

/** The player row gets the body, public field values and tags; GM fields and the GM body go only to the GM row. */
export function indexPage(
  db: CodexDb,
  page: Readonly<{
    id: string;
    title: string;
    playerBody: string;
    gmBody: string;
    fields: Readonly<Record<string, string>>;
    gmFields: Readonly<Record<string, string>>;
    tags: readonly string[];
  }>
): void {
  const fieldText = Object.values(page.fields).join(" ");
  const gmFieldText = Object.values(page.gmFields).join(" ");
  const tagText = page.tags.join(" ");
  indexRecord(
    db,
    "page",
    page.id,
    { title: page.title, body: `${page.playerBody}\n${fieldText}\n${tagText}` },
    { title: page.title, body: `${page.playerBody}\n${page.gmBody}\n${fieldText}\n${gmFieldText}\n${tagText}` }
  );
}

/** A map's name and tags have no GM half, so both audiences index the same text. */
export function indexMap(db: CodexDb, mapId: string, name: string, tags: readonly string[]): void {
  const row = { title: name, body: tags.join(" ") };
  indexRecord(db, "map", mapId, row, row);
}

/** Single-layer like a map; a hidden pin is hidden by the read-time predicate. */
export function indexMarker(db: CodexDb, markerId: string, label: string | null, tags: readonly string[]): void {
  const row = { title: label ?? "", body: tags.join(" ") };
  indexRecord(db, "marker", markerId, row, row);
}

/** `gmBody` only in the GM row: a revealed quest passes the other two gates, so GM text here would leak via hits. */
export function indexQuest(
  db: CodexDb,
  quest: Readonly<{
    id: string;
    title: string;
    playerBody: string;
    gmBody: string;
    objectives: readonly CodexQuestObjective[];
    tags: readonly string[];
  }>
): void {
  const objectiveText = quest.objectives.map((objective) => objective.text).join(" ");
  const tagText = quest.tags.join(" ");
  indexRecord(
    db,
    "quest",
    quest.id,
    { title: quest.title, body: `${quest.playerBody}\n${objectiveText}\n${tagText}` },
    { title: quest.title, body: `${quest.playerBody}\n${quest.gmBody}\n${objectiveText}\n${tagText}` }
  );
}

/** Prep and attendees only in the GM row, or a player's query could match GM-only text on a revealed session. */
export function indexSession(
  db: CodexDb,
  session: Readonly<{
    id: string;
    sessionNumber: number | null;
    realDate: string | null;
    attendees: readonly string[];
    prepBody: string;
    recapBody: string;
    tags: readonly string[];
  }>
): void {
  const title = session.sessionNumber === null ? "" : `Session ${session.sessionNumber}`;
  const realDate = session.realDate ?? "";
  const tagText = session.tags.join(" ");
  indexRecord(
    db,
    "session",
    session.id,
    { title, body: `${session.recapBody}\n${realDate}\n${tagText}` },
    {
      title,
      body: `${session.prepBody}\n${session.recapBody}\n${realDate}\n${session.attendees.join(" ")}\n${tagText}`
    }
  );
}

/** A journal entry is two-layer like a page. Payload text is never indexed, so it cannot reach player search. */
export function indexEntry(
  db: CodexDb,
  entryId: string,
  playerText: string,
  gmText: string | null,
  tags: readonly string[]
): void {
  const tagText = tags.join(" ");
  indexRecord(
    db,
    "journal",
    entryId,
    { title: "", body: `${playerText}\n${tagText}` },
    { title: "", body: `${playerText}\n${gmText ?? ""}\n${tagText}` }
  );
}

/**
 * Search one audience's index. Ranking: an exact title match first, then bm25 with the title weighted 10x
 * (`bm25()` takes a weight for every declared column, the UNINDEXED ones included).
 */
export function searchAll(
  db: CodexDb,
  audience: "player" | "gm",
  query: string,
  kinds?: readonly CodexRecordKind[]
): CodexSearchResult {
  const match = ftsQuery(query);
  if (!match) return { hits: [], truncated: false };
  // Never "" here (`ftsQuery` requires a letter or digit), so empty-titled rows cannot match the first tier.
  const exactTitle = query.trim().toLowerCase();
  const table = audience === "gm" ? "codex_search_gm" : "codex_search_player";
  const kindFilter = kinds && kinds.length > 0 ? ` AND ${table}.kind IN (${kinds.map(() => "?").join(", ")})` : "";
  const visibility = audience === "gm" ? "" : ` AND ${PLAYER_SEARCH_VISIBLE_SQL}`;
  // One row past the cap: its presence is what says the results were cut off.
  const sql = `SELECT kind, record_id FROM ${table} WHERE ${table} MATCH ?${kindFilter}${visibility}
    ORDER BY (CASE WHEN LOWER(${table}.title) = ? THEN 0 ELSE 1 END), bm25(${table}, 0.0, 0.0, 10.0, 1.0)
    LIMIT ${SEARCH_LIMIT + 1}`;
  try {
    const rows = (
      db.database.prepare(sql).all(match, ...(kinds ?? []), exactTitle) as Array<{ kind: string; record_id: string }>
    ).filter((row): row is { kind: CodexRecordKind; record_id: string } =>
      (CODEX_RECORD_KINDS as readonly string[]).includes(row.kind)
    );
    return {
      hits: rows.slice(0, SEARCH_LIMIT).map((row) => ({ kind: row.kind, id: row.record_id })),
      truncated: rows.length > SEARCH_LIMIT
    };
  } catch {
    return { hits: [], truncated: false };
  }
}

/** A free-text query as a safe FTS5 prefix MATCH; null when nothing usable remains. */
function ftsQuery(raw: string): string | null {
  const terms = raw.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!terms || terms.length === 0) return null;
  return terms
    .slice(0, 12)
    .map((term) => `"${term}"*`)
    .join(" ");
}
