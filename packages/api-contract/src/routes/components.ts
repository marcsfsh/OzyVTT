import { z } from "zod";
import * as content from "@vtt/content-srd-5.2.1/schemas";
import * as wire from "@vtt/domain";
import {
  ActionSchema,
  ActionUsesSchema,
  CharacterChoiceSchema,
  EffectGrantSchema,
  EffectOnEndSchema,
  ModifierSchema,
  RiderTriggerSchema
} from "@vtt/schemas";
import * as contract from "../index.js";
import * as codex from "../schemas/codex.js";
import * as assets from "../schemas/assets.js";
import * as viewer from "../schemas/viewer.js";

/**
 * The names the OpenAPI document gives its schemas. A schema named here is one `$ref`'d component wherever a route
 * uses it; any other schema is written out in place. Names are public: integrations generate types from them, so a
 * rename is a breaking change.
 */

const byName = new Map<string, z.ZodType>();
const bySchema = new Map<z.ZodType, string>();

/** Names a schema in the document and returns it unchanged. One schema has one name, and one name one schema. */
export function named<S extends z.ZodType>(name: string, schema: S): S {
  const taken = byName.get(name);
  if (taken && taken !== schema) throw new Error(`Two schemas are named ${name}.`);
  const existing = bySchema.get(schema);
  if (existing && existing !== name) throw new Error(`${name} is already named ${existing}.`);
  byName.set(name, schema);
  bySchema.set(schema, name);
  return schema;
}

/** Every named schema, in the order it was named. */
export const namedSchemas = (): ReadonlyMap<string, z.ZodType> => byName;
/** The name a schema is documented under, if it has one. */
export const nameOf = (schema: z.ZodType): string | undefined => bySchema.get(schema);

const documented = new Map<z.ZodType, z.ZodType>();
/**
 * Documents `schema` as `as` wherever it appears. For a body the server parses loosely on purpose and checks
 * further on: a homebrew record is an open object on the wire, so a draft may be invalid, and the document names
 * the nine bodies it can be.
 */
export function documentAs(schema: z.ZodType, as: z.ZodType) {
  documented.set(schema, as);
}
export const documentedAs = (schema: z.ZodType): z.ZodType | undefined => documented.get(schema);

const pascal = (slug: string) =>
  slug
    .split("-")
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join("");

/** The schema under `.optional()`, `.nullable()` and `.default()`. */
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
const nameAll = (entries: ReadonlyArray<readonly [string, z.ZodType]>) => {
  for (const [name, schema] of entries) named(name, schema);
};

/** The Socket.IO envelopes have no HTTP operation, and the socket does not send them, so they stay out. */
const SOCKET_ONLY = new Set(["CommandEnvelopeSchema", "EventEnvelopeSchema"]);
// Every exported `<X>Schema` object in the package root is documented as `<X>`.
for (const [name, exported] of Object.entries(contract))
  if (name.endsWith("Schema") && exported instanceof z.ZodObject && !SOCKET_ONLY.has(name))
    named(name.slice(0, -"Schema".length), exported);

// The shared authoring vocabulary, each a named component so every operation that carries one refers to one
// definition.
nameAll([
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
]);

// The record body a homebrew type is authored as, with the `type` the wire adds; a monster's carries the row id
// the server stamps into it. The store strips both before it parses a body, so nothing else may refer to these.
const RECORD_TYPES = contract.HomebrewContentTypeSchema.options;
const MONSTER_BODY =
  "A creature stat block: an ActorDefinition, the same shape `actor.import-definition` and the bundled bestiary use. Its `source` is the bundle's provenance (`{name, version, externalId}`). The other eight types use `source` to tell SRD from homebrew, and a monster's homebrew status comes from its row. The row's id becomes `source.externalId`.";
const recordName = (type: contract.HomebrewContentType) => `Homebrew${pascal(type)}Record`;
const recordBranches = RECORD_TYPES.map((type) => {
  const body = content.HOMEBREW_BODY_SCHEMAS[type] as z.ZodObject;
  const stampedId = z
    .string()
    .describe(
      "The row's id. It is not part of an ActorDefinition: the server stamps it into the stored body, so the merged bestiary can resolve the record back to its row."
    );
  const shape = { type: z.literal(type), ...(type === "monster" ? { id: stampedId } : {}), ...body.shape };
  const strict = (body.def.catchall as z.ZodType | undefined)?.def.type === "never";
  const branch = (strict ? z.strictObject(shape) : z.object(shape)).meta(
    type === "monster" ? { description: MONSTER_BODY } : (body.meta() ?? {})
  );
  return named(recordName(type), branch);
});
const recordMapping = Object.fromEntries(
  RECORD_TYPES.map((type) => [type, `#/components/schemas/${recordName(type)}`])
);
/** The nine bodies a homebrew record can be, told apart by `type`. */
export const HomebrewRecordBodySchema = named(
  "HomebrewRecord",
  z
    .discriminatedUnion("type", recordBranches as unknown as [z.ZodObject, ...z.ZodObject[]])
    .meta({ discriminator: { propertyName: "type", mapping: recordMapping } })
    .describe(
      "The authored content only. `state`, `visibleToPlayers`, and `deletedAt` are row state and live on HomebrewRecordDocument, which is what stops an imported pack from inheriting the exporting table's visibility policy. One branch per `HomebrewContentType`, discriminated by the body's own `type`. A field with a server-side default is optional on the wire, and an unset optional field is left out entirely."
    )
);
/**
 * A record body as the wire carries it. The editor saves as the GM types, so a draft can be unfinished; only a body
 * that publishes is held to its `HomebrewRecord` branch.
 */
const HomebrewSavedBodySchema = named(
  "HomebrewSavedRecord",
  z
    .union([
      HomebrewRecordBodySchema,
      z
        .looseObject({ type: contract.HomebrewContentTypeSchema })
        .describe("An unfinished draft: any field but `type` may be missing or wrong.")
    ])
    .describe(
      "A record's authored body as saved. A published body matches its type's `HomebrewRecord` branch. A draft may be unfinished, and its document's `validity` lists what publishing still needs."
    )
);
documentAs(contract.HomebrewRecordSchema, HomebrewSavedBodySchema);

// The log names its rolls' shape here, so the contract's root keeps no dependency on the domain package.
documentAs(contract.LoggedRollSchema, named("LoggedRoll", wire.RollRecordSchema.omit({ initiatorSessionId: true })));

// Each Codex write's body, and the pieces several of them share.
nameAll([
  ["CodexInWorldDate", wire.CodexInWorldDateSchema],
  ["CodexDowntimeInput", codex.DowntimeInputSchema],
  ["CodexMilestoneInput", codex.MilestoneInputSchema],
  ["CodexQuestObjective", wire.CodexQuestObjectiveSchema],
  ["CodexQuestObjectiveInput", codex.ObjectiveSchema],
  ["CodexBlockInput", codex.BlockInputSchema],
  ["CodexBlockPlacement", codex.BlockPlacementSchema],
  ["CodexRelationshipBeganInput", codex.RelationshipBeganSchema],
  ["CodexAutosaveSettings", wire.CodexAutosaveSettingsSchema],
  ["CodexPageCreateRequest", codex.PageCreateSchema],
  ["CodexPageUpdateRequest", codex.PageUpdateSchema],
  ["CodexRevealRequest", codex.RevealSchema],
  ["CodexBlockAddRequest", codex.BlockAddSchema],
  ["CodexBlockEditRequest", codex.BlockEditSchema],
  ["CodexBlockMoveRequest", codex.BlockMoveSchema],
  ["CodexAudienceRequest", codex.AudienceSetSchema],
  ["CodexFieldAudienceRequest", codex.FieldAudienceSchema],
  ["CodexPreviewSessionRequest", codex.PreviewSessionSchema],
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
  ["CodexPrepLink", wire.CodexPrepLinkSchema],
  ["CodexPrepSectionInput", codex.PrepSectionInputSchema],
  ["CodexPrepTemplateSectionInput", codex.PrepTemplateSectionInputSchema],
  ["CodexPrepTemplateCreateRequest", codex.PrepTemplateCreateSchema],
  ["CodexPrepTemplateUpdateRequest", codex.PrepTemplateUpdateSchema],
  ["CodexPrepTemplateDuplicateRequest", codex.PrepTemplateDuplicateSchema],
  ["CodexSessionCreateRequest", codex.SessionCreateSchema],
  ["CodexSessionUpdateRequest", codex.SessionUpdateSchema],
  ["CodexSessionApplyTemplateRequest", codex.SessionApplyTemplateSchema],
  ["CodexSessionLogRequest", codex.SessionLogSchema],
  ["CodexSessionTickRequest", codex.SessionTickSchema],
  ["CodexSessionCurrentSceneRequest", codex.SessionCurrentSceneSchema],
  ["CodexPartyPlaceRequest", codex.PartyPlaceSchema],
  ["CodexQuestCreateRequest", codex.QuestCreateSchema],
  ["CodexQuestUpdateRequest", codex.QuestUpdateSchema],
  ["CodexStandingSetRequest", codex.StandingSetSchema],
  ["CodexCalendarRequest", codex.CalendarSchema],
  ["CodexSettingsRequest", codex.CodexSettingsSchema],
  ["CodexRevisionsDeleteRequest", codex.RevisionsDeleteSchema],
  ["CodexImportRequest", codex.CodexImportSchema]
]);

// Each Codex record as it is read back. A player's projection of `Codex<X>` is `Codex<X>Player`.
nameAll([
  ["CodexRevealStamp", wire.CodexRevealStampSchema],
  ["CodexRevealStampPlayer", wire.PlayerCodexRevealStampSchema],
  ["CodexBlockReveal", wire.CodexBlockRevealSchema],
  ["CodexBlock", wire.CodexBlockSchema],
  ["CodexBlockContent", wire.CodexBlockContentSchema],
  ["CodexBlockPlayer", wire.PlayerCodexBlockSchema],
  ["CodexRelationshipBegan", wire.CodexRelationshipBeganSchema],
  ["CodexQuestObjectivePlayer", wire.PlayerCodexQuestObjectiveSchema],
  ["CodexPageSummary", wire.CodexPageSummarySchema],
  ["CodexPage", wire.CodexPageSchema],
  ["CodexPageSummaryPlayer", wire.PlayerCodexPageSummarySchema],
  ["CodexPagePlayer", wire.PlayerCodexPageSchema],
  ["CodexPageRevision", wire.CodexPageRevisionSchema],
  ["CodexConnection", wire.CodexConnectionSchema],
  ["CodexConnectionPlayer", wire.PlayerCodexConnectionSchema],
  ["CodexPageConnection", wire.CodexPageConnectionSchema],
  ["CodexPageConnectionPlayer", wire.PlayerCodexPageConnectionSchema],
  ["CodexMap", wire.CodexMapSchema],
  ["CodexMapPlayer", wire.PlayerCodexMapSchema],
  ["CodexMarker", wire.CodexMarkerSchema],
  ["CodexMarkerPlayer", wire.PlayerCodexMarkerSchema],
  ["CodexDowntimePayload", wire.CodexDowntimePayloadSchema],
  ["CodexMilestonePayload", wire.CodexMilestonePayloadSchema],
  ["CodexStandingPayload", wire.CodexStandingPayloadSchema],
  ["CodexQuestHistoryPayload", wire.CodexQuestEventPayloadSchema],
  ["CodexDowntimePlayerPayload", wire.PlayerCodexDowntimePayloadSchema],
  ["CodexStandingPlayerPayload", wire.PlayerCodexStandingPayloadSchema],
  ["CodexQuestHistoryPlayerPayload", wire.PlayerCodexQuestEventPayloadSchema],
  ["CodexJournalEntry", wire.CodexJournalEntrySchema],
  ["CodexJournalEntryPlayer", wire.PlayerCodexJournalEntrySchema],
  ["CodexChronicleRecord", wire.CodexChronicleRecordSchema],
  ["CodexChronicleRecordPlayer", wire.PlayerCodexChronicleRecordSchema],
  ["CodexPrepChecklistItem", wire.CodexPrepChecklistItemSchema],
  ["CodexPrepScene", wire.CodexPrepSceneSchema],
  ["CodexPrepSection", wire.CodexPrepSectionSchema],
  ["CodexPrepTemplateSection", wire.CodexPrepTemplateSectionSchema],
  ["CodexPrepTemplate", wire.CodexPrepTemplateSchema],
  ["CodexPrepTemplateListData", wire.CodexPrepTemplateListSchema],
  ["CodexSession", wire.CodexSessionSchema],
  ["CodexSessionPlayer", wire.PlayerCodexSessionSchema],
  ["CodexLiveClue", wire.CodexLiveClueSchema],
  ["CodexLiveBoard", wire.CodexLiveBoardSchema],
  ["CodexSessionHappened", wire.CodexSessionHappenedSchema],
  ["CodexQuest", wire.CodexQuestSchema],
  ["CodexQuestPlayer", wire.PlayerCodexQuestSchema],
  ["CodexStanding", wire.CodexStandingSchema],
  ["CodexStandingPlayer", wire.PlayerCodexStandingSchema],
  ["CodexCalendarMonth", wire.CodexCalendarMonthSchema],
  ["CodexCalendarEra", wire.CodexCalendarEraSchema],
  ["CodexCalendar", wire.GmCodexCalendarSchema],
  ["CodexCalendarPlayer", wire.PlayerCodexCalendarSchema],
  ["CodexSearchHit", wire.CodexSearchHitSchema],
  ["CodexSearchHitPlayer", wire.PlayerCodexSearchHitSchema],
  ["CodexRevealCheckRow", wire.CodexRevealCheckRowSchema],
  ["CodexHome", wire.CodexHomeSchema],
  ["CodexHomePlayer", wire.PlayerCodexHomeSchema],
  ["CodexRevisionHistorySettings", wire.CodexRevisionHistorySchema],
  ["CodexSettings", wire.CodexSettingsSchema],
  ["CodexCalendarMove", wire.CodexCalendarMoveSchema],
  ["CodexRevealAuditRow", wire.CodexRevealAuditRowSchema],
  ["CodexRevealAuditSection", wire.CodexRevealAuditSectionSchema],
  ["CodexRevealAudit", wire.CodexRevealAuditSchema],
  ["CodexImportCounts", wire.CodexImportCountsSchema],
  ["CodexAsset", wire.CodexAssetSchema]
]);

// The feature shapes the builder catalogs share.
nameAll([
  ["ContentFeature", wire.ContentFeatureSummarySchema],
  ["ContentFeatureChoice", wire.ContentFeatureChoiceSummarySchema],
  ["ContentFeatureOption", wire.ContentFeatureOptionSummarySchema],
  ["ContentExtraPick", wire.ContentExtraPickSummarySchema]
]);

// The asset libraries, the viewer, and the game reads whose rows the domain defines.
nameAll([
  ["MapAssetMetadata", assets.PublicMapAssetSchema],
  ["MapCatalogEntry", assets.MapCatalogEntrySchema],
  ["ImagePoint", assets.ImagePointSchema],
  ["TokenAsset", assets.TokenAssetSchema],
  ["TokenCatalogEntry", assets.TokenCatalogEntrySchema],
  ["SoundAsset", assets.PublicSoundAssetSchema],
  ["SoundBoardView", wire.SoundBoardViewSchema],
  ["ViewerAccess", viewer.ViewerAccessMetadataSchema],
  ["ActorAvailableActionsData", wire.AvailableActionsReplySchema],
  ["ActorMovementData", wire.ActorMovementReplySchema],
  ["CharacterNextLevelData", wire.NextLevelReplySchema],
  ["VisionPreviewData", wire.VisionPreviewReplySchema],
  ["CharacterDraftData", wire.CharacterDraftReplySchema],
  ["BuilderOffersData", wire.BuilderOffersReplySchema],
  ["BuilderAbilityIncreases", wire.BuilderAbilityIncreasesSchema],
  ["BuilderChoiceRow", CharacterChoiceSchema]
]);
