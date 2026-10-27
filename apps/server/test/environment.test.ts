import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { ContentLibrary } from "../src/content-library.js";
import { exhaustionLevel } from "../src/condition-rules.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import {
  environmentAtTurnEnd,
  environmentOverTime,
  restFromTravel,
  setEnvironment,
  settleWeather,
  travelHoursPass,
  WEATHER_TAG
} from "../src/environment.js";
import { iceAtTurnStart, iceEntry } from "../src/ice.js";
import { crossesAtNoCost } from "../src/spell-zones.js";
import type { TokenMapGeometry } from "../src/token-placement.js";

// The scene's climate and weather (SRD 5.2.1 Gameplay Toolbox, Environmental Effects): extreme cold with a Bedroll or a
// Blanket, extreme heat, frigid and deep water, heavy precipitation and strong wind, slippery ice, and Extended Travel.

const catalog = equipmentCatalogOf(new ContentLibrary().forAudience("gm"));
const HERO = "10000000-0000-4000-8000-0000000000e1";
const MAP = "20000000-0000-5000-8000-0000000000e1";
const GM = { role: "gm" } as const;
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

const gear = (id: string, equipped = true) => ({
  id,
  name: catalog.equipmentRecord(id)!.name,
  quantity: 1,
  equipped,
  attuned: false
});

/** A traveller placed on the scene's map at (2,2), with this gear; in a fight on its turn when `fighting`. */
function scene(inventory: ReturnType<typeof gear>[] = [], fighting = false): GameState {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: HERO,
        name: "Brin",
        kind: "player-character",
        visibility: "public",
        speedFeet: 30,
        hp: { current: 30, maximum: 30 },
        inventory
      }
    ],
    combat: {
      active: fighting,
      round: 1,
      turnActorId: fighting ? HERO : null,
      mapAssetId: MAP,
      initiative: [{ actorId: HERO, score: 20 }],
      tokens: [{ actorId: HERO, position: cell(2, 2), sizePx: 40, sizeCells: 1 }]
    }
  });
}

const deps = (faces: number[]) => ({
  resolveDefinition: () => undefined,
  catalog,
  random: () => faces.shift() ?? 10
});
const hero = (state: GameState) => state.actors[0]!;
const hours = (state: GameState, count: number, faces: number[]) =>
  environmentOverTime(state, new Set([HERO]), 0, count * 60, deps(faces));

describe("extreme cold", () => {
  it("asks a DC 10 Constitution save at the end of each hour, a failure a level of Exhaustion", () => {
    const state = scene();
    setEnvironment(state, undefined, { cold: true }, GM);
    const events = hours(state, 2, [12, 4]);
    expect(events.map((event) => event.text)).toEqual([
      "Brin endures the extreme cold: DC 10 CON save, 12 (d20 12), a success.",
      "Brin endures the extreme cold: DC 10 CON save, 4 (d20 4), a failure.",
      "Brin gains a level of Exhaustion (the extreme cold)."
    ]);
    expect(exhaustionLevel(hero(state))).toBe(1);
  });

  it("spares a creature in its Bedroll", () => {
    const state = scene([gear("bedroll")]);
    setEnvironment(state, undefined, { cold: true }, GM);
    expect(hours(state, 3, [1, 1, 1])).toEqual([]);
    expect(exhaustionLevel(hero(state))).toBe(0);
  });

  // SRD Ring of Warmth: "you and everything you wear and carry are unharmed by temperatures of 0 degrees Fahrenheit or
  // lower".
  it("spares a creature wearing an attuned Ring of Warmth, and not one that hasn't attuned to it", () => {
    const state = scene([{ ...gear("ring-of-warmth"), attuned: true }]);
    setEnvironment(state, undefined, { cold: true }, GM);
    expect(hours(state, 2, [1, 1])).toEqual([]);
    const unattuned = scene([gear("ring-of-warmth")]);
    setEnvironment(unattuned, undefined, { cold: true }, GM);
    expect(hours(unattuned, 1, [1]).length).toBeGreaterThan(0);
  });

  it("gives a creature wrapped in a Blanket Advantage on the save", () => {
    const state = scene([gear("blanket")]);
    setEnvironment(state, undefined, { cold: true }, GM);
    const events = hours(state, 1, [3, 15]);
    expect(events[0]!.text).toBe(
      "Brin endures the extreme cold: DC 10 CON save, 15 (d20 15, Advantage (Blanket)), a success."
    );
  });
});

describe("extreme heat", () => {
  it("raises the DC by 1 each hour for a creature without water, and spares one with a full Waterskin", () => {
    const state = scene();
    setEnvironment(state, undefined, { heat: true }, GM);
    const events = hours(state, 2, [5, 5]);
    expect(events.map((event) => event.text)).toEqual([
      "Brin endures the extreme heat: DC 5 CON save, 5 (d20 5), a success.",
      "Brin endures the extreme heat: DC 6 CON save, 5 (d20 5), a failure.",
      "Brin gains a level of Exhaustion (the extreme heat)."
    ]);
    const watered = scene([gear("waterskin", false)]);
    setEnvironment(watered, undefined, { heat: true }, GM);
    expect(hours(watered, 2, [1, 1])).toEqual([]);
  });

  it("gives a creature in Medium or Heavy armor Disadvantage", () => {
    const state = scene([gear("chain-shirt")]);
    setEnvironment(state, undefined, { heat: true }, GM);
    expect(hours(state, 1, [18, 2])[0]!.text).toBe(
      "Brin endures the extreme heat: DC 5 CON save, 2 (d20 2, Disadvantage (medium armor)), a failure."
    );
  });
});

describe("frigid and deep water", () => {
  it("gives a creature immersed in frigid water minutes equal to its Constitution, then a save each minute", () => {
    const state = scene();
    state.combat.terrain.water = [rect(0, 0, 5, 5)];
    setEnvironment(state, undefined, { frigidWater: true }, GM);
    // Constitution 10: 10 minutes' grace, then 2 more minutes, 2 saves.
    const events = environmentOverTime(state, new Set([HERO]), 0, 12, deps([15, 15]));
    expect(events.map((event) => event.text)).toEqual([
      "Brin endures the frigid water: DC 10 CON save, 15 (d20 15), a success.",
      "Brin endures the frigid water: DC 10 CON save, 15 (d20 15), a success."
    ]);
    // Out of the water, the count starts over.
    state.combat.tokens[0]!.position = cell(8, 8);
    environmentOverTime(state, new Set([HERO]), 12, 13, deps([]));
    expect(hero(state).exposure?.frigidRounds ?? 0).toBe(0);
  });

  it("counts frigid water a round at a time in an encounter", () => {
    const state = scene([], true);
    state.combat.terrain.water = [rect(0, 0, 5, 5)];
    setEnvironment(state, undefined, { frigidWater: true }, GM);
    environmentAtTurnEnd(state, HERO, GRID.calibration, {
      ...deps([]),
      newId: () => "50000000-0000-4000-8000-0000000000e1",
      now: () => "2026-10-26T00:00:00.000Z"
    });
    expect(hero(state).exposure?.frigidRounds).toBe(1);
  });

  it("asks a creature without a Swim Speed a save after each hour in deep water", () => {
    const state = scene();
    state.combat.terrain.water = [rect(0, 0, 5, 5)];
    setEnvironment(state, undefined, { deepWater: true }, GM);
    const events = environmentOverTime(state, new Set([HERO]), 0, 90, deps([9]));
    expect(events.map((event) => event.text)).toEqual([
      "Brin endures swimming in deep water: DC 10 CON save, 9 (d20 9), a failure.",
      "Brin gains a level of Exhaustion (swimming in deep water)."
    ]);
    expect(hero(state).exposure?.deepMinutes).toBe(30);
  });
});

describe("heavy precipitation and strong wind", () => {
  it("gives each creature on the map Disadvantage on Perception in heavy rain, and ranged weapon attacks in a wind", () => {
    const state = scene();
    setEnvironment(state, undefined, { precipitation: "rain", wind: "strong" }, GM);
    settleWeather(state, { catalog });
    const weather = hero(state).effects.find((effect) => effect.tags.includes(WEATHER_TAG))!;
    expect(weather.name).toBe("Heavy rain and Strong wind");
    expect(weather.modifiers).toEqual([
      expect.objectContaining({ roll: "check", mode: "disadvantage" }),
      expect.objectContaining({ roll: "attack", mode: "disadvantage" })
    ]);
    setEnvironment(state, undefined, { precipitation: "none", wind: "none" }, GM);
    settleWeather(state, { catalog });
    expect(hero(state).effects.some((effect) => effect.tags.includes(WEATHER_TAG))).toBe(false);
  });

  it("puts out a carried open flame", () => {
    const state = scene([gear("torch")]);
    state.actors[0]!.inventory[0]!.lit = true;
    setEnvironment(state, undefined, { precipitation: "rain" }, GM);
    const events = settleWeather(state, { catalog });
    expect(events.map((event) => event.text)).toEqual(["The heavy rain puts out Torch carried by Brin."]);
    expect(hero(state).inventory[0]!.lit).toBeFalsy();
  });

  it("brings down a flier that ends its turn aloft", () => {
    const state = scene([], true);
    state.combat.tokens[0] = { ...state.combat.tokens[0]!, altitudeFeet: 20, airborne: "fly" };
    setEnvironment(state, undefined, { wind: "strong" }, GM);
    const events = environmentAtTurnEnd(state, HERO, GRID.calibration, {
      ...deps([3, 3]),
      newId: () => "50000000-0000-4000-8000-0000000000e2",
      now: () => "2026-10-26T00:00:00.000Z"
    });
    expect(events[0]!.text).toBe("The strong wind brings Brin down: it didn't land by the end of its turn.");
    expect(state.combat.tokens[0]!.altitudeFeet ?? 0).toBe(0);
  });
});

describe("slippery ice", () => {
  // SRD Boots of the Winterlands, Winter Strider: "You ignore Difficult Terrain created by ice or snow."
  it("costs no extra movement for a creature in attuned Boots of the Winterlands", () => {
    const content = { resolveDefinition: () => undefined, catalog };
    expect(crossesAtNoCost(hero(scene([{ ...gear("boots-of-the-winterlands"), attuned: true }])), "ice", content)).toBe(
      true
    );
    expect(crossesAtNoCost(hero(scene([gear("boots-of-the-winterlands")])), "ice", content)).toBe(false);
    expect(crossesAtNoCost(hero(scene()), "ice", content)).toBe(false);
  });

  it("asks a DC 10 Dexterity save against Prone where a creature first steps onto it, once a turn", () => {
    const state = scene([], true);
    state.combat.terrain.ice = [rect(4, 2, 6, 2)];
    const path = [cell(2, 2), cell(3, 2), cell(4, 2), cell(5, 2)];
    expect(iceEntry(state, HERO, path, GRID.calibration)).toBe(2);
    const events = iceAtTurnStart(state, HERO, GRID.calibration, {
      newId: () => "50000000-0000-4000-8000-0000000000e3",
      now: () => "2026-10-26T00:00:00.000Z"
    });
    expect(events).toEqual([]);
    state.combat.tokens[0]!.position = cell(5, 2);
    iceAtTurnStart(state, HERO, GRID.calibration, {
      newId: () => "50000000-0000-4000-8000-0000000000e4",
      now: () => "2026-10-26T00:00:00.000Z"
    });
    expect(state.combat.pendingSaves[0]).toMatchObject({ ability: "dex", dc: 10, conditionIds: ["prone"] });
    expect(iceEntry(state, HERO, [cell(3, 2), cell(4, 2)], GRID.calibration)).toBeNull();
  });
});

describe("Extended Travel", () => {
  it("asks a save past 8 hours on the road, twice as soon at high altitude, and starts over after a Long Rest", () => {
    const state = scene();
    const events = travelHoursPass(state, [HERO], 9, deps([12]));
    expect(events.map((event) => event.text)).toEqual([
      "Brin endures travelling 9 hours: DC 11 CON save, 12 (d20 12), a success."
    ]);
    restFromTravel(hero(state));
    setEnvironment(state, undefined, { highAltitude: true }, GM);
    const high = travelHoursPass(state, [HERO], 5, deps([12, 12]));
    expect(high.map((event) => event.text)).toEqual([
      "Brin endures travelling 9 hours: DC 11 CON save, 12 (d20 12), a success.",
      "Brin endures travelling 10 hours: DC 12 CON save, 12 (d20 12), a success."
    ]);
  });
});
