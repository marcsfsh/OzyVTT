import { randomUUID } from "node:crypto";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { API_VERSION } from "@vtt/api-contract";
import type { MapAssetMetadata, MapAssetStore } from "./map-assets.js";
import type { TokenCatalogEntry, TokenCatalogStore } from "./token-catalog.js";

const TOKEN_COLLECTION = "/api/v1/token-assets";
const TOKEN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DEFINITION_ID = /^[a-z0-9-]+$/;
const DetailsSchema = z
  .object({ name: z.string().optional(), folder: z.string().nullable().optional(), hidden: z.boolean().optional() })
  .strict();
const FolderRenameSchema = z.object({ from: z.string(), to: z.string().nullable() }).strict();
const FolderVisibilitySchema = z.object({ folder: z.string().nullable(), hidden: z.boolean() }).strict();
/** Where a player's own upload lands, so the GM can find (and curate) the shelf at a glance. */
const PLAYER_UPLOAD_FOLDER = "Player uploads";
/** Images one player session may upload per day. File size, image validation and dedupe already bound
 *  each file; this bounds the count so a phone can't fill the disk. In-memory, so a restart resets it. */
const PLAYER_UPLOADS_PER_DAY = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

type TokenRouterOptions = Readonly<{
  assets: MapAssetStore;
  catalog: TokenCatalogStore;
  authorizeGm: (token: string | undefined) => boolean;
  authorizePlayer: (token: string | undefined, assetId: string) => boolean;
  authorizeViewer: (token: string | undefined, assetId: string) => boolean;
  /** Resolves a joined player session (for browse and upload); its id keys the upload cap. Absent means GM-only. */
  playerSession?: (token: string | undefined) => Readonly<{ sessionId: string }> | null;
  now?: () => number;
}>;

function bearer(request: Request) {
  return request.header("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
}
function viewerCookie(request: Request) {
  for (const part of (request.header("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === "vtt_viewer_session")
      return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return undefined;
}
/** ADR-0016: echo a caller's X-Request-Id only when it is a UUID v4, replace anything else. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function requestId(request: Request, response: Response) {
  const supplied = request.header("x-request-id");
  const id = supplied && UUID_V4.test(supplied) ? supplied : randomUUID();
  response.setHeader("x-request-id", id);
  response.setHeader("cache-control", "no-store");
  return id;
}
function success(response: Response, status: number, data: unknown) {
  return response.status(status).json({ ok: true, apiVersion: API_VERSION, data });
}
function failure(request: Request, response: Response, status: number, code: string, message: string) {
  const id = response.getHeader("x-request-id")?.toString() ?? requestId(request, response);
  return response.status(status).json({ ok: false, apiVersion: API_VERSION, error: { code, message, requestId: id } });
}
function tokenId(request: Request) {
  const id = request.params.id;
  return typeof id === "string" && TOKEN_ID.test(id) ? id : null;
}
function publicToken(metadata: MapAssetMetadata, entry: TokenCatalogEntry) {
  return {
    id: metadata.id,
    name: entry.name,
    folder: entry.folder,
    mediaType: metadata.mediaType,
    width: metadata.width,
    height: metadata.height,
    byteLength: metadata.byteLength,
    importedAt: metadata.importedAt,
    lastUsedAt: entry.lastUsedAt,
    hidden: entry.hidden
  };
}

/** HTTP for uploaded token images, mirroring the map router. The GM uploads and manages; content is
 *  readable by anyone who can already see a token referencing it (a public actor for a player, a
 *  presented token for a viewer). Mounted before the /api/v1 catch-all. */
export function createTokenRouter(options: TokenRouterOptions) {
  const router = Router();
  router.use((request, response, next) => {
    requestId(request, response);
    next();
  });
  const requireGm = (request: Request, response: Response, next: NextFunction) => {
    if (!options.authorizeGm(bearer(request)))
      return failure(request, response, 401, "unauthenticated", "A valid GM session is required.");
    next();
  };
  const canReadContent = (request: Request, assetId: string) => {
    const token = bearer(request);
    return (
      options.authorizeGm(token) ||
      options.authorizePlayer(token, assetId) ||
      options.authorizeViewer(viewerCookie(request), assetId)
    );
  };

  /** A player may upload their own character's token. The GM keeps every management route; a player gets
   *  only this upload and the browse list, with uploads landing in one folder the GM can curate. */
  const requireGmOrPlayer = (request: Request, response: Response, next: NextFunction) => {
    const token = bearer(request);
    if (options.authorizeGm(token)) {
      response.locals.tokenPrincipal = { role: "gm" };
      return next();
    }
    const player = options.playerSession?.(token) ?? null;
    if (player) {
      response.locals.tokenPrincipal = { role: "player", sessionId: player.sessionId };
      return next();
    }
    return failure(request, response, 401, "unauthenticated", "A valid GM or player session is required.");
  };
  const principalOf = (response: Response) =>
    response.locals.tokenPrincipal as { role: "gm" } | { role: "player"; sessionId: string };

  const uploads = new Map<string, number[]>();
  function withinUploadCap(sessionId: string): boolean {
    const now = (options.now ?? Date.now)();
    const recent = (uploads.get(sessionId) ?? []).filter((at) => now - at < DAY_MS);
    if (recent.length >= PLAYER_UPLOADS_PER_DAY) {
      uploads.set(sessionId, recent);
      return false;
    }
    uploads.set(sessionId, [...recent, now]);
    return true;
  }

  router.post(
    TOKEN_COLLECTION,
    requireGmOrPlayer,
    express.raw({ type: () => true, limit: "6mb" }),
    async (request, response) => {
      try {
        const principal = principalOf(response);
        if (principal.role === "player" && !withinUploadCap(principal.sessionId)) {
          return failure(
            request,
            response,
            429,
            "rate_limited",
            `You can upload up to ${PLAYER_UPLOADS_PER_DAY} token images a day - ask your GM to add more.`
          );
        }
        if (!Buffer.isBuffer(request.body))
          return failure(request, response, 400, "validation_failed", "Upload the image as the request body.");
        const filename = typeof request.query.filename === "string" ? request.query.filename : "token";
        const name = typeof request.query.name === "string" ? request.query.name : filename.replace(/\.[^.]+$/, "");
        // A player does not choose the folder: their uploads land on one shelf the GM can curate.
        const folder =
          principal.role === "player"
            ? PLAYER_UPLOAD_FOLDER
            : typeof request.query.folder === "string"
              ? request.query.folder
              : null;
        // The same validation as map assets: real image, real dimensions, content-hash dedupe.
        const imported = await options.assets.import(request.body, filename);
        const entry = options.catalog.register(imported.metadata.id, name, folder);
        return success(response, imported.duplicate ? 200 : 201, {
          token: publicToken(imported.metadata, entry),
          duplicate: imported.duplicate
        });
      } catch (error) {
        return failure(
          request,
          response,
          400,
          "validation_failed",
          error instanceof Error ? error.message : "Token upload failed."
        );
      }
    }
  );

  router.get(TOKEN_COLLECTION, requireGmOrPlayer, async (request, response) => {
    const principal = principalOf(response);
    // The curation filter lives in the store, so this route cannot forget it.
    const entries = options.catalog.list(principal.role === "gm" ? "gm" : "player");
    const tokens = (
      await Promise.all(
        entries.map(async (entry) => {
          const metadata = await options.assets.get(entry.assetId);
          return metadata ? publicToken(metadata, entry) : null;
        })
      )
    ).filter((token) => token !== null);
    const definitionId =
      typeof request.query.definitionId === "string" && DEFINITION_ID.test(request.query.definitionId)
        ? request.query.definitionId
        : null;
    // The per-definition memory is GM prep, not a player's business.
    const rememberedAssetId =
      principal.role === "gm" && definitionId ? options.catalog.recallForDefinition(definitionId) : null;
    return success(response, 200, { tokens, rememberedAssetId });
  });

  router.post(`${TOKEN_COLLECTION}/folders/rename`, requireGm, (request, response) => {
    try {
      const input = FolderRenameSchema.parse(request.body);
      options.catalog.renameFolder(input.from, input.to);
      return success(response, 200, { renamed: true });
    } catch (error) {
      return failure(
        request,
        response,
        400,
        "validation_failed",
        error instanceof z.ZodError ? "Folder rename is malformed." : (error as Error).message
      );
    }
  });

  /** Hide or re-offer every token in one folder. GM only. */
  router.post(`${TOKEN_COLLECTION}/folders/visibility`, requireGm, (request, response) => {
    try {
      const input = FolderVisibilitySchema.parse(request.body);
      options.catalog.setFolderHidden(input.folder, input.hidden);
      return success(response, 200, { folder: input.folder, hidden: input.hidden });
    } catch (error) {
      return failure(
        request,
        response,
        400,
        "validation_failed",
        error instanceof z.ZodError ? "Folder visibility is malformed." : (error as Error).message
      );
    }
  });

  router.patch(`${TOKEN_COLLECTION}/:id`, requireGm, (request, response) => {
    try {
      const id = tokenId(request);
      if (!id) return failure(request, response, 400, "validation_failed", "Token asset ID is malformed.");
      if (!options.catalog.get(id)) return failure(request, response, 404, "not_found", "Token asset was not found.");
      return success(response, 200, { token: options.catalog.updateDetails(id, DetailsSchema.parse(request.body)) });
    } catch (error) {
      return failure(
        request,
        response,
        400,
        "validation_failed",
        error instanceof z.ZodError ? "Token details are malformed." : (error as Error).message
      );
    }
  });

  router.delete(`${TOKEN_COLLECTION}/:id`, requireGm, async (request, response) => {
    const id = tokenId(request);
    if (!id) return failure(request, response, 400, "validation_failed", "Token asset ID is malformed.");
    options.catalog.remove(id);
    await options.assets.remove(id);
    return success(response, 200, { removed: true });
  });

  router.get(`${TOKEN_COLLECTION}/:id/content`, async (request, response) => {
    const id = tokenId(request);
    if (!id) return failure(request, response, 400, "validation_failed", "Token asset ID is malformed.");
    if (!canReadContent(request, id))
      return failure(request, response, 403, "forbidden", "That token image is not available to this table session.");
    const metadata = await options.assets.get(id);
    const content = metadata ? await options.assets.readOriginal(id) : null;
    if (!metadata || !content) return failure(request, response, 404, "not_found", "Token asset was not found.");
    const etag = `"${id}"`;
    response.setHeader("etag", etag);
    response.setHeader("content-type", metadata.mediaType);
    response.setHeader("content-disposition", `inline; filename="${id}.${metadata.extension}"`);
    response.setHeader("cache-control", "private, no-store");
    if (request.header("if-none-match") === etag) return response.status(304).end();
    response.setHeader("content-length", content.length);
    return response.send(content);
  });

  router.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
    if ((error as { type?: string }).type === "entity.too.large")
      return failure(request, response, 413, "bad_request", "Token upload exceeds the 6 MiB limit.");
    return failure(request, response, 500, "internal_error", "Token request failed.");
  });
  return router;
}
