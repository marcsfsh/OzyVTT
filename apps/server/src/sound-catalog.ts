import type { DatabaseSync } from "node:sqlite";
import type { z } from "zod";
import type { PublicSoundAssetSchema } from "@vtt/api-contract/schemas";
import { migrate, openDatabase, type Migration } from "./database.js";
import { InvalidRequestError } from "./invalid-request.js";

/** A sound in the GM's library as the sound routes report it: the stored file's facts and the GM's name for it. */
export type PublicSoundAsset = Readonly<z.infer<typeof PublicSoundAssetSchema>>;

export type SoundCatalogEntry = Readonly<{ assetId: string; name: string; createdAt: string; updatedAt: string }>;

type CatalogRow = Readonly<{ asset_id: string; name: string; created_at: string; updated_at: string }>;

const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function soundName(value: string) {
  const name = value.trim();
  if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name))
    throw new InvalidRequestError("A sound's name must be 1 to 120 printable characters.");
  return name;
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    up: (database) =>
      database.exec(`
        CREATE TABLE sound_catalog (
          asset_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
      `)
  }
];

const rowToEntry = (row: CatalogRow): SoundCatalogEntry => ({
  assetId: row.asset_id,
  name: row.name,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

/** The GM's names for the uploaded sounds. The files and what they hold are `AudioAssetStore`'s. */
export class SoundCatalogStore {
  private database?: DatabaseSync;

  constructor(
    private readonly databasePath: string,
    private readonly now: () => number = Date.now
  ) {}

  async initialize() {
    if (this.database) return;
    const database = openDatabase(this.databasePath);
    try {
      migrate(database, "sound-catalog", MIGRATIONS, { path: this.databasePath });
    } catch (error) {
      database.close();
      throw error;
    }
    this.database = database;
  }

  /** Files a new sound under `name`; an upload of bytes already in the library keeps the name it has. */
  register(assetId: string, name: string) {
    if (!ASSET_ID.test(assetId)) throw new InvalidRequestError("Sound ID is malformed.");
    const now = new Date(this.now()).toISOString();
    this.requireDatabase()
      .prepare(
        "INSERT INTO sound_catalog (asset_id, name, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(asset_id) DO NOTHING"
      )
      .run(assetId, soundName(name), now, now);
    return this.get(assetId)!;
  }

  rename(assetId: string, name: string) {
    if (!this.get(assetId)) throw new InvalidRequestError("That sound is not in the library.");
    this.requireDatabase()
      .prepare("UPDATE sound_catalog SET name = ?, updated_at = ? WHERE asset_id = ?")
      .run(soundName(name), new Date(this.now()).toISOString(), assetId);
    return this.get(assetId)!;
  }

  remove(assetId: string) {
    this.requireDatabase().prepare("DELETE FROM sound_catalog WHERE asset_id = ?").run(assetId);
  }

  get(assetId: string) {
    if (!ASSET_ID.test(assetId)) return null;
    const row = this.requireDatabase()
      .prepare("SELECT asset_id, name, created_at, updated_at FROM sound_catalog WHERE asset_id = ?")
      .get(assetId) as CatalogRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  list() {
    return (
      this.requireDatabase()
        .prepare(
          "SELECT asset_id, name, created_at, updated_at FROM sound_catalog ORDER BY name COLLATE NOCASE, asset_id"
        )
        .all() as CatalogRow[]
    ).map(rowToEntry);
  }

  close() {
    this.database?.close();
    this.database = undefined;
  }

  private requireDatabase() {
    if (!this.database) throw new Error("SoundCatalogStore has not been initialized.");
    return this.database;
  }
}
