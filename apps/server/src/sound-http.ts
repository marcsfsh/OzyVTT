import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { VIEWER_SESSION_COOKIE } from "@vtt/api-contract";
import { sendAssetContent } from "./asset-content.js";
import type { AudioAssetStore } from "./audio-assets.js";
import { bearerToken, cookie, pathParam, sendData, sendFailure, sendRefusal, apiErrorHandler } from "./http-kit.js";
import type { SoundService } from "./sound-service.js";

/**
 * The GM's sound library (ADR-0024): upload, list, rename and delete, all GM-only. A file's bytes reach the GM or a
 * paired table screen, and the screen only while the file is playing there. Players never reach any of it.
 */

const COLLECTION = "/api/v1/sound-assets";
const SOUND_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FAULT = "Sound request failed.";
const RenameSchema = z.object({ name: z.string() }).strict();

type SoundRouterOptions = Readonly<{
  service: SoundService;
  assets: AudioAssetStore;
  authorizeGm: (token: string | undefined) => boolean;
  /** A paired table screen's cookie, for a file that is playing on it now. */
  authorizeViewer: (token: string | undefined, assetId: string) => boolean;
}>;

function soundId(request: Request) {
  const id = pathParam(request, "id");
  return SOUND_ID.test(id) ? id : null;
}

export function createSoundRouter(options: SoundRouterOptions) {
  const router = Router();
  const requireGm = (request: Request, response: Response, next: NextFunction) => {
    if (!options.authorizeGm(bearerToken(request)))
      return sendFailure(response, 401, "unauthenticated", "A valid GM session is required.");
    next();
  };

  router.post(
    COLLECTION,
    requireGm,
    // A little over the 50 MB file limit, so an oversize file meets the inspection's own message.
    express.raw({ type: () => true, limit: "51mb" }),
    async (request, response) => {
      try {
        if (!Buffer.isBuffer(request.body))
          return sendFailure(response, 400, "validation_failed", "Upload the sound file as the request body.");
        const filename = typeof request.query.filename === "string" ? request.query.filename : "sound";
        const name =
          typeof request.query.name === "string" && request.query.name.trim()
            ? request.query.name
            : filename.replace(/\.[^.]+$/, "") || "Sound";
        const uploaded = await options.service.upload(request.body, filename, name);
        return sendData(response, uploaded.duplicate ? 200 : 201, uploaded);
      } catch (error) {
        return sendRefusal(response, error, "Sound upload failed.", FAULT);
      }
    }
  );

  router.get(COLLECTION, requireGm, async (_request, response) => {
    try {
      return sendData(response, 200, { sounds: await options.service.list() });
    } catch (error) {
      return sendRefusal(response, error, FAULT, FAULT);
    }
  });

  router.patch(`${COLLECTION}/:id`, requireGm, async (request, response) => {
    try {
      const id = soundId(request);
      if (!id) return sendFailure(response, 400, "validation_failed", "Sound ID is malformed.");
      const sound = await options.service.rename(id, RenameSchema.parse(request.body).name);
      if (!sound) return sendFailure(response, 404, "not_found", "That sound is not in the library.");
      return sendData(response, 200, { sound });
    } catch (error) {
      return sendRefusal(response, error, "Give the sound a name.", FAULT);
    }
  });

  router.delete(`${COLLECTION}/:id`, requireGm, async (request, response) => {
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

  router.get(`${COLLECTION}/:id/content`, async (request, response) => {
    try {
      const id = soundId(request);
      if (!id) return sendFailure(response, 400, "validation_failed", "Sound ID is malformed.");
      const allowed =
        options.authorizeGm(bearerToken(request)) ||
        options.authorizeViewer(cookie(request, VIEWER_SESSION_COOKIE), id);
      if (!allowed) return sendFailure(response, 403, "forbidden", "That sound is not playing on this screen.");
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
