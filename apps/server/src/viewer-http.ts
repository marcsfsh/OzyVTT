import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { bearerToken, cookie, pathParam, sendFailure, sendInternalError, sendViewerData } from "./http-kit.js";
import { InvalidRequestError } from "./invalid-request.js";
import { ViewerAccessDeniedError, ViewerPairingRateLimitError, type ViewerAccessStore } from "./viewer-access.js";
import type { ViewerCoordinator } from "./viewer-coordinator.js";
import { ViewerRevisionConflictError, type ViewerCommand } from "./viewer-presentation.js";
import type { ViewerPresentationStore } from "./viewer-presentation-store.js";

const PointSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const CameraSchema = z.object({ center: PointSchema, zoom: z.number().finite() }).strict();
const InitiativeSchema = z
  .object({
    visible: z.boolean(),
    round: z.number().int().nonnegative(),
    hiddenTurn: z.boolean().default(false),
    entries: z
      .array(
        z
          .object({ actorId: z.string(), name: z.string(), initiative: z.number().finite(), active: z.boolean() })
          .strict()
      )
      .max(200)
  })
  .strict();
const EncounterSceneSchema = z
  .object({
    mapAssetId: z.string().nullable(),
    tokens: z
      .array(
        z
          .object({
            actorId: z.string(),
            name: z.string(),
            kind: z.enum(["player-character", "monster", "npc"]),
            position: PointSchema,
            sizePx: z.number().positive(),
            active: z.boolean()
          })
          .strict()
      )
      .max(200)
  })
  .strict();
const PayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("viewer.enabled.set"), enabled: z.boolean() }).strict(),
  z
    .object({
      type: z.literal("viewer.presentation.begin"),
      assetId: z.string(),
      altText: z.string(),
      camera: CameraSchema
    })
    .strict(),
  z
    .object({ type: z.literal("viewer.map.set"), assetId: z.string(), altText: z.string(), camera: CameraSchema })
    .strict(),
  z.object({ type: z.literal("viewer.camera.set"), camera: CameraSchema }).strict(),
  z
    .object({
      type: z.literal("viewer.measurement.set"),
      measurement: z.object({ id: z.string(), points: z.array(PointSchema), distanceLabel: z.string() }).strict()
    })
    .strict(),
  z.object({ type: z.literal("viewer.measurement.clear") }).strict(),
  z
    .object({
      type: z.literal("viewer.ping"),
      id: z.string(),
      point: PointSchema,
      label: z.string().optional(),
      durationMs: z.number().int().optional()
    })
    .strict(),
  z.object({ type: z.literal("viewer.initiative.set"), initiative: InitiativeSchema }).strict(),
  z
    .object({ type: z.literal("viewer.encounter.set"), initiative: InitiativeSchema, encounter: EncounterSceneSchema })
    .strict()
]);
const CommandSchema = z
  .object({ id: z.string(), expectedRevision: z.number().int().nonnegative().optional(), payload: PayloadSchema })
  .strict();
const PairingSchema = z.object({ ttlMs: z.number().int().optional() }).strict();
const ExchangeSchema = z
  .object({ code: z.string(), name: z.string(), expiresInMs: z.number().int().positive().nullable().optional() })
  .strict();

type ViewerRouterOptions = Readonly<{
  access: ViewerAccessStore;
  presentation: ViewerPresentationStore;
  coordinator: ViewerCoordinator;
  authorizeGm: (token: string | undefined) => boolean;
  now?: () => number;
}>;

function viewerToken(request: Request) {
  return bearerToken(request) ?? cookie(request, "vtt_viewer_session");
}

function errorResponse(error: unknown, response: Response) {
  if (error instanceof ViewerPairingRateLimitError) return sendFailure(response, 429, "rate_limited", error.message);
  if (error instanceof ViewerRevisionConflictError) return sendFailure(response, 409, "conflict", error.message);
  if (error instanceof ViewerAccessDeniedError) return sendFailure(response, 401, "unauthenticated", error.message);
  if (error instanceof z.ZodError)
    return sendFailure(response, 400, "validation_failed", "Viewer request body is invalid.");
  if (error instanceof InvalidRequestError) return sendFailure(response, 400, "validation_failed", error.message);
  return sendInternalError(response, error, "Viewer request failed.");
}

export function createViewerRouter(options: ViewerRouterOptions) {
  const router = Router();
  const now = options.now ?? Date.now;
  const requireGm = (request: Request) => {
    const token = bearerToken(request);
    if (!options.authorizeGm(token)) throw new ViewerAccessDeniedError("A valid GM session is required.");
    return token;
  };
  const requireViewer = (request: Request) => {
    const token = viewerToken(request);
    if (!token) throw new ViewerAccessDeniedError("A valid viewer session is required.");
    options.access.verify(token);
    return token;
  };

  router.post("/api/v1/viewer/pairings", (request, response) => {
    try {
      requireGm(request);
      const input = PairingSchema.parse(request.body);
      const pairing = options.access.createPairingCode(input.ttlMs);
      return sendViewerData(response, 201, { pairing });
    } catch (error) {
      return errorResponse(error, response);
    }
  });

  router.post("/api/v1/viewer/pairings/exchange", (request, response) => {
    try {
      const input = ExchangeSchema.parse(request.body);
      const expiresAt = input.expiresInMs == null ? input.expiresInMs : now() + input.expiresInMs;
      const result = options.access.exchangePairingCode(input.code, input.name, { expiresAt });
      const maxAge =
        result.viewer.expiresAt === null
          ? 60 * 60 * 24 * 365
          : Math.max(1, Math.floor((Date.parse(result.viewer.expiresAt) - now()) / 1_000));
      response.setHeader(
        "set-cookie",
        `vtt_viewer_session=${encodeURIComponent(result.token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`
      );
      return sendViewerData(response, 201, { viewer: result.viewer });
    } catch (error) {
      return errorResponse(error, response);
    }
  });

  router.get("/api/v1/viewer/access", (request, response) => {
    try {
      requireGm(request);
      return sendViewerData(response, 200, {
        viewers: options.access.list(),
        connections: options.coordinator.activeViewers()
      });
    } catch (error) {
      return errorResponse(error, response);
    }
  });

  router.delete("/api/v1/viewer/access/:id", (request, response) => {
    try {
      requireGm(request);
      const viewer = options.access.revoke(pathParam(request, "id"));
      options.coordinator.disconnectViewerAccess(viewer.id);
      return sendViewerData(response, 200, { viewer });
    } catch (error) {
      return errorResponse(error, response);
    }
  });

  // Read-only viewer cookie for the GM's own preview of the shared screen (iframe and pop-out).
  router.post("/api/v1/viewer/preview-session", (request, response) => {
    try {
      requireGm(request);
      const result = options.access.mintPreviewSession("GM preview", 12 * 60 * 60 * 1_000);
      const maxAge = Math.max(1, Math.floor((Date.parse(result.viewer.expiresAt!) - now()) / 1_000));
      response.setHeader(
        "set-cookie",
        `vtt_viewer_session=${encodeURIComponent(result.token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`
      );
      return sendViewerData(response, 201, { viewer: result.viewer });
    } catch (error) {
      return errorResponse(error, response);
    }
  });

  router.get("/api/v1/viewer/presentation", (request, response) => {
    try {
      if (!options.authorizeGm(bearerToken(request))) requireViewer(request);
      return sendViewerData(response, 200, { presentation: options.presentation.project(now()) });
    } catch (error) {
      return errorResponse(error, response);
    }
  });

  router.post("/api/v1/viewer/presentation/commands", async (request, response) => {
    try {
      const token = requireGm(request);
      const command = CommandSchema.parse(request.body) as Omit<ViewerCommand, "role">;
      const result = await options.coordinator.executeGm(token, command);
      return sendViewerData(response, 200, { revision: result.state.revision, duplicate: result.duplicate });
    } catch (error) {
      return errorResponse(error, response);
    }
  });

  router.get("/api/v1/viewer/events", (request, response) => {
    let disconnect = () => {};
    try {
      const gmToken = bearerToken(request);
      const isGm = options.authorizeGm(gmToken);
      const token = isGm ? gmToken! : requireViewer(request);
      response.setHeader("content-type", "text/event-stream");
      response.setHeader("connection", "keep-alive");
      response.flushHeaders();
      const write = (presentation: unknown) =>
        response.write(`event: presentation\ndata: ${JSON.stringify(presentation)}\n\n`);
      const connection = isGm
        ? options.coordinator.connectGm(token, write, () => response.end())
        : options.coordinator.connectViewer(token, write, () => response.end());
      disconnect = connection.disconnect;
      const keepAlive = setInterval(() => response.write(": keepalive\n\n"), 15_000);
      request.on("close", () => {
        clearInterval(keepAlive);
        disconnect();
      });
    } catch (error) {
      return errorResponse(error, response);
    }
  });

  return router;
}
