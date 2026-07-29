import { randomUUID } from "node:crypto";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { API_VERSION } from "@vtt/api-contract";
import type { MapAssetStore } from "./map-assets.js";
import { CodexNotFoundError, CodexRevisionConflictError, type CodexSearchRef, type CodexStore } from "./codex-store.js";
import { projectGmBacklinks, projectGmChronicleRecord, projectGmJournalEntry, projectGmLinkEdges, projectGmMap, projectGmMarker, projectGmPage, projectGmPageSummary, projectGmQuest, projectGmRelationships, projectGmSearchHit, projectGmSession, projectPlayerBacklinks, projectPlayerChronicleRecord, projectPlayerJournalEntry, projectPlayerLinkEdges, projectPlayerMap, projectPlayerMarker, projectPlayerPage, projectPlayerPageMarker, projectPlayerPageSummary, projectPlayerQuest, projectPlayerRelationships, projectPlayerRelationshipEdges, projectPlayerSearchHit, projectPlayerSession, type CodexSearchRecord } from "./codex-projections.js";

/**
 * The codex REST surface (`/api/v1/codex/*`), a GM-authed router mounted in `server.ts` alongside the
 * map/token/viewer routers - the same pattern maps use, deliberately OUTSIDE the GameState broadcast.
 * Every write bumps the store's coarse revision and pings clients via `notifyChanged`; every read
 * branches on the caller's role and projects through `codex-projections.ts` so `gmBody` and unrevealed
 * pages can never reach a player.
 */

const CODEX_BASE = "/api/v1/codex";

const TagsSchema = z.array(z.string().trim().min(1).max(40)).max(24);
/**
 * A raw in-world date. Declared once and shared by the journal and page write schemas (CT-11) - two copies
 * of the same bounds is how one surface silently accepts a date the other rejects.
 */
const InWorldDateSchema = z.object({ year: z.number().int().min(-100_000).max(100_000), month: z.number().int().min(0).max(23), day: z.number().int().min(1).max(400) }).nullable();
const EntityTypeSchema = z.enum(["note", "character", "location", "faction", "item", "species", "religion", "event"]);
const FieldsSchema = z.record(z.string().max(40), z.string().max(2000));
const PageCreateSchema = z.object({
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
  /** CT-11: what places an `event` page on the chronicle. Omitted = undated; `null` = clear the date. */
  inWorldDate: InWorldDateSchema.optional()
}).strict();
const PageUpdateSchema = z.object({
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
  expectedRev: z.number().int().nonnegative().optional()
}).strict();
const RelationshipCreateSchema = z.object({ toPageId: z.string().uuid(), type: z.string().trim().min(1).max(40) }).strict();
const RevealSchema = z.object({ revealed: z.boolean() }).strict();
const FolderMoveSchema = z.object({ from: z.string().trim().min(1).max(160), to: z.string().trim().max(160) }).strict();
const FolderPathSchema = z.object({ path: z.string().trim().min(1).max(160) }).strict();

const MapKindSchema = z.enum(["battlemap", "regional", "world"]);
const MapCreateSchema = z.object({
  assetId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  kind: MapKindSchema,
  parentMapId: z.string().uuid().nullable().optional(),
  revealedToPlayers: z.boolean().optional(),
  tags: TagsSchema.optional()
}).strict();
const MapUpdateSchema = z.object({ name: z.string().trim().min(1).max(120).optional(), kind: MapKindSchema.optional(), tags: TagsSchema.optional() }).strict();
const MapParentSchema = z.object({ parentMapId: z.string().uuid().nullable() }).strict();

const Coord = z.number().finite().min(0).max(1_000_000);
const IconColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const IconId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(60);
const MarkerLinks = {
  pageIds: z.array(z.string().uuid()).max(24).optional(),
  subMapId: z.string().uuid().nullable().optional(),
  sceneIds: z.array(z.string().uuid()).max(24).optional(),
  actorId: z.string().uuid().nullable().optional()
};
const MarkerCreateSchema = z.object({
  x: Coord, y: Coord, iconId: IconId, iconColor: IconColor,
  label: z.string().max(120).nullable().optional(), revealedToPlayers: z.boolean().optional(), tags: TagsSchema.optional(), ...MarkerLinks
}).strict();
const MarkerUpdateSchema = z.object({
  x: Coord.optional(), y: Coord.optional(), iconId: IconId.optional(), iconColor: IconColor.optional(),
  label: z.string().max(120).nullable().optional(), revealedToPlayers: z.boolean().optional(), tags: TagsSchema.optional(), ...MarkerLinks
}).strict();
const MarkerMoveSchema = z.object({ x: Coord, y: Coord }).strict();

const JournalWriteSchema = z.object({
  tags: TagsSchema.optional(),
  playerText: z.string().max(20_000).optional(),
  gmText: z.string().max(20_000).nullable().optional(),
  revealedToPlayers: z.boolean().optional(),
  attachMarkerId: z.string().uuid().nullable().optional(),
  attachPageId: z.string().uuid().nullable().optional(),
  sessionNumber: z.number().int().min(0).max(100_000).nullable().optional(),
  realDate: z.string().max(40).nullable().optional(),
  inWorldLabel: z.string().max(120).nullable().optional(),
  inWorldDate: InWorldDateSchema.optional()
}).strict();
/**
 * M9 sessions. `sessionNumber`'s bounds are the journal's verbatim, on purpose: the two are the SAME
 * number - a journal entry's `sessionNumber` resolves against a session record - and two copies of the
 * bound is how one surface silently accepts a value the other rejects (the reason `InWorldDateSchema`
 * above is shared rather than repeated).
 */
const SessionNumberSchema = z.number().int().min(0).max(100_000).nullable();
const AttendeesSchema = z.array(z.string().trim().min(1).max(40)).max(24);
const SessionStatusSchema = z.enum(["planned", "played"]);
const SessionCreateSchema = z.object({
  sessionNumber: SessionNumberSchema.optional(),
  realDate: z.string().max(40).nullable().optional(),
  attendees: AttendeesSchema.optional(),
  prepBody: z.string().max(100_000).optional(),
  recapBody: z.string().max(100_000).optional(),
  revealedToPlayers: z.boolean().optional(),
  status: SessionStatusSchema.optional()
}).strict();
/** No `revealedToPlayers`: reveal is its own route, so a PATCH cannot publish a recap as a side effect of an edit. */
const SessionUpdateSchema = z.object({
  sessionNumber: SessionNumberSchema.optional(),
  realDate: z.string().max(40).nullable().optional(),
  attendees: AttendeesSchema.optional(),
  prepBody: z.string().max(100_000).optional(),
  recapBody: z.string().max(100_000).optional(),
  status: SessionStatusSchema.optional(),
  expectedRev: z.number().int().nonnegative().optional()
}).strict();
/**
 * M10 quests. The body bound is `z.string().max(100_000)`, the page/session bound verbatim, because a
 * quest body IS a two-layer prose body and `body()` in the store enforces exactly that number - two
 * copies of one bound is how one surface silently accepts a value the other rejects.
 *
 * `ObjectiveSchema` mirrors `questObjectives` in the store: 24 items and 120 characters, the numbers
 * `CodexQuestObjective` publishes. `text` is NOT `.min(1)`, deliberately - the checklist's real flow is
 * "add a row, then type into it" and the editor autosaves the whole draft, so a minimum would 400 the
 * first save after "Add item". The published schema agreed to this rather than the reverse, and says so
 * in its own description, so the contract is not advertising a rule nobody enforces. See
 * `questObjectives` for the full reasoning; the store is the enforcer, this is the early rejection.
 */
const QuestStatusSchema = z.enum(["active", "completed", "failed"]);
const ObjectiveSchema = z.object({ text: z.string().max(120), done: z.boolean() }).strict();
const ObjectivesSchema = z.array(ObjectiveSchema).max(24);
const QuestEntityIdsSchema = z.array(z.string().uuid()).max(24);
const QuestCreateSchema = z.object({
  title: z.string().trim().min(1).max(160),
  status: QuestStatusSchema.optional(),
  playerBody: z.string().max(100_000).optional(),
  gmBody: z.string().max(100_000).optional(),
  objectives: ObjectivesSchema.optional(),
  entityIds: QuestEntityIdsSchema.optional(),
  revealedToPlayers: z.boolean().optional()
}).strict();
/** No `revealedToPlayers`: reveal is its own route, so a PATCH cannot publish a quest as a side effect of an edit. */
const QuestUpdateSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  status: QuestStatusSchema.optional(),
  playerBody: z.string().max(100_000).optional(),
  gmBody: z.string().max(100_000).optional(),
  objectives: ObjectivesSchema.optional(),
  entityIds: QuestEntityIdsSchema.optional(),
  expectedRev: z.number().int().nonnegative().optional()
}).strict();
const CalendarSchema = z.object({
  yearName: z.string().max(20),
  months: z.array(z.object({ name: z.string().trim().min(1).max(40), days: z.number().int().min(1).max(400) })).min(1).max(24),
  weekdays: z.array(z.string().trim().min(1).max(40)).max(20),
  currentDate: z.object({ year: z.number().int().min(-100_000).max(100_000), month: z.number().int().min(0).max(23), day: z.number().int().min(1).max(400) }).nullable().optional()
}).strict();

type CodexRouterOptions = Readonly<{
  store: CodexStore;
  /** Content-addressed store for page media (banners + inline images), separate from map/token assets. */
  assets: MapAssetStore;
  authorizeGm: (token: string | undefined) => boolean;
  authorizePlayer: (token: string | undefined) => boolean;
  /** Emit a content-free `codex:changed` ping so every client refetches its projected view. */
  notifyChanged: (scope: "pages" | "maps" | "markers" | "journal" | "sessions" | "quests") => void;
  /**
   * Mints a short-lived PLAYER token so the GM can preview the player Codex truthfully. The preview must
   * be a real player principal - `roleOf` below checks `authorizeGm` FIRST, so reusing the GM's own token
   * would silently return GM projections while claiming to be the player view.
   */
  issuePreviewSession: () => string;
}>;

const CODEX_ASSET_BASE = "/api/v1/codex-assets";

function bearer(request: Request): string | undefined {
  return request.header("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
}
/** A route param is always a single string at runtime; coerce the Express `string | string[]` type. */
function pathParam(request: Request, name: string): string {
  const value = request.params[name];
  return typeof value === "string" ? value : "";
}
function envelope(response: Response, status: number, data: unknown) {
  return response.status(status).json({ ok: true, apiVersion: API_VERSION, data });
}
function failure(response: Response, status: number, code: string, message: string) {
  const id = response.getHeader("x-request-id")?.toString() ?? randomUUID();
  return response.status(status).json({ ok: false, apiVersion: API_VERSION, error: { code, message, requestId: id } });
}
function malformed(response: Response, error: unknown) {
  return failure(response, 400, "validation_failed", error instanceof z.ZodError ? (error.issues[0]?.message ?? "The request is malformed.") : (error as Error).message);
}
/** Map a store/validation error to its HTTP envelope: 404 not-found, 409 conflict, else 400 malformed. */
function codexError(response: Response, error: unknown) {
  if (error instanceof CodexRevisionConflictError) return failure(response, 409, "conflict", error.message);
  if (error instanceof CodexNotFoundError) return failure(response, 404, "not_found", error.message);
  return malformed(response, error);
}

/**
 * Resolve one search hit to the live record plus the CONTEXT its player predicate needs. A marker
 * carries its map's reveal flag because a pin on a secret map is invisible to players however the pin
 * itself is flagged (CD-6) - the identical resolution `GET /codex/maps/:id/markers` performs before it
 * projects a single marker. Returns null for a row whose record has since gone.
 */
function loadSearchRecord(store: CodexStore, ref: CodexSearchRef): CodexSearchRecord | null {
  switch (ref.kind) {
    case "page": { const page = store.getPage(ref.id); return page ? { kind: "page", page } : null; }
    case "journal": { const entry = store.getEntry(ref.id); return entry ? { kind: "journal", entry } : null; }
    case "map": { const map = store.getMap(ref.id); return map ? { kind: "map", map } : null; }
    case "marker": {
      const marker = store.getMarker(ref.id);
      if (!marker) return null;
      return { kind: "marker", marker, mapRevealed: store.getMap(marker.mapId)?.revealedToPlayers ?? false };
    }
    // No context to resolve: a quest's own reveal flag is the whole player predicate, and a hit carries
    // no entity linkage (unlike the quest RECORD, whose `entityIds` the list route filters).
    case "quest": { const quest = store.getQuest(ref.id); return quest ? { kind: "quest", quest } : null; }
  }
}

/**
 * Of a record's linked PAGE ids, the subset that is itself revealed. This is the resolution both marker
 * routes were already performing inline (`store.getPage(id)?.revealedToPlayers ?? false`, a missing page
 * counting as NOT revealed), lifted out when M10's quest routes became the third caller: three hand-copies
 * of one viewer-safety predicate is three chances for one of them to be weakened alone.
 *
 * It answers the question; it does not make the decision. `projectPlayerMarker` / `projectPlayerQuest`
 * still own what a player may see, and each takes the resolved set as context so no projection reaches
 * back into the store.
 */
function revealedPageIdsIn(store: CodexStore, pageIds: readonly string[]): ReadonlySet<string> {
  return new Set(pageIds.filter((pageId) => store.getPage(pageId)?.revealedToPlayers ?? false));
}

export function createCodexRouter(options: CodexRouterOptions) {
  const router = Router();
  const { store } = options;

  router.use((request, response, next) => {
    response.setHeader("x-request-id", randomUUID());
    response.setHeader("cache-control", "no-store");
    next();
  });

  const roleOf = (request: Request): "gm" | "player" | null => {
    const token = bearer(request);
    if (options.authorizeGm(token)) return "gm";
    if (options.authorizePlayer(token)) return "player";
    return null;
  };
  const requireGm = (request: Request, response: Response, next: NextFunction) => {
    if (!options.authorizeGm(bearer(request))) return failure(response, 401, "unauthenticated", "A valid GM session is required.");
    next();
  };

  // ----- Pages: list + search (GM or player; player sees only revealed) -----

  router.get(`${CODEX_BASE}/pages`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the codex.");
    const filter = {
      folder: request.query.folder === undefined ? undefined : (request.query.folder === "" ? null : String(request.query.folder)),
      tag: request.query.tag === undefined ? undefined : String(request.query.tag)
    };
    const rows = store.listPages(filter);
    const pages = role === "gm" ? rows.map(projectGmPageSummary) : rows.map(projectPlayerPageSummary).filter((page) => page !== null);
    return envelope(response, 200, { pages });
  });

  /**
   * CI-1 / R8: ONE search box, ONE result list, all record types - so this stays the single search
   * route and simply learned to return more kinds, rather than gaining a sibling.
   *
   * `hits` is that one list (pages, journal entries, maps, markers), discriminated by `kind`.
   *
   * A page-only `results` array rode alongside it for exactly one commit, so the client could migrate
   * without a flag-day. Every caller now reads `hits`, so it is gone: two lists answering one query is
   * the parallel-mechanism problem this overhaul exists to remove, and the Codex has no external API
   * consumer to keep it for.
   */
  router.get(`${CODEX_BASE}/search`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to search the codex.");
    const query = typeof request.query.q === "string" ? request.query.q : "";
    const hits = store.searchAll(role, query)
      .map((ref) => loadSearchRecord(store, ref))
      .filter((record) => record !== null)
      .map((record) => (role === "gm" ? projectGmSearchHit(record) : projectPlayerSearchHit(record)))
      .filter((hit) => hit !== null);
    return envelope(response, 200, { hits });
  });

  router.get(`${CODEX_BASE}/pages/:id`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the codex.");
    const page = store.getPage(pathParam(request, "id"));
    if (!page) return failure(response, 404, "not_found", "That page was not found.");
    if (role === "gm") return envelope(response, 200, { page: projectGmPage(page), backlinks: projectGmBacklinks(store.backlinksToPage(page.id)), relationships: projectGmRelationships(store.listRelationshipsFor(page.id)) });
    const projected = projectPlayerPage(page);
    if (!projected) return failure(response, 404, "not_found", "That page was not found.");
    return envelope(response, 200, { page: projected, backlinks: projectPlayerBacklinks(store.backlinksToPage(page.id)), relationships: projectPlayerRelationships(store.listRelationshipsFor(page.id)) });
  });

  // ----- Pages: authoring (GM only) -----

  router.post(`${CODEX_BASE}/pages`, requireGm, (request, response) => {
    try {
      const input = PageCreateSchema.parse(request.body);
      const page = store.createPage(input);
      options.notifyChanged("pages");
      return envelope(response, 201, { page: projectGmPage(page) });
    } catch (error) { return malformed(response, error); }
  });

  router.patch(`${CODEX_BASE}/pages/:id`, requireGm, (request, response) => {
    try {
      const { expectedRev, ...fields } = PageUpdateSchema.parse(request.body);
      const page = store.updatePage(pathParam(request, "id"), fields, expectedRev, "gm");
      options.notifyChanged("pages");
      return envelope(response, 200, { page: projectGmPage(page) });
    } catch (error) {
      if (error instanceof CodexRevisionConflictError) return failure(response, 409, "conflict", error.message);
      if (error instanceof CodexNotFoundError) return failure(response, 404, "not_found", error.message);
      return malformed(response, error);
    }
  });

  router.post(`${CODEX_BASE}/pages/:id/reveal`, requireGm, (request, response) => {
    try {
      const { revealed } = RevealSchema.parse(request.body);
      const page = store.setPageRevealed(pathParam(request, "id"), revealed);
      options.notifyChanged("pages");
      return envelope(response, 200, { page: projectGmPage(page) });
    } catch (error) {
      if (error instanceof CodexNotFoundError) return failure(response, 404, "not_found", error.message);
      return malformed(response, error);
    }
  });

  router.delete(`${CODEX_BASE}/pages/:id`, requireGm, (request, response) => {
    store.deletePage(pathParam(request, "id"));
    options.notifyChanged("pages");
    return envelope(response, 200, { deleted: true });
  });

  router.post(`${CODEX_BASE}/folders/move`, requireGm, (request, response) => {
    try {
      const { from, to } = FolderMoveSchema.parse(request.body);
      const moved = store.moveFolder(from, to);
      options.notifyChanged("pages");
      return envelope(response, 200, { moved });
    } catch (error) { return malformed(response, error); }
  });

  // Folder records make empty folders persist (a folder is otherwise only implied by the pages inside it). GM-only.
  router.get(`${CODEX_BASE}/folders`, requireGm, (_request, response) => envelope(response, 200, { folders: store.listFolders() }));
  // ----- GM preview: mint a real, short-lived player principal (never a role flag on the GM token) -----
  router.post(`${CODEX_BASE}/preview-session`, requireGm, (_request, response) => {
    try { return envelope(response, 201, { token: options.issuePreviewSession() }); }
    catch (error) { return malformed(response, error); }
  });

  router.post(`${CODEX_BASE}/folders`, requireGm, (request, response) => {
    try { const path = store.createFolder(FolderPathSchema.parse(request.body).path); options.notifyChanged("pages"); return envelope(response, 201, { path }); }
    catch (error) { return malformed(response, error); }
  });
  router.post(`${CODEX_BASE}/folders/delete`, requireGm, (request, response) => {
    try { store.deleteFolder(FolderPathSchema.parse(request.body).path); options.notifyChanged("pages"); return envelope(response, 200, { deleted: true }); }
    catch (error) { return malformed(response, error); }
  });

  router.get(`${CODEX_BASE}/pages/:id/revisions`, requireGm, (request, response) => {
    const page = store.getPage(pathParam(request, "id"));
    if (!page) return failure(response, 404, "not_found", "That page was not found.");
    return envelope(response, 200, { revisions: store.listRevisions(page.id) });
  });

  router.post(`${CODEX_BASE}/pages/:id/revisions/:revisionId/restore`, requireGm, (request, response) => {
    try {
      const revisionId = Number(request.params.revisionId);
      if (!Number.isInteger(revisionId)) return failure(response, 400, "validation_failed", "The revision id is malformed.");
      const page = store.restoreRevision(pathParam(request, "id"), revisionId, "gm");
      options.notifyChanged("pages");
      return envelope(response, 200, { page: projectGmPage(page) });
    } catch (error) {
      if (error instanceof CodexNotFoundError) return failure(response, 404, "not_found", error.message);
      return malformed(response, error);
    }
  });

  // ----- Relationships (typed entity edges) -----

  router.post(`${CODEX_BASE}/pages/:id/relationships`, requireGm, (request, response) => {
    try { const { toPageId, type } = RelationshipCreateSchema.parse(request.body); const relationship = store.createRelationship(pathParam(request, "id"), toPageId, type); options.notifyChanged("pages"); return envelope(response, 201, { relationship }); }
    catch (error) { return codexError(response, error); }
  });

  router.delete(`${CODEX_BASE}/relationships/:id`, requireGm, (request, response) => {
    store.deleteRelationship(pathParam(request, "id"));
    options.notifyChanged("pages");
    return envelope(response, 200, { deleted: true });
  });

  router.get(`${CODEX_BASE}/relationships`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the codex.");
    const all = store.listAllRelationships();
    if (role === "gm") return envelope(response, 200, { relationships: all });
    // Player graph: project through the choke point - only edges whose BOTH endpoints are revealed pages.
    const revealed = new Set(store.listPages().filter((page) => page.revealedToPlayers).map((page) => page.id));
    return envelope(response, 200, { relationships: projectPlayerRelationshipEdges(all, revealed) });
  });

  /**
   * CI-8: the whole-graph WIKI-LINK feed - the sibling of the typed-edge route above, and deliberately
   * its neighbour. The Graph drew only typed relationships, so a codex wired together with `[[links]]`
   * looked like a field of orphans; it now draws both kinds, visually distinguished.
   *
   * A player's edges obey the SAME both-endpoints-revealed rule the typed feed enforces (a dangling edge
   * would let a player infer a hidden page exists) AND the layer rule `projectPlayerBacklinks` applies -
   * player-body links only, never the GM body's. `projectPlayerLinkEdges` holds both; the store hands
   * over raw rows so that projection is the only gate.
   */
  router.get(`${CODEX_BASE}/links`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the codex.");
    const all = store.listAllLinks();
    if (role === "gm") return envelope(response, 200, { links: projectGmLinkEdges(all) });
    const revealed = new Set(store.listPages().filter((page) => page.revealedToPlayers).map((page) => page.id));
    return envelope(response, 200, { links: projectPlayerLinkEdges(all, revealed) });
  });

  // ----- Maps (the atlas tree) -----

  router.get(`${CODEX_BASE}/maps`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the atlas.");
    const rows = store.listMaps();
    // A player's map keeps its parent link only when that parent is itself revealed - resolve per row (mirrors the marker route below).
    const revealed = new Set(rows.filter((row) => row.revealedToPlayers).map((row) => row.id));
    const maps = role === "gm"
      ? rows.map(projectGmMap)
      : rows.map((row) => projectPlayerMap(row, { parentRevealed: row.parentMapId ? revealed.has(row.parentMapId) : false })).filter((map) => map !== null);
    return envelope(response, 200, { maps });
  });

  router.post(`${CODEX_BASE}/maps`, requireGm, (request, response) => {
    try { const map = store.createMap(MapCreateSchema.parse(request.body)); options.notifyChanged("maps"); return envelope(response, 201, { map: projectGmMap(map) }); }
    catch (error) { return codexError(response, error); }
  });

  router.patch(`${CODEX_BASE}/maps/:id`, requireGm, (request, response) => {
    try { const map = store.updateMap(pathParam(request, "id"), MapUpdateSchema.parse(request.body)); options.notifyChanged("maps"); return envelope(response, 200, { map: projectGmMap(map) }); }
    catch (error) { return codexError(response, error); }
  });

  router.post(`${CODEX_BASE}/maps/:id/parent`, requireGm, (request, response) => {
    try { const map = store.setMapParent(pathParam(request, "id"), MapParentSchema.parse(request.body).parentMapId); options.notifyChanged("maps"); return envelope(response, 200, { map: projectGmMap(map) }); }
    catch (error) { return codexError(response, error); }
  });

  router.post(`${CODEX_BASE}/maps/:id/reveal`, requireGm, (request, response) => {
    try { const map = store.setMapRevealed(pathParam(request, "id"), RevealSchema.parse(request.body).revealed); options.notifyChanged("maps"); return envelope(response, 200, { map: projectGmMap(map) }); }
    catch (error) { return codexError(response, error); }
  });

  router.delete(`${CODEX_BASE}/maps/:id`, requireGm, (request, response) => {
    store.deleteMap(pathParam(request, "id"));
    options.notifyChanged("maps");
    return envelope(response, 200, { deleted: true });
  });

  // ----- Markers -----

  router.get(`${CODEX_BASE}/maps/:id/markers`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the atlas.");
    const mapId = pathParam(request, "id");
    const map = store.getMap(mapId);
    if (!map) return failure(response, 404, "not_found", "That map was not found.");
    const rows = store.listMarkers(mapId);
    if (role === "gm") return envelope(response, 200, { markers: rows.map(projectGmMarker) });
    if (!map.revealedToPlayers) return failure(response, 404, "not_found", "That map was not found.");
    const markers = rows
      .map((row) => projectPlayerMarker(row, {
        revealedPageIds: revealedPageIdsIn(store, row.pageIds),
        subMapRevealed: row.subMapId ? (store.getMap(row.subMapId)?.revealedToPlayers ?? false) : false
      }))
      .filter((marker) => marker !== null);
    return envelope(response, 200, { markers });
  });

  /**
   * CI-4, the REVERSE of the route directly above: which pins on the atlas point at THIS page, so an open
   * page can offer "seen on the map" instead of the Atlas being the only way to find out.
   *
   * This is a NEW player-reachable read, so nothing about its gating is invented - every clause is copied
   * from a route that already enforces it, and it is deliberately placed beside the forward read so the
   * two can be compared at a glance:
   *   - the PAGE gate comes from `GET /codex/journal?pageId=`: a player may only ask about a location
   *     they can already see, so an unrevealed page 404s before any pin is considered. Without it, a page
   *     id (however obtained) becomes a probe for "does the party have a pin on this place?".
   *   - each pin then goes through `projectPlayerPageMarker`, which is `projectPlayerMarker` PLUS the map
   *     gate the forward route applies before it projects anything (CD-6). A revealed pin on a secret map
   *     is invisible on the Atlas and is invisible here.
   * The store's `markersForPage` is deliberately ungated, so this projection is the ONLY gate.
   */
  router.get(`${CODEX_BASE}/pages/:id/markers`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the atlas.");
    const page = store.getPage(pathParam(request, "id"));
    if (!page) return failure(response, 404, "not_found", "That page was not found.");
    if (role !== "gm" && !page.revealedToPlayers) return failure(response, 404, "not_found", "That page was not found.");
    const rows = store.markersForPage(page.id);
    if (role === "gm") return envelope(response, 200, { markers: rows.map(projectGmMarker) });
    const markers = rows
      .map((row) => projectPlayerPageMarker({
        marker: row,
        mapRevealed: store.getMap(row.mapId)?.revealedToPlayers ?? false,
        revealedPageIds: revealedPageIdsIn(store, row.pageIds),
        subMapRevealed: row.subMapId ? (store.getMap(row.subMapId)?.revealedToPlayers ?? false) : false
      }))
      .filter((marker) => marker !== null);
    return envelope(response, 200, { markers });
  });

  router.post(`${CODEX_BASE}/maps/:id/markers`, requireGm, (request, response) => {
    try { const marker = store.createMarker(pathParam(request, "id"), MarkerCreateSchema.parse(request.body)); options.notifyChanged("markers"); return envelope(response, 201, { marker: projectGmMarker(marker) }); }
    catch (error) { return codexError(response, error); }
  });

  router.patch(`${CODEX_BASE}/markers/:id`, requireGm, (request, response) => {
    try { const marker = store.updateMarker(pathParam(request, "id"), MarkerUpdateSchema.parse(request.body)); options.notifyChanged("markers"); return envelope(response, 200, { marker: projectGmMarker(marker) }); }
    catch (error) { return codexError(response, error); }
  });

  router.post(`${CODEX_BASE}/markers/:id/move`, requireGm, (request, response) => {
    try { const { x, y } = MarkerMoveSchema.parse(request.body); const marker = store.moveMarker(pathParam(request, "id"), x, y); options.notifyChanged("markers"); return envelope(response, 200, { marker: projectGmMarker(marker) }); }
    catch (error) { return codexError(response, error); }
  });

  router.post(`${CODEX_BASE}/markers/:id/reveal`, requireGm, (request, response) => {
    try { const marker = store.setMarkerRevealed(pathParam(request, "id"), RevealSchema.parse(request.body).revealed); options.notifyChanged("markers"); return envelope(response, 200, { marker: projectGmMarker(marker) }); }
    catch (error) { return codexError(response, error); }
  });

  router.delete(`${CODEX_BASE}/markers/:id`, requireGm, (request, response) => {
    store.deleteMarker(pathParam(request, "id"));
    options.notifyChanged("markers");
    return envelope(response, 200, { deleted: true });
  });

  // ----- Journal / timeline -----

  router.get(`${CODEX_BASE}/journal`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the journal.");
    const markerId = typeof request.query.markerId === "string" ? request.query.markerId : undefined;
    const pageId = typeof request.query.pageId === "string" ? request.query.pageId : undefined;
    // A player may read a location's mini-timeline only when the location (marker/page) is itself revealed -
    // otherwise a hidden pin/page id (however obtained) could be probed. Entry-level reveal is still enforced below.
    if (role !== "gm") {
      if (markerId && !store.getMarker(markerId)?.revealedToPlayers) return failure(response, 404, "not_found", "That was not found.");
      if (pageId && !store.getPage(pageId)?.revealedToPlayers) return failure(response, 404, "not_found", "That was not found.");
    }
    const rows = markerId || pageId ? store.listEntriesFor({ markerId, pageId }) : store.listTimeline();
    const entries = role === "gm" ? rows.map(projectGmJournalEntry) : rows.map(projectPlayerJournalEntry).filter((entry) => entry !== null);
    return envelope(response, 200, { entries });
  });

  /**
   * CT-11 / CT-12: **the one chronicle** - journal entries and dated `event` pages in one chronological
   * list, one row shape (R2). Both lenses read this; "by session" is a REGROUPING of these same records,
   * not a second fetch, so the two lenses cannot disagree about what exists.
   *
   * A NEW player-reachable read, and the design doc calls out exactly why that matters: the player Codex
   * fetches the timeline, so every record kind that resolves onto the chronicle is player-reachable by
   * DEFAULT rather than by decision. Nothing here filters - `store.listChronicle()` is ungated on purpose
   * and `projectPlayerChronicleRecord` is the single gate (K1), which in turn delegates to the page and
   * journal player projections rather than restating them.
   *
   * Deliberately a NEW route rather than a widened `GET /codex/journal`: that route's `entries` are journal
   * rows, read by the page mini-timeline, the marker mini-timeline and the Campaign dashboard. Making it
   * polymorphic would hand three unrelated callers records they never asked for.
   */
  router.get(`${CODEX_BASE}/timeline`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the chronicle.");
    const rows = store.listChronicle();
    const records = role === "gm" ? rows.map(projectGmChronicleRecord) : rows.map(projectPlayerChronicleRecord).filter((record) => record !== null);
    return envelope(response, 200, { records });
  });

  router.post(`${CODEX_BASE}/journal`, requireGm, (request, response) => {
    try { const entry = store.createEntry(JournalWriteSchema.parse(request.body)); options.notifyChanged("journal"); return envelope(response, 201, { entry: projectGmJournalEntry(entry) }); }
    catch (error) { return codexError(response, error); }
  });

  router.patch(`${CODEX_BASE}/journal/:id`, requireGm, (request, response) => {
    try { const entry = store.updateEntry(pathParam(request, "id"), JournalWriteSchema.parse(request.body)); options.notifyChanged("journal"); return envelope(response, 200, { entry: projectGmJournalEntry(entry) }); }
    catch (error) { return codexError(response, error); }
  });

  router.post(`${CODEX_BASE}/journal/:id/reveal`, requireGm, (request, response) => {
    try { const entry = store.setEntryRevealed(pathParam(request, "id"), RevealSchema.parse(request.body).revealed); options.notifyChanged("journal"); return envelope(response, 200, { entry: projectGmJournalEntry(entry) }); }
    catch (error) { return codexError(response, error); }
  });

  router.delete(`${CODEX_BASE}/journal/:id`, requireGm, (request, response) => {
    store.deleteEntry(pathParam(request, "id"));
    options.notifyChanged("journal");
    return envelope(response, 200, { deleted: true });
  });

  /**
   * M9: SESSIONS - the GM's prep on one side, the players' recap on the other. A new player-reachable
   * read, so nothing about its gating is invented: the reads branch on `roleOf` and project through
   * `codex-projections.ts` exactly as the page reads directly above do, and an unrevealed session 404s a
   * player rather than 403ing, because a status code that distinguishes "secret" from "absent" IS the
   * leak (the `GET /codex/pages/:id` rule).
   *
   * There is deliberately NO `/codex/sessions/:id/entries`. The client already holds the chronicle, whose
   * records carry `sessionNumber`, so "the entries for session 4" is a filter over data the caller has -
   * adding a route would add a second player-reachable surface and a second reveal gate to keep in step
   * with the first. Sessions likewise do NOT join `GET /codex/timeline`: a session has no
   * `calendarInstant`, and `compareChronicle` sorts every undated record below every dated one, so they
   * would clump beneath the very entries they contain.
   */
  router.get(`${CODEX_BASE}/sessions`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the session log.");
    const rows = store.listSessions();
    if (role === "gm") return envelope(response, 200, { sessions: rows.map(projectGmSession), activeSessionId: store.activeSessionId });
    // A player gets `activeSessionId: null`, never the real id: it names a record that may well be
    // unrevealed, and a player has no use for it. The KEY stays present so one response shape serves both
    // roles - a key that appears only for the GM is a tell in itself.
    return envelope(response, 200, { sessions: rows.map(projectPlayerSession).filter((session) => session !== null), activeSessionId: null });
  });

  router.post(`${CODEX_BASE}/sessions`, requireGm, (request, response) => {
    try { const session = store.createSession(SessionCreateSchema.parse(request.body)); options.notifyChanged("sessions"); return envelope(response, 201, { session: projectGmSession(session) }); }
    catch (error) { return codexError(response, error); }
  });

  router.get(`${CODEX_BASE}/sessions/:id`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the session log.");
    const session = store.getSession(pathParam(request, "id"));
    if (!session) return failure(response, 404, "not_found", "That session was not found.");
    if (role === "gm") return envelope(response, 200, { session: projectGmSession(session) });
    const projected = projectPlayerSession(session);
    // The SAME 404 an absent session gets, deliberately - never 403.
    if (!projected) return failure(response, 404, "not_found", "That session was not found.");
    return envelope(response, 200, { session: projected });
  });

  router.patch(`${CODEX_BASE}/sessions/:id`, requireGm, (request, response) => {
    try {
      const { expectedRev, ...fields } = SessionUpdateSchema.parse(request.body);
      const session = store.updateSession(pathParam(request, "id"), fields, expectedRev, "gm");
      options.notifyChanged("sessions");
      return envelope(response, 200, { session: projectGmSession(session) });
    } catch (error) { return codexError(response, error); }
  });

  router.delete(`${CODEX_BASE}/sessions/:id`, requireGm, (request, response) => {
    store.deleteSession(pathParam(request, "id"));
    options.notifyChanged("sessions");
    return envelope(response, 200, { deleted: true });
  });

  router.post(`${CODEX_BASE}/sessions/:id/reveal`, requireGm, (request, response) => {
    try { const session = store.setSessionRevealed(pathParam(request, "id"), RevealSchema.parse(request.body).revealed); options.notifyChanged("sessions"); return envelope(response, 200, { session: projectGmSession(session) }); }
    catch (error) { return codexError(response, error); }
  });

  /**
   * Point the table at this session. Returns only the pointer, not the record: activating changes nothing
   * ABOUT the session (see `setActiveSession` - no `rev`, no `updated_at`), so echoing the row back would
   * imply an edit that did not happen.
   */
  router.post(`${CODEX_BASE}/sessions/:id/activate`, requireGm, (request, response) => {
    try { const activeSessionId = store.setActiveSession(pathParam(request, "id")); options.notifyChanged("sessions"); return envelope(response, 200, { activeSessionId }); }
    catch (error) { return codexError(response, error); }
  });

  /**
   * M10: QUESTS - what is still open. The session routes directly above are the model, verbatim: the reads
   * branch on `roleOf` and project through `codex-projections.ts`, every write is `requireGm`, and an
   * unrevealed quest 404s a player rather than 403ing, because a status code that distinguishes "secret"
   * from "absent" IS the leak (the `GET /codex/pages/:id` rule).
   *
   * The one thing a session route does not have to do: a quest's `entityIds` ARE codex page ids, and a
   * player's copy carries them, so the caller resolves which of those pages are themselves revealed and
   * hands the set to the projection - `revealedPageIdsIn`, the same helper both marker routes use for a
   * pin's `pageIds`. Resolved here rather than inside the projection so there is still exactly one place
   * that decides what a player may see.
   *
   * There is deliberately NO `/codex/quests/:id/objectives`: objectives are a field of the quest, replaced
   * wholesale by PATCH. A sub-resource would be a second write path into one record, with its own `rev`
   * story to get wrong - and reordering, inserting and deleting would each need their own verb.
   */
  router.get(`${CODEX_BASE}/quests`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the quest log.");
    const rows = store.listQuests();
    if (role === "gm") return envelope(response, 200, { quests: rows.map(projectGmQuest) });
    const quests = rows
      .map((row) => projectPlayerQuest(row, { revealedEntityIds: revealedPageIdsIn(store,row.entityIds) }))
      .filter((quest) => quest !== null);
    return envelope(response, 200, { quests });
  });

  router.post(`${CODEX_BASE}/quests`, requireGm, (request, response) => {
    try { const quest = store.createQuest(QuestCreateSchema.parse(request.body)); options.notifyChanged("quests"); return envelope(response, 201, { quest: projectGmQuest(quest) }); }
    catch (error) { return codexError(response, error); }
  });

  router.get(`${CODEX_BASE}/quests/:id`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the quest log.");
    const quest = store.getQuest(pathParam(request, "id"));
    if (!quest) return failure(response, 404, "not_found", "That quest was not found.");
    if (role === "gm") return envelope(response, 200, { quest: projectGmQuest(quest) });
    const projected = projectPlayerQuest(quest, { revealedEntityIds: revealedPageIdsIn(store,quest.entityIds) });
    // The SAME 404 an absent quest gets, deliberately - never 403.
    if (!projected) return failure(response, 404, "not_found", "That quest was not found.");
    return envelope(response, 200, { quest: projected });
  });

  router.patch(`${CODEX_BASE}/quests/:id`, requireGm, (request, response) => {
    try {
      const { expectedRev, ...fields } = QuestUpdateSchema.parse(request.body);
      const quest = store.updateQuest(pathParam(request, "id"), fields, expectedRev);
      options.notifyChanged("quests");
      return envelope(response, 200, { quest: projectGmQuest(quest) });
    } catch (error) { return codexError(response, error); }
  });

  router.delete(`${CODEX_BASE}/quests/:id`, requireGm, (request, response) => {
    store.deleteQuest(pathParam(request, "id"));
    options.notifyChanged("quests");
    return envelope(response, 200, { deleted: true });
  });

  router.post(`${CODEX_BASE}/quests/:id/reveal`, requireGm, (request, response) => {
    try { const quest = store.setQuestRevealed(pathParam(request, "id"), RevealSchema.parse(request.body).revealed); options.notifyChanged("quests"); return envelope(response, 200, { quest: projectGmQuest(quest) }); }
    catch (error) { return codexError(response, error); }
  });

  // ----- Calendar (the world's own months / weekdays / era) -----

  router.get(`${CODEX_BASE}/calendar`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the calendar.");
    return envelope(response, 200, { calendar: store.getCalendar() });
  });

  router.put(`${CODEX_BASE}/calendar`, requireGm, (request, response) => {
    try { const calendar = store.setCalendar(CalendarSchema.parse(request.body)); options.notifyChanged("journal"); return envelope(response, 200, { calendar }); }
    catch (error) { return malformed(response, error); }
  });

  // ----- Export (GM backup / round-trip) -----

  router.get(`${CODEX_BASE}/export`, requireGm, (_request, response) => {
    return envelope(response, 200, { codex: store.exportBundle(), exportedAt: new Date().toISOString() });
  });

  // ----- Media (page banners + inline images) -----

  router.post(CODEX_ASSET_BASE, requireGm, express.raw({ type: () => true, limit: "11mb" }), async (request, response) => {
    try {
      if (!Buffer.isBuffer(request.body) || request.body.length === 0) return failure(response, 400, "validation_failed", "Upload the image as the request body.");
      const filename = typeof request.query.filename === "string" ? request.query.filename : "image";
      const imported = await options.assets.import(request.body, filename);
      return envelope(response, imported.duplicate ? 200 : 201, { asset: { id: imported.metadata.id, width: imported.metadata.width, height: imported.metadata.height, mediaType: imported.metadata.mediaType } });
    } catch (error) { return failure(response, 400, "validation_failed", error instanceof Error ? error.message : "The image upload failed."); }
  });

  router.get(`${CODEX_ASSET_BASE}/:id/content`, async (request, response) => {
    const id = pathParam(request, "id");
    const token = bearer(request);
    // GM always; a player only when the asset is used by a revealed page (banner or inline image).
    const allowed = options.authorizeGm(token) || (options.authorizePlayer(token) && store.isPageAssetVisibleToPlayers(id));
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

  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    return failure(response, 500, "internal_error", error instanceof Error ? error.message : "The codex request failed.");
  });
  return router;
}
