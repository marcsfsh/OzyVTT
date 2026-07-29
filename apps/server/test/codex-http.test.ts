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
    expect(Object.keys(playerRows[0]).sort())
      .toEqual(["createdAt", "id", "inWorldLabel", "kind", "realDate", "sessionNumber", "tags", "text", "title"]);
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
