import { createHash, randomUUID } from "node:crypto";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { VIEWER_SESSION_COOKIE } from "@vtt/api-contract";
import {
  adjustWizardGrid,
  completeGridCalibrationWizard,
  createGridCalibrationWizard,
  measureKnownGridArea,
  measureKnownGridSpan,
  redoWizardGrid,
  undoWizardGrid,
  verifyWizardIntersection,
  type GridCalibrationWizardState
} from "./grid-calibration-wizard.js";
import { gridOverlayLines } from "./grid-overlay.js";
import {
  apiErrorHandler,
  bearerToken,
  cookie,
  isUuidV4,
  pathParam,
  sendData,
  sendFailure,
  sendRefusal
} from "./http-kit.js";
import { InvalidRequestError } from "./invalid-request.js";
import type { MapAssetMetadata, MapAssetStore } from "./map-assets.js";
import { deriveMapDistanceScale } from "./map-measurement.js";
import type { MapCatalogEntry, MapCatalogStore, MapKind } from "./map-catalog.js";

const MAP_COLLECTION = "/api/v1/map-assets";
const MAP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FAULT = "Map request failed.";
const WIZARD_TTL_MS = 30 * 60 * 1_000;

const PointSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const StartWizardSchema = z.union([
  z
    .object({
      start: PointSchema,
      end: PointSchema,
      cellsAcross: z.literal(3),
      cellsDown: z.literal(3),
      distancePerCell: z.number().positive().optional()
    })
    .strict(),
  z
    .object({
      start: PointSchema,
      end: PointSchema,
      cellsBetween: z.number().int(),
      axis: z.enum(["horizontal", "vertical"]),
      distancePerCell: z.number().positive().optional()
    })
    .strict()
]);
const WizardActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("adjust"),
      adjustment: z
        .object({
          originDelta: PointSchema.optional(),
          cellSizeDeltaPx: z.number().finite().optional(),
          rotationDeltaRadians: z.number().finite().optional(),
          distancePerCell: z.number().positive().optional()
        })
        .strict()
    })
    .strict(),
  z.object({ action: z.literal("undo") }).strict(),
  z.object({ action: z.literal("redo") }).strict(),
  z
    .object({ action: z.literal("verify"), imagePoint: PointSchema, tolerancePx: z.number().positive().optional() })
    .strict()
]);
const ScaleSchema = z
  .object({ start: PointSchema, end: PointSchema, knownDistance: z.number().positive(), unit: z.string() })
  .strict();
const DetailsSchema = z
  .object({
    name: z.string().optional(),
    kind: z.enum(["battlemap", "regional", "world"]).optional(),
    folder: z.string().nullable().optional()
  })
  .strict();
const FolderRenameSchema = z.object({ from: z.string(), to: z.string().nullable() }).strict();

type WizardSession = { ownerHash: string; assetId: string; state: GridCalibrationWizardState; touchedAt: number };

type MapRouterOptions = Readonly<{
  assets: MapAssetStore;
  catalog: MapCatalogStore;
  authorizeGm: (token: string | undefined) => boolean;
  authorizePlayer: (token: string | undefined, assetId: string) => boolean;
  authorizeViewer: (token: string | undefined, assetId: string) => boolean;
  now?: () => number;
}>;

function mapId(request: Request) {
  const id = pathParam(request, "id");
  return MAP_ID.test(id) ? id : null;
}

function publicAsset(metadata: MapAssetMetadata, entry: MapCatalogEntry) {
  return {
    id: metadata.id,
    name: entry.name,
    kind: entry.kind,
    folder: entry.folder,
    originalName: metadata.originalName,
    format: metadata.format,
    mediaType: metadata.mediaType,
    width: metadata.width,
    height: metadata.height,
    byteLength: metadata.byteLength,
    importedAt: metadata.importedAt,
    calibration: entry.calibration,
    scale: entry.scale,
    updatedAt: entry.updatedAt
  };
}

export function createMapRouter(options: MapRouterOptions) {
  const router = Router();
  const now = options.now ?? Date.now;
  const wizards = new Map<string, WizardSession>();

  const requireGm = (request: Request, response: Response, next: NextFunction) => {
    if (!options.authorizeGm(bearerToken(request)))
      return sendFailure(response, 401, "unauthenticated", "A valid GM session is required.");
    next();
  };
  const canReadContent = (request: Request, assetId: string) => {
    const token = bearerToken(request);
    const viewer = cookie(request, VIEWER_SESSION_COOKIE);
    return (
      options.authorizeGm(token) || options.authorizePlayer(token, assetId) || options.authorizeViewer(viewer, assetId)
    );
  };
  const pruneWizards = () => {
    for (const [id, session] of wizards) if (session.touchedAt <= now() - WIZARD_TTL_MS) wizards.delete(id);
  };
  const wizardFor = (request: Request, assetId: string) => {
    pruneWizards();
    const id = pathParam(request, "wizardId");
    const session = isUuidV4(id) ? wizards.get(id) : undefined;
    const token = bearerToken(request);
    if (
      !session ||
      session.assetId !== assetId ||
      !token ||
      session.ownerHash !== createHash("sha256").update(token).digest("hex")
    )
      return null;
    session.touchedAt = now();
    return { id, session };
  };
  const wizardPayload = (wizardId: string, state: GridCalibrationWizardState) => {
    let overlay: ReturnType<typeof gridOverlayLines> = [];
    let overlayWarning: string | null = null;
    if (state.calibration) {
      try {
        overlay = gridOverlayLines(
          state.calibration,
          { minX: 0, minY: 0, maxX: state.mapWidthPx, maxY: state.mapHeightPx },
          { overscanCells: 0, maxLines: 4_000 }
        );
      } catch (error) {
        if (!(error instanceof InvalidRequestError)) throw error;
        overlayWarning = error.message;
      }
    }
    return { wizardId, state, overlay, overlayWarning };
  };

  router.post(
    MAP_COLLECTION,
    requireGm,
    express.raw({ type: () => true, limit: "51mb" }),
    async (request, response) => {
      try {
        if (!Buffer.isBuffer(request.body))
          return sendFailure(response, 400, "validation_failed", "Upload the image as the request body.");
        const filename = typeof request.query.filename === "string" ? request.query.filename : "map";
        const name = typeof request.query.name === "string" ? request.query.name : filename.replace(/\.[^.]+$/, "");
        const kind = (typeof request.query.kind === "string" ? request.query.kind : "battlemap") as MapKind;
        const imported = await options.assets.import(request.body, filename);
        const entry = options.catalog.register(imported.metadata.id, name, kind);
        return sendData(response, imported.duplicate ? 200 : 201, {
          asset: publicAsset(imported.metadata, entry),
          duplicate: imported.duplicate
        });
      } catch (error) {
        return sendRefusal(response, error, "Map upload failed.", FAULT);
      }
    }
  );

  router.get(MAP_COLLECTION, requireGm, async (_request, response) => {
    const entries = options.catalog.list();
    const assets = (
      await Promise.all(
        entries.map(async (entry) => {
          const metadata = await options.assets.get(entry.assetId);
          return metadata ? publicAsset(metadata, entry) : null;
        })
      )
    ).filter((asset) => asset !== null);
    return sendData(response, 200, { assets });
  });

  router.get(`${MAP_COLLECTION}/:id`, requireGm, async (request, response) => {
    const id = mapId(request);
    if (!id) return sendFailure(response, 400, "validation_failed", "Map asset ID is malformed.");
    const [metadata, entry] = await Promise.all([options.assets.get(id), Promise.resolve(options.catalog.get(id))]);
    if (!metadata || !entry) return sendFailure(response, 404, "not_found", "Map asset was not found.");
    return sendData(response, 200, { asset: publicAsset(metadata, entry) });
  });

  router.patch(`${MAP_COLLECTION}/:id`, requireGm, (request, response) => {
    try {
      const id = mapId(request);
      if (!id) return sendFailure(response, 400, "validation_failed", "Map asset ID is malformed.");
      const input = DetailsSchema.parse(request.body);
      return sendData(response, 200, { map: options.catalog.updateDetails(id, input) });
    } catch (error) {
      return sendRefusal(response, error, "Map details are malformed.", FAULT);
    }
  });

  router.post(`${MAP_COLLECTION}/folders/rename`, requireGm, (request, response) => {
    try {
      const input = FolderRenameSchema.parse(request.body);
      options.catalog.renameFolder(input.from, input.to);
      return sendData(response, 200, { renamed: true });
    } catch (error) {
      return sendRefusal(response, error, "Folder rename is malformed.", FAULT);
    }
  });

  router.get(`${MAP_COLLECTION}/:id/content`, async (request, response) => {
    const id = mapId(request);
    if (!id) return sendFailure(response, 400, "validation_failed", "Map asset ID is malformed.");
    if (!canReadContent(request, id))
      return sendFailure(response, 403, "forbidden", "That map is not available to this table session.");
    const metadata = await options.assets.get(id);
    const content = metadata ? await options.assets.readOriginal(id) : null;
    if (!metadata || !content) return sendFailure(response, 404, "not_found", "Map asset was not found.");
    const etag = `"${id}"`;
    response.setHeader("etag", etag);
    response.setHeader("accept-ranges", "bytes");
    response.setHeader("content-type", metadata.mediaType);
    response.setHeader("content-disposition", `inline; filename="${id}.${metadata.extension}"`);
    // Access can be revoked or the presented map can change at any time, so never leave previously
    // authorized map bytes recoverable from a shared-screen cache.
    response.setHeader("cache-control", "private, no-store");
    if (request.header("if-none-match") === etag) return response.status(304).end();
    const range = request.header("range");
    if (!range) {
      response.setHeader("content-length", content.length);
      return response.send(content);
    }
    const match = range.match(/^bytes=(\d*)-(\d*)$/);
    let start: number;
    let end: number;
    if (!match || (!match[1] && !match[2])) {
      response.setHeader("content-range", `bytes */${content.length}`);
      return response.status(416).end();
    }
    if (!match[1]) {
      const suffix = Number(match[2]);
      start = Math.max(0, content.length - suffix);
      end = content.length - 1;
    } else {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : content.length - 1;
    }
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start >= content.length ||
      end < start
    ) {
      response.setHeader("content-range", `bytes */${content.length}`);
      return response.status(416).end();
    }
    end = Math.min(end, content.length - 1);
    const part = content.subarray(start, end + 1);
    response.status(206).setHeader("content-range", `bytes ${start}-${end}/${content.length}`);
    response.setHeader("content-length", part.length);
    return response.send(part);
  });

  // Calibration numbers aren't secret (clients already get grid-derived token sizing); exposing them
  // read-only lets the map preview measurements. The server still computes authoritative geometry on
  // every annotation command.
  router.get(`${MAP_COLLECTION}/:id/grid`, (request, response) => {
    const id = mapId(request);
    if (!id) return sendFailure(response, 400, "validation_failed", "Map asset ID is malformed.");
    if (!canReadContent(request, id))
      return sendFailure(response, 403, "forbidden", "That map is not available to this table session.");
    const entry = options.catalog.get(id);
    if (!entry) return sendFailure(response, 404, "not_found", "Map asset was not found.");
    return sendData(response, 200, { calibration: entry.calibration?.calibration ?? null });
  });

  router.post(`${MAP_COLLECTION}/:id/calibration/wizards`, requireGm, async (request, response) => {
    try {
      const id = mapId(request);
      const token = bearerToken(request);
      if (!id || !token) return sendFailure(response, 400, "validation_failed", "Map asset ID is malformed.");
      const metadata = await options.assets.get(id);
      if (!metadata || !options.catalog.get(id))
        return sendFailure(response, 404, "not_found", "Map asset was not found.");
      const input = StartWizardSchema.parse(request.body);
      const initial = createGridCalibrationWizard({
        assetId: id,
        mapWidthPx: metadata.width,
        mapHeightPx: metadata.height
      });
      const state =
        "cellsAcross" in input ? measureKnownGridArea(initial, input) : measureKnownGridSpan(initial, input);
      const wizardId = randomUUID();
      wizards.set(wizardId, {
        ownerHash: createHash("sha256").update(token).digest("hex"),
        assetId: id,
        state,
        touchedAt: now()
      });
      return sendData(response, 201, wizardPayload(wizardId, state));
    } catch (error) {
      return sendRefusal(response, error, "Calibration measurement is malformed.", FAULT);
    }
  });

  router.post(`${MAP_COLLECTION}/:id/calibration/wizards/:wizardId/actions`, requireGm, (request, response) => {
    try {
      const id = mapId(request);
      if (!id) return sendFailure(response, 400, "validation_failed", "Map asset ID is malformed.");
      const found = wizardFor(request, id);
      if (!found) return sendFailure(response, 404, "not_found", "Calibration wizard was not found or expired.");
      const action = WizardActionSchema.parse(request.body);
      if (action.action === "adjust") found.session.state = adjustWizardGrid(found.session.state, action.adjustment);
      else if (action.action === "undo") found.session.state = undoWizardGrid(found.session.state);
      else if (action.action === "redo") found.session.state = redoWizardGrid(found.session.state);
      else found.session.state = verifyWizardIntersection(found.session.state, action.imagePoint, action.tolerancePx);
      return sendData(response, 200, wizardPayload(found.id, found.session.state));
    } catch (error) {
      return sendRefusal(response, error, "Calibration action is malformed.", FAULT);
    }
  });

  router.post(`${MAP_COLLECTION}/:id/calibration/wizards/:wizardId/complete`, requireGm, (request, response) => {
    try {
      const id = mapId(request);
      if (!id) return sendFailure(response, 400, "validation_failed", "Map asset ID is malformed.");
      const found = wizardFor(request, id);
      if (!found) return sendFailure(response, 404, "not_found", "Calibration wizard was not found or expired.");
      const state = completeGridCalibrationWizard(found.session.state);
      const verification = state.verification?.accepted ? state.verification : null;
      const entry = options.catalog.saveCalibration(id, {
        calibration: state.calibration!,
        verifiedAt: verification ? new Date(now()).toISOString() : null,
        verificationPoint: verification?.imagePoint ?? null,
        verificationErrorPx: verification?.errorPx ?? null
      });
      wizards.delete(found.id);
      return sendData(response, 200, { map: entry });
    } catch (error) {
      return sendRefusal(response, error, "Calibration is malformed.", FAULT);
    }
  });

  router.put(`${MAP_COLLECTION}/:id/scale`, requireGm, (request, response) => {
    try {
      const id = mapId(request);
      if (!id) return sendFailure(response, 400, "validation_failed", "Map asset ID is malformed.");
      const input = ScaleSchema.parse(request.body);
      return sendData(response, 200, { map: options.catalog.saveScale(id, deriveMapDistanceScale(input)) });
    } catch (error) {
      return sendRefusal(response, error, "Map scale request is malformed.", FAULT);
    }
  });

  router.use(apiErrorHandler(FAULT, "Map upload exceeds the 50 MiB limit."));
  return router;
}
