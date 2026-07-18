import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { GameStateSchema } from "@vtt/domain";
import { describe, expect, it } from "vitest";
import { GameStore, RevisionConflictError } from "../src/game-store.js";
import { createInitialGameState } from "../src/initial-game-state.js";
import { claimCharacter, forceReleaseCharacter } from "../src/character-claims.js";

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
      expect((database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count).toBe(5);
      database.close();
    } finally { store?.close(); await rm(directory, { recursive: true, force: true }); }
  });

  it("journals commands only while a fight is live, capturing payload, principal, and revision", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-journal-"));
    let store: GameStore | undefined;
    try {
      store = new GameStore(join(directory, "vtt.sqlite"), GameStateSchema.parse({ schemaVersion: 1, actors: [actor] }));
      await store.initialize();
      // No fight yet: not journaled.
      await store.execute({ id: "quiet-1", type: "character.claim", actorId: actor.id, payload: { actorId: actor.id }, principal: "player:p1" }, (state) => { state.actors[0].ownerSessionId = "e0bcfbbc-0211-462a-a8f9-b570545981f4"; });
      expect(store.listJournal()).toHaveLength(0);
      // The activating command is journaled (before-or-after active covers the start edge)...
      await store.execute({ id: "fight-on", type: "encounter.start", payload: { entries: [] }, principal: "gm:g1" }, (state) => {
        state.combat.active = true; state.combat.turnActorId = actor.id; state.combat.initiative = [{ actorId: actor.id, score: 10, tieBreaker: 0 }];
      });
      // ...as is everything during the fight, and the deactivating end itself.
      await store.execute({ id: "mid-fight", type: "actor.apply-damage", actorId: actor.id, payload: { amount: 3 }, principal: "integration:c1" }, (state) => { state.actors[0].hp.current -= 3; });
      await store.execute({ id: "fight-off", type: "encounter.end", payload: {}, principal: "gm:g1" }, (state) => { state.combat.active = false; state.combat.turnActorId = null; state.combat.initiative = []; });
      await store.execute({ id: "quiet-2", type: "character.release", payload: {}, principal: "player:p1" }, (state) => { state.actors[0].ownerSessionId = null; });

      const journal = store.listJournal();
      expect(journal.map((entry) => entry.type)).toEqual(["encounter.start", "actor.apply-damage", "encounter.end"]);
      expect(journal[1]).toMatchObject({ commandId: "mid-fight", actorId: actor.id, principal: "integration:c1", payload: { amount: 3 } });
      expect(journal[1].revision).toBe(3);
      expect(typeof journal[1].at).toBe("string");
    } finally { store?.close(); await rm(directory, { recursive: true, force: true }); }
  });

  it("adds the placeholder roster once to an existing empty database", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-roster-seed-"));
    const databasePath = join(directory, "vtt.sqlite");
    let store: GameStore | undefined;
    try {
      store = new GameStore(databasePath); await store.initialize(); store.close(); store = undefined;
      const database = new DatabaseSync(databasePath);
      database.prepare("DELETE FROM application_seeds").run();
      database.close();

      store = new GameStore(databasePath, createInitialGameState()); await store.initialize();
      expect(store.snapshot.actors).toHaveLength(3);
      expect(new Set(store.snapshot.actors.map(({ id }) => id)).size).toBe(3);
      store.close(); store = undefined;

      const reopened = new GameStore(databasePath, createInitialGameState()); await reopened.initialize();
      expect(reopened.snapshot.actors).toHaveLength(3);
      reopened.close(); store = undefined;

      const persisted = new DatabaseSync(databasePath, { readOnly: true });
      expect((persisted.prepare("SELECT COUNT(*) AS count FROM application_seeds").get() as { count: number }).count).toBe(1);
      persisted.close();
    } finally { store?.close(); await rm(directory, { recursive: true, force: true }); }
  });

  it("serializes simultaneous claims so exactly one player owns a character", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-claim-race-"));
    const databasePath = join(directory, "vtt.sqlite");
    const store = new GameStore(databasePath, GameStateSchema.parse({ schemaVersion: 1, actors: [actor] }));
    try {
      await store.initialize();
      const sessions = ["e0bcfbbc-0211-462a-a8f9-b570545981f4", "f0bcfbbc-0211-462a-a8f9-b570545981f5"];
      const results = await Promise.allSettled(sessions.map((sessionId, index) => store.execute(
        { id: `simultaneous-claim-${index}`, type: "character.claim", actorId: actor.id },
        (state) => claimCharacter(state, actor.id, sessionId)
      )));
      expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
      expect(sessions).toContain(store.snapshot.actors[0].ownerSessionId);
      expect(store.snapshot.revision).toBe(1);
    } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
  });

  it("persists a claim through restart and allows a GM force-release", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-claim-recovery-"));
    const databasePath = join(directory, "vtt.sqlite");
    const sessionId = "e0bcfbbc-0211-462a-a8f9-b570545981f4";
    let store: GameStore | undefined;
    try {
      store = new GameStore(databasePath, GameStateSchema.parse({ schemaVersion: 1, actors: [actor] }));
      await store.initialize();
      await store.execute({ id: "durable-claim", type: "character.claim", actorId: actor.id }, (state) => claimCharacter(state, actor.id, sessionId));
      store.close(); store = undefined;

      store = new GameStore(databasePath);
      await store.initialize();
      expect(store.snapshot.actors[0].ownerSessionId).toBe(sessionId);
      const unauthorizedState = store.snapshot;
      expect(() => forceReleaseCharacter(unauthorizedState, actor.id, "player")).toThrow("Only the GM");
      expect(unauthorizedState.actors[0].ownerSessionId).toBe(sessionId);
      await store.execute({ id: "gm-force-release", type: "character.force-release", actorId: actor.id }, (state) => forceReleaseCharacter(state, actor.id, "gm"));
      expect(store.snapshot.actors[0].ownerSessionId).toBeNull();
      expect(store.snapshot.revision).toBe(2);
    } finally { store?.close(); await rm(directory, { recursive: true, force: true }); }
  });
});
