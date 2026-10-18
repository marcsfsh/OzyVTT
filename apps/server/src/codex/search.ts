import type { CodexAudience, CodexRecordKind } from "@vtt/domain";
import { audienceReaches, blockSourceText, type StoredBlock } from "./blocks.js";
import type { CodexDb } from "./db.js";
import { playerSearchVisibleSql } from "./visibility.js";

/**
 * The search index: one FTS table per audience, plus `codex_search_character` for text shown only to some party
 * characters (one row per record and character). Every write that changes a record's text or an audience in it
 * reindexes it in the same transaction and every delete unindexes it; a record's reveal needs no reindex because
 * visibility is checked against the live row when a player table is read.
 *
 * Adding a kind is a viewer-safety change with three gates: its `index*` writer puts only text everyone may read in
 * `codex_search_player`, and only text a character may read in that character's rows (nothing downstream catches
 * GM text there), `playerSearchVisibleSql`, and `projectPlayerSearchHit`.
 */
export const CODEX_RECORD_KINDS: readonly CodexRecordKind[] = ["page", "journal", "map", "marker", "quest", "session"];
/** One search hit as the store returns it: what kind of record matched, and which one. */
export type CodexSearchRef = Readonly<{ kind: CodexRecordKind; id: string }>;
/** `truncated` says more matches exist than `hits` holds. */
export type CodexSearchRefs = Readonly<{ hits: readonly CodexSearchRef[]; truncated: boolean }>;
/** The one cap for every kind. */
const SEARCH_LIMIT = 50;

/** The first `SEARCH_LIMIT` hits, and whether there were more. */
export function capSearch<T>(hits: readonly T[]): Readonly<{ hits: T[]; truncated: boolean }> {
  return { hits: hits.slice(0, SEARCH_LIMIT), truncated: hits.length > SEARCH_LIMIT };
}

type IndexText = Readonly<{ title: string; body: string }>;

/**
 * Replace one record's rows in every index. `player` must contain only text everyone who can read the record may
 * read, and each `characters` entry only text that character may read beyond it.
 */
function indexRecord(
  db: CodexDb,
  kind: CodexRecordKind,
  recordId: string,
  player: IndexText,
  gm: IndexText,
  characters: ReadonlyMap<string, IndexText> = new Map()
) {
  unindex(db, kind, recordId);
  db.database
    .prepare("INSERT INTO codex_search_player (kind, record_id, title, body) VALUES (?, ?, ?, ?)")
    .run(kind, recordId, player.title, player.body);
  db.database
    .prepare("INSERT INTO codex_search_gm (kind, record_id, title, body) VALUES (?, ?, ?, ?)")
    .run(kind, recordId, gm.title, gm.body);
  const insert = db.database.prepare(
    "INSERT INTO codex_search_character (kind, record_id, character_id, title, body) VALUES (?, ?, ?, ?, ?)"
  );
  for (const [characterId, text] of characters) insert.run(kind, recordId, characterId, text.title, text.body);
}

export function unindex(db: CodexDb, kind: CodexRecordKind, recordId: string): void {
  for (const table of ["codex_search_player", "codex_search_gm", "codex_search_character"])
    db.database.prepare(`DELETE FROM ${table} WHERE kind = ? AND record_id = ?`).run(kind, recordId);
}

type Shown = Readonly<{ audience: CodexAudience; characterIds: readonly string[] }>;
/** Each character's own text: what is shown to them by name, beyond what everyone reads. */
function characterTexts(title: string, items: ReadonlyArray<Shown & Readonly<{ text: string }>>) {
  const byCharacter = new Map<string, string[]>();
  for (const item of items)
    if (item.audience === "characters")
      for (const characterId of item.characterIds)
        byCharacter.set(characterId, [...(byCharacter.get(characterId) ?? []), item.text]);
  return new Map([...byCharacter].map(([characterId, texts]) => [characterId, { title, body: texts.join("\n") }]));
}
const everyoneText = (items: ReadonlyArray<Shown & Readonly<{ text: string }>>) =>
  items.filter((item) => audienceReaches(item, new Set())).map((item) => item.text);

/** The player row gets the player text, blocks shown to everyone, fields shown to everyone and tags. */
export function indexPage(
  db: CodexDb,
  page: Readonly<{
    id: string;
    title: string;
    playerBody: string;
    blocks: readonly StoredBlock[];
    fields: Readonly<Record<string, string>>;
    hiddenFields: readonly string[];
    tags: readonly string[];
  }>
): void {
  const hidden = new Set(page.hiddenFields);
  const shownFieldText = Object.entries(page.fields)
    .filter(([key]) => !hidden.has(key))
    .map(([, value]) => value)
    .join(" ");
  const fieldText = Object.values(page.fields).join(" ");
  const tagText = page.tags.join(" ");
  const blocks = page.blocks.map((block) => ({ ...block, text: blockSourceText(block) }));
  const shownBlocks = everyoneText(blocks).join("\n");
  const allBlocks = blocks.map((block) => block.text).join("\n");
  indexRecord(
    db,
    "page",
    page.id,
    { title: page.title, body: `${page.playerBody}\n${shownBlocks}\n${shownFieldText}\n${tagText}` },
    { title: page.title, body: `${page.playerBody}\n${allBlocks}\n${fieldText}\n${tagText}` },
    characterTexts(page.title, blocks)
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

/**
 * Hidden blocks and objectives only in the rows of those they are shown to: a revealed quest passes the other two
 * gates, so hidden text here would leak via hits.
 */
export function indexQuest(
  db: CodexDb,
  quest: Readonly<{
    id: string;
    title: string;
    playerBody: string;
    blocks: readonly StoredBlock[];
    objectives: ReadonlyArray<Shown & Readonly<{ text: string }>>;
    tags: readonly string[];
  }>
): void {
  const tagText = quest.tags.join(" ");
  const items = [...quest.blocks.map((block) => ({ ...block, text: blockSourceText(block) })), ...quest.objectives];
  const shown = everyoneText(items).join("\n");
  const all = items.map((item) => item.text).join("\n");
  indexRecord(
    db,
    "quest",
    quest.id,
    { title: quest.title, body: `${quest.playerBody}\n${shown}\n${tagText}` },
    { title: quest.title, body: `${quest.playerBody}\n${all}\n${tagText}` },
    characterTexts(quest.title, items)
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
 * The GM's search: the first `SEARCH_LIMIT` matches. Ranking: an exact title match first, then bm25 with the title
 * weighted 10x (`bm25()` takes a weight for every declared column, the UNINDEXED ones included). bm25 weighs a
 * word by how many rows hold it, which tells the GM nothing, since the GM reads every row.
 */
function searchGm(db: CodexDb, query: string, kinds: readonly CodexRecordKind[]): CodexSearchRefs {
  const match = ftsQuery(query);
  if (!match) return { hits: [], truncated: false };
  // Never "" here (`ftsQuery` requires a letter or digit), so empty-titled rows cannot match the first tier.
  const exactTitle = query.trim().toLowerCase();
  // One row past the cap: its presence is what says the results were cut off.
  const sql = `SELECT kind, record_id FROM codex_search_gm WHERE codex_search_gm MATCH ? AND codex_search_gm.kind IN (${kinds.map(() => "?").join(", ")})
    ORDER BY (CASE WHEN LOWER(codex_search_gm.title) = ? THEN 0 ELSE 1 END), bm25(codex_search_gm, 0.0, 0.0, 10.0, 1.0)
    LIMIT ${SEARCH_LIMIT + 1}`;
  try {
    const rows = db.database.prepare(sql).all(match, ...kinds, exactTitle) as Array<{
      kind: CodexRecordKind;
      record_id: string;
    }>;
    return capSearch(rows.map((row) => ({ kind: row.kind, id: row.record_id })));
  } catch {
    return { hits: [], truncated: false };
  }
}

/**
 * Every match a player may see, ranked, with no cap, so the caller can gate hits and then cap. A reader holding
 * characters also matches the text shown to those characters. Ranking: a title equal to the query, then a title
 * holding every query word, then the rest; within a tier by kind, title and id. Each row is ranked on its own title
 * alone. bm25 would weigh a word by how many rows hold it, hidden rows included, and so let a GM's hidden prep
 * reorder a player's hits.
 */
export function searchPlayerMatches(
  db: CodexDb,
  query: string,
  kinds: readonly CodexRecordKind[] = CODEX_RECORD_KINDS,
  characterIds: ReadonlySet<string> = new Set()
): CodexSearchRef[] {
  const match = ftsQuery(query);
  if (!match) return [];
  const terms = queryWords(query).map(folded);
  // Never "" here (a query needs a letter or digit to get this far), so empty-titled rows cannot match tier 0.
  const exactTitle = folded(query.trim());
  const wanted = kinds.length > 0 ? kinds : CODEX_RECORD_KINDS;
  const kindList = wanted.map(() => "?").join(", ");
  const characterList = [...characterIds].map(() => "?").join(", ");
  const sql = `SELECT kind, record_id, title FROM codex_search_player WHERE codex_search_player MATCH ? AND codex_search_player.kind IN (${kindList}) AND ${playerSearchVisibleSql("codex_search_player")}${
    characterIds.size === 0
      ? ""
      : ` UNION SELECT kind, record_id, title FROM codex_search_character WHERE codex_search_character MATCH ? AND codex_search_character.kind IN (${kindList}) AND codex_search_character.character_id IN (${characterList}) AND ${playerSearchVisibleSql("codex_search_character")}`
  }`;
  const parameters =
    characterIds.size === 0 ? [match, ...wanted] : [match, ...wanted, match, ...wanted, ...characterIds];
  let rows: Array<{ kind: CodexRecordKind; record_id: string; title: string }>;
  try {
    rows = db.database.prepare(sql).all(...parameters) as typeof rows;
  } catch {
    return [];
  }
  const tierOf = (title: string) => {
    if (folded(title.trim()) === exactTitle) return 0;
    const words = wordsOf(title);
    return terms.every((term) => words.some((word) => word.startsWith(term))) ? 1 : 2;
  };
  return rows
    .map((row) => ({ row, tier: tierOf(row.title), title: folded(row.title) }))
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        CODEX_RECORD_KINDS.indexOf(a.row.kind) - CODEX_RECORD_KINDS.indexOf(b.row.kind) ||
        compareText(a.title, b.title) ||
        compareText(a.row.record_id, b.row.record_id)
    )
    .filter(({ row }, index, sorted) => index === 0 || sorted[index - 1]!.row.record_id !== row.record_id)
    .map(({ row }) => ({ kind: row.kind, id: row.record_id }));
}

/** One audience's first `SEARCH_LIMIT` matches. Only known kinds are asked for, so the cap counts usable rows. */
/** A player audience here is a reader with no character. */
export function searchAll(
  db: CodexDb,
  audience: "player" | "gm",
  query: string,
  kinds: readonly CodexRecordKind[] = CODEX_RECORD_KINDS
): CodexSearchRefs {
  const wanted = kinds.length > 0 ? kinds : CODEX_RECORD_KINDS;
  return audience === "gm" ? searchGm(db, query, wanted) : capSearch(searchPlayerMatches(db, query, wanted));
}

/** The words of a free-text query, at most twelve. */
function queryWords(raw: string): string[] {
  return (
    raw
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.slice(0, 12) ?? []
  );
}

/** A free-text query as a safe FTS5 prefix MATCH; null when nothing usable remains. */
function ftsQuery(raw: string): string | null {
  const terms = queryWords(raw);
  return terms.length === 0 ? null : terms.map((term) => `"${term}"*`).join(" ");
}

/** Lower case with accents dropped, as the index's tokenizer reads text. */
function folded(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function wordsOf(text: string): string[] {
  return folded(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
