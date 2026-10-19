import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { nextInitiativeTurn } from "../src/encounter.js";
import { mapDistance } from "../src/movement-narration.js";
import { timeStopOutOfRange } from "../src/time-stop.js";
import type { TokenMapGeometry } from "../src/token-placement.js";
import { cell } from "./movement-fixtures.js";

// SRD 5.2.1 Time Stop: the caster takes 1d4 + 1 turns in a row; the spell ends if the caster affects another creature
// or moves more than 1,000 feet from where it cast it.

const WIZARD = "10000000-0000-4000-8000-0000000000e1";
const ORC = "10000000-0000-4000-8000-0000000000e2";

const GRID: TokenMapGeometry = {
  width: 100000,
  height: 1000,
  calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
};

const TIME_STOP = {
  id: "time-stop",
  name: "Time Stop",
  activation: "action" as const,
  description: "You briefly stop the flow of time for everyone but yourself.",
  spellId: "time-stop",
  uses: { limit: 1, per: "long-rest" as const },
  damage: []
};
const RAY = {
  id: "ray",
  name: "Ray of Frost",
  activation: "action" as const,
  description: "",
  attack: { bonus: 7, rangeFeet: 60 },
  damage: [{ formula: "1d8", type: "cold" }]
};

function game(): GameState {
  const actors = [
    { id: WIZARD, name: "Mirena", kind: "player-character" },
    { id: ORC, name: "Orc", kind: "monster" }
  ];
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: actors.map((actor) => ({ ...actor, visibility: "public", hp: { current: 30, maximum: 30 } })),
    combat: {
      active: true,
      round: 1,
      turnActorId: WIZARD,
      mapAssetId: "20000000-0000-5000-8000-000000000001",
      initiative: actors.map((actor, index) => ({ actorId: actor.id, score: 20 - index })),
      tokens: [
        { actorId: WIZARD, position: cell(0, 0), sizePx: 40, sizeCells: 1 },
        { actorId: ORC, position: cell(4, 0), sizePx: 40, sizeCells: 1 }
      ]
    }
  });
}
const deps = (faces: number[]): ResolveDependencies => ({
  random: (sides) => Math.min(sides, faces.shift() ?? 1),
  newRollId: () => "40000000-0000-4000-8000-000000000001",
  gmSessionId: "30000000-0000-4000-8000-00000000000a",
  now: () => "2026-07-17T00:00:00.000Z"
});
const turnDeps = { resolveDefinition: () => undefined, rollDie: () => 1 };

describe("Time Stop", () => {
  it("gives the caster 1d4 + 1 turns in a row, then the order moves on", () => {
    const state = game();
    const resolution = resolveDefinitionAction(
      state,
      TIME_STOP,
      { actorId: WIZARD, targetIds: [], commandId: "c1" },
      deps([2])
    );
    expect(resolution.tableNarration?.map((line) => line.text)).toContain(
      "Mirena stops time and takes 3 turns in a row (1d4 + 1: 2 + 1)."
    );
    const turns = [state.combat.turnActorId];
    for (let index = 0; index < 3; index++) {
      nextInitiativeTurn(state, [], turnDeps);
      turns.push(state.combat.turnActorId);
    }
    expect(turns).toEqual([WIZARD, WIZARD, WIZARD, ORC]);
    expect(state.combat.round).toBe(1);
    expect(state.combat.timeStop).toBeNull();
  });

  it("ends when the caster affects another creature", () => {
    const state = game();
    resolveDefinitionAction(state, TIME_STOP, { actorId: WIZARD, targetIds: [], commandId: "c1" }, deps([4]));
    nextInitiativeTurn(state, [], turnDeps);
    const ray = resolveDefinitionAction(
      state,
      RAY,
      { actorId: WIZARD, targetIds: [ORC], commandId: "c2" },
      deps([10, 4])
    );
    expect(ray.tableNarration?.map((line) => line.text)).toContain("Time Stop ends: Mirena affected another creature.");
    nextInitiativeTurn(state, [], turnDeps);
    expect(state.combat.turnActorId).toBe(ORC);
  });

  it("ends when the caster moves more than 1,000 feet from where it cast it", () => {
    const state = game();
    resolveDefinitionAction(state, TIME_STOP, { actorId: WIZARD, targetIds: [], commandId: "c1" }, deps([4]));
    const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      mapDistance(GRID, a, b)?.value ?? null;
    state.combat.tokens = state.combat.tokens.map((token) =>
      token.actorId === WIZARD ? { ...token, position: cell(150, 0) } : token
    );
    expect(timeStopOutOfRange(state, WIZARD, distance)).toEqual([]);
    state.combat.tokens = state.combat.tokens.map((token) =>
      token.actorId === WIZARD ? { ...token, position: cell(201, 0) } : token
    );
    expect(timeStopOutOfRange(state, WIZARD, distance).map((event) => event.text)).toEqual([
      "Time Stop ends: Mirena moved more than 1,000 feet away."
    ]);
    expect(state.combat.timeStop).toBeNull();
  });
});
