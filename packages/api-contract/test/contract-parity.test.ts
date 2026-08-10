import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as bundle from "@vtt/content-srd-5.2.1";
import { ActionSchema, ActionUsesSchema, ActorDefinitionSchema, EffectGrantSchema, EffectModifierSchema, EffectOnEndSchema, RiderTriggerSchema } from "@vtt/schemas";
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
  { component: "HomebrewExtraPick", schema: bundle.ExtraPickSchema },
  { component: "HomebrewReplaceableChoice", schema: bundle.ReplaceableChoiceSchema },
  // Hoisted for the same reason `HomebrewFeatureUses.scaling`'s branches are: it is a nested object
  // property, and the reference renderer flattens one level only.
  { component: "HomebrewExtraPickScaling", schema: objectOf(bundle.ExtraPickSchema).shape.scaling },
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
  // The magic-item vocabulary. Hoisted for the same reason every other rider is: `casts` is an
  // array of objects and `attunement` is a nullable-shaped one, and the renderer flattens a single
  // level, so inlining either would render it as a bare `object`.
  { component: "HomebrewItemSpellCast", schema: bundle.ItemSpellCastSchema },
  { component: "HomebrewItemAttunement", schema: bundle.ItemAttunementSchema },
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

/**
 * `HomebrewRiderTrigger` is deliberately NOT in `UNION_MIRRORS`, and that is the whole point of it.
 * Every other union is one branch per Zod option, so a branch COUNT is a faithful check. This one
 * folds its eleven parameterless moments into a single component carrying an eleven-value `type`
 * enum - twenty branches covering thirty trigger names - because eleven byte-identical `{ type }`
 * components would document nothing eleven times. A count assertion here would fail permanently on
 * the fold while still not noticing the thing that actually breaks callers: a trigger NAME that the
 * discriminator no longer routes. So the check below is by name, and `unionOfNames` is what it
 * compares - see "the rider trigger union" test.
 */
const TRIGGER_NODE = unionNode("HomebrewRiderTrigger");
/** Each Zod branch's own `type` literal, in declaration order - the names a caller actually sends. */
const typeLiterals = (options: readonly z.ZodTypeAny[]) => options.map((option) => (objectOf(option).shape.type._def as { value: string }).value);

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

  it("Direction B (cross-package): the rider trigger union routes every trigger name Zod declares, folds included", () => {
    const mapping = TRIGGER_NODE.discriminator?.mapping ?? {};
    const options = unionOptions(RiderTriggerSchema);
    const literals = typeLiterals(options);
    // THE assertion that matters: thirty names, each routable, in Zod's own declaration order. A
    // renamed, dropped, or reordered trigger fails here - which a branch count would not, because
    // the count is 20 by design and would stay 20 while a name changed underneath it.
    expect(Object.keys(mapping), "every trigger name, in Zod's declaration order").toEqual(literals);
    // Every mapped component is a documented `oneOf` branch, and no branch exists nothing maps to.
    expect(branchNames(TRIGGER_NODE), "oneOf is exactly the mapping's distinct targets").toEqual([...new Set(Object.values(mapping).map(refName))]);
    options.forEach((option, index) => {
      const component = refName(mapping[literals[index]] as string);
      const shape = objectOf(option);
      expect([...(components[component].required ?? [])].sort(), `${component}.required vs RiderTriggerSchema[${index}] "${literals[index]}"`).toEqual(requiredKeys(shape));
      expect(Object.keys(components[component].properties ?? {}).sort(), `${component}.properties vs RiderTriggerSchema[${index}] "${literals[index]}"`).toEqual(Object.keys(shape.shape).sort());
    });
    // A folded branch must accept EXACTLY the names folded into it. One short and the discriminator
    // routes a body to a component that rejects it; one extra and the document promises a trigger
    // Zod will not parse. `typeConstOf` cannot see this - a folded branch has an enum, not a const.
    const folded = new Map<string, string[]>();
    for (const [value, ref] of Object.entries(mapping)) folded.set(refName(ref), [...(folded.get(refName(ref)) ?? []), value]);
    for (const [component, values] of folded) {
      const type = (components[component].properties as Record<string, { const?: string; enum?: string[] }>).type;
      expect(type.enum ?? [type.const], `${component} accepts exactly the trigger names mapped to it`).toEqual(values);
    }
    // The fold itself, stated once so shrinking it back to one-branch-per-name is a deliberate act.
    expect([literals.length, branchNames(TRIGGER_NODE).length], "thirty-one trigger names over twenty-one branches").toEqual([31, 21]);
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

  /**
   * Direction A, branch by branch, for the rider vocabulary.
   *
   * The bundled-SRD sweep above is broad but shallow here: not one SRD row is a magic item, so
   * nothing in it exercises a gate, a cast, or an attunement block, and the day the SRD bundle does
   * gain one is not the day to find out. Each payload is PARSED first, so every `.default()`
   * materialises - which is the exact mechanism that broke the eight pre-existing modifier
   * components the moment `when` gained `default([])`: nothing about the authored body changed, but
   * `additionalProperties: false` started seeing a key that was never declared.
   *
   * The fixture maps are keyed by `type` and asserted to cover the union exactly, so a new rider or
   * trigger cannot land with no payload behind it.
   */
  describe("Direction A: the rider vocabulary, one parsed payload per branch", () => {
    const ajv = new Ajv2020({ strict: false });
    ajv.addSchema(contract.openApiDocument as unknown as Record<string, unknown>, "openapi");
    const validator = (component: string) => ajv.compile({ $ref: `openapi#/components/schemas/${component}` });

    /** One payload per trigger. Filters carry the moment they narrow, because a filter alone is refused. */
    const TRIGGERS: Record<string, object> = {
      attuned: {}, "while-armored": { weights: ["medium", "heavy"] }, "while-unarmored": {}, "while-shield": { wielding: false },
      "while-character-is": { classIds: ["cleric", "paladin"] }, "while-proficient-with": { kind: "weapon", ids: ["longsword"] },
      "while-effect-tag": { tags: ["raging"] }, "while-hp-at-or-below": { percent: 50 }, "while-condition": { conditionIds: ["prone"], present: false },
      "on-attack-roll": {}, "on-hit": {}, "on-critical-hit": {}, "on-critical-miss": {}, "on-damage-roll": {}, "on-saving-throw": {},
      "on-ability-check": {}, "on-initiative-roll": {}, "on-death-save": {}, "on-taking-damage": {}, "on-spell-cast": {},
      "attack-kind-is": { kinds: ["melee", "thrown"] }, "weapon-property-is": { properties: ["finesse"] }, "damage-type-is": { damageTypes: ["fire"] },
      "ability-is": { abilities: ["dex"] }, "skill-is": { skills: ["sleight-of-hand"] }, "spell-school-is": { schools: ["evocation"] },
      "spell-level-is": { levels: [0, 3] }, "spell-id-is": { spellIds: ["eldritch-blast"] },
      "versus-creature-type": { creatureTypes: ["undead"] }, "versus-size": { sizes: ["large", "huge"] },
      "versus-condition": { conditionIds: ["prone"] }
    };

    /** One payload per feature modifier, including the three shared with EffectModifier. */
    const MODIFIERS: Record<string, object> = {
      "ability-score": { ability: "str", amount: 2, maximum: 22 }, "hit-points-per-level": { amount: 1 }, speed: { amount: 10 },
      "armor-class": { amount: 1, whileArmored: true }, initiative: { amount: 2 }, "extra-attack": { count: 1 },
      "unarmored-defense": { ability: "con", allowShield: true }, darkvision: { feet: 60 },
      "attack-bonus": { amount: 1 },
      "extra-damage": { formula: "1d6", damageType: "fire", doubleOnCritical: true, when: [{ type: "on-hit" }, { type: "attack-kind-is", kinds: ["melee"] }] },
      "roll-mode": { roll: "concentration", mode: "advantage", scope: "bearer" },
      "save-bonus": { amount: 1, when: [{ type: "on-saving-throw" }, { type: "ability-is", abilities: ["dex"] }] },
      "check-bonus": { amount: 5, when: [{ type: "on-ability-check" }, { type: "skill-is", skills: ["sleight-of-hand"] }] },
      "spell-save-dc": { amount: 1, classId: "wizard" }, "spell-attack-bonus": { amount: 2 }, "spell-slot": { level: 3, amount: 1 },
      "resource-bonus": { poolId: "channel-divinity", amount: 1 }, "critical-range": { threshold: 19 }, "critical-bonus-dice": { count: 1 },
      "damage-reduction": { amount: 3, when: [{ type: "on-taking-damage" }, { type: "damage-type-is", damageTypes: ["cold"] }] },
      sense: { sense: "tremorsense", feet: 30 }
    };

    it("validates every trigger against the branch its discriminator routes it to", () => {
      const literals = typeLiterals(unionOptions(RiderTriggerSchema));
      expect(Object.keys(TRIGGERS).sort(), "a trigger with no payload behind it is an unexercised branch").toEqual([...literals].sort());
      const compiled = validator("HomebrewRiderTrigger");
      for (const [type, body] of Object.entries(TRIGGERS)) {
        const parsed = RiderTriggerSchema.parse({ type, ...body });
        expect(compiled(parsed), `${type}: ${JSON.stringify(compiled.errors)}`).toBe(true);
      }
    });

    it("validates every feature modifier against the branch its discriminator routes it to", () => {
      const literals = typeLiterals(unionOptions(bundle.FeatureModifierSchema));
      expect(Object.keys(MODIFIERS).sort(), "a modifier with no payload behind it is an unexercised branch").toEqual([...literals].sort());
      const compiled = validator("HomebrewFeatureModifier");
      for (const [type, body] of Object.entries(MODIFIERS)) {
        const parsed = bundle.FeatureModifierSchema.parse({ type, ...body });
        expect(compiled(parsed), `${type}: ${JSON.stringify(compiled.errors)}`).toBe(true);
      }
      // The three shared branches must ALSO validate as effect modifiers - they are one component
      // referenced by both unions, so a change made for one silently reaches the other.
      const asEffect = validator("HomebrewEffectModifier");
      for (const type of ["attack-bonus", "extra-damage", "roll-mode"]) {
        const parsed = EffectModifierSchema.parse({ type, ...MODIFIERS[type] });
        expect(asEffect(parsed), `${type} as an effect modifier: ${JSON.stringify(asEffect.errors)}`).toBe(true);
      }
    });

    /** A whole cursed, attuned, spell-casting magic item: the fields no SRD row will ever exercise. */
    it("validates a fully-loaded magic item against HomebrewEquipmentRecord and the record union", () => {
      const authored = bundle.EquipmentReferenceSchema.parse({
        id: "hb-berserker-axe-a1b2c3", name: "Berserker Axe", source: "homebrew",
        category: "weapon", slot: "weapon", rarity: "rare", costGp: null, weightLb: 4, description: "It hungers.",
        weapon: { category: "martial", damageDice: "1d8", damageType: "slashing", rangeFeet: null, longRangeFeet: null }, armor: null,
        isMagic: true, cursed: true, attunement: { required: true, restrictedTo: ["barbarian"] },
        casts: [{ spellId: "message", atLevel: 0, uses: { limit: 1, per: "long-rest", pool: "axe-charges" }, consumesSpellSlot: false }],
        grantsFeatIds: ["savage-attacker"],
        tags: ["cursed"], uses: { limit: 3, per: "long-rest", pool: "axe-charges" }, grants: { damageResistances: ["slashing"] },
        effects: [{ tags: ["axe-rage"], duration: { type: "encounter" } }],
        modifiers: [
          { type: "attack-bonus", amount: 1, scope: "this-item" },
          { type: "extra-damage", formula: "1d6", damageType: "necrotic", when: [{ type: "on-hit" }, { type: "attack-kind-is", kinds: ["melee"] }] },
          { type: "roll-mode", roll: "save", mode: "disadvantage", when: [{ type: "while-hp-at-or-below", percent: 50 }] },
          { type: "armor-class", amount: 1, when: [{ type: "attuned" }] }
        ]
      });
      // `type` is stamped on the WIRE, never stored - `EquipmentReferenceSchema` is `.strict()` and
      // would reject its own record with it present. Same stamp the bundled-SRD sweep applies.
      const body = { ...authored, type: "equipment" };
      const compiled = validator("HomebrewEquipmentRecord");
      expect(compiled(body), `HomebrewEquipmentRecord: ${JSON.stringify(compiled.errors)}`).toBe(true);
      const union = validator("HomebrewRecord");
      expect(union(body), `via HomebrewRecord: ${JSON.stringify(union.errors)}`).toBe(true);
      // The refusal is a CARRIER rule, not a vocabulary one: the identical rider on a feat parses.
      expect(() => bundle.EquipmentReferenceSchema.parse({ ...authored, modifiers: [{ type: "ability-score", ability: "str", amount: 2 }] })).toThrow();
    });
  });

  it("leaves no Homebrew* component unmirrored, so a new one cannot land unchecked", () => {
    const covered = new Set<string>([
      ...pairs.flatMap((pair) => (pair.component ? [pair.component] : [])),
      ...MIRRORS.map((mirror) => mirror.component),
      ...UNION_MIRRORS.flatMap((union) => branchNames(union.node)),
      // The trigger union's branches are mirrored by name rather than by index (the fold), so they
      // are collected from the document the same way - never listed, or the list would be the hole.
      ...branchNames(TRIGGER_NODE),
      // The four top-level unions: they have no `properties` of their own, so required/properties
      // parity is meaningless for them. Their branch SETS are asserted above instead.
      "HomebrewRecord", "HomebrewFeatureModifier", "HomebrewEffectModifier", "HomebrewRiderTrigger"
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
