import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { IntegrationScopeSchema } from "@vtt/api-contract";
import type { JsonSchema, OpenApiResponse } from "@vtt/api-contract/openapi";
import { GameStateSchema } from "@vtt/domain";
import { apiRoutes, openApiDocument } from "../src/api-routes.js";
import { createServer } from "../src/server.js";
import { png } from "./image-fixtures.js";
import { mountedRoutes } from "./route-table.js";

/**
 * The route registry is the one list of HTTP operations: the routers mount from it and the OpenAPI document is built
 * from it alone. These tests hold the running server to it. Every route Express serves has an entry and every entry
 * is served, every documented example is valid, and real answers carry a documented status in the documented shape.
 */

const HERO_ID = "10000000-0000-4000-8000-000000000001";
const PASSWORD = "a sufficiently long GM password";

let server: ReturnType<typeof createServer>;
let base = "";
const tokens: Record<"gm" | "player" | "integration", string> = { gm: "", player: "", integration: "" };
let cleanup: () => Promise<void> = async () => {};

beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), "vtt-api-routes-"));
  server = createServer({
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integrations.sqlite"),
    mapAssetsPath: join(directory, "map-assets"),
    tokenAssetsPath: join(directory, "token-assets"),
    soundAssetsPath: join(directory, "sound-assets"),
    webDist: join(directory, "dist"),
    useDevelopmentClient: true,
    developmentClientPort: 5173,
    initialGameState: GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        {
          id: HERO_ID,
          name: "Public Hero",
          kind: "player-character",
          visibility: "public",
          hp: { current: 20, maximum: 20 }
        }
      ]
    })
  });
  await server.initialize();
  await server.auth.bootstrap(PASSWORD);
  tokens.gm = (await server.auth.login(PASSWORD))!;
  tokens.player = server.auth.issuePlayerSession();
  await new Promise<void>((done) => server.httpServer.listen(0, "127.0.0.1", done));
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind.");
  base = `http://127.0.0.1:${address.port}`;
  cleanup = async () => {
    server.close();
    await rm(directory, { recursive: true, force: true });
  };
});
afterAll(() => cleanup());

const ajv = new Ajv2020({ strict: false });
// The formats the document uses, checked as Zod checks them.
ajv.addFormat("uuid", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
ajv.addFormat("date-time", (value: string) => z.iso.datetime({ offset: true }).safeParse(value).success);
ajv.addFormat("uri", (value: string) => URL.canParse(value));
ajv.addFormat("binary", () => true);
ajv.addSchema(openApiDocument as unknown as Record<string, unknown>, "openapi");
const validators = new Map<string, ValidateFunction>();

/** A documented schema, compiled with its `#/components/...` references read from the document. */
function validatorFor(schema: JsonSchema) {
  const text = JSON.stringify(schema);
  let validate = validators.get(text);
  if (!validate) {
    validate = ajv.compile(JSON.parse(text.replaceAll('"#/components/', '"openapi#/components/')) as object);
    validators.set(text, validate);
  }
  return validate;
}

/** The documented answer for a status, with a shared response such as `ApiError` looked up. */
function documentedResponse(method: string, path: string, status: number): OpenApiResponse | undefined {
  const response = openApiDocument.paths[path]?.[method]?.responses[String(status)];
  const shared = response?.$ref?.replace("#/components/responses/", "");
  return shared ? openApiDocument.components.responses[shared] : response;
}

type Exchange = Readonly<{
  params?: Readonly<Record<string, string>>;
  query?: string;
  json?: unknown;
  bytes?: Uint8Array<ArrayBuffer>;
  type?: string;
  headers?: Readonly<Record<string, string>>;
}>;

/** One real request, its answer checked against the document. Every mismatch is kept for the test to report. */
async function exchange(
  problems: string[],
  token: string | null,
  method: string,
  path: string,
  options: Exchange = {}
) {
  const url =
    base +
    path.replace(/\{(\w+)\}/g, (_match, name: string) => {
      const value = options.params?.[name];
      if (value === undefined) throw new Error(`${path} needs {${name}}.`);
      return encodeURIComponent(value);
    }) +
    (options.query ?? "");
  const headers: Record<string, string> = { ...options.headers };
  if (token) headers.authorization = `Bearer ${token}`;
  let body: string | Uint8Array<ArrayBuffer> | undefined;
  if (options.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.json);
  } else if (options.bytes) {
    headers["content-type"] = options.type ?? "application/octet-stream";
    body = options.bytes;
  }
  const response = await fetch(url, { method: method.toUpperCase(), headers, body });
  const type = response.headers.get("content-type") ?? "";
  const text = await response.text();
  const answer: unknown = type.includes("application/json") && text !== "" ? JSON.parse(text) : text;
  const label = `${method.toUpperCase()} ${path} ${response.status}`;
  const documented = documentedResponse(method, path, response.status);
  if (!documented) problems.push(`${label} is undocumented: ${text.slice(0, 200)}`);
  else if (type.includes("application/json")) {
    const schema = documented.content?.["application/json"]?.schema;
    if (!schema) problems.push(`${label} answers JSON the document does not describe`);
    else {
      const validate = validatorFor(schema);
      if (!validate(answer)) problems.push(`${label}: ${ajv.errorsText(validate.errors)}`);
    }
  }
  return {
    status: response.status,
    headers: response.headers,
    data: (answer as { data?: Record<string, unknown> }).data
  };
}

describe("the route registry", () => {
  it("lists exactly the routes the server mounts", () => {
    const mounted = mountedRoutes(server).map(({ method, path }) => `${method} ${path.replace(/:(\w+)/g, "{$1}")}`);
    const declared = apiRoutes.map((route) => `${route.method.toUpperCase()} ${route.path}`);
    expect(mounted.length).toBeGreaterThan(300);
    expect(
      mounted.filter((route) => !declared.includes(route)),
      "mounted without a registry entry"
    ).toEqual([]);
    expect(
      declared.filter((route) => !mounted.includes(route)),
      "declared but never mounted"
    ).toEqual([]);
    expect(new Set(declared).size).toBe(declared.length);
  });

  it("documents examples that its own schemas accept", () => {
    const problems: string[] = [];
    let examples = 0;
    for (const [path, operations] of Object.entries(openApiDocument.paths))
      for (const [method, operation] of Object.entries(operations)) {
        const media = [
          ...Object.values(operation.requestBody?.content ?? {}).map((entry) => ["request", entry] as const),
          ...Object.entries(operation.responses).flatMap(([status, response]) =>
            Object.values(response.content ?? {}).map((entry) => [status, entry] as const)
          )
        ];
        for (const [where, entry] of media) {
          if (entry.example === undefined) continue;
          examples += 1;
          const validate = validatorFor(entry.schema);
          if (!validate(entry.example)) problems.push(`${method} ${path} ${where}: ${ajv.errorsText(validate.errors)}`);
        }
      }
    expect(problems).toEqual([]);
    expect(examples).toBeGreaterThan(10);
  });
});

describe("real answers against the document", () => {
  it("answers every read without path parameters as documented, for each kind of caller", async () => {
    const problems: string[] = [];
    const issued = await exchange(problems, tokens.gm, "post", "/api/v1/gm/integration-credentials", {
      json: { name: "Sampler", scopes: IntegrationScopeSchema.options }
    });
    expect(issued.status).toBe(201);
    tokens.integration = String(issued.data?.token);
    const reads = apiRoutes.filter(
      (route) =>
        route.method === "get" &&
        !route.path.includes("{") &&
        openApiDocument.paths[route.path]?.get?.responses["200"]?.content?.["application/json"] !== undefined
    );
    expect(reads.length).toBeGreaterThan(50);
    for (const route of reads)
      for (const token of [tokens.gm, tokens.player, tokens.integration, null])
        await exchange(problems, token, "get", route.path);
    expect(problems).toEqual([]);
  }, 60_000);

  it("answers writes, and the reads they make possible, as documented", async () => {
    const problems: string[] = [];
    const callers = [tokens.gm, tokens.player, tokens.integration];
    const seat = await exchange(problems, null, "post", "/api/v1/sessions/player");
    expect(seat.status).toBe(201);

    // The Codex: a page, its role-projected read, a refusal and a miss.
    const page = await exchange(problems, tokens.gm, "post", "/api/v1/codex/pages", {
      json: { title: "Vallaki", playerBody: "A walled town.", blocks: [{ text: "A key." }], revealedToPlayers: true }
    });
    expect(page.status).toBe(201);
    const pageId = String((page.data?.page as { id: string }).id);
    for (const token of callers)
      await exchange(problems, token, "get", "/api/v1/codex/pages/{id}", { params: { id: pageId } });
    await exchange(problems, tokens.gm, "get", "/api/v1/codex/pages/{id}/revisions", { params: { id: pageId } });
    await exchange(problems, tokens.gm, "get", "/api/v1/codex/pages/{id}", { params: { id: randomUUID() } });
    await exchange(problems, tokens.gm, "post", "/api/v1/codex/pages", { json: { title: 7 } });
    await exchange(problems, tokens.gm, "get", "/api/v1/codex/search", { query: "?q=vallaki&limit=5" });
    await exchange(problems, tokens.player, "get", "/api/v1/codex/home", { query: "?since=2026-10-17T19:30:00Z" });

    // Homebrew: a draft class and its reads.
    const record = await exchange(problems, tokens.gm, "post", "/api/v1/homebrew/content", {
      json: { record: { type: "class", name: "Blood Hunter", hitDie: "d10" } }
    });
    expect(record.status).toBe(201);
    const recordId = String((record.data?.record as { id: string }).id);
    await exchange(problems, tokens.gm, "get", "/api/v1/homebrew/content/{id}", { params: { id: recordId } });
    await exchange(problems, tokens.gm, "get", "/api/v1/homebrew/content/{id}/usages", { params: { id: recordId } });
    await exchange(problems, tokens.gm, "get", "/api/v1/homebrew/content", { query: "?type=class&limit=5" });

    // A battlemap, filed and read back by everyone who may.
    const map = await exchange(problems, tokens.gm, "post", "/api/v1/map-assets", {
      query: "?filename=keep.png&name=Keep&kind=battlemap",
      bytes: png(300, 200),
      type: "image/png"
    });
    expect(map.status).toBe(201);
    const mapId = String((map.data?.asset as { id: string }).id);
    await exchange(problems, tokens.gm, "get", "/api/v1/map-assets/{id}", { params: { id: mapId } });
    await exchange(problems, tokens.gm, "patch", "/api/v1/map-assets/{id}", {
      params: { id: mapId },
      json: { folder: "Dungeons" }
    });
    for (const token of callers)
      await exchange(problems, token, "get", "/api/v1/map-assets/{id}/grid", { params: { id: mapId } });

    // A token image.
    const token = await exchange(problems, tokens.gm, "post", "/api/v1/token-assets", {
      query: "?filename=token.png",
      bytes: png(64, 64),
      type: "image/png"
    });
    expect(token.status).toBe(201);

    // The live game: a roll, a command on an actor, and the reads about that actor.
    await exchange(problems, tokens.gm, "post", "/api/v1/game/rolls", {
      json: { formula: "1d20+5", purpose: "attack", visibility: "public" }
    });
    await exchange(problems, tokens.integration, "post", "/api/v1/game/actors/{actorId}/damage", {
      params: { actorId: HERO_ID },
      json: { amount: 3 }
    });
    await exchange(problems, tokens.player, "post", "/api/v1/game/actors/{actorId}/hp", {
      params: { actorId: HERO_ID },
      json: { current: 5 }
    });
    for (const caller of callers)
      await exchange(problems, caller, "get", "/api/v1/game/actors/{actorId}/available-actions", {
        params: { actorId: HERO_ID }
      });
    await exchange(problems, tokens.gm, "post", "/api/v1/game/commands", {
      json: { type: "actor.apply-healing", payload: { actorId: HERO_ID, amount: 2 } }
    });

    // The reads that now have something in them.
    for (const caller of callers)
      for (const path of ["/api/v1/game", "/api/v1/game/log", "/api/v1/codex/pages", "/api/v1/map-assets"])
        await exchange(problems, caller, "get", path);

    // A table screen pairs with a code the GM makes.
    const pairing = await exchange(problems, tokens.gm, "post", "/api/v1/viewer/pairings", { json: {} });
    expect(pairing.status).toBe(201);
    const paired = await exchange(problems, null, "post", "/api/v1/viewer/pairings/exchange", {
      json: { code: String((pairing.data?.pairing as { code: string }).code), name: "Living room TV" }
    });
    expect(paired.status).toBe(201);

    expect(problems).toEqual([]);
  }, 60_000);
});
