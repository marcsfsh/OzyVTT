import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { GameStateSchema } from "@vtt/domain";
import { GAME_PATHS } from "@vtt/api-contract";
import { afterEach, describe, expect, it } from "vitest";
import { TokenCatalogStore } from "../src/token-catalog.js";
import { createServer } from "../src/server.js";

/**
 * D18 (+ director ruling R1) - the three gates a player needs to choose their own character's token:
 * the command, the library listing, and the upload. Each is opened for a player's OWN claimed
 * character only, and the GM keeps every management route plus a per-entry `hidden` curation flag.
 * Hidden is CURATION, not approval: a player picks freely from what the library offers and uploads
 * with no gate at all.
 */

const HERO_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ID = "10000000-0000-4000-8000-000000000002";
const ASSET_A = "10000000-0000-5000-8000-000000000001";
const ASSET_B = "10000000-0000-5000-8000-000000000002";
const TOKEN_COLLECTION = "/api/v1/token-assets";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

function png(width: number, height: number) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(13, 8); buffer.write("IHDR", 12, "ascii"); buffer.writeUInt32BE(width, 16); buffer.writeUInt32BE(height, 20);
  return buffer;
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const post = (base: string, path: string, token: string, body: unknown = {}) =>
  fetch(base + path, { method: "POST", headers: bearer(token), body: JSON.stringify(body) });

async function boot() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-player-tokens-"));
  const server = createServer({
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integrations.sqlite"),
    mapAssetsPath: join(directory, "map-assets"),
    webDist: join(directory, "dist"),
    useDevelopmentClient: true,
    developmentClientPort: 5173,
    initialGameState: GameStateSchema.parse({ schemaVersion: 1, actors: [
      { id: HERO_ID, name: "Borin", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 } },
      { id: OTHER_ID, name: "Sable", kind: "player-character", visibility: "public", hp: { current: 18, maximum: 18 } }
    ] })
  });
  await server.initialize();
  await server.auth.bootstrap("a sufficiently long GM password");
  const gmToken = (await server.auth.login("a sufficiently long GM password"))!;
  await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind.");
  cleanups.push(async () => { server.close(); await rm(directory, { recursive: true, force: true }); });
  return { base: `http://127.0.0.1:${address.port}`, server, gmToken, playerToken: server.auth.issuePlayerSession() };
}

async function uploadToken(base: string, token: string, name: string, options: { folder?: string; size?: number } = {}) {
  const folder = options.folder ? `&folder=${encodeURIComponent(options.folder)}` : "";
  return fetch(`${base}${TOKEN_COLLECTION}?filename=${name}.png&name=${name}${folder}`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" }, body: png(options.size ?? 64, options.size ?? 64)
  });
}

describe("token library curation (R1)", () => {
  it("defaults to visible, hides per entry and per folder, and only the player list filters", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-token-catalog-"));
    const store = new TokenCatalogStore(join(directory, "vtt.sqlite"));
    await store.initialize();
    cleanups.push(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });

    store.register(ASSET_A, "Goblin Boss", "Spoilers");
    store.register(ASSET_B, "Borin", "Player uploads");
    expect(store.get(ASSET_A)).toMatchObject({ hidden: false });

    store.updateDetails(ASSET_A, { hidden: true });
    expect(store.list("gm").map((entry) => entry.assetId)).toEqual(expect.arrayContaining([ASSET_A, ASSET_B]));
    expect(store.list("player").map((entry) => entry.assetId)).toEqual([ASSET_B]);
    // Un-hiding is the same call: curation is reversible, never an approval decision.
    store.updateDetails(ASSET_A, { hidden: false });
    expect(store.list("player")).toHaveLength(2);
    // A whole shelf at once.
    store.setFolderHidden("Spoilers", true);
    expect(store.list("player").map((entry) => entry.assetId)).toEqual([ASSET_B]);
  });

  it("adds the column to a catalog created before it existed, defaulting every row to visible", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-token-migrate-"));
    const path = join(directory, "vtt.sqlite");
    const legacy = new DatabaseSync(path);
    legacy.exec("CREATE TABLE token_catalog (asset_id TEXT PRIMARY KEY, name TEXT NOT NULL, folder TEXT, created_at TEXT NOT NULL, last_used_at TEXT) STRICT;");
    legacy.prepare("INSERT INTO token_catalog (asset_id, name, folder, created_at, last_used_at) VALUES (?, ?, ?, ?, NULL)").run(ASSET_A, "Old Token", null, "2026-01-01T00:00:00.000Z");
    legacy.close();

    const store = new TokenCatalogStore(path);
    await store.initialize();
    cleanups.push(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
    expect(store.get(ASSET_A)).toMatchObject({ name: "Old Token", hidden: false });
    expect(store.list("player")).toHaveLength(1);
  });
});

describe("the three player gates (D18)", () => {
  it("lets a player browse the offered library, and hides what the GM curated away", async () => {
    const { base, gmToken, playerToken } = await boot();
    await uploadToken(base, gmToken, "Boss", { folder: "Spoilers", size: 64 });
    const sharedUpload = await (await uploadToken(base, gmToken, "Hero", { size: 32 })).json();
    const sharedId = sharedUpload.data.token.id as string;
    await post(base, `${TOKEN_COLLECTION}/folders/visibility`, gmToken, { folder: "Spoilers", hidden: true });

    const gmList = await (await fetch(base + TOKEN_COLLECTION, { headers: bearer(gmToken) })).json();
    expect(gmList.data.tokens.map((token: { name: string }) => token.name).sort()).toEqual(["Boss", "Hero"]);

    const playerList = await (await fetch(base + TOKEN_COLLECTION, { headers: bearer(playerToken) })).json();
    expect(playerList.data.tokens.map((token: { name: string }) => token.name)).toEqual(["Hero"]);
    // The GM's per-stat-block memory is prep, not a player's business.
    expect(playerList.data.rememberedAssetId).toBeNull();

    // Every MANAGEMENT route stays GM-only.
    expect((await fetch(`${base}${TOKEN_COLLECTION}/${sharedId}`, { method: "PATCH", headers: bearer(playerToken), body: JSON.stringify({ name: "Mine" }) })).status).toBe(401);
    expect((await fetch(`${base}${TOKEN_COLLECTION}/${sharedId}`, { method: "DELETE", headers: bearer(playerToken) })).status).toBe(401);
    expect((await post(base, `${TOKEN_COLLECTION}/folders/visibility`, playerToken, { folder: null, hidden: true })).status).toBe(401);
  });

  it("lets a player upload their own image onto one curated shelf, bounded by a daily cap", async () => {
    const { base, playerToken } = await boot();
    const uploaded = await uploadToken(base, playerToken, "borin");
    expect(uploaded.status).toBe(201);
    const body = await uploaded.json();
    // A player does not choose the folder: their uploads land where the GM can curate them.
    expect(body.data.token.folder).toBe("Player uploads");
    expect(body.data.token.hidden).toBe(false);

    // 20 a day, then a clear refusal rather than an unbounded disk.
    let last = uploaded;
    for (let index = 0; index < 25; index += 1) last = await uploadToken(base, playerToken, `extra-${index}`);
    expect(last.status).toBe(429);
    expect((await last.json()).error.message).toMatch(/up to 20 token images a day/);
  });

  it("lets a player set their OWN claimed character's token, and refuses anyone else's", async () => {
    const { base, server, gmToken, playerToken } = await boot();
    const imported = await (await uploadToken(base, gmToken, "Borin")).json();
    const assetId = imported.data.token.id as string;

    // Unclaimed: a player has no character to dress yet.
    const unclaimed = await post(base, GAME_PATHS.actorTokenImage.replace("{actorId}", HERO_ID), playerToken, { tokenAssetId: assetId });
    expect(unclaimed.status).toBe(403);

    expect((await post(base, GAME_PATHS.claims, playerToken, { actorId: HERO_ID })).status).toBe(200);
    const own = await post(base, GAME_PATHS.actorTokenImage.replace("{actorId}", HERO_ID), playerToken, { tokenAssetId: assetId });
    expect(own.status).toBe(200);
    expect(server.store.snapshot.actors.find((actor) => actor.id === HERO_ID)!.tokenAssetId).toBe(assetId);

    // Another player's character is still refused - one gate, the same one every player command uses.
    const other = await post(base, GAME_PATHS.actorTokenImage.replace("{actorId}", OTHER_ID), playerToken, { tokenAssetId: assetId });
    expect(other.status).toBe(403);
    expect(server.store.snapshot.actors.find((actor) => actor.id === OTHER_ID)!.tokenAssetId).toBeUndefined();

    // The GM override survives: the GM sets (or clears) anyone's token.
    expect((await post(base, GAME_PATHS.actorTokenImage.replace("{actorId}", OTHER_ID), gmToken, { tokenAssetId: assetId })).status).toBe(200);
    expect((await post(base, GAME_PATHS.actorTokenImage.replace("{actorId}", HERO_ID), gmToken, { tokenAssetId: null })).status).toBe(200);
    expect(server.store.snapshot.actors.find((actor) => actor.id === HERO_ID)!.tokenAssetId).toBeUndefined();
  });
});
