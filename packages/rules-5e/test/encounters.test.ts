import { describe, expect, it } from "vitest";
import { encounterBudget, encounterDifficulty, experienceForChallenge } from "../src/encounters.js";

describe("encounter building (SRD Gameplay Toolbox)", () => {
  it("gives XP by challenge rating as the stat blocks print it", () => {
    expect(experienceForChallenge(0.5)).toBe(100);
    expect(experienceForChallenge(9)).toBe(5000);
    expect(experienceForChallenge(17)).toBe(18000);
    expect(experienceForChallenge(0.3)).toBeNull();
  });

  it("matches the SRD's worked budgets", () => {
    // Four level 1 characters, low: 50 x 4. Five level 3, moderate: 225 x 5. Six level 15, high: 7,800 x 6.
    expect(encounterBudget([1, 1, 1, 1]).low).toBe(200);
    expect(encounterBudget([3, 3, 3, 3, 3]).moderate).toBe(1125);
    expect(encounterBudget([15, 15, 15, 15, 15, 15]).high).toBe(46800);
  });

  it("places a total against the budget", () => {
    const budget = encounterBudget([1, 1, 1, 1]); // 200 / 300 / 400
    expect(encounterDifficulty(150, budget)).toBe("under-low");
    expect(encounterDifficulty(200, budget)).toBe("low");
    expect(encounterDifficulty(350, budget)).toBe("moderate");
    expect(encounterDifficulty(400, budget)).toBe("high");
    expect(encounterDifficulty(401, budget)).toBe("over-high");
  });
});
