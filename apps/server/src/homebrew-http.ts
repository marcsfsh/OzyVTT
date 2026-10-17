import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import {
  HOMEBREW_PATHS,
  HomebrewContentStateSchema,
  HomebrewContentTypeSchema,
  HomebrewCreateRequestSchema,
  HomebrewDuplicateRequestSchema,
  HomebrewPackImportRequestSchema,
  HomebrewStateChangeRequestSchema,
  HomebrewUpdateRequestSchema,
  HomebrewVisibilityRequestSchema,
  type HomebrewContentType,
  type HomebrewValidationIssue,
  type HomebrewValidity
} from "@vtt/api-contract";
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
  HomebrewNotFoundError,
  HomebrewRevisionConflictError,
  HomebrewStateError,
  copyName,
  overwriteRefusal,
  recordName,
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
import { rewriteForNewId, type HomebrewSourceRecord } from "./homebrew-srd-copy.js";
import type { HomebrewValidationScenario } from "./homebrew-validate.js";
import { callerOf, refuse, type CredentialVerifiers } from "./request-auth.js";

/**
 * Homebrew authoring REST (`/api/v1/homebrew/*`). Every route is GM-only: players see homebrew only through the
 * merged `CONTENT_PATHS` catalogs (published, visible, not deleted). Writes emit a content-free `homebrew:changed`.
 */

/** Query booleans arrive as strings; accept the two spellings a browser or curl actually sends. */
const QueryBoolean = z.enum(["true", "false", "1", "0"]).transform((value) => value === "true" || value === "1");
/** Lenient (unknown keys stripped): a stray query parameter should not 400 a read. */
const ListQuerySchema = z.object({
  type: HomebrewContentTypeSchema.optional(),
  state: HomebrewContentStateSchema.optional(),
  visibleToPlayers: QueryBoolean.optional(),
  q: z.string().max(120).optional(),
  includeDeleted: QueryBoolean.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().max(200).optional()
});
const ExportQuerySchema = z.object({
  type: HomebrewContentTypeSchema.optional(),
  id: z.union([z.string().max(60), z.array(z.string().max(60)).max(500)]).optional()
});

/** Route-scoped body limit for pack import, above the server's 512kb global default. */
export const HOMEBREW_PACK_BODY_LIMIT = "4mb";
/** Checked before parsing so a hostile pack cannot make the server do the work first. */
const MAX_PACK_RECORDS = 500;

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
}>;

const FAULT = "The homebrew request failed.";

/** Slug a malformed pack id for the report, since the contract requires a valid id there. */
function reportableId(raw: string): string {
  if (raw !== "" && raw.length <= HOMEBREW_ID_MAX_LENGTH && /^[a-z0-9-]+$/.test(raw)) return raw;
  return slugify(raw, HOMEBREW_ID_MAX_LENGTH) || "unidentified";
}

/** Zod issues become the same `{ path, message }` tuples publish validation emits, so failures look alike. */
function malformed(response: Response, error: unknown) {
  if (!(error instanceof z.ZodError)) return sendInternalError(response, error, FAULT);
  const issues: HomebrewValidationIssue[] = issuesOf(error).map((issue) => ({ ...issue, recordId: null }));
  return sendFailure(response, 400, "validation_failed", issues[0]?.message ?? "The request is malformed.", {
    issues
  });
}
/** One mapping for every store failure, so REST semantics stay uniform across all 13 operations. */
function storeError(response: Response, error: unknown) {
  if (error instanceof HomebrewRevisionConflictError)
    return sendFailure(response, 409, "conflict", error.message, undefined, error.currentRev);
  if (error instanceof HomebrewNotFoundError) return sendFailure(response, 404, "not_found", error.message);
  if (error instanceof HomebrewStateError) return sendFailure(response, 409, "conflict", error.message);
  return malformed(response, error);
}

export function createHomebrewRouter(options: HomebrewRouterOptions) {
  const router = Router();
  const { store } = options;
  const validate = options.validate ?? UNVALIDATED;
  const usagesOf = options.usagesOf ?? NO_USAGES;
  const catalogRecord = options.catalogRecord ?? NO_CATALOG;

  /** 401 without a live credential, 403 for any other valid one (both declared in the contract). */
  const requireGm = (request: Request, response: Response, next: NextFunction) => {
    const caller = callerOf(request, response, options.verifiers);
    if (caller.kind === "gm") return next();
    return refuse(response, caller, "Homebrew authoring is the GM's.");
  };

  /** `type` lives on the row and is put back into the body here, so pack records are self-describing. */
  const documentOf = (row: HomebrewRecordRow) => ({
    id: row.id,
    type: row.type,
    state: row.state,
    visibleToPlayers: row.visibleToPlayers,
    deletedAt: row.deletedAt,
    rev: row.rev,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // A published record's editor works on its pending edits, so the report describes what Publish would put live.
    validity: row.pendingBody ? validate(row.type, row.pendingBody, { without: row.id }) : validate(row.type, row.body),
    pendingChanges: row.pendingBody !== null,
    record: { ...(row.pendingBody ?? row.body), type: row.type }
  });
  const summaryOf = (row: HomebrewSummaryRow, record: HomebrewRecordRow | undefined) => ({
    id: row.id,
    type: row.type,
    name: row.name,
    source: "homebrew" as const,
    state: row.state,
    visibleToPlayers: row.visibleToPlayers,
    deletedAt: row.deletedAt,
    rev: row.rev,
    updatedAt: row.updatedAt,
    valid: record ? validate(row.type, record.body).valid : true,
    usageCount: usagesOf(row.type, row.id).length
  });
  const sent = (response: Response, row: HomebrewRecordRow, status = 200) => {
    options.notifyChanged();
    return sendData(response, status, { record: documentOf(row) });
  };

  /** The `type` discriminator is read off the submitted record - the same place the pack format keeps it. */
  function typeOf(record: Record<string, unknown>): HomebrewContentType {
    const parsed = HomebrewContentTypeSchema.safeParse(record.type);
    if (!parsed.success)
      throw new HomebrewStateError(`"${String(record.type)}" is not one of the nine homebrew content types.`);
    return parsed.data;
  }

  // The polymorphic collection

  router.get(expressPath(HOMEBREW_PATHS.content), requireGm, (request, response) => {
    try {
      const filter = ListQuerySchema.parse(request.query);
      const page = store.list(filter);
      return sendData(response, 200, {
        records: page.rows.map((row) => summaryOf(row, store.get(row.id))),
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
      return sent(response, store.create({ type: typeOf(record), body: record }), 201);
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
      return sent(response, store.update(pathParam(request, "id"), record, expectedRev, "gm"));
    } catch (error) {
      return storeError(response, error);
    }
  });

  // Idempotent: an unknown or already-deleted id is still a 200. Soft delete keeps the row's data.
  router.delete(expressPath(HOMEBREW_PATHS.contentById), requireGm, (request, response) => {
    const id = pathParam(request, "id");
    const deleted = store.softDelete(id);
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
      return sent(response, store.restore(pathParam(request, "id")));
    } catch (error) {
      return storeError(response, error);
    }
  });

  // Homebrew row first, else an SRD record; the reserved `hb-` prefix means they cannot collide.
  router.post(expressPath(HOMEBREW_PATHS.contentDuplicate), requireGm, (request, response) => {
    try {
      const { name } = HomebrewDuplicateRequestSchema.parse(request.body ?? {});
      const id = pathParam(request, "id");
      if (store.get(id)) return sent(response, store.duplicate(id, name), 201);

      const source = catalogRecord(id);
      if (!source) return sendFailure(response, 404, "not_found", "That record was not found.");
      const copied = copyName(name ?? String((source.body as { name?: unknown }).name ?? id));
      // Minted before the rewrite because self-derived catalog slugs (`<id>-lineages`, `<id>-subclasses`)
      // must point at the copy's id. See `homebrew-srd-copy.ts`.
      const mintedId = mintHomebrewId(source.type, copied, (candidate) => store.get(candidate) !== undefined);
      const body = rewriteForNewId(source.type, { ...source.body, name: copied }, id, mintedId);
      return sent(response, store.importRecord(mintedId, source.type, body, false, "homebrew:duplicate"), 201);
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
      const validity = existing.pendingBody
        ? validate(existing.type, existing.pendingBody, { without: existing.id })
        : validate(existing.type, existing.body);
      if (!validity.valid)
        return sendFailure(
          response,
          409,
          "conflict",
          existing.pendingBody
            ? "These changes cannot go live until they are valid; the published version is unchanged."
            : "This draft cannot be published until it is valid.",
          { invalid: { issues: validity.issues } }
        );
      return sent(response, store.publish(id, expectedRev));
    } catch (error) {
      return storeError(response, error);
    }
  });

  router.post(expressPath(HOMEBREW_PATHS.contentUnpublish), requireGm, (request, response) => {
    try {
      const { expectedRev } = HomebrewStateChangeRequestSchema.parse(request.body ?? {});
      return sent(response, store.unpublish(pathParam(request, "id"), expectedRev));
    } catch (error) {
      return storeError(response, error);
    }
  });

  router.post(expressPath(HOMEBREW_PATHS.contentDiscard), requireGm, (request, response) => {
    try {
      const { expectedRev } = HomebrewStateChangeRequestSchema.parse(request.body ?? {});
      return sent(response, store.discardPending(pathParam(request, "id"), expectedRev));
    } catch (error) {
      return storeError(response, error);
    }
  });

  router.post(expressPath(HOMEBREW_PATHS.contentVisibility), requireGm, (request, response) => {
    try {
      const { visibleToPlayers, expectedRev } = HomebrewVisibilityRequestSchema.parse(request.body);
      return sent(response, store.setVisibility(pathParam(request, "id"), visibleToPlayers, expectedRev));
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

  // Packs (GM-to-GM interchange)

  // Published bodies only, without state or visibility, so an importer never inherits this table's policy.
  router.get(expressPath(HOMEBREW_PATHS.packsExport), requireGm, (request, response) => {
    try {
      const query = ExportQuerySchema.parse(request.query);
      const wanted = query.id === undefined ? null : new Set(Array.isArray(query.id) ? query.id : [query.id]);
      const rows: HomebrewRecordRow[] = [];
      let cursor: string | undefined;
      do {
        const page = store.list({ type: query.type, state: "published", limit: 200, cursor });
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
          name: "Homebrew",
          attribution: null,
          exportedAt: new Date().toISOString(),
          records: rows.map((row) => ({ ...row.body, type: row.type }))
        }
      });
    } catch (error) {
      return malformed(response, error);
    }
  });

  // Every record lands as an invisible draft; references to re-minted ids are not rewritten (publish catches
  // them). Foreign ids are re-minted and reported; `overwrite` replaces only a live draft, never live content.
  router.post(expressPath(HOMEBREW_PATHS.packsImport), requireGm, (request, response) => {
    try {
      const rawRecords = (request.body as { pack?: { records?: unknown } } | undefined)?.pack?.records;
      if (Array.isArray(rawRecords) && rawRecords.length > MAX_PACK_RECORDS) {
        return sendFailure(response, 413, "bad_request", `A pack carries at most ${MAX_PACK_RECORDS} records.`);
      }
      const { pack, onIdCollision, dryRun } = HomebrewPackImportRequestSchema.parse(request.body);
      const imported: Array<{ id: string; type: HomebrewContentType; name: string; originalId: string }> = [];
      const reminted: Array<{
        originalId: string;
        id: string;
        reason: "srd-collision" | "homebrew-collision" | "foreign-shape";
      }> = [];
      const overwritten: Array<{ id: string; type: HomebrewContentType; name: string }> = [];
      const rejected: Array<{ originalId: string; issues: HomebrewValidationIssue[] }> = [];
      // Ids claimed earlier in this pack count as taken, so two records cannot land on one row.
      const claimed = new Set<string>();

      for (const record of pack.records) {
        const originalId = typeof record.id === "string" ? record.id : "";
        const reportedId = reportableId(originalId);
        try {
          const type = typeOf(record);
          // The same name check the write makes, so a dry run reports exactly what the apply would.
          const name = recordName(record);
          // Any id that is not our shape for this type is re-minted, whatever its prefix.
          const foreign = originalId !== "" && !isMintedHomebrewId(originalId, type);
          const heldRow = originalId === "" ? undefined : store.get(originalId);
          const held = heldRow !== undefined;
          const overwrite = held && !foreign && onIdCollision === "overwrite";
          // Checked here too because a dry run writes nothing but must produce the same report.
          const refusal = overwrite && heldRow ? overwriteRefusal(heldRow) : null;
          if (refusal) throw new HomebrewStateError(refusal);
          const needsMint = originalId === "" || foreign || claimed.has(originalId) || (held && !overwrite);
          const id = needsMint
            ? mintHomebrewId(type, name, (candidate) => claimed.has(candidate) || store.get(candidate) !== undefined)
            : originalId;
          if (needsMint && originalId !== "") {
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
          claimed.add(id);
          if (!dryRun) store.importRecord(id, type, record, overwrite);
          if (overwrite) overwritten.push({ id, type, name });
          imported.push({ id, type, name, originalId: originalId === "" ? id : reportedId });
        } catch (error) {
          // One record's fault must not sink the pack, but its text stays in the log.
          if (!(error instanceof HomebrewStateError)) console.error("homebrew pack record failed:", error);
          const message = error instanceof HomebrewStateError ? error.message : "That record could not be imported.";
          rejected.push({ originalId: reportedId, issues: [{ path: [], message, recordId: null }] });
        }
      }
      if (!dryRun && imported.length > 0) options.notifyChanged();
      return sendData(response, 200, { imported, reminted, overwritten, rejected, dryRun });
    } catch (error) {
      return storeError(response, error);
    }
  });

  router.use(apiErrorHandler(FAULT));
  return router;
}

/** Must be mounted above the global 512kb `express.json` (body-parser skips already-parsed requests). */
export function homebrewPackBodyParser() {
  return express.json({ limit: HOMEBREW_PACK_BODY_LIMIT });
}
export const HOMEBREW_PACK_IMPORT_PATH = HOMEBREW_PATHS.packsImport;
