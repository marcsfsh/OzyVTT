import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { validateSquareGridCalibration, type ImagePoint, type SquareGridCalibration } from "./grid-calibration.js";
import { validateMapDistanceScale, type MapDistanceScale } from "./map-measurement.js";

export type MapKind = "battlemap" | "regional" | "world";

export type StoredGridCalibration = Readonly<{
  calibration: SquareGridCalibration;
  verifiedAt: string;
  verificationPoint: ImagePoint;
  verificationErrorPx: number;
}>;

export type MapCatalogEntry = Readonly<{
  assetId: string;
  name: string;
  kind: MapKind;
  calibration: StoredGridCalibration | null;
  scale: MapDistanceScale | null;
  createdAt: string;
  updatedAt: string;
}>;

type CatalogRow = Readonly<{
  asset_id: string;
  name: string;
  kind: MapKind;
  calibration_json: string | null;
  scale_json: string | null;
  created_at: string;
  updated_at: string;
}>;

const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function assetId(value: string) {
  if (!ASSET_ID.test(value)) throw new Error("Map asset ID is malformed.");
  return value;
}

function mapName(value: string) {
  const name = value.trim();
  if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error("Map name must contain 1 to 120 printable characters.");
  return name;
}

function mapKind(value: string): MapKind {
  if (value !== "battlemap" && value !== "regional" && value !== "world") throw new Error("Map kind must be battlemap, regional, or world.");
  return value;
}

function finitePoint(value: ImagePoint) {
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) throw new Error("Grid verification point must contain finite coordinates.");
  return { x: value.x, y: value.y };
}

function calibration(value: StoredGridCalibration) {
  validateSquareGridCalibration(value.calibration);
  finitePoint(value.verificationPoint);
  if (!Number.isFinite(value.verificationErrorPx) || value.verificationErrorPx < 0) throw new Error("Grid verification error must be a non-negative finite number.");
  if (!Number.isFinite(Date.parse(value.verifiedAt))) throw new Error("Grid verification timestamp is invalid.");
  return value;
}

function rowToEntry(row: CatalogRow): MapCatalogEntry {
  return {
    assetId: assetId(row.asset_id),
    name: mapName(row.name),
    kind: mapKind(row.kind),
    calibration: row.calibration_json ? calibration(JSON.parse(row.calibration_json) as StoredGridCalibration) : null,
    scale: row.scale_json ? validateMapDistanceScale(JSON.parse(row.scale_json) as MapDistanceScale) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class MapCatalogStore {
  private database?: DatabaseSync;

  constructor(private readonly databasePath: string, private readonly now: () => number = Date.now) {}

  async initialize() {
    if (this.database) return;
    await mkdir(dirname(this.databasePath), { recursive: true });
    const database = new DatabaseSync(this.databasePath, { enableForeignKeyConstraints: true });
    try {
      database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
      database.exec(`
        CREATE TABLE IF NOT EXISTS map_catalog (
          asset_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('battlemap', 'regional', 'world')),
          calibration_json TEXT,
          scale_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
      `);
      this.database = database;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  register(assetIdInput: string, nameInput: string, kindInput: MapKind) {
    const database = this.requireDatabase();
    const id = assetId(assetIdInput);
    const name = mapName(nameInput);
    const kind = mapKind(kindInput);
    const now = new Date(this.now()).toISOString();
    database.prepare("INSERT INTO map_catalog (asset_id, name, kind, calibration_json, scale_json, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, ?, ?) ON CONFLICT(asset_id) DO NOTHING").run(id, name, kind, now, now);
    return this.get(id)!;
  }

  updateDetails(assetIdInput: string, input: Readonly<{ name?: string; kind?: MapKind }>) {
    const database = this.requireDatabase();
    const existing = this.get(assetIdInput);
    if (!existing) throw new Error("Map asset is not registered.");
    const name = input.name === undefined ? existing.name : mapName(input.name);
    const kind = input.kind === undefined ? existing.kind : mapKind(input.kind);
    database.prepare("UPDATE map_catalog SET name = ?, kind = ?, updated_at = ? WHERE asset_id = ?").run(name, kind, new Date(this.now()).toISOString(), existing.assetId);
    return this.get(existing.assetId)!;
  }

  saveCalibration(assetIdInput: string, value: StoredGridCalibration) {
    const database = this.requireDatabase();
    const id = assetId(assetIdInput);
    if (!this.get(id)) throw new Error("Map asset is not registered.");
    const checked = calibration(value);
    database.prepare("UPDATE map_catalog SET calibration_json = ?, updated_at = ? WHERE asset_id = ?").run(JSON.stringify(checked), new Date(this.now()).toISOString(), id);
    return this.get(id)!;
  }

  saveScale(assetIdInput: string, value: MapDistanceScale) {
    const database = this.requireDatabase();
    const id = assetId(assetIdInput);
    if (!this.get(id)) throw new Error("Map asset is not registered.");
    const checked = validateMapDistanceScale(value);
    database.prepare("UPDATE map_catalog SET scale_json = ?, updated_at = ? WHERE asset_id = ?").run(JSON.stringify(checked), new Date(this.now()).toISOString(), id);
    return this.get(id)!;
  }

  get(assetIdInput: string) {
    if (!ASSET_ID.test(assetIdInput)) return null;
    const row = this.requireDatabase().prepare("SELECT asset_id, name, kind, calibration_json, scale_json, created_at, updated_at FROM map_catalog WHERE asset_id = ?").get(assetIdInput) as CatalogRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  list() {
    return (this.requireDatabase().prepare("SELECT asset_id, name, kind, calibration_json, scale_json, created_at, updated_at FROM map_catalog ORDER BY updated_at DESC, asset_id").all() as CatalogRow[]).map(rowToEntry);
  }

  close() { this.database?.close(); this.database = undefined; }

  private requireDatabase() {
    if (!this.database) throw new Error("MapCatalogStore has not been initialized.");
    return this.database;
  }
}
