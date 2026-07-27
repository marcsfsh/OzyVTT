import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GAME_COMMAND_SCOPES, GAME_PATHS, HOMEBREW_PATHS, openApiDocument } from "../src/index.js";
import { expandOneOfBranches, oneOfBranchLines, renderApiReference } from "../src/reference.js";

type Schema = Record<string, unknown>;
const components = openApiDocument.components.schemas as unknown as Record<string, Schema>;
const refName = (ref: string) => ref.replace("#/components/schemas/", "");

/**
 * The set of components the reference is obliged to document, derived from the DOCUMENT rather than
 * from the renderer: everything a request body reaches through a property `$ref`, a property-level
 * `oneOf` branch, or a top-level `oneOf` branch.
 */
function reachableFromRequestBodies(): Set<string> {
  const seed = new Set<string>();
  const collect = (schema: Schema | undefined) => {
    for (const property of Object.values((schema?.properties ?? {}) as Record<string, Schema>)) {
      if (typeof property.$ref === "string") seed.add(refName(property.$ref));
      for (const branch of (property.oneOf ?? []) as Schema[]) if (typeof branch.$ref === "string") seed.add(refName(branch.$ref));
      const nested = property.type === "object" && property.properties ? property : property.type === "array" && (property.items as Schema | undefined)?.properties ? (property.items as Schema) : undefined;
      for (const nestedProperty of Object.values((nested?.properties ?? {}) as Record<string, Schema>)) {
        if (typeof nestedProperty.$ref === "string") seed.add(refName(nestedProperty.$ref));
      }
    }
  };
  for (const operations of Object.values(openApiDocument.paths as unknown as Record<string, Record<string, { requestBody?: { content?: Record<string, { schema?: Schema }> } }>>)) {
    for (const operation of Object.values(operations)) {
      const body = operation.requestBody?.content?.["application/json"]?.schema;
      if (body) collect(typeof body.$ref === "string" ? components[refName(body.$ref)] : body);
    }
  }
  return expandOneOfBranches(components, seed);
}

describe("generated API reference", () => {
  it("matches the committed docs/api-reference.md exactly (regenerate with `npm run docs:generate -w @vtt/api-contract`)", () => {
    const committed = readFileSync(fileURLToPath(new URL("../../../docs/api-reference.md", import.meta.url)), "utf8");
    expect(committed).toBe(renderApiReference());
  });

  it("covers every documented path, every command type, and every scope", () => {
    const rendered = renderApiReference();
    for (const path of Object.keys(openApiDocument.paths)) expect(rendered, `missing path ${path}`).toContain(` ${path}\``);
    for (const type of Object.keys(GAME_COMMAND_SCOPES)) expect(rendered, `missing command ${type}`).toContain(`\`${type}\``);
    expect(rendered).toContain(GAME_PATHS.commands);
    expect(rendered).toContain("archiveSchemaVersion");
  });

  it("routes every path to a section - GROUPS has no catch-all, so an unmatched surface renders nowhere", () => {
    const rendered = renderApiReference();
    // The homebrew surface is the newest group and the one most likely to be forgotten.
    expect(rendered).toContain("## Homebrew authoring (GM-only)");
    for (const path of Object.values(HOMEBREW_PATHS)) expect(rendered, `missing homebrew path ${path}`).toContain(` ${path}\``);
  });

  /**
   * The regression this locks down: `fieldRows` only ever collected PROPERTY-level `$ref`s, so a
   * component whose top level is a `oneOf` rendered as a bare heading and its branch components were
   * documented NOWHERE - silently, because nothing asserted on shared shapes at all.
   */
  describe("top-level oneOf components", () => {
    const union: Record<string, Schema> = {
      HomebrewRecordish: {
        oneOf: [{ $ref: "#/components/schemas/FeatBranch" }, { $ref: "#/components/schemas/ClassBranch" }],
        discriminator: { propertyName: "type", mapping: { feat: "#/components/schemas/FeatBranch", class: "#/components/schemas/ClassBranch" } }
      },
      FeatBranch: { type: "object", properties: { type: { const: "feat" } } },
      // A branch that is itself a union: the closure has to be transitive, not one level.
      ClassBranch: { oneOf: [{ $ref: "#/components/schemas/NestedBranch" }, { type: "null" }] },
      NestedBranch: { type: "object", properties: { type: { const: "class" } } },
      // A union that names itself: the closure must terminate rather than loop.
      SelfReferential: { oneOf: [{ $ref: "#/components/schemas/SelfReferential" }] }
    };

    it("pulls every branch into the documented set, transitively and without looping", () => {
      expect([...expandOneOfBranches(union, ["HomebrewRecordish"])].sort()).toEqual(["ClassBranch", "FeatBranch", "HomebrewRecordish", "NestedBranch"]);
      expect([...expandOneOfBranches(union, ["SelfReferential"])]).toEqual(["SelfReferential"]);
      // A component with no oneOf contributes nothing, so ordinary shapes are unaffected.
      expect([...expandOneOfBranches(union, ["FeatBranch"])]).toEqual(["FeatBranch"]);
    });

    it("renders a branch list naming the discriminator, instead of a heading with nothing under it", () => {
      const lines = oneOfBranchLines(union.HomebrewRecordish, union).join("\n");
      expect(lines).toContain("discriminated by `type`");
      expect(lines).toContain("- `FeatBranch`");
      expect(lines).toContain("- `ClassBranch`");
      // A real document union without a discriminator still lists its branches.
      expect(oneOfBranchLines(components.MapAssetData).join("\n")).toContain("One of the following:");
      expect(oneOfBranchLines(components.ImagePoint)).toEqual([]);
    });

    it("documents every component a request body can reach, including oneOf branches", () => {
      const rendered = renderApiReference();
      for (const name of reachableFromRequestBodies()) {
        // Request/response/envelope shapes are spelled out inline as the operation's own field table.
        if (name.endsWith("Request") || name.endsWith("Response") || name.endsWith("Envelope")) continue;
        expect(rendered, `${name} is reachable from a request body but documented nowhere`).toContain(`### \`${name}\``);
        for (const branch of (components[name].oneOf ?? []) as Schema[]) {
          if (typeof branch.$ref === "string") expect(rendered, `${name} branch ${branch.$ref} is undocumented`).toContain(`- \`${refName(branch.$ref)}\``);
        }
      }
    });
  });
});
