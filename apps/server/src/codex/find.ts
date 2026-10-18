import {
  CODEX_SEARCH_TYPES,
  type CodexChangeAudience,
  type CodexChangeKind,
  type CodexEntityType,
  type CodexHome,
  type CodexRecordKind,
  type CodexRevealCheckRow,
  type CodexSearchHit,
  type CodexSearchResult,
  type CodexSearchType,
  type CodexSearchVisibility,
  type PlayerCodexSearchHit,
  type PlayerCodexSearchResult
} from "@vtt/domain";
import type { CodexStore } from "../codex-store.js";
import {
  AUDIT_JOURNAL_FALLBACK,
  excerpt,
  projectPlayerJournalEntry,
  projectPlayerPage,
  projectPlayerPageMarker,
  projectPlayerQuest,
  sessionDisplayTitle
} from "../codex-projections.js";
import { prepText } from "./prep.js";
import { CODEX_RECORD_KINDS } from "./search.js";
import { connectionContext, journalContext, markerRecord, questContext } from "./visibility.js";

/**
 * The Codex's find surfaces: search with filters and a multi-level sort, and the GM's home. Both audiences share the
 * filtering and sorting here over one record shape. The GM's records are built here from the store; a player's are
 * built in `player-reads.ts` from that player's own projections, so their type carries no hidden text at all.
 */

// ----- The query -----

export type CodexSortLevel = Readonly<{ key: string; direction: "asc" | "desc" }>;
/** A parsed search request. An empty `types` means every type. */
export type CodexFindQuery = Readonly<{
  q: string;
  types: ReadonlySet<CodexSearchType>;
  /** The GM's only; a player's query always carries `all`. */
  visibility: CodexSearchVisibility;
  modifiedFrom: string | null;
  modifiedTo: string | null;
  sort: readonly CodexSortLevel[];
  limit: number;
}>;
export const DEFAULT_FIND_LIMIT = 50;
export const MAX_FIND_LIMIT = 500;

// ----- Records -----

/** One record as search sees it. `shown` is the text a reader of the record reads: the player layer. */
export type FindRecord = Readonly<{
  kind: CodexRecordKind;
  id: string;
  title: string;
  tags: readonly string[];
  entityType: CodexEntityType | null;
  mapId: string | null;
  type: CodexSearchType;
  modifiedAt: string | null;
  columns: Readonly<Record<string, string>>;
  shown: readonly string[];
}>;
/** The GM's record adds whether players can read it, the GM-only text, and who saw its latest change. */
export type GmFindRecord = FindRecord &
  Readonly<{
    revealedToPlayers: boolean;
    modifiedAt: string;
    hidden: readonly string[];
    changedAt: string;
    change: CodexChangeKind;
    audience: CodexChangeAudience;
  }>;

/** A text's lines, blank ones dropped. */
export function linesOf(text: string | null | undefined): string[] {
  return (text ?? "").split(/\r?\n/).filter((line) => line.trim() !== "");
}
/** Column values with blanks left out, so an absent column and an empty one read the same. */
export function columnsOf(values: Readonly<Record<string, string | null | undefined>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values))
    if (value !== null && value !== undefined && value.trim()) out[key] = value;
  return out;
}

/**
 * A page's text for the GM's search, split by who reads it: `shown` reaches players once the page is revealed and
 * `hidden` never does. Hidden blocks plug in here when pages gain them.
 */
export function gmSearchText(page: ReturnType<CodexStore["listFullPages"]>[number]): {
  shown: string[];
  hidden: string[];
} {
  return {
    shown: [...linesOf(page.playerBody), ...Object.values(page.fields)],
    hidden: [...linesOf(page.gmBody), ...Object.values(page.gmFields)]
  };
}

/** Every record the GM can find, each with what its player read would show. */
export function gmFindRecords(store: CodexStore): GmFindRecord[] {
  const records: GmFindRecord[] = [];
  // Only a page keeps a reveal apart from an edit, so another kind's reveal reads as an edit.
  const plain = (revealed: boolean, record: Readonly<{ createdAt: string; updatedAt: string }>) => ({
    revealedToPlayers: revealed,
    modifiedAt: record.updatedAt,
    changedAt: record.updatedAt,
    change: (record.createdAt === record.updatedAt ? "created" : "edited") as CodexChangeKind,
    audience: (revealed ? "everyone" : "hidden") as CodexChangeAudience
  });

  for (const page of store.listFullPages()) {
    const text = gmSearchText(page);
    const revealed = projectPlayerPage(page) !== null;
    // A page knows when players last saw it change, so its change is theirs only when that moved with the edit. A
    // reveal or a hide moves only the players' time.
    const flipped = page.playerUpdatedAt > page.updatedAt;
    const changedAt = flipped ? page.playerUpdatedAt : page.updatedAt;
    records.push({
      kind: "page",
      id: page.id,
      title: page.title,
      tags: page.tags,
      entityType: page.entityType,
      mapId: null,
      type: page.entityType,
      revealedToPlayers: revealed,
      modifiedAt: page.updatedAt,
      changedAt,
      change: flipped ? (revealed ? "revealed" : "hidden") : page.createdAt === page.updatedAt ? "created" : "edited",
      audience: revealed && page.playerUpdatedAt >= page.updatedAt ? "everyone" : "hidden",
      columns: columnsOf({ ...page.fields, ...page.gmFields }),
      shown: text.shown,
      hidden: text.hidden
    });
  }

  const sessionContext = journalContext(store);
  for (const entry of store.listTimeline()) {
    records.push({
      kind: "journal",
      id: entry.id,
      title: excerpt(entry.playerText || entry.gmText || "") || AUDIT_JOURNAL_FALLBACK[entry.kind],
      tags: entry.tags,
      entityType: null,
      mapId: null,
      type: "journal",
      ...plain(projectPlayerJournalEntry(entry, sessionContext) !== null, entry),
      columns: columnsOf({ kind: entry.kind, date: entry.inWorldLabel }),
      shown: linesOf(entry.playerText),
      hidden: linesOf(entry.gmText)
    });
  }

  const maps = store.listMaps();
  const mapNames = new Map(maps.map((map) => [map.id, map.name]));
  for (const map of maps) {
    records.push({
      kind: "map",
      id: map.id,
      title: map.name,
      tags: map.tags,
      entityType: null,
      mapId: null,
      type: "map",
      ...plain(map.revealedToPlayers, map),
      columns: columnsOf({ kind: map.kind, parent: map.parentMapId ? mapNames.get(map.parentMapId) : null }),
      shown: [],
      hidden: []
    });
    for (const marker of store.listMarkers(map.id)) {
      records.push({
        kind: "marker",
        id: marker.id,
        title: marker.label ?? "",
        tags: marker.tags,
        entityType: null,
        mapId: marker.mapId,
        type: "marker",
        ...plain(projectPlayerPageMarker(markerRecord(store, marker)) !== null, marker),
        columns: columnsOf({ map: map.name }),
        shown: [],
        hidden: []
      });
    }
  }

  for (const quest of store.listQuests()) {
    records.push({
      kind: "quest",
      id: quest.id,
      title: quest.title,
      tags: quest.tags,
      entityType: null,
      mapId: null,
      type: "quest",
      ...plain(projectPlayerQuest(quest, questContext(store, quest)) !== null, quest),
      columns: columnsOf({ status: quest.status }),
      shown: [...linesOf(quest.playerBody), ...quest.objectives.map((objective) => objective.text)],
      hidden: linesOf(quest.gmBody)
    });
  }

  for (const session of store.listSessions()) {
    records.push({
      kind: "session",
      id: session.id,
      title: sessionDisplayTitle({ sessionNumber: session.sessionNumber, recap: session.recapBody }),
      tags: session.tags,
      entityType: null,
      mapId: null,
      type: "session",
      ...plain(session.revealedToPlayers, session),
      columns: columnsOf({
        number: session.sessionNumber === null ? null : String(session.sessionNumber),
        date: session.realDate,
        status: session.status
      }),
      shown: [...linesOf(session.recapBody), ...(session.realDate ? [session.realDate] : [])],
      hidden: [...linesOf(prepText(session.prep)), ...session.attendees]
    });
  }
  return records;
}

// ----- Matching -----

/** Lower case with accents dropped, as the index's tokenizer reads text. */
export function folded(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}
function wordsOf(text: string): string[] {
  return folded(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}
/** The words of a free-text query, at most twelve, as the index reads them. */
export function searchTerms(q: string): string[] {
  return (folded(q).match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 12);
}
function termsIn(terms: readonly string[], text: string): number {
  const words = wordsOf(text);
  return terms.filter((term) => words.some((word) => word.startsWith(term))).length;
}
/** Whether every term starts a word somewhere in these texts, as the index's prefix match reads them. */
export function coversTerms(terms: readonly string[], texts: readonly string[]): boolean {
  const words = texts.flatMap(wordsOf);
  return terms.every((term) => words.some((word) => word.startsWith(term)));
}

const LINE_LENGTH = 160;
/** One line around its first match, bounded, with the markup that would read as noise taken out. */
function cutLine(line: string, terms: readonly string[]): string {
  const flat = line
    .replace(/^\s*(?:#{1,6}|[-*+]|\d+\.)\s+/, "")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length <= LINE_LENGTH) return flat;
  const lower = flat.toLowerCase();
  // A word with accents may not be found by plain case folding; the line then shows from its start.
  const found = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0);
  const at = found.length > 0 ? Math.min(...found) : 0;
  const start = at < 40 ? 0 : at - 40;
  const end = Math.min(flat.length, start + LINE_LENGTH - 2);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end).trim()}${end < flat.length ? "…" : ""}`;
}
/** The line holding the most terms, earliest first; null when none holds one. */
function bestLine(
  terms: readonly string[],
  lines: readonly string[]
): Readonly<{ line: string; score: number }> | null {
  let best: { line: string; score: number } | null = null;
  for (const line of lines) {
    const score = termsIn(terms, line);
    if (score > 0 && (best === null || score > best.score)) best = { line, score };
  }
  return best;
}

// ----- Sorting -----

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
type SortValue = string | number | null;

function compareLevel(a: SortValue, b: SortValue, direction: "asc" | "desc"): number {
  // A missing value goes last whichever way the level runs, as a spreadsheet leaves blanks at the bottom.
  if (a === null || b === null) return a === null ? (b === null ? 0 : 1) : -1;
  const order = typeof a === "number" && typeof b === "number" ? a - b : collator.compare(String(a), String(b));
  return direction === "desc" ? -order : order;
}

function sortValue<T extends FindRecord>(
  record: T,
  key: string,
  rank: (record: T) => number,
  revealed: ((record: T) => boolean) | null
): SortValue {
  switch (key) {
    case "relevance":
      return rank(record);
    case "name":
      return record.title.trim() || null;
    case "type":
      return CODEX_SEARCH_TYPES.indexOf(record.type);
    case "modified":
      return record.modifiedAt;
    case "visibility":
      return revealed === null ? null : revealed(record) ? 0 : 1;
    default:
      return record.columns[key] ?? null;
  }
}

/** The search's filters, sort and cap, the same for both audiences. `revealed` is null for a player. */
function filterAndSort<T extends FindRecord>(
  records: readonly T[],
  query: CodexFindQuery,
  rank: (record: T) => number,
  revealed: ((record: T) => boolean) | null
): Readonly<{ hits: T[]; truncated: boolean; total: number }> {
  const kept = records.filter(
    (record) =>
      (query.types.size === 0 || query.types.has(record.type)) &&
      (revealed === null || query.visibility === "all" || revealed(record) === (query.visibility === "revealed")) &&
      (query.modifiedFrom === null || (record.modifiedAt !== null && record.modifiedAt >= query.modifiedFrom)) &&
      (query.modifiedTo === null || (record.modifiedAt !== null && record.modifiedAt <= query.modifiedTo))
  );
  const levels: readonly CodexSortLevel[] =
    query.sort.length > 0
      ? query.sort
      : searchTerms(query.q).length > 0
        ? [
            { key: "relevance", direction: "asc" },
            { key: "name", direction: "asc" }
          ]
        : [{ key: "name", direction: "asc" }];
  const sorted = kept
    .map((record) => ({ record, values: levels.map((level) => sortValue(record, level.key, rank, revealed)) }))
    .sort((a, b) => {
      for (const [index, level] of levels.entries()) {
        const order = compareLevel(a.values[index]!, b.values[index]!, level.direction);
        if (order !== 0) return order;
      }
      // The last word is fixed, so equal rows never swap between two reads.
      return (
        CODEX_RECORD_KINDS.indexOf(a.record.kind) - CODEX_RECORD_KINDS.indexOf(b.record.kind) ||
        collator.compare(a.record.title, b.record.title) ||
        (a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0)
      );
    })
    .map(({ record }) => record);
  return { hits: sorted.slice(0, query.limit), truncated: sorted.length > query.limit, total: sorted.length };
}

// ----- The two searches -----

/**
 * The GM's search. With a query, the index decides what matches and ranks it (an exact title, then bm25); the line
 * shown is the one holding the most query words, from either layer, with `hidden` set for GM-only text.
 */
export function findGm(store: CodexStore, query: CodexFindQuery): CodexSearchResult {
  const terms = searchTerms(query.q);
  const records = gmFindRecords(store);
  let candidates: GmFindRecord[] = records;
  let rankOf = (_record: GmFindRecord) => 0;
  if (query.q.trim() !== "") {
    const byKey = new Map(records.map((record) => [`${record.kind}|${record.id}`, record]));
    const matches = store.searchGmMatches(query.q);
    const rank = new Map(matches.map((ref, index) => [`${ref.kind}|${ref.id}`, index]));
    candidates = matches.map((ref) => byKey.get(`${ref.kind}|${ref.id}`)).filter((record) => record !== undefined);
    rankOf = (record) => rank.get(`${record.kind}|${record.id}`) ?? Number.MAX_SAFE_INTEGER;
  }
  const found = filterAndSort(candidates, query, rankOf, (record) => record.revealedToPlayers);
  return {
    hits: found.hits.map((record): CodexSearchHit => {
      const shown = bestLine(terms, record.shown);
      const hidden = bestLine(terms, record.hidden);
      const best = hidden !== null && (shown === null || hidden.score > shown.score) ? hidden : shown;
      return {
        kind: record.kind,
        id: record.id,
        title: record.title,
        tags: record.tags,
        entityType: record.entityType,
        mapId: record.mapId,
        type: record.type,
        revealedToPlayers: record.revealedToPlayers,
        modifiedAt: record.modifiedAt,
        columns: record.columns,
        match: best === null ? null : { line: cutLine(best.line, terms), hidden: best === hidden && best !== shown }
      };
    }),
    truncated: found.truncated,
    total: found.total
  };
}

/**
 * A player's search over records built from that player's own reads. A record matches only on text the player
 * reads, so a hit is never there because of hidden text. The ranking reads each record's own title (an exact title,
 * then a title holding every word, then the rest), so nothing a player can't see moves their order.
 */
export function findPlayer(records: readonly FindRecord[], query: CodexFindQuery): PlayerCodexSearchResult {
  const terms = searchTerms(query.q);
  const exact = folded(query.q.trim());
  const candidates =
    query.q.trim() === ""
      ? records
      : terms.length === 0
        ? []
        : records.filter((record) => coversTerms(terms, [record.title, ...record.shown, ...record.tags]));
  const tier = (record: FindRecord) => {
    if (folded(record.title.trim()) === exact) return 0;
    return coversTerms(terms, [record.title]) ? 1 : 2;
  };
  const found = filterAndSort(candidates, query, tier, null);
  return {
    hits: found.hits.map((record): PlayerCodexSearchHit => {
      const best = bestLine(terms, record.shown);
      return {
        kind: record.kind,
        id: record.id,
        title: record.title,
        tags: record.tags,
        entityType: record.entityType,
        mapId: record.mapId,
        type: record.type,
        modifiedAt: record.modifiedAt,
        columns: record.columns,
        match: best === null ? null : { line: cutLine(best.line, terms) }
      };
    }),
    truncated: found.truncated,
    total: found.total
  };
}

// ----- The GM's home -----

const RECENT_LIMIT = 12;
const REVEAL_CHECK_LIMIT = 100;
/** What a field holds when the GM has not decided yet. */
const PLACEHOLDER = /^\s*(\?+|unknown|tbd|tba|todo)\s*$/i;

/** Revealed records that point at something players can't read. Players get plain text there, so each is safe. */
export function revealCheck(store: CodexStore): CodexRevealCheckRow[] {
  const pages = store.listFullPages();
  const pageById = new Map(pages.map((page) => [page.id, page]));
  const maps = store.listMaps();
  const mapById = new Map(maps.map((map) => [map.id, map]));
  const context = connectionContext(store);
  const hiddenPage = (pageId: string) => pageById.has(pageId) && !context.revealedPageIds.has(pageId);
  const row = (fields: Omit<CodexRevealCheckRow, "mapId" | "fieldKey"> & Partial<CodexRevealCheckRow>) => ({
    mapId: null,
    fieldKey: null,
    ...fields
  });
  const rows: CodexRevealCheckRow[] = [];

  // Player-facing text and player-layer connections that name a hidden page.
  const sourceTitle = (kind: CodexRecordKind, recordId: string): string => {
    switch (kind) {
      case "page":
        return pageById.get(recordId)?.title ?? "";
      case "quest":
        return store.getQuest(recordId)?.title ?? "";
      case "session": {
        const session = store.getSession(recordId);
        return session ? sessionDisplayTitle({ sessionNumber: session.sessionNumber, recap: session.recapBody }) : "";
      }
      case "journal": {
        const entry = store.getEntry(recordId);
        return entry ? excerpt(entry.playerText) || AUDIT_JOURNAL_FALLBACK[entry.kind] : "";
      }
      default:
        return "";
    }
  };
  const seen = new Set<string>();
  for (const edge of store.listAllConnections()) {
    const sourceShown =
      edge.fromKind === "page" ? context.revealedPageIds.has(edge.fromId) : context.revealedSourceIds.has(edge.fromId);
    const key = `${edge.fromKind}|${edge.fromId}|${edge.toPageId}`;
    if (edge.layer !== "player" || !sourceShown || !hiddenPage(edge.toPageId) || seen.has(key)) continue;
    seen.add(key);
    rows.push(
      row({
        reason: "link",
        kind: edge.fromKind,
        id: edge.fromId,
        title: sourceTitle(edge.fromKind, edge.fromId),
        targetKind: "page",
        targetId: edge.toPageId,
        targetTitle: pageById.get(edge.toPageId)!.title
      })
    );
  }

  // Shown pins whose page or sub-map links lead somewhere hidden, and hidden pins on shown maps.
  for (const map of maps) {
    for (const marker of store.listMarkers(map.id)) {
      const pin = { kind: "marker" as const, id: marker.id, title: marker.label ?? "", mapId: map.id };
      if (projectPlayerPageMarker(markerRecord(store, marker)) !== null) {
        for (const pageId of marker.pageIds.filter(hiddenPage))
          rows.push(
            row({
              reason: "link",
              ...pin,
              targetKind: "page",
              targetId: pageId,
              targetTitle: pageById.get(pageId)!.title
            })
          );
        const subMap = marker.subMapId ? mapById.get(marker.subMapId) : undefined;
        if (subMap && !subMap.revealedToPlayers)
          rows.push(row({ reason: "link", ...pin, targetKind: "map", targetId: subMap.id, targetTitle: subMap.name }));
      } else if (map.revealedToPlayers && !marker.revealedToPlayers) {
        rows.push(
          row({
            reason: "hidden-pin",
            kind: "map",
            id: map.id,
            title: map.name,
            targetKind: "marker",
            targetId: marker.id,
            targetTitle: marker.label ?? ""
          })
        );
      }
    }
  }

  // Shown quests that concern hidden pages.
  for (const quest of store.listQuests()) {
    if (projectPlayerQuest(quest, questContext(store, quest)) === null) continue;
    for (const pageId of quest.entityIds.filter(hiddenPage))
      rows.push(
        row({
          reason: "link",
          kind: "quest",
          id: quest.id,
          title: quest.title,
          targetKind: "page",
          targetId: pageId,
          targetTitle: pageById.get(pageId)!.title
        })
      );
  }

  // Fields players read that still hold a placeholder.
  for (const page of pages) {
    const shown = projectPlayerPage(page);
    if (shown === null) continue;
    for (const [fieldKey, value] of Object.entries(shown.fields))
      if (PLACEHOLDER.test(value))
        rows.push(
          row({
            reason: "placeholder",
            kind: "page",
            id: page.id,
            title: page.title,
            targetKind: null,
            targetId: null,
            targetTitle: null,
            fieldKey
          })
        );
  }
  return rows;
}

/** The GM's home: counts per type, the latest changes with who saw each, and the reveal check. */
export function gmHome(store: CodexStore): CodexHome {
  const records = gmFindRecords(store);
  const check = revealCheck(store);
  return {
    collections: CODEX_SEARCH_TYPES.map((type) => {
      const ofType = records.filter((record) => record.type === type);
      const revealed = ofType.filter((record) => record.revealedToPlayers).length;
      return { type, revealed, hidden: ofType.length - revealed };
    }),
    recent: [...records]
      .sort(
        (a, b) =>
          (a.changedAt < b.changedAt ? 1 : a.changedAt > b.changedAt ? -1 : 0) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      )
      .slice(0, RECENT_LIMIT)
      .map((record) => ({
        kind: record.kind,
        id: record.id,
        title: record.title,
        type: record.type,
        mapId: record.mapId,
        changedAt: record.changedAt,
        change: record.change,
        audience: record.audience,
        characterIds: []
      })),
    revealCheck: { rows: check.slice(0, REVEAL_CHECK_LIMIT), total: check.length }
  };
}
