import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GAME_COMMAND_SCOPES, GAME_PATHS, HOMEBREW_PATHS, openApiDocument } from "../src/index.js";
import { expandReferencedComponents, oneOfBranchLines, renderApiReference } from "../src/reference.js";

type Schema = Record<string, unknown>;
const components = openApiDocument.components.schemas as unknown as Record<string, Schema>;
const refName = (ref: string) => ref.replace("#/components/schemas/", "");

/**
 * The set of components the reference is OBLIGED to document, walked here independently of
 * `reference.ts`: every `$ref` a JSON request body reaches, transitively.
 *
 * Deliberately NOT reusing the renderer's own closure. A renderer that stops following refs would
 * otherwise shrink the obligation by exactly as much as it shrinks the output, and the test would
 * stay green while the documentation hole reopened - which is precisely the failure mode this whole
 * clause exists to prevent.
 */
function reachableFromRequestBodies(): Set<string> {
  const found = new Set<string>();
  const pending: Schema[] = [];
  const visit = (schema: Schema | undefined) => {
    if (!schema || typeof schema !== "object") return;
    if (typeof schema.$ref === "string") {
      const name = refName(schema.$ref);
      if (!found.has(name)) { found.add(name); pending.push(components[name]); }
      return;
    }
    for (const key of ["oneOf", "anyOf", "allOf"] as const) for (const branch of (schema[key] ?? []) as Schema[]) visit(branch);
    for (const property of Object.values((schema.properties ?? {}) as Record<string, Schema>)) visit(property);
    visit(schema.items as Schema | undefined);
    if (typeof schema.additionalProperties === "object") visit(schema.additionalProperties as Schema);
  };
  for (const operations of Object.values(openApiDocument.paths as unknown as Record<string, Record<string, { requestBody?: { content?: Record<string, { schema?: Schema }> } }>>)) {
    for (const operation of Object.values(operations)) visit(operation.requestBody?.content?.["application/json"]?.schema);
  }
  while (pending.length > 0) visit(pending.pop());
  return found;
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
   * The regression this locks down: `fieldRows` only ever collected PROPERTY-level `$ref`s of the
   * component it was handed, and the "Shared shapes" loop discards what it collects. So a component
   * whose top level is a `oneOf` rendered as a bare heading with its branches documented NOWHERE,
   * and a rider a branch reaches through a property or an `items` ref was invisible too - silently,
   * because nothing asserted on shared shapes at all.
   */
  describe("components reachable only transitively", () => {
    const union: Record<string, Schema> = {
      HomebrewRecordish: {
        oneOf: [{ $ref: "#/components/schemas/FeatBranch" }, { $ref: "#/components/schemas/ClassBranch" }],
        discriminator: { propertyName: "type", mapping: { feat: "#/components/schemas/FeatBranch", class: "#/components/schemas/ClassBranch" } }
      },
      // A branch reaching a hoisted rider two ways: a plain property ref, and an array's items ref.
      FeatBranch: { type: "object", properties: { type: { const: "feat" }, feature: { $ref: "#/components/schemas/Rider" } } },
      // A branch that is itself a union: the closure has to be transitive, not one level.
      ClassBranch: { oneOf: [{ $ref: "#/components/schemas/NestedBranch" }, { type: "null" }] },
      NestedBranch: { type: "object", properties: { type: { const: "class" }, features: { type: "array", items: { $ref: "#/components/schemas/Rider" } } } },
      // The rider names itself back, the way feature -> choice -> option -> feature does.
      Rider: { type: "object", properties: { choice: { oneOf: [{ $ref: "#/components/schemas/Rider" }, { type: "null" }] } } },
      // A union that names itself: the closure must terminate rather than loop.
      SelfReferential: { oneOf: [{ $ref: "#/components/schemas/SelfReferential" }] },
      Plain: { type: "object", properties: { name: { type: "string" } } }
    };

    it("pulls every branch and every hoisted rider into the documented set, transitively and without looping", () => {
      expect([...expandReferencedComponents(union, ["HomebrewRecordish"])].sort()).toEqual(["ClassBranch", "FeatBranch", "HomebrewRecordish", "NestedBranch", "Rider"]);
      // Reached only through an array's `items`, which is the shape of every rider list on a record.
      expect([...expandReferencedComponents(union, ["NestedBranch"])].sort()).toEqual(["NestedBranch", "Rider"]);
      expect([...expandReferencedComponents(union, ["SelfReferential"])]).toEqual(["SelfReferential"]);
      // A component that names no other contributes nothing, so ordinary shapes are unaffected.
      expect([...expandReferencedComponents(union, ["Plain"])]).toEqual(["Plain"]);
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
