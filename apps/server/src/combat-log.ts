import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CombatLogEntry } from "@vtt/domain";

type LogRow = Readonly<{ id: number; at: string; kind: string; text: string; gm_only: number; revision: number }>;

/** Newest entries kept; older ones age out so the log never grows without bound on a long campaign. */
const CAP = 1000;

/**
 * The persistent combat/encounter log (#12): a durable, append-only record of what happened —
 * damage, saves, actions, conditions, turn transitions, encounter/scene changes, and GM history
 * rewinds. Lives on the game SQLite alongside the other catalogs. Visibility mirrors the toast/
 * projection rules: an entry that references a GM-only combatant (or is marked gmOnly) never reaches
 * players. The roll history stays the authoritative dice record; this log is the narrative timeline.
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
      this.database = database;
    } catch (error) { database.close(); throw error; }
  }

  /** Append one line and return it (with its assigned id). Evicts anything beyond the newest CAP rows. */
  append(entry: Readonly<{ kind: CombatLogEntry["kind"]; text: string; gmOnly: boolean; revision: number }>): CombatLogEntry {
    const database = this.requireDatabase();
    const at = new Date(this.now()).toISOString();
    const info = database.prepare("INSERT INTO combat_log (at, kind, text, gm_only, revision) VALUES (?, ?, ?, ?, ?)").run(at, entry.kind, entry.text, entry.gmOnly ? 1 : 0, entry.revision);
    const id = Number(info.lastInsertRowid);
    database.prepare("DELETE FROM combat_log WHERE id <= ?").run(id - CAP);
    return { id, at, kind: entry.kind, text: entry.text, gmOnly: entry.gmOnly, revision: entry.revision };
  }

  /** Every retained line at or after a revision, chronological — the commentary slice for an encounter archive (GM export, so GM-only lines are included). */
  exportSince(minRevision: number): readonly CombatLogEntry[] {
    const rows = this.requireDatabase()
      .prepare("SELECT id, at, kind, text, gm_only, revision FROM combat_log WHERE revision >= ? ORDER BY id")
      .all(minRevision) as LogRow[];
    return rows.map((row) => ({ id: row.id, at: row.at, kind: row.kind as CombatLogEntry["kind"], text: row.text, gmOnly: row.gm_only === 1, revision: row.revision }));
  }

  /** The recent log in chronological order (oldest first). GM sees everything; a player only public lines. */
  list(includeGmOnly: boolean, limit = 250): readonly CombatLogEntry[] {
    const rows = this.requireDatabase()
      .prepare("SELECT id, at, kind, text, gm_only, revision FROM combat_log WHERE (? = 1 OR gm_only = 0) ORDER BY id DESC LIMIT ?")
      .all(includeGmOnly ? 1 : 0, limit) as LogRow[];
    return rows.map((row) => ({ id: row.id, at: row.at, kind: row.kind as CombatLogEntry["kind"], text: row.text, gmOnly: row.gm_only === 1, revision: row.revision })).reverse();
  }

  close() { this.database?.close(); this.database = undefined; }
  private requireDatabase() { if (!this.database) throw new Error("CombatLogStore has not been initialized."); return this.database; }
}
