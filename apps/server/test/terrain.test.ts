import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { GAME_PATHS, SESSION_PATHS } from "@vtt/api-contract";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { openApiDocument } from "../src/openapi/document.js";
import { createServer } from "../src/server.js";
import { timelineDirtied } from "../src/combat-history.js";
import { CommandRejectedError, RulesBlockedError } from "../src/game-store.js";
import { applyMovementRules, movementStatus } from "../src/movement-rules.js";
import { projectPlayerCombat } from "../src/projections.js";
import { movementCost, paintTerrain, resetTerrain, visibleTerrain } from "../src/terrain.js";
import type { TokenMapGeometry } from "../src/token-placement.js";
import { projectViewerEncounterScene } from "../src/viewer-encounter.js";

const MAP = "20000000-0000-5000-8000-000000000001";
const SCENE = "60000000-0000-4000-8000-000000000001";
const HERO = "10000000-0000-4000-8000-000000000001";
const FRIEND = "10000000-0000-4000-8000-000000000002";
const OGRE = "10000000-0000-4000-8000-000000000003";
const LURKER = "10000000-0000-4000-8000-000000000004";
const RAT = "10000000-0000-4000-8000-000000000005";

/** 50px cells, 5 ft each, origin at 0,0; cell (c,r) center = (25 + 50c, 25 + 50r). */
const GRID: TokenMapGeometry = {
  width: 1000,
  height: 1000,
  calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
};
const GRIDLESS: TokenMapGeometry = { width: 1000, height: 1000, calibration: null };
const cell = (column: number, row: number) => ({ x: 25 + 50 * column, y: 25 + 50 * row });
/** The image rect covering cells [c0, c1] x [r0, r1]. */
const cells = (c0: number, r0: number, c1: number, r1: number) => ({
  x: 50 * c0,
  y: 50 * r0,
  width: 50 * (c1 - c0 + 1),
  height: 50 * (r1 - r0 + 1)
});

function game(positions: Readonly<Record<string, { x: number; y: number }>> = {}): GameState {
  const actors = [
    { id: HERO, name: "Borin", kind: "player-character", visibility: "public", speedFeet: 30 },
    { id: FRIEND, name: "Mirena", kind: "player-character", visibility: "public", speedFeet: 30 },
    { id: OGRE, name: "Ogre", kind: "monster", visibility: "public", size: "large", speedFeet: 40 },
    { id: LURKER, name: "Unseen Stalker", kind: "monster", visibility: "gm-only", speedFeet: 30 },
    { id: RAT, name: "Rat", kind: "monster", visibility: "public", size: "tiny", speedFeet: 20 }
  ] as const;
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: actors.map((actor) => ({ ...actor, hp: { current: 10, maximum: 10 } })),
    combat: {
      active: true,
      round: 1,
      turnActorId: HERO,
      mapAssetId: MAP,
      initiative: actors.map((actor, index) => ({ actorId: actor.id, score: 20 - index })),
      tokens: actors
        .filter((actor) => positions[actor.id] !== undefined)
        .map((actor) => ({
          actorId: actor.id,
          position: positions[actor.id],
          sizePx: 40,
          sizeCells: actor.id === OGRE ? 2 : 1
        })),
      scenes: [{ id: SCENE, name: "Parked bridge", mapAssetId: MAP, combat: {} }]
    }
  });
}

describe("painting difficult terrain", () => {
  it("snaps a stroke to whole cells, merges overlapping strokes, and clears any shape out of them", () => {
    const state = game();
    paintTerrain(state, undefined, GRID, { op: "difficult", rect: { x: 60, y: 60, width: 80, height: 30 } });
    expect(state.combat.terrain.difficult).toEqual([cells(1, 1, 2, 1)]);
    // The same area again adds nothing; an adjoining row merges into one rect.
    paintTerrain(state, undefined, GRID, { op: "difficult", rect: cells(1, 1, 2, 1) });
    paintTerrain(state, undefined, GRID, { op: "difficult", rect: cells(1, 2, 2, 2) });
    expect(state.combat.terrain.difficult).toEqual([cells(1, 1, 2, 2)]);
    // Clearing one cell leaves the rest marked.
    paintTerrain(state, undefined, GRID, { op: "clear", rect: cells(1, 1, 1, 1) });
    const area = state.combat.terrain.difficult.reduce((sum, rect) => sum + rect.width * rect.height, 0);
    expect(area).toBe(3 * 50 * 50);
    resetTerrain(state, undefined);
    expect(state.combat.terrain.difficult).toEqual([]);
  });

  it("needs a calibrated grid, and edits a parked scene's own terrain", () => {
    const state = game();
    expect(() => paintTerrain(state, undefined, GRIDLESS, { op: "difficult", rect: cells(0, 0, 1, 1) })).toThrowError(
      CommandRejectedError
    );
    paintTerrain(state, SCENE, GRID, { op: "difficult", rect: cells(0, 0, 0, 0) });
    expect(state.combat.scenes[0]!.combat.terrain.difficult).toEqual([cells(0, 0, 0, 0)]);
    expect(state.combat.terrain.difficult).toEqual([]);
  });

  it("is scene dressing: painting never dirties the combat timeline", () => {
    const before = game();
    const after = structuredClone(before);
    paintTerrain(after, undefined, GRID, { op: "difficult", rect: cells(0, 0, 3, 3) });
    expect(timelineDirtied(before, after)).toBe(false);
  });
});

describe("what players and the table screen see of the terrain", () => {
  it("shows all of it without fog, and only the revealed part with fog", () => {
    const state = game();
    paintTerrain(state, undefined, GRID, { op: "difficult", rect: cells(0, 0, 3, 0) });
    expect(visibleTerrain(state.combat).difficult).toEqual([cells(0, 0, 3, 0)]);

    state.combat = {
      ...state.combat,
      fog: {
        enabled: true,
        shapes: [{ kind: "rect", id: "70000000-0000-4000-8000-000000000001", op: "reveal", ...cells(0, 0, 1, 5) }]
      }
    };
    expect(visibleTerrain(state.combat).difficult).toEqual([cells(0, 0, 1, 0)]);
    expect(projectPlayerCombat(state, undefined).terrain.difficult).toEqual([cells(0, 0, 1, 0)]);
    expect(projectViewerEncounterScene(state).terrain?.difficult).toEqual([cells(0, 0, 1, 0)]);

    // Hiding the revealed area again takes its terrain back out of view.
    state.combat = {
      ...state.combat,
      fog: {
        enabled: true,
        shapes: [
          ...state.combat.fog.shapes,
          { kind: "rect", id: "70000000-0000-4000-8000-000000000002", op: "hide", ...cells(0, 0, 0, 5) }
        ]
      }
    };
    expect(visibleTerrain(state.combat).difficult).toEqual([cells(1, 0, 1, 0)]);
  });
});

describe("what a move costs", () => {
  it("is the straight count on open ground", () => {
    const state = game({ [HERO]: cell(4, 0) });
    expect(movementCost(state, GRID, HERO, cell(0, 0), cell(4, 0))).toEqual({
      feet: 20,
      difficultFeet: 0,
      path: [cell(0, 0), cell(1, 0), cell(2, 0), cell(3, 0), cell(4, 0)]
    });
  });

  it("charges double through difficult terrain it can't go round, and nothing extra when it can", () => {
    const state = game({ [HERO]: cell(4, 0) });
    // A band of rubble across the whole map.
    paintTerrain(state, undefined, GRID, { op: "difficult", rect: cells(2, 0, 2, 19) });
    expect(movementCost(state, GRID, HERO, cell(0, 0), cell(4, 0))).toMatchObject({ feet: 25, difficultFeet: 5 });
    // A small patch is cheaper to walk round.
    resetTerrain(state, undefined);
    paintTerrain(state, undefined, GRID, { op: "difficult", rect: cells(2, 0, 2, 0) });
    expect(movementCost(state, GRID, HERO, cell(0, 0), cell(4, 0))).toMatchObject({ feet: 20, difficultFeet: 0 });
  });

  it("lets a mover through an ally's, a Tiny creature's or a hidden one's space as open ground", () => {
    // Squeezed in a corridor one row high: the only way past is through whoever stands in it.
    const corridor = (occupant: string) => {
      const state = game({ [HERO]: cell(4, 0), [occupant]: cell(2, 0) });
      paintTerrain(state, undefined, GRID, { op: "difficult", rect: cells(0, 1, 19, 19) });
      return movementCost(state, GRID, HERO, cell(0, 0), cell(4, 0));
    };
    expect(corridor(FRIEND)).toMatchObject({ feet: 20, difficultFeet: 0 });
    expect(corridor(RAT)).toMatchObject({ feet: 20, difficultFeet: 0 });
    // A hidden creature never changes the cost, or a player's preview would disagree with the charge.
    expect(corridor(LURKER)).toMatchObject({ feet: 20, difficultFeet: 0 });
  });

  it("bars an enemy's space within a size of the mover, and opens it as difficult terrain once it is Incapacitated", () => {
    // SRD "Moving around Other Creatures": the Large ogre against the map's top edge can't be walked through by a
    // Medium hero, so the way runs round underneath, through the rubble there.
    const ogre = game({ [HERO]: cell(4, 0), [OGRE]: { x: 150, y: 50 } });
    expect(movementCost(ogre, GRID, HERO, cell(0, 0), cell(4, 0))?.feet).toBe(25);
    paintTerrain(ogre, undefined, GRID, { op: "difficult", rect: cells(0, 2, 19, 19) });
    expect(movementCost(ogre, GRID, HERO, cell(0, 0), cell(4, 0))).toMatchObject({ feet: 35, difficultFeet: 10 });
    // Stunned, it no longer bars the way: its space is Difficult Terrain, and straight through is cheapest.
    ogre.actors.find((actor) => actor.id === OGRE)!.conditions = [{ id: "stunned" }];
    expect(movementCost(ogre, GRID, HERO, cell(0, 0), cell(4, 0))).toMatchObject({ feet: 30, difficultFeet: 10 });
    // With no way round at all, the way is shut.
    const corridor = game({ [HERO]: cell(4, 0), [OGRE]: { x: 150, y: 50 } });
    paintTerrain(corridor, undefined, GRID, { op: "difficult", rect: cells(0, 2, 19, 19) });
    expect(movementCost(corridor, { ...GRID, height: 100 }, HERO, cell(0, 0), cell(4, 0))).toEqual({
      feet: 0,
      difficultFeet: 0,
      path: [],
      blocked: true
    });
  });

  it("measures straight on a scaled gridless map, where there is no terrain", () => {
    const state = game({ [HERO]: { x: 100, y: 0 } });
    const scaled: TokenMapGeometry = { ...GRIDLESS, scale: { kind: "image-scale", distancePerPixel: 0.1, unit: "ft" } };
    expect(movementCost(state, scaled, HERO, { x: 0, y: 0 }, { x: 100, y: 0 })).toMatchObject({
      feet: 10,
      difficultFeet: 0
    });
    expect(movementCost(state, GRIDLESS, HERO, { x: 0, y: 0 }, { x: 100, y: 0 })).toBeNull();
  });
});

describe("spending movement", () => {
  const move = (state: GameState, from: { x: number; y: number }, to: { x: number; y: number }) =>
    applyMovementRules(state, {
      actorId: HERO,
      from,
      to,
      distance: () => 0,
      cost: (a, b) => movementCost(state, GRID, HERO, a, b),
      override: null,
      resolveDefinition: () => undefined,
      newPromptId: () => "70000000-0000-4000-8000-000000000009",
      now: () => 0,
      commandId: "50000000-0000-4000-8000-000000000001"
    });

  it("charges the path, and names the difficult terrain when it refuses an overrun", () => {
    const state = game({ [HERO]: cell(0, 0) });
    paintTerrain(state, undefined, GRID, { op: "difficult", rect: cells(1, 0, 19, 19) });
    move(state, cell(0, 0), cell(2, 0));
    expect(state.combat.turn.movementUsedFeet).toBe(20);
    expect(() => move(state, cell(2, 0), cell(4, 0))).toThrowError(RulesBlockedError);
    expect(() => move(state, cell(2, 0), cell(4, 0))).toThrowError(
      "Borin has 10 ft of movement left (this move needs 20 ft, 10 ft of it for difficult terrain)."
    );
  });

  it("reports the budget a move is charged against", () => {
    const state = game({ [HERO]: cell(0, 0) });
    expect(movementStatus(state, HERO, { resolveDefinition: () => undefined })).toEqual({
      counted: true,
      speedFeet: 30,
      usedFeet: 0,
      enforcement: "strict",
      // No special speed: climbing and swimming spend Speed at an extra foot per foot.
      modes: [
        { mode: "walk", budgetFeet: 30, extraCost: false },
        { mode: "swim", budgetFeet: 30, extraCost: true },
        { mode: "climb", budgetFeet: 30, extraCost: true }
      ]
    });
    // Off its turn a creature's moves are free.
    expect(movementStatus(state, FRIEND, { resolveDefinition: () => undefined })).toMatchObject({
      counted: false,
      usedFeet: 0
    });
  });
});

describe("over HTTP", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function boot() {
    const directory = await mkdtemp(join(tmpdir(), "vtt-terrain-"));
    const server = createServer({
      authPath: join(directory, "auth.json"),
      databasePath: join(directory, "vtt.sqlite"),
      integrationCredentialsPath: join(directory, "integrations.sqlite"),
      mapAssetsPath: join(directory, "map-assets"),
      webDist: join(directory, "dist"),
      useDevelopmentClient: true,
      developmentClientPort: 5173,
      initialGameState: { ...game(), combat: { ...game().combat, mapAssetId: null, scenes: [] } }
    });
    await server.initialize();
    await server.auth.bootstrap("a sufficiently long GM password");
    const gmToken = (await server.auth.login("a sufficiently long GM password"))!;
    await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
    const address = server.httpServer.address();
    if (!address || typeof address === "string") throw new Error("Server did not bind.");
    const base = `http://127.0.0.1:${address.port}`;
    cleanups.push(async () => {
      server.close();
      await rm(directory, { recursive: true, force: true });
    });
    const issued = await fetch(`${base}${SESSION_PATHS.player}`, { method: "POST" });
    const playerToken = ((await issued.json()) as { data: { token: string } }).data.token;
    return { base, gmToken, playerToken };
  }
  const headers = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });

  it("reports a combatant's movement in the documented shape, and only a player's own to a player", async () => {
    const { base, gmToken, playerToken } = await boot();
    const path = GAME_PATHS.actorMovement.replace("{actorId}", HERO);
    const answer = await fetch(`${base}${path}`, { headers: headers(gmToken) });
    expect(answer.status).toBe(200);
    const body = (await answer.json()) as { data: unknown };
    expect(body.data).toMatchObject({ counted: true, speedFeet: 30, usedFeet: 0, enforcement: "strict" });
    const ajv = new Ajv2020({ strict: false });
    ajv.addSchema(openApiDocument as unknown as Record<string, unknown>, "openapi");
    const validate = ajv.compile({ $ref: "openapi#/components/schemas/ActorMovementResponse" });
    expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
    // The player owns no character here, so Borin's movement is not theirs to read.
    expect((await fetch(`${base}${path}`, { headers: headers(playerToken) })).status).toBe(403);
  });

  it("lets only the GM mark terrain", async () => {
    const { base, gmToken, playerToken } = await boot();
    const stroke = JSON.stringify({ commandId: crypto.randomUUID(), op: "difficult", rect: cells(0, 0, 1, 1) });
    const asPlayer = await fetch(`${base}${GAME_PATHS.terrainPaint}`, {
      method: "POST",
      headers: headers(playerToken),
      body: stroke
    });
    expect(asPlayer.status).toBe(403);
    // The GM gets past the gate, and is told the table has no map to mark.
    const asGm = await fetch(`${base}${GAME_PATHS.terrainPaint}`, {
      method: "POST",
      headers: headers(gmToken),
      body: stroke
    });
    expect(asGm.status).toBe(409);
    expect(((await asGm.json()) as { error: { message: string } }).error.message).toBe(
      "Pick a map before marking terrain."
    );
  });
});

describe("a speed for the example party", () => {
  it("is seeded on a new game, and filled in on a saved one that lacked it", async () => {
    const { createInitialGameState } = await import("../src/initial-game-state.js");
    const { fillMissingSpeeds, storedDefinition } = await import("../src/actor-roster.js");
    const fresh = createInitialGameState();
    expect(fresh.actors.map((actor) => actor.speedFeet)).toEqual([30, 30, 30]);
    const saved = structuredClone(fresh);
    for (const actor of saved.actors) delete actor.speedFeet;
    saved.actors[0]!.speedFeet = 25;
    expect(fillMissingSpeeds(saved, (definitionId) => storedDefinition(saved, definitionId))).toBe(true);
    // A speed the GM set stays; the missing ones come from the sheets.
    expect(saved.actors.map((actor) => actor.speedFeet)).toEqual([25, 30, 30]);
    expect(fillMissingSpeeds(saved, (definitionId) => storedDefinition(saved, definitionId))).toBe(false);
  });
});
