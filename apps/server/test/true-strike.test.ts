import { describe, expect, it } from "vitest";
import type { InventoryItem } from "@vtt/schemas";
import { effectiveActions } from "../src/effective-actions.js";
import { catalog, FOE, HERO } from "./spell-casters.js";
import { actorOf, cast, caster, effectNames, resolveAs, wizard } from "./spell-lifetimes-kit.js";

// SRD 5.2.1 True Strike: "Guided by a flash of magical insight, you make one attack with the weapon used in the
// spell's casting. The attack uses your spellcasting ability for the attack and damage rolls instead of using Strength
// or Dexterity. If the attack deals damage, it can be Radiant damage or the weapon's normal damage type (your choice).
// Cantrip Upgrade. Whether you deal Radiant damage or the weapon's normal damage type, the attack deals extra Radiant
// damage when you reach levels 5 (1d6), 11 (2d6), and 17 (3d6)."

const weapon = (id: string, name: string, category: "simple" | "martial", dice: string): InventoryItem => ({
  id,
  name,
  quantity: 1,
  equipped: true,
  attuned: false,
  category: "weapon",
  weapon: {
    category,
    damageDice: dice,
    damageType: "piercing",
    rangeFeet: null,
    longRangeFeet: null,
    melee: true,
    properties: []
  }
});

const swingOf = (table: ReturnType<typeof caster>, id: string) =>
  effectiveActions(wizard, actorOf(table.state, HERO), catalog).find((action) => action.id === id)!;

describe("True Strike", () => {
  it("makes one attack with the weapon at the spellcasting ability, with Radiant to pick and 1d6 more at level 5", () => {
    const table = caster();
    actorOf(table.state, HERO).inventory.push(weapon("dagger", "Dagger", "simple", "1d4"));
    const before = swingOf(table, "item-dagger");
    cast(table, "true-strike", { targetIds: [], itemId: "dagger" });
    expect(effectNames(table.state, HERO)).toContain("True Strike");
    const swing = swingOf(table, "item-dagger");
    // Intelligence +4 in place of Dexterity +2.
    expect(swing.attack!.bonus).toBe(before.attack!.bonus + 2);
    expect(swing.damageTypes).toEqual(["piercing", "radiant"]);
    // The cast's own action holds the attack: no Attack action is spent, and it lands.
    const strike = resolveAs(table, swing, { targetIds: [FOE], damageType: "radiant" }, [15, 3, 4]);
    expect(strike.attack?.outcome).toBe("hit");
    const damage = strike.damage.map((part) => [part.type, part.total]);
    expect(damage).toEqual([
      ["radiant", 7],
      ["radiant", 4]
    ]);
    // The binding ends with that one attack.
    expect(effectNames(table.state, HERO)).not.toContain("True Strike");
    expect(() => resolveAs(table, swingOf(table, "item-dagger"), { targetIds: [FOE] }, [15, 3])).toThrow();
  });

  it("refuses a weapon the caster isn't proficient with", () => {
    const table = caster();
    actorOf(table.state, HERO).inventory.push(weapon("longsword", "Longsword", "martial", "1d8"));
    expect(() => cast(table, "true-strike", { targetIds: [], itemId: "longsword" })).toThrow(
      "True Strike can't be cast on Longsword: its wielder isn't proficient with it."
    );
  });
});
