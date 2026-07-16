import { createHash, randomUUID } from "node:crypto";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { API_VERSION } from "@vtt/api-contract";
import { adjustWizardGrid, completeGridCalibrationWizard, createGridCalibrationWizard, measureKnownGridSpan, redoWizardGrid, undoWizardGrid, verifyWizardIntersection, type GridCalibrationWizardState } from "./grid-calibration-wizard.js";
import { gridOverlayLines } from "./grid-overlay.js";
import type { MapAssetMetadata, MapAssetStore } from "./map-assets.js";
import { deriveMapDistanceScale } from "./map-measurement.js";
import type { MapCatalogEntry, MapCatalogStore, MapKind } from "./map-catalog.js";

const MAP_COLLECTION = "/api/v1/map-assets";
const MAP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WIZARD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WIZARD_TTL_MS = 30 * 60 * 1_000;

const PointSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const StartWizardSchema = z.object({ start: PointSchema, end: PointSchema, cellsBetween: z.number().int(), axis: z.enum(["horizontal", "vertical"]), distancePerCell: z.number().positive().optional() }).strict();
const WizardActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("adjust"), adjustment: z.object({ originDelta: PointSchema.optional(), cellSizeDeltaPx: z.number().finite().optional(), rotationDeltaRadians: z.number().finite().optional(), distancePerCell: z.number().positive().optional() }).strict() }).strict(),
  z.object({ action: z.literal("undo") }).strict(),
  z.object({ action: z.literal("redo") }).strict(),
  z.object({ action: z.literal("verify"), imagePoint: PointSchema, tolerancePx: z.number().positive().optional() }).strict()
]);
const ScaleSchema = z.object({ start: PointSchema, end: PointSchema, knownDistance: z.number().positive(), unit: z.string() }).strict();
const DetailsSchema = z.object({ name: z.string().optional(), kind: z.enum(["battlemap", "regional", "world"]).optional() }).strict();

type WizardSession = { ownerHash: string; assetId: string; state: GridCalibrationWizardState; touchedAt: number };

type MapRouterOptions = Readonly<{
  assets: MapAssetStore;
  catalog: MapCatalogStore;
  authorizeGm: (token: string | undefined) => boolean;
  authorizePlayer: (token: string | undefined, assetId: string) => boolean;
  authorizeViewer: (token: string | undefined, assetId: string) => boolean;
  now?: () => number;
}>;

function bearer(request: Request) {
  const match = request.header("authorization")?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1];
}

function cookie(request: Request, name: string) {
  for (const part of (request.header("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name) return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return undefined;
}

function requestId(request: Request, response: Response) {
  const supplied = request.header("x-request-id");
  const id = supplied && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(supplied) ? supplied : randomUUID();
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

function mapId(request: Request) {
  const id = request.params.id;
  return typeof id === "string" && MAP_ID.test(id) ? id : null;
}

function publicAsset(metadata: MapAssetMetadata, entry: MapCatalogEntry) {
  return {
    id: metadata.id,
    name: entry.name,
    kind: entry.kind,
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
  router.use((request, response, next) => { requestId(request, response); next(); });

  const requireGm = (request: Request, response: Response, next: NextFunction) => {
    if (!options.authorizeGm(bearer(request))) return failure(request, response, 401, "unauthenticated", "A valid GM session is required.");
    next();
  };
  const canReadContent = (request: Request, assetId: string) => {
    const token = bearer(request);
    const viewer = cookie(request, "vtt_viewer_session");
    return options.authorizeGm(token) || options.authorizePlayer(token, assetId) || options.authorizeViewer(viewer, assetId);
  };
  const pruneWizards = () => { for (const [id, session] of wizards) if (session.touchedAt <= now() - WIZARD_TTL_MS) wizards.delete(id); };
  const wizardFor = (request: Request, assetId: string) => {
    pruneWizards();
    const id = request.params.wizardId;
    const session = typeof id === "string" && WIZARD_ID.test(id) ? wizards.get(id) : undefined;
    const token = bearer(request);
    if (!session || session.assetId !== assetId || !token || session.ownerHash !== createHash("sha256").update(token).digest("hex")) return null;
    session.touchedAt = now();
    return { id: id as string, session };
  };
  const wizardPayload = (wizardId: string, state: GridCalibrationWizardState) => {
    let overlay: ReturnType<typeof gridOverlayLines> = [];
    let overlayWarning: string | null = null;
    if (state.calibration) {
      try { overlay = gridOverlayLines(state.calibration, { minX: 0, minY: 0, maxX: state.mapWidthPx, maxY: state.mapHeightPx }, { overscanCells: 0, maxLines: 4_000 }); }
      catch (error) { overlayWarning = error instanceof Error ? error.message : "Zoom in to preview this grid."; }
    }
    return { wizardId, state, overlay, overlayWarning };
  };

  router.post(MAP_COLLECTION, requireGm, express.raw({ type: () => true, limit: "51mb" }), async (request, response) => {
    try {
      if (!Buffer.isBuffer(request.body)) return failure(request, response, 400, "validation_failed", "Upload the image as the request body.");
      const filename = typeof request.query.filename === "string" ? request.query.filename : "map";
      const name = typeof request.query.name === "string" ? request.query.name : filename.replace(/\.[^.]+$/, "");
      const kind = (typeof request.query.kind === "string" ? request.query.kind : "battlemap") as MapKind;
      const imported = await options.assets.import(request.body, filename);
      const entry = options.catalog.register(imported.metadata.id, name, kind);
      return success(response, imported.duplicate ? 200 : 201, { asset: publicAsset(imported.metadata, entry), duplicate: imported.duplicate });
    } catch (error) { return failure(request, response, 400, "validation_failed", error instanceof Error ? error.message : "Map upload failed."); }
  });

  router.get(MAP_COLLECTION, requireGm, async (_request, response) => {
    const entries = options.catalog.list();
    const assets = (await Promise.all(entries.map(async (entry) => {
      const metadata = await options.assets.get(entry.assetId);
      return metadata ? publicAsset(metadata, entry) : null;
    }))).filter((asset) => asset !== null);
    return success(response, 200, { assets });
  });

  router.get(`${MAP_COLLECTION}/:id`, requireGm, async (request, response) => {
    const id = mapId(request);
    if (!id) return failure(request, response, 400, "validation_failed", "Map asset ID is malformed.");
    const [metadata, entry] = await Promise.all([options.assets.get(id), Promise.resolve(options.catalog.get(id))]);
    if (!metadata || !entry) return failure(request, response, 404, "not_found", "Map asset was not found.");
    return success(response, 200, { asset: publicAsset(metadata, entry) });
  });

  router.patch(`${MAP_COLLECTION}/:id`, requireGm, (request, response) => {
    try {
      const id = mapId(request);
      if (!id) return failure(request, response, 400, "validation_failed", "Map asset ID is malformed.");
      const input = DetailsSchema.parse(request.body);
      return success(response, 200, { map: options.catalog.updateDetails(id, input) });
    } catch (error) { return failure(request, response, 400, "validation_failed", error instanceof z.ZodError ? "Map details are malformed." : (error as Error).message); }
  });

  router.get(`${MAP_COLLECTION}/:id/content`, async (request, response) => {
    const id = mapId(request);
    if (!id) return failure(request, response, 400, "validation_failed", "Map asset ID is malformed.");
    if (!canReadContent(request, id)) return failure(request, response, 403, "forbidden", "That map is not available to this table session.");
    const metadata = await options.assets.get(id);
    const content = metadata ? await options.assets.readOriginal(id) : null;
    if (!metadata || !content) return failure(request, response, 404, "not_found", "Map asset was not found.");
    const etag = `"${id}"`;
    response.setHeader("etag", etag);
    response.setHeader("accept-ranges", "bytes");
    response.setHeader("content-type", metadata.mediaType);
    response.setHeader("content-disposition", `inline; filename="${id}.${metadata.extension}"`);
    // Access can be revoked or the presented map can change at any time. Do not
    // leave previously authorized map bytes recoverable from a shared-TV cache.
    response.setHeader("cache-control", "private, no-store");
    if (request.header("if-none-match") === etag) return response.status(304).end();
    const range = request.header("range");
    if (!range) { response.setHeader("content-length", content.length); return response.send(content); }
    const match = range.match(/^bytes=(\d*)-(\d*)$/);
    let start: number; let end: number;
    if (!match || (!match[1] && !match[2])) { response.setHeader("content-range", `bytes */${content.length}`); return response.status(416).end(); }
    if (!match[1]) { const suffix = Number(match[2]); start = Math.max(0, content.length - suffix); end = content.length - 1; }
    else { start = Number(match[1]); end = match[2] ? Number(match[2]) : content.length - 1; }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= content.length || end < start) { response.setHeader("content-range", `bytes */${content.length}`); return response.status(416).end(); }
    end = Math.min(end, content.length - 1);
    const part = content.subarray(start, end + 1);
    response.status(206).setHeader("content-range", `bytes ${start}-${end}/${content.length}`);
    response.setHeader("content-length", part.length);
    return response.send(part);
  });

  router.post(`${MAP_COLLECTION}/:id/calibration/wizards`, requireGm, async (request, response) => {
    try {
      const id = mapId(request); const token = bearer(request);
      if (!id || !token) return failure(request, response, 400, "validation_failed", "Map asset ID is malformed.");
      const metadata = await options.assets.get(id);
      if (!metadata || !options.catalog.get(id)) return failure(request, response, 404, "not_found", "Map asset was not found.");
      const input = StartWizardSchema.parse(request.body);
      const state = measureKnownGridSpan(createGridCalibrationWizard({ assetId: id, mapWidthPx: metadata.width, mapHeightPx: metadata.height }), input);
      const wizardId = randomUUID();
      wizards.set(wizardId, { ownerHash: createHash("sha256").update(token).digest("hex"), assetId: id, state, touchedAt: now() });
      return success(response, 201, wizardPayload(wizardId, state));
    } catch (error) { return failure(request, response, 400, "validation_failed", error instanceof z.ZodError ? "Calibration measurement is malformed." : (error as Error).message); }
  });

  router.post(`${MAP_COLLECTION}/:id/calibration/wizards/:wizardId/actions`, requireGm, (request, response) => {
    try {
      const id = mapId(request); if (!id) return failure(request, response, 400, "validation_failed", "Map asset ID is malformed.");
      const found = wizardFor(request, id); if (!found) return failure(request, response, 404, "not_found", "Calibration wizard was not found or expired.");
      const action = WizardActionSchema.parse(request.body);
      if (action.action === "adjust") found.session.state = adjustWizardGrid(found.session.state, action.adjustment);
      else if (action.action === "undo") found.session.state = undoWizardGrid(found.session.state);
      else if (action.action === "redo") found.session.state = redoWizardGrid(found.session.state);
      else found.session.state = verifyWizardIntersection(found.session.state, action.imagePoint, action.tolerancePx);
      return success(response, 200, wizardPayload(found.id, found.session.state));
    } catch (error) { return failure(request, response, 400, "validation_failed", error instanceof z.ZodError ? "Calibration action is malformed." : (error as Error).message); }
  });

  router.post(`${MAP_COLLECTION}/:id/calibration/wizards/:wizardId/complete`, requireGm, (request, response) => {
    try {
      const id = mapId(request); if (!id) return failure(request, response, 400, "validation_failed", "Map asset ID is malformed.");
      const found = wizardFor(request, id); if (!found) return failure(request, response, 404, "not_found", "Calibration wizard was not found or expired.");
      const state = completeGridCalibrationWizard(found.session.state);
      const verification = state.verification!;
      const entry = options.catalog.saveCalibration(id, { calibration: state.calibration!, verifiedAt: new Date(now()).toISOString(), verificationPoint: verification.imagePoint, verificationErrorPx: verification.errorPx });
      wizards.delete(found.id);
      return success(response, 200, { map: entry });
    } catch (error) { return failure(request, response, 400, "validation_failed", (error as Error).message); }
  });

  router.put(`${MAP_COLLECTION}/:id/scale`, requireGm, (request, response) => {
    try {
      const id = mapId(request); if (!id) return failure(request, response, 400, "validation_failed", "Map asset ID is malformed.");
      const input = ScaleSchema.parse(request.body);
      return success(response, 200, { map: options.catalog.saveScale(id, deriveMapDistanceScale(input)) });
    } catch (error) { return failure(request, response, 400, "validation_failed", error instanceof z.ZodError ? "Map scale request is malformed." : (error as Error).message); }
  });

  router.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
    if ((error as { type?: string }).type === "entity.too.large") return failure(request, response, 413, "bad_request", "Map upload exceeds the 50 MiB limit.");
    return failure(request, response, 500, "internal_error", "Map request failed.");
  });
  return router;
}
