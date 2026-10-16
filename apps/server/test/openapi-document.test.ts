import { describe, expect, it } from "vitest";
import {
  API_NAMESPACE,
  API_VERSION,
  CODEX_ASSET_PATHS,
  CODEX_PATHS,
  CONTENT_PATHS,
  ENCOUNTER_ARCHIVE_PATHS,
  GAME_PATHS,
  GameCommandEnvelopeSchema,
  GameMutationAcceptedSchema,
  GameSnapshotSchema,
  GAME_COMMANDS,
  HOMEBREW_PATHS,
  HOST_PATHS,
  INTEGRATION_CREDENTIAL_PATHS,
  IntegrationScopeSchema,
  MAP_ASSET_PATHS,
  OPENAPI_DOCUMENT_PATH,
  SESSION_PATHS,
  SYSTEM_PATHS,
  VIEWER_PATHS
} from "@vtt/api-contract";
import { openApiDocument } from "../src/openapi/document.js";

const requestId = "f84d13cb-a7da-4ef2-9f2f-53d38e49d862";

describe("the OpenAPI document", () => {
  it("keeps OpenAPI system, document, and credential paths, versions, scopes, and component references aligned", () => {
    expect(openApiDocument.openapi).toBe("3.1.0");
    expect(openApiDocument.info.version).toBe(API_VERSION);
    expect(openApiDocument.servers[0].url).toBe(API_NAMESPACE);

    const declaredPaths = [
      ...Object.values(SYSTEM_PATHS),
      OPENAPI_DOCUMENT_PATH,
      ...Object.values(INTEGRATION_CREDENTIAL_PATHS),
      ...Object.values(MAP_ASSET_PATHS),
      ...Object.values(VIEWER_PATHS),
      ...Object.values(GAME_PATHS),
      ...Object.values(CONTENT_PATHS),
      ...Object.values(ENCOUNTER_ARCHIVE_PATHS),
      ...Object.values(SESSION_PATHS),
      ...Object.values(CODEX_PATHS),
      ...Object.values(CODEX_ASSET_PATHS),
      ...Object.values(HOMEBREW_PATHS),
      ...Object.values(HOST_PATHS)
    ];
    expect(Object.keys(openApiDocument.paths).sort()).toEqual([...new Set(declaredPaths)].sort());
    for (const path of Object.values(SYSTEM_PATHS))
      expect(openApiDocument.paths[path].get.responses["200"].content["application/json"].schema.$ref).toMatch(
        /^#\/components\/schemas\//
      );
  });

  it("requires GM bearer auth (not integration-token auth) on every credential-management operation", () => {
    const collection = openApiDocument.paths[INTEGRATION_CREDENTIAL_PATHS.collection];
    expect(collection.post.security).toEqual([{ gmAuth: [] }]);
    expect(collection.get.security).toEqual([{ gmAuth: [] }]);
    expect(openApiDocument.paths[INTEGRATION_CREDENTIAL_PATHS.rotate].post.security).toEqual([{ gmAuth: [] }]);
    expect(openApiDocument.paths[INTEGRATION_CREDENTIAL_PATHS.revoke].post.security).toEqual([{ gmAuth: [] }]);
    expect(openApiDocument.paths[INTEGRATION_CREDENTIAL_PATHS.audit].get.security).toEqual([{ gmAuth: [] }]);
    expect(openApiDocument.components.securitySchemes.gmAuth).toEqual({
      type: "http",
      scheme: "bearer",
      bearerFormat: "VTT GM session token"
    });
  });

  it("documents the already-shipped map-asset and viewer routers with correctly scoped security", () => {
    expect(openApiDocument.paths[MAP_ASSET_PATHS.collection].post.security).toEqual([{ gmAuth: [] }]);
    expect(openApiDocument.paths[MAP_ASSET_PATHS.byId].get.security).toEqual([{ gmAuth: [] }]);
    // Content is the one map-asset read open to a GM, an authorized player or a paired viewer session.
    expect(openApiDocument.paths[MAP_ASSET_PATHS.content].get.security).toEqual([
      { gmAuth: [] },
      { viewerCookieAuth: [] }
    ]);
    expect(openApiDocument.paths[MAP_ASSET_PATHS.calibrationWizards].post.security).toEqual([{ gmAuth: [] }]);
    expect(openApiDocument.paths[VIEWER_PATHS.pairings].post.security).toEqual([{ gmAuth: [] }]);
    // Exchanging a pairing code is the credential itself; no separate auth is required to call it.
    expect(openApiDocument.paths[VIEWER_PATHS.pairingsExchange].post.security).toEqual([]);
    expect(openApiDocument.paths[VIEWER_PATHS.presentationCommands].post.security).toEqual([{ gmAuth: [] }]);
    expect(openApiDocument.components.securitySchemes.viewerCookieAuth).toMatchObject({
      type: "apiKey",
      in: "cookie",
      name: "vtt_viewer_session"
    });
  });

  it("answers every viewer JSON route in the standard data envelope", () => {
    type Op = { responses: Record<string, { content?: Record<string, { schema: { $ref: string } }> }> };
    const paths = openApiDocument.paths as unknown as Record<string, Record<string, Op>>;
    const schemas = openApiDocument.components.schemas as unknown as Record<string, { required?: string[] }>;
    const jsonPaths = Object.values(VIEWER_PATHS).filter((path) => path !== VIEWER_PATHS.events);
    for (const path of jsonPaths) {
      for (const [method, operation] of Object.entries(paths[path] ?? {})) {
        const success = Object.entries(operation.responses).filter(([status]) => status.startsWith("2"));
        expect(success.length, `${method} ${path}`).toBeGreaterThan(0);
        for (const [status, response] of success) {
          const ref = response.content?.["application/json"]?.schema.$ref ?? "";
          expect(schemas[ref.split("/").pop() ?? ""]?.required, `${method} ${path} ${status}`).toEqual([
            "ok",
            "apiVersion",
            "data"
          ]);
        }
      }
    }
  });

  /** Codex operations accept scoped credentials, except the one that mints a player session. */
  it("documents the codex surface: GM-grade writes, role-projected reads, and codex:read/codex:write credentials beside the sessions", () => {
    type Op = { security?: ReadonlyArray<Record<string, readonly string[]>>; responses: Record<string, unknown> };
    const paths = openApiDocument.paths as unknown as Record<string, Record<string, Op>>;
    const write = [{ bearerAuth: ["codex:write"] }, { gmAuth: [] }];
    const roleRead = [{ bearerAuth: ["codex:read"] }, { gmAuth: [] }, { playerAuth: [] }];
    const gmRead = [{ bearerAuth: ["codex:read"] }, { gmAuth: [] }];
    for (const [path, method] of [
      [CODEX_PATHS.pages, "post"],
      [CODEX_PATHS.pageById, "patch"],
      [CODEX_PATHS.pageById, "delete"],
      [CODEX_PATHS.maps, "post"],
      [CODEX_PATHS.mapMarkers, "post"],
      [CODEX_PATHS.markerById, "patch"],
      [CODEX_PATHS.journal, "post"],
      [CODEX_PATHS.calendar, "put"],
      [CODEX_PATHS.settings, "put"],
      [CODEX_PATHS.pageRevisionsCollection, "delete"],
      [CODEX_ASSET_PATHS.collection, "post"]
    ] as const) {
      expect(paths[path][method].security, `${method} ${path}`).toEqual(write);
    }
    // Role-projected reads: a player receives the revealed-only projection of the same route.
    for (const [path, method] of [
      [CODEX_PATHS.pages, "get"],
      [CODEX_PATHS.pageById, "get"],
      [CODEX_PATHS.search, "get"],
      [CODEX_PATHS.connections, "get"],
      [CODEX_PATHS.maps, "get"],
      [CODEX_PATHS.mapMarkers, "get"],
      [CODEX_PATHS.journal, "get"],
      [CODEX_PATHS.timeline, "get"],
      [CODEX_PATHS.sessionById, "get"],
      [CODEX_PATHS.questById, "get"],
      [CODEX_PATHS.standing, "get"],
      [CODEX_PATHS.calendar, "get"],
      [CODEX_ASSET_PATHS.content, "get"]
    ] as const) {
      expect(paths[path][method].security, `${method} ${path}`).toEqual(roleRead);
    }
    // GM-grade reads: organizational, historical and backup surfaces have no player branch.
    for (const path of [
      CODEX_PATHS.folders,
      CODEX_PATHS.pageRevisions,
      CODEX_PATHS.revealAudit,
      CODEX_PATHS.settings,
      CODEX_PATHS.export
    ]) {
      expect(paths[path].get.security, `get ${path}`).toEqual(gmRead);
    }
    // The one bearer-less codex operation: it mints a player session token.
    expect(paths[CODEX_PATHS.previewSession].post.security).toEqual([{ gmAuth: [] }]);
    // A POST that only reads: it carries a draft calendar in its body and changes nothing.
    expect(paths[CODEX_PATHS.calendarCheck].post.security).toEqual(gmRead);
    for (const path of [...Object.values(CODEX_PATHS), ...Object.values(CODEX_ASSET_PATHS)]) {
      for (const [method, op] of Object.entries(paths[path])) {
        expect(
          op.security?.some((entry) => "gmAuth" in entry),
          `${method} ${path} must accept a GM session`
        ).toBe(true);
        const scopes = op.security?.find((entry) => "bearerAuth" in entry)?.bearerAuth;
        if (path === CODEX_PATHS.previewSession) {
          expect(scopes, "preview-session must stay GM-session-only").toBeUndefined();
          continue;
        }
        const reads = method === "get" || path === CODEX_PATHS.calendarCheck;
        expect(scopes, `${method} ${path} must name exactly one codex scope`).toEqual([
          reads ? "codex:read" : "codex:write"
        ]);
      }
    }
  });

  it("documents 401 AND 403 on every codex operation, and 304 on every codex GET", () => {
    type Op = { responses: Record<string, unknown> };
    const paths = openApiDocument.paths as unknown as Record<string, Record<string, Op>>;
    // Asset paths are walked too, so the upload route's 403 stays documented.
    for (const path of [...Object.values(CODEX_PATHS), ...Object.values(CODEX_ASSET_PATHS)]) {
      for (const [method, op] of Object.entries(paths[path])) {
        // The binary asset-content route answers 403 before any existence check, so it has no 401; pinned below.
        if (path === CODEX_ASSET_PATHS.content) continue;
        // 401 is "no credential"; 403 is "presented one and was refused". Every route accepts a bearer token.
        expect(Object.keys(op.responses), `${method} ${path} must document 401`).toContain("401");
        expect(Object.keys(op.responses), `${method} ${path} must document 403`).toContain("403");
        // Only the JSON reads answer 304.
        if (method === "get") expect(Object.keys(op.responses), `${method} ${path} must document 304`).toContain("304");
      }
    }
    const content = paths[CODEX_ASSET_PATHS.content].get;
    expect(Object.keys(content.responses)).toEqual(["200", "304", "403", "404"]);
    // A route whose body parser exceeds the global limit must document the 413 it raises.
    expect(Object.keys(paths[CODEX_ASSET_PATHS.collection].post.responses)).toContain("413");
    expect(Object.keys(paths[CODEX_PATHS.import].post.responses)).toContain("413");

    /** Every journal creator documents 404: each accepts `sessionId` (and downtime a `characterPageId`) that may
     * name nothing. */
    for (const path of [
      CODEX_PATHS.journal,
      CODEX_PATHS.journalDeadline,
      CODEX_PATHS.journalDowntime,
      CODEX_PATHS.journalMilestone
    ]) {
      expect(Object.keys(paths[path].post.responses), `post ${path} must document 404`).toContain("404");
    }
  });

  /** Every codex JSON body for POST/PATCH/PUT declares an optional `commandId`. DELETEs and the binary upload are
   * exempt; body-less POSTs have no component to check. */
  it("gives every codex JSON-body write an optional `commandId`, exempting DELETEs and the binary upload", () => {
    type Op = { requestBody?: { content: Record<string, { schema?: { $ref?: string } }> } };
    const paths = openApiDocument.paths as unknown as Record<string, Record<string, Op>>;
    const schemas = openApiDocument.components.schemas as unknown as Record<
      string,
      { properties?: Record<string, unknown>; required?: readonly string[] }
    >;
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
        // Always optional: a caller that doesn't care about retries must not have to mint a uuid.
        expect(schemas[component].required ?? [], `${method} ${path} body ${component}`).not.toContain("commandId");
        walked += 1;
      }
    }
    // The walk must actually cover the surface.
    expect(walked).toBeGreaterThan(15);
  });

  /** The role `oneOf` must stay sound: two matching branches is a validation failure. One-sided rule: the GM branch
   * requires a key the player branch does not declare (several player shapes are key-subsets of their GM twin). */
  it("keeps every role-projected `*Projected` pair disjoint: closed shapes, all-required keys, and a GM-only key", () => {
    type Schema = {
      oneOf?: Array<{ $ref?: string }>;
      properties?: Record<string, unknown>;
      required?: string[];
      additionalProperties?: unknown;
    };
    const schemas = openApiDocument.components.schemas as unknown as Record<string, Schema>;
    const wrappers = Object.keys(schemas).filter((name) => name.startsWith("Codex") && name.endsWith("Projected"));
    // Pinned so deleting a wrapper cannot silently empty this test.
    expect(wrappers).toHaveLength(12);
    for (const wrapper of wrappers) {
      const branches = schemas[wrapper].oneOf ?? [];
      expect(
        branches.map((branch) => branch.$ref),
        wrapper
      ).toEqual([
        `#/components/schemas/${wrapper.replace(/Projected$/, "")}`,
        `#/components/schemas/${wrapper.replace(/Projected$/, "")}Player`
      ]);
      const [gm, player] = branches.map(
        (branch) => schemas[(branch.$ref as string).replace("#/components/schemas/", "")]
      );
      for (const [label, branch] of [
        ["GM", gm],
        ["player", player]
      ] as const) {
        expect(branch.additionalProperties, `${wrapper} ${label} branch must be closed`).toBe(false);
        expect(
          [...(branch.required ?? [])].sort(),
          `${wrapper} ${label} branch must require every key it declares`
        ).toEqual(Object.keys(branch.properties ?? {}).sort());
      }
      const gmOnly = (gm.required ?? []).filter((key) => !(key in (player.properties ?? {})));
      expect(
        gmOnly.length,
        `${wrapper}: the GM branch needs a required key the player branch does not declare (else a GM body matches both)`
      ).toBeGreaterThan(0);
    }
  });

  it("documents the homebrew surface as structurally GM-only: never a player session, never an integration scope, never a game command", () => {
    type Op = {
      operationId?: string;
      security?: ReadonlyArray<Record<string, readonly string[]>>;
      parameters?: ReadonlyArray<{ name: string; in: string; schema?: Record<string, unknown> }>;
    };
    const paths = openApiDocument.paths as unknown as Record<string, Record<string, Op>>;
    const homebrewPaths = Object.values(HOMEBREW_PATHS);
    const operations = homebrewPaths.flatMap((path) =>
      Object.entries(paths[path]).map(([method, op]) => [`${method} ${path}`, op] as const)
    );
    // 11 paths, 14 operations: one polymorphic surface, not one endpoint per content type.
    expect(homebrewPaths).toHaveLength(11);
    expect(operations).toHaveLength(14);
    for (const [label, op] of operations) {
      // No player read at all: players reach homebrew only through the merged catalogs, after the audience filter.
      expect(op.security, `${label} must be GM-session-only`).toEqual([{ gmAuth: [] }]);
      expect(
        op.security?.some((entry) => "playerAuth" in entry),
        `${label} must never accept a player session`
      ).toBe(false);
      expect(
        op.security?.some((entry) => "bearerAuth" in entry),
        `${label} must not use integration scopes`
      ).toBe(false);
    }
    // No IntegrationScope was added for homebrew.
    expect(IntegrationScopeSchema.options).not.toContain("content:read");
    // Homebrew rows are not GameState, so none of them is a game command.
    expect(Object.keys(GAME_COMMANDS).filter((type) => type.startsWith("homebrew."))).toEqual([]);
    // The id budget is 60, not contentSlug's 80 (persisted ActorDefinition ids cap at 60).
    for (const path of homebrewPaths.filter((path) => path.includes("{id}"))) {
      const parameter = Object.values(paths[path])[0]?.parameters?.find(
        (parameter) => parameter.name === "id" && parameter.in === "path"
      );
      expect(parameter?.schema, `${path} id parameter`).toEqual({
        type: "string",
        pattern: "^[a-z0-9-]+$",
        maxLength: 60
      });
    }
  });

  it("scopes every live-game operation to the least-privilege credential scope alongside GM sessions", () => {
    type Operation = { security?: ReadonlyArray<Record<string, readonly string[]>> };
    const paths = openApiDocument.paths as unknown as Record<string, Record<string, Operation>>;
    const scopeOf = (path: string, method: string) =>
      paths[path][method].security?.find((entry) => "bearerAuth" in entry)?.bearerAuth;
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
    // Every game/content/archive operation also accepts a GM session.
    for (const path of [
      ...Object.values(GAME_PATHS),
      ...Object.values(CONTENT_PATHS),
      ...Object.values(ENCOUNTER_ARCHIVE_PATHS)
    ]) {
      for (const operation of Object.values(paths[path])) {
        expect(
          operation.security?.some((entry) => "gmAuth" in entry),
          `${path} must accept a GM session`
        ).toBe(true);
      }
    }
    // playerAuth marks exactly the operations a player session can use.
    const acceptsPlayer = (path: string, method: string) =>
      paths[path][method].security?.some((entry) => "playerAuth" in entry) === true;
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
    // Every rules catalog except the bestiary is public reference for players building characters.
    for (const path of [
      CONTENT_PATHS.skills,
      CONTENT_PATHS.spells,
      CONTENT_PATHS.equipment,
      CONTENT_PATHS.classes,
      CONTENT_PATHS.subclasses,
      CONTENT_PATHS.species,
      CONTENT_PATHS.backgrounds,
      CONTENT_PATHS.feats,
      CONTENT_PATHS.names
    ]) {
      expect(acceptsPlayer(path, "get"), `${path} must accept a player session`).toBe(true);
      expect(scopeOf(path, "get"), `${path} scope`).toEqual(["game:read"]);
    }
    expect(acceptsPlayer(ENCOUNTER_ARCHIVE_PATHS.collection, "get")).toBe(false);
    expect(openApiDocument.components.securitySchemes.playerAuth).toMatchObject({ type: "http", scheme: "bearer" });
  });

  it("keeps the game wire schemas honest: mutation envelope, snapshot views, and tunnel envelope", () => {
    const accepted = GameMutationAcceptedSchema.parse({
      commandId: requestId,
      revision: 7,
      duplicate: false,
      rollId: requestId
    });
    expect(accepted.rollId).toBe(requestId);
    expect(() => GameMutationAcceptedSchema.parse({ commandId: requestId, revision: 7 })).toThrow();
    expect(GameSnapshotSchema.parse({ view: "player", revision: 3, game: { revision: 3 } }).view).toBe("player");
    expect(() => GameSnapshotSchema.parse({ view: "viewer", revision: 3, game: {} })).toThrow();
    expect(
      GameCommandEnvelopeSchema.parse({ type: "actor.apply-damage", payload: { actorId: requestId, amount: 5 } })
        .payload.amount
    ).toBe(5);
    expect(GameCommandEnvelopeSchema.parse({ type: "turn.end" }).payload).toEqual({});
    expect(() => GameCommandEnvelopeSchema.parse({ type: "NotACommand!" })).toThrow();
  });

  it("never declares a secret-bearing property on any public component schema except the deliberate issuance responses", () => {
    const forbiddenNames = /secret|hash|password|token/i;
    // The responses whose purpose is issuing a credential.
    const issuance = new Set([
      "IntegrationCredentialIssued.token",
      "PlayerSessionIssued.token",
      "CodexPreviewSessionData.token",
      // The host's own sign-in: the GM password goes in and a GM session token comes out.
      "HostPasswordRequest.password",
      "GmSignIn.token"
    ]);
    for (const [name, schema] of Object.entries(openApiDocument.components.schemas)) {
      const properties =
        "properties" in schema ? Object.keys((schema as { properties: Record<string, unknown> }).properties) : [];
      for (const property of properties) {
        if (issuance.has(`${name}.${property}`)) continue;
        if (/^tokenAsset/.test(property)) continue; // battlemap tokens are game pieces, not credentials
        // An ActorDefinition's `token` is its battlemap piece, a name fixed by ActorDefinitionSchema.
        if (`${name}.${property}` === "HomebrewMonsterRecord.token") continue;
        expect(property, `${name}.${property} looks secret-shaped`).not.toMatch(forbiddenNames);
      }
    }
  });

  it("never lets an integration credential reach the host's GM account routes", () => {
    for (const path of Object.values(HOST_PATHS))
      for (const operation of Object.values(
        openApiDocument.paths[path] as unknown as Record<string, { security: readonly unknown[] }>
      ))
        expect(JSON.stringify(operation.security)).not.toContain("bearerAuth");
  });

  it("serves the OpenAPI document from a dedicated, unauthenticated, stable path distinct from any one system operation", () => {
    expect(OPENAPI_DOCUMENT_PATH).toBe(`${API_NAMESPACE}/openapi.json`);
    expect(Object.values(SYSTEM_PATHS)).not.toContain(OPENAPI_DOCUMENT_PATH);
    expect(openApiDocument.paths[OPENAPI_DOCUMENT_PATH].get.security).toEqual([]);
  });
});
