import { createHash, randomUUID } from "node:crypto";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { assetRoutes as routes } from "@vtt/api-contract/routes";
import { sendAssetContent } from "./asset-content.js";
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
  isUuidV4,
  mount,
  pathParam,
  sendData,
  sendFailure,
  sendRefusal
} from "./http-kit.js";
import { InvalidRequestError } from "./invalid-request.js";
import type { MapAssetMetadata, MapAssetStore } from "./map-assets.js";
import { deriveMapDistanceScale } from "./map-measurement.js";
import type { MapCatalogEntry, MapCatalogStore, PublicMapAsset } from "./map-catalog.js";
import { callerOf, refuse, type CredentialVerifiers } from "./request-auth.js";

const FAULT = "Map request failed.";
const WIZARD_TTL_MS = 30 * 60 * 1_000;

type WizardSession = { ownerHash: string; assetId: string; state: GridCalibrationWizardState; touchedAt: number };

type MapRouterOptions = Readonly<{
  assets: MapAssetStore;
  catalog: MapCatalogStore;
  verifiers: CredentialVerifiers;
  /** Whether a joined player may load this map now. */
  playerMayLoad: (assetId: string) => boolean;
  /** Whether a paired table screen may load this map now. */
  viewerMayLoad: (assetId: string) => boolean;
  now?: () => number;
}>;

function mapId(request: Request) {
  const params = routes.getMapAsset.params.safeParse({ id: pathParam(request, "id") });
  return params.success ? params.data.id : null;
}

function publicAsset(metadata: MapAssetMetadata, entry: MapCatalogEntry): PublicMapAsset {
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
    const caller = callerOf(request, response, options.verifiers);
    if (caller.kind === "gm") return next();
    return refuse(response, caller, "The GM manages the map library.");
  };
  /** Answers the refusal itself and returns false when the caller may not load this map now. */
  const mayReadContent = (request: Request, response: Response, assetId: string) => {
    const caller = callerOf(request, response, options.verifiers, { viewer: true });
    const allowed =
      caller.kind === "gm" ||
      (caller.kind === "player" && options.playerMayLoad(assetId)) ||
      (caller.kind === "viewer" && options.viewerMayLoad(assetId));
    if (!allowed) refuse(response, caller, "That map is not available to this table session.");
    return allowed;
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

  mount(
    router,
    routes.uploadMapAsset,
    requireGm,
    express.raw({ type: () => true, limit: "51mb" }),
    async (request, response) => {
      try {
        if (!Buffer.isBuffer(request.body))
          return sendFailure(response, 400, "validation_failed", "Upload the image as the request body.");
        const query = routes.uploadMapAsset.query.parse(request.query);
        const filename = query.filename ?? "map";
        const name = query.name ?? filename.replace(/\.[^.]+$/, "");
        const kind = query.kind ?? "battlemap";
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

  mount(router, routes.listMapAssets, requireGm, async (_request, response) => {
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

  mount(router, routes.getMapAsset, requireGm, async (request, response) => {
    const id = mapId(request);
    if (!id) return sendFailure(response, 400, "validation_failed", "Map asset ID is malformed.");
    const [metadata, entry] = await Promise.all([options.assets.get(id), Promise.resolve(options.catalog.get(id))]);
    if (!metadata || !entry) return sendFailure(response, 404, "not_found", "Map asset was not found.");
    return sendData(response, 200, { asset: publicAsset(metadata, entry) });
  });

  mount(router, routes.updateMapAssetDetails, requireGm, (request, response) => {
    try {
      const id = mapId(request);
      if (!id) return sendFailure(response, 400, "validation_failed", "Map asset ID is malformed.");
      const input = routes.updateMapAssetDetails.body.schema.parse(request.body);
      return sendData(response, 200, { map: options.catalog.updateDetails(id, input) });
    } catch (error) {
      return sendRefusal(response, error, "Map details are malformed.", FAULT);
    }
  });

  mount(router, routes.renameMapFolder, requireGm, (request, response) => {
    try {
      const input = routes.renameMapFolder.body.schema.parse(request.body);
      options.catalog.renameFolder(input.from, input.to);
      return sendData(response, 200, { renamed: true });
    } catch (error) {
      return sendRefusal(response, error, "Folder rename is malformed.", FAULT);
    }
  });

  mount(router, routes.getMapAssetContent, async (request, response) => {
    const id = mapId(request);
    if (!id) return sendFailure(response, 400, "validation_failed", "Map asset ID is malformed.");
    if (!mayReadContent(request, response, id)) return;
    const metadata = await options.assets.get(id);
    const content = metadata ? await options.assets.readOriginal(id) : null;
    if (!metadata || !content) return sendFailure(response, 404, "not_found", "Map asset was not found.");
    return sendAssetContent(request, response, { ...metadata, content });
  });

  // Calibration numbers aren't secret (clients already get grid-derived token sizing); exposing them
  // read-only lets the map preview measurements. The server still computes authoritative geometry on
  // every annotation command.
  mount(router, routes.getMapAssetGrid, (request, response) => {
    const id = mapId(request);
    if (!id) return sendFailure(response, 400, "validation_failed", "Map asset ID is malformed.");
    if (!mayReadContent(request, response, id)) return;
    const entry = options.catalog.get(id);
    if (!entry) return sendFailure(response, 404, "not_found", "Map asset was not found.");
    return sendData(response, 200, { calibration: entry.calibration?.calibration ?? null });
  });

  mount(router, routes.startMapCalibrationWizard, requireGm, async (request, response) => {
    try {
      const id = mapId(request);
      const token = bearerToken(request);
      if (!id || !token) return sendFailure(response, 400, "validation_failed", "Map asset ID is malformed.");
      const metadata = await options.assets.get(id);
      if (!metadata || !options.catalog.get(id))
        return sendFailure(response, 404, "not_found", "Map asset was not found.");
      const input = routes.startMapCalibrationWizard.body.schema.parse(request.body);
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

  mount(router, routes.actOnMapCalibrationWizard, requireGm, (request, response) => {
    try {
      const id = mapId(request);
      if (!id) return sendFailure(response, 400, "validation_failed", "Map asset ID is malformed.");
      const found = wizardFor(request, id);
      if (!found) return sendFailure(response, 404, "not_found", "Calibration wizard was not found or expired.");
      const action = routes.actOnMapCalibrationWizard.body.schema.parse(request.body);
      if (action.action === "adjust") found.session.state = adjustWizardGrid(found.session.state, action.adjustment);
      else if (action.action === "undo") found.session.state = undoWizardGrid(found.session.state);
      else if (action.action === "redo") found.session.state = redoWizardGrid(found.session.state);
      else found.session.state = verifyWizardIntersection(found.session.state, action.imagePoint, action.tolerancePx);
      return sendData(response, 200, wizardPayload(found.id, found.session.state));
    } catch (error) {
      return sendRefusal(response, error, "Calibration action is malformed.", FAULT);
    }
  });

  mount(router, routes.completeMapCalibrationWizard, requireGm, (request, response) => {
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

  mount(router, routes.setMapAssetScale, requireGm, (request, response) => {
    try {
      const id = mapId(request);
      if (!id) return sendFailure(response, 400, "validation_failed", "Map asset ID is malformed.");
      const input = routes.setMapAssetScale.body.schema.parse(request.body);
      return sendData(response, 200, { map: options.catalog.saveScale(id, deriveMapDistanceScale(input)) });
    } catch (error) {
      return sendRefusal(response, error, "Map scale request is malformed.", FAULT);
    }
  });

  router.use(apiErrorHandler(FAULT, "Map upload exceeds the 50 MiB limit."));
  return router;
}
