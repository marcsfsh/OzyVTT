import { randomUUID } from "node:crypto";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import {
  API_VERSION,
  HOMEBREW_PATHS,
  HomebrewContentTypeSchema,
  HomebrewContentStateSchema,
  type ApiErrorCode,
  type HomebrewContentType,
  type HomebrewValidationIssue,
  type HomebrewValidity
} from "@vtt/api-contract";
import {
  HomebrewNotFoundError,
  HomebrewRevisionConflictError,
  HomebrewStateError,
  copyName,
  overwriteRefusal,
  recordName,
  type HomebrewBody,
  type HomebrewRecordRow,
  type HomebrewRevalidator,
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

/**
 * Homebrew authoring REST (`/api/v1/homebrew/*`). Every route is GM-only: players see homebrew only through the
 * merged `CONTENT_PATHS` catalogs (published, visible, not deleted). Writes emit a content-free `homebrew:changed`.
 */

const RecordBodySchema = z.record(z.string(), z.unknown());
const CreateSchema = z.object({ record: RecordBodySchema }).strict();
const UpdateSchema = z
  .object({ record: RecordBodySchema, expectedRev: z.number().int().nonnegative().optional() })
  .strict();
const DuplicateSchema = z.object({ name: z.string().min(1).max(120).optional() }).strict();
const StateChangeSchema = z.object({ expectedRev: z.number().int().nonnegative().optional() }).strict();
const VisibilitySchema = z
  .object({ visibleToPlayers: z.boolean(), expectedRev: z.number().int().nonnegative().optional() })
  .strict();
const PackSchema = z
  .object({
    schemaId: z.literal("vtt.homebrew-pack"),
    schemaVersion: z.literal(1),
    name: z.string().min(1).max(120),
    attribution: z.string().max(400).nullable(),
    exportedAt: z.string().datetime({ offset: true }),
    records: z.array(RecordBodySchema)
  })
  .strict();
const PackImportSchema = z
  .object({
    pack: PackSchema,
    onIdCollision: z.enum(["remint", "overwrite"]).default("remint"),
    dryRun: z.boolean().default(false)
  })
  .strict();

/** Query booleans arrive as strings; accept the two spellings a browser or curl actually sends. */
const QueryBoolean = z.enum(["true", "false", "1", "0"]).transform((value) => value === "true" || value === "1");
/** Lenient (unknown keys stripped) rather than strict: a stray query parameter should not 400 a read. */
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
export type HomebrewValidator = (type: HomebrewContentType, body: HomebrewBody) => HomebrewValidity;
const UNVALIDATED: HomebrewValidator = () => ({ valid: true, issues: [] });

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
  authorizeGm: (token: string | undefined) => boolean;
  /** Used only to answer an authenticated player 403 instead of 401, never to grant access. */
  authorizePlayer: (token: string | undefined) => boolean;
  /** Emit the content-free `homebrew:changed` ping so every client refetches its own merged catalog. */
  notifyChanged: () => void;
  validate?: HomebrewValidator;
  usagesOf?: HomebrewUsageLookup;
  /** Resolves a catalog id for `/duplicate` so an SRD record can be forked into an editable draft. */
  catalogRecord?: HomebrewCatalogLookup;
  newId?: () => string;
}>;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Slug a malformed pack id for the report, since the contract requires a valid id there. */
function reportableId(raw: string): string {
  if (raw !== "" && raw.length <= HOMEBREW_ID_MAX_LENGTH && /^[a-z0-9-]+$/.test(raw)) return raw;
  return slugify(raw, HOMEBREW_ID_MAX_LENGTH) || "unidentified";
}

function bearer(request: Request): string | undefined {
  return request.header("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
}
/** A route param is always a single string at runtime; coerce the Express `string | string[]` type. */
function pathParam(request: Request, name: string): string {
  const value = request.params[name];
  return typeof value === "string" ? value : "";
}
/** `{id}` is the OpenAPI spelling; Express wants `:id`. Deriving both from one constant stops drift. */
function route(path: string): string {
  return path.replace(/\{(\w+)\}/g, ":$1");
}

export function createHomebrewRouter(options: HomebrewRouterOptions) {
  const router = Router();
  const { store } = options;
  const validate = options.validate ?? UNVALIDATED;
  const usagesOf = options.usagesOf ?? NO_USAGES;
  const catalogRecord = options.catalogRecord ?? NO_CATALOG;
  const newId = options.newId ?? randomUUID;

  router.use((request, response, next) => {
    const candidate = request.header("x-request-id");
    response.locals.requestId = candidate && UUID_V4.test(candidate) ? candidate : newId();
    response.setHeader("x-request-id", response.locals.requestId);
    response.setHeader("cache-control", "no-store");
    next();
  });

  function envelope(response: Response, status: number, data: unknown) {
    return response.status(status).json({ ok: true, apiVersion: API_VERSION, data });
  }
  function failure(
    response: Response,
    status: number,
    code: ApiErrorCode,
    message: string,
    details?: Record<string, unknown>,
    currentRevision?: number
  ) {
    return response.status(status).json({
      ok: false,
      apiVersion: API_VERSION,
      error: {
        code,
        message,
        requestId: response.locals.requestId ?? randomUUID(),
        ...(details ? { details } : {}),
        ...(currentRevision !== undefined ? { currentRevision } : {})
      }
    });
  }
  /** Zod issues become the same `{ path, message }` tuples publish validation emits, so failures look alike. */
  function malformed(response: Response, error: unknown) {
    if (error instanceof z.ZodError) {
      const issues: HomebrewValidationIssue[] = error.issues.map((issue) => ({
        path: [...issue.path] as (string | number)[],
        message: issue.message,
        recordId: null
      }));
      return failure(response, 400, "validation_failed", issues[0]?.message ?? "The request is malformed.", { issues });
    }
    return failure(
      response,
      400,
      "validation_failed",
      error instanceof Error ? error.message : "The request is malformed."
    );
  }
  /** One mapping for every store failure, so REST semantics stay uniform across all 13 operations. */
  function storeError(response: Response, error: unknown) {
    if (error instanceof HomebrewRevisionConflictError)
      return failure(response, 409, "conflict", error.message, undefined, error.currentRev);
    if (error instanceof HomebrewNotFoundError) return failure(response, 404, "not_found", error.message);
    if (error instanceof HomebrewStateError) return failure(response, 409, "conflict", error.message);
    return malformed(response, error);
  }

  /** 401 for an unauthenticated caller, 403 for an authenticated player (both declared in the contract). */
  const requireGm = (request: Request, response: Response, next: NextFunction) => {
    const token = bearer(request);
    if (options.authorizeGm(token)) return next();
    if (options.authorizePlayer(token)) return failure(response, 403, "forbidden", "Homebrew authoring is the GM's.");
    return failure(response, 401, "unauthenticated", "A valid GM session is required.");
  };

  /** `type` lives on the row, not the body, but is put back here so pack records are self-describing. */
  const documentOf = (row: HomebrewRecordRow) => ({
    id: row.id,
    type: row.type,
    state: row.state,
    visibleToPlayers: row.visibleToPlayers,
    deletedAt: row.deletedAt,
    rev: row.rev,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    validity: validate(row.type, row.body),
    record: { ...row.body, type: row.type }
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
    return envelope(response, status, { record: documentOf(row) });
  };

  /** The `type` discriminator is read off the submitted record - the same place the pack format keeps it. */
  function typeOf(record: Record<string, unknown>): HomebrewContentType {
    const parsed = HomebrewContentTypeSchema.safeParse(record.type);
    if (!parsed.success)
      throw new HomebrewStateError(`"${String(record.type)}" is not one of the nine homebrew content types.`);
    return parsed.data;
  }

  // The polymorphic collection

  router.get(route(HOMEBREW_PATHS.content), requireGm, (request, response) => {
    try {
      const filter = ListQuerySchema.parse(request.query);
      const page = store.list(filter);
      return envelope(response, 200, {
        records: page.rows.map((row) => summaryOf(row, store.get(row.id))),
        nextCursor: page.nextCursor,
        total: page.total
      });
    } catch (error) {
      return malformed(response, error);
    }
  });

  router.post(route(HOMEBREW_PATHS.content), requireGm, (request, response) => {
    try {
      const { record } = CreateSchema.parse(request.body);
      return sent(response, store.create({ type: typeOf(record), body: record }), 201);
    } catch (error) {
      return storeError(response, error);
    }
  });

  router.get(route(HOMEBREW_PATHS.contentById), requireGm, (request, response) => {
    const row = store.get(pathParam(request, "id"));
    if (!row) return failure(response, 404, "not_found", "That record was not found.");
    return envelope(response, 200, { record: documentOf(row) });
  });

  // Always lands (autosave); the store demotes a published record whose new body would not publish.
  router.patch(route(HOMEBREW_PATHS.contentById), requireGm, (request, response) => {
    try {
      const { record, expectedRev } = UpdateSchema.parse(request.body);
      const revalidate: HomebrewRevalidator = (type, body) => validate(type, body).valid;
      return sent(response, store.update(pathParam(request, "id"), record, expectedRev, "gm", revalidate));
    } catch (error) {
      return storeError(response, error);
    }
  });

  // Idempotent: an unknown or already-deleted id is still a 200. Soft delete keeps the row's data.
  router.delete(route(HOMEBREW_PATHS.contentById), requireGm, (request, response) => {
    const id = pathParam(request, "id");
    const deleted = store.softDelete(id);
    if (deleted) options.notifyChanged();
    return envelope(
      response,
      200,
      deleted
        ? { id: deleted.id, deleted: true, deletedAt: deleted.deletedAt }
        : { id, deleted: true, deletedAt: new Date().toISOString() }
    );
  });

  router.post(route(HOMEBREW_PATHS.contentRestore), requireGm, (request, response) => {
    try {
      return sent(response, store.restore(pathParam(request, "id")));
    } catch (error) {
      return storeError(response, error);
    }
  });

  // Homebrew row first, else an SRD record; the reserved `hb-` prefix means they cannot collide.
  router.post(route(HOMEBREW_PATHS.contentDuplicate), requireGm, (request, response) => {
    try {
      const { name } = DuplicateSchema.parse(request.body ?? {});
      const id = pathParam(request, "id");
      if (store.get(id)) return sent(response, store.duplicate(id, name), 201);

      const source = catalogRecord(id);
      if (!source) return failure(response, 404, "not_found", "That record was not found.");
      const copied = copyName(name ?? String((source.body as { name?: unknown }).name ?? id));
      // Minted before the rewrite because self-derived catalog slugs (`<id>-lineages`, `<id>-subclasses`)
      // must point at the copy, not the source. See `homebrew-srd-copy.ts`.
      const mintedId = mintHomebrewId(source.type, copied, (candidate) => store.get(candidate) !== undefined);
      const body = rewriteForNewId(source.type, { ...source.body, name: copied }, id, mintedId);
      return sent(response, store.importRecord(mintedId, source.type, body, false, "homebrew:duplicate"), 201);
    } catch (error) {
      return storeError(response, error);
    }
  });

  /** Publishing requires validity. 409, not 400: the request is fine, the stored draft is not. */
  router.post(route(HOMEBREW_PATHS.contentPublish), requireGm, (request, response) => {
    try {
      const { expectedRev } = StateChangeSchema.parse(request.body ?? {});
      const id = pathParam(request, "id");
      const existing = store.get(id);
      if (!existing) return failure(response, 404, "not_found", "That record was not found.");
      const validity = validate(existing.type, existing.body);
      if (!validity.valid)
        return failure(response, 409, "conflict", "This draft cannot be published until it is valid.", {
          invalid: { issues: validity.issues }
        });
      return sent(response, store.setState(id, "published", expectedRev));
    } catch (error) {
      return storeError(response, error);
    }
  });

  router.post(route(HOMEBREW_PATHS.contentUnpublish), requireGm, (request, response) => {
    try {
      const { expectedRev } = StateChangeSchema.parse(request.body ?? {});
      return sent(response, store.setState(pathParam(request, "id"), "draft", expectedRev));
    } catch (error) {
      return storeError(response, error);
    }
  });

  router.post(route(HOMEBREW_PATHS.contentVisibility), requireGm, (request, response) => {
    try {
      const { visibleToPlayers, expectedRev } = VisibilitySchema.parse(request.body);
      return sent(response, store.setVisibility(pathParam(request, "id"), visibleToPlayers, expectedRev));
    } catch (error) {
      return storeError(response, error);
    }
  });

  // Always `safeToDelete`: built characters are self-contained, so the count is informational.
  router.get(route(HOMEBREW_PATHS.contentUsages), requireGm, (request, response) => {
    const id = pathParam(request, "id");
    const row = store.get(id);
    if (!row) return failure(response, 404, "not_found", "That record was not found.");
    return envelope(response, 200, { id, usages: usagesOf(row.type, id), safeToDelete: true });
  });

  // Packs (GM-to-GM interchange)

  // Published bodies only, without state or visibility, so an importer never inherits this table's policy.
  router.get(route(HOMEBREW_PATHS.packsExport), requireGm, (request, response) => {
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
      return envelope(response, 200, {
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
  router.post(route(HOMEBREW_PATHS.packsImport), requireGm, (request, response) => {
    try {
      const rawRecords = (request.body as { pack?: { records?: unknown } } | undefined)?.pack?.records;
      if (Array.isArray(rawRecords) && rawRecords.length > MAX_PACK_RECORDS) {
        return failure(response, 413, "bad_request", `A pack carries at most ${MAX_PACK_RECORDS} records.`);
      }
      const { pack, onIdCollision, dryRun } = PackImportSchema.parse(request.body);
      const imported: Array<{ id: string; type: HomebrewContentType; name: string; originalId: string }> = [];
      const reminted: Array<{ originalId: string; id: string; reason: "srd-collision" | "homebrew-collision" }> = [];
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
          // Any id that is not our shape for this type is re-minted, not just an `hb-` one.
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
          // The contract allows two reasons: outside `hb-` is the bundle's reserved namespace, inside is ours.
          if (needsMint && originalId !== "") {
            reminted.push({
              originalId: reportedId,
              id,
              reason: originalId.startsWith(HOMEBREW_ID_PREFIX) ? "homebrew-collision" : "srd-collision"
            });
          }
          claimed.add(id);
          if (!dryRun) store.importRecord(id, type, record, overwrite);
          if (overwrite) overwritten.push({ id, type, name });
          imported.push({ id, type, name, originalId: originalId === "" ? id : reportedId });
        } catch (error) {
          rejected.push({
            originalId: reportedId,
            issues: [
              {
                path: [],
                message: error instanceof Error ? error.message : "That record could not be imported.",
                recordId: null
              }
            ]
          });
        }
      }
      if (!dryRun && imported.length > 0) options.notifyChanged();
      return envelope(response, 200, { imported, reminted, overwritten, rejected, dryRun });
    } catch (error) {
      return storeError(response, error);
    }
  });

  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    return failure(
      response,
      500,
      "internal_error",
      error instanceof Error ? error.message : "The homebrew request failed."
    );
  });
  return router;
}

/** Must be mounted above the global 512kb `express.json` (body-parser skips already-parsed requests). */
export function homebrewPackBodyParser() {
  return express.json({ limit: HOMEBREW_PACK_BODY_LIMIT });
}
export const HOMEBREW_PACK_IMPORT_PATH = HOMEBREW_PATHS.packsImport;
