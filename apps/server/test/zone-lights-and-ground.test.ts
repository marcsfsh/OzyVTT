import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import type { EffectNarration } from "../src/effects.js";
import { nextInitiativeTurn } from "../src/encounter.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { castOptionsOf, zonesAtTurnEnd } from "../src/spell-zones.js";
import { movementCost } from "../src/terrain.js";
import { igniteUnder } from "../src/zone-fire.js";
import { zoneMovementOptions } from "../src/zone-ground.js";
import { leaveOut } from "../src/zone-later.js";
import { settleZoneOutcomes } from "../src/zone-outcomes.js";
import { ALLY, build, druidInput, fight, FOE, FOE2, HERO, heroTurnAgain, view, wizardInput } from "./spell-casters.js";
import { cell, clericAt, drawArea, GRID, hpOf, place, savesOf, turnDeps, zoneDeps } from "./zone-fixtures.js";

// SRD 5.2.1: Conjure Celestial ("For each creature you can see in the Cylinder, choose which of these lights shines on
// it": Healing Light or Searing Light, and again when a creature enters it or ends its turn there), Web ("Any 5-foot
// Cube of webs exposed to fire burns away in 1 round, dealing 2d4 Fire damage to any creature that starts its turn in
// the fire"), Plant Growth ("You can exclude one or more areas of any size within the spell's area from being
// affected") and Speak with Plants ("turn Difficult Terrain caused by plant growth ... into ordinary terrain").

const CAST = "6c000000-0000-4000-8000-000000000001";
const texts = (events: readonly EffectNarration[]) => events.map((event) => event.text);
const costOf = (state: GameState, actorId: string, from: readonly [number, number], to: readonly [number, number]) =>
  movementCost(state, GRID, actorId, cell(...from), cell(...to), zoneMovementOptions(state, actorId, zoneDeps()))!.feet;

describe("Conjure Celestial's lights", () => {
  const cleric = clericAt(15, ["conjure-celestial"]);

  /** The cleric's pillar over its ally and a goblin; the orc waits outside it. */
  function pillar(option = "by-side", slotLevel?: number) {
    const caster = fight(cleric, { ally: true });
    caster.state.actors.find((actor) => actor.id === ALLY)!.kind = "player-character";
    caster.state.actors.find((actor) => actor.id === ALLY)!.hp.current = 100;
    place(caster.state, { [HERO]: cell(0, 0), [ALLY]: cell(10, 10), [FOE]: cell(11, 10), [FOE2]: cell(20, 10) });
    caster.resolve(
      "spell-conjure-celestial",
      {
        targetIds: [ALLY, FOE],
        commandId: CAST,
        areaPlaced: true,
        option,
        ...(slotLevel ? { slotLevel } : {})
      },
      Array(40).fill(6)
    );
    drawArea(caster.state, CAST, [10, 10], 2);
    return caster;
  }

  it("offers its lights by side or one light for all as the cast's options", () => {
    const options = castOptionsOf(
      { id: "spell-conjure-celestial", spellId: "conjure-celestial" },
      view.spellRecord("conjure-celestial")
    ).options!;
    expect(options.map((option) => option.id)).toEqual(["by-side", "heal-all", "sear-all"]);
  });

  it("heals the caster's ally with Healing Light and puts the save to the goblin with Searing Light", () => {
    const { state } = pillar();
    // 4d12 at 6 each, plus the cleric's Wisdom modifier.
    expect(hpOf(state, ALLY)).toBeGreaterThan(100 + 24);
    expect(savesOf(state, FOE)).toEqual([expect.objectContaining({ ability: "dex", proposedDamage: 36 })]);
    expect(savesOf(state, ALLY)).toEqual([]);
  });

  it("bathes a creature that ends its turn in the Cylinder", () => {
    const { state } = pillar();
    state.combat.tokens = state.combat.tokens.map((token) =>
      token.actorId === FOE2 ? { ...token, position: cell(9, 10) } : token
    );
    zonesAtTurnEnd(state, FOE2, zoneDeps(Array(10).fill(6)));
    expect(savesOf(state, FOE2)).toEqual([expect.objectContaining({ ability: "dex" })]);
  });

  it("gains a die of light for each slot level above 7", () => {
    const { state } = pillar("sear-all", 8);
    expect(savesOf(state, FOE)).toEqual([expect.objectContaining({ proposedDamage: 42 })]);
    expect(savesOf(state, ALLY)).toEqual([expect.objectContaining({ proposedDamage: 42 })]);
  });
});

describe("Web burns", () => {
  const wizard = build(wizardInput(["web", "magic-missile"]));

  /** A 20-foot Cube of webs over cells (10,10) to (13,13); the goblin and the orc stand in it. */
  function webs(combat = true) {
    const caster = fight(wizard, { combat });
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(11, 11), [FOE2]: cell(12, 12) });
    caster.resolve("spell-web", { targetIds: [], commandId: CAST, areaPlaced: true });
    drawArea(caster.state, CAST, [10, 10], 4, "square");
    return caster;
  }
  const fireball = { shape: "circle" as const, origin: cell(11, 11), target: cell(15, 11), widthFeet: null };

  it("catches fire where Fire damage lands on a creature in it", () => {
    const { state } = webs();
    applyDamageDetailed(
      state,
      FOE,
      { amount: 5, parts: [{ amount: 5, type: "fire" }] },
      { role: "gm" },
      { resolveDefinition: () => undefined, newId: () => "x", now: () => "2026-10-19T00:00:00.000Z" }
    );
    const events = settleZoneOutcomes(state, zoneDeps());
    expect(texts(events)).toContain("Fire catches Web, and it burns.");
    expect(state.combat.spellZones[0]!.burning?.[0]?.cells).toEqual(["11,11"]);
  });

  it("burns a creature starting its turn in the fire, then burns away with its spell after a round", () => {
    const { state } = webs();
    igniteUnder(state, fireball, zoneDeps());
    const events: EffectNarration[] = [];
    nextInitiativeTurn(state, events, turnDeps([2, 2, 2, 2, 2, 2, 2, 2]));
    expect(texts(events)).toContain("Goblin starts its turn in burning Web and takes 4 Fire damage.");
    // The round comes back to where the fire caught: the webs are gone, and so is the spell.
    const ended: EffectNarration[] = [];
    while (state.combat.turnActorId !== HERO) nextInitiativeTurn(state, ended, turnDeps([2, 2, 2, 2]));
    expect(texts(ended)).toContain("Web burns away.");
    expect(state.combat.spellZones).toEqual([]);
    expect(
      state.actors.find((actor) => actor.id === HERO)!.effects.some((effect) => effect.name === "Concentrating on Web")
    ).toBe(false);
  });

  it("burns away at once outside a fight", () => {
    const { state } = webs(false);
    igniteUnder(state, { ...fireball, target: cell(12, 11) }, zoneDeps());
    expect(state.combat.spellZones[0]!.cut?.length).toBeGreaterThan(0);
    expect(state.combat.spellZones[0]!.burning ?? []).toEqual([]);
  });
});

describe("Plant Growth: ground left out of the overgrowth", () => {
  const druid = build(druidInput(["plant-growth"]));

  function overgrowth() {
    const caster = fight(druid);
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(10, 10), [FOE2]: cell(40, 40) });
    caster.resolve("spell-plant-growth", { targetIds: [], commandId: CAST, areaPlaced: true });
    drawArea(caster.state, CAST, [10, 10], 8);
    return caster;
  }

  it("costs the usual movement in a square its caster left out, and 4 feet a foot elsewhere", () => {
    const { state } = overgrowth();
    leaveOut(
      state,
      {
        casterId: HERO,
        spell: view.spellRecord("plant-growth")!,
        placed: { shape: "square", origin: { x: 500, y: 500 }, target: { x: 600, y: 600 } }
      },
      zoneDeps()
    );
    expect(costOf(state, FOE, [10, 10], [11, 11])).toBe(5);
    expect(costOf(state, FOE, [10, 10], [9, 9])).toBe(20);
  });

  it("is left out only as it is cast", () => {
    const { state } = overgrowth();
    heroTurnAgain(state);
    expect(() =>
      leaveOut(
        state,
        {
          casterId: HERO,
          spell: view.spellRecord("plant-growth")!,
          placed: { shape: "square", origin: { x: 500, y: 500 }, target: { x: 600, y: 600 } }
        },
        zoneDeps()
      )
    ).toThrow(/as it is cast/);
  });
});

describe("Speak with Plants: the ground of its Emanation", () => {
  const druid = build(druidInput(["speak-with-plants"]));

  function plants(option: string) {
    const caster = fight(druid);
    place(caster.state, { [HERO]: cell(10, 10), [FOE]: cell(12, 10), [FOE2]: cell(40, 40) });
    caster.state.combat.terrain.difficult = [{ x: 600, y: 450, width: 150, height: 150 }];
    caster.resolve("spell-speak-with-plants", { targetIds: [], commandId: CAST, option });
    return caster;
  }

  it("clears the painted thicket within 30 feet into ordinary ground while it lasts", () => {
    const { state } = plants("clearing");
    expect(costOf(state, FOE, [12, 10], [13, 10])).toBe(5);
    state.combat.spellZones = [];
    expect(costOf(state, FOE, [12, 10], [13, 10])).toBe(10);
  });

  it("makes the ground within 30 feet Difficult Terrain", () => {
    const { state } = plants("thicket");
    expect(costOf(state, FOE, [12, 10], [11, 10])).toBe(10);
  });
});
