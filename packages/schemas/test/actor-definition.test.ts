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
});
