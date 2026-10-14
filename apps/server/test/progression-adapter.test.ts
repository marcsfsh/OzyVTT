import { describe, expect, it } from "vitest";
import { loadClasses } from "@vtt/content-srd-5.2.1";
import { progressionFromClass, progressionTableFromClasses, SRD_CLASS_PROGRESSION } from "@vtt/rules-5e";
import { ContentLibrary } from "../src/content-library.js";

// The adapter must turn every authored class record into exactly the static SRD progression row, so a
// transcription slip in either place (hit die, casting, ASI levels, multiclass prerequisites) fails here.
describe("progressionFromClass reconciliation", () => {
  const authored = loadClasses();

  it("covers the phase-2 slice (fighter, wizard, cleric are authored)", () => {
    const ids = authored.map((entry) => entry.id);
    for (const id of ["fighter", "wizard", "cleric"]) expect(ids).toContain(id);
  });

  for (const entry of loadClasses()) {
    it(`adapter(${entry.id} bundle) equals the static SRD table row`, () => {
      const adapted = progressionFromClass(entry);
      const srd = SRD_CLASS_PROGRESSION[entry.id];
      expect(srd, `${entry.id} has no SRD fallback row to reconcile against`).toBeDefined();
      expect(adapted.hitDie).toBe(srd.hitDie);
      expect(adapted.statPriority).toEqual(srd.statPriority);
      expect(adapted.primaryAbilities).toEqual(srd.primaryAbilities);
      expect(adapted.savingThrows).toEqual(srd.savingThrows);
      expect(adapted.asiLevels).toEqual(srd.asiLevels);
      expect(adapted.subclassLevel).toBe(srd.subclassLevel);
      expect(adapted.casterProgression).toBe(srd.casterProgression);
      expect(adapted.spellcastingAbility).toBe(srd.spellcastingAbility);
      expect(adapted.multiclassPrerequisite.mode).toBe(srd.multiclassPrerequisite.mode);
      expect([...adapted.multiclassPrerequisite.minimums].sort()).toEqual([...srd.multiclassPrerequisite.minimums].sort());
    });
  }

  it("builds a table where authored classes win and un-authored ones keep the SRD fallback", () => {
    const table = progressionTableFromClasses(authored);
    // Authored: the row is the adapter output, not the static object.
    expect(table.fighter).toEqual(progressionFromClass(authored.find((entry) => entry.id === "fighter")!));
    // Every SRD class is authored, so the fallback is exercised with a deliberately partial list.
    const partial = progressionTableFromClasses(authored.filter((entry) => entry.id !== "barbarian"));
    expect(partial.barbarian).toBe(SRD_CLASS_PROGRESSION.barbarian);
  });

  it("is the table the content library actually serves to the builder", () => {
    const table = new ContentLibrary().forAudience("gm").classProgressionTable();
    expect(table.wizard.casterProgression).toBe("full");
    expect(table.wizard.hitDie).toBe("d6");
    expect(table.fighter.asiLevels).toEqual([4, 6, 8, 12, 14, 16]);
    // The authored row is a different object that must still agree field for field with the static
    // table, which proves the generated content and `@vtt/rules-5e` have not drifted.
    expect(table.barbarian).not.toBe(SRD_CLASS_PROGRESSION.barbarian);
    expect(table.barbarian).toEqual(SRD_CLASS_PROGRESSION.barbarian);
    expect(table.warlock.casterProgression).toBe("pact");
  });
});
