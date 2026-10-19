import { describe, expect, it } from "vitest";
import { experienceForLevel, experienceForNextLevel, experienceInLair, levelForExperience } from "../src/index.js";

// SRD 5.2.1 Character Advancement: level 2 at 300 XP, level 5 at 6,500, level 20 at 355,000. A legendary creature fought
// in its lair is worth the XP of the next challenge rating ("XP 18,000, or 20,000 in lair").

describe("character advancement", () => {
  it("reads the level an XP total reaches", () => {
    expect(levelForExperience(0)).toBe(1);
    expect(levelForExperience(299)).toBe(1);
    expect(levelForExperience(300)).toBe(2);
    expect(levelForExperience(6500)).toBe(5);
    expect(levelForExperience(355000)).toBe(20);
    expect(levelForExperience(1_000_000)).toBe(20);
  });

  it("names the XP each level starts at, and the next one's", () => {
    expect(experienceForLevel(1)).toBe(0);
    expect(experienceForLevel(10)).toBe(64000);
    expect(experienceForNextLevel(4)).toBe(6500);
    expect(experienceForNextLevel(20)).toBeNull();
  });
});

describe("a legendary creature in its lair", () => {
  it("is worth the next challenge rating's XP", () => {
    expect(experienceInLair(17, ["Legendary Resistance (3/Day, or 4/Day in Lair)"])).toBe(20000);
    expect(experienceInLair(10, ["Amphibious", "Legendary Resistance (3/Day, or 4/Day in Lair)"])).toBe(7200);
  });

  it("has no lair XP without a lair", () => {
    expect(experienceInLair(30, ["Legendary Resistance (6/Day)"])).toBeNull();
  });
});
