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

/**
 * Documentation-only path constants for `map-http.ts`'s already-shipped router (mounted
 * separately from `api-v1.ts`). Kept here so the served OpenAPI document matches the real,
 * running routes; the router itself keeps its own literal path strings rather than importing
 * these, since the two use different templating (`:id` vs `{id}`).
 */
export const MAP_ASSET_PATHS = {
  collection: `${API_NAMESPACE}/map-assets`,
  byId: `${API_NAMESPACE}/map-assets/{id}`,
  content: `${API_NAMESPACE}/map-assets/{id}/content`,
  scale: `${API_NAMESPACE}/map-assets/{id}/scale`,
  calibrationWizards: `${API_NAMESPACE}/map-assets/{id}/calibration/wizards`,
  calibrationWizardActions: `${API_NAMESPACE}/map-assets/{id}/calibration/wizards/{wizardId}/actions`,
  calibrationWizardComplete: `${API_NAMESPACE}/map-assets/{id}/calibration/wizards/{wizardId}/complete`
} as const;

/** Documentation-only path constants for `viewer-http.ts`'s already-shipped router. See the note on MAP_ASSET_PATHS. */
export const VIEWER_PATHS = {
  pairings: `${API_NAMESPACE}/viewer/pairings`,
  pairingsExchange: `${API_NAMESPACE}/viewer/pairings/exchange`,
  access: `${API_NAMESPACE}/viewer/access`,
  accessById: `${API_NAMESPACE}/viewer/access/{id}`,
  presentation: `${API_NAMESPACE}/viewer/presentation`,
  presentationCommands: `${API_NAMESPACE}/viewer/presentation/commands`,
  events: `${API_NAMESPACE}/viewer/events`
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
    [INTEGRATION_CREDENTIAL_PATHS.audit]: { get: { operationId: "getIntegrationCredentialAudit", security: [{ gmAuth: [] }], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Safe audit history: no secrets, only usage/lifecycle metadata", content: { "application/json": { schema: { $ref: "#/components/schemas/IntegrationCredentialAuditResponse" } } } }, "401": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } } } },
    [MAP_ASSET_PATHS.collection]: {
      post: { operationId: "uploadMapAsset", security: [{ gmAuth: [] }], description: "Uploads raw image bytes as the request body. `filename`, `name`, and `kind` (battlemap/regional/world) are query parameters, not a JSON body. Content-addressed: uploading identical bytes again returns the existing asset with `duplicate: true` instead of creating a copy.", parameters: [{ name: "filename", in: "query", schema: { type: "string" } }, { name: "name", in: "query", schema: { type: "string" } }, { name: "kind", in: "query", schema: { type: "string", enum: ["battlemap", "regional", "world"] } }], requestBody: { required: true, content: { "image/*": { schema: { type: "string", format: "binary" } } } }, responses: { "201": { description: "New map asset stored", content: { "application/json": { schema: { $ref: "#/components/schemas/MapAssetUploadResponse" } } } }, "200": { description: "Identical bytes already stored; the existing asset is returned", content: { "application/json": { schema: { $ref: "#/components/schemas/MapAssetUploadResponse" } } } }, "400": { $ref: "#/components/responses/ApiError" }, "401": { $ref: "#/components/responses/ApiError" }, "413": { $ref: "#/components/responses/ApiError" } } },
      get: { operationId: "listMapAssets", security: [{ gmAuth: [] }], responses: { "200": { description: "Safe metadata for every stored map asset", content: { "application/json": { schema: { $ref: "#/components/schemas/MapAssetListResponse" } } } }, "401": { $ref: "#/components/responses/ApiError" } } }
    },
    [MAP_ASSET_PATHS.byId]: {
      get: { operationId: "getMapAsset", security: [{ gmAuth: [] }], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Safe metadata for one map asset", content: { "application/json": { schema: { $ref: "#/components/schemas/MapAssetResponse" } } } }, "401": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } } },
      patch: { operationId: "updateMapAssetDetails", security: [{ gmAuth: [] }], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, kind: { type: "string", enum: ["battlemap", "regional", "world"] } } } } } }, responses: { "200": { description: "Updated map catalog entry", content: { "application/json": { schema: { $ref: "#/components/schemas/MapAssetResponse" } } } }, "400": { $ref: "#/components/responses/ApiError" }, "401": { $ref: "#/components/responses/ApiError" } } }
    },
    [MAP_ASSET_PATHS.content]: { get: { operationId: "getMapAssetContent", description: "Renderer-safe original image bytes. Authorized for the GM, a player in the active encounter on this map, or a paired viewer session (cookie) — any one is sufficient. Supports ETag/If-None-Match (304), byte-range requests (206/416), and is always sent with `Cache-Control: private, no-store` since access can be revoked at any time.", security: [{ gmAuth: [] }, { viewerCookieAuth: [] }], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Full image bytes" }, "206": { description: "Partial content for a byte-range request" }, "304": { description: "Not modified" }, "403": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" }, "416": { description: "Range not satisfiable" } } } },
    [MAP_ASSET_PATHS.scale]: { put: { operationId: "setMapAssetScale", security: [{ gmAuth: [] }], description: "Gridless real-world scale, derived from two image points and a known distance.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["start", "end", "knownDistance", "unit"], properties: { start: { $ref: "#/components/schemas/ImagePoint" }, end: { $ref: "#/components/schemas/ImagePoint" }, knownDistance: { type: "number", exclusiveMinimum: 0 }, unit: { type: "string" } } } } } }, responses: { "200": { description: "Updated map catalog entry with the new scale", content: { "application/json": { schema: { $ref: "#/components/schemas/MapAssetResponse" } } } }, "400": { $ref: "#/components/responses/ApiError" }, "401": { $ref: "#/components/responses/ApiError" } } } },
    [MAP_ASSET_PATHS.calibrationWizards]: { post: { operationId: "startMapCalibrationWizard", security: [{ gmAuth: [] }], description: "Starts a server-held, TTL-bounded calibration wizard session from either a fixed 3x3 area drag or a known-axis segment measurement, and returns its ID plus a viewport-clipped grid overlay preview.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "201": { description: "Wizard session started", content: { "application/json": { schema: { $ref: "#/components/schemas/MapCalibrationWizardResponse" } } } }, "400": { $ref: "#/components/responses/ApiError" }, "401": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } } } },
    [MAP_ASSET_PATHS.calibrationWizardActions]: { post: { operationId: "actOnMapCalibrationWizard", security: [{ gmAuth: [] }], description: "Applies one adjust/undo/redo/verify action to an in-progress wizard session, owned by the same GM bearer token that started it.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }, { name: "wizardId", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Updated wizard state and overlay", content: { "application/json": { schema: { $ref: "#/components/schemas/MapCalibrationWizardResponse" } } } }, "400": { $ref: "#/components/responses/ApiError" }, "401": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } } } },
    [MAP_ASSET_PATHS.calibrationWizardComplete]: { post: { operationId: "completeMapCalibrationWizard", security: [{ gmAuth: [] }], description: "Saves the wizard's current calibration to the map catalog and discards the wizard session. Verification is optional reassurance, not a requirement.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }, { name: "wizardId", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Saved calibration", content: { "application/json": { schema: { $ref: "#/components/schemas/MapAssetResponse" } } } }, "400": { $ref: "#/components/responses/ApiError" }, "401": { $ref: "#/components/responses/ApiError" }, "404": { $ref: "#/components/responses/ApiError" } } } },
    [VIEWER_PATHS.pairings]: { post: { operationId: "createViewerPairing", security: [{ gmAuth: [] }], description: "Issues a short-lived, one-time pairing code for a second-screen display to exchange for a session.", responses: { "201": { description: "Pairing code issued" }, "401": { $ref: "#/components/responses/ApiError" } } } },
    [VIEWER_PATHS.pairingsExchange]: { post: { operationId: "exchangeViewerPairing", security: [], description: "Exchanges a pairing code for an HttpOnly, SameSite=Strict `vtt_viewer_session` cookie. No request auth: the code itself is the credential.", responses: { "201": { description: "Paired; session cookie set" }, "400": { $ref: "#/components/responses/ApiError" } } } },
    [VIEWER_PATHS.access]: { get: { operationId: "listViewerAccess", security: [{ gmAuth: [] }], responses: { "200": { description: "Every paired viewer plus which are currently connected" }, "401": { $ref: "#/components/responses/ApiError" } } } },
    [VIEWER_PATHS.accessById]: { delete: { operationId: "revokeViewerAccess", security: [{ gmAuth: [] }], description: "Revokes one paired display and immediately disconnects its live event stream.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Revoked" }, "401": { $ref: "#/components/responses/ApiError" } } } },
    [VIEWER_PATHS.presentation]: { get: { operationId: "getViewerPresentation", security: [{ gmAuth: [] }, { viewerCookieAuth: [] }], responses: { "200": { description: "Current player-safe presentation state (map, camera, measurement, pings, initiative, encounter)" }, "401": { $ref: "#/components/responses/ApiError" } } } },
    [VIEWER_PATHS.presentationCommands]: { post: { operationId: "sendViewerPresentationCommand", security: [{ gmAuth: [] }], description: "GM-only optimistic-concurrency command (present/pause map, set camera, ping, set/clear measurement). `expectedRevision` mismatches return 409.", responses: { "200": { description: "Command applied" }, "400": { $ref: "#/components/responses/ApiError" }, "401": { $ref: "#/components/responses/ApiError" }, "409": { $ref: "#/components/responses/ApiError" } } } },
    [VIEWER_PATHS.events]: { get: { operationId: "streamViewerPresentation", security: [{ viewerCookieAuth: [] }], description: "Server-Sent Events stream of presentation updates for a paired viewer session; not a normal JSON response.", responses: { "200": { description: "text/event-stream of `presentation` events" }, "401": { $ref: "#/components/responses/ApiError" } } } }
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "VTT integration token" },
      gmAuth: { type: "http", scheme: "bearer", bearerFormat: "VTT GM session token" },
      viewerCookieAuth: { type: "apiKey", in: "cookie", name: "vtt_viewer_session", description: "Also accepted as a Bearer token; the cookie is what the paired second-screen browser actually sends." }
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
      ApiErrorEnvelope: { type: "object", additionalProperties: false, required: ["ok", "apiVersion", "error"], properties: { ok: { const: false }, apiVersion: { const: API_VERSION }, error: { type: "object", additionalProperties: false, required: ["code", "message", "requestId"], properties: { code: { type: "string", enum: ApiErrorCodeSchema.options }, message: { type: "string" }, requestId: { type: "string", format: "uuid" }, details: { type: "object", additionalProperties: true }, retryAfterSeconds: { type: "integer", minimum: 1 }, currentRevision: { type: "integer", minimum: 0 } } } } },
      ImagePoint: { type: "object", additionalProperties: false, required: ["x", "y"], properties: { x: { type: "number" }, y: { type: "number" } } },
      /** Calibration/scale/wizard-state internals are intentionally left as flexible objects rather than fully typed here — the geometry lives in apps/server/src/grid-calibration*.ts and is out of scope for this documentation pass. */
      MapAssetMetadata: { type: "object", additionalProperties: false, required: ["id", "name", "kind", "originalName", "format", "mediaType", "width", "height", "byteLength", "importedAt", "calibration", "scale", "updatedAt"], properties: { id: { type: "string", format: "uuid" }, name: { type: "string" }, kind: { type: "string", enum: ["battlemap", "regional", "world"] }, originalName: { type: "string" }, format: { type: "string" }, mediaType: { type: "string" }, width: { type: "integer", minimum: 1 }, height: { type: "integer", minimum: 1 }, byteLength: { type: "integer", minimum: 1 }, importedAt: { type: "string", format: "date-time" }, calibration: { type: ["object", "null"], additionalProperties: true }, scale: { type: ["object", "null"], additionalProperties: true }, updatedAt: { type: "string", format: "date-time" } } },
      MapCatalogEntry: { type: "object", additionalProperties: false, required: ["assetId", "name", "kind", "calibration", "scale", "createdAt", "updatedAt"], properties: { assetId: { type: "string", format: "uuid" }, name: { type: "string" }, kind: { type: "string", enum: ["battlemap", "regional", "world"] }, calibration: { type: ["object", "null"], additionalProperties: true }, scale: { type: ["object", "null"], additionalProperties: true }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" } } },
      MapAssetUploadResponse: envelopeSchema("#/components/schemas/MapAssetUploadData"),
      MapAssetUploadData: { type: "object", additionalProperties: false, required: ["asset", "duplicate"], properties: { asset: { $ref: "#/components/schemas/MapAssetMetadata" }, duplicate: { type: "boolean" } } },
      MapAssetListResponse: envelopeSchema("#/components/schemas/MapAssetListData"),
      MapAssetListData: { type: "object", additionalProperties: false, required: ["assets"], properties: { assets: { type: "array", items: { $ref: "#/components/schemas/MapAssetMetadata" } } } },
      MapAssetResponse: envelopeSchema("#/components/schemas/MapAssetData"),
      MapAssetData: { type: "object", oneOf: [{ type: "object", additionalProperties: false, required: ["asset"], properties: { asset: { $ref: "#/components/schemas/MapAssetMetadata" } } }, { type: "object", additionalProperties: false, required: ["map"], properties: { map: { $ref: "#/components/schemas/MapCatalogEntry" } } }], description: "GET responses use `asset` (full asset metadata); PATCH/scale/calibration-complete responses use `map` (catalog entry only)." },
      MapCalibrationWizardResponse: envelopeSchema("#/components/schemas/MapCalibrationWizardData"),
      MapCalibrationWizardData: { type: "object", additionalProperties: false, required: ["wizardId", "state", "overlay", "overlayWarning"], properties: { wizardId: { type: "string", format: "uuid" }, state: { type: "object", additionalProperties: true }, overlay: { type: "array", items: { type: "object", additionalProperties: true } }, overlayWarning: { type: ["string", "null"] } } }
    }
  }
} as const;
