import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import { RulesBlockedError } from "../src/game-store.js";
import { passiveOf } from "../src/availability-reasons.js";
import { zoneRowOf } from "../src/spell-zones.js";
import { settleZoneAuras } from "../src/zone-auras.js";
import { areaMoveOf, moveArea, planAreaMove } from "../src/zone-moves.js";
import {
  build,
  catalog,
  druidInput,
  fight,
  FOE,
  FOE2,
  HERO,
  heroTurnAgain,
  view,
  wizardInput
} from "./spell-casters.js";
import { cell, drawArea, GRID, place, savesOf, walk, wizardAt, zoneDeps } from "./zone-fixtures.js";

// SRD 5.2.1 areas moved by what the spell lets its caster do: Silent Image's and Major Image's illusions ("move to any
// spot within range"), Faithful Hound ("a Magic action to move the hound up to 30 feet"; it barks at a creature that
// comes within 30 feet and ends when its caster is more than 300 feet away), and Conjure Animals' pack ("when you move on
// your turn, you can also move the pack up to 30 feet to an unoccupied space"; "Advantage on Strength saving throws
// while you're within 5 feet of the pack").

const CAST = "68000000-0000-4000-8000-000000000001";
const TABLE = { sessionId: "30000000-0000-4000-8000-00000000000a", role: "gm" } as const;
const square = (corner: readonly [number, number], cells: number) => ({
  shape: "square" as const,
  origin: { x: 50 * corner[0], y: 50 * corner[1] },
  target: { x: 50 * (corner[0] + cells), y: 50 * (corner[1] + cells) }
});
const circleAt = (center: readonly [number, number], radius: number) => ({
  shape: "circle" as const,
  origin: cell(...center),
  target: cell(center[0] + radius, center[1])
});
const areaOf = (state: GameState) => state.combat.annotations.find((annotation) => annotation.id === CAST)!;
const moveTo = (state: GameState, actorId: string, at: readonly [number, number]) => {
  state.combat.tokens = state.combat.tokens.map((token) =>
    token.actorId === actorId ? { ...token, position: cell(...at) } : token
  );
};

/** Plans the later action's move of the area to `placed`, as the table's resolve does. */
function plan(
  caster: ReturnType<typeof fight>,
  actionId: string,
  placed: ReturnType<typeof circleAt> | ReturnType<typeof square>
) {
  const moving = areaMoveOf(caster.action(actionId), catalog)!;
  return {
    moving,
    move: planAreaMove(
      caster.state,
      {
        casterId: HERO,
        spell: moving.spell,
        feet: moving.feet,
        fromCaster: moving.fromCaster,
        terms: moving.terms,
        placed,
        override: null,
        widthFeet: null
      },
      GRID
    )
  };
}

describe("Silent Image: a Magic action moves the image to any spot within 60 feet of its caster", () => {
  const wizard = build(wizardInput(["silent-image", "magic-missile"]));

  function image() {
    const caster = fight(wizard);
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(30, 30), [FOE2]: cell(40, 40) });
    caster.resolve("spell-silent-image", { targetIds: [], commandId: CAST, areaPlaced: true });
    drawArea(caster.state, CAST, [2, 0], 3, "square");
    heroTurnAgain(caster.state);
    return caster;
  }

  it("moves the Cube farther than 30 feet at once, to a spot within range", () => {
    const caster = image();
    const placed = square([8, 0], 3);
    const { move, moving } = plan(caster, "spell-silent-image-then-move", placed);
    moveArea(caster.state, move, placed, TABLE, { ...zoneDeps(), geometry: GRID }, moving.terms);
    expect(areaOf(caster.state).geometry.origin).toEqual({ x: 400, y: 0 });
  });

  it("refuses a spot more than 60 feet from its caster", () => {
    const caster = image();
    expect(() => plan(caster, "spell-silent-image-then-move", square([14, 0], 3))).toThrow(RulesBlockedError);
  });
});

describe("Major Image: moved only while its caster is within range of it", () => {
  const wizard = build(wizardInput(["major-image", "magic-missile"]));

  function image() {
    const caster = fight(wizard);
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(30, 30), [FOE2]: cell(40, 40) });
    caster.resolve("spell-major-image", { targetIds: [], commandId: CAST, areaPlaced: true });
    drawArea(caster.state, CAST, [2, 0], 4, "square");
    heroTurnAgain(caster.state);
    return caster;
  }

  it("moves the image to another spot within 120 feet of its caster", () => {
    const caster = image();
    expect(plan(caster, "spell-major-image-then-move", square([20, 0], 4)).move.note).toBeNull();
  });

  it("refuses a move while its caster is more than 120 feet from the image", () => {
    const caster = image();
    moveTo(caster.state, HERO, [30, 0]);
    expect(() => plan(caster, "spell-major-image-then-move", square([20, 0], 4))).toThrow(RulesBlockedError);
  });
});

describe("Faithful Hound", () => {
  const wizard = wizardAt(7, ["faithful-hound", "magic-missile"]);

  function hound() {
    const caster = fight(wizard);
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(20, 4), [FOE2]: cell(40, 40) });
    caster.resolve("spell-faithful-hound", { targetIds: [], commandId: CAST, areaPlaced: true });
    drawArea(caster.state, CAST, [4, 4], 1);
    heroTurnAgain(caster.state);
    return caster;
  }

  it("is drawn for the GM and its caster alone", () => {
    expect(zoneRowOf(view.spellRecord("faithful-hound")!)?.zone?.hidden).toBe(true);
  });

  it("moves 30 feet with a Magic action, and no farther", () => {
    const caster = hound();
    expect(caster.action("spell-faithful-hound-then-move").activation).toBe("action");
    expect(plan(caster, "spell-faithful-hound-then-move", circleAt([10, 4], 1)).move.note).toBeNull();
    expect(() => plan(caster, "spell-faithful-hound-then-move", circleAt([11, 4], 1))).toThrow(RulesBlockedError);
  });

  it("barks to the GM when a creature comes within 30 feet of it", () => {
    const { state } = hound();
    const events = walk(state, FOE, [
      [20, 4],
      [15, 4],
      [10, 4]
    ]);
    expect(events).toEqual([
      expect.objectContaining({
        text: "Faithful Hound: Goblin comes within 30 feet, and the hound starts barking.",
        gmOnly: true
      })
    ]);
  });

  it("ends when its caster is more than 300 feet from it", () => {
    const { state } = hound();
    const events = walk(state, HERO, [
      [0, 0],
      [66, 4]
    ]);
    expect(events.map((event) => event.text)).toContain("Faithful Hound ends: Ansel is more than 300 feet from it.");
    expect(state.combat.spellZones).toEqual([]);
    expect(
      state.actors.find((actor) => actor.id === HERO)!.effects.some((effect) => effect.spell?.id === "faithful-hound")
    ).toBe(false);
  });
});

describe("Conjure Animals: the pack moves with its caster's move", () => {
  const druid = build(druidInput(["conjure-animals"]));

  function pack() {
    const caster = fight(druid);
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(10, 0), [FOE2]: cell(10, 2) });
    caster.resolve("spell-conjure-animals", { targetIds: [], commandId: CAST, areaPlaced: true });
    drawArea(caster.state, CAST, [2, 0], 2);
    return caster;
  }

  it("is on the caster's turn list, at no cost", () => {
    const caster = pack();
    const action = caster.action("spell-conjure-animals-then-move");
    expect(action.activation).toBe("other");
    expect(passiveOf(action, false, view.spellRecord("conjure-animals"))).toBeUndefined();
  });

  it("waits for its caster to move first", () => {
    const caster = pack();
    expect(() => plan(caster, "spell-conjure-animals-then-move", circleAt([8, 1], 2))).toThrow(RulesBlockedError);
  });

  it("moves up to 30 feet once its caster has moved, and the creatures it comes near make the save", () => {
    const caster = pack();
    caster.state.combat.turn.movementUsedFeet = 20;
    const placed = circleAt([8, 1], 2);
    const { move, moving } = plan(caster, "spell-conjure-animals-then-move", placed);
    moveArea(caster.state, move, placed, TABLE, { ...zoneDeps(), geometry: GRID }, moving.terms);
    expect(savesOf(caster.state, FOE)).toHaveLength(1);
    expect(savesOf(caster.state, FOE2)).toHaveLength(1);
    // Once a turn.
    expect(() => plan(caster, "spell-conjure-animals-then-move", circleAt([4, 1], 2))).toThrow(RulesBlockedError);
  });

  it("refuses a space a creature stands in", () => {
    const caster = pack();
    caster.state.combat.turn.movementUsedFeet = 20;
    expect(() => plan(caster, "spell-conjure-animals-then-move", circleAt([10, 0], 2))).toThrow(RulesBlockedError);
  });

  it("gives its caster Advantage on Strength saves within 5 feet of the pack", () => {
    const caster = pack();
    moveTo(caster.state, HERO, [1, 0]);
    settleZoneAuras(caster.state, zoneDeps());
    const hero = caster.state.actors.find((actor) => actor.id === HERO)!;
    expect(hero.effects.find((effect) => effect.tags.includes("zone-aura"))?.modifiers).toEqual([
      expect.objectContaining({ type: "roll-mode", roll: "save", mode: "advantage" })
    ]);
    moveTo(caster.state, HERO, [0, 6]);
    settleZoneAuras(caster.state, zoneDeps());
    expect(
      caster.state.actors
        .find((actor) => actor.id === HERO)!
        .effects.some((effect) => effect.tags.includes("zone-aura"))
    ).toBe(false);
  });
});
