import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Worldbuilding / campaign-codex persistence: freeform two-layer wiki pages, a nested map tree with
 * markers, and a campaign journal. Lives in its own tables inside the shared game database, mutated
 * through GM-gated REST routes (`codex-http.ts`) - NOT the GameState broadcast. GameState stays small
 * and hot; the codex is fetched on demand and every write only bumps a coarse `codexRevision` used to
 * ping clients to refetch (`codex:changed`) and to ETag list reads.
 *
 * Viewer-safety note: this store returns RAW rows (both `playerBody` and `gmBody`). Stripping the
 * GM-only half for players happens in `codex-projections.ts`, the single audited boundary - never here.
 */

export type CodexPageRow = Readonly<{
  id: string;
  title: string;
  folder: string | null;
  tags: readonly string[];
  playerBody: string;
  gmBody: string;
  revealedToPlayers: boolean;
  bannerAssetId: string | null;
  rev: number;
  createdAt: string;
  updatedAt: string;
}>;

export type CodexPageSummaryRow = Omit<CodexPageRow, "playerBody" | "gmBody">;

export type CodexLinkRow = Readonly<{
  sourcePageId: string;
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

export type CodexBacklinkRow = Readonly<{
  sourcePageId: string;
  sourceTitle: string;
  sourceRevealed: boolean;
  layer: "player" | "gm";
  section: string | null;
}>;

export type CodexPageCreateInput = Readonly<{
  title: string;
  folder?: string | null;
  tags?: readonly string[];
  playerBody?: string;
  gmBody?: string;
  revealedToPlayers?: boolean;
  bannerAssetId?: string | null;
}>;

export type CodexPageUpdateInput = Readonly<{
  title?: string;
  folder?: string | null;
  tags?: readonly string[];
  playerBody?: string;
  gmBody?: string;
  bannerAssetId?: string | null;
}>;

/** Thrown when an update's `expectedRev` does not match the stored row - the client's page is stale. */
export class CodexRevisionConflictError extends Error {}
/** Thrown when a referenced page/map/marker does not exist. */
export class CodexNotFoundError extends Error {}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARS = /\p{Cc}/u;
const MAX_BODY = 100_000;
const MAX_TAGS = 24;

const MIGRATIONS = [{
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
}];

type PageRow = {
  id: string; title: string; folder: string | null; tags_json: string; player_body: string;
  gm_body: string; revealed: number; banner_asset_id: string | null; rev: number; created_at: string; updated_at: string;
};

function id(value: string): string {
  if (!ID.test(value)) throw new Error("Codex id is malformed.");
  return value;
}
function title(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 160 || CONTROL_CHARS.test(trimmed)) throw new Error("A page title must be 1 to 160 printable characters.");
  return trimmed;
}
/** One flat level of folders, matching the map catalog convention. */
function folder(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > 60 || trimmed.includes("/") || CONTROL_CHARS.test(trimmed)) throw new Error("A folder must be one level: up to 60 printable characters, no slashes.");
  return trimmed;
}
function tags(value: readonly string[] | undefined): string[] {
  if (!value) return [];
  const cleaned = [...new Set(value.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
  if (cleaned.length > MAX_TAGS) throw new Error(`A page may carry at most ${MAX_TAGS} tags.`);
  for (const tag of cleaned) if (tag.length > 40 || !/^[a-z0-9][a-z0-9-]*$/.test(tag)) throw new Error("Tags use lowercase letters, numbers, and hyphens.");
  return cleaned;
}
function body(value: string | undefined): string {
  const text = value ?? "";
  if (text.length > MAX_BODY) throw new Error("A page body is limited to 100000 characters.");
  return text;
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
    links.push({ sourcePageId: "", layer, targetKind, targetRef: key, section });
  }
  return links;
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
      if (!meta) database.prepare("INSERT INTO codex_meta (id, codex_revision) VALUES (1, 0)").run();
    } catch (error) {
      database.close();
      this.database = undefined;
      throw error;
    }
  }

  close() { this.database?.close(); this.database = undefined; }

  /** The coarse counter bumped on every write - drives the `codex:changed` ping and list ETags. */
  get revision(): number {
    return (this.requireDatabase().prepare("SELECT codex_revision FROM codex_meta WHERE id = 1").get() as { codex_revision: number } | undefined)?.codex_revision ?? 0;
  }

  // ----- Pages -----

  createPage(input: CodexPageCreateInput): CodexPageRow {
    const database = this.requireDatabase();
    const pageId = this.freshId();
    const stamp = this.stamp();
    const row: PageRow = {
      id: pageId, title: title(input.title), folder: folder(input.folder), tags_json: JSON.stringify(tags(input.tags)),
      player_body: body(input.playerBody), gm_body: body(input.gmBody), revealed: input.revealedToPlayers ? 1 : 0,
      banner_asset_id: input.bannerAssetId ? id(input.bannerAssetId) : null, rev: 1, created_at: stamp, updated_at: stamp
    };
    this.transaction(() => {
      database.prepare("INSERT INTO codex_pages (id, title, folder, tags_json, player_body, gm_body, revealed, banner_asset_id, rev, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(row.id, row.title, row.folder, row.tags_json, row.player_body, row.gm_body, row.revealed, row.banner_asset_id, row.rev, row.created_at, row.updated_at);
      this.rebuildLinks(pageId, row.player_body, row.gm_body);
      this.rebuildFts(pageId, row.title, row.player_body, row.gm_body);
      this.snapshotRevision(pageId, row, "codex:create");
      this.bumpRevision();
    });
    return this.getPage(pageId)!;
  }

  updatePage(pageId: string, input: CodexPageUpdateInput, expectedRev: number | undefined, authorTag: string): CodexPageRow {
    const database = this.requireDatabase();
    const existing = this.pageRow(pageId);
    if (!existing) throw new CodexNotFoundError("That page no longer exists.");
    if (expectedRev !== undefined && expectedRev !== existing.rev) throw new CodexRevisionConflictError("This page changed since you opened it. Reload to keep editing.");
    const next: PageRow = {
      ...existing,
      title: input.title === undefined ? existing.title : title(input.title),
      folder: input.folder === undefined ? existing.folder : folder(input.folder),
      tags_json: input.tags === undefined ? existing.tags_json : JSON.stringify(tags(input.tags)),
      player_body: input.playerBody === undefined ? existing.player_body : body(input.playerBody),
      gm_body: input.gmBody === undefined ? existing.gm_body : body(input.gmBody),
      banner_asset_id: input.bannerAssetId === undefined ? existing.banner_asset_id : (input.bannerAssetId ? id(input.bannerAssetId) : null),
      rev: existing.rev + 1,
      updated_at: this.stamp()
    };
    this.transaction(() => {
      database.prepare("UPDATE codex_pages SET title = ?, folder = ?, tags_json = ?, player_body = ?, gm_body = ?, banner_asset_id = ?, rev = ?, updated_at = ? WHERE id = ?")
        .run(next.title, next.folder, next.tags_json, next.player_body, next.gm_body, next.banner_asset_id, next.rev, next.updated_at, pageId);
      this.rebuildLinks(pageId, next.player_body, next.gm_body);
      this.rebuildFts(pageId, next.title, next.player_body, next.gm_body);
      this.snapshotRevision(pageId, next, authorTag);
      this.bumpRevision();
    });
    return this.getPage(pageId)!;
  }

  setPageRevealed(pageId: string, revealed: boolean): CodexPageRow {
    const database = this.requireDatabase();
    if (!this.pageRow(pageId)) throw new CodexNotFoundError("That page no longer exists.");
    this.transaction(() => {
      database.prepare("UPDATE codex_pages SET revealed = ?, updated_at = ? WHERE id = ?").run(revealed ? 1 : 0, this.stamp(), pageId);
      this.bumpRevision();
    });
    return this.getPage(pageId)!;
  }

  deletePage(pageId: string): void {
    const database = this.requireDatabase();
    if (!ID.test(pageId)) return;
    this.transaction(() => {
      database.prepare("DELETE FROM codex_fts_player WHERE page_id = ?").run(pageId);
      database.prepare("DELETE FROM codex_fts_gm WHERE page_id = ?").run(pageId);
      // Markers that pointed here become label-only rather than dangling.
      database.prepare("UPDATE codex_markers SET page_id = NULL, updated_at = ? WHERE page_id = ?").run(this.stamp(), pageId);
      database.prepare("DELETE FROM codex_pages WHERE id = ?").run(pageId); // cascades links + revisions
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
      .prepare("SELECT id, title, folder, tags_json, revealed, banner_asset_id, rev, created_at, updated_at FROM codex_pages ORDER BY title COLLATE NOCASE")
      .all() as Array<Omit<PageRow, "player_body" | "gm_body">>;
    return rows
      .map((row) => ({
        id: row.id, title: row.title, folder: row.folder, tags: JSON.parse(row.tags_json) as string[],
        revealedToPlayers: row.revealed === 1, bannerAssetId: row.banner_asset_id, rev: row.rev, createdAt: row.created_at, updatedAt: row.updated_at
      }))
      .filter((page) => (filter?.folder === undefined || page.folder === filter.folder) && (filter?.tag === undefined || page.tags.includes(filter.tag)));
  }

  // ----- Revisions -----

  listRevisions(pageId: string): CodexPageRevisionRow[] {
    return (this.requireDatabase()
      .prepare("SELECT id, page_id, rev, title, player_body, gm_body, banner_asset_id, tags_json, authored_at, author_tag FROM codex_page_revisions WHERE page_id = ? ORDER BY rev DESC")
      .all(pageId) as Array<{ id: number; page_id: string; rev: number; title: string; player_body: string; gm_body: string; banner_asset_id: string | null; tags_json: string; authored_at: string; author_tag: string }>)
      .map((row) => ({ id: row.id, pageId: row.page_id, rev: row.rev, title: row.title, playerBody: row.player_body, gmBody: row.gm_body, bannerAssetId: row.banner_asset_id, tags: JSON.parse(row.tags_json) as string[], authoredAt: row.authored_at, authorTag: row.author_tag }));
  }

  /** Restore a past revision by writing it forward as a new revision (history is never rewritten). */
  restoreRevision(pageId: string, revisionId: number, authorTag: string): CodexPageRow {
    const snap = this.requireDatabase().prepare("SELECT title, player_body, gm_body, banner_asset_id, tags_json FROM codex_page_revisions WHERE id = ? AND page_id = ?").get(revisionId, pageId) as { title: string; player_body: string; gm_body: string; banner_asset_id: string | null; tags_json: string } | undefined;
    if (!snap) throw new CodexNotFoundError("That revision no longer exists.");
    return this.updatePage(pageId, { title: snap.title, playerBody: snap.player_body, gmBody: snap.gm_body, bannerAssetId: snap.banner_asset_id, tags: JSON.parse(snap.tags_json) as string[] }, undefined, authorTag);
  }

  // ----- Links / backlinks -----

  /** Backlinks to a page: every page whose body references this page's title. Includes both layers + reveal state; the projection filters for players. */
  backlinksToPage(pageId: string): CodexBacklinkRow[] {
    const page = this.pageRow(pageId);
    if (!page) return [];
    return (this.requireDatabase().prepare(
      `SELECT l.source_page_id, l.layer, l.section, p.title AS source_title, p.revealed AS source_revealed
       FROM codex_links l JOIN codex_pages p ON p.id = l.source_page_id
       WHERE l.target_kind = 'page' AND l.target_ref = ? AND l.source_page_id != ?
       ORDER BY p.title COLLATE NOCASE`
    ).all(pageLinkKey(page.title), pageId) as Array<{ source_page_id: string; layer: "player" | "gm"; section: string | null; source_title: string; source_revealed: number }>)
      .map((row) => ({ sourcePageId: row.source_page_id, sourceTitle: row.source_title, sourceRevealed: row.source_revealed === 1, layer: row.layer, section: row.section }));
  }

  // ----- Search -----

  /** Full-text search over one audience's index. Player queries can only ever hit `player_body` text. */
  searchPages(audience: "player" | "gm", query: string): Array<{ pageId: string }> {
    const table = audience === "gm" ? "codex_fts_gm" : "codex_fts_player";
    const match = ftsQuery(query);
    if (!match) return [];
    try {
      return (this.requireDatabase().prepare(`SELECT page_id FROM ${table} WHERE ${table} MATCH ? ORDER BY rank LIMIT 50`).all(match) as Array<{ page_id: string }>)
        .map((row) => ({ pageId: row.page_id }));
    } catch { return []; }
  }

  // ----- internals -----

  private pageRow(pageId: string): PageRow | undefined {
    if (!ID.test(pageId)) return undefined;
    return this.requireDatabase().prepare("SELECT id, title, folder, tags_json, player_body, gm_body, revealed, banner_asset_id, rev, created_at, updated_at FROM codex_pages WHERE id = ?").get(pageId) as PageRow | undefined;
  }

  private toPage(row: PageRow): CodexPageRow {
    return {
      id: row.id, title: row.title, folder: row.folder, tags: JSON.parse(row.tags_json) as string[],
      playerBody: row.player_body, gmBody: row.gm_body, revealedToPlayers: row.revealed === 1,
      bannerAssetId: row.banner_asset_id, rev: row.rev, createdAt: row.created_at, updatedAt: row.updated_at
    };
  }

  private rebuildLinks(pageId: string, playerBody: string, gmBody: string) {
    const database = this.requireDatabase();
    database.prepare("DELETE FROM codex_links WHERE source_page_id = ?").run(pageId);
    const links = [...parseWikiLinks(playerBody, "player"), ...parseWikiLinks(gmBody, "gm")];
    const insert = database.prepare("INSERT INTO codex_links (source_page_id, layer, target_kind, target_ref, section) VALUES (?, ?, ?, ?, ?)");
    for (const link of links) insert.run(pageId, link.layer, link.targetKind, link.targetRef, link.section);
  }

  private rebuildFts(pageId: string, pageTitle: string, playerBody: string, gmBody: string) {
    const database = this.requireDatabase();
    database.prepare("DELETE FROM codex_fts_player WHERE page_id = ?").run(pageId);
    database.prepare("DELETE FROM codex_fts_gm WHERE page_id = ?").run(pageId);
    // Player index carries ONLY the player-facing body: a player search can never surface gm-body text.
    database.prepare("INSERT INTO codex_fts_player (page_id, title, body) VALUES (?, ?, ?)").run(pageId, pageTitle, playerBody);
    database.prepare("INSERT INTO codex_fts_gm (page_id, title, body) VALUES (?, ?, ?)").run(pageId, pageTitle, `${playerBody}\n${gmBody}`);
  }

  private snapshotRevision(pageId: string, row: PageRow, authorTag: string) {
    this.requireDatabase().prepare("INSERT INTO codex_page_revisions (page_id, rev, title, player_body, gm_body, banner_asset_id, tags_json, authored_at, author_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(pageId, row.rev, row.title, row.player_body, row.gm_body, row.banner_asset_id, row.tags_json, row.updated_at, authorTag);
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
