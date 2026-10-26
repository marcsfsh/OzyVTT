import { describe, expect, it } from "vitest";
import type { GameState, SpellZone } from "@vtt/domain";
import type { EffectNarration } from "../src/effects.js";
import { addEffect, makeEffect } from "../src/effects.js";
import { nextInitiativeTurn } from "../src/encounter.js";
import { RulesBlockedError } from "../src/game-store.js";
import { BURNING_TAG } from "../src/hazards.js";
import { castOptionsOf } from "../src/spell-zones.js";
import { settleZoneOutcomes } from "../src/zone-outcomes.js";
import { areaMoveOf, moveArea, planAreaMove } from "../src/zone-moves.js";
import { build, catalog, fight, FOE, FOE2, HERO, view, wizardInput } from "./spell-casters.js";
import { cell, drawArea, GRID, place, turnDeps, wizardAt, zoneDeps } from "./zone-fixtures.js";

// SRD 5.2.1 areas that act on fire, fog and clouds: Incendiary Cloud "moves 10 feet away from you in a direction you
// choose at the start of each of your turns" and lasts "until a strong wind (like that created by Gust of Wind)
// disperses it"; Gust of Wind "disperses gas or vapor, and it extinguishes candles and similar unprotected flames",
// with "a 50 percent chance to extinguish" a lantern's; Sleet Storm: "exposed flames in the area are doused"; Create or
// Destroy Water's rain "extinguishing exposed flames there", or "you destroy fog in a 30-foot Cube".

const CAST = "69000000-0000-4000-8000-000000000001";
const WIND = "69000000-0000-4000-8000-000000000002";
const TABLE = { sessionId: "30000000-0000-4000-8000-00000000000a", role: "gm" } as const;
const actor = (state: GameState, id: string) => state.actors.find((candidate) => candidate.id === id)!;
const areaOf = (state: GameState, id = CAST) => state.combat.annotations.find((annotation) => annotation.id === id)!;

/** A zone of another caster's spell standing on a drawn area, as a cast leaves it. */
function standing(state: GameState, spellId: string, row: string, id: string, area: SpellZone["area"]): void {
  const spell = view.spellRecord(spellId)!;
  state.combat.spellZones = [
    ...state.combat.spellZones,
    {
      id,
      spellId,
      name: spell.name,
      laterActionId: `spell-${spellId}-then-${row}`,
      casterId: FOE2,
      castId: null,
      rounds: null,
      startedRound: 1,
      level: spell.level,
      dc: 15,
      annotationId: id,
      area,
      damageDealt: 0,
      entered: [],
      affected: []
    }
  ];
}

/** Lights a carried light source on the creature's row. */
function carryLit(state: GameState, actorId: string, id: string, name: string): void {
  const creature = actor(state, actorId);
  creature.inventory = [...creature.inventory, { id, name, quantity: 1, equipped: true, attuned: false, lit: true }];
}
const lit = (state: GameState, actorId: string, id: string) =>
  actor(state, actorId).inventory.find((row) => row.id === id)?.lit === true;

/** Sets a creature burning, as Alchemist's Fire does. */
function setBurning(state: GameState, actorId: string): void {
  addEffect(
    state,
    actorId,
    makeEffect({
      id: `${actorId}:burning`,
      name: "Burning",
      tags: [BURNING_TAG],
      sourceActorId: null,
      sourceName: null,
      startedRound: 1,
      duration: { type: "manual" },
      ongoingDamage: { damage: [{ formula: "1d4", type: "fire" }], at: "bearer-turn-start" }
    })
  );
}
const burning = (state: GameState, actorId: string) =>
  actor(state, actorId).effects.some((effect) => effect.tags.includes(BURNING_TAG));

describe("Incendiary Cloud: its caster steers the drift", () => {
  const wizard = wizardAt(15, ["incendiary-cloud", "magic-missile"]);

  /** The cloud, 20 feet in radius, centred 50 feet east of the wizard; the wizard's next turn has begun. */
  function cloud() {
    const caster = fight(wizard);
    place(caster.state, { [HERO]: cell(0, 10), [FOE]: cell(30, 30), [FOE2]: cell(40, 40) });
    caster.resolve("spell-incendiary-cloud", { targetIds: [], commandId: CAST, areaPlaced: true });
    drawArea(caster.state, CAST, [10, 10], 4);
    const events: EffectNarration[] = [];
    for (let step = 0; step < 4 && !(caster.state.combat.turnActorId === HERO && caster.state.combat.round > 1); step++)
      nextInitiativeTurn(caster.state, events, turnDeps());
    return { ...caster, events };
  }
  const steer = (caster: ReturnType<typeof cloud>, to: readonly [number, number]) => {
    const moving = areaMoveOf(caster.action("spell-incendiary-cloud-then-steer"), catalog)!;
    const placed = { shape: "circle" as const, origin: cell(...to), target: cell(to[0] + 4, to[1]) };
    const move = planAreaMove(
      caster.state,
      {
        casterId: HERO,
        spell: moving.spell,
        feet: moving.feet,
        terms: moving.terms,
        placed,
        override: null,
        widthFeet: null
      },
      GRID
    );
    return moveArea(caster.state, move, placed, TABLE, { ...zoneDeps(), geometry: GRID }, moving.terms);
  };

  it("waits at its caster's turn start for the way the caster picks", () => {
    const { state, events } = cloud();
    expect(events.map((event) => event.text)).toContain(
      "Incendiary Cloud drifts 10 feet the way its caster picks, or straight away as its caster's turn ends."
    );
    expect(areaOf(state).geometry.origin).toEqual(cell(10, 10));
  });

  it("moves 10 feet the way its caster steers it, away from the caster", () => {
    const caster = cloud();
    steer(caster, [10, 12]);
    expect(areaOf(caster.state).geometry.origin).toEqual(cell(10, 12));
  });

  it("refuses a way that brings it closer to its caster, or a move of other than 10 feet", () => {
    const caster = cloud();
    expect(() => steer(caster, [8, 10])).toThrow(RulesBlockedError);
    expect(() => steer(caster, [14, 10])).toThrow(RulesBlockedError);
  });

  it("drifts straight away when its caster's turn ends unsteered", () => {
    const caster = cloud();
    nextInitiativeTurn(caster.state, [], turnDeps());
    expect(areaOf(caster.state).geometry.origin).toEqual(cell(12, 10));
  });
});

describe("Gust of Wind's strong wind", () => {
  const wizard = wizardAt(15, ["incendiary-cloud", "magic-missile"]);

  it("disperses a cloud it overlaps, ending its spell and its caster's Concentration", () => {
    const caster = fight(wizard);
    place(caster.state, { [HERO]: cell(0, 10), [FOE]: cell(30, 30), [FOE2]: cell(10, 2) });
    caster.resolve("spell-incendiary-cloud", { targetIds: [], commandId: CAST, areaPlaced: true });
    drawArea(caster.state, CAST, [10, 10], 4);
    standing(caster.state, "gust-of-wind", "gust", WIND, { shape: "line", sizeFeet: 60, widthFeet: 10 });
    drawArea(caster.state, WIND, [10, 3], 12, "line");
    const events = settleZoneOutcomes(caster.state, zoneDeps());
    expect(events.map((event) => event.text)).toContain("Gust of Wind disperses Incendiary Cloud.");
    expect(caster.state.combat.spellZones.map((zone) => zone.spellId)).toEqual(["gust-of-wind"]);
    expect(actor(caster.state, HERO).effects.some((effect) => effect.name.startsWith("Concentrating"))).toBe(false);
    expect(caster.state.combat.vision.areas).toEqual([]);
  });

  it("leaves an opaque wall standing in the wind", () => {
    const caster = fight(wizardAt(7, ["wall-of-fire", "magic-missile"]));
    place(caster.state, { [HERO]: cell(0, 10), [FOE]: cell(30, 30), [FOE2]: cell(40, 40) });
    caster.resolve("spell-wall-of-fire", { targetIds: [], commandId: CAST, areaPlaced: true });
    drawArea(caster.state, CAST, [10, 5], 10, "line");
    standing(caster.state, "gust-of-wind", "gust", WIND, { shape: "line", sizeFeet: 60, widthFeet: 10 });
    drawArea(caster.state, WIND, [5, 10], 12, "line");
    settleZoneOutcomes(caster.state, zoneDeps());
    expect(caster.state.combat.spellZones.map((zone) => zone.spellId).sort()).toEqual(["gust-of-wind", "wall-of-fire"]);
    expect(caster.state.combat.vision.areas).toHaveLength(1);
  });

  it("puts out a torch carried in the Line, and gives a lantern its one 50 percent chance", () => {
    const { state } = fight(build(wizardInput(["magic-missile"])));
    place(state, { [HERO]: cell(0, 0), [FOE]: cell(10, 6), [FOE2]: cell(40, 40) });
    standing(state, "gust-of-wind", "gust", WIND, { shape: "line", sizeFeet: 60, widthFeet: 10 });
    drawArea(state, WIND, [10, 3], 12, "line");
    carryLit(state, FOE, "torch", "Torch");
    carryLit(state, FOE, "hooded-lantern", "Hooded Lantern");
    settleZoneOutcomes(state, { ...zoneDeps(), rollDie: () => 2 });
    expect(lit(state, FOE, "torch")).toBe(false);
    expect(lit(state, FOE, "hooded-lantern")).toBe(true);
    // Its chance came and went: it doesn't roll again while it stays in the wind.
    settleZoneOutcomes(state, { ...zoneDeps(), rollDie: () => 1 });
    expect(lit(state, FOE, "hooded-lantern")).toBe(true);
  });
});

describe("Sleet Storm douses exposed flames", () => {
  it("puts out a burning creature and a carried torch in the Cylinder, and leaves a lantern lit", () => {
    const { state } = fight(build(wizardInput(["magic-missile"])));
    place(state, { [HERO]: cell(0, 0), [FOE]: cell(10, 10), [FOE2]: cell(30, 30) });
    standing(state, "sleet-storm", "save", CAST, { shape: "cylinder", sizeFeet: 20, widthFeet: null, heightFeet: 40 });
    drawArea(state, CAST, [10, 10], 4);
    setBurning(state, FOE);
    setBurning(state, FOE2);
    carryLit(state, FOE, "torch", "Torch");
    carryLit(state, FOE, "hooded-lantern", "Hooded Lantern");
    const events = settleZoneOutcomes(state, zoneDeps());
    expect(burning(state, FOE)).toBe(false);
    expect(burning(state, FOE2)).toBe(true);
    expect(lit(state, FOE, "torch")).toBe(false);
    expect(lit(state, FOE, "hooded-lantern")).toBe(true);
    expect(events.map((event) => event.text)).toContain("Sleet Storm puts out the fire on Goblin.");
  });
});

describe("Create or Destroy Water", () => {
  it("offers Create Water's rain or Destroy Water's fog as its cast's options", () => {
    const wizard = build(wizardInput(["magic-missile"]));
    expect(
      castOptionsOf(
        { id: "spell-create-or-destroy-water", spellId: "create-or-destroy-water" },
        view.spellRecord("create-or-destroy-water")
      ).options?.map((option) => option.id)
    ).toEqual(["create", "destroy"]);
    expect(wizard).toBeDefined();
  });

  it("rains over the Cube once, putting out the fire on a creature there", () => {
    const { state } = fight(build(wizardInput(["magic-missile"])));
    place(state, { [HERO]: cell(0, 0), [FOE]: cell(11, 11), [FOE2]: cell(30, 30) });
    standing(state, "create-or-destroy-water", "rain", CAST, { shape: "cube", sizeFeet: 30, widthFeet: null });
    drawArea(state, CAST, [10, 10], 6, "square");
    setBurning(state, FOE);
    settleZoneOutcomes(state, zoneDeps());
    expect(burning(state, FOE)).toBe(false);
    expect(state.combat.spellZones).toEqual([]);
  });

  it("destroys Fog Cloud's fog in the Cube, ending the spell", () => {
    const caster = fight(build(wizardInput(["fog-cloud", "magic-missile"])));
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(30, 30), [FOE2]: cell(40, 40) });
    caster.resolve("spell-fog-cloud", { targetIds: [], commandId: CAST, areaPlaced: true });
    drawArea(caster.state, CAST, [12, 12], 4);
    expect(caster.state.combat.vision.areas).toHaveLength(1);
    standing(caster.state, "create-or-destroy-water", "destroy-fog", WIND, {
      shape: "cube",
      sizeFeet: 30,
      widthFeet: null
    });
    drawArea(caster.state, WIND, [10, 10], 6, "square");
    settleZoneOutcomes(caster.state, zoneDeps());
    expect(caster.state.combat.vision.areas).toEqual([]);
    expect(actor(caster.state, HERO).effects.some((effect) => effect.name === "Concentrating on Fog Cloud")).toBe(
      false
    );
  });
});
