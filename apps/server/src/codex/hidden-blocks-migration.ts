import type { DatabaseSync } from "node:sqlite";
import { codexDefaultHiddenFields, pruneCodexFields, type CodexEntityType } from "@vtt/domain";
import {
  blocksFromGmBody,
  blocksFromGmFields,
  derivedId,
  linkSources,
  serializeBlocks,
  type StoredBlock
} from "./blocks.js";
import type { CodexDb } from "./db.js";
import { backfillFirstShown } from "./first-shown.js";
import { rebuildLinksFrom } from "./links.js";
import { indexPage, indexQuest } from "./search.js";
import { hiddenFieldKeys, parseFields, parseStringArray } from "./validate.js";

/**
 * Codex migration 4: a page's or quest's single GM body becomes hidden blocks, a page's secret fields become a
 * per-page list of Hidden fields, objectives get ids and audiences, and the records players list gain first-shown
 * dates. Nothing changes for players: every block starts Hidden, every field keeps its audience, every objective
 * stays shown, and every list keeps its order.
 */

const COLUMNS = `
ALTER TABLE codex_pages ADD COLUMN hidden_fields_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE codex_pages ADD COLUMN character_updated_at_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE codex_pages ADD COLUMN blocks_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE codex_pages ADD COLUMN blocks_pending INTEGER NOT NULL DEFAULT 0;
ALTER TABLE codex_page_revisions ADD COLUMN hidden_fields_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE codex_page_revisions ADD COLUMN blocks_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE codex_quests ADD COLUMN blocks_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE codex_quests ADD COLUMN blocks_pending INTEGER NOT NULL DEFAULT 0;
ALTER TABLE codex_quests ADD COLUMN first_shown_at TEXT;
ALTER TABLE codex_maps ADD COLUMN first_shown_at TEXT;
ALTER TABLE codex_markers ADD COLUMN first_shown_at TEXT;
ALTER TABLE codex_sessions ADD COLUMN first_shown_at TEXT;
ALTER TABLE codex_standing ADD COLUMN first_shown_at TEXT;
ALTER TABLE codex_relationships ADD COLUMN began_year INTEGER;
ALTER TABLE codex_relationships ADD COLUMN began_month INTEGER;
ALTER TABLE codex_relationships ADD COLUMN began_day INTEGER;
ALTER TABLE codex_relationships ADD COLUMN began_before INTEGER NOT NULL DEFAULT 0;
-- An empty learned_at marks a connection players read before stamps existed.
ALTER TABLE codex_relationships ADD COLUMN learned_at TEXT;
ALTER TABLE codex_relationships ADD COLUMN learned_session_id TEXT;
ALTER TABLE codex_relationships ADD COLUMN learned_session_number INTEGER;
ALTER TABLE codex_relationships ADD COLUMN learned_year INTEGER;
ALTER TABLE codex_relationships ADD COLUMN learned_month INTEGER;
ALTER TABLE codex_relationships ADD COLUMN learned_day INTEGER;
ALTER TABLE codex_links ADD COLUMN character_ids_json TEXT NOT NULL DEFAULT '[]';
-- Text shown only to some party characters, one row per record and character.
CREATE VIRTUAL TABLE codex_search_character USING fts5(kind UNINDEXED, record_id UNINDEXED, character_id UNINDEXED, title, body);
`;

const DROPPED = `
ALTER TABLE codex_pages DROP COLUMN gm_body;
ALTER TABLE codex_pages DROP COLUMN gm_fields_json;
ALTER TABLE codex_page_revisions DROP COLUMN gm_body;
ALTER TABLE codex_page_revisions DROP COLUMN gm_fields_json;
ALTER TABLE codex_quests DROP COLUMN gm_body;
`;

/**
 * Field values from both maps in one, and the keys only the GM sees: the kind's defaults (Motives, Secret agenda)
 * and any key that had a value only on the GM side. Where both sides held a key, the value players read stays, and
 * a different GM value is returned in `kept` for a hidden block, so the upgrade drops nothing the GM wrote.
 */
export function mergedFields(
  type: CodexEntityType,
  fields: Readonly<Record<string, string>>,
  gmFields: Readonly<Record<string, string>>
): { fields: Record<string, string>; hiddenFields: string[]; kept: Record<string, string> } {
  const merged = pruneCodexFields(type, { ...gmFields, ...fields });
  const gmOnly = Object.keys(gmFields).filter((key) => !(key in fields));
  return {
    fields: merged,
    hiddenFields: hiddenFieldKeys(type, [...codexDefaultHiddenFields(type), ...gmOnly]),
    kept: Object.fromEntries(
      Object.entries(gmFields).filter(([key, value]) => key in fields && key in merged && fields[key] !== value)
    )
  };
}

/** An old page's GM body and any GM field value `mergedFields` kept, as hidden blocks after the player text. */
export function legacyPageBlocks(
  pageId: string,
  playerText: string,
  gmBody: string,
  kept: Readonly<Record<string, string>>
): StoredBlock[] {
  return [...blocksFromGmBody(pageId, playerText, gmBody), ...blocksFromGmFields(pageId, playerText, kept)];
}

/** An old objective list with ids and the Everyone audience, as players read it. */
export function migratedObjectives(questId: string, raw: string | null | undefined): unknown[] {
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .map((entry, index) => ({
      id: derivedId(`${questId}\nobjective\n${index}`),
      text: typeof entry.text === "string" ? entry.text : "",
      done: entry.done === true,
      audience: "everyone",
      characterIds: []
    }));
}

export function migrateToHiddenBlocks(database: DatabaseSync): void {
  database.exec(COLUMNS);
  const db: CodexDb = { database, now: Date.now };

  type PageRow = {
    id: string;
    title: string;
    entity_type: string;
    fields_json: string;
    gm_fields_json: string;
    tags_json: string;
    player_body: string;
    gm_body: string;
  };
  const updatePage = database.prepare(
    "UPDATE codex_pages SET fields_json = ?, hidden_fields_json = ?, blocks_json = ? WHERE id = ?"
  );
  const pages = database
    .prepare(
      "SELECT id, title, entity_type, fields_json, gm_fields_json, tags_json, player_body, gm_body FROM codex_pages"
    )
    .all() as PageRow[];
  const rebuilt: Array<{
    page: PageRow;
    fields: Record<string, string>;
    hiddenFields: string[];
    blocks: StoredBlock[];
  }> = [];
  for (const page of pages) {
    const type = page.entity_type as CodexEntityType;
    const merged = mergedFields(type, parseFields(page.fields_json), parseFields(page.gm_fields_json));
    const blocks = legacyPageBlocks(page.id, page.player_body, page.gm_body, merged.kept);
    updatePage.run(
      JSON.stringify(merged.fields),
      JSON.stringify(merged.hiddenFields),
      serializeBlocks(blocks),
      page.id
    );
    rebuilt.push({ page, fields: merged.fields, hiddenFields: merged.hiddenFields, blocks });
  }

  // A revision's sections take the same ids as its page's, so a restore keeps an unchanged block's audience.
  const updateRevision = database.prepare(
    "UPDATE codex_page_revisions SET fields_json = ?, hidden_fields_json = ?, blocks_json = ? WHERE id = ?"
  );
  for (const revision of database
    .prepare(
      "SELECT id, page_id, entity_type, fields_json, gm_fields_json, player_body, gm_body FROM codex_page_revisions"
    )
    .all() as Array<{
    id: number;
    page_id: string;
    entity_type: string;
    fields_json: string;
    gm_fields_json: string;
    player_body: string;
    gm_body: string;
  }>) {
    const merged = mergedFields(
      revision.entity_type as CodexEntityType,
      parseFields(revision.fields_json),
      parseFields(revision.gm_fields_json)
    );
    const blocks = legacyPageBlocks(revision.page_id, revision.player_body, revision.gm_body, merged.kept);
    updateRevision.run(
      JSON.stringify(merged.fields),
      JSON.stringify(merged.hiddenFields),
      serializeBlocks(blocks),
      revision.id
    );
  }

  type QuestRow = {
    id: string;
    title: string;
    player_body: string;
    gm_body: string;
    objectives_json: string;
    tags_json: string;
  };
  const updateQuest = database.prepare("UPDATE codex_quests SET blocks_json = ?, objectives_json = ? WHERE id = ?");
  const quests = database
    .prepare("SELECT id, title, player_body, gm_body, objectives_json, tags_json FROM codex_quests")
    .all() as QuestRow[];
  const rebuiltQuests = quests.map((quest) => {
    const blocks = blocksFromGmBody(quest.id, quest.player_body, quest.gm_body);
    const objectives = migratedObjectives(quest.id, quest.objectives_json);
    updateQuest.run(serializeBlocks(blocks), JSON.stringify(objectives), quest.id);
    return { quest, blocks, objectives: objectives as Array<{ text: string; audience: "everyone"; characterIds: [] }> };
  });

  database.exec(DROPPED);
  backfillFirstShown(database);

  // Mentions and search rows from the new layout. The rows players read come out as before.
  for (const { page, fields, hiddenFields, blocks } of rebuilt) {
    rebuildLinksFrom(db, "page", page.id, linkSources(page.player_body, blocks));
    indexPage(db, {
      id: page.id,
      title: page.title,
      playerBody: page.player_body,
      blocks,
      fields,
      hiddenFields,
      tags: parseStringArray(page.tags_json)
    });
  }
  for (const { quest, blocks, objectives } of rebuiltQuests) {
    rebuildLinksFrom(db, "quest", quest.id, linkSources(quest.player_body, blocks));
    indexQuest(db, {
      id: quest.id,
      title: quest.title,
      playerBody: quest.player_body,
      blocks,
      objectives,
      tags: parseStringArray(quest.tags_json)
    });
  }
}
