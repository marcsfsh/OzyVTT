import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { openApiDocument } from "@vtt/api-contract";
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

  /**
   * The class catalog carries the full 20-row printed table and RESOLVABLE starting-equipment
   * bundles. Both were dropped on the way to the wire - the level table entirely, the equipment down
   * to a label string - so the hand-authored progression (spell slots per level, cantrips known,
   * Second Wind 2 -> 4) never reached a client and "take option A" had no items to add.
   */
  it("carries the printed level table and resolvable starting equipment on the class catalog", () => {
    const fighter = library.classSummaries().find((entry) => entry.id === "fighter")!;
    expect(fighter.levelTable).toHaveLength(20);
    expect(fighter.levelTable.map((row) => row.level)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    // Proficiency bonus is a printed column, not something the client recomputes.
    expect(fighter.levelTable[0]).toMatchObject({ level: 1, proficiencyBonus: 2 });
    expect(fighter.levelTable[19].proficiencyBonus).toBe(6);
    // A non-caster's slot columns are null ("no such column"), never a row of zeros.
    expect(fighter.levelTable[0].spellSlots).toBeNull();
    expect(fighter.levelTable[0].pactSlots).toBeNull();
    expect(fighter.levelTable[0].cantripsKnown).toBeNull();
    // Named per-level resources travel as data - this is what grows Second Wind 2 -> 3 -> 4.
    const secondWind = fighter.levelTable.find((row) => row.classResources.some((resource) => resource.id === "second-wind"));
    expect(secondWind, "fighter level table declares Second Wind uses").toBeDefined();
    const usesAtLevel = (level: number) => fighter.levelTable[level - 1].classResources.find((resource) => resource.id === "second-wind")?.amount;
    expect(usesAtLevel(10)).not.toBe(usesAtLevel(1));
    // A full caster's slot row IS nine counts, so the wizard can render the printed table.
    const wizard = library.classSummaries().find((entry) => entry.id === "wizard")!;
    expect(wizard.levelTable[0].spellSlots).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(wizard.levelTable[0].cantripsKnown).toBeGreaterThan(0);
    // Starting equipment resolves to items + the "or take N gp" alternative, not just a label.
    expect(fighter.startingEquipmentOptions.length).toBeGreaterThan(0);
    const option = fighter.startingEquipmentOptions[0];
    expect(option).toMatchObject({ id: expect.any(String), label: expect.any(String), goldPieces: expect.any(Number) });
    expect(fighter.startingEquipmentOptions.some((entry) => entry.items.length > 0), "at least one bundle names real items").toBe(true);
    expect(library.backgroundSummaries()[0].startingEquipmentOptions.every((entry) => Array.isArray(entry.items))).toBe(true);
  });

  /**
   * The served payload must satisfy its OWN published contract. `ContentClassesData` and
   * `ContentBackgroundsData` both use `additionalProperties: false`, so adding a field to the wire
   * shape without adding it to the OpenAPI schema makes the API violate its documentation - and
   * nothing else in the suite compiles the document against a real payload.
   */
  it("serves class and background catalogs that validate against the published OpenAPI schemas", () => {
    const ajv = new Ajv2020({ strict: false });
    ajv.addSchema(openApiDocument as unknown as Record<string, unknown>, "openapi");
    const validate = (schemaName: string, payload: unknown) => {
      const compiled = ajv.compile({ $ref: `openapi#/components/schemas/${schemaName}` });
      const valid = compiled(payload);
      expect(valid, JSON.stringify(compiled.errors)).toBe(true);
    };
    validate("ContentClassesData", { classes: library.classSummaries(), attribution: library.attribution });
    validate("ContentBackgroundsData", { backgrounds: library.backgroundSummaries(), attribution: library.attribution });
  });
});
