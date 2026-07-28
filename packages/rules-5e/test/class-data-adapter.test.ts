import { describe, expect, it } from "vitest";
import {
  meetsMulticlassPrerequisites, progressionFromClass, progressionTableFromClasses, spellSlotsForClass,
  SRD_CLASS_PROGRESSION, type ClassProgressionSource
} from "../src/index.js";

/** A fully homebrew class record - the adapter must carry ITS values, never SRD defaults (known-bugs M2). */
const bloodKnight: ClassProgressionSource = {
  id: "blood-knight",
  hitDie: "d12",
  statPriority: ["con", "str", "cha", "dex", "wis", "int"],
  primaryAbilities: ["con"],
  savingThrows: ["con", "cha"],
  asiLevels: [4, 8, 12, 16, 19],
  subclassLevel: 2,
  spellcasting: { ability: "cha", multiclassProgression: "third" },
  multiclassPrerequisites: { mode: "any", minimums: [{ ability: "con", minimum: 13 }, { ability: "cha", minimum: 13 }] }
};

describe("progressionFromClass (bundle -> rules adapter)", () => {
  it("carries every authored value instead of the SRD fallbacks", () => {
    const row = progressionFromClass(bloodKnight);
    expect(row.hitDie).toBe("d12"); // not the d8 fallback
    expect(row.casterProgression).toBe("third"); // not "none" (which would mean zero slots)
    expect(row.spellcastingAbility).toBe("cha");
    expect(row.asiLevels).toEqual([4, 8, 12, 16, 19]); // not 4/8/12/16
    expect(row.subclassLevel).toBe(2);
    expect(row.multiclassPrerequisite).toEqual({ mode: "any", minimums: [["con", 13], ["cha", 13]] });
  });

  it("maps a non-caster (no spellcasting block) to progression none / no ability", () => {
    const row = progressionFromClass({ ...bloodKnight, spellcasting: null });
    expect(row.casterProgression).toBe("none");
    expect(row.spellcastingAbility).toBeNull();
  });

  it("maps absent prerequisites to an always-pass empty requirement", () => {
    const row = progressionFromClass({ ...bloodKnight, multiclassPrerequisites: null });
    expect(row.multiclassPrerequisite.minimums).toHaveLength(0);
    expect(meetsMulticlassPrerequisites({ str: 3 }, "blood-knight", { "blood-knight": row })).toBe(true);
  });

  it("drives the downstream rules math through the adapted table", () => {
    const table = progressionTableFromClasses([bloodKnight]);
    // Third-caster: no slots before level 3, the full-caster row at ceil(level/3) after.
    expect(spellSlotsForClass("blood-knight", 2, undefined, table)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(spellSlotsForClass("blood-knight", 9, undefined, table)[0]).toBeGreaterThan(0);
    // Prerequisites: mode "any" passes on either minimum.
    expect(meetsMulticlassPrerequisites({ con: 13, cha: 8 }, "blood-knight", table)).toBe(true);
    expect(meetsMulticlassPrerequisites({ con: 8, cha: 8 }, "blood-knight", table)).toBe(false);
  });

  it("keeps the SRD rows as the fallback for classes the catalog has not authored", () => {
    const table = progressionTableFromClasses([bloodKnight]);
    expect(table.rogue).toBe(SRD_CLASS_PROGRESSION.rogue);
    // An authored class SHADOWING an SRD id wins over the static row.
    const homebrewFighter = progressionTableFromClasses([{ ...bloodKnight, id: "fighter" }]);
    expect(homebrewFighter.fighter.hitDie).toBe("d12");
  });
});
