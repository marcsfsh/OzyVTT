import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { makeEffect } from "../src/effects.js";
import { RulesBlockedError } from "../src/game-store.js";
import { activeMoveGrant } from "../src/granted-moves.js";
import { landJump } from "../src/jumping.js";
import { applyMovementRules } from "../src/movement-rules.js";
import { mapDistance } from "../src/movement-narration.js";
import { movementCost } from "../src/terrain.js";
import type { TokenMapGeometry } from "../src/token-placement.js";
import { cell } from "./movement-fixtures.js";

// SRD 5.2.1 Long Jump and High Jump: up to the Strength score across and 3 + the Strength modifier up with a 10-foot
// run-up, half from a standing start, a foot of movement for each foot jumped; a landing in Difficult Terrain takes a
// DC 10 Dexterity (Acrobatics) check or leaves the jumper Prone. Riders change the numbers.

const HERO = "10000000-0000-4000-8000-0000000000c1";
const BULETTE = "10000000-0000-4000-8000-0000000000c2";

const GRID: TokenMapGeometry = {
  width: 2000,
  height: 2000,
  calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
};

const LEAP = {
  id: "leap",
  name: "Leap",
  activation: "bonus-action" as const,
  description: "The bulette jumps up to 30 feet by spending 10 feet of movement.",
  damage: [],
  leap: { feet: 30, costFeet: 10 }
};
const DEFINITIONS: Record<string, ActorDefinition> = {
  hero: {
    actions: [],
    abilityScores: { str: 16, dex: 18, con: 12, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    extensions: {}
  } as unknown as ActorDefinition,
  bulette: {
    actions: [LEAP],
    abilityScores: { str: 19, dex: 11, con: 21, int: 2, wis: 10, cha: 5 },
    proficiencyBonus: 3,
    token: { disposition: "hostile" },
    extensions: { "open5e.srd-2024": { speeds: { walk: 40, burrow: 40 } } }
  } as unknown as ActorDefinition
};
const resolveDefinition = (id: string) => DEFINITIONS[id];

function game(turn = HERO): GameState {
  const actors = [
    { id: HERO, name: "Borin", kind: "player-character", speedFeet: 40, definitionId: "hero" },
    { id: BULETTE, name: "Bulette", kind: "monster", speedFeet: 40, definitionId: "bulette" }
  ];
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: actors.map((actor) => ({ ...actor, visibility: "public", hp: { current: 50, maximum: 50 } })),
    combat: {
      active: true,
      round: 1,
      turnActorId: turn,
      mapAssetId: "20000000-0000-5000-8000-000000000001",
      initiative: actors.map((actor, index) => ({ actorId: actor.id, score: 20 - index })),
      tokens: [
        { actorId: HERO, position: cell(0, 0), sizePx: 40, sizeCells: 1 },
        { actorId: BULETTE, position: cell(0, 9), sizePx: 40, sizeCells: 1 }
      ]
    }
  });
}
const actor = (state: GameState, id: string) => state.actors.find((candidate) => candidate.id === id)!;
const ranUp = (state: GameState, feet = 10) =>
  (state.combat = { ...state.combat, turn: { ...state.combat.turn, movementUsedFeet: feet } });

function jump(
  state: GameState,
  actorId: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  toAltitudeFeet = 0,
  difficult = false
) {
  return applyMovementRules(state, {
    actorId,
    from,
    to,
    mode: "jump",
    fromAltitudeFeet: 0,
    toAltitudeFeet,
    distance: (a, b) => mapDistance(GRID, a, b)?.value ?? null,
    cost: (a, b, options) => movementCost(state, GRID, actorId, a, b, options),
    calibration: GRID.calibration,
    override: null,
    resolveDefinition,
    difficultAt: () => difficult,
    newPromptId: () => "70000000-0000-4000-8000-000000000001",
    now: () => 0,
    commandId: "50000000-0000-4000-8000-000000000001"
  });
}
const blockedBy = (call: () => unknown): string => {
  try {
    call();
  } catch (error) {
    if (error instanceof RulesBlockedError) return error.rule;
    throw error;
  }
  return "nothing";
};

describe("a jump", () => {
  it("covers the Strength score across after a run-up, a foot of movement for each foot", () => {
    const state = game();
    ranUp(state);
    expect(blockedBy(() => jump(state, HERO, cell(0, 0), cell(3, 0)))).toBe("nothing");
    expect(state.combat.turn.movementUsedFeet).toBe(25);
    ranUp(state);
    expect(blockedBy(() => jump(state, HERO, cell(0, 0), cell(4, 0)))).toBe("movement.jump");
  });

  it("goes half as far from a standing start", () => {
    const state = game();
    expect(blockedBy(() => jump(state, HERO, cell(0, 0), cell(1, 0)))).toBe("nothing");
    expect(blockedBy(() => jump(game(), HERO, cell(0, 0), cell(2, 0)))).toBe("movement.jump");
  });

  it("rises up to 3 plus the Strength modifier, half from a standing start", () => {
    const state = game();
    ranUp(state);
    expect(blockedBy(() => jump(state, HERO, cell(0, 0), cell(1, 0), 5))).toBe("nothing");
    expect(blockedBy(() => jump(game(), HERO, cell(0, 0), cell(1, 0), 5))).toBe("movement.jump");
  });

  it("goes by Dexterity with Second-Story Work, and twice as far with Step of the Wind", () => {
    const state = game();
    ranUp(state);
    const hero = actor(state, HERO);
    hero.effects = [
      makeEffect({
        id: "thief",
        name: "Second-Story Work",
        duration: { type: "encounter" },
        modifiers: [{ type: "movement", rule: "jump-by-dexterity" }]
      })
    ];
    // Dexterity 18: 18 feet across.
    expect(blockedBy(() => jump(state, HERO, cell(0, 0), cell(3, 0)))).toBe("nothing");
    ranUp(state);
    hero.effects = [
      makeEffect({
        id: "wind",
        name: "Step of the Wind",
        duration: { type: "encounter" },
        modifiers: [{ type: "movement", rule: "jump-multiplier", times: 2 }]
      })
    ];
    // Strength 16, doubled: 32 feet.
    expect(blockedBy(() => jump(state, HERO, cell(0, 0), cell(6, 0)))).toBe("nothing");
  });

  it("leaps 30 feet for 10 feet of movement once a turn with the Jump spell", () => {
    const state = game();
    actor(state, HERO).effects = [
      makeEffect({
        id: "jump",
        name: "Jump",
        duration: { type: "rounds", remaining: 10 },
        modifiers: [{ type: "movement", rule: "leap", feet: 30, costFeet: 10 }]
      })
    ];
    expect(blockedBy(() => jump(state, HERO, cell(0, 0), cell(6, 0)))).toBe("nothing");
    expect(state.combat.turn.movementUsedFeet).toBe(10);
    // The second jump this turn is an ordinary one, from a running start.
    expect(blockedBy(() => jump(state, HERO, cell(6, 0), cell(12, 0)))).toBe("movement.jump");
  });

  it("owes a landing check in Difficult Terrain, and falls Prone on a failure", () => {
    const state = game();
    ranUp(state);
    expect(jump(state, HERO, cell(0, 0), cell(2, 0), 0, true).landsOnDifficult).toBe(true);
    const events: Parameters<typeof landJump>[3] = [];
    let id = 0;
    landJump(
      state,
      actor(state, HERO),
      {
        resolveDefinition,
        random: () => 2,
        newId: () => `40000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
        now: () => "2026-07-17T00:00:00.000Z"
      },
      events
    );
    expect(actor(state, HERO).conditions.map((condition) => condition.id)).toEqual(["prone"]);
    expect(events[0]?.text).toBe("Borin lands in difficult terrain: 6 against DC 10, and falls Prone.");
  });
});

describe("a monster's Leap", () => {
  it("grants a 30-foot jump that spends 10 feet of the turn's movement", () => {
    const state = game(BULETTE);
    resolveDefinitionAction(
      state,
      LEAP,
      { actorId: BULETTE, targetIds: [], commandId: "c1" },
      {
        random: () => 10,
        newRollId: () => "40000000-0000-4000-8000-000000000099",
        gmSessionId: "30000000-0000-4000-8000-00000000000a",
        now: () => "2026-07-17T00:00:00.000Z",
        definition: DEFINITIONS.bulette,
        resolveDefinition
      }
    );
    expect(activeMoveGrant(state, actor(state, BULETTE))).toMatchObject({ feet: 30, jump: true, costFeet: 10 });
    const outcome = jump(state, BULETTE, cell(0, 9), cell(6, 9));
    expect(outcome.granted).toBe("Leap");
    expect(state.combat.turn.movementUsedFeet).toBe(10);
  });
});
