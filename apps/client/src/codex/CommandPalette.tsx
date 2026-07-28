import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Skeleton } from "@vtt/ui";
import { codexApi, type CodexSearchHit } from "./api";
import { SearchResultRow, searchHitKey, useCodexSearch } from "./SearchResults";

/**
 * The codex quick-switcher: jump to any RECORD by name, switch surfaces, or create a page on the fly.
 * Opened with Cmd/Ctrl-K (or a toolbar button). Keyboard-first: type to filter, ↑/↓ to move, Enter to
 * run the highlighted action, Esc to close.
 *
 * CI-1 / R8: this reads the same suite-wide search the rail does, so a marker or a journal entry is
 * reachable from Cmd-K, not just a page. It used to hold its own copy of the notebook and filter titles
 * client-side — a second search mechanism that could only ever agree with the real one by coincidence.
 */
/** CI-7: `world` became `campaign` here as well as on the mode bar — a palette that still said "World"
    would be the one place the suite's vocabulary split. */
type GotoTarget = "campaign" | "pages" | "atlas" | "journal" | "graph";
type Action =
  | { kind: "hit"; hit: CodexSearchHit }
  | { kind: "create"; label: string; title: string }
  | { kind: "goto"; label: string; target: GotoTarget };

type CommandPaletteProps = Readonly<{
  gmToken: string;
  /** One destination handler for all four record kinds — the same one the Pages rail uses. */
  onOpenHit: (hit: CodexSearchHit) => void;
  onCreatePage: (title: string) => void;
  onGoto: (target: GotoTarget) => void;
  onClose: () => void;
}>;

const GOTO: ReadonlyArray<{ label: string; target: GotoTarget }> = [
  { label: "Go to Campaign", target: "campaign" },
  { label: "Go to Pages", target: "pages" },
  { label: "Go to Atlas", target: "atlas" },
  { label: "Go to Journal", target: "journal" },
  { label: "Go to Graph", target: "graph" }
];

/** A quick-switcher stays a switcher: the full result list lives in the rail. */
const MAX_HITS = 8;

export function CommandPalette({ gmToken, onOpenHit, onCreatePage, onGoto, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const runSearch = useCallback((q: string) => codexApi.search(gmToken, q), [gmToken]);
  const state = useCodexSearch(query, runSearch);

  const actions = useMemo<Action[]>(() => {
    const trimmed = query.trim();
    const hits = state.status === "ready" ? state.hits.slice(0, MAX_HITS) : [];
    const list: Action[] = hits.map((hit) => ({ kind: "hit" as const, hit }));
    // Offer "create" unless a page with exactly this title already came back — a page always matches its own title.
    if (trimmed && !hits.some((hit) => hit.kind === "page" && hit.title.toLowerCase() === trimmed.toLowerCase())) {
      list.push({ kind: "create", label: `Create page “${trimmed}”`, title: trimmed });
    }
    if (!trimmed) list.push(...GOTO.map((entry) => ({ kind: "goto" as const, label: entry.label, target: entry.target })));
    return list;
  }, [state, query]);

  useEffect(() => { setActive(0); }, [query]);

  const run = (action: Action | undefined) => {
    if (!action) return;
    if (action.kind === "hit") onOpenHit(action.hit);
    else if (action.kind === "create") onCreatePage(action.title);
    else onGoto(action.target);
    onClose();
  };

  return (
    <div className="codex-palette-scrim" onPointerDown={onClose}>
      <div className="codex-palette" role="dialog" aria-label="Codex command palette" onPointerDown={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="codex-palette-input"
          value={query}
          placeholder="Search pages, entries, maps and markers…"
          aria-label="Command palette"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(index + 1, actions.length - 1)); }
            else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
            else if (event.key === "Enter") { event.preventDefault(); run(actions[active]); }
            else if (event.key === "Escape") { event.preventDefault(); onClose(); }
          }}
        />
        <ul className="codex-palette-list">
          {/* R4: the palette is a result list too — it must not answer a failed search with "No matches." */}
          {state.status === "loading" && <li className="codex-palette-loading">{[0, 1].map((row) => <Skeleton key={row} variant="text" />)}</li>}
          {state.status === "error" && <li><Alert tone="danger" title="Search failed">{state.message}</Alert></li>}
          {actions.length === 0 && state.status === "ready" && <li className="codex-palette-empty">No matches.</li>}
          {actions.map((action, index) => (
            <li key={action.kind === "hit" ? searchHitKey(action.hit) : `${action.kind}-${index}`}>
              {action.kind === "hit"
                ? <SearchResultRow hit={action.hit} active={index === active} onOpen={() => run(action)} onHover={() => setActive(index)} />
                : <button type="button" className={`codex-palette-item is-action${index === active ? " is-active" : ""}`} onMouseEnter={() => setActive(index)} onClick={() => run(action)}>
                    {action.label}
                  </button>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
