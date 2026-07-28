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
    // The preview token is a REAL player principal, exactly as `auth.issuePreviewPlayerSession()` mints
    // one in production - so it authorizes as a player and gets the player projection, nothing else.
    authorizePlayer: (token) => token === "player-token" || token === PREVIEW_TOKEN,
    notifyChanged: () => {},
    issuePreviewSession: () => PREVIEW_TOKEN
  }));
  const server = createServer(app); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Codex test server did not bind.");
  cleanups.push(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); store.close(); await rm(directory, { recursive: true, force: true }); });
  return { base: `http://127.0.0.1:${address.port}`, store, assets };
}

const PREVIEW_TOKEN = "preview-player-token";
const GM = { authorization: "Bearer gm-token", "content-type": "application/json" };
const PLAYER = { authorization: "Bearer player-token", "content-type": "application/json" };
type Json = Record<string, any>;
async function body(response: Response) { return response.json() as Promise<Json>; }
const get = (base: string, path: string, headers: Record<string, string>) => fetch(`${base}${path}`, { headers });
const post = (base: string, path: string, headers: Record<string, string>, payload: unknown) => fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(payload) });
const patch = (base: string, path: string, headers: Record<string, string>, payload: unknown) => fetch(`${base}${path}`, { method: "PATCH", headers, body: JSON.stringify(payload) });
const put = (base: string, path: string, headers: Record<string, string>, payload: unknown) => fetch(`${base}${path}`, { method: "PUT", headers, body: JSON.stringify(payload) });

describe("codex HTTP viewer-safety boundary", () => {
  it("never exposes a combat entry's replay linkage to a player, even when the entry is revealed", async () => {
    // K2: encounter archives carry GM-only narration and are documented as unreachable by players.
    // Surfacing replays in the Codex must therefore not hand players the archive id that opens one.
    const { base, store } = await fixture();
    const entry = store.appendCombatEntry({ sourceEncounterId: 42, playerText: "A battle was fought here." });
    expect(entry.sourceEncounterId).toBe(42);

    // GM gets the linkage (that is what drives "Open replay").
    const gmTimeline = await body(await get(base, "/api/v1/codex/journal", GM));
    expect(gmTimeline.data.entries[0].sourceEncounterId).toBe(42);

    // Reveal it, so the player CAN see the entry - the linkage still must not travel.
    await post(base, `/api/v1/codex/journal/${entry.id}/reveal`, GM, { revealed: true });
    const playerTimeline = await body(await get(base, "/api/v1/codex/journal", PLAYER));
    expect(playerTimeline.data.entries).toHaveLength(1);
    // Assert the EXACT projected key set rather than searching the payload for the id. A substring search
    // for "42" is flaky - the entry's own uuid contains "42" about 15% of the time - and weaker: this
    // fails if any new field is ever added to the player projection, not just this one.
    expect(Object.keys(playerTimeline.data.entries[0]).sort())
      .toEqual(["createdAt", "id", "inWorldLabel", "kind", "realDate", "sessionNumber", "text"]);
  });


  it("GM preview mints a real player principal and sees byte-identically what a player sees", async () => {
    const { base } = await fixture();
    const shown = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Bree", playerBody: "A crossroads town.", gmBody: "A cultist runs the inn." }));
    const shownId = shown.data.page.id as string;
    await post(base, `/api/v1/codex/pages/${shownId}/reveal`, GM, { revealed: true });
    const secret = await body(await post(base, "/api/v1/codex/pages", GM, { title: "The Cult", playerBody: "", gmBody: "Meets under the inn." }));
    const secretId = secret.data.page.id as string;

    // Minting is GM-only.
    expect((await post(base, "/api/v1/codex/preview-session", PLAYER, {})).status).toBe(401);
    const minted = await post(base, "/api/v1/codex/preview-session", GM, {});
    expect(minted.status).toBe(201);
    const token = (await body(minted)).data.token as string;
    expect(token).toBeTruthy();
    const PREVIEW = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    // The whole point: the preview payload must be IDENTICAL to a real player's, not merely similar.
    expect(await body(await get(base, "/api/v1/codex/pages", PREVIEW)))
      .toEqual(await body(await get(base, "/api/v1/codex/pages", PLAYER)));
    expect(await body(await get(base, `/api/v1/codex/pages/${shownId}`, PREVIEW)))
      .toEqual(await body(await get(base, `/api/v1/codex/pages/${shownId}`, PLAYER)));

    // ...and therefore carries no GM-only content, and cannot reach an unrevealed page.
    const previewPage = await body(await get(base, `/api/v1/codex/pages/${shownId}`, PREVIEW));
    expect(previewPage.data.page.gmBody).toBeUndefined();
    expect(JSON.stringify(previewPage)).not.toContain("cultist");
    expect((await get(base, `/api/v1/codex/pages/${secretId}`, PREVIEW)).status).toBe(404);

    // Guards the actual regression this milestone exists to prevent: the GM token must NOT be usable as
    // the preview, because `roleOf` resolves it to `gm` and would return GM projections.
    const gmPage = await body(await get(base, `/api/v1/codex/pages/${shownId}`, GM));
    expect(gmPage.data.page.gmBody).toBe("A cultist runs the inn.");
    expect(gmPage).not.toEqual(previewPage);
  });

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
    // A pin may link MANY pages + MANY scenes; here one secret page + one scene, plus an actor.
    const secretScene = randomUUID();
    await post(base, `/api/v1/codex/maps/${mapId}/markers`, GM, { x: 1, y: 1, iconId: "skull", iconColor: "#ff2e9a", pageIds: [secretPage.data.page.id], sceneIds: [secretScene], actorId: randomUUID(), revealedToPlayers: true });

    // Map still secret → player 404 on its markers.
    expect((await get(base, `/api/v1/codex/maps/${mapId}/markers`, PLAYER)).status).toBe(404);

    await post(base, `/api/v1/codex/maps/${mapId}/reveal`, GM, { revealed: true });
    const playerMarkers = (await body(await get(base, `/api/v1/codex/maps/${mapId}/markers`, PLAYER))).data.markers as Json[];
    expect(playerMarkers).toHaveLength(1);
    expect(playerMarkers[0]).not.toHaveProperty("sceneIds");
    expect(playerMarkers[0]).not.toHaveProperty("actorId");
    expect(playerMarkers[0].pageIds).toEqual([]);             // linked page not revealed → link hidden
    expect(JSON.stringify(playerMarkers)).not.toContain(secretScene);            // GM-only scene id never leaks
    expect(JSON.stringify(playerMarkers)).not.toContain(secretPage.data.page.id); // nor the unrevealed page id
    expect((await body(await get(base, `/api/v1/codex/maps/${mapId}/markers`, GM))).data.markers[0].sceneIds).toEqual([secretScene]);
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

  it("exposes entity type + fields on reveal, and hides relationships to unrevealed entities", async () => {
    const { base } = await fixture();
    const strahd = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Strahd", entityType: "character", fields: { race: "Vampire", age: "400" } }));
    const strahdId = strahd.data.page.id as string;
    const cult = await body(await post(base, "/api/v1/codex/pages", GM, { title: "The Cult" })); // stays secret
    const barovia = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Barovia" }));
    await post(base, `/api/v1/codex/pages/${strahdId}/relationships`, GM, { toPageId: cult.data.page.id, type: "leads" });
    await post(base, `/api/v1/codex/pages/${strahdId}/relationships`, GM, { toPageId: barovia.data.page.id, type: "rules" });
    await post(base, `/api/v1/codex/pages/${barovia.data.page.id}/reveal`, GM, { revealed: true });
    await post(base, `/api/v1/codex/pages/${strahdId}/reveal`, GM, { revealed: true });

    const view = await body(await get(base, `/api/v1/codex/pages/${strahdId}`, PLAYER));
    expect(view.data.page.entityType).toBe("character");
    expect(view.data.page.fields).toEqual({ race: "Vampire", age: "400" });
    const rels = view.data.relationships as Json[];
    expect(rels).toHaveLength(1);                       // only the edge to revealed Barovia
    expect(rels[0].otherTitle).toBe("Barovia");
    expect(JSON.stringify(view)).not.toContain("Cult"); // the secret entity never leaks via a relationship
  });

  it("keeps GM-only structured fields (gmFields) off a revealed page's player projection", async () => {
    const { base } = await fixture();
    const vex = await body(await post(base, "/api/v1/codex/pages", GM, {
      title: "Baroness Vex", entityType: "character",
      fields: { race: "Human", role: "Royal advisor" },
      gmFields: { goals: "Secretly poisoning the king to install her cult's heir" }
    }));
    const vexId = vex.data.page.id as string;
    await post(base, `/api/v1/codex/pages/${vexId}/reveal`, GM, { revealed: true });

    const gmView = await body(await get(base, `/api/v1/codex/pages/${vexId}`, GM));
    expect(gmView.data.page.gmFields).toEqual({ goals: "Secretly poisoning the king to install her cult's heir" });

    const playerView = await body(await get(base, `/api/v1/codex/pages/${vexId}`, PLAYER));
    expect(playerView.data.page.fields).toEqual({ race: "Human", role: "Royal advisor" }); // public facts only
    expect(playerView.data.page.gmFields).toBeUndefined();                                  // the secret map never ships
    expect(JSON.stringify(playerView)).not.toContain("poisoning");                          // the secret value never leaks
  });

  it("the server seals a secret field even when it is written into the PUBLIC fields map", async () => {
    const { base } = await fixture();
    // A raw/legacy write that wrongly puts the secret `goals` key in player-facing `fields`.
    const strahd = await body(await post(base, "/api/v1/codex/pages", GM, {
      title: "Count Strahd", entityType: "character", fields: { race: "Vampire", goals: "Reclaim Tatyana" }
    }));
    const id = strahd.data.page.id as string;
    await post(base, `/api/v1/codex/pages/${id}/reveal`, GM, { revealed: true });
    const gmView = await body(await get(base, `/api/v1/codex/pages/${id}`, GM));
    expect(gmView.data.page.fields.goals).toBeUndefined();          // server moved it out of the public map
    expect(gmView.data.page.gmFields.goals).toBe("Reclaim Tatyana"); // into the GM-only map
    const playerView = await body(await get(base, `/api/v1/codex/pages/${id}`, PLAYER));
    expect(playerView.data.page.fields).toEqual({ race: "Vampire" });
    expect(JSON.stringify(playerView)).not.toContain("Tatyana");
  });

  it("a player search finds a page by a public field value but never by a GM-only field value", async () => {
    const { base } = await fixture();
    const night = await body(await post(base, "/api/v1/codex/pages", GM, {
      title: "Nightsong", entityType: "character", fields: { race: "Elfkin" }, gmFields: { goals: "Betray the coven at Xanadar" }
    }));
    await post(base, `/api/v1/codex/pages/${night.data.page.id}/reveal`, GM, { revealed: true });
    const byPublic = await body(await get(base, `/api/v1/codex/search?q=Elfkin`, PLAYER));
    expect((byPublic.data.results as Json[]).length).toBeGreaterThan(0);   // public field value is searchable
    const bySecret = await body(await get(base, `/api/v1/codex/search?q=Xanadar`, PLAYER));
    expect(bySecret.data.results).toHaveLength(0);                          // secret field value is NOT
    const gmSecret = await body(await get(base, `/api/v1/codex/search?q=Xanadar`, GM));
    expect((gmSecret.data.results as Json[]).length).toBeGreaterThan(0);    // ...but the GM can find it
  });

  it("GET /relationships returns the whole-graph edge feed, viewer-safe for players", async () => {
    const { base } = await fixture();
    const a = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Azalin", entityType: "character" }));
    const b = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Darkon", entityType: "location" }));
    const secret = await body(await post(base, "/api/v1/codex/pages", GM, { title: "The Whispered Name" }));
    await post(base, `/api/v1/codex/pages/${a.data.page.id}/relationships`, GM, { toPageId: b.data.page.id, type: "rules" });
    await post(base, `/api/v1/codex/pages/${a.data.page.id}/relationships`, GM, { toPageId: secret.data.page.id, type: "serves" });
    await post(base, `/api/v1/codex/pages/${a.data.page.id}/reveal`, GM, { revealed: true });
    await post(base, `/api/v1/codex/pages/${b.data.page.id}/reveal`, GM, { revealed: true });

    const gmEdges = (await body(await get(base, "/api/v1/codex/relationships", GM))).data.relationships as Json[];
    expect(gmEdges).toHaveLength(2);
    const playerEdges = (await body(await get(base, "/api/v1/codex/relationships", PLAYER))).data.relationships as Json[];
    expect(playerEdges).toHaveLength(1); // only the edge whose BOTH endpoints are revealed
    expect(playerEdges[0].type).toBe("rules");
  });

  it("round-trips the world calendar (incl. current date), and weekdays appear in dated labels", async () => {
    const { base } = await fixture();
    const cal = { yearName: "AE", months: [{ name: "Rise", days: 10 }, { name: "Fall", days: 10 }], weekdays: ["Sol", "Lun"], currentDate: { year: 3, month: 1, day: 4 } };
    const saved = await body(await put(base, "/api/v1/codex/calendar", GM, cal));
    expect(saved.data.calendar.currentDate).toEqual({ year: 3, month: 1, day: 4 });
    const got = await body(await get(base, "/api/v1/codex/calendar", PLAYER)); // calendar is readable by any role
    expect(got.data.calendar.yearName).toBe("AE");
    const entry = await body(await post(base, "/api/v1/codex/journal", GM, { playerText: "Dawn.", inWorldDate: { year: 0, month: 0, day: 1 } }));
    expect(entry.data.entry.inWorldLabel).toBe("Sol, Rise 1, 0 AE"); // weekday now wired into the label
    expect((await put(base, "/api/v1/codex/calendar", PLAYER, cal)).status).toBe(401); // players cannot edit it (GM only)
  });
});
