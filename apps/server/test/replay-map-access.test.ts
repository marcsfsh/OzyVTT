import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameStateSchema } from "@vtt/domain";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

/**
 * THE THIRD PLAYER MAP DOOR (D26 ride-along): a SHARED replay's own battlefield, and nothing else.
 *
 * The reported symptom was that a player handed a shared replay saw "Map unavailable" on every turn:
 * `authorizePlayer` in `server.ts` opened only for the live combat map and codex-revealed atlas maps,
 * so the archived fight's map answered 403 to the very people the GM had just shared it with.
 *
 * This is a VIEWER-SAFETY test as much as a feature test, so it asserts the gate in both directions
 * at once. Two fights are recorded on two different maps, exactly one is shared, and the probe checks
 * that sharing opens ONE image and un-sharing closes it again. The failure this guards against is the
 * lazy version of the fix - "the asset belongs to some archive" - which would have handed every
 * player the map of every fight the GM ever ran and never shared.
 */

const HERO_ID = "10000000-0000-4000-8000-000000000001";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

function png(width: number, height: number) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(13, 8); buffer.write("IHDR", 12, "ascii"); buffer.writeUInt32BE(width, 16); buffer.writeUInt32BE(height, 20);
  return buffer;
}

const initialState = () => GameStateSchema.parse({ schemaVersion: 1, actors: [
  { id: HERO_ID, name: "Public Hero", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 }, initiative: 3 }
] });

async function boot() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-replay-map-"));
  const server = createServer({
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integrations.sqlite"),
    mapAssetsPath: join(directory, "map-assets"),
    webDist: join(directory, "dist"),
    useDevelopmentClient: true,
    developmentClientPort: 5173,
    initialGameState: initialState()
  });
  await server.initialize();
  await server.auth.bootstrap("a sufficiently long GM password");
  const gmToken = (await server.auth.login("a sufficiently long GM password"))!;
  const playerToken = server.auth.issuePlayerSession();
  await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind.");
  cleanups.push(async () => { server.close(); await rm(directory, { recursive: true, force: true }); });
  return { base: `http://127.0.0.1:${address.port}`, server, gmToken, playerToken };
}

describe("a shared replay's battle map (D26 ride-along)", () => {
  it("opens the map of a SHARED archive to players and keeps an unshared one at 403", async () => {
    const { base, server, gmToken, playerToken } = await boot();
    const bearer = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
    const image = async (assetId: string, token: string) =>
      (await fetch(`${base}/api/v1/map-assets/${assetId}/content`, { headers: { authorization: `Bearer ${token}` } })).status;

    // Two battlemaps, two recorded fights - one per map, so "shared" can be told from "archived".
    const shared = await server.mapAssets.import(png(900, 600), "shared.png");
    const secret = await server.mapAssets.import(png(901, 600), "secret.png");
    server.mapCatalog.register(shared.metadata.id, "The bridge", "battlemap");
    server.mapCatalog.register(secret.metadata.id, "Next week's ambush", "battlemap");

    const record = async (mapAssetId: string) => {
      expect((await fetch(`${base}/api/v1/game/encounter/start`, { method: "POST", headers: bearer(gmToken), body: JSON.stringify({ mapAssetId, entries: [{ actorId: HERO_ID, score: 12 }] }) })).status).toBe(200);
      // One turn boundary, so the archive has a turn a player's replay can render a map on.
      expect((await fetch(`${base}/api/v1/game/initiative/next`, { method: "POST", headers: bearer(gmToken), body: JSON.stringify({}) })).status).toBe(200);
      expect((await fetch(`${base}/api/v1/game/encounter/end`, { method: "POST", headers: bearer(gmToken), body: JSON.stringify({}) })).status).toBe(200);
    };
    await record(shared.metadata.id);
    await record(secret.metadata.id);

    const archives = (await (await fetch(`${base}/api/v1/encounters`, { headers: bearer(gmToken) })).json()).data.encounters as ReadonlyArray<{ id: number }>;
    expect(archives).toHaveLength(2);
    // Newest first, so the LAST fight recorded (the secret map) is index 0.
    const sharedArchiveId = archives[1].id;

    // No fight is running, so the live-map door is shut and neither image is reachable yet.
    expect(server.store.snapshot.combat.active).toBe(false);
    expect(await image(shared.metadata.id, playerToken)).toBe(403);
    expect(await image(secret.metadata.id, playerToken)).toBe(403);

    const setShared = async (id: number, playerVisible: boolean) =>
      (await fetch(`${base}/api/v1/encounters/${id}/visibility`, { method: "POST", headers: bearer(gmToken), body: JSON.stringify({ playerVisible }) })).status;
    expect(await setShared(sharedArchiveId, true)).toBe(200);

    // THE FIX: the shared fight's battlefield opens. THE GATE: the unshared one does not.
    expect(await image(shared.metadata.id, playerToken)).toBe(200);
    expect(await image(secret.metadata.id, playerToken)).toBe(403);
    // The GM's own access is unchanged, and a caller with no session at all still gets nothing
    // (the map router answers 403 for every unauthorized reader, token or not - unchanged here).
    expect(await image(secret.metadata.id, gmToken)).toBe(200);
    expect((await fetch(`${base}/api/v1/map-assets/${shared.metadata.id}/content`)).status).toBe(403);

    // Un-sharing takes the image back - the door is the flag, not the archive.
    expect(await setShared(sharedArchiveId, false)).toBe(200);
    expect(await image(shared.metadata.id, playerToken)).toBe(403);
  });
});
