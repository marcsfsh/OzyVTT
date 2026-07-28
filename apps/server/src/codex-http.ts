import { randomUUID } from "node:crypto";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { API_VERSION } from "@vtt/api-contract";
import type { MapAssetStore } from "./map-assets.js";
import { CodexNotFoundError, CodexRevisionConflictError, type CodexSearchRef, type CodexStore } from "./codex-store.js";
import { projectGmBacklinks, projectGmJournalEntry, projectGmMap, projectGmMarker, projectGmPage, projectGmPageSummary, projectGmRelationships, projectGmSearchHit, projectPlayerBacklinks, projectPlayerJournalEntry, projectPlayerMap, projectPlayerMarker, projectPlayerPage, projectPlayerPageSummary, projectPlayerRelationships, projectPlayerRelationshipEdges, projectPlayerSearchHit, type CodexSearchRecord } from "./codex-projections.js";

/**
 * The codex REST surface (`/api/v1/codex/*`), a GM-authed router mounted in `server.ts` alongside the
 * map/token/viewer routers - the same pattern maps use, deliberately OUTSIDE the GameState broadcast.
 * Every write bumps the store's coarse revision and pings clients via `notifyChanged`; every read
 * branches on the caller's role and projects through `codex-projections.ts` so `gmBody` and unrevealed
 * pages can never reach a player.
 */

const CODEX_BASE = "/api/v1/codex";

const TagsSchema = z.array(z.string().trim().min(1).max(40)).max(24);
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
  bannerAssetId: z.string().uuid().nullable().optional()
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
  inWorldDate: z.object({ year: z.number().int().min(-100_000).max(100_000), month: z.number().int().min(0).max(23), day: z.number().int().min(1).max(400) }).nullable().optional()
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
  notifyChanged: (scope: "pages" | "maps" | "markers" | "journal") => void;
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
  }
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
   * `results` is the pre-CI-1 page-only list, kept so a client written before this keeps working, and
   * droppable once the client reads `hits`. It is the SAME index read through the same per-kind
   * predicate, just filtered to pages - not a second search mechanism - which is why it is a separate
   * read rather than a slice of `hits`: slicing would let 50 marker matches crowd pages out of a list
   * whose whole job is to behave exactly as it did before.
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
    const results = store.searchPages(role, query)
      .map((hit) => store.getPage(hit.pageId))
      .filter((page) => page !== null)
      .map((page) => (role === "gm" ? projectGmPageSummary(page) : projectPlayerPageSummary(page)))
      .filter((page) => page !== null);
    return envelope(response, 200, { results, hits });
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
        revealedPageIds: new Set(row.pageIds.filter((pageId) => store.getPage(pageId)?.revealedToPlayers ?? false)),
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
