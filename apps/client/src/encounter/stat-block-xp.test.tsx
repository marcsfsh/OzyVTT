import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { StatBlock } from "./StatBlock";

// SRD 5.2.1 prints a legendary creature's lair XP beside its XP: the Adult Red Dragon is "CR 17 (XP 18,000, or 20,000
// in lair; PB +6)".

const dragon = (traits: readonly string[]) => ({
  name: "Adult Red Dragon",
  size: "huge",
  armorClass: 19,
  hitPoints: { maximum: 256, formula: "19d12 + 133" },
  proficiencyBonus: 6,
  abilityScores: { str: 27, dex: 10, con: 25, int: 16, wis: 13, cha: 23 },
  speedFeet: 40,
  actions: [],
  extensions: {
    "open5e.srd-2024": {
      challengeRating: 17,
      experiencePoints: 18000,
      type: "dragon",
      traits: traits.map((name) => ({ name, description: "" }))
    }
  }
});

describe("a stat block's challenge line", () => {
  it("prints the lair XP of a legendary creature with a lair", () => {
    const { container } = render(<StatBlock monster={dragon(["Legendary Resistance (3/Day, or 4/Day in Lair)"])} />);
    expect(container.textContent).toContain("CR 17 (XP 18,000, or 20,000 in lair; PB +6)");
  });

  it("prints one XP for a creature with no lair", () => {
    const { container } = render(<StatBlock monster={dragon(["Legendary Resistance (3/Day)"])} />);
    expect(container.textContent).toContain("CR 17 (XP 18,000; PB +6)");
  });
});
