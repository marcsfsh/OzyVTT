import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { nextInitiativeTurn } from "../src/encounter.js";
import { RulesBlockedError } from "../src/game-store.js";
import { makeEffect } from "../src/effects.js";
import {
  activeMoveGrant,
  activeTeleportGrant,
  compelledMoves,
  dropStaleGrants,
  grantMove,
  grantTeleport
} from "../src/granted-moves.js";
import { proneInSharedSpace } from "../src/occupied-space.js";
import { projectPlayerView } from "../src/projections.js";
import { applyMovementRules, movementStatus } from "../src/movement-rules.js";
import { creatureDistance, footprintOf, mapDistance } from "../src/movement-narration.js";
import { evaluateActionEconomy } from "../src/resolution/economy.js";
import { movementCost } from "../src/terrain.js";
import type { TokenMapGeometry } from "../src/token-placement.js";
import { cell } from "./movement-fixtures.js";

// SRD 5.2.1 moves an action or feature grants beside the turn's own ("The dragon moves up to half its Speed, and it
// makes one Rend attack", Tactical Shift, Misty Step): charged to their own allowance on the creature's turn or off it,
// provoking unless the text says otherwise, and lapsing with the turn they belong to. Legendary actions come right
// after another creature's turn.

const DRAGON = "10000000-0000-4000-8000-0000000000b1";
const HERO = "10000000-0000-4000-8000-0000000000b2";
const ORC = "10000000-0000-4000-8000-0000000000b3";

const GRID: TokenMapGeometry = {
  width: 2000,
  height: 2000,
  calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
};

const POUNCE = {
  id: "pounce",
  name: "Pounce",
  activation: "other" as const,
  description: "Legendary Action. The dragon moves up to half its Speed, and it makes one Rend attack.",
  attack: { bonus: 14, reachFeet: 10 },
  damage: [{ formula: "1d10 + 8", type: "slashing" }],
  legendary: { cost: 1 },
  move: { speed: "half" as const, provokes: true, first: true as const }
};
const DRAGON_DEFINITION = {
  actions: [POUNCE],
  legendary: { actionsPerRound: 3 },
  abilityScores: { str: 27, dex: 10, con: 25, int: 16, wis: 13, cha: 21 },
  proficiencyBonus: 6,
  token: { disposition: "hostile" },
  extensions: { "open5e.srd-2024": { speeds: { walk: 40, fly: 80 } } }
} as unknown as ActorDefinition;
const resolveDefinition = (id: string) => (id === "dragon" ? DRAGON_DEFINITION : undefined);

function game(turn: string, positions: Readonly<Record<string, { x: number; y: number }>>): GameState {
  const actors = [
    { id: DRAGON, name: "Dragon", kind: "monster", speedFeet: 40, definitionId: "dragon" },
    { id: HERO, name: "Borin", kind: "player-character", speedFeet: 30 },
    { id: ORC, name: "Orc", kind: "monster", speedFeet: 30 }
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
      tokens: actors
        .filter((actor) => positions[actor.id] !== undefined)
        .map((actor) => ({ actorId: actor.id, position: positions[actor.id], sizePx: 40, sizeCells: 1 }))
    }
  });
}

const actor = (state: GameState, id: string) => state.actors.find((candidate) => candidate.id === id)!;

let prompts = 0;
function move(
  state: GameState,
  actorId: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: {
    mode?: "walk" | "fly" | "teleport" | "jump";
    byPlayer?: boolean;
    seesPoint?: (point: { x: number; y: number }) => boolean;
    perceives?: (id: string) => boolean;
  } = {}
) {
  return applyMovementRules(state, {
    actorId,
    from,
    to,
    ...(options.mode ? { mode: options.mode } : {}),
    byPlayer: options.byPlayer ?? false,
    distance: (a, b) => mapDistance(GRID, a, b)?.value ?? null,
    cost: (a, b, costOptions) => movementCost(state, GRID, actorId, a, b, costOptions),
    creatureDistance: (enemy, point, altitudeFeet) => {
      const enemyToken = state.combat.tokens.find((token) => token.actorId === enemy.actorId)!;
      const moverToken = state.combat.tokens.find((token) => token.actorId === actorId)!;
      return (
        creatureDistance(GRID, footprintOf(enemyToken, enemy.position), footprintOf(moverToken, point, altitudeFeet))
          ?.value ?? null
      );
    },
    calibration: GRID.calibration,
    override: null,
    resolveDefinition,
    ...(options.seesPoint ? { seesPoint: options.seesPoint } : {}),
    ...(options.perceives ? { perceives: options.perceives } : {}),
    newPromptId: () => `70000000-0000-4000-8000-${String(++prompts).padStart(12, "0")}`,
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
const pounceGrant = (state: GameState, provokes = true, feet = 20) =>
  grantMove(state, actor(state, DRAGON), { id: "pounce-move", name: "Pounce", feet, provokes });

describe("a granted move", () => {
  it("is charged to its grant off the creature's turn and provokes as it leaves reach", () => {
    const state = game(HERO, { [DRAGON]: cell(1, 0), [HERO]: cell(0, 0) });
    pounceGrant(state);
    const outcome = move(state, DRAGON, cell(1, 0), cell(4, 0));
    expect(outcome.granted).toBe("Pounce");
    expect(outcome.prompts.map((prompt) => prompt.actorId)).toEqual([HERO]);
    expect(activeMoveGrant(state, actor(state, DRAGON))?.feet).toBe(5);
    // The hero's own turn is untouched.
    expect(state.combat.turn.movementUsedFeet).toBe(0);
  });

  it("leaves reach freely when the grant says it provokes no Opportunity Attacks", () => {
    const state = game(HERO, { [DRAGON]: cell(1, 0), [HERO]: cell(0, 0) });
    pounceGrant(state, false);
    expect(move(state, DRAGON, cell(1, 0), cell(4, 0)).prompts).toEqual([]);
  });

  it("is spent before the creature's own movement on its turn, and a longer move uses its own instead", () => {
    const state = game(DRAGON, { [DRAGON]: cell(1, 0), [HERO]: cell(9, 9) });
    pounceGrant(state, true, 10);
    move(state, DRAGON, cell(1, 0), cell(3, 0));
    expect(state.combat.turn.movementUsedFeet).toBe(0);
    expect(activeMoveGrant(state, actor(state, DRAGON))).toBeNull();
    pounceGrant(state, true, 10);
    move(state, DRAGON, cell(3, 0), cell(6, 0));
    expect(state.combat.turn.movementUsedFeet).toBe(15);
    expect(activeMoveGrant(state, actor(state, DRAGON))?.feet).toBe(10);
  });

  it("lets a player take it off the creature's turn with no GM go-ahead", () => {
    const state = game(DRAGON, { [HERO]: cell(0, 0), [DRAGON]: cell(9, 9) });
    expect(blockedBy(() => move(state, HERO, cell(0, 0), cell(2, 0), { byPlayer: true }))).toBe("movement.off-turn");
    grantMove(state, actor(state, HERO), { id: "shift", name: "Tactical Shift", feet: 15, provokes: false });
    expect(blockedBy(() => move(state, HERO, cell(0, 0), cell(2, 0), { byPlayer: true }))).toBe("nothing");
  });

  it("lapses when the turn it belongs to ends", () => {
    const state = game(HERO, { [DRAGON]: cell(1, 0), [HERO]: cell(0, 0) });
    pounceGrant(state);
    expect(activeMoveGrant(state, actor(state, DRAGON))).not.toBeNull();
    state.combat = { ...state.combat, turnActorId: ORC };
    expect(activeMoveGrant(state, actor(state, DRAGON))).toBeNull();
    dropStaleGrants(state);
    expect(actor(state, DRAGON).effects).toEqual([]);
  });

  it("stays off the effects players are sent, which would name the turn it belongs to", () => {
    const state = game(DRAGON, { [DRAGON]: cell(1, 0), [HERO]: cell(0, 0) });
    grantMove(state, actor(state, HERO), {
      id: "flee",
      name: "Dissonant Whispers",
      feet: 30,
      provokes: true,
      awayFromActorId: DRAGON
    });
    const seen = projectPlayerView(state, undefined, () => null).actors.find((candidate) => candidate.id === HERO)!;
    expect(seen.effects.map((effect) => effect.name)).toEqual(["Dissonant Whispers"]);
    expect(JSON.stringify(seen.effects)).not.toContain("grantedMove");
  });

  it("is reported with the creature's movement", () => {
    const state = game(HERO, { [DRAGON]: cell(1, 0), [HERO]: cell(0, 0) });
    pounceGrant(state, false);
    expect(movementStatus(state, DRAGON, { resolveDefinition }).granted).toEqual({
      name: "Pounce",
      feet: 20,
      provokes: false
    });
  });
});

describe("a granted teleport", () => {
  const teleport = (state: GameState, feet: number, extra: { unseen?: true; failDamage?: string } = {}) =>
    grantTeleport(state, actor(state, HERO), { id: "misty", name: "Misty Step", teleport: { feet, ...extra } });

  it("goes at once up to its range, to an unoccupied space the creature can see", () => {
    const state = game(HERO, { [HERO]: cell(0, 0), [ORC]: cell(3, 0) });
    expect(blockedBy(() => move(state, HERO, cell(0, 0), cell(5, 0), { mode: "teleport", byPlayer: true }))).toBe(
      "movement.teleport"
    );
    teleport(state, 30);
    const outcome = move(state, HERO, cell(0, 0), cell(5, 0), { mode: "teleport", byPlayer: true });
    expect(outcome.granted).toBe("Misty Step");
    expect(activeTeleportGrant(state, actor(state, HERO))).toBeNull();
  });

  it("refuses a space beyond its range, a filled one, or one the creature can't see", () => {
    const state = game(HERO, { [HERO]: cell(0, 0), [ORC]: cell(3, 0) });
    teleport(state, 30);
    const player = { mode: "teleport" as const, byPlayer: true };
    expect(blockedBy(() => move(state, HERO, cell(0, 0), cell(7, 0), player))).toBe("movement.teleport");
    expect(blockedBy(() => move(state, HERO, cell(0, 0), cell(3, 0), player))).toBe("movement.teleport");
    expect(blockedBy(() => move(state, HERO, cell(0, 0), cell(5, 0), { ...player, seesPoint: () => false }))).toBe(
      "movement.teleport"
    );
  });

  it("goes to a space it can't see when the spell allows, and fails with damage into a filled one", () => {
    const state = game(HERO, { [HERO]: cell(0, 0), [ORC]: cell(3, 0) });
    teleport(state, 500, { unseen: true, failDamage: "4d6" });
    const unseen = { mode: "teleport" as const, byPlayer: true, seesPoint: () => false };
    expect(move(state, HERO, cell(0, 0), cell(20, 0), unseen).teleportFails).toBeUndefined();
    teleport(state, 500, { unseen: true, failDamage: "4d6" });
    // The orc is hidden from the hero, so the space looked empty.
    const outcome = move(state, HERO, cell(0, 0), cell(3, 0), { ...unseen, perceives: (id) => id !== ORC });
    expect(outcome.teleportFails).toBe("4d6");
  });
});

function resolveDeps(): ResolveDependencies {
  let id = 0;
  return {
    random: (sides) => Math.min(sides, 15),
    newRollId: () => `40000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    gmSessionId: "30000000-0000-4000-8000-00000000000a",
    now: () => "2026-07-17T00:00:00.000Z",
    definition: DRAGON_DEFINITION,
    resolveDefinition
  };
}

describe("an action taken move first", () => {
  it("spends the action, grants its move owing the rest, and the rest costs nothing more", () => {
    const state = game(HERO, { [DRAGON]: cell(6, 0), [HERO]: cell(0, 0) });
    nextInitiativeTurn(state);
    expect(state.combat.turnActorId).toBe(ORC);
    resolveDefinitionAction(
      state,
      POUNCE,
      { actorId: DRAGON, targetIds: [], commandId: "c1", moveFirst: true },
      resolveDeps()
    );
    expect(state.combat.legendaryUsed[DRAGON]).toBe(1);
    const grant = activeMoveGrant(state, actor(state, DRAGON))!;
    expect(grant).toMatchObject({ feet: 20, provokes: true, owedActionId: "pounce" });
    move(state, DRAGON, cell(6, 0), cell(2, 0));
    resolveDefinitionAction(
      state,
      POUNCE,
      { actorId: DRAGON, targetIds: [HERO], commandId: "c2", owedPaid: true },
      resolveDeps()
    );
    expect(state.combat.legendaryUsed[DRAGON]).toBe(1);
    expect(activeMoveGrant(state, actor(state, DRAGON))).toBeNull();
  });
});

describe("the legendary action window", () => {
  const violations = (state: GameState) =>
    evaluateActionEconomy(state, actor(state, DRAGON), POUNCE, [HERO], DRAGON_DEFINITION).violations.map(
      (violation) => violation.rule
    );

  it("opens right after another creature's turn and closes once the next creature acts", () => {
    const state = game(HERO, { [DRAGON]: cell(1, 0), [HERO]: cell(0, 0) });
    nextInitiativeTurn(state);
    expect(violations(state)).toEqual([]);
    state.combat = { ...state.combat, turn: { ...state.combat.turn, movementUsedFeet: 5 } };
    expect(violations(state)).toEqual(["legendary.after-a-turn"]);
  });

  it("takes one legendary action a window, and none after the creature's own turn", () => {
    const state = game(DRAGON, { [DRAGON]: cell(1, 0), [HERO]: cell(0, 0) });
    // Right after the dragon's own turn: not another creature's.
    nextInitiativeTurn(state);
    expect(violations(state)).toEqual(["legendary.after-a-turn"]);
    nextInitiativeTurn(state);
    expect(violations(state)).toEqual([]);
    resolveDefinitionAction(state, POUNCE, { actorId: DRAGON, targetIds: [HERO], commandId: "c3" }, resolveDeps());
    expect(violations(state)).toEqual(["legendary.after-a-turn"]);
  });
});

describe("a creature made to move", () => {
  it("flees with its Reaction from Dissonant Whispers, a move of its Speed that must end farther away", () => {
    const state = game(DRAGON, { [DRAGON]: cell(1, 0), [HERO]: cell(0, 0) });
    const hero = actor(state, HERO);
    hero.effects = [
      makeEffect({
        id: "whispers",
        name: "Dissonant Whispers",
        tags: ["flees-with-reaction"],
        duration: { type: "rounds", remaining: 1 },
        sourceActorId: DRAGON,
        sourceName: "Dragon"
      })
    ];
    const events = compelledMoves(state, { resolveDefinition, newId: () => "60000000-0000-4000-8000-000000000001" });
    expect(events.map((event) => event.text)).toEqual([
      "Borin uses its Reaction to flee: it may move 30 ft away from Dragon."
    ]);
    expect(state.combat.reactionsUsed).toContain(HERO);
    expect(activeMoveGrant(state, hero)).toMatchObject({ feet: 30, provokes: true, awayFromActorId: DRAGON });
    // Toward the dragon is no flight, so the grant doesn't take it and a player's move off its turn needs the GM.
    expect(blockedBy(() => move(state, HERO, cell(0, 0), cell(0, 1), { byPlayer: true }))).toBe("movement.off-turn");
    const outcome = move(state, HERO, cell(0, 0), cell(0, 5), { byPlayer: true });
    expect(outcome.granted).toBe("Dissonant Whispers");
    expect(outcome.prompts.map((prompt) => prompt.actorId)).toEqual([DRAGON]);
  });

  it("stays put when its Reaction is spent", () => {
    const state = game(DRAGON, { [DRAGON]: cell(1, 0), [HERO]: cell(0, 0) });
    state.combat = { ...state.combat, reactionsUsed: [HERO] };
    actor(state, HERO).effects = [
      makeEffect({
        id: "whispers",
        name: "Dissonant Whispers",
        tags: ["flees-with-reaction"],
        duration: { type: "rounds", remaining: 1 },
        sourceActorId: DRAGON,
        sourceName: "Dragon"
      })
    ];
    expect(compelledMoves(state, { resolveDefinition, newId: () => "x" })).toEqual([]);
    expect(actor(state, HERO).effects).toEqual([]);
  });

  it("can't willingly move closer to what frightens it", () => {
    const state = game(HERO, { [DRAGON]: cell(6, 0), [HERO]: cell(0, 0) });
    const hero = actor(state, HERO);
    hero.conditions = [{ id: "frightened" }];
    hero.effects = [
      makeEffect({
        id: "fear",
        name: "Frightful Presence",
        duration: { type: "rounds", remaining: 10 },
        sourceActorId: DRAGON,
        sourceName: "Dragon",
        linkedConditionIds: ["frightened"]
      })
    ];
    expect(blockedBy(() => move(state, HERO, cell(0, 0), cell(3, 0)))).toBe("movement.frightened");
    expect(blockedBy(() => move(state, HERO, cell(0, 0), cell(0, 3)))).toBe("nothing");
  });
});

describe("ending a turn in another creature's space", () => {
  const sized = (state: GameState, id: string, size: "tiny" | "medium" | "large") => (actor(state, id).size = size);

  it("leaves the creature Prone unless it is Tiny or larger than the other", () => {
    const state = game(HERO, { [DRAGON]: cell(0, 0), [HERO]: cell(0, 0) });
    const events: Parameters<typeof proneInSharedSpace>[4] = [];
    proneInSharedSpace(state, HERO, GRID.calibration!, resolveDefinition, events);
    expect(actor(state, HERO).conditions.map((condition) => condition.id)).toEqual(["prone"]);
    expect(events[0]?.text).toBe("Borin ends its turn in another creature's space and falls Prone.");
    const larger = game(HERO, { [DRAGON]: cell(0, 0), [HERO]: cell(0, 0) });
    sized(larger, HERO, "large");
    proneInSharedSpace(larger, HERO, GRID.calibration!, resolveDefinition, []);
    expect(actor(larger, HERO).conditions).toEqual([]);
    const tiny = game(HERO, { [DRAGON]: cell(0, 0), [HERO]: cell(0, 0) });
    sized(tiny, HERO, "tiny");
    proneInSharedSpace(tiny, HERO, GRID.calibration!, resolveDefinition, []);
    expect(actor(tiny, HERO).conditions).toEqual([]);
  });
});
