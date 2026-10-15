import { z } from "zod";
import * as contract from "@vtt/api-contract";
import {
  ActionSchema,
  ActionUsesSchema,
  EffectGrantSchema,
  EffectOnEndSchema,
  ModifierSchema,
  RiderTriggerSchema
} from "@vtt/schemas";
import * as content from "@vtt/content-srd-5.2.1";
import * as codex from "../codex-requests.js";
import { DESCRIPTIONS } from "./descriptions.js";
import { commandBodySchemas, gameCommandDocs, type JsonSchema } from "./game-commands.js";

/** Zod envelopes for the Socket.IO transport, which has no HTTP shape to document. */
const TRANSPORT_ONLY = new Set(["CommandEnvelopeSchema", "EventEnvelopeSchema"]);

const pascal = (slug: string) =>
  slug
    .split("-")
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join("");

/** The schema under `.optional()`, `.nullable()` and `.default()`, for hoisting a property's shape. */
function unwrap<T extends z.ZodType>(schema: z.ZodType, kind: abstract new (...args: never[]) => T): T {
  let current = schema;
  for (let depth = 0; depth < 8 && !(current instanceof kind); depth += 1)
    current = (current.def as { innerType?: z.ZodType }).innerType ?? current;
  if (!(current instanceof kind)) throw new Error(`expected a ${kind.name}`);
  return current;
}
const objectOf = (schema: z.ZodType) => unwrap(schema, z.ZodObject);
const shapeOf = (schema: z.ZodType, key: string) => objectOf(objectOf(schema).shape[key] as z.ZodType);
const optionsOf = (schema: z.ZodType) => unwrap(schema, z.ZodUnion).options as readonly z.ZodObject[];
const typeOf = (option: z.ZodObject) => (option.shape.type as z.ZodLiteral<string>).value;
/** Each branch of a union discriminated by `type`, named `<prefix><Type>`. */
const branches = (prefix: string, union: z.ZodType) =>
  optionsOf(union).map((option) => [`${prefix}${pascal(typeOf(option))}`, option] as const);

/**
 * The shared authoring vocabulary, each a named component so the reference renderer (which flattens one level of
 * nesting) can name and document it, and so every operation that carries one refers to the same definition.
 */
const VOCABULARY: ReadonlyArray<readonly [string, z.ZodType]> = [
  ["Feature", content.FeatureRecordSchema],
  ["FeatureChoice", content.FeatureChoiceSchema],
  ["FeatureOption", content.FeatureOptionSchema],
  ["FeatureOptionChoice", content.FeatureOptionChoiceSchema],
  ["FeatureAction", content.FeatureActionSchema],
  ["FeatureAttack", content.FeatureAttackSchema],
  ["FeatureSave", content.FeatureSaveSchema],
  ["FeatureSaveDcDerived", optionsOf(content.FeatureSaveDcSchema)[2]!],
  ["FeatureUses", content.FeatureUsesSchema],
  ...branches("FeatureUsesScaling", objectOf(content.FeatureUsesSchema).shape.scaling as z.ZodType),
  ["FeatureGrants", content.FeatureGrantsSchema],
  ["ExtraPick", content.ExtraPickSchema],
  ["ExtraPickScaling", shapeOf(content.ExtraPickSchema, "scaling")],
  ["ReplaceableChoice", content.ReplaceableChoiceSchema],
  ["ChoiceList", content.ChoiceListSchema],
  ["StartingEquipmentOption", content.StartingEquipmentOptionSchema],
  ["ClassLevelRow", content.ClassLevelRowSchema],
  ["Spellcasting", content.ContentSpellcastingSchema],
  ["MulticlassPrerequisite", content.MulticlassPrerequisiteSchema],
  ["SpellShape", shapeOf(content.SpellReferenceSchema, "shape")],
  ["SpellSave", shapeOf(content.SpellReferenceSchema, "save")],
  ["EquipmentWeapon", shapeOf(content.EquipmentReferenceSchema, "weapon")],
  ["EquipmentArmor", shapeOf(content.EquipmentReferenceSchema, "armor")],
  ["ItemSpellCast", content.ItemSpellCastSchema],
  ["ItemAttunement", content.ItemAttunementSchema],
  ["Action", ActionSchema],
  ["ActionUses", ActionUsesSchema],
  ["ActionOnHit", unwrap(objectOf(ActionSchema).shape.onHit as z.ZodType, z.ZodArray).element as z.ZodType],
  ["EffectGrant", EffectGrantSchema],
  ...branches("EffectDuration", EffectGrantSchema.shape.duration),
  ["EffectOnEnd", EffectOnEndSchema],
  ["Modifier", ModifierSchema],
  ...branches("Modifier", ModifierSchema),
  ["RiderTrigger", RiderTriggerSchema],
  ...branches("RiderTrigger", RiderTriggerSchema)
];

/** Each Codex write's body, and the pieces several of them share. */
const CODEX_BODIES: ReadonlyArray<readonly [string, z.ZodType]> = [
  ["CodexInWorldDate", codex.InWorldDateFields],
  ["CodexDowntimeInput", codex.DowntimeInputSchema],
  ["CodexMilestoneInput", codex.MilestoneInputSchema],
  ["CodexQuestObjective", codex.ObjectiveSchema],
  ["CodexAutosaveSettings", shapeOf(codex.CodexSettingsSchema, "autosave")],
  ["CodexPageCreateRequest", codex.PageCreateSchema],
  ["CodexPageUpdateRequest", codex.PageUpdateSchema],
  ["CodexRevealRequest", codex.RevealSchema],
  ["CodexConnectionCreateRequest", codex.ConnectionCreateSchema],
  ["CodexConnectionUpdateRequest", codex.ConnectionUpdateSchema],
  ["CodexFolderPathRequest", codex.FolderPathSchema],
  ["CodexFolderMoveRequest", codex.FolderMoveSchema],
  ["CodexMapCreateRequest", codex.MapCreateSchema],
  ["CodexMapUpdateRequest", codex.MapUpdateSchema],
  ["CodexMapParentRequest", codex.MapParentSchema],
  ["CodexMarkerCreateRequest", codex.MarkerCreateSchema],
  ["CodexMarkerUpdateRequest", codex.MarkerUpdateSchema],
  ["CodexMarkerMoveRequest", codex.MarkerMoveSchema],
  ["CodexMarkerPartyRequest", codex.MarkerPartySchema],
  ["CodexJournalCreateRequest", codex.JournalWriteSchema],
  ["CodexJournalUpdateRequest", codex.JournalUpdateSchema],
  ["CodexDeadlineCreateRequest", codex.DeadlineCreateSchema],
  ["CodexDowntimeCreateRequest", codex.DowntimeCreateSchema],
  ["CodexMilestoneCreateRequest", codex.MilestoneCreateSchema],
  ["CodexSessionCreateRequest", codex.SessionCreateSchema],
  ["CodexSessionUpdateRequest", codex.SessionUpdateSchema],
  ["CodexQuestCreateRequest", codex.QuestCreateSchema],
  ["CodexQuestUpdateRequest", codex.QuestUpdateSchema],
  ["CodexStandingSetRequest", codex.StandingSetSchema],
  ["CodexCalendarRequest", codex.CalendarSchema],
  ["CodexSettingsRequest", codex.CodexSettingsSchema],
  ["CodexRevisionsDeleteRequest", codex.RevisionsDeleteSchema],
  ["CodexImportRequest", codex.CodexImportSchema]
];

/** The record body a homebrew type is authored as; a monster's is an ActorDefinition. */
const recordName = (type: contract.HomebrewContentType) => `Homebrew${pascal(type)}Record`;
const RECORD_TYPES = contract.HomebrewContentTypeSchema.options;

/** Every exported `<X>Schema` object in the HTTP contract, documented as `<X>`. */
const TRANSPORT = Object.entries(contract).flatMap(([name, exported]) =>
  name.endsWith("Schema") && exported instanceof z.ZodObject && !TRANSPORT_ONLY.has(name)
    ? [[name.slice(0, -"Schema".length), exported as z.ZodType] as const]
    : []
);

const SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

/** Drops what Zod's output carries that a reader doesn't need: the dialect and id, the safe-integer bounds of every
 *  `.int()`, the regex behind a named `format`, and a record's string keys. */
function tidy(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(tidy);
  if (!node || typeof node !== "object") return node;
  const source = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "$schema" || key === "$id") continue;
    if (key === "maximum" && value === SAFE_INTEGER) continue;
    if (key === "minimum" && value === -SAFE_INTEGER) continue;
    if (key === "pattern" && typeof source.format === "string") continue;
    if (key === "propertyNames" && JSON.stringify(value) === '{"type":"string"}') continue;
    out[key] = tidy(value);
  }
  return out;
}

/** Finds the node a description path names: "" is the component, "a.b" a nested property, "a[]" an array's items. */
function nodeAt(component: JsonSchema, path: string): Record<string, unknown> {
  let node: Record<string, unknown> = component;
  if (path === "") return node;
  for (const segment of path.split(".")) {
    const [key, ...items] = segment.split("[]");
    const container = nullableInner(node);
    const next = (container.properties as Record<string, Record<string, unknown>> | undefined)?.[key!];
    if (!next) throw new Error(`no property "${segment}"`);
    node = next;
    for (let depth = 0; depth < items.length; depth += 1) {
      const element = nullableInner(node).items as Record<string, unknown> | undefined;
      if (!element) throw new Error(`"${segment}" is not an array`);
      node = element;
    }
  }
  return node;
}
/** `X | null` is written as `anyOf`; a path steps through to `X`. */
function nullableInner(node: Record<string, unknown>): Record<string, unknown> {
  const branches = node.anyOf as Record<string, unknown>[] | undefined;
  if (!branches) return node;
  const inner = branches.filter((branch) => branch.type !== "null");
  return inner.length === 1 ? inner[0]! : node;
}

function describe(schemas: Record<string, JsonSchema>) {
  for (const [name, paths] of Object.entries(DESCRIPTIONS)) {
    const component = schemas[name];
    if (!component) throw new Error(`Descriptions name a component that doesn't exist: ${name}`);
    for (const [path, description] of Object.entries(paths)) {
      try {
        nodeAt(component, path).description = description;
      } catch (error) {
        throw new Error(`Description for ${name} "${path}": ${(error as Error).message}`, { cause: error });
      }
    }
  }
}

/**
 * The components generated from the Zod schemas the server parses with: the HTTP contract's shapes, the homebrew
 * authoring vocabulary and record bodies, the Codex write bodies, and each game command's request body, plus the
 * game command operations.
 * One registry, so a schema that appears in several places is one `$ref`'d component. Prose comes from
 * `descriptions.ts`.
 */
export function generatedDocs() {
  const registry = z.registry<{ id: string }>();
  const register = (id: string, schema: z.ZodType) => {
    const existing = registry.get(schema);
    if (existing) throw new Error(`${id} and ${existing.id} are the same schema`);
    registry.add(schema, { id });
  };
  for (const [id, schema] of TRANSPORT) register(id, schema);
  register("HomebrewRecord", contract.HomebrewRecordSchema);
  for (const [id, schema] of VOCABULARY) register(id, schema);
  for (const [id, schema] of CODEX_BODIES) register(id, schema);
  for (const type of RECORD_TYPES) register(recordName(type), content.HOMEBREW_BODY_SCHEMAS[type] as z.ZodType);
  // Commands that share a payload schema (several take only the optional revision) share its generated body.
  const aliases: Array<readonly [string, string]> = [];
  for (const [id, schema] of commandBodySchemas()) {
    const existing = registry.get(schema);
    if (existing) aliases.push([id, existing.id]);
    else register(id, schema);
  }

  const { schemas: raw } = z.toJSONSchema(registry, {
    io: "input",
    unrepresentable: "any",
    uri: (id) => `#/components/schemas/${id}`,
    // The contract keeps `HomebrewRecord` an open record so it needn't depend on the content bundle; the
    // document names the nine bodies it can be.
    override: ({ zodSchema, jsonSchema }) => {
      if (zodSchema !== (contract.HomebrewRecordSchema as unknown)) return;
      for (const key of Object.keys(jsonSchema)) delete (jsonSchema as Record<string, unknown>)[key];
      Object.assign(jsonSchema, homebrewRecordUnion());
    }
  });
  const schemas = tidy(raw) as Record<string, JsonSchema>;
  for (const [id, original] of aliases) schemas[id] = structuredClone(schemas[original]!);

  // A record body names its own type, which the store strips before parsing (strict bodies would refuse it), and
  // a monster's carries the row id the server stamps into it. Both are why nothing else may refer to a body.
  const recordRefs = new Set(RECORD_TYPES.map((type) => `"#/components/schemas/${recordName(type)}"`));
  for (const [name, schema] of Object.entries(schemas))
    if (name !== "HomebrewRecord" && [...recordRefs].some((ref) => JSON.stringify(schema).includes(ref)))
      throw new Error(`${name} refers to a homebrew record body; refer to HomebrewRecord or the shared schema`);
  for (const type of RECORD_TYPES) {
    const name = recordName(type);
    const body = schemas[name]!;
    const extra = type === "monster" ? { id: { type: "string" } } : {};
    schemas[name] = {
      ...body,
      properties: { type: { type: "string", const: type }, ...extra, ...body.properties },
      required: ["type", ...Object.keys(extra), ...(body.required ?? [])]
    };
  }

  const commands = gameCommandDocs(schemas);
  Object.assign(schemas, commands.schemas);
  describe(schemas);
  return { schemas, paths: commands.paths };
}

function homebrewRecordUnion() {
  const refs = Object.fromEntries(RECORD_TYPES.map((type) => [type, `#/components/schemas/${recordName(type)}`]));
  return {
    oneOf: Object.values(refs).map(($ref) => ({ $ref })),
    discriminator: { propertyName: "type", mapping: refs }
  };
}
