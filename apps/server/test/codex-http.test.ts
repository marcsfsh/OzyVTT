import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { CodexStore } from "../src/codex-store.js";
import { MapAssetStore } from "../src/map-assets.js";
import { createCodexRouter } from "../src/codex-http.js";

/**
 * HTTP-boundary tests for the codex router - the layer that actually enforces viewer safety by picking a
 * GM vs player projection per role. Unit tests cover the projection functions; these confirm the router
 * wires them correctly (unrevealed = 404 not 403, gmBody never reaches a player, the parent-map and
 * journal-by-attachment reveal gates, the media gate, and the envelope shapes).
 */

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

function png(width: number, height: number) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(13, 8); buffer.write("IHDR", 12, "ascii"); buffer.writeUInt32BE(width, 16); buffer.writeUInt32BE(height, 20);
  return buffer;
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-codex-http-"));
  const store = new CodexStore(join(directory, "vtt.sqlite"), () => Date.parse("2026-07-16T03:00:00.000Z"));
  const assets = new MapAssetStore(join(directory, "codex-assets"));
  await store.initialize(); await assets.initialize();
  const app = express(); app.use(express.json()); app.use(createCodexRouter({
    store, assets,
    authorizeGm: (token) => token === "gm-token",
    authorizePlayer: (token) => token === "player-token",
    notifyChanged: () => {}
  }));
  const server = createServer(app); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Codex test server did not bind.");
  cleanups.push(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); store.close(); await rm(directory, { recursive: true, force: true }); });
  return { base: `http://127.0.0.1:${address.port}`, store, assets };
}

const GM = { authorization: "Bearer gm-token", "content-type": "application/json" };
const PLAYER = { authorization: "Bearer player-token", "content-type": "application/json" };
type Json = Record<string, any>;
async function body(response: Response) { return response.json() as Promise<Json>; }
const get = (base: string, path: string, headers: Record<string, string>) => fetch(`${base}${path}`, { headers });
const post = (base: string, path: string, headers: Record<string, string>, payload: unknown) => fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(payload) });
const patch = (base: string, path: string, headers: Record<string, string>, payload: unknown) => fetch(`${base}${path}`, { method: "PATCH", headers, body: JSON.stringify(payload) });

describe("codex HTTP viewer-safety boundary", () => {
  it("hides gmBody and unrevealed pages from players, but shows the GM everything", async () => {
    const { base } = await fixture();
    const created = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Bree", playerBody: "A crossroads town.", gmBody: "A cultist runs the inn." }));
    const pageId = created.data.page.id as string;

    // Unrevealed: player 404s (not 403 - existence must not be inferable), GM sees both bodies.
    expect((await get(base, `/api/v1/codex/pages/${pageId}`, PLAYER)).status).toBe(404);
    const gmView = await body(await get(base, `/api/v1/codex/pages/${pageId}`, GM));
    expect(gmView.data.page.gmBody).toBe("A cultist runs the inn.");

    // Player list omits the unrevealed page entirely.
    expect((await body(await get(base, "/api/v1/codex/pages", PLAYER))).data.pages).toHaveLength(0);

    // Reveal → player sees the player body only, never gmBody or rev.
    await post(base, `/api/v1/codex/pages/${pageId}/reveal`, GM, { revealed: true });
    const playerView = await body(await get(base, `/api/v1/codex/pages/${pageId}`, PLAYER));
    expect(playerView.data.page.body).toBe("A crossroads town.");
    expect(playerView.data.page).not.toHaveProperty("gmBody");
    expect(JSON.stringify(playerView)).not.toContain("cultist");
  });

  it("rejects player writes and missing auth with the right envelopes", async () => {
    const { base } = await fixture();
    expect((await post(base, "/api/v1/codex/pages", PLAYER, { title: "Nope" })).status).toBe(401);
    const noauth = await get(base, "/api/v1/codex/pages", { "content-type": "application/json" });
    expect(noauth.status).toBe(401);
    expect((await body(noauth)).ok).toBe(false);
  });

  it("returns a 409 conflict envelope on a stale expectedRev", async () => {
    const { base } = await fixture();
    const created = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Keep" }));
    const stale = await patch(base, `/api/v1/codex/pages/${created.data.page.id}`, GM, { title: "Keep II", expectedRev: 0 });
    expect(stale.status).toBe(409);
    expect((await body(stale)).error.code).toBe("conflict");
  });

  it("never leaks a hidden parent map's id to a player (revealed child, secret parent)", async () => {
    const { base } = await fixture();
    const asset = randomUUID();
    const world = await body(await post(base, "/api/v1/codex/maps", GM, { assetId: asset, name: "World", kind: "world" })); // secret by default
    const worldId = world.data.map.id as string;
    const region = await body(await post(base, "/api/v1/codex/maps", GM, { assetId: asset, name: "Region", kind: "regional", parentMapId: worldId }));
    await post(base, `/api/v1/codex/maps/${region.data.map.id}/reveal`, GM, { revealed: true });

    const playerMaps = (await body(await get(base, "/api/v1/codex/maps", PLAYER))).data.maps as Json[];
    expect(playerMaps).toHaveLength(1);                       // the secret world map is absent
    expect(playerMaps[0].name).toBe("Region");
    expect(playerMaps[0].parentMapId).toBeNull();             // and its secret parent's id is stripped
    expect(JSON.stringify(playerMaps)).not.toContain(worldId);
  });

  it("gates player markers on map + marker + link reveal, and strips scene/actor links", async () => {
    const { base } = await fixture();
    const asset = randomUUID();
    const map = await body(await post(base, "/api/v1/codex/maps", GM, { assetId: asset, name: "World", kind: "world" }));
    const mapId = map.data.map.id as string;
    const secretPage = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Lair" }));
    const marker = await body(await post(base, `/api/v1/codex/maps/${mapId}/markers`, GM, { x: 1, y: 1, iconId: "skull", iconColor: "#ff2e9a", pageId: secretPage.data.page.id, sceneId: randomUUID(), actorId: randomUUID(), revealedToPlayers: true }));

    // Map still secret → player 404 on its markers.
    expect((await get(base, `/api/v1/codex/maps/${mapId}/markers`, PLAYER)).status).toBe(404);

    await post(base, `/api/v1/codex/maps/${mapId}/reveal`, GM, { revealed: true });
    const playerMarkers = (await body(await get(base, `/api/v1/codex/maps/${mapId}/markers`, PLAYER))).data.markers as Json[];
    expect(playerMarkers).toHaveLength(1);
    expect(playerMarkers[0]).not.toHaveProperty("sceneId");
    expect(playerMarkers[0]).not.toHaveProperty("actorId");
    expect(playerMarkers[0].pageId).toBeNull();               // linked page not revealed → link hidden
    expect((await body(await get(base, `/api/v1/codex/maps/${mapId}/markers`, GM))).data.markers[0].sceneId).not.toBeNull();
  });

  it("404s a player reading a hidden location's journal-by-attachment", async () => {
    const { base } = await fixture();
    const page = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Bree" }));
    const pageId = page.data.page.id as string;
    await post(base, "/api/v1/codex/journal", GM, { playerText: "We arrived.", attachPageId: pageId, revealedToPlayers: true });

    // Page not revealed → player cannot pull its pinned timeline even though the entry itself is revealed.
    expect((await get(base, `/api/v1/codex/journal?pageId=${pageId}`, PLAYER)).status).toBe(404);
    await post(base, `/api/v1/codex/pages/${pageId}/reveal`, GM, { revealed: true });
    const entries = (await body(await get(base, `/api/v1/codex/journal?pageId=${pageId}`, PLAYER))).data.entries as Json[];
    expect(entries).toHaveLength(1);
    expect(entries[0]).not.toHaveProperty("gmText");
  });

  it("keeps player search inside the player index (no gmBody text, no unrevealed pages)", async () => {
    const { base } = await fixture();
    await post(base, "/api/v1/codex/pages", GM, { title: "Hidden shrine", playerBody: "", gmBody: "The relic of Vecna rests here.", revealedToPlayers: true });
    // "Vecna" lives only in gmBody → a player full-text search must not surface it.
    const playerHits = (await body(await get(base, `/api/v1/codex/search?q=Vecna`, PLAYER))).data.results as Json[];
    expect(playerHits).toHaveLength(0);
    const gmHits = (await body(await get(base, `/api/v1/codex/search?q=Vecna`, GM))).data.results as Json[];
    expect(gmHits).toHaveLength(1);
  });

  it("serves page media to a player only when a revealed page uses it", async () => {
    const { base } = await fixture();
    const upload = await body(await fetch(`${base}/api/v1/codex-assets?filename=a.png`, { method: "POST", headers: { authorization: "Bearer gm-token", "content-type": "image/png" }, body: png(8, 8) }));
    const assetId = upload.data.asset.id as string;
    const contentPath = `/api/v1/codex-assets/${assetId}/content`;

    expect((await get(base, contentPath, GM)).status).toBe(200);            // GM always
    expect((await get(base, contentPath, PLAYER)).status).toBe(403);        // not used by any revealed page yet
    const page = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Bree", bannerAssetId: assetId }));
    await post(base, `/api/v1/codex/pages/${page.data.page.id}/reveal`, GM, { revealed: true });
    expect((await get(base, contentPath, PLAYER)).status).toBe(200);        // now the banner of a revealed page
  });
});
