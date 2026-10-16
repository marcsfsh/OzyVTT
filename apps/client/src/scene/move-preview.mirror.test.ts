import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState, type GmActor } from "@vtt/domain";
import { movementCost } from "../../../server/src/terrain";
import type { TokenMapGeometry } from "../../../server/src/token-placement";
import { moveLabel, previewMove } from "./movePreview";

// The drag preview and the server's charge must agree, so the preview runs the server's own scenarios.

const MAP = "20000000-0000-5000-8000-000000000001";
const HERO = "10000000-0000-4000-8000-000000000001";
const OGRE = "10000000-0000-4000-8000-000000000003";
const FRIEND = "10000000-0000-4000-8000-000000000002";

const CALIBRATION = { origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 };
const GRID: TokenMapGeometry = { width: 1000, height: 1000, calibration: { kind: "square", ...CALIBRATION } };
const cell = (column: number, row: number) => ({ x: 25 + 50 * column, y: 25 + 50 * row });
const cells = (c0: number, r0: number, c1: number, r1: number) => ({
  x: 50 * c0,
  y: 50 * r0,
  width: 50 * (c1 - c0 + 1),
  height: 50 * (r1 - r0 + 1)
});

function table(
  terrain: ReadonlyArray<ReturnType<typeof cells>>,
  positions: Readonly<Record<string, { x: number; y: number }>>
): GameState {
  const actors = [
    { id: HERO, name: "Borin", kind: "player-character", visibility: "public" },
    { id: FRIEND, name: "Mirena", kind: "player-character", visibility: "public" },
    { id: OGRE, name: "Ogre", kind: "monster", visibility: "public", size: "large" }
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
      terrain: { difficult: terrain }
    }
  });
}

const preview = (state: GameState, from: { x: number; y: number }, to: { x: number; y: number }) =>
  previewMove({
    calibration: CALIBRATION,
    size: { width: GRID.width, height: GRID.height },
    terrain: state.combat.terrain.difficult,
    tokens: state.combat.tokens,
    actorsById: new Map(state.actors.map((actor) => [actor.id, actor as GmActor])),
    moverId: HERO,
    from,
    to
  });

describe("the drag preview charges what the server charges", () => {
  const scenarios: ReadonlyArray<readonly [string, GameState, { x: number; y: number }, { x: number; y: number }]> = [
    ["open ground", table([], {}), cell(0, 0), cell(6, 3)],
    ["a band of rubble", table([cells(3, 0, 3, 19)], {}), cell(0, 5), cell(6, 5)],
    ["a patch to walk round", table([cells(3, 4, 3, 6)], {}), cell(0, 5), cell(6, 5)],
    ["an ogre at the map's edge", table([], { [OGRE]: { x: 150, y: 50 } }), cell(0, 0), cell(4, 0)],
    ["an ally in a corridor", table([cells(0, 1, 19, 19)], { [FRIEND]: cell(2, 0) }), cell(0, 0), cell(4, 0)]
  ];

  it.each(scenarios)("%s", (_label, state, from, to) => {
    const charged = movementCost(state, GRID, HERO, from, to);
    const previewed = preview(state, from, to);
    expect(previewed?.feet).toBe(charged?.feet);
    expect(previewed?.difficultFeet).toBe(charged?.difficultFeet);
    // The drawn path starts and ends on the two positions.
    expect(previewed?.path[0]).toEqual(from);
    expect(previewed?.path.at(-1)).toEqual(to);
  });

  it("says what the move leaves of the turn, and when it is too far", () => {
    const state = table([cells(3, 0, 3, 19)], {});
    const move = preview(state, cell(0, 5), cell(6, 5))!;
    expect(moveLabel(move, null).text).toBe("35 ft (5 ft difficult)");
    expect(moveLabel(move, { counted: true, speedFeet: 40, usedFeet: 0, enforcement: "strict" })).toEqual({
      text: "35 ft (5 ft difficult) · 5 ft left",
      over: false
    });
    expect(moveLabel(move, { counted: true, speedFeet: 30, usedFeet: 0, enforcement: "strict" })).toEqual({
      text: "35 ft (5 ft difficult) · 5 ft too far",
      over: true
    });
    // Off the mover's turn nothing is spent, so only the cost shows.
    expect(moveLabel(move, { counted: false, speedFeet: 30, usedFeet: 0, enforcement: "strict" }).text).toBe(
      "35 ft (5 ft difficult)"
    );
  });
});
