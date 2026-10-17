import type { DatabaseSync } from "node:sqlite";
import { SoundBoardSchema, type SoundBoard } from "@vtt/domain";
import { migrate, openDatabase, transaction, type Migration } from "./database.js";

/**
 * The sound board's own store (ADR-0024): one row, its own revision and its own idempotency receipts. It is
 * apart from the game state on purpose: a music hand-over or a volume nudge must not bump the game revision a
 * player's token move was made against.
 */

type Stored = Readonly<{ revision: number; board: SoundBoard; acceptedCommandIds: readonly string[] }>;
type StateRow = Readonly<{ revision: number; state_json: string }>;

const MAX_RECEIPTS = 200;

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    up: (database) =>
      database.exec(`
        CREATE TABLE sound_board_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          revision INTEGER NOT NULL,
          state_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
      `)
  }
];

function parseStored(row: StateRow): Stored {
  const parsed = JSON.parse(row.state_json) as { board?: unknown; acceptedCommandIds?: unknown };
  const receipts = Array.isArray(parsed.acceptedCommandIds)
    ? parsed.acceptedCommandIds.filter((id): id is string => typeof id === "string")
    : [];
  return { revision: row.revision, board: SoundBoardSchema.parse(parsed.board ?? {}), acceptedCommandIds: receipts };
}

export class SoundStore {
  private database?: DatabaseSync;
  private stored: Stored = { revision: 0, board: SoundBoardSchema.parse({}), acceptedCommandIds: [] };
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly databasePath: string) {}

  async initialize() {
    if (this.database) return;
    const database = openDatabase(this.databasePath);
    try {
      migrate(database, "sound-board", MIGRATIONS, { path: this.databasePath });
      const row = database.prepare("SELECT revision, state_json FROM sound_board_state WHERE id = 1").get() as
        StateRow | undefined;
      if (row) this.stored = parseStored(row);
      else
        database
          .prepare("INSERT INTO sound_board_state (id, revision, state_json, updated_at) VALUES (1, 0, ?, ?)")
          .run(JSON.stringify({ board: this.stored.board, acceptedCommandIds: [] }), new Date().toISOString());
    } catch (error) {
      database.close();
      throw error;
    }
    this.database = database;
  }

  get revision() {
    return this.stored.revision;
  }

  /** A copy of the board, safe to read or change. */
  get board(): SoundBoard {
    return structuredClone(this.stored.board);
  }

  /** Runs one change against a copy of the board and commits it, once per `commandId`. A change that throws
   *  commits nothing. */
  execute(commandId: string, change: (board: SoundBoard) => void) {
    const operation = async () => {
      const database = this.requireDatabase();
      if (this.stored.acceptedCommandIds.includes(commandId))
        return { board: this.board, revision: this.stored.revision, duplicate: true } as const;
      const draft = this.board;
      change(draft);
      const next: Stored = {
        revision: this.stored.revision + 1,
        board: SoundBoardSchema.parse(draft),
        acceptedCommandIds: [...this.stored.acceptedCommandIds, commandId].slice(-MAX_RECEIPTS)
      };
      transaction(database, () => {
        const update = database
          .prepare(
            "UPDATE sound_board_state SET revision = ?, state_json = ?, updated_at = ? WHERE id = 1 AND revision = ?"
          )
          .run(
            next.revision,
            JSON.stringify({ board: next.board, acceptedCommandIds: next.acceptedCommandIds }),
            new Date().toISOString(),
            this.stored.revision
          );
        if (update.changes !== 1) throw new Error("The sound board changed in another server process.");
      });
      this.stored = next;
      return { board: this.board, revision: next.revision, duplicate: false } as const;
    };
    const result = this.queue.then(operation);
    this.queue = result.then(
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
    if (!this.database) throw new Error("SoundStore has not been initialized.");
    return this.database;
  }
}
