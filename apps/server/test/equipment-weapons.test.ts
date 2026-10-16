import { describe, expect, it } from "vitest";
import { RulesBlockedError } from "../src/game-store.js";
import {
  actionOf,
  catalogRow,
  fight,
  fighterInput,
  IDS,
  resolveAt,
  tableOf,
  wizardInput,
  write
} from "./equipment-table.js";

// Weapon properties the engine enforces when a character attacks (SRD 5.2.1 Weapons): Loading, Ammunition,
// Heavy, Two-Handed, Versatile and the melee/ranged band.

const blockedRule = (attempt: () => unknown): string | null => {
  try {
    attempt();
    return null;
  } catch (error) {
    return error instanceof RulesBlockedError ? error.rule : String(error);
  }
};

describe("Loading", () => {
  it("fires once per action whatever Extra Attack allows, and leaves the other attack to another weapon", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("heavy-crossbow"));
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-heavy-crossbow", [15, 4]);
    expect(blockedRule(() => resolveAt(table, IDS.fighter, "item-heavy-crossbow", [15, 4]))).toBe("attack.loading");
    // Extra Attack's second attack is still there for the greatsword.
    expect(blockedRule(() => resolveAt(table, IDS.fighter, "item-greatsword", [15, 4, 4]))).toBeNull();
  });

  it("can follow another weapon's attack in the same action", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("heavy-crossbow"));
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-greatsword", [15, 4, 4]);
    expect(blockedRule(() => resolveAt(table, IDS.fighter, "item-heavy-crossbow", [15, 4]))).toBeNull();
  });
});

describe("the melee and ranged bands", () => {
  it("throws a Dart as a ranged weapon even at an adjacent creature: no melee reach, close-combat Disadvantage", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("dart", { quantity: 5 }));
    write(table, IDS.fighter, catalogRow("dagger"));
    expect(actionOf(table, IDS.fighter, "item-dart").attack?.reachFeet).toBeUndefined();
    // A Dagger is a melee weapon that can be thrown, so it keeps its reach.
    expect(actionOf(table, IDS.fighter, "item-dagger").attack?.reachFeet).toBe(5);
    fight(table, IDS.fighter);
    const resolution = resolveAt(table, IDS.fighter, "item-dart", [15, 3, 4], {}, 5);
    expect(resolution.rollMode?.disadvantage).toContain("Enemy within 5 feet (Foe)");
  });

  it("reads the band off the catalog for a row stored before the row carried it", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("dart"));
    const actor = table.actor(IDS.fighter);
    actor.inventory = actor.inventory.map((item) => {
      if (item.id !== "dart" || !item.weapon) return item;
      const { melee: _melee, ...legacy } = item.weapon;
      return { ...item, weapon: legacy };
    });
    expect(actionOf(table, IDS.fighter, "item-dart").attack?.reachFeet).toBeUndefined();
  });
});

describe("Versatile and Two-Handed", () => {
  it("offers a Versatile weapon's two-handed attack with the bigger die while no shield is worn", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("longsword"));
    expect(actionOf(table, IDS.fighter, "item-longsword").damage[0].formula).toBe("1d8 + 4");
    const twoHanded = actionOf(table, IDS.fighter, "item-longsword-two-handed");
    expect(twoHanded.damage[0].formula).toBe("1d10 + 4");
    // Extra Attack reaches the two-handed grip like any weapon attack.
    expect(twoHanded.attack?.count).toBe(2);
    write(table, IDS.fighter, catalogRow("shield"));
    expect(() => actionOf(table, IDS.fighter, "item-longsword-two-handed")).toThrow(/no item-longsword-two-handed/);
  });

  it("refuses a Two-Handed weapon's attack while a shield is on the arm", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("shield"));
    fight(table, IDS.fighter);
    expect(blockedRule(() => resolveAt(table, IDS.fighter, "item-greatsword", [15, 4, 4]))).toBe("attack.two-handed");
    // A one-handed weapon is fine.
    expect(blockedRule(() => resolveAt(table, IDS.fighter, "item-flail", [15, 4]))).toBeNull();
  });
});

describe("Heavy", () => {
  it("gives Disadvantage with a Heavy melee weapon below Strength 13, and not to a strong wielder", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput(), [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("greatsword"));
    write(table, IDS.wizard, catalogRow("longbow"));
    fight(table, IDS.wizard);
    const swing = resolveAt(table, IDS.wizard, "item-greatsword", [15, 3, 4, 4]);
    expect(swing.rollMode?.disadvantage).toEqual(["Greatsword is Heavy (Strength under 13)"]);
    // Dex 14 is enough for the Heavy longbow.
    table.state.combat.turn = { ...table.state.combat.turn, actionUsed: false, actionInstance: null };
    expect(resolveAt(table, IDS.wizard, "item-longbow", [15, 4]).rollMode).toBeUndefined();
  });

  it("leaves a Strength 19 fighter's greatsword alone", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    fight(table, IDS.fighter);
    expect(resolveAt(table, IDS.fighter, "item-greatsword", [15, 4, 4]).rollMode).toBeUndefined();
  });
});
