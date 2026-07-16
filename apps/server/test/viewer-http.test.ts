import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { ViewerAccessStore } from "../src/viewer-access.js";
import { ViewerCoordinator } from "../src/viewer-coordinator.js";
import { createViewerRouter } from "../src/viewer-http.js";
import { ViewerPresentationStore } from "../src/viewer-presentation-store.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-viewer-http-"));
  let now = 10_000;
  const databasePath = join(directory, "vtt.sqlite");
  const access = new ViewerAccessStore(databasePath, () => now);
  const presentation = new ViewerPresentationStore(databasePath);
  await access.initialize(); await presentation.initialize();
  const authorizeGm = (token: string | undefined) => token === "gm-secret";
  const coordinator = new ViewerCoordinator(access, presentation, authorizeGm, () => now);
  const app = express(); app.use(express.json()); app.use(createViewerRouter({ access, presentation, coordinator, authorizeGm, now: () => now }));
  const server = createServer(app); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  cleanups.push(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); access.close(); presentation.close(); await rm(directory, { recursive: true, force: true }); });
  return { base: `http://127.0.0.1:${address.port}`, access, presentation, coordinator, setNow: (value: number) => { now = value; } };
}

async function json(response: Response) { return response.json() as Promise<Record<string, any>>; }

describe("viewer HTTP vertical slice", () => {
  it("pairs with an HttpOnly cookie, converges, commands, and revokes immediately", async () => {
    const test = await fixture();
    const unauthorized = await fetch(`${test.base}/api/v1/viewer/pairings`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(unauthorized.status).toBe(401);
    expect((await json(unauthorized)).error).toMatchObject({ code: "unauthorized" });

    const pairingResponse = await fetch(`${test.base}/api/v1/viewer/pairings`, { method: "POST", headers: { authorization: "Bearer gm-secret", "content-type": "application/json", "x-request-id": "pair-1" }, body: "{}" });
    expect(pairingResponse.status).toBe(201);
    expect(pairingResponse.headers.get("x-request-id")).toBe("pair-1");
    const code = (await json(pairingResponse)).pairing.code as string;

    const exchange = await fetch(`${test.base}/api/v1/viewer/pairings/exchange`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: "Table TV" }) });
    const exchangeBody = await json(exchange);
    expect(exchange.status).toBe(201);
    expect(exchangeBody).not.toHaveProperty("token");
    expect(exchange.headers.get("set-cookie")).toContain("HttpOnly");
    expect(exchange.headers.get("set-cookie")).toContain("SameSite=Strict");
    const cookie = exchange.headers.get("set-cookie")!.split(";", 1)[0];

    for (const body of [
      { id: "enable", expectedRevision: 0, payload: { type: "viewer.enabled.set", enabled: true } },
      { id: "map", expectedRevision: 1, payload: { type: "viewer.map.set", assetId: "map-1", altText: "Dungeon", camera: { center: { x: 500, y: 300 }, zoom: 1 } } }
    ]) {
      const response = await fetch(`${test.base}/api/v1/viewer/presentation/commands`, { method: "POST", headers: { authorization: "Bearer gm-secret", "content-type": "application/json" }, body: JSON.stringify(body) });
      expect(response.status).toBe(200);
    }
    const snapshot = await fetch(`${test.base}/api/v1/viewer/presentation`, { headers: { cookie } });
    expect((await json(snapshot)).presentation).toMatchObject({ revision: 2, enabled: true, activeMap: { assetId: "map-1" } });

    const accessList = await fetch(`${test.base}/api/v1/viewer/access`, { headers: { authorization: "Bearer gm-secret" } });
    const viewerId = (await json(accessList)).viewers[0].id;
    const revoked = await fetch(`${test.base}/api/v1/viewer/access/${viewerId}`, { method: "DELETE", headers: { authorization: "Bearer gm-secret" } });
    expect(revoked.status).toBe(200);
    expect((await fetch(`${test.base}/api/v1/viewer/presentation`, { headers: { cookie } })).status).toBe(401);
  });

  it("pushes safe convergent projections and closes revoked live subscribers", async () => {
    const test = await fixture();
    const pairing = test.access.createPairingCode();
    const created = test.access.exchangePairingCode(pairing.code, "Projector");
    const received: unknown[] = [];
    let closed = false;
    test.coordinator.connectViewer(created.token, (state) => received.push(state), () => { closed = true; });
    await test.coordinator.executeGm("gm-secret", { id: "enable", expectedRevision: 0, payload: { type: "viewer.enabled.set", enabled: true } });
    expect(received).toHaveLength(2);
    expect(received[1]).not.toHaveProperty("acceptedCommandIds");
    test.access.revoke(created.viewer.id);
    test.coordinator.broadcast();
    expect(closed).toBe(true);
    expect(test.coordinator.activeViewers()).toEqual([]);
  });

  it("returns stable validation and revision-conflict envelopes without secrets", async () => {
    const test = await fixture();
    const malformed = await fetch(`${test.base}/api/v1/viewer/presentation/commands`, { method: "POST", headers: { authorization: "Bearer gm-secret", "content-type": "application/json", "x-request-id": "bad-1" }, body: JSON.stringify({ id: "bad", payload: { type: "viewer.camera.set", camera: { center: { x: 0, y: 0 }, zoom: "huge" } } }) });
    expect(malformed.status).toBe(400);
    expect(await json(malformed)).toEqual({ error: { code: "invalid_request", message: "Viewer request body is invalid.", requestId: "bad-1" } });

    await test.coordinator.executeGm("gm-secret", { id: "first", payload: { type: "viewer.enabled.set", enabled: true } });
    const conflict = await fetch(`${test.base}/api/v1/viewer/presentation/commands`, { method: "POST", headers: { authorization: "Bearer gm-secret", "content-type": "application/json" }, body: JSON.stringify({ id: "stale", expectedRevision: 0, payload: { type: "viewer.enabled.set", enabled: false } }) });
    const text = await conflict.text();
    expect(conflict.status).toBe(409);
    expect(text).not.toContain("gm-secret");
    expect(JSON.parse(text).error.code).toBe("revision_conflict");
  });
});
