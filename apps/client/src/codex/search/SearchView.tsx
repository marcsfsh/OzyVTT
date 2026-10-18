import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Eyebrow,
  IconButton,
  IconEye,
  IconEyeOff,
  IconX,
  Input,
  Modal,
  Select,
  Skeleton,
  cx
} from "@vtt/ui";
import type { CodexEntityType, CodexRecordKind } from "@vtt/domain";
import { findApi } from "../api-records";
import type { CodexSearchHit, CodexSearchType, PlayerCodexSearchHit } from "../contract";
import { entityDef } from "../entities";
import { CodexIcon, EntityIcon } from "../icons";
import { pathForHit } from "../routes";
import { CodexPhoneBar } from "../shell/PhoneBar";
import { useCodexShell } from "../shell/context";
import { AudienceChip } from "../shared/WhoSeesIt";
import { Dropdown } from "../shared/Dropdown";
import { EVERYONE, HIDDEN } from "../shared/audience";
import { KIND_GROUPS } from "../page/document";
import { useCodexQuery } from "../useCodexQuery";
import {
  MAX_SORT_LEVELS,
  SEARCH_TYPE_LABEL,
  SEARCH_TYPE_ORDER,
  SORT_KEY_LABEL,
  dayLabel,
  defaultSort,
  directionLabel,
  filterPatch,
  modifiedLabel,
  readFilters,
  sortSummary,
  type SearchFilters,
  type SortKey,
  type SortLevel
} from "./searchParams";
import "./search.css";

type AnyHit = CodexSearchHit | PlayerCodexSearchHit;
const isGmHit = (hit: AnyHit): hit is CodexSearchHit => "revealedToPlayers" in hit;

const KIND_ICON: Readonly<Record<Exclude<CodexRecordKind, "page">, string>> = {
  journal: "scroll",
  map: "compass",
  marker: "pin",
  quest: "quest",
  session: "sessions"
};

function HitIcon({ hit }: Readonly<{ hit: AnyHit }>) {
  return hit.kind === "page" ? (
    <EntityIcon type={(hit.entityType ?? "note") as CodexEntityType} />
  ) : (
    <CodexIcon iconId={KIND_ICON[hit.kind]} className="codex-ent-icon" />
  );
}

/** The matching line with the searched words marked; the GM's hidden text in violet with the crossed eye. */
function MatchLine({ hit, q }: Readonly<{ hit: AnyHit; q: string }>) {
  if (!hit.match) return <span className="cx-hint">The name matched.</span>;
  const words = q
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = words.length > 0 ? hit.match.line.split(new RegExp(`\\b(${words.join("|")})`, "i")) : [hit.match.line];
  const hidden = isGmHit(hit) && hit.match.hidden;
  return (
    <span className={cx("cx-matchline", hidden && "is-hidden")}>
      {hidden && (
        <>
          <IconEyeOff className="cx-matchline-icon" />
          <span className="nh-sr-only">Hidden text: </span>
        </>
      )}
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <mark key={index} className="cx-mark">
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </span>
  );
}

const RECENT_KEY = "codex-recent-searches";
function recentSearches(): string[] {
  try {
    return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[]).slice(0, 6);
  } catch {
    return [];
  }
}
function rememberSearch(q: string) {
  const text = q.trim();
  if (text.length < 2) return;
  try {
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify([text, ...recentSearches().filter((item) => item !== text)].slice(0, 6))
    );
  } catch {
    /* private mode: no recent searches */
  }
}

/**
 * Search: a table of every record the reader can open, with the line that matched, filtered by type, by who sees it
 * (the GM's) and by when it changed, and sorted by several columns in order. Its filters are its address.
 */
export function SearchView() {
  const { role, token, query, setFilter, go, phone } = useCodexShell();
  const gm = role === "gm";
  const filters = useMemo(() => readFilters(query, role), [query, role]);
  const [text, setText] = useState(filters.q);
  const [sorting, setSorting] = useState(false);
  // The box writes the address a beat after typing stops, so one settled query is one request.
  useEffect(() => {
    if (text === filters.q) return;
    const timer = setTimeout(() => setFilter(filterPatch({ q: text })), 250);
    return () => clearTimeout(timer);
  }, [text, filters.q, setFilter]);

  const sort = filters.sort.length > 0 ? filters.sort : defaultSort(filters.q);
  const load = useCallback(() => {
    // No type ticked asks for nothing.
    if (filters.types?.length === 0) return Promise.resolve({ hits: [], truncated: false, total: 0 });
    const params = {
      q: filters.q,
      types: filters.types,
      visibility: filters.visibility,
      modifiedFrom: filters.from,
      modifiedTo: filters.to,
      sort: filters.sort.map((level) => `${level.key}:${level.direction}`),
      limit: 200
    };
    return gm ? findApi.search(token, params) : findApi.searchAsPlayer(token, params);
  }, [gm, token, filters]);
  const result = useCodexQuery(load, { failure: "The search could not be completed." });
  const hits: readonly AnyHit[] = result.data?.hits ?? [];
  useEffect(() => {
    if (result.data && filters.q) rememberSearch(filters.q);
  }, [result.data, filters.q]);

  const update = (next: Partial<SearchFilters>) => setFilter(filterPatch(next));
  const typesOn = filters.types ?? SEARCH_TYPE_ORDER;
  const typeLabel = filters.types
    ? `Type: ${filters.types.length} of ${SEARCH_TYPE_ORDER.length}`
    : `Type: all ${SEARCH_TYPE_ORDER.length}`;
  const modifiedText =
    filters.from || filters.to
      ? `Modified: ${filters.from ? dayLabel(filters.from) : "any day"} to ${filters.to ? dayLabel(filters.to) : "today"}`
      : "Modified: any time";
  const open = (hit: AnyHit) => go(pathForHit(hit));

  const searchBox = (
    <Input
      type="search"
      className="cx-search-box"
      aria-label="Search"
      placeholder="Search names, text and fields"
      value={text}
      onChange={(event) => setText(event.target.value)}
    />
  );

  if (phone)
    return (
      <PhoneSearch
        box={searchBox}
        hits={hits}
        result={result}
        q={filters.q}
        gm={gm}
        onPick={(q) => setText(q)}
        types={filters.types}
        onTypes={(types) => update({ types })}
        onOpen={open}
      />
    );

  const typeMenu = (
    <Dropdown label={typeLabel} panelClassName="cx-typemenu">
      {() => (
        <>
          <div className="cx-dropdown-row">
            <Button size="sm" variant="ghost" onClick={() => update({ types: null })}>
              Select all
            </Button>
            <Button size="sm" variant="ghost" onClick={() => update({ types: [] })}>
              Clear
            </Button>
          </div>
          {SEARCH_TYPE_ORDER.map((type) => (
            <label key={type} className="cx-check">
              <input
                type="checkbox"
                checked={typesOn.includes(type)}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...typesOn, type]
                    : typesOn.filter((candidate) => candidate !== type);
                  update({
                    types:
                      next.length === SEARCH_TYPE_ORDER.length
                        ? null
                        : SEARCH_TYPE_ORDER.filter((candidate) => next.includes(candidate))
                  });
                }}
              />
              {SEARCH_TYPE_LABEL[type]}
            </label>
          ))}
        </>
      )}
    </Dropdown>
  );

  return (
    <div className="cx-search">
      <div className="cx-sub cx-search-bar">
        {searchBox}
        {typeMenu}
        {gm && (
          <Dropdown
            label={`Visibility: ${filters.visibility === "all" ? "All" : filters.visibility === "hidden" ? "Hidden" : "Revealed"}`}
            icon={<IconEye />}
          >
            {(close) =>
              (["all", "revealed", "hidden"] as const).map((choice) => (
                <label key={choice} className="cx-check">
                  <input
                    type="radio"
                    name="cx-search-visibility"
                    checked={filters.visibility === choice}
                    onChange={() => {
                      update({ visibility: choice });
                      close();
                    }}
                  />
                  {choice === "all" ? "All" : choice === "hidden" ? "Hidden" : "Revealed"}
                </label>
              ))
            }
          </Dropdown>
        )}
        <Dropdown label={modifiedText} panelClassName="cx-datemenu">
          {() => (
            <>
              <label className="cx-datefield">
                <span>From</span>
                <Input
                  type="date"
                  value={filters.from ?? ""}
                  onChange={(event) => update({ from: event.target.value || null })}
                />
              </label>
              <label className="cx-datefield">
                <span>To</span>
                <Input
                  type="date"
                  value={filters.to ?? ""}
                  onChange={(event) => update({ to: event.target.value || null })}
                />
              </label>
              <Button size="sm" variant="ghost" onClick={() => update({ from: null, to: null })}>
                Any time
              </Button>
            </>
          )}
        </Dropdown>
        <span className="cx-grow" />
        <span className="cx-search-count" role="status">
          {result.data ? `${result.data.total} ${result.data.total === 1 ? "result" : "results"}` : ""}
        </span>
        <Button size="sm" aria-haspopup="dialog" onClick={() => setSorting(true)}>
          {sortSummary(sort)}
        </Button>
      </div>
      <div className="cx-search-results scroll-y">
        {result.error && (
          <Alert tone="danger" title="Search failed">
            {result.error}
          </Alert>
        )}
        {result.loading && !result.data ? (
          <div className="cx-search-loading">
            <Skeleton variant="text" />
            <Skeleton variant="text" />
          </div>
        ) : hits.length === 0 && !result.error ? (
          <p className="cx-hint cx-search-empty">Nothing matches. Change the words or the filters.</p>
        ) : (
          <table className="cx-table">
            <thead>
              <tr>
                {gm && (
                  <th scope="col" className="cx-col-vis">
                    <span className="nh-sr-only">Players can open it</span>
                  </th>
                )}
                <th scope="col">Name</th>
                <th scope="col">Type</th>
                <th scope="col">Matching line</th>
                {gm && <th scope="col">Who sees it</th>}
                <th scope="col">Modified</th>
              </tr>
            </thead>
            <tbody>
              {hits.map((hit) => (
                <tr key={`${hit.kind}:${hit.id}`} className="cx-row" onClick={() => open(hit)}>
                  {gm && isGmHit(hit) && (
                    <td className="cx-col-vis">
                      {hit.revealedToPlayers ? (
                        <IconEye className="cx-vis is-open" />
                      ) : (
                        <IconEyeOff className="cx-vis is-hidden" />
                      )}
                      <span className="nh-sr-only">{hit.revealedToPlayers ? "Players can open it" : "Hidden"}</span>
                    </td>
                  )}
                  <td>
                    <button type="button" className="cx-rowlink" onClick={() => open(hit)}>
                      <HitIcon hit={hit} />
                      <b>{hit.title.trim() || "Untitled"}</b>
                    </button>
                  </td>
                  <td>{SEARCH_TYPE_LABEL[hit.type]}</td>
                  <td className="cx-col-line">
                    <MatchLine hit={hit} q={filters.q} />
                  </td>
                  {gm && isGmHit(hit) && (
                    <td>
                      <AudienceChip
                        value={hit.match?.hidden || !hit.revealedToPlayers ? HIDDEN : EVERYONE}
                        party={[]}
                      />
                    </td>
                  )}
                  <td className="cx-col-date">{modifiedLabel(hit.modifiedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {result.data?.truncated && (
          <p className="cx-hint">Showing the first {hits.length}. Narrow the search to see the rest.</p>
        )}
      </div>
      {sorting && (
        <SortDialog
          levels={sort}
          gm={gm}
          hasQuery={Boolean(filters.q.trim())}
          onCancel={() => setSorting(false)}
          onSort={(levels) => {
            update({ sort: levels });
            setSorting(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * Sort by several columns in order, as a spreadsheet does: rows sort by the first level, then by each level under it.
 */
export function SortDialog({
  levels,
  gm,
  hasQuery,
  onCancel,
  onSort
}: Readonly<{
  levels: readonly SortLevel[];
  gm: boolean;
  hasQuery: boolean;
  onCancel: () => void;
  onSort: (levels: readonly SortLevel[]) => void;
}>) {
  const [draft, setDraft] = useState<readonly SortLevel[]>(levels);
  const [selected, setSelected] = useState(0);
  const keys: SortKey[] = [
    ...(hasQuery ? (["relevance"] as const) : []),
    "name",
    "type",
    "modified",
    ...(gm ? (["visibility"] as const) : [])
  ];
  const unused = keys.find((key) => !draft.some((level) => level.key === key));
  const set = (index: number, patch: Partial<SortLevel>) =>
    setDraft((current) => current.map((level, at) => (at === index ? { ...level, ...patch } : level)));
  const moveUp = () => {
    if (selected <= 0) return;
    setDraft((current) => {
      const next = [...current];
      [next[selected - 1], next[selected]] = [next[selected], next[selected - 1]];
      return next;
    });
    setSelected(selected - 1);
  };
  return (
    <Modal
      open
      onClose={onCancel}
      size="sm"
      title="Sort"
      className="cx-sortdialog"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onSort(draft)}>
            Sort
          </Button>
        </>
      }
    >
      <p className="cx-hint">Rows sort by the first level, then by each level under it, as in a spreadsheet.</p>
      <div className="cx-sortlevels" role="list">
        {draft.map((level, index) => (
          <div
            key={index}
            role="listitem"
            className={cx("cx-sortrow", selected === index && "is-on")}
            onFocus={() => setSelected(index)}
            onClick={() => setSelected(index)}
          >
            <Eyebrow>{index === 0 ? "Sort by" : "Then by"}</Eyebrow>
            <Select
              aria-label={`${index === 0 ? "Sort by" : "Then by"}: column`}
              value={level.key}
              onChange={(event) =>
                set(index, {
                  key: event.target.value as SortKey,
                  direction: event.target.value === "modified" ? "desc" : "asc"
                })
              }
            >
              {keys.map((key) => (
                <option key={key} value={key} disabled={key !== level.key && draft.some((other) => other.key === key)}>
                  {SORT_KEY_LABEL[key]}
                </option>
              ))}
            </Select>
            <Select
              aria-label={`${index === 0 ? "Sort by" : "Then by"}: order`}
              value={level.direction}
              onChange={(event) => set(index, { direction: event.target.value as "asc" | "desc" })}
            >
              <option value="asc">{directionLabel(level.key, "asc")}</option>
              <option value="desc">{directionLabel(level.key, "desc")}</option>
            </Select>
            <IconButton
              label={`Delete this level: ${SORT_KEY_LABEL[level.key]}`}
              size="sm"
              disabled={draft.length === 1}
              onClick={(event) => {
                event.stopPropagation();
                setDraft((current) => current.filter((_, at) => at !== index));
                setSelected(0);
              }}
            >
              <IconX />
            </IconButton>
          </div>
        ))}
      </div>
      <div className="cx-dropdown-row">
        <Button
          size="sm"
          disabled={!unused || draft.length >= MAX_SORT_LEVELS}
          onClick={() => {
            if (!unused) return;
            setDraft((current) => [...current, { key: unused, direction: unused === "modified" ? "desc" : "asc" }]);
            setSelected(draft.length);
          }}
        >
          Add a level
        </Button>
        <Button size="sm" disabled={selected <= 0} onClick={moveUp}>
          Move up
        </Button>
      </div>
    </Modal>
  );
}

/** A phone's Search tab: the box in the top bar, kind chips, the results with their matching line, recent searches. */
function PhoneSearch({
  box,
  hits,
  result,
  q,
  gm,
  types,
  onTypes,
  onPick,
  onOpen
}: Readonly<{
  box: React.ReactNode;
  hits: readonly AnyHit[];
  result: Readonly<{ loading: boolean; error: string | null }>;
  q: string;
  gm: boolean;
  types: readonly CodexSearchType[] | null;
  onTypes: (types: readonly CodexSearchType[] | null) => void;
  onPick: (q: string) => void;
  onOpen: (hit: AnyHit) => void;
}>) {
  const chips = [
    { id: "all", label: "All", types: null as readonly CodexSearchType[] | null },
    ...KIND_GROUPS.filter((group) => group.id !== "things").map((group) => ({
      id: group.id,
      label: group.label,
      types: group.types as readonly CodexSearchType[]
    }))
  ];
  const onChip = chips.find((chip) => (chip.types ?? []).join() === (types ?? []).join())?.id ?? null;
  const recent = recentSearches();
  return (
    <div className="cx-search is-phone scroll-y">
      <CodexPhoneBar content={box} />
      <div className="cx-search-phonebody">
        <div className="cx-filterchips" role="group" aria-label="Kinds">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={cx("cx-filterchip", "interactive", onChip === chip.id && "is-on")}
              aria-pressed={onChip === chip.id}
              onClick={() => onTypes(chip.types)}
            >
              {chip.label}
            </button>
          ))}
        </div>
        {result.error && <Alert tone="danger">{result.error}</Alert>}
        {result.loading && hits.length === 0 ? (
          <Skeleton variant="text" />
        ) : (
          <ul className="cx-hitlist">
            {hits.map((hit) => (
              <li key={`${hit.kind}:${hit.id}`}>
                <button type="button" className="cx-hitrow" onClick={() => onOpen(hit)}>
                  <HitIcon hit={hit} />
                  <span className="cx-hitrow-text">
                    <span className="cx-hitrow-title">
                      <b>{hit.title.trim() || "Untitled"}</b>
                      <span className="cx-hitrow-kind">
                        {hit.kind === "page" && hit.entityType
                          ? entityDef(hit.entityType as CodexEntityType).label
                          : SEARCH_TYPE_LABEL[hit.type]}
                      </span>
                    </span>
                    {hit.match && <MatchLine hit={hit} q={q} />}
                  </span>
                  {gm && isGmHit(hit) && hit.match?.hidden && <AudienceChip value={HIDDEN} party={[]} />}
                </button>
              </li>
            ))}
          </ul>
        )}
        {recent.length > 0 && (
          <>
            <Eyebrow>Recent</Eyebrow>
            <div className="cx-meta-chips">
              {recent.map((item) => (
                <button key={item} type="button" className="cx-tag interactive" onClick={() => onPick(item)}>
                  {item}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
