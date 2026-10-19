import { describe, expect, it } from "vitest";
import { setInventoryItem } from "../src/inventory.js";
import { applyRest } from "../src/rests.js";
import {
  actionOf,
  catalog,
  catalogRow,
  fight,
  IDS,
  resolveAt,
  tableOf,
  wizardInput,
  write
} from "./equipment-table.js";

// SRD 5.2.1 magic items: a charge cost above one (Staff of Fire's Fireball: 3), a cost the user picks that sets the
// spell's level (Wand of Fireballs: "For 1 charge, you cast the level 3 version ... increase the spell's level by 1 for
// each additional charge"), charges that never come back and a count rolled when found (Necklace of Fireballs' 1d6 +
// 3 beads), pools of 50 (Staff of the Magi), a flat regain (Rod of Resurrection's 1), and the last charge's d20.

const spent = (table: ReturnType<typeof tableOf>, key: string) => table.actor(IDS.wizard).actionUses[key] ?? 0;
const DICE = Array.from({ length: 40 }, () => 3);

describe("a cast that spends several charges", () => {
  it("spends a Staff of Fire's 3 charges for its Fireball", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("staff-of-fire", { attuned: true }));
    expect(actionOf(table, IDS.wizard, "item-staff-of-fire-cast-fireball").useCost).toBe(3);
    fight(table, IDS.wizard);
    resolveAt(table, IDS.wizard, "item-staff-of-fire-cast-fireball", [...DICE]);
    expect(spent(table, "staff-of-fire-charges")).toBe(3);
  });

  it("offers a Wand of Fireballs' cast at levels 3 to 5 for 1 to 3 charges, the higher one rolling more dice", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("wand-of-fireballs", { attuned: true }));
    const level3 = actionOf(table, IDS.wizard, "item-wand-of-fireballs-cast-fireball");
    const level5 = actionOf(table, IDS.wizard, "item-wand-of-fireballs-cast-fireball-5");
    expect(level3.useCost).toBeUndefined();
    expect(level5).toMatchObject({ useCost: 3, name: "Cast Fireball at level 5 (Wand of Fireballs)" });
    expect(level3.damage[0]?.formula).toBe("8d6");
    expect(level5.damage[0]?.formula).toBe("10d6");
    fight(table, IDS.wizard);
    resolveAt(table, IDS.wizard, "item-wand-of-fireballs-cast-fireball-5", [...DICE]);
    expect(spent(table, "wand-of-fireballs-charges")).toBe(3);
  });

  it("makes a Robe of Stars' level 5 Magic Missile seven darts", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("robe-of-stars", { attuned: true }));
    expect(actionOf(table, IDS.wizard, "item-robe-of-stars-cast-magic-missile").darts).toBe(7);
  });

  it("holds a Staff of the Magi's 50 charges", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("staff-of-the-magi", { attuned: true }));
    expect(actionOf(table, IDS.wizard, "item-staff-of-the-magi-cast-plane-shift")).toMatchObject({
      useCost: 7,
      uses: { limit: 50, pool: "staff-of-the-magi-charges" }
    });
  });
});

describe("charges that never come back", () => {
  it("rolls a Necklace of Fireballs' beads when it is added, and a Long Rest gives none back", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    // 1d6 + 3 with a 2: five beads of the nine a necklace can hold.
    setInventoryItem(table.state, IDS.wizard, catalogRow("necklace-of-fireballs"), table.resolve, {
      catalog,
      role: "player",
      random: () => 2
    });
    expect(spent(table, "necklace-of-fireballs-beads")).toBe(4);
    table.actor(IDS.wizard).actionUses = { ...table.actor(IDS.wizard).actionUses, "necklace-of-fireballs-beads": 6 };
    applyRest(table.state, IDS.wizard, "long", table.resolve, catalog, { random: () => 6, lines: [] });
    expect(spent(table, "necklace-of-fireballs-beads")).toBe(6);
  });

  it("cracks a Chime of Opening on its tenth use", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("chime-of-opening"));
    table.actor(IDS.wizard).actionUses = { "chime-of-opening-uses": 9 };
    fight(table, IDS.wizard);
    const result = resolveAt(table, IDS.wizard, "item-chime-of-opening-cast-knock", [...DICE], { targetIds: [] });
    expect(table.actor(IDS.wizard).inventory.some((row) => row.id === "chime-of-opening")).toBe(false);
    expect(result.warnings?.join(" ") ?? JSON.stringify(result)).toMatch(/Chime of Opening is destroyed/);
  });
});

describe("the last charge's d20", () => {
  it("crumbles a Wand of Fireballs on a 1", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("wand-of-fireballs", { attuned: true }));
    table.actor(IDS.wizard).actionUses = { "wand-of-fireballs-charges": 6 };
    fight(table, IDS.wizard);
    resolveAt(
      table,
      IDS.wizard,
      "item-wand-of-fireballs-cast-fireball",
      DICE.map(() => 1)
    );
    expect(table.actor(IDS.wizard).inventory.some((row) => row.id === "wand-of-fireballs")).toBe(false);
    expect(table.actor(IDS.wizard).actionUses["wand-of-fireballs-charges"]).toBeUndefined();
  });

  it("turns a Staff of the Woodlands into a Quarterstaff on a 1", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    // A Druid's staff: the GM hands it to the wizard attuned.
    write(table, IDS.wizard, catalogRow("staff-of-the-woodlands", { attuned: true }), "gm");
    table.actor(IDS.wizard).actionUses = { "staff-of-the-woodlands-charges": 5 };
    fight(table, IDS.wizard);
    resolveAt(table, IDS.wizard, "item-staff-of-the-woodlands-tree-form", [1], { targetIds: [] });
    expect(table.actor(IDS.wizard).inventory.find((row) => row.id === "staff-of-the-woodlands")).toMatchObject({
      name: "Quarterstaff",
      recordId: "quarterstaff",
      attuned: false
    });
  });

  it("gives a Staff of Power 1d8 + 2 charges back on a 20", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("staff-of-power", { attuned: true }));
    table.actor(IDS.wizard).actionUses = { "staff-of-power-charges": 19 };
    fight(table, IDS.wizard);
    resolveAt(table, IDS.wizard, "item-staff-of-power-cast-magic-missile", [...DICE.slice(0, 3), 20, 4], {
      targetIds: [IDS.foe, IDS.foe, IDS.foe]
    });
    expect(spent(table, "staff-of-power-charges")).toBe(20 - 6);
  });
});

describe("a flat regain", () => {
  it("gives a Rod of Resurrection one charge back at dawn", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    write(table, IDS.wizard, catalogRow("rod-of-resurrection", { attuned: true }));
    table.actor(IDS.wizard).actionUses = { "rod-of-resurrection-charges": 5 };
    applyRest(table.state, IDS.wizard, "long", table.resolve, catalog, { random: () => 6, lines: [] });
    expect(spent(table, "rod-of-resurrection-charges")).toBe(4);
  });
});

describe("more charges that never come back", () => {
  it("spends five of a Gem of Brightness's 50 charges on its flare, and a Long Rest gives none back", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("gem-of-brightness"));
    expect(actionOf(table, IDS.wizard, "item-gem-of-brightness-flare")).toMatchObject({
      useCost: 5,
      uses: { limit: 50, per: "never", pool: "gem-of-brightness-charges" }
    });
    table.actor(IDS.wizard).actionUses = { "gem-of-brightness-charges": 5 };
    table.state.combat.active = false;
    applyRest(table.state, IDS.wizard, "long", table.resolve, catalog, { random: () => 6, lines: [] });
    expect(spent(table, "gem-of-brightness-charges")).toBe(5);
  });

  it("rolls a Luck Blade's 1d3 Wish charges when it is added", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    setInventoryItem(table.state, IDS.wizard, catalogRow("luck-blade"), table.resolve, {
      catalog,
      role: "gm",
      random: () => 2
    });
    expect(spent(table, "luck-blade-wish")).toBe(1);
  });
});
