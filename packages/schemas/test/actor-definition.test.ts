import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import character from "../../test-fixtures/actors/player-character.v1.json";
import monster from "../../test-fixtures/actors/monster.v1.json";
import jsonSchema from "../json/actor-definition.v1.schema.json";
import { ActorDefinitionSchema } from "../src/index.js";

describe("actor definition v1", () => {
  const jsonValidate = new Ajv2020({ strict: false }).compile(jsonSchema);
  it.each([character, monster])("accepts a representative fixture", (fixture) => {
    expect(ActorDefinitionSchema.safeParse(fixture).success).toBe(true);
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
