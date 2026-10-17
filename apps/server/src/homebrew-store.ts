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
import {
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
 * (drafts, hidden, deleted); only `publishedFor` and `ContentLibrary.forAudience` filter for an audience.
 */

/** The authored body, in its own bundle schema shape (ADR-0016). */
export type HomebrewBody = Readonly<Record<string, unknown>>;

export type HomebrewRecordRow = Readonly<{
  id: string;
  type: HomebrewContentType;
  /** Denormalised from `body.name` so the library rail can list, sort and filter without parsing every body. */
  name: string;
  state: HomebrewContentState;
  visibleToPlayers: boolean;
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

export type HomebrewCreateInput = Readonly<{ type: HomebrewContentType; body: HomebrewBody }>;

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
export type HomebrewRevisionRow = Readonly<{
  id: number;
  recordId: string;
  rev: number;
  name: string;
  state: HomebrewContentState;
  visibleToPlayers: boolean;
  authoredAt: string;
  authorTag: string;
}>;

/** Thrown when a write's `expectedRev` does not match the stored row - the editor's copy is stale. */
export class HomebrewRevisionConflictError extends Error {
  constructor(
    message: string,
    readonly currentRev: number
  ) {
    super(message);
  }
}
/** Thrown when the addressed record does not exist (or was never created). */
export class HomebrewNotFoundError extends Error {}
/** Thrown when the row's state refuses the requested transition (e.g. making a draft player-visible). */
export class HomebrewStateError extends Error {}

const MAX_NAME = 120;
const MAX_BODY_BYTES = 512_000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Literal because migration SQL must be frozen; a test asserts it still matches the contract. */
const TYPE_CHECK_LIST = "'class','subclass','species','background','feat','spell','equipment','monster','spell-list'";

const MIGRATIONS: readonly Migration[] = [
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
  }
];

type RecordRow = {
  id: string;
  type: string;
  name: string;
  state: string;
  visible_to_players: number;
  deleted_at: string | null;
  body_json: string;
  pending_body_json: string | null;
  rev: number;
  created_at: string;
  updated_at: string;
};

export class HomebrewStore implements HomebrewContentSource {
  private database?: DatabaseSync;
  /** In memory: read on every catalog access. -1 before `initialize()`, so early reads get an SRD-only view. */
  private revisionValue = -1;
  /** Parsed catalog slices for both audiences, rebuilt only when `revisionValue` moves. */
  private slices?: { revision: number; gm: HomebrewCatalogSlice; player: HomebrewCatalogSlice };
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
      migrate(database, "homebrew", MIGRATIONS, {
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
    // Dropped rather than left to the revision gate: a reopened store's counter could coincide with a
    // cached revision from the previous handle.
    this.slices = undefined;
    this.monsters = undefined;
    this.authored = undefined;
  }

  /** The coarse counter bumped inside every write transaction - drives `homebrew:changed` and the view cache. */
  get revision(): number {
    return this.revisionValue;
  }

  // HomebrewContentSource (the ContentLibrary seam)

  /**
   * Published, non-deleted records for an audience. Security: drafts are in no catalog for anyone, and the player
   * slice also requires `visible_to_players = 1`. Unparseable bodies are dropped and logged, never thrown.
   */
  publishedFor(audience: ContentAudience): HomebrewCatalogSlice {
    if (!this.database) return EMPTY_HOMEBREW_SLICE; // pre-initialize: revision -1, SRD-only view
    if (!this.slices || this.slices.revision !== this.revisionValue)
      this.slices = { revision: this.revisionValue, ...this.buildSlices() };
    return audience === "gm" ? this.slices.gm : this.slices.player;
  }

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

  /** One pass over the published, live rows, parsed into the nine bundle shapes for both audiences at once. */
  private buildSlices(): { gm: HomebrewCatalogSlice; player: HomebrewCatalogSlice } {
    const gm = emptyDraft();
    const player = emptyDraft();
    const rows = this.requireDatabase()
      .prepare(
        "SELECT id, type, visible_to_players, body_json FROM homebrew_records WHERE state = 'published' AND deleted_at IS NULL"
      )
      .all() as Array<{ id: string; type: string; visible_to_players: number; body_json: string }>;
    const dropped: string[] = [];
    for (const row of rows) {
      const parsed = parseBody(row.type as HomebrewContentType, row.body_json);
      if (!parsed) {
        dropped.push(`${row.type} "${row.id}"`);
        continue;
      }
      pushInto(gm, row.type as HomebrewContentType, parsed);
      if (row.visible_to_players === 1) pushInto(player, row.type as HomebrewContentType, parsed);
    }
    if (dropped.length > 0) {
      // Logged once per rebuild: a schema tightening drops every row of a type at once.
      console.warn(
        `[homebrew] ${dropped.length} published record(s) no longer parse and were left out of the catalogs: ${dropped.join(", ")}`
      );
    }
    return { gm: freezeSlice(gm), player: freezeSlice(player) };
  }

  /** Every monster row, ignoring `state` and `deleted_at` - see `monsterForInstance`. */
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
    if (filter.visibleToPlayers !== undefined) {
      where.push("visible_to_players = ?");
      parameters.push(filter.visibleToPlayers ? 1 : 0);
    }
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
    // The cursor is opaque, so an unresolvable one restarts from the top rather than failing.
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

  listRevisions(id: string): readonly HomebrewRevisionRow[] {
    const rows = this.requireDatabase()
      .prepare(
        "SELECT id, record_id, rev, name, state, visible_to_players, authored_at, author_tag FROM homebrew_record_revisions WHERE record_id = ? ORDER BY rev DESC"
      )
      .all(id) as Array<{
      id: number;
      record_id: string;
      rev: number;
      name: string;
      state: string;
      visible_to_players: number;
      authored_at: string;
      author_tag: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      recordId: row.record_id,
      rev: row.rev,
      name: row.name,
      state: row.state as HomebrewContentState,
      visibleToPlayers: row.visible_to_players === 1,
      authoredAt: row.authored_at,
      authorTag: row.author_tag
    }));
  }

  /** Every id ever minted, including soft-deleted ones: the collision predicate `mintHomebrewId` needs. */
  private isTaken = (id: string): boolean =>
    this.requireDatabase().prepare("SELECT 1 FROM homebrew_records WHERE id = ?").get(id) !== undefined;

  // Writes

  /** Lands as an invisible draft. `id` is forced to the minted one; `type` is stripped (the strict equipment schema would reject it). */
  create(input: HomebrewCreateInput): HomebrewRecordRow {
    const database = this.requireDatabase();
    const type = contentType(input.type);
    const name = recordName(input.body);
    const id = mintHomebrewId(type, name, this.isTaken);
    const body = normalizeBody(input.body, id, type);
    const stamp = this.stamp();
    this.transaction(() => {
      database
        .prepare(
          "INSERT INTO homebrew_records (id, type, name, state, visible_to_players, deleted_at, body_json, rev, created_at, updated_at) VALUES (?, ?, ?, 'draft', 0, NULL, ?, 1, ?, ?)"
        )
        .run(id, type, name, body, stamp, stamp);
      this.snapshotRevision(
        id,
        { rev: 1, name, state: "draft", visibleToPlayers: false, bodyJson: body, at: stamp },
        "homebrew:create"
      );
      this.bumpRevision();
    });
    return this.get(id)!;
  }

  /**
   * Replace the whole body. The patch always lands (drafts may be invalid, the editor autosaves). A draft is edited
   * in place; a published record's edit is held as its pending body, so the live body and visibility stay as they
   * are mid-edit until `publish` validates and swaps it in. An edit back to the live body clears the pending one.
   */
  update(id: string, body: HomebrewBody, expectedRev: number | undefined, authorTag: string): HomebrewRecordRow {
    const database = this.requireDatabase();
    const existing = this.requireRow(id, expectedRev);
    const type = existing.type as HomebrewContentType;
    const name = recordName(body);
    const nextBody = normalizeBody(body, id, type);
    const rev = existing.rev + 1;
    const stamp = this.stamp();
    const published = existing.state === "published";
    this.transaction(() => {
      if (published)
        database
          .prepare("UPDATE homebrew_records SET pending_body_json = ?, rev = ?, updated_at = ? WHERE id = ?")
          .run(nextBody === existing.body_json ? null : nextBody, rev, stamp, id);
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
          visibleToPlayers: existing.visible_to_players === 1,
          bodyJson: nextBody,
          at: stamp
        },
        published ? `${authorTag}:pending` : authorTag
      );
    });
    return this.get(id)!;
  }

  /** Publish, or put a published record's pending edits live. The caller validates `pendingBody ?? body` first. */
  publish(id: string, expectedRev: number | undefined): HomebrewRecordRow {
    const database = this.requireDatabase();
    const existing = this.requireRow(id, expectedRev);
    const stamp = this.stamp();
    const bodyJson = existing.pending_body_json ?? existing.body_json;
    const name = recordName(JSON.parse(bodyJson) as HomebrewBody);
    this.transaction(() => {
      database
        .prepare(
          "UPDATE homebrew_records SET state = 'published', name = ?, body_json = ?, pending_body_json = NULL, rev = rev + 1, updated_at = ? WHERE id = ?"
        )
        .run(name, bodyJson, stamp, id);
      this.bumpRevision();
    });
    return this.get(id)!;
  }

  /** Back to a draft, which is edited in place, so any pending edits become the body. Visibility is kept. */
  unpublish(id: string, expectedRev: number | undefined): HomebrewRecordRow {
    const database = this.requireDatabase();
    const existing = this.requireRow(id, expectedRev);
    const stamp = this.stamp();
    const bodyJson = existing.pending_body_json ?? existing.body_json;
    const name = recordName(JSON.parse(bodyJson) as HomebrewBody);
    this.transaction(() => {
      database
        .prepare(
          "UPDATE homebrew_records SET state = 'draft', name = ?, body_json = ?, pending_body_json = NULL, rev = rev + 1, updated_at = ? WHERE id = ?"
        )
        .run(name, bodyJson, stamp, id);
      this.bumpRevision();
    });
    return this.get(id)!;
  }

  /** Drops a published record's pending edits, leaving the live body as it is. A no-op without any. */
  discardPending(id: string, expectedRev: number | undefined): HomebrewRecordRow {
    const database = this.requireDatabase();
    const existing = this.requireRow(id, expectedRev);
    if (existing.pending_body_json === null) return this.get(id)!;
    const stamp = this.stamp();
    this.transaction(() => {
      database
        .prepare("UPDATE homebrew_records SET pending_body_json = NULL, rev = rev + 1, updated_at = ? WHERE id = ?")
        .run(stamp, id);
      this.bumpRevision();
    });
    return this.get(id)!;
  }

  /** Soft delete: out of both catalogs and the default list, data kept. Idempotent. */
  softDelete(id: string): { id: string; deletedAt: string } | null {
    const database = this.requireDatabase();
    const existing = this.recordRow(id);
    if (!existing) return null;
    if (existing.deleted_at) return { id, deletedAt: existing.deleted_at };
    const stamp = this.stamp();
    this.transaction(() => {
      database
        .prepare("UPDATE homebrew_records SET deleted_at = ?, rev = rev + 1, updated_at = ? WHERE id = ?")
        .run(stamp, stamp, id);
      this.bumpRevision();
    });
    return { id, deletedAt: stamp };
  }

  /** Clears `deleted_at`, returning the record to whatever `state`/`visibleToPlayers` it had. */
  restore(id: string): HomebrewRecordRow {
    const database = this.requireDatabase();
    this.requireRow(id, undefined);
    const stamp = this.stamp();
    this.transaction(() => {
      database
        .prepare("UPDATE homebrew_records SET deleted_at = NULL, rev = rev + 1, updated_at = ? WHERE id = ?")
        .run(stamp, id);
      this.bumpRevision();
    });
    return this.get(id)!;
  }

  /** Publishing does not show a record to players (`setVisibility` does). Unpublishing keeps the visibility choice. */
  setState(id: string, state: HomebrewContentState, expectedRev: number | undefined): HomebrewRecordRow {
    return state === "published" ? this.publish(id, expectedRev) : this.unpublish(id, expectedRev);
  }

  /** Draft + visible is refused. This is library visibility only; `Actor.visibility` governs the table separately. */
  setVisibility(id: string, visibleToPlayers: boolean, expectedRev: number | undefined): HomebrewRecordRow {
    const database = this.requireDatabase();
    const existing = this.requireRow(id, expectedRev);
    if (visibleToPlayers && existing.state !== "published")
      throw new HomebrewStateError("Publish this first. A draft can't be shown to players.");
    const stamp = this.stamp();
    this.transaction(() => {
      database
        .prepare("UPDATE homebrew_records SET visible_to_players = ?, rev = rev + 1, updated_at = ? WHERE id = ?")
        .run(visibleToPlayers ? 1 : 0, stamp, id);
      this.bumpRevision();
    });
    return this.get(id)!;
  }

  /** Deep-copy a homebrew record under a freshly minted id. The copy always lands as an invisible draft. */
  duplicate(id: string, name?: string): HomebrewRecordRow {
    const existing = this.recordRow(id);
    if (!existing) throw new HomebrewNotFoundError("That record no longer exists.");
    // What the GM sees in the editor, pending edits included.
    const body = {
      ...(JSON.parse(existing.pending_body_json ?? existing.body_json) as Record<string, unknown>),
      name: copyName(name ?? existing.name)
    };
    return this.create({ type: existing.type as HomebrewContentType, body });
  }

  /** Import at a caller-chosen id (pack import owns collision policy). Always an invisible draft. */
  importRecord(
    id: string,
    type: HomebrewContentType,
    body: HomebrewBody,
    overwrite: boolean,
    authorTag = "homebrew:import"
  ): HomebrewRecordRow {
    const database = this.requireDatabase();
    const existing = this.recordRow(id);
    if (existing && !overwrite) throw new HomebrewStateError(`A record already exists at "${id}".`);
    if (existing && existing.type !== type)
      throw new HomebrewStateError(`"${id}" is ${withArticle(existing.type)}, not ${withArticle(type)}.`);
    const refusal = existing ? overwriteRefusal(projectSummary(existing)) : null;
    if (refusal) throw new HomebrewStateError(refusal);
    const name = recordName(body);
    const nextBody = normalizeBody(body, id, type);
    const stamp = this.stamp();
    const rev = existing ? existing.rev + 1 : 1;
    this.transaction(() => {
      if (existing) {
        // `deleted_at` is not cleared: a pack import must not resurrect a deleted record.
        // `overwriteRefusal` already refused a deleted row; this is the second check.
        database
          .prepare(
            "UPDATE homebrew_records SET name = ?, body_json = ?, pending_body_json = NULL, state = 'draft', visible_to_players = 0, rev = ?, updated_at = ? WHERE id = ?"
          )
          .run(name, nextBody, rev, stamp, id);
      } else {
        database
          .prepare(
            "INSERT INTO homebrew_records (id, type, name, state, visible_to_players, deleted_at, body_json, rev, created_at, updated_at) VALUES (?, ?, ?, 'draft', 0, NULL, ?, ?, ?, ?)"
          )
          .run(id, type, name, nextBody, rev, stamp, stamp);
      }
      this.snapshotRevision(
        id,
        { rev, name, state: "draft", visibleToPlayers: false, bodyJson: nextBody, at: stamp },
        authorTag
      );
      this.bumpRevision();
    });
    return this.get(id)!;
  }

  // Internals

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
        "This record changed since you opened it. Reload to keep editing.",
        existing.rev
      );
    }
    return existing;
  }

  private snapshotRevision(
    recordId: string,
    row: {
      rev: number;
      name: string;
      state: HomebrewContentState;
      visibleToPlayers: boolean;
      bodyJson: string;
      at: string;
    },
    authorTag: string
  ) {
    this.requireDatabase()
      .prepare(
        "INSERT INTO homebrew_record_revisions (record_id, rev, name, state, visible_to_players, body_json, authored_at, author_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(recordId, row.rev, row.name, row.state, row.visibleToPlayers ? 1 : 0, row.bodyJson, row.at, authorTag);
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

/** The slice under construction - the same nine keys as `HomebrewCatalogSlice`, mutable while filling. */
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
  return {
    id: row.id,
    type: row.type as HomebrewContentType,
    name: row.name,
    state: row.state as HomebrewContentState,
    visibleToPlayers: row.visible_to_players === 1,
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

/**
 * Why a pack import must not overwrite this row (published or deleted), or null. Imported bodies are unvalidated
 * and the report cannot announce a silent demotion. Exported so a dry run reports the same refusal.
 */
export function overwriteRefusal(
  row: Pick<HomebrewSummaryRow, "state" | "visibleToPlayers" | "deletedAt">
): string | null {
  if (row.deletedAt)
    return "That record was deleted here. Restore it before overwriting it, or import with re-mint to land a fresh copy.";
  if (row.state === "published") {
    return row.visibleToPlayers
      ? "That record is published and shown to players, so overwriting it would take it away from them mid-session. Unpublish it first, or import with re-mint."
      : "That record is published. Unpublish it before overwriting it, or import with re-mint to land a fresh copy.";
  }
  return null;
}

/** The type list is the contract's; a value outside it would otherwise fail as a raw SQLite CHECK error. */
function contentType(value: string): HomebrewContentType {
  const parsed = HomebrewContentTypeSchema.safeParse(value);
  if (!parsed.success) throw new HomebrewStateError(`"${value}" is not a homebrew content type.`);
  return parsed.data;
}

/** Validates only that the body is a JSON object with a usable name; drafts may otherwise be invalid. */
export function recordName(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new HomebrewStateError("The record must be a JSON object.");
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

/** Opaque to clients. Carries only the last row's id, keeping it under the contract's 200-character cap. */
function encodeCursor(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url");
}
function decodeCursor(cursor: string | undefined): string | null {
  if (!cursor) return null;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  return /^[a-z0-9-]{1,60}$/.test(decoded) ? decoded : null;
}
