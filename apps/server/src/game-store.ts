import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { GameStateSchema, type GameState, type TurnHistoryEntry } from "@vtt/domain";

export class CommandRejectedError extends Error {}
export class RevisionConflictError extends Error {}
/** A timeline navigation needs an explicit GM confirmation first. Thrown from a timeline plan BEFORE any transaction, so it burns no receipt, no revision, and no domain event — the client re-sends with the confirm flag and a fresh commandId. */
export class TimelineConfirmationRequired extends Error {
  constructor(public readonly confirm: "rewrite-history" | "discard-changes", message: string) { super(message); }
}

type Command = { id: string; type: string; actorId?: string; expectedRevision?: number };
type ReceiptRow = { revision: number };
type StateRow = { state_json: string };
type TurnSnapshotRow = { idx: number; kind: "turn" | "return"; label: string; revision: number; created_at: string };
const PLACEHOLDER_ROSTER_SEED = "phase-1-placeholder-roster-v1";

export type GameStoreOptions = Readonly<{
  /**
   * Domain-aware comparator: did this mutation change state a turn-snapshot restore would roll back?
   * Consulted only while the table is rewound (historyCursor != null); a true result marks
   * historyDirty so forward navigation demands GM confirmation. Kept as an injected option so the
   * store stays ignorant of which fields are "restorable" — that judgment lives with the domain.
   */
  timelineDirtied?: (before: GameState, after: GameState) => boolean;
}>;

/**
 * Timeline operations available to a timeline plan. Reads run immediately (safe: plans execute inside
 * the store's serialized command queue, and this process is the only writer). Writes are QUEUED and
 * applied inside the same transaction as the state/receipt writes, so a crash can never leave the
 * timeline and the game state disagreeing.
 */
export type TimelineOps = Readonly<{
  entries: () => readonly TurnHistoryEntry[];
  read: (index: number) => GameState | null;
  /** Snapshot `stateToCapture` as the next entry (idx = max+1). Serialized at CALL time, so later mutations of the object do not leak in. */
  capture: (kind: "turn" | "return", label: string, stateToCapture: GameState) => void;
  /** Delete every entry with idx >= index (a history rewrite). */
  truncateFrom: (index: number) => void;
  /** Delete every entry (encounter lifecycle reset). */
  truncateAll: () => void;
  /** Delete one entry (consuming a return-point on resume). */
  remove: (index: number) => void;
  /** Delete every entry with idx < index (cap eviction of the oldest turns). */
  prune: (index: number) => void;
  /** Persist a permanent encounter archive row in this same transaction (used at encounter end, before truncateAll). */
  archive: (row: EncounterArchiveInput) => void;
}>;

export type EncounterArchiveInput = Readonly<{ commandId: string; startedAt: string | null; endedAt: string; turnCount: number; documentJson: string }>;
export type EncounterArchiveSummary = Readonly<{ id: number; archivedAt: string; startedAt: string | null; endedAt: string; turnCount: number }>;

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
}, {
  version: 2,
  sql: `
    CREATE TABLE application_seeds (
      seed_key TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;
  `
}, {
  version: 3,
  sql: `
    CREATE TABLE turn_snapshots (
      idx INTEGER PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('turn', 'return')),
      label TEXT NOT NULL,
      revision INTEGER NOT NULL,
      state_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
  `
}, {
  version: 4,
  sql: `
    CREATE TABLE encounter_archives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      command_id TEXT NOT NULL UNIQUE,
      archived_at TEXT NOT NULL,
      started_at TEXT,
      ended_at TEXT NOT NULL,
      turn_count INTEGER NOT NULL,
      document_json TEXT NOT NULL
    ) STRICT;
  `
}];

export class GameStore {
  private state: GameState;
  private readonly initialState: GameState;
  private database?: DatabaseSync;
  private commandQueue: Promise<void> = Promise.resolve();

  constructor(private readonly databasePath: string, initialState?: GameState, private readonly options: GameStoreOptions = {}) {
    this.initialState = initialState ? structuredClone(initialState) : GameStateSchema.parse({ schemaVersion: 1 });
    this.state = structuredClone(this.initialState);
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
    this.applyPlaceholderRosterSeed();
    // Reconcile a downgrade/upgrade cycle: an old server build strips historyCursor from the persisted
    // state while the turn_snapshots rows survive, which would strand a stale return-point mid-timeline.
    if (this.state.combat.historyCursor === null) this.database.exec("DELETE FROM turn_snapshots WHERE kind = 'return'");
  }

  get snapshot() { return structuredClone(this.state); }

  async execute(command: Command, mutate: (state: GameState) => void) {
    return this.enqueue(command, (nextState) => {
      mutate(nextState);
      // While the table is rewound, any change a restore would roll back needs GM confirmation
      // before history can move — mark it here so every command is covered without per-handler code.
      if (nextState.combat.historyCursor !== null && !nextState.combat.historyDirty && this.options.timelineDirtied?.(this.state, nextState)) {
        nextState.combat.historyDirty = true;
      }
      return [];
    });
  }

  /**
   * Execute a timeline-navigation command. The plan runs INSIDE the serialized command queue (so its
   * reads and decisions can never race another command) and its timeline writes are applied inside the
   * same transaction as the state write. A plan may throw TimelineConfirmationRequired to bounce the
   * command back for GM confirmation without consuming the commandId.
   */
  async executeTimeline(command: Command, plan: (state: GameState, timeline: TimelineOps) => void) {
    return this.enqueue(command, (nextState) => {
      const database = this.requireDatabase();
      const pending: Array<{ sql: string; params: readonly (string | number)[] }> = [];
      let nextIndex = ((database.prepare("SELECT MAX(idx) AS max_idx FROM turn_snapshots").get() as { max_idx: number | null }).max_idx ?? -1) + 1;
      const timeline: TimelineOps = {
        entries: () => (database.prepare("SELECT idx, kind, label, revision, created_at FROM turn_snapshots ORDER BY idx").all() as TurnSnapshotRow[])
          .map((row) => ({ index: row.idx, kind: row.kind, label: row.label, revision: row.revision, at: row.created_at })),
        read: (index) => {
          const row = database.prepare("SELECT state_json FROM turn_snapshots WHERE idx = ?").get(index) as StateRow | undefined;
          return row ? GameStateSchema.parse(JSON.parse(row.state_json)) : null;
        },
        capture: (kind, label, stateToCapture) => {
          pending.push({ sql: "INSERT INTO turn_snapshots (idx, kind, label, revision, state_json, created_at) VALUES (?, ?, ?, ?, ?, ?)", params: [nextIndex++, kind, label, stateToCapture.revision, JSON.stringify(stateToCapture), new Date().toISOString()] });
        },
        // Truncations move the next-capture cursor so a capture in the same plan lands at the freed idx
        // (rewrite captures at `cursor`; a full wipe restarts at 0) instead of leaving a gap or colliding.
        truncateFrom: (index) => { pending.push({ sql: "DELETE FROM turn_snapshots WHERE idx >= ?", params: [index] }); nextIndex = Math.min(nextIndex, index); },
        truncateAll: () => { pending.push({ sql: "DELETE FROM turn_snapshots", params: [] }); nextIndex = 0; },
        remove: (index) => { pending.push({ sql: "DELETE FROM turn_snapshots WHERE idx = ?", params: [index] }); },
        prune: (index) => { pending.push({ sql: "DELETE FROM turn_snapshots WHERE idx < ?", params: [index] }); },
        archive: (row) => { pending.push({ sql: "INSERT OR IGNORE INTO encounter_archives (command_id, archived_at, started_at, ended_at, turn_count, document_json) VALUES (?, ?, ?, ?, ?, ?)", params: [row.commandId, new Date().toISOString(), row.startedAt ?? "", row.endedAt, row.turnCount, row.documentJson] }); }
      };
      plan(nextState, timeline);
      return pending;
    });
  }

  /** Timeline metadata for the GM view (labels can name hidden combatants — never send to players). */
  listTurnSnapshots(): readonly TurnHistoryEntry[] {
    return (this.requireDatabase().prepare("SELECT idx, kind, label, revision, created_at FROM turn_snapshots ORDER BY idx").all() as TurnSnapshotRow[])
      .map((row) => ({ index: row.idx, kind: row.kind, label: row.label, revision: row.revision, at: row.created_at }));
  }

  /** Permanent, machine-readable records of ended encounters (GM-only; the document holds full state). Newest first. */
  listEncounterArchives(): readonly EncounterArchiveSummary[] {
    return (this.requireDatabase().prepare("SELECT id, archived_at, started_at, ended_at, turn_count FROM encounter_archives ORDER BY id DESC").all() as Array<{ id: number; archived_at: string; started_at: string | null; ended_at: string; turn_count: number }>)
      .map((row) => ({ id: row.id, archivedAt: row.archived_at, startedAt: row.started_at || null, endedAt: row.ended_at, turnCount: row.turn_count }));
  }
  /** The full archive document (JSON string) for one encounter, or null if unknown. */
  getEncounterArchive(id: number): string | null {
    const row = this.requireDatabase().prepare("SELECT document_json FROM encounter_archives WHERE id = ?").get(id) as { document_json: string } | undefined;
    return row?.document_json ?? null;
  }
  /** Remove one archived encounter (GM housekeeping). */
  deleteEncounterArchive(id: number): void {
    this.requireDatabase().prepare("DELETE FROM encounter_archives WHERE id = ?").run(id);
  }

  private async enqueue(command: Command, operate: (nextState: GameState) => ReadonlyArray<{ sql: string; params: readonly (string | number)[] }>) {
    const operation = async () => {
      const database = this.requireDatabase();
      const receipt = database.prepare("SELECT revision FROM command_receipts WHERE command_id = ?").get(command.id) as ReceiptRow | undefined;
      if (receipt) return { state: this.snapshot, duplicate: true };
      if (command.expectedRevision !== undefined && command.expectedRevision !== this.state.revision) throw new RevisionConflictError("Your view is outdated. Reloading the current state is required.");

      const nextState = structuredClone(this.state);
      const pendingTimelineWrites = operate(nextState);
      nextState.revision += 1;
      const acceptedAt = new Date().toISOString();

      database.exec("BEGIN IMMEDIATE");
      try {
        database.prepare("INSERT INTO command_receipts (command_id, revision, command_type, accepted_at) VALUES (?, ?, ?, ?)").run(command.id, nextState.revision, command.type, acceptedAt);
        database.prepare("INSERT INTO domain_events (sequence, command_id, event_type, actor_id, occurred_at) VALUES (?, ?, ?, ?, ?)").run(nextState.revision, command.id, command.type, command.actorId ?? null, acceptedAt);
        database.prepare("UPDATE game_state SET schema_version = ?, revision = ?, state_json = ?, updated_at = ? WHERE id = 1").run(nextState.schemaVersion, nextState.revision, JSON.stringify(nextState), acceptedAt);
        if (nextState.revision % 50 === 0) database.prepare("INSERT INTO snapshots (revision, state_json, reason, created_at) VALUES (?, ?, ?, ?)").run(nextState.revision, JSON.stringify(nextState), "periodic", acceptedAt);
        for (const write of pendingTimelineWrites) database.prepare(write.sql).run(...write.params);
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

  private applyPlaceholderRosterSeed() {
    const database = this.requireDatabase();
    const applied = database.prepare("SELECT 1 FROM application_seeds WHERE seed_key = ?").get(PLACEHOLDER_ROSTER_SEED);
    if (applied) return;
    const nextState = structuredClone(this.state);
    if (nextState.actors.length === 0 && this.initialState.actors.length > 0) {
      nextState.actors = structuredClone(this.initialState.actors);
      // Carry the starter sheets too, so backfilled actors don't reference a missing definition.
      if (nextState.definitions.length === 0) nextState.definitions = structuredClone(this.initialState.definitions);
    }
    const now = new Date().toISOString();
    database.exec("BEGIN IMMEDIATE");
    try {
      if (nextState.actors.length !== this.state.actors.length) {
        database.prepare("UPDATE game_state SET state_json = ?, updated_at = ? WHERE id = 1").run(JSON.stringify(nextState), now);
        database.prepare("UPDATE snapshots SET state_json = ? WHERE revision = ?").run(JSON.stringify(nextState), nextState.revision);
      }
      database.prepare("INSERT INTO application_seeds (seed_key, applied_at) VALUES (?, ?)").run(PLACEHOLDER_ROSTER_SEED, now);
      database.exec("COMMIT");
      this.state = nextState;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  private requireDatabase() {
    if (!this.database) throw new Error("GameStore has not been initialized.");
    return this.database;
  }
}
