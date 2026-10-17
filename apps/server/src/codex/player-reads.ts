import { createHash } from "node:crypto";
import type {
  CodexSearchResult,
  PlayerCodexCalendar,
  PlayerCodexChronicleRecord,
  PlayerCodexConnection,
  PlayerCodexJournalEntry,
  PlayerCodexMap,
  PlayerCodexMarker,
  PlayerCodexPage,
  PlayerCodexPageConnection,
  PlayerCodexPageSummary,
  PlayerCodexQuest,
  PlayerCodexSession,
  PlayerCodexStanding
} from "@vtt/domain";
import type { CodexStore } from "../codex-store.js";
import {
  orderPlayerAttached,
  orderPlayerChronicle,
  orderPlayerTimeline,
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
  projectPlayerSearchHit,
  projectPlayerSession,
  projectPlayerStanding,
  type PlayerChronicleContext,
  type PlayerConnectionContext,
  type PlayerSessionNumberContext
} from "../codex-projections.js";
import { capSearch } from "./search.js";
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
  searchRecord,
  standingContext
} from "./visibility.js";

/** The store reads that player reads repeat, by name. Each is answered once per `PlayerCodexReads`. */
const REPEATED_READS: ReadonlySet<PropertyKey> = new Set([
  "listPages",
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

/**
 * Every Codex read a player can make, built here for the router and for `playerCodexFingerprint`, so the hash
 * that decides a player's ping covers the bodies a player is sent. Each method answers the response's `data`, or
 * null where the router answers 404. One instance serves one moment of the store: the contexts it resolves and
 * the reads it repeats are kept for its later reads.
 */
export class PlayerCodexReads {
  readonly #store: CodexStore;
  #journal: PlayerSessionNumberContext | undefined;
  #chronicle: PlayerChronicleContext | undefined;
  #connections: PlayerConnectionContext | undefined;

  constructor(store: CodexStore) {
    this.#store = rememberingReads(store);
  }

  /** The store as this instance reads it. */
  get store(): CodexStore {
    return this.#store;
  }

  get #journalContext() {
    return (this.#journal ??= journalContext(this.#store));
  }
  get #chronicleContext() {
    return (this.#chronicle ??= chronicleContext(this.#store));
  }
  get #connectionContext() {
    return (this.#connections ??= connectionContext(this.#store));
  }

  pages(tag?: string): { pages: PlayerCodexPageSummary[] } {
    const rows = this.#store.listPages(tag === undefined ? undefined : { tag });
    return { pages: rows.map(projectPlayerPageSummary).filter((page) => page !== null) };
  }

  /** The same context as the graph feed, so the panel and the graph are gated by one rule. */
  page(pageId: string): { page: PlayerCodexPage; connections: PlayerCodexPageConnection[] } | null {
    const page = this.#store.getPage(pageId);
    const projected = page && projectPlayerPage(page);
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
      maps: this.#store
        .listMaps()
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
    return { party: projected && map ? { marker: projected, mapName: map.name } : null };
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
  sessions(): { sessions: PlayerCodexSession[]; activeSessionId: null } {
    return {
      sessions: this.#store
        .listSessions()
        .map(projectPlayerSession)
        .filter((session) => session !== null),
      activeSessionId: null
    };
  }

  session(sessionId: string): { session: PlayerCodexSession } | null {
    const session = this.#store.getSession(sessionId);
    const projected = session && projectPlayerSession(session);
    return projected ? { session: projected } : null;
  }

  quests(): { quests: PlayerCodexQuest[] } {
    return {
      quests: this.#store
        .listQuests()
        .map((row) => projectPlayerQuest(row, questContext(this.#store, row)))
        .filter((quest) => quest !== null)
    };
  }

  quest(questId: string): { quest: PlayerCodexQuest } | null {
    const quest = this.#store.getQuest(questId);
    const projected = quest && projectPlayerQuest(quest, questContext(this.#store, quest));
    return projected ? { quest: projected } : null;
  }

  standing(): { standing: PlayerCodexStanding[] } {
    return {
      standing: this.#store
        .listStanding()
        .map((row) => projectPlayerStanding(row, standingContext(this.#store, row)))
        .filter((row) => row !== null)
    };
  }

  calendar(): { calendar: PlayerCodexCalendar } {
    return { calendar: projectPlayerCalendar(this.#store.getCalendar(), this.#store.getPublishedDate()) };
  }

  /** Capped after the player gates, so a record a player cannot see never takes a place under the cap. */
  search(query: string): CodexSearchResult {
    const context = this.#journalContext;
    return capSearch(
      this.#store
        .searchPlayerMatches(query)
        .map((ref) => searchRecord(this.#store, ref))
        .filter((record) => record !== null)
        .map((record) => projectPlayerSearchHit(record, context))
        .filter((hit) => hit !== null)
    );
  }

  #projectMarkers(rows: ReturnType<CodexStore["listMarkers"]>): PlayerCodexMarker[] {
    return rows
      .map((row) => projectPlayerPageMarker(markerRecord(this.#store, row)))
      .filter((marker) => marker !== null);
  }
}

/**
 * A hash of everything a player can read, so the `codex:changed` ping reaches players exactly when some of it
 * changed. It holds each list read and each page as a player receives it, plus which pin and page each shown
 * journal entry is attached to, where players can see that pin or page. The rest of what a player can ask for is
 * built from those, so it cannot change while they stay the same:
 *
 * - A page's Connections panel: from the graph's edges, the titles and the player text of both ends.
 * - A page's or a pin's journal: the shown entries with that attachment, in first-shown order.
 * - A page's pins: the shown pins whose page links name it.
 * - One pin, session or quest: the same projection as its row in the list.
 * - Search: each hit's title, text and reveal state, ranked on its own title.
 * - An image: a player may fetch one only when a revealed body or banner here names it.
 */
export function playerCodexFingerprint(store: CodexStore): string {
  const reads = new PlayerCodexReads(store);
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
    reads.store
      .listFullPages()
      .map(projectPlayerPage)
      .filter((page) => page !== null),
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
 * The count a player's `codex:changed` ping carries. It moves only when `playerCodexFingerprint` does, so a
 * GM-only write sends a player nothing, and its value counts only changes players could read.
 */
export class PlayerCodexChanges {
  readonly #store: CodexStore;
  #fingerprint: string;
  #count = 0;

  constructor(store: CodexStore) {
    this.#store = store;
    this.#fingerprint = playerCodexFingerprint(store);
  }

  /** The new count when something a player can read changed since the last call, otherwise null. */
  next(): number | null {
    const fingerprint = playerCodexFingerprint(this.#store);
    if (fingerprint === this.#fingerprint) return null;
    this.#fingerprint = fingerprint;
    this.#count += 1;
    return this.#count;
  }
}
