import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import character from "../../test-fixtures/actors/player-character.v1.json";
import monster from "../../test-fixtures/actors/monster.v1.json";
import torva from "../../test-fixtures/actors/torva-grimtusk.v1.json";
import pip from "../../test-fixtures/actors/pip-underbough.v1.json";
import sable from "../../test-fixtures/actors/sable-vex.v1.json";
import jsonSchema from "../json/actor-definition.v1.schema.json";
import { ActorDefinitionSchema } from "../src/index.js";

describe("actor definition v1", () => {
  const jsonValidate = new Ajv2020({ strict: false }).compile(jsonSchema);
  // The replay party carries every ADR-0020 mechanics field (grants, multiattack pools, uses,
  // criticalBonusDice) - validating them against BOTH schemas keeps the JSON twin from drifting.
  it.each([character, monster, torva, pip, sable])("accepts a representative fixture", (fixture) => {
    const parsed = ActorDefinitionSchema.safeParse(fixture);
    expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(jsonValidate(fixture), JSON.stringify(jsonValidate.errors)).toBe(true);
  });
  it("rejects unsafe or malformed dice input", () => {
    const invalid = structuredClone(monster); invalid.actions[0].damage[0].formula = "1d6; process.exit()";
    expect(ActorDefinitionSchema.safeParse(invalid).success).toBe(false); expect(jsonValidate(invalid)).toBe(false);
  });
  it("keeps character disposition safe", () => {
    const invalid = structuredClone(character); invalid.token.disposition = "hostile";
    expect(ActorDefinitionSchema.safeParse(invalid).success).toBe(false);
  });
  // The new character-sheet fields (class/proficiencies/spellcasting/inventory/currency) must parse
  // under BOTH schemas so the JSON twin can't drift from the Zod source.
  it("accepts a definition carrying the new character-sheet fields", () => {
    const withSheet = structuredClone(character) as Record<string, unknown>;
    withSheet.character = { classes: [{ id: "wizard", name: "Wizard", subclass: { id: "evocation", name: "Evocation" }, level: 5 }], race: { id: "human", name: "Human" }, background: { id: "sage", name: "Sage" }, feats: [{ id: "alert", name: "Alert" }] };
    withSheet.proficiencies = { saves: ["int", "wis"], skills: [{ id: "arcana", proficiency: "expertise" }, { id: "stealth", proficiency: "proficient" }], saveOverrides: { con: 4 } };
    withSheet.spellcasting = { ability: "int", slots: [{ level: 1, max: 4 }, { level: 2, max: 3 }], spells: [{ id: "magic-missile", name: "Magic Missile", level: 1, prepared: true, actionId: "magic-missile" }, { id: "shield", name: "Shield", level: 1, alwaysPrepared: true }] };
    withSheet.startingInventory = [{ id: "spellbook", name: "Spellbook", quantity: 1 }, { id: "dagger", name: "Dagger", quantity: 2, equipped: true }];
    withSheet.startingCurrency = { gp: 15, sp: 4 };
    const parsed = ActorDefinitionSchema.safeParse(withSheet);
    expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(jsonValidate(withSheet), JSON.stringify(jsonValidate.errors)).toBe(true);
  });
});
