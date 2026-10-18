import { z } from "zod";
import { API_VERSION, ApiErrorEnvelopeSchema, successEnvelopeSchema, VIEWER_SESSION_COOKIE } from "../index.js";
import { documentedAs, namedSchemas } from "../routes/components.js";
import type { Access, ApiResponse, ApiRoute } from "../routes/define.js";
import { API_TAGS } from "../routes/tags.js";

/**
 * Builds the OpenAPI 3.1 document from route declarations alone. Every schema in it is generated from Zod with
 * `z.toJSONSchema`, and every name in `components.schemas` comes from `named` (`../routes/components.ts`), a
 * success envelope's data, or a route's operation id.
 */

export type JsonSchema = {
  [keyword: string]: unknown;
  $ref?: string;
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
};
export type OpenApiParameter = {
  name: string;
  in: "path" | "query";
  required: boolean;
  description?: string;
  schema?: JsonSchema;
  content?: Record<string, { schema: JsonSchema }>;
};
export type OpenApiMedia = { schema: JsonSchema; example?: unknown };
export type OpenApiResponse = {
  $ref?: string;
  description?: string;
  headers?: Record<string, { description: string; schema: JsonSchema }>;
  content?: Record<string, OpenApiMedia>;
};
export type OpenApiOperation = {
  operationId: string;
  tags: string[];
  summary: string;
  description?: string;
  security: Array<Record<string, string[]>>;
  parameters?: OpenApiParameter[];
  requestBody?: { required: boolean; description?: string; content: Record<string, OpenApiMedia> };
  responses: Record<string, OpenApiResponse>;
};
export type OpenApiDocument = {
  openapi: "3.1.0";
  info: { title: string; version: string; description: string };
  servers: Array<{ url: string; description: string }>;
  tags: Array<{ name: string; description: string }>;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: {
    securitySchemes: Record<string, Record<string, string>>;
    responses: Record<string, OpenApiResponse>;
    schemas: Record<string, JsonSchema>;
  };
};

export const API_TITLE = "OzyVTT API";

/** What the whole API promises, shown at the top of the document. */
export const API_DESCRIPTION = [
  "The HTTP API of one OzyVTT table. Every answer is projected for its caller, so a player session receives only what that player may see.",
  "A game write takes an optional `commandId` (a UUID) and runs once: resend the same id to retry safely, and the server replays the stored outcome with `duplicate: true`. A Codex write with a JSON body takes one too, and its replay carries the header `x-idempotent-replay: true`. A Codex write without a body and a Codex DELETE are safe to repeat as they are. A homebrew write takes none and guards an edit with `expectedRev`.",
  "A write against a stale revision is refused with 409 and `error.currentRevision`. `expectedRevision` names the game's revision, and `expectedRev` names one record's.",
  "A missing, malformed, expired or revoked credential is 401, and a valid credential without the role or scope is 403 (ADR-0027). A record the caller may not see is 404, the same answer as one that does not exist."
].join("\n\n");

const SECURITY_SCHEMES = {
  bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "VTT integration token" },
  gmAuth: { type: "http", scheme: "bearer", bearerFormat: "VTT GM session token" },
  playerAuth: {
    type: "http",
    scheme: "bearer",
    bearerFormat: "VTT player session token",
    description:
      "A player session keeps the table's player limits: it reads player-safe projections and acts only on the character it has claimed."
  },
  viewerCookieAuth: {
    type: "apiKey",
    in: "cookie",
    name: VIEWER_SESSION_COOKIE,
    description:
      "The cookie a paired table screen's browser sends. The same credential is also accepted as a bearer token."
  }
};

const REF = "#/components/schemas/";
const ref = (name: string): JsonSchema => ({ $ref: `${REF}${name}` });
const pascal = (text: string) => `${text[0]!.toUpperCase()}${text.slice(1)}`;
const pathNames = (path: string) => [...path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!);
const SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

/** One schema written out on its own, outside the component pass: a header's or a file's. */
const standalone = (schema: z.ZodType) => tidy(z.toJSONSchema(schema, { io: "input" })) as JsonSchema;
const STRING = standalone(z.string());
const BINARY = standalone(z.string().meta({ format: "binary" }));

/** Drops what Zod's output carries that a reader doesn't need: the dialect and id, the safe-integer bounds of every
 *  `.int()`, the regex behind a named `format`, and a record's string keys. */
function tidy(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(tidy);
  if (!node || typeof node !== "object") return node;
  const source = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "$schema" || key === "$id") continue;
    if (key === "maximum" && value === SAFE_INTEGER) continue;
    if (key === "minimum" && value === -SAFE_INTEGER) continue;
    if (key === "pattern" && typeof source.format === "string") continue;
    if (key === "propertyNames" && JSON.stringify(value) === '{"type":"string"}') continue;
    out[key] = tidy(value);
  }
  return out;
}

function security(access: Access): Array<Record<string, string[]>> {
  if ("public" in access) return [];
  return [
    ...(access.scope ? [{ bearerAuth: access.scope === "per-command" ? [] : [access.scope] }] : []),
    ...(access.gm ? [{ gmAuth: [] }] : []),
    ...(access.player ? [{ playerAuth: [] }] : []),
    ...(access.viewer ? [{ viewerCookieAuth: [] }] : [])
  ];
}

/** The routes must agree with themselves before anything is written. */
function checkRoutes(routes: readonly ApiRoute[]) {
  const operations = new Set<string>();
  const ids = new Set<string>();
  const tagOfPath = new Map<string, string>();
  for (const route of routes) {
    const key = `${route.method.toUpperCase()} ${route.path}`;
    if (operations.has(key)) throw new Error(`${key} is declared twice.`);
    operations.add(key);
    if (ids.has(route.operationId)) throw new Error(`Two routes share the operation id ${route.operationId}.`);
    ids.add(route.operationId);
    const tag = tagOfPath.get(route.path);
    if (tag && tag !== route.tag) throw new Error(`${key} is tagged ${route.tag}; its path's others are ${tag}.`);
    tagOfPath.set(route.path, route.tag);
    const names = pathNames(route.path).sort();
    const declared = Object.keys(route.params?.shape ?? {}).sort();
    if (names.join() !== declared.join())
      throw new Error(
        `${key} declares path parameters ${declared.join(", ") || "none"}; its path has ${names.join(", ") || "none"}.`
      );
    for (const name of route.jsonQuery ?? [])
      if (!(name in (route.query?.shape ?? {}))) throw new Error(`${key} has no query parameter ${name}.`);
  }
}

/** Every `$ref`'d component name in a JSON value. */
function refsIn(value: unknown, into: Set<string>) {
  if (Array.isArray(value)) for (const entry of value) refsIn(entry, into);
  else if (value && typeof value === "object")
    for (const [key, entry] of Object.entries(value))
      if (key === "$ref" && typeof entry === "string" && entry.startsWith(REF)) into.add(entry.slice(REF.length));
      else refsIn(entry, into);
}

export function buildOpenApiDocument(routes: readonly ApiRoute[]): OpenApiDocument {
  checkRoutes(routes);
  const registry = z.registry<{ id: string }>();
  const names = new Map<z.ZodType, string>();
  const taken = new Set<string>();
  const add = (name: string, schema: z.ZodType) => {
    const existing = names.get(schema);
    if (existing) return existing;
    if (taken.has(name)) throw new Error(`Two schemas would be documented as ${name}.`);
    registry.add(schema, { id: name });
    names.set(schema, name);
    taken.add(name);
    return name;
  };
  for (const [name, schema] of namedSchemas()) add(name, schema);

  // A success's data is enveloped. A named envelope is reused; any other is made and named after its data.
  const envelopes = new Map<z.ZodType, string>();
  for (const [name, schema] of namedSchemas())
    if (schema instanceof z.ZodObject && Object.keys(schema.shape).sort().join() === "apiVersion,data,ok")
      envelopes.set(schema.shape.data as z.ZodType, name);
  const envelopeOf = (route: ApiRoute, status: number, data: z.ZodType) => {
    const known = envelopes.get(data);
    if (known) return known;
    const dataName = names.get(data);
    if (!dataName) throw new Error(`${route.operationId} ${status}: name its data schema with \`named\`.`);
    const name = add(`${dataName.replace(/Data$/, "")}Response`, successEnvelopeSchema(data));
    envelopes.set(data, name);
    return name;
  };

  const temporary = new Set<string>();
  const addTemporary = (name: string, schema: z.ZodType) => {
    temporary.add(name);
    return add(name, schema);
  };
  const plan = routes.map((route) => {
    const bodyName =
      route.body?.kind === "json"
        ? (names.get(route.body.schema) ?? add(`${pascal(route.operationId)}Request`, route.body.schema))
        : undefined;
    const responses = Object.entries(route.responses).map(([status, response]) => ({
      status,
      response,
      envelope: response.kind === "data" ? envelopeOf(route, Number(status), response.schema) : undefined,
      bare:
        response.kind === "bare" ? addTemporary(`__bare_${route.operationId}_${status}`, response.schema) : undefined
    }));
    const params = route.params ? addTemporary(`__params_${route.operationId}`, route.params) : undefined;
    const query = route.query ? addTemporary(`__query_${route.operationId}`, route.query) : undefined;
    return { route, bodyName, responses, params, query };
  });
  if (!names.has(ApiErrorEnvelopeSchema)) add("ApiErrorEnvelope", ApiErrorEnvelopeSchema);

  const { schemas: generated } = z.toJSONSchema(registry, {
    io: "input",
    unrepresentable: "any",
    uri: (id) => `${REF}${id}`,
    override: ({ zodSchema, jsonSchema }) => {
      const node = jsonSchema as Record<string, unknown>;
      // A `z.custom` value is typed in TypeScript and documented only as an object.
      if (zodSchema instanceof z.ZodCustom) {
        Object.assign(node, { type: "object", additionalProperties: true });
        return;
      }
      const as = documentedAs(zodSchema as unknown as z.ZodType);
      if (!as) return;
      for (const key of Object.keys(node)) delete node[key];
      node.$ref = `${REF}${names.get(as)}`;
    }
  });
  if ("__shared" in generated) throw new Error("A schema carries a global `id`; name it with `named` instead.");
  const schemas = tidy(generated) as Record<string, JsonSchema>;

  /** A route parameter: its schema from the parameter object, its prose lifted onto the parameter. */
  const parameters = (container: string | undefined, where: "path" | "query", jsonQuery: readonly string[] = []) => {
    if (!container) return [];
    const object = schemas[container]!;
    return Object.entries(object.properties ?? {}).map(([name, property]): OpenApiParameter => {
      const { description, ...schema } = property;
      return {
        name,
        in: where,
        required: where === "path" || (object.required ?? []).includes(name),
        ...(description ? { description } : {}),
        ...(jsonQuery.includes(name) ? { content: { "application/json": { schema } } } : { schema })
      };
    });
  };
  const response = (route: ApiRoute, entry: (typeof plan)[number]["responses"][number]): OpenApiResponse => {
    const answer: ApiResponse = entry.response;
    switch (answer.kind) {
      case "data":
        return {
          description: answer.description,
          ...(answer.headers
            ? {
                headers: Object.fromEntries(
                  Object.entries(answer.headers).map(([name, description]) => [name, { description, schema: STRING }])
                )
              }
            : {}),
          content: {
            "application/json": {
              schema: ref(entry.envelope!),
              ...(answer.example !== undefined
                ? { example: { ok: true, apiVersion: API_VERSION, data: answer.example } }
                : {})
            }
          }
        };
      case "bare":
        return {
          description: answer.description,
          content: { "application/json": { schema: schemas[entry.bare!]! } }
        };
      case "error":
        return answer.description
          ? {
              description: answer.description,
              content: { "application/json": { schema: ref(names.get(ApiErrorEnvelopeSchema)!) } }
            }
          : { $ref: "#/components/responses/ApiError" };
      case "other":
        return {
          description: answer.description,
          ...(answer.mediaType ? { content: { [answer.mediaType]: { schema: answer.binary ? BINARY : STRING } } } : {})
        };
      default:
        throw new Error(`${route.operationId}: an unknown response kind.`);
    }
  };

  const paths: OpenApiDocument["paths"] = {};
  for (const tag of API_TAGS)
    for (const entry of plan) {
      const { route } = entry;
      if (route.tag !== tag.name) continue;
      const parametersOf = [...parameters(entry.params, "path"), ...parameters(entry.query, "query", route.jsonQuery)];
      const body = route.body;
      const operation: OpenApiOperation = {
        operationId: route.operationId,
        tags: [route.tag],
        summary: route.summary,
        ...(route.description ? { description: route.description } : {}),
        security: security(route.access),
        ...(parametersOf.length > 0 ? { parameters: parametersOf } : {}),
        ...(body?.kind === "json"
          ? {
              requestBody: {
                required: body.required,
                content: {
                  "application/json": {
                    schema: ref(entry.bodyName!),
                    ...(body.example !== undefined ? { example: body.example } : {})
                  }
                }
              }
            }
          : body?.kind === "binary"
            ? {
                requestBody: {
                  required: true,
                  description: body.description,
                  content: { [body.mediaType]: { schema: BINARY } }
                }
              }
            : {}),
        responses: Object.fromEntries(entry.responses.map((answer) => [answer.status, response(route, answer)]))
      };
      paths[route.path] = { ...paths[route.path], [route.method]: operation };
    }

  // Only what the paths reach is published; the parameter and bare-body containers were scaffolding.
  const reached = new Set<string>();
  refsIn(paths, reached);
  reached.add(names.get(ApiErrorEnvelopeSchema)!);
  for (let frontier = [...reached]; frontier.length > 0;) {
    const next = new Set<string>();
    for (const name of frontier) {
      if (!schemas[name]) throw new Error(`A reference names ${name}, which is not a component.`);
      refsIn(schemas[name], next);
    }
    frontier = [...next].filter((name) => !reached.has(name));
    for (const name of frontier) reached.add(name);
  }
  const published = Object.fromEntries(
    [...reached]
      .filter((name) => !temporary.has(name))
      .sort()
      .map((name) => [name, schemas[name]!])
  );

  const usedTags = new Set(routes.map((route) => route.tag));
  return {
    openapi: "3.1.0",
    info: { title: API_TITLE, version: API_VERSION, description: API_DESCRIPTION },
    servers: [{ url: "/", description: "The server this document was read from. Every path starts with /api/v1." }],
    tags: API_TAGS.filter((tag) => usedTags.has(tag.name)).map((tag) => ({ ...tag })),
    paths,
    components: {
      securitySchemes: SECURITY_SCHEMES,
      responses: {
        ApiError: {
          description: "A refusal in the error envelope.",
          content: { "application/json": { schema: ref(names.get(ApiErrorEnvelopeSchema)!) } }
        }
      },
      schemas: published
    }
  };
}
