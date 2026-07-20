import { describe, expect, it } from "vitest";
import { ContentLibrary } from "../src/content-library.js";

describe("bundled reference content exposed to the client", () => {
  const library = new ContentLibrary();

  it("flattens SRD spells into card-ready summaries (name, components, rules text)", () => {
    const spells = library.spellSummaries();
    expect(spells.length).toBeGreaterThan(300);
    // Sorted by name so the picker/matcher is stable across runs.
    const names = spells.map((spell) => spell.name);
    expect([...names]).toEqual([...names].sort((left, right) => left.localeCompare(right)));

    const fireball = spells.find((spell) => spell.name === "Fireball");
    expect(fireball).toBeDefined();
    expect(fireball).toMatchObject({ id: "fireball", level: 3, school: "evocation" });
    // Components fold to the "V, S, M (...)" string a card renders, never the raw booleans.
    expect(fireball?.componentsText).toBe("V, S, M (a ball of bat guano and sulfur)");
    expect(fireball?.description).toContain("bright streak");
  });
});
