import { describe, expect, it } from "vitest";
import { addEffect, makeEffect } from "../src/effects.js";
import { catalogRow, fight, IDS, resolveAt, tableOf, wizardInput, write, type Table } from "./equipment-table.js";

// SRD 5.2.1 Hide: "The condition ends on you immediately after any of the following occurs: you make a sound louder
// than a whisper, an enemy finds you, you make an attack roll, or you cast a spell with a Verbal component." A throw
// that asks for a save is none of these.

function hiddenWizard(): Table {
  const table = tableOf({ [IDS.wizard]: wizardInput() });
  write(table, IDS.wizard, catalogRow("net", { equipped: false }), "gm");
  write(table, IDS.wizard, catalogRow("acid", { equipped: false }), "gm");
  fight(table, IDS.wizard);
  addEffect(
    table.state,
    IDS.wizard,
    makeEffect({
      id: "hiding",
      name: "Hiding (DC 17 to find)",
      tags: ["hidden"],
      sourceActorId: IDS.wizard,
      sourceActionId: "hide",
      linkedConditionIds: ["invisible"],
      findDc: 17,
      duration: { type: "manual" }
    })
  );
  return table;
}

const hidden = (table: Table) =>
  table.actor(IDS.wizard).effects.some((effect) => effect.tags.includes("hidden")) &&
  table.actor(IDS.wizard).conditions.some((condition) => condition.id === "invisible");

describe("what ends a creature's hiding", () => {
  it("keeps a hider hidden as it throws a Net or a vial of Acid", () => {
    const net = hiddenWizard();
    resolveAt(net, IDS.wizard, "item-net-throw", []);
    expect(hidden(net)).toBe(true);
    const acid = hiddenWizard();
    resolveAt(acid, IDS.wizard, "item-acid-throw", [3, 3]);
    expect(hidden(acid)).toBe(true);
  });

  it("ends it with an attack roll", () => {
    const table = hiddenWizard();
    resolveAt(table, IDS.wizard, "item-quarterstaff", [15, 15, 3, 3]);
    expect(hidden(table)).toBe(false);
  });

  it("ends it with a spell that has a Verbal component (Fire Bolt)", () => {
    const table = hiddenWizard();
    resolveAt(table, IDS.wizard, "spell-fire-bolt", [15, 15, 3, 3]);
    expect(hidden(table)).toBe(false);
  });
});
