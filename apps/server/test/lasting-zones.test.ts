import { describe, expect, it } from "vitest";
import type { GameState, SpellZone } from "@vtt/domain";
import { endEffect } from "../src/effects.js";
import { endEncounter, startEncounter } from "../src/encounter.js";
import { endEncounterEffects } from "../src/effects.js";
import { passGameTime } from "../src/game-time.js";
import { burstEndedZones, endZoneAndItsSpell, pruneEndedZones } from "../src/spell-zones.js";
import { build, clericInput, druidInput, fight, FOE, FOE2, HERO } from "./spell-casters.js";
import { cell, drawArea, GRID, MAP, place, savesOf, walk, zoneDeps } from "./zone-fixtures.js";

// SRD 5.2.1 spells whose areas last: an area cast outside a fight acts there as it does in one, and an area outlasts a
// fight, or is carried into one, for as long as the Concentration or the duration that keeps it.

const CAST = "61000000-0000-4000-8000-000000000001";
const cleric = build(clericInput(["zone-of-truth", "spirit-guardians"]));
const druid = build(druidInput(["moonbeam"]));

/** Casts `actionId` with its area drawn at `center`, `radius` cells. */
function castArea(
  caster: ReturnType<typeof fight>,
  actionId: string,
  center: readonly [number, number],
  radius: number
) {
  const resolution = caster.resolve(actionId, { targetIds: [], commandId: CAST, areaPlaced: true });
  drawArea(caster.state, CAST, center, radius);
  return resolution;
}

const restartFight = (state: GameState, mapAssetId = MAP) =>
  startEncounter(
    state,
    {
      mapAssetId,
      entries: [
        { actorId: HERO, score: 20 },
        { actorId: FOE, score: 10 },
        { actorId: FOE2, score: 9 }
      ]
    },
    () => 10,
    GRID
  );

describe("an area cast outside a fight", () => {
  function zoneOfTruth() {
    const caster = fight(cleric, { combat: false });
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(10, 5), [FOE2]: cell(20, 20) });
    castArea(caster, "spell-zone-of-truth", [5, 5], 3);
    return caster;
  }

  it("leaves its zone on the map, kept by the spell's 10 minutes on its caster", () => {
    const { state, hero } = zoneOfTruth();
    expect(state.combat.active).toBe(false);
    expect(state.combat.spellZones).toEqual([
      expect.objectContaining({ id: CAST, spellId: "zone-of-truth", castId: null, effectId: `${CAST}:spell` })
    ]);
    expect(hero.effects).toContainEqual(
      expect.objectContaining({ id: `${CAST}:spell`, duration: { type: "rounds", remaining: 100 } })
    );
  });

  it("asks a creature the GM moves into it for the save, each time it comes in", () => {
    const { state } = zoneOfTruth();
    const entering = walk(state, FOE, [
      [10, 5],
      [9, 5],
      [8, 5]
    ]);
    expect(entering.map((event) => event.text)).toEqual(["Goblin enters Zone of Truth and makes a CHA save (DC 15)."]);
    // Moving about inside isn't entering it again.
    expect(
      walk(state, FOE, [
        [8, 5],
        [7, 5]
      ])
    ).toEqual([]);
    walk(state, FOE, [
      [7, 5],
      [12, 5]
    ]);
    walk(state, FOE, [
      [12, 5],
      [8, 5]
    ]);
    expect(savesOf(state, FOE)).toHaveLength(2);
  });

  it("is carried into a fight on the same map, with the shape it stands on", () => {
    const { state } = zoneOfTruth();
    restartFight(state);
    expect(state.combat.spellZones.map((zone) => zone.id)).toEqual([CAST]);
    expect(state.combat.annotations.map((annotation) => annotation.id)).toEqual([CAST]);
  });

  it("stays behind when the fight starts on another map", () => {
    const { state } = zoneOfTruth();
    restartFight(state, "20000000-0000-5000-8000-000000000009");
    expect(state.combat.spellZones).toEqual([]);
    expect(state.combat.annotations).toEqual([]);
  });

  it("ends with its 10 minutes on the game clock, and its shape leaves the map", () => {
    const { state } = zoneOfTruth();
    passGameTime(state, 9);
    expect(state.combat.spellZones).toHaveLength(1);
    const ended = passGameTime(state, 1);
    expect(ended.map((event) => event.text)).toContain("Zone of Truth ends.");
    expect(state.combat.spellZones).toEqual([]);
    expect(state.combat.annotations).toEqual([]);
  });

  it("ends with the spell when the GM ends the area", () => {
    const { state, hero } = zoneOfTruth();
    endZoneAndItsSpell(state, CAST);
    expect(state.combat.spellZones).toEqual([]);
    expect(hero.effects.some((effect) => effect.id === `${CAST}:spell`)).toBe(false);
  });
});

describe("an area cast in a fight, when the fight ends", () => {
  it("outlasts it while the duration that keeps it has more than a minute left", () => {
    const caster = fight(cleric);
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(10, 5), [FOE2]: cell(20, 20) });
    castArea(caster, "spell-zone-of-truth", [5, 5], 3);
    endEncounterEffects(caster.state, [HERO, FOE, FOE2]);
    endEncounter(caster.state);
    expect(caster.state.combat.spellZones).toHaveLength(1);
    expect(caster.state.combat.annotations.map((annotation) => annotation.id)).toContain(CAST);
  });

  it("ends with a Concentration of a minute, which the fight's end ends", () => {
    const caster = fight(druid);
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(10, 5), [FOE2]: cell(20, 20) });
    castArea(caster, "spell-moonbeam", [5, 5], 1);
    endEncounterEffects(caster.state, [HERO, FOE, FOE2]);
    endEncounter(caster.state);
    pruneEndedZones(caster.state);
    expect(caster.state.combat.spellZones).toEqual([]);
    expect(caster.state.combat.annotations).toEqual([]);
  });
});

describe("an area that acts as its spell ends, outside a fight", () => {
  it("bursts when its caster's Concentration ends", () => {
    const caster = fight(druid, { combat: false });
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(5, 5), [FOE2]: cell(20, 20) });
    caster.resolve("spell-moonbeam", { targetIds: [], commandId: "moonbeam-cast", areaPlaced: true });
    const concentration = caster.hero.effects.find((effect) => effect.concentration)!;
    const bead: SpellZone = {
      id: CAST,
      spellId: "delayed-blast-fireball",
      name: "Delayed Blast Fireball",
      laterActionId: "spell-delayed-blast-fireball-then-explosion",
      casterId: HERO,
      castId: concentration.castId!,
      rounds: null,
      startedRound: 1,
      level: 7,
      dc: 15,
      annotationId: CAST,
      area: { shape: "sphere", sizeFeet: 20, widthFeet: null },
      damageDealt: 0,
      burstsOnEnd: true,
      entered: [],
      affected: []
    };
    caster.state.combat.spellZones = [bead];
    drawArea(caster.state, CAST, [5, 5], 4);
    endEffect(caster.state, HERO, concentration.id);
    expect(caster.state.combat.spellZones).toEqual([expect.objectContaining({ id: CAST, bursting: true })]);
    const events = burstEndedZones(caster.state, zoneDeps());
    expect(events.map((event) => event.text)).toEqual([
      "Delayed Blast Fireball explodes: Goblin makes a DEX save (DC 15)."
    ]);
    expect(savesOf(caster.state, FOE)).toHaveLength(1);
  });
});
