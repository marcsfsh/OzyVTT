import { describe, expect, it } from "vitest";
import { resolveDefinitionAction } from "../src/action-resolution.js";
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

// "Use a Utilize action to place these shackles on an Incapacitated creature ... the shackles prevent a creature bound
// by them from using any method of extradimensional movement, including teleportation or travel to a different plane".
describe("Dimensional Shackles", () => {
  const shackled = () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("dimensional-shackles"), "gm");
    fight(table, IDS.wizard);
    return table;
  };
  const foe = (table: ReturnType<typeof tableOf>) => table.actor(IDS.foe);

  it("go only on an Incapacitated creature", () => {
    expect(() => resolveAt(shackled(), IDS.wizard, "item-dimensional-shackles-shackle", [])).toThrow();
  });

  it("bar the bound creature's teleports and its own way off the plane, and the action again removes them", () => {
    const table = shackled();
    foe(table).conditions = [{ id: "stunned" }];
    resolveAt(table, IDS.wizard, "item-dimensional-shackles-shackle", []);
    const bound = foe(table).effects.find((effect) => effect.name === "Dimensional Shackles")!;
    expect(bound.tags).toEqual(["no-teleport", "dimensional-shackles"]);
    expect(bound.endAction).toMatchObject({ kind: "check", ability: "str", skill: "athletics", dc: 30 });
    // It comes to on its turn, still bound.
    foe(table).conditions = [];
    table.state.combat = { ...table.state.combat, turnActorId: IDS.foe };
    expect(() =>
      resolveDefinitionAction(
        table.state,
        {
          id: "ethereal-jaunt",
          name: "Ethereal Jaunt",
          activation: "bonus-action",
          description: "",
          damage: [],
          grants: {
            name: "Ethereal",
            tags: ["ethereal"],
            target: "self",
            duration: { type: "manual" },
            modifiers: [],
            onEnd: [],
            voidWhileIncapacitated: false,
            concentration: false
          }
        },
        { actorId: IDS.foe, targetIds: [], commandId: "50000000-0000-4000-8000-0000000000f1" },
        {
          random: () => 1,
          newRollId: () => "40000000-0000-4000-8000-0000000000f1",
          gmSessionId: IDS.gmSession,
          now: () => "2026-10-19T00:00:00.000Z"
        }
      )
    ).toThrow("Foe is bound by Dimensional Shackles and can't leave this plane.");
    table.state.combat = { ...table.state.combat, turnActorId: IDS.wizard };
    nextTurn(table);
    resolveAt(table, IDS.wizard, "item-dimensional-shackles-shackle", []);
    expect(foe(table).effects.some((effect) => effect.name === "Dimensional Shackles")).toBe(false);
  });
});

// "Folding the cloth closes the hole, and any creatures or objects within remain in the extradimensional space ... a DC
// 10 Strength (Athletics) check ... forces its way out and appears within 5 feet of the Portable Hole."
describe("a Portable Hole folded shut", () => {
  it("holds the creature inside off the map until its DC 10 Athletics check", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("portable-hole"), "gm");
    fight(table, IDS.wizard);
    resolveAt(table, IDS.wizard, "item-portable-hole-fold", []);
    const shut = table.actor(IDS.foe).effects.find((effect) => effect.name === "Shut in the Portable Hole")!;
    expect(shut.tags).toEqual(["off-plane", "portable-hole"]);
    expect(shut.endAction).toMatchObject({ kind: "check", ability: "str", skill: "athletics", dc: 10 });
  });
});

// "While wearing this hat, you can cast the Disguise Self spell. The spell ends if the hat is removed."
describe("a Hat of Disguise", () => {
  it("ends its Disguise Self when the hat comes off", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("hat-of-disguise", { attuned: true }), "gm");
    fight(table, IDS.wizard);
    resolveAt(table, IDS.wizard, "item-hat-of-disguise-cast-disguise-self", [], { targetIds: [] });
    expect(tags(table)).toContain("disguised");
    write(table, IDS.wizard, edit(table, IDS.wizard, "hat-of-disguise", { equipped: false }), "gm");
    expect(tags(table)).not.toContain("disguised");
  });
});
