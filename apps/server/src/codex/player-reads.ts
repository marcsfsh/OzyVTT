import { createHash } from "node:crypto";
import type {
  PlayerCodexCalendar,
  PlayerCodexChronicleRecord,
  PlayerCodexConnection,
  PlayerCodexHome,
  PlayerCodexJournalEntry,
  PlayerCodexMap,
  PlayerCodexMarker,
  PlayerCodexPage,
  PlayerCodexPageConnection,
  PlayerCodexPageSummary,
  PlayerCodexQuest,
  PlayerCodexSearchResult,
  PlayerCodexSession,
  PlayerCodexStanding
} from "@vtt/domain";
import type { CodexStore } from "../codex-store.js";
import {
  AUDIT_JOURNAL_FALLBACK,
  EVERYONE,
  excerpt,
  orderPlayerAttached,
  orderPlayerChronicle,
  orderPlayerTimeline,
  plainUnopenableLinks,
  projectPlayerCalendar,
  projectPlayerChronicleRecord,
  projectPlayerConnections,
  projectPlayerJournalEntry,
  projectPlayerMap,
  projectPlayerPage,
  projectPlayerPageConnections,
  projectPlayerPageMarker,
  projectPlayerPageSummary,
  projectPlayerQuest,
  projectPlayerSession,
  projectPlayerStanding,
  sessionDisplayTitle,
  type CodexReader,
  type PlayerChronicleContext,
  type PlayerConnectionContext,
  type PlayerReaderContext,
  type PlayerSessionNumberContext
} from "../codex-projections.js";
import { columnsOf, findPlayer, linesOf, type CodexFindQuery, type FindRecord } from "./find.js";
import {
  chronicleContext,
  connectionContext,
  isMapVisible,
  isMarkerVisible,
  isPageVisible,
  journalContext,
  mapContext,
  markerRecord,
  questContext,
  readerContext,
  standingContext
} from "./visibility.js";

/** The most a player's home lists as new since their last visit. */
const NEW_SINCE_LIMIT = 50;

/** The store reads that player reads repeat, by name. Each is answered once per `PlayerCodexReads`. */
const REPEATED_READS: ReadonlySet<PropertyKey> = new Set([
  "listPages",
  "listFullPages",
  "listTimeline",
  "listSessions",
  "listQuests",
  "listStanding",
  "listMaps",
  "listMarkers",
  "getPage",
  "getMap",
  "downtimeCharacterPageIds",
  "publishedInstant"
]);

/**
 * The store with `REPEATED_READS` remembered. Safe because one instance serves one synchronous moment, in which
 * nothing writes, and no caller changes what a read answers. Everything else goes straight to the store.
 */
function rememberingReads(store: CodexStore): CodexStore {
  const answers = new Map<string, unknown>();
  return new Proxy(store, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      if (!REPEATED_READS.has(property)) return value.bind(target);
      return (...args: unknown[]) => {
        const key = `${String(property)}(${JSON.stringify(args)})`;
        if (!answers.has(key)) answers.set(key, value.apply(target, args));
        return answers.get(key);
      };
    }
  });
}

/** The key that groups readers who read the same thing: their characters, sorted. */
export function readerKey(reader: CodexReader): string {
  return [...reader.characterIds].sort().join(",");
}
export function readerOf(characterIds: Iterable<string>): CodexReader {
  return { characterIds: new Set(characterIds) };
}

/** Ties by id, so two records shown in one write keep one order. */
function byFirstShown<T extends { id: string; firstShownAt: string | null }>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) => (a.firstShownAt ?? "").localeCompare(b.firstShownAt ?? "") || a.id.localeCompare(b.id)
  );
}

/**
 * Every Codex read a player can make, built here for the router and for `playerCodexFingerprint`, so the hash
 * that decides a player's ping covers the bodies a player is sent. Each method answers the response's `data`, or
 * null where the router answers 404. One instance serves one reader at one moment of the store: the contexts it
 * resolves and the reads it repeats are kept for its later reads. Lists players read come in the order players could
 * first read their rows, never the order the GM made them.
 */
export class PlayerCodexReads {
  readonly #store: CodexStore;
  readonly #reader: CodexReader;
  #journal: PlayerSessionNumberContext | undefined;
  #chronicle: PlayerChronicleContext | undefined;
  #connections: PlayerConnectionContext | undefined;
  #readerContext: PlayerReaderContext | undefined;

  constructor(store: CodexStore, reader: CodexReader = EVERYONE) {
    this.#store = rememberingReads(store);
    this.#reader = reader;
  }

  /** The store as this instance reads it. */
  get store(): CodexStore {
    return this.#store;
  }
  get reader(): CodexReader {
    return this.#reader;
  }

  get #journalContext() {
    return (this.#journal ??= journalContext(this.#store));
  }
  get #chronicleContext() {
    return (this.#chronicle ??= chronicleContext(this.#store, this.#reader));
  }
  get #connectionContext() {
    return (this.#connections ??= connectionContext(this.#store, this.#reader));
  }
  get #pageContext() {
    return (this.#readerContext ??= readerContext(this.#store, this.#reader));
  }

  /** Every page this reader can open, each as `page` sends it. */
  fullPages(): PlayerCodexPage[] {
    return this.#store
      .listFullPages()
      .map((page) => projectPlayerPage(page, this.#pageContext))
      .filter((page) => page !== null);
  }

  pages(tag?: string): { pages: PlayerCodexPageSummary[] } {
    const rows = this.#store.listPages(tag === undefined ? undefined : { tag });
    return {
      pages: rows
        .map((row) => projectPlayerPageSummary(row, this.#reader, this.#pageContext))
        .filter((page) => page !== null)
    };
  }

  /** The same context as the graph feed, so the panel and the graph are gated by one rule. */
  page(pageId: string): { page: PlayerCodexPage; connections: PlayerCodexPageConnection[] } | null {
    const page = this.#store.getPage(pageId);
    const projected = page && projectPlayerPage(page, this.#pageContext);
    if (!page || !projected) return null;
    return {
      page: projected,
      connections: projectPlayerPageConnections(this.#store.connectionsForPage(page.id), this.#connectionContext)
    };
  }

  /** Pins pointing at a page. A hidden page is refused first, so its id cannot be probed. */
  pageMarkers(pageId: string): { markers: PlayerCodexMarker[] } | null {
    if (!isPageVisible(this.#store, pageId)) return null;
    return { markers: this.#projectMarkers(this.#store.markersForPage(pageId)) };
  }

  connections(): { connections: PlayerCodexConnection[] } {
    return { connections: projectPlayerConnections(this.#store.listAllConnections(), this.#connectionContext) };
  }

  maps(): { maps: PlayerCodexMap[] } {
    return {
      maps: byFirstShown(this.#store.listMaps())
        .map((row) => projectPlayerMap(row, mapContext(this.#store, row)))
        .filter((map) => map !== null)
    };
  }

  mapMarkers(mapId: string): { markers: PlayerCodexMarker[] } | null {
    if (!isMapVisible(this.#store, mapId)) return null;
    return { markers: this.#projectMarkers(this.#store.listMarkers(mapId)) };
  }

  marker(markerId: string): { marker: PlayerCodexMarker } | null {
    const marker = this.#store.getMarker(markerId);
    const projected = marker && projectPlayerPageMarker(markerRecord(this.#store, marker));
    return projected ? { marker: projected } : null;
  }

  /** Null for both "no party pin" and a hidden one, so the two read the same; `mapName` only with a visible pin. */
  party(): { party: { marker: PlayerCodexMarker; mapName: string } | null } {
    const marker = this.#store.partyMarker();
    const map = marker ? this.#store.getMap(marker.mapId) : null;
    const projected = marker && map ? projectPlayerPageMarker(markerRecord(this.#store, marker)) : null;
    return {
      party:
        projected && map
          ? { marker: projected, mapName: plainUnopenableLinks(map.name, this.#pageContext.openableLinkKeys) }
          : null
    };
  }

  /** The timeline, or one pin's or page's entries. A hidden pin or page is refused, so its id cannot be probed. */
  journal(attach: Readonly<{ markerId?: string; pageId?: string }>): { entries: PlayerCodexJournalEntry[] } | null {
    const { markerId, pageId } = attach;
    if (markerId && !isMarkerVisible(this.#store, markerId)) return null;
    if (pageId && !isPageVisible(this.#store, pageId)) return null;
    const context = this.#journalContext;
    // A pin's or page's entries come in the order players could first read them.
    const rows =
      markerId || pageId
        ? orderPlayerAttached(this.#store.listEntriesFor({ markerId, pageId }))
        : orderPlayerTimeline(this.#store.listTimeline(), context);
    return { entries: rows.map((row) => projectPlayerJournalEntry(row, context)).filter((entry) => entry !== null) };
  }

  chronicle(): { records: PlayerCodexChronicleRecord[] } {
    const context = this.#chronicleContext;
    return {
      records: orderPlayerChronicle(this.#store.listChronicle(), context)
        .map((row) => projectPlayerChronicleRecord(row, context))
        .filter((record) => record !== null)
    };
  }

  /** `activeSessionId` is always null for a player, since it may name a hidden session; the key keeps one shape. */
  /** Numbered sessions by number, as the store lists them; the unnumbered after them in first-shown order. */
  sessions(): { sessions: PlayerCodexSession[]; activeSessionId: null } {
    const rows = this.#store.listSessions();
    const ordered = [
      ...rows.filter((session) => session.sessionNumber !== null),
      ...byFirstShown(rows.filter((session) => session.sessionNumber === null))
    ];
    return {
      sessions: ordered
        .map((row) => projectPlayerSession(row, this.#pageContext))
        .filter((session) => session !== null),
      activeSessionId: null
    };
  }

  session(sessionId: string): { session: PlayerCodexSession } | null {
    const session = this.#store.getSession(sessionId);
    const projected = session && projectPlayerSession(session, this.#pageContext);
    return projected ? { session: projected } : null;
  }

  quests(): { quests: PlayerCodexQuest[] } {
    return {
      quests: byFirstShown(this.#store.listQuests())
        .map((row) => projectPlayerQuest(row, questContext(this.#store, row, this.#pageContext)))
        .filter((quest) => quest !== null)
    };
  }

  quest(questId: string): { quest: PlayerCodexQuest } | null {
    const quest = this.#store.getQuest(questId);
    const projected = quest && projectPlayerQuest(quest, questContext(this.#store, quest, this.#pageContext));
    return projected ? { quest: projected } : null;
  }

  standing(): { standing: PlayerCodexStanding[] } {
    return {
      standing: byFirstShown(this.#store.listStanding())
        .map((row) => projectPlayerStanding(row, standingContext(this.#store, row)))
        .filter((row) => row !== null)
    };
  }

  calendar(): { calendar: PlayerCodexCalendar } {
    return { calendar: projectPlayerCalendar(this.#store.getCalendar(), this.#store.getPublishedDate()) };
  }

  /**
   * Search over what this player reads: each record is built from its player read, so a hit never matches, quotes
   * or ranks on hidden text, and the cap counts only what the player can see. There is no visibility filter.
   */
  search(query: CodexFindQuery): PlayerCodexSearchResult {
    return findPlayer(this.#findRecords(), { ...query, visibility: "all" });
  }

  /**
   * What this player can read that is new or changed after `since`, newest first: pages by this reader's
   * `playerUpdatedAt` (new when first shown after `since`), every other record by its first-shown date. Built from
   * the same records as search, so it lists and names only what this reader reads. Without `since` everything is new.
   */
  home(since: string | null): { home: PlayerCodexHome } {
    const after = (at: string | null) => at !== null && (since === null || at > since);
    const firstShown = this.#firstShownAt();
    const items: Array<PlayerCodexHome["newSince"][number]> = [];
    for (const record of this.#findRecords()) {
      const shownAt = firstShown.get(`${record.kind}|${record.id}`) ?? null;
      // A page's own time moves when it changes for this reader; anything else has only the day it was first shown.
      const at = record.kind === "page" ? record.modifiedAt : shownAt;
      if (!after(at)) continue;
      items.push({
        kind: record.kind,
        id: record.id,
        title: record.title,
        type: record.type,
        mapId: record.mapId,
        at: at!,
        change: record.kind !== "page" || after(shownAt) ? "new" : "updated"
      });
    }
    items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { home: { newSince: items.slice(0, NEW_SINCE_LIMIT), truncated: items.length > NEW_SINCE_LIMIT } };
  }

  /**
   * When players could first read each record, by `kind|id`, from the rows behind this reader's projections. The
   * date is the same for every reader, and set by the write that first let players read the record.
   */
  #firstShownAt(): Map<string, string | null> {
    const dates = new Map<string, string | null>();
    for (const page of this.#store.listFullPages()) dates.set(`page|${page.id}`, page.firstShownAt);
    for (const entry of this.#store.listTimeline()) dates.set(`journal|${entry.id}`, entry.firstShownAt);
    for (const map of this.#store.listMaps()) {
      dates.set(`map|${map.id}`, map.firstShownAt);
      for (const marker of this.#store.listMarkers(map.id)) dates.set(`marker|${marker.id}`, marker.firstShownAt);
    }
    for (const quest of this.#store.listQuests()) dates.set(`quest|${quest.id}`, quest.firstShownAt);
    for (const session of this.#store.listSessions()) dates.set(`session|${session.id}`, session.firstShownAt);
    return dates;
  }

  /**
   * Every record this reader reads, as search sees it, built only from their player reads: the bodies hold only the
   * blocks that reach them, the fields only the ones they read, and every link to a page they can't open is plain.
   */
  #findRecords(): FindRecord[] {
    const firstShown = this.#firstShownAt();
    const shownAt = (kind: string, id: string) => firstShown.get(`${kind}|${id}`) ?? null;
    const records: FindRecord[] = [];
    for (const row of this.#store.listFullPages()) {
      const page = projectPlayerPage(row, this.#pageContext);
      if (!page) continue;
      records.push({
        kind: "page",
        id: page.id,
        title: page.title,
        tags: page.tags,
        entityType: page.entityType,
        mapId: null,
        type: page.entityType,
        modifiedAt: page.playerUpdatedAt,
        columns: columnsOf(page.fields),
        shown: [...linesOf(page.body), ...Object.values(page.fields)]
      });
    }
    for (const entry of this.journal({})?.entries ?? [])
      records.push({
        kind: "journal",
        id: entry.id,
        title: excerpt(entry.text) || AUDIT_JOURNAL_FALLBACK[entry.kind],
        tags: entry.tags,
        entityType: null,
        mapId: null,
        type: "journal",
        modifiedAt: entry.firstShownAt,
        columns: columnsOf({ kind: entry.kind, date: entry.inWorldLabel }),
        shown: linesOf(entry.text)
      });
    const maps = this.maps().maps;
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
        modifiedAt: shownAt("map", map.id),
        columns: columnsOf({ kind: map.kind, parent: map.parentMapId ? mapNames.get(map.parentMapId) : null }),
        shown: []
      });
      for (const marker of this.mapMarkers(map.id)?.markers ?? [])
        records.push({
          kind: "marker",
          id: marker.id,
          title: marker.label ?? "",
          tags: marker.tags,
          entityType: null,
          mapId: marker.mapId,
          type: "marker",
          modifiedAt: shownAt("marker", marker.id),
          columns: columnsOf({ map: map.name }),
          shown: []
        });
    }
    for (const quest of this.quests().quests)
      records.push({
        kind: "quest",
        id: quest.id,
        title: quest.title,
        tags: quest.tags,
        entityType: null,
        mapId: null,
        type: "quest",
        modifiedAt: shownAt("quest", quest.id),
        columns: columnsOf({ status: quest.status }),
        shown: [...linesOf(quest.body), ...quest.objectives.map((objective) => objective.text)]
      });
    for (const session of this.sessions().sessions)
      records.push({
        kind: "session",
        id: session.id,
        title: sessionDisplayTitle(session),
        tags: session.tags,
        entityType: null,
        mapId: null,
        type: "session",
        modifiedAt: shownAt("session", session.id),
        columns: columnsOf({
          number: session.sessionNumber === null ? null : String(session.sessionNumber),
          date: session.realDate
        }),
        shown: [...linesOf(session.recap), ...(session.realDate ? [session.realDate] : [])]
      });
    return records;
  }

  /** Whether this reader may load an image. */
  media(assetId: string): boolean {
    return this.#store.isMediaVisibleToPlayers(assetId, this.#reader);
  }

  #projectMarkers(rows: ReturnType<CodexStore["listMarkers"]>): PlayerCodexMarker[] {
    const openable = this.#pageContext.openableLinkKeys;
    return byFirstShown(rows)
      .map((row) => projectPlayerPageMarker(markerRecord(this.#store, row, openable)))
      .filter((marker) => marker !== null);
  }
}

/**
 * A hash of everything one reader can read, so the `codex:changed` ping reaches a player exactly when some of what
 * they can read changed. It holds each list read and each page as the reader receives it, plus which pin and page
 * each shown journal entry is attached to, where the reader can see that pin or page. The rest of what a player can
 * ask for is built from those, so it cannot change while they stay the same:
 *
 * - A page's Connections panel: from the graph's edges, the titles and the player text of both ends.
 * - A page's or a pin's journal: the shown entries with that attachment, in first-shown order.
 * - A page's pins: the shown pins whose page links name it.
 * - One pin, session or quest: the same projection as its row in the list.
 * - Search: the pages, entries, maps, pins, quests and sessions above, matched and ranked on their own text.
 * - Home: the pages' player edit times, and the first-shown dates of the records above, each set by the write that
 *   first put that record in these reads.
 * - An image: a reader may fetch one only when a body, block or banner here names it.
 */
export function playerCodexFingerprint(store: CodexStore, reader: CodexReader = EVERYONE): string {
  const reads = new PlayerCodexReads(store, reader);
  const pages = reads.pages();
  const maps = reads.maps();
  const markers = maps.maps.map((map) => reads.mapMarkers(map.id));
  const journal = reads.journal({});
  const shownPages = new Set(pages.pages.map((page) => page.id));
  const shownPins = new Set(markers.flatMap((list) => list?.markers.map((marker) => marker.id) ?? []));
  const shownEntries = new Set(journal?.entries.map((entry) => entry.id));
  const attachments = reads.store
    .listTimeline()
    .filter((entry) => shownEntries.has(entry.id))
    .map((entry) => [
      entry.id,
      entry.attachMarkerId !== null && shownPins.has(entry.attachMarkerId) ? entry.attachMarkerId : null,
      entry.attachPageId !== null && shownPages.has(entry.attachPageId) ? entry.attachPageId : null
    ]);
  const parts: unknown[] = [
    pages,
    reads.fullPages(),
    maps,
    markers,
    reads.connections(),
    reads.party(),
    journal,
    attachments,
    reads.chronicle(),
    reads.sessions(),
    reads.quests(),
    reads.standing(),
    reads.calendar()
  ];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/**
 * The counts players' `codex:changed` pings carry, one per audience (the characters a reader holds). An audience's
 * count moves only when its own `playerCodexFingerprint` does, so a GM-only write sends a player nothing, a reveal to
 * Lyra moves only Lyra's audience, and each value counts only changes that audience could read.
 */
export class PlayerCodexChanges {
  readonly #store: CodexStore;
  readonly #seen = new Map<string, { fingerprint: string; count: number }>();

  constructor(store: CodexStore) {
    this.#store = store;
    this.watch(EVERYONE);
  }

  /** Starts counting an audience from now, unless it is counted already; answers its count. */
  watch(reader: CodexReader): number {
    const key = readerKey(reader);
    const known = this.#seen.get(key);
    if (known) return known.count;
    this.#seen.set(key, { fingerprint: playerCodexFingerprint(this.#store, reader), count: 0 });
    return 0;
  }

  /**
   * The new count of each audience in `readers` whose reads changed since the last call. An audience no reader holds
   * any more stops being counted; one not counted yet starts from now, with nothing to report.
   */
  next(readers: Iterable<CodexReader> = [EVERYONE]): Map<string, number> {
    const active = new Map([...readers].map((reader) => [readerKey(reader), reader]));
    for (const key of [...this.#seen.keys()]) if (!active.has(key)) this.#seen.delete(key);
    const moved = new Map<string, number>();
    for (const [key, reader] of active) {
      const fingerprint = playerCodexFingerprint(this.#store, reader);
      const known = this.#seen.get(key);
      if (!known) {
        this.#seen.set(key, { fingerprint, count: 0 });
        continue;
      }
      if (known.fingerprint === fingerprint) continue;
      known.fingerprint = fingerprint;
      known.count += 1;
      moved.set(key, known.count);
    }
    return moved;
  }
}
