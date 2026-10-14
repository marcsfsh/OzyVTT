import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CombatLogEntry, PlayerRollRecord, RollRecord, RollVisibility } from "@vtt/domain";
import { playerRoll } from "./projections.js";

type LogRow = Readonly<{
  id: number; at: string; kind: string; text: string; gm_only: number; revision: number;
  actor_id: string | null; visibility: string | null; initiator_session_id: string | null; payload_json: string | null;
}>;

// Newest entries kept, so the feed never grows without bound; sized for narration plus every die rolled.
const CAP = 2000;

const SELECT_COLUMNS = "id, at, kind, text, gm_only, revision, actor_id, visibility, initiator_session_id, payload_json";

/** Who is reading the feed. `sessionId` is the reader's own, the only thing that unlocks a `self-only` roll row. */
export type FeedReader = Readonly<{ gm: boolean; sessionId?: string }>;

/** A stored feed row before projection. Carries `initiatorSessionId` and the raw roll visibility, which
 *  must never reach a player: never serialize it without `projectFeedRow`. */
export type StoredFeedRow = Readonly<{
  entry: CombatLogEntry;
  visibility: RollVisibility | null;
  initiatorSessionId: string | null;
}>;


/** Whether a reader may see a row (null if not). Non-roll rows follow `gmOnly`; `self-only` rolls reach
 *  their roller and the GM; `blind` rolls reach only the GM. */
export function projectFeedRow(row: StoredFeedRow, reader: FeedReader): CombatLogEntry | null {
  if (reader.gm) return row.entry;
  if (row.entry.gmOnly) return null;
  switch (row.visibility) {
    case null:
    case "public": return row.entry;
    case "self-only": return row.initiatorSessionId !== null && row.initiatorSessionId === reader.sessionId ? { ...row.entry, private: true } : null;
    // gm-only and blind rows are stored with gm_only = 1 and refused above; this catches a mis-stored row.
    default: return null;
  }
}

/** The table feed: a durable, append-only record of what happened, including every die rolled. Rows
 *  naming a GM-only combatant (or marked gmOnly) never reach players. Shares `RollRecord.id` with the
 *  live `GameState.rolls` window so clients can dedupe. */
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
      // In-store migration: feed columns are added to an existing table. Nullable, so older rows read back as
      // plain narration following gm_only.
      const existing = new Set((database.prepare("PRAGMA table_info(combat_log)").all() as unknown as ReadonlyArray<{ name: string }>).map((column) => column.name));
      for (const [column, type] of [["actor_id", "TEXT"], ["visibility", "TEXT"], ["initiator_session_id", "TEXT"], ["payload_json", "TEXT"]] as const) {
        if (!existing.has(column)) database.exec(`ALTER TABLE combat_log ADD COLUMN ${column} ${type};`);
      }
      this.database = database;
    } catch (error) { database.close(); throw error; }
  }

  /** Appends one feed line and returns it with its id, evicting beyond the newest CAP rows. With `roll`,
   *  the roll's visibility and initiator ride the row so the read filter can decide. */
  append(entry: Readonly<{ kind: CombatLogEntry["kind"]; text: string; gmOnly: boolean; revision: number; actorId?: string | null; roll?: RollRecord | null }>): StoredFeedRow {
    const database = this.requireDatabase();
    const at = new Date(this.now()).toISOString();
    const roll = entry.roll ?? null;
    const actorId = entry.actorId ?? roll?.actorId ?? null;
    const visibility = roll?.visibility ?? null;
    const initiatorSessionId = roll?.initiatorSessionId ?? null;
    const safe = roll ? playerRoll(roll) : null;
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

  /** Every retained line at or after a revision, oldest first: an encounter archive's commentary (GM export, so GM-only lines included). */
  exportSince(minRevision: number): readonly CombatLogEntry[] {
    const rows = this.requireDatabase()
      .prepare(`SELECT ${SELECT_COLUMNS} FROM combat_log WHERE revision >= ? ORDER BY id`)
      .all(minRevision) as LogRow[];
    return rows.map((row) => toStoredRow(row).entry);
  }

  /** The recent feed, oldest first, projected for one reader. `limit` counts rows before filtering, keeping
   *  the visibility rule in code rather than SQL. */
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

/** One stored row to the pre-projection shape. Older rows without feed columns read back as plain narration. */
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
