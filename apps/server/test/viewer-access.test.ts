import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { ViewerAccessDeniedError, ViewerAccessStore, ViewerPairingRateLimitError } from "../src/viewer-access.js";

function deterministicEntropy() {
  let value = 0;
  return (size: number) => Buffer.alloc(size, ++value);
}

describe("ViewerAccessStore", () => {
  it("exchanges a short-lived code once and persists only a durable token hash", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-viewer-access-"));
    const databasePath = join(directory, "vtt.sqlite");
    let now = Date.parse("2026-07-16T12:00:00.000Z");
    const store = new ViewerAccessStore(databasePath, () => now, deterministicEntropy());
    try {
      await store.initialize();
      const pairing = store.createPairingCode();
      expect(pairing.code).toBe("0101-0101-0101");
      const created = store.exchangePairingCode(pairing.code.toLowerCase(), "Living room TV");
      expect(created.token).toMatch(/^vtt_viewer_/);
      expect(created.viewer).not.toHaveProperty("tokenHash");
      expect(() => store.exchangePairingCode(pairing.code, "Replay")).toThrow(ViewerAccessDeniedError);

      const database = new DatabaseSync(databasePath, { readOnly: true });
      const row = database.prepare("SELECT * FROM viewer_access_tokens").get() as Record<string, unknown>;
      expect(JSON.stringify(row)).not.toContain(created.token);
      expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
      database.close();
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("remembers viewers across restart and denies expiration or revocation immediately", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-viewer-restart-"));
    const databasePath = join(directory, "vtt.sqlite");
    let now = 10_000;
    const entropy = deterministicEntropy();
    let store = new ViewerAccessStore(databasePath, () => now, entropy);
    try {
      await store.initialize();
      const pairing = store.createPairingCode();
      const created = store.exchangePairingCode(pairing.code, "Projector", { expiresAt: 20_000 });
      expect(store.verify(created.token)).toMatchObject({ id: created.viewer.id, name: "Projector", lastUsedAt: new Date(now).toISOString() });
      store.close();

      store = new ViewerAccessStore(databasePath, () => now, entropy);
      await store.initialize();
      expect(store.verify(created.token).id).toBe(created.viewer.id);
      store.revoke(created.viewer.id);
      expect(() => store.verify(created.token)).toThrow(ViewerAccessDeniedError);

      const secondPairing = store.createPairingCode();
      const expiring = store.exchangePairingCode(secondPairing.code, "Temporary display", { expiresAt: 20_000 });
      now = 20_000;
      expect(() => store.verify(expiring.token)).toThrow(ViewerAccessDeniedError);
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("expires unused codes and rate-limits repeated guesses", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-viewer-rate-limit-"));
    let now = 100_000;
    const store = new ViewerAccessStore(join(directory, "vtt.sqlite"), () => now, deterministicEntropy());
    try {
      await store.initialize();
      const pairing = store.createPairingCode(30_000);
      now += 30_000;
      expect(() => store.exchangePairingCode(pairing.code, "Late TV")).toThrow(ViewerAccessDeniedError);
      for (let attempt = 0; attempt < 19; attempt++) expect(() => store.exchangePairingCode("FFFF-FFFF-FFFF", "Guess")).toThrow(ViewerAccessDeniedError);
      expect(() => store.exchangePairingCode("FFFF-FFFF-FFFF", "Guess")).toThrow(ViewerPairingRateLimitError);
      now += 60_001;
      expect(() => store.exchangePairingCode("FFFF-FFFF-FFFF", "Guess")).toThrow(ViewerAccessDeniedError);
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("returns safe metadata and validates malformed input", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-viewer-safe-"));
    const store = new ViewerAccessStore(join(directory, "vtt.sqlite"), () => 1_000, deterministicEntropy());
    try {
      await store.initialize();
      expect(() => store.exchangePairingCode("not-a-code", "TV")).toThrow(ViewerAccessDeniedError);
      expect(() => store.verify("not-a-token")).toThrow(ViewerAccessDeniedError);
      const pairing = store.createPairingCode();
      expect(() => store.exchangePairingCode(pairing.code, " ")).toThrow("Viewer name");
      expect(store.list()).toEqual([]);
      expect(() => store.revoke("../../secret")).toThrow("malformed");
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
