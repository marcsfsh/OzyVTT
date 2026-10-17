import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { migrate, openDatabase, type Migration } from "./database.js";
import { InvalidRequestError } from "./invalid-request.js";

export const ViewerAccessMetadataSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().nullable(),
  lastUsedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable()
});
export type ViewerAccessMetadata = Readonly<z.infer<typeof ViewerAccessMetadataSchema>>;
/** A one-time code a table screen exchanges for its viewer credential. */
export const ViewerPairingSchema = z.strictObject({ code: z.string(), expiresAt: z.iso.datetime() });
export type ViewerPairing = Readonly<z.infer<typeof ViewerPairingSchema>>;
/** What a table screen shows while it waits for the GM: its short code and when the code runs out. */
export const ScreenPairingSchema = z.strictObject({ code: z.string(), expiresAt: z.iso.datetime() });
export type ScreenPairing = Readonly<z.infer<typeof ScreenPairingSchema>>;

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
/** A screen's code lasts this long; the screen asks for a fresh one when it runs out. */
const SCREEN_PAIRING_TTL_MS = 10 * 60 * 1_000;
/** Open screen requests at once. Few enough that a mistyped code almost never lands on another screen. */
const MAX_OPEN_SCREEN_PAIRINGS = 20;
/** Screen requests opened per minute, from every address together. */
const MAX_SCREEN_PAIRINGS_PER_MINUTE = 30;
const SCREEN_CODE_DIGITS = 6;
const REQUEST_PREFIX = "vtt_pairing_";

type ScreenRequest = { code: string; expiresAt: number; approvedName: string | null };

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    up: (database) =>
      database.exec(`
        CREATE TABLE viewer_access_tokens (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          expires_at TEXT,
          last_used_at TEXT,
          revoked_at TEXT
        ) STRICT;
      `)
  }
];

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeName(value: string) {
  const name = value.trim();
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name))
    throw new InvalidRequestError("Viewer name must contain 1 to 100 printable characters.");
  return name;
}

function safeId(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))
    throw new InvalidRequestError("Viewer access ID is malformed.");
  return value;
}

function timestamp(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0)
    throw new InvalidRequestError(`${label} must be a non-negative finite number.`);
  return new Date(value).toISOString();
}

function metadata(row: ViewerAccessRow): ViewerAccessMetadata {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at
  };
}

/** The screen code as typed: any spaces or dashes between the digits are ignored. */
function normalizeScreenCode(value: string) {
  const code = value.replace(/[\s-]/g, "");
  if (!new RegExp(`^[0-9]{${SCREEN_CODE_DIGITS}}$`).test(code))
    throw new ViewerAccessDeniedError("That code is not open on any screen. Check the code the screen shows.");
  return code;
}

function normalizePairingCode(value: string) {
  const code = value.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(code)) throw new ViewerAccessDeniedError("Viewer pairing code is invalid or expired.");
  return code;
}

export class ViewerAccessStore {
  private database?: DatabaseSync;
  private readonly pairingCodes = new Map<string, number>();
  /** Open screen requests by the hash of the secret the screen holds in its cookie. */
  private readonly screenRequests = new Map<string, ScreenRequest>();
  private screenOpenings: number[] = [];
  private failedAttempts: number[] = [];

  constructor(
    private readonly databasePath: string,
    private readonly now: () => number = Date.now,
    private readonly entropy: (size: number) => Buffer = randomBytes
  ) {}

  async initialize() {
    if (this.database) return;
    const database = openDatabase(this.databasePath);
    try {
      migrate(database, "viewer-access", MIGRATIONS, { path: this.databasePath });
    } catch (error) {
      database.close();
      throw error;
    }
    this.database = database;
  }

  createPairingCode(ttlMs = PAIRING_TTL_MS): ViewerPairing {
    this.requireDatabase();
    const now = this.now();
    this.prunePairings(now);
    if (!Number.isInteger(ttlMs) || ttlMs < 30_000 || ttlMs > PAIRING_TTL_MS)
      throw new InvalidRequestError(
        `Pairing lifetime must be an integer from 30000 to ${PAIRING_TTL_MS} milliseconds.`
      );
    if (this.pairingCodes.size >= MAX_OUTSTANDING_PAIRINGS)
      throw new InvalidRequestError("Too many viewer pairing codes are active. Wait for one to expire.");
    const code = this.entropy(6).toString("hex").toUpperCase();
    this.pairingCodes.set(hash(code), now + ttlMs);
    return {
      code: `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`,
      expiresAt: timestamp(now + ttlMs, "Pairing expiration")
    };
  }

  /**
   * A table screen asks to pair (ADR-0028). It gets a short code to show and a secret to keep in its cookie; the code
   * only names the request for the GM, and only the secret collects the viewer credential once the GM approves.
   */
  openScreenPairing(): ScreenPairing & Readonly<{ requestToken: string }> {
    this.requireDatabase();
    const now = this.now();
    this.pruneScreenRequests(now);
    this.screenOpenings = this.screenOpenings.filter((at) => at > now - FAILED_ATTEMPT_WINDOW_MS);
    if (
      this.screenRequests.size >= MAX_OPEN_SCREEN_PAIRINGS ||
      this.screenOpenings.length >= MAX_SCREEN_PAIRINGS_PER_MINUTE
    )
      throw new ViewerPairingRateLimitError("Too many screens are asking to pair. Try again in a minute.");
    const open = new Set([...this.screenRequests.values()].map((request) => request.code));
    let code: string;
    do code = String(randomInt(0, 10 ** SCREEN_CODE_DIGITS)).padStart(SCREEN_CODE_DIGITS, "0");
    while (open.has(code));
    const requestToken = `${REQUEST_PREFIX}${this.entropy(32).toString("base64url")}`;
    const expiresAt = now + SCREEN_PAIRING_TTL_MS;
    this.screenRequests.set(hash(requestToken), { code, expiresAt, approvedName: null });
    this.screenOpenings.push(now);
    return { requestToken, code, expiresAt: timestamp(expiresAt, "Pairing expiration") };
  }

  /**
   * Where a screen's request stands. Null when the secret names no open request. Once the GM has approved, this
   * mints the viewer credential and closes the request, so the secret works once.
   */
  collectScreenPairing(requestToken: string) {
    const now = this.now();
    this.pruneScreenRequests(now);
    const key = /^vtt_pairing_[A-Za-z0-9_-]{43}$/.test(requestToken) ? hash(requestToken) : null;
    const request = key ? this.screenRequests.get(key) : undefined;
    if (!key || !request) return null;
    if (request.approvedName === null)
      return { status: "waiting" as const, code: request.code, expiresAt: timestamp(request.expiresAt, "Expiry") };
    this.screenRequests.delete(key);
    return { status: "paired" as const, ...this.issueViewer(request.approvedName, null) };
  }

  /** The GM lets in the screen showing `codeInput`. Wrong codes count toward the same limit as wrong pairing codes. */
  approveScreenPairing(codeInput: string, nameInput: string) {
    const now = this.now();
    this.enforceAttemptLimit(now);
    this.pruneScreenRequests(now);
    const name = safeName(nameInput);
    let code: string;
    try {
      code = normalizeScreenCode(codeInput);
    } catch (error) {
      this.recordFailure(now);
      throw error;
    }
    const request = [...this.screenRequests.values()].find((candidate) => candidate.code === code);
    if (!request || request.approvedName !== null) {
      this.recordFailure(now);
      throw new ViewerAccessDeniedError("That code is not open on any screen. Check the code the screen shows.");
    }
    request.approvedName = name;
    return { name };
  }

  exchangePairingCode(codeInput: string, nameInput: string, options: Readonly<{ expiresAt?: number | null }> = {}) {
    this.requireDatabase();
    const now = this.now();
    this.enforceAttemptLimit(now);
    let code: string;
    try {
      code = normalizePairingCode(codeInput);
    } catch (error) {
      this.recordFailure(now);
      throw error;
    }
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
    if (expiresAtMs !== null && (!Number.isFinite(expiresAtMs) || expiresAtMs <= now))
      throw new InvalidRequestError("Viewer access expiration must be in the future.");
    return this.issueViewer(name, expiresAtMs);
  }

  /** Mints a viewer credential: both ways of pairing end here, so a screen paired either way holds the same thing. */
  private issueViewer(name: string, expiresAtMs: number | null) {
    const database = this.requireDatabase();
    const now = this.now();
    const token = `${TOKEN_PREFIX}${this.entropy(32).toString("base64url")}`;
    const id = randomUUID();
    const createdAt = timestamp(now, "Viewer creation time");
    const expiresAt = expiresAtMs === null ? null : timestamp(expiresAtMs, "Viewer expiration");
    database
      .prepare(
        "INSERT INTO viewer_access_tokens (id, name, token_hash, created_at, expires_at, last_used_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL, NULL)"
      )
      .run(id, name, hash(token), createdAt, expiresAt);
    return {
      token,
      viewer: { id, name, createdAt, expiresAt, lastUsedAt: null, revokedAt: null } satisfies ViewerAccessMetadata
    };
  }

  /** Mints a viewer session without a pairing code for the GM's own read-only preview; reached only from
   *  a GM-authed route. Reuses the newest live preview session named `name` so sessions don't accumulate. */
  mintPreviewSession(nameInput: string, ttlMs: number) {
    const database = this.requireDatabase();
    const now = this.now();
    const name = safeName(nameInput);
    if (!Number.isInteger(ttlMs) || ttlMs < 60_000 || ttlMs > 24 * 60 * 60 * 1_000)
      throw new InvalidRequestError("Preview session lifetime must be an integer from 1 minute to 24 hours.");
    const token = `${TOKEN_PREFIX}${this.entropy(32).toString("base64url")}`;
    const id = randomUUID();
    const createdAt = timestamp(now, "Preview session creation time");
    const expiresAt = timestamp(now + ttlMs, "Preview session expiration");
    database
      .prepare(
        "INSERT INTO viewer_access_tokens (id, name, token_hash, created_at, expires_at, last_used_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL, NULL)"
      )
      .run(id, name, hash(token), createdAt, expiresAt);
    return {
      token,
      viewer: { id, name, createdAt, expiresAt, lastUsedAt: null, revokedAt: null } satisfies ViewerAccessMetadata
    };
  }

  verify(token: string) {
    const database = this.requireDatabase();
    if (!/^vtt_viewer_[A-Za-z0-9_-]{43}$/.test(token)) throw new ViewerAccessDeniedError("Viewer token is invalid.");
    const row = database
      .prepare(
        "SELECT id, name, created_at, expires_at, last_used_at, revoked_at FROM viewer_access_tokens WHERE token_hash = ?"
      )
      .get(hash(token)) as ViewerAccessRow | undefined;
    const now = this.now();
    if (!row || row.revoked_at || (row.expires_at !== null && Date.parse(row.expires_at) <= now))
      throw new ViewerAccessDeniedError("Viewer token is invalid, expired, or revoked.");
    const lastUsedAt = timestamp(now, "Viewer access time");
    database
      .prepare("UPDATE viewer_access_tokens SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(lastUsedAt, row.id);
    return { ...metadata(row), lastUsedAt };
  }

  list() {
    const database = this.requireDatabase();
    return (
      database
        .prepare(
          "SELECT id, name, created_at, expires_at, last_used_at, revoked_at FROM viewer_access_tokens ORDER BY created_at, id"
        )
        .all() as ViewerAccessRow[]
    ).map(metadata);
  }

  revoke(idInput: string) {
    const database = this.requireDatabase();
    const id = safeId(idInput);
    const revokedAt = timestamp(this.now(), "Viewer revocation time");
    const result = database
      .prepare("UPDATE viewer_access_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?")
      .run(revokedAt, id);
    if (result.changes !== 1) throw new InvalidRequestError("Viewer access entry was not found.");
    return this.list().find((item) => item.id === id)!;
  }

  close() {
    this.pairingCodes.clear();
    this.screenRequests.clear();
    this.failedAttempts = [];
    this.database?.close();
    this.database = undefined;
  }

  private pruneScreenRequests(now: number) {
    for (const [key, request] of this.screenRequests) if (request.expiresAt <= now) this.screenRequests.delete(key);
  }

  private prunePairings(now: number) {
    for (const [codeHash, expiresAt] of this.pairingCodes) if (expiresAt <= now) this.pairingCodes.delete(codeHash);
  }

  private enforceAttemptLimit(now: number) {
    this.failedAttempts = this.failedAttempts.filter((attempt) => attempt > now - FAILED_ATTEMPT_WINDOW_MS);
    if (this.failedAttempts.length >= MAX_FAILED_ATTEMPTS)
      throw new ViewerPairingRateLimitError("Too many failed viewer pairing attempts. Try again shortly.");
  }

  private recordFailure(now: number) {
    this.failedAttempts.push(now);
  }

  private requireDatabase() {
    if (!this.database) throw new Error("ViewerAccessStore has not been initialized.");
    return this.database;
  }
}
