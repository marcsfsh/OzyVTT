import { describe, expect, it } from "vitest";
import { cantripScalingOf, cantripTierAt, loadSpells } from "../src/index.js";

const spell = (id: string) => loadSpells().find((record) => record.id === id)!;

describe("cantrip scaling by character level", () => {
  it("reads Fire Bolt's printed rows, lowest level first", () => {
    expect(cantripScalingOf(spell("fire-bolt").castingOptions)).toEqual([
      { characterLevel: 5, damageRoll: "2d10", targetCount: null },
      { characterLevel: 11, damageRoll: "3d10", targetCount: null },
      { characterLevel: 17, damageRoll: "4d10", targetCount: null }
    ]);
  });

  it("puts the highest row at or below the level in force, and none below the first", () => {
    const rows = cantripScalingOf(spell("fire-bolt").castingOptions);
    expect(cantripTierAt(rows, 4)).toBeNull();
    expect(cantripTierAt(rows, 5)?.damageRoll).toBe("2d10");
    expect(cantripTierAt(rows, 16)?.damageRoll).toBe("3d10");
    expect(cantripTierAt(rows, 20)?.damageRoll).toBe("4d10");
    // Eldritch Blast scales its beams; its die stays a d10.
    expect(cantripTierAt(cantripScalingOf(spell("eldritch-blast").castingOptions), 11)?.targetCount).toBe(3);
  });
});
