import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatBlock } from "./StatBlock";

// A stat block prints what SRD 5.2.1 prints: the type line with its sizes and tags, an NPC's Gear, the legendary uses
// in the lair, and a Spellcasting list once, with its spells inside it.

const base = {
  armorClass: 15,
  hitPoints: { maximum: 81, formula: "18d8" },
  proficiencyBonus: 3,
  abilityScores: { str: 9, dex: 14, con: 11, int: 17, wis: 12, cha: 11 },
  speedFeet: 30
};

describe("a stat block's header", () => {
  it("prints both sizes an NPC may be and the tag after its type", () => {
    const { container } = render(
      <StatBlock
        monster={{
          ...base,
          name: "Mage",
          size: "medium",
          actions: [],
          extensions: {
            "open5e.srd-2024": {
              challengeRating: 6,
              type: "humanoid",
              alignment: "neutral",
              sizes: ["medium", "small"],
              typeTags: ["Wizard"],
              gear: "Wand"
            }
          }
        }}
      />
    );
    expect(container.querySelector(".sb-type")?.textContent).toBe("Medium or Small Humanoid (Wizard), Neutral");
    expect(container.textContent).toContain("Gear Wand");
  });

  it("names a swarm's creatures", () => {
    const { container } = render(
      <StatBlock
        monster={{
          ...base,
          name: "Swarm of Rats",
          size: "medium",
          actions: [],
          extensions: {
            "open5e.srd-2024": {
              challengeRating: 0.25,
              type: "beast",
              alignment: "unaligned",
              swarm: { size: "tiny", of: "Beasts" }
            }
          }
        }}
      />
    );
    expect(container.querySelector(".sb-type")?.textContent).toBe("Medium Swarm of Tiny Beasts, Unaligned");
    expect(container.textContent).not.toContain("Gear");
  });
});

describe("a stat block's entries", () => {
  it("prints a Spellcasting list once, without its spells as entries of their own", () => {
    render(
      <StatBlock
        monster={{
          ...base,
          name: "Mage",
          size: "medium",
          extensions: { "open5e.srd-2024": { challengeRating: 6, type: "humanoid" } },
          actions: [
            {
              id: "spellcasting",
              name: "Spellcasting",
              activation: "action",
              description: "The mage casts one of the following spells.",
              damage: []
            },
            {
              id: "spellcasting-fireball",
              name: "Fireball",
              activation: "action",
              description: "A bright streak flashes.",
              damage: [],
              partOf: "spellcasting"
            },
            {
              id: "protective-magic",
              name: "Protective Magic (3/Day)",
              activation: "reaction",
              description: "The mage casts Counterspell or Shield.",
              damage: []
            },
            {
              id: "protective-magic-counterspell",
              name: "Counterspell",
              activation: "reaction",
              description: "The mage casts Counterspell or Shield.",
              damage: [],
              partOf: "protective-magic"
            }
          ]
        }}
      />
    );
    expect(screen.getByText("Spellcasting.")).toBeTruthy();
    expect(screen.queryByText("Fireball.")).toBeNull();
    expect(screen.getByText("Protective Magic (3/Day).")).toBeTruthy();
    expect(screen.queryByText("Counterspell.")).toBeNull();
  });

  it("prints the legendary action uses in the lair beside the usual ones", () => {
    const { container } = render(
      <StatBlock
        monster={{
          ...base,
          name: "Adult Red Dragon",
          size: "huge",
          legendary: { actionsPerRound: 3, resistancesPerDay: 3, actionsInLair: 4, resistancesInLair: 4 },
          extensions: { "open5e.srd-2024": { challengeRating: 17, type: "dragon" } },
          actions: [
            {
              id: "pounce",
              name: "Pounce",
              activation: "other",
              description: "The dragon moves up to half its Speed, and it makes one Rend attack.",
              damage: [],
              legendary: { cost: 1 }
            }
          ]
        }}
      />
    );
    expect(container.textContent).toContain(
      "Legendary Action Uses: 3 (4 in Lair). Immediately after another creature's turn"
    );
  });
});
