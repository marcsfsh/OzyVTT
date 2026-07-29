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
import { CODEX_ASSET_PATHS, CODEX_PATHS, openApiDocument } from "@vtt/api-contract";

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
    // `tags` joined this set in CI-2 — a deliberate, reviewed addition: tags are GM-authored metadata that
    // has always been player-visible on PAGES, and here it rides the same allow-list, so it is only ever
    // emitted for an entry the player may already see. Any OTHER new key failing this line is a leak.
    expect(Object.keys(playerTimeline.data.entries[0]).sort())
      .toEqual(["createdAt", "id", "inWorldLabel", "kind", "realDate", "sessionNumber", "tags", "text"]);
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

  /**
   * CD-2. A page's structured fields used to survive a type switch: PATCH a character (with `race`,
   * `goals`, …) to `location` and the character keys stayed in `fields_json`. The editor renders only
   * the NEW type's fields, so the GM could neither see nor delete them — while a revealed page still
   * shipped them to players. The store now prunes to the effective type, on a bare type-only PATCH too.
   */
  it("prunes entity fields to the new type on an entityType-only PATCH, so nothing is stranded in the player payload", async () => {
    const { base } = await fixture();
    const created = await body(await post(base, "/api/v1/codex/pages", GM, {
      title: "Strahd", entityType: "character",
      fields: { race: "Vampire", age: "400", status: "undead" },
      gmFields: { goals: "rule Barovia" }
    }));
    const pageId = created.data.page.id as string;
    await post(base, `/api/v1/codex/pages/${pageId}/reveal`, GM, { revealed: true });

    // Sanity: the character's own keys are present before the switch.
    const before = await body(await get(base, `/api/v1/codex/pages/${pageId}`, GM));
    expect(before.data.page.fields).toEqual({ race: "Vampire", age: "400", status: "undead" });

    // The switch carries NO fields — only the type. This is the case that used to strand them.
    const switched = await patch(base, `/api/v1/codex/pages/${pageId}`, GM, { entityType: "location" });
    expect(switched.status).toBe(200);

    const gmAfter = await body(await get(base, `/api/v1/codex/pages/${pageId}`, GM));
    expect(gmAfter.data.page.entityType).toBe("location");
    expect(gmAfter.data.page.fields).toEqual({});          // no character key survives...
    expect(gmAfter.data.page.gmFields).toEqual({});         // ...on either side of the secrecy line

    // The player payload is the point: a revealed page must not still be carrying the old type's values.
    const playerAfter = await body(await get(base, `/api/v1/codex/pages/${pageId}`, PLAYER));
    expect(playerAfter.data.page.fields).toEqual({});
    expect(JSON.stringify(playerAfter)).not.toContain("Vampire");
    expect(JSON.stringify(playerAfter)).not.toContain("undead");

    // Recoverable, which is what makes pruning safe: the pre-switch revision restores type AND values.
    const revisions = (await body(await get(base, `/api/v1/codex/pages/${pageId}/revisions`, GM))).data.revisions as Json[];
    const preSwitch = revisions.find((revision) => (revision as { rev: number }).rev === 1)!;
    const restored = await body(await post(base, `/api/v1/codex/pages/${pageId}/revisions/${(preSwitch as { id: number }).id}/restore`, GM, {}));
    expect(restored.data.page.entityType).toBe("character");
    expect(restored.data.page.fields).toEqual({ race: "Vampire", age: "400", status: "undead" });
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
    const playerHits = ((await body(await get(base, `/api/v1/codex/search?q=Vecna`, PLAYER))).data.hits as Json[]).filter((hit) => hit.kind === "page");
    expect(playerHits).toHaveLength(0);
    const gmHits = ((await body(await get(base, `/api/v1/codex/search?q=Vecna`, GM))).data.hits as Json[]).filter((hit) => hit.kind === "page");
    expect(gmHits).toHaveLength(1);
  });

  it("returns the page NAMED for the query first, so the command palette's Enter lands on it", async () => {
    // The reviewer's exact reproduction: `q=Strahd` came back ["QA Keep 645834", "QA Keep 750639",
    // "Strahd"], so typing "Strahd" and pressing Enter opened QA Keep 645834. Ordering is DECIDED in
    // `searchAll` (and pinned there, at the store level, in codex-store.test.ts); what this adds is that
    // the router's load → project → filter chain PRESERVES that order rather than quietly reshuffling it.
    const { base } = await fixture();
    const make = async (title: string, playerBody: string) => {
      const created = await body(await post(base, "/api/v1/codex/pages", GM, { title, playerBody }));
      const id = created.data.page.id as string;
      await post(base, `/api/v1/codex/pages/${id}/reveal`, GM, { revealed: true });
      return id;
    };
    const named = await make("Strahd", "A vampire lord.");
    const mentionsA = await make("QA Keep 645834", "Strahd Strahd garrison notes about Strahd and the keep.");
    const mentionsB = await make("QA Keep 750639", "Strahd rides at night. Strahd again.");

    for (const headers of [GM, PLAYER]) {
      const hits = (await body(await get(base, `/api/v1/codex/search?q=Strahd`, headers))).data.hits as Json[];
      expect(hits[0]).toMatchObject({ kind: "page", id: named });
      // ...and the two that merely mention it are still returned, just lower - recall did not shrink.
      expect(hits.map((hit) => hit.id).sort()).toEqual([named, mentionsA, mentionsB].sort());
    }
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
    expect((byPublic.data.hits as Json[]).length).toBeGreaterThan(0);      // public field value is searchable
    const bySecret = await body(await get(base, `/api/v1/codex/search?q=Xanadar`, PLAYER));
    expect(bySecret.data.hits).toHaveLength(0);                             // secret field value is NOT
    const gmSecret = await body(await get(base, `/api/v1/codex/search?q=Xanadar`, GM));
    expect((gmSecret.data.hits as Json[]).length).toBeGreaterThan(0);       // ...but the GM can find it
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

  /**
   * CI-4. The page -> markers reverse lookup is a NEW player-reachable read, and the one the milestone
   * flagged as most likely to leak: reached by PAGE id, a pin arrives without its map's gate having been
   * applied. These assert it is gated by exactly the forward route's predicate, and the negative cases
   * are also proven one layer down, against `projectPlayerPageMarker` itself, in `codex-store.test.ts`.
   */
  it("GET /pages/:id/markers 404s a player on an unrevealed page, and never lets one probe by page id", async () => {
    const { base } = await fixture();
    const page = await body(await post(base, "/api/v1/codex/pages", GM, { title: "The Amber Temple" }));
    const pageId = page.data.page.id as string;
    const map = await body(await post(base, "/api/v1/codex/maps", GM, { assetId: randomUUID(), name: "Barovia", kind: "regional" }));
    await post(base, `/api/v1/codex/maps/${map.data.map.id}/reveal`, GM, { revealed: true });
    await post(base, `/api/v1/codex/maps/${map.data.map.id}/markers`, GM, { x: 0.5, y: 0.5, iconId: "pin", iconColor: "#ff2e9a", label: "Amber vaults", pageIds: [pageId], revealedToPlayers: true });

    // The page is secret, so the question itself must not be answerable - 404, not an empty list, exactly
    // as `GET /codex/journal?pageId=` refuses a hidden location's mini-timeline.
    const denied = await get(base, `/api/v1/codex/pages/${pageId}/markers`, PLAYER);
    expect(denied.status).toBe(404);
    expect(JSON.stringify(await body(denied))).not.toContain("Amber vaults");
    // The GM asking the same question gets the pin - so the 404 is the reveal gate, not a broken lookup.
    expect((await body(await get(base, `/api/v1/codex/pages/${pageId}/markers`, GM))).data.markers).toHaveLength(1);

    // Revealing the page opens it, which is what makes the refusal above meaningful.
    await post(base, `/api/v1/codex/pages/${pageId}/reveal`, GM, { revealed: true });
    const allowed = (await body(await get(base, `/api/v1/codex/pages/${pageId}/markers`, PLAYER))).data.markers as Json[];
    expect(allowed).toHaveLength(1);
    expect(allowed[0].label).toBe("Amber vaults");
  });

  it("GET /pages/:id/markers hides a secret map's pin (CD-6) and a hidden pin, and strips scene/actor links", async () => {
    const { base } = await fixture();
    const page = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Strahd" }));
    const pageId = page.data.page.id as string;
    await post(base, `/api/v1/codex/pages/${pageId}/reveal`, GM, { revealed: true }); // the page itself is open

    const makeMap = async (name: string, revealed: boolean) => {
      const map = await body(await post(base, "/api/v1/codex/maps", GM, { assetId: randomUUID(), name, kind: "regional" }));
      if (revealed) await post(base, `/api/v1/codex/maps/${map.data.map.id}/reveal`, GM, { revealed: true });
      return map.data.map.id as string;
    };
    const openMap = await makeMap("Vallaki", true);
    const secretMap = await makeMap("Amberhold", false);
    const secretScene = randomUUID();
    const secretActor = randomUUID();
    const otherSecretPage = await body(await post(base, "/api/v1/codex/pages", GM, { title: "The Heart of Sorrow" }));

    // Three pins, all linking the SAME open page - one visible, one hidden, one revealed on a secret map.
    const shown = await body(await post(base, `/api/v1/codex/maps/${openMap}/markers`, GM, {
      x: 0.2, y: 0.2, iconId: "castle", iconColor: "#ff2e9a", label: "Castle Ravenloft",
      pageIds: [pageId, otherSecretPage.data.page.id], sceneIds: [secretScene], actorId: secretActor, revealedToPlayers: true
    }));
    await post(base, `/api/v1/codex/maps/${openMap}/markers`, GM, { x: 0.3, y: 0.3, iconId: "pin", iconColor: "#ff2e9a", label: "Vistani camp", pageIds: [pageId], revealedToPlayers: false });
    await post(base, `/api/v1/codex/maps/${secretMap}/markers`, GM, { x: 0.4, y: 0.4, iconId: "pin", iconColor: "#ff2e9a", label: "Wyrmwood cache", pageIds: [pageId], revealedToPlayers: true });

    // GM sees all three, whole.
    const gmMarkers = (await body(await get(base, `/api/v1/codex/pages/${pageId}/markers`, GM))).data.markers as Json[];
    expect(gmMarkers.map((marker) => marker.label).sort()).toEqual(["Castle Ravenloft", "Vistani camp", "Wyrmwood cache"]);

    const playerMarkers = (await body(await get(base, `/api/v1/codex/pages/${pageId}/markers`, PLAYER))).data.markers as Json[];
    expect(playerMarkers).toHaveLength(1);                       // only the shown pin on the shown map
    expect(playerMarkers[0].id).toBe(shown.data.marker.id);
    const payload = JSON.stringify(playerMarkers);
    expect(payload).not.toContain("Vistani camp");               // hidden pin
    expect(payload).not.toContain("Wyrmwood cache");             // revealed pin, SECRET map (CD-6)
    expect(payload).not.toContain(secretMap);                    // ...and not even that map's id
    expect(payload).not.toContain(secretScene);                  // GM-only linkage never travels
    expect(payload).not.toContain(secretActor);
    expect(playerMarkers[0]).not.toHaveProperty("sceneIds");
    expect(playerMarkers[0]).not.toHaveProperty("actorId");
    expect(playerMarkers[0]).not.toHaveProperty("revealedToPlayers");
    expect(playerMarkers[0].pageIds).toEqual([pageId]);           // the pin's OTHER, secret page link is filtered out
    expect(payload).not.toContain(otherSecretPage.data.page.id as string);
  });

  /** CI-4's payload must not exceed the forward route's: same projection, so byte-identical for the same pin. */
  it("GET /pages/:id/markers hands a player exactly what GET /maps/:id/markers hands them for the same pin", async () => {
    const { base } = await fixture();
    const page = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Ireena" }));
    const pageId = page.data.page.id as string;
    await post(base, `/api/v1/codex/pages/${pageId}/reveal`, GM, { revealed: true });
    const map = await body(await post(base, "/api/v1/codex/maps", GM, { assetId: randomUUID(), name: "Barovia", kind: "regional" }));
    const mapId = map.data.map.id as string;
    await post(base, `/api/v1/codex/maps/${mapId}/reveal`, GM, { revealed: true });
    await post(base, `/api/v1/codex/maps/${mapId}/markers`, GM, { x: 0.5, y: 0.5, iconId: "pin", iconColor: "#ff2e9a", label: "Burgomaster's house", pageIds: [pageId], sceneIds: [randomUUID()], revealedToPlayers: true });

    const forward = (await body(await get(base, `/api/v1/codex/maps/${mapId}/markers`, PLAYER))).data.markers as Json[];
    const reverse = (await body(await get(base, `/api/v1/codex/pages/${pageId}/markers`, PLAYER))).data.markers as Json[];
    expect(reverse).toEqual(forward);
  });

  /**
   * CI-8. The whole-graph wiki-link feed. Every negative here is also proven directly against
   * `projectPlayerLinkEdges` in `codex-store.test.ts` - an HTTP test shows the pipeline works, never
   * which layer did the work.
   */
  it("GET /links returns wiki-link edges, and a player sees neither GM-body links nor edges touching a secret page", async () => {
    const { base } = await fixture();
    const make = async (title: string, playerBody: string, gmBody: string, revealed: boolean) => {
      const page = await body(await post(base, "/api/v1/codex/pages", GM, { title, playerBody, gmBody }));
      const pageId = page.data.page.id as string;
      if (revealed) await post(base, `/api/v1/codex/pages/${pageId}/reveal`, GM, { revealed: true });
      return pageId;
    };
    // Barovia -> Vallaki in the PLAYER body (the one edge a player may have);
    // Barovia -> The Whispered Name in the player body, but that page is SECRET (dangling for a player);
    // Barovia -> Vallaki again in the GM body of Vallaki, i.e. a GM-only connection between two open pages.
    const secret = await make("The Whispered Name", "", "", false);
    const barovia = await make("Barovia", "Ruled from [[Vallaki]], watched by [[The Whispered Name]].", "", true);
    const vallaki = await make("Vallaki", "A walled town.", "Its burgomaster answers to [[Barovia]].", true);

    const gmLinks = (await body(await get(base, "/api/v1/codex/links", GM))).data.links as Json[];
    expect(gmLinks).toEqual(expect.arrayContaining([
      { fromPageId: barovia, toPageId: vallaki },
      { fromPageId: barovia, toPageId: secret },
      { fromPageId: vallaki, toPageId: barovia }   // the GM-body link
    ]));
    expect(gmLinks).toHaveLength(3);

    const playerLinks = (await body(await get(base, "/api/v1/codex/links", PLAYER))).data.links as Json[];
    expect(playerLinks).toEqual([{ fromPageId: barovia, toPageId: vallaki }]);
    // The secret page must not be inferable from a dangling edge, and the GM-body edge must not appear
    // even though BOTH of its endpoints are revealed - the two rules are independent.
    expect(JSON.stringify(playerLinks)).not.toContain(secret);
    expect(playerLinks.some((edge) => edge.fromPageId === vallaki)).toBe(false);
  });

  it("GET /links drops a self-link and a link to a title no page carries", async () => {
    const { base } = await fixture();
    const page = await body(await post(base, "/api/v1/codex/pages", GM, {
      title: "Barovia", playerBody: "See [[Barovia]] and [[A Page That Was Never Written]].", revealedToPlayers: true
    }));
    const links = (await body(await get(base, "/api/v1/codex/links", GM))).data.links as Json[];
    expect(links).toEqual([]);                                     // no node to draw for either
    expect(JSON.stringify(links)).not.toContain(page.data.page.id as string);
  });

  it("returns ONE list carrying every matching kind, with no superseded second list (R8)", async () => {
    const { base } = await fixture();
    // One word ("Ravenloft") on a page AND a map: the point of R8 is that ONE list carries both.
    const page = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Ravenloft", playerBody: "a gothic castle" }));
    await post(base, `/api/v1/codex/pages/${page.data.page.id}/reveal`, GM, { revealed: true });
    const map = await body(await post(base, "/api/v1/codex/maps", GM, { assetId: randomUUID(), name: "Ravenloft approach", kind: "regional" }));
    await post(base, `/api/v1/codex/maps/${map.data.map.id}/reveal`, GM, { revealed: true });

    const found = await body(await get(base, `/api/v1/codex/search?q=Ravenloft`, PLAYER));
    const hits = found.data.hits as Json[];
    expect(hits.map((hit) => hit.kind).sort()).toEqual(["map", "page"]);
    expect(hits.find((hit) => hit.kind === "page")!.id).toBe(page.data.page.id);
    expect(hits.find((hit) => hit.kind === "map")!.id).toBe(map.data.map.id);
    // The superseded page-only `results` array is gone, not merely unused.
    expect(found.data.results).toBeUndefined();
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

/**
 * CI-1. A player-visible search index IS a player-facing projection, and it is the one that is easy to
 * get wrong: every OTHER read path starts from a list the GM curated, while search starts from raw
 * matched text. So the bar is that the player index is gated by exactly the predicate its record's
 * player LIST endpoint uses - never a weaker one - and these tests assert that at the HTTP boundary,
 * which is where the role is actually resolved and the projection actually chosen.
 */
describe("codex suite-wide search viewer safety (CI-1)", () => {
  /** One world holding every leak shape at once, so a single query can prove what search must not return. */
  async function world() {
    const { base } = await fixture();
    const asset = randomUUID();
    const makeMap = async (name: string, revealed: boolean) => {
      const map = await body(await post(base, "/api/v1/codex/maps", GM, { assetId: asset, name, kind: "regional" }));
      if (revealed) await post(base, `/api/v1/codex/maps/${map.data.map.id}/reveal`, GM, { revealed: true });
      return map.data.map.id as string;
    };
    const makeMarker = async (mapId: string, label: string, revealedToPlayers: boolean) =>
      (await body(await post(base, `/api/v1/codex/maps/${mapId}/markers`, GM, { x: 0.5, y: 0.5, iconId: "pin", iconColor: "#ff2e9a", label, revealedToPlayers }))).data.marker.id as string;

    const openMap = await makeMap("Vallaki", true);
    const secretMap = await makeMap("Amberhold", false);
    const shownMarker = await makeMarker(openMap, "Blinsky toys", true);
    const hiddenMarker = await makeMarker(openMap, "Vistani informant", false);
    // The CD-6 shape: the pin itself is revealed, but it stands on a map the party has never seen.
    const pinOnSecretMap = await makeMarker(secretMap, "Wyrmwood cache", true);
    const entry = await body(await post(base, "/api/v1/codex/journal", GM, {
      playerText: "The mists parted before us.", gmText: "Strahd was watching from the parapet.", revealedToPlayers: true
    }));
    return { base, openMap, secretMap, shownMarker, hiddenMarker, pinOnSecretMap, entryId: entry.data.entry.id as string };
  }

  const search = async (base: string, term: string, headers: Record<string, string>) =>
    (await body(await get(base, `/api/v1/codex/search?q=${term}`, headers))).data.hits as Json[];

  it("a player search cannot surface a REVEALED journal entry's GM-only text", async () => {
    const { base, entryId } = await world();
    // The entry is revealed, so the player legitimately has it - but "parapet" exists only in gmText.
    expect(await search(base, "parapet", PLAYER)).toEqual([]);
    expect(JSON.stringify(await body(await get(base, `/api/v1/codex/search?q=parapet`, PLAYER)))).not.toContain("Strahd");
    // The player-layer half of the SAME entry is findable, which is what makes the miss meaningful.
    const byPlayerText = await search(base, "mists", PLAYER);
    expect(byPlayerText).toHaveLength(1);
    expect(byPlayerText[0].kind).toBe("journal");
    expect(byPlayerText[0].id).toBe(entryId);
    expect(byPlayerText[0].title).toBe("The mists parted before us."); // the excerpt is the PLAYER layer
    expect(JSON.stringify(byPlayerText)).not.toContain("Strahd");
  });

  it("a player search cannot surface a hidden marker's label", async () => {
    const { base, shownMarker } = await world();
    expect(await search(base, "Vistani", PLAYER)).toEqual([]);
    // The revealed pin on the same revealed map IS findable - so the miss is the reveal flag, not the index.
    expect(await search(base, "Blinsky", PLAYER)).toEqual([expect.objectContaining({ kind: "marker", id: shownMarker })]);
  });

  it("a player search cannot surface a REVEALED marker that sits on a secret map (CD-6)", async () => {
    const { base, secretMap } = await world();
    // A pin's own reveal flag is not the whole predicate: `GET /maps/:id/markers` 404s a player on an
    // unrevealed map before projecting anything, so search must not be the way around that.
    const hits = await search(base, "Wyrmwood", PLAYER);
    expect(hits).toEqual([]);
    expect(JSON.stringify(await body(await get(base, `/api/v1/codex/search?q=Wyrmwood`, PLAYER)))).not.toContain(secretMap);
  });

  it("a player search cannot surface a hidden map's name", async () => {
    const { base, openMap } = await world();
    expect(await search(base, "Amberhold", PLAYER)).toEqual([]);
    expect(await search(base, "Vallaki", PLAYER)).toEqual([expect.objectContaining({ kind: "map", id: openMap })]);
  });

  it("a GM search finds every one of those, across all four record kinds", async () => {
    const { base, secretMap, hiddenMarker, pinOnSecretMap, entryId } = await world();
    await post(base, "/api/v1/codex/pages", GM, { title: "Ireena", playerBody: "Burgomaster's daughter" }); // unrevealed page
    expect(await search(base, "parapet", GM)).toEqual([expect.objectContaining({ kind: "journal", id: entryId })]);
    expect(await search(base, "Vistani", GM)).toEqual([expect.objectContaining({ kind: "marker", id: hiddenMarker })]);
    expect(await search(base, "Wyrmwood", GM)).toEqual([expect.objectContaining({ kind: "marker", id: pinOnSecretMap })]);
    expect(await search(base, "Amberhold", GM)).toEqual([expect.objectContaining({ kind: "map", id: secretMap })]);
    expect((await search(base, "Ireena", GM)).map((hit) => hit.kind)).toEqual(["page"]);
  });

  it("a player hit carries only navigation fields - no bodies, reveal flags, or secret-map linkage", async () => {
    const { base, openMap, shownMarker } = await world();
    // Assert the EXACT key set, not a substring scan: this fails on ANY new field entering the player
    // search projection, which is the check `viewer-safety.md` asks for on every projection change.
    const marker = (await search(base, "Blinsky", PLAYER))[0];
    expect(Object.keys(marker).sort()).toEqual(["entityType", "id", "kind", "mapId", "tags", "title"]);
    expect(marker.mapId).toBe(openMap);   // a player only ever gets a pin whose map is revealed
    expect(marker.id).toBe(shownMarker);
  });
});

/**
 * CT-11 / CT-12 at the HTTP boundary (A-8). `PlayerCodex` fetches the timeline, so every record kind that
 * joins the chronicle is player-reachable BY DEFAULT — an event page is a projection surface, not a
 * display change. These are the pipeline tests; the layer that actually decides is exercised point-blank
 * in `codex-store.test.ts` ("Codex chronicle — the projection layer, on its own"), because an HTTP test
 * can only ever say the pipeline as a whole behaved, never which layer made it behave.
 */
describe("codex chronicle HTTP boundary (CT-11, A-8)", () => {
  const chronicle = async (base: string, headers: Record<string, string>) =>
    (await body(await get(base, "/api/v1/codex/timeline", headers))).data.records as Json[];

  it("returns no UNREVEALED event and no GM-only event content to a player", async () => {
    const { base, store } = await fixture();
    const secret = store.createPage({
      title: "The Sundering", entityType: "event", playerBody: "The sky tore open.", gmBody: "Strahd engineered it.",
      gmFields: { goals: "conceal the cause" }, inWorldDate: { year: 1492, month: 0, day: 1 }
    });
    const shown = store.createPage({
      title: "The Festival of the Blazing Sun", entityType: "event", revealedToPlayers: true,
      playerBody: "Vallaki celebrated.", gmBody: "The wolves were already inside.",
      inWorldDate: { year: 1492, month: 0, day: 2 }
    });

    // The GM sees both, with both layers - so the player assertions below are the gate working, not an
    // empty chronicle or an event with nothing to leak.
    const gmRows = await chronicle(base, GM);
    expect(gmRows.map((row) => row.id)).toEqual([secret.id, shown.id]);
    expect(JSON.stringify(gmRows)).toContain("Strahd engineered it.");

    const playerRows = await chronicle(base, PLAYER);
    expect(playerRows.map((row) => row.id)).toEqual([shown.id]);          // the unrevealed event is absent
    const payload = JSON.stringify(playerRows);
    expect(payload).not.toContain("Strahd engineered it.");               // the revealed event's GM body
    expect(payload).not.toContain("The wolves were already inside.");
    expect(payload).not.toContain("conceal the cause");                   // GM fields
    expect(payload).not.toContain("The Sundering");                       // even the secret event's TITLE
    // The EXACT projected key set, as the journal timeline test above asserts for an entry: this fails if
    // any new field ever enters the player chronicle projection, not only if this one leaks.
    //
    // M11 widened it by exactly two, each a reviewed addition rather than a passenger:
    //   `fired`   - CT-5. A revealed deadline the campaign has already passed has to READ as passed, or the
    //               party's timeline says something different from the GM's. Derived against the PUBLISHED
    //               date, never the GM's clock - which is what the prep-clock test below pins.
    //   `payload` - CT-10, and only ever `who`/`activity`/`days`. `applied` is GM workflow state and is
    //               allow-listed away, which the projection test asserts at its own layer.
    // `proposedDate` deliberately did NOT join them: a clock move the GM has not confirmed is prep.
    expect(Object.keys(playerRows[0]).sort())
      .toEqual(["createdAt", "fired", "id", "inWorldLabel", "kind", "payload", "realDate", "sessionNumber", "tags", "text", "title"]);
  });

  it("interleaves a dated event with journal entries in one in-world order, for both roles", async () => {
    const { base, store } = await fixture();
    const early = store.createEntry({ playerText: "Founding.", revealedToPlayers: true, inWorldDate: { year: 1400, month: 0, day: 1 } });
    const event = store.createPage({ title: "The Sundering", entityType: "event", revealedToPlayers: true, playerBody: "The sky tore open.", inWorldDate: { year: 1450, month: 0, day: 1 } });
    const late = store.createEntry({ playerText: "The war.", revealedToPlayers: true, inWorldDate: { year: 1500, month: 0, day: 1 } });

    for (const headers of [GM, PLAYER]) {
      const rows = await chronicle(base, headers);
      expect(rows.map((row) => row.id)).toEqual([early.id, event.id, late.id]);
      expect(rows.map((row) => row.kind)).toEqual(["entry", "event", "entry"]);
    }
  });

  it("reflows events and entries together when the calendar changes, seen through the API", async () => {
    // K3 end to end: the same PUT the calendar editor sends, then the chronicle re-read. The order and the
    // labels both have to move, and the raw dates must be exactly what was typed.
    const { base, store } = await fixture();
    // Ten days apart on purpose. Identically-dated records fall to the comparator's last tiebreaker (the
    // id), which is a real total order but not a predictable one, and asserting an ORDER over it would be
    // asserting a coin flip. Distinct dates also prove each record reflowed to its OWN new instant rather
    // than both being written the same value.
    const entry = store.createEntry({ playerText: "Founding.", inWorldDate: { year: 1, month: 1, day: 10 } });
    const event = store.createPage({ title: "The Sundering", entityType: "event", inWorldDate: { year: 1, month: 1, day: 20 } });

    const response = await put(base, "/api/v1/codex/calendar", GM, { yearName: "AE", months: [{ name: "Rise", days: 100 }, { name: "Fall", days: 100 }], weekdays: [] });
    expect(response.status).toBe(200);

    const rows = await chronicle(base, GM);
    expect(rows.map((row) => row.id)).toEqual([entry.id, event.id]);
    expect(rows.map((row) => row.inWorldLabel)).toEqual(["Fall 10, 1 AE", "Fall 20, 1 AE"]);
    expect(rows.map((row) => row.calendarInstant)).toEqual([309, 319]);   // 1*200 + 100 + (day-1), on the NEW year
    expect(rows.map((row) => row.inWorldDate)).toEqual([{ year: 1, month: 1, day: 10 }, { year: 1, month: 1, day: 20 }]);
  });

  it("dates an event page through the page routes, and clears it with an explicit null", async () => {
    const { base } = await fixture();
    const created = await body(await post(base, "/api/v1/codex/pages", GM, { title: "The Sundering", entityType: "event", inWorldDate: { year: 1492, month: 0, day: 1 } }));
    const id = created.data.page.id as string;
    expect(created.data.page.inWorldDate).toEqual({ year: 1492, month: 0, day: 1 });
    expect(created.data.page.calendarInstant).not.toBeNull();
    expect((await chronicle(base, GM)).map((row) => row.id)).toEqual([id]);

    // A PATCH that never mentions the date leaves it alone - the page editor's autosave path.
    await patch(base, `/api/v1/codex/pages/${id}`, GM, { playerBody: "The sky tore open." });
    expect((await chronicle(base, GM))[0].inWorldDate).toEqual({ year: 1492, month: 0, day: 1 });

    // An explicit null clears it, and the page leaves the chronicle.
    const cleared = await body(await patch(base, `/api/v1/codex/pages/${id}`, GM, { inWorldDate: null }));
    expect(cleared.data.page.inWorldDate).toBeNull();
    expect(await chronicle(base, GM)).toEqual([]);
  });

  it("refuses the chronicle to an unauthenticated caller", async () => {
    const { base } = await fixture();
    const response = await get(base, "/api/v1/codex/timeline", { "content-type": "application/json" });
    expect(response.status).toBe(401);
  });
});

/**
 * M9 sessions at the HTTP boundary (A-8). A session is a NEW player-reachable read, and the record whose
 * two layers are furthest apart in consequence: `prepBody` is the GM's plan for the evening, `recapBody`
 * is what the table reads afterwards. These are the pipeline tests; the layer that actually decides is
 * exercised point-blank in `codex-store.test.ts` ("Codex session — the projection layer, on its own"),
 * because an HTTP test can only ever say the pipeline as a whole behaved, never which layer made it.
 */
describe("codex sessions HTTP boundary (M9, A-8)", () => {
  const PREP = "The ambush is at the bridge; Ireena is the real target.";
  const RECAP = "The party crossed the bridge.";

  it("gives a player the recap and NEVER the prep, and 404s an unrevealed session", async () => {
    const { base } = await fixture();
    const shown = await body(await post(base, "/api/v1/codex/sessions", GM, {
      sessionNumber: 6, realDate: "2026-07-26", attendees: ["Ozy", "Mara"], prepBody: PREP, recapBody: RECAP
    }));
    const shownId = shown.data.session.id as string;
    const secret = await body(await post(base, "/api/v1/codex/sessions", GM, {
      sessionNumber: 7, prepBody: "Strahd attends the ball in person.", recapBody: "The ball ended badly."
    }));
    const secretId = secret.data.session.id as string;

    // The GM sees BOTH layers of both sessions - so the player assertions below are the gate working,
    // not an empty payload or a session with nothing to leak.
    const gmList = await body(await get(base, "/api/v1/codex/sessions", GM));
    expect((gmList.data.sessions as Json[]).map((row) => row.sessionNumber)).toEqual([6, 7]);
    expect(JSON.stringify(gmList)).toContain(PREP);
    expect(JSON.stringify(gmList)).toContain(RECAP);

    // Unrevealed: the player list is empty and the direct read is a 404, never a 403 - a status code that
    // distinguishes "secret" from "absent" is itself the leak.
    expect((await body(await get(base, "/api/v1/codex/sessions", PLAYER))).data.sessions).toHaveLength(0);
    expect((await get(base, `/api/v1/codex/sessions/${shownId}`, PLAYER)).status).toBe(404);

    await post(base, `/api/v1/codex/sessions/${shownId}/reveal`, GM, { revealed: true });
    const playerList = await body(await get(base, "/api/v1/codex/sessions", PLAYER));
    const rows = playerList.data.sessions as Json[];
    expect(rows).toHaveLength(1);                                   // the still-secret session 7 is absent
    // The EXACT projected key set, as the journal and chronicle tests above assert for their records:
    // this fails if any new field ever enters the player session projection, not only if this one leaks.
    expect(Object.keys(rows[0]).sort()).toEqual(["id", "realDate", "recap", "sessionNumber"]);
    expect(rows[0].recap).toBe(RECAP);

    const payload = JSON.stringify(playerList);
    expect(payload).not.toContain(PREP);                            // the revealed session's own prep
    expect(payload).not.toContain("Strahd attends the ball");       // the unrevealed session's prep...
    expect(payload).not.toContain("The ball ended badly.");         // ...and even its recap
    expect(payload).not.toContain(secretId);                        // ...and its id
    expect(payload).not.toContain("Ozy");                           // attendance is GM-only for now

    // The single read is gated identically, and carries the same key set.
    const single = await body(await get(base, `/api/v1/codex/sessions/${shownId}`, PLAYER));
    expect(Object.keys(single.data.session).sort()).toEqual(["id", "realDate", "recap", "sessionNumber"]);
    expect(JSON.stringify(single)).not.toContain(PREP);
    expect((await get(base, `/api/v1/codex/sessions/${secretId}`, PLAYER)).status).toBe(404);
    expect((await get(base, `/api/v1/codex/sessions/${secretId}`, GM)).status).toBe(200);
  });

  it("returns the active session id to the GM and never to a player", async () => {
    const { base } = await fixture();
    const created = await body(await post(base, "/api/v1/codex/sessions", GM, { sessionNumber: 1, recapBody: "We began." }));
    const sessionId = created.data.session.id as string;
    await post(base, `/api/v1/codex/sessions/${sessionId}/reveal`, GM, { revealed: true });

    expect((await body(await get(base, "/api/v1/codex/sessions", GM))).data.activeSessionId).toBeNull();
    const activated = await post(base, `/api/v1/codex/sessions/${sessionId}/activate`, GM, {});
    expect(activated.status).toBe(200);
    expect((await body(activated)).data.activeSessionId).toBe(sessionId);
    expect((await body(await get(base, "/api/v1/codex/sessions", GM))).data.activeSessionId).toBe(sessionId);

    // The player's copy of the SAME revealed session names no active id. The key stays present so one
    // response shape serves both roles - a key that appears only for the GM is a tell in itself.
    const playerList = await body(await get(base, "/api/v1/codex/sessions", PLAYER));
    expect(playerList.data.sessions).toHaveLength(1);
    expect(playerList.data).toHaveProperty("activeSessionId");
    expect(playerList.data.activeSessionId).toBeNull();
  });

  it("refuses player writes and unauthenticated reads with the right envelopes", async () => {
    const { base } = await fixture();
    const created = await body(await post(base, "/api/v1/codex/sessions", GM, { sessionNumber: 1 }));
    const sessionId = created.data.session.id as string;
    for (const response of [
      await post(base, "/api/v1/codex/sessions", PLAYER, { sessionNumber: 2 }),
      await patch(base, `/api/v1/codex/sessions/${sessionId}`, PLAYER, { prepBody: "mine now" }),
      await post(base, `/api/v1/codex/sessions/${sessionId}/reveal`, PLAYER, { revealed: true }),
      await post(base, `/api/v1/codex/sessions/${sessionId}/activate`, PLAYER, {}),
      await fetch(`${base}/api/v1/codex/sessions/${sessionId}`, { method: "DELETE", headers: PLAYER })
    ]) expect(response.status).toBe(401);
    const noauth = await get(base, "/api/v1/codex/sessions", { "content-type": "application/json" });
    expect(noauth.status).toBe(401);
    expect((await body(noauth)).ok).toBe(false);
    // ...and the record is exactly as the GM left it.
    expect((await body(await get(base, `/api/v1/codex/sessions/${sessionId}`, GM))).data.session.rev).toBe(1);
  });

  it("maps a stale expectedRev to 409 and a duplicate session number to 400", async () => {
    const { base } = await fixture();
    const created = await body(await post(base, "/api/v1/codex/sessions", GM, { sessionNumber: 1 }));
    const sessionId = created.data.session.id as string;
    const stale = await patch(base, `/api/v1/codex/sessions/${sessionId}`, GM, { prepBody: "later", expectedRev: 0 });
    expect(stale.status).toBe(409);
    expect((await body(stale)).error.code).toBe("conflict");

    // A duplicate number is a clean validation failure, not a 500 - the constraint must never crash out.
    const duplicate = await post(base, "/api/v1/codex/sessions", GM, { sessionNumber: 1 });
    expect(duplicate.status).toBe(400);
    const failed = await body(duplicate);
    expect(failed.error.code).toBe("validation_failed");
    expect(failed.error.message).toMatch(/Session 1 already exists/);
  });

  it("deletes idempotently and stops serving the session", async () => {
    const { base } = await fixture();
    const created = await body(await post(base, "/api/v1/codex/sessions", GM, { sessionNumber: 1, recapBody: "We began." }));
    const sessionId = created.data.session.id as string;
    const first = await fetch(`${base}/api/v1/codex/sessions/${sessionId}`, { method: "DELETE", headers: GM });
    expect(first.status).toBe(200);
    expect((await body(first)).data.deleted).toBe(true);
    expect((await fetch(`${base}/api/v1/codex/sessions/${sessionId}`, { method: "DELETE", headers: GM })).status).toBe(200);
    expect((await get(base, `/api/v1/codex/sessions/${sessionId}`, GM)).status).toBe(404);
    expect((await body(await get(base, "/api/v1/codex/sessions", GM))).data.sessions).toHaveLength(0);
  });

  it("files journal entries written during the active session under its number, end to end", async () => {
    const { base } = await fixture();
    // Nothing active: an entry is filed exactly as it was pre-M9.
    const before = await body(await post(base, "/api/v1/codex/journal", GM, { playerText: "Between sessions." }));
    expect(before.data.entry.sessionNumber).toBeNull();

    const created = await body(await post(base, "/api/v1/codex/sessions", GM, { sessionNumber: 12 }));
    await post(base, `/api/v1/codex/sessions/${created.data.session.id}/activate`, GM, {});
    const during = await body(await post(base, "/api/v1/codex/journal", GM, { playerText: "We reached Vallaki." }));
    expect(during.data.entry.sessionNumber).toBe(12);
    // An explicit value still wins over the active session.
    const pinned = await body(await post(base, "/api/v1/codex/journal", GM, { playerText: "A retcon.", sessionNumber: 4 }));
    expect(pinned.data.entry.sessionNumber).toBe(4);
  });

  it("never lets an UNREVEALED session's number ride out on a revealed journal entry", async () => {
    // The live scenario, end to end. The GM opens session 4, leaves it unrevealed and activates it; M9's
    // auto-linking then stamps 4 onto the note written during play. Revealing the NOTE must not publish the
    // SESSION, and the number is the only thing on that entry that could - the same fact the 404 and the
    // nulled `activeSessionId` above are spent hiding.
    const { base } = await fixture();
    const created = await body(await post(base, "/api/v1/codex/sessions", GM, { sessionNumber: 4, prepBody: PREP }));
    const sessionId = created.data.session.id as string;
    await post(base, `/api/v1/codex/sessions/${sessionId}/activate`, GM, {});

    const auto = await body(await post(base, "/api/v1/codex/journal", GM, { playerText: "We reached Vallaki." }));
    const autoId = auto.data.entry.id as string;
    expect(auto.data.entry.sessionNumber).toBe(4);                        // auto-linked, exactly as M9 intends
    // A LEGACY-shaped entry beside it: a number no session record claims, which must be unaffected. Without
    // it a router that simply blanked every number for players would pass this whole test.
    const legacy = await body(await post(base, "/api/v1/codex/journal", GM, { playerText: "Undated lore.", sessionNumber: 9 }));
    const legacyId = legacy.data.entry.id as string;
    for (const id of [autoId, legacyId]) await post(base, `/api/v1/codex/journal/${id}/reveal`, GM, { revealed: true });

    // The session itself is still hidden - the list omits it, the direct read 404s. That is the fact a
    // number on a revealed entry would give away.
    expect((await body(await get(base, "/api/v1/codex/sessions", PLAYER))).data.sessions).toHaveLength(0);
    expect((await get(base, `/api/v1/codex/sessions/${sessionId}`, PLAYER)).status).toBe(404);

    // Both player-reachable reads that carry the field: the journal AND the chronicle.
    const rowsFor = async (headers: Record<string, string>) => {
      const journal = (await body(await get(base, "/api/v1/codex/journal", headers))).data.entries as Json[];
      const timeline = (await body(await get(base, "/api/v1/codex/timeline", headers))).data.records as Json[];
      const find = (rows: Json[], id: string) => rows.find((row) => row.id === id)!;
      return [find(journal, autoId), find(timeline, autoId), find(journal, legacyId), find(timeline, legacyId)];
    };

    const [pJournal, pTimeline, pLegacyJournal, pLegacyTimeline] = await rowsFor(PLAYER);
    expect(pJournal.text).toBe("We reached Vallaki.");                    // the entry itself is readable...
    expect(pJournal.sessionNumber).toBeNull();                            // ...without naming the session
    expect(pTimeline.sessionNumber).toBeNull();
    expect(pLegacyJournal.sessionNumber).toBe(9);                         // nothing legacy changed
    expect(pLegacyTimeline.sessionNumber).toBe(9);

    // The GM's copy of both reads still carries 4, so the nulls above are the gate and not a lost field.
    const [gJournal, gTimeline] = await rowsFor(GM);
    expect(gJournal.sessionNumber).toBe(4);
    expect(gTimeline.sessionNumber).toBe(4);

    // Revealing the SESSION publishes the number on the very same entries - so the nulls are the reveal
    // gate rather than a projection that simply drops the field.
    await post(base, `/api/v1/codex/sessions/${sessionId}/reveal`, GM, { revealed: true });
    const [afterJournal, afterTimeline] = await rowsFor(PLAYER);
    expect(afterJournal.sessionNumber).toBe(4);
    expect(afterTimeline.sessionNumber).toBe(4);
  });
});

/**
 * M10 quests at the HTTP boundary (A-8). A quest is a NEW player-reachable read with the same two-layer
 * shape a session has, plus two things a session does not have: it joins the ONE suite-wide search index,
 * and its `entityIds` point at pages that may themselves be secret.
 *
 * These are the PIPELINE tests. The layers that actually decide are exercised point-blank in
 * `codex-store.test.ts` — "gate 1, with no second line of defence" for the index text, the SQL-visibility
 * describe for `PLAYER_VISIBLE_SQL`, and "the projection layer, on its own" for `projectPlayerQuest` /
 * `projectPlayerSearchHit`. An HTTP test can only ever say the pipeline as a whole behaved, never which
 * layer made it behave, and for search this file has been burned by exactly that before.
 */
describe("codex quests HTTP boundary (M10, A-8)", () => {
  const GM_BODY = "The ledger is a forgery; Strahd burned the real one.";
  const PLAYER_BODY = "Recover the ledger from the counting house.";
  const OBJECTIVES = [{ text: "Find the counting house", done: true }, { text: "Recover the ledger", done: false }];

  it("gives a player the player layer and NEVER the gmBody, and 404s an unrevealed quest", async () => {
    const { base } = await fixture();
    const shown = await body(await post(base, "/api/v1/codex/quests", GM, {
      title: "The Wyrmwood Contract", status: "active", playerBody: PLAYER_BODY, gmBody: GM_BODY, objectives: OBJECTIVES
    }));
    const shownId = shown.data.quest.id as string;
    const secret = await body(await post(base, "/api/v1/codex/quests", GM, {
      title: "The Amber Bargain", playerBody: "Nobody has been told about this.", gmBody: "Vasili is Strahd."
    }));
    const secretId = secret.data.quest.id as string;

    // The GM sees BOTH layers of both quests FIRST — so the player assertions below are the gate working,
    // not an empty payload or a quest with nothing to leak.
    const gmList = await body(await get(base, "/api/v1/codex/quests", GM));
    // Sorted, deliberately: `fixture()` freezes the clock, so two quests share a `created_at` and
    // `listQuests` falls through to its `id` tiebreak — a random uuid. LIST ORDER is asserted in
    // `codex-store.test.ts`, where the clock ticks; here the claim is only that both quests come back.
    expect((gmList.data.quests as Json[]).map((row) => row.title).sort()).toEqual(["The Amber Bargain", "The Wyrmwood Contract"]);
    expect(JSON.stringify(gmList)).toContain(GM_BODY);
    expect(JSON.stringify(gmList)).toContain(PLAYER_BODY);
    expect((gmList.data.quests as Json[]).find((row) => row.id === shownId)!.objectives).toEqual(OBJECTIVES);

    // Unrevealed: the player list is empty and the direct read is a 404, never a 403 — a status code that
    // distinguishes "secret" from "absent" is itself the leak.
    expect((await body(await get(base, "/api/v1/codex/quests", PLAYER))).data.quests).toHaveLength(0);
    expect((await get(base, `/api/v1/codex/quests/${shownId}`, PLAYER)).status).toBe(404);

    await post(base, `/api/v1/codex/quests/${shownId}/reveal`, GM, { revealed: true });
    const playerList = await body(await get(base, "/api/v1/codex/quests", PLAYER));
    const rows = playerList.data.quests as Json[];
    expect(rows).toHaveLength(1);                                   // the still-secret quest is absent
    // The EXACT projected key set: this fails if any new field ever enters the player quest projection,
    // not only if this one leaks. `status` is deliberately PRESENT — "what is still open" is the feature.
    expect(Object.keys(rows[0]).sort()).toEqual(["body", "entityIds", "id", "objectives", "status", "title"]);
    expect(rows[0].body).toBe(PLAYER_BODY);
    expect(rows[0].status).toBe("active");
    expect(rows[0].objectives).toEqual(OBJECTIVES);                 // order and tick state survive the wire

    const payload = JSON.stringify(playerList);
    expect(payload).not.toContain("forgery");                       // the revealed quest's own GM body
    expect(payload).not.toContain("Vasili is Strahd");              // the unrevealed quest's GM body...
    expect(payload).not.toContain("Nobody has been told");          // ...and even its player body
    expect(payload).not.toContain(secretId);                        // ...and its id

    // The single read is gated identically, and carries the same key set.
    const single = await body(await get(base, `/api/v1/codex/quests/${shownId}`, PLAYER));
    expect(Object.keys(single.data.quest).sort()).toEqual(["body", "entityIds", "id", "objectives", "status", "title"]);
    expect(JSON.stringify(single)).not.toContain("forgery");
    expect((await get(base, `/api/v1/codex/quests/${secretId}`, PLAYER)).status).toBe(404);
    expect((await get(base, `/api/v1/codex/quests/${secretId}`, GM)).status).toBe(200);
  });

  it("hands a player only the linked entities that are themselves revealed", async () => {
    const { base } = await fixture();
    const shown = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Vallaki", revealedToPlayers: true }));
    const hidden = await body(await post(base, "/api/v1/codex/pages", GM, { title: "The Amber Temple" }));
    const shownPageId = shown.data.page.id as string, hiddenPageId = hidden.data.page.id as string;
    const quest = await body(await post(base, "/api/v1/codex/quests", GM, { title: "Escort", entityIds: [shownPageId, hiddenPageId] }));
    await post(base, `/api/v1/codex/quests/${quest.data.quest.id}/reveal`, GM, { revealed: true });

    // The GM's copy links both, so the player's filtered list is the projection at work.
    expect((await body(await get(base, `/api/v1/codex/quests/${quest.data.quest.id}`, GM))).data.quest.entityIds).toEqual([shownPageId, hiddenPageId]);
    const playerCopy = await body(await get(base, `/api/v1/codex/quests/${quest.data.quest.id}`, PLAYER));
    expect(playerCopy.data.quest.entityIds).toEqual([shownPageId]);
    // A revealed quest must not advertise the id of a page the party cannot see.
    expect(JSON.stringify(playerCopy)).not.toContain(hiddenPageId);
  });

  it("puts quests in the ONE suite-wide search list, gated end to end", async () => {
    const { base } = await fixture();
    const created = await body(await post(base, "/api/v1/codex/quests", GM, {
      title: "The Wyrmwood Contract", playerBody: PLAYER_BODY, gmBody: GM_BODY, objectives: OBJECTIVES
    }));
    const questId = created.data.quest.id as string;
    const search = async (term: string, headers: Record<string, string>) =>
      (await body(await get(base, `/api/v1/codex/search?q=${term}`, headers))).data.hits as Json[];

    // Unrevealed: the GM finds it, the player does not.
    expect(await search("Wyrmwood", GM)).toEqual([expect.objectContaining({ kind: "quest", id: questId })]);
    expect(await search("Wyrmwood", PLAYER)).toEqual([]);

    await post(base, `/api/v1/codex/quests/${questId}/reveal`, GM, { revealed: true });
    const hits = await search("Wyrmwood", PLAYER);
    expect(hits).toEqual([expect.objectContaining({ kind: "quest", id: questId })]);
    // The same uniform row shape every other kind emits, so nothing branches on key presence. Quests carry
    // no tags at all, hence `[]` rather than a missing key.
    expect(Object.keys(hits[0]).sort()).toEqual(["entityType", "id", "kind", "mapId", "tags", "title"]);
    expect(hits[0].tags).toEqual([]);
    // ...and the GM half of a quest the player legitimately HAS is still unreachable by search.
    expect(await search("forgery", PLAYER)).toEqual([]);
    expect(await search("forgery", GM)).toEqual([expect.objectContaining({ kind: "quest", id: questId })]);
  });

  it("refuses player writes and unauthenticated reads with the right envelopes", async () => {
    const { base } = await fixture();
    const created = await body(await post(base, "/api/v1/codex/quests", GM, { title: "Q" }));
    const questId = created.data.quest.id as string;
    for (const response of [
      await post(base, "/api/v1/codex/quests", PLAYER, { title: "mine" }),
      await patch(base, `/api/v1/codex/quests/${questId}`, PLAYER, { gmBody: "mine now" }),
      await post(base, `/api/v1/codex/quests/${questId}/reveal`, PLAYER, { revealed: true }),
      await fetch(`${base}/api/v1/codex/quests/${questId}`, { method: "DELETE", headers: PLAYER })
    ]) expect(response.status).toBe(401);
    const noauth = await get(base, "/api/v1/codex/quests", { "content-type": "application/json" });
    expect(noauth.status).toBe(401);
    expect((await body(noauth)).ok).toBe(false);
    // ...and the record is exactly as the GM left it.
    expect((await body(await get(base, `/api/v1/codex/quests/${questId}`, GM))).data.quest.rev).toBe(1);
  });

  it("maps a stale expectedRev to 409 and a bad status to 400, and deletes idempotently", async () => {
    const { base } = await fixture();
    const created = await body(await post(base, "/api/v1/codex/quests", GM, { title: "Q" }));
    const questId = created.data.quest.id as string;
    const stale = await patch(base, `/api/v1/codex/quests/${questId}`, GM, { gmBody: "later", expectedRev: 0 });
    expect(stale.status).toBe(409);
    expect((await body(stale)).error.code).toBe("conflict");

    const bad = await post(base, "/api/v1/codex/quests", GM, { title: "Q", status: "abandoned" });
    expect(bad.status).toBe(400);
    expect((await body(bad)).error.code).toBe("validation_failed");

    const first = await fetch(`${base}/api/v1/codex/quests/${questId}`, { method: "DELETE", headers: GM });
    expect(first.status).toBe(200);
    expect((await fetch(`${base}/api/v1/codex/quests/${questId}`, { method: "DELETE", headers: GM })).status).toBe(200);
    expect((await get(base, `/api/v1/codex/quests/${questId}`, GM)).status).toBe(404);
  });

  it("round-trips objective ORDER through the API, including a reorder", async () => {
    const { base } = await fixture();
    const created = await body(await post(base, "/api/v1/codex/quests", GM, { title: "Order", objectives: OBJECTIVES }));
    const questId = created.data.quest.id as string;
    expect(created.data.quest.objectives).toEqual(OBJECTIVES);

    const reordered = [OBJECTIVES[1], { text: "A newly inserted step", done: false }, OBJECTIVES[0]];
    const updated = await body(await patch(base, `/api/v1/codex/quests/${questId}`, GM, { objectives: reordered, expectedRev: 1 }));
    expect(updated.data.quest.objectives).toEqual(reordered);
    expect((await body(await get(base, `/api/v1/codex/quests/${questId}`, GM))).data.quest.objectives).toEqual(reordered);
  });
});

/**
 * The route/contract mount check the codex surface has never had. Homebrew has one; this file, until now,
 * imported `@vtt/api-contract` nowhere at all, so a route added to `codex-http.ts` without a matching
 * `CODEX_PATHS` entry (or the reverse) was caught by nothing. `packages/api-contract`'s own tests compare
 * `CODEX_PATHS` to `openApiDocument.paths` - both inside that package - so they prove the document is
 * self-consistent, never that the server actually serves it.
 *
 * **Why this introspects the router instead of probing over HTTP.** The homebrew version sends a request
 * per declared path and asserts the router's own headers came back, on the stated reasoning that "a
 * request that falls THROUGH the router never gets the router's own headers". That reasoning does not
 * hold: `router.use(...)` there and here is declared with no path, and the router is mounted with a bare
 * `app.use(router)`, so the header middleware runs for EVERY request reaching the app. Measured, not
 * assumed - `GET /completely/unrelated/path` comes back 404 carrying both `x-request-id` and
 * `cache-control: no-store`. That loop therefore passes for any string whatsoever and proves nothing
 * about mounting. Reading Express's route table is exact instead: it is the set of routes that were
 * really registered, so a documented-but-unmounted path cannot hide in it.
 */
/**
 * M11 (CT-5 / CT-10), at the HTTP boundary. These assert on the SERIALIZED RESPONSE BODY rather than on a
 * projection's return value, deliberately: the M6 lesson is that a gate at one layer can be masked by a gate
 * at another, so the end-to-end read has to be checked where the bytes actually leave the process. The
 * projection half lives in `codex-projections.test.ts` and the store half in `codex-store.test.ts`.
 */
describe("codex deadlines, downtime and the prep clock, HTTP boundary (M11, A-8)", () => {
  const calendar = async (base: string, headers: Record<string, string>) =>
    (await body(await get(base, "/api/v1/codex/calendar", headers))).data.calendar as Json;
  const chronicleRaw = async (base: string, headers: Record<string, string>) =>
    (await body(await get(base, "/api/v1/codex/timeline", headers))).data.records as Json[];
  const WORLD = { yearName: "DR", months: [{ name: "Hammer", days: 30 }, { name: "Alturiak", days: 30 }], weekdays: ["First", "Second"] };

  /**
   * T-11, first half. The GM runs their clock to Alturiak 20 having published only Hammer 10 - two DIFFERENT
   * dates on purpose, because with them equal a route that returned the GM's clock would pass anyway.
   */
  it("gives a player the PUBLISHED date while the GM's clock is ahead of it", async () => {
    const { base } = await fixture();
    await put(base, "/api/v1/codex/calendar", GM, { ...WORLD, currentDate: { year: 1492, month: 0, day: 10 } });
    await post(base, "/api/v1/codex/calendar/publish", GM, {});
    // ...and now the GM runs ahead while prepping. Publishing is a separate act and this is not it.
    await put(base, "/api/v1/codex/calendar", GM, { ...WORLD, currentDate: { year: 1492, month: 1, day: 20 } });

    const gmCalendar = await calendar(base, GM);
    expect(gmCalendar.currentDate).toEqual({ year: 1492, month: 1, day: 20 });
    expect(gmCalendar.publishedDate).toEqual({ year: 1492, month: 0, day: 10 });

    const playerCalendar = await calendar(base, PLAYER);
    expect(playerCalendar.currentDate).toEqual({ year: 1492, month: 0, day: 10 });
    // On the serialized body: the GM's clock parts (month 1, day 20) are nowhere in what the player received,
    // under any key, and neither is the `publishedDate` key that would duplicate their own `currentDate`.
    expect(Object.keys(playerCalendar).sort()).toEqual(["currentDate", "months", "weekdays", "yearName"]);
    expect(JSON.stringify(playerCalendar.currentDate)).not.toContain("20");

    // Publishing catches the party up, through the one route that does it.
    await post(base, "/api/v1/codex/calendar/publish", GM, {});
    expect((await calendar(base, PLAYER)).currentDate).toEqual({ year: 1492, month: 1, day: 20 });
  });

  /** T-11, second half: neither new kind reaches a player's chronicle until the ordinary reveal switch is thrown. */
  it("never puts an unrevealed deadline or downtime on a player's chronicle, and puts a revealed one there", async () => {
    const { base } = await fixture();
    await put(base, "/api/v1/codex/calendar", GM, { ...WORLD, currentDate: { year: 1492, month: 0, day: 10 } });
    const deadline = (await body(await post(base, "/api/v1/codex/journal/deadline", GM, {
      playerText: "The duke's tax falls due.", gmText: "He will send the guard.", inWorldDate: { year: 1492, month: 0, day: 20 }
    }))).data.entry as Json;
    const downtime = (await body(await post(base, "/api/v1/codex/journal/downtime", GM, {
      playerText: "A quiet week.", gmText: "The cult moves while they rest.", downtime: { who: "Brannor", activity: "Forging a blade", days: 8 }
    }))).data.entry as Json;

    // The GM sees both, with both layers - so the player assertions are the gate working, not an empty list.
    const gmPayload = JSON.stringify(await chronicleRaw(base, GM));
    expect(gmPayload).toContain("He will send the guard.");
    expect(gmPayload).toContain("Forging a blade");

    const hiddenPayload = JSON.stringify(await chronicleRaw(base, PLAYER));
    expect(hiddenPayload).not.toContain("The duke's tax falls due.");
    expect(hiddenPayload).not.toContain("A quiet week.");
    expect(hiddenPayload).not.toContain("Forging a blade");
    expect(hiddenPayload).not.toContain("He will send the guard.");

    // O-2: the ORDINARY reveal route publishes them - there is no kind-specific one - and then they are as
    // visible as any other revealed record, kind and all.
    for (const id of [deadline.id, downtime.id]) expect((await post(base, `/api/v1/codex/journal/${id}/reveal`, GM, { revealed: true })).status).toBe(200);
    const shown = await chronicleRaw(base, PLAYER);
    expect(shown.map((row) => row.kind).sort()).toEqual(["deadline", "downtime"]);
    const shownPayload = JSON.stringify(shown);
    expect(shownPayload).toContain("The duke's tax falls due.");
    expect(shownPayload).toContain("Forging a blade");
    // ...but still never the GM layer, and never `applied`.
    expect(shownPayload).not.toContain("He will send the guard.");
    expect(shownPayload).not.toContain("applied");
    expect(shownPayload).not.toContain("proposedDate");
    expect(shown.find((row) => row.kind === "downtime")!.payload).toEqual({ who: "Brannor", activity: "Forging a blade", days: 8 });
  });

  /**
   * T-11's third strand and the one a store-level test cannot cover: `fired` is a single bit, and computing a
   * player's copy from the GM's clock would use it to announce that a date the party has never been shown has
   * already gone by. The deadline is Hammer 20; published is Hammer 10; the GM's clock is Alturiak 20.
   */
  it("computes a player's `fired` from the published clock, not the GM's, end to end", async () => {
    const { base } = await fixture();
    await put(base, "/api/v1/codex/calendar", GM, { ...WORLD, currentDate: { year: 1492, month: 0, day: 10 } });
    await post(base, "/api/v1/codex/calendar/publish", GM, {});
    const deadline = (await body(await post(base, "/api/v1/codex/journal/deadline", GM, {
      playerText: "The duke's tax falls due.", revealedToPlayers: true, inWorldDate: { year: 1492, month: 0, day: 20 }
    }))).data.entry as Json;
    await put(base, "/api/v1/codex/calendar", GM, { ...WORLD, currentDate: { year: 1492, month: 1, day: 20 } });

    const gmRow = (await chronicleRaw(base, GM)).find((row) => row.id === deadline.id)!;
    const playerRow = (await chronicleRaw(base, PLAYER)).find((row) => row.id === deadline.id)!;
    expect(gmRow.fired).toBe(true);       // the GM's clock is past it
    expect(playerRow.fired).toBe(false);  // the party's is not, and their row must say so

    await post(base, "/api/v1/codex/calendar/publish", GM, {});
    expect((await chronicleRaw(base, PLAYER)).find((row) => row.id === deadline.id)!.fired).toBe(true);
  });

  /** T-12: confirming a clock move is a GM act. A player cannot reach it, and neither can an anonymous caller. */
  it("refuses apply-downtime, deadline/downtime creation and publish to a player and to an anonymous caller", async () => {
    const { base } = await fixture();
    await put(base, "/api/v1/codex/calendar", GM, { ...WORLD, currentDate: { year: 1492, month: 0, day: 10 } });
    const downtime = (await body(await post(base, "/api/v1/codex/journal/downtime", GM, { downtime: { who: "Brannor", activity: "Forging", days: 8 } }))).data.entry as Json;

    for (const headers of [PLAYER, { "content-type": "application/json" }]) {
      for (const path of ["/api/v1/codex/journal/deadline", "/api/v1/codex/journal/downtime", "/api/v1/codex/calendar/publish", `/api/v1/codex/journal/${downtime.id}/apply-downtime`]) {
        const response = await post(base, path, headers, { downtime: { who: "x", activity: "y", days: 1 }, inWorldDate: { year: 1492, month: 0, day: 1 } });
        expect(response.status, `${path}`).toBe(401);
        expect((await body(response)).error.code).toBe("unauthenticated");
      }
    }
    // ...and none of those refusals moved anything.
    expect((await calendar(base, GM)).currentDate).toEqual({ year: 1492, month: 0, day: 10 });
  });

  /**
   * O-3 end to end: create proposes, confirm applies, and confirming twice is refused. The clock is checked
   * after every step, because "did not move" is the assertion that matters on two of the three.
   */
  it("proposes a date on create, moves the clock only on confirm, and refuses a second confirm", async () => {
    const { base } = await fixture();
    await put(base, "/api/v1/codex/calendar", GM, { ...WORLD, currentDate: { year: 1492, month: 0, day: 10 } });
    const created = (await body(await post(base, "/api/v1/codex/journal/downtime", GM, { playerText: "A quiet week.", downtime: { who: "Brannor", activity: "Forging", days: 8 } }))).data as Json;
    expect(created.proposedDate).toEqual({ year: 1492, month: 0, day: 18 });
    expect((await calendar(base, GM)).currentDate).toEqual({ year: 1492, month: 0, day: 10 });   // nothing moved

    const applied = await post(base, `/api/v1/codex/journal/${created.entry.id}/apply-downtime`, GM, {});
    expect(applied.status).toBe(200);
    expect((await body(applied)).data.calendar.currentDate).toEqual({ year: 1492, month: 0, day: 18 });
    expect((await calendar(base, GM)).currentDate).toEqual({ year: 1492, month: 0, day: 18 });
    // Applying moved the GM's clock and NOT the party's - only publish does that (D11-H). The party is on
    // the FIRST date this codex was given, which publishes itself; every move after that one is private,
    // and applying downtime is such a move. Asserting the party is on day 10 rather than merely "not day
    // 18" is the stronger claim: it proves the two clocks diverged, not just that one of them is empty.
    expect((await calendar(base, PLAYER)).currentDate).toEqual({ year: 1492, month: 0, day: 10 });

    const again = await post(base, `/api/v1/codex/journal/${created.entry.id}/apply-downtime`, GM, {});
    expect([400, 409]).toContain(again.status);
    expect((await calendar(base, GM)).currentDate).toEqual({ year: 1492, month: 0, day: 18 });   // and still nothing moved
  });

  /**
   * The write schema is applied on the new routes at all - which is what `.strict()` proves, because an
   * unknown key is the one rejection ONLY this layer performs (the store ignores input keys it does not read).
   *
   * The undated-deadline assertion beside it is deliberately defence in depth rather than a proof of this
   * layer: `createDeadline` refuses it too, so removing `DeadlineCreateSchema`'s required date leaves this
   * green. That is the intended arrangement (the router is the early rejection, the store is the enforcer),
   * and it is stated here so a later reader does not mistake this for a test of the schema alone.
   */
  it("parses deadline and downtime bodies through their own schemas, and refuses an undated deadline", async () => {
    const { base } = await fixture();
    const dated = { year: 1492, month: 0, day: 20 };
    for (const [path, payload] of [
      ["/api/v1/codex/journal/deadline", { playerText: "Someday." }],                                            // no date at all
      ["/api/v1/codex/journal/deadline", { playerText: "Someday.", inWorldDate: null }],                         // an explicit null is not a date
      ["/api/v1/codex/journal/deadline", { playerText: "x", inWorldDate: dated, kind: "deadline" }],             // .strict(): the route names the kind, not the body
      ["/api/v1/codex/journal/downtime", { downtime: { who: "B", activity: "F", days: 8 }, applied: true }],     // .strict(): `applied` is never an input (O-3)
      ["/api/v1/codex/journal/downtime", { downtime: { who: "B", activity: "F", days: 8, applied: true } }],     // ...nor inside the payload
      ["/api/v1/codex/journal/downtime", { downtime: { who: "B", activity: "F", days: -1 } }]                    // days is a count, not a rewind
    ] as const) {
      const response = await post(base, path, GM, payload);
      expect(response.status, `${path} ${JSON.stringify(payload)}`).toBe(400);
      expect((await body(response)).error.code).toBe("validation_failed");
    }
  });

  /**
   * Every downtime body the COMPOSER can actually produce is accepted.
   *
   * The composer arms its submit on prose OR who OR activity (`JournalView`'s `canSubmit`), so all three
   * rows below are one click away in the UI. A `.min(1)` on `who`/`activity` made the first two fail with
   * a raw "String must contain at least 1 character(s)" - and neither suite could see it, because the
   * client tests mock the server and the server tests write their own bodies. Found by driving the real
   * route with the body the composer builds; this test is that probe, kept.
   *
   * Party-wide downtime with nobody in particular to name is the normal case, not a degenerate one.
   */
  it("accepts every downtime body the composer can produce, including a blank who or activity", async () => {
    const { base } = await fixture();
    for (const payload of [
      { playerText: "The party rests a week.", downtime: { who: "", activity: "", days: 7 } },   // prose only
      { playerText: "", downtime: { who: "Brannor", activity: "Forging", days: 8 } },            // fields only
      { playerText: "A quiet week.", downtime: { who: "Brannor", activity: "", days: 3 } }       // one half blank
    ]) {
      const response = await post(base, "/api/v1/codex/journal/downtime", GM, payload);
      expect(response.status, JSON.stringify(payload)).toBe(201);
      expect((await body(response)).data.entry.kind).toBe("downtime");
    }
  });
});

describe("Codex routes vs the published contract", () => {
  const mountedRoutes = async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-codex-mount-"));
    const store = new CodexStore(join(directory, "vtt.sqlite"));
    const assets = new MapAssetStore(join(directory, "codex-assets"));
    await store.initialize(); await assets.initialize();
    cleanups.push(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
    const router = createCodexRouter({
      store, assets, authorizeGm: (token) => token === "gm-token", authorizePlayer: () => false,
      notifyChanged: () => {}, issuePreviewSession: () => PREVIEW_TOKEN
    }) as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> };
    const byPath = new Map<string, Set<string>>();
    for (const layer of router.stack) {
      if (!layer.route) continue;
      // Express names a parameter `:id`; OpenAPI writes `{id}`. Same path, two spellings.
      const path = layer.route.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
      const methods = byPath.get(path) ?? new Set<string>();
      for (const [method, on] of Object.entries(layer.route.methods)) if (on) methods.add(method.toLowerCase());
      byPath.set(path, methods);
    }
    return byPath;
  };

  it("mounts exactly the codex paths the contract declares", async () => {
    const mounted = await mountedRoutes();
    // `/api/v1/codex-assets` also starts with "/api/v1/codex", which is why the declared set is the union
    // of both constants rather than a prefix filter over one of them.
    const declared = [...Object.values(CODEX_PATHS), ...Object.values(CODEX_ASSET_PATHS)];
    expect([...mounted.keys()].sort()).toEqual([...declared].sort());
    // ...and the document agrees with the constants, so the three-way tie is closed.
    expect(Object.keys(openApiDocument.paths).filter((path) => path.startsWith("/api/v1/codex")).sort())
      .toEqual([...declared].sort());
  });

  it("mounts exactly the METHODS the contract declares on each codex path", async () => {
    const mounted = await mountedRoutes();
    const documented = (path: string) => Object.keys((openApiDocument.paths as Record<string, Record<string, unknown>>)[path] ?? {})
      .filter((key) => ["get", "post", "patch", "put", "delete"].includes(key)).sort();
    for (const [path, methods] of mounted) {
      // A path-level match is not enough: `PATCH /codex/sessions/{id}` could be mounted while the contract
      // documented only GET, and the path-set assertion above would still pass.
      expect([...methods].sort(), `${path} methods`).toEqual(documented(path));
    }
  });
});

/**
 * M12 (CT-6 standing, CT-7 party marker, CT-8 milestones, CT-9 reveal audit) at the HTTP boundary. These
 * assert on the SERIALIZED RESPONSE BODY rather than on a projection's return value, deliberately: the M6
 * lesson is that a gate at one layer can be masked by a gate at another, so the end-to-end read has to be
 * checked where the bytes actually leave the process. The projection half lives in
 * `codex-projections.test.ts` and the store half in `codex-store.test.ts`; all three are needed.
 */
describe("codex standing, party marker and reveal audit, HTTP boundary (M12, A-8)", () => {
  const faction = async (base: string, title: string, revealed: boolean) => {
    const page = await body(await post(base, "/api/v1/codex/pages", GM, { title, entityType: "faction" }));
    const id = page.data.page.id as string;
    if (revealed) await post(base, `/api/v1/codex/pages/${id}/reveal`, GM, { revealed: true });
    return id;
  };
  const makeMap = async (base: string, name: string, revealed: boolean) => {
    const map = await body(await post(base, "/api/v1/codex/maps", GM, { assetId: randomUUID(), name, kind: "regional" }));
    const id = map.data.map.id as string;
    if (revealed) await post(base, `/api/v1/codex/maps/${id}/reveal`, GM, { revealed: true });
    return id;
  };
  const makeMarker = async (base: string, mapId: string, label: string, revealed: boolean) => {
    const marker = await body(await post(base, `/api/v1/codex/maps/${mapId}/markers`, GM, { x: 0.5, y: 0.5, iconId: "pin", iconColor: "#ff2e9a", label, revealedToPlayers: revealed }));
    return marker.data.marker.id as string;
  };

  /**
   * T-8. Two independent claims in one scenario, each of them the thing a projection break would show up in:
   * a player's standing list carries ONLY what they may see, and a party pin on a hidden map is still hidden
   * however loudly it is flagged.
   */
  it("gives a player only revealed standing, and keeps a party pin on a hidden map hidden", async () => {
    const { base } = await fixture();
    const shownFaction = await faction(base, "The Harpers", true);
    const secretFaction = await faction(base, "The Zhentarim", true);
    await put(base, `/api/v1/codex/standing/${shownFaction}`, GM, { value: -40, reason: "Killed their envoy" });
    await put(base, `/api/v1/codex/standing/${secretFaction}`, GM, { value: 70, reason: "Paid the toll" });
    await post(base, `/api/v1/codex/standing/${shownFaction}/reveal`, GM, { revealed: true });

    // The GM sees both FIRST, so the player assertions below are the gate working, not an empty payload.
    const gmStanding = (await body(await get(base, "/api/v1/codex/standing", GM))).data.standing as Json[];
    expect(gmStanding.map((row) => row.value).sort((a, b) => a - b)).toEqual([-40, 70]);

    const playerStanding = (await body(await get(base, "/api/v1/codex/standing", PLAYER))).data.standing as Json[];
    expect(playerStanding).toHaveLength(1);
    expect(playerStanding[0].factionPageId).toBe(shownFaction);
    expect(playerStanding[0].value).toBe(-40);                      // the signed value survives the wire
    // The EXACT key set on the serialized row: this fails if any new field enters the player projection.
    expect(Object.keys(playerStanding[0]).sort()).toEqual(["factionPageId", "value"]);
    const standingPayload = JSON.stringify(playerStanding);
    expect(standingPayload).not.toContain(secretFaction);           // the unrevealed standing's faction...
    expect(standingPayload).not.toContain("70");                    // ...and its value
    expect(standingPayload).not.toContain("revealedToPlayers");

    // CT-7 / CD-6: the party pin, revealed, on a HIDDEN map.
    const secretMap = await makeMap(base, "The Under-dark", false);
    const shownMap = await makeMap(base, "Barovia", true);
    const hiddenParty = await makeMarker(base, secretMap, "The party", true);
    await put(base, `/api/v1/codex/markers/${hiddenParty}/party`, GM, { isParty: true });

    // The GM's own read has it, flagged - so the player's 404 below is the gate and not a missing record.
    const gmMarkers = (await body(await get(base, `/api/v1/codex/maps/${secretMap}/markers`, GM))).data.markers as Json[];
    expect(gmMarkers[0].isParty).toBe(true);
    // A player cannot even ask about that map, so the party pin is unreachable.
    expect((await get(base, `/api/v1/codex/maps/${secretMap}/markers`, PLAYER)).status).toBe(404);
    expect(JSON.stringify(await body(await get(base, "/api/v1/codex/maps", PLAYER)))).not.toContain(secretMap);

    // Move the party to a pin on a map the party CAN see: now it travels, with `isParty` and nothing else new.
    const shownPin = await makeMarker(base, shownMap, "Camp", true);
    await put(base, `/api/v1/codex/markers/${shownPin}/party`, GM, { isParty: true });
    const playerMarkers = (await body(await get(base, `/api/v1/codex/maps/${shownMap}/markers`, PLAYER))).data.markers as Json[];
    expect(playerMarkers).toHaveLength(1);
    expect(playerMarkers[0].isParty).toBe(true);
    expect(Object.keys(playerMarkers[0]).sort()).toEqual(["iconColor", "iconId", "id", "isParty", "label", "mapId", "pageIds", "subMapId", "tags", "x", "y"]);

    // M12-C: one party pin atlas-wide - flagging the new one cleared the old, with no second call.
    expect((await body(await get(base, `/api/v1/codex/maps/${secretMap}/markers`, GM))).data.markers[0].isParty).toBe(false);
  });

  /**
   * M12-C's other half. Turning the flag OFF is scoped to the pin it was sent to: `setPartyMarker(null)`
   * clears whichever pin currently holds it, so calling it unconditionally would unset a DIFFERENT party pin
   * whenever the GM switched off a marker that was never the party - a bug with no visible cause at the table.
   */
  it("clears the party flag from the pin it was sent to, and never from a different one", async () => {
    const { base } = await fixture();
    const mapId = await makeMap(base, "Barovia", true);
    const partyPin = await makeMarker(base, mapId, "The party", true);
    const otherPin = await makeMarker(base, mapId, "The ambush", true);
    await put(base, `/api/v1/codex/markers/${partyPin}/party`, GM, { isParty: true });

    const cleared = await put(base, `/api/v1/codex/markers/${otherPin}/party`, GM, { isParty: false });
    expect(cleared.status).toBe(200);
    expect((await body(cleared)).data.marker.isParty).toBe(false);
    const markers = (await body(await get(base, `/api/v1/codex/maps/${mapId}/markers`, GM))).data.markers as Json[];
    expect(markers.filter((row) => row.isParty).map((row) => row.id)).toEqual([partyPin]);

    // ...and sent to the party pin itself, it does clear it, leaving no party pin at all.
    await put(base, `/api/v1/codex/markers/${partyPin}/party`, GM, { isParty: false });
    expect(((await body(await get(base, `/api/v1/codex/maps/${mapId}/markers`, GM))).data.markers as Json[]).filter((row) => row.isParty)).toHaveLength(0);
    // An unknown marker is a 404, not a silent no-op that clears the flag from somewhere else.
    expect((await put(base, `/api/v1/codex/markers/${randomUUID()}/party`, GM, { isParty: false })).status).toBe(404);
  });

  /** T-9: the audit is a GM surface. A player is refused, and so is an anonymous caller. */
  it("refuses the reveal audit to a player and to an anonymous caller", async () => {
    const { base } = await fixture();
    for (const headers of [PLAYER, { "content-type": "application/json" }]) {
      const response = await get(base, "/api/v1/codex/reveal-audit", headers);
      expect(response.status).toBe(401);
      expect((await body(response)).error.code).toBe("unauthenticated");
    }
    expect((await get(base, "/api/v1/codex/reveal-audit", GM)).status).toBe(200);
  });

  /**
   * T-10, and the most important test in this milestone: **the audit's counts and ids must match what the
   * player-facing endpoints actually return, for every record type.** That is what proves CT-9 is an
   * aggregation of the existing projections rather than a second opinion about visibility.
   *
   * Every category therefore gets three records - one revealed, one not, and (where the kind has a second
   * gate) one that is flagged revealed but which the party still cannot see. That third case is the one an
   * audit written against `revealed = 1` gets wrong, and it is why the comparison is against REAL player
   * reads rather than against numbers typed into this test.
   */
  it("matches the real player reads exactly, for every record type", async () => {
    const { base } = await fixture();

    // Pages: one revealed, one not. (The faction pages below add two more revealed pages.)
    const shownPage = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Vallaki", revealedToPlayers: true }));
    await post(base, "/api/v1/codex/pages", GM, { title: "The Amber Temple" });

    // Maps: one revealed, one not.
    const shownMap = await makeMap(base, "Barovia", true);
    const secretMap = await makeMap(base, "The Amber Vaults", false);

    // Markers: one revealed on the revealed map, one unrevealed on it, and one REVEALED on the SECRET map -
    // the case that separates "flagged revealed" from "the party can see it".
    const shownMarker = await makeMarker(base, shownMap, "Camp", true);
    await makeMarker(base, shownMap, "The ambush", false);
    await makeMarker(base, secretMap, "The vault door", true);

    // Journal: one revealed note, one hidden, plus a milestone (CT-8) revealed through the ORDINARY route.
    const shownEntry = await body(await post(base, "/api/v1/codex/journal", GM, { playerText: "They reached the gate.", revealedToPlayers: true }));
    await post(base, "/api/v1/codex/journal", GM, { playerText: "The cult moves." });
    const milestone = await body(await post(base, "/api/v1/codex/journal/milestone", GM, { playerText: "Level up.", milestone: { level: 5, reason: "Cleared the crypt" } }));
    expect(milestone.data.entry.kind).toBe("milestone");
    await post(base, `/api/v1/codex/journal/${milestone.data.entry.id}/reveal`, GM, { revealed: true });

    // Sessions and quests: one revealed each, one not.
    const shownSession = await body(await post(base, "/api/v1/codex/sessions", GM, { sessionNumber: 4, recapBody: "They reached the gate.", revealedToPlayers: true }));
    await post(base, "/api/v1/codex/sessions", GM, { sessionNumber: 5, prepBody: "The ambush." });
    const shownQuest = await body(await post(base, "/api/v1/codex/quests", GM, { title: "The Wyrmwood Contract" }));
    await post(base, `/api/v1/codex/quests/${shownQuest.data.quest.id}/reveal`, GM, { revealed: true });
    await post(base, "/api/v1/codex/quests", GM, { title: "The Amber Bargain" });

    // Standing: one revealed on a revealed faction, one revealed on a SECRET faction (the second gate), and
    // one not revealed at all.
    const shownFaction = await faction(base, "The Harpers", true);
    const secretFaction = await faction(base, "The Zhentarim", false);
    const quietFaction = await faction(base, "The Emerald Enclave", true);
    for (const [id, value] of [[shownFaction, -40], [secretFaction, 70], [quietFaction, 10]] as const) {
      await put(base, `/api/v1/codex/standing/${id}`, GM, { value, reason: "Because" });
    }
    await post(base, `/api/v1/codex/standing/${shownFaction}/reveal`, GM, { revealed: true });
    await post(base, `/api/v1/codex/standing/${secretFaction}/reveal`, GM, { revealed: true });

    // ---- what the audit says ----
    const audit = (await body(await get(base, "/api/v1/codex/reveal-audit", GM))).data.audit as Json;
    const section = (kind: string) => (audit.sections as Json[]).find((entry) => entry.kind === kind)!;
    const auditIds = (kind: string) => (section(kind).rows as Json[]).map((row) => row.id as string).sort();

    // ---- what a player actually receives ----
    const playerPages = (await body(await get(base, "/api/v1/codex/pages", PLAYER))).data.pages as Json[];
    const playerMaps = (await body(await get(base, "/api/v1/codex/maps", PLAYER))).data.maps as Json[];
    const playerMarkers: Json[] = [];
    for (const map of playerMaps) playerMarkers.push(...((await body(await get(base, `/api/v1/codex/maps/${map.id}/markers`, PLAYER))).data.markers as Json[]));
    const playerEntries = (await body(await get(base, "/api/v1/codex/journal", PLAYER))).data.entries as Json[];
    const playerSessions = (await body(await get(base, "/api/v1/codex/sessions", PLAYER))).data.sessions as Json[];
    const playerQuests = (await body(await get(base, "/api/v1/codex/quests", PLAYER))).data.quests as Json[];
    const playerStanding = (await body(await get(base, "/api/v1/codex/standing", PLAYER))).data.standing as Json[];

    const ids = (rows: Json[], key = "id") => rows.map((row) => row[key] as string).sort();
    for (const [kind, rows, key] of [
      ["page", playerPages, "id"], ["map", playerMaps, "id"], ["marker", playerMarkers, "id"],
      ["journal", playerEntries, "id"], ["session", playerSessions, "id"], ["quest", playerQuests, "id"],
      // A standing row is addressed by its FACTION page id - which is what its reveal route takes.
      ["standing", playerStanding, "factionPageId"]
    ] as const) {
      expect(section(kind).revealed, `${kind} count`).toBe(rows.length);
      expect(auditIds(kind), `${kind} ids`).toEqual(ids(rows as Json[], key));
      // Non-vacuous: every category really does have something in it, so no line above is 0 === 0.
      expect(section(kind).revealed, `${kind} must not be empty`).toBeGreaterThan(0);
    }

    // The three cases an audit built on the raw reveal flag gets WRONG, stated explicitly so a regression
    // reads as the specific mistake it is rather than as an off-by-one:
    //   a revealed pin on a secret map is not visible...
    expect(section("marker").total).toBe(3);
    expect(section("marker").revealed).toBe(1);
    expect(auditIds("marker")).toEqual([shownMarker]);
    //   ...and a revealed standing on a secret faction is not visible either.
    expect(section("standing").total).toBe(3);
    expect(section("standing").revealed).toBe(1);
    expect(auditIds("standing")).toEqual([shownFaction]);
    expect(JSON.stringify(audit)).not.toContain(secretFaction);

    // Totals are the whole codex, and the rows name records the party can genuinely read.
    expect(section("journal").revealed).toBe(2);                       // the note and the revealed milestone
    expect(auditIds("journal")).toEqual([milestone.data.entry.id, shownEntry.data.entry.id].sort());
    expect((section("page").rows as Json[]).map((row) => row.title)).toContain("Vallaki");
    expect((section("session").rows as Json[])[0].title).toBe("Session 4");
    expect(audit.revealed).toBe((audit.sections as Json[]).reduce((count, entry) => count + (entry.revealed as number), 0));
    expect(shownPage.data.page.id).toBeTruthy();
    expect(shownSession.data.session.id).toBeTruthy();
  });

  /** Un-revealing from the audit is the EXISTING per-kind route - M12 adds no unreveal verb and no bulk one. */
  it("drops a record from the audit when the GM un-reveals it through that kind's own reveal route", async () => {
    const { base } = await fixture();
    const quest = await body(await post(base, "/api/v1/codex/quests", GM, { title: "The Wyrmwood Contract" }));
    const questId = quest.data.quest.id as string;
    await post(base, `/api/v1/codex/quests/${questId}/reveal`, GM, { revealed: true });
    const auditOf = async () => ((await body(await get(base, "/api/v1/codex/reveal-audit", GM))).data.audit.sections as Json[]).find((entry) => entry.kind === "quest")!;
    expect((await auditOf()).rows).toEqual([{ kind: "quest", id: questId, title: "The Wyrmwood Contract" }]);

    await post(base, `/api/v1/codex/quests/${questId}/reveal`, GM, { revealed: false });
    expect((await auditOf()).revealed).toBe(0);
    expect((await auditOf()).total).toBe(1);                          // still there, just not public
    expect((await body(await get(base, "/api/v1/codex/quests", PLAYER))).data.quests).toHaveLength(0);
  });

  /** T-11's boundary half: the M12 routes are documented with the security they actually enforce. */
  it("documents the M12 routes with the roles they enforce", async () => {
    const paths = openApiDocument.paths as unknown as Record<string, Record<string, { security?: ReadonlyArray<Record<string, readonly string[]>> }>>;
    // The one M12 read a player may make; the audit and every write are GM-only.
    expect(paths[CODEX_PATHS.standing].get.security).toEqual([{ gmAuth: [] }, { playerAuth: [] }]);
    for (const [path, method] of [
      [CODEX_PATHS.revealAudit, "get"], [CODEX_PATHS.standingByFaction, "put"], [CODEX_PATHS.standingReveal, "post"],
      [CODEX_PATHS.journalMilestone, "post"], [CODEX_PATHS.markerParty, "put"]
    ] as const) {
      expect(paths[path][method].security, `${method} ${path}`).toEqual([{ gmAuth: [] }]);
    }
  });

  /**
   * The write schemas are applied at all - which `.strict()` is what proves, because an unknown key is the
   * one rejection ONLY this layer performs (the store ignores input keys it does not read).
   *
   * The missing-payload row beside it is deliberately defence in depth rather than a proof of this layer:
   * `createMilestone` refuses it too, so making `milestone` optional in the schema leaves this green
   * (measured, not assumed). That is the intended arrangement - the router is the early rejection, the store
   * is the enforcer - and it is stated here so a later reader does not mistake it for a test of the schema.
   */
  it("parses the M12 bodies through their own schemas", async () => {
    const { base } = await fixture();
    const factionId = await faction(base, "The Harpers", true);
    const mapId = await makeMap(base, "Barovia", true);
    const markerId = await makeMarker(base, mapId, "Camp", true);
    for (const [method, path, payload] of [
      ["PUT", `/api/v1/codex/standing/${factionId}`, { value: 150 }],                                    // outside the signed scale
      ["PUT", `/api/v1/codex/standing/${factionId}`, { value: 10, revealed: true }],                     // .strict(): reveal is its own route
      ["POST", "/api/v1/codex/journal/milestone", { milestone: { level: 0, reason: "x" } }],             // no character is level 0
      ["POST", "/api/v1/codex/journal/milestone", { milestone: { level: 5 }, kind: "milestone" }],       // .strict(): the route names the kind
      ["POST", "/api/v1/codex/journal/milestone", { playerText: "Level up." }],                          // the payload is required
      ["PUT", `/api/v1/codex/markers/${markerId}/party`, { isParty: "yes" }]                             // a flag, not a string
    ] as const) {
      const response = method === "PUT" ? await put(base, path, GM, payload) : await post(base, path, GM, payload);
      expect(response.status, `${method} ${path} ${JSON.stringify(payload)}`).toBe(400);
      expect((await body(response)).error.code).toBe("validation_failed");
    }
    // ...and the shapes the client actually sends are accepted, including an omitted reason.
    expect((await put(base, `/api/v1/codex/standing/${factionId}`, GM, { value: -40 })).status).toBe(200);
    expect((await post(base, "/api/v1/codex/journal/milestone", GM, { milestone: { level: 5 } })).status).toBe(201);
    // An unknown faction is a 404, not a silently created standing row.
    expect((await put(base, `/api/v1/codex/standing/${randomUUID()}`, GM, { value: 10 })).status).toBe(404);
  });
});
