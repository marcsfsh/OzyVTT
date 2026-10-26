import { describe, expect, it } from "vitest";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { moveAnnotation } from "../src/annotations.js";
import { endEffect } from "../src/effects.js";
import { zonesAfterAreaMove } from "../src/spell-zones.js";
import { build, catalog, fight, FOE, FOE2, HERO, wizardInput } from "./spell-casters.js";
import { answer, cell, drawArea, GRID, nextId, place, savesOf, walk, zoneDeps } from "./zone-fixtures.js";

// SRD 5.2.1 Djinni, Create Whirlwind: "The whirlwind lasts until the djinni's Concentration on it ends. The djinni can
// move the whirlwind up to 20 feet at the start of each of its turns. Whenever the whirlwind enters a creature's space or
// a creature enters the whirlwind, that creature is subjected to the following effect. Strength Saving Throw: DC 17 (a
// creature makes this save only once per turn, and the djinni is unaffected). Failure: While in the whirlwind, the target
// has the Restrained condition and moves with the whirlwind."

const WHIRLWIND = "6e000000-0000-4000-8000-000000000001";
const djinni: ActorDefinition = loadMonsterDefinitions().find((entry) => entry.source?.externalId === "djinni")!;
const whirlwind = djinni.actions.find((action) => action.id === "create-whirlwind")!;
const actorOf = (state: GameState, id: string) => state.actors.find((actor) => actor.id === id)!;
const at = (state: GameState, id: string) => state.combat.tokens.find((token) => token.actorId === id)!.position;

/** The goblin is a djinni at (0,0); its whirlwind is conjured on the hero at (10,10) and the orc beside it. */
function conjured() {
  const { state } = fight(build(wizardInput(["magic-missile"])));
  actorOf(state, FOE).definitionId = "djinni";
  place(state, { [FOE]: cell(0, 0), [HERO]: cell(10, 10), [FOE2]: cell(11, 10) });
  state.combat.turnActorId = FOE;
  resolveDefinitionAction(
    state,
    whirlwind,
    { actorId: FOE, targetIds: [HERO, FOE2], commandId: WHIRLWIND, areaPlaced: true },
    {
      random: () => 10,
      newRollId: nextId,
      gmSessionId: "30000000-0000-4000-8000-00000000000a",
      now: () => "2026-10-19T00:00:00.000Z",
      definition: djinni,
      catalog,
      resolveDefinition: (id) => (id === "djinni" ? djinni : undefined)
    }
  );
  drawArea(state, WHIRLWIND, [10, 10], 4);
  return state;
}

describe("a djinni's whirlwind", () => {
  it("holds the djinni's Concentration and puts the save to the creatures it appears on", () => {
    const state = conjured();
    expect(actorOf(state, FOE).effects.map((effect) => effect.name)).toContain("Concentrating on Create Whirlwind");
    expect(savesOf(state, HERO)).toEqual([expect.objectContaining({ ability: "str", dc: 17 })]);
    expect(savesOf(state, FOE2)).toEqual([expect.objectContaining({ ability: "str", dc: 17 })]);
  });

  it("carries the creature it Restrained when it moves, and leaves the one that saved", () => {
    const state = conjured();
    answer(state, HERO, 1);
    answer(state, FOE2, 30);
    expect(actorOf(state, HERO).conditions.map((condition) => condition.id)).toContain("restrained");
    const before = state.combat.annotations.find((annotation) => annotation.id === WHIRLWIND)!.geometry;
    moveAnnotation(
      state,
      WHIRLWIND,
      cell(14, 10),
      cell(18, 10),
      { role: "gm", sessionId: "30000000-0000-4000-8000-00000000000a" },
      GRID
    );
    const events = zonesAfterAreaMove(state, WHIRLWIND, before, zoneDeps());
    expect(events.map((event) => event.text)).toContain("Create Whirlwind carries Ansel with it.");
    expect(at(state, HERO)).toEqual(cell(14, 10));
    expect(at(state, FOE2)).toEqual(cell(11, 10));
    // Carried along inside it, the hero makes no new save.
    expect(savesOf(state, HERO)).toEqual([]);
  });

  it("puts the save to a creature walking into it once that turn, and spares the djinni", () => {
    const state = conjured();
    answer(state, HERO, 30);
    answer(state, FOE2, 30);
    // A new turn: the orc, out of it, walks in, out and in again.
    state.combat.spellZones[0]!.affected = [];
    state.combat.spellZones[0]!.entered = [];
    place(state, { [FOE2]: cell(20, 10) });
    walk(state, FOE2, [
      [20, 10],
      [12, 10]
    ]);
    walk(state, FOE2, [
      [12, 10],
      [20, 10],
      [12, 10]
    ]);
    expect(savesOf(state, FOE2)).toHaveLength(1);
    walk(state, FOE, [
      [0, 0],
      [10, 9]
    ]);
    expect(savesOf(state, FOE)).toEqual([]);
  });

  it("ends with the djinni's Concentration, freeing the creature it held", () => {
    const state = conjured();
    answer(state, HERO, 1);
    endEffect(state, FOE, `${WHIRLWIND}:concentration`);
    expect(state.combat.spellZones.filter((zone) => zone.id === WHIRLWIND && !zone.bursting)).toEqual([]);
    expect(actorOf(state, HERO).conditions.map((condition) => condition.id)).not.toContain("restrained");
  });
});
