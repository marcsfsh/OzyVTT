import { describe, expect, it } from "vitest";
import { nextInitiativeTurn } from "../src/encounter.js";
import { setItemForm } from "../src/inventory.js";
import {
  catalog,
  catalogRow,
  edit,
  fight,
  fighterInput,
  IDS,
  resolveAt,
  tableOf,
  write,
  type Table
} from "./equipment-table.js";

// SRD 5.2.1 Defender: "The first time you attack with the weapon on each of your turns, you can transfer some or all of
// the weapon's bonus to your Armor Class ... The adjusted bonuses remain in effect until the start of your next turn,
// although you must hold the weapon to gain a bonus to AC from it."

const GM = { role: "gm" } as const;
const split = (table: Table, variantId: string | null) =>
  setItemForm(table.state, { actorId: IDS.fighter, itemId: "defender", variantId }, GM, catalog, table.resolve);
const turnDeps = (table: Table) => ({ rollDie: () => 1, resolveDefinition: table.resolve, catalog });

describe("Defender's bonus moved to AC", () => {
  it("is picked before the first attack of its wielder's turn, holds until its next turn, and needs the weapon held", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("defender", { attuned: true, baseId: "longsword" }), "gm");
    const armorClass = () => table.actor(IDS.fighter).armorClass ?? 0;
    const own = armorClass();
    fight(table, IDS.fighter);
    split(table, "ac-2");
    expect(armorClass()).toBe(own + 2);
    resolveAt(table, IDS.fighter, "item-defender", [17, 4]);
    expect(() => split(table, "ac-3")).toThrow(/keeps its form until the start of its next turn/);

    // The foe's turn: the split still holds, and the fighter can't change it there.
    nextInitiativeTurn(table.state, [], turnDeps(table));
    expect(armorClass()).toBe(own + 2);
    expect(() => split(table, "ac-3")).toThrow(/only on its own turn/);

    // The fighter's next turn: the whole bonus is back on the weapon, to split again.
    const events: Parameters<typeof nextInitiativeTurn>[1] = [];
    nextInitiativeTurn(table.state, events, turnDeps(table));
    expect(table.actor(IDS.fighter).inventory.find((row) => row.id === "defender")?.variantId).toBeUndefined();
    expect(armorClass()).toBe(own);
    expect(events!.map((event) => event.text)).toContain("Borin's Defender returns to its own form.");
    split(table, "ac-3");
    expect(armorClass()).toBe(own + 3);

    // Dropped, it gives no AC.
    write(table, IDS.fighter, edit(table, IDS.fighter, "defender", { equipped: false }), "gm");
    expect(armorClass()).toBe(own);
  });
});
