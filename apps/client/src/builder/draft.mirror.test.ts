import { describe, expect, it } from "vitest";
import { CharacterDraftSchema } from "@vtt/domain";
import { emptyDraft, type BuilderDraft } from "./build-payload";

// The server parks exactly what the wizard keeps, so every draft the wizard makes must pass the server's schema.

describe("a wizard draft is one the server will park", () => {
  it("from the first screen", () => {
    expect(CharacterDraftSchema.safeParse(emptyDraft()).success).toBe(true);
  });

  it("partway through: a class, picks, rolled scores, hit-point rolls and an Ability Score Improvement", () => {
    const draft: BuilderDraft = {
      ...emptyDraft(),
      speciesId: "dwarf",
      backgroundId: "soldier",
      classId: "fighter",
      level: 4,
      subclassId: "champion",
      abilityMethod: "roll",
      abilityPool: [
        { id: "r-0", value: 16 },
        { id: "r-1", value: 9 }
      ],
      poolAssignment: { str: "r-0", dex: null },
      backgroundBonus: [{ ability: "str", amount: 2 }],
      hpMode: "entries",
      hpEntries: [7, 3, 10],
      picks: { "class:fighter:skills": ["athletics", "perception"], "feature:fighting-style": ["defense"] },
      asiIncreases: { "level-4:asi": [{ ability: "str", amount: 2 }] },
      name: "Brunhild Stonefist"
    };
    const parsed = CharacterDraftSchema.safeParse(draft);
    expect(parsed.error?.issues ?? []).toEqual([]);
  });
});
