import { z } from "zod";
import { CodexAutosaveSettingsSchema, CodexInWorldDateSchema } from "@vtt/domain";
import { CODEX_BUNDLE_VERSION } from "./codex/bundle.js";

/**
 * What each Codex write may contain. Bounds mirror the store's validators, which run again on every write so a
 * backup import and any non-HTTP caller meet the same rules. Every body is `.strict()`: an unknown key is a 400.
 */

const TagsSchema = z.array(z.string().trim().min(1).max(40)).max(24);
/** Optional idempotency key on JSON-body writes, stripped before the store. Body-less POSTs and DELETEs are naturally idempotent. */
const CommandIdSchema = z.uuid().optional();
/** A raw in-world date, shared by the journal and page schemas so both accept the same bounds. */
export const InWorldDateFields = CodexInWorldDateSchema;
const InWorldDateSchema = InWorldDateFields.nullable();
const EntityTypeSchema = z.enum(["note", "character", "location", "faction", "item", "species", "religion", "event"]);
const FieldsSchema = z.record(z.string().max(40), z.string().max(2000));
const ExpectedRevSchema = z.number().int().nonnegative().optional();
/** A paragraph count: where a block sits in the player text. */
const AnchorSchema = z.number().int().min(0).max(100_000);
const BlockTitleSchema = z.string().max(160).nullable();
const BlockTextSchema = z.string().max(100_000);
/** A block as create takes it; it is created hidden. Omitted `anchor`: after the player text. */
export const BlockInputSchema = z
  .object({ title: BlockTitleSchema.optional(), text: BlockTextSchema, anchor: AnchorSchema.optional() })
  .strict();
const BlocksSchema = z.array(BlockInputSchema).max(200);
/** Where one block sits. */
export const BlockPlacementSchema = z.object({ id: z.uuid(), anchor: AnchorSchema }).strict();
/** Every block of the record exactly once, in document order. */
const LayoutSchema = z.array(BlockPlacementSchema).max(200);
const AudienceSchema = z.enum(["hidden", "everyone", "characters"]);
const CharacterIdsSchema = z.array(z.uuid()).max(12);
export const PageCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    entityType: EntityTypeSchema.optional(),
    /** Every field value, whatever its audience. */
    fields: FieldsSchema.optional(),
    /** Omitted: the kind's default-hidden keys. */
    hiddenFields: z.array(z.string().max(40)).max(40).optional(),
    folder: z.string().max(160).nullable().optional(),
    tags: TagsSchema.optional(),
    playerBody: z.string().max(100_000).optional(),
    blocks: BlocksSchema.optional(),
    revealedToPlayers: z.boolean().optional(),
    bannerAssetId: z.uuid().nullable().optional(),
    /** What places an `event` page on the chronicle. Omitted = unchanged/undated; `null` = clear the date. */
    inWorldDate: InWorldDateSchema.optional(),
    commandId: CommandIdSchema
  })
  .strict();
/** No reveal flag, field audience or block content: each has its own route. */
export const PageUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    entityType: EntityTypeSchema.optional(),
    fields: FieldsSchema.optional(),
    folder: z.string().max(160).nullable().optional(),
    tags: TagsSchema.optional(),
    playerBody: z.string().max(100_000).optional(),
    layout: LayoutSchema.optional(),
    bannerAssetId: z.uuid().nullable().optional(),
    inWorldDate: InWorldDateSchema.optional(),
    expectedRev: ExpectedRevSchema,
    commandId: CommandIdSchema
  })
  .strict();
/** A new hidden block at `anchor`; `slot` places it among the blocks there (default: last). */
export const BlockAddSchema = z
  .object({
    anchor: AnchorSchema,
    slot: z.number().int().min(0).optional(),
    title: BlockTitleSchema.optional(),
    text: BlockTextSchema,
    expectedRev: ExpectedRevSchema,
    commandId: CommandIdSchema
  })
  .strict();
export const BlockEditSchema = z
  .object({
    title: BlockTitleSchema.optional(),
    text: BlockTextSchema.optional(),
    expectedRev: ExpectedRevSchema,
    commandId: CommandIdSchema
  })
  .strict();
export const BlockMoveSchema = z
  .object({
    anchor: AnchorSchema,
    slot: z.number().int().min(0).optional(),
    expectedRev: ExpectedRevSchema,
    commandId: CommandIdSchema
  })
  .strict();
/** Who sees a block or an objective. `characterIds` only, and then at least one, with `characters`. */
export const AudienceSetSchema = z
  .object({ audience: AudienceSchema, characterIds: CharacterIdsSchema.optional(), commandId: CommandIdSchema })
  .strict();
export const FieldAudienceSchema = z
  .object({ audience: z.enum(["hidden", "everyone"]), commandId: CommandIdSchema })
  .strict();
/** Which party character a preview reads as; omitted or null is a preview as everyone. */
export const PreviewSessionSchema = z
  .object({ characterId: z.uuid().nullable().optional(), commandId: CommandIdSchema })
  .strict();
/** When a tie began: a date, or before the campaign (`inWorldDate` null). `null` clears it. */
export const RelationshipBeganSchema = z
  .object({ inWorldDate: InWorldDateFields.nullable(), beforeCampaign: z.boolean() })
  .strict();
/** `label` is optional: an unlabelled connection just means "related", as a `[[wiki link]]` does. */
export const ConnectionCreateSchema = z
  .object({
    toPageId: z.uuid(),
    label: z.string().trim().max(40).nullable().optional(),
    layer: z.enum(["player", "gm"]).optional(),
    began: RelationshipBeganSchema.nullable().optional(),
    commandId: CommandIdSchema
  })
  .strict();
/** Relabel, re-layer or re-date a declared connection. An omitted field is left alone. */
export const ConnectionUpdateSchema = z
  .object({
    label: z.string().trim().max(40).nullable().optional(),
    layer: z.enum(["player", "gm"]).optional(),
    began: RelationshipBeganSchema.nullable().optional(),
    commandId: CommandIdSchema
  })
  .strict();
export const RevealSchema = z.object({ revealed: z.boolean(), commandId: CommandIdSchema }).strict();
export const FolderMoveSchema = z
  .object({ from: z.string().trim().min(1).max(160), to: z.string().trim().max(160), commandId: CommandIdSchema })
  .strict();
export const FolderPathSchema = z
  .object({ path: z.string().trim().min(1).max(160), commandId: CommandIdSchema })
  .strict();

const MapKindSchema = z.enum(["battlemap", "regional", "world"]);
export const MapCreateSchema = z
  .object({
    assetId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    kind: MapKindSchema,
    parentMapId: z.uuid().nullable().optional(),
    revealedToPlayers: z.boolean().optional(),
    tags: TagsSchema.optional(),
    commandId: CommandIdSchema
  })
  .strict();
export const MapUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    kind: MapKindSchema.optional(),
    tags: TagsSchema.optional(),
    commandId: CommandIdSchema
  })
  .strict();
export const MapParentSchema = z.object({ parentMapId: z.uuid().nullable(), commandId: CommandIdSchema }).strict();

const Coord = z.number().min(0).max(1_000_000);
const IconColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const IconId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/)
  .max(60);
const MarkerLinks = {
  pageIds: z.array(z.uuid()).max(24).optional(),
  subMapId: z.uuid().nullable().optional(),
  sceneIds: z.array(z.uuid()).max(24).optional(),
  actorId: z.uuid().nullable().optional()
};
export const MarkerCreateSchema = z
  .object({
    x: Coord,
    y: Coord,
    iconId: IconId,
    iconColor: IconColor,
    label: z.string().max(120).nullable().optional(),
    revealedToPlayers: z.boolean().optional(),
    tags: TagsSchema.optional(),
    ...MarkerLinks,
    commandId: CommandIdSchema
  })
  .strict();
export const MarkerUpdateSchema = z
  .object({
    x: Coord.optional(),
    y: Coord.optional(),
    iconId: IconId.optional(),
    iconColor: IconColor.optional(),
    label: z.string().max(120).nullable().optional(),
    revealedToPlayers: z.boolean().optional(),
    tags: TagsSchema.optional(),
    ...MarkerLinks,
    commandId: CommandIdSchema
  })
  .strict();
export const MarkerMoveSchema = z.object({ x: Coord, y: Coord, commandId: CommandIdSchema }).strict();
/** Only the flag: the party marker is an ordinary marker, moved via `POST /markers/{id}/move`. */
export const MarkerPartySchema = z.object({ isParty: z.boolean(), commandId: CommandIdSchema }).strict();

export const JournalWriteSchema = z
  .object({
    tags: TagsSchema.optional(),
    playerText: z.string().max(20_000).optional(),
    gmText: z.string().max(20_000).nullable().optional(),
    revealedToPlayers: z.boolean().optional(),
    attachMarkerId: z.uuid().nullable().optional(),
    attachPageId: z.uuid().nullable().optional(),
    /** By id only (`sessionNumber` is server-resolved and rejected). Omitted on create: active session; `null`: none; unknown: 404. */
    sessionId: z.uuid().nullable().optional(),
    realDate: z.string().max(40).nullable().optional(),
    inWorldLabel: z.string().max(120).nullable().optional(),
    inWorldDate: InWorldDateSchema.optional(),
    commandId: CommandIdSchema
  })
  .strict();
/** A deadline requires `inWorldDate`, since `fired` derives from it. */
export const DeadlineCreateSchema = JournalWriteSchema.extend({ inWorldDate: InWorldDateFields });
/** `applied` is not an input (only `apply-downtime` moves the clock). `who`/`activity` may be blank for party-wide downtime. */
export const DowntimeInputSchema = z
  .object({
    who: z.string().trim().max(120),
    activity: z.string().trim().max(120),
    days: z.number().int().min(0).max(3650),
    /** Links the tracker to a person whatever the spelling; unknown ids 404, page type is not checked. */
    characterPageId: z.uuid().nullable().optional()
  })
  .strict();
export const DowntimeCreateSchema = JournalWriteSchema.extend({ downtime: DowntimeInputSchema });
/** `days` is not editable (the clock already moved by it); `.strict()` rejects it. */
export const JournalUpdateSchema = JournalWriteSchema.extend({
  downtime: z
    .object({
      who: z.string().trim().max(120).optional(),
      activity: z.string().trim().max(120).optional(),
      characterPageId: z.uuid().nullable().optional()
    })
    .strict()
    .optional()
});
/** `level` uses the 1-20 character-level bound; `reason` may be blank. */
export const MilestoneInputSchema = z
  .object({
    level: z.number().int().min(1).max(20),
    reason: z.string().trim().max(120).default("")
  })
  .strict();
export const MilestoneCreateSchema = JournalWriteSchema.extend({ milestone: MilestoneInputSchema });
/** Sessions. `sessionNumber` uses the journal's bounds because a journal entry resolves against it. */
const SessionNumberSchema = z.number().int().min(0).max(100_000).nullable();
const AttendeesSchema = z.array(z.string().trim().min(1).max(40)).max(24);
const SessionStatusSchema = z.enum(["planned", "played"]);
/** Scene attachments, capped at the table's own scene cap. */
const SessionSceneIdsSchema = z.array(z.uuid()).max(20);
export const SessionCreateSchema = z
  .object({
    sessionNumber: SessionNumberSchema.optional(),
    realDate: z.string().max(40).nullable().optional(),
    attendees: AttendeesSchema.optional(),
    prepBody: z.string().max(100_000).optional(),
    recapBody: z.string().max(100_000).optional(),
    revealedToPlayers: z.boolean().optional(),
    status: SessionStatusSchema.optional(),
    tags: TagsSchema.optional(),
    /** Scenes staged for this session; the store re-applies the cap. */
    sceneIds: SessionSceneIdsSchema.optional(),
    commandId: CommandIdSchema
  })
  .strict();
/** No `revealedToPlayers`: reveal is its own route, so a PATCH cannot publish a recap as a side effect of an edit. */
export const SessionUpdateSchema = z
  .object({
    sessionNumber: SessionNumberSchema.optional(),
    realDate: z.string().max(40).nullable().optional(),
    attendees: AttendeesSchema.optional(),
    prepBody: z.string().max(100_000).optional(),
    recapBody: z.string().max(100_000).optional(),
    status: SessionStatusSchema.optional(),
    tags: TagsSchema.optional(),
    sceneIds: SessionSceneIdsSchema.optional(),
    expectedRev: z.number().int().nonnegative().optional(),
    commandId: CommandIdSchema
  })
  .strict();
/** Bounds mirror the store's. Objective text may be empty (the editor autosaves right after "Add item"). */
const QuestStatusSchema = z.enum(["not-started", "active", "completed", "failed", "canceled"]);
/**
 * An objective as a write lists it: `id` for one the server gave, none for a new one. `audience` only on a new one
 * (default everyone); an existing objective's audience has its own route.
 */
export const ObjectiveSchema = z
  .object({
    id: z.uuid().optional(),
    text: z.string().max(120),
    done: z.boolean(),
    audience: AudienceSchema.optional(),
    characterIds: CharacterIdsSchema.optional()
  })
  .strict();
const ObjectivesSchema = z.array(ObjectiveSchema).max(24);
const QuestEntityIdsSchema = z.array(z.uuid()).max(24);
export const QuestCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    status: QuestStatusSchema.optional(),
    playerBody: z.string().max(100_000).optional(),
    blocks: BlocksSchema.optional(),
    objectives: ObjectivesSchema.optional(),
    entityIds: QuestEntityIdsSchema.optional(),
    revealedToPlayers: z.boolean().optional(),
    tags: TagsSchema.optional(),
    commandId: CommandIdSchema
  })
  .strict();
/** No `revealedToPlayers`: reveal is its own route, so a PATCH cannot publish a quest as a side effect of an edit. */
export const QuestUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    status: QuestStatusSchema.optional(),
    playerBody: z.string().max(100_000).optional(),
    layout: LayoutSchema.optional(),
    objectives: ObjectivesSchema.optional(),
    entityIds: QuestEntityIdsSchema.optional(),
    tags: TagsSchema.optional(),
    expectedRev: z.number().int().nonnegative().optional(),
    commandId: CommandIdSchema
  })
  .strict();
/** Signed -100..100; rejected here when out of range, clamped by the store for other writers. `reason` may be blank. */
export const StandingSetSchema = z
  .object({
    value: z.number().int().min(-100).max(100),
    reason: z.string().trim().max(120).default(""),
    commandId: CommandIdSchema
  })
  .strict();
/** Out-of-range `windowMinutes` is rejected; a fraction in range (a slider artefact) is truncated by the store. */
export const CodexSettingsSchema = z
  .object({
    revisionHistory: z
      .object({
        enabled: z.boolean(),
        windowMinutes: z.number().min(0).max(10_080)
      })
      .strict(),
    /** In seconds, same rules as `windowMinutes`. Required: this PUT is wholesale, so an omitted group would reset it. */
    autosave: CodexAutosaveSettingsSchema,
    commandId: CommandIdSchema
  })
  .strict();
/** The Codex's one destructive route, so bad values are rejected and never clamped; the max matches the store's `MAX_PRUNE_DAYS`. */
export const RevisionsDeleteSchema = z.object({ olderThanDays: z.number().int().min(0).max(36_500) }).strict();
/**
 * A saved export's `data`, posted back unedited. A missing `bundleVersion` is an older v1 backup; v1 and v2 restore,
 * and a newer version is refused.
 */
export const CodexImportSchema = z
  .object({
    codex: z.record(z.string(), z.unknown()),
    bundleVersion: z
      .number()
      .int()
      .min(1)
      .refine((value) => value <= CODEX_BUNDLE_VERSION, {
        error: "This backup was made by a newer version of the app. Update, then restore."
      })
      .optional(),
    exportedAt: z.string().optional(),
    commandId: CommandIdSchema
  })
  .strict();
export const CalendarSchema = z
  .object({
    yearName: z.string().max(20),
    // Optional for older callers. The PUT replaces the whole calendar, so omitting `eras` clears them.
    eras: z
      .array(
        z.object({ name: z.string().trim().min(1).max(40), startYear: z.number().int().min(-100_000).max(100_000) })
      )
      .max(20)
      .optional(),
    months: z
      .array(z.object({ name: z.string().trim().min(1).max(40), days: z.number().int().min(1).max(400) }))
      .min(1)
      .max(24),
    weekdays: z.array(z.string().trim().min(1).max(40)).max(20),
    currentDate: z
      .object({
        year: z.number().int().min(-100_000).max(100_000),
        month: z.number().int().min(0).max(23),
        day: z.number().int().min(1).max(400)
      })
      .nullable()
      .optional(),
    commandId: CommandIdSchema
  })
  .strict();
