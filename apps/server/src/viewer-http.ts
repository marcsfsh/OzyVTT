import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { ViewerAccessDeniedError, ViewerPairingRateLimitError, type ViewerAccessStore } from "./viewer-access.js";
import type { ViewerCoordinator } from "./viewer-coordinator.js";
import { ViewerRevisionConflictError, type ViewerCommand } from "./viewer-presentation.js";
import type { ViewerPresentationStore } from "./viewer-presentation-store.js";

const PointSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const CameraSchema = z.object({ center: PointSchema, zoom: z.number().finite() }).strict();
const InitiativeSchema = z.object({
  visible: z.boolean(),
  round: z.number().int().nonnegative(),
  hiddenTurn: z.boolean().default(false),
  entries: z.array(z.object({ actorId: z.string(), name: z.string(), initiative: z.number().finite(), active: z.boolean() }).strict()).max(200)
}).strict();
const PayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("viewer.enabled.set"), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal("viewer.presentation.begin"), assetId: z.string(), altText: z.string(), camera: CameraSchema }).strict(),
  z.object({ type: z.literal("viewer.map.set"), assetId: z.string(), altText: z.string(), camera: CameraSchema }).strict(),
  z.object({ type: z.literal("viewer.camera.set"), camera: CameraSchema }).strict(),
  z.object({ type: z.literal("viewer.measurement.set"), measurement: z.object({ id: z.string(), points: z.array(PointSchema), distanceLabel: z.string() }).strict() }).strict(),
  z.object({ type: z.literal("viewer.measurement.clear") }).strict(),
  z.object({ type: z.literal("viewer.ping"), id: z.string(), point: PointSchema, label: z.string().optional(), durationMs: z.number().int().optional() }).strict(),
  z.object({ type: z.literal("viewer.initiative.set"), initiative: InitiativeSchema }).strict()
]);
const CommandSchema = z.object({ id: z.string(), expectedRevision: z.number().int().nonnegative().optional(), payload: PayloadSchema }).strict();
const PairingSchema = z.object({ ttlMs: z.number().int().optional() }).strict();
const ExchangeSchema = z.object({ code: z.string(), name: z.string(), expiresInMs: z.number().int().positive().nullable().optional() }).strict();

type ViewerRouterOptions = Readonly<{
  access: ViewerAccessStore;
  presentation: ViewerPresentationStore;
  coordinator: ViewerCoordinator;
  authorizeGm: (token: string | undefined) => boolean;
  now?: () => number;
}>;

function bearer(request: Request) {
  const value = request.header("authorization");
  return value?.startsWith("Bearer ") ? value.slice(7) : undefined;
}

function cookies(request: Request) {
  return Object.fromEntries((request.header("cookie") ?? "").split(";").flatMap((part) => {
    const separator = part.indexOf("=");
    if (separator < 1) return [];
    return [[part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())]];
  }));
}

function viewerToken(request: Request) {
  return bearer(request) ?? cookies(request).vtt_viewer_session;
}

function requestId(request: Request, response: Response) {
  const supplied = request.header("x-request-id");
  const id = supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : randomUUID();
  response.setHeader("x-request-id", id);
  response.setHeader("cache-control", "no-store");
  return id;
}

function errorResponse(error: unknown, request: Request, response: Response) {
  const id = requestId(request, response);
  const status = error instanceof ViewerPairingRateLimitError ? 429
    : error instanceof ViewerRevisionConflictError ? 409
      : error instanceof ViewerAccessDeniedError ? 401
        : error instanceof z.ZodError ? 400
          : error instanceof Error ? 400 : 500;
  const message = status === 500 ? "Viewer request failed." : error instanceof z.ZodError ? "Viewer request body is invalid." : (error as Error).message;
  return response.status(status).json({ error: { code: status === 401 ? "unauthorized" : status === 409 ? "revision_conflict" : status === 429 ? "rate_limited" : status === 400 ? "invalid_request" : "internal_error", message, requestId: id } });
}

export function createViewerRouter(options: ViewerRouterOptions) {
  const router = Router();
  const now = options.now ?? Date.now;
  const requireGm = (request: Request) => {
    const token = bearer(request);
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
      requestId(request, response);
      return response.status(201).json({ pairing });
    } catch (error) { return errorResponse(error, request, response); }
  });

  router.post("/api/v1/viewer/pairings/exchange", (request, response) => {
    try {
      const input = ExchangeSchema.parse(request.body);
      const expiresAt = input.expiresInMs == null ? input.expiresInMs : now() + input.expiresInMs;
      const result = options.access.exchangePairingCode(input.code, input.name, { expiresAt });
      const maxAge = result.viewer.expiresAt === null ? 60 * 60 * 24 * 365 : Math.max(1, Math.floor((Date.parse(result.viewer.expiresAt) - now()) / 1_000));
      response.setHeader("set-cookie", `vtt_viewer_session=${encodeURIComponent(result.token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`);
      requestId(request, response);
      return response.status(201).json({ viewer: result.viewer });
    } catch (error) { return errorResponse(error, request, response); }
  });

  router.get("/api/v1/viewer/access", (request, response) => {
    try {
      requireGm(request);
      requestId(request, response);
      return response.json({ viewers: options.access.list(), connections: options.coordinator.activeViewers() });
    } catch (error) { return errorResponse(error, request, response); }
  });

  router.delete("/api/v1/viewer/access/:id", (request, response) => {
    try {
      requireGm(request);
      const viewer = options.access.revoke(request.params.id);
      options.coordinator.disconnectViewerAccess(viewer.id);
      requestId(request, response);
      return response.json({ viewer });
    } catch (error) { return errorResponse(error, request, response); }
  });

  router.get("/api/v1/viewer/presentation", (request, response) => {
    try {
      if (!options.authorizeGm(bearer(request))) requireViewer(request);
      requestId(request, response);
      return response.json({ presentation: options.presentation.project(now()) });
    } catch (error) { return errorResponse(error, request, response); }
  });

  router.post("/api/v1/viewer/presentation/commands", async (request, response) => {
    try {
      const token = requireGm(request);
      const command = CommandSchema.parse(request.body) as Omit<ViewerCommand, "role">;
      const result = await options.coordinator.executeGm(token, command);
      requestId(request, response);
      return response.json({ revision: result.state.revision, duplicate: result.duplicate });
    } catch (error) { return errorResponse(error, request, response); }
  });

  router.get("/api/v1/viewer/events", (request, response) => {
    let disconnect = () => {};
    try {
      const token = requireViewer(request);
      requestId(request, response);
      response.setHeader("content-type", "text/event-stream");
      response.setHeader("connection", "keep-alive");
      response.flushHeaders();
      const connection = options.coordinator.connectViewer(token, (presentation) => response.write(`event: presentation\ndata: ${JSON.stringify(presentation)}\n\n`), () => response.end());
      disconnect = connection.disconnect;
      const keepAlive = setInterval(() => response.write(": keepalive\n\n"), 15_000);
      request.on("close", () => { clearInterval(keepAlive); disconnect(); });
    } catch (error) { return errorResponse(error, request, response); }
  });

  return router;
}
