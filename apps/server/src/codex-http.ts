import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { API_VERSION } from "@vtt/api-contract";
import { CodexNotFoundError, CodexRevisionConflictError, type CodexStore } from "./codex-store.js";
import { projectGmBacklinks, projectGmPage, projectGmPageSummary, projectPlayerBacklinks, projectPlayerPage, projectPlayerPageSummary } from "./codex-projections.js";

/**
 * The codex REST surface (`/api/v1/codex/*`), a GM-authed router mounted in `server.ts` alongside the
 * map/token/viewer routers - the same pattern maps use, deliberately OUTSIDE the GameState broadcast.
 * Every write bumps the store's coarse revision and pings clients via `notifyChanged`; every read
 * branches on the caller's role and projects through `codex-projections.ts` so `gmBody` and unrevealed
 * pages can never reach a player.
 */

const CODEX_BASE = "/api/v1/codex";

const TagsSchema = z.array(z.string().trim().min(1).max(40)).max(24);
const PageCreateSchema = z.object({
  title: z.string().trim().min(1).max(160),
  folder: z.string().max(60).nullable().optional(),
  tags: TagsSchema.optional(),
  playerBody: z.string().max(100_000).optional(),
  gmBody: z.string().max(100_000).optional(),
  revealedToPlayers: z.boolean().optional(),
  bannerAssetId: z.string().uuid().nullable().optional()
}).strict();
const PageUpdateSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  folder: z.string().max(60).nullable().optional(),
  tags: TagsSchema.optional(),
  playerBody: z.string().max(100_000).optional(),
  gmBody: z.string().max(100_000).optional(),
  bannerAssetId: z.string().uuid().nullable().optional(),
  expectedRev: z.number().int().nonnegative().optional()
}).strict();
const RevealSchema = z.object({ revealed: z.boolean() }).strict();

type CodexRouterOptions = Readonly<{
  store: CodexStore;
  authorizeGm: (token: string | undefined) => boolean;
  authorizePlayer: (token: string | undefined) => boolean;
  /** Emit a content-free `codex:changed` ping so every client refetches its projected view. */
  notifyChanged: (scope: "pages" | "maps" | "markers" | "journal") => void;
}>;

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

  router.get(`${CODEX_BASE}/search`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to search the codex.");
    const query = typeof request.query.q === "string" ? request.query.q : "";
    const hits = store.searchPages(role, query);
    const results = hits
      .map((hit) => store.getPage(hit.pageId))
      .filter((page) => page !== null)
      .map((page) => (role === "gm" ? projectGmPageSummary(page) : projectPlayerPageSummary(page)))
      .filter((page) => page !== null);
    return envelope(response, 200, { results });
  });

  router.get(`${CODEX_BASE}/pages/:id`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the codex.");
    const page = store.getPage(pathParam(request, "id"));
    if (!page) return failure(response, 404, "not_found", "That page was not found.");
    if (role === "gm") return envelope(response, 200, { page: projectGmPage(page), backlinks: projectGmBacklinks(store.backlinksToPage(page.id)) });
    const projected = projectPlayerPage(page);
    if (!projected) return failure(response, 404, "not_found", "That page was not found.");
    return envelope(response, 200, { page: projected, backlinks: projectPlayerBacklinks(store.backlinksToPage(page.id)) });
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

  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    return failure(response, 500, "internal_error", error instanceof Error ? error.message : "The codex request failed.");
  });
  return router;
}
