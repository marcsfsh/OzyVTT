import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  applyViewerCommand,
  createViewerPresentationState,
  projectViewerPresentation,
  type ViewerCommand,
  type ViewerPresentationProjection,
  type ViewerPresentationState
} from "./viewer-presentation.js";

type StateRow = Readonly<{ schema_version: number; state_json: string }>;

function parseState(value: string): ViewerPresentationState {
  const parsed = JSON.parse(value) as Partial<ViewerPresentationState>;
  if (parsed.schemaVersion !== 1 || !Number.isInteger(parsed.revision) || (parsed.revision ?? -1) < 0 || typeof parsed.enabled !== "boolean" || !Array.isArray(parsed.pings) || !Array.isArray(parsed.acceptedCommandIds) || !parsed.initiative) {
    throw new Error("Persisted viewer presentation state is malformed or unsupported.");
  }
  return {
    ...parsed,
    initiative: { ...parsed.initiative!, hiddenTurn: parsed.initiative!.hiddenTurn ?? false },
    encounter: parsed.encounter ?? { mapAssetId: null, tokens: [] }
  } as ViewerPresentationState;
}

export class ViewerPresentationStore {
  private database?: DatabaseSync;
  private state = createViewerPresentationState();
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly databasePath: string) {}

  async initialize() {
    if (this.database) return;
    await mkdir(dirname(this.databasePath), { recursive: true });
    const database = new DatabaseSync(this.databasePath, { enableForeignKeyConstraints: true });
    try {
      database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
      database.exec(`
        CREATE TABLE IF NOT EXISTS viewer_presentation_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          schema_version INTEGER NOT NULL,
          revision INTEGER NOT NULL,
          state_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
      `);
      const row = database.prepare("SELECT schema_version, state_json FROM viewer_presentation_state WHERE id = 1").get() as StateRow | undefined;
      if (row) {
        if (row.schema_version !== 1) throw new Error(`Viewer presentation schema version ${row.schema_version} is unsupported.`);
        this.state = parseState(row.state_json);
      } else {
        const now = new Date().toISOString();
        database.prepare("INSERT INTO viewer_presentation_state (id, schema_version, revision, state_json, updated_at) VALUES (1, ?, ?, ?, ?)").run(1, this.state.revision, JSON.stringify(this.state), now);
      }
      this.database = database;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  get snapshot() {
    this.requireDatabase();
    return structuredClone(this.state);
  }

  project(now = Date.now()): ViewerPresentationProjection {
    this.requireDatabase();
    return structuredClone(projectViewerPresentation(this.state, now));
  }

  async execute(command: ViewerCommand, now = Date.now()) {
    const operation = async () => {
      const database = this.requireDatabase();
      const result = applyViewerCommand(this.state, command, now);
      if (result.duplicate) return { state: structuredClone(this.state), duplicate: true } as const;
      const nextState = result.state;
      database.exec("BEGIN IMMEDIATE");
      try {
        const update = database.prepare("UPDATE viewer_presentation_state SET schema_version = ?, revision = ?, state_json = ?, updated_at = ? WHERE id = 1 AND revision = ?").run(
          nextState.schemaVersion,
          nextState.revision,
          JSON.stringify(nextState),
          new Date(now).toISOString(),
          this.state.revision
        );
        if (update.changes !== 1) throw new Error("Viewer presentation state changed in another server process.");
        database.exec("COMMIT");
        this.state = nextState;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      return { state: structuredClone(this.state), duplicate: false } as const;
    };
    const result = this.operationQueue.then(operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  close() {
    this.database?.close();
    this.database = undefined;
  }

  private requireDatabase() {
    if (!this.database) throw new Error("ViewerPresentationStore has not been initialized.");
    return this.database;
  }
}
