import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CombatLogEntry, PlayerRollRecord, RollRecord, RollVisibility } from "@vtt/domain";

type LogRow = Readonly<{
  id: number; at: string; kind: string; text: string; gm_only: number; revision: number;
  actor_id: string | null; visibility: string | null; initiator_session_id: string | null; payload_json: string | null;
}>;

/**
 * Newest entries kept; older ones age out so the feed never grows without bound on a long campaign.
 * Raised from 1000 when rolls joined the feed (D11): one store now holds both narration and every
 * die rolled, and a dice-heavy night would otherwise age the narration out twice as fast.
 */
const CAP = 2000;

const SELECT_COLUMNS = "id, at, kind, text, gm_only, revision, actor_id, visibility, initiator_session_id, payload_json";

/**
 * Who is reading the feed. `sessionId` is the READER's session - the only thing that can unlock a
 * `self-only` roll row, and the reason the store (not the caller) decides what a player may see.
 */
export type FeedReader = Readonly<{ gm: boolean; sessionId?: string }>;

/**
 * A stored feed row BEFORE projection. Carries the two fields that must never reach a player:
 * `initiatorSessionId` (who rolled - a session id) and the raw roll visibility. NEVER serialize this
 * to a socket or an HTTP body; run it through `projectFeedRow` first, which is what strips them.
 */
export type StoredFeedRow = Readonly<{
  entry: CombatLogEntry;
  visibility: RollVisibility | null;
  initiatorSessionId: string | null;
}>;

/** A roll as it rides the feed: the player-safe shape for EVERY recipient (the GM already has the session id in `GameState.rolls`). */
function safeRoll(roll: RollRecord): PlayerRollRecord {
  const { initiatorSessionId: _private, ...visible } = roll;
  return visible;
}

/**
 * Can this reader see this row, and how is it marked? Returns null when the row is not theirs.
 *
 * This is `projections.ts`'s `visibleToPlayer` rule applied at the feed read, deliberately duplicated
 * nowhere else: non-roll rows follow `gmOnly`; roll rows additionally honour the roll's own visibility,
 * so a `self-only` roll reaches its roller and the GM and nobody else, and a `blind` roll reaches the
 * GM alone - including hiding it from the player who rolled it, exactly as the `hiddenFromRoller` ack
 * has always promised.
 */
export function projectFeedRow(row: StoredFeedRow, reader: FeedReader): CombatLogEntry | null {
  if (reader.gm) return row.entry;
  if (row.entry.gmOnly) return null;
  switch (row.visibility) {
    case null:
    case "public": return row.entry;
    case "self-only": return row.initiatorSessionId !== null && row.initiatorSessionId === reader.sessionId ? { ...row.entry, private: true } : null;
    // gm-only and blind rows are stored with gm_only = 1 and were already refused above; this arm is
    // the belt to that braces - a mis-stored row still never reaches a player.
    default: return null;
  }
}

/**
 * THE TABLE FEED (D11, #12): one durable, append-only record of what happened at the table - damage,
 * saves, actions, conditions, turn transitions, encounter/scene changes, GM history rewinds, AND every
 * die rolled. Lives on the game SQLite alongside the other catalogs.
 *
 * Visibility mirrors the toast/projection rules: an entry that references a GM-only combatant (or is
 * marked gmOnly) never reaches players, and a roll row additionally carries the roll's own visibility so
 * private rolls stay private. `GameState.rolls` remains the live 200-roll hot window for the sheet's
 * pinned last roll; this is the history, and the two share `RollRecord.id` so a client can dedupe.
 */
export class CombatLogStore {
  private database?: DatabaseSync;
  constructor(private readonly databasePath: string, private readonly now: () => number = Date.now) {}

  async initialize() {
    if (this.database) return;
    await mkdir(dirname(this.databasePath), { recursive: true });
    const database = new DatabaseSync(this.databasePath, { enableForeignKeyConstraints: true });
    try {
      database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
      database.exec("CREATE TABLE IF NOT EXISTS combat_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, gm_only INTEGER NOT NULL, revision INTEGER NOT NULL) STRICT;");
      // In-store migration (this file has no migration table): the feed columns are added to whatever
      // shape the campaign's existing database has. Nullable by construction, so every pre-feed row
      // reads back as "narration, no roll, follow gm_only" - which is exactly what it is.
      const existing = new Set((database.prepare("PRAGMA table_info(combat_log)").all() as unknown as ReadonlyArray<{ name: string }>).map((column) => column.name));
      for (const [column, type] of [["actor_id", "TEXT"], ["visibility", "TEXT"], ["initiator_session_id", "TEXT"], ["payload_json", "TEXT"]] as const) {
        if (!existing.has(column)) database.exec(`ALTER TABLE combat_log ADD COLUMN ${column} ${type};`);
      }
      this.database = database;
    } catch (error) { database.close(); throw error; }
  }

  /**
   * Append one feed line and return it with its assigned id. Evicts anything beyond the newest CAP rows.
   * Pass `roll` to write a `kind: "roll"` row: its visibility and initiator ride the row so the read
   * filter can answer "may this reader see it" without the caller re-deciding.
   */
  append(entry: Readonly<{ kind: CombatLogEntry["kind"]; text: string; gmOnly: boolean; revision: number; actorId?: string | null; roll?: RollRecord | null }>): StoredFeedRow {
    const database = this.requireDatabase();
    const at = new Date(this.now()).toISOString();
    const roll = entry.roll ?? null;
    const actorId = entry.actorId ?? roll?.actorId ?? null;
    const visibility = roll?.visibility ?? null;
    const initiatorSessionId = roll?.initiatorSessionId ?? null;
    const safe = roll ? safeRoll(roll) : null;
    const info = database
      .prepare(`INSERT INTO combat_log (at, kind, text, gm_only, revision, actor_id, visibility, initiator_session_id, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(at, entry.kind, entry.text, entry.gmOnly ? 1 : 0, entry.revision, actorId, visibility, initiatorSessionId, safe ? JSON.stringify(safe) : null);
    const id = Number(info.lastInsertRowid);
    database.prepare("DELETE FROM combat_log WHERE id <= ?").run(id - CAP);
    return {
      entry: { id, at, kind: entry.kind, text: entry.text, gmOnly: entry.gmOnly, revision: entry.revision, ...(actorId !== null ? { actorId } : {}), ...(safe ? { roll: safe } : {}) },
      visibility,
      initiatorSessionId
    };
  }

  /** Every retained line at or after a revision, chronological - the commentary slice for an encounter archive (GM export, so GM-only lines are included). */
  exportSince(minRevision: number): readonly CombatLogEntry[] {
    const rows = this.requireDatabase()
      .prepare(`SELECT ${SELECT_COLUMNS} FROM combat_log WHERE revision >= ? ORDER BY id`)
      .all(minRevision) as LogRow[];
    return rows.map((row) => toStoredRow(row).entry);
  }

  /**
   * The recent feed in chronological order (oldest first), projected for ONE reader. The GM sees
   * everything; a player sees public lines plus their own `self-only` rolls (marked `private`).
   *
   * `limit` counts rows READ, before per-reader filtering, so a player's page can come back shorter than
   * the GM's - the alternative (filtering in SQL on a session id) would push the visibility rule into a
   * query string, and this rule is the one thing that must live in one readable place.
   */
  list(includeGmOnly: boolean, limit = 250, sessionId?: string): readonly CombatLogEntry[] {
    const rows = this.requireDatabase()
      .prepare(`SELECT ${SELECT_COLUMNS} FROM combat_log WHERE (? = 1 OR gm_only = 0) ORDER BY id DESC LIMIT ?`)
      .all(includeGmOnly ? 1 : 0, limit) as LogRow[];
    const reader: FeedReader = { gm: includeGmOnly, ...(sessionId !== undefined ? { sessionId } : {}) };
    return rows.flatMap((row) => { const projected = projectFeedRow(toStoredRow(row), reader); return projected ? [projected] : []; }).reverse();
  }

  close() { this.database?.close(); this.database = undefined; }
  private requireDatabase() { if (!this.database) throw new Error("CombatLogStore has not been initialized."); return this.database; }
}

/** One stored row → the pre-projection shape. Legacy rows (no feed columns) read back as plain narration. */
function toStoredRow(row: LogRow): StoredFeedRow {
  const roll = row.payload_json === null ? null : (JSON.parse(row.payload_json) as PlayerRollRecord);
  return {
    entry: {
      id: row.id, at: row.at, kind: row.kind as CombatLogEntry["kind"], text: row.text, gmOnly: row.gm_only === 1, revision: row.revision,
      ...(row.actor_id !== null ? { actorId: row.actor_id } : {}),
      ...(roll ? { roll } : {})
    },
    visibility: (row.visibility as RollVisibility | null) ?? null,
    initiatorSessionId: row.initiator_session_id
  };
}
