import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ActorDefinition, ActorDerivedSheet } from "@vtt/domain";
import { SheetAbilities } from "./SheetAbilities";
import type { SheetRolls } from "./useSheetRolls";

const definition = {
  name: "Brenna",
  abilityScores: { str: 14, dex: 12, con: 16, int: 10, wis: 12, cha: 8 },
  proficiencyBonus: 2
} as unknown as ActorDefinition;
const rolls = { rolling: false, rollD20: () => Promise.resolve() } as unknown as SheetRolls;

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
    attunementSlots: 3
  }) as ActorDerivedSheet;

const rowText = (label: string) => screen.getByText(label).nextElementSibling?.textContent;

describe("the sheet's damage defences", () => {
  it("prints the typed defences the engine applies, naming an item's", () => {
    render(
      <SheetAbilities
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
        rolls={rolls}
      />
    );
    expect(rowText("Resistances")).toBe("Poison, Cold (Ring of Warmth)");
    expect(screen.queryByText("Immunities")).toBeNull();
  });

  it("falls back to the stat block's prose when nothing is typed", () => {
    render(
      <SheetAbilities
        definition={definition}
        extension={{ damageImmunities: "Fire; Poisoned" }}
        derived={derivedWith({ resistances: [], immunities: [], vulnerabilities: [] })}
        rolls={rolls}
      />
    );
    expect(rowText("Immunities")).toBe("Fire; Poisoned");
  });
});
