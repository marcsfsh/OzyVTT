import { describe, expect, it } from "vitest";
import { documentedExample, exampleBody, typeLabel, ungrouped } from "./openapi-model";

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

describe("the API reference's operation reading", () => {
  it("reads a documented request example, and nothing when there is none", () => {
    const operation = {
      responses: {},
      requestBody: { content: { "application/json": { schema: {}, example: { name: "Stream overlay" } } } }
    };
    expect(documentedExample(operation)).toEqual({ name: "Stream overlay" });
    expect(documentedExample({ responses: {} })).toBeNull();
  });

  it("groups every path prefix the server documents", () => {
    const paths = [
      "/api/v1/host/setup",
      "/api/v1/token-assets",
      "/api/v1/sound-assets/{id}",
      "/api/v1/map-assets/{id}/grid",
      "/api/v1/codex/pages"
    ];
    expect(ungrouped(paths)).toEqual([]);
  });
});
