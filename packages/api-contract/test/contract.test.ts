import { describe, expect, it } from "vitest";
import {
  API_NAMESPACE,
  API_VERSION,
  ApiErrorEnvelopeSchema,
  CommandEnvelopeSchema,
  CreateIntegrationCredentialRequestSchema,
  CredentialAuditEventSchema,
  EventEnvelopeSchema,
  INTEGRATION_CREDENTIAL_PATHS,
  IntegrationCredentialIssuedSchema,
  IntegrationCredentialMetadataSchema,
  IntegrationScopeSchema,
  OPENAPI_DOCUMENT_PATH,
  openApiDocument,
  REALTIME_PROTOCOL_VERSION,
  RotateIntegrationCredentialRequestSchema,
  SYSTEM_PATHS,
  SystemCapabilitiesResponseSchema,
  SystemVersionResponseSchema
} from "../src/index.js";

const requestId = "f84d13cb-a7da-4ef2-9f2f-53d38e49d862";
const credentialMetadata = { id: requestId, name: "overlay", scopes: ["system:read"], gameId: null, createdAt: "2026-07-15T12:00:00.000Z", expiresAt: null, lastUsedAt: null, revokedAt: null };

describe("public API contracts", () => {
  it("accepts a version and capability response using the advertised constants", () => {
    expect(SystemVersionResponseSchema.parse({ ok: true, apiVersion: API_VERSION, data: { applicationVersion: "0.1.0", apiVersion: API_VERSION, realtimeProtocolVersion: REALTIME_PROTOCOL_VERSION, schemaVersions: { actorDefinition: 1 } } }).data.apiVersion).toBe(API_VERSION);
    const capabilities = SystemCapabilitiesResponseSchema.parse({ ok: true, apiVersion: API_VERSION, data: { api: { version: API_VERSION, namespace: API_NAMESPACE }, realtime: { protocolVersion: REALTIME_PROTOCOL_VERSION, transport: "socket.io" }, supportedScopes: IntegrationScopeSchema.options, features: { webhooks: false, viewer: false, battlemapGridCalibration: false } } });
    expect(capabilities.data.supportedScopes).toContain("system:read");
  });

  it("rejects unknown versions, fields, scopes, and internal credential secrets", () => {
    expect(() => SystemVersionResponseSchema.parse({ ok: true, apiVersion: "2", data: {} })).toThrow();
    expect(() => ApiErrorEnvelopeSchema.parse({ ok: false, apiVersion: API_VERSION, error: { code: "database_failed", message: "no", requestId } })).toThrow();
    expect(() => IntegrationCredentialMetadataSchema.parse({ ...credentialMetadata, scopes: ["database:read"] })).toThrow();
    expect(() => IntegrationCredentialMetadataSchema.parse({ ...credentialMetadata, tokenSecret: "must-never-be-public" })).toThrow();
    expect(() => IntegrationCredentialMetadataSchema.parse({ ...credentialMetadata, secretHash: "deadbeef" })).toThrow();
  });

  it("requires idempotent versioned commands and ordered versioned events", () => {
    expect(CommandEnvelopeSchema.parse({ protocolVersion: REALTIME_PROTOCOL_VERSION, commandId: requestId, type: "character.claim", expectedRevision: 3, idempotencyKey: "claim-once", payload: { actorId: requestId } }).expectedRevision).toBe(3);
    expect(EventEnvelopeSchema.parse({ protocolVersion: REALTIME_PROTOCOL_VERSION, eventId: requestId, type: "character.claimed", sequence: 4, revision: 4, occurredAt: "2026-07-15T12:00:00.000Z", data: { actorId: requestId } }).sequence).toBe(4);
    expect(() => CommandEnvelopeSchema.parse({ protocolVersion: "2", commandId: requestId, type: "claim", idempotencyKey: "x", payload: {} })).toThrow();
  });

  describe("integration credential DTOs", () => {
    it("accepts a well-formed create request and rejects an empty scope list", () => {
      expect(CreateIntegrationCredentialRequestSchema.parse({ name: "Overlay bot", scopes: ["system:read"] }).scopes).toEqual(["system:read"]);
      expect(() => CreateIntegrationCredentialRequestSchema.parse({ name: "Overlay bot", scopes: [] })).toThrow();
      expect(() => CreateIntegrationCredentialRequestSchema.parse({ name: "", scopes: ["system:read"] })).toThrow();
      expect(() => CreateIntegrationCredentialRequestSchema.parse({ name: "x", scopes: ["system:read"], notAField: true })).toThrow();
    });

    it("preserves the omitted/null/set distinction on rotate expiration", () => {
      expect(RotateIntegrationCredentialRequestSchema.parse({}).expiresAt).toBeUndefined();
      expect(RotateIntegrationCredentialRequestSchema.parse({ expiresAt: null }).expiresAt).toBeNull();
      expect(RotateIntegrationCredentialRequestSchema.parse({ expiresAt: "2030-01-01T00:00:00.000Z" }).expiresAt).toBe("2030-01-01T00:00:00.000Z");
    });

    it("allows a one-time issued token alongside safe metadata, but no other schema ever carries a token field", () => {
      const issued = IntegrationCredentialIssuedSchema.parse({ credential: credentialMetadata, token: "vtt_int_example" });
      expect(issued.token).toBe("vtt_int_example");
      expect(() => IntegrationCredentialMetadataSchema.parse({ ...credentialMetadata, token: "must-never-appear-here" })).toThrow();
    });

    it("keeps audit events free of secret material by construction (detail is an open bag, but the schema itself never declares a secret field)", () => {
      const event = CredentialAuditEventSchema.parse({ id: 1, type: "used", occurredAt: "2026-07-15T12:00:00.000Z", detail: { requiredScope: "system:read", gameBound: false } });
      expect(event.type).toBe("used");
      expect(Object.keys(CredentialAuditEventSchema.shape)).toEqual(["id", "type", "occurredAt", "detail"]);
    });
  });

  it("keeps OpenAPI system, document, and credential paths, versions, scopes, and component references aligned", () => {
    expect(openApiDocument.openapi).toBe("3.1.0");
    expect(openApiDocument.info.version).toBe(API_VERSION);
    expect(openApiDocument.servers[0].url).toBe(API_NAMESPACE);

    const declaredPaths = [...Object.values(SYSTEM_PATHS), OPENAPI_DOCUMENT_PATH, ...Object.values(INTEGRATION_CREDENTIAL_PATHS)];
    expect(Object.keys(openApiDocument.paths).sort()).toEqual([...new Set(declaredPaths)].sort());
    expect(openApiDocument.components.schemas.SystemCapabilities.properties.supportedScopes.items.enum).toEqual(IntegrationScopeSchema.options);
    for (const path of Object.values(SYSTEM_PATHS)) expect(openApiDocument.paths[path].get.responses["200"].content["application/json"].schema.$ref).toMatch(/^#\/components\/schemas\//);
  });

  it("requires GM bearer auth (not integration-token auth) on every credential-management operation", () => {
    const collection = openApiDocument.paths[INTEGRATION_CREDENTIAL_PATHS.collection];
    expect(collection.post.security).toEqual([{ gmAuth: [] }]);
    expect(collection.get.security).toEqual([{ gmAuth: [] }]);
    expect(openApiDocument.paths[INTEGRATION_CREDENTIAL_PATHS.rotate].post.security).toEqual([{ gmAuth: [] }]);
    expect(openApiDocument.paths[INTEGRATION_CREDENTIAL_PATHS.revoke].post.security).toEqual([{ gmAuth: [] }]);
    expect(openApiDocument.paths[INTEGRATION_CREDENTIAL_PATHS.audit].get.security).toEqual([{ gmAuth: [] }]);
    expect(openApiDocument.components.securitySchemes.gmAuth).toEqual({ type: "http", scheme: "bearer", bearerFormat: "VTT GM session token" });
  });

  it("never declares a secret-bearing property on any public component schema except the one-time-issue response", () => {
    const forbiddenNames = /secret|hash|password|token/i;
    for (const [name, schema] of Object.entries(openApiDocument.components.schemas)) {
      const properties = "properties" in schema ? Object.keys((schema as { properties: Record<string, unknown> }).properties) : [];
      for (const property of properties) {
        if (name === "IntegrationCredentialIssued" && property === "token") continue;
        expect(property, `${name}.${property} looks secret-shaped`).not.toMatch(forbiddenNames);
      }
    }
  });

  it("serves the OpenAPI document from a dedicated, unauthenticated, stable path distinct from any one system operation", () => {
    expect(OPENAPI_DOCUMENT_PATH).toBe(`${API_NAMESPACE}/openapi.json`);
    expect(Object.values(SYSTEM_PATHS)).not.toContain(OPENAPI_DOCUMENT_PATH);
    expect(openApiDocument.paths[OPENAPI_DOCUMENT_PATH].get.security).toEqual([]);
  });
});
