import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Opens a SQLite file with the settings every store uses. Creates its directory if needed. */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
  return database;
}

/** Runs `work` in an immediate transaction: committed if it returns, rolled back if it throws. */
export function transaction<T>(database: DatabaseSync, work: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export type Migration = Readonly<{ version: number; up: (database: DatabaseSync) => void }>;

export class LegacyDatabaseError extends Error {
  constructor(path: string) {
    super(
      `${path} was created by an older OzyVTT whose migration history has been reset. ` +
        "Move the data directory aside to start fresh."
    );
  }
}

/**
 * Applies a store's pending migrations in version order, each in its own transaction, and records them
 * in the shared `migrations` table. `legacyTables` names migration tables from before the history was
 * reset; finding one means the file predates the current schema, so it is refused.
 */
export function migrate(
  database: DatabaseSync,
  store: string,
  migrations: readonly Migration[],
  options: Readonly<{ path: string; legacyTables?: readonly string[] }>
): void {
  for (const legacy of options.legacyTables ?? []) {
    const found = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(legacy);
    if (found) throw new LegacyDatabaseError(options.path);
  }
  database.exec(
    "CREATE TABLE IF NOT EXISTS migrations (store TEXT NOT NULL, version INTEGER NOT NULL, applied_at TEXT NOT NULL, PRIMARY KEY (store, version)) STRICT"
  );
  const applied = new Set(
    (database.prepare("SELECT version FROM migrations WHERE store = ?").all(store) as Array<{ version: number }>).map(
      (row) => row.version
    )
  );
  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (applied.has(migration.version)) continue;
    transaction(database, () => {
      migration.up(database);
      database
        .prepare("INSERT INTO migrations (store, version, applied_at) VALUES (?, ?, ?)")
        .run(store, migration.version, new Date().toISOString());
    });
  }
}
