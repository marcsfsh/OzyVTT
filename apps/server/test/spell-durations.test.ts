import { describe, expect, it } from "vitest";
import { view } from "./spell-casters.js";
import { FOE, FOE2, HERO, heroTurnAgain } from "./spell-casters.js";
import { actorOf, answer, cast, caster, effectNames } from "./spell-lifetimes-kit.js";

// SRD 5.2.1 higher-level text that changes a spell's duration or its Concentration: Dominate Beast "Your Concentration
// can last longer with a spell slot of level 5 (up to 10 minutes), 6 (up to 1 hour), or 7+ (up to 8 hours)"; Major
// Image "lasts until dispelled, without requiring Concentration, if cast with a level 4+ spell slot"; Bestow Curse from
// a level 5 slot needs no Concentration and lasts 8 hours.

const concentration = (state: Parameters<typeof actorOf>[0]) =>
  actorOf(state, HERO).effects.find((effect) => effect.tags.includes("concentrating"));

describe("durations by spell slot", () => {
  it("reads every spell's higher-level duration rows from the bundle", () => {
    expect(view.spellRecord("dominate-beast")!.upcastDurations).toEqual([
      { level: 5, duration: "10 minutes", concentration: true },
      { level: 6, duration: "1 hour", concentration: true },
      { level: 7, duration: "8 hours", concentration: true }
    ]);
    expect(view.spellRecord("magic-circle")!.upcastDurations?.at(-1)).toEqual({
      level: 9,
      duration: "7 hours",
      concentration: false
    });
  });

  it("holds Dominate Beast's Concentration and its Charmed for the time its slot gives", () => {
    const level4 = caster();
    cast(level4, "dominate-beast", {}, []);
    expect(concentration(level4.state)?.duration).toEqual({ type: "rounds", remaining: 10 });
    const level5 = caster();
    cast(level5, "dominate-beast", { slotLevel: 5 });
    expect(concentration(level5.state)?.duration).toEqual({ type: "rounds", remaining: 100 });
    const level7 = caster();
    cast(level7, "dominate-beast", { slotLevel: 7 });
    expect(concentration(level7.state)?.duration).toEqual({ type: "minutes", remaining: 480 });
    answer(level7.state, FOE, 2);
    expect(actorOf(level7.state, FOE).effects[0]).toMatchObject({
      linkedConditionIds: ["charmed"],
      duration: { type: "minutes", remaining: 480 },
      spell: { id: "dominate-beast", level: 7 }
    });
  });

  it("lasts Hex 8 hours from a level 3 slot, on the caster and on the cursed creature", () => {
    const table = caster();
    cast(table, "hex", { slotLevel: 3, ability: "str" });
    expect(concentration(table.state)?.duration).toEqual({ type: "minutes", remaining: 480 });
    expect(actorOf(table.state, FOE).effects[0]?.duration).toEqual({ type: "minutes", remaining: 480 });
  });

  it("casts Major Image from a level 4 slot with no Concentration, so Hold Person holds", () => {
    const table = caster();
    cast(table, "hold-person", { targetIds: [FOE] });
    answer(table.state, FOE, 2);
    heroTurnAgain(table.state);
    cast(table, "major-image", { targetIds: [], slotLevel: 4 });
    expect(concentration(table.state)?.name).toBe("Concentrating on Hold Person");
    expect(actorOf(table.state, FOE).conditions.map((condition) => condition.id)).toContain("paralyzed");
  });

  it("ends Hold Person when Major Image is cast from a level 3 slot, which needs Concentration", () => {
    const table = caster();
    cast(table, "hold-person", { targetIds: [FOE] });
    answer(table.state, FOE, 2);
    heroTurnAgain(table.state);
    cast(table, "major-image", { targetIds: [] });
    expect(concentration(table.state)?.name).toBe("Concentrating on Major Image");
    expect(actorOf(table.state, FOE).conditions).toEqual([]);
  });

  it("casts Bestow Curse from a level 5 slot with no Concentration for 8 hours, and from a level 4 slot for 10 minutes", () => {
    const level5 = caster();
    cast(level5, "hold-person", { targetIds: [FOE2] });
    heroTurnAgain(level5.state);
    cast(level5, "bestow-curse", { slotLevel: 5, optionId: "wis" });
    answer(level5.state, FOE, 2);
    expect(concentration(level5.state)?.name).toBe("Concentrating on Hold Person");
    expect(actorOf(level5.state, FOE).effects[0]).toMatchObject({
      name: "Bestow Curse (Wisdom curse)",
      tags: ["curse"],
      concentration: false,
      duration: { type: "minutes", remaining: 480 }
    });
    const level4 = caster();
    cast(level4, "bestow-curse", { slotLevel: 4 });
    expect(concentration(level4.state)?.duration).toEqual({ type: "rounds", remaining: 100 });
    expect(effectNames(level4.state, HERO)).toEqual(["Concentrating on Bestow Curse"]);
  });
});
