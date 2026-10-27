import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { GameStateSchema } from "@vtt/domain";
import { io as connect, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { ENCOUNTER_ARCHIVE_PATHS, GAME_PATHS } from "@vtt/api-contract";
import { createServer } from "../src/server.js";
import { png } from "./image-fixtures.js";

// The boundary dynamic vision and manual fog draw, end to end (ADR-0023): a goblin the walls hide from every
// character, or that stands wholly under the fog, never reaches a player, over the socket (state, feed and toasts),
// over HTTP, on the table screen or in the replay.

const HERO = "10000000-0000-4000-8000-000000000001";
const GOBLIN = "10000000-0000-4000-8000-000000000003";
const GOBLIN_NAME = "Skulking Goblin";
/** Half in the fog's reveal, in the fog test. */
const ORC = "10000000-0000-4000-8000-000000000004";

const SCENE = "60000000-0000-4000-8000-000000000001";
const DIVIDER = "50000000-0000-4000-8000-000000000001";
const REVEAL = "50000000-0000-4000-8000-000000000002";

/** The roster, and, when `mapAssetId` is given, the crypt scene the GM prepared. With vision: a wall down the middle,
 *  the hero on one side and the goblin on the other. With fog: only the left strip revealed (x 0 to 260), the hero in
 *  it, the orc's space 10 pixels into it and the goblin's wholly out of it. */
const initialState = (mapAssetId?: string, mode: "vision" | "fog" = "vision") =>
  GameStateSchema.parse({
    schemaVersion: 1,
    combat: {
      encounters: mapAssetId
        ? [
            {
              id: SCENE,
              name: "Crypt",
              mapAssetId,
              combat: {
                initiative: [
                  { actorId: HERO, score: 0 },
                  { actorId: GOBLIN, score: 0 },
                  ...(mode === "fog" ? [{ actorId: ORC, score: 0 }] : [])
                ],
                tokens: [
                  { actorId: HERO, position: { x: 75, y: 275 }, sizePx: 41, gridSizePx: 50 },
                  { actorId: GOBLIN, position: { x: 425, y: 275 }, sizePx: 41, gridSizePx: 50 },
                  ...(mode === "fog"
                    ? [{ actorId: ORC, position: { x: 275, y: 425 }, sizePx: 41, gridSizePx: 50 }]
                    : [])
                ],
                ...(mode === "vision"
                  ? {
                      vision: {
                        enabled: true,
                        walls: [{ id: DIVIDER, kind: "wall", a: { x: 250, y: 0 }, b: { x: 250, y: 600 } }],
                        measure: { width: 1000, height: 600, pixelsPerFoot: 10 }
                      }
                    }
                  : {
                      fog: {
                        enabled: true,
                        shapes: [{ kind: "rect", id: REVEAL, op: "reveal", x: 0, y: 0, width: 260, height: 600 }]
                      }
                    })
              }
            }
          ]
        : []
    },
    actors: [
      { id: HERO, name: "Borin", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 } },
      {
        id: GOBLIN,
        name: GOBLIN_NAME,
        kind: "monster",
        visibility: "public",
        hp: { current: 7, maximum: 7 },
        notes: "Waits behind the wall"
      },
      { id: ORC, name: "Orc", kind: "monster", visibility: "public", hp: { current: 15, maximum: 15 } }
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

/** A server with a calibrated 1000 x 600 battlemap (50-pixel, 5-foot cells), a GM and one player; with `prepared`, the
 *  crypt scene is already set up on it, with vision or with fog. */
async function table(prepared = false, mode: "vision" | "fog" = "vision") {
  const directory = await mkdtemp(join(tmpdir(), "vtt-vision-"));
  // Map ids are the image's content hash, so the same picture is the same id on every server.
  const mapAssetId = prepared ? await mapIdOf(png(1000, 600)) : undefined;
  const server = createServer({
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integrations.sqlite"),
    mapAssetsPath: join(directory, "map-assets"),
    webDist: join(directory, "dist"),
    useDevelopmentClient: true,
    developmentClientPort: 5173,
    initialGameState: initialState(mapAssetId, mode)
  });
  cleanups.push(async () => {
    server.close();
    await rm(directory, { recursive: true, force: true });
  });
  await server.initialize();
  await server.auth.bootstrap("a sufficiently long GM password");
  const gmToken = (await server.auth.login("a sufficiently long GM password"))!;
  const playerToken = server.auth.issuePlayerSession();
  const map = await server.mapAssets.import(png(1000, 600), "crypt.png");
  server.mapCatalog.register(map.metadata.id, "Crypt", "battlemap");
  server.mapCatalog.saveCalibration(map.metadata.id, {
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
  // Everything the player's socket is ever sent.
  const received: unknown[] = [];
  for (const event of ["state:updated", "log:entry", "table:event"])
    player.on(event, (payload: unknown) => received.push(payload));
  const http = (path: string, token: string, init: RequestInit = {}) =>
    fetch(base + path, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers }
    });
  expect(await emit(player, "character:claim", { actorId: HERO })).toMatchObject({ ok: true });
  return { server, gm, player, received, http, gmToken, playerToken, mapAssetId: map.metadata.id };
}

async function mapIdOf(image: Buffer) {
  const directory = await mkdtemp(join(tmpdir(), "vtt-vision-id-"));
  const probe = createServer({
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integrations.sqlite"),
    mapAssetsPath: join(directory, "map-assets"),
    webDist: join(directory, "dist"),
    useDevelopmentClient: true,
    developmentClientPort: 5173
  });
  await probe.initialize();
  const id = (await probe.mapAssets.import(image, "probe.png")).metadata.id;
  probe.close();
  await rm(directory, { recursive: true, force: true });
  return id;
}

const mentionsGoblin = (payload: unknown) => {
  const json = JSON.stringify(payload);
  return json.includes(GOBLIN) || json.includes(GOBLIN_NAME) || json.includes("Waits behind the wall");
};

describe("dynamic vision end to end", () => {
  it("keeps a goblin hidden by walls out of every player channel, the table screen and the replay", async () => {
    // The GM prepared the crypt: the goblin behind a wall, vision on. Staged there, it is already a secret.
    const { server, gm, received, http, gmToken, playerToken, mapAssetId } = await table(true);
    expect(mapAssetId).toBe(server.store.snapshot.combat.encounters[0]!.mapAssetId);
    // More walls go up in the prepared scene, and then it goes live and the fight starts.
    expect(
      await emit(gm, "wall:add", {
        kind: "window",
        points: [
          { x: 600, y: 0 },
          { x: 600, y: 100 }
        ],
        encounterId: SCENE
      })
    ).toMatchObject({ ok: true });
    expect(await emit(gm, "encounter:activate", { encounterId: SCENE })).toMatchObject({ ok: true });
    expect(await emit(gm, "encounter:start", { mapAssetId })).toMatchObject({ ok: true });
    // A few turns pass. The goblin moves about behind the wall.
    for (let turn = 0; turn < 3; turn++) {
      if (server.store.snapshot.combat.turnActorId === GOBLIN)
        expect(
          await emit(gm, "token:move", { actorId: GOBLIN, position: { x: 475, y: 225 + 50 * turn } })
        ).toMatchObject({
          ok: true
        });
      expect(await emit(gm, "initiative:next", {})).toMatchObject({ ok: true });
    }
    // The GM sees it; the player's state shows only the hero, with the area it sees.
    const gmView = (await (await http(GAME_PATHS.snapshot, gmToken)).json()) as { data: unknown };
    expect(mentionsGoblin(gmView)).toBe(true);
    const playerView = (await (await http(GAME_PATHS.snapshot, playerToken)).json()) as {
      data: { game: { combat: { tokens: Array<{ actorId: string }>; vision: { enabled: boolean } } } };
    };
    expect(playerView.data.game.combat.tokens.map((token) => token.actorId)).toEqual([HERO]);
    expect(playerView.data.game.combat.vision.enabled).toBe(true);
    expect(mentionsGoblin(playerView)).toBe(false);
    expect(mentionsGoblin(await (await http(`${GAME_PATHS.log}?limit=1000`, playerToken)).json())).toBe(false);
    expect(received.length).toBeGreaterThan(0);
    expect(received.filter(mentionsGoblin)).toEqual([]);
    expect(mentionsGoblin(server.viewerPresentation.snapshot)).toBe(false);
    // A player can't look through the goblin's eyes, nor touch the walls.
    expect((await http(`${GAME_PATHS.visionPreview}?actorId=${GOBLIN}`, playerToken)).status).toBe(403);
    const clear = await http(GAME_PATHS.wallsClear, playerToken, { method: "POST", body: "{}" });
    expect(clear.status).toBe(403);
    // The GM can, and sees the hero's view stop at the wall.
    const preview = (await (await http(`${GAME_PATHS.visionPreview}?actorId=${HERO}`, gmToken)).json()) as {
      data: { enabled: boolean; actorIds: string[]; visible: number[][] };
    };
    expect(preview.data.enabled).toBe(true);
    expect(preview.data.actorIds).toEqual([HERO]);
    expect(Math.max(...preview.data.visible.flatMap((polygon) => polygon.filter((_, index) => index % 2 === 0)))).toBe(
      250
    );

    // The fight ends and the GM shares it: the replay keeps the goblin hidden in every turn.
    expect(await emit(gm, "encounter:end", {})).toMatchObject({ ok: true });
    const archives = (await (await http(ENCOUNTER_ARCHIVE_PATHS.collection, gmToken)).json()) as {
      data: { replays: Array<{ id: number }> };
    };
    const archiveId = archives.data.replays[0]!.id;
    const share = await http(ENCOUNTER_ARCHIVE_PATHS.visibility.replace("{id}", String(archiveId)), gmToken, {
      method: "POST",
      body: JSON.stringify({ playerVisible: true })
    });
    expect(share.status).toBe(200);
    const replay = (await (
      await http(ENCOUNTER_ARCHIVE_PATHS.byId.replace("{id}", String(archiveId)), playerToken)
    ).json()) as { data: { document: { turns: unknown[] } } };
    expect(replay.data.document.turns.length).toBeGreaterThan(1);
    expect(mentionsGoblin(replay)).toBe(false);
  });

  it("keeps a goblin wholly under the fog out of every player channel, the table screen and the replay", async () => {
    // The GM prepared the crypt with fog: the goblin wholly under it, the orc's space partly revealed.
    const { server, gm, player, received, http, gmToken, playerToken, mapAssetId } = await table(true, "fog");
    expect(await emit(gm, "encounter:activate", { encounterId: SCENE })).toMatchObject({ ok: true });
    expect(await emit(gm, "encounter:start", { mapAssetId })).toMatchObject({ ok: true });
    // A few turns pass. The goblin moves about under the fog.
    for (let turn = 0; turn < 3; turn++) {
      if (server.store.snapshot.combat.turnActorId === GOBLIN)
        expect(
          await emit(gm, "token:move", { actorId: GOBLIN, position: { x: 475, y: 225 + 50 * turn } })
        ).toMatchObject({
          ok: true
        });
      expect(await emit(gm, "initiative:next", {})).toMatchObject({ ok: true });
    }
    const gmView = (await (await http(GAME_PATHS.snapshot, gmToken)).json()) as { data: unknown };
    expect(mentionsGoblin(gmView)).toBe(true);
    // The player gets their own hero and the half-revealed orc, and the fog's shapes; nothing of the goblin.
    const playerView = (await (await http(GAME_PATHS.snapshot, playerToken)).json()) as {
      data: { game: { combat: { tokens: Array<{ actorId: string }>; fog: { enabled: boolean } } } };
    };
    expect(playerView.data.game.combat.tokens.map((token) => token.actorId).sort()).toEqual([HERO, ORC].sort());
    expect(playerView.data.game.combat.fog.enabled).toBe(true);
    expect(mentionsGoblin(playerView)).toBe(false);
    expect(mentionsGoblin(await (await http(`${GAME_PATHS.log}?limit=1000`, playerToken)).json())).toBe(false);
    expect(received.length).toBeGreaterThan(0);
    expect(received.filter(mentionsGoblin)).toEqual([]);
    expect(mentionsGoblin(server.viewerPresentation.snapshot)).toBe(false);
    expect(JSON.stringify(server.viewerPresentation.snapshot)).toContain(ORC);
    // Nor can the player aim at it by id, and the refusal reads as it would for a creature that isn't there.
    const attack = await emit(player, "action:resolve", {
      actorId: HERO,
      actionId: "unarmed-strike",
      targetIds: [GOBLIN]
    });
    const missing = await emit(player, "action:resolve", {
      actorId: HERO,
      actionId: "unarmed-strike",
      targetIds: ["10000000-0000-4000-8000-00000000ffff"]
    });
    expect(attack).toMatchObject({ ok: false, message: "Every target must be in this encounter." });
    expect(missing).toEqual(attack);

    // The fight ends and the GM shares it: the replay keeps the goblin hidden in every turn.
    expect(await emit(gm, "encounter:end", {})).toMatchObject({ ok: true });
    const archives = (await (await http(ENCOUNTER_ARCHIVE_PATHS.collection, gmToken)).json()) as {
      data: { replays: Array<{ id: number }> };
    };
    const archiveId = archives.data.replays[0]!.id;
    const share = await http(ENCOUNTER_ARCHIVE_PATHS.visibility.replace("{id}", String(archiveId)), gmToken, {
      method: "POST",
      body: JSON.stringify({ playerVisible: true })
    });
    expect(share.status).toBe(200);
    const replay = (await (
      await http(ENCOUNTER_ARCHIVE_PATHS.byId.replace("{id}", String(archiveId)), playerToken)
    ).json()) as { data: { document: { turns: unknown[] } } };
    expect(replay.data.document.turns.length).toBeGreaterThan(1);
    expect(mentionsGoblin(replay)).toBe(false);
    expect(JSON.stringify(replay)).toContain(ORC);
  });

  it("shows a creature once the fog over it lifts, and lets a player's move pass over it until then", async () => {
    const { gm, player, http, playerToken, mapAssetId } = await table();
    expect(
      await emit(gm, "encounter:start", {
        mapAssetId,
        entries: [
          { actorId: HERO, score: 20 },
          { actorId: GOBLIN, score: 10 }
        ]
      })
    ).toMatchObject({ ok: true });
    expect(await emit(gm, "token:move", { actorId: HERO, position: { x: 75, y: 275 } })).toMatchObject({ ok: true });
    expect(await emit(gm, "token:move", { actorId: GOBLIN, position: { x: 125, y: 275 } })).toMatchObject({ ok: true });
    // Fog over everything but the hero's square.
    expect(await emit(gm, "fog:set-enabled", { enabled: true })).toMatchObject({ ok: true });
    expect(await emit(gm, "fog:paint", { op: "reveal", rect: { x: 50, y: 250, width: 50, height: 50 } })).toMatchObject(
      { ok: true }
    );
    const tokensOf = async () =>
      (
        (await (await http(GAME_PATHS.snapshot, playerToken)).json()) as {
          data: { game: { combat: { tokens: Array<{ actorId: string }> } } };
        }
      ).data.game.combat.tokens.map((token) => token.actorId);
    expect(await tokensOf()).toEqual([HERO]);
    // A move into the goblin's square isn't refused, which would give it away.
    expect(await emit(player, "token:move", { actorId: HERO, position: { x: 125, y: 275 } })).toMatchObject({
      ok: true
    });
    expect(await emit(gm, "token:move", { actorId: HERO, position: { x: 75, y: 275 } })).toMatchObject({ ok: true });
    // The GM lifts the fog off it: the player sees it and may aim at it.
    expect(
      await emit(gm, "fog:paint", { op: "reveal", rect: { x: 100, y: 250, width: 50, height: 50 } })
    ).toMatchObject({ ok: true });
    expect((await tokensOf()).sort()).toEqual([HERO, GOBLIN].sort());
    expect(
      await emit(player, "action:resolve", { actorId: HERO, actionId: "unarmed-strike", targetIds: [GOBLIN] })
    ).toMatchObject({ ok: true });
  });

  it("lets a player open a door beside their character, and shows what lies beyond", async () => {
    const { server, gm, player, http, playerToken, mapAssetId } = await table();
    expect(
      await emit(gm, "encounter:start", {
        mapAssetId,
        entries: [
          { actorId: HERO, score: 20 },
          { actorId: GOBLIN, score: 10 }
        ]
      })
    ).toMatchObject({ ok: true });
    expect(await emit(gm, "token:move", { actorId: HERO, position: { x: 225, y: 275 } })).toMatchObject({ ok: true });
    expect(await emit(gm, "token:move", { actorId: GOBLIN, position: { x: 425, y: 275 } })).toMatchObject({ ok: true });
    expect(await emit(gm, "vision:set-enabled", { enabled: true })).toMatchObject({ ok: true });
    // A wall with a closed door in it, right beside the hero (the door spans row 5 at x = 250).
    expect(
      await emit(gm, "wall:add", {
        kind: "wall",
        points: [
          { x: 250, y: 0 },
          { x: 250, y: 250 }
        ]
      })
    ).toMatchObject({ ok: true });
    expect(
      await emit(gm, "wall:add", {
        kind: "wall",
        points: [
          { x: 250, y: 300 },
          { x: 250, y: 600 }
        ]
      })
    ).toMatchObject({ ok: true });
    const door = (await emit(gm, "wall:add", {
      kind: "door",
      points: [
        { x: 251, y: 249 },
        { x: 249, y: 302 }
      ]
    })) as {
      ok: boolean;
      wallIds: string[];
    };
    expect(door.ok).toBe(true);
    // The door's ends snapped to the walls' ends.
    expect(server.store.snapshot.combat.vision.walls.find((entry) => entry.id === door.wallIds[0])).toMatchObject({
      a: { x: 250, y: 250 },
      b: { x: 250, y: 300 },
      open: false
    });
    const before = (await (await http(GAME_PATHS.snapshot, playerToken)).json()) as { data: { game: unknown } };
    expect(mentionsGoblin(before)).toBe(false);

    // A player can open it from beside it, but not a door they aren't next to.
    expect(await emit(player, "door:set-open", { wallId: door.wallIds[0], open: true })).toMatchObject({ ok: true });
    const after = (await (await http(GAME_PATHS.snapshot, playerToken)).json()) as {
      data: { game: { combat: { tokens: Array<{ actorId: string }> } } };
    };
    expect(after.data.game.combat.tokens.map((token) => token.actorId).sort()).toEqual([HERO, GOBLIN].sort());
    expect(await emit(gm, "token:move", { actorId: HERO, position: { x: 75, y: 75 } })).toMatchObject({ ok: true });
    expect(await emit(player, "door:set-open", { wallId: door.wallIds[0], open: false })).toMatchObject({
      ok: false,
      message: "Move your character next to the door to open or close it."
    });

    // Walls and lights are the GM's: a player can't place one, nor prep a parked scene's doors.
    expect(
      await emit(player, "light:add", { position: { x: 100, y: 100 }, brightFeet: 20, dimFeet: 20 })
    ).toMatchObject({
      ok: false
    });
    expect(
      await emit(player, "door:set-open", { wallId: door.wallIds[0], open: true, encounterId: randomUUID() })
    ).toMatchObject({ ok: false });
  });

  it("refuses vision on a map it can't measure feet on", async () => {
    const { server, gm } = await table();
    const plain = await server.mapAssets.import(png(800, 600), "plain.png");
    server.mapCatalog.register(plain.metadata.id, "Plain", "battlemap");
    expect(
      await emit(gm, "encounter:start", { mapAssetId: plain.metadata.id, entries: [{ actorId: HERO, score: 10 }] })
    ).toMatchObject({ ok: true });
    expect(await emit(gm, "vision:set-enabled", { enabled: true })).toMatchObject({
      ok: false,
      message: "Calibrate the map's grid or set its scale before turning on vision."
    });
  });
});
