import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TokenCatalogStore } from "../src/token-catalog.js";
import { MapCatalogStore } from "../src/map-catalog.js";

const A = "10000000-0000-5000-8000-000000000001";
const B = "10000000-0000-5000-8000-000000000002";

describe("token catalog", () => {
  let dir: string;
  let store: TokenCatalogStore;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "tok-")); store = new TokenCatalogStore(join(dir, "vtt.sqlite")); await store.initialize(); });
  afterEach(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });

  it("registers a name + folder (spaces allowed) and lists it", () => {
    store.register(A, "Goblin Boss", "my monsters");
    expect(store.get(A)).toMatchObject({ name: "Goblin Boss", folder: "my monsters", lastUsedAt: null });
    expect(store.list().map((token) => token.assetId)).toEqual([A]);
  });

  it("rejects a folder with a slash (one level only)", () => {
    expect(() => store.register(A, "X", "a/b")).toThrow(/one level/);
  });

  it("renames a folder across entries and clears it with null", () => {
    store.register(A, "A", "mine"); store.register(B, "B", "mine");
    store.renameFolder("mine", "ours");
    expect(store.get(A)!.folder).toBe("ours");
    store.renameFolder("ours", null);
    expect(store.get(A)!.folder).toBeNull();
  });

  it("remembers and recalls the last image used for a definition, forgetting a removed asset", () => {
    store.register(A, "A", null);
    store.rememberForDefinition("goblin-boss", A);
    expect(store.recallForDefinition("goblin-boss")).toBe(A);
    store.remove(A);
    expect(store.recallForDefinition("goblin-boss")).toBeNull();
  });

  it("orders the list by last-used, then name", () => {
    store.register(A, "Zed", null); store.register(B, "Amy", null);
    store.touchLastUsed(A);
    expect(store.list().map((token) => token.name)).toEqual(["Zed", "Amy"]);
  });
});

describe("map catalog folder upgrade", () => {
  it("adds the folder column to a catalog created before folders existed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "map-"));
    const path = join(dir, "vtt.sqlite");
    const legacy = new DatabaseSync(path);
    legacy.exec("CREATE TABLE map_catalog (asset_id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, calibration_json TEXT, scale_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;");
    legacy.prepare("INSERT INTO map_catalog (asset_id, name, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(A, "Old Map", "battlemap", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    legacy.close();

    const store = new MapCatalogStore(path);
    await store.initialize();
    expect(store.get(A)).toMatchObject({ name: "Old Map", folder: null });
    store.updateDetails(A, { folder: "arena" });
    expect(store.get(A)!.folder).toBe("arena");
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
});
