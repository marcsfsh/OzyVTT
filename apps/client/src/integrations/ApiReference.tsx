import { useState } from "react";
import "./api-reference.css";

/**
 * Collapsible, always-current API reference for the VTT Setup page. Everything shown is fetched
 * from the running server itself — the byte-identical OpenAPI document at /api/v1/openapi.json and
 * the live command catalog — so this section can never drift from what the server actually exposes.
 */

type Operation = Readonly<{
  description?: string;
  security?: ReadonlyArray<Record<string, readonly string[]>>;
}>;
type OpenApiDocument = Readonly<{
  info: { title: string; description?: string };
  paths: Record<string, Record<string, Operation>>;
}>;
type CatalogCommand = Readonly<{ type: string; scope: string; summary: string }>;

const METHOD_ORDER = ["get", "post", "put", "patch", "delete"] as const;

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
  const operationCount = document ? Object.values(document.paths).reduce((total, operations) => total + Object.keys(operations).length, 0) : 0;

  return <details className="api-reference" onToggle={(event) => { if ((event.target as HTMLDetailsElement).open) load(); }}>
    <summary><strong>API reference</strong><span>Every endpoint this server exposes, straight from its own contract.</span></summary>
    <div className="api-reference-body">
      <p className="api-reference-intro">
        Base URL: <code>{window.location.origin}/api/v1</code> · Authenticate with <code>Authorization: Bearer &lt;token&gt;</code> — a credential from above, your GM session, or a player session.
        Writes accept an optional <code>commandId</code> (resend it to retry safely) and <code>expectedRevision</code>.
        The machine-readable contract lives at <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer">/api/v1/openapi.json</a>; a full generated write-up ships in the repo at <code>docs/api-reference.md</code>.
      </p>
      {state.status === "loading" && <p>Loading the contract…</p>}
      {state.status === "error" && <p className="api-reference-error">{state.message} <button className="link" onClick={load}>Retry</button></p>}
      {document && <>
        <p className="api-reference-count">{operationCount} operations across {Object.keys(document.paths).length} paths.</p>
        {GROUPS.map((group) => {
          const paths = Object.entries(document.paths).filter(([path]) => group.match(path));
          if (paths.length === 0) return null;
          return <section key={group.title} className="api-reference-group">
            <h3>{group.title}</h3>
            <ul>
              {paths.flatMap(([path, operations]) => METHOD_ORDER.filter((method) => operations[method]).map((method) => {
                const operation = operations[method];
                return <li key={`${method} ${path}`}>
                  <div className="api-reference-route"><code className={`api-method api-method-${method}`}>{method.toUpperCase()}</code><code className="api-path">{path}</code>
                    <span className="api-auth">{authChips(operation).map((chip) => <em key={chip}>{chip}</em>)}</span>
                  </div>
                  {operation.description && <p>{operation.description}</p>}
                </li>;
              }))}
            </ul>
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
