import type { z } from "zod";
import type { IntegrationScope } from "../index.js";
import type { ApiTag } from "./tags.js";

/**
 * How an HTTP operation is declared once: its method and path, who may call it, its parameters and body, and every
 * response by status, all as Zod schemas. The OpenAPI document is generated from these declarations alone
 * (`../openapi/index.ts`), and the server's routers read their request schemas from the same objects.
 */

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

/**
 * Who may call a route. `public` takes no credential at all. Otherwise each flag names a credential the route
 * accepts: a GM session, a player session (with the table's player limits), a paired table screen's viewer cookie,
 * or an integration credential carrying `scope`. `per-command` is the command tunnel, where the command decides.
 */
export type Access =
  | Readonly<{ public: true }>
  | Readonly<{ gm?: true; player?: true; viewer?: true; scope?: IntegrationScope | "per-command" }>;

/** No credential. */
export const PUBLIC = { public: true } as const satisfies Access;
/** A GM session alone. */
export const GM_SESSION = { gm: true } as const satisfies Access;
/** A GM session, or an integration credential with `scope`, which acts with GM authority. */
export const gmGrade = <const S extends IntegrationScope>(scope: S) => ({ gm: true, scope }) as const satisfies Access;
/** As `gmGrade`, and a player session within its own-character limits. */
export const anySession = <const S extends IntegrationScope>(scope: S) =>
  ({ gm: true, player: true, scope }) as const satisfies Access;

/** A JSON request body, parsed with `schema`. */
export type JsonBody<S extends z.ZodType = z.ZodType> = Readonly<{
  kind: "json";
  schema: S;
  /** False when the body may be left out; the router then parses `{}`. */
  required: boolean;
  example?: unknown;
}>;
/** Raw bytes of a media type, read by the route itself. */
export type BinaryBody = Readonly<{ kind: "binary"; mediaType: string; description: string }>;
export type RequestBody = JsonBody | BinaryBody;

export const json = <S extends z.ZodType>(
  schema: S,
  options: Readonly<{ required?: boolean; example?: z.input<S> }> = {}
): JsonBody<S> => ({
  kind: "json",
  schema,
  required: options.required ?? true,
  ...(options.example !== undefined ? { example: options.example } : {})
});
export const binary = (mediaType: string, description: string): BinaryBody => ({
  kind: "binary",
  mediaType,
  description
});

/** A success answered in the `{ ok, apiVersion, data }` envelope; `schema` is the `data`. */
export type DataResponse = Readonly<{
  kind: "data";
  description: string;
  schema: z.ZodType;
  headers?: Readonly<Record<string, string>>;
  example?: unknown;
}>;
/** JSON outside the envelope: the OpenAPI document itself. */
export type BareJsonResponse = Readonly<{ kind: "bare"; description: string; schema: z.ZodType }>;
/** The error envelope. Without a description it is the shared `ApiError` response. */
export type ErrorResponse = Readonly<{ kind: "error"; description?: string }>;
/** No JSON: a 304, a byte range, a file's bytes or an event stream. */
export type OtherResponse = Readonly<{ kind: "other"; description: string; mediaType?: string; binary?: boolean }>;
export type ApiResponse = DataResponse | BareJsonResponse | ErrorResponse | OtherResponse;

export const ok = <S extends z.ZodType>(
  schema: S,
  description: string,
  options: Readonly<{ example?: z.input<S>; headers?: Readonly<Record<string, string>> }> = {}
): DataResponse => ({ kind: "data", description, schema, ...options });
export const bareJson = (schema: z.ZodType, description: string): BareJsonResponse => ({
  kind: "bare",
  description,
  schema
});
/** A refusal in the error envelope. Give a description when it says more than its status does. */
export const refused = (description?: string): ErrorResponse => ({
  kind: "error",
  ...(description ? { description } : {})
});
export const noBody = (description: string): OtherResponse => ({ kind: "other", description });
export const bytes = (mediaType: string, description: string): OtherResponse => ({
  kind: "other",
  description,
  mediaType,
  binary: true
});
export const stream = (mediaType: string, description: string): OtherResponse => ({
  kind: "other",
  description,
  mediaType
});

export type ApiRoute = Readonly<{
  method: HttpMethod;
  /** OpenAPI style: `{name}` for a path parameter. */
  path: string;
  /** Stable: integrations and the client's reference key on it. */
  operationId: string;
  tag: ApiTag;
  /** One line: what calling it does. */
  summary: string;
  /** The rules a caller needs beyond the summary. */
  description?: string;
  access: Access;
  /** One key per `{name}` in the path. */
  params?: z.ZodObject;
  query?: z.ZodObject;
  /** Query parameters sent JSON-encoded, documented with a JSON `content` of their own. */
  jsonQuery?: readonly string[];
  body?: RequestBody;
  responses: Readonly<Record<number, ApiResponse>>;
}>;

/** Declares one route. The literal type is kept, so a router reads `route.body.schema` with its own output type. */
export const defineRoute = <const R extends ApiRoute>(route: R): R => route;

/** The parsed body of a route: its JSON schema's output. */
export type BodyOf<R extends ApiRoute> =
  R["body"] extends JsonBody<infer S> ? z.output<S> : R["body"] extends undefined ? undefined : never;
