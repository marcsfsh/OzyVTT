import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { GameStateSchema, type GameState } from "@vtt/domain";

export class GameStore {
  private state: GameState = GameStateSchema.parse({ schemaVersion: 1 });
  constructor(private readonly filePath: string) {}
  async initialize() {
    try { this.state = GameStateSchema.parse(JSON.parse(await readFile(this.filePath, "utf8"))); } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.persist();
    }
  }
  get snapshot() { return structuredClone(this.state); }
  async mutate(mutator: (state: GameState) => void) { mutator(this.state); await this.persist(); return this.snapshot; }
  private async persist() { await mkdir(dirname(this.filePath), { recursive: true }); await writeFile(this.filePath, JSON.stringify(this.state, null, 2)); }
}
