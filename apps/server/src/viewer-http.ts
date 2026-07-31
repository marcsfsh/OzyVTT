import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { API_VERSION } from "@vtt/api-contract";
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
const EncounterSceneSchema = z.object({
  mapAssetId: z.string().nullable(),
  tokens: z.array(z.object({
    actorId: z.string(), name: z.string(), kind: z.enum(["player-character", "monster", "npc"]), position: PointSchema, sizePx: z.number().positive(), active: z.boolean()
  }).strict()).max(200)
}).strict();
const PayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("viewer.enabled.set"), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal("viewer.presentation.begin"), assetId: z.string(), altText: z.string(), camera: CameraSchema }).strict(),
  z.object({ type: z.literal("viewer.map.set"), assetId: z.string(), altText: z.string(), camera: CameraSchema }).strict(),
  z.object({ type: z.literal("viewer.camera.set"), camera: CameraSchema }).strict(),
  z.object({ type: z.literal("viewer.measurement.set"), measurement: z.object({ id: z.string(), points: z.array(PointSchema), distanceLabel: z.string() }).strict() }).strict(),
  z.object({ type: z.literal("viewer.measurement.clear") }).strict(),
  z.object({ type: z.literal("viewer.ping"), id: z.string(), point: PointSchema, label: z.string().optional(), durationMs: z.number().int().optional() }).strict(),
  z.object({ type: z.literal("viewer.initiative.set"), initiative: InitiativeSchema }).strict(),
  z.object({ type: z.literal("viewer.encounter.set"), initiative: InitiativeSchema, encounter: EncounterSceneSchema }).strict()
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

/**
 * ADR-0016 §2, which this router was the last `/api/v1` surface not to keep: a caller-supplied
 * `X-Request-Id` is echoed **only when it is a UUID v4**, and replaced otherwise.
 *
 * It used to accept any `[A-Za-z0-9._:-]{1,128}` string and echo it verbatim. Nothing in the app sends
 * the header at all, so no caller loses anything — but the id lands in the response body and in logs,
 * and echoing arbitrary caller text into both is how a log line becomes a forgery. Every other router
 * (`api-v1`, `game-http`, `codex-http`, `homebrew-http`, `map-http`, `token-http`) already refused it on
 * exactly that reasoning; this one now agrees, so the ADR's normative clause and the generated reference
 * are true of the whole surface rather than of six sevenths of it.
 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function requestId(request: Request, response: Response) {
  const supplied = request.header("x-request-id");
  const id = supplied && UUID_V4.test(supplied) ? supplied : randomUUID();
  response.setHeader("x-request-id", id);
  response.setHeader("cache-control", "no-store");
  return id;
}

/** Adds the shared ok/apiVersion/data envelope alongside the existing top-level keys every caller already reads (e.g. `body.pairing`), so no existing client parsing breaks. */
function success(response: Response, status: number, body: Record<string, unknown>) {
  return response.status(status).json({ ok: true, apiVersion: API_VERSION, ...body });
}

function errorResponse(error: unknown, request: Request, response: Response) {
  const id = requestId(request, response);
  const status = error instanceof ViewerPairingRateLimitError ? 429
    : error instanceof ViewerRevisionConflictError ? 409
      : error instanceof ViewerAccessDeniedError ? 401
        : error instanceof z.ZodError ? 400
          : error instanceof Error ? 400 : 500;
  const message = status === 500 ? "Viewer request failed." : error instanceof z.ZodError ? "Viewer request body is invalid." : (error as Error).message;
  // Codes are aligned to the shared ApiErrorCodeSchema vocabulary (unauthorized -> unauthenticated,
  // revision_conflict -> conflict, invalid_request -> validation_failed) for cross-router consistency.
  // No client branches on these values today (only `.error.message` is read), so this is a safe realignment.
  const code = status === 401 ? "unauthenticated" : status === 409 ? "conflict" : status === 429 ? "rate_limited" : status === 400 ? "validation_failed" : "internal_error";
  return response.status(status).json({ ok: false, apiVersion: API_VERSION, error: { code, message, requestId: id } });
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
      return success(response, 201, { pairing });
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
      return success(response, 201, { viewer: result.viewer });
    } catch (error) { return errorResponse(error, request, response); }
  });

  router.get("/api/v1/viewer/access", (request, response) => {
    try {
      requireGm(request);
      requestId(request, response);
      return success(response, 200, { viewers: options.access.list(), connections: options.coordinator.activeViewers() });
    } catch (error) { return errorResponse(error, request, response); }
  });

  router.delete("/api/v1/viewer/access/:id", (request, response) => {
    try {
      requireGm(request);
      const viewer = options.access.revoke(request.params.id);
      options.coordinator.disconnectViewerAccess(viewer.id);
      requestId(request, response);
      return success(response, 200, { viewer });
    } catch (error) { return errorResponse(error, request, response); }
  });

  // Mints a short-lived read-only viewer cookie for the GM's own preview of the shared screen (the
  // in-tab iframe and the pop-out window both load /viewer.html and authenticate with this cookie).
  router.post("/api/v1/viewer/preview-session", (request, response) => {
    try {
      requireGm(request);
      const result = options.access.mintPreviewSession("GM preview", 12 * 60 * 60 * 1_000);
      const maxAge = Math.max(1, Math.floor((Date.parse(result.viewer.expiresAt!) - now()) / 1_000));
      response.setHeader("set-cookie", `vtt_viewer_session=${encodeURIComponent(result.token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`);
      requestId(request, response);
      return success(response, 201, { viewer: result.viewer });
    } catch (error) { return errorResponse(error, request, response); }
  });

  router.get("/api/v1/viewer/presentation", (request, response) => {
    try {
      if (!options.authorizeGm(bearer(request))) requireViewer(request);
      requestId(request, response);
      return success(response, 200, { presentation: options.presentation.project(now()) });
    } catch (error) { return errorResponse(error, request, response); }
  });

  router.post("/api/v1/viewer/presentation/commands", async (request, response) => {
    try {
      const token = requireGm(request);
      const command = CommandSchema.parse(request.body) as Omit<ViewerCommand, "role">;
      const result = await options.coordinator.executeGm(token, command);
      requestId(request, response);
      return success(response, 200, { revision: result.state.revision, duplicate: result.duplicate });
    } catch (error) { return errorResponse(error, request, response); }
  });

  router.get("/api/v1/viewer/events", (request, response) => {
    let disconnect = () => {};
    try {
      const gmToken = bearer(request);
      const isGm = options.authorizeGm(gmToken);
      const token = isGm ? gmToken! : requireViewer(request);
      requestId(request, response);
      response.setHeader("content-type", "text/event-stream");
      response.setHeader("connection", "keep-alive");
      response.flushHeaders();
      const write = (presentation: unknown) => response.write(`event: presentation\ndata: ${JSON.stringify(presentation)}\n\n`);
      const connection = isGm ? options.coordinator.connectGm(token, write, () => response.end()) : options.coordinator.connectViewer(token, write, () => response.end());
      disconnect = connection.disconnect;
      const keepAlive = setInterval(() => response.write(": keepalive\n\n"), 15_000);
      request.on("close", () => { clearInterval(keepAlive); disconnect(); });
    } catch (error) { return errorResponse(error, request, response); }
  });

  return router;
}
