import { useEffect, useId, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Chip,
  IconDownload,
  Input,
  SegmentedControl,
  Skeleton,
  Dropdown,
  FilterChips,
  FilterFlyout,
  FiltersButton,
  SortDialog,
  type SortLevelOf
} from "@vtt/ui";
import { apiRequest, jsonRequest } from "../lib/api";
import { useMediaQuery } from "../lib/useMediaQuery";
import { SettingsPrimary } from "../settings/SettingRow";
import {
  CALLER_WORDS,
  DEFAULT_SORT,
  NO_FILTERS,
  operationRows,
  SORT_WORDS,
  tagsOf,
  visibleRows,
  type ApiFilters,
  type ApiSortKey,
  type Caller
} from "./api-rows";
import { OperationDocument } from "./OperationDocument";
import { exportSpec, METHOD_ORDER, type CatalogCommand, type OpenApiDocument } from "./openapi-model";
import "./api-reference.css";

/**
 * The API reference, read live from the running server (the OpenAPI document at /api/v1/openapi.json and the command
 * catalog), so it can't drift from what the server answers. Operations are a table under a Tag dropdown, filters
 * that fly out and a sort by several columns; an operation opens as one document beside its metadata, at its own
 * address. The commands that the live-game tunnel takes are a second table.
 */

function MethodMark({ method }: Readonly<{ method: string }>) {
  return <code className={`api-method api-method-${method}`}>{method.toUpperCase()}</code>;
}

export function ApiReference({
  gmToken,
  openKey,
  onOpen,
  onClose
}: Readonly<{
  gmToken: string;
  /** The operation open at this address, or null for the table. */
  openKey: string | null;
  onOpen: (key: string) => void;
  onClose: () => void;
}>) {
  const [state, setState] = useState<{
    status: "loading" | "ready" | "error";
    document: OpenApiDocument | null;
    commands: readonly CatalogCommand[];
  }>({ status: "loading", document: null, commands: [] });
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<"operations" | "commands">("operations");
  const [filters, setFilters] = useState<ApiFilters>(NO_FILTERS);
  const [sort, setSort] = useState<readonly SortLevelOf<ApiSortKey>[]>(DEFAULT_SORT);
  const [sorting, setSorting] = useState(false);
  const [flyout, setFlyout] = useState(false);
  const flyoutId = useId();
  const phone = useMediaQuery("(max-width: 650px)");

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, status: "loading" }));
    Promise.all([
      jsonRequest<OpenApiDocument>("/api/v1/openapi.json"),
      // The catalog is an extra; without it the reference still shows every operation.
      apiRequest<{ commands?: readonly CatalogCommand[] }>("/api/v1/game/commands", { token: gmToken }).catch(() => ({
        commands: []
      }))
    ])
      .then(([document, catalog]) => {
        if (!cancelled) setState({ status: "ready", document, commands: catalog.commands ?? [] });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", document: null, commands: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [gmToken, attempt]);

  const document = state.document;
  const rows = useMemo(() => (document ? operationRows(document) : []), [document]);
  const tags = useMemo(() => tagsOf(rows), [rows]);
  const scopes = useMemo(() => [...new Set(rows.flatMap((row) => row.scopes))].sort(), [rows]);
  const shown = useMemo(() => visibleRows(rows, filters, sort), [rows, filters, sort]);
  const open = openKey ? rows.find((row) => row.key === openKey) : undefined;
  const set = (patch: Partial<ApiFilters>) => setFilters((current) => ({ ...current, ...patch }));
  const filterCount = filters.methods.length + filters.callers.length + filters.scopes.length;

  const primary = document && (
    <SettingsPrimary>
      <Button
        variant="primary"
        onClick={() => exportSpec(document)}
        title="The full OpenAPI 3.1 document, for Postman, openapi-generator or any other OpenAPI tool."
      >
        <IconDownload /> Download OpenAPI
      </Button>
    </SettingsPrimary>
  );

  if (state.status === "error")
    return (
      <div className="api-reference">
        <Alert tone="danger" title="The reference didn't load">
          The server didn't send its API document. Check that it is running, then try again.
        </Alert>
        <Button variant="secondary" onClick={() => setAttempt((count) => count + 1)}>
          Try again
        </Button>
      </div>
    );
  if (!document)
    return (
      <div className="api-reference" aria-busy="true">
        <Skeleton variant="text" />
        <Skeleton variant="text" />
        <Skeleton variant="text" />
      </div>
    );

  if (openKey)
    return (
      <div className="api-reference">
        {primary}
        {open ? (
          <div className="api-results scroll-y">
            <OperationDocument
              row={open}
              components={document.components?.schemas ?? {}}
              origin={window.location.origin}
              onBack={onClose}
            />
          </div>
        ) : (
          <>
            <Alert tone="info" title="No such operation">
              This server has no operation called {openKey}.
            </Alert>
            <Button variant="secondary" onClick={onClose}>
              All operations
            </Button>
          </>
        )}
      </div>
    );

  const tagsOn = filters.tags ?? tags;
  const tagMenu = (
    <Dropdown
      label={filters.tags ? `Tags: ${filters.tags.length} of ${tags.length}` : `Tags: all ${tags.length}`}
      panelClassName="api-tagmenu scroll-y"
    >
      {() => (
        <>
          <div className="nh-dropdown-row">
            <Button size="sm" variant="ghost" onClick={() => set({ tags: null })}>
              Select all
            </Button>
            <Button size="sm" variant="ghost" onClick={() => set({ tags: [] })}>
              Clear
            </Button>
          </div>
          {tags.map((tag) => (
            <label key={tag} className="nh-check">
              <input
                type="checkbox"
                checked={tagsOn.includes(tag)}
                onChange={(event) => {
                  const next = event.target.checked ? [...tagsOn, tag] : tagsOn.filter((other) => other !== tag);
                  set({ tags: next.length === tags.length ? null : tags.filter((other) => next.includes(other)) });
                }}
              />
              {tag}
            </label>
          ))}
        </>
      )}
    </Dropdown>
  );

  const chips = [
    ...filters.methods.map((method) => ({
      key: `m-${method}`,
      words: `Method: ${method.toUpperCase()}`,
      remove: () => set({ methods: filters.methods.filter((other) => other !== method) })
    })),
    ...filters.callers.map((caller) => ({
      key: `c-${caller}`,
      words: `Who can call: ${CALLER_WORDS[caller]}`,
      remove: () => set({ callers: filters.callers.filter((other) => other !== caller) })
    })),
    ...filters.scopes.map((scope) => ({
      key: `s-${scope}`,
      words: `Scope: ${scope}`,
      remove: () => set({ scopes: filters.scopes.filter((other) => other !== scope) })
    }))
  ];

  return (
    <div className="api-reference">
      {primary}
      <details className="api-intro">
        <summary>How to call this API</summary>
        <p>
          The base address is <code>{window.location.origin}/api/v1</code>. Send{" "}
          <code>Authorization: Bearer &lt;token&gt;</code> with a credential from Access, your GM session or a player
          session. The document itself is at{" "}
          <a className="tap-target" href="/api/v1/openapi.json" target="_blank" rel="noreferrer">
            /api/v1/openapi.json
          </a>
          .
        </p>
        {/* The idempotency and revision rules come from the served contract's description, never restated here. */}
        {document.info.description && <p>{document.info.description}</p>}
        <p>Example values are made up. Real ids come from the game state.</p>
      </details>
      <div className="cx-sub api-toolbar">
        <SegmentedControl
          size="sm"
          ariaLabel="Show"
          value={view}
          onChange={(value) => setView(value as typeof view)}
          options={[
            { value: "operations", label: "Operations" },
            { value: "commands", label: "Commands" }
          ]}
        />
        <Input
          type="search"
          className="api-find"
          aria-label={view === "operations" ? "Find an operation" : "Find a command"}
          placeholder={view === "operations" ? "Find a path or summary" : "Find a command"}
          value={filters.text}
          onChange={(event) => set({ text: event.target.value })}
        />
        {view === "operations" && (
          <>
            {tagMenu}
            <FiltersButton
              open={flyout}
              onToggle={() => setFlyout((current) => !current)}
              controls={flyoutId}
              count={filterCount}
            />
            <Button size="sm" aria-haspopup="dialog" onClick={() => setSorting(true)}>
              {`Sort: ${sort.map((level) => SORT_WORDS[level.key]).join(", then ")}`}
            </Button>
          </>
        )}
        <span className="cx-grow" />
        <span className="api-count" role="status">
          {view === "operations" ? `${shown.length} of ${rows.length} operations` : `${state.commands.length} commands`}
        </span>
        {!phone && (
          <Button
            size="sm"
            variant="ghost"
            title="The new tab asks for the GM password once and never stores the GM token."
            onClick={() => window.open(window.location.pathname, "_blank", "noopener")}
          >
            Open in a new tab
          </Button>
        )}
      </div>
      {view === "operations" && chips.length > 0 && (
        <div className="api-chips" aria-label="Filters on">
          {chips.map((chip) => (
            <Chip key={chip.key} onRemove={chip.remove} removeLabel={`Remove ${chip.words}`}>
              {chip.words}
            </Chip>
          ))}
          <Button size="sm" variant="ghost" onClick={() => set({ methods: [], callers: [], scopes: [] })}>
            Clear filters
          </Button>
        </div>
      )}

      <div className="api-results scroll-y">
        {view === "commands" ? (
          <CommandsTable commands={state.commands} text={filters.text} phone={phone} />
        ) : shown.length === 0 ? (
          <p className="settings-empty">No operation matches. Change the words, the tags or the filters.</p>
        ) : phone ? (
          <ul className="api-list" aria-label="Operations">
            {shown.map((row) => (
              <li key={row.key}>
                <button type="button" className="api-list-row" onClick={() => onOpen(row.key)}>
                  <span className="api-list-route">
                    <MethodMark method={row.method} />
                    <code className="api-path">{row.path}</code>
                  </span>
                  <span className="api-list-summary">{row.summary}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <table className="cx-table api-table">
            <thead>
              <tr>
                <th scope="col">Method</th>
                <th scope="col">Path</th>
                <th scope="col">Summary</th>
                <th scope="col">Tag</th>
                <th scope="col">Who can call</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.key} className="cx-row" onClick={() => onOpen(row.key)}>
                  <td>
                    <MethodMark method={row.method} />
                  </td>
                  <td>
                    <button type="button" className="cx-rowlink api-path" onClick={() => onOpen(row.key)}>
                      {row.path}
                    </button>
                  </td>
                  <td className="api-col-summary">{row.summary}</td>
                  <td>{row.tag}</td>
                  <td className="api-col-callers">
                    {row.callers.map((caller) => CALLER_WORDS[caller]).join(" · ")}
                    {row.scopes.length > 0 && <span className="api-scopes"> · {row.scopes.join(", ")}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <FilterFlyout id={flyoutId} open={flyout} title="Filters" onClose={() => setFlyout(false)}>
        <span className="settings-subhead">Method</span>
        <FilterChips
          label="Method"
          options={METHOD_ORDER.filter((method) => rows.some((row) => row.method === method)).map((method) => ({
            value: method,
            label: method.toUpperCase()
          }))}
          selected={filters.methods}
          onChange={(methods) => set({ methods })}
        />
        <span className="settings-subhead">Who can call</span>
        <FilterChips
          label="Who can call"
          options={(Object.keys(CALLER_WORDS) as Caller[]).map((caller) => ({
            value: caller,
            label: CALLER_WORDS[caller]
          }))}
          selected={filters.callers}
          onChange={(callers) => set({ callers: callers as Caller[] })}
        />
        {scopes.length > 0 && (
          <>
            <span className="settings-subhead">Scope</span>
            <FilterChips
              label="Scope"
              options={scopes.map((scope) => ({ value: scope, label: scope }))}
              selected={filters.scopes}
              onChange={(next) => set({ scopes: next })}
            />
          </>
        )}
      </FilterFlyout>
      {sorting && (
        <SortDialog
          levels={sort}
          keys={["tag", "path", "method", "operation"] as const}
          keyLabel={(key) => SORT_WORDS[key]}
          firstDirection={() => "asc"}
          directionLabel={(key, direction) =>
            key === "method"
              ? direction === "asc"
                ? "GET first"
                : "DELETE first"
              : direction === "asc"
                ? "A to Z"
                : "Z to A"
          }
          onCancel={() => setSorting(false)}
          onSort={(levels) => {
            setSort(levels);
            setSorting(false);
          }}
        />
      )}
    </div>
  );
}

/** The command catalog: the commands the live-game tunnel takes, with the scope each needs. */
function CommandsTable({
  commands,
  text,
  phone
}: Readonly<{ commands: readonly CatalogCommand[]; text: string; phone: boolean }>) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = commands.filter((command) =>
    words.every((word) => `${command.type} ${command.scope} ${command.summary}`.toLowerCase().includes(word))
  );
  if (commands.length === 0)
    return <p className="settings-empty">The server sent no command catalog, so only the operations are listed.</p>;
  if (shown.length === 0) return <p className="settings-empty">No command matches those words.</p>;
  return phone ? (
    <ul className="api-list" aria-label="Commands">
      {shown.map((command) => (
        <li key={command.type} className="api-list-row is-static">
          <span className="api-list-route">
            <code className="api-path">{command.type}</code>
          </span>
          <span className="api-list-summary">
            {command.summary} · <code>{command.scope}</code>
          </span>
        </li>
      ))}
    </ul>
  ) : (
    <table className="cx-table api-table">
      <thead>
        <tr>
          <th scope="col">Command</th>
          <th scope="col">Scope</th>
          <th scope="col">What it does</th>
        </tr>
      </thead>
      <tbody>
        {shown.map((command) => (
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
  );
}
