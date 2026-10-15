import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as bundle from "@vtt/content-srd-5.2.1";
import { ModifierSchema, RiderTriggerSchema } from "@vtt/schemas";
import * as contract from "@vtt/api-contract";
import { openApiDocument } from "../src/openapi/document.js";

/**
 * The components generated from Zod (`src/openapi/components.ts`) must accept what the server really sends and
 * parses: each payload is parsed through its Zod schema first, so every `.default()` is filled in, and then
 * validated against the component with Ajv. `@vtt/content-srd-5.2.1` is a dev dependency only: `apps/client`
 * imports this package and the SRD bundle must never reach a browser.
 */

const components = (openApiDocument as unknown as { components: { schemas: Record<string, Record<string, unknown>> } })
  .components.schemas;
const refName = (ref: string) => ref.replace("#/components/schemas/", "");
type UnionNode = {
  oneOf?: { $ref?: string }[];
  discriminator?: { propertyName?: string; mapping?: Record<string, string> };
};
const branchNames = (node: UnionNode) =>
  (node?.oneOf ?? []).flatMap((branch) => (typeof branch.$ref === "string" ? [refName(branch.$ref)] : []));
const typeConstOf = (component: string) =>
  (components[component] as { properties?: { type?: { const?: string } } }).properties?.type?.const;
const unionNode = (component: string) => components[component] as UnionNode;

/** Every exported `<X>Schema` object in the contract, documented as component `<X>`. */
const pairs = Object.entries(contract as Record<string, unknown>).flatMap(([name, exported]) =>
  name.endsWith("Schema") && exported instanceof z.ZodObject
    ? [{ base: name.slice(0, -"Schema".length), schema: exported as z.ZodObject }]
    : []
);
/** A union's `type` literals in declaration order. */
const typeLiterals = (schema: z.ZodType) =>
  (schema as z.ZodDiscriminatedUnion<z.ZodObject[]>).options.map(
    (option) => (option.shape.type as z.ZodLiteral<string>).value
  );

const timestamp = "2026-07-27T12:00:00.000Z";
const issue = {
  path: ["levelTable", 3, "spellSlots"],
  message: "A caster row must declare nine slot columns.",
  recordId: null
};
/** A real feat body: `HomebrewFeatRecord` is the smallest branch that still exercises a HomebrewFeature. */
const record = {
  type: "feat",
  id: "hb-shield-master-a1b2c3",
  name: "Shield Master",
  source: "homebrew",
  description: "You use shields as weapons.",
  category: "general",
  repeatable: false,
  feature: {
    id: "shield-master",
    name: "Shield Master",
    description: "You use shields as weapons.",
    tags: [],
    actions: [],
    effects: [],
    modifiers: []
  }
};
const document = {
  id: "hb-shield-master-a1b2c3",
  type: "feat",
  state: "draft",
  visibleToPlayers: false,
  deletedAt: null,
  rev: 3,
  createdAt: timestamp,
  updatedAt: timestamp,
  validity: { valid: false, issues: [issue], warnings: [] },
  record
};
const summary = {
  id: "hb-shield-master-a1b2c3",
  type: "feat",
  name: "Shield Master",
  source: "homebrew",
  state: "draft",
  visibleToPlayers: false,
  deletedAt: null,
  rev: 3,
  updatedAt: timestamp,
  valid: false,
  usageCount: 0
};
const pack = {
  schemaId: "vtt.homebrew-pack",
  schemaVersion: 1,
  name: "Ozy's feats",
  attribution: null,
  exportedAt: timestamp,
  records: [record]
};

/** Payloads keyed by the Zod export's base name. Every homebrew pair must appear; older surfaces carry a sample. */
const FIXTURES: Record<string, unknown> = {
  HomebrewValidationIssue: issue,
  HomebrewValidity: { valid: false, issues: [issue], warnings: [issue] },
  HomebrewRecordDocument: document,
  HomebrewRecordSummary: summary,
  HomebrewContent: { record: document },
  HomebrewContentList: { records: [summary], nextCursor: null, total: 1 },
  HomebrewDeleted: { id: "hb-shield-master-a1b2c3", deleted: true, deletedAt: timestamp },
  HomebrewUsage: {
    actorId: "f84d13cb-a7da-4ef2-9f2f-53d38e49d862",
    actorName: "Brenna",
    kind: "character-choice",
    detail: "Level 4 feat"
  },
  HomebrewUsages: {
    id: "hb-shield-master-a1b2c3",
    usages: [
      { actorId: "f84d13cb-a7da-4ef2-9f2f-53d38e49d862", actorName: "Brenna", kind: "character-choice", detail: null }
    ],
    safeToDelete: true
  },
  HomebrewPack: pack,
  HomebrewPackExport: { pack },
  HomebrewPackImport: {
    imported: [
      { id: "hb-shield-master-a1b2c3", type: "feat", name: "Shield Master", originalId: "hb-shield-master-a1b2c3" }
    ],
    reminted: [{ originalId: "wizard", id: "hb-wizard-d4e5f6", reason: "srd-collision" }],
    overwritten: [],
    rejected: [{ originalId: "hb-broken-000000", issues: [issue] }],
    dryRun: true
  },
  HomebrewCreateRequest: { record },
  HomebrewUpdateRequest: { record, expectedRev: 3 },
  HomebrewDuplicateRequest: { name: "Shield Master (Copy)" },
  HomebrewStateChangeRequest: { expectedRev: 3 },
  HomebrewVisibilityRequest: { visibleToPlayers: true },
  // Omits both defaulted fields: Zod fills them in, and the component must accept the result.
  HomebrewPackImportRequest: { pack },
  HomebrewContentResponse: { ok: true, apiVersion: "1", data: { record: document } },
  HomebrewContentListResponse: { ok: true, apiVersion: "1", data: { records: [summary], nextCursor: null, total: 1 } },
  HomebrewDeletedResponse: {
    ok: true,
    apiVersion: "1",
    data: { id: "hb-shield-master-a1b2c3", deleted: true, deletedAt: timestamp }
  },
  HomebrewUsagesResponse: {
    ok: true,
    apiVersion: "1",
    data: { id: "hb-shield-master-a1b2c3", usages: [], safeToDelete: true }
  },
  HomebrewPackExportResponse: { ok: true, apiVersion: "1", data: { pack } },
  HomebrewPackImportResponse: {
    ok: true,
    apiVersion: "1",
    data: { imported: [], reminted: [], overwritten: [], rejected: [], dryRun: false }
  },
  SystemHealth: { status: "ok", serverTime: timestamp },
  GameCommandDescriptor: { type: "actor.apply-damage", scope: "actor:write", summary: "Applies damage" },
  IntegrationCredentialMetadata: {
    id: "f84d13cb-a7da-4ef2-9f2f-53d38e49d862",
    name: "overlay",
    scopes: ["system:read"],
    gameId: null,
    createdAt: timestamp,
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null
  }
};

describe("generated OpenAPI components", () => {
  it("gives HomebrewRecord exactly one branch per content type, in the enum's own order", () => {
    const expected = contract.HomebrewContentTypeSchema.options.map(
      (type) =>
        `Homebrew${type
          .split("-")
          .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
          .join("")}Record`
    );
    // The naming is mechanical, so a new content type cannot land without its branch.
    const node = unionNode("HomebrewRecord");
    expect(branchNames(node)).toEqual(expected);
    expect(node.discriminator?.propertyName).toBe("type");
    expect(Object.keys(node.discriminator?.mapping ?? {})).toEqual([...contract.HomebrewContentTypeSchema.options]);
    for (const [type, ref] of Object.entries(node.discriminator?.mapping ?? {})) {
      // The branch's own `type` const must equal the key that maps to it, or the discriminator lies.
      expect(typeConstOf(refName(ref)), `${ref} discriminates as "${type}"`).toBe(type);
    }
  });

  it("a real payload parses through Zod and validates against its component", () => {
    const ajv = new Ajv2020({ strict: false });
    ajv.addSchema(openApiDocument as unknown as Record<string, unknown>, "openapi");
    for (const { base, schema } of pairs) {
      const fixture = FIXTURES[base];
      if (fixture === undefined) continue;
      const compiled = ajv.compile({ $ref: `openapi#/components/schemas/${base}` });
      expect(compiled(schema.parse(fixture)), `${base}: ${JSON.stringify(compiled.errors)}`).toBe(true);
    }
  });

  /** At bundle scale: every bundled SRD record must validate as the homebrew body that would carry it
   * (the "duplicate an SRD record into homebrew" flow). */
  it("every bundled SRD record validates against the homebrew branch that would carry it", () => {
    const ajv = new Ajv2020({ strict: false });
    ajv.addSchema(openApiDocument as unknown as Record<string, unknown>, "openapi");
    const spellList = bundle.SpellListReferenceSchema.parse({
      id: "hb-ozys-list-a1b2c3",
      name: "Ozy's list",
      source: "homebrew",
      basedOn: ["wizard"],
      add: ["fireball"],
      remove: ["fire-bolt"]
    });
    const authored: ReadonlyArray<{
      component: string;
      type: string;
      records: readonly object[];
      stamp?: (index: number) => object;
    }> = [
      { component: "HomebrewClassRecord", type: "class", records: bundle.loadClasses() },
      { component: "HomebrewSubclassRecord", type: "subclass", records: bundle.loadSubclasses() },
      { component: "HomebrewSpeciesRecord", type: "species", records: bundle.loadSpecies() },
      { component: "HomebrewBackgroundRecord", type: "background", records: bundle.loadBackgrounds() },
      { component: "HomebrewFeatRecord", type: "feat", records: bundle.loadFeats() },
      { component: "HomebrewSpellRecord", type: "spell", records: bundle.loadSpells() },
      { component: "HomebrewEquipmentRecord", type: "equipment", records: bundle.loadEquipment() },
      // A monster body is an ActorDefinition with no `id`; the server stamps the row's id in.
      {
        component: "HomebrewMonsterRecord",
        type: "monster",
        records: bundle.loadMonsterDefinitions(),
        stamp: (index) => ({ id: `hb-monster-${index.toString(16).padStart(6, "0")}` })
      },
      // Spell lists are homebrew-only, so this uses the one hand fixture.
      { component: "HomebrewSpellListRecord", type: "spell-list", records: [spellList] }
    ];
    for (const { component, type, records, stamp } of authored) {
      const compiled = ajv.compile({ $ref: `openapi#/components/schemas/${component}` });
      expect(records.length, `${component}: nothing to validate`).toBeGreaterThan(0);
      records.forEach((parsed, index) => {
        const body = { ...parsed, type, ...(stamp?.(index) ?? {}) };
        expect(
          compiled(body),
          `${component} #${index} (${(body as { name?: string }).name}): ${JSON.stringify(compiled.errors)}`
        ).toBe(true);
      });
      // The same body must also satisfy the union.
      const union = ajv.compile({ $ref: "openapi#/components/schemas/HomebrewRecord" });
      expect(
        union({ ...records[0], type, ...(stamp?.(0) ?? {}) }),
        `${component} via HomebrewRecord: ${JSON.stringify(union.errors)}`
      ).toBe(true);
    }
  });

  /** Per rider branch. No SRD row is a magic item, so the bundle sweep never exercises gates, casts or
   * attunement. Payloads are parsed first so every `.default()` materialises, which is what `additionalProperties:
   * false` sees. Fixture maps must cover each union exactly. */
  describe("the rider vocabulary, one parsed payload per branch", () => {
    const ajv = new Ajv2020({ strict: false });
    ajv.addSchema(openApiDocument as unknown as Record<string, unknown>, "openapi");
    const validator = (component: string) => ajv.compile({ $ref: `openapi#/components/schemas/${component}` });

    /** One payload per trigger. Filters carry the moment they narrow, because a filter alone is refused. */
    const TRIGGERS: Record<string, object> = {
      attuned: {},
      "while-armored": { weights: ["medium", "heavy"] },
      "while-unarmored": {},
      "while-shield": { wielding: false },
      "while-character-is": { classIds: ["cleric", "paladin"] },
      "while-proficient-with": { kind: "weapon", ids: ["longsword"] },
      "while-effect-tag": { tags: ["raging"] },
      "while-hp-at-or-below": { percent: 50 },
      "while-condition": { conditionIds: ["prone"], present: false },
      "on-attack-roll": {},
      "on-hit": {},
      "on-critical-hit": {},
      "on-damage-roll": {},
      "on-saving-throw": {},
      "on-ability-check": {},
      "on-initiative-roll": {},
      "on-taking-damage": {},
      "attack-kind-is": { kinds: ["melee", "thrown"] },
      "weapon-property-is": { properties: ["finesse"] },
      "damage-type-is": { damageTypes: ["fire"] },
      "ability-is": { abilities: ["dex"] },
      "skill-is": { skills: ["sleight-of-hand"] },
      "spell-school-is": { schools: ["evocation"] },
      "spell-level-is": { levels: [0, 3] },
      "spell-id-is": { spellIds: ["eldritch-blast"] },
      "versus-creature-type": { creatureTypes: ["undead"] },
      "versus-size": { sizes: ["large", "huge"] },
      "versus-condition": { conditionIds: ["prone"] }
    };

    /** One payload per modifier. */
    const MODIFIERS: Record<string, object> = {
      "ability-score": { ability: "str", amount: 2, maximum: 22 },
      "hit-points-per-level": { amount: 1 },
      speed: { amount: 10 },
      "armor-class": { amount: 1, whileArmored: true },
      initiative: { amount: 2 },
      "extra-attack": { count: 1 },
      "unarmored-defense": { ability: "con", allowShield: true },
      darkvision: { feet: 60 },
      "attack-bonus": { amount: 1 },
      "extra-damage": {
        formula: "1d6",
        damageType: "fire",
        doubleOnCritical: true,
        when: [{ type: "on-hit" }, { type: "attack-kind-is", kinds: ["melee"] }]
      },
      "roll-mode": { roll: "concentration", mode: "advantage", scope: "bearer" },
      "save-bonus": { amount: 1, when: [{ type: "on-saving-throw" }, { type: "ability-is", abilities: ["dex"] }] },
      "check-bonus": {
        amount: 5,
        when: [{ type: "on-ability-check" }, { type: "skill-is", skills: ["sleight-of-hand"] }]
      },
      "damage-bonus": { amount: 7, when: [{ type: "on-critical-hit" }] },
      "spell-save-dc": { amount: 1, classId: "wizard" },
      "spell-attack-bonus": { amount: 2 },
      "spell-slot": { level: 3, amount: 1 },
      "resource-bonus": { poolId: "channel-divinity", amount: 1 },
      "critical-range": { threshold: 19 },
      "critical-bonus-dice": { count: 1 },
      "damage-reduction": {
        amount: 3,
        when: [{ type: "on-taking-damage" }, { type: "damage-type-is", damageTypes: ["cold"] }]
      },
      "damage-resistance": { damageTypes: ["fire"], when: [{ type: "while-effect-tag", tags: ["raging"] }] },
      "damage-vulnerability": { damageTypes: ["cold"] },
      sense: { sense: "tremorsense", feet: 30 }
    };

    it("validates every trigger against the branch its discriminator routes it to", () => {
      const literals = typeLiterals(RiderTriggerSchema);
      expect(Object.keys(TRIGGERS).sort(), "a trigger with no payload behind it is an unexercised branch").toEqual(
        [...literals].sort()
      );
      const compiled = validator("RiderTrigger");
      for (const [type, body] of Object.entries(TRIGGERS)) {
        const parsed = RiderTriggerSchema.parse({ type, ...body });
        expect(compiled(parsed), `${type}: ${JSON.stringify(compiled.errors)}`).toBe(true);
      }
    });

    it("validates every modifier against the branch its discriminator routes it to", () => {
      const literals = typeLiterals(ModifierSchema);
      expect(Object.keys(MODIFIERS).sort(), "a modifier with no payload behind it is an unexercised branch").toEqual(
        [...literals].sort()
      );
      const compiled = validator("Modifier");
      for (const [type, body] of Object.entries(MODIFIERS)) {
        const parsed = ModifierSchema.parse({ type, ...body });
        expect(compiled(parsed), `${type}: ${JSON.stringify(compiled.errors)}`).toBe(true);
      }
    });

    /** A cursed, attuned, spell-casting magic item: fields no SRD row exercises. */
    it("validates a fully-loaded magic item against HomebrewEquipmentRecord and the record union", () => {
      const authored = bundle.EquipmentReferenceSchema.parse({
        id: "hb-berserker-axe-a1b2c3",
        name: "Berserker Axe",
        source: "homebrew",
        category: "weapon",
        slot: "weapon",
        rarity: "rare",
        costGp: null,
        weightLb: 4,
        description: "It hungers.",
        weapon: {
          category: "martial",
          damageDice: "1d8",
          damageType: "slashing",
          rangeFeet: null,
          longRangeFeet: null
        },
        armor: null,
        isMagic: true,
        cursed: true,
        attunement: { required: true, restrictedTo: ["barbarian"] },
        casts: [
          {
            spellId: "message",
            atLevel: 0,
            uses: { limit: 1, per: "long-rest", pool: "axe-charges" },
            consumesSpellSlot: false
          }
        ],
        grantsFeatIds: ["savage-attacker"],
        tags: ["cursed"],
        uses: { limit: 3, per: "long-rest", pool: "axe-charges" },
        grants: { damageResistances: ["slashing"] },
        effects: [{ tags: ["axe-rage"], duration: { type: "encounter" } }],
        modifiers: [
          { type: "attack-bonus", amount: 1, scope: "this-item" },
          {
            type: "extra-damage",
            formula: "1d6",
            damageType: "necrotic",
            when: [{ type: "on-hit" }, { type: "attack-kind-is", kinds: ["melee"] }]
          },
          {
            type: "roll-mode",
            roll: "save",
            mode: "disadvantage",
            when: [{ type: "while-hp-at-or-below", percent: 50 }]
          },
          { type: "armor-class", amount: 1, when: [{ type: "attuned" }] }
        ]
      });
      // `type` is stamped on the wire, never stored (strict `EquipmentReferenceSchema` would reject it).
      const body = { ...authored, type: "equipment" };
      const compiled = validator("HomebrewEquipmentRecord");
      expect(compiled(body), `HomebrewEquipmentRecord: ${JSON.stringify(compiled.errors)}`).toBe(true);
      const union = validator("HomebrewRecord");
      expect(union(body), `via HomebrewRecord: ${JSON.stringify(union.errors)}`).toBe(true);
      // The refusal is a carrier rule: the same rider on a feat parses.
      expect(() =>
        bundle.EquipmentReferenceSchema.parse({
          ...authored,
          modifiers: [{ type: "ability-score", ability: "str", amount: 2 }]
        })
      ).toThrow();
    });
  });

  it("keeps a fixture for every homebrew shape, so a new component cannot land uncompiled", () => {
    const missing = pairs
      .filter((pair) => pair.base.startsWith("Homebrew") && FIXTURES[pair.base] === undefined)
      .map((pair) => pair.base);
    expect(missing).toEqual([]);
    expect(pairs.filter((pair) => pair.base.startsWith("Homebrew")).length).toBeGreaterThanOrEqual(23);
  });
});

describe("the homebrew monster contract names what publishing needs", () => {
  it("documents the challenge rating and creature type keys the publish gate refuses without", () => {
    const extensions = (components.HomebrewMonsterRecord.properties as Record<string, { description?: string }>)
      .extensions;
    expect(extensions.description).toContain('extensions["open5e.srd-2024"]');
    expect(extensions.description).toContain("`challengeRating`");
    expect(extensions.description).toContain("`type`");
  });
});
