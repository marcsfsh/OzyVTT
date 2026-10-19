import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ActorDefinition, ActorDerivedSheet } from "@vtt/domain";
import { SensesAndDefences } from "./ChecksTab";

const definition = {
  name: "Brenna",
  abilityScores: { str: 14, dex: 12, con: 16, int: 10, wis: 12, cha: 8 },
  proficiencyBonus: 2
} as unknown as ActorDefinition;

const derivedWith = (defences: ActorDerivedSheet["defences"]) =>
  ({
    proficiencyBonus: 2,
    armorClass: 14,
    initiative: 1,
    abilities: [],
    skills: [],
    tools: [],
    passivePerception: 11,
    speedFeet: 30,
    defences,
    spellSaveDcBonus: 0,
    attunementSlots: 3,
    weaponMasteries: [],
    classColumns: []
  }) as ActorDerivedSheet;

const rowText = (label: string) => screen.getByText(label).nextElementSibling?.textContent;

describe("the sheet's damage defences", () => {
  it("prints the typed defences the engine applies, naming an item's", () => {
    render(
      <SensesAndDefences
        definition={definition}
        extension={{ damageResistances: "Necrotic" }}
        derived={derivedWith({
          resistances: [
            { type: "poison", source: null },
            { type: "cold", source: "Ring of Warmth" }
          ],
          immunities: [],
          vulnerabilities: []
        })}
      />
    );
    expect(rowText("Resistances")).toBe("Poison, Cold (Ring of Warmth)");
    expect(screen.queryByText("Immunities")).toBeNull();
  });

  it("falls back to the stat block's prose when nothing is typed", () => {
    render(
      <SensesAndDefences
        definition={definition}
        extension={{ damageImmunities: "Fire; Poisoned" }}
        derived={derivedWith({ resistances: [], immunities: [], vulnerabilities: [] })}
      />
    );
    expect(rowText("Immunities")).toBe("Fire; Poisoned");
  });
});
