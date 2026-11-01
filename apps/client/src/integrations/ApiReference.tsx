import { useEffect, useId, useMemo, useState } from "react";
import { GAME_COMMANDS } from "@vtt/api-contract";
import {
  Alert,
  Button,
  Chip,
  IconChevronRight,
  IconDownload,
  Skeleton,
  Dropdown,
  FilterChips,
  FilterFlyout,
  FiltersButton,
  SortDialog,
  type SortLevelOf,
  IconSort,
  FindField
} from "@vtt/ui";
import { apiRequest, jsonRequest } from "../lib/api";
import { useMediaQuery } from "../lib/useMediaQuery";
import { SettingsPrimary } from "../settings/SettingRow";
import {
  CALLER_WORDS,
  commandsByOperation,
  DEFAULT_SORT,
  NO_FILTERS,
  operationRows,
  SORT_WORDS,
  tagsOf,
  visibleRows,
  type ApiFilters,
  type ApiSortKey,
  type Caller,
  type OperationRow
} from "./api-rows";
import { OperationDocument } from "./OperationDocument";
import { exportSpec, METHOD_ORDER, type CatalogCommand, type OpenApiDocument } from "./openapi-model";
import "./api-reference.css";

/**
 * The API reference, read live from the running server (the OpenAPI document at /api/v1/openapi.json and the command
 * catalog), so it can't drift from what the server answers. Each tag is a group of Settings' rows (I leftovers spec
 * 2.1): the method and summary, the path, the command the live-game tunnel takes for it or No command, and who can
 * call it. The field finds a path, a summary or a command; Tags, Filters and Sort narrow and order the rows. An
 * operation opens as one document at its own address.
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
  const commands = useMemo(() => commandsByOperation(rows, state.commands, GAME_COMMANDS), [rows, state.commands]);
  const shown = useMemo(() => visibleRows(rows, filters, sort, commands), [rows, filters, sort, commands]);
  // Groups in the order the sorted rows first meet them.
  const groups = useMemo(() => {
    const byTag = new Map<string, OperationRow[]>();
    for (const row of shown) byTag.set(row.tag, [...(byTag.get(row.tag) ?? []), row]);
    return [...byTag.entries()];
  }, [shown]);
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
              command={commands.get(open.key) ?? null}
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
            <Button size="sm" onClick={() => set({ tags: null })}>
              Select all
            </Button>
            <Button size="sm" onClick={() => set({ tags: [] })}>
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
        <FindField
          className="api-find"
          aria-label="Find an operation"
          placeholder="Find a path, a summary or a command"
          value={filters.text}
          onChange={(event) => set({ text: event.target.value })}
        />
        {tagMenu}
        <FiltersButton
          open={flyout}
          onToggle={() => setFlyout((current) => !current)}
          controls={flyoutId}
          count={filterCount}
        />
        <Button
          size="sm"
          aria-haspopup="dialog"
          aria-label={`Sort: ${sort.map((level) => SORT_WORDS[level.key]).join(", then ")}`}
          onClick={() => setSorting(true)}
        >
          <IconSort /> {sort.map((level) => SORT_WORDS[level.key]).join(", then ")}
        </Button>
        <span className="cx-grow" />
        <span className="api-count" role="status">
          {`${shown.length} of ${rows.length} operations`}
        </span>
        {!phone && (
          <Button
            size="sm"

            title="The new tab asks for the GM password once and never stores the GM token."
            onClick={() => window.open(window.location.pathname, "_blank", "noopener")}
          >
            Open in a new tab
          </Button>
        )}
      </div>
      {chips.length > 0 && (
        <div className="api-chips" aria-label="Filters on">
          {chips.map((chip) => (
            <Chip key={chip.key} onRemove={chip.remove} removeLabel={`Remove ${chip.words}`}>
              {chip.words}
            </Chip>
          ))}
          <Button size="sm" onClick={() => set({ methods: [], callers: [], scopes: [] })}>
            Clear filters
          </Button>
        </div>
      )}

      <div className="api-results scroll-y">
        {shown.length === 0 ? (
          <p className="settings-empty">No operation matches. Change the words, the tags or the filters.</p>
        ) : (
          groups.map(([tag, members]) => (
            <section key={tag} className="api-group" aria-label={tag}>
              <h3 className="api-group-head">
                <span className="api-group-name">{tag}</span>
                <span className="api-group-count">{members.length}</span>
              </h3>
              <ul className="api-rows">
                {members.map((row) => (
                  <OperationRowView key={row.key} row={row} command={commands.get(row.key) ?? null} onOpen={onOpen} />
                ))}
              </ul>
            </section>
          ))
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

/**
 * One operation as Settings' row: the method and summary, the path under them, then at the right the command the
 * live-game tunnel takes for it (or No command), who can call it and the arrow to its page.
 */
function OperationRowView({
  row,
  command,
  onOpen
}: Readonly<{ row: OperationRow; command: string | null; onOpen: (key: string) => void }>) {
  return (
    <li>
      <button
        type="button"
        className="api-row"
        aria-label={`${row.summary}, ${row.method.toUpperCase()} ${row.path}`}
        onClick={() => onOpen(row.key)}
      >
        <span className="api-row-main">
          <span className="api-row-title">
            <MethodMark method={row.method} />
            <span className="api-row-summary">{row.summary}</span>
          </span>
          <code className="api-path api-row-path">{row.path}</code>
        </span>
        <span className="api-row-side">
          {command ? (
            <span className="api-row-command">
              As a command <code>{command}</code>
            </span>
          ) : (
            <span className="api-row-command is-none">No command</span>
          )}
          <span className="api-row-callers">
            {row.callers.map((caller) => CALLER_WORDS[caller]).join(" · ")}
            {row.scopes.length > 0 && <span className="api-scopes"> · {row.scopes.join(", ")}</span>}
          </span>
        </span>
        <IconChevronRight className="api-row-arrow" />
      </button>
    </li>
  );
}
