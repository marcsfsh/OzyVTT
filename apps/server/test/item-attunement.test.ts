import { describe, expect, it } from "vitest";
import type { InventoryItem } from "@vtt/schemas";
import { setInventoryItem } from "../src/inventory.js";
import { catalog, catalogRow, edit, fighterInput, IDS, tableOf, wizardInput, type Table } from "./equipment-table.js";

// SRD 5.2.1 Attunement: "a creature must spend a Short Rest focused on only that item", "a creature can't attune to
// more than one copy of an item", and an item that "requires attunement by" a class, a species or a spellcaster is
// attuned only by one. Ending attunement on purpose takes "another Short Rest focused on the item".

const asPlayer = (table: Table, actorId: string, item: InventoryItem) =>
  setInventoryItem(table.state, actorId, item, table.resolve, { catalog, role: "player" });
const resting = (table: Table, actorId: string) => {
  table.state.rest = { ...table.state.rest, shortRest: { actorIds: [actorId], done: [] } };
};

describe("attuning takes a Short Rest", () => {
  it("refuses a player who attunes outside one, and lets them during one", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    asPlayer(table, IDS.fighter, catalogRow("cloak-of-protection"));
    expect(() =>
      asPlayer(table, IDS.fighter, edit(table, IDS.fighter, "cloak-of-protection", { attuned: true }))
    ).toThrow("Attuning to Cloak of Protection takes a Short Rest focused on it. Start a Short Rest, then attune.");
    resting(table, IDS.fighter);
    asPlayer(table, IDS.fighter, edit(table, IDS.fighter, "cloak-of-protection", { attuned: true }));
    expect(table.actor(IDS.fighter).inventory.find((row) => row.id === "cloak-of-protection")?.attuned).toBe(true);
  });

  it("asks for a Short Rest to end it, and lets the GM attune or end it at any time", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    setInventoryItem(table.state, IDS.fighter, catalogRow("cloak-of-protection", { attuned: true }), table.resolve, {
      catalog,
      role: "gm"
    });
    expect(() =>
      asPlayer(table, IDS.fighter, edit(table, IDS.fighter, "cloak-of-protection", { attuned: false }))
    ).toThrow(/Ending attunement to Cloak of Protection takes a Short Rest/);
    // Taking it off or putting it in the pack needs no rest: it stays attuned.
    asPlayer(table, IDS.fighter, edit(table, IDS.fighter, "cloak-of-protection", { equipped: false }));
    setInventoryItem(
      table.state,
      IDS.fighter,
      edit(table, IDS.fighter, "cloak-of-protection", { attuned: false }),
      table.resolve,
      { catalog, role: "gm" }
    );
    expect(table.actor(IDS.fighter).inventory.find((row) => row.id === "cloak-of-protection")?.attuned).toBe(false);
  });

  it("counts the step a finished rest opens as part of it", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    table.actor(IDS.fighter).restStep = { after: "short-rest" };
    asPlayer(table, IDS.fighter, catalogRow("cloak-of-protection", { attuned: true }));
    expect(table.actor(IDS.fighter).inventory.find((row) => row.id === "cloak-of-protection")?.attuned).toBe(true);
  });
});

describe("an item's attunement prerequisites", () => {
  it("keeps a Holy Avenger from a Fighter, and a wand from a creature that casts no spells", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput(), [IDS.wizard]: wizardInput() });
    resting(table, IDS.fighter);
    expect(() =>
      asPlayer(table, IDS.fighter, catalogRow("holy-avenger", { baseId: "longsword", attuned: true }))
    ).toThrow("Holy Avenger requires attunement by a Paladin.");
    expect(() => asPlayer(table, IDS.fighter, catalogRow("wand-of-web", { attuned: true }))).toThrow(
      "Wand of Web requires attunement by a Spellcaster."
    );
    resting(table, IDS.wizard);
    asPlayer(table, IDS.wizard, catalogRow("wand-of-web", { attuned: true }));
    expect(table.actor(IDS.wizard).inventory.find((row) => row.id === "wand-of-web")?.attuned).toBe(true);
  });

  it("lets a creature attuned to a Belt of Dwarvenkind attune to a Dwarven Thrower", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    resting(table, IDS.fighter);
    const thrower = catalogRow("dwarven-thrower", { baseId: "warhammer", attuned: true });
    expect(() => asPlayer(table, IDS.fighter, thrower)).toThrow(
      "Dwarven Thrower requires attunement by a Dwarf or a creature attuned to a Belt of Dwarvenkind."
    );
    asPlayer(table, IDS.fighter, catalogRow("belt-of-dwarvenkind", { attuned: true }));
    asPlayer(table, IDS.fighter, thrower);
    expect(table.actor(IDS.fighter).inventory.find((row) => row.id === "dwarven-thrower")?.attuned).toBe(true);
  });

  it("lets the GM attune anyone to anything", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    setInventoryItem(
      table.state,
      IDS.fighter,
      catalogRow("holy-avenger", { baseId: "longsword", attuned: true }),
      table.resolve,
      { catalog, role: "gm" }
    );
    expect(table.actor(IDS.fighter).inventory.find((row) => row.id === "holy-avenger")?.attuned).toBe(true);
  });
});
