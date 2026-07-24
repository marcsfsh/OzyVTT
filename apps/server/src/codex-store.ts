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

/** A page's worldbuilding entity type. `note` is a plain page; the rest carry structured `fields`. */
export type CodexEntityType = "note" | "character" | "location" | "faction" | "item" | "species" | "religion" | "event";
export const ENTITY_TYPES: readonly CodexEntityType[] = ["note", "character", "location", "faction", "item", "species", "religion", "event"];

export type CodexPageRow = Readonly<{
  id: string;
  title: string;
  entityType: CodexEntityType;
  /** Structured, type-specific attributes (key -> value); player-facing when the page is revealed. */
  fields: Readonly<Record<string, string>>;
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

/** A directional typed relationship between two pages (Strahd --rules--> Barovia). */
export type CodexRelationshipRow = Readonly<{ id: string; fromPageId: string; toPageId: string; type: string; createdAt: string }>;
/** A relationship as listed against one page: the OTHER endpoint resolved, with the edge direction. */
export type CodexRelationshipView = Readonly<{ id: string; type: string; direction: "out" | "in"; otherPageId: string; otherTitle: string; otherType: CodexEntityType; otherRevealed: boolean }>;

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

/** The world's calendar: ordered months (each with a length), weekday names, and an era suffix. */
export type CodexCalendarMonth = Readonly<{ name: string; days: number }>;
export type CodexCalendar = Readonly<{ yearName: string; months: readonly CodexCalendarMonth[]; weekdays: readonly string[] }>;
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
export type CodexJournalCreateInput = Readonly<{ playerText?: string; gmText?: string | null; revealedToPlayers?: boolean; attachMarkerId?: string | null; attachPageId?: string | null; sessionNumber?: number | null; realDate?: string | null; inWorldLabel?: string | null; inWorldDate?: CodexInWorldDate | null }>;
export type CodexJournalUpdateInput = CodexJournalCreateInput;
export type CodexCombatEntryInput = Readonly<{ sourceEncounterId: number; attachMarkerId?: string | null; attachPageId?: string | null; playerText: string; gmText?: string | null; revealedToPlayers?: boolean }>;

export type CodexPageCreateInput = Readonly<{
  title: string;
  entityType?: CodexEntityType;
  fields?: Readonly<Record<string, string>>;
  folder?: string | null;
  tags?: readonly string[];
  playerBody?: string;
  gmBody?: string;
  revealedToPlayers?: boolean;
  bannerAssetId?: string | null;
}>;

export type CodexPageUpdateInput = Readonly<{
  title?: string;
  entityType?: CodexEntityType;
  fields?: Readonly<Record<string, string>>;
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
}];

type PageRow = {
  id: string; title: string; entity_type: string; fields_json: string; folder: string | null; tags_json: string; player_body: string;
  gm_body: string; revealed: number; banner_asset_id: string | null; rev: number; created_at: string; updated_at: string;
};
type RelationshipRowRaw = { id: string; from_page_id: string; to_page_id: string; type: string; created_at: string };
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
/** A nested notebook folder PATH ("NPCs/Villains"): "/"-separated segments, normalized and bounded. */
function folder(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const segments = value.split("/").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) return null;
  if (segments.length > 6) throw new Error("A folder path can be at most 6 levels deep.");
  for (const segment of segments) if (segment.length > 40 || CONTROL_CHARS.test(segment)) throw new Error("Each folder name is up to 40 printable characters.");
  const path = segments.join("/");
  if (path.length > 160) throw new Error("That folder path is too long.");
  return path;
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
function entityType(value: string | undefined): CodexEntityType {
  if (value === undefined) return "note";
  if (!ENTITY_TYPES.includes(value as CodexEntityType)) throw new Error("Unknown entity type.");
  return value as CodexEntityType;
}
/** Structured entity attributes: a flat {slug: string} map, empties dropped, bounded in size. */
function entityFields(value: Readonly<Record<string, string>> | undefined): Record<string, string> {
  if (value === undefined) return {};
  const entries = Object.entries(value);
  if (entries.length > 40) throw new Error("An entity may carry at most 40 fields.");
  const out: Record<string, string> = {};
  for (const [key, raw] of entries) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(key) || key.length > 40) throw new Error("A field key must be a lowercase slug.");
    if (typeof raw !== "string" || raw.length > 2000 || CONTROL_CHARS.test(raw.replace(/[\n\r\t]/g, ""))) throw new Error("A field value is up to 2000 printable characters.");
    if (raw.trim() !== "") out[key] = raw;
  }
  if (JSON.stringify(out).length > 10_000) throw new Error("Entity fields are too large.");
  return out;
}
const REL_TYPE = /^[a-z0-9][a-z0-9-]*$/;
function relationshipType(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!REL_TYPE.test(trimmed) || trimmed.length > 40) throw new Error("A relationship type must be a lowercase slug.");
  return trimmed;
}
function parseFields(json: string | null | undefined): Record<string, string> {
  if (!json) return {};
  try { const parsed = JSON.parse(json) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {}; }
  catch { return {}; }
}
function normalizeCalendar(input: CodexCalendar): CodexCalendar {
  const months = (input.months ?? []).map((month) => ({ name: shortLabel(month.name, 40, "month name") ?? "Month", days: Math.max(1, Math.min(Math.trunc(month.days), 400)) }));
  if (months.length < 1 || months.length > 24) throw new Error("A calendar needs 1 to 24 months.");
  const weekdays = (input.weekdays ?? []).slice(0, 20).map((day) => shortLabel(day, 40, "weekday") ?? "Day");
  return { yearName: shortLabel(input.yearName, 20, "era") ?? "", months, weekdays };
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
function formatInWorldDate(calendar: CodexCalendar, date: CodexInWorldDate): string {
  const monthIdx = Math.max(0, Math.min(Math.trunc(date.month), calendar.months.length - 1));
  const month = calendar.months[monthIdx];
  const day = Math.max(1, Math.min(Math.trunc(date.day), month.days));
  return `${month.name} ${day}, ${Math.trunc(date.year)}${calendar.yearName ? ` ${calendar.yearName}` : ""}`;
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
      id: pageId, title: title(input.title), entity_type: entityType(input.entityType), fields_json: JSON.stringify(entityFields(input.fields)),
      folder: folder(input.folder), tags_json: JSON.stringify(tags(input.tags)),
      player_body: body(input.playerBody), gm_body: body(input.gmBody), revealed: input.revealedToPlayers ? 1 : 0,
      banner_asset_id: input.bannerAssetId ? id(input.bannerAssetId) : null, rev: 1, created_at: stamp, updated_at: stamp
    };
    this.transaction(() => {
      database.prepare("INSERT INTO codex_pages (id, title, entity_type, fields_json, folder, tags_json, player_body, gm_body, revealed, banner_asset_id, rev, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(row.id, row.title, row.entity_type, row.fields_json, row.folder, row.tags_json, row.player_body, row.gm_body, row.revealed, row.banner_asset_id, row.rev, row.created_at, row.updated_at);
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
      entity_type: input.entityType === undefined ? existing.entity_type : entityType(input.entityType),
      fields_json: input.fields === undefined ? existing.fields_json : JSON.stringify(entityFields(input.fields)),
      folder: input.folder === undefined ? existing.folder : folder(input.folder),
      tags_json: input.tags === undefined ? existing.tags_json : JSON.stringify(tags(input.tags)),
      player_body: input.playerBody === undefined ? existing.player_body : body(input.playerBody),
      gm_body: input.gmBody === undefined ? existing.gm_body : body(input.gmBody),
      banner_asset_id: input.bannerAssetId === undefined ? existing.banner_asset_id : (input.bannerAssetId ? id(input.bannerAssetId) : null),
      rev: existing.rev + 1,
      updated_at: this.stamp()
    };
    this.transaction(() => {
      database.prepare("UPDATE codex_pages SET title = ?, entity_type = ?, fields_json = ?, folder = ?, tags_json = ?, player_body = ?, gm_body = ?, banner_asset_id = ?, rev = ?, updated_at = ? WHERE id = ?")
        .run(next.title, next.entity_type, next.fields_json, next.folder, next.tags_json, next.player_body, next.gm_body, next.banner_asset_id, next.rev, next.updated_at, pageId);
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
      // Markers and journal pins that pointed here become label-only rather than dangling.
      database.prepare("UPDATE codex_markers SET page_id = NULL, updated_at = ? WHERE page_id = ?").run(this.stamp(), pageId);
      database.prepare("UPDATE codex_journal SET attach_page_id = NULL, updated_at = ? WHERE attach_page_id = ?").run(this.stamp(), pageId);
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
      .prepare("SELECT id, title, entity_type, fields_json, folder, tags_json, revealed, banner_asset_id, rev, created_at, updated_at FROM codex_pages ORDER BY title COLLATE NOCASE")
      .all() as Array<Omit<PageRow, "player_body" | "gm_body">>;
    return rows
      .map((row) => ({
        id: row.id, title: row.title, entityType: (row.entity_type as CodexEntityType) ?? "note", fields: parseFields(row.fields_json),
        folder: row.folder, tags: JSON.parse(row.tags_json) as string[],
        revealedToPlayers: row.revealed === 1, bannerAssetId: row.banner_asset_id, rev: row.rev, createdAt: row.created_at, updatedAt: row.updated_at
      }))
      .filter((page) => (filter?.folder === undefined || page.folder === filter.folder) && (filter?.tag === undefined || page.tags.includes(filter.tag)));
  }

  /** A full GM-only export of the whole codex for backup / round-trip (every field, both bodies). */
  exportBundle(): Readonly<{ pages: CodexPageRow[]; maps: CodexMapRow[]; markers: CodexMarkerRow[]; journal: CodexJournalRow[]; relationships: CodexRelationshipRow[] }> {
    const pages = (this.requireDatabase().prepare("SELECT id, title, entity_type, fields_json, folder, tags_json, player_body, gm_body, revealed, banner_asset_id, rev, created_at, updated_at FROM codex_pages ORDER BY title COLLATE NOCASE").all() as PageRow[]).map((row) => this.toPage(row));
    const maps = this.listMaps();
    const markers = maps.flatMap((map) => this.listMarkers(map.id));
    return { pages, maps, markers, journal: this.listTimeline(), relationships: this.listAllRelationships() };
  }

  // ----- Relationships (typed entity edges) -----

  createRelationship(fromPageId: string, toPageId: string, type: string): CodexRelationshipRow {
    const database = this.requireDatabase();
    const from = id(fromPageId);
    const to = id(toPageId);
    if (from === to) throw new Error("An entity can't relate to itself.");
    if (!this.pageRow(from) || !this.pageRow(to)) throw new CodexNotFoundError("One of those pages no longer exists.");
    const relType = relationshipType(type);
    // Same from/to/type is idempotent - return the existing edge rather than duplicate it.
    const existing = database.prepare("SELECT id, from_page_id, to_page_id, type, created_at FROM codex_relationships WHERE from_page_id = ? AND to_page_id = ? AND type = ?").get(from, to, relType) as RelationshipRowRaw | undefined;
    if (existing) return this.toRel(existing);
    const relId = this.freshId();
    this.transaction(() => {
      database.prepare("INSERT INTO codex_relationships (id, from_page_id, to_page_id, type, created_at) VALUES (?, ?, ?, ?, ?)").run(relId, from, to, relType, this.stamp());
      this.bumpRevision();
    });
    return this.toRel(database.prepare("SELECT id, from_page_id, to_page_id, type, created_at FROM codex_relationships WHERE id = ?").get(relId) as RelationshipRowRaw);
  }

  deleteRelationship(relId: string): void {
    if (!ID.test(relId)) return;
    this.transaction(() => {
      this.requireDatabase().prepare("DELETE FROM codex_relationships WHERE id = ?").run(relId);
      this.bumpRevision();
    });
  }

  /** Every relationship touching this page, the OTHER endpoint resolved (title/type/reveal) with direction. */
  listRelationshipsFor(pageId: string): CodexRelationshipView[] {
    if (!ID.test(pageId)) return [];
    const database = this.requireDatabase();
    const view = (rows: Array<{ id: string; type: string; other_id: string; other_title: string; other_type: string; other_revealed: number }>, direction: "out" | "in"): CodexRelationshipView[] =>
      rows.map((row) => ({ id: row.id, type: row.type, direction, otherPageId: row.other_id, otherTitle: row.other_title, otherType: (row.other_type as CodexEntityType) ?? "note", otherRevealed: row.other_revealed === 1 }));
    const outgoing = database.prepare(
      "SELECT r.id, r.type, r.to_page_id AS other_id, p.title AS other_title, p.entity_type AS other_type, p.revealed AS other_revealed FROM codex_relationships r JOIN codex_pages p ON p.id = r.to_page_id WHERE r.from_page_id = ? ORDER BY r.type, p.title COLLATE NOCASE"
    ).all(pageId) as Array<{ id: string; type: string; other_id: string; other_title: string; other_type: string; other_revealed: number }>;
    const incoming = database.prepare(
      "SELECT r.id, r.type, r.from_page_id AS other_id, p.title AS other_title, p.entity_type AS other_type, p.revealed AS other_revealed FROM codex_relationships r JOIN codex_pages p ON p.id = r.from_page_id WHERE r.to_page_id = ? ORDER BY r.type, p.title COLLATE NOCASE"
    ).all(pageId) as Array<{ id: string; type: string; other_id: string; other_title: string; other_type: string; other_revealed: number }>;
    return [...view(outgoing, "out"), ...view(incoming, "in")];
  }

  /** All relationship edges (for the graph). */
  listAllRelationships(): CodexRelationshipRow[] {
    return (this.requireDatabase().prepare("SELECT id, from_page_id, to_page_id, type, created_at FROM codex_relationships").all() as RelationshipRowRaw[]).map((row) => this.toRel(row));
  }

  private toRel(row: RelationshipRowRaw): CodexRelationshipRow {
    return { id: row.id, fromPageId: row.from_page_id, toPageId: row.to_page_id, type: row.type, createdAt: row.created_at };
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
    const snap = this.requireDatabase().prepare("SELECT title, entity_type, fields_json, player_body, gm_body, banner_asset_id, tags_json FROM codex_page_revisions WHERE id = ? AND page_id = ?").get(revisionId, pageId) as { title: string; entity_type: string; fields_json: string; player_body: string; gm_body: string; banner_asset_id: string | null; tags_json: string } | undefined;
    if (!snap) throw new CodexNotFoundError("That revision no longer exists.");
    return this.updatePage(pageId, { title: snap.title, entityType: snap.entity_type as CodexEntityType, fields: parseFields(snap.fields_json), playerBody: snap.player_body, gmBody: snap.gm_body, bannerAssetId: snap.banner_asset_id, tags: JSON.parse(snap.tags_json) as string[] }, undefined, authorTag);
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

  /** Full-text search over one audience's index. Player queries can only ever hit `player_body` text, and
   *  are pre-filtered to revealed pages so unrevealed drafts don't crowd the result cap (they'd be
   *  projected out anyway - this keeps genuinely-visible matches from being truncated behind them). */
  searchPages(audience: "player" | "gm", query: string): Array<{ pageId: string }> {
    const match = ftsQuery(query);
    if (!match) return [];
    const sql = audience === "gm"
      ? "SELECT page_id FROM codex_fts_gm WHERE codex_fts_gm MATCH ? ORDER BY rank LIMIT 50"
      : "SELECT codex_fts_player.page_id FROM codex_fts_player JOIN codex_pages p ON p.id = codex_fts_player.page_id WHERE codex_fts_player MATCH ? AND p.revealed = 1 ORDER BY codex_fts_player.rank LIMIT 50";
    try {
      return (this.requireDatabase().prepare(sql).all(match) as Array<{ page_id: string }>).map((row) => ({ pageId: row.page_id }));
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
      // Journal pins to this map's own (about-to-cascade) markers are released first, so they don't dangle.
      database.prepare("UPDATE codex_journal SET attach_marker_id = NULL, updated_at = ? WHERE attach_marker_id IN (SELECT id FROM codex_markers WHERE map_id = ?)").run(this.stamp(), mapId);
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
      // A scene has one location: linking it here clears any other pin that claimed it, so the combat-history bridge (markerForScene) and the UI stay unambiguous.
      if (input.sceneId !== undefined && merged.scene_id !== null) {
        database.prepare("UPDATE codex_markers SET scene_id = NULL, updated_at = ? WHERE scene_id = ? AND id != ?").run(this.stamp(), merged.scene_id, markerId);
      }
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
    const row = this.requireDatabase().prepare("SELECT id, map_id, x, y, icon_id, icon_color, label, revealed, page_id, sub_map_id, scene_id, actor_id, created_at, updated_at FROM codex_markers WHERE scene_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1").get(sceneId) as MarkerRowRaw | undefined;
    return row ? this.toMarker(row) : null;
  }

  // ----- Calendar -----

  getCalendar(): CodexCalendar {
    const row = this.requireDatabase().prepare("SELECT calendar_json FROM codex_meta WHERE id = 1").get() as { calendar_json: string | null } | undefined;
    if (!row?.calendar_json) return DEFAULT_CALENDAR;
    try { return normalizeCalendar(JSON.parse(row.calendar_json) as CodexCalendar); } catch { return DEFAULT_CALENDAR; }
  }

  setCalendar(input: CodexCalendar): CodexCalendar {
    const calendar = normalizeCalendar(input);
    this.transaction(() => {
      this.requireDatabase().prepare("UPDATE codex_meta SET calendar_json = ? WHERE id = 1").run(JSON.stringify(calendar));
      this.bumpRevision();
    });
    return calendar;
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

  /** Resolve a journal entry's date: a structured in-world date wins (computes instant + label); else free-text label, no instant. */
  private resolveDate(date: CodexInWorldDate | null | undefined, label: string | null | undefined): { instant: number | null; label: string | null } {
    if (date && Number.isFinite(date.year) && Number.isFinite(date.month) && Number.isFinite(date.day)) {
      const calendar = this.getCalendar();
      return { instant: calendarInstantOf(calendar, date), label: formatInWorldDate(calendar, date) };
    }
    return { instant: null, label: shortLabel(label, 120, "in-world date") };
  }

  // ----- Journal / timeline -----

  createEntry(input: CodexJournalCreateInput): CodexJournalRow {
    const dated = this.resolveDate(input.inWorldDate, input.inWorldLabel);
    return this.insertEntry({
      playerText: entryText(input.playerText), gmText: entryGmText(input.gmText), revealed: input.revealedToPlayers ? 1 : 0,
      attachMarkerId: optionalId(input.attachMarkerId), attachPageId: optionalId(input.attachPageId), kind: "note",
      sourceEncounterId: null, sessionNumber: sessionNo(input.sessionNumber), realDate: shortLabel(input.realDate, 40, "date"),
      inWorldLabel: dated.label, calendarInstant: dated.instant
    });
  }

  /** The combat-history bridge: a logged encounter drops a timeline entry, optionally pinned to a location. Best-effort. */
  appendCombatEntry(input: CodexCombatEntryInput): CodexJournalRow {
    return this.insertEntry({
      playerText: entryText(input.playerText), gmText: entryGmText(input.gmText), revealed: input.revealedToPlayers ? 1 : 0,
      attachMarkerId: optionalId(input.attachMarkerId), attachPageId: optionalId(input.attachPageId), kind: "combat",
      sourceEncounterId: input.sourceEncounterId, sessionNumber: null, realDate: null, inWorldLabel: null, calendarInstant: null
    });
  }

  updateEntry(entryId: string, input: CodexJournalUpdateInput): CodexJournalRow {
    const database = this.requireDatabase();
    const existing = this.journalRowRaw(entryId);
    if (!existing) throw new CodexNotFoundError("That journal entry no longer exists.");
    // A structured date (or a changed free-text label) recomputes the sort instant + display label together.
    const dated = (input.inWorldDate !== undefined || input.inWorldLabel !== undefined) ? this.resolveDate(input.inWorldDate ?? null, input.inWorldLabel) : null;
    const next = {
      player_text: input.playerText === undefined ? existing.player_text : entryText(input.playerText),
      gm_text: input.gmText === undefined ? existing.gm_text : entryGmText(input.gmText),
      attach_marker_id: input.attachMarkerId === undefined ? existing.attach_marker_id : optionalId(input.attachMarkerId),
      attach_page_id: input.attachPageId === undefined ? existing.attach_page_id : optionalId(input.attachPageId),
      session_number: input.sessionNumber === undefined ? existing.session_number : sessionNo(input.sessionNumber),
      real_date: input.realDate === undefined ? existing.real_date : shortLabel(input.realDate, 40, "date"),
      in_world_label: dated ? dated.label : existing.in_world_label,
      calendar_instant: dated ? dated.instant : existing.calendar_instant
    };
    this.transaction(() => {
      database.prepare("UPDATE codex_journal SET player_text = ?, gm_text = ?, attach_marker_id = ?, attach_page_id = ?, session_number = ?, real_date = ?, in_world_label = ?, calendar_instant = ?, updated_at = ? WHERE id = ?")
        .run(next.player_text, next.gm_text, next.attach_marker_id, next.attach_page_id, next.session_number, next.real_date, next.in_world_label, next.calendar_instant, this.stamp(), entryId);
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

  private insertEntry(fields: Readonly<{ playerText: string; gmText: string | null; revealed: number; attachMarkerId: string | null; attachPageId: string | null; kind: CodexJournalKind; sourceEncounterId: number | null; sessionNumber: number | null; realDate: string | null; inWorldLabel: string | null; calendarInstant: number | null }>): CodexJournalRow {
    const database = this.requireDatabase();
    const entryId = this.freshId();
    const stamp = this.stamp();
    const sortKey = ((database.prepare("SELECT MAX(sort_key) AS m FROM codex_journal").get() as { m: number | null }).m ?? 0) + 1;
    this.transaction(() => {
      database.prepare("INSERT INTO codex_journal (id, player_text, gm_text, revealed, attach_marker_id, attach_page_id, kind, source_encounter_id, session_number, real_date, in_world_label, calendar_instant, sort_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(entryId, fields.playerText, fields.gmText, fields.revealed, fields.attachMarkerId, fields.attachPageId, fields.kind, fields.sourceEncounterId, fields.sessionNumber, fields.realDate, fields.inWorldLabel, fields.calendarInstant, sortKey, stamp, stamp);
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
    return this.requireDatabase().prepare("SELECT id, title, entity_type, fields_json, folder, tags_json, player_body, gm_body, revealed, banner_asset_id, rev, created_at, updated_at FROM codex_pages WHERE id = ?").get(pageId) as PageRow | undefined;
  }

  private toPage(row: PageRow): CodexPageRow {
    return {
      id: row.id, title: row.title, entityType: (row.entity_type as CodexEntityType) ?? "note", fields: parseFields(row.fields_json),
      folder: row.folder, tags: JSON.parse(row.tags_json) as string[],
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
    this.requireDatabase().prepare("INSERT INTO codex_page_revisions (page_id, rev, title, entity_type, fields_json, player_body, gm_body, banner_asset_id, tags_json, authored_at, author_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(pageId, row.rev, row.title, row.entity_type, row.fields_json, row.player_body, row.gm_body, row.banner_asset_id, row.tags_json, row.updated_at, authorTag);
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
