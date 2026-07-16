import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import {
  API_VERSION,
  IntegrationScopeSchema,
  REALTIME_PROTOCOL_VERSION,
  SYSTEM_PATHS,
  type ApiErrorCode,
  type IntegrationScope
} from "@vtt/api-contract";

type ApiV1RouterOptions = {
  applicationVersion: string;
  actorDefinitionVersion: number;
  authorizeIntegration: (token: string, requiredScope: IntegrationScope) => boolean | Promise<boolean>;
};

function requestId(req: Request) {
  const candidate = req.header("x-request-id");
  return candidate && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate) ? candidate : randomUUID();
}

function sendError(res: Response, id: string, status: number, code: ApiErrorCode, message: string) {
  return res.status(status).json({ ok: false, apiVersion: API_VERSION, error: { code, message, requestId: id } });
}

function bearerToken(req: Request) {
  const authorization = req.header("authorization");
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1];
}

export function createApiV1Router(options: ApiV1RouterOptions) {
  const router = Router();

  router.use((req, res, next) => {
    const id = requestId(req);
    res.locals.requestId = id;
    res.setHeader("x-request-id", id);
    res.setHeader("cache-control", "no-store");
    next();
  });

  router.get(SYSTEM_PATHS.health, (_req, res) => res.json({
    ok: true,
    apiVersion: API_VERSION,
    data: { status: "ok", serverTime: new Date().toISOString() }
  }));

  router.get(SYSTEM_PATHS.version, (_req, res) => res.json({
    ok: true,
    apiVersion: API_VERSION,
    data: {
      applicationVersion: options.applicationVersion,
      apiVersion: API_VERSION,
      realtimeProtocolVersion: REALTIME_PROTOCOL_VERSION,
      schemaVersions: { actorDefinition: options.actorDefinitionVersion }
    }
  }));

  router.get(SYSTEM_PATHS.capabilities, async (req, res) => {
    const token = bearerToken(req);
    if (!token) return sendError(res, res.locals.requestId, 401, "unauthenticated", "A bearer integration token is required.");
    if (!(await options.authorizeIntegration(token, "system:read"))) return sendError(res, res.locals.requestId, 403, "forbidden", "The integration is not authorized for this capability.");
    return res.json({
      ok: true,
      apiVersion: API_VERSION,
      data: {
        api: { version: API_VERSION, namespace: `/api/v${API_VERSION}` },
        realtime: { protocolVersion: REALTIME_PROTOCOL_VERSION, transport: "socket.io" },
        supportedScopes: IntegrationScopeSchema.options,
        features: { webhooks: false, viewer: false, battlemapGridCalibration: false }
      }
    });
  });

  router.use((_req, res) => sendError(res, res.locals.requestId, 404, "not_found", "API route not found."));
  return router;
}
