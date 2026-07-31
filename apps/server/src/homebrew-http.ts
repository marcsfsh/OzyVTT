import { randomUUID } from "node:crypto";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import {
  API_VERSION, HOMEBREW_PATHS, HomebrewContentTypeSchema, HomebrewContentStateSchema,
  type ApiErrorCode, type HomebrewContentType, type HomebrewValidationIssue, type HomebrewValidity
} from "@vtt/api-contract";
import {
  HomebrewNotFoundError, HomebrewRevisionConflictError, HomebrewStateError, copyName, overwriteRefusal, recordName,
  type HomebrewBody, type HomebrewRecordRow, type HomebrewRevalidator, type HomebrewStore, type HomebrewSummaryRow
} from "./homebrew-store.js";
import { isMintedHomebrewId, mintHomebrewId, slugify, HOMEBREW_ID_MAX_LENGTH, HOMEBREW_ID_PREFIX } from "./homebrew-ids.js";
import { rewriteForNewId, type HomebrewSourceRecord } from "./homebrew-srd-copy.js";

/**
 * The homebrew authoring REST surface (`/api/v1/homebrew/*`), mounted in `server.ts` beside the
 * codex/map/token/viewer routers and deliberately OUTSIDE the GameState broadcast - homebrew records
 * are not GameState, which is what keeps `projections.ts` untouched by this whole feature.
 *
 * **Every route is GM-only. There is no player read here at all.** Players reach homebrew solely
 * through the merged `CONTENT_PATHS` catalogs, and only records that are published AND
 * player-visible AND not deleted. `packages/api-contract/test/contract.test.ts` pins that: every
 * homebrew operation carries `gmAuth` and never `playerAuth` or `bearerAuth` (no integration scope).
 * This router therefore has no `roleOf` branch - the absence of one is the guarantee.
 *
 * **Zero `socket.on` handlers**, by the same reasoning as the codex: the socket-parity guard
 * (`apps/server/test/game-http.test.ts`) requires every socket event to have an HTTP twin and a
 * `GAME_COMMAND_SCOPES` entry, and homebrew is not a game command. Writes ping clients through the
 * content-free `homebrew:changed` broadcast instead.
 *
 * ONE deliberate deviation from `codex-http.ts`, toward `game-http.ts`: failures carry structured
 * `details.issues`, not a single prose string - publish validation (slice 2) needs a machine-addressable
 * `path` per issue so a form editor can point at a field.
 *
 * (There used to be a second, recorded here as "the codex always mints request ids". The codex now honours
 * a caller's v4 UUID exactly as this router does, so the three surfaces agree and there is nothing left to
 * deviate from.)
 */

const RecordBodySchema = z.record(z.string(), z.unknown());
const CreateSchema = z.object({ record: RecordBodySchema }).strict();
const UpdateSchema = z.object({ record: RecordBodySchema, expectedRev: z.number().int().nonnegative().optional() }).strict();
const DuplicateSchema = z.object({ name: z.string().min(1).max(120).optional() }).strict();
const StateChangeSchema = z.object({ expectedRev: z.number().int().nonnegative().optional() }).strict();
const VisibilitySchema = z.object({ visibleToPlayers: z.boolean(), expectedRev: z.number().int().nonnegative().optional() }).strict();
const PackSchema = z.object({
  schemaId: z.literal("vtt.homebrew-pack"),
  schemaVersion: z.literal(1),
  name: z.string().min(1).max(120),
  attribution: z.string().max(400).nullable(),
  exportedAt: z.string().datetime({ offset: true }),
  records: z.array(RecordBodySchema)
}).strict();
const PackImportSchema = z.object({
  pack: PackSchema,
  onIdCollision: z.enum(["remint", "overwrite"]).default("remint"),
  dryRun: z.boolean().default(false)
}).strict();

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

/** The declared cap; the pack route mounts its own parser above the server's 512kb global default. */
export const HOMEBREW_PACK_BODY_LIMIT = "4mb";
/** Hard record-count cap, checked before parsing so a hostile pack cannot make us do the work first. */
const MAX_PACK_RECORDS = 500;

/**
 * Publish-time validation, injected so `homebrew-validate.ts` lands without touching this file. The
 * fallback reports every record as valid, which is only ever right for a router wired with no
 * catalog to validate against (a store-only test fixture) - `server.ts` always supplies the real one.
 */
export type HomebrewValidator = (type: HomebrewContentType, body: HomebrewBody) => HomebrewValidity;
const UNVALIDATED: HomebrewValidator = () => ({ valid: true, issues: [] });

/** Reference scan over GameState, injected for the same reason (`homebrew-usages.ts`). */
export type HomebrewUsageLookup = (type: HomebrewContentType, id: string) => readonly { actorId: string; actorName: string; kind: string; detail: string | null }[];
const NO_USAGES: HomebrewUsageLookup = () => [];

/**
 * The merged GM catalog behind `/duplicate`, injected the same way. Returns the SRD (or already-
 * merged homebrew) record an id names, deep-copied, or undefined. Without it an SRD id 404s -
 * which is the whole reason duplicate-an-SRD-record has to be wired, not merely wireable.
 */
export type HomebrewCatalogLookup = (id: string) => HomebrewSourceRecord | undefined;
const NO_CATALOG: HomebrewCatalogLookup = () => undefined;

export type HomebrewRouterOptions = Readonly<{
  store: HomebrewStore;
  authorizeGm: (token: string | undefined) => boolean;
  /**
   * Present ONLY so an authenticated player gets a 403 rather than the 401 an unauthenticated caller
   * gets - never to grant access. There is no player-readable route on this router.
   */
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

/**
 * A pack record's own id, rendered so it can appear in the import report.
 *
 * `HomebrewPackImportSchema` types every `originalId` as `HomebrewIdSchema` - slug-legal and at most
 * 60 characters - but the ids that most need reporting are exactly the ones that break that rule
 * (a 200-character id, an id with a colon in it, a record with no id at all). Emitting one verbatim
 * makes the response fail the contract it is served under, so the GM would get a 500 instead of the
 * sentence explaining what happened to their record. Slugged and truncated is legible and honest;
 * silence is neither.
 */
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
  function failure(response: Response, status: number, code: ApiErrorCode, message: string, details?: Record<string, unknown>, currentRevision?: number) {
    return response.status(status).json({
      ok: false,
      apiVersion: API_VERSION,
      error: {
        code, message, requestId: response.locals.requestId ?? randomUUID(),
        ...(details ? { details } : {}),
        ...(currentRevision !== undefined ? { currentRevision } : {})
      }
    });
  }
  /** Zod issues become the same `{ path, message }` tuples publish validation emits, so failures look alike. */
  function malformed(response: Response, error: unknown) {
    if (error instanceof z.ZodError) {
      const issues: HomebrewValidationIssue[] = error.issues.map((issue) => ({ path: [...issue.path] as (string | number)[], message: issue.message, recordId: null }));
      return failure(response, 400, "validation_failed", issues[0]?.message ?? "The request is malformed.", { issues });
    }
    return failure(response, 400, "validation_failed", error instanceof Error ? error.message : "The request is malformed.");
  }
  /** One mapping for every store failure, so REST semantics stay uniform across all 13 operations. */
  function storeError(response: Response, error: unknown) {
    if (error instanceof HomebrewRevisionConflictError) return failure(response, 409, "conflict", error.message, undefined, error.currentRev);
    if (error instanceof HomebrewNotFoundError) return failure(response, 404, "not_found", error.message);
    if (error instanceof HomebrewStateError) return failure(response, 409, "conflict", error.message);
    return malformed(response, error);
  }

  /**
   * 401 for an unauthenticated caller, 403 for an authenticated player. The distinction is in the
   * contract (`homebrewOp` declares both) and it matters: a player who is told 401 will retry the
   * login they already have, while 403 says the surface is not theirs.
   */
  const requireGm = (request: Request, response: Response, next: NextFunction) => {
    const token = bearer(request);
    if (options.authorizeGm(token)) return next();
    if (options.authorizePlayer(token)) return failure(response, 403, "forbidden", "Homebrew authoring is the GM's.");
    return failure(response, 401, "unauthenticated", "A valid GM session is required.");
  };

  /**
   * The wire document. `record` is the stored body with `type` put back on it: `type` is a routing
   * discriminator that lives on the row, not inside the authored body (leaving it there would make
   * `EquipmentReferenceSchema` - the one `.strict()` content schema - reject its own record), but the
   * pack format carries a bare array of records, so every record on the wire must be self-describing.
   */
  const documentOf = (row: HomebrewRecordRow) => ({
    id: row.id, type: row.type, state: row.state, visibleToPlayers: row.visibleToPlayers,
    deletedAt: row.deletedAt, rev: row.rev, createdAt: row.createdAt, updatedAt: row.updatedAt,
    validity: validate(row.type, row.body),
    record: { ...row.body, type: row.type }
  });
  const summaryOf = (row: HomebrewSummaryRow, record: HomebrewRecordRow | undefined) => ({
    id: row.id, type: row.type, name: row.name, source: "homebrew" as const, state: row.state,
    visibleToPlayers: row.visibleToPlayers, deletedAt: row.deletedAt, rev: row.rev, updatedAt: row.updatedAt,
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
    if (!parsed.success) throw new HomebrewStateError(`"${String(record.type)}" is not one of the nine homebrew content types.`);
    return parsed.data;
  }

  // ----- The polymorphic collection -----

  router.get(route(HOMEBREW_PATHS.content), requireGm, (request, response) => {
    try {
      const filter = ListQuerySchema.parse(request.query);
      const page = store.list(filter);
      return envelope(response, 200, {
        records: page.rows.map((row) => summaryOf(row, store.get(row.id))),
        nextCursor: page.nextCursor,
        total: page.total
      });
    } catch (error) { return malformed(response, error); }
  });

  router.post(route(HOMEBREW_PATHS.content), requireGm, (request, response) => {
    try {
      const { record } = CreateSchema.parse(request.body);
      return sent(response, store.create({ type: typeOf(record), body: record }), 201);
    } catch (error) { return storeError(response, error); }
  });

  router.get(route(HOMEBREW_PATHS.contentById), requireGm, (request, response) => {
    const row = store.get(pathParam(request, "id"));
    if (!row) return failure(response, 404, "not_found", "That record was not found.");
    return envelope(response, 200, { record: documentOf(row) });
  });

  /**
   * A patch always lands - A DRAFT MAY BE INVALID, and the editor AUTOSAVES, so refusing a
   * half-typed field would make a published record uneditable. What a patch may NOT do is leave the
   * library saying "Published - shown to players" about a record that would no longer publish, so
   * the validator rides along: if the new body fails the gate, the record demotes to an invisible
   * draft inside the same transaction and the response says so (`state`, `visibleToPlayers` and
   * `validity` all change). See `HomebrewStore.update`.
   */
  router.patch(route(HOMEBREW_PATHS.contentById), requireGm, (request, response) => {
    try {
      const { record, expectedRev } = UpdateSchema.parse(request.body);
      const revalidate: HomebrewRevalidator = (type, body) => validate(type, body).valid;
      return sent(response, store.update(pathParam(request, "id"), record, expectedRev, "gm", revalidate));
    } catch (error) { return storeError(response, error); }
  });

  // Idempotent by contract: an unknown or already-deleted id is still a 200, so a retried delete is
  // not a different answer. Soft delete only - the row leaves both catalogs but keeps its data.
  router.delete(route(HOMEBREW_PATHS.contentById), requireGm, (request, response) => {
    const id = pathParam(request, "id");
    const deleted = store.softDelete(id);
    if (deleted) options.notifyChanged();
    return envelope(response, 200, deleted ? { id: deleted.id, deleted: true, deletedAt: deleted.deletedAt } : { id, deleted: true, deletedAt: new Date().toISOString() });
  });

  router.post(route(HOMEBREW_PATHS.contentRestore), requireGm, (request, response) => {
    try { return sent(response, store.restore(pathParam(request, "id"))); }
    catch (error) { return storeError(response, error); }
  });

  /**
   * Duplicate. The source may be a HOMEBREW row or an SRD CATALOG RECORD, and the second is not a
   * nicety: a `ClassReference` carries a mandatory twenty-row level table plus its full feature list,
   * so "duplicate Wizard and edit it" is what makes authoring a class possible at all. Both land as
   * fresh, invisible drafts under a newly minted id.
   *
   * The homebrew row is tried first because a homebrew record can never be shadowed by an SRD id -
   * `hb-` is a reserved prefix - so the branch is unambiguous in both directions.
   */
  router.post(route(HOMEBREW_PATHS.contentDuplicate), requireGm, (request, response) => {
    try {
      const { name } = DuplicateSchema.parse(request.body ?? {});
      const id = pathParam(request, "id");
      if (store.get(id)) return sent(response, store.duplicate(id, name), 201);

      const source = catalogRecord(id);
      if (!source) return failure(response, 404, "not_found", "That record was not found.");
      const copied = copyName(name ?? String((source.body as { name?: unknown }).name ?? id));
      // The id is minted BEFORE the rewrite because the rewrite needs it: a species' lineage pick and
      // a class's subclass pick are both derived from the record's own id, so a copy that kept the
      // source's slug would silently keep reading the SOURCE record's rows. See `homebrew-srd-copy.ts`.
      const mintedId = mintHomebrewId(source.type, copied, (candidate) => store.get(candidate) !== undefined);
      const body = rewriteForNewId(source.type, { ...source.body, name: copied }, id, mintedId);
      return sent(response, store.importRecord(mintedId, source.type, body, false, "homebrew:duplicate"), 201);
    } catch (error) { return storeError(response, error); }
  });

  /**
   * Publishing requires validity. SLICE 1 has no validator, so nothing is refused yet; when
   * `homebrew-validate.ts` lands it plugs in through `options.validate` and this branch starts
   * biting with no other change. The refusal is a 409, not a 400: the REQUEST is well-formed, it is
   * the stored draft that refuses the transition.
   */
  router.post(route(HOMEBREW_PATHS.contentPublish), requireGm, (request, response) => {
    try {
      const { expectedRev } = StateChangeSchema.parse(request.body ?? {});
      const id = pathParam(request, "id");
      const existing = store.get(id);
      if (!existing) return failure(response, 404, "not_found", "That record was not found.");
      const validity = validate(existing.type, existing.body);
      if (!validity.valid) return failure(response, 409, "conflict", "This draft cannot be published until it is valid.", { invalid: { issues: validity.issues } });
      return sent(response, store.setState(id, "published", expectedRev));
    } catch (error) { return storeError(response, error); }
  });

  router.post(route(HOMEBREW_PATHS.contentUnpublish), requireGm, (request, response) => {
    try {
      const { expectedRev } = StateChangeSchema.parse(request.body ?? {});
      return sent(response, store.setState(pathParam(request, "id"), "draft", expectedRev));
    } catch (error) { return storeError(response, error); }
  });

  router.post(route(HOMEBREW_PATHS.contentVisibility), requireGm, (request, response) => {
    try {
      const { visibleToPlayers, expectedRev } = VisibilitySchema.parse(request.body);
      return sent(response, store.setVisibility(pathParam(request, "id"), visibleToPlayers, expectedRev));
    } catch (error) { return storeError(response, error); }
  });

  /**
   * `safeToDelete` is always true and says so calmly: `buildCharacterDefinition` writes a flattened,
   * self-contained `ActorDefinition`, so deleting a homebrew record never breaks a built character.
   * The count is informational. (Monsters are the one type where edits DO reach live instances -
   * their actions are late-bound - which the monster editor warns about separately in slice 3.)
   */
  router.get(route(HOMEBREW_PATHS.contentUsages), requireGm, (request, response) => {
    const id = pathParam(request, "id");
    const row = store.get(id);
    if (!row) return failure(response, 404, "not_found", "That record was not found.");
    return envelope(response, 200, { id, usages: usagesOf(row.type, id), safeToDelete: true });
  });

  // ----- Packs (GM-to-GM interchange) -----

  /**
   * Published, non-deleted records as authored bodies only - no `state`, `visibleToPlayers`,
   * `deletedAt` or `rev` - so an importing table can never inherit this one's visibility policy.
   */
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
          schemaId: "vtt.homebrew-pack", schemaVersion: 1,
          name: "Homebrew", attribution: null, exportedAt: new Date().toISOString(),
          records: rows.map((row) => ({ ...row.body, type: row.type }))
        }
      });
    } catch (error) { return malformed(response, error); }
  });

  /**
   * SLICE 1 SCOPE. Collision policy and the draft landing are implemented; CROSS-REFERENCE REWRITING
   * IS NOT. Re-minting a class id invalidates every id derived from it (`subclass.classId`,
   * `<classId>-subclasses`, `spellcasting.spellListId`, `startingEquipment[].items[].id`, ...), and
   * rewriting those needs typed bodies, which arrive with the merge. Until `homebrew-pack.ts` lands
   * (slice 9) a re-minted record's inbound references are left as the author wrote them.
   *
   * That is safe here and nowhere else: everything lands as an invisible draft, drafts are in no
   * merged catalog for any audience, and publishing is gated on validation that will catch a
   * dangling reference. Importing an invalid pack is therefore harmless rather than silently wrong.
   *
   * TWO THINGS THE LANDING MUST NEVER DO, both learned the hard way:
   *   1. LAND AT AN ID THAT CAN NEVER PUBLISH. An id outside our shapes was stored verbatim, so
   *      `wizard`, `fire-bolt`, `my-list-spells` and a 200-character id each produced a row that
   *      failed the gate's identity tier forever, with `reminted` and `rejected` both empty. Every
   *      id is now checked against `isMintedHomebrewId` for its own type, and re-minting is reported.
   *   2. CHANGE A LIVE RECORD BEHIND THE GM'S BACK. `overwrite` used to unpublish, un-share and
   *      un-delete whatever it landed on without a word - players lost content mid-session and a
   *      deleted record walked back in. Overwrite now replaces a live DRAFT only; anything else is
   *      refused into `rejected` with the two ways out, in the dry run identically.
   */
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
      // Ids claimed earlier in THIS pack count as taken, so two records cannot land on one row.
      const claimed = new Set<string>();

      for (const record of pack.records) {
        const originalId = typeof record.id === "string" ? record.id : "";
        const reportedId = reportableId(originalId);
        try {
          const type = typeOf(record);
          // `recordName`, the same check the write itself makes, rather than a lenient local read of
          // `record.name`. A nameless record used to sail through a DRY RUN into `imported` with
          // `name: ""` - which the contract's own `min(1)` rejects, so the preview 500'd on a pack
          // the apply path would have reported cleanly. Dry run and apply now answer identically.
          const name = recordName(record);
          // ANY id that is not one of OUR shapes for THIS type is re-minted, not just an `hb-` one.
          // Storing a foreign id verbatim produced a row that could never publish for as long as it
          // existed - `wizard`, `fire-bolt`, `my-list-spells` and a 200-character id all fail the
          // gate's identity tier - and the import reported nothing at all about it.
          const foreign = originalId !== "" && !isMintedHomebrewId(originalId, type);
          const heldRow = originalId === "" ? undefined : store.get(originalId);
          const held = heldRow !== undefined;
          const overwrite = held && !foreign && onIdCollision === "overwrite";
          // Checked HERE and not only in the store, because a dry run writes nothing and the
          // contract promises the dry-run report is the same report.
          const refusal = overwrite && heldRow ? overwriteRefusal(heldRow) : null;
          if (refusal) throw new HomebrewStateError(refusal);
          const needsMint = originalId === "" || foreign || claimed.has(originalId) || (held && !overwrite);
          const id = needsMint ? mintHomebrewId(type, name, (candidate) => claimed.has(candidate) || store.get(candidate) !== undefined) : originalId;
          // The two reasons the contract allows, assigned by the NAMESPACE the id came from rather
          // than by guesswork: everything outside `hb-` lives in the bundle's namespace, which is
          // reserved against us whether or not a bundled record happens to sit on that exact id;
          // everything inside it is ours, held or misshapen. (A third reason - "not our shape" -
          // would be more honest for `my-list-spells`; the enum is frozen in the contract.)
          if (needsMint && originalId !== "") {
            reminted.push({ originalId: reportedId, id, reason: originalId.startsWith(HOMEBREW_ID_PREFIX) ? "homebrew-collision" : "srd-collision" });
          }
          claimed.add(id);
          if (!dryRun) store.importRecord(id, type, record, overwrite);
          if (overwrite) overwritten.push({ id, type, name });
          imported.push({ id, type, name, originalId: originalId === "" ? id : reportedId });
        } catch (error) {
          rejected.push({ originalId: reportedId, issues: [{ path: [], message: error instanceof Error ? error.message : "That record could not be imported.", recordId: null }] });
        }
      }
      if (!dryRun && imported.length > 0) options.notifyChanged();
      return envelope(response, 200, { imported, reminted, overwritten, rejected, dryRun });
    } catch (error) { return storeError(response, error); }
  });

  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    return failure(response, 500, "internal_error", error instanceof Error ? error.message : "The homebrew request failed.");
  });
  return router;
}

/**
 * The pack-import body parser. Mounted in `server.ts` ABOVE the global `express.json({limit:"512kb"})`
 * because body-parser marks a request parsed and every later parser skips it - so a route-scoped
 * limit only works if it runs first. A pack larger than this dies in the global error handler as a
 * 413, which is what the contract documents.
 */
export function homebrewPackBodyParser() {
  return express.json({ limit: HOMEBREW_PACK_BODY_LIMIT });
}
export const HOMEBREW_PACK_IMPORT_PATH = HOMEBREW_PATHS.packsImport;
