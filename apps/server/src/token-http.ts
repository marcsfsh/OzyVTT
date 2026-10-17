import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { apiErrorHandler, pathParam, sendData, sendFailure, sendRefusal } from "./http-kit.js";
import { callerOf, refuse, type CredentialVerifiers } from "./request-auth.js";
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
const FAULT = "Token request failed.";

type TokenRouterOptions = Readonly<{
  assets: MapAssetStore;
  catalog: TokenCatalogStore;
  /** The server's credential checks. A joined player may browse the library and upload; the session id keys the
   *  upload cap. */
  verifiers: CredentialVerifiers;
  /** Whether this joined player may load this image now: only one a creature in their own view wears. */
  playerMayLoad: (assetId: string, sessionId: string) => boolean;
  /** Whether a paired table screen may load this image now. */
  viewerMayLoad: (assetId: string) => boolean;
  now?: () => number;
}>;

function tokenId(request: Request) {
  const id = pathParam(request, "id");
  return TOKEN_ID.test(id) ? id : null;
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
  const requireGm = (request: Request, response: Response, next: NextFunction) => {
    const caller = callerOf(request, response, options.verifiers);
    if (caller.kind === "gm") return next();
    return refuse(response, caller, "The GM manages the token library.");
  };
  /** Answers the refusal itself and returns false when the caller may not load this image now. */
  const mayReadContent = (request: Request, response: Response, assetId: string) => {
    const caller = callerOf(request, response, options.verifiers, { viewer: true });
    const allowed =
      caller.kind === "gm" ||
      (caller.kind === "player" && options.playerMayLoad(assetId, caller.sessionId)) ||
      (caller.kind === "viewer" && options.viewerMayLoad(assetId));
    if (!allowed) refuse(response, caller, "That token image is not available to this table session.");
    return allowed;
  };

  /** A player may upload their own character's token. The GM keeps every management route; a player gets
   *  only this upload and the browse list, with uploads landing in one folder the GM can curate. */
  const requireGmOrPlayer = (request: Request, response: Response, next: NextFunction) => {
    const caller = callerOf(request, response, options.verifiers);
    if (caller.kind === "gm") {
      response.locals.tokenPrincipal = { role: "gm" };
      return next();
    }
    if (caller.kind === "player") {
      response.locals.tokenPrincipal = { role: "player", sessionId: caller.sessionId };
      return next();
    }
    return refuse(response, caller, "The token library takes a GM or player session.");
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
          return sendFailure(
            response,
            429,
            "rate_limited",
            `You can upload up to ${PLAYER_UPLOADS_PER_DAY} token images a day. Ask your GM to add more.`
          );
        }
        if (!Buffer.isBuffer(request.body))
          return sendFailure(response, 400, "validation_failed", "Upload the image as the request body.");
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
        return sendData(response, imported.duplicate ? 200 : 201, {
          token: publicToken(imported.metadata, entry),
          duplicate: imported.duplicate
        });
      } catch (error) {
        return sendRefusal(response, error, "Token upload failed.", FAULT);
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
    return sendData(response, 200, { tokens, rememberedAssetId });
  });

  router.post(`${TOKEN_COLLECTION}/folders/rename`, requireGm, (request, response) => {
    try {
      const input = FolderRenameSchema.parse(request.body);
      options.catalog.renameFolder(input.from, input.to);
      return sendData(response, 200, { renamed: true });
    } catch (error) {
      return sendRefusal(response, error, "Folder rename is malformed.", FAULT);
    }
  });

  /** Hide or re-offer every token in one folder. GM only. */
  router.post(`${TOKEN_COLLECTION}/folders/visibility`, requireGm, (request, response) => {
    try {
      const input = FolderVisibilitySchema.parse(request.body);
      options.catalog.setFolderHidden(input.folder, input.hidden);
      return sendData(response, 200, { folder: input.folder, hidden: input.hidden });
    } catch (error) {
      return sendRefusal(response, error, "Folder visibility is malformed.", FAULT);
    }
  });

  router.patch(`${TOKEN_COLLECTION}/:id`, requireGm, (request, response) => {
    try {
      const id = tokenId(request);
      if (!id) return sendFailure(response, 400, "validation_failed", "Token asset ID is malformed.");
      if (!options.catalog.get(id)) return sendFailure(response, 404, "not_found", "Token asset was not found.");
      return sendData(response, 200, { token: options.catalog.updateDetails(id, DetailsSchema.parse(request.body)) });
    } catch (error) {
      return sendRefusal(response, error, "Token details are malformed.", FAULT);
    }
  });

  router.delete(`${TOKEN_COLLECTION}/:id`, requireGm, async (request, response) => {
    const id = tokenId(request);
    if (!id) return sendFailure(response, 400, "validation_failed", "Token asset ID is malformed.");
    options.catalog.remove(id);
    await options.assets.remove(id);
    return sendData(response, 200, { removed: true });
  });

  router.get(`${TOKEN_COLLECTION}/:id/content`, async (request, response) => {
    const id = tokenId(request);
    if (!id) return sendFailure(response, 400, "validation_failed", "Token asset ID is malformed.");
    if (!mayReadContent(request, response, id)) return;
    const metadata = await options.assets.get(id);
    const content = metadata ? await options.assets.readOriginal(id) : null;
    if (!metadata || !content) return sendFailure(response, 404, "not_found", "Token asset was not found.");
    const etag = `"${id}"`;
    response.setHeader("etag", etag);
    response.setHeader("content-type", metadata.mediaType);
    response.setHeader("content-disposition", `inline; filename="${id}.${metadata.extension}"`);
    response.setHeader("cache-control", "private, no-store");
    if (request.header("if-none-match") === etag) return response.status(304).end();
    response.setHeader("content-length", content.length);
    return response.send(content);
  });

  router.use(apiErrorHandler(FAULT, "Token upload exceeds the 6 MiB limit."));
  return router;
}
