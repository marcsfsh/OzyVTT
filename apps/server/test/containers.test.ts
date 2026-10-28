import { describe, expect, it } from "vitest";
import { carryingOf } from "../src/carrying.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { ammunitionFor } from "../src/ammunition.js";
import { startEncounter } from "../src/encounter.js";
import { catalog, catalogRow, edit, fighterInput, IDS, tableOf, write, type Table } from "./equipment-table.js";

// SRD 5.2.1 Adventuring Gear and Magic Items: a container holds what it prints (a Backpack's 30 pounds, a Quiver's 20
// Arrows, a Bag of Holding's 500 pounds), what it holds weighs on its carrier unless the container weighs the same
// whatever it holds, and taking a thing out in a fight costs what the container says.

const anvil = (pounds: number, id = "anvil") => ({
  id,
  name: "Anvil",
  quantity: 1,
  equipped: false,
  attuned: false,
  weightEach: pounds
});

const pounds = (table: Table) =>
  carryingOf(table.actor(IDS.fighter), table.definition(IDS.fighter), catalog, [])!.pounds;

function packed(): Table {
  const table = tableOf({ [IDS.fighter]: fighterInput() });
  // The Fighter's kit brings a Backpack among its things.
  write(table, IDS.fighter, catalogRow("sack", { equipped: false }));
  return table;
}

describe("a mundane container's weight limit", () => {
  for (const [id, limit] of [
    ["backpack", 30],
    ["basket", 40],
    ["pouch", 6],
    ["sack", 30]
  ] as const)
    it(`holds up to ${limit} pounds in a ${id}`, () => {
      const table = packed();
      if (!table.actor(IDS.fighter).inventory.some((row) => row.id === id))
        write(table, IDS.fighter, catalogRow(id, { equipped: false }));
      write(table, IDS.fighter, { ...anvil(limit), containerId: id });
      expect(table.actor(IDS.fighter).inventory.find((row) => row.id === "anvil")?.containerId).toBe(id);
      expect(() => write(table, IDS.fighter, { ...anvil(1, "anvil-2"), containerId: id })).toThrow(
        new RegExp(`holds up to ${limit} pounds`)
      );
    });

  it("counts what a Backpack holds toward its carrier's load", () => {
    const table = packed();
    const before = pounds(table);
    write(table, IDS.fighter, { ...anvil(20), containerId: "sack" });
    expect(pounds(table)).toBe(before + 20);
  });

  it("stows a row put in a container: it is no longer held, and can't be held there", () => {
    const table = packed();
    write(table, IDS.fighter, catalogRow("dagger"));
    write(table, IDS.fighter, edit(table, IDS.fighter, "dagger", { containerId: "sack" }));
    expect(table.actor(IDS.fighter).inventory.find((row) => row.id === "dagger")?.equipped).toBe(false);
    expect(() => write(table, IDS.fighter, edit(table, IDS.fighter, "dagger", { equipped: true }))).toThrow(
      /Take it out first/
    );
  });

  it("refuses a container inside itself or inside what it holds", () => {
    const table = packed();
    write(table, IDS.fighter, catalogRow("pouch", { equipped: false }));
    write(table, IDS.fighter, edit(table, IDS.fighter, "pouch", { containerId: "sack" }));
    expect(() => write(table, IDS.fighter, edit(table, IDS.fighter, "sack", { containerId: "pouch" }))).toThrow(
      /inside something it holds/
    );
  });

  it("spills what it held, loose, when the container is removed", () => {
    const table = packed();
    write(table, IDS.fighter, { ...anvil(10), containerId: "sack" });
    write(table, IDS.fighter, edit(table, IDS.fighter, "sack", { quantity: 0 }));
    expect(table.actor(IDS.fighter).inventory.find((row) => row.id === "anvil")?.containerId).toBeUndefined();
  });
});

describe("a Quiver", () => {
  it("holds up to 20 Arrows, and the shot draws from it", () => {
    const table = packed();
    write(table, IDS.fighter, catalogRow("quiver", { equipped: false }));
    write(table, IDS.fighter, catalogRow("arrows-20", { equipped: false, containerId: "quiver" }));
    expect(() =>
      write(table, IDS.fighter, catalogRow("crossbow-bolts-20", { equipped: false, containerId: "quiver" }))
    ).toThrow(/holds only arrow/);
    expect(() => write(table, IDS.fighter, edit(table, IDS.fighter, "arrows-20", { quantity: 2 }))).toThrow(
      /holds up to 20/
    );
    expect(ammunitionFor(table.actor(IDS.fighter), "arrow", catalog)?.row.id).toBe("arrows-20");
  });

  it("leaves arrows stowed in a Backpack undrawn", () => {
    const table = packed();
    write(table, IDS.fighter, catalogRow("arrows-20", { equipped: false, containerId: "sack" }));
    expect(ammunitionFor(table.actor(IDS.fighter), "arrow", catalog)).toBeNull();
  });
});

describe("a Bag of Holding", () => {
  it("weighs 5 pounds to its carrier whatever it holds, up to 500 pounds", () => {
    const table = packed();
    write(table, IDS.fighter, catalogRow("bag-of-holding", { equipped: false }));
    const before = pounds(table);
    write(table, IDS.fighter, { ...anvil(300), containerId: "bag-of-holding" });
    expect(pounds(table)).toBe(before);
    expect(() => write(table, IDS.fighter, { ...anvil(250, "anvil-2"), containerId: "bag-of-holding" })).toThrow(
      /destroyed/
    );
  });

  it("is destroyed with what it holds when the GM overloads it", () => {
    const table = packed();
    write(table, IDS.fighter, catalogRow("bag-of-holding", { equipped: false }));
    write(table, IDS.fighter, { ...anvil(300), containerId: "bag-of-holding" });
    write(table, IDS.fighter, { ...anvil(250, "anvil-2"), containerId: "bag-of-holding" }, "gm");
    const ids = table.actor(IDS.fighter).inventory.map((row) => row.id);
    expect(ids).not.toContain("bag-of-holding");
    expect(ids).not.toContain("anvil");
  });

  it("can't go inside a Handy Haversack without destroying both", () => {
    const table = packed();
    write(table, IDS.fighter, catalogRow("bag-of-holding", { equipped: false }));
    write(table, IDS.fighter, catalogRow("handy-haversack", { equipped: false }));
    expect(() =>
      write(table, IDS.fighter, edit(table, IDS.fighter, "bag-of-holding", { containerId: "handy-haversack" }))
    ).toThrow(/destroys both/);
  });

  it("takes the Utilize action to take a thing out in an encounter", () => {
    const table = packed();
    write(table, IDS.fighter, catalogRow("bag-of-holding", { equipped: false }));
    write(table, IDS.fighter, { ...anvil(3), containerId: "bag-of-holding" });
    fightOn(table);
    const anvilRow = table.actor(IDS.fighter).inventory.find((row) => row.id === "anvil")!;
    const { containerId: _bag, ...out } = anvilRow;
    write(table, IDS.fighter, out);
    expect(table.state.combat.turn.actionUsed).toBe(true);
    expect(table.state.combat.turn.objectInteractionUsed).not.toBe(true);
  });

  it("keeps a potion in it from being drunk until it is taken out", () => {
    const table = packed();
    write(table, IDS.fighter, catalogRow("bag-of-holding", { equipped: false }));
    write(table, IDS.fighter, catalogRow("potion-of-healing", { equipped: false, containerId: "bag-of-holding" }));
    const actions = deriveEquipment(table.actor(IDS.fighter), table.definition(IDS.fighter), catalog).actions;
    expect(actions.some((action) => action.id.startsWith("item-potion-of-healing"))).toBe(false);
  });
});

describe("a Handy Haversack", () => {
  it("holds 200 pounds in each side pouch and weighs 5 pounds", () => {
    const table = packed();
    write(table, IDS.fighter, catalogRow("handy-haversack", { equipped: false }));
    const before = pounds(table);
    write(table, IDS.fighter, { ...anvil(200), containerId: "handy-haversack", compartment: "left" });
    expect(pounds(table)).toBe(before);
    expect(() =>
      write(table, IDS.fighter, { ...anvil(1, "anvil-2"), containerId: "handy-haversack", compartment: "left" })
    ).toThrow(/side pouch holds up to 200 pounds/);
    write(table, IDS.fighter, { ...anvil(1, "anvil-2"), containerId: "handy-haversack", compartment: "right" });
  });

  it("gives up a thing for the Bonus Action in an encounter, and the Utilize action once that is spent", () => {
    const table = packed();
    write(table, IDS.fighter, catalogRow("handy-haversack", { equipped: false }));
    write(table, IDS.fighter, { ...anvil(3), containerId: "handy-haversack" });
    write(table, IDS.fighter, { ...anvil(3, "anvil-2"), containerId: "handy-haversack" });
    fightOn(table);
    const take = (id: string) => {
      const {
        containerId: _bag,
        compartment: _pouch,
        ...out
      } = table.actor(IDS.fighter).inventory.find((row) => row.id === id)!;
      write(table, IDS.fighter, out);
    };
    take("anvil");
    expect(table.state.combat.turn).toMatchObject({ bonusActionUsed: true, actionUsed: false });
    take("anvil-2");
    expect(table.state.combat.turn.actionUsed).toBe(true);
  });
});

describe("an Efficient Quiver", () => {
  it("holds 60 pieces of ammunition in its shortest compartment, weighs 2 pounds, and is drawn from", () => {
    const table = packed();
    write(table, IDS.fighter, catalogRow("efficient-quiver", { equipped: false }));
    write(table, IDS.fighter, catalogRow("arrows-20", { quantity: 0 }));
    const before = pounds(table);
    write(
      table,
      IDS.fighter,
      catalogRow("arrows-20", { equipped: false, quantity: 3, containerId: "efficient-quiver" })
    );
    const row = table.actor(IDS.fighter).inventory.find((entry) => entry.id === "arrows-20")!;
    expect(row.compartment).toBe("shortest");
    expect(pounds(table)).toBe(before);
    expect(ammunitionFor(table.actor(IDS.fighter), "arrow", catalog)?.row.id).toBe("arrows-20");
    expect(() => write(table, IDS.fighter, edit(table, IDS.fighter, "arrows-20", { quantity: 4 }))).toThrow(
      /holds up to 60/
    );
  });
});

/** A fight with the Fighter on its turn. */
function fightOn(table: Table): void {
  startEncounter(
    table.state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.fighter, score: 20 },
        { actorId: IDS.foe, score: 10 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null },
    table.resolve,
    Date.now(),
    catalog
  );
}
