import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { GameStateSchema, type GameState } from "@vtt/domain";

export class CommandRejectedError extends Error {}
export class RevisionConflictError extends Error {}

type Command = { id: string; type: string; actorId?: string; expectedRevision?: number };
type ReceiptRow = { revision: number };
type StateRow = { state_json: string };

const MIGRATIONS = [{
  version: 1,
  sql: `
    CREATE TABLE game_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      schema_version INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE command_receipts (
      command_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL UNIQUE,
      command_type TEXT NOT NULL,
      accepted_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE domain_events (
      sequence INTEGER PRIMARY KEY,
      command_id TEXT NOT NULL UNIQUE REFERENCES command_receipts(command_id),
      event_type TEXT NOT NULL,
      actor_id TEXT,
      occurred_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      revision INTEGER NOT NULL UNIQUE,
      state_json TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
  `
}];

export class GameStore {
  private state: GameState;
  private database?: DatabaseSync;
  private commandQueue: Promise<void> = Promise.resolve();

  constructor(private readonly databasePath: string, initialState?: GameState) {
    this.state = initialState ? structuredClone(initialState) : GameStateSchema.parse({ schemaVersion: 1 });
  }

  async initialize() {
    await mkdir(dirname(this.databasePath), { recursive: true });
    this.database = new DatabaseSync(this.databasePath, { enableForeignKeyConstraints: true });
    this.database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
    this.database.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;");
    this.migrate();
    const row = this.database.prepare("SELECT state_json FROM game_state WHERE id = 1").get() as StateRow | undefined;
    if (row) this.state = GameStateSchema.parse(JSON.parse(row.state_json));
    else this.insertInitialState();
  }

  get snapshot() { return structuredClone(this.state); }

  async execute(command: Command, mutate: (state: GameState) => void) {
    const operation = async () => {
      const database = this.requireDatabase();
      const receipt = database.prepare("SELECT revision FROM command_receipts WHERE command_id = ?").get(command.id) as ReceiptRow | undefined;
      if (receipt) return { state: this.snapshot, duplicate: true };
      if (command.expectedRevision !== undefined && command.expectedRevision !== this.state.revision) throw new RevisionConflictError("Your view is outdated. Reloading the current state is required.");

      const nextState = structuredClone(this.state);
      mutate(nextState);
      nextState.revision += 1;
      const acceptedAt = new Date().toISOString();

      database.exec("BEGIN IMMEDIATE");
      try {
        database.prepare("INSERT INTO command_receipts (command_id, revision, command_type, accepted_at) VALUES (?, ?, ?, ?)").run(command.id, nextState.revision, command.type, acceptedAt);
        database.prepare("INSERT INTO domain_events (sequence, command_id, event_type, actor_id, occurred_at) VALUES (?, ?, ?, ?, ?)").run(nextState.revision, command.id, command.type, command.actorId ?? null, acceptedAt);
        database.prepare("UPDATE game_state SET schema_version = ?, revision = ?, state_json = ?, updated_at = ? WHERE id = 1").run(nextState.schemaVersion, nextState.revision, JSON.stringify(nextState), acceptedAt);
        if (nextState.revision % 50 === 0) database.prepare("INSERT INTO snapshots (revision, state_json, reason, created_at) VALUES (?, ?, ?, ?)").run(nextState.revision, JSON.stringify(nextState), "periodic", acceptedAt);
        database.exec("COMMIT");
        this.state = nextState;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      return { state: this.snapshot, duplicate: false };
    };
    const result = this.commandQueue.then(operation);
    this.commandQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  close() { this.database?.close(); this.database = undefined; }

  private migrate() {
    const database = this.requireDatabase();
    const applied = new Set((database.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>).map(({ version }) => version));
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      database.exec("BEGIN IMMEDIATE");
      try {
        database.exec(migration.sql);
        database.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(migration.version, new Date().toISOString());
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    }
  }

  private insertInitialState() {
    const database = this.requireDatabase();
    const now = new Date().toISOString();
    database.prepare("INSERT INTO game_state (id, schema_version, revision, state_json, updated_at) VALUES (1, ?, ?, ?, ?)").run(this.state.schemaVersion, this.state.revision, JSON.stringify(this.state), now);
    database.prepare("INSERT INTO snapshots (revision, state_json, reason, created_at) VALUES (?, ?, ?, ?)").run(this.state.revision, JSON.stringify(this.state), "initial", now);
  }

  private requireDatabase() {
    if (!this.database) throw new Error("GameStore has not been initialized.");
    return this.database;
  }
}
