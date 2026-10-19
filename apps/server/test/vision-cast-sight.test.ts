import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import { ContentLibrary } from "../src/content-library.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { GameAccessDeniedError } from "../src/authorization.js";
import { CommandRejectedError } from "../src/game-store.js";
import { burnOutLights, keepLightState, setItemLight } from "../src/item-light.js";
import { applyCastSight, pruneEndedSight } from "../src/vision/cast-sight.js";
import { sceneSight } from "../src/vision/sight.js";
import { cell, GOBLIN, HERO, SESSION_A, visionGame } from "./vision-fixtures.js";

// The lights and areas spells and actions leave on the map (SRD 5.2.1: Light, Darkness, Daylight, Fog Cloud, Dancing
// Lights; a magmin's Ignited Illumination), how they end, and the lights a creature carries in hand (Torch, Tinderbox,
// Lamp and Oil, Hooded Lantern).

const catalog = equipmentCatalogOf(new ContentLibrary().forAudience("gm"));
const spells = new ContentLibrary().forAudience("gm");
const sightOf = (spellId: string) => spells.spellRecord(spellId)!.sight!;

const CAST = "60000000-0000-4000-8000-0000000000c1";
const SECOND = "60000000-0000-4000-8000-0000000000c2";

/** A placed circle template, as a cast's area is drawn, with the command's id. */
const template = (id: string, at: { x: number; y: number }, radiusPx: number) => ({
  id,
  kind: "shape",
  shape: "circle",
  geometry: { origin: at, target: { x: at.x + radiusPx, y: at.y }, sizeFeet: radiusPx / 10 },
  ownerSessionId: "30000000-0000-4000-8000-00000000000a",
  createdByRole: "gm",
  createdAt: 0
});

const concentrating = (castId: string) => ({
  id: `${castId}:concentration`,
  name: "Concentrating",
  tags: ["concentrating"],
  sourceActorId: HERO,
  sourceName: "Borin",
  startedRound: 1,
  duration: { type: "manual" },
  concentration: true,
  castId
});

describe("lights and areas from casts", () => {
  it("lights the touched creature with Light, and casting it again moves the light", () => {
    const state = visionGame({ ambient: "dark" });
    applyCastSight(state, {
      commandId: CAST,
      casterId: HERO,
      sight: sightOf("light"),
      spellId: "light",
      level: 0,
      targetIds: [GOBLIN],
      areaPlaced: false
    });
    expect(state.combat.vision.lights).toHaveLength(1);
    expect(state.combat.vision.lights[0]).toMatchObject({ actorId: GOBLIN, brightFeet: 20, dimFeet: 20 });
    expect(sceneSight(state).perceives(HERO, GOBLIN)).toBe(true);
    applyCastSight(state, {
      commandId: SECOND,
      casterId: HERO,
      sight: sightOf("light"),
      spellId: "light",
      level: 0,
      targetIds: [],
      areaPlaced: false
    });
    expect(state.combat.vision.lights).toHaveLength(1);
    expect(state.combat.vision.lights[0]).toMatchObject({ actorId: HERO });
  });

  it("fills a Fog Cloud's placed Sphere with fog that ends with the caster's Concentration", () => {
    const state = visionGame({
      annotations: [template(CAST, cell(5, 5), 100)],
      actors: { [HERO]: { effects: [concentrating(CAST)] } }
    });
    applyCastSight(state, {
      commandId: CAST,
      casterId: HERO,
      sight: sightOf("fog-cloud"),
      spellId: "fog-cloud",
      level: 1,
      castId: CAST,
      targetIds: [],
      areaPlaced: true
    });
    expect(sceneSight(state).perceives(HERO, GOBLIN)).toBe(false);
    state.actors = state.actors.map((actor) => (actor.id === HERO ? { ...actor, effects: [] } : actor));
    // Ended Concentration ends the fog at once, and the next command clears it from the scene.
    expect(sceneSight(state).perceives(HERO, GOBLIN)).toBe(true);
    pruneEndedSight(state);
    expect(state.combat.vision.areas).toHaveLength(0);
  });

  it("lets Darkness dispel the spell light of level 2 or lower that it overlaps", () => {
    const state = visionGame({
      ambient: "dark",
      annotations: [template(SECOND, cell(8, 5), 150)],
      actors: { [HERO]: { effects: [concentrating(SECOND)] } }
    });
    applyCastSight(state, {
      commandId: CAST,
      casterId: GOBLIN,
      sight: sightOf("light"),
      spellId: "light",
      level: 0,
      targetIds: [GOBLIN],
      areaPlaced: false
    });
    applyCastSight(state, {
      commandId: SECOND,
      casterId: HERO,
      sight: sightOf("darkness"),
      spellId: "darkness",
      level: 2,
      castId: SECOND,
      targetIds: [],
      areaPlaced: true
    });
    expect(state.combat.vision.lights).toHaveLength(0);
    expect(state.combat.vision.areas.map((area) => area.kind)).toEqual(["magical-darkness"]);
  });

  it("lets Daylight dispel Darkness of level 3 or lower, ending the caster's Concentration on it", () => {
    const darknessCast = "60000000-0000-4000-8000-0000000000d1";
    const state = visionGame({
      annotations: [template(darknessCast, cell(8, 5), 150), template(CAST, cell(6, 5), 200)],
      actors: { [GOBLIN]: { effects: [{ ...concentrating(darknessCast), sourceActorId: GOBLIN }] } }
    });
    applyCastSight(state, {
      commandId: darknessCast,
      casterId: GOBLIN,
      sight: sightOf("darkness"),
      spellId: "darkness",
      level: 2,
      castId: darknessCast,
      targetIds: [],
      areaPlaced: true
    });
    expect(state.combat.vision.areas).toHaveLength(1);
    const events = applyCastSight(state, {
      commandId: CAST,
      casterId: HERO,
      sight: sightOf("daylight"),
      spellId: "daylight",
      level: 3,
      targetIds: [],
      areaPlaced: true
    });
    expect(state.combat.vision.areas).toHaveLength(0);
    expect(state.actors.find((actor) => actor.id === GOBLIN)!.effects).toHaveLength(0);
    expect(events.length).toBeGreaterThan(0);
    expect(sceneSight(state).lightAt(cell(6, 5))).toMatchObject({ level: "bright", sunlight: true });
  });

  it("sets Dancing Lights' four lights down by the caster", () => {
    const state = visionGame({ ambient: "dark" });
    applyCastSight(state, {
      commandId: CAST,
      casterId: HERO,
      sight: sightOf("dancing-lights"),
      spellId: "dancing-lights",
      level: 0,
      castId: CAST,
      targetIds: [],
      areaPlaced: false
    });
    expect(state.combat.vision.lights).toHaveLength(4);
    expect(state.combat.vision.lights.every((light) => light.position !== null && light.dimFeet === 10)).toBe(true);
  });

  it("toggles a magmin's flames: a second use puts them out", () => {
    const state = visionGame({ ambient: "dark" });
    const sight = { light: { on: "caster" as const, brightFeet: 10, dimFeet: 10 }, toggles: true as const };
    applyCastSight(state, {
      commandId: CAST,
      casterId: GOBLIN,
      sight,
      actionId: "ignited-illumination",
      targetIds: [],
      areaPlaced: false
    });
    expect(state.combat.vision.lights).toHaveLength(1);
    applyCastSight(state, {
      commandId: SECOND,
      casterId: GOBLIN,
      sight,
      actionId: "ignited-illumination",
      targetIds: [],
      areaPlaced: false
    });
    expect(state.combat.vision.lights).toHaveLength(0);
  });

  it("ends an area that lasts rounds when its rounds are up", () => {
    const state = visionGame({ annotations: [template(CAST, cell(5, 5), 50)] });
    applyCastSight(state, {
      commandId: CAST,
      casterId: GOBLIN,
      sight: { area: { kind: "heavily-obscured" }, rounds: 10 },
      actionId: "ink-cloud",
      targetIds: [],
      areaPlaced: true
    });
    state.combat = { ...state.combat, round: 10 };
    pruneEndedSight(state);
    expect(state.combat.vision.areas).toHaveLength(1);
    state.combat = { ...state.combat, round: 11 };
    pruneEndedSight(state);
    expect(state.combat.vision.areas).toHaveLength(0);
  });
});

describe("lights in hand", () => {
  const gm = { role: "gm" } as const;
  const player = { role: "player", sessionId: SESSION_A } as const;
  const carrying = (rows: Record<string, unknown>[]): GameState =>
    visionGame({ ambient: "dark", actors: { [HERO]: { ownerSessionId: SESSION_A, inventory: rows } } });
  const torch = { id: "torch", name: "Torch", quantity: 2, equipped: false, attuned: false };
  const tinderbox = { id: "tinderbox", name: "Tinderbox", quantity: 1, equipped: false, attuned: false };
  const hero = (state: GameState) => state.actors.find((actor) => actor.id === HERO)!;
  const row = (state: GameState, id: string) => hero(state).inventory.find((item) => item.id === id);

  it("lights a Torch with a Tinderbox for the Bonus Action, held, burning for an hour", () => {
    const state = carrying([torch, tinderbox]);
    state.rest = { ...state.rest, clockHours: 5 };
    setItemLight(state, { actorId: HERO, itemId: "torch", lit: true }, player, catalog);
    expect(row(state, "torch")).toMatchObject({ lit: true, equipped: true, burnsOutAtHour: 6 });
    expect(state.combat.turn.bonusActionUsed).toBe(true);
    expect(sceneSight(state, { catalog }).lightAt(cell(1, 5)).level).toBe("bright");
  });

  it("refuses a player lighting a Torch with no flame to light it with", () => {
    const state = carrying([torch]);
    expect(() => setItemLight(state, { actorId: HERO, itemId: "torch", lit: true }, player, catalog)).toThrow(
      CommandRejectedError
    );
  });

  it("refuses a player lighting a Torch off their character's turn", () => {
    const state = carrying([torch, tinderbox]);
    state.combat = { ...state.combat, turnActorId: GOBLIN };
    expect(() => setItemLight(state, { actorId: HERO, itemId: "torch", lit: true }, player, catalog)).toThrow(
      GameAccessDeniedError
    );
  });

  it("burns a flask of Oil to light a Lamp, and refuses without one", () => {
    const lamp = { id: "lamp", name: "Lamp", quantity: 1, equipped: false, attuned: false };
    const oil = { id: "oil", name: "Oil (flask)", quantity: 1, equipped: false, attuned: false };
    expect(() =>
      setItemLight(carrying([lamp, tinderbox]), { actorId: HERO, itemId: "lamp", lit: true }, gm, catalog)
    ).toThrow(CommandRejectedError);
    const state = carrying([lamp, tinderbox, oil]);
    setItemLight(state, { actorId: HERO, itemId: "lamp", lit: true }, gm, catalog);
    expect(row(state, "lamp")).toMatchObject({ lit: true, burnsOutAtHour: 6 });
    expect(row(state, "oil")).toBeUndefined();
  });

  it("uses up a Torch once its hour has burned, and puts a Lamp out when its Oil is spent", () => {
    const state = carrying([
      { ...torch, equipped: true, lit: true, burnsOutAtHour: 3 },
      { id: "lamp", name: "Lamp", quantity: 1, equipped: true, attuned: false, lit: true, burnsOutAtHour: 4 }
    ]);
    state.rest = { ...state.rest, clockHours: 3 };
    expect(burnOutLights(state, catalog)).toHaveLength(1);
    expect(row(state, "torch")).toMatchObject({ quantity: 1 });
    expect(row(state, "torch")?.lit).toBeUndefined();
    state.rest = { ...state.rest, clockHours: 4 };
    burnOutLights(state, catalog);
    expect(row(state, "lamp")).toMatchObject({ quantity: 1 });
    expect(row(state, "lamp")?.lit).toBeUndefined();
  });

  it("lowers a Hooded Lantern's hood as a Bonus Action", () => {
    const lantern = {
      id: "hooded-lantern",
      name: "Lantern, Hooded",
      quantity: 1,
      equipped: true,
      attuned: false,
      lit: true
    };
    const state = carrying([lantern]);
    setItemLight(state, { actorId: HERO, itemId: "hooded-lantern", hoodLowered: true }, player, catalog);
    expect(row(state, "hooded-lantern")).toMatchObject({ hoodLowered: true });
    expect(state.combat.turn.bonusActionUsed).toBe(true);
  });

  it("keeps a row's light state from a client's copy, and puts the light out when it is stowed", () => {
    const stored = { ...torch, equipped: true, lit: true, burnsOutAtHour: 9 };
    expect(keepLightState(stored, { ...torch, equipped: true }, 8)).toMatchObject({ lit: true, burnsOutAtHour: 9 });
    const stowed = keepLightState(stored, { ...torch, equipped: false }, 8);
    expect(stowed.lit).toBeUndefined();
    expect(stowed.burnHoursLeft).toBe(1);
    // A client can't light a row by sending it lit.
    expect(keepLightState({ ...torch }, { ...torch, lit: true }, 8).lit).toBeUndefined();
  });
});
