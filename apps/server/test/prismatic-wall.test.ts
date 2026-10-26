import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import { setCondition } from "../src/actor-conditions.js";
import { zonesAtTurnStart } from "../src/spell-zones.js";
import { ALLY, fight, FOE, HERO } from "./spell-casters.js";
import { cell, drawArea, place, savesOf, walk, wizardAt, zoneDeps } from "./zone-fixtures.js";

// SRD 5.2.1 Prismatic Wall: "If another creature that can see the wall moves within 20 feet of it or starts its turn
// there, the creature must succeed on a Constitution saving throw or have the Blinded condition for 1 minute", "When a
// creature reaches into or passes through the wall, it does so one layer at a time through all the layers. Each layer
// forces the creature to make a Dexterity saving throw", and "If you position the wall in a space occupied by a
// creature, the spell ends instantly without effect."

const CAST = "66000000-0000-4000-8000-0000000000c1";
const GM = { role: "gm" } as const;

/** The wizard's wall down column 10 from row 5 to row 15; the goblin 15 feet east of it, an ally 10 feet west. */
function walled() {
  const caster = fight(wizardAt(17, ["prismatic-wall"]), { ally: true });
  caster.state.actors.find((actor) => actor.id === ALLY)!.kind = "player-character";
  place(caster.state, { [HERO]: cell(2, 2), [FOE]: cell(13, 10), [ALLY]: cell(8, 10) });
  caster.resolve("spell-prismatic-wall", { targetIds: [], commandId: CAST, areaPlaced: true });
  drawArea(caster.state, CAST, [10, 5], 10, "line");
  return caster;
}

const glare = (state: GameState, actorId: string) =>
  savesOf(state, actorId).filter((save) => save.actionName === "Prismatic Wall");

describe("Prismatic Wall", () => {
  it("asks a creature that sees it and starts its turn within 20 feet for the Constitution save against Blinded", () => {
    const { state } = walled();
    zonesAtTurnStart(state, FOE, zoneDeps());
    expect(glare(state, FOE)).toEqual([expect.objectContaining({ ability: "con", conditionIds: ["blinded"] })]);
  });

  it("spares a creature that can't see it, and the caster's ally", () => {
    const { state } = walled();
    setCondition(state, FOE, "blinded", true, undefined, GM);
    zonesAtTurnStart(state, FOE, zoneDeps());
    zonesAtTurnStart(state, ALLY, zoneDeps());
    expect(glare(state, FOE)).toEqual([]);
    expect(glare(state, ALLY)).toEqual([]);
  });

  it("makes a creature passing through it save against each of its seven layers in order", () => {
    const { state } = walled();
    walk(state, FOE, [
      [13, 10],
      [12, 10],
      [11, 10],
      [10, 10],
      [9, 10]
    ]);
    const layers = savesOf(state, FOE).filter((save) => save.actionName.includes("layer"));
    expect(layers.map((save) => save.actionName)).toEqual([
      "Prismatic Wall (Red layer)",
      "Prismatic Wall (Orange layer)",
      "Prismatic Wall (Yellow layer)",
      "Prismatic Wall (Green layer)",
      "Prismatic Wall (Blue layer)",
      "Prismatic Wall (Indigo layer)",
      "Prismatic Wall (Violet layer)"
    ]);
    expect(layers.every((save) => save.ability === "dex")).toBe(true);
    expect(layers[0]).toMatchObject({ halfOnSuccess: true, proposedDamageParts: [{ type: "fire" }] });
    expect(layers[5]).toMatchObject({ conditionIds: ["restrained"] });
    expect(layers[6]).toMatchObject({ conditionIds: ["blinded"] });
  });

  it("fails when placed through a creature's space", () => {
    const caster = fight(wizardAt(17, ["prismatic-wall"]));
    place(caster.state, { [HERO]: cell(2, 2), [FOE]: cell(10, 10) });
    caster.state.combat.vision = {
      ...caster.state.combat.vision,
      measure: { width: 3000, height: 3000, pixelsPerFoot: 10 }
    };
    expect(() =>
      caster.resolve("spell-prismatic-wall", {
        targetIds: [],
        commandId: CAST,
        areaPlaced: true,
        placedArea: { shape: "line", origin: cell(10, 5), target: cell(10, 15) }
      })
    ).toThrowError(/can't stand in Goblin's space/);
  });
});
