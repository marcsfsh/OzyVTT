import { describe, expect, it } from "vitest";
import {
  abilityModifier,
  characterLevel,
  proficiencyBonusForLevel,
  saveBonus,
  skillBonus,
  spellAttackBonus,
  spellSaveDc
} from "../src/character.js";

describe("abilityModifier", () => {
  it("applies floor((score - 10) / 2) across the range", () => {
    expect(abilityModifier(10)).toBe(0);
    expect(abilityModifier(11)).toBe(0);
    expect(abilityModifier(8)).toBe(-1);
    expect(abilityModifier(1)).toBe(-5);
    expect(abilityModifier(15)).toBe(2);
    expect(abilityModifier(20)).toBe(5);
    expect(abilityModifier(30)).toBe(10);
  });
});

describe("characterLevel", () => {
  it("sums class levels for multiclass and floors at 1", () => {
    expect(characterLevel([7])).toBe(7);
    expect(characterLevel([5, 2])).toBe(7);
    expect(characterLevel([])).toBe(1);
  });
});

describe("proficiencyBonusForLevel", () => {
  it("steps +2/+3/+4/+5/+6 at the SRD breakpoints", () => {
    expect(proficiencyBonusForLevel(1)).toBe(2);
    expect(proficiencyBonusForLevel(4)).toBe(2);
    expect(proficiencyBonusForLevel(5)).toBe(3);
    expect(proficiencyBonusForLevel(8)).toBe(3);
    expect(proficiencyBonusForLevel(9)).toBe(4);
    expect(proficiencyBonusForLevel(13)).toBe(5);
    expect(proficiencyBonusForLevel(17)).toBe(6);
    expect(proficiencyBonusForLevel(20)).toBe(6);
  });

  it("clamps out-of-range levels to a legal bonus", () => {
    expect(proficiencyBonusForLevel(0)).toBe(2);
    expect(proficiencyBonusForLevel(25)).toBe(6);
  });
});

describe("saveBonus", () => {
  it("adds the proficiency bonus only when proficient", () => {
    // CON 14 (+2), PB +3
    expect(saveBonus(14, 3, false)).toBe(2);
    expect(saveBonus(14, 3, true)).toBe(5);
  });
});

describe("skillBonus", () => {
  it("scales the proficiency bonus by tier", () => {
    // DEX 16 (+3), PB +3
    expect(skillBonus(16, 3, "none")).toBe(3);
    expect(skillBonus(16, 3, "proficient")).toBe(6);
    expect(skillBonus(16, 3, "expertise")).toBe(9);
  });
});

describe("spellSaveDc / spellAttackBonus", () => {
  it("derives from 8 + PB + mod and PB + mod", () => {
    // CHA 18 (+4), PB +3
    expect(spellSaveDc(18, 3)).toBe(15);
    expect(spellAttackBonus(18, 3)).toBe(7);
  });
});
