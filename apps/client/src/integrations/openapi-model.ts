import { downloadJson } from "../lib/download";

/**
 * Reading the served OpenAPI document for the API reference: its shapes, the groups the reference
 * lists, field tables, example bodies and the code samples in each language.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- an arbitrary JSON Schema node
export type Schema = Record<string, any>;
export type Components = Record<string, Schema>;
export type Operation = Readonly<{
  operationId?: string;
  description?: string;
  security?: ReadonlyArray<Record<string, readonly string[]>>;
  parameters?: ReadonlyArray<{ name: string; in: string; required?: boolean; schema?: Schema }>;
  requestBody?: { required?: boolean; content: Record<string, { schema?: Schema }> };
  responses: Record<
    string,
    {
      description?: string;
      content?: Record<string, { schema?: Schema }>;
      headers?: Record<string, unknown>;
      $ref?: string;
    }
  >;
}>;
export type OpenApiDocument = Readonly<{
  info: { title: string; description?: string };
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Components };
}>;
export type CatalogCommand = Readonly<{ type: string; scope: string; summary: string }>;

export const METHOD_ORDER = ["get", "post", "put", "patch", "delete"] as const;
export const EXAMPLE_UUID = "00000000-0000-4000-8000-000000000000";

export type Language = "shell" | "python" | "powershell" | "javascript";
export const LANGUAGES: ReadonlyArray<{ id: Language; label: string }> = [
  { id: "shell", label: "cURL" },
  { id: "python", label: "Python" },
  { id: "powershell", label: "PowerShell" },
  { id: "javascript", label: "JavaScript" }
];

/** JSON value → Python literal (True/False/None, dicts, lists) so the example is copy-paste valid. */
function toPythonLiteral(value: unknown, indent = 0): string {
  const pad = "    ".repeat(indent);
  const inner = "    ".repeat(indent + 1);
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value))
    return value.length === 0
      ? "[]"
      : `[\n${value.map((entry) => inner + toPythonLiteral(entry, indent + 1)).join(",\n")}\n${pad}]`;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length === 0
    ? "{}"
    : `{\n${entries.map(([key, entry]) => `${inner}${JSON.stringify(key)}: ${toPythonLiteral(entry, indent + 1)}`).join(",\n")}\n${pad}}`;
}

/** A runnable request sample for one endpoint in the chosen language. Placeholders stand in for a real token and ids. */
export function codeSample(
  language: Language,
  method: string,
  url: string,
  needsAuth: boolean,
  body: Record<string, unknown> | null,
  rawBodyTypes: readonly string[]
): string {
  const upper = method.toUpperCase();
  const bodyJson = body ? JSON.stringify(body) : null;
  const bodyPretty = body ? JSON.stringify(body, null, 2) : null;
  const rawType = rawBodyTypes[0];

  if (language === "shell") {
    const lines = [`curl -X ${upper} ${url}`];
    if (needsAuth) lines.push(`  -H "Authorization: Bearer $TOKEN"`);
    if (bodyJson) {
      lines.push(`  -H "content-type: application/json"`);
      lines.push(`  -d '${bodyJson}'`);
    } else if (rawType) {
      lines.push(`  -H "content-type: ${rawType}"`);
      lines.push(`  --data-binary @image.png`);
    }
    return lines.join(" \\\n");
  }

  if (language === "python") {
    const lines = ["import requests", "", `url = "${url}"`];
    const headers: string[] = [];
    if (needsAuth) headers.push(`    "Authorization": "Bearer YOUR_TOKEN"`);
    if (bodyJson || rawType) headers.push(`    "Content-Type": "${rawType ?? "application/json"}"`);
    if (headers.length) lines.push(`headers = {\n${headers.join(",\n")}\n}`);
    if (body) lines.push(`payload = ${toPythonLiteral(body)}`);
    const args = ["url"];
    if (headers.length) args.push("headers=headers");
    if (body) args.push("json=payload");
    else if (rawType) args.push(`data=open("image.png", "rb").read()`);
    lines.push("", `response = requests.${method.toLowerCase()}(${args.join(", ")})`, "print(response.json())");
    return lines.join("\n");
  }

  if (language === "powershell") {
    const capital = upper.charAt(0) + upper.slice(1).toLowerCase();
    const lines: string[] = [];
    if (needsAuth) lines.push(`$headers = @{\n    "Authorization" = "Bearer YOUR_TOKEN"\n}`);
    if (bodyPretty) lines.push(`$body = @'\n${bodyPretty}\n'@`);
    const args = [`-Method ${capital}`, `-Uri "${url}"`];
    if (needsAuth) args.push("-Headers $headers");
    if (bodyPretty) {
      args.push(`-ContentType "application/json"`);
      args.push("-Body $body");
    } else if (rawType) {
      args.push(`-ContentType "${rawType}"`);
      args.push(`-InFile "image.png"`);
    }
    lines.push(`Invoke-RestMethod ${args.join(" ")}`);
    return lines.join("\n");
  }

  const headerLines: string[] = [];
  if (needsAuth) headerLines.push(`    "Authorization": "Bearer YOUR_TOKEN"`);
  if (bodyJson || rawType) headerLines.push(`    "Content-Type": "${rawType ?? "application/json"}"`);
  const init: string[] = [`  method: "${upper}"`];
  if (headerLines.length) init.push(`  headers: {\n${headerLines.join(",\n")}\n  }`);
  if (bodyPretty) init.push(`  body: JSON.stringify(${bodyPretty.replace(/\n/g, "\n  ")})`);
  return `const response = await fetch("${url}", {\n${init.join(",\n")}\n});\nconst data = await response.json();\nconsole.log(data);`;
}

export const GROUPS: ReadonlyArray<{ title: string; match: (path: string) => boolean }> = [
  {
    title: "System & discovery",
    match: (path) => path.startsWith("/api/v1/system") || path === "/api/v1/openapi.json"
  },
  { title: "Integration credentials (GM)", match: (path) => path.startsWith("/api/v1/gm/integration-credentials") },
  { title: "Player sessions", match: (path) => path.startsWith("/api/v1/sessions") },
  { title: "Live game", match: (path) => path.startsWith("/api/v1/game") },
  { title: "Reference content", match: (path) => path.startsWith("/api/v1/content") },
  { title: "Fight replays (Time Machine)", match: (path) => path.startsWith("/api/v1/encounters") },
  { title: "Map assets & calibration", match: (path) => path.startsWith("/api/v1/map-assets") },
  { title: "Table viewer", match: (path) => path.startsWith("/api/v1/viewer") },
  // Titles follow the Codex glossary ("pages", "atlas", "journal", "calendar"). New paths appear on
  // their own because the live document is rendered; `ungrouped` catches anything a matcher misses.
  { title: "Codex (pages, atlas, journal & calendar)", match: (path) => path.startsWith("/api/v1/codex") },
  { title: "Homebrew authoring (GM only)", match: (path) => path.startsWith("/api/v1/homebrew") }
];

/**
 * Paths no group claims, listed under "Other" so a missing `GROUPS` entry shows as a wrong heading
 * and the endpoint is still there.
 */
export const ungrouped = (paths: readonly string[]) =>
  paths.filter((path) => !GROUPS.some((group) => group.match(path)));

export const refName = (ref: string) => ref.replace("#/components/schemas/", "");
export const resolveRef = (ref: string, components: Components): Schema | undefined => components[refName(ref)];

export function authOptions(operation: Operation): readonly string[] {
  const security = operation.security;
  if (!security || security.length === 0) return ["public · no credentials"];
  return security.map((entry) => {
    if ("bearerAuth" in entry)
      return entry.bearerAuth.length > 0
        ? `integration (${entry.bearerAuth.join(", ")})`
        : "integration (scope per command type)";
    if ("gmAuth" in entry) return "GM session";
    if ("playerAuth" in entry) return "player session";
    if ("viewerCookieAuth" in entry) return "paired viewer";
    return Object.keys(entry).join(", ");
  });
}

/** Short chips for the collapsed summary line. */
export function authChips(operation: Operation): readonly string[] {
  const security = operation.security;
  if (!security || security.length === 0) return ["public"];
  return security.map((entry) => {
    if ("bearerAuth" in entry) return entry.bearerAuth.length > 0 ? entry.bearerAuth.join(" ") : "any scope";
    if ("gmAuth" in entry) return "GM";
    if ("playerAuth" in entry) return "player";
    if ("viewerCookieAuth" in entry) return "viewer";
    return Object.keys(entry).join(" ");
  });
}

/** A union's branches: `oneOf` for a discriminated union, `anyOf` for any other (`X | null` among them). */
function unionBranches(schema: Schema): Schema[] | undefined {
  const branches = schema.oneOf ?? schema.anyOf;
  return Array.isArray(branches) ? branches : undefined;
}

export function typeLabel(schema: Schema | undefined, components: Components): string {
  if (!schema) return "unknown";
  if (typeof schema.$ref === "string") return refName(schema.$ref);
  const branches = unionBranches(schema);
  if (branches) return branches.map((branch) => typeLabel(branch, components)).join(" | ");
  if (schema.const !== undefined) return `const ${JSON.stringify(schema.const)}`;
  if (Array.isArray(schema.enum)) return schema.enum.map((value: unknown) => String(value)).join(" | ");
  if (schema.type === "array") return `${typeLabel(schema.items, components)}[]`;
  if (Array.isArray(schema.type)) return schema.type.join(" | ");
  if (schema.type === "object") return schema.properties ? "object" : "object (free-form)";
  if (schema.type === "string") {
    if (typeof schema.format === "string") return `string (${schema.format})`;
    if (typeof schema.pattern === "string") return "string (pattern)";
    return "string";
  }
  if (schema.type === "integer" || schema.type === "number") {
    const { minimum, maximum } = schema;
    if (minimum !== undefined && maximum !== undefined) return `${schema.type} (${minimum}-${maximum})`;
    if (minimum !== undefined) return `${schema.type} (≥ ${minimum})`;
    if (maximum !== undefined) return `${schema.type} (≤ ${maximum})`;
    return schema.type;
  }
  return typeof schema.type === "string" ? schema.type : "unknown";
}

function noteOf(schema: Schema): string {
  const parts: string[] = [];
  if (typeof schema.description === "string") parts.push(schema.description);
  if (schema.default !== undefined) parts.push(`Default: ${JSON.stringify(schema.default)}.`);
  return parts.join(" ");
}

export type FieldRow = Readonly<{ name: string; type: string; required: boolean; note: string }>;

/** Object fields, with one level of nested objects / arrays-of-objects flattened so shapes like `entries[].actorId` are spelled out. */
export function fieldRows(schema: Schema, components: Components): FieldRow[] {
  const properties = (schema.properties ?? {}) as Record<string, Schema>;
  const required = new Set<string>(schema.required ?? []);
  const rows: FieldRow[] = [];
  for (const [name, property] of Object.entries(properties)) {
    rows.push({ name, type: typeLabel(property, components), required: required.has(name), note: noteOf(property) });
    const nested =
      property.type === "object" && property.properties
        ? property
        : property.type === "array" && property.items?.type === "object" && property.items?.properties
          ? property.items
          : undefined;
    if (nested) {
      const prefix = property.type === "array" ? `${name}[]` : name;
      const nestedRequired = new Set<string>(nested.required ?? []);
      for (const [nestedName, nestedProperty] of Object.entries(nested.properties as Record<string, Schema>)) {
        rows.push({
          name: `${prefix}.${nestedName}`,
          type: typeLabel(nestedProperty, components),
          required: nestedRequired.has(nestedName),
          note: noteOf(nestedProperty)
        });
      }
    }
  }
  return rows;
}

/** A synthetic example value for a schema: enum/const first, then format-aware placeholders. Depth- and cycle-guarded. */
function exampleValue(
  schema: Schema | undefined,
  components: Components,
  depth = 0,
  seen: ReadonlySet<string> = new Set()
): unknown {
  if (!schema || depth > 6) return null;
  if (typeof schema.$ref === "string") {
    if (seen.has(schema.$ref)) return {};
    return exampleValue(resolveRef(schema.$ref, components), components, depth + 1, new Set([...seen, schema.$ref]));
  }
  const branches = unionBranches(schema);
  if (branches) {
    const example = branches.find((branch) => branch.type !== "null") ?? branches[0];
    return exampleValue(example, components, depth + 1, seen);
  }
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  const type = Array.isArray(schema.type)
    ? (schema.type.find((entry: string) => entry !== "null") ?? schema.type[0])
    : schema.type;
  if (type === "object") {
    const properties = schema.properties as Record<string, Schema> | undefined;
    if (!properties) return {};
    const required = new Set<string>(schema.required ?? []);
    const out: Record<string, unknown> = {};
    for (const [name, property] of Object.entries(properties))
      if (required.has(name)) out[name] = exampleValue(property, components, depth + 1, seen);
    return out;
  }
  if (type === "array") return [exampleValue(schema.items, components, depth + 1, seen)];
  if (type === "boolean") return true;
  if (type === "integer" || type === "number") return schema.minimum ?? 1;
  if (type === "string") {
    if (schema.format === "uuid") return EXAMPLE_UUID;
    if (schema.format === "date-time") return "2030-01-01T00:00:00.000Z";
    return "string";
  }
  return null;
}

/** The request body example includes all top-level properties (so optional commandId/expectedRevision show); nested objects use required-only. */
export function exampleBody(schema: Schema, components: Components): Record<string, unknown> | null {
  const resolved = typeof schema.$ref === "string" ? resolveRef(schema.$ref, components) : schema;
  const properties = resolved?.properties as Record<string, Schema> | undefined;
  if (!properties) return null;
  const out: Record<string, unknown> = {};
  for (const [name, property] of Object.entries(properties)) out[name] = exampleValue(property, components, 1);
  return out;
}

/** The `data` schema inside a success envelope response (`{ ok, apiVersion, data }`), for rendering the response body fields. */
export function responseDataSchema(schemaRef: Schema | undefined, components: Components): Schema | undefined {
  if (!schemaRef || typeof schemaRef.$ref !== "string") return undefined;
  const envelope = resolveRef(schemaRef.$ref, components);
  const dataRef = envelope?.properties?.data?.$ref;
  return typeof dataRef === "string" ? resolveRef(dataRef, components) : undefined;
}

/** Downloads the full OpenAPI 3.1 spec (for Postman, openapi-generator, etc.). */
export function exportSpec(document: OpenApiDocument) {
  downloadJson(`vtt-openapi-v${(document.info as { version?: string }).version ?? "1"}.json`, document);
}
