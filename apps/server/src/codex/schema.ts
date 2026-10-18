import type { DatabaseSync } from "node:sqlite";
import { migrate, type Migration } from "../database.js";
import { backfillFirstShown } from "./first-shown.js";
import { legacyPrep } from "./prep.js";

/**
 * The Codex tables. Records keep both layers in one row (`player_*` and `gm_*` columns plus `revealed`); only
 * `codex-projections.ts` decides what a player receives. `codex_links` and the two search tables are derived
 * from record text and rewritten by every write that changes it. Ids that point at other records carry no
 * foreign key where the deleting write clears them itself, so a dangling id is cleaned and never refused.
 */
const BASELINE = `
CREATE TABLE codex_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  codex_revision INTEGER NOT NULL,
  calendar_json TEXT,
  published_year INTEGER,
  published_month INTEGER,
  published_day INTEGER,
  active_session_id TEXT,
  revision_history_enabled INTEGER NOT NULL DEFAULT 1,
  revision_window_minutes INTEGER NOT NULL DEFAULT 90,
  autosave_enabled INTEGER NOT NULL DEFAULT 1,
  autosave_interval_seconds INTEGER NOT NULL DEFAULT 1
) STRICT;
INSERT INTO codex_meta (id, codex_revision) VALUES (1, 0);

CREATE TABLE codex_pages (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  gm_fields_json TEXT NOT NULL,
  folder TEXT,
  tags_json TEXT NOT NULL,
  player_body TEXT NOT NULL,
  gm_body TEXT NOT NULL,
  revealed INTEGER NOT NULL,
  banner_asset_id TEXT,
  in_world_year INTEGER,
  in_world_month INTEGER,
  in_world_day INTEGER,
  in_world_label TEXT,
  calendar_instant INTEGER,
  rev INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX codex_pages_instant ON codex_pages (calendar_instant);

CREATE TABLE codex_page_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id TEXT NOT NULL REFERENCES codex_pages(id) ON DELETE CASCADE,
  rev INTEGER NOT NULL,
  title TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  gm_fields_json TEXT NOT NULL,
  player_body TEXT NOT NULL,
  gm_body TEXT NOT NULL,
  banner_asset_id TEXT,
  tags_json TEXT NOT NULL,
  authored_at TEXT NOT NULL,
  author_tag TEXT NOT NULL
) STRICT;
CREATE INDEX codex_page_revisions_page ON codex_page_revisions (page_id, rev DESC);

CREATE TABLE codex_folders (
  path TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE codex_relationships (
  id TEXT PRIMARY KEY,
  from_page_id TEXT NOT NULL REFERENCES codex_pages(id) ON DELETE CASCADE,
  to_page_id TEXT NOT NULL REFERENCES codex_pages(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  layer TEXT NOT NULL CHECK (layer IN ('player', 'gm')),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX codex_relationships_from ON codex_relationships (from_page_id);
CREATE INDEX codex_relationships_to ON codex_relationships (to_page_id);

CREATE TABLE codex_links (
  source_kind TEXT NOT NULL CHECK (source_kind IN ('page', 'session', 'quest', 'journal')),
  source_id TEXT NOT NULL,
  layer TEXT NOT NULL CHECK (layer IN ('player', 'gm')),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('page', 'actor', 'monster', 'spell', 'map', 'marker')),
  target_ref TEXT NOT NULL,
  section TEXT
) STRICT;
CREATE INDEX codex_links_target ON codex_links (target_kind, target_ref);
CREATE INDEX codex_links_source ON codex_links (source_kind, source_id);

CREATE TABLE codex_maps (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('battlemap', 'regional', 'world')),
  parent_map_id TEXT REFERENCES codex_maps(id) ON DELETE SET NULL,
  revealed INTEGER NOT NULL,
  sort_key INTEGER NOT NULL,
  tags_json TEXT NOT NULL,
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
  page_ids_json TEXT NOT NULL,
  sub_map_id TEXT,
  scene_ids_json TEXT NOT NULL,
  actor_id TEXT,
  tags_json TEXT NOT NULL,
  is_party INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX codex_markers_map ON codex_markers (map_id);
-- One party pin atlas-wide, so a new pin must clear the old one first.
CREATE UNIQUE INDEX codex_markers_party ON codex_markers (is_party) WHERE is_party = 1;

CREATE TABLE codex_sessions (
  id TEXT PRIMARY KEY,
  session_number INTEGER,
  real_date TEXT,
  attendees_json TEXT NOT NULL,
  prep_body TEXT NOT NULL,
  recap_body TEXT NOT NULL,
  revealed INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned', 'played')),
  tags_json TEXT NOT NULL,
  scene_ids_json TEXT NOT NULL,
  rev INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX codex_sessions_number ON codex_sessions (session_number) WHERE session_number IS NOT NULL;

-- deleted_session_number keeps the number of a revealed session that was deleted while the entry was filed
-- under it, so the party still reads "Session 4"; a filed entry takes its number from the joined session.
CREATE TABLE codex_journal (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('note', 'combat', 'deadline', 'downtime', 'milestone', 'standing', 'quest')),
  player_text TEXT NOT NULL,
  gm_text TEXT,
  revealed INTEGER NOT NULL,
  attach_marker_id TEXT,
  attach_page_id TEXT,
  source_encounter_id INTEGER,
  session_id TEXT,
  deleted_session_number INTEGER,
  real_date TEXT,
  in_world_year INTEGER,
  in_world_month INTEGER,
  in_world_day INTEGER,
  in_world_label TEXT,
  calendar_instant INTEGER,
  sort_key INTEGER NOT NULL,
  tags_json TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX codex_journal_marker ON codex_journal (attach_marker_id);
CREATE INDEX codex_journal_page ON codex_journal (attach_page_id);
CREATE INDEX codex_journal_session ON codex_journal (session_id);

CREATE TABLE codex_quests (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('not-started', 'active', 'completed', 'failed', 'canceled')),
  player_body TEXT NOT NULL,
  gm_body TEXT NOT NULL,
  objectives_json TEXT NOT NULL,
  entity_ids_json TEXT NOT NULL,
  revealed INTEGER NOT NULL,
  tags_json TEXT NOT NULL,
  rev INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

-- No CHECK on value: it is clamped on the way in and again on the way out.
CREATE TABLE codex_standing (
  id TEXT PRIMARY KEY,
  faction_page_id TEXT NOT NULL REFERENCES codex_pages(id) ON DELETE CASCADE,
  value INTEGER NOT NULL,
  revealed INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX codex_standing_faction ON codex_standing (faction_page_id);

-- The response a commandId got, stored so a retry replays it byte for byte; pruned lazily on write.
CREATE TABLE codex_command_receipts (
  command_id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  status INTEGER NOT NULL,
  body_json TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

-- One index per audience. The player table holds only player-layer text; reveal is checked when it is read.
CREATE VIRTUAL TABLE codex_search_player USING fts5(kind UNINDEXED, record_id UNINDEXED, title, body);
CREATE VIRTUAL TABLE codex_search_gm USING fts5(kind UNINDEXED, record_id UNINDEXED, title, body);
`;

export const CODEX_MIGRATIONS: readonly Migration[] = [
  { version: 1, up: (database) => database.exec(BASELINE) },
  {
    // The edit time players get, moved only by the player half. An existing page starts from `updated_at`,
    // which players could already read, so the upgrade shows them nothing new.
    version: 2,
    up: (database) =>
      database.exec(`
        ALTER TABLE codex_pages ADD COLUMN player_updated_at TEXT NOT NULL DEFAULT '';
        UPDATE codex_pages SET player_updated_at = updated_at;
      `)
  },
  {
    // When players could first read a page or an entry, which they get in place of `createdAt`. A record they
    // can read today starts from `createdAt`, which they could already read, so the upgrade shows them nothing new.
    version: 3,
    up: (database) => {
      database.exec(`
        ALTER TABLE codex_pages ADD COLUMN first_shown_at TEXT;
        ALTER TABLE codex_journal ADD COLUMN first_shown_at TEXT;
      `);
      backfillFirstShown(database);
    }
  },
  {
    // Session prep becomes sections copied from a template, with a library of templates and a default. A session's
    // free-text prep becomes one Text section, so nothing is lost; its text is the same, so its search row and
    // links stand as they are.
    version: 5,
    up: (database) => {
      database.exec(`
        ALTER TABLE codex_sessions ADD COLUMN prep_json TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE codex_sessions ADD COLUMN prep_template_id TEXT;
        ALTER TABLE codex_sessions ADD COLUMN current_scene_id TEXT;
        ALTER TABLE codex_meta ADD COLUMN default_prep_template_id TEXT;
        CREATE TABLE codex_prep_templates (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          sections_json TEXT NOT NULL,
          rev INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
      `);
      const sessions = database.prepare("SELECT id, prep_body FROM codex_sessions").all() as Array<{
        id: string;
        prep_body: string;
      }>;
      const update = database.prepare("UPDATE codex_sessions SET prep_json = ? WHERE id = ?");
      for (const session of sessions) update.run(JSON.stringify(legacyPrep(session.prep_body)), session.id);
      database.exec("ALTER TABLE codex_sessions DROP COLUMN prep_body");
    }
  }
];

/** Creates or checks the Codex tables. A file from before the migration history was reset is refused. */
export function migrateCodex(database: DatabaseSync, path: string): void {
  migrate(database, "codex", CODEX_MIGRATIONS, { path, legacyTables: ["codex_schema_migrations"] });
}

/** Tables of authored records. While all are empty the Codex is unused. */
export const CODEX_AUTHORED_TABLES = [
  "codex_pages",
  "codex_folders",
  "codex_relationships",
  "codex_maps",
  "codex_markers",
  "codex_journal",
  "codex_sessions",
  "codex_quests",
  "codex_standing"
] as const;

/** Everything a restore replaces: the authored tables, the prep templates and what derives from them, children first. */
export const CODEX_CONTENT_TABLES = [
  "codex_prep_templates",
  "codex_page_revisions",
  "codex_links",
  "codex_relationships",
  "codex_journal",
  "codex_markers",
  "codex_maps",
  "codex_standing",
  "codex_quests",
  "codex_sessions",
  "codex_folders",
  "codex_pages",
  "codex_search_player",
  "codex_search_gm"
] as const;
