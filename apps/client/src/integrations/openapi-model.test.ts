import { describe, expect, it } from "vitest";
import { exampleBody, typeLabel } from "./openapi-model";

const components = {
  Point: { type: "object", required: ["x"], properties: { x: { type: "integer", minimum: 0 } } }
};

describe("the API reference's schema reading", () => {
  it("labels a generated nullable as a union", () => {
    expect(typeLabel({ anyOf: [{ type: "string" }, { type: "null" }] }, components)).toBe("string | null");
    expect(typeLabel({ anyOf: [{ $ref: "#/components/schemas/Point" }, { type: "null" }] }, components)).toBe(
      "Point | null"
    );
  });

  it("writes an example from the non-null branch", () => {
    const body = {
      type: "object",
      properties: { at: { anyOf: [{ type: "null" }, { $ref: "#/components/schemas/Point" }] } }
    };
    expect(exampleBody(body, components)).toEqual({ at: { x: 0 } });
  });
});
