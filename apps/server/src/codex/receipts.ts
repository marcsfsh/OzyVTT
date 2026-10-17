import { stamp, type CodexDb } from "./db.js";
import { isId } from "./validate.js";

/** `commandId` idempotency receipts (`codex_command_receipts`), kept for seven days. */

const RECEIPT_DAYS = 7;

export type CodexCommandReceipt = Readonly<{ status: number; body: unknown; fingerprint: string }>;

/** The stored outcome of a `commandId`, or null. */
export function recallCommand(db: CodexDb, commandId: string): CodexCommandReceipt | null {
  if (!isId(commandId)) return null;
  const row = db.database
    .prepare("SELECT status, body_json, fingerprint FROM codex_command_receipts WHERE command_id = ?")
    .get(commandId) as { status: number; body_json: string; fingerprint: string } | undefined;
  if (!row) return null;
  try {
    return { status: row.status, body: JSON.parse(row.body_json) as unknown, fingerprint: row.fingerprint };
  } catch {
    return null;
  }
}

/**
 * Stores a response against its `commandId` and prunes expired receipts. Outside any `write`: a receipt is
 * bookkeeping about a response, and bumping the revision again would invalidate every GM ETag a second time.
 */
export function recordCommand(
  db: CodexDb,
  commandId: string,
  status: number,
  responseBody: unknown,
  fingerprint: string
): void {
  if (!isId(commandId)) return;
  db.database
    .prepare(
      "INSERT OR REPLACE INTO codex_command_receipts (command_id, fingerprint, status, body_json, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(commandId, fingerprint, status, JSON.stringify(responseBody ?? null), stamp(db));
  const cutoff = new Date(db.now() - RECEIPT_DAYS * 86_400_000).toISOString();
  db.database.prepare("DELETE FROM codex_command_receipts WHERE created_at <= ?").run(cutoff);
}
