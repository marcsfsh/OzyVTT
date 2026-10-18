import { Router, type NextFunction, type Request, type Response } from "express";
import { API_VERSION, IntegrationScopeSchema, REALTIME_PROTOCOL_VERSION } from "@vtt/api-contract";
import { systemRoutes as routes } from "@vtt/api-contract/routes";
import { openApiDocument } from "./api-routes.js";
import { apiErrorHandler, issuesOf, mount, sendData, sendFailure, sendInternalError } from "./http-kit.js";
import type { IntegrationCredentialStore } from "./integration-credentials.js";
import { InvalidRequestError } from "./invalid-request.js";
import { callerOf, refuse, type CredentialVerifiers } from "./request-auth.js";

type ApiV1RouterOptions = {
  applicationVersion: string;
  actorDefinitionVersion: number;
  /** The server's credential checks. Only a GM session manages credentials; the capabilities read takes a
   *  `system:read` integration credential. */
  verifiers: CredentialVerifiers;
  credentialStore: Pick<IntegrationCredentialStore, "create" | "list" | "get" | "rotate" | "revoke" | "auditEvents">;
  /** The live-game surface (game-http.ts), mounted inside this router so it sits before the API 404. */
  gameRouter?: Router;
};

/** The credential id from the path, or null (after answering 400) when it is not a UUID v4. */
function credentialIdParam(request: Request, response: Response): string | null {
  const params = routes.revokeIntegrationCredential.params.safeParse(request.params);
  if (params.success) return params.data.id;
  sendFailure(response, 400, "validation_failed", "The credential ID is malformed.");
  return null;
}

export function createApiV1Router(options: ApiV1RouterOptions) {
  const router = Router();

  function requireGm(req: Request, res: Response, next: NextFunction) {
    const caller = callerOf(req, res, options.verifiers);
    if (caller.kind === "gm") return next();
    return refuse(res, caller, "Only a GM session manages integration credentials.");
  }

  mount(router, routes.getSystemHealth, (_req, res) =>
    sendData(res, 200, { status: "ok", serverTime: new Date().toISOString() })
  );

  mount(router, routes.getSystemVersion, (_req, res) =>
    sendData(res, 200, {
      applicationVersion: options.applicationVersion,
      apiVersion: API_VERSION,
      realtimeProtocolVersion: REALTIME_PROTOCOL_VERSION,
      schemaVersions: { actorDefinition: options.actorDefinitionVersion }
    })
  );

  mount(router, routes.getSystemCapabilities, (req, res) => {
    const caller = callerOf(req, res, options.verifiers, { scope: "system:read" });
    if (caller.kind !== "integration" || !caller.inScope)
      return refuse(res, caller, "The capabilities read takes an integration credential with the system:read scope.");
    return sendData(res, 200, {
      api: { version: API_VERSION, namespace: `/api/v${API_VERSION}` },
      realtime: { protocolVersion: REALTIME_PROTOCOL_VERSION, transport: "socket.io" },
      supportedScopes: IntegrationScopeSchema.options,
      // Inlined, with no derivation from `SystemCapabilitiesSchema`, so a new flag must be added in both
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

  // Built from the route registry when the server starts, so it describes exactly what is mounted.
  mount(router, routes.getOpenApiDocument, (_req, res) => res.json(openApiDocument));

  mount(router, routes.createIntegrationCredential, requireGm, (req, res) => {
    const parsed = routes.createIntegrationCredential.body.schema.safeParse(req.body);
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

  mount(router, routes.listIntegrationCredentials, requireGm, (_req, res) =>
    sendData(res, 200, { credentials: options.credentialStore.list() })
  );

  mount(router, routes.rotateIntegrationCredential, requireGm, (req, res) => {
    const id = credentialIdParam(req, res);
    if (!id) return;
    const parsed = routes.rotateIntegrationCredential.body.schema.safeParse(req.body ?? {});
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

  mount(router, routes.revokeIntegrationCredential, requireGm, (req, res) => {
    const id = credentialIdParam(req, res);
    if (!id) return;
    const revoked = options.credentialStore.revoke(id);
    const credential = options.credentialStore.get(id);
    if (!revoked && !credential) return sendFailure(res, 404, "not_found", "That credential does not exist.");
    return sendData(res, 200, credential);
  });

  mount(router, routes.getIntegrationCredentialAudit, requireGm, (req, res) => {
    const id = credentialIdParam(req, res);
    if (!id) return;
    if (!options.credentialStore.get(id)) return sendFailure(res, 404, "not_found", "That credential does not exist.");
    const events = options.credentialStore
      .auditEvents(id)
      .map(({ id: eventId, type, occurredAt, detail }) => ({ id: eventId, type, occurredAt, detail }));
    return sendData(res, 200, { events });
  });

  if (options.gameRouter) router.use(options.gameRouter);

  // Mounted on the app directly, so a request outside `/api/v1` passes on to the client hosting.
  router.use((req, res, next) =>
    req.path === "/api/v1" || req.path.startsWith("/api/v1/")
      ? sendFailure(res, 404, "not_found", "API route not found.")
      : next()
  );
  router.use(apiErrorHandler("The request failed."));
  return router;
}
