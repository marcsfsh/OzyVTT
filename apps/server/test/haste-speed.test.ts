import { describe, expect, it } from "vitest";
import { endEffect, makeEffect } from "../src/effects.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { currentSpeedFeet, travelBudgetFeet } from "../src/speed.js";
import { catalog, HERO, heroTurnAgain } from "./spell-casters.js";
import { actorOf, cast, caster, wizard } from "./spell-lifetimes-kit.js";

// SRD 5.2.1 Haste: "the target's Speed is doubled", as its Speed is at each moment, after other changes (Rules
// Glossary, Speed: "if your Speed is halved and you have a Fly Speed, your Fly Speed is also halved").

const speed = (table: ReturnType<typeof caster>) => {
  const hero = actorOf(table.state, HERO);
  return currentSpeedFeet(hero, deriveEquipment(hero, wizard, catalog));
};

describe("Haste doubles the Speed of the moment", () => {
  it("gives a grappled target nothing while it is held, and 60 feet once the grapple ends", () => {
    const table = caster();
    const hero = actorOf(table.state, HERO);
    hero.conditions = [{ id: "grappled" }];
    cast(table, "haste", { targetIds: [HERO] });
    expect(speed(table)).toBe(0);
    hero.conditions = [];
    expect(speed(table)).toBe(60);
  });

  it("doubles Longstrider's raised Speed, and a Fly Speed with it", () => {
    const table = caster();
    cast(table, "longstrider", { targetIds: [HERO] });
    heroTurnAgain(table.state);
    cast(table, "haste", { targetIds: [HERO] });
    expect(speed(table)).toBe(80);
    const hero = actorOf(table.state, HERO);
    hero.effects = [
      ...hero.effects,
      makeEffect({
        id: "wings",
        name: "Wings",
        duration: { type: "manual" },
        modifiers: [{ type: "special-speed", movement: "fly", feet: 60 }]
      })
    ];
    expect(travelBudgetFeet(hero, deriveEquipment(hero, wizard, catalog), wizard, "fly")).toBe(140);
  });

  it("and Slow's halving cancel out", () => {
    const table = caster();
    cast(table, "haste", { targetIds: [HERO] });
    const hero = actorOf(table.state, HERO);
    hero.effects = [
      ...hero.effects,
      makeEffect({ id: "slowed", name: "Slow", duration: { type: "manual" }, tags: ["speed-halved"] })
    ];
    expect(speed(table)).toBe(30);
    endEffect(table.state, HERO, "slowed");
    expect(speed(table)).toBe(60);
  });
});
