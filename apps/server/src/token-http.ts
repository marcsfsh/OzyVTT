import express, { Router, type NextFunction, type Request, type Response } from "express";
import { assetRoutes as routes } from "@vtt/api-contract/routes";
import { apiErrorHandler, mount, pathParam, sendData, sendFailure, sendRefusal } from "./http-kit.js";
import { callerOf, refuse, type CredentialVerifiers } from "./request-auth.js";
import type { MapAssetMetadata, MapAssetStore } from "./map-assets.js";
import type { TokenCatalogEntry, TokenCatalogStore } from "./token-catalog.js";

const DEFINITION_ID = /^[a-z0-9-]+$/;
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
  const params = routes.updateTokenAsset.params.safeParse({ id: pathParam(request, "id") });
  return params.success ? params.data.id : null;
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

/** HTTP for uploaded token images, built like the map router. The GM uploads and manages; content is
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
    // The GM's preview of the players' view only reads, so it uploads nothing.
    if (caller.kind === "player" && !caller.preview) {
      response.locals.tokenPrincipal = { role: "player", sessionId: caller.sessionId };
      return next();
    }
    return refuse(
      response,
      caller,
      caller.kind === "player"
        ? "A preview of the players' view only reads. Upload from your own session."
        : "The token library takes a GM or player session."
    );
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

  mount(
    router,
    routes.uploadTokenAsset,
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
        const query = routes.uploadTokenAsset.query.parse(request.query);
        const filename = query.filename ?? "token";
        const name = query.name ?? filename.replace(/\.[^.]+$/, "");
        // A player does not choose the folder: their uploads land on one shelf the GM can curate.
        const folder = principal.role === "player" ? PLAYER_UPLOAD_FOLDER : (query.folder ?? null);
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

  mount(router, routes.listTokenAssets, requireGmOrPlayer, async (request, response) => {
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
    const query = routes.listTokenAssets.query.safeParse(request.query);
    const asked = query.success ? query.data.definitionId : undefined;
    const definitionId = asked !== undefined && DEFINITION_ID.test(asked) ? asked : null;
    // The per-definition memory is GM prep and stays hidden from players.
    const rememberedAssetId =
      principal.role === "gm" && definitionId ? options.catalog.recallForDefinition(definitionId) : null;
    return sendData(response, 200, { tokens, rememberedAssetId });
  });

  mount(router, routes.renameTokenFolder, requireGm, (request, response) => {
    try {
      const input = routes.renameTokenFolder.body.schema.parse(request.body);
      options.catalog.renameFolder(input.from, input.to);
      return sendData(response, 200, { renamed: true });
    } catch (error) {
      return sendRefusal(response, error, "Folder rename is malformed.", FAULT);
    }
  });

  /** Hide or re-offer every token in one folder. GM only. */
  mount(router, routes.setTokenFolderVisibility, requireGm, (request, response) => {
    try {
      const input = routes.setTokenFolderVisibility.body.schema.parse(request.body);
      options.catalog.setFolderHidden(input.folder, input.hidden);
      return sendData(response, 200, { folder: input.folder, hidden: input.hidden });
    } catch (error) {
      return sendRefusal(response, error, "Folder visibility is malformed.", FAULT);
    }
  });

  mount(router, routes.updateTokenAsset, requireGm, (request, response) => {
    try {
      const id = tokenId(request);
      if (!id) return sendFailure(response, 400, "validation_failed", "Token asset ID is malformed.");
      if (!options.catalog.get(id)) return sendFailure(response, 404, "not_found", "Token asset was not found.");
      const input = routes.updateTokenAsset.body.schema.parse(request.body);
      return sendData(response, 200, { token: options.catalog.updateDetails(id, input) });
    } catch (error) {
      return sendRefusal(response, error, "Token details are malformed.", FAULT);
    }
  });

  mount(router, routes.deleteTokenAsset, requireGm, async (request, response) => {
    const id = tokenId(request);
    if (!id) return sendFailure(response, 400, "validation_failed", "Token asset ID is malformed.");
    options.catalog.remove(id);
    await options.assets.remove(id);
    return sendData(response, 200, { removed: true });
  });

  mount(router, routes.getTokenAssetContent, async (request, response) => {
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
