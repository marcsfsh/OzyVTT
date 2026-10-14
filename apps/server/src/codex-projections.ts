import { deadlineFired } from "./codex-store.js";
import type {
  CodexCalendar,
  CodexCalendarEra,
  CodexCalendarMonth,
  CodexChronicleRecord,
  CodexConnectionRow,
  CodexConnectionSourceKind,
  CodexEntityType,
  CodexInWorldDate,
  CodexJournalKind,
  CodexJournalRow,
  CodexMapRow,
  CodexMarkerRow,
  CodexPageRow,
  CodexPageSummaryRow,
  CodexQuestObjective,
  CodexQuestRow,
  CodexQuestStatus,
  CodexPageConnectionRow,
  CodexRecordKind,
  CodexSessionRow,
  CodexStandingRow
} from "./codex-store.js";

/**
 * The Codex viewer-safety boundary: every player-facing Codex read projects through here. Player shapes are
 * explicit allow-lists (new fields stay secret); callers pass in cross-record reveal state so only this file decides.
 */

export type GmCodexPage = CodexPageRow;

/** A page as a player sees it: the player body only, no `gmBody`, no `rev`, and only when revealed. */
export type PlayerCodexPage = Readonly<{
  id: string;
  title: string;
  entityType: CodexEntityType;
  fields: Readonly<Record<string, string>>;
  folder: string | null;
  tags: readonly string[];
  body: string;
  bannerAssetId: string | null;
  updatedAt: string;
}>;

export type GmCodexPageSummary = CodexPageSummaryRow;
export type PlayerCodexPageSummary = Readonly<{
  id: string;
  title: string;
  entityType: CodexEntityType;
  folder: string | null;
  tags: readonly string[];
  bannerAssetId: string | null;
  updatedAt: string;
}>;

export function projectGmPage(row: CodexPageRow): GmCodexPage {
  return row;
}

/** null when the page is not revealed to players; otherwise the player-facing projection (no gmBody, no gmFields). */
export function projectPlayerPage(row: CodexPageRow): PlayerCodexPage | null {
  if (!row.revealedToPlayers) return null;
  // Allow-list: gmBody, gmFields and rev never enter the result (GM-only attributes live in `gmFields`).
  return {
    id: row.id,
    title: row.title,
    entityType: row.entityType,
    fields: row.fields,
    folder: row.folder,
    tags: row.tags,
    body: row.playerBody,
    bannerAssetId: row.bannerAssetId,
    updatedAt: row.updatedAt
  };
}

export function projectGmPageSummary(row: CodexPageSummaryRow): GmCodexPageSummary {
  return row;
}

export function projectPlayerPageSummary(row: CodexPageSummaryRow): PlayerCodexPageSummary | null {
  if (!row.revealedToPlayers) return null;
  return {
    id: row.id,
    title: row.title,
    entityType: row.entityType,
    folder: row.folder,
    tags: row.tags,
    bannerAssetId: row.bannerAssetId,
    updatedAt: row.updatedAt
  };
}

// Connections (one gate for declared and mention edges)

/** A connection reaches a player only if its target page is revealed, its source is player-visible, and `layer === "player"`. */
export type PlayerConnectionContext = Readonly<{
  /** Page ids the player may see. Both a connection's target and a page-kind source are checked against it. */
  revealedPageIds: ReadonlySet<string>;
  /** Non-page sources the player may see, resolved through each kind's player projection. Absent ids fail closed. */
  revealedSourceIds: ReadonlySet<string>;
}>;

function connectionSourceVisible(
  kind: CodexConnectionSourceKind,
  sourceId: string,
  context: PlayerConnectionContext
): boolean {
  return kind === "page" ? context.revealedPageIds.has(sourceId) : context.revealedSourceIds.has(sourceId);
}

export function projectGmConnections(edges: readonly CodexConnectionRow[]): CodexConnectionRow[] {
  return [...edges];
}

/** Drops `id` (never addressed by players), `layer` (always "player") and `createdAt` (GM authoring metadata). */
export type PlayerCodexConnection = Readonly<{
  fromKind: CodexConnectionSourceKind;
  fromId: string;
  toPageId: string;
  label: string | null;
  origin: "declared" | "mention";
}>;

export function projectPlayerConnections(
  edges: readonly CodexConnectionRow[],
  context: PlayerConnectionContext
): PlayerCodexConnection[] {
  return (
    edges
      .filter(
        (edge) =>
          edge.layer === "player" &&
          context.revealedPageIds.has(edge.toPageId) &&
          connectionSourceVisible(edge.fromKind, edge.fromId, context)
      )
      // Allow-list: a field added to `CodexConnectionRow` stays secret until added here.
      .map((edge) => ({
        fromKind: edge.fromKind,
        fromId: edge.fromId,
        toPageId: edge.toPageId,
        label: edge.label,
        origin: edge.origin
      }))
  );
}

export function projectGmPageConnections(rows: readonly CodexPageConnectionRow[]): CodexPageConnectionRow[] {
  return [...rows];
}

/** Gated by the same `connectionSourceVisible` as the graph feed, not by the weaker `otherRevealed`; drops it, `id` and `layer`. */
export type PlayerCodexPageConnection = Readonly<{
  direction: "out" | "in";
  otherKind: CodexConnectionSourceKind;
  otherId: string;
  otherTitle: string;
  otherEntityType: CodexEntityType | null;
  label: string | null;
  origin: "declared" | "mention";
  section: string | null;
}>;

export function projectPlayerPageConnections(
  rows: readonly CodexPageConnectionRow[],
  context: PlayerConnectionContext
): PlayerCodexPageConnection[] {
  return rows
    .filter((row) => row.layer === "player" && connectionSourceVisible(row.otherKind, row.otherId, context))
    .map((row) => ({
      direction: row.direction,
      otherKind: row.otherKind,
      otherId: row.otherId,
      otherTitle: row.otherTitle,
      otherEntityType: row.otherEntityType,
      label: row.label,
      origin: row.origin,
      section: row.section
    }));
}

// Maps

export type GmCodexMap = CodexMapRow;
export type PlayerCodexMap = Readonly<{
  id: string;
  assetId: string;
  name: string;
  kind: CodexMapRow["kind"];
  parentMapId: string | null;
  tags: readonly string[];
}>;

export function projectGmMap(row: CodexMapRow): GmCodexMap {
  return row;
}
/** null unless revealed. `parentMapId` survives only if the parent is revealed, or it would leak a secret ancestor. */
export function projectPlayerMap(
  row: CodexMapRow,
  context: Readonly<{ parentRevealed: boolean }>
): PlayerCodexMap | null {
  if (!row.revealedToPlayers) return null;
  return {
    id: row.id,
    assetId: row.assetId,
    name: row.name,
    kind: row.kind,
    parentMapId: context.parentRevealed ? row.parentMapId : null,
    tags: row.tags
  };
}

// Markers

export type GmCodexMarker = CodexMarkerRow;
/** No scene/actor links (GM-only); page/sub-map links only when their targets are revealed. */
export type PlayerCodexMarker = Readonly<{
  id: string;
  mapId: string;
  x: number;
  y: number;
  iconId: string;
  iconColor: string;
  label: string | null;
  pageIds: string[];
  subMapId: string | null;
  tags: readonly string[];
  isParty: boolean;
}>;

export function projectGmMarker(row: CodexMarkerRow): GmCodexMarker {
  return row;
}

/** null unless revealed. Unrevealed page/sub-map links are dropped and scene/actor links stripped. `isParty` grants no visibility. */
export function projectPlayerMarker(
  row: CodexMarkerRow,
  context: Readonly<{ revealedPageIds: ReadonlySet<string>; subMapRevealed: boolean }>
): PlayerCodexMarker | null {
  if (!row.revealedToPlayers) return null;
  return {
    id: row.id,
    mapId: row.mapId,
    x: row.x,
    y: row.y,
    iconId: row.iconId,
    iconColor: row.iconColor,
    label: row.label,
    tags: row.tags,
    pageIds: row.pageIds.filter((pageId) => context.revealedPageIds.has(pageId)),
    subMapId: context.subMapRevealed ? row.subMapId : null,
    isParty: row.isParty
  };
}

/** A pin reached by page id, plus `mapRevealed`: it has not passed its map's gate. */
export type CodexPageMarkerRecord = Readonly<{
  marker: CodexMarkerRow;
  mapRevealed: boolean;
  revealedPageIds: ReadonlySet<string>;
  subMapRevealed: boolean;
}>;

/** null unless player-visible: a pin on an unrevealed map is hidden (as `GET /codex/maps/:id/markers`), then `projectPlayerMarker`. */
export function projectPlayerPageMarker(record: CodexPageMarkerRecord): PlayerCodexMarker | null {
  if (!record.mapRevealed) return null;
  return projectPlayerMarker(record.marker, {
    revealedPageIds: record.revealedPageIds,
    subMapRevealed: record.subMapRevealed
  });
}

// Journal

export type GmCodexJournalEntry = CodexJournalRow;
/** Player text only, no gmText or GM-only linkage, only when revealed. */
export type PlayerCodexJournalEntry = Readonly<{
  id: string;
  text: string;
  kind: CodexJournalRow["kind"];
  /** Both `sessionId` and `sessionNumber` are null unless the linked session is revealed: either half reveals it exists. */
  sessionId: string | null;
  sessionNumber: number | null;
  realDate: string | null;
  inWorldLabel: string | null;
  tags: readonly string[];
  createdAt: string;
}>;

/** Default for an unsupplied revealed-id set: nothing is revealed, so nothing travels. */
const EMPTY_PAGE_IDS: ReadonlySet<string> = new Set<string>();

/** Store-resolved facts for a player journal read. Absent sets default to empty, which fails closed. */
export type PlayerSessionNumberContext = Readonly<{
  /** Quests the players have been shown; a `quest` history record is gated on its quest. */
  revealedQuestIds?: ReadonlySet<string>;
  /** Keyed by session id, so an entry filed under an unnumbered hidden session is still gated. */
  unrevealedSessionIds: ReadonlySet<string>;
  revealedPageIds?: ReadonlySet<string>;
}>;

/** A `standing` record is visible only when its faction page is; it has no player prose, so nulling the id alone would leak. */
function playerStandingVisible(row: CodexJournalRow, context: PlayerSessionNumberContext): boolean {
  if (row.kind !== "standing") return true;
  const payload = row.payload;
  const faction = payload !== null && "delta" in payload ? payload.factionPageId : null;
  return faction !== null && (context.revealedPageIds ?? EMPTY_PAGE_IDS).has(faction);
}

/** A `quest` history record is visible only when its quest is; it has no player prose of its own. */
function playerQuestEventVisible(row: CodexJournalRow, context: PlayerSessionNumberContext): boolean {
  if (row.kind !== "quest") return true;
  const payload = row.payload;
  const questId = payload !== null && "questId" in payload ? payload.questId : null;
  return questId !== null && (context.revealedQuestIds ?? EMPTY_PAGE_IDS).has(questId);
}

/** Unrevealed session: both halves null. Revealed: both pass. Bare number with no join (left by deleting a revealed session): passes. */
function playerSessionLink(
  row: CodexJournalRow,
  context: PlayerSessionNumberContext
): { sessionId: string | null; sessionNumber: number | null } {
  if (row.sessionId === null) return { sessionId: null, sessionNumber: row.sessionNumber };
  if (context.unrevealedSessionIds.has(row.sessionId)) return { sessionId: null, sessionNumber: null };
  return { sessionId: row.sessionId, sessionNumber: row.sessionNumber };
}

export function projectGmJournalEntry(row: CodexJournalRow): GmCodexJournalEntry {
  return row;
}
export function projectPlayerJournalEntry(
  row: CodexJournalRow,
  context: PlayerSessionNumberContext
): PlayerCodexJournalEntry | null {
  if (!row.revealedToPlayers) return null;
  if (!playerStandingVisible(row, context)) return null;
  if (!playerQuestEventVisible(row, context)) return null;
  const session = playerSessionLink(row, context);
  return {
    id: row.id,
    text: row.playerText,
    kind: row.kind,
    sessionId: session.sessionId,
    sessionNumber: session.sessionNumber,
    realDate: row.realDate,
    inWorldLabel: row.inWorldLabel,
    tags: row.tags,
    createdAt: row.createdAt
  };
}

// Sessions: prep is the GM half, recap is the player half

export type GmCodexSession = CodexSessionRow;
/** Omits `prepBody` (the GM's plan), `rev`, `attendees` (real-world personal data) and `status`. */
export type PlayerCodexSession = Readonly<{
  id: string;
  sessionNumber: number | null;
  realDate: string | null;
  recap: string;
  /** Tags are single-layer across the Codex and every other kind ships them to players. */
  tags: readonly string[];
}>;

export function projectGmSession(row: CodexSessionRow): GmCodexSession {
  return row;
}

export function projectPlayerSession(row: CodexSessionRow): PlayerCodexSession | null {
  if (!row.revealedToPlayers) return null;
  // Allow-list: a field added to `CodexSessionRow` stays secret until added here.
  return { id: row.id, sessionNumber: row.sessionNumber, realDate: row.realDate, recap: row.recapBody, tags: row.tags };
}

// Quests: playerBody is what the party was told, gmBody is where it is really going

export type GmCodexQuest = CodexQuestRow;
/** Omits `gmBody` and `rev`. Keeps `status` and `objectives` (player-layer); `entityIds` filtered to revealed pages. */
export type PlayerCodexQuest = Readonly<{
  id: string;
  title: string;
  status: CodexQuestStatus;
  body: string;
  objectives: readonly CodexQuestObjective[];
  entityIds: readonly string[];
  /** Tags are single-layer; the quest's own reveal flag is the whole predicate. */
  tags: readonly string[];
}>;

export function projectGmQuest(row: CodexQuestRow): GmCodexQuest {
  return row;
}

/** null when unrevealed. `entityIds` keeps only revealed pages, so a quest never advertises secret page ids. */
export function projectPlayerQuest(
  row: CodexQuestRow,
  context: Readonly<{ revealedEntityIds: ReadonlySet<string> }>
): PlayerCodexQuest | null {
  if (!row.revealedToPlayers) return null;
  // Allow-list: a field added to `CodexQuestRow` stays secret until added here.
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    body: row.playerBody,
    objectives: row.objectives,
    entityIds: row.entityIds.filter((entityId) => context.revealedEntityIds.has(entityId)),
    tags: row.tags
  };
}

// Standing: where the party stands with one faction

export type GmCodexStanding = CodexStandingRow;
/** Omits the row `id` (the faction page id identifies it), the reveal flag and timestamps. `value` is -100..100. */
export type PlayerCodexStanding = Readonly<{ factionPageId: string; value: number }>;

export function projectGmStanding(row: CodexStandingRow): GmCodexStanding {
  return row;
}

/** null unless both the standing and its faction page are revealed: a titleless bar for a secret faction would still leak. */
export function projectPlayerStanding(
  row: CodexStandingRow,
  context: Readonly<{ factionRevealed: boolean }>
): PlayerCodexStanding | null {
  if (!row.revealedToPlayers) return null;
  if (!context.factionRevealed) return null;
  return { factionPageId: row.factionPageId, value: row.value };
}

/** A bounded one-line rendering of a record's prose for list rows (search hits, chronicle rows). */
const EXCERPT_LENGTH = 160;
function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= EXCERPT_LENGTH ? flat : `${flat.slice(0, EXCERPT_LENGTH - 1)}…`;
}

// The chronicle: one timeline of journal entries and dated `event` pages

/** The client's `CHRONICLE_KIND_META` is keyed by this, so a new kind is a compile error until it has an icon and label. */
export type CodexChronicleKind =
  "entry" | "combat" | "event" | "deadline" | "downtime" | "milestone" | "standing" | "quest";

/** Exhaustive, no `default`: a new journal kind is a compile error here rather than rendering as a plain entry. */
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

/** `applied` is GM workflow state and stays GM-only. Kinds without a payload carry `null`. */
export type GmCodexDowntime = Readonly<{
  who: string;
  activity: string;
  days: number;
  applied: boolean;
  characterPageId: string | null;
}>;
/** `characterPageId` travels only when that page is revealed; the row itself stays meaningful without it. */
export type PlayerCodexDowntime = Readonly<{
  who: string;
  activity: string;
  days: number;
  characterPageId: string | null;
}>;

/** Separate GM/player shapes so new fields default to secret. A standing's `factionPageId` is nulled unless revealed. */
export type GmCodexMilestone = Readonly<{ level: number; reason: string }>;
export type PlayerCodexMilestone = Readonly<{ level: number; reason: string }>;
export type GmCodexStandingChange = Readonly<{ factionPageId: string; delta: number; reason: string }>;
export type PlayerCodexStandingChange = Readonly<{ factionPageId: string | null; delta: number; reason: string }>;
/** The row is hidden unless the quest is revealed; `questId` is also nulled unless revealed. */
export type GmCodexQuestEvent = Readonly<{ questId: string; status: CodexQuestStatus }>;
export type PlayerCodexQuestEvent = Readonly<{ questId: string | null; status: CodexQuestStatus }>;

/** Every payload shape a GM chronicle row can carry. `null` for the kinds that carry none. */
export type GmCodexChroniclePayload = GmCodexDowntime | GmCodexMilestone | GmCodexStandingChange | GmCodexQuestEvent;
/** Every payload shape a player chronicle row can carry, each narrower than or equal to its GM twin. */
export type PlayerCodexChroniclePayload =
  PlayerCodexDowntime | PlayerCodexMilestone | PlayerCodexStandingChange | PlayerCodexQuestEvent;

// Dispatch on the entry's `kind` so a payload only rides out on its own kind; `in` guards fail closed.
function projectGmPayload(entry: CodexJournalRow): GmCodexChroniclePayload | null {
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
  entry: CodexJournalRow,
  revealedPageIds: ReadonlySet<string>,
  revealedQuestIds: ReadonlySet<string>
): PlayerCodexChroniclePayload | null {
  const payload = entry.payload;
  if (payload === null) return null;
  switch (entry.kind) {
    case "downtime":
      return "who" in payload
        ? {
            who: payload.who,
            activity: payload.activity,
            days: payload.days,
            characterPageId:
              payload.characterPageId !== null && revealedPageIds.has(payload.characterPageId)
                ? payload.characterPageId
                : null
          }
        : null;
    case "milestone":
      return "level" in payload ? { level: payload.level, reason: payload.reason } : null;
    case "standing":
      return "delta" in payload
        ? {
            factionPageId: revealedPageIds.has(payload.factionPageId) ? payload.factionPageId : null,
            delta: payload.delta,
            reason: payload.reason
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

/** `publishedInstant`, not `campaignInstant`, so the GM context is not assignable here by accident. */
export type PlayerChronicleContext = PlayerSessionNumberContext &
  Readonly<{
    publishedInstant?: number | null;
    /** Revealed page ids, for payload links to pages. Absent means empty, which nulls the id. */
    revealedPageIds?: ReadonlySet<string>;
  }>;

/** Every key present on every kind. For an `event` page, `text`/`gmText` are bounded excerpts of its bodies. */
export type GmCodexChronicleRecord = Readonly<{
  kind: CodexChronicleKind;
  id: string;
  title: string | null;
  text: string;
  gmText: string | null;
  revealedToPlayers: boolean;
  /** The session record this row belongs to. `null` for an `event` page and for an unfiled entry. */
  sessionId: string | null;
  sessionNumber: number | null;
  realDate: string | null;
  inWorldLabel: string | null;
  calendarInstant: number | null;
  inWorldDate: CodexInWorldDate | null;
  tags: readonly string[];
  attachPageId: string | null;
  attachMarkerId: string | null;
  sourceEncounterId: number | null;
  /** Derived: has the GM's clock reached this deadline's date? `false` for every other kind. */
  fired: boolean;
  /** The kind's structured facts, GM shape (`applied` included). `null` for kinds with none. */
  payload: GmCodexChroniclePayload | null;
  /** Where the clock would land if the GM confirms a downtime. `null` once applied and for other kinds. */
  proposedDate: CodexInWorldDate | null;
  createdAt: string;
  updatedAt: string;
}>;

/** Never exceeds the player list projections; omits `gmText`, attachments, `sourceEncounterId`, `rev` and `proposedDate`. */
export type PlayerCodexChronicleRecord = Readonly<{
  kind: CodexChronicleKind;
  id: string;
  title: string | null;
  text: string;
  sessionId: string | null;
  sessionNumber: number | null;
  realDate: string | null;
  inWorldLabel: string | null;
  /** Derived from the record's published date; carries the same information as `inWorldLabel`. */
  inWorldDate: CodexInWorldDate | null;
  /** Derived from `inWorldDate` and the player's calendar; sent so the client never re-derives it differently. */
  calendarInstant: number | null;
  tags: readonly string[];
  fired: boolean;
  payload: PlayerCodexChroniclePayload | null;
  createdAt: string;
}>;

export function projectGmChronicleRecord(
  record: CodexChronicleRecord,
  context: GmChronicleContext = {}
): GmCodexChronicleRecord {
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
    gmText: page.gmBody.trim() ? excerpt(page.gmBody) : null,
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
  record: CodexChronicleRecord,
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
        context.revealedQuestIds ?? EMPTY_PAGE_IDS
      ),
      createdAt: projected.createdAt
    };
  }
  const projected = projectPlayerPage(record.page);
  if (!projected) return null;
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
    createdAt: record.page.createdAt
  };
}

// Calendar: the GM's prep clock and the players' published clock are two values

/** `publishedDate` lives outside `calendar_json` because `PUT /codex/calendar` replaces that blob wholesale. */
export type GmCodexCalendar = Readonly<{
  yearName: string;
  eras: readonly CodexCalendarEra[];
  months: readonly CodexCalendarMonth[];
  weekdays: readonly string[];
  /** The GM's clock - the campaign's authoritative "now". Never reaches a player by any path. */
  currentDate: CodexInWorldDate | null;
  /** What players currently see as "now". Equal to `currentDate` until the GM runs ahead while prepping. */
  publishedDate: CodexInWorldDate | null;
}>;

/** `currentDate` is the published date; the GM's own `currentDate` is never read. Calendar structure is always public. */
export type PlayerCodexCalendar = Readonly<{
  yearName: string;
  eras: readonly CodexCalendarEra[];
  months: readonly CodexCalendarMonth[];
  weekdays: readonly string[];
  currentDate: CodexInWorldDate | null;
}>;

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
  | Readonly<{ kind: "page"; page: CodexPageRow }>
  | Readonly<{ kind: "journal"; entry: CodexJournalRow }>
  | Readonly<{ kind: "map"; map: CodexMapRow }>
  | Readonly<{ kind: "marker"; marker: CodexMarkerRow; mapRevealed: boolean }>
  // A quest's own reveal flag is its whole predicate.
  | Readonly<{ kind: "quest"; quest: CodexQuestRow }>
  // A session's own reveal flag is its whole predicate; prep and attendees never enter the player index.
  | Readonly<{ kind: "session"; session: CodexSessionRow }>;

/** "Session {n}", else a recap excerpt, else "Untitled session". Only for a session the reader may see. */
export function sessionDisplayTitle(session: Readonly<{ sessionNumber: number | null; recap: string }>): string {
  if (session.sessionNumber !== null) return `Session ${session.sessionNumber}`;
  return excerpt(session.recap) || "Untitled session";
}

/** Every key present on every kind; each field is already in that kind's player projection. No bodies, flags or `rev`. */
export type CodexSearchHit = Readonly<{
  kind: CodexRecordKind;
  id: string;
  title: string;
  tags: readonly string[];
  entityType: CodexEntityType | null;
  mapId: string | null;
}>;

/** null when not player-visible, matching each kind's player list endpoint (markers also need their map revealed). */
export function projectPlayerSearchHit(
  record: CodexSearchRecord,
  context: PlayerSessionNumberContext
): CodexSearchHit | null {
  switch (record.kind) {
    case "page":
      return record.page.revealedToPlayers
        ? {
            kind: "page",
            id: record.page.id,
            title: record.page.title,
            tags: record.page.tags,
            entityType: record.page.entityType,
            mapId: null
          }
        : null;
    case "journal":
      // Delegates so this arm also gets the standing and quest gates.
      return projectPlayerJournalEntry(record.entry, context) === null
        ? null
        : {
            kind: "journal",
            id: record.entry.id,
            title: excerpt(record.entry.playerText),
            tags: record.entry.tags,
            entityType: null,
            mapId: null
          };
    case "map":
      return record.map.revealedToPlayers
        ? {
            kind: "map",
            id: record.map.id,
            title: record.map.name,
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
            title: record.marker.label ?? "",
            tags: record.marker.tags,
            entityType: null,
            mapId: record.marker.mapId
          }
        : null;
    case "session": {
      // Delegates to `projectPlayerSession`; prep and attendees never enter the player index at all.
      const projected = projectPlayerSession(record.session);
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
            title: record.quest.title,
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

/** Read-only: every row comes from that kind's player projection. Never add a raw `revealed` test here. */
export type CodexRevealAuditKind = "page" | "map" | "marker" | "journal" | "session" | "quest" | "standing";
/** Report order. A new reveal route must be added here; the HTTP test checks the audit against real player reads. */
export const CODEX_REVEAL_AUDIT_KINDS: readonly CodexRevealAuditKind[] = [
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
  | Readonly<{ kind: "page"; page: CodexPageSummaryRow }>
  | Readonly<{ kind: "map"; map: CodexMapRow; parentRevealed: boolean }>
  | (Readonly<{ kind: "marker" }> & CodexPageMarkerRecord)
  | Readonly<{ kind: "journal"; entry: CodexJournalRow; sessionContext: PlayerSessionNumberContext }>
  | Readonly<{ kind: "session"; session: CodexSessionRow }>
  | Readonly<{ kind: "quest"; quest: CodexQuestRow; revealedEntityIds: ReadonlySet<string> }>
  | Readonly<{ kind: "standing"; standing: CodexStandingRow; factionRevealed: boolean; factionTitle: string | null }>;

/** `id` is what that kind's reveal route takes, so hiding from the audit reuses `POST /codex/<kind>/{id}/reveal`. */
export type CodexRevealAuditRow = Readonly<{
  kind: CodexRevealAuditKind;
  id: string;
  title: string;
  /** The journal kind on a `journal` row (rendered as a badge), `null` elsewhere so every row has one shape. */
  journalKind: CodexJournalKind | null;
}>;

/** One reveal surface's report. Always present, `revealed: 0` and `rows: []` when the party can see none of it. */
export type CodexRevealAuditSection = Readonly<{
  kind: CodexRevealAuditKind;
  revealed: number;
  /** How many exist at all, so "3 of 40" reads as deliberate rather than as an empty screen. */
  total: number;
  rows: readonly CodexRevealAuditRow[];
}>;

export type CodexRevealAudit = Readonly<{
  sections: readonly CodexRevealAuditSection[];
  revealed: number;
  total: number;
}>;

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
    case "page": {
      const projected = projectPlayerPageSummary(record.page);
      return projected === null ? null : { kind: "page", id: projected.id, title: projected.title, journalKind: null };
    }
    case "map": {
      const projected = projectPlayerMap(record.map, { parentRevealed: record.parentRevealed });
      return projected === null ? null : { kind: "map", id: projected.id, title: projected.name, journalKind: null };
    }
    case "marker": {
      // `projectPlayerPageMarker`, not `projectPlayerMarker`: the map gate applies here too.
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
