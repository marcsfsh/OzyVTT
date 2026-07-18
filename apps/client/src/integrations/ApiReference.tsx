import { useState } from "react";
import "./api-reference.css";

/**
 * Collapsible, always-current API reference for the VTT Setup page. Everything shown is fetched
 * from the running server itself — the byte-identical OpenAPI document at /api/v1/openapi.json and
 * the live command catalog — so this section can never drift from what the server actually exposes.
 * Each endpoint expands to its full spec (auth, parameters, request body fields, an example
 * request, and response shapes), resolved from the document's own component schemas.
 */

type Schema = Record<string, any>;
type Components = Record<string, Schema>;
type Operation = Readonly<{
  operationId?: string;
  description?: string;
  security?: ReadonlyArray<Record<string, readonly string[]>>;
  parameters?: ReadonlyArray<{ name: string; in: string; required?: boolean; schema?: Schema }>;
  requestBody?: { required?: boolean; content: Record<string, { schema?: Schema }> };
  responses: Record<string, { description?: string; content?: Record<string, { schema?: Schema }>; headers?: Record<string, unknown>; $ref?: string }>;
}>;
type OpenApiDocument = Readonly<{
  info: { title: string; description?: string };
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Components };
}>;
type CatalogCommand = Readonly<{ type: string; scope: string; summary: string }>;

const METHOD_ORDER = ["get", "post", "put", "patch", "delete"] as const;
const EXAMPLE_UUID = "00000000-0000-4000-8000-000000000000";

const GROUPS: ReadonlyArray<{ title: string; match: (path: string) => boolean }> = [
  { title: "System & discovery", match: (path) => path.startsWith("/api/v1/system") || path === "/api/v1/openapi.json" },
  { title: "Integration credentials (GM)", match: (path) => path.startsWith("/api/v1/gm/integration-credentials") },
  { title: "Player sessions", match: (path) => path.startsWith("/api/v1/sessions") },
  { title: "Live game", match: (path) => path.startsWith("/api/v1/game") },
  { title: "Reference content", match: (path) => path.startsWith("/api/v1/content") },
  { title: "Encounter archives (Time Machine)", match: (path) => path.startsWith("/api/v1/encounters") },
  { title: "Map assets & calibration", match: (path) => path.startsWith("/api/v1/map-assets") },
  { title: "Table viewer", match: (path) => path.startsWith("/api/v1/viewer") }
];

const refName = (ref: string) => ref.replace("#/components/schemas/", "");
const resolveRef = (ref: string, components: Components): Schema | undefined => components[refName(ref)];

function authOptions(operation: Operation): readonly string[] {
  const security = operation.security;
  if (!security || security.length === 0) return ["public — no credentials"];
  return security.map((entry) => {
    if ("bearerAuth" in entry) return entry.bearerAuth.length > 0 ? `integration (${entry.bearerAuth.join(", ")})` : "integration (scope per command type)";
    if ("gmAuth" in entry) return "GM session";
    if ("playerAuth" in entry) return "player session";
    if ("viewerCookieAuth" in entry) return "paired viewer";
    return Object.keys(entry).join(", ");
  });
}

/** Short chips for the collapsed summary line. */
function authChips(operation: Operation): readonly string[] {
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

function typeLabel(schema: Schema | undefined, components: Components): string {
  if (!schema) return "unknown";
  if (typeof schema.$ref === "string") return refName(schema.$ref);
  if (Array.isArray(schema.oneOf)) return schema.oneOf.map((branch: Schema) => typeLabel(branch, components)).join(" | ");
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
    if (minimum !== undefined && maximum !== undefined) return `${schema.type} (${minimum}–${maximum})`;
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

type FieldRow = Readonly<{ name: string; type: string; required: boolean; note: string }>;

/** Object fields, flattening one level of nested objects / arrays-of-objects so shapes like `entries[].actorId` are spelled out. */
function fieldRows(schema: Schema, components: Components): FieldRow[] {
  const properties = (schema.properties ?? {}) as Record<string, Schema>;
  const required = new Set<string>(schema.required ?? []);
  const rows: FieldRow[] = [];
  for (const [name, property] of Object.entries(properties)) {
    rows.push({ name, type: typeLabel(property, components), required: required.has(name), note: noteOf(property) });
    const nested = property.type === "object" && property.properties
      ? property
      : property.type === "array" && property.items?.type === "object" && property.items?.properties
        ? property.items
        : undefined;
    if (nested) {
      const prefix = property.type === "array" ? `${name}[]` : name;
      const nestedRequired = new Set<string>(nested.required ?? []);
      for (const [nestedName, nestedProperty] of Object.entries(nested.properties as Record<string, Schema>)) {
        rows.push({ name: `${prefix}.${nestedName}`, type: typeLabel(nestedProperty, components), required: nestedRequired.has(nestedName), note: noteOf(nestedProperty) });
      }
    }
  }
  return rows;
}

/** A synthetic example value for a schema — enum/const first, then format-aware placeholders. Depth- and cycle-guarded. */
function exampleValue(schema: Schema | undefined, components: Components, depth = 0, seen: ReadonlySet<string> = new Set()): unknown {
  if (!schema || depth > 6) return null;
  if (typeof schema.$ref === "string") {
    if (seen.has(schema.$ref)) return {};
    return exampleValue(resolveRef(schema.$ref, components), components, depth + 1, new Set([...seen, schema.$ref]));
  }
  if (Array.isArray(schema.oneOf)) return exampleValue(schema.oneOf[0], components, depth + 1, seen);
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type.find((entry: string) => entry !== "null") ?? schema.type[0] : schema.type;
  if (type === "object") {
    const properties = schema.properties as Record<string, Schema> | undefined;
    if (!properties) return {};
    const required = new Set<string>(schema.required ?? []);
    const out: Record<string, unknown> = {};
    for (const [name, property] of Object.entries(properties)) if (required.has(name)) out[name] = exampleValue(property, components, depth + 1, seen);
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

/** The request body example includes ALL top-level properties (so optional commandId/expectedRevision show), nested uses required-only. */
function exampleBody(schema: Schema, components: Components): Record<string, unknown> | null {
  const resolved = typeof schema.$ref === "string" ? resolveRef(schema.$ref, components) : schema;
  const properties = resolved?.properties as Record<string, Schema> | undefined;
  if (!properties) return null;
  const out: Record<string, unknown> = {};
  for (const [name, property] of Object.entries(properties)) out[name] = exampleValue(property, components, 1);
  return out;
}

/** The `data` schema inside a success envelope response (`{ ok, apiVersion, data }`), for rendering the response body fields. */
function responseDataSchema(schemaRef: Schema | undefined, components: Components): Schema | undefined {
  if (!schemaRef || typeof schemaRef.$ref !== "string") return undefined;
  const envelope = resolveRef(schemaRef.$ref, components);
  const dataRef = envelope?.properties?.data?.$ref;
  return typeof dataRef === "string" ? resolveRef(dataRef, components) : undefined;
}

function FieldTable({ rows }: Readonly<{ rows: readonly FieldRow[] }>) {
  if (rows.length === 0) return <p className="api-detail-empty">No fields.</p>;
  return <table className="api-field-table">
    <thead><tr><th>Field</th><th>Type</th><th>Req</th><th>Notes</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.name}><td><code>{row.name}</code></td><td>{row.type}</td><td>{row.required ? "yes" : "—"}</td><td>{row.note}</td></tr>)}</tbody>
  </table>;
}

function EndpointDetails({ method, path, operation, components, origin }: Readonly<{ method: string; path: string; operation: Operation; components: Components; origin: string }>) {
  const [open, setOpen] = useState(false);
  const parameters = operation.parameters ?? [];
  const jsonBody = operation.requestBody?.content?.["application/json"]?.schema;
  const bodySchema = jsonBody ? (typeof jsonBody.$ref === "string" ? resolveRef(jsonBody.$ref, components) : jsonBody) : undefined;
  const rawBodyTypes = operation.requestBody && !jsonBody ? Object.keys(operation.requestBody.content ?? {}) : [];
  const needsAuth = !authOptions(operation).some((label) => label.startsWith("public"));

  const examplePath = path.replace(/\{[a-zA-Z]+\}/g, EXAMPLE_UUID);
  const exampleJson = bodySchema ? exampleBody(bodySchema, components) : null;
  const curl = [
    `curl -X ${method.toUpperCase()} ${origin}${examplePath}`,
    ...(needsAuth ? [`  -H "Authorization: Bearer $TOKEN"`] : []),
    ...(exampleJson ? [`  -H "content-type: application/json"`, `  -d '${JSON.stringify(exampleJson)}'`] : rawBodyTypes.length ? [`  --data-binary @image.png  # ${rawBodyTypes.join(", ")}`] : [])
  ].join(" \\\n");

  return <details className="api-endpoint" onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
    <summary>
      <span className="api-reference-route">
        <code className={`api-method api-method-${method}`}>{method.toUpperCase()}</code>
        <code className="api-path">{path}</code>
        <span className="api-auth">{authChips(operation).map((chip) => <em key={chip}>{chip}</em>)}</span>
      </span>
      {operation.description && <span className="api-endpoint-summary">{operation.description}</span>}
    </summary>
    {open && <div className="api-endpoint-body">
      <p className="api-detail-line"><strong>Authorized principals:</strong> {authOptions(operation).join(" · ")}</p>

      {parameters.length > 0 && <div className="api-detail-block">
        <h4>Parameters</h4>
        <table className="api-field-table">
          <thead><tr><th>Name</th><th>In</th><th>Type</th><th>Req</th></tr></thead>
          <tbody>{parameters.map((parameter) => <tr key={`${parameter.in}-${parameter.name}`}><td><code>{parameter.name}</code></td><td>{parameter.in}</td><td>{typeLabel(parameter.schema, components)}</td><td>{parameter.required ? "yes" : "—"}</td></tr>)}</tbody>
        </table>
      </div>}

      {bodySchema && <div className="api-detail-block">
        <h4>Request body{operation.requestBody?.required ? "" : " (optional)"}</h4>
        <FieldTable rows={fieldRows(bodySchema, components)} />
      </div>}
      {rawBodyTypes.length > 0 && <div className="api-detail-block"><h4>Request body</h4><p className="api-detail-line">Raw <code>{rawBodyTypes.join(", ")}</code> bytes.</p></div>}

      <div className="api-detail-block">
        <h4>Example request</h4>
        <pre className="api-code"><code>{curl}</code></pre>
      </div>

      <div className="api-detail-block">
        <h4>Responses</h4>
        {Object.entries(operation.responses).map(([code, response]) => {
          const isError = typeof response.$ref === "string" || (code >= "400");
          const schemaRef = response.content?.["application/json"]?.schema;
          const dataSchema = responseDataSchema(schemaRef, components);
          return <div key={code} className={`api-response ${isError ? "api-response-error" : "api-response-ok"}`}>
            <p><code className="api-response-code">{code}</code> {response.description ?? (typeof response.$ref === "string" ? "Stable API error" : "")}{schemaRef && typeof schemaRef.$ref === "string" ? <em className="api-response-schema"> — {refName(schemaRef.$ref)}</em> : null}</p>
            {dataSchema && <FieldTable rows={fieldRows(dataSchema, components)} />}
          </div>;
        })}
      </div>
    </div>}
  </details>;
}

export function ApiReference({ gmToken }: Readonly<{ gmToken: string }>) {
  const [state, setState] = useState<{ status: "idle" | "loading" | "ready" | "error"; document: OpenApiDocument | null; commands: readonly CatalogCommand[]; message: string }>({ status: "idle", document: null, commands: [], message: "" });

  const load = () => {
    if (state.status !== "idle" && state.status !== "error") return;
    setState((current) => ({ ...current, status: "loading", message: "" }));
    Promise.all([
      fetch("/api/v1/openapi.json").then((response) => response.json()),
      fetch("/api/v1/game/commands", { headers: { authorization: `Bearer ${gmToken}` } }).then((response) => response.json())
    ])
      .then(([document, catalog]) => setState({ status: "ready", document: document as OpenApiDocument, commands: (catalog?.data?.commands ?? []) as readonly CatalogCommand[], message: "" }))
      .catch(() => setState({ status: "error", document: null, commands: [], message: "The reference could not be loaded from the server." }));
  };

  const document = state.document;
  const components = document?.components?.schemas ?? {};
  const origin = window.location.origin;
  const operationCount = document ? Object.values(document.paths).reduce((total, operations) => total + Object.keys(operations).length, 0) : 0;

  return <details className="api-reference" onToggle={(event) => { if ((event.target as HTMLDetailsElement).open) load(); }}>
    <summary><strong>API reference</strong><span>Every endpoint this server exposes, straight from its own contract — click one for its full spec.</span></summary>
    <div className="api-reference-body">
      <p className="api-reference-intro">
        Base URL: <code>{origin}/api/v1</code> · Authenticate with <code>Authorization: Bearer &lt;token&gt;</code> — a credential from above, your GM session, or a player session.
        Writes accept an optional <code>commandId</code> (resend it to retry safely) and <code>expectedRevision</code>.
        The machine-readable contract lives at <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer">/api/v1/openapi.json</a>; a full generated write-up ships in the repo at <code>docs/api-reference.md</code>.
      </p>
      {state.status === "loading" && <p>Loading the contract…</p>}
      {state.status === "error" && <p className="api-reference-error">{state.message} <button className="link" onClick={load}>Retry</button></p>}
      {document && <>
        <p className="api-reference-count">{operationCount} operations across {Object.keys(document.paths).length} paths. Example values are synthetic — real ids come from the game state.</p>
        {GROUPS.map((group) => {
          const paths = Object.entries(document.paths).filter(([path]) => group.match(path));
          if (paths.length === 0) return null;
          return <section key={group.title} className="api-reference-group">
            <h3>{group.title}</h3>
            <div className="api-endpoint-list">
              {paths.flatMap(([path, operations]) => METHOD_ORDER.filter((method) => operations[method]).map((method) => (
                <EndpointDetails key={`${method} ${path}`} method={method} path={path} operation={operations[method]} components={components} origin={origin} />
              )))}
            </div>
          </section>;
        })}
        {state.commands.length > 0 && <section className="api-reference-group">
          <h3>Command catalog (typed routes + the <code>POST /game/commands</code> tunnel)</h3>
          <table className="api-command-table">
            <thead><tr><th>Command type</th><th>Scope</th><th>What it does</th></tr></thead>
            <tbody>{state.commands.map((command) => <tr key={command.type}><td><code>{command.type}</code></td><td><code>{command.scope}</code></td><td>{command.summary}</td></tr>)}</tbody>
          </table>
        </section>}
      </>}
    </div>
  </details>;
}
