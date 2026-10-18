import type { DatabaseSync } from "node:sqlite";
import { CharacterDraftSchema, type CharacterDraft } from "@vtt/domain";
import type { GamePrincipal } from "./commands/kit.js";
import { migrate, openDatabase, type Migration } from "./database.js";

/**
 * The character builder's parked builds, one per owner: each player session, and the GM. Kept beside the game state
 * since a draft belongs to one person and changes on every pick, and the game state goes to the
 * whole table on every change.
 */

export type StoredCharacterDraft = Readonly<{ draft: CharacterDraft; updatedAt: string }>;

/** Drafts nobody has touched in this long are dropped at start-up, so departed player sessions don't pile up. */
const STALE_AFTER_DAYS = 90;

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    up: (database) =>
      database.exec(`
        CREATE TABLE character_drafts (
          owner TEXT PRIMARY KEY,
          draft_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
      `)
  }
];

/** Whose draft a principal reads and writes. The GM's follows the role, since a GM sign-in is a new session each
 *  time; an integration acts for the GM. A player's is their session's. */
export function draftOwnerOf(principal: GamePrincipal): string {
  return principal.kind === "player" ? `player:${principal.sessionId}` : "gm";
}

export class CharacterDraftStore {
  private database?: DatabaseSync;

  constructor(private readonly databasePath: string) {}

  initialize(now: Date = new Date()) {
    if (this.database) return;
    const database = openDatabase(this.databasePath);
    try {
      migrate(database, "character-drafts", MIGRATIONS, { path: this.databasePath });
      const cutoff = new Date(now.getTime() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
      database.prepare("DELETE FROM character_drafts WHERE updated_at < ?").run(cutoff);
    } catch (error) {
      database.close();
      throw error;
    }
    this.database = database;
  }

  /** The owner's draft, or null. A stored draft that no longer parses (an older format) reads as none. */
  get(owner: string): StoredCharacterDraft | null {
    const row = this.requireDatabase()
      .prepare("SELECT draft_json, updated_at FROM character_drafts WHERE owner = ?")
      .get(owner) as { draft_json: string; updated_at: string } | undefined;
    if (!row) return null;
    const parsed = CharacterDraftSchema.safeParse(JSON.parse(row.draft_json));
    return parsed.success ? { draft: parsed.data, updatedAt: row.updated_at } : null;
  }

  save(owner: string, draft: CharacterDraft, now: Date = new Date()): string {
    const updatedAt = now.toISOString();
    this.requireDatabase()
      .prepare(
        `INSERT INTO character_drafts (owner, draft_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (owner) DO UPDATE SET draft_json = excluded.draft_json, updated_at = excluded.updated_at`
      )
      .run(owner, JSON.stringify(draft), updatedAt);
    return updatedAt;
  }

  discard(owner: string) {
    this.requireDatabase().prepare("DELETE FROM character_drafts WHERE owner = ?").run(owner);
  }

  close() {
    this.database?.close();
    this.database = undefined;
  }

  private requireDatabase(): DatabaseSync {
    if (!this.database) throw new Error("The character draft store is not initialized.");
    return this.database;
  }
}
