import { describe, expect, it } from "vitest";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { HOLDING_BREATH_TAG } from "../src/breath.js";
import { ContentLibrary } from "../src/content-library.js";
import { makeEffect } from "../src/effects.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { passGameTime } from "../src/game-time.js";
import { applyMovementRules, movementStatus } from "../src/movement-rules.js";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { builtinAction } from "../src/builtin-actions.js";
import { WATER_WALKING_TAG, walksOnLiquid } from "../src/speed.js";
import { fight, HERO as HERO_OF_FIGHT } from "./spell-casters.js";
import { clericAt } from "./zone-fixtures.js";
import { movementCost, paintTerrain } from "../src/terrain.js";
import type { TokenMapGeometry } from "../src/token-placement.js";
import { OUT_OF_WATER_TAG, runningWaterAtTurnEnd, waterAlongMove, waterOf } from "../src/water.js";

// Water painted on the map (SRD 5.2.1 Swimming, and the monsters that fear or need it): a swimmer's extra cost, a
// fire elemental's Water Susceptibility, a vampire's Running Water, and a sahuagin's Limited Amphibiousness.

const catalog = equipmentCatalogOf(new ContentLibrary().forAudience("gm"));
const HERO = "10000000-0000-4000-8000-0000000000d1";
const MAP = "20000000-0000-5000-8000-0000000000d1";
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
const monster = (id: string) => loadMonsterDefinitions().find((entry) => entry.source?.externalId === id)!;
const DEFINITIONS: Readonly<Record<string, ActorDefinition>> = {
  "fire-elemental": monster("fire-elemental"),
  vampire: monster("vampire"),
  sahuagin: monster("sahuagin-warrior")
};
const resolveDefinition = (id: string) => DEFINITIONS[id];

/** A creature at (0,0) by a pool over columns 1 to 19, in a fight on its turn. */
function pool(over: Record<string, unknown> = {}, kind: "water" | "running-water" = "water"): GameState {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: HERO,
        name: "Wade",
        kind: "monster",
        visibility: "public",
        speedFeet: 30,
        hp: { current: 200, maximum: 200 },
        ...over
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
  paintTerrain(state, undefined, GRID, { op: kind, rect: rect(1, 0, 19, 19) });
  return state;
}

const move = (state: GameState, to: { x: number; y: number }, mode?: "swim" | "walk") =>
  applyMovementRules(state, {
    actorId: HERO,
    from: cell(0, 0),
    to,
    distance: () => 0,
    cost: (a, b, options) => movementCost(state, GRID, HERO, a, b, options),
    override: null,
    resolveDefinition,
    catalog,
    newPromptId: () => "70000000-0000-4000-8000-0000000000d1",
    now: () => 0,
    commandId: "50000000-0000-4000-8000-0000000000d1",
    ...(mode ? { mode } : {})
  });

describe("moving through painted water", () => {
  it("costs a creature without a Swim Speed 1 extra foot for every foot it swims", () => {
    const state = pool();
    move(state, cell(2, 0), "swim");
    expect(state.combat.turn.movementUsedFeet).toBe(20);
  });

  it("costs a sahuagin with its Swim Speed nothing extra", () => {
    const state = pool({ definitionId: "sahuagin" });
    move(state, cell(2, 0));
    expect(state.combat.turn.movementUsedFeet).toBe(10);
  });

  it("costs nothing extra under Water Walk, until the creature passes below the surface", () => {
    const state = pool();
    state.actors[0]!.effects = [
      makeEffect({ id: "water-walk", name: "Water Walk", tags: [WATER_WALKING_TAG], duration: { type: "manual" } })
    ];
    expect(movementStatus(state, HERO, { resolveDefinition, catalog }).walksOnWater).toBe(true);
    move(state, cell(2, 0));
    expect(state.combat.turn.movementUsedFeet).toBe(10);
    expect(waterOf(state, HERO, GRID.calibration)).toBeNull();
  });

  it("is closed to a creature that can't pass through liquid", () => {
    const state = pool();
    expect(movementCost(state, GRID, HERO, cell(0, 0), cell(2, 0), { barredByWater: true })?.blocked).toBe(true);
    // A strip of water a mover can walk round is walked round.
    const strip = pool();
    strip.combat.terrain.water = [rect(1, 0, 1, 0)];
    expect(movementCost(strip, GRID, HERO, cell(0, 0), cell(2, 0), { barredByWater: true })?.feet).toBe(10);
  });
});

describe("Water Susceptibility", () => {
  it("deals a fire elemental 1d6 Cold for every 5 feet it moves in water", () => {
    const state = pool({ definitionId: "fire-elemental" });
    const events = waterAlongMove(state, HERO, [cell(0, 0), cell(1, 0), cell(2, 0), cell(3, 0)], GRID.calibration!, {
      resolveDefinition,
      catalog,
      rollDie: () => 3
    });
    expect(state.actors[0]!.hp.current).toBe(191);
    expect(events[0]!.text).toBe("Wade takes 9 Cold damage moving 15 feet through water (Water Susceptibility).");
  });
});

describe("a vampire's Running Water", () => {
  it("deals 20 Acid as its turn ends in running water, and none in still water", () => {
    const running = pool({ definitionId: "vampire" }, "running-water");
    running.combat.tokens[0]!.position = cell(2, 2);
    runningWaterAtTurnEnd(running, HERO, GRID.calibration, { resolveDefinition, catalog, rollDie: () => 1 });
    expect(running.actors[0]!.hp.current).toBe(180);

    const still = pool({ definitionId: "vampire" });
    still.combat.tokens[0]!.position = cell(2, 2);
    runningWaterAtTurnEnd(still, HERO, GRID.calibration, { resolveDefinition, catalog, rollDie: () => 1 });
    expect(still.actors[0]!.hp.current).toBe(200);
  });
});

describe("Limited Amphibiousness", () => {
  it("starts a sahuagin out of water holding its breath after 4 hours, and lets it breathe once submerged", () => {
    const state = pool({ definitionId: "sahuagin" });
    state.combat.active = false;
    passGameTime(state, 3 * 60, { resolveDefinition, catalog, random: () => 10 });
    expect(state.actors[0]!.effects.some((effect) => effect.tags.includes(HOLDING_BREATH_TAG))).toBe(false);
    passGameTime(state, 60, { resolveDefinition, catalog, random: () => 10 });
    const breath = state.actors[0]!.effects.find((effect) => effect.tags.includes(OUT_OF_WATER_TAG));
    expect(breath?.tags).toContain(HOLDING_BREATH_TAG);

    state.combat.tokens[0]!.position = cell(3, 3);
    passGameTime(state, 1, { resolveDefinition, catalog, random: () => 10 });
    expect(state.actors[0]!.effects.some((effect) => effect.tags.includes(OUT_OF_WATER_TAG))).toBe(false);
    expect(state.actors[0]!.exposure?.dryMinutes ?? 0).toBe(0);
  });
});

describe("Water Walk", () => {
  it("lets its target walk on the water, and pass below the surface and back up as a Bonus Action", () => {
    const caster = fight(clericAt(5, ["water-walk"]));
    caster.resolve("spell-water-walk", { targetIds: [HERO_OF_FIGHT] });
    const hero = () => caster.state.actors.find((actor) => actor.id === HERO_OF_FIGHT)!;
    expect(hero().effects.some((effect) => effect.tags.includes(WATER_WALKING_TAG))).toBe(true);
    expect(walksOnLiquid(hero())).toBe(true);
    const surface = builtinAction("pass-the-surface")!;
    const pass = () =>
      resolveDefinitionAction(
        caster.state,
        surface,
        { actorId: HERO_OF_FIGHT, targetIds: [], commandId: crypto.randomUUID(), builtin: true },
        {
          random: () => 10,
          newRollId: () => crypto.randomUUID(),
          gmSessionId: "30000000-0000-4000-8000-00000000000a",
          now: () => "2026-10-26T00:00:00.000Z",
          definition: caster.definition,
          catalog
        }
      );
    pass();
    expect(walksOnLiquid(hero())).toBe(false);
    caster.state.combat.turn = { ...caster.state.combat.turn, bonusActionUsed: false };
    pass();
    expect(walksOnLiquid(hero())).toBe(true);
  });
});
