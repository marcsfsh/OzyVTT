import { describe, expect, it } from "vitest";
import { GameStateSchema, PendingSaveSchema, type GameState } from "@vtt/domain";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { addEffect, endEffect, makeEffect } from "../src/effects.js";
import { nextInitiativeTurn } from "../src/encounter.js";
import { blinkAway, needsPlaneSettling, settlePlanes } from "../src/off-plane.js";
import { applyFailureEffect } from "../src/saving-throws.js";
import type { TokenMapGeometry } from "../src/token-placement.js";
import { cell } from "./movement-fixtures.js";

// SRD 5.2.1 leaving the plane (Banishment, Maze, Hurl Through Hell, and Blink's Border Ethereal): the creature leaves the map, keeps its place in
// the initiative, can't be targeted from the plane nor target anyone on it, and returns to the space it left or the
// nearest unoccupied one.

const MAGE = "10000000-0000-4000-8000-0000000000d1";
const OGRE = "10000000-0000-4000-8000-0000000000d2";
const ORC = "10000000-0000-4000-8000-0000000000d3";

const GRID: TokenMapGeometry = {
  width: 1000,
  height: 1000,
  calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
};

function game(): GameState {
  const actors = [
    { id: MAGE, name: "Mirena", kind: "player-character" },
    { id: OGRE, name: "Ogre", kind: "monster" },
    { id: ORC, name: "Orc", kind: "monster" }
  ];
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: actors.map((actor) => ({ ...actor, visibility: "public", hp: { current: 30, maximum: 30 } })),
    combat: {
      active: true,
      round: 1,
      turnActorId: MAGE,
      mapAssetId: "20000000-0000-5000-8000-000000000001",
      initiative: actors.map((actor, index) => ({ actorId: actor.id, score: 20 - index })),
      tokens: [
        { actorId: MAGE, position: cell(0, 0), sizePx: 40, sizeCells: 1 },
        { actorId: OGRE, position: cell(3, 0), sizePx: 40, sizeCells: 1, altitudeFeet: 10, airborne: "fly" },
        { actorId: ORC, position: cell(6, 0), sizePx: 40, sizeCells: 1 }
      ]
    }
  });
}
const token = (state: GameState, id: string) => state.combat.tokens.find((candidate) => candidate.actorId === id)!;
const banish = (state: GameState) =>
  addEffect(
    state,
    OGRE,
    makeEffect({ id: "banished", name: "Banished", tags: ["off-plane"], duration: { type: "manual" } })
  );

describe("a creature off the plane", () => {
  it("leaves the map keeping its place in the initiative, and returns to the space it left", () => {
    const state = game();
    banish(state);
    expect(needsPlaneSettling(state)).toBe(true);
    expect(settlePlanes(state, GRID).map((event) => event.text)).toEqual(["Ogre vanishes from this plane."]);
    expect(token(state, OGRE).position).toBeNull();
    expect(state.combat.initiative.map((entry) => entry.actorId)).toContain(OGRE);
    expect(needsPlaneSettling(state)).toBe(false);
    endEffect(state, OGRE, "banished");
    expect(settlePlanes(state, GRID).map((event) => event.text)).toEqual(["Ogre returns to the space it left."]);
    expect(token(state, OGRE).position).toEqual(cell(3, 0));
    expect(token(state, OGRE).altitudeFeet).toBe(10);
    expect(state.combat.offPlane).toEqual([]);
  });

  it("returns to the nearest unoccupied space when another creature stands in the one it left", () => {
    const state = game();
    banish(state);
    settlePlanes(state, GRID);
    state.combat.tokens = state.combat.tokens.map((candidate) =>
      candidate.actorId === ORC ? { ...candidate, position: cell(3, 0) } : candidate
    );
    endEffect(state, OGRE, "banished");
    expect(settlePlanes(state, GRID).map((event) => event.text)).toEqual([
      "Ogre returns to the nearest unoccupied space."
    ]);
    const back = token(state, OGRE).position!;
    expect(back).not.toEqual(cell(3, 0));
    expect(Math.max(Math.abs(back.x - cell(3, 0).x), Math.abs(back.y - cell(3, 0).y))).toBe(50);
  });

  it("can't be targeted from the plane, nor target anyone on it", () => {
    const state = game();
    banish(state);
    settlePlanes(state, GRID);
    const bolt = {
      id: "bolt",
      name: "Fire Bolt",
      activation: "action" as const,
      description: "",
      attack: { bonus: 5, rangeFeet: 120 },
      damage: [{ formula: "1d10", type: "fire" }]
    };
    const deps = {
      random: () => 10,
      newRollId: () => "40000000-0000-4000-8000-000000000001",
      gmSessionId: "30000000-0000-4000-8000-00000000000a",
      now: () => "2026-07-17T00:00:00.000Z"
    };
    expect(() =>
      resolveDefinitionAction(state, bolt, { actorId: MAGE, targetIds: [OGRE], commandId: "c1" }, deps)
    ).toThrow("Ogre is gone from this plane for now and can't be targeted.");
    expect(() =>
      resolveDefinitionAction(state, bolt, { actorId: OGRE, targetIds: [MAGE], commandId: "c2" }, deps)
    ).toThrow("Ogre is off this plane and can't reach Mirena.");
  });

  it("hurls a creature through the Lower Planes until the end of the Warlock's next turn, then returns it", () => {
    const state = game();
    const turn = () =>
      nextInitiativeTurn(state, [], { resolveDefinition: () => undefined, rollDie: () => 1, newId: () => "e" });
    // Hurl Through Hell's failed save, applied on the Warlock's own turn.
    applyFailureEffect(
      state,
      OGRE,
      PendingSaveSchema.shape.onFailEffect.unwrap().parse({
        name: "Hurled Through Hell",
        tags: ["off-plane"],
        linkedConditionIds: ["incapacitated"],
        sourceActorId: MAGE,
        sourceName: "Mirena",
        duration: { type: "until-source-turn-end" }
      }),
      "hurled"
    );
    settlePlanes(state, GRID);
    expect(token(state, OGRE).position).toBeNull();
    // The end of the turn it was hurled on doesn't count, nor do the turns after it, up to the Warlock's next.
    turn();
    turn();
    turn();
    expect(state.combat.turnActorId).toBe(MAGE);
    expect(needsPlaneSettling(state)).toBe(false);
    turn();
    expect(settlePlanes(state, GRID).map((event) => event.text)).toEqual(["Ogre returns to the space it left."]);
    expect(token(state, OGRE).position).toEqual(cell(3, 0));
  });

  it("blinks onto the Ethereal Plane on a 4 or more at the end of its turn, and back at the start of its next", () => {
    const state = game();
    addEffect(
      state,
      MAGE,
      makeEffect({ id: "blink", name: "Blink", tags: ["blink"], duration: { type: "rounds", remaining: 10 } })
    );
    const events: Parameters<typeof blinkAway>[4] = [];
    blinkAway(
      state,
      MAGE,
      () => 3,
      () => "e1",
      events
    );
    expect(events.map((event) => event.text)).toEqual(["Mirena rolls 3 for Blink."]);
    nextInitiativeTurn(state, [], { resolveDefinition: () => undefined, rollDie: () => 5, newId: () => "e2" });
    expect(state.actors.find((actor) => actor.id === MAGE)!.effects.map((effect) => effect.name)).toContain(
      "Ethereal (Blink)"
    );
    settlePlanes(state, GRID);
    expect(state.combat.offPlane).toEqual([{ actorId: MAGE, position: cell(0, 0), ethereal: true, returnFeet: 10 }]);
    nextInitiativeTurn(state, [], { resolveDefinition: () => undefined, rollDie: () => 5, newId: () => "e3" });
    nextInitiativeTurn(state, [], { resolveDefinition: () => undefined, rollDie: () => 5, newId: () => "e4" });
    expect(state.combat.turnActorId).toBe(MAGE);
    settlePlanes(state, GRID);
    expect(token(state, MAGE).position).toEqual(cell(0, 0));
    expect(state.combat.offPlane).toEqual([]);
  });
});
