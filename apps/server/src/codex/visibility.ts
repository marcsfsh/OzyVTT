import { pageLinkKey, type CodexMap, type CodexMarker, type CodexQuest, type CodexStanding } from "@vtt/domain";
import type { CodexStore } from "../codex-store.js";
import {
  EVERYONE,
  projectPlayerJournalEntry,
  projectPlayerPageMarker,
  type CodexPageMarkerRecord,
  type CodexReader,
  type CodexRevealAuditRecord,
  type CodexSearchRecord,
  type PlayerChronicleContext,
  type PlayerConnectionContext,
  type PlayerReaderContext,
  type PlayerSessionNumberContext
} from "../codex-projections.js";
import { audienceReaches, blockSourceText, parseBlocks } from "./blocks.js";
import type { CodexDb } from "./db.js";
import type { CodexSearchRef } from "./search.js";
import { isId } from "./validate.js";

/**
 * What a player may see, decided here. The SQL predicates gate reads that never load a record (search, media).
 * The rest resolve a record's neighbours (its map, its linked pages, its session or quest) into the context a
 * player projection takes, so a projection can drop a link to anything hidden. The router asks this module and
 * never tests a reveal flag itself; the projections stay allow-lists.
 */

/**
 * Player search visibility for one of the player tables, one arm per kind matching that kind's player read (a
 * weaker arm would make search the leak). A marker also needs its map revealed. `ELSE 0` fails closed.
 */
export function playerSearchVisibleSql(table: "codex_search_player" | "codex_search_character"): string {
  return `(CASE ${table}.kind
  WHEN 'page' THEN EXISTS (SELECT 1 FROM codex_pages WHERE codex_pages.id = ${table}.record_id AND codex_pages.revealed = 1)
  WHEN 'journal' THEN EXISTS (SELECT 1 FROM codex_journal WHERE codex_journal.id = ${table}.record_id AND codex_journal.revealed = 1)
  WHEN 'map' THEN EXISTS (SELECT 1 FROM codex_maps WHERE codex_maps.id = ${table}.record_id AND codex_maps.revealed = 1)
  WHEN 'marker' THEN EXISTS (SELECT 1 FROM codex_markers JOIN codex_maps ON codex_maps.id = codex_markers.map_id
    WHERE codex_markers.id = ${table}.record_id AND codex_markers.revealed = 1 AND codex_maps.revealed = 1)
  WHEN 'quest' THEN EXISTS (SELECT 1 FROM codex_quests WHERE codex_quests.id = ${table}.record_id AND codex_quests.revealed = 1)
  WHEN 'session' THEN EXISTS (SELECT 1 FROM codex_sessions WHERE codex_sessions.id = ${table}.record_id AND codex_sessions.revealed = 1)
  ELSE 0 END)`;
}

/**
 * Whether a player may load an uploaded image: it is a revealed page's banner, or it appears in the player text of
 * a revealed page, quest, session recap or journal entry, or in a block of a revealed page or quest the reader may see.
 */
export function mediaVisibleToPlayers(db: CodexDb, assetId: string, reader: CodexReader = EVERYONE): boolean {
  if (!isId(assetId)) return false;
  const pattern = `%${assetId}%`;
  if (
    db.database
      .prepare(
        `SELECT 1 FROM codex_pages WHERE revealed = 1 AND (banner_asset_id = :id OR player_body LIKE :pattern)
         UNION ALL SELECT 1 FROM codex_quests WHERE revealed = 1 AND player_body LIKE :pattern
         UNION ALL SELECT 1 FROM codex_sessions WHERE revealed = 1 AND recap_body LIKE :pattern
         UNION ALL SELECT 1 FROM codex_journal WHERE revealed = 1 AND player_text LIKE :pattern
         LIMIT 1`
      )
      .get({ id: assetId, pattern }) !== undefined
  )
    return true;
  // A block the reader may see, stamped for an audience that gives it to them, as the page read decides.
  for (const table of ["codex_pages", "codex_quests"] as const)
    for (const row of db.database
      .prepare(`SELECT blocks_json FROM ${table} WHERE revealed = 1 AND blocks_json LIKE ?`)
      .all(pattern) as Array<{ blocks_json: string }>)
      for (const block of parseBlocks(row.blocks_json))
        if (
          audienceReaches(block, reader.characterIds) &&
          block.reveals.some((reveal) =>
            reveal.to === "everyone"
              ? block.audience === "everyone"
              : reader.characterIds.has(reveal.to) && block.characterIds.includes(reveal.to)
          ) &&
          blockSourceText(block).includes(assetId)
        )
          return true;
  return false;
}

/** Whether a revealed Codex map uses this image, so a player may fetch the map's picture. */
export function mapAssetVisibleToPlayers(db: CodexDb, assetId: string): boolean {
  if (!isId(assetId)) return false;
  return (
    db.database.prepare("SELECT 1 FROM codex_maps WHERE asset_id = ? AND revealed = 1 LIMIT 1").get(assetId) !==
    undefined
  );
}

// Neighbour resolution, over the store's ungated reads.

/** The visible subset of `pageIds`; a missing page counts as hidden. */
export function revealedPageIdsIn(store: CodexStore, pageIds: readonly string[]): ReadonlySet<string> {
  return new Set(pageIds.filter((pageId) => store.getPage(pageId)?.revealedToPlayers ?? false));
}

export function isPageVisible(store: CodexStore, pageId: string): boolean {
  return revealedPageIdsIn(store, [pageId]).has(pageId);
}

export function isMapVisible(store: CodexStore, mapId: string | null): boolean {
  return mapId !== null && (store.getMap(mapId)?.revealedToPlayers ?? false);
}

/** A map keeps its parent link only when the parent is visible, or it would name a secret ancestor. */
export function mapContext(store: CodexStore, map: CodexMap): Readonly<{ parentRevealed: boolean }> {
  return { parentRevealed: isMapVisible(store, map.parentMapId) };
}

/** A pin with its map's gate and which of its links lead somewhere visible. */
export function markerRecord(store: CodexStore, marker: CodexMarker): CodexPageMarkerRecord {
  return {
    marker,
    mapRevealed: isMapVisible(store, marker.mapId),
    revealedPageIds: revealedPageIdsIn(store, marker.pageIds),
    subMapRevealed: isMapVisible(store, marker.subMapId)
  };
}

export function isMarkerVisible(store: CodexStore, markerId: string): boolean {
  const marker = store.getMarker(markerId);
  return marker !== null && projectPlayerPageMarker(markerRecord(store, marker)) !== null;
}

/** A quest's linked pages, filtered to those the party may open, and who the quest's text is for. */
export function questContext(
  store: CodexStore,
  quest: CodexQuest,
  reader?: PlayerReaderContext
): Readonly<{ revealedEntityIds: ReadonlySet<string> }> & Partial<PlayerReaderContext> {
  return { revealedEntityIds: revealedPageIdsIn(store, quest.entityIds), ...reader };
}

/** A standing bar for a secret faction would leak the faction even untitled. */
export function standingContext(store: CodexStore, standing: CodexStanding): Readonly<{ factionRevealed: boolean }> {
  return { factionRevealed: isPageVisible(store, standing.factionPageId) };
}

/**
 * The facts every player journal read needs, resolved once per request: hidden sessions (an entry must not
 * name one), revealed quests (a quest history record follows its quest), and the revealed pages a payload can
 * name (standing factions, downtime characters). Anything not listed fails closed.
 */
export function journalContext(store: CodexStore): PlayerSessionNumberContext {
  return {
    unrevealedSessionIds: new Set(
      store
        .listSessions()
        .filter((session) => !session.revealedToPlayers)
        .map((session) => session.id)
    ),
    revealedQuestIds: new Set(
      store
        .listQuests()
        .filter((quest) => quest.revealedToPlayers)
        .map((quest) => quest.id)
    ),
    revealedPageIds: revealedPageIdsIn(store, [
      ...store.listStanding().map((row) => row.factionPageId),
      ...store.downtimeCharacterPageIds()
    ])
  };
}

/**
 * What a page or quest read needs beyond its row: who it is for, which pages a `[[link]]` may still lead to (the
 * revealed ones), and which sessions a stamp may name (the revealed ones).
 */
export function readerContext(store: CodexStore, reader: CodexReader): PlayerReaderContext {
  return {
    reader,
    openableLinkKeys: new Set(
      store
        .listPages()
        .filter((page) => page.revealedToPlayers)
        .map((page) => pageLinkKey(page.title))
    ),
    revealedSessionIds: new Set(
      store
        .listSessions()
        .filter((session) => session.revealedToPlayers)
        .map((session) => session.id)
    )
  };
}

/** The journal context plus the published clock and every revealed page, for the chronicle's payload links. */
export function chronicleContext(store: CodexStore, reader: CodexReader = EVERYONE): PlayerChronicleContext {
  return {
    ...journalContext(store),
    publishedInstant: store.publishedInstant(),
    revealedPageIds: new Set(
      store
        .listPages()
        .filter((page) => page.revealedToPlayers)
        .map((page) => page.id)
    ),
    pages: readerContext(store, reader)
  };
}

/**
 * The context for player connections. A non-page source counts as visible only when its own player
 * projection would show it, so a connection never bypasses the gates the list reads apply.
 */
export function connectionContext(store: CodexStore, reader: CodexReader = EVERYONE): PlayerConnectionContext {
  const revealedPageIds = new Set(
    store
      .listPages()
      .filter((page) => page.revealedToPlayers)
      .map((page) => page.id)
  );
  const revealedSourceIds = new Set<string>();
  const revealedSessionIds = new Set<string>();
  for (const session of store.listSessions())
    if (session.revealedToPlayers) {
      revealedSourceIds.add(session.id);
      revealedSessionIds.add(session.id);
    }
  for (const quest of store.listQuests()) if (quest.revealedToPlayers) revealedSourceIds.add(quest.id);
  const context = journalContext(store);
  for (const entry of store.listTimeline())
    if (projectPlayerJournalEntry(entry, context) !== null) revealedSourceIds.add(entry.id);
  return { revealedPageIds, revealedSourceIds, reader, revealedSessionIds };
}

/** A search hit's live record plus what its player predicate needs. Null when the record is gone. */
export function searchRecord(store: CodexStore, ref: CodexSearchRef): CodexSearchRecord | null {
  switch (ref.kind) {
    case "page": {
      const page = store.getPage(ref.id);
      return page ? { kind: "page", page } : null;
    }
    case "journal": {
      const entry = store.getEntry(ref.id);
      return entry ? { kind: "journal", entry } : null;
    }
    case "map": {
      const map = store.getMap(ref.id);
      return map ? { kind: "map", map } : null;
    }
    case "marker": {
      const marker = store.getMarker(ref.id);
      return marker ? { kind: "marker", marker, mapRevealed: isMapVisible(store, marker.mapId) } : null;
    }
    case "quest": {
      const quest = store.getQuest(ref.id);
      return quest ? { kind: "quest", quest } : null;
    }
    case "session": {
      const session = store.getSession(ref.id);
      return session ? { kind: "session", session } : null;
    }
  }
}

/** Every record the reveal audit considers, each with the context its player projection takes. */
export function revealAuditRecords(store: CodexStore): CodexRevealAuditRecord[] {
  const maps = store.listMaps();
  const sessionContext = journalContext(store);
  return [
    { kind: "date", calendar: store.getCalendar(), publishedDate: store.getPublishedDate() } as const,
    ...store.listPages().map((page) => ({ kind: "page", page }) as const),
    ...maps.map((map) => ({ kind: "map", map, ...mapContext(store, map) }) as const),
    ...maps.flatMap((map) =>
      store.listMarkers(map.id).map((marker) => ({ kind: "marker", ...markerRecord(store, marker) }) as const)
    ),
    ...store.listTimeline().map((entry) => ({ kind: "journal", entry, sessionContext }) as const),
    ...store.listSessions().map((session) => ({ kind: "session", session }) as const),
    ...store.listQuests().map((quest) => ({ kind: "quest", quest, ...questContext(store, quest) }) as const),
    ...store.listStanding().map(
      (standing) =>
        ({
          kind: "standing",
          standing,
          ...standingContext(store, standing),
          factionTitle: store.getPage(standing.factionPageId)?.title ?? null
        }) as const
    )
  ];
}
