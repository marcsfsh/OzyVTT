import {
  API_NAMESPACE,
  API_VERSION,
  GAME_COMMAND_SCOPES,
  IntegrationScopeSchema,
  OPENAPI_DOCUMENT_PATH,
  openApiDocument,
  REALTIME_PROTOCOL_VERSION
} from "./index.js";

/**
 * Renders `docs/api-reference.md` from the SAME `openApiDocument` the server serves byte-identical
 * at `GET /api/v1/openapi.json` - so the human-readable reference cannot drift from the machine
 * contract. `packages/api-contract/test/reference.test.ts` fails whenever the committed file no
 * longer matches this renderer's output; regenerate with `npm run docs:generate -w @vtt/api-contract`.
 */

type Schema = Record<string, unknown>;
type Operation = {
  operationId?: string;
  description?: string;
  security?: ReadonlyArray<Record<string, readonly string[]>>;
  parameters?: ReadonlyArray<{ name: string; in: string; required?: boolean; schema?: Schema }>;
  requestBody?: { required?: boolean; content: Record<string, { schema?: Schema }> };
  responses: Record<string, { description?: string; content?: Record<string, { schema?: Schema }>; headers?: Record<string, unknown>; $ref?: string }>;
};

const doc = openApiDocument as unknown as {
  info: { title: string; description: string };
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema> };
};
const components = doc.components.schemas;
const METHOD_ORDER = ["get", "post", "put", "patch", "delete"] as const;

const GROUPS: ReadonlyArray<{ title: string; intro: string; match: (path: string) => boolean }> = [
  {
    title: "System & discovery",
    intro: "Liveness, version negotiation, capability discovery, and the machine-readable contract itself.",
    match: (path) => path.startsWith(`${API_NAMESPACE}/system`) || path === OPENAPI_DOCUMENT_PATH
  },
  {
    title: "Integration credentials (GM-managed)",
    intro: "Minting, rotating, revoking, and auditing the scoped bearer tokens integrations authenticate with. GM sessions only - an integration token can never manage credentials.",
    match: (path) => path.startsWith(`${API_NAMESPACE}/gm/integration-credentials`)
  },
  {
    title: "Player sessions",
    intro: "Session issuance for headless or custom player clients - the HTTP mirror of the socket's open, LAN-trust join.",
    match: (path) => path.startsWith(`${API_NAMESPACE}/sessions`)
  },
  {
    title: "Live game",
    intro: "The authoritative game state and every game command - combat, initiative and time-travel, turns, tokens, hit points, conditions, roster, dice, actions, saves, annotations, character claims, and staged scenes. Reads are projected per principal; writes dispatch through the exact same validation/authorization/execution path as the built-in table UI.",
    match: (path) => path.startsWith(`${API_NAMESPACE}/game`)
  },
  {
    title: "Reference content",
    intro: "The bundled SRD 5.2.1 content (CC BY 4.0): bestiary, runnable action summaries, and condition reference.",
    match: (path) => path.startsWith(`${API_NAMESPACE}/content`)
  },
  {
    title: "Encounter archives (Time Machine)",
    intro: "Permanent, machine-readable records of ended encounters - see the archive document section above for the full v2 shape. GM-grade principals only.",
    match: (path) => path.startsWith(`${API_NAMESPACE}/encounters`)
  },
  {
    title: "Map assets & calibration",
    intro: "Uploading battlemap/regional/world images, reading their bytes, and the server-held grid-calibration wizard.",
    match: (path) => path.startsWith(`${API_NAMESPACE}/map-assets`)
  },
  {
    title: "Table viewer (second screen)",
    intro: "Pairing a shared display and driving its player-safe presentation. The viewer never authenticates with game credentials - pairing codes and an HttpOnly cookie only.",
    match: (path) => path.startsWith(`${API_NAMESPACE}/viewer`)
  },
  {
    title: "Codex (worldbuilding wiki, atlas, journal & calendar)",
    intro: "The GM-authored worldbuilding surface: typed wiki pages (with folders, tags, backlinks, relationships and revision history), the nested map atlas and its markers, the campaign journal/timeline, and the fantasy calendar - plus page media. Reads accept a GM or a player session; a player receives the revealed-only projection (GM bodies, GM fields, and unrevealed pages/maps/markers/entries are stripped server-side). Every write is GM-only.",
    match: (path) => path.startsWith(`${API_NAMESPACE}/codex`)
  }
];

const SCOPE_NOTES: Record<string, string> = {
  "system:read": "Capability discovery and the command catalog.",
  "game:read": "Game-state snapshots (GM-full or player-safe) and reference content.",
  "actor:read": "Reserved - no endpoint requires it yet.",
  "actor:write": "Roster changes, hit points, conditions, sheet imports, claims management, and token cosmetics.",
  "scene:read": "Reserved - no endpoint requires it yet.",
  "scene:write": "Preparing, editing, activating, and removing staged scenes.",
  "combat:read": "The combat log and encounter archives.",
  "combat:write": "Encounter lifecycle, initiative/timeline, turns, tokens, actions, saves, annotations.",
  "roll:create": "Dice rolls into the shared history.",
  "events:read": "Reserved for the future event stream.",
  "webhooks:manage": "Reserved for future webhooks.",
  "admin": "Every scope, including destructive operations (archive deletion). Grant sparingly."
};

const escapeCell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");

function resolveRef(ref: string): { name: string; schema: Schema } {
  const name = ref.replace("#/components/schemas/", "");
  const schema = components[name];
  if (!schema) throw new Error(`Unresolvable $ref in openApiDocument: ${ref}`);
  return { name, schema };
}

/** Compact, human-readable type label for a schema node. */
function typeLabel(schema: Schema | undefined): string {
  if (!schema) return "unknown";
  if (typeof schema.$ref === "string") return resolveRef(schema.$ref).name;
  if (Array.isArray(schema.oneOf)) return (schema.oneOf as Schema[]).map(typeLabel).join(" \\| ");
  if (schema.const !== undefined) return `const \`${JSON.stringify(schema.const)}\``;
  if (Array.isArray(schema.enum)) return (schema.enum as unknown[]).map((value) => `\`${String(value)}\``).join(" \\| ");
  const type = schema.type;
  if (Array.isArray(type)) return type.join(" \\| ");
  if (type === "array") return `${typeLabel(schema.items as Schema | undefined)}[]`;
  if (type === "object") {
    const properties = schema.properties as Record<string, Schema> | undefined;
    if (!properties) return "object (free-form)";
    return "object";
  }
  if (type === "string") {
    if (typeof schema.format === "string") return `string (${schema.format})`;
    if (typeof schema.pattern === "string") return "string (pattern)";
    return "string";
  }
  if (type === "integer" || type === "number") {
    const minimum = schema.minimum as number | undefined;
    const maximum = schema.maximum as number | undefined;
    if (minimum !== undefined && maximum !== undefined) return `${type} (${minimum}–${maximum})`;
    if (minimum !== undefined) return `${type} (≥ ${minimum})`;
    if (maximum !== undefined) return `${type} (≤ ${maximum})`;
    return type;
  }
  return typeof type === "string" ? type : "unknown";
}

function noteFor(schema: Schema): string {
  const parts: string[] = [];
  if (typeof schema.description === "string") parts.push(schema.description);
  if (schema.default !== undefined) parts.push(`Default: \`${JSON.stringify(schema.default)}\`.`);
  return escapeCell(parts.join(" "));
}

/**
 * Field rows for an object schema, flattening one level of nested objects / arrays-of-objects so
 * shapes like `entries[].actorId` and `template.shape` are fully spelled out.
 */
function fieldRows(schema: Schema, referenced: Set<string>): string[] {
  const properties = (schema.properties ?? {}) as Record<string, Schema>;
  const required = new Set((schema.required ?? []) as string[]);
  const rows: string[] = [];
  for (const [name, property] of Object.entries(properties)) {
    if (typeof property.$ref === "string") referenced.add(resolveRef(property.$ref).name);
    if (Array.isArray(property.oneOf)) for (const branch of property.oneOf as Schema[]) if (typeof branch.$ref === "string") referenced.add(resolveRef(branch.$ref).name);
    rows.push(`| \`${name}\` | ${typeLabel(property)} | ${required.has(name) ? "yes" : "no"} | ${noteFor(property)} |`);
    const nestedObject = property.type === "object" && property.properties ? property : property.type === "array" && (property.items as Schema | undefined)?.type === "object" && (property.items as Schema).properties ? (property.items as Schema) : undefined;
    if (nestedObject) {
      const prefix = property.type === "array" ? `${name}[]` : name;
      const nestedRequired = new Set((nestedObject.required ?? []) as string[]);
      for (const [nestedName, nestedProperty] of Object.entries(nestedObject.properties as Record<string, Schema>)) {
        if (typeof nestedProperty.$ref === "string") referenced.add(resolveRef(nestedProperty.$ref).name);
        rows.push(`| \`${prefix}.${nestedName}\` | ${typeLabel(nestedProperty)} | ${nestedRequired.has(nestedName) ? "yes" : "no"} | ${noteFor(nestedProperty)} |`);
      }
    }
  }
  return rows;
}

function securityLabel(operation: Operation): string {
  const security = operation.security;
  if (!security || security.length === 0) return "**Auth:** Public - no credentials required.";
  const parts = security.map((entry) => {
    if ("bearerAuth" in entry) return entry.bearerAuth.length > 0 ? `Integration credential with \`${entry.bearerAuth.join("`, `")}\`` : "Integration credential (required scope depends on the command type - see the catalog)";
    if ("gmAuth" in entry) return "GM session";
    if ("playerAuth" in entry) return "Player session (own-character limits apply)";
    if ("viewerCookieAuth" in entry) return "Paired viewer session (cookie)";
    return Object.keys(entry).join(", ");
  });
  return `**Auth:** ${parts.join(" · ")}`;
}

/** "envelope of X" for the standard success wrapper; plain name otherwise. */
function responseSchemaLabel(schema: Schema | undefined): string | null {
  if (!schema) return null;
  if (typeof schema.$ref !== "string") return typeLabel(schema);
  const { name, schema: resolved } = resolveRef(schema.$ref);
  const dataRef = ((resolved.properties as Record<string, Schema> | undefined)?.data as Schema | undefined)?.$ref;
  if (typeof dataRef === "string") return `envelope of \`${resolveRef(dataRef).name}\``;
  return `\`${name}\``;
}

function renderOperation(method: string, path: string, operation: Operation, referenced: Set<string>): string {
  const lines: string[] = [];
  lines.push(`### \`${method.toUpperCase()} ${path}\``);
  lines.push("");
  if (operation.description) { lines.push(operation.description); lines.push(""); }
  lines.push(securityLabel(operation));
  lines.push("");
  const parameters = operation.parameters ?? [];
  if (parameters.length > 0) {
    lines.push(`**Parameters:** ${parameters.map((parameter) => `\`${parameter.name}\` (${parameter.in}${parameter.required ? "" : ", optional"}) - ${typeLabel(parameter.schema)}`).join(" · ")}`);
    lines.push("");
  }
  const body = operation.requestBody;
  const jsonBody = body?.content?.["application/json"]?.schema;
  if (jsonBody) {
    const resolved = typeof jsonBody.$ref === "string" ? resolveRef(jsonBody.$ref).schema : jsonBody;
    lines.push(`**Request body** (JSON${body?.required ? "" : ", optional"}):`);
    lines.push("");
    lines.push("| Field | Type | Required | Notes |");
    lines.push("| --- | --- | --- | --- |");
    lines.push(...fieldRows(resolved, referenced));
    lines.push("");
  } else if (body) {
    const mediaTypes = Object.keys(body.content ?? {});
    lines.push(`**Request body:** raw \`${mediaTypes.join("`, `")}\` bytes${body.required ? "" : " (optional)"}.`);
    lines.push("");
  }
  const successes: string[] = [];
  const errors: string[] = [];
  for (const [code, response] of Object.entries(operation.responses)) {
    const schemaRef = response.content?.["application/json"]?.schema;
    const isError = schemaRef && typeof schemaRef.$ref === "string" && schemaRef.$ref.endsWith("ApiErrorEnvelope");
    if (code.startsWith("2") || code === "304") {
      const label = responseSchemaLabel(schemaRef);
      successes.push(`\`${code}\` ${response.description ?? ""}${label ? ` - ${label}` : ""}`);
    } else if (isError || response.$ref || code.startsWith("4") || code.startsWith("5")) {
      errors.push(`\`${code}\``);
    }
  }
  lines.push(`**Responses:** ${successes.join(" · ")}${errors.length > 0 ? ` · errors ${errors.join(" ")}` : ""}`);
  lines.push("");
  return lines.join("\n");
}

export function renderApiReference(): string {
  const referenced = new Set<string>();
  const scopes = IntegrationScopeSchema.options;
  const out: string[] = [];

  out.push(`# ${doc.info.title} - API reference (v${API_VERSION})`);
  out.push("");
  out.push("<!-- GENERATED FILE - do not edit by hand. -->");
  out.push("<!-- Rendered from packages/api-contract (the same document served at /api/v1/openapi.json). -->");
  out.push("<!-- Regenerate: npm run docs:generate -w @vtt/api-contract -->");
  out.push("");
  out.push(doc.info.description);
  out.push("");
  out.push(`- **Base path:** \`${API_NAMESPACE}\` on the LAN host (default port 3001).`);
  out.push(`- **Machine-readable contract:** \`GET ${OPENAPI_DOCUMENT_PATH}\` serves the OpenAPI 3.1 document this reference is generated from, byte-identical to \`@vtt/api-contract\`.`);
  out.push(`- **Realtime sibling:** the built-in clients drive the same commands over Socket.IO (protocol version ${REALTIME_PROTOCOL_VERSION}); command \`type\` strings below are shared between both transports.`);
  out.push("- **Webhooks / server push:** not part of v1 core yet - poll with ETags (below).");
  out.push("");

  out.push("## Authentication");
  out.push("");
  out.push("Every request authenticates with `Authorization: Bearer <token>` (the viewer's cookie is the one exception). Three principal kinds exist:");
  out.push("");
  out.push("| Principal | Token | Authority |");
  out.push("| --- | --- | --- |");
  out.push("| **GM session** | from `POST /api/gm/login` (GM password; same-origin only) | Everything, including credential management. |");
  out.push("| **Player session** | issued when a player joins the table | Exactly the table's player limits: player-safe projections, own claimed character only. |");
  out.push("| **Integration credential** | `vtt_int_…`, minted by the GM (below) | GM authority, filtered by the credential's scopes. Rotatable, revocable, audited. |");
  out.push("");
  out.push("### Scopes");
  out.push("");
  out.push("| Scope | Grants |");
  out.push("| --- | --- |");
  for (const scope of scopes) out.push(`| \`${scope}\` | ${escapeCell(SCOPE_NOTES[scope] ?? "Reserved for a future surface.")} |`);
  out.push("");

  out.push("## Conventions");
  out.push("");
  out.push(`- **Envelopes.** Success: \`{ "ok": true, "apiVersion": "${API_VERSION}", "data": … }\`. Failure: \`{ "ok": false, "apiVersion": "${API_VERSION}", "error": { "code", "message", "requestId", "details"?, "currentRevision"?, "retryAfterSeconds"? } }\`.`);
  out.push("- **Request IDs.** Send `X-Request-Id` (UUID) to correlate; the server echoes it (minting one otherwise) on the response header and in error bodies.");
  out.push("- **Idempotency.** Every write accepts `commandId` (UUID). The server executes each commandId exactly once; retries replay the stored outcome with `duplicate: true`. Omitted ids are minted server-side and echoed - supply your own whenever you might need to retry.");
  out.push("- **Optimistic concurrency.** Pass `expectedRevision` to reject writes against a state you haven't seen; a stale value returns `409` with `error.currentRevision`.");
  out.push("- **Error statuses.** `400 validation_failed` (malformed request, `details.issues`), `401 unauthenticated` (no token), `403 forbidden` (invalid/revoked/underscoped token, or a role denial), `404 not_found`, `409 conflict` for everything the game itself refuses - rule rejections, stale revisions, and timeline confirmations (`details.needsConfirm`: resend with `confirmRewrite`/`confirmDiscard`), `413` oversized body (limit 512kb).");
  out.push("- **Polling.** `GET /game` sends a weak ETag derived from the revision; send `If-None-Match` to get free `304`s. Presence and timed-annotation expiry don't bump the revision - re-fetch when you need those fresh.");
  out.push("- **CORS.** Wide open on `/api/v1` (bearer-only surface), so browser-based overlays can call it directly. The legacy same-origin endpoints (`/api/gm/login` etc.) deliberately have no CORS.");
  out.push("");

  out.push("## Command catalog");
  out.push("");
  out.push("Every command is reachable two ways with identical semantics: its **typed route** (below) or the **generic tunnel** `POST /game/commands` with `{ \"type\", \"payload\", \"commandId\"?, \"expectedRevision\"? }`. `GET /game/commands` serves this catalog with live summaries. Scopes bind to the command, not the transport:");
  out.push("");
  out.push("| Command type | Required scope |");
  out.push("| --- | --- |");
  for (const [type, scope] of Object.entries(GAME_COMMAND_SCOPES)) out.push(`| \`${type}\` | \`${scope}\` |`);
  out.push("");

  out.push("## Encounter archive document (`archiveSchemaVersion` 2)");
  out.push("");
  out.push("`GET /encounters/{id}` returns `data.document`, the permanent Time Machine record of one ended fight, stored verbatim at `encounter.end` in the same transaction that closes the encounter:");
  out.push("");
  out.push("- `startedAt` / `endedAt` (ISO 8601) and `turnCount`.");
  out.push("- `turns[]` - `{ index, kind: \"turn\"|\"return\", label, revision, at, state }`: one **full GameState** per turn boundary.");
  out.push("- `log[]` - the fight's timestamped combat-log slice (`{ id, at, kind, text, gmOnly, revision }`), GM-only lines included.");
  out.push("- `journal[]` - **every accepted command while the fight was live**, `encounter.start` through `encounter.end` inclusive: `{ seq, commandId, type, actorId, principal, payload, revision, at }`. `principal` is `gm:<sessionId>`, `player:<sessionId>`, or `integration:<credentialId>`.");
  out.push("- `finalState` - the last live GameState, captured just before ending cleared the fight.");
  out.push("- `rolls[]` - every dice roll seen across the fight (survives the live state's rolling 200-roll cap).");
  out.push("- `definitions[]` - `{ id, source: \"imported\"|\"bundled\", definition }`: the full stat blocks the fight used, making the document self-contained.");
  out.push("- `attribution` - the CC BY 4.0 line when bundled SRD content is included, else `null`.");
  out.push("");
  out.push("`turns`, `log`, and `journal` join on `revision` - align \"what the state was\" with \"what was commanded\" and \"what was narrated\". Archives are GM-grade only (full state, hidden combatants included) and never reach player sessions.");
  out.push("");

  out.push("## Quick start");
  out.push("");
  out.push("```bash");
  out.push("# 1. GM signs in (same-origin) and mints a scoped credential - the token is shown exactly once.");
  out.push("GM=$(curl -s -X POST http://host:3001/api/gm/login -H 'content-type: application/json' \\");
  out.push("  -d '{\"password\":\"…\"}' | jq -r .token)");
  out.push("TOKEN=$(curl -s -X POST http://host:3001/api/v1/gm/integration-credentials \\");
  out.push("  -H \"Authorization: Bearer $GM\" -H 'content-type: application/json' \\");
  out.push("  -d '{\"name\":\"my bot\",\"scopes\":[\"system:read\",\"game:read\",\"combat:read\",\"combat:write\",\"actor:write\",\"roll:create\"]}' | jq -r .data.token)");
  out.push("");
  out.push("# 2. Discover, read, act.");
  out.push("curl -s http://host:3001/api/v1/system/capabilities -H \"Authorization: Bearer $TOKEN\"");
  out.push("curl -s http://host:3001/api/v1/game -H \"Authorization: Bearer $TOKEN\"");
  out.push("curl -s -X POST http://host:3001/api/v1/game/rolls -H \"Authorization: Bearer $TOKEN\" \\");
  out.push("  -H 'content-type: application/json' -d '{\"formula\":\"2d20kh1+7\",\"purpose\":\"attack\",\"visibility\":\"public\"}'");
  out.push("");
  out.push("# 3. Same command via the generic tunnel.");
  out.push("curl -s -X POST http://host:3001/api/v1/game/commands -H \"Authorization: Bearer $TOKEN\" \\");
  out.push("  -H 'content-type: application/json' \\");
  out.push("  -d '{\"type\":\"actor.apply-damage\",\"payload\":{\"actorId\":\"<uuid>\",\"amount\":5}}'");
  out.push("```");
  out.push("");

  for (const group of GROUPS) {
    const paths = Object.entries(doc.paths).filter(([path]) => group.match(path));
    if (paths.length === 0) continue;
    out.push(`## ${group.title}`);
    out.push("");
    out.push(group.intro);
    out.push("");
    for (const [path, operations] of paths) {
      for (const method of METHOD_ORDER) {
        const operation = operations[method];
        if (operation) out.push(renderOperation(method, path, operation, referenced));
      }
    }
  }

  // Shared shapes referenced from request bodies, so field tables above stay self-contained.
  const shared = [...referenced].filter((name) => !name.endsWith("Request") && !name.endsWith("Response") && !name.endsWith("Envelope")).sort();
  if (shared.length > 0) {
    out.push("## Shared shapes");
    out.push("");
    for (const name of shared) {
      const schema = components[name];
      out.push(`### \`${name}\``);
      out.push("");
      if (typeof schema.description === "string") { out.push(schema.description); out.push(""); }
      if (schema.properties) {
        out.push("| Field | Type | Required | Notes |");
        out.push("| --- | --- | --- | --- |");
        out.push(...fieldRows(schema, new Set()));
        out.push("");
      }
    }
  }

  out.push("---");
  out.push("");
  out.push(`*Generated from \`@vtt/api-contract\` (API v${API_VERSION}). The served \`${OPENAPI_DOCUMENT_PATH}\` is always the authoritative machine contract.*`);
  out.push("");
  return out.join("\n");
}
