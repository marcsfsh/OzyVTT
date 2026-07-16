import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { IntegrationCredentialMetadataSchema, IntegrationScopeSchema, type IntegrationCredentialMetadata, type IntegrationScope } from "@vtt/api-contract";
import { z } from "zod";

const TOKEN_PREFIX = "vtt_int_";
const CreateCredentialSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(IntegrationScopeSchema).min(1).transform((scopes) => [...new Set(scopes)]),
  gameId: z.string().uuid().nullable().default(null),
  expiresAt: z.string().datetime({ offset: true }).nullable().default(null)
}).strict();

type CredentialRow = {
  id: string;
  name: string;
  secret_hash: string;
  scopes_json: string;
  game_id: string | null;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
};

export type CredentialAuditEvent = {
  id: number;
  credentialId: string;
  type: "created" | "used" | "verification_failed" | "rotated" | "revoked";
  occurredAt: string;
  detail: Record<string, unknown>;
};

export type IssuedIntegrationCredential = { metadata: IntegrationCredentialMetadata; token: string };

function hashSecret(secret: string) { return createHash("sha256").update(secret, "utf8").digest(); }

function parseToken(token: string) {
  const match = token.match(/^vtt_int_([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i);
  return match ? { id: match[1].toLowerCase(), secret: match[2] } : null;
}

function metadata(row: CredentialRow): IntegrationCredentialMetadata {
  return IntegrationCredentialMetadataSchema.parse({
    id: row.id,
    name: row.name,
    scopes: JSON.parse(row.scopes_json),
    gameId: row.game_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at
  });
}

export class IntegrationCredentialStore {
  private database?: DatabaseSync;

  constructor(private readonly databasePath: string, private readonly now: () => number = Date.now) {}

  async initialize() {
    await mkdir(dirname(this.databasePath), { recursive: true });
    this.database = new DatabaseSync(this.databasePath, { enableForeignKeyConstraints: true });
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS integration_credentials (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        secret_hash TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        game_id TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        last_used_at TEXT,
        revoked_at TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS integration_credential_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        credential_id TEXT NOT NULL REFERENCES integration_credentials(id),
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        detail_json TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS integration_credential_audit_credential_id ON integration_credential_audit(credential_id, id);
    `);
  }

  create(input: z.input<typeof CreateCredentialSchema>): IssuedIntegrationCredential {
    const parsed = CreateCredentialSchema.parse(input);
    const now = this.timestamp();
    if (parsed.expiresAt && Date.parse(parsed.expiresAt) <= this.now()) throw new Error("Credential expiration must be in the future.");
    const id = randomUUID();
    const secret = randomBytes(32).toString("base64url");
    const database = this.requireDatabase();
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare("INSERT INTO integration_credentials (id, name, secret_hash, scopes_json, game_id, created_at, expires_at, last_used_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)").run(id, parsed.name, hashSecret(secret).toString("hex"), JSON.stringify(parsed.scopes), parsed.gameId, now, parsed.expiresAt);
      this.audit(id, "created", now, { scopes: parsed.scopes, gameBound: parsed.gameId !== null, expires: parsed.expiresAt !== null });
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
    return { metadata: this.get(id)!, token: `${TOKEN_PREFIX}${id}.${secret}` };
  }

  get(id: string) {
    const row = this.requireDatabase().prepare("SELECT * FROM integration_credentials WHERE id = ?").get(id) as CredentialRow | undefined;
    return row ? metadata(row) : null;
  }

  list() {
    return (this.requireDatabase().prepare("SELECT * FROM integration_credentials ORDER BY created_at, id").all() as CredentialRow[]).map(metadata);
  }

  verify(token: string, requiredScope: IntegrationScope, gameId?: string) {
    const parsed = parseToken(token);
    if (!parsed) return null;
    const database = this.requireDatabase();
    const row = database.prepare("SELECT * FROM integration_credentials WHERE id = ?").get(parsed.id) as CredentialRow | undefined;
    if (!row) return null;
    const now = this.timestamp();
    const suppliedHash = hashSecret(parsed.secret);
    const storedHash = Buffer.from(row.secret_hash, "hex");
    if (storedHash.length !== suppliedHash.length || !timingSafeEqual(storedHash, suppliedHash)) return this.failed(row.id, now, "secret");
    if (row.revoked_at) return this.failed(row.id, now, "revoked");
    if (row.expires_at && Date.parse(row.expires_at) <= this.now()) return this.failed(row.id, now, "expired");
    const scopes = IntegrationScopeSchema.array().parse(JSON.parse(row.scopes_json));
    if (!scopes.includes(requiredScope) && !scopes.includes("admin")) return this.failed(row.id, now, "scope", { requiredScope });
    if (row.game_id && row.game_id !== gameId) return this.failed(row.id, now, "game", { gameBound: true });
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare("UPDATE integration_credentials SET last_used_at = ? WHERE id = ?").run(now, row.id);
      this.audit(row.id, "used", now, { requiredScope, gameBound: row.game_id !== null });
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
    return this.get(row.id);
  }

  revoke(id: string) {
    const current = this.get(id);
    if (!current || current.revokedAt) return false;
    const now = this.timestamp();
    const database = this.requireDatabase();
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare("UPDATE integration_credentials SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(now, id);
      this.audit(id, "revoked", now, {});
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
    return true;
  }

  rotate(id: string, expiresAt?: string | null): IssuedIntegrationCredential | null {
    const row = this.requireDatabase().prepare("SELECT * FROM integration_credentials WHERE id = ?").get(id) as CredentialRow | undefined;
    if (!row || row.revoked_at) return null;
    const resolvedExpiration = expiresAt === undefined ? row.expires_at : expiresAt;
    if (resolvedExpiration && Date.parse(resolvedExpiration) <= this.now()) throw new Error("Credential expiration must be in the future.");
    const secret = randomBytes(32).toString("base64url");
    const now = this.timestamp();
    const database = this.requireDatabase();
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare("UPDATE integration_credentials SET secret_hash = ?, expires_at = ?, last_used_at = NULL WHERE id = ?").run(hashSecret(secret).toString("hex"), resolvedExpiration, id);
      this.audit(id, "rotated", now, { expires: resolvedExpiration !== null });
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
    return { metadata: this.get(id)!, token: `${TOKEN_PREFIX}${id}.${secret}` };
  }

  auditEvents(credentialId: string): CredentialAuditEvent[] {
    return (this.requireDatabase().prepare("SELECT id, credential_id, event_type, occurred_at, detail_json FROM integration_credential_audit WHERE credential_id = ? ORDER BY id").all(credentialId) as Array<{ id: number; credential_id: string; event_type: CredentialAuditEvent["type"]; occurred_at: string; detail_json: string }>).map((row) => ({ id: row.id, credentialId: row.credential_id, type: row.event_type, occurredAt: row.occurred_at, detail: JSON.parse(row.detail_json) }));
  }

  close() { this.database?.close(); this.database = undefined; }

  private failed(id: string, occurredAt: string, reason: string, detail: Record<string, unknown> = {}) {
    this.audit(id, "verification_failed", occurredAt, { reason, ...detail });
    return null;
  }

  private audit(credentialId: string, type: CredentialAuditEvent["type"], occurredAt: string, detail: Record<string, unknown>) {
    this.requireDatabase().prepare("INSERT INTO integration_credential_audit (credential_id, event_type, occurred_at, detail_json) VALUES (?, ?, ?, ?)").run(credentialId, type, occurredAt, JSON.stringify(detail));
  }

  private timestamp() { return new Date(this.now()).toISOString(); }
  private requireDatabase() { if (!this.database) throw new Error("IntegrationCredentialStore has not been initialized."); return this.database; }
}
