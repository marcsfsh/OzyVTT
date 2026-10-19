import { describe, expect, it } from "vitest";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import type { GameState } from "@vtt/domain";
import { addEffect, makeEffect, type EffectNarration } from "../src/effects.js";
import { nextInitiativeTurn } from "../src/encounter.js";
import { zonesAfterMove } from "../src/spell-zones.js";
import { movementCost } from "../src/terrain.js";
import { zoneMovementOptions } from "../src/zone-ground.js";
import { ALLY, build, druidInput, fight, FOE, FOE2, HERO, wizardInput } from "./spell-casters.js";
import {
  answer,
  cell,
  clericAt,
  drawArea,
  GRID,
  place,
  savesOf,
  turnDeps,
  wizardAt,
  zoneDeps
} from "./zone-fixtures.js";

// SRD 5.2.1 spells whose areas change the ground while they last: Difficult Terrain (Web, Entangle, Ice Storm's hail,
// Earthquake), 4 feet of movement for every foot (Plant Growth, Wall of Thorns), the ground difficult for enemies alone
// (Conjure Minor Elementals), and the creatures a kind of ground can't slow (Web Walker).

const CAST = "62000000-0000-4000-8000-000000000001";
const SPIDER = loadMonsterDefinitions().find((monster) => monster.source?.externalId === "giant-spider")!;
const resolveSpider = (definitionId: string) => (definitionId === "giant-spider" ? SPIDER : undefined);
const wizard = build(wizardInput(["web", "magic-missile"]));
const druid = build(druidInput(["plant-growth", "entangle"]));

/** What walking from one cell to another costs `actorId`, with the spell areas standing on the map. */
function costOf(
  state: GameState,
  actorId: string,
  from: readonly [number, number],
  to: readonly [number, number],
  resolveDefinition: (definitionId: string) => ReturnType<typeof resolveSpider> = () => undefined
) {
  const deps = { ...zoneDeps(), resolveDefinition };
  return movementCost(state, GRID, actorId, cell(...from), cell(...to), {
    resolveDefinition,
    ...zoneMovementOptions(state, actorId, deps)
  })!.feet;
}

describe("Web: the webs are Difficult Terrain", () => {
  function webbed() {
    const caster = fight(wizard);
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(3, 6), [FOE2]: cell(3, 2) });
    caster.resolve("spell-web", { targetIds: [], commandId: CAST, areaPlaced: true });
    // A 20-foot Cube: cells 5 to 8 on both axes.
    drawArea(caster.state, CAST, [5, 5], 4, "square");
    return caster;
  }

  it("costs double for each step into the webs", () => {
    const { state } = webbed();
    // Three steps across the webs: 3 x 10.
    expect(costOf(state, FOE, [5, 6], [8, 6])).toBe(30);
    expect(costOf(state, FOE, [3, 2], [3, 4])).toBe(10);
  });

  it("neither slows nor holds a Web Walker", () => {
    const { state } = webbed();
    state.actors.find((actor) => actor.id === FOE2)!.definitionId = "giant-spider";
    expect(costOf(state, FOE2, [5, 6], [8, 6], resolveSpider)).toBe(15);
    state.combat.tokens = state.combat.tokens.map((token) =>
      token.actorId === FOE2 ? { ...token, position: cell(6, 6) } : token
    );
    const met = zonesAfterMove(
      state,
      { moverId: FOE2, path: [cell(3, 6), cell(6, 6)] },
      { ...zoneDeps(), resolveDefinition: resolveSpider }
    );
    expect(met).toEqual([]);
    expect(savesOf(state, FOE2)).toEqual([]);
  });

  it("ends its ground with the spell", () => {
    const { state, hero } = webbed();
    hero.effects = hero.effects.filter((effect) => !effect.concentration);
    expect(costOf(state, FOE, [5, 6], [8, 6])).toBe(15);
  });
});

describe("Plant Growth: 4 feet of movement for every foot", () => {
  it("charges each step through the overgrowth four times over, and the overgrowth stays", () => {
    const caster = fight(druid);
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(10, 10), [FOE2]: cell(40, 40) });
    caster.resolve("spell-plant-growth", { targetIds: [], commandId: CAST, areaPlaced: true });
    drawArea(caster.state, CAST, [20, 20], 20);
    expect(caster.state.combat.spellZones).toEqual([
      expect.objectContaining({ spellId: "plant-growth", effectId: `${CAST}:spell` })
    ]);
    // Two steps inside the Sphere: 20 feet each.
    expect(costOf(caster.state, FOE, [10, 10], [10, 12])).toBe(40);
    expect(caster.hero.effects.find((effect) => effect.id === `${CAST}:spell`)?.duration).toEqual({ type: "manual" });
  });
});

describe("Entangle: the plants make the square Difficult Terrain for the duration", () => {
  it("charges double inside the square while the caster concentrates", () => {
    const caster = fight(druid);
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(3, 6), [FOE2]: cell(20, 20) });
    caster.resolve("spell-entangle", { targetIds: [], commandId: CAST, areaPlaced: true });
    drawArea(caster.state, CAST, [5, 5], 4, "square");
    expect(costOf(caster.state, FOE, [3, 6], [5, 6])).toBe(15);
  });

  it("puts no Entangle action on the sheet for its ground", () => {
    expect(druid.actions.some((action) => action.id === "spell-entangle-then-ground")).toBe(false);
  });
});

describe("a zone that only an enemy finds difficult", () => {
  it("Conjure Minor Elementals: the Emanation is Difficult Terrain for the caster's enemies alone", () => {
    const caster = fight(druid, { ally: true });
    place(caster.state, { [HERO]: cell(10, 10), [FOE]: cell(10, 15), [ALLY]: cell(15, 10), [FOE2]: cell(40, 40) });
    caster.state.combat.spellZones = [
      {
        id: CAST,
        spellId: "conjure-minor-elementals",
        name: "Conjure Minor Elementals",
        laterActionId: "spell-conjure-minor-elementals-then-ground",
        casterId: HERO,
        castId: "cme",
        rounds: null,
        startedRound: 1,
        level: 4,
        dc: 15,
        annotationId: null,
        area: null,
        damageDealt: 0,
        entered: [],
        affected: []
      }
    ];
    addEffect(
      caster.state,
      HERO,
      makeEffect({
        id: "cme:concentration",
        name: "Concentrating on Conjure Minor Elementals",
        tags: ["concentrating"],
        concentration: true,
        castId: "cme",
        duration: { type: "rounds", remaining: 100 }
      })
    );
    // Two steps inside the 15-foot Emanation.
    expect(costOf(caster.state, FOE, [10, 14], [10, 12])).toBe(20);
    expect(costOf(caster.state, ALLY, [14, 10], [12, 10])).toBe(10);
  });
});

describe("Ice Storm: the hail's Difficult Terrain until the end of the caster's next turn", () => {
  it("opens the ground with the cast and clears it as the caster's next turn ends", () => {
    const caster = fight(wizardAt(7, ["ice-storm"]));
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(10, 10), [FOE2]: cell(40, 40) });
    caster.resolve("spell-ice-storm", { targetIds: [], commandId: CAST, areaPlaced: true }, [1, 1, 1, 1, 1, 1]);
    drawArea(caster.state, CAST, [10, 10], 4);
    expect(caster.state.combat.spellZones).toEqual([
      expect.objectContaining({ spellId: "ice-storm", effectId: `${CAST}:spell` })
    ]);
    expect(caster.hero.effects.find((effect) => effect.id === `${CAST}:spell`)?.duration).toEqual({
      type: "until-source-turn-end",
      skipsCurrentTurn: true
    });
    expect(costOf(caster.state, FOE, [10, 10], [10, 12])).toBe(20);
    const step = () => nextInitiativeTurn(caster.state, [], turnDeps());
    // The caster's own turn ends, then the foes', then the caster's next.
    step();
    expect(costOf(caster.state, FOE, [10, 10], [10, 12])).toBe(20);
    step();
    step();
    step();
    expect(costOf(caster.state, FOE, [10, 10], [10, 12])).toBe(10);
    expect(caster.state.combat.spellZones).toEqual([]);
  });
});

describe("Earthquake", () => {
  const cleric = clericAt(15, ["earthquake"]);
  const DC = cleric.actions.find((action) => action.id === "spell-earthquake")!.save!.dc;

  /** The foe concentrating on a spell of its own, and the cleric's Earthquake cast over it. */
  function quake() {
    const caster = fight(cleric);
    place(caster.state, { [HERO]: cell(40, 0), [FOE]: cell(10, 10), [FOE2]: cell(55, 55) });
    addEffect(
      caster.state,
      FOE,
      makeEffect({
        id: "foe:concentration",
        name: "Concentrating on Bless",
        tags: ["concentrating"],
        concentration: true,
        castId: "foe-bless",
        sourceActorId: FOE,
        duration: { type: "rounds", remaining: 10 }
      })
    );
    const cast = caster.resolve("spell-earthquake", { targetIds: [FOE], commandId: CAST, areaPlaced: true });
    // The 100-foot-radius circle.
    drawArea(caster.state, CAST, [12, 12], 20);
    return { ...caster, cast };
  }

  it("places its 100-foot-radius circle and makes its ground Difficult Terrain", () => {
    const { state, cast } = quake();
    expect(cleric.actions.find((action) => action.id === "spell-earthquake")!.area).toEqual({
      shape: "cylinder",
      sizeFeet: 100,
      widthFeet: null
    });
    expect(cast.save?.targets.map((target) => target.targetId)).toEqual([FOE]);
    expect(costOf(state, FOE, [10, 10], [10, 12])).toBe(20);
  });

  it("breaks Concentration with the cast's own save, and leaves the creature Prone", () => {
    const { state } = quake();
    expect(savesOf(state, FOE)).toEqual([
      expect.objectContaining({ ability: "dex", conditionIds: ["prone"], breaksConcentration: true })
    ]);
    answer(state, FOE, 1);
    const goblin = state.actors.find((actor) => actor.id === FOE)!;
    expect(goblin.conditions.map((condition) => condition.id)).toContain("prone");
    expect(goblin.effects.some((effect) => effect.concentration)).toBe(false);
  });

  it("asks each creature in the area for the save again as the caster's turn ends", () => {
    const { state } = quake();
    state.combat.pendingSaves = [];
    const events: EffectNarration[] = [];
    nextInitiativeTurn(state, events, turnDeps());
    expect(events.map((event) => event.text)).toContain(
      `Goblin is caught in Earthquake and makes a DEX save (DC ${DC}).`
    );
    expect(savesOf(state, FOE)).toEqual([
      expect.objectContaining({ ability: "dex", conditionIds: ["prone"], breaksConcentration: true })
    ]);
    // The caster stands outside its own circle, and the far foe is out of it.
    expect(savesOf(state, HERO)).toEqual([]);
    expect(savesOf(state, FOE2)).toEqual([]);
  });
});
