import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { GameStateSchema } from "@vtt/domain";
import { describe, expect, it } from "vitest";
import { LegacyDatabaseError } from "../src/database.js";
import { GameStore, RevisionConflictError } from "../src/game-store.js";
import { claimCharacter, forceReleaseCharacter } from "../src/character-claims.js";

const actor = {
  id: "60a6e172-9ff5-44a3-8a8b-93f836f0d16b",
  name: "Test Character",
  kind: "player-character",
  visibility: "public",
  hp: { current: 10, maximum: 10, temporary: 0 },
  ownerSessionId: null
};

describe("SQLite GameStore", () => {
  it("migrates, commits atomically, ignores retries, and recovers after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-game-store-"));
    const databasePath = join(directory, "vtt.sqlite");
    let store: GameStore | undefined;
    try {
      const initialState = GameStateSchema.parse({ schemaVersion: 1, actors: [actor] });
      store = new GameStore(databasePath, initialState);
      await store.initialize();
      const first = await store.execute(
        { id: "claim-1", type: "character.claim", actorId: actor.id, expectedRevision: 0 },
        (state) => {
          state.actors[0].ownerSessionId = "e0bcfbbc-0211-462a-a8f9-b570545981f4";
        }
      );
      const retry = await store.execute(
        { id: "claim-1", type: "character.claim", actorId: actor.id, expectedRevision: 0 },
        () => {
          throw new Error("A duplicate must not run the mutation.");
        }
      );
      expect(first.state.revision).toBe(1);
      expect(retry.duplicate).toBe(true);
      expect(retry.state.revision).toBe(1);
      await expect(
        store.execute({ id: "stale-claim", type: "character.claim", expectedRevision: 0 }, () => {})
      ).rejects.toBeInstanceOf(RevisionConflictError);
      for (let revision = 2; revision <= 50; revision++)
        await store.execute({ id: `command-${revision}`, type: "test.noop" }, () => {});
      store.close();
      store = undefined;

      const reopened = new GameStore(databasePath);
      await reopened.initialize();
      expect(reopened.snapshot.revision).toBe(50);
      expect(reopened.snapshot.actors[0].ownerSessionId).toBe("e0bcfbbc-0211-462a-a8f9-b570545981f4");
      reopened.close();

      const database = new DatabaseSync(databasePath, { readOnly: true });
      expect(
        (database.prepare("SELECT COUNT(*) AS count FROM command_receipts").get() as { count: number }).count
      ).toBe(50);
      expect(database.prepare("SELECT store, version FROM migrations").all()).toEqual([
        { store: "game", version: 1 },
        { store: "game", version: 2 },
        { store: "game", version: 3 },
        { store: "game", version: 4 },
        { store: "game", version: 5 }
      ]);
      database.close();
    } finally {
      store?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("lets spell slots follow the rules dial in a game saved when they always advised", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-game-store-"));
    const databasePath = join(directory, "vtt.sqlite");
    try {
      const store = new GameStore(databasePath);
      await store.initialize();
      store.close();
      // Back to how an older build left it: migration 2 not applied, and the old default stored everywhere.
      const old = GameStateSchema.parse({ schemaVersion: 1 });
      const saved = {
        ...old,
        rulesPolicy: { dial: "strict", exceptions: { slots: "assisted", movement: "freeform" } },
        combat: { ...old.combat, ruleExceptions: { slots: "assisted" } }
      };
      const database = new DatabaseSync(databasePath);
      database.prepare("DELETE FROM migrations WHERE store = 'game' AND version = 2").run();
      database.prepare("UPDATE game_state SET state_json = ? WHERE id = 1").run(JSON.stringify(saved));
      database
        .prepare(
          "INSERT INTO turn_snapshots (idx, kind, label, revision, state_json, created_at) VALUES (0, 'turn', 'Round 1', 0, ?, ?)"
        )
        .run(JSON.stringify(saved), new Date().toISOString());
      database.close();

      const reopened = new GameStore(databasePath);
      await reopened.initialize();
      // A family the GM turned off stays off; only the old slots default goes.
      expect(reopened.snapshot.rulesPolicy.exceptions).toEqual({ movement: "freeform" });
      expect(reopened.snapshot.combat.ruleExceptions).toEqual({});
      reopened.close();
      const check = new DatabaseSync(databasePath, { readOnly: true });
      const snapshot = check.prepare("SELECT state_json FROM turn_snapshots WHERE idx = 0").get() as {
        state_json: string;
      };
      expect(JSON.parse(snapshot.state_json).combat.ruleExceptions).toEqual({});
      check.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reads a campaign saved before scenes became encounters under the new names", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-game-store-"));
    const databasePath = join(directory, "vtt.sqlite");
    try {
      const store = new GameStore(databasePath);
      await store.initialize();
      store.close();
      // Back to how an older build left it: migration 4 not applied, and every encounter saved under its scene name.
      const sceneId = "30000000-0000-4000-8000-000000000001";
      const old = GameStateSchema.parse({ schemaVersion: 1 });
      const saved = {
        ...old,
        combat: {
          ...old.combat,
          scenes: [
            { id: sceneId, name: "Warren", mapAssetId: "20000000-0000-5000-8000-000000000001", fightEndedAt: 5 }
          ],
          activeSceneId: sceneId
        }
      };
      const database = new DatabaseSync(databasePath);
      database.prepare("DELETE FROM migrations WHERE store = 'game' AND version = 4").run();
      database.prepare("UPDATE game_state SET state_json = ? WHERE id = 1").run(JSON.stringify(saved));
      database
        .prepare(
          "INSERT INTO turn_snapshots (idx, kind, label, revision, state_json, created_at) VALUES (0, 'turn', 'Round 1', 0, ?, ?)"
        )
        .run(JSON.stringify(saved), new Date().toISOString());
      database
        .prepare(
          "INSERT INTO encounter_journal (command_id, command_type, actor_id, principal, payload_json, revision, at) VALUES ('j1', 'scene.activate', NULL, 'gm', ?, 1, ?)"
        )
        .run(JSON.stringify({ sceneId }), new Date().toISOString());
      database
        .prepare(
          "INSERT INTO command_receipts (command_id, revision, command_type, accepted_at) VALUES ('r1', 1, 'scene.rename', ?)"
        )
        .run(new Date().toISOString());
      database.close();

      const reopened = new GameStore(databasePath);
      await reopened.initialize();
      expect(reopened.snapshot.combat.activeEncounterId).toBe(sceneId);
      expect(reopened.snapshot.combat.encounters).toMatchObject([{ id: sceneId, name: "Warren", endedAt: 5 }]);
      expect(reopened.listJournal()).toMatchObject([{ type: "encounter.activate", payload: { encounterId: sceneId } }]);
      reopened.close();
      const check = new DatabaseSync(databasePath, { readOnly: true });
      const snapshot = check.prepare("SELECT state_json FROM turn_snapshots WHERE idx = 0").get() as {
        state_json: string;
      };
      expect(JSON.parse(snapshot.state_json).combat.encounters[0].id).toBe(sceneId);
      expect(check.prepare("SELECT command_type FROM command_receipts WHERE command_id = 'r1'").get()).toEqual({
        command_type: "encounter.rename"
      });
      check.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("moves a saved typed-dice setting to the d20 dice mode, with damage left to the server", async () => {
    for (const [typedRolls, d20] of [
      ["open", "die"],
      ["gm-only", "app"]
    ] as const) {
      const directory = await mkdtemp(join(tmpdir(), "vtt-game-store-"));
      const databasePath = join(directory, "vtt.sqlite");
      try {
        const store = new GameStore(databasePath);
        await store.initialize();
        store.close();
        // Back to how an older build left it: migration 5 not applied, and the old setting on the builder policy.
        const old = GameStateSchema.parse({ schemaVersion: 1 });
        const { playerDice: _new, ...withoutDice } = old;
        const saved = { ...withoutDice, builderPolicy: { ...old.builderPolicy, typedRolls } };
        const database = new DatabaseSync(databasePath);
        database.prepare("DELETE FROM migrations WHERE store = 'game' AND version = 5").run();
        database.prepare("UPDATE game_state SET state_json = ? WHERE id = 1").run(JSON.stringify(saved));
        database.close();

        const reopened = new GameStore(databasePath);
        await reopened.initialize();
        expect(reopened.snapshot.playerDice).toEqual({ d20, damage: "app" });
        expect(reopened.snapshot.builderPolicy).not.toHaveProperty("typedRolls");
        reopened.close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  it("journals commands only while an encounter is live, capturing payload, principal, and revision", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-journal-"));
    let store: GameStore | undefined;
    try {
      store = new GameStore(
        join(directory, "vtt.sqlite"),
        GameStateSchema.parse({ schemaVersion: 1, actors: [actor] })
      );
      await store.initialize();
      // No fight yet: not journaled.
      await store.execute(
        {
          id: "quiet-1",
          type: "character.claim",
          actorId: actor.id,
          payload: { actorId: actor.id },
          principal: "player:p1"
        },
        (state) => {
          state.actors[0].ownerSessionId = "e0bcfbbc-0211-462a-a8f9-b570545981f4";
        }
      );
      expect(store.listJournal()).toHaveLength(0);
      // The activating command is journaled (before-or-after active covers the start edge)...
      await store.execute(
        { id: "fight-on", type: "encounter.start", payload: { entries: [] }, principal: "gm:g1" },
        (state) => {
          state.combat.active = true;
          state.combat.turnActorId = actor.id;
          state.combat.initiative = [{ actorId: actor.id, score: 10, tieBreaker: 0 }];
        }
      );
      // ...as is everything during the fight, and the deactivating end itself.
      await store.execute(
        {
          id: "mid-fight",
          type: "actor.apply-damage",
          actorId: actor.id,
          payload: { amount: 3 },
          principal: "integration:c1"
        },
        (state) => {
          state.actors[0].hp.current -= 3;
        }
      );
      await store.execute({ id: "fight-off", type: "encounter.end", payload: {}, principal: "gm:g1" }, (state) => {
        state.combat.active = false;
        state.combat.turnActorId = null;
        state.combat.initiative = [];
      });
      await store.execute(
        { id: "quiet-2", type: "character.release", payload: {}, principal: "player:p1" },
        (state) => {
          state.actors[0].ownerSessionId = null;
        }
      );

      const journal = store.listJournal();
      expect(journal.map((entry) => entry.type)).toEqual(["encounter.start", "actor.apply-damage", "encounter.end"]);
      expect(journal[1]).toMatchObject({
        commandId: "mid-fight",
        actorId: actor.id,
        principal: "integration:c1",
        payload: { amount: 3 }
      });
      expect(journal[1].revision).toBe(3);
      expect(typeof journal[1].at).toBe("string");
    } finally {
      store?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("refuses a database created before the migration history was reset", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-legacy-game-"));
    const databasePath = join(directory, "vtt.sqlite");
    const store = new GameStore(databasePath);
    try {
      const legacy = new DatabaseSync(databasePath);
      legacy.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;");
      legacy.close();
      await expect(store.initialize()).rejects.toBeInstanceOf(LegacyDatabaseError);
      await expect(store.execute({ id: "after-refusal", type: "test.noop" }, () => {})).rejects.toThrow(
        /not been initialized/
      );
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("serializes simultaneous claims so exactly one player owns a character", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-claim-race-"));
    const databasePath = join(directory, "vtt.sqlite");
    const store = new GameStore(databasePath, GameStateSchema.parse({ schemaVersion: 1, actors: [actor] }));
    try {
      await store.initialize();
      const sessions = ["e0bcfbbc-0211-462a-a8f9-b570545981f4", "f0bcfbbc-0211-462a-a8f9-b570545981f5"];
      const results = await Promise.allSettled(
        sessions.map((sessionId, index) =>
          store.execute({ id: `simultaneous-claim-${index}`, type: "character.claim", actorId: actor.id }, (state) =>
            claimCharacter(state, actor.id, sessionId)
          )
        )
      );
      expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
      expect(sessions).toContain(store.snapshot.actors[0].ownerSessionId);
      expect(store.snapshot.revision).toBe(1);
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("persists a claim through restart and allows a GM force-release", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-claim-recovery-"));
    const databasePath = join(directory, "vtt.sqlite");
    const sessionId = "e0bcfbbc-0211-462a-a8f9-b570545981f4";
    let store: GameStore | undefined;
    try {
      store = new GameStore(databasePath, GameStateSchema.parse({ schemaVersion: 1, actors: [actor] }));
      await store.initialize();
      await store.execute({ id: "durable-claim", type: "character.claim", actorId: actor.id }, (state) =>
        claimCharacter(state, actor.id, sessionId)
      );
      store.close();
      store = undefined;

      store = new GameStore(databasePath);
      await store.initialize();
      expect(store.snapshot.actors[0].ownerSessionId).toBe(sessionId);
      await store.execute({ id: "gm-force-release", type: "character.force-release", actorId: actor.id }, (state) =>
        forceReleaseCharacter(state, actor.id)
      );
      expect(store.snapshot.actors[0].ownerSessionId).toBeNull();
      expect(store.snapshot.revision).toBe(2);
    } finally {
      store?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
