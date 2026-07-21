import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { paintFog, resetFog, setFogEnabled, type FogMapGeometry } from "../src/fog.js";
import { timelineDirtied } from "../src/combat-history.js";
import { projectPlayerCombat } from "../src/projections.js";
import { projectViewerEncounterScene } from "../src/viewer-encounter.js";
import { CommandRejectedError } from "../src/game-store.js";

const MAP = "50000000-0000-5000-8000-000000000001";
const SCENE = "60000000-0000-4000-8000-000000000001";
const SCENE_MAP = "50000000-0000-5000-8000-000000000002";
const shapeId = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const GRIDLESS: FogMapGeometry = { width: 900, height: 600, calibration: null };
const CALIBRATED: FogMapGeometry = { width: 900, height: 600, calibration: { kind: "square", origin: { x: 100, y: 100 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 } };

const HERO = "40000000-0000-4000-8000-000000000001";

function buildGame(overrides: Record<string, unknown> = {}): GameState {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [],
    combat: {
      active: false, round: 1, turnActorId: null, mapAssetId: MAP, initiative: [], tokens: [],
      scenes: [{ id: SCENE, name: "Parked ambush", mapAssetId: SCENE_MAP, combat: {} }],
      ...overrides
    }
  });
}

function buildActiveGame(): GameState {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [{ id: HERO, name: "Hero", kind: "player-character", visibility: "public", hp: { current: 10, maximum: 10 } }],
    combat: { active: true, round: 1, turnActorId: HERO, mapAssetId: MAP, initiative: [{ actorId: HERO, score: 10 }], tokens: [{ actorId: HERO, position: { x: 50, y: 50 }, sizePx: 40 }] }
  });
}

describe("manual fog of war (state + fold semantics)", () => {
  it("defaults off with no shapes, and pre-fog saves parse with the default (additive-state)", () => {
    const game = buildGame();
    expect(game.combat.fog).toEqual({ enabled: false, shapes: [] });
    expect(game.combat.scenes[0].combat.fog).toEqual({ enabled: false, shapes: [] });
  });

  it("paints ordered reveal/hide strokes that fold over 'all hidden'", () => {
    const game = buildGame();
    setFogEnabled(game, undefined, true);
    paintFog(game, undefined, GRIDLESS, { id: shapeId(1), op: "reveal", rect: { x: 10, y: 10, width: 200, height: 150 } });
    paintFog(game, undefined, GRIDLESS, { id: shapeId(2), op: "hide", rect: { x: 60, y: 60, width: 50, height: 50 } });
    expect(game.combat.fog.enabled).toBe(true);
    expect(game.combat.fog.shapes.map((shape) => shape.op)).toEqual(["reveal", "hide"]);
    // Order is the semantics: the later hide re-covers part of the earlier reveal.
    expect(game.combat.fog.shapes[1]).toMatchObject({ x: 60, y: 60, width: 50, height: 50 });
  });

  it("snaps to whole grid cells on a calibrated unrotated map and clamps to the map bounds", () => {
    const game = buildGame();
    // A sloppy drag inside cells (110,115)-(180,190) snaps out to the enclosing cell edges.
    paintFog(game, undefined, CALIBRATED, { id: shapeId(1), op: "reveal", rect: { x: 112, y: 118, width: 65, height: 68 } });
    expect(game.combat.fog.shapes[0]).toMatchObject({ x: 100, y: 100, width: 100, height: 100 });
    // Overshooting the map clamps.
    paintFog(game, undefined, GRIDLESS, { id: shapeId(2), op: "reveal", rect: { x: 800, y: 500, width: 500, height: 500 } });
    expect(game.combat.fog.shapes[1]).toMatchObject({ x: 800, y: 500, width: 100, height: 100 });
    // A rect entirely off the map has nothing left after clamping.
    expect(() => paintFog(game, undefined, GRIDLESS, { id: shapeId(3), op: "reveal", rect: { x: 2000, y: 2000, width: 50, height: 50 } })).toThrowError(CommandRejectedError);
  });

  it("a full-map stroke compacts the list, and the cap rejects runaway stroke counts", () => {
    const game = buildGame();
    for (let index = 0; index < 5; index++) paintFog(game, undefined, GRIDLESS, { id: shapeId(index), op: "reveal", rect: { x: index * 10, y: 0, width: 20, height: 20 } });
    expect(game.combat.fog.shapes).toHaveLength(5);
    paintFog(game, undefined, GRIDLESS, { id: shapeId(9), op: "reveal", rect: { x: 0, y: 0, width: 900, height: 600 } });
    expect(game.combat.fog.shapes).toHaveLength(1); // "Reveal all" superseded the strokes before it
    for (let index = 0; index < 199; index++) paintFog(game, undefined, GRIDLESS, { id: shapeId(100 + index), op: "hide", rect: { x: 1, y: 1, width: 2, height: 2 } });
    expect(() => paintFog(game, undefined, GRIDLESS, { id: shapeId(999), op: "hide", rect: { x: 1, y: 1, width: 2, height: 2 } })).toThrowError(/Reset/);
    resetFog(game, undefined);
    expect(game.combat.fog.shapes).toEqual([]);
  });

  it("targets a parked scene's private prep via sceneId, never the live slot or a missing scene", () => {
    const game = buildGame();
    setFogEnabled(game, SCENE, true);
    paintFog(game, SCENE, GRIDLESS, { id: shapeId(1), op: "reveal", rect: { x: 0, y: 0, width: 100, height: 100 } });
    expect(game.combat.scenes[0].combat.fog.enabled).toBe(true);
    expect(game.combat.scenes[0].combat.fog.shapes).toHaveLength(1);
    expect(game.combat.fog).toEqual({ enabled: false, shapes: [] }); // the live table untouched
    expect(() => setFogEnabled(game, "60000000-0000-4000-8000-00000000dead", true)).toThrowError(/no longer exists/);
    const live = buildGame({ activeSceneId: SCENE });
    expect(() => setFogEnabled(live, SCENE, true)).toThrowError(/live/);
  });

  it("never dirties the combat timeline and survives a rewind (scene dressing, not combat state)", () => {
    const game = buildActiveGame();
    const before = structuredClone(game);
    setFogEnabled(game, undefined, true);
    paintFog(game, undefined, GRIDLESS, { id: shapeId(1), op: "reveal", rect: { x: 0, y: 0, width: 100, height: 100 } });
    expect(timelineDirtied(before, game)).toBe(false);
  });

  it("reaches players and the viewer verbatim (the mask IS the render input)", () => {
    const game = buildActiveGame();
    setFogEnabled(game, undefined, true);
    paintFog(game, undefined, GRIDLESS, { id: shapeId(1), op: "reveal", rect: { x: 5, y: 5, width: 50, height: 50 } });
    expect(projectPlayerCombat(game).fog).toEqual(game.combat.fog);
    expect(projectViewerEncounterScene(game).fog).toEqual(game.combat.fog);
  });
});
