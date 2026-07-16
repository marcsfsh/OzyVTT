import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

function png(width: number, height: number) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(13, 8); buffer.write("IHDR", 12, "ascii"); buffer.writeUInt32BE(width, 16); buffer.writeUInt32BE(height, 20);
  return buffer;
}

describe("testing MVP live server", () => {
  it("runs upload, calibration-ready map storage, viewer pairing, presentation, content, and restart recovery end to end", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-testing-mvp-"));
    const options = {
      authPath: join(directory, "auth.json"),
      databasePath: join(directory, "vtt.sqlite"),
      integrationCredentialsPath: join(directory, "integrations.sqlite"),
      mapAssetsPath: join(directory, "map-assets"),
      webDist: join(directory, "dist"),
      useDevelopmentClient: true,
      developmentClientPort: 5173,
      viewerBaseUrls: ["http://localhost:5173", "http://192.168.50.20:5173"]
    };
    let running = createServer(options);
    cleanups.push(async () => { running.close(); await rm(directory, { recursive: true, force: true }); });
    await running.initialize();
    await running.auth.bootstrap("a sufficiently long GM password");
    const gmToken = (await running.auth.login("a sufficiently long GM password"))!;
    const playerToken = running.auth.issuePlayerSession();
    await new Promise<void>((resolve) => running.httpServer.listen(0, "127.0.0.1", resolve));
    const address = running.httpServer.address(); if (!address || typeof address === "string") throw new Error("Live server did not bind.");
    let base = `http://127.0.0.1:${address.port}`;
    const gmHeaders = { authorization: `Bearer ${gmToken}`, "content-type": "application/json" };
    expect((await fetch(`${base}/api/gm/viewer-urls`)).status).toBe(401);
    const viewerUrls = await (await fetch(`${base}/api/gm/viewer-urls`, { headers: gmHeaders })).json();
    expect(viewerUrls.viewerUrls).toEqual(["http://localhost:5173/viewer.html", "http://192.168.50.20:5173/viewer.html"]);

    const input = png(800, 600);
    const upload = await fetch(`${base}/api/v1/map-assets?filename=arena.png&name=Testing%20Arena&kind=battlemap`, { method: "POST", headers: { authorization: `Bearer ${gmToken}`, "content-type": "image/png" }, body: input });
    expect(upload.status).toBe(201);
    const assetId = (await upload.json()).data.asset.id as string;
    const hiddenUpload = await fetch(`${base}/api/v1/map-assets?filename=gm-only.png&name=GM%20Only&kind=battlemap`, { method: "POST", headers: { authorization: `Bearer ${gmToken}`, "content-type": "image/png" }, body: png(640, 480) });
    expect(hiddenUpload.status).toBe(201);
    const hiddenAssetId = (await hiddenUpload.json()).data.asset.id as string;

    const pairingResponse = await fetch(`${base}/api/v1/viewer/pairings`, { method: "POST", headers: gmHeaders, body: "{}" });
    expect(pairingResponse.status).toBe(201);
    const pairingCode = (await pairingResponse.json()).pairing.code;
    const exchange = await fetch(`${base}/api/v1/viewer/pairings/exchange`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: pairingCode, name: "Testing TV" }) });
    expect(exchange.status).toBe(201);
    const viewerCookie = exchange.headers.get("set-cookie")!.split(";", 1)[0];

    for (const command of [
      { id: "80000000-0000-4000-8000-000000000001", expectedRevision: 0, payload: { type: "viewer.enabled.set", enabled: true } },
      { id: "80000000-0000-4000-8000-000000000002", expectedRevision: 1, payload: { type: "viewer.map.set", assetId, altText: "Testing Arena", camera: { center: { x: 400, y: 300 }, zoom: 1 } } }
    ]) {
      const response = await fetch(`${base}/api/v1/viewer/presentation/commands`, { method: "POST", headers: gmHeaders, body: JSON.stringify(command) });
      expect(response.status).toBe(200);
    }
    const viewerState = await (await fetch(`${base}/api/v1/viewer/presentation`, { headers: { cookie: viewerCookie } })).json();
    expect(viewerState.presentation).toMatchObject({ enabled: true, activeMap: { assetId }, camera: { center: { x: 400, y: 300 } } });
    const viewerImage = await fetch(`${base}/api/v1/map-assets/${assetId}/content`, { headers: { cookie: viewerCookie } });
    expect(Buffer.from(await viewerImage.arrayBuffer())).toEqual(input);
    expect(viewerImage.headers.get("cache-control")).toBe("private, no-store");
    const hiddenViewerImage = await fetch(`${base}/api/v1/map-assets/${hiddenAssetId}/content`, { headers: { cookie: viewerCookie } });
    expect(hiddenViewerImage.status).toBe(403);
    // Uploaded GM maps are not exposed to players until the server-authoritative
    // encounter selects one as the active battlemap.
    expect((await fetch(`${base}/api/v1/map-assets/${assetId}/content`, { headers: { authorization: `Bearer ${playerToken}` } })).status).toBe(403);
    expect((await fetch(`${base}/api/v1/map-assets/${hiddenAssetId}/content`, { headers: { authorization: `Bearer ${playerToken}` } })).status).toBe(403);
    const viewerRedirect = await fetch(`${base}/viewer`, { redirect: "manual" });
    expect(viewerRedirect.status).toBe(307);
    expect(viewerRedirect.headers.get("location")).toContain("5173/viewer.html");

    running.close();
    running = createServer(options); await running.initialize();
    await new Promise<void>((resolve) => running.httpServer.listen(0, "127.0.0.1", resolve));
    const restartedAddress = running.httpServer.address(); if (!restartedAddress || typeof restartedAddress === "string") throw new Error("Restarted server did not bind.");
    base = `http://127.0.0.1:${restartedAddress.port}`;
    const recoveredViewer = await fetch(`${base}/api/v1/viewer/presentation`, { headers: { cookie: viewerCookie } });
    expect(recoveredViewer.status).toBe(200);
    expect((await recoveredViewer.json()).presentation).toMatchObject({ revision: 2, activeMap: { assetId } });
    const newGmToken = (await running.auth.login("a sufficiently long GM password"))!;
    const recoveredMaps = await fetch(`${base}/api/v1/map-assets`, { headers: { authorization: `Bearer ${newGmToken}` } });
    expect((await recoveredMaps.json()).data.assets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: assetId, name: "Testing Arena" }),
      expect.objectContaining({ id: hiddenAssetId, name: "GM Only" })
    ]));
    const paused = await fetch(`${base}/api/v1/viewer/presentation/commands`, { method: "POST", headers: { authorization: `Bearer ${newGmToken}`, "content-type": "application/json" }, body: JSON.stringify({ id: "80000000-0000-4000-8000-000000000003", expectedRevision: 2, payload: { type: "viewer.enabled.set", enabled: false } }) });
    expect(paused.status).toBe(200);
    expect((await fetch(`${base}/api/v1/map-assets/${assetId}/content`, { headers: { cookie: viewerCookie } })).status).toBe(403);
  });
});
