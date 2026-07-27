import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HomebrewContentTypeSchema, type HomebrewContentState, type HomebrewContentType } from "@vtt/api-contract";
import type { ActorDefinition } from "@vtt/schemas";
import { EMPTY_HOMEBREW_SLICE, type ContentAudience, type HomebrewCatalogSlice, type HomebrewContentSource } from "./content-library.js";
import { mintHomebrewId } from "./homebrew-ids.js";

/**
 * GM-authored homebrew content persistence: the nine authorable content types in their OWN tables
 * inside the shared game database, mutated through GM-gated REST routes (`homebrew-http.ts`).
 *
 * Structurally this is the Codex store (`codex-store.ts`) again - own migration table, own migration
 * array, `BEGIN IMMEDIATE` transactions, STRICT tables, WAL, a coarse revision counter, soft delete
 * and a per-row revision log. Matching that pattern is deliberate: it is the shape this codebase
 * already reviews, tests and operates.
 *
 * **Homebrew records are NOT GameState.** Nothing here is broadcast, projected or persisted into the
 * game document; a write only bumps `revision`, which pings clients to refetch (`homebrew:changed`)
 * and invalidates `ContentLibrary`'s per-audience view cache. That is what leaves
 * `apps/server/src/projections.ts` untouched by this whole feature, keeping viewer safety structural.
 *
 * **Viewer-safety note, and it is the important one.** This store returns RAW rows - drafts,
 * GM-only records, soft-deleted records, all of them. Audience filtering happens in exactly two
 * places and never here: `publishedFor(audience)` below, and `ContentLibrary.forAudience`. Every
 * route that returns a raw row is `requireGm`.
 */

/** The row's authored body: the record in its OWN bundle schema shape, never a fork (ADR-0016). */
export type HomebrewBody = Readonly<Record<string, unknown>>;

export type HomebrewRecordRow = Readonly<{
  id: string;
  type: HomebrewContentType;
  /** Denormalised from `body.name` so the library rail can list, sort and filter without parsing every body. */
  name: string;
  state: HomebrewContentState;
  visibleToPlayers: boolean;
  /** NULL = live. Soft delete only; there is no hard delete in v1 (decision 10). */
  deletedAt: string | null;
  rev: number;
  createdAt: string;
  updatedAt: string;
  /** Parsed `body_json`. Carries `id` (forced to the row id) but NOT `type` - see `create` below. */
  body: HomebrewBody;
}>;

/** The list row: everything but the authored body, so a few-hundred-record library is a small payload. */
export type HomebrewSummaryRow = Omit<HomebrewRecordRow, "body">;

export type HomebrewCreateInput = Readonly<{ type: HomebrewContentType; body: HomebrewBody }>;
export type HomebrewListFilter = Readonly<{
  type?: HomebrewContentType;
  state?: HomebrewContentState;
  visibleToPlayers?: boolean;
  /** Case-insensitive name substring. Deliberately not full-text search - FTS is deferred. */
  q?: string;
  includeDeleted?: boolean;
  limit?: number;
  cursor?: string;
}>;
export type HomebrewListPage = Readonly<{ rows: readonly HomebrewSummaryRow[]; nextCursor: string | null; total: number }>;
export type HomebrewRevisionRow = Readonly<{ id: number; recordId: string; rev: number; name: string; state: HomebrewContentState; visibleToPlayers: boolean; authoredAt: string; authorTag: string }>;

/** Thrown when a write's `expectedRev` does not match the stored row - the editor's copy is stale. */
export class HomebrewRevisionConflictError extends Error {
  constructor(message: string, readonly currentRev: number) { super(message); }
}
/** Thrown when the addressed record does not exist (or was never created). */
export class HomebrewNotFoundError extends Error {}
/** Thrown when the row's state refuses the requested transition (e.g. making a draft player-visible). */
export class HomebrewStateError extends Error {}

const MAX_NAME = 120;
const MAX_BODY_BYTES = 512_000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * The nine authorable types, spelled literally because migration SQL must be frozen: deriving this
 * list from `HomebrewContentTypeSchema` at import time would let a later contract edit silently
 * change what migration v1 creates on a fresh database while doing nothing to an existing one.
 * `homebrew-store.test.ts` asserts this list still equals the contract's, so a contract change fails
 * loudly and forces a real migration instead of drifting.
 */
const TYPE_CHECK_LIST = "'class','subclass','species','background','feat','spell','equipment','monster','spell-list'";

export const MIGRATIONS = [{
  version: 1,
  sql: `
    CREATE TABLE homebrew_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      homebrew_revision INTEGER NOT NULL
    ) STRICT;
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
  `
}];

type RecordRow = {
  id: string; type: string; name: string; state: string; visible_to_players: number;
  deleted_at: string | null; body_json: string; rev: number; created_at: string; updated_at: string;
};

export class HomebrewStore implements HomebrewContentSource {
  private database?: DatabaseSync;
  /**
   * In-memory, deliberately: `ContentLibrary.forAudience` consults it on EVERY catalog accessor, and
   * `CodexStore.revision` runs a SQL query per read. -1 until `initialize()` completes, which is what
   * lets `ContentLibrary` be constructed synchronously (server.ts) against a store that initialises
   * asynchronously - a pre-initialize read builds an SRD-only view and the first read afterwards
   * rebuilds, with no construction-order change anywhere.
   */
  private revisionValue = -1;

  constructor(private readonly databasePath: string, private readonly now: () => number = Date.now) {}

  async initialize() {
    if (this.database) return;
    await mkdir(dirname(this.databasePath), { recursive: true });
    const database = new DatabaseSync(this.databasePath, { enableForeignKeyConstraints: true });
    try {
      database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
      database.exec("CREATE TABLE IF NOT EXISTS homebrew_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;");
      this.database = database;
      this.migrate();
      const meta = database.prepare("SELECT homebrew_revision FROM homebrew_meta WHERE id = 1").get() as { homebrew_revision: number } | undefined;
      if (!meta) database.prepare("INSERT INTO homebrew_meta (id, homebrew_revision) VALUES (1, 0)").run();
      this.revisionValue = meta?.homebrew_revision ?? 0;
    } catch (error) {
      database.close();
      this.database = undefined;
      this.revisionValue = -1;
      throw error;
    }
  }

  close() { this.database?.close(); this.database = undefined; this.revisionValue = -1; }

  /** The coarse counter bumped inside every write transaction - drives `homebrew:changed` and the view cache. */
  get revision(): number { return this.revisionValue; }

  // ---------- HomebrewContentSource (the ContentLibrary seam) ----------

  /**
   * Published, non-deleted records for one audience, parsed into their bundle shapes.
   *
   * SLICE 1: intentionally EMPTY for both audiences. Bodies are opaque JSON until the per-type
   * publish validation lands, so there is nothing safe to merge yet and `ContentLibrary` keeps
   * returning its shared SRD-only view - byte-identical to the pre-homebrew path. The seam is wired
   * now (server.ts passes this store to `new ContentLibrary(...)`) so the revision gate is exercised
   * from the first slice rather than being introduced alongside the merge it guards.
   *
   * When it is filled in: parse `body_json` through the record's own Zod schema and DROP anything
   * that fails, logging once. A published record was valid at publish time, so a failure here means
   * the schema tightened underneath stored data - fail soft, never throw, because one bad row must
   * not take down every catalog.
   */
  publishedFor(_audience: ContentAudience): HomebrewCatalogSlice { return EMPTY_HOMEBREW_SLICE; }

  /**
   * The play-time escape hatch: any monster row regardless of state or `deleted_at`, so a live actor
   * never loses its actions, typed defences or recharge behaviour mid-fight.
   *
   * SLICE 1: always undefined - monsters merge in slice 3, and returning a half-parsed definition
   * would be worse than returning none.
   */
  monsterForInstance(_definitionId: string): ActorDefinition | undefined { return undefined; }

  // ---------- Reads ----------

  get(id: string): HomebrewRecordRow | undefined {
    const row = this.recordRow(id);
    return row ? projectRecord(row) : undefined;
  }

  /**
   * Keyset paging, ordered by `LOWER(name), id`. Deliberately NOT `updated_at`: the GM publishing
   * mid-scroll must not skip or duplicate a row, and publishing moves `updated_at` while leaving the
   * name alone. `id` breaks ties and is immutable, so the order is total.
   */
  list(filter: HomebrewListFilter = {}): HomebrewListPage {
    const database = this.requireDatabase();
    const where: string[] = [];
    const parameters: Array<string | number> = [];
    if (filter.type) { where.push("type = ?"); parameters.push(filter.type); }
    if (filter.state) { where.push("state = ?"); parameters.push(filter.state); }
    if (filter.visibleToPlayers !== undefined) { where.push("visible_to_players = ?"); parameters.push(filter.visibleToPlayers ? 1 : 0); }
    if (filter.q) { where.push("name LIKE ? ESCAPE '\\'"); parameters.push(`%${likeEscape(filter.q)}%`); }
    if (!filter.includeDeleted) where.push("deleted_at IS NULL");
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const total = (database.prepare(`SELECT COUNT(*) AS total FROM homebrew_records ${clause}`).get(...parameters) as { total: number }).total;

    // Resolve the cursor's sort key from the row rather than carrying it in the token: a 120-character
    // name plus a 60-character id would encode to ~250 characters and the contract caps `cursor` at 200.
    const cursorId = decodeCursor(filter.cursor);
    const anchor = cursorId
      ? database.prepare("SELECT LOWER(name) AS sort_key FROM homebrew_records WHERE id = ?").get(cursorId) as { sort_key: string } | undefined
      : undefined;
    const pageWhere = [...where];
    const pageParameters = [...parameters];
    // An unresolvable cursor (mangled, or an id that never existed) restarts from the top rather than
    // 500ing: the value is opaque, so a client cannot have meant anything by it.
    if (anchor && cursorId) { pageWhere.push("(LOWER(name), id) > (?, ?)"); pageParameters.push(anchor.sort_key, cursorId); }
    const pageClause = pageWhere.length ? `WHERE ${pageWhere.join(" AND ")}` : "";
    const limit = Math.min(Math.max(Math.trunc(filter.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
    // Fetch one extra row: its existence (not a count comparison) is what says another page follows.
    const rows = database.prepare(`SELECT * FROM homebrew_records ${pageClause} ORDER BY LOWER(name), id LIMIT ?`).all(...pageParameters, limit + 1) as RecordRow[];
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
      .prepare("SELECT id, record_id, rev, name, state, visible_to_players, authored_at, author_tag FROM homebrew_record_revisions WHERE record_id = ? ORDER BY rev DESC")
      .all(id) as Array<{ id: number; record_id: string; rev: number; name: string; state: string; visible_to_players: number; authored_at: string; author_tag: string }>;
    return rows.map((row) => ({
      id: row.id, recordId: row.record_id, rev: row.rev, name: row.name,
      state: row.state as HomebrewContentState, visibleToPlayers: row.visible_to_players === 1,
      authoredAt: row.authored_at, authorTag: row.author_tag
    }));
  }

  /** Every id ever minted, INCLUDING soft-deleted ones - the collision predicate `mintHomebrewId` needs. */
  private isTaken = (id: string): boolean =>
    this.requireDatabase().prepare("SELECT 1 FROM homebrew_records WHERE id = ?").get(id) !== undefined;

  // ---------- Writes ----------

  /**
   * A record always lands as `state: 'draft'`, `visibleToPlayers: false`: a draft may be invalid, and
   * nothing reaches a player until it is BOTH published and made visible.
   *
   * The stored body carries `id` (forced to the freshly minted one, never the client's) but NOT
   * `type`. `type` is a routing discriminator that lives on the row and on the wire document; leaving
   * it inside the body would make `EquipmentReferenceSchema` - the one `.strict()` content schema -
   * reject its own record at publish time.
   */
  create(input: HomebrewCreateInput): HomebrewRecordRow {
    const database = this.requireDatabase();
    const type = contentType(input.type);
    const name = recordName(input.body);
    const id = mintHomebrewId(type, name, this.isTaken);
    const body = normalizeBody(input.body, id);
    const stamp = this.stamp();
    this.transaction(() => {
      database.prepare("INSERT INTO homebrew_records (id, type, name, state, visible_to_players, deleted_at, body_json, rev, created_at, updated_at) VALUES (?, ?, ?, 'draft', 0, NULL, ?, 1, ?, ?)")
        .run(id, type, name, body, stamp, stamp);
      this.snapshotRevision(id, { rev: 1, name, state: "draft", visibleToPlayers: false, bodyJson: body, at: stamp }, "homebrew:create");
      this.bumpRevision();
    });
    return this.get(id)!;
  }

  /**
   * Replaces the authored body and leaves `state`, `visibleToPlayers` and `deletedAt` alone - correct
   * PATCH semantics on the ROW even though the body it carries is complete (a partial merge into a
   * polymorphic body is unspecifiable).
   */
  update(id: string, body: HomebrewBody, expectedRev: number | undefined, authorTag: string): HomebrewRecordRow {
    const database = this.requireDatabase();
    const existing = this.requireRow(id, expectedRev);
    const name = recordName(body);
    const nextBody = normalizeBody(body, id);
    const rev = existing.rev + 1;
    const stamp = this.stamp();
    this.transaction(() => {
      database.prepare("UPDATE homebrew_records SET name = ?, body_json = ?, rev = ?, updated_at = ? WHERE id = ?").run(name, nextBody, rev, stamp, id);
      this.snapshotRevision(id, { rev, name, state: existing.state as HomebrewContentState, visibleToPlayers: existing.visible_to_players === 1, bodyJson: nextBody, at: stamp }, authorTag);
      this.bumpRevision();
    });
    return this.get(id)!;
  }

  /**
   * Soft delete: the row leaves both merged catalogs and the default listing immediately, keeps its
   * data, and is restorable. Idempotent - re-deleting returns the existing `deletedAt` rather than
   * moving it, so a retried request is not a different answer.
   */
  softDelete(id: string): { id: string; deletedAt: string } | null {
    const database = this.requireDatabase();
    const existing = this.recordRow(id);
    if (!existing) return null;
    if (existing.deleted_at) return { id, deletedAt: existing.deleted_at };
    const stamp = this.stamp();
    this.transaction(() => {
      database.prepare("UPDATE homebrew_records SET deleted_at = ?, rev = rev + 1, updated_at = ? WHERE id = ?").run(stamp, stamp, id);
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
      database.prepare("UPDATE homebrew_records SET deleted_at = NULL, rev = rev + 1, updated_at = ? WHERE id = ?").run(stamp, id);
      this.bumpRevision();
    });
    return this.get(id)!;
  }

  /**
   * Publish / unpublish. Publishing does NOT show a record to players - that is `setVisibility`,
   * deliberately a separate transition. Unpublishing leaves `visibleToPlayers` as it was so that
   * re-publishing restores the GM's intent rather than silently resetting it; the merged player
   * catalog requires BOTH, so an unpublished row is unreachable regardless.
   */
  setState(id: string, state: HomebrewContentState, expectedRev: number | undefined): HomebrewRecordRow {
    const database = this.requireDatabase();
    this.requireRow(id, expectedRev);
    const stamp = this.stamp();
    this.transaction(() => {
      database.prepare("UPDATE homebrew_records SET state = ?, rev = rev + 1, updated_at = ? WHERE id = ?").run(state, stamp, id);
      this.bumpRevision();
    });
    return this.get(id)!;
  }

  /**
   * `state` and `visibleToPlayers` are orthogonal columns, never one enum - but the COMBINATION
   * draft + visible is meaningless, so asking for it is a loud error rather than a silent no-op.
   * That is what stops `visibleToPlayers` from becoming a lie the GM later relies on.
   *
   * Note this governs the LIBRARY only. `Actor.visibility` (`public` / `gm-only`) governs the TABLE
   * and is independent: a GM must be able to publish a monster without player visibility and still
   * drop its token on a public map - players fight it, they just cannot browse its statblock.
   */
  setVisibility(id: string, visibleToPlayers: boolean, expectedRev: number | undefined): HomebrewRecordRow {
    const database = this.requireDatabase();
    const existing = this.requireRow(id, expectedRev);
    if (visibleToPlayers && existing.state !== "published") throw new HomebrewStateError("Publish this first - a draft can't be shown to players.");
    const stamp = this.stamp();
    this.transaction(() => {
      database.prepare("UPDATE homebrew_records SET visible_to_players = ?, rev = rev + 1, updated_at = ? WHERE id = ?").run(visibleToPlayers ? 1 : 0, stamp, id);
      this.bumpRevision();
    });
    return this.get(id)!;
  }

  /** Deep-copy a homebrew record under a freshly minted id. The copy always lands as an invisible draft. */
  duplicate(id: string, name?: string): HomebrewRecordRow {
    const existing = this.recordRow(id);
    if (!existing) throw new HomebrewNotFoundError("That record no longer exists.");
    const body = { ...(JSON.parse(existing.body_json) as Record<string, unknown>), name: copyName(name ?? existing.name) };
    return this.create({ type: existing.type as HomebrewContentType, body });
  }

  /**
   * Import one record body at an id the caller has already decided on (pack import owns the
   * collision + re-mint policy). Always lands as an invisible draft, which is what makes importing
   * an invalid pack harmless.
   */
  importRecord(id: string, type: HomebrewContentType, body: HomebrewBody, overwrite: boolean): HomebrewRecordRow {
    const database = this.requireDatabase();
    const existing = this.recordRow(id);
    if (existing && !overwrite) throw new HomebrewStateError(`A record already exists at "${id}".`);
    if (existing && existing.type !== type) throw new HomebrewStateError(`"${id}" is a ${existing.type}, not a ${type}.`);
    const name = recordName(body);
    const nextBody = normalizeBody(body, id);
    const stamp = this.stamp();
    const rev = existing ? existing.rev + 1 : 1;
    this.transaction(() => {
      if (existing) {
        database.prepare("UPDATE homebrew_records SET name = ?, body_json = ?, state = 'draft', visible_to_players = 0, deleted_at = NULL, rev = ?, updated_at = ? WHERE id = ?")
          .run(name, nextBody, rev, stamp, id);
      } else {
        database.prepare("INSERT INTO homebrew_records (id, type, name, state, visible_to_players, deleted_at, body_json, rev, created_at, updated_at) VALUES (?, ?, ?, 'draft', 0, NULL, ?, ?, ?, ?)")
          .run(id, type, name, nextBody, rev, stamp, stamp);
      }
      this.snapshotRevision(id, { rev, name, state: "draft", visibleToPlayers: false, bodyJson: nextBody, at: stamp }, "homebrew:import");
      this.bumpRevision();
    });
    return this.get(id)!;
  }

  // ---------- Internals ----------

  private recordRow(id: string): RecordRow | undefined {
    return this.requireDatabase().prepare("SELECT * FROM homebrew_records WHERE id = ?").get(id) as RecordRow | undefined;
  }

  /** Existence + optimistic-concurrency check, in that order: a stale rev on a missing row is a 404. */
  private requireRow(id: string, expectedRev: number | undefined): RecordRow {
    const existing = this.recordRow(id);
    if (!existing) throw new HomebrewNotFoundError("That record no longer exists.");
    if (expectedRev !== undefined && expectedRev !== existing.rev) {
      throw new HomebrewRevisionConflictError("This record changed since you opened it. Reload to keep editing.", existing.rev);
    }
    return existing;
  }

  private snapshotRevision(recordId: string, row: { rev: number; name: string; state: HomebrewContentState; visibleToPlayers: boolean; bodyJson: string; at: string }, authorTag: string) {
    this.requireDatabase()
      .prepare("INSERT INTO homebrew_record_revisions (record_id, rev, name, state, visible_to_players, body_json, authored_at, author_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(recordId, row.rev, row.name, row.state, row.visibleToPlayers ? 1 : 0, row.bodyJson, row.at, authorTag);
  }

  /** Always called INSIDE a transaction, so the in-memory counter and the row can't disagree after a rollback. */
  private bumpRevision() {
    const next = (this.requireDatabase().prepare("UPDATE homebrew_meta SET homebrew_revision = homebrew_revision + 1 WHERE id = 1 RETURNING homebrew_revision").get() as { homebrew_revision: number }).homebrew_revision;
    this.revisionValue = next;
  }

  private transaction(work: () => void) {
    const database = this.requireDatabase();
    const before = this.revisionValue;
    database.exec("BEGIN IMMEDIATE");
    try { work(); database.exec("COMMIT"); }
    catch (error) { database.exec("ROLLBACK"); this.revisionValue = before; throw error; }
  }

  private migrate() {
    const database = this.requireDatabase();
    const applied = new Set((database.prepare("SELECT version FROM homebrew_schema_migrations").all() as Array<{ version: number }>).map(({ version }) => version));
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      database.exec("BEGIN IMMEDIATE");
      try {
        database.exec(migration.sql);
        database.prepare("INSERT INTO homebrew_schema_migrations (version, applied_at) VALUES (?, ?)").run(migration.version, this.stamp());
        database.exec("COMMIT");
      } catch (error) { database.exec("ROLLBACK"); throw error; }
    }
  }

  private stamp(): string { return new Date(this.now()).toISOString(); }

  private requireDatabase(): DatabaseSync {
    if (!this.database) throw new Error("HomebrewStore has not been initialized.");
    return this.database;
  }
}

// ---------- Row projection + body hygiene ----------

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
  return { ...projectSummary(row), body: JSON.parse(row.body_json) as HomebrewBody };
}

/** The type list is the contract's; a value outside it would otherwise fail as a raw SQLite CHECK error. */
function contentType(value: string): HomebrewContentType {
  const parsed = HomebrewContentTypeSchema.safeParse(value);
  if (!parsed.success) throw new HomebrewStateError(`"${value}" is not a homebrew content type.`);
  return parsed.data;
}

/**
 * The one thing slice 1 validates about a body: it is a JSON object with a usable name. Everything
 * else stays opaque until the per-type publish gate lands - a draft is allowed to be invalid.
 */
export function recordName(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HomebrewStateError("The record must be a JSON object.");
  const raw = (body as Record<string, unknown>).name;
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) throw new HomebrewStateError("Name this record.");
  if (name.length > MAX_NAME) throw new HomebrewStateError(`Keep the name under ${MAX_NAME} characters.`);
  return name;
}

/**
 * Serialize the body with `id` forced to the row's id and `type` stripped. The client's `record.id`
 * is never trusted: the row's primary key is the identity, and a body whose `id` drifted from it
 * would resolve to nothing once the merge reads `body_json` through the bundle schemas.
 */
function normalizeBody(body: HomebrewBody, id: string): string {
  const { type: _type, ...rest } = body as Record<string, unknown>;
  const json = JSON.stringify({ ...rest, id });
  if (json.length > MAX_BODY_BYTES) throw new HomebrewStateError("That record is too large to store.");
  return json;
}

function copyName(name: string): string {
  const copy = /\(copy( \d+)?\)$/.test(name) ? name : `${name} (copy)`;
  return copy.length > MAX_NAME ? copy.slice(0, MAX_NAME) : copy;
}

/** `%` and `_` are LIKE wildcards; a GM searching for "Wand_" means the literal character. */
function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Opaque to the client by contract: never construct or parse one outside this file. It carries the
 * last row's id ONLY - the sort key is looked up from that row - which keeps the token inside the
 * contract's 200-character cap even for a 120-character name.
 */
function encodeCursor(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url");
}
function decodeCursor(cursor: string | undefined): string | null {
  if (!cursor) return null;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  return /^[a-z0-9-]{1,60}$/.test(decoded) ? decoded : null;
}
