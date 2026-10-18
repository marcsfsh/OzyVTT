import type { DatabaseSync } from "node:sqlite";
import { HomebrewContentTypeSchema, type HomebrewContentState, type HomebrewContentType } from "@vtt/api-contract";
import { type ActorAction, type ActorDefinition } from "@vtt/schemas";
import { areaOfProse, withProseFacts } from "@vtt/content-srd-5.2.1/action-prose";
import { spellEffectFromColumns } from "@vtt/content-srd-5.2.1/spell-effect";
import {
  HOMEBREW_BODY_SCHEMAS,
  type BackgroundReference,
  type ClassReference,
  type EquipmentReference,
  type FeatReference,
  type SpeciesReference,
  type SpellListReference,
  type SpellReference,
  type SubclassReference
} from "@vtt/content-srd-5.2.1";
import { createHash, randomUUID } from "node:crypto";
import {
  audienceKey,
  audienceReceives,
  EMPTY_HOMEBREW_SLICE,
  type ContentAudience,
  type HomebrewCatalogSlice,
  type HomebrewContentSource
} from "./content-library.js";
import { migrate, openDatabase, transaction, type Migration } from "./database.js";
import { mintHomebrewId } from "./homebrew-ids.js";
import { withArticle } from "@vtt/domain";

/**
 * Persistence for GM-authored homebrew content (nine types), same pattern as `codex-store.ts`. Not GameState: a
 * write bumps `revision`, which pings clients and invalidates `ContentLibrary`'s cache. Security: rows are raw
 * (drafts, hidden, deleted, in packs that are off); only `publishedFor` filters for an audience.
 */

/** The authored body, in its own bundle schema shape (ADR-0016). */
export type HomebrewBody = Readonly<Record<string, unknown>>;

/** The pack every record the GM makes here belongs to ("This table"). Imported packs have uuid ids. */
export const TABLE_PACK_ID = "table";

export type HomebrewAudienceKind = "hidden" | "everyone" | "characters";
/** Who sees a record: the GM only, every player, or the players of these party characters. */
export type HomebrewAudience = Readonly<{ audience: HomebrewAudienceKind; characterIds: readonly string[] }>;
export const HIDDEN_AUDIENCE: HomebrewAudience = Object.freeze({ audience: "hidden", characterIds: [] });
export const EVERYONE_AUDIENCE: HomebrewAudience = Object.freeze({ audience: "everyone", characterIds: [] });
/** When a published record reached one audience: `everyone`, or a character id. */
export type HomebrewReveal = Readonly<{ to: string; at: string }>;
/** What a duplicate was copied from, for Compare. */
export type HomebrewBasedOn = Readonly<{ source: "srd" | "homebrew"; id: string; name: string; copiedAt: string }>;

export type HomebrewRecordRow = Readonly<{
  id: string;
  type: HomebrewContentType;
  /** Denormalised from `body.name` so the library rail can list, sort and filter without parsing every body. */
  name: string;
  state: HomebrewContentState;
  audience: HomebrewAudienceKind;
  characterIds: readonly string[];
  reveals: readonly HomebrewReveal[];
  /** Derived: shown to any player at all. Kept for the API's older `visibleToPlayers` field. */
  visibleToPlayers: boolean;
  packId: string;
  basedOn: HomebrewBasedOn | null;
  /** NULL = live. Soft delete only; there is no hard delete. */
  deletedAt: string | null;
  rev: number;
  createdAt: string;
  updatedAt: string;
  /** Parsed `body_json`. Carries `id` (forced to the row id) but not `type`; see `create`. */
  body: HomebrewBody;
  /** A published record's edits that are not live yet; null when there are none. See `update`. */
  pendingBody: HomebrewBody | null;
}>;

/** The list row: everything but the authored bodies, so a few-hundred-record library is a small payload. */
export type HomebrewSummaryRow = Omit<HomebrewRecordRow, "body" | "pendingBody">;

export type HomebrewCreateInput = Readonly<{
  type: HomebrewContentType;
  body: HomebrewBody;
  basedOn?: HomebrewBasedOn | null;
}>;

/** Which records exist, drafts included, for the publish gate only; never used by a catalog read, so no draft leaks. */
export type HomebrewAuthoredIndex = Readonly<{
  /** Does a live (non-deleted) record of this type exist at this id, in any state? */
  has(type: HomebrewContentType, id: string): boolean;
  /** The ids of live subclass records naming this class, in any state. */
  subclassIdsFor(classId: string): ReadonlySet<string>;
}>;

/** The empty index, for a caller with no store (a fixture, or a pre-initialize read). */
export const EMPTY_AUTHORED_INDEX: HomebrewAuthoredIndex = Object.freeze({
  has: () => false,
  subclassIdsFor: () => new Set<string>()
});

export type HomebrewListFilter = Readonly<{
  type?: HomebrewContentType;
  state?: HomebrewContentState;
  audience?: HomebrewAudienceKind;
  packId?: string;
  /** Shown to any player at all (`audience` is not hidden). */
  visibleToPlayers?: boolean;
  /** Case-insensitive name substring (not full-text search). */
  q?: string;
  includeDeleted?: boolean;
  limit?: number;
  cursor?: string;
}>;
export type HomebrewListPage = Readonly<{
  rows: readonly HomebrewSummaryRow[];
  nextCursor: string | null;
  total: number;
}>;
/** What a history row records. Every write leaves one. */
export type HomebrewRevisionEvent =
  | "create"
  | "edit"
  | "publish"
  | "unpublish"
  | "discard"
  | "share"
  | "archive"
  | "restore"
  | "import"
  | "duplicate"
  | "revert"
  | "pack";
export type HomebrewRevisionRow = Readonly<{
  id: number;
  recordId: string;
  rev: number;
  name: string;
  state: HomebrewContentState;
  audience: HomebrewAudienceKind;
  characterIds: readonly string[];
  event: HomebrewRevisionEvent;
  /** The body is a published record's changes that were not live. */
  pending: boolean;
  authoredAt: string;
  /** `gm:<session id>` for a GM device, else what wrote it (`server`, or an older tag). */
  authorTag: string;
  /** Top-level body keys that differ from the row before this one (none for the first). */
  changedFields: readonly string[];
}>;
export type HomebrewRevisionRead = HomebrewRevisionRow & Readonly<{ body: HomebrewBody }>;

export type HomebrewPackRow = Readonly<{
  id: string;
  kind: "table" | "imported";
  /** Null for the table pack, which the UI names "This table". */
  name: string | null;
  credit: string | null;
  importedAt: string | null;
  enabled: boolean;
}>;

/** What the server's copy changed since the revision an editor was working from. */
export type HomebrewConflict = Readonly<{
  baseRev: number;
  currentRev: number;
  baseKnown: boolean;
  changes: ReadonlyArray<Readonly<{ field: string; base?: unknown; current?: unknown }>>;
  rowChanges: ReadonlyArray<"state" | "audience" | "archived">;
}>;

/** Thrown when a write's `expectedRev` does not match the stored row: the editor's copy is stale. */
export class HomebrewRevisionConflictError extends Error {
  constructor(
    message: string,
    readonly currentRev: number,
    readonly conflict?: HomebrewConflict
  ) {
    super(message);
  }
}
/** Thrown when the addressed record does not exist (or was never created). */
export class HomebrewNotFoundError extends Error {}
/** Thrown when the row's state refuses the requested transition (e.g. sharing a draft). */
export class HomebrewStateError extends Error {}

const MAX_NAME = 120;
const MAX_BODY_BYTES = 512_000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Literal because migration SQL must be frozen; a test asserts it still matches the contract. */
const TYPE_CHECK_LIST = "'class','subclass','species','background','feat','spell','equipment','monster','spell-list'";

/** Exported so a test can build a file as an older server left it. */
export const HOMEBREW_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    up: (database) =>
      database.exec(`
        CREATE TABLE homebrew_meta (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          homebrew_revision INTEGER NOT NULL
        ) STRICT;
        INSERT INTO homebrew_meta (id, homebrew_revision) VALUES (1, 0);
        CREATE TABLE homebrew_records (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL CHECK (type IN (${TYPE_CHECK_LIST})),
          name TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published')),
          visible_to_players INTEGER NOT NULL DEFAULT 0,
          deleted_at TEXT,
          body_json TEXT NOT NULL,
          rev INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX homebrew_records_catalog ON homebrew_records (type, state, visible_to_players, deleted_at);
        CREATE INDEX homebrew_records_name ON homebrew_records (name);
        CREATE TABLE homebrew_record_revisions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          record_id TEXT NOT NULL REFERENCES homebrew_records(id) ON DELETE CASCADE,
          rev INTEGER NOT NULL,
          name TEXT NOT NULL,
          state TEXT NOT NULL,
          visible_to_players INTEGER NOT NULL,
          body_json TEXT NOT NULL,
          authored_at TEXT NOT NULL,
          author_tag TEXT NOT NULL
        ) STRICT;
        CREATE INDEX homebrew_record_revisions_record ON homebrew_record_revisions (record_id, rev DESC);
      `)
  },
  {
    version: 2,
    up: (database) => database.exec("ALTER TABLE homebrew_records ADD COLUMN pending_body_json TEXT;")
  },
  {
    // Who sees it per record (replacing the one player flag), packs, Based on, and history rows that say what
    // happened. A record that was shown becomes Everyone, stamped at its last update; a draft is always Hidden.
    version: 3,
    up: (database) =>
      database.exec(`
        CREATE TABLE homebrew_packs (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK (kind IN ('table', 'imported')),
          name TEXT,
          credit TEXT,
          imported_at TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        ) STRICT;
        INSERT INTO homebrew_packs (id, kind, name, credit, imported_at, enabled, created_at)
          VALUES ('${TABLE_PACK_ID}', 'table', NULL, NULL, NULL, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
        ALTER TABLE homebrew_records ADD COLUMN audience TEXT NOT NULL DEFAULT 'hidden';
        ALTER TABLE homebrew_records ADD COLUMN audience_characters TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE homebrew_records ADD COLUMN reveals_json TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE homebrew_records ADD COLUMN pack_id TEXT NOT NULL DEFAULT '${TABLE_PACK_ID}';
        ALTER TABLE homebrew_records ADD COLUMN based_on_json TEXT;
        UPDATE homebrew_records
          SET audience = 'everyone', reveals_json = json_array(json_object('to', 'everyone', 'at', updated_at))
          WHERE visible_to_players = 1 AND state = 'published';
        DROP INDEX homebrew_records_catalog;
        ALTER TABLE homebrew_records DROP COLUMN visible_to_players;
        CREATE INDEX homebrew_records_catalog ON homebrew_records (type, state, audience, deleted_at);
        CREATE INDEX homebrew_records_pack ON homebrew_records (pack_id);
        ALTER TABLE homebrew_record_revisions ADD COLUMN audience TEXT NOT NULL DEFAULT 'hidden';
        ALTER TABLE homebrew_record_revisions ADD COLUMN audience_characters TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE homebrew_record_revisions ADD COLUMN event TEXT NOT NULL DEFAULT 'edit';
        ALTER TABLE homebrew_record_revisions ADD COLUMN pending INTEGER NOT NULL DEFAULT 0;
        UPDATE homebrew_record_revisions SET
          audience = CASE WHEN visible_to_players = 1 AND state = 'published' THEN 'everyone' ELSE 'hidden' END,
          event = CASE author_tag
            WHEN 'homebrew:create' THEN 'create'
            WHEN 'homebrew:import' THEN 'import'
            WHEN 'homebrew:duplicate' THEN 'duplicate'
            ELSE 'edit' END,
          pending = CASE WHEN author_tag LIKE '%:pending' THEN 1 ELSE 0 END;
        ALTER TABLE homebrew_record_revisions DROP COLUMN visible_to_players;
      `)
  }
];

type RecordRow = {
  id: string;
  type: string;
  name: string;
  state: string;
  audience: string;
  audience_characters: string;
  reveals_json: string;
  pack_id: string;
  based_on_json: string | null;
  deleted_at: string | null;
  body_json: string;
  pending_body_json: string | null;
  rev: number;
  created_at: string;
  updated_at: string;
};

type RevisionDbRow = {
  id: number;
  record_id: string;
  rev: number;
  name: string;
  state: string;
  audience: string;
  audience_characters: string;
  event: string;
  pending: number;
  body_json: string;
  authored_at: string;
  author_tag: string;
};

type PackDbRow = {
  id: string;
  kind: string;
  name: string | null;
  credit: string | null;
  imported_at: string | null;
  enabled: number;
};

/** One published, live record, parsed once per revision, with what decides who receives it. */
type PublishedEntry = Readonly<{
  id: string;
  type: HomebrewContentType;
  parsed: unknown;
  audience: HomebrewAudienceKind;
  characterIds: readonly string[];
  packEnabled: boolean;
}>;

/** What one write leaves in the history. */
type Snapshot = Readonly<{
  rev: number;
  name: string;
  state: HomebrewContentState;
  audience: HomebrewAudience;
  bodyJson: string;
  pending: boolean;
  at: string;
  event: HomebrewRevisionEvent;
}>;

/** Who wrote a change: `gm:<session id>` for a GM device. */
const SERVER_AUTHOR = "server";

export class HomebrewStore implements HomebrewContentSource {
  private database?: DatabaseSync;
  /** In memory: read on every catalog access. -1 before `initialize()`, so early reads get an SRD-only view. */
  private revisionValue = -1;
  /** Every published, live record parsed once, and each audience's slice, rebuilt only when `revisionValue` moves.
   *  Slices that hold the same records are one object (keyed by their ids), so their catalogs are built once. */
  private published?: {
    revision: number;
    entries: readonly PublishedEntry[];
    byAudience: Map<string, HomebrewCatalogSlice>;
    byContent: Map<string, HomebrewCatalogSlice>;
  };
  /** Status-blind monster index for live-instance resolution, on the same revision gate. */
  private monsters?: { revision: number; byId: Map<string, ActorDefinition> };
  /** Draft-aware authorship index for the publish gate, on the same revision gate. */
  private authored?: { revision: number; index: HomebrewAuthoredIndex };

  constructor(
    private readonly databasePath: string,
    private readonly now: () => number = Date.now
  ) {}

  async initialize() {
    if (this.database) return;
    const database = openDatabase(this.databasePath);
    try {
      migrate(database, "homebrew", HOMEBREW_MIGRATIONS, {
        path: this.databasePath,
        legacyTables: ["homebrew_schema_migrations"]
      });
      const meta = database.prepare("SELECT homebrew_revision FROM homebrew_meta WHERE id = 1").get() as {
        homebrew_revision: number;
      };
      this.revisionValue = meta.homebrew_revision;
    } catch (error) {
      database.close();
      throw error;
    }
    this.database = database;
  }

  close() {
    this.database?.close();
    this.database = undefined;
    this.revisionValue = -1;
    // Dropped here, ahead of the revision gate: a reopened store's counter could coincide with a
    // cached revision from the previous handle.
    this.published = undefined;
    this.monsters = undefined;
    this.authored = undefined;
  }

  /** The coarse counter bumped inside every write transaction: drives `homebrew:changed` and the view cache. */
  get revision(): number {
    return this.revisionValue;
  }

  // HomebrewContentSource (the ContentLibrary seam)

  /**
   * Published, non-deleted records an audience receives (`audienceReceives`). Security: drafts are in no catalog
   * for anyone; a pack that is off is in no catalog but play's; a reader gets only what is shown to everyone or to
   * one of its characters. Unparseable bodies are dropped and logged, never thrown.
   */
  publishedFor(audience: ContentAudience): HomebrewCatalogSlice {
    if (!this.database) return EMPTY_HOMEBREW_SLICE; // pre-initialize: revision -1, SRD-only view
    if (!this.published || this.published.revision !== this.revisionValue)
      this.published = {
        revision: this.revisionValue,
        entries: this.buildPublished(),
        byAudience: new Map(),
        byContent: new Map()
      };
    const cache = this.published;
    const key = audienceKey(audience);
    const known = cache.byAudience.get(key);
    if (known) return known;
    const entries = cache.entries.filter((entry) =>
      audienceReceives(audience, {
        audience: entry.audience,
        characterIds: entry.characterIds,
        packEnabled: entry.packEnabled
      })
    );
    const contentKey = entries.map((entry) => entry.id).join(",");
    let slice = cache.byContent.get(contentKey);
    if (!slice) {
      const draft = emptyDraft();
      for (const entry of entries) pushInto(draft, entry.type, entry.parsed);
      slice = freezeSlice(draft);
      cache.byContent.set(contentKey, slice);
    }
    cache.byAudience.set(key, slice);
    return slice;
  }

  /** A hash of the homebrew a reader receives, which decides whether a player's device is pinged. Kept per slice,
   *  since every game broadcast asks it for each player socket. */
  fingerprintFor(audience: ContentAudience): string {
    const slice = this.publishedFor(audience);
    let fingerprint = this.fingerprints.get(slice);
    if (fingerprint === undefined) {
      fingerprint = createHash("sha256").update(JSON.stringify(slice)).digest("hex");
      this.fingerprints.set(slice, fingerprint);
    }
    return fingerprint;
  }
  private fingerprints = new WeakMap<HomebrewCatalogSlice, string>();

  /**
   * Any monster row regardless of state or deletion, so unpublishing or deleting a creature never disarms its live
   * tokens (actions resolve per use). Not a leak: it needs a `definitionId` the GM already placed.
   */
  monsterForInstance(definitionId: string): ActorDefinition | undefined {
    if (!this.database) return undefined;
    if (!this.monsters || this.monsters.revision !== this.revisionValue) {
      this.monsters = { revision: this.revisionValue, byId: this.buildMonsterIndex() };
    }
    return this.monsters.byId.get(definitionId);
  }

  /** Authored, non-deleted records for the publish gate. Not on `HomebrewContentSource`, so `ContentLibrary` can never reach drafts. */
  authoredIndex(): HomebrewAuthoredIndex {
    if (!this.database) return EMPTY_AUTHORED_INDEX;
    if (!this.authored || this.authored.revision !== this.revisionValue) {
      this.authored = { revision: this.revisionValue, index: this.buildAuthoredIndex() };
    }
    return this.authored.index;
  }

  private buildAuthoredIndex(): HomebrewAuthoredIndex {
    const rows = this.requireDatabase()
      .prepare("SELECT id, type, body_json FROM homebrew_records WHERE deleted_at IS NULL")
      .all() as Array<{ id: string; type: string; body_json: string }>;
    const ids = new Set<string>();
    const subclassesByClass = new Map<string, Set<string>>();
    for (const row of rows) {
      ids.add(`${row.type}:${row.id}`);
      if (row.type !== "subclass") continue;
      // Read the raw JSON: a draft may be invalid and still counts as naming its class.
      let classId: unknown;
      try {
        classId = (JSON.parse(row.body_json) as { classId?: unknown }).classId;
      } catch {
        continue;
      }
      if (typeof classId !== "string" || classId === "") continue;
      const existing = subclassesByClass.get(classId);
      if (existing) existing.add(row.id);
      else subclassesByClass.set(classId, new Set([row.id]));
    }
    return Object.freeze({
      has: (type: HomebrewContentType, id: string) => ids.has(`${type}:${id}`),
      subclassIdsFor: (classId: string) => subclassesByClass.get(classId) ?? new Set<string>()
    });
  }

  /** One pass over the published, live rows, parsed into the nine bundle shapes, in a stable order. */
  private buildPublished(): readonly PublishedEntry[] {
    const enabled = this.packSwitches();
    const rows = this.requireDatabase()
      .prepare(
        "SELECT id, type, audience, audience_characters, pack_id, body_json FROM homebrew_records WHERE state = 'published' AND deleted_at IS NULL ORDER BY id"
      )
      .all() as Array<{
      id: string;
      type: string;
      audience: string;
      audience_characters: string;
      pack_id: string;
      body_json: string;
    }>;
    const dropped: string[] = [];
    const entries: PublishedEntry[] = [];
    for (const row of rows) {
      const parsed = parseBody(row.type as HomebrewContentType, row.body_json);
      if (!parsed) {
        dropped.push(`${row.type} "${row.id}"`);
        continue;
      }
      entries.push({
        id: row.id,
        type: row.type as HomebrewContentType,
        parsed,
        audience: audienceKind(row.audience),
        characterIds: parseStringList(row.audience_characters),
        // A record whose pack row is gone is treated as on, so it can't silently vanish.
        packEnabled: enabled.get(row.pack_id) ?? true
      });
    }
    if (dropped.length > 0) {
      // Logged once per rebuild: a schema tightening drops every row of a type at once.
      console.warn(
        `[homebrew] ${dropped.length} published record(s) no longer parse and were left out of the catalogs: ${dropped.join(", ")}`
      );
    }
    return entries;
  }

  /** Every monster row, whatever its `state` and `deleted_at`. See `monsterForInstance`. */
  private buildMonsterIndex(): Map<string, ActorDefinition> {
    const byId = new Map<string, ActorDefinition>();
    const rows = this.requireDatabase()
      .prepare("SELECT id, body_json FROM homebrew_records WHERE type = 'monster'")
      .all() as Array<{ id: string; body_json: string }>;
    for (const row of rows) {
      const parsed = parseBody("monster", row.body_json);
      // Keyed by row id, which `create`/`importRecord` force `source.externalId` to equal; `instantiate`
      // writes `source.externalId` into `Actor.definitionId`.
      if (parsed) byId.set(row.id, parsed as ActorDefinition);
    }
    return byId;
  }

  // Reads

  get(id: string): HomebrewRecordRow | undefined {
    const row = this.recordRow(id);
    return row ? projectRecord(row) : undefined;
  }

  /** Every published, live record with its bodies, for checks across the whole published table (its dependents). */
  listPublished(): readonly HomebrewRecordRow[] {
    return (
      this.requireDatabase()
        .prepare("SELECT * FROM homebrew_records WHERE state = 'published' AND deleted_at IS NULL")
        .all() as RecordRow[]
    ).map(projectRecord);
  }

  /** Every record with its bodies, archived ones only when asked: the GM's tables, overview and search. */
  listRecords(options: Readonly<{ type?: HomebrewContentType; includeDeleted?: boolean }> = {}) {
    const where: string[] = [];
    const parameters: string[] = [];
    if (options.type) {
      where.push("type = ?");
      parameters.push(options.type);
    }
    if (!options.includeDeleted) where.push("deleted_at IS NULL");
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return (
      this.requireDatabase()
        .prepare(`SELECT * FROM homebrew_records ${clause} ORDER BY LOWER(name), id`)
        .all(...parameters) as RecordRow[]
    ).map(projectRecord);
  }

  /** Every record's id, kind and listed name, archived ones included: the names behind ids a body mentions. */
  listNames(): ReadonlyArray<Readonly<{ id: string; type: HomebrewContentType; name: string }>> {
    return this.requireDatabase().prepare("SELECT id, type, name FROM homebrew_records").all() as Array<{
      id: string;
      type: HomebrewContentType;
      name: string;
    }>;
  }

  /** What each record's latest history row records, by record id. */
  latestEvents(): ReadonlyMap<string, HomebrewRevisionEvent> {
    const rows = this.requireDatabase()
      .prepare(
        "SELECT record_id, event FROM homebrew_record_revisions WHERE id IN (SELECT MAX(id) FROM homebrew_record_revisions GROUP BY record_id)"
      )
      .all() as Array<{ record_id: string; event: string }>;
    return new Map(rows.map((row) => [row.record_id, revisionEvent(row.event)]));
  }

  /** Keyset paging by `LOWER(name), id` (not `updated_at`), so publishing mid-scroll cannot skip or repeat rows. */
  list(filter: HomebrewListFilter = {}): HomebrewListPage {
    const database = this.requireDatabase();
    const where: string[] = [];
    const parameters: Array<string | number> = [];
    if (filter.type) {
      where.push("type = ?");
      parameters.push(filter.type);
    }
    if (filter.state) {
      where.push("state = ?");
      parameters.push(filter.state);
    }
    if (filter.audience) {
      where.push("audience = ?");
      parameters.push(filter.audience);
    }
    if (filter.packId) {
      where.push("pack_id = ?");
      parameters.push(filter.packId);
    }
    if (filter.visibleToPlayers !== undefined)
      where.push(filter.visibleToPlayers ? "audience <> 'hidden'" : "audience = 'hidden'");
    if (filter.q) {
      where.push("name LIKE ? ESCAPE '\\'");
      parameters.push(`%${likeEscape(filter.q)}%`);
    }
    if (!filter.includeDeleted) where.push("deleted_at IS NULL");
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const total = (
      database.prepare(`SELECT COUNT(*) AS total FROM homebrew_records ${clause}`).get(...parameters) as {
        total: number;
      }
    ).total;

    // The cursor carries only the id and the sort key is looked up: name plus id would exceed the
    // contract's 200-character cursor cap.
    const cursorId = decodeCursor(filter.cursor);
    const anchor = cursorId
      ? (database.prepare("SELECT LOWER(name) AS sort_key FROM homebrew_records WHERE id = ?").get(cursorId) as
          { sort_key: string } | undefined)
      : undefined;
    const pageWhere = [...where];
    const pageParameters = [...parameters];
    // The cursor is opaque, so an unresolvable one restarts from the top.
    if (anchor && cursorId) {
      pageWhere.push("(LOWER(name), id) > (?, ?)");
      pageParameters.push(anchor.sort_key, cursorId);
    }
    const pageClause = pageWhere.length ? `WHERE ${pageWhere.join(" AND ")}` : "";
    const limit = Math.min(Math.max(Math.trunc(filter.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
    // One extra row tells whether another page follows.
    const rows = database
      .prepare(`SELECT * FROM homebrew_records ${pageClause} ORDER BY LOWER(name), id LIMIT ?`)
      .all(...pageParameters, limit + 1) as RecordRow[];
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      rows: page.map(projectSummary),
      nextCursor: rows.length > limit && last ? encodeCursor(last.id) : null,
      total
    };
  }

  /** A record's history, newest first, each row saying which top-level fields it changed. */
  listRevisions(id: string): readonly HomebrewRevisionRow[] {
    const rows = this.revisionRows(id);
    return rows
      .map((row, index) => projectRevision(row, index === 0 ? null : rows[index - 1]!))
      .reverse()
      .map(({ body: _body, ...rest }) => rest);
  }

  /** One history row with its body, or undefined when the record has no such row. */
  getRevision(id: string, revisionId: number): HomebrewRevisionRead | undefined {
    const rows = this.revisionRows(id);
    const index = rows.findIndex((row) => row.id === revisionId);
    if (index < 0) return undefined;
    return projectRevision(rows[index]!, index === 0 ? null : rows[index - 1]!);
  }

  /** Oldest first. */
  private revisionRows(id: string): RevisionDbRow[] {
    return this.requireDatabase()
      .prepare("SELECT * FROM homebrew_record_revisions WHERE record_id = ? ORDER BY id")
      .all(id) as RevisionDbRow[];
  }

  // Packs

  listPacks(): readonly HomebrewPackRow[] {
    return (
      this.requireDatabase()
        .prepare("SELECT * FROM homebrew_packs ORDER BY CASE kind WHEN 'table' THEN 0 ELSE 1 END, created_at, id")
        .all() as PackDbRow[]
    ).map(projectPack);
  }

  getPack(id: string): HomebrewPackRow | undefined {
    const row = this.requireDatabase().prepare("SELECT * FROM homebrew_packs WHERE id = ?").get(id) as
      PackDbRow | undefined;
    return row ? projectPack(row) : undefined;
  }

  /** Each pack's counts: every live record, the published and the drafts among them, those shared with any player,
   *  and the archived ones (counted only there). */
  packCounts(): Map<string, { records: number; published: number; drafts: number; shared: number; archived: number }> {
    const rows = this.requireDatabase()
      .prepare(
        `SELECT pack_id,
          SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) AS records,
          SUM(CASE WHEN deleted_at IS NULL AND state = 'published' THEN 1 ELSE 0 END) AS published,
          SUM(CASE WHEN deleted_at IS NULL AND state = 'draft' THEN 1 ELSE 0 END) AS drafts,
          SUM(CASE WHEN deleted_at IS NULL AND state = 'published' AND audience <> 'hidden' THEN 1 ELSE 0 END) AS shared,
          SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS archived
        FROM homebrew_records GROUP BY pack_id`
      )
      .all() as Array<{
      pack_id: string;
      records: number;
      published: number;
      drafts: number;
      shared: number;
      archived: number;
    }>;
    return new Map(
      rows.map((row) => [
        row.pack_id,
        {
          records: row.records,
          published: row.published,
          drafts: row.drafts,
          shared: row.shared,
          archived: row.archived
        }
      ])
    );
  }

  /** Published, live records in packs that are switched off, by id, with their pack's name: what the gate warns of. */
  offPackRecords(): ReadonlyMap<string, { name: string; packName: string }> {
    const rows = this.requireDatabase()
      .prepare(
        "SELECT r.id, r.name, p.name AS pack_name FROM homebrew_records r JOIN homebrew_packs p ON p.id = r.pack_id WHERE p.enabled = 0 AND r.state = 'published' AND r.deleted_at IS NULL"
      )
      .all() as Array<{ id: string; name: string; pack_name: string | null }>;
    return new Map(rows.map((row) => [row.id, { name: row.name, packName: row.pack_name ?? "this table" }]));
  }

  /** Each pack's switch, by id. */
  private packSwitches(): Map<string, boolean> {
    const rows = this.requireDatabase().prepare("SELECT id, enabled FROM homebrew_packs").all() as Array<{
      id: string;
      enabled: number;
    }>;
    return new Map(rows.map((row) => [row.id, row.enabled === 1]));
  }

  /** A new imported pack, on. */
  createPack(input: Readonly<{ name: string; credit: string | null }>): HomebrewPackRow {
    const id = randomUUID();
    const stamp = this.stamp();
    this.transaction(() => {
      this.requireDatabase()
        .prepare(
          "INSERT INTO homebrew_packs (id, kind, name, credit, imported_at, enabled, created_at) VALUES (?, 'imported', ?, ?, ?, 1, ?)"
        )
        .run(id, packName(input.name), packCredit(input.credit), stamp, stamp);
      this.bumpRevision();
    });
    return this.getPack(id)!;
  }

  /** Renames, re-credits or switches a pack. Off takes its published records out of every catalog but play's. */
  updatePack(
    id: string,
    change: Readonly<{ name?: string; credit?: string | null; enabled?: boolean }>
  ): HomebrewPackRow {
    const existing = this.getPack(id);
    if (!existing) throw new HomebrewNotFoundError("That pack no longer exists.");
    if (existing.kind === "table" && (change.name !== undefined || change.credit !== undefined))
      throw new HomebrewStateError("This table's own records have no name or credit to change.");
    this.transaction(() => {
      this.requireDatabase()
        .prepare("UPDATE homebrew_packs SET name = ?, credit = ?, enabled = ? WHERE id = ?")
        .run(
          change.name !== undefined ? packName(change.name) : existing.name,
          change.credit !== undefined ? packCredit(change.credit) : existing.credit,
          (change.enabled ?? existing.enabled) ? 1 : 0,
          id
        );
      this.bumpRevision();
    });
    return this.getPack(id)!;
  }

  /** Every id ever minted, including soft-deleted ones: the collision predicate `mintHomebrewId` needs. */
  private isTaken = (id: string): boolean =>
    this.requireDatabase().prepare("SELECT 1 FROM homebrew_records WHERE id = ?").get(id) !== undefined;

  // Writes. `author` is who made the change: `gm:<session id>` for a GM device.

  /** Lands as a hidden draft in this table's pack. `id` is minted from the name; `type` is stripped (the strict
   *  equipment schema would reject it). */
  create(input: HomebrewCreateInput, author = SERVER_AUTHOR): HomebrewRecordRow {
    const type = contentType(input.type);
    const name = recordName(input.body);
    const id = mintHomebrewId(type, name, this.isTaken);
    return this.insert(id, type, input.body, {
      packId: TABLE_PACK_ID,
      basedOn: input.basedOn ?? null,
      event: input.basedOn ? "duplicate" : "create",
      author
    });
  }

  private insert(
    id: string,
    type: HomebrewContentType,
    body: HomebrewBody,
    options: Readonly<{
      packId: string;
      basedOn: HomebrewBasedOn | null;
      event: HomebrewRevisionEvent;
      author: string;
    }>
  ): HomebrewRecordRow {
    const database = this.requireDatabase();
    const name = recordName(body);
    const json = normalizeBody(body, id, type);
    const stamp = this.stamp();
    this.transaction(() => {
      database
        .prepare(
          "INSERT INTO homebrew_records (id, type, name, state, audience, audience_characters, reveals_json, pack_id, based_on_json, deleted_at, body_json, rev, created_at, updated_at) VALUES (?, ?, ?, 'draft', 'hidden', '[]', '[]', ?, ?, NULL, ?, 1, ?, ?)"
        )
        .run(
          id,
          type,
          name,
          options.packId,
          options.basedOn ? JSON.stringify(options.basedOn) : null,
          json,
          stamp,
          stamp
        );
      this.snapshotRevision(
        id,
        {
          rev: 1,
          name,
          state: "draft",
          audience: HIDDEN_AUDIENCE,
          bodyJson: json,
          pending: false,
          at: stamp,
          event: options.event
        },
        options.author
      );
      this.bumpRevision();
    });
    return this.get(id)!;
  }

  /**
   * Replace the whole body. The patch always lands (drafts may be invalid, the editor autosaves). A draft is edited
   * in place; a published record's edit is held as its pending body, so the live body and audience stay as they
   * are mid-edit until `publish` validates and swaps it in. An edit back to the live body clears the pending one.
   */
  update(
    id: string,
    body: HomebrewBody,
    expectedRev: number | undefined,
    author = SERVER_AUTHOR,
    event: HomebrewRevisionEvent = "edit"
  ): HomebrewRecordRow {
    const database = this.requireDatabase();
    const existing = this.requireRow(id, expectedRev);
    const type = existing.type as HomebrewContentType;
    const name = recordName(body);
    const nextBody = normalizeBody(body, id, type);
    const rev = existing.rev + 1;
    const stamp = this.stamp();
    const published = existing.state === "published";
    const pending = published && nextBody !== existing.body_json;
    this.transaction(() => {
      if (published)
        database
          .prepare("UPDATE homebrew_records SET pending_body_json = ?, rev = ?, updated_at = ? WHERE id = ?")
          .run(pending ? nextBody : null, rev, stamp, id);
      else
        database
          .prepare("UPDATE homebrew_records SET name = ?, body_json = ?, rev = ?, updated_at = ? WHERE id = ?")
          .run(name, nextBody, rev, stamp, id);
      this.bumpRevision();
      this.snapshotRevision(
        id,
        {
          rev,
          name,
          state: existing.state as HomebrewContentState,
          audience: audienceOf(existing),
          bodyJson: nextBody,
          pending,
          at: stamp,
          event
        },
        author
      );
    });
    return this.get(id)!;
  }

  /** Publish, or put a published record's pending edits live. The caller validates `pendingBody ?? body` first.
   *  A new publish starts Hidden (a draft always is); an update keeps who sees it. */
  publish(id: string, expectedRev: number | undefined, author = SERVER_AUTHOR): HomebrewRecordRow {
    const existing = this.requireRow(id, expectedRev);
    const bodyJson = existing.pending_body_json ?? existing.body_json;
    return this.rewrite(existing, author, "publish", {
      state: "published",
      bodyJson,
      pendingJson: null
    });
  }

  /** Back to a draft, which is edited in place, so any pending edits become the body. A draft is always Hidden, so
   *  every player loses it at once; its reveal stamps stay as history. */
  unpublish(id: string, expectedRev: number | undefined, author = SERVER_AUTHOR): HomebrewRecordRow {
    const existing = this.requireRow(id, expectedRev);
    return this.rewrite(existing, author, "unpublish", {
      state: "draft",
      bodyJson: existing.pending_body_json ?? existing.body_json,
      pendingJson: null,
      audience: HIDDEN_AUDIENCE
    });
  }

  /** Drops a published record's pending edits. The live body stays as it is. A no-op without any. */
  discardPending(id: string, expectedRev: number | undefined, author = SERVER_AUTHOR): HomebrewRecordRow {
    const existing = this.requireRow(id, expectedRev);
    if (existing.pending_body_json === null) return this.get(id)!;
    return this.rewrite(existing, author, "discard", { pendingJson: null });
  }

  /** Puts an old version back as the editor's copy: a published record's pending body, or a draft's body. Nothing
   *  goes live until Update, and who sees it is not part of a version. */
  restoreRevision(
    id: string,
    revisionId: number,
    expectedRev: number | undefined,
    author = SERVER_AUTHOR
  ): HomebrewRecordRow {
    const existing = this.requireRow(id, expectedRev);
    const revision = this.getRevision(id, revisionId);
    if (!revision) throw new HomebrewNotFoundError("That version of the record no longer exists.");
    return this.update(id, revision.body, existing.rev, author, "revert");
  }

  /** Soft delete: out of every catalog and the default list, data kept. Idempotent. */
  softDelete(id: string, author = SERVER_AUTHOR): { id: string; deletedAt: string } | null {
    const existing = this.recordRow(id);
    if (!existing) return null;
    if (existing.deleted_at) return { id, deletedAt: existing.deleted_at };
    const stamp = this.stamp();
    this.rewrite(existing, author, "archive", { deletedAt: stamp }, stamp);
    return { id, deletedAt: stamp };
  }

  /** Clears `deleted_at`. The record goes back to whatever state and audience it had. */
  restore(id: string, author = SERVER_AUTHOR): HomebrewRecordRow {
    const existing = this.requireRow(id, undefined);
    return this.rewrite(existing, author, "restore", { deletedAt: null });
  }

  /** Publishing does not show a record to players (`setAudience` does). Unpublishing hides it. */
  setState(
    id: string,
    state: HomebrewContentState,
    expectedRev: number | undefined,
    author = SERVER_AUTHOR
  ): HomebrewRecordRow {
    return state === "published" ? this.publish(id, expectedRev, author) : this.unpublish(id, expectedRev, author);
  }

  /** The older on-or-off switch: on is Everyone, off is Hidden. */
  setVisibility(id: string, visibleToPlayers: boolean, expectedRev: number | undefined, author = SERVER_AUTHOR) {
    return this.setAudience(id, visibleToPlayers ? EVERYONE_AUDIENCE : HIDDEN_AUDIENCE, expectedRev, author);
  }

  /** Who sees one record. Only a published, live record can be shown; library audience only (`Actor.visibility`
   *  governs the table separately). The caller checks that character ids name party characters. */
  setAudience(
    id: string,
    audience: HomebrewAudience,
    expectedRev: number | undefined,
    author = SERVER_AUTHOR
  ): HomebrewRecordRow {
    return this.setAudienceMany([{ id, expectedRev }], audience, author)[0]!;
  }

  /** Who sees several records, in one transaction: all of them change or none does. One history row each. */
  setAudienceMany(
    records: ReadonlyArray<Readonly<{ id: string; expectedRev?: number }>>,
    audience: HomebrewAudience,
    author = SERVER_AUTHOR
  ): HomebrewRecordRow[] {
    const next = normalAudience(audience);
    const rows = records.map(({ id, expectedRev }) => {
      const existing = this.requireRow(id, expectedRev);
      if (next.audience !== "hidden" && existing.state !== "published")
        throw new HomebrewStateError(`Publish ${existing.name} before you share it.`);
      if (next.audience !== "hidden" && existing.deleted_at)
        throw new HomebrewStateError(`Restore ${existing.name} before you share it.`);
      return existing;
    });
    const stamp = this.stamp();
    this.transaction(() => {
      for (const existing of rows) this.rewrite(existing, author, "share", { audience: next }, stamp, false);
    });
    return rows.map((row) => this.get(row.id)!);
  }

  /** Deep-copy a homebrew record under a freshly minted id, as a hidden draft in this table's pack. */
  duplicate(id: string, name?: string, author = SERVER_AUTHOR): HomebrewRecordRow {
    const existing = this.recordRow(id);
    if (!existing) throw new HomebrewNotFoundError("That record no longer exists.");
    // What the GM sees in the editor, pending edits included.
    const body = {
      ...(JSON.parse(existing.pending_body_json ?? existing.body_json) as Record<string, unknown>),
      name: name ?? copyName(existing.name)
    };
    return this.create(
      {
        type: existing.type as HomebrewContentType,
        body,
        basedOn: { source: "homebrew", id: existing.id, name: existing.name, copiedAt: this.stamp() }
      },
      author
    );
  }

  /** Import at a caller-chosen id (pack import owns collision policy). Always a hidden draft, in `packId`. */
  importRecord(
    id: string,
    type: HomebrewContentType,
    body: HomebrewBody,
    overwrite: boolean,
    authorTag = SERVER_AUTHOR,
    options: Readonly<{ packId?: string; basedOn?: HomebrewBasedOn | null; event?: HomebrewRevisionEvent }> = {}
  ): HomebrewRecordRow {
    const database = this.requireDatabase();
    const existing = this.recordRow(id);
    if (existing && !overwrite) throw new HomebrewStateError("A record here already has that id.");
    if (existing && existing.type !== type)
      throw new HomebrewStateError(
        `${existing.name} is ${withArticle(kindWords(existing.type as HomebrewContentType))}, so it can't be replaced with ${withArticle(kindWords(type))}.`
      );
    const refusal = existing ? overwriteRefusal(projectSummary(existing)) : null;
    if (refusal) throw new HomebrewStateError(refusal);
    const event = options.event ?? "import";
    if (!existing)
      return this.insert(id, type, body, {
        packId: options.packId ?? TABLE_PACK_ID,
        basedOn: options.basedOn ?? null,
        event,
        author: authorTag
      });
    const name = recordName(body);
    const nextBody = normalizeBody(body, id, type);
    const stamp = this.stamp();
    const rev = existing.rev + 1;
    this.transaction(() => {
      // `deleted_at` is not cleared: a pack import must not resurrect a deleted record.
      // `overwriteRefusal` already refused a deleted row; this is the second check.
      database
        .prepare(
          "UPDATE homebrew_records SET name = ?, body_json = ?, pending_body_json = NULL, state = 'draft', audience = 'hidden', audience_characters = '[]', pack_id = ?, rev = ?, updated_at = ? WHERE id = ?"
        )
        .run(name, nextBody, options.packId ?? existing.pack_id, rev, stamp, id);
      this.snapshotRevision(
        id,
        {
          rev,
          name,
          state: "draft",
          audience: HIDDEN_AUDIENCE,
          bodyJson: nextBody,
          pending: false,
          at: stamp,
          event
        },
        authorTag
      );
      this.bumpRevision();
    });
    return this.get(id)!;
  }

  // Internals

  /**
   * One row change that is not a body edit: state, the live and pending bodies, who sees it, archive. Bumps `rev`
   * and `updated_at`, stamps any audience the record newly reaches, and leaves one history row.
   */
  private rewrite(
    existing: RecordRow,
    author: string,
    event: HomebrewRevisionEvent,
    change: Readonly<{
      state?: HomebrewContentState;
      bodyJson?: string;
      pendingJson?: string | null;
      audience?: HomebrewAudience;
      deletedAt?: string | null;
    }>,
    stamp = this.stamp(),
    ownTransaction = true
  ): HomebrewRecordRow {
    const state = change.state ?? (existing.state as HomebrewContentState);
    const bodyJson = change.bodyJson ?? existing.body_json;
    const pendingJson = change.pendingJson !== undefined ? change.pendingJson : existing.pending_body_json;
    const audience = change.audience ?? audienceOf(existing);
    const deletedAt = change.deletedAt !== undefined ? change.deletedAt : existing.deleted_at;
    const name = recordName(JSON.parse(pendingJson ?? bodyJson) as HomebrewBody);
    const liveName = recordName(JSON.parse(bodyJson) as HomebrewBody);
    const reveals = withReveals(
      parseReveals(existing.reveals_json),
      reachOf(existing.state as HomebrewContentState, audienceOf(existing)),
      reachOf(state, audience),
      stamp
    );
    const rev = existing.rev + 1;
    const work = () => {
      this.requireDatabase()
        .prepare(
          "UPDATE homebrew_records SET state = ?, name = ?, body_json = ?, pending_body_json = ?, audience = ?, audience_characters = ?, reveals_json = ?, deleted_at = ?, rev = ?, updated_at = ? WHERE id = ?"
        )
        .run(
          state,
          // The listed name is the live one for a published record, as before.
          state === "published" ? liveName : name,
          bodyJson,
          pendingJson,
          audience.audience,
          JSON.stringify(audience.characterIds),
          JSON.stringify(reveals),
          deletedAt,
          rev,
          stamp,
          existing.id
        );
      this.snapshotRevision(
        existing.id,
        {
          rev,
          name,
          state,
          audience,
          bodyJson: pendingJson ?? bodyJson,
          pending: pendingJson !== null,
          at: stamp,
          event
        },
        author
      );
      this.bumpRevision();
    };
    if (ownTransaction) this.transaction(work);
    else work();
    return this.get(existing.id)!;
  }

  private recordRow(id: string): RecordRow | undefined {
    return this.requireDatabase().prepare("SELECT * FROM homebrew_records WHERE id = ?").get(id) as
      RecordRow | undefined;
  }

  /** Existence + optimistic-concurrency check, in that order: a stale rev on a missing row is a 404. */
  private requireRow(id: string, expectedRev: number | undefined): RecordRow {
    const existing = this.recordRow(id);
    if (!existing) throw new HomebrewNotFoundError("That record no longer exists.");
    if (expectedRev !== undefined && expectedRev !== existing.rev) {
      throw new HomebrewRevisionConflictError(
        "This record changed on another device since you opened it.",
        existing.rev,
        this.conflictOf(existing, expectedRev)
      );
    }
    return existing;
  }

  /** The fields the stored copy changed since `baseRev`, read from the history row that revision left. */
  private conflictOf(existing: RecordRow, baseRev: number): HomebrewConflict {
    const database = this.requireDatabase();
    const exact = database
      .prepare("SELECT * FROM homebrew_record_revisions WHERE record_id = ? AND rev = ? ORDER BY id DESC LIMIT 1")
      .get(existing.id, baseRev) as RevisionDbRow | undefined;
    // Older data may lack the row; the closest earlier one is the best guess, and says so.
    const base =
      exact ??
      (database
        .prepare(
          "SELECT * FROM homebrew_record_revisions WHERE record_id = ? AND rev < ? ORDER BY rev DESC, id DESC LIMIT 1"
        )
        .get(existing.id, baseRev) as RevisionDbRow | undefined);
    const current = JSON.parse(existing.pending_body_json ?? existing.body_json) as Record<string, unknown>;
    const before = base ? (JSON.parse(base.body_json) as Record<string, unknown>) : {};
    const changes = changedKeys(before, current).map((field) => ({
      field,
      ...(field in before ? { base: before[field] } : {}),
      ...(field in current ? { current: current[field] } : {})
    }));
    const rowChanges: Array<"state" | "audience" | "archived"> = [];
    if (base && base.state !== existing.state) rowChanges.push("state");
    if (base && (base.audience !== existing.audience || base.audience_characters !== existing.audience_characters))
      rowChanges.push("audience");
    if (existing.deleted_at) rowChanges.push("archived");
    return { baseRev, currentRev: existing.rev, baseKnown: exact !== undefined, changes, rowChanges };
  }

  private snapshotRevision(recordId: string, row: Snapshot, authorTag: string) {
    this.requireDatabase()
      .prepare(
        "INSERT INTO homebrew_record_revisions (record_id, rev, name, state, audience, audience_characters, event, pending, body_json, authored_at, author_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        recordId,
        row.rev,
        row.name,
        row.state,
        row.audience.audience,
        JSON.stringify(row.audience.characterIds),
        row.event,
        row.pending ? 1 : 0,
        row.bodyJson,
        row.at,
        authorTag
      );
  }

  /** Always called inside a transaction, so the in-memory counter and the row cannot disagree after a rollback. */
  private bumpRevision() {
    const next = (
      this.requireDatabase()
        .prepare(
          "UPDATE homebrew_meta SET homebrew_revision = homebrew_revision + 1 WHERE id = 1 RETURNING homebrew_revision"
        )
        .get() as { homebrew_revision: number }
    ).homebrew_revision;
    this.revisionValue = next;
  }

  /** Restores the in-memory counter on rollback, so it cannot run ahead of the stored one. */
  private transaction(work: () => void) {
    const before = this.revisionValue;
    try {
      transaction(this.requireDatabase(), work);
    } catch (error) {
      this.revisionValue = before;
      throw error;
    }
  }

  private stamp(): string {
    return new Date(this.now()).toISOString();
  }

  private requireDatabase(): DatabaseSync {
    if (!this.database) throw new Error("HomebrewStore has not been initialized.");
    return this.database;
  }
}

// Parsing stored bodies back into their bundle shapes

/** One schema per type, shared with the SRD bundle (ADR-0016), so the merge is a plain concat. */
const BODY_SCHEMAS = HOMEBREW_BODY_SCHEMAS satisfies Record<
  HomebrewContentType,
  { safeParse: (value: unknown) => { success: boolean } }
>;

/** Fail-soft by contract: a body that no longer parses is dropped by the caller, never thrown from. */
function parseBody(type: HomebrewContentType, json: string): unknown {
  try {
    const parsed = BODY_SCHEMAS[type].safeParse(JSON.parse(json) as unknown);
    return parsed.success ? withBodyProseFacts(type, parsed.data) : undefined;
  } catch {
    return undefined;
  }
}

/** What a body's prose says that play needs as data, filled as the content build fills the SRD's: a spell's area
 *  and cast model (from the columns its author set), and every action's facts wherever the record nests its
 *  actions (a monster's list, an item's, a feature's). */
function withBodyProseFacts(type: HomebrewContentType, body: unknown): unknown {
  if (type !== "spell") return withActionProseFacts(body);
  const spell = body as SpellReference;
  return {
    ...spell,
    area: spell.area ?? areaOfProse(spell.description),
    effect: spell.effect ?? spellEffectFromColumns(spell)
  };
}

function withActionProseFacts(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withActionProseFacts);
  if (!node || typeof node !== "object") return node;
  const record = node as Record<string, unknown>;
  const filled = Object.fromEntries(Object.entries(record).map(([key, value]) => [key, withActionProseFacts(value)]));
  // Only an action has all three once parsed (`damage` defaults to []).
  const isAction =
    typeof record.activation === "string" && typeof record.description === "string" && Array.isArray(record.damage);
  return isAction ? withProseFacts(filled as unknown as ActorAction) : filled;
}

/** The slice under construction: the same nine keys as `HomebrewCatalogSlice`, mutable while filling. */
type DraftSlice = {
  classes: ClassReference[];
  subclasses: SubclassReference[];
  species: SpeciesReference[];
  backgrounds: BackgroundReference[];
  feats: FeatReference[];
  spells: SpellReference[];
  equipment: EquipmentReference[];
  monsters: ActorDefinition[];
  spellLists: SpellListReference[];
};
const emptyDraft = (): DraftSlice => ({
  classes: [],
  subclasses: [],
  species: [],
  backgrounds: [],
  feats: [],
  spells: [],
  equipment: [],
  monsters: [],
  spellLists: []
});
const freezeSlice = (draft: DraftSlice): HomebrewCatalogSlice => Object.freeze(draft);

/** The one place a content type becomes a catalog bucket. A `satisfies` map, so a tenth type fails to compile. */
const BUCKETS = {
  class: "classes",
  subclass: "subclasses",
  species: "species",
  background: "backgrounds",
  feat: "feats",
  spell: "spells",
  equipment: "equipment",
  monster: "monsters",
  "spell-list": "spellLists"
} as const satisfies Record<HomebrewContentType, keyof DraftSlice>;

/**
 * A published slice with one record left out and, optionally, a body in its place (parsed as the catalogs parse
 * it; an unparseable one is left out, as `publishedFor` would). For the publish gate's "what if" catalogs.
 */
export function sliceReplacing(
  slice: HomebrewCatalogSlice,
  id: string,
  replacement?: Readonly<{ type: HomebrewContentType; body: HomebrewBody }>
): HomebrewCatalogSlice {
  const keep = (record: Readonly<{ id: string }>) => record.id !== id;
  const draft: DraftSlice = {
    classes: slice.classes.filter(keep),
    subclasses: slice.subclasses.filter(keep),
    species: slice.species.filter(keep),
    backgrounds: slice.backgrounds.filter(keep),
    feats: slice.feats.filter(keep),
    spells: slice.spells.filter(keep),
    equipment: slice.equipment.filter(keep),
    monsters: slice.monsters.filter((monster) => monster.source?.externalId !== id),
    spellLists: slice.spellLists.filter(keep)
  };
  if (replacement) {
    const parsed = parseBody(replacement.type, JSON.stringify(replacement.body));
    if (parsed) pushInto(draft, replacement.type, parsed);
  }
  return draft;
}

function pushInto(draft: DraftSlice, type: HomebrewContentType, record: unknown) {
  // The type column is CHECK-constrained and contract-parsed on write, so this cast is safe.
  (draft[BUCKETS[type]] as unknown[]).push(record);
}

// Row projection and body hygiene

function projectSummary(row: RecordRow): HomebrewSummaryRow {
  const audience = audienceKind(row.audience);
  return {
    id: row.id,
    type: row.type as HomebrewContentType,
    name: row.name,
    state: row.state as HomebrewContentState,
    audience,
    characterIds: parseStringList(row.audience_characters),
    reveals: parseReveals(row.reveals_json),
    visibleToPlayers: audience !== "hidden",
    packId: row.pack_id,
    basedOn: parseBasedOn(row.based_on_json),
    deletedAt: row.deleted_at,
    rev: row.rev,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function projectRecord(row: RecordRow): HomebrewRecordRow {
  return {
    ...projectSummary(row),
    body: JSON.parse(row.body_json) as HomebrewBody,
    pendingBody: row.pending_body_json === null ? null : (JSON.parse(row.pending_body_json) as HomebrewBody)
  };
}

function projectPack(row: PackDbRow): HomebrewPackRow {
  return {
    id: row.id,
    kind: row.kind === "table" ? "table" : "imported",
    name: row.name,
    credit: row.credit,
    importedAt: row.imported_at,
    enabled: row.enabled === 1
  };
}

/** A history row, with the fields it changed against the row before it. */
function projectRevision(row: RevisionDbRow, previous: RevisionDbRow | null): HomebrewRevisionRead {
  const body = JSON.parse(row.body_json) as Record<string, unknown>;
  const before = previous ? (JSON.parse(previous.body_json) as Record<string, unknown>) : null;
  return {
    id: row.id,
    recordId: row.record_id,
    rev: row.rev,
    name: row.name,
    state: row.state as HomebrewContentState,
    audience: audienceKind(row.audience),
    characterIds: parseStringList(row.audience_characters),
    event: revisionEvent(row.event),
    pending: row.pending === 1,
    authoredAt: row.authored_at,
    authorTag: row.author_tag,
    changedFields: before ? changedKeys(before, body) : [],
    body
  };
}

const REVISION_EVENTS: ReadonlySet<string> = new Set<HomebrewRevisionEvent>([
  "create",
  "edit",
  "publish",
  "unpublish",
  "discard",
  "share",
  "archive",
  "restore",
  "import",
  "duplicate",
  "revert",
  "pack"
]);
const revisionEvent = (value: string): HomebrewRevisionEvent =>
  REVISION_EVENTS.has(value) ? (value as HomebrewRevisionEvent) : "edit";

/** Top-level keys whose values differ, in a stable order. The row id is forced on every write, so it never counts. */
export function changedKeys(before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>) {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => key !== "id");
  return keys.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).sort();
}

const audienceKind = (value: string): HomebrewAudienceKind =>
  value === "everyone" || value === "characters" ? value : "hidden";

function parseStringList(json: string): string[] {
  try {
    const value = JSON.parse(json) as unknown;
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function parseReveals(json: string): HomebrewReveal[] {
  try {
    const value = JSON.parse(json) as unknown;
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) =>
      entry &&
      typeof entry === "object" &&
      typeof (entry as HomebrewReveal).to === "string" &&
      typeof (entry as HomebrewReveal).at === "string"
        ? [{ to: (entry as HomebrewReveal).to, at: (entry as HomebrewReveal).at }]
        : []
    );
  } catch {
    return [];
  }
}

function parseBasedOn(json: string | null): HomebrewBasedOn | null {
  if (json === null) return null;
  try {
    const value = JSON.parse(json) as Partial<HomebrewBasedOn>;
    return (value.source === "srd" || value.source === "homebrew") &&
      typeof value.id === "string" &&
      typeof value.name === "string" &&
      typeof value.copiedAt === "string"
      ? { source: value.source, id: value.id, name: value.name, copiedAt: value.copiedAt }
      : null;
  } catch {
    return null;
  }
}

function audienceOf(row: Pick<RecordRow, "audience" | "audience_characters">): HomebrewAudience {
  const audience = audienceKind(row.audience);
  return { audience, characterIds: audience === "characters" ? parseStringList(row.audience_characters) : [] };
}

/** Characters only with `characters`, each once; `characters` with none is Hidden. */
function normalAudience(audience: HomebrewAudience): HomebrewAudience {
  if (audience.audience !== "characters") return { audience: audience.audience, characterIds: [] };
  const characterIds = [...new Set(audience.characterIds)];
  return characterIds.length === 0 ? HIDDEN_AUDIENCE : { audience: "characters", characterIds };
}

/** Who a record in this state reaches: `everyone`, character ids, or nobody (a draft never reaches anyone). */
function reachOf(state: HomebrewContentState, audience: HomebrewAudience): ReadonlySet<string> {
  if (state !== "published") return new Set();
  if (audience.audience === "everyone") return new Set(["everyone"]);
  return new Set(audience.audience === "characters" ? audience.characterIds : []);
}

/** A stamp for each audience the record reaches after this write and did not before it. Hiding keeps the old stamps. */
function withReveals(
  reveals: readonly HomebrewReveal[],
  before: ReadonlySet<string>,
  after: ReadonlySet<string>,
  at: string
): HomebrewReveal[] {
  return [...reveals, ...[...after].filter((to) => !before.has(to)).map((to) => ({ to, at }))];
}

const MAX_PACK_NAME = 120;
const MAX_PACK_CREDIT = 400;
function packName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new HomebrewStateError("Name the pack.");
  if (name.length > MAX_PACK_NAME)
    throw new HomebrewStateError(`Keep the pack's name under ${MAX_PACK_NAME} characters.`);
  return name;
}
function packCredit(raw: string | null): string | null {
  const credit = raw?.trim() ?? "";
  if (credit.length > MAX_PACK_CREDIT)
    throw new HomebrewStateError(`Keep the pack's credit under ${MAX_PACK_CREDIT} characters.`);
  return credit === "" ? null : credit;
}

/** A kind in plain words, for messages. */
export function kindWords(type: HomebrewContentType): string {
  return type === "equipment" ? "item" : type === "spell-list" ? "spell list" : type;
}

/**
 * Why a pack import must not overwrite this row (published or deleted), or null. Imported bodies are unvalidated
 * and the report cannot announce a silent demotion. Exported so a dry run reports the same refusal.
 */
export function overwriteRefusal(row: Pick<HomebrewSummaryRow, "state" | "audience" | "deletedAt">): string | null {
  if (row.deletedAt)
    return "Your record with this id is archived. Restore it before you replace it, or import this one as new.";
  if (row.state === "published") {
    return row.audience !== "hidden"
      ? "Your record with this id is published and shared, so replacing it would take it away from players. Import this one as new."
      : "Your record with this id is published. Unpublish it before you replace it, or import this one as new.";
  }
  return null;
}

/** The type list is the contract's; a value outside it would otherwise fail as a raw SQLite CHECK error. */
function contentType(value: string): HomebrewContentType {
  const parsed = HomebrewContentTypeSchema.safeParse(value);
  if (!parsed.success) throw new HomebrewStateError("That kind of record is not one this table can make.");
  return parsed.data;
}

/** Validates only that the body is a JSON object with a usable name; drafts may otherwise be invalid. */
export function recordName(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new HomebrewStateError("Send the record as an object of its fields.");
  const raw = (body as Record<string, unknown>).name;
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) throw new HomebrewStateError("Name this record.");
  if (name.length > MAX_NAME) throw new HomebrewStateError(`Keep the name under ${MAX_NAME} characters.`);
  return name;
}

/**
 * Serialize with `id` forced to the row id (the client's is never trusted) and `type` stripped. A monster's
 * `source.externalId` is forced too: it becomes `Actor.definitionId`, and an arbitrary value would break the next boot.
 * Every other type's `source` is forced to "homebrew", so an API body or a pack that omits it is never badged SRD.
 */
/** A body as it would be stored at `id`: what the publish gate should judge for an import that lands there. */
export function bodyAt(body: HomebrewBody, id: string, type: HomebrewContentType): HomebrewBody {
  return JSON.parse(normalizeBody(body, id, type)) as HomebrewBody;
}

function normalizeBody(body: HomebrewBody, id: string, type: HomebrewContentType): string {
  const { type: _type, ...rest } = body as Record<string, unknown>;
  const source = rest.source;
  const withIdentity =
    type === "monster"
      ? {
          ...rest,
          id,
          source: {
            ...(source && typeof source === "object" && !Array.isArray(source)
              ? source
              : { name: "Homebrew", version: "1" }),
            externalId: id
          }
        }
      : { ...rest, id, source: "homebrew" };
  const json = JSON.stringify(withIdentity);
  if (json.length > MAX_BODY_BYTES) throw new HomebrewStateError("That record is too large to store.");
  return json;
}

/** "(copy)" once, never "(copy) (copy)". Exported so the SRD-duplicate path names its copies the same way. */
export function copyName(name: string): string {
  const copy = /\(copy( \d+)?\)$/.test(name) ? name : `${name} (copy)`;
  return copy.length > MAX_NAME ? copy.slice(0, MAX_NAME) : copy;
}

/** `%` and `_` are LIKE wildcards; a GM searching for "Wand_" means the literal character. */
function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Opaque to clients. Carries only the last row's id, so it stays under the contract's 200-character cap. */
function encodeCursor(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url");
}
function decodeCursor(cursor: string | undefined): string | null {
  if (!cursor) return null;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  return /^[a-z0-9-]{1,60}$/.test(decoded) ? decoded : null;
}
