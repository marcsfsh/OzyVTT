import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * `hidden` is the GM's CURATION flag (D18, director ruling R1): a token the shared library does not
 * offer players - spoiler monster art, the boss's portrait. It is NOT an approval queue; a player
 * still picks freely from what the library does offer, and still uploads their own with no gate.
 */
export type TokenCatalogEntry = Readonly<{ assetId: string; name: string; folder: string | null; createdAt: string; lastUsedAt: string | null; hidden: boolean }>;
type CatalogRow = Readonly<{ asset_id: string; name: string; folder: string | null; created_at: string; last_used_at: string | null; hidden?: number }>;

const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DEFINITION_ID = /^[a-z0-9-]+$/;

function assetId(value: string) { if (!ASSET_ID.test(value)) throw new Error("Token asset ID is malformed."); return value; }
function tokenName(value: string) {
  const name = value.trim();
  if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error("Token name must contain 1 to 120 printable characters.");
  return name;
}
/** One flat level of folders: a printable label with no slashes. Empty/undefined means "unfiled". */
export function tokenFolder(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const folder = value.trim();
  if (folder === "") return null;
  if (folder.length > 60 || folder.includes("/") || /[\u0000-\u001f\u007f]/.test(folder)) throw new Error("Folder must be one level: up to 60 printable characters, no slashes.");
  return folder;
}

function rowToEntry(row: CatalogRow): TokenCatalogEntry {
  return { assetId: assetId(row.asset_id), name: tokenName(row.name), folder: row.folder, createdAt: row.created_at, lastUsedAt: row.last_used_at, hidden: row.hidden === 1 };
}

/**
 * Names/folders for uploaded token images, plus a small per-definition memory of the last image used
 * so re-adding the same creature can offer it as a quick option. Lives on the game SQLite, alongside
 * the map catalog. Folders are implicit - they exist while a row references them.
 */
export class TokenCatalogStore {
  private database?: DatabaseSync;
  constructor(private readonly databasePath: string, private readonly now: () => number = Date.now) {}

  async initialize() {
    if (this.database) return;
    await mkdir(dirname(this.databasePath), { recursive: true });
    const database = new DatabaseSync(this.databasePath, { enableForeignKeyConstraints: true });
    try {
      database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
      database.exec(`
        CREATE TABLE IF NOT EXISTS token_catalog (asset_id TEXT PRIMARY KEY, name TEXT NOT NULL, folder TEXT, created_at TEXT NOT NULL, last_used_at TEXT) STRICT;
        CREATE TABLE IF NOT EXISTS token_definition_images (definition_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, used_at TEXT NOT NULL) STRICT;
      `);
      // Additive migration (this store has no migration table, like the token catalog's neighbours):
      // every pre-existing row reads back `hidden = 0`, which is what it has always meant.
      const columns = new Set((database.prepare("PRAGMA table_info(token_catalog)").all() as unknown as ReadonlyArray<{ name: string }>).map((column) => column.name));
      if (!columns.has("hidden")) database.exec("ALTER TABLE token_catalog ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;");
      this.database = database;
    } catch (error) { database.close(); throw error; }
  }

  register(assetIdInput: string, nameInput: string, folderInput: string | null) {
    const database = this.requireDatabase();
    const id = assetId(assetIdInput);
    const now = new Date(this.now()).toISOString();
    database.prepare("INSERT INTO token_catalog (asset_id, name, folder, created_at, last_used_at) VALUES (?, ?, ?, ?, NULL) ON CONFLICT(asset_id) DO UPDATE SET name = excluded.name, folder = excluded.folder")
      .run(id, tokenName(nameInput), tokenFolder(folderInput), now);
    return this.get(id)!;
  }

  updateDetails(assetIdInput: string, input: Readonly<{ name?: string; folder?: string | null; hidden?: boolean }>) {
    const existing = this.get(assetIdInput);
    if (!existing) throw new Error("Token asset is not registered.");
    const name = input.name === undefined ? existing.name : tokenName(input.name);
    const folder = input.folder === undefined ? existing.folder : tokenFolder(input.folder);
    const hidden = input.hidden === undefined ? existing.hidden : input.hidden;
    this.requireDatabase().prepare("UPDATE token_catalog SET name = ?, folder = ?, hidden = ? WHERE asset_id = ?").run(name, folder, hidden ? 1 : 0, existing.assetId);
    return this.get(existing.assetId)!;
  }

  /** Hide (or re-offer) every token in one folder at once - the GM curates a shelf, not a hundred rows. */
  setFolderHidden(folder: string | null, hidden: boolean) {
    const target = tokenFolder(folder);
    const database = this.requireDatabase();
    if (target === null) database.prepare("UPDATE token_catalog SET hidden = ? WHERE folder IS NULL").run(hidden ? 1 : 0);
    else database.prepare("UPDATE token_catalog SET hidden = ? WHERE folder = ?").run(hidden ? 1 : 0, target);
  }

  renameFolder(from: string, to: string | null) {
    const source = tokenFolder(from);
    if (source === null) throw new Error("Choose a folder to rename.");
    this.requireDatabase().prepare("UPDATE token_catalog SET folder = ? WHERE folder = ?").run(tokenFolder(to), source);
  }

  touchLastUsed(assetIdInput: string) {
    if (!ASSET_ID.test(assetIdInput)) return;
    this.requireDatabase().prepare("UPDATE token_catalog SET last_used_at = ? WHERE asset_id = ?").run(new Date(this.now()).toISOString(), assetIdInput);
  }

  rememberForDefinition(definitionId: string, assetIdInput: string) {
    if (!DEFINITION_ID.test(definitionId)) return;
    const id = assetId(assetIdInput);
    this.requireDatabase().prepare("INSERT INTO token_definition_images (definition_id, asset_id, used_at) VALUES (?, ?, ?) ON CONFLICT(definition_id) DO UPDATE SET asset_id = excluded.asset_id, used_at = excluded.used_at")
      .run(definitionId, id, new Date(this.now()).toISOString());
  }

  recallForDefinition(definitionId: string): string | null {
    if (!DEFINITION_ID.test(definitionId)) return null;
    const row = this.requireDatabase().prepare("SELECT asset_id FROM token_definition_images WHERE definition_id = ?").get(definitionId) as { asset_id: string } | undefined;
    return row && this.get(row.asset_id) ? row.asset_id : null;
  }

  remove(assetIdInput: string) {
    if (!ASSET_ID.test(assetIdInput)) return;
    const database = this.requireDatabase();
    database.prepare("DELETE FROM token_catalog WHERE asset_id = ?").run(assetIdInput);
    database.prepare("DELETE FROM token_definition_images WHERE asset_id = ?").run(assetIdInput);
  }

  get(assetIdInput: string) {
    if (!ASSET_ID.test(assetIdInput)) return null;
    const row = this.requireDatabase().prepare("SELECT asset_id, name, folder, created_at, last_used_at, hidden FROM token_catalog WHERE asset_id = ?").get(assetIdInput) as CatalogRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  /**
   * The library. `audience: "player"` drops the entries the GM has hidden - the curation half of D18,
   * applied HERE rather than at the router so no reader can forget it.
   */
  list(audience: "gm" | "player" = "gm") {
    const rows = this.requireDatabase().prepare("SELECT asset_id, name, folder, created_at, last_used_at, hidden FROM token_catalog ORDER BY (last_used_at IS NULL), last_used_at DESC, name").all() as CatalogRow[];
    const entries = rows.map(rowToEntry);
    return audience === "gm" ? entries : entries.filter((entry) => !entry.hidden);
  }

  close() { this.database?.close(); this.database = undefined; }
  private requireDatabase() { if (!this.database) throw new Error("TokenCatalogStore has not been initialized."); return this.database; }
}
