import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { ViewerRevisionConflictError, type ViewerCommand } from "../src/viewer-presentation.js";
import { ViewerPresentationStore } from "../src/viewer-presentation-store.js";

function command(id: string, payload: ViewerCommand["payload"], expectedRevision?: number): ViewerCommand {
  return { id, role: "gm", payload, ...(expectedRevision === undefined ? {} : { expectedRevision }) };
}

describe("ViewerPresentationStore", () => {
  it("persists state atomically and recovers it after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-viewer-store-"));
    const databasePath = join(directory, "vtt.sqlite");
    let store: ViewerPresentationStore | undefined;
    try {
      store = new ViewerPresentationStore(databasePath);
      await store.initialize();
      await store.execute(command("enable", { type: "viewer.enabled.set", enabled: true }), 1_000);
      await store.execute(command("map", { type: "viewer.map.set", assetId: "map-1", altText: "Dungeon", camera: { center: { x: 100, y: 50 }, zoom: 2 } }), 1_100);
      await store.execute(command("ping", { type: "viewer.ping", id: "ping-1", point: { x: 20, y: 30 }, durationMs: 250 }), 1_200);
      expect(store.snapshot.revision).toBe(3);
      store.close(); store = undefined;

      store = new ViewerPresentationStore(databasePath);
      await store.initialize();
      expect(store.snapshot).toMatchObject({ revision: 3, enabled: true, activeMap: { assetId: "map-1" } });
      expect(store.project(1_449).pings).toHaveLength(1);
      expect(store.project(1_450).pings).toHaveLength(0);
    } finally {
      store?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("serializes simultaneous commands and safely handles retries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-viewer-concurrency-"));
    const databasePath = join(directory, "vtt.sqlite");
    const store = new ViewerPresentationStore(databasePath);
    try {
      await store.initialize();
      const [first, second] = await Promise.all([
        store.execute(command("first", { type: "viewer.enabled.set", enabled: true })),
        store.execute(command("second", { type: "viewer.enabled.set", enabled: false }))
      ]);
      expect(first.state.revision).toBe(1);
      expect(second.state.revision).toBe(2);
      const retry = await store.execute(command("first", { type: "viewer.enabled.set", enabled: true }, 0));
      expect(retry).toMatchObject({ duplicate: true, state: { revision: 2 } });
      await expect(store.execute(command("stale", { type: "viewer.enabled.set", enabled: true }, 1))).rejects.toBeInstanceOf(ViewerRevisionConflictError);
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("shares the application database without exposing private command receipts in projections", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-viewer-shared-db-"));
    const databasePath = join(directory, "vtt.sqlite");
    const database = new DatabaseSync(databasePath);
    database.exec("CREATE TABLE unrelated_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT; INSERT INTO unrelated_state VALUES (1, 'preserved');");
    database.close();

    const store = new ViewerPresentationStore(databasePath);
    try {
      await store.initialize();
      await store.initialize();
      await store.execute(command("enable", { type: "viewer.enabled.set", enabled: true }));
      expect(store.project()).not.toHaveProperty("acceptedCommandIds");
      store.close();

      const reopened = new DatabaseSync(databasePath, { readOnly: true });
      expect((reopened.prepare("SELECT value FROM unrelated_state WHERE id = 1").get() as { value: string }).value).toBe("preserved");
      expect((reopened.prepare("SELECT revision FROM viewer_presentation_state WHERE id = 1").get() as { revision: number }).revision).toBe(1);
      reopened.close();
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
