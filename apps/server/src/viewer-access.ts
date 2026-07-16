import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type ViewerAccessMetadata = Readonly<{
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}>;

type ViewerAccessRow = Readonly<{
  id: string;
  name: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}>;

export class ViewerAccessDeniedError extends Error {}
export class ViewerPairingRateLimitError extends Error {}

const PAIRING_TTL_MS = 5 * 60 * 1_000;
const MAX_OUTSTANDING_PAIRINGS = 10;
const FAILED_ATTEMPT_WINDOW_MS = 60_000;
const MAX_FAILED_ATTEMPTS = 20;
const TOKEN_PREFIX = "vtt_viewer_";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeName(value: string) {
  const name = value.trim();
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error("Viewer name must contain 1 to 100 printable characters.");
  return name;
}

function safeId(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) throw new Error("Viewer access ID is malformed.");
  return value;
}

function timestamp(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative finite number.`);
  return new Date(value).toISOString();
}

function metadata(row: ViewerAccessRow): ViewerAccessMetadata {
  return { id: row.id, name: row.name, createdAt: row.created_at, expiresAt: row.expires_at, lastUsedAt: row.last_used_at, revokedAt: row.revoked_at };
}

function normalizePairingCode(value: string) {
  const code = value.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(code)) throw new ViewerAccessDeniedError("Viewer pairing code is invalid or expired.");
  return code;
}

export class ViewerAccessStore {
  private database?: DatabaseSync;
  private readonly pairingCodes = new Map<string, number>();
  private failedAttempts: number[] = [];

  constructor(
    private readonly databasePath: string,
    private readonly now: () => number = Date.now,
    private readonly entropy: (size: number) => Buffer = randomBytes
  ) {}

  async initialize() {
    if (this.database) return;
    await mkdir(dirname(this.databasePath), { recursive: true });
    const database = new DatabaseSync(this.databasePath, { enableForeignKeyConstraints: true });
    try {
      database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
      database.exec(`
        CREATE TABLE IF NOT EXISTS viewer_access_tokens (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          expires_at TEXT,
          last_used_at TEXT,
          revoked_at TEXT
        ) STRICT;
      `);
      this.database = database;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  createPairingCode(ttlMs = PAIRING_TTL_MS) {
    this.requireDatabase();
    const now = this.now();
    this.prunePairings(now);
    if (!Number.isInteger(ttlMs) || ttlMs < 30_000 || ttlMs > PAIRING_TTL_MS) throw new Error(`Pairing lifetime must be an integer from 30000 to ${PAIRING_TTL_MS} milliseconds.`);
    if (this.pairingCodes.size >= MAX_OUTSTANDING_PAIRINGS) throw new Error("Too many viewer pairing codes are active. Wait for one to expire.");
    const code = this.entropy(6).toString("hex").toUpperCase();
    this.pairingCodes.set(hash(code), now + ttlMs);
    return { code: `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`, expiresAt: timestamp(now + ttlMs, "Pairing expiration") };
  }

  exchangePairingCode(codeInput: string, nameInput: string, options: Readonly<{ expiresAt?: number | null }> = {}) {
    const database = this.requireDatabase();
    const now = this.now();
    this.enforceAttemptLimit(now);
    let code: string;
    try { code = normalizePairingCode(codeInput); }
    catch (error) { this.recordFailure(now); throw error; }
    const codeHash = hash(code);
    const pairingExpiresAt = this.pairingCodes.get(codeHash);
    if (pairingExpiresAt === undefined || pairingExpiresAt <= now) {
      this.pairingCodes.delete(codeHash);
      this.recordFailure(now);
      throw new ViewerAccessDeniedError("Viewer pairing code is invalid or expired.");
    }
    this.pairingCodes.delete(codeHash);
    const name = safeName(nameInput);
    const expiresAtMs = options.expiresAt ?? null;
    if (expiresAtMs !== null && (!Number.isFinite(expiresAtMs) || expiresAtMs <= now)) throw new Error("Viewer access expiration must be in the future.");
    const token = `${TOKEN_PREFIX}${this.entropy(32).toString("base64url")}`;
    const id = randomUUID();
    const createdAt = timestamp(now, "Viewer creation time");
    const expiresAt = expiresAtMs === null ? null : timestamp(expiresAtMs, "Viewer expiration");
    database.prepare("INSERT INTO viewer_access_tokens (id, name, token_hash, created_at, expires_at, last_used_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL, NULL)").run(id, name, hash(token), createdAt, expiresAt);
    return { token, viewer: { id, name, createdAt, expiresAt, lastUsedAt: null, revokedAt: null } satisfies ViewerAccessMetadata };
  }

  /**
   * Mints a viewer session directly, without a pairing code, for the GM's own read-only preview of
   * the shared screen (the in-tab iframe and the pop-out window). Only ever reached from a GM-authed
   * route. Reuses the newest non-revoked, unexpired preview session named `name` so repeatedly
   * opening the preview does not accumulate sessions.
   */
  mintPreviewSession(nameInput: string, ttlMs: number) {
    const database = this.requireDatabase();
    const now = this.now();
    const name = safeName(nameInput);
    if (!Number.isInteger(ttlMs) || ttlMs < 60_000 || ttlMs > 24 * 60 * 60 * 1_000) throw new Error("Preview session lifetime must be an integer from 1 minute to 24 hours.");
    const token = `${TOKEN_PREFIX}${this.entropy(32).toString("base64url")}`;
    const id = randomUUID();
    const createdAt = timestamp(now, "Preview session creation time");
    const expiresAt = timestamp(now + ttlMs, "Preview session expiration");
    database.prepare("INSERT INTO viewer_access_tokens (id, name, token_hash, created_at, expires_at, last_used_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL, NULL)").run(id, name, hash(token), createdAt, expiresAt);
    return { token, viewer: { id, name, createdAt, expiresAt, lastUsedAt: null, revokedAt: null } satisfies ViewerAccessMetadata };
  }

  verify(token: string) {
    const database = this.requireDatabase();
    if (!/^vtt_viewer_[A-Za-z0-9_-]{43}$/.test(token)) throw new ViewerAccessDeniedError("Viewer token is invalid.");
    const row = database.prepare("SELECT id, name, created_at, expires_at, last_used_at, revoked_at FROM viewer_access_tokens WHERE token_hash = ?").get(hash(token)) as ViewerAccessRow | undefined;
    const now = this.now();
    if (!row || row.revoked_at || (row.expires_at !== null && Date.parse(row.expires_at) <= now)) throw new ViewerAccessDeniedError("Viewer token is invalid, expired, or revoked.");
    const lastUsedAt = timestamp(now, "Viewer access time");
    database.prepare("UPDATE viewer_access_tokens SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL").run(lastUsedAt, row.id);
    return { ...metadata(row), lastUsedAt };
  }

  list() {
    const database = this.requireDatabase();
    return (database.prepare("SELECT id, name, created_at, expires_at, last_used_at, revoked_at FROM viewer_access_tokens ORDER BY created_at, id").all() as ViewerAccessRow[]).map(metadata);
  }

  revoke(idInput: string) {
    const database = this.requireDatabase();
    const id = safeId(idInput);
    const revokedAt = timestamp(this.now(), "Viewer revocation time");
    const result = database.prepare("UPDATE viewer_access_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?").run(revokedAt, id);
    if (result.changes !== 1) throw new Error("Viewer access entry was not found.");
    return this.list().find((item) => item.id === id)!;
  }

  close() {
    this.pairingCodes.clear();
    this.failedAttempts = [];
    this.database?.close();
    this.database = undefined;
  }

  private prunePairings(now: number) {
    for (const [codeHash, expiresAt] of this.pairingCodes) if (expiresAt <= now) this.pairingCodes.delete(codeHash);
  }

  private enforceAttemptLimit(now: number) {
    this.failedAttempts = this.failedAttempts.filter((attempt) => attempt > now - FAILED_ATTEMPT_WINDOW_MS);
    if (this.failedAttempts.length >= MAX_FAILED_ATTEMPTS) throw new ViewerPairingRateLimitError("Too many failed viewer pairing attempts. Try again shortly.");
  }

  private recordFailure(now: number) {
    this.failedAttempts.push(now);
  }

  private requireDatabase() {
    if (!this.database) throw new Error("ViewerAccessStore has not been initialized.");
    return this.database;
  }
}
