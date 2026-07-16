import { describe, expect, it } from "vitest";
import {
  API_NAMESPACE,
  API_VERSION,
  ApiErrorEnvelopeSchema,
  CommandEnvelopeSchema,
  EventEnvelopeSchema,
  IntegrationCredentialMetadataSchema,
  IntegrationScopeSchema,
  openApiDocument,
  REALTIME_PROTOCOL_VERSION,
  SYSTEM_PATHS,
  SystemCapabilitiesResponseSchema,
  SystemVersionResponseSchema
} from "../src/index.js";

const requestId = "f84d13cb-a7da-4ef2-9f2f-53d38e49d862";

describe("public API contracts", () => {
  it("accepts a version and capability response using the advertised constants", () => {
    expect(SystemVersionResponseSchema.parse({ ok: true, apiVersion: API_VERSION, data: { applicationVersion: "0.1.0", apiVersion: API_VERSION, realtimeProtocolVersion: REALTIME_PROTOCOL_VERSION, schemaVersions: { actorDefinition: 1 } } }).data.apiVersion).toBe(API_VERSION);
    const capabilities = SystemCapabilitiesResponseSchema.parse({ ok: true, apiVersion: API_VERSION, data: { api: { version: API_VERSION, namespace: API_NAMESPACE }, realtime: { protocolVersion: REALTIME_PROTOCOL_VERSION, transport: "socket.io" }, supportedScopes: IntegrationScopeSchema.options, features: { webhooks: false, viewer: false, battlemapGridCalibration: false } } });
    expect(capabilities.data.supportedScopes).toContain("system:read");
  });

  it("rejects unknown versions, fields, scopes, and internal credential secrets", () => {
    expect(() => SystemVersionResponseSchema.parse({ ok: true, apiVersion: "2", data: {} })).toThrow();
    expect(() => ApiErrorEnvelopeSchema.parse({ ok: false, apiVersion: API_VERSION, error: { code: "database_failed", message: "no", requestId } })).toThrow();
    expect(() => IntegrationCredentialMetadataSchema.parse({ id: requestId, name: "overlay", scopes: ["database:read"], gameId: null, createdAt: "2026-07-15T12:00:00.000Z", expiresAt: null, lastUsedAt: null, revokedAt: null })).toThrow();
    expect(() => IntegrationCredentialMetadataSchema.parse({ id: requestId, name: "overlay", scopes: ["system:read"], gameId: null, createdAt: "2026-07-15T12:00:00.000Z", expiresAt: null, lastUsedAt: null, revokedAt: null, tokenSecret: "must-never-be-public" })).toThrow();
  });

  it("requires idempotent versioned commands and ordered versioned events", () => {
    expect(CommandEnvelopeSchema.parse({ protocolVersion: REALTIME_PROTOCOL_VERSION, commandId: requestId, type: "character.claim", expectedRevision: 3, idempotencyKey: "claim-once", payload: { actorId: requestId } }).expectedRevision).toBe(3);
    expect(EventEnvelopeSchema.parse({ protocolVersion: REALTIME_PROTOCOL_VERSION, eventId: requestId, type: "character.claimed", sequence: 4, revision: 4, occurredAt: "2026-07-15T12:00:00.000Z", data: { actorId: requestId } }).sequence).toBe(4);
    expect(() => CommandEnvelopeSchema.parse({ protocolVersion: "2", commandId: requestId, type: "claim", idempotencyKey: "x", payload: {} })).toThrow();
  });

  it("keeps OpenAPI system paths, versions, scopes, and component references aligned", () => {
    expect(openApiDocument.openapi).toBe("3.1.0");
    expect(openApiDocument.info.version).toBe(API_VERSION);
    expect(openApiDocument.servers[0].url).toBe(API_NAMESPACE);
    expect(Object.keys(openApiDocument.paths).sort()).toEqual(Object.values(SYSTEM_PATHS).sort());
    expect(openApiDocument.components.schemas.SystemCapabilities.properties.supportedScopes.items.enum).toEqual(IntegrationScopeSchema.options);
    for (const path of Object.values(SYSTEM_PATHS)) expect(openApiDocument.paths[path].get.responses["200"].content["application/json"].schema.$ref).toMatch(/^#\/components\/schemas\//);
  });
});
