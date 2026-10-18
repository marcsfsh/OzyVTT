import { assembleCodexBody, pageLinkKey } from "@vtt/domain";
import type {
  CodexAudience,
  CodexBlock,
  CodexBlockReveal,
  CodexCalendar,
  CodexChronicleKind,
  CodexChronicleRecord,
  CodexConnection,
  CodexConnectionSourceKind,
  CodexInWorldDate,
  CodexJournalEntry,
  CodexJournalKind,
  CodexJournalPayload,
  CodexMap,
  CodexMarker,
  CodexPage,
  CodexPageConnection,
  CodexPageSummary,
  CodexQuest,
  CodexRevealAudit,
  CodexRevealAuditKind,
  CodexRevealAuditRow,
  CodexSearchHit,
  CodexSession,
  CodexStanding,
  GmCodexCalendar,
  PlayerCodexBlock,
  PlayerCodexCalendar,
  PlayerCodexChronicleRecord,
  PlayerCodexConnection,
  PlayerCodexJournalEntry,
  PlayerCodexJournalPayload,
  PlayerCodexMap,
  PlayerCodexMarker,
  PlayerCodexPage,
  PlayerCodexPageConnection,
  PlayerCodexPageSummary,
  PlayerCodexQuest,
  PlayerCodexRevealStamp,
  PlayerCodexSession,
  PlayerCodexStanding
} from "@vtt/domain";
import { inWorldLabel } from "./codex/calendar.js";
import { deadlineFired } from "./codex/journal-kinds.js";
import { chronicleOrder, type CodexChronicleSource } from "./codex/journal.js";

/**
 * The Codex viewer-safety boundary: every player-facing Codex read projects through here. The player shapes in
 * `@vtt/domain`'s `codex-wire.ts` are explicit allow-lists, so a new field stays secret until it is added there
 * and here. Cross-record reveal state arrives as a context built by `codex/visibility.ts`.
 */

export function projectGmPage(row: CodexPage): CodexPage {
  return row;
}

// Readers: who a player read is for

/**
 * Who a player read is for: the party characters the session holds. A player with none, and the GM's preview as
 * everyone, hold none, and read only what everyone reads.
 */
export type CodexReader = Readonly<{ characterIds: ReadonlySet<string> }>;
export const EVERYONE: CodexReader = { characterIds: new Set() };

/** Whether a reader may read something with this audience. */
function reaches(target: Readonly<{ audience: CodexAudience; characterIds: readonly string[] }>, reader: CodexReader) {
  if (target.audience === "everyone") return true;
  return target.audience === "characters" && target.characterIds.some((id) => reader.characterIds.has(id));
}

/** The facts a page or quest projection needs beyond its row, built by `codex/visibility.ts`. */
export type PlayerReaderContext = Readonly<{
  reader: CodexReader;
  /** Link keys of the pages the reader can open; a `[[link]]` to anything else reads as plain text. */
  openableLinkKeys: ReadonlySet<string>;
  /** A stamp names its session only while that session is revealed. */
  revealedSessionIds: ReadonlySet<string>;
}>;
/** The quietest context: no character, no page to link, no session to name. */
export const EVERYONE_CONTEXT: PlayerReaderContext = {
  reader: EVERYONE,
  openableLinkKeys: new Set(),
  revealedSessionIds: new Set()
};

const WIKILINK = /\[\[([^\]]+)\]\]/g;
/** Link prefixes for records other than pages, read as `parseWikiLinks` reads them. */
const OTHER_LINK_KINDS: ReadonlySet<string> = new Set(["actor", "monster", "spell", "map", "marker"]);
const NO_LINKS: ReadonlySet<string> = new Set();
/**
 * `[[Title]]`, `[[page:Title]]` and `[[Title#Section]]` stay links only when the reader can open the page; any other
 * becomes its plain text, so a link never says a hidden page exists. Links to other kinds of record are left as
 * written. Every piece of record text a player receives passes through here.
 */
export function plainUnopenableLinks(text: string, openable: ReadonlySet<string> = NO_LINKS): string {
  return text.replace(WIKILINK, (link, inner: string) => {
    const [targetPart = "", sectionPart] = inner.trim().split("#", 2);
    let target = targetPart.trim();
    const colon = target.indexOf(":");
    if (colon > 0) {
      const prefix = target.slice(0, colon).trim().toLowerCase();
      if (OTHER_LINK_KINDS.has(prefix)) return link;
      if (prefix === "page") target = target.slice(colon + 1).trim();
    }
    if (target === "" || openable.has(pageLinkKey(target))) return link;
    const section = sectionPart?.trim();
    return section ? `${target} › ${section}` : target;
  });
}

/**
 * The pages a player context lets a `[[link]]` lead to, by link key (`openableLinkKeys` in `codex/visibility.ts`).
 * Absent, no page can be opened, so every link reads as plain text.
 */
export type PlayerLinkContext = Readonly<{ openableLinkKeys?: ReadonlySet<string> }>;
function plainText(text: string, context: PlayerLinkContext): string {
  return plainUnopenableLinks(text, context.openableLinkKeys);
}
function plainNullable(text: string | null, context: PlayerLinkContext): string | null {
  return text === null ? null : plainText(text, context);
}

/** A stamp as a reader may see it: its session's number only while that session is revealed. */
function playerStamp(
  stamp: Omit<CodexBlockReveal, "to">,
  revealedSessionIds: ReadonlySet<string>
): PlayerCodexRevealStamp {
  return {
    at: stamp.at,
    sessionNumber: stamp.sessionId !== null && revealedSessionIds.has(stamp.sessionId) ? stamp.sessionNumber : null,
    inWorldDate: stamp.inWorldDate,
    inWorldLabel: stamp.inWorldLabel
  };
}

/**
 * The player text with the blocks the reader may see in place, and those blocks as the reader sees them. A block
 * reaches the reader through "everyone" or one of their characters, and only once a write stamped that audience: a
 * block no write has stamped has never been shown, so it fails closed. Its stamp is the first time it reached the
 * reader: the earliest of the stamps for "everyone" and for the reader's characters.
 */
function assembled(
  playerBody: string,
  blocks: readonly CodexBlock[],
  context: PlayerReaderContext
): Readonly<{ body: string; blocks: PlayerCodexBlock[] }> {
  const { reader } = context;
  const shown = blocks.flatMap((block) => {
    if (!reaches(block, reader)) return [];
    const giving = (to: string) =>
      to === "everyone" ? block.audience === "everyone" : block.characterIds.includes(to);
    const mine = block.reveals
      .filter((reveal) => reveal.to === "everyone" || reader.characterIds.has(reveal.to))
      .sort((a, b) => a.at.localeCompare(b.at));
    if (!mine.some((reveal) => giving(reveal.to))) return [];
    return [{ block, stamp: mine[0]! }];
  });
  const openable = context.openableLinkKeys;
  const { body, ranges } = assembleCodexBody(
    plainUnopenableLinks(playerBody, openable),
    shown.map(({ block }) => ({
      anchor: block.anchor,
      title: block.title === null ? null : plainUnopenableLinks(block.title, openable),
      text: plainUnopenableLinks(block.text, openable)
    }))
  );
  return {
    body,
    blocks: shown.flatMap(({ block, stamp }, index) => {
      const range = ranges[index];
      if (!range) return [];
      return [
        {
          title: block.title === null ? null : plainUnopenableLinks(block.title, openable),
          start: range.start,
          end: range.end,
          characterIds:
            block.audience === "characters" ? block.characterIds.filter((id) => reader.characterIds.has(id)) : [],
          revealed: playerStamp(stamp, context.revealedSessionIds)
        }
      ];
    })
  };
}

/** The reader's own edit time: the page's, or a later change only their characters see. */
function readerUpdatedAt(row: CodexPageSummary, reader: CodexReader): string {
  let latest = row.playerUpdatedAt;
  for (const characterId of reader.characterIds) {
    const at = row.characterUpdatedAt[characterId];
    if (at !== undefined && at > latest) latest = at;
  }
  return latest;
}

/**
 * null when the page is not revealed to players; otherwise the reader's projection. Allow-list: no block the reader
 * may not see, no Hidden field, no `rev`, no folder (the GM's private filing) and no `updatedAt` (which a GM-only save
 * moves). An undated page has never been shown, so it fails closed.
 */
export function projectPlayerPage(
  row: CodexPage,
  context: PlayerReaderContext = EVERYONE_CONTEXT
): PlayerCodexPage | null {
  if (!row.revealedToPlayers || row.firstShownAt === null) return null;
  const hidden = new Set(row.hiddenFields);
  const { body, blocks } = assembled(row.playerBody, row.blocks, context);
  return {
    id: row.id,
    title: plainText(row.title, context),
    entityType: row.entityType,
    fields: Object.fromEntries(
      Object.entries(row.fields)
        .filter(([key]) => !hidden.has(key))
        .map(([key, value]) => [key, plainText(value, context)])
    ),
    tags: row.tags,
    body,
    bannerAssetId: row.bannerAssetId,
    playerUpdatedAt: readerUpdatedAt(row, context.reader),
    firstShownAt: row.firstShownAt,
    blocks
  };
}

export function projectGmPageSummary(row: CodexPageSummary): CodexPageSummary {
  return row;
}

/** As `projectPlayerPage`, without the body, fields and blocks. */
export function projectPlayerPageSummary(
  row: CodexPageSummary,
  reader: CodexReader = EVERYONE,
  links: PlayerLinkContext = {}
): PlayerCodexPageSummary | null {
  if (!row.revealedToPlayers || row.firstShownAt === null) return null;
  return {
    id: row.id,
    title: plainText(row.title, links),
    entityType: row.entityType,
    tags: row.tags,
    bannerAssetId: row.bannerAssetId,
    playerUpdatedAt: readerUpdatedAt(row, reader)
  };
}

// Connections (one gate for declared and mention edges)

/**
 * A connection reaches a player only if its target page is revealed, its source is player-visible, and it is on
 * the player layer or is a GM-layer mention from a block shown to one of the reader's characters.
 */
export type PlayerConnectionContext = PlayerLinkContext &
  Readonly<{
    /** Page ids the player may see. Both a connection's target and a page-kind source are checked against it. */
    revealedPageIds: ReadonlySet<string>;
    /** Non-page sources the player may see, resolved through each kind's player projection. Absent ids fail closed. */
    revealedSourceIds: ReadonlySet<string>;
    /** Absent: a reader with no character. */
    reader?: CodexReader;
    /** A `learned` stamp names its session only while that session is revealed. Absent: none is. */
    revealedSessionIds?: ReadonlySet<string>;
  }>;

function connectionSourceVisible(
  kind: CodexConnectionSourceKind,
  sourceId: string,
  context: PlayerConnectionContext
): boolean {
  return kind === "page" ? context.revealedPageIds.has(sourceId) : context.revealedSourceIds.has(sourceId);
}

/** The player layer, or a GM-layer mention from a block shown to one of the reader's characters. */
function layerReaches(
  edge: Readonly<{ layer: "player" | "gm"; characterIds: readonly string[] }>,
  context: PlayerConnectionContext
): boolean {
  if (edge.layer === "player") return true;
  const reader = context.reader ?? EVERYONE;
  return edge.characterIds.some((id) => reader.characterIds.has(id));
}

const NO_SESSIONS: ReadonlySet<string> = new Set();

export function projectGmConnections(edges: readonly CodexConnection[]): CodexConnection[] {
  return [...edges];
}

/** In a fixed order of their own, never the order they were made in, which would show what the GM prepared first. */
export function projectPlayerConnections(
  edges: readonly CodexConnection[],
  context: PlayerConnectionContext
): PlayerCodexConnection[] {
  const sessions = context.revealedSessionIds ?? NO_SESSIONS;
  return (
    edges
      .filter(
        (edge) =>
          layerReaches(edge, context) &&
          context.revealedPageIds.has(edge.toPageId) &&
          connectionSourceVisible(edge.fromKind, edge.fromId, context)
      )
      // Allow-list: a field added to `CodexConnection` stays secret until added here.
      .map((edge): PlayerCodexConnection => ({
        fromKind: edge.fromKind,
        fromId: edge.fromId,
        toPageId: edge.toPageId,
        label: plainNullable(edge.label, context),
        origin: edge.origin,
        began: edge.began,
        learned: edge.learned && playerStamp(edge.learned, sessions)
      }))
      .sort(
        (a, b) =>
          a.fromKind.localeCompare(b.fromKind) ||
          a.fromId.localeCompare(b.fromId) ||
          a.toPageId.localeCompare(b.toPageId) ||
          (a.label ?? "").localeCompare(b.label ?? "") ||
          a.origin.localeCompare(b.origin)
      )
  );
}

export function projectGmPageConnections(rows: readonly CodexPageConnection[]): CodexPageConnection[] {
  return [...rows];
}

export function projectPlayerPageConnections(
  rows: readonly CodexPageConnection[],
  context: PlayerConnectionContext
): PlayerCodexPageConnection[] {
  const sessions = context.revealedSessionIds ?? NO_SESSIONS;
  return rows
    .filter((row) => layerReaches(row, context) && connectionSourceVisible(row.otherKind, row.otherId, context))
    .map((row) => ({
      direction: row.direction,
      otherKind: row.otherKind,
      otherId: row.otherId,
      otherTitle: plainText(row.otherTitle, context),
      otherEntityType: row.otherEntityType,
      label: plainNullable(row.label, context),
      origin: row.origin,
      section: row.section,
      began: row.began,
      learned: row.learned && playerStamp(row.learned, sessions)
    }));
}

// Maps

export function projectGmMap(row: CodexMap): CodexMap {
  return row;
}
/** null unless revealed. `parentMapId` survives only if the parent is revealed, or it would leak a secret ancestor. */
export function projectPlayerMap(
  row: CodexMap,
  context: Readonly<{ parentRevealed: boolean }> & PlayerLinkContext
): PlayerCodexMap | null {
  if (!row.revealedToPlayers) return null;
  return {
    id: row.id,
    assetId: row.assetId,
    name: plainText(row.name, context),
    kind: row.kind,
    parentMapId: context.parentRevealed ? row.parentMapId : null,
    tags: row.tags
  };
}

// Markers

export function projectGmMarker(row: CodexMarker): CodexMarker {
  return row;
}

/** null unless revealed. Unrevealed page/sub-map links are dropped and scene/actor links stripped. `isParty` grants no visibility. */
export function projectPlayerMarker(
  row: CodexMarker,
  context: Readonly<{ revealedPageIds: ReadonlySet<string>; subMapRevealed: boolean }> & PlayerLinkContext
): PlayerCodexMarker | null {
  if (!row.revealedToPlayers) return null;
  return {
    id: row.id,
    mapId: row.mapId,
    x: row.x,
    y: row.y,
    iconId: row.iconId,
    iconColor: row.iconColor,
    label: plainNullable(row.label, context),
    tags: row.tags,
    pageIds: row.pageIds.filter((pageId) => context.revealedPageIds.has(pageId)),
    subMapId: context.subMapRevealed ? row.subMapId : null,
    isParty: row.isParty
  };
}

/** A pin reached by page id, plus `mapRevealed`: it has not passed its map's gate. */
export type CodexPageMarkerRecord = PlayerLinkContext &
  Readonly<{
    marker: CodexMarker;
    mapRevealed: boolean;
    revealedPageIds: ReadonlySet<string>;
    subMapRevealed: boolean;
  }>;

/** null unless player-visible: a pin on an unrevealed map is hidden (as `GET /codex/maps/:id/markers`), then `projectPlayerMarker`. */
export function projectPlayerPageMarker(record: CodexPageMarkerRecord): PlayerCodexMarker | null {
  if (!record.mapRevealed) return null;
  return projectPlayerMarker(record.marker, {
    revealedPageIds: record.revealedPageIds,
    subMapRevealed: record.subMapRevealed,
    openableLinkKeys: record.openableLinkKeys
  });
}

// Journal

/** Default for an unsupplied revealed-id set: nothing is revealed, so nothing travels. */
const EMPTY_PAGE_IDS: ReadonlySet<string> = new Set<string>();

/** Facts for a player journal read, built by `journalContext`. Absent sets default to empty, which fails closed. */
export type PlayerSessionNumberContext = PlayerLinkContext &
  Readonly<{
    /** Quests the players have been shown; a `quest` history record is gated on its quest. */
    revealedQuestIds?: ReadonlySet<string>;
    /** Keyed by session id, so an entry filed under an unnumbered hidden session is still gated. */
    unrevealedSessionIds: ReadonlySet<string>;
    revealedPageIds?: ReadonlySet<string>;
  }>;

/** A `standing` record is visible only when its faction page is; it has no player prose, so nulling the id alone would leak. */
function playerStandingVisible(row: CodexJournalEntry, context: PlayerSessionNumberContext): boolean {
  if (row.kind !== "standing") return true;
  const payload = row.payload;
  const faction = payload !== null && "delta" in payload ? payload.factionPageId : null;
  return faction !== null && (context.revealedPageIds ?? EMPTY_PAGE_IDS).has(faction);
}

/** A `quest` history record is visible only when its quest is; it has no player prose of its own. */
function playerQuestEventVisible(row: CodexJournalEntry, context: PlayerSessionNumberContext): boolean {
  if (row.kind !== "quest") return true;
  const payload = row.payload;
  const questId = payload !== null && "questId" in payload ? payload.questId : null;
  return questId !== null && (context.revealedQuestIds ?? EMPTY_PAGE_IDS).has(questId);
}

/** Unrevealed session: both halves null. Revealed: both pass. Bare number with no join (left by deleting a revealed session): passes. */
function playerSessionLink(
  row: CodexJournalEntry,
  context: PlayerSessionNumberContext
): { sessionId: string | null; sessionNumber: number | null } {
  if (row.sessionId === null) return { sessionId: null, sessionNumber: row.sessionNumber };
  if (context.unrevealedSessionIds.has(row.sessionId)) return { sessionId: null, sessionNumber: null };
  return { sessionId: row.sessionId, sessionNumber: row.sessionNumber };
}

/**
 * Chronicle records in a player's order. The store places an entry by its session's number, and a hidden
 * session's number would show players where that session falls, so here an entry is placed by the number a
 * player receives for it. Ties go by when players could first read each record.
 */
export function orderPlayerChronicle(
  records: readonly CodexChronicleSource[],
  context: PlayerSessionNumberContext
): CodexChronicleSource[] {
  return [...records].sort(
    chronicleOrder({
      sessionNumberOf: (entry) => playerSessionLink(entry, context).sessionNumber,
      timeOf: (record) => (record.kind === "entry" ? record.entry.firstShownAt : record.page.firstShownAt) ?? ""
    })
  );
}

/** One pin's or page's entries in a player's order: by when players could first read each one. */
export function orderPlayerAttached(entries: readonly CodexJournalEntry[]): CodexJournalEntry[] {
  return [...entries].sort(
    (a, b) => (a.firstShownAt ?? "").localeCompare(b.firstShownAt ?? "") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** The journal timeline in a player's order, by the same rule as `orderPlayerChronicle`. */
export function orderPlayerTimeline(
  entries: readonly CodexJournalEntry[],
  context: PlayerSessionNumberContext
): CodexJournalEntry[] {
  return orderPlayerChronicle(
    entries.map((entry) => ({ kind: "entry", entry }) as const),
    context
  ).flatMap((record) => (record.kind === "entry" ? [record.entry] : []));
}

export function projectGmJournalEntry(row: CodexJournalEntry): CodexJournalEntry {
  return row;
}
export function projectPlayerJournalEntry(
  row: CodexJournalEntry,
  context: PlayerSessionNumberContext
): PlayerCodexJournalEntry | null {
  if (!row.revealedToPlayers) return null;
  if (!playerStandingVisible(row, context)) return null;
  if (!playerQuestEventVisible(row, context)) return null;
  // The write that lets players read an entry dates it, so an undated one has never been shown. It fails closed.
  if (row.firstShownAt === null) return null;
  const session = playerSessionLink(row, context);
  // No `createdAt`, which would tell players when the GM wrote the entry.
  return {
    id: row.id,
    text: plainText(row.playerText, context),
    kind: row.kind,
    sessionId: session.sessionId,
    sessionNumber: session.sessionNumber,
    realDate: plainNullable(row.realDate, context),
    inWorldLabel: row.inWorldLabel,
    tags: row.tags,
    firstShownAt: row.firstShownAt
  };
}

// Sessions: prep is the GM half, recap is the player half

export function projectGmSession(row: CodexSession): CodexSession {
  return row;
}

export function projectPlayerSession(row: CodexSession, links: PlayerLinkContext = {}): PlayerCodexSession | null {
  if (!row.revealedToPlayers) return null;
  // Allow-list: a field added to `CodexSession` stays secret until added here.
  return {
    id: row.id,
    sessionNumber: row.sessionNumber,
    realDate: plainNullable(row.realDate, links),
    recap: plainText(row.recapBody, links),
    tags: row.tags
  };
}

// Quests: playerBody is what the party was told, gmBody is where it is really going

export function projectGmQuest(row: CodexQuest): CodexQuest {
  return row;
}

/**
 * null when unrevealed. `entityIds` keeps only revealed pages, so a quest never advertises secret page ids. Only the
 * blocks and objectives the reader may see come through, so a count of objectives counts only those.
 */
export function projectPlayerQuest(
  row: CodexQuest,
  context: Readonly<{ revealedEntityIds: ReadonlySet<string> }> & Partial<PlayerReaderContext>
): PlayerCodexQuest | null {
  if (!row.revealedToPlayers) return null;
  const readerContext: PlayerReaderContext = { ...EVERYONE_CONTEXT, ...context };
  const { body, blocks } = assembled(row.playerBody, row.blocks, readerContext);
  // Allow-list: a field added to `CodexQuest` stays secret until added here.
  return {
    id: row.id,
    title: plainText(row.title, readerContext),
    status: row.status,
    body,
    blocks,
    objectives: row.objectives
      .filter((objective) => reaches(objective, readerContext.reader))
      .map((objective) => ({ text: plainText(objective.text, readerContext), done: objective.done })),
    entityIds: row.entityIds.filter((entityId) => context.revealedEntityIds.has(entityId)),
    tags: row.tags
  };
}

// Standing: where the party stands with one faction

export function projectGmStanding(row: CodexStanding): CodexStanding {
  return row;
}

/** null unless both the standing and its faction page are revealed: a titleless bar for a secret faction would still leak. */
export function projectPlayerStanding(
  row: CodexStanding,
  context: Readonly<{ factionRevealed: boolean }>
): PlayerCodexStanding | null {
  if (!row.revealedToPlayers) return null;
  if (!context.factionRevealed) return null;
  return { factionPageId: row.factionPageId, value: row.value };
}

/** A block's title over its text, for a one-line excerpt. */
function blockText(block: CodexBlock): string {
  return block.title ? `${block.title} ${block.text}` : block.text;
}

/** A bounded one-line rendering of a record's prose for list rows (search hits, chronicle rows). */
const EXCERPT_LENGTH = 160;
function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= EXCERPT_LENGTH ? flat : `${flat.slice(0, EXCERPT_LENGTH - 1)}…`;
}

// The chronicle: one timeline of journal entries and dated `event` pages

/** Exhaustive, no `default`: a new journal kind is a compile error here and never renders as a plain entry. */
function chronicleKindOf(kind: CodexJournalKind): CodexChronicleKind {
  switch (kind) {
    case "note":
      return "entry";
    case "combat":
      return "combat";
    case "deadline":
      return "deadline";
    case "downtime":
      return "downtime";
    case "milestone":
      return "milestone";
    case "standing":
      return "standing";
    case "quest":
      return "quest";
  }
}

// `fired` for players is measured against the published date, never the GM clock, or it would leak prep.

// Dispatch on the entry's `kind` so a payload only rides out on its own kind; `in` guards fail closed.
function projectGmPayload(entry: CodexJournalEntry): CodexJournalPayload | null {
  const payload = entry.payload;
  if (payload === null) return null;
  switch (entry.kind) {
    case "downtime":
      return "who" in payload
        ? {
            who: payload.who,
            activity: payload.activity,
            days: payload.days,
            applied: payload.applied,
            characterPageId: payload.characterPageId
          }
        : null;
    case "milestone":
      return "level" in payload ? { level: payload.level, reason: payload.reason } : null;
    case "standing":
      return "delta" in payload
        ? { factionPageId: payload.factionPageId, delta: payload.delta, reason: payload.reason }
        : null;
    case "quest":
      return "questId" in payload ? { questId: payload.questId, status: payload.status } : null;
    case "note":
    case "combat":
    case "deadline":
      return null;
  }
}
// Player allow-list per kind: `applied` dropped, page/quest ids only when revealed.
function projectPlayerPayload(
  entry: CodexJournalEntry,
  revealedPageIds: ReadonlySet<string>,
  revealedQuestIds: ReadonlySet<string>,
  links: PlayerLinkContext
): PlayerCodexJournalPayload | null {
  const payload = entry.payload;
  if (payload === null) return null;
  switch (entry.kind) {
    case "downtime":
      return "who" in payload
        ? {
            who: plainText(payload.who, links),
            activity: plainText(payload.activity, links),
            days: payload.days,
            characterPageId:
              payload.characterPageId !== null && revealedPageIds.has(payload.characterPageId)
                ? payload.characterPageId
                : null
          }
        : null;
    case "milestone":
      return "level" in payload ? { level: payload.level, reason: plainText(payload.reason, links) } : null;
    case "standing":
      return "delta" in payload
        ? {
            factionPageId: revealedPageIds.has(payload.factionPageId) ? payload.factionPageId : null,
            delta: payload.delta,
            reason: plainText(payload.reason, links)
          }
        : null;
    // The row is already hidden unless the quest is revealed; nulling `questId` is a second line of defence.
    case "quest":
      return "questId" in payload
        ? { questId: revealedQuestIds.has(payload.questId) ? payload.questId : null, status: payload.status }
        : null;
    case "note":
    case "combat":
    case "deadline":
      return null;
  }
}

/** Absent values are the quietest ones, so a forgetful caller loses a feature but cannot leak one. */
export type GmChronicleContext = Readonly<{
  /** The GM's own clock as a sort instant; the GM row's `fired` is measured against it. */
  campaignInstant?: number | null;
  /** For an unapplied downtime, the date `applyDowntime` would move the clock to. GM workflow; never a player's. */
  proposedDate?: CodexInWorldDate | null;
}>;

/** `publishedInstant`, so the GM context (`campaignInstant`) is not assignable here by accident. */
export type PlayerChronicleContext = PlayerSessionNumberContext &
  Readonly<{
    publishedInstant?: number | null;
    /** Revealed page ids, for payload links to pages. Absent means empty, which nulls the id. */
    revealedPageIds?: ReadonlySet<string>;
    /** Who an event page's text is for. Absent: a reader with no character, every link plain text. */
    pages?: PlayerReaderContext;
  }>;

export function projectGmChronicleRecord(
  record: CodexChronicleSource,
  context: GmChronicleContext = {}
): CodexChronicleRecord {
  if (record.kind === "entry") {
    const entry = record.entry;
    return {
      kind: chronicleKindOf(entry.kind),
      id: entry.id,
      title: null,
      text: entry.playerText,
      gmText: entry.gmText,
      revealedToPlayers: entry.revealedToPlayers,
      sessionId: entry.sessionId,
      sessionNumber: entry.sessionNumber,
      realDate: entry.realDate,
      inWorldLabel: entry.inWorldLabel,
      calendarInstant: entry.calendarInstant,
      inWorldDate: entry.inWorldDate,
      tags: entry.tags,
      attachPageId: entry.attachPageId,
      attachMarkerId: entry.attachMarkerId,
      sourceEncounterId: entry.sourceEncounterId,
      // `deadlineFired` answers false for non-deadlines and undated rows.
      fired: deadlineFired(entry, context.campaignInstant ?? null),
      payload: projectGmPayload(entry),
      proposedDate: context.proposedDate ?? null,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt
    };
  }
  const page = record.page;
  return {
    kind: "event",
    id: page.id,
    title: page.title,
    text: excerpt(page.playerBody),
    gmText: page.blocks.length > 0 ? excerpt(page.blocks.map(blockText).join(" ")) || null : null,
    revealedToPlayers: page.revealedToPlayers,
    sessionId: null,
    sessionNumber: null,
    realDate: null,
    inWorldLabel: page.inWorldLabel,
    calendarInstant: page.calendarInstant,
    inWorldDate: page.inWorldDate,
    tags: page.tags,
    attachPageId: null,
    attachMarkerId: null,
    sourceEncounterId: null,
    fired: false,
    payload: null,
    proposedDate: null,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt
  };
}

/** null when not player-visible; the chronicle's only gate. Delegates to `projectPlayerJournalEntry` / `projectPlayerPage`. */
export function projectPlayerChronicleRecord(
  record: CodexChronicleSource,
  context: PlayerChronicleContext
): PlayerCodexChronicleRecord | null {
  if (record.kind === "entry") {
    const projected = projectPlayerJournalEntry(record.entry, context);
    if (!projected) return null;
    // No kind filter: `projectPlayerJournalEntry` already applied the reveal, standing and quest gates.
    return {
      kind: chronicleKindOf(projected.kind),
      id: projected.id,
      title: null,
      text: projected.text,
      sessionId: projected.sessionId,
      sessionNumber: projected.sessionNumber,
      realDate: projected.realDate,
      inWorldLabel: projected.inWorldLabel,
      // Both date forms come from the store, already resolved against the live calendar.
      inWorldDate: record.entry.inWorldDate,
      calendarInstant: record.entry.calendarInstant,
      tags: projected.tags,
      fired: deadlineFired(record.entry, context.publishedInstant ?? null),
      payload: projectPlayerPayload(
        record.entry,
        context.revealedPageIds ?? EMPTY_PAGE_IDS,
        context.revealedQuestIds ?? EMPTY_PAGE_IDS,
        context
      ),
      firstShownAt: projected.firstShownAt
    };
  }
  const projected = projectPlayerPage(record.page, context.pages ?? EVERYONE_CONTEXT);
  // As for an entry: an undated page has never been shown, so it fails closed.
  if (!projected || record.page.firstShownAt === null) return null;
  return {
    kind: "event",
    id: projected.id,
    title: projected.title,
    text: excerpt(projected.body),
    sessionId: null,
    sessionNumber: null,
    realDate: null,
    inWorldLabel: record.page.inWorldLabel,
    inWorldDate: record.page.inWorldDate,
    calendarInstant: record.page.calendarInstant,
    tags: projected.tags,
    fired: false,
    payload: null,
    firstShownAt: record.page.firstShownAt
  };
}

// Calendar: the GM's prep clock and the players' published clock are two values

export function projectGmCalendar(calendar: CodexCalendar, publishedDate: CodexInWorldDate | null): GmCodexCalendar {
  return {
    yearName: calendar.yearName,
    eras: calendar.eras ?? [],
    months: calendar.months,
    weekdays: calendar.weekdays,
    currentDate: calendar.currentDate ?? null,
    publishedDate
  };
}

export function projectPlayerCalendar(
  calendar: CodexCalendar,
  publishedDate: CodexInWorldDate | null
): PlayerCodexCalendar {
  return {
    yearName: calendar.yearName,
    eras: calendar.eras ?? [],
    months: calendar.months,
    weekdays: calendar.weekdays,
    currentDate: publishedDate
  };
}

// Suite-wide search: one index, one result list, every record kind

/** A matched record plus the context its player predicate needs (a pin on a hidden map is invisible). */
export type CodexSearchRecord =
  | Readonly<{ kind: "page"; page: CodexPage }>
  | Readonly<{ kind: "journal"; entry: CodexJournalEntry }>
  | Readonly<{ kind: "map"; map: CodexMap }>
  | Readonly<{ kind: "marker"; marker: CodexMarker; mapRevealed: boolean }>
  // A quest's own reveal flag is its whole predicate.
  | Readonly<{ kind: "quest"; quest: CodexQuest }>
  // A session's own reveal flag is its whole predicate; prep and attendees never enter the player index.
  | Readonly<{ kind: "session"; session: CodexSession }>;

/** "Session {n}", else a recap excerpt, else "Untitled session". Only for a session the reader may see. */
export function sessionDisplayTitle(session: Readonly<{ sessionNumber: number | null; recap: string }>): string {
  if (session.sessionNumber !== null) return `Session ${session.sessionNumber}`;
  return excerpt(session.recap) || "Untitled session";
}

/** null when not player-visible, as each kind's player list endpoint decides (markers also need their map revealed). */
export function projectPlayerSearchHit(
  record: CodexSearchRecord,
  context: PlayerSessionNumberContext
): CodexSearchHit | null {
  switch (record.kind) {
    case "page": {
      // Delegates so a hit follows the page read's gate and reads its title as the page read does.
      const projected = projectPlayerPageSummary(record.page, EVERYONE, context);
      return projected !== null
        ? {
            kind: "page",
            id: record.page.id,
            title: projected.title,
            tags: record.page.tags,
            entityType: record.page.entityType,
            mapId: null
          }
        : null;
    }
    case "journal": {
      // Delegates so this arm also gets the standing and quest gates.
      const projected = projectPlayerJournalEntry(record.entry, context);
      return projected === null
        ? null
        : {
            kind: "journal",
            id: record.entry.id,
            title: excerpt(projected.text),
            tags: record.entry.tags,
            entityType: null,
            mapId: null
          };
    }
    case "map":
      return record.map.revealedToPlayers
        ? {
            kind: "map",
            id: record.map.id,
            title: plainText(record.map.name, context),
            tags: record.map.tags,
            entityType: null,
            mapId: null
          }
        : null;
    case "marker":
      return record.marker.revealedToPlayers && record.mapRevealed
        ? {
            kind: "marker",
            id: record.marker.id,
            title: plainText(record.marker.label ?? "", context),
            tags: record.marker.tags,
            entityType: null,
            mapId: record.marker.mapId
          }
        : null;
    case "session": {
      // Delegates to `projectPlayerSession`; prep and attendees never enter the player index at all.
      const projected = projectPlayerSession(record.session, context);
      return projected === null
        ? null
        : {
            kind: "session",
            id: projected.id,
            title: sessionDisplayTitle(projected),
            tags: projected.tags,
            entityType: null,
            mapId: null
          };
    }
    case "quest":
      return record.quest.revealedToPlayers
        ? {
            kind: "quest",
            id: record.quest.id,
            title: plainText(record.quest.title, context),
            tags: record.quest.tags,
            entityType: null,
            mapId: null
          }
        : null;
  }
}

export function projectGmSearchHit(record: CodexSearchRecord): CodexSearchHit {
  switch (record.kind) {
    case "page":
      return {
        kind: "page",
        id: record.page.id,
        title: record.page.title,
        tags: record.page.tags,
        entityType: record.page.entityType,
        mapId: null
      };
    // The GM may see either layer, so an entry with no player text still shows something useful.
    case "journal":
      return {
        kind: "journal",
        id: record.entry.id,
        title: excerpt(record.entry.playerText || record.entry.gmText || ""),
        tags: record.entry.tags,
        entityType: null,
        mapId: null
      };
    case "map":
      return {
        kind: "map",
        id: record.map.id,
        title: record.map.name,
        tags: record.map.tags,
        entityType: null,
        mapId: null
      };
    case "marker":
      return {
        kind: "marker",
        id: record.marker.id,
        title: record.marker.label ?? "",
        tags: record.marker.tags,
        entityType: null,
        mapId: record.marker.mapId
      };
    case "quest":
      return {
        kind: "quest",
        id: record.quest.id,
        title: record.quest.title,
        tags: record.quest.tags,
        entityType: null,
        mapId: null
      };
    // The GM sees a session hit whatever its reveal state.
    case "session":
      return {
        kind: "session",
        id: record.session.id,
        title: sessionDisplayTitle({ sessionNumber: record.session.sessionNumber, recap: record.session.recapBody }),
        tags: record.session.tags,
        entityType: null,
        mapId: null
      };
  }
}

// The reveal audit: one GM view of everything the party can currently see

/** Report order. Every row comes from that kind's player projection; never add a raw `revealed` test here. A new reveal route must be added here; the HTTP test checks the audit against real player reads. */
export const CODEX_REVEAL_AUDIT_KINDS: readonly CodexRevealAuditKind[] = [
  "date",
  "page",
  "map",
  "marker",
  "journal",
  "session",
  "quest",
  "standing"
];

/** One record the audit considers, with exactly the context its player projection needs. */
export type CodexRevealAuditRecord =
  | Readonly<{ kind: "date"; calendar: CodexCalendar; publishedDate: CodexInWorldDate | null }>
  | Readonly<{ kind: "page"; page: CodexPageSummary }>
  | Readonly<{ kind: "map"; map: CodexMap; parentRevealed: boolean }>
  | (Readonly<{ kind: "marker" }> & CodexPageMarkerRecord)
  | Readonly<{ kind: "journal"; entry: CodexJournalEntry; sessionContext: PlayerSessionNumberContext }>
  | Readonly<{ kind: "session"; session: CodexSession }>
  | Readonly<{ kind: "quest"; quest: CodexQuest; revealedEntityIds: ReadonlySet<string> }>
  | Readonly<{ kind: "standing"; standing: CodexStanding; factionRevealed: boolean; factionTitle: string | null }>;

/** Fallback title for a journal record with no player prose; keyed by kind so a new kind fails to compile. */
const AUDIT_JOURNAL_FALLBACK: Readonly<Record<CodexJournalKind, string>> = {
  note: "Journal entry",
  combat: "Battle",
  deadline: "Deadline",
  downtime: "Downtime",
  milestone: "Milestone",
  standing: "Faction standing changed",
  quest: "Quest updated"
};

/** null when the party cannot see the record. Titles come from the player projection's output. */
function auditRow(record: CodexRevealAuditRecord): CodexRevealAuditRow | null {
  switch (record.kind) {
    case "date": {
      // The players' clock, as their calendar read carries it.
      const shown = projectPlayerCalendar(record.calendar, record.publishedDate).currentDate;
      return shown === null
        ? null
        : { kind: "date", id: "published-date", title: inWorldLabel(record.calendar, shown), journalKind: null };
    }
    case "page": {
      const projected = projectPlayerPageSummary(record.page);
      return projected === null ? null : { kind: "page", id: projected.id, title: projected.title, journalKind: null };
    }
    case "map": {
      const projected = projectPlayerMap(record.map, { parentRevealed: record.parentRevealed });
      return projected === null ? null : { kind: "map", id: projected.id, title: projected.name, journalKind: null };
    }
    case "marker": {
      // `projectPlayerPageMarker`, so the map gate applies here too.
      const projected = projectPlayerPageMarker(record);
      return projected === null
        ? null
        : { kind: "marker", id: projected.id, title: projected.label ?? "", journalKind: null };
    }
    case "journal": {
      const projected = projectPlayerJournalEntry(record.entry, record.sessionContext);
      if (projected === null) return null;
      // The record's own text, else its kind; never an empty string (standing records have no player text).
      return {
        kind: "journal",
        id: projected.id,
        title: excerpt(projected.text) || AUDIT_JOURNAL_FALLBACK[record.entry.kind],
        journalKind: projected.kind
      };
    }
    case "session": {
      const projected = projectPlayerSession(record.session);
      if (projected === null) return null;
      return { kind: "session", id: projected.id, title: sessionDisplayTitle(projected), journalKind: null };
    }
    case "quest": {
      const projected = projectPlayerQuest(record.quest, { revealedEntityIds: record.revealedEntityIds });
      return projected === null ? null : { kind: "quest", id: projected.id, title: projected.title, journalKind: null };
    }
    case "standing": {
      const projected = projectPlayerStanding(record.standing, { factionRevealed: record.factionRevealed });
      // The faction page was just confirmed revealed, so its title is one the party can already read.
      return projected === null
        ? null
        : { kind: "standing", id: projected.factionPageId, title: record.factionTitle ?? "", journalKind: null };
    }
  }
}

/** Counts and rows per reveal surface plus totals. A standing row's `id` is its faction page id. */
export function projectRevealAudit(records: readonly CodexRevealAuditRecord[]): CodexRevealAudit {
  const rowsByKind = new Map<CodexRevealAuditKind, CodexRevealAuditRow[]>(
    CODEX_REVEAL_AUDIT_KINDS.map((kind) => [kind, []])
  );
  const totalByKind = new Map<CodexRevealAuditKind, number>(CODEX_REVEAL_AUDIT_KINDS.map((kind) => [kind, 0]));
  for (const record of records) {
    totalByKind.set(record.kind, (totalByKind.get(record.kind) ?? 0) + 1);
    const row = auditRow(record);
    if (row !== null) rowsByKind.get(record.kind)?.push(row);
  }
  const sections = CODEX_REVEAL_AUDIT_KINDS.map((kind) => {
    const rows = rowsByKind.get(kind) ?? [];
    return { kind, revealed: rows.length, total: totalByKind.get(kind) ?? 0, rows };
  });
  return {
    sections,
    revealed: sections.reduce((count, section) => count + section.revealed, 0),
    total: sections.reduce((count, section) => count + section.total, 0)
  };
}
