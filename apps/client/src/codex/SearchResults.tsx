import { useEffect, useState } from "react";
import { Alert, Skeleton } from "@vtt/ui";
import { CodexIcon, EntityIcon } from "./icons";
import { entityDef } from "./entities";
import { SEARCH_HIT_CAP, type CodexRecordKind, type CodexSearchHit } from "./api";

/**
 * The suite-wide search result surface (fetch state, row shape, kind marks), shared by the Pages rail,
 * the command palette and the player Codex so they render identical rows.
 */

/** Distinct loading and error states, so a failed search never renders as "no matches". */
export type SearchState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  /** A clipped list must be able to say so. */
  | Readonly<{ status: "ready"; hits: readonly CodexSearchHit[]; truncated: boolean }>;

/** Collapses ordinary typing to one request while staying under the ~300ms that reads as instant. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * The shared search state machine. `search` must be stable (`useCallback`); `refreshKey` re-runs the query
 * when the notebook changes.
 */
export function useCodexSearch(
  query: string,
  search: (query: string) => Promise<Readonly<{ hits: readonly CodexSearchHit[]; truncated: boolean }>>,
  refreshKey?: unknown
): SearchState {
  const [state, setState] = useState<SearchState>({ status: "idle" });
  useEffect(() => {
    const trimmed = query.trim();
    // An empty box resets immediately and fires nothing.
    if (!trimmed) {
      setState({ status: "idle" });
      return;
    }
    let live = true;
    // Loading is set on the keystroke, so the previous query's hits never pose as this query's.
    setState({ status: "loading" });
    const timer = setTimeout(() => {
      void search(trimmed)
        .then((result) => {
          if (live) setState({ status: "ready", hits: result.hits, truncated: result.truncated });
        })
        .catch((cause: unknown) => {
          if (live)
            setState({
              status: "error",
              message: cause instanceof Error ? cause.message : "The search could not be completed."
            });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, search, refreshKey]);
  return state;
}

/**
 * Kind reads by icon and label, never colour alone. Pages use their entity type's glyph; other kinds get a
 * fixed glyph because the hit doesn't carry a marker's own icon.
 */
const KIND_MARKS: Readonly<
  Record<Exclude<CodexRecordKind, "page">, Readonly<{ icon: string; label: string; color: string }>>
> = {
  // `scroll`, not `hourglass` (an `event` page's glyph), so journal and event hits differ.
  journal: { icon: "scroll", label: "Journal", color: "var(--cyan)" },
  map: { icon: "compass", label: "Map", color: "var(--codex-type-location)" },
  // A map marker is a "pin" in the UI; the wire kind stays `marker`.
  marker: { icon: "pin", label: "Pin", color: "var(--magenta)" },
  quest: { icon: "quest", label: "Quest", color: "var(--caution)" },
  // Not violet: players see revealed sessions, and violet is reserved for GM-only content.
  session: { icon: "sessions", label: "Session", color: "var(--info)" }
};

/** A page reads as its entity type ("Character"). */
export function searchHitKindLabel(hit: CodexSearchHit): string {
  if (hit.kind !== "page") return KIND_MARKS[hit.kind].label;
  return hit.entityType ? entityDef(hit.entityType).label : "Page";
}

/** Fallback titles: a pin may be unlabelled and a journal entry may have no player-facing text. */
export function searchHitTitle(hit: CodexSearchHit): string {
  const title = hit.title.trim();
  if (title) return title;
  // Session titles are built server-side and never empty; the fallback is just for safety.
  return hit.kind === "marker"
    ? "Unlabelled pin"
    : hit.kind === "journal"
      ? "Untitled entry"
      : hit.kind === "session"
        ? "Untitled session"
        : "Untitled";
}

/** Unique across kinds. */
export function searchHitKey(hit: CodexSearchHit): string {
  return `${hit.kind}:${hit.id}`;
}

export type SearchResultRowProps = Readonly<{
  hit: CodexSearchHit;
  active?: boolean;
  onOpen: (hit: CodexSearchHit) => void;
  onHover?: () => void;
}>;

/** The one row shape, wherever a search result appears. */
export function SearchResultRow({ hit, active = false, onOpen, onHover }: SearchResultRowProps) {
  const mark = hit.kind === "page" ? null : KIND_MARKS[hit.kind];
  return (
    <button
      type="button"
      className={`codex-hit${active ? " is-active" : ""}`}
      onClick={() => onOpen(hit)}
      onMouseEnter={onHover}
    >
      <span className="codex-hit-glyph">
        {mark ? (
          <CodexIcon iconId={mark.icon} className="codex-ent-icon codex-hit-ic" style={{ color: mark.color }} />
        ) : (
          <EntityIcon type={hit.entityType ?? "note"} className="codex-hit-ic" />
        )}
      </span>
      <span className="codex-hit-text">
        <span className="codex-hit-title">{searchHitTitle(hit)}</span>
        <span className="codex-hit-meta">
          <span className="codex-hit-kind">{searchHitKindLabel(hit)}</span>
          {/* Read-only tags, for scanning. */}
          {hit.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="codex-hit-tag">
              #{tag}
            </span>
          ))}
        </span>
      </span>
    </button>
  );
}

export type SearchResultListProps = Readonly<{
  state: SearchState;
  onOpen: (hit: CodexSearchHit) => void;
  /** Highlights the page currently open behind the list. */
  selectedId?: string | null;
  /** Only rendered for a settled, successful search. */
  emptyLabel: string;
}>;

/** The whole result list including loading and error states. Renders nothing while idle. */
export function SearchResultList({ state, onOpen, selectedId = null, emptyLabel }: SearchResultListProps) {
  if (state.status === "idle") return null;
  if (state.status === "loading")
    return (
      <div className="codex-list-loading">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} variant="text" />
        ))}
      </div>
    );
  if (state.status === "error")
    return (
      <Alert tone="danger" title="Search failed">
        {state.message}
      </Alert>
    );
  if (state.hits.length === 0) return <p className="codex-list-empty">{emptyLabel}</p>;
  return (
    <>
      {state.hits.map((hit) => (
        <SearchResultRow
          key={searchHitKey(hit)}
          hit={hit}
          active={hit.kind === "page" && hit.id === selectedId}
          onOpen={onOpen}
        />
      ))}
      {/* The Codex is unpaginated, so a clipped list says so; there is no page 2. */}
      {state.truncated && (
        <p className="codex-search-truncated">Showing the first {SEARCH_HIT_CAP} matches. Narrow the search.</p>
      )}
    </>
  );
}
