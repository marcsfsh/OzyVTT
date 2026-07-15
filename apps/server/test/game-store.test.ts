import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { GameStateSchema } from "@vtt/domain";
import { describe, expect, it } from "vitest";
import { GameStore, RevisionConflictError } from "../src/game-store.js";

const actor = { id: "60a6e172-9ff5-44a3-8a8b-93f836f0d16b", name: "Test Character", kind: "player-character", visibility: "public", hp: { current: 10, maximum: 10, temporary: 0 }, ownerSessionId: null };

describe("SQLite GameStore", () => {
  it("migrates, commits atomically, ignores retries, snapshots, and recovers after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-game-store-"));
    const databasePath = join(directory, "vtt.sqlite");
    let store: GameStore | undefined;
    try {
      const initialState = GameStateSchema.parse({ schemaVersion: 1, actors: [actor] });
      store = new GameStore(databasePath, initialState); await store.initialize();
      const first = await store.execute({ id: "claim-1", type: "character.claim", actorId: actor.id, expectedRevision: 0 }, (state) => { state.actors[0].ownerSessionId = "e0bcfbbc-0211-462a-a8f9-b570545981f4"; });
      const retry = await store.execute({ id: "claim-1", type: "character.claim", actorId: actor.id, expectedRevision: 0 }, () => { throw new Error("A duplicate must not run the mutation."); });
      expect(first.state.revision).toBe(1); expect(retry.duplicate).toBe(true); expect(retry.state.revision).toBe(1);
      await expect(store.execute({ id: "stale-claim", type: "character.claim", expectedRevision: 0 }, () => {})).rejects.toBeInstanceOf(RevisionConflictError);
      for (let revision = 2; revision <= 50; revision++) await store.execute({ id: `command-${revision}`, type: "test.noop" }, () => {});
      store.close(); store = undefined;

      const reopened = new GameStore(databasePath); await reopened.initialize();
      expect(reopened.snapshot.revision).toBe(50); expect(reopened.snapshot.actors[0].ownerSessionId).toBe("e0bcfbbc-0211-462a-a8f9-b570545981f4");
      reopened.close();

      const database = new DatabaseSync(databasePath, { readOnly: true });
      expect((database.prepare("SELECT COUNT(*) AS count FROM domain_events").get() as { count: number }).count).toBe(50);
      expect((database.prepare("SELECT COUNT(*) AS count FROM command_receipts").get() as { count: number }).count).toBe(50);
      expect((database.prepare("SELECT COUNT(*) AS count FROM snapshots").get() as { count: number }).count).toBe(2);
      expect((database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count).toBe(1);
      database.close();
    } finally { store?.close(); await rm(directory, { recursive: true, force: true }); }
  });
});
