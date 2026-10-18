import { z } from "zod";
import {
  HOMEBREW_PATHS,
  HomebrewContentListSchema,
  HomebrewContentSchema,
  HomebrewCreateRequestSchema,
  HomebrewDeletedSchema,
  HomebrewDuplicateRequestSchema,
  HomebrewIdSchema,
  HomebrewListQuerySchema,
  HomebrewPackExportQuerySchema,
  HomebrewPackExportSchema,
  HomebrewPackImportRequestSchema,
  HomebrewPackImportSchema,
  HomebrewStateChangeRequestSchema,
  HomebrewUpdateRequestSchema,
  HomebrewUsagesSchema,
  HomebrewVisibilityRequestSchema
} from "../index.js";
import { defineRoute, GM_SESSION, json, ok, refused } from "./define.js";

/**
 * The GM's homebrew authoring (`homebrew-http.ts`). Every route takes a GM session alone: players see homebrew only
 * through the reference catalogs, and only records that are published, shown to them and not deleted.
 */

const record = z.object({
  id: HomebrewIdSchema.describe(
    "The record's id: a minted homebrew id (`hb-<slug>-<6 hex>`), or for a copy an SRD id such as `wizard`."
  )
});
const STALE = refused("`expectedRev` is stale. `error.currentRevision` carries the record's current revision.");

export const listHomebrewContent = defineRoute({
  method: "get",
  path: HOMEBREW_PATHS.content,
  operationId: "listHomebrewContent",
  tag: "Homebrew",
  summary: "List the homebrew library",
  description:
    "The GM's homebrew as flat summaries. The authored bodies stay out of the list, so a library of a few hundred records is a small answer. Filters combine, and soft-deleted records are left out unless `includeDeleted` is set. Pages are keyset pages, so a record published mid-scroll is neither skipped nor repeated: pass `nextCursor` back as `cursor`, and `nextCursor: null` marks the last page. `total` counts every record that matches, whatever the page.",
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
    'A new record is a draft and hidden from players (`state: "draft"`, `visibleToPlayers: false`). A draft may be invalid, and nothing reaches a player until it is published and shown.',
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
    "One record with its row state and its full validity report (`validity.issues`), so an editor can show what still blocks publishing in one read.",
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
    "Replaces the authored `record` and leaves `state`, `visibleToPlayers` and `deletedAt` alone. The body is always the whole record: a partial merge into a body that can be nine shapes cannot be specified. On a published record the edit is held as pending (`pendingChanges: true`), and the live body stays in the catalogs, so an edit mid-session takes nothing from the players. `/publish` puts the pending body live, and `/discard` drops it.",
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
  summary: "Delete a homebrew record",
  description:
    "Soft-deletes the record by setting `deletedAt`. Deleting an unknown or deleted id is still a 200. The record leaves the catalogs at once, and `/restore` brings it back.",
  access: GM_SESSION,
  params: record,
  responses: {
    200: ok(HomebrewDeletedSchema, "The record is deleted."),
    401: refused(),
    403: refused()
  }
});

export const restoreHomebrewContent = defineRoute({
  method: "post",
  path: HOMEBREW_PATHS.contentRestore,
  operationId: "restoreHomebrewContent",
  tag: "Homebrew",
  summary: "Restore a deleted homebrew record",
  description: "Clears `deletedAt`. A PATCH leaves `deletedAt` alone, so this route is how a delete is undone.",
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
    "Copies a record whole under a newly minted homebrew id. `{id}` may be an SRD id (`wizard`): the server reads the full bundled record and mints a homebrew copy, which makes a class's 20-row table practical to author. The copy is a draft, hidden from players.",
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
    'Moves a record to `state: "published"`, which needs it to be valid. On a published record with `pendingChanges`, it checks the pending body and puts it live; refused, the live body stays. Publishing shows nothing to players: that is `/visibility`, a separate route. A malformed request is a 400, and a well-formed one the stored record refuses is a 409.',
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
      "The record is not valid: `error.details.invalid.issues` lists every blocking issue with its `path`. A stale `expectedRev` is a 409 too, with `error.currentRevision`."
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
    'Returns a record to `state: "draft"`. It leaves the catalogs at once, and may be invalid again while the GM reworks it. Pending edits become the draft\'s body, since a draft is edited in place.',
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

export const setHomebrewContentVisibility = defineRoute({
  method: "post",
  path: HOMEBREW_PATHS.contentVisibility,
  operationId: "setHomebrewContentVisibility",
  tag: "Homebrew",
  summary: "Show a published record to players, or hide it",
  description:
    "Sets whether players may see a published record. A draft cannot be shown, so asking to show one is a 409 that changes nothing, which keeps `visibleToPlayers` true to what players get.",
  access: GM_SESSION,
  params: record,
  body: json(HomebrewVisibilityRequestSchema, { example: { visibleToPlayers: true } }),
  responses: {
    200: ok(HomebrewContentSchema, "The record."),
    400: refused(),
    401: refused(),
    403: refused(),
    404: refused(),
    409: refused("The record is still a draft: publish it first. A stale `expectedRev` is a 409 too.")
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

export const exportHomebrewPack = defineRoute({
  method: "get",
  path: HOMEBREW_PATHS.packsExport,
  operationId: "exportHomebrewPack",
  tag: "Homebrew",
  summary: "Export a homebrew pack",
  description:
    "Exports published records that are not deleted as a pack to share, optionally narrowed by `type` and `id`. A pack carries the authored bodies only, without `state`, `visibleToPlayers`, `deletedAt` or `rev`, so a table that imports it never takes on this table's choices about what players see.",
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
    'Imports a pack. Every record lands as a draft hidden from players (`state: "draft"`, `visibleToPlayers: false`), so an invalid pack does no harm. An id that collides with an SRD id is always re-minted, and one that collides with existing homebrew follows `onIdCollision`. A record that cannot be imported is listed in `rejected` with its issues, and the rest still land. `dryRun` runs the whole pass and answers the same report without writing. The body may be up to 4 MB and carry up to 500 records.',
  access: GM_SESSION,
  body: json(HomebrewPackImportRequestSchema),
  responses: {
    200: ok(HomebrewPackImportSchema, "What was imported, re-minted, overwritten and rejected."),
    400: refused(),
    401: refused(),
    403: refused(),
    413: refused("The pack is over 4 MB, or carries more than 500 records.")
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
  setHomebrewContentVisibility,
  getHomebrewContentUsages,
  exportHomebrewPack,
  importHomebrewPack
] as const;
