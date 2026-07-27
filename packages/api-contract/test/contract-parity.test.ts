import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as bundle from "@vtt/content-srd-5.2.1";
import { ActionSchema, ActionUsesSchema, ActorDefinitionSchema, EffectGrantSchema, EffectModifierSchema, EffectOnEndSchema } from "@vtt/schemas";
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
 *
 * Two families of pair exist, checked exactly as hard:
 *
 *   1. The transport shapes, whose Zod lives in `src/index.ts` beside the component. Auto-discovered
 *      by name (`<X>Schema` <-> `<X>` or `<X>Data`), so a new one is covered the moment it lands.
 *   2. The AUTHORED BODIES and every rider they hoist, whose Zod is owned by the content bundle and
 *      the actor schemas - the server parses a homebrew body with THOSE, so they are the authority
 *      and re-declaring them here would just create a third representation to drift. They cannot be
 *      auto-discovered (different package, different names), so `MIRRORS` names them once and a
 *      coverage guard below fails if any `Homebrew*` component is missing from it.
 *
 * `@vtt/content-srd-5.2.1` is a DEV dependency on purpose: `apps/client` imports this package, and
 * the SRD bundle must never reach a browser. Nothing under `src/` imports it.
 */

const openApiDocument = contract.openApiDocument as unknown as { components: { schemas: Record<string, { required?: string[]; properties?: Record<string, unknown>; additionalProperties?: boolean; oneOf?: { $ref?: string }[] }> } };
const components = openApiDocument.components.schemas;
const refName = (ref: string) => ref.replace("#/components/schemas/", "");
type UnionNode = { oneOf?: { $ref?: string }[]; discriminator?: { propertyName?: string; mapping?: Record<string, string> } };
/** The `oneOf` node itself: a whole component, or one property of one (a union can live in either place). */
const unionNode = (component: string, property?: string): UnionNode =>
  (property === undefined ? components[component] : ((components[component]?.properties ?? {}) as Record<string, UnionNode>)[property]) as UnionNode;
const branchNames = (node: UnionNode) => (node?.oneOf ?? []).flatMap((branch) => (typeof branch.$ref === "string" ? [refName(branch.$ref)] : []));
const typeConstOf = (component: string) => (components[component] as unknown as { properties?: { type?: { const?: string } } }).properties?.type?.const;

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

/** Peel the wrappers Zod puts around an object (`.strict().superRefine()`, `.transform()`, `.optional()`, `.default()`) down to the ZodObject underneath. */
function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  for (let depth = 0; depth < 8; depth += 1) {
    const definition = current._def as { schema?: z.ZodTypeAny; innerType?: z.ZodTypeAny };
    const inner = definition.schema ?? definition.innerType;
    if (!inner) break;
    current = inner;
  }
  return current;
}
const objectOf = (schema: z.ZodTypeAny): z.ZodObject<z.ZodRawShape> => {
  const inner = unwrap(schema);
  if (!(inner instanceof z.ZodObject)) throw new Error("expected a ZodObject once unwrapped");
  return inner;
};
const elementOf = (schema: z.ZodTypeAny): z.ZodTypeAny => {
  const inner = unwrap(schema);
  if (!(inner instanceof z.ZodArray)) throw new Error("expected a ZodArray once unwrapped");
  return inner.element as z.ZodTypeAny;
};
/** A union's branches in declaration order - the order the component's `oneOf` must mirror. */
const unionOptions = (schema: z.ZodTypeAny): z.ZodTypeAny[] => {
  const inner = unwrap(schema);
  if (!(inner instanceof z.ZodUnion) && !(inner instanceof z.ZodDiscriminatedUnion)) throw new Error("expected a Zod union once unwrapped");
  return [...(inner.options as z.ZodTypeAny[])];
};

/**
 * Component <-> bundle-Zod pairs. `wireOnly` names the keys the WIRE adds on top of the stored body:
 *
 *   - `type` on all nine bodies. It is the routing discriminator and lives on the ROW - the server
 *     strips it before storing, because leaving it in would make `EquipmentReferenceSchema` (the one
 *     `.strict()` content schema) reject its own record - and puts it back on everything it sends,
 *     because a pack is a bare array and each record has to be self-describing.
 *   - `id` on the monster body only. `ActorDefinitionSchema` has no `id`; the server stamps the row's
 *     id into the stored body so the merged bestiary can resolve a record back to its row.
 */
const MIRRORS: ReadonlyArray<{ component: string; schema: z.ZodTypeAny; wireOnly?: readonly string[] }> = [
  // The nine authored bodies.
  { component: "HomebrewClassRecord", schema: bundle.ClassReferenceSchema, wireOnly: ["type"] },
  { component: "HomebrewSubclassRecord", schema: bundle.SubclassReferenceSchema, wireOnly: ["type"] },
  { component: "HomebrewSpeciesRecord", schema: bundle.SpeciesReferenceSchema, wireOnly: ["type"] },
  { component: "HomebrewBackgroundRecord", schema: bundle.BackgroundReferenceSchema, wireOnly: ["type"] },
  { component: "HomebrewFeatRecord", schema: bundle.FeatReferenceSchema, wireOnly: ["type"] },
  { component: "HomebrewSpellRecord", schema: bundle.SpellReferenceSchema, wireOnly: ["type"] },
  { component: "HomebrewEquipmentRecord", schema: bundle.EquipmentReferenceSchema, wireOnly: ["type"] },
  { component: "HomebrewMonsterRecord", schema: ActorDefinitionSchema, wireOnly: ["type", "id"] },
  { component: "HomebrewSpellListRecord", schema: bundle.SpellListReferenceSchema, wireOnly: ["type"] },
  // The feature vocabulary, hoisted so the reference renderer can document it (it flattens one level).
  { component: "HomebrewFeature", schema: bundle.FeatureRecordSchema },
  { component: "HomebrewFeatureChoice", schema: bundle.FeatureChoiceSchema },
  { component: "HomebrewFeatureOption", schema: bundle.FeatureOptionSchema },
  { component: "HomebrewFeatureOptionChoice", schema: bundle.FeatureOptionChoiceSchema },
  { component: "HomebrewFeatureAction", schema: bundle.FeatureActionSchema },
  { component: "HomebrewFeatureAttack", schema: bundle.FeatureAttackSchema },
  { component: "HomebrewFeatureSave", schema: bundle.FeatureSaveSchema },
  // The DERIVED save DC is the third branch of FeatureSaveDcSchema; the other two are scalars.
  { component: "HomebrewFeatureSaveDc", schema: unionOptions(bundle.FeatureSaveDcSchema)[2] },
  { component: "HomebrewFeatureUses", schema: bundle.FeatureUsesSchema },
  { component: "HomebrewFeatureGrants", schema: bundle.FeatureGrantsSchema },
  // Record support shapes.
  { component: "HomebrewChoiceList", schema: bundle.ChoiceListSchema },
  { component: "HomebrewStartingEquipmentOption", schema: bundle.StartingEquipmentOptionSchema },
  { component: "HomebrewClassLevelRow", schema: bundle.ClassLevelRowSchema },
  { component: "HomebrewSpellcasting", schema: bundle.ContentSpellcastingSchema },
  { component: "HomebrewMulticlassPrerequisite", schema: bundle.MulticlassPrerequisiteSchema },
  // Hoisted because they are NULLABLE object properties: `fieldRows` flattens a plain nested object
  // but not a `oneOf` of one, so inlining these would render them as a bare `object | null`. Their
  // Zod counterparts are inline (unexported), reached through the parent's shape.
  { component: "HomebrewSpellShape", schema: objectOf(bundle.SpellReferenceSchema).shape.shape },
  { component: "HomebrewEquipmentWeapon", schema: objectOf(bundle.EquipmentReferenceSchema).shape.weapon },
  { component: "HomebrewEquipmentArmor", schema: objectOf(bundle.EquipmentReferenceSchema).shape.armor },
  // The actor-side vocabulary a feature or stat block reuses rather than re-inventing.
  { component: "HomebrewStatblockAction", schema: ActionSchema },
  { component: "HomebrewActionUses", schema: ActionUsesSchema },
  { component: "HomebrewActionOnHit", schema: elementOf(objectOf(ActionSchema).shape.onHit) },
  { component: "HomebrewEffectGrant", schema: EffectGrantSchema },
  { component: "HomebrewEffectOnEnd", schema: EffectOnEndSchema }
];

/**
 * Discriminated unions - whether the `oneOf` is a whole component or one property of one. The branch
 * names are read from the DOCUMENT, never listed here, so dropping a `$ref` from a union is a branch
 * COUNT mismatch against Zod rather than something only a lucky fixture would notice.
 */
const UNION_MIRRORS: ReadonlyArray<{ label: string; node: UnionNode; schema: z.ZodTypeAny }> = [
  { label: "FeatureModifierSchema", node: unionNode("HomebrewFeatureModifier"), schema: bundle.FeatureModifierSchema },
  { label: "EffectModifierSchema", node: unionNode("HomebrewEffectModifier"), schema: EffectModifierSchema },
  { label: "FeatureUsesSchema.scaling", node: unionNode("HomebrewFeatureUses", "scaling"), schema: objectOf(bundle.FeatureUsesSchema).shape.scaling },
  { label: "EffectGrantSchema.duration", node: unionNode("HomebrewEffectGrant", "duration"), schema: objectOf(EffectGrantSchema).shape.duration }
];

const timestamp = "2026-07-27T12:00:00.000Z";
const issue = { path: ["levelTable", 3, "spellSlots"], message: "A caster row must declare nine slot columns.", recordId: null };
/** A real feat body: `HomebrewFeatRecord` is the smallest branch that still exercises a HomebrewFeature. */
const record = { type: "feat", id: "hb-shield-master-a1b2c3", name: "Shield Master", source: "homebrew", description: "You use shields as weapons.", category: "general", repeatable: false, feature: { id: "shield-master", name: "Shield Master", description: "You use shields as weapons.", tags: [], actions: [], effects: [], modifiers: [] } };
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
    // `HomebrewRecordSchema` stays an OPEN ZodRecord on purpose: this package must not depend on the
    // content bundle at runtime (the client imports it), and the server already parses an authored
    // body with the bundle's own schemas. The component is NOT open - it is the nine-branch union,
    // and each branch is mirrored against those same bundle schemas in `MIRRORS`.
    expect(contract.HomebrewRecordSchema instanceof z.ZodRecord).toBe(true);
    expect(components.HomebrewRecord.additionalProperties).toBeUndefined();
    expect(components.HomebrewRecord.properties).toBeUndefined();
  });

  it("gives HomebrewRecord exactly one branch per content type, in the enum's own order", () => {
    const expected = contract.HomebrewContentTypeSchema.options.map((type) => `Homebrew${type.split("-").map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join("")}Record`);
    // "feat" -> HomebrewFeatRecord, "spell-list" -> HomebrewSpellListRecord: the naming is mechanical,
    // so a tenth content type cannot quietly land without its branch.
    const node = unionNode("HomebrewRecord");
    expect(branchNames(node)).toEqual(expected);
    expect(node.discriminator?.propertyName).toBe("type");
    expect(Object.keys(node.discriminator?.mapping ?? {})).toEqual([...contract.HomebrewContentTypeSchema.options]);
    for (const [type, ref] of Object.entries(node.discriminator?.mapping ?? {})) {
      // The branch's own `type` const must equal the key that maps to it, or the discriminator lies.
      expect(typeConstOf(refName(ref)), `${ref} discriminates as "${type}"`).toBe(type);
    }
  });

  it("Direction B (cross-package): every authored body and rider matches the Zod schema the server parses it with", () => {
    for (const { component, schema, wireOnly = [] } of MIRRORS) {
      const shape = objectOf(schema);
      expect([...(components[component].required ?? [])].sort(), `${component}.required`).toEqual([...requiredKeys(shape), ...wireOnly].sort());
      expect(Object.keys(components[component].properties ?? {}).sort(), `${component}.properties`).toEqual([...Object.keys(shape.shape), ...wireOnly].sort());
    }
  });

  it("Direction B (cross-package): every union declares exactly the branches Zod declares, in order", () => {
    for (const { label, node, schema } of UNION_MIRRORS) {
      const branches = branchNames(node);
      const options = unionOptions(schema);
      expect(branches.length, `${label}: branch count`).toBe(options.length);
      // The discriminator must name every branch, and each branch's own `type` const must equal the
      // key mapping to it - otherwise the mapping is a lie a reader would follow to the wrong shape.
      expect(Object.values(node.discriminator?.mapping ?? {}).map(refName), `${label}: discriminator mapping`).toEqual(branches);
      for (const [value, ref] of Object.entries(node.discriminator?.mapping ?? {})) {
        expect(typeConstOf(refName(ref)), `${refName(ref)} discriminates as "${value}"`).toBe(value);
      }
      branches.forEach((component, index) => {
        const shape = objectOf(options[index]);
        expect([...(components[component].required ?? [])].sort(), `${component}.required vs ${label}[${index}]`).toEqual(requiredKeys(shape));
        expect(Object.keys(components[component].properties ?? {}).sort(), `${component}.properties vs ${label}[${index}]`).toEqual(Object.keys(shape.shape).sort());
      });
    }
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

  /**
   * Direction A at bundle scale. A hand-written fixture only ever exercises the fields its author
   * remembered; every bundled SRD record exercises every rider the SRD actually prints, which is
   * what makes `additionalProperties: false` across sixty hand-authored components trustworthy. It
   * is also the honest test of "duplicate an SRD record into homebrew": that is the flow, and it has
   * to produce a body the contract accepts.
   */
  it("Direction A: every bundled SRD record validates against the homebrew branch that would carry it", () => {
    const ajv = new Ajv2020({ strict: false });
    ajv.addSchema(contract.openApiDocument as unknown as Record<string, unknown>, "openapi");
    const spellList = bundle.SpellListReferenceSchema.parse({ id: "hb-ozys-list-a1b2c3", name: "Ozy's list", source: "homebrew", basedOn: ["wizard"], add: ["fireball"], remove: ["fire-bolt"] });
    const authored: ReadonlyArray<{ component: string; type: string; records: readonly object[]; stamp?: (index: number) => object }> = [
      { component: "HomebrewClassRecord", type: "class", records: bundle.loadClasses() },
      { component: "HomebrewSubclassRecord", type: "subclass", records: bundle.loadSubclasses() },
      { component: "HomebrewSpeciesRecord", type: "species", records: bundle.loadSpecies() },
      { component: "HomebrewBackgroundRecord", type: "background", records: bundle.loadBackgrounds() },
      { component: "HomebrewFeatRecord", type: "feat", records: bundle.loadFeats() },
      { component: "HomebrewSpellRecord", type: "spell", records: bundle.loadSpells() },
      { component: "HomebrewEquipmentRecord", type: "equipment", records: bundle.loadEquipment() },
      // A monster body is an ActorDefinition, which carries no `id` - the server stamps the row's in.
      { component: "HomebrewMonsterRecord", type: "monster", records: bundle.loadMonsterDefinitions(), stamp: (index) => ({ id: `hb-monster-${index.toString(16).padStart(6, "0")}` }) },
      // No SRD bundle: a spell list is a homebrew-only record type, so it gets the one hand fixture.
      { component: "HomebrewSpellListRecord", type: "spell-list", records: [spellList] }
    ];
    for (const { component, type, records, stamp } of authored) {
      const compiled = ajv.compile({ $ref: `openapi#/components/schemas/${component}` });
      expect(records.length, `${component}: nothing to validate`).toBeGreaterThan(0);
      records.forEach((parsed, index) => {
        const body = { ...parsed, type, ...(stamp?.(index) ?? {}) };
        expect(compiled(body), `${component} #${index} (${(body as { name?: string }).name}): ${JSON.stringify(compiled.errors)}`).toBe(true);
      });
      // The same body must also satisfy the union, or the discriminator does not actually resolve.
      const union = ajv.compile({ $ref: "openapi#/components/schemas/HomebrewRecord" });
      expect(union({ ...records[0], type, ...(stamp?.(0) ?? {}) }), `${component} via HomebrewRecord: ${JSON.stringify(union.errors)}`).toBe(true);
    }
  });

  it("leaves no Homebrew* component unmirrored, so a new one cannot land unchecked", () => {
    const covered = new Set<string>([
      ...pairs.flatMap((pair) => (pair.component ? [pair.component] : [])),
      ...MIRRORS.map((mirror) => mirror.component),
      ...UNION_MIRRORS.flatMap((union) => branchNames(union.node)),
      // The three top-level unions: they have no `properties` of their own, so required/properties
      // parity is meaningless for them. Their branch SETS are asserted above instead.
      "HomebrewRecord", "HomebrewFeatureModifier", "HomebrewEffectModifier"
    ]);
    const uncovered = Object.keys(components).filter((name) => name.startsWith("Homebrew") && !covered.has(name));
    expect(uncovered, "every Homebrew* component needs a Zod counterpart or an explicit exemption").toEqual([]);
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
