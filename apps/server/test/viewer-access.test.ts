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
    const now = Date.parse("2026-07-16T12:00:00.000Z");
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
      expect(store.verify(created.token)).toMatchObject({
        id: created.viewer.id,
        name: "Projector",
        lastUsedAt: new Date(now).toISOString()
      });
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
      for (let attempt = 0; attempt < 19; attempt++)
        expect(() => store.exchangePairingCode("FFFF-FFFF-FFFF", "Guess")).toThrow(ViewerAccessDeniedError);
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

describe("pairing from the screen's own code", () => {
  async function store(now: () => number) {
    const directory = await mkdtemp(join(tmpdir(), "vtt-screen-pairing-"));
    const access = new ViewerAccessStore(join(directory, "vtt.sqlite"), now);
    await access.initialize();
    return {
      access,
      close: async () => {
        access.close();
        await rm(directory, { recursive: true, force: true });
      }
    };
  }

  it("pairs a screen once the GM types its code, and only once", async () => {
    const now = 1_000_000;
    const { access, close } = await store(() => now);
    try {
      const opened = access.openScreenPairing();
      expect(opened.code).toMatch(/^[0-9]{6}$/);
      expect(opened.requestToken).toMatch(/^vtt_pairing_/);
      expect(access.collectScreenPairing(opened.requestToken)).toMatchObject({ status: "waiting", code: opened.code });
      // The code alone collects nothing: a stranger who reads it off the screen holds no request.
      expect(access.collectScreenPairing(`vtt_pairing_${"A".repeat(43)}`)).toBeNull();

      // Typed with a space, as the screen shows it.
      expect(access.approveScreenPairing(`${opened.code.slice(0, 3)} ${opened.code.slice(3)}`, "Den TV")).toEqual({
        name: "Den TV"
      });
      const paired = access.collectScreenPairing(opened.requestToken);
      expect(paired).toMatchObject({ status: "paired", viewer: { name: "Den TV", expiresAt: null } });
      // The same viewer credential the GM's code gives.
      const token = (paired as { token: string }).token;
      expect(access.verify(token).name).toBe("Den TV");
      expect(access.collectScreenPairing(opened.requestToken)).toBeNull();
      expect(() => access.approveScreenPairing(opened.code, "Again")).toThrow(ViewerAccessDeniedError);
    } finally {
      await close();
    }
  });

  it("lets a code run out after ten minutes and keeps every open code unique", async () => {
    let now = 1_000_000;
    const { access, close } = await store(() => now);
    try {
      const codes = new Set(Array.from({ length: 20 }, () => access.openScreenPairing().code));
      expect(codes.size).toBe(20);
      const late = [...codes][0];
      now += 10 * 60 * 1_000;
      expect(() => access.approveScreenPairing(late, "Late TV")).toThrow(ViewerAccessDeniedError);
    } finally {
      await close();
    }
  });

  it("caps open requests and wrong codes", async () => {
    let now = 1_000_000;
    const { access, close } = await store(() => now);
    try {
      for (let index = 0; index < 20; index++) access.openScreenPairing();
      expect(() => access.openScreenPairing()).toThrow(ViewerPairingRateLimitError);
      now += 10 * 60 * 1_000;
      // The expired ones make room, but no more than 30 a minute open.
      for (let index = 0; index < 10; index++) access.openScreenPairing();
      now += 60_001;
      for (let attempt = 0; attempt < 20; attempt++)
        expect(() => access.approveScreenPairing("000000", "Guess")).toThrow();
      expect(() => access.approveScreenPairing("000000", "Guess")).toThrow(ViewerPairingRateLimitError);
    } finally {
      await close();
    }
  });
});
