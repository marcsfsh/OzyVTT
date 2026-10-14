import type { CodexDb } from "./db.js";
import { isId } from "./validate.js";

/** The reveal predicates that gate reads which never load a record: search and media. */

/**
 * Player search visibility, one arm per kind matching that kind's player read (a weaker arm would make search
 * the leak). A marker also needs its map revealed. `ELSE 0` fails closed.
 */
export const PLAYER_SEARCH_VISIBLE_SQL = `(CASE codex_search_player.kind
  WHEN 'page' THEN EXISTS (SELECT 1 FROM codex_pages WHERE codex_pages.id = codex_search_player.record_id AND codex_pages.revealed = 1)
  WHEN 'journal' THEN EXISTS (SELECT 1 FROM codex_journal WHERE codex_journal.id = codex_search_player.record_id AND codex_journal.revealed = 1)
  WHEN 'map' THEN EXISTS (SELECT 1 FROM codex_maps WHERE codex_maps.id = codex_search_player.record_id AND codex_maps.revealed = 1)
  WHEN 'marker' THEN EXISTS (SELECT 1 FROM codex_markers JOIN codex_maps ON codex_maps.id = codex_markers.map_id
    WHERE codex_markers.id = codex_search_player.record_id AND codex_markers.revealed = 1 AND codex_maps.revealed = 1)
  WHEN 'quest' THEN EXISTS (SELECT 1 FROM codex_quests WHERE codex_quests.id = codex_search_player.record_id AND codex_quests.revealed = 1)
  WHEN 'session' THEN EXISTS (SELECT 1 FROM codex_sessions WHERE codex_sessions.id = codex_search_player.record_id AND codex_sessions.revealed = 1)
  ELSE 0 END)`;

/**
 * Whether a player may load an uploaded image: it is a revealed page's banner, or it appears in the
 * player-facing text of a revealed page, quest, session recap or journal entry.
 */
export function mediaVisibleToPlayers(db: CodexDb, assetId: string): boolean {
  if (!isId(assetId)) return false;
  return (
    db.database
      .prepare(
        `SELECT 1 FROM codex_pages WHERE revealed = 1 AND (banner_asset_id = :id OR player_body LIKE :pattern)
         UNION ALL SELECT 1 FROM codex_quests WHERE revealed = 1 AND player_body LIKE :pattern
         UNION ALL SELECT 1 FROM codex_sessions WHERE revealed = 1 AND recap_body LIKE :pattern
         UNION ALL SELECT 1 FROM codex_journal WHERE revealed = 1 AND player_text LIKE :pattern
         LIMIT 1`
      )
      .get({ id: assetId, pattern: `%${assetId}%` }) !== undefined
  );
}

/** Whether a revealed Codex map uses this image, so a player may fetch the map's picture. */
export function mapAssetVisibleToPlayers(db: CodexDb, assetId: string): boolean {
  if (!isId(assetId)) return false;
  return (
    db.database.prepare("SELECT 1 FROM codex_maps WHERE asset_id = ? AND revealed = 1 LIMIT 1").get(assetId) !==
    undefined
  );
}
