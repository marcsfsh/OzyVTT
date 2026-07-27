import { describe, expect, it } from "vitest";
import {
  API_NAMESPACE,
  API_VERSION,
  ApiErrorEnvelopeSchema,
  CODEX_ASSET_PATHS,
  CODEX_PATHS,
  CommandEnvelopeSchema,
  CONTENT_PATHS,
  CreateIntegrationCredentialRequestSchema,
  CredentialAuditEventSchema,
  ENCOUNTER_ARCHIVE_PATHS,
  EventEnvelopeSchema,
  GAME_PATHS,
  GameCommandEnvelopeSchema,
  GameMutationAcceptedSchema,
  GameSnapshotSchema,
  INTEGRATION_CREDENTIAL_PATHS,
  IntegrationCredentialIssuedSchema,
  IntegrationCredentialMetadataSchema,
  IntegrationScopeSchema,
  MAP_ASSET_PATHS,
  OPENAPI_DOCUMENT_PATH,
  openApiDocument,
  REALTIME_PROTOCOL_VERSION,
  RotateIntegrationCredentialRequestSchema,
  SESSION_PATHS,
  SYSTEM_PATHS,
  SystemCapabilitiesResponseSchema,
  SystemVersionResponseSchema,
  VIEWER_PATHS
} from "../src/index.js";

const requestId = "f84d13cb-a7da-4ef2-9f2f-53d38e49d862";
const credentialMetadata = { id: requestId, name: "overlay", scopes: ["system:read"], gameId: null, createdAt: "2026-07-15T12:00:00.000Z", expiresAt: null, lastUsedAt: null, revokedAt: null };

describe("public API contracts", () => {
  it("accepts a version and capability response using the advertised constants", () => {
    expect(SystemVersionResponseSchema.parse({ ok: true, apiVersion: API_VERSION, data: { applicationVersion: "0.1.0", apiVersion: API_VERSION, realtimeProtocolVersion: REALTIME_PROTOCOL_VERSION, schemaVersions: { actorDefinition: 1 } } }).data.apiVersion).toBe(API_VERSION);
    const capabilities = SystemCapabilitiesResponseSchema.parse({ ok: true, apiVersion: API_VERSION, data: { api: { version: API_VERSION, namespace: API_NAMESPACE }, realtime: { protocolVersion: REALTIME_PROTOCOL_VERSION, transport: "socket.io" }, supportedScopes: IntegrationScopeSchema.options, features: { webhooks: false, viewer: true, battlemapGridCalibration: true, gameApi: true, commandTunnel: true, encounterArchives: true, rulesEngine: true } } });
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

    const declaredPaths = [...Object.values(SYSTEM_PATHS), OPENAPI_DOCUMENT_PATH, ...Object.values(INTEGRATION_CREDENTIAL_PATHS), ...Object.values(MAP_ASSET_PATHS), ...Object.values(VIEWER_PATHS), ...Object.values(GAME_PATHS), ...Object.values(CONTENT_PATHS), ...Object.values(ENCOUNTER_ARCHIVE_PATHS), ...Object.values(SESSION_PATHS), ...Object.values(CODEX_PATHS), ...Object.values(CODEX_ASSET_PATHS)];
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

  it("documents the already-shipped map-asset and viewer routers with correctly scoped security", () => {
    expect(openApiDocument.paths[MAP_ASSET_PATHS.collection].post.security).toEqual([{ gmAuth: [] }]);
    expect(openApiDocument.paths[MAP_ASSET_PATHS.byId].get.security).toEqual([{ gmAuth: [] }]);
    // Content is the one map-asset operation not GM-only: GM, an authorized player, or a paired viewer session may read it.
    expect(openApiDocument.paths[MAP_ASSET_PATHS.content].get.security).toEqual([{ gmAuth: [] }, { viewerCookieAuth: [] }]);
    expect(openApiDocument.paths[MAP_ASSET_PATHS.calibrationWizards].post.security).toEqual([{ gmAuth: [] }]);
    expect(openApiDocument.paths[VIEWER_PATHS.pairings].post.security).toEqual([{ gmAuth: [] }]);
    // Exchanging a pairing code is the credential itself; no separate auth is required to call it.
    expect(openApiDocument.paths[VIEWER_PATHS.pairingsExchange].post.security).toEqual([]);
    expect(openApiDocument.paths[VIEWER_PATHS.presentationCommands].post.security).toEqual([{ gmAuth: [] }]);
    expect(openApiDocument.components.securitySchemes.viewerCookieAuth).toMatchObject({ type: "apiKey", in: "cookie", name: "vtt_viewer_session" });
  });

  it("documents the codex surface: GM-only writes, GM-or-player reads, session auth (never integration scopes)", () => {
    type Op = { security?: ReadonlyArray<Record<string, readonly string[]>> };
    const paths = openApiDocument.paths as unknown as Record<string, Record<string, Op>>;
    const gmOnly = [{ gmAuth: [] }];
    const gmOrPlayer = [{ gmAuth: [] }, { playerAuth: [] }];
    // Writes are GM-only.
    for (const [path, method] of [[CODEX_PATHS.pages, "post"], [CODEX_PATHS.pageById, "patch"], [CODEX_PATHS.pageById, "delete"], [CODEX_PATHS.maps, "post"], [CODEX_PATHS.mapMarkers, "post"], [CODEX_PATHS.markerById, "patch"], [CODEX_PATHS.journal, "post"], [CODEX_PATHS.calendar, "put"], [CODEX_ASSET_PATHS.collection, "post"]] as const) {
      expect(paths[path][method].security, `${method} ${path}`).toEqual(gmOnly);
    }
    // Reads accept a GM or a player session (players receive the revealed-only projection).
    for (const [path, method] of [[CODEX_PATHS.pages, "get"], [CODEX_PATHS.pageById, "get"], [CODEX_PATHS.search, "get"], [CODEX_PATHS.relationships, "get"], [CODEX_PATHS.maps, "get"], [CODEX_PATHS.mapMarkers, "get"], [CODEX_PATHS.journal, "get"], [CODEX_PATHS.calendar, "get"], [CODEX_ASSET_PATHS.content, "get"]] as const) {
      expect(paths[path][method].security, `${method} ${path}`).toEqual(gmOrPlayer);
    }
    // Folders, revisions, and export stay GM-only even for reads (organizational + backup surfaces).
    expect(paths[CODEX_PATHS.folders].get.security).toEqual(gmOnly);
    expect(paths[CODEX_PATHS.pageRevisions].get.security).toEqual(gmOnly);
    expect(paths[CODEX_PATHS.export].get.security).toEqual(gmOnly);
    // Every codex operation accepts a GM session and NONE carry integration-scope bearerAuth (they are session-authorized).
    for (const path of [...Object.values(CODEX_PATHS), ...Object.values(CODEX_ASSET_PATHS)]) {
      for (const [method, op] of Object.entries(paths[path])) {
        expect(op.security?.some((entry) => "gmAuth" in entry), `${method} ${path} must accept a GM session`).toBe(true);
        expect(op.security?.some((entry) => "bearerAuth" in entry), `${method} ${path} must not use integration scopes`).toBe(false);
      }
    }
  });

  it("scopes every live-game operation to the least-privilege credential scope alongside GM sessions", () => {
    type Operation = { security?: ReadonlyArray<Record<string, readonly string[]>> };
    const paths = openApiDocument.paths as unknown as Record<string, Record<string, Operation>>;
    const scopeOf = (path: string, method: string) => paths[path][method].security?.find((entry) => "bearerAuth" in entry)?.bearerAuth;
    expect(scopeOf(GAME_PATHS.snapshot, "get")).toEqual(["game:read"]);
    expect(scopeOf(GAME_PATHS.log, "get")).toEqual(["combat:read"]);
    expect(scopeOf(GAME_PATHS.commands, "get")).toEqual(["system:read"]);
    expect(scopeOf(GAME_PATHS.encounterStart, "post")).toEqual(["combat:write"]);
    expect(scopeOf(GAME_PATHS.initiativeNext, "post")).toEqual(["combat:write"]);
    expect(scopeOf(GAME_PATHS.tokenMove, "post")).toEqual(["combat:write"]);
    expect(scopeOf(GAME_PATHS.actorDamage, "post")).toEqual(["actor:write"]);
    expect(scopeOf(GAME_PATHS.definitionsImport, "post")).toEqual(["actor:write"]);
    expect(scopeOf(GAME_PATHS.rolls, "post")).toEqual(["roll:create"]);
    expect(scopeOf(GAME_PATHS.actionResolve, "post")).toEqual(["combat:write"]);
    expect(scopeOf(ENCOUNTER_ARCHIVE_PATHS.collection, "get")).toEqual(["combat:read"]);
    expect(scopeOf(ENCOUNTER_ARCHIVE_PATHS.byId, "delete")).toEqual(["admin"]);
    // Every game/content/archive operation also accepts a GM session; the tunnel's scope varies per command type.
    for (const path of [...Object.values(GAME_PATHS), ...Object.values(CONTENT_PATHS), ...Object.values(ENCOUNTER_ARCHIVE_PATHS)]) {
      for (const operation of Object.values(paths[path])) {
        expect(operation.security?.some((entry) => "gmAuth" in entry), `${path} must accept a GM session`).toBe(true);
      }
    }
    // playerAuth marks exactly the operations a player session can genuinely use - never GM-only or archive ones.
    const acceptsPlayer = (path: string, method: string) => paths[path][method].security?.some((entry) => "playerAuth" in entry) === true;
    expect(acceptsPlayer(GAME_PATHS.snapshot, "get")).toBe(true);
    expect(acceptsPlayer(GAME_PATHS.actorDamage, "post")).toBe(true);
    expect(acceptsPlayer(GAME_PATHS.rolls, "post")).toBe(true);
    expect(acceptsPlayer(CONTENT_PATHS.conditions, "get")).toBe(true);
    // A player submits their own sheet into the queue; only the GM decides on it.
    expect(acceptsPlayer(GAME_PATHS.characterImports, "post")).toBe(true);
    expect(acceptsPlayer(GAME_PATHS.characterImportResolve, "post")).toBe(false);
    expect(acceptsPlayer(GAME_PATHS.encounterStart, "post")).toBe(false);
    expect(acceptsPlayer(GAME_PATHS.actorHp, "post")).toBe(false);
    expect(acceptsPlayer(CONTENT_PATHS.monsters, "get")).toBe(false);
    // Every rules catalog except the bestiary is public reference: a player builds their own
    // character, so the builder catalogs must never inherit the bestiary's GM-only gating.
    for (const path of [CONTENT_PATHS.skills, CONTENT_PATHS.spells, CONTENT_PATHS.equipment, CONTENT_PATHS.classes, CONTENT_PATHS.subclasses, CONTENT_PATHS.species, CONTENT_PATHS.backgrounds, CONTENT_PATHS.feats, CONTENT_PATHS.names]) {
      expect(acceptsPlayer(path, "get"), `${path} must accept a player session`).toBe(true);
      expect(scopeOf(path, "get"), `${path} scope`).toEqual(["game:read"]);
    }
    expect(acceptsPlayer(ENCOUNTER_ARCHIVE_PATHS.collection, "get")).toBe(false);
    expect(openApiDocument.components.securitySchemes.playerAuth).toMatchObject({ type: "http", scheme: "bearer" });
  });

  it("keeps the game wire schemas honest: mutation envelope, snapshot views, and tunnel envelope", () => {
    const accepted = GameMutationAcceptedSchema.parse({ commandId: requestId, revision: 7, duplicate: false, rollId: requestId });
    expect(accepted.rollId).toBe(requestId);
    expect(() => GameMutationAcceptedSchema.parse({ commandId: requestId, revision: 7 })).toThrow();
    expect(GameSnapshotSchema.parse({ view: "player", revision: 3, game: { revision: 3 } }).view).toBe("player");
    expect(() => GameSnapshotSchema.parse({ view: "viewer", revision: 3, game: {} })).toThrow();
    expect(GameCommandEnvelopeSchema.parse({ type: "actor.apply-damage", payload: { actorId: requestId, amount: 5 } }).payload.amount).toBe(5);
    expect(GameCommandEnvelopeSchema.parse({ type: "turn.end" }).payload).toEqual({});
    expect(() => GameCommandEnvelopeSchema.parse({ type: "NotACommand!" })).toThrow();
  });

  it("never declares a secret-bearing property on any public component schema except the deliberate issuance responses", () => {
    const forbiddenNames = /secret|hash|password|token/i;
    // The two responses whose entire purpose is issuing a credential: the one-time integration
    // secret, and the player session token (the open LAN-trust join). Everything else stays clean.
    const issuance = new Set(["IntegrationCredentialIssued.token", "PlayerSessionIssuedData.token"]);
    for (const [name, schema] of Object.entries(openApiDocument.components.schemas)) {
      const properties = "properties" in schema ? Object.keys((schema as { properties: Record<string, unknown> }).properties) : [];
      for (const property of properties) {
        if (issuance.has(`${name}.${property}`)) continue;
        if (/^tokenAsset/.test(property)) continue; // battlemap tokens are game pieces, not credentials
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
