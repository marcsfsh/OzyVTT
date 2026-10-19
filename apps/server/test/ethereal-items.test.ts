import { describe, expect, it } from "vitest";
import { actionOf, catalogRow, edit, fight, IDS, resolveAt, tableOf, wizardInput, write } from "./equipment-table.js";

// SRD 5.2.1 items that take their user off the plane: Plate Armor of Etherealness ("gain the effect of the Etherealness
// spell. The spell ends immediately if you remove the armor or take a Magic action to repeat the command word"), Oil of
// Etherealness ("gains the effect of the Etherealness spell for 1 hour"), and a Robe of Stars ("a Magic action to enter
// the Astral Plane ... until you take a Magic action to return").

const tags = (table: ReturnType<typeof tableOf>) => table.actor(IDS.wizard).effects.flatMap((effect) => effect.tags);
const nextTurn = (table: ReturnType<typeof tableOf>) => {
  table.state.combat = {
    ...table.state.combat,
    turn: { ...table.state.combat.turn, actionUsed: false, bonusActionUsed: false, actionInstance: null }
  };
};

describe("Plate Armor of Etherealness", () => {
  it("puts its wearer on the Border Ethereal, and repeating the command word ends it with no new use", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("plate-armor-of-etherealness", { attuned: true, baseId: "plate-armor" }), "gm");
    fight(table, IDS.wizard);
    resolveAt(table, IDS.wizard, "item-plate-armor-of-etherealness-etherealness", [], { targetIds: [] });
    expect(tags(table)).toEqual(expect.arrayContaining(["ethereal", "ethereal-shunt"]));
    nextTurn(table);
    resolveAt(table, IDS.wizard, "item-plate-armor-of-etherealness-etherealness", [], { targetIds: [] });
    expect(tags(table)).not.toContain("ethereal");
  });

  it("ends the Etherealness when the armor comes off", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("plate-armor-of-etherealness", { attuned: true, baseId: "plate-armor" }), "gm");
    fight(table, IDS.wizard);
    resolveAt(table, IDS.wizard, "item-plate-armor-of-etherealness-etherealness", [], { targetIds: [] });
    write(table, IDS.wizard, edit(table, IDS.wizard, "plate-armor-of-etherealness", { equipped: false }), "gm");
    expect(tags(table)).not.toContain("ethereal");
  });
});

describe("Oil of Etherealness", () => {
  it("gives the creature it covers the Border Ethereal for an hour, and is used up", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("oil-of-etherealness"), "gm");
    expect(actionOf(table, IDS.wizard, "item-oil-of-etherealness-apply").targets).toMatchObject({ maxSize: "medium" });
    fight(table, IDS.wizard);
    resolveAt(table, IDS.wizard, "item-oil-of-etherealness-apply", [], { targetIds: [IDS.wizard] });
    const oiled = table.actor(IDS.wizard).effects.find((effect) => effect.name === "Oil of Etherealness")!;
    expect(oiled).toMatchObject({ tags: ["ethereal", "ethereal-shunt"], duration: { type: "minutes", remaining: 60 } });
    expect(table.actor(IDS.wizard).inventory.some((row) => row.id === "oil-of-etherealness")).toBe(false);
  });
});

describe("a Robe of Stars", () => {
  it("takes its wearer to the Astral Plane, and the action again brings it back", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("robe-of-stars", { attuned: true }), "gm");
    fight(table, IDS.wizard);
    resolveAt(table, IDS.wizard, "item-robe-of-stars-astral-plane", [], { targetIds: [] });
    expect(tags(table)).toContain("off-plane");
    nextTurn(table);
    resolveAt(table, IDS.wizard, "item-robe-of-stars-astral-plane", [], { targetIds: [] });
    expect(tags(table)).not.toContain("off-plane");
  });
});
