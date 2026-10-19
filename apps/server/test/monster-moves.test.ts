import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { RulesBlockedError } from "../src/game-store.js";
import { activeMoveGrant } from "../src/granted-moves.js";
import { applyMovementRules } from "../src/movement-rules.js";
import { spaceEntryAfterMove } from "../src/space-entry.js";
import { creatureDistance, footprintOf, mapDistance } from "../src/movement-narration.js";
import { movementCost } from "../src/terrain.js";
import type { TokenMapGeometry } from "../src/token-placement.js";
import { cell } from "./movement-fixtures.js";

// SRD 5.2.1 moves that go through creatures and act on those they pass: a centaur trooper's Trampling Charge ("can
// move through the spaces of Medium or smaller creatures. Each creature whose space the centaur enters is targeted
// once") and a gelatinous cube's Engulf.

const MONSTER = "10000000-0000-4000-8000-0000000009a1";
const HERO = "10000000-0000-4000-8000-0000000009a2";
const BYSTANDER = "10000000-0000-4000-8000-0000000009a3";

const GRID: TokenMapGeometry = {
  width: 2000,
  height: 2000,
  calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
};
const MONSTERS = loadMonsterDefinitions();
const definitionOf = (slug: string) => MONSTERS.find((monster) => monster.source.externalId === slug)!;

/** The monster at (0,0) on its turn, the hero at (2,0) and a bystander at (2,3). */
function game(slug: string): GameState {
  const actors = [
    { id: MONSTER, name: definitionOf(slug).name, kind: "monster", speedFeet: 50, definitionId: "monster" },
    { id: HERO, name: "Borin", kind: "player-character", speedFeet: 30 },
    { id: BYSTANDER, name: "Ada", kind: "player-character", speedFeet: 30 }
  ];
  const positions: Record<string, { x: number; y: number }> = {
    [MONSTER]: cell(0, 0),
    [HERO]: cell(2, 0),
    [BYSTANDER]: cell(2, 3)
  };
  return GameStateSchema.parse({
    schemaVersion: 1,
    definitions: [{ id: "monster", definition: definitionOf(slug) }],
    actors: actors.map((actor) => ({ ...actor, visibility: "public", hp: { current: 50, maximum: 50 } })),
    combat: {
      active: true,
      round: 1,
      turnActorId: MONSTER,
      mapAssetId: "20000000-0000-5000-8000-000000000001",
      initiative: actors.map((actor, index) => ({ actorId: actor.id, score: 20 - index })),
      tokens: actors.map((actor) => ({ actorId: actor.id, position: positions[actor.id], sizePx: 40, sizeCells: 1 }))
    }
  });
}
const resolveDefinitionIn = (state: GameState) => (id: string) =>
  state.definitions.find((entry) => entry.id === id)?.definition;

let ids = 0;
const nextId = () => `50000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;
function use(
  state: GameState,
  actionId: string,
  targetIds: string[],
  input: Readonly<{ moveFirst?: true; owedPaid?: true }>
) {
  const definition = state.definitions[0]!.definition;
  return resolveDefinitionAction(
    state,
    definition.actions.find((action) => action.id === actionId)!,
    { actorId: MONSTER, targetIds, commandId: nextId(), ...input },
    {
      random: () => 3,
      newRollId: nextId,
      gmSessionId: "30000000-0000-4000-8000-00000000000a",
      now: () => "2026-10-19T00:00:00.000Z",
      definition,
      resolveDefinition: resolveDefinitionIn(state)
    }
  );
}
let prompts = 0;
function move(state: GameState, to: { x: number; y: number }, mover = MONSTER) {
  const from = state.combat.tokens.find((token) => token.actorId === mover)!.position!;
  const outcome = applyMovementRules(state, {
    actorId: mover,
    from,
    to,
    byPlayer: false,
    distance: (a, b) => mapDistance(GRID, a, b)?.value ?? null,
    cost: (a, b, costOptions) => movementCost(state, GRID, mover, a, b, costOptions),
    creatureDistance: (enemy, point, altitudeFeet) => {
      const enemyToken = state.combat.tokens.find((token) => token.actorId === enemy.actorId)!;
      const moverToken = state.combat.tokens.find((token) => token.actorId === mover)!;
      return (
        creatureDistance(GRID, footprintOf(enemyToken, enemy.position), footprintOf(moverToken, point, altitudeFeet))
          ?.value ?? null
      );
    },
    calibration: GRID.calibration,
    override: null,
    resolveDefinition: resolveDefinitionIn(state),
    newPromptId: () => `70000000-0000-4000-8000-${String(++prompts).padStart(12, "0")}`,
    now: () => 0,
    commandId: nextId()
  });
  state.combat = {
    ...state.combat,
    tokens: state.combat.tokens.map((token) => (token.actorId === mover ? { ...token, position: to } : token))
  };
  return outcome;
}
const zoneDeps = (state: GameState) => ({
  geometry: GRID,
  resolveDefinition: (id: string) => resolveDefinitionIn(state)(id),
  rollDie: () => 4,
  newId: nextId,
  now: () => "2026-10-19T00:00:00.000Z"
});

describe("a move through creatures", () => {
  it("lets a centaur's Trampling Charge pass through a creature and target only the ones it entered", () => {
    const state = game("centaur-trooper");
    use(state, "trampling-charge-recharge-5-6", [], { moveFirst: true });
    move(state, cell(4, 0));
    const grant = state.actors.find((actor) => actor.id === MONSTER)!.effects.find((effect) => effect.grantedMove);
    expect(grant?.grantedMove?.entered).toEqual([HERO]);
    expect(() => use(state, "trampling-charge-recharge-5-6", [BYSTANDER], { owedPaid: true })).toThrow(
      RulesBlockedError
    );
    use(state, "trampling-charge-recharge-5-6", [HERO], { owedPaid: true });
    expect(state.combat.pendingSaves.map((save) => save.targetActorId)).toEqual([HERO]);
    // The rest of its move is still its own, and owes nothing now.
    expect(
      activeMoveGrant(
        state,
        state.actors.find((actor) => actor.id === MONSTER)!
      )?.owedActionId
    ).toBeUndefined();
  });

  it("keeps a Trampling Charge out of a creature larger than Medium, which it goes round", () => {
    const state = game("centaur-trooper");
    state.actors = state.actors.map((actor) => (actor.id === HERO ? { ...actor, size: "large" } : actor));
    use(state, "trampling-charge-recharge-5-6", [], { moveFirst: true });
    move(state, cell(4, 0));
    const grant = state.actors.find((actor) => actor.id === MONSTER)!.effects.find((effect) => effect.grantedMove);
    expect(grant?.grantedMove?.entered ?? []).toEqual([]);
    expect(() => use(state, "trampling-charge-recharge-5-6", [HERO], { owedPaid: true })).toThrow(RulesBlockedError);
  });

  it("engulfs only the creatures a gelatinous cube moved through", () => {
    const state = game("gelatinous-cube");
    use(state, "engulf", [], { moveFirst: true });
    move(state, cell(3, 0));
    expect(() => use(state, "engulf", [HERO, BYSTANDER], { owedPaid: true })).toThrow(RulesBlockedError);
    use(state, "engulf", [HERO], { owedPaid: true });
    expect(state.combat.pendingSaves).toMatchObject([{ targetActorId: HERO, ability: "dex", dc: 12 }]);
  });

  it("lets a gelatinous cube's Engulf move stop on a creature it moves into", () => {
    const state = game("gelatinous-cube");
    use(state, "engulf", [], { moveFirst: true });
    expect(move(state, cell(2, 0)).warning).toBeNull();
    use(state, "engulf", [HERO], { owedPaid: true });
    expect(state.combat.pendingSaves.map((save) => save.targetActorId)).toEqual([HERO]);
  });
});

describe("a creature's space entered on a move", () => {
  it("opens a gelatinous cube's space to a creature, which makes its Engulf save with Disadvantage", () => {
    const state = game("gelatinous-cube");
    const from = cell(2, 0);
    expect(move(state, cell(0, 0), HERO).warning).toBeNull();
    const path = movementCost(state, GRID, HERO, from, cell(0, 0), {
      resolveDefinition: resolveDefinitionIn(state)
    })!.path!;
    spaceEntryAfterMove(state, { moverId: HERO, path }, zoneDeps(state));
    expect(state.combat.pendingSaves).toMatchObject([
      {
        targetActorId: HERO,
        sourceActorId: MONSTER,
        actionName: "Engulf",
        dc: 12,
        disadvantageFrom: "Ooze Cube"
      }
    ]);
  });
});
