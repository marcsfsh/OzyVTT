import { useEffect, useState } from "react";
import { Alert, Skeleton } from "@vtt/ui";
import { CodexIcon, EntityIcon } from "./icons";
import { entityDef } from "./entities";
import { SEARCH_HIT_CAP, type CodexRecordKind, type CodexSearchHit } from "./api";

/**
 * CI-1 / R8: **one search box, one result list, every record kind.**
 *
 * This module owns the whole result surface — the fetch state machine, the single row shape, and the
 * kind marks — so the Pages rail, the command palette and the player Codex render literally the same
 * rows instead of three lookalikes that drift apart. It is a Codex-local composition of existing
 * primitives (`Alert`, `Skeleton`, the `CODEX_ICONS` glyph registry), not a new primitive, so R9 keeps
 * it here rather than in `@vtt/ui`.
 */

/**
 * R4: a result list has four honest states. Before this, `hits` was `CodexPageSummary[] | null` and
 * `null` meant BOTH "still fetching" and "the request threw" — the catch set `[]`, so a failed search
 * rendered "No notes match.", a list asserting a fact it never learned. The union makes that unsayable.
 */
export type SearchState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  /** D19: `truncated` rides with the hits — a clipped list must be able to say so. */
  | Readonly<{ status: "ready"; hits: readonly CodexSearchHit[]; truncated: boolean }>;

/**
 * How long the box stays quiet after the last keystroke before the request goes out. The suite-wide search
 * hits four record kinds server-side, and without this every character was its own round trip — a measured
 * six requests for a six-character query, in all three callers at once. `PageEditor`'s autosave already
 * establishes the pattern (a `setTimeout` keyed on the changing value, cleared by the effect's own
 * teardown); it can afford ~800ms because nothing is waiting on it, while a result list a GM is reading as
 * they type cannot. 250ms is under the ~300ms that reads as instant and still collapses ordinary typing to
 * one request.
 */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Run the suite-wide search for a query, one state machine shared by all three callers.
 * `search` must be stable (wrap it in `useCallback`); `refreshKey` re-runs the query when the notebook
 * behind it changes, which is how a result list stays current after a `codex:changed` refresh.
 */
export function useCodexSearch(
  query: string,
  search: (query: string) => Promise<Readonly<{ hits: readonly CodexSearchHit[]; truncated: boolean }>>,
  refreshKey?: unknown
): SearchState {
  const [state, setState] = useState<SearchState>({ status: "idle" });
  useEffect(() => {
    const trimmed = query.trim();
    // An empty box resets IMMEDIATELY and fires nothing: there is no request to debounce, and making the
    // list linger on the previous query's hits for a quarter second would be a small lie about what the
    // box currently says.
    if (!trimmed) { setState({ status: "idle" }); return; }
    let live = true;
    // R4: "loading" is set on the keystroke, not when the request leaves. The debounce delays the fetch,
    // never the honesty — the list must not keep presenting the previous query's hits as this query's.
    setState({ status: "loading" });
    const timer = setTimeout(() => {
      void search(trimmed)
        .then((result) => { if (live) setState({ status: "ready", hits: result.hits, truncated: result.truncated }); })
        .catch((cause: unknown) => { if (live) setState({ status: "error", message: cause instanceof Error ? cause.message : "The search could not be completed." }); });
    }, SEARCH_DEBOUNCE_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [query, search, refreshKey]);
  return state;
}

/**
 * R2: **kind reads by icon + label, never colour alone.** Every row carries a text kind label, so the
 * accent below is only a scanning aid — remove all colour and the list still reads correctly. Pages get
 * their entity type's own glyph and colour (the same `EntityIcon` the notebook and Campaign dashboard cards use);
 * the other three get a fixed glyph from the existing registry, because the narrow hit deliberately does
 * not carry a marker's own `iconId`/`iconColor`.
 */
const KIND_MARKS: Readonly<Record<Exclude<CodexRecordKind, "page">, Readonly<{ icon: string; label: string; color: string }>>> = {
  // `scroll`, not `hourglass`: CT-11 made `hourglass` the chronicle's glyph for a dated `event` PAGE (it
  // is `ENTITY_DEFS.event.icon`), so a journal hit wearing it would name the wrong record type on the one
  // list where both kinds appear side by side. `scroll` is `ENTITY_DEFS.note.icon` - prose the GM wrote.
  // `--cyan` because that is already the journal's own accent (`.codex-entry`'s left rule, the timeline's
  // year headings) - not `--codex-type-note`, which resolves to `--text-muted` and would dim the glyph.
  journal: { icon: "scroll", label: "Journal", color: "var(--cyan)" },
  map: { icon: "compass", label: "Map", color: "var(--codex-type-location)" },
  // D5 glossary: a map marker is a PIN everywhere in the UI. The wire kind stays `marker`.
  marker: { icon: "pin", label: "Pin", color: "var(--magenta)" },
  // M10. `--caution` is the one accent no entity type has claimed on this list; the design tokens
  // already say near-neighbour hues are fine here "because the entity icon + label always carry the
  // finer distinction", and R2 means the WORD "Quest" is what actually names the kind. The glyph is the
  // registry's `quest` (a circled `!`, the tabletop quest marker), which no other kind uses.
  quest: { icon: "quest", label: "Quest", color: "var(--caution)" },
  // D10: sessions joined the index — including the PLAYER's, which is why this may not be violet.
  // Invariant 8 reserves that hue for GM-only content and nothing else, and a revealed session is a
  // record the player is explicitly allowed to see. `--info` (indigo) is unclaimed on this list, and
  // R2 means the word "Session" is what actually names the kind. `sessions` is the sidebar's own glyph,
  // so a session reads the same in a result list as it does in the navigation.
  session: { icon: "sessions", label: "Session", color: "var(--info)" }
};

/** The kind label as it reads on the row — a page reads as its entity type ("Character"), which is what the rest of the suite calls it. */
export function searchHitKindLabel(hit: CodexSearchHit): string {
  if (hit.kind !== "page") return KIND_MARKS[hit.kind].label;
  return hit.entityType ? entityDef(hit.entityType).label : "Page";
}

/** A pin may legitimately have no label, and a journal entry with no player-facing text excerpts to "". */
export function searchHitTitle(hit: CodexSearchHit): string {
  const title = hit.title.trim();
  if (title) return title;
  // A session hit's title is SERVER-built and is never empty ("Session 4" / a recap excerpt /
  // "Untitled session"), so it never reaches this fallback — the same string is used if it ever does.
  return hit.kind === "marker" ? "Unlabelled pin" : hit.kind === "journal" ? "Untitled entry" : hit.kind === "session" ? "Untitled session" : "Untitled";
}

/** Stable across lists: two kinds can share an id space only by accident, but the pair never collides. */
export function searchHitKey(hit: CodexSearchHit): string { return `${hit.kind}:${hit.id}`; }

export type SearchResultRowProps = Readonly<{
  hit: CodexSearchHit;
  active?: boolean;
  onOpen: (hit: CodexSearchHit) => void;
  onHover?: () => void;
}>;

/** The one row shape. Identical markup wherever a search result appears. */
export function SearchResultRow({ hit, active = false, onOpen, onHover }: SearchResultRowProps) {
  const mark = hit.kind === "page" ? null : KIND_MARKS[hit.kind];
  return (
    <button type="button" className={`codex-hit${active ? " is-active" : ""}`} onClick={() => onOpen(hit)} onMouseEnter={onHover}>
      <span className="codex-hit-glyph">
        {mark
          ? <CodexIcon iconId={mark.icon} className="codex-ent-icon codex-hit-ic" style={{ color: mark.color }} />
          : <EntityIcon type={hit.entityType ?? "note"} className="codex-hit-ic" />}
      </span>
      <span className="codex-hit-text">
        <span className="codex-hit-title">{searchHitTitle(hit)}</span>
        <span className="codex-hit-meta">
          <span className="codex-hit-kind">{searchHitKindLabel(hit)}</span>
          {/* Read-only. Clicking a tag to filter across kinds is a later milestone; these are here
              because the hit already carries them and they are what makes a suite-wide result scannable. */}
          {hit.tags.slice(0, 3).map((tag) => <span key={tag} className="codex-hit-tag">#{tag}</span>)}
        </span>
      </span>
    </button>
  );
}

export type SearchResultListProps = Readonly<{
  state: SearchState;
  onOpen: (hit: CodexSearchHit) => void;
  /** Highlights the row for the PAGE currently open behind the list (the only kind that stays on screen). */
  selectedId?: string | null;
  /** What a genuinely empty result set says. Only ever rendered for a settled, successful search. */
  emptyLabel: string;
}>;

/** The whole result list including its loading and error states (R4). Renders nothing while idle. */
export function SearchResultList({ state, onOpen, selectedId = null, emptyLabel }: SearchResultListProps) {
  if (state.status === "idle") return null;
  if (state.status === "loading") return <div className="codex-list-loading">{[0, 1, 2].map((row) => <Skeleton key={row} variant="text" />)}</div>;
  if (state.status === "error") return <Alert tone="danger" title="Search failed">{state.message}</Alert>;
  if (state.hits.length === 0) return <p className="codex-list-empty">{emptyLabel}</p>;
  return (
    <>
      {state.hits.map((hit) => (
        <SearchResultRow key={searchHitKey(hit)} hit={hit} active={hit.kind === "page" && hit.id === selectedId} onOpen={onOpen} />
      ))}
      {/* D19: the Codex is unpaginated by design at LAN scale, which is honest only while a caller can
          tell a complete list from a clipped one. Non-interactive on purpose — there is no page 2. */}
      {state.truncated && <p className="codex-search-truncated">Showing the first {SEARCH_HIT_CAP} matches. Narrow the search.</p>}
    </>
  );
}
