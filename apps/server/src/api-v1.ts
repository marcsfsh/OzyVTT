import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import {
  API_VERSION,
  CreateIntegrationCredentialRequestSchema,
  INTEGRATION_CREDENTIAL_PATHS,
  IntegrationScopeSchema,
  OPENAPI_DOCUMENT_PATH,
  openApiDocument,
  REALTIME_PROTOCOL_VERSION,
  RotateIntegrationCredentialRequestSchema,
  SYSTEM_PATHS,
  type ApiErrorCode,
  type IntegrationScope
} from "@vtt/api-contract";
import type { IntegrationCredentialStore } from "./integration-credentials.js";

type ApiV1RouterOptions = {
  applicationVersion: string;
  actorDefinitionVersion: number;
  authorizeIntegration: (token: string, requiredScope: IntegrationScope) => boolean | Promise<boolean>;
  /** GM session bearer auth, distinct from integration-credential auth: only a signed-in GM may manage credentials. */
  authorizeGm: (token: string | undefined) => boolean;
  credentialStore: Pick<IntegrationCredentialStore, "create" | "list" | "get" | "rotate" | "revoke" | "auditEvents">;
  /** The live-game surface (game-http.ts): mounted inside this router so it shares the request-id/cache-control middleware and sits before the API 404. */
  gameRouter?: Router;
};

const CREDENTIAL_ID_PARAM = "id";
const expressPath = (openApiPath: string) => openApiPath.replace(`{${CREDENTIAL_ID_PARAM}}`, `:${CREDENTIAL_ID_PARAM}`);

function requestId(req: Request) {
  const candidate = req.header("x-request-id");
  return candidate && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate) ? candidate : randomUUID();
}

function sendError(res: Response, id: string, status: number, code: ApiErrorCode, message: string, details?: Record<string, unknown>) {
  return res.status(status).json({ ok: false, apiVersion: API_VERSION, error: { code, message, requestId: id, ...(details ? { details } : {}) } });
}

function bearerToken(req: Request) {
  const authorization = req.header("authorization");
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1];
}

const CREDENTIAL_ID_SCHEMA = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function credentialIdParam(req: Request): string | null {
  const raw = req.params[CREDENTIAL_ID_PARAM];
  const id = Array.isArray(raw) ? raw[0] : raw;
  return typeof id === "string" && CREDENTIAL_ID_SCHEMA.test(id) ? id : null;
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

  function requireGm(req: Request, res: Response, next: NextFunction) {
    const token = bearerToken(req);
    if (!token || !options.authorizeGm(token)) return sendError(res, res.locals.requestId, 401, "unauthenticated", "A valid GM session is required.");
    next();
  }

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
        features: { webhooks: false, viewer: true, battlemapGridCalibration: true, gameApi: true, commandTunnel: true, encounterArchives: true, gameEventStream: true }
      }
    });
  });

  // Served from the imported, versioned document itself so the response is always byte-identical to what ships in @vtt/api-contract and is covered by its own tests.
  router.get(OPENAPI_DOCUMENT_PATH, (_req, res) => res.json(openApiDocument));

  router.post(expressPath(INTEGRATION_CREDENTIAL_PATHS.collection), requireGm, (req, res) => {
    const parsed = CreateIntegrationCredentialRequestSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, res.locals.requestId, 400, "validation_failed", "The credential request is malformed.", { issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) });
    try {
      const issued = options.credentialStore.create(parsed.data);
      return res.status(201).json({ ok: true, apiVersion: API_VERSION, data: { credential: issued.metadata, token: issued.token } });
    } catch (error) {
      return sendError(res, res.locals.requestId, 400, "bad_request", error instanceof Error ? error.message : "The credential could not be created.");
    }
  });

  router.get(expressPath(INTEGRATION_CREDENTIAL_PATHS.collection), requireGm, (_req, res) => {
    return res.json({ ok: true, apiVersion: API_VERSION, data: { credentials: options.credentialStore.list() } });
  });

  router.post(expressPath(INTEGRATION_CREDENTIAL_PATHS.rotate), requireGm, (req, res) => {
    const id = credentialIdParam(req);
    if (!id) return sendError(res, res.locals.requestId, 400, "validation_failed", "The credential ID is malformed.");
    const parsed = RotateIntegrationCredentialRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendError(res, res.locals.requestId, 400, "validation_failed", "The rotation request is malformed.");
    try {
      const issued = options.credentialStore.rotate(id, parsed.data.expiresAt);
      if (!issued) return sendError(res, res.locals.requestId, 404, "not_found", "That credential does not exist or is already revoked.");
      return res.json({ ok: true, apiVersion: API_VERSION, data: { credential: issued.metadata, token: issued.token } });
    } catch (error) {
      return sendError(res, res.locals.requestId, 409, "conflict", error instanceof Error ? error.message : "The credential could not be rotated.");
    }
  });

  router.post(expressPath(INTEGRATION_CREDENTIAL_PATHS.revoke), requireGm, (req, res) => {
    const id = credentialIdParam(req);
    if (!id) return sendError(res, res.locals.requestId, 400, "validation_failed", "The credential ID is malformed.");
    const revoked = options.credentialStore.revoke(id);
    const credential = options.credentialStore.get(id);
    if (!revoked && !credential) return sendError(res, res.locals.requestId, 404, "not_found", "That credential does not exist.");
    return res.json({ ok: true, apiVersion: API_VERSION, data: credential });
  });

  router.get(expressPath(INTEGRATION_CREDENTIAL_PATHS.audit), requireGm, (req, res) => {
    const id = credentialIdParam(req);
    if (!id) return sendError(res, res.locals.requestId, 400, "validation_failed", "The credential ID is malformed.");
    if (!options.credentialStore.get(id)) return sendError(res, res.locals.requestId, 404, "not_found", "That credential does not exist.");
    const events = options.credentialStore.auditEvents(id).map(({ id: eventId, type, occurredAt, detail }) => ({ id: eventId, type, occurredAt, detail }));
    return res.json({ ok: true, apiVersion: API_VERSION, data: { events } });
  });

  if (options.gameRouter) router.use(options.gameRouter);

  router.use((_req, res) => sendError(res, res.locals.requestId, 404, "not_found", "API route not found."));
  return router;
}
