import { randomUUID } from "node:crypto";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { GAME_PATHS } from "@vtt/api-contract";
import { afterEach, describe, expect, it } from "vitest";
import { projectPlayerView } from "../src/projections.js";
import { projectViewerEncounterScene } from "../src/viewer-encounter.js";
import { bootServer } from "./boot-server.js";
import { png } from "./image-fixtures.js";

// "Make live" means the same on phones and the table screen: the live scene's map, the public tokens the GM has
// placed, and the fog, before any fight. What the fog covers, the GM's secrets and who waits in the tray stay off it.

const HERO = "10000000-0000-4000-8000-0000000000a1";
const SCOUT = "10000000-0000-4000-8000-0000000000a2";
const LURKER = "10000000-0000-4000-8000-0000000000a3";
const SECRET = "10000000-0000-4000-8000-0000000000a4";
const WAITING = "10000000-0000-4000-8000-0000000000a5";
const MAP = "20000000-0000-5000-8000-0000000000a1";
const PLAYER = "30000000-0000-4000-8000-0000000000a1";

const token = (actorId: string, position: { x: number; y: number } | null) => ({
  actorId,
  position,
  sizePx: 41,
  gridSizePx: 50,
  sizeCells: 1
});

/** A live scene before its fight: fog on, the left half revealed, a goblin in the light and one under the fog. */
function liveScene(): GameState {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: HERO,
        name: "Lyra",
        kind: "player-character",
        hp: { current: 20, maximum: 20 },
        ownerSessionId: PLAYER
      },
      { id: SCOUT, name: "Goblin Scout", kind: "monster", hp: { current: 7, maximum: 7 } },
      { id: LURKER, name: "Goblin Lurker", kind: "monster", hp: { current: 7, maximum: 7 } },
      { id: SECRET, name: "Hidden Hag", kind: "monster", visibility: "gm-only", hp: { current: 30, maximum: 30 } },
      { id: WAITING, name: "Goblin Reserve", kind: "monster", hp: { current: 7, maximum: 7 } }
    ],
    combat: {
      active: false,
      mapAssetId: MAP,
      initiative: [HERO, SCOUT, LURKER, SECRET, WAITING].map((actorId) => ({ actorId, score: 0 })),
      tokens: [
        token(HERO, { x: 75, y: 75 }),
        token(SCOUT, { x: 225, y: 75 }),
        token(LURKER, { x: 725, y: 75 }),
        token(SECRET, { x: 275, y: 125 }),
        token(WAITING, null)
      ],
      fog: {
        enabled: true,
        shapes: [
          {
            kind: "rect",
            id: "50000000-0000-4000-8000-0000000000a1",
            op: "reveal",
            x: 0,
            y: 0,
            width: 400,
            height: 400
          }
        ]
      }
    }
  });
}

describe("a live scene before its fight", () => {
  it("gives a player the map and the placed public tokens the fog doesn't cover", () => {
    const view = projectPlayerView(liveScene(), PLAYER, () => null);
    expect(view.combat.active).toBe(false);
    expect(view.combat.mapAssetId).toBe(MAP);
    expect(view.combat.tokens.map((entry) => entry.actorId)).toEqual([HERO, SCOUT]);
    expect(view.combat.fog.enabled).toBe(true);
    // Who the GM staged is not the players' to know before the fight starts.
    expect(view.combat.initiative).toEqual([]);
    const combat = JSON.stringify(view.combat);
    for (const unseen of [LURKER, SECRET, WAITING]) expect(combat).not.toContain(unseen);
  });

  it("keeps a player's own character on their map when the fog covers it", () => {
    const state = liveScene();
    state.combat.tokens = state.combat.tokens.map((entry) =>
      entry.actorId === HERO ? { ...entry, position: { x: 625, y: 325 } } : entry
    );
    expect(projectPlayerView(state, PLAYER, () => null).combat.tokens.map((entry) => entry.actorId)).toEqual([
      HERO,
      SCOUT
    ]);
    // Anyone else's view (a spectator) leaves it under the fog.
    expect(projectPlayerView(state, undefined, () => null).combat.tokens.map((entry) => entry.actorId)).toEqual([
      SCOUT
    ]);
  });

  it("shows the table screen the same map and tokens", () => {
    const scene = projectViewerEncounterScene(liveScene());
    expect(scene.mapAssetId).toBe(MAP);
    expect(scene.tokens.map((entry) => entry.actorId)).toEqual([HERO, SCOUT]);
    expect(scene.tokens.every((entry) => entry.active === false)).toBe(true);
    expect(JSON.stringify(scene)).not.toContain("Goblin Lurker");
    expect(JSON.stringify(scene)).not.toContain("Hidden Hag");
  });

  it("drops a token from both once the fog covers it again, and shows it when any of its space is revealed", () => {
    const state = liveScene();
    state.combat.fog = {
      enabled: true,
      shapes: [
        ...state.combat.fog.shapes,
        { kind: "rect", id: "50000000-0000-4000-8000-0000000000a2", op: "hide", x: 200, y: 50, width: 50, height: 50 },
        // A sliver of the lurker's cell is revealed: any part of its space in the open shows it.
        { kind: "rect", id: "50000000-0000-4000-8000-0000000000a3", op: "reveal", x: 700, y: 50, width: 10, height: 10 }
      ]
    };
    expect(projectPlayerView(state, PLAYER, () => null).combat.tokens.map((entry) => entry.actorId)).toEqual([
      HERO,
      LURKER
    ]);
    expect(projectViewerEncounterScene(state).tokens.map((entry) => entry.actorId)).toEqual([HERO, LURKER]);
  });
});

describe("placing tokens on a live scene before its fight", () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of closers.splice(0)) await close();
  });

  it("lets the GM place them, refuses a player, and reaches the player's map over HTTP without the fogged goblin", async () => {
    const { base, server, gmToken, post, close } = await bootServer(
      GameStateSchema.parse({
        schemaVersion: 1,
        actors: [
          { id: HERO, name: "Lyra", kind: "player-character", hp: { current: 20, maximum: 20 } },
          { id: SCOUT, name: "Goblin Scout", kind: "monster", hp: { current: 7, maximum: 7 } },
          { id: LURKER, name: "Goblin Lurker", kind: "monster", hp: { current: 7, maximum: 7 } }
        ]
      })
    );
    closers.push(close);
    const imported = await server.mapAssets.import(png(800, 400), "crypt.png");
    server.mapCatalog.register(imported.metadata.id, "Sunken crypt", "battlemap");
    server.mapCatalog.saveCalibration(imported.metadata.id, {
      calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 },
      verifiedAt: null,
      verificationPoint: null,
      verificationErrorPx: null
    });
    const playerToken = server.auth.issuePlayerSession();
    expect((await post(GAME_PATHS.claims, playerToken, { commandId: randomUUID(), actorId: HERO })).status).toBe(200);
    const created = await post(GAME_PATHS.scenes, gmToken, {
      commandId: randomUUID(),
      name: "Sunken crypt",
      mapAssetId: imported.metadata.id,
      combatantIds: [HERO, SCOUT, LURKER],
      activate: true
    });
    expect(created.status).toBe(200);
    const move = (who: string, actorId: string, position: { x: number; y: number }) =>
      post(GAME_PATHS.tokenMove.replace("{actorId}", actorId), who, { commandId: randomUUID(), position });

    // The GM places the party and the goblins; the player may not move theirs before the fight starts.
    expect((await move(gmToken, HERO, { x: 75, y: 75 })).status).toBe(200);
    expect((await move(gmToken, SCOUT, { x: 225, y: 75 })).status).toBe(200);
    expect((await move(gmToken, LURKER, { x: 725, y: 75 })).status).toBe(200);
    const refused = await move(playerToken, HERO, { x: 125, y: 75 });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.message).toBe("Your GM places the tokens before the fight starts.");
    // Setting the scene narrates nothing to the table.
    const log = await (await fetch(base + GAME_PATHS.log, { headers: { authorization: `Bearer ${gmToken}` } })).json();
    expect(JSON.stringify(log)).not.toContain("entered the map");

    expect((await post(GAME_PATHS.fogEnabled, gmToken, { commandId: randomUUID(), enabled: true })).status).toBe(200);
    expect(
      (
        await post(GAME_PATHS.fogPaint, gmToken, {
          commandId: randomUUID(),
          op: "reveal",
          rect: { x: 0, y: 0, width: 400, height: 400 }
        })
      ).status
    ).toBe(200);

    const snapshot = await (
      await fetch(base + GAME_PATHS.snapshot, { headers: { authorization: `Bearer ${playerToken}` } })
    ).json();
    const combat = snapshot.data.game.combat;
    expect(combat.active).toBe(false);
    expect(combat.mapAssetId).toBe(imported.metadata.id);
    expect(combat.tokens.map((entry: { actorId: string }) => entry.actorId)).toEqual([HERO, SCOUT]);
    expect(JSON.stringify(combat)).not.toContain(LURKER);
    // The table screen shows the same.
    expect(server.viewerPresentation.snapshot.encounter.tokens.map((entry) => entry.actorId)).toEqual([HERO, SCOUT]);
    // Tokens placed before the fight keep their places when it starts.
    expect(
      (
        await post(GAME_PATHS.encounterStart, gmToken, {
          commandId: randomUUID(),
          mapAssetId: imported.metadata.id,
          entries: [{ actorId: HERO }, { actorId: SCOUT }, { actorId: LURKER }]
        })
      ).status
    ).toBe(200);
    expect(server.store.snapshot.combat.tokens.find((entry) => entry.actorId === LURKER)?.position).toEqual({
      x: 725,
      y: 75
    });
  });
});

describe("the table screen and the live scene", () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of closers.splice(0)) await close();
  });

  it("follows the scene that goes live unless the GM paused it", async () => {
    const { base, server, gmToken, post, close } = await bootServer(GameStateSchema.parse({ schemaVersion: 1 }));
    closers.push(close);
    const mapIds: string[] = [];
    for (const name of ["Crypt", "Bridge"]) {
      const imported = await server.mapAssets.import(png(600, 400), `${name}.png`);
      server.mapCatalog.register(imported.metadata.id, name, "battlemap");
      mapIds.push(imported.metadata.id);
    }
    const goLive = async (name: string, mapAssetId: string) =>
      expect(
        (
          await post(GAME_PATHS.scenes, gmToken, {
            commandId: randomUUID(),
            name,
            mapAssetId,
            combatantIds: [],
            activate: true
          })
        ).status
      ).toBe(200);
    const screen = async (payload: unknown) => {
      const response = await fetch(`${base}/api/v1/viewer/presentation/commands`, {
        method: "POST",
        headers: { authorization: `Bearer ${gmToken}`, "content-type": "application/json" },
        body: JSON.stringify({ id: randomUUID(), payload })
      });
      expect(response.status).toBe(200);
    };

    // A screen nobody has started yet comes on with the first live scene.
    await goLive("Crypt", mapIds[0]);
    expect(server.viewerPresentation.snapshot).toMatchObject({ enabled: true, activeMap: { assetId: mapIds[0] } });

    // Paused by the GM, it stays paused when the next scene goes live.
    await screen({ type: "viewer.enabled.set", enabled: false });
    await goLive("Bridge", mapIds[1]);
    expect(server.viewerPresentation.snapshot.enabled).toBe(false);

    // Resumed, it shows the live scene: its encounter follows the table's map.
    await screen({ type: "viewer.enabled.set", enabled: true });
    expect(server.viewerPresentation.snapshot).toMatchObject({
      enabled: true,
      encounter: { mapAssetId: mapIds[1] },
      activeMap: { assetId: mapIds[1] }
    });
    await goLive("Crypt again", mapIds[0]);
    expect(server.viewerPresentation.snapshot).toMatchObject({ enabled: true, activeMap: { assetId: mapIds[0] } });
  });
});
