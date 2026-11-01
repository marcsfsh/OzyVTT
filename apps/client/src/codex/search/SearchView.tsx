import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Eyebrow,
  IconEye,
  IconEyeOff,
  IconMore,
  Input,
  Menu,
  MenuItem,
  Modal,
  SideListGroup,
  SideListRow,
  Skeleton,
  Tag,
  cx,
  AudienceChip,
  SortDialog,
  EVERYONE,
  HIDDEN,
  IconSort
} from "@vtt/ui";
import type { CodexEntityType, CodexRecordKind } from "@vtt/domain";
import { findApi } from "../api-records";
import type { CodexSearchHit, CodexSearchType, PlayerCodexSearchHit } from "@vtt/domain";
import { entityDef } from "../entities";
import { CodexIcon, EntityIcon } from "../icons";
import { pathForHit } from "../routes";
import { searchHitKey } from "../SearchResults";
import { CodexPhoneBar } from "../shell/PhoneBar";
import { useCodexShell } from "../shell/context";
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
          <span className="cx-matchline-hidden">{hit.kind === "page" ? "Hidden block: " : "Hidden text: "}</span>
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

/** A hit's kind in words: a page's own kind (Person, Place), else the record's type. */
const kindWord = (hit: AnyHit) =>
  hit.kind === "page" && hit.entityType
    ? entityDef(hit.entityType as CodexEntityType).label
    : SEARCH_TYPE_LABEL[hit.type];

/** Whether the GM's hit is something players don't read: the record, or the line that matched. */
const hiddenHit = (hit: AnyHit) => isGmHit(hit) && (!hit.revealedToPlayers || hit.match?.hidden === true);

/** The name with the typed words lit, as the matched line lights them. */
function LitName({ name, q }: Readonly<{ name: string; q: string }>) {
  const words = q
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (words.length === 0) return <>{name}</>;
  const parts = name.split(new RegExp(`(${words.join("|")})`, "i"));
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <mark key={index} className="cx-mark">
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  );
}

/** One result: the kind's icon, the name with the match lit, the kind and the line that matched, who sees it. */
function HitRow({
  hit,
  q,
  gm,
  on,
  onChoose
}: Readonly<{ hit: AnyHit; q: string; gm: boolean; on: boolean; onChoose: () => void }>) {
  const title = hit.title.trim() || "Untitled";
  return (
    <button
      type="button"
      className={cx("cx-hit interactive", on && "is-on")}
      aria-current={on ? "true" : undefined}
      onClick={onChoose}
    >
      <HitIcon hit={hit} />
      <span className="cx-hit-text">
        <b className={cx("cx-hit-name", isGmHit(hit) && !hit.revealedToPlayers && "is-hidden")}>
          <LitName name={title} q={q} />
        </b>
        <span className="cx-hit-line">
          <span className="cx-hit-kind">{kindWord(hit)}</span>
          {hit.match && (
            <>
              {" · "}
              <MatchLine hit={hit} q={q} />
            </>
          )}
        </span>
      </span>
      {gm && isGmHit(hit) && <AudienceChip value={hiddenHit(hit) ? HIDDEN : EVERYONE} party={[]} />}
    </button>
  );
}

/** The chosen result beside the list: its title row, the line that matched, its facts and the way in. */
function ChosenHit({ hit, q, gm, onOpen }: Readonly<{ hit: AnyHit; q: string; gm: boolean; onOpen: () => void }>) {
  const title = hit.title.trim() || "Untitled";
  return (
    <section className="cx-search-chosen" aria-label={title}>
      <div className="cx-search-chosen-head">
        <HitIcon hit={hit} />
        <h2 className={cx(isGmHit(hit) && !hit.revealedToPlayers && "is-hidden")}>{title}</h2>
        {gm && isGmHit(hit) && !hit.revealedToPlayers && <Tag tone="hidden">Hidden</Tag>}
        {isGmHit(hit) && hit.kind === "page" && hit.match?.hidden && <Tag tone="hidden">1 block hidden</Tag>}
      </div>
      <p className="cx-search-chosen-line">
        <MatchLine hit={hit} q={q} />
      </p>
      <dl className="cx-search-facts">
        <div>
          <dt>Kind</dt>
          <dd>{kindWord(hit)}</dd>
        </div>
        <div>
          <dt>Changed</dt>
          <dd>{modifiedLabel(hit.modifiedAt)}</dd>
        </div>
        {gm && isGmHit(hit) && (
          <div>
            <dt>Who sees it</dt>
            <dd>{hit.revealedToPlayers ? "Everyone" : "Only you"}</dd>
          </div>
        )}
      </dl>
      <Button variant="primary" onClick={onOpen}>
        Open the page
      </Button>
    </section>
  );
}

/**
 * Search as panes (F finding spec 2.1): the kinds and who sees them at the left, the field with the count and the
 * results as rows in the middle, and the chosen result at the right. The kinds filter what came back, so each keeps its
 * count; who sees it, when it changed and the sort go to the server. Its filters and the chosen result are its address.
 */
export function SearchView() {
  const { role, token, query, setFilter, go, phone } = useCodexShell();
  const gm = role === "gm";
  const filters = useMemo(() => readFilters(query, role), [query, role]);
  const [text, setText] = useState(filters.q);
  const [sorting, setSorting] = useState(false);
  const [dating, setDating] = useState(false);
  // The box writes the address a beat after typing stops, so one settled query is one request.
  useEffect(() => {
    if (text === filters.q) return;
    const timer = setTimeout(() => setFilter({ ...filterPatch({ q: text }), hit: null }), 250);
    return () => clearTimeout(timer);
  }, [text, filters.q, setFilter]);

  const sort = filters.sort.length > 0 ? filters.sort : defaultSort(filters.q);
  // The sort's words, so a new address with the same sort asks nothing new.
  const sortKey = filters.sort.map((level) => `${level.key}:${level.direction}`).join(",");
  const load = useCallback(() => {
    const params = {
      q: filters.q,
      visibility: filters.visibility,
      modifiedFrom: filters.from,
      modifiedTo: filters.to,
      sort: sortKey ? sortKey.split(",") : [],
      limit: 200
    };
    return gm ? findApi.search(token, params) : findApi.searchAsPlayer(token, params);
  }, [gm, token, filters.q, filters.visibility, filters.from, filters.to, sortKey]);
  const result = useCodexQuery(load, { failure: "The search could not be completed." });
  const all: readonly AnyHit[] = useMemo(() => result.data?.hits ?? [], [result.data]);
  useEffect(() => {
    if (result.data && filters.q) rememberSearch(filters.q);
  }, [result.data, filters.q]);

  const counts = useMemo(() => {
    const byType = new Map<CodexSearchType, number>();
    for (const hit of all) byType.set(hit.type, (byType.get(hit.type) ?? 0) + 1);
    return byType;
  }, [all]);
  const hits = filters.types ? all.filter((hit) => filters.types!.includes(hit.type)) : all;
  const chosen = hits.find((hit) => searchHitKey(hit) === query.get("hit")) ?? hits[0] ?? null;
  const update = (next: Partial<SearchFilters>) => setFilter({ ...filterPatch(next), hit: null });
  const choose = (hit: AnyHit) => setFilter({ hit: searchHitKey(hit) });
  const open = (hit: AnyHit) => go(pathForHit(hit));
  // All of them counts what the server found, past the limit; a kind counts what came back.
  const shown = filters.types ? hits.length : (result.data?.total ?? 0);
  const count = result.data ? `${shown} ${shown === 1 ? "result" : "results"}` : "";

  // The arrows move the choice and Enter opens it, from the field or the list.
  const onKeys = (event: React.KeyboardEvent) => {
    if (hits.length === 0) return;
    const at = chosen ? hits.indexOf(chosen) : -1;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = hits[Math.min(hits.length - 1, Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)))];
      if (next) choose(next);
    } else if (event.key === "Enter" && chosen && !(event.target as HTMLElement).closest("button")) {
      event.preventDefault();
      open(chosen);
    }
  };

  const searchBox = (
    <Input
      type="search"
      className="cx-search-box"
      aria-label="Search"
      placeholder="Search names, text and fields"
      value={text}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={phone ? undefined : onKeys}
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

  const kinds = SEARCH_TYPE_ORDER.filter((type) => (counts.get(type) ?? 0) > 0 || filters.types?.includes(type));
  return (
    <div className="cx-search cx-search-panes">
      <nav className="cx-search-side scroll-y" aria-label="Narrow the results">
        <SideListGroup eyebrow="Kinds">
          <SideListRow
            label="All"
            count={all.length}
            current={!filters.types}
            onSelect={() => update({ types: null })}
          />
          {kinds.map((type) => (
            <SideListRow
              key={type}
              label={SEARCH_TYPE_LABEL[type]}
              count={counts.get(type) ?? 0}
              current={filters.types?.length === 1 && filters.types[0] === type}
              onSelect={() => update({ types: [type] })}
            />
          ))}
        </SideListGroup>
        {gm && (
          <SideListGroup eyebrow="Who sees it">
            <SideListRow
              label="Everyone"
              leading={<IconEye />}
              current={filters.visibility === "revealed"}
              onSelect={() => update({ visibility: filters.visibility === "revealed" ? "all" : "revealed" })}
            />
            <SideListRow
              label="Hidden"
              leading={<IconEyeOff />}
              current={filters.visibility === "hidden"}
              onSelect={() => update({ visibility: filters.visibility === "hidden" ? "all" : "hidden" })}
            />
          </SideListGroup>
        )}
      </nav>
      <div className="cx-search-list" onKeyDown={onKeys}>
        <div className="cx-search-field">
          {searchBox}
          <span className="cx-search-count" role="status">
            {count}
          </span>
          <Menu trigger={<IconMore />} icon label="Sort and when it changed" align="end">
            <MenuItem icon={<IconSort />} onClick={() => setSorting(true)}>
              {`${sortSummary(sort)}…`}
            </MenuItem>
            <MenuItem onClick={() => setDating(true)}>
              {filters.from || filters.to
                ? `Changed: ${filters.from ? dayLabel(filters.from) : "any day"} to ${filters.to ? dayLabel(filters.to) : "today"}…`
                : "Changed: any time…"}
            </MenuItem>
          </Menu>
        </div>
        <div className="cx-search-results scroll-y">
          {result.error ? (
            <Alert tone="danger" title="Search failed">
              {result.error}
            </Alert>
          ) : result.loading && !result.data ? (
            <div className="cx-search-loading">
              <Skeleton variant="text" />
              <Skeleton variant="text" />
            </div>
          ) : hits.length === 0 ? (
            <p className="cx-hint cx-search-empty">Nothing matches. Change the words or the filters.</p>
          ) : (
            <ul className="cx-hits" aria-label="Results">
              {hits.map((hit) => (
                <li key={searchHitKey(hit)}>
                  <HitRow hit={hit} q={filters.q} gm={gm} on={hit === chosen} onChoose={() => choose(hit)} />
                </li>
              ))}
            </ul>
          )}
          {result.data?.truncated && (
            <p className="cx-hint">Showing the first {all.length}. Narrow the search to see the rest.</p>
          )}
        </div>
      </div>
      <div className="cx-search-pane scroll-y">
        {chosen ? (
          <ChosenHit hit={chosen} q={filters.q} gm={gm} onOpen={() => open(chosen)} />
        ) : (
          <p className="cx-hint">Choose a result to read it here.</p>
        )}
      </div>
      {sorting && (
        <SearchSortDialog
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
      {dating && (
        <Modal open size="sm" title="When it changed" onClose={() => setDating(false)}>
          <div className="cx-search-dates">
            <label className="nh-datefield">
              <span>From</span>
              <Input
                type="date"
                value={filters.from ?? ""}
                onChange={(event) => update({ from: event.target.value || null })}
              />
            </label>
            <label className="nh-datefield">
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
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Search's Sort dialog: the shared one over Search's columns, with Best match only while there are words. */
function SearchSortDialog({
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
  const keys: SortKey[] = [
    ...(hasQuery ? (["relevance"] as const) : []),
    "name",
    "type",
    "modified",
    ...(gm ? (["visibility"] as const) : [])
  ];
  return (
    <SortDialog
      levels={levels}
      keys={keys}
      keyLabel={(key) => SORT_KEY_LABEL[key]}
      directionLabel={directionLabel}
      firstDirection={(key) => (key === "modified" ? "desc" : "asc")}
      maxLevels={MAX_SORT_LEVELS}
      onCancel={onCancel}
      onSort={onSort}
    />
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
  const [openKey, setOpenKey] = useState<string | null>(null);
  return (
    <div className="cx-search is-phone scroll-y">
      <CodexPhoneBar content={box} actions={false} />
      <div className="cx-search-phonebody">
        <div className="nh-filterchips" role="group" aria-label="Kinds">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={cx("nh-filterchip", "interactive", onChip === chip.id && "is-on")}
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
        ) : hits.length === 0 && !result.error ? (
          <p className="cx-hint">Nothing matches. Change the words or the kind.</p>
        ) : (
          <ul className="cx-hitlist">
            {hits.map((hit) => {
              const key = searchHitKey(hit);
              const on = openKey === key;
              return (
                <li key={key} className={cx(on && "is-on")}>
                  <button
                    type="button"
                    className="cx-hitrow"
                    aria-expanded={on}
                    onClick={() => setOpenKey(on ? null : key)}
                  >
                    <HitIcon hit={hit} />
                    <span className="cx-hitrow-text">
                      <span className="cx-hitrow-title">
                        <b className={cx(isGmHit(hit) && !hit.revealedToPlayers && "is-hidden")}>
                          <LitName name={hit.title.trim() || "Untitled"} q={q} />
                        </b>
                        <span className="cx-hitrow-kind">{kindWord(hit)}</span>
                      </span>
                    </span>
                    {gm && isGmHit(hit) && hiddenHit(hit) && <AudienceChip value={HIDDEN} party={[]} />}
                  </button>
                  {/* The chosen row opens under itself: the part that matched and the way in. */}
                  {on && (
                    <div className="cx-hitrow-open">
                      <MatchLine hit={hit} q={q} />
                      <Button size="sm" variant="primary" onClick={() => onOpen(hit)}>
                        Open the page
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
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
