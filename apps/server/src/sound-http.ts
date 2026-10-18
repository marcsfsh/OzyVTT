import express, { Router, type NextFunction, type Request, type Response } from "express";
import { assetRoutes as routes } from "@vtt/api-contract/routes";
import { sendAssetContent } from "./asset-content.js";
import type { AudioAssetStore } from "./audio-assets.js";
import { mount, sendData, sendFailure, sendRefusal, apiErrorHandler } from "./http-kit.js";
import { callerOf, refuse, type CredentialVerifiers } from "./request-auth.js";
import type { SoundService } from "./sound-service.js";

/**
 * The GM's sound library (ADR-0024): upload, list, rename and delete, all GM-only. A file's bytes reach the GM or a
 * paired table screen, and the screen only while the file is playing there. Players never reach any of it.
 */

const FAULT = "Sound request failed.";

type SoundRouterOptions = Readonly<{
  service: SoundService;
  assets: AudioAssetStore;
  verifiers: CredentialVerifiers;
  /** Whether a paired table screen may load this file: it is playing there now. */
  viewerMayLoad: (assetId: string) => boolean;
}>;

function soundId(request: Request) {
  const params = routes.deleteSoundAsset.params.safeParse(request.params);
  return params.success ? params.data.id : null;
}

export function createSoundRouter(options: SoundRouterOptions) {
  const router = Router();
  const requireGm = (request: Request, response: Response, next: NextFunction) => {
    const caller = callerOf(request, response, options.verifiers);
    if (caller.kind === "gm") return next();
    return refuse(response, caller, "The GM manages the sound library.");
  };

  mount(
    router,
    routes.uploadSoundAsset,
    requireGm,
    // A little over the 50 MB file limit, so an oversize file meets the inspection's own message.
    express.raw({ type: () => true, limit: "51mb" }),
    async (request, response) => {
      try {
        if (!Buffer.isBuffer(request.body))
          return sendFailure(response, 400, "validation_failed", "Upload the sound file as the request body.");
        const parsed = routes.uploadSoundAsset.query.safeParse(request.query);
        const query = parsed.success ? parsed.data : {};
        const filename = query.filename ?? "sound";
        const name = query.name?.trim() ? query.name : filename.replace(/\.[^.]+$/, "") || "Sound";
        const uploaded = await options.service.upload(request.body, filename, name);
        return sendData(response, uploaded.duplicate ? 200 : 201, uploaded);
      } catch (error) {
        return sendRefusal(response, error, "Sound upload failed.", FAULT);
      }
    }
  );

  mount(router, routes.listSoundAssets, requireGm, async (_request, response) => {
    try {
      return sendData(response, 200, { sounds: await options.service.list() });
    } catch (error) {
      return sendRefusal(response, error, FAULT, FAULT);
    }
  });

  mount(router, routes.renameSoundAsset, requireGm, async (request, response) => {
    try {
      const id = soundId(request);
      if (!id) return sendFailure(response, 400, "validation_failed", "Sound ID is malformed.");
      const sound = await options.service.rename(id, routes.renameSoundAsset.body.schema.parse(request.body).name);
      if (!sound) return sendFailure(response, 404, "not_found", "That sound is not in the library.");
      return sendData(response, 200, { sound });
    } catch (error) {
      return sendRefusal(response, error, "Give the sound a name.", FAULT);
    }
  });

  mount(router, routes.deleteSoundAsset, requireGm, async (request, response) => {
    try {
      const id = soundId(request);
      if (!id) return sendFailure(response, 400, "validation_failed", "Sound ID is malformed.");
      if (!(await options.service.remove(id)))
        return sendFailure(response, 404, "not_found", "That sound is not in the library.");
      return sendData(response, 200, { deleted: true });
    } catch (error) {
      return sendRefusal(response, error, FAULT, FAULT);
    }
  });

  mount(router, routes.getSoundAssetContent, async (request, response) => {
    try {
      const id = soundId(request);
      if (!id) return sendFailure(response, 400, "validation_failed", "Sound ID is malformed.");
      const caller = callerOf(request, response, options.verifiers, { viewer: true });
      const allowed = caller.kind === "gm" || (caller.kind === "viewer" && options.viewerMayLoad(id));
      if (!allowed) return refuse(response, caller, "That sound is not playing on this screen.");
      const stored = await options.assets.readOriginal(id);
      if (!stored) return sendFailure(response, 404, "not_found", "That sound is not in the library.");
      return sendAssetContent(request, response, { ...stored.metadata, content: stored.buffer });
    } catch (error) {
      return sendRefusal(response, error, FAULT, FAULT);
    }
  });

  router.use(apiErrorHandler(FAULT, "The sound file is larger than the 50 MB limit."));
  return router;
}
