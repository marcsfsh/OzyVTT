import { z } from "zod";
import {
  CreateIntegrationCredentialRequestSchema,
  INTEGRATION_CREDENTIAL_PATHS,
  IntegrationCredentialAuditSchema,
  IntegrationCredentialIssuedSchema,
  IntegrationCredentialListSchema,
  IntegrationCredentialMetadataSchema,
  OPENAPI_DOCUMENT_PATH,
  PlayerSessionIssuedSchema,
  RotateIntegrationCredentialRequestSchema,
  SESSION_PATHS,
  SYSTEM_PATHS,
  SystemCapabilitiesSchema,
  SystemHealthSchema,
  SystemVersionSchema
} from "../index.js";
import { bareJson, defineRoute, GM_SESSION, json, ok, PUBLIC, refused } from "./define.js";

/** The system reads, this document, integration credentials and player seats. */

const EXAMPLE_TIME = "2026-10-18T19:30:00.000Z";
const EXAMPLE_ID = "6f1c2a7e-3b9d-4c1e-8f2a-5d7b9e0c4a11";

export const getSystemHealth = defineRoute({
  method: "get",
  path: SYSTEM_PATHS.health,
  operationId: "getSystemHealth",
  tag: "System",
  summary: "Check that the server is up",
  description: "Answers as soon as the server is serving. It reads nothing, so it suits a health check.",
  access: PUBLIC,
  responses: {
    200: ok(SystemHealthSchema, "The server is up, with its clock.", {
      example: { status: "ok", serverTime: EXAMPLE_TIME }
    })
  }
});

export const getSystemVersion = defineRoute({
  method: "get",
  path: SYSTEM_PATHS.version,
  operationId: "getSystemVersion",
  tag: "System",
  summary: "Read the versions the server speaks",
  description:
    "The application's version, the HTTP API's and the realtime protocol's, and the schema version of an actor definition.",
  access: PUBLIC,
  responses: {
    200: ok(SystemVersionSchema, "The versions.", {
      example: {
        applicationVersion: "0.1.0",
        apiVersion: "1",
        realtimeProtocolVersion: "1",
        schemaVersions: { actorDefinition: 1 }
      }
    })
  }
});

export const getSystemCapabilities = defineRoute({
  method: "get",
  path: SYSTEM_PATHS.capabilities,
  operationId: "getSystemCapabilities",
  tag: "System",
  summary: "Read what this server offers an integration",
  description:
    "The API and realtime versions, every scope a credential may carry, and which surfaces exist here. An integration checks `features` before it asks the GM for a scope. Only an integration credential with `system:read` reads it.",
  access: { scope: "system:read" },
  responses: {
    200: ok(SystemCapabilitiesSchema, "The server's capabilities."),
    401: refused(),
    403: refused()
  }
});

export const getOpenApiDocument = defineRoute({
  method: "get",
  path: OPENAPI_DOCUMENT_PATH,
  operationId: "getOpenApiDocument",
  tag: "System",
  summary: "Read this document",
  description: "This OpenAPI 3.1 document, as the running server generates it from its route registry.",
  access: PUBLIC,
  responses: {
    200: bareJson(z.record(z.string(), z.unknown()), "This document.")
  }
});

const credentialId = z.object({ id: z.uuid({ version: "v4" }).describe("The credential's id.") });

export const createIntegrationCredential = defineRoute({
  method: "post",
  path: INTEGRATION_CREDENTIAL_PATHS.collection,
  operationId: "createIntegrationCredential",
  tag: "Integration credentials",
  summary: "Mint an integration credential",
  description:
    "Mints a credential with the scopes given. Its token is in this answer only: the server keeps a salted hash and cannot show it again.",
  access: GM_SESSION,
  body: json(CreateIntegrationCredentialRequestSchema, {
    example: { name: "Stream overlay", scopes: ["game:read", "combat:read"] }
  }),
  responses: {
    201: ok(IntegrationCredentialIssuedSchema, "The credential and its token, shown this once."),
    400: refused(),
    401: refused(),
    403: refused()
  }
});

export const listIntegrationCredentials = defineRoute({
  method: "get",
  path: INTEGRATION_CREDENTIAL_PATHS.collection,
  operationId: "listIntegrationCredentials",
  tag: "Integration credentials",
  summary: "List the integration credentials",
  description: "Every credential's name, scopes and dates. No answer carries a token or its hash.",
  access: GM_SESSION,
  responses: {
    200: ok(IntegrationCredentialListSchema, "Every credential."),
    401: refused(),
    403: refused()
  }
});

export const rotateIntegrationCredential = defineRoute({
  method: "post",
  path: INTEGRATION_CREDENTIAL_PATHS.rotate,
  operationId: "rotateIntegrationCredential",
  tag: "Integration credentials",
  summary: "Replace a credential's token",
  description:
    "Issues a new token for the credential and ends the old one at once. The new token is in this answer only. A revoked credential is a 404.",
  access: GM_SESSION,
  params: credentialId,
  body: json(RotateIntegrationCredentialRequestSchema, { required: false }),
  responses: {
    200: ok(IntegrationCredentialIssuedSchema, "The credential and its new token, shown this once."),
    400: refused(),
    401: refused(),
    403: refused(),
    404: refused(),
    409: refused("The new expiry is already past.")
  }
});

export const revokeIntegrationCredential = defineRoute({
  method: "post",
  path: INTEGRATION_CREDENTIAL_PATHS.revoke,
  operationId: "revokeIntegrationCredential",
  tag: "Integration credentials",
  summary: "Revoke a credential",
  description: "Ends the credential at once; its next request is refused with 401. Revoking it again changes nothing.",
  access: GM_SESSION,
  params: credentialId,
  responses: {
    200: ok(IntegrationCredentialMetadataSchema, "The revoked credential."),
    400: refused(),
    401: refused(),
    403: refused(),
    404: refused()
  }
});

export const getIntegrationCredentialAudit = defineRoute({
  method: "get",
  path: INTEGRATION_CREDENTIAL_PATHS.audit,
  operationId: "getIntegrationCredentialAudit",
  tag: "Integration credentials",
  summary: "Read a credential's history",
  description: "When the credential was made, used, refused, rotated and revoked. The history holds no secret.",
  access: GM_SESSION,
  params: credentialId,
  responses: {
    200: ok(IntegrationCredentialAuditSchema, "The credential's history, oldest first."),
    400: refused(),
    401: refused(),
    403: refused(),
    404: refused()
  }
});

export const issuePlayerSession = defineRoute({
  method: "post",
  path: SESSION_PATHS.player,
  operationId: "issuePlayerSession",
  tag: "Player sessions",
  summary: "Take a player seat",
  description:
    "Issues a player session token, as the socket's join does, for a headless or custom player client. Anyone on the network may take a seat once the GM has set a password. The token then reads and acts with a player's limits everywhere in this API.",
  access: PUBLIC,
  responses: {
    201: ok(PlayerSessionIssuedSchema, "The player session.", {
      example: { token: "vtt_player_example", sessionId: EXAMPLE_ID }
    }),
    409: refused("The GM has not set a password on this host yet.")
  }
});

export const SYSTEM_ROUTES = [getSystemHealth, getSystemVersion, getSystemCapabilities, getOpenApiDocument] as const;
export const CREDENTIAL_ROUTES = [
  createIntegrationCredential,
  listIntegrationCredentials,
  rotateIntegrationCredential,
  revokeIntegrationCredential,
  getIntegrationCredentialAudit
] as const;
export const SESSION_ROUTES = [issuePlayerSession] as const;
