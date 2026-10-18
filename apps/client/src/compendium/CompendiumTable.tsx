import { useMemo, useState, type ReactNode } from "react";
import { Button, Eyebrow, IconList, Input, cx } from "@vtt/ui";
import type { PartyCharacter } from "../codex/shared/audience";
import { Dropdown } from "../codex/shared/Dropdown";
import { FilterChips, FilterFlyout, FiltersButton } from "../codex/shared/FilterFlyout";
import { AudienceChip } from "../codex/shared/WhoSeesIt";
import { ModifiedDropdown, OneChoice, SortButton, TickDropdown } from "../scenes/listTools";
import {
  KIND_COLUMNS,
  KIND_FILTERS,
  KindIcon,
  kindLabel,
  kindPlural,
  phoneFacts,
  type Kind,
  type Names
} from "./kinds";
import { NameCell, StateChip, whenLabel } from "./pieces";
import {
  AUDIENCES,
  AUDIENCE_WORD,
  NO_FILTERS,
  ROW_STATES,
  STATE_WORD,
  activeFilters,
  directionLabel,
  filterRows,
  firstDirection,
  readTableFilters,
  readTableSort,
  sortKeys,
  sortLabels,
  sortRows,
  tableSummary,
  writeTableFilters,
  type CompendiumRow,
  type TableFilters
} from "./tableModel";

export type SourceOption = Readonly<{ value: string; label: string }>;

export type CompendiumTableProps = Readonly<{
  /** Null is Kind: All. */
  kind: Kind | null;
  /** The kinds the Kind dropdown offers. */
  kinds: readonly Kind[];
  /** Offer Kind: All. */
  allowAll: boolean;
  /** Null while the rows load. */
  rows: readonly CompendiumRow[] | null;
  error: string | null;
  onRetry: () => void;
  names: Names;
  sources: readonly SourceOption[];
  /** The GM's table: State, Who sees it, Problems and Modified, and their filters. */
  gm: boolean;
  party: readonly PartyCharacter[];
  phone: boolean;
  /** Beside an open record: the name and the kind's first columns. */
  compact?: boolean;
  /** In the flyout over a record: a list, as on a phone. */
  inFlyout?: boolean;
  selectedId?: string | null;
  query: URLSearchParams;
  setQuery: (mutate: (query: URLSearchParams) => void) => void;
  /** Moves to another kind's table, with the query it keeps. */
  onKind: (kind: Kind | null, query: URLSearchParams) => void;
  onOpen: (row: CompendiumRow) => void;
  /** The marks after a row's name. */
  mark: (row: CompendiumRow) => ReactNode;
  sourceWord: (row: CompendiumRow) => string;
  /** The phone's bar over the table. */
  head?: ReactNode;
  emptyText?: string;
}>;

/**
 * One kind's table, SRD and homebrew together, with the columns that matter for that kind: the Kind dropdown, the
 * Source dropdown, Filters as a flyout and Sort over several columns, all in the address so a filtered table is a
 * link. The GM's tables and the players' Compendium in the Codex both draw it; the GM's add the record's state and who
 * sees it. Beside an open record it is compact; on a phone it is a list with the two facts that matter most.
 */
export function CompendiumTable(props: CompendiumTableProps) {
  const { kind, rows, names, sources, gm, phone, query, setQuery, compact = false, inFlyout = false } = props;
  const selectedId = props.selectedId ?? null;
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const flyoutId = `cp-table-filters${inFlyout ? "-flyout" : ""}`;
  const filters = readTableFilters(query, kind);
  const sort = readTableSort(query, kind, gm);
  const labels = sortLabels(kind);
  const all = useMemo(() => rows ?? [], [rows]);
  const shown = useMemo(
    () => sortRows(filterRows(all, filters, kind), sort, kind, names),
    // The filters and sort are read from the address on every render; their text is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, query.toString(), kind, names]
  );
  const setFilters = (next: TableFilters) =>
    setQuery((params) =>
      writeTableFilters(
        params,
        next,
        sources.map((option) => option.value)
      )
    );
  const columns = kind ? KIND_COLUMNS[kind].slice(0, compact ? 3 : undefined) : [];
  const asList = phone || inFlyout;

  const kindDropdown = (
    <Dropdown
      label={phone || inFlyout ? (kind ? kindPlural(kind) : "All kinds") : `Kind: ${kind ? kindPlural(kind) : "All"}`}
      icon={<IconList />}
    >
      {(close) => (
        <div role="menu" aria-label="Kind">
          {[...(props.allowAll ? [null] : []), ...props.kinds].map((option) => (
            <button
              key={option ?? "all"}
              type="button"
              role="menuitemradio"
              aria-checked={option === kind}
              className={cx("cp-menuitem", option === kind && "is-on")}
              onClick={() => {
                close();
                props.onKind(option, stripKindFilters(query));
              }}
            >
              {option ? <KindIcon kind={option} /> : <IconList />}
              {option ? kindPlural(option) : "All kinds"}
            </button>
          ))}
        </div>
      )}
    </Dropdown>
  );
  const firstFilter = kind ? KIND_FILTERS[kind][0] : undefined;
  const firstOptions = firstFilter ? optionsOf(firstFilter, all) : [];
  const toolbar = (
    <div className={cx("cp-tool", compact && "is-compact")}>
      {kindDropdown}
      {!phone && !compact && !inFlyout && (
        <TickDropdown
          name="Source"
          options={sources}
          selected={filters.sources ?? sources.map((option) => option.value)}
          onChange={(chosen) => setFilters({ ...filters, sources: chosen.length === sources.length ? null : chosen })}
        />
      )}
      {firstFilter && firstOptions.length > 1 && !compact && !inFlyout && (
        <TickDropdown
          name={firstFilter.label}
          options={firstOptions}
          selected={filters.kind[firstFilter.key] ?? firstOptions.map((option) => option.value)}
          onChange={(chosen) =>
            setFilters({
              ...filters,
              kind: withKindFilter(filters.kind, firstFilter.key, chosen, firstOptions.length)
            })
          }
        />
      )}
      <FiltersButton
        open={flyoutOpen}
        onToggle={() => setFlyoutOpen(!flyoutOpen)}
        controls={flyoutId}
        count={activeFilters(filters, gm)}
      />
      <SortButton
        sort={sort}
        keys={sortKeys(kind, gm)}
        labels={labels}
        onSort={(levels) =>
          setQuery((params) => params.set("sort", levels.map((level) => `${level.key}:${level.direction}`).join(",")))
        }
        directionLabel={(key, direction) => directionLabel(key, direction, kind)}
        firstDirection={firstDirection}
        phone={phone}
      />
      {!asList && (
        <span className="cp-tool-count" role="status">
          {rows ? tableSummary(shown.length, kind, filters, sort, labels) : "Loading the table."}
        </span>
      )}
    </div>
  );

  const body = (() => {
    if (props.error && !rows)
      return (
        <div className="cp-empty">
          <p>{props.error}</p>
          <Button onClick={props.onRetry}>Try again</Button>
        </div>
      );
    if (!rows) return <p className="cp-hint cp-pad">Loading the table.</p>;
    if (shown.length === 0)
      return (
        <div className="cp-empty">
          <p>
            {all.length === 0 && props.emptyText
              ? props.emptyText
              : "Nothing in this table matches. Change the filters to see more."}
          </p>
          {all.length > 0 && (
            <Button variant="ghost" onClick={() => setQuery((params) => clearTableQuery(params))}>
              Clear the filters
            </Button>
          )}
        </div>
      );
    if (asList)
      return (
        <ul className="cp-list">
          {shown.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className={cx("cp-row", row.id === selectedId && "is-selected")}
                aria-current={row.id === selectedId ? "true" : undefined}
                onClick={() => props.onOpen(row)}
              >
                <KindIcon kind={row.kind} />
                <span className="cp-row-main">
                  <b>{row.name}</b>
                  <small>
                    {[
                      gm ? null : props.sourceWord(row),
                      kind ? phoneFacts(kind, row.columns, names) || null : kindPlural(row.kind)
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </span>
                {props.mark(row)}
              </button>
            </li>
          ))}
        </ul>
      );
    return (
      <table className={cx("cp-table", compact && "is-compact")}>
        <thead>
          <tr>
            <th scope="col">Name</th>
            {!kind && <th scope="col">Kind</th>}
            {!gm && !compact && <th scope="col">Source</th>}
            {columns.map((column) => (
              <th key={column.key} scope="col" className={cx(column.numeric && "is-num")}>
                {column.label}
              </th>
            ))}
            {compact && gm && <th scope="col">Modified</th>}
            {gm && !compact && (
              <>
                <th scope="col">Source</th>
                <th scope="col">State</th>
                <th scope="col">Who sees it</th>
                <th scope="col" className="is-num">
                  Problems
                </th>
                <th scope="col">Modified</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr
              key={row.id}
              className={cx(row.id === selectedId && "is-selected", row.archived && "is-archived")}
              onClick={() => props.onOpen(row)}
            >
              <td>
                <button
                  type="button"
                  className="cp-rowlink"
                  aria-current={row.id === selectedId ? "true" : undefined}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onOpen(row);
                  }}
                >
                  <NameCell kind={row.kind} name={row.name} mark={props.mark(row)} />
                </button>
              </td>
              {!kind && <td>{kindLabel(row.kind).replace(/^./, (first) => first.toUpperCase())}</td>}
              {!gm && !compact && <td className="cp-nowrap">{props.sourceWord(row)}</td>}
              {columns.map((column) => (
                <td key={column.key} className={cx(column.numeric && "is-num tabular")}>
                  {column.text(row.columns, names)}
                </td>
              ))}
              {compact && gm && <td className="cp-when">{whenLabel(row.updatedAt)}</td>}
              {gm && !compact && (
                <>
                  <td className="cp-nowrap">{props.sourceWord(row)}</td>
                  <td>
                    <StateChip row={row} />
                  </td>
                  <td>
                    {row.source === "srd" ? (
                      <span className="cp-muted">Everyone</span>
                    ) : (
                      <AudienceChip
                        value={{ audience: row.audience ?? "hidden", characterIds: row.characterIds ?? [] }}
                        party={props.party}
                      />
                    )}
                  </td>
                  <td className="is-num tabular">
                    {row.issueCount ? (
                      <span className="cp-caution">{row.issueCount}</span>
                    ) : (
                      <span className="cp-muted">None</span>
                    )}
                  </td>
                  <td className="cp-when">{whenLabel(row.updatedAt)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    );
  })();

  return (
    <section className={cx("cp-tables", compact && "is-compact")} aria-label={kind ? kindPlural(kind) : "Every kind"}>
      {props.head}
      {toolbar}
      <div className="cp-tables-main">
        <TableFilterFlyout
          id={flyoutId}
          open={flyoutOpen}
          onClose={() => setFlyoutOpen(false)}
          kind={kind}
          gm={gm}
          filters={filters}
          onFilters={setFilters}
          rows={all}
          sources={sources}
        />
        <div className={cx("cp-tables-body", asList ? "scroll-y" : "scroll-both")}>{body}</div>
      </div>
    </section>
  );
}

/** The values a kind's filter can take, from the rows the table holds. */
function optionsOf(filter: (typeof KIND_FILTERS)[Kind][number], rows: readonly CompendiumRow[]) {
  const values = [...new Set(rows.map((row) => filter.value(row.columns)).filter((value): value is string => !!value))];
  values.sort(filter.order ?? ((left, right) => left.localeCompare(right)));
  return values.map((value) => ({ value, label: filter.word(value) }));
}

function withKindFilter(
  current: TableFilters["kind"],
  key: string,
  chosen: readonly string[],
  total: number
): TableFilters["kind"] {
  const next = { ...current };
  if (chosen.length === total) delete next[key];
  else next[key] = chosen;
  return next;
}

/** A kind's own filters mean nothing to another kind, so a change of kind drops them. */
function stripKindFilters(query: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(query);
  for (const key of [...next.keys()]) if (key.startsWith("f.")) next.delete(key);
  return next;
}

function clearTableQuery(query: URLSearchParams) {
  for (const key of ["q", "source", "state", "who", "problems", "from", "to"]) query.delete(key);
  for (const key of [...query.keys()]) if (key.startsWith("f.")) query.delete(key);
}

/**
 * The table's filters as a flyout over its left side: Name, Source and the kind's own, and for the GM State, Who sees
 * it, Problems and Modified.
 */
function TableFilterFlyout({
  id,
  open,
  onClose,
  kind,
  gm,
  filters,
  onFilters,
  rows,
  sources
}: Readonly<{
  id: string;
  open: boolean;
  onClose: () => void;
  kind: Kind | null;
  gm: boolean;
  filters: TableFilters;
  onFilters: (next: TableFilters) => void;
  rows: readonly CompendiumRow[];
  sources: readonly SourceOption[];
}>) {
  const set = (patch: Partial<TableFilters>) => onFilters({ ...filters, ...patch });
  return (
    <FilterFlyout id={id} open={open} title="Filters" onClose={onClose}>
      <label className="cp-field">
        <span>Name</span>
        <Input value={filters.q} placeholder="Part of a name" onChange={(event) => set({ q: event.target.value })} />
      </label>
      <Eyebrow>Source</Eyebrow>
      <FilterChips
        label="Source"
        options={sources}
        selected={filters.sources ?? sources.map((option) => option.value)}
        onChange={(chosen) => set({ sources: chosen.length === sources.length ? null : chosen })}
      />
      {(kind ? KIND_FILTERS[kind] : []).map((filter) => {
        const options = optionsOf(filter, rows);
        if (options.length < 2) return null;
        return (
          <div key={filter.key} className="cp-flyout-group">
            <Eyebrow>{filter.label}</Eyebrow>
            <FilterChips
              label={filter.label}
              options={options}
              selected={filters.kind[filter.key] ?? options.map((option) => option.value)}
              onChange={(chosen) => set({ kind: withKindFilter(filters.kind, filter.key, chosen, options.length) })}
            />
          </div>
        );
      })}
      {gm && (
        <>
          <Eyebrow>State</Eyebrow>
          <FilterChips
            label="State"
            options={ROW_STATES.map((state) => ({ value: state, label: STATE_WORD[state] }))}
            selected={filters.states}
            onChange={(chosen) => set({ states: ROW_STATES.filter((state) => chosen.includes(state)) })}
          />
          <Eyebrow>Who sees it</Eyebrow>
          <FilterChips
            label="Who sees it"
            options={AUDIENCES.map((audience) => ({ value: audience, label: AUDIENCE_WORD[audience] }))}
            selected={filters.audiences}
            onChange={(chosen) => set({ audiences: AUDIENCES.filter((audience) => chosen.includes(audience)) })}
          />
          <OneChoice
            label="Problems"
            options={[{ value: "problems", label: "Has problems" }]}
            value={filters.problems ? "problems" : null}
            onChange={(value) => set({ problems: value !== null })}
          />
          <Eyebrow>Modified</Eyebrow>
          <ModifiedDropdown from={filters.from} to={filters.to} onChange={(from, to) => set({ from, to })} />
        </>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={activeFilters(filters, gm) === 0 && !filters.q}
        onClick={() => onFilters(NO_FILTERS)}
      >
        Clear the filters
      </Button>
    </FilterFlyout>
  );
}
