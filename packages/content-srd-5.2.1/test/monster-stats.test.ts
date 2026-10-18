import { describe, expect, it } from "vitest";
import {
  challengeBenchmarks,
  experienceForChallenge,
  HIT_DIE_BY_SIZE,
  monsterHitPoints,
  proficiencyBonusForChallenge
} from "@vtt/rules-5e";
import { loadMonsterDefinitions } from "../src/index.js";

// The numbers the homebrew monster wizard suggests, held to every bundled stat block: it may only suggest what the
// SRD's own stat blocks print.

const monsters = loadMonsterDefinitions();
const challengeOf = (definition: (typeof monsters)[number]) =>
  (definition.extensions["open5e.srd-2024"] as { challengeRating: number }).challengeRating;

describe("the stat-block rules the monster wizard fills in", () => {
  it("prints the Proficiency Bonus its CR gives on every SRD stat block", () => {
    const wrong = monsters.filter(
      (definition) => definition.proficiencyBonus !== proficiencyBonusForChallenge(challengeOf(definition))
    );
    expect(wrong.map((definition) => definition.name)).toEqual([]);
  });

  it("prints the XP its CR gives on every SRD stat block", () => {
    const wrong = monsters.filter((definition) => {
      const printed = (definition.extensions["open5e.srd-2024"] as { experiencePoints?: number }).experiencePoints;
      return printed !== undefined && printed !== experienceForChallenge(challengeOf(definition));
    });
    expect(wrong.map((definition) => definition.name)).toEqual([]);
  });

  it("rolls its size's Hit Point Die and adds Constitution once per die, on every SRD stat block", () => {
    const wrong = monsters.filter((definition) => {
      const match = /^(\d+)d(\d+)/.exec(definition.hitPoints.formula ?? "");
      if (!match || Number(match[2]) !== HIT_DIE_BY_SIZE[definition.size]) return true;
      const built = monsterHitPoints(Number(match[1]), definition.size, definition.abilityScores.con);
      return (
        built.average !== definition.hitPoints.maximum ||
        built.formula.replace(/\s/g, "") !== definition.hitPoints.formula!.replace(/\s/g, "")
      );
    });
    expect(wrong.map((definition) => `${definition.name} ${definition.hitPoints.formula}`)).toEqual([]);
  });

  it("finds a benchmark for every CR the bestiary has, from all of its stat blocks", () => {
    const benchmarks = challengeBenchmarks(
      monsters.map((definition) => ({ challengeRating: challengeOf(definition), statblock: definition }))
    );
    expect(benchmarks.reduce((sum, entry) => sum + entry.count, 0)).toBe(monsters.length);
    const crOne = benchmarks.find((entry) => entry.challengeRating === 1)!;
    // Spot values, so a reader that silently zeroes a number fails here.
    expect(crOne.armorClass.min).toBeGreaterThan(9);
    expect(crOne.damagePerRound.median).toBeGreaterThan(5);
    expect(crOne.attackBonus?.median).toBeGreaterThanOrEqual(3);
  });
});
