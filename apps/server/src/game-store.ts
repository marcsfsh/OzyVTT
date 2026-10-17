import type { DatabaseSync } from "node:sqlite";
import { GameStateSchema, type GameState, type RefusalCode, type TurnHistoryEntry } from "@vtt/domain";
import { migrate, openDatabase, transaction, type Migration } from "./database.js";
import type { RuleId } from "./rules-families.js";

/** An expected refusal. `code` is what a client branches on (see `RefusalCode`); the message is for people. */
export class CommandRejectedError extends Error {
  constructor(
    message: string,
    public readonly code: RefusalCode | (string & {}) = "refused"
  ) {
    super(message);
  }
}
/** A rules-mode rejection (ADR-0020); rolls back without burning the commandId and carries the rule id (also
 *  its refusal code) and whether `override: {reason}` may bypass it. */
export class RulesBlockedError extends CommandRejectedError {
  constructor(
    public readonly rule: RuleId,
    message: string,
    public readonly overridable: boolean = true
  ) {
    super(message, rule);
  }
}
export class RevisionConflictError extends Error {}
/** A timeline navigation needs GM confirmation first. Thrown before any transaction, so it burns no receipt or revision; the client re-sends with the confirm flag and a fresh commandId. */
export class TimelineConfirmationRequired extends Error {
  constructor(
    public readonly confirm: "rewrite-history" | "discard-changes",
    message: string
  ) {
    super(message);
  }
}

type Command = {
  id: string;
  type: string;
  actorId?: string;
  expectedRevision?: number;
  /** The full validated wire payload, journaled verbatim while an encounter is live. */
  payload?: unknown;
  /** Who issued it: "gm:<sessionId>", "player:<sessionId>", "integration:<credentialId>", or a lifecycle tag. */
  principal?: string;
};
type ReceiptRow = { revision: number };
type StateRow = { state_json: string };
type TurnSnapshotRow = { idx: number; kind: "turn" | "return"; label: string; revision: number; created_at: string };
type JournalRow = {
  seq: number;
  command_id: string;
  command_type: string;
  actor_id: string | null;
  principal: string;
  payload_json: string;
  revision: number;
  at: string;
};

/** One journaled command from the live fight: enough for an external tool to replay or audit it. */
export type JournalEntry = Readonly<{
  seq: number;
  commandId: string;
  type: string;
  actorId: string | null;
  principal: string;
  payload: unknown;
  revision: number;
  at: string;
}>;

export type GameStoreOptions = Readonly<{
  /** Whether a mutation changed restorable state; while rewound, true marks historyDirty. Injected so the
   *  store doesn't know which fields are restorable. */
  timelineDirtied?: (before: GameState, after: GameState) => boolean;
  /** Runs after every command's own changes, in the same transaction: state the server keeps derived from the rest
   *  (what the party has seen, under dynamic vision). Must not throw for a command that is otherwise fine. */
  afterMutate?: (state: GameState) => void;
}>;

/** Timeline operations for a plan. Reads run immediately (inside the serialized queue); writes are queued
 *  into the state write's transaction, so the two can't disagree after a crash. */
export type TimelineOps = Readonly<{
  entries: () => readonly TurnHistoryEntry[];
  read: (index: number) => GameState | null;
  /** Snapshots `stateToCapture` as the next entry (idx = max+1), serialized at call time. */
  capture: (kind: "turn" | "return", label: string, stateToCapture: GameState) => void;
  /** Delete every entry with idx >= index (a history rewrite). */
  truncateFrom: (index: number) => void;
  /** Delete every entry (encounter lifecycle reset). */
  truncateAll: () => void;
  /** Delete one entry (consuming a return-point on resume). */
  remove: (index: number) => void;
  /** Delete every entry with idx < index (cap eviction of the oldest turns). */
  prune: (index: number) => void;
  /** Persists a permanent encounter archive row in this transaction (at encounter end, before truncateAll). */
  archive: (row: EncounterArchiveInput) => void;
  /** Every journaled command of the live fight, oldest first. */
  journalEntries: () => readonly JournalEntry[];
  /** Wipes the command journal in this transaction, optionally keeping the current command's own row. */
  clearJournal: (exceptCommandId?: string) => void;
}>;

export type EncounterArchiveInput = Readonly<{
  commandId: string;
  startedAt: string | null;
  endedAt: string;
  turnCount: number;
  documentJson: string;
}>;
export type EncounterArchiveSummary = Readonly<{
  id: number;
  archivedAt: string;
  startedAt: string | null;
  endedAt: string;
  turnCount: number;
  /** Shared with players by the GM? Default false. */ playerVisible: boolean;
}>;

type SqlWrite = Readonly<{ sql: string; params: readonly (string | number | null)[] }>;

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    up: (database) =>
      database.exec(`
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
        CREATE TABLE turn_snapshots (
          idx INTEGER PRIMARY KEY,
          kind TEXT NOT NULL CHECK (kind IN ('turn', 'return')),
          label TEXT NOT NULL,
          revision INTEGER NOT NULL,
          state_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE encounter_archives (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          command_id TEXT NOT NULL UNIQUE,
          archived_at TEXT NOT NULL,
          started_at TEXT,
          ended_at TEXT NOT NULL,
          turn_count INTEGER NOT NULL,
          document_json TEXT NOT NULL,
          player_visible INTEGER NOT NULL DEFAULT 0
        ) STRICT;
        CREATE TABLE encounter_journal (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          command_id TEXT NOT NULL,
          command_type TEXT NOT NULL,
          actor_id TEXT,
          principal TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          revision INTEGER NOT NULL,
          at TEXT NOT NULL
        ) STRICT;
      `)
  }
];

export class GameStore {
  private state: GameState;
  private database?: DatabaseSync;
  private commandQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly databasePath: string,
    initialState?: GameState,
    private readonly options: GameStoreOptions = {}
  ) {
    this.state = initialState ? structuredClone(initialState) : GameStateSchema.parse({ schemaVersion: 1 });
  }

  async initialize() {
    const database = openDatabase(this.databasePath);
    try {
      migrate(database, "game", MIGRATIONS, { path: this.databasePath, legacyTables: ["schema_migrations"] });
      const row = database.prepare("SELECT state_json FROM game_state WHERE id = 1").get() as StateRow | undefined;
      if (row) {
        this.state = GameStateSchema.parse(JSON.parse(row.state_json));
      } else {
        database
          .prepare(
            "INSERT INTO game_state (id, schema_version, revision, state_json, updated_at) VALUES (1, ?, ?, ?, ?)"
          )
          .run(this.state.schemaVersion, this.state.revision, JSON.stringify(this.state), new Date().toISOString());
      }
    } catch (error) {
      database.close();
      throw error;
    }
    this.database = database;
  }

  get snapshot() {
    return structuredClone(this.state);
  }

  async execute(command: Command, mutate: (state: GameState) => void) {
    return this.enqueue(command, (nextState) => {
      mutate(nextState);
      // While rewound, any change a restore would roll back needs GM confirmation before history can move;
      // marked here so every command is covered.
      if (
        nextState.combat.historyCursor !== null &&
        !nextState.combat.historyDirty &&
        this.options.timelineDirtied?.(this.state, nextState)
      ) {
        nextState.combat.historyDirty = true;
      }
      return [];
    });
  }

  /** Runs a timeline plan inside the serialized queue, its writes in the state transaction. A plan may throw
   *  TimelineConfirmationRequired without consuming the commandId. */
  async executeTimeline(command: Command, plan: (state: GameState, timeline: TimelineOps) => void) {
    return this.enqueue(command, (nextState) => {
      const database = this.requireDatabase();
      const pending: SqlWrite[] = [];
      let nextIndex =
        ((database.prepare("SELECT MAX(idx) AS max_idx FROM turn_snapshots").get() as { max_idx: number | null })
          .max_idx ?? -1) + 1;
      const timeline: TimelineOps = {
        entries: () => this.listTurnSnapshots(),
        read: (index) => {
          const row = database.prepare("SELECT state_json FROM turn_snapshots WHERE idx = ?").get(index) as
            StateRow | undefined;
          return row ? GameStateSchema.parse(JSON.parse(row.state_json)) : null;
        },
        capture: (kind, label, stateToCapture) => {
          pending.push({
            sql: "INSERT INTO turn_snapshots (idx, kind, label, revision, state_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            params: [
              nextIndex++,
              kind,
              label,
              stateToCapture.revision,
              JSON.stringify(stateToCapture),
              new Date().toISOString()
            ]
          });
        },
        // Truncations move the next-capture cursor so a capture in the same plan lands at the freed idx.
        truncateFrom: (index) => {
          pending.push({ sql: "DELETE FROM turn_snapshots WHERE idx >= ?", params: [index] });
          nextIndex = Math.min(nextIndex, index);
        },
        truncateAll: () => {
          pending.push({ sql: "DELETE FROM turn_snapshots", params: [] });
          nextIndex = 0;
        },
        remove: (index) => {
          pending.push({ sql: "DELETE FROM turn_snapshots WHERE idx = ?", params: [index] });
        },
        prune: (index) => {
          pending.push({ sql: "DELETE FROM turn_snapshots WHERE idx < ?", params: [index] });
        },
        archive: (row) => {
          pending.push({
            sql: "INSERT OR IGNORE INTO encounter_archives (command_id, archived_at, started_at, ended_at, turn_count, document_json) VALUES (?, ?, ?, ?, ?, ?)",
            params: [
              row.commandId,
              new Date().toISOString(),
              row.startedAt,
              row.endedAt,
              row.turnCount,
              row.documentJson
            ]
          });
        },
        journalEntries: () => this.listJournal(),
        clearJournal: (exceptCommandId) => {
          if (exceptCommandId === undefined) pending.push({ sql: "DELETE FROM encounter_journal", params: [] });
          else pending.push({ sql: "DELETE FROM encounter_journal WHERE command_id != ?", params: [exceptCommandId] });
        }
      };
      plan(nextState, timeline);
      return pending;
    });
  }

  /** Timeline metadata for the GM view (labels can name hidden combatants; never send to players). */
  listTurnSnapshots(): readonly TurnHistoryEntry[] {
    return (
      this.requireDatabase()
        .prepare("SELECT idx, kind, label, revision, created_at FROM turn_snapshots ORDER BY idx")
        .all() as TurnSnapshotRow[]
    ).map((row) => ({ index: row.idx, kind: row.kind, label: row.label, revision: row.revision, at: row.created_at }));
  }

  /** Current revision without cloning the whole state (cheap enough for ETag checks). */
  get revision(): number {
    return this.state.revision;
  }

  /** The live fight's command journal, oldest first. GM-grade: payloads can reference hidden combatants. */
  listJournal(): readonly JournalEntry[] {
    return (
      this.requireDatabase()
        .prepare(
          "SELECT seq, command_id, command_type, actor_id, principal, payload_json, revision, at FROM encounter_journal ORDER BY seq"
        )
        .all() as JournalRow[]
    ).map((row) => ({
      seq: row.seq,
      commandId: row.command_id,
      type: row.command_type,
      actorId: row.actor_id,
      principal: row.principal,
      payload: JSON.parse(row.payload_json) as unknown,
      revision: row.revision,
      at: row.at
    }));
  }

  /** Permanent records of ended encounters, newest first. GM-only: the document holds full state. */
  listEncounterArchives(): readonly EncounterArchiveSummary[] {
    return (
      this.requireDatabase()
        .prepare(
          "SELECT id, archived_at, started_at, ended_at, turn_count, player_visible FROM encounter_archives ORDER BY id DESC"
        )
        .all() as Array<{
        id: number;
        archived_at: string;
        started_at: string | null;
        ended_at: string;
        turn_count: number;
        player_visible: number;
      }>
    ).map((row) => ({
      id: row.id,
      archivedAt: row.archived_at,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      turnCount: row.turn_count,
      playerVisible: row.player_visible === 1
    }));
  }
  /** Shares or un-shares an archived fight; false if missing. Players only ever get the computed replay projection. */
  setEncounterArchiveVisibility(id: number, playerVisible: boolean): boolean {
    const result = this.requireDatabase()
      .prepare("UPDATE encounter_archives SET player_visible = ? WHERE id = ?")
      .run(playerVisible ? 1 : 0, id);
    return Number(result.changes) > 0;
  }
  /** The full archive document (JSON string) for one encounter, or null if unknown. */
  getEncounterArchive(id: number): string | null {
    const row = this.requireDatabase().prepare("SELECT document_json FROM encounter_archives WHERE id = ?").get(id) as
      { document_json: string } | undefined;
    return row?.document_json ?? null;
  }
  /** Remove one archived encounter (GM housekeeping). */
  deleteEncounterArchive(id: number): void {
    this.requireDatabase().prepare("DELETE FROM encounter_archives WHERE id = ?").run(id);
  }

  private async enqueue(command: Command, operate: (nextState: GameState) => readonly SqlWrite[]) {
    const operation = async () => {
      const database = this.requireDatabase();
      const receipt = database.prepare("SELECT revision FROM command_receipts WHERE command_id = ?").get(command.id) as
        ReceiptRow | undefined;
      if (receipt) return { state: this.snapshot, duplicate: true };
      if (command.expectedRevision !== undefined && command.expectedRevision !== this.state.revision)
        throw new RevisionConflictError("Your view is outdated. Reloading the current state is required.");

      const nextState = structuredClone(this.state);
      const pendingTimelineWrites = operate(nextState);
      this.options.afterMutate?.(nextState);
      nextState.revision += 1;
      const acceptedAt = new Date().toISOString();

      transaction(database, () => {
        database
          .prepare("INSERT INTO command_receipts (command_id, revision, command_type, accepted_at) VALUES (?, ?, ?, ?)")
          .run(command.id, nextState.revision, command.type, acceptedAt);
        database
          .prepare(
            "UPDATE game_state SET schema_version = ?, revision = ?, state_json = ?, updated_at = ? WHERE id = 1"
          )
          .run(nextState.schemaVersion, nextState.revision, JSON.stringify(nextState), acceptedAt);
        // Journal every accepted command while an encounter is live, including start and end. Runs before the
        // plan's queued writes so an encounter-lifecycle clearJournal can supersede it in the same transaction.
        if (this.state.combat.active || nextState.combat.active) {
          database
            .prepare(
              "INSERT INTO encounter_journal (command_id, command_type, actor_id, principal, payload_json, revision, at) VALUES (?, ?, ?, ?, ?, ?, ?)"
            )
            .run(
              command.id,
              command.type,
              command.actorId ?? null,
              command.principal ?? "unknown",
              JSON.stringify(command.payload ?? null),
              nextState.revision,
              acceptedAt
            );
        }
        for (const write of pendingTimelineWrites) database.prepare(write.sql).run(...write.params);
      });
      this.state = nextState;
      return { state: this.snapshot, duplicate: false };
    };
    const result = this.commandQueue.then(operation);
    this.commandQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  close() {
    this.database?.close();
    this.database = undefined;
  }

  private requireDatabase() {
    if (!this.database) throw new Error("GameStore has not been initialized.");
    return this.database;
  }
}
