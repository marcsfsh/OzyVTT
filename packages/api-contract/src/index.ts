import { z } from "zod";

export const API_VERSION = "1" as const;
export const API_NAMESPACE = `/api/v${API_VERSION}` as const;
export const REALTIME_PROTOCOL_VERSION = "1" as const;

export const SYSTEM_PATHS = {
  health: `${API_NAMESPACE}/system/health`,
  version: `${API_NAMESPACE}/system/version`,
  capabilities: `${API_NAMESPACE}/system/capabilities`
} as const;

/** Served separately from SYSTEM_PATHS: it documents the whole contract rather than being one system operation among others. */
export const OPENAPI_DOCUMENT_PATH = `${API_NAMESPACE}/openapi.json` as const;

/** GM-authorized credential management, not integration-token authorized. `{id}` is OpenAPI-style; the Express router substitutes `:id`. */
export const INTEGRATION_CREDENTIAL_PATHS = {
  collection: `${API_NAMESPACE}/gm/integration-credentials`,
  rotate: `${API_NAMESPACE}/gm/integration-credentials/{id}/rotate`,
  revoke: `${API_NAMESPACE}/gm/integration-credentials/{id}/revoke`,
  audit: `${API_NAMESPACE}/gm/integration-credentials/{id}/audit`
} as const;

export const ApiErrorCodeSchema = z.enum([
  "bad_request",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "unsupported_version",
  "validation_failed",
  "internal_error"
]);

export const IntegrationScopeSchema = z.enum([
  "system:read",
  "game:read",
  "actor:read",
  "actor:write",
  "scene:read",
  "scene:write",
  "combat:read",
  "combat:write",
  "roll:create",
  "events:read",
  "webhooks:manage",
  "admin"
]);

const ApiVersionSchema = z.literal(API_VERSION);
const RealtimeProtocolVersionSchema = z.literal(REALTIME_PROTOCOL_VERSION);
const TimestampSchema = z.string().datetime({ offset: true });

export function successEnvelopeSchema<T extends z.ZodTypeAny>(data: T) {
  return z.object({ ok: z.literal(true), apiVersion: ApiVersionSchema, data }).strict();
}

export const ApiErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  apiVersion: ApiVersionSchema,
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string().min(1).max(500),
    requestId: z.string().uuid(),
    details: z.record(z.unknown()).optional(),
    retryAfterSeconds: z.number().int().positive().optional(),
    currentRevision: z.number().int().nonnegative().optional()
  }).strict()
}).strict();

export const SystemHealthSchema = z.object({
  status: z.literal("ok"),
  serverTime: TimestampSchema
}).strict();

export const SystemVersionSchema = z.object({
  applicationVersion: z.string().min(1),
  apiVersion: ApiVersionSchema,
  realtimeProtocolVersion: RealtimeProtocolVersionSchema,
  schemaVersions: z.object({ actorDefinition: z.number().int().positive() }).strict()
}).strict();

export const SystemCapabilitiesSchema = z.object({
  api: z.object({ version: ApiVersionSchema, namespace: z.literal(API_NAMESPACE) }).strict(),
  realtime: z.object({ protocolVersion: RealtimeProtocolVersionSchema, transport: z.literal("socket.io") }).strict(),
  supportedScopes: z.array(IntegrationScopeSchema),
  features: z.object({
    webhooks: z.boolean(),
    viewer: z.boolean(),
    battlemapGridCalibration: z.boolean()
  }).strict()
}).strict();

export const SystemHealthResponseSchema = successEnvelopeSchema(SystemHealthSchema);
export const SystemVersionResponseSchema = successEnvelopeSchema(SystemVersionSchema);
export const SystemCapabilitiesResponseSchema = successEnvelopeSchema(SystemCapabilitiesSchema);

export const IntegrationCredentialMetadataSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  scopes: z.array(IntegrationScopeSchema).min(1),
  gameId: z.string().uuid().nullable(),
  createdAt: TimestampSchema,
  expiresAt: TimestampSchema.nullable(),
  lastUsedAt: TimestampSchema.nullable(),
  revokedAt: TimestampSchema.nullable()
}).strict();

export const CreateIntegrationCredentialRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(IntegrationScopeSchema).min(1),
  gameId: z.string().uuid().nullable().optional(),
  expiresAt: TimestampSchema.nullable().optional()
}).strict();

/** Present only in the single create/rotate response that issues it; never returned by list, audit, or any later read. */
export const IntegrationCredentialIssuedSchema = z.object({
  credential: IntegrationCredentialMetadataSchema,
  token: z.string().min(1)
}).strict();

export const RotateIntegrationCredentialRequestSchema = z.object({
  /** Omit to keep the current expiration; pass null to clear it; pass a timestamp to set a new one. */
  expiresAt: TimestampSchema.nullable().optional()
}).strict();

export const CredentialAuditEventTypeSchema = z.enum(["created", "used", "verification_failed", "rotated", "revoked"]);
export const CredentialAuditEventSchema = z.object({
  id: z.number().int().positive(),
  type: CredentialAuditEventTypeSchema,
  occurredAt: TimestampSchema,
  detail: z.record(z.unknown())
}).strict();

export const IntegrationCredentialListSchema = z.object({ credentials: z.array(IntegrationCredentialMetadataSchema) }).strict();
export const IntegrationCredentialAuditSchema = z.object({ events: z.array(CredentialAuditEventSchema) }).strict();

export const IntegrationCredentialResponseSchema = successEnvelopeSchema(IntegrationCredentialMetadataSchema);
export const IntegrationCredentialIssuedResponseSchema = successEnvelopeSchema(IntegrationCredentialIssuedSchema);
export const IntegrationCredentialListResponseSchema = successEnvelopeSchema(IntegrationCredentialListSchema);
export const IntegrationCredentialAuditResponseSchema = successEnvelopeSchema(IntegrationCredentialAuditSchema);

export const CommandEnvelopeSchema = z.object({
  protocolVersion: RealtimeProtocolVersionSchema,
  commandId: z.string().uuid(),
  type: z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/),
  expectedRevision: z.number().int().nonnegative().optional(),
  idempotencyKey: z.string().min(1).max(200),
  payload: z.record(z.unknown())
}).strict();

export const EventEnvelopeSchema = z.object({
  protocolVersion: RealtimeProtocolVersionSchema,
  eventId: z.string().uuid(),
  type: z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/),
  sequence: z.number().int().positive(),
  revision: z.number().int().nonnegative(),
  occurredAt: TimestampSchema,
  data: z.record(z.unknown())
}).strict();

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type IntegrationScope = z.infer<typeof IntegrationScopeSchema>;
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelopeSchema>;
export type SystemHealth = z.infer<typeof SystemHealthSchema>;
export type SystemVersion = z.infer<typeof SystemVersionSchema>;
export type SystemCapabilities = z.infer<typeof SystemCapabilitiesSchema>;
export type IntegrationCredentialMetadata = z.infer<typeof IntegrationCredentialMetadataSchema>;
export type CreateIntegrationCredentialRequest = z.infer<typeof CreateIntegrationCredentialRequestSchema>;
export type IntegrationCredentialIssued = z.infer<typeof IntegrationCredentialIssuedSchema>;
export type RotateIntegrationCredentialRequest = z.infer<typeof RotateIntegrationCredentialRequestSchema>;
export type CredentialAuditEventType = z.infer<typeof CredentialAuditEventTypeSchema>;
export type CredentialAuditEvent = z.infer<typeof CredentialAuditEventSchema>;
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

const envelopeSchema = (dataRef: string) => ({
  type: "object",
  additionalProperties: false,
  required: ["ok", "apiVersion", "data"],
  properties: {
    ok: { const: true },
    apiVersion: { const: API_VERSION },
    data: { $ref: dataRef }
  }
});

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Combat-First VTT Integration API",
    version: API_VERSION,
    description: "Versioned, recipient-safe integration contract for a self-hosted VTT."
  },
  servers: [{ url: API_NAMESPACE }],
  paths: {
    [SYSTEM_PATHS.health]: { get: { operationId: "getSystemHealth", security: [], responses: { "200": { description: "Server is live", content: { "application/json": { schema: { $ref: "#/components/schemas/SystemHealthResponse" } } } } } } },
    [SYSTEM_PATHS.version]: { get: { operationId: "getSystemVersion", security: [], responses: { "200": { description: "Public protocol versions", content: { "application/json": { schema: { $ref: "#/components/schemas/SystemVersionResponse" } } } } } } },
    [SYSTEM_PATHS.capabilities]: { get: { operationId: "getSystemCapabilities", security: [{ bearerAuth: ["system:read"] }], responses: { "200": { description: "Authorized server capabilities", content: { "application/json": { schema: { $ref: "#/components/schemas/SystemCapabilitiesResponse" } } } }, "401": { $ref: "#/components/responses/ApiError" }, "403": { $ref: "#/components/responses/ApiError" } } } },
    [OPENAPI_DOCUMENT_PATH]: { get: { operationId: "getOpenApiDocument", security: [], responses: { "200": { description: "This exact OpenAPI 3.1 document, served from the running instance", content: { "application/json": { schema: { type: "object" } } } } } } },
    [INTEGRATION_CREDENTIAL_PATHS.collection]: {
      post: { operationId: "createIntegrationCredential", security: [{ gmAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateIntegrationCredentialRequest" } } } }, responses: { "201": { description: "Credential created; the token is shown exactly once", content: { "application/json": { schema: { $ref: "#/components/schemas/IntegrationCredentialIssuedResponse" } } } }, "400": { $ref: "#/components/responses/ApiError" }, "401": { $ref: "#/components/responses/ApiError" } } },
      get: { operationId: "listIntegrationCredentials", security: [{ gmAuth: [] }], responses: { "200": { description: "Safe metadata for every credential; never includes a secret", content: { "application/json": { schema: { $ref: "#/components/schemas/IntegrationCredentialListResponse" } } } }, "401": { $ref: "#/components/responses/ApiError" } } }
    },
    [INTEGRATION_CREDENTIAL_PATHS.rotate]: { post: { operationId: "rotateIntegrationCredential", security: [{ gmAuth: [] }], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], requestBody: { required: false, content: { "application/json": { schema: { $ref: "#/components/schemas/RotateIntegrationCredentialRequest" } } } }, responses: { "200": { description: "Credential rotated; the new token is shown exactly once", content: { "application/json": { schema: { $ref: "#/components/schemas/IntegrationCredentialIssuedResponse" } } } }, "401": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" }, "409": { $ref: "#/components/responses/ApiError" } } } },
    [INTEGRATION_CREDENTIAL_PATHS.revoke]: { post: { operationId: "revokeIntegrationCredential", security: [{ gmAuth: [] }], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Credential revoked; access denied immediately", content: { "application/json": { schema: { $ref: "#/components/schemas/IntegrationCredentialResponse" } } } }, "401": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } } } },
    [INTEGRATION_CREDENTIAL_PATHS.audit]: { get: { operationId: "getIntegrationCredentialAudit", security: [{ gmAuth: [] }], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Safe audit history: no secrets, only usage/lifecycle metadata", content: { "application/json": { schema: { $ref: "#/components/schemas/IntegrationCredentialAuditResponse" } } } }, "401": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } } } }
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "VTT integration token" },
      gmAuth: { type: "http", scheme: "bearer", bearerFormat: "VTT GM session token" }
    },
    responses: { ApiError: { description: "Stable API error", content: { "application/json": { schema: { $ref: "#/components/schemas/ApiErrorEnvelope" } } } } },
    schemas: {
      SystemHealth: { type: "object", additionalProperties: false, required: ["status", "serverTime"], properties: { status: { const: "ok" }, serverTime: { type: "string", format: "date-time" } } },
      SystemVersion: { type: "object", additionalProperties: false, required: ["applicationVersion", "apiVersion", "realtimeProtocolVersion", "schemaVersions"], properties: { applicationVersion: { type: "string" }, apiVersion: { const: API_VERSION }, realtimeProtocolVersion: { const: REALTIME_PROTOCOL_VERSION }, schemaVersions: { type: "object", additionalProperties: false, required: ["actorDefinition"], properties: { actorDefinition: { type: "integer", minimum: 1 } } } } },
      SystemCapabilities: { type: "object", additionalProperties: false, required: ["api", "realtime", "supportedScopes", "features"], properties: { api: { type: "object", additionalProperties: false, required: ["version", "namespace"], properties: { version: { const: API_VERSION }, namespace: { const: API_NAMESPACE } } }, realtime: { type: "object", additionalProperties: false, required: ["protocolVersion", "transport"], properties: { protocolVersion: { const: REALTIME_PROTOCOL_VERSION }, transport: { const: "socket.io" } } }, supportedScopes: { type: "array", items: { type: "string", enum: IntegrationScopeSchema.options } }, features: { type: "object", additionalProperties: false, required: ["webhooks", "viewer", "battlemapGridCalibration"], properties: { webhooks: { type: "boolean" }, viewer: { type: "boolean" }, battlemapGridCalibration: { type: "boolean" } } } } },
      SystemHealthResponse: envelopeSchema("#/components/schemas/SystemHealth"),
      SystemVersionResponse: envelopeSchema("#/components/schemas/SystemVersion"),
      SystemCapabilitiesResponse: envelopeSchema("#/components/schemas/SystemCapabilities"),
      IntegrationCredentialMetadata: { type: "object", additionalProperties: false, required: ["id", "name", "scopes", "gameId", "createdAt", "expiresAt", "lastUsedAt", "revokedAt"], properties: { id: { type: "string", format: "uuid" }, name: { type: "string", minLength: 1, maxLength: 100 }, scopes: { type: "array", minItems: 1, items: { type: "string", enum: IntegrationScopeSchema.options } }, gameId: { type: ["string", "null"], format: "uuid" }, createdAt: { type: "string", format: "date-time" }, expiresAt: { type: ["string", "null"], format: "date-time" }, lastUsedAt: { type: ["string", "null"], format: "date-time" }, revokedAt: { type: ["string", "null"], format: "date-time" } } },
      CreateIntegrationCredentialRequest: { type: "object", additionalProperties: false, required: ["name", "scopes"], properties: { name: { type: "string", minLength: 1, maxLength: 100 }, scopes: { type: "array", minItems: 1, items: { type: "string", enum: IntegrationScopeSchema.options } }, gameId: { type: ["string", "null"], format: "uuid" }, expiresAt: { type: ["string", "null"], format: "date-time" } } },
      IntegrationCredentialIssued: { type: "object", additionalProperties: false, required: ["credential", "token"], properties: { credential: { $ref: "#/components/schemas/IntegrationCredentialMetadata" }, token: { type: "string", minLength: 1, description: "Shown exactly once; the server stores only a salted hash and cannot redisplay it." } } },
      RotateIntegrationCredentialRequest: { type: "object", additionalProperties: false, properties: { expiresAt: { type: ["string", "null"], format: "date-time", description: "Omit to keep the current expiration; null clears it." } } },
      CredentialAuditEvent: { type: "object", additionalProperties: false, required: ["id", "type", "occurredAt", "detail"], properties: { id: { type: "integer", minimum: 1 }, type: { type: "string", enum: ["created", "used", "verification_failed", "rotated", "revoked"] }, occurredAt: { type: "string", format: "date-time" }, detail: { type: "object", additionalProperties: true } } },
      IntegrationCredentialList: { type: "object", additionalProperties: false, required: ["credentials"], properties: { credentials: { type: "array", items: { $ref: "#/components/schemas/IntegrationCredentialMetadata" } } } },
      IntegrationCredentialAudit: { type: "object", additionalProperties: false, required: ["events"], properties: { events: { type: "array", items: { $ref: "#/components/schemas/CredentialAuditEvent" } } } },
      IntegrationCredentialResponse: envelopeSchema("#/components/schemas/IntegrationCredentialMetadata"),
      IntegrationCredentialIssuedResponse: envelopeSchema("#/components/schemas/IntegrationCredentialIssued"),
      IntegrationCredentialListResponse: envelopeSchema("#/components/schemas/IntegrationCredentialList"),
      IntegrationCredentialAuditResponse: envelopeSchema("#/components/schemas/IntegrationCredentialAudit"),
      ApiErrorEnvelope: { type: "object", additionalProperties: false, required: ["ok", "apiVersion", "error"], properties: { ok: { const: false }, apiVersion: { const: API_VERSION }, error: { type: "object", additionalProperties: false, required: ["code", "message", "requestId"], properties: { code: { type: "string", enum: ApiErrorCodeSchema.options }, message: { type: "string" }, requestId: { type: "string", format: "uuid" }, details: { type: "object", additionalProperties: true }, retryAfterSeconds: { type: "integer", minimum: 1 }, currentRevision: { type: "integer", minimum: 0 } } } } }
    }
  }
} as const;
