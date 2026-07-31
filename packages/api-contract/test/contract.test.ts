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
  GAME_COMMAND_SCOPES,
  HOMEBREW_PATHS,
  HomebrewContentTypeSchema,
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
    const capabilities = SystemCapabilitiesResponseSchema.parse({ ok: true, apiVersion: API_VERSION, data: { api: { version: API_VERSION, namespace: API_NAMESPACE }, realtime: { protocolVersion: REALTIME_PROTOCOL_VERSION, transport: "socket.io" }, supportedScopes: IntegrationScopeSchema.options, features: { webhooks: false, viewer: true, battlemapGridCalibration: true, gameApi: true, commandTunnel: true, encounterArchives: true, rulesEngine: true, codex: true } } });
    expect(capabilities.data.supportedScopes).toContain("system:read");
    // Discovery must advertise the codex, because a credential can now reach it: `features` is where a
    // consumer asks "is this surface here?" before it asks for a scope it might not be granted.
    expect(capabilities.data.features.codex).toBe(true);
    expect(capabilities.data.supportedScopes).toEqual(expect.arrayContaining(["codex:read", "codex:write"]));
    expect(() => SystemCapabilitiesResponseSchema.parse({ ok: true, apiVersion: API_VERSION, data: { api: { version: API_VERSION, namespace: API_NAMESPACE }, realtime: { protocolVersion: REALTIME_PROTOCOL_VERSION, transport: "socket.io" }, supportedScopes: [], features: { webhooks: false, viewer: true, battlemapGridCalibration: true, gameApi: true, commandTunnel: true, encounterArchives: true, rulesEngine: true } } })).toThrow();
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

    const declaredPaths = [...Object.values(SYSTEM_PATHS), OPENAPI_DOCUMENT_PATH, ...Object.values(INTEGRATION_CREDENTIAL_PATHS), ...Object.values(MAP_ASSET_PATHS), ...Object.values(VIEWER_PATHS), ...Object.values(GAME_PATHS), ...Object.values(CONTENT_PATHS), ...Object.values(ENCOUNTER_ARCHIVE_PATHS), ...Object.values(SESSION_PATHS), ...Object.values(CODEX_PATHS), ...Object.values(CODEX_ASSET_PATHS), ...Object.values(HOMEBREW_PATHS)];
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

  /**
   * This test used to pin the OPPOSITE of what it now pins: "every codex operation is session-authorized
   * and NONE carry integration-scope bearerAuth". That pin was a recorded decision (codex scopes were
   * ledgered as accepted debt), and it is consciously superseded - an external tool had to borrow the
   * GM's own session token to read the codex, which is the widest possible credential for the narrowest
   * possible need. The pin is rewritten rather than deleted, because the interesting claim survives:
   * exactly one codex operation still refuses a credential, and it is the one that mints a session.
   */
  it("documents the codex surface: GM-grade writes, role-projected reads, and codex:read/codex:write credentials beside the sessions", () => {
    type Op = { security?: ReadonlyArray<Record<string, readonly string[]>>; responses: Record<string, unknown> };
    const paths = openApiDocument.paths as unknown as Record<string, Record<string, Op>>;
    const write = [{ bearerAuth: ["codex:write"] }, { gmAuth: [] }];
    const roleRead = [{ bearerAuth: ["codex:read"] }, { gmAuth: [] }, { playerAuth: [] }];
    const gmRead = [{ bearerAuth: ["codex:read"] }, { gmAuth: [] }];
    for (const [path, method] of [[CODEX_PATHS.pages, "post"], [CODEX_PATHS.pageById, "patch"], [CODEX_PATHS.pageById, "delete"], [CODEX_PATHS.maps, "post"], [CODEX_PATHS.mapMarkers, "post"], [CODEX_PATHS.markerById, "patch"], [CODEX_PATHS.journal, "post"], [CODEX_PATHS.calendar, "put"], [CODEX_PATHS.settings, "put"], [CODEX_PATHS.pageRevisionsCollection, "delete"], [CODEX_ASSET_PATHS.collection, "post"]] as const) {
      expect(paths[path][method].security, `${method} ${path}`).toEqual(write);
    }
    // Role-projected reads: a player receives the revealed-only projection of the same route.
    for (const [path, method] of [[CODEX_PATHS.pages, "get"], [CODEX_PATHS.pageById, "get"], [CODEX_PATHS.search, "get"], [CODEX_PATHS.connections, "get"], [CODEX_PATHS.maps, "get"], [CODEX_PATHS.mapMarkers, "get"], [CODEX_PATHS.journal, "get"], [CODEX_PATHS.timeline, "get"], [CODEX_PATHS.sessionById, "get"], [CODEX_PATHS.questById, "get"], [CODEX_PATHS.standing, "get"], [CODEX_PATHS.calendar, "get"], [CODEX_ASSET_PATHS.content, "get"]] as const) {
      expect(paths[path][method].security, `${method} ${path}`).toEqual(roleRead);
    }
    // GM-GRADE reads: organizational, historical, and backup surfaces have no player branch at all.
    for (const path of [CODEX_PATHS.folders, CODEX_PATHS.pageRevisions, CODEX_PATHS.revealAudit, CODEX_PATHS.settings, CODEX_PATHS.export]) {
      expect(paths[path].get.security, `get ${path}`).toEqual(gmRead);
    }
    // The ONE bearer-less codex operation: it mints a real player SESSION TOKEN, and a scoped credential
    // minting ambient player sessions would widen the token surface for no consumer need.
    expect(paths[CODEX_PATHS.previewSession].post.security).toEqual([{ gmAuth: [] }]);
    for (const path of [...Object.values(CODEX_PATHS), ...Object.values(CODEX_ASSET_PATHS)]) {
      for (const [method, op] of Object.entries(paths[path])) {
        expect(op.security?.some((entry) => "gmAuth" in entry), `${method} ${path} must accept a GM session`).toBe(true);
        const scopes = op.security?.find((entry) => "bearerAuth" in entry)?.bearerAuth;
        if (path === CODEX_PATHS.previewSession) { expect(scopes, "preview-session must stay GM-session-only").toBeUndefined(); continue; }
        expect(scopes, `${method} ${path} must name exactly one codex scope`).toEqual([method === "get" ? "codex:read" : "codex:write"]);
      }
    }
  });

  it("documents 401 AND 403 on every codex operation, and 304 on every codex GET", () => {
    type Op = { responses: Record<string, unknown> };
    const paths = openApiDocument.paths as unknown as Record<string, Record<string, Op>>;
    // The ASSET paths are walked too. They were outside this loop, which is how the upload route came to
    // document 400 and 401 but not the 403 `requireWrite` genuinely answers - the exact drift this test
    // exists to catch, sitting in the one pair of paths it did not look at.
    for (const path of [...Object.values(CODEX_PATHS), ...Object.values(CODEX_ASSET_PATHS)]) {
      for (const [method, op] of Object.entries(paths[path])) {
        // The binary asset-CONTENT route is the stated exception, pinned exactly below rather than waved
        // through: it answers 403 before any existence check, so it has no 401 arm to document.
        if (path === CODEX_ASSET_PATHS.content) continue;
        // 401 is "no credential"; 403 is "you presented one and were refused". Every codex route now
        // accepts a bearer token, so every route can answer both - documenting only 401 was the bug.
        expect(Object.keys(op.responses), `${method} ${path} must document 401`).toContain("401");
        expect(Object.keys(op.responses), `${method} ${path} must document 403`).toContain("403");
        // ...and only the JSON reads answer 304. The asset upload is a POST and the asset content route is
        // handled below, so this stays a statement about the codex GETs.
        if (method === "get") expect(Object.keys(op.responses), `${method} ${path} must document 304`).toContain("304");
      }
    }
    const content = paths[CODEX_ASSET_PATHS.content].get;
    expect(Object.keys(content.responses)).toEqual(["200", "304", "403", "404"]);
    // A route that mounts a body parser above the server's global limit must document the 413 that parser
    // raises - the caller cannot otherwise tell "your image is too big" from "we broke".
    expect(Object.keys(paths[CODEX_ASSET_PATHS.collection].post.responses)).toContain("413");
    expect(Object.keys(paths[CODEX_PATHS.import].post.responses)).toContain("413");

    /**
     * Every journal CREATOR documents 404. All four accept `sessionId` (the deadline/downtime/milestone
     * bodies extend the journal one), which flows to `requireSession` and throws `CodexNotFoundError`;
     * downtime additionally 404s on a `characterPageId` naming no page. None of the four declared it, so
     * the same document contradicted itself - the `sessionId` and `characterPageId` field descriptions
     * inside these very request components both state the status is 404. A spec-generated client would
     * throw on the undeclared status, or a retry layer would keep retrying a write that cannot succeed.
     */
    for (const path of [CODEX_PATHS.journal, CODEX_PATHS.journalDeadline, CODEX_PATHS.journalDowntime, CODEX_PATHS.journalMilestone]) {
      expect(Object.keys(paths[path].post.responses), `post ${path} must document 404`).toContain("404");
    }
  });

  /**
   * D19: the codex surface DOES implement `commandId` now, so this walks the inverse of what it used to.
   *
   * Every codex JSON body a POST/PATCH/PUT accepts must declare an optional `commandId` - a body that
   * forgot it would 400 a caller following the published convention, and `additionalProperties: false`
   * means the failure is loud rather than a silently ignored key.
   *
   * The exemptions are the verbs that are naturally idempotent already: every DELETE (deleting a deleted
   * record succeeds) and the binary asset upload (not a JSON body at all). Body-less POSTs have no
   * component to declare it on, so they never reach this walk.
   */
  it("gives every codex JSON-body write an optional `commandId`, exempting DELETEs and the binary upload", () => {
    type Op = { requestBody?: { content: Record<string, { schema?: { $ref?: string } }> } };
    const paths = openApiDocument.paths as unknown as Record<string, Record<string, Op>>;
    const schemas = openApiDocument.components.schemas as unknown as Record<string, { properties?: Record<string, unknown>; required?: readonly string[] }>;
    let walked = 0;
    for (const path of [...Object.values(CODEX_PATHS), ...Object.values(CODEX_ASSET_PATHS)]) {
      for (const [method, op] of Object.entries(paths[path])) {
        const ref = op.requestBody?.content?.["application/json"]?.schema?.$ref;
        if (!ref) continue;
        const component = ref.replace("#/components/schemas/", "");
        const keys = Object.keys(schemas[component].properties ?? {});
        if (method === "delete") {
          expect(keys, `${method} ${path} body ${component} is naturally idempotent`).not.toContain("commandId");
          continue;
        }
        expect(keys, `${method} ${path} body ${component}`).toContain("commandId");
        // OPTIONAL, always: a caller that does not care about retries must not have to mint a uuid.
        expect(schemas[component].required ?? [], `${method} ${path} body ${component}`).not.toContain("commandId");
        walked += 1;
      }
    }
    // Non-vacuity: the walk really covered the surface rather than finding no JSON bodies at all.
    expect(walked).toBeGreaterThan(15);
  });


  /**
   * What makes the role `oneOf` sound, asserted mechanically so a future field cannot quietly make both
   * branches match a body (which is a `oneOf` VALIDATION FAILURE, not a widening - the document would
   * simply stop describing its own responses).
   *
   * The rule is ONE-SIDED on purpose: the GM branch must require at least one key the player branch does
   * not declare. Several player shapes are strict key-subsets of their GM twin, so the symmetric version
   * of this rule ("each branch has a key the other lacks") is unsatisfiable for them - and an
   * unsatisfiable assertion is an assertion that gets deleted.
   */
  it("keeps every role-projected `*Projected` pair disjoint: closed shapes, all-required keys, and a GM-only key", () => {
    type Schema = { oneOf?: Array<{ $ref?: string }>; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: unknown };
    const schemas = openApiDocument.components.schemas as unknown as Record<string, Schema>;
    const wrappers = Object.keys(schemas).filter((name) => name.startsWith("Codex") && name.endsWith("Projected"));
    // Ten role-projected record kinds today. Pinned so deleting a wrapper cannot silently empty this test.
    // D8 added `CodexConnectionProjected` and `CodexPageConnectionProjected` to the ten Lane A published.
    expect(wrappers).toHaveLength(12);
    for (const wrapper of wrappers) {
      const branches = schemas[wrapper].oneOf ?? [];
      expect(branches.map((branch) => branch.$ref), wrapper).toEqual([
        `#/components/schemas/${wrapper.replace(/Projected$/, "")}`,
        `#/components/schemas/${wrapper.replace(/Projected$/, "")}Player`
      ]);
      const [gm, player] = branches.map((branch) => schemas[(branch.$ref as string).replace("#/components/schemas/", "")]);
      for (const [label, branch] of [["GM", gm], ["player", player]] as const) {
        expect(branch.additionalProperties, `${wrapper} ${label} branch must be closed`).toBe(false);
        expect([...(branch.required ?? [])].sort(), `${wrapper} ${label} branch must require every key it declares`).toEqual(Object.keys(branch.properties ?? {}).sort());
      }
      const gmOnly = (gm.required ?? []).filter((key) => !(key in (player.properties ?? {})));
      expect(gmOnly.length, `${wrapper}: the GM branch needs a required key the player branch does not declare (else a GM body matches both)`).toBeGreaterThan(0);
    }
  });

  it("documents the homebrew surface as structurally GM-only: never a player session, never an integration scope, never a game command", () => {
    type Op = { operationId?: string; security?: ReadonlyArray<Record<string, readonly string[]>>; parameters?: ReadonlyArray<{ name: string; in: string; schema?: Record<string, unknown> }> };
    const paths = openApiDocument.paths as unknown as Record<string, Record<string, Op>>;
    const homebrewPaths = Object.values(HOMEBREW_PATHS);
    const operations = homebrewPaths.flatMap((path) => Object.entries(paths[path]).map(([method, op]) => [`${method} ${path}`, op] as const));
    // 10 paths, 13 operations - the whole authoring surface, not one endpoint per content type.
    expect(homebrewPaths).toHaveLength(10);
    expect(operations).toHaveLength(13);
    for (const [label, op] of operations) {
      // Unlike the codex (GM-only writes, GM-or-player reads) there is no player read here AT ALL:
      // players reach homebrew only through the merged catalogs, after the audience filter.
      expect(op.security, `${label} must be GM-session-only`).toEqual([{ gmAuth: [] }]);
      expect(op.security?.some((entry) => "playerAuth" in entry), `${label} must never accept a player session`).toBe(false);
      expect(op.security?.some((entry) => "bearerAuth" in entry), `${label} must not use integration scopes`).toBe(false);
    }
    // No IntegrationScope was added, so `supportedScopes` stays aligned with IntegrationScopeSchema automatically.
    expect(IntegrationScopeSchema.options).not.toContain("content:read");
    // Path B held: homebrew rows are not GameState, so nothing here is a game command.
    expect(Object.keys(GAME_COMMAND_SCOPES).filter((type) => type.startsWith("homebrew."))).toEqual([]);
    // The id budget is 60, NOT contentSlug's 80: a longer id passes creation and then fails
    // GameStateSchema.parse on the next boot, bricking campaign load.
    for (const path of homebrewPaths.filter((path) => path.includes("{id}"))) {
      const parameter = Object.values(paths[path])[0]?.parameters?.find((parameter) => parameter.name === "id" && parameter.in === "path");
      expect(parameter?.schema, `${path} id parameter`).toEqual({ type: "string", pattern: "^[a-z0-9-]+$", maxLength: 60 });
    }
    // One polymorphic collection serves all nine content types via the `type` discriminator.
    expect(HomebrewContentTypeSchema.options).toHaveLength(9);
    expect(openApiDocument.components.schemas.HomebrewRecordSummary.properties.type.enum).toEqual(HomebrewContentTypeSchema.options);
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
    const issuance = new Set(["IntegrationCredentialIssued.token", "PlayerSessionIssuedData.token", "CodexPreviewSessionData.token"]);
    for (const [name, schema] of Object.entries(openApiDocument.components.schemas)) {
      const properties = "properties" in schema ? Object.keys((schema as { properties: Record<string, unknown> }).properties) : [];
      for (const property of properties) {
        if (issuance.has(`${name}.${property}`)) continue;
        if (/^tokenAsset/.test(property)) continue; // battlemap tokens are game pieces, not credentials
        // Same reason, spelled out rather than pattern-matched: an ActorDefinition's `token` is its
        // battlemap piece (disposition + grid footprint). The name is fixed by ActorDefinitionSchema,
        // which a homebrew creature body mirrors, so renaming it here would be a documented lie.
        if (`${name}.${property}` === "HomebrewMonsterRecord.token") continue;
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
