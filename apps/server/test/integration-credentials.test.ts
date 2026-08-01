import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { IntegrationCredentialStore } from "../src/integration-credentials.js";

async function withStore(run: (store: IntegrationCredentialStore, databasePath: string, setNow: (value: number) => void) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "vtt-integration-credentials-"));
  const databasePath = join(directory, "credentials.sqlite");
  let currentTime = Date.parse("2026-07-16T00:00:00.000Z");
  const store = new IntegrationCredentialStore(databasePath, () => currentTime);
  try { await store.initialize(); await run(store, databasePath, (value) => { currentTime = value; }); }
  finally { store.close(); await rm(directory, { recursive: true, force: true }); }
}

describe("IntegrationCredentialStore", () => {
  it("shows a high-entropy secret once and persists only its hash plus safe metadata", async () => withStore(async (store, databasePath) => {
    const issued = store.create({ name: "Stream overlay", scopes: ["system:read", "game:read", "system:read"], gameId: null });
    expect(issued.token).toMatch(/^vtt_int_[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    expect(issued.metadata.scopes).toEqual(["system:read", "game:read"]);
    expect(store.list()).toEqual([issued.metadata]);
    expect(JSON.stringify(store.list())).not.toContain(issued.token);

    const database = new DatabaseSync(databasePath, { readOnly: true });
    const row = database.prepare("SELECT secret_hash FROM integration_credentials WHERE id = ?").get(issued.metadata.id) as { secret_hash: string };
    expect(row.secret_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.secret_hash).not.toContain(issued.token.split(".")[1]);
    expect((database.prepare("PRAGMA table_info(integration_credentials)").all() as Array<{ name: string }>).map(({ name }) => name)).not.toContain("token");
    database.close();
    expect((await readFile(databasePath)).includes(Buffer.from(issued.token))).toBe(false);
  }));

  /**
   * The codex scopes are a plain addition to the enum, so the store needs no change at all - which is
   * exactly the claim worth pinning, because "no change needed" is how a scope ends up mintable but
   * unverifiable. Independence is the second claim: `codex:write` must not open a read.
   */
  it("mints and verifies the codex scopes, and keeps read and write independent", async () => withStore(async (store) => {
    const issued = store.create({ name: "Worldbuilding bot", scopes: ["codex:read", "codex:write"], gameId: null });
    expect(issued.metadata.scopes).toEqual(["codex:read", "codex:write"]);
    expect(store.verify(issued.token, "codex:read")?.name).toBe("Worldbuilding bot");
    expect(store.verify(issued.token, "codex:write")?.name).toBe("Worldbuilding bot");

    const readOnly = store.create({ name: "Wiki mirror", scopes: ["codex:read"], gameId: null });
    expect(store.verify(readOnly.token, "codex:read")).not.toBeNull();
    expect(store.verify(readOnly.token, "codex:write")).toBeNull();
    // ...and a codex credential is not a game credential, however convenient that would be.
    expect(store.verify(readOnly.token, "game:read")).toBeNull();
    // `admin` still implies everything, including the new pair.
    const admin = store.create({ name: "Admin tool", scopes: ["admin"], gameId: null });
    expect(store.verify(admin.token, "codex:write")).not.toBeNull();
  }));

  it("enforces scopes and game binding and records safe use/failure audit events", async () => withStore(async (store) => {
    const gameId = "60a6e172-9ff5-44a3-8a8b-93f836f0d16b";
    const issued = store.create({ name: "Combat bot", scopes: ["combat:read"], gameId });
    expect(store.verify(issued.token, "combat:read", gameId)?.id).toBe(issued.metadata.id);
    expect(store.verify(issued.token, "combat:write", gameId)).toBeNull();
    expect(store.verify(issued.token, "combat:read", "60a6e172-9ff5-44a3-8a8b-93f836f0d16c")).toBeNull();
    expect(store.auditEvents(issued.metadata.id).map(({ type }) => type)).toEqual(["created", "used", "verification_failed", "verification_failed"]);
    expect(JSON.stringify(store.auditEvents(issued.metadata.id))).not.toContain(issued.token);
  }));

  it("supports admin scope, expiry, revocation, rotation, and restart-safe verification", async () => withStore(async (store, databasePath, setNow) => {
    const initialTime = Date.parse("2026-07-16T00:00:00.000Z");
    const expiresAt = "2026-07-16T01:00:00.000Z";
    const issued = store.create({ name: "Admin tool", scopes: ["admin"], gameId: null, expiresAt });
    expect(store.verify(issued.token, "scene:write")?.lastUsedAt).toBe("2026-07-16T00:00:00.000Z");

    const rotated = store.rotate(issued.metadata.id, "2026-07-16T02:00:00.000Z")!;
    expect(rotated.token).not.toBe(issued.token);
    expect(store.verify(issued.token, "system:read")).toBeNull();
    expect(store.verify(rotated.token, "system:read")?.id).toBe(issued.metadata.id);

    store.close();
    const reopened = new IntegrationCredentialStore(databasePath, () => initialTime);
    await reopened.initialize();
    expect(reopened.verify(rotated.token, "actor:read")?.id).toBe(issued.metadata.id);
    expect(reopened.revoke(issued.metadata.id)).toBe(true);
    expect(reopened.revoke(issued.metadata.id)).toBe(false);
    expect(reopened.verify(rotated.token, "actor:read")).toBeNull();
    reopened.close();

    const expiring = new IntegrationCredentialStore(databasePath, () => Date.parse("2026-07-16T03:00:00.000Z"));
    await expiring.initialize();
    const short = expiring.create({ name: "Short lived", scopes: ["system:read"], expiresAt: "2026-07-16T04:00:00.000Z" });
    expiring.close();
    setNow(initialTime);
    const expired = new IntegrationCredentialStore(databasePath, () => Date.parse("2026-07-16T05:00:00.000Z"));
    await expired.initialize();
    expect(expired.verify(short.token, "system:read")).toBeNull();
    expired.close();
  }));

  it("rejects invalid creation and malformed tokens without writing partial credentials", async () => withStore(async (store) => {
    expect(() => store.create({ name: "", scopes: ["system:read"] })).toThrow();
    expect(() => store.create({ name: "Expired", scopes: ["system:read"], expiresAt: "2020-01-01T00:00:00.000Z" })).toThrow("future");
    expect(store.verify("not-a-token", "system:read")).toBeNull();
    expect(store.list()).toEqual([]);
  }));
});
