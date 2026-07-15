import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { GameStateSchema, type GameState } from "@vtt/domain";

export class CommandRejectedError extends Error {}
export class RevisionConflictError extends Error {}
type StoredEvent = { sequence: number; commandId: string; type: string; actorId?: string; at: string };
type Journal = { events: StoredEvent[]; receipts: Record<string, number> };

export class GameStore {
  private state: GameState = GameStateSchema.parse({ schemaVersion: 1 });
  private journal: Journal = { events: [], receipts: {} };
  private commandQueue: Promise<void> = Promise.resolve();
  constructor(private readonly filePath: string) {}
  async initialize() {
    try { this.state = GameStateSchema.parse(JSON.parse(await readFile(this.filePath, "utf8"))); } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try { this.journal = JSON.parse(await readFile(this.journalPath, "utf8")) as Journal; } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await this.persist();
  }
  get snapshot() { return structuredClone(this.state); }
  async execute(command: { id: string; type: string; actorId?: string; expectedRevision?: number }, mutate: (state: GameState) => void) {
    const operation = async () => {
      const priorRevision = this.journal.receipts[command.id];
      if (priorRevision !== undefined) return { state: this.snapshot, duplicate: true };
      if (command.expectedRevision !== undefined && command.expectedRevision !== this.state.revision) throw new RevisionConflictError("Your view is outdated. Reloading the current state is required.");
      mutate(this.state);
      this.state.revision += 1;
      this.journal.events.push({ sequence: this.state.revision, commandId: command.id, type: command.type, actorId: command.actorId, at: new Date().toISOString() });
      this.journal.receipts[command.id] = this.state.revision;
      await this.persist();
      return { state: this.snapshot, duplicate: false };
    };
    const result = this.commandQueue.then(operation);
    this.commandQueue = result.then(() => undefined, () => undefined);
    return result;
  }
  private get journalPath() { return join(dirname(this.filePath), "events.json"); }
  private async persist() {
    await mkdir(dirname(this.filePath), { recursive: true });
    await this.atomicWrite(this.filePath, JSON.stringify(this.state, null, 2));
    await this.atomicWrite(this.journalPath, JSON.stringify(this.journal, null, 2));
  }
  private async atomicWrite(path: string, contents: string) {
    const temporary = `${path}.tmp`;
    await writeFile(temporary, contents, { mode: 0o600 });
    await rename(temporary, path);
  }
}
