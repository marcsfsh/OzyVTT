import { z } from "zod";
import {
  CODEX_PREP_LIMITS,
  CODEX_PREP_SECTION_TYPES,
  CODEX_SEARCH_VISIBILITIES,
  CodexAutosaveSettingsSchema,
  CodexInWorldDateSchema,
  CodexPrepLinkSchema
} from "@vtt/domain";

/**
 * What each Codex write may contain. Bounds mirror the store's validators, which run again on every write so a
 * backup import and any non-HTTP caller meet the same rules. Every body is `.strict()`: an unknown key is a 400.
 */

/**
 * The backup bundle's format version. A fact about the file, so the export route stamps it beside `codex`. Version 2
 * carries hidden blocks and audiences; a version 1 file restores through the same conversion as migration 4.
 */
export const CODEX_BUNDLE_VERSION = 2;

const TagsSchema = z.array(z.string().trim().min(1).max(40)).max(24);
/** Optional idempotency key on JSON-body writes, stripped before the store. Body-less POSTs and DELETEs are naturally idempotent. */
const CommandIdSchema = z
  .uuid()
  .optional()
  .describe(
    "Optional idempotency key, unique to one request: resend the same id to retry that request safely and the stored outcome is replayed verbatim with `x-idempotent-replay: true`. Reusing an id for a different request is a 400, since answering with the earlier response would silently skip the later write."
  );
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
  .object({
    title: BlockTitleSchema.optional().describe(
      "Optional, one line. It reads as a level 2 heading over the text once the block is shown."
    ),
    text: BlockTextSchema.describe("The block's markdown."),
    anchor: AnchorSchema.optional().describe(
      "Where the block sits: the number of player-text paragraphs before it. Paragraphs split at blank lines (`codexParagraphs` in `@vtt/domain`). An anchor past the last paragraph reads as the end. Omitted: after the player text."
    )
  })
  .strict()
  .describe("A hidden block as a create takes it. It starts Hidden.");
const BlocksSchema = z.array(BlockInputSchema).max(200);
/** Where one block sits. */
export const BlockPlacementSchema = z
  .object({
    id: z.uuid(),
    anchor: AnchorSchema.describe(
      "Where the block sits: the number of player-text paragraphs before it. Paragraphs split at blank lines (`codexParagraphs` in `@vtt/domain`). An anchor past the last paragraph reads as the end."
    )
  })
  .strict()
  .describe("Where one block sits.");
/** Every block of the record exactly once, in document order. */
const LayoutSchema = z.array(BlockPlacementSchema).max(200);
const AudienceSchema = z.enum(["hidden", "everyone", "characters"]);
const CharacterIdsSchema = z.array(z.uuid()).max(12);
export const PageCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    entityType: EntityTypeSchema.optional(),
    /** Every field value, whatever its audience. */
    fields: FieldsSchema.optional().describe("Every field value, whatever its audience."),
    /** Omitted: the kind's default-hidden keys. */
    hiddenFields: z
      .array(z.string().max(40))
      .max(40)
      .optional()
      .describe(
        "The field keys only the GM sees. Omitted: the kind's default, which hides Motives on a character and Secret agenda on a faction."
      ),
    folder: z.string().max(160).nullable().optional(),
    tags: TagsSchema.optional(),
    playerBody: z.string().max(100_000).optional(),
    blocks: BlocksSchema.optional().describe("Hidden blocks to place in the page. Each starts Hidden."),
    revealedToPlayers: z.boolean().optional(),
    bannerAssetId: z.uuid().nullable().optional(),
    /** What places an `event` page on the chronicle. Omitted = unchanged/undated; `null` = clear the date. */
    inWorldDate: InWorldDateSchema.optional().describe(
      "The in-world date that places an `event` page on the chronicle. Omit for undated."
    ),
    commandId: CommandIdSchema
  })
  .strict();
/** No reveal flag, field audience or block content: each has its own route. */
export const PageUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    entityType: EntityTypeSchema.optional(),
    fields: FieldsSchema.optional().describe(
      "Every field value, whatever its audience. Replaced wholesale when present; a field's audience stays."
    ),
    folder: z.string().max(160).nullable().optional(),
    tags: TagsSchema.optional(),
    playerBody: z.string().max(100_000).optional(),
    layout: LayoutSchema.optional().describe(
      "Every block of the record exactly once, in document order, each with its anchor. Applied after `playerBody` in the same write. Omitted: each block keeps its place by paragraph."
    ),
    bannerAssetId: z.uuid().nullable().optional(),
    inWorldDate: InWorldDateSchema.optional().describe(
      "The in-world date. Omitted leaves the stored date alone; `null` clears it."
    ),
    expectedRev: ExpectedRevSchema.describe("Optimistic concurrency: reject with 409 if the page moved on."),
    commandId: CommandIdSchema
  })
  .strict()
  .describe(
    "No reveal flag, field audience or block content: each has its own route, so an edit cannot show players anything as a side effect."
  );
/** A new hidden block at `anchor`; `slot` places it among the blocks there (default: last). */
export const BlockAddSchema = z
  .object({
    anchor: AnchorSchema.describe(
      "Where the block sits: the number of player-text paragraphs before it. Paragraphs split at blank lines (`codexParagraphs` in `@vtt/domain`). An anchor past the last paragraph reads as the end."
    ),
    slot: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Its place among the blocks at that anchor, 0 first. Omitted or past the end: last."),
    title: BlockTitleSchema.optional().describe("Optional, one line."),
    text: BlockTextSchema,
    expectedRev: ExpectedRevSchema.describe(
      "Optimistic concurrency: reject with 409 if the record moved on. Block content and place are edits, so they move `rev`."
    ),
    commandId: CommandIdSchema
  })
  .strict()
  .describe("A new hidden block. It starts Hidden; show it through its audience route.");
export const BlockEditSchema = z
  .object({
    title: BlockTitleSchema.optional(),
    text: BlockTextSchema.optional(),
    expectedRev: ExpectedRevSchema.describe(
      "Optimistic concurrency: reject with 409 if the record moved on. Block content and place are edits, so they move `rev`."
    ),
    commandId: CommandIdSchema
  })
  .strict()
  .describe("A block's title or text; an omitted field is left alone. Its audience stays.");
export const BlockMoveSchema = z
  .object({
    anchor: AnchorSchema.describe(
      "Where the block sits: the number of player-text paragraphs before it. Paragraphs split at blank lines (`codexParagraphs` in `@vtt/domain`). An anchor past the last paragraph reads as the end."
    ),
    slot: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Its place among the blocks at that anchor, 0 first. Omitted or past the end: last."),
    expectedRev: ExpectedRevSchema.describe(
      "Optimistic concurrency: reject with 409 if the record moved on. Block content and place are edits, so they move `rev`."
    ),
    commandId: CommandIdSchema
  })
  .strict();
/** Who sees a block or an objective. `characterIds` only, and then at least one, with `characters`. */
export const AudienceSetSchema = z
  .object({
    audience: AudienceSchema.describe(
      "Who sees it: `hidden` (the GM only), `everyone`, or `characters` (the party characters in `characterIds`)."
    ),
    characterIds: CharacterIdsSchema.optional().describe(
      "The party characters it is shown to, by actor id. Present exactly when `audience` is `characters`, and then at least one. Each must be a player character in the game (400 otherwise)."
    ),
    commandId: CommandIdSchema
  })
  .strict()
  .describe("Who sees a hidden block or an objective. Not an edit: it moves neither `rev` nor `updatedAt`.");
export const FieldAudienceSchema = z
  .object({
    audience: z.enum(["hidden", "everyone"]),
    commandId: CommandIdSchema
  })
  .strict()
  .describe("Who sees one field: `everyone` or `hidden`. Not an edit.");
/** Which party character a preview reads as; omitted or null is a preview as everyone. */
export const PreviewSessionSchema = z
  .object({
    characterId: z
      .uuid()
      .nullable()
      .optional()
      .describe(
        "A player character to read as, exactly as that character's player reads. Omitted or null: a preview as everyone, which reads as a player with no character. Must be a player character (400 otherwise)."
      ),
    commandId: CommandIdSchema
  })
  .strict()
  .describe("Which reader the preview is. The body is optional.");
/** When a tie began: a date, or before the campaign (`inWorldDate` null). `null` clears it. */
export const RelationshipBeganSchema = z
  .object({
    inWorldDate: InWorldDateFields.nullable().describe("The date it began. Null when it began before the campaign."),
    beforeCampaign: z
      .boolean()
      .describe("It began before the campaign; `inWorldDate` must then be null, and is required otherwise.")
  })
  .strict()
  .describe("When a tie began in the world.");
/** `label` is optional: an unlabelled connection just means "related", as a `[[wiki link]]` does. */
export const ConnectionCreateSchema = z
  .object({
    toPageId: z.uuid(),
    label: z
      .string()
      .trim()
      .max(40)
      .nullable()
      .optional()
      .describe(
        'Optional. An unlabelled connection is a legitimate "these two are related" (the same thing a `[[wiki link]]` already expresses), so forcing a word would make the declared half of one concept stricter than the derived half.'
      ),
    layer: z.enum(["player", "gm"]).optional(),
    began: RelationshipBeganSchema.nullable()
      .optional()
      .describe("When the tie began in the world. Null or omitted: no date."),
    commandId: CommandIdSchema
  })
  .strict();
/** Relabel, re-layer or re-date a declared connection. An omitted field is left alone. */
export const ConnectionUpdateSchema = z
  .object({
    label: z.string().trim().max(40).nullable().optional(),
    layer: z.enum(["player", "gm"]).optional(),
    began: RelationshipBeganSchema.nullable()
      .optional()
      .describe("When the tie began in the world; `null` clears it, and omitted leaves it."),
    commandId: CommandIdSchema
  })
  .strict()
  .describe(
    "Moving a connection to the player layer is how the party learns it: the write stamps `learned` once players can read it."
  );
export const RevealSchema = z
  .object({
    revealed: z.boolean(),
    commandId: CommandIdSchema
  })
  .strict();
export const FolderMoveSchema = z
  .object({
    from: z.string().trim().min(1).max(160),
    to: z.string().trim().max(160).describe("Empty string moves the folder to the top level."),
    commandId: CommandIdSchema
  })
  .strict();
export const FolderPathSchema = z
  .object({
    path: z.string().trim().min(1).max(160),
    commandId: CommandIdSchema
  })
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
export const MapParentSchema = z
  .object({
    parentMapId: z.uuid().nullable(),
    commandId: CommandIdSchema
  })
  .strict();

const Coord = z.number().min(0).max(1_000_000);
const IconColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const IconId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/)
  .max(60);
const MarkerLinks = {
  pageIds: z.array(z.uuid()).max(24).optional(),
  subMapId: z.uuid().nullable().optional(),
  encounterIds: z.array(z.uuid()).max(24).optional(),
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
export const MarkerMoveSchema = z
  .object({
    x: Coord,
    y: Coord,
    commandId: CommandIdSchema
  })
  .strict();
/** Only the flag: the party marker is an ordinary marker, moved via `POST /markers/{id}/move`. */
export const MarkerPartySchema = z
  .object({
    isParty: z
      .boolean()
      .describe(
        "`true` makes this the party's pin and clears the flag from whichever pin held it before, anywhere in the atlas. `false` clears it from this pin only and never disturbs a different party pin."
      ),
    commandId: CommandIdSchema
  })
  .strict()
  .describe(
    "One boolean and nothing else: the pin's position, label, links and reveal state are all set through the routes that already own them, because the party marker is an ordinary marker with a flag."
  );
/** Put the party at a point on a map: the party pin moves there, or one is made. */
export const PartyPlaceSchema = z
  .object({
    mapId: z.uuid(),
    x: Coord,
    y: Coord,
    revealedToPlayers: z.boolean().optional(),
    commandId: CommandIdSchema
  })
  .strict();

export const JournalWriteSchema = z
  .object({
    tags: TagsSchema.optional(),
    playerText: z
      .string()
      .max(20_000)
      .optional()
      .describe(
        "The deadline itself, in the party's words: a deadline is its text, which is why it stores no separate 'what'."
      ),
    gmText: z.string().max(20_000).nullable().optional(),
    revealedToPlayers: z.boolean().optional(),
    attachMarkerId: z.uuid().nullable().optional(),
    attachPageId: z.uuid().nullable().optional(),
    /** By id only (`sessionNumber` is server-resolved and rejected). Omitted on create: active session; `null`: none; unknown: 404. */
    sessionId: z
      .uuid()
      .nullable()
      .optional()
      .describe(
        "File this entry under a session by ID. Omitted on a create auto-files it under the active session; explicit `null` files it under none; an id naming no session is a 404. `sessionNumber` is not accepted on any write; the number is a display value the server resolves from the linked record, so a body carrying one is a 400 with the key named in `details.issues`."
      ),
    realDate: z.string().max(40).nullable().optional(),
    inWorldLabel: z.string().max(120).nullable().optional(),
    inWorldDate: InWorldDateSchema.optional(),
    commandId: CommandIdSchema
  })
  .strict();
/** A deadline requires `inWorldDate`, since `fired` derives from it. */
export const DeadlineCreateSchema = JournalWriteSchema.extend({
  inWorldDate: InWorldDateFields.describe(
    "When it happens: the date the campaign clock has to reach for this to fire. Required, and never null."
  )
}).describe(
  "Everything `CodexJournalCreateRequest` accepts, with one difference: `inWorldDate` is required and may not be null. A deadline is a thing that will happen at a time, and `fired` is derived from that date alone, so an undated one could never fire; it would be a note wearing a deadline's label. There is no `kind` to send (the route says it) and no reveal rule of its own: `revealedToPlayers` behaves exactly as it does on an ordinary entry."
);
/** `applied` is not an input (only `apply-downtime` moves the clock). `who`/`activity` may be blank for party-wide downtime. */
export const DowntimeInputSchema = z
  .object({
    who: z
      .string()
      .trim()
      .max(120)
      .describe("Who spent the time. May be empty: downtime is often party-wide with nobody in particular to name."),
    activity: z
      .string()
      .trim()
      .max(120)
      .describe(
        "What they did. May be empty, for the same reason as `who`: the record's prose carries it when the fields do not."
      ),
    days: z
      .number()
      .int()
      .min(0)
      .max(3650)
      .describe(
        "The time cost in in-world days. Ten years is already well past the point where a GM would set a date and stop counting days."
      ),
    /** Links the tracker to a person whatever the spelling; unknown ids 404, page type is not checked. */
    characterPageId: z
      .uuid()
      .nullable()
      .optional()
      .describe(
        "Which character page this downtime belongs to, so the tracker totals one person's downtime whatever spelling of the name `who` carries. Optional; `who` remains the free-text fallback for anyone with no page, and both may coexist. An id naming no page is a **404**. The page's type is deliberately not enforced (a GM may track downtime for an NPC or a hireling), which is the opposite of the standing rule, because standing is *about* a faction while downtime is about someone the GM happens to have a record for."
      )
  })
  .strict()
  .describe(
    "The downtime facts themselves. `applied` is deliberately not an input: confirming the clock move is a separate, explicit act, and accepting it here would let one POST both record the week off and move the campaign clock."
  );
export const DowntimeCreateSchema = JournalWriteSchema.extend({ downtime: DowntimeInputSchema }).describe(
  "Everything `CodexJournalCreateRequest` accepts, plus the required `downtime` facts. Omitting `inWorldDate`, or sending it as null, dates the record at the GM's current campaign date, the rule an auto-logged battle already follows, so downtime lands where it happened in the timeline. This differs deliberately from every other journal route, where a null clears the date: downtime that happened at no point in time is not downtime."
);
/** `days` is not editable (the clock already moved by it); `.strict()` rejects it. */
export const JournalUpdateSchema = JournalWriteSchema.extend({
  downtime: z
    .object({
      who: z.string().trim().max(120).optional(),
      activity: z.string().trim().max(120).optional(),
      characterPageId: z
        .uuid()
        .nullable()
        .optional()
        .describe("An id naming no page is a 404; `null` clears the link and leaves `who` as the display fallback.")
    })
    .strict()
    .optional()
    .describe(
      "Edits a downtime record's own facts. **400 when the entry is not a downtime record**: a caller sending downtime details to a milestone has misunderstood something, and hearing so beats being quietly overruled. This is the adoption path the tracker needs: it is what lets a GM link the free-text rows that already exist to real character pages, so downtime recorded before character links existed can link too. `days` is deliberately not a member and sending it is a 400: it is what `apply-downtime` moved the campaign clock by, so editing it afterwards would leave the clock disagreeing with the record that justified it. A typo in `days` is a delete-and-recreate. `applied` is likewise absent, because confirming the clock move is its own explicit act."
    )
}).describe(
  "Edits a journal entry; an omitted field is left alone. Identical to `CodexJournalCreateRequest` plus one narrow payload group."
);
/** `level` uses the 1-20 character-level bound; `reason` may be blank. */
export const MilestoneInputSchema = z
  .object({
    level: z
      .number()
      .int()
      .min(1)
      .max(20)
      .describe("The level the party reached. 1-20, the repo's existing character-level bound."),
    reason: z
      .string()
      .trim()
      .max(120)
      .default("")
      .describe(
        'Why, in one line. Optional and may be empty: "we hit 5" with the why in the record\'s own prose is a legitimate body, and a minimum here would reject a state the composer can reach. Defaults to an empty string.'
      )
  })
  .strict()
  .describe(
    'The milestone facts themselves. Exactly two: the spec says "milestone / level history … no XP arithmetic", so there is no XP total, no threshold and no next level.'
  );
export const MilestoneCreateSchema = JournalWriteSchema.extend({ milestone: MilestoneInputSchema }).describe(
  "Everything `CodexJournalCreateRequest` accepts, plus the required `milestone` facts: `CodexDowntimeCreateRequest`'s shape verbatim, because it is the same kind of thing: a structured payload riding beside a record that is prose. Omitting `inWorldDate` dates the record at the GM's current campaign date, so a level-up lands where it happened. Undated is legitimate here where it is not for a deadline: a deadline with no date can never fire, but \"the party reached 5\" is a thing that happened."
);
// Session prep. Nested ids are optional on a write (the store mints missing ones) and `doneAt` is the server's.
const PrepTitleSchema = z.string().trim().min(1).max(CODEX_PREP_LIMITS.sectionTitle);
const PrepPromptSchema = z.string().max(CODEX_PREP_LIMITS.prompt).nullable().optional();
const PrepIdsSchema = (max: number) => z.array(z.uuid()).max(max).optional();
export const PrepTemplateSectionInputSchema = z
  .object({
    id: z.uuid().optional(),
    title: PrepTitleSchema,
    prompt: PrepPromptSchema,
    type: z.enum(CODEX_PREP_SECTION_TYPES)
  })
  .strict();
const PrepTemplateSectionsSchema = z.array(PrepTemplateSectionInputSchema).max(CODEX_PREP_LIMITS.templateSections);
const PrepTemplateNameSchema = z.string().trim().min(1).max(CODEX_PREP_LIMITS.templateName);
export const PrepTemplateCreateSchema = z
  .object({ name: PrepTemplateNameSchema, sections: PrepTemplateSectionsSchema.optional(), commandId: CommandIdSchema })
  .strict();
/** Send `sections` whole to add, remove, rename or reorder them. */
export const PrepTemplateUpdateSchema = z
  .object({
    name: PrepTemplateNameSchema.optional(),
    sections: PrepTemplateSectionsSchema.optional(),
    expectedRev: z.number().int().nonnegative().optional(),
    commandId: CommandIdSchema
  })
  .strict();
export const PrepTemplateDuplicateSchema = z
  .object({ name: PrepTemplateNameSchema.optional(), commandId: CommandIdSchema })
  .strict();
const prepSectionBase = {
  id: z.uuid().optional(),
  templateSectionId: z.uuid().nullable().optional(),
  title: PrepTitleSchema,
  prompt: PrepPromptSchema
};
/** `doneAt` is accepted so a read item can be sent back whole, and ignored: the server stamps it. */
export const PrepChecklistItemInputSchema = z
  .object({
    id: z.uuid().optional(),
    text: z.string().max(CODEX_PREP_LIMITS.itemText),
    done: z.boolean().optional(),
    doneAt: z.string().nullable().optional(),
    link: CodexPrepLinkSchema.nullable().optional()
  })
  .strict();
export const PrepSceneInputSchema = z
  .object({
    id: z.uuid().optional(),
    title: z.string().max(CODEX_PREP_LIMITS.sceneTitle),
    placePageId: z.uuid().nullable().optional(),
    notes: z.string().max(CODEX_PREP_LIMITS.sceneNotes).optional()
  })
  .strict();
export const PrepSectionInputSchema = z.discriminatedUnion("type", [
  z
    .object({ ...prepSectionBase, type: z.literal("text"), text: z.string().max(CODEX_PREP_LIMITS.text).optional() })
    .strict(),
  z
    .object({
      ...prepSectionBase,
      type: z.literal("checklist"),
      items: z.array(PrepChecklistItemInputSchema).max(CODEX_PREP_LIMITS.items).optional()
    })
    .strict(),
  z.object({ ...prepSectionBase, type: z.literal("pages"), pageIds: PrepIdsSchema(CODEX_PREP_LIMITS.pages) }).strict(),
  z
    .object({
      ...prepSectionBase,
      type: z.literal("scenes"),
      scenes: z.array(PrepSceneInputSchema).max(CODEX_PREP_LIMITS.scenes).optional()
    })
    .strict(),
  z
    .object({ ...prepSectionBase, type: z.literal("clocks"), deadlineIds: PrepIdsSchema(CODEX_PREP_LIMITS.deadlines) })
    .strict(),
  z
    .object({ ...prepSectionBase, type: z.literal("quests"), questIds: PrepIdsSchema(CODEX_PREP_LIMITS.quests) })
    .strict(),
  z
    .object({
      ...prepSectionBase,
      type: z.literal("encounters"),
      encounterIds: PrepIdsSchema(CODEX_PREP_LIMITS.encounters)
    })
    .strict()
]);
const PrepSchema = z.array(PrepSectionInputSchema).max(CODEX_PREP_LIMITS.sessionSections);

/** Sessions. `sessionNumber` uses the journal's bounds because a journal entry resolves against it. */
const SessionNumberSchema = z.number().int().min(0).max(100_000).nullable();
const AttendeesSchema = z.array(z.string().trim().min(1).max(40)).max(24);
const SessionStatusSchema = z.enum(["planned", "played"]);
/** Scene attachments, capped at the table's own scene cap. */
const SessionSceneIdsSchema = z.array(z.uuid()).max(20);
/** `templateId` omitted copies the default template, `null` starts empty; `prep` sets the sections instead. */
export const SessionCreateSchema = z
  .object({
    sessionNumber: SessionNumberSchema.optional().describe("Must not already be in use by another session."),
    realDate: z.string().max(40).nullable().optional(),
    attendees: AttendeesSchema.optional(),
    templateId: z.uuid().nullable().optional(),
    prep: PrepSchema.optional(),
    recapBody: z.string().max(100_000).optional(),
    revealedToPlayers: z.boolean().optional(),
    status: SessionStatusSchema.optional(),
    tags: TagsSchema.optional().describe(
      "Up to 24 tags, each 1-40 characters, trimmed and lowercased server-side. Replaced wholesale when present."
    ),
    /** Scenes staged for this session; the store re-applies the cap. */
    encounterIds: SessionSceneIdsSchema.optional().describe(
      "Prepared scenes staged for this session. Capped at the table's scene cap."
    ),
    commandId: CommandIdSchema
  })
  .strict()
  .describe("Every field is optional: an empty body opens a blank `planned` session for the GM to prep into.");
/** No `revealedToPlayers`: reveal is its own route, so a PATCH cannot publish a recap as a side effect of an edit. */
export const SessionUpdateSchema = z
  .object({
    sessionNumber: SessionNumberSchema.optional().describe(
      "Must not already be in use by another session; `null` clears it."
    ),
    realDate: z.string().max(40).nullable().optional(),
    attendees: AttendeesSchema.optional(),
    /** The whole list of sections. */
    prep: PrepSchema.optional(),
    recapBody: z.string().max(100_000).optional(),
    status: SessionStatusSchema.optional(),
    tags: TagsSchema.optional().describe(
      "Up to 24 tags, each 1-40 characters, trimmed and lowercased server-side. Replaced wholesale when present."
    ),
    encounterIds: SessionSceneIdsSchema.optional().describe(
      "Prepared scenes staged for this session; replaces the stored list."
    ),
    expectedRev: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("Optimistic concurrency: reject with 409 if the session moved on."),
    commandId: CommandIdSchema
  })
  .strict()
  .describe(
    'An omitted field is left alone; the console PATCHes a whole draft on every autosave, so "absent means clear" would wipe the half of the record the editing surface does not carry. `revealed` is deliberately not here: reveal is its own route because it is not an edit (it moves neither `rev` nor `updatedAt`), exactly as on a page.'
  );
export const SessionApplyTemplateSchema = z
  .object({ templateId: z.uuid(), expectedRev: z.number().int().nonnegative().optional(), commandId: CommandIdSchema })
  .strict();
/** One line logged at the table. */
export const SessionLogSchema = z
  .object({
    text: z.string().trim().min(1).max(2000),
    revealedToPlayers: z.boolean().optional(),
    commandId: CommandIdSchema
  })
  .strict();
export const SessionTickSchema = z.object({ itemId: z.uuid(), done: z.boolean(), commandId: CommandIdSchema }).strict();
export const SessionCurrentSceneSchema = z
  .object({ sceneId: z.uuid().nullable(), commandId: CommandIdSchema })
  .strict();

/** Bounds mirror the store's. Objective text may be empty (the editor autosaves right after "Add item"). */
const QuestStatusSchema = z.enum(["not-started", "active", "completed", "failed", "canceled"]);
/**
 * An objective as a write lists it: `id` for one the server gave, none for a new one. `audience` only on a new one
 * (default everyone); an existing objective's audience has its own route.
 */
export const ObjectiveSchema = z
  .object({
    id: z
      .uuid()
      .optional()
      .describe(
        "The id the server gave the objective; leave it out for a new one. An id the quest does not hold is a 400."
      ),
    text: z.string().max(120),
    done: z.boolean(),
    audience: AudienceSchema.optional().describe(
      "Only on a new objective, which is shown to everyone when this is omitted. An existing objective's audience has its own route, so a write is a 400 if it sends one with an `id`."
    ),
    characterIds: CharacterIdsSchema.optional().describe(
      "The party characters it is shown to, by actor id. Present exactly when `audience` is `characters`, and then at least one."
    )
  })
  .strict()
  .describe("An objective as a quest write lists it.");
const ObjectivesSchema = z.array(ObjectiveSchema).max(24);
const QuestEntityIdsSchema = z.array(z.uuid()).max(24);
export const QuestCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    status: QuestStatusSchema.optional().describe(
      "In lifecycle order. `not-started` and `active` are the open states (a quest the party can still do) and `completed`, `failed` and `canceled` are three different ways of being finished with one. `canceled` is not a synonym for `failed`: a lead the party never took up did not fail. A quest created without a status is `not-started`."
    ),
    playerBody: z.string().max(100_000).optional(),
    blocks: BlocksSchema.optional().describe("Hidden blocks to place in the quest. Each starts Hidden."),
    objectives: ObjectivesSchema.optional(),
    entityIds: QuestEntityIdsSchema.optional(),
    revealedToPlayers: z.boolean().optional(),
    tags: TagsSchema.optional().describe(
      "Up to 24 tags, each 1-40 characters, trimmed and lowercased server-side. Replaced wholesale when present."
    ),
    commandId: CommandIdSchema
  })
  .strict()
  .describe("Only `title` is required; a lead can be named the moment it appears at the table and filled in later.");
/** No `revealedToPlayers`: reveal is its own route, so a PATCH cannot publish a quest as a side effect of an edit. */
export const QuestUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    status: QuestStatusSchema.optional().describe(
      "In lifecycle order. `not-started` and `active` are the open states (a quest the party can still do) and `completed`, `failed` and `canceled` are three different ways of being finished with one. `canceled` is not a synonym for `failed`: a lead the party never took up did not fail. A quest created without a status is `not-started`."
    ),
    playerBody: z.string().max(100_000).optional(),
    layout: LayoutSchema.optional().describe(
      "Every block of the record exactly once, in document order, each with its anchor. Applied after `playerBody` in the same write. Omitted: each block keeps its place by paragraph."
    ),
    objectives: ObjectivesSchema.optional(),
    entityIds: QuestEntityIdsSchema.optional(),
    tags: TagsSchema.optional().describe(
      "Up to 24 tags, each 1-40 characters, trimmed and lowercased server-side. Replaced wholesale when present."
    ),
    expectedRev: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("Optimistic concurrency: reject with 409 if the quest moved on."),
    commandId: CommandIdSchema
  })
  .strict()
  .describe(
    'An omitted field is left alone; the console PATCHes a whole draft on every autosave, so "absent means clear" would wipe the half of the record the editing surface does not carry. `objectives` and `entityIds` are replaced wholesale when present, and objectives are stored in exactly the order given; an objective sent with its `id` keeps its audience. `revealed` is deliberately not here: reveal is its own route because it is not an edit (it moves neither `rev` nor `updatedAt`), exactly as on a page.'
  );
/** Signed -100..100; rejected here when out of range, clamped by the store for other writers. `reason` may be blank. */
export const StandingSetSchema = z
  .object({
    value: z
      .number()
      .int()
      .min(-100)
      .max(100)
      .describe(
        "The new standing, signed. Rejected outside -100..100 here (the client's control cannot produce a 150, so one is a malformed caller) and clamped to the same range by the store, which is the router-rejects / store-enforces arrangement every bounded field in this surface uses."
      ),
    reason: z
      .string()
      .trim()
      .max(120)
      .default("")
      .describe(
        "Why it moved, in one line; it lands on the `standing` chronicle record. Optional and may be empty: adjusting a standing mid-session should not be blocked on typing a sentence, and the change is recorded either way. Defaults to an empty string."
      ),
    commandId: CommandIdSchema
  })
  .strict()
  .describe(
    "Sets the resulting standing; the server works out the delta and writes it to the chronicle record in the same transaction. There is no separate create: `faction_page_id` is unique, so the first set for a faction creates its row."
  );
/** Out-of-range `windowMinutes` is rejected; a fraction in range (a slider artefact) is truncated by the store. */
export const CodexSettingsSchema = z
  .object({
    revisionHistory: z
      .object({
        enabled: z
          .boolean()
          .describe(
            "Whether a page save may write a new revision at all. Default `true`: every existing codex upgrades with history on, exactly as it was."
          ),
        windowMinutes: z
          .number()
          .min(0)
          .max(10_080)
          .describe(
            'Coalescing window. A save whose page already has a checkpoint younger than this writes no new one, so at most this much authoring can be lost. Measured against when the checkpointed content was authored (the time its row was written plays no part), which is what makes the guarantee hold across an idle gap as well as during continuous work. `0` keeps every save; the 10080 ceiling is one week of minutes, past which the window stops coalescing a work session and starts meaning "keep almost nothing", which `enabled: false` already says more honestly. The owner\'s default is 90.'
          )
      })
      .strict()
      .describe(
        'The two settable revision-history knobs, and the difference between them is load-bearing: `enabled: false` writes no new revisions at all, while `windowMinutes: 0` writes one for every save. `0` is therefore not "off" (it is the behaviour every codex had before this setting existed), and the two are separate fields so nothing has to guess which a zero meant. Neither setting ever deletes a revision: switching history off stops new checkpoints and nothing else, and the existing history stays listable and restorable, because disabling a feature must not destroy the GM\'s only undo. Deleting is a separate, explicit act (`DELETE /codex/page-revisions`).'
      ),
    /** In seconds, same rules as `windowMinutes`. Required: this PUT is wholesale, so an omitted group would reset it. */
    autosave: CodexAutosaveSettingsSchema,
    commandId: CommandIdSchema
  })
  .strict()
  .describe(
    "Every codex-wide setting a caller may set. Identical to `CodexSettings` except that the server-computed usage figures are absent: sending `versionCount` or `versionBytes` is a 400, because they are facts about a table the caller cannot see. Both groups are required: this replaces the settings wholesale, so an omitted group would silently reset a setting the caller never mentioned."
  );
/** The Codex's one destructive route, so bad values are rejected and never clamped; the max matches the store's `MAX_PRUNE_DAYS`. */
export const RevisionsDeleteSchema = z
  .object({
    olderThanDays: z
      .number()
      .int()
      .min(0)
      .max(36_500)
      .describe(
        "Delete every revision authored more than this many days ago. **`0` deletes them all**: plain arithmetic, since nothing is younger than zero days old. A negative or fractional value is a 400 and is never clamped, because this destroys data. The 36500 ceiling (100 years) is a guard: a larger value pushes the cutoff date out of the representable range, which would turn a silly request into a 500."
      )
  })
  .strict()
  .describe(
    "Which revisions to delete, by age. Required, with no default: the destructive route must not have a meaning when the body is silent."
  );
/**
 * A saved export's `data`, posted back unedited. A missing `bundleVersion` is an older v1 backup; v1 and v2 restore,
 * and a newer version is refused.
 */
export const CodexImportSchema = z
  .object({
    codex: z.record(z.string(), z.unknown()).describe("The export's `codex` bundle, verbatim."),
    bundleVersion: z
      .number()
      .int()
      .min(1)
      .refine((value) => value <= CODEX_BUNDLE_VERSION, {
        error: "This backup was made by a newer version of the app. Update, then restore."
      })
      .optional()
      .describe(
        'Optional. Absent = a pre-versioning v1 bundle. Version 1 restores through the same conversion as the upgrade (each GM body becomes Hidden blocks, secret fields become Hidden fields), and version 2 as written. A newer version is refused: "This backup was made by a newer version of the app. Update, then restore."'
      ),
    exportedAt: z
      .string()
      .optional()
      .describe("Accepted and ignored, so a saved export file can be POSTed without editing."),
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
      .optional()
      .describe(
        "Optional so a caller written before eras existed is not met with a 400. It is replaced like every other field on this route: omitting it clears the stored eras."
      ),
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

// ----- Query strings -----
// The server reads these with its own parsers, which give the GM's messages (`codex-requests.ts` in the server);
// the registry documents them from the schemas below, and `codex-queries.test.ts` checks the two agree.

/** `GET /codex/pages`. */
export const CodexPageListQuerySchema = z.object({
  folder: z
    .string()
    .optional()
    .describe("Only the pages filed in this folder; an empty value means the top level. A player's is ignored."),
  tag: z.string().optional().describe("Only the pages with this tag.")
});

/** `GET /codex/search`. Every parameter is optional. */
export const CodexSearchQuerySchema = z.object({
  q: z.string().max(200).optional().describe("The text to find. Blank lists everything the filters allow."),
  types: z
    .string()
    .optional()
    .describe(
      "A comma list of search types: a page's kind, `page` for every kind of page, `journal`, `map`, `marker`, `quest` or `session`. Default: all."
    ),
  visibility: z
    .enum(CODEX_SEARCH_VISIBILITIES)
    .optional()
    .describe("The GM's filter: `all`, `revealed` or `hidden`. A player's is ignored."),
  modifiedFrom: z
    .string()
    .optional()
    .describe("Inclusive: an ISO date and time, or `YYYY-MM-DD` for the start of that UTC day."),
  modifiedTo: z
    .string()
    .optional()
    .describe("Inclusive: an ISO date and time, or `YYYY-MM-DD` for the end of that UTC day."),
  sort: z
    .string()
    .optional()
    .describe(
      "A comma list of `key`, `key:asc` or `key:desc`, the first key first, at most 4. Keys: `relevance`, `name`, `type`, `modified`, `visibility` (the GM's only) or a field's key. A missing value sorts last either way."
    ),
  limit: z.number().int().min(1).max(500).optional().describe("How many hits to answer, 1 to 500. Default 50.")
});

/** `GET /codex/home`. */
export const CodexHomeQuerySchema = z.object({
  since: z.iso
    .datetime({ offset: true })
    .optional()
    .describe("A player's last visit, as an ISO date and time. Without it everything is new. The GM's is ignored.")
});

/** `GET /codex/journal`. */
export const CodexJournalQuerySchema = z.object({
  markerId: z.uuid().optional().describe("Only the entries pinned to this marker."),
  pageId: z.uuid().optional().describe("Only the entries attached to this page.")
});
