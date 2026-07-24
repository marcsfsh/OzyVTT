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

export type CodexMapKind = "battlemap" | "regional" | "world";
export type CodexMapRow = Readonly<{
  id: string;
  assetId: string;
  name: string;
  kind: CodexMapKind;
  parentMapId: string | null;
  revealedToPlayers: boolean;
  sortKey: number;
  createdAt: string;
  updatedAt: string;
}>;
export type CodexMarkerLinks = Readonly<{ pageId: string | null; subMapId: string | null; sceneId: string | null; actorId: string | null }>;
export type CodexMarkerRow = Readonly<{
  id: string;
  mapId: string;
  x: number;
  y: number;
  iconId: string;
  iconColor: string;
  label: string | null;
  revealedToPlayers: boolean;
} & CodexMarkerLinks & { createdAt: string; updatedAt: string }>;

export type CodexMapCreateInput = Readonly<{ assetId: string; name: string; kind: CodexMapKind; parentMapId?: string | null; revealedToPlayers?: boolean }>;
export type CodexMarkerCreateInput = Readonly<{ x: number; y: number; iconId: string; iconColor: string; label?: string | null; revealedToPlayers?: boolean; pageId?: string | null; subMapId?: string | null; sceneId?: string | null; actorId?: string | null }>;
export type CodexMarkerUpdateInput = Partial<CodexMarkerCreateInput>;

export type CodexJournalKind = "note" | "combat";
export type CodexJournalRow = Readonly<{
  id: string;
  playerText: string;
  gmText: string | null;
  revealedToPlayers: boolean;
  attachMarkerId: string | null;
  attachPageId: string | null;
  kind: CodexJournalKind;
  sourceEncounterId: number | null;
  sessionNumber: number | null;
  realDate: string | null;
  inWorldLabel: string | null;
  calendarInstant: number | null;
  sortKey: number;
  createdAt: string;
  updatedAt: string;
}>;
export type CodexJournalCreateInput = Readonly<{ playerText?: string; gmText?: string | null; revealedToPlayers?: boolean; attachMarkerId?: string | null; attachPageId?: string | null; sessionNumber?: number | null; realDate?: string | null; inWorldLabel?: string | null }>;
export type CodexJournalUpdateInput = CodexJournalCreateInput;
export type CodexCombatEntryInput = Readonly<{ sourceEncounterId: number; attachMarkerId?: string | null; attachPageId?: string | null; playerText: string; gmText?: string | null; revealedToPlayers?: boolean }>;

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
type MapRowRaw = { id: string; asset_id: string; name: string; kind: string; parent_map_id: string | null; revealed: number; sort_key: number; created_at: string; updated_at: string };
type MarkerRowRaw = { id: string; map_id: string; x: number; y: number; icon_id: string; icon_color: string; label: string | null; revealed: number; page_id: string | null; sub_map_id: string | null; scene_id: string | null; actor_id: string | null; created_at: string; updated_at: string };
type JournalRowRaw = { id: string; player_text: string; gm_text: string | null; revealed: number; attach_marker_id: string | null; attach_page_id: string | null; kind: string; source_encounter_id: number | null; session_number: number | null; real_date: string | null; in_world_label: string | null; calendar_instant: number | null; sort_key: number; created_at: string; updated_at: string };

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
const MAP_KINDS = new Set<CodexMapKind>(["battlemap", "regional", "world"]);
function mapName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120 || CONTROL_CHARS.test(trimmed)) throw new Error("A map name must be 1 to 120 printable characters.");
  return trimmed;
}
function mapKind(value: string): CodexMapKind {
  if (!MAP_KINDS.has(value as CodexMapKind)) throw new Error("Map kind must be battlemap, regional, or world.");
  return value as CodexMapKind;
}
function iconId(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value) || value.length > 60) throw new Error("An icon id must be a lowercase slug.");
  return value;
}
function hexColor(value: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error("A color must be a #rrggbb hex value.");
  return value;
}
function coord(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) throw new Error("A marker position must sit within the map.");
  return value;
}
function markerLabel(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > 120 || CONTROL_CHARS.test(trimmed)) throw new Error("A marker label is up to 120 printable characters.");
  return trimmed;
}
function optionalId(value: string | null | undefined): string | null {
  return value === null || value === undefined ? null : id(value);
}
const MAX_ENTRY = 20_000;
function entryText(value: string | undefined): string {
  const text = value ?? "";
  if (text.length > MAX_ENTRY) throw new Error("A journal entry is limited to 20000 characters.");
  return text;
}
function entryGmText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value.length > MAX_ENTRY) throw new Error("A journal entry is limited to 20000 characters.");
  return value === "" ? null : value;
}
function shortLabel(value: string | null | undefined, max: number, what: string): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > max || CONTROL_CHARS.test(trimmed)) throw new Error(`A ${what} is up to ${max} printable characters.`);
  return trimmed;
}
function sessionNo(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 0 || value > 100_000) throw new Error("A session number must be a non-negative integer.");
  return value;
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

  /** A full GM-only export of the whole codex for backup / round-trip (every field, both bodies). */
  exportBundle(): Readonly<{ pages: CodexPageRow[]; maps: CodexMapRow[]; markers: CodexMarkerRow[]; journal: CodexJournalRow[] }> {
    const pages = (this.requireDatabase().prepare("SELECT id, title, folder, tags_json, player_body, gm_body, revealed, banner_asset_id, rev, created_at, updated_at FROM codex_pages ORDER BY title COLLATE NOCASE").all() as PageRow[]).map((row) => this.toPage(row));
    const maps = this.listMaps();
    const markers = maps.flatMap((map) => this.listMarkers(map.id));
    return { pages, maps, markers, journal: this.listTimeline() };
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

  // ----- Maps (the atlas tree) -----

  createMap(input: CodexMapCreateInput): CodexMapRow {
    const database = this.requireDatabase();
    const mapId = this.freshId();
    const stamp = this.stamp();
    const parent = optionalId(input.parentMapId);
    if (parent && !this.mapRowRaw(parent)) throw new CodexNotFoundError("The parent map no longer exists.");
    const sortKey = ((database.prepare("SELECT MAX(sort_key) AS m FROM codex_maps").get() as { m: number | null }).m ?? 0) + 1;
    this.transaction(() => {
      database.prepare("INSERT INTO codex_maps (id, asset_id, name, kind, parent_map_id, revealed, sort_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(mapId, id(input.assetId), mapName(input.name), mapKind(input.kind), parent, input.revealedToPlayers ? 1 : 0, sortKey, stamp, stamp);
      this.bumpRevision();
    });
    return this.getMap(mapId)!;
  }

  updateMap(mapId: string, input: Readonly<{ name?: string; kind?: CodexMapKind }>): CodexMapRow {
    const database = this.requireDatabase();
    const existing = this.mapRowRaw(mapId);
    if (!existing) throw new CodexNotFoundError("That map no longer exists.");
    const name = input.name === undefined ? existing.name : mapName(input.name);
    const kind = input.kind === undefined ? existing.kind : mapKind(input.kind);
    this.transaction(() => {
      database.prepare("UPDATE codex_maps SET name = ?, kind = ?, updated_at = ? WHERE id = ?").run(name, kind, this.stamp(), mapId);
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
      if (parent === mapId) throw new Error("A map cannot be its own parent.");
      let cursor: string | null = parent;
      const seen = new Set<string>([mapId]);
      while (cursor !== null) {
        if (seen.has(cursor)) throw new Error("That would create a loop in the map tree.");
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
      // Markers on OTHER maps that drilled into this one become label-only rather than dangling.
      database.prepare("UPDATE codex_markers SET sub_map_id = NULL, updated_at = ? WHERE sub_map_id = ?").run(this.stamp(), mapId);
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
    return (this.requireDatabase().prepare("SELECT id, asset_id, name, kind, parent_map_id, revealed, sort_key, created_at, updated_at FROM codex_maps ORDER BY sort_key, name COLLATE NOCASE").all() as MapRowRaw[]).map((row) => this.toMap(row));
  }

  // ----- Markers -----

  createMarker(mapId: string, input: CodexMarkerCreateInput): CodexMarkerRow {
    const database = this.requireDatabase();
    if (!this.mapRowRaw(mapId)) throw new CodexNotFoundError("That map no longer exists.");
    const markerId = this.freshId();
    const stamp = this.stamp();
    this.transaction(() => {
      database.prepare("INSERT INTO codex_markers (id, map_id, x, y, icon_id, icon_color, label, revealed, page_id, sub_map_id, scene_id, actor_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(markerId, mapId, coord(input.x), coord(input.y), iconId(input.iconId), hexColor(input.iconColor), markerLabel(input.label), input.revealedToPlayers ? 1 : 0,
          optionalId(input.pageId), optionalId(input.subMapId), optionalId(input.sceneId), optionalId(input.actorId), stamp, stamp);
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
      page_id: input.pageId === undefined ? existing.page_id : optionalId(input.pageId),
      sub_map_id: input.subMapId === undefined ? existing.sub_map_id : optionalId(input.subMapId),
      scene_id: input.sceneId === undefined ? existing.scene_id : optionalId(input.sceneId),
      actor_id: input.actorId === undefined ? existing.actor_id : optionalId(input.actorId)
    };
    this.transaction(() => {
      database.prepare("UPDATE codex_markers SET x = ?, y = ?, icon_id = ?, icon_color = ?, label = ?, revealed = ?, page_id = ?, sub_map_id = ?, scene_id = ?, actor_id = ?, updated_at = ? WHERE id = ?")
        .run(merged.x, merged.y, merged.icon_id, merged.icon_color, merged.label, merged.revealed, merged.page_id, merged.sub_map_id, merged.scene_id, merged.actor_id, this.stamp(), markerId);
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
      this.requireDatabase().prepare("DELETE FROM codex_markers WHERE id = ?").run(markerId);
      this.bumpRevision();
    });
  }

  getMarker(markerId: string): CodexMarkerRow | null {
    const row = this.markerRowRaw(markerId);
    return row ? this.toMarker(row) : null;
  }

  listMarkers(mapId: string): CodexMarkerRow[] {
    if (!ID.test(mapId)) return [];
    return (this.requireDatabase().prepare("SELECT id, map_id, x, y, icon_id, icon_color, label, revealed, page_id, sub_map_id, scene_id, actor_id, created_at, updated_at FROM codex_markers WHERE map_id = ? ORDER BY created_at").all(mapId) as MarkerRowRaw[]).map((row) => this.toMarker(row));
  }

  /** Whether any revealed codex map uses this image asset - lets players fetch a revealed world map's image. */
  isAssetRevealedToPlayers(assetId: string): boolean {
    if (!ID.test(assetId)) return false;
    return this.requireDatabase().prepare("SELECT 1 FROM codex_maps WHERE asset_id = ? AND revealed = 1 LIMIT 1").get(assetId) !== undefined;
  }

  /** Whether a codex media asset (banner or inline image) is used by any REVEALED page's player-facing content - the gate for a player fetching page media. */
  isPageAssetVisibleToPlayers(assetId: string): boolean {
    if (!ID.test(assetId)) return false;
    // A revealed page's banner, or a revealed page whose PLAYER body references the asset id (inline image).
    return this.requireDatabase().prepare("SELECT 1 FROM codex_pages WHERE revealed = 1 AND (banner_asset_id = ? OR player_body LIKE ?) LIMIT 1").get(assetId, `%${assetId}%`) !== undefined;
  }

  /** The location marker linked to a prepared scene, if any - the combat-history bridge pins fights here. */
  markerForScene(sceneId: string): CodexMarkerRow | null {
    if (!ID.test(sceneId)) return null;
    const row = this.requireDatabase().prepare("SELECT id, map_id, x, y, icon_id, icon_color, label, revealed, page_id, sub_map_id, scene_id, actor_id, created_at, updated_at FROM codex_markers WHERE scene_id = ? ORDER BY created_at LIMIT 1").get(sceneId) as MarkerRowRaw | undefined;
    return row ? this.toMarker(row) : null;
  }

  // ----- Journal / timeline -----

  createEntry(input: CodexJournalCreateInput): CodexJournalRow {
    return this.insertEntry({
      playerText: entryText(input.playerText), gmText: entryGmText(input.gmText), revealed: input.revealedToPlayers ? 1 : 0,
      attachMarkerId: optionalId(input.attachMarkerId), attachPageId: optionalId(input.attachPageId), kind: "note",
      sourceEncounterId: null, sessionNumber: sessionNo(input.sessionNumber), realDate: shortLabel(input.realDate, 40, "date"),
      inWorldLabel: shortLabel(input.inWorldLabel, 120, "in-world date")
    });
  }

  /** The combat-history bridge: a logged encounter drops a timeline entry, optionally pinned to a location. Best-effort. */
  appendCombatEntry(input: CodexCombatEntryInput): CodexJournalRow {
    return this.insertEntry({
      playerText: entryText(input.playerText), gmText: entryGmText(input.gmText), revealed: input.revealedToPlayers ? 1 : 0,
      attachMarkerId: optionalId(input.attachMarkerId), attachPageId: optionalId(input.attachPageId), kind: "combat",
      sourceEncounterId: input.sourceEncounterId, sessionNumber: null, realDate: null, inWorldLabel: null
    });
  }

  updateEntry(entryId: string, input: CodexJournalUpdateInput): CodexJournalRow {
    const database = this.requireDatabase();
    const existing = this.journalRowRaw(entryId);
    if (!existing) throw new CodexNotFoundError("That journal entry no longer exists.");
    const next = {
      player_text: input.playerText === undefined ? existing.player_text : entryText(input.playerText),
      gm_text: input.gmText === undefined ? existing.gm_text : entryGmText(input.gmText),
      attach_marker_id: input.attachMarkerId === undefined ? existing.attach_marker_id : optionalId(input.attachMarkerId),
      attach_page_id: input.attachPageId === undefined ? existing.attach_page_id : optionalId(input.attachPageId),
      session_number: input.sessionNumber === undefined ? existing.session_number : sessionNo(input.sessionNumber),
      real_date: input.realDate === undefined ? existing.real_date : shortLabel(input.realDate, 40, "date"),
      in_world_label: input.inWorldLabel === undefined ? existing.in_world_label : shortLabel(input.inWorldLabel, 120, "in-world date")
    };
    this.transaction(() => {
      database.prepare("UPDATE codex_journal SET player_text = ?, gm_text = ?, attach_marker_id = ?, attach_page_id = ?, session_number = ?, real_date = ?, in_world_label = ?, updated_at = ? WHERE id = ?")
        .run(next.player_text, next.gm_text, next.attach_marker_id, next.attach_page_id, next.session_number, next.real_date, next.in_world_label, this.stamp(), entryId);
      this.bumpRevision();
    });
    return this.getEntry(entryId)!;
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
      this.requireDatabase().prepare("DELETE FROM codex_journal WHERE id = ?").run(entryId);
      this.bumpRevision();
    });
  }

  getEntry(entryId: string): CodexJournalRow | null {
    const row = this.journalRowRaw(entryId);
    return row ? this.toEntry(row) : null;
  }

  /** The global campaign timeline, ordered by in-world instant (later), then session number, then time. */
  listTimeline(): CodexJournalRow[] {
    return (this.requireDatabase().prepare(
      "SELECT id, player_text, gm_text, revealed, attach_marker_id, attach_page_id, kind, source_encounter_id, session_number, real_date, in_world_label, calendar_instant, sort_key, created_at, updated_at FROM codex_journal ORDER BY (calendar_instant IS NULL), calendar_instant, (session_number IS NULL), session_number, created_at"
    ).all() as JournalRowRaw[]).map((row) => this.toEntry(row));
  }

  /** Entries pinned to a specific marker or page (the per-entity mini-timeline). */
  listEntriesFor(attach: Readonly<{ markerId?: string; pageId?: string }>): CodexJournalRow[] {
    const database = this.requireDatabase();
    const columns = "id, player_text, gm_text, revealed, attach_marker_id, attach_page_id, kind, source_encounter_id, session_number, real_date, in_world_label, calendar_instant, sort_key, created_at, updated_at";
    if (attach.markerId && ID.test(attach.markerId)) return (database.prepare(`SELECT ${columns} FROM codex_journal WHERE attach_marker_id = ? ORDER BY created_at`).all(attach.markerId) as JournalRowRaw[]).map((row) => this.toEntry(row));
    if (attach.pageId && ID.test(attach.pageId)) return (database.prepare(`SELECT ${columns} FROM codex_journal WHERE attach_page_id = ? ORDER BY created_at`).all(attach.pageId) as JournalRowRaw[]).map((row) => this.toEntry(row));
    return [];
  }

  private insertEntry(fields: Readonly<{ playerText: string; gmText: string | null; revealed: number; attachMarkerId: string | null; attachPageId: string | null; kind: CodexJournalKind; sourceEncounterId: number | null; sessionNumber: number | null; realDate: string | null; inWorldLabel: string | null }>): CodexJournalRow {
    const database = this.requireDatabase();
    const entryId = this.freshId();
    const stamp = this.stamp();
    const sortKey = ((database.prepare("SELECT MAX(sort_key) AS m FROM codex_journal").get() as { m: number | null }).m ?? 0) + 1;
    this.transaction(() => {
      database.prepare("INSERT INTO codex_journal (id, player_text, gm_text, revealed, attach_marker_id, attach_page_id, kind, source_encounter_id, session_number, real_date, in_world_label, calendar_instant, sort_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)")
        .run(entryId, fields.playerText, fields.gmText, fields.revealed, fields.attachMarkerId, fields.attachPageId, fields.kind, fields.sourceEncounterId, fields.sessionNumber, fields.realDate, fields.inWorldLabel, sortKey, stamp, stamp);
      this.bumpRevision();
    });
    return this.getEntry(entryId)!;
  }

  private toEntry(row: JournalRowRaw): CodexJournalRow {
    return {
      id: row.id, playerText: row.player_text, gmText: row.gm_text, revealedToPlayers: row.revealed === 1,
      attachMarkerId: row.attach_marker_id, attachPageId: row.attach_page_id, kind: row.kind === "combat" ? "combat" : "note",
      sourceEncounterId: row.source_encounter_id, sessionNumber: row.session_number, realDate: row.real_date,
      inWorldLabel: row.in_world_label, calendarInstant: row.calendar_instant, sortKey: row.sort_key, createdAt: row.created_at, updatedAt: row.updated_at
    };
  }
  private journalRowRaw(entryId: string): JournalRowRaw | undefined {
    if (!ID.test(entryId)) return undefined;
    return this.requireDatabase().prepare("SELECT id, player_text, gm_text, revealed, attach_marker_id, attach_page_id, kind, source_encounter_id, session_number, real_date, in_world_label, calendar_instant, sort_key, created_at, updated_at FROM codex_journal WHERE id = ?").get(entryId) as JournalRowRaw | undefined;
  }

  private toMap(row: MapRowRaw): CodexMapRow {
    return { id: row.id, assetId: row.asset_id, name: row.name, kind: mapKind(row.kind), parentMapId: row.parent_map_id, revealedToPlayers: row.revealed === 1, sortKey: row.sort_key, createdAt: row.created_at, updatedAt: row.updated_at };
  }
  private toMarker(row: MarkerRowRaw): CodexMarkerRow {
    return { id: row.id, mapId: row.map_id, x: row.x, y: row.y, iconId: row.icon_id, iconColor: row.icon_color, label: row.label, revealedToPlayers: row.revealed === 1, pageId: row.page_id, subMapId: row.sub_map_id, sceneId: row.scene_id, actorId: row.actor_id, createdAt: row.created_at, updatedAt: row.updated_at };
  }
  private mapRowRaw(mapId: string): MapRowRaw | undefined {
    if (!ID.test(mapId)) return undefined;
    return this.requireDatabase().prepare("SELECT id, asset_id, name, kind, parent_map_id, revealed, sort_key, created_at, updated_at FROM codex_maps WHERE id = ?").get(mapId) as MapRowRaw | undefined;
  }
  private markerRowRaw(markerId: string): MarkerRowRaw | undefined {
    if (!ID.test(markerId)) return undefined;
    return this.requireDatabase().prepare("SELECT id, map_id, x, y, icon_id, icon_color, label, revealed, page_id, sub_map_id, scene_id, actor_id, created_at, updated_at FROM codex_markers WHERE id = ?").get(markerId) as MarkerRowRaw | undefined;
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
