import { describe, expect, it } from "vitest";
import { RulesBlockedError } from "../src/game-store.js";
import { catalogRow, fight, fighterInput, IDS, resolveAt, tableOf, write } from "./equipment-table.js";

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
