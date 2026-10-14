import type { DatabaseSync } from "node:sqlite";
import { migrate, openDatabase, transaction, type Migration } from "./database.js";
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
  if (
    parsed.schemaVersion !== 1 ||
    !Number.isInteger(parsed.revision) ||
    (parsed.revision ?? -1) < 0 ||
    typeof parsed.enabled !== "boolean" ||
    !Array.isArray(parsed.pings) ||
    !Array.isArray(parsed.acceptedCommandIds) ||
    !parsed.initiative
  ) {
    throw new Error("Persisted viewer presentation state is malformed or unsupported.");
  }
  return parsed as ViewerPresentationState;
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    up: (database) =>
      database.exec(`
        CREATE TABLE viewer_presentation_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          schema_version INTEGER NOT NULL,
          revision INTEGER NOT NULL,
          state_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
      `)
  }
];

export class ViewerPresentationStore {
  private database?: DatabaseSync;
  private state = createViewerPresentationState();
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly databasePath: string) {}

  async initialize() {
    if (this.database) return;
    const database = openDatabase(this.databasePath);
    try {
      migrate(database, "viewer-presentation", MIGRATIONS, { path: this.databasePath });
      const row = database
        .prepare("SELECT schema_version, state_json FROM viewer_presentation_state WHERE id = 1")
        .get() as StateRow | undefined;
      if (row) {
        if (row.schema_version !== 1)
          throw new Error(`Viewer presentation schema version ${row.schema_version} is unsupported.`);
        this.state = parseState(row.state_json);
      } else {
        database
          .prepare(
            "INSERT INTO viewer_presentation_state (id, schema_version, revision, state_json, updated_at) VALUES (1, ?, ?, ?, ?)"
          )
          .run(1, this.state.revision, JSON.stringify(this.state), new Date().toISOString());
      }
    } catch (error) {
      database.close();
      throw error;
    }
    this.database = database;
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
      transaction(database, () => {
        const update = database
          .prepare(
            "UPDATE viewer_presentation_state SET schema_version = ?, revision = ?, state_json = ?, updated_at = ? WHERE id = 1 AND revision = ?"
          )
          .run(
            nextState.schemaVersion,
            nextState.revision,
            JSON.stringify(nextState),
            new Date(now).toISOString(),
            this.state.revision
          );
        if (update.changes !== 1) throw new Error("Viewer presentation state changed in another server process.");
      });
      this.state = nextState;
      return { state: structuredClone(this.state), duplicate: false } as const;
    };
    const result = this.operationQueue.then(operation);
    this.operationQueue = result.then(
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
    if (!this.database) throw new Error("ViewerPresentationStore has not been initialized.");
    return this.database;
  }
}
