import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { MapAssetStore } from "../src/map-assets.js";
import { MapCatalogStore } from "../src/map-catalog.js";
import { createMapRouter } from "../src/map-http.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

function png(width: number, height: number) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(13, 8); buffer.write("IHDR", 12, "ascii"); buffer.writeUInt32BE(width, 16); buffer.writeUInt32BE(height, 20);
  return buffer;
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-map-http-"));
  const assets = new MapAssetStore(join(directory, "map-assets"));
  const catalog = new MapCatalogStore(join(directory, "vtt.sqlite"), () => Date.parse("2026-07-16T03:00:00.000Z"));
  await assets.initialize(); await catalog.initialize();
  const app = express(); app.use(express.json()); app.use(createMapRouter({
    assets, catalog,
    authorizeGm: (token) => token === "gm-token",
    authorizePlayer: (token) => token === "player-token",
    authorizeViewer: (token) => token === "viewer-token",
    now: () => Date.parse("2026-07-16T03:00:00.000Z")
  }));
  const server = createServer(app); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Map test server did not bind.");
  cleanups.push(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); catalog.close(); await rm(directory, { recursive: true, force: true }); });
  return { base: `http://127.0.0.1:${address.port}`, input: png(500, 400) };
}

function gm(contentType = "application/json") { return { authorization: "Bearer gm-token", "content-type": contentType }; }
async function body(response: Response) { return response.json() as Promise<Record<string, any>>; }

describe("map asset HTTP workflow", () => {
  it("uploads, deduplicates, lists safe metadata, and serves authenticated ranges", async () => {
    const test = await fixture();
    const path = `${test.base}/api/v1/map-assets?filename=keep.fake.jpg&name=Ruined%20Keep&kind=battlemap`;
    expect((await fetch(path, { method: "POST", headers: { "content-type": "image/png" }, body: test.input })).status).toBe(401);
    const uploaded = await fetch(path, { method: "POST", headers: gm("image/png"), body: test.input });
    expect(uploaded.status).toBe(201);
    const uploadBody = await body(uploaded);
    expect(uploadBody.data.asset).toMatchObject({ name: "Ruined Keep", kind: "battlemap", format: "png", width: 500, height: 400 });
    expect(JSON.stringify(uploadBody)).not.toMatch(/checksum|\/tmp|map-assets\/originals/i);
    const id = uploadBody.data.asset.id;

    const duplicate = await fetch(path, { method: "POST", headers: gm("image/png"), body: test.input });
    expect(duplicate.status).toBe(200);
    expect((await body(duplicate)).data.duplicate).toBe(true);
    const list = await body(await fetch(`${test.base}/api/v1/map-assets`, { headers: gm() }));
    expect(list.data.assets).toHaveLength(1);

    const contentPath = `${test.base}/api/v1/map-assets/${id}/content`;
    expect((await fetch(contentPath)).status).toBe(403);
    const whole = await fetch(contentPath, { headers: { authorization: "Bearer player-token" } });
    expect(Buffer.from(await whole.arrayBuffer())).toEqual(test.input);
    expect(whole.headers.get("cache-control")).toBe("private, no-store");
    const range = await fetch(contentPath, { headers: { cookie: "vtt_viewer_session=viewer-token", range: "bytes=0-7" } });
    expect(range.status).toBe(206);
    expect(range.headers.get("content-range")).toBe(`bytes 0-7/${test.input.length}`);
    expect(Buffer.from(await range.arrayBuffer())).toEqual(test.input.subarray(0, 8));
    const notModified = await fetch(contentPath, { headers: { authorization: "Bearer gm-token", "if-none-match": whole.headers.get("etag")! } });
    expect(notModified.status).toBe(304);
  });

  it("runs a server-owned calibration wizard through verification and durable completion", async () => {
    const test = await fixture();
    const upload = await body(await fetch(`${test.base}/api/v1/map-assets?filename=grid.png&kind=battlemap`, { method: "POST", headers: gm("image/png"), body: test.input }));
    const id = upload.data.asset.id;
    const started = await fetch(`${test.base}/api/v1/map-assets/${id}/calibration/wizards`, { method: "POST", headers: gm(), body: JSON.stringify({ start: { x: 0, y: 0 }, end: { x: 200, y: 0 }, cellsBetween: 4, axis: "horizontal", distancePerCell: 5 }) });
    expect(started.status).toBe(201);
    const startedBody = await body(started);
    expect(startedBody.data.state.calibration.cellSizePx).toBe(50);
    const wizardId = startedBody.data.wizardId;

    const adjusted = await body(await fetch(`${test.base}/api/v1/map-assets/${id}/calibration/wizards/${wizardId}/actions`, { method: "POST", headers: gm(), body: JSON.stringify({ action: "adjust", adjustment: { originDelta: { x: 1, y: 1 } } }) }));
    expect(adjusted.data.state.calibration.origin).toEqual({ x: 1, y: 1 });
    const undone = await body(await fetch(`${test.base}/api/v1/map-assets/${id}/calibration/wizards/${wizardId}/actions`, { method: "POST", headers: gm(), body: JSON.stringify({ action: "undo" }) }));
    expect(undone.data.state.calibration.origin).toEqual({ x: 0, y: 0 });
    const verified = await body(await fetch(`${test.base}/api/v1/map-assets/${id}/calibration/wizards/${wizardId}/actions`, { method: "POST", headers: gm(), body: JSON.stringify({ action: "verify", imagePoint: { x: 100, y: 100 } }) }));
    expect(verified.data.state.verification).toMatchObject({ accepted: true, errorPx: 0 });
    const completed = await body(await fetch(`${test.base}/api/v1/map-assets/${id}/calibration/wizards/${wizardId}/complete`, { method: "POST", headers: gm(), body: "{}" }));
    expect(completed.data.map.calibration).toMatchObject({ calibration: { cellSizePx: 50 }, verificationErrorPx: 0 });
    expect((await fetch(`${test.base}/api/v1/map-assets/${id}/calibration/wizards/${wizardId}/complete`, { method: "POST", headers: gm(), body: "{}" })).status).toBe(404);
  });

  it("calibrates gridless regional scale and rejects spoofed or unsafe inputs", async () => {
    const test = await fixture();
    const rejected = await fetch(`${test.base}/api/v1/map-assets?filename=malware.png`, { method: "POST", headers: gm("image/png"), body: Buffer.from("not an image") });
    expect(rejected.status).toBe(400);
    expect((await body(rejected)).error.message).toContain("Unsupported");

    const upload = await body(await fetch(`${test.base}/api/v1/map-assets?filename=region.png&kind=regional`, { method: "POST", headers: gm("image/png"), body: test.input }));
    const id = upload.data.asset.id;
    const scaled = await body(await fetch(`${test.base}/api/v1/map-assets/${id}/scale`, { method: "PUT", headers: gm(), body: JSON.stringify({ start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, knownDistance: 50, unit: "miles" }) }));
    expect(scaled.data.map.scale).toEqual({ kind: "image-scale", distancePerPixel: 0.5, unit: "miles" });
    expect((await fetch(`${test.base}/api/v1/map-assets/../../auth.json/content`, { headers: { authorization: "Bearer gm-token" } })).status).not.toBe(200);
  });
});
