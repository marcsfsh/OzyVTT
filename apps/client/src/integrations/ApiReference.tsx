import { useEffect, useState } from "react";
import { Button, IconDownload, SegmentedControl } from "@vtt/ui";
import { apiRequest, jsonRequest } from "../lib/api";
import { EndpointDetails } from "./EndpointDetails";
import {
  exportSpec,
  GROUPS,
  LANGUAGES,
  METHOD_ORDER,
  ungrouped,
  type CatalogCommand,
  type Language,
  type OpenApiDocument
} from "./openapi-model";
import "./api-reference.css";

/**
 * The API reference, fetched live from the running server (the OpenAPI document at
 * /api/v1/openapi.json and the command catalog), so it cannot drift from what the server exposes.
 * Each endpoint expands to its full spec, resolved from the document's own component schemas.
 */

/**
 * Two presentations, one body: the Settings page's `<details>` disclosure, and `/settings/api`
 * (GM-only), the same content at full pane width. Opening that address in a new tab asks for the GM
 * password once: the GM token is memory-only, and every alternative (URL, localStorage,
 * `postMessage`) copies a credential somewhere it should not go.
 * Known limitation: it is a very long page with no navigation (no table of contents or filter).
 */
const API_REFERENCE_PATH = "/settings/api";

function ApiReferenceBody({ gmToken }: Readonly<{ gmToken: string }>) {
  const [state, setState] = useState<{
    status: "loading" | "ready" | "error";
    document: OpenApiDocument | null;
    commands: readonly CatalogCommand[];
    message: string;
  }>({ status: "loading", document: null, commands: [], message: "" });
  const [language, setLanguage] = useState<Language>("shell");

  /** Bumped by Retry; each value is one load. */
  const [attempt, setAttempt] = useState(0);

  /** Fetched on mount: both presentations mount this body only when it is about to be read. */
  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, status: "loading", message: "" }));
    Promise.all([
      jsonRequest<OpenApiDocument>("/api/v1/openapi.json"),
      // The catalog is an extra; without it the reference still shows every path.
      apiRequest<{ commands?: readonly CatalogCommand[] }>("/api/v1/game/commands", { token: gmToken }).catch(() => ({
        commands: []
      }))
    ])
      .then(([document, catalog]) => {
        if (!cancelled) setState({ status: "ready", document, commands: catalog.commands ?? [], message: "" });
      })
      .catch(() => {
        if (!cancelled)
          setState({
            status: "error",
            document: null,
            commands: [],
            message: "The reference could not be loaded from the server."
          });
      });
    return () => {
      cancelled = true;
    };
  }, [gmToken, attempt]);

  const document = state.document;
  const components = document?.components?.schemas ?? {};
  const origin = window.location.origin;
  const operationCount = document
    ? Object.values(document.paths).reduce((total, operations) => total + Object.keys(operations).length, 0)
    : 0;

  return (
    <>
      <div className="api-reference-body">
        <p className="api-reference-intro">
          Base URL: <code>{origin}/api/v1</code> · Authenticate with <code>Authorization: Bearer &lt;token&gt;</code> -
          a credential from above, your GM session, or a player session.
          {/* `.tap-target` grows the link's hit area to the floor; the paragraph has no other control. */}
          The machine-readable contract lives at{" "}
          <a className="tap-target" href="/api/v1/openapi.json" target="_blank" rel="noreferrer">
            /api/v1/openapi.json
          </a>
          .
        </p>
        {/* The idempotency and revision rules come from the served contract's description, never restated
          here, so they cannot diverge per surface. */}
        {document?.info.description && <p className="api-reference-intro">{document.info.description}</p>}
        {state.status === "loading" && <p>Loading the contract…</p>}
        {state.status === "error" && (
          <p className="api-reference-error">
            {state.message}{" "}
            <Button variant="ghost" onClick={() => setAttempt((count) => count + 1)}>
              Retry
            </Button>
          </p>
        )}
        {document && (
          <>
            <div className="api-reference-toolbar">
              <div className="api-lang-tabs">
                <span className="api-lang-label">Language</span>
                <SegmentedControl
                  ariaLabel="Example request language"
                  size="sm"
                  value={language}
                  onChange={(value) => setLanguage(value as typeof language)}
                  options={LANGUAGES.map((entry) => ({ value: entry.id, label: entry.label }))}
                />
              </div>
              <Button
                variant="secondary"
                className="api-export-spec"
                onClick={() => exportSpec(document)}
                title="Download the full OpenAPI 3.1 document for Postman, openapi-generator or any other OpenAPI tool."
              >
                <IconDownload /> Export OpenAPI spec
              </Button>
            </div>
            <p className="api-reference-count">
              {operationCount} operations across {Object.keys(document.paths).length} paths. Example values are made up.
              Real ids come from the game state.
            </p>
            {GROUPS.map((group) => {
              const paths = Object.entries(document.paths).filter(([path]) => group.match(path));
              if (paths.length === 0) return null;
              return (
                <section key={group.title} className="api-reference-group">
                  <h3>{group.title}</h3>
                  <div className="api-endpoint-list">
                    {paths.flatMap(([path, operations]) =>
                      METHOD_ORDER.filter((method) => operations[method]).map((method) => (
                        <EndpointDetails
                          key={`${method} ${path}`}
                          method={method}
                          path={path}
                          operation={operations[method]}
                          components={components}
                          origin={origin}
                          language={language}
                        />
                      ))
                    )}
                  </div>
                </section>
              );
            })}
            {(() => {
              const rest = ungrouped(Object.keys(document.paths));
              if (rest.length === 0) return null;
              return (
                <section className="api-reference-group">
                  <h3>Other</h3>
                  <div className="api-endpoint-list">
                    {rest.flatMap((path) =>
                      METHOD_ORDER.filter((method) => document.paths[path][method]).map((method) => (
                        <EndpointDetails
                          key={`${method} ${path}`}
                          method={method}
                          path={path}
                          operation={document.paths[path][method]!}
                          components={components}
                          origin={origin}
                          language={language}
                        />
                      ))
                    )}
                  </div>
                </section>
              );
            })()}
            {state.commands.length > 0 && (
              <section className="api-reference-group">
                <h3>
                  Command catalog (typed routes + the <code>POST /game/commands</code> tunnel)
                </h3>
                <table className="api-command-table">
                  <thead>
                    <tr>
                      <th>Command type</th>
                      <th>Scope</th>
                      <th>What it does</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.commands.map((command) => (
                      <tr key={command.type}>
                        <td>
                          <code>{command.type}</code>
                        </td>
                        <td>
                          <code>{command.scope}</code>
                        </td>
                        <td>{command.summary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** The Settings-page presentation: the disclosure plus the link to the full-page address. */
export function ApiReference({ gmToken }: Readonly<{ gmToken: string }>) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="api-reference"
      open={open}
      onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
    >
      <summary>
        <strong>API reference</strong>
        <span>Every endpoint this server exposes, read from its own contract. Open one for its full spec.</span>
      </summary>
      {/* Mounted only while open, so the fetch happens on first open, not every Settings visit. */}
      {open && <ApiReferenceBody gmToken={gmToken} />}
    </details>
  );
}

/**
 * `/settings/api`: the reference at its own address, full width. A heading row with the two doors
 * over one scrolling region. "Open in a new tab" is a plain `target="_blank"` link; the new tab asks
 * for the GM password rather than receiving a copied credential.
 */
export function ApiReferencePage({ gmToken, onBack }: Readonly<{ gmToken: string; onBack: () => void }>) {
  return (
    <section
      className="api-reference-page pane-frame pane-scene scanlines frame-col anim-view"
      aria-label="API reference"
    >
      <div className="pane-sky" aria-hidden="true" />
      <div className="api-reference-page-head neon-beam">
        <h2>API reference</h2>
        <div className="api-reference-page-actions">
          <Button variant="ghost" onClick={onBack}>
            Back to Settings
          </Button>
          <Button
            variant="secondary"
            title="The new tab asks for the GM password once and never stores the GM token."
            onClick={() => window.open(API_REFERENCE_PATH, "_blank", "noopener")}
          >
            Open in a new tab
          </Button>
        </div>
      </div>
      <div className="api-reference-page-body scroll-y frame-fill">
        <ApiReferenceBody gmToken={gmToken} />
      </div>
    </section>
  );
}
