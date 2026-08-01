import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Modal, Skeleton } from "@vtt/ui";
import { codexApi, playerCodexApi, SEARCH_HIT_CAP, type CodexSearchHit } from "./api";
import { SearchResultRow, searchHitKey, useCodexSearch } from "./SearchResults";
import { GM_SIDEBAR, PLAYER_SIDEBAR, pathForSection } from "./routes";

/**
 * D20 — the Codex quick-switcher: jump to any RECORD by name, go to any section, or start a create.
 *
 * **Codex-scoped, deliberately not app-global** (the client chose this explicitly). It is mounted only
 * inside `CodexShell` and the player shell, so Cmd-K means nothing on the Encounter tab — and a test
 * locks that, because "make it global" is the obvious next step and is out of scope.
 *
 * What the recut added: navigation verbs for **every** sidebar section (it knew five modes and now knows
 * twelve), create verbs that open the one quick-create dialog rather than making an untyped page, and
 * the truncation line. Its chrome is now the `Modal` primitive with the new top alignment, replacing the
 * bespoke scrim + panel it used to hand-roll (D25).
 *
 * **A verb here does the thing it is named for.** "New page…" opens quick-create; "New session" and "New
 * quest" run the same creates the rails run and land on the new record (D7 — one create habit, whichever
 * door starts it). The two "Log …" rows navigate, because a journal entry and a downtime record are
 * composed in a form and the form is what they are a door to; they are named accordingly.
 */

type Action =
  | Readonly<{ kind: "hit"; hit: CodexSearchHit }>
  | Readonly<{ kind: "create"; label: string; title: string }>
  | Readonly<{ kind: "verb"; label: string; run: () => void }>
  | Readonly<{ kind: "goto"; label: string; path: string }>;

export type CommandPaletteProps = Readonly<{
  gmToken: string;
  onOpenHit: (hit: CodexSearchHit) => void;
  /** Opens quick-create prefilled with the typed name. Absent on the player palette — no create verbs. */
  onCreatePage?: (title: string) => void;
  /**
   * D7: **genuinely create**, then open the new record — the same call the Sessions rail's "New" makes
   * (`creates.ts`). These rows used to navigate to the list, which is exactly what "Go to Sessions" does
   * six rows below, so a GM who asked the palette for a new session got a list and still had to find the
   * rail button. Supplied together with `onCreatePage`; absent on the player palette.
   */
  onCreateSession?: () => void;
  onCreateQuest?: () => void;
  onNavigate: (path: string) => void;
  onClose: () => void;
  player?: boolean;
}>;

/** A quick-switcher stays a switcher: the full result list lives in the rail. */
const MAX_HITS = 8;

export function CommandPalette({ gmToken, onOpenHit, onCreatePage, onCreateSession, onCreateQuest, onNavigate, onClose, player = false }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const runSearch = useCallback(
    (text: string) => (player ? playerCodexApi.search(gmToken, text) : codexApi.search(gmToken, text)),
    [gmToken, player]
  );
  const state = useCodexSearch(query, runSearch);

  /** Every sidebar destination, from the same table the sidebar renders — one list, never two. */
  const gotoVerbs = useMemo<Action[]>(
    () => (player ? PLAYER_SIDEBAR : GM_SIDEBAR)
      .flatMap((group) => group.items)
      .filter((item) => item.path)
      .map((item) => ({ kind: "goto" as const, label: `Go to ${item.label}`, path: item.path! })),
    [player]
  );

  const actions = useMemo<Action[]>(() => {
    const trimmed = query.trim();
    const hits = state.status === "ready" ? state.hits.slice(0, MAX_HITS) : [];
    const list: Action[] = hits.map((hit) => ({ kind: "hit" as const, hit }));
    // Offer "new page" unless a page with exactly this title already came back — a page always matches its own title.
    if (trimmed && onCreatePage && !hits.some((hit) => hit.kind === "page" && hit.title.toLowerCase() === trimmed.toLowerCase())) {
      list.push({ kind: "create", label: `New page “${trimmed}”`, title: trimmed });
    }
    if (!trimmed) {
      if (onCreatePage) {
        list.push(
          { kind: "create", label: "New page…", title: "" },
          // D7: these two CREATE. The two below them do not, and are not labelled as though they do —
          // a journal entry and a downtime record are both composed in a form, so their door is the
          // surface that holds the form, and "Log …" is the honest name for going there.
          ...(onCreateSession ? [{ kind: "verb" as const, label: "New session", run: onCreateSession }] : []),
          ...(onCreateQuest ? [{ kind: "verb" as const, label: "New quest", run: onCreateQuest }] : []),
          { kind: "verb", label: "Log a journal entry", run: () => onNavigate(pathForSection("journal")) },
          { kind: "verb", label: "Log downtime", run: () => onNavigate(pathForSection("downtime")) }
        );
      }
      list.push(...gotoVerbs);
    }
    return list;
  }, [state, query, gotoVerbs, onCreatePage, onCreateSession, onCreateQuest, onNavigate]);

  useEffect(() => { setActive(0); }, [query]);

  const run = (action: Action | undefined) => {
    if (!action) return;
    if (action.kind === "hit") onOpenHit(action.hit);
    else if (action.kind === "create") onCreatePage?.(action.title);
    else if (action.kind === "verb") action.run();
    else onNavigate(action.path);
    onClose();
  };

  return (
    <Modal open onClose={onClose} size="sm" align="top" ariaLabel="Codex command palette" className="codex-palette-modal">
      <input
        ref={inputRef}
        className="nh-input codex-palette-input"
        value={query}
        placeholder="Search pages, entries, maps, pins, quests and sessions"
        aria-label="Search the Codex"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(index + 1, actions.length - 1)); }
          else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
          else if (event.key === "Enter") { event.preventDefault(); run(actions[active]); }
          else if (event.key === "Escape") { event.preventDefault(); onClose(); }
        }}
      />
      <ul className="codex-palette-list">
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
        {state.status === "ready" && state.truncated && <li className="codex-search-truncated">Showing the first {SEARCH_HIT_CAP} matches. Narrow the search.</li>}
      </ul>
    </Modal>
  );
}
