import { describe, expect, it } from "vitest";
import { loadClasses } from "@vtt/content-srd-5.2.1";
import { progressionFromClass, progressionTableFromClasses, SRD_CLASS_PROGRESSION } from "@vtt/rules-5e";
import { ContentLibrary } from "../src/content-library.js";

/**
 * Bundle -> rules reconciliation (known-bugs M2): the adapter must turn every AUTHORED class record
 * into exactly the progression row the static SRD table carries, field for field - a transcription
 * slip in either place fails here instead of shipping as a silent rules bug (wrong hit die, "none"
 * casting = zero slots, default ASI levels, always-pass multiclass prerequisites).
 */
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
    // Authored: the row IS the adapter output, not the static one (same values today, same object never).
    expect(table.fighter).toEqual(progressionFromClass(authored.find((entry) => entry.id === "fighter")!));
    // All twelve SRD classes are authored as of phase 5, so the fallback has to be exercised with a
    // deliberately partial list. It used to lean on barbarian happening to be unwritten, which made
    // the test quietly stop covering the fallback the moment the content caught up.
    const partial = progressionTableFromClasses(authored.filter((entry) => entry.id !== "barbarian"));
    expect(partial.barbarian).toBe(SRD_CLASS_PROGRESSION.barbarian);
  });

  it("is the table the content library actually serves to the builder", () => {
    const table = new ContentLibrary().classProgressionTable();
    expect(table.wizard.casterProgression).toBe("full");
    expect(table.wizard.hitDie).toBe("d6");
    expect(table.fighter.asiLevels).toEqual([4, 6, 8, 12, 14, 16]);
    // Barbarian is authored as of phase 5, so it is now the adapter's own row - a different object
    // that must still agree with the engine's static table field for field. That equality is the
    // real assertion: it proves the generated content and `@vtt/rules-5e` did not drift apart.
    expect(table.barbarian).not.toBe(SRD_CLASS_PROGRESSION.barbarian);
    expect(table.barbarian).toEqual(SRD_CLASS_PROGRESSION.barbarian);
    expect(table.warlock.casterProgression).toBe("pact");
  });
});
