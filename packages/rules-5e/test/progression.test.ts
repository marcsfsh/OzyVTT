import { describe, expect, it } from "vitest";
import {
  EPIC_BOON_LEVEL, SRD_CLASS_IDS, SRD_CLASS_PROGRESSION, asiLevelsFor, casterProgressionFor,
  hitDieFor, isAsiLevel, meetsMulticlassPrerequisites, statPriorityFor
} from "../src/class-data.js";
import {
  FULL_CASTER_SLOTS, hitDicePool, hitDieAverage, hitPointPool, hitPointsAtLevel1, hitPointsPerLevel,
  multiclassCasterLevel, multiclassPactSlots, multiclassSpellSlots, pactSlotsForLevel, spellSlotsForClass
} from "../src/progression.js";
import { proficiencyBonusForLevel } from "../src/character.js";

describe("SRD class data", () => {
  it("covers the twelve SRD classes with a complete stat priority each", () => {
    expect(SRD_CLASS_IDS).toEqual([
      "barbarian", "bard", "cleric", "druid", "fighter", "monk",
      "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard"
    ]);
    for (const classId of SRD_CLASS_IDS) {
      const priority = statPriorityFor(classId);
      expect(priority.length, classId).toBe(6);
      expect(new Set(priority).size, classId).toBe(6);
    }
  });

  it("carries the SRD hit dice", () => {
    expect(hitDieFor("barbarian")).toBe("d12");
    expect(hitDieFor("fighter")).toBe("d10");
    expect(hitDieFor("paladin")).toBe("d10");
    expect(hitDieFor("ranger")).toBe("d10");
    expect(hitDieFor("rogue")).toBe("d8");
    expect(hitDieFor("cleric")).toBe("d8");
    expect(hitDieFor("wizard")).toBe("d6");
    expect(hitDieFor("sorcerer")).toBe("d6");
    // An unknown (homebrew, not yet loaded) class falls back rather than throwing.
    expect(hitDieFor("moon-warden")).toBe("d8");
  });

  it("puts the primary ability first in each class's priority", () => {
    expect(statPriorityFor("wizard")[0]).toBe("int");
    expect(statPriorityFor("cleric")[0]).toBe("wis");
    expect(statPriorityFor("rogue")[0]).toBe("dex");
    expect(statPriorityFor("sorcerer")[0]).toBe("cha");
    expect(statPriorityFor("paladin").slice(0, 2)).toEqual(["str", "cha"]);
    expect(statPriorityFor("monk").slice(0, 2)).toEqual(["dex", "wis"]);
  });

  it("uses the SRD 5.2.1 ASI levels (Fighter and Rogue get extras; 19 is the Epic Boon)", () => {
    expect(asiLevelsFor("wizard")).toEqual([4, 8, 12, 16]);
    expect(asiLevelsFor("fighter")).toEqual([4, 6, 8, 12, 14, 16]);
    expect(asiLevelsFor("rogue")).toEqual([4, 8, 10, 12, 16]);
    expect(isAsiLevel("fighter", 6)).toBe(true);
    expect(isAsiLevel("wizard", 6)).toBe(false);
    expect(asiLevelsFor("wizard")).not.toContain(EPIC_BOON_LEVEL);
    // An unknown class gets the standard cadence.
    expect(asiLevelsFor("moon-warden")).toEqual([4, 8, 12, 16]);
  });

  it("classifies caster progression", () => {
    expect(casterProgressionFor("wizard")).toBe("full");
    expect(casterProgressionFor("cleric")).toBe("full");
    expect(casterProgressionFor("paladin")).toBe("half");
    expect(casterProgressionFor("ranger")).toBe("half");
    expect(casterProgressionFor("warlock")).toBe("pact");
    expect(casterProgressionFor("fighter")).toBe("none");
    expect(casterProgressionFor("moon-warden")).toBe("none");
  });
});

describe("meetsMulticlassPrerequisites", () => {
  const scores = { str: 15, dex: 12, con: 14, int: 10, wis: 13, cha: 8 };

  it("enforces the single-ability minimums", () => {
    expect(meetsMulticlassPrerequisites(scores, "barbarian")).toBe(true); // STR 15 >= 13
    expect(meetsMulticlassPrerequisites(scores, "cleric")).toBe(true); // WIS 13 >= 13
    expect(meetsMulticlassPrerequisites(scores, "wizard")).toBe(false); // INT 10 < 13
    expect(meetsMulticlassPrerequisites(scores, "bard")).toBe(false); // CHA 8 < 13
  });

  it("treats the Fighter's requirement as STR 13 OR DEX 13", () => {
    expect(SRD_CLASS_PROGRESSION.fighter.multiclassPrerequisite.mode).toBe("any");
    expect(meetsMulticlassPrerequisites({ str: 13, dex: 8 }, "fighter")).toBe(true);
    expect(meetsMulticlassPrerequisites({ str: 8, dex: 13 }, "fighter")).toBe(true);
    expect(meetsMulticlassPrerequisites({ str: 12, dex: 12 }, "fighter")).toBe(false);
  });

  it("treats the Paladin's and Monk's requirements as BOTH abilities", () => {
    expect(meetsMulticlassPrerequisites({ str: 13, cha: 12 }, "paladin")).toBe(false);
    expect(meetsMulticlassPrerequisites({ str: 13, cha: 13 }, "paladin")).toBe(true);
    expect(meetsMulticlassPrerequisites({ dex: 13, wis: 12 }, "monk")).toBe(false);
    expect(meetsMulticlassPrerequisites({ dex: 13, wis: 13 }, "monk")).toBe(true);
  });

  it("allows an undeclared (homebrew) class through", () => {
    expect(meetsMulticlassPrerequisites({}, "moon-warden")).toBe(true);
  });
});

describe("hit points", () => {
  it("grants the maximum die plus CON at level 1", () => {
    expect(hitPointsAtLevel1("d10", 2)).toBe(12); // Fighter, CON 14
    expect(hitPointsAtLevel1("d6", 1)).toBe(7); // Wizard, CON 12
    expect(hitPointsAtLevel1("d12", 3)).toBe(15); // Barbarian, CON 16
    // Never below 1, even with a brutal CON.
    expect(hitPointsAtLevel1("d6", -5)).toBe(1);
  });

  it("uses the SRD fixed averages", () => {
    expect([hitDieAverage("d6"), hitDieAverage("d8"), hitDieAverage("d10"), hitDieAverage("d12")]).toEqual([4, 5, 6, 7]);
    expect(hitPointsPerLevel("d10", 2)).toBe(8); // 6 + 2
    expect(hitPointsPerLevel("d6", 1)).toBe(5); // 4 + 1
  });

  it("takes the roll as-is in roll mode", () => {
    expect(hitPointsPerLevel("d10", 2, "roll", 1)).toBe(3);
    expect(hitPointsPerLevel("d10", 2, "roll", 10)).toBe(12);
    expect(() => hitPointsPerLevel("d10", 2, "roll")).toThrow(RangeError);
    expect(() => hitPointsPerLevel("d10", 2, "roll", 11)).toThrow(RangeError);
  });

  it("takes max(roll, average) on the auto path, so rolling can only help", () => {
    expect(hitPointsPerLevel("d10", 2, "max-of-both", 1)).toBe(8); // average 6 wins
    expect(hitPointsPerLevel("d10", 2, "max-of-both", 6)).toBe(8); // tie
    expect(hitPointsPerLevel("d10", 2, "max-of-both", 9)).toBe(11); // roll wins
    expect(hitPointsPerLevel("d6", 0, "max-of-both", 6)).toBe(6);
  });

  it("never drops below 1 hit point in a level", () => {
    expect(hitPointsPerLevel("d6", -5, "average")).toBe(1);
    expect(hitPointsPerLevel("d6", -5, "max-of-both", 6)).toBe(1);
  });

  it("totals a single-class pool: a level-5 Fighter with CON 14 has 44 average hit points", () => {
    // 12 at level 1, then four levels of 6 + 2.
    expect(hitPointPool([{ classId: "fighter", level: 5 }], 2)).toBe(12 + 4 * 8);
  });

  it("totals a multiclass pool from the STARTING class's maximum die", () => {
    // Fighter 3 / Wizard 2, CON +2: 12 (F1 max) + 2x8 (F2-3) + 2x6 (W1-2 average d6+2) = 40
    expect(hitPointPool([{ classId: "fighter", level: 3 }, { classId: "wizard", level: 2 }], 2)).toBe(12 + 16 + 12);
    // Reversing the order changes level 1, exactly as the SRD does.
    expect(hitPointPool([{ classId: "wizard", level: 2 }, { classId: "fighter", level: 3 }], 2)).toBe(8 + 6 + 24);
  });

  it("consumes supplied rolls in order and falls back to the average when they run out", () => {
    // Fighter 3, CON +2, max-of-both: level 1 = 12, level 2 roll 10 -> 12, level 3 has no roll -> 8.
    expect(hitPointPool([{ classId: "fighter", level: 3 }], 2, "max-of-both", [10])).toBe(12 + 12 + 8);
  });

  it("pools hit DICE for the short-rest tracker, biggest die first", () => {
    expect(hitDicePool([{ classId: "fighter", level: 3 }, { classId: "wizard", level: 2 }]))
      .toEqual([{ die: "d10", count: 3 }, { die: "d6", count: 2 }]);
    // Two d8 classes merge into one row.
    expect(hitDicePool([{ classId: "rogue", level: 2 }, { classId: "cleric", level: 1 }]))
      .toEqual([{ die: "d8", count: 3 }]);
    // An explicit per-class hit die (the sheet's own `character.classes[].hitDie`) wins over the table.
    expect(hitDicePool([{ classId: "moon-warden", level: 4, hitDie: "d12" }]))
      .toEqual([{ die: "d12", count: 4 }]);
  });
});

describe("spell slots", () => {
  it("keeps a 20-row full-caster table that matches the SRD at every checkpoint", () => {
    expect(FULL_CASTER_SLOTS.length).toBe(20);
    for (const row of FULL_CASTER_SLOTS) expect(row.length).toBe(9);
    expect(FULL_CASTER_SLOTS[0]).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(FULL_CASTER_SLOTS[19]).toEqual([4, 3, 3, 3, 3, 2, 2, 1, 1]);
  });

  it("gives a level-5 Wizard 4/3/2", () => {
    expect(spellSlotsForClass("wizard", 5)).toEqual([4, 3, 2, 0, 0, 0, 0, 0, 0]);
  });

  it("matches the SRD full-caster table at other spot levels", () => {
    expect(spellSlotsForClass("cleric", 1)).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(spellSlotsForClass("bard", 3)).toEqual([4, 2, 0, 0, 0, 0, 0, 0, 0]);
    expect(spellSlotsForClass("druid", 11)).toEqual([4, 3, 3, 3, 2, 1, 0, 0, 0]);
    expect(spellSlotsForClass("sorcerer", 20)).toEqual([4, 3, 3, 3, 3, 2, 2, 1, 1]);
  });

  it("halves a Paladin's and Ranger's progression (rounding up the table row)", () => {
    expect(spellSlotsForClass("paladin", 1)).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(spellSlotsForClass("paladin", 2)).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(spellSlotsForClass("paladin", 3)).toEqual([3, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(spellSlotsForClass("paladin", 5)).toEqual([4, 2, 0, 0, 0, 0, 0, 0, 0]);
    expect(spellSlotsForClass("ranger", 20)).toEqual([4, 3, 3, 3, 2, 0, 0, 0, 0]);
  });

  it("gives a third-caster nothing before level 3, then a third of the table", () => {
    expect(spellSlotsForClass("fighter", 2, "third")).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(spellSlotsForClass("fighter", 3, "third")).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(spellSlotsForClass("fighter", 7, "third")).toEqual([4, 2, 0, 0, 0, 0, 0, 0, 0]);
    expect(spellSlotsForClass("fighter", 20, "third")).toEqual([4, 3, 3, 1, 0, 0, 0, 0, 0]);
  });

  it("keeps Warlock Pact Magic out of the ordinary slot table", () => {
    expect(spellSlotsForClass("warlock", 5)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(pactSlotsForLevel(1)).toEqual({ level: 1, slots: 1 });
    expect(pactSlotsForLevel(2)).toEqual({ level: 1, slots: 2 });
    expect(pactSlotsForLevel(5)).toEqual({ level: 3, slots: 2 });
    expect(pactSlotsForLevel(11)).toEqual({ level: 5, slots: 3 });
    expect(pactSlotsForLevel(17)).toEqual({ level: 5, slots: 4 });
    expect(pactSlotsForLevel(0)).toBeNull();
  });

  it("returns no slots for a non-caster at any level", () => {
    expect(spellSlotsForClass("fighter", 20)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(spellSlotsForClass("barbarian", 20)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("lets a homebrew class declare its own progression", () => {
    expect(spellSlotsForClass("moon-warden", 5, "full")).toEqual([4, 3, 2, 0, 0, 0, 0, 0, 0]);
    expect(spellSlotsForClass("moon-warden", 5)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("multiclass casting", () => {
  it("gives a Fighter 1 / Wizard 1 a caster level of 1", () => {
    expect(multiclassCasterLevel([{ classId: "fighter", level: 1 }, { classId: "wizard", level: 1 }])).toBe(1);
    expect(multiclassSpellSlots(1)).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("counts full levels whole, half-caster levels halved ROUNDING UP, third-caster levels thirded", () => {
    expect(multiclassCasterLevel([{ classId: "wizard", level: 5 }, { classId: "cleric", level: 3 }])).toBe(8);
    // SRD 5.2.1 Multiclassing/Spell Slots: "Half your levels (ROUND UP) in the Paladin and Ranger
    // classes" - one of the explicit exceptions to the game's round-down default. This assertion
    // previously demanded 2 (round down), which is the answer the SRD does not give.
    expect(multiclassCasterLevel([{ classId: "paladin", level: 5 }])).toBe(3);
    expect(multiclassCasterLevel([{ classId: "paladin", level: 6 }, { classId: "wizard", level: 4 }])).toBe(7);
    expect(multiclassCasterLevel([{ classId: "ranger", level: 3 }, { classId: "druid", level: 2 }])).toBe(4);
    // Third-casters keep the round-down default: SRD 5.2.1's multiclass list names only Paladin and
    // Ranger for round-up, and no third-caster subclass is in this SRD at all.
    expect(multiclassCasterLevel([{ classId: "fighter", level: 7, casterProgression: "third" }])).toBe(2);
  });

  it("gives a Paladin 3 / Wizard 1 the 2nd-level slot row the round-down bug ate", () => {
    // Paladin 3 -> ceil(3/2) = 2, Wizard 1 -> 1: caster level 3, which is 4/2 on the shared table.
    // Rounding the Paladin's levels down produced caster level 2 and silently deleted a whole row.
    expect(multiclassCasterLevel([{ classId: "paladin", level: 3 }, { classId: "wizard", level: 1 }])).toBe(3);
    expect(multiclassSpellSlots(multiclassCasterLevel([{ classId: "paladin", level: 3 }, { classId: "wizard", level: 1 }])))
      .toEqual([4, 2, 0, 0, 0, 0, 0, 0, 0]);
    // A half-caster on its own agrees with the single-class table at every level (both round up).
    for (let level = 1; level <= 20; level += 1) {
      expect(multiclassSpellSlots(multiclassCasterLevel([{ classId: "paladin", level }])), `paladin ${level}`)
        .toEqual(spellSlotsForClass("paladin", level));
    }
  });

  it("excludes Warlock levels from the caster level and tracks pact slots separately", () => {
    expect(multiclassCasterLevel([{ classId: "warlock", level: 5 }, { classId: "sorcerer", level: 3 }])).toBe(3);
    expect(multiclassPactSlots([{ classId: "warlock", level: 5 }, { classId: "sorcerer", level: 3 }])).toEqual({ level: 3, slots: 2 });
    expect(multiclassPactSlots([{ classId: "sorcerer", level: 3 }])).toBeNull();
  });

  it("reads the shared multiclass table at the combined caster level", () => {
    // Paladin 6 / Wizard 4 -> caster level 7 -> 4/3/3/1
    const casterLevel = multiclassCasterLevel([{ classId: "paladin", level: 6 }, { classId: "wizard", level: 4 }]);
    expect(multiclassSpellSlots(casterLevel)).toEqual([4, 3, 3, 1, 0, 0, 0, 0, 0]);
    expect(multiclassSpellSlots(0)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(multiclassSpellSlots(20)).toEqual([4, 3, 3, 3, 3, 2, 2, 1, 1]);
  });

  it("agrees with the single-class table for a single full caster", () => {
    for (let level = 1; level <= 20; level += 1) {
      expect(multiclassSpellSlots(multiclassCasterLevel([{ classId: "wizard", level }])), `level ${level}`)
        .toEqual(spellSlotsForClass("wizard", level));
    }
  });
});

describe("proficiency bonus alongside the class tables", () => {
  it("still steps at the SRD breakpoints (the level table's own column must match)", () => {
    expect([1, 4, 5, 9, 13, 17, 20].map(proficiencyBonusForLevel)).toEqual([2, 2, 3, 4, 5, 6, 6]);
  });
});
