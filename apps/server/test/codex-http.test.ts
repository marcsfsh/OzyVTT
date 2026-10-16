import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { CodexStore } from "../src/codex-store.js";
import { MapAssetStore } from "../src/map-assets.js";
import { createCodexRouter } from "../src/codex-http.js";
import { CODEX_ASSET_PATHS, CODEX_PATHS } from "@vtt/api-contract";
import { openApiDocument } from "../src/openapi/document.js";

// HTTP-boundary tests for the codex router, which enforces viewer safety by choosing a GM or player
// projection per role. These confirm the wiring: unrevealed = 404 not 403, gmBody never reaches a
// player, the parent-map and journal-by-attachment reveal gates, the media gate, and the envelopes.

/** The default autosave setting; `PUT /codex/settings` is wholesale, so every body carries it. */
const AUTOSAVE_DEFAULT = { enabled: true, intervalSeconds: 1 } as const;

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function png(width: number, height: number) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

async function fixture(pings?: unknown[][]) {
  const directory = await mkdtemp(join(tmpdir(), "vtt-codex-http-"));
  const store = new CodexStore(join(directory, "vtt.sqlite"), () => Date.parse("2026-07-16T03:00:00.000Z"));
  const assets = new MapAssetStore(join(directory, "codex-assets"));
  await store.initialize();
  await assets.initialize();
  const app = express();
  app.use(express.json());
  app.use(
    createCodexRouter({
      store,
      assets,
      authorizeGm: (token) => token === "gm-token",
      // The preview token is a real player principal, as `auth.issuePreviewPlayerSession()` mints one, so it
      // authorizes as a player and gets the player projection.
      authorizePlayer: (token) => token === "player-token" || token === PREVIEW_TOKEN,
      // Two single-scope credentials, so a verifier that ignored the scope would fail.
      verifyIntegration: (token, scope) => (token === `int-${scope}` ? { id: "cred-1", name: "overlay" } : null),
      // Records arguments, not just calls, so a content-free ping can be told from one carrying a scope word.
      notifyChanged: (...args: unknown[]) => {
        pings?.push(args);
      },
      issuePreviewSession: () => PREVIEW_TOKEN
    })
  );
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Codex test server did not bind.");
  cleanups.push(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${address.port}`, store, assets, directory };
}

const PREVIEW_TOKEN = "preview-player-token";
const GM = { authorization: "Bearer gm-token", "content-type": "application/json" };
const PLAYER = { authorization: "Bearer player-token", "content-type": "application/json" };
/** Integration credentials, one per scope: `codex:write` does not imply `codex:read`. */
const INTEGRATION_READ = { authorization: "Bearer int-codex:read", "content-type": "application/json" };
const INTEGRATION_WRITE = { authorization: "Bearer int-codex:write", "content-type": "application/json" };
type Json = Record<string, any>;
async function body(response: Response) {
  return response.json() as Promise<Json>;
}
const get = (base: string, path: string, headers: Record<string, string>) => fetch(`${base}${path}`, { headers });
const post = (base: string, path: string, headers: Record<string, string>, payload: unknown) =>
  fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(payload) });
const patch = (base: string, path: string, headers: Record<string, string>, payload: unknown) =>
  fetch(`${base}${path}`, { method: "PATCH", headers, body: JSON.stringify(payload) });
const put = (base: string, path: string, headers: Record<string, string>, payload: unknown) =>
  fetch(`${base}${path}`, { method: "PUT", headers, body: JSON.stringify(payload) });
const del = (base: string, path: string, headers: Record<string, string>, payload?: unknown) =>
  fetch(`${base}${path}`, {
    method: "DELETE",
    headers,
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
  });

// The router hands `notifyChanged` no arguments: a scope word on the `codex:changed` ping would tell every
// socket which part of the codex the GM is editing. The socket emit is covered in `realtime-presence.test.ts`.
describe("codex:changed carries no content (router half)", () => {
  it("calls its notifier with no arguments at all, whichever surface was written", async () => {
    const pings: unknown[][] = [];
    const { base, store } = await fixture(pings);
    const page = store.createPage({ title: "Vallaki" });
    const faction = store.createPage({ title: "The Keepers of the Feather", entityType: "faction" });

    await post(base, "/api/v1/codex/pages", GM, { title: "Krezk" });
    await patch(base, `/api/v1/codex/pages/${page.id}`, GM, { playerBody: "a walled town" });
    await post(base, `/api/v1/codex/pages/${page.id}/reveal`, GM, { revealed: true });
    await post(base, "/api/v1/codex/journal", GM, { playerText: "we arrived" });
    await post(base, "/api/v1/codex/sessions", GM, { sessionNumber: 1 });
    await post(base, "/api/v1/codex/quests", GM, { title: "Find the Sunsword" });
    await put(base, `/api/v1/codex/standing/${faction.id}`, GM, { value: 10, reason: "kind words" });

    expect(pings.length, "every one of those writes pinged").toBeGreaterThanOrEqual(7);
    for (const args of pings) expect(args).toEqual([]);
  });
});

describe("codex HTTP viewer-safety boundary", () => {
  it("never exposes a combat entry's replay linkage to a player, even when the entry is revealed", async () => {
    // Encounter archives carry GM-only narration and are unreachable by players, so surfacing replays in
    // the codex must not hand players the archive id that opens one.
    const { base, store } = await fixture();
    const entry = store.appendCombatEntry({ sourceEncounterId: 42, playerText: "A battle was fought here." });
    expect(entry.sourceEncounterId).toBe(42);

    const gmTimeline = await body(await get(base, "/api/v1/codex/journal", GM));
    expect(gmTimeline.data.entries[0].sourceEncounterId).toBe(42);

    await post(base, `/api/v1/codex/journal/${entry.id}/reveal`, GM, { revealed: true });
    const playerTimeline = await body(await get(base, "/api/v1/codex/journal", PLAYER));
    expect(playerTimeline.data.entries).toHaveLength(1);
    // The exact projected key set rather than a substring search for the id (a uuid may contain "42"), so any
    // new field fails here.
    expect(Object.keys(playerTimeline.data.entries[0]).sort()).toEqual([
      "createdAt",
      "id",
      "inWorldLabel",
      "kind",
      "realDate",
      "sessionId",
      "sessionNumber",
      "tags",
      "text"
    ]);
  });

  it("GM preview mints a real player principal and sees byte-identically what a player sees", async () => {
    const { base } = await fixture();
    const shown = await body(
      await post(base, "/api/v1/codex/pages", GM, {
        title: "Bree",
        playerBody: "A crossroads town.",
        gmBody: "A cultist runs the inn."
      })
    );
    const shownId = shown.data.page.id as string;
    await post(base, `/api/v1/codex/pages/${shownId}/reveal`, GM, { revealed: true });
    const secret = await body(
      await post(base, "/api/v1/codex/pages", GM, { title: "The Cult", playerBody: "", gmBody: "Meets under the inn." })
    );
    const secretId = secret.data.page.id as string;

    // Minting is GM-only, and a player is authenticated-and-refused: 403, not 401.
    expect((await post(base, "/api/v1/codex/preview-session", PLAYER, {})).status).toBe(403);
    // Not even a codex:write credential: this route hands out a player session token.
    expect((await post(base, "/api/v1/codex/preview-session", INTEGRATION_WRITE, {})).status).toBe(403);
    const minted = await post(base, "/api/v1/codex/preview-session", GM, {});
    expect(minted.status).toBe(201);
    const token = (await body(minted)).data.token as string;
    expect(token).toBeTruthy();
    const PREVIEW = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    // The preview payload must be identical to a real player's.
    expect(await body(await get(base, "/api/v1/codex/pages", PREVIEW))).toEqual(
      await body(await get(base, "/api/v1/codex/pages", PLAYER))
    );
    expect(await body(await get(base, `/api/v1/codex/pages/${shownId}`, PREVIEW))).toEqual(
      await body(await get(base, `/api/v1/codex/pages/${shownId}`, PLAYER))
    );

    const previewPage = await body(await get(base, `/api/v1/codex/pages/${shownId}`, PREVIEW));
    expect(previewPage.data.page.gmBody).toBeUndefined();
    expect(JSON.stringify(previewPage)).not.toContain("cultist");
    expect((await get(base, `/api/v1/codex/pages/${secretId}`, PREVIEW)).status).toBe(404);

    // The GM token must not be usable as the preview, because `roleOf` resolves it to `gm`.
    const gmPage = await body(await get(base, `/api/v1/codex/pages/${shownId}`, GM));
    expect(gmPage.data.page.gmBody).toBe("A cultist runs the inn.");
    expect(gmPage).not.toEqual(previewPage);
  });

  it("hides gmBody and unrevealed pages from players, but shows the GM everything", async () => {
    const { base } = await fixture();
    const created = await body(
      await post(base, "/api/v1/codex/pages", GM, {
        title: "Bree",
        playerBody: "A crossroads town.",
        gmBody: "A cultist runs the inn."
      })
    );
    const pageId = created.data.page.id as string;

    // Unrevealed: player 404s (not 403, so existence is not inferable); GM sees both bodies.
    expect((await get(base, `/api/v1/codex/pages/${pageId}`, PLAYER)).status).toBe(404);
    const gmView = await body(await get(base, `/api/v1/codex/pages/${pageId}`, GM));
    expect(gmView.data.page.gmBody).toBe("A cultist runs the inn.");

    expect((await body(await get(base, "/api/v1/codex/pages", PLAYER))).data.pages).toHaveLength(0);

    // Reveal: player sees the player body only, never gmBody or rev.
    await post(base, `/api/v1/codex/pages/${pageId}/reveal`, GM, { revealed: true });
    const playerView = await body(await get(base, `/api/v1/codex/pages/${pageId}`, PLAYER));
    expect(playerView.data.page.body).toBe("A crossroads town.");
    expect(playerView.data.page).not.toHaveProperty("gmBody");
    expect(JSON.stringify(playerView)).not.toContain("cultist");
  });

  // 401 means "no credential could be read"; 403 means "your credential may not do this". An
  // authenticated player must never be told to authenticate, since a retrying client acts on that.
  it("rejects player writes with 403 and missing auth with 401", async () => {
    const { base } = await fixture();
    const denied = await post(base, "/api/v1/codex/pages", PLAYER, { title: "Nope" });
    expect(denied.status).toBe(403);
    expect((await body(denied)).error.code).toBe("forbidden");
    const noauth = await get(base, "/api/v1/codex/pages", { "content-type": "application/json" });
    expect(noauth.status).toBe(401);
    const noauthBody = await body(noauth);
    expect(noauthBody.ok).toBe(false);
    expect(noauthBody.error.code).toBe("unauthenticated");
    // A token that was presented and failed is 403 too, never 401.
    const junk = await get(base, "/api/v1/codex/pages", {
      authorization: "Bearer nonsense",
      "content-type": "application/json"
    });
    expect(junk.status).toBe(403);
    expect((await body(junk)).error.code).toBe("forbidden");
  });

  it("returns a 409 conflict envelope on a stale expectedRev", async () => {
    const { base } = await fixture();
    const created = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Keep" }));
    const stale = await patch(base, `/api/v1/codex/pages/${created.data.page.id}`, GM, {
      title: "Keep II",
      expectedRev: 0
    });
    expect(stale.status).toBe(409);
    expect((await body(stale)).error.code).toBe("conflict");
  });

  // A type switch prunes structured fields to the new type, even on a type-only PATCH. The editor shows
  // only the new type's fields, so stale keys could not be seen or deleted yet would ship to players.
  it("prunes entity fields to the new type on an entityType-only PATCH, so nothing is stranded in the player payload", async () => {
    const { base } = await fixture();
    const created = await body(
      await post(base, "/api/v1/codex/pages", GM, {
        title: "Strahd",
        entityType: "character",
        fields: { race: "Vampire", age: "400", status: "undead" },
        gmFields: { goals: "rule Barovia" }
      })
    );
    const pageId = created.data.page.id as string;
    await post(base, `/api/v1/codex/pages/${pageId}/reveal`, GM, { revealed: true });

    const before = await body(await get(base, `/api/v1/codex/pages/${pageId}`, GM));
    expect(before.data.page.fields).toEqual({ race: "Vampire", age: "400", status: "undead" });

    const switched = await patch(base, `/api/v1/codex/pages/${pageId}`, GM, { entityType: "location" });
    expect(switched.status).toBe(200);

    const gmAfter = await body(await get(base, `/api/v1/codex/pages/${pageId}`, GM));
    expect(gmAfter.data.page.entityType).toBe("location");
    expect(gmAfter.data.page.fields).toEqual({}); // no character key survives...
    expect(gmAfter.data.page.gmFields).toEqual({}); // ...on either side of the secrecy line

    // A revealed page must not still carry the old type's values.
    const playerAfter = await body(await get(base, `/api/v1/codex/pages/${pageId}`, PLAYER));
    expect(playerAfter.data.page.fields).toEqual({});
    expect(JSON.stringify(playerAfter)).not.toContain("Vampire");
    expect(JSON.stringify(playerAfter)).not.toContain("undead");

    const revisions = (await body(await get(base, `/api/v1/codex/pages/${pageId}/revisions`, GM))).data
      .revisions as Json[];
    const preSwitch = revisions.find((revision) => (revision as { rev: number }).rev === 1)!;
    const restored = await body(
      await post(base, `/api/v1/codex/pages/${pageId}/revisions/${(preSwitch as { id: number }).id}/restore`, GM, {})
    );
    expect(restored.data.page.entityType).toBe("character");
    expect(restored.data.page.fields).toEqual({ race: "Vampire", age: "400", status: "undead" });
  });

  it("never leaks a hidden parent map's id to a player (revealed child, secret parent)", async () => {
    const { base } = await fixture();
    const asset = randomUUID();
    const world = await body(
      await post(base, "/api/v1/codex/maps", GM, { assetId: asset, name: "World", kind: "world" })
    ); // secret by default
    const worldId = world.data.map.id as string;
    const region = await body(
      await post(base, "/api/v1/codex/maps", GM, {
        assetId: asset,
        name: "Region",
        kind: "regional",
        parentMapId: worldId
      })
    );
    await post(base, `/api/v1/codex/maps/${region.data.map.id}/reveal`, GM, { revealed: true });

    const playerMaps = (await body(await get(base, "/api/v1/codex/maps", PLAYER))).data.maps as Json[];
    expect(playerMaps).toHaveLength(1); // the secret world map is absent
    expect(playerMaps[0].name).toBe("Region");
    expect(playerMaps[0].parentMapId).toBeNull(); // and its secret parent's id is stripped
    expect(JSON.stringify(playerMaps)).not.toContain(worldId);
  });

  it("gates player markers on map + marker + link reveal, and strips scene/actor links", async () => {
    const { base } = await fixture();
    const asset = randomUUID();
    const map = await body(
      await post(base, "/api/v1/codex/maps", GM, { assetId: asset, name: "World", kind: "world" })
    );
    const mapId = map.data.map.id as string;
    const secretPage = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Lair" }));
    // A pin may link many pages and scenes; here one secret page and one scene, plus an actor.
    const secretScene = randomUUID();
    await post(base, `/api/v1/codex/maps/${mapId}/markers`, GM, {
      x: 1,
      y: 1,
      iconId: "skull",
      iconColor: "#ff2e9a",
      pageIds: [secretPage.data.page.id],
      sceneIds: [secretScene],
      actorId: randomUUID(),
      revealedToPlayers: true
    });

    expect((await get(base, `/api/v1/codex/maps/${mapId}/markers`, PLAYER)).status).toBe(404);

    await post(base, `/api/v1/codex/maps/${mapId}/reveal`, GM, { revealed: true });
    const playerMarkers = (await body(await get(base, `/api/v1/codex/maps/${mapId}/markers`, PLAYER))).data
      .markers as Json[];
    expect(playerMarkers).toHaveLength(1);
    expect(playerMarkers[0]).not.toHaveProperty("sceneIds");
    expect(playerMarkers[0]).not.toHaveProperty("actorId");
    expect(playerMarkers[0].pageIds).toEqual([]); // linked page not revealed, so link hidden
    expect(JSON.stringify(playerMarkers)).not.toContain(secretScene); // GM-only scene id never leaks
    expect(JSON.stringify(playerMarkers)).not.toContain(secretPage.data.page.id); // nor the unrevealed page id
    expect((await body(await get(base, `/api/v1/codex/maps/${mapId}/markers`, GM))).data.markers[0].sceneIds).toEqual([
      secretScene
    ]);
  });

  it("404s a player reading a hidden location's journal-by-attachment", async () => {
    const { base } = await fixture();
    const page = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Bree" }));
    const pageId = page.data.page.id as string;
    await post(base, "/api/v1/codex/journal", GM, {
      playerText: "We arrived.",
      attachPageId: pageId,
      revealedToPlayers: true
    });

    // Page not revealed: player cannot pull its pinned timeline even though the entry itself is revealed.
    expect((await get(base, `/api/v1/codex/journal?pageId=${pageId}`, PLAYER)).status).toBe(404);
    await post(base, `/api/v1/codex/pages/${pageId}/reveal`, GM, { revealed: true });
    const entries = (await body(await get(base, `/api/v1/codex/journal?pageId=${pageId}`, PLAYER))).data
      .entries as Json[];
    expect(entries).toHaveLength(1);
    expect(entries[0]).not.toHaveProperty("gmText");
  });

  it("keeps player search inside the player index (no gmBody text, no unrevealed pages)", async () => {
    const { base } = await fixture();
    await post(base, "/api/v1/codex/pages", GM, {
      title: "Hidden shrine",
      playerBody: "",
      gmBody: "The relic of Vecna rests here.",
      revealedToPlayers: true
    });
    // "Vecna" lives only in gmBody, so a player full-text search must not surface it.
    const playerHits = (
      (await body(await get(base, `/api/v1/codex/search?q=Vecna`, PLAYER))).data.hits as Json[]
    ).filter((hit) => hit.kind === "page");
    expect(playerHits).toHaveLength(0);
    const gmHits = ((await body(await get(base, `/api/v1/codex/search?q=Vecna`, GM))).data.hits as Json[]).filter(
      (hit) => hit.kind === "page"
    );
    expect(gmHits).toHaveLength(1);
  });

  it("returns the page NAMED for the query first, so the command palette's Enter lands on it", async () => {
    // A query for "Strahd" must rank the page titled "Strahd" first. Ordering is decided and tested in
    // `searchAll` (codex-store.test.ts); this checks the router's load, project and filter chain preserves it.
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
      expect(hits.map((hit) => hit.id).sort()).toEqual([named, mentionsA, mentionsB].sort());
    }
  });

  it("serves page media to a player only when a revealed page uses it", async () => {
    const { base } = await fixture();
    const upload = await body(
      await fetch(`${base}/api/v1/codex-assets?filename=a.png`, {
        method: "POST",
        headers: { authorization: "Bearer gm-token", "content-type": "image/png" },
        body: png(8, 8)
      })
    );
    const assetId = upload.data.asset.id as string;
    const contentPath = `/api/v1/codex-assets/${assetId}/content`;

    expect((await get(base, contentPath, GM)).status).toBe(200); // GM always
    expect((await get(base, contentPath, PLAYER)).status).toBe(403); // not used by any revealed page yet
    const page = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Bree", bannerAssetId: assetId }));
    await post(base, `/api/v1/codex/pages/${page.data.page.id}/reveal`, GM, { revealed: true });
    expect((await get(base, contentPath, PLAYER)).status).toBe(200); // now the banner of a revealed page
  });

  // A `codex:read` credential reaches page images, as the OpenAPI document and scope table promise. The
  // scope split is asserted both ways on the same asset, so a verifier that ignores scope cannot pass.
  it("serves page media to a codex:read credential, and not to a write-only one", async () => {
    const { base } = await fixture();
    const upload = await fetch(`${base}/api/v1/codex-assets?filename=a.png`, {
      method: "POST",
      headers: { authorization: "Bearer int-codex:write", "content-type": "image/png" },
      body: png(8, 8)
    });
    expect(upload.status, "a codex:write credential may upload").toBe(201);
    const contentPath = `/api/v1/codex-assets/${(await body(upload)).data.asset.id as string}/content`;

    expect((await get(base, contentPath, INTEGRATION_READ)).status, "…and codex:read may read it back").toBe(200);
    expect(
      (await get(base, contentPath, INTEGRATION_WRITE)).status,
      "write is not read - the scope still decides"
    ).toBe(403);
    // No token at all is 403 rather than 401: this route refuses before any lookup, so a media URL cannot
    // become an existence oracle. That is the contract's one stated exception.
    expect((await fetch(`${base}${contentPath}`)).status).toBe(403);
  });

  // An oversized page image is the documented 413, not a sanitized 500: the route-level `express.raw` parser
  // (11 MB) reports to the codex router's catch-all, so the router must map it.
  it("answers 413 for an oversized page image instead of a sanitized 500", async () => {
    const { base } = await fixture();
    const tooBig = await fetch(`${base}/api/v1/codex-assets?filename=a.png`, {
      method: "POST",
      headers: { authorization: "Bearer gm-token", "content-type": "image/png" },
      body: Buffer.alloc(12 * 1024 * 1024)
    });
    expect(tooBig.status).toBe(413);
    const refusal = await body(tooBig);
    expect(refusal.error.code).toBe("bad_request");
    expect(refusal.error.message).toBe("The request body is too large.");
  });

  it("exposes entity type + fields on reveal, and hides connections to unrevealed entities", async () => {
    const { base } = await fixture();
    const strahd = await body(
      await post(base, "/api/v1/codex/pages", GM, {
        title: "Strahd",
        entityType: "character",
        fields: { race: "Vampire", age: "400" }
      })
    );
    const strahdId = strahd.data.page.id as string;
    const cult = await body(await post(base, "/api/v1/codex/pages", GM, { title: "The Cult" })); // stays secret
    const barovia = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Barovia" }));
    await post(base, `/api/v1/codex/pages/${strahdId}/connections`, GM, {
      toPageId: cult.data.page.id,
      label: "leads"
    });
    await post(base, `/api/v1/codex/pages/${strahdId}/connections`, GM, {
      toPageId: barovia.data.page.id,
      label: "rules"
    });
    await post(base, `/api/v1/codex/pages/${barovia.data.page.id}/reveal`, GM, { revealed: true });
    await post(base, `/api/v1/codex/pages/${strahdId}/reveal`, GM, { revealed: true });

    const view = await body(await get(base, `/api/v1/codex/pages/${strahdId}`, PLAYER));
    expect(view.data.page.entityType).toBe("character");
    expect(view.data.page.fields).toEqual({ race: "Vampire", age: "400" });
    const rels = view.data.connections as Json[];
    expect(view.data.backlinks, "the two old keys are GONE, not merely empty").toBeUndefined();
    expect(view.data.relationships).toBeUndefined();
    expect(rels).toHaveLength(1); // only the edge to revealed Barovia
    expect(rels[0].otherTitle).toBe("Barovia");
    expect(rels[0].origin).toBe("declared");
    expect(JSON.stringify(view)).not.toContain("Cult"); // the secret entity never leaks through a connection
  });

  it("keeps GM-only structured fields (gmFields) off a revealed page's player projection", async () => {
    const { base } = await fixture();
    const vex = await body(
      await post(base, "/api/v1/codex/pages", GM, {
        title: "Baroness Vex",
        entityType: "character",
        fields: { race: "Human", role: "Royal advisor" },
        gmFields: { goals: "Secretly poisoning the king to install her cult's heir" }
      })
    );
    const vexId = vex.data.page.id as string;
    await post(base, `/api/v1/codex/pages/${vexId}/reveal`, GM, { revealed: true });

    const gmView = await body(await get(base, `/api/v1/codex/pages/${vexId}`, GM));
    expect(gmView.data.page.gmFields).toEqual({ goals: "Secretly poisoning the king to install her cult's heir" });

    const playerView = await body(await get(base, `/api/v1/codex/pages/${vexId}`, PLAYER));
    expect(playerView.data.page.fields).toEqual({ race: "Human", role: "Royal advisor" }); // public facts only
    expect(playerView.data.page.gmFields).toBeUndefined(); // the secret map never ships
    expect(JSON.stringify(playerView)).not.toContain("poisoning"); // the secret value never leaks
  });

  it("the server seals a secret field even when it is written into the PUBLIC fields map", async () => {
    const { base } = await fixture();
    // A raw write that wrongly puts the secret `goals` key in player-facing `fields`.
    const strahd = await body(
      await post(base, "/api/v1/codex/pages", GM, {
        title: "Count Strahd",
        entityType: "character",
        fields: { race: "Vampire", goals: "Reclaim Tatyana" }
      })
    );
    const id = strahd.data.page.id as string;
    await post(base, `/api/v1/codex/pages/${id}/reveal`, GM, { revealed: true });
    const gmView = await body(await get(base, `/api/v1/codex/pages/${id}`, GM));
    expect(gmView.data.page.fields.goals).toBeUndefined(); // server moved it out of the public map
    expect(gmView.data.page.gmFields.goals).toBe("Reclaim Tatyana"); // into the GM-only map
    const playerView = await body(await get(base, `/api/v1/codex/pages/${id}`, PLAYER));
    expect(playerView.data.page.fields).toEqual({ race: "Vampire" });
    expect(JSON.stringify(playerView)).not.toContain("Tatyana");
  });

  it("a player search finds a page by a public field value but never by a GM-only field value", async () => {
    const { base } = await fixture();
    const night = await body(
      await post(base, "/api/v1/codex/pages", GM, {
        title: "Nightsong",
        entityType: "character",
        fields: { race: "Elfkin" },
        gmFields: { goals: "Betray the coven at Xanadar" }
      })
    );
    await post(base, `/api/v1/codex/pages/${night.data.page.id}/reveal`, GM, { revealed: true });
    const byPublic = await body(await get(base, `/api/v1/codex/search?q=Elfkin`, PLAYER));
    expect((byPublic.data.hits as Json[]).length).toBeGreaterThan(0); // public field value is searchable
    const bySecret = await body(await get(base, `/api/v1/codex/search?q=Xanadar`, PLAYER));
    expect(bySecret.data.hits).toHaveLength(0); // secret field value is not searchable
    const gmSecret = await body(await get(base, `/api/v1/codex/search?q=Xanadar`, GM));
    expect((gmSecret.data.hits as Json[]).length).toBeGreaterThan(0); // ...but the GM can find it
  });

  it("GET /connections returns ONE whole-graph edge feed, viewer-safe for players", async () => {
    const { base } = await fixture();
    const a = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Azalin", entityType: "character" }));
    const b = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Darkon", entityType: "location" }));
    const secret = await body(await post(base, "/api/v1/codex/pages", GM, { title: "The Whispered Name" }));
    await post(base, `/api/v1/codex/pages/${a.data.page.id}/connections`, GM, {
      toPageId: b.data.page.id,
      label: "rules"
    });
    await post(base, `/api/v1/codex/pages/${a.data.page.id}/connections`, GM, {
      toPageId: secret.data.page.id,
      label: "serves"
    });
    await post(base, `/api/v1/codex/pages/${a.data.page.id}/reveal`, GM, { revealed: true });
    await post(base, `/api/v1/codex/pages/${b.data.page.id}/reveal`, GM, { revealed: true });

    const gmEdges = (await body(await get(base, "/api/v1/codex/connections", GM))).data.connections as Json[];
    expect(gmEdges).toHaveLength(2);
    const playerEdges = (await body(await get(base, "/api/v1/codex/connections", PLAYER))).data.connections as Json[];
    expect(playerEdges).toHaveLength(1); // only the edge whose both endpoints are revealed
    expect(playerEdges[0].label).toBe("rules");
    // The player edge carries no id, layer or createdAt: it is not addressable, and every edge a player
    // receives is on the player layer.
    expect(Object.keys(playerEdges[0]).sort()).toEqual(["fromId", "fromKind", "label", "origin", "toPageId"]);
    for (const path of ["/api/v1/codex/relationships", "/api/v1/codex/links"]) {
      expect((await get(base, path, GM)).status, path).toBe(404);
    }
    expect(
      (
        await post(base, `/api/v1/codex/pages/${a.data.page.id}/relationships`, GM, {
          toPageId: b.data.page.id,
          type: "rules"
        })
      ).status
    ).toBe(404);
  });

  // Connection surfaces use `projectPlayerJournalEntry`, not the raw reveal flag: a standing record is gated on
  // its faction page and a quest history row on its quest. Asserted on the serialized body, then the subject
  // is revealed to prove each emptiness is the gate.
  it("gates a journal-sourced connection on the journal PROJECTION, not the entry's reveal flag", async () => {
    const { base, store } = await fixture();
    const vallaki = store.createPage({ title: "Vallaki", revealedToPlayers: true });
    const faction = store.createPage({ title: "The Zhentarim", entityType: "faction" }); // hidden

    // Standing: a hidden faction's standing record, revealed, with a [[link]] in its player text.
    await put(base, `/api/v1/codex/standing/${faction.id}`, GM, { value: 70, reason: "Paid the toll" });
    const standingRecord = ((await body(await get(base, "/api/v1/codex/journal", GM))).data.entries as Json[]).find(
      (row) => row.kind === "standing"
    )!;
    expect(standingRecord, "PUT /codex/standing writes the hidden journal record this is about").toBeDefined();
    await patch(base, `/api/v1/codex/journal/${standingRecord.id}`, GM, {
      playerText: "They turned on us at [[Vallaki]]."
    });
    await post(base, `/api/v1/codex/journal/${standingRecord.id}/reveal`, GM, { revealed: true });

    // The GM's page panel has the edge, so the player's empty list below is the gate, not a missing row.
    const gmPanel = (await body(await get(base, `/api/v1/codex/pages/${vallaki.id}`, GM))).data.connections as Json[];
    expect(gmPanel.some((row) => row.otherKind === "journal" && row.otherId === standingRecord.id)).toBe(true);

    const playerPage = await body(await get(base, `/api/v1/codex/pages/${vallaki.id}`, PLAYER));
    expect((playerPage.data.connections as Json[]).filter((row) => row.otherKind === "journal")).toEqual([]);
    expect(JSON.stringify(playerPage), "the excerpt is the leak, not just the id").not.toContain("turned on us");
    expect(JSON.stringify(playerPage)).not.toContain(standingRecord.id);

    const playerGraph = await body(await get(base, "/api/v1/codex/connections", PLAYER));
    expect((playerGraph.data.connections as Json[]).filter((edge) => edge.fromKind === "journal")).toEqual([]);
    expect(JSON.stringify(playerGraph)).not.toContain(standingRecord.id);

    const audit = (await body(await get(base, "/api/v1/codex/reveal-audit", GM))).data.audit.sections as Json[];
    // The audit lists only what the party can see, so the record's absence from `rows` means "hidden".
    const journalSection = audit.find((section) => section.kind === "journal")!;
    expect((journalSection.rows as Json[]).some((row) => row.id === standingRecord.id)).toBe(false);

    await post(base, `/api/v1/codex/pages/${faction.id}/reveal`, GM, { revealed: true });
    const opened = await body(await get(base, `/api/v1/codex/pages/${vallaki.id}`, PLAYER));
    expect(
      (opened.data.connections as Json[]).some(
        (row) => row.otherKind === "journal" && row.otherId === standingRecord.id
      )
    ).toBe(true);
    expect(
      ((await body(await get(base, "/api/v1/codex/connections", PLAYER))).data.connections as Json[]).some(
        (edge) => edge.fromKind === "journal" && edge.fromId === standingRecord.id
      )
    ).toBe(true);

    // Quest history: the same rule one record kind over. Creating a quest writes a hidden `quest` record.
    const quest = store.createQuest({ title: "The Coffin Run" }); // hidden
    const questRecord = ((await body(await get(base, "/api/v1/codex/journal", GM))).data.entries as Json[]).find(
      (row) => row.kind === "quest"
    )!;
    expect(questRecord, "R5 writes a quest-history record on create").toBeDefined();
    await patch(base, `/api/v1/codex/journal/${questRecord.id}`, GM, { playerText: "It began at [[Vallaki]]." });
    await post(base, `/api/v1/codex/journal/${questRecord.id}/reveal`, GM, { revealed: true });

    const stillSecret = await body(await get(base, `/api/v1/codex/pages/${vallaki.id}`, PLAYER));
    expect((stillSecret.data.connections as Json[]).some((row) => row.otherId === questRecord.id)).toBe(false);
    expect(JSON.stringify(stillSecret)).not.toContain("It began at");

    await post(base, `/api/v1/codex/quests/${quest.id}/reveal`, GM, { revealed: true });
    const questOpen = await body(await get(base, `/api/v1/codex/pages/${vallaki.id}`, PLAYER));
    expect((questOpen.data.connections as Json[]).some((row) => row.otherId === questRecord.id)).toBe(true);
  });

  // Create, relabel and delete a connection. A mention has no id, so it cannot be patched or deleted
  // through the API; editing the sentence is the only way, keeping one sentence and one edge in step.
  it("declares, relabels and deletes a connection, and refuses to address a mention", async () => {
    const { base } = await fixture();
    const from = await body(
      await post(base, "/api/v1/codex/pages", GM, {
        title: "Strahd",
        entityType: "character",
        playerBody: "Rules [[Barovia]]."
      })
    );
    const to = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Barovia", entityType: "location" }));
    const created = await post(base, `/api/v1/codex/pages/${from.data.page.id}/connections`, GM, {
      toPageId: to.data.page.id,
      label: "rules",
      layer: "gm"
    });
    expect(created.status).toBe(201);
    const connection = (await body(created)).data.connection as Json;
    expect(connection).toMatchObject({
      fromKind: "page",
      fromId: from.data.page.id,
      toPageId: to.data.page.id,
      label: "rules",
      origin: "declared",
      layer: "gm"
    });

    // The mention from Strahd's body is in the same list with `id: null`, checked while the declared edge
    // still has a label (an unlabelled one folds with the mention).
    const panel = (await body(await get(base, `/api/v1/codex/pages/${from.data.page.id}`, GM))).data
      .connections as Json[];
    const mention = panel.find((row) => row.origin === "mention");
    expect(mention, "the [[Barovia]] mention rides in the same list").toBeDefined();
    expect(mention!.id).toBeNull();
    expect(panel.filter((row) => row.origin === "declared")).toHaveLength(1);

    const patched = (
      await body(await patch(base, `/api/v1/codex/connections/${connection.id}`, GM, { label: null, layer: "player" }))
    ).data.connection as Json;
    expect(patched).toMatchObject({ label: null, layer: "player" });
    // A 41-character label is a 400, and an unknown id is a 404, not a silent no-op.
    expect(
      (await patch(base, `/api/v1/codex/connections/${connection.id}`, GM, { label: "x".repeat(41) })).status
    ).toBe(400);
    expect((await patch(base, `/api/v1/codex/connections/${randomUUID()}`, GM, { label: "x" })).status).toBe(404);
    expect(
      (await post(base, `/api/v1/codex/pages/${from.data.page.id}/connections`, PLAYER, { toPageId: to.data.page.id }))
        .status
    ).toBe(403);
    expect((await del(base, `/api/v1/codex/connections/${connection.id}`, PLAYER)).status).toBe(403);

    // ...and once the declared edge is unlabelled it folds with the mention into one row, with the
    // deletable declared one winning.
    expect(
      ((await body(await get(base, `/api/v1/codex/pages/${from.data.page.id}`, GM))).data.connections as Json[]).filter(
        (row) => row.direction === "out"
      )
    ).toHaveLength(1);

    expect((await del(base, `/api/v1/codex/connections/${connection.id}`, GM)).status).toBe(200);
    const after = (await body(await get(base, `/api/v1/codex/pages/${from.data.page.id}`, GM))).data
      .connections as Json[];
    expect(
      after.every((row) => row.origin === "mention"),
      "the declared edge went; the mention stays, because it is prose"
    ).toBe(true);
  });

  // The page -> markers lookup must use exactly the forward route's predicate, or a pin would arrive without
  // its map's gate. The negative cases are also proven in `codex-store.test.ts`.
  it("GET /pages/:id/markers 404s a player on an unrevealed page, and never lets one probe by page id", async () => {
    const { base } = await fixture();
    const page = await body(await post(base, "/api/v1/codex/pages", GM, { title: "The Amber Temple" }));
    const pageId = page.data.page.id as string;
    const map = await body(
      await post(base, "/api/v1/codex/maps", GM, { assetId: randomUUID(), name: "Barovia", kind: "regional" })
    );
    await post(base, `/api/v1/codex/maps/${map.data.map.id}/reveal`, GM, { revealed: true });
    await post(base, `/api/v1/codex/maps/${map.data.map.id}/markers`, GM, {
      x: 0.5,
      y: 0.5,
      iconId: "pin",
      iconColor: "#ff2e9a",
      label: "Amber vaults",
      pageIds: [pageId],
      revealedToPlayers: true
    });

    // The page is secret, so the question must not be answerable: 404, not an empty list, as
    // `GET /codex/journal?pageId=` refuses a hidden location's timeline.
    const denied = await get(base, `/api/v1/codex/pages/${pageId}/markers`, PLAYER);
    expect(denied.status).toBe(404);
    expect(JSON.stringify(await body(denied))).not.toContain("Amber vaults");
    expect((await body(await get(base, `/api/v1/codex/pages/${pageId}/markers`, GM))).data.markers).toHaveLength(1);

    await post(base, `/api/v1/codex/pages/${pageId}/reveal`, GM, { revealed: true });
    const allowed = (await body(await get(base, `/api/v1/codex/pages/${pageId}/markers`, PLAYER))).data
      .markers as Json[];
    expect(allowed).toHaveLength(1);
    expect(allowed[0].label).toBe("Amber vaults");
  });

  it("GET /pages/:id/markers hides a secret map's pin (CD-6) and a hidden pin, and strips scene/actor links", async () => {
    const { base } = await fixture();
    const page = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Strahd" }));
    const pageId = page.data.page.id as string;
    await post(base, `/api/v1/codex/pages/${pageId}/reveal`, GM, { revealed: true }); // the page itself is open

    const makeMap = async (name: string, revealed: boolean) => {
      const map = await body(
        await post(base, "/api/v1/codex/maps", GM, { assetId: randomUUID(), name, kind: "regional" })
      );
      if (revealed) await post(base, `/api/v1/codex/maps/${map.data.map.id}/reveal`, GM, { revealed: true });
      return map.data.map.id as string;
    };
    const openMap = await makeMap("Vallaki", true);
    const secretMap = await makeMap("Amberhold", false);
    const secretScene = randomUUID();
    const secretActor = randomUUID();
    const otherSecretPage = await body(await post(base, "/api/v1/codex/pages", GM, { title: "The Heart of Sorrow" }));

    // Three pins linking the same open page: one visible, one hidden, one revealed on a secret map.
    const shown = await body(
      await post(base, `/api/v1/codex/maps/${openMap}/markers`, GM, {
        x: 0.2,
        y: 0.2,
        iconId: "castle",
        iconColor: "#ff2e9a",
        label: "Castle Ravenloft",
        pageIds: [pageId, otherSecretPage.data.page.id],
        sceneIds: [secretScene],
        actorId: secretActor,
        revealedToPlayers: true
      })
    );
    await post(base, `/api/v1/codex/maps/${openMap}/markers`, GM, {
      x: 0.3,
      y: 0.3,
      iconId: "pin",
      iconColor: "#ff2e9a",
      label: "Vistani camp",
      pageIds: [pageId],
      revealedToPlayers: false
    });
    await post(base, `/api/v1/codex/maps/${secretMap}/markers`, GM, {
      x: 0.4,
      y: 0.4,
      iconId: "pin",
      iconColor: "#ff2e9a",
      label: "Wyrmwood cache",
      pageIds: [pageId],
      revealedToPlayers: true
    });

    const gmMarkers = (await body(await get(base, `/api/v1/codex/pages/${pageId}/markers`, GM))).data.markers as Json[];
    expect(gmMarkers.map((marker) => marker.label).sort()).toEqual([
      "Castle Ravenloft",
      "Vistani camp",
      "Wyrmwood cache"
    ]);

    const playerMarkers = (await body(await get(base, `/api/v1/codex/pages/${pageId}/markers`, PLAYER))).data
      .markers as Json[];
    expect(playerMarkers).toHaveLength(1); // only the shown pin on the shown map
    expect(playerMarkers[0].id).toBe(shown.data.marker.id);
    const payload = JSON.stringify(playerMarkers);
    expect(payload).not.toContain("Vistani camp"); // hidden pin
    expect(payload).not.toContain("Wyrmwood cache"); // revealed pin on a secret map
    expect(payload).not.toContain(secretMap); // ...and not even that map's id
    expect(payload).not.toContain(secretScene); // GM-only linkage never travels
    expect(payload).not.toContain(secretActor);
    expect(playerMarkers[0]).not.toHaveProperty("sceneIds");
    expect(playerMarkers[0]).not.toHaveProperty("actorId");
    expect(playerMarkers[0]).not.toHaveProperty("revealedToPlayers");
    expect(playerMarkers[0].pageIds).toEqual([pageId]); // the pin's other, secret page link is filtered out
    expect(payload).not.toContain(otherSecretPage.data.page.id as string);
  });

  /** The reverse route's payload must equal the forward route's for the same pin: same projection, identical bytes. */
  it("GET /pages/:id/markers hands a player exactly what GET /maps/:id/markers hands them for the same pin", async () => {
    const { base } = await fixture();
    const page = await body(await post(base, "/api/v1/codex/pages", GM, { title: "Ireena" }));
    const pageId = page.data.page.id as string;
    await post(base, `/api/v1/codex/pages/${pageId}/reveal`, GM, { revealed: true });
    const map = await body(
      await post(base, "/api/v1/codex/maps", GM, { assetId: randomUUID(), name: "Barovia", kind: "regional" })
    );
    const mapId = map.data.map.id as string;
    await post(base, `/api/v1/codex/maps/${mapId}/reveal`, GM, { revealed: true });
    await post(base, `/api/v1/codex/maps/${mapId}/markers`, GM, {
      x: 0.5,
      y: 0.5,
      iconId: "pin",
      iconColor: "#ff2e9a",
      label: "Burgomaster's house",
      pageIds: [pageId],
      sceneIds: [randomUUID()],
      revealedToPlayers: true
    });

    const forward = (await body(await get(base, `/api/v1/codex/maps/${mapId}/markers`, PLAYER))).data.markers as Json[];
    const reverse = (await body(await get(base, `/api/v1/codex/pages/${pageId}/markers`, PLAYER))).data
      .markers as Json[];
    expect(reverse).toEqual(forward);
  });

  // The whole-graph wiki-link feed. Every negative here is also proven against `projectPlayerLinkEdges` in
  // `codex-store.test.ts`, since an HTTP test cannot show which layer did the work.
  it("GET /connections shows mention edges, and a player sees neither GM-body links nor edges touching a secret page", async () => {
    const { base } = await fixture();
    const make = async (title: string, playerBody: string, gmBody: string, revealed: boolean) => {
      const page = await body(await post(base, "/api/v1/codex/pages", GM, { title, playerBody, gmBody }));
      const pageId = page.data.page.id as string;
      if (revealed) await post(base, `/api/v1/codex/pages/${pageId}/reveal`, GM, { revealed: true });
      return pageId;
    };
    // Edges: Barovia -> Vallaki in the player body (visible); Barovia -> a secret page in the player body
    // (dangling for a player); Vallaki -> Barovia in Vallaki's GM body (GM-only between open pages).
    const secret = await make("The Whispered Name", "", "", false);
    const barovia = await make("Barovia", "Ruled from [[Vallaki]], watched by [[The Whispered Name]].", "", true);
    const vallaki = await make("Vallaki", "A walled town.", "Its burgomaster answers to [[Barovia]].", true);

    const pair = (edge: Json) => ({ fromPageId: edge.fromId as string, toPageId: edge.toPageId as string });
    const gmLinks = ((await body(await get(base, "/api/v1/codex/connections", GM))).data.connections as Json[]).map(
      pair
    );
    expect(gmLinks).toEqual(
      expect.arrayContaining([
        { fromPageId: barovia, toPageId: vallaki },
        { fromPageId: barovia, toPageId: secret },
        { fromPageId: vallaki, toPageId: barovia } // the GM-body link
      ])
    );
    expect(gmLinks).toHaveLength(3);

    const playerLinks = (
      (await body(await get(base, "/api/v1/codex/connections", PLAYER))).data.connections as Json[]
    ).map(pair);
    expect(playerLinks).toEqual([{ fromPageId: barovia, toPageId: vallaki }]);
    // The secret page must not be inferable from a dangling edge, and the GM-body edge must not appear even
    // though both its endpoints are revealed: the two rules are independent.
    expect(JSON.stringify(playerLinks)).not.toContain(secret);
    expect(playerLinks.some((edge) => edge.fromPageId === vallaki)).toBe(false);
  });

  it("GET /connections drops a self-link and a link to a title no page carries", async () => {
    const { base } = await fixture();
    const page = await body(
      await post(base, "/api/v1/codex/pages", GM, {
        title: "Barovia",
        playerBody: "See [[Barovia]] and [[A Page That Was Never Written]].",
        revealedToPlayers: true
      })
    );
    const links = (await body(await get(base, "/api/v1/codex/connections", GM))).data.connections as Json[];
    expect(links).toEqual([]); // no node to draw for either
    expect(JSON.stringify(links)).not.toContain(page.data.page.id as string);
  });

  it("returns ONE list carrying every matching kind, with no superseded second list", async () => {
    const { base } = await fixture();
    // One word ("Ravenloft") on a page and a map: one result list carries both.
    const page = await body(
      await post(base, "/api/v1/codex/pages", GM, { title: "Ravenloft", playerBody: "a gothic castle" })
    );
    await post(base, `/api/v1/codex/pages/${page.data.page.id}/reveal`, GM, { revealed: true });
    const map = await body(
      await post(base, "/api/v1/codex/maps", GM, {
        assetId: randomUUID(),
        name: "Ravenloft approach",
        kind: "regional"
      })
    );
    await post(base, `/api/v1/codex/maps/${map.data.map.id}/reveal`, GM, { revealed: true });

    const found = await body(await get(base, `/api/v1/codex/search?q=Ravenloft`, PLAYER));
    const hits = found.data.hits as Json[];
    expect(hits.map((hit) => hit.kind).sort()).toEqual(["map", "page"]);
    expect(hits.find((hit) => hit.kind === "page")!.id).toBe(page.data.page.id);
    expect(hits.find((hit) => hit.kind === "map")!.id).toBe(map.data.map.id);
    expect(found.data.results).toBeUndefined();
  });

  it("round-trips the world calendar (incl. current date), and weekdays appear in dated labels", async () => {
    const { base } = await fixture();
    const cal = {
      yearName: "AE",
      months: [
        { name: "Rise", days: 10 },
        { name: "Fall", days: 10 }
      ],
      weekdays: ["Sol", "Lun"],
      currentDate: { year: 3, month: 1, day: 4 }
    };
    const saved = await body(await put(base, "/api/v1/codex/calendar", GM, cal));
    expect(saved.data.calendar.currentDate).toEqual({ year: 3, month: 1, day: 4 });
    const got = await body(await get(base, "/api/v1/codex/calendar", PLAYER)); // calendar is readable by any role
    expect(got.data.calendar.yearName).toBe("AE");
    const entry = await body(
      await post(base, "/api/v1/codex/journal", GM, { playerText: "Dawn.", inWorldDate: { year: 0, month: 0, day: 1 } })
    );
    expect(entry.data.entry.inWorldLabel).toBe("Sol, Rise 1, 0 AE"); // weekday included in the label
    expect((await put(base, "/api/v1/codex/calendar", PLAYER, cal)).status).toBe(403); // players cannot edit it (authenticated, refused)
  });
});

// Search starts from raw matched text rather than a GM-curated list, so the player index must be gated by
// exactly the predicate its record's player list endpoint uses.
describe("codex suite-wide search viewer safety", () => {
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
      (
        await body(
          await post(base, `/api/v1/codex/maps/${mapId}/markers`, GM, {
            x: 0.5,
            y: 0.5,
            iconId: "pin",
            iconColor: "#ff2e9a",
            label,
            revealedToPlayers
          })
        )
      ).data.marker.id as string;

    const openMap = await makeMap("Vallaki", true);
    const secretMap = await makeMap("Amberhold", false);
    const shownMarker = await makeMarker(openMap, "Blinsky toys", true);
    const hiddenMarker = await makeMarker(openMap, "Vistani informant", false);
    // The pin itself is revealed, but it stands on a map the party has never seen.
    const pinOnSecretMap = await makeMarker(secretMap, "Wyrmwood cache", true);
    const entry = await body(
      await post(base, "/api/v1/codex/journal", GM, {
        playerText: "The mists parted before us.",
        gmText: "Strahd was watching from the parapet.",
        revealedToPlayers: true
      })
    );
    return {
      base,
      openMap,
      secretMap,
      shownMarker,
      hiddenMarker,
      pinOnSecretMap,
      entryId: entry.data.entry.id as string
    };
  }

  const search = async (base: string, term: string, headers: Record<string, string>) =>
    (await body(await get(base, `/api/v1/codex/search?q=${term}`, headers))).data.hits as Json[];

  it("a player search cannot surface a REVEALED journal entry's GM-only text", async () => {
    const { base, entryId } = await world();
    // The entry is revealed, so the player legitimately has it, but "parapet" exists only in gmText.
    expect(await search(base, "parapet", PLAYER)).toEqual([]);
    expect(JSON.stringify(await body(await get(base, `/api/v1/codex/search?q=parapet`, PLAYER)))).not.toContain(
      "Strahd"
    );
    const byPlayerText = await search(base, "mists", PLAYER);
    expect(byPlayerText).toHaveLength(1);
    expect(byPlayerText[0].kind).toBe("journal");
    expect(byPlayerText[0].id).toBe(entryId);
    expect(byPlayerText[0].title).toBe("The mists parted before us."); // the excerpt is the player layer
    expect(JSON.stringify(byPlayerText)).not.toContain("Strahd");
  });

  it("a player search cannot surface a hidden marker's label", async () => {
    const { base, shownMarker } = await world();
    expect(await search(base, "Vistani", PLAYER)).toEqual([]);
    expect(await search(base, "Blinsky", PLAYER)).toEqual([
      expect.objectContaining({ kind: "marker", id: shownMarker })
    ]);
  });

  it("a player search cannot surface a REVEALED marker that sits on a secret map (CD-6)", async () => {
    const { base, secretMap } = await world();
    // A pin's own reveal flag is not the whole predicate: `GET /maps/:id/markers` 404s a player on an
    // unrevealed map, so search must not be a way around that.
    const hits = await search(base, "Wyrmwood", PLAYER);
    expect(hits).toEqual([]);
    expect(JSON.stringify(await body(await get(base, `/api/v1/codex/search?q=Wyrmwood`, PLAYER)))).not.toContain(
      secretMap
    );
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
    expect(await search(base, "Wyrmwood", GM)).toEqual([
      expect.objectContaining({ kind: "marker", id: pinOnSecretMap })
    ]);
    expect(await search(base, "Amberhold", GM)).toEqual([expect.objectContaining({ kind: "map", id: secretMap })]);
    expect((await search(base, "Ireena", GM)).map((hit) => hit.kind)).toEqual(["page"]);
  });

  it("a player hit carries only navigation fields - no bodies, reveal flags, or secret-map linkage", async () => {
    const { base, openMap, shownMarker } = await world();
    // Assert the exact key set, so any new field in the player search projection fails here.
    const marker = (await search(base, "Blinsky", PLAYER))[0];
    expect(Object.keys(marker).sort()).toEqual(["entityType", "id", "kind", "mapId", "tags", "title"]);
    expect(marker.mapId).toBe(openMap); // a player only ever gets a pin whose map is revealed
    expect(marker.id).toBe(shownMarker);
  });
});

// Every chronicle record kind is player-reachable through `PlayerCodex`'s timeline. Pipeline tests; the
// projection is tested directly in `codex-store.test.ts`.
describe("codex chronicle HTTP boundary", () => {
  const chronicle = async (base: string, headers: Record<string, string>) =>
    (await body(await get(base, "/api/v1/codex/timeline", headers))).data.records as Json[];

  it("returns no UNREVEALED event and no GM-only event content to a player", async () => {
    const { base, store } = await fixture();
    const secret = store.createPage({
      title: "The Sundering",
      entityType: "event",
      playerBody: "The sky tore open.",
      gmBody: "Strahd engineered it.",
      gmFields: { goals: "conceal the cause" },
      inWorldDate: { year: 1492, month: 0, day: 1 }
    });
    const shown = store.createPage({
      title: "The Festival of the Blazing Sun",
      entityType: "event",
      revealedToPlayers: true,
      playerBody: "Vallaki celebrated.",
      gmBody: "The wolves were already inside.",
      inWorldDate: { year: 1492, month: 0, day: 2 }
    });

    const gmRows = await chronicle(base, GM);
    expect(gmRows.map((row) => row.id)).toEqual([secret.id, shown.id]);
    expect(JSON.stringify(gmRows)).toContain("Strahd engineered it.");

    const playerRows = await chronicle(base, PLAYER);
    expect(playerRows.map((row) => row.id)).toEqual([shown.id]); // the unrevealed event is absent
    const payload = JSON.stringify(playerRows);
    expect(payload).not.toContain("Strahd engineered it."); // the revealed event's GM body
    expect(payload).not.toContain("The wolves were already inside.");
    expect(payload).not.toContain("conceal the cause"); // GM fields
    expect(payload).not.toContain("The Sundering"); // even the secret event's title
    // The exact key set, so any new field fails here. `fired` is derived from the published date, never the
    // GM's clock; `payload` is who/activity/days only; `proposedDate` is GM prep and excluded.
    expect(Object.keys(playerRows[0]).sort()).toEqual([
      "calendarInstant",
      "createdAt",
      "fired",
      "id",
      "inWorldDate",
      "inWorldLabel",
      "kind",
      "payload",
      "realDate",
      "sessionId",
      "sessionNumber",
      "tags",
      "text",
      "title"
    ]);
  });

  it("interleaves a dated event with journal entries in one in-world order, for both roles", async () => {
    const { base, store } = await fixture();
    const early = store.createEntry({
      playerText: "Founding.",
      revealedToPlayers: true,
      inWorldDate: { year: 1400, month: 0, day: 1 }
    });
    const event = store.createPage({
      title: "The Sundering",
      entityType: "event",
      revealedToPlayers: true,
      playerBody: "The sky tore open.",
      inWorldDate: { year: 1450, month: 0, day: 1 }
    });
    const late = store.createEntry({
      playerText: "The war.",
      revealedToPlayers: true,
      inWorldDate: { year: 1500, month: 0, day: 1 }
    });

    for (const headers of [GM, PLAYER]) {
      const rows = await chronicle(base, headers);
      expect(rows.map((row) => row.id)).toEqual([early.id, event.id, late.id]);
      expect(rows.map((row) => row.kind)).toEqual(["entry", "event", "entry"]);
    }
  });

  it("reflows events and entries together when the calendar changes, seen through the API", async () => {
    // The calendar editor's PUT, then the chronicle re-read: order and labels both move, and the raw dates
    // stay exactly as typed.
    const { base, store } = await fixture();
    // Ten days apart: identically dated records fall to the id tiebreaker, which is total but not
    // predictable. Distinct dates also prove each record reflowed to its own new instant.
    const entry = store.createEntry({ playerText: "Founding.", inWorldDate: { year: 1, month: 1, day: 10 } });
    const event = store.createPage({
      title: "The Sundering",
      entityType: "event",
      inWorldDate: { year: 1, month: 1, day: 20 }
    });

    const response = await put(base, "/api/v1/codex/calendar", GM, {
      yearName: "AE",
      months: [
        { name: "Rise", days: 100 },
        { name: "Fall", days: 100 }
      ],
      weekdays: []
    });
    expect(response.status).toBe(200);

    const rows = await chronicle(base, GM);
    expect(rows.map((row) => row.id)).toEqual([entry.id, event.id]);
    expect(rows.map((row) => row.inWorldLabel)).toEqual(["Fall 10, 1 AE", "Fall 20, 1 AE"]);
    expect(rows.map((row) => row.calendarInstant)).toEqual([309, 319]); // 1*200 + 100 + (day-1), on the new year
    expect(rows.map((row) => row.inWorldDate)).toEqual([
      { year: 1, month: 1, day: 10 },
      { year: 1, month: 1, day: 20 }
    ]);
  });

  it("dates an event page through the page routes, and clears it with an explicit null", async () => {
    const { base } = await fixture();
    const created = await body(
      await post(base, "/api/v1/codex/pages", GM, {
        title: "The Sundering",
        entityType: "event",
        inWorldDate: { year: 1492, month: 0, day: 1 }
      })
    );
    const id = created.data.page.id as string;
    expect(created.data.page.inWorldDate).toEqual({ year: 1492, month: 0, day: 1 });
    expect(created.data.page.calendarInstant).not.toBeNull();
    expect((await chronicle(base, GM)).map((row) => row.id)).toEqual([id]);

    // A PATCH that never mentions the date leaves it alone (the page editor's autosave path).
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

// Sessions: `prepBody` is the GM's plan, `recapBody` is what the table reads. Pipeline tests; the
// projection is tested directly in `codex-store.test.ts`.
describe("codex sessions HTTP boundary", () => {
  const PREP = "The ambush is at the bridge; Ireena is the real target.";
  const RECAP = "The party crossed the bridge.";

  it("gives a player the recap and NEVER the prep, and 404s an unrevealed session", async () => {
    const { base } = await fixture();
    const shown = await body(
      await post(base, "/api/v1/codex/sessions", GM, {
        sessionNumber: 6,
        realDate: "2026-07-26",
        attendees: ["Ozy", "Mara"],
        prepBody: PREP,
        recapBody: RECAP
      })
    );
    const shownId = shown.data.session.id as string;
    const secret = await body(
      await post(base, "/api/v1/codex/sessions", GM, {
        sessionNumber: 7,
        prepBody: "Strahd attends the ball in person.",
        recapBody: "The ball ended badly."
      })
    );
    const secretId = secret.data.session.id as string;

    const gmList = await body(await get(base, "/api/v1/codex/sessions", GM));
    expect((gmList.data.sessions as Json[]).map((row) => row.sessionNumber)).toEqual([6, 7]);
    expect(JSON.stringify(gmList)).toContain(PREP);
    expect(JSON.stringify(gmList)).toContain(RECAP);

    // Unrevealed: the player list is empty and the direct read is 404, never 403, since a status that
    // distinguishes "secret" from "absent" is itself a leak.
    expect((await body(await get(base, "/api/v1/codex/sessions", PLAYER))).data.sessions).toHaveLength(0);
    expect((await get(base, `/api/v1/codex/sessions/${shownId}`, PLAYER)).status).toBe(404);

    await post(base, `/api/v1/codex/sessions/${shownId}/reveal`, GM, { revealed: true });
    const playerList = await body(await get(base, "/api/v1/codex/sessions", PLAYER));
    const rows = playerList.data.sessions as Json[];
    expect(rows).toHaveLength(1); // the still-secret session 7 is absent
    // The exact projected key set, so any new field in the player session projection fails here.
    expect(Object.keys(rows[0]).sort()).toEqual(["id", "realDate", "recap", "sessionNumber", "tags"]);
    expect(rows[0].recap).toBe(RECAP);

    const payload = JSON.stringify(playerList);
    expect(payload).not.toContain(PREP); // the revealed session's own prep
    expect(payload).not.toContain("Strahd attends the ball"); // the unrevealed session's prep...
    expect(payload).not.toContain("The ball ended badly."); // ...and even its recap
    expect(payload).not.toContain(secretId); // ...and its id
    expect(payload).not.toContain("Ozy"); // attendance is GM-only for now

    const single = await body(await get(base, `/api/v1/codex/sessions/${shownId}`, PLAYER));
    expect(Object.keys(single.data.session).sort()).toEqual(["id", "realDate", "recap", "sessionNumber", "tags"]);
    expect(JSON.stringify(single)).not.toContain(PREP);
    expect((await get(base, `/api/v1/codex/sessions/${secretId}`, PLAYER)).status).toBe(404);
    expect((await get(base, `/api/v1/codex/sessions/${secretId}`, GM)).status).toBe(200);
  });

  it("returns the active session id to the GM and never to a player", async () => {
    const { base } = await fixture();
    const created = await body(
      await post(base, "/api/v1/codex/sessions", GM, { sessionNumber: 1, recapBody: "We began." })
    );
    const sessionId = created.data.session.id as string;
    await post(base, `/api/v1/codex/sessions/${sessionId}/reveal`, GM, { revealed: true });

    expect((await body(await get(base, "/api/v1/codex/sessions", GM))).data.activeSessionId).toBeNull();
    const activated = await post(base, `/api/v1/codex/sessions/${sessionId}/activate`, GM, {});
    expect(activated.status).toBe(200);
    expect((await body(activated)).data.activeSessionId).toBe(sessionId);
    expect((await body(await get(base, "/api/v1/codex/sessions", GM))).data.activeSessionId).toBe(sessionId);

    // The player's copy of the same revealed session names no active id. The key stays present so one
    // response shape serves both roles; a GM-only key would itself be a tell.
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
    ])
      expect(response.status).toBe(403);
    const noauth = await get(base, "/api/v1/codex/sessions", { "content-type": "application/json" });
    expect(noauth.status).toBe(401);
    expect((await body(noauth)).ok).toBe(false);
    expect((await body(await get(base, `/api/v1/codex/sessions/${sessionId}`, GM))).data.session.rev).toBe(1);
  });

  it("maps a stale expectedRev to 409 and a duplicate session number to 400", async () => {
    const { base } = await fixture();
    const created = await body(await post(base, "/api/v1/codex/sessions", GM, { sessionNumber: 1 }));
    const sessionId = created.data.session.id as string;
    const stale = await patch(base, `/api/v1/codex/sessions/${sessionId}`, GM, { prepBody: "later", expectedRev: 0 });
    expect(stale.status).toBe(409);
    expect((await body(stale)).error.code).toBe("conflict");

    // A duplicate number is a clean validation failure, not a 500.
    const duplicate = await post(base, "/api/v1/codex/sessions", GM, { sessionNumber: 1 });
    expect(duplicate.status).toBe(400);
    const failed = await body(duplicate);
    expect(failed.error.code).toBe("validation_failed");
    expect(failed.error.message).toMatch(/Session 1 already exists/);
  });

  it("deletes idempotently and stops serving the session", async () => {
    const { base } = await fixture();
    const created = await body(
      await post(base, "/api/v1/codex/sessions", GM, { sessionNumber: 1, recapBody: "We began." })
    );
    const sessionId = created.data.session.id as string;
    const first = await fetch(`${base}/api/v1/codex/sessions/${sessionId}`, { method: "DELETE", headers: GM });
    expect(first.status).toBe(200);
    expect((await body(first)).data.deleted).toBe(true);
    expect((await fetch(`${base}/api/v1/codex/sessions/${sessionId}`, { method: "DELETE", headers: GM })).status).toBe(
      200
    );
    expect((await get(base, `/api/v1/codex/sessions/${sessionId}`, GM)).status).toBe(404);
    expect((await body(await get(base, "/api/v1/codex/sessions", GM))).data.sessions).toHaveLength(0);
  });

  it("files journal entries written during the active session under its number, end to end", async () => {
    const { base } = await fixture();
    // Nothing active: an entry is filed with no session.
    const before = await body(await post(base, "/api/v1/codex/journal", GM, { playerText: "Between sessions." }));
    expect(before.data.entry.sessionNumber).toBeNull();

    const created = await body(await post(base, "/api/v1/codex/sessions", GM, { sessionNumber: 12 }));
    await post(base, `/api/v1/codex/sessions/${created.data.session.id}/activate`, GM, {});
    const during = await body(await post(base, "/api/v1/codex/journal", GM, { playerText: "We reached Vallaki." }));
    expect(during.data.entry.sessionNumber).toBe(12);
    // An explicit ID still wins over the active session.
    const other = await body(await post(base, "/api/v1/codex/sessions", GM, { sessionNumber: 4 }));
    const pinned = await body(
      await post(base, "/api/v1/codex/journal", GM, { playerText: "A retcon.", sessionId: other.data.session.id })
    );
    expect(pinned.data.entry.sessionNumber).toBe(4);
    expect(pinned.data.entry.sessionId).toBe(other.data.session.id);

    // A bare `sessionNumber` on a write is a 400 with the key named in `details.issues`: the number is a
    // display value the server resolves, and `.strict()` rejects it rather than ignoring the key.
    const refused = await post(base, "/api/v1/codex/journal", GM, { playerText: "By number.", sessionNumber: 12 });
    expect(refused.status).toBe(400);
    const refusal = await body(refused);
    expect(refusal.error.code).toBe("validation_failed");
    expect(JSON.stringify(refusal.error)).toContain("sessionNumber");
    expect((refusal.error.details.issues as unknown[]).length).toBeGreaterThan(0);
    // ...and an id naming no session is a 404, not a silently unfiled entry. All four journal creators
    // take `sessionId`, so all four are covered.
    for (const [path, extra] of [
      ["/api/v1/codex/journal", {}],
      ["/api/v1/codex/journal/deadline", { inWorldDate: { year: 1492, month: 0, day: 1 } }],
      ["/api/v1/codex/journal/downtime", { downtime: { who: "Ireena", activity: "Forging", days: 3 } }],
      ["/api/v1/codex/journal/milestone", { milestone: { level: 5, reason: "the crypt" } }]
    ] as const) {
      expect(
        (await post(base, path, GM, { playerText: "Nowhere.", sessionId: randomUUID(), ...extra })).status,
        path
      ).toBe(404);
    }
    // Downtime has a second 404 of its own: a `characterPageId` naming no page.
    expect(
      (
        await post(base, "/api/v1/codex/journal/downtime", GM, {
          playerText: "Nowhere.",
          downtime: { who: "Ireena", activity: "Forging", days: 3, characterPageId: randomUUID() }
        })
      ).status
    ).toBe(404);
  });

  // `GET /codex/journal?markerId=` must apply the same compound predicate as `GET /codex/markers/{id}` (pin and
  // map revealed), or the 200-vs-404 difference would reveal a pin on an unseen map.
  it("answers a player's mini-timeline probe the same way the pin route does (CD-6)", async () => {
    const { base, store } = await fixture();
    const map = store.createMap({
      assetId: "11111111-1111-4111-8111-111111111111",
      name: "The Under-dark",
      kind: "regional"
    });
    const marker = store.createMarker(map.id, { x: 0.5, y: 0.5, iconId: "pin", iconColor: "#ff8800" });
    store.setMarkerRevealed(marker.id, true); // the pin is revealed; its map is not

    const probe = `/api/v1/codex/journal?markerId=${marker.id}`;
    expect((await get(base, `/api/v1/codex/markers/${marker.id}`, PLAYER)).status, "the pin route hides it").toBe(404);
    expect((await get(base, probe, PLAYER)).status, "...so the mini-timeline must too").toBe(404);
    expect((await get(base, probe, GM)).status).toBe(200);

    store.setMapRevealed(map.id, true);
    expect((await get(base, `/api/v1/codex/markers/${marker.id}`, PLAYER)).status).toBe(200);
    expect((await get(base, probe, PLAYER)).status).toBe(200);
  });

  it("never lets an UNREVEALED session's number ride out on a revealed journal entry", async () => {
    // The GM activates unrevealed session 4 and auto-linking stamps it onto a note. Revealing the note must not
    // publish the session, which its number would.
    const { base } = await fixture();
    const created = await body(await post(base, "/api/v1/codex/sessions", GM, { sessionNumber: 4, prepBody: PREP }));
    const sessionId = created.data.session.id as string;
    await post(base, `/api/v1/codex/sessions/${sessionId}/activate`, GM, {});

    const auto = await body(await post(base, "/api/v1/codex/journal", GM, { playerText: "We reached Vallaki." }));
    const autoId = auto.data.entry.id as string;
    expect(auto.data.entry.sessionNumber).toBe(4); // auto-linked
    // Beside it, a bare number label left by deleting a revealed session, which must survive; otherwise a
    // router that blanked every number would pass.
    const doomed = await body(await post(base, "/api/v1/codex/sessions", GM, { sessionNumber: 9 }));
    await post(base, `/api/v1/codex/sessions/${doomed.data.session.id}/reveal`, GM, { revealed: true });
    const legacy = await body(
      await post(base, "/api/v1/codex/journal", GM, { playerText: "Undated lore.", sessionId: doomed.data.session.id })
    );
    const legacyId = legacy.data.entry.id as string;
    await del(base, `/api/v1/codex/sessions/${doomed.data.session.id}`, GM, {});
    for (const id of [autoId, legacyId]) await post(base, `/api/v1/codex/journal/${id}/reveal`, GM, { revealed: true });

    expect((await body(await get(base, "/api/v1/codex/sessions", PLAYER))).data.sessions).toHaveLength(0);
    expect((await get(base, `/api/v1/codex/sessions/${sessionId}`, PLAYER)).status).toBe(404);

    const rowsFor = async (headers: Record<string, string>) => {
      const journal = (await body(await get(base, "/api/v1/codex/journal", headers))).data.entries as Json[];
      const timeline = (await body(await get(base, "/api/v1/codex/timeline", headers))).data.records as Json[];
      const find = (rows: Json[], id: string) => rows.find((row) => row.id === id)!;
      return [find(journal, autoId), find(timeline, autoId), find(journal, legacyId), find(timeline, legacyId)];
    };

    const [pJournal, pTimeline, pLegacyJournal, pLegacyTimeline] = await rowsFor(PLAYER);
    expect(pJournal.text).toBe("We reached Vallaki."); // the entry itself is readable...
    expect(pJournal.sessionNumber).toBeNull(); // ...without naming the session
    expect(pTimeline.sessionNumber).toBeNull();
    expect(pJournal.sessionId).toBeNull(); // ...and neither half of the link travels
    expect(pTimeline.sessionId).toBeNull();
    expect(pLegacyJournal.sessionNumber).toBe(9); // a stamped-back label still reads
    expect(pLegacyTimeline.sessionNumber).toBe(9);
    expect(pLegacyJournal.sessionId).toBeNull(); // ...with no record left to link to

    const [gJournal, gTimeline] = await rowsFor(GM);
    expect(gJournal.sessionNumber).toBe(4);
    expect(gTimeline.sessionNumber).toBe(4);

    // Revealing the session publishes the number on the same entries, so the nulls are the reveal gate.
    await post(base, `/api/v1/codex/sessions/${sessionId}/reveal`, GM, { revealed: true });
    const [afterJournal, afterTimeline] = await rowsFor(PLAYER);
    expect(afterJournal.sessionNumber).toBe(4);
    expect(afterTimeline.sessionNumber).toBe(4);
  });
});

// Quests: two layers like a session, plus the search index and `entityIds` that may point at secret pages.
// Pipeline tests; the deciding layers are tested directly in `codex-store.test.ts`.
describe("codex quests HTTP boundary", () => {
  const GM_BODY = "The ledger is a forgery; Strahd burned the real one.";
  const PLAYER_BODY = "Recover the ledger from the counting house.";
  const OBJECTIVES = [
    { text: "Find the counting house", done: true },
    { text: "Recover the ledger", done: false }
  ];

  it("gives a player the player layer and NEVER the gmBody, and 404s an unrevealed quest", async () => {
    const { base } = await fixture();
    const shown = await body(
      await post(base, "/api/v1/codex/quests", GM, {
        title: "The Wyrmwood Contract",
        status: "active",
        playerBody: PLAYER_BODY,
        gmBody: GM_BODY,
        objectives: OBJECTIVES
      })
    );
    const shownId = shown.data.quest.id as string;
    const secret = await body(
      await post(base, "/api/v1/codex/quests", GM, {
        title: "The Amber Bargain",
        playerBody: "Nobody has been told about this.",
        gmBody: "Vasili is Strahd."
      })
    );
    const secretId = secret.data.quest.id as string;

    const gmList = await body(await get(base, "/api/v1/codex/quests", GM));
    // Sorted: `fixture()` freezes the clock, so two quests share a `created_at` and fall to a random-uuid
    // tiebreak. List order is asserted in `codex-store.test.ts`, where the clock ticks.
    expect((gmList.data.quests as Json[]).map((row) => row.title).sort()).toEqual([
      "The Amber Bargain",
      "The Wyrmwood Contract"
    ]);
    expect(JSON.stringify(gmList)).toContain(GM_BODY);
    expect(JSON.stringify(gmList)).toContain(PLAYER_BODY);
    expect((gmList.data.quests as Json[]).find((row) => row.id === shownId)!.objectives).toEqual(OBJECTIVES);

    // Unrevealed: the player list is empty and the direct read is 404, never 403, since a status that
    // distinguishes "secret" from "absent" is itself a leak.
    expect((await body(await get(base, "/api/v1/codex/quests", PLAYER))).data.quests).toHaveLength(0);
    expect((await get(base, `/api/v1/codex/quests/${shownId}`, PLAYER)).status).toBe(404);

    await post(base, `/api/v1/codex/quests/${shownId}/reveal`, GM, { revealed: true });
    const playerList = await body(await get(base, "/api/v1/codex/quests", PLAYER));
    const rows = playerList.data.quests as Json[];
    expect(rows).toHaveLength(1); // the still-secret quest is absent
    // The exact projected key set, so any new field in the player quest projection fails here. `status` is
    // included: "what is still open" is the feature.
    expect(Object.keys(rows[0]).sort()).toEqual(["body", "entityIds", "id", "objectives", "status", "tags", "title"]);
    expect(rows[0].body).toBe(PLAYER_BODY);
    expect(rows[0].status).toBe("active");
    expect(rows[0].objectives).toEqual(OBJECTIVES); // order and tick state survive the wire

    const payload = JSON.stringify(playerList);
    expect(payload).not.toContain("forgery"); // the revealed quest's own GM body
    expect(payload).not.toContain("Vasili is Strahd"); // the unrevealed quest's GM body...
    expect(payload).not.toContain("Nobody has been told"); // ...and even its player body
    expect(payload).not.toContain(secretId); // ...and its id

    const single = await body(await get(base, `/api/v1/codex/quests/${shownId}`, PLAYER));
    expect(Object.keys(single.data.quest).sort()).toEqual([
      "body",
      "entityIds",
      "id",
      "objectives",
      "status",
      "tags",
      "title"
    ]);
    expect(JSON.stringify(single)).not.toContain("forgery");
    expect((await get(base, `/api/v1/codex/quests/${secretId}`, PLAYER)).status).toBe(404);
    expect((await get(base, `/api/v1/codex/quests/${secretId}`, GM)).status).toBe(200);
  });

  // `not-started` and `canceled` must survive the whole pipeline (schema, store, CHECK, both projections) and
  // reach a player as themselves; asserted on the player's re-read, including the chronicle row.
  it("carries not-started and canceled the whole way to a player, on the quest AND on the chronicle", async () => {
    const { base } = await fixture();
    const timeline = async (headers: Record<string, string>) =>
      (await body(await get(base, "/api/v1/codex/timeline", headers))).data.records as Json[];
    const questRows = async (headers: Record<string, string>) =>
      (await timeline(headers)).filter((row) => row.kind === "quest");

    // No `status` in the create body: the default, `not-started`, lands.
    const created = await body(
      await post(base, "/api/v1/codex/quests", GM, {
        title: "A rumour in Vallaki",
        playerBody: "Someone is buying coffins.",
        gmBody: GM_BODY
      })
    );
    const questId = created.data.quest.id as string;
    expect(created.data.quest.status).toBe("not-started");
    await post(base, `/api/v1/codex/quests/${questId}/reveal`, GM, { revealed: true });

    const asPlayer = async () =>
      (await body(await get(base, `/api/v1/codex/quests/${questId}`, PLAYER))).data.quest as Json;
    expect((await asPlayer()).status).toBe("not-started");

    // ...and the player's chronicle row for it. The create record is hidden by default, so reveal it; the
    // quest itself is already revealed.
    const recordFor = async (status: string) =>
      (await questRows(GM)).find((row) => (row.payload as Json).status === status)!;
    const startRecord = await recordFor("not-started");
    expect(
      startRecord,
      "R5 writes a history record on create, carrying the status the quest was created in"
    ).toBeDefined();
    await post(base, `/api/v1/codex/journal/${startRecord.id}/reveal`, GM, { revealed: true });
    const playerStart = (await questRows(PLAYER))[0]!;
    expect((playerStart.payload as Json).status, "the row a player reads as “… has not started”").toBe("not-started");
    expect((playerStart.payload as Json).questId).toBe(questId);

    const canceled = await patch(base, `/api/v1/codex/quests/${questId}`, GM, { status: "canceled" });
    expect(canceled.status).toBe(200);
    expect((await asPlayer()).status).toBe("canceled");
    // A status change appends a second history record carrying the status reached.
    expect(await questRows(GM)).toHaveLength(2);
    await post(base, `/api/v1/codex/journal/${(await recordFor("canceled")).id}/reveal`, GM, { revealed: true });
    // Sorted: the frozen clock gives both records the same date. Order is asserted in
    // `codex-store.test.ts`; here both statuses must reach the party's timeline.
    const playerRows = await questRows(PLAYER);
    expect(
      playerRows.map((row) => (row.payload as Json).status).sort(),
      "both statuses on the party's own timeline"
    ).toEqual(["canceled", "not-started"]);

    for (const status of ["active", "completed", "failed", "not-started"]) {
      expect((await patch(base, `/api/v1/codex/quests/${questId}`, GM, { status })).status, status).toBe(200);
      expect((await asPlayer()).status, status).toBe(status);
    }
    expect((await patch(base, `/api/v1/codex/quests/${questId}`, GM, { status: "cancelled" })).status).toBe(400);
    expect((await patch(base, `/api/v1/codex/quests/${questId}`, GM, { status: "abandoned" })).status).toBe(400);
  });

  it("hands a player only the linked entities that are themselves revealed", async () => {
    const { base } = await fixture();
    const shown = await body(
      await post(base, "/api/v1/codex/pages", GM, { title: "Vallaki", revealedToPlayers: true })
    );
    const hidden = await body(await post(base, "/api/v1/codex/pages", GM, { title: "The Amber Temple" }));
    const shownPageId = shown.data.page.id as string,
      hiddenPageId = hidden.data.page.id as string;
    const quest = await body(
      await post(base, "/api/v1/codex/quests", GM, { title: "Escort", entityIds: [shownPageId, hiddenPageId] })
    );
    await post(base, `/api/v1/codex/quests/${quest.data.quest.id}/reveal`, GM, { revealed: true });

    expect(
      (await body(await get(base, `/api/v1/codex/quests/${quest.data.quest.id}`, GM))).data.quest.entityIds
    ).toEqual([shownPageId, hiddenPageId]);
    const playerCopy = await body(await get(base, `/api/v1/codex/quests/${quest.data.quest.id}`, PLAYER));
    expect(playerCopy.data.quest.entityIds).toEqual([shownPageId]);
    // A revealed quest must not advertise the id of a page the party cannot see.
    expect(JSON.stringify(playerCopy)).not.toContain(hiddenPageId);
  });

  it("puts quests in the ONE suite-wide search list, gated end to end", async () => {
    const { base } = await fixture();
    const created = await body(
      await post(base, "/api/v1/codex/quests", GM, {
        title: "The Wyrmwood Contract",
        playerBody: PLAYER_BODY,
        gmBody: GM_BODY,
        objectives: OBJECTIVES
      })
    );
    const questId = created.data.quest.id as string;
    const search = async (term: string, headers: Record<string, string>) =>
      (await body(await get(base, `/api/v1/codex/search?q=${term}`, headers))).data.hits as Json[];

    expect(await search("Wyrmwood", GM)).toEqual([expect.objectContaining({ kind: "quest", id: questId })]);
    expect(await search("Wyrmwood", PLAYER)).toEqual([]);

    await post(base, `/api/v1/codex/quests/${questId}/reveal`, GM, { revealed: true });
    const hits = await search("Wyrmwood", PLAYER);
    expect(hits).toEqual([expect.objectContaining({ kind: "quest", id: questId })]);
    // The same uniform row shape every other kind emits. Quests carry no tags, hence `[]`.
    expect(Object.keys(hits[0]).sort()).toEqual(["entityType", "id", "kind", "mapId", "tags", "title"]);
    expect(hits[0].tags).toEqual([]);
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
    ])
      expect(response.status).toBe(403);
    const noauth = await get(base, "/api/v1/codex/quests", { "content-type": "application/json" });
    expect(noauth.status).toBe(401);
    expect((await body(noauth)).ok).toBe(false);
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
    const created = await body(
      await post(base, "/api/v1/codex/quests", GM, { title: "Order", objectives: OBJECTIVES })
    );
    const questId = created.data.quest.id as string;
    expect(created.data.quest.objectives).toEqual(OBJECTIVES);

    const reordered = [OBJECTIVES[1], { text: "A newly inserted step", done: false }, OBJECTIVES[0]];
    const updated = await body(
      await patch(base, `/api/v1/codex/quests/${questId}`, GM, { objectives: reordered, expectedRev: 1 })
    );
    expect(updated.data.quest.objectives).toEqual(reordered);
    expect((await body(await get(base, `/api/v1/codex/quests/${questId}`, GM))).data.quest.objectives).toEqual(
      reordered
    );
  });
});

// Deadlines, downtime and the prep clock, asserted on the serialized body. Projection and store halves are
// in `codex-projections.test.ts` and `codex-store.test.ts`.
describe("codex deadlines, downtime and the prep clock, HTTP boundary", () => {
  const calendar = async (base: string, headers: Record<string, string>) =>
    (await body(await get(base, "/api/v1/codex/calendar", headers))).data.calendar as Json;
  const chronicleRaw = async (base: string, headers: Record<string, string>) =>
    (await body(await get(base, "/api/v1/codex/timeline", headers))).data.records as Json[];
  const WORLD = {
    yearName: "DR",
    months: [
      { name: "Hammer", days: 30 },
      { name: "Alturiak", days: 30 }
    ],
    weekdays: ["First", "Second"]
  };

  /** The GM's clock (Alturiak 20) differs from the published date (Hammer 10), so returning the GM's clock cannot pass. */
  it("gives a player the PUBLISHED date while the GM's clock is ahead of it", async () => {
    const { base } = await fixture();
    await put(base, "/api/v1/codex/calendar", GM, { ...WORLD, currentDate: { year: 1492, month: 0, day: 10 } });
    await post(base, "/api/v1/codex/calendar/publish", GM, {});
    await put(base, "/api/v1/codex/calendar", GM, { ...WORLD, currentDate: { year: 1492, month: 1, day: 20 } });

    const gmCalendar = await calendar(base, GM);
    expect(gmCalendar.currentDate).toEqual({ year: 1492, month: 1, day: 20 });
    expect(gmCalendar.publishedDate).toEqual({ year: 1492, month: 0, day: 10 });

    const playerCalendar = await calendar(base, PLAYER);
    expect(playerCalendar.currentDate).toEqual({ year: 1492, month: 0, day: 10 });
    // On the serialized body: the GM's clock parts (month 1, day 20) appear nowhere, and neither does a
    // `publishedDate` key. The key list stays exact so adding one is a deliberate change.
    expect(Object.keys(playerCalendar).sort()).toEqual(["currentDate", "eras", "months", "weekdays", "yearName"]);
    expect(JSON.stringify(playerCalendar.currentDate)).not.toContain("20");

    await post(base, "/api/v1/codex/calendar/publish", GM, {});
    expect((await calendar(base, PLAYER)).currentDate).toEqual({ year: 1492, month: 1, day: 20 });
  });

  it("lists the published date in the reveal audit, under the label players see, until it is unpublished", async () => {
    const { base } = await fixture();
    const dateSection = async () =>
      ((await body(await get(base, "/api/v1/codex/reveal-audit", GM))).data.audit.sections as Json[]).find(
        (section) => section.kind === "date"
      )!;
    // An empty Codex's first date publishes itself.
    await put(base, "/api/v1/codex/calendar", GM, { ...WORLD, currentDate: { year: 1492, month: 0, day: 10 } });
    // The GM's clock moves on; the audit names the date players hold, not the GM's.
    await put(base, "/api/v1/codex/calendar", GM, { ...WORLD, currentDate: { year: 1492, month: 1, day: 20 } });
    const shown = await dateSection();
    expect(shown).toMatchObject({ revealed: 1, total: 1 });
    expect(shown.rows).toEqual([
      { kind: "date", id: "published-date", title: expect.stringContaining("Hammer"), journalKind: null }
    ]);

    await post(base, "/api/v1/codex/calendar/unpublish", GM, {});
    expect((await calendar(base, PLAYER)).currentDate).toBeNull();
    expect((await calendar(base, GM)).currentDate).toEqual({ year: 1492, month: 1, day: 20 });
    expect(await dateSection()).toMatchObject({ revealed: 0, rows: [] });
    expect((await post(base, "/api/v1/codex/calendar/unpublish", PLAYER, {})).status).toBe(403);
  });

  /** Neither deadline nor downtime reaches a player's chronicle until the ordinary reveal is set. */
  it("never puts an unrevealed deadline or downtime on a player's chronicle, and puts a revealed one there", async () => {
    const { base } = await fixture();
    await put(base, "/api/v1/codex/calendar", GM, { ...WORLD, currentDate: { year: 1492, month: 0, day: 10 } });
    const deadline = (
      await body(
        await post(base, "/api/v1/codex/journal/deadline", GM, {
          playerText: "The duke's tax falls due.",
          gmText: "He will send the guard.",
          inWorldDate: { year: 1492, month: 0, day: 20 }
        })
      )
    ).data.entry as Json;
    const downtime = (
      await body(
        await post(base, "/api/v1/codex/journal/downtime", GM, {
          playerText: "A quiet week.",
          gmText: "The cult moves while they rest.",
          downtime: { who: "Brannor", activity: "Forging a blade", days: 8, characterPageId: null }
        })
      )
    ).data.entry as Json;

    const gmPayload = JSON.stringify(await chronicleRaw(base, GM));
    expect(gmPayload).toContain("He will send the guard.");
    expect(gmPayload).toContain("Forging a blade");

    const hiddenPayload = JSON.stringify(await chronicleRaw(base, PLAYER));
    expect(hiddenPayload).not.toContain("The duke's tax falls due.");
    expect(hiddenPayload).not.toContain("A quiet week.");
    expect(hiddenPayload).not.toContain("Forging a blade");
    expect(hiddenPayload).not.toContain("He will send the guard.");

    // The ordinary reveal route publishes them (there is no kind-specific one), and then they are visible
    // like any other revealed record, kind included.
    for (const id of [deadline.id, downtime.id])
      expect((await post(base, `/api/v1/codex/journal/${id}/reveal`, GM, { revealed: true })).status).toBe(200);
    const shown = await chronicleRaw(base, PLAYER);
    expect(shown.map((row) => row.kind).sort()).toEqual(["deadline", "downtime"]);
    const shownPayload = JSON.stringify(shown);
    expect(shownPayload).toContain("The duke's tax falls due.");
    expect(shownPayload).toContain("Forging a blade");
    expect(shownPayload).not.toContain("He will send the guard.");
    expect(shownPayload).not.toContain("applied");
    expect(shownPayload).not.toContain("proposedDate");
    expect(shown.find((row) => row.kind === "downtime")!.payload).toEqual({
      who: "Brannor",
      activity: "Forging a blade",
      days: 8,
      characterPageId: null
    });
  });

  // `fired` is one bit, and computing a player's copy from the GM's clock would reveal that an unshown
  // date has passed. The deadline is Hammer 20; published is Hammer 10; the GM's clock is Alturiak 20.
  it("computes a player's `fired` from the published clock, not the GM's, end to end", async () => {
    const { base } = await fixture();
    await put(base, "/api/v1/codex/calendar", GM, { ...WORLD, currentDate: { year: 1492, month: 0, day: 10 } });
    await post(base, "/api/v1/codex/calendar/publish", GM, {});
    const deadline = (
      await body(
        await post(base, "/api/v1/codex/journal/deadline", GM, {
          playerText: "The duke's tax falls due.",
          revealedToPlayers: true,
          inWorldDate: { year: 1492, month: 0, day: 20 }
        })
      )
    ).data.entry as Json;
    await put(base, "/api/v1/codex/calendar", GM, { ...WORLD, currentDate: { year: 1492, month: 1, day: 20 } });

    const gmRow = (await chronicleRaw(base, GM)).find((row) => row.id === deadline.id)!;
    const playerRow = (await chronicleRaw(base, PLAYER)).find((row) => row.id === deadline.id)!;
    expect(gmRow.fired).toBe(true); // the GM's clock is past it
    expect(playerRow.fired).toBe(false); // the party's is not, and their row must say so

    await post(base, "/api/v1/codex/calendar/publish", GM, {});
    expect((await chronicleRaw(base, PLAYER)).find((row) => row.id === deadline.id)!.fired).toBe(true);
  });

  /** Confirming a clock move is a GM act; neither a player nor an anonymous caller can reach it. */
  it("refuses apply-downtime, deadline/downtime creation and publish to a player and to an anonymous caller", async () => {
    const { base } = await fixture();
    await put(base, "/api/v1/codex/calendar", GM, { ...WORLD, currentDate: { year: 1492, month: 0, day: 10 } });
    const downtime = (
      await body(
        await post(base, "/api/v1/codex/journal/downtime", GM, {
          downtime: { who: "Brannor", activity: "Forging", days: 8, characterPageId: null }
        })
      )
    ).data.entry as Json;

    for (const [headers, status, code] of [
      [PLAYER, 403, "forbidden"],
      [{ "content-type": "application/json" }, 401, "unauthenticated"]
    ] as const) {
      for (const path of [
        "/api/v1/codex/journal/deadline",
        "/api/v1/codex/journal/downtime",
        "/api/v1/codex/calendar/publish",
        `/api/v1/codex/journal/${downtime.id}/apply-downtime`
      ]) {
        const response = await post(base, path, headers, {
          downtime: { who: "x", activity: "y", days: 1 },
          inWorldDate: { year: 1492, month: 0, day: 1 }
        });
        expect(response.status, `${path}`).toBe(status);
        expect((await body(response)).error.code, `${path}`).toBe(code);
      }
    }
    expect((await calendar(base, GM)).currentDate).toEqual({ year: 1492, month: 0, day: 10 });
  });

  /** Create proposes, confirm applies, and a second confirm is refused. The clock is checked after every step. */
  it("proposes a date on create, moves the clock only on confirm, and refuses a second confirm", async () => {
    const { base } = await fixture();
    await put(base, "/api/v1/codex/calendar", GM, { ...WORLD, currentDate: { year: 1492, month: 0, day: 10 } });
    const created = (
      await body(
        await post(base, "/api/v1/codex/journal/downtime", GM, {
          playerText: "A quiet week.",
          downtime: { who: "Brannor", activity: "Forging", days: 8, characterPageId: null }
        })
      )
    ).data as Json;
    expect(created.proposedDate).toEqual({ year: 1492, month: 0, day: 18 });
    expect((await calendar(base, GM)).currentDate).toEqual({ year: 1492, month: 0, day: 10 }); // nothing moved

    const applied = await post(base, `/api/v1/codex/journal/${created.entry.id}/apply-downtime`, GM, {});
    expect(applied.status).toBe(200);
    expect((await body(applied)).data.calendar.currentDate).toEqual({ year: 1492, month: 0, day: 18 });
    expect((await calendar(base, GM)).currentDate).toEqual({ year: 1492, month: 0, day: 18 });
    // Applying moved only the GM's clock. The party is on day 10 because the first PUT seeded an empty codex,
    // which auto-publishes; that proves the clocks diverged.
    expect((await calendar(base, PLAYER)).currentDate).toEqual({ year: 1492, month: 0, day: 10 });

    const again = await post(base, `/api/v1/codex/journal/${created.entry.id}/apply-downtime`, GM, {});
    expect([400, 409]).toContain(again.status);
    expect((await calendar(base, GM)).currentDate).toEqual({ year: 1492, month: 0, day: 18 }); // and still nothing moved
  });

  // Only an empty codex auto-publishes its first date. With records present, setting a date is private until
  // `POST /codex/calendar/publish`, which still works from this state.
  it("does NOT publish the first date of a codex that already holds records, and publishes on request", async () => {
    const { base } = await fixture();
    await post(base, "/api/v1/codex/journal", GM, { playerText: "The party met in Daggerford." });
    expect((await calendar(base, PLAYER)).currentDate).toBeNull();

    await put(base, "/api/v1/codex/calendar", GM, { ...WORLD, currentDate: { year: 1492, month: 0, day: 10 } });
    const gmCalendar = await calendar(base, GM);
    expect(gmCalendar.currentDate).toEqual({ year: 1492, month: 0, day: 10 }); // the GM's clock moved...
    expect(gmCalendar.publishedDate).toBeNull(); // ...and the party's did not
    expect((await calendar(base, PLAYER)).currentDate).toBeNull();
    await put(base, "/api/v1/codex/calendar", GM, { ...WORLD, currentDate: { year: 1492, month: 1, day: 3 } });
    expect((await calendar(base, PLAYER)).currentDate).toBeNull();

    expect((await post(base, "/api/v1/codex/calendar/publish", GM, {})).status).toBe(200);
    expect((await calendar(base, PLAYER)).currentDate).toEqual({ year: 1492, month: 1, day: 3 });
  });

  // Seeding is about the codex being empty, not the journal: a GM who builds the world first (a page, a
  // map, a quest) and dates it afterwards is prepping. This catches `isUnusedCodex` checking one table only.
  it("treats a codex holding only a page as in use, so its first date stays private", async () => {
    const { base } = await fixture();
    await post(base, "/api/v1/codex/pages", GM, { title: "Daggerford", entityType: "location" });
    await put(base, "/api/v1/codex/calendar", GM, { ...WORLD, currentDate: { year: 1492, month: 0, day: 10 } });
    expect((await calendar(base, GM)).publishedDate).toBeNull();
    expect((await calendar(base, PLAYER)).currentDate).toBeNull();
  });

  // `.strict()` proves the route schemas apply (only this layer rejects unknown keys). The undated row is
  // defence in depth: `createDeadline` refuses it too.
  it("parses deadline and downtime bodies through their own schemas, and refuses an undated deadline", async () => {
    const { base } = await fixture();
    const dated = { year: 1492, month: 0, day: 20 };
    for (const [path, payload] of [
      ["/api/v1/codex/journal/deadline", { playerText: "Someday." }], // no date at all
      ["/api/v1/codex/journal/deadline", { playerText: "Someday.", inWorldDate: null }], // an explicit null is not a date
      ["/api/v1/codex/journal/deadline", { playerText: "x", inWorldDate: dated, kind: "deadline" }], // .strict(): the route names the kind, not the body
      ["/api/v1/codex/journal/downtime", { downtime: { who: "B", activity: "F", days: 8 }, applied: true }], // .strict(): `applied` is never an input
      ["/api/v1/codex/journal/downtime", { downtime: { who: "B", activity: "F", days: 8, applied: true } }], // ...nor inside the payload
      ["/api/v1/codex/journal/downtime", { downtime: { who: "B", activity: "F", days: -1 } }] // days is a count, not a rewind
    ] as const) {
      const response = await post(base, path, GM, payload);
      expect(response.status, `${path} ${JSON.stringify(payload)}`).toBe(400);
      expect((await body(response)).error.code).toBe("validation_failed");
    }
  });

  // Every downtime body the composer can produce is accepted (`canSubmit` allows prose, who or activity);
  // party-wide downtime with nobody named is normal.
  it("accepts every downtime body the composer can produce, including a blank who or activity", async () => {
    const { base } = await fixture();
    for (const payload of [
      { playerText: "The party rests a week.", downtime: { who: "", activity: "", days: 7 } }, // prose only
      { playerText: "", downtime: { who: "Brannor", activity: "Forging", days: 8, characterPageId: null } }, // fields only
      { playerText: "A quiet week.", downtime: { who: "Brannor", activity: "", days: 3, characterPageId: null } } // one half blank
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
    await store.initialize();
    await assets.initialize();
    cleanups.push(async () => {
      store.close();
      await rm(directory, { recursive: true, force: true });
    });
    const router = createCodexRouter({
      store,
      assets,
      authorizeGm: (token) => token === "gm-token",
      authorizePlayer: () => false,
      verifyIntegration: () => null,
      notifyChanged: () => {},
      issuePreviewSession: () => PREVIEW_TOKEN
    }) as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> };
    const byPath = new Map<string, Set<string>>();
    for (const layer of router.stack) {
      if (!layer.route) continue;
      // Reads Express's route table rather than probing over HTTP, so an unmounted documented path cannot
      // hide. Express writes `:id`; OpenAPI writes `{id}`.
      const path = layer.route.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
      const methods = byPath.get(path) ?? new Set<string>();
      for (const [method, on] of Object.entries(layer.route.methods)) if (on) methods.add(method.toLowerCase());
      byPath.set(path, methods);
    }
    return byPath;
  };

  it("mounts exactly the codex paths the contract declares", async () => {
    const mounted = await mountedRoutes();
    // `/api/v1/codex-assets` also starts with "/api/v1/codex", so the declared set is the union of both
    // constants rather than a prefix filter.
    const declared = [...Object.values(CODEX_PATHS), ...Object.values(CODEX_ASSET_PATHS)];
    expect([...mounted.keys()].sort()).toEqual([...declared].sort());
    expect(
      Object.keys(openApiDocument.paths)
        .filter((path) => path.startsWith("/api/v1/codex"))
        .sort()
    ).toEqual([...declared].sort());
  });

  it("mounts exactly the METHODS the contract declares on each codex path", async () => {
    const mounted = await mountedRoutes();
    const documented = (path: string) =>
      Object.keys((openApiDocument.paths as Record<string, Record<string, unknown>>)[path] ?? {})
        .filter((key) => ["get", "post", "patch", "put", "delete"].includes(key))
        .sort();
    for (const [path, methods] of mounted) {
      // A path-level match is not enough: a mounted method the contract does not document must fail too.
      expect([...methods].sort(), `${path} methods`).toEqual(documented(path));
    }
  });
});

// Standing, party marker, milestones and reveal audit, asserted on the serialized body. Projection and
// store halves are in `codex-projections.test.ts` and `codex-store.test.ts`.
describe("codex standing, party marker and reveal audit, HTTP boundary", () => {
  const faction = async (base: string, title: string, revealed: boolean) => {
    const page = await body(await post(base, "/api/v1/codex/pages", GM, { title, entityType: "faction" }));
    const id = page.data.page.id as string;
    if (revealed) await post(base, `/api/v1/codex/pages/${id}/reveal`, GM, { revealed: true });
    return id;
  };
  const makeMap = async (base: string, name: string, revealed: boolean) => {
    const map = await body(
      await post(base, "/api/v1/codex/maps", GM, { assetId: randomUUID(), name, kind: "regional" })
    );
    const id = map.data.map.id as string;
    if (revealed) await post(base, `/api/v1/codex/maps/${id}/reveal`, GM, { revealed: true });
    return id;
  };
  const makeMarker = async (base: string, mapId: string, label: string, revealed: boolean) => {
    const marker = await body(
      await post(base, `/api/v1/codex/maps/${mapId}/markers`, GM, {
        x: 0.5,
        y: 0.5,
        iconId: "pin",
        iconColor: "#ff2e9a",
        label,
        revealedToPlayers: revealed
      })
    );
    return marker.data.marker.id as string;
  };

  /** A player's standing list carries only what they may see, and a party pin on a hidden map stays hidden however it is flagged. */
  it("gives a player only revealed standing, and keeps a party pin on a hidden map hidden", async () => {
    const { base } = await fixture();
    const shownFaction = await faction(base, "The Harpers", true);
    const secretFaction = await faction(base, "The Zhentarim", true);
    await put(base, `/api/v1/codex/standing/${shownFaction}`, GM, { value: -40, reason: "Killed their envoy" });
    await put(base, `/api/v1/codex/standing/${secretFaction}`, GM, { value: 70, reason: "Paid the toll" });
    await post(base, `/api/v1/codex/standing/${shownFaction}/reveal`, GM, { revealed: true });

    const gmStanding = (await body(await get(base, "/api/v1/codex/standing", GM))).data.standing as Json[];
    expect(gmStanding.map((row) => row.value).sort((a, b) => a - b)).toEqual([-40, 70]);

    const playerStanding = (await body(await get(base, "/api/v1/codex/standing", PLAYER))).data.standing as Json[];
    expect(playerStanding).toHaveLength(1);
    expect(playerStanding[0].factionPageId).toBe(shownFaction);
    expect(playerStanding[0].value).toBe(-40); // the signed value survives the wire
    // The exact key set on the serialized row, so any new field in the player projection fails here.
    expect(Object.keys(playerStanding[0]).sort()).toEqual(["factionPageId", "value"]);
    const standingPayload = JSON.stringify(playerStanding);
    expect(standingPayload).not.toContain(secretFaction); // the unrevealed standing's faction...
    // ...and its value, asserted as the serialized field rather than the substring "70", which random
    // uuids often contain.
    expect(standingPayload).not.toContain('"value":70');
    expect(standingPayload).not.toContain("revealedToPlayers");

    // A revealed standing record on a secret faction reaches no player: with an empty player text, delta and
    // reason alone would reveal the faction. `secretFaction` is unrevealed only here.
    await post(base, `/api/v1/codex/pages/${secretFaction}/reveal`, GM, { revealed: false });
    const secretRecord = ((await body(await get(base, "/api/v1/codex/timeline", GM))).data.records as Json[]).find(
      (row) => row.kind === "standing" && row.payload?.reason === "Paid the toll"
    )!;
    expect(secretRecord).toBeDefined();
    await post(base, `/api/v1/codex/journal/${secretRecord.id}/reveal`, GM, { revealed: true });

    const playerTimeline = await body(await get(base, "/api/v1/codex/timeline", PLAYER));
    const timelineRaw = JSON.stringify(playerTimeline);
    expect(timelineRaw).not.toContain("Paid the toll");
    expect(timelineRaw).not.toContain(secretFaction);
    expect((playerTimeline.data.records as Json[]).some((row) => row.kind === "standing")).toBe(false);
    expect(JSON.stringify(await body(await get(base, "/api/v1/codex/timeline", GM)))).toContain("Paid the toll");

    // The same record on the other player journal surfaces, which all delegate to `projectPlayerJournalEntry`,
    // including the PATCH-then-search path.
    const playerJournal = await body(await get(base, "/api/v1/codex/journal", PLAYER));
    expect(JSON.stringify(playerJournal)).not.toContain("Paid the toll");
    expect((playerJournal.data.entries as Json[]).some((row) => row.kind === "standing")).toBe(false);

    // Give the record prose and a tag, as a GM would, then search as a player.
    await patch(base, `/api/v1/codex/journal/${secretRecord.id}`, GM, {
      playerText: "The Zhentarim have marked you.",
      tags: ["zhent"]
    });
    for (const term of ["Zhentarim", "zhent", "marked"]) {
      const hits = (await body(await get(base, `/api/v1/codex/search?q=${term}`, PLAYER))).data.hits as Json[];
      expect(
        hits.filter((hit) => hit.kind === "journal"),
        `player search for "${term}"`
      ).toEqual([]);
    }
    expect(
      ((await body(await get(base, "/api/v1/codex/search?q=Zhentarim", GM))).data.hits as Json[]).length
    ).toBeGreaterThan(0);

    const auditSections = (await body(await get(base, "/api/v1/codex/reveal-audit", GM))).data.audit.sections as Json[];
    expect(JSON.stringify(auditSections.find((s) => s.kind === "journal"))).not.toContain("Zhentarim");

    // The party pin, revealed, on a hidden map.
    const secretMap = await makeMap(base, "The Under-dark", false);
    const shownMap = await makeMap(base, "Barovia", true);
    const hiddenParty = await makeMarker(base, secretMap, "The party", true);
    await put(base, `/api/v1/codex/markers/${hiddenParty}/party`, GM, { isParty: true });

    const gmMarkers = (await body(await get(base, `/api/v1/codex/maps/${secretMap}/markers`, GM))).data
      .markers as Json[];
    expect(gmMarkers[0].isParty).toBe(true);
    expect((await get(base, `/api/v1/codex/maps/${secretMap}/markers`, PLAYER)).status).toBe(404);
    expect(JSON.stringify(await body(await get(base, "/api/v1/codex/maps", PLAYER)))).not.toContain(secretMap);

    // Move the party to a pin on a map the party can see: now it travels, with `isParty` and nothing else new.
    const shownPin = await makeMarker(base, shownMap, "Camp", true);
    await put(base, `/api/v1/codex/markers/${shownPin}/party`, GM, { isParty: true });
    const playerMarkers = (await body(await get(base, `/api/v1/codex/maps/${shownMap}/markers`, PLAYER))).data
      .markers as Json[];
    expect(playerMarkers).toHaveLength(1);
    expect(playerMarkers[0].isParty).toBe(true);
    expect(Object.keys(playerMarkers[0]).sort()).toEqual([
      "iconColor",
      "iconId",
      "id",
      "isParty",
      "label",
      "mapId",
      "pageIds",
      "subMapId",
      "tags",
      "x",
      "y"
    ]);

    // One party pin atlas-wide: flagging the new one cleared the old, with no second call.
    expect((await body(await get(base, `/api/v1/codex/maps/${secretMap}/markers`, GM))).data.markers[0].isParty).toBe(
      false
    );
  });

  // Turning the flag off is scoped to the pin it was sent to: `setPartyMarker(null)` clears whichever pin
  // holds it, so calling it unconditionally would unset a different party pin.
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

    await put(base, `/api/v1/codex/markers/${partyPin}/party`, GM, { isParty: false });
    expect(
      ((await body(await get(base, `/api/v1/codex/maps/${mapId}/markers`, GM))).data.markers as Json[]).filter(
        (row) => row.isParty
      )
    ).toHaveLength(0);
    // An unknown marker is a 404, not a silent no-op that clears the flag from somewhere else.
    expect((await put(base, `/api/v1/codex/markers/${randomUUID()}/party`, GM, { isParty: false })).status).toBe(404);
  });

  /** The audit is a GM surface; a player and an anonymous caller are refused. */
  it("refuses the reveal audit to a player and to an anonymous caller", async () => {
    const { base } = await fixture();
    for (const [headers, status, code] of [
      [PLAYER, 403, "forbidden"],
      [{ "content-type": "application/json" }, 401, "unauthenticated"]
    ] as const) {
      const response = await get(base, "/api/v1/codex/reveal-audit", headers);
      expect(response.status).toBe(status);
      expect((await body(response)).error.code).toBe(code);
    }
    expect((await get(base, "/api/v1/codex/reveal-audit", GM)).status).toBe(200);
  });

  // The audit's counts and ids must equal what player endpoints return, for every type. Each category has a
  // revealed, an unrevealed and, where a second gate exists, a flagged-but-invisible record.
  it("matches the real player reads exactly, for every record type", async () => {
    const { base } = await fixture();

    // Pages: one revealed, one not. (The faction pages below add two more revealed pages.)
    const shownPage = await body(
      await post(base, "/api/v1/codex/pages", GM, { title: "Vallaki", revealedToPlayers: true })
    );
    await post(base, "/api/v1/codex/pages", GM, { title: "The Amber Temple" });

    const shownMap = await makeMap(base, "Barovia", true);
    const secretMap = await makeMap(base, "The Amber Vaults", false);

    // Markers: one revealed on the revealed map, one unrevealed on it, and one revealed on the secret map,
    // which separates "flagged revealed" from "the party can see it".
    const shownMarker = await makeMarker(base, shownMap, "Camp", true);
    await makeMarker(base, shownMap, "The ambush", false);
    await makeMarker(base, secretMap, "The vault door", true);

    // Journal: one revealed note, one hidden, plus a milestone revealed through the ordinary route.
    const shownEntry = await body(
      await post(base, "/api/v1/codex/journal", GM, { playerText: "They reached the gate.", revealedToPlayers: true })
    );
    await post(base, "/api/v1/codex/journal", GM, { playerText: "The cult moves." });
    const milestone = await body(
      await post(base, "/api/v1/codex/journal/milestone", GM, {
        playerText: "Level up.",
        milestone: { level: 5, reason: "Cleared the crypt" }
      })
    );
    expect(milestone.data.entry.kind).toBe("milestone");
    await post(base, `/api/v1/codex/journal/${milestone.data.entry.id}/reveal`, GM, { revealed: true });

    const shownSession = await body(
      await post(base, "/api/v1/codex/sessions", GM, {
        sessionNumber: 4,
        recapBody: "They reached the gate.",
        revealedToPlayers: true
      })
    );
    await post(base, "/api/v1/codex/sessions", GM, { sessionNumber: 5, prepBody: "The ambush." });
    const shownQuest = await body(await post(base, "/api/v1/codex/quests", GM, { title: "The Wyrmwood Contract" }));
    await post(base, `/api/v1/codex/quests/${shownQuest.data.quest.id}/reveal`, GM, { revealed: true });
    await post(base, "/api/v1/codex/quests", GM, { title: "The Amber Bargain" });

    // Standing: one revealed on a revealed faction, one revealed on a secret faction (the second gate), and
    // one not revealed.
    const shownFaction = await faction(base, "The Harpers", true);
    const secretFaction = await faction(base, "The Zhentarim", false);
    const quietFaction = await faction(base, "The Emerald Enclave", true);
    for (const [id, value] of [
      [shownFaction, -40],
      [secretFaction, 70],
      [quietFaction, 10]
    ] as const) {
      await put(base, `/api/v1/codex/standing/${id}`, GM, { value, reason: "Because" });
    }
    await post(base, `/api/v1/codex/standing/${shownFaction}/reveal`, GM, { revealed: true });
    await post(base, `/api/v1/codex/standing/${secretFaction}/reveal`, GM, { revealed: true });

    const audit = (await body(await get(base, "/api/v1/codex/reveal-audit", GM))).data.audit as Json;
    const section = (kind: string) => (audit.sections as Json[]).find((entry) => entry.kind === kind)!;
    const auditIds = (kind: string) => (section(kind).rows as Json[]).map((row) => row.id as string).sort();

    const playerPages = (await body(await get(base, "/api/v1/codex/pages", PLAYER))).data.pages as Json[];
    const playerMaps = (await body(await get(base, "/api/v1/codex/maps", PLAYER))).data.maps as Json[];
    const playerMarkers: Json[] = [];
    for (const map of playerMaps)
      playerMarkers.push(
        ...((await body(await get(base, `/api/v1/codex/maps/${map.id}/markers`, PLAYER))).data.markers as Json[])
      );
    const playerEntries = (await body(await get(base, "/api/v1/codex/journal", PLAYER))).data.entries as Json[];
    const playerSessions = (await body(await get(base, "/api/v1/codex/sessions", PLAYER))).data.sessions as Json[];
    const playerQuests = (await body(await get(base, "/api/v1/codex/quests", PLAYER))).data.quests as Json[];
    const playerStanding = (await body(await get(base, "/api/v1/codex/standing", PLAYER))).data.standing as Json[];

    const ids = (rows: Json[], key = "id") => rows.map((row) => row[key] as string).sort();
    for (const [kind, rows, key] of [
      ["page", playerPages, "id"],
      ["map", playerMaps, "id"],
      ["marker", playerMarkers, "id"],
      ["journal", playerEntries, "id"],
      ["session", playerSessions, "id"],
      ["quest", playerQuests, "id"],
      // A standing row is addressed by its faction page id, which its reveal route takes.
      ["standing", playerStanding, "factionPageId"]
    ] as const) {
      expect(section(kind).revealed, `${kind} count`).toBe(rows.length);
      expect(auditIds(kind), `${kind} ids`).toEqual(ids(rows as Json[], key));
      // Non-vacuous: every category has something in it, so no line above is 0 === 0.
      expect(section(kind).revealed, `${kind} must not be empty`).toBeGreaterThan(0);
    }

    // The cases an audit built on the raw reveal flag gets wrong:
    //   a revealed pin on a secret map is not visible...
    expect(section("marker").total).toBe(3);
    expect(section("marker").revealed).toBe(1);
    expect(auditIds("marker")).toEqual([shownMarker]);
    //   ...and a revealed standing on a secret faction is not visible either.
    expect(section("standing").total).toBe(3);
    expect(section("standing").revealed).toBe(1);
    expect(auditIds("standing")).toEqual([shownFaction]);
    expect(JSON.stringify(audit)).not.toContain(secretFaction);

    expect(section("journal").revealed).toBe(2); // the note and the revealed milestone
    expect(auditIds("journal")).toEqual([milestone.data.entry.id, shownEntry.data.entry.id].sort());
    expect((section("page").rows as Json[]).map((row) => row.title)).toContain("Vallaki");
    expect((section("session").rows as Json[])[0].title).toBe("Session 4");
    expect(audit.revealed).toBe(
      (audit.sections as Json[]).reduce((count, entry) => count + (entry.revealed as number), 0)
    );
    expect(shownPage.data.page.id).toBeTruthy();
    expect(shownSession.data.session.id).toBeTruthy();
  });

  // A journal row's kind survives the route, and the row matches its contract component.
  // `CodexRevealAuditRow` has no Zod twin, so the keys are compared to the component's `required` list here.
  it("carries a journal row's kind over the wire as its own field, matching CodexRevealAuditRow exactly", async () => {
    const { base } = await fixture();
    // The same player text on both, so only the new field can tell them apart.
    const deadline = await body(
      await post(base, "/api/v1/codex/journal/deadline", GM, {
        playerText: "The tax is due.",
        inWorldDate: { year: 1492, month: 0, day: 20 }
      })
    );
    const note = await body(await post(base, "/api/v1/codex/journal", GM, { playerText: "The tax is due." }));
    for (const id of [deadline.data.entry.id, note.data.entry.id] as string[]) {
      await post(base, `/api/v1/codex/journal/${id}/reveal`, GM, { revealed: true });
    }
    const quest = await body(await post(base, "/api/v1/codex/quests", GM, { title: "The Wyrmwood Contract" }));
    await post(base, `/api/v1/codex/quests/${quest.data.quest.id}/reveal`, GM, { revealed: true });

    const sections = (await body(await get(base, "/api/v1/codex/reveal-audit", GM))).data.audit.sections as Json[];
    const rowsOf = (kind: string) => sections.find((entry) => entry.kind === kind)!.rows as Json[];
    const journalRows = rowsOf("journal");
    expect(journalRows.map((row) => row.title)).toEqual(["The tax is due.", "The tax is due."]);
    expect(new Map(journalRows.map((row) => [row.id as string, row.journalKind as string]))).toEqual(
      new Map([
        [deadline.data.entry.id as string, "deadline"],
        [note.data.entry.id as string, "note"]
      ])
    );
    expect(rowsOf("quest")).toEqual([
      { kind: "quest", id: quest.data.quest.id, title: "The Wyrmwood Contract", journalKind: null }
    ]);

    const component = (
      openApiDocument as unknown as {
        components: { schemas: Record<string, { required: string[]; properties: Record<string, unknown> }> };
      }
    ).components.schemas.CodexRevealAuditRow;
    expect(component.required).toEqual(Object.keys(component.properties)); // no documented-but-optional key
    for (const row of [...journalRows, ...rowsOf("quest")])
      expect(Object.keys(row).sort()).toEqual([...component.required].sort());
  });

  /** Un-revealing from the audit uses each kind's existing reveal route; there is no separate unreveal or bulk verb. */
  it("drops a record from the audit when the GM un-reveals it through that kind's own reveal route", async () => {
    const { base } = await fixture();
    const quest = await body(await post(base, "/api/v1/codex/quests", GM, { title: "The Wyrmwood Contract" }));
    const questId = quest.data.quest.id as string;
    await post(base, `/api/v1/codex/quests/${questId}/reveal`, GM, { revealed: true });
    const auditOf = async () =>
      ((await body(await get(base, "/api/v1/codex/reveal-audit", GM))).data.audit.sections as Json[]).find(
        (entry) => entry.kind === "quest"
      )!;
    expect((await auditOf()).rows).toEqual([
      { kind: "quest", id: questId, title: "The Wyrmwood Contract", journalKind: null }
    ]);

    await post(base, `/api/v1/codex/quests/${questId}/reveal`, GM, { revealed: false });
    expect((await auditOf()).revealed).toBe(0);
    expect((await auditOf()).total).toBe(1); // still there, just not public
    expect((await body(await get(base, "/api/v1/codex/quests", PLAYER))).data.quests).toHaveLength(0);
  });

  /** The audit and standing routes are documented with the security they enforce. */
  it("documents the routes with the roles they enforce", async () => {
    const paths = openApiDocument.paths as unknown as Record<
      string,
      Record<string, { security?: ReadonlyArray<Record<string, readonly string[]>> }>
    >;
    // The one read a player may make here; the audit and every write have no player branch. Codex scopes
    // sit beside the sessions on each (a credential acts at GM grade); the player branch is what decides leaks.
    expect(paths[CODEX_PATHS.standing].get.security).toEqual([
      { bearerAuth: ["codex:read"] },
      { gmAuth: [] },
      { playerAuth: [] }
    ]);
    for (const [path, method] of [
      [CODEX_PATHS.revealAudit, "get"],
      [CODEX_PATHS.standingByFaction, "put"],
      [CODEX_PATHS.standingReveal, "post"],
      [CODEX_PATHS.journalMilestone, "post"],
      [CODEX_PATHS.markerParty, "put"]
    ] as const) {
      const security = paths[path][method].security ?? [];
      expect(
        security.some((entry) => "playerAuth" in entry),
        `${method} ${path} must never accept a player session`
      ).toBe(false);
      expect(security.find((entry) => "bearerAuth" in entry)?.bearerAuth, `${method} ${path} scope`).toEqual([
        method === "get" ? "codex:read" : "codex:write"
      ]);
    }
  });

  // The write schemas are applied, proved by `.strict()` (an unknown key is a rejection only this layer
  // performs). The missing-payload row is defence in depth: `createMilestone` refuses it too.
  it("parses the bodies through their own schemas", async () => {
    const { base } = await fixture();
    const factionId = await faction(base, "The Harpers", true);
    const mapId = await makeMap(base, "Barovia", true);
    const markerId = await makeMarker(base, mapId, "Camp", true);
    for (const [method, path, payload] of [
      ["PUT", `/api/v1/codex/standing/${factionId}`, { value: 150 }], // outside the signed scale
      ["PUT", `/api/v1/codex/standing/${factionId}`, { value: 10, revealed: true }], // .strict(): reveal is its own route
      ["POST", "/api/v1/codex/journal/milestone", { milestone: { level: 0, reason: "x" } }], // no character is level 0
      ["POST", "/api/v1/codex/journal/milestone", { milestone: { level: 5 }, kind: "milestone" }], // .strict(): the route names the kind
      ["POST", "/api/v1/codex/journal/milestone", { playerText: "Level up." }], // the payload is required
      ["PUT", `/api/v1/codex/markers/${markerId}/party`, { isParty: "yes" }] // a flag, not a string
    ] as const) {
      const response = method === "PUT" ? await put(base, path, GM, payload) : await post(base, path, GM, payload);
      expect(response.status, `${method} ${path} ${JSON.stringify(payload)}`).toBe(400);
      expect((await body(response)).error.code).toBe("validation_failed");
    }
    expect((await put(base, `/api/v1/codex/standing/${factionId}`, GM, { value: -40 })).status).toBe(200);
    expect((await post(base, "/api/v1/codex/journal/milestone", GM, { milestone: { level: 5 } })).status).toBe(201);
    // An unknown faction is a 404, not a silently created standing row.
    expect((await put(base, `/api/v1/codex/standing/${randomUUID()}`, GM, { value: 10 })).status).toBe(404);
  });
});

// Revision settings and the revision delete at the HTTP boundary; the throttle arithmetic is tested in
// `codex-store.test.ts`. This fixture's clock is frozen, so nothing after the creation checkpoint commits.
describe("codex settings and the revision delete, HTTP boundary (owner decision, 2026-07-30)", () => {
  const settings = async (base: string, headers: Record<string, string>) =>
    (await body(await get(base, "/api/v1/codex/settings", headers))).data.settings as Json;
  it("serves the owner's defaults, with the usage figures, in exactly the shape the client reads", async () => {
    const { base } = await fixture();
    const payload = await settings(base, GM);
    // The whole shape, by key set and value: an extra or renamed key is a client break.
    expect(Object.keys(payload)).toEqual(["revisionHistory", "autosave"]);
    expect(Object.keys(payload.revisionHistory).sort()).toEqual([
      "enabled",
      "versionBytes",
      "versionCount",
      "windowMinutes"
    ]);
    expect(payload.revisionHistory).toEqual({ enabled: true, windowMinutes: 90, versionCount: 0, versionBytes: 0 });
  });

  it("is GM-only on BOTH sides, and on the delete — a player gets 403 and changes nothing", async () => {
    const { base, store } = await fixture();
    store.createPage({ title: "Barovia", playerBody: "a valley" });

    expect((await get(base, "/api/v1/codex/settings", PLAYER)).status).toBe(403);
    expect(
      (
        await put(base, "/api/v1/codex/settings", PLAYER, {
          revisionHistory: { enabled: false, windowMinutes: 0 },
          autosave: AUTOSAVE_DEFAULT
        })
      ).status
    ).toBe(403);
    expect((await del(base, "/api/v1/codex/page-revisions", PLAYER, { olderThanDays: 0 })).status).toBe(403);
    expect((await settings(base, GM)).revisionHistory).toEqual({
      enabled: true,
      windowMinutes: 90,
      versionCount: 1,
      versionBytes: expect.any(Number)
    });
  });

  it("stores the two knobs, answers with the full read shape, and reports them back on the next GET", async () => {
    const { base } = await fixture();
    const written = (
      await body(
        await put(base, "/api/v1/codex/settings", GM, {
          revisionHistory: { enabled: false, windowMinutes: 240 },
          autosave: AUTOSAVE_DEFAULT
        })
      )
    ).data.settings as Json;
    // The PUT's response is the read shape, usage figures included; the client puts it straight into state.
    expect(written.revisionHistory).toEqual({ enabled: false, windowMinutes: 240, versionCount: 0, versionBytes: 0 });
    expect((await settings(base, GM)).revisionHistory).toMatchObject({ enabled: false, windowMinutes: 240 });
  });

  // Autosave is in seconds, defaulting to `{enabled: true, intervalSeconds: 1}`; out-of-range values are
  // rejected and fractional ones truncated, as with `windowMinutes`.
  it("carries autosave in seconds, defaults to on at one second, and rejects an out-of-range interval", async () => {
    const { base } = await fixture();
    expect((await settings(base, GM)).autosave).toEqual({ enabled: true, intervalSeconds: 1 });

    const written = (
      await body(
        await put(base, "/api/v1/codex/settings", GM, {
          revisionHistory: { enabled: true, windowMinutes: 90 },
          autosave: { enabled: false, intervalSeconds: 60.4 }
        })
      )
    ).data.settings as Json;
    expect(written.autosave).toEqual({ enabled: false, intervalSeconds: 60 });
    expect((await settings(base, GM)).autosave).toEqual({ enabled: false, intervalSeconds: 60 });

    for (const intervalSeconds of [0, -1, 601]) {
      const rejected = await put(base, "/api/v1/codex/settings", GM, {
        revisionHistory: { enabled: true, windowMinutes: 90 },
        autosave: { enabled: true, intervalSeconds }
      });
      expect(rejected.status, `intervalSeconds ${intervalSeconds}`).toBe(400);
      expect((await body(rejected)).error.details.issues.length).toBeGreaterThan(0);
    }
    // An unknown key inside the group is a 400 too: `.strict()`, like every other codex body.
    expect(
      (
        await put(base, "/api/v1/codex/settings", GM, {
          revisionHistory: { enabled: true, windowMinutes: 90 },
          autosave: { enabled: true, intervalSeconds: 5, intervalMs: 5000 }
        })
      ).status
    ).toBe(400);
    expect((await settings(base, GM)).autosave).toEqual({ enabled: false, intervalSeconds: 60 });
  });

  it("truncates a fractional window but REJECTS one out of range", async () => {
    const { base } = await fixture();
    // In range but unrounded: accepted and truncated, as a slider artefact.
    const truncated = (
      await body(
        await put(base, "/api/v1/codex/settings", GM, {
          revisionHistory: { enabled: true, windowMinutes: 45.7 },
          autosave: AUTOSAVE_DEFAULT
        })
      )
    ).data.settings as Json;
    expect(truncated.revisionHistory.windowMinutes).toBe(45);
    // Out of range either way: a 400, since the GM's control cannot produce one.
    for (const windowMinutes of [-1, 10_081]) {
      const rejected = await put(base, "/api/v1/codex/settings", GM, {
        revisionHistory: { enabled: true, windowMinutes },
        autosave: AUTOSAVE_DEFAULT
      });
      expect(rejected.status, `windowMinutes ${windowMinutes}`).toBe(400);
      expect((await body(rejected)).error.code).toBe("validation_failed");
    }
    expect((await settings(base, GM)).revisionHistory.windowMinutes).toBe(45);
  });

  // The usage figures are read-only. Sending either is a 400 rather than an ignored key (every schema in
  // `codex-http.ts` is `.strict()`): they are facts about a table the caller cannot see.
  it("refuses a body that tries to assert the usage figures, and stores nothing", async () => {
    const { base, store } = await fixture();
    store.createPage({ title: "Vallaki", playerBody: "a walled town" });
    const before = await settings(base, GM);

    for (const extra of [{ versionCount: 0 }, { versionBytes: 0 }, { versionCount: 9, versionBytes: 9 }]) {
      const rejected = await put(base, "/api/v1/codex/settings", GM, {
        revisionHistory: { enabled: true, windowMinutes: 90, ...extra },
        autosave: AUTOSAVE_DEFAULT
      });
      expect(rejected.status, JSON.stringify(extra)).toBe(400);
    }
    // A missing knob is a 400: the PUT replaces settings wholesale, so a half-body is not a partial edit.
    expect(
      (
        await put(base, "/api/v1/codex/settings", GM, {
          revisionHistory: { windowMinutes: 90 },
          autosave: AUTOSAVE_DEFAULT
        })
      ).status
    ).toBe(400);
    // ...and so is a body without the autosave group, for the same reason.
    expect(
      (await put(base, "/api/v1/codex/settings", GM, { revisionHistory: { enabled: true, windowMinutes: 90 } })).status
    ).toBe(400);
    expect((await put(base, "/api/v1/codex/settings", GM, {})).status).toBe(400);
    expect(await settings(base, GM)).toEqual(before);
    expect(before.revisionHistory.versionCount).toBe(1);
  });

  it("deletes every revision at olderThanDays 0 and answers with the real count", async () => {
    const { base, store } = await fixture();
    store.setSettings({ revisionHistory: { enabled: true, windowMinutes: 0 }, autosave: AUTOSAVE_DEFAULT }); // keep every save; frozen clock
    const page = store.createPage({ title: "Krezk", playerBody: "v0" });
    // Two edits: the first one's prior state is rev 1, already checkpointed at creation, so the duplicate is
    // suppressed. Two pages plus one distinct edit = three rows.
    store.updatePage(page.id, { playerBody: "v1" }, undefined, "gm");
    store.updatePage(page.id, { playerBody: "v2" }, undefined, "gm");
    store.createPage({ title: "Berez", playerBody: "swamp" });
    expect((await settings(base, GM)).revisionHistory.versionCount).toBe(3);

    const deleted = await del(base, "/api/v1/codex/page-revisions", GM, { olderThanDays: 0 });
    expect(deleted.status).toBe(200);
    expect((await body(deleted)).data).toEqual({ deleted: 3 });
    expect((await settings(base, GM)).revisionHistory).toMatchObject({ versionCount: 0, versionBytes: 0 });
    expect((await body(await del(base, "/api/v1/codex/page-revisions", GM, { olderThanDays: 0 }))).data).toEqual({
      deleted: 0
    });

    // ...and the pages are all still there with their bodies: a page's current state is not a version.
    const pages = (await body(await get(base, "/api/v1/codex/pages", GM))).data.pages as Json[];
    expect(pages.map((row) => row.title).sort()).toEqual(["Berez", "Krezk"]);
    expect((await body(await get(base, `/api/v1/codex/pages/${page.id}`, GM))).data.page).toMatchObject({
      playerBody: "v2",
      rev: 3
    });
  });

  it("400s a negative, fractional or absurd age, and deletes nothing when it does", async () => {
    const { base, store } = await fixture();
    store.createPage({ title: "Yester Hill", playerBody: "standing stones" });
    for (const olderThanDays of [-1, 3.5, 36_501, "7", null]) {
      const rejected = await del(base, "/api/v1/codex/page-revisions", GM, { olderThanDays });
      expect(rejected.status, `olderThanDays ${JSON.stringify(olderThanDays)}`).toBe(400);
      expect((await body(rejected)).error.code).toBe("validation_failed");
    }
    // An empty body is a 400 too: the destructive route has no default meaning.
    expect((await del(base, "/api/v1/codex/page-revisions", GM, {})).status).toBe(400);
    expect((await settings(base, GM)).revisionHistory.versionCount).toBe(1);
  });
});

// Two reads, one compound gate (pin and map revealed). The by-id read 404s so an id is not a probe; the party
// read answers `null`, so a hidden party pin looks like no party pin.
describe("codex pin-by-id and party location, HTTP boundary", () => {
  const seed = async (base: string, store: CodexStore) => {
    const page = store.createPage({ title: "Vallaki", playerBody: "a walled town" });
    const secretPage = store.createPage({ title: "The Ambush", gmBody: "here" });
    const map = store.createMap({ assetId: randomUUID(), name: "Barovia", kind: "regional" });
    const marker = store.createMarker(map.id, {
      x: 0.5,
      y: 0.5,
      iconId: "pin",
      iconColor: "#ff2e9a",
      label: "Village",
      pageIds: [page.id, secretPage.id],
      tags: ["stop"]
    });
    store.setPageRevealed(page.id, true);
    void base;
    return { page, secretPage, map, marker };
  };

  it("gives a player a revealed pin on a revealed map, with links filtered and GM linkage stripped", async () => {
    const { base, store } = await fixture();
    const { page, map, marker } = await seed(base, store);
    store.setMapRevealed(map.id, true);
    store.setMarkerRevealed(marker.id, true);

    const gm = (await body(await get(base, `/api/v1/codex/markers/${marker.id}`, GM))).data.marker as Json;
    expect(gm.mapId).toBe(map.id);
    expect(gm.pageIds).toHaveLength(2);

    const player = (await body(await get(base, `/api/v1/codex/markers/${marker.id}`, PLAYER))).data.marker as Json;
    // The exact key set: `sceneIds`, `actorId`, `revealedToPlayers` and timestamps are absent, and
    // `pageIds` carries only the page the player can open.
    expect(Object.keys(player).sort()).toEqual([
      "iconColor",
      "iconId",
      "id",
      "isParty",
      "label",
      "mapId",
      "pageIds",
      "subMapId",
      "tags",
      "x",
      "y"
    ]);
    expect(player.pageIds).toEqual([page.id]);
  });

  it("404s a player on a hidden pin, on a pin sitting on a hidden map, and on a bogus id - the same body each time", async () => {
    const { base, store } = await fixture();
    const { map, marker } = await seed(base, store);

    const bodies: string[] = [];
    // Pin hidden, map hidden.
    let response = await get(base, `/api/v1/codex/markers/${marker.id}`, PLAYER);
    expect(response.status).toBe(404);
    bodies.push(JSON.stringify((await body(response)).error.message));

    // Pin revealed, map still hidden: the compound half a marker-flag-only gate would miss. The GM can read
    // it throughout, so these 404s are the gate.
    store.setMarkerRevealed(marker.id, true);
    response = await get(base, `/api/v1/codex/markers/${marker.id}`, PLAYER);
    expect(response.status, "a revealed pin on a SECRET map is invisible - CD-6").toBe(404);
    bodies.push(JSON.stringify((await body(response)).error.message));
    expect((await get(base, `/api/v1/codex/markers/${marker.id}`, GM)).status).toBe(200);

    response = await get(base, `/api/v1/codex/markers/${randomUUID()}`, PLAYER);
    expect(response.status).toBe(404);
    bodies.push(JSON.stringify((await body(response)).error.message));
    // Identical bodies: a hidden pin must be indistinguishable from one that never existed.
    expect(new Set(bodies).size, "the three 404s must not be tellable apart").toBe(1);

    store.setMapRevealed(map.id, true);
    expect((await get(base, `/api/v1/codex/markers/${marker.id}`, PLAYER)).status).toBe(200);
  });

  it("answers the party read with null - never a 404 - when there is no party pin or the player may not see it", async () => {
    const { base, store } = await fixture();
    const { map, marker } = await seed(base, store);

    // No party pin at all: both roles get exactly `{ party: null }`.
    for (const headers of [GM, PLAYER]) {
      const response = await get(base, "/api/v1/codex/party", headers);
      expect(response.status).toBe(200);
      expect((await body(response)).data).toEqual({ party: null });
    }

    store.setPartyMarker(marker.id);
    // The GM sees it immediately; reveal state is not the GM's gate.
    const gmParty = (await body(await get(base, "/api/v1/codex/party", GM))).data.party as Json;
    expect(gmParty.mapName).toBe("Barovia");
    expect(gmParty.marker.mapId, "the jump target rides on the marker, not as a sibling key").toBe(map.id);

    // The player gets null while the pin is hidden, indistinguishable from "no party pin": `isParty` must
    // never enter a visibility predicate.
    expect((await body(await get(base, "/api/v1/codex/party", PLAYER))).data).toEqual({ party: null });
    store.setMarkerRevealed(marker.id, true);
    expect(
      (await body(await get(base, "/api/v1/codex/party", PLAYER))).data,
      "a revealed pin on a hidden map is still null"
    ).toEqual({ party: null });

    store.setMapRevealed(map.id, true);
    const shown = (await body(await get(base, "/api/v1/codex/party", PLAYER))).data.party as Json;
    expect(shown.mapName).toBe("Barovia");
    expect(shown.marker.isParty).toBe(true);
    // `mapName` only travels with a projected pin, which requires the map to be revealed.
    expect(Object.keys(shown).sort()).toEqual(["mapName", "marker"]);
  });

  it("serves both reads with an ETag that differs per role and answers 304 to a match", async () => {
    const { base, store } = await fixture();
    const { map, marker } = await seed(base, store);
    store.setMapRevealed(map.id, true);
    store.setMarkerRevealed(marker.id, true);

    const first = await get(base, `/api/v1/codex/markers/${marker.id}`, GM);
    const tag = first.headers.get("etag")!;
    expect(tag).toMatch(/^W\/"codex-r\d+-gm-[0-9a-f]{12}"$/);
    expect((await get(base, `/api/v1/codex/markers/${marker.id}`, { ...GM, "if-none-match": tag })).status).toBe(304);
    // A player's tag is different, so no cache can hand a GM's answer to a player.
    const playerTag = (await get(base, `/api/v1/codex/markers/${marker.id}`, PLAYER)).headers.get("etag")!;
    expect(playerTag).not.toBe(tag);
    store.updateMarker(marker.id, { label: "The Village" });
    expect((await get(base, `/api/v1/codex/markers/${marker.id}`, { ...GM, "if-none-match": tag })).status).toBe(200);

    // A player's conditional probe of a hidden pin still 404s: the gate runs before the tag, so a 404 can
    // never become a 304.
    store.setMarkerRevealed(marker.id, false);
    expect(
      (await get(base, `/api/v1/codex/markers/${marker.id}`, { ...PLAYER, "if-none-match": playerTag })).status
    ).toBe(404);
  });
});

/** Linking existing downtime rows to character pages, so the tracker can total downtime recorded before the link existed. */
describe("codex journal PATCH — the narrow downtime group", () => {
  it("edits who/activity/characterPageId, refuses `days`, and refuses the group on any other kind", async () => {
    const { base, store } = await fixture();
    const character = store.createPage({ title: "Ireena", entityType: "character" });
    const entry = store.createDowntime({
      playerText: "A month at the forge.",
      downtime: { who: "Irena", activity: "Forgeing", days: 30 }
    });

    const patched = (
      await body(
        await patch(base, `/api/v1/codex/journal/${entry.id}`, GM, {
          downtime: { who: "Ireena", activity: "Forging", characterPageId: character.id }
        })
      )
    ).data.entry as Json;
    expect(patched.payload).toEqual({
      who: "Ireena",
      activity: "Forging",
      days: 30,
      applied: false,
      characterPageId: character.id
    });

    // `days` is immutable: `apply-downtime` moves the clock by it, so editing it later would leave the clock
    // disagreeing with the record. `.strict()` rejects it rather than dropping the key.
    const withDays = await patch(base, `/api/v1/codex/journal/${entry.id}`, GM, { downtime: { days: 5 } });
    expect(withDays.status).toBe(400);
    expect(JSON.stringify((await body(withDays)).error)).toContain("days");
    expect((await patch(base, `/api/v1/codex/journal/${entry.id}`, GM, { downtime: { applied: true } })).status).toBe(
      400
    );

    // An id naming no page is a 404, not a dangling link.
    expect(
      (await patch(base, `/api/v1/codex/journal/${entry.id}`, GM, { downtime: { characterPageId: randomUUID() } }))
        .status
    ).toBe(404);
    // `null` clears the link and leaves `who` as the display fallback.
    const cleared = (
      await body(await patch(base, `/api/v1/codex/journal/${entry.id}`, GM, { downtime: { characterPageId: null } }))
    ).data.entry as Json;
    expect(cleared.payload).toMatchObject({ characterPageId: null, who: "Ireena", days: 30 });

    // The group on a non-downtime record is a 400 rather than being silently ignored.
    const milestone = store.createMilestone({ playerText: "Level 5.", milestone: { level: 5, reason: "the crypt" } });
    const wrongKind = await patch(base, `/api/v1/codex/journal/${milestone.id}`, GM, { downtime: { who: "Ireena" } });
    expect(wrongKind.status).toBe(400);
    expect((await body(wrongKind)).error.message).toMatch(/only downtime entries/i);
    expect(store.getEntry(milestone.id)!.payload).toEqual({ level: 5, reason: "the crypt" });

    const prose = (
      await body(
        await patch(base, `/api/v1/codex/journal/${entry.id}`, GM, {
          playerText: "A month at the forge, and a week idle."
        })
      )
    ).data.entry as Json;
    expect(prose.payload).toMatchObject({ who: "Ireena", activity: "Forging", days: 30 });
  });
});

/** The export/import round trip a GM performs, and the version check. */
describe("codex export/import, HTTP boundary", () => {
  it("round-trips a saved export file POSTed back UNEDITED, and reports the database's own counts", async () => {
    const { base, store } = await fixture();
    const page = store.createPage({ title: "Barovia", playerBody: "A misty valley." });
    store.createSession({ sessionNumber: 4, recapBody: "We crossed." });

    const exported = (await body(await get(base, "/api/v1/codex/export", GM))).data as Json;
    expect(exported.bundleVersion, "the format version is a fact about the FILE, so it sits beside the bundle").toBe(1);
    expect(Object.keys(exported).sort()).toEqual(["bundleVersion", "codex", "exportedAt"]);

    store.deletePage(page.id);
    expect((await body(await get(base, "/api/v1/codex/pages", GM))).data.pages).toHaveLength(0);

    // The saved file, POSTed back with nothing stripped: `exportedAt` and `bundleVersion` are accepted.
    const restored = await post(base, "/api/v1/codex/import", GM, exported);
    expect(restored.status).toBe(200);
    const result = (await body(restored)).data as Json;
    expect(result.replaced).toBe(true);
    expect(result.counts).toMatchObject({ pages: 1, sessions: 1 });
    expect(Object.keys(result.counts).sort()).toEqual([
      "connections",
      "folders",
      "journal",
      "maps",
      "markers",
      "pages",
      "quests",
      "revisions",
      "sessions",
      "standing"
    ]);
    expect((await body(await get(base, "/api/v1/codex/pages", GM))).data.pages).toHaveLength(1);
  });

  it("restores a bundle with NO bundleVersion — every backup taken before this feature existed", async () => {
    const { base, store } = await fixture();
    store.createPage({ title: "Barovia" });
    const exported = (await body(await get(base, "/api/v1/codex/export", GM))).data as Json;
    const legacy = { codex: exported.codex };
    expect(
      (await post(base, "/api/v1/codex/import", GM, legacy)).status,
      "absent = a pre-versioning v1 bundle, and it MUST restore"
    ).toBe(200);

    // An unknown version is a 400 with structured issues: a newer bundle may carry shapes this build cannot
    // honour, and silently dropping them is not acceptable for a restore.
    const future = await post(base, "/api/v1/codex/import", GM, { codex: exported.codex, bundleVersion: 2 });
    expect(future.status).toBe(400);
    const refusal = await body(future);
    expect(refusal.error.code).toBe("validation_failed");
    expect(refusal.error.message).toMatch(/newer version/i);
    expect((refusal.error.details.issues as unknown[]).length).toBeGreaterThan(0);
  });

  it("is GM-only, and refuses a body that is not a bundle without touching the codex", async () => {
    const { base, store } = await fixture();
    store.createPage({ title: "Barovia" });
    const before = JSON.stringify(store.exportBundle());

    expect(
      (await post(base, "/api/v1/codex/import", PLAYER, { codex: {} })).status,
      "a player is authenticated and refused"
    ).toBe(403);
    expect(
      (
        await fetch(`${base}/api/v1/codex/import`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}"
        })
      ).status,
      "no token at all is a 401"
    ).toBe(401);
    // An integration credential with the write scope may restore; a read-only one may not.
    expect((await post(base, "/api/v1/codex/import", INTEGRATION_READ, { codex: {} })).status).toBe(403);

    expect((await post(base, "/api/v1/codex/import", GM, {})).status, "`codex` is required").toBe(400);
    expect(
      (await post(base, "/api/v1/codex/import", GM, { codex: {}, surprise: 1 })).status,
      "`.strict()`, like every other codex body"
    ).toBe(400);
    expect((await post(base, "/api/v1/codex/import", GM, { codex: { pages: [{ id: "nope" }] } })).status).toBe(400);
    expect(JSON.stringify(store.exportBundle()), "every refusal left the codex exactly as it was").toBe(before);
  });

  // A bundle with no recognised section is refused rather than treated as an empty campaign, which would
  // delete everything. Unversioned bundles and genuinely empty campaigns still restore.
  it("refuses a bundle with no recognised sections instead of wiping the codex, and still honours R1", async () => {
    const { base, store } = await fixture();
    store.createPage({ title: "Barovia" });
    store.createSession({ sessionNumber: 1 });
    const before = JSON.stringify(store.exportBundle());

    for (const codex of [{}, { notes: [] }, { pagez: [{ id: randomUUID() }] }]) {
      const refused = await post(base, "/api/v1/codex/import", GM, { codex });
      expect(refused.status, JSON.stringify(codex)).toBe(400);
      expect((await body(refused)).error.message).toMatch(/no codex sections|does not recognise/i);
      expect(JSON.stringify(store.exportBundle()), "the codex is untouched").toBe(before);
    }
    // The mistyped section is named, so a GM can fix the file.
    expect(
      (await body(await post(base, "/api/v1/codex/import", GM, { codex: { pagez: [] } }))).error.message
    ).toContain('"pagez"');

    const exported = (await body(await get(base, "/api/v1/codex/export", GM))).data as Json;
    expect((await post(base, "/api/v1/codex/import", GM, { codex: exported.codex })).status).toBe(200);
    const emptied = await post(base, "/api/v1/codex/import", GM, { codex: { pages: [], journal: [], sessions: [] } });
    expect(emptied.status).toBe(200);
    expect((await body(emptied)).data.counts).toMatchObject({ pages: 0, sessions: 0 });
    expect((await body(await get(base, "/api/v1/codex/pages", GM))).data.pages).toHaveLength(0);
  });

  // An internal failure is a sanitized 500 with no driver text, forced with a probe UNIQUE index on
  // `codex_pages(title)` from a second connection.
  it("answers a sanitized 500 when something unrecognised escapes the store, never the driver's text", async () => {
    const { base, store, directory } = await fixture();
    store.createPage({ title: "Barovia" });
    store.createPage({ title: "Vallaki" });
    const exported = (await body(await get(base, "/api/v1/codex/export", GM))).data as Json;
    const before = JSON.stringify(store.exportBundle());

    const probe = new DatabaseSync(join(directory, "vtt.sqlite"));
    probe.exec("CREATE UNIQUE INDEX probe_page_title ON codex_pages (title);");
    probe.close();

    const pages = (exported.codex as Json).pages as Json[];
    const collide = { ...(exported.codex as Json), pages: [...pages, { ...pages[0], id: randomUUID() }] };
    const failed = await post(base, "/api/v1/codex/import", GM, { codex: collide });

    expect(failed.status, "a driver failure is this process failing, not the caller's bad request").toBe(500);
    const envelope = await body(failed);
    expect(envelope.error.code).toBe("internal_error");
    expect(envelope.error.message).toBe("The codex request failed.");
    expect(JSON.stringify(envelope), "no table, no column, no path").not.toMatch(
      /constraint failed|codex_pages|sqlite/i
    );
    expect(envelope.error.requestId, "the sanitized answer still carries the id the caller correlates on").toEqual(
      expect.any(String)
    );
    expect(JSON.stringify(store.exportBundle())).toBe(before);
  });
});

// `commandId` idempotency: a retry across a dropped connection cannot double-create, and a caller can
// tell a replay from a fresh execution.
describe("codex commandId idempotency", () => {
  it("executes once, replays the identical status and bytes, and says that it replayed", async () => {
    const { base, store } = await fixture();
    const commandId = randomUUID();
    const first = await post(base, "/api/v1/codex/journal", GM, { playerText: "We arrived.", commandId });
    expect(first.status).toBe(201);
    expect(first.headers.get("x-idempotent-replay"), "a FIRST execution must not claim to be a replay").toBeNull();
    const firstBody = await body(first);

    const retry = await post(base, "/api/v1/codex/journal", GM, { playerText: "We arrived.", commandId });
    expect(retry.status, "a 201 replays as a 201 - the status is stored, not re-derived").toBe(201);
    expect(retry.headers.get("x-idempotent-replay")).toBe("true");
    expect(await body(retry), "the same bytes, including the entry's id and timestamps").toEqual(firstBody);
    expect(store.listTimeline()).toHaveLength(1);

    // A different id executes again, so the single row above is idempotency and not a broken route.
    await post(base, "/api/v1/codex/journal", GM, { playerText: "We left.", commandId: randomUUID() });
    expect(store.listTimeline()).toHaveLength(2);
    await post(base, "/api/v1/codex/journal", GM, { playerText: "We left." });
    await post(base, "/api/v1/codex/journal", GM, { playerText: "We left." });
    expect(store.listTimeline()).toHaveLength(4);
  });

  it("records nothing for a FAILED write, so a retry after an error re-executes", async () => {
    const { base, store } = await fixture();
    const commandId = randomUUID();
    // A 404: the session does not exist. Nothing was written, so nothing may be replayed.
    const failed = await post(base, "/api/v1/codex/journal", GM, {
      playerText: "Nowhere.",
      sessionId: randomUUID(),
      commandId
    });
    expect(failed.status).toBe(404);

    // The same id now succeeds, because the failed attempt stored no outcome: a retry after an error must
    // actually retry.
    const retried = await post(base, "/api/v1/codex/journal", GM, { playerText: "Somewhere.", commandId });
    expect(retried.status).toBe(201);
    expect(retried.headers.get("x-idempotent-replay")).toBeNull();
    expect(store.listTimeline()).toHaveLength(1);
  });

  it("works across every JSON-body verb, and is accepted-not-required", async () => {
    const { base, store } = await fixture();
    const page = store.createPage({ title: "Barovia" });

    const patchId = randomUUID();
    const patched = await patch(base, `/api/v1/codex/pages/${page.id}`, GM, {
      playerBody: "A misty valley.",
      commandId: patchId
    });
    expect(patched.status).toBe(200);
    const revAfterFirst = store.getPage(page.id)!.rev;
    const patchRetry = await patch(base, `/api/v1/codex/pages/${page.id}`, GM, {
      playerBody: "A misty valley.",
      commandId: patchId
    });
    expect(patchRetry.headers.get("x-idempotent-replay")).toBe("true");
    expect(store.getPage(page.id)!.rev, "the replay did not bump the page a second time").toBe(revAfterFirst);

    const putId = randomUUID();
    await put(base, "/api/v1/codex/settings", GM, {
      revisionHistory: { enabled: true, windowMinutes: 45 },
      autosave: AUTOSAVE_DEFAULT,
      commandId: putId
    });
    expect(
      (
        await put(base, "/api/v1/codex/settings", GM, {
          revisionHistory: { enabled: true, windowMinutes: 45 },
          autosave: AUTOSAVE_DEFAULT,
          commandId: putId
        })
      ).headers.get("x-idempotent-replay")
    ).toBe("true");

    // A DELETE carries none and is not replayed: deleting a deleted record already succeeds. The contract
    // declares no `commandId` on codex DELETE bodies, and the router ignores one.
    const deleteId = randomUUID();
    expect((await del(base, `/api/v1/codex/pages/${page.id}`, GM, { commandId: deleteId })).status).toBe(200);
    expect(
      (await del(base, `/api/v1/codex/pages/${page.id}`, GM, { commandId: deleteId })).headers.get(
        "x-idempotent-replay"
      )
    ).toBeNull();
    expect((await post(base, "/api/v1/codex/journal", GM, { playerText: "x", commandId: "not-a-uuid" })).status).toBe(
      400
    );
  });

  // A key reused for a different request is refused rather than replaying the first response and dropping
  // the write. Genuine retries, including a corrected body on the same route, still replay.
  it("refuses a commandId reused for a different request instead of replaying the wrong answer", async () => {
    const { base, store } = await fixture();
    const commandId = randomUUID();
    const created = await post(base, "/api/v1/codex/pages", GM, { title: "Vallaki", commandId });
    expect(created.status).toBe(201);

    const crossed = await post(base, "/api/v1/codex/quests", GM, { title: "The Coffin Run", commandId });
    expect(crossed.status, "the quest write must not be answered with the page's 201").toBe(400);
    expect((await body(crossed)).error.message).toMatch(/already used for a different request/i);
    expect(crossed.headers.get("x-idempotent-replay"), "a refusal is not a replay").toBeNull();
    expect(store.listQuests(), "...and the refusal really did refuse - nothing was written either way").toEqual([]);

    const retry = await post(base, "/api/v1/codex/pages", GM, { title: "Vallaki", commandId });
    expect(retry.headers.get("x-idempotent-replay")).toBe("true");
    expect((await body(retry)).data.page.id).toBe((await body(created)).data.page.id);
    // ...as does a retry of the same route with a corrected body; binding to the body would make the key
    // useless to a client fixing a typo.
    expect(
      (await post(base, "/api/v1/codex/pages", GM, { title: "Vallaki Rebuilt", commandId })).headers.get(
        "x-idempotent-replay"
      )
    ).toBe("true");
    expect(store.listPages(), "the corrected retry created nothing new").toHaveLength(1);
  });

  it("never lets a replay skip authorization", async () => {
    const { base } = await fixture();
    const commandId = randomUUID();
    expect((await post(base, "/api/v1/codex/journal", GM, { playerText: "We arrived.", commandId })).status).toBe(201);
    // A player replaying a GM's key gets the ordinary refusal: the guard runs per route before the
    // middleware sees the body, so a receipt is not a bearer token.
    expect((await post(base, "/api/v1/codex/journal", PLAYER, { playerText: "We arrived.", commandId })).status).toBe(
      403
    );
    expect(
      (
        await fetch(`${base}/api/v1/codex/journal`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ playerText: "x", commandId })
        })
      ).status
    ).toBe(401);
  });
});
