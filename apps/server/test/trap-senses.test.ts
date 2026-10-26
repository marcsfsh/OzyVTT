import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import { noticeGlyphs, placeTrap } from "../src/traps.js";
import { build, clericInput, fight, FOE, FOE2, HERO, wizardInput } from "./spell-casters.js";
import { carry, cell, drawArea, GRID, place } from "./zone-fixtures.js";

// Finding what the app holds hidden: Find Traps tells its caster the nature of the traps within 120 feet it can see,
// never where they are, and a Study (Investigation) notices a Glyph of Warding, a Search (Perception) a Symbol.

const GM = { role: "gm" } as const;
const CAST = "63000000-0000-4000-8000-0000000000f1";
const cells = (c0: number, r0: number) => ({ x: 50 * c0, y: 50 * r0, width: 50, height: 50 });
const measured = (state: GameState) => {
  state.combat.vision.measure = { width: 3000, height: 3000, pixelsPerFoot: 10 };
};

describe("Find Traps", () => {
  it("tells the caster each trap within 120 feet by its nature alone, and the GM where it is", () => {
    const caster = fight(build(clericInput(["find-traps"])), { combat: false });
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(40, 40), [FOE2]: cell(50, 50) });
    measured(caster.state);
    placeTrap(caster.state, undefined, GRID, { id: CAST, trapId: "hidden-pit", tier: 1, rect: cells(6, 0) }, GM);
    placeTrap(
      caster.state,
      undefined,
      GRID,
      { id: "63000000-0000-4000-8000-0000000000f2", trapId: "poisoned-darts", tier: 1, rect: cells(40, 0) },
      GM
    );
    const result = caster.resolve("spell-find-traps", { targetIds: [] });
    expect(result.sensed).toEqual([
      "Find Traps: you sense a trap within 120 feet: a hidden pit. Where it is, the spell doesn't say."
    ]);
    const told = result.tableNarration.find((line) => line.text.startsWith("Find Traps senses"));
    expect(told).toMatchObject({ gmOnly: true, text: "Find Traps senses for Mira: a hidden pit 30 feet away." });
    expect(JSON.stringify(result.sensed)).not.toContain("30 feet");
  });

  it("senses nothing when no trap lies within 120 feet", () => {
    const caster = fight(build(clericInput(["find-traps"])), { combat: false });
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(40, 40), [FOE2]: cell(50, 50) });
    measured(caster.state);
    expect(caster.resolve("spell-find-traps", { targetIds: [] }).sensed).toEqual([
      "Find Traps: you sense no trap within 120 feet."
    ]);
  });
});

describe("noticing a hidden glyph", () => {
  function glyph() {
    const caster = fight(build(wizardInput(["glyph-of-warding"])), { combat: false });
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(12, 10), [FOE2]: cell(40, 40) });
    carry(caster.state, HERO, "Diamond dust");
    caster.resolve("spell-glyph-of-warding", { targetIds: [], commandId: CAST, areaPlaced: true, damageType: "fire" });
    drawArea(caster.state, CAST, [10, 10], 4);
    caster.state.combat.annotations = caster.state.combat.annotations.map((annotation) =>
      annotation.id === CAST ? { ...annotation, visibility: "gm-only" as const } : annotation
    );
    return caster.state;
  }

  it("notices a Glyph of Warding with a Study (Investigation) that meets the spell save DC, within 10 feet", () => {
    const state = glyph();
    const dc = state.combat.spellZones[0]!.dc;
    const study = { action: "study" as const, skill: "investigation", pixelsPerFoot: 10 };
    expect(noticeGlyphs(state, FOE, { ...study, total: dc - 1 })).toEqual([]);
    expect(noticeGlyphs(state, FOE, { action: "search", skill: "perception", total: 30, pixelsPerFoot: 10 })).toEqual(
      []
    );
    expect(noticeGlyphs(state, FOE, { ...study, total: dc }).map((event) => event.text)).toEqual([
      "Goblin notices a glyph: Glyph of Warding."
    ]);
    expect(state.combat.annotations.find((annotation) => annotation.id === CAST)?.visibility).toBe("public");
  });

  it("leaves a glyph more than 10 feet away unnoticed", () => {
    const state = glyph();
    expect(
      noticeGlyphs(state, FOE2, { action: "study", skill: "investigation", total: 30, pixelsPerFoot: 10 })
    ).toEqual([]);
  });
});
