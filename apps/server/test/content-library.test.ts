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
    // Base damage + SRD upcast scaling drive the sheet's "cast at" auto-roll (Fireball: 8d6, +1d6/level).
    expect(fireball?.damageRoll).toBe("8d6");
    expect(fireball?.damageTypes).toEqual(["fire"]);
    expect(fireball?.castingOptions.find((option) => option.level === 4)).toEqual({ level: 4, damageRoll: "9d6", targetCount: null });
    expect(fireball?.castingOptions.find((option) => option.level === 9)).toMatchObject({ damageRoll: "14d6" });
    // Only slot-level upcasts are surfaced (cantrip character-level scaling is filtered out).
    expect(fireball?.castingOptions.every((option) => option.level >= 4 && option.level <= 9)).toBe(true);
    // A target-scaling spell carries the count, not a new damage roll (Scorching Ray: +1 ray/level).
    const scorchingRay = spells.find((spell) => spell.id === "scorching-ray");
    expect(scorchingRay?.castingOptions.find((option) => option.level === 3)).toEqual({ level: 3, damageRoll: null, targetCount: 4 });
  });

  it("exposes the folded equipment catalog the sheet's browse-and-add picker reads", () => {
    const equipment = library.equipmentSummaries();
    // Gear bundle + weapons + armor, all in the one wire shape (see the content package's fold test).
    expect(equipment.length).toBeGreaterThan(150);
    const categories = new Set(equipment.map((item) => item.category));
    for (const category of ["weapon", "armor", "shield", "ammunition", "adventuring-gear", "tool", "equipment-pack", "focus", "consumable"]) {
      expect(categories, category).toContain(category);
    }
    // A weapon carries its structured block; a gear entry carries cost/weight and neither sub-object.
    expect(equipment.find((item) => item.id === "longsword")).toMatchObject({ category: "weapon", weapon: { damageDice: "1d8", damageType: "slashing" }, armor: null });
    expect(equipment.find((item) => item.id === "thieves-tools")).toMatchObject({ category: "tool", costGp: 25, weightLb: 1, weapon: null, armor: null });
    // The attribution line is available for any surface that renders the catalog (CC-BY requirement).
    expect(library.attribution).toContain("System Reference Document 5.2.1");
  });
});
