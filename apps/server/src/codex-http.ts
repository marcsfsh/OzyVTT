import { createHash, randomUUID } from "node:crypto";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { API_VERSION } from "@vtt/api-contract";
import type { MapAssetStore } from "./map-assets.js";
import {
  CODEX_BUNDLE_VERSION,
  CodexNotFoundError,
  CodexRevisionConflictError,
  CodexValidationError,
  type CodexSearchRef,
  type CodexStore
} from "./codex-store.js";
import {
  projectGmCalendar,
  projectGmChronicleRecord,
  projectGmConnections,
  projectGmJournalEntry,
  projectGmMap,
  projectGmMarker,
  projectGmPage,
  projectGmPageConnections,
  projectGmPageSummary,
  projectGmQuest,
  projectGmSearchHit,
  projectGmSession,
  projectGmStanding,
  projectPlayerCalendar,
  projectPlayerChronicleRecord,
  projectPlayerConnections,
  projectPlayerJournalEntry,
  projectPlayerMap,
  projectPlayerMarker,
  projectPlayerPage,
  projectPlayerPageConnections,
  projectPlayerPageMarker,
  projectPlayerPageSummary,
  projectPlayerQuest,
  projectPlayerSearchHit,
  projectPlayerSession,
  projectPlayerStanding,
  projectRevealAudit,
  type CodexRevealAuditRecord,
  type CodexSearchRecord,
  type PlayerConnectionContext,
  type PlayerSessionNumberContext
} from "./codex-projections.js";

/**
 * The Codex REST surface (`/api/v1/codex/*`), outside the GameState broadcast. Writes bump the store revision and
 * ping `notifyChanged`; reads branch on role and project through `codex-projections.ts`.
 */

const CODEX_BASE = "/api/v1/codex";

const TagsSchema = z.array(z.string().trim().min(1).max(40)).max(24);
/** Optional idempotency key on JSON-body writes, stripped before the store. Body-less POSTs and DELETEs are naturally idempotent. */
const CommandIdSchema = z.string().uuid().optional();
/** A raw in-world date, shared by the journal and page schemas so both accept the same bounds. */
const InWorldDateFields = z.object({
  year: z.number().int().min(-100_000).max(100_000),
  month: z.number().int().min(0).max(23),
  day: z.number().int().min(1).max(400)
});
const InWorldDateSchema = InWorldDateFields.nullable();
const EntityTypeSchema = z.enum(["note", "character", "location", "faction", "item", "species", "religion", "event"]);
const FieldsSchema = z.record(z.string().max(40), z.string().max(2000));
const PageCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    entityType: EntityTypeSchema.optional(),
    fields: FieldsSchema.optional(),
    gmFields: FieldsSchema.optional(),
    folder: z.string().max(160).nullable().optional(),
    tags: TagsSchema.optional(),
    playerBody: z.string().max(100_000).optional(),
    gmBody: z.string().max(100_000).optional(),
    revealedToPlayers: z.boolean().optional(),
    bannerAssetId: z.string().uuid().nullable().optional(),
    /** What places an `event` page on the chronicle. Omitted = unchanged/undated; `null` = clear the date. */
    inWorldDate: InWorldDateSchema.optional(),
    commandId: CommandIdSchema
  })
  .strict();
const PageUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    entityType: EntityTypeSchema.optional(),
    fields: FieldsSchema.optional(),
    gmFields: FieldsSchema.optional(),
    folder: z.string().max(160).nullable().optional(),
    tags: TagsSchema.optional(),
    playerBody: z.string().max(100_000).optional(),
    gmBody: z.string().max(100_000).optional(),
    bannerAssetId: z.string().uuid().nullable().optional(),
    inWorldDate: InWorldDateSchema.optional(),
    expectedRev: z.number().int().nonnegative().optional(),
    commandId: CommandIdSchema
  })
  .strict();
/** `label` is optional: an unlabelled connection just means "related", as a `[[wiki link]]` does. */
const ConnectionCreateSchema = z
  .object({
    toPageId: z.string().uuid(),
    label: z.string().trim().max(40).nullable().optional(),
    layer: z.enum(["player", "gm"]).optional(),
    commandId: CommandIdSchema
  })
  .strict();
/** Relabel or re-layer a declared connection. An omitted field is left alone. */
const ConnectionUpdateSchema = z
  .object({
    label: z.string().trim().max(40).nullable().optional(),
    layer: z.enum(["player", "gm"]).optional(),
    commandId: CommandIdSchema
  })
  .strict();
const RevealSchema = z.object({ revealed: z.boolean(), commandId: CommandIdSchema }).strict();
const FolderMoveSchema = z
  .object({ from: z.string().trim().min(1).max(160), to: z.string().trim().max(160), commandId: CommandIdSchema })
  .strict();
const FolderPathSchema = z.object({ path: z.string().trim().min(1).max(160), commandId: CommandIdSchema }).strict();

const MapKindSchema = z.enum(["battlemap", "regional", "world"]);
const MapCreateSchema = z
  .object({
    assetId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    kind: MapKindSchema,
    parentMapId: z.string().uuid().nullable().optional(),
    revealedToPlayers: z.boolean().optional(),
    tags: TagsSchema.optional(),
    commandId: CommandIdSchema
  })
  .strict();
const MapUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    kind: MapKindSchema.optional(),
    tags: TagsSchema.optional(),
    commandId: CommandIdSchema
  })
  .strict();
const MapParentSchema = z.object({ parentMapId: z.string().uuid().nullable(), commandId: CommandIdSchema }).strict();

const Coord = z.number().finite().min(0).max(1_000_000);
const IconColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const IconId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/)
  .max(60);
const MarkerLinks = {
  pageIds: z.array(z.string().uuid()).max(24).optional(),
  subMapId: z.string().uuid().nullable().optional(),
  sceneIds: z.array(z.string().uuid()).max(24).optional(),
  actorId: z.string().uuid().nullable().optional()
};
const MarkerCreateSchema = z
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
const MarkerUpdateSchema = z
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
const MarkerMoveSchema = z.object({ x: Coord, y: Coord, commandId: CommandIdSchema }).strict();
/** Only the flag: the party marker is an ordinary marker, moved via `POST /markers/{id}/move`. */
const MarkerPartySchema = z.object({ isParty: z.boolean(), commandId: CommandIdSchema }).strict();

const JournalWriteSchema = z
  .object({
    tags: TagsSchema.optional(),
    playerText: z.string().max(20_000).optional(),
    gmText: z.string().max(20_000).nullable().optional(),
    revealedToPlayers: z.boolean().optional(),
    attachMarkerId: z.string().uuid().nullable().optional(),
    attachPageId: z.string().uuid().nullable().optional(),
    /** By id only (`sessionNumber` is server-resolved and rejected). Omitted on create: active session; `null`: none; unknown: 404. */
    sessionId: z.string().uuid().nullable().optional(),
    realDate: z.string().max(40).nullable().optional(),
    inWorldLabel: z.string().max(120).nullable().optional(),
    inWorldDate: InWorldDateSchema.optional(),
    commandId: CommandIdSchema
  })
  .strict();
/** A deadline requires `inWorldDate`, since `fired` derives from it. */
const DeadlineCreateSchema = JournalWriteSchema.extend({ inWorldDate: InWorldDateFields });
/** `applied` is not an input (only `apply-downtime` moves the clock). `who`/`activity` may be blank for party-wide downtime. */
const DowntimeInputSchema = z
  .object({
    who: z.string().trim().max(120),
    activity: z.string().trim().max(120),
    days: z.number().int().min(0).max(3650),
    /** Links the tracker to a person rather than a spelling; unknown ids 404, page type is not checked. */
    characterPageId: z.string().uuid().nullable().optional()
  })
  .strict();
const DowntimeCreateSchema = JournalWriteSchema.extend({ downtime: DowntimeInputSchema });
/** `days` is not editable (the clock already moved by it); `.strict()` rejects it. */
const JournalUpdateSchema = JournalWriteSchema.extend({
  downtime: z
    .object({
      who: z.string().trim().max(120).optional(),
      activity: z.string().trim().max(120).optional(),
      characterPageId: z.string().uuid().nullable().optional()
    })
    .strict()
    .optional()
});
/** `level` uses the 1-20 character-level bound; `reason` may be blank. */
const MilestoneInputSchema = z
  .object({
    level: z.number().int().min(1).max(20),
    reason: z.string().trim().max(120).default("")
  })
  .strict();
const MilestoneCreateSchema = JournalWriteSchema.extend({ milestone: MilestoneInputSchema });
/** Sessions. `sessionNumber` uses the journal's bounds because a journal entry resolves against it. */
const SessionNumberSchema = z.number().int().min(0).max(100_000).nullable();
const AttendeesSchema = z.array(z.string().trim().min(1).max(40)).max(24);
const SessionStatusSchema = z.enum(["planned", "played"]);
/** Scene attachments, capped at the table's own scene cap. */
const SessionSceneIdsSchema = z.array(z.string().uuid()).max(20);
const SessionCreateSchema = z
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
const SessionUpdateSchema = z
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
const ObjectiveSchema = z.object({ text: z.string().max(120), done: z.boolean() }).strict();
const ObjectivesSchema = z.array(ObjectiveSchema).max(24);
const QuestEntityIdsSchema = z.array(z.string().uuid()).max(24);
const QuestCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    status: QuestStatusSchema.optional(),
    playerBody: z.string().max(100_000).optional(),
    gmBody: z.string().max(100_000).optional(),
    objectives: ObjectivesSchema.optional(),
    entityIds: QuestEntityIdsSchema.optional(),
    revealedToPlayers: z.boolean().optional(),
    tags: TagsSchema.optional(),
    commandId: CommandIdSchema
  })
  .strict();
/** No `revealedToPlayers`: reveal is its own route, so a PATCH cannot publish a quest as a side effect of an edit. */
const QuestUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    status: QuestStatusSchema.optional(),
    playerBody: z.string().max(100_000).optional(),
    gmBody: z.string().max(100_000).optional(),
    objectives: ObjectivesSchema.optional(),
    entityIds: QuestEntityIdsSchema.optional(),
    tags: TagsSchema.optional(),
    expectedRev: z.number().int().nonnegative().optional(),
    commandId: CommandIdSchema
  })
  .strict();
/** Signed -100..100; rejected here when out of range, clamped by the store for other writers. `reason` may be blank. */
const StandingSetSchema = z
  .object({
    value: z.number().int().min(-100).max(100),
    reason: z.string().trim().max(120).default(""),
    commandId: CommandIdSchema
  })
  .strict();
/** Out-of-range `windowMinutes` is rejected; a fraction in range (a slider artefact) is truncated by the store. */
const CodexSettingsSchema = z
  .object({
    revisionHistory: z
      .object({
        enabled: z.boolean(),
        windowMinutes: z.number().min(0).max(10_080)
      })
      .strict(),
    /** In seconds, same rules as `windowMinutes`. Required: this PUT is wholesale, so an omitted group would reset it. */
    autosave: z
      .object({
        enabled: z.boolean(),
        intervalSeconds: z.number().min(1).max(600)
      })
      .strict(),
    commandId: CommandIdSchema
  })
  .strict();
/** The Codex's one destructive route, so bad values are rejected, not clamped; the max matches the store's `MAX_PRUNE_DAYS`. */
const RevisionsDeleteSchema = z.object({ olderThanDays: z.number().int().min(0).max(36_500) }).strict();
/** A saved export's `data`, posted back unedited. A missing `bundleVersion` is an older v1 backup; other versions are refused. */
const CodexImportSchema = z
  .object({
    codex: z.record(z.string(), z.unknown()),
    bundleVersion: z
      .number()
      .int()
      .refine((value) => value === CODEX_BUNDLE_VERSION, {
        message: "This backup was made by a newer version of the app. Update, then restore."
      })
      .optional(),
    exportedAt: z.string().optional(),
    commandId: CommandIdSchema
  })
  .strict();
const CalendarSchema = z
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

/** `gm` and `integration` both read at GM grade. `none` = no bearer token (401); `denied` = a token that failed (403). */
type CodexPrincipal = Readonly<{ kind: "gm" | "player" | "integration" | "none" | "denied" }>;
type CodexGrade = "gm" | "player";

type CodexRouterOptions = Readonly<{
  store: CodexStore;
  /** Content-addressed store for page media (banners + inline images), separate from map/token assets. */
  assets: MapAssetStore;
  authorizeGm: (token: string | undefined) => boolean;
  authorizePlayer: (token: string | undefined) => boolean;
  /** Null for any unusable token (one 403 for all). Required so no mount site silently disables credentials. */
  verifyIntegration: (
    token: string,
    scope: "codex:read" | "codex:write"
  ) => Readonly<{ id: string; name: string }> | null;
  /** Emit a content-free `codex:changed` ping so every client refetches its projected view. */
  notifyChanged: () => void;
  /** A real player token for the GM's preview: the GM's own token would still get GM projections. */
  issuePreviewSession: () => string;
}>;

const CODEX_ASSET_BASE = "/api/v1/codex-assets";

function bearer(request: Request): string | undefined {
  return request.header("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
}
/** Strip the idempotency key before a parsed body reaches the store, which knows nothing of retries. */
function withoutCommandId<T extends { commandId?: string }>(input: T): Omit<T, "commandId"> {
  const { commandId, ...rest } = input;
  void commandId;
  return rest;
}
/** `ETag` resource fingerprint: path plus sorted query. A collision only costs a 200, never a wrong 304. */
function resourceKey(request: Request): string {
  const [path, rawQuery = ""] = request.originalUrl.split("?");
  const query = [...new URLSearchParams(rawQuery)]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return createHash("sha1").update(`${path}?${query}`).digest("hex").slice(0, 12);
}
function pathParam(request: Request, name: string): string {
  const value = request.params[name];
  return typeof value === "string" ? value : "";
}
function envelope(response: Response, status: number, data: unknown) {
  return response.status(status).json({ ok: true, apiVersion: API_VERSION, data });
}
/** `details` and `currentRevision` are omitted when absent: the schema makes them optional, not nullable. */
function failure(
  response: Response,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
  currentRevision?: number
) {
  const id =
    typeof response.locals.requestId === "string"
      ? response.locals.requestId
      : (response.getHeader("x-request-id")?.toString() ?? randomUUID());
  return response.status(status).json({
    ok: false,
    apiVersion: API_VERSION,
    error: {
      code,
      message,
      requestId: id,
      ...(details ? { details } : {}),
      ...(currentRevision !== undefined ? { currentRevision } : {})
    }
  });
}
/** Only `ZodError` and `CodexValidationError` are the caller's fault; anything else is a sanitized 500 (no driver text leaks). */
function malformed(response: Response, error: unknown) {
  if (error instanceof z.ZodError) {
    return failure(response, 400, "validation_failed", error.issues[0]?.message ?? "The request is malformed.", {
      issues: error.issues.map((issue) => ({ path: [...issue.path], message: issue.message }))
    });
  }
  if (error instanceof CodexValidationError) return failure(response, 400, "validation_failed", error.message);
  console.error("codex request failed:", error);
  return failure(response, 500, "internal_error", "The codex request failed.");
}
/** `currentRevision` is supplied only where a 409 can be a stale `expectedRev`, so its presence means "rebase and retry". */
function codexError(response: Response, error: unknown, currentRevision?: () => number | undefined) {
  if (error instanceof CodexRevisionConflictError)
    return failure(response, 409, "conflict", error.message, undefined, currentRevision?.());
  if (error instanceof CodexNotFoundError) return failure(response, 404, "not_found", error.message);
  return malformed(response, error);
}

/** A search hit's live record plus its player context (a marker needs its map's reveal flag). Null if the record is gone. */
function loadSearchRecord(store: CodexStore, ref: CodexSearchRef): CodexSearchRecord | null {
  switch (ref.kind) {
    case "page": {
      const page = store.getPage(ref.id);
      return page ? { kind: "page", page } : null;
    }
    case "journal": {
      const entry = store.getEntry(ref.id);
      return entry ? { kind: "journal", entry } : null;
    }
    case "map": {
      const map = store.getMap(ref.id);
      return map ? { kind: "map", map } : null;
    }
    case "marker": {
      const marker = store.getMarker(ref.id);
      if (!marker) return null;
      return { kind: "marker", marker, mapRevealed: store.getMap(marker.mapId)?.revealedToPlayers ?? false };
    }
    // A quest's own reveal flag is its whole player predicate, and a hit carries no entity links.
    case "quest": {
      const quest = store.getQuest(ref.id);
      return quest ? { kind: "quest", quest } : null;
    }
    // Likewise for a session.
    case "session": {
      const session = store.getSession(ref.id);
      return session ? { kind: "session", session } : null;
    }
  }
}

/** The revealed subset of a record's linked page ids (missing pages count as unrevealed). */
function revealedPageIdsIn(store: CodexStore, pageIds: readonly string[]): ReadonlySet<string> {
  return new Set(pageIds.filter((pageId) => store.getPage(pageId)?.revealedToPlayers ?? false));
}

/** Is this page revealed? The one-page form of `revealedPageIdsIn`, so the predicate is written once. */
function pageRevealedFor(store: CodexStore, pageId: string): boolean {
  return revealedPageIdsIn(store, [pageId]).has(pageId);
}

/** Player journal context, resolved once per request; GM reads never call it. */
function playerSessionNumbers(store: CodexStore): PlayerSessionNumberContext {
  // Resolved here so every player journal surface gets the standing gate. Candidates are the pages a
  // payload can name (standing factions, downtime characters); anything else fails closed.
  const downtimePages = store.downtimeCharacterPageIds();
  return {
    unrevealedSessionIds: store.unrevealedSessionIds(),
    // Every quest is a candidate, since any may appear in history; unlisted quests fail closed.
    revealedQuestIds: new Set(
      store
        .listQuests()
        .filter((quest) => quest.revealedToPlayers)
        .map((quest) => quest.id)
    ),
    revealedPageIds: revealedPageIdsIn(store, [
      ...store.listStanding().map((row) => row.factionPageId),
      ...downtimePages
    ])
  };
}

/**
 * Context for `projectPlayerConnections`. Non-page sources are resolved through their own player projection,
 * not their reveal flag, so a connection never bypasses the gates the list endpoints apply.
 */
function playerConnectionContext(store: CodexStore): PlayerConnectionContext {
  const revealedPageIds = new Set(
    store
      .listPages()
      .filter((page) => page.revealedToPlayers)
      .map((page) => page.id)
  );
  const revealedSourceIds = new Set<string>();
  for (const session of store.listSessions()) if (session.revealedToPlayers) revealedSourceIds.add(session.id);
  for (const quest of store.listQuests()) if (quest.revealedToPlayers) revealedSourceIds.add(quest.id);
  const journalContext = playerSessionNumbers(store);
  for (const entry of store.listTimeline())
    if (projectPlayerJournalEntry(entry, journalContext) !== null) revealedSourceIds.add(entry.id);
  return { revealedPageIds, revealedSourceIds };
}

const NO_TOKEN = "A GM session, player session, or integration bearer token is required.";
const BAD_TOKEN = "The token is invalid, revoked, or missing the required scope.";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Just the three authorization callbacks, so the import guard is built from the same ones the router gets. */
export type CodexAuthOptions = Pick<CodexRouterOptions, "authorizeGm" | "authorizePlayer" | "verifyIntegration">;

/** Honour a caller's UUID v4 request id, else mint one; never echo arbitrary text into logs. Idempotent. */
function codexRequestConventions(request: Request, response: Response, next: NextFunction) {
  if (typeof response.locals.requestId !== "string") {
    const supplied = request.header("x-request-id");
    response.locals.requestId = supplied && UUID_V4.test(supplied) ? supplied : randomUUID();
  }
  response.setHeader("x-request-id", response.locals.requestId as string);
  response.setHeader("cache-control", "no-store");
  next();
}

/**
 * Who is calling: role comes only from the signed session token or verified credential, checked GM, then
 * player, then credential. Memoized per request because `IntegrationCredentialStore.verify` writes audit rows.
 */
function principalFor(
  request: Request,
  response: Response,
  options: CodexAuthOptions,
  scope: "codex:read" | "codex:write"
): CodexPrincipal {
  const cached = response.locals.codexPrincipal as Readonly<{ scope: string; principal: CodexPrincipal }> | undefined;
  if (cached && cached.scope === scope) return cached.principal;
  const token = bearer(request);
  const principal: CodexPrincipal =
    token === undefined
      ? { kind: "none" }
      : options.authorizeGm(token)
        ? { kind: "gm" }
        : options.authorizePlayer(token)
          ? { kind: "player" }
          : options.verifyIntegration(token, scope)
            ? { kind: "integration" }
            : { kind: "denied" };
  response.locals.codexPrincipal = { scope, principal };
  return principal;
}

/** The one refusal a Codex write can get, shared by the router and the import guard. */
function refuseWrite(response: Response, principal: CodexPrincipal) {
  if (principal.kind === "none") return failure(response, 401, "unauthenticated", NO_TOKEN);
  if (principal.kind === "player") return failure(response, 403, "forbidden", "Codex writes are the GM's.");
  return failure(response, 403, "forbidden", BAD_TOKEN);
}

/**
 * Authorization for `POST /codex/import`, mounted ahead of its 64 MB body parser so an unauthenticated caller
 * cannot block the game's event loop with huge parses. Same `principalFor`/`refuseWrite` policy as the router.
 */
export function createCodexImportGuard(options: CodexAuthOptions) {
  return [
    codexRequestConventions,
    (request: Request, response: Response, next: NextFunction) => {
      const principal = principalFor(request, response, options, "codex:write");
      if (principal.kind === "gm" || principal.kind === "integration") return next();
      return refuseWrite(response, principal);
    }
  ];
}

export function createCodexRouter(options: CodexRouterOptions) {
  const router = Router();
  const { store } = options;

  router.use(codexRequestConventions);

  /** The projection grade for a read, or null once a 401/403 has been sent. Credentials read at GM grade. */
  const readGrade = (request: Request, response: Response): CodexGrade | null => {
    const principal = principalFor(request, response, options, "codex:read");
    if (principal.kind === "gm" || principal.kind === "integration") return "gm";
    if (principal.kind === "player") return "player";
    if (principal.kind === "none") {
      failure(response, 401, "unauthenticated", NO_TOKEN);
      return null;
    }
    failure(response, 403, "forbidden", BAD_TOKEN);
    return null;
  };

  /** GM-grade reads: folders, revision history, settings, the reveal audit, export. No player branch. */
  const requireGmRead = (request: Request, response: Response, next: NextFunction) => {
    const principal = principalFor(request, response, options, "codex:read");
    if (principal.kind === "gm" || principal.kind === "integration") return next();
    if (principal.kind === "none") return failure(response, 401, "unauthenticated", NO_TOKEN);
    if (principal.kind === "player")
      return failure(response, 403, "forbidden", "The codex's GM surfaces are the GM's.");
    return failure(response, 403, "forbidden", BAD_TOKEN);
  };

  /**
   * `commandId` idempotency: a resent id replays the stored 2xx status and body (`x-idempotent-replay`). Runs
   * after authorization, records only after a successful response, and refuses an id reused for another
   * method/path. Returns true when it has already answered.
   */
  const idempotency = (request: Request, response: Response): boolean => {
    const supplied = (request.body as { commandId?: unknown } | undefined)?.commandId;
    if (typeof supplied !== "string" || request.method === "DELETE") return false;
    const fingerprint = `${request.method} ${request.baseUrl}${request.path}`;
    const replay = store.recallCommand(supplied);
    if (replay) {
      if (replay.fingerprint !== null && replay.fingerprint !== fingerprint) {
        failure(
          response,
          400,
          "validation_failed",
          "That commandId was already used for a different request. An idempotency key identifies one request, so retries must resend the same one and a new request needs a new key."
        );
        return true;
      }
      response.setHeader("x-idempotent-replay", "true");
      response.status(replay.status).json(replay.body);
      return true;
    }
    const send = response.json.bind(response);
    response.json = (payload: unknown) => {
      if (response.statusCode >= 200 && response.statusCode < 300)
        store.recordCommand(supplied, response.statusCode, payload, fingerprint);
      return send(payload);
    };
    return false;
  };

  /** Every write. A player session gets 403, not 401: they are authenticated, and they are refused. */
  const requireWrite = (request: Request, response: Response, next: NextFunction) => {
    const principal = principalFor(request, response, options, "codex:write");
    // Idempotency runs inside the guard, so it is always after authorization.
    if (principal.kind === "gm" || principal.kind === "integration")
      return idempotency(request, response) ? undefined : next();
    return refuseWrite(response, principal);
  };

  /** Minting a player session token is GM-session only; a credential must not hand out player sessions. */
  const requireGmSession = (request: Request, response: Response, next: NextFunction) => {
    const token = bearer(request);
    if (token === undefined) return failure(response, 401, "unauthenticated", "A valid GM session is required.");
    if (!options.authorizeGm(token))
      return failure(response, 403, "forbidden", "Only a GM session may mint a player preview.");
    next();
  };

  /**
   * Weak `ETag` of store revision (every write bumps it), grade and resource, with a 304 on match. Called only
   * after every auth and existence gate, so a 304 never confirms that a hidden record exists.
   */
  const readEnvelope = (request: Request, response: Response, grade: CodexGrade, data: unknown) => {
    const etag = `W/"codex-r${store.revision}-${grade}-${resourceKey(request)}"`;
    response.setHeader("etag", etag);
    if (request.header("if-none-match") === etag) return response.status(304).end();
    return envelope(response, 200, data);
  };

  // Pages: list and search (GM or player; players see only revealed)

  router.get(`${CODEX_BASE}/pages`, (request, response) => {
    const role = readGrade(request, response);

    if (!role) return;
    const filter = {
      folder:
        request.query.folder === undefined
          ? undefined
          : request.query.folder === ""
            ? null
            : String(request.query.folder),
      tag: request.query.tag === undefined ? undefined : String(request.query.tag)
    };
    const rows = store.listPages(filter);
    const pages =
      role === "gm"
        ? rows.map(projectGmPageSummary)
        : rows.map(projectPlayerPageSummary).filter((page) => page !== null);
    return readEnvelope(request, response, role, { pages });
  });

  /** The single search route: one result list (`hits`) across all record kinds, discriminated by `kind`. */
  router.get(`${CODEX_BASE}/search`, (request, response) => {
    const role = readGrade(request, response);

    if (!role) return;
    const query = typeof request.query.q === "string" ? request.query.q : "";
    // Resolved for both roles: cheap, and a conditional here would make forgetting it a leak.
    const playerContext = playerSessionNumbers(store);
    const found = store.searchAll(role, query);
    const hits = found.hits
      .map((ref) => loadSearchRecord(store, ref))
      .filter((record) => record !== null)
      .map((record) => (role === "gm" ? projectGmSearchHit(record) : projectPlayerSearchHit(record, playerContext)))
      .filter((hit) => hit !== null);
    // `truncated` is measured before projection, so it means the search itself was cut off.
    return readEnvelope(request, response, role, { hits, truncated: found.truncated });
  });

  router.get(`${CODEX_BASE}/pages/:id`, (request, response) => {
    const role = readGrade(request, response);

    if (!role) return;
    const page = store.getPage(pathParam(request, "id"));
    if (!page) return failure(response, 404, "not_found", "That page was not found.");
    // One `connections` list per page, covering declared and mention edges.
    if (role === "gm")
      return readEnvelope(request, response, role, {
        page: projectGmPage(page),
        connections: projectGmPageConnections(store.connectionsForPage(page.id))
      });
    const projected = projectPlayerPage(page);
    if (!projected) return failure(response, 404, "not_found", "That page was not found.");
    // The same context as the graph feed, so the panel and graph are gated by one predicate.
    return readEnvelope(request, response, role, {
      page: projected,
      connections: projectPlayerPageConnections(store.connectionsForPage(page.id), playerConnectionContext(store))
    });
  });

  // Pages: authoring (GM only)

  router.post(`${CODEX_BASE}/pages`, requireWrite, (request, response) => {
    try {
      const input = PageCreateSchema.parse(request.body);
      const page = store.createPage(withoutCommandId(input));
      options.notifyChanged();
      return envelope(response, 201, { page: projectGmPage(page) });
    } catch (error) {
      return malformed(response, error);
    }
  });

  router.patch(`${CODEX_BASE}/pages/:id`, requireWrite, (request, response) => {
    try {
      const { expectedRev, commandId, ...fields } = PageUpdateSchema.parse(request.body);
      void commandId;
      const page = store.updatePage(pathParam(request, "id"), fields, expectedRev, "gm");
      options.notifyChanged();
      return envelope(response, 200, { page: projectGmPage(page) });
    } catch (error) {
      // Re-read only on a conflict so the 409 can name the revision the caller lost the race to.
      return codexError(response, error, () => store.getPage(pathParam(request, "id"))?.rev);
    }
  });

  router.post(`${CODEX_BASE}/pages/:id/reveal`, requireWrite, (request, response) => {
    try {
      const { revealed } = RevealSchema.parse(request.body);
      const page = store.setPageRevealed(pathParam(request, "id"), revealed);
      options.notifyChanged();
      return envelope(response, 200, { page: projectGmPage(page) });
    } catch (error) {
      if (error instanceof CodexNotFoundError) return failure(response, 404, "not_found", error.message);
      return malformed(response, error);
    }
  });

  router.delete(`${CODEX_BASE}/pages/:id`, requireWrite, (request, response) => {
    store.deletePage(pathParam(request, "id"));
    options.notifyChanged();
    return envelope(response, 200, { deleted: true });
  });

  router.post(`${CODEX_BASE}/folders/move`, requireWrite, (request, response) => {
    try {
      const { from, to } = FolderMoveSchema.parse(request.body);
      const moved = store.moveFolder(from, to);
      options.notifyChanged();
      return envelope(response, 200, { moved });
    } catch (error) {
      return malformed(response, error);
    }
  });

  // Folder records make empty folders persist (a folder is otherwise only implied by its pages).
  router.get(`${CODEX_BASE}/folders`, requireGmRead, (request, response) =>
    readEnvelope(request, response, "gm", { folders: store.listFolders() })
  );
  // GM preview: mint a real, short-lived player principal (never a role flag on the GM token)
  router.post(`${CODEX_BASE}/preview-session`, requireGmSession, (_request, response) => {
    try {
      return envelope(response, 201, { token: options.issuePreviewSession() });
    } catch (error) {
      return malformed(response, error);
    }
  });

  router.post(`${CODEX_BASE}/folders`, requireWrite, (request, response) => {
    try {
      const path = store.createFolder(FolderPathSchema.parse(request.body).path);
      options.notifyChanged();
      return envelope(response, 201, { path });
    } catch (error) {
      return malformed(response, error);
    }
  });
  router.post(`${CODEX_BASE}/folders/delete`, requireWrite, (request, response) => {
    try {
      store.deleteFolder(FolderPathSchema.parse(request.body).path);
      options.notifyChanged();
      return envelope(response, 200, { deleted: true });
    } catch (error) {
      return malformed(response, error);
    }
  });

  router.get(`${CODEX_BASE}/pages/:id/revisions`, requireGmRead, (request, response) => {
    const page = store.getPage(pathParam(request, "id"));
    if (!page) return failure(response, 404, "not_found", "That page was not found.");
    return readEnvelope(request, response, "gm", { revisions: store.listRevisions(page.id) });
  });

  router.post(`${CODEX_BASE}/pages/:id/revisions/:revisionId/restore`, requireWrite, (request, response) => {
    try {
      const revisionId = Number(request.params.revisionId);
      if (!Number.isInteger(revisionId))
        return failure(response, 400, "validation_failed", "The revision id is malformed.");
      const page = store.restoreRevision(pathParam(request, "id"), revisionId, "gm");
      options.notifyChanged();
      return envelope(response, 200, { page: projectGmPage(page) });
    } catch (error) {
      if (error instanceof CodexNotFoundError) return failure(response, 404, "not_found", error.message);
      return malformed(response, error);
    }
  });

  // Connections: one edge concept, one panel, one graph

  // Idempotent on `(from, to, label)`. Touches both pages' recency but not their `rev`.
  router.post(`${CODEX_BASE}/pages/:id/connections`, requireWrite, (request, response) => {
    try {
      const connection = store.createConnection(
        pathParam(request, "id"),
        withoutCommandId(ConnectionCreateSchema.parse(request.body))
      );
      options.notifyChanged();
      return envelope(response, 201, {
        connection: {
          id: connection.id,
          fromKind: "page" as const,
          fromId: connection.fromPageId,
          toPageId: connection.toPageId,
          label: connection.label,
          origin: "declared" as const,
          layer: connection.layer,
          createdAt: connection.createdAt
        }
      });
    } catch (error) {
      return codexError(response, error);
    }
  });

  // Declared connections only; a mention is edited through its source text.
  router.patch(`${CODEX_BASE}/connections/:id`, requireWrite, (request, response) => {
    try {
      const connection = store.updateConnection(
        pathParam(request, "id"),
        withoutCommandId(ConnectionUpdateSchema.parse(request.body))
      );
      options.notifyChanged();
      return envelope(response, 200, {
        connection: {
          id: connection.id,
          fromKind: "page" as const,
          fromId: connection.fromPageId,
          toPageId: connection.toPageId,
          label: connection.label,
          origin: "declared" as const,
          layer: connection.layer,
          createdAt: connection.createdAt
        }
      });
    } catch (error) {
      return codexError(response, error);
    }
  });

  router.delete(`${CODEX_BASE}/connections/:id`, requireWrite, (request, response) => {
    store.deleteConnection(pathParam(request, "id"));
    options.notifyChanged();
    return envelope(response, 200, { deleted: true });
  });

  // The player copy passes `projectPlayerConnections`' three-condition gate.
  router.get(`${CODEX_BASE}/connections`, (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    const all = store.listAllConnections();
    if (role === "gm") return readEnvelope(request, response, role, { connections: projectGmConnections(all) });
    return readEnvelope(request, response, role, {
      connections: projectPlayerConnections(all, playerConnectionContext(store))
    });
  });

  // Maps (the atlas tree)

  router.get(`${CODEX_BASE}/maps`, (request, response) => {
    const role = readGrade(request, response);

    if (!role) return;
    const rows = store.listMaps();
    // A player's map keeps its parent link only when that parent is revealed.
    const revealed = new Set(rows.filter((row) => row.revealedToPlayers).map((row) => row.id));
    const maps =
      role === "gm"
        ? rows.map(projectGmMap)
        : rows
            .map((row) =>
              projectPlayerMap(row, { parentRevealed: row.parentMapId ? revealed.has(row.parentMapId) : false })
            )
            .filter((map) => map !== null);
    return readEnvelope(request, response, role, { maps });
  });

  router.post(`${CODEX_BASE}/maps`, requireWrite, (request, response) => {
    try {
      const map = store.createMap(withoutCommandId(MapCreateSchema.parse(request.body)));
      options.notifyChanged();
      return envelope(response, 201, { map: projectGmMap(map) });
    } catch (error) {
      return codexError(response, error);
    }
  });

  router.patch(`${CODEX_BASE}/maps/:id`, requireWrite, (request, response) => {
    try {
      const map = store.updateMap(pathParam(request, "id"), withoutCommandId(MapUpdateSchema.parse(request.body)));
      options.notifyChanged();
      return envelope(response, 200, { map: projectGmMap(map) });
    } catch (error) {
      return codexError(response, error);
    }
  });

  router.post(`${CODEX_BASE}/maps/:id/parent`, requireWrite, (request, response) => {
    try {
      const map = store.setMapParent(pathParam(request, "id"), MapParentSchema.parse(request.body).parentMapId);
      options.notifyChanged();
      return envelope(response, 200, { map: projectGmMap(map) });
    } catch (error) {
      return codexError(response, error);
    }
  });

  router.post(`${CODEX_BASE}/maps/:id/reveal`, requireWrite, (request, response) => {
    try {
      const map = store.setMapRevealed(pathParam(request, "id"), RevealSchema.parse(request.body).revealed);
      options.notifyChanged();
      return envelope(response, 200, { map: projectGmMap(map) });
    } catch (error) {
      return codexError(response, error);
    }
  });

  router.delete(`${CODEX_BASE}/maps/:id`, requireWrite, (request, response) => {
    store.deleteMap(pathParam(request, "id"));
    options.notifyChanged();
    return envelope(response, 200, { deleted: true });
  });

  // Markers

  router.get(`${CODEX_BASE}/maps/:id/markers`, (request, response) => {
    const role = readGrade(request, response);

    if (!role) return;
    const mapId = pathParam(request, "id");
    const map = store.getMap(mapId);
    if (!map) return failure(response, 404, "not_found", "That map was not found.");
    const rows = store.listMarkers(mapId);
    if (role === "gm") return readEnvelope(request, response, role, { markers: rows.map(projectGmMarker) });
    if (!map.revealedToPlayers) return failure(response, 404, "not_found", "That map was not found.");
    const markers = rows
      .map((row) =>
        projectPlayerMarker(row, {
          revealedPageIds: revealedPageIdsIn(store, row.pageIds),
          subMapRevealed: row.subMapId ? (store.getMap(row.subMapId)?.revealedToPlayers ?? false) : false
        })
      )
      .filter((marker) => marker !== null);
    return readEnvelope(request, response, role, { markers });
  });

  // Reverse lookup of pins pointing at a page. Players: an unrevealed page 404s first (no probing), then
  // each pin passes the pin-plus-map gate. `markersForPage` is ungated, so this is the only gate.
  router.get(`${CODEX_BASE}/pages/:id/markers`, (request, response) => {
    const role = readGrade(request, response);

    if (!role) return;
    const page = store.getPage(pathParam(request, "id"));
    if (!page) return failure(response, 404, "not_found", "That page was not found.");
    if (role !== "gm" && !page.revealedToPlayers)
      return failure(response, 404, "not_found", "That page was not found.");
    const rows = store.markersForPage(page.id);
    if (role === "gm") return readEnvelope(request, response, role, { markers: rows.map(projectGmMarker) });
    const markers = rows
      .map((row) =>
        projectPlayerPageMarker({
          marker: row,
          mapRevealed: store.getMap(row.mapId)?.revealedToPlayers ?? false,
          revealedPageIds: revealedPageIdsIn(store, row.pageIds),
          subMapRevealed: row.subMapId ? (store.getMap(row.subMapId)?.revealedToPlayers ?? false) : false
        })
      )
      .filter((marker) => marker !== null);
    return readEnvelope(request, response, role, { markers });
  });

  router.post(`${CODEX_BASE}/maps/:id/markers`, requireWrite, (request, response) => {
    try {
      const marker = store.createMarker(
        pathParam(request, "id"),
        withoutCommandId(MarkerCreateSchema.parse(request.body))
      );
      options.notifyChanged();
      return envelope(response, 201, { marker: projectGmMarker(marker) });
    } catch (error) {
      return codexError(response, error);
    }
  });

  // Where the party is. A player gets null (not 404) when the pin is hidden, so a hidden party pin and
  // none look the same; `mapName` is sent only when the pin is visible.
  router.get(`${CODEX_BASE}/party`, (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    const marker = store.partyMarker();
    const map = marker ? store.getMap(marker.mapId) : null;
    if (!marker || !map) return readEnvelope(request, response, role, { party: null });
    if (role === "gm")
      return readEnvelope(request, response, role, { party: { marker: projectGmMarker(marker), mapName: map.name } });
    const projected = projectPlayerPageMarker({
      marker,
      mapRevealed: map.revealedToPlayers,
      revealedPageIds: revealedPageIdsIn(store, marker.pageIds),
      subMapRevealed: marker.subMapId ? (store.getMap(marker.subMapId)?.revealedToPlayers ?? false) : false
    });
    return readEnvelope(request, response, role, {
      party: projected === null ? null : { marker: projected, mapName: map.name }
    });
  });

  // One pin by id. Any player gate failure is the same 404 as a bogus id.
  router.get(`${CODEX_BASE}/markers/:id`, (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    const marker = store.getMarker(pathParam(request, "id"));
    if (!marker) return failure(response, 404, "not_found", "That pin was not found.");
    if (role === "gm") return readEnvelope(request, response, role, { marker: projectGmMarker(marker) });
    const projected = projectPlayerPageMarker({
      marker,
      mapRevealed: store.getMap(marker.mapId)?.revealedToPlayers ?? false,
      revealedPageIds: revealedPageIdsIn(store, marker.pageIds),
      subMapRevealed: marker.subMapId ? (store.getMap(marker.subMapId)?.revealedToPlayers ?? false) : false
    });
    if (!projected) return failure(response, 404, "not_found", "That pin was not found.");
    return readEnvelope(request, response, role, { marker: projected });
  });

  router.patch(`${CODEX_BASE}/markers/:id`, requireWrite, (request, response) => {
    try {
      const marker = store.updateMarker(
        pathParam(request, "id"),
        withoutCommandId(MarkerUpdateSchema.parse(request.body))
      );
      options.notifyChanged();
      return envelope(response, 200, { marker: projectGmMarker(marker) });
    } catch (error) {
      return codexError(response, error);
    }
  });

  router.post(`${CODEX_BASE}/markers/:id/move`, requireWrite, (request, response) => {
    try {
      const { x, y } = MarkerMoveSchema.parse(request.body);
      const marker = store.moveMarker(pathParam(request, "id"), x, y);
      options.notifyChanged();
      return envelope(response, 200, { marker: projectGmMarker(marker) });
    } catch (error) {
      return codexError(response, error);
    }
  });

  router.post(`${CODEX_BASE}/markers/:id/reveal`, requireWrite, (request, response) => {
    try {
      const marker = store.setMarkerRevealed(pathParam(request, "id"), RevealSchema.parse(request.body).revealed);
      options.notifyChanged();
      return envelope(response, 200, { marker: projectGmMarker(marker) });
    } catch (error) {
      return codexError(response, error);
    }
  });

  // `isParty: false` clears only this marker (not `setPartyMarker(null)`, which clears whichever pin holds it).
  router.put(`${CODEX_BASE}/markers/:id/party`, requireWrite, (request, response) => {
    try {
      const markerId = pathParam(request, "id");
      const { isParty } = MarkerPartySchema.parse(request.body);
      if (isParty) store.setPartyMarker(markerId);
      else if (store.partyMarker()?.id === markerId) store.setPartyMarker(null);
      // `setPartyMarker` throws on an unknown id; the clearing arm falls through to this check.
      const marker = store.getMarker(markerId);
      if (!marker) return failure(response, 404, "not_found", "That marker was not found.");
      options.notifyChanged();
      return envelope(response, 200, { marker: projectGmMarker(marker) });
    } catch (error) {
      return codexError(response, error);
    }
  });

  router.delete(`${CODEX_BASE}/markers/:id`, requireWrite, (request, response) => {
    store.deleteMarker(pathParam(request, "id"));
    options.notifyChanged();
    return envelope(response, 200, { deleted: true });
  });

  // Journal / timeline

  router.get(`${CODEX_BASE}/journal`, (request, response) => {
    const role = readGrade(request, response);

    if (!role) return;
    const markerId = typeof request.query.markerId === "string" ? request.query.markerId : undefined;
    const pageId = typeof request.query.pageId === "string" ? request.query.pageId : undefined;
    // Players may read a location's mini-timeline only when the marker (pin plus map gate) or page is
    // visible, so hidden ids cannot be probed. Entry reveal is still enforced below.
    if (role !== "gm") {
      if (markerId) {
        const marker = store.getMarker(markerId);
        const visible =
          marker !== null &&
          projectPlayerPageMarker({
            marker,
            mapRevealed: store.getMap(marker.mapId)?.revealedToPlayers ?? false,
            revealedPageIds: revealedPageIdsIn(store, marker.pageIds),
            subMapRevealed: marker.subMapId ? (store.getMap(marker.subMapId)?.revealedToPlayers ?? false) : false
          }) !== null;
        if (!visible) return failure(response, 404, "not_found", "That was not found.");
      }
      if (pageId && !store.getPage(pageId)?.revealedToPlayers)
        return failure(response, 404, "not_found", "That was not found.");
    }
    const rows = markerId || pageId ? store.listEntriesFor({ markerId, pageId }) : store.listTimeline();
    if (role === "gm") return readEnvelope(request, response, role, { entries: rows.map(projectGmJournalEntry) });
    // Session numbers are gated on the session's reveal state, resolved here.
    const context = playerSessionNumbers(store);
    const entries = rows.map((row) => projectPlayerJournalEntry(row, context)).filter((entry) => entry !== null);
    return readEnvelope(request, response, role, { entries });
  });

  // The chronicle: entries and dated event pages in order. `listChronicle()` is ungated;
  // `projectPlayerChronicleRecord` is the only player gate.
  router.get(`${CODEX_BASE}/timeline`, (request, response) => {
    const role = readGrade(request, response);

    if (!role) return;
    const rows = store.listChronicle();
    if (role === "gm") {
      // GM and player branches use different clocks; kept separate so the GM clock cannot reach players.
      const campaignInstant = store.campaignInstant();
      const records = rows.map((row) =>
        projectGmChronicleRecord(row, {
          campaignInstant,
          // Only an unapplied downtime has a proposed date, and only the GM sees it.
          proposedDate: row.kind === "entry" ? store.proposedDateFor(row.entry) : null
        })
      );
      return readEnvelope(request, response, role, { records });
    }
    // The same session context `GET /codex/journal` resolves; entry rows delegate to `projectPlayerJournalEntry`.
    const context = playerSessionNumbers(store);
    const publishedInstant = store.publishedInstant();
    // Revealed pages, so payload page ids (faction, character) travel only when revealed.
    const revealedPageIds = new Set(
      store
        .listPages()
        .filter((page) => page.revealedToPlayers)
        .map((page) => page.id)
    );
    const records = rows
      .map((row) => projectPlayerChronicleRecord(row, { ...context, publishedInstant, revealedPageIds }))
      .filter((record) => record !== null);
    return readEnvelope(request, response, role, { records });
  });

  router.post(`${CODEX_BASE}/journal`, requireWrite, (request, response) => {
    try {
      const entry = store.createEntry(withoutCommandId(JournalWriteSchema.parse(request.body)));
      options.notifyChanged();
      return envelope(response, 201, { entry: projectGmJournalEntry(entry) });
    } catch (error) {
      return codexError(response, error);
    }
  });

  // Deadline, downtime and milestone have their own create routes (each requires a date or payload),
  // registered before `/journal/:id`. Reveal uses the ordinary journal route.
  router.post(`${CODEX_BASE}/journal/deadline`, requireWrite, (request, response) => {
    try {
      const entry = store.createDeadline(withoutCommandId(DeadlineCreateSchema.parse(request.body)));
      options.notifyChanged();
      return envelope(response, 201, { entry: projectGmJournalEntry(entry) });
    } catch (error) {
      return codexError(response, error);
    }
  });

  // Never moves the clock; returns the date `apply-downtime` would move it to.
  router.post(`${CODEX_BASE}/journal/downtime`, requireWrite, (request, response) => {
    try {
      const entry = store.createDowntime(withoutCommandId(DowntimeCreateSchema.parse(request.body)));
      options.notifyChanged();
      return envelope(response, 201, {
        entry: projectGmJournalEntry(entry),
        proposedDate: store.proposedDateFor(entry)
      });
    } catch (error) {
      return codexError(response, error);
    }
  });

  router.post(`${CODEX_BASE}/journal/milestone`, requireWrite, (request, response) => {
    try {
      const entry = store.createMilestone(withoutCommandId(MilestoneCreateSchema.parse(request.body)));
      options.notifyChanged();
      return envelope(response, 201, { entry: projectGmJournalEntry(entry) });
    } catch (error) {
      return codexError(response, error);
    }
  });

  // Moves the GM clock by the downtime's days; returns entry and calendar. A second apply is refused.
  router.post(`${CODEX_BASE}/journal/:id/apply-downtime`, requireWrite, (request, response) => {
    try {
      const { entry, calendar } = store.applyDowntime(pathParam(request, "id"));
      options.notifyChanged();
      return envelope(response, 200, {
        entry: projectGmJournalEntry(entry),
        calendar: projectGmCalendar(calendar, store.getPublishedDate())
      });
    } catch (error) {
      return codexError(response, error);
    }
  });

  router.patch(`${CODEX_BASE}/journal/:id`, requireWrite, (request, response) => {
    try {
      const entry = store.updateEntry(
        pathParam(request, "id"),
        withoutCommandId(JournalUpdateSchema.parse(request.body))
      );
      options.notifyChanged();
      return envelope(response, 200, { entry: projectGmJournalEntry(entry) });
    } catch (error) {
      return codexError(response, error);
    }
  });

  router.post(`${CODEX_BASE}/journal/:id/reveal`, requireWrite, (request, response) => {
    try {
      const entry = store.setEntryRevealed(pathParam(request, "id"), RevealSchema.parse(request.body).revealed);
      options.notifyChanged();
      return envelope(response, 200, { entry: projectGmJournalEntry(entry) });
    } catch (error) {
      return codexError(response, error);
    }
  });

  router.delete(`${CODEX_BASE}/journal/:id`, requireWrite, (request, response) => {
    store.deleteEntry(pathParam(request, "id"));
    options.notifyChanged();
    return envelope(response, 200, { deleted: true });
  });

  // Sessions. An unrevealed session 404s for players: "secret" must look like "absent".
  router.get(`${CODEX_BASE}/sessions`, (request, response) => {
    const role = readGrade(request, response);

    if (!role) return;
    const rows = store.listSessions();
    if (role === "gm")
      return readEnvelope(request, response, role, {
        sessions: rows.map(projectGmSession),
        activeSessionId: store.activeSessionId
      });
    // Players always get `activeSessionId: null` (it may name a hidden session); the key keeps one shape.
    return readEnvelope(request, response, role, {
      sessions: rows.map(projectPlayerSession).filter((session) => session !== null),
      activeSessionId: null
    });
  });

  router.post(`${CODEX_BASE}/sessions`, requireWrite, (request, response) => {
    try {
      const session = store.createSession(withoutCommandId(SessionCreateSchema.parse(request.body)));
      options.notifyChanged();
      return envelope(response, 201, { session: projectGmSession(session) });
    } catch (error) {
      return codexError(response, error);
    }
  });

  router.get(`${CODEX_BASE}/sessions/:id`, (request, response) => {
    const role = readGrade(request, response);

    if (!role) return;
    const session = store.getSession(pathParam(request, "id"));
    if (!session) return failure(response, 404, "not_found", "That session was not found.");
    if (role === "gm") return readEnvelope(request, response, role, { session: projectGmSession(session) });
    const projected = projectPlayerSession(session);
    // The same 404 an absent session gets, never 403.
    if (!projected) return failure(response, 404, "not_found", "That session was not found.");
    return readEnvelope(request, response, role, { session: projected });
  });

  router.patch(`${CODEX_BASE}/sessions/:id`, requireWrite, (request, response) => {
    try {
      const { expectedRev, commandId, ...fields } = SessionUpdateSchema.parse(request.body);
      void commandId;
      const session = store.updateSession(pathParam(request, "id"), fields, expectedRev, "gm");
      options.notifyChanged();
      return envelope(response, 200, { session: projectGmSession(session) });
    } catch (error) {
      return codexError(response, error, () => store.getSession(pathParam(request, "id"))?.rev);
    }
  });

  router.delete(`${CODEX_BASE}/sessions/:id`, requireWrite, (request, response) => {
    store.deleteSession(pathParam(request, "id"));
    options.notifyChanged();
    return envelope(response, 200, { deleted: true });
  });

  router.post(`${CODEX_BASE}/sessions/:id/reveal`, requireWrite, (request, response) => {
    try {
      const session = store.setSessionRevealed(pathParam(request, "id"), RevealSchema.parse(request.body).revealed);
      options.notifyChanged();
      return envelope(response, 200, { session: projectGmSession(session) });
    } catch (error) {
      return codexError(response, error);
    }
  });

  // Returns only the pointer: activation does not edit the session.
  router.post(`${CODEX_BASE}/sessions/:id/activate`, requireWrite, (request, response) => {
    try {
      const activeSessionId = store.setActiveSession(pathParam(request, "id"));
      options.notifyChanged();
      return envelope(response, 200, { activeSessionId });
    } catch (error) {
      return codexError(response, error);
    }
  });

  // Quests: unrevealed quests 404 for players; `entityIds` are filtered to revealed pages.
  router.get(`${CODEX_BASE}/quests`, (request, response) => {
    const role = readGrade(request, response);

    if (!role) return;
    const rows = store.listQuests();
    if (role === "gm") return readEnvelope(request, response, role, { quests: rows.map(projectGmQuest) });
    const quests = rows
      .map((row) => projectPlayerQuest(row, { revealedEntityIds: revealedPageIdsIn(store, row.entityIds) }))
      .filter((quest) => quest !== null);
    return readEnvelope(request, response, role, { quests });
  });

  router.post(`${CODEX_BASE}/quests`, requireWrite, (request, response) => {
    try {
      const quest = store.createQuest(withoutCommandId(QuestCreateSchema.parse(request.body)));
      options.notifyChanged();
      return envelope(response, 201, { quest: projectGmQuest(quest) });
    } catch (error) {
      return codexError(response, error);
    }
  });

  router.get(`${CODEX_BASE}/quests/:id`, (request, response) => {
    const role = readGrade(request, response);

    if (!role) return;
    const quest = store.getQuest(pathParam(request, "id"));
    if (!quest) return failure(response, 404, "not_found", "That quest was not found.");
    if (role === "gm") return readEnvelope(request, response, role, { quest: projectGmQuest(quest) });
    const projected = projectPlayerQuest(quest, { revealedEntityIds: revealedPageIdsIn(store, quest.entityIds) });
    // The same 404 an absent quest gets, never 403.
    if (!projected) return failure(response, 404, "not_found", "That quest was not found.");
    return readEnvelope(request, response, role, { quest: projected });
  });

  router.patch(`${CODEX_BASE}/quests/:id`, requireWrite, (request, response) => {
    try {
      const { expectedRev, commandId, ...fields } = QuestUpdateSchema.parse(request.body);
      void commandId;
      const quest = store.updateQuest(pathParam(request, "id"), fields, expectedRev);
      options.notifyChanged();
      return envelope(response, 200, { quest: projectGmQuest(quest) });
    } catch (error) {
      return codexError(response, error, () => store.getQuest(pathParam(request, "id"))?.rev);
    }
  });

  router.delete(`${CODEX_BASE}/quests/:id`, requireWrite, (request, response) => {
    store.deleteQuest(pathParam(request, "id"));
    options.notifyChanged();
    return envelope(response, 200, { deleted: true });
  });

  router.post(`${CODEX_BASE}/quests/:id/reveal`, requireWrite, (request, response) => {
    try {
      const quest = store.setQuestRevealed(pathParam(request, "id"), RevealSchema.parse(request.body).revealed);
      options.notifyChanged();
      return envelope(response, 200, { quest: projectGmQuest(quest) });
    } catch (error) {
      return codexError(response, error);
    }
  });

  // Standing, addressed by faction page id. Players need both the standing and its faction page revealed.
  router.get(`${CODEX_BASE}/standing`, (request, response) => {
    const role = readGrade(request, response);

    if (!role) return;
    const rows = store.listStanding();
    if (role === "gm") return readEnvelope(request, response, role, { standing: rows.map(projectGmStanding) });
    const standing = rows
      .map((row) => projectPlayerStanding(row, { factionRevealed: pageRevealedFor(store, row.factionPageId) }))
      .filter((row) => row !== null);
    return readEnvelope(request, response, role, { standing });
  });

  // The store writes the value and its chronicle record in one transaction, hence `reason` here.
  router.put(`${CODEX_BASE}/standing/:factionPageId`, requireWrite, (request, response) => {
    try {
      const { value, reason } = StandingSetSchema.parse(request.body);
      const standing = store.setStanding(pathParam(request, "factionPageId"), value, reason);
      options.notifyChanged();
      return envelope(response, 200, { standing: projectGmStanding(standing) });
    } catch (error) {
      return codexError(response, error);
    }
  });

  router.post(`${CODEX_BASE}/standing/:factionPageId/reveal`, requireWrite, (request, response) => {
    try {
      const standing = store.setStandingRevealed(
        pathParam(request, "factionPageId"),
        RevealSchema.parse(request.body).revealed
      );
      options.notifyChanged();
      return envelope(response, 200, { standing: projectGmStanding(standing) });
    } catch (error) {
      return codexError(response, error);
    }
  });

  // The reveal audit (GM-only). Loads records and resolves context with the player routes' helpers;
  // `projectRevealAudit` decides everything, so never add a `revealed` test here.
  router.get(`${CODEX_BASE}/reveal-audit`, requireGmRead, (request, response) => {
    const maps = store.listMaps();
    const mapRevealed = new Map(maps.map((map) => [map.id, map.revealedToPlayers]));
    const sessionContext = playerSessionNumbers(store);
    const records: CodexRevealAuditRecord[] = [
      ...store.listPages().map((page) => ({ kind: "page", page }) as const),
      ...maps.map(
        (map) =>
          ({
            kind: "map",
            map,
            parentRevealed: map.parentMapId ? (mapRevealed.get(map.parentMapId) ?? false) : false
          }) as const
      ),
      // Each pin carries its map's gate, as in `GET /codex/maps/:id/markers`.
      ...maps.flatMap((map) =>
        store.listMarkers(map.id).map(
          (marker) =>
            ({
              kind: "marker",
              marker,
              mapRevealed: map.revealedToPlayers,
              revealedPageIds: revealedPageIdsIn(store, marker.pageIds),
              subMapRevealed: marker.subMapId ? (mapRevealed.get(marker.subMapId) ?? false) : false
            }) as const
        )
      ),
      ...store.listTimeline().map((entry) => ({ kind: "journal", entry, sessionContext }) as const),
      ...store.listSessions().map((session) => ({ kind: "session", session }) as const),
      ...store
        .listQuests()
        .map(
          (quest) => ({ kind: "quest", quest, revealedEntityIds: revealedPageIdsIn(store, quest.entityIds) }) as const
        ),
      ...store.listStanding().map(
        (standing) =>
          ({
            kind: "standing",
            standing,
            factionRevealed: pageRevealedFor(store, standing.factionPageId),
            factionTitle: store.getPage(standing.factionPageId)?.title ?? null
          }) as const
      )
    ];
    return readEnvelope(request, response, "gm", { audit: projectRevealAudit(records) });
  });

  // Calendar: world structure plus the GM and published clocks

  // The GM gets their own `currentDate` plus `publishedDate`; players get only the published date.
  router.get(`${CODEX_BASE}/calendar`, (request, response) => {
    const role = readGrade(request, response);

    if (!role) return;
    const calendar = store.getCalendar();
    const publishedDate = store.getPublishedDate();
    return readEnvelope(request, response, role, {
      calendar:
        role === "gm" ? projectGmCalendar(calendar, publishedDate) : projectPlayerCalendar(calendar, publishedDate)
    });
  });

  /** Replacing the calendar moves only the GM's clock; it never publishes. Answers with the GM projection. */
  router.put(`${CODEX_BASE}/calendar`, requireWrite, (request, response) => {
    try {
      const calendar = store.setCalendar(withoutCommandId(CalendarSchema.parse(request.body)));
      options.notifyChanged();
      return envelope(response, 200, { calendar: projectGmCalendar(calendar, store.getPublishedDate()) });
    } catch (error) {
      return malformed(response, error);
    }
  });

  // The only thing that moves the players' clock: publishes the GM's current date.
  router.post(`${CODEX_BASE}/calendar/publish`, requireWrite, (_request, response) => {
    try {
      const calendar = store.publishCampaignDate();
      options.notifyChanged();
      return envelope(response, 200, { calendar: projectGmCalendar(calendar, store.getPublishedDate()) });
    } catch (error) {
      return codexError(response, error);
    }
  });

  // Restore a backup: replace-only and all-or-nothing. The body must be an unedited export file.
  router.post(`${CODEX_BASE}/import`, requireWrite, (request, response) => {
    try {
      const { codex } = CodexImportSchema.parse(request.body);
      const counts = store.importBundle(codex);
      options.notifyChanged();
      return envelope(response, 200, { replaced: true, counts });
    } catch (error) {
      return codexError(response, error);
    }
  });

  // Codex-wide settings (GM-only: how much version history the Codex keeps)

  // GM-only, reads included. These routes do not ping clients (nothing they show changed); the store
  // still bumps the revision for ETags.
  router.get(`${CODEX_BASE}/settings`, requireGmRead, (request, response) =>
    readEnvelope(request, response, "gm", { settings: store.getSettings() })
  );

  // Answers with the stored read shape; `.strict()` rejects the read-only usage fields.
  router.put(`${CODEX_BASE}/settings`, requireWrite, (request, response) => {
    try {
      return envelope(response, 200, {
        settings: store.setSettings(withoutCommandId(CodexSettingsSchema.parse(request.body)))
      });
    } catch (error) {
      return malformed(response, error);
    }
  });

  // Codex-wide history prune. Rejects bad values; works with history disabled; never touches pages.
  router.delete(`${CODEX_BASE}/page-revisions`, requireWrite, (request, response) => {
    try {
      return envelope(response, 200, {
        deleted: store.deleteRevisionsOlderThan(RevisionsDeleteSchema.parse(request.body).olderThanDays)
      });
    } catch (error) {
      return malformed(response, error);
    }
  });

  // Export (GM backup / round-trip)

  router.get(`${CODEX_BASE}/export`, requireGmRead, (request, response) => {
    return readEnvelope(request, response, "gm", {
      codex: store.exportBundle(),
      exportedAt: new Date().toISOString(),
      bundleVersion: CODEX_BUNDLE_VERSION
    });
  });

  // Media (page banners and inline images)

  router.post(
    CODEX_ASSET_BASE,
    requireWrite,
    express.raw({ type: () => true, limit: "11mb" }),
    async (request, response) => {
      try {
        if (!Buffer.isBuffer(request.body) || request.body.length === 0)
          return failure(response, 400, "validation_failed", "Upload the image as the request body.");
        const filename = typeof request.query.filename === "string" ? request.query.filename : "image";
        const imported = await options.assets.import(request.body, filename);
        return envelope(response, imported.duplicate ? 200 : 201, {
          asset: {
            id: imported.metadata.id,
            width: imported.metadata.width,
            height: imported.metadata.height,
            mediaType: imported.metadata.mediaType
          }
        });
      } catch (error) {
        return failure(
          response,
          400,
          "validation_failed",
          error instanceof Error ? error.message : "The image upload failed."
        );
      }
    }
  );

  router.get(`${CODEX_ASSET_BASE}/:id/content`, async (request, response) => {
    const id = pathParam(request, "id");
    // GM or credential always; a player only when revealed player-facing content uses the image. Everyone
    // else gets the same 403 before any lookup, so a media URL cannot be an existence oracle.
    const principal = principalFor(request, response, options, "codex:read");
    const allowed =
      principal.kind === "gm" ||
      principal.kind === "integration" ||
      (principal.kind === "player" && store.isMediaVisibleToPlayers(id));
    if (!allowed) return failure(response, 403, "forbidden", "That image is not available to this session.");
    const metadata = await options.assets.get(id);
    const content = metadata ? await options.assets.readOriginal(id) : null;
    if (!metadata || !content) return failure(response, 404, "not_found", "That image was not found.");
    const etag = `"${id}"`;
    response.setHeader("etag", etag);
    response.setHeader("content-type", metadata.mediaType);
    response.setHeader("cache-control", "private, no-store");
    if (request.header("if-none-match") === etag) return response.status(304).end();
    response.setHeader("content-length", content.length);
    return response.send(content);
  });

  // Catch-all: a fixed message out, the real error to the log. This router's own `express.raw` 413s land
  // here, so they are passed through.
  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if ((error as { type?: string } | null)?.type === "entity.too.large")
      return failure(response, 413, "bad_request", "The request body is too large.");
    console.error("codex request failed:", error);
    return failure(response, 500, "internal_error", "The codex request failed.");
  });
  return router;
}
