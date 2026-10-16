// The Codex's HTTP shapes (`/api/v1/codex/*`): one definition that the server's projections are typed
// against and the client reads. The GM shape of a record is the stored row; its player twin is a separate
// allow-list, so a field added to the GM side stays off the player wire until it is added here too.

import type { CodexCalendarEra, CodexCalendarMonth, CodexInWorldDate } from "./codex-calendar.js";
import type { CodexEntityType } from "./codex-entities.js";

// ----- Vocabulary -----

/** Which record a connection comes from. Every connection points into a page. */
export type CodexConnectionSourceKind = "page" | "session" | "quest" | "journal";
export type CodexConnectionOrigin = "declared" | "mention";
/** A GM-layer edge never travels to a player; a mention takes the layer of the text it sits in. */
export type CodexConnectionLayer = "player" | "gm";
export type CodexMapKind = "battlemap" | "regional" | "world";
/** Every journal row's kind, discriminated for display. */
export type CodexJournalKind = "note" | "combat" | "deadline" | "downtime" | "milestone" | "standing" | "quest";
/** A chronicle row: a journal kind (`note` reads as `entry`) or a dated `event` page. */
export type CodexChronicleKind =
  "entry" | "combat" | "event" | "deadline" | "downtime" | "milestone" | "standing" | "quest";
export type CodexSessionStatus = "planned" | "played";
/** Lifecycle order. `not-started` and `active` are open; the rest are done. */
export type CodexQuestStatus = "not-started" | "active" | "completed" | "failed" | "canceled";
/** A blank `text` is a legitimate transient state (a row just added), so blank rows are never stripped. */
export type CodexQuestObjective = Readonly<{ text: string; done: boolean }>;
/** The kinds the suite-wide search indexes. */
export type CodexRecordKind = "page" | "journal" | "map" | "marker" | "quest" | "session";
/** Every surface the reveal audit reports on. */
export type CodexRevealAuditKind = "date" | "page" | "map" | "marker" | "journal" | "session" | "quest" | "standing";

// ----- Pages -----

export type CodexPageSummary = Readonly<{
  id: string;
  title: string;
  entityType: CodexEntityType;
  /** Player-facing structured fields; secret keys rest in `gmFields`. */
  fields: Readonly<Record<string, string>>;
  folder: string | null;
  tags: readonly string[];
  revealedToPlayers: boolean;
  bannerAssetId: string | null;
  /** Derived from `inWorldDate`, the date the GM typed, against the live calendar. */
  inWorldLabel: string | null;
  calendarInstant: number | null;
  inWorldDate: CodexInWorldDate | null;
  rev: number;
  createdAt: string;
  updatedAt: string;
}>;
export type CodexPage = CodexPageSummary &
  Readonly<{ playerBody: string; gmBody: string; gmFields: Readonly<Record<string, string>> }>;

/** Only when revealed: no GM body, GM fields, reveal flag, date or `rev`. */
export type PlayerCodexPageSummary = Readonly<{
  id: string;
  title: string;
  entityType: CodexEntityType;
  folder: string | null;
  tags: readonly string[];
  bannerAssetId: string | null;
  updatedAt: string;
}>;
/** `playerBody` arrives as `body`. */
export type PlayerCodexPage = PlayerCodexPageSummary &
  Readonly<{ fields: Readonly<Record<string, string>>; body: string }>;

/** GM-only: the state a save checkpointed. */
export type CodexPageRevision = Readonly<{
  id: number;
  pageId: string;
  rev: number;
  title: string;
  playerBody: string;
  gmBody: string;
  bannerAssetId: string | null;
  tags: readonly string[];
  authoredAt: string;
  authorTag: string;
}>;

// ----- Connections: declared edges and `[[wiki link]]` mentions are one system -----

/** One graph edge. `id` is null exactly for a mention, which is edited through its source text. */
export type CodexConnection = Readonly<{
  id: string | null;
  fromKind: CodexConnectionSourceKind;
  fromId: string;
  toPageId: string;
  /** The out-label ("ally of"); null for an unlabelled connection. */
  label: string | null;
  origin: CodexConnectionOrigin;
  layer: CodexConnectionLayer;
  createdAt: string | null;
}>;
/** Player-layer edges between records the player can see; no `id`, `layer` or `createdAt`. */
export type PlayerCodexConnection = Readonly<{
  fromKind: CodexConnectionSourceKind;
  fromId: string;
  toPageId: string;
  label: string | null;
  origin: CodexConnectionOrigin;
}>;

/** One row of a page's Connections panel: the other end resolved, plus the edge's direction. */
export type CodexPageConnection = Readonly<{
  id: string | null;
  direction: "out" | "in";
  otherKind: CodexConnectionSourceKind;
  otherId: string;
  /** A page title, "Session 4", a quest title, or a bounded excerpt of a journal entry's player text. */
  otherTitle: string;
  otherEntityType: CodexEntityType | null;
  /** The other record's own reveal flag. */
  otherRevealed: boolean;
  label: string | null;
  origin: CodexConnectionOrigin;
  layer: CodexConnectionLayer;
  /** The heading a mention sits under; null for a declared connection. */
  section: string | null;
}>;
/** Gated like the graph feed; no `id`, `layer` or `otherRevealed`. */
export type PlayerCodexPageConnection = Readonly<{
  direction: "out" | "in";
  otherKind: CodexConnectionSourceKind;
  otherId: string;
  otherTitle: string;
  otherEntityType: CodexEntityType | null;
  label: string | null;
  origin: CodexConnectionOrigin;
  section: string | null;
}>;

// ----- The atlas: maps and their pins -----

export type CodexMap = Readonly<{
  id: string;
  assetId: string;
  name: string;
  kind: CodexMapKind;
  parentMapId: string | null;
  revealedToPlayers: boolean;
  sortKey: number;
  tags: readonly string[];
  createdAt: string;
  updatedAt: string;
}>;
/** Only when revealed. `parentMapId` is null unless the parent is revealed too. */
export type PlayerCodexMap = Readonly<{
  id: string;
  assetId: string;
  name: string;
  kind: CodexMapKind;
  parentMapId: string | null;
  tags: readonly string[];
}>;

export type CodexMarker = Readonly<{
  id: string;
  mapId: string;
  x: number;
  y: number;
  iconId: string;
  iconColor: string;
  label: string | null;
  revealedToPlayers: boolean;
  tags: readonly string[];
  /** At most one party pin atlas-wide. Player-facing, but grants no visibility. */
  isParty: boolean;
  pageIds: string[];
  subMapId: string | null;
  /** Scenes staged from this pin: GM-only in every projection. */
  sceneIds: string[];
  actorId: string | null;
  createdAt: string;
  updatedAt: string;
}>;
/** Only when the pin and its map are revealed. No scene or actor links; page and sub-map links only when revealed. */
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

// ----- Journal payloads, one per kind that carries structured facts -----

/** `applied` (has the GM confirmed the clock move?) makes applying idempotent and is GM workflow state. */
export type CodexDowntimePayload = Readonly<{
  who: string;
  activity: string;
  days: number;
  applied: boolean;
  /** Links the row to a character page; `who` is the fallback. No foreign key: deleting the page nulls it. */
  characterPageId: string | null;
}>;
/** The level reached, not a delta. `reason` has no reveal split, so GM-only detail belongs in `gmText`. */
export type CodexMilestonePayload = Readonly<{ level: number; reason: string }>;
/** `delta` is the change, not the new value. No foreign key, so history survives a deleted faction. */
export type CodexStandingPayload = Readonly<{ factionPageId: string; delta: number; reason: string }>;
/** A quest reached `status`, written on quest create and status change. No foreign key, so history survives the quest. */
export type CodexQuestEventPayload = Readonly<{ questId: string; status: CodexQuestStatus }>;
export type CodexJournalPayload =
  CodexDowntimePayload | CodexMilestonePayload | CodexStandingPayload | CodexQuestEventPayload;

/** No `applied`; `characterPageId` only when that page is revealed. */
export type PlayerCodexDowntimePayload = Readonly<{
  who: string;
  activity: string;
  days: number;
  characterPageId: string | null;
}>;
export type PlayerCodexMilestonePayload = Readonly<{ level: number; reason: string }>;
/** `factionPageId` is null unless the faction's page is revealed. */
export type PlayerCodexStandingPayload = Readonly<{ factionPageId: string | null; delta: number; reason: string }>;
/** `questId` is null unless the quest is revealed. */
export type PlayerCodexQuestEventPayload = Readonly<{ questId: string | null; status: CodexQuestStatus }>;
export type PlayerCodexJournalPayload =
  PlayerCodexDowntimePayload | PlayerCodexMilestonePayload | PlayerCodexStandingPayload | PlayerCodexQuestEventPayload;

// ----- The journal -----

export type CodexJournalEntry = Readonly<{
  id: string;
  playerText: string;
  gmText: string | null;
  revealedToPlayers: boolean;
  attachMarkerId: string | null;
  attachPageId: string | null;
  kind: CodexJournalKind;
  sourceEncounterId: number | null;
  /** The session this entry is filed under, or null. */
  sessionId: string | null;
  /** The session's live number, or the number a deleted revealed session left behind (with `sessionId` null). */
  sessionNumber: number | null;
  realDate: string | null;
  inWorldLabel: string | null;
  calendarInstant: number | null;
  /** The literal date the GM entered, so instants can be recomputed when the calendar changes. */
  inWorldDate: CodexInWorldDate | null;
  sortKey: number;
  tags: readonly string[];
  /** Kind-specific structured data; null for kinds without one. */
  payload: CodexJournalPayload | null;
  createdAt: string;
  updatedAt: string;
}>;
/**
 * Only when revealed. `sessionId` and `sessionNumber` are both null unless the session is revealed, since
 * either half says the session exists.
 */
export type PlayerCodexJournalEntry = Readonly<{
  id: string;
  text: string;
  kind: CodexJournalKind;
  sessionId: string | null;
  sessionNumber: number | null;
  realDate: string | null;
  inWorldLabel: string | null;
  tags: readonly string[];
  createdAt: string;
}>;

/**
 * One chronicle row: a journal entry, or a dated `event` page (`id` is then the page id and the texts are
 * bounded excerpts of its bodies). Every key is present on every kind.
 */
export type CodexChronicleRecord = Readonly<{
  kind: CodexChronicleKind;
  id: string;
  title: string | null;
  text: string;
  gmText: string | null;
  revealedToPlayers: boolean;
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
  /** Has the GM's clock reached this deadline's date? Derived server-side, so rewinding the clock un-fires it. */
  fired: boolean;
  payload: CodexJournalPayload | null;
  /** Where confirming this downtime would move the clock. Null once applied and for other kinds. */
  proposedDate: CodexInWorldDate | null;
  createdAt: string;
  updatedAt: string;
}>;
/** No GM text, attachments, encounter id or proposed date. `fired` is measured against the published date. */
export type PlayerCodexChronicleRecord = Readonly<{
  kind: CodexChronicleKind;
  id: string;
  title: string | null;
  text: string;
  sessionId: string | null;
  sessionNumber: number | null;
  realDate: string | null;
  inWorldLabel: string | null;
  inWorldDate: CodexInWorldDate | null;
  /** Use this for placement and sorting; never re-derive it client-side. */
  calendarInstant: number | null;
  tags: readonly string[];
  fired: boolean;
  payload: PlayerCodexJournalPayload | null;
  createdAt: string;
}>;

// ----- Sessions: prep is the GM half, the recap the player half -----

export type CodexSession = Readonly<{
  id: string;
  sessionNumber: number | null;
  /** The real-world date the group met, free text. */
  realDate: string | null;
  attendees: readonly string[];
  prepBody: string;
  recapBody: string;
  revealedToPlayers: boolean;
  status: CodexSessionStatus;
  tags: readonly string[];
  /** Scenes staged for this session. A dangling id is expected. */
  sceneIds: readonly string[];
  rev: number;
  createdAt: string;
  updatedAt: string;
}>;
/**
 * Only when revealed. No prep (the GM's plan), attendees (real-world personal data), status, scenes or `rev`;
 * `recapBody` arrives as `recap`.
 */
export type PlayerCodexSession = Readonly<{
  id: string;
  sessionNumber: number | null;
  realDate: string | null;
  recap: string;
  tags: readonly string[];
}>;

// ----- Quests: the player body is what the party was told, the GM body where it is really going -----

export type CodexQuest = Readonly<{
  id: string;
  title: string;
  status: CodexQuestStatus;
  playerBody: string;
  gmBody: string;
  /** Ordered: the GM's sequence is the meaning. */
  objectives: readonly CodexQuestObjective[];
  /** Pages this quest concerns. */
  entityIds: readonly string[];
  revealedToPlayers: boolean;
  tags: readonly string[];
  rev: number;
  createdAt: string;
  updatedAt: string;
}>;
/** Only when revealed. No GM body or `rev`; `entityIds` only for revealed pages. */
export type PlayerCodexQuest = Readonly<{
  id: string;
  title: string;
  status: CodexQuestStatus;
  body: string;
  objectives: readonly CodexQuestObjective[];
  entityIds: readonly string[];
  tags: readonly string[];
}>;

// ----- Faction standing -----

/** One row per faction page. `value` runs -100 (Hostile) to +100 (Allied); the history is `standing` journal rows. */
export type CodexStanding = Readonly<{
  id: string;
  factionPageId: string;
  value: number;
  revealedToPlayers: boolean;
  createdAt: string;
  updatedAt: string;
}>;
/** Only when both the standing and its faction page are revealed. The faction page id identifies it. */
export type PlayerCodexStanding = Readonly<{ factionPageId: string; value: number }>;

// ----- The calendar: the GM's prep clock and the players' published clock -----

/** `currentDate` is the GM's clock; `publishedDate` is what players currently see as theirs. */
export type GmCodexCalendar = Readonly<{
  yearName: string;
  eras: readonly CodexCalendarEra[];
  months: readonly CodexCalendarMonth[];
  weekdays: readonly string[];
  currentDate: CodexInWorldDate | null;
  publishedDate: CodexInWorldDate | null;
}>;
/** `currentDate` is the published date. The calendar's structure is public. */
export type PlayerCodexCalendar = Readonly<{
  yearName: string;
  eras: readonly CodexCalendarEra[];
  months: readonly CodexCalendarMonth[];
  weekdays: readonly string[];
  currentDate: CodexInWorldDate | null;
}>;

// ----- Suite-wide search -----

/** Every key is present on every kind, and each is already in that kind's player projection. */
export type CodexSearchHit = Readonly<{
  kind: CodexRecordKind;
  id: string;
  title: string;
  tags: readonly string[];
  /** Pages only. */
  entityType: CodexEntityType | null;
  /** Markers only, so a pin hit can open its map. */
  mapId: string | null;
}>;
/** The Codex is unpaginated; `truncated` means the search itself was cut off. */
export type CodexSearchResult = Readonly<{ hits: readonly CodexSearchHit[]; truncated: boolean }>;

// ----- Settings (GM-only) -----

/** `enabled: false` stops new revisions but deletes none; `windowMinutes: 0` keeps every save. */
export type CodexRevisionHistorySettings = Readonly<{ enabled: boolean; windowMinutes: number }>;
/** What kept history costs; `versionBytes` is an approximate character count, not disk usage. */
export type CodexRevisionHistoryUsage = Readonly<{ versionCount: number; versionBytes: number }>;
/** A preference stored server-side so it follows the GM across devices. */
export type CodexAutosaveSettings = Readonly<{ enabled: boolean; intervalSeconds: number }>;
export type CodexSettings = Readonly<{
  revisionHistory: CodexRevisionHistorySettings & CodexRevisionHistoryUsage;
  autosave: CodexAutosaveSettings;
}>;
/** The writable half, sent whole: usage figures are server facts. */
export type CodexSettingsInput = Readonly<{
  revisionHistory: CodexRevisionHistorySettings;
  autosave: CodexAutosaveSettings;
}>;

// ----- The reveal audit (GM-only): what the player projections currently emit -----

/** `id` is what the kind's reveal route takes, which for `standing` is the faction page id. The `date` row's
 *  routes are the calendar's publish and unpublish, which take none. */
export type CodexRevealAuditRow = Readonly<{
  kind: CodexRevealAuditKind;
  id: string;
  title: string;
  /** Set on `journal` rows only, since `title` is the record's prose and cannot identify its kind. */
  journalKind: CodexJournalKind | null;
}>;
/** Always present: `revealed: 0` and no rows when the party can see none of it. */
export type CodexRevealAuditSection = Readonly<{
  kind: CodexRevealAuditKind;
  revealed: number;
  /** How many exist at all. */
  total: number;
  rows: readonly CodexRevealAuditRow[];
}>;
export type CodexRevealAudit = Readonly<{
  sections: readonly CodexRevealAuditSection[];
  revealed: number;
  total: number;
}>;

// ----- Backup -----

/** The database's own row counts after a restore, never the bundle's claims. */
export type CodexImportCounts = Readonly<{
  pages: number;
  folders: number;
  maps: number;
  markers: number;
  journal: number;
  /** Declared connections only; mentions are rebuilt from body text. */
  connections: number;
  sessions: number;
  quests: number;
  standing: number;
  revisions: number;
}>;
