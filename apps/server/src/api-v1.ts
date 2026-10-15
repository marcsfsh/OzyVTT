import { Router, type NextFunction, type Request, type Response } from "express";
import {
  API_VERSION,
  CreateIntegrationCredentialRequestSchema,
  INTEGRATION_CREDENTIAL_PATHS,
  IntegrationScopeSchema,
  OPENAPI_DOCUMENT_PATH,
  REALTIME_PROTOCOL_VERSION,
  RotateIntegrationCredentialRequestSchema,
  SYSTEM_PATHS,
  type IntegrationScope
} from "@vtt/api-contract";
import { openApiDocument } from "./openapi/document.js";
import {
  apiErrorHandler,
  bearerToken,
  expressPath,
  isUuidV4,
  issuesOf,
  pathParam,
  sendData,
  sendFailure,
  sendInternalError
} from "./http-kit.js";
import type { IntegrationCredentialStore } from "./integration-credentials.js";
import { InvalidRequestError } from "./invalid-request.js";

type ApiV1RouterOptions = {
  applicationVersion: string;
  actorDefinitionVersion: number;
  authorizeIntegration: (token: string, requiredScope: IntegrationScope) => boolean | Promise<boolean>;
  /** GM session bearer auth, distinct from integration-credential auth: only a signed-in GM may manage credentials. */
  authorizeGm: (token: string | undefined) => boolean;
  credentialStore: Pick<IntegrationCredentialStore, "create" | "list" | "get" | "rotate" | "revoke" | "auditEvents">;
  /** The live-game surface (game-http.ts), mounted inside this router so it sits before the API 404. */
  gameRouter?: Router;
};

/** The credential id from the path, or null (after answering 400) when it is not a UUID v4. */
function credentialIdParam(request: Request, response: Response): string | null {
  const id = pathParam(request, "id");
  if (isUuidV4(id)) return id;
  sendFailure(response, 400, "validation_failed", "The credential ID is malformed.");
  return null;
}

export function createApiV1Router(options: ApiV1RouterOptions) {
  const router = Router();

  function requireGm(req: Request, res: Response, next: NextFunction) {
    const token = bearerToken(req);
    if (!token || !options.authorizeGm(token))
      return sendFailure(res, 401, "unauthenticated", "A valid GM session is required.");
    next();
  }

  router.get(SYSTEM_PATHS.health, (_req, res) =>
    sendData(res, 200, { status: "ok", serverTime: new Date().toISOString() })
  );

  router.get(SYSTEM_PATHS.version, (_req, res) =>
    sendData(res, 200, {
      applicationVersion: options.applicationVersion,
      apiVersion: API_VERSION,
      realtimeProtocolVersion: REALTIME_PROTOCOL_VERSION,
      schemaVersions: { actorDefinition: options.actorDefinitionVersion }
    })
  );

  router.get(SYSTEM_PATHS.capabilities, async (req, res) => {
    const token = bearerToken(req);
    if (!token) return sendFailure(res, 401, "unauthenticated", "A bearer integration token is required.");
    if (!(await options.authorizeIntegration(token, "system:read")))
      return sendFailure(res, 403, "forbidden", "The integration is not authorized for this capability.");
    return sendData(res, 200, {
      api: { version: API_VERSION, namespace: `/api/v${API_VERSION}` },
      realtime: { protocolVersion: REALTIME_PROTOCOL_VERSION, transport: "socket.io" },
      supportedScopes: IntegrationScopeSchema.options,
      // Inlined rather than derived from `SystemCapabilitiesSchema`, so a new flag must be added in both
      // places. `codex: true` tells a credential holder the worldbuilding surface exists.
      features: {
        webhooks: false,
        viewer: true,
        battlemapGridCalibration: true,
        gameApi: true,
        commandTunnel: true,
        encounterArchives: true,
        rulesEngine: true,
        codex: true
      }
    });
  });

  // Served from the imported, versioned document so the response matches what ships in @vtt/api-contract.
  router.get(OPENAPI_DOCUMENT_PATH, (_req, res) => res.json(openApiDocument));

  router.post(expressPath(INTEGRATION_CREDENTIAL_PATHS.collection), requireGm, (req, res) => {
    const parsed = CreateIntegrationCredentialRequestSchema.safeParse(req.body);
    if (!parsed.success)
      return sendFailure(res, 400, "validation_failed", "The credential request is malformed.", {
        issues: issuesOf(parsed.error)
      });
    try {
      const issued = options.credentialStore.create(parsed.data);
      return sendData(res, 201, { credential: issued.metadata, token: issued.token });
    } catch (error) {
      if (error instanceof InvalidRequestError) return sendFailure(res, 400, "bad_request", error.message);
      return sendInternalError(res, error, "The credential could not be created.");
    }
  });

  router.get(expressPath(INTEGRATION_CREDENTIAL_PATHS.collection), requireGm, (_req, res) =>
    sendData(res, 200, { credentials: options.credentialStore.list() })
  );

  router.post(expressPath(INTEGRATION_CREDENTIAL_PATHS.rotate), requireGm, (req, res) => {
    const id = credentialIdParam(req, res);
    if (!id) return;
    const parsed = RotateIntegrationCredentialRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendFailure(res, 400, "validation_failed", "The rotation request is malformed.");
    try {
      const issued = options.credentialStore.rotate(id, parsed.data.expiresAt);
      if (!issued) return sendFailure(res, 404, "not_found", "That credential does not exist or is already revoked.");
      return sendData(res, 200, { credential: issued.metadata, token: issued.token });
    } catch (error) {
      if (error instanceof InvalidRequestError) return sendFailure(res, 409, "conflict", error.message);
      return sendInternalError(res, error, "The credential could not be rotated.");
    }
  });

  router.post(expressPath(INTEGRATION_CREDENTIAL_PATHS.revoke), requireGm, (req, res) => {
    const id = credentialIdParam(req, res);
    if (!id) return;
    const revoked = options.credentialStore.revoke(id);
    const credential = options.credentialStore.get(id);
    if (!revoked && !credential) return sendFailure(res, 404, "not_found", "That credential does not exist.");
    return sendData(res, 200, credential);
  });

  router.get(expressPath(INTEGRATION_CREDENTIAL_PATHS.audit), requireGm, (req, res) => {
    const id = credentialIdParam(req, res);
    if (!id) return;
    if (!options.credentialStore.get(id)) return sendFailure(res, 404, "not_found", "That credential does not exist.");
    const events = options.credentialStore
      .auditEvents(id)
      .map(({ id: eventId, type, occurredAt, detail }) => ({ id: eventId, type, occurredAt, detail }));
    return sendData(res, 200, { events });
  });

  if (options.gameRouter) router.use(options.gameRouter);

  router.use((_req, res) => sendFailure(res, 404, "not_found", "API route not found."));
  router.use(apiErrorHandler("The request failed."));
  return router;
}
