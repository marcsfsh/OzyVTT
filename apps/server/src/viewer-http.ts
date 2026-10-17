import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { VIEWER_PAIRING_COOKIE, VIEWER_PATHS, VIEWER_SESSION_COOKIE } from "@vtt/api-contract";
import { cookie, pathParam, sendData, sendFailure, sendRefusal } from "./http-kit.js";
import { callerOf, refuse, type CredentialVerifiers } from "./request-auth.js";
import { ViewerAccessDeniedError, ViewerPairingRateLimitError, type ViewerAccessStore } from "./viewer-access.js";
import type { ViewerCoordinator } from "./viewer-coordinator.js";
import { ViewerRevisionConflictError, type ViewerCommand } from "./viewer-presentation.js";
import type { ViewerPresentationStore } from "./viewer-presentation-store.js";

const PointSchema = z.object({ x: z.number(), y: z.number() }).strict();
const CameraSchema = z.object({ center: PointSchema, zoom: z.number() }).strict();
const InitiativeSchema = z
  .object({
    visible: z.boolean(),
    round: z.number().int().nonnegative(),
    hiddenTurn: z.boolean().default(false),
    entries: z
      .array(z.object({ actorId: z.string(), name: z.string(), initiative: z.number(), active: z.boolean() }).strict())
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
/** A screen's word on its own sound: `blocked` until someone taps it, `muted` for the GM's silent preview. */
const SoundStatusSchema = z
  .object({ sound: z.enum(["on", "blocked", "muted"]), unplayable: z.array(z.uuid()).max(20).default([]) })
  .strict();
const ExchangeSchema = z
  .object({ code: z.string(), name: z.string(), expiresInMs: z.number().int().positive().nullable().optional() })
  .strict();
const ApproveSchema = z.object({ code: z.string().max(32), name: z.string().optional() }).strict();
const SCREEN_NAME = "Table screen";

type ViewerRouterOptions = Readonly<{
  access: ViewerAccessStore;
  presentation: ViewerPresentationStore;
  coordinator: ViewerCoordinator;
  /** The server's credential checks; `viewer` reads a paired screen's credential from its cookie or a bearer. */
  verifiers: CredentialVerifiers;
  now?: () => number;
}>;

function viewerCookie(token: string, maxAgeSeconds: number) {
  return `${VIEWER_SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}

function setViewerCookie(response: Response, token: string, maxAgeSeconds: number) {
  response.setHeader("set-cookie", viewerCookie(token, maxAgeSeconds));
}

/** The open pairing request's secret, sent back only to the screen-pairing routes. */
function pairingCookie(token: string, maxAgeSeconds: number) {
  return `${VIEWER_PAIRING_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=${VIEWER_PATHS.screenPairings}; Max-Age=${maxAgeSeconds}`;
}

/** A viewer credential minted at pairing lasts as long as the GM keeps it. */
const PAIRED_COOKIE_SECONDS = 60 * 60 * 24 * 365;

function errorResponse(error: unknown, response: Response) {
  if (error instanceof ViewerPairingRateLimitError) return sendFailure(response, 429, "rate_limited", error.message);
  if (error instanceof ViewerRevisionConflictError) return sendFailure(response, 409, "conflict", error.message);
  if (error instanceof ViewerAccessDeniedError) return sendFailure(response, 401, "unauthenticated", error.message);
  return sendRefusal(response, error, "Viewer request body is invalid.", "Viewer request failed.");
}

export function createViewerRouter(options: ViewerRouterOptions) {
  const router = Router();
  const now = options.now ?? Date.now;
  /** The GM's token, or null once the refusal is sent. */
  const requireGm = (request: Request, response: Response) => {
    const caller = callerOf(request, response, options.verifiers);
    if (caller.kind === "gm") return caller.token;
    refuse(response, caller, "The GM manages the table screens.");
    return null;
  };
  /** The screen's viewer token, or null once the refusal is sent. */
  const requireViewer = (request: Request, response: Response) => {
    const caller = callerOf(request, response, options.verifiers, { viewer: true });
    if (caller.kind === "viewer") return caller.token;
    refuse(response, caller, "This route is for a paired table screen.");
    return null;
  };
  /** A GM session or a paired screen, or null once the refusal is sent. */
  const requireGmOrViewer = (request: Request, response: Response) => {
    const caller = callerOf(request, response, options.verifiers, { viewer: true });
    if (caller.kind === "gm" || caller.kind === "viewer") return caller;
    refuse(response, caller, "The presentation is for the GM and the paired table screens.");
    return null;
  };

  router.post("/api/v1/viewer/pairings", (request, response) => {
    try {
      if (requireGm(request, response) === null) return;
      const input = PairingSchema.parse(request.body);
      const pairing = options.access.createPairingCode(input.ttlMs);
      return sendData(response, 201, { pairing });
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
      setViewerCookie(response, result.token, maxAge);
      return sendData(response, 201, { viewer: result.viewer });
    } catch (error) {
      return errorResponse(error, response);
    }
  });

  // A table screen asks to pair. It shows the code; the GM types it on their own device (ADR-0027).
  router.post(VIEWER_PATHS.screenPairings, (_request, response) => {
    try {
      const { requestToken, code, expiresAt } = options.access.openScreenPairing();
      const seconds = Math.max(1, Math.ceil((Date.parse(expiresAt) - now()) / 1_000));
      response.setHeader("set-cookie", pairingCookie(requestToken, seconds));
      return sendData(response, 201, { pairing: { code, expiresAt } });
    } catch (error) {
      return errorResponse(error, response);
    }
  });

  // The screen's poll: still waiting with its code, or paired, which hands over the viewer cookie once.
  router.get(VIEWER_PATHS.screenPairingsCurrent, (request, response) => {
    try {
      const held = cookie(request, VIEWER_PAIRING_COOKIE);
      const current = held ? options.access.collectScreenPairing(held) : null;
      if (!current) return sendFailure(response, 404, "not_found", "This screen has no open pairing request.");
      if (current.status === "waiting")
        return sendData(response, 200, {
          status: "waiting",
          pairing: { code: current.code, expiresAt: current.expiresAt }
        });
      response.setHeader("set-cookie", [viewerCookie(current.token, PAIRED_COOKIE_SECONDS), pairingCookie("", 0)]);
      return sendData(response, 200, { status: "paired", viewer: current.viewer });
    } catch (error) {
      return errorResponse(error, response);
    }
  });

  // The GM types the code a screen shows. A code that names no open request is a 404, never a 401: the GM's own
  // session is fine, and a 401 would sign them out.
  router.post(VIEWER_PATHS.screenPairingsApprove, (request, response) => {
    try {
      if (requireGm(request, response) === null) return;
      const input = ApproveSchema.parse(request.body);
      const approved = options.access.approveScreenPairing(input.code, input.name?.trim() || SCREEN_NAME);
      return sendData(response, 200, { approved });
    } catch (error) {
      if (error instanceof ViewerAccessDeniedError) return sendFailure(response, 404, "not_found", error.message);
      return errorResponse(error, response);
    }
  });

  router.get("/api/v1/viewer/access", (request, response) => {
    try {
      if (requireGm(request, response) === null) return;
      return sendData(response, 200, {
        viewers: options.access.list(),
        connections: options.coordinator.activeViewers()
      });
    } catch (error) {
      return errorResponse(error, response);
    }
  });

  router.delete("/api/v1/viewer/access/:id", (request, response) => {
    try {
      if (requireGm(request, response) === null) return;
      const viewer = options.access.revoke(pathParam(request, "id"));
      options.coordinator.disconnectViewerAccess(viewer.id);
      return sendData(response, 200, { viewer });
    } catch (error) {
      return errorResponse(error, response);
    }
  });

  // Read-only viewer cookie for the GM's own preview of the shared screen (iframe and pop-out).
  router.post("/api/v1/viewer/preview-session", (request, response) => {
    try {
      if (requireGm(request, response) === null) return;
      const result = options.access.mintPreviewSession("GM preview", 12 * 60 * 60 * 1_000);
      const maxAge = Math.max(1, Math.floor((Date.parse(result.viewer.expiresAt!) - now()) / 1_000));
      setViewerCookie(response, result.token, maxAge);
      return sendData(response, 201, { viewer: result.viewer });
    } catch (error) {
      return errorResponse(error, response);
    }
  });

  router.get("/api/v1/viewer/presentation", (request, response) => {
    try {
      if (requireGmOrViewer(request, response) === null) return;
      return sendData(response, 200, { presentation: options.coordinator.project(now()) });
    } catch (error) {
      return errorResponse(error, response);
    }
  });

  router.post("/api/v1/viewer/presentation/commands", async (request, response) => {
    try {
      const token = requireGm(request, response);
      if (token === null) return;
      const command = CommandSchema.parse(request.body) as Omit<ViewerCommand, "role">;
      const result = await options.coordinator.executeGm(token, command);
      return sendData(response, 200, { revision: result.state.revision, duplicate: result.duplicate });
    } catch (error) {
      return errorResponse(error, response);
    }
  });

  router.post("/api/v1/viewer/sound-status", (request, response) => {
    try {
      const token = requireViewer(request, response);
      if (token === null) return;
      options.coordinator.reportSound(token, SoundStatusSchema.parse(request.body));
      return sendData(response, 200, { received: true });
    } catch (error) {
      return errorResponse(error, response);
    }
  });

  router.get("/api/v1/viewer/events", (request, response) => {
    let disconnect = () => {};
    try {
      const caller = requireGmOrViewer(request, response);
      if (caller === null) return;
      const isGm = caller.kind === "gm";
      const token = caller.token;
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
