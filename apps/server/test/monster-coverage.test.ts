import { describe, expect, it } from "vitest";
import { srdCoverageRows } from "../src/srd-coverage.js";

// The manifest says what the engine does with a stat block's action: a save counts only when its failure leaves
// something, an attack whose printed riders the engine leaves to the GM reads as applied in part, and a Spellcasting
// list is judged by the least of the spells it casts whose outcome isn't the story's.

const rows = srdCoverageRows().filter((row) => row.group === "Monster actions");
const row = (name: string) => rows.find((candidate) => candidate.name === name)!;

describe("the coverage of a monster's action", () => {
  it("counts a save as applied only when its failure leaves something", () => {
    // Opens a DC 10 Charisma save whose failure is what the sprite learns.
    expect(row("Sprite: Heart Sight").state).toBe("guided");
    // Its failure leaves Poison damage and a -2 to AC.
    expect(row("Adult Green Dragon: Noxious Miasma").state).not.toBe("reference");
    // Its failure Frightens.
    expect(row("Mummy: Dreadful Glare").state).toBe("enforced");
  });

  it("reads an attack whose printed rider the GM finishes as applied in part", () => {
    expect(row("Allosaurus: Claws").state).toBe("guided");
    expect(row("Phase Spider: Bite").state).toBe("guided");
    expect(row("Balor: Flame Whip").state).toBe("enforced");
    expect(row("Elephant: Gore").state).toBe("enforced");
  });

  it("judges a Spellcasting list by the least of its spells whose outcome isn't the story's, naming the rest", () => {
    // Command, Scorching Ray and Fireball apply; Detect Magic's sensing is the story's.
    expect(row("Adult Red Dragon: Spellcasting").state).toBe("enforced");
    const lich = row("Lich: Spellcasting");
    expect(lich.state).toBe("guided");
    expect(lich.note).toMatch(/Dimension Door, Plane Shift apply only as their own rows say\.$/);
    expect(lich.note).not.toMatch(/Detect Magic|Scrying/);
  });

  it("gives a cast of one spell that spell's state", () => {
    expect(row("Archmage: Misty Step (3/Day)").state).toBe("enforced");
    expect(row("Adult Black Dragon: Frightful Presence").state).toBe("guided");
  });
});
