import { describe, expect, it } from "vitest";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { parseDiceFormula } from "@vtt/rules-5e";
import { loadAttribution, loadConditions, loadMonsterDefinitions } from "../src/index.js";

describe("SRD 5.2.1 monster bundle", () => {
  const monsters = loadMonsterDefinitions();

  it("contains the full srd-2024 bestiary", () => {
    expect(monsters.length).toBe(331);
    const ids = monsters.map((monster) => monster.source.externalId);
    expect(new Set(ids).size).toBe(monsters.length);
  });

  it("every definition passes the canonical schema", () => {
    for (const monster of monsters) {
      const parsed = ActorDefinitionSchema.safeParse(monster);
      expect(parsed.success, `${monster.name}: ${JSON.stringify(!parsed.success && parsed.error.issues[0])}`).toBe(true);
    }
  });

  it("every damage and hit-point formula parses with the authoritative dice grammar", () => {
    for (const monster of monsters) {
      if (monster.hitPoints.formula) expect(() => parseDiceFormula(monster.hitPoints.formula!), `${monster.name} hp`).not.toThrow();
      for (const action of monster.actions) for (const part of action.damage) {
        expect(() => parseDiceFormula(part.formula), `${monster.name}/${action.id}`).not.toThrow();
      }
    }
  });

  it("adapts the aboleth stat block faithfully", () => {
    const aboleth = monsters.find((monster) => monster.source.externalId === "aboleth");
    expect(aboleth).toBeDefined();
    expect(aboleth!.armorClass).toBe(17);
    expect(aboleth!.hitPoints).toEqual({ maximum: 150, formula: "20d10 + 40" });
    expect(aboleth!.abilityScores.str).toBe(21);
    expect(aboleth!.size).toBe("large");
    expect(aboleth!.token).toEqual({ disposition: "hostile", footprint: { width: 2, height: 2 } });
    expect(aboleth!.proficiencyBonus).toBe(4);
    const tentacle = aboleth!.actions.find((action) => action.id === "tentacle");
    expect(tentacle?.attack).toEqual({ bonus: 9, reachFeet: 15 });
    expect(tentacle?.damage[0]).toEqual({ formula: "2d6 + 5", type: "bludgeoning" });
    const consume = aboleth!.actions.find((action) => action.id === "consume-memories");
    expect(consume?.save).toEqual({ ability: "int", dc: 16 });
  });

  it("keeps monsters hostile and within token footprint bounds", () => {
    for (const monster of monsters) {
      expect(monster.token.disposition).toBe("hostile");
      expect(monster.token.footprint.width).toBeGreaterThanOrEqual(1);
      expect(monster.token.footprint.width).toBeLessThanOrEqual(4);
    }
  });
});

describe("SRD 5.2.1 conditions", () => {
  it("carries the fifteen standard conditions", () => {
    const conditions = loadConditions();
    expect(conditions.map((condition) => condition.id)).toEqual([
      "blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated",
      "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"
    ]);
  });
});

describe("attribution", () => {
  it("carries the required CC BY 4.0 statement", () => {
    const attribution = loadAttribution();
    expect(attribution.license).toBe("CC-BY-4.0");
    expect(attribution.attribution).toContain("System Reference Document 5.2.1");
    expect(attribution.attribution).toContain("Creative Commons Attribution 4.0");
  });
});
