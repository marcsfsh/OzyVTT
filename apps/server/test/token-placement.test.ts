import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import { gridToImage } from "../src/grid-calibration.js";
import { createEncounterTokens, encounterTokenAppearance, ensureEncounterTokens, moveEncounterToken } from "../src/token-placement.js";

const ACTOR = "60000000-0000-4000-8000-000000000001";
const SECOND = "60000000-0000-4000-8000-000000000002";
const MAP = "70000000-0000-5000-8000-000000000001";
const calibration = { kind: "square" as const, origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 };
const geometry = { width: 500, height: 400, calibration };

function activeState() {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      { id: ACTOR, name: "Hero", kind: "player-character", hp: { current: 10, maximum: 10 } },
      { id: SECOND, name: "Monster", kind: "monster", hp: { current: 10, maximum: 10 } }
    ],
    combat: {
      active: true, round: 1, turnActorId: ACTOR, mapAssetId: MAP,
      initiative: [{ actorId: ACTOR, score: 20 }, { actorId: SECOND, score: 10 }],
      tokens: createEncounterTokens([ACTOR, SECOND], geometry)
    }
  });
}

describe("authoritative encounter token placement", () => {
  it("creates an unplaced tray token sized from the calibrated grid", () => {
    expect(encounterTokenAppearance(geometry)).toEqual({ sizePx: 41, gridSizePx: 50, gridRotationRadians: 0 });
    expect(createEncounterTokens([ACTOR], geometry)).toEqual([{ actorId: ACTOR, position: null, sizePx: 41, gridSizePx: 50, gridRotationRadians: 0 }]);
    expect(encounterTokenAppearance({ width: 900, height: 600, calibration: null })).toEqual({ sizePx: 33.333, gridSizePx: null, gridRotationRadians: null });
  });

  it("snaps drops to cell centers, keeps tokens on-map, and returns them to the tray", () => {
    const state = activeState();
    moveEncounterToken(state, ACTOR, { x: 76, y: 74 }, geometry);
    expect(state.combat.tokens[0].position).toEqual({ x: 75, y: 75 });
    moveEncounterToken(state, ACTOR, { x: 0, y: 0 }, geometry);
    expect(state.combat.tokens[0].position).toEqual({ x: 25, y: 25 });
    moveEncounterToken(state, ACTOR, null, geometry);
    expect(state.combat.tokens[0].position).toBeNull();
  });

  it("snaps correctly on a rotated grid and clamps gridless drops", () => {
    const state = activeState();
    const rotated = { ...calibration, origin: { x: 250, y: 100 }, rotationRadians: Math.PI / 6 };
    const expected = gridToImage(rotated, { column: 2.5, row: 1.5 });
    moveEncounterToken(state, ACTOR, { x: expected.x + 3, y: expected.y - 2 }, { width: 600, height: 500, calibration: rotated });
    expect(state.combat.tokens[0].position?.x).toBeCloseTo(expected.x, 3);
    expect(state.combat.tokens[0].position?.y).toBeCloseTo(expected.y, 3);

    moveEncounterToken(state, ACTOR, { x: 10_000, y: -10 }, { width: 600, height: 500, calibration: null });
    expect(state.combat.tokens[0].position).toEqual({ x: 579.5, y: 20.5 });
  });

  it("upgrades old active encounters with missing tokens and rejects invalid sequences", () => {
    const state = activeState(); state.combat = { ...state.combat, tokens: state.combat.tokens.slice(0, 1) };
    expect(ensureEncounterTokens(state, geometry)).toBe(true);
    expect(state.combat.tokens.map((token) => token.actorId)).toEqual([ACTOR, SECOND]);
    expect(ensureEncounterTokens(state, geometry)).toBe(false);
    state.combat = { ...state.combat, active: false, turnActorId: null };
    expect(() => moveEncounterToken(state, ACTOR, { x: 50, y: 50 }, geometry)).toThrow("Start an encounter");
  });
});
