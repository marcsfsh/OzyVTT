import { z } from "zod";
import {
  BuilderOffersReplySchema,
  ContentCompendiumKindSchema,
  ContentCompendiumSchema,
  HomebrewSeeAsRecordSchema,
  HomebrewSeeAsSchema
} from "@vtt/domain";
import { HomebrewSeeAsBuilderOffersSchema } from "@vtt/domain/commands";
import {
  HOMEBREW_PATHS,
  HomebrewAudienceRequestSchema,
  HomebrewContentListSchema,
  HomebrewContentSchema,
  HomebrewCreateRequestSchema,
  HomebrewDeletedSchema,
  HomebrewDuplicateRequestSchema,
  HomebrewIdSchema,
  HomebrewListQuerySchema,
  HomebrewOverviewSchema,
  HomebrewPackExportQuerySchema,
  HomebrewPackExportSchema,
  HomebrewPackImportRequestSchema,
  HomebrewPackImportSchema,
  HomebrewPackListSchema,
  HomebrewPackResultSchema,
  HomebrewPackUpdateRequestSchema,
  HomebrewRevisionListSchema,
  HomebrewRevisionReadSchema,
  HomebrewSearchQuerySchema,
  HomebrewSearchSchema,
  HomebrewSharingRequestSchema,
  HomebrewSharingSchema,
  HomebrewSrdRecordSchema,
  HomebrewStateChangeRequestSchema,
  HomebrewTableQuerySchema,
  HomebrewTableSchema,
  HomebrewUpdateRequestSchema,
  HomebrewUsagesSchema
} from "../index.js";
import { defineRoute, GM_SESSION, json, noBody, ok, refused } from "./define.js";

/**
 * The GM's homebrew authoring (`homebrew-http.ts`). Every route takes a GM session alone: players see homebrew only
 * through the reference catalogs built for them, which hold the records that are published, in a pack that is on,
 * not archived, and shared with everyone or with one of the reader's characters.
 */

const record = z.object({
  id: HomebrewIdSchema.describe(
    "The record's id: a minted homebrew id (`hb-<slug>-<6 hex>`), or for a copy an SRD id such as `wizard`."
  )
});
/** An SRD id is a content slug, up to 80 characters; a homebrew id fits inside it. */
const anyRecord = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(80)
    .describe("A homebrew id, or an SRD id such as `fireball`.")
});
const revision = record.extend({
  revisionId: z.coerce.number().int().min(1).describe("The history row's id, from the record's revisions.")
});
const pack = z.object({
  packId: z
    .union([z.literal("table"), z.uuid()])
    .describe("`table` for this table's own records, or an imported pack's id.")
});
const seeAs = z.object({
  as: HomebrewSeeAsSchema.describe("Who to read as: `everyone`, or a party player character's actor id.")
});
const seeAsCompendium = seeAs.extend({
  kind: ContentCompendiumKindSchema.describe("The kind of record to list. No monsters.")
});

/** The conflict is the contract's `HomebrewConflict`; error details are untyped in the document, so it is told here. */
const STALE = refused(
  "`expectedRev` is stale. `error.currentRevision` carries the record's current revision, and `error.details.conflict` what the server's copy changed since: `baseRev`, `currentRev`, `baseKnown` (false when no history row holds `baseRev`), `changes` (each top-level field changed since, with its `base` and `current` value) and `rowChanges` (`state`, `audience` or `archived`)."
);
const NOT_MODIFIED = noBody("Not modified: the weak ETag sent in `If-None-Match` is still current.");
const NOT_IN_PARTY =
  "`characterIds` is missing with `characters`, given without it, or names a character not in the party.";

export const listHomebrewContent = defineRoute({
  method: "get",
  path: HOMEBREW_PATHS.content,
  operationId: "listHomebrewContent",
  tag: "Homebrew",
  summary: "List the homebrew library",
  description:
    "The GM's homebrew as flat summaries, each with who sees it, its pack, its issue count and its kind's own columns. The authored bodies stay out of the list, so a library of a few hundred records is a small answer. Filters combine, and archived records are left out unless `includeDeleted` is set. Pages are keyset pages, so a record published mid-scroll is neither skipped nor repeated: pass `nextCursor` back as `cursor`, and `nextCursor: null` marks the last page. `total` counts every record that matches, whatever the page.",
  access: GM_SESSION,
  query: HomebrewListQuerySchema,
  responses: {
    200: ok(HomebrewContentListSchema, "A page of the library."),
    400: refused(),
    401: refused(),
    403: refused()
  }
});

export const createHomebrewContent = defineRoute({
  method: "post",
  path: HOMEBREW_PATHS.content,
  operationId: "createHomebrewContent",
  tag: "Homebrew",
  summary: "Create a homebrew record",
  description:
    'A new record is a Hidden draft in the table pack (`state: "draft"`, `audience: "hidden"`). Its id is minted from its name and never changes, so send the name the GM chose. A draft may be invalid, and nothing reaches a player until it is published and shared.',
  access: GM_SESSION,
  body: json(HomebrewCreateRequestSchema),
  responses: {
    201: ok(HomebrewContentSchema, "The new record."),
    400: refused(),
    401: refused(),
    403: refused(),
    409: refused(
      "The store refuses the record. It needs one of the nine types and a name of up to 120 characters, and it must fit the store's size limit."
    )
  }
});

export const getHomebrewContent = defineRoute({
  method: "get",
  path: HOMEBREW_PATHS.contentById,
  operationId: "getHomebrewContent",
  tag: "Homebrew",
  summary: "Read a homebrew record",
  description:
    "One record with its row state, who sees it and when it reached them, its pack, what it was based on, the names of the records its body mentions (`references`), and its full validity report (`validity.issues`), so an editor can show what still blocks publishing in one read.",
  access: GM_SESSION,
  params: record,
  responses: {
    200: ok(HomebrewContentSchema, "The record."),
    401: refused(),
    403: refused(),
    404: refused()
  }
});

export const updateHomebrewContent = defineRoute({
  method: "patch",
  path: HOMEBREW_PATHS.contentById,
  operationId: "updateHomebrewContent",
  tag: "Homebrew",
  summary: "Edit a homebrew record",
  description:
    "Replaces the authored `record` and leaves the row state, who sees it and `deletedAt` alone. The body is always the whole record: a partial merge into a body that can be nine shapes cannot be specified. On a published record the edit is held as pending (`pendingChanges: true`), and the live body stays in the catalogs, so an edit mid-session takes nothing from the players. `/publish` puts the pending body live, and `/discard` drops it. Every edit leaves a history row.",
  access: GM_SESSION,
  params: record,
  body: json(HomebrewUpdateRequestSchema),
  responses: {
    200: ok(HomebrewContentSchema, "The record."),
    400: refused(),
    401: refused(),
    403: refused(),
    404: refused(),
    409: STALE
  }
});

export const deleteHomebrewContent = defineRoute({
  method: "delete",
  path: HOMEBREW_PATHS.contentById,
  operationId: "deleteHomebrewContent",
  tag: "Homebrew",
  summary: "Archive a homebrew record",
  description:
    "Archives the record by setting `deletedAt`. Archiving an unknown or archived id is still a 200. The record leaves the catalogs at once, and `/restore` brings it back.",
  access: GM_SESSION,
  params: record,
  responses: {
    200: ok(HomebrewDeletedSchema, "The record is archived."),
    401: refused(),
    403: refused()
  }
});

export const restoreHomebrewContent = defineRoute({
  method: "post",
  path: HOMEBREW_PATHS.contentRestore,
  operationId: "restoreHomebrewContent",
  tag: "Homebrew",
  summary: "Restore an archived homebrew record",
  description: "Clears `deletedAt`. A PATCH leaves `deletedAt` alone, so this route is how an archive is undone.",
  access: GM_SESSION,
  params: record,
  responses: {
    200: ok(HomebrewContentSchema, "The record."),
    401: refused(),
    403: refused(),
    404: refused()
  }
});

export const duplicateHomebrewContent = defineRoute({
  method: "post",
  path: HOMEBREW_PATHS.contentDuplicate,
  operationId: "duplicateHomebrewContent",
  tag: "Homebrew",
  summary: "Copy a record into homebrew",
  description:
    'Copies a record whole under an id minted from `name` (absent, "<source> (copy)"). `{id}` may be an SRD id (`wizard`): the server reads the full bundled record and mints a homebrew copy, which makes a class\'s 20-row table practical to author. The copy is a Hidden draft in the table pack, and `basedOn` names its source.',
  access: GM_SESSION,
  params: record,
  body: json(HomebrewDuplicateRequestSchema, { required: false }),
  responses: {
    201: ok(HomebrewContentSchema, "The copy."),
    400: refused(),
    401: refused(),
    403: refused(),
    404: refused(),
    409: refused("The store refuses the copy.")
  }
});

export const publishHomebrewContent = defineRoute({
  method: "post",
  path: HOMEBREW_PATHS.contentPublish,
  operationId: "publishHomebrewContent",
  tag: "Homebrew",
  summary: "Publish a homebrew record",
  description:
    'Moves a record to `state: "published"`, which needs it to be valid. On a published record with `pendingChanges`, it checks the pending body and puts it live; refused, the live body stays. Publishing shares nothing: a newly published record is Hidden until `/audience` or `/homebrew/sharing` says who sees it. A malformed request is a 400, and a well-formed one the stored record refuses is a 409.',
  access: GM_SESSION,
  params: record,
  body: json(HomebrewStateChangeRequestSchema, { required: false }),
  responses: {
    200: ok(HomebrewContentSchema, "The record."),
    400: refused(),
    401: refused(),
    403: refused(),
    404: refused(),
    409: refused(
      "The record is not valid: `error.details.invalid.issues` lists every blocking issue as a plain sentence with its `path`. A stale `expectedRev` is a 409 too, with `error.currentRevision` and `error.details.conflict`."
    )
  }
});

export const discardHomebrewChanges = defineRoute({
  method: "post",
  path: HOMEBREW_PATHS.contentDiscard,
  operationId: "discardHomebrewChanges",
  tag: "Homebrew",
  summary: "Drop a record's pending edits",
  description:
    "Drops a published record's pending edits; the live body stays. With nothing pending it changes nothing.",
  access: GM_SESSION,
  params: record,
  body: json(HomebrewStateChangeRequestSchema, { required: false }),
  responses: {
    200: ok(HomebrewContentSchema, "The record."),
    400: refused(),
    401: refused(),
    403: refused(),
    404: refused(),
    409: STALE
  }
});

export const unpublishHomebrewContent = defineRoute({
  method: "post",
  path: HOMEBREW_PATHS.contentUnpublish,
  operationId: "unpublishHomebrewContent",
  tag: "Homebrew",
  summary: "Unpublish a homebrew record",
  description:
    'Returns a record to `state: "draft"` and makes it Hidden, since a draft is always Hidden. It leaves the catalogs at once, and may be invalid again while the GM reworks it. Pending edits become the draft\'s body, since a draft is edited in place.',
  access: GM_SESSION,
  params: record,
  body: json(HomebrewStateChangeRequestSchema, { required: false }),
  responses: {
    200: ok(HomebrewContentSchema, "The record."),
    400: refused(),
    401: refused(),
    403: refused(),
    404: refused(),
    409: STALE
  }
});

export const setHomebrewContentAudience = defineRoute({
  method: "put",
  path: HOMEBREW_PATHS.contentAudience,
  operationId: "setHomebrewContentAudience",
  tag: "Homebrew",
  summary: "Say who sees a published record",
  description:
    "Hidden (the GM only), everyone, or the players of the party characters in `characterIds`. `characterIds` comes with `characters` alone, and then holds at least one party player character. Each time the record reaches an audience it did not reach before, a reveal stamp records when. Leaves a history row.",
  access: GM_SESSION,
  params: record,
  body: json(HomebrewAudienceRequestSchema, {
    example: { audience: "characters", characterIds: ["10000000-0000-4000-8000-000000000001"], expectedRev: 9 }
  }),
  responses: {
    200: ok(HomebrewContentSchema, "The record."),
    400: refused(NOT_IN_PARTY),
    401: refused(),
    403: refused(),
    404: refused(),
    409: refused(
      "A draft or an archived record can only be Hidden: publish or restore it first. A stale `expectedRev` is a 409 too, with `error.details.conflict`."
    )
  }
});

export const setHomebrewSharing = defineRoute({
  method: "post",
  path: HOMEBREW_PATHS.sharing,
  operationId: "setHomebrewSharing",
  tag: "Homebrew",
  summary: "Say who sees several records",
  description:
    "Sets one audience on up to 500 records in one write. It is all or nothing: one unknown id, stale `expectedRev` or draft refuses the whole request and nothing changes. Each record gets its own history row.",
  access: GM_SESSION,
  body: json(HomebrewSharingRequestSchema),
  responses: {
    200: ok(HomebrewSharingSchema, "Each record's summary after the change."),
    400: refused(NOT_IN_PARTY),
    401: refused(),
    403: refused(),
    404: refused("One of the records was not found. The message names it."),
    409: refused(
      "One of the records is a draft, archived, or has moved on from its `expectedRev`. The message names it."
    )
  }
});

export const getHomebrewContentUsages = defineRoute({
  method: "get",
  path: HOMEBREW_PATHS.contentUsages,
  operationId: "getHomebrewContentUsages",
  tag: "Homebrew",
  summary: "Read where a homebrew record is used",
  description:
    "Which characters took this record, read from their choice ledgers, and which published records depend on it. A built character carries a whole definition of its own, so removing a homebrew record never breaks one. A published record can break: `dependents.ifRemoved` names those that publish now and would not once this one is removed or unpublished (`safeToDelete` is false when any do), and `dependents.ifUpdated` those its pending edits would break once live.",
  access: GM_SESSION,
  params: record,
  responses: {
    200: ok(HomebrewUsagesSchema, "Where the record is used."),
    401: refused(),
    403: refused(),
    404: refused()
  }
});

export const listHomebrewRevisions = defineRoute({
  method: "get",
  path: HOMEBREW_PATHS.contentRevisions,
  operationId: "listHomebrewRevisions",
  tag: "Homebrew",
  summary: "List a record's history",
  description:
    "Every version the record has had, newest first. Every write leaves one: an edit, a publish, a share, an archive and the rest, each with its `event`, the top-level fields it changed, and whether this GM device, another one or the server wrote it. A publish row is a version the players got.",
  access: GM_SESSION,
  params: record,
  responses: {
    200: ok(HomebrewRevisionListSchema, "The record's history, newest first."),
    401: refused(),
    403: refused(),
    404: refused()
  }
});

export const getHomebrewRevision = defineRoute({
  method: "get",
  path: HOMEBREW_PATHS.contentRevision,
  operationId: "getHomebrewRevision",
  tag: "Homebrew",
  summary: "Read one version of a record",
  description: "One history row with the whole body as it stood then, for comparing versions.",
  access: GM_SESSION,
  params: revision,
  responses: {
    200: ok(HomebrewRevisionReadSchema, "The version and its body."),
    400: refused(),
    401: refused(),
    403: refused(),
    404: refused("The record, or that version of it, was not found.")
  }
});

export const restoreHomebrewRevision = defineRoute({
  method: "post",
  path: HOMEBREW_PATHS.contentRevisionRestore,
  operationId: "restoreHomebrewRevision",
  tag: "Homebrew",
  summary: "Bring back an old version of a record",
  description:
    "Puts the old body back as an edit: a published record's pending body, or a draft's body. Nothing goes live until `/publish`. Who sees the record is not part of a version, so it stays as it is. Leaves a history row (`event: \"revert\"`).",
  access: GM_SESSION,
  params: revision,
  body: json(HomebrewStateChangeRequestSchema, { required: false }),
  responses: {
    200: ok(HomebrewContentSchema, "The record."),
    400: refused(),
    401: refused(),
    403: refused(),
    404: refused("The record, or that version of it, was not found."),
    409: STALE
  }
});

export const getHomebrewTable = defineRoute({
  method: "get",
  path: HOMEBREW_PATHS.table,
  operationId: "getHomebrewTable",
  tag: "Homebrew",
  summary: "Read one kind's table",
  description:
    "The SRD records of one kind and the homebrew records of that kind, in one row shape with the kind's own columns, sorted by name. An SRD row is published, shared with everyone and in no pack. Answers with a weak ETag, and a matching `If-None-Match` gets a 304.",
  access: GM_SESSION,
  query: HomebrewTableQuerySchema,
  responses: {
    200: ok(HomebrewTableSchema, "The kind's rows."),
    304: NOT_MODIFIED,
    400: refused("`kind` is missing or names no kind of record."),
    401: refused(),
    403: refused()
  }
});

export const getHomebrewOverview = defineRoute({
  method: "get",
  path: HOMEBREW_PATHS.overview,
  operationId: "getHomebrewOverview",
  tag: "Homebrew",
  summary: "Read the homebrew overview",
  description:
    "The counts by kind and by pack, and what needs the GM, newest first: published records with changes not live, the GM's own drafts, imported drafts not edited since the import, and published records whose live body no longer publishes.",
  access: GM_SESSION,
  responses: {
    200: ok(HomebrewOverviewSchema, "The overview."),
    401: refused(),
    403: refused()
  }
});

export const searchHomebrew = defineRoute({
  method: "get",
  path: HOMEBREW_PATHS.search,
  operationId: "searchHomebrew",
  tag: "Homebrew",
  summary: "Search the homebrew text",
  description:
    "Finds the words in each homebrew record's name and in every text of the body its editor shows, without regard to case. A name that holds them comes first. Each hit carries up to three matches, each the line of text that holds it. The SRD is not searched: its text is in the catalogs.",
  access: GM_SESSION,
  query: HomebrewSearchQuerySchema,
  responses: {
    200: ok(HomebrewSearchSchema, "The hits, and how many there are in all."),
    400: refused("`q` is missing or longer than 120 characters."),
    401: refused(),
    403: refused()
  }
});

export const getHomebrewSrdRecord = defineRoute({
  method: "get",
  path: HOMEBREW_PATHS.srdRecord,
  operationId: "getHomebrewSrdRecord",
  tag: "Homebrew",
  summary: "Read an SRD record as an authorable body",
  description:
    'The same body a copy starts from, with its SRD id and `source: "srd"`. For an SRD row\'s card, and for comparing a copy with what it was based on.',
  access: GM_SESSION,
  params: anyRecord,
  responses: {
    200: ok(HomebrewSrdRecordSchema, "The SRD record."),
    401: refused(),
    403: refused(),
    404: refused("No SRD record has that id.")
  }
});

export const listHomebrewPacks = defineRoute({
  method: "get",
  path: HOMEBREW_PATHS.packs,
  operationId: "listHomebrewPacks",
  tag: "Homebrew",
  summary: "List the sources",
  description:
    "The SRD's record count, then every pack with its counts and whether it is on: the table pack (`table`) for the GM's own records, and each imported pack.",
  access: GM_SESSION,
  responses: {
    200: ok(HomebrewPackListSchema, "The SRD and every pack."),
    401: refused(),
    403: refused()
  }
});

export const updateHomebrewPack = defineRoute({
  method: "patch",
  path: HOMEBREW_PATHS.packById,
  operationId: "updateHomebrewPack",
  tag: "Homebrew",
  summary: "Rename a pack, or switch it on or off",
  description:
    "A pack that is off keeps its published records out of every catalog, for the GM and every player. They stay published and keep who sees them, and switching the pack back on returns them as they were. What a character already has keeps working. The table pack can be switched off, and has no name or credit to change.",
  access: GM_SESSION,
  params: pack,
  body: json(HomebrewPackUpdateRequestSchema, { example: { enabled: false } }),
  responses: {
    200: ok(HomebrewPackResultSchema, "The pack."),
    400: refused(),
    401: refused(),
    403: refused(),
    404: refused("That pack does not exist."),
    409: refused("The table pack has no name or credit to change.")
  }
});

export const exportHomebrewPack = defineRoute({
  method: "get",
  path: HOMEBREW_PATHS.packsExport,
  operationId: "exportHomebrewPack",
  tag: "Homebrew",
  summary: "Export a homebrew pack",
  description:
    "Exports published records that are not archived as a pack to share under `name`, optionally narrowed by `type`, `packId` and `id`. A pack carries the authored bodies only, without `state`, `audience`, `deletedAt` or `rev`, so a table that imports it never takes on this table's choices about what players see.",
  access: GM_SESSION,
  query: HomebrewPackExportQuerySchema,
  responses: {
    200: ok(HomebrewPackExportSchema, "The pack."),
    400: refused(),
    401: refused(),
    403: refused()
  }
});

export const importHomebrewPack = defineRoute({
  method: "post",
  path: HOMEBREW_PATHS.packsImport,
  operationId: "importHomebrewPack",
  tag: "Homebrew",
  summary: "Import a homebrew pack",
  description:
    'Imports a pack into a new pack of its own, switched on. Every record lands as a Hidden draft (`state: "draft"`, `audience: "hidden"`), so an invalid pack does no harm. With `decisions`, each record is imported as new, replaces the GM\'s own draft it clashes with, is skipped, or lands renamed, and `records` reports each one\'s clash, problems and allowed decisions. Without them, an id that collides with an SRD id is re-minted and one that collides with existing homebrew follows `onIdCollision`. A published record is never replaced. A record that cannot be imported is listed in `rejected` with its issues, and the rest still land. `dryRun` runs the whole pass and answers the same report without writing. The body may be up to 4 MB and carry up to 500 records.',
  access: GM_SESSION,
  body: json(HomebrewPackImportRequestSchema),
  responses: {
    200: ok(HomebrewPackImportSchema, "What was imported, re-minted, overwritten and rejected, record by record."),
    400: refused("The request is malformed, or a decision is one its record does not allow."),
    401: refused(),
    403: refused(),
    413: refused("The pack is over 4 MB, or carries more than 500 records.")
  }
});

export const seeHomebrewCompendiumAs = defineRoute({
  method: "get",
  path: HOMEBREW_PATHS.seeAsCompendium,
  operationId: "seeHomebrewCompendiumAs",
  tag: "Homebrew",
  summary: "Read one kind of the Compendium as a player gets it",
  description:
    "Exactly what `GET /content/compendium` answers the player of `as`, read from that reader's own catalog, whether or not any player holds the character. Answers with a weak ETag, and a matching `If-None-Match` gets a 304.",
  access: GM_SESSION,
  query: seeAsCompendium,
  responses: {
    200: ok(ContentCompendiumSchema, "One kind of the Compendium, as that player gets it."),
    304: NOT_MODIFIED,
    400: refused("`as` names no party character, or `kind` is missing or names no kind the Compendium lists."),
    401: refused(),
    403: refused()
  }
});

export const seeHomebrewContentAs = defineRoute({
  method: "get",
  path: HOMEBREW_PATHS.seeAsContent,
  operationId: "seeHomebrewContentAs",
  tag: "Homebrew",
  summary: "Read whether a player receives a record",
  description:
    "Whether the player of `as` receives one homebrew or SRD record, and the Compendium row that player gets for it. A record the player does not receive (Hidden, a draft, archived, its pack off, shared with other characters, or a monster) answers `received: false` and `entry: null`. A spell list has no Compendium row: `received` says whether its spells reach that player.",
  access: GM_SESSION,
  params: anyRecord,
  query: seeAs,
  responses: {
    200: ok(HomebrewSeeAsRecordSchema, "Whether that player receives the record."),
    400: refused("`as` is missing or names no party character."),
    401: refused(),
    403: refused(),
    404: refused("No homebrew or SRD record has that id.")
  }
});

export const seeHomebrewBuilderOffersAs = defineRoute({
  method: "post",
  path: HOMEBREW_PATHS.seeAsBuilderOffers,
  operationId: "seeHomebrewBuilderOffersAs",
  tag: "Homebrew",
  summary: "Read a character build's offers as a player gets them",
  description:
    "The offers `GET /game/builder-offers` makes for `draft`, read from the catalog of the player of `as`, so the GM can check what a shared record adds to that player's builder.",
  access: GM_SESSION,
  body: json(HomebrewSeeAsBuilderOffersSchema),
  responses: {
    200: ok(BuilderOffersReplySchema, "The draft's offers, as that player gets them."),
    400: refused("The draft is malformed, or `as` names no party character."),
    401: refused(),
    403: refused(),
    409: refused("The draft names content that player does not receive, or class levels that do not add up.")
  }
});

export const HOMEBREW_ROUTES = [
  listHomebrewContent,
  createHomebrewContent,
  getHomebrewContent,
  updateHomebrewContent,
  deleteHomebrewContent,
  restoreHomebrewContent,
  duplicateHomebrewContent,
  publishHomebrewContent,
  discardHomebrewChanges,
  unpublishHomebrewContent,
  setHomebrewContentAudience,
  setHomebrewSharing,
  getHomebrewContentUsages,
  listHomebrewRevisions,
  getHomebrewRevision,
  restoreHomebrewRevision,
  getHomebrewTable,
  getHomebrewOverview,
  searchHomebrew,
  getHomebrewSrdRecord,
  listHomebrewPacks,
  updateHomebrewPack,
  exportHomebrewPack,
  importHomebrewPack,
  seeHomebrewCompendiumAs,
  seeHomebrewContentAs,
  seeHomebrewBuilderOffersAs
] as const;
