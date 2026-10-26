import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { InventoryItemSchema, type InventoryItem } from "@vtt/schemas";
import { ContentLibrary } from "../src/content-library.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { applyMovementRules, movementStatus } from "../src/movement-rules.js";
import { movementCost, paintTerrain } from "../src/terrain.js";
import type { TokenMapGeometry } from "../src/token-placement.js";
import { bootMovementServer, cell as movementCell } from "./movement-fixtures.js";

// SRD 5.2.1 magic items that change how their wearer moves: a Ring of Free Action ("Difficult Terrain doesn't cost you
// extra movement") and Horseshoes of a Zephyr on a horse ("ignores Difficult Terrain").

const catalog = equipmentCatalogOf(new ContentLibrary().forAudience("gm"));
const MAP = "20000000-0000-5000-8000-000000000041";
const HERO = "10000000-0000-4000-8000-000000000041";
const GRID: TokenMapGeometry = {
  width: 1000,
  height: 1000,
  calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
};
const cell = (column: number, row: number) => ({ x: 25 + 50 * column, y: 25 + 50 * row });
const rect = (c0: number, r0: number, c1: number, r1: number) => ({
  x: 50 * c0,
  y: 50 * r0,
  width: 50 * (c1 - c0 + 1),
  height: 50 * (r1 - r0 + 1)
});

const worn = (id: string, over: Partial<InventoryItem> = {}): InventoryItem =>
  InventoryItemSchema.parse({
    id,
    name: catalog.equipmentRecord(id)!.name,
    quantity: 1,
    equipped: true,
    attuned: true,
    ...over
  });

function game(inventory: InventoryItem[]): GameState {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: HERO,
        name: "Borin",
        kind: "player-character",
        visibility: "public",
        speedFeet: 30,
        hp: { current: 10, maximum: 10 },
        inventory
      }
    ],
    combat: {
      active: true,
      round: 1,
      turnActorId: HERO,
      mapAssetId: MAP,
      initiative: [{ actorId: HERO, score: 20 }],
      tokens: [{ actorId: HERO, position: cell(0, 0), sizePx: 40, sizeCells: 1 }]
    }
  });
  paintTerrain(state, undefined, GRID, { op: "difficult", rect: rect(1, 0, 19, 19) });
  return state;
}

const move = (state: GameState, to: { x: number; y: number }) =>
  applyMovementRules(state, {
    actorId: HERO,
    from: cell(0, 0),
    to,
    distance: () => 0,
    cost: (a, b, options) => movementCost(state, GRID, HERO, a, b, options),
    override: null,
    resolveDefinition: () => undefined,
    catalog,
    newPromptId: () => "70000000-0000-4000-8000-000000000041",
    now: () => 0,
    commandId: "50000000-0000-4000-8000-000000000041"
  });

describe("moving through Difficult Terrain", () => {
  it("costs a Ring of Free Action's wearer nothing extra, and costs it again once the ring comes off", () => {
    const state = game([worn("ring-of-free-action")]);
    expect(movementStatus(state, HERO, { resolveDefinition: () => undefined, catalog }).ignoresDifficultTerrain).toBe(
      true
    );
    move(state, cell(2, 0));
    expect(state.combat.turn.movementUsedFeet).toBe(10);

    const bare = game([worn("ring-of-free-action", { equipped: false })]);
    move(bare, cell(2, 0));
    expect(bare.combat.turn.movementUsedFeet).toBe(20);
  });

  it("costs a creature shod with Horseshoes of a Zephyr nothing extra", () => {
    const state = game([worn("horseshoes-of-a-zephyr", { attuned: false })]);
    move(state, cell(2, 0));
    expect(state.combat.turn.movementUsedFeet).toBe(10);
  });
});

describe("a Broom of Flying", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("stops hovering when its rider lands, and keeps flying while the rider stays aloft", async () => {
    const ORC = "10000000-0000-4000-8000-000000000042";
    const state = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        { id: HERO, name: "Borin", kind: "player-character", speedFeet: 30, inventory: [worn("broom-of-flying")] },
        { id: ORC, name: "Orc", kind: "monster", speedFeet: 30 }
      ].map((actor) => ({ ...actor, visibility: "public", hp: { current: 30, maximum: 30 } }))
    });
    const { server, gmToken, startFight, move: moveToken, post } = await bootMovementServer(state, cleanups);
    await startFight([HERO, ORC], { [HERO]: movementCell(2, 2), [ORC]: movementCell(8, 8) });
    const ride = await post(GAME_PATHS.actionUse, gmToken, { actorId: HERO, actionId: "item-broom-of-flying-ride" });
    expect(ride.status, await ride.clone().text()).toBe(200);
    const riding = () =>
      server.store.snapshot.actors
        .find((actor) => actor.id === HERO)!
        .effects.some((effect) => effect.name === "Broom of Flying");
    expect(riding()).toBe(true);
    expect(
      (await moveToken(HERO, gmToken, { position: movementCell(2, 3), mode: "fly", altitudeFeet: 20 })).status
    ).toBe(200);
    expect(
      (await moveToken(HERO, gmToken, { position: movementCell(2, 4), mode: "fly", altitudeFeet: 10 })).status
    ).toBe(200);
    expect(riding()).toBe(true);
    expect(
      (await moveToken(HERO, gmToken, { position: movementCell(2, 5), mode: "fly", altitudeFeet: 0 })).status
    ).toBe(200);
    expect(riding()).toBe(false);
  });
});
