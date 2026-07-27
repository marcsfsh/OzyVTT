import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as contract from "../src/index.js";

/**
 * There is no zod-to-openapi mechanism in this repo: `docs:generate` renders Markdown FROM the
 * hand-written OpenAPI literal, it does not generate that literal. Zod and OpenAPI are two parallel,
 * independently authored representations of the same wire shapes, and review does not scale to
 * keeping them in sync. This is the gate that replaces review, in both directions:
 *
 *   Direction A - a real payload parses through Zod and then validates against the component.
 *     Catches "the Zod schema emits a field the component does not allow", which under
 *     `additionalProperties: false` is an API violating its own documentation.
 *   Direction B - the component's `required` array equals the Zod schema's non-optional keys.
 *     THIS is the direction that catches a field added to `properties` but forgotten in `required`:
 *     such a field passes Direction A silently and is a documented lie. Direction B fails it
 *     mechanically, for every pair, with no fixture needed.
 */

const openApiDocument = contract.openApiDocument as unknown as { components: { schemas: Record<string, { required?: string[]; properties?: Record<string, unknown>; additionalProperties?: boolean }> } };
const components = openApiDocument.components.schemas;

/**
 * Zod schemas with no OpenAPI component, deliberately: these are the Socket.IO transport envelopes,
 * not HTTP shapes, so the served document has nothing to say about them.
 */
const TRANSPORT_ONLY = new Set(["CommandEnvelope", "EventEnvelope"]);

/** `<X>Schema` pairs with component `<X>`, or with `<X>Data` for the envelope-data convention. */
const pairs = Object.entries(contract as Record<string, unknown>).flatMap(([name, exported]) => {
  if (!name.endsWith("Schema") || !(exported instanceof z.ZodObject)) return [];
  const base = name.slice(0, -"Schema".length);
  const schema = exported as z.ZodObject<z.ZodRawShape>;
  return [{ base, schema, component: components[base] ? base : components[`${base}Data`] ? `${base}Data` : null }];
});

const requiredKeys = (schema: z.ZodObject<z.ZodRawShape>) => Object.entries(schema.shape).filter(([, value]) => !value.isOptional()).map(([key]) => key).sort();

const timestamp = "2026-07-27T12:00:00.000Z";
const issue = { path: ["levelTable", 3, "spellSlots"], message: "A caster row must declare nine slot columns.", recordId: null };
const record = { type: "feat", id: "hb-shield-master-a1b2c3", name: "Shield Master", source: "homebrew", summary: null, description: "You use shields as weapons.", attribution: null };
const document = { id: "hb-shield-master-a1b2c3", type: "feat", state: "draft", visibleToPlayers: false, deletedAt: null, rev: 3, createdAt: timestamp, updatedAt: timestamp, validity: { valid: false, issues: [issue] }, record };
const summary = { id: "hb-shield-master-a1b2c3", type: "feat", name: "Shield Master", source: "homebrew", state: "draft", visibleToPlayers: false, deletedAt: null, rev: 3, updatedAt: timestamp, valid: false, usageCount: 0 };
const pack = { schemaId: "vtt.homebrew-pack", schemaVersion: 1, name: "Ozy's feats", attribution: null, exportedAt: timestamp, records: [record] };

/**
 * Direction-A payloads, keyed by the Zod export's base name. Every homebrew pair must appear here
 * (asserted below); the older surfaces carry a representative sample, since Direction B already
 * covers all of them structurally.
 */
const FIXTURES: Record<string, unknown> = {
  HomebrewValidationIssue: issue,
  HomebrewValidity: { valid: false, issues: [issue] },
  HomebrewRecordDocument: document,
  HomebrewRecordSummary: summary,
  HomebrewContent: { record: document },
  HomebrewContentList: { records: [summary], nextCursor: null, total: 1 },
  HomebrewDeleted: { id: "hb-shield-master-a1b2c3", deleted: true, deletedAt: timestamp },
  HomebrewUsage: { actorId: "f84d13cb-a7da-4ef2-9f2f-53d38e49d862", actorName: "Brenna", kind: "character-choice", detail: "Level 4 feat" },
  HomebrewUsages: { id: "hb-shield-master-a1b2c3", usages: [{ actorId: "f84d13cb-a7da-4ef2-9f2f-53d38e49d862", actorName: "Brenna", kind: "character-choice", detail: null }], safeToDelete: true },
  HomebrewPack: pack,
  HomebrewPackExport: { pack },
  HomebrewPackImport: { imported: [{ id: "hb-shield-master-a1b2c3", type: "feat", name: "Shield Master", originalId: "hb-shield-master-a1b2c3" }], reminted: [{ originalId: "wizard", id: "hb-wizard-d4e5f6", reason: "srd-collision" }], overwritten: [], rejected: [{ originalId: "hb-broken-000000", issues: [issue] }], dryRun: true },
  HomebrewCreateRequest: { record },
  HomebrewUpdateRequest: { record, expectedRev: 3 },
  HomebrewDuplicateRequest: { name: "Shield Master (Copy)" },
  HomebrewStateChangeRequest: { expectedRev: 3 },
  HomebrewVisibilityRequest: { visibleToPlayers: true },
  // Omits both defaulted fields on purpose: Zod fills them in, and the component must accept the result.
  HomebrewPackImportRequest: { pack },
  HomebrewContentResponse: { ok: true, apiVersion: "1", data: { record: document } },
  HomebrewContentListResponse: { ok: true, apiVersion: "1", data: { records: [summary], nextCursor: null, total: 1 } },
  HomebrewDeletedResponse: { ok: true, apiVersion: "1", data: { id: "hb-shield-master-a1b2c3", deleted: true, deletedAt: timestamp } },
  HomebrewUsagesResponse: { ok: true, apiVersion: "1", data: { id: "hb-shield-master-a1b2c3", usages: [], safeToDelete: true } },
  HomebrewPackExportResponse: { ok: true, apiVersion: "1", data: { pack } },
  HomebrewPackImportResponse: { ok: true, apiVersion: "1", data: { imported: [], reminted: [], overwritten: [], rejected: [], dryRun: false } },
  SystemHealth: { status: "ok", serverTime: timestamp },
  GameCommandDescriptor: { type: "actor.apply-damage", scope: "actor:write", summary: "Applies damage" },
  IntegrationCredentialMetadata: { id: "f84d13cb-a7da-4ef2-9f2f-53d38e49d862", name: "overlay", scopes: ["system:read"], gameId: null, createdAt: timestamp, expiresAt: null, lastUsedAt: null, revokedAt: null }
};

describe("Zod / OpenAPI parity", () => {
  it("pairs every HTTP wire schema with a published component (transport envelopes excepted)", () => {
    const unpaired = pairs.filter((pair) => !pair.component && !TRANSPORT_ONLY.has(pair.base)).map((pair) => pair.base);
    expect(unpaired, "a wire schema with no component is an undocumented HTTP shape").toEqual([]);
    // The authored homebrew body is deliberately an OPEN object until each type's shape lands, so it
    // is a ZodRecord rather than a ZodObject and cannot participate in either direction yet.
    expect(contract.HomebrewRecordSchema instanceof z.ZodRecord).toBe(true);
    expect(components.HomebrewRecord.additionalProperties).toBe(true);
    expect(components.HomebrewRecord.properties).toBeUndefined();
  });

  it("Direction B: every component's `required` equals its Zod schema's non-optional keys", () => {
    for (const { base, schema, component } of pairs) {
      if (!component) continue;
      expect([...(components[component].required ?? [])].sort(), `${component}.required vs ${base}Schema`).toEqual(requiredKeys(schema));
      expect(Object.keys(components[component].properties ?? {}).sort(), `${component}.properties vs ${base}Schema`).toEqual(Object.keys(schema.shape).sort());
    }
  });

  it("Direction A: a real payload parses through Zod and validates against its component", () => {
    const ajv = new Ajv2020({ strict: false });
    ajv.addSchema(contract.openApiDocument as unknown as Record<string, unknown>, "openapi");
    for (const { base, schema, component } of pairs) {
      const fixture = FIXTURES[base];
      if (!component || fixture === undefined) continue;
      const compiled = ajv.compile({ $ref: `openapi#/components/schemas/${component}` });
      expect(compiled(schema.parse(fixture)), `${component}: ${JSON.stringify(compiled.errors)}`).toBe(true);
    }
  });

  it("keeps a Direction-A fixture for every homebrew shape, so a new component cannot land uncompiled", () => {
    const missing = pairs.filter((pair) => pair.base.startsWith("Homebrew") && FIXTURES[pair.base] === undefined).map((pair) => pair.base);
    expect(missing).toEqual([]);
    expect(pairs.filter((pair) => pair.base.startsWith("Homebrew")).length).toBeGreaterThanOrEqual(23);
  });

  it("fails a component whose `required` omits a non-optional Zod key (the grantedAtLevels failure mode)", () => {
    // The exact shape of the bug this test exists to catch: `grantedAtLevels` reached `properties`
    // and the wire type, but not `required`. Direction A passes it; Direction B must not.
    const schema = z.object({ id: z.string(), grantedAtLevels: z.array(z.number()) }).strict();
    const drifted = { required: ["id"], properties: { id: {}, grantedAtLevels: {} } };
    expect(requiredKeys(schema)).toEqual(["grantedAtLevels", "id"]);
    expect([...drifted.required].sort()).not.toEqual(requiredKeys(schema));
  });
});
