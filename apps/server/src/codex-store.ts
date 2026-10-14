import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  CODEX_ENTITY_TYPES, CODEX_SECRET_FIELD_KEYS, pruneCodexFields, type CodexEntityType as DomainCodexEntityType
} from "@vtt/domain";

/**
 * Codex persistence (pages, maps, journal, sessions, quests, standing, calendar) in its own tables, written via
 * GM-gated REST (`codex-http.ts`). Every write bumps `codexRevision`, which pings clients and keys ETags.
 * Security: rows hold both layers; only `codex-projections.ts` strips GM data for players.
 */

/** `note` is a plain page; other types carry structured `fields`. Shared with the GM UI via `@vtt/domain`. */
export type CodexEntityType = DomainCodexEntityType;
export const ENTITY_TYPES: readonly CodexEntityType[] = CODEX_ENTITY_TYPES;

export type CodexPageRow = Readonly<{
  id: string;
  title: string;
  entityType: CodexEntityType;
  /** Structured, type-specific attributes (key -> value); player-facing when the page is revealed. */
  fields: Readonly<Record<string, string>>;
  /** GM-only structured attributes; never projected to players, like `gmBody`. */
  gmFields: Readonly<Record<string, string>>;
  folder: string | null;
  tags: readonly string[];
  playerBody: string;
  gmBody: string;
  revealedToPlayers: boolean;
  bannerAssetId: string | null;
  /** `inWorldDate` is the source of truth; the instant and label derive from it. Every page has the columns, so a type switch is lossless. */
  inWorldLabel: string | null;
  calendarInstant: number | null;
  inWorldDate: CodexInWorldDate | null;
  rev: number;
  createdAt: string;
  updatedAt: string;
}>;

export type CodexPageSummaryRow = Omit<CodexPageRow, "playerBody" | "gmBody" | "gmFields">;

/** Which record a connection comes from. Connections always point into a page. */
export type CodexConnectionSourceKind = "page" | "session" | "quest" | "journal";
/** One graph edge, declared or a `[[wiki link]]` mention (`id` null). `layer` gates players; a mention takes its source body's layer. */
export type CodexConnectionRow = Readonly<{
  id: string | null;
  fromKind: CodexConnectionSourceKind;
  fromId: string;
  toPageId: string;
  /** The out-label ("ally of", "located in"). Null for an unlabelled connection - `''` stored, null read. */
  label: string | null;
  origin: "declared" | "mention";
  layer: "player" | "gm";
  createdAt: string | null;
}>;
/** One row of a page's Connections panel: the other endpoint resolved, plus the edge direction. */
export type CodexPageConnectionRow = Readonly<{
  id: string | null;
  direction: "out" | "in";
  otherKind: CodexConnectionSourceKind;
  otherId: string;
  /** A page title, "Session 4", a quest title, or a bounded excerpt of a journal entry's player text. */
  otherTitle: string;
  otherEntityType: CodexEntityType | null;
  /** The other record's own reveal state. GM-only on the wire; the player projection drops it. */
  otherRevealed: boolean;
  label: string | null;
  origin: "declared" | "mention";
  layer: "player" | "gm";
  /** The heading a mention sits under; null for a declared connection. */
  section: string | null;
}>;

/** One declared connection as the store keeps it. The graph's wire shape is `CodexConnectionRow`. */
export type CodexRelationshipRow = Readonly<{ id: string; fromPageId: string; toPageId: string; label: string | null; layer: "player" | "gm"; createdAt: string }>;

export type CodexLinkRow = Readonly<{
  sourceKind: CodexConnectionSourceKind;
  sourceId: string;
  layer: "player" | "gm";
  targetKind: CodexLinkTargetKind;
  targetRef: string;
  section: string | null;
}>;
export type CodexLinkTargetKind = "page" | "actor" | "monster" | "spell" | "map" | "marker";

export type CodexPageRevisionRow = Readonly<{
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

/** A revision as the backup carries it: the wire row plus the columns `restoreRevision` needs. */
export type CodexPageRevisionExportRow = CodexPageRevisionRow & Readonly<{
  entityType: CodexEntityType;
  fields: Readonly<Record<string, string>>;
  gmFields: Readonly<Record<string, string>>;
}>;

/** `enabled: false` stops new revisions but deletes none. `windowMinutes` coalesces saves; `0` checkpoints every save. */
export type CodexRevisionSettings = Readonly<{ enabled: boolean; windowMinutes: number }>;
/** Read-only cost of kept history; `versionBytes` is an approximate character count, not disk usage. */
export type CodexRevisionHistoryUsage = Readonly<{ versionCount: number; versionBytes: number }>;
/** The revision-history section as a reader sees it: the settable knobs plus what the history costs. */
export type CodexRevisionHistory = CodexRevisionSettings & CodexRevisionHistoryUsage;
/** Editor autosave preference in seconds; stored here only so it follows the GM across devices. */
export type CodexAutosaveSettings = Readonly<{ enabled: boolean; intervalSeconds: number }>;
/** Every Codex-wide setting, nested by area: the `codex_meta` settings row as a caller sees it. */
export type CodexSettings = Readonly<{ revisionHistory: CodexRevisionHistory; autosave: CodexAutosaveSettings }>;
/** The writable half: usage figures are server facts and cannot be sent. */
export type CodexSettingsInput = Readonly<{ revisionHistory: CodexRevisionSettings; autosave: CodexAutosaveSettings }>;

export type CodexBacklinkRow = Readonly<{
  sourcePageId: string;
  sourceTitle: string;
  sourceRevealed: boolean;
  layer: "player" | "gm";
  section: string | null;
}>;

/**
 * Kinds in the search index. Adding one is a viewer-safety change with three gates: its `index*` writer puts only
 * player-layer text in `codex_search_player` (nothing downstream catches GM text there), `PLAYER_VISIBLE_SQL`,
 * and `projectPlayerSearchHit`. Gates 2 and 3 are each tested at their own layer.
 */
export type CodexRecordKind = "page" | "journal" | "map" | "marker" | "quest" | "session";
export const CODEX_RECORD_KINDS: readonly CodexRecordKind[] = ["page", "journal", "map", "marker", "quest", "session"];
/** One search hit as the store returns it: what kind of record matched, and which one. */
export type CodexSearchRef = Readonly<{ kind: CodexRecordKind; id: string }>;
/** `truncated` comes from fetching one row past the cap (a length check cannot tell "exactly 50" from "more"). */
export type CodexSearchResult = Readonly<{ hits: readonly CodexSearchRef[]; truncated: boolean }>;
/** The shared cap for every kind on the search index. See `searchOrderBySql`. */
const SEARCH_LIMIT = 50;

export type CodexMapKind = "battlemap" | "regional" | "world";
export type CodexMapRow = Readonly<{
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
export type CodexMarkerLinks = Readonly<{ pageIds: string[]; subMapId: string | null; sceneIds: string[]; actorId: string | null }>;
export type CodexMarkerRow = Readonly<{
  id: string;
  mapId: string;
  x: number;
  y: number;
  iconId: string;
  iconColor: string;
  label: string | null;
  revealedToPlayers: boolean;
  tags: readonly string[];
  /** At most one party pin atlas-wide (partial unique index). Player-facing, but grants no visibility. */
  isParty: boolean;
} & CodexMarkerLinks & { createdAt: string; updatedAt: string }>;

export type CodexMapCreateInput = Readonly<{ assetId: string; name: string; kind: CodexMapKind; parentMapId?: string | null; revealedToPlayers?: boolean; tags?: readonly string[] }>;
export type CodexMarkerCreateInput = Readonly<{ x: number; y: number; iconId: string; iconColor: string; label?: string | null; revealedToPlayers?: boolean; pageIds?: readonly string[]; subMapId?: string | null; sceneIds?: readonly string[]; actorId?: string | null; tags?: readonly string[] }>;
export type CodexMarkerUpdateInput = Partial<CodexMarkerCreateInput>;

/** The world's calendar: ordered months (each with a length), weekday names, named eras, and a year suffix. */
export type CodexCalendarMonth = Readonly<{ name: string; days: number }>;
/** An era runs from `startYear` until the next. A date's era is derived (`eraForYear`), never stored. */
export type CodexCalendarEra = Readonly<{ name: string; startYear: number }>;
/** The world's calendar; `currentDate` is the campaign's "now" (a Today marker on the timeline), optional. */
export type CodexCalendar = Readonly<{ yearName: string; eras?: readonly CodexCalendarEra[]; months: readonly CodexCalendarMonth[]; weekdays: readonly string[]; currentDate?: CodexInWorldDate | null }>;
/** A structured in-world date (month is a 0-based index into the calendar's months). */
export type CodexInWorldDate = Readonly<{ year: number; month: number; day: number }>;

const DEFAULT_CALENDAR: CodexCalendar = {
  yearName: "",
  months: [
    { name: "Deepwinter", days: 30 }, { name: "The Claw", days: 30 }, { name: "Melting", days: 30 },
    { name: "Greengrass", days: 30 }, { name: "Mirtul", days: 30 }, { name: "Flamerule", days: 30 },
    { name: "Highsun", days: 30 }, { name: "Harvest", days: 30 }, { name: "Fading", days: 30 },
    { name: "Leaffall", days: 30 }, { name: "The Rotting", days: 30 }, { name: "Deadwinter", days: 30 }
  ],
  weekdays: ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh"]
};

/** `journalKind` fails closed, so an unknown kind from a newer build reads back as `note`. */
export type CodexJournalKind = "note" | "combat" | "deadline" | "downtime" | "milestone" | "standing" | "quest";
/** `applied` makes `applyDowntime` idempotent and is GM workflow state, never projected. No `outcome`: prose goes in the text layers. */
export type CodexDowntimePayload = Readonly<{
  who: string;
  activity: string;
  days: number;
  applied: boolean;
  /** Links the tracker to a character page; `who` is the fallback. No FK: `deletePage` nulls it. */
  characterPageId: string | null;
}>;
/** The level reached, not a delta. `reason` has no reveal split, so GM-only detail belongs in `gmText`. */
export type CodexMilestonePayload = Readonly<{ level: number; reason: string }>;
/** `delta` is the change, not the value. No FK on `factionPageId`, so history survives a deleted faction. */
export type CodexStandingPayload = Readonly<{ factionPageId: string; delta: number; reason: string }>;
/**
 * A quest reached `status` (no FK, so history survives the quest). `CodexEntryPayload` is keyed by the owning
 * `kind` and read only for that kind; use the `*PayloadOf` helpers to narrow.
 */
export type CodexQuestEventPayload = Readonly<{ questId: string; status: CodexQuestStatus }>;
export type CodexEntryPayload = CodexDowntimePayload | CodexMilestonePayload | CodexStandingPayload | CodexQuestEventPayload;
export type CodexJournalRow = Readonly<{
  id: string;
  playerText: string;
  gmText: string | null;
  revealedToPlayers: boolean;
  attachMarkerId: string | null;
  attachPageId: string | null;
  kind: CodexJournalKind;
  sourceEncounterId: number | null;
  /** The session this entry belongs to, by id; null when unfiled. Writers set this. */
  sessionId: string | null;
  /** Live from the joined session; else the bare label `deleteSession` leaves for a revealed session only. */
  sessionNumber: number | null;
  realDate: string | null;
  inWorldLabel: string | null;
  calendarInstant: number | null;
  /** The literal date the GM entered (independent of the calendar config), so instants can be recomputed if the calendar changes. */
  inWorldDate: CodexInWorldDate | null;
  sortKey: number;
  tags: readonly string[];
  /** Kind-specific structured data. `null` for kinds without a payload. */
  payload: CodexEntryPayload | null;
  createdAt: string;
  updatedAt: string;
}>;
/** `sessionId` omitted on create: active session; `null`: none; unknown id: not-found. */
export type CodexJournalCreateInput = Readonly<{ playerText?: string; gmText?: string | null; revealedToPlayers?: boolean; attachMarkerId?: string | null; attachPageId?: string | null; sessionId?: string | null; realDate?: string | null; inWorldLabel?: string | null; inWorldDate?: CodexInWorldDate | null; tags?: readonly string[] }>;
/** A PATCH may edit only `who`, `activity` and `characterPageId`; `days` is fixed once the clock has moved. */
export type CodexJournalUpdateInput = CodexJournalCreateInput & Readonly<{ downtime?: Readonly<{ who?: string; activity?: string; characterPageId?: string | null }> }>;
/** What `createDowntime` needs beyond an ordinary entry. `applied` always starts false. */
export type CodexDowntimeCreateInput = CodexJournalCreateInput & Readonly<{ downtime: Readonly<{ who: string; activity: string; days: number; characterPageId?: string | null }> }>;
/** What `createMilestone` needs beyond an ordinary entry. */
export type CodexMilestoneCreateInput = CodexJournalCreateInput & Readonly<{ milestone: Readonly<{ level: number; reason: string }> }>;

/** Current standing per faction; history lives in `standing` chronicle records. `value` is -100..100. */
export type CodexStandingRow = Readonly<{
  id: string;
  factionPageId: string;
  /** -100 (Hostile) .. +100 (Allied), 0 = Neutral. Clamped on the way in by `standingValue`. */
  value: number;
  /** A standing starts hidden. */
  revealedToPlayers: boolean;
  createdAt: string;
  updatedAt: string;
}>;
export type CodexCombatEntryInput = Readonly<{ sourceEncounterId: number; attachMarkerId?: string | null; attachPageId?: string | null; playerText: string; gmText?: string | null; revealedToPlayers?: boolean }>;

/** Raw store rows; flattening and gating happen in `codex-projections.ts`. */
export type CodexChronicleRecord =
  | Readonly<{ kind: "entry"; entry: CodexJournalRow }>
  | Readonly<{ kind: "event"; page: CodexPageRow }>;

/** Two-layer: `prepBody` never reaches a player; `recapBody` ships once revealed. Numbers are unique when present. */
export type CodexSessionStatus = "planned" | "played";
export type CodexSessionRow = Readonly<{
  id: string;
  sessionNumber: number | null;
  /** The real-world date the group met, free text (the calendar is the in-world one). */
  realDate: string | null;
  attendees: readonly string[];
  /** GM-only: never projected to a player. */
  prepBody: string;
  /** The player-facing half, gated by `revealedToPlayers` - the recap the table reads before the next session. */
  recapBody: string;
  revealedToPlayers: boolean;
  status: CodexSessionStatus;
  tags: readonly string[];
  /** Scenes staged for this session: GM prep, GM-only in every projection. A dangling id is expected. */
  sceneIds: readonly string[];
  rev: number;
  createdAt: string;
  updatedAt: string;
}>;

export type CodexSessionCreateInput = Readonly<{
  sessionNumber?: number | null;
  realDate?: string | null;
  attendees?: readonly string[];
  prepBody?: string;
  recapBody?: string;
  revealedToPlayers?: boolean;
  status?: CodexSessionStatus;
  tags?: readonly string[];
  /** Scenes staged for this session; capped at the scene cap. */
  sceneIds?: readonly string[];
}>;
/** No `revealedToPlayers`: reveal has its own endpoint and its own recency rule, exactly as `CodexPageUpdateInput` omits it. */
export type CodexSessionUpdateInput = Readonly<{
  sessionNumber?: number | null;
  realDate?: string | null;
  attendees?: readonly string[];
  prepBody?: string;
  recapBody?: string;
  status?: CodexSessionStatus;
  tags?: readonly string[];
  sceneIds?: readonly string[];
}>;

/**
 * Two-layer: `gmBody` never reaches a player; `playerBody` is gated by reveal. Statuses in lifecycle order:
 * `not-started`/`active` are open; `completed`/`failed`/`canceled` are done. New quests start `not-started`.
 */
export type CodexQuestStatus = "not-started" | "active" | "completed" | "failed" | "canceled";
/** One checklist line: just `{ text, done }`. */
export type CodexQuestObjective = Readonly<{ text: string; done: boolean }>;
export type CodexQuestRow = Readonly<{
  id: string;
  title: string;
  status: CodexQuestStatus;
  /** The player-facing half, gated by `revealedToPlayers` - what the party has actually been told. */
  playerBody: string;
  /** GM-only: never projected to a player. */
  gmBody: string;
  /** Ordered: the GM's sequence is the meaning; nothing sorts, dedupes or re-keys this. */
  objectives: readonly CodexQuestObjective[];
  /** Codex page ids this quest concerns, filtered to revealed pages on the way to a player. */
  entityIds: readonly string[];
  revealedToPlayers: boolean;
  tags: readonly string[];
  rev: number;
  createdAt: string;
  updatedAt: string;
}>;

export type CodexQuestCreateInput = Readonly<{
  title: string;
  status?: CodexQuestStatus;
  playerBody?: string;
  gmBody?: string;
  objectives?: readonly CodexQuestObjective[];
  entityIds?: readonly string[];
  revealedToPlayers?: boolean;
  tags?: readonly string[];
}>;
/** No `revealedToPlayers`: reveal has its own endpoint and its own recency rule, exactly as `CodexSessionUpdateInput` omits it. */
export type CodexQuestUpdateInput = Readonly<{
  title?: string;
  status?: CodexQuestStatus;
  playerBody?: string;
  gmBody?: string;
  objectives?: readonly CodexQuestObjective[];
  entityIds?: readonly string[];
  tags?: readonly string[];
}>;

export type CodexPageCreateInput = Readonly<{
  title: string;
  entityType?: CodexEntityType;
  fields?: Readonly<Record<string, string>>;
  gmFields?: Readonly<Record<string, string>>;
  folder?: string | null;
  tags?: readonly string[];
  playerBody?: string;
  gmBody?: string;
  revealedToPlayers?: boolean;
  bannerAssetId?: string | null;
  /** The raw in-world date. `null` clears it; omitted leaves it alone (as on journal entries). */
  inWorldDate?: CodexInWorldDate | null;
}>;

export type CodexPageUpdateInput = Readonly<{
  title?: string;
  entityType?: CodexEntityType;
  fields?: Readonly<Record<string, string>>;
  gmFields?: Readonly<Record<string, string>>;
  folder?: string | null;
  tags?: readonly string[];
  playerBody?: string;
  gmBody?: string;
  bannerAssetId?: string | null;
  inWorldDate?: CodexInWorldDate | null;
}>;

/**
 * `declaredSessionId`: whether the row had a `sessionId` key. Older exports lack it, so their `sessionNumber` is
 * a lost join to resolve; on newer rows a bare number is a display label to keep. Missing bundle keys default.
 */
export type CodexBundleJournalRow = CodexJournalRow & Readonly<{ declaredSessionId: boolean }>;
export type CodexBundle = Readonly<{
  pages: readonly CodexPageRow[]; maps: readonly CodexMapRow[]; markers: readonly CodexMarkerRow[];
  journal: readonly CodexJournalRow[]; relationships: readonly CodexRelationshipRow[];
  sessions: readonly CodexSessionRow[]; activeSessionId: string | null; quests: readonly CodexQuestRow[];
  publishedDate: CodexInWorldDate | null; standing: readonly CodexStandingRow[]; partyMarkerId: string | null;
  calendar: CodexCalendar; folders: readonly string[]; revisions: readonly CodexPageRevisionExportRow[];
  settings?: CodexSettingsInput;
}>;
/** Separate from `CodexBundle` so the input-only provenance flag can never reach an export. */
export type CodexImportBundle = Omit<CodexBundle, "journal"> & Readonly<{ journal: readonly CodexBundleJournalRow[] }>;
/** What the database actually holds after a restore - its own row counts, never the bundle's claims. */
export type CodexImportCounts = Readonly<{ pages: number; folders: number; maps: number; markers: number; journal: number; connections: number; sessions: number; quests: number; standing: number; revisions: number }>;
/** The bundle format version. A fact about the file, so the export route stamps it beside `codex`, not inside it. */
export const CODEX_BUNDLE_VERSION = 1;

/** Thrown when an update's `expectedRev` does not match the stored row - the client's page is stale. */
export class CodexRevisionConflictError extends Error {}
/** Thrown when a referenced page/map/marker does not exist. */
export class CodexNotFoundError extends Error {}
/** A refusal of caller input. The only store error whose message is forwarded; others become a sanitized 500. */
export class CodexValidationError extends Error {}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARS = /\p{Cc}/u;
const MAX_BODY = 100_000;
const MAX_TAGS = 24;

export const MIGRATIONS = [{
  version: 1,
  sql: `
    CREATE TABLE codex_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      codex_revision INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE codex_pages (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      folder TEXT,
      tags_json TEXT NOT NULL,
      player_body TEXT NOT NULL,
      gm_body TEXT NOT NULL,
      revealed INTEGER NOT NULL,
      banner_asset_id TEXT,
      rev INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE codex_page_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_id TEXT NOT NULL REFERENCES codex_pages(id) ON DELETE CASCADE,
      rev INTEGER NOT NULL,
      title TEXT NOT NULL,
      player_body TEXT NOT NULL,
      gm_body TEXT NOT NULL,
      banner_asset_id TEXT,
      tags_json TEXT NOT NULL,
      authored_at TEXT NOT NULL,
      author_tag TEXT NOT NULL
    ) STRICT;
    CREATE INDEX codex_page_revisions_page ON codex_page_revisions (page_id, rev DESC);
    CREATE TABLE codex_links (
      source_page_id TEXT NOT NULL REFERENCES codex_pages(id) ON DELETE CASCADE,
      layer TEXT NOT NULL CHECK (layer IN ('player', 'gm')),
      target_kind TEXT NOT NULL CHECK (target_kind IN ('page', 'actor', 'monster', 'spell', 'map', 'marker')),
      target_ref TEXT NOT NULL,
      section TEXT
    ) STRICT;
    CREATE INDEX codex_links_target ON codex_links (target_kind, target_ref);
    CREATE INDEX codex_links_source ON codex_links (source_page_id);
    CREATE TABLE codex_maps (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('battlemap', 'regional', 'world')),
      parent_map_id TEXT REFERENCES codex_maps(id) ON DELETE SET NULL,
      revealed INTEGER NOT NULL,
      sort_key INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX codex_maps_parent ON codex_maps (parent_map_id);
    CREATE TABLE codex_markers (
      id TEXT PRIMARY KEY,
      map_id TEXT NOT NULL REFERENCES codex_maps(id) ON DELETE CASCADE,
      x REAL NOT NULL,
      y REAL NOT NULL,
      icon_id TEXT NOT NULL,
      icon_color TEXT NOT NULL,
      label TEXT,
      revealed INTEGER NOT NULL,
      page_id TEXT,
      sub_map_id TEXT,
      scene_id TEXT,
      actor_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX codex_markers_map ON codex_markers (map_id);
    CREATE INDEX codex_markers_page ON codex_markers (page_id);
    CREATE TABLE codex_journal (
      id TEXT PRIMARY KEY,
      player_text TEXT NOT NULL,
      gm_text TEXT,
      revealed INTEGER NOT NULL,
      attach_marker_id TEXT,
      attach_page_id TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('note', 'combat')),
      source_encounter_id INTEGER,
      session_number INTEGER,
      real_date TEXT,
      in_world_label TEXT,
      calendar_instant INTEGER,
      sort_key INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX codex_journal_order ON codex_journal (calendar_instant, session_number, created_at);
    CREATE INDEX codex_journal_marker ON codex_journal (attach_marker_id);
    CREATE INDEX codex_journal_page ON codex_journal (attach_page_id);
  `
}, {
  version: 2,
  sql: `
    CREATE VIRTUAL TABLE codex_fts_player USING fts5(page_id UNINDEXED, title, body);
    CREATE VIRTUAL TABLE codex_fts_gm USING fts5(page_id UNINDEXED, title, body);
  `
}, {
  version: 3,
  sql: `
    ALTER TABLE codex_pages ADD COLUMN entity_type TEXT NOT NULL DEFAULT 'note';
    ALTER TABLE codex_pages ADD COLUMN fields_json TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE codex_page_revisions ADD COLUMN entity_type TEXT NOT NULL DEFAULT 'note';
    ALTER TABLE codex_page_revisions ADD COLUMN fields_json TEXT NOT NULL DEFAULT '{}';
    CREATE TABLE codex_relationships (
      id TEXT PRIMARY KEY,
      from_page_id TEXT NOT NULL REFERENCES codex_pages(id) ON DELETE CASCADE,
      to_page_id TEXT NOT NULL REFERENCES codex_pages(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX codex_rel_from ON codex_relationships (from_page_id);
    CREATE INDEX codex_rel_to ON codex_relationships (to_page_id);
  `
}, {
  version: 4,
  sql: `ALTER TABLE codex_meta ADD COLUMN calendar_json TEXT;`
}, {
  version: 5,
  sql: `
    ALTER TABLE codex_pages ADD COLUMN gm_fields_json TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE codex_page_revisions ADD COLUMN gm_fields_json TEXT NOT NULL DEFAULT '{}';
  `
}, {
  version: 6,
  sql: `
    ALTER TABLE codex_journal ADD COLUMN in_world_year INTEGER;
    ALTER TABLE codex_journal ADD COLUMN in_world_month INTEGER;
    ALTER TABLE codex_journal ADD COLUMN in_world_day INTEGER;
  `
}, {
  version: 7,
  // Move `goals` (now a secret field) out of fields_json so it cannot leak on reveal. Keep in sync with
  // SECRET_FIELD_KEYS.
  sql: `
    UPDATE codex_pages
    SET gm_fields_json = json_set(COALESCE(gm_fields_json, '{}'), '$.goals', json_extract(fields_json, '$.goals')),
        fields_json = json_remove(fields_json, '$.goals')
    WHERE fields_json IS NOT NULL AND json_extract(fields_json, '$.goals') IS NOT NULL;
  `
}, {
  version: 8,
  // Markers link to many pages and scenes: JSON id-array columns, backfilled from the old single
  // columns, which are no longer read or written.
  sql: `
    ALTER TABLE codex_markers ADD COLUMN page_ids_json TEXT;
    ALTER TABLE codex_markers ADD COLUMN scene_ids_json TEXT;
    UPDATE codex_markers SET
      page_ids_json = CASE WHEN page_id IS NOT NULL THEN json_array(page_id) ELSE '[]' END,
      scene_ids_json = CASE WHEN scene_id IS NOT NULL THEN json_array(scene_id) ELSE '[]' END;
  `
}, {
  version: 9,
  // Folder records, so an empty folder persists. Pages still carry their own `folder` path.
  sql: `
    CREATE TABLE codex_folders (path TEXT PRIMARY KEY, created_at TEXT NOT NULL);
    INSERT OR IGNORE INTO codex_folders (path, created_at)
      SELECT DISTINCT folder, '' FROM codex_pages WHERE folder IS NOT NULL AND folder != '';
  `
}, {
  version: 10,
  // Tags on maps, markers and journal entries (NOT NULL DEFAULT '[]', so reads never see NULL).
  sql: `
    ALTER TABLE codex_maps ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE codex_markers ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE codex_journal ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
  `
}, {
  version: 11,
  // One search index per audience, replacing the page-only tables. The player table gets only player-layer
  // text; reveal state is checked at read time, so reveals need no reindex.
  sql: `
    CREATE VIRTUAL TABLE codex_search_player USING fts5(kind UNINDEXED, record_id UNINDEXED, title, body);
    CREATE VIRTUAL TABLE codex_search_gm USING fts5(kind UNINDEXED, record_id UNINDEXED, title, body);

    INSERT INTO codex_search_player (kind, record_id, title, body)
      SELECT 'page', f.page_id, f.title, f.body || char(10) || CASE WHEN json_valid(p.tags_json) THEN COALESCE((SELECT group_concat(value, ' ') FROM json_each(p.tags_json)), '') ELSE '' END
      FROM codex_fts_player f JOIN codex_pages p ON p.id = f.page_id;
    INSERT INTO codex_search_gm (kind, record_id, title, body)
      SELECT 'page', f.page_id, f.title, f.body || char(10) || CASE WHEN json_valid(p.tags_json) THEN COALESCE((SELECT group_concat(value, ' ') FROM json_each(p.tags_json)), '') ELSE '' END
      FROM codex_fts_gm f JOIN codex_pages p ON p.id = f.page_id;

    -- Maps and markers carry no GM-only TEXT (a name/label/tag set is single-layer), so both audiences
    -- index the same string; what separates them is the read-time reveal predicate, not the content.
    INSERT INTO codex_search_player (kind, record_id, title, body)
      SELECT 'map', id, name, CASE WHEN json_valid(tags_json) THEN COALESCE((SELECT group_concat(value, ' ') FROM json_each(codex_maps.tags_json)), '') ELSE '' END FROM codex_maps;
    INSERT INTO codex_search_gm (kind, record_id, title, body)
      SELECT 'map', id, name, CASE WHEN json_valid(tags_json) THEN COALESCE((SELECT group_concat(value, ' ') FROM json_each(codex_maps.tags_json)), '') ELSE '' END FROM codex_maps;
    INSERT INTO codex_search_player (kind, record_id, title, body)
      SELECT 'marker', id, COALESCE(label, ''), CASE WHEN json_valid(tags_json) THEN COALESCE((SELECT group_concat(value, ' ') FROM json_each(codex_markers.tags_json)), '') ELSE '' END FROM codex_markers;
    INSERT INTO codex_search_gm (kind, record_id, title, body)
      SELECT 'marker', id, COALESCE(label, ''), CASE WHEN json_valid(tags_json) THEN COALESCE((SELECT group_concat(value, ' ') FROM json_each(codex_markers.tags_json)), '') ELSE '' END FROM codex_markers;

    -- A journal entry DOES have two layers: gm_text is GM-only and must never enter the player table.
    INSERT INTO codex_search_player (kind, record_id, title, body)
      SELECT 'journal', id, '', player_text || char(10) || CASE WHEN json_valid(tags_json) THEN COALESCE((SELECT group_concat(value, ' ') FROM json_each(codex_journal.tags_json)), '') ELSE '' END FROM codex_journal;
    INSERT INTO codex_search_gm (kind, record_id, title, body)
      SELECT 'journal', id, '', player_text || char(10) || COALESCE(gm_text, '') || char(10) || CASE WHEN json_valid(tags_json) THEN COALESCE((SELECT group_concat(value, ' ') FROM json_each(codex_journal.tags_json)), '') ELSE '' END FROM codex_journal;

    DROP TABLE codex_fts_player;
    DROP TABLE codex_fts_gm;
  `
}, {
  version: 12,
  // Dated `event` pages, using the journal's dating columns and contract: the raw date is the source of
  // truth and `calendar_instant`/`in_world_label` derive from it. No backfill: existing pages are undated.
  sql: `
    ALTER TABLE codex_pages ADD COLUMN in_world_year INTEGER;
    ALTER TABLE codex_pages ADD COLUMN in_world_month INTEGER;
    ALTER TABLE codex_pages ADD COLUMN in_world_day INTEGER;
    ALTER TABLE codex_pages ADD COLUMN in_world_label TEXT;
    ALTER TABLE codex_pages ADD COLUMN calendar_instant INTEGER;
    CREATE INDEX codex_pages_instant ON codex_pages (calendar_instant);
  `
}, {
  version: 13,
  // Sessions. `prep_body` is GM-only; `recap_body` is gated by `revealed`. Numbers are unique when present.
  // `active_session_id` lives on the singleton meta row (no FK; `deleteSession` clears it). Runs before
  // `initialize()` seeds `codex_meta` on a fresh database, so it must not assume a row.
  sql: `
    CREATE TABLE codex_sessions (
      id TEXT PRIMARY KEY,
      session_number INTEGER,
      real_date TEXT,
      attendees_json TEXT NOT NULL,
      prep_body TEXT NOT NULL,
      recap_body TEXT NOT NULL,
      revealed INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('planned', 'played')),
      rev INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX codex_sessions_number ON codex_sessions (session_number) WHERE session_number IS NOT NULL;
    ALTER TABLE codex_meta ADD COLUMN active_session_id TEXT;
  `
}, {
  version: 14,
  // Quests, with an indexed `status` for the dashboard's open-quest count. `gm_body` is GM-only.
  sql: `
    CREATE TABLE codex_quests (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'failed')),
      player_body TEXT NOT NULL,
      gm_body TEXT NOT NULL,
      objectives_json TEXT NOT NULL,
      entity_ids_json TEXT NOT NULL,
      revealed INTEGER NOT NULL,
      rev INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX codex_quests_status ON codex_quests (status);
  `
}, {
  version: 15,
  // Deadline and downtime kinds. SQLite cannot widen a CHECK, so the table is rebuilt: same column order with
  // `payload_json` appended, named columns on both sides, all indexes recreated (nothing references it by FK).
  // The CHECK also admits `milestone` and `standing` to avoid a second rebuild.
  // The published date gets its own columns (`setCalendar` replaces `calendar_json` wholesale), backfilled from
  // `currentDate`. The nested CASEs are required: `json_extract` throws on malformed JSON and SQLite's AND does
  // not reliably short-circuit; anything unusable backfills NULL.
  sql: `
    CREATE TABLE codex_journal_new (
      id TEXT PRIMARY KEY,
      player_text TEXT NOT NULL,
      gm_text TEXT,
      revealed INTEGER NOT NULL,
      attach_marker_id TEXT,
      attach_page_id TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('note', 'combat', 'deadline', 'downtime', 'milestone', 'standing')),
      source_encounter_id INTEGER,
      session_number INTEGER,
      real_date TEXT,
      in_world_label TEXT,
      calendar_instant INTEGER,
      sort_key INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      in_world_year INTEGER,
      in_world_month INTEGER,
      in_world_day INTEGER,
      tags_json TEXT NOT NULL DEFAULT '[]',
      payload_json TEXT
    ) STRICT;
    INSERT INTO codex_journal_new
      (id, player_text, gm_text, revealed, attach_marker_id, attach_page_id, kind, source_encounter_id, session_number, real_date, in_world_label, calendar_instant, sort_key, created_at, updated_at, in_world_year, in_world_month, in_world_day, tags_json)
      SELECT
       id, player_text, gm_text, revealed, attach_marker_id, attach_page_id, kind, source_encounter_id, session_number, real_date, in_world_label, calendar_instant, sort_key, created_at, updated_at, in_world_year, in_world_month, in_world_day, tags_json
      FROM codex_journal;
    DROP TABLE codex_journal;
    ALTER TABLE codex_journal_new RENAME TO codex_journal;
    CREATE INDEX codex_journal_order ON codex_journal (calendar_instant, session_number, created_at);
    CREATE INDEX codex_journal_marker ON codex_journal (attach_marker_id);
    CREATE INDEX codex_journal_page ON codex_journal (attach_page_id);

    ALTER TABLE codex_meta ADD COLUMN published_year INTEGER;
    ALTER TABLE codex_meta ADD COLUMN published_month INTEGER;
    ALTER TABLE codex_meta ADD COLUMN published_day INTEGER;
    UPDATE codex_meta SET
      published_year = CASE WHEN json_valid(calendar_json) THEN
        CASE WHEN json_type(calendar_json, '$.currentDate.year') IN ('integer', 'real')
          THEN CAST(json_extract(calendar_json, '$.currentDate.year') AS INTEGER) END END,
      published_month = CASE WHEN json_valid(calendar_json) THEN
        CASE WHEN json_type(calendar_json, '$.currentDate.month') IN ('integer', 'real')
          THEN CAST(json_extract(calendar_json, '$.currentDate.month') AS INTEGER) END END,
      published_day = CASE WHEN json_valid(calendar_json) THEN
        CASE WHEN json_type(calendar_json, '$.currentDate.day') IN ('integer', 'real')
          THEN CAST(json_extract(calendar_json, '$.currentDate.day') AS INTEGER) END END;
  `
}, {
  version: 16,
  // Standing: one row per faction; ON DELETE CASCADE drops it with its faction page while chronicle records
  // survive. No CHECK on `value` (clamped in code). The partial unique index allows one `is_party = 1` pin, so
  // `setPartyMarker` must clear before it sets.
  sql: `
    CREATE TABLE codex_standing (
      id TEXT PRIMARY KEY,
      faction_page_id TEXT NOT NULL REFERENCES codex_pages(id) ON DELETE CASCADE,
      value INTEGER NOT NULL,
      revealed INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX codex_standing_faction ON codex_standing (faction_page_id);
    ALTER TABLE codex_markers ADD COLUMN is_party INTEGER NOT NULL DEFAULT 0;
    CREATE UNIQUE INDEX codex_markers_party ON codex_markers (is_party) WHERE is_party = 1;
  `
}, {
  version: 17,
  // Revision-history settings (defaults backfill the row). No CHECKs: clamped on write, re-validated on read.
  sql: `
    ALTER TABLE codex_meta ADD COLUMN revision_history_enabled INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE codex_meta ADD COLUMN revision_window_minutes INTEGER NOT NULL DEFAULT 90;
  `
}, {
  version: 18,
  // Autosave settings, in seconds; same arrangement as v17.
  sql: `
    ALTER TABLE codex_meta ADD COLUMN autosave_enabled INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE codex_meta ADD COLUMN autosave_interval_seconds INTEGER NOT NULL DEFAULT 1;
  `
}, {
  version: 19,
  // Journal entries join sessions by id (renumbering updates them) and admit `quest` (another rebuild, as v15).
  // No FK: `deleteSession` scrubs it and stamps back a revealed session's number. Backfill creates a hidden empty
  // session for each orphan number, then resolves numbers to ids; `session_number` stays as the label fallback.
  sql: `
    CREATE TABLE codex_journal_new (
      id TEXT PRIMARY KEY,
      player_text TEXT NOT NULL,
      gm_text TEXT,
      revealed INTEGER NOT NULL,
      attach_marker_id TEXT,
      attach_page_id TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('note', 'combat', 'deadline', 'downtime', 'milestone', 'standing', 'quest')),
      source_encounter_id INTEGER,
      session_number INTEGER,
      real_date TEXT,
      in_world_label TEXT,
      calendar_instant INTEGER,
      sort_key INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      in_world_year INTEGER,
      in_world_month INTEGER,
      in_world_day INTEGER,
      tags_json TEXT NOT NULL DEFAULT '[]',
      payload_json TEXT,
      session_id TEXT
    ) STRICT;
    INSERT INTO codex_journal_new
      (id, player_text, gm_text, revealed, attach_marker_id, attach_page_id, kind, source_encounter_id, session_number, real_date, in_world_label, calendar_instant, sort_key, created_at, updated_at, in_world_year, in_world_month, in_world_day, tags_json, payload_json)
      SELECT
       id, player_text, gm_text, revealed, attach_marker_id, attach_page_id, kind, source_encounter_id, session_number, real_date, in_world_label, calendar_instant, sort_key, created_at, updated_at, in_world_year, in_world_month, in_world_day, tags_json, payload_json
      FROM codex_journal;
    DROP TABLE codex_journal;
    ALTER TABLE codex_journal_new RENAME TO codex_journal;
    CREATE INDEX codex_journal_order ON codex_journal (calendar_instant, session_number, created_at);
    CREATE INDEX codex_journal_marker ON codex_journal (attach_marker_id);
    CREATE INDEX codex_journal_page ON codex_journal (attach_page_id);
    CREATE INDEX codex_journal_session ON codex_journal (session_id);

    INSERT INTO codex_sessions (id, session_number, real_date, attendees_json, prep_body, recap_body, revealed, status, rev, created_at, updated_at)
      SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
                   substr(hex(randomblob(2)), 2) || '-' ||
                   substr('89ab', (abs(random()) % 4) + 1, 1) || substr(hex(randomblob(2)), 2) ||
                   '-' || hex(randomblob(6))),
             j.session_number, NULL, '[]', '', '', 0, 'played', 1,
             strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM (SELECT DISTINCT session_number FROM codex_journal
            WHERE session_number IS NOT NULL
              AND session_number NOT IN (SELECT session_number FROM codex_sessions WHERE session_number IS NOT NULL)) j;

    UPDATE codex_journal SET
      session_id = (SELECT s.id FROM codex_sessions s WHERE s.session_number = codex_journal.session_number),
      session_number = NULL
    WHERE session_number IS NOT NULL;
  `
}, {
  version: 20,
  // Tags on sessions and quests (as v10). Tags are single-layer, so both search tables index them.
  sql: `
    ALTER TABLE codex_sessions ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE codex_quests ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
  `
}, {
  version: 21,
  // Sessions join the search index. Only the GM row gets `prep_body` and attendees.
  sql: `
    INSERT INTO codex_search_player (kind, record_id, title, body)
      SELECT 'session', id,
             CASE WHEN session_number IS NULL THEN '' ELSE 'Session ' || session_number END,
             recap_body || char(10) || COALESCE(real_date, '') || char(10) ||
             CASE WHEN json_valid(tags_json)
               THEN COALESCE((SELECT group_concat(value, ' ') FROM json_each(codex_sessions.tags_json)), '')
               ELSE '' END
      FROM codex_sessions;
    INSERT INTO codex_search_gm (kind, record_id, title, body)
      SELECT 'session', id,
             CASE WHEN session_number IS NULL THEN '' ELSE 'Session ' || session_number END,
             prep_body || char(10) || recap_body || char(10) || COALESCE(real_date, '') || char(10) ||
             CASE WHEN json_valid(attendees_json)
               THEN COALESCE((SELECT group_concat(value, ' ') FROM json_each(codex_sessions.attendees_json)), '')
               ELSE '' END || char(10) ||
             CASE WHEN json_valid(tags_json)
               THEN COALESCE((SELECT group_concat(value, ' ') FROM json_each(codex_sessions.tags_json)), '')
               ELSE '' END
      FROM codex_sessions;
  `
}, {
  version: 22,
  // Connections over both tables (declared `codex_relationships`, mention `codex_links`): rebuild `codex_links`
  // with a (kind, id) source and no FK (deletes scrub their own rows), add a declared-edge `layer` (default
  // player), turn relationship slugs into display labels, and add `links_backfilled` for `initialize()`.
  sql: `
    CREATE TABLE codex_links_new (
      source_kind TEXT NOT NULL CHECK (source_kind IN ('page', 'session', 'quest', 'journal')),
      source_id   TEXT NOT NULL,
      layer       TEXT NOT NULL CHECK (layer IN ('player', 'gm')),
      target_kind TEXT NOT NULL CHECK (target_kind IN ('page', 'actor', 'monster', 'spell', 'map', 'marker')),
      target_ref  TEXT NOT NULL,
      section     TEXT
    ) STRICT;
    INSERT INTO codex_links_new (source_kind, source_id, layer, target_kind, target_ref, section)
      SELECT 'page', source_page_id, layer, target_kind, target_ref, section FROM codex_links;
    DROP TABLE codex_links;
    ALTER TABLE codex_links_new RENAME TO codex_links;
    CREATE INDEX codex_links_target ON codex_links (target_kind, target_ref);
    CREATE INDEX codex_links_source ON codex_links (source_kind, source_id);

    ALTER TABLE codex_relationships ADD COLUMN layer TEXT NOT NULL DEFAULT 'player' CHECK (layer IN ('player', 'gm'));

    UPDATE codex_relationships SET type = CASE type
      WHEN 'ally' THEN 'ally of'
      WHEN 'enemy' THEN 'enemy of'
      WHEN 'rival' THEN 'rival of'
      WHEN 'rules' THEN 'rules'
      WHEN 'member' THEN 'member of'
      WHEN 'leader' THEN 'leads'
      WHEN 'located-in' THEN 'located in'
      WHEN 'owns' THEN 'owns'
      WHEN 'parent' THEN 'parent of'
      WHEN 'serves' THEN 'serves'
      WHEN 'created' THEN 'created'
      WHEN 'related' THEN 'related to'
      ELSE replace(type, '-', ' ')
    END;

    ALTER TABLE codex_meta ADD COLUMN links_backfilled INTEGER NOT NULL DEFAULT 0;
  `
}, {
  version: 23,
  // `commandId` idempotency receipts. `status` and the serialized body are stored so a replay is
  // byte-identical. Pruned lazily on write.
  sql: `
    CREATE TABLE codex_command_receipts (
      command_id TEXT PRIMARY KEY,
      status     INTEGER NOT NULL,
      body_json  TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
  `
}, {
  version: 24,
  // What a receipt was for, so a reused id on a different request is refused rather than replayed.
  // Nullable: older receipts are still replayed and age out of the prune window.
  sql: `ALTER TABLE codex_command_receipts ADD COLUMN fingerprint TEXT;`
}, {
  version: 25,
  // Scenes staged for a session: a JSON id array defaulting to '[]'. No FK (scenes live in GameState);
  // dangling ids are expected. GM-only in every projection, since planned fights are spoilers.
  sql: `ALTER TABLE codex_sessions ADD COLUMN scene_ids_json TEXT NOT NULL DEFAULT '[]';`
}, {
  version: 26,
  // Quest statuses `not-started` and `canceled` (CHECK rebuild). Columns are named on both sides so
  // `player_body` and `gm_body` cannot be swapped.
  sql: `
    CREATE TABLE codex_quests_new (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('not-started', 'active', 'completed', 'failed', 'canceled')),
      player_body TEXT NOT NULL,
      gm_body TEXT NOT NULL,
      objectives_json TEXT NOT NULL,
      entity_ids_json TEXT NOT NULL,
      revealed INTEGER NOT NULL,
      rev INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]'
    ) STRICT;
    INSERT INTO codex_quests_new
      (id, title, status, player_body, gm_body, objectives_json, entity_ids_json, revealed, rev, created_at, updated_at, tags_json)
      SELECT
       id, title, status, player_body, gm_body, objectives_json, entity_ids_json, revealed, rev, created_at, updated_at, tags_json
      FROM codex_quests;
    DROP TABLE codex_quests;
    ALTER TABLE codex_quests_new RENAME TO codex_quests;
    CREATE INDEX codex_quests_status ON codex_quests (status);
  `
}];

/**
 * Player search visibility, one arm per kind matching that kind's player list endpoint (weaker would make search
 * the leak). Markers also need their map revealed. `ELSE 0` fails closed.
 */
const PLAYER_VISIBLE_SQL = `(CASE codex_search_player.kind
  WHEN 'page' THEN EXISTS (SELECT 1 FROM codex_pages WHERE codex_pages.id = codex_search_player.record_id AND codex_pages.revealed = 1)
  WHEN 'journal' THEN EXISTS (SELECT 1 FROM codex_journal WHERE codex_journal.id = codex_search_player.record_id AND codex_journal.revealed = 1)
  WHEN 'map' THEN EXISTS (SELECT 1 FROM codex_maps WHERE codex_maps.id = codex_search_player.record_id AND codex_maps.revealed = 1)
  WHEN 'marker' THEN EXISTS (SELECT 1 FROM codex_markers JOIN codex_maps ON codex_maps.id = codex_markers.map_id
    WHERE codex_markers.id = codex_search_player.record_id AND codex_markers.revealed = 1 AND codex_maps.revealed = 1)
  WHEN 'quest' THEN EXISTS (SELECT 1 FROM codex_quests WHERE codex_quests.id = codex_search_player.record_id AND codex_quests.revealed = 1)
  WHEN 'session' THEN EXISTS (SELECT 1 FROM codex_sessions WHERE codex_sessions.id = codex_search_player.record_id AND codex_sessions.revealed = 1)
  ELSE 0 END)`;

/**
 * Shared ORDER BY: exact title match first, then bm25 with title weighted 10x. `bm25()` takes a weight for every
 * declared column, including the UNINDEXED ones, so the leading 0.0s are required.
 */
function searchOrderBySql(table: "codex_search_player" | "codex_search_gm"): string {
  return `(CASE WHEN LOWER(${table}.title) = ? THEN 0 ELSE 1 END), bm25(${table}, 0.0, 0.0, 10.0, 1.0)`;
}

type PageRow = {
  id: string; title: string; entity_type: string; fields_json: string; gm_fields_json: string; folder: string | null; tags_json: string; player_body: string;
  gm_body: string; revealed: number; banner_asset_id: string | null;
  in_world_label: string | null; calendar_instant: number | null; in_world_year: number | null; in_world_month: number | null; in_world_day: number | null;
  rev: number; created_at: string; updated_at: string;
};
/** One column list per page read, so a new column cannot be forgotten in one SELECT. */
const PAGE_DATE_COLUMNS = "in_world_label, calendar_instant, in_world_year, in_world_month, in_world_day";
const PAGE_COLUMNS = `id, title, entity_type, fields_json, gm_fields_json, folder, tags_json, player_body, gm_body, revealed, banner_asset_id, ${PAGE_DATE_COLUMNS}, rev, created_at, updated_at`;
const PAGE_SUMMARY_COLUMNS = `id, title, entity_type, fields_json, folder, tags_json, revealed, banner_asset_id, ${PAGE_DATE_COLUMNS}, rev, created_at, updated_at`;
/** The raw stored date, reassembled: all three parts or none, as `toEntry` does for journal rows. */
function pageDateOf(row: Pick<PageRow, "in_world_year" | "in_world_month" | "in_world_day">): CodexInWorldDate | null {
  return row.in_world_year !== null && row.in_world_month !== null && row.in_world_day !== null
    ? { year: row.in_world_year, month: row.in_world_month, day: row.in_world_day }
    : null;
}
type RelationshipRowRaw = { id: string; from_page_id: string; to_page_id: string; type: string; layer: string; created_at: string };
/** `type` holds the display label; `layer` is per declared connection. */
const REL_COLUMNS = "id, from_page_id, to_page_id, type, layer, created_at";
/** Shared by `listRevisions` and `listAllRevisions` so a new column cannot be forgotten in one. */
const REVISION_COLUMNS = "id, page_id, rev, title, player_body, gm_body, banner_asset_id, tags_json, authored_at, author_tag";
type RevisionRowRaw = { id: number; page_id: string; rev: number; title: string; player_body: string; gm_body: string; banner_asset_id: string | null; tags_json: string; authored_at: string; author_tag: string };
/** The one mapping of a `codex_page_revisions` row, so the per-page read and the backup read cannot disagree. */
function toRevision(row: RevisionRowRaw): CodexPageRevisionRow {
  return { id: row.id, pageId: row.page_id, rev: row.rev, title: row.title, playerBody: row.player_body, gmBody: row.gm_body, bannerAssetId: row.banner_asset_id, tags: JSON.parse(row.tags_json) as string[], authoredAt: row.authored_at, authorTag: row.author_tag };
}
type MapRowRaw = { id: string; asset_id: string; name: string; kind: string; parent_map_id: string | null; revealed: number; sort_key: number; tags_json: string; created_at: string; updated_at: string };
const MAP_COLUMNS = "id, asset_id, name, kind, parent_map_id, revealed, sort_key, tags_json, created_at, updated_at";
type MarkerRowRaw = { id: string; map_id: string; x: number; y: number; icon_id: string; icon_color: string; label: string | null; revealed: number; page_ids_json: string | null; sub_map_id: string | null; scene_ids_json: string | null; actor_id: string | null; tags_json: string; is_party: number; created_at: string; updated_at: string };
const MARKER_COLUMNS = "id, map_id, x, y, icon_id, icon_color, label, revealed, page_ids_json, sub_map_id, scene_ids_json, actor_id, tags_json, is_party, created_at, updated_at";
type StandingRowRaw = { id: string; faction_page_id: string; value: number; revealed: number; created_at: string; updated_at: string };
const STANDING_COLUMNS = "id, faction_page_id, value, revealed, created_at, updated_at";
type SessionRowRaw = { id: string; session_number: number | null; real_date: string | null; attendees_json: string; prep_body: string; recap_body: string; revealed: number; status: string; rev: number; created_at: string; updated_at: string; tags_json: string; scene_ids_json: string };
/** One column list per session read, the same discipline PAGE_COLUMNS / JOURNAL_COLUMNS follow. */
const SESSION_COLUMNS = "id, session_number, real_date, attendees_json, prep_body, recap_body, revealed, status, rev, created_at, updated_at, tags_json, scene_ids_json";
type QuestRowRaw = { id: string; title: string; status: string; player_body: string; gm_body: string; objectives_json: string; entity_ids_json: string; revealed: number; rev: number; created_at: string; updated_at: string; tags_json: string };
/** One column list per quest read; the INSERT's value order is bound to it. */
const QUEST_COLUMNS = "id, title, status, player_body, gm_body, objectives_json, entity_ids_json, revealed, rev, created_at, updated_at, tags_json";
type JournalRowRaw = { id: string; player_text: string; gm_text: string | null; revealed: number; attach_marker_id: string | null; attach_page_id: string | null; kind: string; source_encounter_id: number | null; session_number: number | null; session_id: string | null; live_session_number: number | null; real_date: string | null; in_world_label: string | null; calendar_instant: number | null; in_world_year: number | null; in_world_month: number | null; in_world_day: number | null; sort_key: number; tags_json: string; payload_json: string | null; created_at: string; updated_at: string };
/** Always use with `JOURNAL_FROM`: without the join, `live_session_number` is undefined and every row shows the bare label. */
const JOURNAL_COLUMNS = "j.id, j.player_text, j.gm_text, j.revealed, j.attach_marker_id, j.attach_page_id, j.kind, j.source_encounter_id, j.session_number, j.session_id, s.session_number AS live_session_number, j.real_date, j.in_world_label, j.calendar_instant, j.in_world_year, j.in_world_month, j.in_world_day, j.sort_key, j.tags_json, j.payload_json, j.created_at, j.updated_at";
const JOURNAL_FROM = "codex_journal j LEFT JOIN codex_sessions s ON s.id = j.session_id";

/** Read a stored tag array defensively — a malformed value degrades to no tags rather than throwing. */
function parseTags(raw: string | null | undefined): readonly string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch { return []; }
}
function id(value: string): string {
  if (!ID.test(value)) throw new CodexValidationError("Codex id is malformed.");
  return value;
}
/** A record's display title (pages and quests). */
function title(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 160 || CONTROL_CHARS.test(trimmed)) throw new CodexValidationError("A title must be 1 to 160 printable characters.");
  return trimmed;
}
/** A nested notebook folder path ("NPCs/Villains"): "/"-separated segments, normalized and bounded. */
function folder(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const segments = value.split("/").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) return null;
  if (segments.length > 6) throw new CodexValidationError("A folder path can be at most 6 levels deep.");
  for (const segment of segments) if (segment.length > 40 || CONTROL_CHARS.test(segment)) throw new CodexValidationError("Each folder name is up to 40 printable characters.");
  const path = segments.join("/");
  if (path.length > 160) throw new CodexValidationError("That folder path is too long.");
  return path;
}
function tags(value: readonly string[] | undefined): string[] {
  if (!value) return [];
  const cleaned = [...new Set(value.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
  if (cleaned.length > MAX_TAGS) throw new CodexValidationError(`A record may carry at most ${MAX_TAGS} tags.`);
  for (const tag of cleaned) if (tag.length > 40 || !/^[a-z0-9][a-z0-9-]*$/.test(tag)) throw new CodexValidationError("Tags use lowercase letters, numbers, and hyphens.");
  return cleaned;
}
function body(value: string | undefined): string {
  const text = value ?? "";
  if (text.length > MAX_BODY) throw new CodexValidationError("A page body is limited to 100000 characters.");
  return text;
}
function entityType(value: string | undefined): CodexEntityType {
  if (value === undefined) return "note";
  if (!ENTITY_TYPES.includes(value as CodexEntityType)) throw new CodexValidationError("Unknown entity type.");
  return value as CodexEntityType;
}
/** Structured entity attributes: a flat {slug: string} map, empties dropped, bounded in size. */
function entityFields(value: Readonly<Record<string, string>> | undefined): Record<string, string> {
  if (value === undefined) return {};
  const entries = Object.entries(value);
  if (entries.length > 40) throw new CodexValidationError("An entity may carry at most 40 fields.");
  const out: Record<string, string> = {};
  for (const [key, raw] of entries) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(key) || key.length > 40) throw new CodexValidationError("A field key must be a lowercase slug.");
    if (typeof raw !== "string" || raw.length > 2000 || CONTROL_CHARS.test(raw.replace(/[\n\r\t]/g, ""))) throw new CodexValidationError("A field value is up to 2000 printable characters.");
    if (raw.trim() !== "") out[key] = raw;
  }
  if (JSON.stringify(out).length > 10_000) throw new CodexValidationError("Entity fields are too large.");
  return out;
}
/** GM-only field keys, enforced server-side so a secret attribute can never sit in player-facing `fields`. */
const SECRET_FIELD_KEYS: ReadonlySet<string> = CODEX_SECRET_FIELD_KEYS;
/** Move any secret-keyed values out of player-facing `fields` and into GM-only `gmFields` (viewer-safety net). */
function sealSecretFields(fields: Record<string, string>, gmFields: Record<string, string>): { fields: Record<string, string>; gmFields: Record<string, string> } {
  const outFields = { ...fields };
  const outGm = { ...gmFields };
  for (const key of SECRET_FIELD_KEYS) {
    if (key in outFields) { outGm[key] = outFields[key]; delete outFields[key]; }
  }
  return { fields: outFields, gmFields: outGm };
}
/** Labels that read the same from either end; declaring one both ways is one connection. Others are directional. */
const SYMMETRIC_RELATIONSHIPS = new Set(["ally of", "enemy of", "rival of", "related to"]);
const MAX_CONNECTION_LABEL = 40;
/** Unlabelled stores `''` (read as null): the dedupe key includes the label, and NULLs never compare equal. */
function connectionLabel(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length > MAX_CONNECTION_LABEL || CONTROL_CHARS.test(trimmed)) throw new CodexValidationError(`A connection label is up to ${MAX_CONNECTION_LABEL} printable characters.`);
  return trimmed;
}
/** Which layer a declared connection sits on. Defaults to `player`. */
function connectionLayer(value: string | null | undefined): "player" | "gm" {
  if (value === null || value === undefined) return "player";
  if (value !== "player" && value !== "gm") throw new CodexValidationError("A connection sits on the player layer or the GM layer.");
  return value;
}
function parseFields(json: string | null | undefined): Record<string, string> {
  if (!json) return {};
  try { const parsed = JSON.parse(json) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {}; }
  catch { return {}; }
}
function normalizeCalendar(input: CodexCalendar): CodexCalendar {
  const months = (input.months ?? []).map((month) => ({ name: shortLabel(month.name, 40, "month name") ?? "Month", days: Number.isFinite(month.days) ? Math.max(1, Math.min(Math.trunc(month.days), 400)) : 30 }));
  if (months.length < 1 || months.length > 24) throw new CodexValidationError("A calendar needs 1 to 24 months.");
  const weekdays = (input.weekdays ?? []).slice(0, 20).map((day) => shortLabel(day, 40, "weekday") ?? "Day");
  const current = input.currentDate;
  const currentDate = current && Number.isFinite(current.year) && Number.isFinite(current.month) && Number.isFinite(current.day)
    ? { year: Math.trunc(current.year), month: Math.max(0, Math.min(Math.trunc(current.month), months.length - 1)), day: Math.max(1, Math.trunc(current.day)) }
    : null;
  // Sorted because `eraForYear` takes the last era reached; capped since this is client input.
  const eras = (input.eras ?? []).slice(0, 20)
    .map((era) => ({ name: shortLabel(era.name, 40, "era name") ?? "Era", startYear: Number.isFinite(era.startYear) ? Math.trunc(era.startYear) : 0 }))
    .sort((a, b) => a.startYear - b.startYear);
  return { yearName: shortLabel(input.yearName, 20, "era") ?? "", eras, months, weekdays, currentDate };
}
/** The last era whose start the year has reached; none before the first era. */
function eraForYear(calendar: CodexCalendar, year: number): CodexCalendarEra | null {
  let found: CodexCalendarEra | null = null;
  for (const era of calendar.eras ?? []) { if (Math.trunc(year) >= era.startYear) found = era; else break; }
  return found;
}
/** The era leads ("Third Age 1492") and `yearName` trails ("1492 DR"). */
function formatWorldYear(calendar: CodexCalendar, year: number): string {
  const era = eraForYear(calendar, year);
  const truncated = Math.trunc(year);
  return `${era ? `${era.name} ` : ""}${truncated}${calendar.yearName ? ` ${calendar.yearName}` : ""}`;
}
function calendarDaysPerYear(calendar: CodexCalendar): number { return calendar.months.reduce((sum, month) => sum + month.days, 0); }
/** An absolute, monotonically-increasing day number for chronological sorting (negative years allowed). */
function calendarInstantOf(calendar: CodexCalendar, date: CodexInWorldDate): number {
  const monthIdx = Math.max(0, Math.min(Math.trunc(date.month), calendar.months.length - 1));
  let dayOfYear = 0;
  for (let i = 0; i < monthIdx; i += 1) dayOfYear += calendar.months[i].days;
  const day = Math.max(1, Math.min(Math.trunc(date.day), calendar.months[monthIdx].days));
  return Math.trunc(date.year) * calendarDaysPerYear(calendar) + dayOfYear + (day - 1);
}
/** `listTimeline()`'s ORDER BY restated in TypeScript so pages and entries merge in the same order; `id` breaks ties. */
type ChronicleSortKey = Readonly<{ calendarInstant: number | null; sessionNumber: number | null; createdAt: string; id: string }>;
function chronicleSortKey(record: CodexChronicleRecord): ChronicleSortKey {
  return record.kind === "entry"
    ? { calendarInstant: record.entry.calendarInstant, sessionNumber: record.entry.sessionNumber, createdAt: record.entry.createdAt, id: record.entry.id }
    : { calendarInstant: record.page.calendarInstant, sessionNumber: null, createdAt: record.page.createdAt, id: record.page.id };
}
function compareChronicle(a: ChronicleSortKey, b: ChronicleSortKey): number {
  const undated = Number(a.calendarInstant === null) - Number(b.calendarInstant === null);
  if (undated !== 0) return undated;
  if (a.calendarInstant !== null && b.calendarInstant !== null && a.calendarInstant !== b.calendarInstant) return a.calendarInstant - b.calendarInstant;
  const unsessioned = Number(a.sessionNumber === null) - Number(b.sessionNumber === null);
  if (unsessioned !== 0) return unsessioned;
  if (a.sessionNumber !== null && b.sessionNumber !== null && a.sessionNumber !== b.sessionNumber) return a.sessionNumber - b.sessionNumber;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function formatInWorldDate(calendar: CodexCalendar, date: CodexInWorldDate): string {
  const monthIdx = Math.max(0, Math.min(Math.trunc(date.month), calendar.months.length - 1));
  const month = calendar.months[monthIdx];
  const day = Math.max(1, Math.min(Math.trunc(date.day), month.days));
  const base = `${month.name} ${day}, ${formatWorldYear(calendar, date.year)}`;
  if (calendar.weekdays.length > 0) {
    const instant = calendarInstantOf(calendar, date);
    const index = ((instant % calendar.weekdays.length) + calendar.weekdays.length) % calendar.weekdays.length; // non-negative for negative years
    return `${calendar.weekdays[index]}, ${base}`;
  }
  return base;
}
const MAP_KINDS = new Set<CodexMapKind>(["battlemap", "regional", "world"]);
function mapName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120 || CONTROL_CHARS.test(trimmed)) throw new CodexValidationError("A map name must be 1 to 120 printable characters.");
  return trimmed;
}
function mapKind(value: string): CodexMapKind {
  if (!MAP_KINDS.has(value as CodexMapKind)) throw new CodexValidationError("Map kind must be battlemap, regional, or world.");
  return value as CodexMapKind;
}
function iconId(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value) || value.length > 60) throw new CodexValidationError("An icon id must be a lowercase slug.");
  return value;
}
function hexColor(value: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new CodexValidationError("A color must be a #rrggbb hex value.");
  return value;
}
function coord(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) throw new CodexValidationError("A marker position must sit within the map.");
  return value;
}
function markerLabel(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > 120 || CONTROL_CHARS.test(trimmed)) throw new CodexValidationError("A marker label is up to 120 printable characters.");
  return trimmed;
}
function optionalId(value: string | null | undefined): string | null {
  return value === null || value === undefined ? null : id(value);
}
/** Validate + dedupe an array of ids (for a marker's multiple page/scene links). Caps at 24. */
function idArray(value: readonly string[] | null | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  for (const raw of value) { const v = id(raw); if (!out.includes(v)) out.push(v); if (out.length >= 24) break; }
  return out;
}
/** A session's staged scenes, capped at the table's scene cap (20). */
function sessionSceneIds(value: readonly string[] | null | undefined): string[] {
  return idArray(value).slice(0, 20);
}
/** Parse a JSON id-array column (null/garbage → []). */
function parseIdArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try { const arr: unknown = JSON.parse(json); return Array.isArray(arr) ? arr.filter((v): v is string => typeof v === "string") : []; } catch { return []; }
}
const MAX_ENTRY = 20_000;
function entryText(value: string | undefined): string {
  const text = value ?? "";
  if (text.length > MAX_ENTRY) throw new CodexValidationError("A journal entry is limited to 20000 characters.");
  return text;
}
function entryGmText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value.length > MAX_ENTRY) throw new CodexValidationError("A journal entry is limited to 20000 characters.");
  return value === "" ? null : value;
}
function shortLabel(value: string | null | undefined, max: number, what: string): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > max || CONTROL_CHARS.test(trimmed)) throw new CodexValidationError(`A ${what} is up to ${max} printable characters.`);
  return trimmed;
}
function sessionNo(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 0 || value > 100_000) throw new CodexValidationError("A session number must be a non-negative integer.");
  return value;
}
const MAX_ATTENDEES = 24;
/** Free-text names, deduped and bounded; unlike tags they keep case and spaces. */
function attendees(value: readonly string[] | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  for (const raw of value) {
    const name = shortLabel(raw, 40, "attendee name");
    if (name && !out.includes(name)) out.push(name);
  }
  if (out.length > MAX_ATTENDEES) throw new CodexValidationError(`A session may list at most ${MAX_ATTENDEES} attendees.`);
  return out;
}
const SESSION_STATUSES = new Set<CodexSessionStatus>(["planned", "played"]);
/** TS half of the status gate; the v13 CHECK guards writers outside the store. */
function sessionStatus(value: string | undefined): CodexSessionStatus {
  if (value === undefined) return "planned";
  if (!SESSION_STATUSES.has(value as CodexSessionStatus)) throw new CodexValidationError("A session is either planned or played.");
  return value as CodexSessionStatus;
}
const JOURNAL_KINDS = new Set<CodexJournalKind>(["note", "combat", "deadline", "downtime", "milestone", "standing", "quest"]);
/** Fails closed to `note` rather than throwing, so one bad row cannot make the Codex unopenable. */
function journalKind(value: string): CodexJournalKind {
  return JOURNAL_KINDS.has(value as CodexJournalKind) ? (value as CodexJournalKind) : "note";
}
/** 3650 days = ten default years: long enough for "the wizard spends a decade in the tower", bounded enough to be a typo guard. */
const MAX_DOWNTIME_DAYS = 3650;
/** Blank `who`/`activity` allowed. `applied` always starts false: only `applyDowntime` sets it. */
function downtimePayload(input: Readonly<{ who: string; activity: string; days: number; characterPageId?: string | null }>): CodexDowntimePayload {
  const days = input?.days;
  if (!Number.isInteger(days) || days < 0 || days > MAX_DOWNTIME_DAYS) throw new CodexValidationError(`Downtime days must be a whole number from 0 to ${MAX_DOWNTIME_DAYS}.`);
  return {
    who: shortLabel(input.who, 120, "downtime participant") ?? "",
    activity: shortLabel(input.activity, 120, "downtime activity") ?? "",
    days, applied: false,
    characterPageId: optionalId(input.characterPageId)
  };
}
/** Read a stored payload defensively - malformed JSON degrades to `null`, never a throw (`parseObjectives`' rule). */
function parseDowntimePayload(raw: string | null | undefined): CodexDowntimePayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const value = parsed as { who?: unknown; activity?: unknown; days?: unknown; applied?: unknown; characterPageId?: unknown };
    return {
      who: typeof value.who === "string" ? value.who : "",
      activity: typeof value.activity === "string" ? value.activity : "",
      days: typeof value.days === "number" && Number.isFinite(value.days) ? Math.max(0, Math.trunc(value.days)) : 0,
      // Only exactly `true` counts, so a malformed value can never suppress the clock move.
      applied: value.applied === true,
      // Older payloads lack the key; default to null on read rather than migrating `payload_json`.
      characterPageId: typeof value.characterPageId === "string" && ID.test(value.characterPageId) ? value.characterPageId : null
    };
  } catch { return null; }
}
/** 5e's level ceiling, matching `clampLevel` in `packages/rules-5e`. */
const MAX_LEVEL = 20;
/** An out-of-range level is rejected, not clamped: it is a stated fact. */
function milestonePayload(input: Readonly<{ level: number; reason: string }>): CodexMilestonePayload {
  const level = input?.level;
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) throw new CodexValidationError(`A milestone's level must be a whole number from 1 to ${MAX_LEVEL}.`);
  return { level, reason: shortLabel(input.reason, 120, "milestone reason") ?? "" };
}
/** Read a stored milestone payload defensively - malformed JSON degrades to `null` (`parseDowntimePayload`'s rule). */
function parseMilestonePayload(raw: string | null | undefined): CodexMilestonePayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const value = parsed as { level?: unknown; reason?: unknown };
    return {
      // Clamped on read so a hand-edited row still renders as a plausible level.
      level: typeof value.level === "number" && Number.isFinite(value.level) ? Math.min(MAX_LEVEL, Math.max(1, Math.trunc(value.level))) : 1,
      reason: typeof value.reason === "string" ? value.reason : ""
    };
  } catch { return null; }
}
/** Standing runs -100 (Hostile) to +100 (Allied), 0 being Neutral. */
const MIN_STANDING = -100;
const MAX_STANDING = 100;
/** Clamped, not rejected (the ends of the scale are real answers). Non-finite is an error. */
function standingValue(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new CodexValidationError("A standing value must be a number from -100 to 100.");
  return Math.min(MAX_STANDING, Math.max(MIN_STANDING, Math.trunc(value)));
}

/** `0` means "checkpoint every save", distinct from `enabled: false`. Max is one week. */
const MIN_REVISION_WINDOW_MINUTES = 0;
const MAX_REVISION_WINDOW_MINUTES = 10_080;
const DEFAULT_REVISION_SETTINGS: CodexRevisionSettings = { enabled: true, windowMinutes: 90 };
/** Larger values push the cutoff out of `toISOString()`'s range. */
const MAX_PRUNE_DAYS = 36_500;
/** Clamped and truncated for non-HTTP writers; the router rejects out-of-range values. */
function revisionWindowMinutes(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new CodexValidationError(`A revision window must be a number of minutes from ${MIN_REVISION_WINDOW_MINUTES} to ${MAX_REVISION_WINDOW_MINUTES}.`);
  return Math.min(MAX_REVISION_WINDOW_MINUTES, Math.max(MIN_REVISION_WINDOW_MINUTES, Math.trunc(value)));
}
/** Seconds. 1 is the floor and default; use `enabled: false`, not 0, to turn autosave off. */
const MIN_AUTOSAVE_INTERVAL_SECONDS = 1;
const MAX_AUTOSAVE_INTERVAL_SECONDS = 600;
const DEFAULT_AUTOSAVE_SETTINGS: CodexAutosaveSettings = { enabled: true, intervalSeconds: 1 };
/** Clamped and truncated for non-HTTP writers; the router rejects out-of-range values. */
function autosaveIntervalSeconds(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new CodexValidationError(`An autosave interval must be a number of seconds from ${MIN_AUTOSAVE_INTERVAL_SECONDS} to ${MAX_AUTOSAVE_INTERVAL_SECONDS}.`);
  return Math.min(MAX_AUTOSAVE_INTERVAL_SECONDS, Math.max(MIN_AUTOSAVE_INTERVAL_SECONDS, Math.trunc(value)));
}
/** `delta` is the difference of two clamped values, so it needs no clamp. */
function standingPayload(input: Readonly<{ factionPageId: string; delta: number; reason: string }>): CodexStandingPayload {
  return { factionPageId: input.factionPageId, delta: Math.trunc(input.delta), reason: shortLabel(input.reason, 120, "standing reason") ?? "" };
}
/** The quest-event payload on the way in. `status` is already validated by `questStatus` at the call site. */
function questEventPayload(input: Readonly<{ questId: string; status: CodexQuestStatus }>): CodexQuestEventPayload {
  return { questId: input.questId, status: input.status };
}
/** Read a stored quest-event payload defensively; malformed JSON degrades to `null`. */
function parseQuestEventPayload(raw: string | null | undefined): CodexQuestEventPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const value = parsed as { questId?: unknown; status?: unknown };
    return {
      questId: typeof value.questId === "string" ? value.questId : "",
      // Fails closed via the same `coerceQuestStatus` that `toQuest` uses.
      status: coerceQuestStatus(value.status)
    };
  } catch { return null; }
}
/** Read a stored standing payload defensively - malformed JSON degrades to `null` (`parseDowntimePayload`'s rule). */
function parseStandingPayload(raw: string | null | undefined): CodexStandingPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const value = parsed as { factionPageId?: unknown; delta?: unknown; reason?: unknown };
    return {
      factionPageId: typeof value.factionPageId === "string" ? value.factionPageId : "",
      delta: typeof value.delta === "number" && Number.isFinite(value.delta) ? Math.trunc(value.delta) : 0,
      reason: typeof value.reason === "string" ? value.reason : ""
    };
  } catch { return null; }
}

/** Narrow an entry's payload by kind, never by shape, so compatible fields cannot be misread. */
type PayloadBearing = Pick<CodexJournalRow, "kind" | "payload">;
export function downtimePayloadOf(entry: PayloadBearing): CodexDowntimePayload | null {
  return entry.kind === "downtime" ? (entry.payload as CodexDowntimePayload | null) : null;
}
export function milestonePayloadOf(entry: PayloadBearing): CodexMilestonePayload | null {
  return entry.kind === "milestone" ? (entry.payload as CodexMilestonePayload | null) : null;
}
export function standingPayloadOf(entry: PayloadBearing): CodexStandingPayload | null {
  return entry.kind === "standing" ? (entry.payload as CodexStandingPayload | null) : null;
}
export function questEventPayloadOf(entry: PayloadBearing): CodexQuestEventPayload | null {
  return entry.kind === "quest" ? (entry.payload as CodexQuestEventPayload | null) : null;
}
/** Exhaustive, no `default`: a new journal kind is a compile error here. */
function payloadOf(kind: CodexJournalKind, raw: string | null): CodexEntryPayload | null {
  switch (kind) {
    case "downtime": return parseDowntimePayload(raw);
    case "milestone": return parseMilestonePayload(raw);
    case "standing": return parseStandingPayload(raw);
    case "quest": return parseQuestEventPayload(raw);
    case "note": case "combat": case "deadline": return null;
  }
}
/** `payload` is required so each kind's creator must say what it carries. */
type EntryFields = Readonly<{ playerText: string; gmText: string | null; revealed: number; attachMarkerId: string | null; attachPageId: string | null; kind: CodexJournalKind; sourceEncounterId: number | null; sessionId: string | null; realDate: string | null; inWorldLabel: string | null; calendarInstant: number | null; inWorldDate: CodexInWorldDate | null; tags?: readonly string[]; payload: CodexEntryPayload | null }>;
/**
 * Whether a deadline has fired; the only place this comparison is written. Derived, never stored. `at` is passed
 * in because a player's `fired` must use the published date, or it would leak the GM's prep clock.
 */
export function deadlineFired(entry: Pick<CodexJournalRow, "kind" | "calendarInstant">, at: number | null): boolean {
  return entry.kind === "deadline" && entry.calendarInstant !== null && at !== null && entry.calendarInstant <= at;
}
const QUEST_STATUSES = new Set<CodexQuestStatus>(["not-started", "active", "completed", "failed", "canceled"]);
/** TS half of the quest status gate (v26's CHECK is the other). New quests default to `not-started`. */
function questStatus(value: string | undefined): CodexQuestStatus {
  if (value === undefined) return "not-started";
  if (!QUEST_STATUSES.has(value as CodexQuestStatus)) throw new CodexValidationError("A quest is not started, active, completed, failed, or canceled.");
  return value as CodexQuestStatus;
}
/** Fails closed to `active` so an unclassifiable quest stays prominent. Shared by every status reader. */
function coerceQuestStatus(value: unknown): CodexQuestStatus {
  return typeof value === "string" && QUEST_STATUSES.has(value as CodexQuestStatus) ? (value as CodexQuestStatus) : "active";
}
const MAX_OBJECTIVES = 24;
/** 120 = the repo's one-line-of-display bound (a marker `label`, an `inWorldLabel`), and the number `CodexQuestObjective` publishes. */
const MAX_OBJECTIVE_TEXT = 120;
/** Order is content (never sorted or deduped); blank text is allowed (add-then-type); only `done === true` counts. */
function questObjectives(value: readonly CodexQuestObjective[] | undefined): CodexQuestObjective[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new CodexValidationError("Objectives must be a list.");
  if (value.length > MAX_OBJECTIVES) throw new CodexValidationError(`A quest may carry at most ${MAX_OBJECTIVES} objectives.`);
  return value.map((objective) => {
    const text = typeof objective?.text === "string" ? objective.text.trim() : "";
    if (text.length > MAX_OBJECTIVE_TEXT || CONTROL_CHARS.test(text)) throw new CodexValidationError(`An objective is up to ${MAX_OBJECTIVE_TEXT} printable characters.`);
    return { text, done: objective?.done === true };
  });
}
/** Read stored objectives defensively - a malformed column degrades to an empty list, as `parseTags` does. */
function parseObjectives(raw: string | null | undefined): CodexQuestObjective[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Order-preserving: the read side of "order is content".
    return parsed
      .filter((entry): entry is { text?: unknown; done?: unknown } => !!entry && typeof entry === "object" && !Array.isArray(entry))
      .map((entry) => ({ text: typeof entry.text === "string" ? entry.text : "", done: entry.done === true }));
  } catch { return []; }
}

/** A page title reduced to a stable link target: lowercased, trimmed, whitespace collapsed. */
export function pageLinkKey(rawTitle: string): string {
  return rawTitle.trim().toLowerCase().replace(/\s+/g, " ");
}

const WIKILINK = /\[\[([^\]]+)\]\]/g;
const TARGET_KINDS = new Set<CodexLinkTargetKind>(["page", "actor", "monster", "spell", "map", "marker"]);

/** Parse `[[...]]` references out of one markdown body into link edges (no dedupe here). */
export function parseWikiLinks(text: string, layer: "player" | "gm"): CodexLinkRow[] {
  const links: CodexLinkRow[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(WIKILINK)) {
    const inner = match[1].trim();
    if (!inner) continue;
    const [targetPart, sectionPart] = inner.split("#", 2);
    const section = sectionPart?.trim() || null;
    let targetKind: CodexLinkTargetKind = "page";
    let ref = targetPart.trim();
    const colon = ref.indexOf(":");
    if (colon > 0) {
      const prefix = ref.slice(0, colon).trim().toLowerCase();
      if (TARGET_KINDS.has(prefix as CodexLinkTargetKind)) { targetKind = prefix as CodexLinkTargetKind; ref = ref.slice(colon + 1).trim(); }
    }
    if (!ref) continue;
    const key = targetKind === "page" ? pageLinkKey(ref) : ref;
    const dedupe = `${layer}|${targetKind}|${key}|${section ?? ""}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    links.push({ sourceKind: "page", sourceId: "", layer, targetKind, targetRef: key, section });
  }
  return links;
}

/** Every key any export has written, so an older backup is a subset and an unknown key can be refused. */
const BUNDLE_LIST_KEYS = ["pages", "maps", "markers", "journal", "relationships", "sessions", "quests", "standing", "revisions", "folders"] as const;
const BUNDLE_VALUE_KEYS = ["activeSessionId", "publishedDate", "partyMarkerId", "calendar", "settings"] as const;
const BUNDLE_KEYS: ReadonlySet<string> = new Set<string>([...BUNDLE_LIST_KEYS, ...BUNDLE_VALUE_KEYS]);

/**
 * Validate an untrusted bundle before any transaction, through the same validators as ordinary writes. Since
 * import replaces everything, a bundle with no or unknown keys is refused (it would silently delete data).
 * Cross-record checks mirror DB constraints so errors are readable instead of driver text.
 */
function normalizeBundle(raw: unknown): CodexImportBundle {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CodexValidationError("That backup file is not a codex bundle.");
  const bundle = raw as Record<string, unknown>;
  const unrecognised = Object.keys(bundle).find((key) => !BUNDLE_KEYS.has(key));
  if (unrecognised !== undefined) {
    throw new CodexValidationError(`That backup has a section the codex does not recognise: "${unrecognised}". Compare it with a fresh export - a mistyped section name means those records would be dropped rather than restored.`);
  }
  if (!Object.keys(bundle).some((key) => BUNDLE_KEYS.has(key))) {
    throw new CodexValidationError("That backup holds no codex sections at all, so it is truncated or is not a backup file. A campaign with nothing in it still exports every section (\"pages\": [], and so on) - restoring this would erase the codex rather than replace it.");
  }
  const list = (key: string): unknown[] => {
    const value = bundle[key];
    if (value === undefined || value === null) return [];   // A bundle from before this record type existed.
    if (!Array.isArray(value)) throw new CodexValidationError(`That backup's "${key}" section is not a list of records.`);
    return value;
  };
  /** One collection, row by row, with the collection name and row number added to every validator message. */
  const rows = <T>(key: string, map: (row: Record<string, unknown>) => T): T[] => list(key).map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new CodexValidationError(`That backup's "${key}" entry ${index + 1} is not a record.`);
    try { return map(value as Record<string, unknown>); }
    catch (error) {
      if (error instanceof CodexValidationError) throw new CodexValidationError(`That backup's "${key}" entry ${index + 1} is not valid: ${error.message}`);
      throw error;
    }
  });
  const text = (value: unknown): string => (typeof value === "string" ? value : "");
  const nullableText = (value: unknown): string | null => (typeof value === "string" ? value : null);
  const flag = (value: unknown): boolean => value === true;
  const count = (value: unknown, fallback = 0): number => (typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback);
  // Not truncated: marker coordinates are fractional.
  const real = (value: unknown, fallback = 0): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
  const stamp = (value: unknown): string => (typeof value === "string" ? value : "");
  const date = (value: unknown): CodexInWorldDate | null => {
    if (!value || typeof value !== "object") return null;
    const parts = value as { year?: unknown; month?: unknown; day?: unknown };
    if (typeof parts.year !== "number" || typeof parts.month !== "number" || typeof parts.day !== "number") return null;
    return { year: Math.trunc(parts.year), month: Math.trunc(parts.month), day: Math.trunc(parts.day) };
  };

  const pages = rows("pages", (row) => {
    return {
      id: id(text(row.id)), title: title(text(row.title)), entityType: entityType(typeof row.entityType === "string" ? row.entityType : undefined),
      fields: entityFields(row.fields as Record<string, string> | undefined), gmFields: entityFields(row.gmFields as Record<string, string> | undefined),
      folder: folder(nullableText(row.folder)), tags: tags(Array.isArray(row.tags) ? (row.tags as string[]) : []),
      playerBody: body(text(row.playerBody)), gmBody: body(text(row.gmBody)), revealedToPlayers: flag(row.revealedToPlayers),
      bannerAssetId: optionalId(nullableText(row.bannerAssetId)), inWorldLabel: null, calendarInstant: null, inWorldDate: date(row.inWorldDate),
      rev: Math.max(1, count(row.rev, 1)), createdAt: stamp(row.createdAt), updatedAt: stamp(row.updatedAt)
    } satisfies CodexPageRow;
  });
  const maps = rows("maps", (row) => {
    return {
      id: id(text(row.id)), assetId: id(text(row.assetId)), name: mapName(text(row.name)), kind: mapKind(text(row.kind)),
      parentMapId: optionalId(nullableText(row.parentMapId)), revealedToPlayers: flag(row.revealedToPlayers),
      sortKey: count(row.sortKey), tags: tags(Array.isArray(row.tags) ? (row.tags as string[]) : []),
      createdAt: stamp(row.createdAt), updatedAt: stamp(row.updatedAt)
    } satisfies CodexMapRow;
  });
  const markers = rows("markers", (row) => {
    return {
      id: id(text(row.id)), mapId: id(text(row.mapId)), x: coord(real(row.x)), y: coord(real(row.y)),
      iconId: iconId(text(row.iconId)), iconColor: hexColor(text(row.iconColor)), label: markerLabel(nullableText(row.label)),
      revealedToPlayers: flag(row.revealedToPlayers), pageIds: idArray(row.pageIds as string[] | undefined),
      subMapId: optionalId(nullableText(row.subMapId)), sceneIds: idArray(row.sceneIds as string[] | undefined),
      actorId: optionalId(nullableText(row.actorId)), tags: tags(Array.isArray(row.tags) ? (row.tags as string[]) : []),
      isParty: flag(row.isParty), createdAt: stamp(row.createdAt), updatedAt: stamp(row.updatedAt)
    } satisfies CodexMarkerRow;
  });

  const sessions = rows("sessions", (row) => {
    return {
      id: id(text(row.id)), sessionNumber: sessionNo(typeof row.sessionNumber === "number" ? row.sessionNumber : null),
      realDate: shortLabel(nullableText(row.realDate), 40, "date"), attendees: attendees(Array.isArray(row.attendees) ? (row.attendees as string[]) : []),
      prepBody: body(text(row.prepBody)), recapBody: body(text(row.recapBody)), revealedToPlayers: flag(row.revealedToPlayers),
      status: sessionStatus(typeof row.status === "string" ? row.status : undefined), tags: tags(Array.isArray(row.tags) ? (row.tags as string[]) : []),
      // Older bundles have no scene attachments.
      sceneIds: sessionSceneIds(Array.isArray(row.sceneIds) ? (row.sceneIds as string[]) : []),
      rev: Math.max(1, count(row.rev, 1)), createdAt: stamp(row.createdAt), updatedAt: stamp(row.updatedAt)
    } satisfies CodexSessionRow;
  });

  const journal = rows("journal", (row) => {
    const kind = journalKind(text(row.kind));
    return {
      id: id(text(row.id)), playerText: entryText(text(row.playerText)), gmText: entryGmText(nullableText(row.gmText)),
      revealedToPlayers: flag(row.revealedToPlayers), attachMarkerId: optionalId(nullableText(row.attachMarkerId)),
      attachPageId: optionalId(nullableText(row.attachPageId)), kind, sourceEncounterId: typeof row.sourceEncounterId === "number" ? Math.trunc(row.sourceEncounterId) : null,
      sessionId: typeof row.sessionId === "string" ? optionalId(row.sessionId) : null,
      // The key's presence, not its value, tells a lost join from a kept display label (see `CodexBundleJournalRow`).
      declaredSessionId: "sessionId" in row,
      sessionNumber: typeof row.sessionNumber === "number" ? sessionNo(row.sessionNumber) : null,
      realDate: shortLabel(nullableText(row.realDate), 40, "date"), inWorldLabel: nullableText(row.inWorldLabel),
      calendarInstant: null, inWorldDate: date(row.inWorldDate), sortKey: count(row.sortKey),
      tags: tags(Array.isArray(row.tags) ? (row.tags as string[]) : []),
      // The same defensive parser a stored row uses, so a hand-edited payload degrades as it would on read.
      payload: payloadOf(kind, row.payload === undefined || row.payload === null ? null : JSON.stringify(row.payload)),
      createdAt: stamp(row.createdAt), updatedAt: stamp(row.updatedAt)
    } satisfies CodexBundleJournalRow;
  });
  const quests = rows("quests", (row) => {
    return {
      id: id(text(row.id)), title: title(text(row.title)), status: questStatus(typeof row.status === "string" ? row.status : undefined),
      playerBody: body(text(row.playerBody)), gmBody: body(text(row.gmBody)),
      objectives: questObjectives(Array.isArray(row.objectives) ? (row.objectives as CodexQuestObjective[]) : []),
      entityIds: idArray(row.entityIds as string[] | undefined), revealedToPlayers: flag(row.revealedToPlayers),
      tags: tags(Array.isArray(row.tags) ? (row.tags as string[]) : []),
      rev: Math.max(1, count(row.rev, 1)), createdAt: stamp(row.createdAt), updatedAt: stamp(row.updatedAt)
    } satisfies CodexQuestRow;
  });
  const standing = rows("standing", (row) => {
    return {
      id: id(text(row.id)), factionPageId: id(text(row.factionPageId)), value: standingValue(count(row.value)),
      revealedToPlayers: flag(row.revealedToPlayers), createdAt: stamp(row.createdAt), updatedAt: stamp(row.updatedAt)
    } satisfies CodexStandingRow;
  });
  const relationships = rows("relationships", (row) => {
    return {
      id: id(text(row.id)), fromPageId: id(text(row.fromPageId)), toPageId: id(text(row.toPageId)),
      // Older bundles carry a slug `type`, newer ones a `label`; both become the label. `layer` defaults to player.
      label: connectionLabel(typeof row.label === "string" ? row.label : (typeof row.type === "string" ? row.type.replace(/-/g, " ") : null)) || null,
      layer: connectionLayer(typeof row.layer === "string" ? row.layer : null), createdAt: stamp(row.createdAt)
    } satisfies CodexRelationshipRow;
  });
  const revisions = rows("revisions", (row) => {
    return {
      id: count(row.id), pageId: id(text(row.pageId)), rev: count(row.rev, 1), title: title(text(row.title)),
      entityType: entityType(typeof row.entityType === "string" ? row.entityType : undefined),
      fields: entityFields(row.fields as Record<string, string> | undefined), gmFields: entityFields(row.gmFields as Record<string, string> | undefined),
      playerBody: body(text(row.playerBody)), gmBody: body(text(row.gmBody)), bannerAssetId: optionalId(nullableText(row.bannerAssetId)),
      tags: tags(Array.isArray(row.tags) ? (row.tags as string[]) : []), authoredAt: stamp(row.authoredAt), authorTag: text(row.authorTag)
    } satisfies CodexPageRevisionExportRow;
  });

  // Cross-record checks (see the header): each replaces a mid-transaction driver error with a readable one.
  const unique = (key: string, ids: readonly (string | number)[]) => {
    const seen = new Set<string | number>();
    for (const value of ids) {
      if (seen.has(value)) throw new CodexValidationError(`That backup lists two "${key}" records with the same id (${value}).`);
      seen.add(value);
    }
  };
  const closed = (key: string, what: string, refs: readonly (string | null)[], known: ReadonlySet<string>) => {
    for (const ref of refs) {
      if (ref !== null && !known.has(ref)) throw new CodexValidationError(`That backup's "${key}" section names a ${what} the file does not contain (${ref}).`);
    }
  };
  unique("pages", pages.map((row) => row.id));
  unique("maps", maps.map((row) => row.id));
  unique("markers", markers.map((row) => row.id));
  unique("journal", journal.map((row) => row.id));
  unique("sessions", sessions.map((row) => row.id));
  unique("quests", quests.map((row) => row.id));
  unique("standing", standing.map((row) => row.id));
  unique("relationships", relationships.map((row) => row.id));
  unique("revisions", revisions.map((row) => row.id));
  const pageIds = new Set(pages.map((row) => row.id));
  const mapIds = new Set(maps.map((row) => row.id));
  closed("maps", "parent map", maps.map((row) => row.parentMapId), mapIds);
  closed("markers", "map", markers.map((row) => row.mapId), mapIds);
  closed("relationships", "page", relationships.flatMap((row) => [row.fromPageId, row.toPageId]), pageIds);
  closed("standing", "faction page", standing.map((row) => row.factionPageId), pageIds);
  closed("revisions", "page", revisions.map((row) => row.pageId), pageIds);
  const factions = standing.map((row) => row.factionPageId);
  if (new Set(factions).size !== factions.length) throw new CodexValidationError("That backup has two standing rows for the same faction - a faction holds one standing.");
  if (markers.filter((marker) => marker.isParty).length > 1) throw new CodexValidationError("That backup marks more than one pin as the party's - only one pin can be.");
  const numbers = sessions.map((session) => session.sessionNumber).filter((value): value is number => value !== null);
  if (new Set(numbers).size !== numbers.length) throw new CodexValidationError("That backup has two sessions with the same number.");

  const settingsRaw = bundle.settings as { revisionHistory?: { enabled?: unknown; windowMinutes?: unknown }; autosave?: { enabled?: unknown; intervalSeconds?: unknown } } | undefined;
  const settings: CodexSettingsInput | undefined = settingsRaw
    ? {
      revisionHistory: { enabled: settingsRaw.revisionHistory?.enabled !== false, windowMinutes: count(settingsRaw.revisionHistory?.windowMinutes, DEFAULT_REVISION_SETTINGS.windowMinutes) },
      autosave: { enabled: settingsRaw.autosave?.enabled !== false, intervalSeconds: count(settingsRaw.autosave?.intervalSeconds, DEFAULT_AUTOSAVE_SETTINGS.intervalSeconds) }
    }
    : undefined;

  return {
    pages, maps, markers, journal, relationships, sessions, quests, standing, revisions, settings,
    activeSessionId: typeof bundle.activeSessionId === "string" ? optionalId(bundle.activeSessionId) : null,
    publishedDate: date(bundle.publishedDate),
    partyMarkerId: typeof bundle.partyMarkerId === "string" ? optionalId(bundle.partyMarkerId) : null,
    calendar: normalizeCalendar((bundle.calendar ?? DEFAULT_CALENDAR) as CodexCalendar),
    folders: list("folders").map((path) => folder(text(path))).filter((path): path is string => path !== null)
  };
}

export class CodexStore {
  private database?: DatabaseSync;

  constructor(private readonly databasePath: string, private readonly now: () => number = Date.now) {}

  async initialize() {
    if (this.database) return;
    await mkdir(dirname(this.databasePath), { recursive: true });
    const database = new DatabaseSync(this.databasePath, { enableForeignKeyConstraints: true });
    try {
      database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
      database.exec("CREATE TABLE IF NOT EXISTS codex_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;");
      this.database = database;
      this.migrate();
      const meta = database.prepare("SELECT codex_revision FROM codex_meta WHERE id = 1").get() as { codex_revision: number } | undefined;
      // Seeded with `links_backfilled = 1`: a new database has no older bodies to re-extract.
      if (!meta) database.prepare("INSERT INTO codex_meta (id, codex_revision, links_backfilled) VALUES (1, 0, 1)").run();
      this.reconcileLinks();
    } catch (error) {
      database.close();
      this.database = undefined;
      throw error;
    }
  }

  /**
   * One-time `[[wiki link]]` backfill for session, quest and journal bodies (SQL migrations cannot parse links).
   * Guarded by `links_backfilled`.
   */
  private reconcileLinks(): void {
    const database = this.requireDatabase();
    const flag = database.prepare("SELECT links_backfilled FROM codex_meta WHERE id = 1").get() as { links_backfilled: number } | undefined;
    if (!flag || flag.links_backfilled === 1) return;
    this.transaction(() => {
      for (const row of database.prepare("SELECT id, recap_body, prep_body FROM codex_sessions").all() as Array<{ id: string; recap_body: string; prep_body: string }>) {
        this.rebuildLinksFor("session", row.id, row.recap_body, row.prep_body);
      }
      for (const row of database.prepare("SELECT id, player_body, gm_body FROM codex_quests").all() as Array<{ id: string; player_body: string; gm_body: string }>) {
        this.rebuildLinksFor("quest", row.id, row.player_body, row.gm_body);
      }
      for (const row of database.prepare("SELECT id, player_text, gm_text FROM codex_journal").all() as Array<{ id: string; player_text: string; gm_text: string | null }>) {
        this.rebuildLinksFor("journal", row.id, row.player_text, row.gm_text ?? "");
      }
      database.prepare("UPDATE codex_meta SET links_backfilled = 1 WHERE id = 1").run();
      this.bumpRevision();
    });
  }

  close() { this.database?.close(); this.database = undefined; }

  /** The stored outcome of a `commandId`, or null. Receipts are pruned after seven days. */
  recallCommand(commandId: string): Readonly<{ status: number; body: unknown; fingerprint: string | null }> | null {
    if (!ID.test(commandId)) return null;
    const row = this.requireDatabase().prepare("SELECT status, body_json, fingerprint FROM codex_command_receipts WHERE command_id = ?").get(commandId) as { status: number; body_json: string; fingerprint: string | null } | undefined;
    if (!row) return null;
    try { return { status: row.status, body: JSON.parse(row.body_json) as unknown, fingerprint: row.fingerprint }; } catch { return null; }
  }

  recordCommand(commandId: string, status: number, responseBody: unknown, fingerprint: string): void {
    if (!ID.test(commandId)) return;
    const database = this.requireDatabase();
    const cutoff = new Date(this.now() - 7 * 86_400_000).toISOString();
    // Not inside `this.transaction`: a receipt is bookkeeping and must not bump the revision again.
    database.prepare("INSERT OR REPLACE INTO codex_command_receipts (command_id, status, body_json, created_at, fingerprint) VALUES (?, ?, ?, ?, ?)")
      .run(commandId, status, JSON.stringify(responseBody ?? null), this.stamp(), fingerprint);
    database.prepare("DELETE FROM codex_command_receipts WHERE created_at <= ?").run(cutoff);
  }

  /** The coarse counter bumped on every write - drives the `codex:changed` ping and list ETags. */
  get revision(): number {
    return (this.requireDatabase().prepare("SELECT codex_revision FROM codex_meta WHERE id = 1").get() as { codex_revision: number } | undefined)?.codex_revision ?? 0;
  }

  // Pages

  createPage(input: CodexPageCreateInput): CodexPageRow {
    const database = this.requireDatabase();
    const pageId = this.freshId();
    const stamp = this.stamp();
    const createdType = entityType(input.entityType);
    // Fields are pruned to the page's type so a page never holds values its type cannot show or remove.
    const sealed = sealSecretFields(
      pruneCodexFields(createdType, entityFields(input.fields)),
      pruneCodexFields(createdType, entityFields(input.gmFields))
    );
    // The same `resolveDate` as journal entries, so `setCalendar` can reflow both by one rule.
    const dated = this.resolveDate(input.inWorldDate, null);
    const row: PageRow = {
      id: pageId, title: title(input.title), entity_type: createdType, fields_json: JSON.stringify(sealed.fields), gm_fields_json: JSON.stringify(sealed.gmFields),
      folder: folder(input.folder), tags_json: JSON.stringify(tags(input.tags)),
      player_body: body(input.playerBody), gm_body: body(input.gmBody), revealed: input.revealedToPlayers ? 1 : 0,
      banner_asset_id: input.bannerAssetId ? id(input.bannerAssetId) : null,
      in_world_label: dated.label, calendar_instant: dated.instant,
      in_world_year: dated.date ? dated.date.year : null, in_world_month: dated.date ? dated.date.month : null, in_world_day: dated.date ? dated.date.day : null,
      rev: 1, created_at: stamp, updated_at: stamp
    };
    this.transaction(() => {
      database.prepare("INSERT INTO codex_pages (id, title, entity_type, fields_json, gm_fields_json, folder, tags_json, player_body, gm_body, revealed, banner_asset_id, in_world_label, calendar_instant, in_world_year, in_world_month, in_world_day, rev, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(row.id, row.title, row.entity_type, row.fields_json, row.gm_fields_json, row.folder, row.tags_json, row.player_body, row.gm_body, row.revealed, row.banner_asset_id, row.in_world_label, row.calendar_instant, row.in_world_year, row.in_world_month, row.in_world_day, row.rev, row.created_at, row.updated_at);
      this.rebuildLinksFor("page", pageId, row.player_body, row.gm_body);
      this.indexPage(pageId, row.title, row.player_body, row.gm_body, row.fields_json, row.gm_fields_json, row.tags_json);
      this.registerFolderPath(row.folder, stamp);
      // Not throttled (a new page has nothing to fall back to), but honours the global history switch.
      if (this.revisionSettings().enabled) this.snapshotRevision(pageId, row, "codex:create");
      this.bumpRevision();
    });
    return this.getPage(pageId)!;
  }

  /** `forceRevision` is set only by `restoreRevision`; it is last and defaults false so no request can set it. */
  updatePage(pageId: string, input: CodexPageUpdateInput, expectedRev: number | undefined, authorTag: string, forceRevision = false): CodexPageRow {
    const database = this.requireDatabase();
    const existing = this.pageRow(pageId);
    if (!existing) throw new CodexNotFoundError("That page no longer exists.");
    // Single-writer, last-writer-wins: the message states what happened; the next save resyncs the revision.
    if (expectedRev !== undefined && expectedRev !== existing.rev) throw new CodexRevisionConflictError("This page was changed somewhere else after you opened it.");
    const nextEntityType = input.entityType === undefined ? (existing.entity_type as CodexEntityType) : entityType(input.entityType);
    // Re-seal and prune whenever fields or the type change, so secret keys never rest in `fields` and a type
    // switch cannot leave hidden values on a revealed page. Pruned values stay in revision history.
    let fieldsJson = existing.fields_json;
    let gmFieldsJson = existing.gm_fields_json;
    if (input.fields !== undefined || input.gmFields !== undefined || nextEntityType !== existing.entity_type) {
      const baseFields = input.fields === undefined ? parseFields(existing.fields_json) : entityFields(input.fields);
      const baseGm = input.gmFields === undefined ? parseFields(existing.gm_fields_json) : entityFields(input.gmFields);
      const sealed = sealSecretFields(pruneCodexFields(nextEntityType, baseFields), pruneCodexFields(nextEntityType, baseGm));
      fieldsJson = JSON.stringify(sealed.fields);
      gmFieldsJson = JSON.stringify(sealed.gmFields);
    }
    // Omitted `inWorldDate` keeps the stored date and `null` clears it, since the editor PATCHes whole
    // drafts on autosave.
    const dated = input.inWorldDate !== undefined ? this.resolveDate(input.inWorldDate, null) : null;
    const next: PageRow = {
      ...existing,
      title: input.title === undefined ? existing.title : title(input.title),
      entity_type: nextEntityType,
      fields_json: fieldsJson,
      gm_fields_json: gmFieldsJson,
      folder: input.folder === undefined ? existing.folder : folder(input.folder),
      tags_json: input.tags === undefined ? existing.tags_json : JSON.stringify(tags(input.tags)),
      player_body: input.playerBody === undefined ? existing.player_body : body(input.playerBody),
      gm_body: input.gmBody === undefined ? existing.gm_body : body(input.gmBody),
      banner_asset_id: input.bannerAssetId === undefined ? existing.banner_asset_id : (input.bannerAssetId ? id(input.bannerAssetId) : null),
      in_world_label: dated ? dated.label : existing.in_world_label,
      calendar_instant: dated ? dated.instant : existing.calendar_instant,
      in_world_year: dated ? (dated.date ? dated.date.year : null) : existing.in_world_year,
      in_world_month: dated ? (dated.date ? dated.date.month : null) : existing.in_world_month,
      in_world_day: dated ? (dated.date ? dated.date.day : null) : existing.in_world_day,
      rev: existing.rev + 1,
      updated_at: this.stamp()
    };
    this.transaction(() => {
      database.prepare("UPDATE codex_pages SET title = ?, entity_type = ?, fields_json = ?, gm_fields_json = ?, folder = ?, tags_json = ?, player_body = ?, gm_body = ?, banner_asset_id = ?, in_world_label = ?, calendar_instant = ?, in_world_year = ?, in_world_month = ?, in_world_day = ?, rev = ?, updated_at = ? WHERE id = ?")
        .run(next.title, next.entity_type, next.fields_json, next.gm_fields_json, next.folder, next.tags_json, next.player_body, next.gm_body, next.banner_asset_id, next.in_world_label, next.calendar_instant, next.in_world_year, next.in_world_month, next.in_world_day, next.rev, next.updated_at, pageId);
      this.rebuildLinksFor("page", pageId, next.player_body, next.gm_body);
      this.indexPage(pageId, next.title, next.player_body, next.gm_body, next.fields_json, next.gm_fields_json, next.tags_json);
      this.registerFolderPath(next.folder, next.updated_at);
      // Checkpoint the prior state (throttled), so the newest revision is a real undo. Restores and type
      // changes force one because they discard content; `revisionExistsAt` prevents duplicates.
      const typeChanged = nextEntityType !== existing.entity_type;
      if (this.revisionDue(pageId, forceRevision || typeChanged) && !this.revisionExistsAt(pageId, existing.rev)) {
        this.snapshotRevision(pageId, existing, authorTag);
      }
      this.bumpRevision();
    });
    return this.getPage(pageId)!;
  }

  /** Revealing is not editing: `updated_at` stays (the revision still bumps). */
  setPageRevealed(pageId: string, revealed: boolean): CodexPageRow {
    const database = this.requireDatabase();
    if (!this.pageRow(pageId)) throw new CodexNotFoundError("That page no longer exists.");
    this.transaction(() => {
      database.prepare("UPDATE codex_pages SET revealed = ? WHERE id = ?").run(revealed ? 1 : 0, pageId);
      this.bumpRevision();
    });
    return this.getPage(pageId)!;
  }

  /** Re-path a folder subtree. Filing is not editing: no snapshot, no `updated_at`; `rev` bumps for open editors. */
  moveFolder(fromPath: string, toPath: string): number {
    const database = this.requireDatabase();
    const from = folder(fromPath);
    if (!from) throw new CodexValidationError("Choose a folder to move.");
    const to = folder(toPath); // null => top level
    if (to !== null && (to === from || to.startsWith(`${from}/`))) throw new CodexValidationError("Can't move a folder into itself.");
    // Re-path a folder value under `from` onto `to` (used for both pages and folder records).
    const repath = (value: string): string | null => folder(value === from ? (to ?? "") : to === null ? value.slice(from.length + 1) : to + value.slice(from.length));
    let moved = 0;
    this.transaction(() => {
      const stamp = this.stamp();
      const rows = database.prepare("SELECT id, folder FROM codex_pages WHERE folder = ? OR folder LIKE ?").all(from, `${from}/%`) as { id: string; folder: string }[];
      const update = database.prepare("UPDATE codex_pages SET folder = ?, rev = rev + 1 WHERE id = ?");
      for (const row of rows) { update.run(repath(row.folder), row.id); moved += 1; } // folder() re-validates depth/length and normalizes "" to null
      // Carry the folder records along too, so a moved empty folder keeps existing at its new path.
      const recs = database.prepare("SELECT path FROM codex_folders WHERE path = ? OR path LIKE ?").all(from, `${from}/%`) as { path: string }[];
      const dropRec = database.prepare("DELETE FROM codex_folders WHERE path = ?");
      const addRec = database.prepare("INSERT OR IGNORE INTO codex_folders (path, created_at) VALUES (?, ?)");
      for (const rec of recs) { dropRec.run(rec.path); const next = repath(rec.path); if (next) addRec.run(next, stamp); }
      if (moved > 0 || recs.length > 0) this.bumpRevision();
    });
    return moved;
  }

  /** Every explicitly-created folder path (records only - the tree unions these with page-derived paths). */
  listFolders(): string[] {
    return (this.requireDatabase().prepare("SELECT path FROM codex_folders ORDER BY path COLLATE NOCASE").all() as { path: string }[]).map((row) => row.path);
  }
  /** Create (or keep) an empty folder that persists with no pages in it. Returns the normalized path. */
  createFolder(path: string): string {
    const database = this.requireDatabase();
    const clean = folder(path);
    if (!clean) throw new CodexValidationError("Name the folder.");
    this.transaction(() => {
      database.prepare("INSERT OR IGNORE INTO codex_folders (path, created_at) VALUES (?, ?)").run(clean, this.stamp());
      this.bumpRevision();
    });
    return clean;
  }
  /** Ensure a page's folder path (and its ancestors) exist as records, so the folder persists once the page leaves. */
  private registerFolderPath(path: string | null, stamp: string): void {
    if (!path) return;
    const insert = this.requireDatabase().prepare("INSERT OR IGNORE INTO codex_folders (path, created_at) VALUES (?, ?)");
    let acc = "";
    for (const segment of path.split("/")) { acc = acc ? `${acc}/${segment}` : segment; insert.run(acc, stamp); }
  }
  /** Pages under the folder move to the top level, never deleted; `rev` bumps, `updated_at` does not. */
  deleteFolder(path: string): void {
    const database = this.requireDatabase();
    const clean = folder(path);
    if (!clean) return;
    this.transaction(() => {
      database.prepare("UPDATE codex_pages SET folder = NULL, rev = rev + 1 WHERE folder = ? OR folder LIKE ?").run(clean, `${clean}/%`);
      database.prepare("DELETE FROM codex_folders WHERE path = ? OR path LIKE ?").run(clean, `${clean}/%`);
      this.bumpRevision();
    });
  }

  deletePage(pageId: string): void {
    const database = this.requireDatabase();
    if (!ID.test(pageId)) return;
    this.transaction(() => {
      this.unindex("page", pageId);
      // References to the page become label-only rather than dangling. Drop it from every marker's page_ids
      // (json_group_array is NULL for an empty set).
      database.prepare("UPDATE codex_markers SET page_ids_json = COALESCE((SELECT json_group_array(value) FROM json_each(codex_markers.page_ids_json) WHERE value != ?), '[]'), updated_at = ? WHERE EXISTS (SELECT 1 FROM json_each(codex_markers.page_ids_json) WHERE value = ?)").run(pageId, this.stamp(), pageId);
      database.prepare("UPDATE codex_journal SET attach_page_id = NULL, updated_at = ? WHERE attach_page_id = ?").run(this.stamp(), pageId);
      // Quests reference pages in a JSON array with no FK, so remove the id there too.
      database.prepare("UPDATE codex_quests SET entity_ids_json = COALESCE((SELECT json_group_array(value) FROM json_each(codex_quests.entity_ids_json) WHERE value != ?), '[]'), updated_at = ? WHERE EXISTS (SELECT 1 FROM json_each(codex_quests.entity_ids_json) WHERE value = ?)").run(pageId, this.stamp(), pageId);
      // Downtime payloads reference character pages inside JSON: null it so the tracker shows no dead link;
      // `who` remains and the record survives. `json_valid` first, since `json_set` throws on malformed JSON.
      database.prepare("UPDATE codex_journal SET payload_json = json_set(payload_json, '$.characterPageId', json('null')), updated_at = ? WHERE kind = 'downtime' AND json_valid(payload_json) AND json_extract(payload_json, '$.characterPageId') = ?").run(this.stamp(), pageId);
      // `codex_links` has no FK (multi-table sources), so a page's own link rows are removed explicitly.
      this.scrubLinks("page", pageId);
      database.prepare("DELETE FROM codex_pages WHERE id = ?").run(pageId); // cascades revisions
      this.bumpRevision();
    });
  }

  getPage(pageId: string): CodexPageRow | null {
    if (!ID.test(pageId)) return null;
    const row = this.pageRow(pageId);
    return row ? this.toPage(row) : null;
  }

  listPages(filter?: Readonly<{ folder?: string | null; tag?: string }>): CodexPageSummaryRow[] {
    const rows = this.requireDatabase()
      .prepare(`SELECT ${PAGE_SUMMARY_COLUMNS} FROM codex_pages ORDER BY title COLLATE NOCASE`)
      .all() as Array<Omit<PageRow, "player_body" | "gm_body">>;
    return rows
      .map((row) => ({
        id: row.id, title: row.title, entityType: (row.entity_type as CodexEntityType) ?? "note", fields: parseFields(row.fields_json),
        folder: row.folder, tags: JSON.parse(row.tags_json) as string[],
        revealedToPlayers: row.revealed === 1, bannerAssetId: row.banner_asset_id,
        inWorldLabel: row.in_world_label, calendarInstant: row.calendar_instant, inWorldDate: pageDateOf(row),
        rev: row.rev, createdAt: row.created_at, updatedAt: row.updated_at
      }))
      .filter((page) => (filter?.folder === undefined || page.folder === filter.folder) && (filter?.tag === undefined || page.tags.includes(filter.tag)));
  }

  /** A full GM-only export of the whole codex for backup / round-trip (every field, both bodies). */
  exportBundle(): CodexBundle {
    const pages = (this.requireDatabase().prepare(`SELECT ${PAGE_COLUMNS} FROM codex_pages ORDER BY title COLLATE NOCASE`).all() as PageRow[]).map((row) => this.toPage(row));
    const maps = this.listMaps();
    const markers = maps.flatMap((map) => this.listMarkers(map.id));
    // Everything that exists nowhere else must travel, or a restore is quietly wrong (including the calendar
    // the instants were computed against, empty folders and all revisions). Append new keys last.
    return {
      pages, maps, markers, journal: this.listTimeline(), relationships: this.listAllDeclaredConnections(),
      sessions: this.listSessions(), activeSessionId: this.activeSessionId, quests: this.listQuests(),
      publishedDate: this.getPublishedDate(), standing: this.listStanding(), partyMarkerId: this.partyMarker()?.id ?? null,
      calendar: this.getCalendar(), folders: this.listFolders(), revisions: this.listAllRevisions(),
      // Settings exist nowhere else either.
      settings: { revisionHistory: this.revisionSettings(), autosave: this.autosaveSettings() }
    };
  }

  /**
   * Replace the Codex with a validated bundle in one transaction. Replace, not merge: merging singleton and
   * uniquely-indexed state is undefined. Rows are written raw (no `create*` side effects); dates are recomputed.
   */
  importBundle(bundle: unknown): CodexImportCounts {
    const database = this.requireDatabase();
    const parsed = normalizeBundle(bundle);

    this.transaction(() => {
      // 1. Wipe, children first, explicitly: `codex_links` has no FK cascade to rely on.
      for (const table of ["codex_page_revisions", "codex_links", "codex_relationships", "codex_journal", "codex_markers", "codex_maps", "codex_standing", "codex_quests", "codex_sessions", "codex_folders", "codex_pages", "codex_search_player", "codex_search_gm"]) {
        database.prepare(`DELETE FROM ${table}`).run();
      }

      // 2. The meta row. The calendar first, since every date below is resolved against it.
      this.writeCalendar(normalizeCalendar(parsed.calendar));
      this.writePublishedDate(parsed.publishedDate);
      if (parsed.settings) {
        database.prepare("UPDATE codex_meta SET revision_history_enabled = ?, revision_window_minutes = ?, autosave_enabled = ?, autosave_interval_seconds = ? WHERE id = 1")
          .run(parsed.settings.revisionHistory.enabled ? 1 : 0, revisionWindowMinutes(parsed.settings.revisionHistory.windowMinutes), parsed.settings.autosave.enabled ? 1 : 0, autosaveIntervalSeconds(parsed.settings.autosave.intervalSeconds));
      }

      // 3. Pages, folders.
      const insertPage = database.prepare("INSERT INTO codex_pages (id, title, entity_type, fields_json, gm_fields_json, folder, tags_json, player_body, gm_body, revealed, banner_asset_id, in_world_label, calendar_instant, in_world_year, in_world_month, in_world_day, rev, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const page of parsed.pages) {
        const dated = this.resolveDate(page.inWorldDate, null);
        const sealed = sealSecretFields(pruneCodexFields(page.entityType, { ...page.fields }), pruneCodexFields(page.entityType, { ...page.gmFields }));
        insertPage.run(page.id, page.title, page.entityType, JSON.stringify(sealed.fields), JSON.stringify(sealed.gmFields), page.folder, JSON.stringify(page.tags), page.playerBody, page.gmBody, page.revealedToPlayers ? 1 : 0, page.bannerAssetId, dated.label, dated.instant, dated.date?.year ?? null, dated.date?.month ?? null, dated.date?.day ?? null, page.rev, page.createdAt, page.updatedAt);
        this.registerFolderPath(page.folder, page.createdAt);
        this.rebuildLinksFor("page", page.id, page.playerBody, page.gmBody);
        this.indexPage(page.id, page.title, page.playerBody, page.gmBody, JSON.stringify(sealed.fields), JSON.stringify(sealed.gmFields), JSON.stringify(page.tags));
      }
      for (const path of parsed.folders) this.registerFolderPath(path, this.stamp());

      // 4. Sessions before journal, so entry session ids resolve.
      const insertSession = database.prepare(`INSERT INTO codex_sessions (${SESSION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const sessionByNumber = new Map<number, string>();
      for (const session of parsed.sessions) {
        insertSession.run(session.id, session.sessionNumber, session.realDate, JSON.stringify(session.attendees), session.prepBody, session.recapBody, session.revealedToPlayers ? 1 : 0, session.status, session.rev, session.createdAt, session.updatedAt, JSON.stringify(session.tags), JSON.stringify(session.sceneIds));
        if (session.sessionNumber !== null) sessionByNumber.set(session.sessionNumber, session.id);
        this.indexSession({ id: session.id, session_number: session.sessionNumber, real_date: session.realDate, attendees_json: JSON.stringify(session.attendees), prep_body: session.prepBody, recap_body: session.recapBody, revealed: session.revealedToPlayers ? 1 : 0, status: session.status, rev: session.rev, created_at: session.createdAt, updated_at: session.updatedAt, tags_json: JSON.stringify(session.tags), scene_ids_json: JSON.stringify(session.sceneIds) });
        this.rebuildLinksFor("session", session.id, session.recapBody, session.prepBody);
      }
      const sessionIds = new Set(parsed.sessions.map((session) => session.id));

      // 5. Journal. Only older rows (`declaredSessionId === false`) resolve a number to a session (creating a
      //    hidden one if needed); a newer row's bare number is a kept label, written back unchanged.
      const insertEntry = database.prepare("INSERT INTO codex_journal (id, player_text, gm_text, revealed, attach_marker_id, attach_page_id, kind, source_encounter_id, session_number, session_id, real_date, in_world_label, calendar_instant, in_world_year, in_world_month, in_world_day, sort_key, tags_json, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const entry of parsed.journal) {
        let sessionId = entry.sessionId !== null && sessionIds.has(entry.sessionId) ? entry.sessionId : null;
        let bareNumber: number | null = null;
        if (sessionId === null && entry.sessionNumber !== null) {
          if (entry.declaredSessionId) bareNumber = entry.sessionNumber;   // a kept display label, written straight back
          else {
            let resolved = sessionByNumber.get(entry.sessionNumber);
            if (resolved === undefined) {
              resolved = this.freshId();
              const stamp = this.stamp();
              insertSession.run(resolved, entry.sessionNumber, null, "[]", "", "", 0, "played", 1, stamp, stamp, "[]", "[]");
              // Index synthesized sessions like every other session written here.
              this.indexSession({ id: resolved, session_number: entry.sessionNumber, real_date: null, attendees_json: "[]", prep_body: "", recap_body: "", revealed: 0, status: "played", rev: 1, created_at: stamp, updated_at: stamp, tags_json: "[]", scene_ids_json: "[]" });
              sessionByNumber.set(entry.sessionNumber, resolved);
            }
            sessionId = resolved;
          }
        }
        const dated = this.resolveDate(entry.inWorldDate, entry.inWorldLabel);
        insertEntry.run(entry.id, entry.playerText, entry.gmText, entry.revealedToPlayers ? 1 : 0, entry.attachMarkerId, entry.attachPageId, entry.kind, entry.sourceEncounterId, bareNumber, sessionId, entry.realDate, dated.label, dated.instant, dated.date?.year ?? null, dated.date?.month ?? null, dated.date?.day ?? null, entry.sortKey, JSON.stringify(entry.tags), entry.payload === null ? null : JSON.stringify(entry.payload), entry.createdAt, entry.updatedAt);
        this.indexEntry(entry.id, entry.playerText, entry.gmText, JSON.stringify(entry.tags));
        this.rebuildLinksFor("journal", entry.id, entry.playerText, entry.gmText ?? "");
      }

      // 6. Maps and markers.
      const insertMap = database.prepare(`INSERT INTO codex_maps (${MAP_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const map of parsed.maps) {
        insertMap.run(map.id, map.assetId, map.name, map.kind, map.parentMapId, map.revealedToPlayers ? 1 : 0, map.sortKey, JSON.stringify(map.tags), map.createdAt, map.updatedAt);
        this.indexMap(map.id, map.name, JSON.stringify(map.tags));
      }
      const insertMarker = database.prepare(`INSERT INTO codex_markers (${MARKER_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const marker of parsed.markers) {
        insertMarker.run(marker.id, marker.mapId, marker.x, marker.y, marker.iconId, marker.iconColor, marker.label, marker.revealedToPlayers ? 1 : 0, JSON.stringify(marker.pageIds), marker.subMapId, JSON.stringify(marker.sceneIds), marker.actorId, JSON.stringify(marker.tags), marker.isParty ? 1 : 0, marker.createdAt, marker.updatedAt);
        this.indexMarker(marker.id, marker.label, JSON.stringify(marker.tags));
      }

      // 7. Quests, standing, declared connections.
      const insertQuest = database.prepare(`INSERT INTO codex_quests (${QUEST_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const quest of parsed.quests) {
        insertQuest.run(quest.id, quest.title, quest.status, quest.playerBody, quest.gmBody, JSON.stringify(quest.objectives), JSON.stringify(quest.entityIds), quest.revealedToPlayers ? 1 : 0, quest.rev, quest.createdAt, quest.updatedAt, JSON.stringify(quest.tags));
        this.indexQuest(quest.id, quest.title, quest.playerBody, quest.gmBody, JSON.stringify(quest.objectives), JSON.stringify(quest.tags));
        this.rebuildLinksFor("quest", quest.id, quest.playerBody, quest.gmBody);
      }
      const insertStanding = database.prepare(`INSERT INTO codex_standing (${STANDING_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`);
      for (const row of parsed.standing) insertStanding.run(row.id, row.factionPageId, row.value, row.revealedToPlayers ? 1 : 0, row.createdAt, row.updatedAt);
      const insertRel = database.prepare("INSERT INTO codex_relationships (id, from_page_id, to_page_id, type, layer, created_at) VALUES (?, ?, ?, ?, ?, ?)");
      for (const edge of parsed.relationships) insertRel.run(edge.id, edge.fromPageId, edge.toPageId, edge.label ?? "", edge.layer, edge.createdAt);

      // 8. Revisions keep their integer ids so `.../revisions/{revisionId}/restore` URLs survive a restore
      //    (an explicit id under AUTOINCREMENT is legal; `sqlite_sequence` follows the max).
      const insertRevision = database.prepare("INSERT INTO codex_page_revisions (id, page_id, rev, title, entity_type, fields_json, gm_fields_json, player_body, gm_body, banner_asset_id, tags_json, authored_at, author_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const revision of parsed.revisions) {
        insertRevision.run(revision.id, revision.pageId, revision.rev, revision.title, revision.entityType, JSON.stringify(revision.fields), JSON.stringify(revision.gmFields), revision.playerBody, revision.gmBody, revision.bannerAssetId, JSON.stringify(revision.tags), revision.authoredAt, revision.authorTag);
      }

      // 9. The active-session pointer last, since it references rows written above.
      database.prepare("UPDATE codex_meta SET active_session_id = ? WHERE id = 1").run(parsed.activeSessionId !== null && sessionIds.has(parsed.activeSessionId) ? parsed.activeSessionId : null);
      // Links were rebuilt per record above, so there is nothing left to backfill.
      database.prepare("UPDATE codex_meta SET links_backfilled = 1 WHERE id = 1").run();
      this.bumpRevision();
    });

    // Report the database's own row counts, not the bundle's claims.
    const count = (table: string) => (database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    return {
      pages: count("codex_pages"), folders: count("codex_folders"), maps: count("codex_maps"), markers: count("codex_markers"),
      journal: count("codex_journal"), connections: count("codex_relationships"), sessions: count("codex_sessions"),
      quests: count("codex_quests"), standing: count("codex_standing"), revisions: count("codex_page_revisions")
    };
  }

  // Connections: one read model over declared edges and mentions. Never gated here.

  /** Idempotent on `(from, to, label)` (both directions for symmetric labels). `layer` is not part of the key. */
  createConnection(fromPageId: string, input: Readonly<{ toPageId: string; label?: string | null; layer?: "player" | "gm" | null }>): CodexRelationshipRow {
    const database = this.requireDatabase();
    const from = id(fromPageId);
    const to = id(input.toPageId);
    if (from === to) throw new CodexValidationError("A page can't connect to itself.");
    if (!this.pageRow(from) || !this.pageRow(to)) throw new CodexNotFoundError("One of those pages no longer exists.");
    const label = connectionLabel(input.label);
    const layer = connectionLayer(input.layer);
    const existing = (SYMMETRIC_RELATIONSHIPS.has(label)
      ? database.prepare(`SELECT ${REL_COLUMNS} FROM codex_relationships WHERE ((from_page_id = ? AND to_page_id = ?) OR (from_page_id = ? AND to_page_id = ?)) AND type = ?`).get(from, to, to, from, label)
      : database.prepare(`SELECT ${REL_COLUMNS} FROM codex_relationships WHERE from_page_id = ? AND to_page_id = ? AND type = ?`).get(from, to, label)) as RelationshipRowRaw | undefined;
    // An idempotent no-op is not an edit, so page recency is left alone.
    if (existing) return this.toRel(existing);
    const relId = this.freshId();
    this.transaction(() => {
      const stamp = this.stamp();
      database.prepare("INSERT INTO codex_relationships (id, from_page_id, to_page_id, type, layer, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(relId, from, to, label, layer, stamp);
      this.touchPages([from, to], stamp);
      this.bumpRevision();
    });
    return this.toRel(database.prepare(`SELECT ${REL_COLUMNS} FROM codex_relationships WHERE id = ?`).get(relId) as RelationshipRowRaw);
  }

  /** Relabel or re-layer a declared connection; omitted fields are kept. Mentions have no row to update. */
  updateConnection(connectionId: string, input: Readonly<{ label?: string | null; layer?: "player" | "gm" }>): CodexRelationshipRow {
    const database = this.requireDatabase();
    if (!ID.test(connectionId)) throw new CodexNotFoundError("That connection no longer exists.");
    const existing = database.prepare(`SELECT ${REL_COLUMNS} FROM codex_relationships WHERE id = ?`).get(connectionId) as RelationshipRowRaw | undefined;
    if (!existing) throw new CodexNotFoundError("That connection no longer exists.");
    const label = input.label === undefined ? existing.type : connectionLabel(input.label);
    const layer = input.layer === undefined ? (existing.layer as "player" | "gm") : connectionLayer(input.layer);
    this.transaction(() => {
      database.prepare("UPDATE codex_relationships SET type = ?, layer = ? WHERE id = ?").run(label, layer, connectionId);
      this.touchPages([existing.from_page_id, existing.to_page_id], this.stamp());
      this.bumpRevision();
    });
    return this.toRel(database.prepare(`SELECT ${REL_COLUMNS} FROM codex_relationships WHERE id = ?`).get(connectionId) as RelationshipRowRaw);
  }

  /** Remove one declared connection; idempotent, and an early return on a malformed id. */
  deleteConnection(connectionId: string): void {
    if (!ID.test(connectionId)) return;
    const database = this.requireDatabase();
    // Read the endpoints before deleting so both pages' recency moves.
    const existing = database.prepare("SELECT from_page_id, to_page_id FROM codex_relationships WHERE id = ?").get(connectionId) as { from_page_id: string; to_page_id: string } | undefined;
    this.transaction(() => {
      database.prepare("DELETE FROM codex_relationships WHERE id = ?").run(connectionId);
      if (existing) this.touchPages([existing.from_page_id, existing.to_page_id], this.stamp());
      this.bumpRevision();
    });
  }

  /** Every declared connection row, for the backup bundle. Mentions are derived and rebuilt on import. */
  listAllDeclaredConnections(): CodexRelationshipRow[] {
    return (this.requireDatabase().prepare(`SELECT ${REL_COLUMNS} FROM codex_relationships`).all() as RelationshipRowRaw[]).map((row) => this.toRel(row));
  }

  /**
   * One page's Connections panel, raw and ungated (`projectPlayerPageConnections` gates). `otherRevealed` is a GM
   * fact, weaker than the player projections; never filter on it. Unlabelled declared edges absorb duplicate mentions.
   */
  connectionsForPage(pageId: string): CodexPageConnectionRow[] {
    if (!ID.test(pageId)) return [];
    const page = this.pageRow(pageId);
    if (!page) return [];
    const database = this.requireDatabase();
    const rows: CodexPageConnectionRow[] = [];

    // 1. Declared edges, both directions; the other end is always a page.
    const declared = (direction: "out" | "in") => {
      const mine = direction === "out" ? "from_page_id" : "to_page_id";
      const theirs = direction === "out" ? "to_page_id" : "from_page_id";
      return database.prepare(
        `SELECT r.id, r.type, r.layer, r.created_at, r.${theirs} AS other_id, p.title AS other_title, p.entity_type AS other_type, p.revealed AS other_revealed
         FROM codex_relationships r JOIN codex_pages p ON p.id = r.${theirs} WHERE r.${mine} = ? ORDER BY r.type, p.title COLLATE NOCASE`
      ).all(pageId) as Array<{ id: string; type: string; layer: string; created_at: string; other_id: string; other_title: string; other_type: string; other_revealed: number }>;
    };
    for (const direction of ["out", "in"] as const) {
      for (const row of declared(direction)) {
        rows.push({
          id: row.id, direction, otherKind: "page", otherId: row.other_id, otherTitle: row.other_title,
          otherEntityType: (row.other_type as CodexEntityType) ?? "note", otherRevealed: row.other_revealed === 1,
          label: row.type === "" ? null : row.type, origin: "declared", layer: row.layer === "gm" ? "gm" : "player", section: null
        });
      }
    }

    // 2. Incoming mentions: every record whose body names this page's title, resolved per source kind.
    const incoming = database.prepare(
      "SELECT source_kind, source_id, layer, section FROM codex_links WHERE target_kind = 'page' AND target_ref = ? AND NOT (source_kind = 'page' AND source_id = ?)"
    ).all(pageLinkKey(page.title), pageId) as Array<{ source_kind: CodexConnectionSourceKind; source_id: string; layer: "player" | "gm"; section: string | null }>;
    for (const row of incoming) {
      const other = this.resolveConnectionEndpoint(row.source_kind, row.source_id);
      if (!other) continue;   // the source record is gone
      rows.push({ id: null, direction: "in", otherKind: row.source_kind, otherId: row.source_id, otherTitle: other.title, otherEntityType: other.entityType, otherRevealed: other.revealed, label: null, origin: "mention", layer: row.layer, section: row.section });
    }

    // 3. This page's outgoing mentions, resolved by title key through one index built up front (a
    //    per-row page scan here is very expensive on large codexes). Links to unknown titles are dropped.
    const outgoing = database.prepare(
      "SELECT layer, target_ref, section FROM codex_links WHERE source_kind = 'page' AND source_id = ? AND target_kind = 'page'"
    ).all(pageId) as Array<{ layer: "player" | "gm"; target_ref: string; section: string | null }>;
    if (outgoing.length > 0) {
      const byLinkKey = new Map<string, { id: string; title: string; entity_type: string; revealed: number }>();
      for (const page of database.prepare("SELECT id, title, entity_type, revealed FROM codex_pages").all() as Array<{ id: string; title: string; entity_type: string; revealed: number }>) {
        byLinkKey.set(pageLinkKey(page.title), page);
      }
      for (const row of outgoing) {
        const target = byLinkKey.get(row.target_ref);
        if (!target || target.id === pageId) continue;
        rows.push({ id: null, direction: "out", otherKind: "page", otherId: target.id, otherTitle: target.title, otherEntityType: (target.entity_type as CodexEntityType) ?? "note", otherRevealed: target.revealed === 1, label: null, origin: "mention", layer: row.layer, section: row.section });
      }
    }

    // 4. Fold an unlabelled declared edge and a mention over the same pair into one row, declared winning.
    const declaredPairs = new Set(rows.filter((row) => row.origin === "declared" && row.label === null).map((row) => `${row.direction}|${row.otherKind}|${row.otherId}`));
    return rows.filter((row) => row.origin === "declared" || !declaredPairs.has(`${row.direction}|${row.otherKind}|${row.otherId}`));
  }

  /** The whole graph. Mentions collapse per `(fromKind, fromId, toPageId)`; one in a player body makes it a player edge. */
  listAllConnections(): CodexConnectionRow[] {
    const database = this.requireDatabase();
    const edges: CodexConnectionRow[] = [];
    for (const row of database.prepare(`SELECT ${REL_COLUMNS} FROM codex_relationships`).all() as RelationshipRowRaw[]) {
      edges.push({ id: row.id, fromKind: "page", fromId: row.from_page_id, toPageId: row.to_page_id, label: row.type === "" ? null : row.type, origin: "declared", layer: row.layer === "gm" ? "gm" : "player", createdAt: row.created_at });
    }
    const idByLinkKey = new Map<string, string>();
    for (const page of database.prepare("SELECT id, title FROM codex_pages").all() as Array<{ id: string; title: string }>) idByLinkKey.set(pageLinkKey(page.title), page.id);
    // `layer` in the ORDER BY makes the collapse deterministic: 'gm' sorts first, then is upgraded.
    const mentions = new Map<string, CodexConnectionRow>();
    const rows = database.prepare("SELECT source_kind, source_id, layer, target_ref FROM codex_links WHERE target_kind = 'page' ORDER BY source_kind, source_id, target_ref, layer").all() as Array<{ source_kind: CodexConnectionSourceKind; source_id: string; layer: "player" | "gm"; target_ref: string }>;
    for (const row of rows) {
      const toPageId = idByLinkKey.get(row.target_ref);
      if (!toPageId || (row.source_kind === "page" && toPageId === row.source_id)) continue;
      const key = `${row.source_kind}|${row.source_id}|${toPageId}`;
      const seen = mentions.get(key);
      if (!seen) mentions.set(key, { id: null, fromKind: row.source_kind, fromId: row.source_id, toPageId, label: null, origin: "mention", layer: row.layer, createdAt: null });
      else if (row.layer === "player" && seen.layer !== "player") mentions.set(key, { ...seen, layer: "player" });
    }
    return [...edges, ...mentions.values()];
  }

  /** Title and reveal state of a connection endpoint; null when the record is gone, which drops the edge. */
  private resolveConnectionEndpoint(kind: CodexConnectionSourceKind, recordId: string): Readonly<{ title: string; entityType: CodexEntityType | null; revealed: boolean }> | null {
    switch (kind) {
      case "page": {
        const page = this.pageRow(recordId);
        return page ? { title: page.title, entityType: (page.entity_type as CodexEntityType) ?? "note", revealed: page.revealed === 1 } : null;
      }
      case "session": {
        const session = this.getSession(recordId);
        if (!session) return null;
        const title = session.sessionNumber !== null ? `Session ${session.sessionNumber}` : (session.recapBody.trim().slice(0, 80) || "Untitled session");
        return { title, entityType: null, revealed: session.revealedToPlayers };
      }
      case "quest": {
        const quest = this.getQuest(recordId);
        return quest ? { title: quest.title, entityType: null, revealed: quest.revealedToPlayers } : null;
      }
      case "journal": {
        const entry = this.getEntry(recordId);
        if (!entry) return null;
        // Player text for both audiences: this is a row title, and the GM can open the record for the rest.
        return { title: entry.playerText.trim().slice(0, 80) || "Journal entry", entityType: null, revealed: entry.revealedToPlayers };
      }
    }
  }

  /** A connection edit touches both pages' recency but not `rev`, so open editors do not conflict. */
  private touchPages(pageIds: readonly string[], stamp: string) {
    const update = this.requireDatabase().prepare("UPDATE codex_pages SET updated_at = ? WHERE id = ?");
    for (const pageId of pageIds) update.run(stamp, pageId);
  }

  private toRel(row: RelationshipRowRaw): CodexRelationshipRow {
    return { id: row.id, fromPageId: row.from_page_id, toPageId: row.to_page_id, label: row.type === "" ? null : row.type, layer: row.layer === "gm" ? "gm" : "player", createdAt: row.created_at };
  }


  // Codex-wide settings

  /** Settings plus history cost. The cost scan lives here, not in `revisionSettings`, which runs on every save. */
  getSettings(): CodexSettings {
    return { revisionHistory: { ...this.revisionSettings(), ...this.revisionHistoryUsage() }, autosave: this.autosaveSettings() };
  }

  /** Approximate: summed `LENGTH()` (characters) of the content columns a revision copies. */
  private revisionHistoryUsage(): CodexRevisionHistoryUsage {
    const row = this.requireDatabase().prepare(
      `SELECT COUNT(*) AS version_count,
              COALESCE(SUM(LENGTH(title) + LENGTH(player_body) + LENGTH(gm_body) + LENGTH(fields_json) + LENGTH(gm_fields_json) + LENGTH(tags_json)), 0) AS version_bytes
       FROM codex_page_revisions`
    ).get() as { version_count: number; version_bytes: number } | undefined;
    return { versionCount: row?.version_count ?? 0, versionBytes: row?.version_bytes ?? 0 };
  }

  /**
   * Read on every save. Re-validated because an out-of-range stored value makes `node:sqlite` throw for the whole
   * row; bad values fall back to defaults, and `enabled` fails open so history is never silently stopped.
   */
  private revisionSettings(): CodexRevisionSettings {
    let row: { revision_history_enabled: number; revision_window_minutes: number } | undefined;
    try {
      row = this.requireDatabase().prepare("SELECT revision_history_enabled, revision_window_minutes FROM codex_meta WHERE id = 1")
        .get() as { revision_history_enabled: number; revision_window_minutes: number } | undefined;
    } catch { return DEFAULT_REVISION_SETTINGS; }
    if (!row) return DEFAULT_REVISION_SETTINGS;
    const stored = row.revision_window_minutes;
    const inRange = Number.isSafeInteger(stored) && stored >= MIN_REVISION_WINDOW_MINUTES && stored <= MAX_REVISION_WINDOW_MINUTES;
    return {
      enabled: row.revision_history_enabled === 0 || row.revision_history_enabled === 1
        ? row.revision_history_enabled === 1
        : DEFAULT_REVISION_SETTINGS.enabled,
      windowMinutes: inRange ? stored : DEFAULT_REVISION_SETTINGS.windowMinutes
    };
  }

  /** Same discipline as `revisionSettings`; `enabled` fails open so editors never silently stop saving. */
  private autosaveSettings(): CodexAutosaveSettings {
    let row: { autosave_enabled: number; autosave_interval_seconds: number } | undefined;
    try {
      row = this.requireDatabase().prepare("SELECT autosave_enabled, autosave_interval_seconds FROM codex_meta WHERE id = 1")
        .get() as { autosave_enabled: number; autosave_interval_seconds: number } | undefined;
    } catch { return DEFAULT_AUTOSAVE_SETTINGS; }
    if (!row) return DEFAULT_AUTOSAVE_SETTINGS;
    const stored = row.autosave_interval_seconds;
    const inRange = Number.isSafeInteger(stored) && stored >= MIN_AUTOSAVE_INTERVAL_SECONDS && stored <= MAX_AUTOSAVE_INTERVAL_SECONDS;
    return {
      enabled: row.autosave_enabled === 0 || row.autosave_enabled === 1 ? row.autosave_enabled === 1 : DEFAULT_AUTOSAVE_SETTINGS.enabled,
      intervalSeconds: inRange ? stored : DEFAULT_AUTOSAVE_SETTINGS.intervalSeconds
    };
  }

  /** Returns the stored read shape so clamped values come back as stored. */
  setSettings(input: CodexSettingsInput): CodexSettings {
    const database = this.requireDatabase();
    // Normalized before the transaction opens, since both helpers throw. `enabled` must be a real boolean:
    // coercing a missing field to `false` would silently switch undo history off.
    const enabled = input?.revisionHistory?.enabled;
    if (typeof enabled !== "boolean") throw new CodexValidationError("Revision history must be switched on or off explicitly.");
    const windowMinutes = revisionWindowMinutes(input?.revisionHistory?.windowMinutes);
    // Same rule for autosave: a coerced missing field would switch autosave off.
    const autosaveEnabled = input?.autosave?.enabled;
    if (typeof autosaveEnabled !== "boolean") throw new CodexValidationError("Autosave must be switched on or off explicitly.");
    const intervalSeconds = autosaveIntervalSeconds(input?.autosave?.intervalSeconds);
    this.transaction(() => {
      database.prepare("UPDATE codex_meta SET revision_history_enabled = ?, revision_window_minutes = ?, autosave_enabled = ?, autosave_interval_seconds = ? WHERE id = 1")
        .run(enabled ? 1 : 0, windowMinutes, autosaveEnabled ? 1 : 0, intervalSeconds);
      this.bumpRevision();
    });
    return this.getSettings();
  }

  /**
   * Delete revisions authored more than `olderThanDays` ago (`<=`, so 0 deletes all). Rejects bad input since this
   * is destructive. Works with history disabled; touches only `codex_page_revisions`.
   */
  deleteRevisionsOlderThan(olderThanDays: number): number {
    const database = this.requireDatabase();
    if (!Number.isInteger(olderThanDays) || olderThanDays < 0 || olderThanDays > MAX_PRUNE_DAYS) {
      throw new CodexValidationError(`Choose a whole number of days from 0 to ${MAX_PRUNE_DAYS}.`);
    }
    const cutoff = new Date(this.now() - olderThanDays * 86_400_000).toISOString();
    let deleted = 0;
    this.transaction(() => {
      deleted = database.prepare("DELETE FROM codex_page_revisions WHERE authored_at <= ?").run(cutoff).changes as number;
      this.bumpRevision();
    });
    return deleted;
  }

  // Revisions

  listRevisions(pageId: string): CodexPageRevisionRow[] {
    return (this.requireDatabase()
      .prepare(`SELECT ${REVISION_COLUMNS} FROM codex_page_revisions WHERE page_id = ? ORDER BY rev DESC`)
      .all(pageId) as RevisionRowRaw[])
      .map(toRevision);
  }

  /** All revisions for the backup, including the columns `restoreRevision` needs that the per-page wire row omits. */
  listAllRevisions(): CodexPageRevisionExportRow[] {
    return (this.requireDatabase()
      .prepare(`SELECT ${REVISION_COLUMNS}, entity_type, fields_json, gm_fields_json FROM codex_page_revisions ORDER BY page_id, rev`)
      .all() as Array<RevisionRowRaw & { entity_type: string; fields_json: string; gm_fields_json: string }>)
      .map((row) => ({ ...toRevision(row), entityType: (row.entity_type as CodexEntityType) ?? "note", fields: parseFields(row.fields_json), gmFields: parseFields(row.gm_fields_json) }));
  }

  /** Writes a past revision forward as a new save. The in-world date is not restored, so chronicle placement stays. */
  restoreRevision(pageId: string, revisionId: number, authorTag: string): CodexPageRow {
    const snap = this.requireDatabase().prepare("SELECT title, entity_type, fields_json, gm_fields_json, player_body, gm_body, banner_asset_id, tags_json FROM codex_page_revisions WHERE id = ? AND page_id = ?").get(revisionId, pageId) as { title: string; entity_type: string; fields_json: string; gm_fields_json: string; player_body: string; gm_body: string; banner_asset_id: string | null; tags_json: string } | undefined;
    if (!snap) throw new CodexNotFoundError("That revision no longer exists.");
    // Force a checkpoint of the state being discarded, so a mistaken restore can be undone.
    return this.updatePage(pageId, { title: snap.title, entityType: snap.entity_type as CodexEntityType, fields: parseFields(snap.fields_json), gmFields: parseFields(snap.gm_fields_json), playerBody: snap.player_body, gmBody: snap.gm_body, bannerAssetId: snap.banner_asset_id, tags: JSON.parse(snap.tags_json) as string[] }, undefined, authorTag, true);
  }

  // Search

  /**
   * Search one audience's index. The player index holds only player-layer text, and `PLAYER_VISIBLE_SQL` checks
   * live reveal state (`projectPlayerSearchHit` re-checks), so reveals need no reindex.
   */
  searchAll(audience: "player" | "gm", query: string, kinds?: readonly CodexRecordKind[]): CodexSearchResult {
    const match = ftsQuery(query);
    if (!match) return { hits: [], truncated: false };
    // Never "" here (`ftsQuery` requires a letter or digit), so empty-titled rows cannot match tier 1.
    const exactTitle = query.trim().toLowerCase();
    const table = audience === "gm" ? "codex_search_gm" : "codex_search_player";
    const kindFilter = kinds && kinds.length > 0 ? ` AND ${table}.kind IN (${kinds.map(() => "?").join(", ")})` : "";
    const visibility = audience === "gm" ? "" : ` AND ${PLAYER_VISIBLE_SQL}`;
    // Fetch one past the cap: the extra row signals truncation.
    const sql = `SELECT kind, record_id FROM ${table} WHERE ${table} MATCH ?${kindFilter}${visibility} ORDER BY ${searchOrderBySql(table)} LIMIT ${SEARCH_LIMIT + 1}`;
    try {
      // Bind order follows the ?s in SQL text order: MATCH, the kind filter, then the ORDER BY title.
      const rows = (this.requireDatabase().prepare(sql).all(match, ...(kinds ?? []), exactTitle) as Array<{ kind: string; record_id: string }>)
        .filter((row): row is { kind: CodexRecordKind; record_id: string } => (CODEX_RECORD_KINDS as readonly string[]).includes(row.kind));
      // Measured before the slice: the extra probe row means more matches exist.
      return { hits: rows.slice(0, SEARCH_LIMIT).map((row) => ({ kind: row.kind, id: row.record_id })), truncated: rows.length > SEARCH_LIMIT };
    } catch { return { hits: [], truncated: false } }
  }

  /** Pages-only view of the same index. */
  searchPages(audience: "player" | "gm", query: string): Array<{ pageId: string }> {
    return this.searchAll(audience, query, ["page"]).hits.map((hit) => ({ pageId: hit.id }));
  }

  // Maps (the atlas tree)

  createMap(input: CodexMapCreateInput): CodexMapRow {
    const database = this.requireDatabase();
    const mapId = this.freshId();
    const stamp = this.stamp();
    const parent = optionalId(input.parentMapId);
    if (parent && !this.mapRowRaw(parent)) throw new CodexNotFoundError("The parent map no longer exists.");
    const sortKey = ((database.prepare("SELECT MAX(sort_key) AS m FROM codex_maps").get() as { m: number | null }).m ?? 0) + 1;
    const name = mapName(input.name);
    const tagsJson = JSON.stringify(tags(input.tags));
    this.transaction(() => {
      database.prepare("INSERT INTO codex_maps (id, asset_id, name, kind, parent_map_id, revealed, sort_key, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(mapId, id(input.assetId), name, mapKind(input.kind), parent, input.revealedToPlayers ? 1 : 0, sortKey, tagsJson, stamp, stamp);
      this.indexMap(mapId, name, tagsJson);
      this.bumpRevision();
    });
    return this.getMap(mapId)!;
  }

  updateMap(mapId: string, input: Readonly<{ name?: string; kind?: CodexMapKind; tags?: readonly string[] }>): CodexMapRow {
    const database = this.requireDatabase();
    const existing = this.mapRowRaw(mapId);
    if (!existing) throw new CodexNotFoundError("That map no longer exists.");
    const name = input.name === undefined ? existing.name : mapName(input.name);
    const kind = input.kind === undefined ? existing.kind : mapKind(input.kind);
    const tagsJson = input.tags === undefined ? existing.tags_json : JSON.stringify(tags(input.tags));
    this.transaction(() => {
      database.prepare("UPDATE codex_maps SET name = ?, kind = ?, tags_json = ?, updated_at = ? WHERE id = ?").run(name, kind, tagsJson, this.stamp(), mapId);
      this.indexMap(mapId, name, tagsJson);
      this.bumpRevision();
    });
    return this.getMap(mapId)!;
  }

  /** Re-parent a map in the tree, rejecting self-parenting and cycles (world → region → city stays acyclic). */
  setMapParent(mapId: string, parentMapId: string | null): CodexMapRow {
    const database = this.requireDatabase();
    if (!this.mapRowRaw(mapId)) throw new CodexNotFoundError("That map no longer exists.");
    const parent = optionalId(parentMapId);
    if (parent !== null) {
      if (parent === mapId) throw new CodexValidationError("A map cannot be its own parent.");
      let cursor: string | null = parent;
      const seen = new Set<string>([mapId]);
      while (cursor !== null) {
        if (seen.has(cursor)) throw new CodexValidationError("That would create a loop in the map tree.");
        seen.add(cursor);
        const row: MapRowRaw | undefined = this.mapRowRaw(cursor);
        if (!row) throw new CodexNotFoundError("The parent map no longer exists.");
        cursor = row.parent_map_id;
      }
    }
    this.transaction(() => {
      database.prepare("UPDATE codex_maps SET parent_map_id = ?, updated_at = ? WHERE id = ?").run(parent, this.stamp(), mapId);
      this.bumpRevision();
    });
    return this.getMap(mapId)!;
  }

  setMapRevealed(mapId: string, revealed: boolean): CodexMapRow {
    const database = this.requireDatabase();
    if (!this.mapRowRaw(mapId)) throw new CodexNotFoundError("That map no longer exists.");
    this.transaction(() => {
      database.prepare("UPDATE codex_maps SET revealed = ?, updated_at = ? WHERE id = ?").run(revealed ? 1 : 0, this.stamp(), mapId);
      this.bumpRevision();
    });
    return this.getMap(mapId)!;
  }

  deleteMap(mapId: string): void {
    const database = this.requireDatabase();
    if (!ID.test(mapId)) return;
    this.transaction(() => {
      // Markers on other maps that drilled into this one become label-only rather than dangling.
      database.prepare("UPDATE codex_markers SET sub_map_id = NULL, updated_at = ? WHERE sub_map_id = ?").run(this.stamp(), mapId);
      // Journal pins to this map's own (about-to-cascade) markers are released first, so they don't dangle.
      database.prepare("UPDATE codex_journal SET attach_marker_id = NULL, updated_at = ? WHERE attach_marker_id IN (SELECT id FROM codex_markers WHERE map_id = ?)").run(this.stamp(), mapId);
      // Cascaded markers' search rows must be removed explicitly, or they would keep matching with no live row.
      for (const row of database.prepare("SELECT id FROM codex_markers WHERE map_id = ?").all(mapId) as Array<{ id: string }>) this.unindex("marker", row.id);
      this.unindex("map", mapId);
      // Own markers cascade; child maps' parent_map_id is set null by the FK.
      database.prepare("DELETE FROM codex_maps WHERE id = ?").run(mapId);
      this.bumpRevision();
    });
  }

  getMap(mapId: string): CodexMapRow | null {
    const row = this.mapRowRaw(mapId);
    return row ? this.toMap(row) : null;
  }

  listMaps(): CodexMapRow[] {
    return (this.requireDatabase().prepare(`SELECT ${MAP_COLUMNS} FROM codex_maps ORDER BY sort_key, name COLLATE NOCASE`).all() as MapRowRaw[]).map((row) => this.toMap(row));
  }

  // Markers

  createMarker(mapId: string, input: CodexMarkerCreateInput): CodexMarkerRow {
    const database = this.requireDatabase();
    if (!this.mapRowRaw(mapId)) throw new CodexNotFoundError("That map no longer exists.");
    const markerId = this.freshId();
    const stamp = this.stamp();
    const label = markerLabel(input.label);
    const tagsJson = JSON.stringify(tags(input.tags));
    this.transaction(() => {
      database.prepare("INSERT INTO codex_markers (id, map_id, x, y, icon_id, icon_color, label, revealed, page_ids_json, sub_map_id, scene_ids_json, actor_id, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(markerId, mapId, coord(input.x), coord(input.y), iconId(input.iconId), hexColor(input.iconColor), label, input.revealedToPlayers ? 1 : 0,
          JSON.stringify(idArray(input.pageIds)), optionalId(input.subMapId), JSON.stringify(idArray(input.sceneIds)), optionalId(input.actorId), tagsJson, stamp, stamp);
      this.indexMarker(markerId, label, tagsJson);
      this.bumpRevision();
    });
    return this.getMarker(markerId)!;
  }

  updateMarker(markerId: string, input: CodexMarkerUpdateInput): CodexMarkerRow {
    const database = this.requireDatabase();
    const existing = this.markerRowRaw(markerId);
    if (!existing) throw new CodexNotFoundError("That marker no longer exists.");
    const merged = {
      x: input.x === undefined ? existing.x : coord(input.x),
      y: input.y === undefined ? existing.y : coord(input.y),
      icon_id: input.iconId === undefined ? existing.icon_id : iconId(input.iconId),
      icon_color: input.iconColor === undefined ? existing.icon_color : hexColor(input.iconColor),
      label: input.label === undefined ? existing.label : markerLabel(input.label),
      revealed: input.revealedToPlayers === undefined ? existing.revealed : (input.revealedToPlayers ? 1 : 0),
      page_ids_json: input.pageIds === undefined ? existing.page_ids_json ?? "[]" : JSON.stringify(idArray(input.pageIds)),
      sub_map_id: input.subMapId === undefined ? existing.sub_map_id : optionalId(input.subMapId),
      scene_ids_json: input.sceneIds === undefined ? existing.scene_ids_json ?? "[]" : JSON.stringify(idArray(input.sceneIds)),
      actor_id: input.actorId === undefined ? existing.actor_id : optionalId(input.actorId),
      tags_json: input.tags === undefined ? existing.tags_json : JSON.stringify(tags(input.tags))
    };
    this.transaction(() => {
      database.prepare("UPDATE codex_markers SET x = ?, y = ?, icon_id = ?, icon_color = ?, label = ?, revealed = ?, page_ids_json = ?, sub_map_id = ?, scene_ids_json = ?, actor_id = ?, tags_json = ?, updated_at = ? WHERE id = ?")
        .run(merged.x, merged.y, merged.icon_id, merged.icon_color, merged.label, merged.revealed, merged.page_ids_json, merged.sub_map_id, merged.scene_ids_json, merged.actor_id, merged.tags_json, this.stamp(), markerId);
      this.indexMarker(markerId, merged.label, merged.tags_json);
      this.bumpRevision();
    });
    return this.getMarker(markerId)!;
  }

  /** The drag path: position only, server-validated. */
  moveMarker(markerId: string, x: number, y: number): CodexMarkerRow {
    const database = this.requireDatabase();
    if (!this.markerRowRaw(markerId)) throw new CodexNotFoundError("That marker no longer exists.");
    this.transaction(() => {
      database.prepare("UPDATE codex_markers SET x = ?, y = ?, updated_at = ? WHERE id = ?").run(coord(x), coord(y), this.stamp(), markerId);
      this.bumpRevision();
    });
    return this.getMarker(markerId)!;
  }

  setMarkerRevealed(markerId: string, revealed: boolean): CodexMarkerRow {
    const database = this.requireDatabase();
    if (!this.markerRowRaw(markerId)) throw new CodexNotFoundError("That marker no longer exists.");
    this.transaction(() => {
      database.prepare("UPDATE codex_markers SET revealed = ?, updated_at = ? WHERE id = ?").run(revealed ? 1 : 0, this.stamp(), markerId);
      this.bumpRevision();
    });
    return this.getMarker(markerId)!;
  }

  deleteMarker(markerId: string): void {
    if (!ID.test(markerId)) return;
    this.transaction(() => {
      const database = this.requireDatabase();
      // Journal pins to this marker become label-only rather than dangling.
      database.prepare("UPDATE codex_journal SET attach_marker_id = NULL, updated_at = ? WHERE attach_marker_id = ?").run(this.stamp(), markerId);
      this.unindex("marker", markerId);
      database.prepare("DELETE FROM codex_markers WHERE id = ?").run(markerId);
      this.bumpRevision();
    });
  }

  getMarker(markerId: string): CodexMarkerRow | null {
    const row = this.markerRowRaw(markerId);
    return row ? this.toMarker(row) : null;
  }

  listMarkers(mapId: string): CodexMarkerRow[] {
    if (!ID.test(mapId)) return [];
    return (this.requireDatabase().prepare(`SELECT ${MARKER_COLUMNS} FROM codex_markers WHERE map_id = ? ORDER BY created_at`).all(mapId) as MarkerRowRaw[]).map((row) => this.toMarker(row));
  }

  /** Pins linking this page. Ungated: `projectPlayerPageMarker` is the only gate. */
  markersForPage(pageId: string): CodexMarkerRow[] {
    if (!ID.test(pageId)) return [];
    return (this.requireDatabase().prepare(
      `SELECT ${MARKER_COLUMNS} FROM codex_markers WHERE EXISTS (SELECT 1 FROM json_each(codex_markers.page_ids_json) WHERE value = ?) ORDER BY created_at`
    ).all(pageId) as MarkerRowRaw[]).map((row) => this.toMarker(row));
  }

  /** Whether any revealed codex map uses this image asset - lets players fetch a revealed world map's image. */
  isAssetRevealedToPlayers(assetId: string): boolean {
    if (!ID.test(assetId)) return false;
    return this.requireDatabase().prepare("SELECT 1 FROM codex_maps WHERE asset_id = ? AND revealed = 1 LIMIT 1").get(assetId) !== undefined;
  }

  /**
   * Whether a player may load this uploaded image: it is a revealed page's banner, or it appears in the
   * player-facing text of a revealed page, quest, session recap or journal entry (downtime included).
   */
  isMediaVisibleToPlayers(assetId: string): boolean {
    if (!ID.test(assetId)) return false;
    return this.requireDatabase().prepare(`
      SELECT 1 FROM codex_pages WHERE revealed = 1 AND (banner_asset_id = :id OR player_body LIKE :pattern)
      UNION ALL SELECT 1 FROM codex_quests WHERE revealed = 1 AND player_body LIKE :pattern
      UNION ALL SELECT 1 FROM codex_sessions WHERE revealed = 1 AND recap_body LIKE :pattern
      UNION ALL SELECT 1 FROM codex_journal WHERE revealed = 1 AND player_text LIKE :pattern
      LIMIT 1`).get({ id: assetId, pattern: `%${assetId}%` }) !== undefined;
  }

  /** The location marker linked to a prepared scene, if any - the combat-history bridge pins fights here. */
  markerForScene(sceneId: string): CodexMarkerRow | null {
    if (!ID.test(sceneId)) return null;
    const row = this.requireDatabase().prepare(`SELECT ${MARKER_COLUMNS} FROM codex_markers WHERE EXISTS (SELECT 1 FROM json_each(codex_markers.scene_ids_json) WHERE value = ?) ORDER BY updated_at DESC, created_at DESC LIMIT 1`).get(sceneId) as MarkerRowRaw | undefined;
    return row ? this.toMarker(row) : null;
  }

  /**
   * Set the party pin atlas-wide (`null` clears); a new pin replaces the old. Clears before setting (the partial
   * unique index requires it). Reveal state is untouched: `isParty` is in no visibility predicate.
   */
  setPartyMarker(markerId: string | null): CodexMarkerRow | null {
    const database = this.requireDatabase();
    if (markerId !== null && !this.markerRowRaw(markerId)) throw new CodexNotFoundError("That marker no longer exists.");
    this.transaction(() => {
      // Clear first: with the partial unique index, setting first fails.
      database.prepare("UPDATE codex_markers SET is_party = 0 WHERE is_party = 1").run();
      if (markerId !== null) database.prepare("UPDATE codex_markers SET is_party = 1 WHERE id = ?").run(markerId);
      this.bumpRevision();
    });
    return markerId === null ? null : this.getMarker(markerId);
  }

  /** Ungated GM-grade row; `projectPlayerMarker` is the gate. */
  partyMarker(): CodexMarkerRow | null {
    const row = this.requireDatabase().prepare(`SELECT ${MARKER_COLUMNS} FROM codex_markers WHERE is_party = 1 LIMIT 1`).get() as MarkerRowRaw | undefined;
    return row ? this.toMarker(row) : null;
  }

  // Calendar

  getCalendar(): CodexCalendar {
    const row = this.requireDatabase().prepare("SELECT calendar_json FROM codex_meta WHERE id = 1").get() as { calendar_json: string | null } | undefined;
    if (!row?.calendar_json) return DEFAULT_CALENDAR;
    try { return normalizeCalendar(JSON.parse(row.calendar_json) as CodexCalendar); } catch { return DEFAULT_CALENDAR; }
  }

  /**
   * Replace the calendar and recompute every dated record's instant and label from its raw date, in one
   * transaction. Pages are selected by having a date, not by type, so a later type change finds them current.
   */
  setCalendar(input: CodexCalendar): CodexCalendar {
    const calendar = normalizeCalendar(input);
    this.transaction(() => this.writeCalendar(calendar));
    return calendar;
  }

  /** Leaf write: must be inside `this.transaction` (it does not nest), so `applyDowntime` can compose it. */
  private writeCalendar(calendar: CodexCalendar): void {
    const database = this.requireDatabase();
    database.prepare("UPDATE codex_meta SET calendar_json = ? WHERE id = 1").run(JSON.stringify(calendar));
    for (const table of ["codex_journal", "codex_pages"] as const) {
      const dated = database.prepare(`SELECT id, in_world_year AS year, in_world_month AS month, in_world_day AS day FROM ${table} WHERE in_world_year IS NOT NULL`).all() as Array<{ id: string; year: number; month: number; day: number }>;
      const update = database.prepare(`UPDATE ${table} SET calendar_instant = ?, in_world_label = ? WHERE id = ?`);
      for (const row of dated) { const date = { year: row.year, month: row.month, day: row.day }; update.run(calendarInstantOf(calendar, date), formatInWorldDate(calendar, date), row.id); }
    }
    // The first date on an empty Codex publishes itself; in a running campaign, setting the GM date never publishes.
    if (calendar.currentDate && this.getPublishedDate() === null && this.isUnusedCodex()) this.writePublishedDate(calendar.currentDate);
    this.bumpRevision();
  }

  /** No authored records yet (derived tables do not count); scopes the auto-publish above. */
  private isUnusedCodex(): boolean {
    const database = this.requireDatabase();
    const clauses = ["codex_pages", "codex_journal", "codex_maps", "codex_markers", "codex_quests", "codex_sessions", "codex_standing", "codex_relationships", "codex_folders"]
      .map((table) => `EXISTS(SELECT 1 FROM ${table})`).join(" OR ");
    const row = database.prepare(`SELECT (${clauses}) AS used`).get() as { used: number } | undefined;
    return !row?.used;
  }

  /** The players' clock; moves only on publish. All three parts or none. */
  getPublishedDate(): CodexInWorldDate | null {
    // A stored value beyond 2^53-1 makes `node:sqlite` throw; treat it as "nothing published" so export still works.
    let row: { published_year: number | null; published_month: number | null; published_day: number | null } | undefined;
    try {
      row = this.requireDatabase().prepare("SELECT published_year, published_month, published_day FROM codex_meta WHERE id = 1")
        .get() as { published_year: number | null; published_month: number | null; published_day: number | null } | undefined;
    } catch { return null; }
    if (!row || row.published_year === null || row.published_month === null || row.published_day === null) return null;
    if (![row.published_year, row.published_month, row.published_day].every((part) => Number.isSafeInteger(part))) return null;
    return { year: row.published_year, month: row.published_month, day: row.published_day };
  }

  /** Copy the GM's clock to the players' (clears it if the GM clock is unset). The only thing that publishes. */
  publishCampaignDate(): CodexCalendar {
    const calendar = this.getCalendar();
    this.transaction(() => {
      this.writePublishedDate(calendar.currentDate ?? null);
      this.bumpRevision();
    });
    return calendar;
  }

  /** Leaf write: must be inside a transaction. `null` clears. */
  private writePublishedDate(date: CodexInWorldDate | null): void {
    this.requireDatabase().prepare("UPDATE codex_meta SET published_year = ?, published_month = ?, published_day = ? WHERE id = 1")
      .run(date ? date.year : null, date ? date.month : null, date ? date.day : null);
  }

  /** The GM's clock. Never pass this to a player projection; use `publishedInstant()`. */
  campaignInstant(): number | null {
    const calendar = this.getCalendar();
    return calendar.currentDate ? calendarInstantOf(calendar, calendar.currentDate) : null;
  }

  /** The published date as a sortable instant, or null: the only clock a player-facing reader may use. */
  publishedInstant(): number | null {
    const date = this.getPublishedDate();
    return date ? calendarInstantOf(this.getCalendar(), date) : null;
  }

  /** Convert a stored instant back to calendar date parts, for re-editing a dated entry. */
  dateForInstant(instant: number): CodexInWorldDate {
    const calendar = this.getCalendar();
    const perYear = calendarDaysPerYear(calendar);
    const year = Math.floor(instant / perYear);
    let remainder = instant - year * perYear;
    let month = 0;
    while (month < calendar.months.length - 1 && remainder >= calendar.months[month].days) { remainder -= calendar.months[month].days; month += 1; }
    return { year, month, day: remainder + 1 };
  }

  /** A structured date wins (instant, label, raw date); else a free-text label with no instant. Pages pass no label. */
  private resolveDate(date: CodexInWorldDate | null | undefined, label: string | null | undefined): { instant: number | null; label: string | null; date: CodexInWorldDate | null } {
    if (date && Number.isFinite(date.year) && Number.isFinite(date.month) && Number.isFinite(date.day)) {
      const calendar = this.getCalendar();
      const normalized = { year: Math.trunc(date.year), month: Math.trunc(date.month), day: Math.trunc(date.day) };
      return { instant: calendarInstantOf(calendar, normalized), label: formatInWorldDate(calendar, normalized), date: normalized };
    }
    return { instant: null, label: shortLabel(label, 120, "in-world date"), date: null };
  }

  // Journal / timeline

  /** `sessionId` omitted files under the active session; `null` files under none. */
  createEntry(input: CodexJournalCreateInput): CodexJournalRow {
    const dated = this.resolveDate(input.inWorldDate, input.inWorldLabel);
    return this.insertEntry({
      playerText: entryText(input.playerText), gmText: entryGmText(input.gmText), revealed: input.revealedToPlayers ? 1 : 0,
      attachMarkerId: optionalId(input.attachMarkerId), attachPageId: optionalId(input.attachPageId), kind: "note",
      sourceEncounterId: null, sessionId: this.resolveEntrySession(input.sessionId), realDate: shortLabel(input.realDate, 40, "date"),
      inWorldLabel: dated.label, calendarInstant: dated.instant, inWorldDate: dated.date, tags: input.tags, payload: null
    });
  }

  /** A logged encounter becomes a timeline entry, dated at the GM's clock and filed under the active session. */
  appendCombatEntry(input: CodexCombatEntryInput): CodexJournalRow {
    const dated = this.resolveDate(this.getCalendar().currentDate ?? null, null);
    return this.insertEntry({
      playerText: entryText(input.playerText), gmText: entryGmText(input.gmText), revealed: input.revealedToPlayers ? 1 : 0,
      attachMarkerId: optionalId(input.attachMarkerId), attachPageId: optionalId(input.attachPageId), kind: "combat",
      sourceEncounterId: input.sourceEncounterId, sessionId: this.activeSessionId, realDate: null,
      inWorldLabel: dated.label, calendarInstant: dated.instant, inWorldDate: dated.date, payload: null
    });
  }

  /** Requires a structured date (a label cannot be compared to a clock); no payload; `fired` is derived. */
  createDeadline(input: CodexJournalCreateInput): CodexJournalRow {
    const dated = this.resolveDate(input.inWorldDate, input.inWorldLabel);
    if (!dated.date) throw new CodexValidationError("A deadline needs an in-world date - the date is when it fires.");
    return this.insertEntry({
      playerText: entryText(input.playerText), gmText: entryGmText(input.gmText), revealed: input.revealedToPlayers ? 1 : 0,
      attachMarkerId: optionalId(input.attachMarkerId), attachPageId: optionalId(input.attachPageId), kind: "deadline",
      sourceEncounterId: null, sessionId: this.resolveEntrySession(input.sessionId),
      realDate: shortLabel(input.realDate, 40, "date"),
      inWorldLabel: dated.label, calendarInstant: dated.instant, inWorldDate: dated.date, tags: input.tags, payload: null
    });
  }

  /** Never moves the clock (`applyDowntime` does). Dated at the GM's clock unless given. */
  createDowntime(input: CodexDowntimeCreateInput): CodexJournalRow {
    const payload = downtimePayload(input.downtime);
    // An id must name a live page, or the tracker would show a dead link. The page type is not checked
    // (NPCs and hirelings may have downtime).
    if (payload.characterPageId !== null && !this.pageRow(payload.characterPageId)) throw new CodexNotFoundError("That page no longer exists.");
    const dated = this.resolveDate(input.inWorldDate ?? this.getCalendar().currentDate ?? null, input.inWorldLabel);
    return this.insertEntry({
      playerText: entryText(input.playerText), gmText: entryGmText(input.gmText), revealed: input.revealedToPlayers ? 1 : 0,
      attachMarkerId: optionalId(input.attachMarkerId), attachPageId: optionalId(input.attachPageId), kind: "downtime",
      sourceEncounterId: null, sessionId: this.resolveEntrySession(input.sessionId),
      realDate: shortLabel(input.realDate, 40, "date"),
      inWorldLabel: dated.label, calendarInstant: dated.instant, inWorldDate: dated.date, tags: input.tags, payload
    });
  }

  /** A journal entry, not a table: the timeline already orders level history. */
  createMilestone(input: CodexMilestoneCreateInput): CodexJournalRow {
    const payload = milestonePayload(input.milestone);
    const dated = this.resolveDate(input.inWorldDate ?? this.getCalendar().currentDate ?? null, input.inWorldLabel);
    return this.insertEntry({
      playerText: entryText(input.playerText), gmText: entryGmText(input.gmText), revealed: input.revealedToPlayers ? 1 : 0,
      attachMarkerId: optionalId(input.attachMarkerId), attachPageId: optionalId(input.attachPageId), kind: "milestone",
      sourceEncounterId: null, sessionId: this.resolveEntrySession(input.sessionId),
      realDate: shortLabel(input.realDate, 40, "date"),
      inWorldLabel: dated.label, calendarInstant: dated.instant, inWorldDate: dated.date, tags: input.tags, payload
    });
  }

  /** Where `applyDowntime` would move the clock, so the GM confirms a date. Null if not applicable. */
  proposedDateFor(entry: CodexJournalRow): CodexInWorldDate | null {
    // `downtimePayloadOf` narrows by kind, so another kind's payload is never read as downtime.
    const payload = downtimePayloadOf(entry);
    if (!payload || payload.applied) return null;
    const from = this.campaignInstant();
    return from === null ? null : this.dateForInstant(from + payload.days);
  }

  /** Mark applied and move the GM clock in one transaction, without publishing. A second apply is a 409. */
  applyDowntime(entryId: string): Readonly<{ entry: CodexJournalRow; calendar: CodexCalendar }> {
    const database = this.requireDatabase();
    const existing = this.getEntry(entryId);
    if (!existing) throw new CodexNotFoundError("That journal entry no longer exists.");
    if (existing.kind !== "downtime") throw new CodexValidationError("Only a downtime record can pass time.");
    const payload = downtimePayloadOf(existing);
    if (!payload) throw new CodexValidationError("That downtime record has no activity to apply.");
    if (payload.applied) throw new CodexRevisionConflictError("That downtime has already passed - the clock has already moved.");
    const target = this.proposedDateFor(existing);
    if (!target) throw new CodexValidationError("Set the campaign's current date before passing time.");
    const calendar = this.getCalendar();
    const applied: CodexDowntimePayload = { ...payload, applied: true };
    this.transaction(() => {
      database.prepare("UPDATE codex_journal SET payload_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(applied), this.stamp(), entryId);
      // Same transaction: `writeCalendar` never opens one and bumps the revision for both writes.
      this.writeCalendar(normalizeCalendar({ ...calendar, currentDate: target }));
    });
    return { entry: this.getEntry(entryId)!, calendar: this.getCalendar() };
  }

  updateEntry(entryId: string, input: CodexJournalUpdateInput): CodexJournalRow {
    const database = this.requireDatabase();
    const existing = this.journalRowRaw(entryId);
    if (!existing) throw new CodexNotFoundError("That journal entry no longer exists.");
    // A structured date (or a changed free-text label) recomputes the sort instant + display label together.
    const dated = (input.inWorldDate !== undefined || input.inWorldLabel !== undefined) ? this.resolveDate(input.inWorldDate ?? null, input.inWorldLabel) : null;
    // A deadline's date cannot be cleared: without one it could never fire. Rejected rather than ignored
    // so the GM learns the field is required.
    if (existing.kind === "deadline" && dated && dated.instant === null) {
      throw new CodexValidationError("A deadline needs an in-world date - that is what makes it a deadline. Change its date, or delete it and write a note instead.");
    }
    const next = {
      player_text: input.playerText === undefined ? existing.player_text : entryText(input.playerText),
      gm_text: input.gmText === undefined ? existing.gm_text : entryGmText(input.gmText),
      attach_marker_id: input.attachMarkerId === undefined ? existing.attach_marker_id : optionalId(input.attachMarkerId),
      attach_page_id: input.attachPageId === undefined ? existing.attach_page_id : optionalId(input.attachPageId),
      // Omitted `sessionId` keeps the filing, `null` unfiles, and an id must name a live session. Unlike
      // create, an edit never auto-files under the active session.
      session_id: input.sessionId === undefined ? existing.session_id : (input.sessionId === null ? null : this.requireSession(input.sessionId)),
      real_date: input.realDate === undefined ? existing.real_date : shortLabel(input.realDate, 40, "date"),
      in_world_label: dated ? dated.label : existing.in_world_label,
      calendar_instant: dated ? dated.instant : existing.calendar_instant,
      in_world_year: dated ? (dated.date ? dated.date.year : null) : existing.in_world_year,
      in_world_month: dated ? (dated.date ? dated.date.month : null) : existing.in_world_month,
      in_world_day: dated ? (dated.date ? dated.date.day : null) : existing.in_world_day,
      tags_json: input.tags === undefined ? existing.tags_json : JSON.stringify(tags(input.tags)),
      payload_json: this.editedDowntimePayload(existing, input.downtime)
    };
    this.transaction(() => {
      database.prepare("UPDATE codex_journal SET player_text = ?, gm_text = ?, attach_marker_id = ?, attach_page_id = ?, session_id = ?, real_date = ?, in_world_label = ?, calendar_instant = ?, in_world_year = ?, in_world_month = ?, in_world_day = ?, tags_json = ?, payload_json = ?, updated_at = ? WHERE id = ?")
        .run(next.player_text, next.gm_text, next.attach_marker_id, next.attach_page_id, next.session_id, next.real_date, next.in_world_label, next.calendar_instant, next.in_world_year, next.in_world_month, next.in_world_day, next.tags_json, next.payload_json, this.stamp(), entryId);
      this.indexEntry(entryId, next.player_text, next.gm_text, next.tags_json);
      this.rebuildLinksFor("journal", entryId, next.player_text, next.gm_text ?? "");
      this.bumpRevision();
    });
    return this.getEntry(entryId)!;
  }

  /** Only `who`/`activity`/`characterPageId` are editable; `applied` and `days` are kept from storage. */
  private editedDowntimePayload(existing: JournalRowRaw, edit: CodexJournalUpdateInput["downtime"]): string | null {
    if (edit === undefined) return existing.payload_json;
    if (existing.kind !== "downtime") throw new CodexValidationError("Only downtime entries carry downtime details.");
    const current = parseDowntimePayload(existing.payload_json) ?? { who: "", activity: "", days: 0, applied: false, characterPageId: null };
    const characterPageId = edit.characterPageId === undefined ? current.characterPageId : optionalId(edit.characterPageId);
    if (characterPageId !== null && !this.pageRow(characterPageId)) throw new CodexNotFoundError("That page no longer exists.");
    return JSON.stringify({
      who: edit.who === undefined ? current.who : (shortLabel(edit.who, 120, "downtime participant") ?? ""),
      activity: edit.activity === undefined ? current.activity : (shortLabel(edit.activity, 120, "downtime activity") ?? ""),
      days: current.days,
      applied: current.applied,
      characterPageId
    });
  }

  setEntryRevealed(entryId: string, revealed: boolean): CodexJournalRow {
    const database = this.requireDatabase();
    if (!this.journalRowRaw(entryId)) throw new CodexNotFoundError("That journal entry no longer exists.");
    this.transaction(() => {
      database.prepare("UPDATE codex_journal SET revealed = ?, updated_at = ? WHERE id = ?").run(revealed ? 1 : 0, this.stamp(), entryId);
      this.bumpRevision();
    });
    return this.getEntry(entryId)!;
  }

  deleteEntry(entryId: string): void {
    if (!ID.test(entryId)) return;
    this.transaction(() => {
      this.unindex("journal", entryId);
      this.scrubLinks("journal", entryId);
      this.requireDatabase().prepare("DELETE FROM codex_journal WHERE id = ?").run(entryId);
      this.bumpRevision();
    });
  }

  getEntry(entryId: string): CodexJournalRow | null {
    const row = this.journalRowRaw(entryId);
    return row ? this.toEntry(row) : null;
  }

  /** The campaign timeline, ordered by in-world instant (undated last), then session number, then creation time. */
  listTimeline(): CodexJournalRow[] {
    return (this.requireDatabase().prepare(
      `SELECT ${JOURNAL_COLUMNS} FROM ${JOURNAL_FROM} ORDER BY (j.calendar_instant IS NULL), j.calendar_instant, (live_session_number IS NULL), live_session_number, j.created_at`
    ).all() as JournalRowRaw[]).map((row) => this.toEntry(row));
  }

  /** Candidate character pages for gating downtime payloads. CASE so `json_valid` runs before `json_extract`. */
  downtimeCharacterPageIds(): string[] {
    const rows = this.requireDatabase().prepare(
      "SELECT DISTINCT (CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.characterPageId') END) AS page_id FROM codex_journal WHERE kind = 'downtime'"
    ).all() as Array<{ page_id: string | null }>;
    return rows.map((row) => row.page_id).filter((pageId): pageId is string => typeof pageId === "string");
  }

  /** Dated `event` pages; filtering on type (not clearing dates) keeps type switches lossless. */
  listDatedEventPages(): CodexPageRow[] {
    return (this.requireDatabase()
      .prepare(`SELECT ${PAGE_COLUMNS} FROM codex_pages WHERE entity_type = 'event' AND calendar_instant IS NOT NULL ORDER BY calendar_instant, created_at`)
      .all() as PageRow[]).map((row) => this.toPage(row));
  }

  /** Entries and dated event pages in order. Ungated by design; a store test keeps it so. */
  listChronicle(): CodexChronicleRecord[] {
    const records: CodexChronicleRecord[] = [
      ...this.listTimeline().map((entry) => ({ kind: "entry", entry }) as const),
      ...this.listDatedEventPages().map((page) => ({ kind: "event", page }) as const)
    ];
    return records.sort((a, b) => compareChronicle(chronicleSortKey(a), chronicleSortKey(b)));
  }

  /** Entries pinned to a specific marker or page (the per-entity mini-timeline). */
  listEntriesFor(attach: Readonly<{ markerId?: string; pageId?: string }>): CodexJournalRow[] {
    const database = this.requireDatabase();
    if (attach.markerId && ID.test(attach.markerId)) return (database.prepare(`SELECT ${JOURNAL_COLUMNS} FROM ${JOURNAL_FROM} WHERE j.attach_marker_id = ? ORDER BY j.created_at`).all(attach.markerId) as JournalRowRaw[]).map((row) => this.toEntry(row));
    if (attach.pageId && ID.test(attach.pageId)) return (database.prepare(`SELECT ${JOURNAL_COLUMNS} FROM ${JOURNAL_FROM} WHERE j.attach_page_id = ? ORDER BY j.created_at`).all(attach.pageId) as JournalRowRaw[]).map((row) => this.toEntry(row));
    return [];
  }

  /** The ordinary one-record create: `writeEntry` in its own transaction. See `writeEntry` for the rest. */
  private insertEntry(fields: EntryFields): CodexJournalRow {
    let entryId = "";
    this.transaction(() => { entryId = this.writeEntry(fields); });
    return this.getEntry(entryId)!;
  }

  /**
   * The one journal INSERT; must be inside a transaction so `setStanding` can be atomic. Payload text is not
   * indexed, so it never reaches the player search index.
   */
  private writeEntry(fields: EntryFields): string {
    const database = this.requireDatabase();
    const entryId = this.freshId();
    const stamp = this.stamp();
    const sortKey = ((database.prepare("SELECT MAX(sort_key) AS m FROM codex_journal").get() as { m: number | null }).m ?? 0) + 1;
    const date = fields.inWorldDate;
    const tagsJson = JSON.stringify(tags(fields.tags));
    database.prepare("INSERT INTO codex_journal (id, player_text, gm_text, revealed, attach_marker_id, attach_page_id, kind, source_encounter_id, session_id, real_date, in_world_label, calendar_instant, in_world_year, in_world_month, in_world_day, sort_key, tags_json, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(entryId, fields.playerText, fields.gmText, fields.revealed, fields.attachMarkerId, fields.attachPageId, fields.kind, fields.sourceEncounterId, fields.sessionId, fields.realDate, fields.inWorldLabel, fields.calendarInstant, date ? date.year : null, date ? date.month : null, date ? date.day : null, sortKey, tagsJson, fields.payload ? JSON.stringify(fields.payload) : null, stamp, stamp);
    this.indexEntry(entryId, fields.playerText, fields.gmText, tagsJson);
    // At the leaf, so every journal creator's prose joins the graph the same way.
    this.rebuildLinksFor("journal", entryId, fields.playerText, fields.gmText ?? "");
    this.bumpRevision();
    return entryId;
  }

  private toEntry(row: JournalRowRaw): CodexJournalRow {
    // Parsed, failing closed to "note" only for unknown kinds.
    const kind = journalKind(row.kind);
    return {
      id: row.id, playerText: row.player_text, gmText: row.gm_text, revealedToPlayers: row.revealed === 1,
      attachMarkerId: row.attach_marker_id, attachPageId: row.attach_page_id, kind,
      sourceEncounterId: row.source_encounter_id, sessionId: row.session_id,
      // The live number from the joined session, else the bare label left by deleting a revealed session.
      sessionNumber: row.live_session_number ?? row.session_number,
      realDate: row.real_date,
      inWorldLabel: row.in_world_label, calendarInstant: row.calendar_instant,
      inWorldDate: row.in_world_year !== null && row.in_world_month !== null && row.in_world_day !== null ? { year: row.in_world_year, month: row.in_world_month, day: row.in_world_day } : null,
      sortKey: row.sort_key, tags: parseTags(row.tags_json),
      // Only the kind that owns a payload reads one, with that kind's parser, so a stray blob cannot be
      // surfaced on another kind's record.
      payload: payloadOf(kind, row.payload_json),
      createdAt: row.created_at, updatedAt: row.updated_at
    };
  }
  private journalRowRaw(entryId: string): JournalRowRaw | undefined {
    if (!ID.test(entryId)) return undefined;
    return this.requireDatabase().prepare(`SELECT ${JOURNAL_COLUMNS} FROM ${JOURNAL_FROM} WHERE j.id = ?`).get(entryId) as JournalRowRaw | undefined;
  }

  private toMap(row: MapRowRaw): CodexMapRow {
    return { id: row.id, assetId: row.asset_id, name: row.name, kind: mapKind(row.kind), parentMapId: row.parent_map_id, revealedToPlayers: row.revealed === 1, sortKey: row.sort_key, tags: parseTags(row.tags_json), createdAt: row.created_at, updatedAt: row.updated_at };
  }
  private toMarker(row: MarkerRowRaw): CodexMarkerRow {
    return { id: row.id, mapId: row.map_id, x: row.x, y: row.y, iconId: row.icon_id, iconColor: row.icon_color, label: row.label, revealedToPlayers: row.revealed === 1, pageIds: parseIdArray(row.page_ids_json), subMapId: row.sub_map_id, sceneIds: parseIdArray(row.scene_ids_json), actorId: row.actor_id, tags: parseTags(row.tags_json), isParty: row.is_party === 1, createdAt: row.created_at, updatedAt: row.updated_at };
  }
  private mapRowRaw(mapId: string): MapRowRaw | undefined {
    if (!ID.test(mapId)) return undefined;
    return this.requireDatabase().prepare(`SELECT ${MAP_COLUMNS} FROM codex_maps WHERE id = ?`).get(mapId) as MapRowRaw | undefined;
  }
  private markerRowRaw(markerId: string): MarkerRowRaw | undefined {
    if (!ID.test(markerId)) return undefined;
    return this.requireDatabase().prepare(`SELECT ${MARKER_COLUMNS} FROM codex_markers WHERE id = ?`).get(markerId) as MarkerRowRaw | undefined;
  }

  // Sessions: GM prep on one side, player recap on the other. Modelled on pages: `rev` is the editor's
  // conflict token, every write is a transaction that bumps the revision. Differences are noted per method.

  createSession(input: CodexSessionCreateInput): CodexSessionRow {
    const database = this.requireDatabase();
    const sessionId = this.freshId();
    const stamp = this.stamp();
    const row: SessionRowRaw = {
      id: sessionId,
      session_number: sessionNo(input.sessionNumber),
      real_date: shortLabel(input.realDate, 40, "date"),
      attendees_json: JSON.stringify(attendees(input.attendees)),
      prep_body: body(input.prepBody),
      recap_body: body(input.recapBody),
      revealed: input.revealedToPlayers ? 1 : 0,
      status: sessionStatus(input.status),
      rev: 1, created_at: stamp, updated_at: stamp,
      tags_json: JSON.stringify(tags(input.tags)),
      scene_ids_json: JSON.stringify(sessionSceneIds(input.sceneIds))
    };
    this.guardSessionNumber(row.session_number, () => {
      this.transaction(() => {
        database.prepare(`INSERT INTO codex_sessions (${SESSION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(row.id, row.session_number, row.real_date, row.attendees_json, row.prep_body, row.recap_body, row.revealed, row.status, row.rev, row.created_at, row.updated_at, row.tags_json, row.scene_ids_json);
        this.indexSession(row);
        // Recap is the player layer and prep the GM layer, so a page named only in prep is a GM-only connection.
        this.rebuildLinksFor("session", row.id, row.recap_body, row.prep_body);
        this.bumpRevision();
      });
    });
    return this.getSession(sessionId)!;
  }

  /** Omitted fields are unchanged. `authorTag` is unused: sessions keep no revision history. */
  updateSession(sessionId: string, input: CodexSessionUpdateInput, expectedRev: number | undefined, authorTag: string): CodexSessionRow {
    void authorTag;
    const database = this.requireDatabase();
    const existing = this.sessionRowRaw(sessionId);
    if (!existing) throw new CodexNotFoundError("That session no longer exists.");
    if (expectedRev !== undefined && expectedRev !== existing.rev) throw new CodexRevisionConflictError("This session was changed somewhere else after you opened it.");
    const next: SessionRowRaw = {
      ...existing,
      session_number: input.sessionNumber === undefined ? existing.session_number : sessionNo(input.sessionNumber),
      real_date: input.realDate === undefined ? existing.real_date : shortLabel(input.realDate, 40, "date"),
      attendees_json: input.attendees === undefined ? existing.attendees_json : JSON.stringify(attendees(input.attendees)),
      prep_body: input.prepBody === undefined ? existing.prep_body : body(input.prepBody),
      recap_body: input.recapBody === undefined ? existing.recap_body : body(input.recapBody),
      status: input.status === undefined ? existing.status : sessionStatus(input.status),
      tags_json: input.tags === undefined ? existing.tags_json : JSON.stringify(tags(input.tags)),
      scene_ids_json: input.sceneIds === undefined ? existing.scene_ids_json ?? "[]" : JSON.stringify(sessionSceneIds(input.sceneIds)),
      // `rev` and `updated_at` move together on an edit; `setSessionRevealed` is the exception.
      rev: existing.rev + 1,
      updated_at: this.stamp()
    };
    this.guardSessionNumber(next.session_number, () => {
      this.transaction(() => {
        database.prepare("UPDATE codex_sessions SET session_number = ?, real_date = ?, attendees_json = ?, prep_body = ?, recap_body = ?, status = ?, tags_json = ?, scene_ids_json = ?, rev = ?, updated_at = ? WHERE id = ?")
          .run(next.session_number, next.real_date, next.attendees_json, next.prep_body, next.recap_body, next.status, next.tags_json, next.scene_ids_json, next.rev, next.updated_at, sessionId);
        this.indexSession(next);
        this.rebuildLinksFor("session", sessionId, next.recap_body, next.prep_body);
        this.bumpRevision();
      });
    });
    return this.getSession(sessionId)!;
  }

  /** Revealing is not editing: neither `rev` nor `updated_at` moves. */
  setSessionRevealed(sessionId: string, revealed: boolean): CodexSessionRow {
    const database = this.requireDatabase();
    if (!this.sessionRowRaw(sessionId)) throw new CodexNotFoundError("That session no longer exists.");
    this.transaction(() => {
      database.prepare("UPDATE codex_sessions SET revealed = ? WHERE id = ?").run(revealed ? 1 : 0, sessionId);
      this.bumpRevision();
    });
    return this.getSession(sessionId)!;
  }

  /**
   * Unfiles the session's entries. A revealed, numbered session leaves its number on them as a bare label;
   * a hidden one leaves nothing, since a bare label bypasses the session gate.
   */
  deleteSession(sessionId: string): void {
    const database = this.requireDatabase();
    if (!ID.test(sessionId)) return;
    const existing = this.sessionRowRaw(sessionId);
    const stampBack = existing && existing.revealed === 1 ? existing.session_number : null;
    this.transaction(() => {
      if (stampBack !== null) database.prepare("UPDATE codex_journal SET session_id = NULL, session_number = ? WHERE session_id = ?").run(stampBack, sessionId);
      else database.prepare("UPDATE codex_journal SET session_id = NULL WHERE session_id = ?").run(sessionId);
      database.prepare("DELETE FROM codex_sessions WHERE id = ?").run(sessionId);
      this.unindex("session", sessionId);
      this.scrubLinks("session", sessionId);
      // No FK clears the active pointer, so the delete must, or `activeSessionId` would name a missing record.
      database.prepare("UPDATE codex_meta SET active_session_id = NULL WHERE active_session_id = ?").run(sessionId);
      this.bumpRevision();
    });
  }

  getSession(sessionId: string): CodexSessionRow | null {
    const row = this.sessionRowRaw(sessionId);
    return row ? this.toSession(row) : null;
  }

  /** Numbered sessions first in number order, then unnumbered ones oldest-first. */
  listSessions(): CodexSessionRow[] {
    return (this.requireDatabase()
      .prepare(`SELECT ${SESSION_COLUMNS} FROM codex_sessions ORDER BY (session_number IS NULL), session_number, created_at`)
      .all() as SessionRowRaw[]).map((row) => this.toSession(row));
  }

  /** Hidden session ids, needed before any player sees an entry's session link or number. Bare labels are unaffected. */
  unrevealedSessionIds(): ReadonlySet<string> {
    const rows = this.requireDatabase()
      .prepare("SELECT id FROM codex_sessions WHERE revealed = 0")
      .all() as Array<{ id: string }>;
    return new Set(rows.map((row) => row.id));
  }

  /** The session the table is currently playing, or null. One meta row, so one pointer. */
  get activeSessionId(): string | null {
    return (this.requireDatabase().prepare("SELECT active_session_id FROM codex_meta WHERE id = 1").get() as { active_session_id: string | null } | undefined)?.active_session_id ?? null;
  }

  /** Writes `codex_meta` only: activating a session does not edit it. */
  setActiveSession(sessionId: string | null): string | null {
    const database = this.requireDatabase();
    const next = sessionId === null ? null : id(sessionId);
    if (next !== null && !this.sessionRowRaw(next)) throw new CodexNotFoundError("That session no longer exists.");
    this.transaction(() => {
      database.prepare("UPDATE codex_meta SET active_session_id = ? WHERE id = 1").run(next);
      this.bumpRevision();
    });
    return next;
  }

  /** Omitted: active session; `null`: none; an id must exist. */
  private resolveEntrySession(sessionId: string | null | undefined): string | null {
    if (sessionId === undefined) return this.activeSessionId;
    if (sessionId === null) return null;
    return this.requireSession(sessionId);
  }

  /** The id of a session that must exist; not-found otherwise, rather than a silent null. */
  private requireSession(sessionId: string): string {
    const resolved = id(sessionId);
    if (!this.sessionRowRaw(resolved)) throw new CodexNotFoundError("That session no longer exists.");
    return resolved;
  }

  /** Turns the session-number unique-index violation into a readable error (the index is the enforcement). */
  private guardSessionNumber(sessionNumber: number | null, work: () => void): void {
    try { work(); }
    catch (error) {
      if (sessionNumber !== null && error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        throw new CodexValidationError(`Session ${sessionNumber} already exists. Give this one a different number.`);
      }
      throw error;
    }
  }

  private toSession(row: SessionRowRaw): CodexSessionRow {
    return {
      id: row.id, sessionNumber: row.session_number, realDate: row.real_date,
      // `parseTags` is reused as the defensive JSON string-array reader; it does not slug.
      attendees: parseTags(row.attendees_json),
      prepBody: row.prep_body, recapBody: row.recap_body,
      revealedToPlayers: row.revealed === 1,
      // Unrecognised statuses read as `planned`.
      status: row.status === "played" ? "played" : "planned",
      tags: parseTags(row.tags_json),
      // GM-only: projected only into the GM session view.
      sceneIds: parseIdArray(row.scene_ids_json),
      rev: row.rev, createdAt: row.created_at, updatedAt: row.updated_at
    };
  }

  private sessionRowRaw(sessionId: string): SessionRowRaw | undefined {
    if (!ID.test(sessionId)) return undefined;
    return this.requireDatabase().prepare(`SELECT ${SESSION_COLUMNS} FROM codex_sessions WHERE id = ?`).get(sessionId) as SessionRowRaw | undefined;
  }

  // Quests, modelled on sessions: `rev` is the editor's conflict token and every write is a transaction
  // that bumps the revision. Writes also update the quest's search index row in the same transaction.

  createQuest(input: CodexQuestCreateInput): CodexQuestRow {
    const database = this.requireDatabase();
    const questId = this.freshId();
    const stamp = this.stamp();
    const row: QuestRowRaw = {
      id: questId,
      title: title(input.title),
      status: questStatus(input.status),
      player_body: body(input.playerBody),
      gm_body: body(input.gmBody),
      objectives_json: JSON.stringify(questObjectives(input.objectives)),
      // `idArray` validates, caps at 24 and dedupes: linked entities are a set (unlike objectives).
      entity_ids_json: JSON.stringify(idArray(input.entityIds)),
      revealed: input.revealedToPlayers ? 1 : 0,
      rev: 1, created_at: stamp, updated_at: stamp,
      tags_json: JSON.stringify(tags(input.tags))
    };
    this.transaction(() => {
      database.prepare(`INSERT INTO codex_quests (${QUEST_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(row.id, row.title, row.status, row.player_body, row.gm_body, row.objectives_json, row.entity_ids_json, row.revealed, row.rev, row.created_at, row.updated_at, row.tags_json);
      this.indexQuest(row.id, row.title, row.player_body, row.gm_body, row.objectives_json, row.tags_json);
      this.rebuildLinksFor("quest", row.id, row.player_body, row.gm_body);
      // A quest starts at creation, so the first history record is written here, in the same transaction.
      this.writeQuestEvent(row.id, questStatus(row.status));
      this.bumpRevision();
    });
    return this.getQuest(questId)!;
  }

  /** Omitted fields are unchanged; a supplied `objectives` array replaces the list wholesale. */
  updateQuest(questId: string, input: CodexQuestUpdateInput, expectedRev: number | undefined): CodexQuestRow {
    const database = this.requireDatabase();
    const existing = this.questRowRaw(questId);
    if (!existing) throw new CodexNotFoundError("That quest no longer exists.");
    if (expectedRev !== undefined && expectedRev !== existing.rev) throw new CodexRevisionConflictError("This quest was changed somewhere else after you opened it.");
    const next: QuestRowRaw = {
      ...existing,
      title: input.title === undefined ? existing.title : title(input.title),
      status: input.status === undefined ? existing.status : questStatus(input.status),
      player_body: input.playerBody === undefined ? existing.player_body : body(input.playerBody),
      gm_body: input.gmBody === undefined ? existing.gm_body : body(input.gmBody),
      objectives_json: input.objectives === undefined ? existing.objectives_json : JSON.stringify(questObjectives(input.objectives)),
      entity_ids_json: input.entityIds === undefined ? existing.entity_ids_json : JSON.stringify(idArray(input.entityIds)),
      tags_json: input.tags === undefined ? existing.tags_json : JSON.stringify(tags(input.tags)),
      // `rev` and `updated_at` move together on an edit; `setQuestRevealed` is the exception.
      rev: existing.rev + 1,
      updated_at: this.stamp()
    };
    this.transaction(() => {
      database.prepare("UPDATE codex_quests SET title = ?, status = ?, player_body = ?, gm_body = ?, objectives_json = ?, entity_ids_json = ?, tags_json = ?, rev = ?, updated_at = ? WHERE id = ?")
        .run(next.title, next.status, next.player_body, next.gm_body, next.objectives_json, next.entity_ids_json, next.tags_json, next.rev, next.updated_at, questId);
      // Indexed text may change here; reveals need no reindex (resolved at read time).
      this.indexQuest(questId, next.title, next.player_body, next.gm_body, next.objectives_json, next.tags_json);
      this.rebuildLinksFor("quest", questId, next.player_body, next.gm_body);
      // Only a status change is a history event; prose edits are not.
      if (input.status !== undefined && next.status !== existing.status) this.writeQuestEvent(questId, questStatus(next.status));
      this.bumpRevision();
    });
    return this.getQuest(questId)!;
  }

  /** Revealing is not editing, and needs no reindex (reveal is checked at read time). */
  setQuestRevealed(questId: string, revealed: boolean): CodexQuestRow {
    const database = this.requireDatabase();
    if (!this.questRowRaw(questId)) throw new CodexNotFoundError("That quest no longer exists.");
    this.transaction(() => {
      database.prepare("UPDATE codex_quests SET revealed = ? WHERE id = ?").run(revealed ? 1 : 0, questId);
      this.bumpRevision();
    });
    return this.getQuest(questId)!;
  }

  /** Hidden history record with no player text, inside the quest write's transaction. */
  private writeQuestEvent(questId: string, status: CodexQuestStatus): void {
    const dated = this.resolveDate(this.getCalendar().currentDate ?? null, null);
    this.writeEntry({
      playerText: "", gmText: null, revealed: 0,
      attachMarkerId: null, attachPageId: null, kind: "quest",
      sourceEncounterId: null, sessionId: this.activeSessionId, realDate: null,
      inWorldLabel: dated.label, calendarInstant: dated.instant, inWorldDate: dated.date,
      payload: questEventPayload({ questId, status })
    });
  }

  /** Idempotent, and an early return on a malformed id - every other codex delete behaves this way. */
  deleteQuest(questId: string): void {
    const database = this.requireDatabase();
    if (!ID.test(questId)) return;
    this.transaction(() => {
      database.prepare("DELETE FROM codex_quests WHERE id = ?").run(questId);
      // Unindexing is part of the delete: an orphaned index row of a recognised kind would keep matching.
      this.unindex("quest", questId);
      this.scrubLinks("quest", questId);
      this.bumpRevision();
    });
  }

  getQuest(questId: string): CodexQuestRow | null {
    const row = this.questRowRaw(questId);
    return row ? this.toQuest(row) : null;
  }

  /** Oldest-first; "still open" is a status filter over this. */
  listQuests(): CodexQuestRow[] {
    return (this.requireDatabase()
      .prepare(`SELECT ${QUEST_COLUMNS} FROM codex_quests ORDER BY created_at, id`)
      .all() as QuestRowRaw[]).map((row) => this.toQuest(row));
  }

  private toQuest(row: QuestRowRaw): CodexQuestRow {
    return {
      id: row.id, title: row.title,
      // Unrecognised statuses read as `active`: an unclassifiable quest is treated as still open.
      status: coerceQuestStatus(row.status),
      playerBody: row.player_body, gmBody: row.gm_body,
      objectives: parseObjectives(row.objectives_json),
      entityIds: parseIdArray(row.entity_ids_json),
      revealedToPlayers: row.revealed === 1,
      tags: parseTags(row.tags_json), rev: row.rev, createdAt: row.created_at, updatedAt: row.updated_at
    };
  }

  private questRowRaw(questId: string): QuestRowRaw | undefined {
    if (!ID.test(questId)) return undefined;
    return this.requireDatabase().prepare(`SELECT ${QUEST_COLUMNS} FROM codex_quests WHERE id = ?`).get(questId) as QuestRowRaw | undefined;
  }

  // Standing: the table is the current value, the timeline is the history; each is revealed independently.

  /** Oldest-first, so a faction does not jump as it is adjusted. */
  listStanding(): CodexStandingRow[] {
    return (this.requireDatabase()
      .prepare(`SELECT ${STANDING_COLUMNS} FROM codex_standing ORDER BY created_at, id`)
      .all() as StandingRowRaw[]).map((row) => this.toStanding(row));
  }

  /** One faction's standing, or `null` when the GM has never set one (which reads as Neutral, not as an error). */
  getStanding(factionPageId: string): CodexStandingRow | null {
    const row = this.standingRowRaw(factionPageId);
    return row ? this.toStanding(row) : null;
  }

  /**
   * Set the value and append its `standing` record atomically. `delta` is computed here from the clamped previous
   * value (0 if none); a record is written even when nothing moved. Reveal state is never touched.
   */
  setStanding(factionPageId: string, value: number, reason: string): CodexStandingRow {
    const pageId = id(factionPageId);
    const page = this.pageRow(pageId);
    if (!page) throw new CodexNotFoundError("That faction page no longer exists.");
    const existing = this.standingRowRaw(pageId);
    // A faction page is required to start tracking, not to keep tracking, so a retyped page's standing stays editable.
    if (!existing && page.entity_type !== "faction") throw new CodexValidationError("Standing is tracked against a faction - pick a faction page.");
    const next = standingValue(value);
    // Delta from the clamped previous value, so the timeline's deltas always sum to what the bar shows.
    const payload = standingPayload({ factionPageId: pageId, delta: next - (existing ? this.toStanding(existing).value : 0), reason });
    // Dated at the GM's clock, like other auto-written timeline records.
    const dated = this.resolveDate(this.getCalendar().currentDate ?? null, null);
    const stamp = this.stamp();
    this.transaction(() => {
      this.writeStanding(pageId, next, existing, stamp);
      this.writeEntry({
        // The prose lives only in the payload's `reason`. Copying it into `playerText` would give it a second
        // reveal gate and put GM-authored text into the player search index.
        playerText: "", gmText: null, revealed: 0,
        attachMarkerId: null, attachPageId: null, kind: "standing",
        sourceEncounterId: null, sessionId: this.activeSessionId, realDate: null,
        inWorldLabel: dated.label, calendarInstant: dated.instant, inWorldDate: dated.date, payload
      });
    });
    return this.getStanding(pageId)!;
  }

  /** Revealing is not editing; no chronicle record either. */
  setStandingRevealed(factionPageId: string, revealed: boolean): CodexStandingRow {
    const database = this.requireDatabase();
    const pageId = id(factionPageId);
    if (!this.standingRowRaw(pageId)) throw new CodexNotFoundError("That faction has no standing recorded yet.");
    this.transaction(() => {
      database.prepare("UPDATE codex_standing SET revealed = ? WHERE faction_page_id = ?").run(revealed ? 1 : 0, pageId);
      this.bumpRevision();
    });
    return this.getStanding(pageId)!;
  }

  /** Leaf write. The UPDATE never touches `revealed` or `created_at`. */
  private writeStanding(factionPageId: string, value: number, existing: StandingRowRaw | undefined, stamp: string): void {
    const database = this.requireDatabase();
    if (existing) database.prepare("UPDATE codex_standing SET value = ?, updated_at = ? WHERE faction_page_id = ?").run(value, stamp, factionPageId);
    // A new standing starts hidden.
    else database.prepare(`INSERT INTO codex_standing (${STANDING_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`).run(this.freshId(), factionPageId, value, 0, stamp, stamp);
  }

  private toStanding(row: StandingRowRaw): CodexStandingRow {
    return {
      id: row.id, factionPageId: row.faction_page_id,
      // Clamped on read too: there is no CHECK on the column, so a hand-edited value reads as the nearest
      // legal position.
      value: Math.min(MAX_STANDING, Math.max(MIN_STANDING, Math.trunc(row.value))),
      revealedToPlayers: row.revealed === 1,
      createdAt: row.created_at, updatedAt: row.updated_at
    };
  }

  private standingRowRaw(factionPageId: string): StandingRowRaw | undefined {
    if (!ID.test(factionPageId)) return undefined;
    return this.requireDatabase().prepare(`SELECT ${STANDING_COLUMNS} FROM codex_standing WHERE faction_page_id = ?`).get(factionPageId) as StandingRowRaw | undefined;
  }

  // Internals

  private pageRow(pageId: string): PageRow | undefined {
    if (!ID.test(pageId)) return undefined;
    return this.requireDatabase().prepare(`SELECT ${PAGE_COLUMNS} FROM codex_pages WHERE id = ?`).get(pageId) as PageRow | undefined;
  }

  private toPage(row: PageRow): CodexPageRow {
    return {
      id: row.id, title: row.title, entityType: (row.entity_type as CodexEntityType) ?? "note", fields: parseFields(row.fields_json), gmFields: parseFields(row.gm_fields_json),
      folder: row.folder, tags: JSON.parse(row.tags_json) as string[],
      playerBody: row.player_body, gmBody: row.gm_body, revealedToPlayers: row.revealed === 1,
      bannerAssetId: row.banner_asset_id,
      inWorldLabel: row.in_world_label, calendarInstant: row.calendar_instant, inWorldDate: pageDateOf(row),
      rev: row.rev, createdAt: row.created_at, updatedAt: row.updated_at
    };
  }

  /** Re-extract a record's links. Security: GM-layer text yields GM-layer edges. Must be inside a transaction. */
  private rebuildLinksFor(sourceKind: CodexConnectionSourceKind, sourceId: string, playerText: string, gmText: string) {
    const database = this.requireDatabase();
    database.prepare("DELETE FROM codex_links WHERE source_kind = ? AND source_id = ?").run(sourceKind, sourceId);
    const links = [...parseWikiLinks(playerText, "player"), ...parseWikiLinks(gmText, "gm")];
    const insert = database.prepare("INSERT INTO codex_links (source_kind, source_id, layer, target_kind, target_ref, section) VALUES (?, ?, ?, ?, ?, ?)");
    for (const link of links) insert.run(sourceKind, sourceId, link.layer, link.targetKind, link.targetRef, link.section);
  }

  /** Every record kind scrubs its own link rows on delete; `codex_links` has no FK to cascade. */
  private scrubLinks(sourceKind: CodexConnectionSourceKind, sourceId: string) {
    this.requireDatabase().prepare("DELETE FROM codex_links WHERE source_kind = ? AND source_id = ?").run(sourceKind, sourceId);
  }

  // Search index upkeep: every text change reindexes in the same transaction; deletes unindex; reveals don't.

  /** Replace one record's row in both indexes. `player` must contain player-layer text only. */
  private indexRecord(kind: CodexRecordKind, recordId: string, player: { title: string; body: string }, gm: { title: string; body: string }) {
    const database = this.requireDatabase();
    this.unindex(kind, recordId);
    database.prepare("INSERT INTO codex_search_player (kind, record_id, title, body) VALUES (?, ?, ?, ?)").run(kind, recordId, player.title, player.body);
    database.prepare("INSERT INTO codex_search_gm (kind, record_id, title, body) VALUES (?, ?, ?, ?)").run(kind, recordId, gm.title, gm.body);
  }

  private unindex(kind: CodexRecordKind, recordId: string) {
    const database = this.requireDatabase();
    database.prepare("DELETE FROM codex_search_player WHERE kind = ? AND record_id = ?").run(kind, recordId);
    database.prepare("DELETE FROM codex_search_gm WHERE kind = ? AND record_id = ?").run(kind, recordId);
  }

  private indexPage(pageId: string, pageTitle: string, playerBody: string, gmBody: string, fieldsJson: string, gmFieldsJson: string, tagsJson: string) {
    const fieldText = Object.values(parseFields(fieldsJson)).join(" ");     // public field values
    const gmFieldText = Object.values(parseFields(gmFieldsJson)).join(" ");  // GM-only field values
    // Tags are indexed for every kind so a tag query matches uniformly.
    const tagText = parseTags(tagsJson).join(" ");
    // The player index gets only player-facing text (body, public fields, tags), so player search can
    // never match GM content.
    this.indexRecord("page", pageId,
      { title: pageTitle, body: `${playerBody}\n${fieldText}\n${tagText}` },
      { title: pageTitle, body: `${playerBody}\n${gmBody}\n${fieldText}\n${gmFieldText}\n${tagText}` });
  }

  /** A map's name + tags. Single-layer text (no GM-only half), so both audiences index the same string. */
  private indexMap(mapId: string, name: string, tagsJson: string) {
    const row = { title: name, body: parseTags(tagsJson).join(" ") };
    this.indexRecord("map", mapId, row, row);
  }

  /** A marker's label + tags. Single-layer text; a hidden pin is hidden by the read-time predicate. */
  private indexMarker(markerId: string, label: string | null, tagsJson: string) {
    const row = { title: label ?? "", body: parseTags(tagsJson).join(" ") };
    this.indexRecord("marker", markerId, row, row);
  }

  /** `gmBody` only in the GM row: a revealed quest passes gates 2 and 3, so GM text in the player row would leak via hits. */
  private indexQuest(questId: string, questTitle: string, playerBody: string, gmBody: string, objectivesJson: string, tagsJson: string) {
    const objectiveText = parseObjectives(objectivesJson).map((objective) => objective.text).join(" ");
    const tagText = parseTags(tagsJson).join(" ");
    this.indexRecord("quest", questId,
      { title: questTitle, body: `${playerBody}\n${objectiveText}\n${tagText}` },
      { title: questTitle, body: `${playerBody}\n${gmBody}\n${objectiveText}\n${tagText}` });
  }

  /** Prep and attendees only in the GM row, or a player's query could match GM-only text on a revealed session. */
  private indexSession(row: SessionRowRaw) {
    const title = row.session_number === null ? "" : `Session ${row.session_number}`;
    const tagText = parseTags(row.tags_json).join(" ");
    const attendeeText = parseTags(row.attendees_json).join(" ");
    this.indexRecord("session", row.id,
      { title, body: `${row.recap_body}\n${row.real_date ?? ""}\n${tagText}` },
      { title, body: `${row.prep_body}\n${row.recap_body}\n${row.real_date ?? ""}\n${attendeeText}\n${tagText}` });
  }

  /** A journal entry is two-layer like a page: `gmText` goes only into the GM index. */
  private indexEntry(entryId: string, playerText: string, gmText: string | null, tagsJson: string) {
    const tagText = parseTags(tagsJson).join(" ");
    this.indexRecord("journal", entryId,
      { title: "", body: `${playerText}\n${tagText}` },
      { title: "", body: `${playerText}\n${gmText ?? ""}\n${tagText}` });
  }

  /** `authored_at` is the snapshotted row's `updated_at`, i.e. when the content was written. */
  private snapshotRevision(pageId: string, row: PageRow, authorTag: string) {
    this.requireDatabase().prepare("INSERT INTO codex_page_revisions (page_id, rev, title, entity_type, fields_json, gm_fields_json, player_body, gm_body, banner_asset_id, tags_json, authored_at, author_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(pageId, row.rev, row.title, row.entity_type, row.fields_json, row.gm_fields_json, row.player_body, row.gm_body, row.banner_asset_id, row.tags_json, row.updated_at, authorTag);
  }

  /**
   * Whether a save should checkpoint: skips while the newest checkpoint's content (`authored_at`) is younger than
   * the window, so at most `windowMinutes` of work can be lost.
   */
  private revisionDue(pageId: string, force = false): boolean {
    // `revisionSettings`, not `getSettings`, which also scans the whole revision table.
    const settings = this.revisionSettings();
    // Disabled history writes nothing new but deletes nothing; existing revisions stay restorable.
    if (!settings.enabled) return false;
    // `force` bypasses the window but never the switch: "off" means off, even for restores.
    if (force) return true;
    const newest = (this.requireDatabase().prepare("SELECT MAX(authored_at) AS newest FROM codex_page_revisions WHERE page_id = ?")
      .get(pageId) as { newest: string | null } | undefined)?.newest ?? null;
    if (newest === null) return true; // no checkpoint at all: there is no "previous version" to coalesce into
    const age = this.now() - Date.parse(newest);
    // Write unless the newest checkpoint is provably recent. A window of 0 snapshots every save; an
    // unparseable or future stamp also snapshots (an extra row is cheaper than lost work).
    return !(age >= 0 && age < settings.windowMinutes * 60_000);
  }

  /** Avoids duplicate checkpoints of the same `(page_id, rev)` state. */
  private revisionExistsAt(pageId: string, rev: number): boolean {
    return (this.requireDatabase().prepare("SELECT 1 FROM codex_page_revisions WHERE page_id = ? AND rev = ? LIMIT 1")
      .get(pageId, rev) as { 1: number } | undefined) !== undefined;
  }

  private bumpRevision() {
    this.requireDatabase().prepare("UPDATE codex_meta SET codex_revision = codex_revision + 1 WHERE id = 1").run();
  }

  private transaction(work: () => void) {
    const database = this.requireDatabase();
    database.exec("BEGIN IMMEDIATE");
    try { work(); database.exec("COMMIT"); }
    catch (error) { database.exec("ROLLBACK"); throw error; }
  }

  private migrate() {
    const database = this.requireDatabase();
    const applied = new Set((database.prepare("SELECT version FROM codex_schema_migrations").all() as Array<{ version: number }>).map(({ version }) => version));
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      database.exec("BEGIN IMMEDIATE");
      try {
        database.exec(migration.sql);
        database.prepare("INSERT INTO codex_schema_migrations (version, applied_at) VALUES (?, ?)").run(migration.version, this.stamp());
        database.exec("COMMIT");
      } catch (error) { database.exec("ROLLBACK"); throw error; }
    }
  }

  private stamp(): string { return new Date(this.now()).toISOString(); }

  private freshId(): string { return randomUUID(); }

  private requireDatabase(): DatabaseSync {
    if (!this.database) throw new Error("CodexStore has not been initialized.");
    return this.database;
  }
}

/** Turn a free-text query into a safe FTS5 prefix MATCH; returns null when nothing usable remains. */
function ftsQuery(raw: string): string | null {
  const terms = raw.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!terms || terms.length === 0) return null;
  return terms.slice(0, 12).map((term) => `"${term}"*`).join(" ");
}
