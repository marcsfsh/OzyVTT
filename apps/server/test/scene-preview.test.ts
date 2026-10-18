import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { GameStateSchema } from "@vtt/domain";
import { io as connect, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { createServer } from "../src/server.js";
import { png } from "./image-fixtures.js";

// The GM's preview of a scene (`scene:preview`): what the shared screen or one character's player would receive if
// the scene went live now, from the real projections over a copy. It changes nothing and reaches no player.

const HERO = "10000000-0000-4000-8000-000000000001";
const GOBLIN = "10000000-0000-4000-8000-000000000003";
const GHOST = "10000000-0000-4000-8000-000000000005";
const SCENE = "60000000-0000-4000-8000-000000000001";
const DIVIDER = "50000000-0000-4000-8000-000000000001";

/** The crypt: a wall down the middle, the hero on the left, a goblin behind the wall, and a GM-only ghost beside the
 *  hero. Vision is on in bright light. */
const initialState = (mapAssetId: string) =>
  GameStateSchema.parse({
    schemaVersion: 1,
    combat: {
      scenes: [
        {
          id: SCENE,
          name: "Crypt",
          mapAssetId,
          combat: {
            initiative: [
              { actorId: HERO, score: 0 },
              { actorId: GOBLIN, score: 0 },
              { actorId: GHOST, score: 0 }
            ],
            tokens: [
              { actorId: HERO, position: { x: 75, y: 275 }, sizePx: 41, gridSizePx: 50 },
              { actorId: GOBLIN, position: { x: 425, y: 275 }, sizePx: 41, gridSizePx: 50 },
              { actorId: GHOST, position: { x: 125, y: 275 }, sizePx: 41, gridSizePx: 50 }
            ],
            vision: {
              enabled: true,
              walls: [{ id: DIVIDER, kind: "wall", a: { x: 250, y: 0 }, b: { x: 250, y: 600 } }],
              measure: { width: 1000, height: 600, pixelsPerFoot: 10 }
            }
          }
        }
      ]
    },
    actors: [
      { id: HERO, name: "Borin", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 } },
      { id: GOBLIN, name: "Goblin", kind: "monster", visibility: "public", hp: { current: 7, maximum: 7 } },
      { id: GHOST, name: "Ghost", kind: "monster", visibility: "gm-only", hp: { current: 9, maximum: 9 } }
    ]
  });

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function joinSocket(base: string, token: string) {
  const socket = connect(base, { auth: { token }, transports: ["websocket"], reconnection: false, forceNew: true });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
  });
  const joined = await new Promise<{ ok: boolean }>((resolve) => socket.emit("session:join", { token }, resolve));
  if (!joined.ok) throw new Error("join failed");
  cleanups.push(async () => {
    socket.close();
  });
  return socket;
}

const emit = (socket: Socket, event: string, payload: Record<string, unknown>) =>
  new Promise<Record<string, unknown>>((resolve) =>
    (socket.emit as (...args: unknown[]) => void)(event, { commandId: randomUUID(), ...payload }, resolve)
  );

async function table() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-scene-preview-"));
  const paths = {
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integrations.sqlite"),
    mapAssetsPath: join(directory, "map-assets"),
    webDist: join(directory, "dist"),
    useDevelopmentClient: true,
    developmentClientPort: 5173
  };
  // Map ids are the image's content hash, so importing it first names the map the scene is on.
  const probeDirectory = await mkdtemp(join(tmpdir(), "vtt-scene-preview-id-"));
  const probe = createServer({ ...paths, databasePath: join(probeDirectory, "vtt.sqlite") });
  await probe.initialize();
  const mapAssetId = (await probe.mapAssets.import(png(1000, 600), "crypt.png")).metadata.id;
  probe.close();
  await rm(probeDirectory, { recursive: true, force: true });
  const server = createServer({ ...paths, initialGameState: initialState(mapAssetId) });
  cleanups.push(async () => {
    server.close();
    await rm(directory, { recursive: true, force: true });
  });
  await server.initialize();
  await server.auth.bootstrap("a sufficiently long GM password");
  const gmToken = (await server.auth.login("a sufficiently long GM password"))!;
  const playerToken = server.auth.issuePlayerSession();
  server.mapCatalog.register(mapAssetId, "Crypt", "battlemap");
  server.mapCatalog.saveCalibration(mapAssetId, {
    calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 },
    verifiedAt: null,
    verificationPoint: null,
    verificationErrorPx: null
  });
  await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind.");
  const base = `http://127.0.0.1:${address.port}`;
  const gm = await joinSocket(base, gmToken);
  const player = await joinSocket(base, playerToken);
  const http = (path: string, token: string) => fetch(base + path, { headers: { authorization: `Bearer ${token}` } });
  return { server, gm, player, http, gmToken, playerToken };
}

const previewPath = (actorId?: string) =>
  `${GAME_PATHS.scenePreview.replace("{sceneId}", SCENE)}${actorId ? `?actorId=${actorId}` : ""}`;
type Preview = {
  live: boolean;
  screen: { encounter: { tokens: Array<{ actorId: string }>; vision?: unknown } } | null;
  player: { combat: { tokens: Array<{ actorId: string }> }; actors: Array<{ id: string; name: string }> } | null;
};

describe("previewing a scene", () => {
  it("shows the GM what the table screen would show, through the party's eyes, and changes nothing", async () => {
    const { server, http, gmToken } = await table();
    const before = server.store.snapshot;
    const response = await http(previewPath(), gmToken);
    expect(response.status).toBe(200);
    const preview = ((await response.json()) as { data: Preview }).data;
    expect(preview.live).toBe(false);
    // The goblin behind the wall and the GM-only ghost are left out, as the real feed would leave them.
    expect(preview.screen!.encounter.tokens.map((token) => token.actorId)).toEqual([HERO]);
    expect(preview.screen!.encounter.vision).toBeDefined();
    expect(preview.player).toBeNull();
    // Nothing moved: the scene is still prepared and the revision is the same.
    expect(server.store.snapshot.revision).toBe(before.revision);
    expect(server.store.snapshot.combat.activeSceneId).toBeNull();
    expect(server.store.snapshot.combat.scenes[0]!.combat.tokens).toHaveLength(3);
  });

  it("shows what one character's player would receive, and the screen preview matches the screen once live", async () => {
    const { server, gm, http, gmToken } = await table();
    const asHero = ((await (await http(previewPath(HERO), gmToken)).json()) as { data: Preview }).data;
    expect(asHero.screen).toBeNull();
    expect(asHero.player!.combat.tokens.map((token) => token.actorId)).toEqual([HERO]);
    expect(asHero.player!.actors.map((actor) => actor.name)).toEqual(["Borin"]);
    // No claim was made for the preview.
    expect(server.store.snapshot.actors.find((actor) => actor.id === HERO)!.ownerSessionId).toBeNull();

    const screen = ((await (await http(previewPath(), gmToken)).json()) as { data: Preview }).data;
    expect(await emit(gm, "scene:activate", { sceneId: SCENE })).toMatchObject({ ok: true });
    const live = server.viewerPresentation.snapshot.encounter.tokens.map((token) => token.actorId);
    expect(screen.screen!.encounter.tokens.map((token) => token.actorId)).toEqual(live);
    const again = ((await (await http(previewPath(), gmToken)).json()) as { data: Preview }).data;
    expect(again.live).toBe(true);
    expect(again.screen!.encounter.tokens.map((token) => token.actorId)).toEqual(live);
  });

  it("answers only the GM, and names a missing scene or a creature outside the party as not found", async () => {
    const { player, http, gmToken, playerToken } = await table();
    expect((await http(previewPath(), playerToken)).status).toBe(403);
    expect(await emit(player, "scene:preview", { sceneId: SCENE })).toMatchObject({ ok: false });
    expect((await http(previewPath(GOBLIN), gmToken)).status).toBe(404);
    const missing = GAME_PATHS.scenePreview.replace("{sceneId}", "60000000-0000-4000-8000-0000000000ff");
    expect((await http(missing, gmToken)).status).toBe(404);
  });
});
