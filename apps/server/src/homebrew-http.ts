import express, { Router, type NextFunction, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  HOMEBREW_PATHS,
  HomebrewAudienceRequestSchema,
  HomebrewAudienceSchema,
  HomebrewContentStateSchema,
  HomebrewContentTypeSchema,
  HomebrewCreateRequestSchema,
  HomebrewDuplicateRequestSchema,
  HomebrewPackImportRequestSchema,
  HomebrewPackUpdateRequestSchema,
  HomebrewSharingRequestSchema,
  HomebrewStateChangeRequestSchema,
  HomebrewUpdateRequestSchema,
  HomebrewVisibilityRequestSchema,
  type HomebrewContentType,
  type HomebrewImportRecord,
  type HomebrewOverview,
  type HomebrewPackInfo,
  type HomebrewTableRow,
  type HomebrewValidationIssue,
  type HomebrewValidity
} from "@vtt/api-contract";
import { ContentCompendiumKindSchema, HomebrewSeeAsSchema } from "@vtt/domain";
import { HomebrewSeeAsBuilderOffersSchema } from "@vtt/domain/commands";
import {
  apiErrorHandler,
  expressPath,
  issuesOf,
  pathParam,
  sendData,
  sendFailure,
  sendInternalError
} from "./http-kit.js";
import {
  bodyAt,
  copyName,
  HIDDEN_AUDIENCE,
  HomebrewNotFoundError,
  HomebrewRevisionConflictError,
  HomebrewStateError,
  overwriteRefusal,
  recordName,
  TABLE_PACK_ID,
  type HomebrewAudience,
  type HomebrewBody,
  type HomebrewRecordRow,
  type HomebrewStore,
  type HomebrewSummaryRow
} from "./homebrew-store.js";
import {
  isMintedHomebrewId,
  mintHomebrewId,
  slugify,
  HOMEBREW_ID_MAX_LENGTH,
  HOMEBREW_ID_PREFIX
} from "./homebrew-ids.js";
import { findCatalogRecord, rewriteForNewId, type HomebrewSourceRecord } from "./homebrew-srd-copy.js";
import type { HomebrewValidationScenario } from "./homebrew-validate.js";
import { ContentLibrary, type ContentReader } from "./content-library.js";
import { compendiumEntryOf, compendiumOf, kindInView } from "./homebrew-player.js";
import {
  columnsOf,
  HOMEBREW_KINDS,
  matchesIn,
  nameIndexOf,
  referencesOf,
  srdRecordCount,
  srdRecordsOf,
  srdTableRows
} from "./homebrew-library.js";
import { builderOffers } from "./builder-offers.js";
import { CommandRejectedError } from "./game-store.js";
import { callerOf, refuse, type CredentialVerifiers } from "./request-auth.js";

/**
 * Homebrew authoring REST (`/api/v1/homebrew/*`). Every route is GM-only: players see homebrew only through the
 * merged `CONTENT_PATHS` catalogs, built for each reader. See as reads what one player would receive, from that
 * player's catalog, and answers only the GM. Writes emit a content-free `homebrew:changed`.
 */

/** Query booleans arrive as strings; accept the two spellings a browser or curl actually sends. */
const QueryBoolean = z.enum(["true", "false", "1", "0"]).transform((value) => value === "true" || value === "1");
/** Lenient (unknown keys stripped): a stray query parameter should not 400 a read. */
const ListQuerySchema = z.object({
  type: HomebrewContentTypeSchema.optional(),
  state: HomebrewContentStateSchema.optional(),
  audience: HomebrewAudienceSchema.optional(),
  packId: z.string().max(60).optional(),
  visibleToPlayers: QueryBoolean.optional(),
  q: z.string().max(120).optional(),
  includeDeleted: QueryBoolean.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().max(200).optional()
});
const ExportQuerySchema = z.object({
  type: HomebrewContentTypeSchema.optional(),
  id: z.union([z.string().max(60), z.array(z.string().max(60)).max(500)]).optional(),
  packId: z.string().max(60).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  credit: z.string().trim().max(400).optional()
});
const TableQuerySchema = z.object({ kind: HomebrewContentTypeSchema, includeArchived: QueryBoolean.optional() });
const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(120),
  kind: HomebrewContentTypeSchema.optional(),
  includeArchived: QueryBoolean.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});
const SeeAsQuerySchema = z.object({ as: HomebrewSeeAsSchema });
const SeeAsCompendiumQuerySchema = SeeAsQuerySchema.extend({ kind: ContentCompendiumKindSchema });
const PackIdSchema = z.union([z.literal(TABLE_PACK_ID), z.uuid()]);
const RevisionIdSchema = z.coerce.number().int().positive();

/** Route-scoped body limit for pack import, above the server's 512kb global default. */
export const HOMEBREW_PACK_BODY_LIMIT = "4mb";
/** Checked before parsing so a hostile pack cannot make the server do the work first. */
const MAX_PACK_RECORDS = 500;
const SEARCH_LIMIT = 50;

/** Publish validation. The always-valid fallback is only for store-only test fixtures. */
/** `scenario` asks about the table as it would be; see `createHomebrewValidator`. */
export type HomebrewValidator = (
  type: HomebrewContentType,
  body: HomebrewBody,
  scenario?: HomebrewValidationScenario
) => HomebrewValidity;
const UNVALIDATED: HomebrewValidator = () => ({ valid: true, issues: [], warnings: [] });

/** Reference scan over GameState (`homebrew-usages.ts`). */
export type HomebrewUsageLookup = (
  type: HomebrewContentType,
  id: string
) => readonly { actorId: string; actorName: string; kind: string; detail: string | null }[];
const NO_USAGES: HomebrewUsageLookup = () => [];

/** The merged GM catalog behind `/duplicate`: the record an id names, deep-copied, or undefined. */
export type HomebrewCatalogLookup = (id: string) => HomebrewSourceRecord | undefined;
const NO_CATALOG: HomebrewCatalogLookup = () => undefined;

export type HomebrewRouterOptions = Readonly<{
  store: HomebrewStore;
  /** The server's credential checks; only a GM session reaches homebrew. */
  verifiers: CredentialVerifiers;
  /** Emit the content-free `homebrew:changed` ping so every client refetches its own merged catalog. */
  notifyChanged: () => void;
  validate?: HomebrewValidator;
  usagesOf?: HomebrewUsageLookup;
  /** Resolves a catalog id for `/duplicate` so an SRD record can be forked into an editable draft. */
  catalogRecord?: HomebrewCatalogLookup;
  /** The catalogs for See as; the server shares its own, so the reads are the players' own. */
  contentLibrary?: ContentLibrary;
  /** The party's player characters: the only ids an audience or See as may name. */
  partyCharacters?: () => ReadonlySet<string>;
}>;

const FAULT = "The homebrew request failed.";

/** Slug a malformed pack id for the report, since the contract requires a valid id there. */
function reportableId(raw: string): string {
  if (raw !== "" && raw.length <= HOMEBREW_ID_MAX_LENGTH && /^[a-z0-9-]+$/.test(raw)) return raw;
  return slugify(raw, HOMEBREW_ID_MAX_LENGTH) || "unidentified";
}

/** A refusal a request earns before the store sees it: a 400 with the message the GM reads. */
class HomebrewRequestError extends Error {}

/** Zod issues become the same `{ path, message }` tuples publish validation emits, so failures look alike. */
function malformed(response: Response, error: unknown) {
  if (error instanceof HomebrewRequestError)
    return sendFailure(response, 400, "validation_failed", error.message, {
      issues: [{ path: [], message: error.message, recordId: null }]
    });
  if (!(error instanceof z.ZodError)) return sendInternalError(response, error, FAULT);
  const issues: HomebrewValidationIssue[] = issuesOf(error).map((issue) => ({ ...issue, recordId: null }));
  return sendFailure(response, 400, "validation_failed", issues[0]?.message ?? "The request is malformed.", {
    issues
  });
}
/** One mapping for every store failure, so REST semantics stay uniform across every operation. A stale revision
 *  carries what the server's copy changed since, so the editor can show both sides. */
function storeError(response: Response, error: unknown) {
  if (error instanceof HomebrewRevisionConflictError)
    return sendFailure(
      response,
      409,
      "conflict",
      error.message,
      error.conflict ? { conflict: error.conflict } : undefined,
      error.currentRev
    );
  if (error instanceof HomebrewNotFoundError) return sendFailure(response, 404, "not_found", error.message);
  if (error instanceof HomebrewStateError) return sendFailure(response, 409, "conflict", error.message);
  return malformed(response, error);
}

/** A weak ETag of a body, so a repeat read of the same answer costs a 304. */
function sendWithEtag(request: Request, response: Response, data: unknown) {
  const etag = `W/"hb-${createHash("sha256").update(JSON.stringify(data)).digest("base64url").slice(0, 27)}"`;
  response.setHeader("etag", etag);
  if (request.header("if-none-match") === etag) return response.status(304).end();
  return sendData(response, 200, data);
}

export function createHomebrewRouter(options: HomebrewRouterOptions) {
  const router = Router();
  const { store } = options;
  const validate = options.validate ?? UNVALIDATED;
  const usagesOf = options.usagesOf ?? NO_USAGES;
  const catalogRecord = options.catalogRecord ?? NO_CATALOG;
  const library = options.contentLibrary ?? new ContentLibrary(store);
  const srdOnly = new ContentLibrary().forAudience("gm");
  const partyCharacters = options.partyCharacters ?? (() => new Set<string>());

  /** 401 without a live credential, 403 for any other valid one (both declared in the contract). The GM's session
   *  is remembered, so history can say which device wrote what. */
  const requireGm = (request: Request, response: Response, next: NextFunction) => {
    const caller = callerOf(request, response, options.verifiers);
    if (caller.kind === "gm") {
      response.locals.homebrewAuthor = `gm:${caller.sessionId}`;
      return next();
    }
    return refuse(response, caller, "Homebrew authoring is the GM's.");
  };
  const authorOf = (response: Response): string =>
    typeof response.locals.homebrewAuthor === "string" ? response.locals.homebrewAuthor : "server";

  /** Each pack's row and counts, read once per request. */
  const packInfos = (): HomebrewPackInfo[] => {
    const counts = store.packCounts();
    return store.listPacks().map((pack) => ({
      ...pack,
      counts: counts.get(pack.id) ?? { records: 0, published: 0, drafts: 0, shared: 0, archived: 0 }
    }));
  };
  const packLookup = () => new Map(store.listPacks().map((pack) => [pack.id, pack]));
  type Packs = ReturnType<typeof packLookup>;
  const inCatalogs = (row: HomebrewSummaryRow, packs: Packs) =>
    row.state === "published" && row.deletedAt === null && (packs.get(row.packId)?.enabled ?? true);

  /** The report Publish would give for the body the editor shows: a published record's pending edits, else its body. */
  const editorValidity = (row: HomebrewRecordRow) =>
    row.pendingBody ? validate(row.type, row.pendingBody, { without: row.id }) : validate(row.type, row.body);

  /** `type` lives on the row and is put back into the body here, so pack records are self-describing. */
  const documentOf = (row: HomebrewRecordRow, packs: Packs = packLookup()) => {
    const body = row.pendingBody ?? row.body;
    return {
      id: row.id,
      type: row.type,
      state: row.state,
      audience: row.audience,
      characterIds: [...row.characterIds],
      reveals: [...row.reveals],
      visibleToPlayers: row.visibleToPlayers,
      packId: row.packId,
      packName: packs.get(row.packId)?.name ?? null,
      inCatalogs: inCatalogs(row, packs),
      basedOn: row.basedOn,
      references: referencesOf(body, row.id, nameIndexOf(store.listNames())),
      deletedAt: row.deletedAt,
      rev: row.rev,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      // A published record's editor works on its pending edits, so the report describes what Publish would put live.
      validity: editorValidity(row),
      pendingChanges: row.pendingBody !== null,
      record: { ...body, type: row.type }
    };
  };
  const summaryOf = (row: HomebrewRecordRow, packs: Packs) => {
    const live = validate(row.type, row.body);
    const editor = row.pendingBody ? validate(row.type, row.pendingBody, { without: row.id }) : live;
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      source: "homebrew" as const,
      state: row.state,
      audience: row.audience,
      characterIds: [...row.characterIds],
      visibleToPlayers: row.visibleToPlayers,
      packId: row.packId,
      packName: packs.get(row.packId)?.name ?? null,
      inCatalogs: inCatalogs(row, packs),
      deletedAt: row.deletedAt,
      rev: row.rev,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      valid: live.valid,
      pendingChanges: row.pendingBody !== null,
      issueCount: editor.issues.length,
      basedOn: row.basedOn,
      usageCount: usagesOf(row.type, row.id).length,
      columns: columnsOf(row.type, row.pendingBody ?? row.body)
    };
  };
  const tableRowOf = (row: HomebrewRecordRow, packs: Packs): HomebrewTableRow => {
    const summary = summaryOf(row, packs);
    return {
      id: row.id,
      kind: row.type,
      name: row.name,
      source: "homebrew",
      packId: row.packId,
      state: row.state,
      archived: row.deletedAt !== null,
      inCatalogs: summary.inCatalogs,
      pendingChanges: summary.pendingChanges,
      issueCount: summary.issueCount,
      audience: row.audience,
      characterIds: [...row.characterIds],
      basedOn: row.basedOn,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      usageCount: summary.usageCount,
      columns: summary.columns
    };
  };
  const sent = (response: Response, row: HomebrewRecordRow, status = 200) => {
    options.notifyChanged();
    return sendData(response, status, { record: documentOf(row) });
  };

  /** The `type` discriminator is read off the submitted record: the same place the pack format keeps it. */
  function typeOf(record: Record<string, unknown>): HomebrewContentType {
    const parsed = HomebrewContentTypeSchema.safeParse(record.type);
    if (!parsed.success) throw new HomebrewStateError("This record's kind is not one this table can make.");
    return parsed.data;
  }

  /** An audience as a request gives it: characters only with `characters`, and each one in the party. */
  function audienceFrom(input: Readonly<{ audience: HomebrewAudience["audience"]; characterIds?: string[] }>) {
    const characterIds = input.characterIds ?? [];
    if (input.audience === "characters" && characterIds.length === 0)
      throw new HomebrewRequestError("Pick at least one character to share this with.");
    if (input.audience !== "characters" && characterIds.length > 0)
      throw new HomebrewRequestError("Characters can be picked only when the record is shared with characters.");
    const party = partyCharacters();
    if (characterIds.some((characterId) => !party.has(characterId)))
      throw new HomebrewRequestError("That character is not in the party.");
    return input.audience === "hidden" ? HIDDEN_AUDIENCE : { audience: input.audience, characterIds };
  }

  /** See as: everyone, or one party character, as a reader. */
  function readerFor(as: string): ContentReader {
    if (as === "everyone") return { characterIds: [] };
    if (!partyCharacters().has(as)) throw new HomebrewRequestError("That character is not in the party.");
    return { characterIds: [as] };
  }

  // The polymorphic collection

  router.get(expressPath(HOMEBREW_PATHS.content), requireGm, (request, response) => {
    try {
      const filter = ListQuerySchema.parse(request.query);
      const page = store.list(filter);
      const packs = packLookup();
      return sendData(response, 200, {
        records: page.rows.map((row) => summaryOf(store.get(row.id)!, packs)),
        nextCursor: page.nextCursor,
        total: page.total
      });
    } catch (error) {
      return malformed(response, error);
    }
  });

  router.post(expressPath(HOMEBREW_PATHS.content), requireGm, (request, response) => {
    try {
      const { record } = HomebrewCreateRequestSchema.parse(request.body);
      return sent(response, store.create({ type: typeOf(record), body: record }, authorOf(response)), 201);
    } catch (error) {
      return storeError(response, error);
    }
  });

  router.get(expressPath(HOMEBREW_PATHS.contentById), requireGm, (request, response) => {
    const row = store.get(pathParam(request, "id"));
    if (!row) return sendFailure(response, 404, "not_found", "That record was not found.");
    return sendData(response, 200, { record: documentOf(row) });
  });

  // Always lands (autosave); a published record's edit is held as pending until Publish puts it live.
  router.patch(expressPath(HOMEBREW_PATHS.contentById), requireGm, (request, response) => {
    try {
      const { record, expectedRev } = HomebrewUpdateRequestSchema.parse(request.body);
      return sent(response, store.update(pathParam(request, "id"), record, expectedRev, authorOf(response)));
    } catch (error) {
      return storeError(response, error);
    }
  });

  // Idempotent: an unknown or already-deleted id is still a 200. Soft delete keeps the row's data.
  router.delete(expressPath(HOMEBREW_PATHS.contentById), requireGm, (request, response) => {
    const id = pathParam(request, "id");
    const deleted = store.softDelete(id, authorOf(response));
    if (deleted) options.notifyChanged();
    return sendData(
      response,
      200,
      deleted
        ? { id: deleted.id, deleted: true, deletedAt: deleted.deletedAt }
        : { id, deleted: true, deletedAt: new Date().toISOString() }
    );
  });

  router.post(expressPath(HOMEBREW_PATHS.contentRestore), requireGm, (request, response) => {
    try {
      return sent(response, store.restore(pathParam(request, "id"), authorOf(response)));
    } catch (error) {
      return storeError(response, error);
    }
  });

  // Homebrew row first, else an SRD record; the reserved `hb-` prefix means they cannot collide. The copy keeps
  // what it was based on, for Compare.
  router.post(expressPath(HOMEBREW_PATHS.contentDuplicate), requireGm, (request, response) => {
    try {
      const { name } = HomebrewDuplicateRequestSchema.parse(request.body ?? {});
      const id = pathParam(request, "id");
      if (store.get(id)) return sent(response, store.duplicate(id, name, authorOf(response)), 201);

      const source = catalogRecord(id);
      if (!source) return sendFailure(response, 404, "not_found", "That record was not found.");
      const sourceName = String((source.body as { name?: unknown }).name ?? id);
      const copied = name ?? copyName(sourceName);
      // Minted before the rewrite because self-derived catalog slugs (`<id>-lineages`, `<id>-subclasses`)
      // must point at the copy's id. See `homebrew-srd-copy.ts`.
      const mintedId = mintHomebrewId(source.type, copied, (candidate) => store.get(candidate) !== undefined);
      const body = rewriteForNewId(source.type, { ...source.body, name: copied }, id, mintedId);
      return sent(
        response,
        store.importRecord(mintedId, source.type, body, false, authorOf(response), {
          packId: TABLE_PACK_ID,
          basedOn: { source: "srd", id, name: sourceName, copiedAt: new Date().toISOString() },
          event: "duplicate"
        }),
        201
      );
    } catch (error) {
      return storeError(response, error);
    }
  });

  /** Publishing requires validity. An invalid draft is a 409: the request itself is well formed. */
  router.post(expressPath(HOMEBREW_PATHS.contentPublish), requireGm, (request, response) => {
    try {
      const { expectedRev } = HomebrewStateChangeRequestSchema.parse(request.body ?? {});
      const id = pathParam(request, "id");
      const existing = store.get(id);
      if (!existing) return sendFailure(response, 404, "not_found", "That record was not found.");
      const validity = editorValidity(existing);
      if (!validity.valid)
        return sendFailure(
          response,
          409,
          "conflict",
          existing.pendingBody
            ? "These changes can't go live until the problems are fixed. The published version is unchanged."
            : "This draft can't be published until the problems are fixed.",
          { invalid: { issues: validity.issues } }
        );
      return sent(response, store.publish(id, expectedRev, authorOf(response)));
    } catch (error) {
      return storeError(response, error);
    }
  });

  router.post(expressPath(HOMEBREW_PATHS.contentUnpublish), requireGm, (request, response) => {
    try {
      const { expectedRev } = HomebrewStateChangeRequestSchema.parse(request.body ?? {});
      return sent(response, store.unpublish(pathParam(request, "id"), expectedRev, authorOf(response)));
    } catch (error) {
      return storeError(response, error);
    }
  });

  router.post(expressPath(HOMEBREW_PATHS.contentDiscard), requireGm, (request, response) => {
    try {
      const { expectedRev } = HomebrewStateChangeRequestSchema.parse(request.body ?? {});
      return sent(response, store.discardPending(pathParam(request, "id"), expectedRev, authorOf(response)));
    } catch (error) {
      return storeError(response, error);
    }
  });

  // The older on-or-off switch: on is Everyone, off is Hidden.
  router.post(expressPath(HOMEBREW_PATHS.contentVisibility), requireGm, (request, response) => {
    try {
      const { visibleToPlayers, expectedRev } = HomebrewVisibilityRequestSchema.parse(request.body);
      return sent(
        response,
        store.setVisibility(pathParam(request, "id"), visibleToPlayers, expectedRev, authorOf(response))
      );
    } catch (error) {
      return storeError(response, error);
    }
  });

  router.put(expressPath(HOMEBREW_PATHS.contentAudience), requireGm, (request, response) => {
    try {
      const input = HomebrewAudienceRequestSchema.parse(request.body);
      return sent(
        response,
        store.setAudience(pathParam(request, "id"), audienceFrom(input), input.expectedRev, authorOf(response))
      );
    } catch (error) {
      return storeError(response, error);
    }
  });

  // Who sees several records in one write: all or nothing, one history row each.
  router.post(expressPath(HOMEBREW_PATHS.sharing), requireGm, (request, response) => {
    try {
      const input = HomebrewSharingRequestSchema.parse(request.body);
      const rows = store.setAudienceMany(input.records, audienceFrom(input), authorOf(response));
      options.notifyChanged();
      const packs = packLookup();
      return sendData(response, 200, { records: rows.map((row) => summaryOf(row, packs)) });
    } catch (error) {
      return storeError(response, error);
    }
  });

  /** Published records that publish now and would not in `scenario`: what removing or updating a record breaks. */
  const dependentsIn = (scenario: HomebrewValidationScenario) =>
    store
      .listPublished()
      .filter(
        (other) =>
          other.id !== scenario.without &&
          validate(other.type, other.body).valid &&
          !validate(other.type, other.body, scenario).valid
      )
      .map((other) => ({ id: other.id, type: other.type, name: other.name }));

  // Built characters are self-contained, so `usages` never makes a removal unsafe; a published dependent does.
  router.get(expressPath(HOMEBREW_PATHS.contentUsages), requireGm, (request, response) => {
    const id = pathParam(request, "id");
    const row = store.get(id);
    if (!row) return sendFailure(response, 404, "not_found", "That record was not found.");
    // A draft can break a published record too: a class publishes on the strength of a draft subclass.
    const ifRemoved = dependentsIn({ without: id, archived: true });
    const ifUpdated =
      row.pendingBody !== null
        ? dependentsIn({ without: id, replacement: { type: row.type, body: row.pendingBody } })
        : [];
    return sendData(response, 200, {
      id,
      usages: usagesOf(row.type, id),
      safeToDelete: ifRemoved.length === 0,
      dependents: { ifRemoved, ifUpdated }
    });
  });

  // History

  /** Who wrote a history row, as the caller reads it. */
  const deviceOf = (authorTag: string, response: Response) => {
    if (!authorTag.startsWith("gm")) return { device: "server" as const, deviceKey: null };
    const key = createHash("sha256").update(authorTag).digest("hex").slice(0, 12);
    return {
      device: authorTag === authorOf(response) ? ("this-device" as const) : ("other-device" as const),
      deviceKey: key
    };
  };
  const revisionSummaryOf = (revision: ReturnType<HomebrewStore["listRevisions"]>[number], response: Response) => ({
    id: revision.id,
    rev: revision.rev,
    at: revision.authoredAt,
    event: revision.event,
    ...deviceOf(revision.authorTag, response),
    name: revision.name,
    state: revision.state,
    pending: revision.pending,
    audience: revision.audience,
    characterIds: [...revision.characterIds],
    changedFields: [...revision.changedFields]
  });

  router.get(expressPath(HOMEBREW_PATHS.contentRevisions), requireGm, (request, response) => {
    const id = pathParam(request, "id");
    if (!store.get(id)) return sendFailure(response, 404, "not_found", "That record was not found.");
    return sendData(response, 200, {
      revisions: store.listRevisions(id).map((revision) => revisionSummaryOf(revision, response))
    });
  });

  router.get(expressPath(HOMEBREW_PATHS.contentRevision), requireGm, (request, response) => {
    try {
      const id = pathParam(request, "id");
      const row = store.get(id);
      const revision = row && store.getRevision(id, RevisionIdSchema.parse(pathParam(request, "revisionId")));
      if (!row || !revision) return sendFailure(response, 404, "not_found", "That version was not found.");
      return sendData(response, 200, {
        revision: { ...revisionSummaryOf(revision, response), record: { ...revision.body, type: row.type } }
      });
    } catch (error) {
      return malformed(response, error);
    }
  });

  // An old version back as the editor's copy; nothing goes live until Update.
  router.post(expressPath(HOMEBREW_PATHS.contentRevisionRestore), requireGm, (request, response) => {
    try {
      const { expectedRev } = HomebrewStateChangeRequestSchema.parse(request.body ?? {});
      const revisionId = RevisionIdSchema.parse(pathParam(request, "revisionId"));
      return sent(
        response,
        store.restoreRevision(pathParam(request, "id"), revisionId, expectedRev, authorOf(response))
      );
    } catch (error) {
      return storeError(response, error);
    }
  });

  // The GM's tables, overview and search

  router.get(expressPath(HOMEBREW_PATHS.table), requireGm, (request, response) => {
    try {
      const { kind, includeArchived } = TableQuerySchema.parse(request.query);
      const packs = packLookup();
      const rows = [
        ...srdTableRows(kind),
        ...store.listRecords({ type: kind, includeDeleted: includeArchived }).map((row) => tableRowOf(row, packs))
      ].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
      return sendWithEtag(request, response, { kind, rows });
    } catch (error) {
      return malformed(response, error);
    }
  });

  router.get(expressPath(HOMEBREW_PATHS.overview), requireGm, (_request, response) => {
    const rows = store.listRecords();
    const events = store.latestEvents();
    const byKind = HOMEBREW_KINDS.map((kind) => {
      const ofKind = rows.filter((row) => row.type === kind);
      return {
        kind,
        srd: srdRecordsOf(kind).length,
        homebrew: ofKind.length,
        drafts: ofKind.filter((row) => row.state === "draft").length,
        shared: ofKind.filter((row) => row.state === "published" && row.audience !== "hidden").length
      };
    });
    const needsYou = rows.flatMap((row): HomebrewOverview["needsYou"] => {
      const base = { id: row.id, kind: row.type, name: row.name, packId: row.packId, since: row.updatedAt };
      if (row.state === "published") {
        if (row.pendingBody !== null)
          return [
            {
              ...base,
              reason: "changes-not-live",
              issueCount: validate(row.type, row.pendingBody, { without: row.id }).issues.length
            }
          ];
        const live = validate(row.type, row.body);
        return live.valid ? [] : [{ ...base, reason: "broken", issueCount: live.issues.length }];
      }
      const issueCount = validate(row.type, row.body).issues.length;
      const imported = row.packId !== TABLE_PACK_ID && events.get(row.id) === "import";
      return [{ ...base, reason: imported ? "imported" : "draft", issueCount }];
    });
    needsYou.sort((left, right) => right.since.localeCompare(left.since) || left.id.localeCompare(right.id));
    return sendData(response, 200, {
      srd: { records: srdRecordCount() },
      packs: packInfos(),
      byKind,
      needsYou
    });
  });

  router.get(expressPath(HOMEBREW_PATHS.search), requireGm, (request, response) => {
    try {
      const { q, kind, includeArchived, limit } = SearchQuerySchema.parse(request.query);
      const needle = q.toLowerCase();
      const hits = store
        .listRecords({ type: kind, includeDeleted: includeArchived })
        .flatMap((row) => {
          const matches = matchesIn({ ...(row.pendingBody ?? row.body), name: row.name }, q);
          return matches.length === 0
            ? []
            : [
                {
                  id: row.id,
                  kind: row.type,
                  name: row.name,
                  packId: row.packId,
                  state: row.state,
                  archived: row.deletedAt !== null,
                  matches
                }
              ];
        })
        // A name that holds the words comes first.
        .sort(
          (left, right) =>
            Number(!left.name.toLowerCase().includes(needle)) - Number(!right.name.toLowerCase().includes(needle)) ||
            left.name.localeCompare(right.name)
        );
      return sendData(response, 200, { hits: hits.slice(0, limit ?? SEARCH_LIMIT), total: hits.length });
    } catch (error) {
      return malformed(response, error);
    }
  });

  router.get(expressPath(HOMEBREW_PATHS.srdRecord), requireGm, (request, response) => {
    const found = findCatalogRecord(srdOnly, pathParam(request, "id"));
    if (!found) return sendFailure(response, 404, "not_found", "That SRD record was not found.");
    return sendData(response, 200, { type: found.type, record: { ...found.body, type: found.type } });
  });

  // Packs (Sources)

  router.get(expressPath(HOMEBREW_PATHS.packs), requireGm, (_request, response) =>
    sendData(response, 200, { srd: { records: srdRecordCount() }, packs: packInfos() })
  );

  router.patch(expressPath(HOMEBREW_PATHS.packById), requireGm, (request, response) => {
    try {
      const packId = PackIdSchema.parse(pathParam(request, "packId"));
      const change = HomebrewPackUpdateRequestSchema.parse(request.body ?? {});
      store.updatePack(packId, change);
      options.notifyChanged();
      return sendData(response, 200, { pack: packInfos().find((pack) => pack.id === packId)! });
    } catch (error) {
      return storeError(response, error);
    }
  });

  // Published bodies only, without state or audience, so an importer never inherits this table's policy.
  router.get(expressPath(HOMEBREW_PATHS.packsExport), requireGm, (request, response) => {
    try {
      const query = ExportQuerySchema.parse(request.query);
      const wanted = query.id === undefined ? null : new Set(Array.isArray(query.id) ? query.id : [query.id]);
      const rows: HomebrewRecordRow[] = [];
      let cursor: string | undefined;
      do {
        const page = store.list({ type: query.type, packId: query.packId, state: "published", limit: 200, cursor });
        for (const summary of page.rows) {
          if (wanted && !wanted.has(summary.id)) continue;
          const row = store.get(summary.id);
          if (row) rows.push(row);
        }
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return sendData(response, 200, {
        pack: {
          schemaId: "vtt.homebrew-pack",
          schemaVersion: 1,
          name: query.name ?? "Homebrew",
          attribution: query.credit ? query.credit : null,
          exportedAt: new Date().toISOString(),
          records: rows.map((row) => ({ ...row.body, type: row.type }))
        }
      });
    } catch (error) {
      return malformed(response, error);
    }
  });

  /** A clash, and whether the record it names is of the same kind (an id can clash across kinds). */
  type Clash = NonNullable<HomebrewImportRecord["clash"]> & Readonly<{ sameKind: boolean }>;
  /** What each record of a pack would clash with here: the same id, else a record of its kind with its name. */
  const clashFinder = () => {
    const homebrew = store.listRecords({ includeDeleted: true });
    const byId = new Map(homebrew.map((row) => [row.id, row]));
    const byName = new Map<string, HomebrewRecordRow>();
    // A live record wins over an archived one of the same name.
    for (const row of [...homebrew].sort(
      (left, right) => Number(left.deletedAt === null) - Number(right.deletedAt === null)
    ))
      byName.set(`${row.type}|${row.name.toLowerCase()}`, row);
    const srdByName = new Map<string, { id: string; name: string }>();
    for (const kind of HOMEBREW_KINDS)
      for (const record of srdRecordsOf(kind)) srdByName.set(`${kind}|${record.name.toLowerCase()}`, record);
    return (type: HomebrewContentType, name: string, originalId: string): Clash | null => {
      const row = (originalId !== "" ? byId.get(originalId) : undefined) ?? byName.get(`${type}|${name.toLowerCase()}`);
      if (row)
        return {
          source: "homebrew",
          id: row.id,
          name: row.name,
          state: row.state,
          audience: row.audience,
          archived: row.deletedAt !== null,
          sameKind: row.type === type
        };
      const srd = srdByName.get(`${type}|${name.toLowerCase()}`);
      return srd
        ? { source: "srd", id: srd.id, name: srd.name, state: null, audience: null, archived: false, sameKind: true }
        : null;
    };
  };

  // Every record lands as a hidden draft in a new pack. Without `decisions`, today's one policy applies to every
  // clash (`onIdCollision`); with them, each record is imported as new, replaces the GM's own draft, is skipped, or
  // lands as a renamed copy. A published record is never replaced.
  router.post(expressPath(HOMEBREW_PATHS.packsImport), requireGm, (request, response) => {
    try {
      const rawRecords = (request.body as { pack?: { records?: unknown } } | undefined)?.pack?.records;
      if (Array.isArray(rawRecords) && rawRecords.length > MAX_PACK_RECORDS) {
        return sendFailure(response, 413, "bad_request", `A pack carries at most ${MAX_PACK_RECORDS} records.`);
      }
      const { pack, onIdCollision, dryRun, decisions } = HomebrewPackImportRequestSchema.parse(request.body);
      const author = authorOf(response);
      const imported: Array<{ id: string; type: HomebrewContentType; name: string; originalId: string }> = [];
      const reminted: Array<{
        originalId: string;
        id: string;
        reason: "srd-collision" | "homebrew-collision" | "foreign-shape";
      }> = [];
      const overwritten: Array<{ id: string; type: HomebrewContentType; name: string }> = [];
      const rejected: Array<{ originalId: string; issues: HomebrewValidationIssue[] }> = [];
      const reports: HomebrewImportRecord[] = [];
      // Ids claimed earlier in this pack count as taken, so two records cannot land on one row.
      const claimed = new Set<string>();
      const taken = (candidate: string) => claimed.has(candidate) || store.get(candidate) !== undefined;
      const clashOf = clashFinder();
      const decided = new Map((decisions ?? []).map((entry) => [entry.index, entry]));
      for (const index of decided.keys())
        if (index >= pack.records.length) throw new HomebrewRequestError(`The pack has no record number ${index + 1}.`);
      let landedIn: HomebrewPackInfo | null = null;
      const packFor = () => {
        if (dryRun) return undefined;
        landedIn ??= {
          ...store.createPack({ name: pack.name, credit: pack.attribution }),
          counts: { records: 0, published: 0, drafts: 0, shared: 0, archived: 0 }
        };
        return landedIn.id;
      };

      pack.records.forEach((record, index) => {
        const originalId = typeof record.id === "string" ? record.id : "";
        const reportedId = reportableId(originalId);
        let type: HomebrewContentType | null = null;
        let name: string | null = null;
        try {
          type = typeOf(record);
          // The same name check the write makes, so a dry run reports exactly what the apply would.
          name = recordName(record);
          const clash = clashOf(type, name, originalId);
          const replaceable =
            clash?.source === "homebrew" && clash.sameKind && clash.state === "draft" && !clash.archived;
          const allowed: HomebrewImportRecord["allowed"] = replaceable
            ? ["new", "replace", "skip", "rename"]
            : ["new", "skip", "rename"];
          // Any id that is not our shape for this type is re-minted, whatever its prefix.
          const foreign = originalId !== "" && !isMintedHomebrewId(originalId, type);
          const held = originalId !== "" && store.get(originalId) !== undefined;

          let decision: HomebrewImportRecord["decision"];
          let id: string | null;
          let landName = name;
          if (decisions === undefined) {
            // Today's one policy for every clash.
            const overwrite = held && !foreign && onIdCollision === "overwrite";
            const heldRow = overwrite ? store.get(originalId) : undefined;
            const refusal = heldRow ? overwriteRefusal(heldRow) : null;
            if (refusal) throw new HomebrewStateError(refusal);
            const needsMint = originalId === "" || foreign || claimed.has(originalId) || (held && !overwrite);
            decision = overwrite ? "replace" : "new";
            id = needsMint ? mintHomebrewId(type, name, taken) : originalId;
          } else {
            const chosen = decided.get(index);
            decision = chosen?.decision ?? (clash ? "rename" : "new");
            if (!allowed.includes(decision))
              throw new HomebrewRequestError(
                decision === "replace"
                  ? `${name} can't replace anything here: only your own draft of the same kind can be replaced.`
                  : `${name} can't be imported that way.`
              );
            if (decision === "rename") landName = chosen?.name ?? renamedFor(name, pack.name);
            id =
              decision === "skip"
                ? null
                : decision === "replace"
                  ? clash!.id
                  : decision === "new" && originalId !== "" && !foreign && !taken(originalId)
                    ? originalId
                    : mintHomebrewId(type, landName, taken);
          }
          const body = landName === name ? record : { ...record, name: landName };
          const problems = id === null ? [] : validate(type, bodyAt(body, id, type)).issues;
          reports.push({
            index,
            type,
            name,
            clash: clash
              ? {
                  source: clash.source,
                  id: clash.id,
                  name: clash.name,
                  state: clash.state,
                  audience: clash.audience,
                  archived: clash.archived
                }
              : null,
            problems,
            allowed,
            decision,
            id
          });
          if (id === null) return;
          claimed.add(id);
          if (id !== originalId && originalId !== "" && decision !== "replace") {
            reminted.push({
              originalId: reportedId,
              id,
              reason: !originalId.startsWith(HOMEBREW_ID_PREFIX)
                ? "srd-collision"
                : foreign
                  ? "foreign-shape"
                  : "homebrew-collision"
            });
          }
          if (!dryRun) store.importRecord(id, type, body, decision === "replace", author, { packId: packFor() });
          if (decision === "replace") overwritten.push({ id, type, name: landName });
          imported.push({ id, type, name: landName, originalId: originalId === "" ? id : reportedId });
        } catch (error) {
          if (error instanceof HomebrewRequestError) throw error;
          // One record's fault must not sink the pack, but its text stays in the log.
          if (!(error instanceof HomebrewStateError)) console.error("homebrew pack record failed:", error);
          const message = error instanceof HomebrewStateError ? error.message : "That record could not be imported.";
          const issues = [{ path: [], message, recordId: null }];
          rejected.push({ originalId: reportedId, issues });
          reports.push({
            index,
            type,
            name,
            clash: null,
            problems: issues,
            allowed: ["skip"],
            decision: "skip",
            id: null
          });
        }
      });
      if (!dryRun && imported.length > 0) options.notifyChanged();
      const finalPack: HomebrewPackInfo | null = landedIn
        ? (packInfos().find((info) => info.id === (landedIn as HomebrewPackInfo).id) ?? null)
        : null;
      return sendData(response, 200, {
        imported,
        reminted,
        overwritten,
        rejected,
        dryRun,
        records: reports,
        pack: finalPack
      });
    } catch (error) {
      return storeError(response, error);
    }
  });

  // See as: what one player would receive, read from that player's own catalog. Never sent to a player.

  router.get(expressPath(HOMEBREW_PATHS.seeAsCompendium), requireGm, (request, response) => {
    try {
      const { as, kind } = SeeAsCompendiumQuerySchema.parse(request.query);
      return sendWithEtag(request, response, compendiumOf(library.forAudience(readerFor(as)), kind));
    } catch (error) {
      return malformed(response, error);
    }
  });

  router.get(expressPath(HOMEBREW_PATHS.seeAsContent), requireGm, (request, response) => {
    try {
      const { as } = SeeAsQuerySchema.parse(request.query);
      const reader = readerFor(as);
      const id = pathParam(request, "id");
      const kind = store.get(id)?.type ?? kindInView(srdOnly, id);
      if (!kind) return sendFailure(response, 404, "not_found", "That record was not found.");
      if (kind === "spell-list") {
        const received = store.publishedFor(reader).spellLists.some((list) => list.id === id);
        return sendData(response, 200, { as, kind, received, entry: null });
      }
      const entry = compendiumEntryOf(library.forAudience(reader), kind, id);
      return sendData(response, 200, { as, kind, received: entry !== null, entry });
    } catch (error) {
      return malformed(response, error);
    }
  });

  router.post(expressPath(HOMEBREW_PATHS.seeAsBuilderOffers), requireGm, (request, response) => {
    try {
      const { as, draft } = HomebrewSeeAsBuilderOffersSchema.parse(request.body);
      return sendData(response, 200, builderOffers(draft, library.forAudience(readerFor(as))));
    } catch (error) {
      if (error instanceof CommandRejectedError) return sendFailure(response, 409, "conflict", error.message);
      return malformed(response, error);
    }
  });

  router.use(apiErrorHandler(FAULT));
  return router;
}

/** A renamed import's name: the record's own, with the pack's in brackets, kept under the name budget. */
function renamedFor(name: string, packName: string): string {
  const renamed = `${name} (${packName})`;
  return renamed.length <= 120
    ? renamed
    : `${name.slice(0, Math.max(1, 117 - packName.length))} (${packName})`.slice(0, 120);
}

/** Must be mounted above the global 512kb `express.json` (body-parser skips already-parsed requests). */
export function homebrewPackBodyParser() {
  return express.json({ limit: HOMEBREW_PACK_BODY_LIMIT });
}
export const HOMEBREW_PACK_IMPORT_PATH = HOMEBREW_PATHS.packsImport;
